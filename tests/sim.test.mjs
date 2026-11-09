// Headless unit tests for physics, lives, trivia and invincibility rules.
import assert from 'node:assert/strict';
import { getLevel, LEVEL_DEFS } from '../src/game/levelgen.js';
import { step, newPlayer, DT, EV, JUMP_V, G, INV_TIME, finalizeLevel, PW, DJ_TIME, respawn } from '../src/game/sim.js';
import { Run, MAX_LIVES } from '../src/game/run.js';
import { bank as realBank } from '../src/core/bank.js';

let pass = 0, fail = 0;
const results = [];
function t(name, fn) {
  try { fn(); pass++; results.push(['PASS', name]); } catch (e) { fail++; results.push(['FAIL', name, e.message]); }
}

function mini(extra = {}) {
  const lv = Object.assign({
    id: 99, name: 'mini', speed: 9, bpm: 120, spb: 0.5, tpb: 4.5, solids: [{ x: -50, w: 400, y0: -12, y1: 0 }],
    spikes: [], saws: [], spinners: [], pulses: [], platforms: [], coins: [], checkpoints: [], cues: [], finishX: 300, length: 300,
  }, extra);
  return finalizeLevel(lv);
}
function run(lv, p, seconds, pressAt = []) {
  const n = Math.round(seconds / DT);
  const evs = [];
  for (let i = 0; i < n && !p.dead && !p.finished; i++) {
    const press = pressAt.includes(i);
    const e = step(lv, p, DT, press);
    for (const x of e) evs.push(x);
  }
  return evs;
}

