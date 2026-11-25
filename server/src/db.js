import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword, sha256 } from './util.js';

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'hotel.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      pass_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('reception','kitchen','manager','technician')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rooms (
      number TEXT PRIMARY KEY,
      floor TEXT NOT NULL DEFAULT '',
      guest_name TEXT,
      language TEXT NOT NULL DEFAULT 'bn',
      checkin_at INTEGER,
      checkout_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      room TEXT,
      ip TEXT,
      version TEXT,
      model TEXT,
      last_seen INTEGER
    );
    CREATE TABLE IF NOT EXISTS offline_minutes (
      day TEXT NOT NULL,
      room TEXT NOT NULL,
      minutes INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, room)
    );
    CREATE TABLE IF NOT EXISTS notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      at INTEGER NOT NULL,
      username TEXT,
      action TEXT NOT NULL,
      detail TEXT
    );
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      room TEXT,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      seen INTEGER NOT NULL DEFAULT 0
    );
  `);
  seed(db);
  return db;
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

function seed(db) {
  const now = Date.now();
  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (userCount === 0) {
    const pw = process.env.ADMIN_PASSWORD || 'admin123';
    db.prepare('INSERT INTO users (username, display_name, pass_hash, role, created_at) VALUES (?,?,?,?,?)')
      .run('admin', 'Manager', hashPassword(pw), 'manager', now);
    console.log(`[seed] ম্যানেজার ইউজার তৈরি হয়েছে: admin / ${process.env.ADMIN_PASSWORD ? '(ADMIN_PASSWORD)' : 'admin123'} — প্রথম লগইনের পর পাসওয়ার্ড বদলান।`);
  }
  if (!getKv(db, 'content')) setKv(db, 'content', DEFAULT_CONTENT);
  if (!getKv(db, 'tv')) {
    const { pin, ...rest } = DEFAULT_TV_SETTINGS;
    const salt = sha256(String(Math.random()) + now).slice(0, 16);
    setKv(db, 'tv', { ...rest, pinSalt: salt, pinHash: sha256(salt + pin), pinIsDefault: true });
  }
  const roomCount = db.prepare('SELECT COUNT(*) AS n FROM rooms').get().n;
  if (roomCount === 0) {
    const ins = db.prepare('INSERT INTO rooms (number, floor) VALUES (?, ?)');
    for (const floor of [1, 2, 3]) for (let i = 1; i <= 6; i++) ins.run(`${floor}0${i}`, String(floor));
  }
  const menuCount = db.prepare('SELECT COUNT(*) AS n FROM menu_items').get().n;
  if (menuCount === 0) {
    const ins = db.prepare('INSERT INTO menu_items (category, name_bn, name_en, price, sort) VALUES (?,?,?,?,?)');
    [
      ['নাস্তা / Breakfast', 'পরোটা ও ডিম ভাজি', 'Paratha & omelette', 250],
      ['নাস্তা / Breakfast', 'কন্টিনেন্টাল ব্রেকফাস্ট', 'Continental breakfast', 550],
      ['প্রধান খাবার / Mains', 'কাচ্চি বিরিয়ানি', 'Kacchi biryani', 650],
      ['প্রধান খাবার / Mains', 'চিকেন কারি ও ভাত', 'Chicken curry & rice', 480],
      ['প্রধান খাবার / Mains', 'ভেজিটেবল ফ্রাইড রাইস', 'Vegetable fried rice', 380],
      ['পানীয় / Drinks', 'চা', 'Tea', 80],
      ['পানীয় / Drinks', 'কফি', 'Coffee', 150],
      ['পানীয় / Drinks', 'ফ্রেশ জুস', 'Fresh juice', 220]
    ].forEach((r, i) => ins.run(...r, i));
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
