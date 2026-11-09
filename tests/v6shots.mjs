// v6 screenshots: plays a level with the prover's own inputs up to a chosen moment, then freezes and renders it.
// Usage: node tests/v6shots.mjs   (writes tests/shots/v6_*.png)
import { chromium } from 'playwright-core';
import { spawn } from 'child_process';
import fs from 'fs';
fs.mkdirSync('tests/shots', { recursive: true });
const port = 4197;
const srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(`http://localhost:${port}/`); await p.waitForTimeout(1500);
const shots = [];
for (const [lvl, kind, beatsIn, name] of [[2, 'ship', 6, 'ship'], [2, 'wave', 6, 'wave'], [3, 'grav', 5, 'grav'], [3, 'grav', 14, 'grav2'], [1, 'secret', -1.5, 'secret'], [1, 'ship', -0.4, 'portal']]) {
  const info = await p.evaluate(async ({ lvl, kind, beatsIn }) => {
    const { app, step, DT } = __fd;
    app.startLevel(lvl);
    app.hold = true; // freeze the live loop; we drive the simulation ourselves
    const lv = app.level, r = app.run;
    let targetX;
    if (kind === 'secret') targetX = lv.secrets[0].x + beatsIn * lv.tpb;
    else { const z = lv.sections.find((q) => q.kind === kind); targetX = z.x0 + beatsIn * lv.tpb; }
    // play the level with the prover's inputs, taking the HIGH route at forks when we want a secret coin
    const L = kind === 'secret' ? __fd.routeLevel(lv, ['g']) : lv;
    const pr = __fd.proveCompletable(L, { margin: 0, pressEvery: 1 });
    if (!pr.ok) return { err: 'not proven' };
    const at = new Map(); for (const e of pr.inputs) { if (!at.has(e.tick)) at.set(e.tick, []); at.get(e.tick).push(e.ev); }
    const lv2 = Object.assign({}, lv, { coins: [], checkpoints: [] });
    const pl = r.p;
    pl.coinsUsed = new Uint8Array(lv.coins.length).fill(1);
    for (let tick = 0; tick < 60 * 600 && pl.x < targetX && !pl.dead; tick++) {
      let press = false;
      for (const ev of at.get(tick) || []) { if (ev === 'p') { press = true; pl.hold = false; } else if (ev === 'd') { press = true; pl.hold = true; } else if (ev === 'u') pl.hold = false; }
      for (let i = 0; i < 2; i++) { step(kind === 'secret' ? L : lv2, pl, DT, press && i === 0); if (kind !== 'secret' || true) {} }
      if (pl.mode === 2) { const tr = (app.trail = app.trail || []); tr.push({ x: pl.x + 0.4, y: pl.y + 0.4 }); if (tr.length > 40) tr.shift(); }
    }
    app.renderT = pl.t; r.prev = null;
    app.fsm.state = 'PLAYING';
    app.render();
    return { x: pl.x.toFixed(1), y: pl.y.toFixed(2), mode: pl.mode, grav: pl.grav, dead: pl.dead, secrets: Array.from(pl.secretsGot || []) };
  }, { lvl, kind, beatsIn });
  await p.waitForTimeout(300);
  await p.screenshot({ path: `tests/shots/v6_${name}.png` });
  shots.push([name, JSON.stringify(info)]);
}
for (const s of shots) console.log(s.join(': '));
console.log(errs.join('\n') || 'no console errors');
await b.close(); srv.kill();
