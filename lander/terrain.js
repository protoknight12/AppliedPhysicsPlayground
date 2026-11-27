// Lunar terrain for the lander: one analytic height function shared by physics and rendering,
// drawn with a camera-centred quadtree (≈0.5 m cells under the lander, 47 m cells at the horizon),
// plus procedurally placed boulders that you can actually land on (or tip over on).
import * as THREE from 'three';

export const R_MOON = 1737400;
export const SIZE = 6000, HALF = SIZE / 2;
export const PADS = {
  A: { name: 'Pad A · Tranquility', x: 0, z: 0, r: 15, flat: 40 },
  B: { name: 'Pad B · Boulder field', x: 950, z: -780, r: 7, flat: 14 },
};

// ---------- noise ----------
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hash2(x, y) { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function hash3(x, y, k) { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(k, 1440662683); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vn2(x, y) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
export function fbm(x, y, oct = 4) { let f = 0, a = 0.5, s = 1; for (let i = 0; i < oct; i++) { f += a * (vn2(x * s, y * s) - 0.5); a *= 0.5; s *= 2.03; } return f; }
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const curv = (x, z) => (x * x + z * z) / (2 * R_MOON);

// ---------- crater population ----------
// Size–frequency N(>r) ∝ r⁻² for the large (catalogued) craters; small craters (0.8–8 m) are generated
// per 24 m cell from a hash, so they exist everywhere without storage.
const CELL_BIG = 200, GB = Math.ceil(SIZE * 1.2 / CELL_BIG), GB0 = GB / 2;
const big = [];                 // [cx, cz, r, age]
const bigGrid = Array.from({ length: GB * GB }, () => []);
function addCrater(cx, cz, r, age) {
  const id = big.length; big.push([cx, cz, r, age]);
  const e = 2.2 * r;
  const i0 = Math.max(0, Math.floor((cx - e) / CELL_BIG + GB0)), i1 = Math.min(GB - 1, Math.floor((cx + e) / CELL_BIG + GB0));
  const j0 = Math.max(0, Math.floor((cz - e) / CELL_BIG + GB0)), j1 = Math.min(GB - 1, Math.floor((cz + e) / CELL_BIG + GB0));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) bigGrid[j * GB + i].push(id);
}
{
  const R = rng(1969);
  for (let n = 0; n < 1500; n++) {
    const r = Math.min(520, 16 / Math.sqrt(R() + 1e-4)), cx = (R() - 0.5) * SIZE * 1.1, cz = (R() - 0.5) * SIZE * 1.1, age = 0.35 + 0.65 * R();
    if (Math.hypot(cx - PADS.A.x, cz - PADS.A.z) < r * 2.2 + 70) continue;
    addCrater(cx, cz, r, age);
  }
  for (let n = 0; n < 380; n++) {          // pad B: dense, fresh, small craters
    const a = R() * 6.283, d = 30 + Math.sqrt(R()) * 520, r = 13 + R() * R() * 55;
    addCrater(PADS.B.x + Math.cos(a) * d, PADS.B.z + Math.sin(a) * d, r, 0.6 + 0.4 * R());
  }
  // a fresh, bright-rayed 140 m crater 600 m north-east of pad A — a landmark from high gate
  addCrater(430, -420, 70, 1.0);
}
const C3 = Math.pow(2.2, -3);
// crater profile: bowl D·(s²−1) + raised rim, ejecta blanket ∝ s⁻³ out to 2.2 r
function crater(s, r, age, out) {
  if (s >= 2.2) return;
  const D = 0.2 * r * age, rim = 0.045 * r * age;
  out.h += s < 1 ? D * (s * s - 1) + rim : rim * (Math.pow(s, -3) - C3) / (1 - C3);
  if (age > 0.75) out.a += (s > 0.8 && s < 1.8 ? 0.35 : s < 0.8 ? 0.1 : 0) * (age - 0.75) * 4 * (s > 1 ? (2.2 - s) / 1.2 : 1);
  if (age > 0.7 && s > 0.75 && s < 1.6) out.f = Math.max(out.f, (age - 0.7) * 3.3 * (1 - Math.abs(s - 1.1) / 0.5));
}
const SMALL = 24;
function padBoost(x, z) { const d = Math.hypot(x - PADS.B.x, z - PADS.B.z); return d < 650 ? 1 + 2.5 * (1 - d / 650) : 1; }
function smallCraters(x, z, out) {
  const ci = Math.floor(x / SMALL), cj = Math.floor(z / SMALL);
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const i = ci + di, j = cj + dj, h = hash3(i, j, 7), boost = padBoost((i + 0.5) * SMALL, (j + 0.5) * SMALL);
    const n = Math.floor(h * 2.4 * boost);
    for (let k = 0; k < n; k++) {
      const cx = (i + hash3(i, j, 11 + k)) * SMALL, cz = (j + hash3(i, j, 23 + k)) * SMALL;
      const r = 0.8 + 6.5 * Math.pow(hash3(i, j, 31 + k), 2.6);
      const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz, e = 2.2 * r;
      if (d2 >= e * e) continue;
      crater(Math.sqrt(d2) / r, r, 0.3 + 0.7 * hash3(i, j, 41 + k), out);
    }
  }
}

