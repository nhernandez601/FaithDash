// Faith Dash 3D: draws the existing game in 3D. The game rules (sim.js), the levels, the song clock and the input are all
// reused unchanged. Track coordinates: sim x = distance along the track (drawn along -Z), sim y = height (drawn along Y).
// The sideways "lane" axis (drawn along X) is not used yet, so the runner stays in the middle.
// Nothing here feeds back into the game rules: the camera, art, score and HUD only READ the runner's state.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getLevel, LEVEL_DEFS } from '../game/levelgen.js';
import { newPlayer, step, respawn, platPos, sawPos, spinnerAngle, pulseOn, DT, EV, MODE, PW, PH } from '../game/sim.js';
import { SmoothClock } from '../game/clock.js';
import { audio } from '../audio/audio.js';
import { SONG_URLS } from '../audio/songs.js';
import * as A from './art3d.js';
import * as LN from './lanes.js';
const LANE_W = A.TRACK_W / 3; // world width of one lane
import logoUrl from '../assets/logo.webp';

audio.setSongUrls(SONG_URLS);

const SONGS = { drop: 'Arcade Drop', boss: 'Arcade Boss Battle', intense: 'Intense Section' };
const $ = (id) => document.getElementById(id);
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.info.autoReset = false; // the glow pass renders several times a frame; count the whole frame
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 700);
// soft studio reflections so gold and metal shine instead of looking black
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
const hemi = new THREE.HemisphereLight(0xc9b8ff, 0x2a2050, 1.1); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d8, 2.0); sun.position.set(-8, 16, 6); scene.add(sun);
const rimLight = new THREE.DirectionalLight(0x8fd8ff, 0.9); rimLight.position.set(10, 4, -12); scene.add(rimLight);

// glow (bloom): bright crystals, eyes, lasers and coins light up softly
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.22, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const sparks = new A.Sparks(scene);
const flames = new A.Sparks(scene, 1400, { size: 0.34, grav: -5 });
const aurora = A.makeAurora(); scene.add(aurora);
// far-away islands fade into the same colour as the painted clouds
A.setSkyColorHook((col) => { if (scene.fog) scene.fog.color.copy(col).lerp(new THREE.Color(0x3a2f7a), 0.35); });

// ---- scoring: rewarded for keeping the beat ----
const RATE = { perfect: 0.06, great: 0.11, good: 0.17, near: 0.35 };
const PTS = { perfect: 100, great: 60, good: 25 };
const MULT_STEP = 4, MULT_MAX = 4;          // every 4 on-beat jumps in a row: multiplier +0.25, up to x4
const LIVES = 3;

const G = {
  level: null, p: null, prev: null, root: null, dyn: [], floaters: [], clock: new SmoothClock(), playing: false, paused: false, ended: false,
  wall: 0, press: false, hold: false, cam: 'chase', camPos: new THREE.Vector3(), camLook: new THREE.Vector3(), deaths: 0, respawnAt: 0,
  lives: LIVES, score: 0, bonus: 0, streak: 0, best: 0, coins: 0, cueT: [], wasGrounded: true, squash: 0, sel: 1, attract: true, attractT: 0,
};
const wz = (x) => -x; // sim x -> world z

function disposeRoot() {
  if (!G.root) return;
  scene.remove(G.root);
  G.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  G.root = null; G.dyn = []; G.floaters = [];
}

