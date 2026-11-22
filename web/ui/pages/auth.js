// Signed out: the month and year you were born (asked first, before anything else), signing in with
// a phone number and a texted code, picking a handle to join (open to adults; an invite link still
// brings its invite along), and "Share how it went" written before signing in. route is the router,
// handed in by it, so these pages can send someone on once in.
import { h, html, msgBox, say } from '../dom.js';
import { FREE, FREE_ADULTS, LEDE, welcomeMarkup } from './welcome.js';
import { friendly } from '../../core/errors.js';
import { e164 } from '../../core/phone.js';
import { isAdult } from '../../core/age.js';
import * as Auth from '../../data/auth.js';
import * as Library from '../../data/library.js';
import { C } from '../../data/config.js';
import { saveGuestDraft, readGuestDraft, readInvite, clearInvite, ageState, keepAge } from '../../data/storage.js';
import { loadScript } from '../../data/scripts.js';
import { track } from '../../data/telemetry.js';
import { S, setSession } from '../../app/store.js';
import { signOut } from '../../app/session.js';
import { render } from '../shell.js';
import { enter } from '../enter.js';
import { takeNext } from '../next.js';
import { onboarding } from './onboarding.js';
import { draftFrom } from '../../kit/kit.js';

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

// The age question (November 18). Before anything is asked, even a phone number, the month and year
// you were born, asked plainly: nothing on that screen says what age is needed, and neither picker
// starts on an answer. Someone under 18 is told they can't join and nothing else is asked; this
// device remembers that for a day, so the answer can't just be changed and sent again. Only whether
// you're old enough is kept, on this device; the month and year are never sent or stored. The
// server still refuses anyone who hasn't confirmed they're an adult (complete_signup).
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function renderAge(next) {
  const msg = msgBox();
  const thisYear = new Date().getFullYear();
  const month = h('select', { class: 'input', id: 'birth-month', required: true },
    h('option', { value: '' }, 'Month'), ...MONTHS.map((m, i) => h('option', { value: String(i + 1) }, m)));
  const year = h('select', { class: 'input', id: 'birth-year', required: true },
    h('option', { value: '' }, 'Year'), ...Array.from({ length: 101 }, (_, i) => h('option', { value: String(thisYear - i) }, String(thisYear - i))));
  authLayout(
    h('div', { class: 'kick' }, 'Before you start'),
    h('h2', {}, 'When were you born?'),
    h('p', { class: 'muted' }, 'We ask everyone. It stays on this device: we never send or keep the date.'),
    h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        const m = Number(month.value), y = Number(year.value);
        if (!m || !y) return say(msg, 'Choose the month and the year.');
        if (!isAdult(m, y)) { keepAge(false); track('age_refused'); return renderTooYoung(); }
        keepAge(true);
        next();
      },
    },
    h('div', { class: 'f-row' },
      h('label', { class: 'f', for: 'birth-month' }, h('span', {}, 'Month'), month),
      h('label', { class: 'f', for: 'birth-year' }, h('span', {}, 'Year'), year)),
    h('button', { class: 'btn lime block', type: 'submit' }, 'Continue'), msg));
  // the art beside it says nothing about age either
  const lede = document.querySelector('.auth-art .lede');
  if (lede) lede.textContent = `${LEDE} ${FREE}`;
}
function renderTooYoung() {
  authLayout(
    h('h2', {}, 'Sorry, you can’t join Unhyped.'),
    h('p', { class: 'muted' }, 'The community is only for adults. You can still read the Library on our website.'),
    h('p', { class: 'mt16' }, h('a', { class: 'btn block', href: 'https://miraclehealth.us/library/' }, 'Go to the Library')));
}

// Signed out: the welcome (pages/welcome.js, the same words and three steps as the "Took something?"
// band on miraclehealth.us) beside the form. The build draws the same welcome into the page, so it's
// on screen before this code arrives, and this replaces it with no visible change.
function authLayout(...formKids) {
  document.body.classList.add('auth');
  render(h('section', { class: 'auth-wrap' }, html(welcomeMarkup(FREE_ADULTS)),
    h('div', { class: 'auth-form' }, h('div', { class: 'inner' }, ...formKids))));
}

