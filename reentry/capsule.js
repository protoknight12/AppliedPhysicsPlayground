// Crew capsule (5 m heat shield, 20° backshell), plasma sheath and wake, parachutes, recovery ship.
// Capsule axis +Y points from the heat shield to the apex.
import * as THREE from 'three';
import { panelTexture, foilNormalMap } from '../shared/three/kit.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
export function buildCapsule() {
  const g = new THREE.Group();
  const tiles = panelTexture({ cols: 24, rows: 6, base: '#d9dcdf', line: 'rgba(40,44,50,.25)', rivets: false, noise: 0.04 });
  tiles.repeat.set(1, 1);
  const foil = foilNormalMap(256, 5); foil.repeat.set(4, 2);
  const M = {
    back: new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.55, metalness: 0.15 }),
    char: new THREE.MeshStandardMaterial({ color: 0x2c2420, roughness: 0.95, metalness: 0 }),
    shield: new THREE.MeshStandardMaterial({ color: 0x3a2e26, roughness: 0.9, metalness: 0, emissive: 0x000000 }),
    tape: new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.25, metalness: 0.9, normalMap: foil, normalScale: new THREE.Vector2(0.4, 0.4) }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.6, metalness: 0.3 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x030405, roughness: 0.04, metalness: 0.95 }),
  };
  const add = (geo, mat, pos, rot) => { const m = new THREE.Mesh(geo, mat); if (pos) m.position.copy(pos); if (rot) m.rotation.set(...rot); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  const L = pts => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 64);
  // heat shield: spherical segment (radius 6 m), toroidal shoulder
  const sh = []; for (let i = 0; i <= 12; i++) { const a = i / 12 * Math.asin(2.45 / 6); sh.push([6 * Math.sin(a), -6 * (1 - Math.cos(a)) - 0.0]); }
  sh.push([2.5, -0.38], [2.52, -0.25], [2.48, -0.12]);
  add(L(sh.map(([r, y]) => [r, y + 0.0])), M.shield);
  // backshell: 32.5° cone with a tape band, tunnel, windows, RCS ports
  add(L([[2.48, -0.12], [2.42, 0.05], [1.05, 2.25], [0.95, 2.35]]), M.back);
  add(L([[2.47, -0.1], [2.43, 0.02], [2.41, 0.06]]), M.tape);
  add(L([[0.95, 2.35], [0.82, 2.38], [0.8, 2.75], [0.62, 2.8], [0, 2.82]]), M.back);
  add(L([[1.9, 0.86], [1.88, 0.9], [1.84, 0.96]]), M.dark);
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4, w = add(new THREE.CircleGeometry(0.17, 20), M.glass); const r = 1.55; w.position.set(Math.cos(a) * r, 1.3, Math.sin(a) * r); w.lookAt(Math.cos(a) * 5, 1.3 + 5 * 0.62, Math.sin(a) * 5); }
  for (let i = 0; i < 6; i++) { const a = i / 6 * 6.283, p = add(new THREE.BoxGeometry(0.22, 0.22, 0.05), M.dark); const r = 1.25; p.position.set(Math.cos(a) * r, 1.95, Math.sin(a) * r); p.lookAt(Math.cos(a) * 5, 1.95 + 3, Math.sin(a) * 5); }
  const parts = { shield: M.shield, M };
  return { g, M, parts };
}

