// Draws the world (background, terrain, hazards, platforms, coins, player, effects) through a Pen.
import { platPos, sawPos, spinnerAngle, pulseOn, PW, PH, BUCKET, INV_TIME, ORB_R, MODE } from '../game/sim.js';
import { hsl, hash } from './pen.js';
import { bgById } from './backgrounds.js';
import { skinById, trailColor } from './skins.js';
import { art } from './art.js';
import { drawBackStructures } from './worldbg.js';

const HOT = 0xff4fd8;
const SECTION_COL = { ship: 0xff6ad5, wave: 0x39e6ff, grav: 0xffd23a };
// colour of a mode portal: fly = pink, wave = cyan, gravity up = gold, back to normal = green
const mportCol = (m) => (m.mode === MODE.SHIP ? 0xff6ad5 : m.mode === MODE.WAVE ? 0x39e6ff : m.grav < 0 ? 0xffd23a : 0x4dff9a);
function mixColor(a, b, f) {
  const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * f);
  const g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * f);
  const bl = (a & 255) + (((b & 255) - (a & 255)) * f);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}
export const VIEW_TILES_H = 15; // vertical tiles on screen
export const GROUND_FRAC = 0.78;
const tmp = { x: 0, y: 0 };

export class Particles {
  // Particles are recycled: a finished one goes to a spare pile and is reused, so a busy level makes no garbage.
  constructor() { this.list = []; this.spare = []; }
  add(x, y, vx, vy, life, size, col, kind = 0, grav = 0) {
    if (this.list.length >= 400) return;
    const q = this.spare.pop() || {};
    q.x = x; q.y = y; q.vx = vx; q.vy = vy; q.life = life; q.max = life; q.size = size; q.col = col; q.kind = kind; q.grav = grav;
    this.list.push(q);
  }
  burst(x, y, n, cols, speed = 6, size = 0.14) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, v = speed * (0.3 + Math.random());
      this.add(x, y, Math.cos(a) * v, Math.sin(a) * v, 0.5 + Math.random() * 0.6, size * (0.6 + Math.random()), cols[i % cols.length], 0, 14);
    }
  }
  update(dt) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.life -= dt;
      if (p.life <= 0) { L[i] = L[L.length - 1]; L.pop(); this.spare.push(p); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= p.grav * dt;
    }
  }
  clear() { for (const q of this.list) this.spare.push(q); this.list.length = 0; }
}

export function layout(W, H) {
  const k = H / VIEW_TILES_H;
  return { W, H, k, groundY: H * GROUND_FRAC, tilesW: W / k };
}

let frameId = 0;

function drawTerrain(pen, v, lv, camX, th, t, reduced) {
  const x0 = camX - 2, x1 = camX + v.tilesW + 2;
  frameId++;
  const { k, groundY, H } = v;
  const sxf = (wx) => (wx - camX) * k;
  for (let bi = Math.floor(x0 / BUCKET); bi <= Math.floor(x1 / BUCKET); bi++) {
    const arr = lv.bSolid.get(bi);
    if (!arr) continue;
    for (const s of arr) {
      if (s._f === frameId) continue;
      s._f = frameId;
      const px = sxf(s.x), pw = s.w * k;
      if (px > v.W || px + pw < 0) continue;
      if (s.y1 === 0 && s.y0 < -1) {
        // ground
        const tx = th.tex && art.has(th.tex);
        if (tx) {
          pen.tile(th.tex, px, groundY, pw + 1, H - groundY + 2, k * 4, k * 4, -camX * k, groundY);
          if (!th.grass) pen.rect(px, groundY, pw + 1, Math.max(3, k * 0.09), th.groundTop, 1);
          continue;
        }
        pen.rect(px, groundY, pw + 1, H - groundY + 2, th.ground, 1);
        pen.rect(px, groundY + k * 0.5, pw + 1, H, th.ground2, 0.55);
        const gh = th.grass ? k * 0.2 : Math.max(3, k * 0.09);
        pen.rect(px, groundY, pw + 1, gh, th.groundTop, 1);
        if (th.grass) pen.rect(px, groundY + gh * 0.6, pw + 1, gh * 0.4, 0x4aa832, 1);
        pen.rect(px, groundY + gh, pw + 1, Math.max(4, k * 0.35), th.accent, 0.1);
        // vertical tile lines (gives a sense of speed)
        const i0 = Math.max(Math.ceil(s.x), Math.floor(x0)), i1 = Math.min(Math.floor(s.x + s.w), Math.ceil(x1));
        for (let i = i0; i <= i1; i++) pen.rect(sxf(i), groundY + k * 0.1, 1.5, H, th.groundTop, 0.07);
      } else {
        const top = groundY - s.y1 * k, hh = (s.y1 - s.y0) * k;
        if (th.tex && art.has(th.tex)) {
          pen.rect(px - 3, top - 3, pw + 6, hh + 6, 0x0a0614, 0.85);
          pen.tile(th.tex, px, top, pw, hh, k * 3, k * 3, -camX * k, top);
          // Every platform you can stand on carries a bright lit edge. Background scenery never does, which is what
          // tells the two apart at a glance.
          pen.rect(px, top, pw, Math.max(3, k * 0.09), th.groundTop, 1);
          pen.rect(px, top, pw, Math.max(2, k * 0.045), 0xffffff, 0.75);
          continue;
        }
        pen.rect(px - 2, top - 2, pw + 4, hh + 4, th.accent, 0.35);
        pen.rect(px, top, pw, hh, th.block, 1);
        pen.rect(px + 3, top + 3, pw - 6, hh - 6, th.ground2, 0.7);
        pen.rect(px, top, pw, th.grass ? k * 0.2 : Math.max(3, k * 0.09), th.groundTop, 1);
        for (let i = Math.ceil(s.x); i < s.x + s.w; i++) pen.rect(sxf(i), top, 1.5, hh, th.groundTop, 0.12);
      }
    }
  }
}

