// The one connection to Supabase. It holds the public key only: who can see or change what is
// enforced by the database. app.js connects once at start; only the modules in data/ use it.
export let sb = null;

export function connect(url, key) {
  sb = window.supabase.createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return sb;
}

export const connected = () => !!sb;
