/* LOST RELIC: THE INFINITE CHASE
 * An endless 3D runner built on three.js. All art is procedural (no model files).
 */
(function () {
'use strict';

// ============================================================ utils
const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const chance = (p) => Math.random() < p;
const PI = Math.PI;

// ============================================================ save data
const SAVE_KEY = 'lostrelic_save_v1';
const DEFAULT_SAVE = { coins: 0, best: 0, bestDist: 0, owned: ['rex'], sel: 'rex',
  upg: { magnet: 0, shield: 0, double: 0 }, muted: false, seenStory: false, runs: 0 };
const Save = {
  d: null,
  load() {
    let raw = null;
    try { raw = window.AndroidStore ? window.AndroidStore.get(SAVE_KEY) : localStorage.getItem(SAVE_KEY); } catch (e) {}
    let obj = {};
    try { if (raw) obj = JSON.parse(raw) || {}; } catch (e) {}
    this.d = Object.assign(JSON.parse(JSON.stringify(DEFAULT_SAVE)), obj);
    this.d.upg = Object.assign({ magnet: 0, shield: 0, double: 0 }, obj.upg || {});
    if (!Array.isArray(this.d.owned) || !this.d.owned.length) this.d.owned = ['rex'];
  },
  write() {
    const s = JSON.stringify(this.d);
    try { if (window.AndroidStore) window.AndroidStore.set(SAVE_KEY, s); else localStorage.setItem(SAVE_KEY, s); } catch (e) {}
  },
};
Save.load();
const vibrate = (ms) => { try { if (window.AndroidStore) window.AndroidStore.vibrate(ms); else if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} };

// ============================================================ content
const CHARACTERS = [
  { id: 'rex', name: 'Rex Stone', desc: 'Fearless treasure hunter who found the relic.', mult: 1, cost: 0,
    skin: 0xe2a574, hair: 0x4a2c17, shirt: 0x2f7f86, pants: 0x3d4a35, band: 0xc0392b, boots: 0x5a3b22, pack: 0x7a5230 },
  { id: 'maya', name: 'Maya Swift', desc: 'Jungle scout. Faster than the wind.', mult: 1.2, cost: 2000,
    skin: 0xc68863, hair: 0x1d1410, shirt: 0xe0b040, pants: 0x5b4636, band: 0x2e8b57, boots: 0x3b2a1a, pack: 0x6b8e23 },
  { id: 'kai', name: 'Kai Ember', desc: 'Fire dancer from the lost city.', mult: 1.5, cost: 6000,
    skin: 0x8d5a3b, hair: 0x141010, shirt: 0xc0392b, pants: 0x2b2b2b, band: 0xf39c12, boots: 0x1e1e1e, pack: 0x8b3a1a },
  { id: 'zara', name: 'Zara Frost', desc: 'Diver of the frozen ruins.', mult: 1.8, cost: 15000,
    skin: 0xf1c9a5, hair: 0xe8eaf5, shirt: 0x3b6fd8, pants: 0x1f2d4a, band: 0x9fe8ff, boots: 0x2a3a5a, pack: 0x5a7ab0 },
  { id: 'aurum', name: 'Aurum the Gilded', desc: 'Cursed by the relic. Made of gold.', mult: 2.5, cost: 40000,
    skin: 0xd9ab3c, hair: 0xffdf6e, shirt: 0xb8860b, pants: 0x8a6d1f, band: 0xfff1a8, boots: 0x6b520f, pack: 0xc99a2a },
];
const UPGRADES = [
  { id: 'magnet', name: 'Coin Magnet', desc: 'Pulls nearby coins to you.', base: 8, per: 2.5, color: '#3ee8ff', cls: 'o-magnet' },
  { id: 'shield', name: 'Relic Shield', desc: 'Survive one deadly hit.', base: 10, per: 3, color: '#b77bff', cls: 'o-shield' },
  { id: 'double', name: 'Double Gold', desc: 'Every coin counts twice.', base: 10, per: 3, color: '#4ad07a', cls: 'o-double' },
];
const UPG_COST = [400, 1000, 2200, 4500, 9000];
const upgDur = (id) => { const u = UPGRADES.find((x) => x.id === id); return u.base + u.per * Save.d.upg[id]; };

const THEMES = [
  { name: 'THE WHISPERING JUNGLE', kind: 'jungle', sky: 0xd9e3a6, fogNear: 25, fogFar: 140,
    hemiSky: 0xfff0c8, hemiGround: 0x3b5a2a, hemiI: 1.9, sun: 0xffd890, sunI: 2.4, ground: 0x2b4520,
    tileA: 0x8d8c76, tileB: 0x7a7b69, moss: 0x5f8235, curb: 0x67675a, dust: 0xfff3b0 },
  { name: 'THE ANCIENT TEMPLE', kind: 'temple', sky: 0xf2c47c, fogNear: 25, fogFar: 140,
    hemiSky: 0xffe6b0, hemiGround: 0x7a5a35, hemiI: 1.8, sun: 0xffc070, sunI: 2.6, ground: 0x6e5132,
    tileA: 0xc9a46a, tileB: 0xb38f58, moss: 0x8a9a4a, curb: 0x9a784a, dust: 0xffd98a },
  { name: 'THE ABANDONED CITY', kind: 'city', sky: 0xa99db4, fogNear: 22, fogFar: 130,
    hemiSky: 0xe6dcff, hemiGround: 0x3a3440, hemiI: 1.8, sun: 0xffb48a, sunI: 2.0, ground: 0x3d3a3d,
    tileA: 0x7d7874, tileB: 0x696561, moss: 0x55703a, curb: 0x57534f, dust: 0xe8e0ff },
  { name: 'THE UNDERGROUND TUNNELS', kind: 'tunnel', sky: 0x1a120c, fogNear: 8, fogFar: 75,
    hemiSky: 0xffb070, hemiGround: 0x241810, hemiI: 1.5, sun: 0xff9a50, sunI: 1.2, ground: 0x1d1511,
    tileA: 0x6a5644, tileB: 0x58483a, moss: 0x3e5a2a, curb: 0x44372c, dust: 0xffa050 },
];
const ZONE_LEN = 650;
const ZONE_OFFSET = (+((location.hash.match(/zone=(\d)/) || [])[1]) || 0) * ZONE_LEN; // debug: #zone=N

// ============================================================ constants
const LANE_W = 2.2;
const PATH_HALF = 3.6;
const GRAV = 34;
const JUMP_V = 12;
const SLIDE_TIME = 0.78;
const HEADINGS = [new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0)];
const speedAt = (dist) => Math.min(15 + dist * 0.0068, 33);

// ============================================================ renderer / scene
const container = $('game');
const renderer = new THREE.WebGLRenderer({ antialias: (window.devicePixelRatio || 1) < 2, powerPreference: 'high-performance' });
const PIXEL_RATIO = Math.min(window.devicePixelRatio || 1, 1.6);
renderer.setPixelRatio(PIXEL_RATIO);
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const skyColor = new THREE.Color(THEMES[0].sky);
scene.background = skyColor;
scene.fog = new THREE.Fog(skyColor, THEMES[0].fogNear, THEMES[0].fogFar);
const camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.1, 230);

const hemi = new THREE.HemisphereLight(THEMES[0].hemiSky, THEMES[0].hemiGround, THEMES[0].hemiI);
scene.add(hemi);
const sun = new THREE.DirectionalLight(THEMES[0].sun, THEMES[0].sunI);
sun.position.set(-20, 40, -30);
scene.add(sun);
scene.add(sun.target);

const groundMat = new THREE.MeshLambertMaterial({ color: THEMES[0].ground });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), groundMat);
ground.rotation.x = -PI / 2;
ground.position.y = -0.42;
scene.add(ground);

// sun glow sprite (a soft disc far away)
function radialTexture(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner); gr.addColorStop(1, outer); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); return t;
}
const glowTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.fov = camera.aspect < 0.7 ? 68 : 60;
  camera.updateProjectionMatrix();
});
camera.fov = camera.aspect < 0.7 ? 68 : 60; camera.updateProjectionMatrix();