function buildWorld(lv) {
  disposeRoot();
  const th = A.THEMES[(lv.id - 1) % A.THEMES.length];
  scene.background = new THREE.Color(th.fog);
  scene.fog = new THREE.Fog(th.fog, th.fogNear, th.fogFar);
  const root = new THREE.Group(); G.root = root; scene.add(root);
  const M = A.makeMats(th);
  const add = (m) => { root.add(m); return m; };
  G.sky = A.makeSky(th); scene.background = G.sky;
  A.buildTrack(lv, root, M);
  G.floaters = A.buildScenery(lv, root, th);
  G.gears = A.buildLandmarks(lv, root, M);
  A.buildSpikes(lv, root, M);
  for (const s of lv.saws) { const { g, disc } = A.makeSaw(s.r, M); add(g); G.dyn.push({ k: 'saw', o: s, g, disc }); }
  for (const s of lv.spinners) { const g = add(A.makeSpinner(s.len, M)); G.dyn.push({ k: 'spin', o: s, g }); }
  for (const s of lv.pulses) { const g = add(A.makePulse(s, M)); g.position.set(0, s.y, wz(s.x)); G.dyn.push({ k: 'pulse', o: s, g }); }
  for (const pl of lv.platforms) { const g = add(A.makePlatform(pl, M)); G.dyn.push({ k: 'plat', o: pl, g }); }
  lv.coins.forEach((c, i) => {
    const g = add(A.makeCoin(M, 0.75)); g.position.set(0, 1.7, wz(c.x)); G.dyn.push({ k: 'coin', i, g });
    const beam = add(new THREE.Mesh(new THREE.PlaneGeometry(A.TRACK_W, 6), new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })));
    beam.position.set(0, 3, wz(c.x));
  });
  for (const o of lv.orbs) { const g = add(A.makeOrb()); g.position.set(0, o.y, wz(o.x)); G.dyn.push({ k: 'orb', g }); }
  for (const m of lv.mports) {
    const { g, disc } = A.makePortal(m, M);
    g.position.set(0, m.mode === MODE.CUBE && m.grav > 0 ? 1.9 : 3.4, wz(m.x)); add(g); G.dyn.push({ k: 'portal', g, disc });
  }
  for (const s of lv.secrets) { const g = add(A.makeCoin(M, 0.5)); g.position.set(0, s.cy || s.y0 + 2, wz(s.x)); G.dyn.push({ k: 'secret', o: s, g }); }
  for (const c of lv.checkpoints) { const g = add(A.makeCheckpoint(M)); g.position.set(A.TRACK_W / 2 + 0.3, c.y, wz(c.x)); }
  const fin = add(A.makeFinish(M)); fin.position.set(0, 0, wz(lv.finishX));
  // lane obstacles (dodge barriers and roll-under gates): an extra layer on top of the 2D rules, see lanes.js
  G.hz = { list: LN.planLaneHazards(lv), from: 0 };
  for (const h of G.hz.list) {
    const g = add(h.type === 'gate' ? A.makeGate(M, LN.GATE_Y) : A.makeBarrier(M, h.lanes, LANE_W, LN.BARRIER_H));
    g.position.set(0, h.y, wz(h.x + h.w / 2));
  }
  G.player = add(A.makeHero(PW, PH)); G.player.userData.dyn = true;
  G.mark = add(A.makeFloorMark()); G.mark.userData.dyn = true;
  for (const d of G.dyn) d.g.userData.dyn = true;
  A.bakeStatic(root); // merge everything that never moves into a few big meshes (far fewer draw calls)
  // the ground heights, for the shadow under the hero
  G.tops = lv.solids.filter((s) => s.y1 > s.y0).map((s) => [s.x, s.x + s.w, s.y1]);
}

// ---------- the frame ----------
function groundUnder(x, y) {
  let best = -Infinity;
  for (const [a, b, top] of G.tops) if (x >= a - 0.3 && x <= b + 0.3 && top <= y + 0.05 && top > best) best = top;
  return best;
}

