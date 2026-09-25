// Upgrade tracks, save data and the stats the physics reads. Pure JS (runs in Node too).
// Each track is a ladder: level 0 is what you start with, buying moves up one rung.
// Every item is also, quietly, a step of the koi → dragon legend (登竜門): see progress() below.

export const GOAL = 3333; // m — Tokyo Tower. Reaching it wins; runs continue after for records.

export const TRACKS = [
  { id: 'gate', name: 'Start Gate', kanji: '門', tiers: [
    { name: 'Alley Stairs', perk: 'Start 20 m up', desc: 'Behind the ramen shop. Everyone starts somewhere.', price: 0, h: 20 },
    { name: 'Shrine Steps', perk: 'Start 24 m up', desc: 'Mossy stone under the cherry trees.', price: 150, h: 24 },
    { name: 'Vermilion Torii', perk: 'Start 33 m up', desc: 'The locals start here.', price: 500, h: 33 },
    { name: 'Torii Tunnel', perk: 'Start 43 m up', desc: 'A thousand gates, each lit from inside.', price: 1500, h: 43 },
    { name: 'Waterfall Shrine', perk: 'Start 54 m up', desc: 'Something big turns over in the pool.', price: 4000, h: 54 },
    { name: 'Dragon Gate', perk: 'Start 66 m up', desc: 'What leaps from here doesn’t come down the same.', price: 8000, h: 66 },
  ] },
  { id: 'sled', name: 'Ride', kanji: '乗', tiers: [ // id kept from the sled days: saves are keyed by it
    { name: 'Cardboard Box', perk: 'Soggy, slow', desc: 'Free from behind the konbini.', price: 0, mu: 0.14, cda: 0.55, tol: 0 },
    { name: 'Koi Pool Float', perk: 'Friction −25%', desc: 'Night-market prize. Squeaks on wet stone.', price: 120, mu: 0.105, cda: 0.5, tol: 2 },
    { name: 'Koi Skateboard', perk: 'Friction −45%, steadier', desc: 'Deck painted by a Kōenji tattooist.', price: 450, mu: 0.078, cda: 0.46, tol: 4 },
    { name: 'Seigaiha Luge', perk: 'Friction −60%, low drag', desc: 'Lacquered in the old wave pattern.', price: 1400, mu: 0.058, cda: 0.42, tol: 6 },
    { name: 'Bullet Nose', perk: 'Friction −70%, sleek', desc: 'A retired Shinkansen nose cone.', price: 4200, mu: 0.042, cda: 0.36, tol: 8 },
    { name: 'Storm Cloud', perk: 'Hovers. Barely touches the ground.', desc: 'It holds you up. It shouldn’t.', price: 9000, mu: 0.022, cda: 0.32, tol: 10 },
  ] },
  { id: 'booster', name: 'Booster', kanji: '火', tiers: [
    { name: 'None', perk: 'No thrust', desc: 'Gravity is your only engine.', price: 0, thrust: 0, fuel: 0 },
    { name: 'Hanabi Rockets', perk: '1.2 g for 1.5 s', desc: 'Festival fireworks, zip-tied on.', price: 300, thrust: 12, fuel: 1.5 },
    { name: 'Turbo Canister', perk: '1.6 g for 2.5 s', desc: 'Salvaged from a kei-car tuner.', price: 1200, thrust: 16, fuel: 2.5 },
    { name: 'Plasma Thruster', perk: '2.0 g for 3.5 s', desc: 'Hums in B-flat. Glows cyan.', price: 4000, thrust: 20, fuel: 3.5 },
    { name: 'Flaming Pearl', perk: '2.4 g for 4.5 s', desc: 'It flies just ahead of you. You can’t help chasing it.', price: 10000, thrust: 24, fuel: 4.5 },
  ] },
  { id: 'glider', name: 'Glider', kanji: '翼', tiers: [
    { name: 'None', perk: 'Falls like a rock', desc: 'Arms flapping does not count.', price: 0, area: 0 },
    { name: 'Wagasa Umbrella', perk: 'Floaty, draggy', desc: 'Oiled paper. Surprisingly brave.', price: 200, area: 8, cla: 3, stall: 0.5, cd0: 0.1, k: 0.25, body: 0.8 },
    { name: 'Koinobori', perk: 'Real lift', desc: 'A Children’s Day carp streamer. It always pulls upstream.', price: 800, area: 6.5, cla: 3.6, stall: 0.45, cd0: 0.04, k: 0.14, body: 0.6 },
    { name: 'Neon Hang Glider', perk: 'Long, stable glides', desc: 'Aluminium ribs, LED edges.', price: 2500, area: 3.5, cla: 4, stall: 0.4, cd0: 0.035, k: 0.08, body: 0.35 },
    { name: 'Fin Suit', perk: 'Fast and slippery', desc: 'A wingsuit cut like koi fins. Dive to fly.', price: 7000, area: 0.95, cla: 4.2, stall: 0.38, cd0: 0.03, k: 0.07, body: 0.14 },
    { name: 'No Wings', perk: 'Best glide there is', desc: 'The dragons never needed them.', price: 15000, kanji: '龍', area: 1.0, cla: 4.4, stall: 0.4, cd0: 0.024, k: 0.05, body: 0.1 },
  ] },
  { id: 'cat', name: 'Lucky Cat', kanji: '猫', tiers: [
    { name: 'No Cat', perk: '¥ ×1', desc: 'Luck not included.', price: 0, mult: 1 },
    { name: 'Maneki-neko', perk: '¥ ×1.25', desc: 'Waves in your yen.', price: 250, mult: 1.25 },
    { name: 'Golden Neko', perk: '¥ ×1.5', desc: 'Waves faster.', price: 1000, mult: 1.5 },
    { name: 'Neon Neko', perk: '¥ ×2', desc: 'Waves at the speed of light.', price: 5000, mult: 2 },
  ] },
  { id: 'charm', name: 'Omamori', kanji: '守', tiers: [
    { name: 'No Charm', perk: 'Land it straight', desc: 'Fortune favours the aligned.', price: 0, tol: 0, magnet: 2 },
    { name: 'Safe Travels', perk: 'Landing tolerance +6°, pickups ×1.5', desc: 'From a shrine in Asakusa.', price: 180, tol: 6, magnet: 3 },
    { name: 'Rain God’s Charm', perk: 'Landing tolerance +12°, pickups ×2', desc: 'Warm to the touch. It hums when the dragons pass.', price: 900, tol: 12, magnet: 4 },
  ] },
];

