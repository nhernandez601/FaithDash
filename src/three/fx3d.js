// Faith Dash 3D effects: looks only, no game rules.
//   skyEnvCanvas  - reflection lighting built from the sky painting (gold and metal reflect the purple sky and sunset)
//   FlameFX       - animated, flickering flame sprites (replaces the old dots), coloured by the cube skin
//   glint         - a twinkling star sprite for coins
//   vortexMaterial- a swirling energy shader for portal centres
//   BurstRing     - a light ring that bursts out on PERFECT / GREAT jumps
//   SpeedLines    - faint light streaks rushing past, for a sense of speed
//   CloudLayer    - two drifting cloud sheets under the road (depth)
// Everything is cheap enough for phones (a handful of draw calls); phones get fewer particles and streaks.
import * as THREE from 'three';

export const fxTime = { value: 0 }; // shared clock for the shaders (seconds), set every frame by main3d.js

function canvas(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; }
function ctex(c, srgb = true) { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; }

// ---------------------------------------------------------------- sky reflections
// A 360 degree "environment" picture made from the sky painting: the painting wraps the horizon, the top is night sky,
// the bottom is the cloud sea. Three.js turns it into soft reflections and ambient light for every shiny material.
export function skyEnvCanvas(img, cloudCol) {
  return canvas(1024, 512, (x, w, h) => {
    const top = x.createLinearGradient(0, 0, 0, h * 0.25); top.addColorStop(0, '#0b0a2a'); top.addColorStop(1, '#1d1550');
    x.fillStyle = top; x.fillRect(0, 0, w, h * 0.25);
    x.drawImage(img, 0, h * 0.12, w, h * 0.5);                       // the painting around the horizon
    const bot = x.createLinearGradient(0, h * 0.6, 0, h); bot.addColorStop(0, '#' + cloudCol.getHexString()); bot.addColorStop(1, '#1a1440');
    x.fillStyle = bot; x.fillRect(0, h * 0.6, w, h * 0.4);
    // soften the seam between the painting and the gradients
    const seam = x.createLinearGradient(0, h * 0.55, 0, h * 0.64); seam.addColorStop(0, 'rgba(0,0,0,0)'); seam.addColorStop(1, '#' + cloudCol.getHexString());
    x.fillStyle = seam; x.fillRect(0, h * 0.55, w, h * 0.09);
  });
}

