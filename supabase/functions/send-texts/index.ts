// send-texts: the check-in texts members asked for (Account > Check-in texts, or the box on a
// due check-in). Called every hour by the "Check-in texts" workflow with x-cron-key. Sends at
// most one text a member a day, between 9am and 8pm in their own time zone, and never names
// what they took. Nothing is sent until a Twilio messaging service is set up
// (TWILIO_MESSAGING_SERVICE_SID), which US carriers need registered first (A2P 10DLC). A reply
// of STOP is handled by Twilio, and the next send to that number turns texts off here too.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { env, json } from '../_shared/cors.ts';
import { sameKey } from '../_shared/address.ts';

export type Db = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
export type Due = { user_id: string; post_id: string; week: number; tz: string };
export type Deps = {
  db: Db;
  cronKey?: string;
  phoneOf: (userId: string) => Promise<string | null>;
  sendSms?: (to: string, body: string) => Promise<{ ok: boolean; stopped?: boolean }>;
  now?: () => Date;
  community?: string;
};

// The hour of the day where the member is
export function localHour(tz: string, at: Date): number {
  try {
    const h = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(at);
    return Number(h);
  } catch {
    return localHour('America/Los_Angeles', at);
  }
}
export const textFor = (postId: string, community = 'https://community.miraclehealth.us') =>
  `Miracle Health: one of your reports is due for a check-in. How's it going? ${community}/#/post/${postId} Reply STOP to stop these texts.`;

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!(await sameKey(req.headers.get('x-cron-key'), deps.cronKey))) return json({ error: 'Not allowed' }, 401);
  if (!deps.sendSms) return json({ sent: 0, note: 'Not set up yet: TWILIO_MESSAGING_SERVICE_SID' });
  const { data, error } = await deps.db.rpc('texts_due', { max_rows: 200 });
  if (error) return json({ error: 'Database' }, 500);
  const now = deps.now ? deps.now() : new Date();
  let sent = 0, later = 0, stopped = 0, failed = 0;
  for (const d of (data as Due[]) || []) {
    const hour = localHour(d.tz, now);
    if (hour < 9 || hour >= 20) { later += 1; continue; }
    const phone = await deps.phoneOf(d.user_id);
    if (!phone) { failed += 1; continue; }
    const r = await deps.sendSms(phone, textFor(d.post_id, deps.community));
    if (r.ok) {
      await deps.db.rpc('text_sent', { post_id: d.post_id, week: d.week });
      sent += 1;
    } else if (r.stopped) {
      await deps.db.rpc('text_stopped', { user_id: d.user_id });
      stopped += 1;
    } else failed += 1;
  }
  return json({ sent, later, stopped, failed });
}

// Twilio's Messages API through a messaging service; 21610 means the number replied STOP
export function twilio(sid: string, token: string, service: string, fetchImpl: typeof fetch = fetch) {
  return async (to: string, body: string) => {
    const r = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ MessagingServiceSid: service, To: to, Body: body }).toString(),
    }).catch(() => null);
    if (!r) return { ok: false };
    if (r.ok) return { ok: true };
    const err = await r.json().catch(() => ({})) as { code?: number };
    return { ok: false, stopped: err.code === 21610 };
  };
}

if (import.meta.main) {
  const { url, service } = env();
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
  const token = Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
  const ms = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID') ?? '';
  const phoneOf = async (id: string) => {
    const { data } = await admin.auth.admin.getUserById(id);
    const p = (data?.user?.phone ?? '').replace(/\D/g, '');
    return p ? `+${p}` : null;
  };
  Deno.serve((req) => handle(req, {
    db: admin as unknown as Db, cronKey: Deno.env.get('TEXTS_CRON_KEY') ?? '', phoneOf,
    sendSms: sid && token && ms ? twilio(sid, token, ms) : undefined,
  }));
}
