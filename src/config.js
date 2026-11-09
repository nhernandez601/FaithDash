// Backend configuration. Copy .env.example to .env and fill in your Supabase project values, then rebuild.
// The anon key is a PUBLIC key by design (safe in client code). NEVER put the service_role key here.
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
export const BACKEND = {
  url: (env.VITE_SUPABASE_URL || '').replace(/\/+$/, ''),
  anonKey: env.VITE_SUPABASE_ANON_KEY || '',
};
