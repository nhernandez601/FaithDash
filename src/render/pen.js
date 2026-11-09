// Tiny drawing abstraction so the SAME art code renders in the Phaser game and in 2D-canvas menu previews.
const css = (c, a = 1) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;

// PhaserPen keeps strict painter's order: shapes go into a Graphics "segment"; an image or tiled texture closes the
// segment, so shapes drawn afterwards appear on top of it.
import { art } from './art.js';
export class PhaserPen {
  constructor(scene) {
    this.scene = scene;
    this.gs = []; this.is = []; this.ts = [];
    this.gi = 0; this.ii = 0; this.ti = 0; this.d = 0; this.cur = null;
  }
  get g() {
    if (!this.cur) {
      let g = this.gs[this.gi++];
      if (!g) { g = this.scene.add.graphics(); this.gs.push(g); }
      g.clear(); g.setVisible(true); g.setDepth(this.d++);
      this.cur = g;
    }
    return this.cur;
  }
  clear() {
    for (let i = this.gi; i < this.gs.length; i++) this.gs[i].setVisible(false);
    for (let i = this.ii; i < this.is.length; i++) this.is[i].setVisible(false);
    for (let i = this.ti; i < this.ts.length; i++) this.ts[i].setVisible(false);
    this.gi = this.ii = this.ti = this.d = 0; this.cur = null;
  }
  // End of a frame: hide every pooled object this frame did not use. (Without this, a frame that draws fewer shapes than
  // the one before briefly showed the previous frame's leftovers: a one-frame "ghost".)
  finish() {
    for (let i = this.gi; i < this.gs.length; i++) this.gs[i].setVisible(false);
    for (let i = this.ii; i < this.is.length; i++) this.is[i].setVisible(false);
    for (let i = this.ti; i < this.ts.length; i++) this.ts[i].setVisible(false);
  }
  tex(k) {
    const T = this.scene.textures;
    if (!T.exists(k) && art.img[k]) T.addImage(k, art.img[k]);
    return T.exists(k);
  }
  image(k, x, y, w, h, a = 1, rot = 0, flipX = false) {
    if (!this.tex(k)) return;
    this.cur = null;
    let im = this.is[this.ii++];
    if (!im) { im = this.scene.add.image(0, 0, k); this.is.push(im); }
    im.setTexture(k).setVisible(true).setOrigin(0.5, 0.5).setPosition(x + w / 2, y + h / 2).setDisplaySize(w, h).setRotation(rot).setAlpha(a).setFlipX(flipX).setDepth(this.d++);
  }
  // Repeating texture. (tw,th) = size of one tile on screen; (ox,oy) = screen offset of the tile origin.
  tile(k, x, y, w, h, tw, th, ox = 0, oy = 0) {
    if (!this.tex(k)) return;
    this.cur = null;
    let t = this.ts[this.ti++];
    if (!t) { t = this.scene.add.tileSprite(0, 0, 8, 8, k); this.ts.push(t); }
    const sx = tw / art.w(k), sy = th / art.h(k);
    t.setTexture(k).setVisible(true).setOrigin(0, 0).setPosition(x, y).setSize(Math.max(1, w), Math.max(1, h)).setTileScale(sx, sy).setDepth(this.d++);
    t.tilePositionX = (x - ox) / sx; t.tilePositionY = (y - oy) / sy;
  }
  rect(x, y, w, h, c, a = 1) { const g = this.g; g.fillStyle(c, a); g.fillRect(x, y, w, h); }
  grad(x, y, w, h, c1, c2, a1 = 1, a2 = 1) { const g = this.g; g.fillGradientStyle(c1, c1, c2, c2, a1, a1, a2, a2); g.fillRect(x, y, w, h); }
  circle(x, y, r, c, a = 1) { const g = this.g; g.fillStyle(c, a); g.fillCircle(x, y, r); }
  ring(x, y, r, lw, c, a = 1) { const g = this.g; g.lineStyle(lw, c, a); g.strokeCircle(x, y, r); }
  tri(x1, y1, x2, y2, x3, y3, c, a = 1) { const g = this.g; g.fillStyle(c, a); g.fillTriangle(x1, y1, x2, y2, x3, y3); }
  quad(x1, y1, x2, y2, x3, y3, x4, y4, c, a = 1) { const g = this.g; g.fillStyle(c, a); g.fillTriangle(x1, y1, x2, y2, x3, y3); g.fillTriangle(x1, y1, x3, y3, x4, y4); }
  line(x1, y1, x2, y2, lw, c, a = 1) { const g = this.g; g.lineStyle(lw, c, a); g.lineBetween(x1, y1, x2, y2); }
}

export class CanvasPen {
  constructor(ctx) { this.c = ctx; }
  finish() {}
  clear() { const c = this.c; c.clearRect(0, 0, c.canvas.width, c.canvas.height); }
  image(k, x, y, w, h, a = 1, rot = 0, flipX = false) {
    const im = art.img[k]; if (!im) return;
    const c = this.c; c.save(); c.globalAlpha = a; c.translate(x + w / 2, y + h / 2); if (rot) c.rotate(rot); if (flipX) c.scale(-1, 1);
    c.drawImage(im, -w / 2, -h / 2, w, h); c.restore();
  }
  tile(k, x, y, w, h, tw, th, ox = 0, oy = 0) {
    const im = art.img[k]; if (!im) return;
    const c = this.c; c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    for (let yy = oy - Math.ceil((oy - y) / th) * th; yy < y + h; yy += th) for (let xx = ox - Math.ceil((ox - x) / tw) * tw; xx < x + w; xx += tw) c.drawImage(im, xx, yy, tw, th);
    c.restore();
  }
  rect(x, y, w, h, col, a = 1) { this.c.fillStyle = css(col, a); this.c.fillRect(x, y, w, h); }
  grad(x, y, w, h, c1, c2, a1 = 1, a2 = 1) {
    const g = this.c.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, css(c1, a1)); g.addColorStop(1, css(c2, a2));
    this.c.fillStyle = g; this.c.fillRect(x, y, w, h);
  }
  circle(x, y, r, col, a = 1) { const c = this.c; c.fillStyle = css(col, a); c.beginPath(); c.arc(x, y, Math.max(0, r), 0, 6.2832); c.fill(); }
  ring(x, y, r, lw, col, a = 1) { const c = this.c; c.strokeStyle = css(col, a); c.lineWidth = lw; c.beginPath(); c.arc(x, y, Math.max(0, r), 0, 6.2832); c.stroke(); }
  tri(x1, y1, x2, y2, x3, y3, col, a = 1) { const c = this.c; c.fillStyle = css(col, a); c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.lineTo(x3, y3); c.closePath(); c.fill(); }
  quad(x1, y1, x2, y2, x3, y3, x4, y4, col, a = 1) { const c = this.c; c.fillStyle = css(col, a); c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.lineTo(x3, y3); c.lineTo(x4, y4); c.closePath(); c.fill(); }
  line(x1, y1, x2, y2, lw, col, a = 1) { const c = this.c; c.strokeStyle = css(col, a); c.lineWidth = lw; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); }
}

export function hsl(h, s, l) {
  h = ((h % 1) + 1) % 1;
  const f = (n) => { const k = (n + h * 12) % 12; const a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1))); };
  return (Math.round(f(0) * 255) << 16) | (Math.round(f(8) * 255) << 8) | Math.round(f(4) * 255);
}
export const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
export const wrap = (v, m) => ((v % m) + m) % m;
