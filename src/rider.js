// Vector-art toolkit shared with view.js (palette, HDR neon colours, one-draw fill+stroke meshes, ribbons)
// and the rider: a seated neon-vector character whose every sled / glider / booster tier is baked into ONE
// skinned mesh (bones = 2D affine uniforms, tiers toggled per vertex group), plus a scarf and booster flame.
import * as THREE from 'three';

export const TN = {
  bg: '#1a1b26', bg_dark: '#16161e', bg_dark1: '#0c0e14', bg_highlight: '#292e42', storm: '#24283b', terminal_black: '#414868',
  fg: '#c0caf5', fg_dark: '#a9b1d6', fg_gutter: '#3b4261', comment: '#565f89', dark5: '#737aa2',
  blue: '#7aa2f7', blue0: '#3d59a1', blue1: '#2ac3de', blue2: '#0db9d7', blue5: '#89ddff', blue6: '#b4f9f8', blue7: '#394b70',
  cyan: '#7dcfff', teal: '#1abc9c', green: '#9ece6a', green1: '#73daca', magenta: '#bb9af7', magenta2: '#ff007c',
  purple: '#9d7cd8', orange: '#ff9e64', yellow: '#e0af68', red: '#f7768e', red1: '#db4b4b',
};
export const C = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);
// HDR colour with a target luminance: > 1 blooms (threshold 1), < 1 never does; same glow for every hue.
export const neon = (hex, lum = 2) => { const c = new THREE.Color(hex); return c.multiplyScalar(lum / (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b)); };

// Per-frame uniforms shared by every material. uPxK = world metres per CSS pixel per metre of view depth.
export const U = { uTime: { value: 0 }, uPxK: { value: 1e-3 } };

// Premultiplied blending: alpha 1 = opaque fill, alpha 0 = pure additive glow, in the same draw.
export const PREMUL = {
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
};

// Neon tube profile for strokes: white-hot HDR core (blooms) → saturated band (keeps the hue on screen) → halo.
export const TUBE = `
vec3 tube(vec3 col, float d, float aa, float core) {
  float m = max(max(col.r, col.g), max(col.b, 1e-4)); vec3 sat = col / m * min(m, 1.);
  float c = 1. - smoothstep(core * .5 - aa, core * .5 + aa, d), b = 1. - smoothstep(core - aa, core + aa, d);
  return col * c + sat * (.92 * (b - c) + .42 * (1. - d) * (1. - d) * (1. - b));
}`;

// ------------------------------------------------------------------ one-draw vector art

const VEC_VS = `
attribute vec3 nrm; attribute vec4 col; attribute vec3 kw;
#ifdef SKIN
attribute vec2 bv; uniform mat3 uBones[NB]; uniform vec4 uSel;
#endif
uniform float uPxK, uTime;
varying vec4 vCol; varying vec2 vS;
void main() {
  vec2 p = position.xy, n = nrm.xy;
  vCol = col; vS = vec2(nrm.z, kw.x);
#ifdef SKIN
  float g = floor(bv.y / 8. + .01);
  if (abs(uSel[int(g)] - (bv.y - g * 8.)) > .5) { gl_Position = vec4(0., 0., -2., 1.); return; }
  mat3 m = uBones[int(bv.x + .5)];
  p = (m * vec3(p, 1.)).xy;
  if (kw.x > .5) n = normalize(mat2(m) * n + 1e-6) * length(n);
#endif
  if (kw.z > .5) vCol.rgb *= kw.z < 1.5 ? step(.5, fract(uTime * .8 + position.x * .7))
    : kw.z < 2.5 ? .25 + .75 * pow(max(.5 + .5 * sin(position.x * 1.4 - uTime * 8.), 0.), 3.)
    : .7 + .3 * sin(uTime * 2.3 + position.x * .9 + position.y);
  vec4 mv = modelViewMatrix * vec4(p, position.z, 1.);
  if (kw.x > .5 && kw.x < 1.5) {
    float w = max(kw.y, .65 * -mv.z * uPxK / length(modelMatrix[0].xyz));
    mv = modelViewMatrix * vec4(p + n * nrm.z * 3. * w, position.z, 1.);
  }
  gl_Position = projectionMatrix * mv;
}`;
const VEC_FS = `
uniform float uSoft; varying vec4 vCol; varying vec2 vS;
${TUBE}
void main() {
  vec3 c = vCol.rgb;
  c = mix(c, c / max(max(c.r, c.g), max(c.b, 1.)), uSoft); // far zoom: no HDR, so a tiny figure doesn't bloom into a blob
  if (vS.y < .5) { gl_FragColor = vec4(c * vCol.a, vCol.a); return; }
  if (vS.y > 1.5) { gl_FragColor = vec4(c * vCol.a * (1. - .7 * uSoft), 0.); return; }
  float d = abs(vS.x);
  gl_FragColor = vec4(tube(c * vCol.a, d + uSoft * .45 * step(.34, d), fwidth(d) * .75, .34), 0.);
}`;

export function vecMaterial({ bones, sel, depthTest = true } = {}) {
  const uniforms = { uPxK: U.uPxK, uTime: U.uTime, uSoft: { value: 0 } };
  if (bones) Object.assign(uniforms, { uBones: { value: bones }, uSel: { value: sel } });
  return new THREE.ShaderMaterial({
    ...PREMUL, depthTest, uniforms, vertexShader: VEC_VS, fragmentShader: VEC_FS,
    defines: bones ? { SKIN: 1, NB: bones.length } : {},
  });
}

