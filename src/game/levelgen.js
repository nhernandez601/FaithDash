// Faith Dash — deterministic level generator.
// Every obstacle pattern is placed on the music's beat grid, then PROVEN completable by the bot
// (with slack for human timing) before it is accepted. The whole level is proven again at the end.
import { finalizeLevel, newPlayer, step, JUMP_V, G, PW, PH, DT, INV_TIME, ORIENT, MODE } from './sim.js';
import { proveCompletable } from './bot.js';
import BAKED from './levels.baked.js';
import { getBeatMap, cueCandidates } from '../audio/music.js';

// Bump when the generator's output changes. Levels are generated at build time (npm run bake) and shipped ready-made.
export const GEN_VERSION = 14; // v14: wave flying removed from every level (ship flying only). v15 adds stages per song (no generator change)

// v11: every level is built on a real song's beat map (see src/audio/music.js). `song` picks the track, `tier` picks which
// musical hits may become take-offs (easy / medium / hard), `beats` is where the music ends. Each song was locked to a steady tempo (Arcade Drop and Arcade Boss Battle 130 BPM, Intense Section 147 BPM).
// To use a different song for a level, change `song` (and `beats`) here and run  npm run bake.
// v15 (3D game): ONE level that gets harder each time the song comes round. Every song has three stages, each its own
// proven, beat-synced layout: easy ("The Beginning"), medium ("The Journey"), hard ("The Trial"). The game plays them in
// order on the chosen song, then keeps repeating the hard one until the player runs out of lives.
export const TIERS = ['easy', 'medium', 'hard'];
export const SONG_IDS = ['drop', 'boss', 'intense'];
const TIER_CFG = {
  easy: {
    name: 'The Beginning', difficulty: 'Easy', speed: 9,
    rest: { coins: 5, forks: 4, zones: 6, zoneKinds: ['ship', 'grav', 'ship', 'ship', 'grav', 'ship'], secrets: 3, portalChance: 0, orbChance: 1, diff: 0.75, pressEvery: 4, margin: 0.08, platFrom: 0.15, spinnerFrom: 0.45, pulseFrom: 0.3, movesawFrom: 0.1, tripleFrom: 0.35, chainMax: 3 },
  },
  medium: {
    name: 'The Journey', difficulty: 'Medium', speed: 10.5,
    rest: { coins: 6, forks: 4, zones: 5, zoneKinds: ['ship', 'ship', 'grav', 'ship', 'ship'], secrets: 3, portalChance: 0, orbChance: 0.8, diff: 0.95, pressEvery: 3, margin: 0.07, platFrom: 0.05, spinnerFrom: 0.15, pulseFrom: 0.1, movesawFrom: 0, tripleFrom: 0.1, chainMax: 4 },
  },
  hard: {
    name: 'The Trial', difficulty: 'Hard', speed: 12,
    rest: { coins: 7, forks: 4, zones: 6, zoneKinds: ['ship', 'ship', 'grav', 'ship', 'grav', 'ship'], secrets: 3, portalChance: 0, orbChance: 0.7, diff: 1.0, pressEvery: 2, margin: 0.05, platFrom: 0, spinnerFrom: 0, pulseFrom: 0, movesawFrom: 0, tripleFrom: 0, chainMax: 5 },
  },
};
// [id, song, tier, seed]. Ids 1-3 are the original three levels (kept so their bakes stay valid).
const STAGE_LIST = [
  [1, 'drop', 'easy', 11], [4, 'drop', 'medium', 51], [5, 'drop', 'hard', 61],
  [6, 'boss', 'easy', 71], [2, 'boss', 'medium', 25], [7, 'boss', 'hard', 81],
  [8, 'intense', 'easy', 91], [9, 'intense', 'medium', 101], [3, 'intense', 'hard', 41],
];
export const LEVEL_DEFS = STAGE_LIST.map(([id, song, tier, seed]) => {
  const t = TIER_CFG[tier], m = getBeatMap(song);
  return { id, name: t.name, difficulty: t.difficulty, song, tier, speed: t.speed, bpm: m.bpm, beats: m.endBeat, seed, ...t.rest };
});
// the level id for a song's stage (0 = easy, 1 = medium, 2 = hard)
export const stageId = (song, stage) => LEVEL_DEFS.find((d) => d.song === song && d.tier === TIERS[Math.min(2, stage)]).id;

export const TILES_PER_BEAT = 4.5; // (the old 120-160 BPM levels; musical levels use  speed * 60/bpm  instead)
const QUARTERS = [0, 0.25, 0.5, 0.75]; // a hazard's cycle starts on a beat, so its extremes land on the beat
// The ground route never rises above this (a normal jump reaches 2.4; the stair tiles below the sky route top out at 3.6).
export const GROUND_MAX_Y = 4.0;
// Horizontal distance covered by one flat jump at a level's running speed.
const jumpDist = (cfg) => cfg.speed * ((2 * JUMP_V) / G);
// A portal's flip animation takes PORTAL_FLIP seconds. For that whole time the picture is rotating, so the level
// guarantees hazard-free ground for slightly longer than that after every portal.
export const PORTAL_FLIP = 1.0;
const portalLead = (b) => (PORTAL_FLIP + 0.15) * b.S;

const cueCache = new Map();
function cueXsFor(song, tier, S) {
  const key = song + '|' + tier + '|' + S;
  let a = cueCache.get(key);
  if (!a) { a = cueCandidates(getBeatMap(song), tier).map((c) => c.t * S); cueCache.set(key, a); }
  return a;
}

function rngFrom(seed) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.int = (a0, b0) => a0 + Math.floor(f() * (b0 - a0 + 1));
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  f.range = (a0, b0) => a0 + f() * (b0 - a0);
  return f;
}

class Builder {
  constructor(cfg) {
    this.cfg = cfg;
    this.S = cfg.speed;
    this.spb = 60 / cfg.bpm;
    this.tpb = this.S * this.spb; // = 4.5 tiles / beat for every level
    this.A = this.S * ((2 * JUMP_V) / G); // horizontal distance of a full jump on flat ground
    this.solids = []; this.spikes = []; this.saws = []; this.spinners = []; this.pulses = [];
    this.platforms = []; this.coins = []; this.checkpoints = []; this.cues = [];
    this.orbs = []; this.portals = []; this.fork = null;
    this.mports = []; this.secrets = []; this.sections = []; // v6: mode portals, secret coins, mode-section spans
    this.gx = -1e9; // ground built up to
    // Musical mode: take-offs snap to real drum hits of the level's song instead of a plain beat grid.
    this.map = cfg.song ? getBeatMap(cfg.song) : null;
    this.cueXs = this.map ? cueXsFor(cfg.song, cfg.tier || 'medium', this.S) : null;
    this.tail = cfg.tier === 'hard' ? 0.7 : cfg.tier === 'medium' ? 0.9 : 1.2; // flat ground kept after a landing (v6.2: much less)
  }
  // Route tags: everything built between mark() and tag() belongs to one route ('g' ground, 'a' aerial, 'e' entry stairs).
  mark() { return [this.solids.length, this.spikes.length, this.saws.length, this.spinners.length, this.pulses.length, this.platforms.length]; }
  tag(m, name) {
    [this.solids, this.spikes, this.saws, this.spinners, this.pulses, this.platforms].forEach((arr, i) => { for (let j = m[i]; j < arr.length; j++) arr[j].route = name; });
  }
  portal(x, y0, y1, set, style) { this.portals.push({ x, y0, y1, set, style }); }
  mport(x, mode, grav) { this.mports.push({ x, mode, grav }); }
  hspike(x, y) { this.spikes.push({ x, y, down: true }); } // hangs from y, points down
  // First take-off point at or after x. Musical levels return the next real hit; otherwise the next beat.
  snap(x) {
    const a = this.cueXs;
    if (!a) return Math.ceil(x / this.tpb - 1e-9) * this.tpb;
    let lo = 0, hi = a.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x - 1e-9) lo = m + 1; else hi = m; }
    return lo < a.length ? a[lo] : Math.ceil(x / this.tpb - 1e-9) * this.tpb;
  }
  // First bar line (beat 1 of a bar) at or after x.
  snapBar(x) {
    const down = this.map ? this.map.down : 0;
    const k = Math.ceil((x / this.tpb - down) / 4 - 1e-9);
    return (down + 4 * k) * this.tpb;
  }
  // Old levels offset a pattern by 0 or 1 whole beat at random; musical levels let the song decide instead.
  lead(n) { return this.cueXs ? 0 : n * this.tpb; }
  // How intense the music is at world position x (0..1)
  inten(x) { return this.map ? this.map.intensityAt(x / this.S) : 0.5; }
  ground(x0, x1) {
    if (x1 <= x0) return;
    this.solids.push({ x: x0, w: x1 - x0, y0: -12, y1: 0 });
  }
  block(x, w, y0, y1) { this.solids.push({ x, w, y0, y1 }); }
  spike(x, n) { for (let i = 0; i < n; i++) this.spikes.push({ x: x + i, y: 0 }); }
  cue(x0, hard) { this.cues.push({ t: x0 / this.S, hard: !!hard }); }
  tHeight(h) { return (JUMP_V - Math.sqrt(JUMP_V * JUMP_V - 2 * G * h)) / G; } // time to rise to height h
}

