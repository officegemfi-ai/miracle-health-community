// The kit's body map (shared/kit/bodymap.js): the markup for every state, what screen readers
// get, and the loader. Run: node --test tests/web/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bodyMapHtml, bodyLoader, BODY_MAX } from '../../shared/kit/bodymap.js';

const places = [{ at: 'pituitary', say: 'the pituitary' }, { at: 'liver', say: 'the liver' }, { at: 'blood sugar', say: 'blood sugar' }, { at: 'joints · fluid', say: 'the joints and body fluid' }];
const markers = { igf1: { name: 'IGF-1', what: 'The growth factor growth hormone tells the body to make.' }, glucose: { name: 'Fasting glucose', what: 'Blood sugar after a night without food.' } };
const hgh = {
  route: 'injection',
  lines: [
    { at: 'liver', op: 'up', say: 'IGF-1 rises', markers: ['igf1', 'shbg'], src: [1] },
    { at: 'pituitary', op: 'is', say: 'the growth hormone it makes, given from outside', src: [1] },
    { at: 'spleen', op: 'is', say: 'a place the map doesn’t list', src: [2] },
    { at: 'joints · fluid', op: 'warn', say: 'swelling, joint pain, carpal tunnel', risk: 'swelling', src: [1, 3] },
  ],
  dirs: { igf1: 'up' },
};
const enclo = { route: 'pill', lines: [{ at: 'pituitary', op: 'up', say: 'LH and FSH rise', src: [5] }, { at: 'liver', op: 'down', say: 'IGF-1 falls', markers: ['igf1'], src: [10] }], dirs: { igf1: 'down' } };
const one = (entry = hgh, more = {}) => bodyMapHtml({ items: [{ id: 'somatropin', name: 'Somatropin (HGH)', entry }], places, markers, ...more });
const order = (html, words) => words.map((w) => html.indexOf(w));

test('one compound: a sentence, then its places head to toe, a place the map doesn’t list last', () => {
  const html = one();
  assert.match(html, /<p class="mh-bm-lead">Somatropin \(HGH\) works in 4 places in the body, from the pituitary to the spleen\./);
  assert.match(html, /Taken as: injection/);
  const at = order(html, ['<dt>Pituitary</dt>', '<dt>Liver</dt>', '<dt>Joints · fluid</dt>', '<dt>Spleen</dt>']);
  assert.ok(at.every((x, i) => x > 0 && (i === 0 || x > at[i - 1])), `places in order: ${at}`);
  assert.match(html, /<dl class="mh-bm-list" aria-label="How Somatropin \(HGH\) works in the body, place by place, head to toe">/);
  assert.match(html, /class="mh-bm-row warn"><dt>Joints · fluid<\/dt>/);
});

test('each line: its mark hidden, its word for screen readers, its sources, its markers', () => {
  const html = one(hgh, { sourceHref: (id, n) => `#src-${n}` });
  assert.match(html, /<span class="mh-bm-op" aria-hidden="true">▲<\/span><span class="mh-bm-txt"><span class="mh-sr">raises: <\/span>IGF-1 rises/);
  assert.match(html, /<span class="mh-sr">caution: <\/span>swelling/);
  assert.match(html, /<a class="mh-bm-src" href="#src-1" aria-label="Source 1">1<\/a><a class="mh-bm-src" href="#src-3" aria-label="Source 3">3<\/a>/);
  // A marker the map doesn't know isn't shown; a known one carries its direction, in words too
  assert.doesNotMatch(html, /shbg/);
  assert.match(html, /<li class="mh-bm-ln op-up" data-mk="igf1">/);
  assert.match(html, /<span class="mh-bm-mk d-up" data-mk="igf1" title="The growth factor[^"]*">IGF-1<span class="mh-bm-dir" aria-hidden="true">▲<\/span><span class="mh-sr">, may rise<\/span><\/span>/);
  // By default a source leads to the compound's fact sheet
  assert.match(one(), /href="https:\/\/miraclehealth\.us\/library\/somatropin\/#src-1"/);
});

test('everything said is escaped', () => {
  const html = bodyMapHtml({
    items: [{ id: 'x', name: '<img src=x onerror=alert(1)>', entry: { lines: [{ at: 'liver', op: 'is', say: '"<b>bold</b>" & more', src: [1] }] } }],
    places, markers: { igf1: { name: '<i>', what: '"><script>' } },
  });
  assert.doesNotMatch(html, /<img|<b>|<script|<i>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&quot;&lt;b&gt;bold&lt;\/b&gt;&quot; &amp; more/);
});

