import { chromium } from 'playwright-core';
import { spawn } from 'child_process';
const srv = spawn('npx', ['vite', 'preview', '--port', '4178', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--ignore-gpu-blocklist','--no-sandbox'] });
const W = Number(process.argv[2] || 1280), H = Number(process.argv[3] || 720), tag = process.argv[4] || 'd';
const p = await b.newPage({ viewport: { width: W, height: H } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:4178/'); await p.waitForTimeout(1200);
await p.fill('#nm', 'Player1'); await p.click('[data-act=start]'); await p.waitForTimeout(500);
await p.screenshot({ path: `tests/shots/v2_${tag}_howto.png` });
await p.click('[data-act=done]'); await p.waitForTimeout(600);
await p.evaluate(() => { const { bank } = __fd; for (let i = 1; i <= 4; i++) bank.add({ q: 'What book of the Bible describes the creation of the world? (TEST ' + i + ')', correct: 'Genesis', wrong: ['Exodus', 'Leviticus', 'Numbers'], difficulty: 'easy', levels: [], ref: 'Genesis 1:1', expl: 'Genesis is the first book of the Bible and describes the creation of the world.' }); });
const shot = async (n) => { await p.waitForTimeout(700); await p.screenshot({ path: `tests/shots/v2_${tag}_${n}.png` }); };
await shot('main');
for (const [act, n] of [['levels','levels'],['music','music'],['bg','bg'],['skins','skins'],['settings','settings'],['leaderboard','lb']]) {
  await p.click(`[data-act=${act}]`); await shot(n); await p.click('[data-act=back]'); await p.waitForTimeout(450);
}
for (const bg of [0, 1, 2]) {
  await p.evaluate((bg) => { __fd.app.sd.bg = bg; __fd.app.sd.lastLevel = bg + 1; }, bg);
  await p.click('[data-act=play]'); await p.waitForTimeout(200);
  await p.evaluate(() => { const a = __fd.app; a.hold = true; let g = 0; while (a.fsm.state !== 'PLAYING' && g++ < 2000) a.tick(1 / 120); const lv = a.run.level; a.run.p.x = lv.coins[0].x - 14; a.run.p.y = 0; a.run.p.t = 0; for (let i = 0; i < 200; i++) a.tick(1 / 120); });
  await shot('game' + (bg + 1));
  if (bg === 0) {
    await p.evaluate(() => { const a = __fd.app; let g = 0; a.run.p.x = a.run.level.coins[0].x - 2; while (a.fsm.state !== 'TRIVIA' && g++ < 5000) a.tick(1 / 120); for (let i = 0; i < 90; i++) a.tick(1 / 120); });
    await shot('trivia');
    const c = await p.evaluate(() => __fd.app.run.trivia.question.correctIdx);
    await p.locator('.trivia .ans').nth(c).click(); await p.locator('[data-act=submit]').click(); await shot('trivia_ok');
  }
  await p.evaluate(() => { __fd.app.hold = false; __fd.app.quitToMenu(); }); await p.waitForTimeout(700);
}
console.log(errs.join('\n') || 'no page errors');
await b.close(); srv.kill();
