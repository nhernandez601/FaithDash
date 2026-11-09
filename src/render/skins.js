// Character skins — purely cosmetic. Every skin is drawn inside the SAME box (hit-box never changes).
import { hsl } from './pen.js';
import { art } from './art.js';

// helper: draw a rotated square of half-size h around (cx,cy)
function sq(pen, cx, cy, h, rot, col, a = 1) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const x = (px, py) => cx + px * c - py * s, y = (px, py) => cy + px * s + py * c;
  pen.quad(x(-h, -h), y(-h, -h), x(h, -h), y(h, -h), x(h, h), y(h, h), x(-h, h), y(-h, h), col, a);
}
// rotated local-space helpers
const R = (cx, cy, rot) => { const c = Math.cos(rot), s = Math.sin(rot); return { x: (px, py) => cx + px * c - py * s, y: (px, py) => cy + px * s + py * c }; };
function rtri(pen, cx, cy, rot, s, pts, col, a = 1) {
  const r = R(cx, cy, rot);
  pen.tri(r.x(pts[0] * s, pts[1] * s), r.y(pts[0] * s, pts[1] * s), r.x(pts[2] * s, pts[3] * s), r.y(pts[2] * s, pts[3] * s), r.x(pts[4] * s, pts[5] * s), r.y(pts[4] * s, pts[5] * s), col, a);
}
function rbar(pen, cx, cy, rot, s, x0, y0, x1, y1, col, a = 1) {
  const r = R(cx, cy, rot);
  pen.quad(r.x(x0 * s, y0 * s), r.y(x0 * s, y0 * s), r.x(x1 * s, y0 * s), r.y(x1 * s, y0 * s), r.x(x1 * s, y1 * s), r.y(x1 * s, y1 * s), r.x(x0 * s, y1 * s), r.y(x0 * s, y1 * s), col, a);
}

// Glossy "3D" cube: dark edge, body, lighter face panel, soft top-left gloss.
function cube(pen, cx, cy, s, rot, edge, body, panel) {
  sq(pen, cx, cy, s / 2, rot, edge);
  sq(pen, cx, cy, s * 0.455, rot, body);
  sq(pen, cx, cy, s * 0.37, rot, panel);
  rtri(pen, cx, cy, rot, s, [-0.37, -0.37, 0.05, -0.37, -0.37, 0.05], 0xffffff, 0.22);
  rbar(pen, cx, cy, rot, s, -0.455, 0.36, 0.455, 0.455, 0x000000, 0.16);
}
// Friendly face that rotates with the cube. blink: 0..1 (1 = closed)
function face(pen, cx, cy, s, rot, t, ink = 0x14102e) {
  const r = R(cx, cy, rot);
  const blink = (t % 3.4) > 3.28 ? 0.15 : 1;
  for (const ex of [-0.15, 0.15]) {
    const X = r.x(ex * s, -0.05 * s), Y = r.y(ex * s, -0.05 * s);
    pen.circle(X, Y, s * 0.095, 0xffffff, 1);
    if (blink > 0.5) pen.circle(r.x((ex + 0.015) * s, -0.04 * s), r.y((ex + 0.015) * s, -0.04 * s), s * 0.055, ink, 1);
    else pen.line(r.x((ex - 0.08) * s, -0.05 * s), r.y((ex - 0.08) * s, -0.05 * s), r.x((ex + 0.08) * s, -0.05 * s), r.y((ex + 0.08) * s, -0.05 * s), s * 0.035, ink, 1);
  }
  let px = null, py = null;
  for (let i = 0; i <= 6; i++) {
    const u = i / 6, lx = (-0.17 + 0.34 * u) * s, ly = (0.1 + 0.1 * Math.sin(u * Math.PI)) * s;
    const X = r.x(lx, ly), Y = r.y(lx, ly);
    if (px !== null) pen.line(px, py, X, Y, s * 0.045, ink, 1);
    px = X; py = Y;
  }
}

