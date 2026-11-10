// Faith Dash 3D art: everything here is LOOKS ONLY. It turns the level data (sim.js / levelgen.js) into a floating-island
// world: painted sky, islands with trees, a stone-and-grass track, crystal spikes, gear saws, laser bars, gold cross coins,
// swirl portals and the cube hero. Nothing here changes the game rules or the hit-boxes.
import * as THREE from 'three';
import bg0Url from '../assets/bg0.jpg';
import bg1Url from '../assets/bg1.jpg';
import bg2Url from '../assets/bg2.jpg';
import stoneUrl from '../assets/tex0.jpg';
import brickUrl from '../assets/tex1.jpg';
import coinUrl from '../assets/coin.webp';
import { MODE } from '../game/sim.js';
import { makeGlint, vortexMaterial } from './fx3d.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import heroGlbUrl from '../assets/models/hero.glb?url';
import crystalsUrl from '../assets/models/crystals.glb?url';
import sawUrl from '../assets/models/saw.glb?url';
import portalUrl from '../assets/models/portal.glb?url';
import coinGlbUrl from '../assets/models/coin.glb?url';
import platformUrl from '../assets/models/platform.glb?url';
import hurdleUrl from '../assets/models/hurdle.glb?url';
import gateUrl from '../assets/models/gate.glb?url';
import island1Url from '../assets/models/island1.glb?url';
import island2Url from '../assets/models/island2.glb?url';
import island3Url from '../assets/models/island3.glb?url';

export const TRACK_W = 3.6; // drawn width of the track (the game itself has one lane)

const loader = new THREE.TextureLoader();
const texCache = new Map();
function tex(url, { repeat = true, mirror = false } = {}) {
  const key = url + repeat + mirror;
  if (texCache.has(key)) return texCache.get(key);
  const t = loader.load(url);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (mirror) t.wrapS = THREE.MirroredRepeatWrapping;
  texCache.set(key, t);
  return t;
}
function canvasTex(size, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
// ---------------------------------------------------------------- Blender-made models (tools/blender/world_assets.py)
// Loaded once, before the first level is built. Every builder below uses its model when it loaded, or falls back to
// the simple code-built shape.
export const ASSETS = {};
const GLB = { crystals: crystalsUrl, saw: sawUrl, portal: portalUrl, coin: coinGlbUrl, platform: platformUrl, hurdle: hurdleUrl, gate: gateUrl, island1: island1Url, island2: island2Url, island3: island3Url };
function prepModel(m) {
  m.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mt = o.material;
    mt.emissiveIntensity *= 0.2;          // Blender emission strengths are far brighter in a live game with glow
    if (mt.metalness > 0.9) mt.envMapIntensity = 1.0; // they reflect the sky now (fx3d.skyEnvCanvas)
    if (mt.transparent) mt.depthWrite = false;
  });
  return m;
}
export function loadAssets() {
  const gl = new GLTFLoader();
  return Promise.all(Object.entries(GLB).map(([k, url]) => gl.loadAsync(url).then((g) => { ASSETS[k] = prepModel(g.scene); }).catch((e) => console.warn('model failed', k, e)))).then(() => ASSETS);
}
// one geometry per material, in the model's own space (used for instancing many copies in one draw call)
function modelParts(m) {
  m.updateMatrixWorld(true);
  const by = new Map();
  m.traverse((o) => {
    if (!o.isMesh) return;
    let g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    if (!by.has(o.material)) by.set(o.material, []);
    by.get(o.material).push(g);
  });
  return [...by].map(([mat, gs]) => ({ mat, geo: gs.length > 1 ? mergeGeometries(gs, false) : gs[0] }));
}
// Copies are split into chunks of road (CHUNK tiles long) so the browser can skip every chunk that is off screen or
// lost in the fog: on a phone that is the difference between drawing the whole course and drawing the next few seconds.
export const CHUNK = 80;
export function instanceModel(root, model, mats) {
  const chunks = new Map();
  for (const m4 of mats) { const c = Math.floor(-m4.elements[14] / CHUNK); if (!chunks.has(c)) chunks.set(c, []); chunks.get(c).push(m4); }
  for (const { mat, geo } of modelParts(model)) {
    if (!geo) continue;
    for (const list of chunks.values()) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((m4, i) => im.setMatrixAt(i, m4));
      im.computeBoundingSphere(); im.frustumCulled = true;
      root.add(im);
    }
  }
}
const place = (o, x, y, z, ry, sx, sy = sx, sz = sx, rx = 0) => { o.position.set(x, y, z); o.rotation.set(rx, ry, 0); o.scale.set(sx, sy, sz); o.updateMatrix(); return o.matrix.clone(); };

// small seeded random so the scenery is the same every run of a level
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// ---------------------------------------------------------------- per-level looks
export const THEMES = [
  { bg: bg0Url, fog: 0x4b3d9a, fogNear: 45, fogFar: 230, grass: 0x9cc96a, rim: 0x5b8f3a, glow: 0x8dff6a, crystal: [0xc58bff, 0xe9f4ff, 0x7fe8ff] },
  { bg: bg1Url, fog: 0x3a3f8f, fogNear: 45, fogFar: 230, grass: 0x8fd08a, rim: 0x4f8f5a, glow: 0x6affd2, crystal: [0x7fe8ff, 0xe9f4ff, 0xb48bff] },
  { bg: bg2Url, fog: 0x5a347e, fogNear: 45, fogFar: 230, grass: 0xc6c96a, rim: 0x8f7a3a, glow: 0xffd36a, crystal: [0xff8bd0, 0xfff1e0, 0xffc46a] },
];
export const MCOL = (m) => (m.mode === MODE.SHIP ? 0xff6ad5 : m.mode === MODE.WAVE ? 0x39e6ff : m.grav < 0 ? 0xffd23a : 0x4dff9a);

// A box whose texture repeats every `tile` world units instead of stretching. Faces: +x,-x,+y,-y,+z,-z.
function tiledBox(w, h, d, tile, sideTop = false) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [du, dv] = dims[f];
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      let u = uv.getX(k) * du / tile, v = uv.getY(k) * dv / tile;
      if (f === 2 || f === 3) { u = uv.getX(k); v = uv.getY(k) * dv / tile; } // top: the texture spans the full width once
      else if (sideTop) v = 1 - (1 - uv.getY(k)) * dv / tile; // sides: grass edge of the texture lines up with the top
      uv.setXY(k, u, v);
    }
  }
  return g;
}

