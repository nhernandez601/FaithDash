// Smoothness test: does the runner glide at a constant speed on screen, whatever the screen's refresh rate and however
// jumpy the browser's audio clock is — while staying locked to the music?
// Compares the OLD loop (jump the game straight to the audio clock, draw the last simulation step) with the NEW loop
// (smoothing clock + drawing between simulation steps).
import assert from 'node:assert/strict';
import { getLevel } from '../src/game/levelgen.js';
import { Run } from '../src/game/run.js';
import { DT } from '../src/game/sim.js';
import { SmoothClock } from '../src/game/clock.js';

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('PASS -', name); } catch (e) { fail++; console.log('FAIL -', name, '\n      ' + e.message); } }

// seeded random so the test is repeatable
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function play(mode, hz, audioStep, secs = 6) {
  const lv = getLevel(1);
  const run = new Run({ level: lv, bank: null });
  run.p.invUntil = 1e9;
  const clock = new SmoothClock(); clock.reset(0);
  const pv = { x: 0, y: 0, rot: 0, t: 0 };
  let T = 0; const err = [], step = [];
  let lastX = 0;
  while (T < secs && !run.p.dead) {
    const dt = 1 / hz + (rnd() - 0.5) * 0.003;           // frames are never perfectly even
    T += dt;
    const audioT = Math.floor(T / audioStep) * audioStep;  // the audio clock moves in small jumps
    let x;
    if (mode === 'old') {
      run.advance(Math.max(0, audioT - (run.p.t + run.acc)), 0.3);
      x = run.p.x;
    } else {
      const ct = clock.update(dt, audioT);
      run.advance(Math.max(0, ct + DT - (run.p.t + run.acc)), 0.3);
      x = run.viewAt(ct, pv).x;
    }
    if (T > 0.5) { err.push(x / lv.speed - T); step.push((x - lastX) / lv.speed / dt); }
    lastX = x;
  }
  const mean = err.reduce((a, b) => a + b, 0) / err.length;
  const jitter = Math.sqrt(err.reduce((a, b) => a + (b - mean) ** 2, 0) / err.length);
  const sm = step.reduce((a, b) => a + b, 0) / step.length;
  const speedSpread = Math.sqrt(step.reduce((a, b) => a + (b - sm) ** 2, 0) / step.length);
  return { lagMs: -mean * 1000, jitterMs: jitter * 1000, speedSpreadPct: speedSpread * 100, worstMs: Math.max(...err.map((e) => Math.abs(e - mean))) * 1000 };
}

const cases = [[60, 0.0029, 'Chrome-like audio clock'], [60, 0.02, 'coarse audio clock (some Firefox/Safari)'], [144, 0.0029, 'Chrome-like audio clock'], [144, 0.02, 'coarse audio clock'], [30, 0.01, 'slow device']];
for (const [hz, q, label] of cases) {
  const o = play('old', hz, q), n = play('new', hz, q);
  const f = (r) => `jitter ${r.jitterMs.toFixed(1)} ms, speed wobble ${r.speedSpreadPct.toFixed(0)}%, lag ${r.lagMs.toFixed(1)} ms`;
  t(`${hz} Hz screen, ${label}: OLD ${f(o)}  ->  NEW ${f(n)}`, () => {
    assert.ok(n.jitterMs <= o.jitterMs + 0.05, 'new loop must not be jumpier than the old one');
    assert.ok(n.jitterMs < 2.5, 'picture timing jitter under 2.5 ms');
    assert.ok(n.speedSpreadPct < 15, 'on-screen speed steady within 15%');
    assert.ok(Math.abs(n.lagMs) < 15, 'stays locked to the music (average offset under 15 ms)');
    assert.ok(n.worstMs < 12, 'never more than 12 ms off the average');
  });
}

t('smoothing clock: never runs backwards on small errors; snaps on a big jump (seek / respawn)', () => {
  const c = new SmoothClock(); c.reset(10);
  const a = c.update(0.016, 9.95); assert.ok(a >= 10, 'small backwards error must not move it back');
  const b = c.update(0.016, 3.0); assert.equal(b, 3.0, 'big jump snaps');
  let x = 3; for (let i = 0; i < 120; i++) x = c.update(1 / 60, 3 + (i + 1) / 60 + 0.05); // audio is 50 ms ahead
  assert.ok(Math.abs(x - (3 + 2 + 0.05)) < 0.002, 'catches up with a steady offset ' + x);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
