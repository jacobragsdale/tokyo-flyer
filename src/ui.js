// All DOM UI: title, shop, run HUD, touch pad, toasts, results, settings. Built inside #ui.
// The lead drives it through initUI / showScreen / updateHUD / toast (see CONTRACT.md).
import { TRACKS, GOAL } from './items.js';

const S = { save: null, tracks: TRACKS, goal: GOAL }; // latest data from the lead; title/results → shop reuse it
const PRIMARY = { title: 'start', shop: 'launch', results: 'continue' }; // Space / Enter per menu screen
const LANDING = { perfect: 'Butter landing', good: 'Clean landing', sketchy: 'Sketchy landing', hard: 'Hard landing', crash: 'Wipeout' };
const cards = {};
let h, root, dlg, H, screen = '', readyAt = 0, prevLevels = null;

const $ = sel => root.querySelector(sel);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const NF = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const num = n => NF.format(Math.round(+n || 0));
const yen = n => (n < 0 ? '−¥' : '¥') + num(Math.abs(n));
const f1 = n => (+n || 0).toFixed(1);
// Per-frame writes go through these two, so the DOM is only touched when the shown value changes.
const put = (el, v) => { if (el._v !== v) el.textContent = el._v = v; };
const fill = (el, f) => {
  f = Math.round(Math.min(1, Math.max(0, f || 0)) * 500) / 500;
  if (el._v !== f) el.style.transform = `scaleX(${el._v = f})`;
};

const svg = (attrs, body) => `<svg viewBox="0 0 24 24" aria-hidden="true" ${attrs}>${body}</svg>`;
const GEAR = svg('fill="none" stroke="currentColor"',
  '<circle cx="12" cy="12" r="7.6" stroke-width="3.4" stroke-dasharray="2.98 2.99"/><circle cx="12" cy="12" r="5" stroke-width="2.4"/>');
const UP = svg('fill="currentColor"', '<path d="M12 4 22 19H2z"/>');
const DOWN = svg('fill="currentColor"', '<path d="M12 20 2 5h20z"/>');