// ---------- height function ----------
const O = { h: 0, a: 0, f: 0 };
function rawHeight(x, z, out) {
  out.h = 70 * fbm(x / 2200 + 3.1, z / 2200 + 7.7, 4) + 9 * fbm(x / 380, z / 380, 4) + 1.6 * fbm(x / 60 + 9, z / 60 + 1, 3) + 0.3 * fbm(x / 7 + 2, z / 7 + 5, 2);
  out.a = 0.9 + 0.25 * fbm(x / 900 + 50, z / 900, 3); out.f = 0;
  const bi = Math.floor(x / CELL_BIG + GB0), bj = Math.floor(z / CELL_BIG + GB0);
  if (bi >= 0 && bj >= 0 && bi < GB && bj < GB) for (const id of bigGrid[bj * GB + bi]) {
    const c = big[id], dx = x - c[0], dz = z - c[1], r = c[2], d2 = dx * dx + dz * dz;
    if (d2 < 4.84 * r * r) crater(Math.sqrt(d2) / r, r, c[3], out);
  }
  smallCraters(x, z, out);
  return out;
}
for (const P of Object.values(PADS)) P.h0 = rawHeight(P.x, P.z, O).h;
// full surface height (metres), including pad flattening, edge fade and lunar curvature
export function height(x, z, out = O) {
  rawHeight(x, z, out);
  for (const P of Object.values(PADS)) {
    const d = Math.hypot(x - P.x, z - P.z), ext = P.flat * 2.2;
    if (d < ext) { const w = 1 - ss(P.flat, ext, d); out.h += (P.h0 - out.h) * w; out.f *= 1 - w; }
  }
  const e = 1 - ss(2450, 2980, Math.max(Math.abs(x), Math.abs(z)));
  out.h = out.h * e - curv(x, z);
  return out.h;
}
for (const P of Object.values(PADS)) P.h = height(P.x, P.z);
export function normalAt(x, z, e = 1.2) { return new THREE.Vector3(height(x - e, z) - height(x + e, z), 2 * e, height(x, z - e) - height(x, z + e)).normalize(); }

// ---------- boulders ----------
// Density rises on the rims of fresh craters and around pad B; size distribution is steep (most < 0.6 m).
const BC = 12;
const bCache = new Map();
export function bouldersInCell(i, j) {
  const key = i * 100003 + j; let list = bCache.get(key);
  if (list) return list;
  list = [];
  const cx = (i + 0.5) * BC, cz = (j + 0.5) * BC;
  if (Math.abs(cx) < HALF - 400 && Math.abs(cz) < HALF - 400) {
    rawHeight(cx, cz, O);
    const fresh = O.f, dA = Math.hypot(cx - PADS.A.x, cz - PADS.A.z), dB = Math.hypot(cx - PADS.B.x, cz - PADS.B.z);
    let dens = 0.09 + 1.6 * fresh + (dB < 520 ? 0.75 * (1 - dB / 520) : 0);
    if (dA < PADS.A.flat * 1.4) dens = 0; if (dB < PADS.B.r + 1) dens = 0;
    const n = Math.floor(dens * 3 * hash3(i, j, 5) + hash3(i, j, 6));
    for (let k = 0; k < n; k++) {
      const x = (i + hash3(i, j, 50 + k)) * BC, z = (j + hash3(i, j, 60 + k)) * BC;
      const u = hash3(i, j, 70 + k), r = (0.18 + 2.3 * Math.pow(u, 5)) * (dB < 520 ? 1.35 : 1);
      const y = height(x, z) - 0.28 * r;
      list.push({ x, y, z, r, v: Math.floor(hash3(i, j, 80 + k) * 3), rot: hash3(i, j, 90 + k) * 6.283, sq: 0.55 + 0.35 * hash3(i, j, 95 + k) });
    }
  }
  bCache.set(key, list); return list;
}
// highest boulder surface at (x, z), or -Infinity
export function boulderTop(x, z) {
  const ci = Math.floor(x / BC), cj = Math.floor(z / BC); let top = -Infinity;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) for (const b of bouldersInCell(ci + di, cj + dj)) {
    const dx = (x - b.x), dz = (z - b.z), rr = b.r * b.r, d2 = dx * dx + dz * dz;
    if (d2 < rr) top = Math.max(top, b.y + Math.sqrt(rr - d2) * b.sq * 1.15);
  }
  return top;
}
export function groundAt(x, z) { return Math.max(height(x, z), boulderTop(x, z)); }

