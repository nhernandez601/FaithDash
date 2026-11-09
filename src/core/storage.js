// Local persistence (settings + personal progress). Works without internet. Never stores global scores.
import { uuid } from './util.js';

const KEY = 'faithdash.save.v1';
export const SKINS_FREE = ['radiant', 'guardian', 'crimson'];

export const defaults = () => ({
  v: 1,
  playerId: uuid(), // persistent anonymous ID (not the display name)
  username: '',
  skin: 'radiant',
  unlocked: [...SKINS_FREE],
  song: 0,
  bg: 0,
  completed: {}, // levelId -> true
  best: {}, // levelId -> { score, distance, time, correct, incorrect, date }
  totals: { correct: 0, incorrect: 0, runs: 0, coins: 0, playTime: 0, distance: 0, deaths: 0 },
  tutorialDone: false,
  audio: { music: 0.7, sfx: 0.8, muted: false, cues: true },
  quality: 'auto', // auto | 1080 | 1440 | 2160
  reduced: false,
  pending: [], // completed runs waiting for submission / already submitted
  history: [],
});

let memory = null;
let hasLS = true;
function lsGet() { try { return localStorage.getItem(KEY); } catch { hasLS = false; return null; } }
function lsSet(v) { try { localStorage.setItem(KEY, v); } catch { hasLS = false; } }

export const store = {
  data: null,
  load() {
    let d = null;
    try { const raw = lsGet(); if (raw) d = JSON.parse(raw); } catch { d = null; }
    const base = defaults();
    this.data = d && d.v === 1 ? deepMerge(base, d) : base;
    this.data.unlocked = [...new Set([...SKINS_FREE, ...this.data.unlocked])];
    this.save();
    return this.data;
  },
  save() { lsSet(JSON.stringify(this.data)); },
  persistent() { return hasLS; },
  reset() { this.data = defaults(); this.save(); },
};

function deepMerge(base, src) {
  for (const k of Object.keys(src)) {
    if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) deepMerge(base[k], src[k]);
    else base[k] = src[k];
  }
  return base;
}