// ============================================================ geometry merging
const BG = {
  box: new THREE.BoxGeometry(1, 1, 1).toNonIndexed(),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 8).toNonIndexed(),
  cylT: new THREE.CylinderGeometry(0.38, 0.5, 1, 7).toNonIndexed(),
  cone: new THREE.ConeGeometry(0.5, 1, 7).toNonIndexed(),
  ico: new THREE.IcosahedronGeometry(0.5, 0),
  ico1: new THREE.IcosahedronGeometry(0.5, 1),
  oct: new THREE.OctahedronGeometry(0.5, 0),
};
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
class Builder {
  constructor() { this.items = []; this.count = 0; }
  add(g, color, x, y, z, sx, sy, sz, rx, ry, rz, jit) {
    _e.set(rx || 0, ry || 0, rz || 0); _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    this.items.push({ g, m: _m.clone(), c: color, j: jit == null ? 0.07 : jit });
    this.count += g.attributes.position.count;
  }
  build() {
    if (!this.items.length) return null;
    const pos = new Float32Array(this.count * 3), nor = new Float32Array(this.count * 3), col = new Float32Array(this.count * 3);
    const v = new THREE.Vector3(), nm = new THREE.Matrix3(), c = new THREE.Color();
    let o = 0;
    for (const it of this.items) {
      const P = it.g.attributes.position.array, N = it.g.attributes.normal.array, n = it.g.attributes.position.count;
      nm.getNormalMatrix(it.m);
      c.setHex(it.c);
      if (it.j) { const k = 1 + (Math.random() * 2 - 1) * it.j; c.r *= k; c.g *= k; c.b *= k; }
      for (let i = 0; i < n; i++) {
        const k = (o + i) * 3;
        v.fromArray(P, i * 3).applyMatrix4(it.m); pos[k] = v.x; pos[k + 1] = v.y; pos[k + 2] = v.z;
        v.fromArray(N, i * 3).applyMatrix3(nm).normalize(); nor[k] = v.x; nor[k + 1] = v.y; nor[k + 2] = v.z;
        col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
      }
      o += n;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    return geo;
  }
}
const matLit = new THREE.MeshLambertMaterial({ vertexColors: true });
const matGlow = new THREE.MeshBasicMaterial({ vertexColors: true });

// ============================================================ track pieces
let pieceSeq = 0;
const pieces = []; // active pieces in order

function obstacleSpacing(dist) {
  const diff = clamp(dist / 3500, 0, 1);
  const sp = speedAt(dist);
  return Math.max(15, sp * rand(lerp(1.7, 0.95, diff), lerp(2.6, 1.45, diff)));
}

function makePiece(prev) {
  const p = { id: pieceSeq++, obs: [], gaps: [], coins: [], items: [] };
  if (!prev) {
    p.origin = new THREE.Vector3(0, 0, 0); p.h = 0; p.startD = -40; p.genDist = 0; p.cameFrom = 0;
  } else {
    p.origin = prev.origin.clone().addScaledVector(prev.fwd, prev.length);
    p.h = prev.turn === 'R' ? (prev.h + 1) % 4 : (prev.h + 3) % 4;
    p.startD = PATH_HALF; p.genDist = prev.genDist + prev.length;
    p.cameFrom = prev.turn === 'R' ? 1 : -1;
  }
  p.fwd = HEADINGS[p.h].clone(); p.right = HEADINGS[(p.h + 1) % 4].clone();
  p.yaw = -p.h * PI / 2;
  p.themeIdx = Math.floor((p.genDist + 30 + ZONE_OFFSET) / ZONE_LEN) % THEMES.length;
  p.theme = THEMES[p.themeIdx];
  p.length = prev ? randi(80, 140) : 150;
  p.turn = p.h === 0 ? (chance(0.5) ? 'L' : 'R') : p.h === 1 ? 'L' : 'R';
  p.turnSide = p.turn === 'R' ? 1 : -1;
  generateObstacles(p, !prev);
  generateCoins(p);
  buildPieceMesh(p);
  if (prev) prev.next = p;
  pieces.push(p);
  return p;
}

function generateObstacles(p, first) {
  const diff = clamp(p.genDist / 3500, 0, 1);
  let d = first ? 70 : 32;
  const endD = p.length - 26;
  while (d < endD) {
    const r = Math.random();
    let o;
    const types = diff < 0.08 ? ['block', 'block', 'log', 'beam'] : ['block', 'block', 'log', 'beam', 'gap', 'gap', 'block2'];
    const t = pick(types);
    if (t === 'block' || t === 'block2') {
      const n = t === 'block2' || (r < 0.25 + diff * 0.4) ? 2 : 1;
      const lanes = [false, false, false];
      const order = [0, 1, 2].sort(() => Math.random() - 0.5);
      for (let i = 0; i < n; i++) lanes[order[i]] = true;
      o = { type: 'block', d0: d - 0.9, d1: d + 0.9, lanes };
    } else if (t === 'log') {
      o = { type: 'log', d0: d - 0.45, d1: d + 0.45 };
    } else if (t === 'beam') {
      o = { type: 'beam', d0: d - 0.5, d1: d + 0.5 };
    } else {
      const len = rand(2.6, 3.4 + diff * 1.4);
      o = { type: 'gap', d0: d, d1: d + len };
      p.gaps.push(o);
    }
    o.c = (o.d0 + o.d1) / 2;
    p.obs.push(o);
    d = o.d1 + obstacleSpacing(p.genDist + d);
  }
  // power-up orb
  if (!first || chance(0.5)) {
    if (chance(first ? 1 : 0.55)) {
      const kind = pick(['magnet', 'magnet', 'shield', 'double']);
      // find a gap between obstacles
      for (let tries = 0; tries < 12; tries++) {
        const dd = rand(25, p.length - 30);
        if (p.obs.every((o) => dd < o.d0 - 6 || dd > o.d1 + 6)) { p.items.push({ kind, d: dd, lane: randi(0, 2), alive: true }); break; }
      }
    }
  }
}

function blockedAt(p, lane, d, pad) {
  for (const o of p.obs) if (o.type === 'block' && o.lanes[lane] && d > o.d0 - pad && d < o.d1 + pad) return true;
  return false;
}

function generateCoins(p) {
  let d = p.startD < 0 ? 12 : 14;
  let lane = randi(0, 2);
  const endD = p.length - 22;
  while (d < endD) {
    if (chance(0.62)) {
      const n = randi(6, 12);
      // choose a lane free along the run
      const lanes = [0, 1, 2].sort(() => Math.random() - 0.5); lanes.unshift(lane);
      for (const L of lanes) {
        let ok = true;
        for (let i = 0; i < n; i++) if (blockedAt(p, L, d + i * 2.3, 1.6)) { ok = false; break; }
        if (ok) { lane = L; break; }
        lane = -1;
      }
      if (lane >= 0) {
        for (let i = 0; i < n; i++) {
          const dc = d + i * 2.3;
          if (dc > endD) break;
          let y = 1.0;
          for (const o of p.obs) {
            const half = (o.d1 - o.d0) / 2 + 4.6;
            if ((o.type === 'log' || o.type === 'gap') && Math.abs(dc - o.c) < half) {
              y = Math.max(y, 1.0 + 2.2 * Math.cos((dc - o.c) / half * PI / 2));
            } else if (o.type === 'beam' && Math.abs(dc - o.c) < 2.5) y = 0.55;
          }
          p.coins.push({ d: dc, x: (lane - 1) * LANE_W, y });
        }
        d += n * 2.3 + rand(8, 22);
      } else { lane = randi(0, 2); d += 10; }
    } else d += rand(10, 24);
  }
}

// ----------------------------------------------------------- visuals

function buildPieceMesh(p) {
  const b = new Builder(), g = new Builder();
  const T = p.theme;
  const endD = p.length + PATH_HALF;
  const gapsSorted = p.gaps.slice().sort((a, c) => a.d0 - c.d0);
  const solidIntervals = (a, c) => {
    let segs = [[a, c]];
    for (const gp of gapsSorted) {
      const out = [];
      for (const [s, e] of segs) {
        if (gp.d1 <= s || gp.d0 >= e) { out.push([s, e]); continue; }
        if (gp.d0 > s) out.push([s, gp.d0]);
        if (gp.d1 < e) out.push([gp.d1, e]);
      }
      segs = out;
    }
    return segs;
  };
  // ---- floor tiles
  const TL = 2.4;
  for (let r = p.startD; r < endD; r += TL) {
    const r1 = Math.min(r + TL, endD);
    for (const [s, e] of solidIntervals(r, r1)) {
      if (e - s < 0.05) continue;
      for (let i = -1; i <= 1; i++) {
        const mossy = chance(0.16);
        const col = mossy ? T.moss : chance(0.5) ? T.tileA : T.tileB;
        b.add(BG.box, col, i * 2.4, -0.21 + rand(-0.03, 0.025), -(s + e) / 2, 2.34, 0.42, (e - s) - 0.06, 0, 0, 0, 0.08);
      }
    }
  }
  // ---- curbs (side edges)
  for (const side of [-1, 1]) {
    let from = p.startD, to = endD;
    if (side === p.turnSide) to = p.length - PATH_HALF;
    for (const [s, e] of solidIntervals(from, to)) {
      for (let r = s; r < e; r += 3) {
        const r1 = Math.min(r + 3, e);
        if (r1 - r < 0.1) continue;
        b.add(BG.box, T.curb, side * (PATH_HALF + 0.3), -0.05 + rand(0, 0.15), -(r + r1) / 2, 0.6, 0.7, (r1 - r) - 0.08, 0, 0, 0, 0.1);
      }
    }
  }
  // ---- gaps: dark pits with broken edges
  for (const gp of p.gaps) {
    g.add(BG.box, 0x050302, 0, -0.39, -(gp.d0 + gp.d1) / 2, PATH_HALF * 2 + 1.4, 0.02, gp.d1 - gp.d0, 0, 0, 0, 0);
    for (let i = 0; i < 5; i++) {
      b.add(BG.ico, T.tileB, rand(-3, 3), -0.15, -(chance(0.5) ? gp.d0 + 0.1 : gp.d1 - 0.1), rand(0.4, 0.8), rand(0.3, 0.5), rand(0.4, 0.8), rand(0, 3), rand(0, 3), 0, 0.1);
    }
  }
  // ---- corner end wall + turn arrow
  {
    const wd = p.length + PATH_HALF + 1.2;
    const wallCol = T.kind === 'jungle' ? 0x6d6a58 : T.kind === 'temple' ? 0xa8834f : T.kind === 'city' ? 0x67615c : 0x3e3026;
    for (let i = -6; i <= 6; i++) {
      const h = rand(5, 8);
      b.add(BG.box, wallCol, i * 1.5, h / 2 - 0.4, -wd - rand(0, 0.6), 1.5, h, 1.6, 0, 0, 0, 0.12);
    }
    if (T.kind === 'jungle' || T.kind === 'city') for (let i = 0; i < 6; i++) b.add(BG.ico1, T.moss, rand(-8, 8), rand(4, 8), -wd + 0.4, rand(1.5, 3), rand(1.5, 2.5), 1.2, 0, 0, 0, 0.15);
    // glowing arrow on wall
    const s = p.turnSide;
    const ac = 0xffc83a;
    g.add(BG.box, ac, s * 0.4, 2.6, -wd + 0.85, 2.4, 0.45, 0.1, 0, 0, 0, 0);
    g.add(BG.box, ac, s * 1.45, 2.95, -wd + 0.85, 1.2, 0.42, 0.1, 0, 0, -s * 0.75, 0);
    g.add(BG.box, ac, s * 1.45, 2.25, -wd + 0.85, 1.2, 0.42, 0.1, 0, 0, s * 0.75, 0);
    // wall on the non-turn side of the corner square
    const ns = -p.turnSide;
    for (let r = p.length - PATH_HALF; r < p.length + PATH_HALF + 1; r += 1.6) {
      const h = rand(3.5, 6);
      b.add(BG.box, wallCol, ns * (PATH_HALF + 1.2), h / 2 - 0.4, -r, 1.4, h, 1.7, 0, 0, 0, 0.12);
    }
  }
  // ---- obstacles
  for (const o of p.obs) if (o.type !== 'gap') buildObstacle(b, g, T, o);
  // ---- decor
  buildDecor(b, g, p);

  const group = new THREE.Group();
  group.position.copy(p.origin);
  group.rotation.y = p.yaw;
  const g1 = b.build(); if (g1) group.add(new THREE.Mesh(g1, matLit));
  const g2 = g.build(); if (g2) group.add(new THREE.Mesh(g2, matGlow));
  group.matrixAutoUpdate = false; group.updateMatrix();
  group.children.forEach((c) => { c.matrixAutoUpdate = false; c.updateMatrix(); });
  scene.add(group);
  p.group = group;

  // coins -> world
  for (const c of p.coins) {
    const w = worldPos(p, c.d, c.x, c.y);
    c.wx = w.x; c.wy = w.y; c.wz = w.z; c.alive = true; c.p = p;
    allCoins.push(c);
  }
  for (const it of p.items) {
    const w = worldPos(p, it.d, (it.lane - 1) * LANE_W, 1.25);
    it.mesh = makeOrbMesh(it.kind); it.mesh.position.copy(w); it.base = w.y; scene.add(it.mesh);
  }
}

function buildObstacle(b, g, T, o) {
  const z = -o.c;
  const k = T.kind;
  if (o.type === 'log') {
    if (k === 'jungle') {
      b.add(BG.cyl, 0x5b3a1e, 0, 0.42, z, 0.85, PATH_HALF * 2 + 1.6, 0.85, 0, 0, PI / 2, 0.08);
      b.add(BG.cyl, 0x8a6a3c, -PATH_HALF - 0.8, 0.42, z, 0.75, 0.05, 0.75, 0, 0, PI / 2, 0);
      for (let i = 0; i < 4; i++) b.add(BG.ico, T.moss, rand(-3, 3), 0.8, z + rand(-0.2, 0.2), rand(0.6, 1.0), 0.3, 0.6, 0, 0, 0, 0.15);
      for (let i = 0; i < 3; i++) b.add(BG.cyl, 0x4a2e16, rand(-3, 3), 0.5, z - 0.4, 0.14, 0.9, 0.14, rand(-0.6, 0.6), 0, rand(0.4, 1.2), 0.1);
    } else if (k === 'temple') {
      b.add(BG.box, 0xb89056, 0, 0.38, z, PATH_HALF * 2 + 0.4, 0.8, 0.8, 0, 0, 0, 0.05);
      for (let i = -3; i <= 3; i++) b.add(BG.box, 0x8a6a3a, i * 1.05, 0.38, z - 0.41, 0.6, 0.35, 0.05, 0, 0, PI / 4, 0);
      b.add(BG.box, 0xd4ad6b, 0, 0.82, z, PATH_HALF * 2 + 0.5, 0.1, 0.9, 0, 0, 0, 0);
    } else if (k === 'city') {
      b.add(BG.cyl, 0xa49e94, 0, 0.45, z, 0.9, PATH_HALF * 2 + 1.0, 0.9, 0.05, 0, PI / 2 + 0.03, 0.05);
      for (let i = -2; i <= 2; i++) b.add(BG.cyl, 0x8f897f, i * 1.55, 0.45, z, 0.95, 0.12, 0.95, 0, 0, PI / 2, 0);
      for (let i = 0; i < 4; i++) b.add(BG.ico, 0x8a847c, rand(-3, 3), 0.15, z + rand(-1, 1), 0.5, 0.4, 0.5, rand(0, 3), 0, 0, 0.1);
    } else {
      b.add(BG.box, 0x6b4a2a, 0, 0.62, z, PATH_HALF * 2 + 0.6, 0.28, 0.3, 0, 0, 0, 0.06);
      b.add(BG.box, 0x5a3d22, 0, 0.25, z, PATH_HALF * 2 + 0.6, 0.22, 0.3, 0, 0, 0, 0.06);
      for (let i = -1; i <= 1; i++) b.add(BG.box, 0x4a3020, i * 3, 0.4, z, 0.3, 0.85, 0.35, 0, 0, 0, 0);
      for (let i = 0; i < 4; i++) b.add(BG.ico, 0x5a4a3c, rand(-3, 3), 0.15, z + 0.4, 0.6, 0.45, 0.5, rand(0, 3), 0, 0, 0.1);
    }
  } else if (o.type === 'beam') {
    const postCol = k === 'jungle' ? 0x4f3a24 : k === 'temple' ? 0xa8834f : k === 'city' ? 0x6c665f : 0x5a3d22;
    for (const s of [-1, 1]) b.add(k === 'jungle' ? BG.cylT : BG.box, postCol, s * (PATH_HALF + 0.7), 2.0, z, 1.0, 4.8, 1.0, 0, 0, 0, 0.08);
    if (k === 'jungle') {
      b.add(BG.cyl, 0x5b3a1e, 0, 1.95, z, 0.75, PATH_HALF * 2 + 2.4, 0.75, 0, 0, PI / 2 + 0.04, 0.05);
      for (let i = 0; i < 6; i++) { const x = rand(-3.2, 3.2), h = rand(0.4, 0.9); b.add(BG.box, 0x3f6a26, x, 1.6 - h / 2 + 0.05, z, 0.07, h, 0.07, 0, 0, 0, 0.2); }
      for (let i = 0; i < 4; i++) b.add(BG.ico1, 0x4c7a2c, rand(-3.5, 3.5), 2.35, z, rand(0.8, 1.3), 0.6, 0.9, 0, 0, 0, 0.15);
    } else if (k === 'temple') {
      b.add(BG.box, 0xc29a5e, 0, 2.05, z, PATH_HALF * 2 + 2.4, 0.85, 1.0, 0, 0, 0, 0.04);
      b.add(BG.box, 0x7a5a30, 0, 1.6, z, PATH_HALF * 2 + 1.6, 0.12, 1.05, 0, 0, 0, 0);
      // fire jets under the lintel
      for (let i = -3; i <= 3; i++) {
        g.add(BG.cone, 0xff6a10, i * 1.05, 1.4, z, 0.45, 0.35, 0.45, PI, 0, 0, 0.1);
        g.add(BG.cone, 0xffd040, i * 1.05, 1.45, z, 0.25, 0.22, 0.25, PI, 0, 0, 0.1);
      }
    } else if (k === 'city') {
      b.add(BG.box, 0x7d776f, 0, 2.05, z, PATH_HALF * 2 + 2.2, 0.8, 0.9, 0, 0, 0.06, 0.05);
      b.add(BG.box, 0x5a5550, 0, 2.6, z, 1.6, 0.4, 1.0, 0, 0, 0, 0);
      for (let i = 0; i < 5; i++) b.add(BG.box, 0x55703a, rand(-3.5, 3.5), 1.5, z - 0.45, 0.1, rand(0.3, 0.6), 0.05, 0, 0, 0, 0.2);
    } else {
      b.add(BG.box, 0x6b4a2a, 0, 2.05, z, PATH_HALF * 2 + 2.2, 0.7, 0.7, 0, 0, 0, 0.05);
      g.add(BG.box, 0xffb050, -1.5, 1.45, z, 0.28, 0.35, 0.28, 0, 0, 0, 0);
      g.add(BG.box, 0xffb050, 1.5, 1.45, z, 0.28, 0.35, 0.28, 0, 0, 0, 0);
      b.add(BG.box, 0x222222, -1.5, 1.7, z, 0.04, 0.3, 0.04, 0, 0, 0, 0);
      b.add(BG.box, 0x222222, 1.5, 1.7, z, 0.04, 0.3, 0.04, 0, 0, 0, 0);
    }
  } else if (o.type === 'block') {
    for (let lane = 0; lane < 3; lane++) {
      if (!o.lanes[lane]) continue;
      const x = (lane - 1) * LANE_W;
      if (k === 'jungle') {
        if (chance(0.5)) {
          b.add(BG.ico, 0x77776a, x, 0.9, z, 2.1, 2.3, 1.9, rand(0, 3), rand(0, 3), 0, 0.1);
          b.add(BG.ico1, T.moss, x, 1.9, z, 1.6, 0.6, 1.4, 0, 0, 0, 0.15);
        } else {
          b.add(BG.cylT, 0x5b3a1e, x, 1.0, z, 1.7, 2.4, 1.7, 0, 0, 0, 0.08);
          b.add(BG.cyl, 0xa07a48, x, 2.21, z, 1.3, 0.04, 1.3, 0, 0, 0, 0);
          for (let i = 0; i < 4; i++) b.add(BG.box, 0x4a2e16, x + rand(-0.9, 0.9), 0.15, z + rand(-0.9, 0.9), 0.3, 0.3, 1.0, 0, rand(0, 3), 0.3, 0.1);
        }
      } else if (k === 'temple') {
        // guardian statue
        b.add(BG.box, 0x9a7a4a, x, 0.3, z, 1.9, 0.6, 1.7, 0, 0, 0, 0.04);
        b.add(BG.box, 0xb89a68, x, 1.4, z, 1.4, 1.7, 1.1, 0, 0, 0, 0.05);
        b.add(BG.box, 0xc2a472, x, 2.65, z, 1.0, 0.9, 0.9, 0, 0, 0, 0.05);
        b.add(BG.box, 0x9a7a4a, x, 3.15, z, 1.2, 0.2, 1.0, 0, 0, 0, 0);
        g.add(BG.box, 0x40e0ff, x - 0.22, 2.72, z - 0.46, 0.18, 0.1, 0.04, 0, 0, 0, 0);
        g.add(BG.box, 0x40e0ff, x + 0.22, 2.72, z - 0.46, 0.18, 0.1, 0.04, 0, 0, 0, 0);
      } else if (k === 'city') {
        if (chance(0.5)) { // broken cart
          b.add(BG.box, 0x6b4a2a, x, 0.95, z, 1.8, 0.9, 1.6, 0, rand(-0.2, 0.2), 0.08, 0.08);
          b.add(BG.cyl, 0x3a2a1a, x - 0.95, 0.55, z, 1.1, 0.15, 1.1, 0, 0, PI / 2, 0);
          b.add(BG.cyl, 0x3a2a1a, x + 0.95, 0.55, z, 1.1, 0.15, 1.1, 0, 0, PI / 2, 0);
          b.add(BG.box, 0x8a6a3a, x, 1.6, z, 1.6, 0.5, 1.4, 0, 0.4, 0, 0.1);
        } else { // rubble pile
          for (let i = 0; i < 4; i++) b.add(BG.box, 0x7a746c, x + rand(-0.4, 0.4), 0.5 + i * 0.5, z + rand(-0.3, 0.3), rand(1.2, 1.8), 0.6, rand(1.0, 1.5), 0, rand(0, 1), rand(-0.15, 0.15), 0.1);
        }
      } else {
        b.add(BG.ico, 0x4a3c30, x, 0.9, z, 2.0, 2.2, 1.9, rand(0, 3), rand(0, 3), 0, 0.1);
        const cc = chance(0.5) ? 0x50f0ff : 0xff5cf0;
        for (let i = 0; i < 3; i++) g.add(BG.oct, cc, x + rand(-0.6, 0.6), 1.9 + rand(0, 0.5), z + rand(-0.5, 0.2), 0.35, rand(1.0, 1.6), 0.35, rand(-0.4, 0.4), 0, rand(-0.4, 0.4), 0.1);
      }
    }
  }
}

function torch(b, g, x, z, h) {
  b.add(BG.cyl, 0x3a2614, x, h / 2 - 0.2, z, 0.16, h, 0.16, 0, 0, 0, 0);
  b.add(BG.cyl, 0x2a1a0e, x, h - 0.1, z, 0.34, 0.25, 0.34, 0, 0, 0, 0);
  g.add(BG.cone, 0xff7a18, x, h + 0.25, z, 0.42, 0.7, 0.42, 0, 0, 0, 0.1);
  g.add(BG.cone, 0xffe070, x, h + 0.18, z, 0.22, 0.42, 0.22, 0, 0, 0, 0.05);
}

function buildDecor(b, g, p) {
  const T = p.theme, k = T.kind;
  const endD = p.length + PATH_HALF;
  for (const s of [-1, 1]) {
    const dMin = s === p.cameFrom ? PATH_HALF + 6 : p.startD;
    const dMax = s === p.turnSide ? p.length - PATH_HALF - 6 : endD + 6;
    const ok = (d) => d >= dMin && d <= dMax;
    // torches / lamps near path edge
    const tStep = k === 'tunnel' ? 14 : 22;
    for (let d = dMin + rand(2, 8); d < dMax; d += tStep) {
      if (k === 'city') {
        b.add(BG.cyl, 0x2d2d33, s * (PATH_HALF + 1.2), 2.4, -d, 0.14, 5.2, 0.14, 0, 0, 0, 0);
        b.add(BG.box, 0x2d2d33, s * (PATH_HALF + 0.85), 4.95, -d, 0.8, 0.1, 0.1, 0, 0, 0, 0);
        g.add(BG.box, 0xffd27a, s * (PATH_HALF + 0.5), 4.75, -d, 0.3, 0.35, 0.3, 0, 0, 0, 0);
      } else torch(b, g, s * (PATH_HALF + 1.1), -d, k === 'temple' ? 2.2 : 1.8);
    }
    if (k === 'jungle') {
      for (let d = dMin; d < dMax; d += rand(4, 8)) {
        const r = Math.random(), x = s * rand(6, 15);
        if (r < 0.55) { // tree
          const h = rand(7, 13), tw = rand(0.7, 1.3);
          b.add(BG.cylT, 0x5a3d22, x, h / 2 - 0.4, -d, tw, h, tw, 0, rand(0, 3), 0, 0.12);
          for (let i = 0; i < 3; i++) b.add(BG.ico1, pick([0x2f5a22, 0x3b6e2a, 0x24481a, 0x4a7a2c]), x + rand(-1.5, 1.5), h + rand(-1, 1.5), -d + rand(-1.5, 1.5), rand(3.5, 5.5), rand(2.5, 4), rand(3.5, 5.5), 0, 0, 0, 0.1);
          // buttress roots
          for (let i = 0; i < 3; i++) b.add(BG.box, 0x4e3420, x + rand(-0.8, 0.8), 0.3, -d + rand(-0.8, 0.8), 0.25, 1.4, 1.5, 0, rand(0, 3), 0, 0.1);
        } else if (r < 0.75) { // ruin wall chunk
          const w = rand(2, 4), h = rand(1.5, 4);
          b.add(BG.box, 0x77776a, x, h / 2 - 0.4, -d, w, h, 1.2, 0, rand(-0.3, 0.3), rand(-0.05, 0.05), 0.12);
          b.add(BG.ico1, T.moss, x, h - 0.2, -d, w * 0.8, 0.6, 1.3, 0, 0, 0, 0.15);
        } else { // ferns / bush
          b.add(BG.ico1, pick([0x3e7a2a, 0x2f6020, 0x4c8a30]), s * rand(4.5, 6.5), 0.3, -d, rand(1.6, 2.8), rand(1.2, 2), rand(1.6, 2.8), 0, 0, 0, 0.12);
        }
        if (chance(0.35)) b.add(BG.cone, 0x3f7a2a, s * rand(4.4, 5.6), 0.6, -d - 2, 1.3, 1.6, 1.3, 0, 0, 0, 0.15);
      }
      // occasional canopy over the path
      for (let d = dMin + 20; d < dMax - 10 && s === 1; d += rand(35, 60)) {
        if (!ok(d) || d > p.length - PATH_HALF - 6) continue;
        b.add(BG.cyl, 0x4f3420, 0, 8.5, -d, 0.6, PATH_HALF * 2 + 14, 0.6, 0, 0, PI / 2 + rand(-0.08, 0.08), 0.1);
        for (let i = 0; i < 6; i++) b.add(BG.box, 0x3f6a26, rand(-4, 4), 8.5 - 1.2, -d, 0.08, rand(1.4, 3.2), 0.08, 0, 0, 0, 0.2);
        for (let i = 0; i < 3; i++) b.add(BG.ico1, 0x2f5a22, rand(-5, 5), 9, -d, 3, 1.4, 2.4, 0, 0, 0, 0.1);
      }
    } else if (k === 'temple') {
      for (let d = dMin + 2; d < dMax; d += 9) {
        const x = s * rand(5.2, 6.2), h = rand(9, 14);
        b.add(BG.box, 0xa8834f, x, 0.3, -d, 2.6, 1.4, 2.6, 0, 0, 0, 0.06);
        b.add(BG.cyl, 0xc9a46a, x, h / 2, -d, 1.8, h, 1.8, 0, 0, 0, 0.06);
        b.add(BG.box, 0xa8834f, x, h + 0.4, -d, 2.8, 0.8, 2.8, 0, 0, 0, 0.06);
        if (chance(0.3)) b.add(BG.ico1, T.moss, x, h * 0.6, -d - 0.8, 1.2, 3, 0.8, 0, 0, 0, 0.15);
      }
      for (let d = dMin; d < dMax; d += 4) { // back wall
        const h = rand(10, 16);
        b.add(BG.box, pick([0x8f6d40, 0x9c7a4a, 0x87663c]), s * rand(11, 12.5), h / 2 - 0.4, -d, 2.5, h, 4.1, 0, 0, 0, 0.05);
      }
      for (let d = dMin + 10; d < dMax; d += rand(25, 45)) { // seated idols
        const x = s * 8.2;
        b.add(BG.box, 0x9a7a4a, x, 1.0, -d, 2.6, 2.8, 2.6, 0, 0, 0, 0.05);
        b.add(BG.box, 0xb89a68, x, 3.6, -d, 2.0, 2.6, 1.6, 0, 0, 0, 0.05);
        b.add(BG.box, 0xc2a472, x, 5.5, -d, 1.5, 1.4, 1.4, 0, 0, 0, 0.05);
        g.add(BG.box, 0xff4020, x - s * 0.71, 5.6, -d - 0.3, 0.05, 0.16, 0.25, 0, 0, 0, 0);
        g.add(BG.box, 0xff4020, x - s * 0.71, 5.6, -d + 0.3, 0.05, 0.16, 0.25, 0, 0, 0, 0);
      }
      if (s === 1) for (let d = dMin + 30; d < p.length - PATH_HALF - 12; d += rand(50, 80)) { // gate
        for (const ss of [-1, 1]) b.add(BG.box, 0xb08a54, ss * (PATH_HALF + 2), 4.5, -d, 1.6, 9.8, 1.6, 0, 0, 0, 0.04);
        b.add(BG.box, 0xa8834f, 0, 9.6, -d, PATH_HALF * 2 + 6, 1.4, 2, 0, 0, 0, 0.04);
        b.add(BG.box, 0xd4ad6b, 0, 10.5, -d, 3, 1, 1.6, 0, 0, 0, 0.04);
      }
    } else if (k === 'city') {
      for (let d = dMin; d < dMax; d += rand(6, 10)) {
        const w = rand(5, 8), h = rand(7, 20), dep = rand(5, 9), x = s * (PATH_HALF + 3.5 + w / 2 + rand(0, 3));
        const col = pick([0x8a8178, 0x7a6e64, 0x958a7c, 0x6e665e, 0x8c7a68]);
        b.add(BG.box, col, x, h / 2 - 0.4, -d, w, h, dep, 0, 0, 0, 0.06);
        // broken top
        b.add(BG.box, col, x + rand(-1, 1), h - 0.2, -d, w * 0.6, 1.5, dep * 0.6, 0, rand(-0.3, 0.3), rand(-0.3, 0.3), 0.08);
        // windows on the facade facing the path
        const fx = x - s * (w / 2 + 0.02);
        for (let wy = 2.5; wy < h - 2; wy += 3) for (let wz = -dep / 2 + 1.2; wz < dep / 2 - 0.8; wz += 2.2) {
          if (chance(0.12)) g.add(BG.box, 0xffc870, fx, wy, -d + wz, 0.05, 1.3, 0.9, 0, 0, 0, 0.2);
          else b.add(BG.box, 0x1e1a18, fx, wy, -d + wz, 0.06, 1.3, 0.9, 0, 0, 0, 0.1);
        }
        if (chance(0.5)) b.add(BG.box, T.moss, fx - s * 0.05, h * 0.5, -d + rand(-2, 2), 0.1, h * rand(0.4, 0.8), 0.6, 0, 0, 0, 0.2);
        if (chance(0.3)) b.add(BG.cyl, 0x9a948c, s * rand(4.6, 6), 0.2, -d - 3, 0.8, 4, 0.8, PI / 2, rand(0, 3), 0, 0.05);
      }
    } else { // tunnel
      for (let d = dMin; d < dMax; d += 2.5) {
        const h = rand(6.5, 8.5);
        b.add(BG.box, pick([0x3a2c22, 0x45352a, 0x33271e]), s * (PATH_HALF + 2.2 + rand(0, 0.8)), h / 2 - 0.4, -d, rand(2, 3), h, 2.7, rand(-0.1, 0.1), rand(-0.2, 0.2), 0, 0.1);
        if (chance(0.12)) {
          const cc = pick([0x50f0ff, 0xff5cf0, 0x7aff8a]);
          for (let i = 0; i < 3; i++) g.add(BG.oct, cc, s * (PATH_HALF + 1.1), rand(0.4, 3.5), -d + rand(-1, 1), 0.3, rand(0.8, 1.4), 0.3, rand(-0.6, 0.6), 0, s * rand(0.3, 0.9), 0.1);
        }
      }
      // ceiling + supports
      if (s === 1) {
        const cMax = Math.min(endD, p.length + PATH_HALF);
        for (let d = Math.max(p.startD, -10); d < cMax; d += 3) b.add(BG.box, pick([0x2e231b, 0x382a20]), 0, 7.4 + rand(0, 0.6), -d, PATH_HALF * 2 + 6, 1.2, 3.1, 0, 0, 0, 0.1);
        for (let d = Math.max(p.startD, 4); d < p.length - PATH_HALF - 4; d += 9) {
          for (const ss of [-1, 1]) b.add(BG.box, 0x5a3d22, ss * (PATH_HALF + 0.9), 2.8, -d, 0.45, 6.4, 0.45, 0, 0, 0, 0.08);
          b.add(BG.box, 0x5a3d22, 0, 5.9, -d, PATH_HALF * 2 + 2.4, 0.45, 0.5, 0, 0, 0, 0.08);
          if (chance(0.5)) for (let i = 0; i < 2; i++) b.add(BG.cone, 0x4a3a2e, rand(-3, 3), 6.3, -d - 1.5, 0.5, 1.6, 0.5, PI, 0, 0, 0.1);
        }
      }
    }
  }
  // the opening temple of piece 0 (behind start)
  if (p.startD < 0) {
    const col = 0x8f8a74;
    for (const s of [-1, 1]) b.add(BG.box, col, s * (PATH_HALF + 2.5), 5, 12, 4, 11, 5, 0, 0, 0, 0.05);
    b.add(BG.box, col, 0, 10.5, 12, PATH_HALF * 2 + 9, 2.5, 5, 0, 0, 0, 0.05);
    b.add(BG.box, 0x6e6a58, 0, 12.6, 12, PATH_HALF * 2 + 4, 1.8, 4, 0, 0, 0, 0.05);
    b.add(BG.box, 0x5a5648, 0, 14.4, 12, 5, 2, 3, 0, 0, 0, 0.05);
    g.add(BG.box, 0x0a0604, 0, 4.5, 14.2, PATH_HALF * 2 + 1, 9.2, 0.2, 0, 0, 0, 0);
    for (let i = 0; i < 8; i++) b.add(BG.ico1, 0x4a7a2c, rand(-8, 8), rand(7, 13), 9.4, rand(1.5, 3), rand(1.5, 3), 1, 0, 0, 0, 0.15);
  }
}

function worldPos(p, d, x, y, out) {
  out = out || new THREE.Vector3();
  return out.copy(p.origin).addScaledVector(p.fwd, d).addScaledVector(p.right, x).setY(y || 0);
}

function disposePiece(p) {
  scene.remove(p.group);
  p.group.children.forEach((c) => c.geometry.dispose());
  for (const c of p.coins) c.alive = false;
  for (const it of p.items) if (it.mesh) scene.remove(it.mesh);
  const i = pieces.indexOf(p); if (i >= 0) pieces.splice(i, 1);
}

// ============================================================ coins (instanced)
const allCoins = [];
const MAX_COINS = 900;
const coinGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.1, 18); coinGeo.rotateX(PI / 2);
const coinMat = new THREE.MeshPhongMaterial({ color: 0xffd23a, emissive: 0x7a4a00, specular: 0xffffff, shininess: 90 });
const coinMesh = new THREE.InstancedMesh(coinGeo, coinMat, MAX_COINS);
coinMesh.frustumCulled = false; coinMesh.count = 0;
scene.add(coinMesh);
const coinDummy = new THREE.Object3D();