// ---------------------------------------------------------------- sky
// The painted panorama fills the screen behind everything (it can never show an edge). The game drifts it sideways as
// the camera moves, so it feels far away. Once loaded, its cloud colour is handed to the fog so islands fade into it.
// an 8K version of the sky (src/assets/bg0_8k.jpg or .webp) is used on Ultra quality, if it exists
const SKY_HI = Object.values(import.meta.glob('../assets/bg0_8k.*', { eager: true, query: '?url', import: 'default' }))[0] || null;
let skyHi = false, skyTex = null, skyTheme = null;
export function setSkyQuality(ultra) {
  if (skyHi === ultra) return;
  skyHi = ultra;
  if (skyTex && SKY_HI) loader.load(ultra ? SKY_HI : skyTheme.bg, (tt) => { skyTex.image = tt.image; skyTex.userData.aspect = tt.image.width / tt.image.height; skyTex.needsUpdate = true; });
}
export const hasSkyHi = () => !!SKY_HI;
export function makeSky(theme) {
  skyTheme = theme;
  const t = loader.load(skyHi && SKY_HI ? SKY_HI : theme.bg, (tt) => apply(tt.image));
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.MirroredRepeatWrapping; t.anisotropy = 8;
  skyTex = t;
  function apply(img) {
    t.userData.aspect = img.width / img.height;
    const c = document.createElement('canvas'); c.width = 64; c.height = 8;
    const x = c.getContext('2d'); x.drawImage(img, 0, Math.floor(img.height * 0.7), img.width, 8, 0, 0, 64, 8);
    const d = x.getImageData(0, 0, 64, 8).data; let r = 0, gg = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4, col = new THREE.Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace);
    if (onSkyColor) onSkyColor(col, img);
  }
  return t;
}
// crop the panorama to the screen ("cover"), shifted by `pan` (0..1) and slightly zoomed for drift room
export function fitSky(t, screenAspect, pan, tilt) {
  const ia = t.userData.aspect || 3.5, zoom = 0.86;
  const rx = Math.min(1, screenAspect / ia) * zoom, ry = Math.min(1, ia / screenAspect) * zoom;
  t.repeat.set(rx, ry);
  t.offset.set((1 - rx) / 2 + pan, (1 - ry) / 2 + tilt * (1 - ry) / 2);
}
let onSkyColor = null;
export function setSkyColorHook(fn) { onSkyColor = fn; }

// ---------------------------------------------------------------- shared materials
export function makeMats(theme) {
  const stone = tex(stoneUrl);
  const M = {
    top: roadMat(),
    side: new THREE.MeshStandardMaterial({ map: stone, roughness: 0.95, color: 0x56607e }),
    neon: new THREE.MeshBasicMaterial({ color: 0x55ecff, toneMapped: false }),
    under: new THREE.MeshStandardMaterial({ color: 0x23233a, roughness: 1 }),
    edge: new THREE.MeshStandardMaterial({ color: theme.rim, emissive: theme.glow, emissiveIntensity: 0.45, roughness: 0.6 }),
    lane: new THREE.MeshBasicMaterial({ color: 0xbff6ff, transparent: true, opacity: 0.35, depthWrite: false }),
    crystal: theme.crystal.map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.9, roughness: 0.1, metalness: 0.15, flatShading: true })),
    metal: new THREE.MeshStandardMaterial({ color: 0x9aa3b5, metalness: 0.85, roughness: 0.32 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x3a3c4f, metalness: 0.8, roughness: 0.4 }),
    hot: new THREE.MeshStandardMaterial({ color: 0xff8a2a, emissive: 0xff6a00, emissiveIntensity: 1.6 }),
    laser: new THREE.MeshBasicMaterial({ color: 0xff3a4a, toneMapped: false }),
    gold: new THREE.MeshStandardMaterial({ color: 0xffd23a, emissive: 0xffa800, emissiveIntensity: 0.7, metalness: 0.7, roughness: 0.25 }),
    cyber: new THREE.MeshStandardMaterial({ map: tex(brickUrl), color: 0x4a3f7a, roughness: 0.7 }),
    cyberEdge: new THREE.MeshBasicMaterial({ color: 0xc07bff, toneMapped: false }),
  };
  const ct = tex(coinUrl, { repeat: false });
  M.coinFace = new THREE.MeshStandardMaterial({ map: ct, emissiveMap: ct, emissive: 0xffffff, emissiveIntensity: 0.55, transparent: true, alphaTest: 0.4, metalness: 0.3, roughness: 0.35 });
  return M;
}

// ---------------------------------------------------------------- the track
// Dark slate road panels with cyan neon edges and dashed lane lines, like the intro film. The lines glow (bloom).
const ROAD_TILE = 4; // world units of road per texture repeat
// High-detail (1024 px per 4 tiles) slate panels: brushed grain, scuffs, panel seams with a lit bevel, corner rivets,
// lane dashes and edge lines. A matching bump map makes the seams and rivets catch the light.
function roadMat() {
  const S = 1024;
  const R = rng(4242);
  const rnd = () => R();
  const panels = [0, S / 2]; // two panels per texture repeat (along the road)
  const draw = (kind) => (x, s) => {
    const glow = kind === 'glow', bump = kind === 'bump';
    x.fillStyle = glow ? '#000' : bump ? '#808080' : '#1a1f31'; x.fillRect(0, 0, s, s);
    if (!glow) {
      // brushed grain along the road + soft scuffs
      for (let i = 0; i < 2600; i++) {
        const v = bump ? 120 + rnd() * 20 : 22 + rnd() * 20;
        x.fillStyle = bump ? `rgba(${v},${v},${v},.35)` : `rgba(${v},${v + 4},${v + 18},.45)`;
        x.fillRect(rnd() * s, rnd() * s, 1 + rnd() * 2, 6 + rnd() * 30);
      }
      if (!bump) for (let i = 0; i < 40; i++) { x.strokeStyle = `rgba(150,170,220,${0.04 + rnd() * 0.06})`; x.lineWidth = 1; x.beginPath(); const sx = rnd() * s, sy = rnd() * s; x.moveTo(sx, sy); x.lineTo(sx + (rnd() - 0.5) * 120, sy + (rnd() - 0.5) * 40); x.stroke(); }
      for (const py of panels) {
        // seam (dark groove) with a lit lip just after it
        x.fillStyle = bump ? '#202020' : '#0a0d18'; x.fillRect(0, py, s, 8);
        x.fillStyle = bump ? '#b0b0b0' : 'rgba(140,160,210,.22)'; x.fillRect(0, py + 8, s, 3);
        // rivets at the panel corners and along the seam
        for (const rx of [60, s / 3 - 40, s / 3 + 40, (2 * s) / 3 - 40, (2 * s) / 3 + 40, s - 60]) {
          x.fillStyle = bump ? '#e0e0e0' : '#3a4260'; x.beginPath(); x.arc(rx, py + 26, 7, 0, 7); x.fill();
          if (!bump) { x.fillStyle = 'rgba(200,215,255,.35)'; x.beginPath(); x.arc(rx - 2, py + 24, 2.5, 0, 7); x.fill(); }
        }
      }
    }
    if (!bump) {
      x.fillStyle = '#55ecff';
      for (const lx of [s / 3, (2 * s) / 3]) x.fillRect(lx - 5, s * 0.12, 10, s * 0.3), x.fillRect(lx - 5, s * 0.62, 10, s * 0.3); // lane dashes
      x.fillRect(26, 0, 12, s); x.fillRect(s - 38, 0, 12, s); // inner edge lines
    } else {
      x.fillStyle = '#606060';
      for (const lx of [s / 3, (2 * s) / 3]) x.fillRect(lx - 7, s * 0.12, 14, s * 0.3), x.fillRect(lx - 7, s * 0.62, 14, s * 0.3);
    }
  };
  const mk = (kind, srgb) => { const t = canvasTex(S, draw(kind), srgb); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  return new THREE.MeshStandardMaterial({ map: mk('color', true), emissiveMap: mk('glow', true), bumpMap: mk('bump', false), bumpScale: 2.5, emissive: 0xffffff, emissiveIntensity: 1.3, metalness: 0.55, roughness: 0.36 });
}
export function buildTrack(lv, root, M) {
  for (const s of lv.solids) {
    const h = s.y1 - s.y0; if (h <= 0 || s.w <= 0) continue;
    const m = new THREE.Mesh(tiledBox(TRACK_W, h, s.w, ROAD_TILE, true), [M.side, M.side, M.top, M.under, M.side, M.side]);
    m.position.set(0, s.y0 + h / 2, -(s.x + s.w / 2));
    root.add(m);
    // raised curbs with a neon strip on top, down both edges
    for (const sx of [-1, 1]) {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, s.w), M.darkMetal);
      curb.position.set(sx * (TRACK_W / 2 + 0.02), s.y1 + 0.07, -(s.x + s.w / 2)); root.add(curb);
      const n = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, s.w), M.neon);
      n.position.set(sx * (TRACK_W / 2 + 0.02), s.y1 + 0.155, -(s.x + s.w / 2)); root.add(n);
      const lo = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, s.w), M.neon);
      lo.position.set(sx * (TRACK_W / 2 + 0.005), s.y1 - 0.25, -(s.x + s.w / 2)); root.add(lo);
    }
  }
}

