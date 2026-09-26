// Vector-art toolkit shared with view.js (palette, HDR neon colours, one-draw fill+stroke meshes, ribbons)
// and the rider: a seated vector character whose every ride / glider / booster tier is baked into ONE skinned
// mesh (bones = 2D affine uniforms, tiers toggled per vertex group), plus streamers (tie, barbels, carp
// streamer) and the booster flame. Group 0 is the body: its tiers are outfit stages, a salaryman's slow,
// disguised turn into a koi (items.js DRIFT) before the Dragon Gate makes him a dragon.
import * as THREE from 'three';
import { stage } from './items.js';

export const TN = {
  bg: '#1a1b26', bg_dark: '#16161e', bg_dark1: '#0c0e14', bg_highlight: '#292e42', storm: '#24283b', terminal_black: '#414868',
  fg: '#c0caf5', fg_dark: '#a9b1d6', fg_gutter: '#3b4261', comment: '#565f89', dark5: '#737aa2',
  blue: '#7aa2f7', blue0: '#3d59a1', blue1: '#2ac3de', blue2: '#0db9d7', blue5: '#89ddff', blue6: '#b4f9f8', blue7: '#394b70',
  cyan: '#7dcfff', teal: '#1abc9c', green: '#9ece6a', green1: '#73daca', magenta: '#bb9af7', magenta2: '#ff007c',
  purple: '#9d7cd8', orange: '#ff9e64', yellow: '#e0af68', red: '#f7768e', red1: '#db4b4b',
};
export const C = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);
const INK = C(TN.bg_dark1); // outline colour of the rider's ink style
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
  // bv.y = group·16 + tier + 64·until: group 0 shows each outfit piece from its stage until a later stage replaces
  // it (until 0 = never); the other groups show one tier (the owned ride / glider / booster)
  float un = floor(bv.y / 64. + .01), r = bv.y - un * 64., g = floor(r / 16. + .01), tr = r - g * 16.;
  if (g < .5 ? tr > uSel.x + .5 || (un > .5 && uSel.x > un - .5) : abs(uSel[int(g)] - tr) > .5) { gl_Position = vec4(0., 0., -2., 1.); return; }
  mat3 m = uBones[int(bv.x + .5)];
  p = (m * vec3(p, 1.)).xy;
  if (kw.x > .5) n = normalize(mat2(m) * n + 1e-6) * length(n);