export const track = id => TRACKS.find(t => t.id === id);

export function newSave() {
  return {
    yen: 0, best: 0, runs: 0, won: false, // won = reached Tokyo Tower, which is also when the rider became a dragon
    legacy: 0, // dragons left in the sky by earlier playthroughs (survives a reset)
    levels: Object.fromEntries(TRACKS.map(t => [t.id, 0])),
    settings: { muted: false, music: true },
  };
}

const KEY = 'tokyo-flyer-save-v1';

export function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.levels) {
      const fresh = newSave();
      return { ...fresh, ...s, levels: { ...fresh.levels, ...s.levels }, settings: { ...fresh.settings, ...s.settings } };
    }
  } catch { /* private mode or corrupt save: start fresh */ }
  return newSave();
}

export function storeSave(save) {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* ignore */ }
}

// Next purchasable tier of a track, or null when maxed.
export function nextTier(save, id) {
  return track(id).tiers[save.levels[id] + 1] ?? null;
}

export function buy(save, id) {
  const t = nextTier(save, id);
  if (!t || save.yen < t.price) return false;
  save.yen -= t.price;
  save.levels[id]++;
  return true;
}

// Everything physics.js needs, derived from the owned levels.
export function loadoutStats(levels) {
  const tier = id => track(id).tiers[levels[id]];
  const sled = tier('sled'), boost = tier('booster'), glider = tier('glider'), charm = tier('charm');
  return {
    gateH: tier('gate').h,
    mu: sled.mu,
    cda: sled.cda,
    tol: sled.tol + charm.tol, // extra landing tolerance, degrees
    thrust: boost.thrust,
    fuel: boost.fuel,
    glider: glider.area ? glider : null,
    mult: tier('cat').mult,
    magnet: charm.magnet, // pickup radius, m
  };
}

