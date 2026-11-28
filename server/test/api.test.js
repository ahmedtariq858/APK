import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import WebSocket from 'ws';
import { createServer } from '../src/server.js';
import { sha256 } from '../src/util.js';

let srv, base, cookie = '';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoteltv-'));

before(async () => {
  srv = createServer({ dataDir, noBackup: true, adminCidrs: '', tvCidrs: '' });
  await new Promise((r) => srv.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.server.address().port}`;
});
after(async () => { await srv.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

async function call(method, p, body) {
  const r = await fetch(base + p, {
    method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined
  });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: r.status, body: await r.json().catch(() => null) };
}

test('staff API needs login', async () => {
  assert.equal((await call('GET', '/api/dashboard')).status, 401);
  assert.equal((await call('POST', '/api/login', { username: 'admin', password: 'wrong' })).status, 401);
  const ok = await call('POST', '/api/login', { username: 'admin', password: 'admin123' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.role, 'superadmin');
  const me = await call('GET', '/api/me');
  assert.equal(me.body.hotel.name, 'ডেমো হোটেল'); // only one hotel: the super admin starts inside it
});

test('check-in reaches the TV over WebSocket, check-out resets it', async () => {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws/tv?room=101&device=tv-101&version=1.0.0');
  const msgs = [];
  ws.on('message', (m) => msgs.push(JSON.parse(m)));
  await new Promise((r) => ws.on('open', r));
  const waitFor = async (pred) => {
    for (let i = 0; i < 50; i++) { const m = msgs.find(pred); if (m) return m; await new Promise((r) => setTimeout(r, 20)); }
    throw new Error('message not received');
  };
  const first = await waitFor((m) => m.type === 'state');
  assert.equal(first.state.guest, null);

  const ci = await call('POST', '/api/checkin', { room: '101', guestName: 'Rahman', language: 'en', checkoutAt: new Date(Date.now() + 86400000).toISOString() });
  assert.equal(ci.status, 200);
  assert.equal(ci.body.tvOnline, true);
  const named = await waitFor((m) => m.type === 'state' && m.state.guest?.name === 'Rahman');
  assert.equal(named.state.guest.language, 'en');

  const dash = await call('GET', '/api/dashboard');
  assert.equal(dash.body.rooms.find((r) => r.number === '101').tv, 'online');

  // order from the TV, twice with the same clientId (outbox retry) → one order
  const item = named.state.menu[0];
  const o1 = await call('POST', '/api/tv/orders', { room: '101', items: [{ id: item.id, qty: 2 }], clientId: 'c-1' });
  const o2 = await call('POST', '/api/tv/orders', { room: '101', items: [{ id: item.id, qty: 2 }], clientId: 'c-1' });
  assert.equal(o1.status, 200);
  assert.equal(o2.body.duplicate, true);
  assert.equal(o1.body.order.total, item.price * 2);

  await call('POST', `/api/orders/${o1.body.order.id}/status`, { status: 'preparing' });
  await waitFor((m) => m.type === 'state' && m.state.orders[0]?.status === 'preparing');

  const pre = await call('GET', '/api/checkout/101');
  assert.equal(pre.body.total, item.price * 2);
  const co = await call('POST', '/api/checkout', { room: '101' });
  assert.equal(co.status, 200);
  assert.equal(co.body.billedOrders.length, 1);
  const cmd = await waitFor((m) => m.type === 'command' && m.command === 'clearGuestData');
  assert.ok(cmd.args.packages.includes('com.netflix.ninja'));
  await waitFor((m) => m.type === 'state' && m.state.guest === null && msgs.indexOf(m) > msgs.indexOf(cmd) - 1);
  ws.close();
});

test('notices are targeted by floor and time window', async () => {
  const soon = new Date(Date.now() + 3600000).toISOString();
  await call('POST', '/api/notices', { targetType: 'floor', target: '2', style: 'ticker', textBn: 'দ্বিতীয় তলায় পানি বন্ধ' });
  await call('POST', '/api/notices', { targetType: 'all', style: 'popup', textBn: 'পরে আসবে', startsAt: soon });
  const s201 = srv.roomState(1, '201');
  const s101 = srv.roomState(1, '101');
  assert.equal(s201.notices.length, 1);
  assert.equal(s101.notices.length, 0);
});

test('TV PIN can be changed and the guest screen hash matches', async () => {
  assert.equal((await call('PUT', '/api/tv/settings', { pin: '1234' })).status, 400);
  assert.equal((await call('PUT', '/api/tv/settings', { pin: '4821', maxVolume: 60 })).status, 200);
  const st = srv.roomState(1, '101').tv;
  assert.equal(st.maxVolume, 60);
  assert.equal(st.pinHash, sha256(st.pinSalt + '4821'));

  // the sha256 inside tv.js must agree with Node's
  const src = fs.readFileSync(new URL('../public/tv/tv.js', import.meta.url), 'utf8');
  const el = () => ({ classList: { add() {}, remove() {}, contains: () => true, toggle() {} }, style: { setProperty() {} }, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], appendChild() {} });
  const sandbox = {
    window: {}, location: { protocol: 'http:', origin: 'http://x', search: '?room=101', reload() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { querySelector: () => el(), querySelectorAll: () => [], addEventListener() {}, documentElement: {}, activeElement: null },
    navigator: { userAgent: 'test' }, URLSearchParams, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
    fetch: () => Promise.reject(new Error('offline')), WebSocket: function () { throw new Error('no ws'); }, Promise, JSON, Math, Date, encodeURIComponent, unescape
  };
  vm.runInNewContext(src, sandbox);
  for (const s of ['', 'abc', st.pinSalt + '4821', 'বাংলা']) assert.equal(sandbox.window.HotelTV._sha256(s), sha256(s));
});

test('kitchen role cannot change TV settings', async () => {
  await call('POST', '/api/users', { username: 'kitchen1', role: 'kitchen', password: 'secret12' });
  const keep = cookie;
  cookie = '';
  await call('POST', '/api/login', { username: 'kitchen1', password: 'secret12' });
  assert.equal((await call('PUT', '/api/tv/settings', { maxVolume: 50 })).status, 403);
  assert.equal((await call('GET', '/api/orders')).status, 200);
  cookie = keep;
});

test('admin panel can be limited to the staff network', async () => {
  const s2 = createServer({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'hoteltv2-')), noBackup: true, adminCidrs: '10.9.0.0/16', tvCidrs: '' });
  await new Promise((r) => s2.server.listen(0, '127.0.0.1', r));
  const b2 = `http://127.0.0.1:${s2.server.address().port}`;
  // localhost is always allowed (the server's own console)
  assert.equal((await fetch(b2 + '/admin/')).status, 200);
  await s2.close();
});

