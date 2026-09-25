// Rider physics: a point mass with an orientation, riding a height-field y = h(x).
// Pure JS (no DOM / three.js) so test/sim.mjs can run the exact same code in Node.
// Units: meters, seconds, radians. +x is downhill/forward, +y is up, angle 0 faces +x, CCW = nose up.

export const G = 9.81;       // m/s²
export const RHO = 1.25;     // kg/m³, cold night air
export const M = 80;         // kg, rider + sled
export const DT = 1 / 240;   // fixed physics step, s

const RAD = Math.PI / 180;
const TAU = Math.PI * 2;
export const wrap = a => a - TAU * Math.floor((a + Math.PI) / TAU);

// smootherstep + derivatives: C2, so terrain curvature (and thus normal force) has no jumps
const S0 = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (6 * t - 15) + 10));
const S1 = t => (t <= 0 || t >= 1 ? 0 : 30 * t * t * (t - 1) * (t - 1));
const S2 = t => (t <= 0 || t >= 1 ? 0 : 60 * t * (t - 1) * (2 * t - 1));

// ---------------------------------------------------------------- terrain

export function makeTerrain() {
  const KICK = 11 * RAD;    // kicker lip angle (up)
  const INRUN = -38 * RAD;  // in-run slope
  const R = 45;             // transition radius, m
  const TABLE = 3;          // straight kicker table length, m
  const DROP = 3;           // lip height above the knoll, m
  const KNOLL = 18, KNOLL_L = 50; // landing slope: drops KNOLL m over KNOLL_L m
  const HILLS = [[3, 90, 0.7], [6, 260, 2.1], [12, 700, 4.2]]; // outrun: amplitude m, wavelength m, phase

  const tk = Math.tan(KICK), ti = Math.tan(INRUN);
  const xT = -TABLE * Math.cos(KICK), yT = xT * tk;                      // table start
  const xc = xT - R * Math.sin(KICK), yc = yT + R * Math.cos(KICK);      // transition circle centre
  const xA = xc + R * Math.sin(INRUN), yA = yc - R * Math.cos(INRUN);    // top of transition

  const o = { h: 0, d1: 0, d2: 0 }; // reused result: height, slope, second derivative
  function at(x) {
    if (x < xA) { o.h = yA + (x - xA) * ti; o.d1 = ti; o.d2 = 0; return o; }
    if (x < xT) {
      const dx = x - xc, r2 = R * R - dx * dx, sq = Math.sqrt(r2);
      o.h = yc - sq; o.d1 = dx / sq; o.d2 = (R * R) / (r2 * sq); return o;
    }
    if (x < 0) { o.h = x * tk; o.d1 = tk; o.d2 = 0; return o; }
    const u = x / KNOLL_L;
    let h = -DROP - KNOLL * S0(u), d1 = (-KNOLL * S1(u)) / KNOLL_L, d2 = (-KNOLL * S2(u)) / (KNOLL_L * KNOLL_L);
    const e = (x - 40) / 300, E0 = S0(e), E1 = S1(e) / 300, E2 = S2(e) / 90000;
    if (E0 > 0) for (const [a, l, p] of HILLS) {
      const w = TAU / l, s = a * Math.sin(w * x + p), c = a * w * Math.cos(w * x + p);
      h += s * E0; d1 += c * E0 + s * E1; d2 += -s * w * w * E0 + 2 * c * E1 + s * E2;
    }
    o.h = h; o.d1 = d1; o.d2 = d2; return o;
  }

  return {
    at,
    h: x => at(x).h,
    slope: x => at(x).d1,
    // deep powder past the landing hill: extra friction that ends slides
    powder: x => (x < 0 ? 0 : 0.35 * S0((x - 2) / 12)),
    lipX: 0, lipY: 0, kick: KICK,
    gateX: h => xA + (h - yA) / ti,
    kicker: { x0: xc + R * Math.sin(-10 * RAD), x1: 0 },
    inrunTop: { x: xA + (70 - yA) / ti, y: 70 },
  };
}

// ---------------------------------------------------------------- rider

export function newRider(T, st) {
  const x = T.gateX(st.gateH);
  return {
    x, y: T.h(x), vx: 0, vy: 0, a: Math.atan(T.slope(x)), w: 0,
    s: 1.5,            // speed along the surface while grounded (push-off)
    ground: true, fuel: st.fuel, tuck: false, boosting: false, glide: false, crashed: false, done: false,
    t: 0, launched: false, lipT: -1, popped: false, rot: 0, still: 0, stall: 0, gd: 0, airT: 0, latch: 0,
    maxX: 0, maxAlt: 0, maxSpeed: 0, airtime: 0, flips: 0, landing: null,
  };
}

