// Tokyo Flyer audio: pure WebAudio synthesis, no files. One-shot SFX, continuous run layers
// (snow, wind, booster) and a procedural neon city-pop score in F major pentatonic.
// Every call is a silent no-op until unlock(), and nothing in here ever throws into the game.

const MASTER = 0.85, MUSIC = 0.44, MAX_VOICES = 128;
const BPM = 96, S16 = 15 / BPM, BAR = 16 * S16; // 16th-note grid, 2.5 s bars

let ctx = null, master, sfx, amb, mus, duck, arps, airG, padL, padR, noiseBuf, L;
let muted = false, musicOn = true, voices = 0, lastFrame = 0, nextT = 0, step = 0;
let coinT = 0, coinN = 0, boosting = false, airUntil = 0;

const mtof = m => 440 * 2 ** ((m - 69) / 12);
const pent = k => 65 + 12 * Math.floor(k / 5) + [0, 2, 4, 7, 9][k % 5]; // F G A C D, from F4
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const rnd = (a, b) => a + Math.random() * (b - a);
const quiet = p => p && p.catch && p.catch(() => {});
const safe = fn => (...a) => { try { return fn(...a); } catch { /* audio must never break the game */ } };

// ---------- node helpers ----------

function gain(v, dest) {
  const g = ctx.createGain();
  g.gain.value = v;
  if (dest) g.connect(dest);
  return g;
}

// Q is resonance in dB for lowpass/highpass (0 = no peak), bandwidth for bandpass.
function filt(type, f, q, dest) {
  const b = ctx.createBiquadFilter();
  b.type = type; b.frequency.value = f; b.Q.value = q;
  if (dest) b.connect(dest);
  return b;
}

function loopSrc(buf, rate = 1) {
  const s = ctx.createBufferSource();
  s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
  return s;
}

// Wire src → ...fx → dest, play it over [t, end), disconnect the whole chain when it ends.
function fire(src, t, end, dest, ...fx) {
  if (voices >= MAX_VOICES) return; // burst guard: drop rather than pile up
  voices++;
  const chain = [src, ...fx];
  chain.forEach((n, i) => n.connect(chain[i + 1] || dest));
  src.onended = () => { voices--; chain.forEach(n => n.disconnect()); };
  src.start(t, src.buffer ? rnd(0, 1.5) : 0);
  src.stop(end);
}

// Gain envelope: 0 → v over a, then exponential decay (≈ −50 dB after d more seconds).
// Envelope gains start at 0: a source's first frame can precede the first automation event.
function env(t, v, a, d) {
  const g = gain(0), p = g.gain;
  p.setValueAtTime(0, t); p.linearRampToValueAtTime(v, t + a); p.setTargetAtTime(0, t + a, d / 6);
  return g;
}

// Smoothly steer a param toward v; skip no-op updates so automation timelines stay short.
function glide(p, v, tc = 0.1) {
  if (Math.abs((p._v ?? -1) - v) < 0.001 + Math.abs(v) * 0.005) return;
  p._v = v;
  p.setTargetAtTime(v, ctx.currentTime, tc);
}

// ---------- instruments ----------

function tone(t, f, v, d, { type = 'sine', a = 0.003, f1, gt = a + d, lp, q = 0, dest = sfx } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + gt);
  fire(o, t, t + a + d, dest, ...(lp ? [filt('lowpass', lp, q)] : []), env(t, v, a, d));
}

// Filtered noise burst; the filter sweeps f → f1 (at the peak) → f2 (at the end).
function hiss(t, v, a, d, { type = 'bandpass', f = 1000, f1 = f, f2 = f1, q = 1, dest = sfx } = {}) {
  const fl = filt(type, f, q), p = fl.frequency;
  p.setValueAtTime(f, t); p.exponentialRampToValueAtTime(f1, t + a); p.exponentialRampToValueAtTime(f2, t + a + d);
  fire(loopSrc(noiseBuf), t, t + a + d, dest, fl, env(t, v, a, d));
}

