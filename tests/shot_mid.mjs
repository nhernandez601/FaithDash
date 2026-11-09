import { chromium } from 'playwright-core';
import { spawn } from 'child_process';
const srv = spawn('npx', ['vite', 'preview', '--port', '4194', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto('http://localhost:4194/'); await p.waitForTimeout(1500); await p.mouse.click(640, 360);
await p.evaluate(() => __fd.app.startLevel(1));
await p.waitForTimeout(9000);
// keep the runner alive for the shot: make it invincible
await p.evaluate(() => { __fd.app.run.p.invUntil = 1e9; __fd.app.run.lives = 99; });
for (let i = 0; i < 80; i++) { const t = await p.evaluate(() => __fd.app.run.p.t); if (t > 12.0) break; await p.waitForTimeout(250); }
console.log(await p.evaluate(() => ({ t: __fd.app.run.p.t.toFixed(2), heat: __fd.app.mu.heat.toFixed(2) })));
await p.screenshot({ path: 'tests/shots/music_drop.png' });
console.log(errs.join('\n') || 'no console errors');
await b.close(); srv.kill();