// ---------------------------------------------------------------- floating islands, spires and sky crystals
export function buildScenery(lv, root, theme) {
  const r = rng(lv.id * 7919 + 3);
  const from = -60, to = lv.finishX + 160;
  const isl = [];
  for (let x = from; x < to; x += 7 + r() * 7) {
    const side = r() < 0.55 ? -1 : 1;
    const far = r();
    const lat = side < 0 ? 7 + far * 45 : 15 + far * 45; // the camera sits on the right, so keep that side clearer
    const s = 1.2 + far * 4.5 + r() * 1.5;
    isl.push({ x: side * lat, y: -6 + (r() - 0.6) * 14 - (side > 0 ? 3 : 0), z: -x, s, rot: r() * Math.PI, trees: Math.floor(r() * 4), seed: r() });
  }
  const n = isl.length;
  const topG = new THREE.CylinderGeometry(1, 0.96, 0.28, 7); topG.translate(0, 0.14, 0);
  const rimG = new THREE.CylinderGeometry(0.97, 0.85, 0.55, 7); rimG.translate(0, -0.27, 0);
  const rockG = new THREE.ConeGeometry(0.86, 2.1, 7); rockG.rotateX(Math.PI); rockG.translate(0, -1.6, 0);
  const stone = tex(stoneUrl);
  const top = new THREE.InstancedMesh(topG, new THREE.MeshStandardMaterial({ color: theme.grass, roughness: 0.9, flatShading: true }), n);
  const rim = new THREE.InstancedMesh(rimG, new THREE.MeshStandardMaterial({ color: theme.rim, roughness: 1, flatShading: true }), n);
  const rock = new THREE.InstancedMesh(rockG, new THREE.MeshStandardMaterial({ map: stone, color: 0x7d6f8f, roughness: 1, flatShading: true }), n);
  const nt = isl.reduce((a, b) => a + b.trees, 0);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.05, 0.3, 5), new THREE.MeshStandardMaterial({ color: 0x5a3d2b }), Math.max(1, nt));
  const leafG = new THREE.IcosahedronGeometry(0.17, 0);
  const leaf = new THREE.InstancedMesh(leafG, new THREE.MeshStandardMaterial({ color: 0x7fc85a, roughness: 0.8, flatShading: true }), Math.max(1, nt));
  const o = new THREE.Object3D();
  let ti = 0;
  isl.forEach((q, i) => {
    o.position.set(q.x, q.y, q.z); o.rotation.set(0, q.rot, 0); o.scale.setScalar(q.s); o.updateMatrix();
    top.setMatrixAt(i, o.matrix); rim.setMatrixAt(i, o.matrix); rock.setMatrixAt(i, o.matrix);
    const rr = rng(Math.floor(q.seed * 1e9));
    for (let k = 0; k < q.trees; k++) {
      const a = rr() * Math.PI * 2, d = rr() * 0.6;
      const tx = q.x + Math.cos(a) * d * q.s, tz = q.z + Math.sin(a) * d * q.s;
      o.rotation.set(0, 0, 0); o.scale.setScalar(q.s * (0.8 + rr() * 0.5));
      o.position.set(tx, q.y + 0.28 * q.s + 0.15 * o.scale.y, tz); o.updateMatrix(); trunk.setMatrixAt(ti, o.matrix);
      o.position.y += 0.22 * o.scale.y; o.updateMatrix(); leaf.setMatrixAt(ti, o.matrix);
      ti++;
    }
  });
  if (ASSETS.island1) {
    // Blender islands: three designs, each drawn as instanced copies
    for (let k = 0; k < 3; k++) {
      const model = ASSETS['island' + (k + 1)]; if (!model) continue;
      const mats = [];
      isl.forEach((q, i) => { if (i % 3 === k) mats.push(place(o, q.x, q.y + 0.28 * q.s, q.z, q.rot, q.s)); });
      if (mats.length) instanceModel(root, model, mats);
    }
  } else root.add(top, rim, rock, trunk, leaf);

  // dark crystal spires rising out of the clouds
  const sp = [];
  for (let x = from; x < to; x += 10 + r() * 16) { const side = r() < 0.5 ? -1 : 1; sp.push([side * (26 + r() * 50), -26 + r() * 4, -x, 1.5 + r() * 2.5, 9 + r() * 14]); }
  const spire = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 4), new THREE.MeshStandardMaterial({ color: 0x232a5c, roughness: 0.5, metalness: 0.2, flatShading: true }), sp.length);
  sp.forEach(([x, y, z, w, h], i) => { o.position.set(x, y + h / 2, z); o.rotation.set(0, r(), 0); o.scale.set(w, h, w); o.updateMatrix(); spire.setMatrixAt(i, o.matrix); });
  root.add(spire);

  // big glowing crystals floating far off (they turn slowly)
  const floaters = [];
  const fm = new THREE.MeshStandardMaterial({ color: 0xc98bff, emissive: 0xa04dff, emissiveIntensity: 1.4, flatShading: true, roughness: 0.2 });
  for (let x = 40; x < to; x += 120 + r() * 80) {
    const side = r() < 0.5 ? -1 : 1;
    const c = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), fm);
    c.scale.set(2.2, 4.2, 2.2); c.position.set(side * (30 + r() * 25), 10 + r() * 12, -x);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.08, 6, 48), new THREE.MeshBasicMaterial({ color: 0xd9a6ff, toneMapped: false }));
    ring.rotation.x = Math.PI / 2; ring.position.copy(c.position);
    c.userData.dyn = true; root.add(c, ring); floaters.push(c);
  }
  return floaters;
}

