// Miracle Health Community · web app
// Plain JavaScript modules, no build step. It talks to Supabase with the public
// key only; who can see or change what is enforced by the database, not here.
import { h, icon, friendly, msgBox, say } from './lib/ui.js';
import { sig } from './lib/art.js';
import {
  C, S, sb, setClient, isMod, signalOf, spaceOf, loadReference, loadSpaces, loadSignal, loadCard, loadPulse,
  loadUnread, loadHistory, startLive, track,
} from './lib/state.js';
import { render, setRail, renderNav, renderTop, renderTabbar, mountSig, sigSay, closeDrawer } from './lib/shell.js';
import { renderTicker, renderSignalPage } from './lib/signal.js';
import { renderHome, renderPopular, renderSpace, renderExplore, renderNew } from './lib/feed.js';
import { renderPost } from './lib/post.js';
import { renderProfile, renderBuilders, renderQuests, renderNotifications, refreshQuests, onboarding, setUnread } from './lib/game.js';
import { renderMod } from './lib/mod.js';
import { renderRules, renderHow, renderAccount } from './lib/pages.js';

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
        person_profiles: 'identified_only',
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

// ---------------------------------------------------------------------------
// Site password (for the beta). config.js carries the public API key encrypted
// with it, so without the password the app can't reach the community at all.
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
  } catch (_) { return null; }
}
async function unlock() {
  const g = C.gate;
  if (!g) return C.supabaseAnonKey;
  const slot = `mh_gate:${g.salt}`;
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
    const go = h('button', { class: 'btn lime block', type: 'submit' }, 'Enter');
    render(h('section', { class: 'gate' }, h('div', { class: 'inner' },
      sig(88, 'watching'),
      h('div', { class: 'kick mt16' }, '// Private beta'),
      h('h1', {}, 'Almost open.'),
      h('p', { class: 'lede' }, 'The Miracle Health community is open to invited testers for now. Enter the beta password to continue.'),
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
      }, h('label', { class: 'f', for: 'site-password' }, h('span', {}, 'Beta password'), pw), go, msg))));
    pw.focus();
  });
}

// ---------------------------------------------------------------------------
// Sign in with a phone number and a texted code, then join (open to adults; an invite
// link still brings its invite along)
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
  if (!C.turnstileSiteKey) return;
  turnstileToken = null;
  if (!window.turnstile) await loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
  window.turnstile.render(box, {
    sitekey: C.turnstileSiteKey,
    callback: (t) => { turnstileToken = t; },
    'expired-callback': () => { turnstileToken = null; },
  });
}

function authLayout(...formKids) {
  document.body.classList.add('auth');
  render(h('section', { class: 'auth-wrap' },
    h('div', { class: 'auth-art' },
      h('div', { class: 'sig-hero' }, sig(150, 'happy')),
      h('div', { class: 'kick' }, '// The Miracle Health community'),
      h('h1', {}, 'Built by the people who take it.'),
      h('p', { class: 'lede' }, 'Real experiences with peptides, from the adults who took them: what for, how long, and whether it was better, the same or worse. Every report moves a live number.'),
      h('div', { class: 'proof' },
        h('div', {}, h('b', {}, 'Live'), h('span', {}, 'A Signal per compound')),
        h('div', {}, h('b', {}, '0'), h('span', {}, 'Sellers allowed')),
        h('div', {}, h('b', {}, 'You'), h('span', {}, 'Make it more accurate')))),
    h('div', { class: 'auth-form' }, h('div', { class: 'inner' }, ...formKids))));
}

function renderSignIn() {
  const msg = msgBox();
  const phone = h('input', { class: 'input', type: 'tel', autocomplete: 'tel', inputmode: 'tel', id: 'phone', required: true, placeholder: '(555) 123-4567' });
  const ts = h('div', { class: 'turnstile' });
  const send = h('button', { class: 'btn lime block', type: 'submit' }, 'Text me a code');
  authLayout(
    h('div', { class: 'kick' }, '// Free to join, 18 and over'),
    h('h2', {}, 'Sign in.'),
    h('p', { class: 'muted' }, 'We text you a code. Your number is never shown to anyone.'),
    h('form', {
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
    }, h('label', { class: 'f', for: 'phone' }, h('span', {}, 'Your mobile number'), phone), ts, send, msg),
    h('p', { class: 'small mt16' }, h('a', { href: '#/rules' }, 'Read the community rules')));
  mountTurnstile(ts);
}

function renderCode(phone) {
  const msg = msgBox();
  const code = h('input', { class: 'input', inputmode: 'numeric', autocomplete: 'one-time-code', id: 'code', maxlength: 8, required: true });
  const go = h('button', { class: 'btn lime block', type: 'submit' }, 'Sign in');
  authLayout(
    h('div', { class: 'kick' }, '// Check your messages'),
    h('h2', {}, 'Enter the code.'),
    h('p', { class: 'muted' }, `We texted a code to ${phone}.`),
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); go.disabled = true; say(msg, '');
        const { data, error } = await sb.auth.verifyOtp({ phone, token: code.value.trim(), type: 'sms' });
        go.disabled = false;
        if (error) return say(msg, friendly(error));
        S.session = data.session;
        await loadMe();
        track('signed_in');
        if (!S.me) return renderSignup();
        location.hash = '#/home'; route();
      },
    }, h('label', { class: 'f', for: 'code' }, h('span', {}, 'Code'), code), go, msg),
    h('p', { class: 'small mt16' }, h('button', { class: 'lnk', type: 'button', onclick: () => renderSignIn() }, 'Use a different number')));
}