// ------------------------------------------------------------------ patterns
// build(b, c, P) — c = flat ground exists up to c. Returns x where flat ground resumes (ground exists up to there).
export const PATTERNS = {
  single: {
    gen: (r, d, cfg) => ({ lead: r.int(0, 1) }),
    build(b, c, P) {
      const x0 = b.snap(c + 1) + b.lead(P.lead);
      const jc = x0 + PW / 2 + b.A / 2;
      const end = x0 + b.A + b.tail;
      b.ground(c, end);
      b.spike(jc - 0.5, 1);
      b.cue(x0);
      return end;
    },
  },
  double: {
    gen: (r) => ({ lead: r.int(0, 1) }),
    build(b, c, P) {
      const x0 = b.snap(c + 1) + b.lead(P.lead);
      const jc = x0 + PW / 2 + b.A / 2;
      const end = x0 + b.A + b.tail;
      b.ground(c, end);
      b.spike(jc - 1, 2);
      b.cue(x0);
      return end;
    },
  },
  triple: {
    gen: (r) => ({ lead: r.int(0, 1) }),
    build(b, c, P) {
      const x0 = b.snap(c + 1) + b.lead(P.lead);
      const jc = x0 + PW / 2 + b.A / 2;
      const end = x0 + b.A + b.tail;
      b.ground(c, end);
      b.spike(jc - 1.5, 3);
      b.cue(x0, true);
      return end;
    },
  },
  gap: {
    gen: (r, d) => ({ gw: (0.38 + 0.38 * d) * 1 + r.range(-0.05, 0.05), lead: r.int(0, 1) }),
    build(b, c, P) {
      const x0 = b.snap(c + 1) + b.lead(P.lead);
      const gw = P.gw * b.A;
      const jc = x0 + PW / 2 + b.A / 2;
      const gs = jc - gw / 2, ge = jc + gw / 2;
      const end = ge + b.A / 2 + b.tail;
      b.ground(c, gs);
      b.ground(ge, end);
      b.cue(x0, true);
      return end;
    },
  },
  block: {
    gen: (r, d) => ({ h: r.pick(d < 0.4 ? [1] : [1, 2]), bw: r.range(2.5, 4), off: r.range(0.3, 1.6), lead: r.int(0, 1) }),
    build(b, c, P) {
      const x0 = b.snap(c + 1) + b.lead(P.lead);
      const bx = x0 + PW + b.S * b.tHeight(P.h) + P.off;
      const end = bx + P.bw + 3;
      b.ground(c, end);
      b.block(bx, P.bw, 0, P.h);
      b.cue(x0);
      return end;
    },
  },
  stairs: {
    gen: (r) => ({ w1: r.range(2.2, 3.4), g: r.range(0, 2), w2: r.range(2.4, 3.6), off: r.range(0.3, 1.6) }),
    build(b, c, P) {
      const x0 = b.snap(c + 1);
      const bx = x0 + PW + b.S * b.tHeight(1) + P.off;
      const bx2 = bx + P.w1 + P.g;
      const end = bx2 + P.w2 + 3;
      b.ground(c, end);
      b.block(bx, P.w1, 0, 1);
      b.block(bx2, P.w2, 0, 2);
      b.cue(x0);
      return end;
    },
  },
  floatbar: {
    gen: (r) => ({ fx: r.range(3.2, 7), fw: r.range(2.5, 4), fy: r.range(1.5, 2.2), spike: r.int(0, 1) }),
    build(b, c, P) {
      const x0 = b.snap(c + 1);
      const jc = x0 + PW / 2 + b.A / 2;
      const fx = jc + P.fx;
      const end = fx + P.fw + 3;
      b.ground(c, end);
      if (P.spike) b.spike(jc - 0.5, 1);
      b.block(fx, P.fw, P.fy, P.fy + 0.9);
      if (P.spike) b.cue(x0, true);
      return end;
    },
  },
  saw: {
    gen: (r) => ({ r: r.range(0.5, 0.7) }),
    build(b, c, P) {
      const x0 = b.snap(c + 1);
      const jc = x0 + PW / 2 + b.A / 2;
      const end = x0 + b.A + b.tail;
      b.ground(c, end);
      b.saws.push({ cx: jc, cy: P.r - 0.05, r: P.r, ax: 0, ay: 0, period: 1, phase: 0 });
      b.cue(x0);
      return end;
    },
  },
  movesaw: {
    gen: (r, d, cfg) => ({ cy: r.range(1.3, 2.0), ay: r.range(0.8, 1.4), beats: r.pick([2, 4]), phase: r.pick(QUARTERS), r: r.range(0.45, 0.6), n: r.int(1, d > 0.6 ? 2 : 1) }),
    build(b, c, P) {
      const x0 = b.snap(c + 1);
      const end = x0 + b.A + 4 + P.n * 5;
      b.ground(c, end);
      for (let i = 0; i < P.n; i++) {
        b.saws.push({ cx: x0 + b.A / 2 + 2 + i * 5, cy: P.cy, r: P.r, ax: 0, ay: P.ay, period: P.beats * b.spb, phase: P.phase + i * 0.25 });
      }
      b.cue(x0, true);
      return end;
    },
  },
  spinner: {
    gen: (r, d, cfg) => ({ cy: r.range(2.2, 3.0), len: r.range(1.3, 1.8), beats: r.pick(cfg.id >= 3 ? [2, 4, 4] : [4, 4, 8]), phase: r.pick(QUARTERS) }),
    build(b, c, P) {
      const x0 = b.snap(c + 1);
      const end = x0 + b.A + 5;
      b.ground(c, end);
      b.spinners.push({ cx: x0 + b.A / 2 + 2, cy: P.cy, len: P.len, ang0: 0, period: P.beats * b.spb, phase: P.phase });
      b.cue(x0, true);
      return end;
    },
  },
  pulse: {
    gen: (r) => ({ n: r.int(2, 3), beats: r.pick([2, 4]), phase: r.pick(QUARTERS), on: 0.5 }),
    build(b, c, P) {
      const x0 = b.snap(c + 1);
      const jc = x0 + PW / 2 + b.A / 2;
      const end = x0 + b.A + 3;
      b.ground(c, end);
      b.pulses.push({ x: jc - P.n / 2, y: 0, n: P.n, period: P.beats * b.spb, phase: P.phase, on: P.on });
      b.cue(x0, true);
      return end;
    },
  },
  platform: {
    gen: (r, d, cfg) => {
      // Lifts only move UP and DOWN. A platform that slid sideways would carry the runner off the song's timeline
      // (world x must stay exactly speed x song time, or the beat grid and the obstacles drift out of sync with the music).
      const kind = 'v';
      return {
        kind,
        k: r.int(1, d > 0.7 ? 3 : d > 0.4 ? 2 : 1),
        ay: r.pick([0.8, 1.0, 1.3]),
        ax: kind === 'h' ? 1.0 : kind === 'c' ? 0.8 : 0,
        yph: kind === 'c' ? Math.PI / 2 : 0,
        beats: r.pick([2, 4]),
        phase: r.int(0, 7) / 8,
        step: r.range(0.1, 0.4),
        by: kind === 'h' ? r.pick([0, 0.3]) : r.pick([0, 0.4, 0.8]),
        gap: r.range(0.1, 0.5),
      };
    },
    build(b, c, P) {
      const x0 = b.snap(c + 1);
      const w = 3.3;
      const gs = x0 + 1.0;
      let cx = gs + 2.4;
      const ps = [];
      for (let i = 0; i < P.k; i++) {
        ps.push({ x: cx, y: P.by, w, h: 0.4, ax: P.ax, ay: P.ay, yph: P.yph, period: P.beats * b.spb, phase: P.phase + i * P.step });
        cx += w + 2.4 + P.gap * 3;
      }
      const ge = cx - 0.2;
      const end = ge + 4;
      b.ground(c, gs);
      b.ground(ge, end);
      for (const p of ps) b.platforms.push(p);
      b.cue(x0, true);
      return end;
    },
  },

  // ---- v6.2 harder cube patterns -----------------------------------------------------------
  // A chain: 2-5 obstacles back to back, each jump taking off on the very next drum hit after the last landing.
  chain: {
    gen(r, d, cfg) {
      const n = r.int(2, Math.max(2, Math.min(cfg.chainMax || 3, 2 + Math.round(d * 3))));
      const kinds = ['s1', 's2', 'gap', 's1', 's2'];
      if (d > 0.45) kinds.push('s3', 'saw', 'gap');
      if (d > 0.7) kinds.push('s3', 'bigsaw', 'widegap');
      return { units: Array.from({ length: n }, () => ({ k: r.pick(kinds), gf: r.range(0.42, 0.58) + 0.18 * d })) };
    },
    build(b, c, P) {
      const A = b.A;
      let land = c, first = true, groundFrom = c;
      for (const u of P.units) {
        const x0 = b.snap(land + (first ? 1 : 0.12));
        const jc = x0 + PW / 2 + A / 2;
        if (u.k === 'gap' || u.k === 'widegap') {
          const gw = Math.min(0.92, u.gf * (u.k === 'widegap' ? 1.25 : 1)) * A;
          b.ground(groundFrom, jc - gw / 2);
          groundFrom = jc + gw / 2;
        } else if (u.k === 'saw' || u.k === 'bigsaw') {
          const rr = u.k === 'bigsaw' ? 0.85 : 0.6;
          b.saws.push({ cx: jc, cy: rr - 0.05, r: rr, ax: 0, ay: 0, period: 1, phase: 0 });
        } else {
          const n = u.k === 's3' ? 3 : u.k === 's2' ? 2 : 1;
          b.spike(jc - n / 2, n);
        }
        b.cue(x0, !first);
        land = x0 + A;
        first = false;
      }
      const end = land + b.tail;
      b.ground(groundFrom, end);
      return end;
    },
  },
  // Jump onto a block, then jump the spike(s) on top of it on the next hit, then drop off the far end (sometimes into spikes).
  blockspike: {
    gen(r, d) { return { h: r.pick(d > 0.5 ? [1, 2, 2] : [1, 1, 2]), n: r.int(1, d > 0.6 ? 2 : 1), off: r.range(0.3, 1.2), tailSpike: d > 0.55 && r() < 0.5 }; },
    build(b, c, P) {
      const A = b.A, S = b.S;
      const x0 = b.snap(c + 1);
      const bx = x0 + PW + S * b.tHeight(P.h) + P.off;           // block starts where the rising jump clears its corner
      const tl = (JUMP_V + Math.sqrt(JUMP_V * JUMP_V - 2 * G * P.h)) / G; // time to come down onto the block top
      const landX = Math.max(bx, x0 + S * tl);
      const x1 = b.snap(landX + 0.15);                            // second take-off, from the block top
      const jc = x1 + PW / 2 + A / 2;
      const bEnd = jc + A / 2 + 1.2;
      b.ground(c, bEnd + 3 + A);
      b.block(bx, bEnd - bx, 0, P.h);
      b.spikes.push(...Array.from({ length: P.n }, (_, i) => ({ x: jc - P.n / 2 + i, y: P.h })));
      if (P.tailSpike) b.spike(bEnd + 0.6, 1);                    // a spike waiting where you drop off
      b.cue(x0); b.cue(x1, true);
      return bEnd + 3 + A;
    },
  },

  // ---- multi-route sections ----------------------------------------------------------------
  // A fork: climb a staircase of floating tiles to an AERIAL route (its own tiles, gaps, moving platforms, saws...)
  // or keep running on the GROUND route (its own spikes, saws, blocks...). Both routes rejoin at the same flat landing zone.
  fork: {
    gen(r, d, cfg, prog = 0.5, kind) {
      const W = weightsFor(cfg, prog);
      delete W.blockspike; // the ground route must stay below the high route (a jump from a tall block would reach it)
      const risky = kind === 'secret';
      const da = risky ? Math.min(1, d + 0.3) : d; // v6: the high route that hides a secret coin is harder
      const nG = cfg.id === 1 ? r.int(1, 2) : r.int(2, 3);
      const ground = [];
      for (let i = 0; i < nG; i++) {
        const name = pickWeighted(r, W);
        ground.push({ name, P: PATTERNS[name].gen(r, d, cfg) });
      }
      const aerial = [];
      for (let i = 0; i < 7; i++) aerial.push(genAerialUnit(r, da, cfg, risky ? Math.max(prog, 0.7) : prog));
      const portal = () => (r() < cfg.portalChance * 0.85 ? r.pick(['flip', 'mirror']) : null);
      return {
        stepH: r.pick([1.7, 1.8]),
        // stair geometry scales with the flat-jump DISTANCE, so it stays correct whenever the physics are retuned
        gaps: [r.range(0.26, 0.39) * jumpDist(cfg), r.range(0.26, 0.39) * jumpDist(cfg), r.range(0.26, 0.39) * jumpDist(cfg)],
        w: r.range(0.55, 0.65) * jumpDist(cfg),
        ground, aerial,
        orb: r() < cfg.orbChance,
        gz: portal(), az: portal(),
        secret: risky,
      };
    },
    build(b, c, P) {
      const A = b.A, TH = 0.5;
      const xo = P.anchor != null && P.anchor >= c + 1 - 1e-6 ? P.anchor : b.snapBar(c + 1);
      if (P.orb) b.orbs.push({ x: xo + 2, y: 2.1 });
      // entry staircase (floating tiles above flat, hazard-free ground)
      const m0 = b.mark();
      let x = xo + 6;
      for (let k = 0; k < 3; k++) {
        const top = (k + 1) * P.stepH;
        b.block(x, P.w, top - TH, top);
        x += P.w + (k < 2 ? P.gaps[k] : 0);
      }
      const xe = x; // end of the last stair tile
      b.tag(m0, 'e');
      const xs = xe + 1.0;
      const xa = xe + P.gaps[2];
      const Ha = 4 * P.stepH;
      const lead = P.gz ? portalLead(b) : 0;
      b.ground(c, xs + lead);
      // ground route
      const mg = b.mark();
      if (P.gz) b.portal(xs + 0.3, -5, 4.6, orientBit(P.gz), P.gz);
      let cc = xs + lead;
      for (const g of P.ground) cc = PATTERNS[g.name].build(b, cc, g.P);
      const xgEnd = cc;
      b.tag(mg, 'g');
      // aerial route
      const ma = b.mark();
      let ax = xa, top = Ha;
      const aLead = Math.max(0.55 * b.S, P.az ? portalLead(b) + 2 : 0);
      b.block(ax, aLead, top - TH, top);
      ax += aLead;
      if (P.az) b.portal(xa + 1.5, 5.2, 40, orientBit(P.az), P.az);
      const target = xgEnd + 2;
      for (const u of P.aerial) {
        if (ax >= target) break;
        const o = buildAerial(b, u, ax, top, Ha);
        ax = o.ax; top = o.top;
      }
      if (ax < target) { b.block(ax + 1.0, target - ax + 2, top - TH, top); ax = target + 3; }
      b.tag(ma, 'a');
      // v6: a secret coin floats over the middle of the risky high route. Its pick-up is a tall column, so every
      // runner on the high route collects it and no runner on the ground route can.
      if (P.secret) { const sx = (xa + ax) / 2; b.secrets.push({ x: sx, y0: Ha - 1.3, y1: Ha + 6.2, cy: Ha + 1.5 }); }
      // the sky route's closing ring sits far enough back that the flip finishes before the drop to the rejoin
      if (P.az) { b.block(ax, portalLead(b), top - TH, top); b.portal(ax + 1.0, 5.2, 40, 0, P.az); ax += portalLead(b); }
      // rejoin: flat landing zone for both routes
      const end = Math.max(xgEnd + (P.gz ? portalLead(b) + 2 : 2), ax + b.S * 0.55 + A + 3);
      b.ground(xgEnd, end);
      if (P.gz) b.portal(xgEnd + 0.5, -5, 4.6, 0, P.gz);
      b.fork = { xs, xa, xgEnd, ax, Ha, end };
      b.cue(xo, true);
      return end;
    },
  },
  // v6 mode sections. A "zone" set-piece is now one of: ship (fly), wave, grav (gravity flips).
  // (The old visual flip/mirror zones are still supported for 'flip' / 'mirror' kinds.)
  zone: {
    gen(r, d, cfg, prog = 0.5, kind = 'flip') {
      if (kind === 'ship' || kind === 'wave' || kind === 'shipwave' || kind === 'waveship') return PATTERNS.flyer.gen(r, d, cfg, prog, kind);
      if (kind === 'grav') return PATTERNS.gravity.gen(r, d, cfg, prog, kind);
      const names = ['single', 'double', 'gap', 'block', 'stairs', 'floatbar', 'saw'];
      if (cfg.id >= 2) names.push('movesaw', 'spinner', 'pulse');
      const n = r.int(2, 3);
      const inner = [];
      for (let i = 0; i < n; i++) { const name = r.pick(names); inner.push({ name, P: PATTERNS[name].gen(r, d, cfg) }); }
      return { kind, inner };
    },
    build(b, c, P) {
      if (P.kind === 'ship' || P.kind === 'wave' || P.kind === 'shipwave' || P.kind === 'waveship') return PATTERNS.flyer.build(b, c, P);
      if (P.kind === 'grav') return PATTERNS.gravity.build(b, c, P);
      const anchored = P.anchor != null && P.anchor >= c + 1 - 1e-6;
      const x0 = anchored ? P.anchor : b.snapBar(c + 1);
      const pre = Math.max(1.5 * b.tpb, portalLead(b) + 3);
      b.ground(c, x0 + pre);
      b.portal(x0 + (anchored ? 0.05 : 0.5 * b.tpb), -5, 40, orientBit(P.kind), P.kind); // anchored: the flip starts ON the drop
      let cc = x0 + pre;
      for (const g of P.inner) cc = PATTERNS[g.name].build(b, cc, g.P);
      b.ground(cc, cc + pre);
      b.portal(cc + 0.5 * b.tpb, -5, 40, 0, P.kind);
      b.cue(x0, true);
      return cc + pre;
    },
  },

  // ---- v6: FLY (ship) and WAVE sections -------------------------------------------------------
  // A corridor between the ground and a ceiling, entered through a mode portal on the drop's first beat.
  // How it is built so it is always fair AND on the music:
  //   1. A "ghost" flies the corridor with the real physics, pressing/releasing ONLY on the song's hits.
  //   2. The ghost is flown again with every press/release early and late by a human-sized amount.
  //   3. Spiked pillars are placed on the beats, leaving a gap around all those ghost paths plus clearance.
  // So the gaps line up with the music and there is room for imperfect timing.
  flyer: {
    // kinds: 'ship', 'wave', or a combo that switches mode half-way on a bar line: 'shipwave', 'waveship'
    gen(r, d, cfg, prog, kind) {
      const tier = cfg.tier || 'medium';
      const shipB = ({ easy: 24, medium: 28, hard: 32 })[tier], waveB = ({ easy: 16, medium: 20, hard: 24 })[tier];
      const beats = kind === 'ship' ? shipB : kind === 'wave' ? waveB : Math.round((shipB + waveB) / 2 / 4) * 4 + 8;
      return { kind, beats, seed: r.int(1, 2e9), d };
    },
    build(b, c, P) {
      const cfg = b.cfg, S = b.S, tpb = b.tpb;
      const r = rngFrom(P.seed);
      const tier = cfg.tier || 'medium';
      const CH = 9;                                  // ceiling height (bottom of the ceiling)
      const anchored = P.anchor != null && P.anchor >= c + 1 - 1e-6;
      const x0 = anchored ? P.anchor : b.snapBar(c + 1);
      const xEnd = x0 + P.beats * tpb;
      // segments: one mode for the whole corridor, or two (the switch sits on a bar line half-way)
      const first = P.kind === 'wave' || P.kind === 'waveship' ? MODE.WAVE : MODE.SHIP;
      const combo = P.kind === 'shipwave' || P.kind === 'waveship';
      const xMid = combo ? b.snapBar(x0 + (P.beats / 2 - 1) * tpb) : Infinity;
      const segs = combo ? [{ x0, x1: xMid, mode: first }, { x0: xMid, x1: xEnd, mode: first === MODE.SHIP ? MODE.WAVE : MODE.SHIP }] : [{ x0, x1: xEnd, mode: first }];
      const modeAt = (x) => (x >= xMid ? segs[1].mode : segs[0].mode);
      const isWave = (x) => modeAt(x) === MODE.WAVE;
      // timing slack a human gets on every press and release, and the clearance around the ghost paths
      const slackOf = (m) => ({ easy: 0.085, medium: 0.065, hard: 0.05 })[tier] * (m === MODE.WAVE ? 0.8 : 1);
      const clearOf = (m) => (m === MODE.WAVE ? ({ easy: 0.75, medium: 0.6, hard: 0.48 })[tier] : ({ easy: 1.15, medium: 0.9, hard: 0.7 })[tier]);
      // the hits the ghost may press or release on (the song's own drum hits)
      const ct = tier === 'easy' ? 'medium' : tier;
      const hits = cueXsFor(cfg.song || 'drop', ct, S).filter((x) => x > x0 + 0.4 * tpb && x < xEnd - 1.6 * tpb && Math.abs(x - xMid) > 0.6 * tpb);
      if (!b.map) { for (let x = x0 + tpb; x < xEnd - 1.6 * tpb; x += tpb / 2) hits.push(x); }
      const mports = segs.map((sg) => ({ x: sg.x0, mode: sg.mode }));
      const mkLevel = () => finalizeLevel({ speed: S, solids: [{ x: x0 - 40, w: xEnd - x0 + 80, y0: -12, y1: 0 }, { x: x0 - 1, w: xEnd - x0, y0: CH, y1: CH + 4 }],
        spikes: [], saws: [], spinners: [], pulses: [], platforms: [], coins: [], checkpoints: [], orbs: [], portals: [], secrets: [],
        mports: mports.map((m) => Object.assign({}, m)), finishX: xEnd + 200 });
      // ---- 1. the ghost plans its route, pressing / releasing only on hits
      const toggles = [];
      {
        const L = mkLevel();
        const p = newPlayer(L);
        p.x = x0 - 1.2; p.t = p.x / S;
        const lo = 1.3, hi = CH - PH - 1.3, mid = (lo + hi) / 2;
        let target = mid + r.range(-1, 1.5), hold = false, lastX = -1e9, hi_i = 0;
        while (p.x < xEnd) {
          while (hi_i < hits.length && hits[hi_i] <= p.x + 1e-9) {
            const hx = hits[hi_i++];
            const wv = isWave(hx);
            if (hx - lastX < (wv ? 0.13 : 0.22) * S) continue;   // never ask for two inputs closer than this
            let want;
            if (wv) want = p.y < lo + 0.3 ? true : p.y > hi - 0.3 ? false : (r() < 0.7 ? !hold : hold);
            else { if (r() < 0.55) target = r.pick([lo + 0.5, mid - 1, mid + 1, hi - 0.5]); want = p.y + p.vy * 0.12 < target; }
            if (want !== hold) { hold = want; lastX = hx; toggles.push({ t: hx / S, hold }); }
          }
          p.hold = hold;
          step(L, p, DT, false);
        }
      }
      // ---- 2. the same plan with every input early and late (by that mode's human slack)
      const ghost = (shiftOf) => {
        const L = mkLevel(), p = newPlayer(L);
        p.x = x0 - 1.2; p.t = p.x / S;
        const tg = toggles.map((q) => ({ t: q.t + shiftOf(q.t * S), hold: q.hold })).sort((a, z) => a.t - z.t);
        const path = []; let ti = 0;
        while (p.x < xEnd && !p.dead) {
          while (ti < tg.length && p.t >= tg[ti].t) { p.hold = tg[ti].hold; ti++; }
          step(L, p, DT, false);
          path.push(p.x, p.y);
        }
        return path;
      };
      const paths = [ghost(() => 0), ghost((x) => -slackOf(modeAt(x))), ghost((x) => slackOf(modeAt(x)))];
      const env = (xa, xb) => {
        let mn = 1e9, mx = -1e9;
        for (const path of paths) for (let i = 0; i < path.length; i += 2) {
          const x = path[i];
          if (x + PW < xa || x > xb) continue;
          const y = path[i + 1];
          if (y < mn) mn = y; if (y + PH > mx) mx = y + PH;
        }
        return [mn, mx];
      };
      // ---- 3. build: ground, ceiling, portals, spiked pillars on the beat (every half beat for the wave)
      const land = S * Math.sqrt((2 * CH) / G) + 2 * tpb;  // falling back to the ground after the exit portal
      const end = xEnd + land;
      b.ground(c, end);
      b.block(x0 - 1, xEnd - x0, CH, CH + 4);
      for (const m of mports) b.mport(m.x, m.mode);
      b.mport(xEnd, MODE.CUBE, 1);
      b.sections.push({ x0, x1: xEnd, kind: P.kind, ceil: CH, segs: segs.map((sg) => ({ x0: sg.x0, x1: sg.x1, kind: sg.mode === MODE.WAVE ? 'wave' : 'ship' })) });
      for (let gx = Math.ceil((x0 + 1.4 * tpb) / (tpb / 2)) * (tpb / 2); gx < xEnd - 1.4 * tpb; gx += tpb / 2) {
        const wv = isWave(gx);
        if (!wv && Math.abs(gx / tpb - Math.round(gx / tpb)) > 1e-6) continue; // ship: one pillar per beat
        if (Math.abs(gx - xMid) < 1.2 * tpb) continue;                         // room to change mode
        const clear = clearOf(modeAt(gx));
        const [mn, mx] = env(gx - 0.05, gx + 1.05);
        if (mn > 1e8) continue;
        const hb = mn - clear;          // tip of the bottom obstacle
        const ht = mx + clear;          // tip of the top obstacle
        if (hb >= 0.6) { if (hb - 0.6 > 0.05) b.block(gx, 1, 0, hb - 0.6); b.spikes.push({ x: gx, y: hb - 0.6 }); }
        if (CH - ht >= 0.6) { if (CH - (ht + 0.6) > 0.05) b.block(gx, 1, ht + 0.6, CH); b.hspike(gx, ht + 0.6); }
      }
      b.cue(x0, true);
      if (combo) b.cue(xMid, true);
      const tierSet = new Set(cueXsFor(cfg.song || 'drop', tier, S).map((x) => Math.round(x * 1000)));
      for (const q of toggles) if (tierSet.has(Math.round(q.t * S * 1000))) b.cue(q.t * S, !q.hold);
      return end;
    },
  },

  // ---- v6: GRAVITY section ---------------------------------------------------------------------
  // A gravity portal on the drop flips gravity: the runner falls UP onto a ceiling and runs upside down, where jumps go
  // downward. Gravity flips back and forth on the beat between stretches on the ceiling and on the floor.
  gravity: {
    gen(r, d, cfg) {
      const nLegs = cfg.tier === 'easy' ? 3 : 5;
      const legs = [];
      const ceilUnits = ['cspike', 'cspike', 'cgap', 'cblock'];
      const floorUnits = ['single', 'double', 'gap'];
      if (d > 0.5) ceilUnits.push('cspike2', 'cgap');
      if (d > 0.7) floorUnits.push('triple');
      for (let i = 0; i < nLegs; i++) {
        const ceil = i % 2 === 0;
        const n = cfg.tier === 'hard' ? (ceil ? 2 : 1) : r.int(1, 2);
        const units = [];
        for (let k = 0; k < n; k++) {
          const name = r.pick(ceil ? ceilUnits : floorUnits);
          units.push({ name, P: ceil ? { gw: (0.38 + 0.3 * d) + r.range(-0.04, 0.04), h: 1, bw: r.range(2.5, 3.6), off: r.range(0.3, 1.2) } : PATTERNS[name].gen(r, d, cfg) });
        }
        legs.push({ ceil, units });
      }
      if (legs.length % 2 === 0) legs.push({ ceil: true, units: [{ name: 'cspike', P: {} }] }); // always end on the ceiling, then flip home
      return { kind: 'grav', legs };
    },
    build(b, c, P) {
      const S = b.S, tpb = b.tpb, A = b.A, CHg = 6;
      const anchored = P.anchor != null && P.anchor >= c + 1 - 1e-6;
      const x0 = anchored ? P.anchor : b.snapBar(c + 1);
      const flipRoom = S * Math.sqrt((2 * (CHg - PH)) / G) + 1.2 * tpb; // fall up (or down) and settle
      const ceil = (xa, xb) => { if (xb > xa) b.block(xa, xb - xa, CHg, CHg + 4); };
      b.ground(c, x0 + flipRoom);
      b.mport(x0, MODE.CUBE, -1);
      ceil(x0 - 1, x0 + flipRoom);
      let cc = x0 + flipRoom;
      for (let li = 0; li < P.legs.length; li++) {
        const leg = P.legs[li];
        const legStart = cc;
        if (leg.ceil) {
          for (const u of leg.units) {
            const xj = b.snap(cc + 1);
            const jc = xj + PW / 2 + A / 2;
            if (u.name === 'cspike' || u.name === 'cspike2') {
              const n = u.name === 'cspike2' ? 2 : 1;
              const e = xj + A + b.tail;
              ceil(cc, e);
              for (let i = 0; i < n; i++) b.hspike(jc - n / 2 + i, CHg);
              b.cue(xj, n > 1); cc = e;
            } else if (u.name === 'cgap') {
              const gw = u.P.gw * A, gs = jc - gw / 2, ge = jc + gw / 2, e = ge + A / 2 + b.tail;
              ceil(cc, gs); ceil(ge, e);
              b.cue(xj, true); cc = e;
            } else {
              const bx = xj + PW + S * b.tHeight(1) + u.P.off, e = bx + u.P.bw + 3;
              ceil(cc, e);
              b.block(bx, u.P.bw, CHg - 1, CHg);
              b.cue(xj); cc = e;
            }
          }
          b.ground(legStart, cc);
        } else {
          for (const u of leg.units) cc = PATTERNS[u.name].build(b, cc, u.P);
          ceil(legStart, cc);
        }
        // flip on the next hit: down to the floor after a ceiling leg, back up after a floor leg (or home at the end)
        const xg = b.snap(cc + 1);
        const toCeil = !leg.ceil;
        b.ground(cc, xg + flipRoom);
        ceil(cc, xg + (toCeil ? flipRoom : 1));
        b.mport(xg, MODE.CUBE, toCeil ? -1 : 1);
        b.cue(xg, true);
        cc = xg + flipRoom;
      }
      b.sections.push({ x0, x1: cc, kind: 'grav', ceil: CHg });
      b.cue(x0, true);
      return cc;
    },
  },
};

