// A new post: what you took (one compound, or several as a stack), a report or a question, how it
// went, and whether anyone may read the report on a public page.
import { h, msgBox, say } from '../dom.js';
import { sig } from '../art.js';
import { friendly } from '../../core/errors.js';
import { titleFrom } from '../../core/posts.js';
import { idsFrom } from '../../core/library.js';
import * as Posts from '../../data/posts.js';
import { readGuestDraft, clearGuestDraft } from '../../data/storage.js';
import { track } from '../../data/telemetry.js';
import { S, noteMine } from '../../app/store.js';
import { loadSpaces } from '../../app/session.js';
import { render, setRail } from '../shell.js';
import { railCards } from '../rail.js';
import { compoundPicker, picksNote } from '../components/picker.js';
import { afterEarn } from '../components/game.js';
import { draftFrom } from '../../kit/kit.js';

// d: a draft from miraclehealth.us (a Miracle Plan check-in, or "add how it went" in Sig;
// kit.js draftLink), to edit
export function renderNew(param = '', d = '') {
  if (S.me.status === 'suspended') { render(h('div', { class: 'msg note' }, 'Your account is paused, so you can’t post right now.')); return; }
  const draft = draftFrom(d);
  // Words written before signing in ("Share how it went" from the Library) come back here
  const guest = readGuestDraft();
  const fromGuest = guest && (!param || !guest.cid || guest.cid === param) ? guest : null;
  const msg = msgBox();
  const note = h('p', { class: 'cpick-note', 'aria-live': 'polite' });
  const pick = compoundPicker({ selected: idsFrom(S.spaces, param || fromGuest?.cid || ''), onChange: (ids) => note.replaceChildren(...picksNote(ids)) });
  note.replaceChildren(...picksNote(pick.value));
  const kindExp = h('input', { type: 'radio', name: 'kind', value: 'experience', checked: true });
  const kindQ = h('input', { type: 'radio', name: 'kind', value: 'question' });
  // The title can be left empty: the report's first sentence becomes it
  const title = h('input', { class: 'input', id: 'title', maxlength: 140, placeholder: 'e.g. Week 6 on BPC-157 + TB-500 for a knee injury', value: draft?.title || null });
  const body = h('textarea', { class: 'input', id: 'body', maxlength: 10000, required: true, placeholder: 'What you took it for, how long, and how it compares to before you started: better, about the same, or worse. Side effects too.' });
  if (draft?.body) body.value = draft.body;
  else if (fromGuest?.body) body.value = fromGuest.body;
  const go = h('button', { class: 'btn lime', type: 'submit' }, 'Post');
  const hint = h('div', { class: 'rules-note' }, sig(40, 'think'), h('div', {},
    h('b', {}, 'Sig reads every report into the Signal. '),
    'Say how it compares to before you started, and for how long. A report that says it didn’t work counts just as much (and earns the same 40 points). No sourcing or sellers (rule 1), and don’t tell others what to take (rule 2).'));
  // A report (not a question) can also go on a public page, if its author chooses
  const pub = h('input', { type: 'checkbox', id: 'make-public' });
  const pubBox = h('label', { class: 'check pub-choice', for: 'make-public' }, pub,
    h('span', {}, h('b', {}, 'Also let anyone read this report'),
      h('span', { class: 'xs muted' }, ' on its own public page, with your handle, what you took and how it went. Comments stay members-only, and you can take it back any time.')));
  const updateHint = () => { hint.classList.toggle('hide', kindQ.checked); pubBox.classList.toggle('hide', kindQ.checked); };
  kindExp.addEventListener('change', updateHint); kindQ.addEventListener('change', updateHint);
  render(
    h('div', { class: 'page-h' }, h('div', {}, h('div', { class: 'kick' }, '// New post'), h('h1', {}, 'What have you taken, and how did it go?'))),
    draft ? h('div', { class: 'msg note from-plan' }, sig(32, 'happy'),
      h('span', {}, h('b', {}, 'Drafted for you on miraclehealth.us. '), 'It’s yours to change: add side effects or anything else, check what you took, and nothing is posted until you press Post.')) : null,
    !draft && fromGuest?.body ? h('div', { class: 'msg note from-plan' }, sig(32, 'happy'),
      h('span', {}, h('b', {}, 'Your report is here. '), 'Check what you took, add a title if you like, and press Post.')) : null,
    h('form', {
      class: 'card',
      onsubmit: async (e) => {
        e.preventDefault();
        const compounds = pick.value;
        if (!compounds.length) { say(msg, 'Pick what you took first.'); pick.querySelector('input')?.focus(); return; }
        if (!body.value.trim()) { say(msg, 'Say how it went first.'); body.focus(); return; }
        go.disabled = true; say(msg, '');
        const kind = kindQ.checked ? 'question' : 'experience';
        const { data, error } = await Posts.create({ compounds, kind, title: title.value.trim() || titleFrom(body.value, kind), body: body.value.trim() });
        go.disabled = false;
        if (error) return say(msg, friendly(error));
        clearGuestDraft();
        // The post is up either way; a public page that didn't take can be turned on from the post
        if (kind === 'experience' && pub.checked) await Posts.setPublic(data, true);
        track('post', { kind, compounds: compounds.length, public: kind === 'experience' && pub.checked });
        noteMine(data);
        if (compounds.length > 1) await loadSpaces();
        afterEarn(go);
        location.hash = `#/post/${encodeURIComponent(data)}`;
      },
    },
    h('label', { class: 'f', for: 'compound' }, h('span', {}, 'What did you take?'), pick),
    note,
    h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Kind of post' },
      h('label', {}, kindExp, 'My experience'), h('label', {}, kindQ, 'A question')),
    h('label', { class: 'f', for: 'body' }, h('span', {}, 'How it went'), body),
    h('p', { class: 'small muted voice-tip' }, 'On a phone? Tap the microphone on your keyboard to talk instead of typing.'),
    h('label', { class: 'f', for: 'title' }, h('span', {}, 'Title (optional)'), title),
    pubBox,
    hint,
    h('div', { class: 'row end mt16' }, h('a', { class: 'btn ghost', href: '#/home' }, 'Cancel'), go), msg));
  setRail([]);
  railCards('quests').then(setRail);
}