// ---------------------------------------------------------------- hazards
// One spike tile = a little cluster of crystals across the track width.
// lanesOf(spike) -> the lanes it blocks (undefined = the whole road). Crystals are drawn only in those lanes.
export function buildSpikes(lv, root, M, lanesOf = () => undefined) {
  const ALL = [-1, 0, 1];
  const parts = [[], [], []];
  const r = rng(lv.id * 131);
  const put = (x, y, down, cls, lanes = ALL) => {
    for (const k of lanes) {
      const c = (k + 1 + Math.floor(x)) % 3;
      const h = 0.55 + r() * 0.3, w = 0.18 + r() * 0.08;
      parts[c].push([k * TRACK_W / 3.2 + (r() - 0.5) * 0.15, y, -(x + 0.5) + (r() - 0.5) * 0.2, w, h, down, (r() - 0.5) * 0.35]);
      // two small side shards
      parts[(c + 1) % 3].push([k * TRACK_W / 3.2 + 0.22, y, -(x + 0.5) + 0.12, w * 0.6, h * 0.55, down, 0.45]);
      parts[(c + 2) % 3].push([k * TRACK_W / 3.2 - 0.2, y, -(x + 0.5) - 0.1, w * 0.6, h * 0.5, down, -0.4]);
    }
    if (cls) cls.push(parts);
  };
  if (ASSETS.crystals) {
    // Blender crystal clusters: one per lane of every spike tile
    const o = new THREE.Object3D(), mats = [];
    for (const s of lv.spikes) for (const k of lanesOf(s) || ALL) mats.push(place(o, k * TRACK_W / 3 + (r() - 0.5) * 0.12, s.y, -(s.x + 0.5) + (r() - 0.5) * 0.15, r() * 6.3, 0.95 + r() * 0.2, 0.9 + r() * 0.25, 0.95 + r() * 0.2, s.down ? Math.PI : 0));
    if (mats.length) instanceModel(root, ASSETS.crystals, mats);
    return;
  }
  for (const s of lv.spikes) put(s.x, s.y, !!s.down, null, lanesOf(s) || ALL);
  const g = new THREE.ConeGeometry(1, 1, 5); g.translate(0, 0.5, 0);
  const o = new THREE.Object3D();
  parts.forEach((list, c) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(g, M.crystal[c], list.length);
    list.forEach(([x, y, z, w, h, down, tilt], i) => {
      o.position.set(x, y, z); o.scale.set(w, h, w); o.rotation.set(down ? Math.PI : 0, i, tilt); o.updateMatrix(); im.setMatrixAt(i, o.matrix);
    });
    root.add(im);
  });
}

export function makePulse(s, M, lanes = [-1, 0, 1]) {
  const g = new THREE.Group();
  const geo = new THREE.ConeGeometry(1, 1, 5); geo.translate(0, 0.5, 0);
  for (let i = 0; i < s.n; i++) for (const k of lanes) {
    const c = new THREE.Mesh(geo, M.crystal[2]); c.position.set(k * TRACK_W / 3, 0, -(i + 0.5)); c.scale.set(0.2, 0.7, 0.2); g.add(c);
  }
  return g;
}

export function makeSaw(radius, M) {
  const g = new THREE.Group();
  const disc = new THREE.Group(); g.add(disc);
  if (ASSETS.saw) { const m = ASSETS.saw.clone(); m.scale.setScalar(radius); disc.add(m); return { g, disc }; }
  const body = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.86, radius * 0.86, 0.22, 32), M.metal); body.rotation.z = Math.PI / 2; disc.add(body);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.3, radius * 0.3, 0.3, 20), M.hot); hub.rotation.z = Math.PI / 2; disc.add(hub);
  const rimR = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.86, 0.05, 6, 40), M.hot); rimR.rotation.y = Math.PI / 2; disc.add(rimR);
  const n = Math.max(10, Math.round(radius * 14));
  const tooth = new THREE.ConeGeometry(0.12, 0.3, 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const t = new THREE.Mesh(tooth, M.darkMetal);
    t.position.set(0, Math.cos(a) * radius * 0.95, Math.sin(a) * radius * 0.95); t.rotation.x = a; disc.add(t);
  }
  bakeStatic(disc);
  return { g, disc };
}

export function makeSpinner(len, M) {
  const g = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, len * 2, 10), M.laser); g.add(beam);
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, len * 2, 10), new THREE.MeshBasicMaterial({ color: 0xff4050, transparent: true, opacity: 0.25, depthWrite: false })); g.add(glow);
  for (const e of [-1, 1]) { const cap = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), M.darkMetal); cap.position.y = e * len; g.add(cap); }
  const hub = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.08, 8, 20), M.metal); hub.rotation.y = Math.PI / 2; g.add(hub);
  return g;
}

export function makePlatform(pl, M) {
  const g = new THREE.Group();
  if (ASSETS.platform) { const m = ASSETS.platform.clone(); m.scale.set(TRACK_W / 3.6, pl.h / 0.4, pl.w / 3.3); g.add(m); return g; }
  const m = new THREE.Mesh(tiledBox(TRACK_W, pl.h, pl.w, 1.6), M.cyber); g.add(m);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(TRACK_W + 0.02, pl.h + 0.02, pl.w + 0.02)), new THREE.LineBasicMaterial({ color: 0xc07bff, toneMapped: false }));
  g.add(edges);
  for (const sx of [-1, 1]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, pl.w), M.cyberEdge); b.position.set(sx * TRACK_W / 2, pl.h / 2 + 0.02, 0); g.add(b); }
  return g;
}

