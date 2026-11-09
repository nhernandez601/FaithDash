// v6 movement modes: fly (ship), wave, real gravity flips, mode portals, secret coins, Hardcore.
import assert from 'node:assert/strict';
import { finalizeLevel, newPlayer, step, DT, MODE, PH, SHIP_VMAX, CEIL_Y, EV } from '../src/game/sim.js';
import { proveCompletable, replayInputs } from '../src/game/bot.js';
import { Run } from '../src/game/run.js';
import { getLevel, LEVEL_DEFS } from '../src/game/levelgen.js';

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('PASS -', name); } catch (e) { fail++; console.log('FAIL -', name, '\n      ' + e.message); } }

// a little test level: ground, an optional ceiling, mode portals and extra pieces
function mk({ ceil = null, mports = [], solids = [], spikes = [], saws = [], secrets = [], len = 200 } = {}) {
  const S = [{ x: -20, w: len + 40, y0: -12, y1: 0 }];
  if (ceil != null) S.push({ x: -20, w: len + 40, y0: ceil, y1: ceil + 4 });
  return finalizeLevel({
    speed: 10, solids: S.concat(solids), spikes, saws, spinners: [], pulses: [], platforms: [], coins: [], checkpoints: [],
    orbs: [], portals: [], mports, secrets, finishX: len,
  });
}
const run = (lv, p, secs, input = () => ({})) => {
  const evs = [];
  for (let i = 0; i < Math.round(secs / DT) && !p.dead && !p.finished; i++) {
    const { press = false, hold } = input(p, i) || {};
    if (hold !== undefined) p.hold = hold;
    const e = step(lv, p, DT, press);
    for (const x of e) evs.push(x);
  }
  return evs;
};