// FM bell: sine carrier + modulator at ratio r whose index decays: bright strike, pure tail.
function bell(t, f, v, d, { r = 3.5, i = 1.5, dest = sfx } = {}) {
  const c = ctx.createOscillator(), m = ctx.createOscillator(), mi = ctx.createGain();
  c.frequency.value = f; m.frequency.value = f * r;
  mi.gain.setValueAtTime(f * i, t); mi.gain.setTargetAtTime(0, t, d / 4);
  fire(m, t, t + d, c.frequency, mi);
  fire(c, t, t + d, dest, env(t, v, 0.002, d));
}

// Synth brass: two detuned saws through a swelling lowpass, held for `hold` seconds.
function brass(t, m, v, hold) {
  for (const det of [-7, 7]) {
    const o = ctx.createOscillator(), fl = filt('lowpass', 300, 2), g = gain(0);
    o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det;
    fl.frequency.setValueAtTime(300, t); fl.frequency.linearRampToValueAtTime(3200, t + 0.05);
    fl.frequency.setTargetAtTime(1300, t + 0.05, 0.2);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.03); g.gain.setTargetAtTime(0, t + hold, 0.08);
    fire(o, t, t + hold + 0.5, sfx, fl, g);
  }
}

// Snow crunch: n short grains in quick succession, all from one band-passed noise voice.
function crunch(t, v, n, f) {
  const fl = filt('bandpass', f, 0.9), g = gain(0);
  let at = t;
  for (let j = 0; j < n; j++, at += rnd(0.012, 0.035)) {
    fl.frequency.setValueAtTime(f * rnd(0.7, 1.4), at);
    g.gain.setValueAtTime(v * (1 - j / (n + 1)), at);
    g.gain.setTargetAtTime(0, at, rnd(0.006, 0.014));
  }
  fire(loopSrc(noiseBuf), t, at + 0.1, sfx, fl, g);
}

const thump = (t, f, v, d) => tone(t, f, v, d, { f1: f * 0.4, gt: d * 0.6 });

// Koto-ish pluck: saw through a fast-closing resonant lowpass, with a tiny pitch settle.
function pluck(t, m, v, dest, bright = 1) {
  const f = mtof(m), o = ctx.createOscillator(), fl = filt('lowpass', f, 6), p = fl.frequency;
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(f * 1.015, t); o.frequency.setTargetAtTime(f, t, 0.01);
  p.setValueAtTime(Math.min(f * 7 * bright, 12000), t); p.setTargetAtTime(f * 1.5, t, 0.07 * bright);
  fire(o, t, t + 1.2, dest, fl, env(t, v, 0.002, 1.2));
}

function pad(t, m) {
  [[-9, padL], [9, padR]].forEach(([det, bus]) => {
    const o = ctx.createOscillator(), g = gain(0);
    o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.4); g.gain.setTargetAtTime(0, t + BAR, 0.3);
    fire(o, t, t + BAR + 1.5, bus, g);
  });
}

function bass(t, m, v) {
  const f = mtof(m), o = ctx.createOscillator(), fl = filt('lowpass', f * 8, 4);
  o.type = 'sawtooth'; o.frequency.value = f;
  fl.frequency.setTargetAtTime(f * 2, t, 0.05);
  fire(o, t, t + 0.6, duck, fl, env(t, v, 0.004, 0.6));
}

function kick(t, v) {
  tone(t, 200, v, 0.4, { f1: 45, gt: 0.08, dest: mus });
  duck.gain.setTargetAtTime(0.6, t, 0.005); // gentle sidechain pump on everything tonal
  duck.gain.setTargetAtTime(1, t + 0.05, 0.12);
}

const snare = (t, v) => {
  hiss(t, v, 0.001, 0.22, { f: 1800, q: 0.6, dest: mus });
  tone(t, 185, v * 0.7, 0.12, { f1: 140, dest: mus });
};
const hat = (t, v, open) => hiss(t, v, 0.001, open ? 0.35 : 0.05, { type: 'highpass', f: 7500, q: 0, dest: mus });
const tom = (t, f) => tone(t, f, 0.35, 0.35, { f1: f * 0.6, gt: 0.25, dest: mus });

// ---------- sound effects: (t, k) with k = intensity 0..2 ----------

