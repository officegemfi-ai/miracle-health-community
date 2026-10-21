// delete-account: a signed-in member deletes their account. Deleting the sign-in
// record removes their profile, posts, comments and votes (the database cascades);
// reports they filed stay, without their name.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { corsHeaders, env, json } from '../_shared/cors.ts';

type Admin = { auth: { admin: { deleteUser: (id: string) => Promise<{ error: unknown }> } } };
type UserLookup = (token: string) => Promise<{ id: string } | null>;

export async function handle(req: Request, deps: { getUser: UserLookup; admin: Admin }): Promise<Response> {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, cors);
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Sign in first' }, 401, cors);
  const user = await deps.getUser(token);
  if (!user) return json({ error: 'Sign in first' }, 401, cors);
  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== 'DELETE') return json({ error: 'Type DELETE to confirm' }, 400, cors);
  const { error } = await deps.admin.auth.admin.deleteUser(user.id);
  if (error) return json({ error: 'Could not delete' }, 500, cors);
  return json({ deleted: true }, 200, cors);
}

if (import.meta.main) {
  const { url, anon, service } = env();
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const getUser: UserLookup = async (token) => {
    const client = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
    const { data, error } = await client.auth.getUser(token);
    return error || !data?.user ? null : { id: data.user.id };
  };
  Deno.serve((req) => handle(req, { getUser, admin: admin as unknown as Admin }));
}
