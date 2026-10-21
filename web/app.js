// Miracle Health Community · web app
// Plain JavaScript, no build step. It talks to Supabase with the public key only;
// who can see or change what is enforced by the database, not by this file.

const C = window.MH_CONFIG || {};
let sb = null;   // made in boot(), once the site password (if the site has one) unlocks the key
function connect(anonKey) {
  sb = window.supabase.createClient(C.supabaseUrl, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
}

const app = document.getElementById('app');
const nav = document.getElementById('nav');
const S = { session: null, me: null, compounds: [], rules: null };

const REASONS = [
  ['sourcing', 'Selling or sourcing (rule 1)'],
  ['dosing', 'Telling others what to take (rule 2)'],
  ['medical_misinfo', 'Dangerous medical claims (rule 3)'],
  ['harassment', 'Harassment or hate (rule 4)'],
  ['personal_info', 'Private information (rule 5)'],
  ['spam', 'Spam or self-promotion (rule 6)'],
  ['off_topic', 'Not about peptides (rule 7)'],
  ['underage', 'Someone under 18 (rule 8)'],
  ['self_harm', 'Someone may be at risk (rule 10)'],
  ['other', 'Something else'],
];
const MOD_REASONS = [
  'Rule 1: sourcing or selling', 'Rule 2: dosing instructions', 'Rule 3: dangerous medical claims',
  'Rule 4: harassment', 'Rule 5: private information', 'Rule 6: spam or self-promotion',
  'Rule 7: not about peptides', 'Rule 8: under 18', 'Rule 9: fake account or vote ring', 'Rule 10: self-harm (reached out)',
  'Not a rule break',
];

// ---------------------------------------------------------------------------
// DOM helper: text is always inserted as text, never as HTML
// ---------------------------------------------------------------------------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}
function render(...nodes) {
  app.replaceChildren(...nodes.flat().filter(Boolean));
  app.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
const msgBox = () => h('div', { role: 'alert', 'aria-live': 'polite' });
function say(box, text, kind = 'err') {
  box.replaceChildren(text ? h('div', { class: kind }, text) : '');
}
function friendly(error) {
  if (!error) return '';
  const m = error.message || String(error);
  if (error.code === '23505') return 'Already done.';
  if (/row-level security/i.test(m)) return 'You can’t do that right now.';
  if (/permission denied/i.test(m)) return 'You can’t do that.';
  return m;
}
function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}
const isMod = () => !!S.me && ['moderator', 'admin'].includes(S.me.role);

// ---------------------------------------------------------------------------
// Analytics and errors: optional, and never given health content
// ---------------------------------------------------------------------------
function loadScript(src) {
  return new Promise((ok, fail) => {
    const s = h('script', { src, async: true, crossorigin: 'anonymous' });
    s.onload = ok; s.onerror = fail; document.head.append(s);
  });
}
async function startTelemetry() {
  if (C.posthogKey) {
    try {
      await loadScript(`${C.posthogAssets || 'https://us-assets.i.posthog.com'}/static/array.js`);
      window.posthog?.init(C.posthogKey, {
        api_host: C.posthogHost || 'https://us.i.posthog.com',
        autocapture: false,            // would capture post titles
        capture_pageview: false,       // we send screen names only
        disable_session_recording: true,
        person_profiles: 'identified_only',  // turn on "Discard client IP data" in PostHog's project settings
      });
    } catch (_) { /* analytics is optional */ }
  }
  if (C.sentryDsn && C.sentryBundle) {
    try {
      await loadScript(C.sentryBundle);
      window.Sentry?.init({
        dsn: C.sentryDsn, environment: C.environment || 'live', sendDefaultPii: false,
        beforeBreadcrumb: (b) => (b.category === 'ui.input' || b.category === 'fetch' ? null : b),
        beforeSend: (event) => { if (event.request) delete event.request.data; return event; },
      });
    } catch (_) { /* error tracking is optional */ }
  }
}
function track(event, props) {
  try { window.posthog?.capture?.(event, props || {}); } catch (_) { /* optional */ }
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const [name, arg] = path.split('/');
  return { name: name || 'feed', arg: arg ? decodeURIComponent(arg) : undefined, q: new URLSearchParams(qs || '') };
}
function setNav(name) {
  nav.querySelectorAll('a').forEach((a) => a.toggleAttribute('aria-current', a.dataset.nav === name));
  nav.querySelectorAll('a[aria-current]').forEach((a) => a.setAttribute('aria-current', 'page'));
}
const ROUTES = {
  feed: () => renderFeed(), post: (r) => renderPost(r.arg), new: () => renderNew(),
  rules: () => renderRules(), account: () => renderAccount(), mod: (r) => renderMod(r.arg || 'queue'),
};
async function route() {
  if (!sb) return;   // still behind the site password
  const r = parseHash();
  if (r.name === 'join' && r.arg) {
    try { sessionStorage.setItem('mh_invite', r.arg.toUpperCase()); } catch (_) { /* private mode */ }
  }
  if (r.name === 'rules' && !S.me) return renderRules();
  if (!S.session) return renderSignIn();
  if (!S.me) return renderSignup();
  const name = ROUTES[r.name] ? r.name : 'feed';
  if (name === 'mod' && !isMod()) { location.hash = '#/feed'; return; }
  setNav(name);
  track('screen', { screen: name });
  await ROUTES[name](r);
}
window.addEventListener('hashchange', () => { route(); });

async function loadMe() {
  const { data, error } = await sb.rpc('me');
  S.me = !error && Array.isArray(data) && data[0] ? data[0] : null;
  if (S.me && !S.compounds.length) {
    const r = await sb.from('compounds').select('id,name,category').order('name');
    S.compounds = r.data || [];
  }
  // The menu appears only once everything is loaded, so a tap on it can't be
  // undone by the jump to the feed that follows sign-in
  nav.hidden = !S.me;
  nav.querySelector('[data-nav=mod]').hidden = !isMod();
}

// ---------------------------------------------------------------------------
// Site password (for the beta). When the site has one, config.js carries the
// public API key encrypted with it, so without the password the app can't reach
// the community at all. This browser remembers the key until the password changes.
// ---------------------------------------------------------------------------
const fromB64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
const toB64 = (u8) => btoa(String.fromCharCode(...u8));
async function gateDerive(g, password) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(g.salt), iterations: g.iter }, base, 256);
  return new Uint8Array(bits);
}
async function gateOpen(g, raw) {
  try {
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(g.iv) }, key, fromB64(g.ct));
    return new TextDecoder().decode(plain);
  } catch (_) {
    return null;
  }
}
async function unlock() {
  const g = C.gate;
  if (!g) return C.supabaseAnonKey;
  const slot = `mh_gate:${g.salt}`;   // test and live remember their own
  let saved = null;
  try { saved = localStorage.getItem(slot); } catch (_) { /* private mode */ }
  if (saved) {
    const key = await gateOpen(g, fromB64(saved));
    if (key) return key;
    try { localStorage.removeItem(slot); } catch (_) { /* private mode */ }
  }
  return new Promise((resolve) => {
    const msg = msgBox();
    const pw = h('input', { class: 'input', type: 'password', id: 'site-password', autocomplete: 'current-password', required: true });
    const go = h('button', { class: 'btn brand', type: 'submit' }, 'Enter');
    render(h('section', { class: 'hero' },
      h('h1', {}, 'Private beta'),
      h('p', {}, 'The Miracle Health community is open to invited testers for now. Enter the beta password to continue.'),
      h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          go.disabled = true; say(msg, '');
          const raw = await gateDerive(g, pw.value);
          const key = await gateOpen(g, raw);
          go.disabled = false;
          if (!key) { say(msg, 'That password isn’t right.'); pw.select(); return; }
          try { localStorage.setItem(slot, toB64(raw)); } catch (_) { /* private mode */ }
          resolve(key);
        },
      }, h('label', { class: 'f', for: 'site-password' }, h('span', {}, 'Beta password'), pw), go, msg)));
    pw.focus();
  });
}

