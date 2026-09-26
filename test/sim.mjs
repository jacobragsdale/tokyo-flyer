// Headless physics checks + a bot pilot for tuning distances and the economy.
// Run: node test/sim.mjs            (asserts + loadout table)
//      node test/sim.mjs progress   (also simulates a whole playthrough)
import assert from 'node:assert/strict';
import { makeTerrain, newRider, step, DT, G, wrap } from '../src/physics.js';
import { TRACKS, loadoutStats, newSave, nextTier, buy, payout, GOAL, progress, stage, weather, DRIFT } from '../src/items.js';

const T = makeTerrain();

// --- terrain sanity: derivatives agree with finite differences, surface continuous except at the lip
for (let x = -130; x < 3000; x += 0.37) {
  if (Math.abs(x) < 0.02) continue;
  const e = 1e-4, a = T.at(x), h = a.h, d1 = a.d1, d2 = a.d2;
  const fd1 = (T.h(x + e) - T.h(x - e)) / (2 * e), fd2 = (T.h(x + e) - 2 * h + T.h(x - e)) / (e * e);
  assert.ok(Math.abs(fd1 - d1) < 1e-3, `slope mismatch at ${x}: ${fd1} vs ${d1}`);
  assert.ok(Math.abs(fd2 - d2) < 0.05, `curvature mismatch at ${x}: ${fd2} vs ${d2}`);
  assert.ok(Math.abs(T.h(x + 0.01) - h) < 0.02 || (x < 0 && x + 0.01 >= 0), `terrain jump at ${x}`);
  assert.ok(Math.abs(Math.atan(d1)) < 40 * Math.PI / 180, `too steep at ${x}`);
}

// --- energy: frictionless, dragless slide from gate h must reach the lip at sqrt(2gh)
{
  const st = { ...loadoutStats(newSave().levels), mu: 0, cda: 0 };
  const flat = { ...T, powder: () => 0 };
  const r = newRider(flat, st); r.s = 0;
  const ev = [];
  while (!r.launched && r.t < 30) step(r, {}, st, flat, ev);
  const ideal = Math.sqrt(2 * G * st.gateH);
  assert.ok(Math.abs(Math.hypot(r.vx, r.vy) - ideal) / ideal < 0.01, `energy drift: ${Math.hypot(r.vx, r.vy)} vs ${ideal}`);
}

// --- unpowered flight can never gain energy, whatever the pilot does (lift is applied as a pure rotation)
for (const gl of [1, 2, 3, 4, 5]) {
  const st = loadoutStats({ ...newSave().levels, glider: gl });
  const r = newRider(T, st);
  Object.assign(r, { x: 100, y: 400, vx: 30, vy: 0, a: 0, ground: false, launched: true });
  let seed = gl, inp = { up: false, down: false };
  const E = () => 0.5 * (r.vx ** 2 + r.vy ** 2) + G * r.y;
  for (let i = 0; i < 240 * 20; i++) {
    if (i % 30 === 0) { seed = (seed * 16807) % 2147483647; inp = { up: seed % 3 === 0, down: seed % 3 === 1 }; }
    const e0 = E();
    step(r, inp, st, T, []);
    if (r.ground) break;
    assert.ok(E() <= e0 + 1e-6, `glider ${gl} gained energy at step ${i}: ${E() - e0}`);
  }
}

// --- a late (coyote) pop latches ↑ like a pop on the snow: holding that tap must not pitch the nose up
{
  const st = loadoutStats(newSave().levels);
  const r = newRider(T, st), inp = { up: false, down: false, boost: false, jump: false }, ev = [];
  while (!r.launched) step(r, inp, st, T, ev);
  const a0 = r.a;
  inp.up = inp.jump = true; // ↑ pressed just after the lip and held for a 0.15 s tap
  for (let i = 0; i < 36; i++) step(r, inp, st, T, ev);
  assert.ok(ev.some(e => e.type === 'pop' && e.late), 'late pop did not fire');
  assert.ok(Math.abs(r.a - a0) < 1e-3, `late-pop tap pitched the nose by ${((r.a - a0) * 180 / Math.PI).toFixed(1)}°`);
}