function updatePlayer(v, p, dt) {
  const pl = G.player, grav = p.grav < 0;
  const spin = pl.getObjectByName('spin');
  spin.getObjectByName('cube').visible = p.mode === MODE.CUBE;
  spin.getObjectByName('ship').visible = p.mode === MODE.SHIP;
  spin.getObjectByName('wave').visible = p.mode === MODE.WAVE;
  const L = G.L, lx = L.lx * LANE_W;
  // roll: tuck down to half height and tumble forward once, eased in and out
  const rp = L.roll > 0 ? 1 - L.roll / LN.ROLL_TIME : 0;
  const tuck = L.roll > 0 ? smooth(Math.min(1, rp / 0.18, (1 - rp) / 0.22)) : 0;
  spin.rotation.set(0, 0, 0);
  if (p.mode === MODE.CUBE) spin.rotation.x = -v.rot * (grav ? -1 : 1) - (L.roll > 0 ? smooth(rp) * Math.PI * 2 : 0);
  else if (p.mode === MODE.SHIP) spin.rotation.x = Math.max(-0.6, Math.min(0.6, (p.vy || 0) * 0.05)) * (grav ? -1 : 1);
  else spin.rotation.x = (G.hold ? 0.78 : -0.78) * (grav ? -1 : 1);
  spin.rotation.z = (grav ? Math.PI : 0) - (L.lane - L.lx) * 0.45; // lean into a lane change
  // squash on landing, stretch while jumping
  if (!G.wasGrounded && p.grounded && p.mode === MODE.CUBE) { G.squash = 1; sparks.emit(lx, v.y + 0.05, wz(v.x + PW / 2), 10, [0xffc46a, 0xffffff, 0x7fe8ff], 2.6, 0.6); }
  G.wasGrounded = p.grounded;
  G.squash = Math.max(0, G.squash - dt * 6);
  const air = !p.grounded && p.mode === MODE.CUBE ? 0.06 : 0;
  const sq = 0.25 * G.squash;
  const sy = (1 - sq + air) * (1 - 0.52 * tuck), sxz = (1 + sq * 0.6 - air * 0.5) * (1 + 0.12 * tuck);
  pl.scale.set(sxz, sy, sxz);
  pl.position.set(lx, grav ? v.y + PH - (PH / 2) * sy : v.y + (PH / 2) * sy, wz(v.x + PW / 2));
  if (L.roll > 0 && Math.random() < 0.6) sparks.emit(lx, v.y + 0.05, wz(v.x), 2, [0xffc46a, 0x7fe8ff], 1.8, 0.4);
  pl.visible = !p.dead;
  // floor mark
  const gy = grav ? -Infinity : groundUnder(v.x + PW / 2, v.y);
  G.mark.visible = !p.dead && gy > -Infinity && v.y - gy < 6;
  if (G.mark.visible) { G.mark.position.set(lx, gy + 0.02, wz(v.x + PW / 2)); const k = Math.max(0.3, 1 - (v.y - gy) / 6); G.mark.scale.setScalar(k); G.mark.material.opacity = k; }
  // ember trail
  if (!p.dead) {
    const fz = pl.position.z, fy = pl.position.y;
    const n = Math.min(10, Math.round(dt * 420));
    for (let k = 0; k < n; k++) {
      // flames lick up off the crown and the two sides, then trail away as the cube runs on
      const side = Math.random() < 0.5 ? (Math.random() < 0.5 ? -1 : 1) : 0;
      const fx = side ? side * (0.42 + Math.random() * 0.08) : (Math.random() - 0.5) * 0.6;
      const fyy = side ? fy - 0.2 + Math.random() * 0.6 : fy + 0.42 + Math.random() * 0.15;
      flames.emit(lx + fx, fyy, fz - 0.2 + (Math.random() - 0.5) * 0.6, 1, [0xff4a00, 0xff8a10, 0xffb52a, 0xffe08a], 0.5, 0.9, 0.2);
    }
  }
}

const smooth = (t) => t * t * (3 - 2 * t);
const TMP = { x: 0, y: 0 };
function updateDynamic(t, wall) {
  const p = G.p;
  for (const d of G.dyn) {
    if (d.k === 'saw') { sawPos(d.o, t, TMP); d.g.position.set(0, TMP.y, wz(TMP.x)); d.disc.rotation.x = -t * 8; }
    else if (d.k === 'spin') { d.g.position.set(0, d.o.cy, wz(d.o.cx)); d.g.rotation.x = spinnerAngle(d.o, t); }
    else if (d.k === 'pulse') d.g.visible = pulseOn(d.o, t);
    else if (d.k === 'plat') { platPos(d.o, t, TMP); d.g.position.set(0, TMP.y + d.o.h / 2, wz(TMP.x + d.o.w / 2)); }
    else if (d.k === 'coin') { d.g.rotation.y = wall * 0.0025; d.g.visible = !(p.coinsUsed && p.coinsUsed[d.i]); }
    else if (d.k === 'secret') { d.g.rotation.y = wall * 0.004; d.g.visible = !(p.secretsGot && p.secretsGot[d.o.i]); }
    else if (d.k === 'portal') d.disc.rotation.z = -wall * 0.003;
    else if (d.k === 'orb') d.g.children[1].rotation.x = wall * 0.003;
  }
  for (const f of G.floaters) f.rotation.y = wall * 0.0004;
  if (G.gears) G.gears.forEach((g, i) => { g.rotation.z = wall * 0.0008 * (i % 2 ? -1.6 : 1); });
}

