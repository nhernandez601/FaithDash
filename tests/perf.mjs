// Frame cost + smoothness probe. Plays level 3 for a while (runner made invincible) and records, per frame:
// the CPU time of one game tick, how many drawing batches the frame needed, and how far the camera moved.
import { chromium } from 'playwright-core';
import { spawn } from 'child_process';
const port = 4195;
const srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(`http://localhost:${port}/`); await p.waitForTimeout(1500); await p.mouse.click(640, 360);
await p.evaluate(() => {
  const { app } = __fd; const rec = (window.__rec = []);
  const orig = app.tick.bind(app);
  app.tick = (dt) => {
    const t0 = performance.now(); orig(dt); const ms = performance.now() - t0;
    const pen = app.pen, run = app.run;
    rec.push({ ms, dt, g: pen.gi, i: pen.ii, ts: pen.ti, cam: app.lastCamX != null ? app.lastCamX : run ? run.p.x : 0, st: document.body.dataset.state });
  };
  app.startLevel(3);
});
await p.waitForTimeout(4500);
await p.evaluate(() => { __fd.app.run.p.invUntil = 1e9; __fd.app.run.lives = 99; });
await p.evaluate(() => (window.__rec.length = 0));
await p.waitForTimeout(12000);
const rec = await p.evaluate(() => window.__rec.filter((r) => r.st === 'PLAYING' || r.st === 'playing'));
const ms = rec.map((r) => r.ms).sort((a, b) => a - b);
const q = (a, f) => a[Math.min(a.length - 1, Math.floor(a.length * f))];
const batches = rec.map((r) => r.g + r.i + r.ts).sort((a, b) => a - b);
// smoothness: camera speed per frame should be constant (speed tiles/s). Measure its spread.
const v = []; for (let i = 1; i < rec.length; i++) if (rec[i].dt > 0) v.push((rec[i].cam - rec[i - 1].cam) / rec[i].dt);
const mean = v.reduce((a, b) => a + b, 0) / v.length, sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
console.log(JSON.stringify({ frames: rec.length, tickMs: { median: +q(ms, 0.5).toFixed(2), p95: +q(ms, 0.95).toFixed(2), max: +ms[ms.length - 1].toFixed(2) },
  batches: { median: q(batches, 0.5), p95: q(batches, 0.95) }, graphics: q(rec.map((r) => r.g).sort((a, b) => a - b), 0.5),
  camSpeed: { mean: +mean.toFixed(2), spreadPct: +((100 * sd) / mean).toFixed(1) } }));
console.log(errs.join('\n') || 'no console errors');
await b.close(); srv.kill();
