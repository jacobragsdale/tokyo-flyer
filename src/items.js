// Upgrade tracks, save data and the stats the physics reads. Pure JS (runs in Node too).
// Each track is a ladder: level 0 is what you start with, buying moves up one rung.
// Every item is also, quietly, a step of the koi → dragon legend (登竜門): see progress() below.

export const GOAL = 3333; // m — Tokyo Tower. Reaching it wins; runs continue after for records.

export const TRACKS = [
  { id: 'gate', name: 'Start Gate', kanji: '門', tiers: [
    { name: 'Fire Escape', perk: 'Start 20 m up', desc: 'Out the back of the office. Technically a lunch break.', price: 0, h: 20 },
    { name: 'Shrine Steps', perk: 'Start 24 m up', desc: 'Toss a coin, clap twice, jump.', price: 150, h: 24 },
    { name: 'Vermilion Torii', perk: 'Start 33 m up', desc: 'From up here, the office looks very small.', price: 500, h: 33 },
    { name: 'Thousand Gates', perk: 'Start 43 m up', desc: 'Each one a company’s prayer for a good quarter.', price: 1500, h: 43 },
    { name: 'Waterfall Shrine', perk: 'Start 54 m up', desc: 'The koi in the pool all face the falls.', price: 4000, h: 54 },
    { name: 'Dragon Gate', perk: 'Start 66 m up', desc: 'The top of the falls. You feel oddly at home.', price: 8000, h: 66 },
  ] },
  { id: 'sled', name: 'Ride', kanji: '乗', tiers: [ // id kept from the sled days: saves are keyed by it
    { name: 'Copy Paper Box', perk: 'Soggy, slow', desc: 'Liberated from the supply cupboard.', price: 0, mu: 0.14, cda: 0.55, tol: 0 },
    { name: 'Koi Floatie', perk: 'Friction −25%', desc: 'Night-market prize. It squeaks encouragingly.', price: 120, mu: 0.105, cda: 0.5, tol: 2 },
    { name: 'Tattoo Deck', perk: 'Friction −45%, steadier', desc: 'Painted by a Kōenji tattooist, who said the carp suited you.', price: 450, mu: 0.078, cda: 0.46, tol: 4 },
    { name: 'Lacquer Luge', perk: 'Friction −60%, low drag', desc: 'From a workshop best known for bento boxes.', price: 1400, mu: 0.058, cda: 0.42, tol: 6 },
    { name: 'Shinkansen Nose', perk: 'Friction −70%, sleek', desc: 'Retired after forty years. Never once late.', price: 4200, mu: 0.042, cda: 0.36, tol: 8 },
    { name: 'Thundercloud', perk: 'Hovers. Barely touches the ground.', desc: 'It carries you like it’s done this before.', price: 9000, mu: 0.022, cda: 0.32, tol: 10 },
  ] },
  { id: 'booster', name: 'Booster', kanji: '火', tiers: [
    { name: 'Gravity', perk: 'No thrust', desc: 'Included free. Always on. Wrong direction.', price: 0, thrust: 0, fuel: 0 },
    { name: 'Hanabi Rockets', perk: '1.2 g for 1.5 s', desc: 'Label says light and retreat. You’re halfway there.', price: 300, thrust: 12, fuel: 1.5 },
    { name: 'Nitro Tank', perk: '1.6 g for 2.5 s', desc: 'Out of a very small, very loud car.', price: 1200, thrust: 16, fuel: 2.5 },
    { name: 'Satellite Thruster', perk: '2.0 g for 3.5 s', desc: 'Akihabara back room, no receipt. Hums in B-flat.', price: 4000, thrust: 20, fuel: 3.5 },
    { name: 'Flaming Pearl', perk: '2.4 g for 4.5 s', desc: 'Always just ahead, like a promotion. You chase it anyway.', price: 10000, thrust: 24, fuel: 4.5 },
  ] },
  { id: 'glider', name: 'Glider', kanji: '翼', tiers: [
    { name: 'Suit Jacket', perk: 'Falls like a rock', desc: 'Holding it open does nothing. You’ve checked.', price: 0, area: 0 },
    { name: 'Paper Umbrella', perk: 'Floaty, draggy', desc: 'Left on the Yamanote Line. Nobody came back for it.', price: 200, area: 8, cla: 3, stall: 0.5, cd0: 0.1, k: 0.25, body: 0.8 },
    { name: 'Koinobori', perk: 'Real lift', desc: 'Your childhood carp streamer. It still pulls upstream.', price: 800, area: 6.5, cla: 3.6, stall: 0.45, cd0: 0.04, k: 0.14, body: 0.6 },
    { name: 'Neon Glider', perk: 'Long, stable glides', desc: 'Lit with LEDs from a closed-down pachinko parlour.', price: 2500, area: 3.5, cla: 4, stall: 0.4, cd0: 0.035, k: 0.08, body: 0.35 },
    { name: 'Bespoke Wingsuit', perk: 'Fast and slippery', desc: 'Ginza tailoring, fins at no extra charge. Dive to fly.', price: 7000, area: 0.95, cla: 4.2, stall: 0.38, cd0: 0.03, k: 0.07, body: 0.14 },
    { name: 'Just You', perk: 'Best glide there is', desc: 'The dragons never needed wings either.', price: 15000, kanji: '龍', area: 1.0, cla: 4.4, stall: 0.4, cd0: 0.024, k: 0.05, body: 0.1 },
  ] },
  { id: 'cat', name: 'Lucky Cat', kanji: '猫', tiers: [
    { name: 'Stray Cat', perk: '¥ ×1', desc: 'Watches from the wall. Doesn’t wave.', price: 0, mult: 1 },
    { name: 'Maneki-neko', perk: '¥ ×1.25', desc: 'Rescued from a closed ramen shop. Still waving.', price: 250, mult: 1.25 },
    { name: 'Gilded Cat', perk: '¥ ×1.5', desc: 'Waves like it’s on commission.', price: 1000, mult: 1.5 },
    { name: 'Neon Cat', perk: '¥ ×2', desc: 'Works the night shift so you don’t have to.', price: 5000, mult: 2 },
  ] },
  { id: 'charm', name: 'Omamori', kanji: '守', tiers: [
    { name: 'Crossed Fingers', perk: 'Land it straight', desc: 'Free, and worth every yen.', price: 0, tol: 0, magnet: 2 },
    { name: 'Traffic Charm', perk: 'Landing tolerance +6°, pickups ×1.5', desc: 'Meant for cars. Close enough.', price: 180, tol: 6, magnet: 3 },
    { name: 'Dragon Charm', perk: 'Landing tolerance +12°, pickups ×2', desc: 'It hums when the dragons pass. Lately it never stops.', price: 900, tol: 12, magnet: 4 },
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

// The salaryman's drift into a koi: outfit changes that each pass for something an office worker might wear on a
// big night out, until they don't. Stage = how many thresholds p has passed. The first lands on the second purchase,
// then one every two or three; the tie (rider.js) also grows on every purchase.
export const DRIFT = [
  [0.04, 'novelty tie'],      // kohaku markings
  [0.1, 'dojō-hige'],         // barbels (the mustache is named after a loach's)
  [0.17, 'hachimaki'],        // tanchō: the red crown spot
  [0.25, 'sukajan'],          // a white body with red patches
  [0.36, 'pompadour'],        // dorsal fin; sequins and a scaled tie
  [0.5, 'fish-eye glasses'],  // a koi's eye and mouth
  [0.64, 'fin cuffs'],        // pectoral fins
  [0.78, 'the tail'],         // the tie splits into a butterfly-koi tail and starts to pulse: it was never a tie
];
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
