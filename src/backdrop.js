// Tokyo Night backdrop: everything behind the gameplay plane (z ≤ −45) plus camera-relative weather.
// Sky + moon + stars (screen quad, drawn last), Fuji & ranges (ridge strip built in the vertex shader), cloud belts,
// four parallax skyline layers painted once into canvas textures (neon pixels get an HDR boost → bloom),
// serpentine neon dragons (one mesh), hanabi, lightning, and sakura petals / rain with speed streaks.
// No allocations per frame. createBackdrop(scene, camera, hooks) -> { update(dt), setLook, escort, strike }: call update
// after the camera is placed each frame; keeps its own clock from dt (a second `t` argument is accepted and ignored,
// so a per-run timer can't stall the schedules). hooks.bolt(delay, k) fires on every lightning strike. Seeded.
// The Dragon class and its mesh are exported: the player's own dragon form is built with them.
import * as THREE from 'three';

const TN = {
  bg_dark1: '#0c0e14', blue: '#7aa2f7', blue1: '#2ac3de', blue5: '#89ddff', cyan: '#7dcfff', teal: '#1abc9c',
  green1: '#73daca', magenta: '#bb9af7', magenta2: '#ff007c', purple: '#9d7cd8', orange: '#ff9e64', yellow: '#e0af68',
  red: '#f7768e', fg: '#c0caf5',
};
const BASE = -80; // street level of the city in the valley below the hills (m)
const JP = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic","Meiryo","Noto Sans CJK JP","Noto Sans JP",sans-serif';

