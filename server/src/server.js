import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { openDb, getKv, setKv } from './db.js';
import {
  sha256, hashPassword, verifyPassword, randomToken,
  parseCidrs, ipAllowed, normalizeIp, todayKey
} from './util.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const SESSION_TTL = 12 * 60 * 60 * 1000;
const OFFLINE_AFTER = 150 * 1000; // TV pings every 60 s; 2.5 min without one = offline

/** Which pages/actions each role may use. */
const ROLE_PERMS = {
  reception: ['dashboard', 'checkin', 'notices', 'orders.view'],
  kitchen: ['dashboard', 'orders.view', 'orders.manage', 'menu'],
  manager: ['*'],
  technician: ['dashboard', 'tv']
};
const can = (user, perm) => {
  const p = ROLE_PERMS[user?.role] || [];
  return p.includes('*') || p.includes(perm);
};

export function createServer(opts = {}) {
  const dataDir = opts.dataDir || process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const db = openDb(dataDir);
  const uploadDir = path.join(dataDir, 'uploads');
  const apkDir = path.join(dataDir, 'apk');
  const backupDir = path.join(dataDir, 'backups');
  for (const d of [uploadDir, apkDir, backupDir]) fs.mkdirSync(d, { recursive: true });

  const adminCidrs = parseCidrs(opts.adminCidrs ?? process.env.ADMIN_ALLOWED_CIDRS);
  const tvCidrs = parseCidrs(opts.tvCidrs ?? process.env.TV_ALLOWED_CIDRS);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  // ---------- helpers ----------
  const audit = (user, action, detail) =>
    db.prepare('INSERT INTO audit_log (at, username, action, detail) VALUES (?,?,?,?)')
      .run(Date.now(), user?.username ?? null, action, detail == null ? null : JSON.stringify(detail));

  const getRoom = (n) => db.prepare('SELECT * FROM rooms WHERE number = ?').get(String(n));

  const activeNotices = (room, now = Date.now()) => {
    const rows = db.prepare(`SELECT * FROM notices
      WHERE (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at > ?)
      ORDER BY id`).all(now, now);
    if (!room) return rows;
    return rows.filter((n) => n.target_type === 'all'
      || (n.target_type === 'floor' && n.target === room.floor)
      || (n.target_type === 'room' && n.target === room.number));
  };

  const mapOrder = (o) => ({ ...o, items: JSON.parse(o.items), billed: !!o.billed });

  function roomOrders(room) {
    if (!room?.checkin_at) return [];
    return db.prepare('SELECT * FROM orders WHERE room = ? AND created_at >= ? ORDER BY id DESC')
      .all(room.number, room.checkin_at).map(mapOrder);
  }

  function tvPublicSettings() {
    const tv = getKv(db, 'tv');
    const apk = getKv(db, 'apk');
    return {
      pinSalt: tv.pinSalt, pinHash: tv.pinHash, combo: tv.combo, maxVolume: tv.maxVolume,
      clearPackages: tv.clearPackages, kiosk: !!tv.kiosk,
      latestApk: apk ? { versionCode: apk.versionCode, versionName: apk.versionName, url: '/apk/hotel-launcher.apk', sha256: apk.sha256 } : null
    };
  }

  function roomState(number) {
    const room = getRoom(number);
    const content = getKv(db, 'content');
    const menu = db.prepare('SELECT * FROM menu_items ORDER BY sort, id').all()
      .map((m) => ({ ...m, available: !!m.available }));
    return {
      room: number,
      known: !!room,
      floor: room?.floor ?? '',
      guest: room?.guest_name
        ? { name: room.guest_name, language: room.language, checkinAt: room.checkin_at, checkoutAt: room.checkout_at }
        : null,
      content,
      notices: room ? activeNotices(room).map(({ id, style, text_bn, text_en, starts_at, ends_at }) =>
        ({ id, style, text: { bn: text_bn, en: text_en }, startsAt: starts_at, endsAt: ends_at })) : [],
      menu,
      orders: roomOrders(room),
      tv: tvPublicSettings(),
      serverTime: Date.now()
    };
  }

  // ---------- realtime hubs ----------
  const tvSockets = new Map(); // room -> Set<ws>
  const adminSockets = new Set();
  const pendingCommands = new Map(); // room -> [{id, command, args}] for TVs that only poll

  const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };

  function pushRoom(number) {
    const set = tvSockets.get(String(number));
    if (!set || set.size === 0) return;
    const state = roomState(String(number));
    for (const ws of set) send(ws, { type: 'state', state });
  }
  function pushAllRooms() {
    for (const room of tvSockets.keys()) pushRoom(room);
  }
  function notifyAdmins(msg) {
    for (const ws of adminSockets) send(ws, msg);
  }
  let cmdSeq = 0;
  function sendCommand(rooms, command, args = {}) {
    const cmd = { id: `${Date.now()}-${++cmdSeq}`, command, args };
    let delivered = 0;
    for (const r of rooms) {
      const set = tvSockets.get(String(r));
      if (set && set.size) {
        for (const ws of set) send(ws, { type: 'command', ...cmd });
        delivered++;
      } else {
        const q = pendingCommands.get(String(r)) || [];
        q.push(cmd);
        pendingCommands.set(String(r), q.slice(-10));
      }
    }
    return { delivered, queued: rooms.length - delivered };
  }

  function touchDevice({ id, room, ip, version, model }) {
    if (!id) return;
    db.prepare(`INSERT INTO devices (id, room, ip, version, model, last_seen) VALUES (?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET room=excluded.room, ip=excluded.ip,
        version=COALESCE(excluded.version, devices.version), model=COALESCE(excluded.model, devices.model),
        last_seen=excluded.last_seen`)
      .run(String(id), room == null ? null : String(room), normalizeIp(ip), version ?? null, model ?? null, Date.now());
  }

  function addAlert(room, kind, message) {
    db.prepare('INSERT INTO alerts (at, room, kind, message) VALUES (?,?,?,?)').run(Date.now(), room ?? null, kind, message);
    notifyAdmins({ type: 'alert', room, kind, message });
  }

  // ---------- middleware ----------
  app.use(express.json({ limit: '12mb' }));

  const cookieToken = (req) => {
    const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
    return m ? m[1] : null;
  };
  function sessionUser(token) {
    if (!token) return null;
    const row = db.prepare(`SELECT u.id, u.username, u.display_name, u.role, s.expires_at
      FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND u.active = 1`).get(token);
    if (!row || row.expires_at < Date.now()) return null;
    return row;
  }

  const staffOnly = (req, res, next) => {
    if (!ipAllowed(adminCidrs, req.socket.remoteAddress)) return res.status(403).send('অ্যাডমিন প্যানেল শুধু স্টাফ নেটওয়ার্ক থেকে খোলা যায়।');
    next();
  };
  const tvOnly = (req, res, next) => {
    if (!ipAllowed(tvCidrs, req.socket.remoteAddress)) return res.status(403).json({ error: 'forbidden' });
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  };
  const auth = (perm) => (req, res, next) => {
    const user = sessionUser(cookieToken(req));
    if (!user) return res.status(401).json({ error: 'লগইন করুন' });
    if (perm && !can(user, perm)) return res.status(403).json({ error: 'এই কাজের অনুমতি নেই' });
    req.user = user;
    next();
  };
  const wrap = (fn) => (req, res) => {
    try { fn(req, res); } catch (e) {
      if (!e.expose) console.error(e);
      res.status(e.status || 500).json({ error: e.expose ? e.message : 'সার্ভারে সমস্যা হয়েছে' });
    }
  };
  const bad = (msg) => Object.assign(new Error(msg), { status: 400, expose: true });

  // ---------- static ----------
  const noCache = { setHeaders: (res) => res.set('Cache-Control', 'no-cache') };
  app.get('/', (req, res) => res.redirect('/admin/'));
  app.use('/tv', express.static(path.join(PUBLIC_DIR, 'tv'), noCache));
  app.use('/admin', staffOnly, express.static(path.join(PUBLIC_DIR, 'admin'), noCache));
  app.use('/uploads', express.static(uploadDir, { maxAge: '7d', setHeaders: (res) => res.set('Access-Control-Allow-Origin', '*') }));
  app.use('/apk', express.static(apkDir, noCache));
  app.get('/health', (req, res) => res.json({ ok: true, time: Date.now() }));

  // ---------- TV API (used by the launcher) ----------
  const tv = express.Router();
  tv.use(tvOnly);

  tv.get('/state', wrap((req, res) => {
    const room = String(req.query.room || '');
    if (!room) throw bad('room দরকার');
    touchDevice({ id: req.query.device, room, ip: req.socket.remoteAddress, version: req.query.version, model: req.query.model });
    const commands = pendingCommands.get(room) || [];
    pendingCommands.delete(room);
    res.json({ ...roomState(room), commands });
  }));

  tv.post('/heartbeat', wrap((req, res) => {
    const { device, room, version, model } = req.body || {};
    touchDevice({ id: device, room, ip: req.socket.remoteAddress, version, model });
    res.json({ ok: true });
  }));

  tv.post('/orders', wrap((req, res) => {
    const { room, items, note = '', clientId } = req.body || {};
    const r = getRoom(room);
    if (!r) throw bad('অজানা রুম');
    if (clientId) {
      const dup = db.prepare('SELECT * FROM orders WHERE client_id = ?').get(String(clientId));
      if (dup) return res.json({ order: mapOrder(dup), duplicate: true });
    }
    if (!Array.isArray(items) || items.length === 0) throw bad('অর্ডারে কিছু নেই');
    const lines = [];
    let total = 0;
    for (const it of items) {
      const m = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(Number(it.id));
      const qty = Math.max(1, Math.min(20, Math.floor(Number(it.qty) || 0)));
      if (!m) throw bad('মেনুতে নেই এমন খাবার');
      if (!m.available) throw bad(`${m.name_bn} এখন পাওয়া যাচ্ছে না`);
      lines.push({ id: m.id, name_bn: m.name_bn, name_en: m.name_en, price: m.price, qty });
      total += m.price * qty;
    }
    const now = Date.now();
    const info = db.prepare(`INSERT INTO orders (client_id, room, guest_name, items, note, total, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(clientId ? String(clientId) : null, r.number, r.guest_name, JSON.stringify(lines), String(note).slice(0, 300), total, now, now);
    const order = mapOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid));
    notifyAdmins({ type: 'order.new', order });
    pushRoom(r.number);
    res.json({ order });
  }));

  tv.post('/alert', wrap((req, res) => {
    const { room, kind, message } = req.body || {};
    const allowed = { pin_lockout: 'টিভি-অ্যাডমিন পিন ৫ বার ভুল দেওয়া হয়েছে', clear_failed: 'অতিথির লগইন মোছা যায়নি', exit: 'টিভিতে লঞ্চার থেকে বের হওয়া হয়েছে' };
    if (!allowed[kind]) throw bad('unknown alert');
    addAlert(room ? String(room) : null, kind, message ? String(message).slice(0, 200) : allowed[kind]);
    res.json({ ok: true });
  }));

  // Command results from TVs that poll instead of using the WebSocket.
  tv.post('/result', wrap((req, res) => {
    const { room, id, command, ok, message } = req.body || {};
    notifyAdmins({ type: 'command.result', room, id, ok: !!ok, message: String(message || '').slice(0, 200) });
    if (command === 'clearGuestData' && !ok) addAlert(room ? String(room) : null, 'clear_failed', 'অতিথির লগইন মোছা যায়নি (Device Owner চালু নেই?)');
    res.json({ ok: true });
  }));

  app.use('/api/tv', tv);

  // ---------- staff API ----------
  const api = express.Router();
  api.use(staffOnly);

  api.post('/login', wrap((req, res) => {
    const { username, password } = req.body || {};
    const u = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(String(username || ''));
    if (!u || !verifyPassword(password || '', u.pass_hash)) {
      audit({ username: String(username || '') }, 'login.failed');
      return res.status(401).json({ error: 'ইউজারনেম বা পাসওয়ার্ড ভুল' });
    }
    const token = randomToken();
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').run(token, u.id, Date.now() + SESSION_TTL);
    res.set('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}`);
    audit(u, 'login');
    res.json({ user: publicUser(u) });
  }));

  api.post('/logout', wrap((req, res) => {
    const t = cookieToken(req);
    if (t) db.prepare('DELETE FROM sessions WHERE token = ?').run(t);
    res.set('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ ok: true });
  }));

  const publicUser = (u) => ({
    id: u.id, username: u.username, displayName: u.display_name, role: u.role,
    perms: ROLE_PERMS[u.role]
  });

  api.get('/me', auth(), wrap((req, res) => {
    const tvs = getKv(db, 'tv');
    res.json({ user: publicUser(req.user), warnings: { defaultPin: !!tvs.pinIsDefault } });
  }));

  api.post('/me/password', auth(), wrap((req, res) => {
    const { current, next } = req.body || {};
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(current || '', u.pass_hash)) throw bad('বর্তমান পাসওয়ার্ড ভুল');
    if (!next || String(next).length < 6) throw bad('নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষর');
    db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(next), u.id);
    audit(req.user, 'password.change');
    res.json({ ok: true });
  }));

  // Dashboard: one row per room
  api.get('/dashboard', auth('dashboard'), wrap((req, res) => {
    const now = Date.now();
    const rooms = db.prepare('SELECT * FROM rooms ORDER BY floor, number').all();
    const devices = db.prepare('SELECT * FROM devices').all();
    const newOrders = db.prepare("SELECT room, COUNT(*) AS n FROM orders WHERE status IN ('new','preparing') GROUP BY room").all();
    const nMap = Object.fromEntries(newOrders.map((r) => [r.room, r.n]));
    const out = rooms.map((r) => {
      const devs = devices.filter((d) => d.room === r.number);
      const lastSeen = Math.max(0, ...devs.map((d) => d.last_seen || 0));
      return {
        number: r.number, floor: r.floor, guestName: r.guest_name, language: r.language,
        checkinAt: r.checkin_at, checkoutAt: r.checkout_at,
        tv: devs.length === 0 ? 'none' : (now - lastSeen < OFFLINE_AFTER ? 'online' : 'offline'),
        lastSeen: lastSeen || null,
        devices: devs.map((d) => ({ id: d.id, ip: d.ip, version: d.version, model: d.model, lastSeen: d.last_seen })),
        activeOrders: nMap[r.number] || 0
      };
    });
    const alerts = db.prepare('SELECT * FROM alerts WHERE seen = 0 ORDER BY id DESC LIMIT 20').all();
    const unassigned = devices.filter((d) => !rooms.some((r) => r.number === d.room));
    res.json({ rooms: out, alerts, unassignedDevices: unassigned });
  }));

  api.post('/alerts/seen', auth('dashboard'), wrap((req, res) => {
    db.prepare('UPDATE alerts SET seen = 1 WHERE seen = 0').run();
    res.json({ ok: true });
  }));

  // Rooms list management (manager)
  api.get('/rooms', auth('dashboard'), wrap((req, res) => {
    res.json({ rooms: db.prepare('SELECT * FROM rooms ORDER BY floor, number').all() });
  }));
  api.post('/rooms', auth('content'), wrap((req, res) => {
    const { number, floor = '' } = req.body || {};
    if (!number || !/^[\w-]{1,10}$/.test(String(number))) throw bad('রুম নম্বর ঠিক নয়');
    db.prepare('INSERT INTO rooms (number, floor) VALUES (?,?) ON CONFLICT(number) DO UPDATE SET floor = excluded.floor')
      .run(String(number), String(floor));
    audit(req.user, 'room.save', { number, floor });
    res.json({ ok: true });
  }));
  api.delete('/rooms/:number', auth('content'), wrap((req, res) => {
    db.prepare('DELETE FROM rooms WHERE number = ?').run(req.params.number);
    audit(req.user, 'room.delete', { number: req.params.number });
    res.json({ ok: true });
  }));

  // Check-in / check-out
  api.post('/checkin', auth('checkin'), wrap((req, res) => {
    const { room, guestName, language = 'bn', checkoutAt } = req.body || {};
    const r = getRoom(room);
    if (!r) throw bad('অজানা রুম');
    if (!guestName || !String(guestName).trim()) throw bad('অতিথির নাম দিন');
    if (!['bn', 'en'].includes(language)) throw bad('ভাষা bn বা en');
    const co = checkoutAt ? Number(new Date(checkoutAt)) : null;
    if (checkoutAt && !Number.isFinite(co)) throw bad('চেক-আউটের সময় ঠিক নয়');
    db.prepare('UPDATE rooms SET guest_name = ?, language = ?, checkin_at = ?, checkout_at = ? WHERE number = ?')
      .run(String(guestName).trim().slice(0, 80), language, Date.now(), co, r.number);
    audit(req.user, 'checkin', { room: r.number, guestName });
    pushRoom(r.number);
    notifyAdmins({ type: 'rooms.changed' });
    res.json({ ok: true, tvOnline: (tvSockets.get(r.number)?.size || 0) > 0 });
  }));

  api.get('/checkout/:room', auth('checkin'), wrap((req, res) => {
    const r = getRoom(req.params.room);
    if (!r) throw bad('অজানা রুম');
    const orders = roomOrders(r).filter((o) => !o.billed && o.status !== 'cancelled');
    res.json({ room: r, orders, total: orders.reduce((s, o) => s + o.total, 0) });
  }));

  api.post('/checkout', auth('checkin'), wrap((req, res) => {
    const { room } = req.body || {};
    const r = getRoom(room);
    if (!r) throw bad('অজানা রুম');
    const orders = roomOrders(r).filter((o) => !o.billed && o.status !== 'cancelled');
    if (orders.length) db.prepare(`UPDATE orders SET billed = 1, updated_at = ? WHERE id IN (${orders.map(() => '?').join(',')})`)
      .run(Date.now(), ...orders.map((o) => o.id));
    db.prepare('UPDATE rooms SET guest_name = NULL, checkin_at = NULL, checkout_at = NULL, language = ? WHERE number = ?')
      .run('bn', r.number);
    const tvs = getKv(db, 'tv');
    const delivery = sendCommand([r.number], 'clearGuestData', { packages: tvs.clearPackages });
    audit(req.user, 'checkout', { room: r.number, guest: r.guest_name, billed: orders.map((o) => o.id) });
    pushRoom(r.number);
    notifyAdmins({ type: 'rooms.changed' });
    res.json({ ok: true, billedOrders: orders, total: orders.reduce((s, o) => s + o.total, 0), delivery });
  }));

  // Notices
  api.get('/notices', auth('notices'), wrap((req, res) => {
    res.json({ notices: db.prepare('SELECT * FROM notices ORDER BY id DESC LIMIT 200').all(), now: Date.now() });
  }));
  api.post('/notices', auth('notices'), wrap((req, res) => {
    const { targetType = 'all', target = '', style = 'ticker', textBn = '', textEn = '', startsAt, endsAt } = req.body || {};
    if (!['all', 'floor', 'room'].includes(targetType)) throw bad('লক্ষ্য ঠিক নয়');
    if (!['ticker', 'popup'].includes(style)) throw bad('ধরন ঠিক নয়');
    if (!String(textBn).trim() && !String(textEn).trim()) throw bad('নোটিশের লেখা দিন');
    if (targetType !== 'all' && !String(target).trim()) throw bad('ফ্লোর বা রুম নম্বর দিন');
    const s = startsAt ? Number(new Date(startsAt)) : null;
    const e = endsAt ? Number(new Date(endsAt)) : null;
    if (s && e && e <= s) throw bad('শেষের সময় শুরুর পরে হতে হবে');
    const info = db.prepare(`INSERT INTO notices (target_type, target, style, text_bn, text_en, starts_at, ends_at, created_by, created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(targetType, targetType === 'all' ? '' : String(target).trim(), style,
      String(textBn).slice(0, 500), String(textEn).slice(0, 500), s, e, req.user.username, Date.now());
    audit(req.user, 'notice.create', { id: Number(info.lastInsertRowid), targetType, target, style });
    pushAllRooms();
    res.json({ ok: true, id: Number(info.lastInsertRowid) });
  }));
  api.delete('/notices/:id', auth('notices'), wrap((req, res) => {
    db.prepare('DELETE FROM notices WHERE id = ?').run(Number(req.params.id));
    audit(req.user, 'notice.delete', { id: Number(req.params.id) });
    pushAllRooms();
    res.json({ ok: true });
  }));

  // Content
  api.get('/content', auth(), wrap((req, res) => res.json({ content: getKv(db, 'content') })));
  api.put('/content', auth('content'), wrap((req, res) => {
    const c = req.body?.content;
    if (!c || typeof c !== 'object') throw bad('content দরকার');
    const cur = getKv(db, 'content');
    const next = { ...cur, ...c };
    setKv(db, 'content', next);
    audit(req.user, 'content.update', Object.keys(c));
    pushAllRooms();
    res.json({ content: next });
  }));

  // Uploads (images as data URLs)
  api.post('/upload', auth(), wrap((req, res) => {
    if (!can(req.user, 'content') && !can(req.user, 'menu')) return res.status(403).json({ error: 'এই কাজের অনুমতি নেই' });
    const m = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/.exec(req.body?.dataUrl || '');
    if (!m) throw bad('শুধু PNG, JPG, WebP বা GIF ছবি');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 8 * 1024 * 1024) throw bad('ছবি ৮ MB-এর বেশি');
    const name = `${sha256(buf.toString('base64')).slice(0, 20)}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
    fs.writeFileSync(path.join(uploadDir, name), buf);
    res.json({ url: `/uploads/${name}` });
  }));

  // Menu
  api.get('/menu', auth(), wrap((req, res) => {
    res.json({ items: db.prepare('SELECT * FROM menu_items ORDER BY sort, id').all() });
  }));
  api.post('/menu', auth('menu'), wrap((req, res) => {
    const b = req.body || {};
    if (!String(b.name_bn || '').trim()) throw bad('খাবারের নাম দিন');
    const price = Math.round(Number(b.price));
    if (!(price >= 0)) throw bad('দাম ঠিক নয়');
    const vals = [String(b.category || ''), String(b.name_bn).trim(), String(b.name_en || ''), String(b.description_bn || ''),
      String(b.description_en || ''), price, b.image || null, b.available === false ? 0 : 1, Number(b.sort) || 0];
    let id = Number(b.id);
    if (id) {
      db.prepare(`UPDATE menu_items SET category=?, name_bn=?, name_en=?, description_bn=?, description_en=?, price=?, image=?, available=?, sort=? WHERE id=?`)
        .run(...vals, id);
    } else {
      id = Number(db.prepare(`INSERT INTO menu_items (category, name_bn, name_en, description_bn, description_en, price, image, available, sort)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(...vals).lastInsertRowid);
    }
    audit(req.user, 'menu.save', { id, name: b.name_bn, price, available: b.available !== false });
    pushAllRooms();
    res.json({ ok: true, id });
  }));
  api.delete('/menu/:id', auth('menu'), wrap((req, res) => {
    db.prepare('DELETE FROM menu_items WHERE id = ?').run(Number(req.params.id));
    audit(req.user, 'menu.delete', { id: Number(req.params.id) });
    pushAllRooms();
    res.json({ ok: true });
  }));

  // Orders
  api.get('/orders', auth('orders.view'), wrap((req, res) => {
    const scope = req.query.scope || 'active';
    const rows = scope === 'active'
      ? db.prepare("SELECT * FROM orders WHERE status IN ('new','preparing') ORDER BY id").all()
      : db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 200').all();
    res.json({ orders: rows.map(mapOrder) });
  }));
  api.post('/orders/:id/status', auth('orders.manage'), wrap((req, res) => {
    const { status } = req.body || {};
    if (!['new', 'preparing', 'delivered', 'cancelled'].includes(status)) throw bad('অবস্থা ঠিক নয়');
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(Number(req.params.id));
    if (!o) return res.status(404).json({ error: 'অর্ডার নেই' });
    db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), o.id);
    audit(req.user, 'order.status', { id: o.id, status });
    pushRoom(o.room);
    notifyAdmins({ type: 'order.updated', id: o.id, status });
    res.json({ ok: true });
  }));

  // TV control
  api.get('/tv/settings', auth('tv'), wrap((req, res) => {
    const { pinHash, pinSalt, ...rest } = getKv(db, 'tv');
    res.json({ settings: rest, apk: getKv(db, 'apk') });
  }));
  api.put('/tv/settings', auth('tv'), wrap((req, res) => {
    const cur = getKv(db, 'tv');
    const b = req.body || {};
    const next = { ...cur };
    if (b.pin != null) {
      if (!/^\d{4}$/.test(String(b.pin))) throw bad('পিন ৪ অঙ্কের হতে হবে');
      if (String(b.pin) === '1234') throw bad('১২৩৪ পিন রাখা যাবে না');
      next.pinSalt = sha256(randomToken()).slice(0, 16);
      next.pinHash = sha256(next.pinSalt + b.pin);
      next.pinIsDefault = false;
    }
    if (b.maxVolume != null) {
      const v = Math.round(Number(b.maxVolume));
      if (!(v >= 10 && v <= 100)) throw bad('ভলিউম ১০–১০০');
      next.maxVolume = v;
    }
    if (b.combo != null) {
      const okKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'];
      if (!Array.isArray(b.combo) || b.combo.length < 4 || b.combo.length > 12 || b.combo.some((k) => !okKeys.includes(k))) throw bad('কম্বিনেশন ৪–১২টি তীর/OK বোতাম');
      next.combo = b.combo;
    }
    if (b.clearPackages != null) {
      if (!Array.isArray(b.clearPackages) || b.clearPackages.some((p) => !/^[\w.]+$/.test(p))) throw bad('প্যাকেজের নাম ঠিক নয়');
      next.clearPackages = b.clearPackages;
    }
    if (b.kiosk != null) next.kiosk = !!b.kiosk;
    setKv(db, 'tv', next);
    audit(req.user, 'tv.settings', { ...b, pin: b.pin != null ? '••••' : undefined });
    pushAllRooms();
    res.json({ ok: true });
  }));

  api.post('/tv/command', auth('tv'), wrap((req, res) => {
    const { rooms, command } = req.body || {};
    const allowed = ['restart', 'reload', 'update', 'clearGuestData'];
    if (!allowed.includes(command)) throw bad('অজানা নির্দেশ');
    let targets = rooms === 'all' ? db.prepare('SELECT number FROM rooms').all().map((r) => r.number) : rooms;
    if (!Array.isArray(targets) || targets.length === 0) throw bad('রুম বাছুন');
    targets = targets.map(String);
    const args = {};
    if (command === 'update') {
      const apk = getKv(db, 'apk');
      if (!apk) throw bad('আগে নতুন APK আপলোড করুন');
      Object.assign(args, { url: '/apk/hotel-launcher.apk', versionCode: apk.versionCode, sha256: apk.sha256 });
    }
    if (command === 'clearGuestData') args.packages = getKv(db, 'tv').clearPackages;
    const result = sendCommand(targets, command, args);
    audit(req.user, `tv.${command}`, { rooms: targets });
    res.json(result);
  }));

  api.post('/tv/apk', auth('tv'), express.raw({ type: '*/*', limit: '200mb' }), wrap((req, res) => {
    const versionCode = Number(req.query.versionCode);
    const versionName = String(req.query.versionName || '');
    if (!Number.isInteger(versionCode) || versionCode < 1) throw bad('versionCode দিন');
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length < 1000 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw bad('এটা APK ফাইল নয়');
    fs.writeFileSync(path.join(apkDir, 'hotel-launcher.apk'), buf);
    const meta = { versionCode, versionName, size: buf.length, sha256: sha256(buf), uploadedAt: Date.now() };
    setKv(db, 'apk', meta);
    audit(req.user, 'tv.apk.upload', { versionCode, versionName, size: buf.length });
    pushAllRooms();
    res.json({ apk: meta });
  }));

  // Reports
  api.get('/reports', auth('reports'), wrap((req, res) => {
    const days = Math.max(1, Math.min(90, Number(req.query.days) || 7));
    const since = Date.now() - days * 86400000;
    const orders = db.prepare("SELECT created_at, total, status FROM orders WHERE created_at >= ? AND status != 'cancelled'").all(since);
    const byDay = {};
    for (const o of orders) {
      const k = todayKey(o.created_at);
      byDay[k] ??= { day: k, orders: 0, revenue: 0 };
      byDay[k].orders++;
      byDay[k].revenue += o.total;
    }
    const offline = db.prepare('SELECT room, SUM(minutes) AS minutes FROM offline_minutes WHERE day >= ? GROUP BY room ORDER BY minutes DESC')
      .all(todayKey(since));
    const top = {};
    for (const o of db.prepare("SELECT items FROM orders WHERE created_at >= ? AND status != 'cancelled'").all(since)) {
      for (const it of JSON.parse(o.items)) {
        top[it.name_bn] ??= { name: it.name_bn, qty: 0, revenue: 0 };
        top[it.name_bn].qty += it.qty;
        top[it.name_bn].revenue += it.qty * it.price;
      }
    }
    res.json({
      days,
      byDay: Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)),
      offline,
      topItems: Object.values(top).sort((a, b) => b.qty - a.qty).slice(0, 10)
    });
  }));

  api.get('/audit', auth('users'), wrap((req, res) => {
    res.json({ log: db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 300').all() });
  }));

  // Users
  api.get('/users', auth('users'), wrap((req, res) => {
    res.json({ users: db.prepare('SELECT id, username, display_name, role, active, created_at FROM users ORDER BY id').all() });
  }));
  api.post('/users', auth('users'), wrap((req, res) => {
    const { id, username, displayName = '', role, password, active = true } = req.body || {};
    if (!ROLE_PERMS[role]) throw bad('রোল ঠিক নয়');
    if (id) {
      if (Number(id) === req.user.id && (role !== 'manager' || !active)) throw bad('নিজের ম্যানেজার অনুমতি সরানো যাবে না');
      db.prepare('UPDATE users SET display_name = ?, role = ?, active = ? WHERE id = ?').run(displayName, role, active ? 1 : 0, Number(id));
      if (password) {
        if (String(password).length < 6) throw bad('পাসওয়ার্ড কমপক্ষে ৬ অক্ষর');
        db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(password), Number(id));
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(Number(id));
      }
      if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(Number(id));
      audit(req.user, 'user.update', { id, role, active });
    } else {
      if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(String(username || ''))) throw bad('ইউজারনেম ৩–৩০ অক্ষর (a-z, 0-9)');
      if (!password || String(password).length < 6) throw bad('পাসওয়ার্ড কমপক্ষে ৬ অক্ষর');
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw bad('এই ইউজারনেম আগেই আছে');
      db.prepare('INSERT INTO users (username, display_name, pass_hash, role, created_at) VALUES (?,?,?,?,?)')
        .run(username, displayName, hashPassword(password), role, Date.now());
      audit(req.user, 'user.create', { username, role });
    }
    res.json({ ok: true });
  }));

  app.use('/api', api);

  // ---------- HTTP + WebSocket ----------
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/ws/tv') {
      if (!ipAllowed(tvCidrs, req.socket.remoteAddress)) return socket.destroy();
      const room = url.searchParams.get('room');
      if (!room) return socket.destroy();
      wss.handleUpgrade(req, socket, head, (ws) => onTv(ws, req, url));
    } else if (url.pathname === '/ws/admin') {
      if (!ipAllowed(adminCidrs, req.socket.remoteAddress)) return socket.destroy();
      const user = sessionUser(cookieToken(req));
      if (!user) return socket.destroy();
      wss.handleUpgrade(req, socket, head, (ws) => onAdmin(ws, user));
    } else socket.destroy();
  });

  function onTv(ws, req, url) {
    const room = String(url.searchParams.get('room'));
    const dev = {
      id: url.searchParams.get('device') || `anon-${normalizeIp(req.socket.remoteAddress)}`,
      room, ip: req.socket.remoteAddress,
      version: url.searchParams.get('version'), model: url.searchParams.get('model')
    };
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    if (!tvSockets.has(room)) tvSockets.set(room, new Set());
    tvSockets.get(room).add(ws);
    touchDevice(dev);
    notifyAdmins({ type: 'rooms.changed' });
    send(ws, { type: 'state', state: roomState(room) });
    for (const cmd of pendingCommands.get(room) || []) send(ws, { type: 'command', ...cmd });
    pendingCommands.delete(room);
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'heartbeat') { touchDevice({ ...dev, version: msg.version ?? dev.version }); }
      else if (msg.type === 'commandResult') {
        notifyAdmins({ type: 'command.result', room, id: msg.id, ok: !!msg.ok, message: String(msg.message || '').slice(0, 200) });
        if (msg.command === 'clearGuestData' && !msg.ok) addAlert(room, 'clear_failed', 'অতিথির লগইন মোছা যায়নি (Device Owner চালু নেই?)');
      }
    });
    ws.on('close', () => {
      tvSockets.get(room)?.delete(ws);
      notifyAdmins({ type: 'rooms.changed' });
    });
  }

  function onAdmin(ws, user) {
    adminSockets.add(ws);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    send(ws, { type: 'hello', user: user.username });
    ws.on('close', () => adminSockets.delete(ws));
  }

  // ---------- timers ----------
  const timers = [];
  // keep sockets healthy
  timers.push(setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000));
  // offline minutes + scheduled notices becoming active/inactive
  let lastNoticeKey = '';
  timers.push(setInterval(() => {
    const now = Date.now();
    const day = todayKey(now);
    const upsert = db.prepare(`INSERT INTO offline_minutes (day, room, minutes) VALUES (?,?,1)
      ON CONFLICT(day, room) DO UPDATE SET minutes = minutes + 1`);
    for (const d of db.prepare('SELECT room, MAX(last_seen) AS last FROM devices WHERE room IS NOT NULL GROUP BY room').all()) {
      if (now - d.last > OFFLINE_AFTER) upsert.run(day, d.room);
    }
    const key = activeNotices(null, now).map((n) => n.id).join(',');
    if (key !== lastNoticeKey) { lastNoticeKey = key; pushAllRooms(); }
    notifyAdmins({ type: 'tick' });
  }, 60000));
  // daily backup at startup + every 24 h, keep 14
  const backup = () => {
    try {
      const file = path.join(backupDir, `hotel-${todayKey()}.db`);
      if (fs.existsSync(file)) fs.unlinkSync(file);
      db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
      const files = fs.readdirSync(backupDir).filter((f) => f.endsWith('.db')).sort();
      for (const f of files.slice(0, -14)) fs.unlinkSync(path.join(backupDir, f));
      if (process.env.BACKUP_COPY_DIR) fs.copyFileSync(file, path.join(process.env.BACKUP_COPY_DIR, path.basename(file)));
    } catch (e) { console.error('[backup]', e.message); }
  };
  if (!opts.noBackup) { backup(); timers.push(setInterval(backup, 24 * 3600 * 1000)); }

  function close() {
    timers.forEach(clearInterval);
    for (const ws of wss.clients) ws.terminate();
    return new Promise((r) => server.close(() => { db.close(); r(); }));
  }

  return { server, app, db, close, roomState };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8080);
  const { server } = createServer();
  server.listen(port, '0.0.0.0', () => {
    console.log(`হোটেল টিভি সার্ভার চলছে: http://0.0.0.0:${port}`);
    console.log(`  অ্যাডমিন প্যানেল: http://<এই কম্পিউটারের আইপি>:${port}/admin/`);
    console.log(`  অতিথির স্ক্রিন (ব্রাউজারে পরীক্ষা): http://localhost:${port}/tv/?room=101`);
  });
}
