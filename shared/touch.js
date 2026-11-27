// Physics Sandbox — on-screen controls for touch devices. They synthesise the same keyboard events the
// sims already listen to, so every keyboard control works on a phone or tablet without separate code paths.
import { settings, onSettings } from './three/kit.js';

const send = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }));

// layout: { sticks: [{ side: 'l'|'r', label, x: [negCode, posCode], y: [upCode, downCode] }],
//           buttons: [{ label, code, hold?: bool, side?: 'l'|'r' }] }
export function installTouch(layout) {
  const root = document.createElement('div'); root.className = 'touch'; document.body.appendChild(root);
  const held = new Set();
  const press = c => { if (!held.has(c)) { held.add(c); send('keydown', c); } };
  const release = c => { if (held.has(c)) { held.delete(c); send('keyup', c); } };
  for (const s of layout.sticks || []) {
    const el = document.createElement('div'); el.className = 'stick ' + (s.side || 'l');
    el.innerHTML = `<span>${s.label || ''}</span><i></i>`; root.appendChild(el);
    const knob = el.querySelector('i'); let id = null;
    const upd = (cx, cy) => {
      const r = el.getBoundingClientRect(), R = r.width / 2;
      let dx = (cx - r.left - R) / R, dy = (cy - r.top - R) / R; const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
      knob.style.transform = `translate(${dx * R * 0.6}px,${dy * R * 0.6}px)`;
      const th = 0.32;
      if (s.x) { dx < -th ? press(s.x[0]) : release(s.x[0]); dx > th ? press(s.x[1]) : release(s.x[1]); }
      if (s.y) { dy < -th ? press(s.y[0]) : release(s.y[0]); dy > th ? press(s.y[1]) : release(s.y[1]); }
    };
    el.addEventListener('pointerdown', e => { id = e.pointerId; el.setPointerCapture(id); upd(e.clientX, e.clientY); e.preventDefault(); });
    el.addEventListener('pointermove', e => { if (e.pointerId === id) upd(e.clientX, e.clientY); });
    const end = e => { if (e.pointerId !== id) return; id = null; knob.style.transform = ''; [...(s.x || []), ...(s.y || [])].forEach(release); };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }
  const cols = { l: null, r: null };
  for (const b of layout.buttons || []) {
    const side = b.side || 'r';
    if (!cols[side]) { cols[side] = document.createElement('div'); cols[side].className = 'tbtns ' + side; root.appendChild(cols[side]); }
    const el = document.createElement('button'); el.type = 'button'; el.textContent = b.label; cols[side].appendChild(el);
    el.addEventListener('pointerdown', e => { e.preventDefault(); el.classList.add('held'); press(b.code); if (!b.hold) setTimeout(() => { release(b.code); el.classList.remove('held'); }, 90); });
    const up = () => { if (b.hold) { release(b.code); el.classList.remove('held'); } };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('pointerleave', up);
  }
  const apply = () => {
    const on = settings.touch === 'on' || (settings.touch === 'auto' && matchMedia('(pointer: coarse)').matches);
    root.style.display = on ? '' : 'none'; document.body.classList.toggle('has-touch', on);
    if (!on) [...held].forEach(release);
  };
  apply(); onSettings(apply);
  return root;
}
