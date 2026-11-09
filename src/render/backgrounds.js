// Three animated, parallax backgrounds. All drawing goes through Pen so menus can preview them too.
// Backgrounds are intentionally low-contrast and cool/dim in the lane where obstacles live.
import { hash, wrap, hsl } from './pen.js';
import { art } from './art.js';

// Creator-supplied panorama: scaled to the full screen height, mirror-tiled so it never shows a seam, slow parallax.
export function artBg(pen, key, W, H, sx, k, depth) {
  if (!art.has(key)) return false;
  const tw = (art.w(key) / art.h(key)) * H, off = sx * k * depth;
  for (let n = Math.floor(off / tw); n * tw - off < W; n++) pen.image(key, n * tw - off, 0, tw + 1, H, 1, 0, (n & 1) === 1);
  return true;
}

function ridge(pen, W, H, baseY, amp, scale, off, col, a, step, seed) {
  for (let x = 0; x < W + step; x += step) {
    const u = (x + off) / scale;
    const n = 0.5 + 0.28 * Math.sin(u * 1.0 + seed) + 0.17 * Math.sin(u * 2.3 + seed * 2.1) + 0.05 * Math.sin(u * 5.1 + seed * 3.7);
    const y = baseY - amp * n;
    pen.rect(x, y, step + 1, H - y, col, a);
  }
}