// Plasma sheath in front of the heat shield and the luminous wake behind it (additive, driven by heat flux).
export function buildPlasma() {
  const sheathG = new THREE.SphereGeometry(3.3, 48, 16, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45);
  const sheath = new THREE.Mesh(sheathG, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uI: { value: 0 }, uT: { value: 0 }, uC: { value: new THREE.Color(1, 0.45, 0.25) } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: `uniform float uI, uT; uniform vec3 uC; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
      void main(){ float f = pow(1. - abs(dot(vN, vV)), 1.6); float n = .75 + .25 * sin(vP.x * 4. + uT * 23.) * sin(vP.z * 5. - uT * 19.);
        float edge = smoothstep(-1.8, -3.2, vP.y);
        vec3 c = mix(uC, vec3(1., .92, .85), edge * .6);
        float a = uI * (.25 + f) * n * (.4 + edge);
        gl_FragColor = vec4(c * a, 1.); }`,
  }));
  sheath.position.y = 1.2; sheath.frustumCulled = false;
  const wakeG = new THREE.CylinderGeometry(0.4, 3.0, 1, 40, 30, true); wakeG.translate(0, 0.5, 0);
  const wake = new THREE.Mesh(wakeG, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uI: { value: 0 }, uT: { value: 0 }, uC: { value: new THREE.Color(1, 0.45, 0.25) } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; varying float vY; varying float vA; void main(){ vY = position.y; vA = atan(position.z, position.x); vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: `uniform float uI, uT; uniform vec3 uC; varying vec3 vN; varying vec3 vV; varying float vY; varying float vA;
      void main(){ float rim = pow(abs(dot(vN, vV)), 1.2); float streak = .6 + .4 * sin(vA * 9. + vY * 7. - uT * 30.) * sin(vA * 23. - uT * 11.);
        float fall = pow(1. - vY, 1.8); vec3 c = mix(vec3(1., .85, .7), uC, smoothstep(0., .3, vY));
        float a = uI * rim * fall * streak * .8; gl_FragColor = vec4(c * a, 1.); }`,
  }));
  wake.frustumCulled = false;
  return { sheath, wake };
}

// Parachute canopy: ring-sail look via a striped texture on a shallow dome, with suspension lines.
function stripeTex() {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 64; const c = cv.getContext('2d');
  for (let i = 0; i < 16; i++) { c.fillStyle = i % 2 ? '#f2f2ee' : '#e8622c'; c.fillRect(i * 32, 0, 32, 64); }
  c.fillStyle = 'rgba(0,0,0,.25)'; for (let y = 8; y < 64; y += 12) c.fillRect(0, y, 512, 2);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function buildChute(radius, lines = 14, length = radius * 1.6) {
  const g = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), new THREE.MeshStandardMaterial({ map: stripeTex(), side: THREE.DoubleSide, roughness: 0.85 }));
  dome.position.y = length; dome.castShadow = true; g.add(dome);
  const rim = radius * Math.sin(Math.PI * 0.42), ry = length + radius * Math.cos(Math.PI * 0.42);
  const pts = []; for (let i = 0; i < lines; i++) { const a = i / lines * 6.283; pts.push(V3(0, 0, 0), V3(Math.cos(a) * rim, ry, Math.sin(a) * rim)); }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xcfcfcf, transparent: true, opacity: 0.6 })));
  g.userData.dome = dome;
  return g;
}

export function buildShip() {
  const g = new THREE.Group();
  const grey = new THREE.MeshStandardMaterial({ color: 0x6b7178, roughness: 0.6, metalness: 0.3 }), white = new THREE.MeshStandardMaterial({ color: 0xd8dadc, roughness: 0.6 });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(14, 6, 110), grey); hull.position.y = 1; g.add(hull);
  const bow = new THREE.Mesh(new THREE.ConeGeometry(7, 22, 4, 1), grey); bow.rotation.set(-Math.PI / 2, Math.PI / 4, 0); bow.scale.set(1, 1, 0.43); bow.position.set(0, 1, -66); g.add(bow);
  const sup = new THREE.Mesh(new THREE.BoxGeometry(12, 12, 22), white); sup.position.set(0, 10, -20); g.add(sup);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 16, 8), white); mast.position.set(0, 24, -20); g.add(mast);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(13.6, 0.4, 40), new THREE.MeshStandardMaterial({ color: 0x3d4247, roughness: 0.9 })); deck.position.set(0, 4.2, 30); g.add(deck);
  g.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  return g;
}
