// Who's calling, for counts only (the same rule as Sig's chat, ask/index.ts): the address
// Cloudflare in front of Supabase saw, which callers can't change; failing that, the last address
// the proxies added to x-forwarded-for. An IPv6 address counts as its /64 network. The database
// turns it into a daily code and never stores the address itself.
export function clientAddress(req: Request): string {
  const ip = (req.headers.get('cf-connecting-ip') ??
    (req.headers.get('x-forwarded-for') ?? '').split(',').map((x) => x.trim()).filter(Boolean).pop() ??
    req.headers.get('x-real-ip') ?? '').trim().slice(0, 80);
  return ip.includes(':') ? v6net(ip) : ip;
}
function v6net(ip: string): string {
  const a = ip.replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped) return mapped[1];
  const [head, tail] = a.split('::');
  const h = head ? head.split(':') : [];
  const t = tail === undefined ? [] : tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '') || '0').join(':')}::/64`;
}

// A key compared without leaking how much of it matched
export async function sameKey(given: string | null, want: string | undefined): Promise<boolean> {
  if (!given || !want || want.length < 32) return false;
  const hash = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([hash(given), hash(want)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