export const BACKGROUNDS = [
  {
    id: 'celestial', name: 'Celestial Skies', blurb: 'Floating islands, castles and bright blue skies.',
    decoCol: 0x121a46, decoLit: 0x9fd8ff,
    tex: 'tex0', grass: true, accent: 0xcdeaff, groundTop: 0x7be04f, ground: 0x5a4636, ground2: 0x7a5c44, block: 0x6f7a94, pulseCol: 0xbfe6ff,
    draw(pen, W, H, t, pulse, sx, k, reduced) {
      if (artBg(pen, 'bg0', W, H, sx, k, 0.1)) return;
      pen.grad(0, 0, W, H * 0.6, 0x2468d8, 0x6bbcff);
      pen.grad(0, H * 0.6, W, H * 0.4, 0x6bbcff, 0xbfe8ff);
      // sun glow
      const ox = W * 0.8, oy = H * 0.2, base = H * 0.06;
      for (let i = (reduced ? 2 : 5); i >= 1; i--) pen.circle(ox, oy, base * (1 + i * 0.6), 0xfff6c2, 0.05 + pulse * 0.015);
      pen.circle(ox, oy, base, 0xfffbe0, 1);
      // distant big islands (parallax)
      const isl = [[0.05, 0.3, 0.2, 0.9], [0.09, 0.62, 0.15, 0.4], [0.14, 0.9, 0.19, 0.7], [0.07, 1.25, 0.13, 0.2]];
      const span = W + H * 1.2;
      isl.forEach(([depth, px, hs, seed], n) => {
        const x = wrap(px * W - sx * k * depth, span) - H * 0.4;
        const y = H * (0.22 + 0.34 * hash(seed * 9)) + Math.sin(t * 0.4 + n * 2) * H * 0.012;
        const w = H * hs * 2.2, h = H * hs * 0.9;
        pen.tri(x, y, x + w, y, x + w / 2, y + h, 0x4d5f86, 0.75);          // rock underside
        pen.tri(x + w * 0.18, y, x + w * 0.82, y, x + w / 2, y + h * 0.62, 0x6b7ea8, 0.7);
        pen.rect(x - w * 0.03, y - h * 0.12, w * 1.06, h * 0.16, 0x6fd150, 0.95); // grass cap
        if (n % 2 === 0) {                                                  // tiny castle
          const cx = x + w * 0.5, cb = y - h * 0.1, cw = w * 0.34, ch = h * 0.55;
          pen.rect(cx - cw / 2, cb - ch, cw, ch, 0xd7dff2, 0.92);
          for (const dx of [-0.5, 0.5]) { pen.rect(cx + dx * cw - cw * 0.12, cb - ch * 1.35, cw * 0.24, ch * 1.35, 0xe6ecfa, 0.95); pen.tri(cx + dx * cw - cw * 0.17, cb - ch * 1.35, cx + dx * cw + cw * 0.17, cb - ch * 1.35, cx + dx * cw, cb - ch * 1.85, 0x5a74d8, 1); }
          pen.rect(cx - cw * 0.08, cb - ch * 0.45, cw * 0.16, ch * 0.45, 0x5a74d8, 0.9);
        } else {                                                           // trees
          for (let q = 0; q < 4; q++) { const tx = x + w * (0.2 + q * 0.2); pen.rect(tx - 2, y - h * 0.3, 4, h * 0.3, 0x5a3b22, 1); pen.circle(tx, y - h * 0.38, h * 0.2, 0x3fae52, 1); }
        }
      });
      // clouds (soft white, two parallax layers)
      for (const [layer, cnt, yy, alpha] of [[0.12, 5, 0.58, 0.55], [0.3, 4, 0.74, 0.8]]) {
        for (let j = 0; j < cnt; j++) {
          const cx = wrap(j * (W + 500) / cnt - sx * k * layer + hash(j + layer) * 100, W + 500) - 250;
          const cy = H * yy + Math.sin(t * 0.3 + j) * 6;
          const s2 = H * (0.06 + layer * 0.1);
          pen.circle(cx, cy, s2, 0xffffff, alpha); pen.circle(cx + s2 * 0.9, cy + s2 * 0.15, s2 * 0.8, 0xffffff, alpha);
          pen.circle(cx - s2 * 0.9, cy + s2 * 0.2, s2 * 0.7, 0xffffff, alpha); pen.circle(cx + s2 * 1.7, cy + s2 * 0.3, s2 * 0.6, 0xffffff, alpha);
        }
      }
      if (!reduced) {
        for (let i = 0; i < 18; i++) {
          const x = wrap(hash(i * 2.3) * W - sx * k * 0.3 + Math.sin(t * 0.5 + i) * 20, W);
          const y = H - wrap(hash(i * 9.1) * H + t * (10 + hash(i) * 18), H);
          pen.circle(x, y, (1.5 + hash(i * 4.4) * 2.2) * (H / 1080), 0xffffff, 0.2 + 0.25 * hash(i * 6.1));
        }
      }
    },
  },
  {
    id: 'desert', name: 'Desert Dawn', blurb: 'A golden sunrise over dunes and mountains.', tex: 'tex1',
    decoCol: 0x3d1430, decoLit: 0xffd9a0,
    accent: 0xffc27a, groundTop: 0xffd9a0, ground: 0x3a1f2b, ground2: 0x4d2a35, block: 0x5a3040, pulseCol: 0xffb36b,
    draw(pen, W, H, t, pulse, sx, k, reduced) {
      if (artBg(pen, 'bg1', W, H, sx, k, 0.1)) return;
      pen.grad(0, 0, W, H * 0.42, 0x2a1850, 0xb43f6e);
      pen.grad(0, H * 0.42, W, H * 0.22, 0xb43f6e, 0xff8f45);
      pen.grad(0, H * 0.64, W, H * 0.16, 0xff8f45, 0xffd27a);
      const sxp = W * 0.28, syp = H * 0.66, sr = H * 0.1 * (1 + pulse * 0.03);
      if (!reduced) {
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2 + t * 0.08;
          const a2 = a + 0.1;
          pen.tri(sxp, syp, sxp + Math.cos(a) * W, syp + Math.sin(a) * W, sxp + Math.cos(a2) * W, syp + Math.sin(a2) * W, 0xffe2a8, 0.05 + pulse * 0.03);
        }
      }
      for (let i = 5; i >= 1; i--) pen.circle(sxp, syp, sr * (1 + i * 0.45), 0xffd9a0, 0.05 + pulse * 0.015);
      pen.circle(sxp, syp, sr, 0xfff1c8, 0.98);
      const step = reduced ? 16 : 10;
      ridge(pen, W, H, H * 0.74, H * 0.22, 190, sx * k * 0.08, 0x6b2f54, 0.92, step, 1.3);
      ridge(pen, W, H, H * 0.78, H * 0.16, 140, sx * k * 0.18, 0x4a2142, 0.96, step, 4.7);
      ridge(pen, W, H, H * 0.82, H * 0.09, 100, sx * k * 0.32, 0x34182f, 1, step, 8.1);
      // hanging chains with weights
      for (let i = 0; i < 4; i++) {
        const x = wrap(i * 520 + 140 - sx * k * 0.22, W + 300) - 150;
        const len = H * (0.18 + hash(i * 4.1) * 0.16) + Math.sin(t * 0.9 + i) * 5;
        pen.line(x, 0, x, len, Math.max(3, H / 200), 0x2a1424, 0.9);
        for (let c = 0; c < len; c += H * 0.035) pen.rect(x - 3, c, 6, H * 0.016, 0x4a2a3a, 0.9);
        pen.rect(x - H * 0.04, len, H * 0.08, H * 0.045, 0x2a1424, 1);
        pen.rect(x - H * 0.04, len, H * 0.08, 3, 0xffb36b, 0.6);
      }
      // cacti silhouettes
      for (let i = 0; i < 6; i++) {
        const x = wrap(i * 480 - sx * k * 0.32 + hash(i) * 200, W + 400) - 200;
        const y0 = H * 0.84, h = H * (0.06 + hash(i * 3.3) * 0.04), w = H * 0.012;
        pen.rect(x, y0 - h, w, h, 0x241022, 1); pen.rect(x - w * 1.6, y0 - h * 0.65, w * 1.6, w * 0.8, 0x241022, 1); pen.rect(x - w * 1.6, y0 - h * 0.85, w * 0.8, h * 0.25, 0x241022, 1);
        pen.rect(x + w, y0 - h * 0.5, w * 1.6, w * 0.8, 0x241022, 1); pen.rect(x + w * 1.8, y0 - h * 0.75, w * 0.8, h * 0.28, 0x241022, 1);
      }
      if (!reduced) {
        for (let i = 0; i < 40; i++) {
          const x = wrap(hash(i * 2.1) * W - sx * k * 0.5 - t * (20 + hash(i) * 30), W);
          const y = H * (0.45 + hash(i * 7.7) * 0.45) + Math.sin(t * 0.8 + i) * 8;
          pen.circle(x, y, (1 + hash(i * 3) * 2) * (H / 1080), 0xffe0b0, 0.1 + 0.2 * hash(i * 5));
        }
      }
    },
  },
  {
    id: 'aurora', name: 'Aurora Horizon', blurb: 'Rippling lights over a dark glowing skyline.', tex: 'tex2',
    decoCol: 0x06112b, decoLit: 0x66ffe0,
    accent: 0x39e6ff, groundTop: 0x39e6ff, ground: 0x0a0a2e, ground2: 0x141450, block: 0x1a1a5c, pulseCol: 0x3bf0d0,
    draw(pen, W, H, t, pulse, sx, k, reduced) {
      if (artBg(pen, 'bg2', W, H, sx, k, 0.1)) return;
      const shift = 0.5 + 0.5 * Math.sin(t * 0.15);
      pen.grad(0, 0, W, H * 0.7, 0x0a0626, 0x2a1a7a + (Math.round(shift * 18) << 8));
      pen.grad(0, H * 0.7, W, H * 0.3, 0x2a1a7a, 0x0a0a2e);
      const n = reduced ? 30 : 70;
      for (let i = 0; i < n; i++) {
        const x = wrap(hash(i * 7.9) * W - sx * k * 0.02, W);
        pen.circle(x, hash(i * 2.2) * H * 0.55, (0.7 + hash(i) * 1.4) * (H / 1080), 0xffffff, 0.2 + 0.5 * (0.5 + 0.5 * Math.sin(t * 1.5 + i)));
      }
      const colW = reduced ? 30 : 16;
      const ribbons = reduced ? 2 : 3;
      const cols = [0x1affa8, 0x4a8bff, 0xb04bff];
      for (let r = 0; r < ribbons; r++) {
        for (let x = 0; x < W + colW; x += colW) {
          const u = x + sx * k * 0.04;
          const yy = H * (0.12 + r * 0.09) + Math.sin(u * 0.004 + t * 0.55 + r * 1.9) * H * 0.07 + Math.sin(u * 0.011 - t * 0.9) * H * 0.02;
          const hh = H * (0.28 + 0.06 * Math.sin(u * 0.007 + r + t * 0.4));
          pen.grad(x, yy, colW + 1, hh, cols[r], 0x000000, 0.2 + pulse * 0.1, 0);
        }
      }
      // glowing geometry
      const geo = reduced ? 3 : 7;
      for (let i = 0; i < geo; i++) {
        const gx = wrap(hash(i * 5.1) * (W + 300) - sx * k * (0.06 + 0.02 * (i % 3)), W + 300) - 150;
        const gy = H * (0.2 + hash(i * 2.7) * 0.4);
        const s = H * (0.04 + hash(i * 8.3) * 0.05) * (1 + pulse * 0.06);
        const a = t * (0.3 + 0.1 * (i % 3)) + i;
        const col = i % 2 ? 0x5df2c2 : 0x9d7bff;
        for (let e = 0; e < 4; e++) {
          const a1 = a + (e * Math.PI) / 2, a2 = a + ((e + 1) * Math.PI) / 2;
          pen.line(gx + Math.cos(a1) * s, gy + Math.sin(a1) * s, gx + Math.cos(a2) * s, gy + Math.sin(a2) * s, Math.max(1.5, H / 540), col, 0.45 + pulse * 0.25);
        }
      }
      // castle silhouettes
      for (let i = 0; i < 3; i++) {
        const cx = wrap(i * 760 + 200 - sx * k * 0.06, W + 700) - 350;
        const b = H * 0.8, cw = H * 0.42, ch = H * 0.2;
        pen.rect(cx - cw / 2, b - ch, cw, ch, 0x150a38, 1);
        for (const dx of [-0.5, -0.17, 0.17, 0.5]) { const tw = cw * 0.14, th = ch * (1.2 + 0.35 * hash(i * 3 + dx)); pen.rect(cx + dx * cw - tw / 2, b - th, tw, th, 0x150a38, 1); pen.tri(cx + dx * cw - tw * 0.8, b - th, cx + dx * cw + tw * 0.8, b - th, cx + dx * cw, b - th - tw * 1.8, 0x150a38, 1); }
        for (let w2 = 0; w2 < 5; w2++) pen.rect(cx - cw * 0.4 + w2 * cw * 0.2, b - ch * 0.6, cw * 0.03, cw * 0.05, 0xffd27a, 0.35 + 0.4 * (0.5 + 0.5 * Math.sin(t * 2 + w2 + i)));
      }
      // distant structures
      for (let i = 0; i < 14; i++) {
        const x = wrap(i * (W / 9) - sx * k * 0.1 + hash(i) * 90, W + 300) - 150;
        const w = H * (0.03 + hash(i * 3) * 0.04), h = H * (0.1 + hash(i * 9) * 0.22);
        const y0 = H * 0.8;
        pen.rect(x, y0 - h, w, h, 0x03101c, 1);
        if (i % 3 === 0) pen.tri(x - w * 0.2, y0 - h, x + w * 1.2, y0 - h, x + w / 2, y0 - h - w * 1.1, 0x03101c, 1);
        const lit = 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(t * 2 + i * 1.7));
        pen.rect(x + w * 0.3, y0 - h * 0.8, w * 0.12, w * 0.12, 0x5df2c2, lit * (0.6 + pulse * 0.4));
        pen.rect(x + w * 0.6, y0 - h * 0.5, w * 0.12, w * 0.12, 0x9d7bff, lit);
      }
      pen.grad(0, H * 0.78, W, H * 0.06, 0x000000, 0x1affa8, 0, 0.12 + pulse * 0.08);
    },
  },
];
export const bgById = (i) => BACKGROUNDS[Math.max(0, Math.min(BACKGROUNDS.length - 1, i | 0))];