// ============================================================ orbs (power-ups)
const ORB_COL = { magnet: 0x3ee8ff, shield: 0xb77bff, double: 0x4ad07a };
const orbGeo = new THREE.IcosahedronGeometry(0.42, 2);
const orbShellGeo = new THREE.IcosahedronGeometry(0.62, 1);
function makeOrbMesh(kind) {
  const grp = new THREE.Group();
  grp.add(new THREE.Mesh(orbGeo, new THREE.MeshBasicMaterial({ color: 0xffffff })));
  grp.add(new THREE.Mesh(orbShellGeo, new THREE.MeshBasicMaterial({ color: ORB_COL[kind], transparent: true, opacity: 0.55, depthWrite: false })));
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: ORB_COL[kind], transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
  sp.scale.set(3, 3, 1); grp.add(sp);
  return grp;
}

// ============================================================ particles
const PCOUNT = 320;
const pGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(PCOUNT * 3), pCol = new Float32Array(PCOUNT * 3);
const pVel = new Float32Array(PCOUNT * 3), pLife = new Float32Array(PCOUNT);
for (let i = 0; i < PCOUNT; i++) pPos[i * 3 + 1] = -999;
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const pMat = new THREE.PointsMaterial({ size: 0.28, vertexColors: true, transparent: true, depthWrite: false, map: glowTex, blending: THREE.AdditiveBlending });
const particles = new THREE.Points(pGeo, pMat); particles.frustumCulled = false; scene.add(particles);
let pNext = 0;
const _pc = new THREE.Color();
function burst(pos, color, n, spd, up) {
  _pc.setHex(color);
  for (let k = 0; k < n; k++) {
    const i = pNext; pNext = (pNext + 1) % PCOUNT;
    pPos[i * 3] = pos.x; pPos[i * 3 + 1] = pos.y; pPos[i * 3 + 2] = pos.z;
    const a = rand(0, PI * 2), e = rand(-0.3, 1);
    pVel[i * 3] = Math.cos(a) * spd * rand(0.3, 1); pVel[i * 3 + 1] = (e + (up || 0)) * spd; pVel[i * 3 + 2] = Math.sin(a) * spd * rand(0.3, 1);
    pLife[i] = rand(0.4, 0.9);
    pCol[i * 3] = _pc.r; pCol[i * 3 + 1] = _pc.g; pCol[i * 3 + 2] = _pc.b;
  }
}
function updateParticles(dt) {
  for (let i = 0; i < PCOUNT; i++) {
    if (pLife[i] <= 0) continue;
    pLife[i] -= dt;
    if (pLife[i] <= 0) { pPos[i * 3 + 1] = -999; continue; }
    pVel[i * 3 + 1] -= 12 * dt;
    pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
  }
  pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
}
// ambient dust motes around the camera
const DUST = 140;
const dGeo = new THREE.BufferGeometry(); const dPos = new Float32Array(DUST * 3);
for (let i = 0; i < DUST; i++) { dPos[i * 3] = rand(-20, 20); dPos[i * 3 + 1] = rand(0, 10); dPos[i * 3 + 2] = rand(-30, 10); }
dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
const dMat = new THREE.PointsMaterial({ size: 0.16, color: THEMES[0].dust, transparent: true, opacity: 0.75, depthWrite: false, map: glowTex, blending: THREE.AdditiveBlending });
const dust = new THREE.Points(dGeo, dMat); dust.frustumCulled = false; scene.add(dust);