async function boot() {
  startTelemetry();
  S.rules = await fetch('rules.json').then((r) => r.json()).catch(() => null);
  const foot = document.getElementById('foot-text');
  if (S.rules?.footer) foot.textContent = S.rules.footer;
  if (C.contactEmail) foot.append(' Contact the moderators: ', h('a', { href: `mailto:${C.contactEmail}` }, C.contactEmail));
  connect(await unlock());
  const { data } = await sb.auth.getSession();
  S.session = data.session;
  sb.auth.onAuthStateChange((_event, session) => { S.session = session; });
  if (S.session) await loadMe();
  await route();
}

// ---------------------------------------------------------------------------
// Sign in with a phone number and a texted code
// ---------------------------------------------------------------------------
function e164(raw) {
  const s = String(raw || '').trim();
  if (s.startsWith('+')) { const d = s.replace(/[^\d]/g, ''); return d.length >= 8 ? `+${d}` : null; }
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return null;
}
let turnstileToken = null;
async function mountTurnstile(box) {
  if (!C.turnstileSiteKey) return;          // local development
  turnstileToken = null;
  if (!window.turnstile) await loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
  window.turnstile.render(box, {
    sitekey: C.turnstileSiteKey,
    callback: (t) => { turnstileToken = t; },
    'expired-callback': () => { turnstileToken = null; },
  });
}

function renderSignIn() {
  nav.hidden = true;
  const msg = msgBox();
  const phone = h('input', { class: 'input', type: 'tel', autocomplete: 'tel', inputmode: 'tel', id: 'phone', required: true, placeholder: '(555) 123-4567' });
  const ts = h('div', { class: 'turnstile' });
  const send = h('button', { class: 'btn brand', type: 'submit' }, 'Text me a code');
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const p = e164(phone.value);
      if (!p) return say(msg, 'Enter a US mobile number, or a full number starting with +.');
      if (C.turnstileSiteKey && !turnstileToken) return say(msg, 'One moment: finish the check above the button.');
      send.disabled = true; say(msg, '');
      const { error } = await sb.auth.signInWithOtp({ phone: p, options: { captchaToken: turnstileToken || undefined } });
      send.disabled = false;
      if (error) { say(msg, friendly(error)); if (window.turnstile) window.turnstile.reset(); return; }
      renderCode(p);
    },
  },
  h('label', { class: 'f', for: 'phone' }, h('span', {}, 'Your mobile number'), phone),
  ts, send, msg);
  render(h('section', { class: 'hero' },
    h('h1', {}, 'The Miracle Health community'),
    h('p', {}, 'Real experiences with peptides, from adults who took them: what for, how long, and whether it was better, the same or worse than before they started.'),
    h('p', { class: 'small muted' }, 'Invite-only while we start. We text you a code to sign in. Your number is never shown to anyone.'),
    form,
    h('p', { class: 'small' }, h('a', { href: '#/rules' }, 'Read the community rules'))));
  mountTurnstile(ts);
}