// Accumulates fills (kind 0), neon strokes (kind 1) and additive gradient glows (kind 2) into one geometry.
// Draw order inside the mesh = call order, so later shapes cover earlier ones (painter's algorithm).
export class Art {
  constructor(skin = false) { Object.assign(this, { skin, P: [], N: [], Cl: [], K: [], B: [], I: [], z: 0, bone: 0, vis: 0 }); }
  get count() { return this.P.length / 3; }
  v(x, y, nx, ny, s, c, a, kind, w, anim) {
    this.P.push(x, y, this.z); this.N.push(nx, ny, s); this.Cl.push(c.r, c.g, c.b, a); this.K.push(kind, w, anim);
    if (this.skin) this.B.push(this.bone, this.vis);
  }
  fill(pts, c, a = 1) {
    const base = this.count, v = [];
    for (let i = 0; i < pts.length; i += 2) { v.push(new THREE.Vector2(pts[i], pts[i + 1])); this.v(pts[i], pts[i + 1], 0, 0, 0, c, a, 0, 0, 0); }
    for (const t of THREE.ShapeUtils.triangulateShape(v, [])) this.I.push(base + t[0], base + t[1], base + t[2]);
    return this;
  }
  // neon stroke; w = half-width of the hot core in metres (never thinner than ~1.3 px on screen)
  line(pts, c, w, closed = false, a = 1, anim = 0) {
    const n = pts.length / 2, base = this.count;
    for (let i = 0; i < n; i++) {
      const ip = closed ? (i - 1 + n) % n : Math.max(i - 1, 0), iq = closed ? (i + 1) % n : Math.min(i + 1, n - 1);
      let ax = pts[i * 2] - pts[ip * 2], ay = pts[i * 2 + 1] - pts[ip * 2 + 1], bx = pts[iq * 2] - pts[i * 2], by = pts[iq * 2 + 1] - pts[i * 2 + 1];
      let la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if (!la) { ax = bx; ay = by; la = lb; } else if (!lb) { bx = ax; by = ay; lb = la; }
      ax /= la; ay /= la; bx /= lb; by /= lb;
      let tx = ax + bx, ty = ay + by; const lt = Math.hypot(tx, ty) || 1; tx /= lt; ty /= lt;
      const m = 1 / Math.max(0.55, tx * ax + ty * ay); // miter
      for (const s of [-1, 1]) this.v(pts[i * 2], pts[i * 2 + 1], -ty * m, tx * m, s, c, a, 1, w, anim);
    }
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const p = base + i * 2, q = base + ((i + 1) % n) * 2;
      this.I.push(p, q, p + 1, p + 1, q, q + 1);
    }
    return this;
  }
  shape(pts, fc, lc, w = 0.012, fa = 1) { return this.fill(pts, fc, fa).line(pts, lc, w, true); }
  // additive gradient triangles: pts = [x,y, ...] (multiple of 3 points), cols = one Color per point
  glow(pts, cols, a = 1, anim = 0) {
    const base = this.count;
    for (let i = 0; i < pts.length / 2; i++) { this.v(pts[i * 2], pts[i * 2 + 1], 0, 0, 0, cols[i], a, 2, 0, anim); this.I.push(base + i); }
    return this;
  }
  dot(x, y, r, c, a = 1, anim = 0) { // soft round light: bright centre, fading fan
    const k = 12, z = new THREE.Color(0, 0, 0), pts = [], cols = [];
    for (let i = 0; i < k; i++) {
      const a0 = (i / k) * Math.PI * 2, a1 = ((i + 1) / k) * Math.PI * 2;
      pts.push(x, y, x + Math.cos(a0) * r, y + Math.sin(a0) * r, x + Math.cos(a1) * r, y + Math.sin(a1) * r);
      cols.push(c, z, z);
    }
    return this.glow(pts, cols, a, anim);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('nrm', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('col', new THREE.Float32BufferAttribute(this.Cl, 4));
    g.setAttribute('kw', new THREE.Float32BufferAttribute(this.K, 3));
    if (this.skin) g.setAttribute('bv', new THREE.Float32BufferAttribute(this.B, 2));
    return g.setIndex(this.I);
  }
}

// shape helpers (flat [x,y,...] arrays)
const TAU = Math.PI * 2;
export function arc(cx, cy, rx, ry, a0, a1, n) {
  const o = [];
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; o.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry); }
  return o;
}
const circle = (cx, cy, r, n = 18) => arc(cx, cy, r, r, 0, TAU * (1 - 1 / n), n - 1);
export function rrect(x0, y0, x1, y1, r) {
  return [...arc(x1 - r, y0 + r, r, r, -Math.PI / 2, 0, 3), ...arc(x1 - r, y1 - r, r, r, 0, Math.PI / 2, 3),
    ...arc(x0 + r, y1 - r, r, r, Math.PI / 2, Math.PI, 3), ...arc(x0 + r, y0 + r, r, r, Math.PI, 1.5 * Math.PI, 3)];
}
// closed outline of a thick centre-line (tapering half-width w0 → w1, round caps)
function limb(path, w0, w1 = w0) {
  const n = path.length / 2, L = [], R = [];
  const dir = i => { const a = Math.max(i - 1, 0), b = Math.min(i + 1, n - 1); const x = path[b * 2] - path[a * 2], y = path[b * 2 + 1] - path[a * 2 + 1], l = Math.hypot(x, y); return [x / l, y / l]; };
  for (let i = 0; i < n; i++) {
    const [tx, ty] = dir(i), w = w0 + ((w1 - w0) * i) / (n - 1);
    L.push(path[i * 2] - ty * w, path[i * 2 + 1] + tx * w); R.unshift(path[i * 2] + ty * w, path[i * 2 + 1] - tx * w);
  }
  const [ex, ey] = dir(n - 1), [sx, sy] = dir(0), ae = Math.atan2(ey, ex), as = Math.atan2(sy, sx);
  const cap = (x, y, w, a) => arc(x, y, w, w, a + Math.PI / 2 - Math.PI / 5, a - Math.PI / 2 + Math.PI / 5, 3);
  return [...L, ...cap(path[n * 2 - 2], path[n * 2 - 1], w1, ae), ...R, ...cap(path[0], path[1], w0, as + Math.PI)];
}
function xf(pts, ang, dx = 0, dy = 0, sx = 1, sy = sx) {
  const c = Math.cos(ang), s = Math.sin(ang), o = [];
  for (let i = 0; i < pts.length; i += 2) { const x = pts[i] * sx, y = pts[i + 1] * sy; o.push(x * c - y * s + dx, x * s + y * c + dy); }
  return o;
}

