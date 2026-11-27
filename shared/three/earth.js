// Physics Sandbox — Earth seen from anywhere between the launch pad and high orbit.
// The planet, clouds and atmosphere are ray-cast per pixel in a full-screen pass, so the horizon,
// limb and sky colour are exact at every altitude (no polygon facets, no LOD popping):
//   · NASA Blue Marble / Black Marble imagery on the ground, ocean sun-glint, city lights at night
//   · single-scattering Rayleigh + Mie atmosphere (Chapman-function optical depths, planet shadow)
//   · a procedural cloud deck baked once on the GPU and drawn as a shell 6 km up (parallax from below/above)
//   · near-camera detail noise and ocean waves so low altitudes don't look like a stretched photo
// Numerics: the camera is the origin; the planet is described by the camera's altitude h and the local
// up vector, and ray–sphere hits use the cancellation-free form t = C / (b + √(b² − C)).
import * as THREE from 'three';

export const R_EARTH = 6371e3;
const HR = 8000, HM = 1200;
const BR = [5.8e-6, 13.5e-6, 33.1e-6], BM = 21e-6, BO = [.65e-6 * 1.9, 1.881e-6 * 1.9, .085e-6 * 1.9];

// Chapman grazing-incidence approximation (Schüler, GPU Pro 3). Returns ∫ρ/ρ0 ds / H along a ray to infinity.
function chapman(X, h, mu) {
  const c = Math.sqrt(X + h);
  if (mu >= 0) return c / (c * mu + 1) * Math.exp(-h);
  const x0 = Math.sqrt(1 - mu * mu) * (X + h), c0 = Math.sqrt(x0);
  return 2 * c0 * Math.exp(X - x0) - c / (1 - c * mu) * Math.exp(-h);
}
// Sunlight colour reaching altitude h when the sun is at cos-zenith mu (for DirectionalLight colour).
export function sunTransmittance(h, mu, out = new THREE.Color()) {
  const r = R_EARTH + h, muH = -Math.sqrt(Math.max(0, 1 - (R_EARTH * R_EARTH) / (r * r)));
  if (mu < muH - 0.01) return out.setRGB(0, 0, 0);
  const m = Math.max(mu, muH + 1e-4), odR = HR * chapman(R_EARTH / HR, Math.max(0, h) / HR, m), odM = HM * chapman(R_EARTH / HM, Math.max(0, h) / HM, m);
  const k = THREE.MathUtils.smoothstep(mu, muH - 0.01, muH + 0.01);
  return out.setRGB(Math.exp(-((BR[0] + BO[0]) * odR + BM * 1.1 * odM)) * k, Math.exp(-((BR[1] + BO[1]) * odR + BM * 1.1 * odM)) * k, Math.exp(-((BR[2] + BO[2]) * odR + BM * 1.1 * odM)) * k);
}
// US Standard Atmosphere 1976 (0–86 km, layered) + exponential tail; returns { rho, p, T, a }.
const US76 = [[0, 288.15, -0.0065, 101325], [11000, 216.65, 0, 22632.1], [20000, 216.65, 0.001, 5474.89], [32000, 228.65, 0.0028, 868.019], [47000, 270.65, 0, 110.906], [51000, 270.65, -0.0028, 66.9389], [71000, 214.65, -0.002, 3.95642], [86000, 186.87, 0, 0.3734]];
export function atmosphere(h) {
  const g0 = 9.80665, M = 0.0289644, Rg = 8.3144598;
  if (h < 0) h = 0;
  if (h > 86000) { const T = 186.87 + Math.min(800, (h - 86000) * 0.006), p = 0.3734 * Math.exp(-(h - 86000) / (Rg * T / (M * g0))); const rho = p * M / (Rg * T); return { rho, p, T, a: Math.sqrt(1.4 * 287.053 * T) }; }
  let L = US76[0]; for (const l of US76) if (h >= l[0]) L = l;
  const [hb, Tb, lr, pb] = L, T = Tb + lr * (h - hb);
  const p = lr === 0 ? pb * Math.exp(-g0 * M * (h - hb) / (Rg * Tb)) : pb * Math.pow(Tb / T, g0 * M / (Rg * lr));
  return { rho: p * M / (Rg * T), p, T, a: Math.sqrt(1.4 * 287.053 * T) };
}

