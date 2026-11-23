// The welcome beside every signed-out screen: Sig's ring and rings around it, the line and the three
// steps, the same words and steps as the "Took something?" band on theunhyped.com, so joining from
// there lands where it left off. It's markup made from the constants below (never anyone's text), so
// the build also draws it into the page itself (scripts/write_config.mjs): a phone shows it before the
// app's code has arrived, and the app's first screen draws the very same thing in its place.
import { ringMarkup } from '../../core/ring.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const LEDE = 'Your report moves the number for the next person, even if it did nothing.';
// Before the age question the welcome says nothing about age (web/ui/pages/auth.js)
export const FREE = 'Free to join.';
export const FREE_ADULTS = 'Free, for adults 18 and over.';
const STEPS = [
  ['1', 'Share how it went', 'What you took it for, for how long, and whether things got better, stayed the same or got worse.'],
  ['2', 'Check the read', 'Sig shows you what it understood. Fix anything it got wrong: your word wins.'],
  ['3', 'See it count', 'The rating for that use updates, and you’re asked how it’s going at 2, 6 and 12 weeks.'],
];

export function welcomeMarkup(free = FREE) {
  return `<div class="auth-art"><div class="sig-hero">${ringMarkup(132)}</div>`
    + '<div class="kick">The Unhyped community</div>'
    + '<h1>Took something? <em>Say how it went.</em></h1>'
    + `<p class="lede">${esc(`${LEDE} ${free}`)}</p>`
    + `<ol class="auth-steps">${STEPS.map(([n, b, s]) => `<li><span class="n">${n}</span><b>${esc(b)}</b><span>${esc(s)}</span></li>`).join('')}</ol></div>`;
}

// The whole first screen as the build draws it: the welcome, and beside it the age question's
// shape, unseen, holding the room the app's own question takes (a phone stacks the two, and an
// empty half would let the welcome stretch, then jump when the question arrives)
export function firstScreenMarkup() {
  const field = (label) => `<label class="f"><span>${label}</span><select class="input" tabindex="-1"><option>${label}</option></select></label>`;
  const shape = '<div class="kick">Before you start</div><h2>When were you born?</h2>'
    + '<p class="muted">We ask everyone. It stays on this device: we never send or keep the date.</p>'
    + `<div class="f-row">${field('Month')}${field('Year')}</div><button class="btn lime block" type="button" tabindex="-1">Continue</button>`;
  return `<section class="auth-wrap first-screen">${welcomeMarkup(FREE)}<div class="auth-form"><div class="inner first-shape" aria-hidden="true">${shape}</div></div></section>`;
}