const SFX = {
  click: t => tone(t, 1600, 0.3, 0.05, { type: 'triangle', f1: 1000, gt: 0.03 }),
  deny: t => {
    tone(t, 190, 0.2, 0.1, { type: 'square', f1: 170, lp: 1100 });
    tone(t + 0.12, 140, 0.2, 0.16, { type: 'square', f1: 120, lp: 900 });
  },
  buy: t => {
    bell(t, mtof(84), 0.19, 0.2, { r: 2, i: 1 }); // ka-
    bell(t + 0.07, mtof(89), 0.19, 0.7, { r: 2, i: 1 }); // -ching
    for (let j = 0; j < 8; j++) bell(t + 0.12 + j * 0.05 + rnd(0, 0.02), mtof(pent(10 + j)), 0.07, 0.3, { i: 0.8 });
  },
  launch: (t, k) => {
    hiss(t, 0.5 * k, 0.2, 0.7, { f: 300, f1: 2500, f2: 600, q: 1.2 });
    tone(t, 160, 0.14, 0.55, { type: 'sawtooth', a: 0.06, f1: 640, gt: 0.5, lp: 2000 });
    tone(t, 320, 0.07, 0.5, { type: 'triangle', a: 0.06, f1: 1280, gt: 0.5 });
  },
  pop: t => {
    tone(t, 240, 0.44, 0.1, { f1: 720, gt: 0.05 });
    hiss(t, 0.15, 0.001, 0.04, { type: 'highpass', f: 3000, q: 0 });
  },
  perfect: t => {
    [77, 81, 84, 89, 93].forEach((m, j) => bell(t + j * 0.035, mtof(m), 0.083, 1.6, { i: 1.2 }));
    bell(t + 0.2, mtof(101), 0.036, 1.2);
  },
  land: (t, k) => {
    const v = 0.3 + 0.5 * Math.min(k, 1.5);
    thump(t, 110, 0.66 * v, 0.2);
    crunch(t, 0.46 * v, Math.round(3 + 3 * k), 1800);
  },
  hardland: t => {
    thump(t, 90, 0.6, 0.4);
    hiss(t, 0.3, 0.002, 0.35, { type: 'lowpass', f: 900, f2: 200, q: 0 });
    crunch(t, 0.35, 9, 1200);
    hiss(t, 0.15, 0.001, 0.08, { f: 420, q: 6 }); // sled clack
  },
  crash: t => {
    [0, 0.22, 0.4, 0.62, 0.8].forEach((dt, j) => {
      const v = 1 - j * 0.17;
      thump(t + dt, rnd(80, 120), 0.6 * v, 0.25);
      crunch(t + dt, 0.36 * v, 5, rnd(900, 1800));
      if (j % 2) hiss(t + dt, 0.14 * v, 0.001, 0.1, { f: rnd(300, 700), q: 7 }); // gear knocks
    });
    hiss(t, 0.18, 0.05, 1.2, { f: 2000, f1: 1200, f2: 400, q: 0.5 }); // snow spray
  },
  flip: (t, k) => hiss(t, 0.72, 0.08, 0.18, { f: 500, f1: 2600 * (0.85 + 0.15 * k), f2: 800, q: 2 }),
  coin: t => {
    if (coinT - t > 0.2) return; // a burst is already queued: drop extras
    coinN = t - coinT < 0.5 ? Math.min(coinN + 1, 7) : 0; // quick succession climbs the scale
    coinT = Math.max(t, coinT + 0.06);
    const k = 8 + coinN, det = 2 ** (rnd(-12, 12) / 1200), v = 0.16 - 0.01 * coinN;
    bell(coinT, mtof(pent(k)) * det, v, 0.18, { r: 2, i: 1 });
    bell(coinT + 0.055, mtof(pent(k + 2)) * det, v, 0.3, { r: 2, i: 1 });
  },
  ring: t => {
    hiss(t, 0.37, 0.08, 0.4, { f: 700, f1: 4000, f2: 1200, q: 1.5 });
    tone(t, 700, 0.06, 0.4, { type: 'triangle', f1: 2800, gt: 0.25 });
    [89, 93, 96, 101].forEach((m, j) => bell(t + 0.05 + j * 0.04, mtof(m), 0.075, 0.6, { i: 1 }));
  },
  milestone: t => [84, 89, 93].forEach((m, j) => bell(t + j * 0.13, mtof(m), 0.13, j === 2 ? 1.4 : 0.6, { r: 2, i: 1.2 })),
  record: t => {
    [0, 0.1, 0.2].forEach(dt => brass(t + dt, 72, 0.07, 0.07));
    [69, 72, 77].forEach(m => brass(t + 0.3, m, 0.06, 0.7));
    [89, 93, 96, 101, 105].forEach((m, j) => bell(t + 0.3 + j * 0.05, mtof(m), 0.05, 1.2));
    thump(t + 0.3, 110, 0.4, 0.4);
  },
  whoosh: (t, k) => hiss(t, 0.52 * k, 0.12, 0.35, { f: 400, f1: 1800, f2: 500, q: 1 }),
  win: t => {
    [72, 74, 77].forEach((m, j) => brass(t + j * 0.14, m, 0.07, 0.1));
    brass(t + 0.42, 81, 0.07, 0.45);
    [[1, [58, 65, 70]], [1.3, [60, 67, 72]], [1.6, [65, 69, 72, 77]]].forEach(([dt, chord], j) => {
      chord.forEach(m => brass(t + dt, m, 0.05, j < 2 ? 0.22 : 1.4));
      thump(t + dt, j < 2 ? 75 : 60, 0.5, 0.5); // timpani-ish
    });
    hiss(t + 1.6, 0.12, 0.01, 2.5, { type: 'highpass', f: 5000, q: 0 }); // cymbal
    for (let j = 0; j < 10; j++) bell(t + 1.6 + j * 0.06, mtof(pent(8 + j)), 0.04, 1.2);
  },
  ignite: t => { // booster light-up, played automatically on the boosting rising edge
    hiss(t, 0.34, 0.01, 0.35, { type: 'lowpass', f: 300, f1: 2000, f2: 400, q: 1 });
    thump(t, 90, 0.34, 0.3);
  },
};

