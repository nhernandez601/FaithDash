// Faith Dash 3D, Milestone 1: draws the existing game in 3D. The game rules (sim.js), the levels, the song clock and the
// input are all reused unchanged. Track coordinates: sim x = distance along the track (drawn along -Z), sim y = height
// (drawn along Y). The sideways "lane" axis (drawn along X) is not used yet, so the runner stays in the middle lane.
// Nothing here feeds back into the game rules: the camera only reads the runner's position.
import * as THREE from 'three';
import { getLevel, LEVEL_DEFS } from '../game/levelgen.js';
import { newPlayer, step, respawn, platPos, sawPos, spinnerAngle, pulseOn, DT, EV, MODE, PW, PH } from '../game/sim.js';
import { SmoothClock } from '../game/clock.js';
import { audio } from '../audio/audio.js';
import { SONG_URLS } from '../audio/songs.js';

audio.setSongUrls(SONG_URLS);

const TRACK_W = 3; // how wide the track is drawn (the game has no sideways movement yet)
const $ = (id) => document.getElementById(id);
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 400);
scene.add(new THREE.AmbientLight(0xffffff, 0.75));
const sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.position.set(-6, 14, 8); scene.add(sun);

const THEMES = [
  { sky: 0x1c1250, fog: 0x1c1250, top: 0x6a4cff, side: 0x5a46c8, hazard: 0xff4d6d },
  { sky: 0x0e2a3f, fog: 0x0e2a3f, top: 0x2fd0c4, side: 0x2d9ab8, hazard: 0xff7a3d },
  { sky: 0x3a0f22, fog: 0x3a0f22, top: 0xff5a8a, side: 0xc4457a, hazard: 0xffe14d },
];
const MCOL = (m) => (m.mode === MODE.SHIP ? 0xff6ad5 : m.mode === MODE.WAVE ? 0x39e6ff : m.grav < 0 ? 0xffd23a : 0x4dff9a);

const G = { level: null, p: null, prev: null, root: null, dyn: [], clock: new SmoothClock(), playing: false, ended: false, t0: 0, wall: 0, press: false, hold: false, cam: 'chase', camPos: new THREE.Vector3(), deaths: 0, respawnAt: 0 };
const wz = (x) => -x; // sim x -> world z

function disposeRoot() {
  if (!G.root) return;
  scene.remove(G.root);
  G.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  G.root = null; G.dyn = [];
}

function buildWorld(lv) {
  disposeRoot();
  const th = THEMES[(lv.id - 1) % THEMES.length];
  scene.background = new THREE.Color(th.sky);
  scene.fog = new THREE.Fog(th.fog, 60, 200);
  const root = new THREE.Group(); G.root = root; scene.add(root);
  const mTop = new THREE.MeshStandardMaterial({ color: th.top, roughness: 0.55 });
  const mSide = new THREE.MeshStandardMaterial({ color: th.side, roughness: 0.8 });
  const mHaz = new THREE.MeshStandardMaterial({ color: th.hazard, roughness: 0.4, emissive: th.hazard, emissiveIntensity: 0.35 });
  const mGold = new THREE.MeshStandardMaterial({ color: 0xffd23a, emissive: 0xffa800, emissiveIntensity: 0.6, roughness: 0.3 });
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cone = new THREE.ConeGeometry(0.34, 0.6, 4); cone.translate(0, 0.3, 0); cone.rotateY(Math.PI / 4);
  const add = (m) => { root.add(m); return m; };

  // terrain and blocks: every solid is a box across the track
  for (const s of lv.solids) {
    const h = s.y1 - s.y0; if (h <= 0 || s.w <= 0) continue;
    const m = add(new THREE.Mesh(box, [mSide, mSide, mTop, mSide, mSide, mSide])); // +x,-x,+y(top),-y,+z,-z
    m.scale.set(TRACK_W, h, s.w);
    m.position.set(0, s.y0 + h / 2, wz(s.x + s.w / 2));
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
    const m = add(new THREE.Mesh(new THREE.CylinderGeometry(s.r, s.r, 0.25, 12), mHaz)); m.rotation.x = Math.PI / 2;
    const g = add(new THREE.Group()); root.remove(m); g.add(m); G.dyn.push({ k: 'saw', o: s, g });
  }
  for (const s of lv.spinners) {
    const g = add(new THREE.Group());
    const bar = new THREE.Mesh(box, mHaz); bar.scale.set(0.3, s.len * 2, 0.3); g.add(bar);
    G.dyn.push({ k: 'spin', o: s, g });
  }
  for (const s of lv.pulses) {
    const g = add(new THREE.Group());
    for (let i = 0; i < s.n; i++) { const c = new THREE.Mesh(cone, mHaz); c.position.set(0, 0, -(i + 0.5)); c.scale.set(1.3, 1, 1.3); g.add(c); }
    g.position.set(0, s.y, wz(s.x));
    G.dyn.push({ k: 'pulse', o: s, g });
  }
  for (const pl of lv.platforms) {
    const m = add(new THREE.Mesh(box, [mSide, mSide, mTop, mSide, mSide, mSide])); m.scale.set(TRACK_W, pl.h, pl.w);
    G.dyn.push({ k: 'plat', o: pl, g: m });
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
    const m = add(new THREE.Mesh(new THREE.OctahedronGeometry(0.55), mGold)); m.position.set(0, s.cy || s.y0 + 2, wz(s.x)); G.dyn.push({ k: 'secret', o: s, g: m });
  }
  for (const c of lv.checkpoints) {
    const pole = add(new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0x66ffcc }))); pole.scale.set(0.1, 3, 0.1); pole.position.set(TRACK_W / 2, c.y + 1.5, wz(c.x));
  }
  const fin = add(new THREE.Mesh(new THREE.PlaneGeometry(TRACK_W, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide })));
  fin.position.set(0, 4, wz(lv.finishX));
  G.root.add(G.player = makePlayer());
}