// Signed out on "Share how it went": write first, sign in when you post. The words wait in this
// tab (data/storage.js) and fill the new-post page once they’re in.
export function renderGuestDraft(cid = '', d = '', route = () => {}) {
  const msg = msgBox();
  const saved = readGuestDraft();
  const linked = draftFrom(d);
  const head = h('h2', {}, 'How did it go?');
  if (cid) {
    Library.index().then((x) => {
      const it = (x?.items || []).find((i) => i.id === cid);
      if (it?.name) head.textContent = `How did ${it.name.replace(/\s*\(.*\)$/, '')} go?`;
    }).catch(() => {});
  }
  const body = h('textarea', { class: 'input', id: 'gbody', maxlength: 10000, required: true, rows: 7,
    placeholder: 'What you took it for, for how long, and whether things got better, stayed the same or got worse. Side effects too.' });
  body.value = (saved && (!cid || saved.cid === cid) ? saved.body : '') || linked?.body || '';
  authLayout(
    h('div', { class: 'kick' }, 'Share how it went'),
    head,
    h('p', { class: 'muted' }, 'Write it first. Then we text you a code to sign in, and nothing is posted until you press Post.'),
    h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        const words = body.value.trim();
        if (words.length < 20) return say(msg, 'A sentence or two is plenty: what you took it for, for how long, and how it went.');
        saveGuestDraft({ cid, body: words });
        renderSignIn(route);
      },
    },
    h('label', { class: 'f', for: 'gbody' }, h('span', {}, 'Your report'), body),
    h('p', { class: 'small muted' }, 'On a phone? Tap the microphone on your keyboard to talk instead of typing.'),
    h('button', { class: 'btn lime block', type: 'submit' }, 'Next: sign in to post'), msg),
    h('p', { class: 'small mt16' }, 'Already a member? ', h('button', { class: 'lnk', type: 'button', onclick: () => renderSignIn(route) }, 'Sign in first')));
}

export function renderSignIn(route) {
  // the age question comes before the phone number; under 18, nothing more is asked
  const age = ageState();
  if (age === 'no') return renderTooYoung();
  if (age !== 'ok') return renderAge(() => renderSignIn(route));
  const msg = msgBox();
  const phone = h('input', { class: 'input', type: 'tel', autocomplete: 'tel', inputmode: 'tel', id: 'phone', required: true, placeholder: '(555) 123-4567' });
  const ts = h('div', { class: 'turnstile' });
  const send = h('button', { class: 'btn lime block', type: 'submit' }, 'Text me a code');
  authLayout(
    h('div', { class: 'kick' }, 'Free to join'),
    h('h2', {}, 'Sign in.'),
    h('p', { class: 'muted' }, 'We text you a code. Your number is never shown to anyone.'),
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        const p = e164(phone.value);
        if (!p) return say(msg, 'Enter a US mobile number, or a full number starting with +.');
        if (C.turnstileSiteKey && !turnstileToken) return say(msg, 'One moment: finish the check above the button.');
        send.disabled = true; say(msg, '');
        const { error } = await Auth.sendCode(p, { captchaToken: turnstileToken || undefined });
        send.disabled = false;
        if (error) { say(msg, friendly(error)); if (window.turnstile) window.turnstile.reset(); return; }
        renderCode(p, route);
      },
    }, h('label', { class: 'f', for: 'phone' }, h('span', {}, 'Your mobile number'), phone), ts, send, msg),
    h('p', { class: 'small mt16' }, h('a', { href: '#/rules' }, 'Read the community rules')));
  mountTurnstile(ts);
}

function renderCode(phone, route) {
  const msg = msgBox();
  const code = h('input', { class: 'input', inputmode: 'numeric', autocomplete: 'one-time-code', id: 'code', maxlength: 8, required: true });
  const go = h('button', { class: 'btn lime block', type: 'submit' }, 'Sign in');
  authLayout(
    h('div', { class: 'kick' }, 'Check your messages'),
    h('h2', {}, 'Enter the code.'),
    h('p', { class: 'muted' }, `We texted a code to ${phone}.`),
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault(); go.disabled = true; say(msg, '');
        const { data, error } = await Auth.verifyCode(phone, code.value.trim());
        go.disabled = false;
        if (error) return say(msg, friendly(error));
        setSession(data.session);
        await enter();
        track('signed_in');
        if (!S.me) return renderSignup(route);
        location.hash = takeNext() || '#/home'; route();
      },
    }, h('label', { class: 'f', for: 'code' }, h('span', {}, 'Code'), code), go, msg),
    h('p', { class: 'small mt16' }, h('button', { class: 'lnk', type: 'button', onclick: () => renderSignIn(route) }, 'Use a different number')));
}