test('hotels are isolated from each other', async () => {
  const keep = cookie;
  const created = await call('POST', '/api/hotels', { name: 'Sea View', rooms: '101-103', managerUsername: 'seaview', managerPassword: 'sea12345' });
  assert.equal(created.status, 200);
  const code = created.body.hotel.code;
  assert.match(code, /^[A-Z2-9]{6}$/);

  // With two hotels a TV must say which hotel it belongs to.
  const noCode = await fetch(`${base}/api/tv/state?room=101&device=x`);
  assert.equal(noCode.status, 400);
  const wrong = await fetch(`${base}/api/tv/state?room=101&device=x&hotel=ZZZZZZ`);
  assert.equal(wrong.status, 404);

  // Room 101 exists in both hotels, independently.
  cookie = '';
  await call('POST', '/api/login', { username: 'seaview', password: 'sea12345' });
  const me = await call('GET', '/api/me');
  assert.equal(me.body.hotel.name, 'Sea View');
  assert.equal(me.body.user.role, 'manager');
  await call('POST', '/api/checkin', { room: '101', guestName: 'Karim' });
  const dash = await call('GET', '/api/dashboard');
  assert.deepEqual(dash.body.rooms.map((r) => r.number), ['101', '102', '103']);
  assert.equal((await call('GET', '/api/hotels')).status, 403); // owners cannot see other hotels
  assert.equal((await call('GET', '/api/notices')).body.notices.length, 0); // the demo hotel's notices stay there

  const tvB = await (await fetch(`${base}/api/tv/state?room=101&device=tvB&hotel=${code}`)).json();
  assert.equal(tvB.guest.name, 'Karim');
  assert.equal(tvB.hotelName, 'Sea View');
  const demoCode = (await (async () => { cookie = keep; return call('GET', '/api/hotels'); })()).body.hotels.find((h) => h.name === 'ডেমো হোটেল').code;
  const tvA = await (await fetch(`${base}/api/tv/state?room=101&device=tvA&hotel=${demoCode}`)).json();
  assert.equal(tvA.guest, null); // the demo hotel's room 101 is still empty

  // An order from hotel B's TV cannot use hotel A's menu items.
  const aItem = tvA.menu[0].id;
  const bad = await fetch(`${base}/api/tv/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hotel: code, room: '101', items: [{ id: aItem, qty: 1 }] }) });
  assert.equal(bad.status, 400);

  // Switching a hotel off locks out its owner and its TVs.
  const hid = created.body.hotel.id;
  assert.equal((await call('PUT', `/api/hotels/${hid}`, { active: false })).status, 200);
  assert.equal((await fetch(`${base}/api/tv/state?room=101&device=tvB&hotel=${code}`)).status, 403);
  cookie = '';
  assert.equal((await call('POST', '/api/login', { username: 'seaview', password: 'sea12345' })).status, 403);
  cookie = keep;

  // The super admin can enter a hotel and work inside it.
  await call('PUT', `/api/hotels/${hid}`, { active: true });
  assert.equal((await call('POST', `/api/hotels/${hid}/enter`)).status, 200);
  assert.equal((await call('GET', '/api/me')).body.hotel.name, 'Sea View');
  assert.equal((await call('GET', '/api/dashboard')).body.rooms.length, 3);
});

test('an old single-hotel database is migrated into hotel #1', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoteltv-old-'));
  const old = new DatabaseSync(path.join(dir, 'hotel.db'));
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL DEFAULT '',
      pass_hash TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
    CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE rooms (number TEXT PRIMARY KEY, floor TEXT NOT NULL DEFAULT '', guest_name TEXT, language TEXT NOT NULL DEFAULT 'bn', checkin_at INTEGER, checkout_at INTEGER);
    CREATE TABLE devices (id TEXT PRIMARY KEY, room TEXT, ip TEXT, version TEXT, model TEXT, last_seen INTEGER);
    CREATE TABLE offline_minutes (day TEXT NOT NULL, room TEXT NOT NULL, minutes INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, room));
    CREATE TABLE notices (id INTEGER PRIMARY KEY AUTOINCREMENT, target_type TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', style TEXT NOT NULL,
      text_bn TEXT NOT NULL DEFAULT '', text_en TEXT NOT NULL DEFAULT '', starts_at INTEGER, ends_at INTEGER, created_by TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE menu_items (id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL DEFAULT '', name_bn TEXT NOT NULL, name_en TEXT NOT NULL DEFAULT '',
      description_bn TEXT NOT NULL DEFAULT '', description_en TEXT NOT NULL DEFAULT '', price INTEGER NOT NULL DEFAULT 0, image TEXT, available INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT UNIQUE, room TEXT NOT NULL, guest_name TEXT, items TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      total INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'new', billed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, username TEXT, action TEXT NOT NULL, detail TEXT);
    CREATE TABLE alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, room TEXT, kind TEXT NOT NULL, message TEXT NOT NULL, seen INTEGER NOT NULL DEFAULT 0);`);
  old.prepare("INSERT INTO users (username, pass_hash, role, created_at) VALUES ('admin', ?, 'manager', 1)").run('scrypt$x$y');
  old.prepare("INSERT INTO users (username, pass_hash, role, created_at) VALUES ('desk', ?, 'reception', 1)").run('scrypt$x$y');
  old.prepare("INSERT INTO rooms (number, floor, guest_name) VALUES ('101', '1', 'Rahim')").run();
  old.prepare("INSERT INTO kv (key, value) VALUES ('content', ?)").run(JSON.stringify({ hotelName: { bn: 'পুরোনো হোটেল', en: 'Old' } }));
  old.prepare("INSERT INTO kv (key, value) VALUES ('tv', ?)").run(JSON.stringify({ pinSalt: 's', pinHash: 'h', combo: [], maxVolume: 70, clearPackages: [] }));
  old.close();

  const s3 = createServer({ dataDir: dir, noBackup: true, adminCidrs: '', tvCidrs: '' });
  const hotels = s3.db.prepare('SELECT * FROM hotels').all();
  assert.equal(hotels.length, 1);
  assert.equal(hotels[0].name, 'পুরোনো হোটেল');
  assert.equal(s3.db.prepare("SELECT role, hotel_id FROM users WHERE username = 'admin'").get().role, 'superadmin');
  assert.equal(s3.db.prepare("SELECT hotel_id FROM users WHERE username = 'desk'").get().hotel_id, 1);
  assert.equal(s3.roomState(1, '101').guest.name, 'Rahim');
  assert.equal(s3.roomState(1, '101').tv.maxVolume, 70);
  await new Promise((r) => s3.server.listen(0, '127.0.0.1', r));
  await s3.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
