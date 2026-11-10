// Faith Dash 3D: lanes and rolling. This is a LAYER ON TOP of the 2D game rules (sim.js stays unchanged):
// - The runner can move between 3 lanes (left / middle / right), jump (the normal game jump) and roll (a short low tuck).
// - The old obstacles (spikes, saws, blocks, portals) still cover the whole road width and sit on the music's hits,
//   so they are jumped on the beat as before.
// - NEW lane obstacles each block 1 or 2 lanes (never all 3) and always allow TWO answers:
//     gate:   a beam at head height with an energy wall above it   -> ROLL under it, or DODGE to another lane
//             (jumping fails: the wall is taller than a jump)
//     hurdle: a low crystal block on the road                      -> JUMP over it, or DODGE to another lane
//             (rolling fails: it sits on the ground)
//   They are placed only on calm, flat stretches with no beat-jump coming up, snapped to a beat, with room to react
//   (and, for hurdles, room to land after a jump). The same every run (seeded), nothing random mid-game.

export const LANES = [-1, 0, 1];
export const ROLL_TIME = 0.55;     // seconds a roll lasts
export const ROLL_H = 0.38;        // runner height while rolled (normal height is 0.8)
export const GATE_Y = 0.55;        // beam bottom above the ground: standing (0.8) hits it, rolling (0.38) passes
export const GATE_TOP = 2.9;       // the energy wall above the beam: taller than a jump (apex 2.41), so it can't be jumped
export const HURDLE_H = 0.78;      // hurdle height: the runner must be above this to clear it (a jump peaks at 2.41)
export const LANE_SPEED = 11;      // lane widths per second when switching (about 0.09 s per lane)

function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export function planLaneHazards(lv) {
  const S = lv.speed, out = [];
  const bad = [];
  const block = (a, b) => bad.push([a, b]);
  for (const c of lv.cues) { const x = c.t * S; block(x - 2.5, x + 6.5); }                 // take-off + time in the air
  for (const s of lv.spikes) block(s.x - 2.5, s.x + 3.5);
  for (const s of lv.saws) block(s.cx - s.ax - s.r - 3, s.cx + s.ax + s.r + 3);
  for (const s of lv.spinners) block(s.cx - s.len - 3, s.cx + s.len + 3);
  for (const s of lv.pulses) block(s.x - 3, s.x + s.n + 3);
  for (const p of lv.platforms) block(p.x - Math.abs(p.ax) - 3, p.x + p.w + Math.abs(p.ax) + 3);
  for (const c of lv.coins) block(c.x - 6, c.x + 6);
  for (const c of lv.checkpoints) block(c.x - 4, c.x + 4);
  for (const m of lv.mports) block(m.x - 6, m.x + 6);
  for (const o of lv.orbs) block(o.x - 4, o.x + 4);
  for (const z of lv.sections) block(z.x0 - 8, z.x1 + 8);
  for (const s of lv.secrets) block(s.x - 6, s.x + 6);
  block(-1e9, 30); block(lv.finishX - 25, 1e9);
  bad.sort((a, b) => a[0] - b[0]);
  // free stretches = gaps between blocked ranges, that also sit on ONE flat solid with nothing overhead
  const free = [];
  let cur = -1e9;
  for (const [a, b] of bad) { if (a > cur) free.push([cur, a]); cur = Math.max(cur, b); }
  const r = rng(lv.id * 4241 + 17);
  const jumpLen = 0.51 * S + 1.5;  // how far a jump carries (air time 0.51 s) plus slack, for landing room after a hurdle
  let last = -1e9, kind = 0;
  for (const [a, b] of free) {
    if (b - a < 6.5) continue;
    const mid = (a + b) / 2;
    const beat = Math.round(mid / lv.tpb) * lv.tpb; // on the beat
    if (beat < a + 4.5 || beat > b - 1.5) continue; // at least 4.5 tiles of calm road first: room to land, then react
    // the surface the runner is actually on = the highest solid top here; it must cover the whole stretch (no steps)
    const near = lv.solids.filter((s) => s.y1 > s.y0 && s.x < beat + 3 && s.x + s.w > beat - 4.5); // 4.5 tiles of flat road before it (no step just before)
    if (!near.length) continue;
    const top = Math.max(...near.map((s) => s.y1));
    const flat = near.find((s) => s.y1 === top && s.x <= beat - 4.5 && s.x + s.w >= beat + jumpLen - 2);
    if (!flat || near.some((s) => s.y1 > top)) continue;
    if (lv.solids.some((s) => s.y0 > top + 0.1 && s.x < beat + jumpLen && s.x + s.w > beat - 3)) continue; // a ceiling here
    if (beat - last < 12) continue;
    // a hurdle needs room to land after jumping it; otherwise use a gate
    let type = kind++ % 2 ? 'hurdle' : 'gate';
    if (type === 'hurdle' && b - beat < jumpLen - 2) type = 'gate';
    const n = r() < 0.45 ? 2 : 1;                         // block 1 or 2 lanes, always leave one open
    const freeLane = LANES[Math.floor(r() * 3)];
    const others = LANES.filter((l) => l !== freeLane);
    const lanes = n === 2 ? others : [others[Math.floor(r() * 2)]];
    out.push({ type, x: beat, w: type === 'gate' ? 0.5 : 0.9, y: top, lanes, a: Math.max(a, flat.x), b }); // a..b = the calm stretch it sits in
    last = beat;
  }
  return out;
}

// The runner's lane state. Lives next to the sim player; reset on every (re)spawn.
export function newLaneState() { return { lane: 0, lx: 0, roll: 0, rollBuf: 0 }; }

