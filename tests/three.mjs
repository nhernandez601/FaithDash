// 3D test page (Milestone 1): loads /, builds each level in 3D, moves the runner with the prover's own inputs to a
// few interesting spots and takes screenshots. Checks the page makes no errors and that something was actually drawn.
// Usage: node tests/three.mjs   (writes tests/shots/3d_*.png)
import { chromium } from 'playwright-core';
import { spawn } from 'child_process';
import fs from 'fs';
fs.mkdirSync('tests/shots', { recursive: true });
const port = 4198;
const srv = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 3500));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); p.on('response', (r) => { if (r.status() === 404) errs.push('404 ' + r.url()); });
await p.goto(`http://localhost:${port}/`); await p.waitForTimeout(1500);
let fail = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fail++; };
for (const [lvl, kind, beatsIn, cam, name] of [[1, null, 0, 'chase', 'l1_start'], [1, 'ship', 6, 'chase', 'l1_ship'], [1, 'ship', 6, 'drone', 'l1_ship_drone'], [2, 'wave', 6, 'chase', 'l2_wave'], [3, 'grav', 5, 'chase', 'l3_grav']]) {
  const info = await p.evaluate(async ({ lvl, kind, beatsIn, cam }) => {
    const { G, start } = __fd3;
    await start(lvl);
    G.playing = false; G.cam = cam; G.camPos.set(0, 0, 0);
    const { proveCompletable } = await import('/src/game/bot.js');
    const { step, DT } = await import('/src/game/sim.js');
    const lv = G.level, pl = G.p;
    let targetX = 0;
    if (kind) { const z = lv.sections.find((q) => q.kind === kind); targetX = z.x0 + beatsIn * lv.tpb; }
    if (targetX > 0) {
      const pr = proveCompletable(lv, { margin: 0, pressEvery: 1 });
      if (!pr.ok) return { err: 'not proven' };
      const at = new Map(); for (const e of pr.inputs) { if (!at.has(e.tick)) at.set(e.tick, []); at.get(e.tick).push(e.ev); }
      const lv2 = Object.assign({}, lv, { coins: [], checkpoints: [] });
      pl.coinsUsed = new Uint8Array(lv.coins.length).fill(1);
      for (let tick = 0; tick < 60 * 600 && pl.x < targetX && !pl.dead; tick++) {
        let press = false;
        for (const ev of at.get(tick) || []) { if (ev === 'p') { press = true; pl.hold = false; } else if (ev === 'd') { press = true; pl.hold = true; } else if (ev === 'u') pl.hold = false; }
        for (let i = 0; i < 2; i++) step(lv2, pl, DT, press && i === 0);
      }
    }
    G.prev = null; G.clock.reset(pl.t);
    return { x: +pl.x.toFixed(1), y: +pl.y.toFixed(2), mode: pl.mode, grav: pl.grav, dead: pl.dead };
  }, { lvl, kind, beatsIn, cam });
  await p.waitForTimeout(600);
  const calls = await p.evaluate(() => __fd3.renderer.info.render.calls);
  await p.screenshot({ path: `tests/shots/3d_${name}.png` });
  check(!info.err && !info.dead && calls > 5, `${name}: ${JSON.stringify(info)} draw calls ${calls}`);
}
check(errs.length === 0, 'no console errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
await b.close(); srv.kill();
process.exit(fail ? 1 : 0);
