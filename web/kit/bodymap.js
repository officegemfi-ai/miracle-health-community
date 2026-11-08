// The body map: how a compound works in the body, place by place, head to toe, from its Library
// fact sheet (the website's library/data/body.json, each line checked against the sheet and
// citing its sources). One compound reads as a list of places; two to six line up in a table,
// with where they meet marked. One component, in four parts:
//   bodyMapHtml(props)        the markup for every state (loading, error, ready). Pure: the
//                             website's build prints it into static pages, the apps render it
//   bodyLoader(getJson, base) the data: the map's index once, then each compound's own lines once,
//                             read with the host's own getJson (the kit fetches nothing itself)
//   wireBodyMap(root)         the behavior: marker chips become buttons that light the lines
//                             naming that marker (Escape clears), and Try again calls back
//   mountBodyMap(root, opts)  for a page that loads it live: loading, then ready or error
// Like the rest of the kit: no imports, our own markup with escaped text only, the same file on
// both sites (scripts/sync_kit.sh). The styles are in kit.css (.mh-bm).

const SITE = 'https://miraclehealth.us';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const okId = (id) => typeof id === 'string' && /^[a-z0-9]{1,40}$/.test(id);
const okKey = (k) => typeof k === 'string' && /^[a-z0-9]{1,20}$/.test(k);
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const listOf = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
// A name inside a sentence: "Enclomiphene" becomes "enclomiphene"; HGH, IGF-1 and NAD+ stay as they are
const mid = (s) => (/^[A-Z][a-z]+(?:[\s,]|$)/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const namesOf = (xs) => listOf(xs.map((x, i) => (i ? mid(x) : x)));

// At most this many compounds side by side
export const BODY_MAX = 6;
// What a line does at its place: its mark, and the word a screen reader hears instead
export const BODY_OPS = {
  is: ['▶', 'acts'], up: ['▲', 'raises'], down: ['▼', 'lowers'], block: ['┤', 'blocks'], watch: ['◆', 'worth checking'], warn: ['!', 'caution'],
};
// Which way a blood marker may move
const DIRS = { up: ['▲', 'may rise'], down: ['▼', 'may fall'], watch: ['◆', 'worth checking'] };

// The compounds asked for, cleaned: known ids only, each once, at most BODY_MAX. A compound with
// lines is drawn; without, it isn't drawn yet (or, when failed, its lines couldn't be read)
function itemsOf(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .filter((it) => it && okId(it.id) && !seen.has(it.id) && seen.add(it.id))
    .slice(0, BODY_MAX)
    .map((it) => {
      const e = isObj(it.entry) ? it.entry : {};
      const lines = (Array.isArray(e.lines) ? e.lines : []).filter((ln) => isObj(ln) && typeof ln.at === 'string' && ln.at && typeof ln.say === 'string' && ln.say);
      return {
        id: it.id, name: String(it.name || it.id), failed: !!it.failed, drawn: !it.failed && lines.length > 0,
        lines, dirs: isObj(e.dirs) ? e.dirs : {}, route: typeof e.route === 'string' ? e.route : '',
      };
    });
}

// The places the drawn compounds work in, head to toe (a place the map doesn't list comes after,
// in the order first seen), each with every compound's lines there
function rowsOf(list, places) {
  const order = new Map((Array.isArray(places) ? places : []).filter((p) => isObj(p) && typeof p.at === 'string').map((p, i) => [p.at, i]));
  const rows = new Map();
  const seen = [];
  for (const it of list) {
    for (const ln of it.lines) {
      if (!rows.has(ln.at)) { rows.set(ln.at, new Map()); seen.push(ln.at); }
      const cells = rows.get(ln.at);
      if (!cells.has(it.id)) cells.set(it.id, []);
      cells.get(it.id).push(ln);
    }
  }
  const rank = (at) => (order.has(at) ? order.get(at) : 1000 + seen.indexOf(at));
  return [...seen].sort((a, b) => rank(a) - rank(b)).map((at) => {
    const cells = rows.get(at);
    const lines = [...cells.values()].flat();
    return { at, cells, meet: cells.size > 1, warn: lines.some((l) => l.op === 'warn'), watch: lines.some((l) => l.op === 'watch') };
  });
}

// One line: its mark (with the word for screen readers), what happens, its sources, and the blood
// markers it moves, each a chip (wireBodyMap makes them buttons)
function lineHtml(it, ln, { markers, sourceHref, many }) {
  const op = Object.hasOwn(BODY_OPS, ln.op) ? ln.op : 'is';
  const [mark, verb] = BODY_OPS[op];
  const mks = (Array.isArray(ln.markers) ? ln.markers : []).filter((m) => okKey(m) && isObj(markers[m]));
  const src = (Array.isArray(ln.src) ? ln.src : []).filter((n) => Number.isInteger(n) && n > 0 && n < 1000).slice(0, 4);
  const refs = src.map((n) => `<a class="mh-bm-src" href="${esc(sourceHref(it.id, n))}" aria-label="${esc(many ? `${it.name}, source ${n}` : `Source ${n}`)}">${n}</a>`).join('');
  const chips = mks.map((m) => {
    const d = Object.hasOwn(DIRS, it.dirs[m]) ? it.dirs[m] : 'watch';
    const [g, says] = DIRS[d];
    return `<span class="mh-bm-mk d-${d}" data-mk="${m}"${markers[m].what ? ` title="${esc(markers[m].what)}"` : ''}>${esc(markers[m].name)}<span class="mh-bm-dir" aria-hidden="true">${g}</span><span class="mh-sr">, ${says}</span></span>`;
  }).join('');
  return `<li class="mh-bm-ln op-${op}"${mks.length ? ` data-mk="${mks.join(' ')}"` : ''}><span class="mh-bm-op" aria-hidden="true">${mark}</span><span class="mh-bm-txt"><span class="mh-sr">${verb}: </span>${esc(ln.say)}${refs ? ` <span class="mh-bm-refs">${refs}</span>` : ''}${chips ? ` <span class="mh-bm-mks">${chips}</span>` : ''}</span></li>`;
}

// The marks the map uses, in words (screen readers hear the words on each line instead)
function keyHtml(rows) {
  const used = new Set(rows.flatMap((r) => [...r.cells.values()].flat().map((l) => (Object.hasOwn(BODY_OPS, l.op) ? l.op : 'is'))));
  const ops = Object.keys(BODY_OPS).filter((k) => used.has(k));
  return ops.length > 1 ? `<ul class="mh-bm-key" aria-hidden="true">${ops.map((k) => `<li class="op-${k}"><span class="mh-bm-op">${BODY_OPS[k][0]}</span>${BODY_OPS[k][1]}</li>`).join('')}</ul>` : '';
}

// Try again, on a map with a part that couldn't be loaded (wireBodyMap's onRetry)
const AGAIN = '<button type="button" class="mh-bm-retry" data-mh-bm-retry>Try again</button>';

// One compound: a sentence, then its places as a list
function oneHtml(it, rows, ctx, label) {
  if (it.failed) return `<p class="mh-bm-msg">How ${esc(it.name)} works in the body couldn’t be loaded just now.</p>${ctx.again}`;
  if (!it.drawn) return `<p class="mh-bm-msg">How ${esc(it.name)} works in the body isn’t drawn yet. Its fact sheet has the details.</p>`;
  const first = ctx.placeSay(rows[0].at);
  const last = ctx.placeSay(rows[rows.length - 1].at);
  const lead = rows.length > 1 ? `${esc(it.name)} works in ${rows.length} places in the body, from ${esc(first)} to ${esc(last)}.` : `${esc(it.name)} works in one place in the body: ${esc(first)}.`;
  return `<p class="mh-bm-lead">${lead}${it.route ? ` <span class="mh-bm-route">Taken as: ${esc(it.route)}</span>` : ''}</p>
<dl class="mh-bm-list" aria-label="${esc(label)}">${rows.map((r) => `<div class="mh-bm-row${r.warn ? ' warn' : ''}${r.watch ? ' watch' : ''}"><dt>${esc(cap(r.at))}</dt><dd><ul>${r.cells.get(it.id).map((ln) => lineHtml(it, ln, ctx)).join('')}</ul></dd></div>`).join('')}</dl>`;
}

// Two to six: a sentence on where they meet, then a table, one column each
function manyHtml(list, rows, ctx, label, uid) {
  const names = list.map((it) => it.name);
  const undrawn = list.filter((it) => !it.drawn && !it.failed);
  const failed = list.filter((it) => it.failed);
  const meet = rows.filter((r) => r.meet);
  const say = (r) => ctx.placeSay(r.at);
  const why = [
    undrawn.length ? `${listOf(undrawn.map((it) => mid(it.name)))} ${undrawn.length === 1 ? 'is' : 'are'} still to come` : '',
    failed.length ? `${listOf(failed.map((it) => mid(it.name)))} couldn’t be loaded just now` : '',
  ].filter(Boolean).join(', and ');
  const lead = why
    ? `Where they meet ${undrawn.length ? 'isn’t drawn yet' : 'can’t be shown yet'}: ${why}.`
    : !meet.length ? `${namesOf(names)} work in different places in the body, with none in common.`
      : list.length === 2 ? (meet.length === 1 ? `${namesOf(names)} meet in one place: ${say(meet[0])}.` : `${namesOf(names)} meet in ${meet.length} places: ${listOf(meet.map(say))}.`)
        : `Where they meet: ${listOf(meet.map((r) => `${say(r)} (${listOf([...r.cells.keys()].map((id) => mid(list.find((it) => it.id === id).name)))})`))}.`;
  const head = list.map((it) => `<th scope="col"><span class="mh-bm-name">${esc(it.name)}</span>${it.route ? `<span class="mh-bm-route">${esc(it.route)}</span>` : ''}${it.drawn ? '' : `<span class="mh-bm-note">${it.failed ? 'couldn’t be loaded' : 'not drawn yet'}</span>`}</th>`).join('');
  const body = rows.map((r) => `<tr class="${[r.meet && 'meet', r.warn && 'warn', r.watch && 'watch'].filter(Boolean).join(' ')}"><th scope="row">${esc(cap(r.at))}${r.meet ? '<span class="mh-bm-meet"><span aria-hidden="true">∩ </span>where they meet</span>' : ''}</th>${list.map((it) => `<td>${r.cells.has(it.id) ? `<ul>${r.cells.get(it.id).map((ln) => lineHtml(it, ln, ctx)).join('')}</ul>` : ''}</td>`).join('')}</tr>`).join('');
  // (the column count as an attribute the styles read: an inline style breaks a strict security policy)
  return `<p class="mh-bm-lead">${esc(lead)}</p>${failed.length ? ctx.again : ''}
<div class="mh-bm-scroll" role="region" tabindex="0" aria-labelledby="${uid}-cap"><table class="mh-bm-table" data-n="${list.length}"><caption id="${uid}-cap" class="mh-sr">${esc(label)}</caption><thead><tr><td></td>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/**
 * The body map's markup, for any state.
 * @param {object} props
 * @param {{id: string, name?: string, entry?: object|null, failed?: boolean}[]} props.items
 *   1 to 6 compounds, in the order shown. entry is the compound's body-map entry ({ route, lines,
 *   dirs }); none means it isn't drawn yet, and failed means its lines couldn't be read.
 * @param {{at: string, say: string}[]} [props.places] the head-to-toe order, and how a sentence names each place
 * @param {Object<string, {name: string, what?: string}>} [props.markers] the blood markers a chip may name
 * @param {'ready'|'loading'|'error'} [props.state]
 * @param {string} [props.message] the error state's words
 * @param {boolean} [props.retry] offer Try again (wireBodyMap's onRetry): in the error state, and
 *   on a ready map with a part whose lines couldn't be read
 * @param {(id: string, n: number) => string} [props.sourceHref] where a line's source number leads
 *   (default: that compound's fact sheet on miraclehealth.us)
 * @param {string} [props.label] the accessible name (default: "How X works in the body, place by place, head to toe")
 * @param {string} [props.id] an id for this map, unique on the page
 * @param {string} [props.note] a line under the map
 * @returns {string} markup: our own elements and escaped text only
 */
export function bodyMapHtml({ items, places = [], markers = {}, state = 'ready', message = '', retry = false, sourceHref, label = '', id = 'mh-bm', note = '' } = {}) {
  const list = itemsOf(items);
  const uid = String(id).replace(/[^A-Za-z0-9_-]/g, '') || 'mh-bm';
  const names = namesOf(list.map((it) => it.name));
  const name = label || `How ${names || 'it'} work${list.length === 1 ? 's' : ''} in the body, place by place, head to toe`;
  const sayOf = new Map((Array.isArray(places) ? places : []).filter((p) => isObj(p) && typeof p.at === 'string' && typeof p.say === 'string').map((p) => [p.at, p.say]));
  const ctx = {
    markers: isObj(markers) ? markers : {}, many: list.length > 1,
    sourceHref: typeof sourceHref === 'function' ? sourceHref : (cid, n) => `${SITE}/library/${encodeURIComponent(cid)}/#src-${n}`,
    placeSay: (at) => sayOf.get(at) || `the ${at}`,
    again: retry ? AGAIN : '',
  };
  const st = ['loading', 'error'].includes(state) ? state : 'ready';
  let inner;
  if (!list.length) inner = '<p class="mh-bm-msg">Nothing to draw.</p>';
  else if (st === 'loading') {
    inner = `<div class="mh-bm-skel" aria-hidden="true">${'<span><i></i><i></i></span>'.repeat(4)}</div><p class="mh-sr">Loading how ${esc(names)} work${list.length === 1 ? 's' : ''} in the body…</p>`;
  } else if (st === 'error') {
    inner = `<p class="mh-bm-msg" role="alert">${esc(message || 'How it works in the body couldn’t be loaded just now.')}</p>${retry ? AGAIN : ''}`;
  } else {
    const rows = rowsOf(list.filter((it) => it.drawn), places);
    inner = list.length === 1 ? oneHtml(list[0], rows, ctx, name) : manyHtml(list, rows, ctx, name, uid);
    inner += keyHtml(rows);
  }
  return `<div class="mh-bm${list.length > 1 ? ' many' : ''}" id="${uid}" data-mh-bm data-state="${st}" aria-busy="${st === 'loading'}">${inner}${note ? `<p class="mh-bm-foot">${esc(note)}</p>` : ''}<p class="mh-sr" aria-live="polite" data-mh-bm-say></p></div>`;
}

