# Tokyo Flyer 東京フライヤー

A neon night-time launch game in Three.js. Slide down a rain-slick in-run under the cherry blossoms, leap off
the kicker, and fly as far as you can over Tokyo while dragons drift across the sky. Every run earns yen; spend
it on better rides, higher start gates, boosters, gliders and charms, then go again. Distance is scored like ski
jumping — where you first touch down past the lip — and a jump that reaches Tokyo Tower at 3,333 m wins.

![Tokyo Flyer](docs/screenshot.jpg)

## Controls

| | Keyboard | Touch |
|---|---|---|
| Tuck (in-run) / nose down (air) | ↓ or S | ▼ |
| Pop at the lip / nose up (air) | ↑ or W | ▲ |
| Booster | Space or Shift | BOOST |
| End run | Esc | END |

Tips: tuck all the way down the in-run and tap ↑ in the last instant before the lip for a perfect pop. The neon 跳
sign by the lip counts you in: its arrows fill as you close in, and it flashes when it's time to press.
Land parallel to the slope (let go of the keys near the ground and the rider eases into it). With a glider, keep the nose a little above your direction of
travel — too high and it stalls, dive to pick up speed, pull up to trade it for height.

## Run it

No build step and no dependencies — any static file server works:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

Add `?yen=50000` to the URL once to top up the save for a demo (the parameter is removed after it's used).

## Physics

`src/physics.js` is a small custom model tuned for feel, and runs unchanged in Node:

- Fixed 240 Hz step with render interpolation; the whole game runs at 1.2× time scale.
- Terrain is an analytic height field (value, slope and curvature), so the rider is glued to the ground by
  the real normal force `N = g·cosθ + v²κ` and takes off over crests exactly when `N` drops below zero.
- Coulomb friction (ride μ, plus soft ground after the lip), quadratic drag (tucking cuts it), booster
  thrust along the body.
- Gliders: lift `CL = cla·α` up to stall, induced drag, stall break. Lift is applied as a rotation of the
  velocity vector, so no pitch-pumping trick can create energy (asserted in the tests).
- Touchdown is found by bisection; landings are judged by body-vs-slope angle and impact speed into the
  ground (butter, clean, sketchy, hard, wipeout). Butter landings and landed flips give a speed kick.

```sh
node test/sim.mjs            # physics self-checks + distance per loadout
node test/sim.mjs progress   # simulated playthrough with a bot pilot
```

## The Dragon Gate (spoilers)

The items are also a story: 登竜門, the legend of the carp that leaps the Dragon Gate waterfall and becomes a
dragon (the reason Japan flies koinobori for its kids). The rider never learns it is happening.

- `progress()` in `src/items.js` is the mean of rungs owned and yen spent, 0 → 1. Every purchase moves it; most of
  it lands late, when the prices climb.
- `DRIFT` lists outfit stages that each pass for Tokyo street fashion: cat-ear beanie (horns), wired earbuds
  (whiskers), holo jacket (scales), dino hoodie (dorsal spikes), LED goggles (a dragon's eye), three-finger gloves
  (claws). The scarf lengthens all along and, at the very end, grows fins and starts to pulse.
- `weather()`: cherry-blossom petals give way to rain, then a thunderstorm; dragons bring the rain.
- The magenta sky dragon wears the rider's colours. It turns up more, comes closer and lingers as progress grows.
- The first flight past Tokyo Tower is the reveal: lightning, the kid is gone, and a magenta dragon (built by the
  same code as the sky dragons, following the path the head has flown) unfurls in their place while the other
  dragons come to escort it. The magenta one is never seen in the sky again. Every run after is flown as a dragon.
- Resetting progress after that leaves your dragon up in the sky for the next kid.

## Credits

Built with [three.js](https://threejs.org) (MIT, vendored in `vendor/three`). Colors from the
[Tokyo Night](https://github.com/folke/tokyonight.nvim) palette. MIT licensed.
