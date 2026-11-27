// Physics Sandbox — shared three.js kit: renderer + quality presets, adaptive resolution,
// procedural environment maps, star field, sun glare, settings menu and FPS meter.
import * as THREE from 'three';

const LS = 'aps.settings.v1';
const DEFAULTS = { quality: 'auto', fps: false, touch: 'auto', invertY: false };
export const settings = (() => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(LS) || '{}') }; } catch { return { ...DEFAULTS }; } })();
const listeners = new Set();
export function saveSettings(patch) {
  Object.assign(settings, patch);
  try { localStorage.setItem(LS, JSON.stringify(settings)); } catch { /* storage may be blocked */ }
  listeners.forEach(f => f(settings));
}
export const onSettings = f => (listeners.add(f), () => listeners.delete(f));

// low: 0.75 px ratio, no shadows · medium: up to 1.25 · high: up to 2, soft shadows
export const PRESETS = {
  low: { maxDpr: 0.85, minDpr: 0.6, shadows: false, shadowMap: 512, samples: 8, aniso: 2 },
  medium: { maxDpr: 1.25, minDpr: 0.7, shadows: true, shadowMap: 1024, samples: 12, aniso: 4 },
  high: { maxDpr: 2, minDpr: 0.8, shadows: true, shadowMap: 2048, samples: 16, aniso: 8 },
};
export function preset() {
  if (settings.quality !== 'auto') return PRESETS[settings.quality] || PRESETS.medium;
  const mobile = matchMedia('(pointer: coarse)').matches || innerWidth < 760;
  return mobile ? PRESETS.low : (devicePixelRatio > 1.5 ? PRESETS.medium : PRESETS.high);
}

export function createRenderer(canvas, { logDepth = true, shadows = false, exposure = 1 } = {}) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: logDepth, powerPreference: 'high-performance' });
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = exposure;
  r.userData = {};
  const apply = () => {
    const p = preset();
    r.shadowMap.enabled = shadows && p.shadows;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.userData.maxDpr = Math.min(devicePixelRatio || 1, p.maxDpr);
    r.userData.minDpr = Math.min(r.userData.maxDpr, p.minDpr);
    r.userData.dpr = r.userData.maxDpr;
    r.setPixelRatio(r.userData.dpr);
  };
  apply();
  onSettings(apply);
  return r;
}

// Drops the render resolution when frames take too long and restores it when there is headroom.
export class AdaptiveResolution {
  constructor(renderer, onChange) { this.r = renderer; this.acc = 0; this.n = 0; this.cool = 2; this.onChange = onChange; }
  tick(dt) {
    if (settings.quality !== 'auto' || !(dt > 0)) return;
    this.acc += dt; this.n++; this.cool -= dt;
    if (this.acc < 1.2 || this.cool > 0) return;
    const avg = this.acc / this.n, u = this.r.userData; this.acc = 0; this.n = 0;
    let d = u.dpr;
    if (avg > 1 / 40) d = Math.max(u.minDpr, d - 0.15);
    else if (avg < 1 / 75) d = Math.min(u.maxDpr, d + 0.1);
    if (Math.abs(d - u.dpr) > 0.01) { u.dpr = d; this.r.setPixelRatio(d); this.cool = 2.5; this.onChange && this.onChange(d); }
  }
}