// ============================================================ runner model
function buildRunner(ch) {
  const M = (c) => new THREE.MeshLambertMaterial({ color: c });
  const mat = { skin: M(ch.skin), hair: M(ch.hair), shirt: M(ch.shirt), pants: M(ch.pants), band: M(ch.band),
    boots: M(ch.boots), pack: M(ch.pack), belt: M(0x3b2a1a), dark: M(0x1a1310), white: M(0xffffff) };
  const box = (w, h, d, m, x, y, z, parent) => { const ms = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); ms.position.set(x, y, z); parent.add(ms); return ms; };
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const hips = new THREE.Group(); hips.position.y = 0.95; body.add(hips);
  const chest = new THREE.Group(); hips.add(chest);
  box(0.6, 0.66, 0.36, mat.shirt, 0, 0.38, 0, chest);
  box(0.62, 0.12, 0.38, mat.belt, 0, 0.05, 0, chest);
  box(0.16, 0.14, 0.06, mat.boots, 0.12, 0.05, -0.2, chest); // pouch
  box(0.5, 0.56, 0.24, mat.pack, 0, 0.42, 0.3, chest); // backpack
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.56, 8), mat.belt); roll.rotation.z = PI / 2; roll.position.set(0, 0.76, 0.3); chest.add(roll);
  box(0.08, 0.7, 0.04, mat.belt, -0.18, 0.4, -0.19, chest); box(0.08, 0.7, 0.04, mat.belt, 0.18, 0.4, -0.19, chest); // straps
  box(0.44, 0.13, 0.42, mat.band, 0, 0.74, 0, chest); // scarf
  const scarf = new THREE.Group(); scarf.position.set(0.1, 0.76, 0.22); chest.add(scarf);
  box(0.12, 0.05, 0.55, mat.band, 0, 0, 0.27, scarf);
  const head = new THREE.Group(); head.position.y = 0.98; chest.add(head);
  box(0.4, 0.42, 0.4, mat.skin, 0, 0.02, 0, head);
  box(0.42, 0.14, 0.42, mat.hair, 0, 0.24, 0.02, head);
  box(0.42, 0.3, 0.1, mat.hair, 0, 0.08, 0.18, head);
  for (let i = 0; i < 5; i++) {
    const sp = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 4), mat.hair);
    sp.position.set(-0.16 + i * 0.08, 0.36, 0.05 + (i % 2) * 0.06); sp.rotation.x = 0.6 + (i % 2) * 0.3; sp.rotation.z = (i - 2) * 0.2; head.add(sp);
  }
  box(0.08, 0.06, 0.02, mat.white, -0.1, 0.05, -0.205, head); box(0.08, 0.06, 0.02, mat.white, 0.1, 0.05, -0.205, head);
  box(0.04, 0.05, 0.02, mat.dark, -0.1, 0.05, -0.215, head); box(0.04, 0.05, 0.02, mat.dark, 0.1, 0.05, -0.215, head);
  box(0.12, 0.03, 0.02, mat.hair, -0.1, 0.12, -0.21, head); box(0.12, 0.03, 0.02, mat.hair, 0.1, 0.12, -0.21, head);
  box(0.06, 0.08, 0.06, mat.skin, 0, -0.01, -0.22, head); // nose
  box(0.14, 0.04, 0.02, mat.dark, 0, -0.1, -0.205, head);
  const arm = (side) => {
    const sh = new THREE.Group(); sh.position.set(side * 0.38, 0.66, 0); chest.add(sh);
    box(0.17, 0.36, 0.18, mat.skin, 0, -0.17, 0, sh);
    box(0.19, 0.12, 0.2, mat.shirt, 0, -0.02, 0, sh);
    const el = new THREE.Group(); el.position.y = -0.34; sh.add(el);
    box(0.15, 0.32, 0.16, mat.skin, 0, -0.15, 0, el);
    box(0.17, 0.12, 0.18, mat.band, 0, -0.24, 0, el);
    box(0.15, 0.13, 0.15, mat.skin, 0, -0.36, 0, el);
    return { sh, el };
  };
  const leg = (side) => {
    const hp = new THREE.Group(); hp.position.set(side * 0.16, 0, 0); hips.add(hp);
    box(0.24, 0.46, 0.26, mat.pants, 0, -0.22, 0, hp);
    const kn = new THREE.Group(); kn.position.y = -0.45; hp.add(kn);
    box(0.22, 0.32, 0.24, mat.pants, 0, -0.14, 0, kn);
    box(0.25, 0.2, 0.36, mat.boots, 0, -0.38, -0.05, kn);
    return { hp, kn };
  };
  const aL = arm(-1), aR = arm(1), lL = leg(-1), lR = leg(1);
  // blob shadow
  const sh = new THREE.Mesh(new THREE.CircleGeometry(0.55, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
  sh.rotation.x = -PI / 2;
  // shield bubble
  const bubble = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 2), new THREE.MeshBasicMaterial({ color: 0xb77bff, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }));
  bubble.position.y = 0.95; bubble.visible = false; root.add(bubble);
  return { root, body, hips, chest, head, scarf, aL, aR, lL, lR, shadow: sh, bubble };
}