test('two to six: a table, one column each, with where they meet marked in words', () => {
  const html = bodyMapHtml({ items: [{ id: 'somatropin', name: 'HGH', entry: hgh }, { id: 'enclomiphene', name: 'Enclomiphene', entry: enclo }], places, markers });
  assert.match(html, /<p class="mh-bm-lead">HGH and enclomiphene meet in 2 places: the pituitary and the liver\.<\/p>/);
  assert.match(html, /role="region" tabindex="0" aria-labelledby="mh-bm-cap"/);
  assert.match(html, /<caption id="mh-bm-cap" class="mh-sr">How HGH and enclomiphene work in the body, place by place, head to toe<\/caption>/);
  assert.equal((html.match(/<th scope="col">/g) || []).length, 2);
  assert.equal((html.match(/<tr class="meet[^"]*"><th scope="row">/g) || []).length, 2);
  assert.match(html, /<span class="mh-bm-meet"><span aria-hidden="true">∩ <\/span>where they meet<\/span>/);
  assert.match(html, /aria-label="HGH, source 1"/);
  const three = bodyMapHtml({ items: [{ id: 'a', name: 'A', entry: enclo }, { id: 'b', name: 'B', entry: hgh }, { id: 'c', name: 'Cee', entry: { lines: [{ at: 'blood sugar', op: 'is', say: 'x', src: [1] }] } }], places, markers });
  assert.match(three, /Where they meet: the pituitary \(A and B\) and the liver \(A and B\)\./);
  const apart = bodyMapHtml({ items: [{ id: 'a', name: 'Alpha', entry: { lines: [{ at: 'liver', op: 'is', say: 'x', src: [1] }] } }, { id: 'b', name: 'Beta', entry: { lines: [{ at: 'pituitary', op: 'is', say: 'y', src: [1] }] } }], places });
  assert.match(apart, /Alpha and beta work in different places in the body, with none in common\./);
});

test('not drawn yet, and couldn’t be loaded', () => {
  assert.match(one(null), /How Somatropin \(HGH\) works in the body isn’t drawn yet\./);
  assert.match(bodyMapHtml({ items: [{ id: 'ss31', name: 'SS-31', failed: true }] }), /How SS-31 works in the body couldn’t be loaded just now\.<\/p><p class="mh-sr"/);
  const html = bodyMapHtml({ items: [{ id: 'somatropin', name: 'HGH', entry: hgh }, { id: 'nad', name: 'NAD+' }, { id: 'ss31', name: 'SS-31', failed: true }], places, markers });
  assert.match(html, /Where they meet isn’t drawn yet: NAD\+ is still to come, and SS-31 couldn’t be loaded just now\./);
  const lost = bodyMapHtml({ items: [{ id: 'somatropin', name: 'HGH', entry: hgh }, { id: 'ss31', name: 'SS-31', failed: true }], places, markers });
  assert.match(lost, /Where they meet can’t be shown yet: SS-31 couldn’t be loaded just now\./);
  assert.match(html, /<span class="mh-bm-note">not drawn yet<\/span>/);
  assert.match(html, /<span class="mh-bm-note">couldn’t be loaded<\/span>/);
});

test('loading says so and is busy; an error is announced and offers Try again only when asked', () => {
  const loading = one(hgh, { state: 'loading' });
  assert.match(loading, /data-state="loading" aria-busy="true"/);
  assert.match(loading, /<div class="mh-bm-skel" aria-hidden="true">/);
  assert.match(loading, /<p class="mh-sr">Loading how Somatropin \(HGH\) works in the body…<\/p>/);
  assert.doesNotMatch(loading, /mh-bm-ln/);
  const error = one(hgh, { state: 'error' });
  assert.match(error, /<p class="mh-bm-msg" role="alert">How it works in the body couldn’t be loaded just now\.<\/p>/);
  assert.doesNotMatch(error, /data-mh-bm-retry/);
  assert.match(one(hgh, { state: 'error', retry: true, message: 'Offline.' }), /role="alert">Offline\.<\/p><button type="button" class="mh-bm-retry" data-mh-bm-retry>Try again<\/button>/);
  assert.match(one(hgh, { state: 'nonsense' }), /data-state="ready" aria-busy="false"/);
  // Every state has the live region the behavior speaks through
  for (const html of [loading, error, one()]) assert.match(html, /<p class="mh-sr" aria-live="polite" data-mh-bm-say><\/p><\/div>$/);
});

test('the compounds asked for are cleaned: known ids, each once, at most six', () => {
  assert.match(bodyMapHtml({ items: [{ id: '../x' }, null, 'nope'] }), /Nothing to draw\./);
  const ids = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, name: `C${i}`, entry: hgh }));
  const html = bodyMapHtml({ items: [...ids, { id: 'c0', name: 'again' }], places, markers });
  assert.equal((html.match(/<th scope="col">/g) || []).length, BODY_MAX);
  assert.doesNotMatch(html, /again/);
  assert.match(bodyMapHtml({ items: [{ id: 'x', entry: hgh }], places, markers, id: 'my map<' }), /id="mymap"/);
});

