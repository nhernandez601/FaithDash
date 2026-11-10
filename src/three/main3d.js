// Faith Dash 3D: draws the existing game in 3D. The game rules (sim.js), the levels, the song clock and the input are all
// reused unchanged. Track coordinates: sim x = distance along the track (drawn along -Z), sim y = height (drawn along Y).
// The sideways "lane" axis (drawn along X) is not used yet, so the runner stays in the middle.
// Nothing here feeds back into the game rules: the camera, art, score and HUD only READ the runner's state.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getLevel, LEVEL_DEFS, SONG_IDS, stageId } from '../game/levelgen.js';
import { triviaDeck } from './trivia.js';
import { newPlayer, step, respawn, platPos, sawPos, spinnerAngle, pulseOn, DT, EV, MODE, PW, PH } from '../game/sim.js';
import { SmoothClock } from '../game/clock.js';
import { audio } from '../audio/audio.js';
import { SONG_URLS } from '../audio/songs.js';
import * as A from './art3d.js';
import * as LN from './lanes.js';
import * as FX from './fx3d.js';
import * as BD from './bend.js';
const LANE_W = A.TRACK_W / 3; // world width of one lane
import logoUrl from '../assets/logo.webp';

audio.setSongUrls(SONG_URLS);

const SONGS = { drop: 'Arcade Drop', boss: 'Arcade Boss Battle', intense: 'Intense Section' };
// ONE course: "The Pilgrim's Path", with one look. The player only picks the song. One run = the song on repeat, and each
// time round is a harder stage (Easy -> Medium -> Hard, then Hard again) until the player is out of lives. Every stage is
// its own proven layout on that song's beat, so it is always beatable and always on the music.
const COURSE = "The Pilgrim's Path";
const $ = (id) => document.getElementById(id);
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
// ---------- picture quality (menu: ⚙ Quality). Saved on this device. ----------
// auto:  sharp as the device allows, and lowers the resolution by itself if the frame rate drops (best for phones)
// high:  full screen resolution, full-size glow, bigger shadow, light sharpening + film grain
// ultra: draws at least a 4K-tall image (supersampled on smaller screens), 8x edge smoothing, the 8K sky if present
// Phones and tablets (touch screens) get a lighter profile: fewer pixels, smaller glow and shadow, 60 fps cap, fewer
// flame particles, and no Ultra. It is still the same browser game, nothing to install.
const MOBILE = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const QUALITY = {
  auto: MOBILE
    ? { name: 'Auto', dpr: () => Math.min(window.devicePixelRatio || 1, 1.25), samples: 2, bloom: 0.35, shadow: 512, sharpen: 0, grain: 0 }
    : { name: 'Auto', dpr: () => Math.min(window.devicePixelRatio || 1, 1.75), samples: 4, bloom: 0.5, shadow: 1024, sharpen: 0, grain: 0.012 },
  high: { name: 'High', dpr: () => Math.min(Math.max(window.devicePixelRatio || 1, 1.5), 2), samples: 4, bloom: 1, shadow: 2048, sharpen: 0.22, grain: 0.018 },
  ultra: { name: 'Ultra 4K', dpr: () => Math.min(3, Math.max(window.devicePixelRatio || 1, 2160 / Math.max(1, window.innerHeight))), samples: 8, bloom: 1, shadow: 4096, sharpen: 0.3, grain: 0.02 },
};
let quality = 'auto';
try { quality = QUALITY[localStorage.getItem('faithdash3d.quality')] ? localStorage.getItem('faithdash3d.quality') : 'auto'; } catch { /* storage blocked */ }
if (MOBILE && quality === 'ultra') quality = 'high';
const MAX_DPR = Math.min(window.devicePixelRatio || 1, 2);
let dpr = QUALITY[quality].dpr(); // in Auto it is lowered automatically if the device can't keep up (see autoQuality)
renderer.setPixelRatio(dpr);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.info.autoReset = false; // the glow pass renders several times a frame; count the whole frame
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 320); // nothing past the fog (230) is drawn
// soft studio reflections so gold and metal shine instead of looking black
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
const hemi = new THREE.HemisphereLight(0xc9b8ff, 0x2a2050, 1.1); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d8, 2.0); sun.position.set(-8, 16, 6); scene.add(sun); scene.add(sun.target);
// a soft shadow under the hero only (cheap: a small shadow box that follows the runner)
sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.radius = 4; sun.shadow.bias = -0.0005;
Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 40 });
const rimLight = new THREE.DirectionalLight(0x8fd8ff, 0.9); rimLight.position.set(10, 4, -12); scene.add(rimLight);