function renderSignup() {
  const msg = msgBox();
  let saved = '';
  try { saved = sessionStorage.getItem('mh_invite') || ''; } catch (_) { /* private mode */ }
  // No invite needed; one that came in with an invite link is shown, and can be cleared
  const invite = saved ? h('input', { class: 'input', id: 'invite', autocomplete: 'off', value: saved }) : null;
  const handle = h('input', { class: 'input', id: 'handle', required: true, autocomplete: 'nickname', maxlength: 20, placeholder: 'letters, numbers, _' });
  const adult = h('input', { type: 'checkbox', id: 'adult' });
  const rules = h('input', { type: 'checkbox', id: 'rules-ok' });
  const health = h('input', { type: 'checkbox', id: 'health-ok' });
  const go = h('button', { class: 'btn lime block', type: 'submit' }, 'Join the community');
  authLayout(
    h('div', { class: 'kick' }, '// Almost there'),
    h('h2', {}, 'Pick your handle.'),
    h('p', { class: 'muted' }, 'It’s the only name anyone sees, so don’t use your real name. You’ll show up as u/handle.'),
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (!adult.checked) return say(msg, 'Miracle Health is for adults 18 and over.');
        if (!rules.checked) return say(msg, 'Read and accept the community rules to join.');
        if (!health.checked) return say(msg, 'To join, agree to how what you post about your health is collected and shown.');
        go.disabled = true; say(msg, '');
        const { error } = await sb.rpc('complete_signup', {
          handle: handle.value.trim(), invite_code: invite ? invite.value.trim() : '', confirm_adult: true,
          rules_version: S.rules?.version || '', health_data_consent: true,
        });
        go.disabled = false;
        if (error) return say(msg, friendly(error));
        try { sessionStorage.removeItem('mh_invite'); } catch (_) { /* private mode */ }
        await loadMe(); track('signed_up');
        location.hash = '#/home';
        await route();
        onboarding();
      },
    },
    invite ? h('label', { class: 'f', for: 'invite' }, h('span', {}, 'Invite code (optional)'), invite) : null,
    h('label', { class: 'f', for: 'handle' }, h('span', {}, 'Handle'), handle),
    h('label', { class: 'check', for: 'adult' }, adult, h('span', {}, 'I’m 18 or older.')),
    h('label', { class: 'check', for: 'rules-ok' }, rules, h('span', {}, 'I’ve read the ', h('a', { href: '#/rules', target: '_blank', rel: 'noopener' }, 'community rules'), ' and will follow them.')),
    h('label', { class: 'check', for: 'health-ok' }, health, h('span', {},
      'I agree that what I post about my health is stored and shown to other members',
      C.privacyUrl ? [', as the ', h('a', { href: C.privacyUrl, target: '_blank', rel: 'noopener' }, 'privacy notice'), ' explains.'] : '.')),
    go, msg),
    h('p', { class: 'small mt16' }, h('button', { class: 'lnk', type: 'button', onclick: async () => { await sb.auth.signOut(); S.session = null; renderSignIn(); } }, 'Sign out')));
}

// ---------------------------------------------------------------------------
// Who's signed in, and everything the shell needs
// ---------------------------------------------------------------------------
async function loadMe() {
  const { data, error } = await sb.rpc('me');
  S.me = !error && Array.isArray(data) && data[0] ? data[0] : null;
  if (!S.me) return;
  await Promise.all([loadReference(), loadSpaces(), loadSignal(), loadCard(), loadPulse(), loadUnread()]);
  document.body.classList.remove('auth');
  renderTop();
  setUnread(S.unread);
  renderTicker();
  mountSig(tipFor);
  startLive();
  refreshQuests().then(() => renderNav(current.name, current.cid));
  loadHistory().then(renderTicker);
}

// ---------------------------------------------------------------------------
// Sig's tip for the page you're on
// ---------------------------------------------------------------------------
let current = { name: '', cid: '' };
function tipFor() {
  const x = current.cid ? signalOf(current.cid) : null;
  switch (current.name) {
    case 'signal': return 'These numbers move live. Every first-hand report and every “same for me” recalculates one.';
    case 'space': return x ? [`${spaceOf(current.cid)?.name}’s Signal is `, h('b', {}, String(x.score)), `. Members here make up ${x.internal_share}% of it. At 50%, it’s run by this community.`] : 'Three first-hand reports unlock this space’s Signal.';
    case 'post': return 'If this matches your experience, tap “Same for me”. It adds your voice to the Signal.';
    case 'builders': return 'Points go to taking part, never to results. A report that says it didn’t work earns the same.';
    case 'quests': return 'Finish a quest, then claim it for the points.';
    case 'new': return 'Say how it compares to before you started, and for how long. I’ll read it into the Signal.';
    default: {
      const tips = [
        'Tap “Same for me” when a report matches yours. It adds your voice to the Signal.',
        'Your first contribution each day earns 5 points and keeps your streak going.',
        'Questions don’t count toward the Signal. Reports of what happened to you do.',
        'Join a few spaces and your Home feed fills up with them.',
      ];
      return tips[Math.floor(Math.random() * tips.length)];
    }
  }
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const [name, arg, arg2] = path.split('/');
  return { name: name || 'home', arg: arg ? decodeURIComponent(arg) : undefined, arg2, q: new URLSearchParams(qs || '') };
}

