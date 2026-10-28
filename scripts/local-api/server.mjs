// A small local stand-in for Supabase's REST, Auth and Functions APIs.
// It exists so the web app can be tested end to end against a local Postgres
// with the real access rules: every request runs as anon or authenticated with
// the same JWT claims PostgREST sets, so Row Level Security decides what happens.
// It is a test tool, not production code. Phone codes are fixed (123456).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import pg from 'pg';
import { attachRealtime } from './realtime.mjs';

const PORT = Number(process.env.PORT || 54321);
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:54322/app';
const WEB_ROOT = process.env.WEB_ROOT || new URL('../../web/', import.meta.url).pathname;
const SECRET = 'local-only-jwt-secret-not-used-anywhere-else-0123456789';
const TEST_CODE = '123456';
const MAX_ROWS = Number(process.env.MAX_ROWS || 200);

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 8 });
const refreshTokens = new Map();

// ---------- JWT (HS256) ----------
const b64u = (b) => Buffer.from(b).toString('base64url');
function sign(payload) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify(payload));
  const sig = createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function verify(token) {
  const [h, b, s] = String(token || '').split('.');
  if (!h || !b || !s) return null;
  const want = createHmac('sha256', SECRET).update(`${h}.${b}`).digest();
  const got = Buffer.from(s, 'base64url');
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  const claims = JSON.parse(Buffer.from(b, 'base64url').toString());
  if (claims.exp && claims.exp < Date.now() / 1000) return null;
  return claims;
}
export const ANON_KEY = sign({ role: 'anon', iss: 'local', iat: 1760000000, exp: 4102444800 });

// ---------- run SQL as the caller ----------
async function asCaller(claims, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `select set_config('role', $1, true), set_config('request.jwt.claims', $2, true),
              set_config('request.jwt.claim.sub', $3, true), set_config('request.jwt.claim.role', $1, true)`,
      [claims.role, JSON.stringify(claims), claims.sub || ''],
    );
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw Object.assign(new Error(`bad identifier ${s}`), { code: '42602' });
  return `"${s}"`;
};

function filters(params, values) {
  const where = [];
  for (const [k, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(k)) continue;
    const m = /^(eq|neq|lt|lte|gt|gte|is|in|cs|like|ilike)\.(.*)$/s.exec(raw);
    if (!m) throw Object.assign(new Error(`unsupported filter ${k}=${raw}`), { code: 'PGRST100' });
    const [, op, v] = m;
    const col = ident(k);
    if (op === 'like' || op === 'ilike') {
      values.push(v.replace(/\*/g, '%'));
      where.push(`${col}::text ${op} $${values.length}`);
    } else if (op === 'is') {
      const lit = { null: 'null', true: 'true', false: 'false' }[v];
      if (!lit) throw Object.assign(new Error('bad is filter'), { code: 'PGRST100' });
      where.push(`${col} is ${lit}`);
    } else if (op === 'cs') {
      // array contains: cs.{a,b}
      const items = v.replace(/^\{|\}$/g, '').split(',').filter(Boolean).map((x) => x.replace(/^"|"$/g, ''));
      values.push(items);
      where.push(`${col} @> $${values.length}::text[]`);
    } else if (op === 'in') {
      const items = v.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, ''));
      values.push(items);
      where.push(`${col}::text = any($${values.length}::text[])`);
    } else {
      values.push(v);
      const sqlOp = { eq: '=', neq: '<>', lt: '<', lte: '<=', gt: '>', gte: '>=' }[op];
      where.push(`${col}::text ${sqlOp} $${values.length}`);
    }
  }
  return where.length ? ` where ${where.join(' and ')}` : '';
}
const cols = (sel) => (!sel || sel === '*' ? '*' : sel.split(',').map((c) => ident(c.trim())).join(', '));
function order(o) {
  if (!o) return '';
  return ` order by ${o.split(',').map((part) => {
    const [c, dir, nulls] = part.split('.');
    return `${ident(c)} ${dir === 'desc' ? 'desc' : 'asc'}${nulls === 'nullsfirst' ? ' nulls first' : nulls === 'nullslast' ? ' nulls last' : ''}`;
  }).join(', ')}`;
}