// --- economy: a first run with no input at all pays for the cheapest first item within 2 runs
{
  const st = loadoutStats(newSave().levels), r = newRider(T, st);
  while (!r.done && !(r.jump != null && r.t - r.landT > 2.2)) step(r, {}, st, T, []);
  const pay = payout({ ...r, dist: r.jump ?? 0, lanterns: 0, rings: 0 }, 1, 0).total;
  const cheapest = Math.min(...TRACKS.map(t => t.tiers[1].price));
  assert.ok(2 * pay >= cheapest, `a no-input first run pays ¥${pay}: the first item (¥${cheapest}) takes more than 2 runs`);
}

// --- the koi → dragon drift: 0 at the start, 1 fully upgraded, every purchase moves it on, stages and weather follow
{
  const s = newSave();
  assert.equal(progress(s.levels), 0);
  assert.equal(stage(0), 0);
  assert.ok(DRIFT.every(([at], i) => i === 0 || at > DRIFT[i - 1][0]) && DRIFT.at(-1)[0] < 1, 'drift thresholds must ascend below 1');
  assert.ok(DRIFT.length <= 15, 'group 0 of the rider mesh has 16 tiers: the base look plus 15 stages');
  let p = 0, st0 = 0;
  for (const t of TRACKS) for (let i = 1; i < t.tiers.length; i++) {
    s.levels[t.id] = i;
    const q = progress(s.levels);
    assert.ok(q > p, `buying ${t.tiers[i].name} did not move the drift on`);
    p = q;
  }
  assert.ok(Math.abs(p - 1) < 1e-9, `fully upgraded drift is ${p}, not 1`);
  for (let q = 0; q <= 1; q += 0.05) {
    const w = weather(q), k = stage(q);
    assert.ok(k >= st0 && [w.petals, w.rain, w.storm].every(v => v >= 0 && v <= 1), `stage/weather out of range at ${q}`);
    st0 = k;
  }
  assert.deepEqual(weather(0.1, true), weather(1), 'a dragon always flies in the full storm');
}

// --- bot pilot -----------------------------------------------------------------------------
// Tucks, pops at the lip, then flies one simple strategy: hands-off (the landing assist lines it up), or
// hold a fixed attitude; boosters burn at a fixed climb angle. 'best' tries them all and keeps the longest
// clean-ish jump (memoized per loadout), which approximates a player who has learned the loadout.
function flyOnce(levels, att, boostAtt, trace) {
  const st = loadoutStats(levels);
  const r = newRider(T, st);
  const inp = { up: false, down: false, boost: false, jump: false };
  const ev = [], log = [];
  while (!r.done && !(r.jump != null && r.t - r.landT > 2.5)) { // a run ends 2.5 s after the jump lands
    inp.up = inp.down = inp.boost = false;
    if (r.ground) {
      inp.down = !r.launched;
      if (!r.launched && r.x > -1.2 && r.x < 0) inp.jump = true;
    } else if (r.launched) {
      let target = att;
      if (r.fuel > 0 && st.thrust) { target = boostAtt; inp.boost = true; }
      const alt = r.y - T.h(r.x), tImp = alt / Math.max(0.5, -r.vy);
      if (target != null && tImp > 0.6) { const err = wrap(target - r.a); inp.up = err > 0.02; inp.down = err < -0.02; }
    }
    step(r, inp, st, T, ev);
    if (trace && Math.round(r.t / DT) % 6 === 0) log.push([r.t.toFixed(2), r.x.toFixed(1), r.y.toFixed(1), Math.hypot(r.vx, r.vy).toFixed(1), r.ground ? 'G' : 'A'].join('\t'));
  }
  return { dist: r.jump ?? 0, landX: r.jump ?? 0, airtime: r.airtime, maxAlt: r.maxAlt, maxSpeed: r.maxSpeed,
    flips: r.flips, landing: r.landing, lanterns: 0, rings: 0, t: r.t, lip: ev.find(e => e.type === 'launch')?.speed ?? 0, log, st };
}
const memo = new Map();
export function fly(levels, skill = 'best', trace = false) {
  if (skill === 'none') return flyOnce(levels, null, 0.35, trace);
  const key = JSON.stringify(loadoutStats(levels));
  if (!trace && memo.has(key)) return memo.get(key);
  let best = null;
  for (const att of [null, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3]) for (const ba of [0.2, 0.35, 0.5]) {
    const r = flyOnce(levels, att, ba, trace);
    const score = r.dist * (r.landing === 'crash' ? 0.7 : 1);
    if (!best || score > best.score) best = { ...r, score };
    if (!loadoutStats(levels).thrust) break;
  }
  memo.set(key, best);
  return best;
}

