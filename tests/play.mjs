import { chromium } from 'playwright-core';
import { spawn } from 'child_process';
const srv = spawn('npx', ['vite', 'preview', '--port', '4174', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto('http://localhost:4174/');
await p.waitForTimeout(1500);
const R = [];
const ok = (n, c, d = '') => { R.push([c ? 'PASS' : 'FAIL', n, d]); };
const scr = () => p.evaluate(() => document.querySelector('#screens > *:not(.leaving)')?.dataset.screen);
// welcome -> name -> howto -> main
await p.fill('#nm', 'TestRunner'); await p.click('[data-act=start]'); await p.waitForTimeout(500);
ok('name saved, goes to how-to', (await scr()) === 'howto', await scr());
await p.click('[data-act=done]'); await p.waitForTimeout(500);
ok('main menu', (await scr()) === 'main');
for (const [act, name] of [['levels','levels'],['music','music'],['bg','background'],['skins','skins'],['stats','stats'],['settings','settings'],['leaderboard','leaderboard'],['howto','howto']]) {
  await p.click(`[data-act=${act}]`); await p.waitForTimeout(450);
  ok('open ' + name, (await scr()) === name, await scr());
  await p.screenshot({ path: `tests/shots/menu_${name}.png` });
  await p.click('[data-act=back]'); await p.waitForTimeout(450);
  ok('back from ' + name, (await scr()) === 'main', await scr());
}
// play level 1 with the solver
await p.click('[data-act=play]');
await p.waitForTimeout(300);
await p.evaluate(() => { __fd.app.hold = true; });
const out = await p.evaluate(async () => {
  const { app, proveCompletable, getLevel } = __fd;
  const lv = getLevel(1);
  const pr = proveCompletable(lv, { margin: 0, start: null, pressEvery: 1 });
  const jumps = pr.jumps.slice();
  const log = { proof: pr.ok, njumps: jumps.length, coins: 0, states: [] };
  let guard = 0, next = 0;
  while (guard++ < 400000) {
    const st = app.fsm.state;
    if (log.states[log.states.length - 1] !== st) log.states.push(st);
    if (st === 'LEVEL_COMPLETE' || st === 'GAME_OVER') break;
    if (st === 'TRIVIA') { const b = document.querySelector('[data-act=ok]'); if (b) { log.coins++; b.click(); continue; } }
    if (st === 'PLAYING') {
      const r = app.run;
      while (next < jumps.length && r.p.t + 1e-9 >= jumps[next] / 60) { app.jump(); next++; }
    }
    app.tick(1 / 120);
    await 0;
  }
  return { ...log, final: app.fsm.state, progress: app.run.progress, lives: app.run.lives, dead: app.run.p.deathReason };
});
console.log(JSON.stringify(out));
ok('level 1 completed through real game', out.final === 'LEVEL_COMPLETE', JSON.stringify(out));
await p.waitForTimeout(100);
await p.evaluate(() => { for (let i = 0; i < 200; i++) __fd.app.tick(1 / 60); });
await p.screenshot({ path: 'tests/shots/results.png' });
console.log(R.map((r) => r.join(' | ')).join('\n'));
console.log(errs.join('\n') || 'no page errors');
await b.close(); srv.kill();
