import { chromium } from 'playwright-core';
import { spawn } from 'child_process';
const srv = spawn('npx', ['vite', 'preview', '--port', '4176', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--ignore-gpu-blocklist','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const R = []; const ok = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, c ? '' : d].join(' | '));
await p.goto('http://localhost:4176/'); await p.waitForTimeout(1200);
await p.fill('#nm', 'Tester'); await p.click('[data-act=start]'); await p.waitForTimeout(400); await p.click('[data-act=done]'); await p.waitForTimeout(400);
// placeholder test questions (NOT real content)
const nAdded = await p.evaluate(() => {
  const { bank } = __fd; let n = 0;
  for (let i = 1; i <= 8; i++) if (bank.add({ q: `TEST QUESTION ${i}`, correct: `T${i} right`, wrong: [`T${i} w1`, `T${i} w2`, `T${i} w3`], difficulty: 'easy', levels: [], ref: '', expl: `Test explanation ${i}` }).ok) n++;
  return n;
});
ok('bank accepts 8 test questions', nAdded === 8, nAdded);
const st = () => p.evaluate(() => __fd.app.fsm.state);
const stepTo = (target, max = 60000) => p.evaluate(([target, max]) => { const a = __fd.app; a.hold = true; let g = 0; while (a.fsm.state !== target && g++ < max) a.tick(1 / 120); return a.fsm.state; }, [target, max]);
const tickN = (n) => p.evaluate((n) => { for (let i = 0; i < n; i++) __fd.app.tick(1 / 120); }, n);
// ---------- start level 1; player never jumps -> will die; we test coin first by invincible-free path: use run teleport
await p.click('[data-act=play]'); await p.waitForTimeout(200);
// teleport right before the first coin on safe ground (coins sit in hazard-free zones)
const info = await p.evaluate(async () => {
  const a = __fd.app; a.hold = true; let g = 0; while (a.fsm.state !== 'PLAYING' && g++ < 2000) a.tick(1 / 120);
  const c = a.run.level.coins[0]; a.run.p.x = c.x - 3; a.run.p.y = 0; a.run.p.vy = 0; a.run.p.t = 0; return { cx: c.x, st: a.fsm.state };
});
ok('reached PLAYING after countdown', info.st === 'PLAYING', info.st);
ok('coin pauses game (TRIVIA)', (await stepTo('TRIVIA')) === 'TRIVIA');
const frozen = await p.evaluate(() => { const a = __fd.app, x = a.run.p.x, t = a.run.p.t; for (let i = 0; i < 300; i++) a.tick(1 / 120); return a.run.p.x === x && a.run.p.t === t; });
ok('sim frozen while trivia is open (no movement, timer stopped)', frozen);
ok('overlay visible with 4 answers', (await p.locator('.trivia .ans').count()) === 4, await p.locator('.trivia .ans').count());
ok('Submit disabled before selecting', await p.locator('[data-act=submit]').isDisabled());
await p.locator('.trivia .ans').nth(0).click();
ok('Submit enabled after selecting', !(await p.locator('[data-act=submit]').isDisabled()));
await p.locator('.trivia .ans').nth(2).click(); // change mind before submit -> allowed
const sel = await p.evaluate(() => __fd.app.run.trivia.selected);
ok('selection can change before submit', sel === 2, sel);
const q = await p.evaluate(() => { const t = __fd.app.run.trivia.question; return { c: t.correctIdx, n: t.options.length, text: t.text }; });
const livesBefore = await p.evaluate(() => __fd.app.run.lives);
// choose the correct one
await p.locator('.trivia .ans').nth(q.c).click(); await p.locator('[data-act=submit]').click(); await p.waitForTimeout(100);
const res = await p.evaluate(() => ({ lives: __fd.app.run.lives, ok: __fd.app.run.correct, state: __fd.app.fsm.state }));
ok('correct answer: lives stay capped at 3', res.lives === 3 && res.ok === 1, JSON.stringify(res));
ok('result shown (right highlighted)', (await p.locator('.trivia .ans.right').count()) === 1);
const dis = await p.locator('.trivia .ans').evaluateAll((e) => e.every((x) => x.disabled));
ok('answers locked after submit (irreversible)', dis);
await p.locator('.trivia .ans').nth((q.c + 1) % 4).click({ force: true }).catch(() => {});
ok('cannot change answer after submit', (await p.evaluate(() => __fd.app.run.correct)) === 1 && (await p.evaluate(() => __fd.app.run.incorrect)) === 0);
await p.click('[data-act=cont]'); await p.waitForTimeout(100);
ok('back to PLAYING after Continue', (await st()) === 'PLAYING', await st());
const inv = await p.evaluate(() => { const r = __fd.app.run; return { on: r.invActive, left: r.p.invUntil - r.p.t }; });
ok('2s shield active after answer', inv.on && Math.abs(inv.left - 2) < 0.02, JSON.stringify(inv));
const invEnd = await p.evaluate(() => { const a = __fd.app, r = a.run; let g = 0; while (r.invActive && g++ < 5000 && a.fsm.is('PLAYING')) a.tick(1 / 120); return { t: +(r.p.invUntil - r.p.t).toFixed(3), state: a.fsm.state, g }; });
ok('shield lasts ~2s of play then ends', invEnd.g >= 235 && invEnd.g <= 245, JSON.stringify(invEnd));
// ---------- wrong answer: lose a life, +no repeat
await p.evaluate(() => { const a = __fd.app; a.run.p.x = a.run.level.coins[1].x - 3; a.run.p.y = 0; a.run.p.vy = 0; });
await stepTo('TRIVIA'); await tickN(80);
const q2 = await p.evaluate(() => { const t = __fd.app.run.trivia.question; return { c: t.correctIdx, text: t.text }; });
ok('second question differs from first (no repeat)', q2.text !== q.text, q2.text);
await p.locator('.trivia .ans').nth((q2.c + 1) % 4).click(); await p.locator('[data-act=submit]').click(); await p.waitForTimeout(100);
const w = await p.evaluate(() => ({ lives: __fd.app.run.lives, bad: __fd.app.run.incorrect }));
ok('wrong answer costs one life', w.lives === 2 && w.bad === 1, JSON.stringify(w));
ok('correct answer revealed after wrong pick', (await p.locator('.trivia .ans.right').count()) === 1 && (await p.locator('.trivia .ans.wrong').count()) === 1);
await p.screenshot({ path: 'tests/shots/trivia_wrong.png' });
await p.click('[data-act=cont]'); await p.waitForTimeout(100);
// ---------- coin while shield? coin still triggers during invincibility
await p.evaluate(() => { const a = __fd.app, r = a.run; r.p.x = r.level.coins[2].x - 1; r.p.y = 0; r.p.vy = 0; });
ok('coin still triggers during shield', (await stepTo('TRIVIA')) === 'TRIVIA');
await tickN(80);
// answer wrong twice more -> game over (lives 2 -> 1 -> 0)
const q3 = await p.evaluate(() => __fd.app.run.trivia.question.correctIdx);
await p.locator('.trivia .ans').nth((q3 + 1) % 4).click(); await p.locator('[data-act=submit]').click(); await p.waitForTimeout(100);
await p.click('[data-act=cont]'); await p.waitForTimeout(100);
await p.evaluate(() => { const a = __fd.app, r = a.run; r.p.x = r.level.coins[3].x - 1; r.p.y = 0; r.p.vy = 0; });
await stepTo('TRIVIA'); await tickN(80);
const q4 = await p.evaluate(() => __fd.app.run.trivia.question.correctIdx);
await p.locator('.trivia .ans').nth((q4 + 1) % 4).click(); await p.locator('[data-act=submit]').click(); await p.waitForTimeout(100);
ok('lives hit 0 shows "See results"', (await p.locator('[data-act=cont]').innerText()).includes('results'));
await p.click('[data-act=cont]'); await tickN(200); await p.waitForTimeout(200);
ok('0 lives -> GAME_OVER', (await st()) === 'GAME_OVER', await st());
await p.screenshot({ path: 'tests/shots/gameover.png' });
// ---------- score submit with no backend
await p.click('[data-act=submit]'); await p.waitForTimeout(300);
await p.click('#cf'); await p.waitForTimeout(600);
const sub = await p.locator('#subStatus').innerText();
ok('submit w/o backend says PENDING and not global', /PENDING/.test(sub) && /NOT global/.test(sub), sub);
await p.screenshot({ path: 'tests/shots/submit_pending.png' });
// leaderboard from results
await p.click('[data-act=lb]'); await p.waitForTimeout(500);
const lbTxt = await p.locator('#lbBody').innerText();
ok('leaderboard shows "not connected", no fake rows', /not connected/i.test(lbTxt) && (await p.locator('table.lb').count()) === 0, lbTxt.slice(0, 80));
await p.screenshot({ path: 'tests/shots/lb_not_connected.png' });
await p.click('[data-act=back]'); await p.waitForTimeout(400);
ok('back from leaderboard returns to results', (await st()) === 'GAME_OVER', await st());
// ---------- restart then pause/resume
await p.click('[data-act=restart]'); await p.waitForTimeout(300);
await stepTo('PLAYING'); await tickN(120);
const t1 = await p.evaluate(() => __fd.app.run.p.t);
await p.evaluate(() => __fd.app.pause('user')); await p.waitForTimeout(300);
ok('pause menu visible', (await p.locator('[data-act=resume]').count()) === 1 && (await st()) === 'PAUSED');
await tickN(300);
ok('sim frozen while paused', (await p.evaluate(() => __fd.app.run.p.t)) === t1);
await p.click('[data-act=resume]'); await p.waitForTimeout(200);
ok('resume goes through countdown', (await st()) === 'COUNTDOWN', await st());
await stepTo('PLAYING');
ok('then back to PLAYING', (await st()) === 'PLAYING');
// ---------- skin unlock rule
const unl = await p.evaluate(() => { const a = __fd.app; a.sd.totals.correct = 3; a.checkUnlocks(); const u3 = a.sd.unlocked.length; a.sd.totals.correct = 10; a.checkUnlocks(); return [u3, a.sd.unlocked.length]; });
ok('skins unlock at 3 / 6 / 10 correct', unl[0] === 4 && unl[1] === 6, JSON.stringify(unl));
ok('FSM rejected no illegal transitions', (await p.evaluate(() => __fd.app.fsm.rejected)).length === 0, JSON.stringify(await p.evaluate(() => __fd.app.fsm.rejected)));
console.log(R.join('\n')); console.log(errs.join('\n') || 'no page errors');
await b.close(); srv.kill();