// Glider lift coefficient: linear to stall, then sags toward zero at 90°.
function liftCoef(al, g) {
  const x = Math.abs(al);
  if (x <= g.stall) return g.cla * al;
  if (x >= Math.PI / 2) return 0;
  const peak = g.cla * g.stall, t = Math.min((x - g.stall) / 0.4, 1);
  return (Math.sign(al) * peak * (1 - 0.5 * t) * Math.cos(x)) / Math.cos(g.stall);
}

const POP = 4.2, POP_PERFECT = 1.8, PERFECT_T = 0.12, COYOTE = 0.1; // pop speeds m/s, timing windows s
const MAX_LIFT = 6 * G;
// landing: body-vs-slope window (deg) grows with sled + charm; impact speed into the snow (m/s) decides hard/wipeout
const WINDOW = 14, BUTTER_VN = 5, SOLID_VN = 12.5, WIPEOUT_VN = 19;

// One fixed step. inp = {up, down, boost, jump}; `jump` is an edge flag the caller sets on key-down and
// this consumes. st = loadoutStats(). Pushes {type, ...} events into ev.
export function step(r, inp, st, T, ev) {
  if (r.done) return;
  const dt = DT;
  r.t += dt;
  const jump = inp.jump; inp.jump = false;
  // keys held at take-off (tuck ↓, pop ↑) don't rotate the rider until released and pressed again
  if (r.ground) r.latch = (inp.up ? 1 : 0) | (inp.down ? 2 : 0);
  else r.latch &= (inp.up ? 1 : 0) | (inp.down ? 2 : 0);
  r.boosting = !!inp.boost && r.fuel > 0 && st.thrust > 0 && !r.crashed;
  if (r.boosting) { r.fuel = Math.max(0, r.fuel - dt); }

  if (r.ground) {
    if (jump && !r.crashed) pop(r, T, ev);
    else stepGround(r, inp, st, T, ev, dt);
  } else {
    if (jump && !r.popped && r.lipT >= 0 && r.t - r.lipT <= COYOTE) pop(r, T, ev, true);
    stepAir(r, inp, st, T, ev, dt);
  }

  if (!r.launched && r.x >= 0) markLaunch(r, ev);
  const speed = Math.hypot(r.vx, r.vy);
  if (r.x > r.maxX) r.maxX = r.x;
  if (speed > r.maxSpeed) r.maxSpeed = speed;
  if (!r.ground) {
    if (r.launched) r.airtime += dt;
    const alt = r.y - T.h(r.x);
    if (alt > r.maxAlt) r.maxAlt = alt;
  }
  // run ends once we've been (nearly) stationary on the snow for a moment, or stopped gaining ground
  r.still = r.ground && Math.abs(r.s) < 0.3 ? r.still + dt : 0;
  r.stall = r.ground && r.launched && r.x < r.maxX - 0.01 ? r.stall + dt : 0;
  if (r.still > (r.x < 0 ? 1.5 : 0.5) || r.stall > 2 || r.t > 300) { r.done = true; ev.push({ type: 'stop', x: r.x, y: r.y }); }
}

function pop(r, T, ev, coyote = false) {
  // timing is judged in time-to-lip so the window feels the same at every speed
  const tLip = coyote ? 0 : r.x < 0 ? -r.x / Math.max(1, r.s) : Infinity;
  const perfect = !r.launched && !coyote && tLip <= PERFECT_T;
  const a = coyote ? T.kick : Math.atan(T.slope(r.x));
  const p = coyote ? POP * 0.7 : POP + (perfect ? POP_PERFECT : 0);
  if (!coyote) { r.vx = r.s * Math.cos(a); r.vy = r.s * Math.sin(a); }
  r.vx -= Math.sin(a) * p; r.vy += Math.cos(a) * p;
  if (perfect) { r.vx *= 1.03; r.vy *= 1.03; }
  r.popped = true; r.ground = false; r.w = 0; r.rot = 0; r.airT = 0;
  const early = !r.launched && !perfect && !coyote && tLip < 0.6;
  ev.push({ type: 'pop', x: r.x, y: r.y, perfect, early, late: coyote });
  markLaunch(r, ev);
}

function markLaunch(r, ev) {
  if (r.launched || r.x < -3) return;
  r.launched = true;
  ev.push({ type: 'launch', x: r.x, y: r.y, speed: Math.hypot(r.vx, r.vy) });
}