// 3/4 view: the chase camera sits CHASE_ANGLE degrees off to the right of the track, CHASE_DIST back
const CHASE_ANGLE = 68;
const CHASE_DIST = 5.6;
function updateCamera(v, dt) {
  const z = wz(v.x), y = v.y;
  const want = new THREE.Vector3(), look = new THREE.Vector3();
  if (G.attract) {
    const a = Math.sin(G.attractT * 0.15) * 0.5 + 0.55;
    want.set(Math.sin(a) * 11, 5 + Math.sin(G.attractT * 0.2), z + Math.cos(a) * 11); look.set(-1.5, 1.5, z - 14);
  } else if (G.cam === 'chase') {
    const a = CHASE_ANGLE * Math.PI / 180;
    const lx = G.L ? G.L.lx * LANE_W * 0.7 : 0;
    want.set(lx + Math.sin(a) * CHASE_DIST, y * 0.6 + 2.3, z + Math.cos(a) * CHASE_DIST); look.set(lx * 0.8 - 0.6, y * 0.8 + 0.8, z - 3.2);
  } else if (G.cam === 'close') { want.set(1.7, y + 1.2, z + 1.9); look.set(0, y + 0.45, z - 0.4); } // close-up of the hero (debug / showcase)
  else { want.set(5.5, y * 0.7 + 5.2, z + 7.5); look.set(-0.5, y + 0.8, z - 6); }
  const k = G.camPos.lengthSq() === 0 ? 1 : 1 - Math.exp(-dt * 6); // glide between camera styles; the music clock is not affected
  G.camPos.lerp(want, k); G.camLook.lerp(look, k);
  camera.position.copy(G.camPos);
  camera.lookAt(G.camLook);
  if (G.sky) A.fitSky(G.sky, camera.aspect, (camera.position.z * 0.00004) % 1 + 0.04 * Math.sin(G.attractT * 0.1), Math.max(-1, Math.min(1, (camera.position.y - 5) * 0.03)));
}

// ---------- beat rating ----------
function rateJump(tp) {
  const ct = G.cueT; if (!ct.length) return;
  let lo = 0, hi = ct.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (ct[m] < tp) lo = m + 1; else hi = m; }
  let best = Infinity;
  for (const i of [lo - 1, lo]) if (i >= 0 && i < ct.length) best = Math.min(best, Math.abs(tp - ct[i]));
  if (best > RATE.near) return;
  const kind = best <= RATE.perfect ? 'perfect' : best <= RATE.great ? 'great' : best <= RATE.good ? 'good' : 'off';
  if (kind === 'off') G.streak = 0;
  else { if (kind !== 'good') G.streak++; G.bonus += PTS[kind] * mult(); }
  G.best = Math.max(G.best, G.streak);
  popRating(kind);
  if (kind === 'perfect' || kind === 'great') {
    const pl = G.player.position; sparks.emit(0, pl.y, pl.z, kind === 'perfect' ? 18 : 9, kind === 'perfect' ? [0xffe27a, 0xffffff, 0x7df3ff] : [0x7df3ff, 0xffffff], 3.5);
    if (audio.sfx) audio.sfx(kind);
  }
}
const mult = () => Math.min(MULT_MAX, 1 + 0.25 * Math.floor(G.streak / MULT_STEP));
let popTimer = 0;
function popRating(kind) {
  const el = $('rating');
  el.textContent = kind === 'off' ? 'OFF BEAT' : kind.toUpperCase();
  el.className = 'rating show ' + kind;
  clearTimeout(popTimer); popTimer = setTimeout(() => { el.className = 'rating'; }, 550);
}

