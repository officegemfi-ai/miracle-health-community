import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert/strict';
import { handle, type Deps, type Mail } from './index.ts';

const SITE = 'https://miraclehealth.us';
const KEY = 'k'.repeat(40);
function fakeDb(answers: Record<string, unknown>) {
  const calls: [string, Record<string, unknown> | undefined][] = [];
  return {
    calls,
    rpc: (fn: string, args?: Record<string, unknown>) => {
      calls.push([fn, args]);
      const a = answers[fn];
      return Promise.resolve({ data: typeof a === 'function' ? (a as (x: unknown) => unknown)(args) : a, error: null });
    },
  };
}
const deps = (db: ReturnType<typeof fakeDb>, extra: Partial<Deps> = {}): Deps => ({
  db, origins: [SITE], self: 'https://x.supabase.co/functions/v1/newsletter', site: SITE, adminKey: KEY, ...extra,
});
const signup = (email: string, origin = SITE) => new Request('https://x.supabase.co/functions/v1/newsletter', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'cf-connecting-ip': '1.2.3.4' },
  body: JSON.stringify({ email, source: 'home' }),
});

Deno.test('a sign-up from the site is kept and, with email set up, gets a confirmation link', async () => {
  const db = fakeDb({ newsletter_add: { ok: true, state: 'new', id: 7, token: '11111111-1111-1111-1111-111111111111', unsub: '22222222-2222-2222-2222-222222222222' } });
  const sent: Mail[] = [];
  const r = await handle(signup('a@example.com'), deps(db, { send: (m) => { sent.push(...m); return Promise.resolve(true); } }));
  assertEquals(r.status, 200);
  assertEquals((await r.json()).state, 'check');
  assertEquals(sent.length, 1);
  assert(sent[0].html.includes('?c=11111111-1111-1111-1111-111111111111'));
  assertEquals(db.calls[0][1]?.address, '1.2.3.4');
  assertEquals(db.calls[1][0], 'newsletter_asked');
});

Deno.test('without an email provider the sign-up waits for its confirmation email', async () => {
  const db = fakeDb({ newsletter_add: { ok: true, state: 'new', id: 7, token: '11111111-1111-1111-1111-111111111111', unsub: '22222222-2222-2222-2222-222222222222' } });
  const r = await handle(signup('a@example.com'), deps(db));
  assertEquals((await r.json()).state, 'later');
});

Deno.test('sign-ups only come from the site, and too many are turned away', async () => {
  const db = fakeDb({ newsletter_add: { ok: false, why: 'limit' } });
  assertEquals((await handle(signup('a@example.com', 'https://evil.example'), deps(db))).status, 403);
  const r = await handle(signup('a@example.com'), deps(db));
  assertEquals(r.status, 429);
});

Deno.test('the links in the email confirm and unsubscribe, then go back to the site', async () => {
  const db = fakeDb({ newsletter_confirm: true, newsletter_unsubscribe: true });
  const c = await handle(new Request('https://x/f?c=11111111-1111-1111-1111-111111111111'), deps(db));
  assertEquals(c.headers.get('Location'), `${SITE}/weekly/#confirmed`);
  const u = await handle(new Request('https://x/f?u=11111111-1111-1111-1111-111111111111', { method: 'POST', body: 'List-Unsubscribe=One-Click' }), deps(db));
  assertEquals(u.headers.get('Location'), `${SITE}/weekly/#unsubscribed`);
  const bad = await handle(new Request('https://x/f?c=nope'), deps(db));
  assertEquals(bad.headers.get('Location'), `${SITE}/weekly/#unknown`);
});

Deno.test('sending an issue needs the admin key and goes to each confirmed address once', async () => {
  let round = 0;
  const db = fakeDb({ newsletter_due: () => (round++ === 0 ? [{ id: 1, email: 'a@example.com', unsub_token: 'u1' }] : []), newsletter_sent: null });
  const sent: Mail[] = [];
  const d = deps(db, { send: (m) => { sent.push(...m); return Promise.resolve(true); }, fetchIssue: () => Promise.resolve({ subject: 'The Signal #1', html: '<p>Hi</p><a href="{{unsubscribe}}">x</a>' }) });
  const no = await handle(new Request('https://x/f', { method: 'POST', body: JSON.stringify({ send: 1 }) }), d);
  assertEquals(no.status, 401);
  const r = await handle(new Request('https://x/f', { method: 'POST', headers: { 'x-admin-key': KEY }, body: JSON.stringify({ send: 1 }) }), d);
  assertEquals((await r.json()).sent, 1);
  assert(sent[0].html.includes('?u=u1'));
  assertEquals(sent[0].headers?.['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
});

Deno.test('without JavaScript, the form posts and goes back to the site to say what happened', async () => {
  const form = (fields: Record<string, string>, origin = SITE) => new Request('https://x.supabase.co/functions/v1/newsletter', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded', 'cf-connecting-ip': '1.2.3.4' },
    body: new URLSearchParams(fields).toString(),
  });
  const db = fakeDb({ newsletter_add: (a: unknown) => ((a as { email: string }).email === 'bad' ? { ok: false, why: 'email' } : { ok: true, state: 'new', id: 7, token: '11111111-1111-1111-1111-111111111111', unsub: '22222222-2222-2222-2222-222222222222' }) });
  const ok = await handle(form({ email: 'a@example.com', source: 'weekly' }), deps(db));
  assertEquals(ok.status, 303);
  assertEquals(ok.headers.get('Location'), `${SITE}/weekly/#signup-later`);
  const bad = await handle(form({ email: 'bad' }), deps(db));
  assertEquals(bad.headers.get('Location'), `${SITE}/weekly/#signup-email`);
  const away = await handle(form({ email: 'a@example.com' }, 'https://evil.example'), deps(db));
  assertEquals(away.headers.get('Location'), `${SITE}/weekly/#signup-error`);
});

Deno.test('a bot that fills in the hidden field is thanked, and nothing is kept', async () => {
  const db = fakeDb({ newsletter_add: { ok: true, state: 'new', id: 7, token: 't', unsub: 'u' } });
  const r = await handle(new Request('https://x.supabase.co/functions/v1/newsletter', {
    method: 'POST', headers: { Origin: SITE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'a@example.com', website: 'http://spam.example' }),
  }), deps(db));
  assertEquals((await r.json()).state, 'later');
  assertEquals(db.calls.length, 0);
});

Deno.test('a form post can never send an issue, even with a field named send', async () => {
  const db = fakeDb({ newsletter_add: { ok: true, state: 'confirmed' } });
  const r = await handle(new Request('https://x.supabase.co/functions/v1/newsletter', {
    method: 'POST', headers: { Origin: SITE, 'Content-Type': 'application/x-www-form-urlencoded', 'x-admin-key': KEY },
    body: 'send=1&email=a%40example.com',
  }), deps(db, { send: () => Promise.resolve(true), fetchIssue: () => Promise.resolve({ subject: 's', html: 'h' }) }));
  assertEquals(r.headers.get('Location'), `${SITE}/weekly/#signup-confirmed`);
  assert(!db.calls.some(([fn]) => fn === 'newsletter_due'));
});