function renderCode(phone) {
  const msg = msgBox();
  const code = h('input', { class: 'input', inputmode: 'numeric', autocomplete: 'one-time-code', id: 'code', maxlength: 8, required: true });
  const go = h('button', { class: 'btn brand', type: 'submit' }, 'Sign in');
  render(h('section', { class: 'hero' },
    h('h1', {}, 'Enter the code'),
    h('p', {}, `We texted a code to ${phone}.`),
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); go.disabled = true; say(msg, '');
        const { data, error } = await sb.auth.verifyOtp({ phone, token: code.value.trim(), type: 'sms' });
        go.disabled = false;
        if (error) return say(msg, friendly(error));
        S.session = data.session; await loadMe();
        track('signed_in');
        if (!S.me) return renderSignup();
        location.hash = '#/feed'; route();
      },
    }, h('label', { class: 'f', for: 'code' }, h('span', {}, 'Code'), code), go, msg),
    h('p', { class: 'small' }, h('button', { class: 'lnk', type: 'button', onclick: () => renderSignIn() }, 'Use a different number'))));
}

function renderSignup() {
  nav.hidden = true;
  const msg = msgBox();
  let saved = '';
  try { saved = sessionStorage.getItem('mh_invite') || ''; } catch (_) { /* private mode */ }
  const invite = h('input', { class: 'input', id: 'invite', required: true, autocomplete: 'off', value: saved, placeholder: 'From your invite link' });
  const handle = h('input', { class: 'input', id: 'handle', required: true, autocomplete: 'nickname', maxlength: 20, placeholder: 'letters, numbers, _' });
  const adult = h('input', { type: 'checkbox', id: 'adult' });
  const rules = h('input', { type: 'checkbox', id: 'rules-ok' });
  const health = h('input', { type: 'checkbox', id: 'health-ok' });
  const go = h('button', { class: 'btn brand', type: 'submit' }, 'Join');
  render(h('section', { class: 'hero' },
    h('h1', {}, 'Almost there'),
    h('p', {}, 'Pick a handle. It’s the only name anyone sees, so don’t use your real name.'),
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (!adult.checked) return say(msg, 'Miracle Health is for adults 18 and over.');
        if (!rules.checked) return say(msg, 'Read and accept the community rules to join.');
        if (!health.checked) return say(msg, 'To join, agree to how what you post about your health is collected and shown.');
        go.disabled = true; say(msg, '');
        const { error } = await sb.rpc('complete_signup', {
          handle: handle.value.trim(), invite_code: invite.value.trim(), confirm_adult: true,
          rules_version: S.rules?.version || '', health_data_consent: true,
        });
        go.disabled = false;
        if (error) return say(msg, friendly(error));
        try { sessionStorage.removeItem('mh_invite'); } catch (_) { /* private mode */ }
        await loadMe(); track('signed_up');
        location.hash = '#/feed'; route();
      },
    },
    h('label', { class: 'f', for: 'invite' }, h('span', {}, 'Invite code'), invite),
    h('label', { class: 'f', for: 'handle' }, h('span', {}, 'Handle'), handle),
    h('label', { class: 'check', for: 'adult' }, adult, h('span', {}, 'I’m 18 or older.')),
    h('label', { class: 'check', for: 'rules-ok' }, rules, h('span', {}, 'I’ve read the ', h('a', { href: '#/rules', target: '_blank', rel: 'noopener' }, 'community rules'), ' and will follow them.')),
    h('label', { class: 'check', for: 'health-ok' }, health, h('span', {},
      'I agree that what I post about my health is stored and shown to other members',
      C.privacyUrl ? [', as the ', h('a', { href: C.privacyUrl, target: '_blank', rel: 'noopener' }, 'privacy notice'), ' explains.'] : '.')),
    go, msg),
    h('p', { class: 'small' }, h('button', { class: 'lnk', type: 'button', onclick: async () => { await sb.auth.signOut(); S.session = null; renderSignIn(); } }, 'Sign out'))));
}

// ---------------------------------------------------------------------------
// Votes and reports (shared by posts and comments)
// ---------------------------------------------------------------------------
function voteWidget(kind, item) {
  const table = kind === 'post' ? 'post_votes' : 'comment_votes';
  const key = kind === 'post' ? 'post_id' : 'comment_id';
  const count = h('b', {}, String(item.score));
  const up = h('button', { type: 'button', 'aria-label': 'Helpful', 'aria-pressed': String(item.my_vote === 1) }, '▲');
  const down = h('button', { type: 'button', 'aria-label': 'Not helpful', 'aria-pressed': String(item.my_vote === -1) }, '▼');
  const box = h('span', { class: 'votes' }, up, count, down);
  if (item.is_mine || item.status !== 'visible') { up.disabled = true; down.disabled = true; return box; }
  const cast = async (value) => {
    const prev = item.my_vote ?? null;
    let res;
    if (prev === value) res = await sb.from(table).delete().eq(key, item.id);
    else if (prev === null) res = await sb.from(table).insert({ [key]: item.id, value });
    else res = await sb.from(table).update({ value }).eq(key, item.id);
    if (res.error) { alert(friendly(res.error)); return; }
    const next = prev === value ? null : value;
    item.score += (next ?? 0) - (prev ?? 0);
    item.my_vote = next;
    count.textContent = String(item.score);
    up.setAttribute('aria-pressed', String(next === 1));
    down.setAttribute('aria-pressed', String(next === -1));
    track('vote', { kind });
  };
  up.addEventListener('click', () => cast(1));
  down.addEventListener('click', () => cast(-1));
  return box;
}