// ---------- HUD ----------
function sectionLabel(p, ct) {
  if (p.mode === MODE.SHIP) return ['TAKE FLIGHT', 'Hold to rise, let go to fall'];
  if (p.mode === MODE.WAVE) return ['RIDE THE WAVE', 'Hold to climb, let go to dive'];
  if (p.grav < 0) return ['UPSIDE DOWN', 'Trust the path'];
  if (ct < 8) return ['INTRO', 'Forward in faith'];
  return ['RUN', 'Keep the beat'];
}
function nextMove(p, ct) {
  if (p.mode === MODE.SHIP) return ['HOLD ↑', 'TO FLY'];
  if (p.mode === MODE.WAVE) return ['HOLD / RELEASE', 'ZIG-ZAG'];
  const ct2 = G.cueT; let lo = 0, hi = ct2.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (ct2[m] < ct + 0.03) lo = m + 1; else hi = m; }
  if (lo >= ct2.length) return ['FINISH', ''];
  const beats = (ct2[lo] - ct) / G.level.spb;
  const h = G.hz && G.hz.list.slice(G.hz.from, G.hz.from + 3).find((q) => q.x + q.w > p.x);
  if (h) {
    const hb = (h.x - p.x) / G.level.speed / G.level.spb;
    if (hb < beats && hb < 6) return [h.type === 'gate' ? 'ROLL ↓' : (h.lanes.includes(G.L.lane) ? '◀ DODGE ▶' : 'STAY CLEAR'), hb.toFixed(1) + ' BEATS'];
  }
  return [p.grav < 0 ? 'JUMP ↓' : 'JUMP ↑', beats > 8 ? '' : beats.toFixed(1) + ' BEATS'];
}
const pad = (n) => String(Math.floor(n)).padStart(5, '0');
function hud(p, ct) {
  const lv = G.level;
  G.score = Math.floor(p.furthest * 5 + G.bonus);
  const [sec, sub] = sectionLabel(p, ct);
  $('h-sec').textContent = sec; $('h-flavor').textContent = sub.toUpperCase();
  $('h-prog').style.width = Math.min(100, (p.furthest / lv.finishX) * 100) + '%';
  $('h-coins').textContent = G.coins;
  $('h-lives').innerHTML = `${G.lives} / ${LIVES} <b>♥</b>`;
  $('h-mult').textContent = '×' + mult().toFixed(2);
  $('h-streak').textContent = `${G.streak} BEAT STREAK`;
  $('h-score').textContent = pad(G.score);
  $('h-meter').style.width = ((G.streak % MULT_STEP) / MULT_STEP * 100 + (mult() >= MULT_MAX ? 100 : 0)) + '%';
  const [mv, when] = nextMove(p, ct);
  $('h-move').textContent = mv; $('h-when').textContent = when;
  // the beat pulse: the little light flashes on every beat of the song
  const ph = (ct / lv.spb) % 1;
  $('h-beat').style.opacity = String(Math.max(0.15, 1 - ph * 2.2));
}

