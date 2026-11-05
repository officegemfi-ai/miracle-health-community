import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert/strict';
import { handle, localHour, textFor } from './index.ts';

const KEY = 'c'.repeat(40);
const due = [
  { user_id: 'u-ny', post_id: 'p1', week: 2, tz: 'America/New_York' },
  { user_id: 'u-la', post_id: 'p2', week: 6, tz: 'America/Los_Angeles' },
  { user_id: 'u-stop', post_id: 'p3', week: 12, tz: 'America/New_York' },
];
function fakeDb() {
  const calls: [string, Record<string, unknown> | undefined][] = [];
  return { calls, rpc: (fn: string, args?: Record<string, unknown>) => { calls.push([fn, args]); return Promise.resolve({ data: fn === 'texts_due' ? due : null, error: null }); } };
}
const req = (key = KEY) => new Request('https://x/f', { method: 'POST', headers: { 'x-cron-key': key } });

Deno.test('only the workflow can run it', async () => {
  const r = await handle(req('wrong'), { db: fakeDb(), cronKey: KEY, phoneOf: () => Promise.resolve('+15550000000') });
  assertEquals(r.status, 401);
});

Deno.test('without a messaging service nothing is sent', async () => {
  const db = fakeDb();
  const r = await handle(req(), { db, cronKey: KEY, phoneOf: () => Promise.resolve('+15550000000') });
  assertEquals((await r.json()).sent, 0);
  assertEquals(db.calls.length, 0);
});

Deno.test('texts go between 9am and 8pm where the member is, and STOP turns them off', async () => {
  const db = fakeDb();
  const texts: [string, string][] = [];
  // 14:00 UTC: 9am in New York, 6am in Los Angeles
  const r = await handle(req(), {
    db, cronKey: KEY, now: () => new Date('2026-11-05T14:00:00Z'),
    phoneOf: (id) => Promise.resolve(id === 'u-stop' ? '+15550000003' : '+15550000001'),
    sendSms: (to, body) => { texts.push([to, body]); return Promise.resolve(to === '+15550000003' ? { ok: false, stopped: true } : { ok: true }); },
  });
  const out = await r.json();
  assertEquals(out, { sent: 1, later: 1, stopped: 1, failed: 0 });
  assert(db.calls.some(([fn, a]) => fn === 'text_sent' && a?.post_id === 'p1' && a?.week === 2));
  assert(db.calls.some(([fn, a]) => fn === 'text_stopped' && a?.user_id === 'u-stop'));
});

Deno.test('the text never names what they took', () => {
  const t = textFor('abc');
  assert(t.includes('#/post/abc'));
  assert(t.includes('Reply STOP'));
  assert(!/bpc|tirzepatide|semaglutide/i.test(t));
  assertEquals(localHour('Not/AZone', new Date('2026-11-05T17:00:00Z')), 9);
});