// Procedural environment for image-based lighting: sky gradient, a bright sun and a ground/planet colour.
export function makeEnvironment(renderer, { top = 0x02040a, horizon = 0x1a2a44, bottom = 0x2a4a7a, sun = new THREE.Vector3(1, 0.4, 0.2), sunColor = 0xfff2dd, sunPower = 40, sunSize = 0.035 } = {}) {
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color(top) }, hor: { value: new THREE.Color(horizon) }, bot: { value: new THREE.Color(bottom) }, sun: { value: sun.clone().normalize() }, sunC: { value: new THREE.Color(sunColor).multiplyScalar(sunPower) }, sunS: { value: sunSize } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: `uniform vec3 top, hor, bot, sun, sunC; uniform float sunS; varying vec3 vD;
      void main(){ vec3 d = normalize(vD); float y = d.y;
        vec3 c = y > 0. ? mix(hor, top, pow(y, .45)) : mix(hor, bot, pow(-y, .35));
        float s = dot(d, sun); c += sunC * smoothstep(1. - sunS, 1. - sunS * .3, s) + sunC * .02 * pow(max(s, 0.), 8.);
        gl_FragColor = vec4(c, 1.); }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), mat));
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0, 0.1, 100);
  pm.dispose(); mat.dispose();
  return rt.texture;
}

// Stars with a magnitude distribution and colour temperature; rendered as round sprites.
export function makeStars({ count = 7000, radius = 3e7, minSize = 1.1, maxSize = 3.2, brightness = 1, upperOnly = false } = {}) {
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), size = new Float32Array(count);
  const tint = [[0.66, 0.75, 1], [0.85, 0.9, 1], [1, 1, 1], [1, 0.95, 0.85], [1, 0.82, 0.62]];
  for (let i = 0; i < count; i++) {
    let u = Math.random() * 2 - 1; if (upperOnly) u = Math.abs(u);
    const t = Math.random() * 6.2832, r = Math.sqrt(1 - u * u);
    pos[i * 3] = r * Math.cos(t) * radius; pos[i * 3 + 1] = u * radius; pos[i * 3 + 2] = r * Math.sin(t) * radius;
    const m = Math.pow(Math.random(), 5);                    // few bright, many faint
    const c = tint[Math.floor(Math.random() * tint.length)], b = (0.25 + 0.9 * m) * brightness;
    col[i * 3] = c[0] * b; col[i * 3 + 1] = c[1] * b; col[i * 3 + 2] = c[2] * b;
    size[i] = minSize + (maxSize - minSize) * m;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uFade: { value: 1 }, uDpr: { value: 1 } }, transparent: false, depthWrite: false, depthTest: false,
    vertexShader: `attribute float size; varying vec3 vC; uniform float uDpr;
      void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv; gl_Position.z = gl_Position.w * .999999; gl_PointSize = size * uDpr; }`,
    fragmentShader: `varying vec3 vC; uniform float uFade;
      void main(){ vec2 p = gl_PointCoord * 2. - 1.; float a = smoothstep(1., .2, dot(p, p)); gl_FragColor = vec4(vC * a * uFade, 1.);
      #include <colorspace_fragment>
      }`,
    vertexColors: true, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = -20;
  return pts;
}

export function glareTexture(size = 256) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size; const c = cv.getContext('2d'), h = size / 2;
  const g = c.createRadialGradient(h, h, 1, h, h, h);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.06, 'rgba(255,252,240,.95)'); g.addColorStop(0.18, 'rgba(255,240,210,.35)');
  g.addColorStop(0.5, 'rgba(255,220,170,.08)'); g.addColorStop(1, 'rgba(255,210,150,0)');
  c.fillStyle = g; c.fillRect(0, 0, size, size);
  c.globalCompositeOperation = 'lighter'; c.strokeStyle = 'rgba(255,245,225,.18)'; c.lineWidth = 2;
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI; c.beginPath(); c.moveTo(h - Math.cos(a) * h, h - Math.sin(a) * h); c.lineTo(h + Math.cos(a) * h, h + Math.sin(a) * h); c.stroke(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function makeSunGlare(scale = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glareTexture(), depthWrite: false, blending: THREE.AdditiveBlending, transparent: true, sizeAttenuation: false }));
  s.scale.setScalar(0.28 * scale); s.renderOrder = 5;
  return s;
}

// Procedural textures used by spacecraft: crinkled MLI foil normal map and panel-line maps.
export function foilNormalMap(size = 256, seed = 7) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size; const c = cv.getContext('2d');
  let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  c.fillStyle = 'rgb(128,128,255)'; c.fillRect(0, 0, size, size);
  for (let i = 0; i < 260; i++) {
    const x = rnd() * size, y = rnd() * size, a = rnd() * Math.PI, l = 10 + rnd() * 50, w = 2 + rnd() * 8;
    const nx = Math.cos(a + Math.PI / 2), ny = Math.sin(a + Math.PI / 2), k = (rnd() - 0.5) * 120;
    c.save(); c.translate(x, y); c.rotate(a);
    const g = c.createLinearGradient(0, -w, 0, w);
    g.addColorStop(0, `rgba(${128 - nx * k},${128 - ny * k},255,0)`); g.addColorStop(0.5, `rgba(${128 + nx * k},${128 + ny * k},255,.55)`); g.addColorStop(1, `rgba(${128 - nx * k},${128 - ny * k},255,0)`);
    c.fillStyle = g; c.fillRect(-l / 2, -w, l, 2 * w); c.restore();
  }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
export function panelTexture({ size = 512, base = '#e9ecef', line = 'rgba(40,46,54,.35)', cols = 8, rows = 4, rivets = true, noise = 0.05 } = {}) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size; const c = cv.getContext('2d');
  c.fillStyle = base; c.fillRect(0, 0, size, size);
  const img = c.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * 255 * noise; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  c.putImageData(img, 0, 0);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const v = (Math.random() - 0.5) * 18; c.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`;
    c.fillRect(i * size / cols, j * size / rows, size / cols, size / rows);
  }
  c.strokeStyle = line; c.lineWidth = 2;
  for (let i = 0; i <= cols; i++) { c.beginPath(); c.moveTo(i * size / cols, 0); c.lineTo(i * size / cols, size); c.stroke(); }
  for (let j = 0; j <= rows; j++) { c.beginPath(); c.moveTo(0, j * size / rows); c.lineTo(size, j * size / rows); c.stroke(); }
  if (rivets) { c.fillStyle = 'rgba(30,34,40,.35)'; for (let j = 0; j <= rows; j++) for (let i = 0; i < cols * 6; i++) c.fillRect(i * size / cols / 6, j * size / rows - 1, 2, 2); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
export function solarCellTexture({ size = 512, cellsX = 8, cellsY = 16, base = '#14204a', grid = '#8a9ac8' } = {}) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size; const c = cv.getContext('2d');
  c.fillStyle = base; c.fillRect(0, 0, size, size);
  const cw = size / cellsX, ch = size / cellsY;
  for (let j = 0; j < cellsY; j++) for (let i = 0; i < cellsX; i++) {
    const g = c.createLinearGradient(i * cw, j * ch, (i + 1) * cw, (j + 1) * ch);
    const v = 18 + Math.random() * 10; g.addColorStop(0, `rgb(${v},${v + 14},${v + 58})`); g.addColorStop(1, `rgb(${v - 6},${v + 4},${v + 40})`);
    c.fillStyle = g; c.fillRect(i * cw + 1.5, j * ch + 1.5, cw - 3, ch - 3);
    c.fillStyle = 'rgba(190,200,230,.18)'; for (let k = 1; k < 4; k++) c.fillRect(i * cw + 1.5, j * ch + k * ch / 4, cw - 3, 0.8);
  }
  c.strokeStyle = grid; c.lineWidth = 1.5; c.strokeRect(1, 1, size - 2, size - 2);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// Merge every mesh under `root` that shares a material into one mesh (static geometry → few draw calls).
export async function mergeStatic(root, { keep = () => false } = {}) {
  const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map(), drop = [];
  root.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || keep(o) || o.userData.dynamic) return;
    let p = o.parent, dyn = false; while (p && p !== root) { if (p.userData.dynamic) dyn = true; p = p.parent; }
    if (dyn) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const key = o.material.uuid + (o.castShadow ? 'c' : '') + (o.receiveShadow ? 'r' : '');
    if (!groups.has(key)) groups.set(key, { mat: o.material, cast: o.castShadow, recv: o.receiveShadow, geos: [] });
    groups.get(key).geos.push(g); drop.push(o);
  });
  drop.forEach(o => o.parent.remove(o));
  let n = 0;
  for (const { mat, cast, recv, geos } of groups.values()) {
    const m = new THREE.Mesh(mergeGeometries(geos, false), mat); m.castShadow = cast; m.receiveShadow = recv; root.add(m); n++;
  }
  return n;
}