const MARKUP = `
<section class="screen title" data-screen="title" data-act="start" hidden>
  <div class="logo">
    <h1><span class="w1">TOKYO</span> <span class="w2">FL<span class="flick">Y</span>ER</span></h1>
    <p class="jp" lang="ja">東京フライヤー</p>
    <p class="tag">Slide down · leap · fly over the city to Tokyo Tower</p>
  </div>
  <button class="start" data-act="start">Press Space · Tap to start</button>
</section>

<section class="screen shop" data-screen="shop" hidden>
  <header class="bar">
    <div class="brand"><span class="w1">TOKYO</span> <span class="w2">FLYER</span></div>
    <div class="chip money"><small>Yen</small><b id="s-yen">¥0</b></div>
    <div class="chip"><small>Best</small><b id="s-best">0.0 m</b></div>
    <div class="chip"><small>Runs</small><b id="s-runs">0</b></div>
    <button class="gear" data-act="settings" aria-label="Settings">${GEAR}</button>
  </header>
  <div class="goal">
    <span class="goal-name"><span lang="ja">東京タワー</span> Tokyo Tower</span>
    <div class="meter"><i id="s-goal"></i></div>
    <span id="s-goaltxt"></span>
  </div>
  <div class="room">
    <div class="mirror" aria-hidden="true"></div>
    <div class="cards"></div>
  </div>
  <footer class="dock">
    <ul class="legend keys">
      <li><kbd>↑</kbd>/<kbd>W</kbd> jump · nose up</li>
      <li><kbd>↓</kbd>/<kbd>S</kbd> tuck · nose down</li>
      <li><kbd>Space</kbd>/<kbd>Shift</kbd> boost</li>
      <li><kbd>Esc</kbd> end run</li>
    </ul>
    <ul class="legend taps">
      <li><kbd>▲</kbd> jump · nose up</li>
      <li><kbd>▼</kbd> tuck · nose down</li>
      <li><kbd>Boost</kbd> fire booster</li>
      <li><kbd>End</kbd> stop the run</li>
    </ul>
    <button class="primary launch" data-act="launch">Launch <kbd>Space</kbd></button>
  </footer>
</section>

<section class="screen run" data-screen="run" hidden>
  <div class="track"><i id="h-goal"></i><b id="h-mark" hidden></b></div>
  <div class="gauges">
    <p class="gauge"><small>Spd</small><b id="h-speed">0</b><i>km/h</i></p>
    <p class="gauge"><small>Alt</small><b id="h-alt">0</b><i>m</i></p>
  </div>
  <div class="center" id="h-center">
    <p class="dist"><b id="h-dist">0.0</b><small>m</small></p>
    <p class="best">Best <b id="h-best">—</b></p>
    <div class="fuel" id="h-fuel" hidden><small lang="ja">火</small><div class="meter"><i id="h-fuelbar"></i></div></div>
  </div>
  <div class="side">
    <button class="end" data-act="end">End <kbd>Esc</kbd></button>
    <b class="runyen" id="h-yen">¥0</b>
  </div>
  <div class="pad">
    <button data-in="up" tabindex="-1" aria-label="Jump, nose up">${UP}</button>
    <button data-in="down" tabindex="-1" aria-label="Tuck, nose down">${DOWN}</button>
    <button data-in="boost" tabindex="-1">Boost</button>
  </div>
</section>

<section class="screen results" data-screen="results" hidden>
  <div class="panel">
    <div class="victory" id="r-won" hidden><b>You reached Tokyo Tower</b><span lang="ja">登竜門 · 東京タワー到達！</span>
      <p>A koi that leaps the Dragon Gate becomes a dragon. So did you.</p></div>
    <div class="rcol">
      <p class="kicker" id="r-kicker"></p>
      <p class="rdist"><b id="r-dist">0.0</b><small>m</small></p>
      <div class="badges">
        <p class="record" id="r-record" hidden>New record <span lang="ja">新記録</span></p>
        <p class="landing" id="r-landing"></p>
        <p class="rbest" id="r-best"></p>
      </div>
      <dl class="stats" id="r-stats"></dl>
    </div>
    <div class="rcol">
      <p class="kicker">Earnings</p>
      <ul class="lines" id="r-lines"></ul>
      <p class="total"><span>Total</span><b id="r-total">¥0</b></p>
      <button class="primary" data-act="continue">Continue <kbd>Space</kbd></button>
    </div>
  </div>
</section>

<div class="toasts" aria-live="polite"></div>

<dialog class="settings" aria-labelledby="set-title">
  <div class="panel">
    <h2 id="set-title">Settings <span lang="ja">設定</span></h2>
    <button class="toggle" role="switch" data-act="sfx">Sound effects <i></i></button>
    <button class="toggle" role="switch" data-act="music">Music <i></i></button>
    <div class="danger">
      <button class="btn warn" data-act="reset">Reset progress…</button>
      <div class="confirm" hidden>
        <p>Erase all yen, upgrades and records? This can’t be undone.</p>
        <div class="row">
          <button class="btn" data-act="reset-no">Cancel</button>
          <button class="btn warn solid" data-act="reset-yes">Erase everything</button>
        </div>
      </div>
    </div>
    <button class="btn done" data-act="close">Done</button>
  </div>
</dialog>`;

const flip = el => {
  const on = el.getAttribute('aria-checked') !== 'true';
  el.setAttribute('aria-checked', on);
  return on;
};
const confirmReset = on => {
  $('[data-act=reset]').hidden = on;
  $('.confirm').hidden = !on;
  $(on ? '[data-act=reset-no]' : '[data-act=reset]').focus();
};

const ACT = {
  start: () => showScreen('shop'),
  launch: () => h.onLaunch(),
  buy: el => h.onBuy(el.closest('.card').dataset.id),
  end: () => h.onEndRun(),
  continue: () => performance.now() >= readyAt && showScreen('shop'),
  settings: () => {
    syncSettings();
    $('[data-act=reset]').hidden = false;
    $('.confirm').hidden = true;
    dlg.showModal();
  },
  sfx: el => h.onSetting('muted', !flip(el)),
  music: el => h.onSetting('music', flip(el)),
  reset: () => confirmReset(true),
  'reset-no': () => confirmReset(false),
  'reset-yes': () => { dlg.close(); h.onReset(); },
  close: () => dlg.close(),
};