function stepGround(r, inp, st, T, ev, dt) {
  const e = T.at(r.x);
  const c = 1 / Math.sqrt(1 + e.d1 * e.d1), sn = e.d1 * c;   // unit tangent (c, sn)
  const kappa = e.d2 * c * c * c;                            // signed curvature (+ = valley)
  const N = G * c + r.s * r.s * kappa;                       // normal force per kg

  if (N < -0.5 && !r.crashed) { // crest too sharp for this speed: we fly
    r.vx = r.s * c; r.vy = r.s * sn; r.ground = false; r.popped = false; r.rot = 0; r.w = r.s * kappa; r.airT = 0;
    return stepAir(r, inp, st, T, ev, dt);
  }

  r.tuck = !!inp.down && !r.crashed;
  const cda = r.crashed ? 1.2 : st.cda * (r.tuck ? 0.55 : 1);
  const mu = r.crashed ? 0.9 : st.mu + T.powder(r.x);
  let acc = -G * sn - ((0.5 * RHO * cda) / M) * r.s * Math.abs(r.s);
  if (r.boosting) acc += st.thrust;
  // Coulomb friction as an impulse that can stop but never reverse the motion
  const v1 = r.s + acc * dt, f = mu * N * dt;
  r.s = Math.abs(v1) <= f ? 0 : v1 - Math.sign(v1) * f;

  const nx = r.x + r.s * c * dt;
  if (r.x < 0 && nx >= 0) { // off the lip
    r.x = 0; r.y = T.lipY;
    r.vx = r.s * Math.cos(T.kick); r.vy = r.s * Math.sin(T.kick);
    r.ground = false; r.popped = false; r.rot = 0; r.w = 0; r.lipT = r.t; r.airT = 0;
    markLaunch(r, ev);
    return;
  }
  if (r.x > 0 && nx <= 0) r.s = 0; // backed into the kicker wall
  else r.x = nx;
  const e2 = T.at(r.x);
  r.y = e2.h;
  r.a = Math.atan(e2.d1);
  r.w = r.s * kappa;
  const c2 = 1 / Math.sqrt(1 + e2.d1 * e2.d1);
  r.vx = r.s * c2; r.vy = r.s * e2.d1 * c2;
  r.glide = false;
}

function stepAir(r, inp, st, T, ev, dt) {
  const g = r.crashed || !r.launched ? null : st.glider;
  r.glide = !!g;
  r.tuck = false;
  r.airT += dt;
  const sp = Math.hypot(r.vx, r.vy);
  const gam = Math.atan2(r.vy, r.vx);
  const al = sp > 0.5 ? wrap(r.a - gam) : 0; // angle of attack

  // Pitch is a rate servo: hold ↑/↓ to rotate, release to hold the attitude — the flight path then
  // settles onto where the nose points. Flips spin fast; a glider turns slower and can't be pulled past
  // stall (at the limit the nose tracks the flight path, so holding ↑ is the tightest pull-up, a loop
  // if fast enough). If the wing stalls anyway (too slow for the attitude held) the nose drops.
  if (!r.crashed) {
    const dir = (inp.up && !(r.latch & 1) ? 1 : 0) - (inp.down && !(r.latch & 2) ? 1 : 0);
    let tw = dir * (g ? 2.1 : 4.7), k = dir ? (g ? 8.3 : 16.7) : 12.5; // 120/270 °/s, τ 120/60 ms, release τ 80 ms
    if (g) {
      const lim = g.stall * 0.9;
      if (dir > 0 && al > lim) tw = Math.min(tw, r.gd + 10 * (lim - al));
      else if (dir < 0 && al < -lim) tw = Math.max(tw, r.gd + 10 * (-lim - al));
      else if (!dir && Math.abs(al) > g.stall) tw = r.gd - 3 * (al - Math.sign(al) * lim);
    }
    // landing assist: hands off, close above the snow and roughly lined up → ease onto the slope angle
    if (!dir && r.launched && r.vy < 0) {
      const e = T.at(r.x), off = wrap(Math.atan(e.d1) - r.a);
      if (r.y - e.h < 3 && Math.abs(off) < 0.8) tw += Math.sign(off) * Math.min(2, Math.abs(off) * 12);
    }
    r.w += (tw - r.w) * (1 - Math.exp(-dt * k));
  }
  r.a += r.w * dt;
  r.rot += r.w * dt;

  // aerodynamics (per kg): drag along −v, lift ⟂ v applied as a rotation of v so it can never add energy
  const q = (0.5 * RHO * sp * sp) / M;
  const sa = Math.sin(al);
  let cdA = st.cda * (1 + 1.2 * sa * sa) * (g ? g.body : 1); // body; streamlined under a glider
  let lift = 0;
  if (g) {
    const cl = liftCoef(al, g);
    lift = Math.max(-MAX_LIFT, Math.min(MAX_LIFT, q * g.area * cl));
    cdA += g.area * (g.cd0 + g.k * cl * cl + (Math.abs(al) > g.stall ? 1.1 * sa * sa : 0));
  }
  let ax = 0, ay = -G;
  if (sp > 0.01) { ax -= (q * cdA * r.vx) / sp; ay -= (q * cdA * r.vy) / sp; }
  if (r.boosting) { ax += st.thrust * Math.cos(r.a); ay += st.thrust * Math.sin(r.a); }

  const x0 = r.x, y0 = r.y, vx0 = r.vx, vy0 = r.vy;
  let vx = vx0 + ax * dt, vy = vy0 + ay * dt;
  const dg = (lift / Math.max(sp, 1)) * dt, cs = Math.cos(dg), sn = Math.sin(dg);
  r.vx = vx * cs - vy * sn; r.vy = vx * sn + vy * cs;
  r.gd = sp > 1 ? (vx0 * ay - vy0 * ax) / (sp * sp) + lift / sp : 0; // flight-path turn rate
  // trapezoid position update: exact for constant acceleration (plain semi-implicit Euler over-drops by
  // g·dt²/2, which made crest take-offs immediately re-touch the snow)
  r.x += 0.5 * (vx0 + r.vx) * dt; r.y += 0.5 * (vy0 + r.vy) * dt;

  const before = Math.floor(Math.abs(r.rot - r.w * dt) / TAU), after = Math.floor(Math.abs(r.rot) / TAU);
  if (after > before) ev.push({ type: 'flip', x: r.x, y: r.y, n: after });

  if (r.y >= T.h(r.x)) return;
  if (x0 >= 0 && r.x < 0 && r.y < T.lipY) { // flew back into the kicker's front face
    r.x = 0.01; r.vx = -r.vx * 0.2; return;
  }
  // swept contact: bisect the step for the touchdown point
  let lo = 0, hi = 1;
  for (let i = 0; i < 14; i++) {
    const m = (lo + hi) / 2, x = x0 + (r.x - x0) * m, y = y0 + (r.y - y0) * m;
    if (y >= T.h(x)) lo = m; else hi = m;
  }
  const xEnd = r.x;
  r.x = x0 + (r.x - x0) * lo;
  touchDown(r, st, T, ev, xEnd);
}