// ---------------------------------------------------------------- flames
function flameSprite() {
  // a soft teardrop of fire pointing up, white-hot at the base, with a wispy tip
  return ctex(canvas(128, 128, (x, w, h) => {
    const img = x.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const u = (i - w / 2) / (w / 2), v = 1 - j / h;                 // v: 0 bottom .. 1 top
      const width = 0.75 * Math.pow(Math.max(0, 1 - v), 0.7) * (0.6 + 0.4 * Math.sin(Math.min(1, v * 3) * Math.PI / 2));
      const d = Math.abs(u) / Math.max(0.001, width);
      let a = Math.max(0, 1 - d * d) * Math.min(1, v * 6) * (1 - v * 0.85);
      a = Math.pow(a, 0.8);
      const k = (j * w + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.round(a * 255); img.data[k + 3] = 255;
    }
    x.putImageData(img, 0, 0);
  }), false);
}
export class FlameFX {
  constructor(scene, n = 900) {
    this.n = n; this.i = 0;
    this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n).fill(2); this.dur = new Float32Array(n).fill(1); this.seed = new Float32Array(n);
    for (let k = 0; k < n; k++) this.seed[k] = Math.random();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    g.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: flameSprite() }, uScale: { value: 800 }, uTime: fxTime, uA: { value: new THREE.Color(0xff3a00) }, uB: { value: new THREE.Color(0xff9a1a) }, uC: { value: new THREE.Color(0xfff0b0) } },
      vertexShader: `attribute float aLife; attribute float aSeed; uniform float uScale; varying float vLife; varying float vSeed;
        void main(){ vLife = aLife; vSeed = aSeed; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          float s = (aLife < 0.0 || aLife > 1.0) ? 0.0 : (0.45 + 0.55 * sin(min(aLife * 2.2, 3.1416))) * (1.0 - aLife * 0.55) * (0.8 + aSeed * 0.5);
          gl_PointSize = uScale * s * 0.3 / -mv.z; }`,
      fragmentShader: `uniform sampler2D uTex; uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; uniform float uTime; varying float vLife; varying float vSeed;
        void main(){ vec2 uv = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y);
          uv.x += sin(uv.y * 7.0 + uTime * 14.0 + vSeed * 30.0) * 0.07 * uv.y;   // flicker
          float a = texture2D(uTex, uv).r; if (a < 0.02) discard;
          vec3 col = vLife < 0.3 ? mix(uC, uB, vLife / 0.3) : mix(uB, uA, (vLife - 0.3) / 0.7);
          float fade = 1.0 - smoothstep(0.55, 1.0, vLife);
          gl_FragColor = vec4(col * (1.0 + 0.6 * (1.0 - vLife)), min(1.0, a * fade * 1.3)); }`,
      // normal blending: the fire keeps its own orange/gold instead of turning pink over the purple sky
      transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; scene.add(this.pts);
  }
  setColors(cols) { // [deep, mid, ..., bright] from the skin
    this.mat.uniforms.uA.value.set(cols[0]); this.mat.uniforms.uB.value.set(cols[1]); this.mat.uniforms.uC.value.set(cols[cols.length - 1]);
  }
  setScale(px) { this.mat.uniforms.uScale.value = px; }
  emit(x, y, z, vx, vy, vz, dur) {
    const i = this.i = (this.i + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = 0; this.dur[i] = dur;
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] > 1) continue;
      this.life[i] += dt / this.dur[i];
      this.vel[i * 3 + 1] += 2.5 * dt;                                 // fire rises faster as it goes
      for (let k = 0; k < 3; k++) this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt;
    }
    const g = this.pts.geometry; g.attributes.position.needsUpdate = true; g.attributes.aLife.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- coin glint
