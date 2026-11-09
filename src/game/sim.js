// Faith Dash — deterministic gameplay simulation (pure, no rendering, no DOM).
// Units: 1 tile = 1 world unit. +x = forward, +y = UP. Ground surface is y = 0.
// The renderer, the unit tests and the level-completability bot all share this file.

export const PW = 0.8; // player width  (identical for every skin)
export const PH = 0.8; // player height (identical for every skin)
export const G = 75; // gravity, tiles/s^2
export const JUMP_V = 19.0; // jump launch velocity, tiles/s  (apex = 2.41 tiles, air time = 0.51 s)
// Jump arc: the SAME height as before but 18% less hang-time, so the jump reads as snappy rather than floaty.
export const DT = 1 / 120; // fixed simulation step
export const BUFFER = 0.1; // input buffer (s)
export const COYOTE = 0.08; // coyote time (s)
export const STEP_TOL = 0.12; // tiny ledges are stepped up instead of crashing
export const LAND_TOL = 0.06;
export const FALL_Y = -5;
export const HB_INSET = 0.12; // hazard hit-box is the player box shrunk by this on every side
export const INV_TIME = 2.0; // invincibility after trivia (simulation seconds of actual play)
export const BUCKET = 8;

export const DJ_TIME = 15; // seconds the double-jump power-up lasts
export const ORB_R = 0.6; // pick-up radius of a power-up orb
export const PORTAL_W = 0.4; // thickness of a portal's trigger plane
export const ORIENT = { FLIP: 1, MIRROR: 2 }; // screen-orientation bits set by portals (visual only)

export const EV = { JUMP: 1, COIN: 2, CHECKPOINT: 3, DEAD: 4, FINISH: 5, PORTAL: 6, ORB: 7, DOUBLE: 8, MODE: 9, SECRET: 10 };

// ---------- movement modes (v6) ----------
// CUBE: tap to jump (as before). With gravity flipped (grav = -1) the cube runs on ceilings and jumps downward.
// SHIP: hold to rise, let go to fall (smooth acceleration).  WAVE: hold = straight up at 45 degrees, let go = straight down.
// Ship and wave slide along floors and ceilings; hitting the side of a block or any hazard is a crash.
export const MODE = { CUBE: 0, SHIP: 1, WAVE: 2 };
export const SHIP_ACC = 52;   // tiles/s^2, up while held, down while released
export const SHIP_VMAX = 10.5; // tiles/s
export const WAVE_K = 1.0;     // wave climbs/dives at WAVE_K x running speed (1 = 45 degrees)
export const WAVE_INSET = 0.24; // the wave's hazard hit-box is smaller (it is drawn as a small dart)
export const CEIL_Y = 14;      // above this the runner has "fallen" up out of the world
export const SECRET_W = 0.45;  // half-width of a secret coin's pick-up column

const TWO_PI = Math.PI * 2;

// ---------- moving things: pure functions of time ----------
export function platPos(pl, t, out) {
  const a = TWO_PI * (t / pl.period + pl.phase);
  out.x = pl.x + pl.ax * Math.sin(a);
  out.y = pl.y + pl.ay * Math.sin(a + (pl.yph || 0));
  return out;
}
export function sawPos(sw, t, out) {
  const a = TWO_PI * (t / sw.period + sw.phase);
  out.x = sw.cx + sw.ax * Math.sin(a);
  out.y = sw.cy + sw.ay * Math.sin(a);
  return out;
}
export function spinnerAngle(sp, t) {
  return sp.ang0 + TWO_PI * (t / sp.period + sp.phase);
}
export function pulseOn(pu, t) {
  const f = (t / pu.period + pu.phase) % 1;
  return (f < 0 ? f + 1 : f) < pu.on;
}

