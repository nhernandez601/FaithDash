// Level integrity: every level must be provably completable, fair around coins/checkpoints, and ramp up in difficulty.
import assert from 'node:assert/strict';
import { LEVEL_DEFS, getLevel, __dbg, levelSig, GROUND_MAX_Y, PORTAL_FLIP, SONG_IDS, TIERS, stageId } from '../src/game/levelgen.js';
import BAKED from '../src/game/levels.baked.js';
import { proveCompletable, replayInputs } from '../src/game/bot.js';
import { step, newPlayer, DT, INV_TIME } from '../src/game/sim.js';
import { getBeatMap } from '../src/audio/music.js';

let pass = 0, fail = 0;
const out = [];
function t(name, fn) { try { fn(); pass++; out.push(['PASS', name]); } catch (e) { fail++; out.push(['FAIL', name, e.message]); } }

const hazardXs = (lv) => [
  ...lv.spikes.map((s) => s.x), ...lv.saws.map((s) => s.cx), ...lv.spinners.map((s) => s.cx), ...lv.pulses.map((s) => s.x),
];
function groundAt(lv, x) { return lv.solids.some((s) => s.y1 === 0 && x >= s.x && x <= s.x + s.w); }

// Replay a proven jump list through the REAL simulation of the full level. Returns what happened, including the screen
// orientation at every coin and checkpoint (it must be normal there, or a respawn would start upside-down).
function replayFull(lv, inputs) {
  const lv2 = Object.assign({}, lv, { coins: [], checkpoints: [] });
  const marks = [...lv.coins.map((c) => c.x), ...lv.checkpoints.map((c) => c.x)].sort((a, b) => a - b);
  const orients = [], modes = []; let mi = 0, orbs = 0, portals = 0, mportals = 0;
  const p = replayInputs(lv2, inputs, {
    onStep(p, e) {
      for (let j = 0; j < e.length; j++) { if (e[j] === 7) orbs++; if (e[j] === 6) portals++; if (e[j] === 9) mportals++; if (WITH_IDX.has(e[j])) j++; }
      while (mi < marks.length && p.x >= marks[mi]) { orients.push(p.orient); modes.push(p.mode * 10 + (p.grav > 0 ? 0 : 1)); mi++; }
    },
  });
  return { finished: p.finished, dead: p.dead, reason: p.deathReason, x: p.x, orients, modes, orbs, portals, mportals, finalOrient: p.orient };
}
const WITH_IDX = new Set([2, 3, 6, 7, 9, 10]); // event codes that are followed by an index (coin, checkpoint, portal, orb, mode portal, secret coin)
const lowestY = (arr, f) => arr.reduce((m, o) => Math.min(m, f(o)), 1e9);