let glintTex = null;
export function makeGlint(size = 1.6) {
  if (!glintTex) glintTex = ctex(canvas(128, 128, (x, w) => {
    const c = w / 2;
    const g = x.createRadialGradient(c, c, 0, c, c, c); g.addColorStop(0, 'rgba(255,255,240,1)'); g.addColorStop(0.15, 'rgba(255,230,160,.6)'); g.addColorStop(1, 'rgba(255,200,80,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, w);
    x.fillStyle = 'rgba(255,250,230,.95)';
    for (const [sx, sy] of [[1, 0.06], [0.06, 1]]) { x.beginPath(); x.ellipse(c, c, c * sx, c * sy, 0, 0, Math.PI * 2); x.fill(); } // 4-point star
  }));
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  s.scale.setScalar(size); s.userData.base = size;
  return s;
}

// ---------------------------------------------------------------- portal vortex
export function vortexMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: fxTime, uCol: { value: new THREE.Color(color) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uTime; uniform vec3 uCol; varying vec2 vUv;
      void main(){ vec2 p = vUv * 2.0 - 1.0; float r = length(p); if (r > 1.0) discard;
        float a = atan(p.y, p.x);
        float sw = sin(a * 3.0 + r * 9.0 - uTime * 3.2) * 0.5 + 0.5;          // spiral arms
        float sw2 = sin(a * 5.0 - r * 14.0 + uTime * 2.1) * 0.5 + 0.5;       // finer counter-swirl
        float core = exp(-r * 4.0);                                           // bright eye
        float edge = smoothstep(1.0, 0.75, r);
        vec3 col = uCol * (0.35 + 0.9 * sw * (1.0 - r * 0.5) + 0.35 * sw2) + vec3(1.0) * core * 1.2;
        gl_FragColor = vec4(col * edge, edge * (0.55 + 0.45 * sw)); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------- perfect-jump light burst
export class BurstRing {
  // strength = peak opacity, size = how far the ring spreads
  constructor(scene, strength = 0.9, size = 3.2) {
    this.strength = strength; this.size = size;
    this.m = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.85, 48), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
    this.m.rotation.x = -Math.PI / 2; this.m.visible = false; this.t = 1; scene.add(this.m);
  }
  fire(pos, color) { this.m.position.copy(pos); this.m.position.y -= 0.35; this.m.material.color.set(color); this.t = 0; this.m.visible = true; }
  update(dt) {
    if (this.t >= 1) return;
    this.t = Math.min(1, this.t + dt / 0.45);
    const e = 1 - Math.pow(1 - this.t, 3);
    this.m.scale.setScalar(0.4 + e * this.size); this.m.material.opacity = (1 - this.t) * this.strength;
    if (this.t >= 1) this.m.visible = false;
  }
}

// ---------------------------------------------------------------- speed streaks
export class SpeedLines {
  constructor(scene, n) {
    this.n = n;
    this.im = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.03, 2.2), new THREE.MeshBasicMaterial({ color: 0xbff6ff, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }), n);
    this.im.frustumCulled = false; scene.add(this.im);
    this.p = Array.from({ length: n }, () => ({ x: 0, y: 0, z: 1e9 }));
    this.o = new THREE.Object3D();
  }
  update(dt, center, on) {
    this.im.visible = on;
    if (!on) return;
    for (let i = 0; i < this.n; i++) {
      const q = this.p[i];
      q.z += 30 * dt;                                                 // rush toward the camera
      if (q.z > center.z + 10 || q.z < center.z - 60) {               // respawn far ahead, around the road
        const side = Math.random() < 0.5 ? -1 : 1;
        q.x = center.x + side * (2.2 + Math.random() * 5); q.y = center.y + 0.3 + Math.random() * 4; q.z = center.z - 25 - Math.random() * 30;
      }
      this.o.position.set(q.x, q.y, q.z); this.o.rotation.set(Math.PI / 2, 0, 0); this.o.updateMatrix();
      this.im.setMatrixAt(i, this.o.matrix);
    }
    this.im.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- clouds drifting under the road
export class CloudLayer {
  constructor(scene) {
    const tex = ctex(canvas(512, 512, (x, w, h) => {
      x.clearRect(0, 0, w, h);
      for (let k = 0; k < 140; k++) {  // soft puffs, drawn wrapped so the texture tiles
        const cx = Math.random() * w, cy = Math.random() * h, r = 20 + Math.random() * 70, a = 0.05 + Math.random() * 0.1;
        for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
          const g = x.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, r); g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
          x.fillStyle = g; x.fillRect(cx + ox - r, cy + oy - r, r * 2, r * 2);
        }
      }
    }));
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    // soft round fade so the sheet never shows an edge
    const fade = ctex(canvas(256, 256, (x, w) => { const g = x.createRadialGradient(w / 2, w / 2, w * 0.1, w / 2, w / 2, w / 2); g.addColorStop(0, '#fff'); g.addColorStop(1, '#000'); x.fillStyle = g; x.fillRect(0, 0, w, w); }), false);
    // well below the floating islands (they reach down to about -20), so the islands rise out of the clouds
    this.layers = [[-26, 0xd8c8ff, 0.4, 3], [-40, 0xb8a8f0, 0.32, 2]].map(([y, col, op, rep]) => {
      const t = tex.clone(); t.needsUpdate = true; t.repeat.set(rep, rep);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(520, 520), new THREE.MeshBasicMaterial({ map: t, alphaMap: fade, color: col, transparent: true, opacity: op, depthWrite: false, fog: false }));
      m.rotation.x = -Math.PI / 2; m.userData.y = y; m.renderOrder = -2; scene.add(m);
      return m;
    });
  }
  update(cam, time) {
    this.layers.forEach((m, i) => {
      m.position.set(cam.x, cam.y + m.userData.y - 3, cam.z);
      // the texture slides with the camera (parallax: the lower layer moves slower) plus a slow drift
      m.material.map.offset.set(cam.x / (140 + i * 120) + time * 0.004 * (i + 1), -cam.z / (140 + i * 120));
    });
  }
}