// ============================================================ guardian model
function buildGuardian() {
  const stone = new THREE.MeshLambertMaterial({ color: 0x6c6a64 });
  const stone2 = new THREE.MeshLambertMaterial({ color: 0x55534e });
  const moss = new THREE.MeshLambertMaterial({ color: 0x4f6e30 });
  const eye = new THREE.MeshBasicMaterial({ color: 0xff2a10 });
  const lava = new THREE.MeshBasicMaterial({ color: 0xff7a20 });
  const box = (w, h, d, m, x, y, z, parent, rx, ry, rz) => { const ms = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); ms.position.set(x, y, z); ms.rotation.set(rx || 0, ry || 0, rz || 0); parent.add(ms); return ms; };
  const root = new THREE.Group();
  const body = new THREE.Group(); body.position.y = 2.1; root.add(body);
  box(2.3, 1.9, 1.5, stone, 0, 0.9, 0, body, 0.15);
  box(1.8, 0.9, 1.3, stone2, 0, -0.2, 0, body);
  box(1.2, 0.12, 0.05, lava, 0, 1.0, -0.82, body, 0.15, 0, 0.3);
  box(0.12, 0.8, 0.05, lava, -0.3, 0.7, -0.8, body, 0.15);
  box(1.8, 0.4, 1.0, moss, 0.2, 1.9, 0.3, body);
  const head = new THREE.Group(); head.position.set(0, 2.1, -0.35); body.add(head);
  box(1.1, 0.95, 1.0, stone, 0, 0, 0, head);
  box(1.2, 0.25, 1.1, stone2, 0, 0.42, 0, head);
  box(0.26, 0.14, 0.06, eye, -0.25, 0.08, -0.51, head);
  box(0.26, 0.14, 0.06, eye, 0.25, 0.08, -0.51, head);
  const jaw = box(0.9, 0.3, 0.8, stone2, 0, -0.55, -0.1, head);
  box(0.7, 0.08, 0.05, lava, 0, -0.38, -0.5, head);
  const arm = (s) => {
    const sh = new THREE.Group(); sh.position.set(s * 1.45, 1.4, 0); body.add(sh);
    box(0.9, 0.9, 0.9, stone2, 0, 0, 0, sh);
    box(0.75, 1.3, 0.75, stone, 0, -1.0, 0, sh);
    box(0.95, 0.85, 0.95, stone2, 0, -2.0, -0.05, sh);
    return sh;
  };
  const leg = (s) => {
    const hp = new THREE.Group(); hp.position.set(s * 0.6, -0.5, 0); body.add(hp);
    box(0.8, 1.3, 0.85, stone2, 0, -0.65, 0, hp);
    box(0.95, 0.35, 1.2, stone, 0, -1.4, -0.1, hp);
    return hp;
  };
  const aL = arm(-1), aR = arm(1), lL = leg(-1), lR = leg(1);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff3010, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.scale.set(2.2, 1.2, 1); glow.position.set(0, 0.08, -0.6); head.add(glow);
  root.scale.setScalar(1.05);
  return { root, body, head, jaw, aL, aR, lL, lR };
}

// ============================================================ audio (synthesized)
const Sound = {
  ctx: null, master: null, sfx: null, music: null, noiseBuf: null, musicOn: false, nextNote: 0, step: 0, lastCoin: 0, coinPitch: 0, timer: null,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try { this.ctx = new AC(); } catch (e) { return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = Save.d.muted ? 0 : 0.9; this.master.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.gain.value = 0.8; this.sfx.connect(this.master);
    this.music = c.createGain(); this.music.gain.value = 0.32; this.music.connect(this.master);
    const len = c.sampleRate; this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const ch = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    this.timer = setInterval(() => this.schedule(), 30);
  },
  setMuted(m) { if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05); },
  tone(f, dur, type, vol, f2, delay, dest) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime + (delay || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.sfx); o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur, vol, freq, ftype, f2, delay, dest) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime + (delay || 0);
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = ftype || 'lowpass'; f.frequency.setValueAtTime(freq, t); if (f2) f.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || this.sfx); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  },
  coin() {
    if (!this.ctx) return; const now = this.ctx.currentTime;
    this.coinPitch = now - this.lastCoin < 0.35 ? Math.min(this.coinPitch + 1, 7) : 0; this.lastCoin = now;
    const f = 1046 * Math.pow(2, [0, 2, 4, 7, 9, 12, 14, 16][this.coinPitch] / 12);
    this.tone(f, 0.09, 'square', 0.06); this.tone(f * 1.5, 0.16, 'square', 0.05, null, 0.05);
  },
  jump() { this.tone(260, 0.2, 'triangle', 0.25, 640); this.noise(0.15, 0.08, 1500, 'bandpass', 3000); },
  slide() { this.noise(0.35, 0.22, 2500, 'bandpass', 400); },
  turn() { this.noise(0.28, 0.18, 600, 'bandpass', 2600); this.tone(500, 0.12, 'triangle', 0.08, 900); },
  lane() { this.noise(0.12, 0.07, 1800, 'bandpass', 900); },
  power() { [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.16, null, i * 0.06)); },
  shieldBreak() { this.tone(1200, 0.5, 'sawtooth', 0.12, 150); this.noise(0.4, 0.3, 4000, 'highpass', 800); },
  stumble() { this.tone(160, 0.25, 'square', 0.18, 60); this.noise(0.25, 0.35, 500); },
  crash() { this.noise(0.8, 0.7, 900, 'lowpass', 60); this.tone(120, 0.6, 'sawtooth', 0.25, 35); },
  fall() { this.tone(700, 1.1, 'triangle', 0.2, 80); },
  roar() {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), o2 = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; o2.type = 'square'; o.frequency.setValueAtTime(95, t); o.frequency.linearRampToValueAtTime(60, t + 1.3);
    o2.frequency.setValueAtTime(72, t); o2.frequency.linearRampToValueAtTime(48, t + 1.3);
    lfo.frequency.value = 18; lg.gain.value = 25; lfo.connect(lg); lg.connect(o.frequency);
    f.type = 'lowpass'; f.frequency.value = 650;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    o.connect(f); o2.connect(f); f.connect(g); g.connect(this.sfx);
    [o, o2, lfo].forEach((x) => { x.start(t); x.stop(t + 1.5); });
    this.noise(1.2, 0.25, 400, 'lowpass', 120);
  },
  startMusic() { if (!this.ctx) return; this.musicOn = true; this.nextNote = this.ctx.currentTime + 0.1; this.step = 0; },
  stopMusic() { this.musicOn = false; },
  schedule() {
    if (!this.musicOn || !this.ctx) return;
    const c = this.ctx, spb = 60 / 132 / 4; // 16th notes at 132 bpm
    while (this.nextNote < c.currentTime + 0.12) {
      const s = this.step % 32, t = this.nextNote, d = t - c.currentTime;
      const M = this.music;
      if (s % 8 === 0 || s === 22) this.drum(t, 90, 0.9);
      if (s % 8 === 4 || s === 14 || s === 30) this.drum(t, 150, 0.5);
      if (s % 2 === 1) this.noise(0.04, 0.05, 7000, 'highpass', null, d, M);
      const bass = [0, 0, 3, 0, 5, 3, 7, 5][Math.floor(s / 4)];
      if (s % 4 === 0) this.tone(55 * Math.pow(2, bass / 12), 0.22, 'triangle', 0.3, null, d, M);
      const mel = [12, null, 15, null, 17, 15, 12, null, 10, null, 12, null, null, null, 7, null,
        12, null, 15, 17, 19, null, 17, 15, 17, null, 15, 12, null, null, null, null];
      const bar = Math.floor(this.step / 32) % 4;
      if (bar >= 2 && mel[s] != null) this.tone(220 * Math.pow(2, mel[s] / 12), 0.2, 'square', 0.045, null, d, M);
      this.nextNote += spb; this.step++;
    }
  },
  drum(t, f, v) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.4, t + 0.18);
    g.gain.setValueAtTime(v * 0.6, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g); g.connect(this.music); o.start(t); o.stop(t + 0.25);
  },
};

