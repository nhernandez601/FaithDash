// 3D lanes layer (src/three/lanes.js): every lane obstacle (dodge barrier / roll-under gate) sits in a calm stretch of
// flat road where no jump is needed. For each one, put the runner on the ground at the start of its stretch (as if it
// just landed from the previous jump), run the REAL simulation with no jump pressed, and check that:
//   - a roll pressed early, or late, gets under every gate;   - standing (no roll) does NOT get through a gate;
//   - a lane change made late still clears every barrier;     - staying in a blocked lane does crash;
//   - nothing in the 2D rules kills the runner in the stretch, and there is reaction room before each obstacle.
// Usage: node tests/lanes.test.mjs
import { LEVEL_DEFS, getLevel } from '../src/game/levelgen.js';
import { newPlayer, step, MODE, PW, PH, DT } from '../src/game/sim.js';
import { planLaneHazards, newLaneState, stepLane, hitsLaneHazard, ROLL_TIME } from '../src/three/lanes.js';

const LANE_W = 3.6 / 3;
let fail = 0, pass = 0;
const check = (ok, msg) => { if (!ok) { console.log('FAIL ' + msg); fail++; } else pass++; };

function local(lv, h, { roll, rollAt = 1, dodgeAt = 2, startLane = 0 }) {
  const lv2 = Object.assign({}, lv, { coins: [], checkpoints: [] });
  const p = newPlayer(lv2);
  const x0 = Math.max(h.a + 0.2, h.x - 9);
  p.x = x0; p.t = x0 / lv.speed; p.y = h.y; p.vy = 0; p.grounded = true; p.furthest = x0;
  const L = newLaneState(); L.lane = L.lx = startLane;
  const hz = { list: [h], from: 0 };
  let rolled = false;
  while (p.x < h.x + h.w + 2 && !p.dead && !p.finished) {
    const d = h.x - p.x;
    if (h.type === 'gate' && roll && !rolled && d < rollAt && p.grounded) { L.roll = ROLL_TIME; rolled = true; }
    if (h.type === 'barrier' && dodgeAt > 0 && d < dodgeAt && h.lanes.includes(L.lane)) { const free = [-1, 0, 1].find((l) => !h.lanes.includes(l)); L.lane += Math.sign(free - L.lane); }
    step(lv2, p, DT, false);
    stepLane(L, DT, p.grounded, p.mode === MODE.CUBE && p.grav > 0);
    if (hitsLaneHazard(hz, p, L, PW, PH, LANE_W)) return 'hit';
  }
  return p.dead ? 'sim:' + p.deathReason : 'ok';
}

for (const def of LEVEL_DEFS) {
  const lv = getLevel(def.id);
  const list = planLaneHazards(lv);
  const gates = list.filter((h) => h.type === 'gate');
  const bars = list.filter((h) => h.type === 'barrier');
  console.log(`L${def.id}: ${list.length} lane obstacles (${gates.length} roll gates, ${bars.length} barriers)`);
  check(list.length >= 6, `L${def.id}: at least 6 lane obstacles`);
  const roll = ROLL_TIME * lv.speed;           // tiles one roll covers
  for (const h of list) {
    const tag = `L${def.id} ${h.type} x=${h.x.toFixed(1)}`;
    check(h.x - h.a >= 2.4, `${tag}: reaction room before it (${(h.x - h.a).toFixed(1)} tiles)`);
    if (h.type === 'gate') {
      check(local(lv, h, { roll: true, rollAt: roll - 1.5 }) === 'ok', `${tag}: early roll gets under`);
      check(local(lv, h, { roll: true, rollAt: PW + 0.1 * lv.speed }) === 'ok', `${tag}: late roll (0.1 s before) gets under`);
      check(local(lv, h, { roll: false }) === 'hit', `${tag}: no roll crashes`);
    } else {
      check(h.lanes.length >= 1 && h.lanes.length <= 2, `${tag}: leaves a lane open`);
      for (const startLane of [-1, 0, 1]) check(local(lv, h, { dodgeAt: PW + 0.32 * lv.speed, startLane }) === 'ok', `${tag}: late dodge (0.32 s before) from lane ${startLane}`);
      check(local(lv, h, { dodgeAt: 0, startLane: h.lanes[0] }) === 'hit', `${tag}: staying in a blocked lane crashes`);
    }
  }
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
