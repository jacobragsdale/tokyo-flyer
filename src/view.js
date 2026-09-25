// Tokyo Flyer renderer: bloom pipeline, camera, streamed terrain, in-run / kicker / start torii / lamps,
// distance boards, BEST / milestone beams, GOAL board, Tokyo Tower, lanterns + boost rings, GPU particles, trail, speed lines.
// Rider art lives in rider.js; sky, city, dragons and snowfall come from backdrop.js.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createBackdrop } from './backdrop.js';
import { GOAL } from './items.js';
import { TN, C, neon, U, PREMUL, TUBE, Art, vecMaterial, ribbonMaterial, Ribbon, arc, rrect, createRider } from './rider.js';

const K = 2 * Math.tan(THREE.MathUtils.degToRad(20)); // visible height at z = 0 per metre of camera distance
const BLOOM = 0.55;
const GATES = [20, 24, 33, 43, 54, 66];
const TOWER_X = GOAL + 30, TOWER_Z = -70;

export function createView(canvas, T) {
  const phone = matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.info.autoReset = false;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(TN.bg_dark); // (setClearColor would bake sRGB into the linear buffer)
  const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 30000);
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: phone ? 0 : 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM, 0.32, 1);
  const bloomSize = bloom.setSize.bind(bloom), BS = phone ? 0.5 : 1; // pass halves internally: ½ res desktop, ¼ phone
  bloom.setSize = (w, h) => bloomSize(w * BS, h * BS);
  // one NaN/Inf pixel from any shader would be smeared over the whole frame by the blur: drop it at the input
  bloom.materialHighPassFilter.fragmentShader = bloom.materialHighPassFilter.fragmentShader.replace(
    'vec4 texel = texture2D( tDiffuse, vUv );', 'vec4 texel = texture2D( tDiffuse, vUv ); if (any(isnan(texel)) || any(isinf(texel))) texel = vec4(0.);');
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const uH = { value: 20 }, uPtScale = { value: 500 }, uAspect = { value: 1 };
  const backdrop = createBackdrop(scene, camera);
  const add = (o, order, cull = false) => { o.renderOrder = order; o.frustumCulled = cull; scene.add(o); return o; };

  // ================================================================ terrain (streamed chunks, one ring buffer)
  const KX = T.kicker.x0, GX = KX - 5, KNOLL = T.h(1e-6);
  const gy0 = T.h(GX), gm0 = T.slope(GX) * -GX;
  const ground = x => { // snow line under the kicker: cubic from the in-run down to the knoll top
    if (x < GX || x >= 0) return T.h(x);
    const t = (x - GX) / -GX, t2 = t * t, t3 = t2 * t;
    return Math.min(T.h(x), (2 * t3 - 3 * t2 + 1) * gy0 + (t3 - 2 * t2 + t) * gm0 + (3 * t2 - 2 * t3) * KNOLL);
  };
  const CW = 64, SPC = 0.5, NCOL = CW / SPC + 1, SLOTS = 24, BOT = -900;
  const fillPos = new THREE.BufferAttribute(new Float32Array(SLOTS * NCOL * 6), 3).setUsage(THREE.DynamicDrawUsage);
  const fillTop = new THREE.BufferAttribute(new Float32Array(SLOTS * NCOL * 2), 1).setUsage(THREE.DynamicDrawUsage);
  const rimPos = new THREE.BufferAttribute(new Float32Array(SLOTS * NCOL * 6), 3).setUsage(THREE.DynamicDrawUsage);
  const rimNrm = new THREE.BufferAttribute(new Float32Array(SLOTS * NCOL * 6), 3).setUsage(THREE.DynamicDrawUsage);
  const tidx = [];
  for (let s = 0; s < SLOTS; s++) for (let i = 0; i < NCOL - 1; i++) {
    const v = (s * NCOL + i) * 2;
    tidx.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
  }
  const fillGeo = new THREE.BufferGeometry().setAttribute('position', fillPos).setAttribute('top', fillTop).setIndex(tidx);
  const rimGeo = new THREE.BufferGeometry().setAttribute('position', rimPos).setAttribute('nrm', rimNrm).setIndex(tidx);
  const uRider = { value: new THREE.Vector3(0, 0, 0) };
  const fill = add(new THREE.Mesh(fillGeo, new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uPx: { value: 0.03 }, uRider,
      uLit: { value: C(TN.fg_gutter, 0.8) }, uMid: { value: C(TN.bg_highlight, 0.8) }, uDeep: { value: C(TN.bg_dark) },
      uSpill: { value: neon(TN.blue1, 0.014) }, uSpark: { value: neon(TN.blue6, 2.4) } },
    vertexShader: `attribute float top; varying vec3 vW; varying float vTop;
      void main() { vW = position; vTop = top; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform float uTime, uPx; uniform vec3 uLit, uMid, uDeep, uSpill, uSpark, uRider; varying vec3 vW; varying float vTop;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        float d = max(vTop - vW.y, 0.), zs = max(1., uPx * 10.), near = smoothstep(.07, .025, uPx);
        vec3 c = mix(uLit, uMid, smoothstep(0., 1.2 * zs, d));
        c = mix(c, uDeep, smoothstep(.8 * zs, 16. + 8. * zs, d));
        c += uSpill * exp(-d / (.5 * zs));
        float sd = d / (2.4 * zs) + .2 * sin(vW.x * .09 / zs), ln = 1. - smoothstep(0., 1.5 * fwidth(sd), abs(fract(sd + .5) - .5));
        c *= 1. - .12 * ln * smoothstep(10. * zs, .6 * zs, d); // snow strata following the surface
        vec2 g = vec2(vW.x, d) * 7., f = fract(g) - .5; float h = hash(floor(g));
        float tw = pow(max(0., sin(uTime * (1.5 + 4. * h) + h * 40.)), 8.);
        c += uSpark * step(.94, h) * tw * smoothstep(.22, 0., length(f)) * smoothstep(1.4, .05, d) * near;
        vec2 q = vW.xy - uRider.xy;
        c += uSpill * 2.5 * uRider.z * exp(-dot(q, q) * .25);
        gl_FragColor = vec4(c, 1.);
      }`,
  })), 0);

  const rimU = { uTime: U.uTime, uPxK: U.uPxK, uRider, uGoal: { value: GOAL },
    uRim: { value: neon(TN.cyan, 1.35) }, uIn: { value: neon(TN.blue, 1.15) }, uStud: { value: neon(TN.blue6, 2.2) },
    uPop: { value: neon(TN.magenta2, 2.2) }, uHot: { value: neon(TN.blue6, 1.6) } };
  add(new THREE.Mesh(rimGeo, new THREE.ShaderMaterial({
    ...PREMUL, depthTest: false, uniforms: rimU,
    vertexShader: `attribute vec3 nrm; uniform float uPxK; varying float vS; varying vec2 vW;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.);
        float w = max(.026, .7 * -mv.z * uPxK);
        vS = nrm.z; vW = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy + nrm.xy * nrm.z * 3.3 * w, 0., 1.);
      }`,
    fragmentShader: `uniform float uTime, uGoal; uniform vec3 uRim, uIn, uStud, uPop, uHot, uRider; varying float vS; varying vec2 vW;
      ${TUBE}
      void main() {
        float d = abs(vS), aa = fwidth(d) * .75, x = vW.x;
        vec3 c = uRim * (.88 + .12 * sin(x * .06 - uTime * 1.3));
        if (x < 0.) {
          float stud = smoothstep(.06, .0, abs(fract(x * .5) - .5) - .44);
          float run = pow(max(.5 + .5 * sin(x * .35 - uTime * 5.), 0.), 12.);
          c = uIn * (1. + .6 * run) + uStud * stud;
          if (x > -2.2) c = uPop * (.85 + .3 * sin(uTime * 9.));
        }
        if (abs(x - uGoal) < 1.2) c = uHot * (step(.5, fract(x * 2.)) + .4);
        c += uHot * uRider.z * .8 * exp(-(x - uRider.x) * (x - uRider.x) * .15);
        gl_FragColor = vec4(tube(c, d, aa, .3), 0.);
      }`,
  })), 13);

  const slotChunk = new Int32Array(SLOTS).fill(-1e9);
  const FP = fillPos.array, FT = fillTop.array, RP = rimPos.array, RN = rimNrm.array;
  function buildChunk(slot, c) {
    const base = slot * NCOL * 2;
    for (let i = 0; i < NCOL; i++) {
      const x = c * CW + i * SPC, xe = i === NCOL - 1 ? x - 1e-6 : x; // right edge: left-side limit (the lip)
      const e = T.at(xe), h = e.h, d1 = e.d1, top = xe >= GX && xe < 0 ? ground(xe) : h;
      const v = base + i * 2, o = v * 3, l = Math.hypot(1, d1);
      FP[o] = FP[o + 3] = RP[o] = RP[o + 3] = x; FP[o + 1] = top; FP[o + 4] = BOT; FP[o + 2] = FP[o + 5] = RP[o + 2] = RP[o + 5] = 0;
      FT[v] = FT[v + 1] = top; RP[o + 1] = RP[o + 4] = h;
      RN[o] = RN[o + 3] = -d1 / l; RN[o + 1] = RN[o + 4] = 1 / l; RN[o + 2] = -1; RN[o + 5] = 1;
    }
    fillPos.addUpdateRange(base * 3, NCOL * 6); rimPos.addUpdateRange(base * 3, NCOL * 6); rimNrm.addUpdateRange(base * 3, NCOL * 6);
    fillPos.needsUpdate = rimPos.needsUpdate = rimNrm.needsUpdate = true;
    fillTop.addUpdateRange(base, NCOL * 2); fillTop.needsUpdate = true;
    slotChunk[slot] = c;
  }
  function stream(x0, x1) {
    const c1 = Math.min(Math.floor(x1 / CW), Math.floor(x0 / CW) + SLOTS - 1);
    for (let c = Math.floor(x0 / CW); c <= c1; c++) {
      const s = ((c % SLOTS) + SLOTS) % SLOTS;
      if (slotChunk[s] !== c) buildChunk(s, c);
    }
  }

  // ================================================================ static world: one vector-art draw
  const W = new Art();
  const surfN = x => { const d = T.slope(x), l = Math.hypot(1, d); return [-d / l, 1 / l]; };
  // in-run railing with post lights
  {
    W.z = -0.7;
    const rail = [], x0 = T.inrunTop.x - 6, x1 = KX - 0.5;
    for (let x = x0; x <= x1; x += 1) { const [nx, ny] = surfN(x); rail.push(x + nx * 1.0, T.h(x) + ny * 1.0); }
    W.line(rail, neon(TN.blue0, 0.75), 0.018);
    let k = 0;
    for (let x = x0 + 1; x <= x1; x += 3, k++) {
      const [nx, ny] = surfN(x), y = T.h(x);
      W.line([x - nx * 0.4, y - ny * 0.4, x + nx, y + ny], neon(TN.blue7, 0.55), 0.012);
      W.dot(x + nx * 1.02, y + ny * 1.02, 0.1, k % 2 ? neon(TN.cyan, 1.6) : neon(TN.magenta, 1.5));
    }
  }
  // lamp posts along the in-run: pole, arm, lamp and a soft light cone onto the track
  for (let x = -113; x < KX - 6; x += 15) {
    W.z = -2.2;
    const y = T.h(x), top = y + 5.6, lx = x + 1.1, ly = top + 0.15, cone = neon(TN.blue5, 0.03), z0 = C(0);
    W.glow([lx, ly, lx - 2.6, y - 1.5, lx + 3.2, y - 3.2], [cone, z0, z0]);
    W.line([x, y - 2, x, top, ...arc(x + 0.55, top, 0.55, 0.3, Math.PI, 0.25, 5)], neon(TN.comment, 0.55), 0.03);
    W.shape(rrect(lx - 0.38, ly - 0.08, lx + 0.34, ly + 0.1, 0.05), C(TN.bg_highlight), neon(TN.fg, 1.1), 0.012);
    W.line([lx - 0.3, ly - 0.09, lx + 0.28, ly - 0.09], neon(TN.blue6, 3.5), 0.02).dot(lx, ly - 0.12, 0.35, neon(TN.blue5, 0.5));
  }
  // start gates: torii with numbered plaques (vertex ranges kept so setLoadout can light the current one)
  const toriiRange = [];
  for (const h of GATES) {
    const gx = T.gateX(h), gy = T.h(gx), v0 = W.count, R = neon(TN.red1, 0.85), F = C(TN.red1, 0.16);
    W.z = -0.45;
    for (const sx of [-1, 1]) {
      const bx = gx + sx * 1.05, by = T.h(bx) - 0.6 - gy;
      W.shape([gx + sx * 1.15, gy + by, gx + sx * 0.95, gy + by, gx + sx * 0.9, gy + 3.0, gx + sx * 1.1, gy + 3.0], F, R, 0.014);
    }
    W.shape([gx - 1.45, gy + 2.35, gx + 1.45, gy + 2.35, gx + 1.45, gy + 2.5, gx - 1.45, gy + 2.5], F, R, 0.014);
    W.shape([gx - 1.62, gy + 2.9, gx + 1.62, gy + 2.9, gx + 1.62, gy + 3.03, gx - 1.62, gy + 3.03], F, R, 0.014);
    W.shape([gx - 1.72, gy + 3.03, gx + 1.72, gy + 3.03, gx + 1.95, gy + 3.28, gx + 1.95, gy + 3.37, gx, gy + 3.25, gx - 1.95, gy + 3.37, gx - 1.95, gy + 3.28], F, R, 0.016);
    W.shape(rrect(gx - 0.26, gy + 2.5, gx + 0.26, gy + 2.9, 0.04), C(TN.bg_dark), neon(TN.yellow, 0.8), 0.01);
    toriiRange.push([v0, W.count]);
  }
  // kicker: steel ramp body between the deck and the snow, panel seams, trusses, chase lights, lip beacon
  {
    W.z = 0.1;
    const top = [], bot = [];
    for (let x = KX; x < 0; x += 0.25) { if (T.h(x) - ground(x) > 0.02) { top.push(x, T.h(x)); bot.unshift(x, ground(x)); } }
    top.push(0, T.h(-1e-6)); bot.unshift(0, KNOLL);
    W.fill([...top, ...bot], C(TN.storm, 1.1));
    for (let x = -1.2; x > KX + 2; x -= 1.6) {
      const g = ground(x), h = T.h(x), xn = x - 1.6, gn = ground(xn), hn = T.h(xn);
      if (h - g < 0.25) break;
      W.line([x, g + 0.03, x, h - 0.12], neon(TN.blue0, 0.5), 0.012);
      if (hn - gn > 0.45) W.line([x, g + 0.08, xn, hn - 0.16], neon(TN.blue7, 0.4), 0.008).line([x, h - 0.16, xn, gn + 0.08], neon(TN.blue7, 0.4), 0.008);
    }
    const fas = [];
    for (let x = KX + 1.5; x <= -0.05; x += 0.5) fas.push(x, T.h(x) - 0.2);
    W.line(fas, neon(TN.fg, 0.55), 0.01);
    for (let x = -14; x <= -0.4; x += 0.8) {
      const k = (x + 14) / 14;
      W.dot(x, T.h(x) - 0.34, 0.12, new THREE.Color().lerpColors(neon(TN.cyan, 2.4), neon(TN.magenta2, 2.8), k), 1, 2);
    }
    W.line([0, T.h(-1e-6), 0, KNOLL + 0.05], neon(TN.magenta2, 2), 0.028);
    for (let y = -0.6; y > KNOLL + 0.3; y -= 0.55) W.line([-0.03, y, -0.45, y - 0.3], neon(TN.magenta2, 0.9), 0.012);
    W.dot(0, -0.05, 0.4, neon(TN.magenta2, 1.4), 1, 3).dot(0, -0.05, 0.1, neon(TN.fg, 2.6));
  }
  // distance ticks where the snow crosses each board
  const MARKS = [];
  for (let d = 10; d <= 100; d += 10) MARKS.push(d);
  for (let d = 150; d <= 1000; d += 50) MARKS.push(d);
  for (let d = 1100; d <= 5000; d += 100) MARKS.push(d);
  for (let d = 5500; d <= 20000; d += 500) MARKS.push(d);
  W.z = 0.1;
  for (const d of MARKS) if (d <= 1000) { const y = T.h(d), big = d % 50 === 0; W.line([d, y - (big ? 0.45 : 0.3), d, y + (big ? 0.35 : 0.2)], neon(TN.fg, big ? 1.8 : 1.2), big ? 0.02 : 0.014); }
  buildTower(W, TOWER_X, T.h(TOWER_X) - 25, TOWER_Z);
  const worldGeo = W.geometry(), worldCol = worldGeo.attributes.col, baseCol = worldCol.array.slice();
  add(new THREE.Mesh(worldGeo, vecMaterial()), 10);

  // ================================================================ labels: glyph atlas + instanced quads (one draw)
  const atlas = document.createElement('canvas');
  atlas.width = 1024; atlas.height = 512;
  const atlasTex = new THREE.CanvasTexture(atlas);
  atlasTex.minFilter = THREE.LinearMipmapLinearFilter;
  const glyph = {}, EM = 80, ROW = 110, PAD = 16;
  const FONT = `700 ${EM}px Oxanium, "Avenir Next", system-ui, sans-serif`, JP = `500 ${EM}px "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Hiragino Sans", sans-serif`;
  function drawAtlas() {
    const g = atlas.getContext('2d');
    g.clearRect(0, 0, 1024, 512); g.fillStyle = '#fff'; g.textBaseline = 'middle';
    let x = 0, y = 0;
    const put = (key, font) => {
      g.font = font;
      const w = Math.ceil(g.measureText(key).width);
      if (x + w + PAD * 2 > 1024) { x = 0; y += ROW; }
      g.fillText(key, x + PAD, y + ROW / 2 + 4);
      glyph[key] = { u0: x / 1024, u1: (x + w + PAD * 2) / 1024, v0: 1 - (y + ROW) / 512, v1: 1 - y / 512, adv: w / EM, w: (w + PAD * 2) / EM };
      x += w + PAD * 2;
    };
    for (const ch of '0123456789.m') put(ch, FONT);
    for (const wd of ['BEST', 'GOAL', 'TOKYO TOWER']) put(wd, FONT);
    put('東京タワー', JP);
    atlasTex.needsUpdate = true;
  }
  const LMAX = 1400;
  const lA = new THREE.InstancedBufferAttribute(new Float32Array(LMAX * 4), 4), lB = new THREE.InstancedBufferAttribute(new Float32Array(LMAX * 4), 4);
  const lC = new THREE.InstancedBufferAttribute(new Float32Array(LMAX * 4), 4), lD = new THREE.InstancedBufferAttribute(new Float32Array(LMAX * 4), 4);
  const labelGeo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
  labelGeo.setAttribute('lA', lA).setAttribute('lB', lB).setAttribute('lC', lC).setAttribute('lD', lD);
  const uFlare = { value: new THREE.Vector2(-1e9, -99) };
  add(new THREE.Mesh(labelGeo, new THREE.ShaderMaterial({
    ...PREMUL, uniforms: { uAtlas: { value: atlasTex }, uH, uTime: U.uTime, uFlare, uInk: { value: C(TN.bg_dark) } },
    vertexShader: `attribute vec4 lA, lB, lC, lD; uniform float uH, uTime; uniform vec2 uFlare;
      varying vec2 vUv, vQ, vHalf; varying vec4 vD;
      void main() {
        float lvl = lA.w, s = lvl > 2.5 ? 1. : clamp(uH / 26., 1., 6.);
        float vis = lvl < .5 ? 1. - smoothstep(40., 58., uH) : lvl < 1.5 ? 1. - smoothstep(105., 150., uH) : 1.;
        float fl = abs(lA.x - uFlare.x) < .5 ? exp(-(uTime - uFlare.y) * 1.6) : 0.;
        s *= 1. + .45 * fl;
        vD = vec4(lD.rgb * (1. + 2.5 * fl), lD.a); vUv = mix(lC.xy, lC.zw, uv); vQ = position.xy * lB.zw; vHalf = lB.zw * .5;
        vec2 p = lA.xy + (lB.xy + vQ) * s * step(.01, vis);
        vD.rgb *= vis;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, lA.z, 1.);
      }`,
    fragmentShader: `uniform sampler2D uAtlas; uniform vec3 uInk; varying vec2 vUv, vQ, vHalf; varying vec4 vD;
      void main() {
        if (vD.a < .5) {
          float a = texture2D(uAtlas, vUv).a, g = textureLod(uAtlas, vUv, 3.2).a;
          gl_FragColor = vec4(vD.rgb * (a + .55 * g * (1. - a)), 0.);
        } else if (vD.a < 1.5) {
          vec2 q = abs(vQ) - vHalf + .1; float sd = length(max(q, 0.)) + min(max(q.x, q.y), 0.) - .1, aa = fwidth(sd);
          float body = 1. - smoothstep(-aa, aa, sd), ring = 1. - smoothstep(.03 - aa, .03 + aa, abs(sd + .06));
          gl_FragColor = vec4(uInk * body * .9 + vD.rgb * (ring + .12 * exp(-abs(sd) * 12.)), body * .9);
        } else gl_FragColor = vec4(vD.rgb, 1.);
      }`,
  })), 12);
  let nLab = 0;
  const lab = (x, y, z, lvl, ox, oy, w, h, u, col, kind) => {
    if (nLab >= LMAX) return;
    const i = nLab++ * 4;
    lA.array.set([x, y, z, lvl], i); lB.array.set([ox, oy, w, h], i);
    lC.array.set(u ? [u.u0, u.v0, u.u1, u.v1] : [0, 0, 0, 0], i); lD.array.set([col.r, col.g, col.b, kind], i);
  };
  const text = (str, x, y, z, lvl, ox, oy, S, col) => { // centred on (ox, oy)
    const toks = glyph[str] ? [str] : [...str];
    let wsum = 0;
    for (const t of toks) wsum += glyph[t] ? glyph[t].adv + 0.06 : 0.3;
    let cx = ox - (wsum * S) / 2;
    for (const t of toks) {
      const gph = glyph[t];
      if (!gph) { cx += 0.3 * S; continue; }
      lab(x, y, z, lvl, cx + (gph.adv * S) / 2, oy, gph.w * S, (ROW / EM) * S, gph, col, 0);
      cx += (gph.adv + 0.06) * S;
    }
  };
  let bestX = 0, gateSel = 0;
  function layoutLabels() {
    nLab = 0;
    for (const d of MARKS) {
      const y = T.h(d), lvl = d % 100 === 0 ? 2 : d % 50 === 0 ? 1 : 0, n = String(d).length, w = 0.5 + 0.36 * n;
      const edge = lvl === 2 ? neon(TN.magenta2, 1.6) : lvl === 1 ? neon(TN.cyan, 1.5) : neon(TN.blue, 1.2);
      lab(d, y, -1.4, lvl, 0, 0.3, 0.09, 2.6, null, C(TN.comment, 0.9), 2);
      lab(d, y, -1.4, lvl, 0, 1.75, w, 0.78, null, edge, 1);
      text(String(d), d, y, -1.4, lvl, 0, 1.75, 0.5, neon(TN.fg, lvl === 2 ? 1.9 : 1.5));
    }
    GATES.forEach((h, i) => { const gx = T.gateX(h); text(String(i + 1), gx, T.h(gx), -0.44, 3, 0, 2.71, 0.3, i === gateSel ? neon(TN.yellow, 1.5) : neon(TN.yellow, 0.7)); });
    const gy = T.h(GOAL), GO = neon(TN.orange, 1.6);  // finish board (scales with zoom like the distance boards)
    for (const px of [-3.4, 3.4]) lab(GOAL, gy, -1.2, 2, px, 1.6, 0.16, 5, null, C(TN.comment, 0.9), 2);
    lab(GOAL, gy, -1.2, 2, 0, 4.6, 8.2, 2.9, null, GO, 1);
    text('GOAL', GOAL, gy, -1.2, 2, 0, 5.05, 1.25, neon(TN.orange, 1.5));
    text('東京タワー', GOAL, gy, -1.2, 2, 0, 3.8, 0.62, neon(TN.fg, 1.1)); // ≤ ~1.5: brighter text blooms into a blob (thin kana first)
    if (bestX >= 5) {
      const by = T.h(bestX);
      text('BEST', bestX, by, -0.8, 2, 1.25, 3.3, 0.5, neon(TN.yellow, 1.7));
      text(`${bestX.toFixed(bestX < 100 ? 1 : 0)}m`, bestX, by, -0.8, 2, 1.25, 2.7, 0.42, neon(TN.fg, 1.3));
    }
    for (const a of [lA, lB, lC, lD]) a.needsUpdate = true;
    labelGeo.instanceCount = nLab;
  }
  drawAtlas(); layoutLabels();
  document.fonts?.load(FONT, '0123456789GOALBEST').then(() => document.fonts.load(JP, '東京タワー')).then(() => { drawAtlas(); layoutLabels(); }).catch(() => {});

  // ================================================================ beams: BEST (gold), milestone flash
  const bA = new THREE.InstancedBufferAttribute(new Float32Array(8), 4), bB = new THREE.InstancedBufferAttribute(new Float32Array(8), 4);
  const beamGeo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(2, 1).translate(0, 0.5, 0));
  beamGeo.setAttribute('bA', bA).setAttribute('bB', bB); beamGeo.instanceCount = 2;
  add(new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({
    ...PREMUL, uniforms: { uH, uPxK: U.uPxK, uTime: U.uTime },
    vertexShader: `attribute vec4 bA, bB; uniform float uH, uPxK; varying vec2 vP; varying vec4 vC;
      void main() {
        vec4 mv = modelViewMatrix * vec4(bA.xy, -.8, 1.);
        float w = max(bA.w, 1.1 * -mv.z * uPxK) * 5., h = max(bA.z, uH * .8);
        vP = vec2(position.x * 5., position.y); vC = bB;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(bA.x + position.x * w, bA.y - 1. + position.y * h * step(.001, bB.a), -.8, 1.);
      }`,
    fragmentShader: `uniform float uTime; varying vec2 vP; varying vec4 vC;
      void main() {
        float u = abs(vP.x), v = vP.y;
        float core = 1. - smoothstep(.6, 1.1, u), glow = .35 * exp(-u * .9);
        float f = pow(clamp(1. - v, 0., 1.), 1.8) * smoothstep(0., .015, v) * (.8 + .2 * sin(v * 60. - uTime * 6.));
        gl_FragColor = vec4(vC.rgb * vC.a * (core + glow) * f, 0.);
      }`,
  })), 11);
  const setBeam = (i, x, h, w, col, k) => {
    const A = bA.array, B = bB.array, o = i * 4;
    A[o] = x; A[o + 1] = T.h(x); A[o + 2] = h; A[o + 3] = w; B[o] = col.r; B[o + 1] = col.g; B[o + 2] = col.b; B[o + 3] = k;
    bA.needsUpdate = bB.needsUpdate = true;
  };
  const GOLD = neon(TN.yellow, 1.1), MILE = neon(TN.blue6, 1.6);

  // ================================================================ collectibles: paper lanterns + boost rings
  const MAXL = 1024, MAXR = 128, m4 = new THREE.Matrix4(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const lanterns = add(new THREE.InstancedMesh(new THREE.PlaneGeometry(1.5, 1.9), new THREE.ShaderMaterial({
    ...PREMUL, uniforms: { uTime: U.uTime, uH, uWarm: { value: neon(TN.orange, 0.95) }, uHot: { value: neon(TN.yellow, 1.55) }, uInk: { value: C(TN.bg_dark1) }, uRed: { value: C(TN.red1, 0.9) } },
    vertexShader: `uniform float uTime, uH; varying vec2 vP; varying float vPh;
      void main() {
        float ph = float(gl_InstanceID) * 1.7, s = instanceMatrix[0][0] * clamp(uH / 55., 1., 2.2);
        float sw = .1 * sin(uTime * 1.7 + ph), bob = .14 * sin(uTime * 1.15 + ph * 1.3);
        vec2 p = (position.xy - vec2(0., .62)) * s;
        p = mat2(cos(sw), sin(sw), -sin(sw), cos(sw)) * p + vec2(0., .62 * s + bob);
        vP = position.xy; vPh = ph;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(instanceMatrix[3].xy + p, -.3, 1.);
      }`,
    fragmentShader: `uniform float uTime; uniform vec3 uWarm, uHot, uInk, uRed; varying vec2 vP; varying float vPh;
      void main() {
        vec2 p = vP; float e = length(p / vec2(.36, .43)), aa = fwidth(e);
        float body = 1. - smoothstep(1. - aa, 1. + aa, e);
        float flick = .9 + .1 * sin(uTime * 11. + vPh * 7.) * sin(uTime * 6.3 + vPh);
        vec3 c = mix(uHot, uWarm, smoothstep(.1, .9, e)) * (.72 + .28 * cos(p.y * 52.)) * flick;
        c = mix(c, uRed, step(.25, abs(p.y)) * step(abs(p.y), .31));
        float cap = step(abs(p.x), .21) * step(.4, abs(p.y)) * step(abs(p.y), .5);
        float str = step(abs(p.x), .012) * step(.5, p.y) + step(abs(p.x), .01) * step(p.y, -.5) * step(-.75, p.y);
        float glow = .3 * exp(-e * e * 1.6) * (1. - body) * flick;
        vec3 col = c * body + uWarm * glow;
        float a = body;
        if (cap + str > .5) { col = cap > .5 ? uInk + uWarm * .15 : uWarm * .6; a = cap; }
        gl_FragColor = vec4(col, a);
      }`,
  }), MAXL), 14);
  lanterns.count = 0;
  const ringMat = half => new THREE.ShaderMaterial({
    ...PREMUL, uniforms: { uTime: U.uTime, uH, uHalf: { value: half }, uA: { value: neon(TN.magenta2, 1.5) }, uB: { value: neon(TN.cyan, 2.2) } },
    vertexShader: `uniform float uTime, uH, uHalf; varying vec2 vP; varying float vPh;
      void main() {
        vPh = float(gl_InstanceID) * 2.3;
        float s = instanceMatrix[0][0] * clamp(uH / 70., 1., 1.7) * (1. + .03 * sin(uTime * 2.5 + vPh));
        vP = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(instanceMatrix[3].xy + position.xy * s, .05 * uHalf, 1.);
      }`,
    fragmentShader: `uniform float uTime, uHalf; uniform vec3 uA, uB; varying vec2 vP; varying float vPh;
      void main() {
        if (vP.x * uHalf < 0.) discard;
        vec2 q = vP / vec2(.42, 1.); float r = length(q), aa = fwidth(r) * .8;
        float d1 = abs(r - 3.), d2 = abs(r - 2.62);
        float outer = 1. - smoothstep(.08 - aa, .08 + aa, d1), inner = 1. - smoothstep(.035 - aa, .035 + aa, d2);
        float pulse = .8 + .2 * sin(uTime * 2.5 + vPh), dash = .55 + .45 * sin(atan(q.y, q.x + 1e-5) * 10. - uTime * 3.);
        vec3 c = uA * (outer + .25 * exp(-d1 * 4.)) * pulse + uB * inner * dash;
        gl_FragColor = vec4(c * (uHalf < 0. ? .5 : 1.), 0.);
      }`,
  });
  const ringGeo = new THREE.PlaneGeometry(3.2, 7);
  const ringsBack = add(new THREE.InstancedMesh(ringGeo, ringMat(-1), MAXR), 14);
  const ringsFront = add(new THREE.InstancedMesh(ringGeo, ringMat(1), MAXR), 19);
  ringsFront.instanceMatrix = ringsBack.instanceMatrix;
  ringsBack.count = ringsFront.count = 0;
  let itemMap = new Map();

  // ================================================================ GPU particles (one ring-buffer Points draw)
  const PN = phone ? 768 : 1536;
  const pa = new THREE.BufferAttribute(new Float32Array(PN * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const pb = new THREE.BufferAttribute(new Float32Array(PN * 4).fill(-99), 4).setUsage(THREE.DynamicDrawUsage);
  const pc = new THREE.BufferAttribute(new Float32Array(PN * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const pGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(PN * 3), 3))
    .setAttribute('pa', pa).setAttribute('pb', pb).setAttribute('pc', pc);
  // kinds: gravity, drag, size growth, additivity
  const KINDS = [new THREE.Vector4(5, 2.4, 2.4, 0.12), new THREE.Vector4(5, 1.3, 0.15, 1), new THREE.Vector4(-0.8, 2.4, 0.3, 1),
    new THREE.Vector4(9.8, 0.8, 1, 0.3), new THREE.Vector4(1.4, 2.8, 3.2, 0.1)];
  const SNOW = 0, SPARK = 1, GLITTER = 2, DEBRIS = 3, PUFF = 4;
  add(new THREE.Points(pGeo, new THREE.ShaderMaterial({
    ...PREMUL, depthTest: false, uniforms: { uTime: U.uTime, uScale: uPtScale, uKinds: { value: KINDS } },
    vertexShader: `attribute vec4 pa, pb, pc; uniform float uTime, uScale; uniform vec4 uKinds[5];
      varying vec4 vC; varying float vAdd, vStar;
      void main() {
        float age = uTime - pb.x;
        if (age < 0. || age > pb.y) { gl_Position = vec4(0., 0., -2., 1.); gl_PointSize = 0.; return; }
        vec4 k = uKinds[int(pb.w + .5)];
        float e = (1. - exp(-k.y * age)) / k.y, u = age / pb.y;
        vec2 vt = vec2(0., -k.x / k.y), p = pa.xy + (pa.zw - vt) * e + vt * age;
        vec4 mv = modelViewMatrix * vec4(p, .3, 1.);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min(256., pb.z * mix(1., k.z, u) * uScale / -mv.z);
        vC = vec4(pc.rgb, pc.a * (1. - u * u)); vAdd = k.w; vStar = step(1.5, pb.w) * step(pb.w, 2.5);
      }`,
    fragmentShader: `varying vec4 vC; varying float vAdd, vStar;
      void main() {
        vec2 p = gl_PointCoord * 2. - 1.; float r = length(p); if (r > 1.) discard;
        float a = pow(1. - r, 1.6) + vStar * .8 * max(0., 1. - abs(p.x * p.y) * 30.) * (1. - r);
        a *= vC.a;
        gl_FragColor = vec4(vC.rgb * a, a * (1. - vAdd));
      }`,
  })), 20);
  let pHead = 0, pLo = PN, pHi = -1;
  const emit = (kind, x, y, vx, vy, size, life, col, alpha = 1) => {
    const i = pHead; pHead = (pHead + 1) % PN;
    const A = pa.array, B = pb.array, Cc = pc.array, o = i * 4;
    A[o] = x; A[o + 1] = y; A[o + 2] = vx; A[o + 3] = vy;
    B[o] = U.uTime.value; B[o + 1] = life; B[o + 2] = size; B[o + 3] = kind;
    Cc[o] = col.r; Cc[o + 1] = col.g; Cc[o + 2] = col.b; Cc[o + 3] = alpha;
    if (i < pLo) pLo = i; if (i > pHi) pHi = i;
  };
  const burst = (n, kind, x, y, vx, vy, speed, size, life, col, alpha = 1) => { // spawn over a small disc: no additive hot spot
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, k = 0.3 + 0.7 * Math.random(), s = speed * k, r = size * 3 * Math.random();
      emit(kind, x + Math.cos(a) * r, y + Math.sin(a) * r, vx + Math.cos(a) * s, vy + Math.sin(a) * s, size * (0.6 + 0.8 * Math.random()), life * (0.6 + 0.6 * Math.random()), col, alpha);
    }
  };
  const flushParticles = () => {
    if (pHi < pLo) return;
    const o = pLo * 4, n = (pHi - pLo + 1) * 4;
    pa.addUpdateRange(o, n); pb.addUpdateRange(o, n); pc.addUpdateRange(o, n);
    pa.needsUpdate = pb.needsUpdate = pc.needsUpdate = true;
    pLo = PN; pHi = -1;
  };

  // ================================================================ FX rings (expanding shockwaves)
  const RN_ = 10, fA = new THREE.InstancedBufferAttribute(new Float32Array(RN_ * 4), 4), fB = new THREE.InstancedBufferAttribute(new Float32Array(RN_ * 4).fill(-99), 4);
  const fC = new THREE.InstancedBufferAttribute(new Float32Array(RN_ * 4), 4);
  const fxGeo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(2, 2));
  fxGeo.setAttribute('fA', fA).setAttribute('fB', fB).setAttribute('fC', fC); fxGeo.instanceCount = RN_;
  add(new THREE.Mesh(fxGeo, new THREE.ShaderMaterial({
    ...PREMUL, depthTest: false, uniforms: { uTime: U.uTime, uPxK: U.uPxK },
    vertexShader: `attribute vec4 fA, fB, fC; uniform float uTime, uPxK; varying vec2 vL, vRW; varying vec3 vC;
      void main() {
        float u = (uTime - fB.x) / fB.y;
        if (u < 0. || u > 1.) { gl_Position = vec4(0., 0., -2., 1.); return; }
        float R = fB.z * (1. - pow(1. - u, 3.)), w = fB.w * (1. - .5 * u), ext = R + w * 4.;
        vL = position.xy * ext; vRW = vec2(R, w); vC = fC.rgb * .5 * (1. - u) * (1. - u); // thin + dim: a hot ring would bloom into a disc
        vec2 q = vec2(vL.x, vL.y * fA.w), cs = vec2(cos(fA.z), sin(fA.z));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(fA.xy + vec2(q.x * cs.x - q.y * cs.y, q.x * cs.y + q.y * cs.x), .25, 1.);
      }`,
    fragmentShader: `varying vec2 vL, vRW; varying vec3 vC;
      void main() {
        float d = abs(length(vL) - vRW.x) / max(vRW.y, 1e-3), aa = fwidth(d);
        float core = 1. - smoothstep(1. - aa, 1. + aa, d), halo = .3 * exp(-d * 1.2);
        gl_FragColor = vec4(vC * (core + halo), 0.);
      }`,
  })), 21);
  let fxHead = 0;
  const ring = (x, y, R, w, dur, col, ang = 0, aspect = 1) => {
    const o = fxHead * 4, A = fA.array, B = fB.array, Cc = fC.array; fxHead = (fxHead + 1) % RN_;
    A[o] = x; A[o + 1] = y; A[o + 2] = ang; A[o + 3] = aspect; B[o] = U.uTime.value; B[o + 1] = dur; B[o + 2] = R; B[o + 3] = w;
    Cc[o] = col.r; Cc[o + 1] = col.g; Cc[o + 2] = col.b;
    fA.needsUpdate = fB.needsUpdate = fC.needsUpdate = true;
  };

  // ================================================================ air trail, speed lines, flash
  const TN_ = 64, trail = new Ribbon(TN_, ribbonMaterial(neon(TN.cyan, 2.2), neon(TN.magenta2, 1.6), 0.28), 0.02);
  add(trail.mesh, 15);
  const trailRing = new Float32Array(TN_ * 3); // x, y, t
  let trailHead = 0, trailN = 0, trailLive = false;

  const SLN = 40, slPos = new Float32Array(SLN * 12), slSeed = new Float32Array(SLN * 12), slIdx = [];
  for (let i = 0; i < SLN; i++) {
    const a = Math.random(), b = Math.random(), c = Math.random();
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([u, v], k) => { slPos.set([u, v, 0], (i * 4 + k) * 3); slSeed.set([a, b, c], (i * 4 + k) * 3); });
    slIdx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  }
  const slU = { uTime: U.uTime, uDir: { value: new THREE.Vector2(1, 0) }, uAlpha: { value: 0 }, uAspect, uRider: { value: new THREE.Vector2() }, uCol: { value: neon(TN.blue6, 0.75) } };
  const speedLines = add(new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(slPos, 3)).setAttribute('seed', new THREE.BufferAttribute(slSeed, 3)).setIndex(slIdx),
    new THREE.ShaderMaterial({
      ...PREMUL, depthTest: false, uniforms: slU,
      vertexShader: `attribute vec3 seed; uniform float uTime, uAlpha, uAspect; uniform vec2 uDir, uRider; varying float vA, vU;
        void main() {
          vec2 d = uDir, n = vec2(-d.y, d.x);
          float lane = seed.x * 2. - 1., len = .08 + .18 * seed.z;
          float along = fract(seed.y - uTime * (1.4 + seed.z)) * 3.2 - 1.6;
          vec2 c = n * lane * 1.25 + d * along;
          vec2 p = c + d * position.x * len + n * position.y * .0025;
          vec2 s = vec2(p.x / uAspect, p.y);
          vec2 rc = vec2(c.x / uAspect, c.y) - uRider;
          vA = uAlpha * smoothstep(.18, .5, length(rc * vec2(uAspect, 1.))) * (.4 + .6 * seed.z); vU = position.x;
          gl_Position = vec4(s, 0., 1.);
        }`,
      fragmentShader: `uniform vec3 uCol; varying float vA, vU; void main() { gl_FragColor = vec4(uCol * vA * (.5 - .5 * vU), 0.); }`,
    })), 22);
  speedLines.visible = false;
  const flashU = { uCol: { value: new THREE.Color() } };
  const flash = add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    ...PREMUL, depthTest: false, uniforms: flashU,
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: 'uniform vec3 uCol; void main() { gl_FragColor = vec4(uCol, 0.); }',
  })), 23);
  flash.visible = false;
  const flashCol = new THREE.Color();

  // ================================================================ Tokyo Tower searchlights (seen from far away)
  const SL_Y = T.h(TOWER_X) - 25 + 232, slBuf = new THREE.BufferAttribute(new Float32Array(8 * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const searchlights = add(new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', slBuf)
    .setAttribute('uv', new THREE.Float32BufferAttribute([0, -1, 0, 1, 1, -1, 1, 1, 0, -1, 0, 1, 1, -1, 1, 1], 2)).setIndex([0, 2, 1, 1, 2, 3, 4, 6, 5, 5, 6, 7]),
  new THREE.ShaderMaterial({
    ...PREMUL, uniforms: { uCol: { value: neon(TN.orange, 0.2) } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `uniform vec3 uCol; varying vec2 vUv;
      void main() { float u = vUv.x; gl_FragColor = vec4(uCol * pow(1. - u, 1.3) * (1. - vUv.y * vUv.y) * smoothstep(0., .02, u), 0.); }`,
  })), 9);
  const aimBeams = t => {
    const P = slBuf.array;
    for (let b = 0; b < 2; b++) { // two slow crossing sweeps above the top deck
      const a = Math.PI / 2 + (b ? -0.42 : 0.42) + 0.3 * Math.sin(t * 0.19 + b * 2.4), L = 900;
      const ca = Math.cos(a), sa = Math.sin(a), o = b * 12, w = L * 0.035;
      P[o] = TOWER_X - sa * 1.5; P[o + 1] = SL_Y + ca * 1.5; P[o + 3] = TOWER_X + sa * 1.5; P[o + 4] = SL_Y - ca * 1.5;
      P[o + 6] = TOWER_X + ca * L - sa * w; P[o + 7] = SL_Y + sa * L + ca * w; P[o + 9] = TOWER_X + ca * L + sa * w; P[o + 10] = SL_Y + sa * L - ca * w;
      P[o + 2] = P[o + 5] = P[o + 8] = P[o + 11] = TOWER_Z;
    }
    slBuf.needsUpdate = true;
  };

  // ================================================================ rider
  const rider = createRider();
  scene.add(rider.group); add(rider.scarf, 16); // (a Group's renderOrder would re-sort all its children)

  // ================================================================ API
  // per-frame scalars: object fields are updated in place by V8, closure `let` doubles get re-boxed on every write
  const F = { t: 0.5, lastA: 0.5, spray: 0.5, spark: 0.5, light: 0.5, flash: 0.5, kick: 0.5, mile: 0.5, mileX: 0.5, trailLast: 0.5 };
  for (const k in F) F[k] = 0;
  const QCOL = { perfect: neon(TN.green1, 2.2), good: neon(TN.blue, 2), sketchy: neon(TN.orange, 2), crash: neon(TN.red, 2.2) };
  const SNOWC = C(TN.fg, 0.95), SNOWD = C(TN.blue5, 0.6), WARM = neon(TN.yellow, 2.2), PINK = neon(TN.magenta2, 1.6), CYAN = neon(TN.cyan, 2.2), WHITE = neon(TN.fg, 2.2);
  const scale = h => Math.max(1, (0.035 * h) / 1.6); // rider ≥ ~3.5 % of the view height
  const SPARK_RATE = [0, 110, 45, 35, 80], FLASH_POP = neon(TN.fg, 0.045), FLASH_CRASH = neon(TN.red, 0.1), RED = neon(TN.red, 1.8);

  function setLoadout(levels) {
    rider.setLoadout(levels);
    gateSel = levels.gate | 0;
    const A = worldCol.array;
    toriiRange.forEach(([a, b], i) => { const k = i === gateSel ? 2.4 : 1; for (let v = a * 4; v < b * 4; v += 4) { A[v] = baseCol[v] * k; A[v + 1] = baseCol[v + 1] * k; A[v + 2] = baseCol[v + 2] * k; } });
    worldCol.needsUpdate = true;
    layoutLabels();
  }

  function startRun({ items = [], best = 0 } = {}) {
    itemMap = new Map();
    let nl = 0, nr = 0;
    for (const it of items) {
      if (it.kind === 'ring' && nr < MAXR) { ringsBack.setMatrixAt(nr, m4.makeTranslation(it.x, it.y, 0)); itemMap.set(it.id, { ring: true, i: nr++, x: it.x, y: it.y }); }
      else if (it.kind !== 'ring' && nl < MAXL) { lanterns.setMatrixAt(nl, m4.makeTranslation(it.x, it.y, 0)); itemMap.set(it.id, { ring: false, i: nl++, x: it.x, y: it.y }); }
    }
    lanterns.count = nl; ringsBack.count = ringsFront.count = nr;
    lanterns.instanceMatrix.needsUpdate = ringsBack.instanceMatrix.needsUpdate = true;
    bestX = best; layoutLabels();
    setBeam(0, best, 34, 0.06, GOLD, best >= 5 ? 1 : 0);
    trailN = 0; trailLive = false; trail.commit(0);
    rider.reset();
  }

  function collect(id) {
    const e = itemMap.get(id);
    if (!e) return;
    const im = e.ring ? ringsBack : lanterns;
    im.setMatrixAt(e.i, ZERO); im.instanceMatrix.addUpdateRange(e.i * 16, 16); im.instanceMatrix.needsUpdate = true;
    if (e.ring) {
      burst(20, SPARK, e.x, e.y, 0, 0, 11, 0.16, 0.5, PINK); burst(14, GLITTER, e.x, e.y, 0, 0, 6, 0.16, 0.7, CYAN);
      ring(e.x, e.y, 5, 0.08, 0.45, PINK, 0, 1); F.kick = Math.max(F.kick, 0.25);
    } else {
      burst(16, GLITTER, e.x, e.y, 0, 0, 4, 0.18, 0.6, WARM); ring(e.x, e.y, 1.6, 0.05, 0.3, WARM);
    }
  }

  function fx(type, d = {}) {
    const x = d.x ?? 0, y = d.y ?? 0, s = scale(uH.value);
    switch (type) {
      case 'pop':
        rider.kick(0.22);
        burst(10, GLITTER, x, y + 0.3, 0, 1, 6, 0.12 * s, 0.5, CYAN, 0.8);
        ring(x, y + 0.4, 2.2 * s, 0.04 * s, 0.3, CYAN);
        if (d.perfect) {
          burst(18, GLITTER, x, y + 0.5, 3, 2, 10, 0.13 * s, 0.7, CYAN, 0.7); burst(10, SPARK, x, y + 0.3, 2, 1, 12, 0.1 * s, 0.4, CYAN);
          ring(x, y + 0.5, 4.5 * s, 0.05 * s, 0.4, WHITE); flashCol.copy(FLASH_POP); F.flash = 1; F.kick = Math.max(F.kick, 0.35);
        }
        break;
      case 'launch':
        burst(16, SNOW, x - 0.3, y, 2, 3, 4, 0.3 * s, 0.7, SNOWC, 0.7);
        ring(x, y, 1.8 * s, 0.05 * s, 0.3, CYAN, 0, 0.35);
        break;
      case 'land': {
        const vn = d.vn ?? 4, sl = d.slope ?? 0, cs = Math.cos(sl), sn = Math.sin(sl), col = QCOL[d.quality] ?? QCOL.good;
        const n = Math.min(120, 24 + vn * 7), sp = Math.min(3, 0.6 + vn * 0.12), v = d.speed ?? 10;
        for (let i = 0; i < n; i++) {
          const f = (Math.random() * 2 - 1), up = 1.5 + Math.random() * 4 * sp;
          emit(i % 3 ? SNOW : PUFF, x + f * 0.6 * s, y + 0.1, cs * (f * 5 * sp + v * 0.35) - sn * up, sn * (f * 5 * sp + v * 0.35) + cs * up,
            (i % 3 ? 0.3 : 0.7) * s * (0.6 + Math.random() * 0.8), 0.5 + Math.random() * 0.7, i % 3 ? SNOWC : SNOWD, 0.85);
        }
        burst(d.quality === 'perfect' ? 30 : 12, GLITTER, x, y + 0.3, cs * v * 0.3, sn * v * 0.3, 5, 0.18 * s, 0.7, col);
        ring(x, y, (1.4 + vn * 0.3) * s, 0.045 * s, 0.35, col, sl, 0.12);
        rider.kick(-Math.min(0.32, 0.08 + vn * 0.02));
        F.kick = Math.max(F.kick, 0.2 + Math.min(0.5, vn * 0.04) + (d.quality === 'perfect' ? 0.35 : 0));
        break;
      }
      case 'crash': {
        const v = d.speed ?? 10;
        rider.crash(v);
        burst(70, DEBRIS, x, y + 0.3, v * 0.3, 3, 7, 0.3 * s, 1.1, SNOWC, 0.9);
        burst(16, SPARK, x, y + 0.4, v * 0.2, 2, 9, 0.14 * s, 0.5, PINK);
        ring(x, y + 0.3, 3.2 * s, 0.06 * s, 0.45, RED);
        F.kick = Math.max(F.kick, 0.4); flashCol.copy(FLASH_CRASH); F.flash = 0.7;
        break;
      }
      case 'milestone':
        burst(16, GLITTER, x, y + 0.5, 0, 0, 9, 0.13 * s, 0.9, MILE, 0.7);
        ring(x, y + 0.5, 4 * s, 0.05 * s, 0.5, MILE);
        F.mileX = d.dist ?? x; F.mile = 1; uFlare.value.set(F.mileX, U.uTime.value); F.kick = Math.max(F.kick, 0.35);
        break;
    }
  }

  let dprSeen = 0;
  function resize() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    dprSeen = devicePixelRatio;
    const dpr = Math.min(devicePixelRatio || 1, 2, Math.sqrt(3.5e6 / (w * h)));
    renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
    composer.setPixelRatio(dpr); composer.setSize(w, h);
    camera.aspect = uAspect.value = w / h; camera.updateProjectionMatrix();
    U.uPxK.value = K / h; uPtScale.value = (h * dpr) / K;
  }

  function frame(dt, r, cam) {
    if (devicePixelRatio !== dprSeen) resize(); // moved to another display: no resize event guaranteed
    renderer.info.reset();
    dt = Math.min(Math.max(dt, 0), 0.1); F.t += dt; U.uTime.value = F.t;
    const roll = cam.roll || 0, D = cam.h / K, s = scale(cam.h);
    camera.position.set(cam.x, cam.y, D); camera.rotation.z = roll;
    camera.near = Math.min(6, Math.max(0.5, D * 0.05)); camera.far = D + 30000; camera.updateProjectionMatrix(); // backdrop snow lives ≥ 7 m from the eye
    uH.value = cam.h; fill.material.uniforms.uPx.value = D * U.uPxK.value;
    const hw = cam.h * 0.5 * (camera.aspect * Math.abs(Math.cos(roll)) + Math.abs(Math.sin(roll)));
    stream(cam.x - hw - 8, cam.x + hw + 8);
    backdrop.update(dt, F.t);
    searchlights.visible = Math.abs(cam.x - TOWER_X) < 1200;
    if (searchlights.visible) aimBeams(F.t);

    // rider + scarf + light pool on the snow
    rider.update(dt, r, s, F.t);
    F.light += ((r.ground && !r.crashed ? 0.35 + Math.min(0.65, r.speed / 25) : 0) - F.light) * (1 - Math.exp(-dt * 8));
    uRider.value.set(r.x, r.y + 0.3, F.light);

    // snow spray while grounded (maglev hovers: cyan sparkle instead), heavier in a tuck or a carve
    const ca = Math.cos(r.a), sa = Math.sin(r.a), turn = Math.abs(r.a - F.lastA) / Math.max(dt, 1e-3); F.lastA = r.a;
    if (r.ground && r.speed > 2) {
      F.spray += dt * r.speed * (r.crashed ? 10 : r.tuck ? 7 : 4.5) * (1 + Math.min(2, turn * 0.8));
      const maglev = rider.sled === 5 && !r.crashed;
      for (; F.spray >= 1; F.spray--) {
        const bx = r.x - ca * 0.45 * s, by = r.y - sa * 0.45 * s, k = 0.25 + Math.random() * 0.4, up = 0.8 + Math.random() * (r.tuck ? 3.2 : 2.2);
        if (maglev) emit(GLITTER, bx, by + 0.15 * s, -ca * r.speed * 0.2, 0.6, 0.12 * s, 0.4, CYAN, 0.7);
        else emit(r.crashed ? DEBRIS : SNOW, bx, by + 0.05, -ca * r.speed * k - sa * up, -sa * r.speed * k + ca * up, (r.tuck ? 0.34 : 0.26) * s * (0.6 + Math.random()), 0.45 + Math.random() * 0.45, SNOWC, 0.75);
      }
    } else F.spray = 0;
    // booster sparks
    const wv = rider.world;
    if (wv.flame > 0.3) {
      F.spark += dt * SPARK_RATE[wv.tier] * wv.flame;
      for (; F.spark >= 1; F.spark--) {
        const a = wv.nozzleA + (Math.random() - 0.5) * 0.5, v = 4 + Math.random() * 7;
        emit(SPARK, wv.x, wv.y, r.vx * 0.6 + Math.cos(a) * v, r.vy * 0.6 + Math.sin(a) * v, (wv.tier === 1 ? 0.14 : 0.1) * s, 0.25 + Math.random() * 0.35, wv.spark);
      }
    } else F.spark = 0;
    flushParticles();

    // air trail from the body centre
    const bx = r.x - ca * 0.5 * s - sa * 0.35 * s, by = r.y - sa * 0.5 * s + ca * 0.35 * s;
    if (!r.ground && !r.crashed) {
      if (!trailLive) { trailLive = true; trailN = 0; }
      if (trailN === 0 || F.t - F.trailLast > 1 / 45) { trailHead = (trailHead + 1) % TN_; trailN = Math.min(TN_, trailN + 1); F.trailLast = F.t; }
      trailRing[trailHead * 3] = bx; trailRing[trailHead * 3 + 1] = by; trailRing[trailHead * 3 + 2] = F.t;
    } else trailLive = false;
    if (trailN > 1) {
      const P = trail.pts;
      for (let i = 0; i < trailN; i++) {
        const j = ((trailHead - i) % TN_ + TN_) % TN_, u = Math.min(1, (F.t - trailRing[j * 3 + 2]) / 1.1);
        P[i * 4] = trailRing[j * 3]; P[i * 4 + 1] = trailRing[j * 3 + 1]; P[i * 4 + 2] = u < 1 ? 0.12 * s * Math.sqrt(1 - u) * Math.min(1, i / 6) : 0; P[i * 4 + 3] = u;
      }
      trail.commit(trailN);
    }

    // speed lines (screen space), bloom kick, flash, milestone beam
    const v = r.speed, sl = 0.7 * Math.min(1, Math.max(0, (v - 25) / 25));
    slU.uAlpha.value += (sl - slU.uAlpha.value) * (1 - Math.exp(-dt * 5));
    speedLines.visible = slU.uAlpha.value > 0.01;
    if (v > 1) slU.uDir.value.set(r.vx / v, r.vy / v);
    slU.uRider.value.set(((r.x - cam.x) / cam.h) * 2 / camera.aspect, ((r.y - cam.y) / cam.h) * 2);
    F.kick *= Math.exp(-dt * 3.5); bloom.strength = BLOOM + F.kick;
    F.flash *= Math.exp(-dt * 14); flash.visible = F.flash > 0.01; flashU.uCol.value.copy(flashCol).multiplyScalar(F.flash);
    if (F.mile > 0) { F.mile = Math.max(0, F.mile - dt * 0.9); setBeam(1, F.mileX, 60, 0.1, MILE, F.mile * F.mile); }

    composer.render(dt);
  }

  // precompile every material against the composer target (the one the scene renders into)
  resize();
  renderer.setRenderTarget(composer.readBuffer);
  renderer.compileAsync(scene, camera).catch(() => {});
  renderer.setRenderTarget(null);

  return { setLoadout, startRun, collect, fx, frame, resize, debug: { renderer, scene, camera, composer } };
}