test('a part that couldn’t be loaded offers Try again, when asked to, in the map itself', () => {
  const items = [{ id: 'somatropin', name: 'HGH', entry: hgh }, { id: 'ss31', name: 'SS-31', failed: true }];
  assert.doesNotMatch(bodyMapHtml({ items, places, markers }), /data-mh-bm-retry/);
  assert.match(bodyMapHtml({ items, places, markers, retry: true }), /couldn’t be loaded just now\.<\/p><button type="button" class="mh-bm-retry" data-mh-bm-retry>Try again<\/button>\n<div class="mh-bm-scroll"/);
  assert.match(bodyMapHtml({ items: [items[1]], retry: true }), /couldn’t be loaded just now\.<\/p><button type="button" class="mh-bm-retry" data-mh-bm-retry>Try again<\/button>/);
  // Every part drawn: nothing to try again
  assert.doesNotMatch(bodyMapHtml({ items: [items[0]], places, markers, retry: true }), /data-mh-bm-retry/);
});

test('no inline style anywhere: the table says how many columns it has, and the styles size it', () => {
  const html = bodyMapHtml({ items: [{ id: 'a', name: 'A', entry: enclo }, { id: 'b', name: 'B', entry: hgh }, { id: 'c', name: 'C', entry: hgh }], places, markers });
  assert.doesNotMatch(html, /style=/);
  assert.match(html, /<table class="mh-bm-table" data-n="3">/);
});

test('names every object has are no op or direction', () => {
  const odd = { lines: [{ at: 'liver', op: 'toString', say: 'x', markers: ['igf1'], src: [1] }, { at: 'liver', op: 'constructor', say: 'y', src: [1] }], dirs: { igf1: 'constructor' } };
  const html = one(odd);
  assert.equal((html.match(/class="mh-bm-ln op-is"/g) || []).length, 2);
  assert.match(html, /class="mh-bm-mk d-watch"/);
});

test('the key lists only the marks the map uses, and none for a single kind', () => {
  assert.match(one(), /<ul class="mh-bm-key" aria-hidden="true"><li class="op-is">.*<li class="op-up">.*<li class="op-warn">/);
  assert.doesNotMatch(one(), /op-block|op-down/);
  assert.doesNotMatch(one({ lines: [{ at: 'liver', op: 'up', say: 'x', src: [1] }] }), /mh-bm-key/);
});

test('the loader: the index and each compound once, by version; undrawn null; failures retried', async () => {
  const calls = [];
  let indexFails = 1;
  const files = {
    '/b/index.json': { places, markers, drawn: { somatropin: 'v1', broken: 'v2' } },
    '/b/somatropin.json?v=v1': hgh,
    '/b/broken.json?v=v2': { nope: true },
  };
  const getJson = async (url) => {
    calls.push(url);
    if (url === '/b/index.json' && indexFails-- > 0) throw new Error('offline');
    return files[url];
  };
  const load = bodyLoader(getJson, '/b');
  await assert.rejects(load(['somatropin']), /offline/);
  const a = await load(['somatropin', 'nad', 'broken', '../x', 'somatropin']);
  assert.deepEqual(Object.keys(a.entries), ['somatropin', 'nad', 'broken']);
  assert.equal(a.entries.somatropin, hgh);
  assert.equal(a.entries.nad, null);
  assert.deepEqual(a.entries.broken, { failed: true });
  assert.deepEqual(a.places, places);
  await load(['somatropin']);
  assert.deepEqual(calls, ['/b/index.json', '/b/index.json', '/b/somatropin.json?v=v1', '/b/broken.json?v=v2']);
  // A file that couldn't be read is asked for again next time
  files['/b/broken.json?v=v2'] = hgh;
  assert.equal((await load(['broken'])).entries.broken, hgh);
  assert.equal(calls.filter((u) => u.startsWith('/b/broken.json')).length, 2);
  // An index without its list of drawn compounds is an error, not an empty map
  await assert.rejects(bodyLoader(async () => ({}), '/c')(['x']), /unavailable/);
});