function drawSpike(pen, v, camX, x, y, ext = 1, a = 1, beat = 0, down = false) {
  const { k, groundY } = v;
  const bx = (x - camX) * k, by = groundY - y * k;
  const w = k, h = k * 0.78 * ext, d = down ? -1 : 1; // d = -1: hangs from y and points down
  if (beat > 0.12) pen.tri(bx - 7, by + 5 * d, bx + w + 7, by + 5 * d, bx + w / 2, by - (h + 11) * d, 0xff2f56, 0.3 * beat * a); // hazards flare on the kick
  pen.tri(bx - 3, by + 2 * d, bx + w + 3, by + 2 * d, bx + w / 2, by - (h + 4) * d, 0xffffff, 0.9 * a);
  pen.tri(bx + 2, by, bx + w - 2, by, bx + w / 2, by - h * d, 0xff2f56, a);
  pen.tri(bx + w * 0.32, by, bx + w * 0.68, by, bx + w / 2, by - h * 0.78 * d, 0x7d0a22, a);
}

function drawSaw(pen, v, cx, cy, r, ang, glow, beat = 0) {
  const { k } = v;
  const rr = r * k;
  if (glow) pen.circle(cx, cy, rr * (1.35 + 0.35 * beat), 0xff3b5c, 0.14 + 0.32 * beat);
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a = ang + (i / n) * 6.2832, a2 = a + 0.28, a3 = a - 0.28;
    pen.tri(cx + Math.cos(a2) * rr * 0.82, cy + Math.sin(a2) * rr * 0.82, cx + Math.cos(a3) * rr * 0.82, cy + Math.sin(a3) * rr * 0.82, cx + Math.cos(a) * rr * 1.18, cy + Math.sin(a) * rr * 1.18, 0xffffff, 0.95);
  }
  pen.circle(cx, cy, rr * 0.9, 0xff2f56, 1);
  pen.circle(cx, cy, rr * 0.62, 0x5b0a1d, 1);
  pen.circle(cx, cy, rr * 0.2, 0xffffff, 1);
  pen.line(cx, cy, cx + Math.cos(ang) * rr * 0.75, cy + Math.sin(ang) * rr * 0.75, Math.max(2, rr * 0.12), 0xffffff, 0.8);
}

// The beat grid. Because the runner moves at a constant speed, world x = speed * song time, so every beat of the song is a
// fixed spot in the level: ticks scroll past and the runner crosses each one exactly on its beat. Bar lines are taller;
// cue markers show the exact take-off spot of each obstacle.
function drawRhythmLane(pen, v, lv, camX, st, th) {
  const { k, groundY, W } = v, tpb = lv.tpb, mu = st.music;
  const sxf = (wx) => (wx - camX) * k;
  const down = st.map ? st.map.down : 0;
  const i0 = Math.max(0, Math.floor((camX - 1) / tpb)), i1 = Math.ceil((camX + v.tilesW + 1) / tpb);
  for (let i = i0; i <= i1; i++) {
    const x = sxf(i * tpb), bar = (((i - down) % 4) + 4) % 4 === 0;
    const cur = Math.abs(i - mu.beat) < 0.5 ? Math.max(0, 1 - Math.abs(i - mu.beat) * 2) : 0; // the beat the runner is on
    pen.rect(x - 1, groundY + 2, 2, k * (bar ? 0.55 : 0.28), th.accent, (bar ? 0.55 : 0.28) + 0.35 * cur);
    if (bar) pen.grad(x - 1, groundY - k * 5, 2, k * 5, th.accent, th.accent, 0, 0.1 + 0.1 * cur);
  }
  if (st.showCues && lv.cues) {
    const cs = lv.cues, tLo = (camX - 1.4) / lv.speed;
    let lo = 0, hi = cs.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cs[m].t < tLo) lo = m + 1; else hi = m; }   // binary search: first cue on screen
    for (let ci = lo; ci < cs.length; ci++) {
      const c = cs[ci], wx = c.t * lv.speed + 0.4;
      if (wx > camX + v.tilesW + 1) break;
      if (wx < camX - 1) continue;
      const x = sxf(wx), dt = c.t - mu.t;           // seconds until the runner reaches it
      const near = Math.max(0, 1 - Math.abs(dt) / 0.12);
      const r = k * (0.13 + 0.09 * near), y = groundY - k * 0.42;
      const col = c.hard ? 0xffe27a : 0x7df3ff;
      pen.tri(x - r, y, x + r, y, x, y + r * 1.9, col, 0.55 + 0.4 * near);   // a small chevron pointing at the spot
      pen.circle(x, y - r * 0.2, r * (1.9 + near), col, 0.1 + 0.25 * near);
    }
  }
}
// A bar-graph equalizer drawn into the ground, driven by the song's real kick / mid / hat energy.
function drawEQ(pen, v, st, th) {
  const { W, H, groundY, k } = v, mu = st.music;
  const n = 36, bw = W / n, room = (H - groundY) * 0.8;
  for (let i = 0; i < n; i++) {
    const pos = i / (n - 1);
    const lowW = Math.max(0, 1 - pos * 2.3), hiW = Math.max(0, (pos - 0.42) * 1.9), midW = Math.max(0, 1 - Math.abs(pos - 0.35) * 2.6);
    const val = Math.min(1, lowW * mu.low * 1.5 + midW * mu.mid * 1.1 + hiW * mu.hi * 1.2);
    const flick = 0.78 + 0.22 * Math.sin(st.t * 7 + i * 1.7);
    const h = (0.06 + 0.94 * val * flick) * room;
    pen.rect(i * bw + bw * 0.12, H - h, bw * 0.76, h, th.accent, 0.1 + 0.12 * val);
  }
}

