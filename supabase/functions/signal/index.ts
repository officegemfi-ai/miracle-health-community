// signal: the Community Signal's public read API. Anyone can read it, with no key: it serves the
// same aggregate numbers miraclehealth.us shows, nothing about any one member. The database
// publishes a new numbered version whenever the numbers change, checking once a minute
// (migration 20261107000100); this serves the newest one.
//   GET /signal                  the whole Signal: snapshot.json's fields, plus version and published_at
//   GET /signal/compounds/<id>   one compound: version, published_at, generated_at, community, uses,
//                                signal (null when it has none yet) and space
//   GET /signal/version          version, hash, published_at, checked_at, checked_by: what's current,
//                                and whether the minute job is running (checked_by "cron")
// Every answer carries ETag (a SHA-256 of its body), X-Signal-Version, X-Signal-Published and
// X-Signal-Checked; a matching If-None-Match gets a 304. HEAD answers without the body, OPTIONS
// with 204. Errors are JSON {error, message}: 400 bad_id, 404 not_found, 405 method, 503 unavailable.
// A version's body never changes, so caches can keep it: browsers 30 seconds, then up to 5 minutes
// more while they check again. How fresh it is travels in X-Signal-Checked.
// Each instance keeps the newest version 15 seconds, then asks the database whether there's a newer
// one (an unchanged version comes back without its payload). When the newest was last checked over
// 3 minutes ago, the minute job has stopped: the instance publishes itself (signal_refresh), at
// most once a minute, and the version says checked_by "api" so the health check notices.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { env } from '../_shared/cors.ts';

export type Db = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
export type Publication = {
  version: number;
  hash: string;
  published_at: string;
  checked_at: string;
  checked_by: string;
  payload: Record<string, unknown>;
};
export type Deps = {
  db: Db;
  now?: () => number;
  log?: (line: Record<string, unknown>) => void;
};

export const FRESH_MS = 15_000;        // an instance asks the database again after this
export const STALE_MS = 180_000;       // last checked longer ago than this: the minute job has stopped
export const HEAL_EVERY_MS = 60_000;   // an instance publishes itself at most this often
const EMPTY_RETRY_MS = 5_000;          // with no copy at all, a failed read is tried again after this
const MAX_BODIES = 500;                // rendered answers kept for the current version
const ID = /^[a-z0-9-]{2,40}$/;        // a compound id, the database's own rule
export const CACHE_BODY = 'public, max-age=30, stale-while-revalidate=300, stale-if-error=86400';
export const CACHE_VERSION = 'public, max-age=15';
const CACHE_FIXED = 'public, max-age=300';   // answers that don't depend on the numbers (400, 404, 405)

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'ETag, X-Signal-Version, X-Signal-Published, X-Signal-Checked',
};
const PREFLIGHT: Record<string, string> = {
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'if-none-match, authorization, apikey, x-client-info, content-type',
  'Access-Control-Max-Age': '86400',
};

type Body = { text: string; etag: string };
type Route = { kind: 'all' } | { kind: 'version' } | { kind: 'compound'; id: string } | { kind: 'bad_id' };

// The platform hands a function its path with the function's name first (/signal/version); the
// part after the name is the route
export function route(url: URL): Route | null {
  const path = url.pathname.replace(/^.*?\/signal(?=\/|$)/, '').replace(/\/+$/, '');
  if (path === '') return { kind: 'all' };
  if (path === '/version') return { kind: 'version' };
  const m = path.match(/^\/compounds\/([^/]*)$/);
  if (!m) return null;
  let id = '';
  try {
    id = decodeURIComponent(m[1]);
  } catch {
    return { kind: 'bad_id' };
  }
  return ID.test(id) ? { kind: 'compound', id } : { kind: 'bad_id' };
}