// Tokyo Tower: orange/white lattice of neon strokes, lit decks, blinking antenna, warm halo visible from afar.
function buildTower(a, X, Y, Z) {
  a.z = Z;
  const hw = y => (y < 120 ? 6.5 + 36 * (1 - y / 120) ** 2.1 : y < 132 ? 11 : y < 220 ? 6.2 - (2.6 * (y - 132)) / 88 : y < 228 ? 4.8 : 2.8 - (1.4 * (y - 228)) / 34);
  const LV = [0, 7, 14, 21, 29, 37, 46, 55, 65, 75, 86, 97, 108, 120, 132, 143, 154, 165, 176, 187, 198, 209, 220, 228, 239, 250, 262];
  const WHITE = neon(TN.fg, 1.25), ORANGE = neon(TN.orange, 1.1), DIM = neon(TN.orange, 0.75), halo = neon(TN.orange, 0.034), z0 = C(0);
  const band = y => ((y >= 46 && y < 55) || (y >= 86 && y < 97) || (y >= 154 && y < 165) || (y >= 198 && y < 209) || y >= 239 ? WHITE : ORANGE);
  const ring = [], cols = [];
  for (let i = 0; i < 24; i++) { // halo fan
    const a0 = (i / 24) * Math.PI * 2, a1 = ((i + 1) / 24) * Math.PI * 2, R = 640;
    ring.push(X, Y + 150, X + Math.cos(a0) * R, Y + 150 + Math.sin(a0) * R * 0.8, X + Math.cos(a1) * R, Y + 150 + Math.sin(a1) * R * 0.8);
    cols.push(halo, z0, z0);
  }
  a.glow(ring, cols);
  for (const sx of [-1, 1]) {
    const leg = [];
    for (let y = 0; y <= 262; y += 3) leg.push(X + sx * hw(y), Y + y);
    a.line(leg, ORANGE, 0.45);
  }
  for (let i = 0; i < LV.length - 1; i++) {
    const y0 = LV[i], y1 = LV[i + 1], w0 = hw(y0 + 0.01), w1 = hw(y1 - 0.01), c = band(y0);
    if (y0 === 120 || y0 === 220) continue; // decks
    a.line([X - w0, Y + y0, X + w0, Y + y0], c, 0.22);
    a.line([X - w0, Y + y0, X + w1, Y + y1], c === WHITE ? c : DIM, 0.14).line([X + w0, Y + y0, X - w1, Y + y1], c === WHITE ? c : DIM, 0.14);
    if (y0 < 120) a.line([X - w0 * 0.5, Y + y0, X - w1 * 0.5, Y + y1], DIM, 0.1).line([X + w0 * 0.5, Y + y0, X + w1 * 0.5, Y + y1], DIM, 0.1);
  }
  a.line(arc(X, Y, 26, 40, 0, Math.PI, 16), ORANGE, 0.35);
  for (const [y0, y1, w, win] of [[120, 132, 11.5, neon(TN.yellow, 2.4)], [220, 228, 5.2, neon(TN.blue6, 2.6)]]) {
    a.shape([X - w, Y + y0, X + w, Y + y0, X + w, Y + y1, X - w, Y + y1], C(TN.bg_dark1), WHITE, 0.25, 0.9);
    for (let y = y0 + 3; y < y1 - 1; y += 4) a.line([X - w + 1, Y + y, X + w - 1, Y + y], win, 0.28);
    a.dot(X - w, Y + y1, 2.5, neon(TN.red, 3), 1, 1).dot(X + w, Y + y1, 2.5, neon(TN.red, 3), 1, 1);
  }
  for (let y = 262; y < 300; y += 6) a.line([X, Y + y, X, Y + Math.min(300, y + 6)], (y / 6) % 2 ? WHITE : ORANGE, 0.3);
  a.dot(X, Y + 301, 5, neon(TN.red, 4), 1, 1);
}
