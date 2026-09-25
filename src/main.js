// Game glue: fixed-step loop, input, camera, run lifecycle, pickups and scoring.
import { makeTerrain, newRider, step, DT } from './physics.js';
import { TRACKS, GOAL, loadSave, storeSave, newSave, loadoutStats, buy, payout } from './items.js';
import { createView } from './view.js';
import { initUI, showScreen, updateHUD, toast } from './ui.js';
import { audio } from './audio.js';

const T = makeTerrain();
let save = loadSave();
const view = createView(document.getElementById('game'), T);
view.setLoadout(save.levels);
audio.setMuted(save.settings.muted);
audio.setMusic(save.settings.music);

let mode = 'title';
let st = loadoutStats(save.levels);
let r = newRider(T, st);
const prev = { x: r.x, y: r.y, a: r.a };
const inp = { up: false, down: false, boost: false, jump: false };
const cam = { x: r.x + 8, y: r.y, h: 16, roll: 0 };
const eye = { x: cam.x, y: cam.y, h: cam.h, lead: 0, trauma: 0, punch: 0 }; // smoothed camera before shake
const TIME_SCALE = 1.2; // research: same trajectories, ~20% snappier
let freeze = 0, slowT = 0, slowK = 1;
let jumpShown = false, acc = 0, items = [], next = 0, got = { lanterns: 0, rings: 0, yen: 0 }, milestone = 0, recordShown = false, endTimer = -1;
const events = [];

const shopData = () => ({ save, tracks: TRACKS, goal: GOAL });

initUI({
  onLaunch: startRun,
  onBuy(id) {
    if (buy(save, id)) {
      audio.play('buy'); storeSave(save);
      st = loadoutStats(save.levels); view.setLoadout(save.levels); resetRider();
    } else audio.play('deny');
    showScreen('shop', shopData());
  },
  onEndRun: () => mode === 'run' && finish(),
  onReset() { // erases progress only: the sound settings stay (the audio module was never told otherwise)
    save = { ...newSave(), settings: save.settings }; storeSave(save);
    st = loadoutStats(save.levels); view.setLoadout(save.levels); resetRider(); showScreen('shop', shopData());
  },
  onSetting(key, value) {
    save.settings[key] = value; storeSave(save);
    if (key === 'muted') audio.setMuted(value);
    if (key === 'music') audio.setMusic(value);
  },
  onInput(name, down) { press(name, down); },
  onScreen(name) { // ui.js moves title→shop and results→shop on its own
    if (name === 'shop' && mode !== 'shop') { mode = 'shop'; resetRider(); }
  },
});
showScreen('shop', shopData());
showScreen('title', shopData());

// ------------------------------------------------------------------ input

const KEYS = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', Space: 'boost', ShiftLeft: 'boost', ShiftRight: 'boost' };
function press(name, down) {
  if (name === 'up' && down && !inp.up) inp.jump = true;
  inp[name] = down;
}
addEventListener('keydown', e => {
  audio.unlock();
  if (mode !== 'run') return;
  if (e.code === 'Escape') return finish();
  const k = KEYS[e.code];
  if (!k) return;
  e.preventDefault();
  if (!e.repeat || k === 'down') press(k, true); // ↓ held since the menu still tucks (↑/boost repeats must not pop/fire)
});
addEventListener('keyup', e => { const k = KEYS[e.code]; if (k) press(k, false); });
addEventListener('pointerdown', () => audio.unlock());
addEventListener('touchend', () => audio.unlock());
addEventListener('blur', () => { inp.up = inp.down = inp.boost = false; });

// ------------------------------------------------------------------ run lifecycle

function resetRider() {
  r = newRider(T, st);
  Object.assign(prev, { x: r.x, y: r.y, a: r.a });
}

