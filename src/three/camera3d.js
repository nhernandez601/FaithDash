// Camera system for the 3D version. Pure maths (no renderer, no DOM), so tests can check it.
//
// The camera is only a picture: it reads where the runner is and never changes the game rules or the controls.
// Each level has a CAMERA SCRIPT: a list of cues placed on song time ("at 12.3 s switch to the drone view over 2 beats").
// The camera position is a pure function of song time, so it stays on the beat, and after a crash it jumps straight
// back to the right view for that moment of the song.
import * as THREE from 'three';
import { wz } from './world3d.js';

// A "look" is a set of numbers. The camera sits `back` tiles behind the runner, `up` tiles above (following the runner's
// height by `follow`), `side` tiles to one side, and looks at a point `ahead` tiles in front of the runner.
export const CHASE_ANGLE = 45; // degrees the chase camera sits off to the side (0 = straight behind)
export const CHASE_DIST = 9;   // how far from the runner the chase camera sits
export const LOOKS = {
  // chase: Noe's three-quarter view, CHASE_ANGLE degrees off to the right of the track, CHASE_DIST tiles from the runner
  chase:  { side: Math.sin(CHASE_ANGLE * Math.PI / 180) * CHASE_DIST, up: 4, back: Math.cos(CHASE_ANGLE * Math.PI / 180) * CHASE_DIST, follow: 0.6, lookUp: 1.0, ahead: 4, lookSide: 0, fov: 62, sway: 0 },
  wide:   { side: 0,    up: 4.2, back: 11.5, follow: 0.7, lookUp: 1.0, ahead: 11, lookSide: 0,    fov: 72, sway: 0 },
  droneR: { side: 5.5,  up: 5.2, back: 7.5,  follow: 0.7, lookUp: 0.8, ahead: 6,  lookSide: -0.5, fov: 62, sway: 0 },
  droneL: { side: -5.5, up: 5.2, back: 7.5,  follow: 0.7, lookUp: 0.8, ahead: 6,  lookSide: 0.5,  fov: 62, sway: 0 },
  high:   { side: 0,    up: 8.5, back: 6.5,  follow: 0.8, lookUp: 0.0, ahead: 7,  lookSide: 0,    fov: 68, sway: 0 },
  pan:    { side: 0,    up: 3.8, back: 9.5,  follow: 0.6, lookUp: 1.2, ahead: 9,  lookSide: 0,    fov: 64, sway: 3.2 }, // sweeps left and right every 8 beats
};
export const SWAY_BEATS = 8;
const KEYS = Object.keys(LOOKS.chase);
const ease = (u) => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };
const blendLooks = (a, b, u) => { const o = {}; for (const k of KEYS) o[k] = a[k] + (b[k] - a[k]) * u; return o; };

// ---- the script ----
// cue: { t: seconds, look: name, blend: seconds }
export function cameraParamsAt(script, t, out = {}) {
  let i = -1;
  for (let j = 0; j < script.length; j++) { if (script[j].t <= t) i = j; else break; }
  const look = (n) => LOOKS[n];
  let r;
  if (i < 0) r = look(script[0] ? script[0].look : 'chase');
  else {
    const c = script[i];
    const from = i > 0 ? look(script[i - 1].look) : look('chase'); // what the camera showed when this cue began (cues never overlap)
    r = blendLooks(from, look(c.look), c.blend > 0 ? ease((t - c.t) / c.blend) : 1);
  }
  for (const k of KEYS) out[k] = r[k];
  return out;
}

// Tier tells how adventurous the camera is: easy = mostly behind the runner, hard = more drone moves and side sweeps.
const TIER = {
  easy:   { first: 24, gap: 40, hold: 6, looks: ['droneR'] },
  medium: { first: 16, gap: 24, hold: 8, looks: ['droneR', 'pan', 'droneL'] },
  hard:   { first: 12, gap: 14, hold: 8, looks: ['droneL', 'pan', 'droneR', 'high'] },
};
// mode: 'script' (the full camera script) or 'easy' (behind the runner; only the fly/gravity sections get the wider view).
export function buildCameraScript(lv, mode = 'script') {
  const spb = lv.spb, tpb = lv.tpb, tier = TIER[lv.tier] || TIER.medium;
  const cues = [{ t: 0, look: 'chase', blend: 0 }];
  const zones = []; // [t0, t1] of mode sections (fly / wave / gravity), where the view is chosen for readability
  for (const s of lv.sections || []) {
    const t0 = s.x0 / lv.speed, t1 = s.x1 / lv.speed;
    zones.push([t0 - 4 * spb, t1 + 3 * spb]);
    const look = s.kind === 'wave' && mode === 'script' && lv.tier !== 'easy' ? 'droneR' : 'wide';
    cues.push({ t: t0 - 2 * spb, look, blend: 2 * spb });
    cues.push({ t: t1, look: 'chase', blend: 2 * spb });
  }
  if (mode === 'script') {
    const total = lv.finishX / lv.speed;
    const hits = (a, b) => zones.some(([z0, z1]) => a < z1 && b > z0);
    // coin gates need a calm view: no moves within a few beats of one
    const coinT = (lv.coins || []).map((c) => c.x / lv.speed);
    let n = 0;
    for (let b = tier.first; b * spb < total - 12 * spb; b += tier.gap + tier.hold) {
      const t0 = b * spb, t1 = (b + tier.hold) * spb;
      if (hits(t0 - 2 * spb, t1 + 2 * spb)) continue;
      if (coinT.some((ct) => ct > t0 - 6 * spb && ct < t1 + 6 * spb)) continue;
      cues.push({ t: t0, look: tier.looks[n++ % tier.looks.length], blend: 2 * spb });
      cues.push({ t: t1, look: 'chase', blend: 2 * spb });
    }
  }
  cues.sort((a, b) => a.t - b.t);
  // a cue may not start before the previous blend has finished: slide it later if needed
  for (let i = 1; i < cues.length; i++) { const need = cues[i - 1].t + cues[i - 1].blend; if (cues[i].t < need) cues[i].t = need; }
  return cues;
}

// ---- where the camera goes ----
// ceilingAt(x): lowest overhead block over the track at distance x (Infinity when open sky). Used so the camera never ends up
// inside a ceiling during gravity and fly sections.
export function ceilingAt(lv, x) {
  for (const s of lv.sections || []) if (x >= s.x0 - 1 && x <= s.x1 + 1) return s.ceil || Infinity;
  return Infinity;
}
const _a = new THREE.Vector3();
// v: runner view {x, y}; beat: song time in beats (for the sway). Writes position and look-at point into out.
export function placeCamera(lv, P, v, beat, out) {
  const sway = P.sway * Math.sin((2 * Math.PI * beat) / SWAY_BEATS);
  const side = P.side + sway;
  let y = v.y * P.follow + P.up;
  const camX = v.x - P.back;
  const ceil = Math.min(ceilingAt(lv, v.x), ceilingAt(lv, camX));
  if (ceil !== Infinity) y = Math.min(y, ceil - 0.8);
  y = Math.max(y, 1.3);
  out.position = out.position || new THREE.Vector3();
  out.look = out.look || new THREE.Vector3();
  out.position.set(side, y, wz(camX));
  out.look.set(P.lookSide - sway * 0.15, v.y + P.lookUp, wz(v.x + P.ahead));
  out.fov = P.fov;
  return out;
}