// ---------- level index ----------
function addB(B, a, b, it) {
  for (let i = Math.floor(a / BUCKET); i <= Math.floor(b / BUCKET); i++) {
    let arr = B.get(i);
    if (!arr) B.set(i, (arr = []));
    arr.push(it);
  }
}
export function finalizeLevel(lv) {
  if (lv.cues) lv.cues.sort((a, b) => a.t - b.t); // obstacle take-offs in time order (the music cue ticks and the cue lane rely on it)
  lv.bSolid = new Map();
  lv.bPlat = new Map();
  lv.bHaz = new Map();
  for (const s of lv.solids) addB(lv.bSolid, s.x, s.x + s.w, s);
  lv.platforms.forEach((p, i) => {
    p.i = i;
    addB(lv.bPlat, p.x - p.ax - 0.1, p.x + p.w + p.ax + 0.1, p);
  });
  const hz = [];
  for (const s of lv.spikes) {
    s.k = 0;
    hz.push([s, s.x, s.x + 1]);
  }
  for (const s of lv.saws) {
    s.k = 1;
    hz.push([s, s.cx - s.ax - s.r, s.cx + s.ax + s.r]);
  }
  for (const s of lv.spinners) {
    s.k = 2;
    hz.push([s, s.cx - s.len - 0.3, s.cx + s.len + 0.3]);
  }
  for (const s of lv.pulses) {
    s.k = 3;
    hz.push([s, s.x, s.x + s.n]);
  }
  for (const [h, a, b] of hz) addB(lv.bHaz, a, b, h);
  lv.orbs = lv.orbs || [];
  lv.portals = lv.portals || [];
  lv.mports = lv.mports || [];
  lv.secrets = lv.secrets || [];
  lv.mports.sort((a, b) => a.x - b.x);
  lv.mports.forEach((o, i) => (o.i = i));
  lv.secrets.sort((a, b) => a.x - b.x);
  lv.secrets.forEach((o, i) => (o.i = i));
  lv.orbs.sort((a, b) => a.x - b.x);
  lv.portals.sort((a, b) => a.x - b.x);
  lv.orbs.forEach((o, i) => (o.i = i));
  lv.portals.forEach((o, i) => (o.i = i));
  lv.coins.sort((a, b) => a.x - b.x);
  lv.checkpoints.sort((a, b) => a.x - b.x);
  lv.coins.forEach((c, i) => (c.i = i));
  lv.checkpoints.forEach((c, i) => (c.i = i));
  return lv;
}

// ---------- player ----------
export function newPlayer(lv) {
  return {
    x: 0, y: 0, vy: 0, t: 0,
    grounded: true, standingOn: null,
    buffer: -1, coyote: 0,
    dead: false, deathReason: '', finished: false,
    invUntil: -1,
    furthest: 0,
    cpIndex: -1,
    coinsUsed: new Uint8Array(lv.coins.length),
    rot: 0,
    // power-up + portals
    djUntil: -1, djUsed: false,
    orbsUsed: new Uint8Array(lv.orbs ? lv.orbs.length : 0),
    portalsUsed: new Uint8Array(lv.portals ? lv.portals.length : 0),
    orient: 0,
    // v6: movement mode, gravity direction, held input, mode portals and secret coins
    mode: MODE.CUBE, grav: 1, hold: false,
    mportsUsed: new Uint8Array(lv.mports ? lv.mports.length : 0),
    secretsGot: new Uint8Array(lv.secrets ? lv.secrets.length : 0),
  };
}
export function cloneP(p) {
  const q = Object.assign({}, p);
  q.coinsUsed = p.coinsUsed; // bot never uses coins; renderer never clones
  if (p.mportsUsed && p.mportsUsed.length) q.mportsUsed = p.mportsUsed.slice(); // each branch crosses mode portals on its own
  return q;
}
// Forget everything that happened after checkpoint x (orbs, portals) and drop the power-up.
export function resetPickups(lv, p, x) {
  for (let i = 0; i < lv.orbs.length; i++) if (lv.orbs[i].x >= x) p.orbsUsed[i] = 0;
  for (let i = 0; i < lv.portals.length; i++) if (lv.portals[i].x >= x) p.portalsUsed[i] = 0;
  const mp = lv.mports || [];
  for (let i = 0; i < mp.length; i++) if (mp[i].x >= x && p.mportsUsed) p.mportsUsed[i] = 0;
  const se = lv.secrets || [];
  for (let i = 0; i < se.length; i++) if (se[i].x >= x && p.secretsGot) p.secretsGot[i] = 0;
  p.orient = 0; p.djUntil = -1; p.djUsed = false;
  p.mode = MODE.CUBE; p.grav = 1; p.hold = false;
}
export function respawn(lv, p) {
  const cp = p.cpIndex >= 0 ? lv.checkpoints[p.cpIndex] : { x: 0, y: 0, t: 0 };
  p.x = cp.x;
  p.y = cp.y;
  p.t = cp.t;
  p.vy = 0;
  p.grounded = true;
  p.standingOn = null;
  p.buffer = -1;
  p.coyote = COYOTE;
  p.dead = false;
  p.deathReason = '';
  p.invUntil = -1;
  resetPickups(lv, p, cp.x);
}