export const SKINS = [
  {
    id: 'radiant', name: 'Radiant Cube', need: 0, blurb: 'A shining blue cube.',
    trail: { cols: [0x6cc4ff, 0xffffff, 0x2f8bff], size: 0.16, kind: 'spark' },
    draw(pen, cx, cy, s, rot, t, fx) {
      if (fx) { pen.circle(cx, cy, s * 0.95, 0x39b6ff, 0.13); pen.circle(cx, cy, s * 0.72, 0x9fe0ff, 0.16); }
      cube(pen, cx, cy, s, rot, 0x0a2f78, 0x2f8bff, 0x63b6ff);
      face(pen, cx, cy, s, 0, t);
    },
  },
  {
    id: 'guardian', name: 'Golden Guardian', need: 0, blurb: 'A shielded protector.',
    trail: { cols: [0xffc633, 0xb8860b, 0xfff0b3], size: 0.18, kind: 'block' },
    draw(pen, cx, cy, s, rot, t, fx) {
      if (fx) pen.circle(cx, cy, s * 0.85, 0xffc633, 0.14);
      cube(pen, cx, cy, s, rot, 0x6b4600, 0xf0a81c, 0xffd25a);
      rtri(pen, cx, cy, rot, s, [-0.13, -0.43, 0.13, -0.43, 0, -0.3], 0x6b4600);
      face(pen, cx, cy, s, 0, t);
    },
  },
  {
    id: 'crimson', name: 'Crimson Spark', need: 0, blurb: 'Crackling with energy.',
    trail: { cols: [0xff4d6a, 0xffd0a0, 0xff1f3d], size: 0.14, kind: 'spark' },
    draw(pen, cx, cy, s, rot, t, fx) {
      if (fx) pen.circle(cx, cy, s * 0.9, 0xff2a4a, 0.15);
      cube(pen, cx, cy, s, rot, 0x5a0614, 0xd81f38, 0xff5b6e);
      rtri(pen, cx, cy, rot, s, [0.3, -0.42, 0.16, -0.22, 0.34, -0.24], 0xfff1b8);
      face(pen, cx, cy, s, 0, t);
    },
  },
  {
    id: 'angelic', name: 'Angelic Glow', need: 3, blurb: 'Wings and a halo.',
    trail: { cols: [0xffffff, 0xcfe8ff, 0xfff6c9], size: 0.15, kind: 'feather' },
    draw(pen, cx, cy, s, rot, t, fx) {
      const flap = Math.sin(t * 9) * 0.12;
      if (fx) pen.circle(cx, cy, s * 1.0, 0xcfe8ff, 0.15);
      for (const d of [-1, 1]) {
        pen.tri(cx + d * s * 0.45, cy - s * 0.05, cx + d * s * (0.95 + flap), cy - s * (0.5 + flap), cx + d * s * 0.5, cy - s * 0.38, 0xffffff, 0.92);
        pen.tri(cx + d * s * 0.45, cy + s * 0.02, cx + d * s * (0.88 + flap), cy - s * (0.12 + flap), cx + d * s * 0.5, cy - s * 0.2, 0xdff0ff, 0.9);
      }
      cube(pen, cx, cy, s, rot, 0x7fa9d6, 0xdcecff, 0xffffff);
      face(pen, cx, cy, s, 0, t);
      pen.ring(cx, cy - s * 0.78, s * 0.2, Math.max(2, s * 0.06), 0xffe27a, 0.95);
    },
  },
  {
    id: 'flame', name: 'Celestial Flame', need: 6, blurb: 'Burns with heavenly fire.',
    trail: { cols: [0xff8a2a, 0xffd23a, 0xff4a1a], size: 0.2, kind: 'flame' },
    draw(pen, cx, cy, s, rot, t, fx) {
      if (fx) pen.circle(cx, cy, s * 1.0, 0xff7a1a, 0.15);
      const f = (i) => 0.12 * Math.sin(t * 14 + i * 2.1);
      cube(pen, cx, cy, s, rot, 0x0c1448, 0x2540c8, 0x4a76ff);
      [[-0.3, 0], [0, 1], [0.3, 2]].forEach(([ox, i]) => {
        rtri(pen, cx, cy, rot, s, [ox - 0.14, -0.5, ox + 0.14, -0.5, ox, -0.85 - f(i)], 0xff7a1a, 0.95);
        rtri(pen, cx, cy, rot, s, [ox - 0.08, -0.5, ox + 0.08, -0.5, ox, -0.66 - f(i) * 0.6], 0xffe27a, 0.95);
      });
      face(pen, cx, cy, s, 0, t);
    },
  },
  {
    id: 'prism', name: 'Divine Prism', need: 10, blurb: 'Light split into every colour.',
    trail: { cols: 'rainbow', size: 0.16, kind: 'spark' },
    draw(pen, cx, cy, s, rot, t, fx) {
      if (fx) pen.circle(cx, cy, s * 1.05, hsl(t * 0.3, 0.9, 0.7), 0.14);
      sq(pen, cx, cy, s / 2, rot, 0xffffff, 0.95);
      const h = s * 0.45, r = R(cx, cy, rot);
      const P = [[-h, -h], [h, -h], [h, h], [-h, h]];
      for (let i = 0; i < 4; i++) {
        const a = P[i], b = P[(i + 1) % 4];
        pen.tri(cx, cy, r.x(a[0], a[1]), r.y(a[0], a[1]), r.x(b[0], b[1]), r.y(b[0], b[1]), hsl(t * 0.25 + i * 0.25, 0.85, 0.62));
      }
      sq(pen, cx, cy, s * 0.36, rot, 0xffffff, 0.82);
      face(pen, cx, cy, s, 0, t);
    },
  },
];
// Creator-supplied artwork replaces the drawn cube when present. The hitbox is unaffected (it never depends on the skin).
// The picture is a real sprite: it rolls (rot), and squashes / stretches (sx, sy) around its feet.
SKINS.forEach((sk) => {
  const drawn = sk.draw;
  sk.draw = (pen, cx, cy, s, rot, t, fx, sx = 1, sy = 1) => {
    const key = 'skin_' + sk.id;
    if (!art.has(key)) return drawn(pen, cx, cy, s, rot, t, fx);
    const sz = s * 1.6, w = sz * sx, h = sz * sy;
    const bottom = cy + s * 0.05 + sz / 2;
    pen.image(key, cx - w / 2, bottom - h, w, h, 1, rot);
  };
});
export const skinById = (id) => SKINS.find((s) => s.id === id) || SKINS[0];

export function trailColor(skin, i, t) {
  const c = skin.trail.cols;
  return c === 'rainbow' ? hsl(t * 0.5 + i * 0.13, 0.85, 0.62) : c[i % c.length];
}
