// 3D lanes layer (src/three/lanes.js). Every lane obstacle blocks 1 or 2 lanes and must allow TWO answers:
//   gate   -> roll under it, or dodge to an open lane; jumping it must FAIL (the energy wall is too tall)
//   hurdle -> jump over it,  or dodge to an open lane; rolling must FAIL (it sits on the road)
// For each obstacle the runner starts on the ground at the start of its calm stretch (as if it just landed from the
// previous beat-jump) and the REAL simulation runs. Checks, with human timing slack:
//   - roll early / late gets under every gate;      - jump early / late clears every hurdle (and lands safely);
//   - a late dodge works from every blocked lane;   - running in an open lane passes untouched;
//   - doing nothing in a blocked lane crashes, and the wrong move (jump at a gate, roll at a hurdle) crashes;
//   - there is reaction room before each obstacle.
// Usage: node tests/lanes.test.mjs
import { LEVEL_DEFS, getLevel } from '../src/game/levelgen.js';
import { newPlayer, step, MODE, PW, PH, DT } from '../src/game/sim.js';
import { planLaneHazards, newLaneState, stepLane, hitsLaneHazard, ROLL_TIME, LANES, assignHazardLanes, laneLevels } from '../src/three/lanes.js';
import { proveCompletable, replayInputs } from '../src/game/bot.js';

const LANE_W = 3.6 / 3;
let fail = 0, pass = 0;
const check = (ok, msg) => { if (!ok) { console.log('FAIL ' + msg); fail++; } else pass++; };

// act: 'none' | 'roll' | 'jump' | 'dodge'; at: seconds before the runner's FRONT reaches the obstacle
function local(lv, h, act, at, lane) {
  const lv2 = Object.assign({}, lv, { coins: [], checkpoints: [] });
  const p = newPlayer(lv2);
  const x0 = Math.max(h.a + 0.2, h.x - 9);
  p.x = x0; p.t = x0 / lv.speed; p.y = h.y; p.vy = 0; p.grounded = true; p.furthest = x0;
  const L = newLaneState(); L.lane = L.lx = lane;
  const hz = { list: [h], from: 0 };
  let done = false;
  // stop at the end of the obstacle's calm stretch (the next beat-jump comes after it), or after a jump's landing
  const end = act === 'jump' ? h.x + h.w + 0.51 * lv.speed + 1 : Math.min(h.x + h.w + 2, h.b + 2.3);
  while (p.x < end && !p.dead && !p.finished) {
    const tFront = (h.x - (p.x + PW)) / lv.speed;
    let press = false;
    if (!done && tFront <= at) {
      done = true;
      if (act === 'roll') L.roll = ROLL_TIME;
      else if (act === 'jump') press = true;
      else if (act === 'dodge') { const opens = LANES.filter((l) => !h.lanes.includes(l)); L.lane = opens.sort((u, v) => Math.abs(u - lane) - Math.abs(v - lane))[0]; } // nearest open lane
    }
    const before = p.grounded;
    step(lv2, p, DT, press);
    if (press && before && !p.grounded) L.roll = 0;
    stepLane(L, DT, p.grounded, p.mode === MODE.CUBE && p.grav > 0);
    if (hitsLaneHazard(hz, p, L, PW, PH, LANE_W)) return 'hit';
  }
  return p.dead ? 'sim:' + p.deathReason : 'ok';
}

