# Physics Sandbox · AppliedPhysicsPlayground

**Live:** https://protoknight12.github.io/AppliedPhysicsPlayground/

Interactive, browser-based physics simulators. No build step, no dependencies — open `index.html` or serve the folder with GitHub Pages.

| Simulator | Path | What you can do |
|---|---|---|
| **Fusion reactor** (HELIX-6 tokamak) | `fusion/` | Pump down, cool the magnets, start a discharge, reach H-mode and hold a burning plasma. Choose the fuel cycle (D–T, D–D, D–³He, p–¹¹B), LTS or HTS magnets and the breeding blanket / coolant. |
| **Orbital docking** | `docking/` | Dock a 12 t crew capsule with a space station in a 420 km orbit. Clohessy–Wiltshire relative motion, 6-DOF RCS with propellant budget, docking camera with centreline target, day/night eclipse, real soft-capture limits. Five scenarios from a 30 m final approach to a 1.2 km coelliptic rendezvous. |
| **Lunar lander** | `lander/` | Land an Apollo-class LM: throttleable 45 kN descent engine (10 % minimum), RCS attitude with hold/auto-level, P66 rate-of-descent mode, fuel callouts, contact light, ballistic dust sheets, crater fields and a curved horizon. |
| **Fission reactor** | `fission/` | Run a PWR, BWR, CANDU, RBMK, AGR, HTGR, sodium or lead fast reactor, molten-salt or TRIGA-style core — or build your own from 7 fuels, 6 moderators and 9 coolants. Scram it, start it from cold, and run accident scenarios. |

Both consoles have a **plant overview**: reactor → steam generator / heat exchanger → turbines → generator → condenser → cooling tower → grid. Pumps, turbine, breaker, tower fans and the grid connection are clickable. Use **⤢ Full width** for the big view.

## Layout

```
index.html            launcher
fusion/index.html     tokamak console (0D/1.5D plasma model)
fission/index.html    fission console UI
fission/model.js      fission physics (kinetics, four-factor k, poisons, thermal, safety)
shared/plant.js       balance-of-plant model + plant-overview renderer (used by both)
shared/console.css    shared console styles
docking/index.html    orbital docking simulator (three.js)
lander/index.html     lunar lander (three.js)
shared/nasa/          NASA Earth and Moon imagery
```

## Models in brief

**Fission** — point kinetics with six delayed-neutron groups (implicit, stable for fast spectra and prompt-critical excursions); k from the four-factor formula plus leakage, blended into a fast-spectrum neutron balance when moderation is weak. Doppler, moderator-temperature and void coefficients emerge from that formula rather than being set by hand. Xe-135/I-135 and Sm-149 poisoning, burnup and conversion, four-group decay heat, boiling/DNB, natural circulation, coolant freezing, ECCS, RHR and diesels.

**Fusion** — Bosch–Hale reactivities (p–¹¹B tabulated), IPB98(y,2) confinement, Martin L–H threshold, bootstrap and driven current, radiation, helium ash, Greenwald/Troyon/q95 limits, ELMs, vertical stability, disruptions, runaway electrons, magnet quench, tritium breeding.

Numbers are tuned to be the right size, not licensing-grade.

**Docking** — Hill/Clohessy–Wiltshire equations in the station's LVLH frame (n for a 420 km orbit), closed-form CW free-drift predictor, rigid-body attitude with RCS rate limits, Isp-based propellant use, cylindrical Earth shadow for eclipse.

**Lander** — 1.62 m/s² gravity, Tsiolkovsky mass flow at Isp 311 s, throttle lag, thrust lift = T·cos(tilt), ballistic dust in vacuum, lunar curvature (R = 1737 km) on the terrain. Crater size–frequency N(>r) ∝ r⁻².

## Credits

- Earth: NASA Earth Observatory — Blue Marble (day) and Black Marble (city lights).
- Moon: NASA Scientific Visualization Studio, CGI Moon Kit (LRO LROC WAC colour mosaic); horizon imagery is the Mare Tranquillitatis region.
- 3D: [three.js](https://threejs.org) (MIT), loaded from jsDelivr.