const orientBit = (k) => (k === 'flip' ? ORIENT.FLIP : ORIENT.MIRROR);

function genAerialUnit(r, d, cfg, prog = 0.5) {
  const kinds = ['gap', 'gap', 'step', 'step', 'spike', 'saw'];
  if (prog >= cfg.platFrom) kinds.push('plat');
  if (cfg.id >= 2) kinds.push('msaw', 'plat');
  if (cfg.id >= 3) kinds.push('spinner', 'plat');
  const kind = r.pick(kinds);
  const u = { kind };
  if (kind === 'gap') { u.gf = r.range(0.3, 0.35 + 0.35 * d); u.w = r.range(3.6, 5.5); }
  else if (kind === 'step') { u.gf = r.range(0.15, 0.4); u.dy = r.pick([-0.6, -0.4, 0.4, 0.6]); u.w = r.range(3.6, 5); }
  else if (kind === 'spike') { u.gf = r.range(0.15, 0.3); u.n = r.int(1, d > 0.6 ? 2 : 1); }
  else if (kind === 'saw') { u.gf = r.range(0.15, 0.3); u.r = r.range(0.5, 0.7); }
  else if (kind === 'msaw') { u.gf = 0.2; u.cy = r.range(1.3, 2.0); u.ay = r.range(0.8, 1.4); u.beats = r.pick([2, 4]); u.phase = r.pick(QUARTERS); u.r = r.range(0.45, 0.6); }
  else if (kind === 'spinner') { u.gf = 0.2; u.cy = r.range(2.2, 3.0); u.len = r.range(1.3, 1.8); u.beats = r.pick(cfg.id >= 3 ? [2, 4, 4] : [4, 4, 8]); u.phase = r.pick(QUARTERS); }
  else if (kind === 'plat') {
    u.pk = 'v'; u.k = r.int(1, d > 0.6 ? 3 : 2);
    u.ay = u.pk === 'v' ? r.pick([0.8, 1.0]) : u.pk === 'c' ? 0.8 : 0;
    u.ax = u.pk === 'h' ? 1.0 : u.pk === 'c' ? 0.8 : 0;
    u.yph = u.pk === 'c' ? Math.PI / 2 : 0;
    u.beats = r.pick([2, 4]); u.phase = r.int(0, 7) / 8; u.step = r.range(0.1, 0.4);
    u.by = r.pick([0.8, 1.2]); u.gap = r.range(0.1, 0.5);
  }
  return u;
}

