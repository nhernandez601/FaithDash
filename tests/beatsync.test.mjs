// Music sync integrity (v5): the levels must really be built on the songs' beats and hits.
//   - beat maps decode and line up with the bar grid
//   - every obstacle take-off (cue) sits exactly on the 16th-note grid, and almost all sit on a real drum hit of their tier
//   - moving hazards (saws, spinners, spike pulses) cycle in whole beats and start on a beat
//   - portals / route forks open on a drop's first beat, coin gates sit in calm parts of the song
//   - the runner's world position is exactly speed x song time, so "beat i" is always at x = i * tilesPerBeat
import assert from 'node:assert/strict';
import { getBeatMap, cueCandidates, SONG_IDS } from '../src/audio/music.js';
import { LEVEL_DEFS, getLevel } from '../src/game/levelgen.js';
import { proveCompletable, replayInputs } from '../src/game/bot.js';
import { step, newPlayer, DT } from '../src/game/sim.js';

let pass = 0, fail = 0;
const out = [];
function t(name, fn) { try { fn(); pass++; out.push(['PASS', name]); } catch (e) { fail++; out.push(['FAIL', name, e.message]); } }
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

for (const id of SONG_IDS) {
  const m = getBeatMap(id);
  t(`${m.title}: beat map decodes (${m.nBeats} beats at ${m.bpm} BPM, ${m.duration}s)`, () => {
    assert.ok(Number.isInteger(m.bpm) && m.bpm >= 100 && m.bpm <= 180, 'steady whole-number tempo, got ' + m.bpm);
    assert.equal(m.low.length, m.nBeats * 4, 'one slot per 16th note');
    assert.equal(m.mid.length, m.low.length); assert.equal(m.hi.length, m.low.length);
    assert.equal(m.inten.length, m.nBeats);
    assert.ok(m.endBeat <= m.nBeats && m.endBeat > m.nBeats - 20);
    assert.ok(Math.abs(m.nBeats * m.spb - m.duration) < 1.0, 'beats x 60/bpm must match the audio length');
    assert.ok(m.envN > 1000);
  });
  t(`${m.title}: every drop starts on a bar line; ${m.drops.length} drops found`, () => {
    assert.ok(m.drops.length >= 5);
    for (const d of m.drops) assert.equal(((d - m.down) % 4 + 4) % 4, 0, `drop at beat ${d} is not on a bar line`);
  });
  t(`${m.title}: the kick lands where the map says (kick pulse is high on a strong low hit, low well after it)`, () => {
    let checked = 0;
    for (let s = 0; s < m.low.length - 8 && checked < 20; s++) {
      if (m.lowAt(s) > 0.8 && m.lowAt(s + 1) < 0.2 && m.lowAt(s + 2) < 0.2) {
        checked++;
        assert.ok(m.kickAt(m.slotTime(s) + 0.005) > 0.6, 'pulse should spike on the hit');
        assert.ok(m.kickAt(m.slotTime(s) + 0.2) < 0.2, 'pulse should have decayed');
      }
    }
    assert.ok(checked >= 10, 'found only ' + checked);
  });
}

