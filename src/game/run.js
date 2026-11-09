// One play-through of a level: lives, trivia, invincibility, scoring and statistics.
// Pure logic (no DOM, no audio) so it can be unit-tested headlessly.
import { step, newPlayer, DT, EV, INV_TIME, FALL_Y, resetPickups } from './sim.js';

export const MAX_LIVES = 3;

export class Run {
  constructor({ level, bank, practice = false, rnd = Math.random, practiceQuestions = null, hardcore = false }) {
    this.level = level;
    this.bank = bank;
    this.practice = practice;
    this.practiceQuestions = practiceQuestions;
    this.rnd = rnd;
    this.p = newPlayer(level);
    this.lives = MAX_LIVES;
    this.acc = 0;
    this.pendingPress = false;
    this.activeTime = 0; // seconds of real gameplay (excludes menus, pause, trivia, countdowns)
    this.correct = 0;
    this.incorrect = 0;
    this.coinsCollected = 0;
    this.deaths = 0;
    this.usedQ = new Set();
    this.lastCorrectIdx = -1;
    this.sameCount = 0;
    this.trivia = null; // { question | empty, answered, selected, result }
    this.cpT = []; // world time recorded when each checkpoint was first crossed
    this.over = false; // game over reached
    this.completed = false;
    this.submittedKey = null;
    this.runId = null;
    this.startedAt = Date.now();
    this.practiceIdx = 0;
    // v6: Hardcore = any hit (or a wrong answer) restarts the level from the start; attempts are counted instead of lives.
    this.hardcore = !!hardcore && !practice;
    this.attempts = 1;
    this.secretsBest = 0; // most secret coins held at once in this run (shown on the results screen)
  }
  get secretsHeld() { let n = 0; const a = this.p.secretsGot; if (a) for (let i = 0; i < a.length; i++) n += a[i]; return n; }

  get progress() { return Math.min(100, (this.p.furthest / this.level.finishX) * 100); }
  get score() { return this.completed ? 100 : Math.floor(this.progress * 100) / 100; }
  get distance() { return Math.min(this.p.furthest, this.level.finishX); }
  get answered() { return this.correct + this.incorrect; }
  get invActive() { return this.p.t < this.p.invUntil; }

  press() { this.pendingPress = true; }
  // v6: whether the jump button is held down right now (the ship and the wave use it)
  setHold(v) { this.p.hold = !!v; }

  // ---- smooth drawing ----
  // The simulation moves in fixed 1/120 s steps, but the screen refreshes at its own rate (60, 90, 144 Hz...).
  // We keep the state from one step back so the picture can be drawn at the exact moment between two steps.
  keepPrev() { const p = this.p, q = this.prev || (this.prev = {}); q.x = p.x; q.y = p.y; q.rot = p.rot; q.t = p.t; q.ok = true; }
  dropPrev() { if (this.prev) this.prev.ok = false; }
  // Where to draw the runner at time `rt` (between the previous step and the current one). Writes into `out`.
  viewAt(rt, out) {
    const p = this.p, q = this.prev;
    out.x = p.x; out.y = p.y; out.rot = p.rot; out.t = p.t;
    if (!q || !q.ok || p.dead || p.finished || !(p.t > q.t)) return out;
    const a = Math.max(0, Math.min(1, (rt - q.t) / (p.t - q.t)));
    out.x = q.x + (p.x - q.x) * a; out.y = q.y + (p.y - q.y) * a; out.t = q.t + (p.t - q.t) * a;
    let dr = p.rot - q.rot; if (dr > Math.PI) dr -= 2 * Math.PI; else if (dr < -Math.PI) dr += 2 * Math.PI;
    out.rot = q.rot + dr * a;
    return out;
  }

  // Advance the simulation by real elapsed seconds. Returns high-level events.
  // The caller must only call this while the game state is PLAYING.
  advance(dtReal, cap = 0.1) {
    const out = [];
    if (this.over || this.completed || this.p.dead) return out;
    this.acc += Math.min(dtReal, cap);
    while (this.acc >= DT - 1e-9) {
      this.acc -= DT;
      this.keepPrev();
      const evs = step(this.level, this.p, DT, this.pendingPress);
      this.pendingPress = false;
      this.activeTime += DT;
      for (let i = 0; i < evs.length; i++) {
        const e = evs[i];
        if (e === EV.JUMP) out.push({ type: 'jump' });
        else if (e === EV.CHECKPOINT) { const idx = evs[++i]; this.cpT[idx] = this.p.t; out.push({ type: 'checkpoint', index: idx }); }
        else if (e === EV.COIN) { const idx = evs[++i]; this.coinsCollected++; out.push({ type: 'coin', index: idx }); }
        else if (e === EV.ORB) { const idx = evs[++i]; out.push({ type: 'orb', index: idx }); }
        else if (e === EV.PORTAL) { const idx = evs[++i]; out.push({ type: 'portal', index: idx, orient: this.p.orient }); }
        else if (e === EV.DOUBLE) out.push({ type: 'double' });
        else if (e === EV.DEAD) out.push({ type: 'dead', reason: this.p.deathReason });
        else if (e === EV.FINISH) { this.completed = true; out.push({ type: 'finish' }); }
        else if (e === EV.MODE) { const idx = evs[++i]; out.push({ type: 'mode', index: idx, mode: this.p.mode, grav: this.p.grav }); }
        else if (e === EV.SECRET) { const idx = evs[++i]; this.secretsBest = Math.max(this.secretsBest, this.secretsHeld); out.push({ type: 'secret', index: idx }); }
      }
      // stop the instant something needs the game to pause / change state
      if (out.some((o) => o.type === 'coin' || o.type === 'dead' || o.type === 'finish')) { this.acc = 0; break; }
    }
    return out;
  }

