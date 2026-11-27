# Physics Sandbox · AppliedPhysicsPlayground

**Live:** https://protoknight12.github.io/AppliedPhysicsPlayground/

Interactive, browser-based physics simulators. No build step, no dependencies to install — open `index.html` or serve the folder with GitHub Pages. Every sim works with keyboard, mouse and touch.

| Simulator | Path | What you can do |
|---|---|---|
| **Fusion reactor** (HELIX-6 tokamak) | `fusion/` | Pump down, cool the magnets, start a discharge, reach H-mode and hold a burning plasma. Choose the fuel cycle (D–T, D–D, D–³He, p–¹¹B), LTS or HTS magnets and the breeding blanket / coolant. |
| **Fission reactor** | `fission/` | Run a PWR, BWR, CANDU, RBMK, AGR, HTGR, sodium or lead fast reactor, molten-salt or TRIGA-style core — or build your own from 7 fuels, 6 moderators and 9 coolants. Scram it, start it from cold, and run accident scenarios. |
| **Grid operator** *(new)* | `grid/` | Keep a 30 GW island grid at 50 Hz from 05:00 to midnight: dispatch nuclear, coal, gas, hydro, pumped storage, batteries, an interconnector, wind and solar. Trip the largest unit at sunny noon and watch low inertia turn into a loss-of-mains cascade — unless your batteries catch it. |
| **Launch to orbit** *(new)* | `launch/` | Fly a two-stage kerolox launcher from Cape Canaveral or Vandenberg to a 200–600 km orbit: pitch kick, gravity turn, max-Q throttle bucket, staging, fairing jettison and closed-loop insertion. Hand-fly it or let the autopilot show you how. |
| **Orbital docking** | `docking/` | Dock a 12 t crew capsule with a space station in a 420 km, 51.6° orbit. Clohessy–Wiltshire relative motion, 6-DOF RCS with propellant budget, docking camera, day/night eclipse, real soft-capture limits. |
| **Atmospheric entry** *(new)* | `reentry/` | Bring a crew capsule from entry interface (7.8 or 11 km/s) to the recovery ship by rolling its lift vector. Heat-shield budget, plasma blackout, g-limits, skip-out, drogues, mains and splashdown. |
| **Lunar lander** | `lander/` | Land an Apollo-class LM: throttleable 45 kN descent engine (10 % minimum), RCS attitude with hold/auto-level, P66 rate-of-descent mode, landing-trajectory prediction, contact light, boulder fields, ballistic dust sheets and a curved horizon. |

The reactor consoles include a **plant overview** (reactor → steam generator → turbines → generator → condenser → cooling tower → grid) with clickable pumps, turbine, breaker and fans. All 3D sims share a **draggable camera** in every view (drag to orbit or look around, wheel/pinch to zoom, double-click to re-centre), a settings menu (graphics quality with adaptive resolution, FPS counter, touch controls) and on-screen touch controls on phones and tablets.

## Layout

```
index.html               launcher (live canvas previews)
favicon.svg
fusion/index.html        tokamak console (0D/1.5D plasma model)
fission/index.html       fission console UI
fission/model.js         fission physics (kinetics, four-factor k, poisons, thermal, safety)
grid/index.html          grid operator console (swing equation, droop, AGC, dispatch)
launch/index.html        launch to orbit (three.js)      launch/rocket.js   vehicle + pad models
docking/index.html       orbital docking (three.js)
reentry/index.html       atmospheric entry (three.js)    reentry/capsule.js capsule, plasma, chutes, ship
lander/index.html        lunar lander (three.js)         lander/terrain.js  analytic terrain + quadtree LOD + boulders
                                                         lander/lm.js       Lunar Module model
shared/console.css       shared console styles (fusion, fission, grid)
shared/plant.js          balance-of-plant model + plant-overview renderer
shared/hud.css           shared HUD styles for the 3D sims
shared/site.js           sim catalogue, "switch simulator" menu, favicon
shared/touch.js          on-screen sticks/buttons that emit the sims' keyboard events
shared/three/kit.js      renderer + quality presets, adaptive resolution, env maps, stars, settings, telemetry panels
shared/three/camrig.js   draggable camera rig (orbit / cockpit look / ground tracking)
shared/three/earth.js    ray-marched Earth: NASA imagery, clouds, single-scattering atmosphere; US Std Atmosphere 1976
shared/nasa/             NASA Earth and Moon imagery
```

