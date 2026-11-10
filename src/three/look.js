// The look of the run, on top of the art in art3d.js:
//  - the colours slide from golden dawn to night as the run gets harder (one continuous level, no stage breaks)
//  - small effects: glowing road tiles under the hero, a light ribbon behind it, and shards when it crashes
// Everything here is looks only; nothing feeds back into the game rules. Materials follow twists / spirals (bend.js).
import * as THREE from 'three';
import { patchMaterial } from './bend.js';

const C = (h) => new THREE.Color(h);
// One key per difficulty point: 0 = start of Easy, 1 = start of Medium, 2 = start of Hard, 3 = end of Hard and after.
// tint/lift colour the finished picture (grade pass), exp = exposure, the rest are the scene lights and the fog.
const KEYS = [
  { tint: [1.17, 1.02, 0.80], lift: [0.03, 0.016, 0.0], exp: 1.10, sun: C(0xffd49a), sunI: 2.5, sky: C(0xffe0b0), gnd: C(0x5a3a40), hemiI: 1.25, fog: C(0xc49a86) }, // golden dawn
  { tint: [1.14, 0.90, 0.88], lift: [0.03, 0.0, 0.012], exp: 1.04, sun: C(0xff9466), sunI: 2.2, sky: C(0xffb4c4), gnd: C(0x4a2a50), hemiI: 1.1, fog: C(0xa0607e) },  // sunset
  { tint: [1.0, 1.0, 1.0], lift: [0.0, 0.0, 0.0], exp: 1.0, sun: C(0xfff0d8), sunI: 2.0, sky: C(0xc9b8ff), gnd: C(0x2a2050), hemiI: 1.1, fog: C(0x55448e) },         // dusk
  { tint: [0.50, 0.60, 0.98], lift: [0.0, 0.006, 0.03], exp: 0.92, sun: C(0x9db8ff), sunI: 1.1, sky: C(0x5a6ad0), gnd: C(0x101028), hemiI: 0.75, fog: C(0x161c40) }, // night
];
const lerp = (a, b, t) => a + (b - a) * t;
// the mood at difficulty point P (0..3), written into `out`
export function moodAt(P, out) {
  const p = Math.max(0, Math.min(3, P)), i = Math.min(2, Math.floor(p)), t = p - i, a = KEYS[i], b = KEYS[i + 1];
  out.tint = out.tint || [0, 0, 0]; out.lift = out.lift || [0, 0, 0];
  for (let k = 0; k < 3; k++) { out.tint[k] = lerp(a.tint[k], b.tint[k], t); out.lift[k] = lerp(a.lift[k], b.lift[k], t); }
  out.exp = lerp(a.exp, b.exp, t); out.sunI = lerp(a.sunI, b.sunI, t); out.hemiI = lerp(a.hemiI, b.hemiI, t);
  for (const k of ['sun', 'sky', 'gnd', 'fog']) (out[k] = out[k] || new THREE.Color()).copy(a[k]).lerp(b[k], t);
  out.night = Math.max(0, p - 2); // 0..1 through the last third: road glow gets stronger, lightning is possible
  return out;
}

const glowMat = (color) => {
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
  patchMaterial(m); return m;
};

// road tiles light up under the hero as it runs, then fade
export class FloorGlow {
  constructor(scene, n, w) {
    this.items = [];
    const g = new THREE.PlaneGeometry(w * 0.9, 0.92); g.rotateX(-Math.PI / 2);
    for (let i = 0; i < n; i++) { const m = new THREE.Mesh(g, glowMat(0x7fe8ff)); m.visible = false; m.frustumCulled = false; m.userData.t = 1; scene.add(m); this.items.push(m); }
    this.i = 0;
  }
  spawn(x, y, z, color, strength = 0.55) {
    const m = this.items[this.i++ % this.items.length];
    m.position.set(x, y, z); m.material.color.set(color); m.userData.t = 0; m.userData.s = strength; m.visible = true;
  }
  clear() { for (const m of this.items) { m.visible = false; m.userData.t = 1; } }
  update(dt) {
    for (const m of this.items) {
      if (m.userData.t >= 1) continue;
      m.userData.t = Math.min(1, m.userData.t + dt / 0.55);
      m.material.opacity = (1 - m.userData.t) * (1 - m.userData.t) * m.userData.s;
      if (m.userData.t >= 1) m.visible = false;
    }
  }
}

// a ribbon of light streaming off the back of the hero
export class Ribbon {
  constructor(scene, n = 22, height = 0.5) {
    this.n = n; this.h = height; this.pts = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3); this.col = new Float32Array(n * 2 * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const idx = []; for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } g.setIndex(idx);
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
    patchMaterial(m);
    this.mesh = new THREE.Mesh(g, m); this.mesh.frustumCulled = false; scene.add(this.mesh);
    this.color = new THREE.Color(0xffb84a);
  }
  setColor(c) { this.color.set(c); }
  reset() { this.pts.length = 0; this.mesh.visible = false; }
  push(p, on) {
    if (!on) { this.reset(); return; }
    if (this.pts.length && this.pts[0].distanceToSquared(p) > 9) this.pts.length = 0; // jumped (respawn): start a fresh ribbon
    this.pts.unshift(p.clone()); if (this.pts.length > this.n) this.pts.length = this.n;
    const k = this.pts.length; if (k < 2) return;
    this.mesh.visible = true;
    for (let i = 0; i < this.n; i++) {
      const q = this.pts[Math.min(i, k - 1)], f = Math.max(0, 1 - i / (k - 1)), hh = this.h * (0.35 + 0.65 * f) / 2;
      this.pos.set([q.x, q.y - hh, q.z, q.x, q.y + hh, q.z], i * 6);
      const c = this.color, s = f * f * 0.9;
      this.col.set([c.r * s, c.g * s, c.b * s, c.r * s, c.g * s, c.b * s], i * 6);
    }
    this.mesh.geometry.attributes.position.needsUpdate = true; this.mesh.geometry.attributes.color.needsUpdate = true;
  }
}

// the hero breaks into glowing pieces when it crashes
export class Shards {
  constructor(scene, n = 16) {
    this.items = [];
    const g = new THREE.BoxGeometry(0.16, 0.16, 0.16);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xffc85a, emissive: 0xff8a20, emissiveIntensity: 1.4, metalness: 0.6, roughness: 0.3, transparent: true }));
      patchMaterial(m.material); m.visible = false; m.frustumCulled = false; scene.add(m);
      this.items.push({ m, v: new THREE.Vector3(), s: new THREE.Vector3(), t: 1 });
    }
  }
  burst(pos) {
    for (const it of this.items) {
      it.m.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5));
      it.v.set((Math.random() - 0.5) * 7, 3 + Math.random() * 6, (Math.random() - 0.5) * 7 - 2);
      it.s.set(Math.random() * 12, Math.random() * 12, Math.random() * 12);
      it.t = 0; it.m.visible = true; it.m.scale.setScalar(0.6 + Math.random() * 1.2);
    }
  }
  update(dt) {
    for (const it of this.items) {
      if (it.t >= 1) continue;
      it.t = Math.min(1, it.t + dt / 1.1);
      it.v.y -= 18 * dt; it.m.position.addScaledVector(it.v, dt);
      it.m.rotation.x += it.s.x * dt; it.m.rotation.y += it.s.y * dt; it.m.rotation.z += it.s.z * dt;
      it.m.material.opacity = 1 - it.t * it.t;
      if (it.t >= 1) it.m.visible = false;
    }
  }
}