// ---------- music: 16-bar "royal road" (IV–V–iii–vi) progression in F, 96 BPM ----------

const PROG = [ // [bass MIDI, pad voicing]
  [34, [58, 62, 65, 69]], [36, [58, 62, 65, 67]], [33, [55, 60, 64, 69]], [38, [57, 60, 64, 65]], // B♭Δ C11 Am7 Dm9
  [34, [58, 62, 65, 69]], [36, [58, 64, 67, 72]], [41, [57, 60, 64, 67]], [41, [57, 60, 63, 67]], // B♭Δ C7 FΔ9 F7
  [43, [58, 62, 65, 69]], [36, [58, 64, 67, 72]], [33, [55, 60, 64, 69]], [38, [57, 60, 64, 65]], // Gm9 C7 Am7 Dm9
  [34, [58, 62, 65, 69]], [36, [58, 62, 65, 67]], [38, [57, 60, 64, 65]], [36, [58, 64, 67, 70]], // B♭Δ C11 Dm9 C7
];
// One char per 16th. Melody digits index pent(); bass r/o/f = root/octave/fifth; arp digits = chord tone (4 = root, 8va).
const MEL = ['7.65..4.5.6.....', '..676.54..3.....', '3.43..2.1.2.3...', '4.....5.7...6.5.',
  '5..4..3.4.......', '..345.6.5.4.3...', '2..3..4.5..67...', '6...5.4.3.......'];
const BASS = ['r..r..o.r..r.of.', 'r.....r.o.r..fo.'];
const ARP = ['0.2.1.3.2.4.3.2.', '0..2..1.3..4..2.'];
const DRUM = ['k...s.k.k...s...', 'k...s...k.k.s..g'], FILL = 'k...s.k.h.m.lsss', HAT = 'o.x.o.x.o.x.o.xo';

