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
  assert.equal(ok.body.user.role, 'manager');
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
  const s201 = srv.roomState('201');
  const s101 = srv.roomState('101');
  assert.equal(s201.notices.length, 1);
  assert.equal(s101.notices.length, 0);
});

test('TV PIN can be changed and the guest screen hash matches', async () => {
  assert.equal((await call('PUT', '/api/tv/settings', { pin: '1234' })).status, 400);
  assert.equal((await call('PUT', '/api/tv/settings', { pin: '4821', maxVolume: 60 })).status, 200);
  const st = srv.roomState('101').tv;
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