// If-None-Match: a list of tags, weak or strong (compared weakly, as the standard says for it), or *
export function matches(header: string | null, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  const want = etag.replace(/^W\//, '');
  return header.split(',').some((t) => t.trim().replace(/^W\//, '') === want);
}

async function sha256(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(d.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}
const tag = async (text: string): Promise<Body> => ({ text, etag: `"${await sha256(text)}"` });

// What the database answered, checked: null before the first publish; a payload of null when the
// caller already held that version
function parse(data: unknown): (Omit<Publication, 'payload'> & { payload: Record<string, unknown> | null }) | null {
  if (data === null || data === undefined) return null;
  const d = data as Record<string, unknown>;
  if (typeof d !== 'object' || typeof d.version !== 'number' || typeof d.published_at !== 'string' || typeof d.checked_at !== 'string') {
    throw new Error('the database answered something that isn\'t a publication');
  }
  const p = d.payload;
  return {
    version: d.version,
    hash: String(d.hash ?? ''),
    published_at: d.published_at,
    checked_at: d.checked_at,
    checked_by: String(d.checked_by ?? ''),
    payload: p && typeof p === 'object' && !Array.isArray(p) ? p as Record<string, unknown> : null,
  };
}

function problem(status: number, error: string, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error, message }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
}

// One compound's part of a version
function slice(pub: Publication, id: string) {
  const p = pub.payload;
  const signals = (p.signals ?? {}) as Record<string, unknown>;
  const spaces = (p.spaces ?? {}) as Record<string, unknown>;
  return {
    version: pub.version,
    published_at: pub.published_at,
    generated_at: p.generated_at ?? null,
    community: p.community ?? null,
    uses: p.uses ?? {},
    signal: signals[id] ?? null,
    space: spaces[id] ?? null,
  };
}

export function createSignal(deps: Deps) {
  const now = () => (deps.now ? deps.now() : Date.now());
  const log = deps.log ?? (() => {});
  const state = {
    pub: null as Publication | null,
    at: -Infinity,            // when the database was last asked
    failedAt: -Infinity,      // when a read last failed with no copy to fall back on
    healedAt: -Infinity,      // when this instance last published itself
    loading: null as Promise<Publication | null> | null,
    bodies: new Map<string, Body>(),   // rendered answers of the current version, by route
  };

  async function read(fn: 'signal_latest' | 'signal_refresh'): Promise<Publication | null> {
    const held = state.pub;
    const { data, error } = await deps.db.rpc(fn, { p_known: held?.version ?? null });
    if (error) throw new Error(`${fn}: ${(error as { message?: string }).message ?? String(error)}`);
    const row = parse(data);
    if (!row) return null;
    if (row.payload) return row as Publication;
    if (held && row.version === held.version) return { ...row, payload: held.payload };
    throw new Error(`${fn} left out the payload of version ${row.version}, which this instance doesn't hold`);
  }

  async function load(): Promise<Publication | null> {
    const t = now();
    try {
      let pub = await read('signal_latest');
      if (pub && t - Date.parse(pub.checked_at) > STALE_MS && t - state.healedAt >= HEAL_EVERY_MS) {
        state.healedAt = t;
        log({ event: 'signal_refresh', version: pub.version, checked_at: pub.checked_at });
        pub = (await read('signal_refresh').catch((e) => {
          log({ event: 'signal_refresh_failed', error: String(e) });
          return null;
        })) ?? pub;
      }
      if (!pub || pub.version !== state.pub?.version) state.bodies.clear();
      state.pub = pub;
      state.at = t;
      return pub;
    } catch (e) {
      // Stale beats nothing: the last copy stands, and the database is asked again in 15 seconds
      log({ event: 'signal_read_failed', error: String(e), serving: state.pub?.version ?? null });
      state.at = t;
      if (!state.pub) state.failedAt = t;
      return state.pub;
    }
  }

  // The newest version: this instance's copy while it's fresh, otherwise one read at a time, which
  // every request arriving meanwhile waits on
  async function current(): Promise<Publication | null> {
    const t = now();
    if (state.pub && t - state.at < FRESH_MS) return state.pub;
    if (!state.pub && t - state.failedAt < EMPTY_RETRY_MS) return null;
    if (!state.loading) state.loading = load().finally(() => (state.loading = null));
    return await state.loading;
  }

  async function render(pub: Publication, key: string, make: () => unknown, keep: boolean): Promise<Body> {
    const k = `${pub.version} ${key}`;
    const hit = state.bodies.get(k);
    if (hit) return hit;
    const body = await tag(JSON.stringify(make()));
    if (keep && state.pub?.version === pub.version && state.bodies.size < MAX_BODIES) state.bodies.set(k, body);
    return body;
  }

  function answer(req: Request, body: Body, pub: Publication, cache: string): Response {
    const headers: Record<string, string> = {
      ...CORS,
      'Cache-Control': cache,
      ETag: body.etag,
      'X-Signal-Version': String(pub.version),
      'X-Signal-Published': pub.published_at,
      'X-Signal-Checked': pub.checked_at,
      'X-Content-Type-Options': 'nosniff',
    };
    if (matches(req.headers.get('If-None-Match'), body.etag)) return new Response(null, { status: 304, headers });
    headers['Content-Type'] = 'application/json; charset=utf-8';
    return new Response(req.method === 'HEAD' ? null : body.text, { status: 200, headers });
  }

  async function handle(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, ...PREFLIGHT } });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return problem(405, 'method', 'The Signal is read-only: use GET or HEAD.', { Allow: 'GET, HEAD, OPTIONS', 'Cache-Control': CACHE_FIXED });
    }
    const r = route(new URL(req.url));
    if (!r) return problem(404, 'not_found', 'Try /signal, /signal/version or /signal/compounds/<id>.', { 'Cache-Control': CACHE_FIXED });
    if (r.kind === 'bad_id') {
      return problem(400, 'bad_id', 'A compound id is 2 to 40 lowercase letters, digits or hyphens.', { 'Cache-Control': CACHE_FIXED });
    }
    try {
      const pub = await current();
      if (!pub) {
        return problem(503, 'unavailable', 'The Signal can\'t be read right now. Try again in a minute.', { 'Retry-After': '60', 'Cache-Control': 'no-store' });
      }
      if (r.kind === 'version') {
        const v = { version: pub.version, hash: pub.hash, published_at: pub.published_at, checked_at: pub.checked_at, checked_by: pub.checked_by };
        return answer(req, await tag(JSON.stringify(v)), pub, CACHE_VERSION);
      }
      if (r.kind === 'all') {
        return answer(req, await render(pub, 'all', () => ({ ...pub.payload, version: pub.version, published_at: pub.published_at }), true), pub, CACHE_BODY);
      }
      // Kept only for compounds the version knows, so made-up ids can't fill the memory
      const p = pub.payload as { signals?: Record<string, unknown>; spaces?: Record<string, unknown> };
      const known = Boolean(p.signals?.[r.id] || p.spaces?.[r.id]);
      return answer(req, await render(pub, `c:${r.id}`, () => slice(pub, r.id), known), pub, CACHE_BODY);
    } catch (e) {
      log({ event: 'signal_failed', error: String(e) });
      return problem(500, 'failed', 'Something went wrong reading the Signal.', { 'Cache-Control': 'no-store' });
    }
  }

  return { handle };
}

if (import.meta.main) {
  const { url, service } = env();
  const db = createClient(url, service, { auth: { persistSession: false } });
  const signal = createSignal({ db, log: (line) => console.log(JSON.stringify(line)) });
  Deno.serve((req) => signal.handle(req));
}