function openReport(kind, id) {
  const msg = msgBox();
  const note = h('textarea', { class: 'input', maxlength: 500, rows: 3, placeholder: 'Optional: what’s wrong?' });
  const radios = REASONS.map(([v, label], i) => h('label', { class: 'check' },
    h('input', { type: 'radio', name: 'reason', value: v, checked: i === 0 }), h('span', {}, label)));
  const send = h('button', { class: 'btn brand', type: 'submit' }, 'Send report');
  const dlg = h('dialog', { 'aria-label': 'Report' },
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const reason = dlg.querySelector('input[name=reason]:checked')?.value || 'other';
        send.disabled = true;
        const { error } = await sb.from('reports').insert({ target_kind: kind, target_id: id, reason, note: note.value.trim() || null });
        send.disabled = false;
        if (error) return say(msg, friendly(error));
        track('report', { kind, reason });
        dlg.replaceChildren(h('div', { class: 'pad' },
          h('h2', {}, 'Thanks, a moderator will look'),
          reason === 'self_harm'
            ? h('p', {}, 'If someone is in danger right now, call 911. For a crisis, call or text 988 (US).')
            : h('p', { class: 'muted' }, 'They never see who reported them.'),
          h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Close')));
      },
    },
    h('h2', {}, `Report this ${kind}`), ...radios,
    h('label', { class: 'f' }, h('span', {}, 'Details'), note),
    h('div', { class: 'row' }, send, h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel')), msg));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

function statusChip(item) {
  if (item.status === 'held') return h('span', { class: 'chip held', title: item.status_reason || '' }, 'Waiting for a moderator · only you can see it');
  if (item.status === 'removed') return h('span', { class: 'chip removed' }, `Removed${item.status_reason ? `: ${item.status_reason}` : ''}`);
  return null;
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------
function compoundSelect(selected, opts = {}) {
  const groups = {};
  S.compounds.forEach((c) => { (groups[c.category] ||= []).push(c); });
  return h('select', { class: 'input', id: opts.id || 'compound', required: opts.required || false },
    opts.allLabel ? h('option', { value: '' }, opts.allLabel) : h('option', { value: '', disabled: true, selected: !selected }, 'Choose a compound'),
    Object.keys(groups).sort().map((g) => h('optgroup', { label: g },
      groups[g].map((c) => h('option', { value: c.id, selected: c.id === selected }, c.name)))));
}

function postCard(p) {
  return h('article', { class: 'card', 'data-post': p.id },
    h('div', { class: 'row' },
      h('span', { class: 'chip' }, p.compound_name),
      h('span', { class: 'chip' }, p.kind === 'question' ? 'Question' : 'Experience'),
      statusChip(p)),
    h('a', { class: 'post-t', href: `#/post/${encodeURIComponent(p.id)}` }, p.title),
    h('div', { class: 'excerpt' }, p.body),
    h('div', { class: 'meta' },
      voteWidget('post', p),
      h('span', {}, `@${p.author_handle}`),
      h('span', {}, ago(p.created_at)),
      h('a', { href: `#/post/${encodeURIComponent(p.id)}` }, `${p.comment_count} comment${p.comment_count === 1 ? '' : 's'}`)));
}

async function renderFeed() {
  const { q } = parseHash();
  const c = q.get('c') || '';
  const pick = compoundSelect(c, { id: 'filter', allLabel: 'All compounds' });
  pick.addEventListener('change', () => { location.hash = pick.value ? `#/feed?c=${encodeURIComponent(pick.value)}` : '#/feed'; });
  const list = h('div', {}, h('p', { class: 'muted' }, 'Loading…'));
  render(
    S.me.status === 'suspended' ? h('div', { class: 'note' }, `Your account is suspended until ${new Date(S.me.suspended_until).toLocaleString()}. You can read, but not post or comment.`) : null,
    h('div', { class: 'row' }, h('h1', { class: 'grow' }, 'Feed'), h('a', { class: 'btn brand sm', href: '#/new' }, 'New post')),
    h('label', { class: 'f', for: 'filter' }, h('span', { class: 'sr' }, 'Compound'), pick),
    list);
  let query = sb.from('feed').select('*').order('created_at', { ascending: false }).limit(50);
  if (c) query = query.eq('compound_id', c);
  const { data, error } = await query;
  if (error) return list.replaceChildren(h('div', { class: 'err' }, friendly(error)));
  const rows = (data || []).filter((p) => p.status === 'visible' || p.is_mine);
  list.replaceChildren(...(rows.length ? rows.map(postCard)
    : [h('div', { class: 'card' }, h('p', {}, 'Nothing here yet.'), h('a', { class: 'btn brand sm', href: '#/new' }, 'Share your experience'))]));
}

// ---------------------------------------------------------------------------
// One post and its comments
// ---------------------------------------------------------------------------
async function renderPost(id) {
  render(h('p', { class: 'muted pad' }, 'Loading…'));
  const [{ data: posts, error }, { data: comments }] = await Promise.all([
    sb.from('feed').select('*').eq('id', id).limit(1),
    sb.from('thread_comments').select('*').eq('post_id', id).order('created_at', { ascending: true }),
  ]);
  const p = posts && posts[0];
  if (error || !p) {
    return render(h('p', { class: 'pad' }, 'This post isn’t available. It may have been removed.'), h('a', { href: '#/feed' }, '← Back to the feed'));
  }
  const msg = msgBox();
  const bodyBox = h('div', { class: 'body' }, p.body);
  const actions = h('div', { class: 'row' });
  if (!p.is_mine && p.status === 'visible') {
    actions.append(
      h('button', { class: 'btn sm', type: 'button', onclick: () => openReport('post', p.id) }, 'Report'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => openReport('member', p.author_id) }, `Report @${p.author_handle}`));
  }
  if (p.is_mine && p.status !== 'removed') {
    actions.append(
      h('button', { class: 'btn sm', type: 'button', onclick: () => editPost(p, bodyBox, msg) }, 'Edit'),
      h('button', {
        class: 'btn sm danger', type: 'button',
        onclick: async () => {
          if (!confirm('Delete this post and its comments? This can’t be undone.')) return;
          const { error: e } = await sb.from('posts').delete().eq('id', p.id);
          if (e) return say(msg, friendly(e));
          location.hash = '#/feed';
        },
      }, 'Delete'));
  }
  const visibleComments = (comments || []).filter((c) => c.status === 'visible' || c.is_mine);
  const list = h('div', {}, visibleComments.map((c) => commentView(c)));
  // The count follows the list as comments are added or deleted on this page
  const heading = h('h2', {});
  const recount = () => { heading.textContent = `Comments (${list.children.length})`; };
  recount();
  new MutationObserver(recount).observe(list, { childList: true });
  const box = h('textarea', { class: 'input', id: 'comment', maxlength: 5000, rows: 4, placeholder: 'Add your experience or a question' });
  const send = h('button', { class: 'btn brand', type: 'submit' }, 'Comment');
  const cmsg = msgBox();
  const form = p.status === 'visible' && (S.me.status !== 'suspended')
    ? h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (!box.value.trim()) return;
        send.disabled = true;
        const { data, error: ce } = await sb.from('comments').insert({ post_id: p.id, body: box.value.trim() }).select('id,status,status_reason');
        send.disabled = false;
        if (ce) return say(cmsg, friendly(ce));
        track('comment');
        const row = data && data[0];
        if (row && row.status === 'held') say(cmsg, 'Saved, and waiting for a moderator. Only you can see it for now.', 'note');
        box.value = '';
        const { data: fresh } = await sb.from('thread_comments').select('*').eq('id', row.id).limit(1);
        if (fresh && fresh[0]) list.append(commentView(fresh[0]));
      },
    }, h('label', { class: 'f', for: 'comment' }, h('span', {}, 'Comment'), box), send, cmsg)
    : null;
  render(
    h('p', {}, h('a', { href: '#/feed' }, '← Feed')),
    h('article', { class: 'card' },
      h('div', { class: 'row' }, h('span', { class: 'chip' }, p.compound_name), h('span', { class: 'chip' }, p.kind === 'question' ? 'Question' : 'Experience'), statusChip(p)),
      h('h1', {}, p.title), bodyBox,
      h('div', { class: 'meta' }, voteWidget('post', p), h('span', {}, `@${p.author_handle}`), h('span', {}, ago(p.created_at)), p.edited_at ? h('span', {}, 'edited') : null),
      actions, msg),
    heading, list, form);
}