const lin = hex => new THREE.Color(hex);
const neon = (hex, lum = 1) => { const c = new THREE.Color(hex); return c.multiplyScalar(lum / (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b)); };
const vivid = hex => { const c = new THREE.Color(hex); return '#' + c.multiplyScalar(1 / Math.max(c.r, c.g, c.b)).getHexString(); };
const dim = (hex, k) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
function rng(seed) { // mulberry32
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NEON = [TN.cyan, TN.blue1, TN.blue5, TN.blue, TN.magenta, TN.magenta2, TN.purple, TN.green1, TN.blue1, TN.magenta2,
  TN.cyan, TN.orange, TN.yellow, TN.red].map(vivid);
const WARM = ['#b08850', '#a67c48', '#b8914f', '#9c6a40', '#b89868'];
const COOL = ['#6d88b8', '#6a92b8', '#8a9cc0', '#5f9aa8', '#8088c0'];
const WORDS_V = ['居酒屋', 'ラーメン', 'カラオケ', 'ネオン', '東京', '龍', '夜', '寿司', '酒場', 'ホテル', '喫茶', '焼鳥', '花見', '夢'];
const WORDS_H = ['東京', 'ラーメン', 'カラオケ', 'ネオン', '居酒屋', '龍', '夜', 'TOKYO', 'BAR', 'HOTEL', '渋谷', '新宿', '24H', '夜景'];
const WORDS_ROOF = ['東京', 'TOKYO', 'BAR', 'HOTEL', 'ネオン', 'カラオケ', 'ラーメン', '24H', '夜']; // few strokes: stays legible when small

const GL_NOISE = `
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f *= f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + 1.), f.x), f.y); }`;
const WORLD_VS = `varying vec2 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.); vW = w.xy; gl_Position = projectionMatrix * viewMatrix * w; }`;
const PREMUL = { transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor };

// ------------------------------------------------------------------ skyline layers
// Layers are designed in screen space: from the lip, each farther layer's roofline sits higher on screen,
// so every layer peeks over the one in front; bases share one street level so the city reads as a valley.
const LAYERS = [
  { z: -180, rho: 5, px: 640, seed: 11, minH: 30, maxH: 82, tallH: 106, tallP: .06, minW: 10, maxW: 26, gap: 7, floor: 3.4, col: 2.3,
    body: ['#0d0e16', '#10111b', '#12131f', '#0b0c13'], rim: '#1c1f33', snow: '#646b8e', unlit: '#171a29',
    vsign: .5, hsign: .28, board: .14, tank: .25, mast: .15, shrine: .05, roof: .14, edge: .15, pagodas: 2, shop: true, mips: true,
    neon: 2.1, fog: .02, valley: .55, fogH: 45 },
  { z: -520, rho: 3, px: 512, seed: 23, minH: 30, maxH: 84, tallH: 134, tallP: .08, minW: 14, maxW: 34, gap: 9, floor: 3.6, col: 2.6,
    body: ['#131523', '#161829', '#181b2e', '#111320'], rim: '#23273e', snow: '#565d80', unlit: '#1b1e30',
    vsign: .45, roof: .2, board: .12, tank: .15, mast: .2, crown: .1, edge: .15, viaduct: 20, shop: true, mips: true,
    neon: 1.9, fog: .1, valley: .6, fogH: 70 },
  { z: -1300, rho: 1.25, px: 384, seed: 37, minH: 60, maxH: 172, tallH: 238, tallP: .07, minW: 22, maxW: 55, gap: 12, floor: 4.2, col: 3.2,
    body: ['#1a1e33', '#1d2138', '#20253d'], rim: '#2a2f4c', snow: '#4d5578', mast: .2, crown: .45, edge: .12,
    neon: 1.7, fog: .22, valley: .5, fogH: 120, lights: .15 },
  { z: -2800, rho: .5, px: 320, seed: 53, minH: 170, maxH: 380, tallH: 470, tallP: .05, minW: 40, maxW: 110, gap: 25, floor: 6, col: 5,
    body: ['#222744', '#252a4a', '#282e50'], rim: '#30365a', snow: '#474f72', mast: .25, crown: .3, skytree: 900,
    neon: 1.35, fog: .42, valley: .45, fogH: 220, lights: .15 },
];

// Paints one seamless skyline tile (4096 px wide). Units in meters; y is height above the street.
// Plain colors stay ≤ #b8 per channel; saturated full-intensity colors are "neon" and get boosted in the shader.
function paintSkyline(o) {
  const { rho } = o, W = 4096, H = o.px, TW = W / rho, r = rng(o.seed), dark = o.body[0];
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const pick = a => a[Math.floor(r() * a.length)];
  const X = m => m * rho, Y = m => H - m * rho;
  const rect = (x, y, w, h, c) => {
    g.fillStyle = c; const x0 = Math.round(X(x)), y0 = Math.round(Y(y + h));
    g.fillRect(x0, y0, Math.max(1, Math.round(X(x + w)) - x0), Math.max(1, Math.round(Y(y)) - y0));
  };
  const font = m => { g.font = `bold ${Math.round(X(m))}px ${JP}`; g.textAlign = 'center'; g.textBaseline = 'middle'; };
  const beacon = (x, y) => rect(x - Math.max(.8, 1 / rho), y, Math.max(1.6, 2 / rho), Math.max(1.6, 2 / rho), '#ff0000');

  const windows = (x, w, h) => {
    const style = r(), fh = o.floor, cw = o.col * (.85 + r() * .4), n = Math.floor((w - 2) / cw), x0 = x + (w - n * cw) / 2;
    const lit = .1 + r() * .45, tint = r() < .1 ? dim(pick(NEON), .42) : null, pal = r() < .55 ? WARM : COOL, cA = tint || pick(pal), cB = pick(pal);
    if (style > .85 && n > 2) { // modern tower: vertical light strips
      for (let i = 0; i < n; i += 2) rect(x0 + i * cw + cw * .4, 4, Math.max(cw * .18, .8 / rho), h - 6, cB);
      return;
    }
    for (let y = 4.5; y + fh < h - 1.5; y += fh) {
      const floorOn = r() < lit;
      for (let i = 0; i < n; i++) {
        const band = style < .3, on = band ? floorOn && r() < .96 : r() < lit;
        if (on) rect(x0 + i * cw + (band ? cw * .06 : cw * .2), y + fh * .28, band ? cw * .88 : cw * .6, fh * .46, r() < .8 ? cA : cB);
        else if (o.unlit && !band) rect(x0 + i * cw + cw * .2, y + fh * .28, cw * .6, fh * .46, o.unlit);
      }
    }
  };
  const vsign = (x, top, w, text, col) => { // tate-kanban: dark board, neon frame, vertical glyphs
    const ch = [...text], cs = w * .74, h = ch.length * cs * 1.12 + w * .4, y = top - h;
    if (y < 4) return;
    rect(x, y, w, h, '#07080d');
    g.strokeStyle = col; g.lineWidth = Math.max(1, X(w * .07));
    g.strokeRect(X(x + w * .12), Y(top - w * .12), X(w * .76), X(h - w * .24));
    if (X(cs) < 9) return rect(x + w * .38, y + w * .35, w * .24, h - w * .7, col);
    g.fillStyle = col; font(cs);
    ch.forEach((c, i) => g.fillText(c, X(x + w / 2), Y(top - w * .2 - cs * 1.12 * (i + .5))));
  };
  const hsign = (cx, y, text, col, fs, lit) => { // horizontal board; lit = backlit panel with dark letters
    font(fs); const w = g.measureText(text).width / rho + fs * .9, h = fs * 1.45;
    rect(cx - w / 2, y, w, h, lit ? dim(col, .38) : '#07080d');
    if (!lit) { g.strokeStyle = col; g.lineWidth = Math.max(1, X(fs * .08)); g.strokeRect(X(cx - w / 2 + fs * .12), Y(y + h - fs * .12), X(w - fs * .24), X(h - fs * .24)); }
    if (X(fs) < 8) return;
    g.fillStyle = lit ? '#0b0c12' : col; g.fillText(text, X(cx), Y(y + h / 2));
  };
  const tank = (cx, y, s) => { // rooftop water tank on legs
    rect(cx - s * .45, y, s * .1, s * .8, dark); rect(cx + s * .35, y, s * .1, s * .8, dark);
    rect(cx - s * .5, y + s * .75, s, s * .95, dark);
    g.fillStyle = dark; g.beginPath(); g.moveTo(X(cx - s * .56), Y(y + s * 1.7)); g.lineTo(X(cx), Y(y + s * 2.05)); g.lineTo(X(cx + s * .56), Y(y + s * 1.7)); g.fill();
    g.strokeStyle = o.snow; g.lineWidth = Math.max(1, X(.3)); g.beginPath(); g.moveTo(X(cx - s * .56), Y(y + s * 1.7)); g.lineTo(X(cx), Y(y + s * 2.05)); g.lineTo(X(cx + s * .56), Y(y + s * 1.7)); g.stroke();
  };
  const torii = (cx, y, h) => {
    const c = '#b03c32', w = h * 1.2, p = h * .085;
    rect(cx - w * .36 - p / 2, y, p, h * .86, c); rect(cx + w * .36 - p / 2, y, p, h * .86, c);
    rect(cx - w * .45, y + h * .62, w * .9, h * .07, c); rect(cx - p * .35, y + h * .69, p * .7, h * .16, c);
    g.fillStyle = c; g.beginPath();
    g.moveTo(X(cx - w * .56), Y(y + h * 1.02)); g.quadraticCurveTo(X(cx), Y(y + h * .84), X(cx + w * .56), Y(y + h * 1.02));
    g.lineTo(X(cx + w * .5), Y(y + h * .86)); g.quadraticCurveTo(X(cx), Y(y + h * .76), X(cx - w * .5), Y(y + h * .86)); g.fill();
    g.strokeStyle = o.snow; g.lineWidth = Math.max(1, X(.35)); g.beginPath();
    g.moveTo(X(cx - w * .56), Y(y + h * 1.02)); g.quadraticCurveTo(X(cx), Y(y + h * .84), X(cx + w * .56), Y(y + h * 1.02)); g.stroke();
  };
  const lanterns = (x0, y0, x1, y1, sag) => { // festival string of paper lanterns
    const n = Math.max(3, Math.round(Math.abs(x1 - x0) / 2.2));
    g.strokeStyle = '#05060a'; g.lineWidth = 1; g.beginPath();
    for (let i = 0; i <= n; i++) { const u = i / n, x = x0 + (x1 - x0) * u, y = y0 + (y1 - y0) * u - sag * 4 * u * (1 - u); i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)); }
    g.stroke();
    for (let i = 1; i < n; i++) {
      const u = i / n, x = x0 + (x1 - x0) * u, y = y0 + (y1 - y0) * u - sag * 4 * u * (1 - u);
      g.fillStyle = i % 3 ? '#ff5a3c' : '#ffb070'; g.beginPath(); g.ellipse(X(x), Y(y - .6), X(.32), X(.45), 0, 0, 7); g.fill();
    }
  };
  const pagoda = (cx, Ht) => { // five-storey pagoda, eaves strung with lanterns; returns its spire top
    const sp = Ht * .22, th = (Ht - sp) / 5;
    for (let i = 0; i < 5; i++) {
      const y = i * th, k = 1 - i * .1, bw = Ht * .17 * k, rw = Ht * .42 * k, e = y + th * .55, top = y + th, up = th * .3;
      rect(cx - bw / 2, y, bw, th, dark);
      rect(cx - bw * .3, y + th * .12, bw * .6, th * .2, '#9a6a3c');
      const roof = () => {
        g.moveTo(X(cx - rw / 2), Y(e + up)); g.quadraticCurveTo(X(cx - rw * .2), Y(e + up * .1), X(cx - bw * .55), Y(top));
        g.lineTo(X(cx + bw * .55), Y(top)); g.quadraticCurveTo(X(cx + rw * .2), Y(e + up * .1), X(cx + rw / 2), Y(e + up));
      };
      g.fillStyle = dark; g.beginPath(); roof(); g.quadraticCurveTo(X(cx), Y(e - up * .9), X(cx - rw / 2), Y(e + up)); g.fill();
      g.strokeStyle = o.snow; g.lineWidth = Math.max(1, X(.35)); g.beginPath(); roof(); g.stroke();
      for (let j = 1; j < 9; j++) {
        const u = j / 9, yy = (e + up) * ((1 - u) ** 2 + u * u) + (e - up * .9) * 2 * u * (1 - u);
        g.fillStyle = j % 2 ? '#ffb070' : '#ff5a3c'; g.beginPath(); g.ellipse(X(cx + rw / 2 - rw * u), Y(yy - .7), X(.3), X(.42), 0, 0, 7); g.fill();
      }
    }
    rect(cx - .3, Ht - sp, .6, sp, dark);
    for (let j = 0; j < 9; j++) rect(cx - 1, Ht - sp * (.85 - j * .07), 2, .3, dark);
    return Ht;
  };
  const skytree = (cx, Ht) => {
    const prof = [[0, 70], [.3, 42], [.55, 26], [.72, 17], [.86, 11], [.9, 6], [1, 2.5]];
    g.fillStyle = dark; g.beginPath();
    prof.forEach(([f, w], i) => (i ? g.lineTo(X(cx - w / 2), Y(f * Ht)) : g.moveTo(X(cx - w / 2), Y(0))));
    [...prof].reverse().forEach(([f, w]) => g.lineTo(X(cx + w / 2), Y(f * Ht)));
    g.fill();
    rect(cx - 27, Ht * .55, 54, 16, dark); rect(cx - 20, Ht * .7, 40, 10, dark);
    g.strokeStyle = '#4f78a8'; g.lineWidth = 1;
    for (const s of [-1, 1]) { g.beginPath(); prof.slice(0, 5).forEach(([f, w], i) => (i ? g.lineTo(X(cx + s * w * .32), Y(f * Ht)) : g.moveTo(X(cx + s * w * .32), Y(0)))); g.stroke(); }
    rect(cx - 25, Ht * .55 + 6, 50, 3, vivid(TN.cyan)); rect(cx - 18, Ht * .7 + 4, 36, 2.5, vivid(TN.magenta));
    beacon(cx, Ht * .93); beacon(cx, Ht);
  };

  // pagodas get a gap in the street; everything else is a run of buildings
  const pag = [], pagIdx = [], tops = [];
  const pT = o.tank || 0, pM = o.mast || 0, pS = o.shrine || 0, pR = o.roof || 0;
  for (let i = 0; i < (o.pagodas || 0); i++) pag.push(TW * (.2 + i * .5 + r() * .15));
  for (let x = 2; x < TW - o.maxW * .6;) {
    if (pag.length && pag[0] < x + 30) {
      pag.shift();
      const top = pagoda(x + 16, 50 + r() * 12);
      torii(x + 16, 0, 15);
      pagIdx.push(tops.length); tops.push([x + 16, top]);
      x += 33; continue;
    }
    const w = o.minW + r() * (o.maxW - o.minW);
    const district = .5 + .5 * Math.sin((x / TW) * Math.PI * 2 * 3 + o.seed);
    let h = o.minH + (o.maxH - o.minH) * (.3 + .7 * district) * (.35 + .65 * r() ** 1.3);
    if (r() < o.tallP) h = o.tallH * (.85 + .15 * r());
    if (o.skytree && Math.abs(x + w / 2 - o.skytree) < 160) h *= .45;
    const body = pick(o.body);
    rect(x, 0, w, h, body);
    let top = h;
    if (w > 12 && r() < .3) { // stepped crown
      const w2 = w * (.45 + r() * .3), h2 = h * (.06 + r() * .1);
      rect(x + (w - w2) / 2, h, w2, h2, body); rect(x + (w - w2) / 2, h + h2, w2, Math.max(.4, 1 / rho), o.snow);
      top = h + h2;
    }
    rect(x + w - Math.max(.6, 1 / rho), 0, Math.max(.6, 1 / rho), h, o.rim); // moonlit edge
    if (r() < (o.edge || 0)) rect(r() < .5 ? x + .4 : x + w - .4 - Math.max(.35, 1 / rho), h * (.1 + .4 * r()), Math.max(.35, 1 / rho), h * (.3 + .3 * r()), pick(NEON)); // LED edge strip
    windows(x, w, h);
    rect(x, h, w, Math.max(.45, 1 / rho), o.snow); // moonlit roof edge (wet with the rain, these days)
    if (o.shop && r() < .55) rect(x + 1 + r() * w * .2, 0, w * (.3 + r() * .4), 3.2, pick(r() < .6 ? WARM : COOL)); // lit shopfront
    if (o.crown && r() < o.crown) { // neon crown on a far tower
      const c = pick(NEON);
      if (r() < .5) rect(x + w * .08, h - 2.2 * (1 / rho + 1), w * .84, Math.max(1.2, 1.4 / rho), c);
      else { rect(x, h - 8 / rho, Math.max(1, 1 / rho), 8 / rho, c); rect(x + w - 1 / rho, h - 8 / rho, Math.max(1, 1 / rho), 8 / rho, c); rect(x, h, w, Math.max(1, 1 / rho), c); }
    }
    const roofR = r();
    if (roofR < pT) tank(x + w * (.25 + r() * .5), top, 3.2 + r() * 1.5);
    else if (roofR < pT + pM && h > o.minH + (o.maxH - o.minH) * .45) {
      const mh = 6 + r() * 14 / Math.max(rho, 1) * 3; rect(x + w * .5 - .25, top, Math.max(.5, 1 / rho), mh, dark); beacon(x + w * .5, top + mh);
    } else if (roofR > 1 - pS) torii(x + w * .5, top, 5); // rooftop shrine
    else if (roofR > 1 - pS - pR) { // rooftop letters on a frame
      const fs = (rho > 4 ? 3.6 : 6) + r() * 2.5, t = pick(WORDS_ROOF), c = pick(NEON);
      font(fs); const tw = g.measureText(t).width / rho;
      if (tw < w * 1.1) { rect(x + w / 2 - tw / 2, top, tw, .6, dark); rect(x + w * .3, top, .5, 1.4, dark); rect(x + w * .7, top, .5, 1.4, dark); g.strokeStyle = c; g.lineWidth = Math.max(1.5, X(fs * .07)); g.strokeText(t, X(x + w / 2), Y(top + 1.4 + fs * .55)); } // tube outlines
    }
    if (o.vsign && r() < o.vsign && w > 11) {
      const sw = rho > 4 ? (r() < .25 ? 5 : 3) + r() * 1.6 : 5.5 + r() * 2.5;
      vsign(r() < .5 ? x + 1 : x + w - sw - 1.2, h * (.55 + r() * .35), sw, pick(WORDS_V), pick(NEON));
    }
    if (o.hsign && r() < o.hsign && w > 14) hsign(x + w / 2, 5 + r() * Math.max(1, h * .5 - 8), pick(WORDS_H), pick(NEON), 3 + r() * 1.6, r() < .35);
    if (o.board && r() < o.board && w > 16) { // billboard with gradient panel
      const bw = Math.min(w - 3, 16 + r() * 8), bh = bw * .55, by = Math.min(h - bh - 3, 8 + r() * h * .4), bx = x + (w - bw) / 2, c = pick(NEON);
      if (by > 4) {
        const gr = g.createLinearGradient(X(bx), 0, X(bx + bw), 0); gr.addColorStop(0, dim(c, .3)); gr.addColorStop(1, dim(pick(NEON), .22));
        g.fillStyle = gr; g.fillRect(X(bx), Y(by + bh), X(bw), X(bh));
        g.strokeStyle = c; g.lineWidth = Math.max(1, X(.45)); g.strokeRect(X(bx), Y(by + bh), X(bw), X(bh));
        font(bh * .42); g.fillStyle = c; g.fillText(pick(WORDS_H), X(bx + bw / 2), Y(by + bh / 2));
      }
    }
    tops.push([x + w / 2, top]);
    x += w + (r() < .3 ? r() * o.gap : .3);
  }
  // festival lanterns strung from each pagoda spire down to the neighbouring rooftops
  for (const i of pagIdx) {
    const [sx, sy] = tops[i];
    for (const j of [i - 2, i - 1, i + 1, i + 2]) if (tops[j]) lanterns(sx, sy - 2, tops[j][0], tops[j][1] + .5, 3);
  }
  if (o.viaduct) { // elevated railway (the shader runs the train along it)
    rect(0, o.viaduct, TW, 2.2, dark); rect(0, o.viaduct + 2.2, TW, .3, '#2e3452');
    for (let x = 12; x < TW - 6; x += 30) rect(x, 0, 2.2, o.viaduct, dark);
  }
  if (o.skytree) skytree(o.skytree, 540);
  g.clearRect(0, 0, W, 2); // keep the top rows empty: the texture clamps vertically
  return cv;
}