export function renderSignup(route) {
  // (signed in on a device that hasn't been asked, say after clearing it: ask now, before anything is kept)
  const age = ageState();
  if (age === 'no') { signOut(); return renderTooYoung(); }
  if (age !== 'ok') return renderAge(() => renderSignup(route));
  const msg = msgBox();
  const saved = readInvite();
  // No invite needed; one that came in with an invite link is shown, and can be cleared
  const invite = saved ? h('input', { class: 'input', id: 'invite', autocomplete: 'off', value: saved }) : null;
  const handle = h('input', { class: 'input', id: 'handle', required: true, autocomplete: 'nickname', maxlength: 20, placeholder: 'letters, numbers, _' });
  const rules = h('input', { type: 'checkbox', id: 'rules-ok' });
  const health = h('input', { type: 'checkbox', id: 'health-ok' });
  const go = h('button', { class: 'btn lime block', type: 'submit' }, 'Join the community');
  authLayout(
    h('div', { class: 'kick' }, 'Almost there'),
    h('h2', {}, 'Pick your handle.'),
    h('p', { class: 'muted' }, 'It’s the only name anyone sees, so don’t use your real name. You’ll show up as u/handle.'),
    h('form', {
      onsubmit: async (e) => {
        e.preventDefault();
        if (!rules.checked) return say(msg, 'Read and accept the community rules to join.');
        if (!health.checked) return say(msg, 'To join, agree to how what you post about your health is collected and shown.');
        go.disabled = true; say(msg, '');
        const { error } = await Auth.completeSignup({
          handle: handle.value.trim(), invite_code: invite ? invite.value.trim() : '', confirm_adult: ageState() === 'ok',
          rules_version: S.rules?.version || '', health_data_consent: true,
        });
        go.disabled = false;
        if (error) return say(msg, friendly(error));
        clearInvite();
        await enter(); track('signed_up');
        location.hash = takeNext() || '#/home';
        await route();
        onboarding();
      },
    },
    invite ? h('label', { class: 'f', for: 'invite' }, h('span', {}, 'Invite code (optional)'), invite) : null,
    h('label', { class: 'f', for: 'handle' }, h('span', {}, 'Handle'), handle),
    h('label', { class: 'check', for: 'rules-ok' }, rules, h('span', {}, 'I’ve read the ', h('a', { href: '#/rules', target: '_blank', rel: 'noopener' }, 'community rules'), ' and will follow them.')),
    h('label', { class: 'check', for: 'health-ok' }, health, h('span', {},
      'I agree that what I post about my health is stored and shown to other members',
      C.privacyUrl ? [', as the ', h('a', { href: C.privacyUrl, target: '_blank', rel: 'noopener' }, 'privacy notice'), ' explains.'] : '.')),
    go, msg),
    h('p', { class: 'small mt16' }, h('button', { class: 'lnk', type: 'button', onclick: async () => { await signOut(); renderSignIn(route); } }, 'Sign out')));
}

// A preview packed into one HTML file (skipSignIn) opens straight into the community as a new
// member: no number, code or invite to type. Real builds never set it.
export async function enterPreview() {
  const phone = `+1555${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
  await Auth.sendCode(phone);
  const { data, error } = await Auth.verifyCode(phone, '123456');
  if (error || !data?.session) return false;
  setSession(data.session);
  const { error: e2 } = await Auth.completeSignup({
    handle: `guest_${Math.floor(1000 + Math.random() * 9000)}`, invite_code: 'PREVIEW', confirm_adult: true,
    rules_version: S.rules?.version || '', health_data_consent: true,
  });
  if (e2) return false;
  await enter();
  return !!S.me;
}
