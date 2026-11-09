// v3 through the REAL app in a real browser: play both routes of a level start to finish, watch the screen flip at portals,
// the double-jump timer in the HUD, and a real double jump through the app's own jump input.
import { chromium } from 'playwright-core';
import { spawn } from 'child_process';
const srv = spawn('npx', ['vite', 'preview', '--port', '4181', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('crash', () => console.log('PAGE CRASH')); p.on('console', (m) => { if (m.type() === 'error' && !/GPU stall|proxy|ERR_/.test(m.text())) console.log('console.error', m.text().slice(0, 300)); });
const R = []; const ok = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, c ? '' : d].join(' | '));
await p.goto('http://localhost:4181/'); await p.waitForTimeout(1200);
await p.fill('#nm', 'V3Tester'); await p.click('[data-act=start]'); await p.waitForTimeout(400);
await p.click('[data-act=done]'); await p.waitForTimeout(500);

async function playRoute(levelId, route) {
  await p.evaluate((id) => { __fd.app.sd.lastLevel = id; }, levelId);
  await p.click('[data-act=play]'); await p.waitForTimeout(300);
  await p.evaluate(() => { __fd.app.hold = true; });
  const out = await p.evaluate(async ({ id, route }) => {
    const { app, proveCompletable, getLevel, routeLevel, GROUND_MAX_Y } = __fd;
    const lv = getLevel(id);
    const sub = route === 'ground' ? routeLevel(lv, ['a']) : routeLevel(lv, ['g']);
    const pr = proveCompletable(sub, { margin: 0, pressEvery: 1, maxY: route === 'ground' ? GROUND_MAX_Y : undefined });
    const jumps = pr.jumps.slice();
    const cv = app.game.canvas;
    const log = { proof: pr.ok, flips: new Set(), djSeen: false, minTransformSeen: false, coins: 0, maxOrientAtMark: 0 };
    let guard = 0, next = 0;
    while (guard++ < 600000) {
      const st = app.fsm.state;
      if (st === 'LEVEL_COMPLETE' || st === 'GAME_OVER') break;
      if (st === 'TRIVIA') { const bt = document.querySelector('[data-act=ok]'); if (bt) { log.coins++; bt.click(); continue; } }
      if (st === 'PLAYING') {
        const r = app.run;
        while (next < jumps.length && r.p.t + 1e-9 >= jumps[next] / 60) { app.jump(); next++; }
        if (/180deg/.test(cv.style.transform)) log.flips.add(cv.style.transform);
        if (document.querySelector('#dj.on')) log.djSeen = true;
      }
      app.tick(1 / 120);
      await 0;
    }
    return { ...log, flips: [...log.flips], final: app.fsm.state, progress: app.run.progress, lives: app.run.lives, dead: app.run.p.deathReason, orientEnd: app.run.p.orient, portals: lv.portals.filter((q) => q.set).length };
  }, { id: levelId, route });
  return out;
}

for (const [id, route] of [[1, 'ground'], [1, 'sky'], [2, 'sky']]) {
  const o = await playRoute(id, route);
  console.log(`L${id} ${route}:`, JSON.stringify(o));
  ok(`L${id} ${route} route completed through the real app`, o.final === 'LEVEL_COMPLETE' && o.progress === 100, JSON.stringify(o));
  ok(`L${id} ${route}: screen flipped at portals (transform seen) and normal at the end`, o.flips.length > 0 && o.orientEnd === 0, JSON.stringify(o.flips));
  ok(`L${id} ${route}: double-jump HUD timer appeared after an orb`, o.djSeen);
  await p.evaluate(() => { __fd.app.hold = false; }); await p.click('[data-act=menu]'); await p.waitForTimeout(700);
}

// real double jump through the app's own input
await p.evaluate(() => { __fd.app.sd.lastLevel = 1; });
await p.click('[data-act=play]'); await p.waitForTimeout(300);
const dj = await p.evaluate(() => {
  const a = __fd.app; a.hold = true; let g = 0; while (a.fsm.state !== 'PLAYING' && g++ < 3000) a.tick(1 / 120);
  const r = a.run; r.p.coinsUsed.fill(1);
  const apex = (power) => {
    r.p.x = 3; r.p.y = 0; r.p.vy = 0; r.p.t = 0.3; r.p.grounded = true; r.p.standingOn = null; r.p.djUsed = false; r.p.djUntil = power ? 100 : -1; r.p.invUntil = 1e9;
    for (let i = 0; i < 30; i++) a.tick(1 / 120);
    let top = 0; a.jump();
    for (let i = 0; i < 240; i++) { if (i === 30 || i === 70) a.jump(); a.tick(1 / 120); top = Math.max(top, r.p.y); }
    return top;
  };
  return { plain: apex(false), boosted: apex(true) };
});
console.log('double jump apex', JSON.stringify(dj));
ok('app jump input: no power-up -> 2.4 apex; with power-up (tapped at the apex) -> ~4.8 apex', dj.plain > 2.2 && dj.plain < 2.6 && dj.boosted > 4.4 && dj.boosted < 5.1, JSON.stringify(dj));
console.log(R.join('\n'));
console.log(errs.join('\n') || 'no page errors');
await b.close(); srv.kill();