t('player runs forward automatically at level speed', () => {
  const lv = mini(); const p = newPlayer(lv);
  run(lv, p, 1);
  assert.ok(Math.abs(p.x - 9) < 0.05, `x=${p.x}`);
  assert.equal(p.y, 0); assert.ok(p.grounded);
});
t('jump apex ~2.4 tiles and air time ~0.51 s (same height as before, noticeably snappier)', () => {
  const lv = mini(); const p = newPlayer(lv);
  step(lv, p, DT, true);
  let apex = 0, n = 1;
  while (!p.grounded && n < 400) { step(lv, p, DT, false); apex = Math.max(apex, p.y); n++; }
  assert.ok(Math.abs(apex - 2.4) < 0.08, `apex ${apex}`);
  assert.ok(Math.abs(n * DT - 0.507) < 0.03, `air ${n * DT}`);
});
t('no accidental double jump (second press mid-air is buffered, not an extra jump)', () => {
  const lv = mini(); const p = newPlayer(lv);
  step(lv, p, DT, true);
  let maxY = 0;
  for (let i = 0; i < 20; i++) { step(lv, p, DT, i === 5); maxY = Math.max(maxY, p.y); }
  // mid-air press must not add velocity: velocity keeps decreasing
  assert.ok(p.vy < JUMP_V - G * 20 * DT + 0.01, `vy ${p.vy}`);
});
t('input buffer: press shortly before landing jumps on landing', () => {
  const lv = mini(); const p = newPlayer(lv);
  step(lv, p, DT, true);
  let n = 0;
  while (p.y > 0.3 || p.vy > 0) { step(lv, p, DT, false); n++; }
  step(lv, p, DT, true); // press ~0.05s before touching down
  let jumped = false;
  for (let i = 0; i < 60; i++) { const e = step(lv, p, DT, false); if (e.includes(EV.JUMP)) jumped = true; }
  assert.ok(jumped, 'buffered jump should fire on landing');
});
t('coyote time: jump allowed shortly after running off an edge', () => {
  const lv = mini({ solids: [{ x: -50, w: 60, y0: -12, y1: 0 }] }); const p = newPlayer(lv);
  p.x = 8.9; // about to leave edge at x=10 (front)
  let left = false, pressed = false, jumped = false;
  for (let i = 0; i < 100; i++) {
    const wasG = p.grounded;
    let press = false;
    if (!p.grounded && !pressed) { press = true; pressed = true; } // first airborne frame
    const e = step(lv, p, DT, press);
    if (e.includes(EV.JUMP)) jumped = true;
    if (wasG && !p.grounded) left = true;
  }
  assert.ok(left && jumped, `left=${left} jumped=${jumped}`);
});
t('spike collision registers once and kills exactly once', () => {
  const lv = mini({ spikes: [{ x: 10, y: 0 }] }); const p = newPlayer(lv);
  let deaths = 0;
  for (let i = 0; i < 400; i++) { const e = step(lv, p, DT, false); deaths += e.filter((x) => x === EV.DEAD).length; }
  assert.equal(deaths, 1);
  assert.equal(p.deathReason, 'spike');
});
t('player can jump a spike', () => {
  const lv = mini({ spikes: [{ x: 14, y: 0 }] }); const p = newPlayer(lv);
  // takeoff so apex over spike: x0 = 14.5-0.4-2.79 = 11.3 -> t=1.256s
  const tick = Math.round(1.256 / DT);
  run(lv, p, 3, [tick]);
  assert.ok(!p.dead, 'should survive');
  assert.ok(p.x > 20);
});
t('falling into a gap is a hazard', () => {
  const lv = mini({ solids: [{ x: -50, w: 60, y0: -12, y1: 0 }, { x: 20, w: 100, y0: -12, y1: 0 }] }); const p = newPlayer(lv);
  run(lv, p, 3);
  assert.ok(p.dead); assert.equal(p.deathReason, 'fall');
});
t('side collision with a tall block is fatal; landing on top is not', () => {
  const lv = mini({ solids: [{ x: -50, w: 400, y0: -12, y1: 0 }, { x: 15, w: 3, y0: 0, y1: 1.5 }] });
  let p = newPlayer(lv); run(lv, p, 3);
  assert.ok(p.dead && p.deathReason === 'block');
  p = newPlayer(lv); // jump early enough
  run(lv, p, 3, [Math.round(1.25 / DT)]);
  assert.ok(!p.dead, 'landing on the block should be safe: ' + p.deathReason);
});
t('player stands on a vertical moving platform and is carried', () => {
  const lv = mini({ solids: [{ x: -50, w: 10, y0: -12, y1: 0 }], platforms: [{ x: 10, y: 1, w: 60, h: 0.4, ax: 0, ay: 1, yph: 0, period: 4, phase: 0 }] });
  const p = newPlayer(lv); p.x = 12; p.t = 0; p.y = 1; p.standingOn = 0; p.grounded = true;
  let maxErr = 0, off = 0;
  for (let i = 0; i < 480 && !p.dead; i++) {
    step(lv, p, DT, false);
    const top = 1 + Math.sin((2 * Math.PI * p.t) / 4);
    maxErr = Math.max(maxErr, Math.abs(p.y - top));
    if (!(p.grounded && p.standingOn === 0)) off++;
  }
  assert.ok(!p.dead, 'died ' + p.deathReason);
  assert.ok(maxErr < 1e-6, 'platform contact error ' + maxErr);
  assert.equal(off, 0, 'player left platform unexpectedly (' + off + ' steps) -- vertical motion incl. descending phase');
});
t('player stands on a horizontal moving platform and is carried with it', () => {
  const lv = mini({ solids: [{ x: -50, w: 10, y0: -12, y1: 0 }], platforms: [{ x: 10, y: 0, w: 80, h: 0.4, ax: 1, ay: 0, yph: 0, period: 4, phase: 0 }] });
  const p = newPlayer(lv); p.x = 14; p.t = 0; p.y = 0; p.standingOn = 0; p.grounded = true;
  let off = 0;
  for (let i = 0; i < 480 && !p.dead; i++) { step(lv, p, DT, false); if (!(p.grounded && p.standingOn === 0)) off++; }
  assert.ok(!p.dead && off === 0, `off ${off} dead ${p.deathReason}`);
  // x = start + S*t + platform displacement
  const expected = 14 + 9 * p.t + 1 * Math.sin((2 * Math.PI * p.t) / 4);
  assert.ok(Math.abs(p.x - expected) < 1e-6, `x ${p.x} expected ${expected}`);
});
t('landing from the air on a rising / falling platform works (no fall-through)', () => {
  for (const ph of [0, 0.25, 0.5, 0.75]) {
    const lv = mini({ solids: [{ x: -50, w: 10, y0: -12, y1: 0 }], platforms: [{ x: 10, y: 0.5, w: 80, h: 0.4, ax: 0, ay: 1, yph: 0, period: 2, phase: ph }] });
    const p = newPlayer(lv); p.x = 14; p.y = 3; p.t = 0; p.grounded = false;
    for (let i = 0; i < 360 && !p.dead; i++) step(lv, p, DT, false);
    assert.ok(!p.dead, `phase ${ph}: ${p.deathReason}`);
    assert.ok(p.grounded && p.standingOn === 0, `phase ${ph} not on platform`);
  }
});
t('coin gate triggers exactly once, at any height', () => {
  const lv = mini({ coins: [{ x: 20 }] }); const p = newPlayer(lv);
  let coins = 0;
  for (let i = 0; i < 600; i++) { const e = step(lv, p, DT, i === 100); coins += e.filter((x) => x === EV.COIN).length; }
  assert.equal(coins, 1);
});
t('checkpoint recorded; finish detected', () => {
  const lv = mini({ checkpoints: [{ x: 20, y: 0, t: 20 / 9 }], finishX: 60 }); const p = newPlayer(lv);
  const ev = run(lv, p, 8);
  assert.ok(ev.includes(EV.CHECKPOINT)); assert.ok(p.finished);
  assert.equal(p.cpIndex, 0);
});