export function initUI(handlers) {
  h = handlers;
  root = document.getElementById('ui');
  root.innerHTML = MARKUP;
  dlg = $('dialog');
  H = Object.fromEntries(['goal', 'mark', 'speed', 'alt', 'center', 'dist', 'best', 'fuel', 'fuelbar', 'yen']
    .map(k => [k, $('#h-' + k)]));

  root.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    // A pointer click leaves focus on BUY, and Space would then buy again instead of launching.
    if (el.dataset.act === 'buy' && e.detail) el.blur();
    ACT[el.dataset.act](el);
  });
  dlg.addEventListener('click', e => e.target === dlg && dlg.close()); // backdrop click

  // Capture phase on window, so this runs before the lead's key listeners.
  addEventListener('keydown', e => {
    const act = PRIMARY[screen];
    if (!act || dlg.open || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const esc = e.key === 'Escape';
    if (esc && screen !== 'results') return; // Esc = back; only results has somewhere to go back to
    // Space/Enter on a focused button is that button's click, not the screen's primary action.
    if (!esc && (e.key !== ' ' && e.key !== 'Enter' || e.target.closest?.('button'))) return;
    e.preventDefault();
    if (act === 'launch') e.stopImmediatePropagation(); // the Space that launches must not also fire the booster
    ACT[act]();
  }, true);

  // Touch mode: coarse primary pointer, or the first real touch (touch laptops).
  root.classList.toggle('touch', matchMedia('(pointer: coarse)').matches);
  addEventListener('pointerdown', e => e.pointerType === 'touch' && root.classList.add('touch'), { capture: true, passive: true });

  for (const b of root.querySelectorAll('[data-in]')) {
    b._ids = new Set();
    b._on = false;
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      b._ids.add(e.pointerId);
      press(b, true);
      b.setPointerCapture(e.pointerId); // keeps the press while the thumb drifts off the button
    });
    const up = e => { b._ids.delete(e.pointerId); if (!b._ids.size) press(b, false); };
    for (const t of ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture']) b.addEventListener(t, up);
  }
  $('.pad').addEventListener('contextmenu', e => e.preventDefault());
}

function press(b, on) {
  if (b._on === on) return;
  b._on = on;
  b.classList.toggle('on', on);
  h.onInput(b.dataset.in, on);
}

export function showScreen(name, data = {}) {
  S.save = data.save ?? S.save;
  S.tracks = data.tracks ?? S.tracks;
  S.goal = data.goal ?? S.goal;
  if (name !== 'run') {
    for (const b of root.querySelectorAll('[data-in]')) { b._ids.clear(); press(b, false); }
    $('.toasts').replaceChildren(); // run callouts must not float over the results / shop (e.g. after Esc mid-air)
  }
  if (name !== 'shop' && dlg.open) dlg.close();
  const changed = name !== screen;
  screen = name;
  for (const s of root.querySelectorAll('[data-screen]')) s.hidden = s.dataset.screen !== name;
  // A clicked button keeps focus after its screen hides; Space/Enter would then press it (e.g. LAUNCH mid-run).
  if (document.activeElement?.closest('[data-screen][hidden]')) document.activeElement.blur();
  if (name === 'shop') renderShop();
  if (name === 'run') {
    $('[data-in=boost]').hidden = !(S.save?.levels.booster > 0);
    updateHUD({ dist: 0, best: S.save?.best ?? 0, speed: 0, alt: 0, fuel: null, yen: 0, goal: S.goal });
  }
  if (name === 'results') {
    readyAt = performance.now() + 800; // keys still mashed from the run must not skip the results
    renderResults(data.summary ?? {});
  }
  // Optional hook beyond the contract: title → shop and results → shop happen in here, so tell the lead.
  if (changed) h.onScreen?.(name);
}