// Advance lanes / roll by one sim step. `grounded` and `mode` come from the sim player.
export function stepLane(L, dt, grounded, cubeMode) {
  const d = L.lane - L.lx, mv = LANE_SPEED * dt;
  L.lx = Math.abs(d) <= mv ? L.lane : L.lx + Math.sign(d) * mv;
  if (L.rollBuf > 0) { L.rollBuf -= dt; if (grounded && cubeMode) { L.roll = ROLL_TIME; L.rollBuf = 0; } }
  if (L.roll > 0) L.roll = Math.max(0, L.roll - dt);
}

// Is the runner (at lane position lx) inside one of these lanes?
const inLanes = (lanes, lx, laneW, PW) => lanes.some((ln) => Math.abs(lx - ln) * laneW < laneW * 0.5 + PW * 0.32);

// Does the runner hit a lane obstacle right now? laneW = world width of one lane.
export function hitsLaneHazard(hz, p, L, PW, PH, laneW) {
  const x0 = p.x + 0.12, x1 = p.x + PW - 0.12;
  for (let i = hz.from || 0; i < hz.list.length; i++) {
    const h = hz.list[i];
    if (h.x > x1) break;
    if (h.x + h.w < x0) { hz.from = i + 1; continue; }
    if (!inLanes(h.lanes, L.lx, laneW, PW)) continue;             // dodged: in an open lane
    if (h.type === 'gate') {
      const height = L.roll > 0 ? ROLL_H : PH;
      if (p.y + height - 0.06 > h.y + GATE_Y && p.y < h.y + GATE_TOP) return h; // only a roll gets under the beam
    } else if (p.y < h.y + HURDLE_H) return h;                      // only a jump gets over a hurdle
  }
  return null;
}

// What the HUD should suggest for an obstacle, given the runner's lane.
export function hint(h, lane) {
  if (!h.lanes.includes(lane)) return 'LANE CLEAR';
  return h.type === 'gate' ? 'ROLL ↓ or DODGE' : 'JUMP ↑ or DODGE';
}

// ---------------------------------------------------------------- dodgeable rhythm obstacles
// The original obstacles (spike groups, saws, laser bars, pulsing spikes) each get 1 or 2 lanes too, so they can be
// jumped on the beat OR dodged. Exceptions stay full width: anything inside a fly / wave / gravity section (those are
// corridors) and spikes hanging from a ceiling. Terrain (blocks, steps, pits) is never split.
// How collisions work without touching sim.js: the sim finds deadly things only through the level's `bHaz` index, so we
// build a copy of the level per lane (and per pair of lanes, for mid-switch) whose index holds only the obstacles in
// those lanes, and step the sim against the copy matching where the runner is. Each copy only has FEWER obstacles than
// the original level, so the proven route still completes it in any lane.
import { BUCKET } from '../game/sim.js';

export function assignHazardLanes(lv) {
  const r = rng(lv.id * 977 + 5);
  const inSection = (x0, x1) => lv.sections.some((z) => x1 > z.x0 - 2 && x0 < z.x1 + 2);
  const pick = () => {
    const n = r() < 0.65 ? 2 : 1;
    const free = LANES[Math.floor(r() * 3)];
    const others = LANES.filter((l) => l !== free);
    return n === 2 ? others : [others[Math.floor(r() * 2)]];
  };
  // every obstacle that may be split, with the stretch of road it covers
  const items = [];
  for (const s of lv.spikes) if (!s.down && !inSection(s.x, s.x + 1)) items.push([s, s.x, s.x + 1]);
  for (const s of lv.saws) { const a = s.cx - s.ax - s.r, b = s.cx + s.ax + s.r; if (!inSection(a, b)) items.push([s, a, b]); }
  for (const s of lv.spinners) { const a = s.cx - s.len, b = s.cx + s.len; if (!inSection(a, b)) items.push([s, a, b]); }
  for (const s of lv.pulses) if (!inSection(s.x, s.x + s.n)) items.push([s, s.x, s.x + s.n]);
  items.sort((p, q) => p[1] - q[1]);
  // obstacles closer than 4 tiles form one cluster and share their lanes, so ONE dodge clears the whole cluster
  const map = new Map();
  let cl = [], end = -1e9;
  const flush = () => { if (cl.length) { const ln = pick(); for (const h of cl) map.set(h, ln); } cl = []; };
  for (const [h, a, b] of items) { if (a - end > 4) flush(); cl.push(h); end = Math.max(end, b); }
  flush();
  return map;
}

// which lanes (1 or 2 neighbours) the runner's body overlaps at lane position lx
export function laneKey(lx, laneW, PW) { return LANES.filter((l) => Math.abs(lx - l) * laneW < laneW * 0.5 + PW * 0.32).join(','); }

// one level copy per lane set, with a hazard index holding only what can hit in those lanes
export function laneLevels(lv, map) {
  const out = {};
  for (const key of ['-1', '0', '1', '-1,0', '0,1']) {
    const set = key.split(',').map(Number);
    const keep = (h) => { const ln = map.get(h); return !ln || ln.some((l) => set.includes(l)); };
    const v = Object.assign({}, lv, { bHaz: new Map() });
    const add = (h, a, b) => {
      if (!keep(h)) return;
      for (let i = Math.floor(a / BUCKET); i <= Math.floor(b / BUCKET); i++) { let arr = v.bHaz.get(i); if (!arr) v.bHaz.set(i, (arr = [])); arr.push(h); }
    };
    // same ranges as finalizeLevel() in sim.js
    for (const s of lv.spikes) add(s, s.x, s.x + 1);
    for (const s of lv.saws) add(s, s.cx - s.ax - s.r, s.cx + s.ax + s.r);
    for (const s of lv.spinners) add(s, s.cx - s.len - 0.3, s.cx + s.len + 0.3);
    for (const s of lv.pulses) add(s, s.x, s.x + s.n);
    out[key] = v;
  }
  return out;
}
