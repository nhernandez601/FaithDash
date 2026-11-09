// Faith Dash audio: the three real songs (Arcade Drop, Arcade Boss Battle, Intense Section) + sound effects + three synthesized fall-back tracks.
// The songs play through Web Audio and the AUDIO CLOCK is the master clock of the game: the simulation is advanced to wherever
// the music currently is (see songTime()), so the two can never drift apart. Seconds into a song == seconds into the level.
// The synthesized tracks (used for the practice run, or if a song cannot be loaded) run from the simulation clock instead.
import { hash } from '../render/pen.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export const TRACKS = [
  { id: 'sunrise', name: 'Radiant Skies', style: 'Melodic dubstep' },
  { id: 'pixel', name: 'Desert Beat', style: 'Heavy wobble dubstep' },
  { id: 'cathedral', name: 'Aurora Drive', style: 'Riddim dubstep' },
];

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.settings = { music: 0.7, sfx: 0.8, muted: false, cues: true, syncMs: 0 };
    this.mode = 'synth'; // 'song' | 'synth'
    this.songUrls = {}; this.songBuf = {}; this.songLoading = {}; this.songFailed = {};
    this.song = null; this.src = null;
    this.bus = null;
    this.playing = false;
    this.track = 0; this.bpm = 120; this.stepDur = 0.125;
    this.epoch = 0; this.nextStep = 0;
    this.cues = []; this.cueIdx = 0;
    this.previewTimer = null; this.previewing = false;
    this.available = typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
    this.log = []; // for tests: scheduled music steps count etc.
    this.stats = { stepsScheduled: 0, cuesScheduled: 0, resumes: 0, pauses: 0, resyncs: 0 };
  }
  // Must be called from a user gesture (mobile browsers).
  unlock() {
    if (!this.available) return false;
    if (!this.ctx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC({ latencyHint: 'interactive' });
        this.master = this.ctx.createGain();
        this.musicGain = this.ctx.createGain();
        this.sfxGain = this.ctx.createGain();
        const comp = this.ctx.createDynamicsCompressor();
        this.musicGain.connect(this.master); this.sfxGain.connect(this.master);
        this.master.connect(comp); comp.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        // soft-clipping curve: gives the bass its growl without the harshness of hard clipping
        const CN = 1024; this.driveCurve = new Float32Array(CN);
        for (let i = 0; i < CN; i++) { const x = (i * 2) / CN - 1, k2 = 9; this.driveCurve[i] = ((1 + k2) * x) / (1 + k2 * Math.abs(x)); }
        this.ctx.onstatechange = () => { this.state = this.ctx.state; };
        this.applyVolumes();
      } catch (e) { this.available = false; this.ctx = null; return false; }
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    return true;
  }
  get running() { return !!this.ctx && this.ctx.state === 'running'; }
  now() { return this.ctx ? this.ctx.currentTime : 0; }
  applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings, t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.muted ? 0 : 1, t, 0.02);
    this.musicGain.gain.setTargetAtTime(s.music * 0.9, t, 0.02);
    this.sfxGain.gain.setTargetAtTime(s.sfx, t, 0.02);
  }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }
  wake() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); }

  // ---------- synth helpers ----------
  osc(type, freq, t, dur, vol, o = {}) {
    const c = this.ctx, dest = o.dest || this.bus || this.sfxGain;
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.slideTo), t + dur);
    if (o.detune) osc.detune.value = o.detune;
    const a = o.attack || 0.004, r = o.release || Math.min(0.12, dur * 0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.setValueAtTime(vol, Math.max(t + a, t + dur - r));
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (o.filter) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.filter; osc.connect(f); node = f; }
    node.connect(g); g.connect(dest);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  noise(t, dur, vol, o = {}) {
    const c = this.ctx, dest = o.dest || this.bus || this.sfxGain;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = o.type || 'highpass'; f.frequency.setValueAtTime(o.freq || 6000, t);
    if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }
  kick(t, v = 0.55) { this.osc('sine', 150, t, 0.14, v, { slideTo: 42, attack: 0.001, release: 0.05 }); }
  snare(t, v = 0.25) { this.noise(t, 0.14, v, { type: 'bandpass', freq: 1800 }); this.osc('triangle', 190, t, 0.09, v * 0.6, { slideTo: 110 }); }
  hat(t, v = 0.07, open = false) { this.noise(t, open ? 0.16 : 0.045, v, { freq: 7500 }); }

  // ---------- dubstep voices ----------
  // The signature wobble: two detuned saws (a "reese") pushed through a resonant low-pass whose cutoff is swung by an
  // LFO, then soft-clipped for growl. `rate` is wobbles per second, so the rhythm comes from the LFO, not from
  // retriggering notes — which is why one wobble can hold for half a bar and still groove.
  wob(freq, t, dur, rate, o = {}) {
    const c = this.ctx, dest = o.dest || this.bus || this.sfxGain;
    const g = c.createGain(), f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(o.mid || 420, t);
    f.Q.value = o.q == null ? 11 : o.q;
    const lfo = c.createOscillator(), lg = c.createGain();
    lfo.type = o.shape || 'sine';
    lfo.frequency.setValueAtTime(rate, t);
    if (o.rateTo) lfo.frequency.linearRampToValueAtTime(o.rateTo, t + dur);
    lg.gain.value = o.depth == null ? 760 : o.depth;
    lfo.connect(lg); lg.connect(f.frequency);
    const shaper = c.createWaveShaper();
    shaper.curve = this.driveCurve;
    const oscs = [];
    for (const dt of (o.detunes || [-11, 11])) {
      const osc = c.createOscillator();
      osc.type = o.type || 'sawtooth';
      osc.frequency.setValueAtTime(freq, t);
      osc.detune.value = dt;
      osc.connect(f);
      oscs.push(osc);
    }
    f.connect(shaper); shaper.connect(g); g.connect(dest);
    const vol = o.vol == null ? 0.1 : o.vol, a = o.attack || 0.012;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.setValueAtTime(vol, Math.max(t + a + 0.001, t + dur - 0.05));
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    lfo.start(t); lfo.stop(t + dur + 0.05);
    for (const osc of oscs) { osc.start(t); osc.stop(t + dur + 0.05); }
  }
  // The sub: a clean low sine under the wobble. This is what you feel rather than hear.
  sub(freq, t, dur, v = 0.22) { this.osc('sine', freq, t, dur, v, { attack: 0.012, release: Math.min(0.09, dur * 0.3) }); }
  // Half-time kit. Dubstep sits on a slow kick/snare skeleton even at a fast tempo, which is what gives it the swagger.
  dsKick(t, v = 0.62) {
    this.osc('sine', 190, t, 0.26, v, { slideTo: 36, attack: 0.001, release: 0.1 });
    this.noise(t, 0.02, v * 0.3, { freq: 2200 });
  }
  dsSnare(t, v = 0.34) {
    this.noise(t, 0.2, v, { type: 'bandpass', freq: 1500 });
    this.noise(t, 0.06, v * 0.7, { freq: 4200 });
    this.osc('triangle', 210, t, 0.11, v * 0.5, { slideTo: 130 });
  }
  // Build-up riser into a drop, and the impact that lands on it.
  riser(t, dur, v = 0.07) {
    this.noise(t, dur, v, { type: 'bandpass', freq: 400, sweepTo: 7000 });
    this.osc('sawtooth', 220, t, dur, v * 0.5, { slideTo: 1760, filter: 3000, attack: dur * 0.6 });
  }
  impact(t, v = 0.3) {
    this.osc('sine', 120, t, 0.7, v, { slideTo: 32, attack: 0.001, release: 0.4 });
    this.noise(t, 0.5, v * 0.45, { type: 'lowpass', freq: 6000, sweepTo: 300 });
  }

  // ---------- sound effects ----------
  sfx(name) {
    if (!this.running || this.settings.muted) return;
    const c = this.ctx, t = c.currentTime + 0.005;
    const arp = (notes, step, type = 'triangle', vol = 0.13, dur = 0.16) => notes.forEach((m, i) => this.osc(type, mtof(m), t + i * step, dur, vol));
    switch (name) {
      case 'jump': this.osc('square', 420, t, 0.12, 0.05, { slideTo: 860 }); break;
      case 'coin': this.osc('sine', 988, t, 0.09, 0.16); this.osc('sine', 1319, t + 0.07, 0.22, 0.16); this.osc('triangle', 2637, t + 0.07, 0.15, 0.04); break;
      case 'correct': arp([72, 76, 79, 84], 0.09, 'triangle', 0.16, 0.2); this.osc('sine', mtof(96), t + 0.36, 0.4, 0.05); break;
      case 'wrong': this.osc('sawtooth', 196, t, 0.45, 0.14, { slideTo: 98, filter: 900 }); this.osc('square', 147, t + 0.05, 0.35, 0.06, { slideTo: 80, filter: 600 }); break;
      case 'hit': this.noise(t, 0.28, 0.35, { type: 'lowpass', freq: 3000, sweepTo: 200 }); this.osc('sine', 130, t, 0.3, 0.3, { slideTo: 38 }); break;
      case 'shield': this.osc('sine', 400, t, 0.4, 0.1, { slideTo: 1300 }); this.osc('triangle', 800, t + 0.1, 0.3, 0.05, { slideTo: 2000 }); break;
      case 'checkpoint': arp([76, 83], 0.1, 'sine', 0.12, 0.25); break;
      case 'orb': arp([79, 83, 88], 0.07, 'triangle', 0.14, 0.2); break;
      case 'double': this.osc('square', 620, t, 0.14, 0.05, { slideTo: 1400 }); this.osc('sine', 1568, t + 0.05, 0.12, 0.06); break;
      case 'portal': this.osc('sawtooth', 220, t, 0.5, 0.07, { slideTo: 880, filter: 1400 }); this.osc('sine', 660, t + 0.1, 0.4, 0.07, { slideTo: 1760 }); break;
      case 'tick': this.osc('sine', 660, t, 0.09, 0.14); break;
      case 'perfect': this.osc('sine', 1568, t, 0.09, 0.08); this.osc('triangle', 2093, t + 0.03, 0.14, 0.05); break;
      case 'great': this.osc('sine', 1175, t, 0.08, 0.06); break;
      case 'go': this.osc('sine', 880, t, 0.35, 0.16); this.osc('triangle', 1320, t, 0.3, 0.07); break;
      case 'click': this.osc('sine', 520, t, 0.05, 0.08); break;
      case 'back': this.osc('sine', 380, t, 0.06, 0.08); break;
      case 'select': this.osc('triangle', 620, t, 0.07, 0.09); this.osc('triangle', 780, t + 0.05, 0.08, 0.07); break;
      case 'unlock': arp([67, 71, 74, 79, 83, 86], 0.09, 'triangle', 0.14, 0.25); break;
      case 'finish': arp([60, 64, 67, 72, 76, 79, 84], 0.1, 'triangle', 0.15, 0.3); break;
      case 'gameover': arp([67, 64, 60, 55], 0.18, 'sawtooth', 0.07, 0.35); break;
      case 'submit': arp([72, 79], 0.1, 'sine', 0.14, 0.25); break;
      default: break;
    }
  }

  // ---------- music transport (shared simulation clock) ----------
  _newBus() {
    if (this.bus) this._killBus(this.bus);
    this.bus = this.ctx.createGain();
    this.bus.gain.value = 1;
    this.bus.connect(this.musicGain);
  }
  _killBus(b) {
    try {
      const t = this.ctx.currentTime;
      b.gain.cancelScheduledValues(t); b.gain.setValueAtTime(b.gain.value, t); b.gain.linearRampToValueAtTime(0, t + 0.04);
      setTimeout(() => { try { b.disconnect(); } catch { /* already gone */ } }, 120);
    } catch { /* ignore */ }
  }
  // Begin (or seek to) simTime. `cues` = [{t, hard}] jump cue timeline.
  startMusic(trackIdx, bpm, simTime, cues = []) {
    if (!this.running) { this.playing = false; this.pending = { trackIdx, bpm, simTime, cues }; return false; }
    this.stopMusic();
    this.mode = 'synth';
    this.track = trackIdx; this.bpm = bpm; this.stepDur = 60 / bpm / 4; this.cues = cues;
    this._newBus();
    this._seek(simTime);
    this.playing = true;
    return true;
  }
  _seek(simTime) {
    this.epoch = this.ctx.currentTime - simTime + 0.06;
    this.nextStep = Math.ceil(simTime / this.stepDur - 1e-6);
    this.cueIdx = this.cues.findIndex((c) => c.t >= simTime - 0.02);
    if (this.cueIdx < 0) this.cueIdx = this.cues.length;
  }
  pauseMusic() {
    if (!this.ctx || !this.playing) return;
    this.playing = false; this.stats.pauses++;
    this._stopSrc();
    if (this.bus) { this._killBus(this.bus); this.bus = null; }
  }
  resumeMusic(simTime) {
    if (!this.ctx || this.playing || this.previewing) return;
    this.wake();
    this._newBus();
    if (this.mode === 'song' && this.songBuf[this.song]) this._seekSong(simTime); else this._seek(simTime);
    this.playing = true; this.stats.resumes++;
  }
  stopMusic() {
    this.playing = false;
    this._stopSrc();
    if (this.bus) { this._killBus(this.bus); this.bus = null; }
  }

  // ---------- real songs ----------
  setSongUrls(map) { this.songUrls = Object.assign(this.songUrls, map); }
  songReady(id) { return !!this.songBuf[id]; }
  songLoadState(id) { return this.songBuf[id] ? 'ready' : this.songLoading[id] ? 'loading' : this.songFailed[id] ? 'failed' : 'idle'; }
  // Download + decode a song (needs the audio context, so call it after a user gesture). Safe to call repeatedly.
  loadSong(id) {
    if (this.songBuf[id]) return Promise.resolve(true);
    if (this.songLoading[id]) return this.songLoading[id];
    if (!this.ctx || !this.songUrls[id]) return Promise.resolve(false);
    delete this.songFailed[id];
    const job = (async () => {
      try {
        const res = await fetch(this.songUrls[id]);
        const ab = await res.arrayBuffer();
        this.songBuf[id] = await new Promise((ok, no) => { const p = this.ctx.decodeAudioData(ab, ok, no); if (p && p.catch) p.catch(no); });
        return true;
      } catch (e) { this.songFailed[id] = String((e && e.message) || e); return false; } finally { delete this.songLoading[id]; }
    })();
    this.songLoading[id] = job;
    return job;
  }
  // A decoded song is ~80 MB of memory, so keep only the one in use.
  releaseSongsExcept(keep) { for (const k of Object.keys(this.songBuf)) if (k !== keep) delete this.songBuf[k]; }
  // True while a real song is the clock master.
  get songActive() { return this.mode === 'song' && this.playing && this.running; }
  // How long the sound takes to reach the player's ears. Browsers report it; the Settings slider fine-tunes it.
  latency() { const c = this.ctx; if (!c) return 0; const l = c.outputLatency > 0 ? c.outputLatency : c.baseLatency || 0; return Math.min(0.4, l); }
  // The position (in seconds) of the song the player is hearing right now == the level time the game should show.
  songTime() { return this.ctx.currentTime - this.epoch - this.latency() - (this.settings.syncMs || 0) / 1000; }
  startSong(id, simTime, cues = []) {
    if (!this.running || !this.songBuf[id]) return false;
    this.stopMusic();
    this.mode = 'song'; this.song = id; this.cues = cues;
    this._newBus();
    this._seekSong(simTime);
    this.playing = true;
    return true;
  }
  _seekSong(simTime) {
    const ctx = this.ctx, buf = this.songBuf[this.song];
    this._stopSrc();
    const when = ctx.currentTime + 0.05;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(this.bus);
    const off = Math.min(Math.max(0, simTime), buf.duration - 0.01);
    src.start(when, off);
    this.src = src;
    this.epoch = when - off; // context time at which "song time 0" would have been
    this.cueIdx = this.cues.findIndex((c) => c.t >= simTime - 0.02);
    if (this.cueIdx < 0) this.cueIdx = this.cues.length;
  }
  _stopSrc(after = 0.05) {
    const s = this.src;
    if (!s) return;
    this.src = null;
    try { s.onended = null; s.stop(this.ctx.currentTime + after); } catch { /* already stopped */ }
    setTimeout(() => { try { s.disconnect(); } catch { /* gone */ } }, (after + 0.2) * 1000);
  }
  // The sim fell too far behind the music (a long hitch): jump the music back to where the game is.
  resync(simTime) {
    if (!this.ctx || this.mode !== 'song' || !this.playing) return;
    this.stats.resyncs++;
    this._newBus(); this._seekSong(simTime);
  }
  // Short preview of a song from `from` seconds (Music Select screen).
  async previewSong(id, from = 0, len = 26) {
    if (!this.unlock() || !this.running) return false;
    this.stopPreview(); this.stopMusic();
    if (!(await this.loadSong(id))) return false;
    this.cues = []; this.cueIdx = 0;
    this.previewing = true;
    this.startSong(id, from, []);
    this.previewTimer = setTimeout(() => this.stopPreview(), len * 1000);
    return true;
  }
  _cues() {
    const now = this.ctx.currentTime;
    if (this.settings.cues) {
      while (this.cueIdx < this.cues.length) {
        const c = this.cues[this.cueIdx];
        const at = this.epoch + c.t;
        if (at - 0.3 > now + 0.22) break;
        if (at >= now - 0.03) {
          this.osc('sine', c.hard ? 1568 : 1175, at, 0.05, 0.12, { dest: this.bus });
          if (c.hard) this.osc('triangle', 392, at - 0.28, 0.28, 0.05, { slideTo: 1400, dest: this.bus });
          this.stats.cuesScheduled++;
        }
        this.cueIdx++;
      }
    }
  }
  // Call every frame while the game is PLAYING.
  update(simTime) {
    if (!this.ctx || !this.playing || !this.running) return;
    if (this.mode === 'song') { this._cues(); return; }
    const now = this.ctx.currentTime;
    // gentle drift correction so audio and gameplay never separate
    const err = now - simTime + 0.06 - this.epoch;
    if (Math.abs(err) > 0.012) this.epoch += err * 0.05;
    while (true) {
      const at = this.epoch + this.nextStep * this.stepDur;
      if (at > now + 0.22) break;
      if (at >= now - 0.04) { this._step(this.track, this.nextStep, at); this.stats.stepsScheduled++; }
      this.nextStep++;
    }
    this._cues();
  }
  fadeOutMusic(sec = 0.8) {
    if (!this.ctx || !this.bus) { this.playing = false; return; }
    const b = this.bus, t = this.ctx.currentTime;
    b.gain.cancelScheduledValues(t); b.gain.setValueAtTime(b.gain.value, t); b.gain.linearRampToValueAtTime(0, t + sec);
    this._stopSrc(sec + 0.05);
    this.playing = false; this.bus = null;
    setTimeout(() => { try { b.disconnect(); } catch { /* ignore */ } }, sec * 1000 + 100);
  }

  // ---------- menu preview ----------
  preview(trackIdx, bpm = 120) {
    if (!this.unlock() || !this.running) return false;
    this.stopPreview();
    this.stopMusic();
    this.mode = 'synth';
    this.track = trackIdx; this.bpm = bpm; this.stepDur = 60 / bpm / 4; this.cues = []; this.cueIdx = 0;
    this._newBus();
    this.pvT0 = this.ctx.currentTime;
    this.epoch = this.pvT0 + 0.05; this.nextStep = 0;
    this.playing = true; this.previewing = true;
    this.previewTimer = setInterval(() => {
      this.update(this.ctx.currentTime - this.pvT0);
      if (this.ctx.currentTime - this.pvT0 > 24) this.stopPreview();
    }, 50);
    return true;
  }
  stopPreview() {
    if (this.previewTimer) { clearInterval(this.previewTimer); clearTimeout(this.previewTimer); this.previewTimer = null; }
    if (this.previewing) { this.previewing = false; this.stopMusic(); }
  }

  // ---------- the three tracks ----------
  _step(track, step, at) {
    const bar = Math.floor(step / 16), s = step % 16, sd = this.stepDur, beat = sd * 4;
    if (track === 0) this._sunrise(bar, s, at, sd, beat);
    else if (track === 1) this._pixel(bar, s, at, sd, beat);
    else this._cathedral(bar, s, at, sd, beat);
  }
  // Each track runs an 8-bar cycle: four bars of groove, a one-bar build, then a three-bar drop where the wobble
  // doubles in speed and the sub opens up. `q` is the quarter-note wobble rate in wobbles per second.
  _sunrise(bar, s, at, sd, beat) {
    const roots = [36, 31, 33, 29], minor = [true, false, true, false];
    const root = roots[bar % 4], ch = minor[bar % 4] ? [0, 3, 7] : [0, 4, 7];
    const q = 1 / beat, phase = bar % 8, drop = phase >= 5, build = phase === 4;
    // half-time skeleton: kick on 1, snare on 3
    if (s === 0) this.dsKick(at, 0.46);
    if (s === 8) this.dsSnare(at, 0.26);
    if (s === 11 && drop) this.dsKick(at, 0.3);
    if (s % 4 === 2) this.hat(at, 0.04, s === 14);
    // sub + wobble bass
    if (s === 0 || s === 8) {
      this.sub(mtof(root), at, sd * 8, drop ? 0.2 : 0.15);
      this.wob(mtof(root + 12), at, sd * 7.6, drop ? q * 2 : q, { vol: drop ? 0.085 : 0.062, depth: drop ? 1100 : 700, mid: drop ? 520 : 380 });
    }
    // airy supersaw chord on the off-beats
    if (s === 4 || s === 12) ch.forEach((n) => [-9, 9].forEach((dt) => this.osc('sawtooth', mtof(root + 24 + n), at, sd * 2.6, 0.022, { filter: 2600, detune: dt, attack: 0.03 })));
    // bright lead over the drop
    if (drop && [0, 3, 6, 10, 13].includes(s)) {
      const pent = [0, 3, 5, 7, 10];
      const n = root + 36 + pent[Math.floor(hash(bar * 17 + s) * 5)];
      this.osc('triangle', mtof(n), at, sd * 2.2, 0.055, { filter: 4200 });
      this.osc('sine', mtof(n + 12), at, sd * 1.4, 0.018);
    }
    if (build && s === 0) this.riser(at, sd * 16, 0.07);
    if (phase === 5 && s === 0) this.impact(at, 0.22);
  }
  _pixel(bar, s, at, sd, beat) {
    const roots = [33, 29, 36, 31], minor = [true, true, false, false];
    const root = roots[bar % 4], ch = minor[bar % 4] ? [0, 3, 7] : [0, 4, 7];
    const q = 1 / beat, phase = bar % 8, drop = phase >= 5, build = phase === 4;
    if (s === 0) this.dsKick(at, 0.48);
    if (s === 8) this.dsSnare(at, 0.28);
    if ((s === 6 || s === 14) && drop) this.dsKick(at, 0.26);
    if (s % 2 === 0) this.hat(at, 0.038, s === 14);
    // the heavy one: a square LFO chops the bass into a hard gate, and it doubles up through the drop
    if (s === 0 || s === 8) {
      const rate = drop ? q * 4 : phase % 2 ? q * 2 : q;
      this.sub(mtof(root), at, sd * 8, 0.19);
      this.wob(mtof(root + 12), at, sd * 7.6, rate, {
        vol: drop ? 0.092 : 0.072, depth: 1250, mid: 460, q: 14,
        shape: drop ? 'square' : 'sine', detunes: [-16, 0, 16],
      });
    }
    // a second wobble an octave up, sweeping its own speed, for the classic talking-bass effect
    if (drop && s === 4) this.wob(mtof(root + 24), at, sd * 4, q * 2, { vol: 0.042, rateTo: q * 6, depth: 1500, mid: 700, shape: 'triangle' });
    if (s === 12 && !drop) ch.forEach((n) => this.osc('square', mtof(root + 24 + n), at, sd * 1.4, 0.022, { filter: 2200 }));
    if (build) { if (s === 0) this.riser(at, sd * 16, 0.08); if (s % 2 === 0) this.hat(at, 0.03 + s * 0.004); }
    if (phase === 5 && s === 0) this.impact(at, 0.24);
  }
  _cathedral(bar, s, at, sd, beat) {
    const roots = [38, 34, 41, 36], minor = [true, false, false, true];
    const root = roots[bar % 4], ch = minor[bar % 4] ? [0, 3, 7] : [0, 4, 7];
    const q = 1 / beat, phase = bar % 8, drop = phase >= 5, build = phase === 4;
    // riddim: short, hard bass stabs on a fixed pattern instead of one long wobble — sparse and very rhythmic
    const STAB = [0, 3, 6, 8, 11, 14];
    if (s === 0) this.dsKick(at, 0.46);
    if (s === 8) this.dsSnare(at, 0.25);
    if (s % 4 === 2) this.hat(at, 0.032);
    if (s === 0) this.sub(mtof(root), at, sd * 16, drop ? 0.2 : 0.15);
    if (STAB.includes(s) && (drop || s % 8 === 0)) {
      this.wob(mtof(root + 12), at, sd * (s === 0 || s === 8 ? 2.6 : 1.7), q * 2, {
        vol: drop ? 0.088 : 0.066, depth: 1000, mid: 400, q: 13, attack: 0.006,
      });
    }
    // glassy pad over the top for the aurora shimmer
    if (s === 0) ch.forEach((n) => [-7, 7].forEach((dt) => this.osc('sawtooth', mtof(root + 12 + n), at, sd * 15.5, 0.017, { attack: 0.5, release: 0.6, filter: 1300, detune: dt })));
    if (drop && [2, 7, 13].includes(s) && hash(bar * 5 + s) > 0.35) {
      const n = root + 36 + ch[Math.floor(hash(bar + s * 3) * 3)];
      this.osc('sine', mtof(n), at, beat * 1.4, 0.045, { attack: 0.004, release: beat * 1.2 });
    }
    if (build && s === 0) this.riser(at, sd * 16, 0.065);
    if (phase === 5 && s === 0) this.impact(at, 0.21);
  }
}

export const audio = new AudioEngine();
