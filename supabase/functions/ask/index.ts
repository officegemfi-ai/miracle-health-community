// ask: Miracle AI's chat on miraclehealth.us/ai. Anyone can talk with it, no account needed.
// The page sends the conversation it keeps in the visitor's own browser; this function runs
// the agents (see agents.ts) and streams their steps and the answer back as server-sent
// events. Nothing the visitor writes is stored or logged here. The only thing kept is a
// count per visitor per day, under a key made from their network address with a secret
// that changes daily, so the free chat can't be run up (see migration 20261030000100).
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { type ChatMessage, type Models, runTurn } from './agents.ts';
import { createLibrary, type Library } from './library.ts';

export const LIMITS = { messages: 24, userChars: 2000, assistantChars: 6000, totalChars: 60000, bodyBytes: 200_000 };

export type Quota = { ok: boolean; reason?: string; left?: number };
export type HttpDeps = {
  origins: string[];
  apiKey: string;
  models: Models;
  effort?: string;
  library: Library;
  salt: string;
  quota: (visitor: string) => Promise<Quota>;
  fetchImpl?: typeof fetch;
  log?: (line: Record<string, unknown>) => void;
  now?: () => Date;
};

export function corsHeaders(req: Request, origins: string[]): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': origins.includes(origin) ? origin : (origins[0] ?? ''),
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const MESSAGES: Record<string, [number, string]> = {
  burst: [429, 'You’re sending messages quickly. Give it a minute, then try again.'],
  visitor_day: [429, 'That’s today’s limit for this connection. Miracle AI will be ready for you again tomorrow.'],
  site_day: [429, 'Miracle AI has answered as many messages as it can today. It’ll be back tomorrow; the Library is open in the meantime.'],
  off: [503, 'Miracle AI is paused for maintenance. The Library is open in the meantime.'],
  unavailable: [503, 'Miracle AI is resting for a moment. Please try again shortly.'],
};

// The conversation as the page sent it, tidied: roles alternate, it starts and ends with the
// member, no control characters, nothing too long
export function readConversation(body: unknown): { messages: ChatMessage[] } | { error: string; status: number } {
  const raw = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(raw) || !raw.length) return { error: 'Send the conversation as messages.', status: 400 };
  const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n').trim();
  const out: ChatMessage[] = [];
  for (const m of raw.slice(-60)) {
    const role = (m as { role?: unknown })?.role;
    const content = (m as { content?: unknown })?.content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') continue;
    const text = clean(content).slice(0, role === 'user' ? LIMITS.userChars * 2 : LIMITS.assistantChars);
    if (!text) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === role) prev.content = `${prev.content}\n\n${text}`.slice(0, role === 'user' ? LIMITS.userChars * 2 : LIMITS.assistantChars);
    else out.push({ role, content: text });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  if (!out.length || out[out.length - 1].role !== 'user') return { error: 'The last message should be yours.', status: 400 };
  const last = out[out.length - 1];
  if (last.content.length > LIMITS.userChars) return { error: `Keep a message under ${LIMITS.userChars.toLocaleString('en-US')} characters.`, status: 413 };
  let kept = out.slice(-LIMITS.messages);
  while (kept[0]?.role !== 'user') kept = kept.slice(1);
  let total = kept.reduce((n, m) => n + m.content.length, 0);
  while (total > LIMITS.totalChars && kept.length > 1) {
    total -= kept[0].content.length + (kept[1]?.content.length ?? 0);
    kept = kept.slice(2);
  }
  return { messages: kept };
}