// Build one aerial unit starting where the previous tile ended (ax, at height `top`). Returns { ax, top } at the end.
function buildAerial(b, u, ax, top, Ha) {
  const A = b.A, TH = 0.5;
  const tile = (x, w, t) => b.block(x, w, t - TH, t);
  if (u.kind === 'plat') {
    tile(ax, 1.0, top);
    const gs = ax + 1.0;
    let cx = gs + 2.4;
    for (let i = 0; i < u.k; i++) {
      b.platforms.push({ x: cx, y: top + u.by, w: 3.3, h: 0.4, ax: u.ax, ay: u.ay, yph: u.yph, period: u.beats * b.spb, phase: u.phase + i * u.step });
      cx += 3.3 + 2.4 + u.gap * 3;
    }
    const ge = cx - 0.2;
    tile(ge, 4.5, top);
    return { ax: ge + 4.5, top };
  }
  const x = ax + (u.gf || 0.2) * A;
  if (u.kind === 'gap') { tile(x, u.w, top); return { ax: x + u.w, top }; }
  if (u.kind === 'step') {
    const nt = Math.max(Ha - 0.6, Math.min(Ha + 0.6, top + u.dy));
    tile(x, u.w, nt);
    return { ax: x + u.w, top: nt };
  }
  const jc = x + 1.5 + PW / 2 + A / 2;
  if (u.kind === 'spike') {
    const w = 1.5 + A + 2.5 + u.n;
    tile(x, w, top);
    for (let i = 0; i < u.n; i++) b.spikes.push({ x: jc - u.n / 2 + i, y: top });
    return { ax: x + w, top };
  }
  if (u.kind === 'saw') {
    const w = A + 4.5;
    tile(x, w, top);
    b.saws.push({ cx: jc, cy: top + u.r - 0.05, r: u.r, ax: 0, ay: 0, period: 1, phase: 0 });
    return { ax: x + w, top };
  }
  if (u.kind === 'msaw') {
    const w = A + 7;
    tile(x, w, top);
    b.saws.push({ cx: jc + 1, cy: top + u.cy, r: u.r, ax: 0, ay: u.ay, period: u.beats * b.spb, phase: u.phase });
    return { ax: x + w, top };
  }
  // spinner
  const w = A + 6;
  tile(x, w, top);
  b.spinners.push({ cx: jc + 1.5, cy: top + u.cy, len: u.len, ang0: 0, period: u.beats * b.spb, phase: u.phase });
  return { ax: x + w, top };
}