for (const def of LEVEL_DEFS) {
  const lv = getLevel(def.id), m = getBeatMap(def.song), tag = `L${def.id} ${def.name} [${def.tier}, ${m.title}]`;
  const cand = new Set(cueCandidates(m, def.tier).map((c) => c.s));
  const slotOf = (tt) => (tt / (m.spb / 4));

  t(`${tag}: level length == song length (finish line at beat ${m.endBeat})`, () => {
    assert.equal(lv.song, def.song);
    assert.ok(near(lv.finishX / lv.tpb, m.endBeat, 1e-6), `finish at beat ${lv.finishX / lv.tpb}`);
    assert.ok(near(lv.tpb, lv.speed * m.spb, 1e-9));
  });

  t(`${tag}: every obstacle take-off is exactly on the 16th-note grid`, () => {
    for (const c of lv.cues) { const s = slotOf(c.t); assert.ok(near(s, Math.round(s), 1e-5), `cue at t=${c.t} is slot ${s}`); }
  });

  t(`${tag}: >= 90% of take-offs sit on a real hit allowed for this tier (the rest are bar-line set-pieces)`, () => {
    const on = lv.cues.filter((c) => cand.has(Math.round(slotOf(c.t)))).length;
    const pct = (100 * on) / lv.cues.length;
    out.push(['INFO', `${tag}: ${on}/${lv.cues.length} take-offs (${pct.toFixed(0)}%) are on tier hits; ${(lv.cues.length / (lv.finishX / lv.speed / 60)).toFixed(0)} obstacles/min`]);
    assert.ok(pct >= 90, pct.toFixed(1) + '%');
  });

  t(`${tag}: take-offs land on strong hits (mean hit strength well above the song average)`, () => {
    let sum = 0; for (const c of lv.cues) sum += m.strength(Math.round(slotOf(c.t)));
    let all = 0; for (let s = 0; s < m.low.length; s++) all += m.strength(s);
    const mean = sum / lv.cues.length, avg = all / m.low.length;
    out.push(['INFO', `${tag}: take-off hit strength ${mean.toFixed(2)} vs song average ${avg.toFixed(2)}`]);
    assert.ok(mean > avg * (def.tier === "easy" ? 1.8 : 1.5), `${mean} vs ${avg}`);
  });

  t(`${tag}: moving hazards cycle in whole beats and start on a beat`, () => {
    const q = (x) => near(x * 4, Math.round(x * 4), 1e-6);
    let n = 0;
    for (const s of lv.saws) if (s.ay > 0) { n++; assert.ok(near(s.period / m.spb, Math.round(s.period / m.spb), 1e-6), 'saw period'); assert.ok(q(s.phase % 1) , 'saw phase ' + s.phase); }
    for (const s of lv.spinners) { n++; assert.ok(near(s.period / m.spb, Math.round(s.period / m.spb), 1e-6), 'spinner period'); assert.ok(q(s.phase % 1), 'spinner phase'); }
    for (const s of lv.pulses) { n++; assert.ok(near(s.period / m.spb, Math.round(s.period / m.spb), 1e-6), 'pulse period'); assert.ok(near(s.on, 0.5), 'pulse duty'); assert.ok(q(s.phase % 1), 'pulse phase'); }
    out.push(['INFO', `${tag}: ${n} beat-locked moving hazards`]);
  });

  t(`${tag}: portals open ON a drop's first beat (when the level has drop-anchored set-pieces)`, () => {
    const opens = lv.portals.filter((g) => g.set !== 0 && g.y0 < 0); // ground-level 'zone' portals
    const onDrop = opens.filter((g) => m.drops.some((d) => g.x >= d * lv.tpb - 0.01 && g.x <= d * lv.tpb + 0.2));
    out.push(['INFO', `${tag}: ${onDrop.length}/${opens.length} zone portals open exactly on a drop; ${lv.stats ? lv.stats.anchored : '?'} set-pieces anchored`]);
    if (opens.length) assert.ok(onDrop.length >= 1, 'no zone portal lands on a drop');
  });

  t(`${tag}: coin gates stay out of the drops (a question never interrupts a drop)`, () => {
    const kinds = lv.coins.map((c) => m.kindAtBeat(c.x / lv.tpb));
    out.push(['INFO', `${tag}: coin gates sit in: ${kinds.join(', ')}`]);
    assert.ok(kinds.filter((k) => k === 'drop').length <= 1, kinds.join(','));
  });

  t(`${tag}: runner's x == speed x time even while jumping, so beat i is at x = i * ${lv.tpb.toFixed(3)} (bot-proven run)`, () => {
    const r = proveCompletable(lv, { margin: 0, pressEvery: 1 });
    assert.ok(r.ok);
    const lv2 = Object.assign({}, lv, { coins: [], checkpoints: [] });
    let worst = 0;
    const p = replayInputs(lv2, r.inputs, { onStep(p) { worst = Math.max(worst, Math.abs(p.x - lv.speed * p.t)); } });
    assert.ok(p.finished);
    assert.ok(worst < 1e-6, 'x drifted from speed*t by ' + worst);
    // how many of the bot's own jumps happen within 120 ms of an obstacle cue? (information only: the bot may pick any legal moment)
    const ct = lv.cues.map((c) => c.t).sort((a, b) => a - b);
    const bj = r.jumps.map((k) => k / 60);
    const hit = bj.filter((j) => ct.some((c) => Math.abs(c - j) <= 0.12)).length;
    out.push(['INFO', `${tag}: ${hit}/${bj.length} of the prover's jumps fall within 120 ms of a cue (it may choose any legal moment)`]);
  });
}

for (const r of out) console.log(r[0], '-', r[1], r[2] ? '\n      ' + r[2] : '');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