function skylineLayer(o, uTime, fogCol) {
  const tex = new THREE.CanvasTexture(paintSkyline(o));
  tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping;
  if (!o.mips) { tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter; }
  const TW = 4096 / o.rho, TH = o.px / o.rho;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: tex }, uTile: { value: new THREE.Vector2(TW, TH) }, uTime, uBase: { value: BASE }, uSeed: { value: o.seed },
      uNeon: { value: o.neon }, uFog: { value: o.fog }, uValley: { value: o.valley }, uFogH: { value: o.fogH }, uFogCol: { value: fogCol },
      uLamp: { value: lin('#ffb870').multiplyScalar(.9) }, uLights: { value: 1 - (o.lights || .07) }, uCell: { value: new THREE.Vector2(30 / o.rho, 20 / o.rho) }, uTrain: { value: o.viaduct ? o.viaduct + 2.5 : -1 }, uStripe: { value: neon(TN.green1, .7) },
    },
    vertexShader: WORLD_VS,
    fragmentShader: `uniform sampler2D uMap; uniform vec2 uTile, uCell; uniform vec3 uFogCol, uLamp, uStripe;
      uniform float uTime, uBase, uSeed, uNeon, uFog, uValley, uFogH, uTrain, uLights; varying vec2 vW;
      ${GL_NOISE}
      vec3 hue(vec3 c, float a) { const vec3 k = vec3(.57735); float ca = cos(a); return max(c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1. - ca), 0.); }
      void main() {
        float hy = vW.y - uBase, e = 0.;
        if (hy < 0.) { // below the street line: glowing valley haze with scattered lights
          vec2 q = vec2(vW.x, hy) / uCell, id = floor(q); float r = hash(id + uSeed); // cells ~same size on screen per layer
          float lit = step(uLights, r) * smoothstep(.08 + .12 * fract(r * 17.), .02, length(fract(q) - .5 - .3 * (vec2(fract(r * 5.), fract(r * 3.)) - .5)));
          gl_FragColor = vec4(uFogCol * (.78 + .22 * exp(hy / 60.)) + lit * mix(uLamp, uLamp.bgr, step(.6, fract(r * 9.))) * .45 * exp(hy / (uCell.y * 35.)), 1.);
          return;
        }
        vec3 c;
        float ty = hy - uTrain, tx = mod(vW.x - uTime * 34., 2300.), car = mod(tx, 20.5);
        if (uTrain > 0. && ty > 0. && ty < 4. && tx < 164. && car < 20.) { // elevated train, 8 cars
          float win = step(1.7, ty) * step(ty, 3.1) * step(.55, fract(car / 1.7)) * step(1., car) * step(car, 19.);
          c = vec3(.03, .035, .05) + win * vec3(.55, .48, .34) + step(.8, ty) * step(ty, 1.2) * uStripe;
          c += step(163.2, tx) * step(1.1, ty) * step(ty, 1.8) * vec3(4., 3.6, 3.);
        } else {
          vec4 t = texture2D(uMap, vec2(vW.x / uTile.x, hy / uTile.y));
          if (t.a < .5) discard;
          c = t.rgb;
          float m = max(c.r, max(c.g, c.b));
          if (m > .5 && c.g < .03 && c.b < .03) { // aviation beacon
            c = vec3(1., .05, .03) * (.25 + 5. * step(.8, fract(uTime * .45 + hash(vec2(floor(vW.x / 4.), uSeed)))));
          } else {
            e = smoothstep(.5, .9, m);
            if (e > 0.) {
              float tile = floor(vW.x / uTile.x), cell = floor(vW.x / 11.);
              if (c.b > c.r * .8) c = hue(c, (hash(vec2(tile, uSeed)) - .5) * 1.6);   // per-tile variety for cool neon
              float fl = 1. - .85 * step(.93, hash(vec2(cell, floor(uTime * 8.)))) * step(.8, hash(vec2(cell, uSeed + 3.)));
              c *= mix(1., min(uNeon / max(dot(c, vec3(.2126, .7152, .0722)), .03), 5.), e) * fl; // equal glow per hue, capped for deep reds
            }
          }
        }
        float f = min(uFog + uValley * (1. - smoothstep(0., uFogH, hy)), 1.);
        gl_FragColor = vec4(mix(c, uFogCol, f * (1. - .55 * e)), 1.);
      }`,
  }));
  m.userData = { z: o.z, top: BASE + TH };
  return m;
}

// ------------------------------------------------------------------ dragons
const DN = 64, NF = 26, RING = 256, SEG = 160;           // body samples, dorsal fins, trail ring, trail points per body
const STRANDS = [10, 10, 4, 4, 5, 5, 5, 6, 6, 6, 3];     // whiskers ×2, horns ×2, mane ×3, tail tufts ×3, jaw
const LEGN = 4;                                          // points per leg (hip, knee, ankle, claw)
const VPD = DN * 2 + NF * 3 + STRANDS.reduce((a, n) => a + 2 * n, 0) + 4 * LEGN * 2;
const S = Float32Array.from({ length: DN }, (_, k) => (k / (DN - 1)) ** 1.25); // arc fraction per sample (dense at the head)
const PROF = S.map(s => Math.max(s < .09 ? .35 + .8 * Math.exp(-(((s - .035) / .025) ** 2)) : 0,
  (.55 + .45 * smooth(.07, .25, s)) * (1 - .88 * smooth(.3, 1, s)) * smooth(.03, .07, s)));