// ---------------------------------------------------------------- pick-ups and gates
export function makeCoin(M, size = 0.75) {
  const g = new THREE.Group();
  const gl = makeGlint(2.0 * size / 0.75); gl.position.z = 0.12; g.userData.glint = gl; // twinkle (animated in main3d.js)
  if (ASSETS.coin) { const m = ASSETS.coin.clone(); m.scale.setScalar(size / 0.75); g.add(m, gl); return g; }
  const c = new THREE.Mesh(new THREE.CylinderGeometry(size, size, 0.12, 40), [M.gold, M.coinFace, M.coinFace]);
  c.rotation.x = Math.PI / 2; g.add(c, gl);
  return g;
}

let swirlTex = null;
function swirl() {
  if (swirlTex) return swirlTex;
  swirlTex = canvasTex(256, (x, s) => {
    const c = s / 2;
    const gr = x.createRadialGradient(c, c, 4, c, c, c); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, s, s);
    x.lineWidth = 7; x.lineCap = 'round';
    for (let arm = 0; arm < 4; arm++) {
      x.beginPath();
      for (let i = 0; i < 80; i++) { const t = i / 80, a = arm * Math.PI / 2 + t * 5, rr = t * c * 0.95; const px = c + Math.cos(a) * rr, py = c + Math.sin(a) * rr; i ? x.lineTo(px, py) : x.moveTo(px, py); }
      x.strokeStyle = 'rgba(255,255,255,.8)'; x.stroke();
    }
  });
  return swirlTex;
}
export function makePortal(m, M) {
  const col = MCOL(m);
  const g = new THREE.Group();
  const R = 1.9;
  if (ASSETS.portal) g.add(ASSETS.portal.clone());
  else { const frame = new THREE.Mesh(new THREE.TorusGeometry(R, 0.24, 10, 48), M.darkMetal); g.add(frame); }
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R - 0.2, 0.06, 6, 48), new THREE.MeshBasicMaterial({ color: col, toneMapped: false })); g.add(rim);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R - 0.22, 48), vortexMaterial(col)); // swirling energy (fx3d.js)
  g.add(disc);
  if (!ASSETS.portal) for (let i = 0; i < 4; i++) { const st = new THREE.Mesh(new THREE.OctahedronGeometry(0.16), new THREE.MeshBasicMaterial({ color: col, toneMapped: false })); const a = i * Math.PI / 2 + Math.PI / 4; st.position.set(Math.cos(a) * R, Math.sin(a) * R, 0.1); g.add(st); }
  return { g, disc };
}

// ---------------------------------------------------------------- lane obstacles (see lanes.js)
// Each lane obstacle covers 1 or 2 lanes (one model per blocked lane); the open lane is always free.
// gate: a beam at head height with an energy wall above it -> roll under it or change lane (too tall to jump)
export function makeGate(M, lanes, laneW, gateY) {
  const g = new THREE.Group();
  for (const ln of lanes) {
    let q;
    if (ASSETS.gate) { q = ASSETS.gate.clone(); q.scale.x = laneW / 1.2; }
    else {
      q = new THREE.Group();
      for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.9, 0.3), M.darkMetal); p.position.set(sx * laneW * 0.47, 1.45, 0); q.add(p); }
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, laneW * 0.94, 16), M.laser); beam.rotation.z = Math.PI / 2; beam.position.y = gateY + 0.12; q.add(beam);
      const field = new THREE.Mesh(new THREE.PlaneGeometry(laneW * 0.9, 2.0), new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })); field.position.y = 1.8; q.add(field);
    }
    q.position.x = ln * laneW; g.add(q);
  }
  return g;
}
// hurdle: a low crystal block on the road -> jump over it or change lane (it sits on the ground, so rolling fails)
export function makeHurdle(M, lanes, laneW) {
  const g = new THREE.Group();
  for (const ln of lanes) {
    let q;
    if (ASSETS.hurdle) { q = ASSETS.hurdle.clone(); q.scale.x = (laneW * 0.92) / 1.1; }
    else {
      q = new THREE.Group();
      const block = new THREE.Mesh(new RoundedBoxGeometry(laneW * 0.92, 0.62, 0.8, 3, 0.06), M.side); block.position.y = 0.31; q.add(block);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(laneW * 0.95, 0.08, 0.84), M.gold); trim.position.y = 0.6; q.add(trim);
    }
    q.position.x = ln * laneW; g.add(q);
  }
  return g;
}

export function makeOrb() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 14), new THREE.MeshStandardMaterial({ color: 0x9ff3ff, emissive: 0x3ad6ff, emissiveIntensity: 1.4 })));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.04, 6, 32), new THREE.MeshBasicMaterial({ color: 0x9ff3ff, toneMapped: false })); g.add(ring);
  return g;
}

export function makeCheckpoint(M) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3, 8), M.darkMetal); pole.position.y = 1.5; g.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), new THREE.MeshBasicMaterial({ color: 0x66ffcc, side: THREE.DoubleSide, toneMapped: false })); flag.position.set(0, 2.65, -0.45); flag.rotation.y = Math.PI / 2; g.add(flag);
  return g;
}

export function makeFinish(M) {
  const g = new THREE.Group();
  const arch = new THREE.Mesh(new THREE.TorusGeometry(TRACK_W / 2 + 0.6, 0.18, 10, 40, Math.PI), M.gold); g.add(arch);
  const v = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.2, 0.35), M.gold); v.position.y = TRACK_W / 2 + 2.4; g.add(v);
  const h = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.35, 0.35), M.gold); h.position.y = TRACK_W / 2 + 3.0; g.add(h);
  const light = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_W, 7), new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })); light.position.y = 3.5; g.add(light);
  return g;
}