t('fly portal turns the cube into a ship; holding climbs, releasing falls', () => {
  const lv = mk({ ceil: 9, mports: [{ x: 3, mode: MODE.SHIP }] });
  const p = newPlayer(lv);
  run(lv, p, 0.5);
  assert.equal(p.mode, MODE.SHIP);
  const y0 = p.y;
  run(lv, p, 0.4, () => ({ hold: true }));
  assert.ok(p.y > y0 + 2, 'should climb while held, got ' + p.y);
  assert.ok(p.vy <= SHIP_VMAX + 1e-9);
  const y1 = p.y;
  run(lv, p, 0.7, () => ({ hold: false }));
  assert.ok(p.y < y1 - 1, 'should fall when released');
  assert.ok(!p.dead);
});
t('the ship slides along the floor and the ceiling without crashing; hitting a wall crashes', () => {
  const lv = mk({ ceil: 6, mports: [{ x: 2, mode: MODE.SHIP }] });
  const p = newPlayer(lv);
  run(lv, p, 2.0, () => ({ hold: true }));
  assert.ok(!p.dead, 'touching the ceiling is not a crash');
  assert.ok(Math.abs(p.y + PH - 6) < 1e-6, 'pressed against the ceiling');
  run(lv, p, 2.0, () => ({ hold: false }));
  assert.ok(!p.dead && Math.abs(p.y) < 1e-6, 'resting on the floor');
  const lv2 = mk({ ceil: 9, mports: [{ x: 2, mode: MODE.SHIP }], solids: [{ x: 20, w: 2, y0: 0, y1: 5 }] });
  const q = newPlayer(lv2);
  run(lv2, q, 3, () => ({ hold: false }));
  assert.ok(q.dead && q.deathReason === 'block', 'flying into the side of a block crashes');
});
t('the wave moves at exactly 45 degrees: up while held, down when released', () => {
  const lv = mk({ ceil: 12, mports: [{ x: 1, mode: MODE.WAVE }] });
  const p = newPlayer(lv);
  run(lv, p, 0.3);
  assert.equal(p.mode, MODE.WAVE);
  const x0 = p.x, y0 = p.y;
  run(lv, p, 0.3, () => ({ hold: true }));
  assert.ok(Math.abs((p.y - y0) - (p.x - x0)) < 1e-6, 'rise equals run');
  const x1 = p.x, y1 = p.y;
  run(lv, p, 0.2, () => ({ hold: false }));
  assert.ok(Math.abs((y1 - p.y) - (p.x - x1)) < 1e-6, 'fall equals run');
});
t('a hanging spike kills from below; a floor spike kills the wave', () => {
  const lv = mk({ ceil: 9, mports: [{ x: 1, mode: MODE.SHIP }], spikes: [{ x: 20, y: 1.2, down: true }] });
  const p = newPlayer(lv);
  run(lv, p, 3, () => ({ hold: false }));
  assert.ok(p.dead && p.deathReason === 'spike');
  const lv2 = mk({ ceil: 9, mports: [{ x: 1, mode: MODE.WAVE }], spikes: [{ x: 12, y: 0 }] });
  const q = newPlayer(lv2);
  run(lv2, q, 3, () => ({ hold: false }));
  assert.ok(q.dead && q.deathReason === 'spike');
});
t('a gravity portal flips gravity: the cube falls UP onto the ceiling, runs there, and jumps downward', () => {
  const lv = mk({ ceil: 6, mports: [{ x: 3, mode: MODE.CUBE, grav: -1 }] });
  const p = newPlayer(lv);
  run(lv, p, 1.0);
  assert.equal(p.grav, -1);
  assert.ok(p.grounded && Math.abs(p.y + PH - 6) < 1e-6, 'standing under the ceiling, y=' + p.y);
  run(lv, p, 0.15, (q, i) => ({ press: i === 0 }));
  assert.ok(p.y + PH < 6 - 1.5, 'a jump goes down');
  run(lv, p, 1.0);
  assert.ok(p.grounded && Math.abs(p.y + PH - 6) < 1e-6, 'lands back on the ceiling');
  assert.ok(!p.dead);
});
t('upside down, a gap in the ceiling means falling up out of the world', () => {
  const lv = finalizeLevel({ speed: 10, solids: [{ x: -20, w: 240, y0: -12, y1: 0 }, { x: -20, w: 40, y0: 6, y1: 10 }], spikes: [], saws: [], spinners: [], pulses: [], platforms: [], coins: [], checkpoints: [], orbs: [], portals: [], mports: [{ x: 3, mode: MODE.CUBE, grav: -1 }], secrets: [], finishX: 200 });
  const p = newPlayer(lv);
  run(lv, p, 4);
  assert.ok(p.dead && p.deathReason === 'fall' && p.y > CEIL_Y - 1);
});
t('mode portals fire once, and a checkpoint respawn puts you back as a normal cube', () => {
  const lv = mk({ ceil: 9, mports: [{ x: 3, mode: MODE.SHIP }, { x: 30, mode: MODE.CUBE, grav: 1 }] });
  const p = newPlayer(lv);
  const evs = run(lv, p, 4);
  assert.equal(evs.filter((e) => e === EV.MODE).length, 2);
  assert.equal(p.mode, MODE.CUBE);
  const r = new Run({ level: lv, bank: null });
  run(lv, r.p, 1);
  assert.equal(r.p.mode, MODE.SHIP);
  r.respawn();
  assert.equal(r.p.mode, MODE.CUBE); assert.equal(r.p.grav, 1);
});
t('a secret coin is collected by passing through its column (once), and is reported as an event', () => {
  const lv = mk({ secrets: [{ x: 15, y0: -1, y1: 3 }] });
  const p = newPlayer(lv);
  const evs = run(lv, p, 3);
  assert.equal(evs.filter((e) => e === EV.SECRET).length, 1);
  assert.equal(p.secretsGot[0], 1);
  const lv2 = mk({ secrets: [{ x: 15, y0: 5, y1: 9 }] });
  const q = newPlayer(lv2);
  run(lv2, q, 3);
  assert.equal(q.secretsGot[0], 0, 'a runner below the column does not get it');
});
t('the prover can fly: it finds hold/release timing through a ship gap, and the recording replays', () => {
  const lv = mk({ ceil: 9, len: 80, mports: [{ x: 3, mode: MODE.SHIP }],
    solids: [{ x: 30, w: 1, y0: 0, y1: 4 }, { x: 30, w: 1, y0: 7, y1: 9 }, { x: 50, w: 1, y0: 2.5, y1: 9 }] });
  const r = proveCompletable(lv, { margin: 0.05, pressEvery: 3 });
  assert.ok(r.ok, 'not proven, best ' + r.best);
  assert.ok(r.inputs.some((e) => e.ev === 'd') && r.inputs.some((e) => e.ev === 'u'), 'needs both holds and releases');
  const p = replayInputs(lv, r.inputs);
  assert.ok(p.finished && !p.dead);
});
t('Hardcore: a hit restarts the level from the start and counts an attempt; lives never change', () => {
  const lv = mk({ spikes: [{ x: 12, y: 0 }] });
  const r = new Run({ level: lv, bank: null, hardcore: true });
  r.advance(3, 3);
  assert.ok(r.p.dead);
  assert.equal(r.registerHit(), 'restart');
  r.restartFromStart();
  assert.equal(r.p.x, 0); assert.equal(r.attempts, 2); assert.equal(r.lives, 3); assert.ok(!r.over);
  const c = new Run({ level: lv, bank: null });
  c.advance(3, 3);
  assert.equal(c.registerHit(), 'respawn');
  assert.equal(c.lives, 2);
});
t('every level: fly and wave sections have gaps on the beat grid and every section ends where the music says', () => {
  for (const def of LEVEL_DEFS) {
    const lv = getLevel(def.id);
    for (const z of lv.sections) {
      assert.ok(Math.abs(z.x0 / lv.tpb - Math.round(z.x0 / lv.tpb)) < 1e-6, 'section starts on a beat');
      for (const sg of z.segs || []) {
        const step = sg.kind === 'wave' ? lv.tpb / 2 : lv.tpb;   // wave: every half beat, fly: every beat
        const pillars = lv.spikes.filter((s) => s.x >= sg.x0 && s.x < sg.x1);
        assert.ok(pillars.length >= 4, 'a ' + sg.kind + ' stretch needs obstacles, found ' + pillars.length);
        for (const s of pillars) assert.ok(Math.abs(s.x / step - Math.round(s.x / step)) < 1e-6, 'pillar off the beat grid at ' + s.x);
      }
    }
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
