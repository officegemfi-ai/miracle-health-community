// What the app keeps in this browser: a report written before signing in, where someone was going
// when they had to sign in first, an invite that came with a link, and the site password's key.
// Private browsing can refuse storage; every one of these then simply forgets.

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

// Where someone was going when they had to sign in first
const NEXT = 'mh_next';
export function saveNext(want) {
  try { sessionStorage.setItem(NEXT, want); } catch (_) { /* private mode */ }
}
export function takeNext() {
  let want = '';
  try { want = sessionStorage.getItem(NEXT) || ''; sessionStorage.removeItem(NEXT); } catch (_) { /* private mode */ }
  return want;
}

// An invite code that came in with an invite link, until they've joined
const INVITE = 'mh_invite';
export function saveInvite(code) {
  try { sessionStorage.setItem(INVITE, code); } catch (_) { /* private mode */ }
}
export function readInvite() {
  try { return sessionStorage.getItem(INVITE) || ''; } catch (_) { return ''; }
}
export function clearInvite() {
  try { sessionStorage.removeItem(INVITE); } catch (_) { /* private mode */ }
}

// The key the beta password opened, so it's asked once on this device
export function gateKey(slot) {
  try { return localStorage.getItem(slot); } catch (_) { return null; }
}
export function keepGateKey(slot, value) {
  try { localStorage.setItem(slot, value); } catch (_) { /* private mode */ }
}
export function forgetGateKey(slot) {
  try { localStorage.removeItem(slot); } catch (_) { /* private mode */ }
}
