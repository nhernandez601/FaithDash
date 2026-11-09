// Background world structures — towers, buildings, ceiling slabs and floating "world platforms" that sit BEHIND the
// level so the scene reads as a place instead of a flat strip of ground.
//
// These are scenery, never gameplay. Four things keep them unmistakable from the real platforms you stand on
// (the standard advice for Geometry Dash backgrounds, and the reason levels stay readable at speed):
//   1. Parallax  — each layer scrolls slower than the level, so in motion it visibly sits further away.
//   2. Silhouette— scenery is a solid, flat, untextured block of one dark colour. Real platforms are textured and
//                  carry a bright white lit edge. Translucent scenery was tried first and read as a rendering
//                  glitch over the painted backdrops, so these are near-opaque instead.
//   3. Detail    — scenery has no surface detail beyond windows; the eye is drawn to the detailed foreground.
//   4. Depth     — drawn before the terrain, so nothing in here can ever cover a hazard, a platform or the player.
import { hash } from './pen.js';

// depth: how fast the layer scrolls (1 = locked to the level). gap: fraction of slots left empty.
// lo/hi: structure height range in tiles. The nearest layer is kept low and is not allowed to use the
// floating-bar shape, because a bar at play height on the least-parallaxed layer is the one thing that could
// genuinely be misread as a platform.
const LAYERS = [
  { depth: 0.22, alpha: 0.74, cell: 42, seed: 3.1, gap: 0.32, lo: 5.0, hi: 11.0, wide: 1.35, bars: true, ceil: true },
  { depth: 0.44, alpha: 0.86, cell: 32, seed: 11.7, gap: 0.38, lo: 3.4, hi: 7.5, wide: 1.0, bars: true, ceil: false },
  { depth: 0.68, alpha: 0.95, cell: 27, seed: 23.3, gap: 0.46, lo: 1.8, hi: 3.4, wide: 0.78, bars: false, ceil: false },
];

// Lit windows punched into a solid silhouette. On a near-opaque block these read as a building.
function windows(pen, x, y, w, h, k, lit, a, cols, rows) {
  const mx = w * 0.17, my = h * 0.16;
  const gw = (w - mx * 2) / cols, gh = (h - my * 2) / rows;
  const pw = gw * 0.52, ph = Math.min(gh * 0.46, k * 0.42);
  if (pw < 2 || ph < 2) return;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (hash(c * 3.3 + r * 7.1 + x) < 0.28) continue;   // some windows are dark
      pen.rect(x + mx + c * gw + (gw - pw) / 2, y + my + r * gh + (gh - ph) / 2, pw, ph, lit, a);
    }
  }
}