const NOISE = `
float h31(vec3 p){ p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vn3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z); }
float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn2(vec2 x){ vec2 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1,0)), f.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), f.x), f.y); }
`;

// One-time GPU bake of an equirectangular cloud-cover map (seamless on the sphere).
function bakeClouds(renderer, w = 2048, h = 1024, seed = 3.7) {
  const rt = new THREE.WebGLRenderTarget(w, h, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping });
  const mat = new THREE.ShaderMaterial({
    uniforms: { seed: { value: seed } }, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: NOISE + `uniform float seed; varying vec2 vUv;
      float fbm(vec3 p){ float f = 0., a = .5; for (int i = 0; i < 7; i++){ f += a * vn3(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= .5; } return f; }
      void main(){
        float lon = vUv.x * 6.2831853 - 3.1415927, lat = (vUv.y - .5) * 3.1415927;
        vec3 p = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
        // large-scale circulation: ITCZ near the equator, clear subtropics, mid-latitude storm tracks
        float al = abs(lat);
        float band = .55 + .25 * exp(-pow(al / .09, 2.)) - .22 * exp(-pow((al - .42) / .12, 2.)) + .18 * exp(-pow((al - .95) / .2, 2.));
        vec3 q = p * 2.2 + seed; q += .55 * vec3(fbm(q + 4.), fbm(q + 9.), fbm(q + 13.));   // domain warp → swirls
        float f = fbm(q * 1.3);
        float fine = fbm(p * 26. + seed * 3.), mid = fbm(p * 7. + seed * 2.);
        float d = smoothstep(1. - band, 1. - band + .2, f + .22 * (mid - .5) + .12 * (fine - .5));
        d *= smoothstep(.25, .75, fine + .25 * d);
        gl_FragColor = vec4(clamp(d, 0., 1.), fine, 0., 1.);
      }`,
  });
  const scene = new THREE.Scene(), cam = new THREE.Camera();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false; scene.add(quad);
  const prev = renderer.getRenderTarget(), prevTM = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setRenderTarget(rt); renderer.render(scene, cam); renderer.setRenderTarget(prev);
  renderer.toneMapping = prevTM;
  mat.dispose(); quad.geometry.dispose();
  return rt.texture;
}

const VERT = `
uniform mat4 uInvProj; uniform mat3 uCamRot;
varying vec3 vDir;
void main(){
  vec4 v = uInvProj * vec4(position.xy, -1., 1.);   // near plane: far-plane unprojection loses precision
  vDir = uCamRot * (v.xyz / v.w);
  gl_Position = vec4(position.xy, 1., 1.);
}`;