function editPost(p, bodyBox, msg) {
  const title = h('input', { class: 'input', value: p.title, maxlength: 140 });
  const body = h('textarea', { class: 'input', maxlength: 10000 });
  body.value = p.body;
  const save = h('button', { class: 'btn brand sm', type: 'submit' }, 'Save');
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault(); save.disabled = true;
      const { error } = await sb.from('posts').update({ title: title.value.trim(), body: body.value.trim() }).eq('id', p.id);
      save.disabled = false;
      if (error) return say(msg, friendly(error));
      renderPost(p.id);
    },
  }, h('label', { class: 'f' }, h('span', {}, 'Title'), title), h('label', { class: 'f' }, h('span', {}, 'Post'), body),
  h('div', { class: 'row' }, save, h('button', { class: 'btn sm', type: 'button', onclick: () => renderPost(p.id) }, 'Cancel')));
  bodyBox.replaceWith(form);
}

function commentView(c) {
  const msg = msgBox();
  const body = h('div', { class: 'body' }, c.body);
  const tools = h('span', { class: 'row' });
  if (!c.is_mine && c.status === 'visible') {
    tools.append(h('button', { class: 'lnk xs', type: 'button', onclick: () => openReport('comment', c.id) }, 'Report'));
  }
  if (c.is_mine && c.status !== 'removed') {
    tools.append(
      h('button', {
        class: 'lnk xs', type: 'button',
        onclick: () => {
          const t = h('textarea', { class: 'input', maxlength: 5000 }); t.value = c.body;
          const f = h('form', {
            onsubmit: async (e) => {
              e.preventDefault();
              const { error } = await sb.from('comments').update({ body: t.value.trim() }).eq('id', c.id);
              if (error) return say(msg, friendly(error));
              c.body = t.value.trim(); body.textContent = c.body; f.replaceWith(body);
            },
          }, t, h('button', { class: 'btn sm', type: 'submit' }, 'Save'));
          body.replaceWith(f);
        },
      }, 'Edit'),
      h('button', {
        class: 'lnk xs', type: 'button',
        onclick: async () => {
          if (!confirm('Delete this comment?')) return;
          const { error } = await sb.from('comments').delete().eq('id', c.id);
          if (error) return say(msg, friendly(error));
          wrap.remove();
        },
      }, 'Delete'));
  }
  const wrap = h('div', { class: 'comment', 'data-comment': c.id },
    h('div', { class: 'meta' }, h('b', {}, `@${c.author_handle}`), h('span', {}, ago(c.created_at)), statusChip(c)),
    body, h('div', { class: 'meta' }, voteWidget('comment', c), tools), msg);
  return wrap;
}

