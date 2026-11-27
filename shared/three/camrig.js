// Physics Sandbox — draggable camera rig shared by the 3D sims.
// Every camera mode can be moved: drag to orbit (external views) or look around (cockpit views),
// wheel / pinch to zoom, double-click to re-centre. Offsets are relative to each mode's base view,
// so the camera keeps following the vehicle while you look around it.
import * as THREE from 'three';
import { settings } from './kit.js';

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);

export class CamRig {
  constructor(canvas, camera, { minZoom = 0.15, maxZoom = 40, sensitivity = 0.0055 } = {}) {
    this.cam = camera; this.el = canvas;
    this.yaw = 0; this.pitch = 0; this.zoom = 1;          // targets
    this.cy = 0; this.cp = 0; this.cz = 1;                // smoothed
    this.minZoom = minZoom; this.maxZoom = maxZoom; this.sens = sensitivity;
    this.pointers = new Map(); this.pinch0 = 0; this.dragging = false; this.lastInput = -1e9;
    this.mode = 'orbit';
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      canvas.setPointerCapture(e.pointerId); this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) this.pinch0 = this._pinchDist();
      this.dragging = true; canvas.classList.add('grabbing');
    });
    canvas.addEventListener('pointermove', e => {
      const p = this.pointers.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (this.pointers.size === 2) { const d = this._pinchDist(); if (this.pinch0 > 0) this.setZoom(this.zoom * this.pinch0 / d); this.pinch0 = d; return; }
      const inv = settings.invertY ? -1 : 1, k = this.sens * (this.mode === 'look' ? 0.55 * this.cam.fov / 55 : 1);
      this.yaw -= dx * k; this.pitch -= dy * k * inv;
      this._clamp(); this.lastInput = performance.now();
    });
    const up = e => { this.pointers.delete(e.pointerId); if (!this.pointers.size) { this.dragging = false; canvas.classList.remove('grabbing'); } this.pinch0 = 0; };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', e => { e.preventDefault(); this.setZoom(this.zoom * Math.exp(e.deltaY * 0.0012)); this.lastInput = performance.now(); }, { passive: false });
    canvas.addEventListener('dblclick', () => this.reset());
  }
  _pinchDist() { const [a, b] = [...this.pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; }
  _clamp() {
    if (this.mode === 'look') { this.yaw = THREE.MathUtils.clamp(this.yaw, -2.4, 2.4); this.pitch = THREE.MathUtils.clamp(this.pitch, -1.2, 1.2); }
    else this.pitch = THREE.MathUtils.clamp(this.pitch, this.pitchMin ?? -1.45, this.pitchMax ?? 1.45);
  }
  setZoom(z) { this.zoom = THREE.MathUtils.clamp(z, this.minZoom, this.maxZoom); }
  reset(instant = false) { this.yaw = 0; this.pitch = 0; this.zoom = 1; if (instant) { this.cy = this.cp = 0; this.cz = 1; } }
  setMode(mode, { pitchMin, pitchMax } = {}) { if (mode !== this.mode) this.reset(true); this.mode = mode; this.pitchMin = pitchMin; this.pitchMax = pitchMax; this._clamp(); }
  get active() { return performance.now() - this.lastInput < 4000 || Math.abs(this.cy) + Math.abs(this.cp) > 0.02 || Math.abs(Math.log(this.cz)) > 0.02; }
  _smooth(dt) {
    const k = 1 - Math.exp(-dt * 14);
    this.cy += (this.yaw - this.cy) * k; this.cp += (this.pitch - this.cp) * k; this.cz *= Math.pow(this.zoom / this.cz, k);
  }
  // External view: camera sits at `offset` (in the base frame) from `target`, rotated by the user's yaw/pitch
  // about the base frame's up/right axes. `baseQ` orients the base frame in world space; `up` is the world
  // up vector for the camera (defaults to the base frame's up).
  orbit(target, baseQ, offset, dt, { up = null, look = null, minDist = 0.5 } = {}) {
    this.mode = 'orbit'; this._smooth(dt);
    _q.setFromAxisAngle(Y, this.cy); _q2.setFromAxisAngle(X, this.cp); _q.multiply(_q2);
    _v.copy(offset).multiplyScalar(this.cz);
    if (_v.length() < minDist) _v.setLength(minDist);
    _v.applyQuaternion(_q).applyQuaternion(baseQ);
    this.cam.position.copy(target).add(_v);
    this.cam.up.copy(up || _v2.copy(Y).applyQuaternion(baseQ));
    this.cam.lookAt(look || target);
    return this.cam.position;
  }
  // Cockpit view: eye fixed to the vehicle, view direction = base forward (-Z of baseQ) turned by yaw/pitch.
  look(eye, baseQ, dt) {
    this.mode = 'look'; this._smooth(dt);
    _q.copy(baseQ).multiply(_q2.setFromAxisAngle(Y, this.cy)).multiply(_q2.setFromAxisAngle(X, this.cp));
    this.cam.position.copy(eye); this.cam.quaternion.copy(_q);
    const z = THREE.MathUtils.clamp(1 / this.cz, 0.35, 3);
    if (Math.abs(this.cam.zoom - z) > 1e-3) { this.cam.zoom = z; this.cam.updateProjectionMatrix(); }
    return this.cam.position;
  }
  // Fixed-site camera (e.g. a tracking camera on the ground): looks from `eye` at `target`; drag pans around that line.
  track(eye, target, up, dt) {
    this.mode = 'look'; this._smooth(dt);
    _m.lookAt(eye, target, up); _q.setFromRotationMatrix(_m);
    _q.multiply(_q2.setFromAxisAngle(Y, this.cy)).multiply(_q2.setFromAxisAngle(X, this.cp));
    this.cam.position.copy(eye); this.cam.quaternion.copy(_q);
    const z = THREE.MathUtils.clamp(1 / this.cz, 0.25, 8);
    if (Math.abs(this.cam.zoom - z) > 1e-3) { this.cam.zoom = z; this.cam.updateProjectionMatrix(); }
    return this.cam.position;
  }
  // Leave cockpit/track zoom when switching to an orbit mode.
  clearZoom() { if (this.cam.zoom !== 1) { this.cam.zoom = 1; this.cam.updateProjectionMatrix(); } }
}