// ============================================================ game state
const S = {
  state: 'menu', // menu | playing | paused | dying | over
  cur: null, prev: null, d: 0, x: 0, lane: 1, prevLane: 1, y: 0, vy: 0, falling: false,
  slide: 0, slideQueued: false, jumpBuf: 0, queuedTurn: null, speed: 15,
  dist: 0, score: 0, coins: 0, committed: 0, time: 0,
  chase: 3, stumble: 0, invuln: 0, shake: 0,
  power: { magnet: 0, shield: 0, double: 0 }, powerMax: { magnet: 1, shield: 1, double: 1 },
  yawTarget: 0, camYaw: PI, runYaw: 0, phase: 0, deathKind: '', deathT: 0, revives: 0, char: CHARACTERS[0],
  lastThemeIdx: 0, hintShown: {}, turnsDone: 0,
};
let runner = null, guardian = null;

function setCharacter(id) {
  const ch = CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];
  S.char = ch;
  if (runner) { scene.remove(runner.root); scene.remove(runner.shadow); }
  runner = buildRunner(ch);
  scene.add(runner.root); scene.add(runner.shadow);
}

function resetWorld() {
  while (pieces.length) disposePiece(pieces[0]);
  allCoins.length = 0;
  pieceSeq = 0;
  const p0 = makePiece(null);
  let last = p0; for (let i = 0; i < 3; i++) last = makePiece(last);
  S.cur = p0; S.prev = null;
}

function ensureAhead() {
  let n = 0, p = S.cur; while (p.next) { p = p.next; n++; }
  while (n < 3) { p = makePiece(p); n++; }
}

function startRun() {
  Sound.init();
  setCharacter(Save.d.sel);
  if (!guardian) { guardian = buildGuardian(); scene.add(guardian.root); }
  resetWorld();
  Object.assign(S, {
    state: 'playing', d: 0, x: 0, lane: 1, prevLane: 1, y: 0, vy: 0, falling: false, slide: 0, slideQueued: false, jumpBuf: 0,
    queuedTurn: null, speed: speedAt(0), dist: 0, score: 0, coins: 0, committed: 0, time: 0, chase: 8, stumble: 0, invuln: 0, shake: 0,
    yawTarget: 0, camYaw: PI * 0.92, runYaw: 0, phase: 0, revives: 0, lastThemeIdx: 0, hintShown: {}, turnsDone: 0,
  });
  S.power = { magnet: 0, shield: 0, double: 0 };
  applyTheme(S.cur.theme, 1); S.lastThemeIdx = S.cur.themeIdx;
  showScreen(null);
  $('hud').classList.remove('hidden');
  updateHud(true);
  Sound.startMusic();
  setTimeout(() => { if (S.state === 'playing') Sound.roar(); }, 250);
  showBanner('THE GUARDIAN AWAKENS', 'RUN!', 2200);
  Save.d.runs++; Save.write();
}

// ============================================================ theme blending
const _tc = new THREE.Color();
function applyTheme(T, t) {
  skyColor.lerp(_tc.setHex(T.sky), t);
  scene.fog.near = lerp(scene.fog.near, T.fogNear, t); scene.fog.far = lerp(scene.fog.far, T.fogFar, t);
  hemi.color.lerp(_tc.setHex(T.hemiSky), t); hemi.groundColor.lerp(_tc.setHex(T.hemiGround), t);
  hemi.intensity = lerp(hemi.intensity, T.hemiI, t);
  sun.color.lerp(_tc.setHex(T.sun), t); sun.intensity = lerp(sun.intensity, T.sunI, t);
  groundMat.color.lerp(_tc.setHex(T.ground), t);
  dMat.color.lerp(_tc.setHex(T.dust), t);
}

// ============================================================ input
function inTurnWindow() {
  const p = S.cur; const win = Math.max(14, S.speed * 0.75);
  return S.d > p.length - win && S.d < p.length + PATH_HALF;
}
function act(dir) {
  if (S.state !== 'playing') return;
  if (dir === 'left' || dir === 'right') {
    const t = dir === 'left' ? 'L' : 'R';
    if (inTurnWindow() && S.cur.turn === t && !S.queuedTurn) { S.queuedTurn = t; return; }
    if (S.falling) return;
    const nl = S.lane + (dir === 'left' ? -1 : 1);
    if (nl < 0 || nl > 2) return;
    if (blockedAt(S.cur, nl, S.d, 0.6)) { stumbleHit(true); return; }
    S.prevLane = S.lane; S.lane = nl; Sound.lane();
  } else if (dir === 'up') {
    if (S.falling) return;
    if (S.y <= 0.001) doJump(); else S.jumpBuf = 0.2;
  } else if (dir === 'down') {
    if (S.falling) return;
    if (S.y > 0.001) { S.vy = Math.min(S.vy, -24); S.slideQueued = true; }
    else { if (S.slide <= 0) Sound.slide(); S.slide = SLIDE_TIME; }
  }
}
function doJump() { S.vy = JUMP_V; S.y = 0.001; S.slide = 0; S.jumpBuf = 0; Sound.jump(); }