function rockGeometry(seed, detail = 2) {
  const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position, R = rng(seed);
  const bumps = Array.from({ length: 7 }, () => [new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).normalize(), 0.15 + R() * 0.3]);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); let s = 1;
    for (const [d, k] of bumps) s -= k * Math.max(0, v.dot(d) - 0.55) * 1.6;     // flat facets
    s += 0.08 * (vn2(v.x * 3 + seed, v.z * 3 + v.y * 2) - 0.5);
    v.multiplyScalar(s); if (v.y < -0.2) v.y = -0.2 + (v.y + 0.2) * 0.3;          // flat-ish base
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals(); return g;
}
export class BoulderField {
  constructor(scene, material, cap = 2600) {
    this.meshes = [0, 1, 2].map(k => { const m = new THREE.InstancedMesh(rockGeometry(11 + k * 7), material, cap); m.castShadow = m.receiveShadow = true; m.count = 0; m.frustumCulled = false; scene.add(m); return m; });
    this.cap = cap; this.last = new THREE.Vector3(1e9, 0, 0); this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3(); this.count = 0;
  }
  update(cam, force = false) {
    if (!force && Math.hypot(cam.x - this.last.x, cam.z - this.last.z) < 14 && Math.abs(cam.y - this.last.y) < 30) return;
    this.last.copy(cam);
    const agl = Math.max(0, cam.y - height(cam.x, cam.z)), R = Math.min(420, 140 + agl * 0.8);
    const n = [0, 0, 0], ci = Math.floor(cam.x / BC), cj = Math.floor(cam.z / BC), k = Math.ceil(R / BC);
    for (let dj = -k; dj <= k; dj++) for (let di = -k; di <= k; di++) for (const b of bouldersInCell(ci + di, cj + dj)) {
      const d = Math.hypot(b.x - cam.x, b.z - cam.z);
      if (d > R || b.r < d / R * 1.1 + (agl > 300 ? 0.6 : 0)) continue;
      const m = this.meshes[b.v]; if (n[b.v] >= this.cap) continue;
      this._q.setFromAxisAngle(Y, b.rot); this._s.set(b.r, b.r * b.sq, b.r * (0.8 + 0.3 * b.sq)); this._p.set(b.x, b.y, b.z);
      m.setMatrixAt(n[b.v]++, this._m.compose(this._p, this._q, this._s));
    }
    this.meshes.forEach((m, i) => { m.count = n[i]; m.instanceMatrix.needsUpdate = true; });
    this.count = n[0] + n[1] + n[2];
  }
}
const Y = new THREE.Vector3(0, 1, 0);

