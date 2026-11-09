// Renders each track offline and measures it, so the soundtrack is checked by numbers rather than by assumption.
// Dubstep has two measurable fingerprints: the energy sits in the sub-bass, and the wobble bass gates the amplitude
// up and down several times a second instead of holding steady.
import { chromium } from 'playwright-core';
import { spawn } from 'child_process';

const srv = spawn('npx', ['vite', 'preview', '--port', '4192', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 900, height: 520 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:4192/'); await p.waitForTimeout(1200);

const res = await p.evaluate(async () => {
  const { audio } = __fd;
  const out = [];
  for (let track = 0; track < 3; track++) {
    const SR = 44100, SECS = 6;
    const oac = new OfflineAudioContext(1, SR * SECS, SR);
    // stand in for unlock(): build the same node graph on an offline context
    audio.ctx = oac;
    audio.master = oac.createGain(); audio.musicGain = oac.createGain(); audio.sfxGain = oac.createGain();
    audio.musicGain.connect(audio.master); audio.sfxGain.connect(audio.master);
    const comp = oac.createDynamicsCompressor();
    audio.master.connect(comp); comp.connect(oac.destination);
    const nb = oac.createBuffer(1, SR, SR), d = nb.getChannelData(0);
    for (let i = 0; i < SR; i++) d[i] = Math.random() * 2 - 1;
    audio.noiseBuf = nb;
    const CN = 1024; audio.driveCurve = new Float32Array(CN);
    for (let i = 0; i < CN; i++) { const x = (i * 2) / CN - 1, k2 = 9; audio.driveCurve[i] = ((1 + k2) * x) / (1 + k2 * Math.abs(x)); }
    audio.bus = oac.createGain(); audio.bus.connect(audio.musicGain);
    audio.bpm = 140; audio.stepDur = 60 / 140 / 4;

    const steps = Math.floor((SECS - 0.2) / audio.stepDur);
    for (let st = 0; st < steps; st++) audio._step(track, st + 16 * 5, 0.05 + st * audio.stepDur); // start at bar 5 = the drop
    const buf = await oac.startRendering();
    const x = buf.getChannelData(0);

    let sum = 0, peak = 0;
    for (let i = 0; i < x.length; i++) { sum += x[i] * x[i]; if (Math.abs(x[i]) > peak) peak = Math.abs(x[i]); }
    const rms = Math.sqrt(sum / x.length);
    // one-pole low-pass at 120 Hz isolates the sub
    const a = Math.exp((-2 * Math.PI * 120) / SR);
    let lp = 0, lsum = 0;
    for (let i = 0; i < x.length; i++) { lp = (1 - a) * x[i] + a * lp; lsum += lp * lp; }
    const lowRms = Math.sqrt(lsum / x.length);
    // Amplitude envelope. The follower must smooth BOTH directions: an instant-attack follower re-peaks on every
    // bass cycle and ends up measuring the sub's own pitch instead of the wobble. Three cascaded one-poles at 9 Hz
    // leave the 2-10 Hz wobble intact while removing the 45-75 Hz carrier.
    const ea = Math.exp((-2 * Math.PI * 9) / SR);
    const env = []; let e1 = 0, e2 = 0, e3 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = Math.abs(x[i]);
      e1 = (1 - ea) * v + ea * e1; e2 = (1 - ea) * e1 + ea * e2; e3 = (1 - ea) * e2 + ea * e3;
      if (i % 64 === 0) env.push(e3);
    }
    const mid = env.slice(Math.floor(env.length * 0.15), Math.floor(env.length * 0.9));
    const m = mid.reduce((s, v) => s + v, 0) / mid.length;
    const sd = Math.sqrt(mid.reduce((s, v) => s + (v - m) * (v - m), 0) / mid.length);
    // count envelope swings per second = the wobble rate you actually hear
    let crossings = 0;
    for (let i = 1; i < mid.length; i++) if ((mid[i - 1] - m) * (mid[i] - m) < 0) crossings++;
    const envHz = crossings / 2 / ((mid.length * 64) / SR);
    out.push({ track, rms: +rms.toFixed(4), peak: +peak.toFixed(3), subShare: +(lowRms / rms).toFixed(3), wobbleCV: +(sd / m).toFixed(3), envHz: +envHz.toFixed(1) });
  }
  audio.ctx = null; audio.bus = null;
  return out;
});

const R = [];
const ok = (n, c, d = '') => R.push([c ? 'PASS' : 'FAIL', n, c ? '' : d].join(' | '));
const names = ['Radiant Skies (melodic)', 'Desert Beat (heavy wobble)', 'Aurora Drive (riddim)'];
for (const r of res) {
  console.log(names[r.track], JSON.stringify(r));
  ok(`${names[r.track]}: produces audio and does not clip`, r.rms > 0.01 && r.peak > 0.05 && r.peak <= 1.0, JSON.stringify(r));
  ok(`${names[r.track]}: energy is dominated by sub-bass (dubstep weight)`, r.subShare > 0.45, `subShare ${r.subShare}`);
  ok(`${names[r.track]}: bass visibly wobbles rather than holding steady`, r.wobbleCV > 0.15, `cv ${r.wobbleCV}`);
  ok(`${names[r.track]}: amplitude gates at a musical half-time rate (1-14 Hz), not a steady drone`, r.envHz >= 1 && r.envHz <= 14, `envHz ${r.envHz}`);
}
console.log(R.join('\n'));
console.log(errs.join('\n') || 'no page errors');
await b.close(); srv.kill();
process.exit(R.some((r) => r.startsWith('FAIL')) ? 1 : 0);
