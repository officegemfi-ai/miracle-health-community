// The app's rules (web/core/), tested on their own: they touch no page, network or store, so each
// is called with plain values here. Run: node --test tests/web/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmt1, fmtN, plural, ago } from '../../web/core/format.js';
import { friendly } from '../../web/core/errors.js';
import { e164 } from '../../web/core/phone.js';
import { fromB64, toB64, gateDerive, gateOpen } from '../../web/core/gate.js';
import { parseHash, worthReturningTo, validReturn } from '../../web/core/routes.js';
import { OUTCOME, CAUSE, delta, sourceFamilies } from '../../web/core/signal.js';
import {
  searchLibrary, popularEntries, isStack, familyLabel, stackName, findStack, allParts, containing, idsFrom, MAX_PICKS,
} from '../../web/core/library.js';
import { REASONS, titleFrom, buildTree, countAll, partsOf } from '../../web/core/posts.js';
import { HOW_LONG, lower, readLine, likelyUses } from '../../web/core/reads.js';
import { nextLevel, progressPct, readyToClaim, questOrder, seasonPct, daysLeft, monthName } from '../../web/core/game.js';
import { MOD_TEXT } from '../../web/core/notifications.js';

test('numbers and counts are written the app\'s way', () => {
  assert.equal(fmt1(null), '–');
  assert.equal(fmt1(61.25), '61.3');
  assert.equal(fmtN(12345), '12,345');
  assert.equal(fmtN(undefined), '–');
  assert.equal(plural(1, 'report'), '1 report');
  assert.equal(plural(1200, 'report'), '1,200 reports');
  assert.equal(plural(2, 'reply', 'replies'), '2 replies');
});

test('how long ago, as a feed says it', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  const before = (s) => new Date(now - s * 1000).toISOString();
  assert.equal(ago(before(10), now), 'just now');
  assert.equal(ago(before(50), now), '1m');
  assert.equal(ago(before(5 * 60), now), '5m');
  assert.equal(ago(before(3 * 3600), now), '3h');
  assert.equal(ago(before(2 * 86400), now), '2d');
  assert.equal(ago('2026-09-01T12:00:00Z', now), 'Sep 1');
});

test('errors in plain words, and never the text provider\'s own', () => {
  assert.equal(friendly(null), '');
  assert.equal(friendly({ code: '23505', message: 'duplicate key' }), 'Already done.');
  assert.equal(friendly({ message: 'new row violates row-level security policy' }), 'You can’t do that right now.');
  assert.equal(friendly({ message: 'permission denied for table posts' }), 'You can’t do that.');
  assert.equal(friendly(new Error('Failed to fetch')), 'You seem to be offline. Try again in a moment.');
  assert.match(friendly({ message: 'Error sending OTP: Twilio account AC123 suspended' }), /^We couldn’t text a code/);
  assert.match(friendly({ message: 'Token has expired or is invalid' }), /^That code didn’t work/);
  assert.equal(friendly({ message: 'Handle taken' }), 'Handle taken');
});

test('a phone number as sign-in needs it', () => {
  assert.equal(e164('(555) 123-4567'), '+15551234567');
  assert.equal(e164('1 555 123 4567'), '+15551234567');
  assert.equal(e164('+44 20 7946 0958'), '+442079460958');
  assert.equal(e164('555-1234'), null);
  assert.equal(e164('+123'), null);
  assert.equal(e164(''), null);
});

test('the site password opens the key it sealed, and nothing else', async () => {
  const g = { salt: toB64(new Uint8Array(16).fill(7)), iter: 1000, iv: toB64(new Uint8Array(12).fill(3)) };
  const raw = await gateDerive(g, 'right horse battery');
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: fromB64(g.iv) }, key, new TextEncoder().encode('public-anon-key'));
  g.ct = toB64(new Uint8Array(sealed));
  assert.equal(await gateOpen(g, raw), 'public-anon-key');
  assert.equal(await gateOpen(g, await gateDerive(g, 'wrong horse')), null);
  assert.deepEqual([...fromB64(toB64(new Uint8Array([0, 1, 254, 255])))], [0, 1, 254, 255]);
});

test('where a link points, and which ones are worth returning to', () => {
  const r = parseHash('#/s/bpc%20157?sort=new&only=own');
  assert.equal(r.name, 's');
  assert.equal(r.arg, 'bpc 157');
  assert.equal(r.q.get('sort'), 'new');
  assert.equal(r.q.get('only'), 'own');
  assert.equal(parseHash('').name, 'home');
  assert.equal(parseHash('#/').name, 'home');
  assert.equal(parseHash('#/post/abc/x').arg2, 'x');
  for (const h of ['', '#/', '#/home', '#/rules', '#/join', '#/join/ABC123']) assert.equal(worthReturningTo(h), false, h);
  for (const h of ['#/s/bpc157', '#/new?c=bpc157&d=xyz', '#/post/1']) assert.equal(worthReturningTo(h), true, h);
  assert.equal(validReturn('#/s/bpc157'), '#/s/bpc157');
  assert.equal(validReturn('javascript:alert(1)'), '');
  assert.equal(validReturn('#/'), '');
});

