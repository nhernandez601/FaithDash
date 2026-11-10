// Faith Dash 3D: lanes and rolling. This is a LAYER ON TOP of the 2D game rules (sim.js stays unchanged):
// - The runner can move between 3 lanes (left / middle / right) and roll (a short low tuck).
// - The old obstacles (spikes, saws, blocks, portals) still cover the whole road width, so they are jumped as before.
// - NEW lane obstacles are added only where the runner is on flat ground with no jump coming up, snapped to a beat:
//     barrier: a tall wall over 1 or 2 lanes (too tall to jump), so you change lane;
//     gate:    a glowing beam across all lanes at head height, so you roll under it.
// Placement is worked out from the level data and is the same every run (seeded), so nothing is random mid-game.

export const LANES = [-1, 0, 1];
export const ROLL_TIME = 0.55;     // seconds a roll lasts
export const ROLL_H = 0.38;        // runner height while rolled (normal height is 0.8)
export const GATE_Y = 0.55;        // beam bottom above the ground: standing (0.8) hits it, rolling (0.38) passes
export const BARRIER_H = 2.7;      // taller than a jump (apex 2.41), so it must be dodged
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
  let last = -1e9, kind = 0;
  for (const [a, b] of free) {
    if (b - a < 5) continue;
    const mid = (a + b) / 2;
    const beat = Math.round(mid / lv.tpb) * lv.tpb; // on the beat
    if (beat < a + 3 || beat > b - 1.5) continue; // at least 3 tiles of calm road to react
    // the surface the runner is actually on = the highest solid top here; it must cover the whole stretch (no steps)
    const near = lv.solids.filter((s) => s.y1 > s.y0 && s.x < beat + 3 && s.x + s.w > beat - 3);
    if (!near.length) continue;
    const top = Math.max(...near.map((s) => s.y1));
    if (!near.some((s) => s.y1 === top && s.x <= beat - 3 && s.x + s.w >= beat + 3)) continue;
    if (lv.solids.some((s) => s.y0 > top + 0.1 && s.x < beat + 3 && s.x + s.w > beat - 3)) continue; // a ceiling here
    if (beat - last < 12) continue;
    const type = kind++ % 3 === 2 ? 'gate' : r() < 0.6 ? 'barrier' : 'gate';
    if (type === 'barrier') {
      const n = r() < 0.45 ? 2 : 1;                        // block 1 or 2 lanes, always leave one open
      const freeLane = LANES[Math.floor(r() * 3)];
      const lanes = n === 2 ? LANES.filter((l) => l !== freeLane) : [LANES.filter((l) => l !== freeLane)[Math.floor(r() * 2)]];
      out.push({ type, x: beat, w: 0.9, y: top, lanes, a, b });
    } else out.push({ type, x: beat, w: 0.5, y: top, a, b }); // a..b = the calm stretch it sits in
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

// Does the runner hit a lane obstacle right now? laneW = world width of one lane.
export function hitsLaneHazard(hz, p, L, PW, PH, laneW) {
  const x0 = p.x + 0.12, x1 = p.x + PW - 0.12;
  for (let i = hz.from || 0; i < hz.list.length; i++) {
    const h = hz.list[i];
    if (h.x > x1) break;
    if (h.x + h.w < x0) { hz.from = i + 1; continue; }
    if (h.type === 'gate') {
      const height = L.roll > 0 ? ROLL_H : PH;
      if (p.y + height - 0.06 > h.y + GATE_Y && p.y < h.y + BARRIER_H) return h; // beam + energy wall above it: only rolling gets through
    } else {
      if (p.y > h.y + BARRIER_H) continue;
      for (const ln of h.lanes) if (Math.abs(L.lx - ln) * laneW < laneW * 0.5 + PW * 0.32) return h;
    }
  }
  return null;
}