export function drawWorld(pen, v, st) {
  const { W, H, k, groundY } = v;
  const bg = bgById(st.bgIndex);
  // colour trigger: the accent colour heats up toward a hot magenta as the music builds and drops (see BeatMap.heatAt)
  const th = st.music && st.music.heat > 0.01 && !st.reduced ? Object.assign({}, bg, { accent: mixColor(bg.accent, HOT, 0.85 * st.music.heat) }) : bg;
  const lv = st.level, run = st.run;
  const p = run ? run.p : null;
  const reduced = st.reduced;
  let camX;
  if (lv && p) camX = p.x + PW / 2 - v.tilesW * 0.3;
  else camX = st.t * 4;
  bg.draw(pen, W, H, st.t, st.pulse, camX, k, reduced);
  // Scenery between the sky and the level: parallax towers, buildings and world platforms. Drawn here so it is
  // always behind the terrain, the hazards and the player — scenery must never sit on top of gameplay.
  drawBackStructures(pen, W, H, groundY, camX, k, bg, reduced);
  // slight dim in the hazard lane for clarity
  pen.grad(0, groundY - 7 * k, W, 7.5 * k, 0x000000, 0x000000, 0, 0.22);
  const mu = st.music;
  if (mu && !reduced) {
    pen.grad(0, groundY - 6 * k, W, 6 * k, th.accent, th.accent, 0, 0.05 + 0.2 * mu.kick); // the floor glows on every kick
    if (mu.snare > 0.05) pen.grad(0, 0, W, H * 0.3, th.accent, th.accent, 0.16 * mu.snare, 0);   // the sky flashes on the snare
    if (mu.heat > 0.02) pen.grad(0, 0, W, groundY, HOT, HOT, 0.15 * mu.heat, 0.03 * mu.heat);     // the whole sky warms up in a drop
  }

  const sxf = (wx) => (wx - camX) * k;
  const syf = (wy) => groundY - wy * k;

  if (!lv && art.has('menu')) {
    const iw = art.w('menu'), ih = art.h('menu');
    const sc = Math.max(W / iw, H / ih) * 1.08, dw = iw * sc, dh = ih * sc;
    pen.image('menu', (W - dw) / 2 + Math.sin(st.t * 0.07) * (dw - W) * 0.45, (H - dh) / 2 + Math.cos(st.t * 0.05) * (dh - H) * 0.4, dw, dh);
    return { camX, playerPx: null };
  }
  if (!lv) {
    // menu: flat scrolling ground + decorative runner
    pen.rect(0, groundY, W, H - groundY, th.ground, 1);
    pen.rect(0, groundY + k * 0.5, W, H, th.ground2, 0.55);
    pen.rect(0, groundY, W, Math.max(3, k * 0.09), th.groundTop, 1);
    for (let i = Math.floor(camX); i < camX + v.tilesW + 1; i++) pen.rect(sxf(i), groundY + k * 0.1, 1.5, H, th.groundTop, 0.07);
    // looping demo spikes
    for (let i = 0; i < 4; i++) {
      const wx = Math.floor(camX / 14) * 14 + i * 14 + 12;
      drawSpike(pen, v, camX, wx, 0, 1, 0.9);
    }
    return { camX, playerPx: null };
  }

  // v6: fly / wave / gravity sections get a tinted corridor so the change of rules reads at a glance
  for (const z of lv.sections || []) {
    if (z.x1 < camX - 2 || z.x0 > camX + v.tilesW + 2) continue;
    for (const sg of z.segs || [z]) {
      const col = SECTION_COL[sg.kind] || 0xffffff;
      const xa = sxf(sg.x0), xb = sxf(sg.x1), top = syf(z.ceil || 9);
      pen.grad(xa, top, xb - xa, groundY - top, col, col, 0.16, 0.05);
    }
  }
  drawTerrain(pen, v, lv, camX, th, st.t, reduced);
  const bt = mu ? mu.kick : 0;
  if (mu) {
    if (!reduced) drawEQ(pen, v, st, th);
    drawRhythmLane(pen, v, lv, camX, st, th);
    pen.rect(0, groundY, W, 3, 0xffffff, 0.45 * bt); // the ground line flashes on the kick
  }

  const x0 = camX - 3, x1 = camX + v.tilesW + 3;
  // hazards
  for (let bi = Math.floor(x0 / BUCKET); bi <= Math.floor(x1 / BUCKET); bi++) {
    const arr = lv.bHaz.get(bi);
    if (!arr) continue;
    for (const h of arr) {
      if (h._f === frameId) continue;
      h._f = frameId;
      if (h.k === 0) drawSpike(pen, v, camX, h.x, h.y, 1, 1, bt, !!h.down);
      else if (h.k === 1) { sawPos(h, p ? p.t : st.t, tmp); drawSaw(pen, v, sxf(tmp.x), syf(tmp.y), h.r, st.t * 9, !reduced, bt); }
      else if (h.k === 2) {
        const tt = p ? p.t : st.t, a = spinnerAngle(h, tt), ca = Math.cos(a), sa = Math.sin(a);
        const cx = sxf(h.cx), cy = syf(h.cy);
        pen.line(cx - ca * h.len * k, cy + sa * h.len * k, cx + ca * h.len * k, cy - sa * h.len * k, k * 0.34, 0xffffff, 0.95);
        pen.line(cx - ca * h.len * k, cy + sa * h.len * k, cx + ca * h.len * k, cy - sa * h.len * k, k * 0.22, 0xff2f56, 1);
        pen.circle(cx - ca * h.len * k, cy + sa * h.len * k, k * 0.2, 0xff2f56, 1);
        pen.circle(cx + ca * h.len * k, cy - sa * h.len * k, k * 0.2, 0xff2f56, 1);
        pen.circle(cx, cy, k * 0.3, 0x5b0a1d, 1); pen.circle(cx, cy, k * 0.14, 0xffffff, 1);
      } else if (h.k === 3) {
        const tt = p ? p.t : st.t, f = (((tt / h.period + h.phase) % 1) + 1) % 1;
        const on = f < h.on;
        const warn = !on && f > 1 - 0.12;
        const ext = on ? 1 : warn ? 0.35 : 0.14;
        pen.rect(sxf(h.x), syf(0) - k * 0.1, h.n * k, k * 0.1, 0x7d0a22, 1);
        if (warn || on) pen.rect(sxf(h.x), syf(0) - k * 0.1, h.n * k, k * 0.1, 0xffd0d8, warn ? 0.9 : 0.4);
        for (let i = 0; i < h.n; i++) drawSpike(pen, v, camX, h.x + i, 0.0, ext, on ? 1 : 0.6, on ? bt : 0);
      }
    }
  }
  // moving platforms
  for (let bi = Math.floor(x0 / BUCKET); bi <= Math.floor(x1 / BUCKET); bi++) {
    const arr = lv.bPlat.get(bi);
    if (!arr) continue;
    for (const pl of arr) {
      if (pl._f === frameId) continue;
      pl._f = frameId;
      platPos(pl, p ? p.t : st.t, tmp);
      const px = sxf(tmp.x), py = syf(tmp.y), pw = pl.w * k, ph = pl.h * k;
      pen.rect(px - 4, py - 4, pw + 8, ph + 8, 0x39e6ff, 0.22);
      pen.rect(px, py, pw, ph, 0x0b3a52, 1);
      pen.rect(px, py, pw, Math.max(3, k * 0.1), 0x7df3ff, 1);
      pen.rect(px + pw * 0.08, py + ph * 0.45, pw * 0.84, Math.max(2, ph * 0.18), 0x39e6ff, 0.9);
      // direction arrows
      const dx = pl.ax, dy = pl.ay;
      const ax = px + pw / 2, ay = py + ph / 2;
      if (dy > 0.01) { pen.tri(ax - k * 0.15, ay + k * 0.02, ax + k * 0.15, ay + k * 0.02, ax, ay - k * 0.14, 0xbefaff, 0.9); }
      if (dx > 0.01) { pen.tri(px + k * 0.18, ay, px + k * 0.38, ay - k * 0.1, px + k * 0.38, ay + k * 0.1, 0xbefaff, 0.9); pen.tri(px + pw - k * 0.18, ay, px + pw - k * 0.38, ay - k * 0.1, px + pw - k * 0.38, ay + k * 0.1, 0xbefaff, 0.9); }
    }
  }
  // portals (upside-down = magenta, mirror = cyan; a dim "exit" ring closes each zone)
  for (const g of lv.portals) {
    if (g.x < x0 - 1 || g.x > x1 + 1) continue;
    const used = p && p.portalsUsed[g.i];
    const yb = Math.max(g.y0, 0), yt = Math.min(g.y1, yb + (g.y1 > 20 ? (g.y0 < 0 ? 10.5 : 5) : 4.6));
    const bx = sxf(g.x + 0.2), top = syf(yt), bot = syf(yb), hh = bot - top;
    const col = g.style === 'flip' ? 0xd24dff : 0x39e6ff, hi = g.style === 'flip' ? 0xf0b0ff : 0xb8f6ff;
    const exit = g.set === 0, a = (used ? 0.35 : 1) * (exit ? 0.75 : 1);
    pen.grad(bx - k * 0.9, top, k * 1.8, hh, col, col, 0.0, 0.2 * a);
    pen.rect(bx - k * 0.1, top, k * 0.2, hh, col, 0.9 * a);
    pen.rect(bx - k * 0.04, top, k * 0.08, hh, 0xffffff, 0.8 * a);
    // flowing shimmer
    const n = Math.max(2, Math.round(hh / (k * 0.9)));
    for (let i = 0; i < n; i++) {
      const f = (((st.t * 0.6 + i / n) % 1) + 1) % 1, yy = bot - f * hh;
      pen.rect(bx - k * 0.55, yy - 2, k * 1.1, 4, hi, 0.55 * a * Math.sin(f * 3.1416));
    }
    // symbol: flip = up/down arrows, mirror = left/right arrows (exit rings show a small tick instead)
    const my = (top + bot) / 2, q = k * 0.34;
    if (!exit) {
      pen.circle(bx, my, q * 1.9, 0x10062a, 0.55 * a);
      if (g.style === 'flip') {
        pen.tri(bx - q, my - q * 0.2, bx + q, my - q * 0.2, bx, my - q * 1.25, 0xffffff, a);
        pen.tri(bx - q, my + q * 0.2, bx + q, my + q * 0.2, bx, my + q * 1.25, 0xffffff, a);
      } else {
        pen.tri(bx - q * 0.2, my - q, bx - q * 0.2, my + q, bx - q * 1.25, my, 0xffffff, a);
        pen.tri(bx + q * 0.2, my - q, bx + q * 0.2, my + q, bx + q * 1.25, my, 0xffffff, a);
      }
    } else {
      pen.ring(bx, my, q * 1.2, Math.max(2, k * 0.06), 0xffffff, 0.8 * a);
    }
  }
  // v6 mode portals: a tall glowing gate with a symbol for what it does
  (lv.mports || []).forEach((m, i) => {
    if (m.x < x0 - 1 || m.x > x1 + 1) return;
    const used = p && p.mportsUsed && p.mportsUsed[i];
    const col = mportCol(m), a = used ? 0.45 : 1;
    const bx = sxf(m.x), top = syf(11), bot = syf(0), hh = bot - top;
    pen.grad(bx - k * 1.1, top, k * 2.2, hh, col, col, 0.05 * a, 0.28 * a);
    pen.rect(bx - k * 0.16, top, k * 0.32, hh, col, 0.95 * a);
    pen.rect(bx - k * 0.05, top, k * 0.1, hh, 0xffffff, 0.85 * a);
    const n = 6;
    for (let j = 0; j < n; j++) {
      const f = (((st.t * 0.8 + j / n) % 1) + 1) % 1, yy = bot - f * hh;
      pen.rect(bx - k * 0.7, yy - 2, k * 1.4, 4, 0xffffff, 0.5 * a * Math.sin(f * 3.1416));
    }
    // symbol in a dark disc halfway up
    const my = syf(m.mode === MODE.CUBE && m.grav > 0 ? 1.6 : 3.2), q = k * 0.42;
    pen.circle(bx, my, q * 2, 0x10062a, 0.7 * a);
    pen.ring(bx, my, q * 2, Math.max(2, k * 0.07), col, a);
    if (m.mode === MODE.SHIP) { pen.tri(bx - q * 1.2, my + q * 0.6, bx + q * 1.3, my, bx - q * 1.2, my - q * 0.6, 0xffffff, a); pen.tri(bx - q * 0.4, my, bx - q * 1.3, my + q * 1.1, bx + q * 0.2, my + q * 0.3, col, a); }
    else if (m.mode === MODE.WAVE) { for (let j = 0; j < 3; j++) pen.line(bx - q * 1.2 + j * q * 0.8, my + (j % 2 ? -q : q) * 0.6, bx - q * 0.4 + j * q * 0.8, my + (j % 2 ? q : -q) * 0.6, Math.max(2, k * 0.09), 0xffffff, a); }
    else if (m.grav < 0) { pen.tri(bx - q, my + q * 0.2, bx + q, my + q * 0.2, bx, my - q * 1.2, 0xffffff, a); pen.rect(bx - q * 0.3, my + q * 0.2, q * 0.6, q * 0.9, 0xffffff, a); }
    else { pen.rect(bx - q * 0.75, my - q * 0.75, q * 1.5, q * 1.5, 0xffffff, a); pen.rect(bx - q * 0.45, my - q * 0.45, q * 0.9, q * 0.9, col, a); }
  });
  // v6 secret coins (on the risky high route of a fork)
  (lv.secrets || []).forEach((c, i) => {
    if (c.x < x0 - 1 || c.x > x1 + 1) return;
    const got = p && p.secretsGot && p.secretsGot[i];
    const bx = sxf(c.x), cy = syf((c.cy || c.y0 + 2) + Math.sin(st.t * 2.5 + i) * 0.15), R = k * 0.75;
    if (got) { pen.ring(bx, cy, R, 2, 0xffd23a, 0.35); return; }
    const sp = Math.abs(Math.cos(st.t * 2.2 + i));
    pen.circle(bx, cy, R * 2.4, 0xffd23a, 0.1 + 0.08 * Math.sin(st.t * 5));
    pen.circle(bx, cy, R * 1.6, 0xffd23a, 0.16);
    const w = R * Math.max(0.2, sp);
    pen.quad(bx - w, cy, bx, cy - R * 1.15, bx + w, cy, bx, cy + R * 1.15, 0xb8860b, 1);
    pen.quad(bx - w * 0.78, cy, bx, cy - R * 0.9, bx + w * 0.78, cy, bx, cy + R * 0.9, 0xffd23a, 1);
    pen.quad(bx - w * 0.35, cy - R * 0.2, bx, cy - R * 0.62, bx + w * 0.2, cy - R * 0.25, bx, cy, 0xfff8d0, 0.85);
  });
  // power-up orbs (double jump)
  for (const o of lv.orbs) {
    if (o.x < x0 - 1 || o.x > x1 + 1 || (p && p.orbsUsed[o.i])) continue;
    const bob = Math.sin(st.t * 3 + o.i) * 0.15, ox = sxf(o.x), oy = syf(o.y + bob), R = ORB_R * k, pl = 0.9 + 0.1 * Math.sin(st.t * 6);
    pen.circle(ox, oy, R * 2.0 * pl, 0x7dffb0, 0.12);
    pen.circle(ox, oy, R * 1.45, 0x7dffb0, 0.2);
    pen.circle(ox, oy, R, 0x0c5a3a, 1);
    pen.circle(ox, oy, R * 0.86, 0x4dff9a, 1);
    pen.circle(ox - R * 0.25, oy - R * 0.3, R * 0.3, 0xffffff, 0.45);
    // double chevron = "jump twice"
    const q = R * 0.42;
    pen.tri(ox - q, oy - q * 0.1, ox + q, oy - q * 0.1, ox, oy - q * 1.0, 0x06301f, 1);
    pen.tri(ox - q, oy + q * 0.75, ox + q, oy + q * 0.75, ox, oy - q * 0.15, 0x06301f, 1);
  }
  // checkpoints
  lv.checkpoints.forEach((c, i) => {
    if (c.x < x0 || c.x > x1) return;
    const reached = p && p.cpIndex >= i;
    const col = reached ? 0x4dff9a : 0xbfe6ff;
    const bx = sxf(c.x), by = syf(0);
    pen.rect(bx - 2, by - k * 2.6, 4, k * 2.6, col, 0.95);
    pen.tri(bx + 2, by - k * 2.6, bx + k * 1.0, by - k * 2.2, bx + 2, by - k * 1.8, col, 0.95);
    pen.circle(bx, by, k * 0.4 * (1 + st.pulse * 0.2), col, 0.18);
  });
  // coins (mandatory trivia gates)
  lv.coins.forEach((c, i) => {
    if (c.x < x0 - 1 || c.x > x1 + 1) return;
    const used = p && p.coinsUsed[i];
    const bx = sxf(c.x);
    const cy = syf(1.8);
    if (!used) {
      const wob = 0.75 + 0.25 * Math.sin(st.t * 3 + i);
      pen.grad(bx - k * 0.28, 0, k * 0.56, groundY, 0xffd23a, 0xffd23a, 0.03, 0.2 * wob);
      pen.rect(bx - 1.5, 0, 3, groundY, 0xffe27a, 0.35 * wob);
      const sq = Math.abs(Math.cos(st.t * 3 + i));
      const rr = k * 0.5 * (1 + 0.14 * bt);
      pen.circle(bx, cy, rr * 1.7, 0xffd23a, 0.14);
      pen.circle(bx, cy, rr * 1.2, 0xffd23a, 0.18);
      if (art.has('coin')) { const cw = rr * 3.2 * Math.max(0.15, sq); pen.image('coin', bx - cw / 2, cy - rr * 1.6, cw, rr * 3.2); return; }
      pen.circle(bx, cy, rr, 0xb8860b, 1);
      pen.circle(bx, cy, rr * 0.86, 0xffd23a, 1);
      pen.circle(bx, cy, rr * 0.66, 0xffeb99, 1);
      const bw = rr * 0.16 * (0.5 + 0.5 * sq);
      pen.rect(bx - bw, cy - rr * 0.42, bw * 2, rr * 0.84, 0xb8860b, 1);
      pen.rect(bx - rr * 0.3, cy - rr * 0.14, rr * 0.6, rr * 0.16, 0xb8860b, 1);
    } else {
      pen.ring(bx, cy, k * 0.45, 2, 0x8a8a9a, 0.35);
    }
  });
  // finish
  if (lv.finishX < x1 + 4) {
    const fx = sxf(lv.finishX);
    pen.grad(fx - k * 0.7, 0, k * 1.4, groundY, 0xffffff, 0xffe27a, 0.02, 0.35);
    const sz = k * 0.5;
    for (let r = 0; r * sz < groundY; r++) for (let c = 0; c < 2; c++) pen.rect(fx - sz + c * sz, r * sz, sz, sz, (r + c) % 2 ? 0x101018 : 0xffffff, 0.92);
  }
  if (mu && mu.drop > 0.02) pen.rect(0, 0, W, H, 0xffffff, Math.min(0.5, 0.5 * mu.drop * mu.drop)); // the drop lands: whole screen flashes
  return { camX };
}

