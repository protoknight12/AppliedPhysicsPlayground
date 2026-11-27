/* Physics Sandbox — site chrome shared by every simulator page:
   the sim catalogue, a "switch simulator" menu next to the back link, and the favicon. Plain script, no dependencies. */
(function () {
  const here = document.currentScript && document.currentScript.src;
  const root = here ? new URL('../', here).href : '../';
  const SIMS = [
    { id: 'fusion', name: 'Fusion reactor', sub: 'HELIX-6 tokamak', group: 'Energy', c: '#ff4f9a' },
    { id: 'fission', name: 'Fission reactor', sub: '10 designs · build your own', group: 'Energy', c: '#4fb6ff' },
    { id: 'grid', name: 'Grid operator', sub: 'Keep 50 Hz through a day', group: 'Energy', c: '#5be39a' },
    { id: 'launch', name: 'Launch to orbit', sub: 'Two-stage ascent · gravity turn', group: 'Spaceflight', c: '#ff9f43' },
    { id: 'docking', name: 'Orbital docking', sub: 'CW relative motion · 6-DOF RCS', group: 'Spaceflight', c: '#7cc8ff' },
    { id: 'reentry', name: 'Atmospheric entry', sub: 'Lift-vector steering · heat shield', group: 'Spaceflight', c: '#ff6b5a' },
    { id: 'lander', name: 'Lunar lander', sub: 'Apollo-class LM · 1.62 m/s²', group: 'Spaceflight', c: '#ffc857' },
  ];
  window.APS_SIMS = SIMS;
  const cur = (location.pathname.match(/\/([a-z]+)\/(?:index\.html)?$/) || [])[1];

  if (!document.querySelector('link[rel~="icon"]')) {
    const l = document.createElement('link'); l.rel = 'icon'; l.type = 'image/svg+xml'; l.href = root + 'favicon.svg'; document.head.appendChild(l);
  }
  if (!document.querySelector('meta[name="theme-color"]')) {
    const m = document.createElement('meta'); m.name = 'theme-color'; m.content = '#0b0d10'; document.head.appendChild(m);
  }

  function mount() {
    const slot = document.querySelector('[data-sitenav]') || (() => {
      const back = document.querySelector('a[href="../"]'); if (!back) return null;
      const s = document.createElement('span'); back.after(s); return s;
    })();
    if (!slot || slot.dataset.mounted) return; slot.dataset.mounted = '1';
    const css = document.createElement('style');
    css.textContent = `.simnav{position:relative;display:inline-flex}
.simnav>button{height:30px;display:inline-flex;align-items:center;gap:6px;padding:0 9px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(22,27,33,.7);color:#8b97a3;font:500 12.5px Inter,system-ui,sans-serif;cursor:pointer}
.simnav>button:hover,.simnav>button[aria-expanded=true]{color:#e8ecef;border-color:rgba(255,255,255,.26)}
.simnav>button svg{width:14px;height:14px}
.simnav .menu{position:fixed;z-index:60;min-width:270px;padding:6px;border-radius:12px;background:rgba(14,18,23,.96);border:1px solid rgba(255,255,255,.14);box-shadow:0 18px 50px rgba(0,0,0,.6);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px)}
.simnav .menu[hidden]{display:none}
.simnav .g{font:500 10.5px "JetBrains Mono",monospace;letter-spacing:.09em;text-transform:uppercase;color:#5d6873;padding:8px 10px 4px}
.simnav .menu a{display:grid;grid-template-columns:10px 1fr;gap:2px 10px;align-items:center;padding:7px 10px;border-radius:8px;text-decoration:none;color:#e8ecef}
.simnav .menu a i{width:8px;height:8px;border-radius:50%;grid-row:1/3}
.simnav .menu a b{font:600 13.5px Inter,system-ui,sans-serif}
.simnav .menu a small{font-size:12px;color:#8b97a3;grid-column:2}
.simnav .menu a:hover,.simnav .menu a:focus-visible{background:rgba(255,255,255,.06);outline:none}
.simnav .menu a[aria-current=page]{background:rgba(124,200,255,.1)}
.simnav .menu .home{grid-template-columns:1fr;border-top:1px solid rgba(255,255,255,.08);margin-top:6px;border-radius:0 0 8px 8px;color:#8b97a3;font-size:13px}`;
    document.head.appendChild(css);
    const wrap = document.createElement('span'); wrap.className = 'simnav';
    let html = `<button type="button" aria-haspopup="true" aria-expanded="false" title="Switch simulator"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>Sims</button><div class="menu" role="menu" hidden>`;
    let g = '';
    for (const s of SIMS) {
      if (s.group !== g) { g = s.group; html += `<div class="g">${g}</div>`; }
      html += `<a role="menuitem" href="${root}${s.id}/"${s.id === cur ? ' aria-current="page"' : ''}><i style="background:${s.c};box-shadow:0 0 8px ${s.c}"></i><b>${s.name}</b><small>${s.sub}</small></a>`;
    }
    html += `<a role="menuitem" class="home" href="${root}">All simulators →</a></div>`;
    wrap.innerHTML = html; slot.appendChild(wrap);
    const btn = wrap.querySelector('button'), menu = wrap.querySelector('.menu');
    const place = () => { const r = btn.getBoundingClientRect(); menu.style.top = (r.bottom + 6) + 'px'; menu.style.left = Math.max(8, Math.min(innerWidth - 290, r.left)) + 'px'; };
    const open = v => { menu.hidden = !v; btn.setAttribute('aria-expanded', v); if (v) { place(); (menu.querySelector('[aria-current]') || menu.querySelector('a')).focus(); } };
    btn.addEventListener('click', e => { e.stopPropagation(); open(menu.hidden); });
    addEventListener('pointerdown', e => { if (!wrap.contains(e.target)) open(false); });
    menu.addEventListener('keydown', e => {
      const items = [...menu.querySelectorAll('a')], i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); items[(i + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.key === 'Escape') { open(false); btn.focus(); }
      e.stopPropagation();
    });
    addEventListener('resize', () => { if (!menu.hidden) place(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