const FRAG = NOISE + `
#define PI 3.14159265
uniform sampler2D dayMap, nightMap, cloudMap;
uniform float uHaze, uR, uH, uSunI, uCloudLon, uCloudH, uCloudAmt, uLogFC, uNight, uDetail, uTime, uStarFade, uAtmo;
uniform vec3 uUp, uSun, uCamFwd, uEast, uNorth;
uniform vec2 uLocal;
uniform mat3 uToEcef;
varying vec3 vDir;
const float HR = 8000., HM = 1200., TOP = 100000.;
const vec3 BR = vec3(5.8e-6, 13.5e-6, 33.1e-6);
const float BM = 21e-6;
const vec3 BO = vec3(.65e-6, 1.881e-6, .085e-6) * 1.9;   // ozone (Chappuis band), tied to the Rayleigh column

float chap(float X, float h, float mu){
  float c = sqrt(X + h);
  if (mu >= 0.) return c / (c * mu + 1.) * exp(-h);
  float x0 = sqrt(max(0., 1. - mu * mu)) * (X + h), c0 = sqrt(x0);
  return 2. * c0 * exp(X - x0) - c / (1. - c * mu) * exp(-h);
}
// optical depth (Rayleigh, Mie) from altitude h along cos-zenith mu to infinity
vec2 od(float h, float mu){ h = max(h, 0.); return vec2(HR * chap(uR / HR, h / HR, mu), HM * chap(uR / HM, h / HM, mu)); }
vec3 ext(vec2 o){ return exp(-((BR + BO) * o.x + BM * 1.1 * o.y)); }
// sunlight transmittance at altitude h for a local up vector n (0 inside the planet's shadow)
vec3 sunT(float h, vec3 n){
  float r = uR + max(h, 0.), mu = dot(n, uSun), muH = -sqrt(max(0., 1. - uR * uR / (r * r)));
  return ext(od(h, max(mu, muH + 1e-4))) * smoothstep(muH - .012, muH + .006, mu);
}
float phaseR(float m){ return .0596831 * (1. + m * m); }
float phaseM(float m){ const float g = .76, g2 = g * g; return .1193662 * ((1. - g2) * (1. + m * m)) / ((2. + g2) * pow(1. + g2 - 2. * g * m, 1.5)); }

// position along the ray relative to the planet: altitude and local up
void at(vec3 d, float t, float b, out float h, out vec3 n){
  float r2 = t * t - 2. * t * b + (uR + uH) * (uR + uH);
  float r = sqrt(max(r2, 0.)); h = r - uR;
  n = (t * d + (uR + uH) * uUp) / max(r, 1.);
}
vec2 sampleUV(vec3 e){
  float lon = atan(e.y, e.x), lat = asin(clamp(e.z, -1., 1.));
  return vec2(lon / (2. * PI) + .5, lat / PI + .5);
}
vec4 tex2(sampler2D s, vec2 uv){
  // seam-free lookup: pick derivatives from whichever u parameterisation is continuous here
  vec2 uv2 = vec2(fract(uv.x + .5), uv.y);
  vec2 dx = dFdx(uv), dy = dFdy(uv), dx2 = dFdx(uv2), dy2 = dFdy(uv2);
  if (abs(dx.x) + abs(dy.x) > abs(dx2.x) + abs(dy2.x)) { dx = dx2; dy = dy2; }
  return textureGrad(s, uv, dx, dy);
}
float fbm2(vec2 p){ float f = 0., a = .5; for (int i = 0; i < 5; i++){ f += a * vn2(p); p = p * 2.07 + 13.1; a *= .5; } return f; }

void main(){
  vec3 d = normalize(vDir);
  float b = -(uR + uH) * dot(d, uUp);              // = dot(d, centre)
  float C = uH * (2. * uR + uH);                   // = |centre|² − R²  (exact, from JS doubles)
  float disc = b * b - C;
  bool hit = b > 0. && disc > 0.;
  float tHit = hit ? C / (b + sqrt(disc)) : 1e20;

  // atmosphere segment to integrate
  float Ca = (uH - TOP) * (2. * uR + uH + TOP), discA = b * b - Ca;
  float t0 = 0., t1 = -1.;
  if (discA > 0. && (Ca < 0. || b > 0.)) { float s = sqrt(discA); t1 = b + s; t0 = Ca > 0. ? Ca / (b + s) : 0.; }   // shell behind the camera → no segment
  float tEnd = min(t1, tHit);

  // cloud shell (thin deck at uCloudH)
  float Cc = (uH - uCloudH) * (2. * uR + uH + uCloudH), discC = b * b - Cc, tC = -1.;
  if (discC > 0. && uCloudAmt > 0.) { float s = sqrt(discC); if (Cc > 0.) { if (b > 0.) tC = Cc / (b + s); } else tC = b + s; }
  if (tC > tHit) tC = -1.;

  float mu = dot(d, uSun);
  vec3 camN = uUp;
  // view transmittance: forward to infinity unless the ray meets the ground (then measure backwards)
  vec2 odCamF = od(uH, dot(camN, d)), odCamB = od(uH, dot(camN, -d));
  vec3 I = vec3(0.), Ib = vec3(0.);
  if (uAtmo > .5 && tEnd > t0) {
    float tLow = clamp(b, t0, tEnd);               // closest approach to the planet = densest air on this ray
    for (int seg = 0; seg < 2; seg++){
      float ta = seg == 0 ? t0 : tEnd, L = ta - tLow;
      if (abs(L) < 1.) continue;
      for (int i = 0; i < NS; i++){
        float u0 = float(i) / float(NS), u1 = float(i + 1) / float(NS), um = .5 * (u0 + u1);
        float t = tLow + L * um * um, dt = abs(L) * (u1 * u1 - u0 * u0);
        float h; vec3 n; at(d, t, b, h, n);
        if (h > TOP) continue;
        vec2 rho = exp(-max(h, 0.) / vec2(HR, HM));
        vec2 o = hit ? od(h, dot(n, -d)) - odCamB : odCamF - od(h, dot(n, d));
        vec3 tr = ext(max(o, 0.)) * sunT(h, n);
        vec3 s = (BR * rho.x * phaseR(mu) + BM * rho.y * phaseM(mu)) * tr * dt;
        I += s; if (tC > 0. && t < tC) Ib += s;
      }
    }
    I *= uSunI * uHaze; Ib *= uSunI * uHaze;
  }
  vec3 Tend = hit ? ext(max(od(0., dot(normalize(tHit * d + (uR + uH) * uUp), -d)) - odCamB, 0.)) : ext(odCamF);
  if (uAtmo < .5) Tend = vec3(1.);

  vec3 col = I; float alpha = 0., depth = 1.;
  if (hit) {
    vec3 n = normalize(tHit * d + (uR + uH) * uUp);
    vec3 e = uToEcef * n;
    vec2 uv = sampleUV(e);
    vec3 alb = tex2(dayMap, uv).rgb;
    float water = smoothstep(.02, -.01, alb.r - alb.b * .55) * (1. - smoothstep(.06, .16, alb.g));
    vec3 nn = n;
    if (uDetail > 0. && tHit < 40000.) {          // near-camera detail
      vec3 P = tHit * d;
      vec2 q = vec2(dot(P, uEast), dot(P, uNorth)) + uLocal;
      float w = uDetail * (1. - smoothstep(3000., 40000., tHit));
      float f = fbm2(q / 160.) * .6 + fbm2(q / 23.) * .4;
      alb *= mix(1., .62 + .78 * f, w * (1. - water));
      vec2 wq = q / 9. + uTime * vec2(.6, .25);
      vec2 g = vec2(vn2(wq + vec2(.1, 0.)) - vn2(wq - vec2(.1, 0.)), vn2(wq + vec2(0., .1)) - vn2(wq - vec2(0., .1)));
      nn = normalize(n + (uEast * g.x + uNorth * g.y) * .9 * w * water);
    }
    float ndl = dot(n, uSun);
    vec3 sun = sunT(0., n) * uSunI * .3183;            // Lambert: E·cosθ/π
    vec3 amb = vec3(.30, .48, .85) * uSunI * .015 * smoothstep(-.2, .35, ndl);
    vec3 surf = alb * 1.35 * (sun * max(dot(nn, uSun), 0.) + amb);
    vec3 V = -d, Hh = normalize(uSun + V);
    float spec = pow(max(dot(nn, Hh), 0.), mix(60., 900., smoothstep(30000., 500., tHit))) * water;
    surf += sun * spec * (.6 + .4 * pow(1. - max(dot(nn, V), 0.), 5.)) * 2.2;
    float night = 1. - smoothstep(-.12, .04, ndl);
    float cl = uCloudAmt > 0. ? tex2(cloudMap, sampleUV(vec3(cos(uCloudLon) * e.x - sin(uCloudLon) * e.y, sin(uCloudLon) * e.x + cos(uCloudLon) * e.y, e.z))).r * uCloudAmt : 0.;
    vec3 lights = tex2(nightMap, uv).rgb;
    surf += lights * lights * vec3(1.6, 1.2, .75) * 2.2 * uNight * night * (1. - .8 * cl);
    surf *= 1. - .45 * cl * smoothstep(-.1, .3, ndl);        // cloud shadow, approx.
    col = I + Tend * surf;
    float z = tHit * dot(d, uCamFwd);
    depth = log2(1. + max(z, 1e-3)) * uLogFC;
  } else {
    // sun disc
    col += Tend * uSunI * 2500. * smoothstep(.999985, .999993, mu);
    float lum = dot(I, vec3(.3, .5, .2));
    alpha = dot(Tend, vec3(.33)) * (1. - smoothstep(.004, .06, lum)) * uStarFade;
  }
  if (tC > 0.) {
    float h; vec3 n; at(d, tC, b, h, n);
    vec3 e = uToEcef * n;
    vec2 cu = sampleUV(vec3(cos(uCloudLon) * e.x - sin(uCloudLon) * e.y, sin(uCloudLon) * e.x + cos(uCloudLon) * e.y, e.z));
    vec2 cs = tex2(cloudMap, cu).rg;
    float a = smoothstep(.06, .75, cs.r * uCloudAmt);
    if (tC < 30000.) a *= smoothstep(30., 900., tC);       // don't pop when flying through the deck
    float below = step(uH, uCloudH);
    float ndl = dot(n, uSun);
    vec3 lit = sunT(uCloudH, n) * uSunI * .3183 * (mix(.45 + .35 * cs.g, .25 + .2 * cs.g, below) * max(ndl, 0.) + .05) + vec3(.35, .5, .8) * uSunI * .02 * smoothstep(-.2, .3, ndl);
    vec2 oc = hit ? od(h, dot(n, -d)) - odCamB : odCamF - od(h, dot(n, d));
    vec3 Tc = uAtmo > .5 ? ext(max(oc, 0.)) : vec3(1.);
    vec3 behind = col - Ib;
    col = Ib + Tc * lit * a + (1. - a) * behind;
    alpha *= 1. - a;
  }
  gl_FragColor = vec4(col, alpha);
  gl_FragDepth = depth;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class EarthView {
  constructor(renderer, { dayMap, nightMap, samples = 12, radius = R_EARTH, cloudAmount = 1, sunIntensity = 22, nightLights = 1, detail = 1 } = {}) {
    const fb = c => { const t = new THREE.DataTexture(new Uint8Array(c), 1, 1); t.needsUpdate = true; return t; };
    this.R = radius;
    this.cloudMap = bakeClouds(renderer);
    this.uniforms = {
      dayMap: { value: dayMap || fb([20, 50, 110, 255]) }, nightMap: { value: nightMap || fb([0, 0, 0, 255]) }, cloudMap: { value: this.cloudMap },
      uHaze: { value: 0.72 }, uR: { value: radius }, uH: { value: 400e3 }, uSunI: { value: sunIntensity }, uCloudLon: { value: 0 }, uCloudH: { value: 6000 }, uCloudAmt: { value: cloudAmount },
      uLogFC: { value: 1 }, uNight: { value: nightLights }, uDetail: { value: detail }, uTime: { value: 0 }, uStarFade: { value: 1 }, uAtmo: { value: 1 },
      uUp: { value: new THREE.Vector3(0, 1, 0) }, uSun: { value: new THREE.Vector3(1, 0, 0) }, uCamFwd: { value: new THREE.Vector3() },
      uEast: { value: new THREE.Vector3(1, 0, 0) }, uNorth: { value: new THREE.Vector3(0, 0, -1) }, uLocal: { value: new THREE.Vector2() },
      uToEcef: { value: new THREE.Matrix3() }, uInvProj: { value: new THREE.Matrix4() }, uCamRot: { value: new THREE.Matrix3() },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, defines: { NS: Math.max(4, Math.round(samples / 2)) },
      depthTest: false, depthWrite: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = -10;
    this._m = new THREE.Matrix4();
  }
  setSamples(n) { const ns = Math.max(4, Math.round(n / 2)); if (this.material.defines.NS !== ns) { this.material.defines.NS = ns; this.material.needsUpdate = true; } }
  // camToCentre: vector from the camera to Earth's centre in world axes (double precision JS numbers, metres)
  // toEcef: Matrix3 world→Earth-fixed (x: 0°E, y: 90°E, z: north pole); sunDir: world unit vector
  update(camera, camToCentre, toEcef, sunDir, { localEN = null, east = null, north = null, time = 0, cloudLon = 0 } = {}) {
    const u = this.uniforms, dist = camToCentre.length();
    u.uH.value = dist - this.R;
    u.uUp.value.copy(camToCentre).multiplyScalar(-1 / dist);
    u.uSun.value.copy(sunDir).normalize();
    u.uToEcef.value.copy(toEcef);
    camera.updateMatrixWorld();
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uCamRot.value.setFromMatrix4(camera.matrixWorld);
    u.uCamFwd.value.set(0, 0, -1).applyQuaternion(camera.quaternion);
    u.uLogFC.value = 1 / Math.log2(camera.far + 1);
    u.uTime.value = time; u.uCloudLon.value = cloudLon;
    if (east) u.uEast.value.copy(east); if (north) u.uNorth.value.copy(north);
    if (localEN) u.uLocal.value.set(localEN.x, localEN.y);
  }
  get altitude() { return this.uniforms.uH.value; }
}

// Rotation matrix ECI→ECEF for Earth rotation angle theta (radians), as a Matrix3.
export function eciToEcef(theta, out = new THREE.Matrix3()) {
  const c = Math.cos(theta), s = Math.sin(theta);
  return out.set(c, s, 0, -s, c, 0, 0, 0, 1);
}
export const OMEGA_EARTH = 7.2921159e-5;
export const MU_EARTH = 3.986004418e14;
