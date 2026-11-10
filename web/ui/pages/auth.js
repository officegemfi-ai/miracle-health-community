// Signed out: signing in with a phone number and a texted code, picking a handle to join (open to
// adults; an invite link still brings its invite along), and "Share how it went" written before
// signing in. route is the router, handed in by it, so these pages can send someone on once in.
import { h, msgBox, say } from '../dom.js';
import { sig } from '../art.js';
import { friendly } from '../../core/errors.js';
import { e164 } from '../../core/phone.js';
import * as Auth from '../../data/auth.js';
import * as Library from '../../data/library.js';
import { C } from '../../data/config.js';
import { saveGuestDraft, readGuestDraft, readInvite, clearInvite } from '../../data/storage.js';
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

// Signed out: the same words and three steps as the "Took something?" band on miraclehealth.us,
// so joining from there lands where it left off. No photograph: Sig's ring, and rings around it.
function authLayout(...formKids) {
  document.body.classList.add('auth');
  render(h('section', { class: 'auth-wrap' },
    h('div', { class: 'auth-art' },
      h('div', { class: 'sig-hero' }, sig(132, 'happy')),
      h('div', { class: 'kick' }, 'The Miracle Health community'),
      h('h1', {}, 'Took something? ', h('em', {}, 'Say how it went.')),
      h('p', { class: 'lede' }, 'Your report moves the number for the next person, even if it did nothing. Free, for adults 18 and over.'),
      h('ol', { class: 'auth-steps' },
        h('li', {}, h('span', { class: 'n' }, '01'), h('b', {}, 'Share how it went'), h('span', {}, 'What you took it for, for how long, and whether things got better, stayed the same or got worse.')),
        h('li', {}, h('span', { class: 'n' }, '02'), h('b', {}, 'Check the read'), h('span', {}, 'Sig shows you what it understood. Fix anything it got wrong: your word wins.')),
        h('li', {}, h('span', { class: 'n' }, '03'), h('b', {}, 'See it count'), h('span', {}, 'The rating for that use updates, and you’re asked how it’s going at 2, 6 and 12 weeks.')))),
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
  const msg = msgBox();
  const phone = h('input', { class: 'input', type: 'tel', autocomplete: 'tel', inputmode: 'tel', id: 'phone', required: true, placeholder: '(555) 123-4567' });
  const ts = h('div', { class: 'turnstile' });
  const send = h('button', { class: 'btn lime block', type: 'submit' }, 'Text me a code');
  authLayout(
    h('div', { class: 'kick' }, 'Free to join, 18 and over'),
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
  const msg = msgBox();
  const saved = readInvite();
  // No invite needed; one that came in with an invite link is shown, and can be cleared
  const invite = saved ? h('input', { class: 'input', id: 'invite', autocomplete: 'off', value: saved }) : null;
  const handle = h('input', { class: 'input', id: 'handle', required: true, autocomplete: 'nickname', maxlength: 20, placeholder: 'letters, numbers, _' });
  const adult = h('input', { type: 'checkbox', id: 'adult' });
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
        if (!adult.checked) return say(msg, 'Miracle Health is for adults 18 and over.');
        if (!rules.checked) return say(msg, 'Read and accept the community rules to join.');
        if (!health.checked) return say(msg, 'To join, agree to how what you post about your health is collected and shown.');
        go.disabled = true; say(msg, '');
        const { error } = await Auth.completeSignup({
          handle: handle.value.trim(), invite_code: invite ? invite.value.trim() : '', confirm_adult: true,
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
    h('label', { class: 'check', for: 'adult' }, adult, h('span', {}, 'I’m 18 or older.')),
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