// ---------------------------------------------------------------- the hero cube
// The intro film's hero: a bevelled golden cube that burns from inside, with a carved fiery face (angry eyes, jagged grin)
// and a flame emblem on the other sides. Flames stream off it (see Sparks.flame).
function heroTex(face, glowOnly) {
  return canvasTex(256, (x, s) => {
    if (glowOnly) { x.fillStyle = '#000'; x.fillRect(0, 0, s, s); const g = x.createRadialGradient(s / 2, s / 2, 10, s / 2, s / 2, s * 0.7); g.addColorStop(0, '#7a3600'); g.addColorStop(1, '#1a0800'); x.fillStyle = g; x.fillRect(0, 0, s, s); }
    else { const g = x.createLinearGradient(0, 0, s, s); g.addColorStop(0, '#ffe08a'); g.addColorStop(0.5, '#f5a623'); g.addColorStop(1, '#b85a08'); x.fillStyle = g; x.fillRect(0, 0, s, s); }
    // carved frame
    x.strokeStyle = glowOnly ? '#000' : '#6b2c00'; x.lineWidth = 10; x.strokeRect(22, 22, s - 44, s - 44);
    if (!glowOnly) { x.strokeStyle = '#fff1b8'; x.lineWidth = 3; x.strokeRect(12, 12, s - 24, s - 24); }
    const hot = glowOnly ? '#ffe9a0' : '#fff6c8', deep = glowOnly ? '#ff8a00' : '#ff9a1a';
    if (face) {
      // eyes: slanted angry triangles, glowing from inside
      for (const sx of [-1, 1]) {
        x.fillStyle = glowOnly ? '#000' : '#2a0c00';
        x.beginPath(); x.moveTo(s / 2 + sx * 18, 104); x.lineTo(s / 2 + sx * 92, 78); x.lineTo(s / 2 + sx * 70, 132); x.closePath(); x.fill();
        x.fillStyle = hot;
        x.beginPath(); x.moveTo(s / 2 + sx * 26, 104); x.lineTo(s / 2 + sx * 82, 86); x.lineTo(s / 2 + sx * 66, 124); x.closePath(); x.fill();
      }
      // jagged grin
      x.fillStyle = glowOnly ? '#000' : '#2a0c00';
      x.beginPath(); x.moveTo(60, 160); x.quadraticCurveTo(s / 2, 225, s - 60, 160); x.quadraticCurveTo(s / 2, 190, 60, 160); x.fill();
      x.fillStyle = deep;
      x.beginPath(); x.moveTo(72, 166);
      for (let i = 0; i <= 8; i++) { const t = i / 8, px = 72 + t * (s - 144), py = 166 + Math.sin(t * Math.PI) * 26 + (i % 2 ? -10 : 4); x.lineTo(px, py); }
      x.quadraticCurveTo(s / 2, 212, 72, 166); x.fill();
    } else {
      // flame emblem
      x.fillStyle = glowOnly ? '#000' : '#5a2200';
      flame(x, s / 2, s / 2 + 10, 1.05);
      x.fillStyle = deep; flame(x, s / 2, s / 2 + 14, 0.8);
      x.fillStyle = hot; flame(x, s / 2, s / 2 + 22, 0.45);
    }
  });
}
function flame(x, cx, cy, k) {
  x.beginPath(); x.moveTo(cx, cy + 60 * k);
  x.bezierCurveTo(cx - 70 * k, cy + 50 * k, cx - 60 * k, cy - 20 * k, cx - 20 * k, cy - 80 * k);
  x.bezierCurveTo(cx - 18 * k, cy - 30 * k, cx + 5 * k, cy - 40 * k, cx + 10 * k, cy - 95 * k);
  x.bezierCurveTo(cx + 40 * k, cy - 50 * k, cx + 75 * k, cy + 10 * k, cx, cy + 60 * k);
  x.fill();
}
function heroMat(face) {
  return new THREE.MeshStandardMaterial({ map: heroTex(face, false), emissiveMap: heroTex(face, true), emissive: 0xffffff, emissiveIntensity: 2.2, metalness: 0.75, roughness: 0.28 });
}

// ---------------------------------------------------------------- cube skins (customise screen)
// Each skin repaints the Blender hero's materials (by their Blender names) and sets the flame colours.
export const SKINS = [
  { id: 'flame', name: 'Golden Flame', desc: 'The hero of the intro: burning gold.', body: '#ffc23a', dark: '#8a4a10', glow: '#ff7a10', eyes: '#ffd27a', flame: '#ff9a2a', gem: '#fff1c0', metal: 1, swatch: ['#ffd36a', '#ff7a10'], flames: [0xff4a00, 0xff8a10, 0xffb52a, 0xffe08a] },
  { id: 'crimson', name: 'Crimson Fury', desc: 'Red-hot armour and a blazing core.', body: '#d4262e', dark: '#4a0608', glow: '#ff3a1a', eyes: '#ffb08a', flame: '#ff3a1a', gem: '#ffd0c0', metal: 0.9, swatch: ['#ff5a5a', '#8a0a10'], flames: [0xff1a00, 0xff4a1a, 0xff8a3a, 0xffd0a0] },
  { id: 'angelic', name: 'Angelic', desc: 'Pearl white with a holy golden light.', body: '#f4efe4', dark: '#c9a24a', glow: '#ffe9a0', eyes: '#ffffff', flame: '#fff1b0', gem: '#ffffff', metal: 0.45, swatch: ['#ffffff', '#ffd98a'], flames: [0xfff1b0, 0xffe08a, 0xffffff, 0xffd36a] },
  { id: 'guardian', name: 'Guardian', desc: 'Steel blue with a cool cyan spirit.', body: '#3a6cff', dark: '#0a1a4a', glow: '#3ad6ff', eyes: '#c0f6ff', flame: '#3ad6ff', gem: '#e0fbff', metal: 0.95, swatch: ['#7fb0ff', '#1a3aaa'], flames: [0x1a8aff, 0x3ad6ff, 0x9ff3ff, 0xffffff] },
  { id: 'prism', name: 'Divine Prism', desc: 'Violet crystal with rainbow fire.', body: '#b06bff', dark: '#3a1a6a', glow: '#ff5ae0', eyes: '#9ff3ff', flame: '#ff5ae0', gem: '#ffffff', metal: 0.8, swatch: ['#ff8ae8', '#7f5aff'], flames: [0xff5ae0, 0x9ff3ff, 0xffe08a, 0xb06bff] },
  { id: 'midnight', name: 'Midnight', desc: 'Black steel with violet embers.', body: '#22222e', dark: '#05050a', glow: '#8a4dff', eyes: '#d0b0ff', flame: '#8a4dff', gem: '#e0d0ff', metal: 0.85, swatch: ['#3a3a4a', '#8a4dff'], flames: [0x5a2dff, 0x8a4dff, 0xc09aff, 0xffffff] },
];
let heroModel = null, heroSkin = SKINS[0];
const heroLights = [];
function paintHero(m, s) {
  m.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mt = o.material, n = mt.name;
    if (n === 'Gold') { mt.color.set(s.body); mt.metalness = s.metal; }
    else if (n === 'GoldDark') mt.color.set(s.dark);
    else if (n === 'CoreGlow') { mt.color.set(s.glow); mt.emissive.set(s.glow); }
    else if (n === 'EyeHot') { mt.color.set(s.eyes); mt.emissive.set(s.eyes); }
    else if (n === 'Flame') { mt.color.set(s.flame); mt.emissive.set(s.flame); }
    else if (n === 'Gem') { mt.color.set(s.gem); mt.emissive.set(s.gem); }
  });
}
export function setHeroSkin(s) {
  heroSkin = s;
  if (heroModel) paintHero(heroModel, s);   // clones share these materials, so every copy updates
  for (const l of heroLights) l.color.set(s.glow);
}

let heroPromise = null;
function loadHero() {
  if (!heroPromise) heroPromise = new GLTFLoader().loadAsync(heroGlbUrl).then((gltf) => {
    const m = gltf.scene; heroModel = m;
    m.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const mt = o.material;
      mt.emissiveIntensity *= 0.2;            // Blender's emission strengths are much brighter in a live game with glow
      if (mt.metalness > 0.9) mt.envMapIntensity = 0.85;
      o.castShadow = true;
    });
    paintHero(m, heroSkin);
    return m;
  });
  return heroPromise;
}