// ---------- main loop ----------
function frame(wall) {
  requestAnimationFrame(frame);
  renderer.info.reset();
  const dt = Math.min(0.1, (wall - G.wall) / 1000 || 0.016); G.wall = wall;
  const lv = G.level; if (!lv) { composer.render(); return; }
  const p = G.p;
  let ct = G.clock.t;
  if (G.attract) {
    G.attractT += dt; ct = 0;
    const v = { x: (G.attractT * 2) % 30, y: 0, rot: 0 };
    p.x = 0;
    updatePlayer({ x: 0, y: 0, rot: 0 }, p, dt); updateDynamic(G.attractT, wall);
    updateCamera(v, dt);
  } else {
    if (G.playing && !G.paused) {
      if (audio.songActive) ct = G.clock.update(dt, audio.songTime());
      else ct = G.clock.t + dt, G.clock.t = ct; // no song loaded: run on the frame timer
      if (p.dead) {
        if (wall > G.respawnAt) {
          if (G.lives <= 0) gameOver();
          else { respawn(lv, p); G.prev = null; G.L = LN.newLaneState(); G.hz.from = 0; if (audio.songActive) audio.resync(p.t); G.clock.reset(p.t); ct = p.t; $('msg').classList.add('hidden'); }
        }
      } else if (!p.finished) {
        let n = 0;
        while (p.t < ct + DT - 1e-9 && n++ < 60) {
          const q = G.prev || (G.prev = {});
          q.x = p.x; q.y = p.y; q.rot = p.rot; q.t = p.t;
          p.hold = G.hold;
          const pressed = G.press;
          applyLaneInput(p);
          const evs = step(lv, p, DT, G.press); G.press = false;
          for (let i = 0; i < evs.length; i++) {
            const e = evs[i];
            if (e === EV.DEAD) crashed(wall);
            else if (e === EV.FINISH) finish();
            else if (e === EV.JUMP) { G.L.roll = 0; G.L.rollBuf = 0; if (pressed || p.mode === MODE.CUBE) rateJump(p.t); }
            else if (e === EV.COIN) { G.coins++; G.bonus += 500; i++; }
            else if (e === EV.SECRET) { G.coins++; G.bonus += 1000; i++; }
            else if (e === EV.CHECKPOINT || e === EV.PORTAL || e === EV.ORB || e === EV.MODE) i++;
          }
          LN.stepLane(G.L, DT, p.grounded, p.mode === MODE.CUBE && p.grav > 0);
          if (!p.dead && !p.finished && LN.hitsLaneHazard(G.hz, p, G.L, PW, PH, LANE_W)) { p.dead = true; p.deathReason = 'lane'; crashed(wall); }
          if (p.dead || p.finished) break;
        }
      }
    }
    const v = { x: p.x, y: p.y, rot: p.rot };
    const q = G.prev;
    if (q && !p.dead && p.t > q.t) { const a = Math.max(0, Math.min(1, (ct - q.t) / (p.t - q.t))); v.x = q.x + (p.x - q.x) * a; v.y = q.y + (p.y - q.y) * a; v.rot = q.rot + (p.rot - q.rot) * a; }
    updatePlayer(v, p, dt); updateDynamic(ct, wall); updateCamera(v, dt);
    if (shake > 0) { shake = Math.max(0, shake - dt); camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; }
    hud(p, ct);
  }
  sparks.update(dt); flames.update(dt);
  aurora.position.copy(camera.position); aurora.userData.tick(wall / 1000);
  composer.render();
}
let shake = 0;
function crashed(wall) {
  G.deaths++; G.lives--; G.streak = 0; G.respawnAt = wall + 800;
  const pl = G.player.position; sparks.emit(pl.x, pl.y, pl.z, 40, [0xff6a3a, 0xffd36a, 0xffffff], 5);
  $('msg').textContent = G.lives > 0 ? 'Crashed' : 'Out of lives'; $('msg').classList.remove('hidden');
  shake = 0.35;
}
// lane / roll requests from the keyboard, swipes or the on-screen buttons are applied on the next sim step
function applyLaneInput(p) {
  const L = G.L;
  if (G.laneReq) { L.lane = Math.max(-1, Math.min(1, L.lane + G.laneReq)); G.laneReq = 0; }
  if (G.rollReq) {
    G.rollReq = false;
    if (p.mode === MODE.CUBE && p.grav > 0) {
      if (p.grounded) L.roll = LN.ROLL_TIME;
      else { L.rollBuf = 0.3; p.vy = Math.min(p.vy, -24); } // in the air: slam down, then roll on landing
    }
  }
}

// ---------- screens ----------
function show(id) { for (const s of ['menu', 'hud', 'pause', 'over']) $(s).classList.toggle('hidden', s !== id && !(id === 'pause' && s === 'hud') && !(id === 'over' && s === 'hud')); }