// ---------- settings menu + FPS meter (DOM) ----------
export function mountSettings(button, { extra = [] } = {}) {
  const pop = document.createElement('div');
  pop.className = 'pop settings'; pop.hidden = true; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Settings');
  const seg = (k, opts) => `<div class="seg" data-k="${k}">${opts.map(([v, l]) => `<button type="button" data-v="${v}">${l}</button>`).join('')}</div>`;
  pop.innerHTML = `<div class="sec">Graphics quality</div>${seg('quality', [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Med'], ['high', 'High']])}
    <p class="hint">Auto lowers the resolution when frames get slow.</p>
    <div class="sec">Display</div>
    <label class="chk"><input type="checkbox" data-k="fps"> Show frame rate</label>
    <label class="chk"><input type="checkbox" data-k="invertY"> Invert camera drag (vertical)</label>
    <div class="sec">Touch controls</div>${seg('touch', [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']])}
    ${extra.map(e => e.html).join('')}`;
  document.body.appendChild(pop);
  const sync = () => {
    pop.querySelectorAll('.seg').forEach(s => s.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', settings[s.dataset.k] === b.dataset.v)));
    pop.querySelectorAll('input[data-k]').forEach(i => i.checked = !!settings[i.dataset.k]);
  };
  pop.addEventListener('click', e => { const b = e.target.closest('.seg button'); if (b) { saveSettings({ [b.closest('.seg').dataset.k]: b.dataset.v }); sync(); } });
  pop.addEventListener('change', e => { const i = e.target.closest('input[data-k]'); if (i) saveSettings({ [i.dataset.k]: i.checked }); });
  const place = () => { const r = button.getBoundingClientRect(); pop.style.top = (r.bottom + 6) + 'px'; pop.style.left = Math.max(8, Math.min(innerWidth - 268, r.left)) + 'px'; };
  const close = () => { pop.hidden = true; button.setAttribute('aria-expanded', 'false'); };
  button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', e => { e.stopPropagation(); if (pop.hidden) { sync(); place(); pop.hidden = false; button.setAttribute('aria-expanded', 'true'); } else close(); button.blur(); });
  addEventListener('pointerdown', e => { if (!pop.hidden && !pop.contains(e.target) && e.target !== button) close(); });
  addEventListener('keydown', e => { if (e.code === 'Escape') close(); });
  addEventListener('resize', () => { if (!pop.hidden) place(); });
  extra.forEach(e => e.bind && e.bind(pop));
  return pop;
}
export class FpsMeter {
  constructor() { this.el = document.createElement('div'); this.el.className = 'fps'; document.body.appendChild(this.el); this.t = 0; this.n = 0; this.show(settings.fps); onSettings(s => this.show(s.fps)); }
  show(on) { this.el.style.display = on ? 'block' : 'none'; }
  tick(dt, renderer) {
    this.t += dt; this.n++;
    if (this.t > 0.5) { const i = renderer && renderer.info.render; this.el.textContent = `${(this.n / this.t).toFixed(0)} fps · ${(1000 * this.t / this.n).toFixed(1)} ms${i ? ` · ${i.calls} draws · ${(i.triangles / 1000).toFixed(0)}k tris` : ''}${renderer ? ` · ${renderer.getPixelRatio().toFixed(2)}×` : ''}`; this.t = 0; this.n = 0; }
  }
}

// Loading screen helper: <div id="loading"> with a progress bar.
export function loadingStep(text, frac) {
  const el = document.getElementById('loading'); if (!el) return;
  const t = el.querySelector('.lt'), b = el.querySelector('.lb i');
  if (t) t.textContent = text; if (b && frac != null) b.style.width = (frac * 100).toFixed(0) + '%';
}
export function loadingDone() { const el = document.getElementById('loading'); if (el) { el.classList.add('done'); setTimeout(() => el.remove(), 450); } }
export function loadTexture(url, { srgb = true, aniso = 8 } = {}) {
  return new Promise(res => new THREE.TextureLoader().load(url, t => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; res(t); }, undefined, () => res(null)));
}

