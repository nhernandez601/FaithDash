// Bible trivia question bank: creator-approved questions only. Nothing is ever invented by the game.
import seed from '../data/questions.js';
import { uuid, seededShuffle } from './util.js';

const KEY = 'faithdash.bank.v1';
export const DIFFS = ['easy', 'medium', 'hard'];
const PREFER = { 1: ['easy', 'medium'], 2: ['medium', 'easy', 'hard'], 3: ['hard', 'medium'] };

let state = { seedVersion: 0, items: [] };

function lsGet() { try { return localStorage.getItem(KEY); } catch { return null; } }
function lsSet(v) { try { localStorage.setItem(KEY, v); } catch { /* storage unavailable: bank lives in memory only */ } }

export function normalizeQ(q) {
  return {
    id: q.id || uuid(),
    q: String(q.q || '').trim(),
    correct: String(q.correct || '').trim(),
    wrong: (q.wrong || []).map((w) => String(w || '').trim()),
    ref: String(q.ref || '').trim(),
    expl: String(q.expl || '').trim(),
    difficulty: DIFFS.includes(q.difficulty) ? q.difficulty : 'medium',
    levels: Array.isArray(q.levels) ? q.levels.filter((n) => [1, 2, 3].includes(n)) : [],
  };
}
export function validateQ(q) {
  const e = [];
  if (!q.q) e.push('Question text is required.');
  if (!q.correct) e.push('Correct answer is required.');
  if (!Array.isArray(q.wrong) || q.wrong.length !== 3) e.push('Exactly three incorrect answers are required.');
  else {
    if (q.wrong.some((w) => !w)) e.push('All three incorrect answers must be filled in.');
    const all = [q.correct, ...q.wrong].map((s) => s.toLowerCase());
    if (new Set(all).size !== all.length) e.push('All four answers must be different.');
  }
  return e;
}

export const bank = {
  load() {
    let loaded = null;
    try { const raw = lsGet(); if (raw) loaded = JSON.parse(raw); } catch { loaded = null; }
    if (loaded && Array.isArray(loaded.items)) state = loaded; else state = { seedVersion: 0, items: [] };
    // merge newly shipped approved questions (by id) when the bundled bank version increases
    if ((seed.version || 0) > (state.seedVersion || 0)) {
      const have = new Set(state.items.map((i) => i.id));
      for (const q of seed.questions || []) if (!have.has(q.id)) state.items.push(normalizeQ(q));
      state.seedVersion = seed.version;
      this.save();
    }
    return this;
  },
  save() { lsSet(JSON.stringify(state)); },
  all() { return state.items.slice(); },
  count() { return state.items.length; },
  get(id) { return state.items.find((i) => i.id === id); },
  add(q) {
    const n = normalizeQ(q);
    const e = validateQ(n);
    if (e.length) return { ok: false, errors: e };
    state.items.push(n); this.save();
    return { ok: true, item: n };
  },
  update(id, q) {
    const i = state.items.findIndex((x) => x.id === id);
    if (i < 0) return { ok: false, errors: ['Question not found.'] };
    const n = normalizeQ({ ...q, id });
    const e = validateQ(n);
    if (e.length) return { ok: false, errors: e };
    state.items[i] = n; this.save();
    return { ok: true, item: n };
  },
  remove(id) { const b = state.items.length; state.items = state.items.filter((x) => x.id !== id); this.save(); return state.items.length < b; },
  exportJSON() { return JSON.stringify({ version: 1, questions: state.items }, null, 2); },
  importJSON(text, replace = false) {
    let data;
    try { data = JSON.parse(text); } catch { return { ok: false, errors: ['File is not valid JSON.'] }; }
    const arr = Array.isArray(data) ? data : data.questions;
    if (!Array.isArray(arr)) return { ok: false, errors: ['No "questions" array found.'] };
    const good = [], errors = [];
    arr.forEach((raw, i) => {
      const n = normalizeQ(raw || {});
      const e = validateQ(n);
      if (e.length) errors.push(`#${i + 1}: ${e.join(' ')}`); else good.push(n);
    });
    if (replace) state.items = good;
    else {
      const map = new Map(state.items.map((x) => [x.id, x]));
      for (const g of good) map.set(g.id, g);
      state.items = [...map.values()];
    }
    this.save();
    return { ok: errors.length === 0, imported: good.length, errors };
  },
  clear() { state.items = []; this.save(); },
  forLevel(levelId) { return state.items.filter((q) => !q.levels.length || q.levels.includes(levelId)); },

  // Pick the next question for a run. usedIds: Set of ids already asked this run.
  // Returns { question } or { empty: true }.
  pick(levelId, usedIds, rnd = Math.random, lastCorrectIdx = -1, prevSame = 0) {
    const pool = this.forLevel(levelId);
    if (!pool.length) return { empty: true };
    let cand = pool.filter((q) => !usedIds.has(q.id));
    let recycled = false;
    if (!cand.length) { usedIds.clear(); cand = pool; recycled = true; }
    const pref = PREFER[levelId] || [];
    const best = cand.filter((q) => q.difficulty === pref[0]);
    const mid = cand.filter((q) => pref.includes(q.difficulty));
    const from = best.length && rnd() < 0.6 ? best : mid.length ? mid : cand;
    const q = from[Math.floor(rnd() * from.length)];
    usedIds.add(q.id);
    // shuffle answers; never put the correct answer in the same slot as last time more than twice in a row
    let options, correctIdx, guard = 0;
    do {
      options = seededShuffle([q.correct, ...q.wrong], rnd);
      correctIdx = options.indexOf(q.correct);
      guard++;
    } while (guard < 30 && (correctIdx === lastCorrectIdx && (prevSame >= 1 || rnd() < 0.85)));
    return { question: { id: q.id, text: q.q, options, correctIdx, ref: q.ref, expl: q.expl }, recycled };
  },
};