function schedule(i, t) {
  const s = i & 15, bar = (i >> 4) & 15, loop = i >> 8, B = +(bar >= 8), [root, chord] = PROG[bar];
  const lead = B || loop % 2; // phrase B always has the hook; odd loops echo it softly in phrase A
  if (s === 0) {
    chord.forEach(m => pad(t, m));
    if (i && bar % 8 === 0) hiss(t, 0.05, 0.005, 1.8, { type: 'highpass', f: 5000, q: 0, dest: mus }); // crash
  }
  const b = BASS[B][s];
  if (b !== '.') bass(t, root + (b === 'o' ? 12 : b === 'f' ? 7 : 0), 0.27);
  const d = (bar % 8 === 7 ? FILL : DRUM[B])[s];
  if (!(loop % 3 === 2 && bar < 2)) { // every third loop opens with a two-bar breakdown
    if (d === 'k') kick(t, 0.4);
    else if (d === 's' || d === 'g') snare(t, d === 'g' ? 0.08 : s > 12 ? 0.12 + 0.05 * (s - 12) : 0.25);
    else if (d !== '.') tom(t, { h: 220, m: 160, l: 115 }[d]);
  }
  if (HAT[s] !== '.') hat(t, (HAT[s] === 'x' ? 0.12 : 0.06) * rnd(0.7, 1.1), s === 14 && bar % 2);
  const a = ARP[lead][s];
  if (a !== '.') pluck(t, chord[a % 4] + 12 * (1 + (a >> 2)), 0.11, arps);
  const n = MEL[bar % 8][s];
  if (n !== '.' && B) pluck(t, pent(+n), 0.18, arps, 1.3);
  else if (n !== '.' && lead) bell(t, mtof(pent(+n) + 12), 0.04, 1, { dest: arps }); // music-box answer
  if (t < airUntil) pluck(t, chord[(s + (s >> 2)) % 4] + 24, 0.09, airG, 1.6); // flight sparkle layer
}

function tick() {
  const now = ctx.currentTime;
  if (now - lastFrame > 0.3) layers(null); // frame() stopped (menus, pause): let the run layers fade out
  if (!musicOn) return;
  if (nextT < now) nextT = now + 0.05; // timer was throttled: skip ahead instead of cramming notes
  for (; nextT < now + 0.12; nextT += S16, step++) if (!muted) schedule(step, nextT);
}

// ---------- continuous run layers ----------

function layers(s) {
  const run = !!(s && s.running), v = run ? clamp(+s.speed || 0, 0, 90) / 80 : 0;
  const air = run && !!s.air, tuck = run && !!s.tuck;
  const sv = run && s.ground ? 0.14 * Math.min(1, 2 * v) ** 0.5 : 0;
  glide(L.snow.gain, sv, 0.05);
  glide(L.grainAmt.gain, 0.6 * sv, 0.05);
  glide(L.snowLp.frequency, (1000 + 3000 * v) * (tuck ? 1.2 : 1));
  glide(L.grain.playbackRate, 0.0008 + 0.004 * v);
  glide(L.wind.gain, run ? v * (air ? 0.4 : 0.2) * (tuck ? 0.8 : 1) : 0, 0.25);
  glide(L.windBp.frequency, 250 + 1500 * v + (air ? 250 : 0), 0.25);
  glide(L.whistle.gain, run ? 0.25 * clamp((v - 0.55) / 0.35, 0, 1) : 0, 0.4);
  glide(L.whistleBp.frequency, 600 + 1600 * v, 0.3);
  const b = run && !!s.boosting && !s.crashed;
  if (b && !boosting) play('ignite');
  boosting = b;
  glide(L.boost.gain, b ? 0.32 : 0, b ? 0.03 : 0.1);
  glide(L.flutAmt.gain, b ? 0.16 : 0, b ? 0.03 : 0.1);
  if (air) airUntil = ctx.currentTime + 3;
  glide(airG.gain, air ? clamp(0.4 + (+s.alt || 0) / 80, 0.4, 1) : 0, 0.8);
}

// ---------- graph ----------