function startRun() {
  audio.unlock();
  st = loadoutStats(save.levels);
  resetRider();
  inp.up = inp.down = inp.boost = inp.jump = false;
  items = spawnItems(save.runs + 1);
  next = 0; got = { lanterns: 0, rings: 0, yen: 0 }; milestone = 0; recordShown = save.best < 20; endTimer = -1; jumpShown = false;
  acc = 0; freeze = slowT = 0;
  view.startRun({ items, best: save.best });
  mode = 'run';
  showScreen('run', { save });
  audio.play('whoosh', 0.5);
}

function finish() {
  if (mode !== 'run') return;
  r.done = true;
  const dist = Math.max(0, r.maxX);
  const run = { dist, airtime: r.airtime, maxAlt: r.maxAlt, flips: r.flips, landing: r.landing, lanterns: got.lanterns, rings: got.rings };
  const pay = payout(run, st.mult, save.best);
  const newRecord = dist > save.best + 0.05;
  const won = dist >= GOAL && !save.won;
  save.yen += pay.total; save.runs++;
  if (newRecord) save.best = dist;
  if (won) save.won = true;
  storeSave(save);
  mode = 'results';
  audio.play(won ? 'win' : newRecord ? 'record' : 'click');
  showScreen('results', {
    save,
    summary: { dist, best: save.best, newRecord, won, airtime: r.airtime, maxAlt: r.maxAlt, maxSpeed: r.maxSpeed,
      flips: r.flips, landing: r.landing, lanterns: got.lanterns, rings: got.rings, lines: pay.lines, total: pay.total },
  });
}

// Lantern arcs and boost rings, seeded per run so each run differs but replays are stable.
function spawnItems(seed) {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 233280 + 49297) % 2147483647) / 2147483647);
  const out = [];
  const far = Math.max(400, save.best * 1.6 + 300);
  let id = 0;
  for (let x = 25 + rnd() * 20; x < far; x += 25 + rnd() * 45 + x * 0.03) {
    const alt = 3 + rnd() * Math.min(60, 6 + x * 0.12);
    if (rnd() < 0.18 && x > 80) { out.push({ id: id++, kind: 'ring', x, y: T.h(x) + alt + 4 }); continue; }
    const n = 3 + Math.floor(rnd() * 4), arc = 1 + rnd() * 3;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1) - 0.5, xi = x + i * 3.2;
      out.push({ id: id++, kind: 'lantern', x: xi, y: T.h(xi) + alt + arc * (1 - 4 * u * u) });
    }
  }
  return out.sort((a, b) => a.x - b.x);
}

function pickups() {
  while (next < items.length && items[next].x < r.x - 12) next++;
  for (let i = next; i < items.length && items[i].x < r.x + 12; i++) {
    const it = items[i];
    if (it.taken) continue;
    const rad = it.kind === 'ring' ? 3.2 + st.magnet * 0.3 : st.magnet;
    if (Math.hypot(it.x - r.x, it.y - (r.y + 0.8)) > rad) continue;
    it.taken = true;
    view.collect(it.id);
    if (it.kind === 'ring') {
      got.rings++;
      const sp = Math.hypot(r.vx, r.vy) || 1, kick = 7;
      if (r.ground) r.s += Math.sign(r.s || 1) * kick;
      else { r.vx += (r.vx / sp) * kick; r.vy += (r.vy / sp) * kick; }
      audio.play('ring'); toast('BOOST!', 'great');
    } else {
      got.lanterns++;
      audio.play('coin');
    }
  }
}

const MARKS = [50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 2500, 3000, GOAL, 4000, 5000, 7500, 10000];
const flipName = (n, back) => `${['', '', 'DOUBLE ', 'TRIPLE ', 'QUAD '][n] ?? n + '× '}${back ? 'BACKFLIP' : 'FRONTFLIP'}`;

const hitStop = (f, t = 0, k = 1) => { freeze = Math.max(freeze, f); if (t) { slowT = t; slowK = k; } };

