import { chromium, devices } from 'playwright-core';
import { spawn } from 'child_process';
const srv = spawn('npx', ['vite', 'preview', '--port', '4177', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--ignore-gpu-blocklist','--no-sandbox'] });
const R = []; const ok = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, c ? '' : d].join(' | '));
const errs = [];
for (const [name, vp, dpr] of [['phone-landscape', { width: 844, height: 390 }, 3], ['phone-portrait', { width: 390, height: 844 }, 3], ['tablet', { width: 1024, height: 768 }, 2], ['ultrawide', { width: 1920, height: 800 }, 1]]) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: dpr, hasTouch: true, isMobile: name.startsWith('phone') });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(name + ': ' + e.message));
  await p.goto('http://localhost:4177/'); await p.waitForTimeout(1200);
  const portrait = vp.height > vp.width;
  if (portrait) {
    const vis = await p.evaluate(() => getComputedStyle(document.getElementById('rotate')).display !== 'none');
    ok(name + ': shows rotate-device notice', vis);
    await p.screenshot({ path: `tests/shots/${name}.png` });
    await ctx.close(); continue;
  }
  await p.fill('#nm', 'Mob'); await p.tap('[data-act=start]'); await p.waitForTimeout(400); await p.tap('[data-act=done]'); await p.waitForTimeout(400);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1);
  ok(name + ': main menu fits without page scroll', !overflow);
  await p.screenshot({ path: `tests/shots/${name}_menu.png` });
  await p.tap('[data-act=play]'); await p.waitForTimeout(200);
  await p.evaluate(() => { const a = __fd.app; a.hold = true; let g = 0; while (a.fsm.state !== 'PLAYING' && g++ < 2000) a.tick(1 / 120); });
  const y0 = await p.evaluate(() => { for (let i = 0; i < 20; i++) __fd.app.tick(1 / 120); return __fd.app.run.p.y; });
  await p.touchscreen.tap(Math.round(vp.width / 2), Math.round(vp.height / 2));
  const y1 = await p.evaluate(() => { for (let i = 0; i < 20; i++) __fd.app.tick(1 / 120); return __fd.app.run.p.y; });
  ok(name + ': screen tap makes player jump', y1 > y0 + 0.5, `${y0} -> ${y1}`);
  const px = await p.evaluate(() => { const c = document.querySelector('#stage canvas'); return { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight, dpr: devicePixelRatio }; });
  ok(name + `: canvas drawn sharp (${px.w}x${px.h} px for ${px.cw}x${px.ch} css @${px.dpr}x)`, px.w >= px.cw * Math.min(px.dpr, 1) - 2, JSON.stringify(px));
  await p.screenshot({ path: `tests/shots/${name}_game.png` });
  await ctx.close();
}
console.log(R.join('\n')); console.log(errs.join('\n') || 'no page errors');
await b.close(); srv.kill();
