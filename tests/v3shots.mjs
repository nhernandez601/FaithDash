// Screenshots of the v3 features: stairs/fork, sky route, portals, orbs, roll animation, flips.
import { chromium } from 'playwright-core';
import { spawn } from 'child_process';
const srv = spawn('npx', ['vite', 'preview', '--port', '4179', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const W = Number(process.argv[2] || 1280), H = Number(process.argv[3] || 720);
const p = await b.newPage({ viewport: { width: W, height: H } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:4179/'); await p.waitForTimeout(1200);
await p.fill('#nm', 'Player1'); await p.click('[data-act=start]'); await p.waitForTimeout(500);
await p.click('[data-act=done]'); await p.waitForTimeout(600);
const shot = async (n) => { await p.waitForTimeout(500); await p.screenshot({ path: `tests/shots/v3_${n}.png` }); };
const lvId = Number(process.argv[4] || 2);
await p.evaluate((id) => { __fd.app.sd.lastLevel = id; __fd.app.sd.bg = id - 1; }, lvId);
await p.click('[data-act=play]'); await p.waitForTimeout(200);
// helper: place player at x on the ground and run frames
const go = (x, y, frames = 30) => p.evaluate(({ x, y, frames }) => {
  const a = __fd.app; a.hold = true; let g = 0; while (a.fsm.state !== 'PLAYING' && g++ < 3000) a.tick(1 / 120);
  const r = a.run; r.p.x = x; r.p.y = y; r.p.t = x / r.level.speed; r.p.invUntil = 1e9; r.p.vy = 0; r.p.coinsUsed.fill(1);
  for (let i = 0; i < frames; i++) a.tick(1 / 120);
}, { x, y, frames });
const info = await p.evaluate(() => {
  const lv = __fd.app.level || null; return lv;
});
const lvInfo = await p.evaluate(() => {
  const a = __fd.app; let g = 0; a.hold = true; while (a.fsm.state !== 'PLAYING' && g++ < 3000) a.tick(1 / 120);
  const lv = a.run.level;
  const e = lv.solids.filter((s) => s.route === 'e').sort((u, v) => u.x - v.x);
  return { orbs: lv.orbs.slice(0, 3), e0: e[0] && e[0].x, portals: lv.portals.filter((q) => q.set).slice(0, 4).map((q) => ({ x: q.x, set: q.set, y0: q.y0 })) };
});
console.log(JSON.stringify(lvInfo));
await go(lvInfo.orbs[0].x - 6, 0); await shot('orb_approach');
await go(lvInfo.e0 - 8, 0); await shot('stairs');
await go(lvInfo.e0 + 14, 7.4); await shot('sky_route');
// roll in air
await p.evaluate(() => { const a = __fd.app; a.run.press(); for (let i = 0; i < 40; i++) a.tick(1 / 120); });
await shot('roll_mid');
for (const q of lvInfo.portals) {
  await go(q.x - 3.5, q.y0 > 0 ? 7 : 0, 20);
  await shot('portal_' + q.set + '_' + Math.round(q.x));
  await p.evaluate(() => { const a = __fd.app; for (let i = 0; i < 120; i++) a.tick(1 / 120); });
  await p.waitForTimeout(800);
  await shot('portal_after_' + q.set + '_' + Math.round(q.x));
}
console.log(errs.join('\n') || 'no page errors');
await b.close(); srv.kill();