function handle(e) {
  switch (e.type) {
    case 'pop':
      audio.play('pop');
      if (e.perfect) audio.play('perfect');
      eye.trauma += 0.15;
      if (e.perfect) { toast('PERFECT POP!', 'great'); hitStop(0.05, 0.22, 0.5); }
      else if (e.early) toast('EARLY POP', 'bad');
      else if (e.late) toast('LATE POP', 'bad');
      view.fx('pop', e);
      break;
    case 'launch':
      audio.play('launch', Math.min(1, e.speed / 30));
      view.fx('launch', e);
      break;
    case 'flip': audio.play('flip'); break;
    case 'land': {
      const hard = e.quality === 'hard';
      audio.play(hard || e.quality === 'sketchy' ? 'hardland' : 'land', Math.max(0.2, Math.min(1.5, e.vn / 10)));
      if (e.quality === 'perfect' && e.airT > 0.5) audio.play('perfect');
      eye.trauma += hard ? 0.5 : 0.2;
      eye.punch = 0.04;
      view.fx('land', e);
      if (!r.launched || e.x < 1 || e.airT < 0.25) break;
      if (e.quality === 'perfect') hitStop(0.04);
      if (hard) hitStop(0.07);
      if (r.landing && !jumpShown) { jumpShown = true; toast(`JUMP ${e.x.toFixed(1)} m`, 'info'); }
      if (e.flips) toast(flipName(e.flips, e.back), 'great');
      toast({ perfect: 'BUTTER LANDING!', good: 'CLEAN LANDING', hard: 'HARD LANDING', sketchy: 'SKETCHY…' }[e.quality], e.quality === 'perfect' ? 'great' : e.quality === 'good' ? 'good' : 'bad');
      break;
    }
    case 'crash':
      audio.play('crash'); toast('WIPEOUT!', 'bad');
      eye.trauma += 0.9; eye.punch = 0.06;
      hitStop(0.12, 0.6, 0.35);
      if (!jumpShown && r.launched) { jumpShown = true; toast(`JUMP ${e.x.toFixed(1)} m`, 'info'); }
      view.fx('crash', e);
      break;
    case 'stop': endTimer = 0.9; break;
  }
}

// ------------------------------------------------------------------ camera

const damp = (k, dt) => 1 - Math.exp(-k * dt);
const noise = (t, s) => Math.sin(t * 2.1 + s) * 0.6 + Math.sin(t * 5.3 + s * 3.1) * 0.3 + Math.sin(t * 11.7 + s * 7.7) * 0.1;
let camT = 0;
function updateCamera(dt, v) {
  const speed = Math.hypot(v.vx, v.vy);
  const alt = Math.max(0, v.y - T.h(v.x));
  let h, lead, ty;
  if (mode === 'run' || mode === 'results') {
    // zoom with speed, and far enough out that the snow below stays in frame (up to the 160 m cap);
    // narrow (portrait) screens zoom out further, or the lip and the landing ahead only show up ~0.4 s before you reach them
    h = Math.min(160, Math.max(12 + 0.5 * speed + 0.3 * alt, alt / 0.62 + 4) * Math.max(1, 0.8 / aspect()));
    const L = 0.175 * h * aspect(); // look-ahead ≤ 35% of half the view width
    lead = Math.max(-L, Math.min(L, v.vx * 0.35));
    // rider ~37% up from the bottom near the ground; higher up, keep the snow ≥10% above the bottom edge
    // but never let the rider climb past ~72% (the HUD lives above that)
    ty = Math.max(v.y - 0.22 * h, Math.min(v.y + 0.125 * h, v.y - alt + 0.4 * h));
  } else if (mode === 'title') {
    h = 70; lead = 0; ty = 10;
  } else {
    h = 20; lead = Math.min(11, 0.3 * h * aspect()); ty = v.y + 0.125 * h - 2; // parked at the gate, looking down the in-run
  }
  eye.h += (h - eye.h) * damp(h > eye.h ? 3 : 1.2, dt);
  eye.lead += (lead - eye.lead) * damp(3, dt);
  const tx = mode === 'title' ? 25 : v.x + eye.lead;
  eye.x += (tx - eye.x) * damp(8, dt);
  eye.y += (ty - eye.y) * damp(5, dt);
  // trauma shake: offset ∝ trauma², decays; small floor while boosting / very fast
  const floor = mode === 'run' ? Math.max(v.boosting ? 0.25 : 0, Math.min(0.25, (speed - 30) / 60)) : 0;
  eye.trauma = Math.max(floor, Math.min(1, eye.trauma) - 1.8 * dt);
  eye.punch *= Math.exp(-6 * dt);
  camT += dt * 20;
  const sh = eye.trauma * eye.trauma, amp = 0.025 * eye.h * sh;
  cam.h = eye.h * (1 - eye.punch);
  cam.x = eye.x + amp * noise(camT, 1);
  cam.y = eye.y + amp * noise(camT, 2);
  cam.roll = 0.0436 * sh * noise(camT, 3); // ≤ 2.5°
}
const aspect = () => innerWidth / Math.max(1, innerHeight);