function touchDown(r, st, T, ev, xEnd) {
  const e = T.at(r.x);
  const c = 1 / Math.sqrt(1 + e.d1 * e.d1), sn = e.d1 * c;
  const slopeA = Math.atan(e.d1);
  const vt = r.vx * c + r.vy * sn;       // along the snow
  const vn = r.vx * sn - r.vy * c;        // into the snow (+)
  const off = Math.abs(wrap(r.a - slopeA)) / RAD;
  if (r.airT < 0.3 && vn < 2.5 && off < 30 && !r.crashed) { // skimmed a crest: re-attach, keep going
    const e2 = T.at(xEnd), c2 = 1 / Math.sqrt(1 + e2.d1 * e2.d1);
    r.ground = true; r.glide = false; r.x = xEnd; r.y = e2.h; r.a = Math.atan(e2.d1); r.w = 0;
    r.s = vt; r.vx = vt * c2; r.vy = vt * e2.d1 * c2;
    return;
  }
  // Tiers: butter (lined up + soft: full speed + a kick), clean, sketchy (off-angle: lose up to 30 %),
  // hard (big impact: ×0.75), wipeout (way off-angle, upside down, or a brutal impact)
  const win = WINDOW + st.tol, wipeVn = WIPEOUT_VN + st.tol * 0.25;
  let q, keep;
  if (r.crashed || off > win + 30 || vn > wipeVn) { q = 'crash'; keep = 0.5; }
  else if (off > win) { q = 'sketchy'; keep = 1 - (0.3 * (off - win)) / 30; }
  else if (vn > SOLID_VN) { q = 'hard'; keep = 0.75; }
  else if (off <= 10 && vn <= BUTTER_VN && r.airT >= 0.5) { q = 'perfect'; keep = 1; }
  else { q = 'good'; keep = 1; }
  const flips = q === 'crash' ? 0 : Math.round(Math.abs(r.rot) / TAU), back = r.rot > 0;

  r.ground = true; r.y = e.h; r.a = slopeA; r.w = 0; r.glide = false;
  const kick = (q === 'perfect' ? 2 : 0) + flips * 2.5; // Tiny Wings / Alto-style reward
  r.s = vt * keep + Math.sign(vt || 1) * kick;
  if (q === 'crash') r.crashed = true;
  if (r.launched && !r.landing) { r.landing = q; r.flips = flips; }
  else if (r.launched && flips) r.flips += flips;
  r.rot = 0;
  r.vx = r.s * c; r.vy = r.s * sn;
  ev.push({ type: q === 'crash' ? 'crash' : 'land', x: r.x, y: r.y, quality: q, vn, slope: slopeA, flips, back, speed: Math.abs(vt), airT: r.airT });
}