test('a Signal\'s move, and where its public data came from', () => {
  assert.equal(delta({ score: 60.25, prev_score: 58 }), 2.3);
  assert.equal(delta({ score: 55, prev_score: 58.5 }), -3.5);
  assert.equal(delta({ score: 55 }), 0);
  assert.equal(delta(null), 0);
  assert.deepEqual(OUTCOME.better, ['Better', 'pos']);
  assert.equal(CAUSE.same, 'a “same for me”');
  assert.deepEqual(sourceFamilies([
    { source_families: ['Reddit', 'YouTube index'] },
    { source_families: ['Podcast / YouTube', 'A forum', 'Another forum'] },
    { source_families: [] },
  ]), [{ name: 'Reddit', n: 1 }, { name: 'YouTube', n: 1 }, { name: 'Podcasts', n: 1 }, { name: 'Forums & reviews', n: 1 }]);
});

// A small library: two compounds, a third with a brand name, a blend of the first two, their stack
const SPACES = [
  { compound_id: 'bpc157', name: 'BPC-157', kind: 'compound', family: 'Peptides', category: 'Healing & recovery', aliases: ['Body Protection Compound'], reports: 9, members_count: 30, posts_week: 2, score: 61 },
  { compound_id: 'tb500', name: 'TB-500', kind: 'compound', family: 'Peptides', category: 'Healing & recovery', aliases: ['Thymosin beta-4'], reports: 4, members_count: 12, posts_week: 1, score: 58 },
  { compound_id: 'semaglutide', name: 'Semaglutide', kind: 'compound', family: 'Medications', category: 'Metabolic & weight', aliases: ['Ozempic', 'Wegovy'], reports: 20, members_count: 80, posts_week: 5, score: 77 },
  { compound_id: 'wolverine', name: 'Wolverine blend', kind: 'blend', family: 'Blends', category: 'Healing & recovery', part_ids: ['bpc157', 'tb500'], reports: 1, members_count: 3, posts_week: 0, score: null },
  { compound_id: 'stack-1', name: 'BPC-157 + TB-500', kind: 'stack', category: 'Stacks', part_ids: ['bpc157', 'tb500'], reports: 2, members_count: 5, posts_week: 1, score: null },
];

test('finding an entry from what someone types', () => {
  const ozempic = searchLibrary(SPACES, 'ozempic');
  assert.equal(ozempic[0].sp.compound_id, 'semaglutide');
  assert.equal(ozempic[0].via, 'Ozempic');
  const bpc = searchLibrary(SPACES, 'bpc');
  assert.equal(bpc[0].sp.compound_id, 'bpc157');
  assert.equal(bpc[0].via, null);
  assert.ok(!bpc.some((r) => r.sp.kind === 'stack'), 'stacks only when asked for');
  assert.ok(searchLibrary(SPACES, 'bpc', { kinds: ['stack'] }).every((r) => r.sp.kind === 'stack'));
  assert.deepEqual(searchLibrary(SPACES, 'healing', { family: 'Blends' }).map((r) => r.sp.compound_id), ['wolverine']);
  assert.deepEqual(searchLibrary(SPACES, ''), []);
  assert.deepEqual(popularEntries(SPACES, 2).map((s) => s.compound_id), ['semaglutide', 'bpc157']);
});

test('stacks and blends', () => {
  assert.equal(isStack(SPACES[4]), true);
  assert.equal(familyLabel(SPACES[4]), 'Stack');
  assert.equal(familyLabel(SPACES[3]), 'Blend');
  assert.equal(familyLabel(SPACES[0]), 'Peptide');
  assert.equal(stackName(SPACES, ['tb500', 'bpc157']), 'BPC-157 + TB-500');
  assert.equal(findStack(SPACES, ['tb500', 'bpc157', 'tb500'])?.compound_id, 'stack-1');
  assert.equal(findStack(SPACES, ['bpc157', 'semaglutide']), null);
  assert.deepEqual([...allParts(SPACES, { part_ids: ['wolverine', 'semaglutide'] })].sort(), ['bpc157', 'semaglutide', 'tb500', 'wolverine']);
  assert.deepEqual(containing(SPACES, ['bpc157']).map((s) => s.compound_id), ['stack-1', 'wolverine']);
  assert.deepEqual(containing(SPACES, ['bpc157', 'tb500']).map((s) => s.compound_id), ['wolverine'], 'not the exact stack itself');
  assert.deepEqual(idsFrom(SPACES, 'bpc157, tb500,bpc157'), ['bpc157', 'tb500']);
  assert.deepEqual(idsFrom(SPACES, 'stack-1'), ['bpc157', 'tb500'], 'a stack opens into its parts');
  assert.deepEqual(idsFrom(SPACES, 'nothing,stack-1,semaglutide'), ['semaglutide']);
  assert.equal(MAX_PICKS, 8);
});