export function makeHero(PW, PH) {
  const g = new THREE.Group();          // position + squash (not rotated)
  const spin = new THREE.Group(); g.add(spin); spin.name = 'spin'; // jump rotation
  const side = heroMat(false), face = heroMat(true);
  const cube = new THREE.Group(); cube.name = 'cube';
  const codeCube = new THREE.Mesh(new RoundedBoxGeometry(PW, PH, PW, 4, 0.09), [face, side, side, side, face, side]); // the face looks at the camera side and back
  cube.add(codeCube); // stand-in until the Blender model has loaded
  // a gold crown of flame crystals on top
  const crown = new THREE.Group();
  const fl = new THREE.MeshStandardMaterial({ color: 0xffc04a, emissive: 0xff7a00, emissiveIntensity: 2.2, flatShading: true, toneMapped: false });
  const cg = new THREE.ConeGeometry(0.06, 0.3, 4); cg.translate(0, 0.15, 0);
  for (let i = 0; i < 6; i++) { const c = new THREE.Mesh(cg, fl); const a = (i / 6) * Math.PI * 2; c.position.set(Math.cos(a) * 0.24, PH / 2 - 0.02, Math.sin(a) * 0.24); c.rotation.set(Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45); c.scale.y = 0.7 + (i % 3) * 0.35; crown.add(c); }
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.1), new THREE.MeshBasicMaterial({ color: 0xfff1b0, toneMapped: false })); gem.position.y = PH / 2 + 0.12; gem.scale.y = 1.6; crown.add(gem);
  codeCube.add(crown);
  const ship = new THREE.Group(); ship.name = 'ship';
  const hull = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.2, 4), new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0xff5a00, emissiveIntensity: 1.0, metalness: 0.6, roughness: 0.3, flatShading: true }));
  hull.rotation.x = -Math.PI / 2; hull.scale.set(1, 1, 0.5); ship.add(hull);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 0.4), new THREE.MeshStandardMaterial({ color: 0x9ff3ff, emissive: 0x33d6ff, emissiveIntensity: 1.4 })); wing.position.z = 0.15; ship.add(wing);
  const mini = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.42, 0.42, 3, 0.05), [face, side, side, side, face, side]); mini.position.set(0, 0.28, 0.05); ship.add(mini);
  // swap in the Blender-made hero (tools/blender/hero_cube.py -> src/assets/models/hero.glb) once it has loaded
  loadHero().then((model) => {
    const big = model.clone(); big.scale.setScalar(PW); cube.add(big); codeCube.visible = false;
    const small = model.clone(); small.scale.setScalar(0.42); small.position.copy(mini.position); ship.add(small); mini.visible = false;
  }).catch(() => { /* keep the code-built cube */ });
  const wave = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.95, 3), new THREE.MeshStandardMaterial({ color: 0xffd36a, emissive: 0xff8a00, emissiveIntensity: 1.6, flatShading: true }));
  wave.name = 'wave'; wave.rotation.x = -Math.PI / 2;
  spin.add(cube, ship, wave);
  const light = new THREE.PointLight(heroSkin.glow, 9, 6, 1.4); light.position.y = 0.3; g.add(light); heroLights.push(light);
  return g;
}

