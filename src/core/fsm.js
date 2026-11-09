// Explicit game state machine. Every transition is validated; illegal ones are rejected and logged.
export const S = {
  MAIN_MENU: 'MAIN_MENU', LEVEL_SELECT: 'LEVEL_SELECT', SETTINGS: 'SETTINGS', TUTORIAL: 'TUTORIAL',
  COUNTDOWN: 'COUNTDOWN', PLAYING: 'PLAYING', PAUSED: 'PAUSED', TRIVIA: 'TRIVIA', TRIVIA_RESULT: 'TRIVIA_RESULT',
  RESPAWNING: 'RESPAWNING', GAME_OVER: 'GAME_OVER', LEVEL_COMPLETE: 'LEVEL_COMPLETE',
  SCORE_SUBMISSION: 'SCORE_SUBMISSION', GLOBAL_LEADERBOARD: 'GLOBAL_LEADERBOARD',
};

const MENU = [S.MAIN_MENU, S.LEVEL_SELECT, S.SETTINGS, S.TUTORIAL, S.GLOBAL_LEADERBOARD];
const T = {
  [S.MAIN_MENU]: [...MENU, S.COUNTDOWN],
  [S.LEVEL_SELECT]: [...MENU, S.COUNTDOWN],
  [S.SETTINGS]: [...MENU],
  [S.TUTORIAL]: [...MENU, S.COUNTDOWN],
  [S.GLOBAL_LEADERBOARD]: [...MENU, S.GAME_OVER, S.LEVEL_COMPLETE],
  [S.COUNTDOWN]: [S.PLAYING, S.PAUSED, S.MAIN_MENU],
  [S.PLAYING]: [S.PAUSED, S.TRIVIA, S.RESPAWNING, S.GAME_OVER, S.LEVEL_COMPLETE],
  [S.PAUSED]: [S.PLAYING, S.COUNTDOWN, S.MAIN_MENU, S.LEVEL_SELECT],
  [S.TRIVIA]: [S.TRIVIA_RESULT],
  [S.TRIVIA_RESULT]: [S.PLAYING, S.GAME_OVER],
  [S.RESPAWNING]: [S.COUNTDOWN, S.GAME_OVER],
  [S.GAME_OVER]: [S.SCORE_SUBMISSION, S.GLOBAL_LEADERBOARD, S.COUNTDOWN, S.MAIN_MENU, S.LEVEL_SELECT],
  [S.LEVEL_COMPLETE]: [S.SCORE_SUBMISSION, S.GLOBAL_LEADERBOARD, S.COUNTDOWN, S.MAIN_MENU, S.LEVEL_SELECT],
  [S.SCORE_SUBMISSION]: [S.GAME_OVER, S.LEVEL_COMPLETE, S.GLOBAL_LEADERBOARD, S.MAIN_MENU, S.COUNTDOWN],
};

export class FSM {
  constructor(initial = S.MAIN_MENU) {
    this.state = initial;
    this.prev = null;
    this.listeners = [];
    this.log = [];
    this.rejected = [];
    this.locked = false;
  }
  on(fn) { this.listeners.push(fn); }
  is(...s) { return s.includes(this.state); }
  can(next) { return (T[this.state] || []).includes(next); }
  go(next, why = '') {
    if (next === this.state) return false;
    if (!this.can(next)) {
      this.rejected.push(`${this.state}->${next} ${why}`);
      if (this.rejected.length > 50) this.rejected.shift();
      console.warn(`[FSM] illegal transition ${this.state} -> ${next} ${why}`);
      return false;
    }
    this.prev = this.state;
    this.state = next;
    this.log.push(`${this.prev}->${next}${why ? ' (' + why + ')' : ''}`);
    if (this.log.length > 200) this.log.shift();
    for (const fn of this.listeners) fn(next, this.prev, why);
    return true;
  }
}