/**
 * The data, with the host's own getJson(url) (a promise of parsed JSON, rejecting when it can't):
 * the map's index once (the places, the markers, and each drawn compound's file version), then
 * each compound's own lines once. A failed index is tried again next time; a compound whose lines
 * can't be read comes back as { failed: true } (and is tried again next time), one that isn't drawn
 * as null.
 * @param {(url: string) => Promise<any>} getJson
 * @param {string} [base] where the map's files are (the website's library/data/body)
 * @returns {(ids: string[]) => Promise<{places: object[], markers: object, entries: Object<string, object|null>}>}
 */
export function bodyLoader(getJson, base = `${SITE}/library/data/body`) {
  let index = null;
  const lines = new Map();
  const readIndex = () => {
    index ||= Promise.resolve().then(() => getJson(`${base}/index.json`)).then((ix) => {
      if (!isObj(ix) || !isObj(ix.drawn)) throw new Error('The body map index is unavailable');
      return ix;
    });
    return index.catch((e) => { index = null; throw e; });
  };
  const entryOf = (ix, id) => {
    if (!okId(id) || typeof ix.drawn[id] !== 'string') return Promise.resolve(null);
    if (!lines.has(id)) {
      lines.set(id, Promise.resolve().then(() => getJson(`${base}/${id}.json?v=${encodeURIComponent(ix.drawn[id])}`))
        .then((c) => { if (isObj(c) && Array.isArray(c.lines)) return c; throw new Error('unreadable'); })
        .catch(() => { lines.delete(id); return { failed: true }; }));
    }
    return lines.get(id);
  };
  return async (ids) => {
    const ix = await readIndex();
    const want = [...new Set((Array.isArray(ids) ? ids : []).filter(okId))];
    const got = await Promise.all(want.map((id) => entryOf(ix, id)));
    return { places: Array.isArray(ix.places) ? ix.places : [], markers: isObj(ix.markers) ? ix.markers : {}, entries: Object.fromEntries(want.map((id, i) => [id, got[i]])) };
  };
}

