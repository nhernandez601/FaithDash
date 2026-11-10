// Twisting and spiral stretches of road: a DRAWING-ONLY effect.
// The game rules (sim.js) still see a straight road, so the beat sync and the proven layouts are untouched. Here, every
// vertex of the road and of everything on it is turned around the road's own axis by an angle that depends on how far
// along the road it is (world z = -sim x):
//   twist  : the road banks left, then right, then levels out (pivot just above the road, so the runner stays put)
//   spiral : the road makes one full corkscrew roll around a line above it (the runner goes upside down and back)
// The sky and the floating islands are NOT bent, and the camera rolls with the road, so the world spins around you.
// The same maths runs on the GPU (vertex shader, injected into every track material) and in JS (camera).
import * as THREE from 'three';

export const MAX_ZONES = 8;
export const TWIST = 1, SPIRAL = 2;
const TWIST_AMP = 1.15;     // radians before the envelope (peak bank about 50 degrees)
const SPIRAL_R = 3.4;       // corkscrew radius above the road

// x0, x1 = sim x range; kind; pivot y. Inside a stretch the road's tall stone base is thinned (it would swing into view).
const zoneU = { value: Array.from({ length: MAX_ZONES }, () => new THREE.Vector4(0, 0, 0, 0)) };
export const bendUniforms = { uFdZ: zoneU };
let zones = [];

export function setZones(list) {
  zones = list.slice(0, MAX_ZONES);
  for (let i = 0; i < MAX_ZONES; i++) {
    const z = zones[i];
    zoneU.value[i].set(z ? z.x0 : 0, z ? z.x1 : 0, z ? z.kind : 0, z ? z.pivot : 0);
  }
}
export const getZones = () => zones;

const ease = (u) => u * u * (3 - 2 * u);
// roll angle and pivot height at sim distance d
export function angleAt(d) {
  for (const z of zones) {
    if (d <= z.x0 || d >= z.x1) continue;
    const u = (d - z.x0) / (z.x1 - z.x0);
    if (z.kind === SPIRAL) return { a: Math.PI * 2 * ease(u), py: z.pivot, z };
    return { a: TWIST_AMP * Math.sin(Math.PI * 2 * u) * Math.sin(Math.PI * u), py: z.pivot, z };
  }
  return { a: 0, py: 0, z: null };
}
// bend a world point (in place)
export function bendPoint(v) {
  const { a, py } = angleAt(-v.z);
  if (a === 0) return v;
  const c = Math.cos(a), s = Math.sin(a), y = v.y - py;
  const x = v.x * c - y * s; v.y = v.x * s + y * c + py; v.x = x;
  return v;
}

const GLSL = /* glsl */`
uniform vec4 uFdZ[${MAX_ZONES}];
float fdTop = 0.0, fdThin = 0.0; // road top and how much to thin the road's stone base here (set by fdAP)
vec2 fdAP(float wzv) {
  float d = -wzv; fdThin = 0.0;
  for (int i = 0; i < ${MAX_ZONES}; i++) {
    vec4 z = uFdZ[i];
    if (z.z < 0.5 || d <= z.x || d >= z.y) continue;
    float u = (d - z.x) / (z.y - z.x);
    fdThin = clamp(min(u, 1.0 - u) * 7.0, 0.0, 1.0);
    fdTop = z.w - (z.z > 1.5 ? ${SPIRAL_R.toFixed(2)} : 0.6);
    if (z.z > 1.5) return vec2(6.2831853 * u * u * (3.0 - 2.0 * u), z.w);
    return vec2(${TWIST_AMP.toFixed(4)} * sin(6.2831853 * u) * sin(3.1415927 * u), z.w);
  }
  return vec2(0.0);
}
vec3 fdSquash(vec3 p) { float b = fdTop - 0.5; if (fdThin > 0.0 && p.y < b) p.y = b - (b - p.y) * (1.0 - 0.96 * fdThin); return p; }
vec3 fdRot(vec3 p, float a, float py) { float c = cos(a), s = sin(a); p.y -= py; return vec3(p.x * c - p.y * s, p.x * s + p.y * c + py, p.z); }
vec3 fdBend(vec3 p) { vec2 ap = fdAP(p.z); return fdRot(fdSquash(p), ap.x, ap.y); }
`;

