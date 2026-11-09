// Faith Dash — application controller: state machine, game loop, run lifecycle, persistence.
import Phaser from 'phaser';
import { FSM, S } from './core/fsm.js';
import { store } from './core/storage.js';
import { bank } from './core/bank.js';
import { audio, TRACKS } from './audio/audio.js';
import { SONG_URLS } from './audio/songs.js';
import { getBeatMap } from './audio/music.js';
import { lb } from './core/leaderboard.js';
import { getLevel, tutorialLevel, LEVEL_DEFS } from './game/levelgen.js';
import { Run } from './game/run.js';
import { PW, PH, DT } from './game/sim.js';
import { SmoothClock } from './game/clock.js';
import { PhaserPen } from './render/pen.js';
import { loadArt, art } from './render/art.js';
import { drawWorld, drawPlayer, drawParticles, emitTrail, Particles, layout } from './render/world.js';
import { PORTAL_FLIP } from './game/levelgen.js';
import { SKINS, skinById } from './render/skins.js';
import { BACKGROUNDS } from './render/backgrounds.js';
import { uuid, sanitizeName, validName } from './core/util.js';
import { UI } from './ui/ui.js';
import { proveCompletable } from './game/bot.js';

audio.setSongUrls(SONG_URLS);

// Timing windows (seconds) for rating a jump against the music's hit it was aimed at.
export const RATING = { perfect: 0.06, great: 0.11, good: 0.17, near: 0.35 };

const PRACTICE_QUESTIONS = [
  { id: 'tut1', text: 'Practice question: how many hearts do you start each run with?', options: ['Five', 'Three', 'One', 'Ten'], correctIdx: 1, ref: '', expl: 'You start with three hearts. This is a practice question about the game, not Bible trivia.' },
  { id: 'tut2', text: 'Practice question: what happens when you answer a question correctly?', options: ['Nothing', 'You lose a heart', 'You gain a heart (up to three)', 'The level restarts'], correctIdx: 2, ref: '', expl: 'A correct answer restores one heart, up to a maximum of three. This is a practice question, not Bible trivia.' },
];

export class App {
  constructor() {
    this.fsm = new FSM(S.MAIN_MENU);
    this.t = 0;
    this.hold = false; // tests can freeze the real-time loop and step manually
    this.run = null;
    this.level = null;
    this.practice = false;
    this.particles = new Particles();
    this.pending = null; // timers/sequences
    this.cd = null;
    this.musicStarted = false;
    this.reduced = false;
    this.renderScale = 1;
    this.fps = { acc: 0, n: 0, low: 0, shown: false };
    this.view = layout(1280, 720);
    this.lastBeat = 0;
    this.map = null; // beat map of the song in the current level
    this.clock = new SmoothClock(); this.pv = { x: 0, y: 0, rot: 0, t: 0 }; this.renderT = 0;
    this.mu = { low: 0, mid: 0, hi: 0, kick: 0, snare: 0, inten: 0, drop: 0, beat: 0, barPos: 0, spb: 0.4615 };
    this.groove = this.newGroove();
    this.pressT = -9;
    this.errors = [];
    this.stats = { frames: 0 };
  }