function weightsFor(cfg, prog, eff = prog, kind = 'groove') {
  const W = {};
  const add = (k, w) => (W[k] = (W[k] || 0) + w);
  // `eff` (progress blended with the music's intensity) picks the mix; `prog` (true progress) gates when a hazard may first appear
  const pg = prog; prog = eff;
  // v6.2: much harder from the very start. Chains of back-to-back jumps are the backbone; singles are rare.
  if (prog < 0.25) { add('chain', 6); add('double', 3); add('gap', 3); add('blockspike', 2); add('single', 1); add('block', 1); add('saw', 2); }
  else if (prog < 0.5) { add('chain', 8); add('double', 2); add('triple', 2); add('gap', 3); add('blockspike', 3); add('stairs', 1); add('saw', 2); add('floatbar', 1); }
  else if (prog < 0.75) { add('chain', 10); add('triple', 3); add('gap', 3); add('blockspike', 4); add('stairs', 1); add('saw', 2); add('floatbar', 1); }
  else { add('chain', 12); add('triple', 3); add('gap', 3); add('blockspike', 4); add('floatbar', 1); add('saw', 2); }
  if (pg >= cfg.platFrom) add('platform', prog < 0.4 ? 3 : 5);
  if (pg >= cfg.movesawFrom) add('movesaw', prog < 0.5 ? 2 : 3);
  if (pg >= cfg.spinnerFrom) add('spinner', 3);
  if (pg >= cfg.pulseFrom) add('pulse', 3);
  if (pg < cfg.tripleFrom) delete W.triple;
  // The music decides the character: drops get the longest chains and timed hazards; calm stretches ease off a little.
  const mul = (k, f) => { if (W[k]) W[k] *= f; };
  if (kind === 'drop') {
    mul('platform', 0.4); mul('stairs', 0.6); mul('floatbar', 0.6); mul('block', 0.6);
    for (const k of ['chain', 'triple', 'gap', 'movesaw', 'spinner', 'pulse', 'blockspike']) mul(k, 1.6);
  } else if (kind !== 'groove') {
    mul('chain', 0.6); mul('triple', 0.6); mul('movesaw', 0.7); mul('spinner', 0.7); mul('pulse', 0.7);
  }
  return W;
}
function pickWeighted(r, W) {
  const ks = Object.keys(W);
  let tot = 0;
  for (const k of ks) tot += W[k];
  let x = r() * tot;
  for (const k of ks) { x -= W[k]; if (x <= 0) return k; }
  return ks[0];
}