function finish() {
  G.ended = true; audio.fadeOutMusic && audio.fadeOutMusic(1);
  G.bonus += G.lives * 1000;
  setTimeout(() => results('Level complete!', 'Well done, pilgrim.'), 1200);
}
function gameOver() {
  G.playing = false; audio.fadeOutMusic && audio.fadeOutMusic(0.6);
  results('Out of lives', 'Get up and run again.');
}
function results(title, sub) {
  G.playing = false; $('msg').classList.add('hidden');
  $('o-title').textContent = title; $('o-sub').textContent = sub;
  $('o-score').textContent = pad(G.score); $('o-best').textContent = G.best; $('o-coins').textContent = G.coins;
  $('o-prog').textContent = Math.min(100, Math.round((G.p.furthest / G.level.finishX) * 100)) + '%';
  show('over');
}

async function start(id) {
  const lv = getLevel(id);
  if (!G.level || G.level.id !== lv.id) buildWorld(lv);
  G.level = lv; G.p = newPlayer(lv); G.prev = null; G.deaths = 0; G.ended = false; G.paused = false; G.camPos.set(0, 0, 0);
  G.L = LN.newLaneState(); G.laneReq = 0; G.rollReq = false; if (G.hz) G.hz.from = 0;
  G.lives = LIVES; G.score = 0; G.bonus = 0; G.streak = 0; G.best = 0; G.coins = 0; G.wasGrounded = true; G.attract = false;
  G.cueT = (lv.cues || []).map((c) => c.t).sort((a, b) => a - b);
  $('h-title').textContent = `${lv.name} / ${SONGS[lv.song] || ''}`.toUpperCase();
  show('hud');
  $('msg').textContent = 'Loading song...'; $('msg').classList.remove('hidden');
  audio.unlock();
  let ok = false;
  try { ok = await audio.loadSong(lv.song); } catch { ok = false; }
  for (const [txt, ms] of [['3', 650], ['2', 650], ['1', 650]]) { $('msg').textContent = txt; await new Promise((r) => setTimeout(r, ms)); }
  $('msg').classList.add('hidden');
  if (ok && audio.startSong(lv.song, 0, lv.cues)) { G.clock.reset(audio.songTime()); } else G.clock.reset(0);
  G.playing = true;
}

function pause(on) {
  if (!G.playing || G.ended) return;
  G.paused = on;
  if (on) audio.suspend(); else { audio.wake(); G.wall = performance.now(); }
  show(on ? 'pause' : 'hud');
}
function toMenu() {
  audio.wake(); audio.stopMusic && audio.stopMusic();
  G.playing = false; G.paused = false; G.attract = true; G.camPos.set(0, 0, 0);
  previewLevel(G.sel);
  show('menu');
}
function previewLevel(id) {
  G.sel = id;
  const lv = getLevel(id);
  if (!G.level || G.level.id !== id) buildWorld(lv);
  G.level = lv; G.p = newPlayer(lv); G.prev = null; G.L = LN.newLaneState();
  const d = LEVEL_DEFS.find((q) => q.id === id);
  $('play').innerHTML = `PLAY ${SONGS[d.song].toUpperCase()} <span>↗</span>`;
  $('m-level').textContent = d.name.toUpperCase();
  $('m-sub').textContent = `${d.difficulty} · ${Math.round(d.bpm)} BPM · ${d.speed} tiles/s`.toUpperCase();
  for (const b of document.querySelectorAll('.song')) b.classList.toggle('on', +b.dataset.id === id);
}