// ------------------------------------------------------------------ dynamic ribbon (trail, scarf)

const RIB_VS = `
attribute vec3 nrm; attribute vec2 aux; uniform float uPxK; varying float vS, vU;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.);
  float w = max(aux.x, 1.4 * -mv.z * uPxK);
  vS = nrm.z; vU = aux.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy + nrm.xy * nrm.z * w * step(.0001, aux.x), position.z, 1.);
}`;
const RIB_FS = `
uniform vec3 uC0, uC1; uniform float uCore, uOpaque, uFade; varying float vS, vU;
${TUBE}
void main() {
  float d = abs(vS), aa = fwidth(d) * .75;
  float f = mix(1., pow(max(1. - vU, 0.), 1.5), uFade), body = (1. - smoothstep(uCore - aa, uCore + aa, d)) * uOpaque;
  vec3 c = mix(uC0, uC1, vU) * f;
  gl_FragColor = vec4(body > 0. ? c * body + tube(c, d, aa, uCore) * (1. - body) : tube(c, d, aa, uCore), body * f);
}`;
export const ribbonMaterial = (c0, c1, core, opaque = 0, fade = 1) => new THREE.ShaderMaterial({
  ...PREMUL, depthTest: false, vertexShader: RIB_VS, fragmentShader: RIB_FS,
  uniforms: { uPxK: U.uPxK, uC0: { value: c0 }, uC1: { value: c1 }, uCore: { value: core }, uOpaque: { value: opaque }, uFade: { value: fade } },
});

export class Ribbon {
  constructor(n, mat, z = 0) {
    this.n = n; this.z = z;
    this.pts = new Float32Array(n * 4); // x, y, half-width, u
    const g = new THREE.BufferGeometry(), idx = [];
    for (let i = 0; i < n - 1; i++) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    const attr = (k) => new THREE.BufferAttribute(new Float32Array(n * 2 * k), k).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', (this.pos = attr(3))).setAttribute('nrm', (this.nrm = attr(3))).setAttribute('aux', (this.aux = attr(2))).setIndex(idx);
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
  }
  commit(count = this.n) { // write the first `count` points as a strip
    const p = this.pts, P = this.pos.array, N = this.nrm.array, A = this.aux.array;
    for (let i = 0; i < count; i++) {
      const a = Math.max(i - 1, 0) * 4, b = Math.min(i + 1, count - 1) * 4;
      let tx = p[b] - p[a], ty = p[b + 1] - p[a + 1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      for (let s = 0; s < 2; s++) {
        const o = (i * 2 + s) * 3;
        P[o] = p[i * 4]; P[o + 1] = p[i * 4 + 1]; P[o + 2] = this.z;
        N[o] = -ty; N[o + 1] = tx; N[o + 2] = s * 2 - 1;
        A[(i * 2 + s) * 2] = p[i * 4 + 2]; A[(i * 2 + s) * 2 + 1] = p[i * 4 + 3];
      }
    }
    this.pos.needsUpdate = this.nrm.needsUpdate = this.aux.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, Math.max(0, count - 1) * 6);
  }
}

// ------------------------------------------------------------------ rider art

const BONE = { ROOT: 0, LEGS: 1, TORSO: 2, HEAD: 3, ARM: 4, GLIDER: 5, BOOST: 6 }, NB = 7;
const SEAT = [0.13, 0.17, 0.12, 0.3, 0.24, 0.37];                 // hip height per sled tier
const MOUNT = [[-0.72, 0.2], [-0.62, 0.17], [-0.7, 0.08], [-0.66, 0.27], [-0.7, 0.2], [-0.68, 0.3]]; // booster mount
const ART = 1.15; // hero scale: reads better at the in-run zoom
const HIP_X = -0.12, NECK = [0.02, 0.53], SHOULDER = [0.0, 0.44], HAND = [0.35, -0.19];
// gliders: arm angle when deployed, hand-held (attached at the hand) or on the torso, open angle, stowed pose
const GL = [null,
  { arm: 2.0, hand: 1, a: 0.3, stow: [-0.17, 0.03, 0.4, 0.13, 0.75] },   // wagasa umbrella
  { arm: 1.1, hand: 1, a: 0.0, stow: [-0.24, 0.2, 0.2, 0.3, 0.3] },      // tako kite
  { arm: 1.55, hand: 1, a: -0.06, stow: [-0.2, 0.3, -1.35, 0.42, 0.12] }, // neon hang glider
  { arm: 2.95, at: [0, 0], a: 0, stow: [0, 0.44, 0, 0.02, 0.02] },       // night wingsuit (hidden when stowed)
  { arm: 0.45, at: [-0.1, 0.42], a: 0, stow: [-0.1, 0.42, 0.55, 0.42, 0.45] }, // dragon wings
];
// booster flame per tier: nozzle (booster space), length, width, core/mid/tip colours, shock diamonds
const FL = [null,
  { at: [-0.2, 0.09], len: 0.75, w: 0.24, c: [neon(TN.yellow, 3.5), neon(TN.orange, 1.8), neon(TN.red1, 0.8)], dia: 0, spark: neon(TN.yellow, 2.4) },
  { at: [-0.34, 0.06], len: 1.15, w: 0.22, c: [neon(TN.blue6, 3.8), neon(TN.blue, 1.8), neon(TN.orange, 0.9)], dia: 0, spark: neon(TN.orange, 2.2) },
  { at: [-0.2, 0.06], len: 1.6, w: 0.27, c: [neon(TN.blue6, 4), neon(TN.cyan, 2), neon(TN.blue0, 1)], dia: 1, spark: neon(TN.cyan, 2.4) },
  { at: [-0.36, 0.05], len: 2.0, w: 0.42, c: [neon(TN.yellow, 3.2), neon(TN.red, 1.5), neon(TN.purple, 0.8)], dia: 0, spark: neon(TN.orange, 2.2) },
];