export function updateHUD(s) {
  const goal = s.goal || S.goal, best = s.best || 0;
  put(H.dist, f1(Math.max(0, s.dist)));
  put(H.best, best > 0 ? f1(best) + ' m' : '—');
  put(H.speed, num(s.speed * 3.6));
  put(H.alt, num(Math.max(0, s.alt)));
  put(H.yen, yen(s.yen));
  fill(H.goal, s.dist / goal);
  if (H.mark._v !== best) {
    H.mark._v = best;
    H.mark.hidden = !(best > 0);
    H.mark.style.left = Math.min(100, best / goal * 100) + '%';
  }
  const hasFuel = s.fuel != null;
  if (H.fuel._v !== hasFuel) H.fuel.hidden = !(H.fuel._v = hasFuel);
  if (hasFuel) {
    fill(H.fuelbar, s.fuel);
    H.fuel.classList.toggle('low', s.fuel < 0.2); // toggle with force is a no-op when unchanged
  }
  H.center.classList.toggle('rec', best > 0 && s.dist > best);
}

export function toast(text, kind = 'info') {
  if (!text) return;
  const box = $('.toasts');
  while (box.childElementCount >= 4) box.firstChild.remove();
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = text;
  box.append(t);
  const frames = reduced.matches
    ? [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }]
    : [
        { opacity: 0, transform: 'translateY(14px) scale(.5)', easing: 'ease-out' },
        { opacity: 1, transform: 'translateY(0) scale(1.15)', offset: 0.12 },
        { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.22 },
        { opacity: 1, transform: 'translateY(-8px) scale(1)', offset: 0.7, easing: 'ease-in' },
        { opacity: 0, transform: 'translateY(-40px) scale(.96)' },
      ];
  t.animate(frames, kind === 'great' ? 1900 : 1500).onfinish = () => t.remove();
}