const DRAGONS = [ // far → near (also the draw order inside the mesh)
  { c1: TN.yellow, c2: TN.orange, glow: .95, z: [-2350, -1900], L: 900, y: [.34, .5] },
  { c1: TN.purple, c2: TN.blue, glow: 1.2, z: [-1050, -850], L: 380, y: [.3, .52] },
  { c1: TN.magenta2, c2: TN.magenta, glow: 1.25, z: [-760, -620], L: 280, y: [.36, .54] }, // LEGACY: a flyer from an earlier playthrough
  { c1: TN.blue1, c2: TN.green1, glow: 1.5, z: [-420, -330], L: 160, y: [.28, .5] },
  { c1: TN.magenta2, c2: TN.magenta, glow: 1.45, z: [-140, -100], L: 60, y: [.42, .56], near: -48 }, // YOU: the rider's colours
];
const LEGACY = 2, YOU = 4;
export const PLAYER_DRAGON = { c1: TN.magenta2, c2: TN.magenta, glow: .9 }; // dimmer than the sky dragons: it's close, so its rims are thick
const CX = new Float32Array(DN), CY = new Float32Array(DN), PX = new Float32Array(DN), PY = new Float32Array(DN);
const FX = new Float32Array(DN), FY = new Float32Array(DN), NX = new Float32Array(DN), NY = new Float32Array(DN);
const SX = new Float32Array(12), SY = new Float32Array(12);