test('posts: a title from the first sentence, the thread, the spaces a post is in', () => {
  assert.equal(titleFrom('Week 6 on BPC-157. My knee is better.'), 'Week 6 on BPC-157.');
  assert.equal(titleFrom('Hi'), 'How it went');
  assert.equal(titleFrom('Why?', 'question'), 'A question');
  const long = titleFrom(`${'word '.repeat(40)}end. Next.`);
  assert.ok(long.length <= 118 && long.endsWith('…'), long);
  const rows = [
    { id: 'a', parent_id: null, score: 1, created_at: '2026-11-01T10:00:00Z' },
    { id: 'b', parent_id: null, score: 5, created_at: '2026-11-01T11:00:00Z' },
    { id: 'c', parent_id: 'b', score: 0, created_at: '2026-11-01T12:00:00Z' },
    { id: 'd', parent_id: 'gone', score: 0, created_at: '2026-11-01T13:00:00Z' },
  ];
  const best = buildTree(rows, 'best');
  assert.deepEqual(best.map((c) => c.id), ['b', 'a', 'd'], 'best: score first, an orphaned reply at the top level');
  assert.deepEqual(best[0].kids.map((c) => c.id), ['c']);
  assert.deepEqual(buildTree(rows, 'new').map((c) => c.id), ['d', 'b', 'a']);
  assert.equal(countAll(best[0]), 2);
  assert.deepEqual(partsOf({ compound_id: 'x', part_ids: [] }), ['x']);
  assert.deepEqual(partsOf({ compound_id: 'stack-1', part_ids: ['bpc157', 'tb500'] }), ['bpc157', 'tb500']);
  assert.ok(REASONS.some(([key]) => key === 'self_harm'));
});

test('Sig\'s read in one line, and what it may have been for', () => {
  const label = (id) => ({ joint_pain: 'Joint pain', sleep: 'Sleep' }[id] || id);
  assert.equal(readLine({ outcome: 'better', duration: '1–3 months', read_uses: [{ use: 'joint_pain', outcome: 'better' }, { use: 'sleep', outcome: 'same' }], side_effects: [] }, label),
    'Better · 1–3 months · for joint pain, sleep (about the same) · no side effects');
  assert.equal(readLine({ outcome: 'worse', read_uses: [], side_effects: ['Headache'] }, label), 'Worse · side effects: Headache');
  assert.deepEqual(likelyUses({ by_use: [{ use: 'sleep' }] }, { uses: [{ id: 'joint_pain' }, { id: 'sleep' }] }), ['sleep', 'joint_pain']);
  assert.deepEqual(likelyUses(null, null), []);
  assert.equal(lower('Joint pain'), 'joint pain');
  assert.equal(HOW_LONG.length, 5);
});

test('the game: the next emblem, quests ready to claim, the season', () => {
  const levels = [{ n: 1, min_points: 0 }, { n: 2, min_points: 100 }];
  assert.equal(nextLevel(levels, 1)?.n, 2);
  assert.equal(nextLevel(levels, 2), undefined);
  assert.equal(progressPct(levels[0], levels[1], 25), 25);
  assert.equal(progressPct(levels[1], undefined, 500), 100);
  const quests = [
    { key: 'a', have: 1, need: 1, claimed: true, sort: 1 },
    { key: 'b', have: 0, need: 3, claimed: false, sort: 2 },
    { key: 'c', have: 3, need: 3, claimed: false, sort: 3 },
  ];
  assert.equal(readyToClaim(quests), 1);
  assert.deepEqual(questOrder(quests).map((q) => q.key), ['c', 'b', 'a']);
  assert.deepEqual(quests.map((q) => q.key), ['a', 'b', 'c'], 'the list itself stays as it was');
  assert.equal(seasonPct({ season_reports: 250, season_goal: 1000 }), 25);
  assert.equal(seasonPct({ season_reports: 1500, season_goal: 1000 }), 100);
  assert.equal(daysLeft('2026-11-10', Date.parse('2026-11-08T00:00:00Z')), 3, 'the 8th, 9th and 10th');
  assert.equal(daysLeft('2026-11-10', Date.parse('2026-11-07T23:30:00Z')), 4, 'part of the 7th counts too');
  assert.equal(daysLeft('2026-11-01', Date.parse('2026-11-07T00:00:00Z')), 0);
  assert.equal(monthName(new Date('2026-11-07T12:00:00Z')), 'November');
});

test('what a moderator\'s action says', () => {
  assert.equal(MOD_TEXT.remove({ what: 'post', reason: 'Rule 1: sourcing or selling' }), 'A moderator removed your post: Rule 1: sourcing or selling');
  assert.equal(MOD_TEXT.hold({ what: 'comment', by: 'moderator' }), 'Your comment is waiting for a moderator');
  assert.equal(MOD_TEXT.hold({ what: 'comment', by: 'auto' }), 'Your comment is waiting for a moderator (an automatic check)');
  assert.equal(MOD_TEXT.unban(), 'Your account is active again');
});
