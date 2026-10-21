import { deepStrictEqual as assertEquals } from 'node:assert/strict';
import { handle } from './index.ts';

const admin = (log: string[]) => ({ auth: { admin: { deleteUser: async (id: string) => { log.push(id); return { error: null }; } } } });
const post = (body: unknown, token?: string) => new Request('http://x/delete-account', {
  method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body),
});

Deno.test('signed-out callers can delete nothing', async () => {
  const log: string[] = [];
  const res = await handle(post({ confirm: 'DELETE' }), { getUser: async () => null, admin: admin(log) });
  assertEquals(res.status, 401);
  assertEquals(log.length, 0);
});

Deno.test('a member must type DELETE', async () => {
  const log: string[] = [];
  const res = await handle(post({ confirm: 'yes' }, 't'), { getUser: async () => ({ id: 'u1' }), admin: admin(log) });
  assertEquals(res.status, 400);
  assertEquals(log.length, 0);
});

Deno.test('a member deletes only their own account', async () => {
  const log: string[] = [];
  const res = await handle(post({ confirm: 'DELETE', user_id: 'someone-else' }, 't'), { getUser: async () => ({ id: 'u1' }), admin: admin(log) });
  assertEquals(res.status, 200);
  assertEquals(log, ['u1']);
});
