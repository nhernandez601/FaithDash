// Faith Dash 3D page. The game rules (sim.js), the levels, the song clock and the input are reused unchanged.
// World building lives in world3d.js, the camera script in camera3d.js. Nothing here feeds back into the game rules:
// the camera only reads the runner's position, so the controls are the same whatever the camera is doing.
import * as THREE from 'three';
import { getLevel, LEVEL_DEFS } from '../game/levelgen.js';
import { newPlayer, step, respawn, DT, EV } from '../game/sim.js';
import { SmoothClock } from '../game/clock.js';
import { audio } from '../audio/audio.js';
import { SONG_URLS } from '../audio/songs.js';
import { buildWorld, updateDynamic, updatePlayer, fadeBehind, wz } from './world3d.js';
import { buildCameraScript, cameraParamsAt, placeCamera } from './camera3d.js';

audio.setSongUrls(SONG_URLS);

const $ = (id) => document.getElementById(id);
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 400);
scene.add(new THREE.AmbientLight(0xffffff, 0.75));
const sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.position.set(-6, 14, 8); scene.add(sun);

const CAM_MODES = ['script', 'easy']; // script = the full camera moves, easy = mostly behind the runner (for Casual)
const G = { level: null, p: null, prev: null, root: null, world: null, scripts: null, clock: new SmoothClock(), playing: false, ended: false, wall: 0, press: false, hold: false, camMode: 'script', deaths: 0, respawnAt: 0, camOut: {}, fovNow: 62 };

function setupLevel(lv) {
  if (G.root) { scene.remove(G.root); G.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
  G.root = new THREE.Group(); scene.add(G.root);
  G.world = buildWorld(lv, G.root);
  scene.background = new THREE.Color(G.world.theme.sky);
  scene.fog = new THREE.Fog(G.world.theme.fog, 60, 200);
  G.scripts = { script: buildCameraScript(lv, 'script'), easy: buildCameraScript(lv, 'easy') };
}

// ---------- the frame ----------
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
  updatePlayer(G.world.player, v, p); updateDynamic(G.world.dyn, ct, p); fadeBehind(G.world.blockers, v.x);
  // camera: a pure function of song time and the runner's position
  const P = cameraParamsAt(G.scripts[G.camMode], ct);
  placeCamera(lv, P, v, ct / lv.spb, G.camOut);
  camera.position.copy(G.camOut.position); camera.lookAt(G.camOut.look);
  if (Math.abs(camera.fov - P.fov) > 0.01) { camera.fov = P.fov; camera.updateProjectionMatrix(); }
  $('bar').style.width = Math.min(100, (p.furthest / lv.finishX) * 100) + '%';
  $('hud').textContent = `${lv.name}  |  camera: ${G.camMode === 'script' ? 'moving' : 'easy'} (C)  |  crashes: ${G.deaths}`;
  renderer.render(scene, camera);
}

function finish() {
  G.ended = true; audio.fadeOutMusic && audio.fadeOutMusic(1);
  $('msg').textContent = 'Level complete!'; $('msg').classList.remove('hidden');
  setTimeout(() => { $('menu').classList.remove('hidden'); $('msg').classList.add('hidden'); G.playing = false; }, 2500);
}

async function start(id) {
  const lv = getLevel(id);
  G.level = lv; G.p = newPlayer(lv); G.prev = null; G.deaths = 0; G.ended = false;
  setupLevel(lv);
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
  else if (e.code === 'KeyC' && !e.repeat) G.camMode = CAM_MODES[(CAM_MODES.indexOf(G.camMode) + 1) % CAM_MODES.length];
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
window.__fd3 = { G, start, THREE, scene, camera, renderer, wz }; // test hooks only
requestAnimationFrame(frame);