function build() {
  const sr = ctx.sampleRate, buf = fn => {
    const b = ctx.createBuffer(1, 2 * sr, sr), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = fn();
    return b;
  };
  noiseBuf = buf(() => rnd(-1, 1));
  let e = 0; // sparse decaying pops: firework crackle
  const crackBuf = buf(() => (e = Math.random() < 0.0012 ? rnd(0.3, 1) : e * 0.992) * rnd(-1, 1));

  const comp = ctx.createDynamicsCompressor(); // gentle glue that doubles as the peak limiter
  comp.threshold.value = -10; comp.knee.value = 10; comp.ratio.value = 12;
  comp.attack.value = 0.002; comp.release.value = 0.25;
  comp.connect(ctx.destination);
  master = gain(muted ? 0 : MASTER, comp);
  sfx = gain(1, master);
  amb = gain(1, master);
  mus = gain(musicOn ? MUSIC : 0, master);
  duck = gain(1, mus);
  arps = gain(1, duck);
  airG = gain(0, arps);

  // Pads: detuned saw pairs spread left/right through slowly breathing lowpasses.
  const lfo = ctx.createOscillator(), lfoAmt = gain(350);
  lfo.frequency.value = 0.07; lfo.connect(lfoAmt);
  [padL, padR] = [-0.6, 0.6].map(p => {
    const pan = ctx.createStereoPanner(), f = filt('lowpass', 1300, 0, pan);
    pan.pan.value = p; pan.connect(duck); lfoAmt.connect(f.frequency);
    return f;
  });
  // Tempo-synced dotted-8th echo on the plucks.
  const dl = ctx.createDelay(1), dlp = filt('lowpass', 2400, 0, mus);
  dl.delayTime.value = 3 * S16; dl.connect(dlp); dlp.connect(gain(0.38, dl)); arps.connect(gain(0.3, dl));

  // Run layers share one looping hiss; slowed-down noise buffers act as smooth random modulators.
  const hissSrc = loopSrc(noiseBuf), grain = loopSrc(noiseBuf, 0.001), gust = loopSrc(noiseBuf, 0.00005);
  const flutter = loopSrc(noiseBuf, 0.004), crackle = loopSrc(crackBuf), saw = ctx.createOscillator();
  const snow = gain(0, amb), snowLp = filt('lowpass', 1500, 0, snow), grainAmt = gain(0, snow.gain);
  hissSrc.connect(filt('highpass', 350, 0, snowLp)); grain.connect(grainAmt);
  const wind = gain(0, amb), windBp = filt('bandpass', 400, 0.8, wind);
  const whistle = gain(0, amb), whistleBp = filt('bandpass', 1000, 16, whistle), gustAmt = gain(300);
  hissSrc.connect(windBp); hissSrc.connect(whistleBp);
  gust.connect(gustAmt); gustAmt.connect(windBp.detune); gustAmt.connect(whistleBp.detune);
  const boost = gain(0, amb), flutAmt = gain(0, boost.gain);
  hissSrc.connect(filt('lowpass', 800, 1, boost));
  saw.type = 'sawtooth'; saw.frequency.value = 55;
  saw.connect(filt('lowpass', 300, 0, gain(0.5, boost)));
  crackle.connect(filt('highpass', 1500, 0, gain(0.8, boost)));
  flutter.connect(flutAmt);
  [lfo, hissSrc, grain, gust, flutter, crackle, saw].forEach(n => n.start());
  L = { snow, snowLp, grainAmt, grain, wind, windBp, whistle, whistleBp, boost, flutAmt };

  nextT = ctx.currentTime + 0.1;
  setInterval(safe(tick), 25); // lookahead scheduler: ~120 ms ahead, independent of frame rate
  document.addEventListener('visibilitychange', safe(() => quiet(document.hidden ? ctx.suspend() : ctx.resume())));
}

// ---------- public API ----------

function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    build();
  }
  if (ctx.state !== 'running') quiet(ctx.resume());
}

function frame(dt, s) {
  if (!ctx) return;
  lastFrame = ctx.currentTime;
  layers(s);
}

function play(name, k = 1) {
  if (!ctx || muted || !SFX[name]) return;
  SFX[name](ctx.currentTime, clamp(+k || 0, 0, 2));
}

function setMuted(b) {
  muted = !!b;
  if (ctx) glide(master.gain, muted ? 0 : MASTER, 0.06);
}

function setMusic(b) {
  musicOn = !!b;
  if (!ctx) return;
  glide(mus.gain, musicOn ? MUSIC : 0, 0.25);
  if (musicOn && nextT < ctx.currentTime) step = 0; // fresh start from bar 1
}

export const audio = {
  unlock: safe(unlock), frame: safe(frame), play: safe(play), setMuted: safe(setMuted), setMusic: safe(setMusic),
};
