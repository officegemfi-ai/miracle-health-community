// review-content: Claude reads each new post or comment against the rules and
// holds it for a moderator if it likely breaks one. For posts, the same read also
// records what the writer says happened to them, which feeds the Community Signal.
// Called by the database (see migration 20261021000300) with only an id.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { classify } from './review.ts';
import { env, json } from '../_shared/cors.ts';

const MODEL = Deno.env.get('MODERATION_MODEL') ?? 'claude-haiku-4-5';

// The few database calls this function makes, typed loosely on purpose.
type Row = { id: string; title?: string; body: string; status: string };
export type Db = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, value: string) => { maybeSingle: () => PromiseLike<{ data: Row | null; error: unknown }> };
    };
  };
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
};

export async function handle(req: Request, deps: {
  secret: string;
  apiKey: string;
  db: Db;
  fetchImpl?: typeof fetch;
}): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!deps.secret || req.headers.get('x-review-secret') !== deps.secret) return json({ error: 'Not allowed' }, 401);
  const { kind, id } = await req.json().catch(() => ({}));
  if (!['post', 'comment'].includes(kind) || typeof id !== 'string') return json({ error: 'Bad request' }, 400);

  const table = kind === 'post' ? 'posts' : 'comments';
  const cols = kind === 'post' ? 'id,title,body,status' : 'id,body,status';
  const { data: row, error } = await deps.db.from(table).select(cols).eq('id', id).maybeSingle();
  if (error) return json({ error: 'Lookup failed' }, 500);
  if (!row || row.status !== 'visible') return json({ skipped: true });

  let verdict;
  try {
    verdict = await classify(
      { kind, title: kind === 'post' ? (row.title ?? null) : null, body: row.body },
      { apiKey: deps.apiKey, model: MODEL, fetchImpl: deps.fetchImpl },
    );
  } catch (_e) {
    // Fail open: the post stays up, and member reports still work.
    return json({ skipped: true, reason: 'review unavailable' }, 202);
  }
  const { error: recErr } = await deps.db.rpc('record_ai_review', {
    target_kind: kind, target_id: id, model: verdict.model, verdict: verdict.verdict,
    categories: verdict.categories, explanation: verdict.explanation,
  });
  if (recErr) return json({ error: 'Could not record' }, 500);
  if (kind === 'post' && verdict.signal) {
    const s = verdict.signal;
    const { error: readErr } = await deps.db.rpc('record_post_read', {
      post_id: id, counts: s.first_hand && s.outcome !== null, outcome: s.outcome,
      duration: s.duration, side_effects: s.side_effects, model: verdict.model, uses: s.uses,
    });
    if (readErr) return json({ error: 'Could not record the read' }, 500);
  }
  return json({ verdict: verdict.verdict, categories: verdict.categories, signal: verdict.signal ?? null });
}

if (import.meta.main) {
  const { url, service } = env();
  const db = createClient(url, service, { auth: { persistSession: false } }) as unknown as Db;
  Deno.serve((req) => handle(req, {
    secret: Deno.env.get('REVIEW_SECRET') ?? '',
    apiKey: Deno.env.get('ANTHROPIC_API_KEY') ?? '',
    db,
  }));
}
