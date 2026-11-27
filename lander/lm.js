// Apollo-class Lunar Module model (front = −Z, up = +Y, origin ≈ centre of mass).
// Descent stage: octagonal box wrapped in gold and black Kapton, throttleable engine bell, four cantilever legs
// with primary/secondary struts, footpads and 1.7 m contact probes; ascent stage: faceted crew cabin with
// triangular windows, docking tunnel, rendezvous-radar and S-band dishes, VHF antennas and four RCS quads.
import * as THREE from 'three';
import { foilNormalMap } from '../shared/three/kit.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
export function buildLM() {
  const lm = new THREE.Group();
  const foil = foilNormalMap(256, 11);
  const fn = (r) => { const t = foil.clone(); t.needsUpdate = true; t.repeat.set(r, r); return t; };
  const M = {
    gold: new THREE.MeshStandardMaterial({ color: 0xd09a35, roughness: 0.32, metalness: 1, normalMap: fn(1.5), normalScale: new THREE.Vector2(0.9, 0.9) }),
    goldDark: new THREE.MeshStandardMaterial({ color: 0x8c6522, roughness: 0.45, metalness: 1, normalMap: fn(2), normalScale: new THREE.Vector2(0.7, 0.7) }),
    kapton: new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: 0.42, metalness: 0.6, normalMap: fn(1.5), normalScale: new THREE.Vector2(0.8, 0.8) }),
    silver: new THREE.MeshStandardMaterial({ color: 0xc6cacd, roughness: 0.3, metalness: 0.9, normalMap: fn(2.5), normalScale: new THREE.Vector2(0.35, 0.35) }),
    panel: new THREE.MeshStandardMaterial({ color: 0x8f9396, roughness: 0.5, metalness: 0.65 }),
    darkPanel: new THREE.MeshStandardMaterial({ color: 0x2c2e31, roughness: 0.55, metalness: 0.4 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0e0f10, roughness: 0.7, metalness: 0.2 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x020304, roughness: 0.03, metalness: 0.95 }),
    bell: new THREE.MeshStandardMaterial({ color: 0x3a3836, roughness: 0.5, metalness: 0.7, side: THREE.DoubleSide }),
    bellHot: new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide }),
    white: new THREE.MeshStandardMaterial({ color: 0xe4e4e0, roughness: 0.6, metalness: 0.1 }),
  };
  const add = (geo, mat, pos, rot, parent = lm) => { const m = new THREE.Mesh(geo, mat); if (pos) m.position.copy(pos); if (rot) m.rotation.set(...rot); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
  const strut = (a, b, r, mat, seg = 8) => { const d = b.clone().sub(a), L = d.length(); const m = add(new THREE.CylinderGeometry(r, r, L, seg), mat, a.clone().add(b).multiplyScalar(0.5)); m.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize()); return m; };

  // ---- descent stage: alternating long (2.64 m) and short (1.1 m) faces, 4.2 m across flats ----
  const W = 4.2, L = 2.64, Hd = 1.66, yb = -1.46;
  const oct = [[L / 2, W / 2], [W / 2, L / 2], [W / 2, -L / 2], [L / 2, -W / 2], [-L / 2, -W / 2], [-W / 2, -L / 2], [-W / 2, L / 2], [-L / 2, W / 2]];
  const shape = new THREE.Shape(oct.map(([x, z]) => new THREE.Vector2(x, z)));
  const dg = new THREE.ExtrudeGeometry(shape, { depth: Hd, bevelEnabled: false }); dg.rotateX(-Math.PI / 2); dg.translate(0, yb, 0);
  add(dg, M.gold);
  // black Kapton blankets on the corner faces and lower skirts
  for (let i = 0; i < 8; i++) {
    const [x1, z1] = oct[i], [x2, z2] = oct[(i + 1) % 8], mx = (x1 + x2) / 2, mz = (z1 + z2) / 2, len = Math.hypot(x2 - x1, z2 - z1), ang = Math.atan2(x2 - x1, z2 - z1);
    const n = V3(mx, 0, mz).normalize();
    if (i % 2 === 1) add(new THREE.BoxGeometry(0.02, Hd * 0.92, len * 0.98), M.kapton, V3(mx, yb + Hd / 2, mz).addScaledVector(n, 0.012), [0, ang, 0]);
    else {
      add(new THREE.BoxGeometry(0.02, 0.34, len * 0.99), M.kapton, V3(mx, yb + 0.17, mz).addScaledVector(n, 0.012), [0, ang, 0]);
      add(new THREE.BoxGeometry(0.02, 0.06, len), M.goldDark, V3(mx, yb + Hd - 0.05, mz).addScaledVector(n, 0.014), [0, ang, 0]);
      const bay = add(new THREE.BoxGeometry(0.03, Hd * 0.5, len * 0.42), M.goldDark, V3(mx, yb + Hd * 0.55, mz).addScaledVector(n, 0.02), [0, ang, 0]);
    }
  }
  add(new THREE.CylinderGeometry(W * 0.52, W * 0.52, 0.05, 8), M.kapton, V3(0, yb + Hd + 0.02, 0), [0, Math.PI / 8, 0]);
  // descent engine: gimballed bell (exit Ø 1.5 m) with a heat-shield skirt
  const bellG = new THREE.LatheGeometry([[0.36, 0.0], [0.4, -0.12], [0.52, -0.42], [0.66, -0.76], [0.76, -1.02]].map(([r, y]) => new THREE.Vector2(r, y)), 40);
  const bell = add(bellG, M.bell, V3(0, yb + 0.02, 0));
  const hot = new THREE.Mesh(new THREE.LatheGeometry([[0.34, 0.0], [0.38, -0.12], [0.5, -0.42], [0.64, -0.76], [0.74, -1.0]].map(([r, y]) => new THREE.Vector2(r, y)), 32), M.bellHot);
  hot.position.y = yb + 0.02; hot.userData.dynamic = true; lm.add(hot);
  add(new THREE.CylinderGeometry(0.95, 1.05, 0.12, 24), M.kapton, V3(0, yb - 0.02, 0));

  // ---- landing gear: legs on the four long faces ----
  const legs = [];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2, dx = Math.sin(a), dz = Math.cos(a), px = V3(-dz, 0, dx);
    const top = V3(dx * 2.12, yb + Hd - 0.18, dz * 2.12), foot = V3(dx * 3.4, -2.83, dz * 3.4);
    const mid = top.clone().lerp(foot, 0.52);
    strut(top, top.clone().lerp(foot, 0.62), 0.11, M.gold, 10);                              // upper primary strut (wrapped)
    strut(top.clone().lerp(foot, 0.6), foot.clone().add(V3(0, 0.12, 0)), 0.065, M.silver, 10); // lower piston
    for (const s of [-1, 1]) strut(V3(dx * 2.1, yb + 0.12, dz * 2.1).addScaledVector(px, s * 1.05), mid, 0.045, M.gold);   // secondary struts
    strut(V3(dx * 2.1, yb + 0.05, dz * 2.1), top.clone().lerp(foot, 0.35), 0.03, M.silver);                               // deployment truss
    for (const s of [-1, 1]) strut(V3(dx * 2.1, yb + 0.05, dz * 2.1).addScaledVector(px, s * 0.6), top.clone().lerp(foot, 0.35), 0.022, M.silver);
    const pad = add(new THREE.LatheGeometry([[0, -0.1], [0.3, -0.09], [0.43, -0.03], [0.47, 0.06], [0.44, 0.08]].map(([r, y]) => new THREE.Vector2(r, y)), 24), M.goldDark, V3(dx * 3.4, -2.9, dz * 3.4));
    if (i !== 2) strut(V3(dx * 3.4, -3.0, dz * 3.4), V3(dx * 3.45, -4.7, dz * 3.45), 0.012, M.black, 5);   // contact probes (not on the ladder leg)
    legs.push({ top, foot });
  }
  // ladder and porch on the front (−Z) leg
  { const { top, foot } = legs[2];
    add(new THREE.BoxGeometry(1.0, 0.05, 0.75), M.silver, V3(0, yb + Hd + 0.02, -2.42));
    for (const s of [-1, 1]) strut(top.clone().add(V3(s * 0.32, -0.1, -0.12)), foot.clone().add(V3(s * 0.32, 0.6, -0.08)), 0.02, M.silver, 6);
    for (let k = 0; k < 9; k++) { const p = top.clone().lerp(foot, 0.1 + k * 0.085).add(V3(0, 0, -0.12)); add(new THREE.BoxGeometry(0.64, 0.035, 0.035), M.silver, p); } }

  // ---- ascent stage ----
  const ya = 0.22;
  // crew compartment: horizontal cylinder with a faceted front face
  add(new THREE.CylinderGeometry(1.17, 1.17, 2.34, 24), M.panel, V3(0, ya + 1.28, -0.55), [0, 0, Math.PI / 2]);
  const prof = [[-0.1, 0.0], [-1.25, 0.0], [-1.62, 0.42], [-1.82, 1.15], [-1.62, 1.86], [-1.05, 2.18], [-0.1, 2.18]];
  const fs = new THREE.Shape(prof.map(([z, y]) => new THREE.Vector2(z, y)));
  const fg = new THREE.ExtrudeGeometry(fs, { depth: 2.5, bevelEnabled: false }); fg.rotateY(-Math.PI / 2); fg.translate(1.25, ya + 0.1, 0);
  add(fg, M.silver);
  // triangular forward windows (left/right) and the overhead docking window
  for (const s of [-1, 1]) {
    const tri = new THREE.BufferGeometry().setFromPoints([V3(s * 0.1, 0, 0), V3(s * 0.75, 0, 0), V3(s * 0.12, 0.5, 0.14)]); tri.setIndex(s > 0 ? [0, 2, 1] : [0, 1, 2]); tri.computeVertexNormals();
    add(tri, M.glass, V3(0, ya + 1.3, -1.818));
    add(new THREE.BoxGeometry(0.72, 0.05, 0.04), M.darkPanel, V3(s * 0.43, ya + 1.28, -1.81));
  }
  add(new THREE.PlaneGeometry(0.3, 0.3), M.glass, V3(-0.45, ya + 2.29, -1.0), [-Math.PI / 2, 0, 0]);
  // front hatch, face panels
  add(new THREE.BoxGeometry(0.8, 0.5, 0.04), M.darkPanel, V3(0, ya + 0.29, -1.46), [-0.72, 0, 0]);
  // midsection and aft equipment bay
  add(new THREE.BoxGeometry(2.62, 2.0, 1.3), M.silver, V3(0, ya + 1.1, 0.42));
  add(new THREE.BoxGeometry(2.2, 1.35, 1.05), M.kapton, V3(0, ya + 1.15, 1.55));
  add(new THREE.BoxGeometry(2.22, 0.1, 1.07), M.gold, V3(0, ya + 1.8, 1.55));
  add(new THREE.BoxGeometry(0.9, 0.7, 0.4), M.gold, V3(0.6, ya + 0.6, 2.2));
  // docking tunnel and drogue
  add(new THREE.CylinderGeometry(0.52, 0.56, 0.5, 24), M.panel, V3(0, ya + 2.42, -0.1));
  add(new THREE.TorusGeometry(0.46, 0.05, 8, 32), M.silver, V3(0, ya + 2.68, -0.1), [Math.PI / 2, 0, 0]);
  // rendezvous radar (front, upper right) and S-band steerable antenna (right side)
  const rr = add(new THREE.SphereGeometry(0.34, 20, 8, 0, Math.PI * 2, 0, 1.1), M.white, V3(0.78, ya + 2.35, -1.25), [Math.PI / 2 + 0.35, 0, 0]);
  strut(V3(0.78, ya + 2.05, -1.0), V3(0.78, ya + 2.3, -1.2), 0.04, M.silver);
  strut(V3(1.31, ya + 1.9, 0.6), V3(1.75, ya + 2.25, 0.6), 0.035, M.silver);
  add(new THREE.SphereGeometry(0.33, 20, 8, 0, Math.PI * 2, 0, 1.0), M.white, V3(1.8, ya + 2.38, 0.6), [0.2, 0, -1.2]);
  // VHF antennas
  strut(V3(-0.5, ya + 2.1, 1.1), V3(-0.95, ya + 2.9, 1.4), 0.012, M.silver, 4);
  strut(V3(0.5, ya + 2.1, 1.1), V3(0.95, ya + 2.9, 1.4), 0.012, M.silver, 4);
  // ascent engine cover between the stages
  add(new THREE.CylinderGeometry(0.62, 0.7, 0.32, 20), M.kapton, V3(0, ya + 0.02, 0.3));
  // RCS quads on four booms, each with four thrusters (up, down, and two sideways)
  const rcs = [];
  for (const [x, z] of [[1.63, -1.37], [-1.63, -1.37], [1.63, 1.37], [-1.63, 1.37]]) {
    const y = ya + 1.53;
    strut(V3(Math.sign(x) * 1.25, y, Math.sign(z) * 0.95), V3(x, y, z), 0.05, M.silver);
    add(new THREE.BoxGeometry(0.3, 0.26, 0.3), M.silver, V3(x, y, z));
    add(new THREE.BoxGeometry(0.34, 0.06, 0.34), M.gold, V3(x, y + 0.13, z));
    for (const d of [V3(0, 1, 0), V3(0, -1, 0), V3(Math.sign(x), 0, 0), V3(0, 0, Math.sign(z))]) {
      const n = add(new THREE.CylinderGeometry(0.035, 0.07, 0.16, 10, 1, true), M.bell, V3(x, y, z).addScaledVector(d, 0.21)); n.quaternion.setFromUnitVectors(V3(0, -1, 0), d);
    }
    rcs.push({ x, y, z });
  }
  return { lm, M, rcs, hot };
}
