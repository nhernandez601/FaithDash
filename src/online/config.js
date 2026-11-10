// Online leaderboard connection (Supabase, free plan).
// Paste the two values from Supabase -> Project Settings -> API here. Both are meant to be public: the "anon" key can
// only call the leaderboard functions in supabase/leaderboard.sql, which check every name and score; it cannot read or
// change the tables directly. Leave them empty and the game keeps scores on this device only.
// (A local .env file with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY also works, see .env.example.)
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
export const ONLINE = {
  url: env.VITE_SUPABASE_URL || '',
  anonKey: env.VITE_SUPABASE_ANON_KEY || '',
};