// the soft shadow + glowing ring on the floor under the hero
export function makeFloorMark() {
  const t = canvasTex(128, (x, s) => {
    const c = s / 2; const gr = x.createRadialGradient(c, c, 0, c, c, c);
    gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(0.6, 'rgba(0,0,0,.25)'); gr.addColorStop(0.78, 'rgba(255,255,255,.9)'); gr.addColorStop(0.86, 'rgba(255,255,255,.0)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gr; x.fillRect(0, 0, s, s);
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 2;
  return m;
}

// ---------------------------------------------------------------- sparks (trail, landing and beat bursts)
export class Sparks {
  constructor(scene, n = 400, { size = 0.22, grav = 6 } = {}) {
    this.n = n; this.i = 0; this.grav = grav;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.life = new Float32Array(n);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const dot = canvasTex(64, (x, s) => { const gr = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); gr.addColorStop(0, '#fff'); gr.addColorStop(0.3, 'rgba(255,255,255,.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, s, s); });
    this.pts = new THREE.Points(g, new THREE.PointsMaterial({ size, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    this.pts.frustumCulled = false; scene.add(this.pts);
    for (let k = 0; k < n; k++) this.pos[k * 3 + 1] = -9999;
    this._c = new THREE.Color();
  }
  emit(x, y, z, count, colors, speed = 3, up = 1, life = 0.5) {
    for (let k = 0; k < count; k++) {
      const i = this.i = (this.i + 1) % this.n;
      this.pos.set([x, y, z], i * 3);
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.6);
      this.vel.set([Math.cos(a) * s, Math.random() * s * up + 0.5, Math.sin(a) * s], i * 3);
      this._c.set(colors[k % colors.length]); this.col.set([this._c.r, this._c.g, this._c.b], i * 3);
      this.life[i] = life + Math.random() * life;
    }
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -9999; continue; }
      this.vel[i * 3 + 1] -= this.grav * dt;
      for (let k = 0; k < 3; k++) this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt;
      const k = Math.max(0, 1 - dt * 5.5); this.col[i * 3] *= k; this.col[i * 3 + 1] *= k * 0.97; this.col[i * 3 + 2] *= k * 0.95; // fade out (additive, so dark = gone)
    }
    this.pts.geometry.attributes.position.needsUpdate = true; this.pts.geometry.attributes.color.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- aurora curtains (they follow the camera, always far away)
export function makeAurora() {
  const g = new THREE.Group(); g.name = 'aurora';
  const mat = (c1, c2, seed) => new THREE.ShaderMaterial({
    uniforms: { t: { value: 0 }, c1: { value: new THREE.Color(c1) }, c2: { value: new THREE.Color(c2) }, seed: { value: seed } },
    vertexShader: `uniform float t; uniform float seed; varying vec2 vUv;
      void main(){ vUv = uv; vec3 p = position; p.z += sin(p.x*0.02 + t*0.3 + seed)*18.0 + sin(p.x*0.05 - t*0.2)*6.0; p.y += sin(p.x*0.03 + seed + t*0.15)*8.0;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); }`,
    fragmentShader: `uniform float t; uniform float seed; uniform vec3 c1; uniform vec3 c2; varying vec2 vUv;
      void main(){ float rays = 0.55 + 0.45*sin(vUv.x*90.0 + t*0.6 + seed*3.0)*sin(vUv.x*37.0 - t*0.4);
      float fade = smoothstep(0.0,0.25,vUv.y) * (1.0 - smoothstep(0.35,1.0,vUv.y)) * smoothstep(0.0,0.15,vUv.x) * (1.0-smoothstep(0.85,1.0,vUv.x));
      vec3 col = mix(c1, c2, vUv.y); gl_FragColor = vec4(col * rays * fade * 0.3, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
  });
  const spec = [[0x2dffb3, 0x7a4dff, 0, -190, 60, 0], [0x46e6ff, 0xd04dff, 2.1, -215, 72, -50], [0x2dffb3, 0x4d7aff, 4.3, -200, 52, 70]]; // inside the camera's 320 view distance
  for (const [c1, c2, seed, z, y, x] of spec) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(420, 90, 120, 1), mat(c1, c2, seed));
    m.position.set(x, y, z); m.renderOrder = -5; m.frustumCulled = false; g.add(m);
  }
  g.userData.tick = (time) => g.children.forEach((m) => { m.material.uniforms.t.value = time; });
  return g;
}

// ---------------------------------------------------------------- stone gear arches over the road + holo chevrons
export function buildLandmarks(lv, root, M) {
  const out = [];
  const stone = new THREE.MeshStandardMaterial({ map: tex(stoneUrl), color: 0x6b6f8a, roughness: 0.9 });
  const tops = lv.solids.filter((q) => q.y1 > q.y0);
  const groundAt = (x) => { let y = null; for (const q of tops) if (x >= q.x && x <= q.x + q.w && (y === null || q.y1 < y)) y = q.y1; return y; };
  const clearAbove = (x, y) => !lv.solids.some((q) => q.y0 > y + 0.5 && x > q.x - 6 && x < q.x + q.w + 6) && !lv.sections.some((z) => x > z.x0 - 8 && x < z.x1 + 8);
  for (let x = 60; x < lv.finishX - 20; x += 90) {
    const y = groundAt(x); if (y === null || !clearAbove(x, y)) continue;
    const g = new THREE.Group(); g.position.set(0, y, -x);
    const R = TRACK_W / 2 + 1.6;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.45, 10, 40, Math.PI), stone); g.add(ring);
    for (const sx of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.4, 0.9), stone); leg.position.set(sx * R, -0.5, 0); g.add(leg); }
    const neon = new THREE.Mesh(new THREE.TorusGeometry(R - 0.48, 0.04, 6, 40, Math.PI), M.neon); g.add(neon);
    const gear = makeGearWheel(1.3, M); gear.position.set(-R - 1.0, 0.9, 0.2); g.add(gear); // both gears on the far side, away from the camera
    const gear2 = makeGearWheel(0.8, M); gear2.position.set(-R - 0.6, 2.4, 0.2); g.add(gear2);
    root.add(g); out.push(gear, gear2);
  }
  // holographic chevrons beside the road just before each mode portal: "get ready"
  const chev = chevronMat();
  for (const m of lv.mports) {
    const y = groundAt(m.x - 6); if (y === null) continue;
    for (const sx of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.9), chev);
      c.position.set(sx * (TRACK_W / 2 + 1.1), y + 1.4, -(m.x - 6)); c.rotation.y = sx * -0.35; root.add(c);
    }
  }
  return out;
}
function makeGearWheel(r, M) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r * 0.8, 0.25, 28), M.darkMetal); body.rotation.x = Math.PI / 2; g.add(body);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.25, r * 0.25, 0.32, 16), M.neon); hub.rotation.x = Math.PI / 2; g.add(hub);
  const n = Math.round(r * 12);
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; const t = new THREE.Mesh(new THREE.BoxGeometry(0.22, r * 0.3, 0.22), M.darkMetal); t.position.set(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9, 0); t.rotation.z = a - Math.PI / 2; g.add(t); }
  bakeStatic(g); g.userData.dyn = true;
  return g;
}
let chevTex = null;
function chevronMat() {
  if (!chevTex) chevTex = canvasTex(256, (x, s) => {
    x.clearRect(0, 0, s, s); x.lineWidth = 22; x.lineJoin = 'miter'; x.strokeStyle = '#7ff3ff';
    for (let i = 0; i < 3; i++) { const ox = 40 + i * 62; x.globalAlpha = 0.45 + i * 0.25; x.beginPath(); x.moveTo(ox, 60); x.lineTo(ox + 50, 128); x.lineTo(ox, 196); x.stroke(); }
  });
  return new THREE.MeshBasicMaterial({ map: chevTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
}

// ---------------------------------------------------------------- performance: merge still meshes
// Thousands of small meshes = thousands of draw calls (slow on phones). This merges every mesh under `top` that does not
// move into one mesh per material, in `top`'s own space. Anything marked userData.dyn (and its children) is left alone.
function sliceGeo(g, start, count) {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) { const a = g.attributes[name]; out.setAttribute(name, new THREE.BufferAttribute(a.array.slice(start * a.itemSize, (start + count) * a.itemSize), a.itemSize)); }
  return out;
}
export function bakeStatic(top) {
  top.updateMatrixWorld(true);
  const inv = top.matrixWorld.clone().invert(), m4 = new THREE.Matrix4();
  const buckets = new Map(), kill = [];
  const take = (o) => {
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    if (!g.attributes.uv || !g.attributes.normal) return;
    m4.multiplyMatrices(inv, o.matrixWorld);
    const mats = Array.isArray(o.material) ? o.material : null;
    const parts = mats && g.groups.length ? g.groups.map((gr) => [sliceGeo(g, gr.start, gr.count), mats[gr.materialIndex]]) : [[sliceGeo(g, 0, g.attributes.position.count), mats ? mats[0] : o.material]];
    const chunk = Math.floor(-m4.elements[14] / CHUNK); // merge per material AND per stretch of road, so far chunks can be skipped
    for (const [pg, mat] of parts) {
      pg.applyMatrix4(m4);
      if (!buckets.has(mat)) buckets.set(mat, new Map());
      const byC = buckets.get(mat); if (!byC.has(chunk)) byC.set(chunk, []); byC.get(chunk).push(pg);
    }
    g.dispose(); kill.push(o);
  };
  const walk = (o, first) => {
    if (!first && o.userData.dyn) return;
    for (const c of o.children) walk(c, false);
    if (!first && o.isMesh && !o.isInstancedMesh && o.visible) take(o);
  };
  walk(top, true);
  for (const o of kill) { o.parent.remove(o); }
  for (const [mat, byC] of buckets) for (const list of byC.values()) {
    for (let i = 0; i < list.length; i += 4000) { // keep each merged mesh a sensible size
      const merged = mergeGeometries(list.slice(i, i + 4000), false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat); mesh.frustumCulled = true; mesh.receiveShadow = true; top.add(mesh);
    }
    list.forEach((q) => q.dispose());
  }
}
