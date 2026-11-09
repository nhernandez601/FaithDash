// Level completability prover.
// Explores EVERY possible input timing (at 1/60 s resolution) with the exact same physics the game uses
// and reports whether any sequence of inputs reaches the finish line without taking damage.
//   - cube: tap to jump. Each branch is followed until the cube lands again (or switches mode in the air).
//   - ship / wave (v6): every 1/60 s the input is either held or released, so every frame branches.
// `margin` inflates every hazard hit-box, so passing with margin > 0 proves there is human-sized slack.
import { step, cloneP, newPlayer, DT, MODE } from './sim.js';

const TICK = 2; // 2 sub-steps of 1/120 s = 1/60 s decision resolution
const CAP = 300; // most distinct states kept per frame

// Inside a fly / wave / gravity section the runner is meant to be high up, so the "ground route only" height limit
// does not apply there.
const inSection = (lv, x) => { const S = lv.sections; if (S) for (const z of S) if (x >= z.x0 - 2 && x <= z.x1 + 12) return true; return false; };
function simTicks(lv, q, press, n, margin, maxY) {
  for (let i = 0; i < n * TICK; i++) {
    step(lv, q, DT, press && i === 0, { margin });
    if (maxY !== undefined && q.y > maxY && !inSection(lv, q.x)) q.dead = true; // used to prove "ground route only": never rise into the sky route
    if (q.dead || q.finished) return;
  }
}

export function proveCompletable(lvIn, opts = {}) {
  const margin = opts.margin || 0;
  const lv = Object.assign({}, lvIn, { coins: [], checkpoints: [], orbs: [], portals: [], secrets: [] });
  const start = opts.start ? cloneP(opts.start) : newPlayer(lv);
  start.coinsUsed = new Uint8Array(0);
  start.orbsUsed = new Uint8Array(0);
  start.portalsUsed = new Uint8Array(0);
  start.secretsGot = new Uint8Array(0);
  start.mportsUsed = new Uint8Array((lv.mports || []).length);
  if (opts.start && opts.start.mportsUsed) start.mportsUsed.set(opts.start.mportsUsed.subarray(0, start.mportsUsed.length));
  start.djUntil = -1;
  const startTick = Math.round(start.t * 60);
  const buckets = new Map();
  const add = (tick, q) => {
    let m = buckets.get(tick);
    if (!m) buckets.set(tick, (m = new Map()));
    const key = q.mode === MODE.CUBE
      ? 'c' + q.grav + '|' + (q.standingOn === null ? 'g' : q.standingOn) + '|' + Math.round(q.y * 40) + '|' + Math.round(q.x * 25)
      : 'm' + q.mode + q.grav + (q.hold ? 'h' : 'r') + '|' + Math.round(q.y * 16) + '|' + Math.round(q.vy * 2);
    if (!m.has(key)) m.set(key, q);
  };
  add(startTick, start);
  const maxTick = startTick + Math.ceil((lv.finishX / lv.speed + 20) * 60);
  let best = 0, states = 0;
  const done = (q) => {
    const inputs = [];
    for (let h = q.hist; h; h = h.prev) inputs.push({ tick: h.tick, ev: h.ev });
    inputs.reverse();
    const jumps = inputs.filter((e) => e.ev !== 'u').map((e) => e.tick);
    return { ok: true, states, best: lv.finishX, jumps, inputs };
  };
  let lastTick = startTick;
  for (let tick = startTick; tick <= maxTick; tick++) {
    const m = buckets.get(tick);
    if (!m) continue;
    buckets.delete(tick);
    lastTick = tick;
    let list = [...m.values()];
    if (list.length > CAP) {
      // keep an even spread of heights so a narrow gap somewhere is not thinned away
      list.sort((a, b) => a.y - b.y || a.vy - b.vy);
      const k = list.length / CAP;
      list = Array.from({ length: CAP }, (_, i) => list[Math.floor(i * k)]);
    }
    for (const p of list) {
      states++;
      if (p.furthest > best) best = p.furthest;
      if (p.finished) return done(p);
      if (p.mode === MODE.CUBE) {
        for (const press of [false, true]) {
          if (press && opts.pressEvery > 1 && tick % opts.pressEvery !== 0) continue;
          const q = cloneP(p);
          q.hold = false;
          if (press) q.hist = { tick, ev: 'p', prev: p.hist || null };
          else if (p.hold) q.hist = { tick, ev: 'u', prev: p.hist || null };
          let n = 1;
          simTicks(lv, q, press, 1, margin, opts.maxY);
          while (!q.dead && !q.finished && !q.grounded && q.mode === MODE.CUBE && n < 400) { simTicks(lv, q, false, 1, margin, opts.maxY); n++; }
          if (q.dead) continue;
          if (q.mode === MODE.CUBE && !q.grounded && !q.finished) continue;
          if (q.furthest > best) best = q.furthest;
          if (q.finished) return done(q);
          add(tick + n, q);
        }
      } else {
        // ship / wave: hold or release this frame. A human cannot toggle every frame, so toggles are only
        // allowed on the same 1/60 s grid the cube uses (pressEvery); otherwise the input is kept as it was.
        const canToggle = !(opts.pressEvery > 1 && tick % opts.pressEvery !== 0);
        for (const h of canToggle ? [false, true] : [!!p.hold]) {
          const q = cloneP(p);
          if (h !== !!p.hold) q.hist = { tick, ev: h ? 'd' : 'u', prev: p.hist || null };
          q.hold = h;
          simTicks(lv, q, h && !p.hold, 1, margin, opts.maxY);
          if (q.dead) continue;
          if (q.furthest > best) best = q.furthest;
          if (q.finished) return done(q);
          add(tick + 1, q);
        }
      }
    }
  }
  return { ok: false, states, best, lastTick };
}

// Play a recorded input list ({tick, ev: 'p' tap | 'd' hold down | 'u' release}) through a level with the real physics.
// Returns the final player. `onStep(p, evs)` is called after every 1/120 s step.
export function replayInputs(lv, inputs, opts = {}) {
  const p = opts.start ? cloneP(opts.start) : newPlayer(lv);
  const at = new Map();
  for (const e of inputs) { if (!at.has(e.tick)) at.set(e.tick, []); at.get(e.tick).push(e.ev); }
  const startTick = Math.round(p.t * 60);
  for (let tick = startTick; tick < startTick + (opts.maxTicks || 60 * 600); tick++) {
    let press = false;
    for (const ev of at.get(tick) || []) {
      if (ev === 'p') { press = true; p.hold = false; }
      else if (ev === 'd') { press = true; p.hold = true; }
      else if (ev === 'u') p.hold = false;
    }
    for (let i = 0; i < TICK; i++) {
      const evs = step(lv, p, DT, press && i === 0, opts.stepOpts);
      if (opts.onStep) opts.onStep(p, evs);
      if (p.dead || p.finished) return p;
    }
  }
  return p;
}
