// Gamer names and the leaderboard.
// - Every player gets a random id on this device (localStorage) and picks a gamer name.
// - Scores are always kept on this device (top 10 per song). When the online database is connected (config.js), runs are
//   also sent there and the leaderboard shows everyone's best score per song.
// - The server (supabase/leaderboard.sql) checks names and scores; this file never invents records.
import { ONLINE } from './config.js';
import { checkName } from './names.js';
export { checkName };

const KEY = 'faithdash3d.player', LOCAL = 'faithdash3d.scores';
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));

// ---------- the player on this device ----------
export function player() {
  let p = store.get(KEY, null);
  if (!p || !p.id) { p = { id: uuid(), name: '' }; store.set(KEY, p); }
  return p;
}
// name rules: src/online/names.js (the database checks the same rules)
export const online = () => !!(ONLINE.url && ONLINE.anonKey);

async function rpc(fn, body, ms = 9000) {
  if (!online()) return { ok: false, code: 'offline_mode' };
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(`${ONLINE.url}/rest/v1/rpc/${fn}`, {
      method: 'POST', signal: ctl.signal,
      // older "anon" keys are JWTs (eyJ...) and also go in Authorization; newer "sb_publishable_..." keys only go in apikey
      headers: Object.assign({ 'Content-Type': 'application/json', apikey: ONLINE.anonKey }, ONLINE.anonKey.startsWith('eyJ') ? { Authorization: `Bearer ${ONLINE.anonKey}` } : {}),
      body: JSON.stringify(body || {}),
    });
    const text = await res.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!res.ok) { const msg = (data && (data.message || data.hint)) || 'error ' + res.status; return { ok: false, code: (msg.match(/name_taken|bad_name|too_many|bad_run|implausible/) || ['server'])[0], error: msg }; }
    return { ok: true, data };
  } catch { return { ok: false, code: 'offline', error: 'Could not reach the leaderboard.' }; } finally { clearTimeout(to); }
}

// save the name here and (if online) claim it on the server. Returns { ok, error? }
export async function setName(raw) {
  const c = checkName(raw); if (!c.ok) return c;
  const p = player();
  if (online()) {
    const r = await rpc('fd_set_name', { p_player: p.id, p_name: c.name });
    if (!r.ok && r.code === 'name_taken') return { ok: false, error: 'That name is taken. Try another.' };
    if (!r.ok && r.code === 'bad_name') return { ok: false, error: 'That name is not allowed. Please pick a different one.' };
    if (!r.ok && r.code !== 'offline') return { ok: false, error: 'Could not save the name online. Try again.' };
  }
  p.name = c.name; store.set(KEY, p);
  return { ok: true, name: c.name };
}

// ---------- a run ----------
// startRun when the music starts; finishRun at game over. The server only accepts a score for a run it saw start,
// and only if the score is possible in the time that has passed.
let run = null;
export async function startRun(song) {
  run = { song, token: null, t0: performance.now() };
  if (!online() || !player().name) return;
  const mine = run, r = await rpc('fd_start_run', { p_player: player().id, p_song: song });
  if (r.ok && mine === run) mine.token = r.data;
}
export function cancelRun() { run = null; }
// returns { local: rankOnThisDevice, online: { rank, total } | null, error? }
export async function finishRun(score, stage, reached) {
  const p = player(), r = run; run = null;
  const song = r ? r.song : '';
  const seconds = r ? Math.round((performance.now() - r.t0) / 1000) : 0;
  // this device
  const all = store.get(LOCAL, {}); const list = all[song] || [];
  const entry = { name: p.name || 'You', score, reached, at: Date.now() };
  list.push(entry); list.sort((a, b) => b.score - a.score); all[song] = list.slice(0, 10); store.set(LOCAL, all);
  const local = all[song].indexOf(entry) + 1; // 0 = not in this device's top 10
  if (!online()) return { local, online: null };
  if (!p.name) return { local, online: null, error: 'Set a gamer name to join the online leaderboard.' };
  if (!r || !r.token) return { local, online: null, error: 'Could not reach the leaderboard when this run started.' };
  const res = await rpc('fd_submit', { p_token: r.token, p_player: p.id, p_score: Math.floor(score), p_stage: stage, p_seconds: seconds });
  if (!res.ok) return { local, online: null, error: res.code === 'offline' ? 'Could not reach the leaderboard.' : 'The leaderboard did not accept this score.' };
  return { local, online: res.data };
}

// ---------- the boards ----------
export function localBoard(song) { return (store.get(LOCAL, {})[song] || []).map((e, i) => ({ rank: i + 1, name: e.name, score: e.score, reached: e.reached, me: true })); }
// best score per player for a song, top `limit`, plus where I am if I'm not in it
export async function onlineBoard(song, limit = 50) {
  const r = await rpc('fd_board', { p_song: song, p_limit: limit, p_player: player().id });
  return r.ok ? { ok: true, rows: r.data || [] } : { ok: false, error: r.error };
}