let routing = 0;
async function route() {
  if (!sb) return;
  const n = ++routing;
  const r = parseHash();
  closeDrawer();
  if (r.name === 'join' && r.arg) {
    try { sessionStorage.setItem('mh_invite', r.arg.toUpperCase()); } catch (_) { /* private mode */ }
  }
  if (r.name === 'rules' && !S.me) { document.body.classList.add('auth'); return renderRules(true); }
  if (!S.session) return renderSignIn();
  if (!S.me) return renderSignup();
  document.body.classList.remove('auth');

  // Old links
  if (r.name === 'feed') { location.replace(r.q.get('c') ? `#/s/${encodeURIComponent(r.q.get('c'))}` : '#/home'); return; }
  const sort = r.q.get('sort') || 'hot';
  current = { name: r.name, cid: r.name === 's' ? r.arg : '' };
  let navKey = r.name;
  const pages = {
    home: () => renderHome(sort),
    popular: () => renderPopular(sort),
    signal: () => renderSignalPage(),
    explore: () => renderExplore(),
    builders: () => renderBuilders(),
    quests: () => renderQuests(),
    notifications: () => renderNotifications(),
    new: () => renderNew(r.q.get('c') || ''),
    s: () => { current.name = 'space'; navKey = ''; return renderSpace(r.arg, sort); },
    post: () => { navKey = ''; return renderPost(r.arg, { edit: r.q.get('edit') === '1', focus: r.q.get('c') }); },
    u: () => { navKey = r.arg === S.me.handle ? 'me' : ''; return renderProfile(r.arg, r.q.get('t') || 'posts'); },
    how: () => renderHow(),
    rules: () => renderRules(),
    account: () => renderAccount(),
    mod: () => (isMod() ? renderMod(r.arg || 'queue') : (location.hash = '#/home')),
    join: () => { location.replace('#/home'); },
  };
  const page = pages[r.name] || pages.home;
  if (!pages[r.name]) current.name = 'home';
  renderNav(navKey === 'u' ? '' : (pages[r.name] ? navKey : 'home'), current.cid);
  renderTabbar(navKey === 'u' ? '' : navKey);
  track('screen', { screen: current.name });
  try {
    await page();
  } catch (e) {
    if (n !== routing) return;
    console.error(e);
    render(h('div', { class: 'empty card' }, sig(72, 'concerned'), h('p', {}, 'Something went wrong loading this page.'), h('button', { class: 'btn sm', type: 'button', onclick: () => route() }, 'Try again')));
  }
}
window.addEventListener('hashchange', () => { route(); });

// A preview packed into one HTML file (skipSignIn) opens straight into the community
// as a new member: no number, code or invite to type. Real builds never set it.
async function enterPreview() {
  const phone = `+1555${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  await sb.auth.signInWithOtp({ phone });
  const { data, error } = await sb.auth.verifyOtp({ phone, token: '123456', type: 'sms' });
  if (error || !data?.session) return false;
  S.session = data.session;
  const { error: e2 } = await sb.rpc('complete_signup', {
    handle: `guest_${Math.floor(1000 + Math.random() * 9000)}`, invite_code: 'PREVIEW', confirm_adult: true,
    rules_version: S.rules?.version || '', health_data_consent: true,
  });
  if (e2) return false;
  await loadMe();
  return !!S.me;
}

// ---------------------------------------------------------------------------
async function boot() {
  startTelemetry();
  S.rules = await fetch('rules.json').then((r) => r.json()).catch(() => null);
  const foot = document.getElementById('foot-text');
  if (S.rules?.footer) foot.textContent = S.rules.footer;
  if (C.contactEmail) foot.append(' Contact the moderators: ', h('a', { href: `mailto:${C.contactEmail}` }, C.contactEmail));
  const key = await unlock();
  setClient(window.supabase.createClient(C.supabaseUrl, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  }));
  const { data } = await sb.auth.getSession();
  S.session = data.session;
  sb.auth.onAuthStateChange((_event, session) => { S.session = session; });
  if (!S.session && C.demo && C.skipSignIn && await enterPreview()) {
    location.hash = '#/home';
    await route();
    onboarding();
    return;
  }
  if (S.session) await loadMe();
  await route();
}
boot();

export { icon, setRail, loadCard, loadSpaces, loadSignal, loadPulse, loadHistory, sigSay };