function buildArt() {
  const a = new Art(true);
  const on = (bone, group = 0, tier = 0) => { a.bone = bone; a.vis = group * 8 + tier; return a; };
  const INK = C(TN.bg_highlight), W = 0.012;
  const jacket = C(TN.purple, 0.5), jacketL = neon(TN.magenta, 0.85), pink = C(TN.magenta2, 0.6), pinkL = neon(TN.magenta2, 0.75);

  // --- gliders behind the body
  on(BONE.GLIDER, 2, 5); dragonWing(a, 0.55, true);
  on(BONE.GLIDER, 2, 1); // wagasa: shaft from the hand, canopy above
  {
    const edge = [-0.82, 0.98, -0.6, 1.0, -0.4, 0.97, -0.2, 1.0, 0, 0.97, 0.2, 1.0, 0.4, 0.97, 0.6, 1.0, 0.82, 0.98];
    const dome = arc(0, 0.98, 0.82, 0.34, 0.05, Math.PI - 0.05, 12);
    a.line([0, -0.05, 0, 1.3], neon(TN.orange, 0.9), 0.012);
    for (let i = 0; i < edge.length; i += 4) a.line([0, 0.72, edge[i], edge[i + 1]], neon(TN.yellow, 0.6), 0.006);
    a.shape([...dome, ...edge], C(TN.red1, 0.45), neon(TN.orange, 1.8), 0.016, 0.92);
    for (let i = 1; i < 6; i++) { const t = Math.PI * (i / 6); a.line([0, 1.32, Math.cos(t) * 0.8, 0.99 + Math.sin(t) * 0.02], neon(TN.yellow, 1.0), 0.005); }
    a.shape(circle(0, 1.33, 0.05, 10), C(TN.yellow, 0.4), neon(TN.yellow, 2), 0.008);
    a.shape(rrect(-0.03, -0.12, 0.03, 0.08, 0.02), C(TN.orange, 0.15), neon(TN.orange, 1.2), 0.007);
  }
  on(BONE.GLIDER, 2, 2); // tako kite: lines from the hand to a painted kite behind and above
  {
    const k = xf([-0.5, -0.62, 0.5, -0.62, 0.5, 0.62, -0.5, 0.62], 0.35, -0.85, 1.35);
    a.line([0, 0, k[0], k[1]], neon(TN.fg, 0.8), 0.004).line([0, 0, k[6], k[7]], neon(TN.fg, 0.8), 0.004);
    a.line(xf([-0.3, -0.6, -0.55, -0.95, -0.35, -1.25, -0.6, -1.6], 0.35, -0.85, 1.35), neon(TN.magenta2, 1.6), 0.012);
    a.line(xf([0.2, -0.6, 0.05, -1.0, 0.25, -1.3, 0.0, -1.7], 0.35, -0.85, 1.35), neon(TN.cyan, 1.6), 0.012);
    a.shape(k, C(TN.fg, 0.55), neon(TN.red1, 1.8), 0.016, 0.95);
    a.line([k[0], k[1], k[4], k[5]], C(TN.orange, 0.35), 0.006).line([k[2], k[3], k[6], k[7]], C(TN.orange, 0.35), 0.006);
    a.shape(xf(circle(0, 0.05, 0.3, 16), 0.35, -0.85, 1.35), C(TN.red1, 0.7), neon(TN.red1, 1.4), 0.01);
    a.line(xf([-0.22, 0.12, -0.05, -0.06, 0.08, 0.12, 0.22, -0.04], 0.35, -0.85, 1.35), neon(TN.fg, 2.2), 0.018);
  }
  on(BONE.GLIDER, 2, 3); // neon hang glider: thin sail profile + A-frame down to the hands
  {
    const top = [0.85, 1.14, 0.4, 1.3, -0.2, 1.4, -0.9, 1.36, -1.7, 1.06];
    const bot = [-0.9, 1.14, -0.2, 1.12, 0.4, 1.1];
    a.line([-0.05, 0.02, -0.12, 1.1], neon(TN.fg, 1.2), 0.009).line([0.14, 0.02, -0.12, 1.1], neon(TN.fg, 1.2), 0.009);
    a.line([-0.1, 0.02, 0.2, 0.02], neon(TN.fg, 1.4), 0.012);
    a.fill([...top, ...bot], C(TN.purple, 0.28), 0.85);
    a.line(top, neon(TN.cyan, 3), 0.016).line([-1.7, 1.06, ...bot], neon(TN.magenta2, 2), 0.012);
    for (let i = 0; i < 4; i++) a.line([0.3 - i * 0.5, 1.11, 0.25 - i * 0.5, 1.3 - i * 0.02], neon(TN.purple, 1.4), 0.006);
    a.dot(0.85, 1.14, 0.09, neon(TN.blue6, 3)).dot(-1.7, 1.06, 0.08, neon(TN.magenta2, 3), 1, 1);
  }

  // --- booster (behind the sled)
  on(BONE.BOOST, 3, 1); // hanabi: two paper rockets
  for (const [dx, dy] of [[0, 0], [0.06, 0.1]]) {
    const b = [-0.18 + dx, dy, 0.3 + dx, dy, 0.42 + dx, dy + 0.045, 0.3 + dx, dy + 0.09, -0.18 + dx, dy + 0.09];
    a.fill(b, C(TN.red1, 0.5));
    for (let i = 0; i < 3; i++) a.fill([-0.12 + dx + i * 0.16, dy, -0.05 + dx + i * 0.16, dy, -0.05 + dx + i * 0.16, dy + 0.09, -0.12 + dx + i * 0.16, dy + 0.09], C(TN.yellow, 0.5));
    a.line(b, neon(TN.yellow, 1.5), W, true).line([-0.18 + dx, dy + 0.045, -0.25 + dx, dy + 0.07], neon(TN.orange, 1.2), 0.006);
  }
  on(BONE.BOOST, 3, 2); // turbo canister
  a.shape(rrect(-0.22, -0.02, 0.3, 0.15, 0.07), C(TN.blue7, 0.8), neon(TN.fg, 1.5), W);
  a.shape([-0.22, 0.03, -0.34, -0.005, -0.34, 0.125, -0.22, 0.09], C(TN.bg_highlight), neon(TN.blue5, 1.6), W);
  a.line([0.05, -0.02, 0.05, 0.15], neon(TN.blue1, 2), 0.012).shape(circle(0.18, 0.065, 0.04, 10), INK, neon(TN.orange, 1.8), 0.006);
  on(BONE.BOOST, 3, 3); // plasma thruster
  a.shape(rrect(-0.14, -0.03, 0.36, 0.15, 0.08), C(TN.bg_highlight), neon(TN.blue, 1.5), W);
  for (let i = 0; i < 3; i++) a.line(arc(0.02 + i * 0.1, 0.06, 0.025, 0.095, -Math.PI / 2, Math.PI / 2, 6), neon(TN.cyan, 2.2), 0.008, false, 1, 3);
  a.shape(arc(-0.15, 0.06, 0.045, 0.1, 0, TAU * 0.95, 12), C(TN.blue6, 0.6), neon(TN.blue6, 3.2), 0.01);
  on(BONE.BOOST, 3, 4); // dragon's breath: a little dragon head breathing backwards
  {
    const up = [0.28, 0.04, 0.2, 0.16, 0.02, 0.19, -0.16, 0.14, -0.36, 0.1, -0.3, 0.06, -0.1, 0.07, 0.05, 0.03];
    const lo = [0.22, 0.02, 0.0, -0.02, -0.2, -0.04, -0.32, 0.0, -0.14, 0.03, 0.05, 0.04];
    a.shape(lo, C(TN.teal, 0.3), neon(TN.green1, 1.6), W).shape(up, C(TN.teal, 0.35), neon(TN.green1, 1.8), W);
    a.line([0.12, 0.17, 0.3, 0.3, 0.42, 0.28], neon(TN.yellow, 1.6), 0.01).line([0.02, 0.19, 0.12, 0.34], neon(TN.yellow, 1.4), 0.009);
    a.line([-0.3, 0.09, -0.42, 0.2, -0.5, 0.16], neon(TN.cyan, 1.5), 0.005).dot(-0.02, 0.13, 0.04, neon(TN.yellow, 5));
  }

  // --- sleds (all but the box sit under the rider)
  on(BONE.ROOT, 1, 1); // plastic saucer
  a.shape([-0.58, 0.14, -0.52, 0.05, -0.32, 0.005, 0.32, 0.005, 0.52, 0.05, 0.58, 0.14, 0.5, 0.175, -0.5, 0.175], C(TN.red1, 0.35), neon(TN.red, 1.6), W);
  a.line([-0.3, 0.14, 0.35, 0.14], neon(TN.fg, 1.2), 0.008);
  on(BONE.ROOT, 1, 2); // bamboo toboggan with a curled nose
  {
    const path = [-0.72, 0.04, 0.3, 0.04, ...arc(0.33, 0.2, 0.16, 0.16, -Math.PI / 2 + 0.2, Math.PI * 0.62, 8)];
    a.shape(limb(path, 0.036), C(TN.green, 0.22), neon(TN.green, 1.4), W);
    for (let x = -0.6; x < 0.3; x += 0.22) a.line([x, 0.012, x, 0.068], neon(TN.yellow, 1.0), 0.005);
  }
  on(BONE.ROOT, 1, 3); // steel runner sled
  {
    for (const x of [-0.45, -0.05, 0.3]) a.line([x, 0.03, x + 0.03, 0.2], neon(TN.blue5, 1.2), 0.008);
    a.shape(limb([-0.64, 0.02, 0.5, 0.02, 0.63, 0.06, 0.68, 0.14, 0.62, 0.23, 0.48, 0.24], 0.016), C(TN.blue6, 0.35), neon(TN.blue6, 2.2), 0.007);
    a.shape(rrect(-0.6, 0.19, 0.48, 0.27, 0.025), C(TN.orange, 0.2), neon(TN.orange, 1.1), W);
  }
  on(BONE.ROOT, 1, 4); // carbon luge
  a.line([-0.6, 0.012, 0.55, 0.012, 0.7, 0.07], neon(TN.blue6, 2.2), 0.009);
  a.shape([-0.73, 0.06, 0.5, 0.045, 0.8, 0.1, 0.52, 0.2, -0.55, 0.22, -0.75, 0.14], C(TN.bg_dark1), neon(TN.blue, 1.8), W);
  a.line([-0.62, 0.13, 0.62, 0.115], neon(TN.magenta, 2.2), 0.01);
  on(BONE.ROOT, 1, 5); // maglev board: hover field + emitter strip
  a.glow([-0.5, 0.19, 0.5, 0.19, 0.64, 0.0, -0.5, 0.19, 0.64, 0.0, -0.64, 0.0],
    [neon(TN.cyan, 0.3), neon(TN.cyan, 0.3), C(0), neon(TN.cyan, 0.3), C(0), C(0)], 1, 3);
  a.shape([-0.66, 0.2, 0.55, 0.2, 0.74, 0.25, 0.55, 0.3, -0.62, 0.3, -0.7, 0.25], C(TN.bg_dark1), neon(TN.magenta, 2), W);
  a.line([-0.5, 0.19, 0.5, 0.19], neon(TN.cyan, 2.2), 0.012).line([0.1, 0.25, 0.2, 0.25, 0.3, 0.25], neon(TN.magenta2, 2.5), 0.01, false, 1, 2);

  // --- body: legs, torso, head, (wingsuit), arm
  on(BONE.LEGS);
  a.shape(limb([0.0, 0.03, 0.2, 0.12, 0.37, 0.15, 0.47, 0.08, 0.55, 0.01], 0.085, 0.06), C(TN.blue0, 0.75), neon(TN.blue, 0.85), W);
  a.shape(rrect(0.49, -0.055, 0.74, 0.07, 0.045), C(TN.fg, 0.55), neon(TN.fg, 0.9), W).line([0.5, -0.05, 0.72, -0.05], neon(TN.cyan, 1.4), 0.008);
  on(BONE.TORSO);
  a.shape([-0.12, -0.01, -0.16, 0.14, -0.155, 0.32, -0.115, 0.46, -0.04, 0.53, 0.06, 0.53, 0.135, 0.46, 0.165, 0.3, 0.155, 0.12, 0.1, 0.0], jacket, jacketL, W);
  a.line([-0.15, 0.3, 0.162, 0.31], neon(TN.cyan, 1.2), 0.012).line([0.145, 0.43, 0.15, 0.06], neon(TN.magenta, 0.5), 0.005);
  a.shape(rrect(-0.08, 0.455, 0.115, 0.565, 0.045), pink, pinkL, W);
  on(BONE.HEAD);
  {
    const hc = [0.035, 0.165], br = 0.15;
    a.shape(circle(hc[0], hc[1], 0.135, 22), C(TN.blue7, 0.9), neon(TN.fg, 0.85), W);
    const bean = arc(hc[0], hc[1], br, br, -0.12, Math.PI + 0.3, 14);
    a.shape(circle(hc[0] - 0.075, hc[1] + 0.16, 0.055, 10), C(TN.fg, 0.85), neon(TN.fg, 1.0), 0.008);
    a.shape(bean, pink, pinkL, W).line([bean[0], bean[1] + 0.02, bean[bean.length - 2], bean[bean.length - 1] + 0.02], C(TN.fg, 0.8), 0.016);
    a.shape(rrect(0.07, 0.12, 0.21, 0.205, 0.035), neon(TN.cyan, 0.95), neon(TN.blue6, 0.8), 0.01);
    a.line([0.1, 0.19, 0.16, 0.135], neon(TN.fg, 2), 0.006);
  }
  on(BONE.GLIDER, 2, 4); // wingsuit: swept membrane from the raised arm back down to the hip (torso space)
  {
    const lead = [0.02, 0.46, -0.3, 0.69, -0.82, 0.62], trail = [-0.68, 0.46, -0.62, 0.28, -0.46, 0.14, -0.36, 0.0, -0.14, -0.02];
    a.shape([...lead, ...trail, -0.16, 0.3], C(TN.purple, 0.45), neon(TN.magenta, 0.9), W, 0.85);
    a.line(lead, neon(TN.magenta2, 0.9), 0.016).line([-0.82, 0.62, ...trail], neon(TN.cyan, 0.9), 0.01);
    for (let i = 0; i < 3; i++) a.line([-0.1 - i * 0.12, 0.52 + i * 0.05, -0.44 - i * 0.1, 0.06 + i * 0.14], neon(TN.purple, 0.7), 0.006);
    for (const [x, y] of [[-0.82, 0.62], [-0.62, 0.28], [-0.36, 0.0]]) a.dot(x, y, 0.05, neon(TN.cyan, 2));
  }
  on(BONE.ARM);
  a.shape(limb([0, 0, 0.08, -0.09, 0.16, -0.15, 0.25, -0.18, 0.33, -0.19], 0.066, 0.05), jacket, jacketL, W);
  a.shape(circle(0.35, -0.19, 0.058, 12), pink, pinkL, W);
  a.line([0.27, -0.14, 0.28, -0.24], neon(TN.cyan, 1.6), 0.008);

  // --- in front: cardboard box sled, near dragon wing
  on(BONE.ROOT, 1, 0);
  a.shape([-0.44, 0.44, -0.66, 0.6, -0.7, 0.55, -0.48, 0.42], C(TN.orange, 0.3), neon(TN.yellow, 0.6), W);
  a.shape([0.4, 0.44, 0.62, 0.56, 0.58, 0.61, 0.38, 0.46], C(TN.orange, 0.3), neon(TN.yellow, 0.6), W);
  a.shape([-0.48, 0.02, 0.42, 0.02, 0.44, 0.45, -0.5, 0.45], C(TN.orange, 0.36), neon(TN.yellow, 0.7), W);
  a.fill([-0.48, 0.2, 0.43, 0.2, 0.43, 0.27, -0.48, 0.27], C(TN.yellow, 0.55));
  a.line([0.1, 0.33, 0.14, 0.4, 0.18, 0.33], neon(TN.fg, 0.9), 0.006).line([0.14, 0.4, 0.14, 0.31], neon(TN.fg, 0.9), 0.006);
  on(BONE.GLIDER, 2, 5); dragonWing(a, 1, false);
  return a;
}