// Remove everything that belongs to the given route tags (used to prove each route on its own).
function routeLevel(lv, drop) {
  const keep = (o) => !drop.includes(o.route);
  const cp = (a) => a.filter(keep).map((o) => Object.assign({}, o));
  const n = Object.assign({}, lv, {
    solids: cp(lv.solids), spikes: cp(lv.spikes), saws: cp(lv.saws), spinners: cp(lv.spinners), pulses: cp(lv.pulses), platforms: cp(lv.platforms),
    coins: [], checkpoints: [], orbs: [], portals: [], secrets: [],
    mports: (lv.mports || []).map((o) => Object.assign({}, o)),
  });
  return finalizeLevel(n);
}

// Verify one pattern in isolation at several arrival-time offsets (moving things depend on time).
// A fork is proven three ways: the ground route alone, the aerial route alone, and everything together.
function patternOk(cfg, name, P, c, offs) {
  const sub = new Builder(cfg);
  sub.ground(-60, c);
  const end = PATTERNS[name].build(sub, c, P);
  sub.ground(end, end + 16);
  const lv = assemble(sub, end + 14, cfg);
  const runs = [[lv, c - 9]];
  if (sub.fork) {
    runs.push([routeLevel(lv, ['a']), sub.fork.xs - 2, GROUND_MAX_Y]);
    runs.push([routeLevel(lv, ['g']), c - 9]);
  }
  for (const [L, sx, maxY] of runs) {
    for (const off of offs) {
      const start = newPlayer(L);
      start.x = sx + off;
      start.t = sx / sub.S;
      const res = proveCompletable(L, { margin: cfg.margin, start, pressEvery: cfg.pressEvery, maxY });
      if (!res.ok) return false;
    }
  }
  return true;
}

function assemble(b, finishX, cfg) {
  const lv = {
    id: cfg.id, name: cfg.name, difficulty: cfg.difficulty, speed: b.S, bpm: cfg.bpm, spb: b.spb, tpb: b.tpb, song: cfg.song || null, tier: cfg.tier || null,
    solids: b.solids, spikes: b.spikes, saws: b.saws, spinners: b.spinners, pulses: b.pulses,
    platforms: b.platforms, coins: b.coins, checkpoints: b.checkpoints, cues: b.cues, orbs: b.orbs, portals: b.portals,
    mports: b.mports, secrets: b.secrets, sections: b.sections,
    finishX, length: finishX,
  };
  return finalizeLevel(lv);
}