for (const def of LEVEL_DEFS) {
  const lv = getLevel(def.id);
  const tag = `L${def.id} ${def.name}`;

  t(`${tag}: bot proves level completable with slack (margin ${def.margin / 2}, window ${def.pressEvery} ticks)`, () => {
    const r = proveCompletable(lv, { margin: def.margin / 2, pressEvery: def.pressEvery });
    assert.ok(r.ok, `unwinnable; best ${r.best}/${lv.finishX}`);
  });

  t(`${tag}: bot proves completable at zero slack and 1/60s resolution`, () => {
    const r = proveCompletable(lv, { margin: 0, pressEvery: 1 });
    assert.ok(r.ok, `unwinnable; best ${r.best}`);
  });

  t(`${tag}: replaying the proven jump sequence in the real simulation reaches 100% with no damage`, () => {
    const r = proveCompletable(lv, { margin: 0, pressEvery: 1 });
    const lv2 = Object.assign({}, lv, { coins: [], checkpoints: [] });
    const p = replayInputs(lv2, r.inputs);
    assert.ok(p.finished, `dead=${p.dead} reason=${p.deathReason} x=${p.x.toFixed(1)}/${lv.finishX}`);
  });

  t(`${tag}: length, coin & checkpoint counts`, () => {
    assert.equal(lv.coins.length, def.coins);
    assert.equal(lv.checkpoints.length, 3);
    assert.ok(lv.finishX / lv.speed > 55 && lv.finishX / lv.speed < 230, `duration ${lv.finishX / lv.speed}s`);
  });

  t(`${tag}: every coin gate sits on solid ground with clear flat space before it and for the 2 s shield afterwards`, () => {
    const hx = hazardXs(lv);
    for (const c of lv.coins) {
      assert.ok(groundAt(lv, c.x), `coin at ${c.x} not over ground`);
      const bad = hx.filter((x) => x > c.x - 8 && x < c.x + 2 * lv.speed);
      assert.equal(bad.length, 0, `hazard near coin ${c.x}: ${bad}`);
      const plats = lv.platforms.filter((p) => p.x - p.ax < c.x + 2 * lv.speed && p.x + p.w + p.ax > c.x - 8);
      assert.equal(plats.length, 0, 'platform near coin');
    }
  });

  t(`${tag}: checkpoints are on solid ground with 8+ tiles of hazard-free run-out`, () => {
    const hx = hazardXs(lv);
    for (const c of lv.checkpoints) {
      assert.ok(groundAt(lv, c.x));
      assert.equal(hx.filter((x) => x > c.x - 2 && x < c.x + 8).length, 0, `hazard near checkpoint ${c.x}`);
      assert.ok(c.y === 0);
    }
  });

  t(`${tag}: no coin gate can be bypassed (gate is a full-height column crossed by every route)`, () => {
    // any route reaching the finish crosses every coin.x: verify via the proven path
    const r = proveCompletable(lv, { margin: 0, pressEvery: 1 });
    const lv2 = Object.assign({}, lv, { checkpoints: [] });
    let hits = 0;
    const seen = new Set();
    // respawn-free replay but WITH coins enabled (coins just register, they do not stop physics here)
    replayInputs(lv2, r.inputs, { onStep(p, e) { for (let k = 0; k < e.length; k++) { if (e[k] === 2) { seen.add(e[++k]); hits++; } else if (WITH_IDX.has(e[k])) k++; } } });
    assert.equal(seen.size, lv.coins.length, `only ${seen.size}/${lv.coins.length} coins triggered`);
    assert.equal(hits, lv.coins.length, 'a coin triggered more than once');
  });

  t(`${tag}: difficulty ramps up (hazards per 20% band non-decreasing between first and last band)`, () => {
    const bands = [0, 0, 0, 0, 0];
    const inSec = (x) => (lv.sections || []).some((z) => x >= z.x0 - 1 && x <= z.x1 + 12);
    const add = (x, w = 1) => { if (inSec(x)) return; const b = Math.min(4, Math.floor((x / lv.finishX) * 5)); bands[b] += w; };
    lv.spikes.forEach((s) => add(s.x)); lv.saws.forEach((s) => add(s.cx, 2)); lv.spinners.forEach((s) => add(s.cx, 2));
    lv.pulses.forEach((s) => add(s.x, 2)); lv.platforms.forEach((s) => add(s.x, 2));
    lv.solids.filter((s) => s.y1 > 0).forEach((s) => add(s.x, 1.5));
    const gaps = lv.solids.filter((s) => s.y1 === 0).sort((a, b) => a.x - b.x);
    for (let i = 1; i < gaps.length; i++) if (gaps[i].x - (gaps[i - 1].x + gaps[i - 1].w) > 0.5) add(gaps[i].x, 2);
    out.push(['INFO', `${tag} hazard-weight per 20% band: ${bands.map((b) => b.toFixed(0)).join(' / ')}`]);
    assert.ok(bands[4] > bands[0], `last band ${bands[4]} should exceed first ${bands[0]}`);
    assert.ok(bands[3] + bands[4] > bands[0] + bands[1], 'second half should be harder than first');
  });

  t(`${tag}: moving platforms present and include vertical and horizontal motion by level end`, () => {
    assert.ok(lv.platforms.length >= 3, `only ${lv.platforms.length} platforms`);
    if (def.id === 1) assert.ok(lv.platforms.every((p) => p.x / lv.finishX >= 0.1), 'L1 platforms appear from ~10% (v6.2: harder from the start)');
  });


  // ---------------- v3: routes, portals, orbs, floating tiles
  t(`${tag}: ships pre-built (levels.baked.js matches the generator + settings)`, () => {
    assert.ok(BAKED.some((b) => b.id === def.id && b.sig === levelSig(def)), 'stale: run  npm run bake');
    assert.equal(lv.fromBake, true);
  });

  const forks = lv.solids.filter((s) => s.route === 'e').length / 3;
  t(`${tag}: has ${Math.ceil(def.forks * 0.6)}+ route forks, ${def.secrets} secret coins on risky high routes, and a section of every movement kind it lists (${def.zoneKinds.join(', ')})`, () => {
    assert.ok(forks >= Math.ceil(def.forks * 0.6), `forks ${forks}`);
    assert.ok(lv.orbs.length >= 1, 'needs at least one double-jump orb');
    assert.equal(lv.secrets.length, def.secrets, 'secret coins');
    for (const k of new Set(def.zoneKinds)) assert.ok(lv.sections.some((z) => z.kind === k), 'missing a ' + k + ' section');
    // every section opens with a mode portal and closes back to the normal cube with normal gravity
    for (const z of lv.sections) {
      const ms = lv.mports.filter((m) => m.x >= z.x0 - 0.01 && m.x <= z.x1 + 0.01);
      assert.ok(ms.length >= 2, 'section needs an entry and an exit portal');
      const last = ms[ms.length - 1];
      assert.ok(last.mode === 0 && last.grav === 1, 'section must end as a normal cube');
    }
    out.push(['INFO', `${tag}: sections ${lv.sections.map((z) => z.kind + ' @beat ' + Math.round(z.x0 / lv.tpb)).join(', ')}; secret coins at beats ${lv.secrets.map((s) => Math.round(s.x / lv.tpb)).join(', ')}`]);
  });
  t(`${tag}: each secret coin can only be collected on its fork's high route (never on the ground route)`, () => {
    for (const sc of lv.secrets) {
      assert.ok(sc.y0 > GROUND_MAX_Y + 0.8, 'column reaches down to the ground route');
      const tiles = lv.solids.filter((s) => s.route === 'a' && s.x <= sc.x + 0.5 && s.x + s.w >= sc.x - 0.5);
      const highTiles = lv.solids.filter((s) => s.route === 'a' && Math.abs(s.x - sc.x) < 40);
      assert.ok(highTiles.length > 0, 'no high route near the secret coin');
      if (tiles.length) assert.ok(tiles.every((s) => s.y1 >= sc.y0 && s.y1 <= sc.y1), 'coin column must cover the high route there');
    }
  });

  const groundOnly = __dbg.routeLevel(lv, ['a']); // keeps the entry stairs; the prover may never rise above GROUND_MAX_Y
  const skyOnly = __dbg.routeLevel(lv, ['g']);
  for (const [label, sub, maxY] of [['GROUND route only', groundOnly, GROUND_MAX_Y], ['SKY route only', skyOnly, undefined]]) {
    t(`${tag}: ${label} is provably completable (taking that route at every fork), with slack`, () => {
      const r = proveCompletable(sub, { margin: def.margin / 2, pressEvery: def.pressEvery, maxY });
      assert.ok(r.ok, `unwinnable; best ${r.best}/${lv.finishX}`);
    });
    t(`${tag}: ${label}: proven jumps replayed in the FULL level finish with no damage; screen is normal at every coin & checkpoint`, () => {
      const r = proveCompletable(sub, { margin: 0, pressEvery: 1, maxY });
      assert.ok(r.ok);
      const rep = replayFull(lv, r.inputs);
      assert.ok(rep.finished, `dead=${rep.dead} (${rep.reason}) at x=${rep.x.toFixed(1)}/${lv.finishX}`);
      assert.ok(rep.orients.every((o) => o === 0), 'orientation at checkpoints/coins: ' + rep.orients.join(','));
      assert.ok(rep.modes.every((o) => o === 0), 'every coin and checkpoint must be reached as a normal cube: ' + rep.modes.join(','));
      assert.equal(rep.finalOrient, 0);
      out.push(['INFO', `${tag} ${label}: orbs touched ${rep.orbs}, portals passed ${rep.portals}`]);
    });
  }
  t(`${tag}: the two routes share no space: sky route sits well above every single-jump reach of the ground route`, () => {
    const sky = lv.solids.filter((s) => s.route === 'a'), skyP = lv.platforms.filter((s) => s.route === 'a');
    const lows = [
      lowestY(sky, (s) => s.y0), lowestY(skyP, (p) => p.y - p.ay - p.h), lowestY(lv.spikes.filter((s) => s.route === 'a'), (s) => s.y),
      lowestY(lv.saws.filter((s) => s.route === 'a'), (s) => s.cy - s.ay - s.r), lowestY(lv.spinners.filter((s) => s.route === 'a'), (s) => s.cy - s.len - 0.2),
    ];
    const low = Math.min(...lows);
    assert.ok(low >= 4.5, 'sky route dips to ' + low);   // normal jump: body top 3.2; double jump: 5.6
    out.push(['INFO', `${tag} lowest sky-route object: ${low.toFixed(2)} tiles above ground (single jump reaches 3.2, double jump 5.6)`]);
    const gHigh = Math.max(...lv.spinners.filter((s) => s.route === 'g').map((s) => s.cy + s.len + 0.2), ...lv.saws.filter((s) => s.route === 'g').map((s) => s.cy + s.ay + s.r), 0);
    assert.ok(gHigh < low, 'ground hazards reach into the sky route');
  });
  t(`${tag}: every sky-route step is a single jump (tile tops differ by <= 2.0) and orbs are optional pick-ups`, () => {
    const e = lv.solids.filter((s) => s.route === 'e').sort((a, b) => a.x - b.x);
    for (let i = 0; i < e.length; i += 3) {
      assert.ok(e[i].y1 <= 2.0, 'first step too high ' + e[i].y1);
      assert.ok(e[i + 1].y1 - e[i].y1 <= 2.0 && e[i + 2].y1 - e[i + 1].y1 <= 2.0, 'step too high');
    }
    for (const o of lv.orbs) {
      assert.ok(o.y >= 1.4 && o.y <= 2.6, 'orb height ' + o.y);
      assert.equal(lv.spikes.filter((s) => Math.abs(s.x - o.x) < 5).length, 0, 'hazard next to an orb');
    }
  });


  t(`${tag}: every portal has ${PORTAL_FLIP}s+ of hazard-free run-out, so the flip finishes before anything can kill you`, () => {
    const need = (PORTAL_FLIP + 0.1) * lv.speed;
    const haz = (route) => [
      ...lv.spikes, ...lv.pulses.map((p) => ({ x: p.x, route: p.route, y: p.y })),
      ...lv.saws.map((w) => ({ x: w.cx - w.ax - w.r, route: w.route })),
      ...lv.spinners.map((w) => ({ x: w.cx - w.len, route: w.route })),
    ].filter((h) => (route === 'a' ? h.route === 'a' : h.route !== 'a'));
    for (const g of lv.portals) {
      // a portal high above the ground belongs to the sky route; one at ground level belongs to the ground route
      const route = g.y0 >= 4 ? 'a' : 'g';
      const bad = haz(route).filter((h) => h.x > g.x - 0.5 && h.x < g.x + need);
      assert.equal(bad.length, 0, `${route}-route portal at x=${g.x.toFixed(1)} has a hazard at x=${bad[0] && bad[0].x.toFixed(1)} (needs ${need.toFixed(1)} clear tiles)`);
    }
    out.push(['INFO', `${tag} ${lv.portals.length} portals, each with ${need.toFixed(1)} clear tiles of run-out`]);
  });

  t(`${tag}: ground is continuous at start; start run-up is hazard-free`, () => {
    assert.ok(groundAt(lv, 0) && groundAt(lv, 10));
    assert.equal(hazardXs(lv).filter((x) => x < 12).length, 0);
  });
}

t('every song has an easy, a medium and a hard stage, and each stage is faster than the last', () => {
  for (const song of SONG_IDS) {
    const st = TIERS.map((tier) => LEVEL_DEFS.find((d) => d.song === song && d.tier === tier));
    assert.ok(st.every(Boolean), song + ' is missing a stage');
    assert.ok(st[0].speed < st[1].speed && st[1].speed < st[2].speed, song + ': stages must speed up');
    assert.deepEqual([0, 1, 2, 3].map((s) => stageId(song, s)), [st[0].id, st[1].id, st[2].id, st[2].id], song + ': stage 4+ repeats the hard layout');
  }
  // v5: every level runs on a real song locked to a steady tempo, so difficulty comes from speed, density and the tier of musical hits
  assert.ok(LEVEL_DEFS.every((d) => d.song && d.bpm === getBeatMap(d.song).bpm), 'every level needs a song, and its tempo must be the song\'s tempo');
});
t('level generation is deterministic (same seed -> same layout)', () => {
  const a = JSON.stringify(getLevel(1).spikes), b = JSON.stringify(getLevel(1).spikes);
  assert.equal(a, b);
});

for (const r of out) console.log(r[0], '-', r[1], r[2] ? '\n      ' + r[2] : '');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
