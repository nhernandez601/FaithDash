// Builds the 3D world for one level (no renderer, no DOM, so tests can use it too).
// Track coordinates: sim x = distance along the track (drawn along -Z), sim y = height (drawn along Y).
// The sideways "lane" axis (drawn along X) is not used yet, so the runner stays in the middle lane.
import * as THREE from 'three';
import { platPos, sawPos, spinnerAngle, pulseOn, MODE, PW, PH } from '../game/sim.js';

export const TRACK_W = 3; // how wide the track is drawn
export const wz = (x) => -x; // sim x -> world z
export const THEMES = [
  { sky: 0x1c1250, fog: 0x1c1250, top: 0x6a4cff, side: 0x5a46c8, hazard: 0xff4d6d },
  { sky: 0x0e2a3f, fog: 0x0e2a3f, top: 0x2fd0c4, side: 0x2d9ab8, hazard: 0xff7a3d },
  { sky: 0x3a0f22, fog: 0x3a0f22, top: 0xff5a8a, side: 0xc4457a, hazard: 0xb6ff3b },
];
const MCOL = (m) => (m.mode === MODE.SHIP ? 0xff6ad5 : m.mode === MODE.WAVE ? 0x39e6ff : m.grav < 0 ? 0xffd23a : 0x4dff9a);
// Blocks that hang overhead (ceilings, hanging pillars) are drawn see-through with glowing edges, so the camera can look
// through them at the runner. Tests treat them as "not blocking the view".
export const OVERHEAD_Y = 2;
// Tall blocks the runner has already passed would sit between the camera and the runner, so they turn see-through.
// They can't hurt the runner any more, so this never hides anything that matters. Tests use the same rule.
export const FADE_MIN_Y = 1.2;
export const isFaded = (s, runnerX) => s.y1 > FADE_MIN_Y && s.x + s.w <= runnerX + 0.5;
export function fadeBehind(blockers, runnerX) {
  for (const m of blockers) {
    const u = m.userData; if (!u.glassMat) continue;
    const want = isFaded(u.solid, runnerX) ? u.glassMat : u.solidMat;
    if (m.material !== want) m.material = want;
  }
}

export function makePlayer() {
  const g = new THREE.Group();
  const cube = new THREE.Mesh(new THREE.BoxGeometry(PW, PH, PW), new THREE.MeshStandardMaterial({ color: 0xffd23a, emissive: 0xaa7700, emissiveIntensity: 0.5 })); cube.name = 'cube';
  const ship = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.1, 4), new THREE.MeshStandardMaterial({ color: 0xff6ad5, emissive: 0xaa2288, emissiveIntensity: 0.5 })); ship.name = 'ship'; ship.rotation.z = -Math.PI / 2; ship.rotation.y = Math.PI / 4; ship.scale.set(1, 1, 0.55);
  const wave = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 3), new THREE.MeshStandardMaterial({ color: 0x39e6ff, emissive: 0x1188aa, emissiveIntensity: 0.6 })); wave.name = 'wave'; wave.rotation.z = -Math.PI / 2;
  g.add(cube, ship, wave);
  return g;
}