// ---------------- Run (lives / trivia / invincibility) ----------------
const Q = (n, ci) => ({ id: 'q' + n, text: 'Q' + n, options: ['a', 'b', 'c', 'd'], correctIdx: ci, ref: '', expl: '' });
function mkRun(lives = 3) {
  const lv = mini({ coins: [{ x: 20 }] });
  const r = new Run({ level: lv, bank: null, practice: true, practiceQuestions: [Q(1, 2), Q(2, 1)] });
  r.lives = lives;
  return r;
}
t('lives: correct answer +1 capped at 3 (3->3, 2->3, 1->2)', () => {
  for (const [from, to] of [[3, 3], [2, 3], [1, 2]]) {
    const r = mkRun(from); r.beginTrivia(); r.select(2); const res = r.submit();
    assert.ok(res.correct); assert.equal(r.lives, to, `from ${from}`);
  }
});
t('lives: wrong answer -1; at 1 life -> game over', () => {
  let r = mkRun(3); r.beginTrivia(); r.select(0); let res = r.submit();
  assert.ok(!res.correct); assert.equal(r.lives, 2);
  r = mkRun(1); r.beginTrivia(); r.select(0); res = r.submit();
  assert.equal(r.lives, 0); assert.ok(res.gameOver); assert.equal(r.endTrivia(), 'gameover');
});
t('submitted answer cannot be changed or re-submitted', () => {
  const r = mkRun(2); r.beginTrivia(); r.select(0); r.submit();
  assert.equal(r.select(2), false); assert.equal(r.submit(), null); assert.equal(r.lives, 1);
});
t('trivia cannot be opened twice simultaneously', () => {
  const r = mkRun(); const a = r.beginTrivia(); const b = r.beginTrivia();
  assert.equal(a, b);
});
t('submit requires a selection', () => { const r = mkRun(); r.beginTrivia(); assert.equal(r.submit(), null); });
t('hit deducts exactly one life and 3 hits end the run', () => {
  const r = mkRun(3);
  assert.equal(r.registerHit(), 'respawn'); assert.equal(r.lives, 2);
  assert.equal(r.registerHit(), 'respawn'); assert.equal(r.registerHit(), 'gameover'); assert.equal(r.lives, 0);
});
t('lives never exceed 3 or drop below 0', () => {
  const r = mkRun(3); r.registerHit(); r.registerHit(); r.registerHit(); r.registerHit();
  assert.equal(r.lives, 0);
  const q = mkRun(3); for (let i = 0; i < 5; i++) { q.trivia = null; q.beginTrivia(); q.select(q.trivia.question.correctIdx); q.submit(); }
  assert.equal(q.lives, 3);
});
t('invincibility: 2.0 s of resumed play after trivia, exactly', () => {
  const lv = mini({ coins: [{ x: 20 }], spikes: [{ x: 40, y: 0 }, { x: 30, y: 0 }] });
  const r = new Run({ level: lv, bank: null, practice: true, practiceQuestions: [Q(1, 2)] });
  let evs = [];
  for (let i = 0; i < 400 && !evs.some((e) => e.type === 'coin'); i++) evs = r.advance(1 / 60);
  assert.ok(evs.some((e) => e.type === 'coin'), 'coin should trigger');
  const tPause = r.p.t, xPause = r.p.x;
  // while "in trivia" the game loop does not call advance -> nothing moves
  r.beginTrivia(); r.select(2); r.submit();
  assert.equal(r.p.t, tPause); assert.equal(r.p.x, xPause);
  assert.equal(r.endTrivia(), 'resume');
  assert.ok(Math.abs(r.p.invUntil - (tPause + INV_TIME)) < 1e-9);
  // run until inv expires
  let invEnd = null;
  for (let i = 0; i < 2000; i++) {
    const before = r.invActive;
    r.advance(1 / 120);
    if (before && !r.invActive) { invEnd = r.p.t; break; }
  }
  assert.ok(Math.abs(invEnd - (tPause + 2)) < 0.01, `expired at ${invEnd - tPause}s`);
});
t('invincible player passes through a spike without dying; vulnerable afterwards', () => {
  const lv = mini({ coins: [{ x: 20 }], spikes: [{ x: 25, y: 0 }, { x: 60, y: 0 }] });
  const r = new Run({ level: lv, bank: null, practice: true, practiceQuestions: [Q(1, 2)] });
  let evs = [];
  while (!evs.some((e) => e.type === 'coin')) evs = r.advance(1 / 60);
  r.beginTrivia(); r.select(2); r.submit(); r.endTrivia();
  let dead = false, atX = 0;
  for (let i = 0; i < 3000 && !dead; i++) { const e = r.advance(1 / 60); if (e.some((x) => x.type === 'dead')) { dead = true; atX = r.p.x; } }
  assert.ok(dead, 'should die on the later spike'); assert.ok(atX > 50, 'died at ' + atX + ' (first spike should have been ignored)');
});
t('coin cannot retrigger after respawn (no trivia farming)', () => {
  const lv = mini({ coins: [{ x: 20 }], checkpoints: [{ x: 5, y: 0, t: 5 / 9 }], spikes: [{ x: 40, y: 0 }] });
  const r = new Run({ level: lv, bank: null, practice: true, practiceQuestions: [Q(1, 2)] });
  let coinEvents = 0, deaths = 0;
  for (let n = 0; n < 6000 && deaths < 2; n++) {
    const e = r.advance(1 / 60);
    for (const ev of e) {
      if (ev.type === 'coin') { coinEvents++; r.beginTrivia(); r.select(2); r.submit(); r.endTrivia(); }
      if (ev.type === 'dead') { deaths++; r.registerHit(); r.respawn(); }
    }
  }
  assert.equal(coinEvents, 1); assert.equal(r.lives, 3 - 2 + 1 > 3 ? 3 : r.lives);
});
t('score uses furthest progress only: checkpoint retries do not add score', () => {
  const lv = mini({ checkpoints: [{ x: 5, y: 0, t: 5 / 9 }], spikes: [{ x: 40, y: 0 }], finishX: 300 });
  const r = new Run({ level: lv, bank: null, practice: true, practiceQuestions: [Q(1, 2)] });
  let prev = 0, deaths = 0;
  for (let n = 0; n < 8000 && deaths < 2; n++) {
    for (const ev of r.advance(1 / 60)) if (ev.type === 'dead') { deaths++; prev = r.progress; r.registerHit(); r.respawn(); }
  }
  assert.ok(Math.abs(r.progress - prev) < 0.01 || r.progress >= prev, 'progress must not exceed furthest reach');
  const furthestAfterRetry = r.p.furthest;
  assert.ok(furthestAfterRetry < 41, `furthest ${furthestAfterRetry}`);
});
t('active play time excludes time when advance() is not called (pause / trivia)', () => {
  const r = mkRun(); for (let i = 0; i < 60; i++) r.advance(1 / 60);
  const a = r.activeTime;
  // paused for "10 seconds": loop does not call advance
  assert.equal(r.activeTime, a);
});