async function rest(req, url, claims, body) {
  const parts = url.pathname.replace(/^\/rest\/v1\//, '').split('/');
  const p = url.searchParams;
  const prefer = req.headers.prefer || '';
  const returning = prefer.includes('return=representation');
  if (parts[0] === 'rpc') {
    const fn = ident(parts[1]);
    const args = body || {};
    const names = Object.keys(args);
    const values = names.map((n) => args[n]);
    const call = `public.${fn}(${names.map((n, i) => `${ident(n)} => $${i + 1}`).join(', ')})`;
    return asCaller(claims, async (c) => {
      const meta = await c.query(
        `select p.proretset as set, p.prorettype = 'void'::regtype as void
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1 limit 1`, [parts[1]]);
      if (!meta.rows[0]) throw Object.assign(new Error('function not found'), { code: 'PGRST202', status: 404 });
      // Like PostgREST, let Postgres turn rows into JSON (arrays, enums, dates)
      if (meta.rows[0].void) { await c.query(`select ${call}`, values); return { status: 204, data: null }; }
      if (meta.rows[0].set) {
        const r = await c.query(`select coalesce(json_agg(t), '[]') as j from ${call} t`, values);
        return { status: 200, data: r.rows[0].j };
      }
      const r = await c.query(`select to_json(${call}) as j`, values);
      return { status: 200, data: r.rows[0].j };
    });
  }
  const table = `public.${ident(parts[0])}`;
  const values = [];
  if (req.method === 'GET') {
    let sql = `select ${cols(p.get('select'))} from ${table}${filters(p, values)}${order(p.get('order'))}`;
    // Like the projects (max_rows = 200): never more than 200 rows a request
    sql += ` limit ${Math.min(Number(p.get('limit')) || MAX_ROWS, MAX_ROWS) | 0}`;
    if (p.get('offset')) sql += ` offset ${Number(p.get('offset')) | 0}`;
    return asCaller(claims, async (c) => ({ status: 200, data: (await c.query(`select coalesce(json_agg(t), '[]') as j from (${sql}) t`, values)).rows[0].j }));
  }
  if (req.method === 'POST') {
    const rows = Array.isArray(body) ? body : [body];
    const keys = Object.keys(rows[0] || {});
    const tuples = rows.map((r) => `(${keys.map((k) => { values.push(r[k]); return `$${values.length}`; }).join(', ')})`);
    const sql = `insert into ${table} (${keys.map(ident).join(', ')}) values ${tuples.join(', ')}${returning ? ` returning ${cols(p.get('select'))}` : ''}`;
    return asCaller(claims, async (c) => {
      if (!returning) { await c.query(sql, values); return { status: 201, data: null }; }
      const r = await c.query(`with t as (${sql}) select coalesce(json_agg(t), '[]') as j from t`, values);
      return { status: 201, data: r.rows[0].j };
    });
  }
  if (req.method === 'PATCH') {
    const keys = Object.keys(body || {});
    const sets = keys.map((k) => { values.push(body[k]); return `${ident(k)} = $${values.length}`; });
    const sql = `update ${table} set ${sets.join(', ')}${filters(p, values)}${returning ? ` returning ${cols(p.get('select'))}` : ''}`;
    return asCaller(claims, async (c) => {
      if (!returning) { await c.query(sql, values); return { status: 204, data: null }; }
      const r = await c.query(`with t as (${sql}) select coalesce(json_agg(t), '[]') as j from t`, values);
      return { status: 200, data: r.rows[0].j };
    });
  }
  if (req.method === 'DELETE') {
    const sql = `delete from ${table}${filters(p, values)}${returning ? ` returning ${cols(p.get('select'))}` : ''}`;
    return asCaller(claims, async (c) => {
      if (!returning) { await c.query(sql, values); return { status: 204, data: null }; }
      const r = await c.query(`with t as (${sql}) select coalesce(json_agg(t), '[]') as j from t`, values);
      return { status: 200, data: r.rows[0].j };
    });
  }
  throw Object.assign(new Error('method not allowed'), { status: 405 });
}

// ---------- auth ----------
const digits = (phone) => String(phone || '').replace(/\D/g, '');
async function userByPhone(phone) {
  const r = await pool.query('select id, phone, phone_confirmed_at, created_at from auth.users where phone = $1', [digits(phone)]);
  return r.rows[0];
}
function session(user) {
  const now = Math.floor(Date.now() / 1000);
  const access = sign({ sub: user.id, role: 'authenticated', aud: 'authenticated', phone: user.phone, iat: now, exp: now + 3600 });
  const refresh = randomUUID();
  refreshTokens.set(refresh, user.id);
  return {
    access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: refresh,
    user: { id: user.id, aud: 'authenticated', role: 'authenticated', phone: user.phone, phone_confirmed_at: user.phone_confirmed_at, created_at: user.created_at, app_metadata: { provider: 'phone' }, user_metadata: {} },
  };
}
async function auth(req, url, body) {
  const path = url.pathname.replace(/^\/auth\/v1\//, '');
  if (path === 'otp') {
    const ph = digits(body?.phone);
    if (ph.length < 8) return { status: 400, data: { code: 400, msg: 'Invalid phone number' } };
    await pool.query(
      `insert into auth.users (id, aud, role, phone, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
       select gen_random_uuid(), 'authenticated', 'authenticated', $1, now(), now(), '{"provider":"phone"}', '{}'
       where not exists (select 1 from auth.users where phone = $1)`, [ph]);
    return { status: 200, data: {} };
  }
  if (path === 'verify') {
    if (body?.token !== TEST_CODE) return { status: 403, data: { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' } };
    await pool.query('update auth.users set phone_confirmed_at = coalesce(phone_confirmed_at, now()), last_sign_in_at = now() where phone = $1', [digits(body.phone)]);
    const u = await userByPhone(body.phone);
    if (!u) return { status: 403, data: { code: 403, msg: 'No such user' } };
    return { status: 200, data: session(u) };
  }
  if (path === 'token' && url.searchParams.get('grant_type') === 'refresh_token') {
    const id = refreshTokens.get(body?.refresh_token);
    if (!id) return { status: 400, data: { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' } };
    refreshTokens.delete(body.refresh_token);
    const r = await pool.query('select id, phone, phone_confirmed_at, created_at from auth.users where id = $1', [id]);
    return r.rows[0] ? { status: 200, data: session(r.rows[0]) } : { status: 400, data: { msg: 'gone' } };
  }
  if (path === 'user') {
    const claims = verify(String(req.headers.authorization || '').replace(/^Bearer /, ''));
    if (!claims?.sub) return { status: 401, data: { code: 401, msg: 'invalid JWT' } };
    const r = await pool.query('select id, phone, phone_confirmed_at, created_at from auth.users where id = $1', [claims.sub]);
    return r.rows[0] ? { status: 200, data: session(r.rows[0]).user } : { status: 404, data: { msg: 'User not found' } };
  }
  if (path === 'logout') return { status: 204, data: null };
  return { status: 404, data: { msg: 'not found' } };
}

// ---------- functions ----------
async function functions(req, url, body) {
  const name = url.pathname.replace(/^\/functions\/v1\//, '');
  const claims = verify(String(req.headers.authorization || '').replace(/^Bearer /, ''));
  if (name === 'delete-account') {
    if (!claims?.sub) return { status: 401, data: { error: 'Sign in first' } };
    if (body?.confirm !== 'DELETE') return { status: 400, data: { error: 'Type DELETE to confirm' } };
    await pool.query('delete from auth.users where id = $1', [claims.sub]);
    return { status: 200, data: { deleted: true } };
  }
  return { status: 404, data: { error: 'no such function' } };
}

// ---------- static web app ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2' };
async function staticFile(url) {
  if (url.pathname === '/config.js') {
    const cfg = { supabaseUrl: `http://127.0.0.1:${PORT}`, supabaseAnonKey: ANON_KEY, environment: 'local' };
    return { status: 200, type: 'text/javascript', raw: `window.MH_CONFIG = ${JSON.stringify(cfg)};` };
  }
  const rel = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^(\.\.[/\\])+/, '');
  try {
    let raw = await readFile(join(WEB_ROOT, rel));
    if (rel.endsWith('index.html')) {
      raw = Buffer.from(String(raw).replace('__CSP__', `default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'`));
    }
    return { status: 200, type: TYPES[extname(rel)] || 'application/octet-stream', raw };
  } catch {
    return { status: 404, type: 'text/plain', raw: 'not found' };
  }
}

// ---------- server ----------
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, prefer, x-client-info, accept-profile, content-profile, range, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
};
function pgError(e) {
  const code = e.code || 'XX000';
  const status = e.status || (code === '42501' ? 403 : code === '23505' ? 409 : code === 'PGRST202' ? 404 : 400);
  return { status, data: { code, message: e.message, details: e.detail || null, hint: e.hint || null } };
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
  let out;
  try {
    if (url.pathname.startsWith('/rest/v1/')) {
      const token = String(req.headers.authorization || '').replace(/^Bearer /, '') || req.headers.apikey;
      const claims = verify(token);
      if (!claims) out = { status: 401, data: { code: 'PGRST301', message: 'JWT invalid' } };
      else out = await rest(req, url, claims, body);
    } else if (url.pathname.startsWith('/auth/v1/')) {
      out = await auth(req, url, body);
    } else if (url.pathname.startsWith('/functions/v1/')) {
      out = await functions(req, url, body);
    } else {
      const f = await staticFile(url);
      res.writeHead(f.status, { 'Content-Type': f.type, 'Cache-Control': 'no-store' });
      return res.end(f.raw);
    }
  } catch (e) {
    out = pgError(e);
  }
  res.writeHead(out.status, { ...CORS, 'Content-Type': 'application/json' });
  res.end(out.data == null ? '' : JSON.stringify(out.data));
});

if (process.argv[1] === new URL(import.meta.url).pathname) {
  // Live updates (Supabase Realtime's Postgres Changes) on the same port
  await attachRealtime(server, { pool, verify, asCaller, log: (m) => console.log(m) });
  server.listen(PORT, '127.0.0.1', () => console.log(`local api on http://127.0.0.1:${PORT} (web app at /)`));
}
export { server, sign };