/**
 * The behavior, on markup bodyMapHtml made: each marker chip becomes a button that lights every
 * line naming that marker (pressed again, or Escape, clears it), said to screen readers in the
 * map's live region; Try again calls onRetry. Safe to call twice.
 * @param {Element} root the element with data-mh-bm
 * @param {{onRetry?: () => void}} [opts]
 * @returns {() => void} undoes it
 */
export function wireBodyMap(root, { onRetry } = {}) {
  if (!root || root.dataset.mhBmWired) return () => {};
  root.dataset.mhBmWired = '1';
  const swap = (from, tag) => {
    const to = document.createElement(tag);
    to.className = from.className;
    to.dataset.mk = from.dataset.mk;
    if (from.title) to.title = from.title;
    if (tag === 'button') { to.type = 'button'; to.setAttribute('aria-pressed', 'false'); }
    to.append(...from.childNodes);
    from.replaceWith(to);
  };
  for (const chip of root.querySelectorAll('span.mh-bm-mk[data-mk]')) swap(chip, 'button');
  const live = root.querySelector('[data-mh-bm-say]');
  const quote = (m) => (globalThis.CSS?.escape ? CSS.escape(m) : String(m).replace(/["\\]/g, '\\$&'));
  const nameOf = (m) => root.querySelector(`button.mh-bm-mk[data-mk="${quote(m)}"]`)?.firstChild?.textContent || m;
  // (markup wired before keeps the marker it had lit)
  let lit = root.querySelector('button.mh-bm-mk[aria-pressed="true"]')?.dataset.mk || '';
  const light = (m) => {
    const was = lit;
    lit = lit === m ? '' : m;
    let n = 0;
    for (const ln of root.querySelectorAll('.mh-bm-ln')) {
      const on = !!lit && (ln.dataset.mk || '').split(' ').includes(lit);
      ln.classList.toggle('lit', on);
      if (on) n += 1;
    }
    for (const b of root.querySelectorAll('button.mh-bm-mk')) b.setAttribute('aria-pressed', String(!!lit && b.dataset.mk === lit));
    root.classList.toggle('has-lit', !!lit);
    if (live) live.textContent = lit ? `${nameOf(lit)}: ${n} line${n === 1 ? '' : 's'} lit` : `${nameOf(was)}: no longer lit`;
  };
  const onClick = (e) => {
    const b = e.target.closest?.('button.mh-bm-mk, [data-mh-bm-retry]');
    if (!b || !root.contains(b)) return;
    if (b.matches('[data-mh-bm-retry]')) onRetry?.();
    else light(b.dataset.mk);
  };
  const onKey = (e) => { if (e.key === 'Escape' && lit) light(lit); };
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);
  // Undone, the map is as bodyMapHtml made it: chips again, nothing lit
  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('keydown', onKey);
    for (const b of root.querySelectorAll('button.mh-bm-mk[data-mk]')) swap(b, 'span');
    for (const ln of root.querySelectorAll('.mh-bm-ln.lit')) ln.classList.remove('lit');
    root.classList.remove('has-lit');
    if (live) live.textContent = '';
    delete root.dataset.mhBmWired;
  };
}

/**
 * For a page that loads the map live: draws the loading state at once, then the map. When nothing
 * can be read, the error with Try again; when only some parts can't, the map of the rest with Try
 * again. A newer load always wins over an older one, and focus that was inside the map stays inside it.
 * @param {Element} host where the map goes (its content is replaced)
 * @param {object} opts
 * @param {string[]} opts.ids 1 to 6 compound ids
 * @param {(ids: string[]) => Promise<object>} opts.load a bodyLoader
 * @param {Object<string, string>} [opts.names] each id's name
 * @param {(id: string, n: number) => string} [opts.sourceHref]
 * @param {string} [opts.label] @param {string} [opts.id] @param {string} [opts.note] as for bodyMapHtml
 * @param {(state: string) => void} [opts.onState] told 'loading', 'ready' or 'error'
 * @returns {{refresh: () => Promise<void>, destroy: () => void}}
 */
export function mountBodyMap(host, { ids = [], load, names = {}, sourceHref, label = '', id = 'mh-bm', note = '', onState } = {}) {
  const items = [...new Set((Array.isArray(ids) ? ids : []).filter(okId))].slice(0, BODY_MAX).map((cid) => ({ id: cid, name: names?.[cid] || cid }));
  const who = namesOf(items.map((it) => it.name));
  let alive = true;
  let run = 0;
  let unwire = () => {};
  const paint = (props) => {
    const hadFocus = host.contains(document.activeElement);
    unwire();
    const t = document.createElement('template');
    t.innerHTML = bodyMapHtml({ ...props, sourceHref, label, id, note });
    host.replaceChildren(t.content);
    const root = host.querySelector('[data-mh-bm]');
    unwire = wireBodyMap(root, { onRetry: refresh });
    if (hadFocus && root) { root.tabIndex = -1; root.focus({ preventScroll: true }); }
    onState?.(props.state);
  };
  const failedAll = { items, state: 'error', retry: true, message: `How ${who} work${items.length === 1 ? 's' : ''} in the body couldn’t be loaded just now.` };
  async function refresh() {
    if (!alive) return;
    const mine = ++run;
    paint({ items, state: 'loading' });
    try {
      if (typeof load !== 'function') throw new Error('mountBodyMap needs a load function (bodyLoader)');
      const data = await load(items.map((it) => it.id));
      if (!alive || mine !== run) return;
      const entries = isObj(data?.entries) ? data.entries : {};
      const parts = items.map((it) => { const e = entries[it.id]; return { ...it, entry: e && !e.failed ? e : null, failed: !!e?.failed }; });
      if (parts.every((it) => it.failed)) paint(failedAll);
      else paint({ state: 'ready', retry: true, places: data?.places || [], markers: data?.markers || {}, items: parts });
    } catch {
      if (!alive || mine !== run) return;
      paint(failedAll);
    }
  }
  refresh();
  return { refresh, destroy() { alive = false; run += 1; unwire(); } };
}