function dragonWing(a, k, far) { // bat-like wing trailing back from the shoulder blades
  const R = pts => xf(pts, far ? 0.18 : 0, far ? 0.05 : 0, far ? 0.04 : 0, far ? 0.9 : 1);
  const w = [-0.38, 0.62], tips = [[-1.6, 0.78], [-1.5, 0.28], [-1.1, -0.08], [-0.6, -0.2]];
  const mem = [0, 0, ...w];
  tips.forEach(([x, y], i) => {
    mem.push(x, y);
    const n = tips[i + 1] ?? [0, -0.05];
    mem.push((x + n[0]) / 2 + 0.1, (y + n[1]) / 2 + 0.07);
  });
  a.shape(R(mem), C(TN.teal, 0.14 * k), neon(TN.green1, 2.3 * k), 0.012, 0.85);
  for (const [x, y] of tips) a.line(R([...w, x, y]), neon(TN.blue6, 1.4 * k), 0.007);
  a.line(R([0, 0, ...w, -0.3, 0.72]), neon(TN.green1, 1.8 * k), 0.012);
}

// ------------------------------------------------------------------ rider object

const FLAME_FS = `
uniform vec3 uC0, uC1, uC2; uniform float uTime, uOn, uDia; varying vec2 vUv;
void main() {
  float u = 1. - vUv.x, v = vUv.y * 2. - 1.;
  float w = (.18 + .82 * pow(clamp(1. - u, 0., 1.), .7)) * (1. + .14 * sin(uTime * 61. + u * 17.) + .08 * sin(uTime * 37. - u * 9.));
  float r = abs(v) / w, body = smoothstep(1., .25, r) * smoothstep(1., .7, u) * smoothstep(0., .04, u);
  float core = smoothstep(.55, 0., r) * (1. - smoothstep(.1, .75, u));
  vec3 c = mix(mix(uC1, uC2, smoothstep(.15, .95, u)), uC0, core);
  c *= 1. + uDia * .9 * smoothstep(.55, 1., cos(u * 38. - uTime * 25.)) * (1. - u);
  gl_FragColor = vec4(c * body * uOn, 0.);
}`;