const PROJECT = /* glsl */`
vec4 fdW = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  fdW = instanceMatrix * fdW;
#endif
fdW = modelMatrix * fdW;
vec2 fdA = fdAP(fdW.z);
fdW.xyz = fdRot(fdSquash(fdW.xyz), fdA.x, fdA.y);
vec4 mvPosition = viewMatrix * fdW;
gl_Position = projectionMatrix * mvPosition;
`;
const NORMAL = /* glsl */`
#ifndef FLAT_SHADED
  vNormal = normalize( ( viewMatrix * vec4( fdRot( ( vec4( vNormal, 0.0 ) * viewMatrix ).xyz, fdA.x, 0.0 ), 0.0 ) ).xyz );
#endif
`;

function inject(shader) {
  let v = shader.vertexShader;
  shader.uniforms.uFdZ = zoneU;
  if (v.includes('#include <project_vertex>')) {
    v = v.replace('#include <project_vertex>', PROJECT + (v.includes('#include <normal_vertex>') ? NORMAL : ''));
  } else if (v.includes('vec4 mvPosition = modelViewMatrix[ 3 ];')) { // sprites: bend the sprite's centre
    v = v.replace('vec4 mvPosition = modelViewMatrix[ 3 ];', 'vec4 mvPosition = viewMatrix * vec4( fdBend( modelMatrix[ 3 ].xyz ), 1.0 );');
  } else { // our own shaders (flames, portal swirl)
    v = v.replace(/modelViewMatrix \* vec4\(position, 1\.0\)/g, '(viewMatrix * vec4(fdBend((modelMatrix * vec4(position, 1.0)).xyz), 1.0))');
  }
  shader.vertexShader = GLSL + v;
}

// make a material bend (once). Keeps any onBeforeCompile it already had.
export function patchMaterial(m) {
  if (!m || m.userData.fdBend) return;
  m.userData.fdBend = true;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => { if (prev) prev.call(m, shader, r); inject(shader); };
  const key = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : () => '';
  m.customProgramCacheKey = () => key() + '|fdBend';
  m.needsUpdate = true;
}
// bend every material under `root`, except those in `skip` (scenery). Objects near a bent stretch are never frustum-culled
// (their bounding spheres are in unbent space).
const SPH = new THREE.Sphere();
export function patchTree(root, skip = new Set()) {
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.some((m) => skip.has(m))) return;
    mats.forEach(patchMaterial);
    if (o.geometry) {
      if (o.isMesh && !o.isInstancedMesh) splitLong(o);
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      SPH.copy(o.geometry.boundingSphere).applyMatrix4(o.matrixWorld);
      const d0 = -SPH.center.z - SPH.radius, d1 = -SPH.center.z + SPH.radius;
      if (zones.some((z) => d1 > z.x0 - 2 && d0 < z.x1 + 2)) o.frustumCulled = false;
    }
  });
}

// Where the twists and spirals go: on plain running road, away from the fly / gravity sections, spread over the stage.
// Easy: 2 twists. Medium: twist, spiral, twist. Hard: twist, spiral, twist, spiral. Each lasts 16 beats, starts on a bar.
export function planBends(lv, tier) {
  const kinds = tier === 'easy' ? [TWIST, TWIST] : tier === 'medium' ? [TWIST, SPIRAL, TWIST] : [TWIST, SPIRAL, TWIST, SPIRAL];
  const bar = lv.tpb * 4, len = lv.tpb * 16;
  const busy = lv.sections.map((z) => [z.x0 - 24, z.x1 + 24]);
  busy.push([-1e9, 45], [lv.finishX - 35, 1e9]);
  const free = (x0) => !busy.some(([a, b]) => x0 + len > a && x0 < b);
  const tops = lv.solids.filter((s) => s.y1 > s.y0);
  const ground = (x) => { let y = null; for (const s of tops) if (x >= s.x && x <= s.x + s.w && s.y1 <= 4 && (y === null || s.y1 > y)) y = s.y1; return y === null ? 0 : y; };
  const out = [];
  kinds.forEach((kind, i) => {
    const want = (lv.finishX * (i + 0.6)) / (kinds.length + 0.2);
    let best = null;
    for (let x = Math.round(want / bar) * bar, k = 0; k < 400 && best === null; k++) {
      for (const c of [x + k * bar, x - k * bar]) {
        if (c < 0 || !free(c) || out.some((z) => c < z.x1 + 30 && c + len > z.x0 - 30)) continue;
        best = c; break;
      }
    }
    if (best === null) return;
    const y = ground(best + len / 2);
    out.push({ x0: best, x1: best + len, kind, pivot: y + (kind === SPIRAL ? SPIRAL_R : 0.6) });
  });
  return out.sort((a, b) => a.x0 - b.x0);
}

