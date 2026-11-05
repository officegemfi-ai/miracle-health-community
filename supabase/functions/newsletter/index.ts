// newsletter: The Signal, Miracle Health's weekly email.
//   POST {email, source} from miraclehealth.us: keeps the address, unconfirmed, and emails a link
//     to confirm it (double opt-in). Nothing else is ever sent to an address until it's confirmed.
//     From a script it's JSON both ways; from the site's form it's a form post, answered by going
//     back to miraclehealth.us/weekly/#signup-<what happened>. A form
//     field humans never see ("website") filled in means a bot: it's thanked and nothing is kept.
//   GET ?c=<token>: confirms. GET ?u=<token> (or a one-click POST to it): unsubscribes. Both go
//     back to miraclehealth.us/weekly/#confirmed (or #unsubscribed, #unknown) to say so.
//   POST {send: n} with x-admin-key: sends issue n (miraclehealth.us/weekly/<n>/email.html) to
//     every confirmed address that hasn't had it, 100 at a time (the "Weekly email" workflow).
// Emails go through Resend when RESEND_API_KEY and NEWSLETTER_FROM are set; until then sign-ups
// are kept and the confirmation emails go out once it's set up (see the sign-up's "later").
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { env, json } from '../_shared/cors.ts';
import { clientAddress, sameKey } from '../_shared/address.ts';

export type Db = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
export type Mail = { to: string; subject: string; html: string; text: string; headers?: Record<string, string> };
export type Deps = {
  db: Db;
  origins: string[];
  self: string;                         // this function's own URL, for the links in the emails
  site: string;                         // https://miraclehealth.us
  adminKey?: string;
  send?: (mails: Mail[]) => Promise<boolean>;   // undefined until an email provider is set up
  fetchIssue?: (n: number) => Promise<{ subject: string; html: string } | null>;
};

