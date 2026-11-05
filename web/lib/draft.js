// A report written before signing in ("Share how it went" from the Library, signed out): the
// words wait in this tab's session storage while the visitor signs in, then fill the new-post
// page. Nothing leaves the device until they press Post, and it's forgotten after six hours or
// once it's posted.
const KEY = 'mh_draft';
const KEEP = 6 * 3600 * 1000;

export function saveGuestDraft({ cid = '', body = '' } = {}) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ cid: String(cid).slice(0, 200), body: String(body).slice(0, 10000), at: Date.now() })); } catch (_) { /* private mode */ }
}
export function readGuestDraft() {
  try {
    const d = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (d && typeof d.body === 'string' && Date.now() - Number(d.at) < KEEP) return d;
  } catch (_) { /* private mode or a broken value */ }
  return null;
}
export function clearGuestDraft() {
  try { sessionStorage.removeItem(KEY); } catch (_) { /* private mode */ }
}