// Long straight pieces (a road slab can be 25 tiles long) can only bend at their corners, so inside a bent stretch they
// would cut straight through the curve. Split their triangles until no edge runs more than SPLIT tiles along the road.
const SPLIT = 1.2;
function splitLong(o) {
  const g = o.geometry, pos = g.attributes.position;
  if (!pos || g.index || g.groups.length || g.morphAttributes.position) return; // (baked meshes: plain triangle lists)
  const e = o.matrixWorld.elements;
  if (Math.abs(e[0] - 1) > 1e-6 || Math.abs(e[5] - 1) > 1e-6 || Math.abs(e[10] - 1) > 1e-6 || e[1] || e[2] || e[4] || e[6] || e[8] || e[9]) return; // only plain (baked) meshes
  if (!g.boundingBox) g.computeBoundingBox();
  const oz = e[14];
  const hit = (za, zb) => { const d0 = -(Math.max(za, zb) + oz), d1 = -(Math.min(za, zb) + oz); for (const z of zones) if (d1 > z.x0 - 2 && d0 < z.x1 + 2) return true; return false; };
  if (!hit(g.boundingBox.min.z, g.boundingBox.max.z)) return;
  // every vertex = all its attributes side by side (stride floats); zAt = where position.z sits in that
  const names = Object.keys(g.attributes), src = names.map((n) => g.attributes[n].array), size = names.map((n) => g.attributes[n].itemSize);
  const stride = size.reduce((x, y) => x + y, 0);
  let zAt = 0; for (let k = 0; k < names.indexOf('position'); k++) zAt += size[k]; zAt += 2;
  const out = names.map(() => []);
  const vert = (i) => { const v = new Float32Array(stride); let q = 0; for (let k = 0; k < names.length; k++) for (let c = 0; c < size[k]; c++) v[q++] = src[k][i * size[k] + c]; return v; };
  const emit = (v) => { let q = 0; for (let k = 0; k < names.length; k++) { const o2 = out[k]; for (let c = 0; c < size[k]; c++) o2.push(v[q++]); } };
  const copy = (i) => { for (let k = 0; k < names.length; k++) { const o2 = out[k], sk = size[k], sr = src[k]; for (let c = 0; c < sk; c++) o2.push(sr[i * sk + c]); } };
  const tri = (v, depth) => {
    let best = -1, len = SPLIT;
    for (let i = 0; i < 3; i++) { const za = v[i][zAt], zb = v[(i + 1) % 3][zAt], d = Math.abs(za - zb); if (d > len && hit(za, zb)) { len = d; best = i; } }
    if (best < 0 || depth > 12) { emit(v[0]); emit(v[1]); emit(v[2]); return; }
    const p = v[best], q = v[(best + 1) % 3], r = v[(best + 2) % 3], m = new Float32Array(stride);
    for (let c = 0; c < stride; c++) m[c] = (p[c] + q[c]) / 2;
    tri([p, m, r], depth + 1); tri([m, q, r], depth + 1);
  };
  const Z = pos.array;
  for (let t = 0; t < pos.count; t += 3) {
    const z0 = Z[t * 3 + 2], z1 = Z[t * 3 + 5], z2 = Z[t * 3 + 8];
    const lo = Math.min(z0, z1, z2), hi = Math.max(z0, z1, z2);
    if (hi - lo <= SPLIT || !hit(lo, hi)) { copy(t); copy(t + 1); copy(t + 2); continue; } // most triangles: as they are
    tri([vert(t), vert(t + 1), vert(t + 2)], 0);
  }
  const ng = new THREE.BufferGeometry();
  names.forEach((n, k) => ng.setAttribute(n, new THREE.BufferAttribute(new Float32Array(out[k]), size[k])));
  g.dispose(); o.geometry = ng;
}

// for things that can change their meshes later (the hero swaps in its Blender model when it has loaded):
// bend every material under `obj` and never frustum-cull it. Cheap to call every frame.
export function patchLive(obj) {
  obj.traverse((o) => {
    if (!o.material) return;
    o.frustumCulled = false;
    if (Array.isArray(o.material)) o.material.forEach(patchMaterial); else patchMaterial(o.material);
  });
}
