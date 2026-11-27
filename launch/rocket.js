// Two-stage kerosene/LOX launcher (Falcon 9-class proportions, 3.66 m core, 5.2 m fairing).
// Body axis +Y, origin at the first-stage engine exits. Returns groups for each separable part.
import * as THREE from 'three';
import { panelTexture } from '../shared/three/kit.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
export function buildRocket() {
  const R = 1.83;
  const paint = panelTexture({ cols: 6, rows: 12, base: '#eef0f1', line: 'rgba(60,66,72,.18)', rivets: false, noise: 0.025 });
  const tex = (rx, ry) => { const t = paint.clone(); t.needsUpdate = true; t.repeat.set(rx, ry); return t; };
  const M = {
    white: new THREE.MeshStandardMaterial({ map: tex(1, 3), roughness: 0.45, metalness: 0.05 }),
    white2: new THREE.MeshStandardMaterial({ map: tex(1, 1), roughness: 0.45, metalness: 0.05 }),
    black: new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.55, metalness: 0.2 }),
    soot: new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.8, metalness: 0.1 }),
    grey: new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.4, metalness: 0.8 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.5, metalness: 0.6 }),
    bell: new THREE.MeshStandardMaterial({ color: 0x2c2b2a, roughness: 0.45, metalness: 0.8, side: THREE.DoubleSide }),
    niobium: new THREE.MeshStandardMaterial({ color: 0x4a4744, roughness: 0.35, metalness: 0.9, side: THREE.DoubleSide, emissive: 0x000000 }),
    fin: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.9 }),
  };
  M.fairing = new THREE.MeshStandardMaterial({ map: tex(1, 1), roughness: 0.45, metalness: 0.05, side: THREE.DoubleSide });
  const add = (parent, geo, mat, pos, rot) => { const m = new THREE.Mesh(geo, mat); if (pos) m.position.copy(pos); if (rot) m.rotation.set(...rot); m.castShadow = m.receiveShadow = true; parent.add(m); return m; };
  const lathe = (pts, seg = 48) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);

  // ---- first stage ----
  const s1 = new THREE.Group();
  add(s1, new THREE.CylinderGeometry(R, R, 33.3, 48, 1, true), M.white, V3(0, 1.2 + 16.65, 0));
  add(s1, new THREE.CylinderGeometry(R, R, 6.7, 48, 1, true), M.black, V3(0, 34.5 + 3.35, 0));        // interstage
  add(s1, new THREE.CylinderGeometry(R * 1.005, R * 1.005, 4.5, 48, 1, true), M.soot, V3(0, 3.5, 0)); // sooty lower tank
  add(s1, new THREE.CircleGeometry(R, 48), M.dark, V3(0, 1.2, 0), [Math.PI / 2, 0, 0]);
  add(s1, lathe([[R, 1.2], [R * 1.03, 0.9], [R * 1.03, 0.5], [R * 0.98, 0.35]]), M.dark);            // octaweb skirt
  // nine engines (8 around + centre)
  const bellG = lathe([[0.22, 1.05], [0.26, 0.9], [0.36, 0.55], [0.46, 0.2], [0.5, 0.0]], 24);
  const e1 = [];
  for (let i = 0; i < 9; i++) {
    const a = i / 8 * 6.283, r = i === 8 ? 0 : 1.12;
    const b = add(s1, bellG, M.bell, V3(Math.cos(a) * r, -0.15, Math.sin(a) * r)); e1.push(b);
  }
  // folded landing legs, grid fins, raceway
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4, n = V3(Math.cos(a), 0, Math.sin(a));
    const leg = add(s1, new THREE.BoxGeometry(0.75, 9.5, 0.22), M.dark, n.clone().multiplyScalar(R + 0.1).add(V3(0, 5.9, 0)), [0, -a + Math.PI / 2, 0]);
    add(s1, new THREE.BoxGeometry(0.5, 0.6, 0.3), M.black, n.clone().multiplyScalar(R + 0.12).add(V3(0, 1.0, 0)), [0, -a + Math.PI / 2, 0]);
    const fin = add(s1, new THREE.BoxGeometry(1.2, 1.5, 0.12), M.fin, n.clone().multiplyScalar(R + 0.08).add(V3(0, 39.2, 0)), [0, -a + Math.PI / 2, 0]);
    fin.userData.fin = { n, a };
  }
  add(s1, new THREE.BoxGeometry(0.28, 32, 0.22), M.white2, V3(0, 18.5, R + 0.08));

  // ---- second stage ----
  const s2 = new THREE.Group();
  add(s2, new THREE.CylinderGeometry(R, R, 11.5, 48, 1, true), M.white, V3(0, 41.2 + 5.75, 0));
  add(s2, new THREE.CircleGeometry(R, 48), M.dark, V3(0, 41.2, 0), [Math.PI / 2, 0, 0]);
  add(s2, new THREE.CylinderGeometry(R * 1.01, R * 1.01, 0.3, 48, 1, true), M.black, V3(0, 52.6, 0));
  // vacuum engine: short regeneratively cooled bell + large radiatively cooled niobium extension (glows when hot)
  add(s2, lathe([[0.25, 41.2], [0.3, 40.9], [0.5, 40.3]], 24), M.bell);
  const mvac = add(s2, lathe([[0.5, 40.3], [0.85, 39.4], [1.2, 38.4], [1.55, 37.3]], 40), M.niobium);
  // ---- payload fairing (two halves) ----
  const fair = [];
  const ogive = [[0.06, 66.6], [0.7, 66.2], [1.4, 65.3], [2.0, 63.9], [2.45, 62.0], [2.6, 60.2], [2.6, 54.4], [2.3, 53.6], [R, 53.2]];
  for (const side of [0, 1]) {
    const g = new THREE.Group();
    const geo = new THREE.LatheGeometry(ogive.map(([r, y]) => new THREE.Vector2(r, y)), 32, side * Math.PI, Math.PI);
    add(g, geo, M.fairing);
    fair.push(g);
  }
  return { s1, s2, fair, M, e1, mvac };
}