for (const def of LEVEL_DEFS) {
  const lv = getLevel(def.id);
  const list = planLaneHazards(lv);
  const gates = list.filter((h) => h.type === 'gate').length;
  console.log(`L${def.id}: ${list.length} lane obstacles (${gates} gates, ${list.length - gates} hurdles)`);
  check(list.length >= 6, `L${def.id}: at least 6 lane obstacles`);
  for (const h of list) {
    const tag = `L${def.id} ${h.type} x=${h.x.toFixed(1)} lanes ${h.lanes}`;
    check(h.lanes.length >= 1 && h.lanes.length <= 2, `${tag}: blocks 1-2 lanes, leaves one open`);
    check(h.x - h.a >= 4.4, `${tag}: reaction room before it (${(h.x - h.a).toFixed(1)} tiles)`);
    for (const ln of LANES.filter((l) => !h.lanes.includes(l))) check(local(lv, h, 'none', 0, ln) === 'ok', `${tag}: open lane ${ln} passes`);
    for (const ln of h.lanes) {
      check(local(lv, h, 'none', 0, ln) === 'hit', `${tag}: doing nothing in lane ${ln} crashes`);
      check(local(lv, h, 'dodge', 0.3, ln) === 'ok', `${tag}: late dodge (0.3 s) from lane ${ln}`);
      if (h.type === 'gate') {
        check(local(lv, h, 'roll', ROLL_TIME - 0.15, ln) === 'ok', `${tag}: early roll from lane ${ln}`);
        check(local(lv, h, 'roll', 0.05, ln) === 'ok', `${tag}: late roll (0.05 s) from lane ${ln}`);
        for (const at of [0.1, 0.25, 0.4]) check(local(lv, h, 'jump', at, ln) === 'hit', `${tag}: jumping (${at} s) does NOT get through`);
      } else {
        check(local(lv, h, 'jump', 0.28, ln) === 'ok', `${tag}: early jump (0.28 s) clears it from lane ${ln}`);
        check(local(lv, h, 'jump', 0.06, ln) === 'ok', `${tag}: late jump (0.06 s) clears it from lane ${ln}`);
        check(local(lv, h, 'roll', 0.2, ln) === 'hit', `${tag}: rolling does NOT get through`);
      }
    }
  }
}
// ---- dodgeable rhythm obstacles (spikes, saws, lasers, pulses get 1-2 lanes) ----
for (const def of LEVEL_DEFS) {
  const lv = getLevel(def.id);
  const map = assignHazardLanes(lv), V = laneLevels(lv, map);
  check([...map.values()].every((ln) => ln.length >= 1 && ln.length <= 2), `L${def.id}: every split obstacle leaves a lane open`);
  // 1) the proven route (jumping on the beat) still finishes the level in every lane and mid-switch
  const pr = proveCompletable(lv, { margin: 0, pressEvery: 1 });
  for (const key of Object.keys(V)) {
    const v = Object.assign({}, V[key], { coins: [], checkpoints: [] });
    const p = replayInputs(v, pr.inputs);
    check(p.finished, `L${def.id}: proven route finishes in lane(s) ${key}`);
  }
  // 2) dodging: in an open lane, with NO jump, the runner gets past the obstacle (checked where the road is flat)
  const groups = new Map();
  for (const [h, ln] of map) { if (!groups.has(ln)) groups.set(ln, []); groups.get(ln).push(h); }
  let ok = 0, tried = 0;
  for (const [ln, hs] of groups) {
    const xs = hs.map((h) => (h.cx !== undefined ? [h.cx - (h.ax || 0) - (h.r || h.len || 0), h.cx + (h.ax || 0) + (h.r || h.len || 0)] : [h.x, h.x + (h.n || 1)]));
    const x0 = Math.min(...xs.map((q) => q[0])), x1 = Math.max(...xs.map((q) => q[1]));
    const tops = lv.solids.filter((s) => s.y1 > s.y0 && s.x < x1 + 1 && s.x + s.w > x0 - 4);
    const top = tops.length ? Math.max(...tops.map((s) => s.y1)) : null;
    if (top === null || !tops.some((s) => s.y1 === top && s.x <= x0 - 4 && s.x + s.w >= x1 + 1)) continue; // not flat here
    if (lv.solids.some((s) => s.y0 > top + 0.1 && s.x < x1 + 1 && s.x + s.w > x0 - 4)) continue;
    const open = LANES.find((l) => !ln.includes(l));
    const v = Object.assign({}, V[String(open)], { coins: [], checkpoints: [] });
    const p = newPlayer(v); p.x = x0 - 4; p.t = p.x / lv.speed; p.y = top; p.vy = 0; p.grounded = true; p.furthest = p.x;
    while (p.x < x1 + 1 && !p.dead) step(v, p, DT, false);
    tried++; if (!p.dead) ok++;
    else check(false, `L${def.id}: dodge into lane ${open} past obstacle at x=${x0.toFixed(1)} died (${p.deathReason})`);
  }
  console.log(`L${def.id}: ${groups.size} split obstacle groups; dodge-without-jumping checked on ${tried} (flat road), passed ${ok}`);
  check(tried >= 10 && ok === tried, `L${def.id}: dodging works`);
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