export function drawPlayer(pen, v, st, camX) {
  const { k, groundY } = v;
  const run = st.run, p = run.p, an = st.anim || { landT: -9, jumpT: -9 };
  const skin = skinById(st.skinId);
  const cx = (p.x + PW / 2 - camX) * k, cy = groundY - (p.y + PH / 2) * k, s = PW * k;
  if (!p.dead) {
    // squash & stretch: stretched while rising/falling fast, squashed for a moment on take-off and landing
    let sx = 1, sy = 1;
    const sinceLand = st.t - an.landT, sinceJump = st.t - an.jumpT;
    if (!p.grounded) {
      const str = Math.min(0.14, Math.abs(p.vy) / 110);
      sy = 1 + str; sx = 1 - str * 0.7;
      if (sinceJump < 0.07) { sy = 0.9; sx = 1.1; }
    } else if (sinceLand < 0.13) {
      const q = 1 - sinceLand / 0.13;
      sy = 1 - 0.2 * q; sx = 1 + 0.18 * q;
    }
    const mu = st.music;
    if (mu) {
      // squash on the kick while running; a ring spreads from the feet on every beat (bigger on the bar's first beat)
      if (p.grounded) { sy *= 1 - 0.05 * mu.kick; sx *= 1 + 0.05 * mu.kick; }
      if (!st.reduced) {
        const f = mu.beat - Math.floor(mu.beat), bar = (((Math.floor(mu.beat) - (st.map ? st.map.down : 0)) % 4) + 4) % 4 === 0;
        const rr = k * (0.35 + (bar ? 1.9 : 1.2) * f), a = (1 - f) * (bar ? 0.55 : 0.32);
        pen.ring(cx, groundY, rr, Math.max(2, k * 0.05), 0x7df3ff, a);
      }
      const rg = st.ring;
      if (rg && st.t - rg.t < 0.45 && !st.reduced) {
        const f = (st.t - rg.t) / 0.45, col = rg.kind === 'perfect' ? 0xffe27a : rg.kind === 'great' ? 0x7df3ff : rg.kind === 'good' ? 0xffffff : 0xff6a7a;
        pen.ring(cx, cy, s * (0.7 + 1.6 * f), Math.max(2, k * 0.07 * (1 - f)), col, 0.9 * (1 - f));
      }
    }
    const live = p.t < p.djUntil;
    if (live && !st.reduced) {
      const left = p.djUntil - p.t, fl = left < 3 && Math.floor(st.t * 8) % 2 ? 0.4 : 1;
      const R = s * (1.05 + 0.06 * Math.sin(st.t * 9));
      pen.circle(cx, cy, R * 1.25, 0x4dff9a, 0.12 * fl);
      pen.ring(cx, cy, R, Math.max(2, k * 0.05), 0x7dffb0, (p.djUsed ? 0.35 : 0.9) * fl);
    }
    if (p.mode === MODE.SHIP || p.mode === MODE.WAVE) drawFlyer(pen, v, st, p, skin, cx, cy, s, camX);
    else skin.draw(pen, cx, cy, s, p.rot, st.t, !st.reduced, sx, sy);
    if (p.mode === MODE.CUBE && p.grav < 0 && !st.reduced) pen.ring(cx, cy, s * 0.95, Math.max(2, k * 0.05), 0xffd23a, 0.5 + 0.3 * Math.sin(st.t * 8)); // upside-down glow
    if (run.invActive) {
      const left = p.invUntil - p.t, flick = left < 0.5 ? (Math.floor(st.t * 14) % 2 ? 0.35 : 1) : 1;
      const R = s * (0.95 + 0.05 * Math.sin(st.t * 10));
      pen.circle(cx, cy, R, 0x7fd8ff, 0.16 * flick);
      pen.ring(cx, cy, R, Math.max(2.5, k * 0.07), 0xbdf0ff, 0.95 * flick);
      pen.ring(cx, cy, R * 0.86, Math.max(1.5, k * 0.04), 0xffffff, 0.5 * flick);
      for (let i = 0; i < 6; i++) {
        const a = st.t * 3 + (i * 6.2832) / 6;
        pen.circle(cx + Math.cos(a) * R, cy + Math.sin(a) * R, k * 0.07, 0xffffff, 0.9 * flick);
      }
    }
  }
}

