import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert/strict';
import { CACHE_BODY, CACHE_VERSION, createSignal, FRESH_MS, HEAL_EVERY_MS, matches, route, STALE_MS } from './index.ts';

// A database holding publications, as public.signal_latest answers them
const T0 = Date.parse('2026-11-07T12:00:00Z');
const at = (ms: number) => new Date(ms).toISOString().replace('Z', '123+00:00');   // microseconds, as Postgres writes them
const PAYLOAD = {
  generated_at: '2026-11-07T11:59:30.000000+00:00',
  community: { members: 12, reports: 40 },
  uses: { energy: ['Energy', 'More energy'] },
  signals: { bpc157: { name: 'BPC-157', score: 61 }, 'nad-plus': { name: 'NAD+', score: 48 } },
  spaces: { bpc157: [12, 30] },
  moves: [],
  focus: [],
  founders: { goal: 100, taken: 12 },
};
type Row = { version: number; hash: string; published_at: string; checked_at: string; checked_by: string; bytes: number; payload: Record<string, unknown> };
function fakeDb(first: Row | null) {
  const calls: [string, Record<string, unknown> | undefined][] = [];
  const db = {
    calls,
    row: first,
    fail: false,
    refreshed: null as Row | null,   // what signal_refresh publishes, when set
    rpc(fn: string, args?: Record<string, unknown>) {
      calls.push([fn, args]);
      if (db.fail) return Promise.resolve({ data: null, error: { message: 'connection refused' } });
      if (fn === 'signal_refresh' && db.refreshed) db.row = db.refreshed;
      const r = db.row;
      if (!r) return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: { ...r, payload: args?.p_known === r.version ? null : r.payload }, error: null });
    },
  };
  return db;
}
const row = (version: number, payload: Record<string, unknown> = PAYLOAD, checked = T0 - 20_000): Row => ({
  version, hash: 'a'.repeat(32), published_at: at(T0 - 30_000), checked_at: at(checked), checked_by: 'cron', bytes: 100, payload,
});
const URL0 = 'https://x.supabase.co/functions/v1/signal';
const get = (path = '', headers: Record<string, string> = {}, method = 'GET') => new Request(`${URL0}${path}`, { method, headers });
function setup(first: Row | null = row(7)) {
  let t = T0;
  const db = fakeDb(first);
  const logs: Record<string, unknown>[] = [];
  const s = createSignal({ db, now: () => t, log: (l) => logs.push(l) });
  return { db, logs, handle: s.handle, tick: (ms: number) => (t += ms) };
}
async function sha(text: string) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(d.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.test('the whole Signal: snapshot.json\'s fields plus the version, with a cacheable ETag', async () => {
  const { handle } = setup();
  const r = await handle(get());
  assertEquals(r.status, 200);
  const text = await r.text();
  const body = JSON.parse(text);
  assertEquals(body.signals.bpc157.score, 61);
  assertEquals(body.founders, { goal: 100, taken: 12 });
  assertEquals(body.version, 7);
  assertEquals(body.generated_at, PAYLOAD.generated_at);
  assertEquals(r.headers.get('ETag'), `"${await sha(text)}"`);   // the hash of exactly these bytes
  assertEquals(r.headers.get('Cache-Control'), CACHE_BODY);
  assertEquals(r.headers.get('X-Signal-Version'), '7');
  assertEquals(r.headers.get('X-Signal-Checked'), at(T0 - 20_000));
  assertEquals(r.headers.get('Access-Control-Allow-Origin'), '*');
  assert(r.headers.get('Access-Control-Expose-Headers')!.includes('X-Signal-Checked'));
  assertEquals(r.headers.get('Content-Type'), 'application/json; charset=utf-8');
});

Deno.test('a matching If-None-Match gets a 304 with no body, in any of its forms', async () => {
  const { handle } = setup();
  const etag = (await handle(get())).headers.get('ETag')!;
  for (const h of [etag, `W/${etag}`, `"x", ${etag}`, '*']) {
    const r = await handle(get('', { 'If-None-Match': h }));
    assertEquals(r.status, 304, h);
    assertEquals(await r.text(), '');
    assertEquals(r.headers.get('ETag'), etag);
    assertEquals(r.headers.get('X-Signal-Version'), '7');
  }
  assertEquals((await handle(get('', { 'If-None-Match': '"stale"' }))).status, 200);
  assertEquals(matches(null, etag), false);
});

Deno.test('HEAD answers like GET without the body', async () => {
  const { handle } = setup();
  const g = await handle(get());
  const h = await handle(get('', {}, 'HEAD'));
  assertEquals(h.status, 200);
  assertEquals(await h.text(), '');
  assertEquals(h.headers.get('ETag'), g.headers.get('ETag'));
});

Deno.test('one compound: its Signal and space with the totals; none yet is null; a bad id is a 400', async () => {
  const { handle } = setup();
  const r = await handle(get('/compounds/bpc157'));
  assertEquals(r.status, 200);
  assertEquals(await r.json(), {
    version: 7, published_at: at(T0 - 30_000), generated_at: PAYLOAD.generated_at, community: PAYLOAD.community,
    uses: PAYLOAD.uses, signal: { name: 'BPC-157', score: 61 }, space: [12, 30],
  });
  assertEquals((await (await handle(get('/compounds/nad-plus'))).json()).space, null);
  const none = await handle(get('/compounds/tesofensine'));
  assertEquals(none.status, 200);
  assertEquals((await none.json()).signal, null);
  for (const bad of ['BPC157', 'a', 'x'.repeat(41), '%E0%A4%A', 'bpc157%2F..']) {
    const b = await handle(get(`/compounds/${bad}`));
    assertEquals(b.status, 400, bad);
    assertEquals((await b.json()).error, 'bad_id');
  }
});

Deno.test('/version says what\'s current and who checked it last', async () => {
  const { handle } = setup();
  const r = await handle(get('/version'));
  assertEquals(r.status, 200);
  assertEquals(await r.json(), { version: 7, hash: 'a'.repeat(32), published_at: at(T0 - 30_000), checked_at: at(T0 - 20_000), checked_by: 'cron' });
  assertEquals(r.headers.get('Cache-Control'), CACHE_VERSION);
});

Deno.test('the routes, under the platform\'s path or the bare one; anything else is a 404, 405 or 204', async () => {
  assertEquals(route(new URL('https://x/signal')), { kind: 'all' });
  assertEquals(route(new URL('https://x/signal/')), { kind: 'all' });
  assertEquals(route(new URL('https://x/functions/v1/signal/version')), { kind: 'version' });
  assertEquals(route(new URL('https://x/signal/compounds/bpc157')), { kind: 'compound', id: 'bpc157' });
  assertEquals(route(new URL('https://x/signal/compounds/bpc157/more')), null);
  assertEquals(route(new URL('https://x/signals')), null);
  const { handle, db } = setup();
  const nf = await handle(get('/everything'));
  assertEquals(nf.status, 404);
  assertEquals((await nf.json()).error, 'not_found');
  const post = await handle(get('', {}, 'POST'));
  assertEquals(post.status, 405);
  assertEquals(post.headers.get('Allow'), 'GET, HEAD, OPTIONS');
  const pre = await handle(get('', { Origin: 'https://miraclehealth.us', 'Access-Control-Request-Method': 'GET' }, 'OPTIONS'));
  assertEquals(pre.status, 204);
  assertEquals(pre.headers.get('Access-Control-Allow-Origin'), '*');
  assertEquals(db.calls.length, 0);   // none of these needed the database
});

Deno.test('an instance asks the database at most every 15 seconds, and an unchanged version moves no payload', async () => {
  const { handle, db, tick } = setup();
  const first = (await handle(get())).headers.get('ETag');
  await handle(get('/compounds/bpc157'));
  tick(FRESH_MS - 1);
  await handle(get('/version'));
  assertEquals(db.calls.length, 1);                               // all three from the first read
  assertEquals(db.calls[0], ['signal_latest', { p_known: null }]);
  tick(1);
  const again = await handle(get());
  assertEquals(db.calls.length, 2);
  assertEquals(db.calls[1], ['signal_latest', { p_known: 7 }]);   // "I hold 7": the payload stays home
  assertEquals(again.headers.get('ETag'), first);                  // same version, same body, same tag
  assertEquals((await again.json()).signals.bpc157.score, 61);
  // The numbers change: the next check brings version 8 and a new tag
  db.row = row(8, { ...PAYLOAD, signals: { bpc157: { name: 'BPC-157', score: 64 } } });
  tick(FRESH_MS);
  const moved = await handle(get());
  assertEquals(moved.headers.get('X-Signal-Version'), '8');
  assert(moved.headers.get('ETag') !== first);
  assertEquals((await moved.json()).signals.bpc157.score, 64);
});

Deno.test('a version that was only checked again keeps its tag, and the new check time travels in the header', async () => {
  const { handle, db, tick } = setup();
  const first = await handle(get());
  db.row = { ...row(7), checked_at: at(T0 + 40_000) };
  tick(FRESH_MS);
  const later = await handle(get('', { 'If-None-Match': first.headers.get('ETag')! }));
  assertEquals(later.status, 304);
  assertEquals(later.headers.get('X-Signal-Checked'), at(T0 + 40_000));
});

Deno.test('a cold instance under a burst reads the database once', async () => {
  const { handle, db } = setup();
  const answers = await Promise.all(Array.from({ length: 10 }, () => handle(get())));
  assert(answers.every((a) => a.status === 200));
  assertEquals(db.calls.length, 1);
});

Deno.test('the database down: the last copy stands and is checked again in 15 seconds; with no copy, a 503', async () => {
  const { handle, db, tick, logs } = setup();
  await handle(get());
  db.fail = true;
  tick(FRESH_MS);
  const stale = await handle(get());
  assertEquals(stale.status, 200);
  assertEquals(stale.headers.get('X-Signal-Version'), '7');
  assertEquals(logs.at(-1)?.event, 'signal_read_failed');
  await handle(get());
  assertEquals(db.calls.length, 2);   // not retried on every request
  tick(FRESH_MS);
  await handle(get());
  assertEquals(db.calls.length, 3);

  const cold = setup();
  cold.db.fail = true;
  const r = await cold.handle(get());
  assertEquals(r.status, 503);
  assertEquals(r.headers.get('Retry-After'), '60');
  assertEquals(r.headers.get('Cache-Control'), 'no-store');
  assertEquals((await r.json()).error, 'unavailable');
  await cold.handle(get());
  assertEquals(cold.db.calls.length, 1);   // a few seconds before trying again
});

Deno.test('nothing published yet is a 503 too', async () => {
  const { handle } = setup(null);
  assertEquals((await handle(get('/version'))).status, 503);
});

Deno.test('the minute job stopped: the instance publishes itself, at most once a minute, and says so', async () => {
  const { handle, db, tick, logs } = setup(row(7, PAYLOAD, T0 - STALE_MS - 1_000));
  db.refreshed = { ...row(8), checked_at: at(T0), checked_by: 'api' };
  const r = await handle(get('/version'));
  assertEquals(db.calls.map((c) => c[0]), ['signal_latest', 'signal_refresh']);
  assertEquals((await r.json()).checked_by, 'api');
  assertEquals(logs[0].event, 'signal_refresh');
  // Still not running minutes later: it publishes again, but never more than once a minute
  db.refreshed = null;
  db.row = { ...row(8), checked_at: at(T0) };
  const refreshes = () => db.calls.filter((c) => c[0] === 'signal_refresh').length;
  tick(STALE_MS + FRESH_MS);
  await handle(get());
  assertEquals(refreshes(), 2);
  for (let waited = FRESH_MS; waited < HEAL_EVERY_MS; waited += FRESH_MS) {
    tick(FRESH_MS);
    await handle(get());
  }
  assertEquals(refreshes(), 2);
  tick(FRESH_MS);
  await handle(get());
  assertEquals(refreshes(), 3);
});

Deno.test('a fresh version never makes the instance publish', async () => {
  const { handle, db, tick } = setup(row(7, PAYLOAD, T0 - 60_000));
  for (let i = 0; i < 5; i++) {
    await handle(get());
    tick(FRESH_MS);
  }
  assertEquals(db.calls.some((c) => c[0] === 'signal_refresh'), false);
});
