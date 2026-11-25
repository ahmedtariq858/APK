/* Hotel TV Launcher — guest screen.
 * Runs inside the Android WebView (window.Android bridge) or in any browser for testing:
 *   http://<server>:8080/tv/?room=101
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- bridge & config
  const A = window.Android || null;
  // On the TV the cache lives in the app (SharedPreferences), so it is shared between the
  // server copy of this page and the copy built into the APK (different origins).
  const useBridgeStore = !!(A && A.storeGet);
  const store = {
    get(k, d) {
      try {
        const v = useBridgeStore ? A.storeGet(k) : localStorage.getItem('htv.' + k);
        return v == null || v === '' ? d : JSON.parse(v);
      } catch (e) { return d; }
    },
    set(k, v) {
      try { if (useBridgeStore) A.storeSet(k, JSON.stringify(v)); else localStorage.setItem('htv.' + k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ }
    },
    del(k) { try { if (useBridgeStore) A.storeSet(k, ''); else localStorage.removeItem('htv.' + k); } catch (e) { /* ignore */ } }
  };

  function loadConfig() {
    if (A) {
      try { return JSON.parse(A.getConfig()); } catch (e) { /* fall through */ }
    }
    const q = new URLSearchParams(location.search);
    let id = store.get('browserId');
    if (!id) { id = 'browser-' + Math.random().toString(36).slice(2, 10); store.set('browserId', id); }
    return {
      serverUrl: location.protocol.startsWith('http') ? location.origin : '',
      room: q.get('room') || store.get('browserRoom', '101'),
      deviceId: id, versionName: 'web', versionCode: 0, model: navigator.userAgent.slice(0, 60),
      isDeviceOwner: false, ip: ''
    };
  }
  let cfg = loadConfig();
  const apiBase = () => (cfg.serverUrl || '').replace(/\/+$/, '');

  // ---------------------------------------------------------------- i18n
  const T = {
    bn: {
      welcome: 'স্বাগতম', guestDefault: 'সম্মানিত অতিথি', room: 'রুম', wifi: 'Wi-Fi', password: 'পাসওয়ার্ড',
      checkout: 'চেক-আউট', liveTv: 'লাইভ টিভি', roomService: 'রুম সার্ভিস', services: 'হোটেল সেবা',
      nearby: 'আশপাশে ঘুরুন', language: 'English', settings: 'সেটিংস', back: 'Back চাপলে ফিরে যাবেন',
      notice: 'নোটিশ', ok: 'ঠিক আছে', cart: 'আপনার অর্ডার', total: 'মোট', send: 'অর্ডার পাঠান',
      emptyCart: 'খাবার বেছে + চাপুন', myOrders: 'আগের অর্ডার', noOrders: 'এখনো কোনো অর্ডার নেই',
      unavailable: 'এখন পাওয়া যাচ্ছে না', sent: 'অর্ডার পাঠানো হয়েছে', queued: 'সংযোগ নেই — সংযোগ ফিরলে অর্ডার নিজে চলে যাবে',
      st_new: 'নতুন', st_preparing: 'তৈরি হচ্ছে', st_delivered: 'পৌঁছানো হয়েছে', st_cancelled: 'বাতিল', st_pending: 'পাঠানোর অপেক্ষায়',
      reception: 'রিসেপশন', distance: 'দূরত্ব', noApp: 'এই টিভিতে অ্যাপটি পাওয়া যায়নি',
      pinTitle: 'টিভি-অ্যাডমিন', pinHint: '৪ অঙ্কের পিন দিন', pinWrong: 'পিন ভুল — আর {n} বার চেষ্টা করা যাবে',
      pinLocked: '৫ বার ভুল হয়েছে। {m} মিনিট পরে আবার চেষ্টা করুন', channels: 'চ্যানেল', noChannels: 'কোনো চ্যানেল যোগ করা হয়নি',
      clearItem: 'বাদ'
    },
    en: {
      welcome: 'Welcome', guestDefault: 'Valued Guest', room: 'Room', wifi: 'Wi-Fi', password: 'Password',
      checkout: 'Check-out', liveTv: 'Live TV', roomService: 'Room Service', services: 'Hotel Services',
      nearby: 'Explore Nearby', language: 'বাংলা', settings: 'Settings', back: 'Press Back to return',
      notice: 'Notice', ok: 'OK', cart: 'Your order', total: 'Total', send: 'Place order',
      emptyCart: 'Pick a dish and press +', myOrders: 'Earlier orders', noOrders: 'No orders yet',
      unavailable: 'Not available now', sent: 'Order sent', queued: 'Offline — the order will be sent when the connection returns',
      st_new: 'New', st_preparing: 'Preparing', st_delivered: 'Delivered', st_cancelled: 'Cancelled', st_pending: 'Waiting to send',
      reception: 'Reception', distance: 'Distance', noApp: 'This app is not installed on the TV',
      pinTitle: 'TV admin', pinHint: 'Enter the 4-digit PIN', pinWrong: 'Wrong PIN — {n} tries left',
      pinLocked: 'Locked after 5 wrong tries. Try again in {m} min', channels: 'Channels', noChannels: 'No channels added',
      clearItem: 'Remove'
    }
  };
  let lang = store.get('lang', 'bn');
  const t = (k, vars) => {
    let s = (T[lang] && T[lang][k]) || T.bn[k] || k;
    if (vars) for (const v in vars) s = s.replace('{' + v + '}', vars[v]);
    return s;
  };
  const tr = (obj) => (obj == null ? '' : typeof obj === 'string' ? obj : (obj[lang] || obj.bn || obj.en || ''));
  const BN = '০১২৩৪৫৬৭৮৯';
  const num = (n) => (lang === 'bn' ? String(n).replace(/\d/g, (d) => BN[d]) : String(n));
  const taka = (n) => '৳ ' + num(Number(n).toLocaleString('en-IN'));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const abs = (u) => (!u ? '' : /^(https?:|data:)/.test(u) ? u : apiBase() + u);

  // ---------------------------------------------------------------- state
  let state = store.get('state', null);
  let serverOffset = 0;
  const now = () => Date.now() + serverOffset;
  let cart = {};               // menuId -> qty
  let outbox = store.get('outbox', []);
  let dismissed = store.get('dismissed', []);

  // ---------------------------------------------------------------- dom helpers
  const $ = (s, el = document) => el.querySelector(s);
  const homeEl = $('#home'), viewEl = $('#view'), popupEl = $('#popup');
  let viewName = null;
  let viewRender = null;

  function toast(msg, ms = 3500) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.add('hidden'), ms);
  }

  // ---------------------------------------------------------------- spatial navigation
  const activeLayer = () => (!popupEl.classList.contains('hidden') ? popupEl : !viewEl.classList.contains('hidden') ? viewEl : homeEl);
  const focusables = () => Array.from(activeLayer().querySelectorAll('.f')).filter((e) => !e.disabled && e.offsetParent !== null);
  let focused = null;
  function setFocus(el) {
    if (!el) return;
    if (focused) focused.classList.remove('focus');
    focused = el;
    el.classList.add('focus');
    if (el.tagName === 'INPUT') el.focus(); else if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function ensureFocus(preferSel) {
    const list = focusables();
    if (focused && list.includes(focused)) return;
    const pref = preferSel && activeLayer().querySelector(preferSel);
    setFocus(pref && list.includes(pref) ? pref : list[0]);
  }
  function move(dir) {
    const list = focusables();
    if (!focused || !list.includes(focused)) return ensureFocus();
    const a = focused.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, bestScore = Infinity;
    for (const el of list) {
      if (el === focused) continue;
      const b = el.getBoundingClientRect();
      const bx = b.left + b.width / 2, by = b.top + b.height / 2;
      const dx = bx - ax, dy = by - ay;
      let primary, cross;
      if (dir === 'left') { if (b.right > a.left + 2) continue; primary = -dx; cross = Math.abs(dy); }
      else if (dir === 'right') { if (b.left < a.right - 2) continue; primary = dx; cross = Math.abs(dy); }
      else if (dir === 'up') { if (b.bottom > a.top + 2) continue; primary = -dy; cross = Math.abs(dx); }
      else { if (b.top < a.bottom - 2) continue; primary = dy; cross = Math.abs(dx); }
      const score = primary + cross * 2.5;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) setFocus(best);
  }

  // ---------------------------------------------------------------- home
  const TILES = [
    { id: 'livetv', ic: '📺', k: 'liveTv' },
    { id: 'youtube', ic: '▶️', label: 'YouTube' },
    { id: 'netflix', ic: '🎬', label: 'Netflix' },
    { id: 'roomservice', ic: '🍽', k: 'roomService' },
    { id: 'services', ic: '🛎', k: 'services' },
    { id: 'nearby', ic: '🗺', k: 'nearby' },
    { id: 'lang', ic: '🌐', k: 'language' },
    { id: 'settings', ic: '⚙', k: 'settings' }
  ];

  function fmtTime(ts) {
    const d = new Date(ts);
    return num(d.toLocaleTimeString(lang === 'bn' ? 'en-GB' : 'en-US', { hour: '2-digit', minute: '2-digit' }));
  }
  function fmtDate(ts, withTime) {
    const d = new Date(ts);
    const s = d.toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    return withTime ? s + ', ' + fmtTime(ts) : s;
  }

  function renderHome() {
    const c = (state && state.content) || {};
    const g = state && state.guest;
    const active = (state && state.orders || []).filter((o) => o.status === 'new' || o.status === 'preparing').length
      + outbox.length;
    const checkout = g && g.checkoutAt ? fmtDate(g.checkoutAt, true) : (c.checkoutTime ? num(c.checkoutTime) : '—');
    homeEl.innerHTML = `
      <div class="top">
        <div class="brand">${c.logo ? `<img src="${esc(abs(c.logo))}" alt="">` : ''}<div class="name">${esc(tr(c.hotelName) || 'Hotel')}</div></div>
        <div class="clock"><div class="time" id="clk-t"></div><div class="date" id="clk-d"></div></div>
      </div>
      <div class="welcome">
        <div class="hello">${esc(t('welcome'))}</div>
        <h1>${esc(g ? g.name : t('guestDefault'))}</h1>
        <p>${esc(tr(c.welcome))}</p>
        <div class="chips">
          <div class="chip"><div class="k">${t('room')}</div><div class="v">${esc(num(cfg.room || '—'))}</div></div>
          ${c.wifi && c.wifi.ssid ? `<div class="chip"><div class="k">${t('wifi')}</div><div class="v">${esc(c.wifi.ssid)}</div></div>
          <div class="chip"><div class="k">${t('password')}</div><div class="v">${esc(c.wifi.password || '—')}</div></div>` : ''}
          <div class="chip"><div class="k">${t('checkout')}</div><div class="v">${esc(checkout)}</div></div>
        </div>
      </div>
      <div class="tiles">
        ${TILES.map((x) => `<button class="tile f" data-tile="${x.id}">
          ${x.id === 'roomservice' && active ? `<span class="badge">${num(active)}</span>` : ''}
          <span class="ic">${x.ic}</span><span class="lb">${esc(x.label || t(x.k))}</span></button>`).join('')}
      </div>`;
    const bg = $('#bg');
    if (c.background) { bg.style.backgroundImage = `url("${abs(c.background)}")`; bg.classList.add('has-image'); }
    else { bg.style.backgroundImage = ''; bg.classList.remove('has-image'); }
    tickClock();
    const prev = focused && focused.dataset && focused.dataset.tile;
    focused = null;
    if (activeLayer() === homeEl) ensureFocus(prev ? `[data-tile="${prev}"]` : '[data-tile="livetv"]');
  }

  function tickClock() {
    const tEl = $('#clk-t'), dEl = $('#clk-d');
    if (tEl) tEl.textContent = fmtTime(now());
    if (dEl) dEl.textContent = fmtDate(now());
  }

  // ---------------------------------------------------------------- views
  function openView(name, render) {
    viewName = name;
    viewRender = render;
    viewEl.classList.remove('hidden');
    focused = null;
    render();
    ensureFocus();
  }
  function rerenderView(keepSel) {
    if (!viewRender) return;
    const sel = keepSel || (focused && focused.dataset.key ? `[data-key="${focused.dataset.key}"]` : null);
    viewRender();
    focused = null;
    ensureFocus(sel);
  }
  function closeView() {
    viewEl.classList.add('hidden');
    viewEl.innerHTML = '';
    viewName = null; viewRender = null;
    clearTimeout(pinIdle);
    focused = null;
    ensureFocus('[data-tile="livetv"]');
  }
  const head = (title) => `<div class="view-head"><h2>${esc(title)}</h2><div class="hint">${esc(t('back'))}</div></div>`;

  function launch(pkg) {
    if (A && A.launchApp(pkg)) return;
    toast(t('noApp'));
  }

  function openLiveTv() {
    const lt = (state && state.content && state.content.liveTv) || { mode: 'tuner' };
    if (lt.mode === 'iptv') {
      openView('livetv', () => {
        const ch = lt.channels || [];
        viewEl.innerHTML = head(t('liveTv')) + `<div class="view-body"><div class="scroll"><div class="cards">
          ${ch.length ? ch.map((c, i) => `<button class="card f" data-key="ch${i}" data-act="play" data-i="${i}">
            <span class="ic">📡</span><span><div class="t">${num(i + 1)}. ${esc(c.name)}</div></span></button>`).join('')
            : `<div class="empty">${t('noChannels')}</div>`}</div></div></div>`;
      });
      return;
    }
    if (A && A.openLiveTv(lt.package || '')) return;
    toast(t('noApp'));
  }

  function playChannel(i) {
    const ch = state.content.liveTv.channels[i];
    const v = $('#player');
    v.src = ch.url;
    v.classList.remove('hidden');
    v.play().catch(() => toast(t('noApp')));
    playing = true;
  }
  let playing = false;
  function stopPlayer() {
    const v = $('#player');
    v.pause(); v.removeAttribute('src'); v.load();
    v.classList.add('hidden');
    playing = false;
  }

  function openServices() {
    openView('services', () => {
      const c = state && state.content || {};
      viewEl.innerHTML = head(t('services')) + `<div class="view-body"><div class="scroll"><div class="cards">
        ${(c.services || []).map((s, i) => `<div class="card f" data-key="s${i}" tabindex="-1">
          <span class="ic">${esc(s.icon || '•')}</span>
          <span><div class="t">${esc(tr(s.name))}</div><div class="s">${esc(tr(s.note))}</div></span>
          <span class="big">${esc(num(s.hours || ''))}</span></div>`).join('')}
        <div class="card f" data-key="rec" tabindex="-1"><span class="ic">☎</span><span><div class="t">${t('reception')}</div></span>
          <span class="big">${esc(num(c.receptionPhone || ''))}</span></div>
      </div></div></div>`;
    });
  }

  function openNearby() {
    openView('nearby', () => {
      const c = state && state.content || {};
      viewEl.innerHTML = head(t('nearby')) + `<div class="view-body"><div class="scroll"><div class="cards">
        ${(c.nearby || []).map((s, i) => `<div class="card f" data-key="n${i}" tabindex="-1">
          <span class="ic">${esc(s.icon || '📍')}</span>
          <span><div class="t">${esc(tr(s.name))}</div><div class="s">${esc(tr(s.note))}</div></span>
          <span class="big">${esc(num(s.distance || ''))}</span></div>`).join('')}
      </div></div></div>`;
    });
  }

  // ---------------------------------------------------------------- room service
  const menuById = (id) => (state && state.menu || []).find((m) => m.id === Number(id));
  function cartLines() {
    return Object.entries(cart).filter(([, q]) => q > 0).map(([id, q]) => ({ item: menuById(id), qty: q })).filter((l) => l.item);
  }
  function allOrders() {
    const pend = outbox.filter((o) => o.room === cfg.room).map((o) => ({
      id: o.clientId, status: 'pending', items: o.items.map((i) => { const m = menuById(i.id) || {}; return { ...i, name_bn: m.name_bn, name_en: m.name_en, price: m.price || 0 }; }),
      total: o.items.reduce((s, i) => s + ((menuById(i.id) || {}).price || 0) * i.qty, 0), created_at: o.createdAt
    }));
    return pend.concat((state && state.orders) || []);
  }

  function openRoomService() {
    openView('roomservice', () => {
      const menu = (state && state.menu) || [];
      const cats = [];
      for (const m of menu) { if (!cats.includes(m.category)) cats.push(m.category); }
      const lines = cartLines();
      const total = lines.reduce((s, l) => s + l.item.price * l.qty, 0);
      const orders = allOrders();
      viewEl.innerHTML = head(t('roomService')) + `<div class="view-body">
        <div class="scroll">
          ${cats.map((cat) => `<div class="cat">${esc(cat)}</div>` + menu.filter((m) => m.category === cat).map((m) => `
            <div class="item ${m.available ? '' : 'na'}">
              ${m.image ? `<img src="${esc(abs(m.image))}" alt="">` : ''}
              <div class="nm"><div class="t">${esc(lang === 'en' && m.name_en ? m.name_en : m.name_bn)}</div>
                <div class="s">${esc(m.available ? (lang === 'en' ? m.description_en : m.description_bn) || '' : t('unavailable'))}</div></div>
              <div class="price">${taka(m.price)}</div>
              <div class="qty">
                <button class="btn sq f" data-key="m${m.id}-" data-act="dec" data-id="${m.id}" ${m.available && cart[m.id] ? '' : 'disabled'}>−</button>
                <span class="n">${num(cart[m.id] || 0)}</span>
                <button class="btn sq f" data-key="m${m.id}+" data-act="inc" data-id="${m.id}" ${m.available ? '' : 'disabled'}>+</button>
              </div>
            </div>`).join('')).join('')}
        </div>
        <div class="side">
          <div class="box"><h3>${t('cart')}</h3>
            ${lines.length ? lines.map((l) => `<div class="line"><b>${num(l.qty)} × ${esc(lang === 'en' && l.item.name_en ? l.item.name_en : l.item.name_bn)}</b><span>${taka(l.item.price * l.qty)}</span></div>`).join('')
              : `<div class="empty">${t('emptyCart')}</div>`}
            <div class="total"><span>${t('total')}</span><span>${taka(total)}</span></div>
            <div style="margin-top:2vh"><button class="btn primary f" data-key="send" data-act="send" ${lines.length && state && state.guest ? '' : 'disabled'}>${t('send')}</button></div>
          </div>
          <div class="box scroll" style="flex:1"><h3>${t('myOrders')}</h3>
            ${orders.length ? orders.slice(0, 8).map((o) => `<div class="line"><b>${o.items.map((i) => num(i.qty) + '× ' + esc(lang === 'en' && i.name_en ? i.name_en : i.name_bn)).join(', ')}</b>
              <span class="status st-${o.status}">${t('st_' + o.status)}</span></div>`).join('') : `<div class="empty">${t('noOrders')}</div>`}
          </div>
        </div></div>`;
    });
  }

  function placeOrder() {
    const lines = cartLines();
    if (!lines.length || !state || !state.guest) return;
    const order = {
      clientId: cfg.deviceId + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      room: cfg.room, items: lines.map((l) => ({ id: l.item.id, qty: l.qty })), createdAt: Date.now()
    };
    outbox.push(order);
    store.set('outbox', outbox);
    cart = {};
    rerenderView('[data-key="send"]');
    flushOutbox().then((sentAll) => toast(sentAll ? t('sent') : t('queued')));
  }

  let flushing = false;
  async function flushOutbox() {
    if (flushing || !apiBase()) return outbox.length === 0;
    flushing = true;
    try {
      while (outbox.length) {
        const o = outbox[0];
        let res;
        try {
          res = await fetch(apiBase() + '/api/tv/orders', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(o)
          });
        } catch (e) { return false; } // network down — keep in outbox
        if (!res.ok && res.status >= 500) return false;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          toast(body.error || 'Error');
        }
        outbox.shift();
        store.set('outbox', outbox);
      }
      return true;
    } finally {
      flushing = false;
      if (viewName === 'roomservice') rerenderView();
      else if (!viewName) renderHome();
    }
  }

  // ---------------------------------------------------------------- PIN + TV admin
  const LOCK_MS = 5 * 60 * 1000;
  let pinEntry = '';
  let pinIdle = null;
  function resetPinIdle() {
    clearTimeout(pinIdle);
    pinIdle = setTimeout(() => { if (viewName === 'pin') closeView(); }, 30000);
  }

  function openPin() {
    // Before the TV is set up (no room or never synced) staff get straight in.
    if (!cfg.room || !state || !state.tv) return openTvAdmin();
    pinEntry = '';
    openView('pin', renderPin);
    resetPinIdle();
  }
  function renderPin(msg, err) {
    const lock = store.get('pinLock', { fails: 0, until: 0 });
    const locked = lock.until > Date.now();
    viewEl.innerHTML = `<div class="pin">
      <h2>${t('pinTitle')}</h2>
      <div class="s ${err || locked ? 'err' : ''}">${esc(locked ? t('pinLocked', { m: num(Math.ceil((lock.until - Date.now()) / 60000)) }) : (msg || t('pinHint')))}</div>
      <div class="dots">${[0, 1, 2, 3].map((i) => `<span class="${i < pinEntry.length ? 'on' : ''}"></span>`).join('')}</div>
      <div class="pad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'].map((k) =>
        `<button class="btn f" data-key="p${k}" data-act="pin" data-k="${k}" ${locked ? 'disabled' : ''}>${k}</button>`).join('')}</div>
    </div>`;
  }
  function pinKey(k) {
    resetPinIdle();
    const lock = store.get('pinLock', { fails: 0, until: 0 });
    if (lock.until > Date.now()) return;
    if (k === '⌫') pinEntry = pinEntry.slice(0, -1);
    else if (k === 'OK') { /* handled below */ }
    else if (pinEntry.length < 4) pinEntry += k;
    if (pinEntry.length === 4 || (k === 'OK' && pinEntry.length)) {
      const ok = sha256(state.tv.pinSalt + pinEntry) === state.tv.pinHash;
      pinEntry = '';
      if (ok) { store.set('pinLock', { fails: 0, until: 0 }); return openTvAdmin(); }
      lock.fails++;
      if (lock.fails >= 5) {
        lock.until = Date.now() + LOCK_MS; lock.fails = 0;
        reportAlert('pin_lockout');
      }
      store.set('pinLock', lock);
      viewRender = () => renderPin(t('pinWrong', { n: num(5 - lock.fails) }), true);
      return rerenderView();
    }
    viewRender = () => renderPin();
    rerenderView();
  }

  function reportAlert(kind, message) {
    if (!apiBase()) return;
    fetch(apiBase() + '/api/tv/alert', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: cfg.room, kind, message })
    }).catch(() => {});
  }

  function openTvAdmin() {
    clearTimeout(pinIdle);
    openView('tvadmin', renderTvAdmin);
  }
  function renderTvAdmin(msg) {
    const info = A ? safeJson(A.getAppInfo()) : {};
    const lastSync = store.get('lastSync', 0);
    viewEl.innerHTML = `${head('টিভি-অ্যাডমিন · TV admin')}
      <div class="form">
        <div class="field"><label>রুম নম্বর · Room</label><input class="f" data-key="room" id="in-room" value="${esc(cfg.room || '')}" inputmode="numeric"></div>
        <div class="field"><label>সার্ভারের ঠিকানা · Server</label><input class="f" data-key="srv" id="in-srv" value="${esc(cfg.serverUrl || '')}" placeholder="http://192.168.1.10:8080"></div>
      </div>
      <div class="actions">
        <button class="btn primary f" data-key="save" data-act="save">সেভ ও সংযোগ পরীক্ষা</button>
        <button class="btn f" data-key="net" data-act="net">Wi-Fi / LAN</button>
        <button class="btn f" data-key="set" data-act="settings">টিভির সেটিংস</button>
        <button class="btn f" data-key="reload" data-act="reload">পেজ রিলোড</button>
        <button class="btn danger f" data-key="exit" data-act="exit">অ্যাপ থেকে বের হন</button>
        <button class="btn danger f" data-key="disable" data-act="disable">স্থায়ীভাবে লঞ্চার বন্ধ</button>
        ${info.homeEnabled === false ? '<button class="btn f" data-key="enable" data-act="enable">লঞ্চার আবার চালু</button>' : ''}
      </div>
      <div class="info">${msg ? `<div style="color:var(--gold)">${esc(msg)}</div>` : ''}
        ভার্সন: ${esc(cfg.versionName)} (${esc(cfg.versionCode)}) · আইপি: ${esc(info.ip || cfg.ip || '—')} · ডিভাইস: ${esc(cfg.deviceId)}<br>
        শেষ সিঙ্ক: ${lastSync ? esc(new Date(lastSync).toLocaleString('en-GB')) : '—'} · সংযোগ: ${wsOk ? 'WebSocket' : (lastPollOk ? 'polling' : 'নেই')}
        · Device Owner: ${info.isDeviceOwner ? 'হ্যাঁ' : 'না'} · ${esc(info.model || '')} · Android ${esc(info.sdk || '')}
      </div>`;
  }
  const safeJson = (s) => { try { return JSON.parse(s); } catch (e) { return {}; } };

  async function saveTvConfig() {
    const room = $('#in-room').value.trim();
    let srv = $('#in-srv').value.trim().replace(/\/+$/, '');
    if (srv && !/^https?:\/\//.test(srv)) srv = 'http://' + srv;
    if (srv && !/:\d+$/.test(srv.replace(/^https?:\/\//, ''))) srv += ':8080';
    let msg;
    try {
      const r = await fetch(srv + '/api/tv/state?room=' + encodeURIComponent(room) + '&device=' + encodeURIComponent(cfg.deviceId), { cache: 'no-store' });
      const s = await r.json();
      msg = r.ok ? (s.known ? `✔ সংযোগ ঠিক আছে — রুম ${room} সার্ভারে আছে` : `⚠ সংযোগ ঠিক আছে, কিন্তু রুম ${room} সার্ভারের তালিকায় নেই`) : '✖ সার্ভার উত্তর দিয়েছে: ' + (s.error || r.status);
    } catch (e) { msg = '✖ সার্ভারে পৌঁছানো যায়নি: ' + srv; }
    cfg.room = room; cfg.serverUrl = srv;
    if (A) A.setConfig(JSON.stringify({ room, serverUrl: srv }));
    else store.set('browserRoom', room);
    reconnect();
    viewRender = () => renderTvAdmin(msg);
    rerenderView('[data-key="save"]');
  }

  // ---------------------------------------------------------------- popups & ticker
  function renderNotices() {
    const list = (state && state.notices) || [];
    const ticker = list.filter((n) => n.style === 'ticker').map((n) => tr(n.text)).filter(Boolean);
    const tk = $('#ticker');
    if (ticker.length) {
      const text = ticker.join('     ✦     ');
      $('.ticker-label', tk).textContent = t('notice');
      const span = $('#ticker-text');
      if (span.textContent !== text) {
        span.textContent = text;
        span.style.setProperty('--dur', Math.max(15, text.length * 0.25) + 's');
      }
      tk.classList.remove('hidden');
    } else tk.classList.add('hidden');
    showNextPopup();
  }
  function showNextPopup() {
    if (!popupEl.classList.contains('hidden')) return;
    const n = ((state && state.notices) || []).find((x) => x.style === 'popup' && !dismissed.includes(x.id));
    if (!n) return;
    popupEl.innerHTML = `<div class="notice-card"><div class="tag">${t('notice')}</div><p>${esc(tr(n.text))}</p>
      <button class="btn primary f" data-act="dismiss" data-id="${n.id}">${t('ok')}</button></div>`;
    popupEl.classList.remove('hidden');
    focused = null;
    ensureFocus();
  }
  function dismissPopup(id) {
    dismissed.push(Number(id));
    dismissed = dismissed.slice(-100);
    store.set('dismissed', dismissed);
    popupEl.classList.add('hidden');
    popupEl.innerHTML = '';
    focused = null;
    ensureFocus();
    showNextPopup();
  }

  // ---------------------------------------------------------------- actions
  function activate(el) {
    if (!el) return;
    if (el.tagName === 'INPUT') { el.focus(); return; }
    const tile = el.dataset.tile;
    if (tile) {
      if (tile === 'livetv') openLiveTv();
      else if (tile === 'youtube') launch('com.google.android.youtube.tv');
      else if (tile === 'netflix') launch('com.netflix.ninja');
      else if (tile === 'roomservice') openRoomService();
      else if (tile === 'services') openServices();
      else if (tile === 'nearby') openNearby();
      else if (tile === 'lang') { lang = lang === 'bn' ? 'en' : 'bn'; store.set('lang', lang); document.documentElement.lang = lang; renderAll(); }
      else if (tile === 'settings') openPin();
      return;
    }
    const act = el.dataset.act;
    if (act === 'inc' || act === 'dec') {
      const id = Number(el.dataset.id);
      cart[id] = Math.max(0, Math.min(20, (cart[id] || 0) + (act === 'inc' ? 1 : -1)));
      rerenderView(cart[id] === 0 && act === 'dec' ? `[data-key="m${id}+"]` : null);
    } else if (act === 'send') placeOrder();
    else if (act === 'pin') pinKey(el.dataset.k);
    else if (act === 'dismiss') dismissPopup(el.dataset.id);
    else if (act === 'play') playChannel(Number(el.dataset.i));
    else if (act === 'save') saveTvConfig();
    else if (act === 'net') { if (!(A && A.openNetworkSettings())) toast('শুধু টিভিতে কাজ করে'); }
    else if (act === 'settings') { if (!(A && A.openSettings())) toast('শুধু টিভিতে কাজ করে'); }
    else if (act === 'reload') location.reload();
    else if (act === 'exit') { reportAlert('exit', 'অ্যাপ থেকে বের হওয়া (টিভি রিস্টার্টে ফিরবে)'); if (!(A && A.exitLauncher())) toast('শুধু টিভিতে কাজ করে'); }
    else if (act === 'disable') { reportAlert('exit', 'লঞ্চার স্থায়ীভাবে বন্ধ করা হয়েছে'); if (!(A && A.disableLauncherPermanently())) toast('শুধু টিভিতে কাজ করে'); }
    else if (act === 'enable') { if (A) A.enableLauncher(); viewRender = () => renderTvAdmin('লঞ্চার আবার Home অ্যাপ হিসেবে চালু হয়েছে'); rerenderView(); }
  }

  function back() {
    if (playing) { stopPlayer(); return true; }
    if (!popupEl.classList.contains('hidden')) { const b = popupEl.querySelector('[data-act="dismiss"]'); if (b) dismissPopup(b.dataset.id); return true; }
    if (viewName) { closeView(); return true; }
    return false; // already home: do nothing (the guest cannot leave)
  }
  function goHome() {
    if (playing) stopPlayer();
    if (viewName) closeView();
    ensureFocus('[data-tile="livetv"]');
  }

  // ---------------------------------------------------------------- keys
  let seq = [];
  document.addEventListener('keydown', (e) => {
    const k = e.key;
    const inInput = document.activeElement && document.activeElement.tagName === 'INPUT';
    const combo = (state && state.tv && state.tv.combo) || ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'];
    if (!viewName && popupEl.classList.contains('hidden')) {
      seq.push(k === 'Select' ? 'Enter' : k);
      seq = seq.slice(-combo.length);
      if (seq.join() === combo.join()) { seq = []; e.preventDefault(); openPin(); return; }
    }
    if (viewName === 'pin' && /^\d$/.test(k)) { e.preventDefault(); pinKey(k); return; }
    switch (k) {
      case 'ArrowUp': e.preventDefault(); move('up'); break;
      case 'ArrowDown': e.preventDefault(); move('down'); break;
      case 'ArrowLeft': if (inInput) return; e.preventDefault(); move('left'); break;
      case 'ArrowRight': if (inInput) return; e.preventDefault(); move('right'); break;
      case 'Enter': case 'Select': case ' ':
        if (inInput && k === ' ') return;
        e.preventDefault();
        if (inInput) { document.activeElement.blur(); move('down'); } else activate(focused);
        break;
      case 'Escape': case 'GoBack': case 'BrowserBack':
        e.preventDefault(); back(); break;
      case 'Backspace':
        if (inInput) return;
        e.preventDefault(); back(); break;
      default:
    }
    if (viewName === 'pin') resetPinIdle();
  });
  document.addEventListener('click', (e) => {
    const el = e.target.closest('.f');
    if (el) { setFocus(el); activate(el); }
  });

  // ---------------------------------------------------------------- sync with server
  let ws = null, wsOk = false, lastPollOk = false, reconnectTimer = null;

  function wsUrl() {
    const q = new URLSearchParams({ room: cfg.room, device: cfg.deviceId, version: String(cfg.versionName || ''), model: String(cfg.model || '') });
    return apiBase().replace(/^http/, 'ws') + '/ws/tv?' + q;
  }
  function connect() {
    clearTimeout(reconnectTimer);
    if (!apiBase() || !cfg.room) { setConn(); return; }
    try { ws = new WebSocket(wsUrl()); } catch (e) { reconnectTimer = setTimeout(connect, 10000); return; }
    const me = ws;
    ws.onopen = () => { wsOk = true; setConn(); flushOutbox(); };
    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'state') applyState(msg.state);
      else if (msg.type === 'command') runCommand(msg);
    };
    ws.onclose = () => {
      if (me !== ws) return;
      wsOk = false; setConn();
      reconnectTimer = setTimeout(connect, 5000);
    };
    ws.onerror = () => {};
  }
  function reconnect() {
    if (ws) { const old = ws; ws = null; try { old.close(); } catch (e) { /* ignore */ } }
    wsOk = false;
    connect();
    poll();
  }
  async function poll() {
    if (!apiBase() || !cfg.room) return;
    try {
      const q = new URLSearchParams({ room: cfg.room, device: cfg.deviceId, version: String(cfg.versionName || ''), model: String(cfg.model || '') });
      const r = await fetch(apiBase() + '/api/tv/state?' + q, { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      const s = await r.json();
      lastPollOk = true;
      applyState(s);
      for (const c of s.commands || []) runCommand(c);
      flushOutbox();
    } catch (e) { lastPollOk = false; }
    setConn();
  }
  function setConn() {
    const el = $('#conn');
    el.className = wsOk || lastPollOk ? 'on' : (apiBase() ? 'off' : '');
  }

  function applyState(s) {
    if (!s || String(s.room) !== String(cfg.room)) return;
    const prevGuestKey = state && state.guest ? state.guest.name + '|' + state.guest.checkinAt : '';
    const nextGuestKey = s.guest ? s.guest.name + '|' + s.guest.checkinAt : '';
    serverOffset = (s.serverTime || Date.now()) - Date.now();
    state = s;
    store.set('state', s);
    store.set('lastSync', Date.now());
    if (prevGuestKey !== nextGuestKey) {
      // New guest (or check-out): fresh cart, language from check-in, popups shown again.
      cart = {};
      dismissed = [];
      store.set('dismissed', dismissed);
      lang = (s.guest && s.guest.language) || 'bn';
      store.set('lang', lang);
    }
    if (A && s.tv) {
      try { A.applyTvSettings(JSON.stringify({ maxVolume: s.tv.maxVolume, kiosk: s.tv.kiosk })); } catch (e) { /* older APK */ }
    }
    // Loaded from the APK's built-in copy (server was down at boot)? Switch to the live page.
    if (A && location.protocol === 'file:' && apiBase() && !switchedToServer) {
      switchedToServer = true;
      location.replace(apiBase() + '/tv/');
      return;
    }
    renderAll();
  }
  let switchedToServer = false;

  function renderAll() {
    document.documentElement.lang = lang;
    renderHome();
    if (viewRender && viewName !== 'pin' && viewName !== 'tvadmin') rerenderView();
    renderNotices();
  }

  function runCommand(c) {
    let ok = true, message = '';
    try {
      if (c.command === 'reload') { setTimeout(() => location.reload(), 300); }
      else if (c.command === 'restart') { if (A) setTimeout(() => A.restartApp(), 300); else setTimeout(() => location.reload(), 300); }
      else if (c.command === 'update') {
        if (!A) { ok = false; message = 'browser'; }
        else if (Number(c.args.versionCode) <= Number(cfg.versionCode)) { message = 'already up to date'; }
        else message = A.installUpdate(abs(c.args.url), Number(c.args.versionCode), c.args.sha256 || '');
      } else if (c.command === 'clearGuestData') {
        cart = {}; dismissed = []; store.set('dismissed', dismissed);
        outbox = outbox.filter((o) => o.room !== cfg.room); store.set('outbox', outbox);
        if (A) { message = A.clearGuestData(JSON.stringify(c.args.packages || [])); ok = message === 'ok'; }
        else { ok = false; message = 'browser'; }
        goHome();
      } else { ok = false; message = 'unknown'; }
    } catch (e) { ok = false; message = String(e && e.message || e); }
    if (ws && wsOk) ws.send(JSON.stringify({ type: 'commandResult', id: c.id, command: c.command, ok, message }));
  }

  // ---------------------------------------------------------------- sha256 (WebView on http has no crypto.subtle)
  function sha256(ascii) {
    const rr = (v, a) => (v >>> a) | (v << (32 - a));
    const K = [], H = [];
    let p = 2, n = 0;
    const isPrime = (x) => { for (let i = 2; i * i <= x; i++) if (x % i === 0) return false; return true; };
    while (n < 64) { if (isPrime(p)) { if (n < 8) H[n] = (Math.pow(p, 1 / 2) * 4294967296) | 0; K[n++] = (Math.pow(p, 1 / 3) * 4294967296) | 0; } p++; }
    const bytes = unescape(encodeURIComponent(ascii));
    const words = [];
    const bitLen = bytes.length * 8;
    let str = bytes + '\x80';
    while (str.length % 64 - 56) str += '\x00';
    for (let i = 0; i < str.length; i++) words[i >> 2] |= str.charCodeAt(i) << ((3 - i) % 4) * 8;
    words[words.length] = (bitLen / 4294967296) | 0;
    words[words.length] = bitLen;
    let hash = H.slice(0, 8);
    for (let j = 0; j < words.length;) {
      const w = words.slice(j, j += 16);
      const old = hash.slice(0);
      for (let i = 0; i < 64; i++) {
        const w15 = w[i - 15], w2 = w[i - 2];
        const a = hash[0], e = hash[4];
        const t1 = hash[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & hash[5]) ^ (~e & hash[6])) + K[i]
          + (w[i] = i < 16 ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        const t2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(t1 + t2) | 0].concat(hash);
        hash[4] = (hash[4] + t1) | 0;
        hash.length = 8;
      }
      for (let i = 0; i < 8; i++) hash[i] = (hash[i] + old[i]) | 0;
    }
    let out = '';
    for (let i = 0; i < 8; i++) for (let j = 3; j + 1; j--) { const b = (hash[i] >> (j * 8)) & 255; out += (b < 16 ? '0' : '') + b.toString(16); }
    return out;
  }

  // ---------------------------------------------------------------- start
  window.HotelTV = {
    back,
    home: goHome,
    configChanged() { cfg = loadConfig(); reconnect(); renderAll(); },
    _sha256: sha256
  };

  renderAll();
  if (!cfg.room || !apiBase()) openTvAdmin();
  connect();
  poll();
  setInterval(() => { if (!wsOk) poll(); }, 30000);
  setInterval(() => {
    if (ws && wsOk) ws.send(JSON.stringify({ type: 'heartbeat', version: cfg.versionName }));
    flushOutbox();
  }, 60000);
  setInterval(() => {
    tickClock();
    const lock = store.get('pinLock', { until: 0 });
    if (viewName === 'pin' && lock.until && lock.until < Date.now() + 1000) { viewRender = () => renderPin(); rerenderView(); }
  }, 20000);
})();
