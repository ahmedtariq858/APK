import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { hashPassword, sha256 } from './util.js';

const SCHEMA_VERSION = 2;

/** All tables are per hotel (hotel_id); users with role 'superadmin' belong to no hotel. */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS hotels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hotel_id INTEGER REFERENCES hotels(id),
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    pass_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('superadmin','reception','kitchen','manager','technician')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hotel_id INTEGER,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rooms (
    hotel_id INTEGER NOT NULL,
    number TEXT NOT NULL,
    floor TEXT NOT NULL DEFAULT '',
    guest_name TEXT,
    language TEXT NOT NULL DEFAULT 'bn',
    checkin_at INTEGER,
    checkout_at INTEGER,
    PRIMARY KEY (hotel_id, number)
  );
  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    hotel_id INTEGER NOT NULL DEFAULT 1,
    room TEXT,
    ip TEXT,
    version TEXT,
    model TEXT,
    last_seen INTEGER
  );
  CREATE TABLE IF NOT EXISTS offline_minutes (
    hotel_id INTEGER NOT NULL,
    day TEXT NOT NULL,
    room TEXT NOT NULL,
    minutes INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (hotel_id, day, room)
  );
  CREATE TABLE IF NOT EXISTS notices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hotel_id INTEGER NOT NULL DEFAULT 1,
    target_type TEXT NOT NULL CHECK (target_type IN ('all','floor','room')),
    target TEXT NOT NULL DEFAULT '',
    style TEXT NOT NULL CHECK (style IN ('ticker','popup')),
    text_bn TEXT NOT NULL DEFAULT '',
    text_en TEXT NOT NULL DEFAULT '',
    starts_at INTEGER,
    ends_at INTEGER,
    created_by TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hotel_id INTEGER NOT NULL DEFAULT 1,
    category TEXT NOT NULL DEFAULT '',
    name_bn TEXT NOT NULL,
    name_en TEXT NOT NULL DEFAULT '',
    description_bn TEXT NOT NULL DEFAULT '',
    description_en TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    available INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hotel_id INTEGER NOT NULL DEFAULT 1,
    client_id TEXT UNIQUE,
    room TEXT NOT NULL,
    guest_name TEXT,
    items TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    total INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','preparing','delivered','cancelled')),
    billed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hotel_id INTEGER,
    at INTEGER NOT NULL,
    username TEXT,
    action TEXT NOT NULL,
    detail TEXT
  );
  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hotel_id INTEGER NOT NULL DEFAULT 1,
    at INTEGER NOT NULL,
    room TEXT,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    seen INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_orders_hotel ON orders(hotel_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_devices_hotel ON devices(hotel_id, room);
  CREATE INDEX IF NOT EXISTS idx_notices_hotel ON notices(hotel_id);
`;

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'hotel.db'));
  db.exec('PRAGMA journal_mode = WAL;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  const hasOldRooms = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='rooms'").get();
  if (version < SCHEMA_VERSION && hasOldRooms) migrateFromSingleHotel(db);
  db.exec(SCHEMA);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}; PRAGMA foreign_keys = ON;`);
  seed(db);
  return db;
}