export function generateLevel(cfgIn, seedOffset = 0) {
  const cfg = Object.assign({}, cfgIn);
  const r = rngFrom(cfg.seed + seedOffset * 1009);
  const b = new Builder(cfg);
  const tpb = b.tpb;
  const map = b.map;
  const finishX = cfg.beats * tpb;
  b.ground(-60, 18);
  let c = 18;
  // ---- musical landmarks: bar lines, calm bars (good places to stop for a question) and drops (good places for set-pieces)
  const kindOfBeat = (beat) => (map ? map.kindAtBeat(beat) : 'groove');
  const barStarts = map ? map.barBeats().map((bt) => ({ beat: bt, x: bt * tpb, kind: kindOfBeat(bt) })) : [];
  const nearest = (list, x, used, minGap, lo, hi) => {
    let best = null;
    for (const it of list) {
      if (it.x < lo || it.x > hi) continue;
      if (used.some((u) => Math.abs(u - it.x) < minGap)) continue;
      if (!best || Math.abs(it.x - x) < Math.abs(best.x - x)) best = it;
    }
    return best;
  };
  const usedCoin = [], usedAnchor = [];
  const zones = [];
  const coinAnchors = [];
  // ---- v6.1 planning order: (1) mode sections claim the drops, (2) coin gates fill calm stretches between them,
  // (3) forks go where there is room left. Each set-piece reserves exactly its own measured length.
  const isSectionStart = (q) => map.sections.some((sc) => sc.beat === q.beat && sc.kind !== 'intro' && sc.kind !== 'outro');
  const SPAN = { zone: ({ easy: 30, medium: 38, hard: 44 })[cfg.tier] || 36, fork: 32 };
  const coinClear = (x, span) => !coinAnchors.some((u) => u > x - 8 * tpb && u < x + span + 2 * tpb);
  const pickAnchor = (at, type, spanBeats = SPAN[type], anyBar = false) => {
    const win = (anyBar ? 90 : type === 'zone' ? 60 : 35) * tpb, span = spanBeats * tpb;
    let best = null, bs = 1e18;
    for (const q of barStarts) {
      // mode sections may start right after the intro (forks still wait until the level is under way)
      if (q.x < (type === 'zone' ? 10 * tpb : 0.18 * finishX) || q.x + span > finishX - 8 * tpb || q.x > (type === 'zone' ? 0.92 : 0.84) * finishX || Math.abs(q.x - at) > win) continue;
      if (usedAnchor.some((u) => q.x + span + 2 * tpb > u.x && q.x < u.x + u.span + 2 * tpb)) continue; // no overlap with another set-piece
      if (!coinClear(q.x, span)) continue;                                                              // must finish before the next coin gate
      const isDrop = map.drops.includes(q.beat), isSec = isDrop || isSectionStart(q);
      if (!isSec && !anyBar) continue;
      // mode sections really want a drop (the rules change as the bass comes in); forks are happy on any new section.
      // Where the song has no drop nearby, any bar line will do (second pass).
      const sc = Math.abs(q.x - at) + (isDrop ? 0 : isSec ? (type === 'zone' ? 40 : 12) * tpb : 20 * tpb);
      if (sc < bs) { bs = sc; best = q; }
    }
    if (!best && !anyBar) return pickAnchor(at, type, spanBeats, true);
    return best;
  };
  // measure a set-piece's real length once (a dry build), so the plan reserves exactly that much room
  // (+3 beats: the flat beat after it, the gap the scheduler keeps before a coin gate, and a little slack)
  const measure = (type, P) => { const dry = new Builder(cfg); const c0 = dry.snapBar(200 * tpb); P = Object.assign({}, P, { anchor: c0 }); return (PATTERNS[type].build(dry, c0 - 1, P) - c0) / tpb + 3; };
  const setPiece = (type, at, kind) => {
    const z = { type, kind, at };
    if (map) {
      let span = SPAN[type];
      if (type === 'zone') { z.P0 = PATTERNS.zone.gen(r, Math.min(1, 0.8 * cfg.diff), cfg, at / finishX, kind); span = measure('zone', z.P0); }
      z.span = span;
      const pick = pickAnchor(at, type, span);
      if (pick) { z.anchorX = pick.x; z.at = pick.x - 3; usedAnchor.push({ x: pick.x, span: span * tpb }); }
    }
    zones.push(z);
  };
  // (1) mode sections: the first right after the intro, the rest spread to the end
  for (let i = 0; i < (cfg.zones || 0); i++) setPiece('zone', (0.03 + (0.86 * i) / Math.max(1, cfg.zones - 1)) * finishX, cfg.zoneKinds[i % cfg.zoneKinds.length]);
  // (2) coin gates (mandatory trivia). A question pauses the music, so a gate goes in a calm part of the song if one is
  // near its spot, otherwise a "groove" bar, never in a drop and never inside a mode section. Spread over the level.
  const inSetPiece = (x) => usedAnchor.some((u) => x > u.x - 6 * tpb && x < u.x + u.span + 1 * tpb);
  for (let i = 0; i < cfg.coins; i++) {
    const at = (0.14 + (0.74 * i) / Math.max(1, cfg.coins - 1)) * finishX;
    const z = { type: 'coin', at };
    if (map) {
      const lo = 12 * tpb, hi = finishX - 30 * tpb;
      let best = null, bs = 1e18;
      for (const pass of [0, 1]) {
        for (const q of barStarts) {
          if (q.kind === 'outro' || q.x < lo || q.x > hi) continue;
          if (pass === 0 && (q.kind === 'drop' || map.kindAtBeat(q.beat + 3) === 'drop')) continue; // the whole bar out of the drop
          if (inSetPiece(q.x)) continue;
          if (usedCoin.some((u) => Math.abs(u - q.x) < 16 * tpb)) continue;
          let pen = q.kind === 'groove' ? 6 * tpb : 0;                              // a calm bar is worth a 6-beat detour
          if (map.drops.some((d) => d > q.beat && d <= q.beat + 8)) pen += 10 * tpb; // keep the bar before a drop free
          const sc = Math.abs(q.x - at) + pen;
          if (sc < bs) { bs = sc; best = q; }
        }
        if (best) break; // (pass 1 only if nothing calm was left: then a drop bar is better than no gate)
      }
      if (best) { z.anchorX = best.x; z.at = best.x - 3; usedCoin.push(best.x); coinAnchors.push(best.x); }
    }
    zones.push(z);
  }
  // (3) forks: up to `secrets` of them (spread out over the level) get a risky high route with a secret coin
  const nF = cfg.forks || 0, nS = Math.min(cfg.secrets || 0, nF);
  // the secret forks come first; any fork after them is a spare that inherits a secret coin if one is crowded out
  const secretIdx = new Set(Array.from({ length: nS }, (_, j) => j));
  for (let i = 0; i < nF; i++) setPiece('fork', (0.22 + (0.60 * (i + 0.5)) / nF) * finishX, secretIdx.has(i) ? 'secret' : undefined);
  [0.25, 0.5, 0.75].forEach((f) => zones.push({ type: 'cp', at: f * finishX }));
  zones.sort((a, z) => a.at - z.at);
  // merge a checkpoint that is very close to a coin zone into one zone (cp first, then coin)
  const afterBeats = Math.ceil((INV_TIME * b.S) / tpb) + 1;
  let zi = 0;
  const stats = { rejected: 0, patterns: 0, acc: {}, rej: {}, anchored: 0 };
  while (c < finishX - 14 * tpb / 4.5 - 20) {
    const prog = c / finishX;
    // effective progress: the level still ramps up overall (60%), but the music steers the moment-to-moment feel (40%)
    const I = b.inten(c);
    const eff = Math.min(1, 0.6 * prog + 0.4 * I);
    if (zi < zones.length && zones[zi].at <= c + 2) {
      const z = zones[zi++];
      const z0 = b.snapBar(c + 1);
      if (z.type === 'fork' || z.type === 'zone') {
        // Coin gates are mandatory, so they get first claim on the remaining length. A set-piece is only built if
        // what is left after it still fits every coin and checkpoint still to come; otherwise it is dropped.
        // Without this, long set-pieces can eat the tail of the level and a coin silently goes missing.
        let need = 0;
        for (let j = zi; j < zones.length; j++) need += zones[j].type === 'coin' ? (2 + afterBeats) * tpb + 3 : 3 * tpb + 2;
        const estimate = z.type === 'fork' ? 9 * tpb + 4 * portalLead(b) : 0.8 * SPAN.zone * tpb;
        // a dropped fork hands its secret coin on to the next fork, so the level keeps all of them
        const passSecret = () => { if (z.kind !== 'secret') return; const nf = zones.slice(zi).find((q) => q.type === 'fork' && q.kind !== 'secret'); if (nf) nf.kind = 'secret'; };
        if (c + estimate + need > finishX - 6 * tpb) { stats.skipped = (stats.skipped || 0) + 1; passSecret(); continue; }
        const prog0 = c / finishX, d0 = Math.min(1, eff * 1.15) * cfg.diff;
        const pre = 2 * tpb;
        const anchored = z.anchorX != null && z.anchorX - 1 >= c;
        const cb = anchored ? z.anchorX - 1 : c + pre; // where the set-piece's own build starts
        // a set-piece may not run over the next reserved spot (a coin gate, or another set-piece waiting for its drop)
        const nc = zones.slice(zi).find((q) => q.anchorX != null);
        const coinLimit = nc ? nc.anchorX - 1 : Infinity;
        let built = false, tooLong = 0;
        for (let attempt = 0; attempt < 30; attempt++) {
          const P = attempt === 0 && z.P0 ? Object.assign({}, z.P0) : PATTERNS[z.type].gen(r, d0, cfg, prog0, z.kind);
          if (anchored) P.anchor = z.anchorX;
          if (coinLimit < Infinity && PATTERNS[z.type].build(new Builder(cfg), cb, P) + tpb > coinLimit) { stats.rejected++; tooLong++; continue; }
          if (patternOk(cfg, z.type, P, cb, z.type === 'zone' && P.kind !== 'flip' && P.kind !== 'mirror' ? [0, 1] : [-2, -1, 0, 1, 2])) {
            b.ground(c, cb);
            c = PATTERNS[z.type].build(b, cb, P);
            b.ground(c, c + tpb); c += tpb;
            stats.patterns++; stats.acc[z.type] = (stats.acc[z.type] || 0) + 1;
            if (anchored) stats.anchored++;
            built = true;
            break;
          }
          stats.rejected++; stats.rej[z.type] = (stats.rej[z.type] || 0) + 1;
        }
        // Didn't fit before the next coin gate: move it to just after that coin (on the next free drop if there is one)
        // instead of losing it. Each set-piece may move up to 6 times.
        if (!built && tooLong && nc && (z.moved || 0) < 6) {
          const after = nc.anchorX + (nc.type === 'coin' ? 3 + afterBeats : SPAN[nc.type] || 24) * tpb;
          if (z.anchorX != null) { const k = usedAnchor.findIndex((u) => u.x === z.anchorX); if (k >= 0) usedAnchor.splice(k, 1); }
          void 0;
          const pick = map ? pickAnchor(after + 8 * tpb, z.type, z.span || SPAN[z.type]) : null;
          const nz2 = { type: z.type, kind: z.kind, moved: (z.moved || 0) + 1, at: after, P0: z.P0, span: z.span };
          if (pick && pick.x >= after) { nz2.anchorX = pick.x; nz2.at = pick.x - 3; usedAnchor.push({ x: pick.x, span: (z.span || SPAN[z.type]) * tpb }); }
          let j = zi; while (j < zones.length && zones[j].at <= nz2.at) j++;
          zones.splice(j, 0, nz2);
          stats.moved = (stats.moved || 0) + 1;
        } else if (!built) passSecret();
        continue;
      }
      if (z.type === 'cp') {
        b.ground(c, z0 + 3 * tpb);
        b.checkpoints.push({ x: z0 + 1.5 * tpb, y: 0, t: (z0 + 1.5 * tpb) / b.S });
        c = z0 + 3 * tpb;
      } else {
        const coinX = (z.anchorX != null && z.anchorX >= c - 0.01 ? z.anchorX : z0) + 2 * tpb; // two beats into its reserved bar
        b.ground(c, coinX + afterBeats * tpb);
        b.coins.push({ x: coinX });
        c = coinX + afterBeats * tpb;
      }
      continue;
    }
    const kind = map ? map.kindAtBeat(c / tpb) : 'groove';
    const W = weightsFor(cfg, prog, eff, kind);
    const d = Math.min(1, eff * 1.15) * cfg.diff;
    // A set-piece is waiting for its drop: nothing may run past the point where it has to start.
    const nz = zones.slice(zi).find((q) => q.anchorX != null);
    const limit = nz ? nz.anchorX - 1 : Infinity;
    // rest between patterns: more breathing room where the song is calm, none in the drops
    let restBeats = kind === 'calm' || kind === 'intro' ? r.int(0, cfg.tier === 'easy' ? 1 : 0) : 0; // v6.2: no breathers outside the song's quiet parts
    let done = false;
    for (let attempt = 0; attempt < 24 && !done; attempt++) {
      let name = pickWeighted(r, W);
      const P = PATTERNS[name].gen(r, d, cfg);
      const timed = ['platform', 'movesaw', 'spinner', 'pulse'].includes(name);
      const offs = timed ? [-2, -1, 0, 1, 2] : [0];
      if (limit < Infinity) {
        const dry = new Builder(cfg); // would this pattern (plus its rest) spill past the drop?
        if (PATTERNS[name].build(dry, c, P) + restBeats * tpb > limit) { stats.rejected++; continue; }
      }
      if (patternOk(cfg, name, P, c, offs)) {
        const end = PATTERNS[name].build(b, c, P);
        c = end;
        if (restBeats) { b.ground(c, c + restBeats * tpb); c += restBeats * tpb; }
        done = true;
        stats.patterns++;
        stats.acc[name] = (stats.acc[name] || 0) + 1;
      } else { stats.rejected++; stats.rej[name] = (stats.rej[name] || 0) + 1; }
    }
    if (!done && limit < Infinity) {
      // v6.2: the gap before the next reserved spot is too short for a big pattern. Fill it with the longest jump chain
      // (or a single spike) that still fits, instead of flat ground. Only a gap shorter than one jump stays flat.
      const kinds = d > 0.6 ? ['s2', 's1', 's3', 'gap'] : ['s1', 's2', 'gap'];
      for (let n = Math.max(1, cfg.chainMax || 3); n >= 1 && !done; n--) {
        for (let attempt = 0; attempt < 6 && !done; attempt++) {
          const P = { units: Array.from({ length: n }, () => ({ k: r.pick(kinds), gf: r.range(0.42, 0.58) + 0.18 * d })) };
          if (PATTERNS.chain.build(new Builder(cfg), c, P) > limit) continue;
          if (!patternOk(cfg, 'chain', P, c, [0])) { stats.rejected++; continue; }
          c = PATTERNS.chain.build(b, c, P);
          done = true; stats.patterns++; stats.acc.fill = (stats.acc.fill || 0) + 1;
        }
      }
      if (done) continue;
    }
    if (!done) {
      if (limit < Infinity && limit - c < 30) { b.ground(c, limit); c = limit; continue; } // wait for the drop on flat ground
      // always-safe fallback (but never run past a set-piece that is waiting for its drop: wait on flat ground instead)
      const P = PATTERNS.single.gen(r, 0, cfg);
      if (limit < Infinity && PATTERNS.single.build(new Builder(cfg), c, P) > limit) { b.ground(c, limit); c = limit; continue; }
      c = PATTERNS.single.build(b, c, P);
    }
  }
  b.ground(c, finishX + 16);
  const lv = assemble(b, finishX, cfg);
  lv.stats = stats;
  lv.seedUsed = cfg.seed + seedOffset * 1009;
  return lv;
}

