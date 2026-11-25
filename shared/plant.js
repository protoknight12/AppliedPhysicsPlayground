/* Physics Sandbox — shared balance-of-plant model and plant-overview renderer.
   Used by the fission and fusion simulators.
   Model: primary loop (core node + cold leg), steam generator / IHX, secondary steam drum,
   turbine-generator with governor and grid, condenser, cooling tower, feedwater, RHR.
   Units: MW, °C, s. Temperatures in the core node are "enthalpy temperatures": above the
   boiling point the excess is read as steam quality. */
(function (G) {
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;

  // ---------- coolant library ----------
  // P bar, boil °C (at P), freeze °C, Tin/Tout nominal core °C, Ts steam °C, eta cycle,
  // natc natural-circulation flow fraction, pump fraction of Pth at full flow,
  // hfgK latent heat expressed in kelvin of liquid cp, rr vapour/liquid density ratio,
  // tauC core-node time constant s, loop 'pwr'|'bwr'|'gas'|'metal'
  const COOL = {
    h2o_p: { name: 'Pressurised light water', short: 'H₂O · 155 bar', medium: 'h2o', P: 155, boil: 345, freeze: 0, Tin: 292, Tout: 325, Ts: 285, steam: 285, eta: 0.335, natc: 0.04, pump: 0.006, hfgK: 170, rr: 0.10, tauC: 6, loop: 'pwr', col: '#5aa9ff', absorb: 0.0222 },
    h2o_b: { name: 'Boiling light water', short: 'H₂O · 70 bar boiling', medium: 'h2o', P: 70, boil: 286, freeze: 0, Tin: 278, Tout: 286, Ts: 272, steam: 286, xn: 0.14, eta: 0.34, natc: 0.25, pump: 0.004, hfgK: 280, rr: 0.05, tauC: 5, loop: 'bwr', col: '#7fc4ff', absorb: 0.0222 },
    d2o: { name: 'Pressurised heavy water', short: 'D₂O · 100 bar', medium: 'd2o', P: 100, boil: 311, freeze: 4, Tin: 266, Tout: 310, Ts: 260, steam: 260, eta: 0.30, natc: 0.04, pump: 0.006, hfgK: 200, rr: 0.07, tauC: 6, loop: 'pwr', col: '#8fb5ff', absorb: 0.00008 },
    co2: { name: 'Carbon dioxide gas', short: 'CO₂ · 40 bar', medium: 'gas', P: 40, boil: Infinity, freeze: -60, Tin: 290, Tout: 640, Ts: 250, steam: 540, eta: 0.41, natc: 0.015, pump: 0.025, hfgK: 0, rr: 1, tauC: 2.5, loop: 'gas', col: '#c9d3dd', absorb: 0.00001 },
    he: { name: 'Helium gas', short: 'He · 70 bar', medium: 'gas', P: 70, boil: Infinity, freeze: -270, Tin: 260, Tout: 750, Ts: 250, steam: 545, eta: 0.42, natc: 0.01, pump: 0.03, hfgK: 0, rr: 1, tauC: 2.5, loop: 'gas', col: '#ffe9a8', absorb: 0 },
    na: { name: 'Liquid sodium', short: 'Na · 1 bar', medium: 'metal', P: 1, boil: 883, freeze: 98, Tin: 395, Tout: 545, Ts: 330, steam: 495, eta: 0.40, natc: 0.06, pump: 0.003, hfgK: 3000, rr: 0.0005, tauC: 8, loop: 'metal', col: '#ffb15a', absorb: 0.0135 },
    pb: { name: 'Liquid lead', short: 'Pb · 1 bar', medium: 'metal', P: 1, boil: 1749, freeze: 327, Tin: 400, Tout: 480, Ts: 330, steam: 450, eta: 0.42, natc: 0.12, pump: 0.004, hfgK: 6000, rr: 0.0005, tauC: 12, loop: 'metal', col: '#b9b2c9', absorb: 0.0056 },
    pbbi: { name: 'Lead–bismuth eutectic', short: 'Pb-Bi · 1 bar', medium: 'metal', P: 1, boil: 1670, freeze: 125, Tin: 300, Tout: 450, Ts: 260, steam: 420, eta: 0.38, natc: 0.10, pump: 0.004, hfgK: 6000, rr: 0.0005, tauC: 11, loop: 'metal', col: '#c8a7d6', absorb: 0.0062 },
    flibe: { name: 'Molten salt (FLiBe)', short: 'FLiBe · 1 bar', medium: 'salt', P: 1, boil: 1430, freeze: 459, Tin: 560, Tout: 700, Ts: 450, steam: 580, eta: 0.44, natc: 0.08, pump: 0.004, hfgK: 2500, rr: 0.0005, tauC: 9, loop: 'metal', col: '#7ff0c8', absorb: 0.0010 },
    pbli: { name: 'Lead–lithium (Pb-17Li)', short: 'PbLi · 1 bar', medium: 'metal', P: 1, boil: 1700, freeze: 235, Tin: 480, Tout: 700, Ts: 400, steam: 560, eta: 0.44, natc: 0.05, pump: 0.012, hfgK: 6000, rr: 0.0005, tauC: 10, loop: 'metal', col: '#d6c2ff', absorb: 0.006 }
  };

  function create(cfg) {
    const c = COOL[cfg.coolant];
    const Pn = cfg.Pnom;
    const Wcp = Pn / (c.Tout - c.Tin + (c.xn || 0) * c.hfgK);
    const avg = (c.Tout + c.Tin) / 2;
    const st = {
      kind: cfg.kind, Pn, cfgCool: cfg.coolant, c, Wcp,
      UAsg: Pn / Math.max(5, avg - c.Ts),
      C1: Wcp * c.tauC, C2: Wcp * 10, Cs: Pn / 1.2 * (cfg.storage || 1), Ccond: Pn * 0.25,
      Hhot: c.Tout + (c.xn || 0) * c.hfgK, Tcold: c.Tin, Ts: c.Ts, Tcond: 33, level: 0.5, inv: 1,
      flow: 1, pumpOn: true, pumpCmd: 1, feedOn: true, afwAuto: true, afwOn: false,
      valve: 1, loadAuto: true, loadSet: 1, tripped: false, rpm: 1, breaker: true, gridOk: true,
      circOn: true, fans: 0.5, ambient: 15, dumpAuto: true, rhrOn: false, diesel: true, dieselOK: true,
      Qsg: Pn, Qturb: Pn, Qdump: 0, Qrelief: 0, Qct: Pn * (1 - c.eta), Pm: 0, Pe: 0, house: 0, x: 0, void: 0, frozen: false,
      events: [], etaNow: c.eta, Qcore: Pn, tAcc: 0
    };
    st.Pe_nom = Pn * c.eta;
    st.Pm = st.Pe = st.Pe_nom; st.loadSet = 1;
    // condenser / tower sizing at 15 °C ambient, fans 50 %
    st.UAct = Pn * (1 - c.eta) / ((33 - 15) * 1.0);
    return st;
  }
  const press = st => st.c.P * (st.c.medium === 'gas' ? st.inv : 1) * (st.c.medium === 'h2o' || st.c.medium === 'd2o' ? clamp(0.25 + 0.75 * st.inv, 0.05, 1.1) : 1);
  const Tsat = (st) => st.c.boil * (st.c.medium === 'h2o' || st.c.medium === 'd2o' ? clamp(Math.pow(press(st) / st.c.P, 0.12), 0.3, 1.1) : 1);

  function note(st, msg, lvl) { st.events.push({ msg, lvl: lvl || 'info' }); }

  function carnot(Ts, Tc) { return Math.max(0, 1 - (Tc + 273) / (Ts + 273)); }

  // one integration step. Q = heat deposited in primary coolant (MW)
  function step(st, dt, Q) {
    const c = st.c, Pn = st.Pn;
    st.Qcore = Q;
    const offsite = st.gridOk;
    const aux = offsite || (st.diesel && st.dieselOK); // safety buses
    // --- pumps ---
    const pumpPowered = offsite;
    const tgt = st.pumpOn && pumpPowered && !st.frozen ? st.pumpCmd : 0;
    st.flow += (tgt - st.flow) * Math.min(1, dt / (tgt > st.flow ? 6 : 14));
    const ts = Math.max(Tsat(st), 1);
    if (st.Tcold < c.freeze + 5 && !st.frozen) { st.frozen = true; note(st, `Coolant froze in the cold leg (${c.freeze} °C) — loop blocked`, 'crit'); }
    if (st.frozen && st.Tcold > c.freeze + 25) { st.frozen = false; note(st, 'Coolant re-melted — loop flow restored', 'good'); }
    const nat = st.frozen ? 0.0005 : c.natc * Math.cbrt(clamp(Math.max(Q, 0) / Pn, 0, 3)) + 0.003;
    const fl = Math.max(st.flow, nat) * (c.medium === 'gas' ? Math.max(st.inv, 0.02) : clamp(st.inv * 1.4, 0.05, 1) * (st.inv < 0.3 ? 0.2 : 1));
    st.flowEff = fl;
    const W = st.Wcp * fl;
    // --- core node (enthalpy temperature) ---
    const Fh = W * (st.Hhot - st.Tcold);
    st.Hhot += (Q - Fh) / st.C1 * dt;
    const ThotV = Math.min(st.Hhot, ts);
    st.x = c.hfgK > 0 ? clamp((st.Hhot - ts) / c.hfgK, 0, 1) : 0;
    const xa = st.x / 2;
    st.void = c.hfgK > 0 ? xa / (xa + (1 - xa) * c.rr * 1.5 + 1e-9) : 0;
    if (st.inv < 1 && c.medium !== 'gas') st.void = Math.max(st.void, clamp((1 - st.inv) * 1.6, 0, 1));
    // --- steam generator / IHX ---
    const dry = clamp(st.level / 0.3, 0.03, 1);
    const sep = c.loop === 'bwr' ? W * st.x * c.hfgK : 0; // BWR: separated steam goes straight to turbine
    const Tdrv = st.Tcold + (ThotV - st.Tcold) * 0.5 * clamp(fl / 0.15, 0.1, 1);
    st.Qsg = Math.max(0, st.UAsg * dry * (Tdrv - st.Ts));
    st.Qsg = Math.min(st.Qsg, Math.max(0, Fh + (st.Tcold - st.Ts) * st.C2 / 20)) + sep;
    const Qrhr = st.rhrOn && aux ? Math.min(0.03 * Pn, Math.max(0, st.Tcold - Math.max(50, c.freeze + 90)) * Pn * 0.0004) : 0;
    st.Qrhr = Qrhr;
    st.Tcold += (Fh - st.Qsg - Qrhr) / st.C2 * dt;
    st.Thot = ThotV;
    // --- turbine / governor ---
    const sdrive = clamp((st.Ts - 30) / (c.Ts - 30), 0, 1.4);
    const condOK = st.circOn && offsite && st.Tcond < 70;
    if (!st.tripped) {
      if (st.Tcond > 65) trip(st, `low condenser vacuum (${st.Tcond.toFixed(0)} °C)`);
      else if (st.rpm > 1.1) trip(st, 'turbine overspeed 110 %');
      else if (st.Ts < c.Ts - 90 && st.valve > 0.05) trip(st, 'low steam pressure');
    }
    let vt = 0;
    if (!st.tripped) {
      if (st.breaker && st.gridOk && st.rpm > 0.985) {
        if (st.loadAuto) {
          const err = st.loadSet * st.Pe_nom - st.Pe;
          st.valve = clamp(st.valve + err / st.Pe_nom * dt * 0.25, 0, 1);
          if (st.Ts < c.Ts - 25) st.valve = Math.max(0, st.valve - dt * 0.05); // limit pressure drop
        }
        vt = st.valve;
      } else {
        // roll-up / islanded governor holds 100 % speed
        const err = 1 - st.rpm;
        st.valve = clamp(st.valve + err * dt * 2 - (st.rpm > 1.02 ? dt : 0), 0, 0.3);
        vt = st.valve;
      }
    } else st.valve = Math.max(0, st.valve - dt * 4);
    st.Qturb = vt * Pn * sdrive;
    st.etaNow = c.eta * carnot(st.Ts + c.steam - c.Ts, st.Tcond) / carnot(c.steam, 33);
    st.Pm = st.Qturb * st.etaNow;
    const synced = st.breaker && st.gridOk && !st.tripped && st.rpm > 0.985;
    if (synced) { st.rpm += (1 - st.rpm) * Math.min(1, dt * 3); st.Pe = st.Pm * 0.985; }
    else {
      const load = st.breaker && st.gridOk ? 0 : 0.03 * st.Pe_nom; // islanded: house load only
      st.rpm += ((st.Pm - load) / st.Pe_nom - 0.02 * st.rpm * st.rpm) * dt / 6;
      st.rpm = Math.max(0, st.rpm); st.Pe = synced ? st.Pm : 0;
      if (st.rpm > 0.985 && st.rpm < 1.02 && !st.tripped && st.gridOk && st.breakerWant !== false && !st.breaker) { st.breaker = true; note(st, 'Generator synchronised to grid', 'good'); }
    }
    if (!st.gridOk && st.breaker) { st.breaker = false; note(st, 'Generator breaker opened — grid lost (load rejection)', 'warn'); }
    if (st.tripped && st.breaker && st.rpm < 0.995) { st.breaker = false; note(st, 'Generator breaker opened (reverse power)', 'info'); }
    // --- steam dump & relief ---
    const excess = st.Ts - c.Ts;
    st.Qdump = st.dumpAuto && condOK && excess > 2 ? clamp((excess - 2) / 10, 0, 1) * 0.4 * Pn : 0;
    st.Qrelief = excess > 14 ? clamp((excess - 14) / 8, 0, 1) * 1.1 * Pn : 0;
    const Qsteam = st.Qturb + st.Qdump + st.Qrelief;
    st.Ts += (st.Qsg - Qsteam) / st.Cs * dt;
    // --- feedwater ---
    st.afwOn = st.afwAuto && st.level < 0.28 && aux;
    const mainFeed = st.feedOn && offsite ? clamp(Qsteam / Pn + (0.5 - st.level) * 0.6, 0, 1.4) : 0;
    const afw = st.afwOn ? 0.07 : 0;
    st.feed = mainFeed + afw;
    const boil = st.Qsg / Pn;
    st.level = clamp(st.level + (st.feed - boil - st.Qrelief / Pn * 0.3) * dt / 240, 0, 1);
    // --- condenser & tower ---
    const Qrej = st.Qturb * (1 - st.etaNow) + st.Qdump;
    const twb = st.ambient - 3;
    const circ = st.circOn && offsite ? 1 : 0.04;
    st.Qct = Math.max(0, st.UAct * (st.Tcond - twb) * circ * (0.7 + 0.6 * st.fans));
    st.Tcond += (Qrej - st.Qct) / st.Ccond * dt;
    st.Tcond = Math.max(st.Tcond, twb);
    // --- house load (MW) ---
    st.house = (st.pumpOn && offsite ? c.pump * Pn * Math.pow(st.flow, 3) : 0) + (st.feedOn && offsite ? 0.006 * Pn * mainFeed : 0) + (st.circOn && offsite ? 0.004 * Pn : 0) + 0.003 * Pn * st.fans + (Qrhr > 0 ? 0.002 * Pn : 0) + 0.004 * Pn;
    st.tAcc += dt;
  }
  function trip(st, why) { if (st.tripped) return; st.tripped = true; note(st, 'TURBINE TRIP — ' + why, 'crit'); }
  function resetTurbine(st) {
    if (!st.tripped) return 'Turbine already running';
    if (st.Tcond > 55) return 'Cannot reset: condenser vacuum too low';
    st.tripped = false; st.breaker = false; st.valve = 0; note(st, 'Turbine reset — rolling up to 3000 rpm', 'info'); return null;
  }

  // ---------- renderer ----------
  const VW = 1600, VH = 760, GY = 640;
  function tcol(T, a = 1) { // temperature → colour
    const s = [[0, [40, 80, 160]], [60, [60, 140, 230]], [200, [120, 170, 220]], [300, [255, 170, 80]], [550, [255, 110, 60]], [800, [255, 230, 170]]];
    let i = 0; while (i < s.length - 2 && T > s[i + 1][0]) i++;
    const [t0, c0] = s[i], [t1, c1] = s[i + 1], f = clamp((T - t0) / (t1 - t0), 0, 1);
    return `rgba(${c0.map((v, j) => Math.round(v + (c1[j] - v) * f)).join(',')},${a})`;
  }

  function layout(st) {
    const c = st.c, L = { hits: [] };
    const loop = c.loop;
    L.loop = loop;
    L.rb = st.kind === 'fusion' ? { x: 30, y: 150, w: 520, h: GY - 150, dome: false } : { x: 40, y: 250, w: 480, h: GY - 250, dome: true };
    L.reactor = st.kind === 'fusion' ? { x: 60, y: 250, w: 270, h: 330 } : { x: 100, y: 330, w: 130, h: 280 };
    L.sg = loop === 'bwr' ? null : st.kind === 'fusion' ? { x: 410, y: 300, w: 70, h: 260 } : { x: 370, y: 300, w: 70, h: 260 };
    L.pzr = loop === 'pwr' && st.kind !== 'fusion' ? { x: 270, y: 330, w: 38, h: 110 } : null;
    L.pump = st.kind === 'fusion' ? { x: 370, y: 600, r: 17 } : { x: 300, y: 600, r: 17 };
    L.aux = { x: 560, y: 425, w: 140, h: GY - 425 };
    L.th = { x: 730, y: 300, w: 450, h: GY - 300 };
    L.hp = { x: 770, y: 365, w: 70, h: 70 };
    L.lp1 = { x: 860, y: 345, w: 95, h: 110 };
    L.lp2 = { x: 970, y: 345, w: 95, h: 110 };
    L.gen = { x: 1085, y: 370, w: 80, h: 60 };
    L.cond = { x: 870, y: 495, w: 195, h: 70 };
    L.fwp = { x: 800, y: 600, r: 15 };
    L.ct = { x: 1250, y: 330, w: 210 };
    L.circ = { x: 1195, y: 610, r: 14 };
    L.xf = { x: 1196, y: 520, w: 34, h: 40 };
    L.pyl = { x: 1525, y: 380 };
    return L;
  }

  function draw(ctx, W, H, st, opts) {
    opts = opts || {};
    const t = performance.now() / 1000;
    const Y0 = 95, Y1 = 735; // visible band of the virtual canvas
    const s = Math.max(0.2, Math.min(W / VW, H / (Y1 - Y0))), ox = (W - VW * s) / 2, oy = (H - (Y1 - Y0) * s) / 2 - Y0 * s;
    st._v = { s, ox, oy };
    const L = st._L = layout(st);
    ctx.save(); ctx.clearRect(0, 0, W, H);
    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0b1018'); sky.addColorStop(1, '#121821');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    ctx.translate(ox, oy); ctx.scale(s, s);
    const c = st.c;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    // stars
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    for (let i = 0; i < 40; i++) { const x = (i * 397) % VW, y = (i * 211) % 260; ctx.fillRect(x, y, 1.2, 1.2); }
    // ground
    ctx.fillStyle = '#0f1419'; ctx.fillRect(-2000, GY, VW + 4000, 400);
    ctx.strokeStyle = '#2a333c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-2000, GY); ctx.lineTo(VW + 2000, GY); ctx.stroke();

    const hit = (id, x, y, w, h, label) => L.hits.push({ id, x, y, w, h, label });
    const hover = st._hover;
    const hl = (id, x, y, w, h, r = 8) => { if (hover === id) { ctx.save(); ctx.strokeStyle = 'rgba(124,200,255,0.9)'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.roundRect(x - 6, y - 6, w + 12, h + 12, r); ctx.stroke(); ctx.restore(); } };
    const label = (txt, x, y, al = 'center', col = '#8b97a3', size = 13, bold = false) => { ctx.font = `${bold ? '600 ' : ''}${size}px Inter, system-ui, sans-serif`; ctx.textAlign = al; ctx.textBaseline = 'middle'; ctx.lineWidth = 4; ctx.strokeStyle = '#0b0d10'; ctx.strokeText(txt, x, y); ctx.fillStyle = col; ctx.fillText(txt, x, y); };
    const val = (txt, x, y, al = 'center', col = '#e8ecef') => { ctx.font = '500 13px "JetBrains Mono", ui-monospace, monospace'; ctx.textAlign = al; ctx.textBaseline = 'middle'; ctx.lineWidth = 4; ctx.strokeStyle = '#0b0d10'; ctx.strokeText(txt, x, y); ctx.fillStyle = col; ctx.fillText(txt, x, y); };

    // pipe with flow particles
    const pipe = (pts, T, speed, w = 9, under = false, colr) => {
      ctx.save();
      if (under) ctx.setLineDash([6, 6]);
      ctx.lineWidth = w + 4; ctx.strokeStyle = '#06080b'; ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
      ctx.lineWidth = w; ctx.strokeStyle = colr || tcol(T, under ? 0.45 : 0.85); ctx.stroke();
      ctx.restore();
      if (speed > 0.002) {
        let len = 0; const seg = []; for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); len += d; }
        const gap = 26, off = (t * 60 * clamp(speed, 0, 1.6)) % gap;
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        for (let d = off; d < len; d += gap) {
          let acc = 0, i = 0; while (i < seg.length && acc + seg[i] < d) { acc += seg[i]; i++; }
          if (i >= seg.length) break;
          const f = (d - acc) / seg[i], x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, y = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f;
          ctx.beginPath(); ctx.arc(x, y, w * 0.22, 0, 7); ctx.fill();
        }
      }
    };
    const capsule = (b, fill, stroke) => { ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, Math.min(b.w / 2, 40)); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke || '#3a4550'; ctx.lineWidth = 2; ctx.stroke(); };

    // ---- buildings (back) ----
    const rb = L.rb;
    ctx.fillStyle = '#141a21'; ctx.strokeStyle = '#2e3740'; ctx.lineWidth = 2;
    if (rb.dome) {
      ctx.beginPath(); ctx.moveTo(rb.x, GY); ctx.lineTo(rb.x, rb.y); ctx.arc(rb.x + rb.w / 2, rb.y, rb.w / 2, Math.PI, 0); ctx.lineTo(rb.x + rb.w, GY); ctx.closePath();
      if (opts.breached) { ctx.fillStyle = '#1d1414'; }
      ctx.fill(); ctx.stroke();
      label(opts.buildingName || 'Containment', rb.x + rb.w / 2, rb.y - rb.w / 2 + 70, 'center', '#5d6873', 13, true);
    } else {
      ctx.beginPath(); ctx.rect(rb.x, rb.y, rb.w, rb.h); ctx.fill(); ctx.stroke();
      // crane rail
      ctx.strokeStyle = '#2e3740'; ctx.beginPath(); ctx.moveTo(rb.x + 10, rb.y + 40); ctx.lineTo(rb.x + rb.w - 10, rb.y + 40); ctx.stroke();
      ctx.fillStyle = '#232a32'; ctx.fillRect(rb.x + 150, rb.y + 34, 80, 14);
      label(opts.buildingName || 'Tokamak building', rb.x + rb.w / 2, rb.y + 20, 'center', '#5d6873', 13, true);
    }
    // aux building
    const ax = L.aux;
    ctx.fillStyle = '#131920'; ctx.strokeStyle = '#2a333c'; ctx.beginPath(); ctx.rect(ax.x, ax.y, ax.w, ax.h); ctx.fill(); ctx.stroke();
    label(opts.auxName || 'Auxiliary', ax.x + ax.w / 2, ax.y + 16, 'center', '#5d6873', 12, true);
    (opts.cards || []).slice(0, 5).forEach((cd, i) => {
      const y = ax.y + 30 + i * 38, x = ax.x + 8, w = ax.w - 16;
      ctx.fillStyle = cd.on ? 'rgba(124,200,255,0.10)' : '#161b21'; ctx.strokeStyle = cd.bad ? '#ff4d4d' : cd.on ? 'rgba(124,200,255,0.6)' : '#2e3740';
      ctx.beginPath(); ctx.roundRect(x, y, w, 34, 6); ctx.fill(); ctx.stroke();
      ctx.font = '600 11.5px Inter, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#e8ecef'; ctx.fillText(cd.label, x + 7, y + 11);
      ctx.font = '11.5px "JetBrains Mono", monospace'; ctx.fillStyle = cd.bad ? '#ff8a8a' : '#8b97a3'; ctx.fillText(cd.value, x + 7, y + 25);
      if (cd.id) { hit(cd.id, x, y, w, 34, cd.label); hl(cd.id, x, y, w, 34, 6); }
    });
    // turbine hall
    const th = L.th;
    ctx.fillStyle = '#131920'; ctx.strokeStyle = '#2a333c'; ctx.beginPath(); ctx.moveTo(th.x, GY); ctx.lineTo(th.x, th.y + 20); ctx.lineTo(th.x + th.w / 2, th.y - 10); ctx.lineTo(th.x + th.w, th.y + 20); ctx.lineTo(th.x + th.w, GY); ctx.closePath(); ctx.fill(); ctx.stroke();
    label('Turbine hall', th.x + 14, th.y + 36, 'left', '#5d6873', 12, true);

    // ---- cooling tower ----
    const ct = L.ct, cx = ct.x + ct.w / 2;
    const towerPath = () => { ctx.beginPath(); ctx.moveTo(ct.x, GY); ctx.bezierCurveTo(ct.x + 40, GY - 120, ct.x + 45, 470, ct.x + 28, ct.y); ctx.lineTo(ct.x + ct.w - 28, ct.y); ctx.bezierCurveTo(ct.x + ct.w - 45, 470, ct.x + ct.w - 40, GY - 120, ct.x + ct.w, GY); ctx.closePath(); };
    // electrical lines behind tower
    const py = L.pyl;
    ctx.strokeStyle = '#3a4550'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(py.x, GY); ctx.lineTo(py.x - 18, GY); ctx.lineTo(py.x, py.y); ctx.lineTo(py.x + 18, GY); ctx.moveTo(py.x - 30, py.y + 30); ctx.lineTo(py.x + 30, py.y + 30); ctx.moveTo(py.x - 22, py.y + 70); ctx.lineTo(py.x + 22, py.y + 70); ctx.stroke();
    const live = st.Pe > 1 && st.breaker;
    ctx.strokeStyle = live ? 'rgba(255,200,87,0.85)' : 'rgba(139,151,163,0.4)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(L.xf.x + 17, L.xf.y); ctx.quadraticCurveTo(1380, 300, py.x - 30, py.y + 30); ctx.moveTo(py.x + 30, py.y + 30); ctx.quadraticCurveTo(1570, 440, 1640, py.y + 20); ctx.stroke();
    if (live) { const f = (t * 0.7) % 1; ctx.fillStyle = '#ffc857'; ctx.beginPath(); ctx.arc(py.x + 30 + (1640 - py.x - 30) * f, py.y + 30 + 20 * Math.sin(f * Math.PI) - 10 * f, 3, 0, 7); ctx.fill(); }
    label(st.gridOk ? 'Grid' : 'Grid LOST', 1590, py.y - 10, 'right', st.gridOk ? '#8b97a3' : '#ff4d4d', 13, true);
    hit('grid', py.x - 40, py.y - 30, 110, 120, 'Grid connection'); hl('grid', py.x - 40, py.y - 30, 110, 120);

    towerPath(); const tg = ctx.createLinearGradient(ct.x, 0, ct.x + ct.w, 0); tg.addColorStop(0, '#1b222a'); tg.addColorStop(0.5, '#28313b'); tg.addColorStop(1, '#161c22');
    ctx.fillStyle = tg; ctx.fill(); ctx.strokeStyle = '#3a4550'; ctx.lineWidth = 2; ctx.stroke();
    // fans at base
    for (let i = 0; i < 3; i++) {
      const fx = ct.x + 55 + i * 50, fy = GY - 22;
      ctx.strokeStyle = '#46525e'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(fx, fy, 12, 0, 7); ctx.stroke();
      const a = t * 12 * st.fans + i;
      ctx.strokeStyle = st.fans > 0 ? '#7cc8ff' : '#46525e';
      ctx.beginPath(); for (let k = 0; k < 3; k++) { const aa = a + k * 2.094; ctx.moveTo(fx, fy); ctx.lineTo(fx + 10 * Math.cos(aa), fy + 10 * Math.sin(aa)); } ctx.stroke();
    }
    hit('fans', ct.x + 35, GY - 44, 140, 44, 'Cooling tower fans'); hl('fans', ct.x + 35, GY - 44, 140, 44);
    hit('tower', ct.x + 20, ct.y, ct.w - 40, GY - ct.y - 50, 'Cooling tower');
    label('Cooling tower', cx, ct.y + 40, 'center', '#8b97a3', 13, true);
    val(`${st.Qct.toFixed(0)} MW`, cx, ct.y + 60);
    val(`basin ${(st.Tcond - 8).toFixed(0)} °C`, cx, ct.y + 78, 'center', '#8b97a3');
    // plume
    const pl = clamp(st.Qct / (st.Pn * (1 - c.eta)), 0, 1.5);
    st._pl = st._pl || [];
    if (Math.random() < pl * 0.5) st._pl.push({ x: cx + (Math.random() - 0.5) * 90, y: ct.y + 4, r: 12 + Math.random() * 10, a: 0.10 + 0.05 * pl, v: 18 + 22 * pl });
    const wind = 10 + (opts.wind || 0);
    st._pl = st._pl.filter(p => { p.y -= p.v * 0.016; p.x += wind * 0.016; p.r += 0.22; p.a -= 0.0011; if (p.a <= 0 || p.y < -60) return false; ctx.fillStyle = `rgba(210,220,230,${p.a})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill(); return true; });

    // ---- primary side ----
    const R = L.reactor, sg = L.sg;
    const Th = st.Thot, Tc = st.Tcold;
    const fl = st.flowEff;
    const steamT = st.Ts + c.steam - c.Ts;
    // primary pipes
    if (L.loop !== 'bwr') {
      const hot = [[R.x + R.w, R.y + R.h * 0.42], [sg.x - 20, R.y + R.h * 0.42], [sg.x - 20, sg.y + sg.h - 20], [sg.x + 12, sg.y + sg.h - 20]];
      const cold = [[sg.x + sg.w - 12, sg.y + sg.h - 20], [sg.x + sg.w + 14, sg.y + sg.h - 20], [sg.x + sg.w + 14, L.pump.y], [L.pump.x, L.pump.y], [R.x + R.w * 0.5, L.pump.y], [R.x + R.w * 0.5, R.y + R.h]];
      pipe(hot, Th, fl, 11, false); pipe(cold, Tc, fl, 11, false);
      if (L.pzr) { const p = L.pzr; pipe([[p.x + p.w / 2, p.y + p.h], [p.x + p.w / 2, R.y + R.h * 0.42]], Th, 0, 5); capsule(p, '#1a2129'); const lv = clamp(0.55 + (st.Thot - c.Tout) / 60, 0.05, 0.98); ctx.fillStyle = tcol(Th, 0.5); ctx.fillRect(p.x + 4, p.y + p.h * (1 - lv), p.w - 8, p.h * lv - 6); label('Pressuriser', p.x + p.w / 2, p.y - 14, 'center', '#8b97a3', 12); val(`${press(st).toFixed(0)} bar`, p.x + p.w / 2, p.y - 30, 'center', press(st) < c.P * 0.8 ? '#ff4d4d' : '#e8ecef'); }
      // steam generator / IHX
      capsule(sg, '#18202a');
      ctx.save(); ctx.beginPath(); ctx.roundRect(sg.x + 4, sg.y + 4, sg.w - 8, sg.h - 8, 30); ctx.clip();
      const lvY = sg.y + sg.h * (1 - 0.15 - 0.7 * st.level);
      ctx.fillStyle = tcol(steamT, 0.25); ctx.fillRect(sg.x, lvY, sg.w, sg.y + sg.h - lvY);
      // U-tubes
      ctx.strokeStyle = tcol((Th + Tc) / 2, 0.8); ctx.lineWidth = 2;
      for (let k = 0; k < 4; k++) { const ww = 8 + k * 6; ctx.beginPath(); ctx.moveTo(sg.x + sg.w / 2 - ww, sg.y + sg.h - 24); ctx.lineTo(sg.x + sg.w / 2 - ww, sg.y + 70 + k * 8); ctx.arc(sg.x + sg.w / 2, sg.y + 70 + k * 8, ww, Math.PI, 0); ctx.lineTo(sg.x + sg.w / 2 + ww, sg.y + sg.h - 24); ctx.stroke(); }
      if (st.Qsg > 0.02 * st.Pn) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; for (let k = 0; k < 10; k++) { const bx = sg.x + 10 + ((k * 37) % (sg.w - 20)), by = lvY + ((t * 60 * (0.5 + st.Qsg / st.Pn) + k * 23) % (sg.y + sg.h - lvY - 20)); ctx.beginPath(); ctx.arc(bx, sg.y + sg.h - 20 - (by - lvY), 2, 0, 7); ctx.fill(); } }
      ctx.restore();
      ctx.strokeStyle = '#3a4550'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(sg.x, sg.y, sg.w, sg.h, 35); ctx.stroke();
      const sgName = L.loop === 'metal' ? (st.kind === 'fusion' ? 'Heat exchanger' : 'IHX → SG') : L.loop === 'gas' ? 'Steam generator' : 'Steam generator';
      label(sgName, sg.x + sg.w + 8, sg.y + 40, 'left', '#8b97a3', 12);
      val(`${st.Qsg.toFixed(0)} MW`, sg.x + sg.w + 8, sg.y + 58, 'left');
      val(`lvl ${(st.level * 100).toFixed(0)}%`, sg.x + sg.w / 2, sg.y + sg.h + 14, 'center', st.level < 0.25 ? '#ff4d4d' : '#8b97a3');
      hit('sg', sg.x, sg.y, sg.w, sg.h, sgName);
    }
    // reactor (page-provided)
    if (opts.reactor) opts.reactor(ctx, R.x, R.y, R.w, R.h, t);
    else { capsule(R, '#1a2129'); }
    hit('reactor', R.x, R.y, R.w, R.h, opts.reactorName || 'Reactor'); hl('reactor', R.x, R.y, R.w, R.h, 20);
    // temps by reactor
    val(`${Th.toFixed(0)} °C`, R.x + R.w + 8, R.y + R.h * 0.42 - 16, 'left', tcol(Th));
    val(`${Tc.toFixed(0)} °C`, L.pump.x + 26, L.pump.y - 16, 'left', tcol(Tc));
    if (st.x > 0.005 && L.loop !== 'bwr') label(`boiling · void ${(st.void * 100).toFixed(0)}%`, R.x + R.w / 2, R.y - 18, 'center', '#ffb340', 12, true);
    // pump
    const pmp = L.pump;
    ctx.beginPath(); ctx.arc(pmp.x, pmp.y, pmp.r, 0, 7); ctx.fillStyle = '#1d242c'; ctx.fill(); ctx.strokeStyle = st.pumpOn && st.gridOk ? '#58d68d' : '#ff4d4d'; ctx.lineWidth = 2.5; ctx.stroke();
    const pa = t * 14 * st.flow; ctx.strokeStyle = '#8b97a3'; ctx.lineWidth = 2; ctx.beginPath(); for (let k = 0; k < 4; k++) { const aa = pa + k * 1.571; ctx.moveTo(pmp.x, pmp.y); ctx.lineTo(pmp.x + 12 * Math.cos(aa), pmp.y + 12 * Math.sin(aa)); } ctx.stroke();
    label(c.loop === 'gas' ? 'Gas circulator' : 'Primary pump', pmp.x, pmp.y + 30, 'center', '#8b97a3', 12);
    val(`${(st.flowEff * 100).toFixed(0)}%`, pmp.x, pmp.y + 46, 'center', st.flowEff < 0.3 ? '#ffb340' : '#e8ecef');
    hit('pump', pmp.x - 24, pmp.y - 24, 48, 48, c.loop === 'gas' ? 'Gas circulators' : 'Primary pumps'); hl('pump', pmp.x - 24, pmp.y - 24, 48, 48, 24);

    // ---- steam line & feedwater ----
    const steamSrc = L.loop === 'bwr' ? [R.x + R.w / 2, R.y] : [sg.x + sg.w / 2, sg.y];
    const steamFlow = (st.Qturb + st.Qdump) / st.Pn;
    pipe([steamSrc, [steamSrc[0], 215], [L.hp.x - 30, 215], [L.hp.x - 30, L.hp.y + L.hp.h / 2], [L.hp.x, L.hp.y + L.hp.h / 2]], steamT, steamFlow, 10, false, `rgba(235,240,245,${0.35 + 0.4 * clamp(steamFlow, 0, 1)})`);
    label(`steam ${steamT.toFixed(0)} °C`, 600, 200, 'center', '#c9d3dd', 12);
    // relief valve plume
    if (st.Qrelief > 1) { for (let k = 0; k < 6; k++) { const f = ((t * 1.5 + k / 6) % 1); ctx.fillStyle = `rgba(230,235,240,${0.4 * (1 - f)})`; ctx.beginPath(); ctx.arc(steamSrc[0] + 40 + 10 * k % 30, 200 - f * 120, 8 + f * 26, 0, 7); ctx.fill(); } label('relief valves venting', steamSrc[0] + 60, 120, 'left', '#ffb340', 12, true); }
    // steam dump to condenser
    if (st.Qdump > 1) { pipe([[L.hp.x - 30, 260], [L.hp.x - 30, 300], [L.cond.x - 10, 300], [L.cond.x - 10, L.cond.y + 20], [L.cond.x, L.cond.y + 20]], steamT, st.Qdump / st.Pn * 2, 6, false, 'rgba(235,240,245,0.6)'); label('steam dump', L.hp.x - 26, 285, 'left', '#ffc857', 11.5); }
    // feedwater line: condenser hotwell → FW pump → SG / vessel
    const fwDest = L.loop === 'bwr' ? [R.x + R.w, R.y + R.h * 0.62] : [sg.x + sg.w, sg.y + sg.h * 0.6];
    const fwT = Math.max(st.Tcond + 150 * clamp(st.feed, 0, 1), st.Tcond);
    const fwx = L.loop === 'bwr' ? R.x + R.w + 40 : sg.x + sg.w + 20;
    pipe([[L.cond.x + 20, L.cond.y + L.cond.h], [L.cond.x + 20, L.fwp.y], [L.fwp.x, L.fwp.y], [712, L.fwp.y], [712, 405], [fwx, 405], [fwx, fwDest[1]], fwDest], fwT, st.feed, 7);
    ctx.beginPath(); ctx.arc(L.fwp.x, L.fwp.y, L.fwp.r, 0, 7); ctx.fillStyle = '#1d242c'; ctx.fill(); ctx.strokeStyle = st.feedOn && st.gridOk ? '#58d68d' : (st.afwOn ? '#ffc857' : '#ff4d4d'); ctx.lineWidth = 2.5; ctx.stroke();
    label(st.afwOn ? 'Aux feed (AFW)' : 'Feedwater pump', L.fwp.x, L.fwp.y + 28, 'center', st.afwOn ? '#ffc857' : '#8b97a3', 12);
    hit('feed', L.fwp.x - 22, L.fwp.y - 22, 44, 44, 'Feedwater pumps'); hl('feed', L.fwp.x - 22, L.fwp.y - 22, 44, 44, 22);

    // ---- turbines ----
    const rpmA = (st._rpmA = (st._rpmA || 0) + st.rpm * 0.6);
    const turb = (b, inlet) => {
      ctx.beginPath(); ctx.moveTo(b.x, b.y + b.h * 0.25); ctx.lineTo(b.x + b.w, b.y); ctx.lineTo(b.x + b.w, b.y + b.h); ctx.lineTo(b.x, b.y + b.h * 0.75); ctx.closePath();
      ctx.fillStyle = st.tripped ? '#2a1a1a' : '#1f2730'; ctx.fill(); ctx.strokeStyle = st.tripped ? '#ff4d4d' : '#4a5663'; ctx.lineWidth = 2; ctx.stroke();
      ctx.save(); ctx.clip(); ctx.strokeStyle = 'rgba(200,215,230,0.35)'; ctx.lineWidth = 2;
      for (let k = 0; k < 7; k++) { const xx = b.x + 6 + ((k * b.w / 7 + rpmA * 3) % b.w); ctx.beginPath(); ctx.moveTo(xx, b.y); ctx.lineTo(xx - 6, b.y + b.h); ctx.stroke(); }
      ctx.restore();
    };
    // shaft
    ctx.strokeStyle = '#5d6873'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(L.hp.x, 400); ctx.lineTo(L.gen.x, 400); ctx.stroke();
    turb(L.hp); turb(L.lp1); turb(L.lp2);
    // crossover
    pipe([[L.hp.x + L.hp.w, L.hp.y + 10], [L.hp.x + L.hp.w + 10, 330], [L.lp2.x + L.lp2.w / 2, 330], [L.lp2.x + L.lp2.w / 2, L.lp2.y]], (steamT + st.Tcond) / 2, steamFlow * 0.8, 7, false, `rgba(220,228,236,${0.25 + 0.35 * clamp(steamFlow, 0, 1)})`);
    label('HP', L.hp.x + L.hp.w / 2, L.hp.y + L.hp.h + 14, 'center', '#8b97a3', 12); label('LP turbines', (L.lp1.x + L.lp2.x + L.lp2.w) / 2, L.lp1.y + L.lp1.h + 14, 'center', '#8b97a3', 12);
    val(`${(st.rpm * 3000).toFixed(0)} rpm`, (L.hp.x + L.lp2.x + L.lp2.w) / 2, L.lp1.y - 50, 'center', st.rpm > 1.05 ? '#ff4d4d' : '#e8ecef');
    if (st.tripped) label('TRIPPED — click to reset', (L.hp.x + L.lp2.x + L.lp2.w) / 2, L.lp1.y - 32, 'center', '#ff4d4d', 12.5, true);
    else val(`valve ${(st.valve * 100).toFixed(0)}%`, (L.hp.x + L.lp2.x + L.lp2.w) / 2, L.lp1.y - 32, 'center', '#8b97a3');
    hit('turbine', L.hp.x, L.lp1.y, L.lp2.x + L.lp2.w - L.hp.x, L.lp1.h, 'Turbine'); hl('turbine', L.hp.x, L.lp1.y, L.lp2.x + L.lp2.w - L.hp.x, L.lp1.h);
    // generator
    const g = L.gen;
    ctx.beginPath(); ctx.roundRect(g.x, g.y, g.w, g.h, 10); ctx.fillStyle = '#1f2730'; ctx.fill(); ctx.strokeStyle = st.Pe > 1 ? '#ffc857' : '#4a5663'; ctx.lineWidth = 2; ctx.stroke();
    if (st.Pe > 1) { ctx.save(); ctx.shadowColor = '#ffc857'; ctx.shadowBlur = 12 * clamp(st.Pe / st.Pe_nom, 0, 1); ctx.strokeStyle = 'rgba(255,200,87,0.6)'; ctx.stroke(); ctx.restore(); }
    label('Generator', g.x + g.w / 2, g.y - 14, 'center', '#8b97a3', 12);
    val(`${st.Pe.toFixed(0)} MWe`, g.x + g.w / 2, g.y + g.h / 2, 'center', st.Pe > 1 ? '#ffc857' : '#8b97a3');
    val(st.breaker ? 'on grid' : 'breaker open', g.x + g.w / 2, g.y + g.h + 14, 'center', st.breaker ? '#58d68d' : '#8b97a3');
    hit('breaker', g.x, g.y, g.w, g.h, 'Generator breaker'); hl('breaker', g.x, g.y, g.w, g.h);
    // transformer
    const xf = L.xf;
    ctx.strokeStyle = '#4a5663'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(g.x + g.w, 400); ctx.lineTo(xf.x + xf.w / 2, 400); ctx.lineTo(xf.x + xf.w / 2, xf.y); ctx.stroke();
    ctx.fillStyle = '#1f2730'; ctx.fillRect(xf.x, xf.y, xf.w, xf.h); ctx.strokeStyle = live ? '#ffc857' : '#4a5663'; ctx.strokeRect(xf.x, xf.y, xf.w, xf.h);
    // condenser
    const cd = L.cond;
    ctx.fillStyle = '#18202a'; ctx.strokeStyle = st.Tcond > 55 ? '#ff4d4d' : '#4a5663'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(cd.x, cd.y, cd.w, cd.h, 8); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(90,169,255,0.5)'; ctx.lineWidth = 1.5; for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.moveTo(cd.x + 10, cd.y + 12 + k * 11); ctx.lineTo(cd.x + cd.w - 10, cd.y + 12 + k * 11); ctx.stroke(); }
    ctx.strokeStyle = '#4a5663'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(L.lp1.x + L.lp1.w / 2, L.lp1.y + L.lp1.h); ctx.lineTo(L.lp1.x + L.lp1.w / 2, cd.y); ctx.moveTo(L.lp2.x + L.lp2.w / 2, L.lp2.y + L.lp2.h); ctx.lineTo(L.lp2.x + L.lp2.w / 2, cd.y); ctx.stroke();
    label('Condenser', cd.x + cd.w / 2, cd.y + cd.h + 14, 'center', '#8b97a3', 12);
    val(`${st.Tcond.toFixed(0)} °C`, cd.x + cd.w / 2, cd.y + cd.h + 30, 'center', st.Tcond > 50 ? '#ff4d4d' : '#e8ecef');
    hit('cond', cd.x, cd.y, cd.w, cd.h, 'Condenser');
    // circulating water (underground)
    const cw = st.circOn && st.gridOk ? 1 : 0.04;
    pipe([[cd.x + cd.w, cd.y + 25], [1120, cd.y + 25], [1120, 668], [ct.x + 60, 668], [ct.x + 60, GY - 4]], st.Tcond - 2, cw, 8, true);
    pipe([[ct.x + 150, GY - 4], [ct.x + 150, 690], [1100, 690], [1100, cd.y + 50], [cd.x + cd.w, cd.y + 50]], st.Tcond - 10, cw, 8, true);
    const cp = L.circ;
    ctx.beginPath(); ctx.arc(cp.x, cp.y + 70, cp.r, 0, 7); ctx.fillStyle = '#1d242c'; ctx.fill(); ctx.strokeStyle = st.circOn && st.gridOk ? '#58d68d' : '#ff4d4d'; ctx.lineWidth = 2.5; ctx.stroke();
    label('Circ. water pumps', cp.x, cp.y + 100, 'center', '#8b97a3', 12);
    hit('circ', cp.x - 22, cp.y + 48, 44, 44, 'Circulating water pumps'); hl('circ', cp.x - 22, cp.y + 48, 44, 44, 22);

    // ---- overlays ----
    if (opts.overlay) opts.overlay(ctx, L, t);
    // power summary strip
    const pth = st.Qcore, eff = st.Pe / Math.max(pth, 1);
    label('Thermal → electric', 1570, 118, 'right', '#8b97a3', 13, true);
    val(`${pth.toFixed(0)} MWth → ${st.Pe.toFixed(0)} MWe  ·  η ${(eff * 100).toFixed(1)}%  ·  house load ${st.house.toFixed(0)} MW  ·  ambient ${st.ambient.toFixed(0)} °C`, 1570, 138, 'right');
    ctx.restore();
  }

  function hitTest(st, px, py) {
    if (!st._v || !st._L) return null;
    const { s, ox, oy } = st._v, x = (px - ox) / s, y = (py - oy) / s;
    const h = st._L.hits.slice().reverse().find(h => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h);
    return h || null;
  }

  // built-in click actions; returns message for log, or null if unhandled
  function act(st, id) {
    switch (id) {
      case 'pump': st.pumpOn = !st.pumpOn; return [st.pumpOn ? 'Primary pumps started' : 'Primary pumps stopped — coasting down', st.pumpOn ? 'info' : 'warn'];
      case 'feed': st.feedOn = !st.feedOn; return [st.feedOn ? 'Main feedwater pumps started' : 'Main feedwater pumps stopped', st.feedOn ? 'info' : 'warn'];
      case 'circ': st.circOn = !st.circOn; return [st.circOn ? 'Circulating water pumps started' : 'Circulating water pumps stopped — condenser will lose vacuum', st.circOn ? 'info' : 'warn'];
      case 'fans': st.fans = st.fans >= 1 ? 0 : st.fans >= 0.5 ? 1 : 0.5; return [`Cooling tower fans ${Math.round(st.fans * 100)}%`, 'info'];
      case 'turbine': if (st.tripped) { const e = resetTurbine(st); return e ? [e, 'warn'] : null; } trip(st, 'manual'); return null;
      case 'breaker': if (st.breaker) { st.breaker = false; st.breakerWant = false; return ['Generator breaker opened manually', 'warn']; } st.breakerWant = true; return ['Generator breaker armed — will synchronise at 3000 rpm', 'info'];
      case 'grid': st.gridOk = !st.gridOk; if (!st.gridOk) return ['LOSS OF OFFSITE POWER — pumps on normal buses tripped', 'crit']; st.breakerWant = true; return ['Offsite power restored', 'good'];
      default: return undefined;
    }
  }
  function drain(st) { const e = st.events; st.events = []; return e; }

  G.Plant = { press, COOL, create, step, draw, hitTest, act, drain, trip, resetTurbine, tcol, Tsat };
})(typeof window !== 'undefined' ? window : globalThis);