export function createRider() {
  const bones = Array.from({ length: NB }, () => new THREE.Matrix3());
  const sel = new THREE.Vector4(0, 0, -1, 0);
  const body = new THREE.Mesh(buildArt().geometry(), vecMaterial({ bones, sel, depthTest: false })), uSoft = body.material.uniforms.uSoft;
  body.frustumCulled = false; body.renderOrder = 17;

  const flameU = { uTime: U.uTime, uOn: { value: 0 }, uDia: { value: 0 }, uC0: { value: new THREE.Color() }, uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() } };
  const flame = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(-0.5, 0, 0), new THREE.ShaderMaterial({
    ...PREMUL, depthTest: false, uniforms: flameU, fragmentShader: FLAME_FS,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
  }));
  flame.frustumCulled = false; flame.renderOrder = 18; flame.matrixAutoUpdate = false; flame.visible = false;

  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  group.add(body, flame);

  const SN = 12, scarf = new Ribbon(SN, ribbonMaterial(neon(TN.magenta2, 0.55), neon(TN.magenta2, 0.4), 0.62, 1, 0), 0.05);
  scarf.mesh.renderOrder = 16;
  const SP = scarf.pts;

  const tmp = new THREE.Matrix3(), open = new THREE.Matrix3(), stow = new THREE.Matrix3(), v3 = new THREE.Vector3();
  const aff = (m, tx, ty, ang, sx = 1, sy = sx) => {
    const c = Math.cos(ang), s = Math.sin(ang), e = m.elements;
    e[0] = c * sx; e[1] = s * sx; e[2] = 0; e[3] = -s * sy; e[4] = c * sy; e[5] = 0; e[6] = tx; e[7] = ty; e[8] = 1;
    return m;
  };
  const chain = (out, parent, tx, ty, ang, sx, sy) => out.multiplyMatrices(parent, aff(tmp, tx, ty, ang, sx, sy));
  const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

  const st = { sled: 0, glider: 0, booster: 0, open: 0, tumble: 0, spin: 0, squash: 0, flame: 0, crashed: false,
    torso: 0.12, head: 0, arm: 0, legs: 0, scarfInit: false };
  const world = { x: 0, y: 0, nozzleA: 0, flame: 0, tier: 0, spark: null }; // booster nozzle in world space, for sparks
  const W2 = { a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0 }; // current rider-local → world affine

  function setLoadout(l) {
    st.sled = l.sled | 0; st.glider = l.glider | 0; st.booster = l.booster | 0;
    sel.set(0, st.sled, st.glider ? st.glider : -1, st.booster);
    const f = FL[st.booster];
    if (f) { flameU.uC0.value.copy(f.c[0]); flameU.uC1.value.copy(f.c[1]); flameU.uC2.value.copy(f.c[2]); flameU.uDia.value = f.dia; }
    world.tier = st.booster;
  }

  function reset() { st.tumble = st.spin = st.squash = st.open = st.flame = 0; st.crashed = false; st.scarfInit = false; }
  const kick = (v) => { st.squash = v; }; // + stretch, − squash
  function crash(speed) { st.spin = (Math.random() < 0.5 ? -1 : 1) * Math.min(14, 4 + speed * 0.35); }

  function update(dt, r, s, t) {
    uSoft.value = Math.min(1, Math.max(0, (s - 1.15) / 1.5));
    s *= ART;
    const air = !r.ground, sp = r.speed, g = GL[st.glider];
    // --- tumble (crash): spin around the body centre, settle upright once slow
    if (r.crashed) {
      if (!st.crashed) { st.crashed = true; if (!st.spin) crash(sp); }
      if (sp > 1.5 || air) st.tumble += st.spin * dt * Math.min(1, sp / 8 + (air ? 0.6 : 0));
      else st.tumble = damp(st.tumble, Math.round(st.tumble / (Math.PI * 2)) * Math.PI * 2, 3, dt);
    } else if (st.crashed) reset();
    // --- pose targets
    const tuck = r.tuck && !air, glide = st.open > 0.5 && g;
    const steep = air ? 0 : Math.max(0, -r.a); // seated on a steep drop: lean back against it
    let torso = 0.12 + 0.5 * steep + 0.025 * Math.sin(t * 1.7), head = -0.06 - 0.3 * steep, arm = 0.02 + 0.03 * Math.sin(t * 1.7 + 1), legs = 0;
    if (tuck) { torso = -0.62; head = 0.42; arm = 0.42; legs = 0.12; }
    else if (glide) { torso = 0.02; head = 0.05; arm = g.arm; }
    else if (air) { torso = 0.02; head = 0; arm = 0.95 + 0.1 * Math.sin(t * 7); }
    if (r.crashed && (sp > 1.5 || air)) { torso = 0.3 * Math.sin(t * 8); arm = 1 + 1.1 * Math.sin(t * 11); head = 0.3 * Math.sin(t * 9); legs = 0.2 * Math.sin(t * 10); }
    else if (r.crashed) { torso = -0.3; head = 0.3; arm = -0.2; }
    const k = r.crashed ? 18 : 11;
    st.torso = damp(st.torso, torso, k, dt); st.head = damp(st.head, head, k, dt); st.arm = damp(st.arm, arm, k, dt); st.legs = damp(st.legs, legs, k, dt);
    // --- glider open/close (quick pop with overshoot)
    st.open = Math.min(1, Math.max(0, st.open + (r.glide && g ? dt / 0.2 : -dt / 0.16)));
    st.squash = damp(st.squash, 0, 9, dt);

    // --- bones
    const seat = SEAT[st.sled], hover = st.sled === 5 ? 0.018 * Math.sin(t * 6.5) : 0;
    const sq = st.squash, root = aff(bones[BONE.ROOT], 0, hover, 0, 1 - sq * 0.5, 1 + sq);
    chain(bones[BONE.LEGS], root, HIP_X, seat, st.legs);
    chain(bones[BONE.TORSO], root, HIP_X, seat, st.torso);
    chain(bones[BONE.HEAD], bones[BONE.TORSO], NECK[0], NECK[1], st.head - st.torso * 0.3);
    chain(bones[BONE.ARM], bones[BONE.TORSO], SHOULDER[0], SHOULDER[1], st.arm);
    const m = MOUNT[st.sled], jit = r.boosting ? 0.012 * Math.sin(t * 90) : 0;
    chain(bones[BONE.BOOST], root, m[0], m[1] + jit, 0);
    if (g) {
      const o = st.open, e = o < 1 ? 1 + 2.2 * (o - 1) ** 3 + 1.2 * (o - 1) ** 2 : 1; // easeOutBack
      const w = g.stow;
      chain(stow, bones[BONE.TORSO], w[0], w[1], w[2], w[3], w[4]);
      if (g.hand) {
        const ca = Math.cos(st.arm), sa = Math.sin(st.arm);
        const hx = SHOULDER[0] + HAND[0] * ca - HAND[1] * sa, hy = SHOULDER[1] + HAND[0] * sa + HAND[1] * ca;
        chain(open, bones[BONE.TORSO], hx, hy, g.a + (st.glider === 1 ? 0.06 * Math.sin(t * 5) : 0), 1);
      } else {
        const flap = st.glider === 5 ? 0.16 * Math.sin(t * (sp > 30 ? 3 : 5)) : 0;
        chain(open, bones[BONE.TORSO], g.at[0], g.at[1], g.a + flap, 1);
      }
      const gb = bones[BONE.GLIDER].elements, E0 = stow.elements, E1 = open.elements;
      for (let i = 0; i < 9; i++) gb[i] = E0[i] + (E1[i] - E0[i]) * e;
      sel.z = st.glider === 4 && o < 0.02 ? -1 : st.glider;
    }

    // --- group transform: T(x,y) R(a) S(s), tumbling about the body centre (0, pc)
    const pc = 0.55, th = r.a, al = r.a + st.tumble, ca = Math.cos(al) * s, sa = Math.sin(al) * s;
    const tx = r.x + s * pc * (-Math.sin(th) + Math.sin(al)), ty = r.y + s * pc * (Math.cos(th) - Math.cos(al));
    W2.a = W2.d = ca; W2.b = sa; W2.c = -sa; W2.tx = tx; W2.ty = ty;
    group.matrix.set(ca, -sa, 0, tx, sa, ca, 0, ty, 0, 0, s, 0, 0, 0, 0, 1);
    group.matrixWorldNeedsUpdate = true;

    // --- booster flame
    const f = FL[st.booster];
    st.flame = damp(st.flame, r.boosting && f ? 1 : 0, r.boosting ? 30 : 14, dt);
    flame.visible = st.flame > 0.01;
    if (f) {
      v3.set(f.at[0], f.at[1], 1).applyMatrix3(bones[BONE.BOOST]);
      const len = f.len * st.flame * (1 + 0.15 * Math.sin(t * 50) + 0.1 * Math.sin(t * 83)), w = f.w * (0.6 + 0.4 * st.flame);
      flame.matrix.set(len, 0, 0, v3.x, 0, w, 0, v3.y, 0, 0, 1, 0.01, 0, 0, 0, 1);
      flame.matrixWorldNeedsUpdate = true;
      flameU.uOn.value = st.flame;
      const px = v3.x - len * 0.3;
      world.x = W2.a * px + W2.c * v3.y + W2.tx; world.y = W2.b * px + W2.d * v3.y + W2.ty;
      world.nozzleA = al + Math.PI; world.flame = st.flame; world.spark = f.spark;
    } else world.flame = 0;

    // --- scarf: follow-the-leader chain streaming against the airflow
    v3.set(0.0, 0.5, 1).applyMatrix3(bones[BONE.TORSO]);
    const nx = W2.a * v3.x + W2.c * v3.y + W2.tx, ny = W2.b * v3.x + W2.d * v3.y + W2.ty;
    const seg = 0.075 * s, wk = Math.min(1, sp / 6);
    let dx = -r.vx / (sp || 1) * wk + 0.35 * (1 - wk) * -Math.cos(al), dy = -r.vy / (sp || 1) * wk - (1 - wk);
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    if (!st.scarfInit) { for (let i = 0; i < SN; i++) { SP[i * 4] = nx + dx * seg * i; SP[i * 4 + 1] = ny + dy * seg * i; } st.scarfInit = true; }
    SP[0] = nx; SP[1] = ny;
    const amp = seg * (0.25 + Math.min(1.2, sp / 20)), kf = 1 - Math.exp(-dt * 30);
    for (let i = 1; i < SN; i++) {
      const o = i * 4, fl = Math.sin(t * (9 + sp * 0.35) - i * 0.9) * amp * (i / SN);
      const txp = SP[o - 4] + dx * seg - dy * fl, typ = SP[o - 3] + dy * seg + dx * fl;
      SP[o] += (txp - SP[o]) * kf; SP[o + 1] += (typ - SP[o + 1]) * kf;
      const ex = SP[o] - SP[o - 4], ey = SP[o + 1] - SP[o - 3], el = Math.hypot(ex, ey) || 1;
      SP[o] = SP[o - 4] + (ex / el) * seg; SP[o + 1] = SP[o - 3] + (ey / el) * seg;
      SP[o + 2] = s * (0.055 - 0.03 * (i / SN)); SP[o + 3] = i / (SN - 1);
    }
    SP[2] = s * 0.055; SP[3] = 0;
    scarf.commit();
  }

  return { group, scarf: scarf.mesh, setLoadout, update, reset, kick, crash, world, get sled() { return st.sled; } };
}