// glow (bloom): bright crystals, eyes, lasers and coins light up softly
// render into a multisampled target: post effects otherwise switch anti-aliasing off and edges look jagged
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: Math.min(QUALITY[quality].samples, renderer.capabilities.maxSamples || 4) }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.22, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());
// colour grade to match the intro film: teal in the shadows, warm gold in the highlights, a little more contrast and
// saturation, and a soft vignette. Runs last, on the final picture.
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, amount: { value: 1 }, texel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) }, sharpen: { value: 0 }, grain: { value: 0 }, time: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float amount; uniform vec2 texel; uniform float sharpen; uniform float grain; uniform float time; varying vec2 vUv;
    void main(){
      vec4 src = texture2D(tDiffuse, vUv); vec3 c = src.rgb;
      if (sharpen > 0.0) {                               // light sharpening: crisper edges and texture detail
        vec3 n = texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).rgb
               + texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).rgb;
        c += sharpen * (c * 4.0 - n);
      }
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      vec3 shadowTint = vec3(-0.02, 0.025, 0.06), highTint = vec3(0.06, 0.025, -0.045);
      c += shadowTint * (1.0 - smoothstep(0.0, 0.5, l)) + highTint * smoothstep(0.45, 1.0, l);
      c = mix(vec3(l), c, 1.18);                         // saturation
      c = (c - 0.5) * 1.07 + 0.5;                        // contrast
      vec2 d = vUv - 0.5; float vig = smoothstep(0.85, 0.25, length(d * vec2(1.0, 0.85)));
      c *= mix(0.72, 1.0, vig);                          // vignette
      c += (fract(sin(dot(vUv / texel + time, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * grain; // fine film grain (hides colour banding)
      gl_FragColor = vec4(mix(src.rgb, clamp(c, 0.0, 1.0), amount), src.a);
    }`,
});
composer.addPass(grade);

const sparks = new A.Sparks(scene);
const flames = new FX.FlameFX(scene, MOBILE ? 450 : 900);   // animated flame sprites, coloured by the cube skin
const burst = new FX.BurstRing(scene);                      // light ring on PERFECT / GREAT jumps
const streaks = new FX.SpeedLines(scene, MOBILE ? 16 : 36);  // faint light streaks rushing past
const clouds = new FX.CloudLayer(scene);                    // drifting cloud sheets under the road
const aurora = A.makeAurora(); scene.add(aurora);
for (const m of [sparks.pts.material, flames.mat, burst.m.material]) BD.patchMaterial(m); // particles follow the twisting road
// far-away islands fade into the same colour as the painted clouds
A.setSkyColorHook((col, img) => {
  if (scene.fog) scene.fog.color.copy(col).lerp(new THREE.Color(0x3a2f7a), 0.35);
  // reflections + ambient light from the sky painting itself (replaces the plain grey studio light)
  if (img) {
    const t = new THREE.CanvasTexture(FX.skyEnvCanvas(img, col)); t.colorSpace = THREE.SRGBColorSpace; t.mapping = THREE.EquirectangularReflectionMapping;
    const env = pmrem.fromEquirectangular(t).texture; t.dispose();
    if (scene.environment && scene.environment !== env) scene.environment.dispose();
    scene.environment = env; scene.environmentIntensity = 0.9;
  }
});

// ---- scoring: rewarded for keeping the beat ----
const RATE = { perfect: 0.06, great: 0.11, good: 0.17, near: 0.35 };
const PTS = { perfect: 100, great: 60, good: 25 };
const MULT_STEP = 4, MULT_MAX = 4;          // every 4 on-beat jumps in a row: multiplier +0.25, up to x4
const LIVES = 3;

const G = {
  level: null, p: null, prev: null, root: null, dyn: [], floaters: [], clock: new SmoothClock(), playing: false, paused: false, ended: false,
  wall: 0, press: false, hold: false, cam: 'chase', camPos: new THREE.Vector3(), camLook: new THREE.Vector3(), deaths: 0, respawnAt: 0,
  lives: LIVES, score: 0, bonus: 0, streak: 0, best: 0, coins: 0, cueT: [], wasGrounded: true, squash: 0, sel: 'drop', attract: true, attractT: 0,
  stage: 0, distBank: 0, quiz: false, gk: 0,
};
const STAGE_NAMES = ['EASY', 'MEDIUM', 'HARD'];
const stageDef = () => LEVEL_DEFS.find((d) => d.id === G.level.id);
const stageTag = (s = G.stage) => `STAGE ${s + 1} · ${STAGE_NAMES[Math.min(2, s)]}`;
const wz = (x) => -x; // sim x -> world z

function disposeRoot() {
  if (!G.root) return;
  scene.remove(G.root);
  G.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  G.root = null; G.dyn = []; G.floaters = [];
}

function buildWorld(lv) {
  disposeRoot();
  const th = A.THEMES[0]; // one background for the whole game
  scene.background = new THREE.Color(th.fog);
  scene.fog = new THREE.Fog(th.fog, th.fogNear, th.fogFar);
  const root = new THREE.Group(); G.root = root; scene.add(root);
  const M = A.makeMats(th);
  const add = (m) => { root.add(m); return m; };
  G.sky = A.makeSky(th); scene.background = G.sky;
  A.buildTrack(lv, root, M);
  // twisting / spiral stretches (drawing only, see bend.js); the scenery is kept apart so it does not bend
  BD.setZones(BD.planBends(lv, (LEVEL_DEFS.find((d) => d.id === lv.id) || {}).tier));
  const scen = new THREE.Group(); root.add(scen);
  G.floaters = A.buildScenery(lv, scen, th);
  const sceneryMats = new Set(); scen.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => sceneryMats.add(m)); });
  G.gears = A.buildLandmarks(lv, root, M);
  // rhythm obstacles get 1-2 lanes each (dodge or jump); the sim steps against a per-lane copy of the level (lanes.js)
  G.hzLanes = LN.assignHazardLanes(lv); G.lvLanes = LN.laneLevels(lv, G.hzLanes);
  G.splitXs = [...G.hzLanes.keys()].map((h) => (h.cx !== undefined ? h.cx : h.x)).sort((a, b) => a - b); // for the HUD hint
  const lanesOf = (h) => G.hzLanes.get(h);
  A.buildSpikes(lv, root, M, lanesOf);
  for (const s of lv.saws) for (const lx of laneXs(lanesOf(s))) { const { g, disc } = A.makeSaw(s.r, M); add(g); G.dyn.push({ k: 'saw', o: s, g, disc, lx }); }
  for (const s of lv.spinners) for (const lx of laneXs(lanesOf(s))) { const g = add(A.makeSpinner(s.len, M)); G.dyn.push({ k: 'spin', o: s, g, lx }); }
  for (const s of lv.pulses) { const g = add(A.makePulse(s, M, lanesOf(s))); g.position.set(0, s.y, wz(s.x)); G.dyn.push({ k: 'pulse', o: s, g }); }
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
    const g = add(h.type === 'gate' ? A.makeGate(M, h.lanes, LANE_W, LN.GATE_Y) : A.makeHurdle(M, h.lanes, LANE_W));
    g.position.set(0, h.y, wz(h.x + h.w / 2));
    for (const ln of h.lanes) {
      const len = 4.5, m = new THREE.Mesh(new THREE.PlaneGeometry(LANE_W * 0.94, len), h.type === 'gate' ? LANE_MARK.gate : LANE_MARK.hurdle);
      m.rotation.x = -Math.PI / 2; m.position.set(ln * LANE_W, h.y + 0.025, wz(h.x - len / 2 + h.w)); add(m);
    }
  }
  G.player = add(A.makeHero(PW, PH)); G.player.userData.dyn = true;
  G.mark = add(A.makeFloorMark()); G.mark.userData.dyn = true;
  for (const d of G.dyn) d.g.userData.dyn = true;
  A.bakeStatic(root); // merge everything that never moves into a few big meshes (far fewer draw calls)
  BD.patchTree(root, sceneryMats);
  // the ground heights, for the shadow under the hero
  G.tops = lv.solids.filter((s) => s.y1 > s.y0).map((s) => [s.x, s.x + s.w, s.y1]);
}

const laneMark = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
const LANE_MARK = { gate: laneMark(0xff3048), hurdle: laneMark(0xffb020) };
// world x of each lane an obstacle is in (a full-width obstacle is drawn once, in the middle)
const laneXs = (lanes) => (lanes ? lanes.map((l) => l * LANE_W) : [0]);

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
    const n = Math.min(8, Math.round(dt * (MOBILE ? 110 : 240)));
    for (let k = 0; k < n; k++) {
      // flames lick up off the crown and the two sides, then trail away as the cube runs on
      const side = Math.random() < 0.5 ? (Math.random() < 0.5 ? -1 : 1) : 0;
      const fx = side ? side * (0.42 + Math.random() * 0.08) : (Math.random() - 0.5) * 0.6;
      const fyy = side ? fy - 0.2 + Math.random() * 0.6 : fy + 0.42 + Math.random() * 0.15;
      flames.emit(lx + fx, fyy, fz - 0.1 + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.4, 0.9 + Math.random() * 0.9, 0.4 + Math.random() * 0.6, 0.3 + Math.random() * 0.25);
    }
  }
}

const smooth = (t) => t * t * (3 - 2 * t);
// coin glints pulse and turn, each coin on its own rhythm
function twinkle(g, wall) {
  const gl = g.userData.glint; if (!gl) return;
  const k = Math.max(0, Math.sin(wall * 0.004 + g.position.z * 0.7));
  gl.scale.setScalar(gl.userData.base * (0.35 + 0.9 * k * k)); gl.material.rotation = wall * 0.0012; gl.material.opacity = 0.4 + 0.6 * k;
}
const TMP = { x: 0, y: 0 };
function updateDynamic(t, wall) {
  const p = G.p;
  for (const d of G.dyn) {
    if (d.k === 'saw') { sawPos(d.o, t, TMP); d.g.position.set(d.lx, TMP.y, wz(TMP.x)); d.disc.rotation.x = -t * 8; }
    else if (d.k === 'spin') { d.g.position.set(d.lx, d.o.cy, wz(d.o.cx)); d.g.rotation.x = spinnerAngle(d.o, t); }
    else if (d.k === 'pulse') d.g.visible = pulseOn(d.o, t);
    else if (d.k === 'plat') { platPos(d.o, t, TMP); d.g.position.set(0, TMP.y + d.o.h / 2, wz(TMP.x + d.o.w / 2)); }
    else if (d.k === 'coin') { d.g.rotation.y = wall * 0.0025; d.g.visible = !(p.coinsUsed && p.coinsUsed[d.i]); twinkle(d.g, wall); }
    else if (d.k === 'secret') { d.g.rotation.y = wall * 0.004; d.g.visible = !(p.secretsGot && p.secretsGot[d.o.i]); twinkle(d.g, wall); }
    else if (d.k === 'portal') d.disc.rotation.z = -wall * 0.003;
    else if (d.k === 'orb') d.g.children[1].rotation.x = wall * 0.003;
  }
  for (const f of G.floaters) f.rotation.y = wall * 0.0004;
  if (G.gears) G.gears.forEach((g, i) => { g.rotation.z = wall * 0.0008 * (i % 2 ? -1.6 : 1); });
}

// 3/4 view: the chase camera sits CHASE_ANGLE degrees off to the right of the track, CHASE_DIST back, looking well ahead
const CHASE_ANGLE = 52;
const CHASE_DIST = 10.5;
const BEND_P = new THREE.Vector3(), BEND_L = new THREE.Vector3();
function updateCamera(v, dt) {
  const z = wz(v.x), y = v.y;
  // the camera follows height slowly, so jumps don't bob the whole screen
  G.camY = G.camY === undefined || G.camPos.lengthSq() === 0 ? y * 0.6 : G.camY + (y * 0.6 - G.camY) * (1 - Math.exp(-dt * 2.5));
  const want = new THREE.Vector3(), look = new THREE.Vector3();
  if (G.showcase) {
    // skins screen: a slow full orbit close around the hero, which stands in the middle of the screen
    const hp = G.player ? G.player.position : new THREE.Vector3(0, 0.4, -0.4), a = 0.9 + G.attractT * 0.35;
    want.set(hp.x + Math.sin(a) * 3.0, hp.y + 0.75, hp.z + Math.cos(a) * 3.0); look.set(hp.x, hp.y + 0.15, hp.z);
  } else if (G.attract) {
    // main menu: the hero centre stage, the road running away behind it, the camera swaying gently
    const hp = G.player ? G.player.position : new THREE.Vector3(0, 0.4, -0.4), a = 0.75 + Math.sin(G.attractT * 0.2) * 0.3;
    const r = camera.aspect < 1 ? 6.4 : 5.2;
    want.set(hp.x + Math.sin(a) * r, 1.9, hp.z + Math.cos(a) * r); look.set(hp.x, camera.aspect > 1.4 ? 0.95 : 0.55, hp.z); // aimed at the hero (a bit above it on wide screens, so it sits below the logo)
  } else if (G.cam === 'chase') {
    const a = CHASE_ANGLE * Math.PI / 180;
    const lx = G.L ? G.L.lx * LANE_W * 0.7 : 0;
    // gravity mode: glide down below the runner and look up, so the ceiling it runs on (and what hangs there) is in view
    G.gk += ((G.p && G.p.grav < 0 && !G.p.dead ? 1 : 0) - G.gk) * (1 - Math.exp(-dt * 3));
    const up = G.camY + 4.4, under = y - 2.6;
    // behind and to the side, a little high, aimed far down the road so what comes next is on screen early
    want.set(lx + Math.sin(a) * CHASE_DIST, up + (under - up) * G.gk, z + Math.cos(a) * CHASE_DIST);
    look.set(lx * 0.6 - 0.6 - 0.8 * G.gk, G.camY + 0.6 + (y + 0.9 - G.camY - 0.6) * G.gk, z - 13 + 4.5 * G.gk);
  } else if (G.cam === 'close') { want.set(1.7, y + 1.2, z + 1.9); look.set(0, y + 0.45, z - 0.4); } // close-up of the hero (debug / showcase)
  else { want.set(5.5, y * 0.7 + 5.2, z + 7.5); look.set(-0.5, y + 0.8, z - 6); }
  const k = G.camPos.lengthSq() === 0 ? 1 : 1 - Math.exp(-dt * 6); // glide between camera styles; the music clock is not affected
  G.camPos.lerp(want, k); G.camLook.lerp(look, k);
  // on a twist / spiral the camera rides the bent road and rolls with it (most of the way), so the world spins around you
  const cp = BEND_P.copy(G.camPos), cl = BEND_L.copy(G.camLook);
  let roll = 0;
  if (G.cam === 'chase' && !G.attract && !G.showcase) {
    // the whole camera rig turns around the road's axis with the runner (fully on a spiral, 3/4 on a twist): the hero keeps its place on screen,
    // the road ahead visibly twists, and the sky and islands swing round
    const bd = BD.angleAt(v.x + PW / 2); roll = bd.a * (bd.z && bd.z.kind === BD.SPIRAL ? 1 : 0.75);
    if (roll) for (const q of [cp, cl]) { const c = Math.cos(roll), sn = Math.sin(roll), yy = q.y - bd.py; const xx = q.x * c - yy * sn; q.y = q.x * sn + yy * c + bd.py; q.x = xx; }
  }
  camera.up.set(-Math.sin(roll), Math.cos(roll), 0);
  camera.position.copy(cp);
  camera.lookAt(cl);
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
    burst.fire(G.player.position, kind === 'perfect' ? 0xffe08a : 0x9ff5d2);
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
  return [stageTag(), (stageDef() ? stageDef().name : '') + (G.stage > 2 ? ' · round ' + (G.stage - 1) : '')];
}
function nextMove(p, ct) {
  if (p.mode === MODE.SHIP) return ['HOLD ↑', 'TO FLY'];
  if (p.mode === MODE.WAVE) return ['HOLD / RELEASE', 'ZIG-ZAG'];
  const ct2 = G.cueT; let lo = 0, hi = ct2.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (ct2[m] < ct + 0.03) lo = m + 1; else hi = m; }
  if (lo >= ct2.length) return ['STAGE END', ''];
  const beats = (ct2[lo] - ct) / G.level.spb;
  const h = G.hz && G.hz.list.slice(G.hz.from, G.hz.from + 3).find((q) => q.x + q.w > p.x);
  if (h) {
    const hb = (h.x - p.x) / G.level.speed / G.level.spb;
    if (hb < beats && hb < 6) return [LN.hint(h, G.L.lane), hb.toFixed(1) + ' BEATS'];
  }
  // the beat-jump's obstacle can also be dodged when it only covers some lanes
  const cx = ct2[lo] * G.level.speed;
  const split = G.splitXs && G.splitXs.some((x) => x > cx - 1 && x < cx + 4);
  return [(p.grav < 0 ? 'JUMP ↓' : 'JUMP ↑') + (split ? ' or DODGE' : ''), beats > 8 ? '' : beats.toFixed(1) + ' BEATS'];
}
const pad = (n) => String(Math.floor(n)).padStart(5, '0');
function hud(p, ct) {
  const lv = G.level;
  G.score = Math.floor(G.distBank + p.furthest * 5 + G.bonus);
  const [sec, sub] = sectionLabel(p, ct);
  const bz = BD.getZones().find((z) => p.furthest < z.x1 && p.furthest > z.x0 - 3 * lv.speed);
  $('h-sec').textContent = sec; $('h-flavor').textContent = bz ? (bz.kind === BD.SPIRAL ? '🌀 SPIRAL!' : '〰 TWIST!') : sub.toUpperCase();
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

// ---------- smoothness: keep the frame rate up by lowering the render resolution if needed ----------
let fAvg = 16.7, fCheck = 0;
function autoQuality(ms, wall) {
  if (document.hidden || quality !== 'auto') return; // High and Ultra keep the resolution you picked
  fAvg += (Math.min(ms, 100) - fAvg) * 0.05;
  if (wall < fCheck) return;
  fCheck = wall + 2000;
  const floor = MOBILE ? 0.6 : 0.75;
  if (fAvg > 22 && dpr > floor) { dpr = Math.max(floor, dpr - 0.2); resize(); }         // struggling: render fewer pixels
  else if (fAvg < 13 && dpr < QUALITY.auto.dpr()) { dpr = Math.min(QUALITY.auto.dpr(), dpr + 0.2); resize(); } // headroom: sharpen back up
}

// ---------- main loop ----------
let lastDraw = 0;
function frame(wall, once) {
  if (!once) requestAnimationFrame(frame);
  // phones: cap at 60 fps (120 Hz screens would otherwise double the work and drain the battery)
  if (MOBILE && wall - lastDraw < 15) return;
  lastDraw = wall;
  renderer.info.reset();
  autoQuality(wall - G.wall, wall);
  grade.uniforms.time.value = (wall % 10000) / 1000;
  const dt = Math.max(0, Math.min(0.1, (wall - G.wall) / 1000 || 0.016)); G.wall = wall;
  const lv = G.level; if (!lv) { composer.render(); return; }
  const p = G.p;
  let ct = G.clock.t;
  if (G.attract) {
    G.attractT += dt; ct = 0;
    const v = { x: 0, y: 0, rot: 0 };
    p.x = 0;
    // idle: a happy little hop every second or so (looks only)
    const hop = Math.max(0, Math.sin(G.attractT * 3.2)); p.grounded = hop < 0.05;
    updatePlayer({ x: 0, y: G.showcase ? 0 : hop * hop * 0.45, rot: 0 }, p, dt); updateDynamic(G.attractT, wall);
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
          // collide only with the obstacles in the lane(s) the runner is in
          const evs = step(G.lvLanes[LN.laneKey(G.L.lx, LANE_W, PW)] || lv, p, DT, G.press); G.press = false;
          for (let i = 0; i < evs.length; i++) {
            const e = evs[i];
            if (e === EV.DEAD) crashed(wall);
            else if (e === EV.FINISH) stageClear();
            else if (e === EV.JUMP) { G.L.roll = 0; G.L.rollBuf = 0; if (pressed || p.mode === MODE.CUBE) rateJump(p.t); }
            else if (e === EV.COIN) { G.coins++; G.bonus += 500; i++; G.quizReq = true; }
            else if (e === EV.SECRET) { G.coins++; G.bonus += 1000; i++; }
            else if (e === EV.CHECKPOINT || e === EV.PORTAL || e === EV.ORB || e === EV.MODE) i++;
          }
          LN.stepLane(G.L, DT, p.grounded, p.mode === MODE.CUBE && p.grav > 0);
          if (!p.dead && !p.finished && LN.hitsLaneHazard(G.hz, p, G.L, PW, PH, LANE_W)) { p.dead = true; p.deathReason = 'lane'; crashed(wall); }
          if (p.dead || p.finished || G.quizReq) break;
        }
        if (G.quizReq && !p.dead) openQuiz();
        G.quizReq = false;
      }
    }
    const v = { x: p.x, y: p.y, rot: p.rot };
    const q = G.prev;
    if (q && !p.dead && p.t > q.t) { const a = Math.max(0, Math.min(1, (ct - q.t) / (p.t - q.t))); v.x = q.x + (p.x - q.x) * a; v.y = q.y + (p.y - q.y) * a; v.rot = q.rot + (p.rot - q.rot) * a; }
    updatePlayer(v, p, dt); updateDynamic(ct, wall); updateCamera(v, dt);
    if (G.player) BD.patchLive(G.player); // the hero follows twists / spirals (its Blender model can load late)
    if (shake > 0) { shake = Math.max(0, shake - dt); camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; }
    hud(p, ct);
  }
  if (G.player) { const pp = G.player.position; sun.position.set(pp.x - 6, pp.y + 14, pp.z + 5); sun.target.position.copy(pp); }
  sparks.update(dt); flames.update(dt); burst.update(dt);
  FX.fxTime.value = wall / 1000;
  if (G.player) streaks.update(dt, G.player.position, G.playing && !G.paused && !G.attract);
  clouds.update(camera.position, wall / 1000);
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

// end of the song = stage clear: bonus, then the song starts again with the next (harder) stage. Never a "level complete".
function stageClear() {
  G.playing = false; audio.fadeOutMusic && audio.fadeOutMusic(0.8);
  G.bonus += 1000 * Math.min(3, G.stage + 1) + G.lives * 500;
  G.distBank += G.p.furthest * 5;
  banner('STAGE CLEAR', 'Well done, pilgrim', 'NEXT: ' + stageTag(G.stage + 1), 1700);
  const run = G.runId;
  setTimeout(() => { if (run === G.runId) loadStage(G.stage + 1); }, 1800);
}
let bannerT = 0;
function banner(top, main, sub, ms) {
  $('b-top').textContent = top; $('b-main').textContent = main; $('b-sub').textContent = sub; $('banner').classList.remove('hidden');
  clearTimeout(bannerT); bannerT = setTimeout(() => $('banner').classList.add('hidden'), ms);
}

// ---------- coin gates: a question from the trivia deck ----------
// right: +1 life (up to 3), multiplier up (+0.5) and bonus points. wrong: nothing lost, the run goes on.
const deal = triviaDeck();
let quizQ = null, quizDone = false;
function openQuiz() {
  G.quiz = true; G.paused = true; quizDone = false; audio.suspend();
  quizQ = deal();
  $('qtext').textContent = quizQ.q; $('qref').textContent = quizQ.ref.toUpperCase();
  $('qresult').textContent = ''; $('qresult').className = '';
  const box = $('qchoices'); box.innerHTML = '';
  quizQ.choices.forEach((c, i) => {
    const b = document.createElement('button'); b.innerHTML = `<i>${i + 1}</i>`; b.appendChild(document.createTextNode(c));
    b.onclick = () => answer(i); box.appendChild(b);
  });
  $('quiz').classList.remove('hidden');
}
function answer(i) {
  if (!G.quiz || quizDone) return;
  quizDone = true;
  const btns = [...$('qchoices').children], ok = i === quizQ.answer;
  btns[quizQ.answer].classList.add('right'); if (!ok) btns[i].classList.add('wrong');
  if (ok) {
    const had = G.lives; G.lives = Math.min(LIVES, G.lives + 1);
    G.streak += MULT_STEP * 2; G.best = Math.max(G.best, G.streak);
    const pts = Math.round(1000 * mult()); G.bonus += pts;
    $('qresult').textContent = `Correct! ${G.lives > had ? '+1 life · ' : ''}multiplier ×${mult().toFixed(2)} · +${pts}`; $('qresult').className = 'good';
    if (audio.sfx) audio.sfx('perfect');
  } else { $('qresult').textContent = 'Not quite. Keep going!'; $('qresult').className = 'bad'; }
  setTimeout(closeQuiz, ok ? 1300 : 2200);
}
function closeQuiz() {
  $('quiz').classList.add('hidden');
  if (!G.quiz) return;
  G.quiz = false; G.paused = false; audio.wake(); G.wall = performance.now();
}
function gameOver() {
  G.playing = false; audio.fadeOutMusic && audio.fadeOutMusic(0.6);
  results('Out of lives', 'You reached ' + stageTag().toLowerCase().replace('stage', 'stage') + '. Get up and run again.');
}
// best score per song, kept on this device
const bestOf = (song) => { try { return +localStorage.getItem('faithdash3d.best.' + song) || 0; } catch { return 0; } };
function saveBest(song, s) { if (s <= bestOf(song)) return false; try { localStorage.setItem('faithdash3d.best.' + song, String(s)); } catch { /* fine */ } return true; }
function results(title, sub) {
  G.playing = false; $('msg').classList.add('hidden');
  if (saveBest(G.level.song, G.score)) sub = '★ New best score! ★';
  $('o-title').textContent = title; $('o-sub').textContent = sub;
  $('o-score').textContent = pad(G.score); $('o-best').textContent = G.best; $('o-coins').textContent = G.coins;
  $('o-prog').textContent = G.stage + 1 + ' · ' + STAGE_NAMES[Math.min(2, G.stage)];
  show('over');
}

// a new run on the chosen song: stage 1 (easy), full lives, score from zero
async function start(song) {
  G.runId = (G.runId || 0) + 1; const run = G.runId;
  G.song = song; G.stage = 0; G.deaths = 0; G.ended = false; G.paused = false; G.quiz = false; $('quiz').classList.add('hidden');
  G.lives = LIVES; G.score = 0; G.bonus = 0; G.distBank = 0; G.streak = 0; G.best = 0; G.coins = 0; G.attract = false;
  setStage(0);
  show('hud');
  $('msg').textContent = 'Loading song...'; $('msg').classList.remove('hidden');
  audio.unlock();
  try { G.songOk = await audio.loadSong(song); } catch { G.songOk = false; }
  for (const [txt, ms] of [['3', 650], ['2', 650], ['1', 650]]) { if (run !== G.runId) return; $('msg').textContent = txt; await new Promise((r) => setTimeout(r, ms)); }
  if (run !== G.runId) return;
  $('msg').classList.add('hidden');
  banner(stageTag(), stageDef().name, SONGS[song].toUpperCase(), 1600);
  go();
}
// the next time round: same song from the top, a harder layout; lives, score and multiplier carry over
function loadStage(stage) {
  setStage(stage);
  banner(stageTag(), stageDef().name + (stage > 2 ? ' · round ' + (stage - 1) : ''), 'THE SONG GOES ROUND AGAIN, FASTER', 1800);
  go();
}
function setStage(stage) {
  G.stage = stage;
  const lv = getLevel(stageId(G.song, stage));
  if (!G.level || G.level.id !== lv.id) buildWorld(lv);
  G.level = lv; G.p = newPlayer(lv); G.prev = null; G.camPos.set(0, 0, 0); G.gk = 0;
  G.L = LN.newLaneState(); G.laneReq = 0; G.rollReq = false; if (G.hz) G.hz.from = 0; G.wasGrounded = true;
  G.cueT = (lv.cues || []).map((c) => c.t).sort((a, b) => a - b);
  $('h-title').textContent = `${SONGS[G.song] || ''} · ${stageTag()}`.toUpperCase();
}
function go() {
  const lv = G.level;
  if (G.songOk && audio.startSong(lv.song, 0, lv.cues)) G.clock.reset(audio.songTime()); else G.clock.reset(0);
  G.wall = performance.now(); G.playing = true;
}

function pause(on) {
  if (!G.playing || G.ended || G.quiz) return;
  G.paused = on;
  if (on) audio.suspend(); else { audio.wake(); G.wall = performance.now(); }
  show(on ? 'pause' : 'hud');
}
function toMenu() {
  audio.wake(); audio.stopMusic && audio.stopMusic();
  G.runId = (G.runId || 0) + 1; G.quiz = false; $('quiz').classList.add('hidden'); $('banner').classList.add('hidden');
  G.playing = false; G.paused = false; G.attract = true; G.camPos.set(0, 0, 0);
  previewLevel(G.sel);
  show('menu');
}
// the menu shows the chosen song's first (easy) stage behind the hero
function previewLevel(song) {
  G.sel = song; G.song = song; G.stage = 0;
  const id = stageId(song, 0), lv = getLevel(id);
  if (!G.level || G.level.id !== id) buildWorld(lv);
  G.level = lv; G.p = newPlayer(lv); G.prev = null; G.L = LN.newLaneState();
  $('sname').textContent = SONGS[song];
  $('smeta').textContent = `${Math.round(lv.bpm || LEVEL_DEFS.find((d) => d.id === id).bpm)} BPM · EASY → HARD`;
  $('sbest').textContent = pad(bestOf(song));
  $('mbest').textContent = pad(Math.max(...SONG_IDS.map((s) => bestOf(s))));
  [...$('sdots').children].forEach((el, i) => el.classList.toggle('on', SONG_IDS[i] === song));
}

// ---------- input: same everywhere, never depends on the camera ----------
const down = () => { if (!G.playing || G.paused) return; G.press = true; G.hold = true; };
const lane = (d) => { if (G.playing && !G.paused) G.laneReq = d; };
const roll = () => { if (G.playing && !G.paused) G.rollReq = true; };
const up = () => { G.hold = false; };
window.addEventListener('keydown', (e) => {
  if (G.quiz && !/^Digit/.test(e.code)) return; // answering a question: the game keys wait
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); if (!e.repeat) down(); }
  else if ((e.code === 'ArrowLeft' || e.code === 'KeyA') && !e.repeat) { e.preventDefault(); lane(-1); }
  else if ((e.code === 'ArrowRight' || e.code === 'KeyD') && !e.repeat) { e.preventDefault(); lane(1); }
  else if ((e.code === 'ArrowDown' || e.code === 'KeyS') && !e.repeat) { e.preventDefault(); roll(); }
  else if (e.code === 'KeyC' && !e.repeat) G.cam = G.cam === 'chase' ? 'drone' : 'chase';
  else if ((e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) pause(!G.paused);
  else if (G.quiz && /^Digit[1-4]$/.test(e.code)) { const i = +e.code.slice(5) - 1; if (quizQ && i < quizQ.choices.length) answer(i); }
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
const tapJumps = (e) => e.pointerType === 'mouse' || !MOBILE; // touch: jump with the ▲ button, so a swipe never jumps by mistake
canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); swipeStart(e); if (tapJumps(e)) down(); });
$('hud').addEventListener('pointerdown', (e) => { if (e.target.closest('button') || e.target.closest('#pad')) return; e.preventDefault(); swipeStart(e); if (tapJumps(e)) down(); });
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
  renderer.setPixelRatio(dpr); composer.setPixelRatio(dpr);
  const q = QUALITY[quality];
  renderer.setSize(w, h, false); composer.setSize(w, h); bloom.setSize(w * dpr * q.bloom, h * dpr * q.bloom); // Auto: glow at half size
  grade.uniforms.texel.value.set(1 / (w * dpr), 1 / (h * dpr));
  flames.setScale(h * dpr);
  camera.aspect = w / h; camera.fov = w < h ? 70 : 52; camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize); resize();

// menu wiring
// song carousel: arrows, a swipe on the card, and dots
for (const s of SONG_IDS) $('sdots').appendChild(document.createElement('i'));
const stepSong = (k) => { const i = SONG_IDS.indexOf(G.sel); previewLevel(SONG_IDS[(i + k + SONG_IDS.length) % SONG_IDS.length]); };
$('sprev').onclick = () => stepSong(-1);
$('snext').onclick = () => stepSong(1);
let cardX = null;
$('scard').addEventListener('pointerdown', (e) => { cardX = e.clientX; });
$('scard').addEventListener('pointerup', (e) => { if (cardX !== null && Math.abs(e.clientX - cardX) > 30) stepSong(e.clientX < cardX ? 1 : -1); cardX = null; });
window.addEventListener('keydown', (e) => { if (!$('menu').classList.contains('hidden') && !e.repeat) { if (e.code === 'ArrowLeft') stepSong(-1); else if (e.code === 'ArrowRight') stepSong(1); else if (e.code === 'Enter') $('play').click(); } });
// settings sheet
$('settingsbtn').onclick = () => $('settings').classList.remove('hidden');
$('settingsclose').onclick = () => $('settings').classList.add('hidden');
$('introbtn').onclick = () => { $('settings').classList.add('hidden'); $('replay').click(); };
// phones: go fullscreen and turn sideways when the run starts, where the browser allows it (Android Chrome does;
// iPhone Safari does not, so there the game simply fills the page). Still a web page, nothing installed.
function phoneFullscreen() {
  if (!MOBILE) return;
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req && !document.fullscreenElement) {
    Promise.resolve(req.call(el, { navigationUI: 'hide' })).then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
  }
}
$('play').onclick = () => { phoneFullscreen(); start(G.sel); };
$('pausebtn').onclick = () => pause(true);
$('resume').onclick = () => pause(false);
$('restart').onclick = () => { audio.wake(); audio.stopMusic && audio.stopMusic(); G.paused = false; G.playing = false; start(G.sel); };
$('quit').onclick = toMenu;
$('again').onclick = () => start(G.sel);
// iPhone / iPad Safari: a web page can't hide Safari's bars. Added to the Home Screen it opens full screen (no bars, no tabs).
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const STANDALONE = navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches);
let tipSeen = false; try { tipSeen = !!localStorage.getItem('faithdash3d.iostip'); } catch { /* fine */ }
if (IOS && !STANDALONE && !tipSeen) $('iostip').classList.remove('hidden');
$('iosok').onclick = () => { $('iostip').classList.add('hidden'); try { localStorage.setItem('faithdash3d.iostip', '1'); } catch { /* fine */ } };
$('menubtn').onclick = toMenu;
// ---------- quality button (menu top bar and pause card) ----------
function applyQuality(id) {
  quality = id; const q = QUALITY[id];
  try { localStorage.setItem('faithdash3d.quality', id); } catch { /* fine */ }
  dpr = q.dpr();
  const s = Math.min(q.samples, renderer.capabilities.maxSamples || 4);
  if (composer.renderTarget1.samples !== s) { for (const rt of [composer.renderTarget1, composer.renderTarget2]) { rt.samples = s; rt.dispose(); } }
  if (sun.shadow.mapSize.x !== q.shadow) { sun.shadow.mapSize.set(q.shadow, q.shadow); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  grade.uniforms.sharpen.value = q.sharpen; grade.uniforms.grain.value = q.grain;
  A.setSkyQuality(id === 'ultra');
  $('quality2').textContent = '⚙ Quality: ' + q.name;
  for (const b of $('qseg').children) b.classList.toggle('on', b.dataset.q === id);
  resize();
}
const nextQ = () => applyQuality(quality === 'auto' ? 'high' : quality === 'high' && !MOBILE ? 'ultra' : 'auto'); // no Ultra on phones
$('quality2').onclick = nextQ;
for (const b of $('qseg').children) { if (b.dataset.q === 'ultra' && MOBILE) b.remove(); else b.onclick = () => applyQuality(b.dataset.q); } // no Ultra on phones

// ---------- cube customisation (saved on this device) ----------
let skinId = 'flame';
try { skinId = localStorage.getItem('faithdash3d.skin') || 'flame'; } catch { /* storage blocked: use the default */ }
function useSkin(id) {
  const s = A.SKINS.find((q) => q.id === id) || A.SKINS[0];
  skinId = s.id; A.setHeroSkin(s); G.flameCols = s.flames; flames.setColors(s.flames);
  try { localStorage.setItem('faithdash3d.skin', s.id); } catch { /* fine */ }
  for (const b of document.querySelectorAll('.skin')) b.classList.toggle('on', b.dataset.id === s.id);
  $('skinname').textContent = s.name; $('skindesc').textContent = s.desc;
}
for (const s of A.SKINS) {
  const b = document.createElement('button'); b.className = 'skin'; b.dataset.id = s.id; b.title = s.name;
  b.style.setProperty('--a', s.swatch[0]); b.style.setProperty('--b', s.swatch[1]);
  b.onclick = () => useSkin(s.id);
  $('skins').appendChild(b);
}
$('customize').onclick = () => { G.showcase = true; G.attractT = 0; $('menu').classList.add('hidden'); $('custom').classList.remove('hidden'); };
const closeSkins = () => { G.showcase = false; G.camPos.set(0, 0, 0); $('custom').classList.add('hidden'); $('menu').classList.remove('hidden'); };
$('customdone').onclick = closeSkins; $('customback').onclick = closeSkins;
useSkin(skinId);
applyQuality(quality);

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
document.querySelector('.mlogo img').src = logoUrl;

show('menu');
// build the first world once the Blender models are in (falls back to code shapes if they fail)
A.loadAssets().finally(() => previewLevel('drop'));
if (new URLSearchParams(location.search).has('nointro')) $('intro').classList.add('hidden'); else playIntro();
window.__fd3 = { G, start, THREE, scene, camera, renderer, bloom, flames, sparks, stageClear, openQuiz, answer, loadStage, BD, frame }; // test hooks only (frame(t, true) draws one frame)
requestAnimationFrame(frame);