  // ------------------------------------------------------------------ boot
  init() {
    this.sd = store.load();
    bank.load();
    Object.assign(audio.settings, this.sd.audio);
    this.reduced = !!this.sd.reduced;
    this.ui = new UI(this);
    loadArt().then(() => document.body.classList.add('art-ready'));
    this.bindInput();
    this.makeGame();
    this.fsm.on((next, prev, why) => this.onState(next, prev, why));
    // build levels while idle so the first Play press is instant
    const warm = () => { try { LEVEL_DEFS.forEach((d) => getLevel(d.id)); } catch (e) { this.report(e); } };
    (window.requestIdleCallback || ((f) => setTimeout(f, 300)))(warm);
    if (!this.sd.username) this.ui.go('welcome'); else this.ui.go('main');
    window.addEventListener('error', (e) => this.report(e.error || e.message));
    window.addEventListener('unhandledrejection', (e) => this.report(e.reason));
    if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !import.meta.env.DEV) navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  report(e) {
    const msg = String((e && e.stack) || e);
    this.errors.push(msg);
    if (this.errors.length > 30) this.errors.shift();
    console.error('[FaithDash]', msg);
  }
  makeGame() {
    const app = this;
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'stage',
      width: 1280,
      height: 720,
      backgroundColor: '#0a0820',
      banner: false,
      scale: { mode: Phaser.Scale.NONE },
      render: { antialias: true, powerPreference: 'high-performance', roundPixels: false },
      input: { keyboard: false, mouse: false, touch: false, gamepad: false },
      audio: { noAudio: true },
      fps: { target: 60, smoothStep: false },
      disableContextMenu: true,
      scene: {
        create() { app.pen = new PhaserPen(this); app.resize(); app.sceneReady = true; },
        update(time, delta) { if (!app.hold && app.sceneReady) { try { app.tick(delta / 1000); } catch (e) { app.report(e); } } },
      },
    });
    let rz;
    window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => this.resize(), 80); });
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    const cv = () => this.game.canvas;
    this.game.events.once('ready', () => {
      const c = cv();
      if (c) {
        c.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.contextLost = true; if (this.fsm.is(S.PLAYING, S.COUNTDOWN)) this.pause(); this.ui.toast('Graphics were interrupted — tap Resume to continue.'); });
        c.addEventListener('webglcontextrestored', () => { this.contextLost = false; });
      }
    });
  }
  resize() {
    if (!this.game || !this.game.canvas) return;
    const host = document.getElementById('stage');
    const cssW = Math.max(2, host.clientWidth), cssH = Math.max(2, host.clientHeight);
    const dpr = window.devicePixelRatio || 1;
    const q = this.sd.quality;
    const mobile = matchMedia('(pointer: coarse)').matches;
    let pxH;
    if (q === 'auto') pxH = Math.min(cssH * dpr, mobile ? 1440 : 2160);
    else pxH = Number(q);
    pxH = Math.max(240, Math.round(pxH * this.renderScale));
    const pxW = Math.max(2, Math.round((pxH * cssW) / cssH));
    this.game.scale.resize(pxW, pxH);
    const c = this.game.canvas;
    c.style.width = cssW + 'px'; c.style.height = cssH + 'px';
    this.view = layout(pxW, pxH);
    this.renderPx = { w: pxW, h: pxH, css: [cssW, cssH], dpr };
    this.checkOrientation();
  }
  checkOrientation() {
    const portrait = window.innerHeight > window.innerWidth * 1.05;
    const touch = matchMedia('(pointer: coarse)').matches;
    const need = portrait && touch;
    document.getElementById('rotate').classList.toggle('hidden', !need);
    if (need && this.fsm.is(S.PLAYING, S.COUNTDOWN)) this.pause();
  }

  newGroove() { return { combo: 0, best: 0, perfect: 0, great: 0, good: 0, off: 0, rated: 0 }; }
  // The song for the level the Play button will start (used to load it before the countdown even begins).
  prefetchSong(levelId) {
    const def = LEVEL_DEFS.find((l) => l.id === (levelId || this.sd.lastLevel || 1));
    if (def && def.song && audio.ctx) { audio.releaseSongsExcept(def.song); audio.loadSong(def.song); }
  }

  // ------------------------------------------------------------------ input
  bindInput() {
    const unlock = () => { audio.unlock(); this.prefetchSong(); };
    document.addEventListener('pointerdown', unlock, { capture: true });
    document.addEventListener('keydown', unlock, { capture: true });
    const app = document.getElementById('app');
    app.addEventListener('pointerdown', (e) => {
      if (!this.fsm.is(S.PLAYING, S.COUNTDOWN)) return;
      if (e.target.closest('button, input, select, textarea, a, .screen, [data-nojump]')) return;
      e.preventDefault();
      this.holding = true; this.syncHold();
      if (this.fsm.is(S.PLAYING)) this.jump();
    });
    // v6: the ship and the wave fly while the button is HELD, so letting go matters too
    const release = () => { this.holding = false; this.syncHold(); };
    document.addEventListener('pointerup', release);
    document.addEventListener('pointercancel', release);
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      const typing = /INPUT|TEXTAREA|SELECT/.test(tag);
      const st = this.fsm.state;
      if (e.key === 'Escape') { this.onEscape(); return; }
      if (typing) return;
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
        if (st === S.PLAYING) { e.preventDefault(); if (!e.repeat) { this.holding = true; this.syncHold(); this.jump(); } }
        else if (st === S.COUNTDOWN) { e.preventDefault(); this.holding = true; this.syncHold(); }
        return;
      }
      if (e.code === 'KeyP' && !e.repeat) { if (st === S.PLAYING || st === S.COUNTDOWN) this.pause(); else if (st === S.PAUSED) this.resume(); return; }
      if (e.code === 'KeyM' && !e.repeat) { this.setAudio({ muted: !audio.settings.muted }); return; }
      if (st === S.TRIVIA) {
        const idx = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, KeyA: 0, KeyB: 1, KeyC: 2, KeyD: 3 }[e.code];
        if (idx != null) this.selectAnswer(idx);
        if (e.code === 'Enter') this.submitAnswer();
      } else if (st === S.TRIVIA_RESULT && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); this.continueAfterTrivia(); }
    });
    document.addEventListener('keyup', (e) => { if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') release(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.fsm.is(S.PLAYING, S.COUNTDOWN)) this.pause('hidden');
        audio.stopPreview(); audio.suspend();
      } else audio.wake();
    });
    window.addEventListener('pagehide', () => { if (this.fsm.is(S.PLAYING, S.COUNTDOWN)) this.pause('hidden'); });
    window.addEventListener('blur', () => { release(); if (this.fsm.is(S.PLAYING)) this.pause('blur'); });
  }
  onEscape() {
    const st = this.fsm.state;
    if (st === S.PLAYING || st === S.COUNTDOWN) this.pause();
    else if (st === S.PAUSED) this.resume();
    else this.ui.escape();
  }
  syncHold() { if (this.run) this.run.setHold(!!this.holding); }
  jump() {
    if (!this.run || !this.fsm.is(S.PLAYING)) return;
    this.pressT = this.run.p.t + this.run.acc; // when (in song time) the player pressed
    this.run.press();
  }

  // ------------------------------------------------------------------ settings helpers
  persist() { store.save(); }
  setAudio(patch) {
    Object.assign(audio.settings, patch);
    Object.assign(this.sd.audio, patch);
    audio.applyVolumes(); this.persist(); this.ui.refreshAudioIcons && this.ui.refreshAudioIcons();
  }
  setQuality(q) { this.sd.quality = q; this.persist(); this.resize(); }
  setReduced(v) { this.reduced = !!v; this.sd.reduced = !!v; this.persist(); }
  get bpmForMenu() { return 120; }

  // ------------------------------------------------------------------ run lifecycle
  startLevel(levelId, { practice = false } = {}) {
    audio.unlock();
    audio.stopPreview();
    this.practice = practice;
    try {
      this.level = practice ? tutorialLevel() : getLevel(levelId);
    } catch (e) { this.report(e); this.ui.toast('Could not build that level.'); return; }
    if (!practice) { this.sd.lastLevel = levelId; this.persist(); }
    this.run = new Run({ level: this.level, bank, practice, practiceQuestions: PRACTICE_QUESTIONS, hardcore: !practice && !!this.sd.hardcore });
    this.trail = [];
    this.run.runId = uuid();
    this.run.sessionToken = null;
    this.run.tokenPromise = null;
    if (!practice && lb.configured) {
      this.run.tokenPromise = lb.startRun(this.sd.playerId, levelId).then((r) => { if (r.ok && r.data) this.run.sessionToken = r.data.token; return r; });
    }
    this.particles.clear();
    this.musicStarted = false;
    this.map = this.level.song ? getBeatMap(this.level.song) : null;
    this.groove = this.newGroove();
    this.cueTimes = Float64Array.from((this.level.cues || []).map((c) => c.t).sort((a, b) => a - b));
    if (this.level.song) { audio.releaseSongsExcept(this.level.song); audio.loadSong(this.level.song); } // decode while the countdown runs
    this.ui.leaveAll();
    this.ui.showHud(this.run, this.level);
    this.startCountdown('start');
    if (!this.fsm.go(S.COUNTDOWN, 'start level')) { this.fsm.state = S.COUNTDOWN; }
  }
  startCountdown(kind) {
    const full = kind === 'start';
    this.cd = { kind, t: 0, label: null, steps: full ? [['READY', 0], ['3', 0.75], ['2', 1.35], ['1', 1.95], ['GO!', 2.55]] : [['3', 0], ['2', 0.45], ['1', 0.9], ['GO!', 1.35]], end: full ? 3.0 : 1.7 };
  }
  tickCountdown(dt) {
    const cd = this.cd;
    cd.t += dt;
    let lab = null;
    for (const [l, at] of cd.steps) if (cd.t >= at) lab = l;
    if (lab !== cd.label) {
      cd.label = lab;
      this.ui.bigText(lab);
      audio.sfx(lab === 'GO!' ? 'go' : lab === 'READY' ? 'click' : 'tick');
    }
    if (cd.t >= cd.end) {
      // The song is still decoding (slow phone): hold on "GO!" for a moment rather than starting out of time.
      const id = this.level && this.level.song;
      if (id && !audio.songReady(id) && audio.songLoadState(id) === 'loading' && cd.t < cd.end + 8) return;
      this.cd = null; this.beginPlaying();
    }
  }
  beginPlaying() {
    if (!this.fsm.go(S.PLAYING, 'countdown done')) return;
    const r = this.run;
    if (!this.musicStarted) {
      const id = this.level.song;
      // real song if it is loaded; otherwise (practice run, or the song could not load) the built-in synth track
      if (!(id && audio.startSong(id, r.p.t, this.level.cues))) audio.startMusic(this.sd.song, this.level.bpm, r.p.t, this.level.cues);
      this.resetClock();
      this.musicStarted = true;
    } else { audio.resumeMusic(r.p.t); this.resetClock(); }
  }
  onState(next) { document.body.dataset.state = next; }
  // Start the smoothing clock from wherever the music is (or the game, when there is no song).
  resetClock() {
    const r = this.run; if (!r) return;
    let t = r.p.t;
    try { if (audio.songActive) t = audio.songTime(); } catch { /* no audio context yet */ }
    this.clock.reset(t); this.renderT = r.p.t;
  }

  pause(why) {
    if (!this.fsm.is(S.PLAYING, S.COUNTDOWN)) return;
    this.pausedFrom = this.fsm.state;
    if (!this.fsm.go(S.PAUSED, why || 'user')) return;
    audio.pauseMusic();
    this.ui.bigText(null);
    this.ui.showPause(why);
  }
  resume() {
    if (!this.fsm.is(S.PAUSED)) return;
    audio.unlock();
    this.ui.hidePause();
    this.fsm.go(S.COUNTDOWN, 'resume');
    this.startCountdown('resume');
  }
  restart() {
    const id = this.practice ? 0 : this.level.id;
    audio.stopMusic();
    this.ui.leaveAll();
    // go through a legal transition path
    if (this.fsm.is(S.PAUSED, S.GAME_OVER, S.LEVEL_COMPLETE, S.SCORE_SUBMISSION)) this.startLevel(id, { practice: this.practice });
  }
  quitToMenu() {
    if (this.run && !this.practice && this.fsm.is(S.PAUSED)) this.accumulateTotals(this.run, true);
    audio.stopMusic(); audio.stopPreview();
    this.ui.leaveAll();
    this.ui.hideHud();
    this.cd = null;
    this.run = null; this.level = null;
    this.particles.clear();
    this.fsm.state = S.MAIN_MENU; // always legal: explicit hard reset of the run
    this.ui.go('main');
  }

  // ------------------------------------------------------------------ per-frame
  tick(dt) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    this.stats.frames++;
    this.fpsWatch(dt);
    const st = this.fsm.state;
    if (st === S.COUNTDOWN && this.cd) this.tickCountdown(dt);
    else if (st === S.PLAYING && this.run) {
      let dtSim = dt, cap = 0.1, songLocked = false;
      const r = this.run;
      if (audio.songActive) {
        // The music is the clock: the game goes wherever the song is (what the player is hearing). The audio clock is
        // read through a smoothing clock so the scrolling glides instead of shuddering on the audio clock's little jumps.
        const songT = audio.songTime();
        if (songT - (r.p.t + r.acc) > 0.3) { audio.resync(r.p.t); this.clock.reset(r.p.t); dtSim = 0; } // a long hitch: pull the music back to the game instead
        else {
          const ct = this.clock.update(dt, songT);
          // run the simulation one fixed step AHEAD of the clock, so the frame can be drawn exactly at the clock's time
          dtSim = Math.max(0, ct + DT - (r.p.t + r.acc)); cap = 0.3; songLocked = true;
          this.renderT = ct;
        }
      }
      const evs = this.run.advance(dtSim, cap);
      if (!songLocked) this.renderT = this.run.p.t + this.run.acc - DT; // no song: draw one step behind, between two steps
      this.handleEvents(evs);
      if (this.fsm.is(S.PLAYING)) {
        audio.update(this.run.p.t);
        this.trailAcc = (this.trailAcc || 0) + dt;
        if (this.trailAcc > 0.03) { this.trailAcc = 0; emitTrail(this.particles, this.run.p, skinById(this.sd.skin), this.t, this.reduced, dt); }
      }
    }
    if (this.pending) {
      this.pending.t -= dt;
      if (this.pending.t <= 0) { const f = this.pending.fn; this.pending = null; f(); }
    }
    this.particles.update(dt);
    this.ui.tick(dt);
    this.render();
  }
  fpsWatch(dt) {
    const f = this.fps;
    f.acc += dt; f.n++;
    if (f.acc >= 1) {
      const fps = f.n / f.acc; f.cur = fps; f.acc = 0; f.n = 0;
      if (this.fsm.is(S.PLAYING) && this.sd.quality === 'auto' && fps < 38) f.low++; else f.low = Math.max(0, f.low - 1);
      if (f.low >= 4 && !f.shown) {
        f.shown = true; f.low = 0;
        this.renderScale = 0.7; this.reduced = true; this.resize();
        this.ui.toast('Performance mode enabled for smoother play.');
      }
    }
  }
  render() {
    if (!this.pen) return;
    const run = this.run;
    if (!run || !this.level) { this.renderFrame(); this.pen.finish(); return; }
    // Draw the runner where it is at this exact moment (between two simulation steps), then put the real state back.
    const p = run.p, sx = p.x, sy = p.y, sr = p.rot, stt = p.t, v = run.viewAt(this.renderT, this.pv);
    p.x = v.x; p.y = v.y; p.rot = v.rot; p.t = v.t;
    try { this.renderFrame(); } finally { p.x = sx; p.y = sy; p.rot = sr; p.t = stt; this.pen.finish(); }
  }
  renderFrame() {
    const pen = this.pen, v = this.view;
    const run = this.run;
    const bpm = this.level ? this.level.bpm : this.bpmForMenu;
    const clockT = run ? run.p.t : this.t;
    const beat = (clockT * bpm) / 60;
    let pulse = Math.exp(-5 * (beat - Math.floor(beat)));
    // Music-reactive state: the real hits of the song (kick, snare, band energy, drops), read at the game's own clock.
    let music = null;
    if (run && this.level && this.map) {
      const m = this.map, mu = this.mu, t = run.p.t;
      m.envAt(t, mu);
      mu.kick = m.kickAt(t); mu.snare = m.snareAt(t); mu.inten = m.intensityAt(t); mu.drop = m.dropFlashAt(t); mu.heat = m.heatAt(t);
      mu.beat = t / m.spb; mu.barPos = m.barPos(t); mu.spb = m.spb; mu.t = t;
      music = mu;
      pulse = Math.max(pulse * 0.6, mu.kick); // backgrounds throb with the actual kick drum
    }
    pen.clear();
    const an = (this.anim = this.anim || { g: true, landT: -9, jumpT: -9 });
    if (run && this.level) {
      const g = run.p.grounded;
      if (g && !an.g && !run.p.dead) {
        an.landT = this.t;
        if (!this.reduced) this.particles.burst(run.p.x + 0.4, run.p.y + 0.05, 5, [0xffffff, 0xcfe8ff, 0xe8d8b0], 2.6, 0.1);
      }
      an.g = g;
    }
    this.syncOrient(run && this.level ? run.p.orient : 0);
    // a short camera shake as a drop lands
    let vv = v;
    if (music && !this.reduced && music.drop > 0.35) vv = Object.assign({}, v, { groundY: v.groundY + Math.sin(this.t * 90) * (music.drop - 0.3) * v.k * 0.22 });
    if (run && run.p.mode === 2 && !run.p.dead) { const tr = (this.trail = this.trail || []); const lp = tr[tr.length - 1]; if (!lp || run.p.x - lp.x > 0.15) { tr.push({ x: run.p.x + PW / 2, y: run.p.y + PH / 2 }); if (tr.length > 40) tr.shift(); } }
    else if (this.trail && this.trail.length && (!run || run.p.mode !== 2)) this.trail.length = 0;
    const st = { level: this.level, run, t: this.t, pulse, bgIndex: this.sd.bg, skinId: this.sd.skin, reduced: this.reduced, anim: an, music, map: this.map, groove: this.groove, ring: this.ring, showCues: audio.settings.cues, trail: this.trail };
    const info = drawWorld(pen, vv, st);
    if (run && this.level) {
      drawParticles(pen, vv, this.particles, info.camX);
      drawPlayer(pen, vv, st, info.camX);
      this.ui.updateHud(run);
      this.ui.updateBeat(music, this.groove);
    } else if (art.has('menu')) {
      // full-screen key art on the menus (no decorative runner)
    } else {
      // decorative runner on menus
      const skin = skinById(this.sd.skin);
      const cyc = (this.t * 0.9) % 1;
      const hop = cyc < 0.55 ? Math.sin((cyc / 0.55) * Math.PI) * 2.0 : 0;
      const px = v.W * 0.3, py = v.groundY - (hop + 0.4) * v.k, s = PW * v.k;
      skin.draw(pen, px, py, s, -(cyc < 0.55 ? cyc / 0.55 : 1) * Math.PI / 2, this.t, !this.reduced);
      this.trailAcc = (this.trailAcc || 0) + 1 / 60;
      this.menuP = this.menuP || { x: 0, y: 0, dead: false };
      if (!this.reduced && this.stats.frames % 2 === 0) {
        const cam = this.t * 4;
        this.particles.add(cam + v.W * 0.3 / v.k + 0.1, hop + 0.2 + Math.random() * 0.5, -3 - Math.random() * 3, (Math.random() - 0.3), 0.35 + Math.random() * 0.25, skin.trail.size, skin.trail.cols === 'rainbow' ? 0xffffff : skin.trail.cols[Math.floor(Math.random() * 3)]);
      }
      drawParticles(pen, v, this.particles, this.t * 4);
    }
  }

  // Portals flip the whole picture: upside-down (a vertical barrel roll) or mirrored (a horizontal one).
  // The world turns over a full second so the change reads as a move through the gate rather than a jump cut.
  // This is purely visual: the simulation, the controls and the hit-boxes never change, and every level guarantees
  // flat, hazard-free ground for longer than the flip lasts.
  syncOrient(o) {
    if (this._orient === o || !this.game || !this.game.canvas) return;
    const c = this.game.canvas;
    // Only animate during live play. A respawn or a fresh level snaps straight back to normal.
    const instant = !this.run || !this.level || !this.fsm.is(S.PLAYING) || this.reduced;
    c.style.transition = instant ? 'none' : `transform ${PORTAL_FLIP}s cubic-bezier(.5,0,.5,1)`;
    c.style.transform = o & 1 ? 'rotateX(180deg)' : o & 2 ? 'rotateY(180deg)' : 'rotateX(0deg)';
    this._orient = o;
    this.flipUntil = instant ? 0 : this.t + PORTAL_FLIP;
    document.body.dataset.orient = o ? (o & 1 ? 'flip' : 'mirror') : '';
  }

  // ------------------------------------------------------------------ events
  // How close was this jump to the music's hit it was aimed at?  (cosmetic: shown as PERFECT / GREAT / GOOD, builds a combo)
  rateJump() {
    const r = this.run, ct = this.cueTimes, g = this.groove;
    if (!ct || !ct.length || this.practice) return;
    const tp = this.pressT >= 0 && r.p.t - this.pressT < 0.12 && r.p.t - this.pressT >= 0 ? this.pressT : r.p.t;
    let lo = 0, hi = ct.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (ct[m] < tp) lo = m + 1; else hi = m; }
    let best = Infinity, bd = 0;
    for (const i of [lo - 1, lo]) if (i >= 0 && i < ct.length && Math.abs(tp - ct[i]) < best) { best = Math.abs(tp - ct[i]); bd = tp - ct[i]; }
    if (best > RATING.near) return; // a jump nowhere near a cue: not rated
    const kind = best <= RATING.perfect ? 'perfect' : best <= RATING.great ? 'great' : best <= RATING.good ? 'good' : 'off';
    g.rated++; g[kind]++;
    if (kind === 'perfect' || kind === 'great') g.combo++; else if (kind === 'off') g.combo = 0;
    g.best = Math.max(g.best, g.combo);
    this.ui.rating(kind, g.combo, bd);
    if (kind === 'perfect') audio.sfx('perfect'); else if (kind === 'great') audio.sfx('great');
    this.ring = { t: this.t, kind };
    if (!this.reduced && kind !== 'off') this.particles.burst(r.p.x + 0.4, 0.05, kind === 'perfect' ? 12 : 6, kind === 'perfect' ? [0xffe27a, 0xffffff, 0x7df3ff] : [0x7df3ff, 0xffffff], 4.5, 0.11);
  }
  handleEvents(evs) {
    const r = this.run;
    const dbl = evs.some((x) => x.type === 'double');
    for (const e of evs) {
      if (!this.fsm.is(S.PLAYING)) break;
      if (e.type === 'jump') { audio.sfx('jump'); this.particles.burst(r.p.x + 0.4, 0.05, 4, [0xffffff, 0xcfe8ff], 3, 0.1); if (!dbl) this.rateJump(); }
      else if (e.type === 'checkpoint') { audio.sfx('checkpoint'); this.ui.toast('Checkpoint reached'); const c = this.level.checkpoints[e.index]; this.particles.burst(c.x, 1, 18, [0x4dff9a, 0xffffff], 5); }
      else if (e.type === 'double') { audio.sfx('double'); if (this.anim) this.anim.jumpT = this.t; this.particles.burst(r.p.x + 0.4, r.p.y + 0.3, 14, [0x7dffb0, 0xffffff, 0x4dff9a], 6, 0.12); }
      else if (e.type === 'orb') {
        const o = this.level.orbs[e.index];
        audio.sfx('orb'); this.particles.burst(o.x, o.y, 22, [0x7dffb0, 0xffffff, 0x4dff9a], 7, 0.15);
        this.ui.toast('Double Jump power-up! Tap again in the air for 15 seconds.');
      } else if (e.type === 'portal') {
        const g = this.level.portals[e.index];
        audio.sfx('portal');
        this.particles.burst(g.x + 0.2, r.p.y + 0.4, 22, g.style === 'flip' ? [0xd24dff, 0xffffff, 0xf0b0ff] : [0x39e6ff, 0xffffff, 0xb8f6ff], 7, 0.15);
        if (g.set === 1) this.ui.toast('Upside-down portal!');
        else if (g.set === 2) this.ui.toast('Mirror portal!');
      }
      else if (e.type === 'mode') this.onModePortal(e);
      else if (e.type === 'secret') {
        const sc = this.level.secrets[e.index];
        audio.sfx('unlock');
        this.particles.burst(sc.x, sc.cy || r.p.y + 0.5, 34, [0xffd23a, 0xffffff, 0xffb02e], 8, 0.17);
        this.ui.toast(`Secret coin ${r.secretsHeld}/${this.level.secrets.length}! Finish the level to keep it.`, 2.2);
        this.ui.updateSecrets && this.ui.updateSecrets(r, this.level);
      }
      else if (e.type === 'coin') this.onCoin(e.index);
      else if (e.type === 'dead') this.onDeath(e.reason);
      else if (e.type === 'finish') this.onFinish();
    }
  }
  // v6: entering a fly / wave / gravity section (or leaving one)
  onModePortal(e) {
    const r = this.run, m = this.level.mports[e.index];
    audio.sfx('portal');
    const col = e.mode === 1 ? [0xff6ad5, 0xffffff, 0xffb0ea] : e.mode === 2 ? [0x39e6ff, 0xffffff, 0xb8f6ff] : e.grav < 0 ? [0xffd23a, 0xffffff, 0xfff3b0] : [0x4dff9a, 0xffffff, 0xb8ffd6];
    this.particles.burst(m.x, r.p.y + 0.4, 26, col, 8, 0.16);
    this.trail = [];
    const seen = (this.sd.seenModes = this.sd.seenModes || {});
    const key = e.mode === 1 ? 'ship' : e.mode === 2 ? 'wave' : e.grav < 0 ? 'grav' : null;
    if (!key) return;
    const tip = { ship: 'FLY! Hold to rise, let go to fall.', wave: 'WAVE! Hold = up, let go = down.', grav: 'GRAVITY FLIP! You run on the ceiling — jumps go down.' }[key];
    this.ui.toast(tip, seen[key] ? 1.2 : 3);
    if (!seen[key]) { seen[key] = 1; this.persist(); }
  }
  // v6 Hardcore: back to the very beginning after a short pause
  restartHardcore(msg) {
    const r = this.run;
    this.pending = {
      t: 0.85,
      fn: () => {
        r.restartFromStart();
        this.particles.clear(); this.trail = [];
        this.musicStarted = false;
        this.ui.showHud(r, this.level);
        this.fsm.go(S.COUNTDOWN, 'hardcore restart');
        this.startCountdown('resume');
        this.respawnPending = true;
        this.ui.toast(msg || `Attempt ${r.attempts}`, 1.4);
      },
    };
  }
  onCoin(index) {
    const r = this.run, c = this.level.coins[index];
    if (!this.fsm.go(S.TRIVIA, 'coin')) return;
    audio.pauseMusic();
    this.ui.bigText(null);
    audio.sfx('coin');
    this.particles.burst(c.x, 1.8, 26, [0xffd23a, 0xfff3b0, 0xffffff], 7, 0.16);
    this.ui.coinPop();
    const t = r.beginTrivia();
    this.pending = { t: 0.6, fn: () => { if (this.fsm.is(S.TRIVIA)) this.ui.showTrivia(t, r); } };
  }
  selectAnswer(i) {
    if (!this.fsm.is(S.TRIVIA) || !this.run || !this.run.trivia) return;
    if (this.run.select(i)) { audio.sfx('click'); this.ui.markSelected(i); }
  }
  submitAnswer() {
    if (!this.fsm.is(S.TRIVIA)) return;
    const r = this.run;
    const res = r.submit();
    if (!res) return;
    this.fsm.go(S.TRIVIA_RESULT, 'submitted');
    if (!this.practice) {
      const tot = this.sd.totals;
      if (res.correct) tot.correct++; else tot.incorrect++;
      this.checkUnlocks();
      this.persist();
    }
    audio.sfx(res.correct ? 'correct' : 'wrong');
    this.ui.showTriviaResult(r.trivia, res, r);
  }
  continueAfterTrivia() {
    if (!this.fsm.is(S.TRIVIA_RESULT)) return;
    const r = this.run;
    const out = r.endTrivia();
    this.ui.hideTrivia();
    if (out === 'gameover') { this.endRun('gameover'); return; }
    if (out === 'restart') {
      this.fsm.go(S.RESPAWNING, 'hardcore wrong answer');
      audio.stopMusic && audio.stopMusic();
      this.musicStarted = false;
      this.restartHardcore(`Wrong answer — Hardcore restarts the level. Attempt ${r.attempts}`);
      return;
    }
    if (!this.fsm.go(S.PLAYING, 'trivia done')) return;
    audio.resumeMusic(r.p.t); this.resetClock();
    audio.sfx('shield');
    this.ui.toast('Shield active — 2 seconds', 1.2);
  }
  // Collecting secret coins also unlocks skins: Celestial Flame at half of them, Divine Prism at all of them
  // (they can still be earned with correct answers too).
  secretTotals() {
    let got = 0, all = 0;
    for (const d of LEVEL_DEFS) { const a = (this.sd.secrets || {})[d.id] || []; got += a.reduce((x, y) => x + (y ? 1 : 0), 0); all += d.secrets || 0; }
    return { got, all };
  }
  checkSecretUnlocks() {
    const { got, all } = this.secretTotals();
    for (const [id, need] of [['flame', Math.ceil(all / 2)], ['prism', all]]) {
      const s = SKINS.find((k) => k.id === id);
      if (s && got >= need && !this.sd.unlocked.includes(id)) {
        this.sd.unlocked.push(id);
        setTimeout(() => { audio.sfx('unlock'); this.ui.toast(`Skin unlocked: ${s.name}! (secret coins)`, 3); }, 900);
      }
    }
  }
  checkUnlocks() {
    const tot = this.sd.totals.correct;
    for (const s of SKINS) {
      if (s.need > 0 && tot >= s.need && !this.sd.unlocked.includes(s.id)) {
        this.sd.unlocked.push(s.id);
        setTimeout(() => { audio.sfx('unlock'); this.ui.toast(`Skin unlocked: ${s.name}!`, 3); }, 700);
      }
    }
  }
  onDeath(reason) {
    const r = this.run;
    this.fsm.go(S.RESPAWNING, 'hit ' + reason);
    this.groove.combo = 0; this.ui.rating(null);
    audio.sfx('hit');
    audio.fadeOutMusic(0.25);
    this.musicStarted = false;
    this.particles.burst(r.p.x + 0.4, Math.max(0, r.p.y) + 0.4, 36, [0xff2f56, 0xffffff, 0xffd23a], 8, 0.18);
    this.ui.flash();
    const verdict = r.registerHit();
    if (verdict === 'restart') { this.restartHardcore(); return; }
    this.ui.heartLost();
    this.pending = {
      t: 0.95,
      fn: () => {
        if (verdict === 'gameover') { this.endRun('gameover'); return; }
        r.respawn();
        this.particles.clear();
        this.fsm.go(S.COUNTDOWN, 'respawn');
        this.startCountdown('resume');
        this.respawnPending = true;
      },
    };
  }
  onFinish() {
    this.fsm.go(S.LEVEL_COMPLETE, 'finish');
    audio.sfx('finish');
    audio.fadeOutMusic(1.2);
    this.particles.burst(this.level.finishX - 0.5, 3, 50, [0xffd23a, 0xffffff, 0x39e6ff, 0xff2f9a], 9, 0.18);
    this.endRun('complete', true);
  }

  // ------------------------------------------------------------------ end of run
  accumulateTotals(r, abandoned = false) {
    if (this.practice || r.totalsDone) return;
    r.totalsDone = true;
    const t = this.sd.totals;
    t.runs++; t.playTime += r.activeTime; t.distance += r.distance; t.coins += r.coinsCollected; t.deaths += r.deaths;
    this.persist();
  }
  endRun(kind, alreadyInState = false) {
    const r = this.run;
    if (r.ended) return; // never end twice (no duplicate Game Over)
    r.ended = true;
    audio.fadeOutMusic(0.8);
    this.ui.bigText(null);
    const target = kind === 'complete' ? S.LEVEL_COMPLETE : S.GAME_OVER;
    if (!alreadyInState && !this.fsm.go(target, 'end run')) return;
    if (kind === 'gameover') audio.sfx('gameover');
    const sum = r.summary();
    sum.status = kind === 'complete' ? 'completed' : 'game_over';
    sum.runId = r.runId; sum.playerId = this.sd.playerId; sum.name = this.sd.username; sum.date = Date.now();
    sum.submit = 'none';
    sum.groove = Object.assign({}, this.groove);
    let newBest = false;
    if (!this.practice) {
      this.accumulateTotals(r);
      const b = this.sd.best[sum.levelId];
      if (!b || sum.score > b.score || (sum.score === b.score && sum.time < b.time)) {
        this.sd.best[sum.levelId] = { score: sum.score, distance: sum.distance, time: sum.time, correct: sum.correct, incorrect: sum.incorrect, date: sum.date };
        newBest = true;
      }
      if (kind === 'complete') {
        this.sd.completed[sum.levelId] = true;
        // secret coins only count when the level is finished (they are kept for good after that)
        const got = (this.sd.secrets = this.sd.secrets || {});
        const prev = got[sum.levelId] || [];
        const merged = (sum.secrets || []).map((v, i) => (v || prev[i] ? 1 : 0));
        const before = prev.reduce((a, b) => a + (b ? 1 : 0), 0);
        got[sum.levelId] = merged;
        sum.secretsNew = merged.reduce((a, b) => a + b, 0) - before;
        if (sum.hardcore) (this.sd.hardcoreDone = this.sd.hardcoreDone || {})[sum.levelId] = true;
        this.checkSecretUnlocks();
      }
      this.sd.history.unshift(sum);
      this.sd.history = this.sd.history.slice(0, 60);
    } else if (kind === 'complete') { this.sd.tutorialDone = true; }
    this.persist();
    r.record = sum;
    r.newBest = newBest;
    this.pending = { t: kind === 'complete' ? 0.9 : 0.5, fn: () => { this.ui.hideHud(); this.ui.showResults(sum, kind, r, this.practice); } };
  }

  // ------------------------------------------------------------------ submission
  async submitScore(record, displayName) {
    const name = sanitizeName(displayName);
    if (!validName(name)) return { ok: false, error: 'Please enter a display name (1–16 characters).' };
    if (record.submit === 'sent') return { ok: false, code: 'duplicate', error: 'This run was already submitted.' };
    if (this.inflight && this.inflight === record.runId) return { ok: false, code: 'busy', error: 'Submission already in progress.' };
    this.sd.username = name; record.name = name;
    this.inflight = record.runId;
    try {
      if (!lb.configured) {
        record.submit = 'pending'; record.error = 'not_configured';
        this.persist();
        return { ok: true, queued: true, reason: 'not_configured' };
      }
      const run = this.run && this.run.runId === record.runId ? this.run : null;
      let token = run ? run.sessionToken : record.sessionToken;
      if (!token && run && run.tokenPromise) { await run.tokenPromise; token = run.sessionToken; }
      record.sessionToken = token || null;
      const payload = {
        player_id: record.playerId, run_id: record.runId, session_token: token, level_id: record.levelId, display_name: name,
        score: record.score, progress_percent: record.progress, furthest_distance: record.distance, active_play_time: record.time,
        correct_answers: record.correct, incorrect_answers: record.incorrect, coins_collected: record.coins, lives_remaining: record.lives, completion_status: record.status,
      };
      const res = await lb.submitRun(payload);
      if (res.ok) {
        record.submit = 'sent'; record.result = res.data; record.error = null; this.persist();
        return { ok: true, data: res.data };
      }
      record.error = res.code;
      record.submit = res.code === 'rejected' ? 'rejected' : 'pending';
      this.persist();
      return { ok: false, code: res.code, error: res.error, retry: res.code !== 'rejected' };
    } finally { this.inflight = null; }
  }
  pendingRuns() { return this.sd.history.filter((h) => h.submit === 'pending'); }
}

export { TRACKS, BACKGROUNDS, SKINS, proveCompletable };