// One structure. (sx, groundY) are screen pixels; k = pixels per tile.
function structure(pen, kind, n, sx, groundY, k, H, L, col, lit) {
  const a = L.alpha;
  const r1 = hash(n * 1.7 + L.seed), r2 = hash(n * 3.9 + L.seed), r3 = hash(n * 7.3 + L.seed);
  const ht = k * (L.lo + (L.hi - L.lo) * r2);
  // A dim tinted rim reads the shape's top edge without ever looking like the bright white edge of a real platform.
  const rim = (x, y, w) => pen.rect(x, y, w, Math.max(1, k * 0.045), lit, a * 0.28);

  if (kind === 0) {
    // Tower: a narrow pillar standing on the ground line with a stepped cap.
    const w = k * (1.5 + r1 * 1.7) * L.wide, y = groundY - ht;
    pen.rect(sx, y, w, ht, col, a);
    pen.rect(sx - w * 0.16, y, w * 1.32, k * 0.45, col, a);
    rim(sx - w * 0.16, y, w * 1.32);
    pen.rect(sx + w * 0.3, y - k * 1.1, w * 0.4, k * 1.1, col, a);           // mast
    windows(pen, sx, y + k * 0.6, w, ht - k * 0.6, k, lit, a * 0.5, 2, Math.max(2, Math.round(ht / (k * 1.8))));
  } else if (kind === 1) {
    // Building: a wide block with a grid of windows — the big rectangles seen behind most levels.
    const w = k * (4.5 + r1 * 5) * L.wide, h = ht * 0.8, y = groundY - h;
    pen.rect(sx, y, w, h, col, a);
    rim(sx, y, w);
    windows(pen, sx, y, w, h, k, lit, a * 0.45, Math.max(2, Math.round(w / (k * 2))), Math.max(2, Math.round(h / (k * 1.8))));
  } else if (kind === 2 && L.ceil) {
    // Ceiling slab hanging from above with a toothed underside. Capped well above the sky route so it never
    // crowds the lane the player actually flies through.
    const w = k * (4 + r1 * 4.5) * L.wide, h = k * (1.4 + r2 * 1.6);
    const drop = Math.min(H * 0.17, k * (0.8 + r3 * 2.4));
    pen.rect(sx + w * 0.36, -2, w * 0.28, drop, col, a * 0.9);
    pen.rect(sx, drop, w, h, col, a);
    const teeth = Math.max(3, Math.round(w / (k * 1.1)));
    for (let i = 0; i < teeth; i++) {
      const tx = sx + (i + 0.5) * (w / teeth), tw = (w / teeth) * 0.42;
      pen.tri(tx - tw, drop + h, tx + tw, drop + h, tx, drop + h + k * 0.7, col, a);
    }
    windows(pen, sx, drop, w, h, k, lit, a * 0.45, Math.max(2, Math.round(w / (k * 2))), 1);
  } else if (kind === 3 && L.bars) {
    // World platform: a floating bar on stilts. Only on the far layers, where the slow parallax makes it obvious
    // that it is scenery rather than something to land on.
    const w = k * (3 + r1 * 4) * L.wide, h = k * 0.7;
    const y = groundY - ht * 0.85;
    pen.rect(sx, y, w, h, col, a);
    rim(sx, y, w);
    pen.rect(sx + w * 0.1, y + h, w * 0.09, groundY - (y + h), col, a * 0.8);
    pen.rect(sx + w * 0.81, y + h, w * 0.09, groundY - (y + h), col, a * 0.8);
  } else {
    // Arch: two legs and a span. Breaks up long runs of solid blocks and lets the sky through.
    const w = k * (4 + r1 * 3.5) * L.wide, h = ht * 0.85, y = groundY - h, leg = w * 0.19;
    pen.rect(sx, y, w, k * 0.6, col, a);
    rim(sx, y, w);
    pen.rect(sx, y, leg, h, col, a);
    pen.rect(sx + w - leg, y, leg, h, col, a);
  }
}

// Draws every scenery layer, furthest first. camX is the level camera in tiles; k = pixels per tile.
export function drawBackStructures(pen, W, H, groundY, camX, k, th, reduced) {
  const col = th.decoCol != null ? th.decoCol : 0x0b0a20;
  const lit = th.decoLit != null ? th.decoLit : 0x9fd8ff;
  const layers = reduced ? [LAYERS[0], LAYERS[2]] : LAYERS;
  for (const L of layers) {
    const off = camX * L.depth;                     // slower than the level: this is the parallax
    const first = Math.floor((off - L.cell) / L.cell);
    const last = Math.ceil((off + W / k + L.cell) / L.cell);
    for (let n = first; n <= last; n++) {
      if (hash(n * 5.3 + L.seed) < L.gap) continue; // gaps, so the skyline isn't a solid wall
      const jitter = hash(n * 2.1 + L.seed) * (L.cell * 0.45);
      const sx = (n * L.cell + jitter - off) * k;
      if (sx > W + k * 14 || sx < -k * 18) continue;
      structure(pen, Math.min(4, Math.floor(hash(n * 9.1 + L.seed) * 5)), n, sx, groundY, k, H, L, col, lit);
    }
  }
}
