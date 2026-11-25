/* Hotel TV — admin panel (reception / kitchen / manager / technician). */
(function () {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const taka = (n) => '৳ ' + Number(n || 0).toLocaleString('en-IN');
  const dt = (ts) => (ts ? new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
  const ago = (ts) => {
    if (!ts) return 'কখনো না';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return `${s} সেকেন্ড আগে`;
    if (s < 3600) return `${Math.round(s / 60)} মিনিট আগে`;
    if (s < 86400) return `${Math.round(s / 3600)} ঘণ্টা আগে`;
    return dt(ts);
  };
  const toLocalInput = (ts) => { if (!ts) return ''; const d = new Date(ts); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

  let me = null;
  let standalone = false; // the TV itself is the server: no WebSocket, poll instead
  let warnings = {};
  let current = 'dashboard';
  let activeOrderCount = 0;

  // ---------------------------------------------------------------- api
  async function api(path, opts = {}) {
    const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
    if (opts.body !== undefined) {
      if (opts.raw) { init.body = opts.body; init.headers['Content-Type'] = 'application/octet-stream'; }
      else { init.body = JSON.stringify(opts.body); init.headers['Content-Type'] = 'application/json'; }
    }
    const r = await fetch('/api' + path, init);
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== '/login') { showLogin(); throw new Error(data.error || 'লগইন করুন'); }
    if (!r.ok) throw new Error(data.error || `ত্রুটি ${r.status}`);
    return data;
  }
  function toast(msg, ms = 3000) {
    const el = $('#toast');
    el.textContent = msg; el.classList.remove('hidden');
    clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add('hidden'), ms);
  }
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast('⚠ ' + e.message, 4500); } };

  function ding() {
    try {
      const ctx = ding.ctx || (ding.ctx = new (window.AudioContext || window.webkitAudioContext)());
      [0, 0.18].forEach((d) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = d ? 1318 : 988; o.type = 'sine';
        g.gain.setValueAtTime(0.0001, ctx.currentTime + d);
        g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + d + 0.35);
        o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + 0.4);
      });
    } catch (e) { /* audio blocked until first click */ }
  }

  // ---------------------------------------------------------------- dialog
  function dialog(title, bodyHtml, okText = 'সেভ') {
    const dlg = $('#dlg'), form = $('#dlg-form');
    form.innerHTML = `<h3>${esc(title)}</h3>${bodyHtml}
      <div class="dlg-actions"><button class="btn" value="cancel" formnovalidate>বাতিল</button><button class="btn primary" value="ok">${esc(okText)}</button></div>`;
    dlg.showModal();
    return new Promise((resolve) => {
      dlg.addEventListener('close', function h() {
        dlg.removeEventListener('close', h);
        if (dlg.returnValue !== 'ok') return resolve(null);
        resolve(Object.fromEntries(new FormData(form).entries()));
      });
    });
  }
  const confirmBox = async (msg, okText = 'হ্যাঁ') => (await dialog(msg, '', okText)) !== null;

  // ---------------------------------------------------------------- auth
  function showLogin() {
    $('#app').classList.add('hidden');
    $('#login').classList.remove('hidden');
    if (adminWs) { try { adminWs.close(); } catch (e) { /* ignore */ } }
  }
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api('/login', { method: 'POST', body: f });
      $('#login-err').textContent = '';
      e.target.reset();
      start();
    } catch (err) { $('#login-err').textContent = err.message; }
  });
  $('#logout-btn').onclick = guard(async () => { await api('/logout', { method: 'POST' }); showLogin(); });
  $('#pw-btn').onclick = guard(async () => {
    const v = await dialog('পাসওয়ার্ড বদলান', `
      <label>বর্তমান পাসওয়ার্ড<input type="password" name="current" required></label>
      <label>নতুন পাসওয়ার্ড (কমপক্ষে ৬ অক্ষর)<input type="password" name="next" minlength="6" required></label>`);
    if (!v) return;
    await api('/me/password', { method: 'POST', body: v });
    toast('পাসওয়ার্ড বদলানো হয়েছে');
  });
  $('#menu-btn').onclick = () => $('#nav').classList.toggle('open');

  const can = (p) => me && (me.perms.includes('*') || me.perms.includes(p));
  const PAGES = [
    { id: 'dashboard', label: 'ড্যাশবোর্ড', perm: 'dashboard', render: pageDashboard },
    { id: 'checkin', label: 'চেক-ইন', perm: 'checkin', render: pageCheckin },
    { id: 'checkout', label: 'চেক-আউট', perm: 'checkin', render: pageCheckout },
    { id: 'orders', label: 'অর্ডার', perm: 'orders.view', render: pageOrders, count: () => activeOrderCount },
    { id: 'notices', label: 'বার্তা ও নোটিশ', perm: 'notices', render: pageNotices },
    { id: 'menu', label: 'রুম সার্ভিস মেনু', perm: 'menu', render: pageMenu },
    { id: 'content', label: 'কনটেন্ট', perm: 'content', render: pageContent },
    { id: 'tv', label: 'টিভি নিয়ন্ত্রণ', perm: 'tv', render: pageTv },
    { id: 'reports', label: 'রিপোর্ট', perm: 'reports', render: pageReports },
    { id: 'users', label: 'ইউজার ও লগ', perm: 'users', render: pageUsers }
  ];

  function renderNav() {
    $('#nav').innerHTML = PAGES.filter((p) => can(p.perm)).map((p) => {
      const c = p.count ? p.count() : 0;
      return `<a href="#${p.id}" class="${p.id === current ? 'on' : ''}">${esc(p.label)}${c ? `<span class="count">${c}</span>` : ''}</a>`;
    }).join('');
  }

  async function go(id) {
    const page = PAGES.find((p) => p.id === id && can(p.perm)) || PAGES.find((p) => can(p.perm));
    current = page.id;
    renderNav();
    $('#nav').classList.remove('open');
    const el = $('#page');
    try { await page.render(el); } catch (e) { el.innerHTML = `<div class="alert">${esc(e.message)}</div>`; }
  }
  window.addEventListener('hashchange', () => go(location.hash.slice(1)));

  async function start() {
    const r = await api('/me');
    me = r.user; warnings = r.warnings || {}; standalone = !!r.standalone;
    $('#who').textContent = `${me.displayName || me.username} · ${roleName(me.role)}`;
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    if (standalone) startPolling(); else connectWs();
    refreshOrderCount();
    go(location.hash.slice(1) || 'dashboard');
  }
  const ROLES = { reception: 'রিসেপশন', kitchen: 'কিচেন / রুম সার্ভিস', manager: 'ম্যানেজার', technician: 'টেকনিশিয়ান' };
  const roleName = (r) => ROLES[r] || r;

  async function refreshOrderCount() {
    if (!can('orders.view')) return;
    try { activeOrderCount = (await api('/orders?scope=active')).orders.filter((o) => o.status === 'new').length; renderNav(); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- realtime
  let adminWs = null;
  function connectWs() {
    const url = location.origin.replace(/^http/, 'ws') + '/ws/admin';
    adminWs = new WebSocket(url);
    const me2 = adminWs;
    adminWs.onopen = () => $('#live').classList.add('on');
    adminWs.onclose = () => {
      $('#live').classList.remove('on');
      if (me2 === adminWs && !$('#app').classList.contains('hidden')) setTimeout(connectWs, 4000);
    };
    adminWs.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'order.new') {
        ding();
        toast(`🔔 রুম ${m.order.room} থেকে নতুন অর্ডার — ${taka(m.order.total)}`, 6000);
        refreshOrderCount();
        if (current === 'orders' || current === 'dashboard') go(current);
      } else if (m.type === 'order.updated') {
        refreshOrderCount();
        if (current === 'orders') go(current);
      } else if (m.type === 'rooms.changed' || m.type === 'tick') {
        if (current === 'dashboard') debounceDash();
      } else if (m.type === 'alert') {
        toast(`⚠ ${m.room ? 'রুম ' + m.room + ': ' : ''}${m.message}`, 7000);
        if (current === 'dashboard') debounceDash();
      } else if (m.type === 'command.result') {
        toast(`রুম ${m.room}: ${m.ok ? '✔' : '✖'} ${m.message || ''}`, 4000);
      }
    };
  }
  // Standalone mode: check every 5 s for new orders and refresh the live pages.
  let pollTimer = null;
  function startPolling() {
    clearInterval(pollTimer);
    $('#live').classList.add('on');
    let lastIds = null;
    pollTimer = setInterval(async () => {
      if ($('#app').classList.contains('hidden')) return clearInterval(pollTimer);
      try {
        if (can('orders.view')) {
          const { orders } = await api('/orders?scope=active');
          const ids = orders.filter((o) => o.status === 'new').map((o) => o.id);
          const fresh = lastIds ? orders.filter((o) => o.status === 'new' && !lastIds.includes(o.id)) : [];
          lastIds = ids;
          activeOrderCount = ids.length;
          renderNav();
          if (fresh.length) {
            ding();
            toast(`🔔 রুম ${fresh[0].room} থেকে নতুন অর্ডার — ${taka(fresh[0].total)}`, 6000);
            if (current === 'orders') go('orders');
          }
        }
        if (current === 'dashboard') go('dashboard');
        $('#live').classList.add('on');
      } catch (e) { $('#live').classList.remove('on'); }
    }, 5000);
  }

  let dashT = null;
  const debounceDash = () => { clearTimeout(dashT); dashT = setTimeout(() => current === 'dashboard' && go('dashboard'), 800); };

  // ---------------------------------------------------------------- pages
  async function pageDashboard(el) {
    const d = await api('/dashboard');
    const online = d.rooms.filter((r) => r.tv === 'online').length;
    const offline = d.rooms.filter((r) => r.tv === 'offline').length;
    const occupied = d.rooms.filter((r) => r.guestName).length;
    const orders = d.rooms.reduce((s, r) => s + r.activeOrders, 0);
    const floors = [...new Set(d.rooms.map((r) => r.floor))];
    el.innerHTML = `
      <h2>ড্যাশবোর্ড</h2>
      ${warnings.defaultPin && can('tv') ? '<div class="warnbox">⚠ টিভি-অ্যাডমিন পিন এখনো ১২৩৪। <a href="#tv">টিভি নিয়ন্ত্রণ</a> থেকে বদলান।</div>' : ''}
      ${d.alerts.length ? `<div class="alert"><b>সতর্কবার্তা:</b> ${d.alerts.slice(0, 4).map((a) => `${a.room ? 'রুম ' + esc(a.room) + ' — ' : ''}${esc(a.message)} (${ago(a.at)})`).join(' · ')}
        <button class="btn sm" id="seen">দেখা হয়েছে</button></div>` : ''}
      <div class="stats">
        <div class="stat"><div class="v">${online}</div><div class="k">টিভি অনলাইন</div></div>
        <div class="stat"><div class="v" style="color:var(--bad)">${offline}</div><div class="k">টিভি অফলাইন</div></div>
        <div class="stat"><div class="v">${occupied}/${d.rooms.length}</div><div class="k">রুমে অতিথি</div></div>
        <div class="stat"><div class="v">${orders}</div><div class="k">চলমান অর্ডার</div></div>
      </div>
      ${floors.map((f) => `<div class="floor-title">ফ্লোর ${esc(f || '—')}</div><div class="rooms">
        ${d.rooms.filter((r) => r.floor === f).map((r) => `<div class="room ${r.tv}" data-room="${esc(r.number)}">
          <div class="n">${esc(r.number)} ${r.activeOrders ? `<span class="pill p-warn">${r.activeOrders} অর্ডার</span>` : ''}</div>
          <div class="g">${r.guestName ? esc(r.guestName) : '<span class="muted">খালি</span>'}</div>
          <div class="s">${r.tv === 'online' ? '● অনলাইন' : r.tv === 'offline' ? '● অফলাইন · ' + ago(r.lastSeen) : 'টিভি যুক্ত হয়নি'}</div>
        </div>`).join('')}</div>`).join('')}
      ${d.unassignedDevices.length ? `<div class="card" style="margin-top:16px"><h3>যে টিভির রুম নম্বর তালিকায় নেই</h3>
        ${d.unassignedDevices.map((x) => `<div>${esc(x.room || '—')} · ${esc(x.ip)} · ${esc(x.model || '')} · ${ago(x.last_seen)}</div>`).join('')}</div>` : ''}
      <p class="muted" style="margin-top:16px">সবুজ = টিভি গত ২ মিনিটে সংকেত পাঠিয়েছে। রুমে ক্লিক করলে চেক-ইন বা চেক-আউট খোলে।</p>`;
    const seen = $('#seen', el);
    if (seen) seen.onclick = guard(async () => { await api('/alerts/seen', { method: 'POST' }); go('dashboard'); });
    $$('.room', el).forEach((c) => {
      c.onclick = () => {
        const r = d.rooms.find((x) => x.number === c.dataset.room);
        if (!can('checkin')) return;
        sessionStorage.setItem('room', r.number);
        location.hash = r.guestName ? 'checkout' : 'checkin';
      };
    });
  }

  async function pageCheckin(el) {
    const { rooms } = await api('/rooms');
    const pre = sessionStorage.getItem('room');
    sessionStorage.removeItem('room');
    const def = new Date(); def.setDate(def.getDate() + 1); def.setHours(12, 0, 0, 0);
    el.innerHTML = `<h2>চেক-ইন</h2>
      <form class="card" id="ci">
        <div class="grid2">
          <label>রুম নম্বর<select name="room" required>${rooms.map((r) => `<option value="${esc(r.number)}" ${r.number === pre ? 'selected' : ''}>${esc(r.number)}${r.guest_name ? ' — ' + esc(r.guest_name) + ' (আছেন)' : ''}</option>`).join('')}</select></label>
          <label>অতিথির নাম<input name="guestName" required maxlength="80" placeholder="যেমন: জনাব রহমান"></label>
          <label>ভাষা<select name="language"><option value="bn">বাংলা</option><option value="en">English</option></select></label>
          <label>চেক-আউটের তারিখ ও সময়<input type="datetime-local" name="checkoutAt" value="${toLocalInput(def)}"></label>
        </div>
        <div style="margin-top:14px"><button class="btn primary">সেভ</button></div>
      </form>
      <p class="muted">সেভ করার সাথে সাথে টিভিতে নাম ওঠে। ড্যাশবোর্ডে রুমটা সবুজ থাকলে টিভি নতুন নাম পেয়েছে।</p>`;
    $('#ci', el).onsubmit = guard(async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(e.target).entries());
      const room = rooms.find((r) => r.number === v.room);
      if (room && room.guest_name && !(await confirmBox(`রুম ${room.number}-এ ${room.guest_name} আছেন। নতুন অতিথি দিয়ে বদলাবেন?`, 'বদলান'))) return;
      const r = await api('/checkin', { method: 'POST', body: { ...v, checkoutAt: v.checkoutAt ? new Date(v.checkoutAt).toISOString() : null } });
      toast(r.tvOnline ? `✔ রুম ${v.room}: টিভিতে নাম পাঠানো হয়েছে` : `✔ সেভ হয়েছে — রুম ${v.room}-এর টিভি এখন অফলাইন, চালু হলে নাম পাবে`, 5000);
      e.target.reset();
    });
  }

  async function pageCheckout(el) {
    const { rooms } = await api('/rooms');
    const occupied = rooms.filter((r) => r.guest_name);
    const pre = sessionStorage.getItem('room');
    sessionStorage.removeItem('room');
    el.innerHTML = `<h2>চেক-আউট</h2>
      <div class="card"><label>রুম<select id="co-room"><option value="">— রুম বাছুন —</option>${occupied.map((r) => `<option value="${esc(r.number)}" ${r.number === pre ? 'selected' : ''}>${esc(r.number)} — ${esc(r.guest_name)}</option>`).join('')}</select></label>
      <div id="co-detail" style="margin-top:14px"></div></div>`;
    const sel = $('#co-room', el);
    const show = guard(async () => {
      const box = $('#co-detail', el);
      if (!sel.value) { box.innerHTML = occupied.length ? '' : '<p class="muted">এখন কোনো রুমে অতিথি নেই।</p>'; return; }
      const d = await api('/checkout/' + encodeURIComponent(sel.value));
      box.innerHTML = `<p><b>${esc(d.room.guest_name)}</b> · চেক-ইন ${dt(d.room.checkin_at)} · চেক-আউট ${dt(d.room.checkout_at)}</p>
        <h3>বিলে যোগ করার মতো রুম সার্ভিস অর্ডার</h3>
        ${d.orders.length ? `<div class="table-wrap"><table><tr><th>#</th><th>সময়</th><th>খাবার</th><th>অবস্থা</th><th class="num">টাকা</th></tr>
          ${d.orders.map((o) => `<tr><td>${o.id}</td><td>${dt(o.created_at)}</td><td>${o.items.map((i) => `${i.qty}× ${esc(i.name_bn)}`).join(', ')}</td><td>${statusPill(o.status)}</td><td class="num">${taka(o.total)}</td></tr>`).join('')}
          <tr><th colspan="4">মোট</th><th class="num">${taka(d.total)}</th></tr></table></div>` : '<p class="muted">কোনো অপরিশোধিত অর্ডার নেই।</p>'}
        <div style="margin-top:14px"><button class="btn primary" id="co-btn">রুম রিসেট (চেক-আউট)</button></div>
        <p class="muted">রিসেট করলে টিভিতে নাম মুছে “সম্মানিত অতিথি” আসবে, অর্ডারগুলো বিলে যোগ হয়েছে বলে চিহ্নিত হবে, আর YouTube ও Netflix-এর লগইন মোছা হবে।</p>`;
      $('#co-btn', box).onclick = guard(async () => {
        if (!(await confirmBox(`রুম ${sel.value} চেক-আউট করবেন? মোট বিল ${taka(d.total)}`, 'চেক-আউট'))) return;
        const r = await api('/checkout', { method: 'POST', body: { room: sel.value } });
        toast(r.delivery.delivered ? `✔ রুম ${sel.value} রিসেট হয়েছে` : `✔ রিসেট হয়েছে — টিভি অফলাইন, চালু হলে লগইন মোছা হবে`, 5000);
        go('checkout');
      });
    });
    sel.onchange = show;
    show();
  }

  const STATUS = { new: ['নতুন', 'p-warn'], preparing: ['তৈরি হচ্ছে', 'p-info'], delivered: ['পৌঁছানো', 'p-ok'], cancelled: ['বাতিল', 'p-bad'] };
  const statusPill = (s) => `<span class="pill ${STATUS[s][1]}">${STATUS[s][0]}</span>`;

  async function pageOrders(el) {
    const scope = sessionStorage.getItem('orderScope') || 'active';
    const { orders } = await api('/orders?scope=' + scope);
    const manage = can('orders.manage');
    el.innerHTML = `<h2>অর্ডার</h2>
      <div class="toolbar"><button class="btn ${scope === 'active' ? 'primary' : ''}" data-scope="active">চলমান</button>
        <button class="btn ${scope === 'all' ? 'primary' : ''}" data-scope="all">সব (শেষ ২০০)</button>
        <span class="muted">নতুন অর্ডার এলে শব্দ হবে — এই পাতা খোলা রাখুন।</span></div>
      ${orders.length ? '' : '<p class="muted">কোনো অর্ডার নেই।</p>'}
      <div class="orders">${orders.map((o) => `<div class="order ${o.status === 'new' ? 'new' : ''}">
        <div class="h"><b>রুম ${esc(o.room)}</b>${statusPill(o.status)}</div>
        <div class="muted">#${o.id} · ${dt(o.created_at)}${o.guest_name ? ' · ' + esc(o.guest_name) : ''}${o.billed ? ' · বিলে যোগ' : ''}</div>
        <ul>${o.items.map((i) => `<li>${i.qty}× ${esc(i.name_bn)} <span class="muted">${taka(i.price * i.qty)}</span></li>`).join('')}</ul>
        ${o.note ? `<div class="muted">নোট: ${esc(o.note)}</div>` : ''}
        <div class="h"><b>${taka(o.total)}</b><span>
          ${manage && o.status === 'new' ? `<button class="btn sm primary" data-id="${o.id}" data-st="preparing">তৈরি শুরু</button>` : ''}
          ${manage && o.status === 'preparing' ? `<button class="btn sm primary" data-id="${o.id}" data-st="delivered">পৌঁছানো হয়েছে</button>` : ''}
          ${manage && (o.status === 'new' || o.status === 'preparing') ? `<button class="btn sm danger" data-id="${o.id}" data-st="cancelled">বাতিল</button>` : ''}
        </span></div></div>`).join('')}</div>`;
    $$('[data-scope]', el).forEach((b) => { b.onclick = () => { sessionStorage.setItem('orderScope', b.dataset.scope); go('orders'); }; });
    $$('[data-st]', el).forEach((b) => {
      b.onclick = guard(async () => {
        if (b.dataset.st === 'cancelled' && !(await confirmBox('অর্ডারটি বাতিল করবেন?', 'বাতিল করুন'))) return;
        await api(`/orders/${b.dataset.id}/status`, { method: 'POST', body: { status: b.dataset.st } });
        refreshOrderCount();
        go('orders');
      });
    });
  }

  async function pageNotices(el) {
    const { notices, now } = await api('/notices');
    el.innerHTML = `<h2>বার্তা ও নোটিশ</h2>
      <form class="card" id="nf">
        <div class="grid2">
          <label>কাকে পাঠাবেন<select name="targetType" id="tt"><option value="all">সব টিভি</option><option value="floor">একটা ফ্লোর</option><option value="room">একটা রুম</option></select></label>
          <label id="tgt-wrap" class="hidden">ফ্লোর / রুম নম্বর<input name="target" placeholder="যেমন: 2 বা 204"></label>
          <label>ধরন<select name="style"><option value="ticker">চলমান বার (নিচে)</option><option value="popup">পুরো পর্দার পপ-আপ</option></select></label>
          <label>শুরু (খালি = এখনই)<input type="datetime-local" name="startsAt"></label>
          <label>শেষ (খালি = যতক্ষণ না মোছেন)<input type="datetime-local" name="endsAt"></label>
        </div>
        <div class="grid2" style="margin-top:12px">
          <label>বাংলা লেখা<textarea name="textBn" maxlength="500"></textarea></label>
          <label>English text<textarea name="textEn" maxlength="500"></textarea></label>
        </div>
        <div style="margin-top:12px"><button class="btn primary">পাঠান</button></div>
      </form>
      <div class="card table-wrap"><h3>নোটিশের তালিকা</h3>
        ${notices.length ? `<table><tr><th>লক্ষ্য</th><th>ধরন</th><th>লেখা</th><th>সময়</th><th>অবস্থা</th><th></th></tr>
        ${notices.map((n) => {
          const active = (!n.starts_at || n.starts_at <= now) && (!n.ends_at || n.ends_at > now);
          const ended = n.ends_at && n.ends_at <= now;
          return `<tr><td>${n.target_type === 'all' ? 'সব টিভি' : n.target_type === 'floor' ? 'ফ্লোর ' + esc(n.target) : 'রুম ' + esc(n.target)}</td>
            <td>${n.style === 'ticker' ? 'চলমান বার' : 'পপ-আপ'}</td>
            <td>${esc(n.text_bn)}${n.text_en ? `<div class="muted">${esc(n.text_en)}</div>` : ''}</td>
            <td>${n.starts_at ? dt(n.starts_at) : 'এখনই'} → ${n.ends_at ? dt(n.ends_at) : '—'}</td>
            <td>${active ? '<span class="pill p-ok">চলছে</span>' : ended ? '<span class="pill p-mute">শেষ</span>' : '<span class="pill p-info">অপেক্ষায়</span>'}</td>
            <td><button class="btn sm danger" data-del="${n.id}">মুছুন</button></td></tr>`;
        }).join('')}</table>` : '<p class="muted">কোনো নোটিশ নেই।</p>'}</div>`;
    $('#tt', el).onchange = (e) => $('#tgt-wrap', el).classList.toggle('hidden', e.target.value === 'all');
    $('#nf', el).onsubmit = guard(async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(e.target).entries());
      v.startsAt = v.startsAt ? new Date(v.startsAt).toISOString() : null;
      v.endsAt = v.endsAt ? new Date(v.endsAt).toISOString() : null;
      await api('/notices', { method: 'POST', body: v });
      toast('✔ নোটিশ পাঠানো হয়েছে');
      go('notices');
    });
    $$('[data-del]', el).forEach((b) => {
      b.onclick = guard(async () => {
        if (!(await confirmBox('নোটিশটি মুছবেন? টিভি থেকে সাথে সাথে সরে যাবে।', 'মুছুন'))) return;
        await api('/notices/' + b.dataset.del, { method: 'DELETE' });
        go('notices');
      });
    });
  }

  async function readImage(file) {
    if (!file) return null;
    if (file.size > 8 * 1024 * 1024) throw new Error('ছবি ৮ MB-এর বেশি');
    const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
    return (await api('/upload', { method: 'POST', body: { dataUrl } })).url;
  }

  async function pageMenu(el) {
    const { items } = await api('/menu');
    el.innerHTML = `<h2>রুম সার্ভিস মেনু</h2>
      <div class="toolbar"><button class="btn primary" id="add">+ নতুন খাবার</button></div>
      <div class="card table-wrap"><table><tr><th></th><th>বিভাগ</th><th>নাম</th><th class="num">দাম</th><th>অবস্থা</th><th></th></tr>
        ${items.map((m) => `<tr><td>${m.image ? `<img class="thumb" src="${esc(m.image)}" alt="">` : ''}</td><td>${esc(m.category)}</td>
          <td>${esc(m.name_bn)}<div class="muted">${esc(m.name_en)}</div></td><td class="num">${taka(m.price)}</td>
          <td><button class="btn sm" data-toggle="${m.id}">${m.available ? '<span class="pill p-ok">পাওয়া যাচ্ছে</span>' : '<span class="pill p-bad">এখন পাওয়া যাচ্ছে না</span>'}</button></td>
          <td><button class="btn sm" data-edit="${m.id}">বদলান</button> <button class="btn sm danger" data-del="${m.id}">মুছুন</button></td></tr>`).join('')}
      </table></div>`;
    const cats = [...new Set(items.map((m) => m.category))];
    const edit = guard(async (m = {}) => {
      const v = await dialog(m.id ? 'খাবার বদলান' : 'নতুন খাবার', `
        <label>বিভাগ<input name="category" list="cats" value="${esc(m.category || '')}"><datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
        <div class="grid2"><label>নাম (বাংলা)<input name="name_bn" required value="${esc(m.name_bn || '')}"></label>
        <label>Name (English)<input name="name_en" value="${esc(m.name_en || '')}"></label></div>
        <div class="grid2"><label>বিবরণ (বাংলা)<input name="description_bn" value="${esc(m.description_bn || '')}"></label>
        <label>Description<input name="description_en" value="${esc(m.description_en || '')}"></label></div>
        <div class="grid2"><label>দাম (টাকা)<input name="price" type="number" min="0" required value="${esc(m.price ?? '')}"></label>
        <label>ক্রম<input name="sort" type="number" value="${esc(m.sort ?? items.length)}"></label></div>
        <label>ছবি<input type="file" name="imageFile" accept="image/*"></label>
        ${m.image ? `<img class="img-prev" src="${esc(m.image)}" alt=""><label><input type="checkbox" name="removeImage" style="width:auto"> ছবি সরান</label>` : ''}`);
      if (!v) return;
      const file = $('#dlg-form input[name=imageFile]').files[0];
      let image = m.image || null;
      if (file) image = await readImage(file);
      if (v.removeImage) image = null;
      await api('/menu', { method: 'POST', body: { ...m, ...v, image, price: Number(v.price), sort: Number(v.sort), available: m.id ? m.available : true } });
      toast('✔ মেনু সেভ হয়েছে — সব টিভিতে পৌঁছে যাচ্ছে');
      go('menu');
    });
    $('#add', el).onclick = () => edit({});
    $$('[data-edit]', el).forEach((b) => { b.onclick = () => edit(items.find((m) => m.id === Number(b.dataset.edit))); });
    $$('[data-toggle]', el).forEach((b) => {
      b.onclick = guard(async () => {
        const m = items.find((x) => x.id === Number(b.dataset.toggle));
        await api('/menu', { method: 'POST', body: { ...m, available: !m.available } });
        go('menu');
      });
    });
    $$('[data-del]', el).forEach((b) => {
      b.onclick = guard(async () => {
        if (!(await confirmBox('খাবারটি মেনু থেকে মুছবেন?', 'মুছুন'))) return;
        await api('/menu/' + b.dataset.del, { method: 'DELETE' });
        go('menu');
      });
    });
  }

  async function pageContent(el) {
    const [{ content: c }, { rooms }] = await Promise.all([api('/content'), api('/rooms')]);
    const svcRow = (s = {}) => `<div class="item"><input name="icon" value="${esc(s.icon || '')}" placeholder="🍽">
      <input name="name_bn" value="${esc(s.name?.bn || '')}" placeholder="নাম (বাংলা)"><input name="name_en" value="${esc(s.name?.en || '')}" placeholder="Name">
      <input name="extra" value="${esc(s.hours ?? s.distance ?? '')}" placeholder="সময় / দূরত্ব"><input name="note_bn" value="${esc(s.note?.bn || '')}" placeholder="নোট">
      <button type="button" class="btn sm danger" data-rm>✕</button></div>`;
    const lt = c.liveTv || { mode: 'tuner', package: '', channels: [] };
    el.innerHTML = `<h2>কনটেন্ট</h2>
      <form id="cf">
        <div class="card"><h3>হোটেল</h3><div class="grid2">
          <label>হোটেলের নাম (বাংলা)<input name="hotelName_bn" value="${esc(c.hotelName?.bn)}"></label>
          <label>Hotel name (English)<input name="hotelName_en" value="${esc(c.hotelName?.en)}"></label>
          <label>স্বাগত বার্তা (বাংলা)<input name="welcome_bn" value="${esc(c.welcome?.bn)}"></label>
          <label>Welcome message<input name="welcome_en" value="${esc(c.welcome?.en)}"></label>
          <label>Wi-Fi নাম<input name="wifi_ssid" value="${esc(c.wifi?.ssid)}"></label>
          <label>Wi-Fi পাসওয়ার্ড<input name="wifi_password" value="${esc(c.wifi?.password)}"></label>
          <label>রিসেপশনের নম্বর<input name="receptionPhone" value="${esc(c.receptionPhone)}"></label>
          <label>সাধারণ চেক-আউটের সময়<input name="checkoutTime" value="${esc(c.checkoutTime)}"></label>
          <label>লোগো<input type="file" id="logo" accept="image/*">${c.logo ? `<img class="img-prev" src="${esc(c.logo)}" alt="">` : ''}</label>
          <label>ব্যাকগ্রাউন্ড ছবি<input type="file" id="bgimg" accept="image/*">${c.background ? `<img class="img-prev" src="${esc(c.background)}" alt=""><span><input type="checkbox" id="bg-rm" style="width:auto"> সরান</span>` : ''}</label>
        </div></div>
        <div class="card list-edit" id="svc"><h3>হোটেল সেবা ও সময়</h3>${(c.services || []).map(svcRow).join('')}<button type="button" class="btn sm" data-add="svc">+ সেবা যোগ</button></div>
        <div class="card list-edit" id="near"><h3>আশপাশের জায়গা</h3>${(c.nearby || []).map(svcRow).join('')}<button type="button" class="btn sm" data-add="near">+ জায়গা যোগ</button></div>
        <div class="card"><h3>লাইভ টিভি</h3><div class="grid2">
          <label>উৎস<select name="lt_mode"><option value="tuner" ${lt.mode === 'tuner' ? 'selected' : ''}>টিভির নিজস্ব টিউনার</option><option value="iptv" ${lt.mode === 'iptv' ? 'selected' : ''}>হোটেলের IPTV</option></select></label>
          <label>টিউনার অ্যাপের প্যাকেজ (খালি = নিজে খুঁজে নেবে)<input name="lt_package" value="${esc(lt.package)}" placeholder="com.mediatek.wwtv.tvcenter"></label>
        </div>
        <label style="margin-top:10px">IPTV চ্যানেল — প্রতি লাইনে: নাম | স্ট্রিম URL (HLS .m3u8 বা http)
          <textarea name="lt_channels" rows="5">${esc((lt.channels || []).map((x) => `${x.name} | ${x.url}`).join('\n'))}</textarea></label></div>
        <div class="toolbar"><button class="btn primary">সব সেভ করুন</button><span class="muted">সেভ করলে কয়েক সেকেন্ডে সব টিভিতে পৌঁছে যায়।</span></div>
      </form>
      <div class="card"><h3>রুমের তালিকা</h3>
        <div class="row"><label>রুম নম্বর<input id="rn" placeholder="305"></label><label>ফ্লোর<input id="rf" placeholder="3"></label><button class="btn" id="radd">যোগ / বদলান</button></div>
        <div class="checks" style="margin-top:12px">${rooms.map((r) => `<label>${esc(r.number)} <span class="muted">ফ্লোর ${esc(r.floor)}</span> <button class="btn sm ghost" data-rdel="${esc(r.number)}">✕</button></label>`).join('')}</div>
      </div>`;
    $$('[data-add]', el).forEach((b) => { b.onclick = () => b.insertAdjacentHTML('beforebegin', svcRow()); });
    el.addEventListener('click', (e) => { if (e.target.matches('[data-rm]')) e.target.closest('.item').remove(); });
    const readList = (id, key) => $$(`#${id} .item`, el).map((row) => {
      const g = (n) => $(`[name=${n}]`, row).value.trim();
      if (!g('name_bn') && !g('name_en')) return null;
      return { icon: g('icon'), name: { bn: g('name_bn'), en: g('name_en') }, [key]: g('extra'), note: { bn: g('note_bn'), en: g('note_bn') } };
    }).filter(Boolean);
    $('#cf', el).onsubmit = guard(async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target).entries());
      const next = {
        hotelName: { bn: f.hotelName_bn, en: f.hotelName_en },
        welcome: { bn: f.welcome_bn, en: f.welcome_en },
        wifi: { ssid: f.wifi_ssid, password: f.wifi_password },
        receptionPhone: f.receptionPhone, checkoutTime: f.checkoutTime,
        services: readList('svc', 'hours'), nearby: readList('near', 'distance'),
        liveTv: {
          mode: f.lt_mode, package: f.lt_package.trim(),
          channels: f.lt_channels.split('\n').map((l) => l.split('|').map((s) => s.trim())).filter((p) => p[0] && p[1]).map(([name, url]) => ({ name, url }))
        }
      };
      const logo = $('#logo', el).files[0], bg = $('#bgimg', el).files[0];
      if (logo) next.logo = await readImage(logo);
      if (bg) next.background = await readImage(bg);
      if ($('#bg-rm', el)?.checked) next.background = '';
      await api('/content', { method: 'PUT', body: { content: next } });
      toast('✔ সেভ হয়েছে — টিভিতে পাঠানো হচ্ছে');
      go('content');
    });
    $('#radd', el).onclick = guard(async () => {
      await api('/rooms', { method: 'POST', body: { number: $('#rn', el).value.trim(), floor: $('#rf', el).value.trim() } });
      go('content');
    });
    $$('[data-rdel]', el).forEach((b) => {
      b.onclick = guard(async (e) => {
        e.preventDefault();
        if (!(await confirmBox(`রুম ${b.dataset.rdel} তালিকা থেকে মুছবেন?`, 'মুছুন'))) return;
        await api('/rooms/' + encodeURIComponent(b.dataset.rdel), { method: 'DELETE' });
        go('content');
      });
    });
  }

  const KEYN = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: 'OK' };
  async function pageTv(el) {
    const [{ settings: s, apk }, d] = await Promise.all([api('/tv/settings'), api('/dashboard')]);
    el.innerHTML = `<h2>টিভি নিয়ন্ত্রণ</h2>
      ${s.pinIsDefault ? '<div class="warnbox">⚠ পিন এখনো ডেমোর ১২৩৪। নিচ থেকে বদলান।</div>' : ''}
      <div class="card"><h3>নির্দেশ পাঠান</h3>
        <div class="toolbar"><button class="btn sm" id="selall">সব বাছুন</button><button class="btn sm" id="selnone">কোনোটাই না</button>
          ${[...new Set(d.rooms.map((r) => r.floor))].map((f) => `<button class="btn sm" data-floor="${esc(f)}">ফ্লোর ${esc(f)}</button>`).join('')}</div>
        <div class="checks">${d.rooms.map((r) => `<label><input type="checkbox" value="${esc(r.number)}" data-f="${esc(r.floor)}"> ${esc(r.number)} <span class="pill ${r.tv === 'online' ? 'p-ok' : r.tv === 'offline' ? 'p-bad' : 'p-mute'}">${r.tv === 'online' ? 'অন' : r.tv === 'offline' ? 'অফ' : '—'}</span></label>`).join('')}</div>
        <div class="toolbar" style="margin-top:12px">
          <button class="btn" data-cmd="reload">পেজ রিলোড</button>
          <button class="btn" data-cmd="restart">অ্যাপ রিস্টার্ট</button>
          <button class="btn" data-cmd="update">নতুন ভার্সন পাঠান</button>
          <button class="btn danger" data-cmd="clearGuestData">অতিথির লগইন মুছুন</button>
        </div>
        <p class="muted">অফলাইন টিভি নির্দেশটা পাবে যখন আবার চালু হবে।</p></div>
      <form class="card" id="ts"><h3>টিভি সেটিংস</h3><div class="grid2">
        <label>নতুন টিভি-অ্যাডমিন পিন (৪ অঙ্ক, খালি = বদলাবে না)<input name="pin" inputmode="numeric" pattern="\\d{4}" maxlength="4" autocomplete="off"></label>
        <label>সর্বোচ্চ ভলিউম: <b id="volv">${s.maxVolume}%</b><input type="range" name="maxVolume" min="10" max="100" step="5" value="${s.maxVolume}"></label>
        <label>লুকানো কম্বিনেশন (↑ ↓ ← → OK, ফাঁকা দিয়ে)<input name="combo" value="${esc(s.combo.map((k) => KEYN[k]).join(' '))}"></label>
        <label>চেক-আউটে যে অ্যাপের ডেটা মোছা হবে (কমা দিয়ে)<input name="clearPackages" value="${esc(s.clearPackages.join(', '))}"></label>
        <label><span><input type="checkbox" name="kiosk" style="width:auto" ${s.kiosk ? 'checked' : ''}> কড়া লক (Kiosk / Lock Task) — শুধু Device Owner টিভিতে কাজ করে</span></label>
      </div><div style="margin-top:12px"><button class="btn primary">সেভ</button></div></form>
      <form class="card" id="apkf"><h3>অ্যাপ আপডেট (APK)</h3>
        <p class="muted">বর্তমান সার্ভার APK: ${apk ? `ভার্সন ${esc(apk.versionName)} (code ${apk.versionCode}) · ${(apk.size / 1048576).toFixed(1)} MB · ${dt(apk.uploadedAt)}` : 'এখনো আপলোড হয়নি'}</p>
        <div class="row"><label>APK ফাইল<input type="file" name="file" accept=".apk" required></label>
        <label>versionCode<input name="versionCode" type="number" min="1" required value="${apk ? apk.versionCode + 1 : 2}"></label>
        <label>versionName<input name="versionName" placeholder="1.0.1"></label><button class="btn primary">আপলোড</button></div>
        <p class="muted">আপলোডের পর “নতুন ভার্সন পাঠান” চাপুন। Device Owner টিভিতে নিজে থেকে ইনস্টল হবে, অন্য টিভিতে পর্দায় “Install” চাপতে হবে।</p></form>
      <div class="card table-wrap"><h3>টিভির তালিকা</h3><table><tr><th>রুম</th><th>আইপি</th><th>মডেল</th><th>ভার্সন</th><th>শেষ সংকেত</th></tr>
        ${d.rooms.flatMap((r) => r.devices.map((x) => `<tr><td>${esc(r.number)}</td><td>${esc(x.ip)}</td><td>${esc(x.model || '')}</td><td>${esc(x.version || '')}</td><td>${ago(x.lastSeen)}</td></tr>`)).join('') || '<tr><td colspan="5" class="muted">এখনো কোনো টিভি যুক্ত হয়নি</td></tr>'}</table></div>`;
    const boxes = () => $$('.checks input', el);
    $('#selall', el).onclick = () => boxes().forEach((b) => { b.checked = true; });
    $('#selnone', el).onclick = () => boxes().forEach((b) => { b.checked = false; });
    $$('[data-floor]', el).forEach((btn) => { btn.onclick = () => boxes().forEach((b) => { if (b.dataset.f === btn.dataset.floor) b.checked = true; }); });
    $$('[data-cmd]', el).forEach((b) => {
      b.onclick = guard(async () => {
        const rooms = boxes().filter((x) => x.checked).map((x) => x.value);
        if (!rooms.length) throw new Error('আগে রুম বাছুন');
        if (!(await confirmBox(`${rooms.length}টি রুমে “${b.textContent}” পাঠাবেন?`, 'পাঠান'))) return;
        const r = await api('/tv/command', { method: 'POST', body: { rooms, command: b.dataset.cmd } });
        toast(`✔ ${r.delivered}টি টিভিতে পাঠানো হয়েছে${r.queued ? `, ${r.queued}টি অফলাইন (পরে পাবে)` : ''}`, 5000);
      });
    });
    $('#ts [name=maxVolume]', el).oninput = (e) => { $('#volv', el).textContent = e.target.value + '%'; };
    $('#ts', el).onsubmit = guard(async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target).entries());
      const rev = Object.fromEntries(Object.entries(KEYN).map(([k, v]) => [v.toLowerCase(), k]));
      const combo = f.combo.trim().split(/\s+/).map((x) => rev[x.toLowerCase()] || x);
      const body = { maxVolume: Number(f.maxVolume), combo, clearPackages: f.clearPackages.split(',').map((x) => x.trim()).filter(Boolean), kiosk: !!f.kiosk };
      if (f.pin) body.pin = f.pin;
      await api('/tv/settings', { method: 'PUT', body });
      warnings.defaultPin = warnings.defaultPin && !f.pin;
      toast('✔ সব টিভিতে পাঠানো হয়েছে');
      go('tv');
    });
    $('#apkf', el).onsubmit = guard(async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const file = f.get('file');
      toast('আপলোড হচ্ছে…', 20000);
      const buf = await file.arrayBuffer();
      await api(`/tv/apk?versionCode=${encodeURIComponent(f.get('versionCode'))}&versionName=${encodeURIComponent(f.get('versionName') || '')}`, { method: 'POST', body: buf, raw: true });
      toast('✔ APK আপলোড হয়েছে');
      go('tv');
    });
  }

  async function pageReports(el) {
    const days = Number(sessionStorage.getItem('repDays') || 7);
    const r = await api('/reports?days=' + days);
    const maxRev = Math.max(1, ...r.byDay.map((x) => x.revenue));
    const maxOff = Math.max(1, ...r.offline.map((x) => x.minutes));
    const totRev = r.byDay.reduce((s, x) => s + x.revenue, 0);
    const totOrd = r.byDay.reduce((s, x) => s + x.orders, 0);
    el.innerHTML = `<h2>রিপোর্ট</h2>
      <div class="toolbar">${[1, 7, 30, 90].map((n) => `<button class="btn ${n === days ? 'primary' : ''}" data-days="${n}">${n === 1 ? 'আজ' : `শেষ ${n} দিন`}</button>`).join('')}</div>
      <div class="stats"><div class="stat"><div class="v">${totOrd}</div><div class="k">অর্ডার</div></div>
        <div class="stat"><div class="v">${taka(totRev)}</div><div class="k">রুম সার্ভিস আয়</div></div></div>
      <div class="grid2">
        <div class="card"><h3>দিনে আয়</h3><div class="bar-chart">${r.byDay.map((x) => `<div class="bar-row"><span>${esc(x.day.slice(5))} · ${x.orders}টি</span><div class="b" style="width:${(x.revenue / maxRev) * 100}%"></div><span class="v">${taka(x.revenue)}</span></div>`).join('') || '<p class="muted">কোনো অর্ডার নেই</p>'}</div></div>
        <div class="card"><h3>সবচেয়ে বেশি অর্ডার</h3><table>${r.topItems.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${x.qty}টি</td><td class="num">${taka(x.revenue)}</td></tr>`).join('') || '<tr><td class="muted">—</td></tr>'}</table></div>
        <div class="card"><h3>কোন টিভি কতক্ষণ অফলাইন ছিল</h3><div class="bar-chart">${r.offline.map((x) => `<div class="bar-row"><span>রুম ${esc(x.room)}</span><div class="b" style="width:${(x.minutes / maxOff) * 100}%;background:var(--bad)"></div><span class="v">${x.minutes >= 60 ? (x.minutes / 60).toFixed(1) + ' ঘণ্টা' : x.minutes + ' মিনিট'}</span></div>`).join('') || '<p class="muted">সব টিভি অনলাইন ছিল</p>'}</div></div>
      </div>`;
    $$('[data-days]', el).forEach((b) => { b.onclick = () => { sessionStorage.setItem('repDays', b.dataset.days); go('reports'); }; });
  }

  async function pageUsers(el) {
    const [{ users }, { log }] = await Promise.all([api('/users'), api('/audit')]);
    el.innerHTML = `<h2>ইউজার ও লগ</h2>
      <div class="toolbar"><button class="btn primary" id="uadd">+ নতুন ইউজার</button></div>
      <div class="card table-wrap"><table><tr><th>ইউজারনেম</th><th>নাম</th><th>রোল</th><th>অবস্থা</th><th></th></tr>
        ${users.map((u) => `<tr><td>${esc(u.username)}</td><td>${esc(u.display_name)}</td><td>${roleName(u.role)}</td>
          <td>${u.active ? '<span class="pill p-ok">চালু</span>' : '<span class="pill p-mute">বন্ধ</span>'}</td>
          <td><button class="btn sm" data-u="${u.id}">বদলান</button></td></tr>`).join('')}</table></div>
      <div class="card table-wrap"><h3>কে কখন কী বদলালেন (শেষ ৩০০)</h3><table><tr><th>সময়</th><th>ইউজার</th><th>কাজ</th><th>বিস্তারিত</th></tr>
        ${log.map((l) => `<tr><td>${dt(l.at)}</td><td>${esc(l.username || '')}</td><td>${esc(l.action)}</td><td class="muted" style="font-size:12px;word-break:break-all">${esc(l.detail || '')}</td></tr>`).join('')}</table></div>`;
    const roleOpts = (sel) => Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');
    const edit = guard(async (u) => {
      const v = await dialog(u ? `ইউজার: ${u.username}` : 'নতুন ইউজার', `
        ${u ? '' : '<label>ইউজারনেম<input name="username" required pattern="[a-zA-Z0-9_.\\-]{3,30}"></label>'}
        <label>নাম<input name="displayName" value="${esc(u?.display_name || '')}"></label>
        <label>রোল<select name="role">${roleOpts(u?.role || 'reception')}</select></label>
        <label>${u ? 'নতুন পাসওয়ার্ড (খালি = বদলাবে না)' : 'পাসওয়ার্ড'}<input type="password" name="password" minlength="6" ${u ? '' : 'required'}></label>
        ${u ? `<label><span><input type="checkbox" name="active" style="width:auto" ${u.active ? 'checked' : ''}> চালু</span></label>` : ''}`);
      if (!v) return;
      await api('/users', { method: 'POST', body: { id: u?.id, ...v, active: u ? !!v.active : true } });
      toast('✔ সেভ হয়েছে');
      go('users');
    });
    $('#uadd', el).onclick = () => edit(null);
    $$('[data-u]', el).forEach((b) => { b.onclick = () => edit(users.find((u) => u.id === Number(b.dataset.u))); });
  }

  // ---------------------------------------------------------------- boot
  api('/me').then(() => start()).catch(() => showLogin());
})();