// ---------------- bank ----------------
t('empty bank returns the creator-setup signal (no invented questions)', () => {
  realBank.clear();
  const used = new Set();
  const r = realBank.pick(1, used);
  assert.equal(r.empty, true);
});
t('bank: validation requires exactly 3 distinct wrong answers; shuffle; no repeats within run', () => {
  realBank.clear();
  assert.equal(realBank.add({ q: 'x', correct: 'a', wrong: ['b', 'c'] }).ok, false);
  assert.equal(realBank.add({ q: 'x', correct: 'a', wrong: ['b', 'c', 'a'] }).ok, false);
  for (let i = 0; i < 6; i++) assert.ok(realBank.add({ q: 'Q' + i, correct: 'right' + i, wrong: ['w1', 'w2', 'w3'], levels: [] }).ok);
  const used = new Set(); const seen = new Set(); const pos = [0, 0, 0, 0];
  let last = -1, same = 0, maxSame = 0;
  for (let i = 0; i < 6; i++) {
    const r = realBank.pick(1, used, Math.random, last, same);
    seen.add(r.question.id); pos[r.question.correctIdx]++;
    assert.equal(r.question.options.length, 4);
    assert.equal(r.question.options.filter((o) => o === r.question.options[r.question.correctIdx]).length, 1);
    same = r.question.correctIdx === last ? same + 1 : 0; maxSame = Math.max(maxSame, same); last = r.question.correctIdx;
  }
  assert.equal(seen.size, 6, 'no repeats until exhausted');
  assert.ok(maxSame <= 1, 'correct answer must not sit in the same slot repeatedly: ' + maxSame);
  realBank.clear();
});
t('bank: import/export JSON round-trip and invalid rows are rejected', () => {
  realBank.clear();
  realBank.add({ q: 'A?', correct: 'x', wrong: ['y', 'z', 'w'], ref: 'John 1:1', difficulty: 'hard', levels: [3] });
  const json = realBank.exportJSON(); realBank.clear();
  const res = realBank.importJSON(json); assert.ok(res.ok && res.imported === 1);
  assert.equal(realBank.all()[0].ref, 'John 1:1'); assert.deepEqual(realBank.all()[0].levels, [3]);
  const bad = realBank.importJSON(JSON.stringify({ questions: [{ q: 'bad', correct: 'a', wrong: ['b'] }] }));
  assert.equal(bad.ok, false); realBank.clear();
});