// ---------- input: same everywhere, never depends on the camera ----------
const down = () => { if (!G.playing || G.paused) return; G.press = true; G.hold = true; };
const lane = (d) => { if (G.playing && !G.paused) G.laneReq = d; };
const roll = () => { if (G.playing && !G.paused) G.rollReq = true; };
const up = () => { G.hold = false; };
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); if (!e.repeat) down(); }
  else if ((e.code === 'ArrowLeft' || e.code === 'KeyA') && !e.repeat) { e.preventDefault(); lane(-1); }
  else if ((e.code === 'ArrowRight' || e.code === 'KeyD') && !e.repeat) { e.preventDefault(); lane(1); }
  else if ((e.code === 'ArrowDown' || e.code === 'KeyS') && !e.repeat) { e.preventDefault(); roll(); }
  else if (e.code === 'KeyC' && !e.repeat) G.cam = G.cam === 'chase' ? 'drone' : 'chase';
  else if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) pause(!G.paused);
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') up(); });
// Touch: a tap on the screen jumps at once (timing matters). A swipe left / right / down changes lane or rolls.
// The bottom control strip (#pad) never jumps, so swiping there is always safe; its arrow buttons work too.
let sw = null;
function swipeStart(e) { sw = { x: e.clientX, y: e.clientY, t: performance.now(), done: false }; }
function swipeMove(e) {
  if (!sw || sw.done) return;
  const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
  if (performance.now() - sw.t > 450) { sw = null; return; }
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 32) return;
  sw.done = true;
  if (Math.abs(dx) > Math.abs(dy)) lane(dx < 0 ? -1 : 1); else if (dy > 0) roll();
}
canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); swipeStart(e); down(); });
$('hud').addEventListener('pointerdown', (e) => { if (e.target.closest('button') || e.target.closest('#pad')) return; e.preventDefault(); swipeStart(e); down(); });
$('pad').addEventListener('pointerdown', (e) => {
  e.preventDefault(); e.stopPropagation();
  const b = e.target.closest('button');
  if (b) { if (b.dataset.k === 'L') lane(-1); else if (b.dataset.k === 'R') lane(1); else if (b.dataset.k === 'D') roll(); else down(); return; }
  swipeStart(e);
});
window.addEventListener('pointermove', swipeMove);
window.addEventListener('pointerup', up);
window.addEventListener('pointercancel', up);
document.addEventListener('visibilitychange', () => { if (document.hidden && G.playing && !G.paused) pause(true); });

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); composer.setSize(w, h); bloom.setSize(w, h);
  camera.aspect = w / h; camera.fov = w < h ? 72 : 60; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();

// menu wiring
for (const d of LEVEL_DEFS) {
  const b = document.createElement('button'); b.className = 'song'; b.dataset.id = d.id;
  b.innerHTML = `<i>${SONGS[d.song]}</i><small>${d.difficulty} · ${Math.round(d.bpm)} BPM</small>`;
  b.onclick = () => previewLevel(d.id);
  $('songs').appendChild(b);
}
$('play').onclick = () => start(G.sel);
$('pausebtn').onclick = () => pause(true);
$('resume').onclick = () => pause(false);
$('restart').onclick = () => { audio.wake(); audio.stopMusic && audio.stopMusic(); G.paused = false; G.playing = false; start(G.level.id); };
$('quit').onclick = toMenu;
$('again').onclick = () => start(G.level.id);
$('menubtn').onclick = toMenu;
$('camtoggle').onclick = () => { G.cam = G.cam === 'chase' ? 'drone' : 'chase'; $('camtoggle').textContent = G.cam === 'chase' ? 'Camera: chase' : 'Camera: drone'; };

// ---------- intro video: plays first, then fades into the live menu ----------
const vid = $('introvid');
function endIntro() { $('intro').classList.add('fade'); vid.pause(); setTimeout(() => $('intro').classList.add('hidden'), 800); }
function playIntro() {
  $('intro').classList.remove('hidden', 'fade');
  vid.currentTime = 0;
  vid.play().catch(() => {}); // muted autoplay is allowed; sound needs a tap
}
vid.addEventListener('ended', endIntro);
vid.addEventListener('error', endIntro);
$('skip').onclick = endIntro;
$('sound').onclick = () => { vid.muted = !vid.muted; $('sound').textContent = vid.muted ? '🔊 Enable sound' : '🔇 Mute'; if (vid.paused) vid.play().catch(() => {}); };
$('replay').onclick = () => { vid.muted = false; $('sound').textContent = '🔇 Mute'; playIntro(); };
document.querySelector('.panel img').src = logoUrl;

show('menu');
// build the first world once the Blender models are in (falls back to code shapes if they fail)
A.loadAssets().finally(() => previewLevel(1));
if (new URLSearchParams(location.search).has('nointro')) $('intro').classList.add('hidden'); else playIntro();
window.__fd3 = { G, start, THREE, scene, camera, renderer, bloom, flames, sparks }; // test hooks only
requestAnimationFrame(frame);