export function dragonMesh(specs) {
  const n = specs.length, ap = [], idx = [];
  let v = 0;
  const vert = (u, w, part, d) => { ap.push(u, w, part, d); return v++; };
  const strip = (m, part, d, us) => {
    for (let k = 0; k < m; k++) {
      const u = us ? us[k] : k / (m - 1); vert(u, 1, part, d); vert(u, -1, part, d);
      if (k) idx.push(v - 4, v - 3, v - 2, v - 3, v - 1, v - 2);
    }
  };
  for (let d = 0; d < n; d++) {
    strip(DN, 0, d, S);
    for (let f = 0; f < NF; f++) idx.push(vert(0, 0, 1, d), vert(1, 0, 1, d), vert(.5, 1, 1, d));
    STRANDS.forEach((m, i) => strip(m, i === 10 ? 3 : 2, d));
    for (let l = 0; l < 4; l++) strip(LEGN, 3, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aP', new THREE.Float32BufferAttribute(ap, 4));
  g.setIndex(idx);
  return new THREE.Mesh(g, new THREE.ShaderMaterial({
    ...PREMUL, side: THREE.DoubleSide,
    uniforms: { uT: { value: 0 }, uAlpha: { value: 1 }, uC1: { value: specs.map(d => neon(d.c1)) }, uC2: { value: specs.map(d => neon(d.c2)) }, uGlow: { value: specs.map(d => d.glow) } },
    vertexShader: 'attribute vec4 aP; varying vec4 vP; void main() { vP = aP; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `uniform float uT, uAlpha; uniform vec3 uC1[${n}], uC2[${n}]; uniform float uGlow[${n}]; varying vec4 vP;
      void main() {
        int i = int(vP.w + .5); vec3 c1 = uC1[i], c2 = uC2[i]; float g = uGlow[i], u = vP.x, v = vP.y, av = abs(v), a;
        vec3 add;
        if (vP.z < .5) { // body: glowing rims, scales, energy pulses running to the tail, a hot eye
          float rim = smoothstep(.55, .95, av), head = 1. - smoothstep(.02, .09, u);
          vec2 q = vec2(u * 34., v * 1.6 + .5); q.x += .5 * floor(q.y);
          float sc = smoothstep(.12, 0., abs(length(vec2(fract(q.x) - .5, fract(q.y))) - .55)) * (1. - smoothstep(.15, .4, fwidth(q.x)));
          float pulse = pow(.5 + .5 * sin(u * 42. - uT * 5.), 10.);
          float eye = smoothstep(.3, .12, length(vec2((u - .022) * 38., v - .36)));
          add = mix(c1, c2, smoothstep(.2, 1., u)) * g * (rim * (1. + .25 * head) + sc * .3 + pulse * .4 + .05) + vec3(1., .95, .8) * eye * 1.8 * g;
          a = .72 * (1. - rim);
        } else if (vP.z < 1.5) { add = c2 * g * (.12 + 1.1 * v * v); a = .08; }                    // dorsal fin
        else if (vP.z < 2.5) { add = mix(c2, c1, u) * g * 1.3 * (1. - .7 * u) * (1. - smoothstep(.4, 1., av)); a = 0.; } // whiskers, horns, mane, tuft
        else { add = c1 * g * (.22 + .9 * smoothstep(.7, 1., u) + .5 * smoothstep(.5, 1., av)); a = .5 * (1. - smoothstep(.7, 1., av)); } // legs, jaw
        gl_FragColor = vec4(add + c1 * .012 * a, a) * uAlpha;
      }`,
  }));
}

export class Dragon {
  constructor(spec, index, pos, r) { Object.assign(this, { spec, pos, r, base: index * VPD, on: false, rx: new Float32Array(RING), ry: new Float32Array(RING), w: 0, ax: 0, ay: 0, z: 0, dir: 1, ph: 0, age: 0 }); }

  // o.near 0..1: come in closer (spec.near is the closest depth); o.pace 0..1: linger alongside the camera, lower down
  spawn(env, mid, o = {}) {
    const r = this.r, s = this.spec, near = o.near || 0, pace = o.pace || 0;
    this.on = true;
    const z = s.z[0] + (s.z[1] - s.z[0]) * r();
    this.z = s.near ? z + (s.near - z) * near : z;
    this.L = s.L * (.85 + .3 * r()) * Math.min(1, Math.max(.55, env.asp / 1.6)) * (1 - .3 * near);
    this.step = this.L / SEG; this.T = (11 + 5 * r()) * (1 + 1.6 * pace);
    this.dir = env.speed < 4 && r() < .4 && !pace ? -1 : 1; // right-to-left only while the camera idles; those stay world-anchored
    this.ax = env.fx; this.ay = env.fy;
    const y0 = s.y[0] + (s.y[1] - s.y[0]) * r();
    this.y0 = y0 + (.14 - y0) * .75 * pace; this.w1 = .45 + .35 * r(); this.w2 = 1.1 + .5 * r(); this.p1 = 6.28 * r(); this.p2 = 6.28 * r();
    this.loop = r() < .5 ? this.T * (.35 + .25 * r()) : -99; this.ph = 6.28 * r();
    const H = (env.D - this.z) * env.th, W = H * env.asp, a0 = mid ? this.T * (.28 + .12 * r()) : 0;
    const pre = Math.min(8, .75 * this.L * this.T / (W * 1.08 + this.L * 1.15));
    this.age = a0 - pre; this.path(W, H);
    this.w = RING - 1; this.lx = this.hx; this.ly = this.hy;
    for (let i = 0; i < RING; i++) { this.rx[i] = this.hx - this.dir * (RING - 1 - i) * this.step; this.ry[i] = this.hy; }
    for (; this.age < a0; this.age += 1 / 30) { this.path(W, H); this.advance(); } // pre-warm: lay the trail
    this.age = a0;
  }

  off() { this.on = false; this.pos.fill(0, this.base * 3, (this.base + VPD) * 3); }

  path(W, H) { // head position relative to the anchor: crosses the view with sine weaves and maybe a loop-the-loop
    const a = this.age, span = W * 1.08 + this.L * 1.15;
    let x = this.dir * (2 * a / this.T - 1) * span;
    let y = H * (this.y0 + .11 * Math.sin(this.w1 * a + this.p1) + .05 * Math.sin(this.w2 * a + this.p2));
    const lp = smooth(this.loop - 1.3, this.loop + 1.3, a) * 6.2832;
    if (lp > 0 && lp < 6.2832) { const R = .22 * H; x += this.dir * R * Math.sin(lp); y += R * (1 - Math.cos(lp)); }
    this.hx = x; this.hy = y;
  }

  advance() { // drop a trail point every `step` meters the head travels
    let dx = this.hx - this.lx, dy = this.hy - this.ly, d = Math.sqrt(dx * dx + dy * dy);
    while (d >= this.step) {
      this.lx += dx / d * this.step; this.ly += dy / d * this.step;
      this.w = (this.w + 1) % RING; this.rx[this.w] = this.lx; this.ry[this.w] = this.ly;
      dx = this.hx - this.lx; dy = this.hy - this.ly; d = Math.sqrt(dx * dx + dy * dy);
    }
  }

  // lay the whole trail at once, head at (hx, hy): behind(d, out) writes the point d metres back along the path
  settle(hx, hy, behind) {
    const p = [0, 0];
    this.hx = this.lx = hx; this.hy = this.ly = hy; this.w = RING - 1;
    for (let i = 0; i < RING; i++) { behind((RING - 1 - i) * this.step, p); this.rx[i] = p[0]; this.ry[i] = p[1]; }
  }

  sample(a) { // point at arc length a behind the head → (this.sx, this.sy)
    const dx = this.lx - this.hx, dy = this.ly - this.hy, d0 = Math.sqrt(dx * dx + dy * dy);
    if (a <= d0) { const f = d0 > 0 ? a / d0 : 0; this.sx = this.hx + dx * f; this.sy = this.hy + dy * f; return; }
    const k = Math.min((a - d0) / this.step, RING - 2), i = Math.floor(k), f = k - i;
    const p = (this.w - i + RING) % RING, q = (p - 1 + RING) % RING;
    this.sx = this.rx[p] + (this.rx[q] - this.rx[p]) * f; this.sy = this.ry[p] + (this.ry[q] - this.ry[p]) * f;
  }

  put(v, x, y) { const o = (this.base + v) * 3; this.pos[o] = this.ax + x; this.pos[o + 1] = this.ay + y; this.pos[o + 2] = this.z; }

  strand(v, m, w0, w1, minW) { // tapered ribbon through SX/SY
    for (let k = 0; k < m; k++) {
      const a = Math.max(k - 1, 0), b = Math.min(k + 1, m - 1);
      let tx = SX[b] - SX[a], ty = SY[b] - SY[a]; const l = Math.sqrt(tx * tx + ty * ty) || 1; tx /= l; ty /= l;
      const w = Math.max(w0 + (w1 - w0) * k / (m - 1), minW);
      this.put(v++, SX[k] - ty * w, SY[k] + tx * w); this.put(v++, SX[k] + ty * w, SY[k] - tx * w);
    }
    return v;
  }

  update(dt, env) {
    if (!this.on) return;
    this.age += dt;
    const H = (env.D - this.z) * env.th, W = H * env.asp;
    if (this.age > this.T || (this.dir < 0 && Math.abs(this.ax + this.hx - env.cx) > W * 1.1 + this.L * 1.3)) return this.off();
    if (this.dir > 0) { this.ax = env.fx; this.ay = env.fy; } // rides along with the camera
    this.path(W, H); this.advance();
    this.build(this.age, .6 * 2 * H / env.bufH);
  }

  // Body, fins, whiskers, horns, mane, tail, jaw and legs along the trail. wave scales the swimming undulation;
  // thick is the body half-width per metre of length.
  build(t, minW, wave = 1, thick = .028) {
    const L = this.L, W0 = thick * L, dir = this.dir;
    for (let k = 0; k < DN; k++) { this.sample(S[k] * L); CX[k] = this.sx; CY[k] = this.sy; }
    for (let k = 0; k < DN; k++) { // travelling-wave undulation across the trail
      const a = Math.max(k - 1, 0), b = Math.min(k + 1, DN - 1), s = S[k];
      const fx = CX[a] - CX[b], fy = CY[a] - CY[b], l = Math.sqrt(fx * fx + fy * fy) || 1;
      const amp = wave * L * Math.min(1, s * 3.5) * (.055 * Math.sin(7.2 * s - 2.1 * t + this.ph) + .015 * Math.sin(15 * s - 3.4 * t));
      PX[k] = CX[k] - fy / l * amp; PY[k] = CY[k] + fx / l * amp;
    }
    let v = 0;
    for (let k = 0; k < DN; k++) { // body ribbon; v = +1 is the dorsal side
      const a = Math.max(k - 1, 0), b = Math.min(k + 1, DN - 1);
      let fx = PX[a] - PX[b], fy = PY[a] - PY[b]; const l = Math.sqrt(fx * fx + fy * fy) || 1; fx /= l; fy /= l;
      FX[k] = fx; FY[k] = fy; NX[k] = -dir * fy; NY[k] = dir * fx;
      const hw = Math.max(PROF[k] * W0, minW);
      this.put(v++, PX[k] + NX[k] * hw, PY[k] + NY[k] * hw); this.put(v++, PX[k] - NX[k] * hw, PY[k] - NY[k] * hw);
    }
    for (let f = 0; f < NF; f++) { // dorsal fins, rippling
      const k = 8 + 2 * f, hw = PROF[k] * W0, h = hw * (1.1 + .5 * Math.sin(5 * t - .6 * f));
      this.put(v++, PX[k] + NX[k] * hw * .85, PY[k] + NY[k] * hw * .85);
      this.put(v++, PX[k + 1] + NX[k + 1] * hw * .85, PY[k + 1] + NY[k + 1] * hw * .85);
      this.put(v++, PX[k] + NX[k] * (hw + h) - FX[k] * h * .9, PY[k] + NY[k] * (hw + h) - FY[k] * h * .9);
    }
    const fx0 = FX[0], fy0 = FY[0], nx0 = NX[0], ny0 = NY[0];
    for (let side = 1; side > -2; side -= 2) { // whiskers from the snout, flowing back in waves
      for (let j = 0; j < 10; j++) {
        const back = j * .02 * L, out = side * (PROF[0] * W0 * .45 + back * .2) + .045 * L * (j / 9) * Math.sin(3.2 * t - .55 * j + side);
        SX[j] = PX[0] - fx0 * back + nx0 * out; SY[j] = PY[0] - fy0 * back + ny0 * out;
      }
      v = this.strand(v, 10, .09 * W0, .03 * W0, minW);
    }
    for (let hn = 0; hn < 2; hn++) { // antler-like horns
      const k = 3 + hn, s = (1 - .15 * hn) * W0 * 1.25, bx = PX[k] + NX[k] * PROF[k] * W0 * .7, by = PY[k] + NY[k] * PROF[k] * W0 * .7;
      for (let j = 0; j < 4; j++) { const b = .95 * j * s, u = (.85 * j - .12 * j * j) * s; SX[j] = bx - FX[k] * b + NX[k] * u; SY[j] = by - FY[k] * b + NY[k] * u; }
      v = this.strand(v, 4, .22 * W0, .05 * W0, minW);
    }
    for (let mn = 0; mn < 3; mn++) { // mane
      const k = 5 + 2 * mn, bx = PX[k] + NX[k] * PROF[k] * W0 * .8, by = PY[k] + NY[k] * PROF[k] * W0 * .8;
      for (let j = 0; j < 5; j++) {
        const b = j * W0 * .9, u = j * W0 * .3 + Math.sin(4 * t - .8 * j + k) * W0 * .18 * j;
        SX[j] = bx - FX[k] * b + NX[k] * u; SY[j] = by - FY[k] * b + NY[k] * u;
      }
      v = this.strand(v, 5, .18 * W0, .04 * W0, minW);
    }
    const kt = DN - 1;
    for (let tf = -1; tf < 2; tf++) { // flame-like tail tuft
      const ca = Math.cos(.6 * tf), sa = Math.sin(.6 * tf);
      for (let j = 0; j < 6; j++) {
        const b = j * .011 * L, wv = Math.sin(4.5 * t - .7 * j + 1.3 * tf) * .004 * L * j;
        SX[j] = PX[kt] + (-FX[kt] * ca + NX[kt] * sa) * b + NX[kt] * wv; SY[j] = PY[kt] + (-FY[kt] * ca + NY[kt] * sa) * b + NY[kt] * wv;
      }
      v = this.strand(v, 6, .16 * W0, .04 * W0, minW);
    }
    { // lower jaw, slightly open
      const k = 3, bx = PX[k] - NX[k] * PROF[k] * W0 * .75, by = PY[k] - NY[k] * PROF[k] * W0 * .75, op = .3 + .1 * Math.sin(1.7 * t);
      for (let j = 0; j < 3; j++) { SX[j] = bx + FX[k] * j * W0 * .55 - NX[k] * j * W0 * op; SY[j] = by + FY[k] * j * W0 * .55 - NY[k] * j * W0 * op; }
      v = this.strand(v, 3, .3 * W0, .08 * W0, minW);
    }
    for (let lg = 0; lg < 4; lg++) { // legs paddling through the air; the far-side pair trails in phase
      const k = lg < 2 ? 17 : 37, ph = 2.2 * t + (lg & 1) * 2.4 + (lg < 2 ? 0 : 1.6), hw = PROF[k] * W0;
      const fx = FX[k], fy = FY[k], nx = NX[k], ny = NY[k], a1 = .55 + .45 * Math.sin(ph), a2 = .35 + .45 * Math.sin(ph + 1.2);
      SX[0] = PX[k] - nx * hw * .6; SY[0] = PY[k] - ny * hw * .6;
      SX[1] = SX[0] + (-nx * Math.cos(a1) - fx * Math.sin(a1)) * 1.3 * W0; SY[1] = SY[0] + (-ny * Math.cos(a1) - fy * Math.sin(a1)) * 1.3 * W0;
      SX[2] = SX[1] + (-nx * Math.cos(a2) + fx * Math.sin(a2)) * 1.1 * W0; SY[2] = SY[1] + (-ny * Math.cos(a2) + fy * Math.sin(a2)) * 1.1 * W0;
      SX[3] = SX[2] + (fx * .7 - nx * .15) * W0; SY[3] = SY[2] + (fy * .7 - ny * .15) * W0;
      v = this.strand(v, 4, .34 * W0, .14 * W0, minW);
    }
  }
}

// ------------------------------------------------------------------ backdrop
export function createBackdrop(scene, camera, hooks = {}) {
  const phone = matchMedia('(pointer: coarse)').matches;
  const uTime = { value: 0 };
  const fogCol = lin('#252a4a');
  const add = (m, order, z = 0) => { m.renderOrder = order; m.frustumCulled = false; m.matrixAutoUpdate = false; m.position.z = z; m.updateMatrix(); scene.add(m); return m; };

  // sky, stars, moon: full-screen quad at the far plane, drawn after the opaque layers so covered pixels are skipped
  const sky = add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    depthWrite: false,
    uniforms: {
      uTime, uCam: { value: new THREE.Vector2() }, uAsp: { value: 1 }, uHz: { value: .5 }, uMoonP: { value: new THREE.Vector2(.8, .8) }, uMoonR: { value: .06 },
      uTop: { value: lin(TN.bg_dark1) }, uMid: { value: lin('#171a2c') }, uHor: { value: lin('#2a2f55') }, uGlow: { value: lin('#3a2c66').multiplyScalar(.8) },
      uMoon: { value: neon(TN.fg, 1.1) }, uFlash: { value: 0 }, uStorm: { value: 0 }, uBolt: { value: lin('#9fb4ff') },
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 1., 1.); }',
    fragmentShader: `uniform vec3 uTop, uMid, uHor, uGlow, uMoon, uBolt; uniform vec2 uCam, uMoonP; uniform float uTime, uAsp, uHz, uMoonR, uFlash, uStorm; varying vec2 vUv;
      ${GL_NOISE}
      void main() {
        float e = vUv.y - uHz; // screen heights above the city horizon
        vec3 c = mix(mix(uHor, uMid, smoothstep(-.02, .32, e)), uTop, smoothstep(.28, .9, e));
        c += uGlow * exp(-max(e, 0.) * 6.);
        vec2 sp = vec2(vUv.x * uAsp, vUv.y) + uCam * vec2(1e-5, 5e-6);
        for (int k = 0; k < 2; k++) {
          float sc = k == 0 ? 70. : 190., th = k == 0 ? .955 : .9;
          vec2 g = sp * sc + float(k) * 17.3, id = floor(g), f = fract(g) - .5;
          float r = hash(id);
          if (r > th) {
            float s = (r - th) / (1. - th), tw = .6 + .4 * sin(uTime * (1.2 + 3. * s) + r * 90.);
            vec2 o = (vec2(hash(id + 3.1), hash(id + 7.7)) - .5) * .6;
            vec3 col = mix(vec3(.75, .82, 1.), mix(vec3(.55, .9, 1.), vec3(1., .82, .65), step(.5, fract(r * 31.))), step(.75, s) * .6);
            c += col * smoothstep(k == 0 ? .14 : .1, 0., length(f - o)) * tw * (k == 0 ? .35 + 1.4 * s * s : .3) * smoothstep(.02, .3, e);
          }
        }
        vec2 m = (vUv - uMoonP) * vec2(uAsp, 1.) / uMoonR; float md = length(m), disc = smoothstep(1., .96, md);
        float mar = noise(m * 1.7 + 4.) * .6 + noise(m * 4.3 + 1.) * .3 + noise(m * 11. + 7.) * .1;
        vec3 moon = uMoon * (1. - .45 * uStorm); // storm cloud drifting over it
        c = mix(c, moon * (1.1 - .4 * smoothstep(.42, .68, mar)) * (1. - .16 * md * md), disc);
        c += moon * (1. - disc) * (.2 * exp(-(md - 1.) * 1.4) + .045 * exp(-(md - 1.) * .22));
        c += uBolt * uFlash * (.12 + .3 * smoothstep(-.1, .5, e));
        gl_FragColor = vec4(c + (hash(gl_FragCoord.xy) - .5) * .0015, 1.);
      }`,
  })), 10);

  // Mt. Fuji (repeats every 16 km so the endless flight meets it again) over a range of snowy ridges
  const RIDGE = `float ridge(float x) {
      return 150. + 120. * sin(x * .00061 + 1.7) * sin(x * .00023 + .4) + 120. * (1. - abs(sin(x * .0011 + .3))) + 50. * (1. - abs(sin(x * .0037 + 2.1))); }
    float top(float x, out float d) {
      d = x - (uFX + uFP * floor((x - uFX) / uFP + .5));
      float u = abs(d) / uFW;
      return max(ridge(x), u < 1. ? uFH * min(pow(1. - u, 1.7), .94) : 0.); }`;
  const mtnU = { uBase: { value: BASE }, uFP: { value: 16000 }, uFX: { value: -1300 }, uFH: { value: 1300 }, uFW: { value: 3400 } };
  const mtn = add(new THREE.Mesh(new THREE.PlaneGeometry(20000, 1, 640, 1), new THREE.ShaderMaterial({
    uniforms: { ...mtnU, uRock: { value: lin('#1f2440') }, uSnow: { value: lin('#8d99c8') }, uFogCol: { value: fogCol } },
    vertexShader: `uniform float uBase, uFP, uFX, uFH, uFW; varying vec2 vW; varying float vTop, vF, vSlope;
      ${RIDGE}
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.); float d0, d1;
        vTop = top(w.x, vF); vSlope = (top(w.x + 20., d0) - top(w.x - 20., d1)) / 40.;
        w.y = position.y > 0. ? uBase + vTop : uBase - 3000.;
        vW = w.xy; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uRock, uSnow, uFogCol; uniform float uBase, uFH, uFW; varying vec2 vW; varying float vTop, vF, vSlope;
      ${GL_NOISE}
      void main() {
        float hy = vW.y - uBase, u = abs(vF) / uFW, fuji = u < 1. ? uFH * min(pow(1. - u, 1.7), .94) : 0.;
        float lit = smoothstep(.45, -.6, vSlope), snow;
        if (fuji >= vTop - 1.) {
          lit = smoothstep(-.5, .6, vF / uFW); // moon from the right: soft gradient, no seam at the summit
          float streak = .7 * noise(vec2(vF * .012, hy * .0012)) + .3 * noise(vec2(vF * .03, hy * .003)); // snow-filled gullies
          snow = smoothstep(-.08, .25, (hy - uFH * (.62 + .04 * sin(vF * .0023))) / (uFH * .27) + (streak - .45) * 1.1);
        } else {
          float line = vTop - 40. - 60. * noise(vec2(vW.x * .004, 3.));
          snow = step(330., vTop) * smoothstep(line - 5., line + 5., hy);
        }
        vec3 c = mix(uRock * (.8 + .4 * lit), uSnow * (.6 + .45 * lit) * (.82 + .18 * hy / uFH), snow);
        gl_FragColor = vec4(mix(c, uFogCol, .32 + .5 * (1. - smoothstep(0., 560., hy))), 1.);
      }`,
  })), 6, -6000);

  // cloud belts: a low one wrapping Fuji's flanks, lit from below by the city, and high wisps near the moon
  const clouds = add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    ...PREMUL,
    uniforms: { uTime, uBase: { value: BASE }, uDark: { value: lin('#2a2e4c') }, uGlow: { value: lin('#7a5aa8') }, uMoonC: { value: lin('#c0caf5') }, uMoonP: { value: new THREE.Vector2(.6, .6) }, uAsp: { value: 1 },
      uFlash: { value: 0 }, uStorm: { value: 0 }, uBolt: { value: lin('#b8c6ff') } },
    vertexShader: 'varying vec2 vW, vN; void main() { vec4 w = modelMatrix * vec4(position, 1.); vW = w.xy; gl_Position = projectionMatrix * viewMatrix * w; vN = gl_Position.xy / gl_Position.w; }',
    fragmentShader: `uniform float uTime, uBase, uAsp, uFlash, uStorm; uniform vec3 uDark, uGlow, uMoonC, uBolt; uniform vec2 uMoonP; varying vec2 vW, vN;
      ${GL_NOISE}
      void main() {
        float y = vW.y - uBase;
        float band = smoothstep(180., 380., y) * (1. - smoothstep(520., 780., y)) + .75 * smoothstep(1080., 1280., y) * (1. - smoothstep(1420., 1700., y));
        if (band < .01) discard;
        vec2 p = vec2((vW.x + uTime * 7.) / 900., y / 150.);
        float n = 0., a = .5;
        for (int i = 0; i < 5; i++) { n += a * noise(p); p = p * 2.03 + vec2(17.1, 3.7); a *= .5; }
        float d = smoothstep(.36 - .16 * uStorm, .7 - .1 * uStorm, n) * band;
        if (d < .005) discard;
        float moon = exp(-2.2 * length((vN - uMoonP) * vec2(uAsp, 1.)));
        vec3 c = mix(uDark, uGlow, (1. - smoothstep(150., 1000., y)) * (1. - .5 * n)) + uMoonC * moon * .5 * (1. - n) * (1. - .5 * uStorm);
        c += uBolt * uFlash * (.6 + .8 * (1. - n)); // lit from inside by the strike
        gl_FragColor = vec4(c * d * .75, d * (.6 + .25 * uStorm));
      }`,
  })), 0, -4200);

  const layers = LAYERS.map((o, i) => add(skylineLayer(o, uTime, fogCol), 2 + i, o.z));

  // dragons
  const dmesh = add(dragonMesh(DRAGONS), 0);
  const dpos = dmesh.geometry.attributes.position, dr = rng(2024);
  const dragons = DRAGONS.map((s, i) => new Dragon(s, i, dpos.array, dr));

  // hanabi: 3 shells in flight at most; each spark drawn with 3 lagged samples → short trails
  const FS = 3, FPN = 110, fr = rng(77), fa = new Float32Array(FS * FPN * 3 * 4);
  for (let s = 0, i = 0; s < FS; s++) for (let p = 0; p < FPN; p++) {
    const ang = fr() * 6.2832, u = fr() * 2 - 1, sp = Math.sqrt(1 - u * u) * (.9 + .1 * fr()), rr = fr();
    for (let k = 0; k < 3; k++, i += 4) fa.set([s + k * .25, ang, sp, rr], i);
  }
  const fw = { O: [], K: [], C1: [], C2: [], next: [2, 6.5, 11] }; // first bursts, seconds after the first update
  for (let s = 0; s < FS; s++) { fw.O.push(new THREE.Vector4(0, 0, -1100, -99)); fw.K.push(new THREE.Vector4(80, 2, 0, 0)); fw.C1.push(new THREE.Color()); fw.C2.push(new THREE.Color()); }
  const FWC = [[TN.magenta2, TN.purple], [TN.cyan, TN.blue], [TN.yellow, TN.orange], [TN.green1, TN.teal], [TN.magenta, TN.magenta2], [TN.blue5, TN.magenta]].map(([a, b]) => [neon(a), neon(b)]);
  const fgeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(fa.length / 4 * 3), 3)).setAttribute('aF', new THREE.BufferAttribute(fa, 4));
  const fwU = { uTime, uO: { value: fw.O }, uK: { value: fw.K }, uC1: { value: fw.C1 }, uC2: { value: fw.C2 }, uPx: { value: 1000 } };
  add(new THREE.Points(fgeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: fwU,
    vertexShader: `attribute vec4 aF; uniform vec4 uO[3], uK[3]; uniform vec3 uC1[3], uC2[3]; uniform float uTime, uPx; varying vec3 vC;
      void main() {
        int s = int(aF.x); float lag = fract(aF.x) * .24; vec4 o = uO[s], k = uK[s];
        float age = uTime - o.w - lag, R = k.x, b; vec2 p = o.xy;
        if (age < 0.) { // shell climbing out of the city
          float f = clamp(-age / 1.1, 0., 1.), tr = aF.w / .05; p.y -= (f * f + tr * .1) * R * 2.3; p.x += sin(age * 11. + aF.w * 9.) * R * .01;
          b = step(aF.w, .05) * step(-1.1, age) * .45 * (1. - tr) * (1. - lag * 3.);
        } else {
          float willow = k.z, life = mix(2.3, 3.6, willow);
          p += vec2(cos(aF.y), sin(aF.y)) * aF.z * R * (1. - exp(-2.8 * age)) - vec2(0., R * mix(.1, .28, willow) * age * age);
          b = (1. - smoothstep(life * .45, life, age)) * (1. + 3. * exp(-age * 10.)) * (.65 + .35 * sin(aF.w * 91. + age * (18. + aF.w * 25.))) * (1. - lag * 3.);
        }
        vC = mix(uC1[s], uC2[s], smoothstep(.2, 1.4, age)) * b * k.y;
        vec4 mv = viewMatrix * vec4(p, o.z, 1.);
        gl_Position = b > .01 ? projectionMatrix * mv : vec4(2., 2., 2., 1.);
        gl_PointSize = max(1.5, 2.6 * uPx / -mv.z);
      }`,
    fragmentShader: 'varying vec3 vC; void main() { gl_FragColor = vec4(vC * smoothstep(.5, .1, length(gl_PointCoord - .5)), 1.); }',
  })), 0, -1100);

  // weather: drops live at fixed distances from the camera and wrap inside its view (endless, world-stable when
  // panning). Each is a cherry-blossom petal (tumbling, drifting) or a raindrop, in the mix setLook() picks from the
  // rider's progress; every drop is a quad stretched along its motion relative to the camera → streaks at speed
  const SN = phone ? 1100 : 2600, sa = new Float32Array(SN * 4), sr = rng(99);
  for (let i = 0; i < SN; i++) sa.set([sr(), sr(), 7 + 143 * sr() ** 1.3, sr()], i * 4);
  const sg = new THREE.InstancedBufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3)).setIndex([0, 1, 2, 0, 2, 3]);
  sg.setAttribute('aF', new THREE.InstancedBufferAttribute(sa, 4)); sg.instanceCount = SN;
  const snowU = { uTime, uCam: { value: new THREE.Vector2() }, uVel: { value: new THREE.Vector2() }, uAsp: { value: 1 }, uK: { value: .73 }, uBufH: { value: 1000 },
    uPetal: { value: .45 }, uRain: { value: 0 }, uPink: { value: lin('#f4a9c9') }, uDrop: { value: lin('#a9c4ff') } };
  add(new THREE.Mesh(sg, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: snowU,
    vertexShader: `attribute vec4 aF; uniform float uTime, uAsp, uK, uBufH, uPetal, uRain; uniform vec2 uCam, uVel; varying vec2 vQ; varying float vA, vK, vR;
      void main() {
        float d = aF.z, r = aF.w, rain = step(fract(r * 91.7), uRain * .999);
        if (rain < .5 && fract(r * 53.1) >= uPetal) { gl_Position = vec4(0., 0., -2., 1.); return; }
        vec2 box = d * uK * vec2(uAsp, 1.) * 1.2;
        vec2 fall = rain > .5 ? vec2(2.5 + 1.5 * r, -15. - 6. * fract(r * 7.3)) : vec2(1.4 + 1.8 * r, -.8 - 1.1 * fract(r * 7.3));
        vec2 sway = (1. - rain) * vec2(.9 * sin(uTime * (.6 + r) + r * 40.), .35 * sin(uTime * (1.1 + r) + r * 13.));
        vec2 c = mod(aF.xy * box + fall * uTime + sway - uCam, box) - .5 * box;
        float px = .9 * d * uK / uBufH, rad = max(rain > .5 ? .006 : .036 + .03 * r, px);
        vec2 rel = fall - uVel;
        float sl = rain > .5 ? min(length(rel) * .02, d * uK * .25) : min(length(rel) / 60. * smoothstep(4., 14., length(rel)), d * uK * .18);
        float spin = uTime * (1. + 2. * r) + r * 40.;
        vec2 dir = rain > .5 || sl > 1e-4 ? normalize(rel + 1e-5) : vec2(cos(spin), sin(spin));
        float across = rain > .5 ? rad : max(rad * .62 * (.25 + .75 * abs(sin(uTime * (1.3 + r) + r * 9.))), px); // petals flip edge-on as they tumble
        vec2 p = c - dir * sl * .5 + dir * position.x * (rad + sl * .5) + vec2(-dir.y, dir.x) * position.y * across;
        vQ = position.xy; vK = sl * .5 / rad; vR = rain;
        vA = smoothstep(7., 14., d) * (rain > .5 ? .3 * (1. - .5 * d / 150.) : .85 * pow(rad / (rad + sl * .5), 1.3));
        gl_Position = projectionMatrix * vec4(p, -d, 1.);
      }`,
    fragmentShader: `uniform vec3 uPink, uDrop; varying vec2 vQ; varying float vA, vK, vR;
      void main() {
        vec2 q = vec2(max(abs(vQ.x) * (1. + vK) - vK, 0.), vQ.y);
        if (vR > .5) { gl_FragColor = vec4(uDrop, vA * smoothstep(1., .2, length(q))); return; }
        float notch = smoothstep(.45, .25, length(vQ - vec2(1., 0.))) * step(vK, .5); // the petal's notched tip
        gl_FragColor = vec4(uPink * (.8 + .2 * vQ.y), vA * smoothstep(1., .55, length(q)) * (1. - notch));
      }`,
  })), 0);

  // lightning: a jagged bolt (main channel + two forks) from the cloud base into the city, flickering out while
  // the sky and clouds flash. Storms schedule strikes; strike() can also place one (the reveal).
  const BP = 34, bolt = { t: -99, k: 0 }, bpos = new Float32Array(BP * 2 * 3), bside = new Float32Array(BP * 2), bidx = [], br = rng(7);
  for (const [a, b] of [[0, 20], [20, 27], [27, 34]]) for (let i = a; i < b - 1; i++) bidx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
  for (let i = 0; i < BP * 2; i++) bside[i] = i % 2 ? 1 : -1;
  const bgeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(bpos, 3).setUsage(THREE.DynamicDrawUsage))
    .setAttribute('side', new THREE.BufferAttribute(bside, 1)).setIndex(bidx);
  const boltU = { uA: { value: 0 }, uCol: { value: neon('#c8d4ff', 2.6) } };
  const boltMesh = add(new THREE.Mesh(bgeo, new THREE.ShaderMaterial({
    ...PREMUL, side: THREE.DoubleSide, uniforms: boltU,
    vertexShader: 'attribute float side; varying float vS; void main() { vS = side; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); }',
    fragmentShader: 'uniform float uA; uniform vec3 uCol; varying float vS; void main() { float d = abs(vS); gl_FragColor = vec4(uCol * uA * (smoothstep(.35, .1, d) + .35 * (1. - d) * (1. - d)), 0.); }',
  })), 1);
  boltMesh.visible = false;
  const BX = new Float32Array(20), BY = new Float32Array(20);
  const jag = (a, b, x0, y0, x1, y1, z, w, j) => { // points a..b-1 of a jagged strip from (x0,y0) to (x1,y1); keeps them in BX/BY
    const n = b - a; let ox = 0;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1), mid = i > 0 && i < n - 1;
      ox = mid ? ox * .5 + (br() - .5) * j : 0;
      BX[i] = x0 + (x1 - x0) * u + ox; BY[i] = y0 + (y1 - y0) * u + (mid ? (br() - .5) * j * .3 : 0);
    }
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(i - 1, 0), i1 = Math.min(i + 1, n - 1);
      let tx = BX[i1] - BX[i0], ty = BY[i1] - BY[i0]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
      const ww = w * (1 - .6 * i / n), o = (a + i) * 6;
      bpos[o] = BX[i] - ty * ww; bpos[o + 1] = BY[i] + tx * ww; bpos[o + 2] = z; bpos[o + 3] = BX[i] + ty * ww; bpos[o + 4] = BY[i] - tx * ww; bpos[o + 5] = z;
    }
  };
  function strike(x, y0, y1, z, k = 1) { // k > 1.5: right on top of you (no thunder delay)
    const w = Math.max(.6, (camera.position.z - z) * .0017), L = y0 - y1;
    jag(0, 20, x, y0, x + (br() - .5) * L * .25, y1, z, w, L * .09);
    const f1 = [BX[6], BY[6]], f2 = [BX[11], BY[11]];
    for (const [a, b, [fx, fy]] of [[20, 27, f1], [27, 34, f2]]) {
      const len = L * (.22 + .15 * br()), sd = br() < .5 ? -1 : 1;
      jag(a, b, fx, fy, fx + sd * len * .6, fy - len, z, w * .6, len * .15);
    }
    bgeo.attributes.position.needsUpdate = true;
    bolt.t = env.time; bolt.k = k;
    hooks.bolt?.(k > 1.5 ? .05 : .5 + br() * 1.2, k);
  }

  // per-frame state lives in object fields (doubles in closure variables get re-boxed on every write)
  const env = { cx: 0, cy: 0, fx: 0, fy: 0, vx: 0, vy: 0, D: 1, th: 1, asp: 1, bufH: 1000, winH: 0, speed: 0, next: 0, time: 0, boltT: 3 };
  const look = { p: 0, won: false, legacy: 0, petals: .45, rain: 0, storm: 0 }; // rider progress, from setLook()
  let first = true;

  return {
    strike,
    // p: how far the rider has turned (items.js progress), won: already a dragon, legacy: dragons from past
    // playthroughs, petals / rain / storm: the weather
    setLook(l) {
      Object.assign(look, l);
      snowU.uPetal.value = look.petals; snowU.uRain.value = look.rain;
      sky.material.uniforms.uStorm.value = clouds.material.uniforms.uStorm.value = look.storm;
      if (look.won) dragons[YOU].off();
    },
    escort() { // the reveal: the watcher is gone (it's you now) and the others come to fly alongside
      dragons[YOU].off();
      dragons.forEach((d, i) => { if (i !== YOU && (i !== LEGACY || look.legacy) && !d.on) d.spawn(env, true, { pace: 1 }); });
    },
    update(dt) {
      dt = Math.min(Math.max(dt || 0, 0), .1);
      const t = (env.time += dt);
      const c = camera.position, th = Math.tan(camera.fov * Math.PI / 360), asp = camera.aspect, D = c.z;
      const cut = first || Math.abs(c.x - env.cx) + Math.abs(c.y - env.cy) > 400;
      if (cut) { env.fx = c.x; env.fy = c.y; env.vx = env.vy = 0; }
      else if (dt > 0) { // smoothed camera velocity (snow streaks, spawn choices) and a shake-free anchor for dragons
        const k = 1 - Math.exp(-4 * dt), kf = 1 - Math.exp(-3 * dt);
        env.vx += (Math.min(Math.max((c.x - env.cx) / dt, -150), 150) - env.vx) * k;
        env.vy += (Math.min(Math.max((c.y - env.cy) / dt, -150), 150) - env.vy) * k;
        env.fx += (c.x - env.fx) * kf; env.fy += (c.y - env.fy) * kf;
      }
      env.cx = c.x; env.cy = c.y; env.D = D; env.th = th; env.asp = asp; env.speed = Math.sqrt(env.vx * env.vx + env.vy * env.vy);
      if (innerHeight !== env.winH) { env.winH = innerHeight; env.bufH = innerHeight * Math.min(devicePixelRatio || 1, 2); } // ~drawing-buffer px
      uTime.value = t;

      const su = sky.material.uniforms;
      su.uCam.value.set(c.x, c.y); su.uAsp.value = asp;
      su.uHz.value = .5 + .5 * (BASE + 60 - c.y) / ((D + 4000) * th);
      su.uMoonR.value = .06 * Math.min(1, .45 + asp * .4);
      su.uMoonP.value.set(asp < 1 ? .72 : .82, asp < 1 ? .87 : .84);
      clouds.material.uniforms.uMoonP.value.set(su.uMoonP.value.x * 2 - 1, su.uMoonP.value.y * 2 - 1);
      clouds.material.uniforms.uAsp.value = asp;

      for (let i = 0; i < layers.length; i++) { // planes follow the camera; texture coordinates come from world x
        const l = layers[i], hz = (D - l.userData.z) * th;
        l.scale.set(2.4 * hz * asp, l.userData.top - BASE + 4000, 1);
        l.position.set(c.x, (l.userData.top + BASE - 4000) / 2, l.userData.z); l.updateMatrix();
      }
      mtn.position.x = Math.round(c.x / 31.25) * 31.25; mtn.updateMatrix();
      clouds.scale.set(2.4 * (D + 4200) * th * asp, 1700, 1); clouds.position.set(c.x, BASE + 1000, -4200); clouds.updateMatrix();

      snowU.uCam.value.set(c.x, c.y); snowU.uVel.value.set(env.vx, env.vy); snowU.uAsp.value = asp; snowU.uK.value = 2 * th; snowU.uBufH.value = env.bufH;

      fwU.uPx.value = env.bufH / (2 * th);
      for (let s = 0; s < FS; s++) if (cut) fw.O[s].w = -99; else if (t >= fw.next[s]) {
        const z = -1000 - fr() * 300, H = (D - z) * th, pal = FWC[Math.floor(fr() * FWC.length)];
        fw.O[s].set(env.fx + (fr() - .5) * 1.5 * H * asp, env.fy + H * (.2 + fr() * .38), z, t + 1.1);
        fw.K[s].set(H * (.13 + fr() * .08), 1.8 + fr() * 1.2, fr() < .25 ? 1 : 0, 0);
        fw.C1[s].copy(pal[0]); fw.C2[s].copy(pal[1]);
        fw.next[s] = t + 6 + fr() * 10;
      }

      if (first) { dragons[3].spawn(env, true); env.next = t + 4; for (let s = 0; s < FS; s++) fw.next[s] += t; }
      else if (t >= env.next) {
        // the magenta one (the rider's colours) turns up more, comes closer and lingers, the further the rider has turned
        if (!look.won && !dragons[YOU].on && dr() < .15 + .6 * look.p) dragons[YOU].spawn(env, false, { near: look.p, pace: smooth(.6, .95, look.p) });
        else for (let i = 0, j = Math.floor(dr() * dragons.length); i < dragons.length; i++) {
          const k = (i + j) % dragons.length, d = dragons[k];
          if (d.on || k === YOU || (k === LEGACY && !look.legacy)) continue;
          d.spawn(env, false); break;
        }
        env.next = t + 7 + dr() * 6;
      }
      for (let i = 0; i < dragons.length; i++) dragons[i].update(dt, env);
      dmesh.material.uniforms.uT.value = t;
      dpos.needsUpdate = true;

      if (look.storm > 0 && t >= env.boltT) { // lightning, every few seconds in a full storm
        const z = -1400 - br() * 1200, H = (D - z) * th;
        strike(env.fx + (br() - .5) * 1.6 * H * asp, BASE + 700 + br() * 400, BASE + 10, z, .6 + .5 * br());
        env.boltT = t + (4 + 12 * (1 - look.storm)) * (.4 + br());
      } else if (look.storm <= 0) env.boltT = Math.max(env.boltT, t + 3);
      const ba = t - bolt.t, fl = ba < 0 || ba > 1 ? 0 : Math.exp(-ba * 5) * (Math.floor(ba * 14) % 3 === 1 ? .3 : 1); // two-stroke flicker
      boltMesh.visible = fl > .01; boltU.uA.value = fl * Math.min(1.4, bolt.k);
      sky.material.uniforms.uFlash.value = clouds.material.uniforms.uFlash.value = fl * Math.min(1, bolt.k) * .9;
      first = false;
    },
  };
}