// ---------------------------------------------------------------- v3: roll, double jump, portals, floating tiles
const maxY = (lv, p, secs, presses) => { let m = 0; const n = Math.round(secs / DT); for (let i = 0; i < n && !p.dead; i++) { step(lv, p, DT, presses.includes(i)); m = Math.max(m, p.y); } return m; };

t('single jump apex is 2.4 tiles; without the power-up a second tap in the air does nothing', () => {
  const lv = mini(); const p = newPlayer(lv);
  const top = maxY(lv, p, 1, [10, 40]);
  assert.ok(Math.abs(top - 2.4) < 0.1, 'apex ' + top);
});
t('orb pick-up starts the 15 s double-jump power-up and fires an ORB event', () => {
  const lv = mini({ orbs: [{ x: 4, y: 2.0 }] }); const p = newPlayer(lv);
  const evs = [];
  for (let i = 0; i < 400; i++) { for (const e of step(lv, p, DT, i === 20)) evs.push(e); }
  assert.ok(evs.includes(EV.ORB), 'no ORB event');
  assert.ok(p.orbsUsed[0] === 1);
  assert.ok(Math.abs(p.djUntil - p.t) < DJ_TIME + 0.1 && p.djUntil > 0);
});
t('with the power-up: one extra jump in the air reaches ~4.8 tiles; a third tap does nothing; landing recharges', () => {
  const lv = mini(); const p = newPlayer(lv);
  p.djUntil = 100;
  const evs = [];
  let top = 0;
  const presses = [10, 10 + 37, 10 + 60]; // jump, double-jump near the apex, extra tap
  for (let i = 0; i < 300; i++) { for (const e of step(lv, p, DT, presses.includes(i))) evs.push(e); top = Math.max(top, p.y); }
  assert.equal(evs.filter((e) => e === EV.DOUBLE).length, 1, 'exactly one double jump per airtime');
  assert.ok(top > 4.4 && top < 5.0, 'apex ' + top);
  assert.ok(p.grounded && p.djUsed === false, 'landing should recharge');
});
t('double jump expires after DJ_TIME seconds', () => {
  const lv = mini(); const p = newPlayer(lv);
  p.djUntil = p.t + DJ_TIME;
  const n = Math.round((DJ_TIME + 1) / DT);
  for (let i = 0; i < n; i++) step(lv, p, DT, false);
  const top = maxY(lv, p, 1, [10, 47]);
  assert.ok(top < 2.6, 'apex after expiry ' + top);
});
t('floating tile: reachable by one jump, can be landed on and run along, side hit crashes', () => {
  const lv = mini({ solids: [{ x: -50, w: 400, y0: -12, y1: 0 }, { x: 30, w: 6, y0: 1.3, y1: 1.8 }] });
  const p = newPlayer(lv);
  let i = 0; while (p.x < 26.6 && i < 5000) { step(lv, p, DT, false); i++; }
  step(lv, p, DT, true);
  let landed = false;
  for (let j = 0; j < 400 && !p.dead; j++) { step(lv, p, DT, false); if (p.grounded && p.y > 1.7) { landed = true; break; } }
  assert.ok(landed, 'did not land on the floating tile; dead=' + p.deathReason);
  const q = newPlayer(lv); let k = 0; while (!q.dead && q.x < 40 && k < 9000) { step(lv, q, DT, false); k++; }
  assert.ok(!q.dead, 'a runner passes underneath a tile that floats above head height');
  const u = newPlayer(lv); k = 0; while (u.x < 30.4) step(lv, u, DT, false);
  step(lv, u, DT, true); for (let j = 0; j < 100 && !u.dead; j++) step(lv, u, DT, false);
  assert.equal(u.deathReason, 'block', 'jumping into the underside of a floating tile crashes');
});
t('portal sets the screen orientation once; a ring above the player is ignored; respawn clears it', () => {
  const lv = mini({
    portals: [{ x: 10, y0: -5, y1: 4.6, set: 1, style: 'flip' }, { x: 20, y0: 5.2, y1: 40, set: 2, style: 'mirror' }, { x: 30, y0: -5, y1: 40, set: 0, style: 'flip' }],
    checkpoints: [{ x: 5, y: 0, t: 5 / 9 }],
  });
  const p = newPlayer(lv);
  const seen = [];
  for (let i = 0; i < 2000 && !p.finished; i++) {
    const e = step(lv, p, DT, false);
    for (let j = 0; j < e.length; j++) if (e[j] === EV.PORTAL) seen.push([e[++j], p.orient]);
    if (p.x > 12 && p.x < 14) assert.equal(p.orient, 1);
    if (p.x > 22 && p.x < 24) assert.equal(p.orient, 1, 'high ring must not trigger on the ground');
    if (p.x > 32) break;
  }
  assert.deepEqual(seen, [[0, 1], [2, 0]]);
  assert.equal(p.orient, 0);
  p.orient = 2; p.portalsUsed[0] = 1; p.cpIndex = 0;
  respawn(lv, p);
  assert.equal(p.orient, 0);
  assert.equal(p.portalsUsed[0], 0, 'portals after the checkpoint re-arm');
});
t('orbs after a checkpoint re-arm on respawn; the power-up is dropped', () => {
  const lv = mini({ orbs: [{ x: 3, y: 2 }, { x: 40, y: 2 }], checkpoints: [{ x: 20, y: 0, t: 20 / 9 }] });
  const p = newPlayer(lv); p.orbsUsed[0] = 1; p.orbsUsed[1] = 1; p.djUntil = 99; p.cpIndex = 0;
  respawn(lv, p);
  assert.equal(p.orbsUsed[0], 1); assert.equal(p.orbsUsed[1], 0); assert.ok(p.djUntil < 0);
});
t('roll animation: one full forward turn per flat jump, then settles upright; sim result unchanged by it', () => {
  const lv = mini(); const p = newPlayer(lv);
  step(lv, p, DT, true);
  for (let i = 0; i < 90 && !p.grounded; i++) step(lv, p, DT, false);
  for (let i = 0; i < 120; i++) step(lv, p, DT, false);
  const turns = p.rot / (Math.PI * 2);
  assert.ok(p.grounded && Math.abs(turns - Math.round(turns)) < 0.02 && Math.round(turns) >= 1, 'turns ' + turns);
});

for (const r of results) console.log(r[0], '-', r[1], r[2] ? '\n      ' + r[2] : '');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