function makePlayer() {
  const g = new THREE.Group();
  const cube = new THREE.Mesh(new THREE.BoxGeometry(PW, PH, PW), new THREE.MeshStandardMaterial({ color: 0xffd23a, emissive: 0xaa7700, emissiveIntensity: 0.5 })); cube.name = 'cube';
  const ship = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.1, 4), new THREE.MeshStandardMaterial({ color: 0xff6ad5, emissive: 0xaa2288, emissiveIntensity: 0.5 })); ship.name = 'ship'; ship.rotation.z = -Math.PI / 2; ship.rotation.y = Math.PI / 4; ship.scale.set(1, 1, 0.55);
  const wave = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 3), new THREE.MeshStandardMaterial({ color: 0x39e6ff, emissive: 0x1188aa, emissiveIntensity: 0.6 })); wave.name = 'wave'; wave.rotation.z = -Math.PI / 2;
  g.add(cube, ship, wave);
  return g;
}

// ---------- the frame ----------
function updatePlayer(v, p) {
  const pl = G.player, grav = p.grav < 0;
  pl.getObjectByName('cube').visible = p.mode === MODE.CUBE;
  pl.getObjectByName('ship').visible = p.mode === MODE.SHIP;
  pl.getObjectByName('wave').visible = p.mode === MODE.WAVE;
  pl.position.set(0, v.y + PH / 2, wz(v.x + PW / 2));
  pl.rotation.set(0, 0, 0);
  pl.rotation.x = v.rot * (grav ? -1 : 1);
  pl.visible = !p.dead;
}

function updateDynamic(t) {
  for (const d of G.dyn) {
    if (d.k === 'saw') { sawPos(d.o, t, TMP); d.g.position.set(0, TMP.y, wz(TMP.x)); d.g.children[0].rotation.y = t * 8; }
    else if (d.k === 'spin') { d.g.position.set(0, d.o.cy, wz(d.o.cx)); d.g.rotation.x = spinnerAngle(d.o, t); }
    else if (d.k === 'pulse') d.g.visible = pulseOn(d.o, t);
    else if (d.k === 'plat') { platPos(d.o, t, TMP); d.g.position.set(0, TMP.y + d.o.h / 2, wz(TMP.x + d.o.w / 2)); }
    else if (d.k === 'secret') { d.g.rotation.y = t * 2.2; d.g.visible = !(G.p.secretsGot && G.p.secretsGot[d.o.i]); }
  }
}
const TMP = { x: 0, y: 0 };

function updateCamera(v, dt) {
  const z = wz(v.x), y = v.y;
  const want = new THREE.Vector3();
  const look = new THREE.Vector3(0, y + 1.2, z - 9);
  if (G.cam === 'chase') want.set(0, y * 0.6 + 3.4, z + 8.5);
  else { want.set(5.5, y * 0.7 + 5.2, z + 7.5); look.set(-0.5, y + 0.8, z - 6); }
  const k = G.camPos.lengthSq() === 0 ? 1 : 1 - Math.exp(-dt * 6); // glide between camera styles; the music clock is not affected
  G.camPos.lerp(want, k);
  camera.position.copy(G.camPos);
  camera.lookAt(look);
}