// Adds the whole level to `root`. Returns { dyn, player, blockers } (blockers = the opaque solids, for view tests).
export function buildWorld(lv, root) {
  const th = THEMES[(lv.id - 1) % THEMES.length];
  const dyn = [], blockers = [];
  const mTop = new THREE.MeshStandardMaterial({ color: th.top, roughness: 0.55 });
  const mSide = new THREE.MeshStandardMaterial({ color: th.side, roughness: 0.8 });
  const mGlass = new THREE.MeshStandardMaterial({ color: th.side, roughness: 0.8, transparent: true, opacity: 0.28, depthWrite: false });
  const mEdge = new THREE.LineBasicMaterial({ color: th.top });
  const mHaz = new THREE.MeshStandardMaterial({ color: th.hazard, roughness: 0.4, emissive: th.hazard, emissiveIntensity: 0.35 });
  const mGold = new THREE.MeshStandardMaterial({ color: 0xffd23a, emissive: 0xffa800, emissiveIntensity: 0.6, roughness: 0.3 });
  const box = new THREE.BoxGeometry(1, 1, 1);
  const edges = new THREE.EdgesGeometry(box);
  const cone = new THREE.ConeGeometry(0.34, 0.6, 4); cone.translate(0, 0.3, 0); cone.rotateY(Math.PI / 4);
  const add = (m) => { root.add(m); return m; };

  // terrain and blocks: every solid is a box across the track
  for (const s of lv.solids) {
    const h = s.y1 - s.y0; if (h <= 0 || s.w <= 0) continue;
    const overhead = s.y0 >= OVERHEAD_Y;
    const m = add(new THREE.Mesh(box, overhead ? mGlass : [mSide, mSide, mTop, mSide, mSide, mSide])); // +x,-x,+y(top),-y,+z,-z
    m.scale.set(TRACK_W, h, s.w);
    m.position.set(0, s.y0 + h / 2, wz(s.x + s.w / 2));
    m.userData.solid = s;
    if (overhead) { m.userData.seeThrough = true; const e = new THREE.LineSegments(edges, mEdge); e.scale.copy(m.scale); e.position.copy(m.position); add(e); }
    else { blockers.push(m); if (s.y1 > FADE_MIN_Y) { m.userData.solidMat = m.material; m.userData.glassMat = mGlass; } }
  }
  // side rails so the track reads as a lane, not an empty floor
  const rail = new THREE.MeshStandardMaterial({ color: th.top, emissive: th.top, emissiveIntensity: 0.5 });
  for (const sx of [-1, 1]) { const r = add(new THREE.Mesh(box, rail)); r.scale.set(0.08, 0.08, lv.finishX + 120); r.position.set(sx * (TRACK_W / 2 + 0.05), 0.04, wz((lv.finishX + 60) / 2 - 60)); }
  // spikes (up, or hanging down from a ceiling)
  for (const s of lv.spikes) {
    const m = add(new THREE.Mesh(cone, mHaz));
    m.position.set(0, s.y, wz(s.x + 0.5));
    m.scale.set(1.3, 1, 1.3);
    if (s.down) m.rotation.x = Math.PI;
  }
  // saws (move on paths), spinners (rotate), pulses (blink), platforms (lifts): updated every frame
  for (const s of lv.saws) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(s.r, s.r, 0.25, 12), mHaz); m.rotation.x = Math.PI / 2;
    const g = add(new THREE.Group()); g.add(m); dyn.push({ k: 'saw', o: s, g });
  }
  for (const s of lv.spinners) {
    const g = add(new THREE.Group());
    const bar = new THREE.Mesh(box, mHaz); bar.scale.set(0.3, s.len * 2, 0.3); g.add(bar);
    dyn.push({ k: 'spin', o: s, g });
  }
  for (const s of lv.pulses) {
    const g = add(new THREE.Group());
    for (let i = 0; i < s.n; i++) { const c = new THREE.Mesh(cone, mHaz); c.position.set(0, 0, -(i + 0.5)); c.scale.set(1.3, 1, 1.3); g.add(c); }
    g.position.set(0, s.y, wz(s.x));
    dyn.push({ k: 'pulse', o: s, g });
  }
  for (const pl of lv.platforms) {
    const m = add(new THREE.Mesh(box, [mSide, mSide, mTop, mSide, mSide, mSide])); m.scale.set(TRACK_W, pl.h, pl.w);
    dyn.push({ k: 'plat', o: pl, g: m });
  }
  // coin gates, orbs, mode portals, secret coins, checkpoints, finish
  const gate = new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
  for (const c of lv.coins) {
    const g = add(new THREE.Mesh(new THREE.PlaneGeometry(TRACK_W, 6), gate)); g.position.set(0, 3, wz(c.x));
    const ring = add(new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.14, 8, 24), mGold)); ring.position.set(0, 1.6, wz(c.x));
  }
  for (const o of lv.orbs) { const m = add(new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), new THREE.MeshStandardMaterial({ color: 0x66e0ff, emissive: 0x2299ff, emissiveIntensity: 0.8 }))); m.position.set(0, o.y, wz(o.x)); }
  for (const m of lv.mports) {
    const col = MCOL(m);
    const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false });
    const g = add(new THREE.Mesh(new THREE.PlaneGeometry(TRACK_W, 11), mat)); g.position.set(0, 5.5, wz(m.x));
    const r = add(new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.1, 8, 28), new THREE.MeshBasicMaterial({ color: col }))); r.position.set(0, m.mode === MODE.CUBE && m.grav > 0 ? 1.6 : 3.2, wz(m.x));
  }
  for (const s of lv.secrets) {
    const m = add(new THREE.Mesh(new THREE.OctahedronGeometry(0.55), mGold)); m.position.set(0, s.cy || s.y0 + 2, wz(s.x)); dyn.push({ k: 'secret', o: s, g: m });
  }
  for (const c of lv.checkpoints) {
    const pole = add(new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0x66ffcc }))); pole.scale.set(0.1, 3, 0.1); pole.position.set(TRACK_W / 2, c.y + 1.5, wz(c.x));
  }
  const fin = add(new THREE.Mesh(new THREE.PlaneGeometry(TRACK_W, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide })));
  fin.position.set(0, 4, wz(lv.finishX));
  const player = makePlayer(); root.add(player);
  return { dyn, player, blockers, theme: th };
}

const TMP = { x: 0, y: 0 };
export function updateDynamic(dyn, t, p) {
  for (const d of dyn) {
    if (d.k === 'saw') { sawPos(d.o, t, TMP); d.g.position.set(0, TMP.y, wz(TMP.x)); d.g.children[0].rotation.y = t * 8; }
    else if (d.k === 'spin') { d.g.position.set(0, d.o.cy, wz(d.o.cx)); d.g.rotation.x = spinnerAngle(d.o, t); }
    else if (d.k === 'pulse') d.g.visible = pulseOn(d.o, t);
    else if (d.k === 'plat') { platPos(d.o, t, TMP); d.g.position.set(0, TMP.y + d.o.h / 2, wz(TMP.x + d.o.w / 2)); }
    else if (d.k === 'secret') { d.g.rotation.y = t * 2.2; d.g.visible = !(p && p.secretsGot && p.secretsGot[d.o.i]); }
  }
}

export function updatePlayer(player, v, p) {
  const grav = p.grav < 0;
  player.getObjectByName('cube').visible = p.mode === MODE.CUBE;
  player.getObjectByName('ship').visible = p.mode === MODE.SHIP;
  player.getObjectByName('wave').visible = p.mode === MODE.WAVE;
  player.position.set(0, v.y + PH / 2, wz(v.x + PW / 2));
  player.rotation.set(0, 0, 0);
  player.rotation.x = v.rot * (grav ? -1 : 1);
  player.visible = !p.dead;
}