// Launch pad: concrete apron, fixed service tower with crew arm, four lightning masts, water tower, flame trench.
export function buildPad() {
  const g = new THREE.Group();
  const M = {
    concrete: new THREE.MeshStandardMaterial({ color: 0x9a978f, roughness: 0.95 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x5d6166, roughness: 0.6, metalness: 0.6 }),
    red: new THREE.MeshStandardMaterial({ color: 0x8a3a2a, roughness: 0.7, metalness: 0.3 }),
    white: new THREE.MeshStandardMaterial({ color: 0xd8d8d4, roughness: 0.7 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.9 }),
  };
  const add = (geo, mat, pos, rot) => { const m = new THREE.Mesh(geo, mat); m.position.copy(pos); if (rot) m.rotation.set(...rot); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  add(new THREE.CylinderGeometry(70, 75, 3, 48), M.concrete, V3(0, -1.5, 0));
  add(new THREE.BoxGeometry(14, 3.2, 60), M.dark, V3(0, -1.55, 32));                 // flame trench
  add(new THREE.BoxGeometry(10, 4, 10), M.concrete, V3(0, -2.05 + 2, 0));            // launch mount
  // fixed service structure: lattice tower
  const tw = 6, th = 80, tx = 13;
  const beam = new THREE.BoxGeometry(1, 1, 1), mats = [];
  const put = (a, b, t) => { const d = b.clone().sub(a), L = d.length(); const m = new THREE.Matrix4(); m.compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.normalize()), V3(t, L, t)); mats.push(m); };
  const c = (i, y) => V3(tx + (i & 1 ? tw / 2 : -tw / 2), y, (i & 2 ? tw / 2 : -tw / 2));
  for (let i = 0; i < 4; i++) put(c(i, 0), c(i, th), 0.5);
  for (let y = 0; y < th; y += 6) for (const [a, b] of [[0, 1], [1, 3], [3, 2], [2, 0]]) { put(c(a, y), c(b, y), 0.25); put(c(a, y), c(b, y + 6), 0.18); }
  const im = new THREE.InstancedMesh(beam, M.red, mats.length); mats.forEach((m, i) => im.setMatrixAt(i, m)); im.castShadow = true; g.add(im);
  add(new THREE.BoxGeometry(tw + 1, 3, tw + 1), M.white, V3(tx, th + 1.5, 0));
  add(new THREE.CylinderGeometry(0.3, 0.3, 30, 8), M.steel, V3(tx, th + 18, 0));
  add(new THREE.BoxGeometry(9, 1.6, 1.6), M.steel, V3(tx - 6, 62, 0));               // crew access arm (retracted toward the vehicle)
  for (const [x, z] of [[-90, -90], [90, -90], [-90, 90], [90, 90]]) add(new THREE.CylinderGeometry(0.5, 1.2, 110, 8), M.steel, V3(x, 55, z));
  add(new THREE.CylinderGeometry(6, 6, 9, 24), M.white, V3(-160, 60, 120)); add(new THREE.CylinderGeometry(1, 1, 56, 8), M.steel, V3(-160, 28, 120));
  for (const [x, z, s] of [[60, -140, 14], [-120, -60, 9], [140, 80, 11]]) add(new THREE.BoxGeometry(s * 2, s, s * 1.4), M.white, V3(x, s / 2, z));
  return g;
}