const lv = o => ({ ...newSave().levels, ...o });
const fmt = r => `${r.dist.toFixed(0).padStart(6)} m  lip ${(r.lip * 3.6).toFixed(0).padStart(3)} km/h  air ${r.airtime.toFixed(1).padStart(5)} s  alt ${r.maxAlt.toFixed(0).padStart(4)}  vmax ${(r.maxSpeed * 3.6).toFixed(0).padStart(4)}  ${r.landing}  t=${r.t.toFixed(0)}s`;

const rows = [
  ['start, no input', lv({}), 'none'],
  ['start', lv({})],
  ['gate2', lv({ gate: 1 })],
  ['sled1', lv({ sled: 1 })],
  ['glider1', lv({ glider: 1 })],
  ['glider2', lv({ glider: 2 })],
  ['booster1', lv({ booster: 1 })],
  ['g3 s2 gl2 b1', lv({ gate: 2, sled: 2, glider: 2, booster: 1 })],
  ['g4 s3 gl3 b2', lv({ gate: 3, sled: 3, glider: 3, booster: 2 })],
  ['g5 s4 gl4 b3', lv({ gate: 4, sled: 4, glider: 4, booster: 3 })],
  ['max', lv({ gate: 5, sled: 5, glider: 5, booster: 4 })],
  ['max, no booster', lv({ gate: 5, sled: 5, glider: 5 })],
  ['max, no glider', lv({ gate: 5, sled: 5, booster: 4 })],
];
for (const [name, l, skill] of rows) console.log(name.padEnd(18), fmt(fly(l, skill)));

if (process.argv[2] === 'trace') console.log(fly(lv({}), 'good', true).log.join('\n'));

// --- playthrough: greedy buyer, 'good' pilot ------------------------------------------------
if (process.argv[2] === 'progress') {
  const save = newSave();
  let runs = 0, time = 0;
  while (runs < 200) {
    const r = fly(save.levels);
    runs++; time += r.t + 12; // + time spent in menus
    const pay = payout(r, loadoutStats(save.levels).mult, save.best);
    save.yen += pay.total; save.best = Math.max(save.best, r.dist);
    // buy cheapest available upgrades
    for (;;) {
      const opts = TRACKS.map(t => [t.id, nextTier(save, t.id)]).filter(([, t]) => t && t.price <= save.yen).sort((a, b) => a[1].price - b[1].price);
      if (!opts.length) break;
      buy(save, opts[0][0]);
    }
    if (runs % 3 === 0 || save.best >= GOAL) console.log(`run ${String(runs).padStart(3)}  ${(time / 60).toFixed(1).padStart(5)} min  dist ${r.dist.toFixed(0).padStart(5)}  +¥${pay.total}  best ${save.best.toFixed(0)}  levels ${JSON.stringify(save.levels)}`);
    if (save.best >= GOAL) { console.log(`GOAL after ${runs} runs, ${(time / 60).toFixed(1)} min`); break; }
  }
}
