// Global leaderboard client (Supabase REST/RPC over fetch — no SDK, no secrets).
// If no backend is configured this module reports "not_configured" and NEVER fabricates player records.
import { BACKEND } from '../config.js';

export const RANK_POLICY =
  'Ranked by furthest progress (max 100 points per level, 300 overall). Ties are broken by faster active play time, then by earlier submission. ' +
  'Overall = sum of each player\'s best score from each level. Replaying a level only counts if you beat your own best. ' +
  'Other sort options reorder the list but do not change the official rank.';

export const lb = {
  cfg: BACKEND,
  override: null, // tests can inject { url, anonKey }
  get conf() { return this.override || this.cfg; },
  get configured() { return !!(this.conf.url && this.conf.anonKey); },
  async rpc(name, body, timeoutMs = 9000) {
    if (!this.configured) return { ok: false, code: 'not_configured', error: 'The global leaderboard has not been connected yet.' };
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.conf.url}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: this.conf.anonKey, Authorization: `Bearer ${this.conf.anonKey}` },
        body: JSON.stringify(body || {}),
        signal: ctl.signal,
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      if (!res.ok) {
        const msg = (data && (data.message || data.error)) || `Server error ${res.status}`;
        const code = /rate_limited/.test(msg) ? 'rate_limited' : /invalid_run|implausible|duplicate|bad_session/.test(msg) ? 'rejected' : res.status >= 500 ? 'server' : 'error';
        return { ok: false, code, error: friendly(code, msg) };
      }
      return { ok: true, data };
    } catch (e) {
      if (e.name === 'AbortError') return { ok: false, code: 'timeout', error: 'The leaderboard took too long to respond. Check your connection and try again.' };
      return { ok: false, code: 'offline', error: 'Could not reach the leaderboard (offline?). Your score is saved on this device and can be sent later.' };
    } finally { clearTimeout(to); }
  },
  startRun(playerId, levelId) { return this.rpc('fd_start_run', { p_player_id: playerId, p_level: levelId }); },
  submitRun(payload) { return this.rpc('fd_submit_run', { p: payload }); },
  board(scope, sort, playerId, limit = 100) { return this.rpc('fd_leaderboard', { p_scope: String(scope), p_sort: sort, p_limit: limit, p_player_id: playerId || null }); },
  playerStats(playerId) { return this.rpc('fd_player_stats', { p_player_id: playerId }); },
  setName(playerId, name) { return this.rpc('fd_set_display_name', { p_player_id: playerId, p_name: name }); },
  report(runId, reason) { return this.rpc('fd_report', { p_run_id: runId, p_reason: reason }); },
};

function friendly(code, msg) {
  switch (code) {
    case 'rate_limited': return 'Too many submissions in a short time. Please wait a minute and try again.';
    case 'rejected': return 'The server rejected this run as invalid (' + msg.replace(/^.*?:\s*/, '') + ').';
    case 'server': return 'The leaderboard server had a problem. Try again in a moment.';
    default: return msg;
  }
}
