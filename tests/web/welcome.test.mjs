// The welcome the build draws into the page (web/ui/pages/welcome.js) and Sig's ring in it
// (web/core/ring.js): plain markup from constants, the same the app's first screen draws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ringMarkup } from '../../web/core/ring.js';
import { FREE, FREE_ADULTS, LEDE, firstScreenMarkup, welcomeMarkup } from '../../web/ui/pages/welcome.js';

test('Sig’s ring: eleven pieces in the agents’ colours and the white centre, hidden from screen readers', () => {
  const big = ringMarkup(132);
  assert.equal((big.match(/<circle /g) || []).length, 12);
  assert.ok(big.startsWith('<svg xmlns="http://www.w3.org/2000/svg" class="ring"'));
  assert.match(big, /aria-hidden="true"/);
  assert.match(big, /stroke="#FF6B5B"[^>]*rotate\(-87\.75\)/);   // the Safety agent's coral leads, at the top
  assert.match(big, /fill="#F7F8FA"/);
  assert.equal((ringMarkup(20).match(/<circle /g) || []).length, 11);   // too small for a centre
});

test('the welcome before the age question says nothing about age; the one after it says adults only', () => {
  assert.ok(welcomeMarkup().includes(`${LEDE} ${FREE}`));
  assert.ok(!/\b18\b|adult/i.test(welcomeMarkup(FREE)));
  assert.ok(welcomeMarkup(FREE_ADULTS).includes('adults 18 and over'));
  assert.match(welcomeMarkup(), /<h1>Took something\? <em class="punch">Say how it went\.<\/em><\/h1>/);
  assert.equal((welcomeMarkup().match(/<li>/g) || []).length, 3);
});

test('the first screen in the page holds the question’s room unseen, with nothing a test or a tap could take for the real one', () => {
  const page = firstScreenMarkup();
  assert.ok(page.startsWith('<section class="auth-wrap first-screen">'));
  assert.match(page, /class="inner first-shape" aria-hidden="true"/);
  assert.ok(!/\sid="/.test(page), 'no ids: #birth-year and the rest belong to the app');
  assert.ok(!/type="submit"|<form/.test(page), 'nothing in it can be sent');
  assert.ok(!/\b18\b|adult/i.test(page));
});