const EMPTY = [];
const tA = { x: 0, y: 0 };
const tB = { x: 0, y: 0 };
const EVS = [];

function circleBox(cx, cy, r, x0, y0, x1, y1) {
  const nx = cx < x0 ? x0 : cx > x1 ? x1 : cx;
  const ny = cy < y0 ? y0 : cy > y1 ? y1 : cy;
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

// Returns the (shared, reused) events array. `press` = a NEW jump press happened this step.
export function step(lv, p, dt, press, opts) {
  EVS.length = 0;
  if (p.dead || p.finished) return EVS;
  const margin = (opts && opts.margin) || 0; // bot uses this to demand slack around hazards
  const S = lv.speed;

  if (press) p.buffer = BUFFER;
  else p.buffer -= dt;
  if (p.grounded) p.coyote = COYOTE;
  else p.coyote -= dt;

  const t0 = p.t;
  const t1 = t0 + dt;
  p.t = t1;
  const oldY = p.y;

  const g = p.grav || 1;
  const mode = p.mode || MODE.CUBE;
  let jumped = false;
  if (mode === MODE.CUBE) {
    // --- jump (one jump per ground contact: grounded / coyote is consumed) ---
    if (p.buffer > 0 && (p.grounded || p.coyote > 0)) {
      jumped = true;
      p.vy = g * JUMP_V;
      p.grounded = false;
      p.standingOn = null;
      p.coyote = -1;
      p.buffer = -1;
      EVS.push(EV.JUMP);
    }
    // --- double jump (power-up): one extra jump in the air while the power-up lasts ---
    if (!jumped && press && !p.grounded && p.coyote <= 0 && !p.djUsed && t0 < p.djUntil) {
      jumped = true;
      p.vy = g * JUMP_V;
      p.djUsed = true;
      p.buffer = -1;
      p.spin = 16.5;
      EVS.push(EV.JUMP, EV.DOUBLE);
    }
    // --- carried by a moving platform ---
    if (!jumped && p.grounded && p.standingOn !== null) {
      const pl = lv.platforms[p.standingOn];
      platPos(pl, t0, tA);
      platPos(pl, t1, tB);
      p.x += tB.x - tA.x;
      p.y += tB.y - tA.y;
    }
    p.vy -= g * G * dt;
    if (p.vy < -44) p.vy = -44; else if (p.vy > 44) p.vy = 44;
  } else if (mode === MODE.SHIP) {
    p.vy += g * (p.hold ? SHIP_ACC : -SHIP_ACC) * dt;
    if (p.vy > SHIP_VMAX) p.vy = SHIP_VMAX; else if (p.vy < -SHIP_VMAX) p.vy = -SHIP_VMAX;
  } else {
    p.vy = g * (p.hold ? 1 : -1) * S * WAVE_K;
  }

  // --- integrate ---
  p.x += S * dt;
  p.y += p.vy * dt;

  // --- solids: land on top (or underneath when gravity is flipped), crash on sides ---
  // Ship and wave slide along both floors and ceilings.
  const px0 = p.x, px1 = p.x + PW;
  let py0 = p.y, py1 = p.y + PH;
  let landTop = -1e9, landId = null, landBot = 1e9, crash = '';
  const cube = mode === MODE.CUBE;
  const b0 = Math.floor((px0 - 0.5) / BUCKET), b1 = Math.floor((px1 + 0.5) / BUCKET);
  for (let bi = b0; bi <= b1; bi++) {
    const arr = lv.bSolid.get(bi) || EMPTY;
    for (let k = 0; k < arr.length; k++) {
      const s = arr[k];
      if (px1 > s.x && px0 < s.x + s.w && py0 < s.y1 && py1 > s.y0) {
        const fromAbove = p.vy <= 0 && (oldY >= s.y1 - LAND_TOL || s.y1 - py0 <= STEP_TOL);
        const fromBelow = p.vy >= 0 && (oldY + PH <= s.y0 + LAND_TOL || py1 - s.y0 <= STEP_TOL);
        if (cube) {
          if (g > 0 && fromAbove) { if (s.y1 > landTop) { landTop = s.y1; landId = null; } }
          else if (g < 0 && fromBelow) { if (s.y0 < landBot) landBot = s.y0; }
          else crash = 'block';
        } else if (fromAbove) { if (s.y1 > landTop) { landTop = s.y1; landId = null; } }
        else if (fromBelow) { if (s.y0 < landBot) landBot = s.y0; }
        else crash = 'block';
      }
    }
    const pa = lv.bPlat.get(bi) || EMPTY;
    for (let k = 0; k < pa.length; k++) {
      const pl = pa[k];
      platPos(pl, t1, tB);
      const top = tB.y, bot = tB.y - pl.h;
      if (px1 > tB.x && px0 < tB.x + pl.w && py0 < top && py1 > bot) {
        platPos(pl, t0, tA);
        if (cube && g > 0 && p.vy <= 0 && (oldY >= tA.y - LAND_TOL || top - py0 <= STEP_TOL)) {
          if (top > landTop) { landTop = top; landId = pl.i; }
        } else crash = 'platform';
      }
    }
  }
  const inv = t1 < p.invUntil;
  // While protected (post-trivia shield) wall/hazard hits are ignored, but we still land on surfaces.
  if (crash && inv) crash = '';
  if (!crash) {
    p.grounded = false;
    if (landTop > -1e8 && (!cube || g > 0)) {
      p.y = landTop;
      if (p.vy < 0) p.vy = 0;
      p.grounded = true;
      p.djUsed = false;
      p.standingOn = cube ? landId : null;
    } else if (landBot < 1e8 && (!cube || g < 0)) {
      p.y = landBot - PH;
      if (p.vy > 0) p.vy = 0;
      p.grounded = true;
      p.djUsed = false;
      p.standingOn = null;
    } else p.standingOn = null;
    if (cube && p.grounded) p.vy = 0;
    py0 = p.y; py1 = p.y + PH;
  }

  // --- hazards ---
  if (!crash && !inv) {
    const ins = mode === MODE.WAVE ? WAVE_INSET : HB_INSET;
    const hx0 = px0 + ins - margin, hx1 = px1 - ins + margin;
    const hy0 = py0 + ins - margin, hy1 = py1 - ins + margin;
    for (let bi = b0; bi <= b1 && !crash; bi++) {
      const arr = lv.bHaz.get(bi);
      if (!arr) continue;
      for (let k = 0; k < arr.length && !crash; k++) {
        const h = arr[k];
        if (h.k === 0) {
          // spike: narrow triangle approximated by a 0.56 x 0.6 box (hanging spikes point down from y)
          if (hx1 > h.x + 0.22 - margin && hx0 < h.x + 0.78 + margin) {
            if (h.down ? hy1 > h.y - 0.6 - margin && hy0 < h.y : hy1 > h.y && hy0 < h.y + 0.6 + margin) crash = 'spike';
          }
        } else if (h.k === 1) {
          sawPos(h, t1, tB);
          if (circleBox(tB.x, tB.y, h.r + margin, hx0, hy0, hx1, hy1)) crash = 'saw';
        } else if (h.k === 2) {
          const a = spinnerAngle(h, t1);
          const ca = Math.cos(a), sa = Math.sin(a);
          for (let u = -h.len; u <= h.len + 1e-9; u += 0.25) {
            if (circleBox(h.cx + ca * u, h.cy + sa * u, 0.2 + margin, hx0, hy0, hx1, hy1)) { crash = 'spinner'; break; }
          }
        } else if (h.k === 3) {
          if (pulseOn(h, t1) && hx1 > h.x + 0.2 - margin && hx0 < h.x + h.n - 0.2 + margin && hy1 > h.y && hy0 < h.y + 0.6 + margin) crash = 'pulse';
        }
      }
    }
  }
  if (!crash && (p.y < FALL_Y || p.y > CEIL_Y)) crash = 'fall';

  if (crash) {
    p.dead = true;
    p.deathReason = crash;
    EVS.push(EV.DEAD);
    return EVS;
  }

  if (p.furthest < p.x) p.furthest = Math.min(p.x, lv.finishX);

  // --- power-up orbs and portals ---
  for (let i = 0; i < lv.orbs.length; i++) {
    const o = lv.orbs[i];
    if (p.orbsUsed[i] || o.x < px0 - 1 || o.x > px1 + 1) continue;
    if (circleBox(o.x, o.y, ORB_R, px0, py0, px1, py1)) {
      p.orbsUsed[i] = 1;
      p.djUntil = t1 + DJ_TIME;
      EVS.push(EV.ORB, i);
    }
  }
  for (let i = 0; i < lv.portals.length; i++) {
    const g = lv.portals[i];
    if (p.portalsUsed[i] || g.x > px1 + 1) continue;
    if (px1 >= g.x && px0 <= g.x + PORTAL_W && py1 > g.y0 && py0 < g.y1) {
      p.portalsUsed[i] = 1;
      p.orient = g.set;
      EVS.push(EV.PORTAL, i);
    }
  }

  // --- mode portals (v6): switch between cube / ship / wave, or flip gravity. Full height, crossed by every route. ---
  const mp = lv.mports;
  if (mp) for (let i = 0; i < mp.length; i++) {
    const m = mp[i];
    if (m.x > px1 + 1) break;
    if (p.mportsUsed[i] || px1 < m.x) continue;
    p.mportsUsed[i] = 1;
    const nm = m.mode != null ? m.mode : p.mode, ng = m.grav != null ? m.grav : p.grav;
    if (nm !== p.mode || ng !== p.grav) {
      p.mode = nm; p.grav = ng;
      p.grounded = false; p.standingOn = null; p.coyote = -1; p.buffer = -1;
      if (nm === MODE.SHIP) { if (p.vy > SHIP_VMAX) p.vy = SHIP_VMAX; else if (p.vy < -SHIP_VMAX) p.vy = -SHIP_VMAX; }
      if (nm === MODE.CUBE && Math.abs(p.vy) > JUMP_V) p.vy = Math.sign(p.vy) * JUMP_V;
    }
    EVS.push(EV.MODE, i);
  }
  // --- secret coins (v6): a tall pick-up column on the risky route of a fork ---
  const se = lv.secrets;
  if (se) for (let i = 0; i < se.length; i++) {
    const c = se[i];
    if (c.x > px1 + 1) break;
    if (p.secretsGot[i] || c.x + SECRET_W < px0 || c.x - SECRET_W > px1) continue;
    if (py1 > c.y0 && py0 < c.y1) { p.secretsGot[i] = 1; EVS.push(EV.SECRET, i); }
  }

  // --- gates (coins), checkpoints, finish ---
  const front = p.x + PW;
  for (let i = 0; i < lv.coins.length; i++) {
    const c = lv.coins[i];
    if (!p.coinsUsed[i] && front >= c.x) {
      p.coinsUsed[i] = 1;
      EVS.push(EV.COIN, i);
    }
  }
  for (let i = p.cpIndex + 1; i < lv.checkpoints.length; i++) {
    const c = lv.checkpoints[i];
    if (p.x >= c.x) { p.cpIndex = i; EVS.push(EV.CHECKPOINT, i); } else break;
  }
  if (front >= lv.finishX) {
    p.finished = true;
    p.furthest = lv.finishX;
    EVS.push(EV.FINISH);
  }
  // visual rotation (cosmetic only)
  // A jump is one smooth forward roll (a full turn per flat jump); on landing it eases to the nearest upright pose.
  if (mode !== MODE.CUBE) {
    // ship and wave point where they are going (nose up = negative angle on screen)
    const want = -Math.atan2(p.vy, S) * (mode === MODE.SHIP ? 0.85 : 1);
    p.rot = mode === MODE.WAVE ? want : p.rot + (want - p.rot) * Math.min(1, dt * 18);
  } else if (p.grounded) {
    p.spin = 12.4;
    const target = Math.round(p.rot / TWO_PI) * TWO_PI;
    p.rot += (target - p.rot) * Math.min(1, dt * 22);
  } else p.rot += g * dt * (p.spin || 12.4);
  return EVS;
}