// A visitor's key for today: their address, signed with a secret and the date, so it can't
// be turned back into the address or matched across days
export async function visitorKey(req: Request, salt: string, day: string): Promise<string> {
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ??
    (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(`ask-v1:${salt}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${day}|${ip || 'unknown'}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function handle(req: Request, deps: HttpDeps): Promise<Response> {
  const cors = corsHeaders(req, deps.origins);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, cors);
  if (!deps.origins.includes(req.headers.get('Origin') ?? '')) return json({ error: 'Not allowed from here.' }, 403, cors);
  if (!deps.apiKey) return json({ error: MESSAGES.unavailable[1], code: 'unavailable' }, 503, cors);

  const raw = await req.text().catch(() => '');
  if (raw.length > LIMITS.bodyBytes) return json({ error: 'That conversation is too long. Start a new chat.' }, 413, cors);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return json({ error: 'Bad request.' }, 400, cors); }
  const conv = readConversation(body);
  if ('error' in conv) return json({ error: conv.error }, conv.status, cors);

  const now = deps.now ? deps.now() : new Date();
  const day = now.toISOString().slice(0, 10);
  let q: Quota;
  try {
    q = await deps.quota(await visitorKey(req, deps.salt, day));
  } catch {
    q = { ok: false, reason: 'unavailable' };
  }
  if (!q.ok) {
    const [status, message] = MESSAGES[q.reason ?? 'unavailable'] ?? MESSAGES.unavailable;
    return json({ error: message, code: q.reason ?? 'unavailable' }, status, cors);
  }

  const enc = new TextEncoder();
  const abort = new AbortController();
  let closed = false;
  let cancelled = false;
  const body$ = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: Record<string, unknown>) => {
        if (closed) return;
        try { controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { closed = true; }
      };
      // A comment line every 15 seconds keeps quiet stretches from timing out
      const beat = setInterval(() => { if (!closed) try { controller.enqueue(enc.encode(': keep-alive\n\n')); } catch { closed = true; } }, 15_000);
      // The whole turn gets two minutes
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; abort.abort(); }, 120_000);
      const t0 = Date.now();
      send('meta', { v: 1, left: q.left ?? null });
      try {
        const { memo } = await runTurn(conv.messages, {
          apiKey: deps.apiKey, models: deps.models, effort: deps.effort, library: deps.library,
          fetchImpl: deps.fetchImpl, signal: abort.signal, log: deps.log,
        }, send);
        send('done', { memo, left: q.left ?? null, ms: Date.now() - t0 });
      } catch (e) {
        if (!cancelled) {
          const busy = (e as { retryable?: boolean })?.retryable;
          send('error', {
            code: timedOut ? 'timeout' : busy ? 'busy' : 'failed',
            message: timedOut ? 'That took too long. Please try again, maybe with a shorter question.'
              : busy ? 'Miracle AI is busy right now. Please try again in a moment.' : 'Something went wrong on our side. Please try again.',
          });
          deps.log?.({ ask_error: { kind: timedOut ? 'timeout' : (e as { kind?: string })?.kind ?? (e as Error)?.name ?? 'error', status: (e as { status?: number })?.status ?? null } });
        }
      } finally {
        clearTimeout(timer);
        clearInterval(beat);
        if (!closed) { closed = true; try { controller.close(); } catch { /* already closed */ } }
      }
    },
    cancel() {
      closed = true;
      cancelled = true;
      abort.abort();
    },
  });
  return new Response(body$, {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

if (import.meta.main) {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SECRET_KEY') ?? '';
  const db = createClient(url, service, { auth: { persistSession: false } });
  const list = (s: string | undefined) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const deps: HttpDeps = {
    origins: list(Deno.env.get('ASK_ORIGINS') ?? 'https://miraclehealth.us,https://www.miraclehealth.us'),
    apiKey: Deno.env.get('ANTHROPIC_API_KEY') ?? '',
    models: {
      guide: Deno.env.get('ASK_MODEL') || 'claude-sonnet-5-5',
      fast: Deno.env.get('ASK_FAST_MODEL') || 'claude-haiku-5-5',
      fallback: Deno.env.get('ASK_FALLBACK_MODEL') || 'claude-haiku-5-5',
    },
    effort: Deno.env.get('ASK_EFFORT') || 'low',
    library: createLibrary({
      base: Deno.env.get('LIBRARY_URL') || 'https://miraclehealth.us/library/data',
      snapshotUrl: Deno.env.get('SNAPSHOT_URL') || 'https://community.miraclehealth.us/snapshot.json',
    }),
    salt: service,
    quota: async (visitor) => {
      const { data, error } = await db.rpc('ask_take', { visitor });
      if (error || !data) return { ok: false, reason: 'unavailable' };
      return data as Quota;
    },
    log: (line) => console.log(JSON.stringify(line)),
  };
  Deno.serve((req) => handle(req, deps));
}