#endif
  if (kw.z > .5) vCol.rgb *= kw.z < 1.5 ? step(.5, fract(uTime * .8 + position.x * .7))
    : kw.z < 2.5 ? .25 + .75 * pow(max(.5 + .5 * sin(position.x * 1.4 - uTime * 8.), 0.), 3.)
    : .7 + .3 * sin(uTime * 2.3 + position.x * .9 + position.y);
  vec4 mv = modelViewMatrix * vec4(p, position.z, 1.);
  if (kw.x > .5 && (kw.x < 1.5 || kw.x > 2.5)) { // neon strokes spread 3× for their halo; ink strokes are just their width
    float ink = step(2.5, kw.x), w = max(kw.y, mix(.65, .75, ink) * -mv.z * uPxK / length(modelMatrix[0].xyz));
    mv = modelViewMatrix * vec4(p + n * nrm.z * (3. - 2. * ink) * w, position.z, 1.);
  }
  gl_Position = projectionMatrix * mv;
}`;
const VEC_FS = `
uniform float uAlpha; varying vec4 vCol; varying vec2 vS;
${TUBE}
void main() {
  vec3 c = vCol.rgb;
  float d = abs(vS.x);
  if (vS.y < .5) gl_FragColor = vec4(c * vCol.a, vCol.a);                                  // fill
  else if (vS.y > 2.5) { float a = (1. - smoothstep(1. - 1.5 * fwidth(d), 1., d)) * vCol.a; gl_FragColor = vec4(c * a, a); } // ink
  else if (vS.y > 1.5) gl_FragColor = vec4(c * vCol.a, 0.);                                // additive glow
  else gl_FragColor = vec4(tube(c * vCol.a, d, fwidth(d) * .75, .34), 0.);                  // neon
  gl_FragColor *= uAlpha;
}`;

export function vecMaterial({ bones, sel, depthTest = true } = {}) {
  const uniforms = { uPxK: U.uPxK, uTime: U.uTime, uAlpha: { value: 1 } };
  if (bones) Object.assign(uniforms, { uBones: { value: bones }, uSel: { value: sel } });
  return new THREE.ShaderMaterial({
    ...PREMUL, depthTest, uniforms, vertexShader: VEC_VS, fragmentShader: VEC_FS,
    defines: bones ? { SKIN: 1, NB: bones.length } : {},
  });
}

// Accumulates fills (kind 0), neon strokes (kind 1), additive gradient glows (kind 2) and opaque ink strokes (kind 3)
// into one geometry.
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
  // neon stroke; w = half-width of the hot core in metres (never thinner than ~1.3 px on screen). kind 3 = ink
  line(pts, c, w, closed = false, a = 1, anim = 0, kind = 1) {
    const n = pts.length / 2, base = this.count;
    for (let i = 0; i < n; i++) {
      const ip = closed ? (i - 1 + n) % n : Math.max(i - 1, 0), iq = closed ? (i + 1) % n : Math.min(i + 1, n - 1);
      let ax = pts[i * 2] - pts[ip * 2], ay = pts[i * 2 + 1] - pts[ip * 2 + 1], bx = pts[iq * 2] - pts[i * 2], by = pts[iq * 2 + 1] - pts[i * 2 + 1];
      let la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if (!la) { ax = bx; ay = by; la = lb; } else if (!lb) { bx = ax; by = ay; lb = la; }
      ax /= la; ay /= la; bx /= lb; by /= lb;
      let tx = ax + bx, ty = ay + by; const lt = Math.hypot(tx, ty) || 1; tx /= lt; ty /= lt;
      const m = 1 / Math.max(0.55, tx * ax + ty * ay); // miter
      for (const s of [-1, 1]) this.v(pts[i * 2], pts[i * 2 + 1], -ty * m, tx * m, s, c, a, kind, w, anim);
    }
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const p = base + i * 2, q = base + ((i + 1) % n) * 2;
      this.I.push(p, q, p + 1, p + 1, q, q + 1);
    }
    return this;
  }
  shape(pts, fc, lc, w = 0.012, fa = 1) { return this.fill(pts, fc, fa).line(pts, lc, w, true); }
  // opaque, anti-aliased line that never glows (half-width w, at least ~0.75 px): outlines and dark details
  ink(pts, c, w = 0.012, closed = false, a = 1) { return this.line(pts, c, w, closed, a, 0, 3); }
  // flat fill with an ink outline: the rider's readable style (fills stay under the bloom threshold)
  inked(pts, fc, w = 0.013, fa = 1, ic = INK) { return this.fill(pts, fc, fa).ink(pts, ic, w, true); }
  haze(pts, c, a = 1, anim = 0) { // additive fill of a polygon: soft light, never darkens
    const v = [], t = [], cols = [];
    for (let i = 0; i < pts.length; i += 2) v.push(new THREE.Vector2(pts[i], pts[i + 1]));
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(v, [])) { t.push(pts[i * 2], pts[i * 2 + 1], pts[j * 2], pts[j * 2 + 1], pts[k * 2], pts[k * 2 + 1]); cols.push(c, c, c); }
    return this.glow(t, cols, a, anim);
  }
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

// ------------------------------------------------------------------ dynamic ribbon (trail, tie)

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

// The tie: a salaryman's striped red tie that, purchase by purchase, turns kohaku, grows scales and splits into a
// butterfly-koi tail with a gold frill and pulses racing to the tip (it was never a tie). u runs knot → tip, v across
// (v < 0 is the top edge while it streams back from a rider going right). uTail widens the strip to leave room for
// the frill; uLen is its length in rider units, so the patterns keep their size as it grows.
const tieMaterial = () => new THREE.ShaderMaterial({
  ...PREMUL, depthTest: false, vertexShader: RIB_VS,
  uniforms: { uPxK: U.uPxK, uTime: U.uTime, uKoi: { value: 0 }, uScale: { value: 0 }, uTail: { value: 0 }, uLen: { value: 0.5 }, uAlpha: { value: 1 },
    uRed: { value: C(TN.red1, 0.95) }, uWhite: { value: C('#eef0fb', 0.92) }, uNavy: { value: C(TN.blue7, 0.75) },
    uGold: { value: C(TN.yellow, 0.95) }, uOrange: { value: C(TN.orange, 0.9) }, uInk: { value: INK } },
  fragmentShader: `uniform vec3 uRed, uWhite, uNavy, uGold, uOrange, uInk; uniform float uTime, uKoi, uScale, uTail, uLen, uAlpha; varying float vS, vU;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f *= f * (3. - 2. * f);
    return mix(mix(h21(i), h21(i + vec2(1., 0.)), f.x), mix(h21(i + vec2(0., 1.)), h21(i + vec2(1., 1.)), f.x), f.y); }
  void main() {
    float u = vU, b = 1. / (1. + .9 * uTail), v = vS / b, av = abs(v), x = u * uLen;
    float edge = mix(clamp((1. - u) / .1, 0., 1.), 1., uTail);   // a tie's point, until it becomes a tail
    float fork = uTail * clamp((u - .8) * 6., 0., 1.);             // the tail's V notch
    float aa = 1.5 * fwidth(av), m = (1. - smoothstep(edge - aa, edge, av)) * smoothstep(fork - aa, fork, av);
    float st = fract(x * 7. + v * .35);                             // regimental stripes
    vec3 c = mix(mix(uRed, uNavy, step(.6, st)), uGold, step(.9, st) * step(st, .96));
    c = mix(c, mix(uRed, uWhite, smoothstep(.55, .6, vn(vec2(x * 4.5, v * .9 + 7.)))), uKoi); // kohaku blotches
    vec2 q = vec2(x * 16., v * 1.5 + .5); q.x += .5 * floor(q.y);
    float sc = smoothstep(.14, 0., abs(length(vec2(fract(q.x) - .5, fract(q.y))) - .55)) * (1. - smoothstep(.15, .4, fwidth(q.x)));
    c = mix(c, uGold, sc * .6 * uScale);                            // scales
    float fin = uTail * smoothstep(.76, .82, u);
    c = mix(c, mix(uOrange, uGold, smoothstep(.8, 1., u)) * (.85 + .15 * sin(av * 30.)), fin); // tail fin with rays
    c += uGold * uTail * pow(.5 + .5 * sin(x * 6. - uTime * 5.), 12.) * .7; // pulses racing to the tip
    c = mix(c, uInk, smoothstep(edge - .22, edge - .12, av) * (1. - .7 * fin)); // ink edge
    vec4 o = vec4(c * m, m);
    if (uTail > 0. && vS < -b) { // gold frill along the top edge
      float h = (-vS - b) / (1. - b), f = fract(x * 3.);
      float prof = (1. - f) * smoothstep(.05, .18, u) * (1. - smoothstep(.72, .8, u)) * uTail;
      float fr = 1. - smoothstep(prof - .08, prof, h), rim = fr * smoothstep(prof - .3, prof - .04, h), fa = .8 * fr;
      o += vec4(uGold * (.45 + .6 * rim) * fa, fa);
    }
    gl_FragColor = o * uAlpha;
  }`,
});

// Koinobori: a carp windsock streaming from its pole. u runs mouth → tail, v across (v < 0 is the top side).
const koiMaterial = () => new THREE.ShaderMaterial({
  ...PREMUL, depthTest: false, vertexShader: RIB_VS,
  uniforms: { uPxK: U.uPxK, uRed: { value: C(TN.red1, 0.95) }, uGold: { value: C(TN.yellow, 0.9) }, uInk: { value: C(TN.bg_dark1) },
    uWhite: { value: C(TN.fg, 0.95) }, uEdge: { value: neon(TN.orange, 1.5) } },
  fragmentShader: `uniform vec3 uRed, uGold, uInk, uWhite, uEdge; varying float vS, vU;
  ${TUBE}
  void main() {
    float u = vU, v = vS, av = abs(v);
    if (u > .84 && av < (u - .84) * 5.) discard; // forked tail
    float aa = fwidth(av) * .75, body = 1. - smoothstep(.8 - aa, .8 + aa, av);
    vec2 q = vec2(u * 14., v * 2.2 + .5); q.x += .5 * floor(q.y);
    float sc = smoothstep(.13, 0., abs(length(vec2(fract(q.x) - .5, fract(q.y))) - .5)) * step(.2, u) * step(u, .84);
    vec3 c = mix(uRed, mix(uRed, uWhite, .45), smoothstep(.1, .8, v)) + uGold * sc * .55;
    c = mix(c, uGold * .8, step(.84, u) * .6);                       // tail
    c = mix(c, uWhite, step(u, .05));                                 // mouth hoop
    float er = length(vec2((u - .14) * 7., (v + .3) * 1.1));          // eye
    c = mix(c, uWhite, smoothstep(.34, .3, er)); c = mix(c, uInk, smoothstep(.2, .16, er));
    gl_FragColor = vec4(body > 0. ? c * body + tube(uEdge, av, aa, .8) * (1. - body) : tube(uEdge, av, aa, .8), body * .96);
  }`,
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
const SEAT = [0.13, 0.31, 0.17, 0.27, 0.38, 0.36];                // hip height per ride tier
const LEGA = [0, 0, 0, 0, -0.3, 0];                               // resting leg angle (Bullet Nose: feet down its flank)
const MOUNT = [[-0.72, 0.2], [-0.72, 0.26], [-0.68, 0.14], [-0.68, 0.24], [-0.84, 0.27], [-0.7, 0.3]]; // booster mount
const BOOST_K = [1, 1.3, 1.3, 1.3, 1];     // booster art scale per tier (the pearl floats at its own size)
const PEARL = [[1.25, 1.55], [1.9, 0.75]]; // where the Flaming Pearl floats: ahead of his face / ahead of the dragon's snout
const SNOUT = [0.9, 0.55];                 // rider space: the dragon form's head
const ART = 1.15; // hero scale: reads better at the in-run zoom
const HIP_X = -0.12, NECK = [0.02, 0.53], SHOULDER = [0.0, 0.44], HAND = [0.35, -0.19];
const LIP = [0.15, 0.11];    // head space: under the nose, where the dojō-hige (barbels) hang from
const POLE = [-0.25, 1.42];  // glider space: top of the koinobori pole, where the carp is tied on
// gliders: arm angle when deployed, hand-held (attached at the hand) or on the torso, open angle, art scale when open,
// stowed pose, and optionally a torso / head pose while gliding
const GL = [null,
  { arm: 2.0, hand: 1, a: 0.3, k: 1.35, stow: [-0.17, 0.03, 0.4, 0.13, 0.75] }, // wagasa umbrella
  { arm: 1.3, hand: 1, a: -0.12, stow: [-0.14, 0.08, 0.42, 0.5, 0.5] },         // koinobori: pole strapped to the back
  { arm: 1.55, hand: 1, a: -0.06, stow: [-0.2, 0.3, -1.35, 0.42, 0.12] },        // neon hang glider
  { arm: 2.95, at: [0, 0], a: 0, stow: [0, 0.44, 0, 0.02, 0.02], torso: -0.3, head: 0.25 }, // fin suit (hidden when stowed)
  { arm: 0.75, at: [0, 0], a: 0, stow: [0, 0.3, 0, 0.05, 0.05], torso: -0.34, head: 0.3 }, // no wings: reach forward and swim
];
// booster flame per tier: nozzle (booster space), length, width, core/mid/tip colours, shock diamonds
const FL = [null,
  { at: [-0.2, 0.09], len: 0.75, w: 0.24, c: [neon(TN.yellow, 3.5), neon(TN.orange, 1.8), neon(TN.red1, 0.8)], dia: 0, spark: neon(TN.yellow, 2.4) },
  { at: [-0.34, 0.06], len: 1.15, w: 0.22, c: [neon(TN.blue6, 3.8), neon(TN.blue, 1.8), neon(TN.orange, 0.9)], dia: 0, spark: neon(TN.orange, 2.2) },
  { at: [-0.2, 0.06], len: 1.6, w: 0.27, c: [neon(TN.blue6, 4), neon(TN.cyan, 2), neon(TN.blue0, 1)], dia: 1, spark: neon(TN.cyan, 2.4) },
  { at: [-0.08, 0.0], len: 1.05, w: 0.36, c: [neon(TN.fg, 2.2), neon(TN.orange, 1.3), neon(TN.red1, 0.6)], dia: 0, spark: neon(TN.yellow, 2.2) },
];

// A koi silhouette pointing +x, 1 long (flat [x, y, ...]): the sukajan's embroidery, the deck art, the sail, the ghost.
const KOI = [0.5, 0, 0.36, 0.1, 0.06, 0.13, -0.24, 0.08, -0.37, 0.03, -0.52, 0.13, -0.47, 0, -0.52, -0.13, -0.37, -0.03, -0.24, -0.08, 0.06, -0.13, 0.36, -0.1];
function koi(a, x, y, len, ang, body, patch, outline, w = 0.006, tall = 1) {
  const f = pts => xf(pts, ang, x, y, len, len * tall), P = f(KOI);
  a.fill(P, body);
  for (const [px, py, r] of [[0.18, 0.02, 0.085], [-0.12, -0.02, 0.075]]) a.fill(f(circle(px, py, r, 10)), patch);
  return a.ink(P, outline, w, true).fill(f(circle(0.36, 0.035, 0.02, 6)), INK);
}
// A koi fin: a translucent fan from `root` to a scalloped edge (tip, notch, tip, …), rays to the tips, a pale rim.
function fin(a, root, edge, patch = null) {
  a.fill([...root, ...edge], C(TN.orange, 0.85), 0.82);
  if (patch) a.fill(patch, C(TN.red1, 0.9), 0.9);
  for (let i = 0; i < edge.length; i += 4) a.line([...root, edge[i], edge[i + 1]], neon(TN.yellow, 0.5), 0.004);
  return a.ink(edge, C(TN.fg, 0.9), 0.006).ink([...root, edge[0], edge[1]], INK, 0.008).ink([edge.at(-2), edge.at(-1), ...root], INK, 0.008);
}

function buildArt() {
  const a = new Art(true), W = 0.012;
  // bv.y = group·16 + tier + 64·until (see VEC_VS); until = the outfit stage that replaces this piece
  const on = (bone, group = 0, tier = 0, until = 0) => { a.bone = bone; a.vis = group * 16 + tier + 64 * until; return a; };
  const SUIT = C(TN.blue7, 0.95), SUIT_DK = C(TN.blue7, 0.62), SHIRT = C(TN.fg, 0.95), TIE = C(TN.red1, 0.95);
  const SKIN = C('#f0c49c', 0.92), HAIR = C('#191a24'), SHOE = C('#15161f'), MOUTH = C('#5a1f2a');
  const WHITE = C('#eef0fb', 0.92), RED = C(TN.red1, 0.95), GOLD = C(TN.yellow, 0.95), ORANGE = C(TN.orange, 0.9);
  const RIM = neon(TN.cyan, 0.75), hc = [0.035, 0.165], H = (x, y) => [hc[0] + x, hc[1] + y]; // head centre (head space)

  // --- gliders behind the body
  on(BONE.GLIDER, 2, 1); // wagasa: shaft from the hand, a janome (bull's-eye) canopy above
  {
    const edge = [-0.82, 0.98, -0.6, 1.0, -0.4, 0.97, -0.2, 1.0, 0, 0.97, 0.2, 1.0, 0.4, 0.97, 0.6, 1.0, 0.82, 0.98];
    const dome = arc(0, 0.98, 0.82, 0.34, 0.05, Math.PI - 0.05, 12);
    a.ink([0, -0.05, 0, 1.3], C(TN.orange, 0.7), 0.014);
    for (let i = 0; i < edge.length; i += 4) a.line([0, 0.72, edge[i], edge[i + 1]], neon(TN.yellow, 0.6), 0.006);
    a.inked([...dome, ...edge], C(TN.red1, 0.62), 0.016, 0.95);
    a.fill([...arc(0, 0.98, 0.62, 0.255, 0.12, Math.PI - 0.12, 10), ...arc(0, 0.985, 0.44, 0.18, Math.PI - 0.17, 0.17, 10)], WHITE, 0.95);
    for (let i = 1; i < 6; i++) { const t = Math.PI * (i / 6); a.line([0, 1.32, Math.cos(t) * 0.8, 0.99 + Math.sin(t) * 0.02], neon(TN.yellow, 0.7), 0.004); }
    a.inked(circle(0, 1.33, 0.05, 10), C(TN.yellow, 0.7), 0.01);
    a.inked(rrect(-0.03, -0.12, 0.03, 0.08, 0.02), C(TN.orange, 0.35), 0.008);
  }
  on(BONE.GLIDER, 2, 2); // koinobori: bamboo pole with a spinning arrow wheel on top (the carp is a streamer)
  {
    const [px, py] = POLE;
    a.line([0.02, -0.16, px, py + 0.1], neon(TN.green, 0.9), 0.013);
    for (let k = 1; k < 5; k++) { const u = k / 5, x = 0.02 + (px - 0.02) * u, y = -0.16 + (py + 0.26) * u; a.line([x - 0.028, y - 0.004, x + 0.028, y + 0.004], neon(TN.yellow, 0.9), 0.006); }
    const cx = px, cy = py + 0.16;
    for (let k = 0; k < 8; k++) { const t = (k / 8) * TAU; a.line([cx, cy, cx + Math.cos(t) * 0.075, cy + Math.sin(t) * 0.075], neon(TN.yellow, 1.2), 0.005, false, 1, 3); }
    a.line(circle(cx, cy, 0.075, 16), neon(TN.orange, 1.6), 0.008, true);
    a.dot(cx, cy + 0.11, 0.07, neon(TN.yellow, 1.4)).shape(circle(cx, cy + 0.11, 0.022, 8), C(TN.yellow, 0.6), neon(TN.yellow, 1.6), 0.006);
  }
  on(BONE.GLIDER, 2, 3); // neon hang glider, drawn in 3/4 view so the sail has area: a koi painted on the sail, LED edges
  {
    const nose = [0.95, 1.22], far = [-0.95, 1.82], near = [-1.4, 0.88], tail = [-0.52, 1.25];
    const sail = [...nose, ...far, ...tail, ...near];
    a.line([-0.05, 0.02, -0.14, 1.23], neon(TN.fg, 0.8), 0.008).line([0.14, 0.02, -0.14, 1.23], neon(TN.fg, 0.8), 0.008);
    a.ink([-0.12, 0.02, 0.22, 0.02], C(TN.fg, 0.8), 0.012);
    a.inked(sail, C(TN.purple, 0.32), 0.016);
    koi(a, 0.05, 1.33, 0.9, -0.12, C(TN.yellow, 0.85), C(TN.red1, 0.95), INK, 0.008);
    a.line([...near, ...nose, ...far], neon(TN.cyan, 1.5), 0.012).line([...nose, ...tail], neon(TN.fg, 0.55), 0.005);
    a.dot(...nose, 0.09, neon(TN.blue6, 2)).dot(...far, 0.08, neon(TN.magenta2, 2), 1, 1).dot(...near, 0.08, neon(TN.magenta2, 2), 1, 1);
  }
  on(BONE.GLIDER, 2, 4); // fin suit: two big koi fins, raised arm down to the hip, and hip back past the ride (torso space)
  fin(a, [-0.05, 0.42], [0.02, 0.5, -0.3, 0.74, -0.9, 0.86, -1.1, 0.74, -1.62, 0.7, -1.3, 0.55, -1.6, 0.38, -1.2, 0.34, -1.3, 0.15, -0.9, 0.18, -0.75, 0.0, -0.4, 0.08, -0.12, -0.02],
    [-0.05, 0.42, -0.28, 0.7, -0.52, 0.66, -0.38, 0.4]);
  fin(a, [-0.08, 0.02], [-0.14, -0.04, -0.5, -0.1, -0.95, -0.28, -0.75, -0.24, -0.8, -0.4, -0.45, -0.26, -0.12, -0.1]);
  on(BONE.GLIDER, 2, 5); // no wings: the koi's own fins, and the ghost of a koi swimming around him (torso space)
  {
    const gx = -0.55, gy = 0.45, gl = 2.9, ga = 0.12, ghost = xf(KOI, ga, gx, gy, gl);
    a.haze(ghost, C(TN.orange, 0.07), 1, 3).line(ghost, neon(TN.orange, 0.6), 0.006, true, 1, 3);
    a.dot(...xf([0.36, 0.035], ga, gx, gy, gl), 0.06, neon(TN.yellow, 1.4));
    fin(a, [-0.02, 0.38], [0.02, 0.44, -0.3, 0.58, -0.75, 0.62, -0.62, 0.5, -1.0, 0.44, -0.7, 0.34, -0.95, 0.2, -0.5, 0.22, -0.12, 0.3]);
    fin(a, [-0.1, 0.03], [-0.14, -0.02, -0.45, -0.1, -0.75, -0.24, -0.55, -0.2, -0.5, -0.32, -0.3, -0.18, -0.1, -0.06]);
  }

  // --- booster (behind the ride)
  on(BONE.BOOST, 3, 1); // hanabi: two paper rockets
  for (const [dx, dy] of [[0, 0], [0.06, 0.1]]) {
    const b = [-0.18 + dx, dy, 0.3 + dx, dy, 0.42 + dx, dy + 0.045, 0.3 + dx, dy + 0.09, -0.18 + dx, dy + 0.09];
    a.inked(b, C(TN.red1, 0.6), 0.008);
    for (let i = 0; i < 3; i++) a.fill([-0.12 + dx + i * 0.16, dy + 0.008, -0.05 + dx + i * 0.16, dy + 0.008, -0.05 + dx + i * 0.16, dy + 0.082, -0.12 + dx + i * 0.16, dy + 0.082], C(TN.yellow, 0.6));
    a.line(b, neon(TN.yellow, 0.9), 0.004, true).line([-0.18 + dx, dy + 0.045, -0.25 + dx, dy + 0.07], neon(TN.orange, 1.2), 0.006);
  }
  on(BONE.BOOST, 3, 2); // turbo canister
  a.inked(rrect(-0.22, -0.02, 0.3, 0.15, 0.07), C(TN.blue7, 0.9), 0.01).line(rrect(-0.2, 0, 0.28, 0.13, 0.06), neon(TN.fg, 0.6), 0.004, true);
  a.inked([-0.22, 0.03, -0.34, -0.005, -0.34, 0.125, -0.22, 0.09], C(TN.bg_highlight), 0.008);
  a.line([0.05, -0.02, 0.05, 0.15], neon(TN.blue1, 1.2), 0.01).inked(circle(0.18, 0.065, 0.04, 10), C(TN.bg_highlight), 0.006).dot(0.18, 0.065, 0.025, neon(TN.orange, 1.5));
  on(BONE.BOOST, 3, 3); // plasma thruster
  a.inked(rrect(-0.14, -0.03, 0.36, 0.15, 0.08), C(TN.bg_highlight, 1.2), 0.01);
  for (let i = 0; i < 3; i++) a.line(arc(0.02 + i * 0.1, 0.06, 0.025, 0.095, -Math.PI / 2, Math.PI / 2, 6), neon(TN.cyan, 1.6), 0.008, false, 1, 3);
  a.inked(arc(-0.15, 0.06, 0.045, 0.1, 0, TAU * 0.95, 12), C(TN.blue6, 0.7), 0.01).dot(-0.15, 0.06, 0.06, neon(TN.blue6, 1.6));
  on(BONE.BOOST, 3, 4); // flaming pearl (hōju): flame tongues licking back off a glowing jewel; floats ahead of you
  {
    a.dot(0, 0, 0.36, neon(TN.orange, 0.3), 1, 3);
    for (const [ang, len] of [[1.35, 0.3], [1.9, 0.4], [2.5, 0.34], [3.1, 0.3], [3.75, 0.26], [4.5, 0.22]]) { // licking up and back, like a comet's
      const c = Math.cos(ang), sn = Math.sin(ang), bx = c * 0.1, by = sn * 0.1, nx = -sn * 0.045, ny = c * 0.045;
      const tx = c * 0.45 * len - 0.85 * len - 0.04, ty = sn * 0.5 * len + 0.05 + 0.1 * len;
      a.shape([bx + nx, by + ny, (bx + tx) / 2 + nx * 0.5, (by + ty) / 2 + ny * 0.5 + 0.02, tx, ty, bx - nx, by - ny], C(TN.orange, 0.55), neon(TN.yellow, 0.9), 0.006, 0.85);
    }
    a.inked(circle(0, 0, 0.12, 20), C('#fff4dd', 0.95), 0.01).line(circle(0, 0, 0.1, 20), neon(TN.yellow, 0.9), 0.005, true);
    a.line(arc(0.01, 0, 0.07, 0.07, 0.4, 3.6, 10), neon(TN.orange, 1.1), 0.008, false, 1, 3);
    a.dot(0.04, 0.045, 0.05, neon(TN.fg, 1.6));
  }

  // --- rides (all but the box sit under the rider)
  on(BONE.ROOT, 1, 1); // koi pool float: an inflatable kohaku carp
  {
    const cx = -0.02, cy = 0.17, rx = 0.64, ry = 0.165, body = [];
    for (let i = 0; i < 28; i++) { const t = (i / 28) * TAU, c = Math.cos(t); body.push(cx + rx * c, cy + ry * Math.sin(t) * (1 - 0.3 * Math.max(0, -c) ** 2)); }
    a.inked([-0.58, 0.19, -0.9, 0.36, -0.8, 0.19, -0.9, 0.02, -0.58, 0.15], C(TN.orange, 0.6)); // tail
    a.inked(body, WHITE);
    a.fill([-0.28, 0.3, -0.05, 0.325, 0.12, 0.3, 0.08, 0.2, -0.12, 0.17, -0.3, 0.22], RED); // red patches
    a.fill([0.3, 0.28, 0.46, 0.25, 0.44, 0.19, 0.32, 0.2], RED);
    a.fill([-0.5, 0.2, -0.38, 0.27, -0.36, 0.15], RED);
    a.inked([0.18, 0.1, 0.02, 0.0, 0.06, 0.1], C(TN.orange, 0.6), 0.008); // pectoral fin
    a.line(arc(cx, cy, rx * 0.9, ry * 0.75, 1.9, 1.15, 8), neon(TN.fg, 0.8), 0.005);            // vinyl sheen
    a.inked(circle(0.47, 0.205, 0.035, 12), C(TN.fg, 0.95), 0.007).fill(circle(0.48, 0.205, 0.017, 8), C(TN.bg_dark1));
    a.ink([0.6, 0.15, 0.555, 0.135, 0.6, 0.12], C(TN.red1, 0.8), 0.006); // mouth
  }
  on(BONE.ROOT, 1, 2); // koi skateboard: kicktail deck with a big carp painted along its edge, chunky glowing wheels
  {
    for (const x of [-0.4, 0.4]) {
      a.inked([x - 0.08, 0.1, x + 0.08, 0.1, x + 0.04, 0.065, x - 0.04, 0.065], C(TN.blue7, 0.9), 0.008);
      a.dot(x, 0.05, 0.12, neon(TN.cyan, 0.6), 1, 3);
      a.inked(circle(x, 0.05, 0.062, 14), C(TN.cyan, 0.5), 0.01).dot(x, 0.05, 0.025, neon(TN.fg, 1.4));
    }
    const deck = limb([-0.72, 0.21, -0.58, 0.12, 0.58, 0.12, 0.72, 0.21], 0.048);
    a.inked(deck, C(TN.bg_dark1, 1.8)).line(deck, neon(TN.orange, 0.8), 0.005, true);
    koi(a, -0.02, 0.12, 0.92, 0, WHITE, RED, GOLD, 0.005, 0.34); // squashed to fit the deck's edge
  }
  on(BONE.ROOT, 1, 3); // seigaiha luge: black lacquer, a vermilion rim, gold wave arcs (fish scales, if you look again)
  {
    a.ink([-0.62, 0.012, 0.56, 0.012, 0.71, 0.06], GOLD, 0.011);
    for (const x of [-0.45, 0.35]) a.ink([x, 0.015, x + 0.03, 0.08], GOLD, 0.009);
    a.inked([-0.72, 0.08, 0.5, 0.07, 0.74, 0.11, 0.62, 0.2, -0.6, 0.245, -0.76, 0.17], C(TN.bg_dark1, 2.2));
    for (let row = 0; row < 3; row++) for (let i = 0; i < 9; i++) {
      const x = -0.52 + i * 0.12 + (row % 2) * 0.06, y = 0.085 + row * 0.04;
      if (x > 0.36 - row * 0.05) continue;
      for (const r of [0.05, 0.03]) a.line(arc(x, y, r, r * 0.8, 0.15, Math.PI - 0.15, 6), neon(TN.yellow, r > 0.04 ? 0.8 : 0.55), 0.004);
    }
    a.line([-0.64, 0.222, 0.6, 0.192], neon(TN.red1, 1.2), 0.009);
  }
  on(BONE.ROOT, 1, 4); // bullet nose: a retired Shinkansen nose cone, white with the blue line
  {
    const top = [];
    for (let i = 14; i >= 0; i--) { const u = i / 14; top.push(0.05 + u * 0.97, 0.075 + 0.285 * (1 - u) ** 1.7); }
    a.inked([-0.74, 0.03, 0.94, 0.035, ...top, -0.74, 0.36], C(TN.fg, 0.66));
    a.fill([-0.74, 0.1, 0.8, 0.075, 0.9, 0.06, 0.8, 0.093, -0.74, 0.135], C(TN.blue0, 0.95));
    a.line([-0.74, 0.155, 0.62, 0.13], neon(TN.blue, 0.8), 0.004);
    a.inked([0.1, 0.31, 0.36, 0.2, 0.4, 0.18, 0.15, 0.27], C(TN.bg_dark1), 0.006).line([0.14, 0.28, 0.35, 0.2], neon(TN.cyan, 0.8), 0.004);
    a.dot(0.95, 0.07, 0.1, neon(TN.yellow, 0.9)).dot(0.95, 0.07, 0.025, neon(TN.fg, 2));
    a.ink([-0.3, 0.05, -0.3, 0.34], C(TN.fg_gutter), 0.004).ink([0.02, 0.05, 0.02, 0.34], C(TN.fg_gutter), 0.004);
  }
  on(BONE.ROOT, 1, 5); // storm cloud: curled like the clouds dragons ride in old paintings, lit from inside
  {
    const mist = neon(TN.magenta, 0.25);
    a.glow([-0.6, 0.12, 0.6, 0.12, 0.74, -0.02, -0.6, 0.12, 0.74, -0.02, -0.74, -0.02], [mist, mist, C(0), mist, C(0), C(0)], 1, 3);
    const puffs = [[-0.62, 0.19, 0.155], [-0.36, 0.28, 0.205], [-0.02, 0.31, 0.23], [0.33, 0.27, 0.19], [0.6, 0.19, 0.145]], fog = C(TN.storm, 1.3);
    a.fill(arc(0, 0.14, 0.76, 0.12, 0, TAU * 0.97, 20), fog);
    for (const [x, y, r] of puffs) a.fill(circle(x, y, r, 16), fog);
    for (const [x, y, r] of puffs) a.line(arc(x, y, r, r, 0.25, Math.PI - 0.25, 8), neon(TN.blue5, 1.1), 0.009);
    a.line(arc(0, 0.14, 0.76, 0.12, Math.PI + 0.3, TAU - 0.3, 12), neon(TN.magenta, 0.9), 0.007);
    for (const [x, y, r] of [[-0.36, 0.26, 0.11], [0.14, 0.24, 0.1]]) { // ruyi curls
      const sp = [];
      for (let i = 0; i <= 16; i++) { const t = (i / 16) * TAU * 1.3, rr = r * (1 - i / 19); sp.push(x + Math.cos(t + 1) * rr, y + Math.sin(t + 1) * rr * 0.8); }
      a.line(sp, neon(TN.magenta, 1.2), 0.006, false, 1, 3);
    }
    a.line([0.36, 0.31, 0.3, 0.2, 0.37, 0.19, 0.31, 0.07], neon(TN.yellow, 2), 0.007, false, 1, 1); // lightning inside
  }

  // --- body. Group 0's tiers are the outfit stages (items.js DRIFT): a salaryman, drifting into a koi.
  on(BONE.LEGS, 0, 0, 7); // navy suit trousers
  const leg = limb([0.0, 0.03, 0.2, 0.12, 0.37, 0.15, 0.47, 0.08, 0.55, 0.01], 0.085, 0.06);
  a.inked(leg, SUIT_DK).line([0.06, 0.115, 0.34, 0.165], neon(TN.blue, 0.3), 0.004);
  on(BONE.LEGS, 0, 7); // koi trousers, with the fin cuffs: white with a red patch
  a.inked(leg, WHITE).fill([0.2, 0.19, 0.35, 0.21, 0.42, 0.13, 0.3, 0.09, 0.2, 0.11], RED);
  on(BONE.LEGS); // black leather shoes
  a.inked([0.49, -0.045, 0.66, -0.05, 0.755, -0.02, 0.76, 0.025, 0.7, 0.055, 0.5, 0.065], SHOE).line([0.6, 0.035, 0.72, 0.012], neon(TN.blue, 0.55), 0.004);

  const J = [-0.12, -0.01, -0.16, 0.14, -0.155, 0.32, -0.115, 0.46, -0.04, 0.53, 0.06, 0.53, 0.135, 0.46, 0.165, 0.3, 0.155, 0.12, 0.1, 0.0];
  const BACK = [-0.12, -0.01, -0.16, 0.14, -0.155, 0.32, -0.115, 0.46, -0.04, 0.53];
  on(BONE.TORSO, 0, 0, 4); // business backpack (every Tokyo office worker has one) and the navy suit jacket
  a.inked(rrect(-0.33, 0.1, -0.12, 0.43, 0.05), C('#1d2030')).ink([-0.33, 0.33, -0.12, 0.33], C('#2c3045'), 0.006).fill(rrect(-0.245, 0.29, -0.205, 0.31, 0.008), GOLD);
  a.inked(J, SUIT);
  a.ink([0.035, 0.515, 0.15, 0.3], SUIT_DK, 0.009).fill(circle(0.152, 0.22, 0.013, 8), C(TN.blue0, 0.7)).ink([0.02, 0.2, 0.11, 0.2], SUIT_DK, 0.006);
  a.line(BACK, RIM, 0.005);
  on(BONE.TORSO, 0, 4); // sukajan: a satin souvenir jacket, kohaku, with a koi embroidered on the back
  a.inked(J, WHITE);
  a.fill([-0.15, 0.3, -0.06, 0.43, 0.04, 0.4, 0.03, 0.26, -0.1, 0.22], RED).fill([0.06, 0.04, 0.15, 0.1, 0.16, 0.2, 0.09, 0.24, 0.03, 0.13], RED);
  koi(a, -0.085, 0.12, 0.17, Math.PI / 2 + 0.25, GOLD, RED, INK, 0.004);
  a.ink([-0.115, 0.022, 0.1, 0.022], INK, 0.02).ink([-0.115, 0.022, 0.1, 0.022], GOLD, 0.004);
  a.ink([-0.03, 0.522, 0.07, 0.522], INK, 0.016).ink([-0.03, 0.522, 0.07, 0.522], GOLD, 0.0035);
  a.line(BACK, RIM, 0.005);
  on(BONE.TORSO, 0, 5); // sequins: the scales come in, shimmering
  for (const y of [0.09, 0.17, 0.25, 0.33, 0.41]) for (let i = 0; i < 4; i++) {
    const odd = Math.round(y * 100) % 2, x = -0.12 + i * 0.07 + (odd ? 0.035 : 0);
    if (x > 0.13 || (y > 0.36 && x > 0.1)) continue;
    a.line(arc(x, y, 0.03, 0.025, 0.2, Math.PI - 0.2, 6), neon(TN.yellow, 0.6), 0.004, false, 1, 3);
  }
  on(BONE.TORSO); // shirt, knot and the front of the tie, under whatever jacket he wears
  a.inked([0.03, 0.53, 0.105, 0.515, 0.14, 0.45, 0.163, 0.34, 0.13, 0.38, 0.07, 0.47], SHIRT, 0.008);
  a.inked([0.085, 0.505, 0.125, 0.5, 0.12, 0.465, 0.09, 0.468], TIE, 0.007);
  a.inked([0.1, 0.468, 0.118, 0.466, 0.158, 0.37, 0.145, 0.345, 0.128, 0.37], TIE, 0.007);

  on(BONE.HEAD); // neck and face
  a.inked([-0.03, -0.03, 0.06, -0.03, 0.07, 0.07, -0.04, 0.07], SKIN, 0.009);
  a.inked(circle(...hc, 0.13, 22), SKIN);
  a.ink([...H(0.127, 0), ...H(0.15, -0.03), ...H(0.124, -0.045)], INK, 0.007);
  on(BONE.HEAD, 0, 0, 6); // a small o: he's shouting into the wind
  a.inked(circle(...H(0.1, -0.078), 0.017, 10), MOUTH, 0.007);
  on(BONE.HEAD, 0, 0, 5); // office hair, side part
  a.inked([...arc(hc[0], hc[1], 0.148, 0.148, 0.95, 3.75, 12), ...H(-0.09, -0.06), ...H(-0.005, -0.035), ...H(0.012, 0.04), ...H(0.06, 0.075), ...H(0.095, 0.1)], HAIR);
  a.line(arc(hc[0], hc[1], 0.13, 0.13, 1.45, 2.45, 6), neon(TN.blue, 0.45), 0.004);
  on(BONE.HEAD, 0, 5); // pompadour, dyed orange, swept back into a crest: a dorsal fin
  a.inked([...H(0.095, 0.105), ...H(0.15, 0.12), ...H(0.172, 0.155), ...H(0.15, 0.19), ...H(0.08, 0.2), ...H(-0.03, 0.19), ...H(-0.14, 0.18),
    ...H(-0.27, 0.19), ...H(-0.19, 0.11), ...H(-0.15, 0.03), ...H(-0.11, -0.065), ...H(-0.07, -0.035), ...H(-0.035, 0.075), ...H(0.035, 0.1)], ORANGE);
  a.ink([...H(0.14, 0.16), ...H(0.06, 0.175), ...H(-0.06, 0.168), ...H(-0.2, 0.172)], C('#fff4e0', 0.95), 0.011);
  a.ink([...H(0.11, 0.13), ...H(-0.03, 0.145), ...H(-0.16, 0.14)], C(TN.red1, 0.7), 0.005);
  on(BONE.HEAD, 0, 3); // hachimaki with a red sun disc: the tanchō koi's crown spot
  a.inked(limb([...H(0.125, 0.07), ...H(-0.135, 0.05)], 0.024), WHITE, 0.009);
  for (const tl of [[-0.11, 0.075, -0.24, 0.13, -0.27, 0.09, -0.13, 0.055], [-0.11, 0.045, -0.22, 0.0, -0.25, -0.03, -0.12, 0.03]]) a.inked(tl.map((v, i) => v + hc[i % 2]), WHITE, 0.008);
  a.inked(circle(...H(0.125, 0.075), 0.032, 12), RED, 0.009);
  on(BONE.HEAD); // ear
  a.inked(circle(...H(-0.035, -0.01), 0.03, 10), SKIN, 0.009).ink(arc(...H(-0.035, -0.01), 0.014, 0.014, -1, 1.8, 5), C('#c98f6a'), 0.005);
  on(BONE.HEAD, 0, 0, 6); // office glasses
  const lens = rrect(...H(0.058, -0.014), ...H(0.138, 0.04), 0.012);
  a.fill(circle(...H(0.098, 0.012), 0.013, 8), INK).fill(lens, C(TN.cyan, 0.3), 0.45).ink(lens, INK, 0.009, true);
  a.ink([...H(0.058, 0.02), ...H(-0.03, 0.01)], INK, 0.007).line([...H(0.075, 0.03), ...H(0.095, 0.005)], neon(TN.blue6, 1.1), 0.004);
  on(BONE.HEAD, 0, 6); // round gold-rimmed glasses: a koi's eye looking back, and a fish's mouth
  a.inked(circle(...H(0.092, 0.015), 0.052, 16), C('#f6ead2'), 0.009);
  a.fill(circle(...H(0.098, 0.015), 0.03, 12), GOLD).fill(circle(...H(0.102, 0.015), 0.015, 10), INK).fill(circle(...H(0.086, 0.028), 0.007, 6), C('#ffffff'));
  a.ink(circle(...H(0.092, 0.015), 0.052, 16), GOLD, 0.006, true).ink([...H(0.042, 0.02), ...H(-0.03, 0.012)], GOLD, 0.006);
  a.inked(circle(...H(0.098, -0.078), 0.024, 12), MOUTH, 0.006).ink(circle(...H(0.098, -0.078), 0.024, 12), C('#e89b82'), 0.007, true);
  on(BONE.HEAD, 0, 8); // the tail stage: the pupil narrows to a slit
  a.fill(circle(...H(0.098, 0.015), 0.03, 12), GOLD).fill(arc(...H(0.101, 0.015), 0.006, 0.026, 0, TAU * 0.94, 10), INK);

  // --- arm
  on(BONE.ARM, 0, 7); // fin cuffs: frilled happi-coat cuffs that are really pectoral fins
  fin(a, [0.3, -0.21], [0.16, -0.36, 0.12, -0.3, 0.0, -0.4, -0.02, -0.32, -0.14, -0.33, -0.06, -0.27, -0.12, -0.22, 0.1, -0.2]);
  const sleeve = limb([0, 0, 0.08, -0.09, 0.16, -0.15, 0.25, -0.18, 0.33, -0.19], 0.066, 0.05);
  on(BONE.ARM, 0, 0, 4); // suit sleeve and shirt cuff
  a.inked(sleeve, SUIT).inked(limb([0.29, -0.183, 0.318, -0.19], 0.05), SHIRT, 0.008);
  on(BONE.ARM, 0, 4); // sukajan sleeve: white, a red band, a ribbed black-and-gold cuff
  a.inked(sleeve, WHITE).fill(limb([0.08, -0.09, 0.14, -0.135], 0.056), RED);
  a.inked(limb([0.285, -0.182, 0.315, -0.19], 0.054), INK, 0.006).ink([0.3, -0.142, 0.3, -0.236], GOLD, 0.004);
  on(BONE.ARM); // hand
  a.inked(circle(...HAND, 0.05, 12), SKIN, 0.009);

  // --- in front: cardboard box
  on(BONE.ROOT, 1, 0);
  a.shape([-0.44, 0.44, -0.66, 0.6, -0.7, 0.55, -0.48, 0.42], C(TN.orange, 0.3), neon(TN.yellow, 0.6), W);
  a.shape([0.4, 0.44, 0.62, 0.56, 0.58, 0.61, 0.38, 0.46], C(TN.orange, 0.3), neon(TN.yellow, 0.6), W);
  a.shape([-0.48, 0.02, 0.42, 0.02, 0.44, 0.45, -0.5, 0.45], C(TN.orange, 0.36), neon(TN.yellow, 0.7), W);
  a.fill([-0.48, 0.2, 0.43, 0.2, 0.43, 0.27, -0.48, 0.27], C(TN.yellow, 0.55));
  a.line([0.1, 0.33, 0.14, 0.4, 0.18, 0.33], neon(TN.fg, 0.9), 0.006).line([0.14, 0.4, 0.14, 0.31], neon(TN.fg, 0.9), 0.006);
  return a;
}

// follow-the-leader chain from an anchor, streaming along (dx, dy) with a flutter travelling down it
function trail(P, n, x0, y0, dx, dy, seg, amp, freq, ph, t, kf) {
  P[0] = x0; P[1] = y0;
  for (let i = 1; i < n; i++) {
    const o = i * 4, fl = Math.sin(t * freq - i * 0.9 + ph) * amp * (i / n);
    const tx = P[o - 4] + dx * seg - dy * fl, ty = P[o - 3] + dy * seg + dx * fl;
    P[o] += (tx - P[o]) * kf; P[o + 1] += (ty - P[o + 1]) * kf;
    const ex = P[o] - P[o - 4], ey = P[o + 1] - P[o - 3], el = Math.hypot(ex, ey) || 1;
    P[o] = P[o - 4] + (ex / el) * seg; P[o + 1] = P[o - 3] + (ey / el) * seg;
  }
}
const lay = (P, n, x0, y0, dx, dy, seg) => { for (let i = 0; i < n; i++) { P[i * 4] = x0 + dx * seg * i; P[i * 4 + 1] = y0 + dy * seg * i; } };
const koiW = u => (u < 0.3 ? 0.15 + 0.2 * u : u < 0.8 ? 0.21 - 0.22 * (u - 0.3) : 0.1 + 0.5 * (u - 0.8)); // carp half-width profile
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

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
  const body = new THREE.Mesh(buildArt().geometry(), vecMaterial({ bones, sel, depthTest: false }));
  const { uAlpha } = body.material.uniforms;
  body.frustumCulled = false; body.renderOrder = 17;

  const flameU = { uTime: U.uTime, uOn: { value: 0 }, uDia: { value: 0 }, uC0: { value: new THREE.Color() }, uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() } };
  const flame = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(-0.5, 0, 0), new THREE.ShaderMaterial({
    ...PREMUL, depthTest: false, uniforms: flameU, fragmentShader: FLAME_FS,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
  }));
  flame.frustumCulled = false; flame.renderOrder = 18; flame.matrixAutoUpdate = false; flame.visible = false; // a light: view.js blooms it

  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  group.add(body);

  // streamers, in world space: the tie (a tail, all along), the dojō-hige (barbels), the koinobori carp
  const TNP = 40, tie = new Ribbon(TNP, tieMaterial(), 0.05), tieU = tie.mesh.material.uniforms;
  const BN = 7, barbels = [0, 1].map(() => new Ribbon(BN, ribbonMaterial(C('#191a24'), C('#191a24'), 0.9, 1, 0), 0.06));
  const KN = 12, carp = new Ribbon(KN, koiMaterial(), 0.04);
  tie.mesh.renderOrder = carp.mesh.renderOrder = 16; // behind the body
  for (const b of barbels) b.mesh.renderOrder = 18; // in front of the face
  const streamers = new THREE.Group();
  streamers.add(tie.mesh, carp.mesh, ...barbels.map(b => b.mesh));

  const tmp = new THREE.Matrix3(), open = new THREE.Matrix3(), stow = new THREE.Matrix3(), v3 = new THREE.Vector3();
  const aff = (m, tx, ty, ang, sx = 1, sy = sx) => {
    const c = Math.cos(ang), s = Math.sin(ang), e = m.elements;
    e[0] = c * sx; e[1] = s * sx; e[2] = 0; e[3] = -s * sy; e[4] = c * sy; e[5] = 0; e[6] = tx; e[7] = ty; e[8] = 1;
    return m;
  };
  const chain = (out, parent, tx, ty, ang, sx, sy) => out.multiplyMatrices(parent, aff(tmp, tx, ty, ang, sx, sy));
  const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

  const st = { sled: 0, glider: 0, booster: 0, open: 0, tumble: 0, spin: 0, squash: 0, flame: 0, crashed: false,
    torso: 0.12, head: 0, arm: 0, legs: 0, init: false, shed: 0 }; // shed: the tie outliving him at the reveal
  const look = { p: 0, stage: 0, dragon: false, n: 7 }; // outfit progress (items.js), dragon form, tie length (points)
  const world = { x: 0, y: 0, nozzleA: 0, flame: 0, tier: 0, spark: null, hx: 0, hy: 0 }; // booster nozzle + dragon snout, world space
  const W2 = { a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0 }; // current rider-local → world affine
  const P0 = [0, 0], P1 = [0, 0];
  const at = (m, x, y, out) => { // bone-space point → world
    v3.set(x, y, 1).applyMatrix3(m);
    out[0] = W2.a * v3.x + W2.c * v3.y + W2.tx; out[1] = W2.b * v3.x + W2.d * v3.y + W2.ty;
    return out;
  };

  function apply() {
    const pearl = look.dragon && st.booster ? 4 : st.booster; // a dragon always chases the pearl, whatever drives it
    if (look.dragon) sel.set(-1, -1, -1, st.booster ? 4 : -1);
    else sel.set(look.stage, st.sled, st.glider ? st.glider : -1, st.booster);
    const f = FL[pearl];
    if (f) { flameU.uC0.value.copy(f.c[0]); flameU.uC1.value.copy(f.c[1]); flameU.uC2.value.copy(f.c[2]); flameU.uDia.value = f.dia; }
    world.tier = pearl;
    tie.mesh.visible = !look.dragon || st.shed > 0.01;
    for (const b of barbels) b.mesh.visible = !look.dragon && look.stage >= 2;
    carp.mesh.visible = !look.dragon && st.glider === 2;
  }
  function setLoadout(l) { st.sled = l.sled | 0; st.glider = l.glider | 0; st.booster = l.booster | 0; st.init = false; apply(); }
  function setLook(l) {
    look.p = l.p ?? look.p; look.dragon = !!l.dragon; look.stage = stage(look.p);
    look.n = 7 + 29 * look.p; // the tie lengthens with every purchase
    const past = k => +(look.stage > k); // DRIFT[k] reached: novelty tie, scales, then the tail
    tieU.uKoi.value = past(0); tieU.uScale.value = past(4); tieU.uTail.value = past(7);
    st.init = false; apply();
  }
  // The reveal: the tie races out to its full length and fades as the dragon's body grows along the same path.
  function shed(k) {
    if (k > st.shed) { look.n = TNP; tieU.uTail.value = 1; }
    st.shed = k; tieU.uAlpha.value = k; tie.mesh.visible = !look.dragon || k > 0.01;
  }

  function reset() { st.tumble = st.spin = st.squash = st.open = st.flame = 0; st.crashed = false; st.init = false; }
  const kick = (v) => { st.squash = v; }; // + stretch, − squash
  function crash(speed) { st.spin = (Math.random() < 0.5 ? -1 : 1) * Math.min(14, 4 + speed * 0.35); }

  function update(dt, r, s, t) {
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
    let torso = 0.12 + 0.5 * steep + 0.025 * Math.sin(t * 1.7), head = -0.06 - 0.3 * steep, arm = 0.02 + 0.03 * Math.sin(t * 1.7 + 1), legs = LEGA[st.sled];
    // in the air he moves more like a fish the further he's drifted: flailing office worker → dive → swimming
    const fish = smooth(0.2, 0.7, look.p), swim = smooth(0.7, 1, look.p), wave = Math.sin(t * 6);
    if (tuck) { torso = -0.62; head = 0.42; arm = 0.42; legs += 0.12; }
    else if (glide) {
      torso = g.torso ?? 0.02; head = g.head ?? 0.05; arm = g.arm;
      if (st.glider >= 4) { torso += 0.1 * swim * wave; head += 0.08 * swim * Math.sin(t * 6 - 1.2); }
    } else if (air) {
      torso = 0.04 - 0.5 * fish - 0.3 * swim + 0.1 * swim * wave; head = 0.04 + 0.3 * fish + 0.2 * swim + 0.08 * swim * Math.sin(t * 6 - 1.2);
      arm = (1 - fish) * (2.3 + 0.35 * Math.sin(t * 9)) + fish * (-1.3 + 0.15 * Math.sin(t * 6 + 1));
    }
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
    const jit = r.boosting ? 0.012 * Math.sin(t * 90) : 0;
    if (world.tier === 4) { // the pearl floats ahead, bobbing
      const [px, py] = PEARL[look.dragon ? 1 : 0];
      chain(bones[BONE.BOOST], root, px + 0.04 * Math.sin(t * 1.3), py + 0.06 * Math.sin(t * 2.1) + jit, 0.1 * Math.sin(t * 1.7));
    } else { const m = MOUNT[st.sled]; chain(bones[BONE.BOOST], root, m[0], m[1] + jit, 0, BOOST_K[st.booster]); }
    if (g) {
      const o = st.open, e = o < 1 ? 1 + 2.2 * (o - 1) ** 3 + 1.2 * (o - 1) ** 2 : 1; // easeOutBack
      const w = g.stow;
      chain(stow, bones[BONE.TORSO], w[0], w[1], w[2], w[3], w[4]);
      if (g.hand) {
        const ca = Math.cos(st.arm), sa = Math.sin(st.arm);
        const hx = SHOULDER[0] + HAND[0] * ca - HAND[1] * sa, hy = SHOULDER[1] + HAND[0] * sa + HAND[1] * ca;
        chain(open, bones[BONE.TORSO], hx, hy, g.a + (st.glider === 1 ? 0.06 * Math.sin(t * 5) : 0), g.k ?? 1);
      } else chain(open, bones[BONE.TORSO], g.at[0], g.at[1], g.a, g.k ?? 1);
      const gb = bones[BONE.GLIDER].elements, E0 = stow.elements, E1 = open.elements;
      for (let i = 0; i < 9; i++) gb[i] = E0[i] + (E1[i] - E0[i]) * e;
      if (!look.dragon) sel.z = st.glider >= 4 && o < 0.02 ? -1 : st.glider; // suits and fins vanish when stowed
    }

    // --- group transform: T(x,y) R(a) S(s), tumbling about the body centre (0, pc)
    const pc = 0.55, th = r.a, al = r.a + st.tumble, ca = Math.cos(al) * s, sa = Math.sin(al) * s;
    const tx = r.x + s * pc * (-Math.sin(th) + Math.sin(al)), ty = r.y + s * pc * (Math.cos(th) - Math.cos(al));
    W2.a = W2.d = ca; W2.b = sa; W2.c = -sa; W2.tx = tx; W2.ty = ty;
    group.matrix.set(ca, -sa, 0, tx, sa, ca, 0, ty, 0, 0, s, 0, 0, 0, 0, 1);
    group.matrixWorldNeedsUpdate = true;
    world.hx = W2.a * SNOUT[0] + W2.c * SNOUT[1] + W2.tx; world.hy = W2.b * SNOUT[0] + W2.d * SNOUT[1] + W2.ty;

    // --- booster flame
    const f = FL[world.tier];
    st.flame = damp(st.flame, r.boosting && f ? 1 : 0, r.boosting ? 30 : 14, dt);
    flame.visible = st.flame > 0.01;
    if (f) {
      v3.set(f.at[0], f.at[1], 1).applyMatrix3(bones[BONE.BOOST]);
      const bk = BOOST_K[world.tier], len = bk * f.len * st.flame * (1 + 0.15 * Math.sin(t * 50) + 0.1 * Math.sin(t * 83)), w = bk * f.w * (0.6 + 0.4 * st.flame);
      flame.matrix.set(len, 0, 0, v3.x, 0, w, 0, v3.y, 0, 0, 1, 0.01, 0, 0, 0, 1).premultiply(group.matrix);
      flame.matrixWorldNeedsUpdate = true;
      flameU.uOn.value = st.flame;
      const px = v3.x - len * 0.3;
      world.x = W2.a * px + W2.c * v3.y + W2.tx; world.y = W2.b * px + W2.d * v3.y + W2.ty;
      world.nozzleA = al + Math.PI; world.flame = st.flame; world.spark = f.spark;
    } else world.flame = 0;

    if (look.dragon && st.shed < 0.01) return;
    // --- streamers stream against the airflow; when slow the barbels and the carp hang down and back, while the
    // tie (a tail, really) comes to rest trailing back along the body
    const wk = Math.min(1, sp / 6), ux = -r.vx / (sp || 1) * wk, uy = -r.vy / (sp || 1) * wk;
    let dx = ux + 0.35 * (1 - wk) * -Math.cos(al), dy = uy - (1 - wk);
    let lx = ux - (1 - wk) * Math.cos(al), ly = uy - (1 - wk) * (Math.sin(al) + 0.3);
    let dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    dl = Math.hypot(lx, ly) || 1; lx /= dl; ly /= dl;
    const kf = 1 - Math.exp(-dt * 30), fq = 9 + sp * 0.35;
    // the tie: narrow at the knot, full width by a third of the way, a pointed tip (or, later, a forked tail)
    const TP = tie.pts, n = Math.min(TNP, Math.max(2, Math.round(look.n))), seg = 0.07 * s, tl = tieU.uTail.value, w0 = s * 0.05 * (1 + 0.9 * tl);
    at(bones[BONE.TORSO], 0.0, 0.5, P0);
    if (!st.init) lay(TP, n, P0[0], P0[1], lx, ly, seg);
    trail(TP, n, P0[0], P0[1], lx, ly, seg, seg * (0.25 + Math.min(1.2, sp / 20)) * (1 + 0.8 * smooth(0.7, 1, look.p)), fq, 0, t, kf);
    for (let i = 0; i < n; i++) { const u = i / (n - 1); TP[i * 4 + 2] = w0 * (0.42 + 0.58 * smooth(0, 0.3, u)) * (1 + 1.3 * tl * smooth(0.72, 1, u)); TP[i * 4 + 3] = u; }
    tie.commit(n);
    tieU.uLen.value = (n - 1) * 0.07;
    if (look.dragon) { st.init = true; return; }
    // dojō-hige: two barbels from under the nose, drooping, lengthening as he drifts
    if (look.stage >= 2) {
      const bs = s * (0.011 + 0.011 * smooth(0.1, 1, look.p)), fx = Math.cos(al), fy = Math.sin(al); // droop forward and down
      const mx = 0.35 * fx + 0.2 * dx, my = 0.35 * fy - 1 + 0.2 * dy, ml = Math.hypot(mx, my);
      barbels.forEach((b, j) => {
        at(bones[BONE.HEAD], LIP[0] - 0.025 * j, LIP[1] + 0.005 * j, P1);
        if (!st.init) lay(b.pts, BN, P1[0], P1[1], mx / ml, my / ml, bs);
        trail(b.pts, BN, P1[0], P1[1], mx / ml, my / ml, bs, bs * (0.3 + Math.min(1, sp / 20)), 7 + sp * 0.3, 2.1 * j, t, kf);
        for (let i = 0; i < BN; i++) { b.pts[i * 4 + 2] = s * 0.0055 * (1 - 0.5 * (i / (BN - 1))); b.pts[i * 4 + 3] = i / (BN - 1); }
        b.commit();
      });
    }
    // the carp on its pole: puffs up in the wind when the pole is raised
    if (st.glider === 2) {
      const o = st.open, ks = s * 0.19 * (0.5 + 0.5 * o);
      at(bones[BONE.GLIDER], POLE[0], POLE[1], P1);
      if (!st.init) lay(carp.pts, KN, P1[0], P1[1], dx, dy, ks);
      trail(carp.pts, KN, P1[0], P1[1], dx, dy, ks, ks * (0.2 + Math.min(0.8, sp / 25)), 6 + sp * 0.25, 1, t, kf);
      for (let i = 0; i < KN; i++) { const u = i / (KN - 1); carp.pts[i * 4 + 2] = s * 1.5 * koiW(u) * (0.55 + 0.45 * o); carp.pts[i * 4 + 3] = u; }
      carp.commit();
    }
    st.init = true;
  }

  const fade = k => { // the tie can outlive the body (shed); the barbels and the carp can't
    uAlpha.value = k; streamers.visible = k > 0.5 || st.shed > 0.01;
    for (const m of [carp.mesh, ...barbels.map(b => b.mesh)]) m.material.visible = k > 0.5;
  };
  return { group, flame, streamers, setLoadout, setLook, update, reset, kick, crash, fade, shed, world,
    get sled() { return st.sled; }, get dragon() { return look.dragon; } };
}