// ------------------------------------------------------------------ main loop

const view_r = { x: 0, y: 0, a: 0, vx: 0, vy: 0, speed: 0, ground: true, tuck: false, boosting: false, glide: false, crashed: false, fuel: 0, t: 0 };
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  if (mode === 'run') {
    let scale = TIME_SCALE;
    if (freeze > 0) { freeze -= dt; scale = 0; }
    else if (slowT > 0) { slowT -= dt; scale *= slowK; }
    acc += dt * scale;
    while (acc >= DT && !r.done) {
      prev.x = r.x; prev.y = r.y; prev.a = r.a;
      step(r, inp, st, T, events);
      pickups();
      for (const e of events) handle(e);
      events.length = 0;
      acc -= DT;
    }
    if (r.done && endTimer < 0) endTimer = 0.9;
    if (endTimer >= 0 && (endTimer -= dt) < 0) finish();

    const dist = Math.max(0, r.maxX);
    while (milestone < MARKS.length && dist >= MARKS[milestone]) {
      const m = MARKS[milestone++];
      toast(m === GOAL ? 'TOKYO TOWER!' : `${m} m`, m === GOAL ? 'great' : 'info');
      audio.play(m === GOAL ? 'win' : 'milestone');
      view.fx('milestone', { x: r.x, y: r.y, dist: m });
    }
    if (!recordShown && dist > save.best) { recordShown = true; toast('NEW RECORD!', 'great'); audio.play('record'); }
    updateHUD({ dist, best: save.best, speed: Math.hypot(r.vx, r.vy), alt: Math.max(0, r.y - T.h(r.x)),
      fuel: st.fuel > 0 ? r.fuel / st.fuel : null, goal: GOAL,
      yen: Math.round((dist + r.airtime * 4 + r.maxAlt * 1.5 + r.flips * 25 + got.lanterns * 5 + got.rings * 15) * st.mult) });
  }

  // interpolate between the last two physics states for smooth rendering at any refresh rate
  const k = mode === 'run' ? Math.min(1, acc / DT) : 1;
  let da = r.a - prev.a;
  da -= Math.PI * 2 * Math.round(da / (Math.PI * 2));
  Object.assign(view_r, {
    x: prev.x + (r.x - prev.x) * k, y: prev.y + (r.y - prev.y) * k, a: prev.a + da * k,
    vx: r.vx, vy: r.vy, speed: Math.hypot(r.vx, r.vy), ground: r.ground, tuck: r.tuck,
    boosting: r.boosting && mode === 'run', glide: r.glide, crashed: r.crashed, fuel: st.fuel ? r.fuel / st.fuel : 0, t: r.t,
  });
  updateCamera(dt, view_r);
  view.frame(dt, view_r, cam);
  audio.frame(dt, { running: mode === 'run', speed: view_r.speed, ground: r.ground, air: !r.ground, tuck: r.tuck,
    boosting: view_r.boosting, crashed: r.crashed, alt: Math.max(0, r.y - T.h(r.x)) });
}
requestAnimationFrame(frame);
addEventListener('resize', () => view.resize());

// test hook (read-only use from automated playtests)
window.__game = { get r() { return r; }, get mode() { return mode; }, get save() { return save; }, T, inp, cam };