// ---------------------------------------------------------------------------
// New post
// ---------------------------------------------------------------------------
function renderNew() {
  if (S.me.status === 'suspended') return render(h('div', { class: 'note' }, 'Your account is suspended, so you can’t post right now.'));
  const msg = msgBox();
  const pick = compoundSelect('', { id: 'compound', required: true });
  const kindExp = h('input', { type: 'radio', name: 'kind', value: 'experience', checked: true });
  const kindQ = h('input', { type: 'radio', name: 'kind', value: 'question' });
  const title = h('input', { class: 'input', id: 'title', maxlength: 140, required: true, placeholder: 'e.g. Week 4 on BPC-157 for a knee injury' });
  const body = h('textarea', { class: 'input', id: 'body', maxlength: 10000, required: true, placeholder: 'What you took it for, how long, and how it compares to before you started.' });
  const go = h('button', { class: 'btn brand', type: 'submit' }, 'Post');
  render(
    h('h1', {}, 'New post'),
    h('div', { class: 'note' }, 'Share what you did and how it went. No sourcing or sellers (rule 1), and don’t tell others what to take (rule 2).'),
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (!pick.value) return say(msg, 'Choose a compound.');
        go.disabled = true; say(msg, '');
        const { data, error } = await sb.from('posts')
          .insert({ compound_id: pick.value, kind: kindQ.checked ? 'question' : 'experience', title: title.value.trim(), body: body.value.trim() })
          .select('id,status');
        go.disabled = false;
        if (error) return say(msg, friendly(error));
        track('post', { kind: kindQ.checked ? 'question' : 'experience' });
        location.hash = `#/post/${encodeURIComponent(data[0].id)}`;
      },
    },
    h('label', { class: 'f', for: 'compound' }, h('span', {}, 'Compound'), pick),
    h('div', { class: 'row' }, h('label', { class: 'check' }, kindExp, h('span', {}, 'My experience')), h('label', { class: 'check' }, kindQ, h('span', {}, 'A question'))),
    h('label', { class: 'f', for: 'title' }, h('span', {}, 'Title'), title),
    h('label', { class: 'f', for: 'body' }, h('span', {}, 'Post'), body),
    go, msg));
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------
function renderRules() {
  const R = S.rules;
  if (!R) return render(h('p', { class: 'pad' }, 'The rules couldn’t load. Refresh to try again.'));
  render(
    h('h1', {}, 'Community rules'),
    h('p', {}, R.intro),
    ...R.rules.map((r) => h('div', { class: 'rule' },
      h('b', {}, `${r.n}. ${r.title}`), h('div', {}, r.text),
      (r.ok || r.not_ok) ? h('div', { class: 'ex' },
        r.ok ? h('span', {}, `Fine: “${r.ok}”`) : null,
        r.not_ok ? h('span', {}, `Not fine: “${r.not_ok}”`) : null) : null)),
    h('h2', {}, 'What happens when a rule is broken'),
    h('ul', {}, R.enforcement.map((t) => h('li', {}, t))),
    h('p', { class: 'xs muted' }, `Version ${R.version}`),
    S.session ? null : h('p', {}, h('a', { href: '#/' }, '← Back')));
}