  // ---- damage ----
  // Called once per 'dead' event. Returns 'respawn' or 'gameover'.
  registerHit() {
    this.deaths++;
    if (this.hardcore) { this.attempts++; return 'restart'; }
    this.lives = Math.max(0, this.lives - 1);
    if (this.lives <= 0) { this.over = true; return 'gameover'; }
    return 'respawn';
  }
  respawn() {
    const p = this.p, lv = this.level;
    if (p.cpIndex >= 0) {
      const cp = lv.checkpoints[p.cpIndex];
      p.x = cp.x; p.y = cp.y; p.t = this.cpT[p.cpIndex] != null ? this.cpT[p.cpIndex] : cp.t;
    } else { p.x = 0; p.y = 0; p.t = 0; }
    p.vy = 0; p.grounded = true; p.standingOn = null; p.buffer = -1; p.coyote = 0.08;
    p.dead = false; p.deathReason = ''; p.invUntil = -1; p.rot = 0; p.hold = false;
    resetPickups(lv, p, p.cpIndex >= 0 ? lv.checkpoints[p.cpIndex].x : 0);
    this.acc = 0; this.pendingPress = false; this.dropPrev();
  }

  // v6 Hardcore: back to the very start (secret coins, coin gates and checkpoints all reset).
  restartFromStart() {
    const hold = this.p.hold;
    this.p = newPlayer(this.level);
    this.p.hold = false;
    this.cpT = []; this.acc = 0; this.pendingPress = false; this.trivia = null; this.over = false;
    this.dropPrev();
    void hold;
  }

  // ---- trivia ----
  beginTrivia() {
    if (this.trivia) return this.trivia; // never open twice
    let t;
    if (this.practice) {
      const q = this.practiceQuestions[this.practiceIdx++ % this.practiceQuestions.length];
      t = { question: q, answered: false, selected: -1, result: null, practice: true };
    } else {
      const r = this.bank.pick(this.level.id, this.usedQ, this.rnd, this.lastCorrectIdx, this.sameCount);
      if (r.empty) t = { empty: true, answered: true, selected: -1, result: null };
      else {
        t = { question: r.question, answered: false, selected: -1, result: null };
        if (r.question.correctIdx === this.lastCorrectIdx) this.sameCount++; else this.sameCount = 0;
        this.lastCorrectIdx = r.question.correctIdx;
      }
    }
    this.trivia = t;
    return t;
  }
  select(i) {
    const t = this.trivia;
    if (!t || t.answered || t.empty) return false;
    t.selected = i;
    return true;
  }
  // Submit the currently selected answer. Irreversible. Returns result or null.
  submit() {
    const t = this.trivia;
    if (!t || t.answered || t.empty || t.selected < 0) return null;
    t.answered = true;
    const ok = t.selected === t.question.correctIdx;
    const before = this.lives;
    if (this.hardcore) {
      // Hardcore has no lives: a right answer simply lets you through, a wrong one restarts the level
      if (ok) this.correct++; else { this.incorrect++; this.attempts++; }
      t.result = { correct: ok, livesBefore: before, livesAfter: before, correctIdx: t.question.correctIdx, selected: t.selected, gameOver: false, restart: !ok };
      return t.result;
    }
    if (ok) { this.lives = Math.min(MAX_LIVES, this.lives + 1); if (!t.practice) this.correct++; }
    else { this.lives = Math.max(0, this.lives - 1); if (!t.practice) this.incorrect++; }
    t.result = { correct: ok, livesBefore: before, livesAfter: this.lives, correctIdx: t.question.correctIdx, selected: t.selected, gameOver: this.lives <= 0 };
    if (this.lives <= 0) this.over = true;
    return t.result;
  }
  // Called when the player dismisses the trivia result. Returns 'gameover' or 'resume'.
  endTrivia() {
    const gameOver = this.over;
    const restart = this.trivia && this.trivia.result && this.trivia.result.restart;
    this.trivia = null;
    if (gameOver) return 'gameover';
    if (restart) return 'restart';
    this.p.invUntil = this.p.t + INV_TIME; // expires exactly INV_TIME of resumed play later
    this.acc = 0; this.pendingPress = false; this.dropPrev();
    return 'resume';
  }

  summary() {
    return {
      levelId: this.level.id, levelName: this.level.name,
      score: this.score, progress: Math.round(this.progress * 100) / 100,
      distance: Math.round(this.distance * 10) / 10, time: Math.round(this.activeTime * 100) / 100,
      correct: this.correct, incorrect: this.incorrect, answered: this.answered,
      coins: this.coinsCollected, completed: this.completed, lives: this.lives, deaths: this.deaths,
      secrets: Array.from(this.p.secretsGot || []), secretsTotal: (this.level.secrets || []).length,
      hardcore: this.hardcore, attempts: this.attempts,
    };
  }
}
