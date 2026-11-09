// Browser check: MP3 decode alignment vs the beat map, audio/sim lock while playing, no console errors.
import { chromium } from 'playwright-core';
import { spawn } from 'child_process';
const srv = spawn('npx', ['vite', 'preview', '--port', '4193', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
await p.goto('http://localhost:4193/'); await p.waitForTimeout(1500);
await p.mouse.click(640, 360); await p.waitForTimeout(300);

// 1. decode alignment: slide the beat map's kick grid against the decoded audio's low-band energy
const align = await p.evaluate(async () => {
  const { audio } = __fd; audio.unlock();
  const out = {};
  for (const id of ['drop', 'boss', 'intense']) {
    await audio.loadSong(id);
    const buf = audio.songBuf[id], sr = buf.sampleRate, y = buf.getChannelData(0);
    // low-pass (one pole ~150 Hz) then rectify, 1 ms bins
    const a = Math.exp(-2 * Math.PI * 150 / sr); let s = 0; const bins = Math.floor(buf.duration * 1000); const env = new Float32Array(bins);
    for (let i = 0; i < y.length; i++) { s = a * s + (1 - a) * y[i]; const k = Math.floor(i / sr * 1000); if (k < bins) env[k] += Math.abs(s); }
    out[id] = { env: Array.from(env.slice(0, 60000)), dur: buf.duration };
    audio.releaseSongsExcept(null);
  }
  return out;
});
import fs from 'fs';
const maps = await import('../src/audio/music.js');
for (const id of ['drop', 'boss', 'intense']) {
  const m = maps.getBeatMap(id), env = align[id].env;
  // strong low hits in the first 55 s
  const hits = []; for (let s = 0; s < m.low.length && m.slotTime(s) < 55; s++) if (m.lowAt(s) >= 0.8) hits.push(m.slotTime(s));
  const offs = [];
  for (const t of hits) { const k0 = Math.round(t * 1000); let bi = 0, bv = -1; for (let d = -40; d <= 160; d++) { const v = env[k0 + d] || 0; if (v > bv) { bv = v; bi = d; } } let on = bi; while (on > -40 && (env[k0 + on - 1] || 0) > 0.25 * bv) on--; offs.push(on); }
  offs.sort((x, y) => x - y);
  console.log(`${id}: ${hits.length} strong kicks; the bass ONSET (25% of peak) comes ${offs[offs.length >> 1]} ms after the map's slot (median; q1 ${offs[offs.length >> 2]}, q3 ${offs[(offs.length * 3) >> 2]}). Includes ~10 ms of filter lag + the kick's own attack.`);
}

// 2. play level 1 and compare the audio clock to the sim clock
await p.evaluate(() => __fd.app.startLevel(3));
await p.waitForTimeout(6500);
const lock = [];
for (let i = 0; i < 6; i++) {
  lock.push(await p.evaluate(() => { const { app, audio } = __fd; return { mode: audio.mode, state: document.body.dataset.state, sim: +app.run.p.t.toFixed(3), song: +audio.songTime().toFixed(3) }; }));
  await p.waitForTimeout(800);
}
console.log(lock.map((l) => `${l.state}/${l.mode} sim ${l.sim} song ${l.song} diff ${(l.sim - l.song).toFixed(3)}`).join('\n'));
await p.screenshot({ path: 'tests/shots/music_play.png' });
console.log(errs.join('\n') || 'no console errors');
await b.close(); srv.kill();