export function drawParticles(pen, v, parts, camX) {
  const { k, groundY } = v;
  for (const q of parts.list) {
    const a = q.life / q.max;
    const px = (q.x - camX) * k, py = groundY - q.y * k, sz = q.size * k * (0.4 + 0.6 * a);
    if (q.kind === 0) pen.circle(px, py, sz, q.col, a);
    else pen.rect(px - sz / 2, py - sz / 2, sz, sz, q.col, a);
  }
}

export function emitTrail(parts, p, skin, t, reduced, dt) {
  if (p.dead || reduced) return;
  const n = (skin.trail.kind === 'flame' ? 2 : 1);
  for (let i = 0; i < n; i++) {
    const ci = Math.floor(Math.random() * 3);
    parts.add(p.x + 0.1, p.y + 0.15 + Math.random() * 0.5, -3 - Math.random() * 3, (Math.random() - 0.3) * (skin.trail.kind === 'flame' ? 3 : 1.5), 0.35 + Math.random() * 0.25, skin.trail.size * (0.7 + Math.random() * 0.7), trailColor(skin, ci, t), skin.trail.kind === 'block' ? 1 : 0, skin.trail.kind === 'flame' ? -4 : 0);
  }
}

// v6: the ship (a hull with the player's cube riding on top) and the wave (a dart that leaves a zig-zag trail)
function drawFlyer(pen, v, st, p, skin, cx, cy, s, camX) {
  const { k, groundY } = v;
  const a = p.rot, ca = Math.cos(a), sa = Math.sin(a);
  const P = (x, y) => [cx + (x * ca - y * sa) * s, cy + (x * sa + y * ca) * s];
  if (p.mode === MODE.WAVE) {
    const tr = st.trail || [];
    for (let i = 1; i < tr.length; i++) {
      const f = i / tr.length;
      pen.line((tr[i - 1].x - camX) * k, groundY - tr[i - 1].y * k, (tr[i].x - camX) * k, groundY - tr[i].y * k, Math.max(2, k * 0.2 * f), 0x7df3ff, 0.15 + 0.6 * f);
    }
    const n = P(0.75, 0), t1 = P(-0.5, -0.42), t2 = P(-0.5, 0.42), m = P(-0.25, 0);
    const o1 = P(0.95, 0), o2 = P(-0.62, -0.55), o3 = P(-0.62, 0.55);
    pen.tri(o1[0], o1[1], o2[0], o2[1], o3[0], o3[1], 0xffffff, 0.95);
    pen.tri(n[0], n[1], t1[0], t1[1], t2[0], t2[1], 0x39e6ff, 1);
    pen.tri(n[0], n[1], t1[0], t1[1], m[0], m[1], 0xb8f6ff, 0.9);
    return;
  }
  // ship: outline, hull, a stripe, an engine flame while climbing, the cube riding on top
  const hull = [P(0.85, 0.12), P(-0.65, -0.12), P(-0.6, 0.48), P(0.45, 0.45)];
  const out = [P(1.05, 0.12), P(-0.8, -0.22), P(-0.74, 0.6), P(0.5, 0.58)];
  if (p.hold && !st.reduced) { const f1 = P(-0.66, 0.06), f2 = P(-0.62, 0.4), f3 = P(-1.15 - 0.25 * Math.sin(st.t * 40), 0.22); pen.tri(f1[0], f1[1], f2[0], f2[1], f3[0], f3[1], 0xffb02e, 0.95); }
  pen.quad(out[0][0], out[0][1], out[1][0], out[1][1], out[2][0], out[2][1], out[3][0], out[3][1], 0xffffff, 0.95);
  pen.quad(hull[0][0], hull[0][1], hull[1][0], hull[1][1], hull[2][0], hull[2][1], hull[3][0], hull[3][1], 0xff6ad5, 1);
  const s1 = P(0.55, 0.26), s2 = P(-0.55, 0.12), s3 = P(-0.55, 0.26), s4 = P(0.4, 0.34);
  pen.quad(s1[0], s1[1], s2[0], s2[1], s3[0], s3[1], s4[0], s4[1], 0xffffff, 0.7);
  const c = P(-0.12, -0.3);
  skin.draw(pen, c[0], c[1], s * 0.55, a, st.t, !st.reduced, 1, 1);
}
