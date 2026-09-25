// Upgrade tracks, save data and the stats the physics reads. Pure JS (runs in Node too).
// Each track is a ladder: level 0 is what you start with, buying moves up one rung.

export const GOAL = 3333; // m — Tokyo Tower. Reaching it wins; runs continue after for records.

export const TRACKS = [
  { id: 'gate', name: 'Start Gate', kanji: '門', tiers: [
    { name: 'Gate 1', perk: 'Start 20 m up', desc: 'The kiddie gate. Everyone starts somewhere.', price: 0, h: 20 },
    { name: 'Gate 2', perk: 'Start 24 m up', desc: 'A few more steps of scaffold.', price: 150, h: 24 },
    { name: 'Gate 3', perk: 'Start 33 m up', desc: 'The locals start here.', price: 500, h: 33 },
    { name: 'Gate 4', perk: 'Start 43 m up', desc: 'Neon-lit and slightly swaying.', price: 1500, h: 43 },
    { name: 'Gate 5', perk: 'Start 54 m up', desc: 'You can see Shibuya from up here.', price: 4000, h: 54 },
    { name: 'Gate 6', perk: 'Start 66 m up', desc: 'Summit gate. Dragons nest nearby.', price: 8000, h: 66 },
  ] },
  { id: 'sled', name: 'Sled', kanji: '橇', tiers: [
    { name: 'Cardboard Box', perk: 'Soggy, slow', desc: 'Free from behind the konbini.', price: 0, mu: 0.14, cda: 0.55, tol: 0 },
    { name: 'Plastic Saucer', perk: 'Friction −25%', desc: 'Spins a little. Slides a lot.', price: 120, mu: 0.105, cda: 0.5, tol: 2 },
    { name: 'Bamboo Toboggan', perk: 'Friction −45%, steadier', desc: 'Hand-bent in Kyoto.', price: 450, mu: 0.078, cda: 0.46, tol: 4 },
    { name: 'Steel Runner', perk: 'Friction −60%, low drag', desc: 'Sharp edges, sharp speed.', price: 1400, mu: 0.058, cda: 0.42, tol: 6 },
    { name: 'Carbon Luge', perk: 'Friction −70%, sleek', desc: 'Olympic-grade, street-legal-ish.', price: 4200, mu: 0.042, cda: 0.36, tol: 8 },
    { name: 'Maglev Board', perk: 'Hovers. Barely touches snow.', desc: 'Prototype from Akihabara.', price: 9000, mu: 0.022, cda: 0.32, tol: 10 },
  ] },
  { id: 'booster', name: 'Booster', kanji: '火', tiers: [
    { name: 'None', perk: 'No thrust', desc: 'Gravity is your only engine.', price: 0, thrust: 0, fuel: 0 },
    { name: 'Hanabi Rockets', perk: '1.2 g for 1.5 s', desc: 'Festival fireworks, zip-tied on.', price: 300, thrust: 12, fuel: 1.5 },
    { name: 'Turbo Canister', perk: '1.6 g for 2.5 s', desc: 'Salvaged from a kei-car tuner.', price: 1200, thrust: 16, fuel: 2.5 },
    { name: 'Plasma Thruster', perk: '2.0 g for 3.5 s', desc: 'Hums in B-flat. Glows cyan.', price: 4000, thrust: 20, fuel: 3.5 },
    { name: "Dragon's Breath", perk: '2.4 g for 4.5 s', desc: 'Borrowed. Do not ask from whom.', price: 10000, thrust: 24, fuel: 4.5 },
  ] },
  { id: 'glider', name: 'Glider', kanji: '翼', tiers: [
    { name: 'None', perk: 'Falls like a rock', desc: 'Arms flapping does not count.', price: 0, area: 0 },
    { name: 'Wagasa Umbrella', perk: 'Floaty, draggy', desc: 'Oiled paper. Surprisingly brave.', price: 200, area: 8, cla: 3, stall: 0.5, cd0: 0.1, k: 0.25, body: 0.8 },
    { name: 'Tako Kite', perk: 'Real lift', desc: 'A festival kite with a harness.', price: 800, area: 6.5, cla: 3.6, stall: 0.45, cd0: 0.04, k: 0.14, body: 0.6 },
    { name: 'Neon Hang Glider', perk: 'Long, stable glides', desc: 'Aluminium ribs, LED edges.', price: 2500, area: 3.5, cla: 4, stall: 0.4, cd0: 0.035, k: 0.08, body: 0.35 },
    { name: 'Night Wingsuit', perk: 'Fast and slippery', desc: 'Dive to fly. Pull up to soar.', price: 7000, area: 0.95, cla: 4.2, stall: 0.38, cd0: 0.03, k: 0.07, body: 0.14 },
    { name: 'Dragon Wings', perk: 'Best glide there is', desc: 'Scales that drink moonlight.', price: 15000, area: 1.0, cla: 4.4, stall: 0.4, cd0: 0.024, k: 0.05, body: 0.1 },
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
    { name: 'Great Fortune', perk: 'Landing tolerance +12°, pickups ×2', desc: 'Daikichi. Very lucky.', price: 900, tol: 12, magnet: 4 },
  ] },
];

export const track = id => TRACKS.find(t => t.id === id);

export function newSave() {
  return {
    yen: 0, best: 0, runs: 0, won: false,
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

// One-off bonuses the first time a distance is reached.
export const MILESTONES = [[100, 100], [250, 200], [500, 400], [1000, 800], [2000, 1500], [GOAL, 3000]];

// Yen for a finished run. run = {dist, airtime, maxAlt, flips, landing, lanterns, rings}; prevBest = best before it
export function payout(run, mult, prevBest = Infinity) {
  const lines = [
    ['Distance', run.dist + Math.min(run.dist, 100)], // the first 100 m pay double: early runs are short
    ['Airtime', run.airtime * 4],
    ['Height', run.maxAlt * 1.5],
    ['Flips', run.flips * 25],
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