## Models in brief

**Fission** — point kinetics with six delayed-neutron groups (implicit, stable for fast spectra and prompt-critical excursions); k from the four-factor formula plus leakage, blended into a fast-spectrum neutron balance when moderation is weak. Doppler, moderator-temperature and void coefficients emerge from that formula rather than being set by hand. Xe-135/I-135 and Sm-149 poisoning, burnup and conversion, four-group decay heat, boiling/DNB, natural circulation, coolant freezing, ECCS, RHR and diesels.

**Fusion** — Bosch–Hale reactivities (p–¹¹B tabulated), IPB98(y,2) confinement, Martin L–H threshold, bootstrap and driven current, radiation, helium ash, Greenwald/Troyon/q95 limits, ELMs, vertical stability, disruptions, runaway electrons, magnet quench, tritium breeding.

**Grid** — aggregated single-bus swing equation 2H·S/f₀ · df/dt = P_gen − P_load with load damping; system inertia summed over synchronous plant in service (wind and solar add none unless grid-forming inverters are enabled); governor droop (4 %, 15 mHz dead-band) with per-fleet lags; AGC as an integral of area-control error; merit-order dispatch with reserve, ramp limits, minimum stable generation and start-up times; storage state of charge and round-trip losses; UFLS in four 5 % stages from 48.8 Hz, loss-of-mains trips above 1 Hz/s RoCoF, generator trips below 47.5 Hz.

**Launch** — 3-DOF in an Earth-centred inertial frame over a rotating Earth; US Standard Atmosphere 1976; thrust and Isp vary with ambient pressure; Mach-dependent drag with the transonic peak; launch azimuth from the target inclination corrected for the pad's eastward velocity; first-stage guidance follows a flight-path-angle programme with an angle-of-attack limit (q·α), second stage uses velocity-to-be-gained steering plus first-order linear-sine (PEG-like) radial control with an energy cut-off. Orbital elements from the live state vector.

**Docking** — Hill/Clohessy–Wiltshire equations in the station's LVLH frame (n for a 420 km orbit), closed-form CW free-drift predictor, rigid-body attitude with RCS rate limits, Isp-based propellant use, cylindrical Earth shadow for eclipse, ground track of a 51.6° orbit with Earth rotation.

**Entry** — 3-DOF over a rotating Earth with a trimmed L/D of 0.28 and bank-angle control; convective heating by Sutton–Graves (nose radius 6 m), radiative heating by Tauber–Sutton above ~9 km/s; plasma blackout while the shock layer is ionised; numerical predictor-corrector guidance with bank reversals and a g-limiter; drogue and main parachute loads; splashdown.

**Lander** — 1.62 m/s² gravity, Tsiolkovsky mass flow at Isp 311 s, throttle lag, thrust lift = T·cos(tilt), ballistic dust in vacuum, lunar curvature (R = 1737 km). Terrain is one analytic height function (macro noise + catalogued craters with N(>r) ∝ r⁻² + procedurally placed craters down to ~1 m) used by both physics and the quadtree mesh; boulders cluster on fresh crater rims and can tilt or topple the vehicle.

**Rendering** — the Earth, clouds and atmosphere in the launch, docking and entry sims are ray-cast per pixel (exact horizon at every altitude) with Rayleigh, Mie and ozone single scattering. Spacecraft use image-based lighting from procedural environment maps; static geometry is merged by material to keep draw calls low; resolution adapts to frame time.

Numbers are tuned to be the right size, not licensing-grade.

## Credits

- Earth: NASA Earth Observatory — Blue Marble (day) and Black Marble (city lights).
- Moon: NASA Scientific Visualization Studio, CGI Moon Kit (LRO LROC WAC colour mosaic); horizon imagery is the Mare Tranquillitatis region.
- 3D: [three.js](https://threejs.org) (MIT), loaded from jsDelivr.