// How far the rider has quietly turned into a dragon, 0..1: the mean of rungs owned and yen spent, so every
// purchase shows (rungs) but most of the change lands late, when the prices climb (yen).
const RUNGS = TRACKS.reduce((a, t) => a + t.tiers.length - 1, 0);
const SPEND = TRACKS.reduce((a, t) => a + t.tiers.reduce((b, x) => b + x.price, 0), 0);
export function progress(levels) {
  let n = 0, y = 0;
  for (const t of TRACKS) { const l = levels[t.id] | 0; n += l; for (let i = 1; i <= l; i++) y += t.tiers[i].price; }
  return (n / RUNGS + y / SPEND) / 2;
}

// Outfit changes, each passing for Tokyo street fashion until it doesn't. Stage = how many thresholds p has passed.
export const DRIFT = [
  [0.22, 'cat-ear beanie'],    // horn buds
  [0.34, 'wired earbuds'],     // whiskers
  [0.46, 'holo jacket'],       // scales
  [0.58, 'dino hoodie'],       // dorsal spikes
  [0.7, 'LED goggles'],        // a dragon's eye
  [0.8, 'three-finger gloves'], // claws
];
export const FINS = 0.9; // the scarf grows fins and starts to pulse: it was never a scarf
export const stage = p => DRIFT.filter(([at]) => p >= at).length;

// Dragons bring the rain: cherry-blossom petals give way to rain, then a thunderstorm follows the rider.
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
export function weather(p, dragon = false) {
  if (dragon) p = 1;
  return { petals: 0.03 + 0.42 * (1 - smooth(0.3, 0.85, p)), rain: smooth(0.25, 0.85, p), storm: smooth(0.62, 0.95, p) };
}

// Flat pay for every jump that touches down: most of a beginner's income (so the first item is 2–3 runs away),
// noise by the mid-game. Not paid for a run ended mid-air, so quitting early never earns more than playing.
export const RUN_BONUS = 40;

// One-off bonuses the first time a distance is reached.
export const MILESTONES = [[100, 100], [250, 200], [500, 400], [1000, 800], [2000, 1500], [GOAL, 3000]];

// Yen for a finished run. run = {dist, airtime, maxAlt, flips, landing, lanterns, rings}; prevBest = best before it
export function payout(run, mult, prevBest = Infinity) {
  const lines = [
    ['Distance', run.dist + Math.min(run.dist, 100)], // the first 100 m pay double: early runs are short
    ['Airtime', run.airtime * 4],
    ['Height', run.maxAlt * 1.5],
    ['Flips', run.flips * 25],
    ['Run bonus', run.landing ? RUN_BONUS : 0],
    ['Landing', { perfect: 30, good: 10, hard: 5 }[run.landing] ?? 0],
    ['Lanterns', run.lanterns * 5],
    ['Rings', run.rings * 15],
  ].map(([label, v]) => ({ label, yen: Math.round(v) })).filter(l => l.yen > 0);
  const sum = lines.reduce((a, l) => a + l.yen, 0);
  if (mult > 1) lines.push({ label: `Lucky Cat ×${mult}`, yen: Math.round(sum * (mult - 1)) });
  let total = Math.round(sum * mult);
  for (const [m, yen] of MILESTONES) if (prevBest < m && run.dist >= m) { lines.push({ label: `First ${m} m!`, yen }); total += yen; }
  return { lines, total };
}