// ---------------------------------------------------------------------------
// Account: sign out, delete everything
// ---------------------------------------------------------------------------
function renderAccount() {
  const msg = msgBox();
  const confirmBox = h('input', { class: 'input', id: 'confirm-delete', autocomplete: 'off', placeholder: 'Type DELETE' });
  const del = h('button', { class: 'btn danger', type: 'submit' }, 'Delete my account');
  render(
    h('h1', {}, 'Account'),
    h('div', { class: 'card' },
      h('div', {}, h('b', {}, `@${S.me.handle}`), S.me.role !== 'member' ? h('span', { class: 'chip' }, S.me.role) : null),
      h('div', { class: 'small muted' }, `Member since ${new Date(S.me.created_at).toLocaleDateString()}`),
      S.me.status === 'suspended' ? h('div', { class: 'note' }, `Suspended until ${new Date(S.me.suspended_until).toLocaleString()}`) : null,
      h('p', {}, h('button', { class: 'btn', type: 'button', onclick: async () => { await sb.auth.signOut(); S.session = null; S.me = null; location.hash = '#/'; renderSignIn(); } }, 'Sign out'))),
    h('h2', {}, 'Delete your account'),
    h('p', { class: 'small' }, 'This deletes your profile, every post and comment you wrote, and your votes, right away. Reports you filed stay, without your name. It can’t be undone.'),
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (confirmBox.value.trim() !== 'DELETE') return say(msg, 'Type DELETE to confirm.');
        del.disabled = true;
        const { error } = await sb.functions.invoke('delete-account', { body: { confirm: 'DELETE' } });
        del.disabled = false;
        if (error) return say(msg, 'Something went wrong; nothing was deleted. Try again, or contact the moderators.');
        track('account_deleted');
        await sb.auth.signOut(); S.session = null; S.me = null;
        render(h('section', { class: 'hero' }, h('h1', {}, 'Your account is deleted'), h('p', {}, 'Everything you wrote is gone. Thanks for being part of it.')));
      },
    }, h('label', { class: 'f', for: 'confirm-delete' }, h('span', {}, 'Type DELETE to confirm'), confirmBox), del, msg));
}

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------
async function renderMod(tab) {
  const tabs = [['queue', 'Queue'], ['alerts', 'Signal alerts'], ['numbers', 'Beta numbers'], ['terms', 'Watch list'], ['invites', 'Invites']];
  const body = h('div', {}, h('p', { class: 'muted' }, 'Loading…'));
  render(h('h1', {}, 'Moderation'),
    h('nav', { class: 'tabs', 'aria-label': 'Moderation' }, tabs.map(([k, l]) => h('a', { href: `#/mod/${k}`, 'aria-current': k === tab ? 'page' : null }, l))),
    body);
  const views = { queue: modQueue, alerts: modAlerts, numbers: modNumbers, terms: modTerms, invites: modInvites };
  await (views[tab] || modQueue)(body);
}

function modActions(item, done) {
  const msg = msgBox();
  // Start on the rule the reports point to, so the usual case is one click
  const RULE_OF = { sourcing: 0, dosing: 1, medical_misinfo: 2, harassment: 3, personal_info: 4, spam: 5, off_topic: 6, underage: 7, self_harm: 9 };
  const first = (item.reasons || []).map((r) => RULE_OF[r]).find((i) => i !== undefined);
  const reason = h('select', { class: 'input' }, MOD_REASONS.map((r, i) => h('option', { value: r, selected: i === first }, r)));
  const note = h('input', { class: 'input', placeholder: 'Note for the log (optional)', maxlength: 300 });
  const act = (target_kind, target_id, action, days) => async () => {
    const { error } = await sb.rpc('moderate', { target_kind, target_id, action, reason: reason.value, note: note.value.trim() || null, days: days || null });
    if (error) return say(msg, friendly(error));
    track('moderation', { action });
    done();
  };
  const content = item.target_kind !== 'member';
  return h('div', {},
    h('div', { class: 'row' }, reason, note),
    h('div', { class: 'row mt8' },
      content && item.status !== 'visible' ? h('button', { class: 'btn sm', type: 'button', onclick: act(item.target_kind, item.target_id, 'restore') }, 'Restore') : null,
      content && item.status !== 'removed' ? h('button', { class: 'btn sm danger', type: 'button', onclick: act(item.target_kind, item.target_id, 'remove') }, 'Remove') : null,
      item.reports > 0 ? h('button', { class: 'btn sm', type: 'button', onclick: act(item.target_kind, item.target_id, 'dismiss') }, 'Dismiss reports') : null,
      h('button', { class: 'btn sm', type: 'button', onclick: act('member', item.author_id, 'warn') }, 'Warn author'),
      h('button', { class: 'btn sm', type: 'button', onclick: act('member', item.author_id, 'suspend', 7) }, 'Suspend 7 days'),
      h('button', { class: 'btn sm danger', type: 'button', onclick: act('member', item.author_id, 'ban') }, 'Ban')),
    msg);
}

async function modQueue(body) {
  const { data, error } = await sb.from('mod_queue').select('*').order('waiting_since', { ascending: true });
  if (error) return body.replaceChildren(h('div', { class: 'err' }, friendly(error)));
  if (!data.length) return body.replaceChildren(h('div', { class: 'ok' }, 'Nothing waiting. Nice.'));
  body.replaceChildren(...data.map((it) => h('article', { class: 'card', 'data-queue': it.target_id },
    h('div', { class: 'row' },
      h('span', { class: 'chip' }, it.target_kind),
      it.status ? h('span', { class: `chip ${it.status === 'visible' ? '' : it.status}` }, it.status) : null,
      it.reports ? h('span', { class: 'chip' }, `${it.reports} report${it.reports === 1 ? '' : 's'}: ${(it.reasons || []).join(', ')}`) : null,
      h('span', { class: 'xs muted' }, `waiting ${ago(it.waiting_since).replace(' ago', '')}`)),
    it.status_reason ? h('p', { class: 'small muted' }, it.status_reason) : null,
    it.title ? h('b', {}, it.title) : null,
    it.body ? h('div', { class: 'body' }, it.body) : null,
    h('p', { class: 'small' }, `by @${it.author_handle}`),
    modActions(it, () => modQueue(body)))));
}