function frame(wall) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (wall - G.wall) / 1000 || 0.016); G.wall = wall;
  const lv = G.level; if (!lv) { renderer.render(scene, camera); return; }
  const p = G.p;
  let ct = G.clock.t;
  if (G.playing) {
    if (audio.songActive) ct = G.clock.update(dt, audio.songTime());
    else ct = G.clock.t + dt, G.clock.t = ct; // no song loaded: run on the frame timer
    if (p.dead) {
      if (wall > G.respawnAt) { respawn(lv, p); G.prev = null; if (audio.songActive) audio.resync(p.t); G.clock.reset(p.t); ct = p.t; $('msg').classList.add('hidden'); }
    } else if (!p.finished) {
      let n = 0;
      while (p.t < ct + DT - 1e-9 && n++ < 60) {
        const q = G.prev || (G.prev = {});
        q.x = p.x; q.y = p.y; q.rot = p.rot; q.t = p.t;
        p.hold = G.hold;
        const evs = step(lv, p, DT, G.press); G.press = false;
        for (let i = 0; i < evs.length; i++) {
          if (evs[i] === EV.DEAD) { G.deaths++; G.respawnAt = wall + 700; $('msg').textContent = 'Crashed'; $('msg').classList.remove('hidden'); }
          else if (evs[i] === EV.FINISH) finish();
        }
        if (p.dead || p.finished) break;
      }
    }
  }
  // draw at the clock's exact time, between the previous step and the current one
  const v = { x: p.x, y: p.y, rot: p.rot };
  const q = G.prev;
  if (q && !p.dead && p.t > q.t) { const a = Math.max(0, Math.min(1, (ct - q.t) / (p.t - q.t))); v.x = q.x + (p.x - q.x) * a; v.y = q.y + (p.y - q.y) * a; v.rot = q.rot + (p.rot - q.rot) * a; }
  updatePlayer(v, p); updateDynamic(ct); updateCamera(v, dt);
  $('bar').style.width = Math.min(100, (p.furthest / lv.finishX) * 100) + '%';
  $('hud').textContent = `${lv.name}  |  camera: ${G.cam} (C)  |  crashes: ${G.deaths}`;
  renderer.render(scene, camera);
}

function finish() {
  G.ended = true; audio.fadeOutMusic && audio.fadeOutMusic(1);
  $('msg').textContent = 'Level complete!'; $('msg').classList.remove('hidden');
  setTimeout(() => { $('menu').classList.remove('hidden'); $('msg').classList.add('hidden'); G.playing = false; }, 2500);
}

async function start(id) {
  const lv = getLevel(id);
  G.level = lv; G.p = newPlayer(lv); G.prev = null; G.deaths = 0; G.ended = false; G.camPos.set(0, 0, 0);
  buildWorld(lv);
  $('menu').classList.add('hidden');
  $('msg').textContent = 'Loading song...'; $('msg').classList.remove('hidden');
  audio.unlock();
  let ok = false;
  try { ok = await audio.loadSong(lv.song); } catch { ok = false; }
  for (const [txt, ms] of [['3', 700], ['2', 700], ['1', 700]]) { $('msg').textContent = txt; await new Promise((r) => setTimeout(r, ms)); }
  $('msg').classList.add('hidden');
  if (ok && audio.startSong(lv.song, 0, lv.cues)) { G.clock.reset(audio.songTime()); } else G.clock.reset(0);
  G.playing = true;
}

// ---------- input: same everywhere, never depends on the camera ----------
const down = () => { G.press = true; G.hold = true; };
const up = () => { G.hold = false; };
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); if (!e.repeat) down(); }
  else if (e.code === 'KeyC' && !e.repeat) G.cam = G.cam === 'chase' ? 'drone' : 'chase';
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') up(); });
canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); down(); });
window.addEventListener('pointerup', up);
window.addEventListener('pointercancel', up);

function resize() { const w = window.innerWidth, h = window.innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
window.addEventListener('resize', resize); resize();

for (const d of LEVEL_DEFS) {
  const b = document.createElement('button'); b.textContent = `Level ${d.id}: ${d.name}`; b.onclick = () => start(d.id); $('levels').appendChild(b);
}
window.__fd3 = { G, start, THREE, scene, camera, renderer }; // test hooks only
requestAnimationFrame(frame);