window.addEventListener('keydown', (e) => {
  const k = e.key;
  if (k === 'ArrowLeft' || k === 'a' || k === 'A') act('left');
  else if (k === 'ArrowRight' || k === 'd' || k === 'D') act('right');
  else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ') act('up');
  else if (k === 'ArrowDown' || k === 's' || k === 'S') act('down');
  else if (k === 'p' || k === 'P' || k === 'Escape') { if (S.state === 'playing') pauseGame(); else if (S.state === 'paused') resumeGame(); }
  else return;
  e.preventDefault();
});
let tStart = null;
function pStart(x, y) { tStart = { x, y, fired: false }; }
function pMove(x, y) {
  if (!tStart || tStart.fired) return;
  const dx = x - tStart.x, dy = y - tStart.y; const th = Math.max(24, Math.min(window.innerWidth, window.innerHeight) * 0.05);
  if (Math.abs(dx) < th && Math.abs(dy) < th) return;
  tStart.fired = true;
  if (Math.abs(dx) > Math.abs(dy)) act(dx > 0 ? 'right' : 'left'); else act(dy > 0 ? 'down' : 'up');
}
const cv = renderer.domElement;
cv.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; pStart(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
cv.addEventListener('touchmove', (e) => { const t = e.changedTouches[0]; pMove(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
cv.addEventListener('touchend', () => { tStart = null; });
cv.addEventListener('mousedown', (e) => pStart(e.clientX, e.clientY));
window.addEventListener('mousemove', (e) => { if (e.buttons) pMove(e.clientX, e.clientY); });
window.addEventListener('mouseup', () => { tStart = null; });

// ============================================================ gameplay events
function stumbleHit(soft) {
  if (S.invuln > 0) return;
  S.shake = 0.35; vibrate(60);
  Sound.stumble();
  if (S.stumble > 0) { die('caught'); return; }
  S.stumble = 6.5;
  showToast(soft ? 'Careful!' : 'Stumbled!');
}
function deadlyHit(o, kind) {
  if (S.invuln > 0) return;
  if (S.power.shield > 0) {
    S.power.shield = 0; if (o) o.done = true; S.invuln = 1.0; S.shake = 0.3;
    Sound.shieldBreak(); vibrate(80); burst(playerWorld(1), 0xb77bff, 40, 7);
    showToast('Shield saved you!');
    return;
  }
  die(kind);
}
function die(kind) {
  if (S.state !== 'playing') return;
  S.state = 'dying'; S.deathKind = kind; S.deathT = 0;
  Sound.stopMusic(); vibrate(kind === 'caught' ? 400 : 250);
  if (kind === 'fall') Sound.fall(); else Sound.crash();
  if (kind !== 'fall') { S.shake = 0.6; burst(playerWorld(1), 0xc8b89a, 30, 6); }
  setTimeout(() => Sound.roar(), kind === 'caught' ? 0 : 400);
  $('danger').classList.remove('on');
  commitCoins();
}
function commitCoins() {
  const add = S.coins - S.committed; S.committed = S.coins;
  Save.d.coins += add; Save.write();
}
function doTurn(forced) {
  const t = forced || S.queuedTurn;
  const pos = worldPos(S.cur, S.d, S.x, 0);
  if (S.prev) disposePiece(S.prev);
  S.prev = S.cur; S.cur = S.cur.next;
  const rel = pos.sub(S.cur.origin);
  S.d = rel.dot(S.cur.fwd); S.x = clamp(rel.dot(S.cur.right), -LANE_W, LANE_W);
  S.lane = clamp(Math.round(S.x / LANE_W) + 1, 0, 2); S.prevLane = S.lane;
  S.yawTarget += t === 'R' ? -PI / 2 : PI / 2;
  S.queuedTurn = null; S.turnsDone++;
  Sound.turn();
  ensureAhead();
  if (S.cur.themeIdx !== S.lastThemeIdx) {
    S.lastThemeIdx = S.cur.themeIdx;
    showBanner('ENTERING', S.cur.theme.name, 2600);
  }
}
function collect(kind) {
  S.power[kind] = upgDur(kind); S.powerMax[kind] = S.power[kind];
  Sound.power(); vibrate(30);
  showToast(kind === 'magnet' ? 'Coin Magnet!' : kind === 'shield' ? 'Relic Shield!' : 'Double Gold!');
}
const _pw = new THREE.Vector3();
function playerWorld(yOff) { return worldPos(S.cur, S.d, S.x, S.y + (yOff || 0), _pw); }

// ============================================================ update
const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _look = new THREE.Vector3();
let coinSpin = 0;
function update(dt) {
  S.time += dt;
  coinSpin += dt * 3.2;
  if (S.state === 'playing') updatePlay(dt);
  else if (S.state === 'dying') updateDying(dt);
  updateCoinsAndItems(dt);
  updateRunnerAnim(dt);
  updateGuardian(dt);
  updateCamera(dt);
  updateParticles(dt);
  applyTheme(S.cur ? S.cur.theme : THEMES[0], Math.min(1, dt * 1.2));
  // dust follows camera
  dust.position.set(camera.position.x, 0, camera.position.z);
  dust.rotation.y = S.camYaw;
  ground.position.x = camera.position.x; ground.position.z = camera.position.z;
  sun.position.set(camera.position.x - 20, 40, camera.position.z - 30); sun.target.position.copy(camera.position);
}

function updatePlay(dt) {
  const p = S.cur;
  S.speed = speedAt(S.dist);
  const step = S.speed * dt;
  S.d += step; S.dist += step;
  S.score += step * S.char.mult;
  S.invuln = Math.max(0, S.invuln - dt);
  for (const k in S.power) S.power[k] = Math.max(0, S.power[k] - dt);
  if (S.stumble > 0) { S.stumble -= dt; if (S.stumble <= 0) $('danger').classList.remove('on'); else $('danger').classList.add('on'); }

  // lateral
  const tx = (S.lane - 1) * LANE_W;
  S.x += (tx - S.x) * Math.min(1, dt * 15);

  // vertical
  const onGap = S.invuln <= 0 && p.gaps.some((g) => S.d > g.d0 + 0.3 && S.d < g.d1 - 0.3);
  if (S.falling) {
    S.vy -= GRAV * dt; S.y += S.vy * dt * 0.6;
    if (S.y < -1.4) { die('fall'); return; }
  } else if (S.y > 0 || S.vy > 0 || onGap) {
    if (onGap && S.y <= 0 && S.vy <= 0) {
      if (S.power.shield > 0) { S.power.shield = 0; S.vy = JUMP_V * 1.05; S.y = 0.01; Sound.shieldBreak(); showToast('Shield saved you!'); burst(playerWorld(0), 0xb77bff, 30, 6); }
      else S.falling = true;
    }
    if (!S.falling) {
      S.vy -= GRAV * dt; S.y += S.vy * dt;
      if (S.y <= 0) {
        if (onGap) S.falling = true;
        else {
          S.y = 0; S.vy = 0;
          if (S.jumpBuf > 0) doJump();
          else if (S.slideQueued) { S.slideQueued = false; S.slide = SLIDE_TIME; Sound.slide(); }
        }
      }
    }
  }
  S.jumpBuf = Math.max(0, S.jumpBuf - dt);
  if (S.slide > 0) S.slide -= dt;

  // turns
  if (S.queuedTurn && S.d >= p.length - 2.4) { doTurn(); return; }
  if (S.d > p.length + PATH_HALF - 0.9) {
    if (S.power.shield > 0 || S.invuln > 0) { if (S.power.shield > 0) { S.power.shield = 0; Sound.shieldBreak(); showToast('Shield saved you!'); } doTurn(p.turn); return; }
    die('wall'); return;
  }

  // obstacles
  if (S.invuln <= 0) for (const o of p.obs) {
    if (o.done || o.type === 'gap') continue;
    if (S.d + 0.35 < o.d0 || S.d - 0.35 > o.d1) continue;
    if (o.type === 'log') { if (S.y < 0.88) deadlyHit(o, 'trip'); }
    else if (o.type === 'beam') { if (S.slide <= 0) deadlyHit(o, 'beam'); }
    else if (o.type === 'block') {
      for (let L = 0; L < 3; L++) {
        if (!o.lanes[L]) continue;
        if (Math.abs(S.x - (L - 1) * LANE_W) > 1.15) continue;
        if (S.lane === L) {
          if (Math.abs(S.x - tx) > 0.3 && !o.lanes[S.prevLane]) { S.lane = S.prevLane; stumbleHit(false); }
          else deadlyHit(o, 'crash');
        }
      }
    }
    if (S.state !== 'playing') return;
  }

  // disposal of passed piece
  if (S.prev && S.d > 40) { disposePiece(S.prev); S.prev = null; }

  // chase distance
  const target = S.stumble > 0 ? 3.0 : 18;
  S.chase += (target - S.chase) * Math.min(1, dt * (S.stumble > 0 ? 3 : 0.7));

  updateHints();
  updateHud(false);
}

function updateDying(dt) {
  S.deathT += dt;
  if (S.deathKind === 'fall') { S.vy -= GRAV * dt; S.y += S.vy * dt; }
  S.chase += (1.4 - S.chase) * Math.min(1, dt * 2.2);
  if (S.deathT > 1.8 && S.state === 'dying') gameOver();
}

function updateCoinsAndItems(dt) {
  if (!S.cur) return;
  const pp = playerWorld(0.9);
  const magnet = S.power.magnet > 0 && S.state === 'playing';
  let n = 0;
  for (let i = allCoins.length - 1; i >= 0; i--) {
    const c = allCoins[i];
    if (!c.alive) { allCoins.splice(i, 1); continue; }
    const dx = pp.x - c.wx, dy = pp.y - c.wy, dz = pp.z - c.wz;
    const d2 = dx * dx + dz * dz;
    if (S.state === 'playing') {
      if (magnet && d2 < 110 && d2 > 0.01) {
        const dd = Math.sqrt(d2 + dy * dy), k = Math.min(1, dt * 48 / dd);
        c.wx += dx * k; c.wy += dy * k; c.wz += dz * k; c.mag = true;
      }
      if (d2 < 1.3 && Math.abs(dy) < 1.3) {
        c.alive = false;
        const v = S.power.double > 0 ? 2 : 1;
        S.coins += v; S.score += 10 * v * S.char.mult;
        Sound.coin(); burst(_v.set(c.wx, c.wy, c.wz), 0xffd040, 5, 3);
        coinBump = 0.25;
        continue;
      }
    }
    if (n >= MAX_COINS) continue;
    coinDummy.position.set(c.wx, c.wy, c.wz);
    coinDummy.rotation.set(0, coinSpin + c.d * 0.3, 0);
    coinDummy.updateMatrix();
    coinMesh.setMatrixAt(n++, coinDummy.matrix);
  }
  coinMesh.count = n; coinMesh.instanceMatrix.needsUpdate = true;
  for (const p of pieces) for (const it of p.items) {
    if (!it.alive) continue;
    it.mesh.rotation.y += dt * 2; it.mesh.position.y = it.base + Math.sin(S.time * 3 + it.d) * 0.15;
    if (S.state !== 'playing') continue;
    const dx = pp.x - it.mesh.position.x, dz = pp.z - it.mesh.position.z, dy = pp.y - it.mesh.position.y;
    if (dx * dx + dz * dz < 1.8 && Math.abs(dy) < 1.6) {
      it.alive = false; scene.remove(it.mesh); collect(it.kind); burst(it.mesh.position, ORB_COL[it.kind], 30, 6);
    }
  }
}
let coinBump = 0;

function updateRunnerAnim(dt) {
  if (!runner || !S.cur) return;
  const R = runner;
  const pos = playerWorld(0);
  R.root.position.copy(pos);
  S.runYaw += (S.yawTarget - S.runYaw) * Math.min(1, dt * 14);
  R.root.rotation.set(0, S.runYaw, 0);
  R.shadow.position.set(pos.x, 0.02, pos.z);
  R.shadow.visible = !S.falling && S.y > -0.1;
  R.shadow.scale.setScalar(Math.max(0.4, 1 - S.y * 0.2));
  R.bubble.visible = S.power.shield > 0;
  if (R.bubble.visible) { R.bubble.rotation.y += dt * 2; R.bubble.material.opacity = 0.18 + Math.sin(S.time * 8) * 0.06; }
  R.root.visible = !(S.invuln > 0 && S.state === 'playing' && Math.floor(S.time * 14) % 2 === 0);

  const playing = S.state === 'playing';
  if (playing) S.phase += dt * (S.speed * 0.62 + 4);
  const ph = S.phase, sw = Math.sin(ph), cw = Math.cos(ph);
  // reset
  R.body.position.set(0, 0, 0); R.body.rotation.set(0, 0, 0);
  R.chest.rotation.set(0.22, sw * 0.12, 0);
  R.head.rotation.set(-0.15, 0, 0);
  // lane-change lean
  const lean = clamp(((S.lane - 1) * LANE_W - S.x) * -0.18, -0.35, 0.35);
  R.body.rotation.z = -lean;
  if (S.state === 'dying') {
    const t = Math.min(1, S.deathT * 2.5);
    if (S.deathKind === 'fall') { R.body.rotation.x = -t * 0.6; R.aL.sh.rotation.set(PI * 0.9, 0, -0.4); R.aR.sh.rotation.set(PI * 0.9, 0, 0.4); }
    else { R.body.rotation.x = t * 1.45; R.body.position.y = 0.25 * t; R.body.position.z = t * 0.8;
      R.aL.sh.rotation.set(-1.8 * t, 0, -0.6); R.aR.sh.rotation.set(-1.8 * t, 0, 0.6); R.lL.hp.rotation.x = 0.9 * t; R.lR.hp.rotation.x = 0.4 * t; R.lL.kn.rotation.x = 0; R.lR.kn.rotation.x = 0; }
    R.scarf.rotation.x = 0;
    return;
  }
  if (S.slide > 0 && S.y <= 0.01) {
    R.body.rotation.x = 1.15; R.body.position.y = -0.15; R.body.position.z = 0.25;
    R.chest.rotation.x = -0.3;
    R.lL.hp.rotation.x = -0.2; R.lR.hp.rotation.x = 0.1; R.lL.kn.rotation.x = 0.5; R.lR.kn.rotation.x = 0.9;
    R.aL.sh.rotation.set(-0.6, 0, -0.5); R.aR.sh.rotation.set(-0.6, 0, 0.5); R.aL.el.rotation.x = -0.6; R.aR.el.rotation.x = -0.6;
    R.scarf.rotation.x = 0.1 + Math.sin(S.time * 30) * 0.15;
    if (Math.random() < 0.5) burst(_v.copy(pos).setY(0.1), 0xb8a888, 1, 2, 0.4);
    return;
  }
  if (S.y > 0.01 || S.falling) {
    const k = clamp(S.vy / JUMP_V, -1, 1);
    R.lL.hp.rotation.x = 1.0; R.lL.kn.rotation.x = -1.6; R.lR.hp.rotation.x = -0.3; R.lR.kn.rotation.x = -0.6;
    R.aL.sh.rotation.set(-2.2 + k * 0.3, 0, -0.3); R.aR.sh.rotation.set(0.9, 0, 0.3); R.aL.el.rotation.x = -0.4; R.aR.el.rotation.x = -0.9;
    R.chest.rotation.x = 0.1;
    R.scarf.rotation.x = -0.4 + Math.sin(S.time * 25) * 0.12;
    return;
  }
  if (!playing) { // idle (menu)
    R.lL.hp.rotation.x = 0; R.lR.hp.rotation.x = 0; R.lL.kn.rotation.x = 0; R.lR.kn.rotation.x = 0;
    R.aL.sh.rotation.set(0, 0, -0.1); R.aR.sh.rotation.set(0, 0, 0.1); R.aL.el.rotation.x = -0.2; R.aR.el.rotation.x = -0.2;
    R.chest.rotation.x = 0; R.body.position.y = Math.sin(S.time * 2) * 0.02;
    return;
  }
  // run cycle
  R.body.position.y = Math.abs(cw) * 0.12;
  R.lL.hp.rotation.x = sw * 0.95; R.lR.hp.rotation.x = -sw * 0.95;
  R.lL.kn.rotation.x = -Math.max(0, -cw) * 1.5 - 0.2; R.lR.kn.rotation.x = -Math.max(0, cw) * 1.5 - 0.2;
  R.aL.sh.rotation.set(-sw * 0.95, 0, -0.12); R.aR.sh.rotation.set(sw * 0.95, 0, 0.12);
  R.aL.el.rotation.x = -1.3; R.aR.el.rotation.x = -1.3;
  R.scarf.rotation.x = -0.25 + Math.sin(S.time * 22) * 0.15;
  R.scarf.rotation.y = Math.sin(S.time * 17) * 0.25;
}

function updateGuardian(dt) {
  if (!guardian || !S.cur) return;
  const G = guardian;
  let gd = S.d - S.chase, p = S.cur, gx = S.x * 0.6;
  if (gd < 0 && S.prev) { p = S.prev; gd = S.prev.length + gd; gx = 0; }
  const pos = worldPos(p, gd, gx, 0, _v);
  if (S.state === 'dying' && S.deathKind === 'fall') pos.copy(worldPos(S.cur, S.d - 4, S.x, 0));
  G.root.position.copy(pos);
  const yaw = p === S.cur ? S.runYaw : S.prev ? S.prev.yaw + (S.yawTarget - S.cur.yaw) : S.runYaw;
  G.root.rotation.y = yaw;
  G.root.visible = S.chase < 14 || S.state !== 'playing';
  const t = S.time * (S.speed * 0.32);
  G.body.position.y = 2.1 + Math.abs(Math.sin(t)) * 0.25;
  G.body.rotation.z = Math.sin(t) * 0.06;
  G.lL.rotation.x = Math.sin(t) * 0.7; G.lR.rotation.x = -Math.sin(t) * 0.7;
  const reach = S.state === 'dying' ? -1.9 : -0.3;
  G.aL.rotation.x = reach - Math.sin(t) * 0.7; G.aR.rotation.x = reach + Math.sin(t) * 0.7;
  G.jaw.position.y = -0.55 - (S.stumble > 0 || S.state === 'dying' ? 0.15 + Math.abs(Math.sin(S.time * 12)) * 0.1 : 0);
}

function updateCamera(dt) {
  if (!S.cur) return;
  const intro = clamp(S.time / 2.0, 0, 1);
  const k = S.state === 'playing' ? Math.min(1, dt * (intro < 1 ? 2.6 : 7)) : Math.min(1, dt * 2);
  S.camYaw += (S.yawTarget - S.camYaw) * k;
  _f.set(-Math.sin(S.camYaw), 0, -Math.cos(S.camYaw));
  _r.set(Math.cos(S.camYaw), 0, -Math.sin(S.camYaw));
  const pp = worldPos(S.cur, S.d, S.x, 0, _v);
  const back = S.state === 'dying' ? 8.5 : lerp(10, 6.4, intro), height = S.state === 'dying' ? 5.5 : lerp(2.6, 3.7, intro);
  const yFollow = S.falling ? Math.max(S.y, -1) * 0.5 : S.y * 0.35;
  camera.position.copy(pp).addScaledVector(_f, -back).addScaledVector(_r, -S.x * 0.35);
  camera.position.y = height + yFollow;
  _look.copy(pp).addScaledVector(_f, 7 * intro).addScaledVector(_r, -S.x * 0.2); _look.y = 1.2 + yFollow + (1 - intro) * 0.3;
  if (S.shake > 0) {
    S.shake -= dt; const a = S.shake * 0.6;
    camera.position.x += rand(-a, a); camera.position.y += rand(-a, a);
  }
  camera.lookAt(_look);
}

// ============================================================ HUD / UI
let lastHud = { score: -1, coins: -1, dist: -1 };
function updateHud(force) {
  const sc = Math.floor(S.score), co = S.coins, di = Math.floor(S.dist);
  if (force || sc !== lastHud.score) $('hScore').textContent = sc.toLocaleString();
  if (force || di !== lastHud.dist) $('hDist').textContent = di + ' m';
  if (force || co !== lastHud.coins) {
    $('hCoins').textContent = co;
    if (!force) { const pl = $('hCoins').parentNode; pl.classList.remove('bump'); void pl.offsetWidth; pl.classList.add('bump'); }
  }
  lastHud = { score: sc, coins: co, dist: di };
  // power-up bars
  let html = '';
  for (const u of UPGRADES) {
    const v = S.power[u.id]; if (v <= 0) continue;
    const f = clamp(v / S.powerMax[u.id], 0, 1);
    html += `<div class="pu"><span class="dot" style="background:radial-gradient(circle at 35% 30%,#fff,${u.color} 50%);box-shadow:0 0 8px ${u.color}"></span>${u.name.split(' ').pop().toUpperCase()}<span class="bar"><i style="width:${(f * 100).toFixed(0)}%;background:${u.color}"></i></span></div>`;
  }
  const pu = $('powerups'); if (pu._h !== html) { pu.innerHTML = html; pu._h = html; }
}

let bannerTimer = null;
function showBanner(sub, txt, ms) {
  $('bannerSub').textContent = sub; $('bannerTxt').textContent = txt;
  const b = $('banner'); b.classList.add('show');
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => b.classList.remove('show'), ms || 2000);
}
let toastTimer = null;
function showToast(txt) {
  const t = $('toast'); t.textContent = txt; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1100);
}
let hintCur = '';
function setHint(txt) {
  if (txt === hintCur) return; hintCur = txt;
  const h = $('hint'); if (txt) { h.textContent = txt; h.classList.add('show'); } else h.classList.remove('show');
}
function updateHints() {
  if (Save.d.runs > 3) { setHint(''); return; }
  const p = S.cur;
  if (inTurnWindow() && !S.queuedTurn) { setHint(p.turn === 'L' ? '← SWIPE LEFT TO TURN' : 'SWIPE RIGHT TO TURN →'); return; }
  for (const o of p.obs) {
    if (o.done || o.d0 < S.d || o.d0 > S.d + Math.max(16, S.speed * 0.9)) continue;
    if (o.type === 'log' || o.type === 'gap') { setHint('↑ SWIPE UP TO JUMP'); return; }
    if (o.type === 'beam') { setHint('↓ SWIPE DOWN TO SLIDE'); return; }
    if (o.type === 'block' && o.lanes[S.lane]) { setHint('← SWIPE TO DODGE →'); return; }
  }
  setHint('');
}

const DEATH_TEXT = {
  caught: ['CAUGHT!', 'The Guardian got you.'],
  wall: ['CRASHED!', 'You missed the turn.'],
  crash: ['SMASHED!', 'You ran into an obstacle.'],
  trip: ['TRIPPED!', 'Jump over low obstacles.'],
  beam: ['KNOCKED OUT!', 'Slide under high obstacles.'],
  fall: ['YOU FELL!', 'Jump over broken floor.'],
};
function reviveCost() { return 250 * Math.pow(2, S.revives); }
function gameOver() {
  S.state = 'over';
  commitCoins();
  const sc = Math.floor(S.score);
  const isBest = sc > Save.d.best;
  if (isBest) Save.d.best = sc;
  Save.d.bestDist = Math.max(Save.d.bestDist, Math.floor(S.dist));
  Save.write();
  const [t, sub] = DEATH_TEXT[S.deathKind] || DEATH_TEXT.crash;
  $('oTitle').textContent = t; $('oSub').textContent = sub;
  $('oScore').textContent = sc.toLocaleString(); $('oDist').textContent = Math.floor(S.dist) + ' m'; $('oCoins').textContent = S.coins;
  $('oBest').classList.toggle('show', isBest && sc > 0);
  const cost = reviveCost();
  $('oReviveCost').textContent = cost;
  $('btnRevive').disabled = Save.d.coins < cost;
  $('btnRevive').classList.toggle('hidden', S.revives >= 3);
  setHint('');
  showScreen('over');
}
function revive() {
  const cost = reviveCost();
  if (Save.d.coins < cost) return;
  Save.d.coins -= cost; Save.write(); S.revives++;
  const kind = S.deathKind;
  S.state = 'playing'; S.invuln = 3; S.stumble = 0; S.chase = 12; S.falling = false; S.y = 0; S.vy = 0; S.slide = 0;
  $('danger').classList.remove('on');
  if (kind === 'wall') doTurn(S.cur.turn);
  for (const o of S.cur.obs) if (Math.abs(o.c - S.d) < 4) o.done = true;
  showScreen(null); $('hud').classList.remove('hidden');
  Sound.startMusic(); Sound.power();
  showBanner('REVIVED', 'KEEP RUNNING!', 1500);
}

function pauseGame() {
  if (S.state !== 'playing') return;
  S.state = 'paused'; Sound.stopMusic(); showScreen('pause');
}
function resumeGame() {
  if (S.state !== 'paused') return;
  showScreen(null); S.state = 'playing'; Sound.init(); Sound.startMusic(); last = performance.now();
}
function toMenu() {
  S.state = 'menu'; Sound.stopMusic(); setHint('');
  $('hud').classList.add('hidden'); refreshMenu(); showScreen('menu');
}

const SCREENS = ['menu', 'story', 'help', 'shop', 'pause', 'over'];
function showScreen(id) { for (const s of SCREENS) $(s).classList.toggle('show', s === id); }
function openModal(id) { $(id).classList.add('show'); }
function closeModal(id) { $(id).classList.remove('show'); refreshMenu(); }

function refreshMenu() {
  $('mCoins').textContent = Save.d.coins.toLocaleString();
  $('mBest').textContent = Save.d.best.toLocaleString();
  $('soundIco').textContent = Save.d.muted ? '✕' : '♪';
  $('btnSound').style.opacity = Save.d.muted ? 0.6 : 1;
}

// ---- shop
let shopTab = 'chars';
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
function avatarHtml(c, locked) {
  return `<div class="avatar${locked ? ' locked' : ''}">
    <div class="ar" style="left:9px;background:${hex(c.skin)}"></div><div class="ar" style="left:47px;background:${hex(c.skin)}"></div>
    <div class="lg" style="background:${hex(c.pants)}"></div>
    <div class="bd" style="background:${hex(c.shirt)}"></div><div class="bn" style="background:${hex(c.band)}"></div>
    <div class="hd" style="background:${hex(c.skin)}"></div><div class="hr" style="background:${hex(c.hair)}"></div></div>`;
}
function renderShop() {
  $('sCoins').textContent = Save.d.coins.toLocaleString();
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === shopTab));
  let html = '';
  if (shopTab === 'chars') {
    for (const c of CHARACTERS) {
      const owned = Save.d.owned.includes(c.id), sel = Save.d.sel === c.id;
      let btn;
      if (sel) btn = `<button class="btn" disabled>SELECTED</button>`;
      else if (owned) btn = `<button class="btn btn-gold" data-sel="${c.id}">SELECT</button>`;
      else btn = `<button class="btn btn-gold" data-buy="${c.id}" ${Save.d.coins < c.cost ? 'disabled' : ''}><i class="coin-ico"></i> ${c.cost.toLocaleString()}</button>`;
      html += `<div class="card${sel ? ' sel' : ''}">${avatarHtml(c, !owned)}<div class="info"><h3>${c.name}</h3><p>${c.desc}</p><span class="mult">SCORE x${c.mult}</span></div>${btn}</div>`;
    }
  } else {
    for (const u of UPGRADES) {
      const lv = Save.d.upg[u.id];
      let pips = ''; for (let i = 0; i < 5; i++) pips += `<i class="${i < lv ? 'on' : ''}"></i>`;
      const btn = lv >= 5 ? `<button class="btn" disabled>MAX</button>`
        : `<button class="btn btn-gold" data-upg="${u.id}" ${Save.d.coins < UPG_COST[lv] ? 'disabled' : ''}><i class="coin-ico"></i> ${UPG_COST[lv].toLocaleString()}</button>`;
      html += `<div class="card"><div class="avatar" style="display:flex;align-items:center;justify-content:center"><span class="hg"><span class="k orb ${u.cls}"></span></span></div>
        <div class="info"><h3>${u.name}</h3><p>${u.desc} Lasts ${upgDur(u.id)}s.</p><div class="pips">${pips}</div></div>${btn}</div>`;
    }
  }
  $('shopList').innerHTML = html;
}
$('shopList').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  Sound.init();
  if (b.dataset.sel) { Save.d.sel = b.dataset.sel; Sound.lane(); }
  else if (b.dataset.buy) {
    const c = CHARACTERS.find((x) => x.id === b.dataset.buy);
    if (Save.d.coins >= c.cost) { Save.d.coins -= c.cost; Save.d.owned.push(c.id); Save.d.sel = c.id; Sound.power(); vibrate(40); }
  } else if (b.dataset.upg) {
    const id = b.dataset.upg, lv = Save.d.upg[id];
    if (lv < 5 && Save.d.coins >= UPG_COST[lv]) { Save.d.coins -= UPG_COST[lv]; Save.d.upg[id]++; Sound.power(); vibrate(40); }
  }
  Save.write(); renderShop();
});
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { shopTab = t.dataset.tab; renderShop(); }));

