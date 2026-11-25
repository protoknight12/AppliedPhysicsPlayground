/* Physics Sandbox — fission reactor model.
   Point kinetics (6 delayed groups, implicit), four-factor / two-region spectrum model for k,
   Doppler, moderator-density and void feedback emerging from the same k formula,
   I-135/Xe-135 and Pm-149/Sm-149 poisoning, burnup + conversion, 4-group decay heat,
   lumped fuel / moderator thermal model, reactor protection, damage and accident scenarios.
   Balance of plant comes from shared/plant.js (window.Plant).
   Units: power relative to nominal (n), reactivity Δk/k, temperatures °C, time s, lengths cm. */
(function (G) {
  const Plant = G.Plant;
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const LAM = [0.0124, 0.0305, 0.111, 0.301, 1.14, 3.01];
  const ABU = [0.033, 0.219, 0.196, 0.395, 0.115, 0.042];

  // microscopic data (barns). thermal: nu, sf, sa ; fast: nuF, sfF, scF ; beta
  const NUC = {
    U235: { nu: 2.43, sf: 585, sa: 681, nuF: 2.5, sfF: 1.85, scF: 0.45, beta: 0.0065, nm: 'U-235' },
    Pu239: { nu: 2.88, sf: 748, sa: 1017, nuF: 2.95, sfF: 1.80, scF: 0.55, beta: 0.0021, nm: 'Pu-239' },
    U233: { nu: 2.49, sf: 531, sa: 578, nuF: 2.55, sfF: 2.30, scF: 0.27, beta: 0.0027, nm: 'U-233' },
    U238: { sa: 2.7, RI: 275, sh: 0.0014, nuF: 2.8, sfF: 0.04, scF: 0.36, beta: 0.0157, eps: 0.045, nm: 'U-238' },
    Th232: { sa: 7.4, RI: 85, sh: 0.0022, nuF: 2.4, sfF: 0.012, scF: 0.35, beta: 0.0203, eps: 0.012, nm: 'Th-232' }
  };

  const FUELS = {
    uo2: { name: 'Uranium dioxide (UO₂)', fis: 'U235', fert: 'U238', N: 0.0245, eMin: 0.7, eMax: 93, eLab: 'U-235 enrichment', melt: 2865, dTn: 650, tauF: 5, extra: 0, clad: true },
    umet: { name: 'Uranium metal (Magnox)', fis: 'U235', fert: 'U238', N: 0.048, eMin: 0.7, eMax: 20, eLab: 'U-235 enrichment', melt: 1132, limit: 665, dTn: 110, tauF: 2, extra: 0, clad: true },
    un: { name: 'Uranium nitride (UN)', fis: 'U235', fert: 'U238', N: 0.034, eMin: 0.7, eMax: 93, eLab: 'U-235 enrichment', melt: 2850, dTn: 230, tauF: 3, extra: 0.25, clad: true },
    mox: { name: 'MOX (U–Pu oxide)', fis: 'Pu239', fert: 'U238', N: 0.0245, eMin: 2, eMax: 40, eLab: 'Plutonium fraction', melt: 2750, dTn: 680, tauF: 5, extra: 0, clad: true },
    tho2: { name: 'Thorium–U233 oxide', fis: 'U233', fert: 'Th232', N: 0.0225, eMin: 1, eMax: 20, eLab: 'U-233 fraction', melt: 3300, dTn: 600, tauF: 5, extra: 0, clad: true },
    triso: { name: 'TRISO particles (UCO in graphite)', fis: 'U235', fert: 'U238', N: 0.0016, eMin: 2, eMax: 20, eLab: 'U-235 enrichment', melt: 1800, limit: 1600, dTn: 180, tauF: 40, extra: 0, clad: false, lump: 0.35 },
    salt: { name: 'Liquid fuel salt (UF₄–ThF₄–FLiBe)', fis: 'U233', fert: 'Th232', N: 0.0030, eMin: 1, eMax: 20, eLab: 'U-233 fraction', melt: 1430, dTn: 15, tauF: 2, extra: 0, clad: false, liquid: true }
  };
  // xs = ξΣs (cm^-1), sa = Σa (cm^-1), tau/L2 (cm^2) at reference density, Lam prompt generation time (s)
  const MODS = {
    none: { name: 'None — fast spectrum', xs: 0, sa: 0, tau: 0, L2: 0, Lam: 5e-7, node: 'none' },
    h2o: { name: 'Light water', xs: 1.35, sa: 0.0222, tau: 27, L2: 8.1, Lam: 2.5e-5, node: 'coolant', water: true },
    d2o: { name: 'Heavy water', xs: 0.176, sa: 0.00008, tau: 131, L2: 16000, Lam: 8e-4, node: 'calandria', water: true },
    c: { name: 'Graphite', xs: 0.060, sa: 0.00030, tau: 368, L2: 2650, Lam: 9e-4, node: 'solid', cap: 4, coef: 1.5e-5 },
    be: { name: 'Beryllium', xs: 0.155, sa: 0.00104, tau: 102, L2: 480, Lam: 1.5e-4, node: 'solid', cap: 1.5, n2n: 0.03, coef: 0 },
    zrh: { name: 'Zirconium hydride', xs: 1.6, sa: 0.030, tau: 20, L2: 4, Lam: 3e-5, node: 'fuel', coef: -9e-5 }
  };
  const RODS = {
    b4c: { name: 'Boron carbide (B₄C)', w: 1.0 },
    aic: { name: 'Silver–indium–cadmium', w: 0.82 },
    hf: { name: 'Hafnium', w: 0.88 },
    gd: { name: 'Gadolinium', w: 0.93 }
  };
  const REFL = { none: { name: 'None (bare core)', d: 0 }, water: { name: 'Water', d: 7 }, graphite: { name: 'Graphite', d: 35 }, be: { name: 'Beryllium', d: 25 }, steel: { name: 'Steel', d: 12 }, lead: { name: 'Lead', d: 20 } };
  // coolant ξΣs and Σa (thermal), fast absorption, fast-void spectral coefficient
  const CXS = { h2o: { xs: 1.35 }, d2o: { xs: 0.176 }, gas: { xs: 0.00005 }, metal: { xs: 0.004 }, salt: { xs: 0.03 } };
  const CFAST = { h2o_p: 0.0015, h2o_b: 0.0015, d2o: 0.0004, co2: 0, he: 0, na: 0.00005, pb: 0.0002, pbbi: 0.00035, flibe: 0.0003, pbli: 0.0003 };
  const CVOID = { na: 0.30, pb: 0.10, pbbi: 0.12, flibe: 0.05 };

  const PRESETS = {
    pwr: { nm: 'PWR', full: 'Pressurised water reactor (Westinghouse 4-loop class)', fuel: 'uo2', e: 4.2, mod: 'h2o', vm: 2.0, cool: 'h2o_p', vc: 0, rod: 'aic', R: 170, H: 366, refl: 'water', P: 3400, scram: 2.5, boron: true, rodDir: 'top' },
    bwr: { nm: 'BWR', full: 'Boiling water reactor (ABWR class)', fuel: 'uo2', e: 3.2, bp: 0.04, mod: 'h2o', vm: 2.5, cool: 'h2o_b', vc: 0, rod: 'b4c', R: 255, H: 371, refl: 'water', P: 3900, rodW: 2.4, scram: 3.0, boron: false, rodDir: 'bottom' },
    candu: { nm: 'CANDU', full: 'Pressurised heavy-water reactor (CANDU-6)', fuel: 'uo2', e: 0.71, mod: 'd2o', vm: 23, cool: 'd2o', vc: 0.9, rod: 'b4c', R: 380, H: 594, refl: 'water', P: 2060, rodW: 1.3, scram: 1.5, boron: false, online: true, rodDir: 'top' },
    rbmk: { nm: 'RBMK', full: 'Graphite-moderated boiling water channel reactor (RBMK-1000)', fuel: 'uo2', e: 2.0, mod: 'c', vm: 19, cool: 'h2o_b', vc: 1.1, rod: 'b4c', R: 590, H: 700, refl: 'graphite', P: 3200, rodW: 1.5, scram: 18, boron: false, online: true, tip: true, rodDir: 'top' },
    agr: { nm: 'AGR', full: 'Advanced gas-cooled reactor (CO₂, graphite)', fuel: 'uo2', e: 3.0, mod: 'c', vm: 18, cool: 'co2', vc: 1, rod: 'b4c', R: 470, H: 830, refl: 'graphite', P: 1550, rodW: 1.7, scram: 5, boron: false, online: true, rodDir: 'top' },
    htgr: { nm: 'HTGR', full: 'High-temperature gas reactor (pebble bed, TRISO)', fuel: 'triso', e: 8.5, mod: 'c', vm: 3.8, cool: 'he', vc: 0.6, rod: 'b4c', R: 150, H: 1100, refl: 'graphite', P: 600, rodW: 1.4, scram: 6, boron: false, online: true, rodDir: 'top' },
    sfr: { nm: 'SFR', full: 'Sodium-cooled fast reactor (MOX)', fuel: 'mox', e: 14, mod: 'none', vm: 0, cool: 'na', vc: 1.4, rod: 'b4c', R: 180, H: 100, refl: 'steel', P: 1500, rodW: 1.5, scram: 1.2, boron: false, rodDir: 'top' },
    lfr: { nm: 'LFR', full: 'Lead-cooled fast reactor (nitride)', fuel: 'un', e: 20, mod: 'none', vm: 0, cool: 'pb', vc: 1.8, rod: 'b4c', R: 210, H: 110, refl: 'lead', P: 1000, rodW: 1.9, scram: 1.5, boron: false, rodDir: 'top' },
    msr: { nm: 'MSR', full: 'Molten-salt thorium breeder (graphite, fuel in salt)', fuel: 'salt', e: 3.2, mod: 'c', vm: 8, cool: 'flibe', vc: 0, rod: 'b4c', R: 270, H: 450, refl: 'graphite', P: 1000, rodW: 1.4, scram: 4, boron: false, online: true, rodDir: 'top' },
    triga: { nm: 'TRIGA-like', full: 'Water-cooled hydride-moderated core (TRIGA-style, scaled to power)', fuel: 'uo2', e: 19.75, mod: 'zrh', vm: 1.2, cool: 'h2o_p', vc: 0.6, rod: 'b4c', R: 80, H: 120, refl: 'graphite', P: 250, rodW: 1.9, scram: 1.0, boron: false, rodDir: 'top' }
  };

  // water density (relative, liquid) vs T
  const WTAB = [[20, 1.0], [100, 0.958], [200, 0.865], [250, 0.80], [280, 0.75], [300, 0.715], [320, 0.67], [340, 0.61], [360, 0.53], [380, 0.42]];
  function wden(T) { if (T <= WTAB[0][0]) return 1; for (let i = 1; i < WTAB.length; i++) if (T <= WTAB[i][0]) { const [a, da] = WTAB[i - 1], [b, db] = WTAB[i]; return da + (db - da) * (T - a) / (b - a); } return 0.35; }

  // effective moderator node: light water only acts as 'the coolant' when the coolant is water
  function modNode(d) { const Mo = MODS[d.mod], C = Plant.COOL[d.cool]; if (Mo.node === 'coolant' && C.medium !== 'h2o') return 'calandria'; return Mo.node; }
  // ---------- core physics: k from state ----------
  // inputs: d (design), st {Tf, Tm, Tc, rhoC (coolant density rel), void, boron, xe (cm^-1), sm, fp, e (current fissile frac)}
  function kcalc(d, st) {
    const F = FUELS[d.fuel], Mo = MODS[d.mod], C = Plant.COOL[d.cool];
    const fis = NUC[F.fis], fert = NUC[F.fert];
    const e = clamp(st.e, 1e-4, 0.999), N = F.N;
    const N8 = N * (1 - e), N5 = N * e;
    const node = modNode(d), integ = node === 'coolant'; // moderator is the coolant
    const liquidMod = Mo.water ? (integ ? wden(st.Tc) * (1 - 0.6 * st.void) : (node === 'calandria' ? 1 - (st.Tm - 70) * 0.0006 : 1)) : 1;
    const rhoM = Mo.node === 'none' ? 0 : liquidMod;
    const vm = d.vm, vc = integ ? 0 : d.vc;
    const cmed = C.medium === 'h2o' ? 'h2o' : C.medium === 'd2o' ? 'd2o' : C.medium;
    const rhoC = (C.medium === 'h2o' || C.medium === 'd2o') ? wden(st.Tc) * (1 - (integ ? 0.6 : 1) * st.void) : C.medium === 'gas' ? st.inv * 0.02 : (1 - st.void) * (1 - (st.Tc - C.Tin) * 0.0003);
    // moderating power and absorption per unit fuel volume
    const Smod = Mo.xs * rhoM * vm + CXS[cmed].xs * rhoC * vc * 0.1;
    const waterVol = (d.mod === 'h2o' ? vm * rhoM : 0) + (C.medium === 'h2o' && !integ ? vc * rhoC : 0);
    const Sab_mod = Mo.sa * rhoM * vm + C.absorb * rhoC * vc;
    const Sboron = d.boronOK ? st.boron * 4.27e-5 * waterVol : 0;
    // --- thermal ---
    const Tk = st.Tf + 273;
    const RI = fert.RI * (F.lump || 1) / (1 + N8 / fert.sh) * (1 + 0.012 * (Math.sqrt(Tk) - Math.sqrt(573)));
    const eps = 1 + fert.eps * clamp(N8 / 0.0245, 0, 2) + (Mo.n2n || 0);
    const p = Smod > 1e-6 ? Math.exp(-N8 * RI / Smod) : 0;
    const SaF = N5 * fis.sa + N8 * fert.sa + N * F.extra;
    const Sstruct = (F.clad ? 0.008 : 0.002) + (C.medium === 'metal' ? 0.004 : 0);
    const Spois = st.xe + st.sm + st.fp + (d.bp || 0);
    const SaFuel = N5 * fis.sa + N8 * fert.sa + N * F.extra + Spois;
    const f = SaFuel / (SaFuel + Sab_mod + Sstruct + Sboron);
    const harden = 1 / (1 + 0.25 * SaFuel / Math.max(Smod, 0.05)); // thermal-spectrum hardening
    const eta = fis.nu * N5 * fis.sf / SaFuel * harden;
    // leakage
    const Rx = d.R + REFL[d.refl].d, Hx = d.H + 2 * REFL[d.refl].d;
    const B2 = (2.405 / Rx) ** 2 + (Math.PI / Hx) ** 2;
    const rr = Math.max(rhoM, 0.05);
    const M2th = Mo.node === 'none' ? 50 : (Mo.tau + Mo.L2 * (1 - f)) / (rr * rr) * (integ ? 1 : 1 + 0.0 * vc);
    const kth = eta * eps * p * f;
    const PNLth = 1 / (1 + B2 * M2th);
    // --- fast ---
    const hard = 1 + (CVOID[d.cool] || 0) * (1 - rhoC) * vc / (vc + 1);
    const num = e * fis.nuF * fis.sfF + (1 - e) * fert.nuF * fert.sfF * hard;
    const capFast = (CFAST[d.cool] || 0) * rhoC * vc + 0.0008 + Spois * 0.004 + Sboron * 0.01;
    const den = e * (fis.sfF + fis.scF) + (1 - e) * (fert.sfF + fert.scF / Math.sqrt(hard)) + capFast / N + F.extra * 0.01 + Math.max(0, (st.Tf - 300)) * 8e-6 * (1 - e);
    const kfast = num / den;
    const M2f = 140 * (1 + 0.8 * (1 - rhoC) * vc / (vc + 1));
    const PNLf = 1 / (1 + B2 * M2f);
    // spectrum blend by moderating power
    const w = clamp((Smod - 0.02) / 0.25, 0, 1);
    const ws = w * w * (3 - 2 * w);
    let kinf = ws * kth + (1 - ws) * kfast;
    let PNL = ws * PNLth + (1 - ws) * PNLf;
    // explicit moderator temperature coefficients (graphite spectral, hydride)
    let mt = (1 - ws) * -1.5e-5 * (st.Tc - 300); // fast core: radial / grid-plate expansion
    if (Mo.coef) mt += Mo.coef * ((Mo.node === 'fuel' ? st.Tf : st.Tm) - 20);
    const keff = kinf * PNL * (1 + mt);
    // beta
    const fastFisFrac = ws * ((eps - 1) / eps) + (1 - ws) * ((1 - e) * fert.nuF * fert.sfF * hard / num);
    const beta = fis.beta * (1 - fastFisFrac) + fert.beta * fastFisFrac;
    const Lam = ws * Mo.Lam * (1 + 0 * f) + (1 - ws) * 5e-7;
    const CR = ws * (eta * eps * (1 - p) + N8 * fert.sa / (N5 * fis.sa)) + (1 - ws) * ((1 - e) * fert.scF / (e * (fis.sfF + fis.scF)));
    const etaF = num / (e * (fis.sfF + fis.scF) + (1 - e) * (fert.sfF + fert.scF));
    return { keff, kinf, kth, kfast, eta: ws * eta + (1 - ws) * etaF, eps, p, f, PNL, B2, M2: ws * M2th + (1 - ws) * M2f, ws, beta, Lam, CR, rhoM, rhoC, Smod, waterVol };
  }

  // ---------- design ----------
  function design(key, over) {
    const p = Object.assign({}, PRESETS[key], over || {});
    const C = Plant.COOL[p.cool];
    return {
      preset: key, bp: p.bp || 0, rodW: p.rodW || 1, nm: p.nm, full: p.full, fuel: p.fuel, e: p.e / 100, mod: p.mod, vm: p.vm, cool: p.cool, vc: p.vc, rod: p.rod, R: p.R, H: p.H, refl: p.refl,
      P: p.P, scram: p.scram, boronOK: (C.medium === 'h2o' || p.mod === 'h2o') && p.boron !== false, online: !!p.online, tip: !!p.tip, rodDir: p.rodDir || 'top'
    };
  }
  const rodS = x => x - Math.sin(2 * Math.PI * x) / (2 * Math.PI);
  function rodWorth(d) { const k0 = kcalc(d, cold(d)); return RODS[d.rod].w * (0.06 + 0.06 * k0.ws) * (d.rodW || 1) * Math.sqrt(250 / Math.max(80, Math.min(d.R, 600))) ** 0.4; }
  function cold(d) { const C = Plant.COOL[d.cool]; const T = Math.max(20, C.freeze + 40); return { Tf: T, Tm: T, Tc: T, void: 0, inv: 1, boron: 0, xe: 0, sm: 0, fp: 0, e: d.e }; }

  function midCycle(d) {
    const F = FUELS[d.fuel], k0 = kcalc(d, cold(d)), bu = Math.min(45, d.e * 100 * (d.online ? 4 : 7));
    return { e: d.e * (1 - (d.online ? 0.3 : d.boronOK ? 0.75 : 0.55) * (1 - clamp(k0.CR, 0, 1))), fp: 1e-4 * bu * F.N * 50, fpN: 1e-4 * bu * F.N, bu };
  }
  // design figures of merit (for the design lab) — equilibrium (mid-cycle) core
  function evaluate(d) {
    const mc = midCycle(d);
    const C = Plant.COOL[d.cool];
    const hot = { Tf: C.Tin + (C.Tout - C.Tin) / 2 + FUELS[d.fuel].dTn, Tm: modNode(d) === 'solid' ? C.Tout + 60 : modNode(d) === 'calandria' ? 85 : C.Tin + (C.Tout - C.Tin) / 2, Tc: (C.Tin + C.Tout) / 2, void: d.cool === 'h2o_b' ? 0.4 : 0, inv: 1, boron: 0, xe: 0, sm: 0, fp: mc.fp, e: mc.e };
    const coldMC = Object.assign(cold(d), { fp: mc.fp, e: mc.e });
    const k = kcalc(d, hot), kc = kcalc(d, coldMC);
    const rho = kk => 1 - 1 / kk;
    const W = rodWorth(d);
    const dT = 10;
    const dop = (rho(kcalc(d, Object.assign({}, hot, { Tf: hot.Tf + dT })).keff) - rho(k.keff)) / dT * 1e5;
    const mod = (rho(kcalc(d, Object.assign({}, hot, { Tc: hot.Tc + dT, Tm: modNode(d) === 'coolant' ? hot.Tm + dT : hot.Tm })).keff) - rho(k.keff)) / dT * 1e5;
    const modS = modNode(d) === 'solid' ? (rho(kcalc(d, Object.assign({}, hot, { Tm: hot.Tm + dT })).keff) - rho(k.keff)) / dT * 1e5 : null;
    const dv = 0.05;
    const voidC = (C.medium === 'gas') ? 0 : (rho(kcalc(d, Object.assign({}, hot, { void: hot.void + dv })).keff) - rho(k.keff)) / (dv * 100) * 1e5;
    const kcb = d.boronOK ? kcalc(d, Object.assign({}, coldMC, { boron: 2500 })) : kc;
    const sdm = rho(kcb.keff) - W; // >0 means rods (+2000 ppm boron) can't hold the cold core subcritical
    return { k, kc, rhoHot: rho(k.keff), rhoCold: rho(kc.keff), W, dop, mod, modS, voidC, sdm };
  }

  // ---------- state ----------
  function create(key, over) {
    const d = design(key, over);
    const S = {
      d, t: 0, warp: 1, paused: false, n: 1, C: new Array(6).fill(0), rho: 0, rhoParts: {}, k: null,
      rods: 0.3, rodCmd: 0.3, rodSpeed: 0.006, scram: false, scramT: 0, autoRod: true, Pset: 1, link: true, boron: 0, boronCmd: 0,
      Tf: 0, Tm: 0, I: 0, Xe: 0, Pm: 0, Sm: 0, burn: 0, efis: d.e, fpN: 0, dec: [0, 0, 0, 0], E: 0,
      rps: true, eccsAuto: true, eccs: false, rhrAuto: true, dmg: { fuel: 0, clad: 0, vessel: 0, h2: 0, release: 0 }, breach: false, destroyed: false,
      ev: [], evKeys: {}, trip: null, plant: null, rodEject: 0, loca: 0, dieselT: 0, period: Infinity, dlnF: 0, nf: 1, nPrev: 1, peakF: 0, maxN: 1, msg: null
    };
    S.plant = Plant.create({ Pnom: d.P, coolant: d.cool, kind: 'fission' });
    steadyInit(S, 1);
    return S;
  }
  const DECF = [0.030, 0.016, 0.012, 0.006], DECT = [8, 400, 25000, 300000];

  // fuel geometry / power density for Xe/Sm
  function core(S) {
    const d = S.d, F = FUELS[d.fuel], Vcore = Math.PI * d.R * d.R * d.H;
    const ff = 1 / (1 + d.vm + (modNode(d) === 'coolant' ? 0 : d.vc));
    const q = d.P * 1e6 / (Vcore * ff); // W/cm3 of fuel
    const Rf = q / 3.2e-11;               // fissions/cm3/s
    const Sf = F.N * S.efis * NUC[F.fis].sf * (MODS[d.mod].node === 'none' ? 0.0032 : 1);
    const phi = Rf / Math.max(Sf, 1e-6);
    return { q, Rf, phi, ff };
  }
  const GI = 0.0639, GX = 0.00237, LI = 2.87e-5, LX = 2.09e-5, SX = 2.65e-18, GPM = 0.0113, LPM = 3.63e-6, SSM = 4.1e-20;

  function thermoState(S) {
    const P = S.plant, C = P.c, d = S.d, node = modNode(d);
    const Tc = (P.Thot + P.Tcold) / 2;
    const Tm = node === 'coolant' ? Tc : node === 'fuel' ? S.Tf : S.Tm;
    const fast = MODS[d.mod].node === 'none';
    const xs = fast ? 0.1 : 1; // Xe/Sm matter only in thermal spectrum
    return { Tf: S.Tf, Tm, Tc, void: P.void, inv: P.inv, boron: d.boronOK ? S.boron : 0, xe: S.Xe * SX * xs, sm: S.Sm * SSM * xs, fp: S.fpN * 50 * xs, e: S.efis };
  }

  function rhoTotal(S) {
    const ts = thermoState(S);
    const k = kcalc(S.d, ts);
    S.k = k;
    const W = rodWorth(S.d);
    let rr = -W * rodS(S.rods);
    let tip = 0;
    if (S.d.tip && S.scram) { // graphite displacer tip effect (RBMK)
      const x = S.rods, x0 = S.scramFrom;
      if (x0 < 0.15 && x < x0 + 0.3) tip = (0.004 + 0.012 * S.plant.void) * Math.sin(Math.PI * clamp((x - x0) / 0.3, 0, 1));
    }
    const rk = 1 - 1 / k.keff;
    S.rhoParts = { core: rk, rods: rr, tip, eject: S.rodEject };
    return rk + rr + tip + S.rodEject;
  }

  // solve steady state at power frac p
  function steadyInit(S, p) {
    const d = S.d, P = S.plant, C = P.c, F = FUELS[d.fuel], Mo = MODS[d.mod];
    S.n = p; S.burn = 0;
    { const mc = midCycle(d); S.efis = mc.e; S.fpN = mc.fpN; S.buMid = mc.bu; S.eMid = S.efis; S.fpMid = S.fpN; }
    // plant to steady
    for (let i = 0; i < 4000; i++) Plant.step(P, 0.25, d.P * p);
    const Tc = (P.Thot + P.Tcold) / 2;
    S.Tf = Tc + F.dTn * p;
    const node = modNode(d);
    S.Tm = node === 'solid' ? Tc + 60 * p : node === 'calandria' ? 70 + 15 * p : Tc;
    for (let i = 0; i < 4; i++) S.dec[i] = DECF[i] * p * d.P;
    // xenon / samarium equilibrium
    const cr = core(S), Rf = cr.Rf * p, phi = cr.phi * p;
    S.I = GI * Rf / LI; S.Xe = (GI + GX) * Rf / (LX + SX * phi); S.Pm = GPM * Rf / LPM; S.Sm = phi > 0 ? GPM * Rf / (SSM * phi) : 0;
    // rods (and boron) to make ρ = 0
    S.boron = 0; S.rods = 0;
    const r0 = rhoTotal(S);
    const W = rodWorth(d);
    const solveRods = () => { let lo = 0, hi = 1; for (let i = 0; i < 50; i++) { S.rods = (lo + hi) / 2; if (rhoTotal(S) > 0) lo = S.rods; else hi = S.rods; } };
    if (d.boronOK) {
      S.rods = 0.06;
      let lo = 0, hi = 3000;
      for (let i = 0; i < 50; i++) { S.boron = (lo + hi) / 2; if (rhoTotal(S) > 0) lo = S.boron; else hi = S.boron; }
      if (S.boron > 2990) solveRods();
    } else solveRods();
    S.boronCmd = S.boron; S.rodCmd = S.rods;
    const rr = rhoTotal(S);
    S.critOK = Math.abs(rr) < 1e-4;
    if (!S.critOK && r0 < 0) { // can't go critical: start subcritical, shut down
      shutdownInit(S); S.msg = `This core cannot reach criticality hot (k∞ ${S.k.kinf.toFixed(3)}, k_eff ${S.k.keff.toFixed(3)})`;
      return;
    }
    if (!S.critOK) { // too much excess reactivity for rods (+ boron)
      shutdownInit(S); S.msg = 'The control rods cannot hold this core critical at power — too much excess reactivity. Started shut down; it may still go critical cold.';
      return;
    }
    const k = S.k;
    S.beta = k.beta * (F.liquid ? 0.62 : 1); S.Lam = k.Lam;
    for (let i = 0; i < 6; i++) S.C[i] = S.beta * ABU[i] * S.n / (S.Lam * LAM[i]);
    S.rho = rr; S.Pset = p; P.loadSet = p; S.nf = p; S.dlnF = 0;
  }
  function shutdownInit(S) {
    const P = S.plant, C = P.c, d = S.d;
    S.n = 1e-8; S.rods = S.rodCmd = 1; S.Xe = S.I = S.Pm = 0; S.Sm = 0;
    P.pumpCmd = 1; P.tripped = true; P.breaker = false; P.valve = 0; P.loadSet = 0;
    const T = Math.max(40, C.freeze + 60);
    P.Hhot = P.Tcold = P.Thot = T; P.Ts = T - 5; P.rpm = 0; P.Pe = 0;
    S.Tf = S.Tm = T; S.dec = [0, 0, 0, 0];
    if (d.boronOK) S.boron = S.boronCmd = 1500;
    const r = rhoTotal(S);
    S.beta = S.k.beta; S.Lam = S.k.Lam;
    for (let i = 0; i < 6; i++) S.C[i] = S.beta * ABU[i] * S.n / (S.Lam * LAM[i]);
    S.autoRod = false; S.Pset = 0; S.nf = S.n; S.dlnF = 0;
  }

  function ev(S, msg, lvl = 'info', key = null, every = 5) {
    if (key) { const k = S.evKeys[key]; if (k != null && S.t - k < every) return; S.evKeys[key] = S.t; }
    S.ev.push({ t: S.t, msg, lvl }); if (S.ev.length > 250) S.ev.shift();
  }

  function scram(S, why) {
    if (S.scram) return;
    S.scram = true; S.scramT = S.t; S.scramFrom = S.rods; S.trip = why; S.autoRod = false;
    ev(S, `REACTOR SCRAM — ${why}`, 'crit');
    if (!S.plant.tripped) Plant.trip(S.plant, 'reactor trip');
    S.Pset = 0;
  }
  function resetScram(S) {
    if (!S.scram) return 'No scram to reset';
    S.scram = false; S.rodCmd = 1; S.rods = Math.max(S.rods, 0.999); S.trip = null; ev(S, 'Scram reset — rods latched fully inserted', 'info'); return null;
  }

  // ---------- main step ----------
  function step(S, dt) {
    const d = S.d, P = S.plant, C = P.c, F = FUELS[d.fuel], Mo = MODS[d.mod], node = modNode(d);
    S.t += dt;
    // --- rods ---
    if (S.scram) {
      const v = 1 / d.scram;
      S.rods = Math.min(1, S.rods + v * dt * (S.rods < 0.1 ? 0.6 : 1));
      S.rodCmd = S.rods;
    } else {
      if (S.autoRod && !S.destroyed) {
        const nf = S.nf;
        const e = S.Pset - nf;
        let rt = (S.beta || 0.0065) * clamp(0.6 * e / Math.max(nf, 0.02), -0.4, 0.12);
        if (Math.abs(e) < 0.003) rt *= 0.3;
        const W = rodWorth(d), x = S.rods;
        const dRdx = W * (1 - Math.cos(2 * Math.PI * x)) + 0.02 * W;
        S.rodCmd = clamp(x + (S.rho - rt) / dRdx, 0, 1);
      }
      S.rods += clamp(S.rodCmd - S.rods, -S.rodSpeed * dt, S.rodSpeed * dt);
    }
    if (S.link && !P.tripped) P.loadSet = clamp(S.Pset, 0, 1.05);
    // boron
    if (d.boronOK) S.boron += clamp(S.boronCmd - S.boron, -0.4 * dt, 1.5 * dt);
    if (S.eccs && d.boronOK) S.boron = Math.min(2500, S.boron + 6 * dt);
    // --- reactivity ---
    const rho = rhoTotal(S);
    S.rho = rho;
    const k = S.k;
    S.beta = k.beta * (F.liquid ? clamp(1 - 0.38 * P.flowEff, 0.55, 1) : 1); S.Lam = k.Lam;
    // --- kinetics (implicit, adaptive) ---
    const nOld = S.n;
    let left = dt, guard = 0;
    while (left > 1e-12 && guard++ < 4000) {
      const ex = rho - S.beta;
      let h = left;
      if (ex > 0) h = Math.min(h, 0.05 * S.Lam / ex);
      let num = S.n, den = 1 - h * (rho - S.beta) / S.Lam;
      for (let i = 0; i < 6; i++) { const b = S.beta * ABU[i], q = 1 + LAM[i] * h; num += h * LAM[i] * S.C[i] / q; den -= h * LAM[i] * h * b / S.Lam / q; }
      num += h * 1e-9 / S.Lam;
      let nn = num / Math.max(den, 1e-6);
      if (!(nn >= 0)) nn = 1e-12;
      nn = Math.min(nn, 1e5);
      for (let i = 0; i < 6; i++) S.C[i] = (S.C[i] + h * S.beta * ABU[i] / S.Lam * nn) / (1 + LAM[i] * h);
      S.n = nn;
      left -= h;
      if (ex > 0 && guard % 20 === 0) { // fast excursion: fuel heats adiabatically inside the loop
        S.Tf = Math.min(4500, S.Tf + (S.n * d.P) / (d.P * F.tauF / F.dTn) * h * 20);
      }
    }
    if (guard >= 4000) S.n = Math.min(S.n * Math.exp(Math.max(0, rho - S.beta) / S.Lam * left), 1e5);
    const nn = Math.max(S.n, 1e-12);
    const dln = Math.log(nn / Math.max(nOld, 1e-14)) / dt;
    S.dlnF += (dln - S.dlnF) * Math.min(1, dt / 0.6);
    S.nf += (nn - S.nf) * Math.min(1, dt / 0.4);
    S.period = Math.abs(S.dlnF) > 1e-5 ? 1 / S.dlnF : Infinity;
    S.maxN = Math.max(S.maxN * Math.exp(-dt / 30), S.n);
    // --- heat ---
    const Pfis = S.n * d.P;
    let Pdec = 0;
    for (let i = 0; i < 4; i++) { S.dec[i] += (DECF[i] * Pfis - S.dec[i]) * Math.min(1, dt / DECT[i]); Pdec += S.dec[i]; }
    const Pth = Pfis * (1 - 0.064) + Pdec;
    S.Pth = Pth;
    S.E += Pfis * dt / 86400; // MWd
    // fuel node
    const Tc = (P.Thot + P.Tcold) / 2;
    const Rf = F.dTn / d.P;
    let film = 1;
    if (C.medium === 'gas') film = 1 / Math.max(Math.pow(P.inv, 0.8), 0.03);
    else film = 1 + 6 * clamp(P.void - 0.75, 0, 1) + (P.inv < 0.6 ? 12 * (0.6 - P.inv) : 0) + (P.inv < 0.3 ? 1000 * (0.3 - P.inv) / 0.3 : 0);
    const dnb = (C.medium === 'h2o' || C.medium === 'd2o') && d.cool !== 'h2o_b' && P.x > 0.02 && S.n > 0.2;
    if (dnb) film *= 2.5;
    const Rfe = Rf * (1 + (film - 1) * 0.35);
    const Cf = d.P * F.tauF / F.dTn;
    const qfc = (S.Tf - Tc) / Rfe;
    const passive = (d.fuel === 'triso' || node === 'solid') ? Math.max(0, S.Tf - 60) * d.P * 2.5e-6 : 0;
    S.Tf = Math.min(4500, S.Tf + (Pth * 0.96 - qfc - passive) / Cf * dt);
    // moderator node
    if (node === 'solid') {
      const Cm = d.P * Mo.cap * 25;
      S.Tm += (Pth * 0.04 - (S.Tm - Tc) * d.P * 0.04 / 60 * Math.max(0.05, P.flowEff)) / Cm * dt * 1;
    } else if (node === 'calandria') S.Tm += (70 + 15 * S.n - S.Tm) * Math.min(1, dt / 120);
    else S.Tm = node === 'fuel' ? S.Tf : Tc;
    const Qcool = qfc + (node === 'solid' ? (S.Tm - Tc) * d.P * 0.04 / 60 * Math.max(0.05, P.flowEff) : Pth * 0.04);
    // ECCS / LOCA
    if (S.loca > 0) { P.inv = Math.max(0, P.inv - S.loca * dt * clamp(P.inv * 1.5, 0.15, 1) * (C.medium === 'gas' ? 1 : clamp(Plant.press(P) / C.P + 0.25, 0.3, 1))); }
    const lowP = Plant.press(P) < C.P * 0.75 || (C.medium !== 'gas' && P.inv < 0.85);
    if (S.eccsAuto && !S.eccs && lowP && (C.medium === 'h2o' || C.medium === 'd2o')) { S.eccs = true; ev(S, 'ECCS actuated — safety injection', 'warn'); }
    const auxPower = P.gridOk || (P.diesel && P.dieselOK && S.t - S.dieselT > 12);
    if (S.eccs && (C.medium === 'h2o' || C.medium === 'd2o')) {
      if (auxPower) P.inv = Math.min(1, P.inv + 0.03 * dt * (1 + 2 * (1 - P.inv)) * (Plant.press(P) < C.P * 0.9 ? 1 : 0.15));
      P.Tcold -= Math.min(30, Math.max(0, P.Tcold - 30)) * dt * 0.01 * (auxPower ? 1 : 0);
    }
    if (S.rhrAuto && S.n < 0.05 && auxPower) P.rhrOn = true;
    // plant
    Plant.step(P, dt, Qcool);
    // --- xenon / samarium / burnup ---
    const cr = core(S), Rf2 = cr.Rf * S.n, phi = cr.phi * S.n;
    S.phi = phi;
    S.I += (GI * Rf2 - LI * S.I) * dt;
    S.Xe += (GX * Rf2 + LI * S.I - LX * S.Xe - SX * phi * S.Xe) * dt;
    S.Pm += (GPM * Rf2 - LPM * S.Pm) * dt;
    S.Sm += (LPM * S.Pm - SSM * phi * S.Sm) * dt;
    const fisPerHM = Rf2 / F.N / 1e24; // fraction of HM fissioned per s
    const absFis = fisPerHM * (NUC[F.fis].sa / NUC[F.fis].sf);
    S.efis = Math.max(1e-4, S.efis - absFis * (1 - clamp(k.CR, 0, 1.3)) * dt);
    S.fpN += Rf2 * dt / 1e24 * 1e24 * 1e-24; // fissions/cm3 * 1e-24
    if (d.online) { const tau = 3e6; S.efis += (S.eMid - S.efis) * dt / tau; S.fpN += (S.fpMid - S.fpN) * dt / tau; }
    S.burn = S.E / (Math.PI * d.R * d.R * d.H * cr.ff * F.N * 1e24 * 238 / 6.022e23 / 1e6) / 1000; // GWd/tHM
    // --- diesels ---
    if (!P.gridOk && S.dieselT === 0) { S.dieselT = S.t; ev(S, P.diesel && P.dieselOK ? 'Emergency diesel generators starting' : 'Emergency diesels unavailable — STATION BLACKOUT', P.diesel && P.dieselOK ? 'warn' : 'crit'); }
    if (P.gridOk) S.dieselT = 0;
    // --- protection ---
    protection(S, dt);
    damage(S, dt);
    // plant events → log
    Plant.drain(P).forEach(e => ev(S, e.msg, e.lvl));
  }

  function limits(S) {
    const F = FUELS[S.d.fuel];
    return { fuel: F.limit || F.melt, melt: F.melt };
  }
  function peaks(S) {
    const P = S.plant, Tc = (P.Thot + P.Tcold) / 2;
    const k = S.k || { ws: 1 };
    const ins = S.rods;
    const pf = 1.45 + 0.6 * ins * (1 - ins) * 2 + (S.rodEject > 0 ? 0.8 : 0);
    const Tpk = Tc + (S.Tf - Tc) * pf * 1.1;
    const unc = clamp((0.3 - P.inv) / 0.3, 0, 1);
    const Tclad = Tc + (S.Tf - Tc) * (0.12 * pf * (1 - unc) + 0.85 * unc) + (P.x > 0.05 && S.d.cool !== 'h2o_b' ? 150 * P.x * S.n : 0);
    return { pf, Tpk, Tclad };
  }

  function protection(S, dt) {
    const P = S.plant, d = S.d, C = P.c;
    const pk = peaks(S); S.pk = pk;
    if (!S.rps || S.scram) return;
    const L = limits(S);
    if (S.n > 1.18) return scram(S, `high neutron flux ${(S.n * 100).toFixed(0)}%`);
    if (S.period > 0 && S.period < 10 && S.n > 1e-6 && S.n < 0.15) return scram(S, `short reactor period ${S.period.toFixed(1)} s (startup range)`);
    if (S.period > 0 && S.period < 3 && S.n > 0.15) return scram(S, `high power rate (period ${S.period.toFixed(1)} s)`);
    if (pk.Tpk > L.fuel * 0.85) return scram(S, `high fuel temperature ${pk.Tpk.toFixed(0)} °C`);
    if (S.n > 0.25 && P.flowEff < 0.7 * P.pumpCmd && P.flowEff < 0.85) return scram(S, `low primary flow ${(P.flowEff * 100).toFixed(0)}%`);
    if (P.Thot > C.Tout + 35 && S.n > 0.05) return scram(S, `high coolant outlet ${P.Thot.toFixed(0)} °C`);
    if (d.cool !== 'h2o_b' && P.x > 0.01 && S.n > 0.1) return scram(S, 'coolant boiling (DNB risk)');
    if (P.level < 0.18 && S.n > 0.05) return scram(S, `low steam-generator level ${(P.level * 100).toFixed(0)}%`);
    if (P.tripped && S.n > 0.35 && !P.dumpAuto) return scram(S, 'turbine trip without steam dump');
    if (P.tripped && S.n > 0.6) return scram(S, 'turbine trip (anticipatory)');
    if (!P.gridOk && S.n > 0.05) return scram(S, 'loss of offsite power');
    if (Plant.press(P) < C.P * 0.8 && C.medium !== 'metal' && C.medium !== 'salt') return scram(S, `low primary pressure ${Plant.press(P).toFixed(0)} bar`);
    if (P.frozen) return scram(S, 'coolant freezing');
  }

  function damage(S, dt) {
    const P = S.plant, d = S.d, C = P.c, D = S.dmg, F = FUELS[d.fuel];
    const pk = S.pk || peaks(S);
    S.peakF = Math.max(S.peakF * Math.exp(-dt / 60), pk.Tpk);
    const L = limits(S);
    const before = D.fuel;
    if (pk.Tpk > L.fuel) D.fuel = Math.min(100, D.fuel + (pk.Tpk - L.fuel) / 400 * dt * 3);
    if (F.clad && pk.Tclad > 1200) { D.clad = Math.min(100, D.clad + (pk.Tclad - 1200) / 300 * dt * 2); if (C.medium === 'h2o' || C.medium === 'd2o') D.h2 += (pk.Tclad - 1200) / 200 * dt * 0.5; }
    if (F.clad && pk.Tclad > 850 && d.cool !== 'h2o_b' && P.x > 0.05) D.clad = Math.min(100, D.clad + dt * 0.4);
    if (C.medium === 'metal' && P.Thot > C.boil - 10) { D.fuel = Math.min(100, D.fuel + dt * 2); ev(S, `Coolant boiling at ${C.boil} °C — core voiding`, 'crit', 'cb', 20); }
    if (D.fuel > 0.5 && before <= 0.5) ev(S, `FUEL DAMAGE — peak fuel ${pk.Tpk.toFixed(0)} °C exceeds ${L.fuel} °C`, 'crit');
    if (D.fuel > 30 && !S.melt) { S.melt = true; ev(S, 'CORE MELT — molten fuel relocating to lower head', 'crit'); }
    // prompt excursion: energy into fuel faster than it can leave
    if (S.n > 30 && !S.destroyed) {
      D.vessel = Math.min(100.1, D.vessel + (S.n / 30) * dt * 40);
      if (D.vessel > 100) {
        S.destroyed = true; S.breach = true; D.fuel = 100; D.release += 60;
        const water = C.medium === 'h2o' || C.medium === 'd2o';
        ev(S, water ? 'PROMPT-CRITICAL EXCURSION — steam explosion ruptured the reactor vessel' : 'PROMPT-CRITICAL EXCURSION — core disassembly, vessel ruptured', 'crit');
        S.n = 0.001; S.rho = -0.5; S.rods = 1; S.scram = true; for (let i = 0; i < 6; i++) S.C[i] *= 0.001; P.inv = 0;
      }
    }
    if (D.h2 > 30 && !S.h2boom) { S.h2boom = true; S.breach = true; D.release += 15; ev(S, 'HYDROGEN EXPLOSION in reactor building — containment breached', 'crit'); }
    if (S.melt && D.fuel > 70 && !S.breach && Plant.press(P) > C.P * 0.9 && C.medium !== 'gas') { D.vessel += dt * 0.3; if (D.vessel > 100) { D.vessel = 100; S.breach = true; ev(S, 'Lower head failure — corium in reactor cavity', 'crit'); } }
    if (S.breach) D.release = Math.min(100, D.release + dt * 0.05 * D.fuel / 100);
    else if (D.clad > 5) D.release = Math.min(3, D.release + dt * 0.0005 * D.clad);
  }
  function ines(S) {
    const D = S.dmg;
    if (D.release > 40) return 7; if (D.release > 10) return 6; if (D.release > 3) return 5;
    if (D.fuel > 5) return 4; if (D.fuel > 0.5 || D.clad > 5) return 3; if (D.clad > 0.5 || S.dmg.vessel > 5) return 2; return 0;
  }

  // load new core (design change)
  function loadCore(S, d) {
    const keep = { warp: S.warp, ev: S.ev, t: S.t, rps: S.rps, eccsAuto: S.eccsAuto };
    const N = create(d.preset, {});
    N.d = d;
    N.plant = Plant.create({ Pnom: d.P, coolant: d.cool, kind: 'fission' });
    N.plant.ambient = S.plant.ambient;
    Object.assign(N, keep);
    N.dmg = { fuel: 0, clad: 0, vessel: 0, h2: 0, release: 0 };
    N.msg = null;
    steadyInit(N, 1);
    if (N.critOK) { /* start hot at full power */ }
    return N;
  }

  // scenarios
  const SCEN = {
    loop: { nm: 'Loss of offsite power', run: S => { S.plant.gridOk = false; ev(S, 'SCENARIO: loss of offsite power — grid disconnected', 'crit'); } },
    sbo: { nm: 'Station blackout', run: S => { S.plant.gridOk = false; S.plant.dieselOK = false; ev(S, 'SCENARIO: station blackout — grid lost and diesels fail to start', 'crit'); } },
    ttrip: { nm: 'Turbine trip', run: S => { Plant.trip(S.plant, 'SCENARIO: spurious turbine trip'); } },
    lofw: { nm: 'Loss of feedwater', run: S => { S.plant.feedOn = false; ev(S, 'SCENARIO: main feedwater pumps tripped', 'crit'); } },
    lofa: { nm: 'Pump seizure', run: S => { S.plant.pumpOn = false; S.plant.flow *= 0.3; ev(S, 'SCENARIO: primary pump shaft seizure', 'crit'); } },
    sloca: { nm: 'Small-break LOCA', run: S => { S.loca = 0.0015; ev(S, 'SCENARIO: small-break loss-of-coolant accident', 'crit'); } },
    lloca: { nm: 'Large-break LOCA', run: S => { S.loca = 0.08; ev(S, 'SCENARIO: double-ended cold-leg break — large LOCA', 'crit'); } },
    eject: { nm: 'Rod ejection', run: S => { S.rodEject = 0.75 * (S.beta || 0.0065) + 0.0015; S.ejectT = S.t; ev(S, `SCENARIO: control rod ejected (+${(S.rodEject * 1e5).toFixed(0)} pcm)`, 'crit'); } },
    dilute: { nm: 'Boron dilution', run: S => { if (!S.d.boronOK) return ev(S, 'This design has no soluble boron', 'warn'); S.boronCmd = Math.max(0, S.boron - 400); ev(S, 'SCENARIO: inadvertent boron dilution (−400 ppm)', 'crit'); } }
  };

  G.Fis = { midCycle, modNode, rhoTotal, thermoState, NUC, FUELS, MODS, RODS, REFL, PRESETS, SCEN, create, step, design, evaluate, kcalc, rodWorth, rodS, scram, resetScram, ev, loadCore, steadyInit, shutdownInit, peaks, limits, ines, core, wden, clamp, ABU, LAM };
})(typeof window !== 'undefined' ? window : globalThis);
