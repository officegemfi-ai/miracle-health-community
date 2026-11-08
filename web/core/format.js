// Numbers, counts and times the way the app writes them. Pure: nothing in core/ touches the page,
// the network or the store, so each rule can be tested on its own (tests/web).

export const fmt1 = (x) => (x == null ? '–' : Number(x).toFixed(1));

export const fmtN = (x) => (x == null ? '–' : Number(x).toLocaleString('en-US'));

export const plural = (n, one, many = `${one}s`) => `${fmtN(n)} ${Number(n) === 1 ? one : many}`;

// How long ago, the way a feed says it: just now, 5m, 3h, 2d, then the date
export function ago(iso, now = Date.now()) {
  const s = (now - new Date(iso).getTime()) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