// ---- buttons
const onTap = (id, fn) => $(id).addEventListener('click', (e) => { e.stopPropagation(); fn(); });
onTap('btnPlay', () => {
  Sound.init();
  if (!Save.d.seenStory) { Save.d.seenStory = true; Save.write(); storyThenPlay = true; openModal('story'); return; }
  startRun();
});
let storyThenPlay = false;
onTap('btnStoryGo', () => { closeModal('story'); if (storyThenPlay) { storyThenPlay = false; startRun(); } });
onTap('btnShop', () => { Sound.init(); renderShop(); openModal('shop'); });
onTap('btnStory', () => { Sound.init(); storyThenPlay = false; openModal('story'); });
onTap('btnHelp', () => { Sound.init(); openModal('help'); });
document.querySelectorAll('[data-close]').forEach((b) => { if (b.id !== 'btnStoryGo') b.addEventListener('click', () => closeModal(b.dataset.close)); });
onTap('btnSound', () => { Save.d.muted = !Save.d.muted; Save.write(); Sound.init(); Sound.setMuted(Save.d.muted); refreshMenu(); });
onTap('btnPause', pauseGame);
onTap('btnResume', resumeGame);
onTap('btnRestart', () => { commitCoins(); startRun(); });
onTap('btnQuit', () => { commitCoins(); toMenu(); });
onTap('btnAgain', startRun);
onTap('btnMenu', toMenu);
onTap('btnRevive', revive);

// Android hooks
window.onAppPause = () => { if (S.state === 'playing') pauseGame(); if (Sound.ctx) Sound.ctx.suspend(); };
window.onAppResume = () => { if (Sound.ctx && S.state !== 'paused') Sound.ctx.resume(); };
window.onBackButton = () => {
  for (const m of ['shop', 'story', 'help']) if ($(m).classList.contains('show')) { closeModal(m); return 'ok'; }
  if (S.state === 'playing') { pauseGame(); return 'ok'; }
  if (S.state === 'paused') { resumeGame(); return 'ok'; }
  if (S.state === 'over') { toMenu(); return 'ok'; }
  return 'exit';
};
document.addEventListener('visibilitychange', () => { if (document.hidden && S.state === 'playing') pauseGame(); });

// ============================================================ main loop
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.1) dt = 0.1;
  if (S.state === 'menu' && $('menu').classList.contains('show')) return; // menu covers the screen
  if (S.state === 'paused' || S.state === 'over') { renderer.render(scene, camera); return; }
  // sub-step for stability on slow frames
  const steps = dt > 0.034 ? 2 : 1;
  for (let i = 0; i < steps; i++) update(dt / steps);
  renderer.render(scene, camera);
}

// boot
refreshMenu();
setCharacter(Save.d.sel);
resetWorld();
renderer.render(scene, camera);
$('loading').classList.remove('show');
requestAnimationFrame(frame);

// test hooks (harmless in production)
window.__LR = { S, act, startRun, pieces };
})();