// Tween a number shown in el from what it shows now (el._n) to `to`.
function count(el, to, fmt, ms = 700, delay = 0) {
  const from = el._n ?? 0, t0 = performance.now() + delay, id = el._id = (el._id || 0) + 1;
  if (reduced.matches || from === to) { el.textContent = fmt(el._n = to); return; }
  const step = now => {
    if (el._id !== id) return; // superseded by a newer tween
    const k = Math.min(1, Math.max(0, (now - t0) / ms));
    el.textContent = fmt(el._n = from + (to - from) * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function syncSettings() {
  const st = S.save?.settings ?? {};
  $('[data-act=sfx]').setAttribute('aria-checked', !st.muted);
  $('[data-act=music]').setAttribute('aria-checked', st.music !== false);
}

function makeCard(t) {
  const el = document.createElement('article');
  el.className = 'card';
  el.dataset.id = t.id;
  el.innerHTML = `<i class="flash"></i>
    <div class="icon" lang="ja" aria-hidden="true"></div>
    <h2></h2><div class="pips" role="img">${'<i></i>'.repeat(t.tiers.length - 1)}</div>
    <p class="cur"><b></b> · <span></span></p>
    <div class="next"><p class="nname"><small>Next</small> <b></b></p><p class="nperk"></p><p class="ndesc"></p></div>
    <div class="buyrow"><span class="price"></span><button class="buy" data-act="buy"></button></div>`;
  const q = s => el.querySelector(s);
  q('.icon').textContent = t.kanji;
  q('h2').textContent = t.name;
  $('.cards').append(el);
  return { el, flash: q('.flash'), icon: q('.icon'), cur: q('.cur b'), perk: q('.cur span'), pips: q('.pips'),
    nname: q('.nname b'), nperk: q('.nperk'), ndesc: q('.ndesc'), price: q('.price'), buy: q('.buy') };
}

function renderShop() {
  const { save, tracks, goal } = S;
  if (!save) return;
  count($('#s-yen'), save.yen, yen);
  put($('#s-best'), f1(save.best) + ' m');
  put($('#s-runs'), num(save.runs));
  fill($('#s-goal'), save.best / goal);
  put($('#s-goaltxt'), `${num(save.best)} / ${num(goal)} m`);
  $('.shop').classList.toggle('won', !!save.won);
  syncSettings();
  for (const t of tracks) {
    const c = cards[t.id] ??= makeCard(t);
    const lv = save.levels[t.id] ?? 0, cur = t.tiers[lv], next = t.tiers[lv + 1];
    const poor = !!next && save.yen < next.price;
    put(c.icon, cur.kanji ?? t.kanji); // a tier can rename its track's kanji (No Wings: 翼 becomes 龍)
    put(c.cur, cur.name);
    put(c.perk, cur.perk);
    [...c.pips.children].forEach((p, i) => p.classList.toggle('on', i < lv));
    c.pips.setAttribute('aria-label', `Level ${lv} of ${t.tiers.length - 1}`);
    put(c.nname, next ? next.name : 'Fully upgraded');
    put(c.nperk, next ? next.perk : '');
    put(c.ndesc, (next ?? cur).desc);
    put(c.price, next ? yen(next.price) : '');
    put(c.buy, next ? 'Buy' : 'Max');
    c.buy.disabled = !next || poor;
    c.buy.setAttribute('aria-label', next ? `Buy ${next.name} for ${yen(next.price)}` : `${t.name} maxed`);
    c.el.classList.toggle('max', !next);
    c.el.classList.toggle('poor', poor);
    if (prevLevels && lv > prevLevels[t.id] && !reduced.matches) {
      c.el.animate([{ transform: 'none' }, { transform: 'scale(1.04)', offset: 0.3 }, { transform: 'none' }],
        { duration: 520, easing: 'ease-out' });
      c.flash.animate([{ opacity: 1, backgroundPosition: '100% 0' }, { opacity: 1, offset: 0.55 }, { opacity: 0, backgroundPosition: '0% 0' }],
        { duration: 900, easing: 'ease-out' });
      c.icon.animate([{ transform: 'scale(1.3)', filter: 'brightness(1.8)' }, { transform: 'none', filter: 'none' }],
        { duration: 600, easing: 'ease-out' });
      c.pips.children[lv - 1]?.animate([{ transform: 'scale(2.6)', opacity: 0 }, { transform: 'none', opacity: 1 }],
        { duration: 450, easing: 'ease-out' });
    }
  }
  prevLevels = { ...save.levels };
}

function renderResults(s) {
  const lines = s.lines ?? [];
  $('#r-won').hidden = !s.won;
  $('#r-record').hidden = !s.newRecord;
  $('.results').classList.toggle('won', !!s.won);
  $('#r-kicker').textContent = S.save ? `Run ${num(S.save.runs)} · distance` : 'Distance';
  $('#r-best').textContent = s.newRecord ? '' : `Best ${f1(s.best)} m`;
  const land = $('#r-landing');
  land.textContent = LANDING[s.landing] ?? '';
  land.dataset.q = LANDING[s.landing] ? s.landing : '';
  const d = $('#r-dist');
  d._n = 0;
  count(d, +s.dist || 0, f1, 1100);
  // Stat values are our own formatted numbers, so innerHTML is safe here.
  $('#r-stats').innerHTML = [
    ['Airtime', f1(s.airtime) + ' s'],
    ['Max altitude', num(s.maxAlt) + ' m'],
    ['Top speed', num(s.maxSpeed * 3.6) + ' km/h'],
    ['Flips', num(s.flips)],
    ['Lanterns', num(s.lanterns)],
    ['Rings', num(s.rings)],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  $('#r-lines').replaceChildren(...lines.map((l, i) => {
    const li = document.createElement('li');
    li.innerHTML = '<span></span><b>¥0</b>';
    li.style.setProperty('--i', i);
    li.firstChild.textContent = l.label;
    li.lastChild._n = 0;
    count(li.lastChild, +l.yen || 0, yen, 600, 350 + i * 160);
    return li;
  }));
  const tot = $('#r-total');
  tot._n = 0;
  count(tot, +s.total || 0, yen, 800, 350 + lines.length * 160);
}
