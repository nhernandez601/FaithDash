// Screenshots of the v4 look: centred menu, background world structures, mid-flip portal.
import { chromium } from 'playwright-core';
import { spawn } from 'child_process';
const srv = spawn('npx', ['vite', 'preview', '--port', '4190', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const W = Number(process.argv[2] || 1280), H = Number(process.argv[3] || 720);
const p = await b.newPage({ viewport: { width: W, height: H } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:4190/'); await p.waitForTimeout(1300);
await p.fill('#nm', 'Player1'); await p.click('[data-act=start]'); await p.waitForTimeout(400);
await p.click('[data-act=done]'); await p.waitForTimeout(700);
await p.screenshot({ path: `tests/shots/v4_menu.png` });
for (const bg of [0, 1, 2]) {
  await p.evaluate((bg) => { __fd.app.sd.bg = bg; __fd.app.sd.lastLevel = bg + 1; }, bg);
  await p.click('[data-act=play]'); await p.waitForTimeout(250);
  const info = await p.evaluate(() => {
    const a = __fd.app; a.hold = true; let g = 0; while (a.fsm.state !== 'PLAYING' && g++ < 3000) a.tick(1 / 120);
    const r = a.run, lv = r.level; r.p.coinsUsed.fill(1); r.p.invUntil = 1e9;
    const e = lv.solids.filter((s) => s.route === 'e').sort((u, v) => u.x - v.x);
    const pz = lv.portals.filter((q) => q.set && q.y0 < 0);
    return { e0: e[0] && e[0].x, pz: pz[0] && pz[0].x, finish: lv.finishX };
  });
  const go = (x, y, frames = 40) => p.evaluate(({ x, y, frames }) => {
    const a = __fd.app, r = a.run;
    r.p.x = x; r.p.y = y; r.p.t = x / r.level.speed; r.p.vy = 0; r.p.invUntil = 1e9;
    for (let i = 0; i < frames; i++) a.tick(1 / 120);
  }, { x, y, frames });
  await go(info.finish * 0.33, 0);
  await p.waitForTimeout(500); await p.screenshot({ path: `tests/shots/v4_world${bg + 1}.png` });
  if (bg === 1 && info.pz) {
    // sit just before a flip portal, cross it, and catch the barrel roll half way through
    await go(info.pz - 6, 0, 40);
    await p.evaluate(() => { const a = __fd.app; for (let i = 0; i < 100; i++) a.tick(1 / 120); });
    await p.waitForTimeout(430);
    await p.screenshot({ path: `tests/shots/v4_flip_mid.png` });
    await p.waitForTimeout(800);
    await p.screenshot({ path: `tests/shots/v4_flip_done.png` });
  }
  await p.evaluate(() => { __fd.app.hold = false; __fd.app.quitToMenu(); }); await p.waitForTimeout(700);
}
console.log(errs.join('\n') || 'no page errors');
await b.close(); srv.kill();