// ---------- quadtree terrain ----------
const LEAF = 48;
export class TerrainLOD {
  constructor(scene, material, { maxDepth = 8, k = 2.1 } = {}) {
    this.scene = scene; this.mat = material; this.maxDepth = maxDepth; this.k = k;
    this.cache = new Map(); this.shown = new Set(); this.queue = []; this.root = new THREE.Group(); scene.add(this.root);
    this.generated = 0;
  }
  key(d, i, j) { return d * 1e8 + i * 1e4 + j; }
  build(d, i, j) {
    const size = SIZE / (1 << d), x0 = -HALF + i * size, z0 = -HALF + j * size, step = size / LEAF, n = LEAF + 1, m = LEAF + 3;
    const hs = new Float32Array(m * m), al = new Float32Array(m * m);
    for (let b = 0; b < m; b++) for (let a = 0; a < m; a++) { const o = { h: 0, a: 0, f: 0 }; height(x0 + (a - 1) * step, z0 + (b - 1) * step, o); hs[b * m + a] = o.h; al[b * m + a] = o.a; }
    const cx = x0 + size / 2, cz = z0 + size / 2, skirt = step * 1.5 + 0.5;
    const nv = n * n + 4 * n, pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    let v = 0;
    const put = (a, b, drop) => {
      const k = (b + 1) * m + (a + 1), x = x0 + a * step, z = z0 + b * step;
      pos[v * 3] = x - cx; pos[v * 3 + 1] = hs[k] - drop; pos[v * 3 + 2] = z - cz;
      let nx = hs[k - 1] - hs[k + 1], ny = 2 * step, nz = hs[k - m] - hs[k + m]; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      nor[v * 3] = nx; nor[v * 3 + 1] = ny; nor[v * 3 + 2] = nz;
      const c = Math.max(0.55, Math.min(1.65, al[k]));
      col[v * 3] = 0.56 * c; col[v * 3 + 1] = 0.548 * c; col[v * 3 + 2] = 0.528 * c;
      uv[v * 2] = x / 13; uv[v * 2 + 1] = z / 13; v++;
    };
    for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) put(a, b, 0);
    const edges = [[0, 0, 1, 0], [LEAF, 0, 0, 1], [LEAF, LEAF, -1, 0], [0, LEAF, 0, -1]];
    const base = n * n;
    for (const [a0, b0, da, db] of edges) for (let t = 0; t < n; t++) put(a0 + da * t, b0 + db * t, skirt);
    const idx = new Uint32Array(LEAF * LEAF * 6 + 4 * LEAF * 6); let q = 0;
    for (let b = 0; b < LEAF; b++) for (let a = 0; a < LEAF; a++) { const i0 = b * n + a; idx[q++] = i0; idx[q++] = i0 + n; idx[q++] = i0 + 1; idx[q++] = i0 + 1; idx[q++] = i0 + n; idx[q++] = i0 + n + 1; }
    const edgeIdx = [t => t, t => t * n + LEAF, t => LEAF * n + (LEAF - t), t => (LEAF - t) * n];
    for (let e = 0; e < 4; e++) for (let t = 0; t < LEAF; t++) {
      const a = edgeIdx[e](t), b = edgeIdx[e](t + 1), sa = base + e * n + t, sb = sa + 1;
      idx[q++] = a; idx[q++] = b; idx[q++] = sa; idx[q++] = b; idx[q++] = sb; idx[q++] = sa;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.mat); mesh.position.set(cx, 0, cz); mesh.receiveShadow = true; mesh.castShadow = d >= 5; mesh.visible = false;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    this.root.add(mesh); this.generated++;
    return mesh;
  }
  // desired leaves for a camera position
  select(cam) {
    const out = [], base = height(cam.x, cam.z), dy = Math.max(0, cam.y - base);
    const rec = (d, i, j) => {
      const size = SIZE / (1 << d), x0 = -HALF + i * size, z0 = -HALF + j * size;
      const dx = Math.max(x0 - cam.x, 0, cam.x - x0 - size), dz = Math.max(z0 - cam.z, 0, cam.z - z0 - size);
      const dist = Math.hypot(dx, dz, dy);
      if (d < this.maxDepth && dist < this.k * size) { rec(d + 1, 2 * i, 2 * j); rec(d + 1, 2 * i + 1, 2 * j); rec(d + 1, 2 * i, 2 * j + 1); rec(d + 1, 2 * i + 1, 2 * j + 1); }
      else out.push([d, i, j, dist]);
    };
    rec(0, 0, 0); return out;
  }
  update(cam, budgetMs = 6) {
    const want = this.select(cam), t0 = performance.now();
    // generate missing leaves nearest-first within the time budget
    want.sort((a, b) => a[3] - b[3]);
    for (const [d, i, j] of want) {
      const k = this.key(d, i, j);
      if (this.cache.has(k)) continue;
      if (performance.now() - t0 > budgetMs) break;
      this.cache.set(k, this.build(d, i, j));
    }
    // show each wanted leaf, or its nearest generated ancestor (never both a parent and its child)
    const show = new Set();
    for (const [d, i, j] of want) {
      let dd = d, ii = i, jj = j;
      while (dd > 0 && !this.cache.has(this.key(dd, ii, jj))) { dd--; ii >>= 1; jj >>= 1; }
      show.add(this.key(dd, ii, jj));
    }
    // drop children of shown ancestors
    for (const k of [...show]) {
      const d = Math.floor(k / 1e8); let i = Math.floor((k % 1e8) / 1e4), j = k % 1e4, dd = d;
      while (dd > 0) { dd--; i >>= 1; j >>= 1; if (show.has(this.key(dd, i, j))) { show.delete(k); break; } }
    }
    for (const k of this.shown) if (!show.has(k)) { const m = this.cache.get(k); if (m) m.visible = false; }
    for (const k of show) { const m = this.cache.get(k); if (m) m.visible = true; }
    this.shown = show;
    // evict far, unused leaves to bound memory
    if (this.cache.size > 900) for (const [k, m] of this.cache) { if (!show.has(k) && Math.floor(k / 1e8) > 2) { m.geometry.dispose(); this.root.remove(m); this.cache.delete(k); if (this.cache.size < 650) break; } }
  }
  prime(cam) { for (let n = 0; n < 40; n++) { const before = this.generated; this.update(cam, 1e9); if (this.generated === before) break; } }
}