// Telemetry panel that builds its rows once and then only touches text/class when a value changes.
// spec items: { sec: 'Title' } | { k: 'id', label: 'Range' } | { bar: 'id' } | { html: '...' }
export class Readout {
  constructor(el, spec) {
    this.el = el; this.v = {}; this.c = {}; this.n = {};
    el.innerHTML = spec.map(s => s.sec ? `<div class="sec">${s.sec}</div>` : s.bar ? `<div class="bar" data-b="${s.bar}"><i></i>${(s.marks || []).map((m, i) => `<s data-m="${i}" style="left:${m}%"></s>`).join('')}</div>` : s.html ? s.html : `<div class="row" data-r="${s.k}"><span>${s.label}</span><b></b></div>`).join('');
    el.querySelectorAll('[data-r]').forEach(r => { this.n[r.dataset.r] = r.querySelector('b'); });
    el.querySelectorAll('[data-b]').forEach(b => { this.n['bar:' + b.dataset.b] = b; });
  }
  set(k, text, cls = '') {
    const n = this.n[k]; if (!n) return;
    if (this.v[k] !== text) { n.textContent = text; this.v[k] = text; }
    if (this.c[k] !== cls) { n.className = cls; this.c[k] = cls; }
  }
  bar(k, frac, color = '', marks) {
    const b = this.n['bar:' + k]; if (!b) return;
    const w = Math.max(0, Math.min(100, frac * 100)).toFixed(1), i = b.firstChild;
    if (this.v['bar:' + k] !== w) { i.style.width = w + '%'; this.v['bar:' + k] = w; }
    if (this.c['bar:' + k] !== color) { i.style.background = color; this.c['bar:' + k] = color; }
    if (marks) marks.forEach((m, j) => { const s = b.querySelector(`[data-m="${j}"]`); if (s) s.style.left = Math.max(0, Math.min(100, m)) + '%'; });
  }
  label(k, text) { const n = this.n[k]; if (n && n.previousSibling && n.previousSibling.textContent !== text) n.previousSibling.textContent = text; }
}
// Chip strip: [['RATE HOLD', on, cls?], ...]
export function chips(el, list) {
  const html = list.filter(Boolean).map(([n, on, cls]) => `<span class="chip ${on ? (cls || 'on') : ''}">${n}</span>`).join('');
  if (el._h !== html) { el.innerHTML = html; el._h = html; }
}
// Short "drag to look around" hint that fades after a few seconds.
export function camHint(text = 'Drag to look around · scroll to zoom · double-click to re-centre') {
  let el = document.querySelector('.camhint'); if (!el) { el = document.createElement('div'); el.className = 'camhint'; document.querySelector('.hud').appendChild(el); }
  el.textContent = text; el.classList.add('show'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 3800);
}
export function modal(el, show) { if (show) { el.style.display = 'block'; requestAnimationFrame(() => el.classList.add('show')); } else { el.classList.remove('show'); el.style.display = 'none'; } }