async function modAlerts(body) {
  const { data, error } = await sb.from('signal_alerts').select('*').eq('status', 'open').order('created_at', { ascending: false });
  if (error) return body.replaceChildren(h('div', { class: 'err' }, friendly(error)));
  if (!data.length) return body.replaceChildren(h('div', { class: 'ok' }, 'No open alerts.'));
  const name = (id) => (S.compounds.find((c) => c.id === id) || {}).name || id;
  body.replaceChildren(
    h('p', { class: 'small muted' }, 'Raised when new accounts make up most of one compound’s activity. Look at who they are before the numbers move.'),
    ...data.map((a) => h('div', { class: 'card' },
      h('b', {}, name(a.compound_id)),
      h('div', { class: 'small' }, `${a.new_accounts} new accounts, ${a.new_account_events} of ${a.events} actions in ${Math.round((new Date(a.window_end) - new Date(a.window_start)) / 3600000)} h`),
      h('a', { class: 'btn sm', href: `#/feed?c=${encodeURIComponent(a.compound_id)}` }, 'See the posts'), ' ',
      h('button', { class: 'btn sm', type: 'button', onclick: async () => { const { error: e } = await sb.rpc('review_alert', { alert_id: a.id }); if (!e) modAlerts(body); } }, 'Mark reviewed'))));
}

async function modNumbers(body) {
  const { data, error } = await sb.rpc('beta_metrics');
  if (error) return body.replaceChildren(h('div', { class: 'err' }, friendly(error)));
  body.replaceChildren(h('table', { class: 'metrics' }, h('tbody', {}, data.map((m) => h('tr', {},
    h('td', {}, h('b', {}, m.metric.replace(/_/g, ' ')), h('div', { class: 'xs muted' }, m.detail)),
    h('td', { class: 'v' }, m.value == null ? '–' : String(m.value)))))));
}

async function modTerms(body) {
  const msg = msgBox();
  const { data, error } = await sb.from('watch_terms').select('*').order('term');
  if (error) return body.replaceChildren(h('div', { class: 'err' }, friendly(error)));
  const term = h('input', { class: 'input', placeholder: 'word or phrase', maxlength: 100 });
  const action = h('select', { class: 'input' }, h('option', { value: 'hold' }, 'Hold for review'), h('option', { value: 'block' }, 'Refuse at once'));
  const reason = h('select', { class: 'input' }, REASONS.map(([v, l]) => h('option', { value: v }, l)));
  body.replaceChildren(
    h('form', {
      class: 'card',
      onsubmit: async (e) => {
        e.preventDefault();
        const { error: e2 } = await sb.from('watch_terms').insert({ term: term.value.trim(), action: action.value, reason: reason.value });
        if (e2) return say(msg, friendly(e2));
        modTerms(body);
      },
    }, h('b', {}, 'Add a term'), term, h('div', { class: 'row' }, action, reason), h('button', { class: 'btn brand sm', type: 'submit' }, 'Add'), msg),
    ...data.map((t) => h('div', { class: 'row card' },
      h('span', { class: 'grow' }, h('b', {}, t.term), ' ', h('span', { class: 'chip' }, t.action), ' ', h('span', { class: 'xs muted' }, t.reason)),
      h('button', { class: 'lnk', type: 'button', onclick: async () => { await sb.from('watch_terms').delete().eq('id', t.id); modTerms(body); } }, 'Remove'))));
}

async function modInvites(body) {
  const msg = msgBox();
  const { data, error } = await sb.from('invites').select('*').order('created_at', { ascending: false });
  if (error) return body.replaceChildren(h('div', { class: 'err' }, friendly(error)));
  const note = h('input', { class: 'input', placeholder: 'Who it’s for (only moderators see this)', maxlength: 200 });
  const uses = h('input', { class: 'input', type: 'number', min: 1, max: 50, value: '1' });
  const trusted = h('input', { type: 'checkbox' });
  const link = (code) => `${location.origin}${location.pathname}#/join/${code}`;
  body.replaceChildren(
    h('form', {
      class: 'card',
      onsubmit: async (e) => {
        e.preventDefault();
        const { error: e2 } = await sb.from('invites').insert({ note: note.value.trim() || null, max_uses: Number(uses.value) || 1, trusted: trusted.checked });
        if (e2) return say(msg, friendly(e2));
        modInvites(body);
      },
    }, h('b', {}, 'New invite'), note,
    h('label', { class: 'f' }, h('span', {}, 'How many people can use it'), uses),
    h('label', { class: 'check' }, trusted, h('span', {}, 'Founding member: skips the first-week limits')),
    h('button', { class: 'btn brand sm', type: 'submit' }, 'Create'), msg),
    ...data.map((i) => h('div', { class: 'card' },
      h('div', { class: 'row' }, h('b', { class: 'grow' }, i.code), i.trusted ? h('span', { class: 'chip' }, 'founding') : null, h('span', { class: 'xs muted' }, `${i.uses} of ${i.max_uses} used`)),
      i.note ? h('div', { class: 'small muted' }, i.note) : null,
      h('div', { class: 'xs' }, link(i.code)))));
}

boot();