function cors(req: Request, origins: string[]): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': origins.includes(origin) ? origin : (origins[0] ?? ''),
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}
// Back to miraclehealth.us/weekly/, to the line that says what happened (the page shows the one
// its address ends with, with no script needed)
const back = (site: string, what: string) => new Response(null, { status: 303, headers: { Location: `${site}/weekly/#${what}` } });
const signedUp = (site: string, what: string) => back(site, `signup-${what}`);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function confirmMail(to: string, confirmUrl: string, unsubUrl: string): Mail {
  return {
    to,
    subject: 'Confirm your Miracle Health weekly email',
    text: `Tap to confirm you want The Signal, Miracle Health's weekly email:\n${confirmUrl}\n\nIf this wasn't you, ignore this email and nothing more will come.\nNever want these? ${unsubUrl}`,
    html: `<!doctype html><html><body style="margin:0;padding:24px;background:#FCFCFC;font-family:Arial,Helvetica,sans-serif;color:#121E1D">
<p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#6A6F6E;margin:0 0 12px">Miracle Health</p>
<h1 style="font-size:24px;line-height:1.2;margin:0 0 12px">Confirm your email</h1>
<p style="font-size:16px;line-height:1.55;margin:0 0 20px">Tap to confirm you want The Signal: once a week, what moved, new studies and FDA news. No ads, nothing for sale.</p>
<p style="margin:0 0 24px"><a href="${confirmUrl}" style="display:inline-block;padding:14px 24px;border-radius:40px;background:#D8FF3D;color:#121E1D;text-decoration:none;font-size:13px;letter-spacing:.1em;text-transform:uppercase">Confirm my email</a></p>
<p style="font-size:13px;line-height:1.5;color:#6A6F6E;margin:0">If this wasn't you, ignore this email and nothing more will come. <a href="${unsubUrl}" style="color:#6A6F6E">Never email this address</a>.</p>
</body></html>`,
    headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  };
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const url = new URL(req.url);
  const c = cors(req, deps.origins);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: c });
  // Links in the emails: confirm, unsubscribe (also one-click POST from the mail app)
  const confirm = url.searchParams.get('c');
  const unsub = url.searchParams.get('u');
  if (confirm || unsub) {
    if (req.method !== 'GET' && !(req.method === 'POST' && unsub)) return json({ error: 'GET only' }, 405);
    const token = confirm || unsub || '';
    if (!UUID.test(token)) return back(deps.site, 'unknown');
    const { data, error } = await deps.db.rpc(confirm ? 'newsletter_confirm' : 'newsletter_unsubscribe', { token });
    if (error) return back(deps.site, 'error');
    return back(deps.site, data ? (confirm ? 'confirmed' : 'unsubscribed') : 'unknown');
  }
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405, c);
  const isForm = (req.headers.get('Content-Type') ?? '').toLowerCase().startsWith('application/x-www-form-urlencoded');
  const body = (isForm
    ? Object.fromEntries(new URLSearchParams(await req.text().catch(() => '')))
    : await req.json().catch(() => ({}))) as Record<string, unknown>;

  // Confirmation emails for sign-ups from before an email provider was set up (the "Weekly
  // email" workflow runs this first)
  if (!isForm && body.confirmations !== undefined) {
    if (!(await sameKey(req.headers.get('x-admin-key'), deps.adminKey))) return json({ error: 'Not allowed' }, 401);
    if (!deps.send) return json({ error: 'No email provider set up yet (RESEND_API_KEY, NEWSLETTER_FROM)' }, 503);
    let asked = 0;
    for (let round = 0; round < 50; round++) {
      const { data, error } = await deps.db.rpc('newsletter_pending', { max_rows: 100 });
      if (error) return json({ error: 'Database', asked }, 500);
      const rows = (data as { id: number; email: string; confirm_token: string; unsub_token: string }[]) || [];
      if (!rows.length) break;
      if (!(await deps.send(rows.map((r) => confirmMail(r.email, `${deps.self}?c=${r.confirm_token}`, `${deps.self}?u=${r.unsub_token}`))))) {
        return json({ error: 'The email provider refused a batch', asked }, 502);
      }
      await deps.db.rpc('newsletter_asked', { ids: rows.map((r) => r.id) });
      asked += rows.length;
    }
    return json({ asked });
  }

  // Sending an issue (the "Weekly email" workflow)
  if (!isForm && body.send !== undefined) {
    if (!(await sameKey(req.headers.get('x-admin-key'), deps.adminKey))) return json({ error: 'Not allowed' }, 401);
    if (!deps.send || !deps.fetchIssue) return json({ error: 'No email provider set up yet (RESEND_API_KEY, NEWSLETTER_FROM)' }, 503);
    const n = Number(body.send);
    if (!Number.isInteger(n) || n < 1 || n > 10000) return json({ error: 'Which issue?' }, 400);
    const issue = await deps.fetchIssue(n);
    if (!issue) return json({ error: `Issue ${n} isn't on the site yet` }, 404);
    let sent = 0;
    for (let round = 0; round < 50; round++) {
      const { data, error } = await deps.db.rpc('newsletter_due', { issue: n, max_rows: 100 });
      if (error) return json({ error: 'Database', sent }, 500);
      const rows = (data as { id: number; email: string; unsub_token: string }[]) || [];
      if (!rows.length) break;
      const mails = rows.map((r) => {
        const u = `${deps.self}?u=${r.unsub_token}`;
        return {
          to: r.email, subject: issue.subject,
          html: issue.html.replaceAll('{{unsubscribe}}', u),
          text: `${issue.subject}\n\nRead it on the web: ${deps.site}/weekly/${n}/\n\nUnsubscribe: ${u}`,
          headers: { 'List-Unsubscribe': `<${u}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        };
      });
      if (!(await deps.send(mails))) return json({ error: 'The email provider refused a batch', sent }, 502);
      await deps.db.rpc('newsletter_sent', { ids: rows.map((r) => r.id), issue: n });
      sent += rows.length;
    }
    return json({ sent });
  }

  // A sign-up from miraclehealth.us
  const answer = (state: string, status = 200, error?: string) =>
    isForm ? signedUp(deps.site, state) : json(error ? { ok: false, error } : { ok: true, state }, status, c);
  if (!deps.origins.includes(req.headers.get('Origin') ?? '')) {
    return isForm ? signedUp(deps.site, 'error') : json({ error: 'Not allowed from here.' }, 403, c);
  }
  if (String(body.website ?? '').trim()) return answer(deps.send ? 'check' : 'later');
  const email = String(body.email ?? '').trim().slice(0, 254);
  const source = String(body.source ?? '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40);
  const { data, error } = await deps.db.rpc('newsletter_add', { email, source, address: clientAddress(req) });
  if (error) return answer('error', 500, 'Something went wrong. Try again in a minute.');
  const r = (data || {}) as { ok?: boolean; why?: string; state?: string; id?: number; token?: string; unsub?: string };
  if (!r.ok) {
    const say: Record<string, string> = {
      email: 'That doesn’t look like an email address.',
      limit: 'That’s enough sign-ups from this connection for today. Try again tomorrow.',
      busy: 'Lots of sign-ups today. Try again tomorrow.',
    };
    const why = r.why && say[r.why] ? r.why : 'error';
    return answer(why, why === 'email' ? 400 : 429, say[why] ?? 'Something went wrong.');
  }
  if (r.state === 'confirmed') return answer('confirmed');
  // New or not yet confirmed: send the link (or say it will come once email is set up)
  if (r.token && deps.send) {
    const ok = await deps.send([confirmMail(email, `${deps.self}?c=${r.token}`, `${deps.self}?u=${r.unsub}`)]);
    if (ok && r.id) await deps.db.rpc('newsletter_asked', { ids: [r.id] });
    return answer(ok ? 'check' : 'later');
  }
  return answer('later');
}

// Resend's batch API: up to 100 emails a call
export function resend(apiKey: string, from: string, fetchImpl: typeof fetch = fetch) {
  return async (mails: Mail[]): Promise<boolean> => {
    if (!mails.length) return true;
    const r = await fetchImpl('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(mails.slice(0, 100).map((m) => ({ from, to: [m.to], subject: m.subject, html: m.html, text: m.text, headers: m.headers }))),
    }).catch(() => null);
    return !!r && r.ok;
  };
}

if (import.meta.main) {
  const { url, service } = env();
  const db = createClient(url, service, { auth: { persistSession: false } });
  const site = 'https://miraclehealth.us';
  const origins = (Deno.env.get('NEWSLETTER_ORIGINS') ?? `${site},https://www.miraclehealth.us`).split(',').map((s) => s.trim()).filter(Boolean);
  const apiKey = Deno.env.get('RESEND_API_KEY') ?? '';
  const from = Deno.env.get('NEWSLETTER_FROM') ?? '';
  const send = apiKey && from ? resend(apiKey, from) : undefined;
  const fetchIssue = async (n: number) => {
    const r = await fetch(`${site}/weekly/${n}/email.html`).catch(() => null);
    if (!r || !r.ok) return null;
    const html = await r.text();
    const subject = (/<title>([^<]{3,140})<\/title>/i.exec(html)?.[1] ?? `The Signal #${n}`).trim();
    return { subject, html };
  };
  Deno.serve((req) => handle(req, {
    db: db as unknown as Db, origins, self: `${url}/functions/v1/newsletter`, site,
    adminKey: Deno.env.get('NEWSLETTER_ADMIN_KEY') ?? '', send, fetchIssue,
  }));
}