// Generate + prove. Re-seeds until the WHOLE level is proven completable (with slack).
export function buildLevel(cfg) {
  for (let s = 0; s < 40; s++) {
    const lv = generateLevel(cfg, s);
    const full = proveCompletable(lv, { margin: cfg.margin * 0.5, pressEvery: cfg.pressEvery });
    // every fork's two routes must each be winnable on their own, end to end (whichever way the player goes)
    const routesOk = full.ok && (!cfg.forks || (
      proveCompletable(routeLevel(lv, ['a']), { margin: cfg.margin * 0.5, pressEvery: cfg.pressEvery, maxY: GROUND_MAX_Y }).ok &&
      proveCompletable(routeLevel(lv, ['g']), { margin: cfg.margin * 0.5, pressEvery: cfg.pressEvery }).ok));
    if (full.ok && routesOk) {
      lv.proof = { ok: true, states: full.states, attempts: s + 1 };
      return lv;
    }
  }
  throw new Error('Could not generate a provably completable level for ' + cfg.name);
}

let cache = {};
export function levelSig(def) {
  const str = GEN_VERSION + JSON.stringify(def) + (def.song ? getBeatMap(def.song).sig : '');
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(16);
}
// The plain-data form of a built level (no lookup tables), for baking into levels.baked.js.
export function serializeLevel(lv) {
  const o = {};
  for (const k of Object.keys(lv)) if (!/^b[A-Z]/.test(k)) o[k] = lv[k];
  return JSON.parse(JSON.stringify(o, (key, v) => (key === '_f' ? undefined : v)));
}
export function getLevel(id) {
  if (!cache[id]) {
    const def = LEVEL_DEFS.find((l) => l.id === id);
    const baked = BAKED.find((b) => b.id === id && b.sig === levelSig(def));
    cache[id] = baked ? finalizeLevel(structuredClone(baked.level)) : buildLevel(def);
    cache[id].fromBake = !!baked;
  }
  return cache[id];
}

// Short guided practice level for the interactive tutorial (not counted in stats or leaderboards).
export function tutorialLevel() {
  const cfg = { id: 0, name: 'Practice Run', difficulty: 'Tutorial', speed: 9, bpm: 120, margin: 0.1, pressEvery: 1 };
  const b = new Builder(cfg);
  const tpb = b.tpb;
  b.ground(-60, 22);
  let c = 22;
  c = PATTERNS.single.build(b, c, { lead: 0 });
  b.ground(c, c + 2 * tpb); c += 2 * tpb;
  c = PATTERNS.gap.build(b, c, { gw: 0.45, lead: 0 });
  const z0 = b.snap(c + 1);
  const coinX = z0 + 2 * tpb;
  b.ground(c, coinX + 6 * tpb);
  b.coins.push({ x: coinX });
  c = coinX + 6 * tpb;
  c = PATTERNS.double.build(b, c, { lead: 0 });
  b.ground(c, c + 2 * tpb); c += 2 * tpb;
  const finishX = c + tpb;
  b.ground(c, finishX + 16);
  const lv = assemble(b, finishX, cfg);
  lv.practice = true;
  return lv;
}

// exposed for tests / diagnostics only
export const __dbg = { PATTERNS, patternOk, routeLevel, Builder, assemble, rngFrom };