/** Version 1 (one hotel per server) → version 2: everything becomes hotel #1, 'admin' becomes the super admin. */
function migrateFromSingleHotel(db) {
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  if (cols('rooms').includes('hotel_id')) return;
  console.log('[migrate] এক-হোটেল ডেটাবেস → অনেক-হোটেল (সব ডেটা হোটেল #১-এ)');
  db.exec('PRAGMA foreign_keys = OFF; BEGIN;');
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS hotels (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, code TEXT UNIQUE NOT NULL,
      note TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)`);
    const content = getKv(db, 'content');
    const name = content?.hotelName?.bn || 'হোটেল ১';
    db.prepare('INSERT INTO hotels (id, name, code, created_at) VALUES (1, ?, ?, ?)').run(name, newHotelCode(db), Date.now());

    db.exec(`ALTER TABLE rooms RENAME TO rooms_v1;
      CREATE TABLE rooms (hotel_id INTEGER NOT NULL, number TEXT NOT NULL, floor TEXT NOT NULL DEFAULT '', guest_name TEXT,
        language TEXT NOT NULL DEFAULT 'bn', checkin_at INTEGER, checkout_at INTEGER, PRIMARY KEY (hotel_id, number));
      INSERT INTO rooms SELECT 1, number, floor, guest_name, language, checkin_at, checkout_at FROM rooms_v1;
      DROP TABLE rooms_v1;`);

    db.exec(`ALTER TABLE users RENAME TO users_v1;
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, hotel_id INTEGER REFERENCES hotels(id), username TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL DEFAULT '', pass_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('superadmin','reception','kitchen','manager','technician')),
        active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL);
      INSERT INTO users SELECT id, CASE WHEN username = 'admin' THEN NULL ELSE 1 END, username, display_name, pass_hash,
        CASE WHEN username = 'admin' THEN 'superadmin' ELSE role END, active, created_at FROM users_v1;
      DROP TABLE users_v1;`);

    db.exec(`DROP TABLE IF EXISTS sessions;
      ALTER TABLE offline_minutes RENAME TO offline_v1;
      CREATE TABLE offline_minutes (hotel_id INTEGER NOT NULL, day TEXT NOT NULL, room TEXT NOT NULL, minutes INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (hotel_id, day, room));
      INSERT INTO offline_minutes SELECT 1, day, room, minutes FROM offline_v1;
      DROP TABLE offline_v1;`);

    for (const t of ['devices', 'notices', 'menu_items', 'orders', 'alerts']) {
      if (!cols(t).includes('hotel_id')) db.exec(`ALTER TABLE ${t} ADD COLUMN hotel_id INTEGER NOT NULL DEFAULT 1`);
    }
    if (!cols('audit_log').includes('hotel_id')) db.exec('ALTER TABLE audit_log ADD COLUMN hotel_id INTEGER');
    db.exec('UPDATE audit_log SET hotel_id = 1');

    for (const k of ['content', 'tv']) {
      const v = getKv(db, k);
      if (v) { setKv(db, `${k}:1`, v); db.prepare('DELETE FROM kv WHERE key = ?').run(k); }
    }
    db.exec('COMMIT;');
  } catch (e) {
    db.exec('ROLLBACK;');
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

export const DEFAULT_CONTENT = {
  hotelName: { bn: 'হোটেল সোনারগাঁও প্যালেস', en: 'Sonargaon Palace Hotel' },
  welcome: { bn: 'আপনার থাকা আনন্দময় হোক', en: 'We hope you enjoy your stay' },
  logo: '',
  background: '',
  wifi: { ssid: 'Hotel-Guest', password: 'welcome123' },
  receptionPhone: '0',
  checkoutTime: '12:00',
  services: [
    { icon: '🍽', name: { bn: 'রেস্টুরেন্ট', en: 'Restaurant' }, hours: '07:00 – 23:00', note: { bn: 'নিচতলা', en: 'Ground floor' } },
    { icon: '🏊', name: { bn: 'সুইমিং পুল', en: 'Swimming pool' }, hours: '06:00 – 21:00', note: { bn: 'ছাদ', en: 'Rooftop' } },
    { icon: '🏋', name: { bn: 'জিম', en: 'Gym' }, hours: '24 ঘণ্টা / 24 hours', note: { bn: '২য় তলা', en: '2nd floor' } },
    { icon: '💆', name: { bn: 'স্পা', en: 'Spa' }, hours: '10:00 – 20:00', note: { bn: 'আগে বুকিং দিন', en: 'Booking required' } },
    { icon: '👕', name: { bn: 'লন্ড্রি', en: 'Laundry' }, hours: '08:00 – 18:00', note: { bn: 'রিসেপশনে ফোন করুন', en: 'Call reception' } }
  ],
  nearby: [
    { icon: '🏛', name: { bn: 'জাতীয় জাদুঘর', en: 'National Museum' }, distance: '2.5 km' },
    { icon: '🛍', name: { bn: 'বসুন্ধরা সিটি', en: 'Bashundhara City' }, distance: '1.8 km' },
    { icon: '🏥', name: { bn: 'স্কয়ার হাসপাতাল', en: 'Square Hospital' }, distance: '1.2 km' },
    { icon: '🌳', name: { bn: 'রমনা পার্ক', en: 'Ramna Park' }, distance: '3.0 km' }
  ],
  liveTv: { mode: 'tuner', package: '', channels: [] }
};

export const DEFAULT_TV_SETTINGS = {
  pin: '1234',
  combo: ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'],
  maxVolume: 80,
  clearPackages: ['com.netflix.ninja', 'com.google.android.youtube.tv'],
  kiosk: false
};

const SAMPLE_MENU = [
  ['নাস্তা / Breakfast', 'পরোটা ও ডিম ভাজি', 'Paratha & omelette', 250],
  ['নাস্তা / Breakfast', 'কন্টিনেন্টাল ব্রেকফাস্ট', 'Continental breakfast', 550],
  ['প্রধান খাবার / Mains', 'কাচ্চি বিরিয়ানি', 'Kacchi biryani', 650],
  ['প্রধান খাবার / Mains', 'চিকেন কারি ও ভাত', 'Chicken curry & rice', 480],
  ['প্রধান খাবার / Mains', 'ভেজিটেবল ফ্রাইড রাইস', 'Vegetable fried rice', 380],
  ['পানীয় / Drinks', 'চা', 'Tea', 80],
  ['পানীয় / Drinks', 'কফি', 'Coffee', 150],
  ['পানীয় / Drinks', 'ফ্রেশ জুস', 'Fresh juice', 220]
];

/** Six-character code staff type into a TV to join it to a hotel (no 0/O/1/I to avoid mix-ups). */
export function newHotelCode(db) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    const code = Array.from(crypto.randomBytes(6), (b) => abc[b % abc.length]).join('');
    if (!db.prepare('SELECT 1 FROM hotels WHERE code = ?').get(code)) return code;
  }
}

/** "101-106, 201-206, 301" → [{number:'101', floor:'1'}, …] */
export function parseRooms(spec) {
  const out = [];
  for (const part of String(spec || '').split(/[,\s]+/).filter(Boolean)) {
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    const nums = m ? range(+m[1], +m[2]) : [part];
    for (const n of nums) {
      const s = String(n);
      if (!/^[\w-]{1,10}$/.test(s)) throw Object.assign(new Error(`রুম নম্বর ঠিক নয়: ${s}`), { status: 400, expose: true });
      out.push({ number: s, floor: /^\d{3,4}$/.test(s) ? s.slice(0, s.length - 2) : '' });
    }
  }
  if (out.length > 1000) throw Object.assign(new Error('একবারে ১০০০-এর বেশি রুম নয়'), { status: 400, expose: true });
  return out;
}
const range = (a, b) => (b >= a && b - a < 1000 ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : []);

/** New hotel with its own content, TV settings, rooms and a sample menu. Returns the hotel row. */
export function createHotel(db, { name, rooms = '101-106, 201-206', note = '' }) {
  const now = Date.now();
  const code = newHotelCode(db);
  const id = Number(db.prepare('INSERT INTO hotels (name, code, note, created_at) VALUES (?,?,?,?)').run(name, code, note, now).lastInsertRowid);
  setKv(db, `content:${id}`, { ...DEFAULT_CONTENT, hotelName: { bn: name, en: name } });
  const { pin, ...tv } = DEFAULT_TV_SETTINGS;
  const salt = sha256(crypto.randomBytes(16).toString('hex')).slice(0, 16);
  setKv(db, `tv:${id}`, { ...tv, pinSalt: salt, pinHash: sha256(salt + pin), pinIsDefault: true });
  const insRoom = db.prepare('INSERT OR IGNORE INTO rooms (hotel_id, number, floor) VALUES (?,?,?)');
  for (const r of parseRooms(rooms)) insRoom.run(id, r.number, r.floor);
  const insMenu = db.prepare('INSERT INTO menu_items (hotel_id, category, name_bn, name_en, price, sort) VALUES (?,?,?,?,?,?)');
  SAMPLE_MENU.forEach((m, i) => insMenu.run(id, ...m, i));
  return db.prepare('SELECT * FROM hotels WHERE id = ?').get(id);
}

function seed(db) {
  const now = Date.now();
  if (!db.prepare("SELECT 1 FROM users WHERE role = 'superadmin'").get()) {
    const pw = process.env.ADMIN_PASSWORD || 'admin123';
    const taken = db.prepare("SELECT 1 FROM users WHERE username = 'admin'").get();
    const username = taken ? 'superadmin' : 'admin';
    db.prepare('INSERT INTO users (hotel_id, username, display_name, pass_hash, role, created_at) VALUES (NULL,?,?,?,?,?)')
      .run(username, 'Super Admin', hashPassword(pw), 'superadmin', now);
    console.log(`[seed] সুপার অ্যাডমিন: ${username} / ${process.env.ADMIN_PASSWORD ? '(ADMIN_PASSWORD)' : 'admin123'} — প্রথম লগইনের পর পাসওয়ার্ড বদলান।`);
  }
  if (!db.prepare('SELECT 1 FROM hotels').get()) {
    const h = createHotel(db, { name: 'ডেমো হোটেল', rooms: '101-106, 201-206, 301-306', note: 'পরীক্ষার জন্য' });
    console.log(`[seed] ডেমো হোটেল তৈরি — টিভি কোড: ${h.code}`);
  }
  // Hotels created by older versions may lack settings.
  for (const h of db.prepare('SELECT id, name FROM hotels').all()) {
    if (!getKv(db, `content:${h.id}`)) setKv(db, `content:${h.id}`, { ...DEFAULT_CONTENT, hotelName: { bn: h.name, en: h.name } });
    if (!getKv(db, `tv:${h.id}`)) {
      const { pin, ...tv } = DEFAULT_TV_SETTINGS;
      const salt = sha256(String(Math.random()) + now).slice(0, 16);
      setKv(db, `tv:${h.id}`, { ...tv, pinSalt: salt, pinHash: sha256(salt + pin), pinIsDefault: true });
    }
  }
}

export function getKv(db, key) {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : null;
}

export function setKv(db, key, value) {
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}
