#!/usr/bin/env node
// The public report pages at community.miraclehealth.us/r/: one page for each report its author
// chose to let anyone read ("Let anyone read it" on the report, or the box when posting), and a
// list of them, newest first. Comments are never on them, and nor is anything else about the
// author but their handle.
//
// Made at every site build (the Pages workflow, every hour) from private.public_reports()
// (scripts/supabase_project.sh live public-reports), so a report its author takes back, one a
// moderator holds or removes, or one whose author deletes their account, is off the site within
// the hour. If the list can't be had, the build leaves every report page out rather than keep an
// old one up.
//
// Usage: node scripts/build_public_reports.mjs <reports.json | -> <site_dir>
//   "-": no list this time (the pages are left out, and /r/ says so)
// Also writes sitemap.xml and robots.txt at the site's root.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { barHtml, esc, SITE, COMMUNITY } from '../shared/kit/kit.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [src, outDir] = process.argv.slice(2);
if (!src || !outDir) { console.error('Usage: node scripts/build_public_reports.mjs <reports.json | -> <site_dir>'); process.exit(2); }

// These pages are made from this checkout every hour, while the app at the site's root is whatever
// commit is tagged "live". So they bring their own stylesheet, design kit and fonts (all in /r/)
// and never borrow the app's: a new look can't reach them half way.
const STYLES = [['kit.css', path.join(ROOT, 'shared', 'kit', 'kit.css')], ['r.css', path.join(ROOT, 'site', 'r.css')]];
const FONTS = ['mona-sans.woff2', 'monaspace-neon-400.woff2'];
// Each new version of the styles gets its own address, so a browser never pairs an old stylesheet with a new page
const V = crypto.createHash('sha256').update(STYLES.map(([, f]) => fs.readFileSync(f)).join('\n')).digest('hex').slice(0, 10);

let reports = null;
if (src !== '-') {
  const list = JSON.parse(fs.readFileSync(src, 'utf8'));
  if (!Array.isArray(list)) throw new Error('The list of public reports should be an array');
  reports = list.filter((r) => r && /^[0-9a-f-]{36}$/i.test(String(r.id)) && r.title && r.body && r.handle);
}

// Which compounds have a page in the Library on miraclehealth.us (every compound and blend in the
// catalog does; stacks don't). Without the list, no links: never a link to a page that isn't there.
let inLibrary = new Set();
try {
  const r = await fetch(`${SITE}/library/data/index.json`, { signal: AbortSignal.timeout(15000) });
  if (r.ok) inLibrary = new Set(((await r.json()).items || []).map((x) => x.id));
} catch { /* no links this time */ }

const OUTCOME = { better: ['Better than before', 'pos'], same: ['About the same', 'neu'], worse: ['Worse than before', 'neg'] };
const day = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
// A post's words as paragraphs, escaped; links are left as text (nobody is sent anywhere from here)
const paras = (text) => String(text).trim().split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n');
const clip = (s, n) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : t; };

function shell({ title, description, url, body, noindex = false }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="${noindex ? 'noindex' : 'index, follow'}, noarchive">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#0C1413">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="strict-origin-when-cross-origin">
<link rel="canonical" href="${COMMUNITY}${url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Miracle Health">
<meta property="og:url" content="${COMMUNITY}${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${SITE}/og.jpg">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/r/fonts/mona-sans.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/r/kit.css?v=${V}">
<link rel="stylesheet" href="/r/r.css?v=${V}">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <div class="wrap top-in">
    <a class="logo" href="${SITE}/"><img src="/logo.webp" alt="Miracle Health" width="80" height="28"></a>
    ${barHtml('community', { cls: 'top-nav', label: 'Main' })}
    <a class="btn lime sm" href="${COMMUNITY}/">Join</a>
  </div>
</header>
<main id="main" class="wrap">
${body}
</main>
<footer class="foot">
  <div class="wrap">
    <p>One member’s experience, in their own words: not medical advice, and not a recommendation. Talk to a clinician before you start, stop or change anything. In a crisis, call or text 988 (US).</p>
    <p><a href="${SITE}/">miraclehealth.us</a> · <a href="${SITE}/method/">How the numbers are made</a> · <a href="${SITE}/privacy">Privacy</a> · <a href="mailto:hello@miraclehealth.us?subject=A%20public%20report">Report a problem with this page</a></p>
  </div>
</footer>
</body>
</html>
`;
}

function chips(r) {
  const o = OUTCOME[r.outcome];
  return [
    o ? `<span class="chip ${o[1]}">${esc(o[0])}</span>` : '',
    r.duration ? `<span class="chip">${esc(r.duration)}</span>` : '',
  ].filter(Boolean).join('');
}

function reportPage(r) {
  const lib = inLibrary.has(r.compound) ? `${SITE}/library/${encodeURIComponent(r.compound)}/` : '';
  const body = `<article class="report">
  <p class="kick"><a href="/r/">Public reports</a> · ${lib ? `<a href="${esc(lib)}">${esc(r.compound_name)}</a>` : esc(r.compound_name)}</p>
  <h1>${esc(r.title)}</h1>
  <p class="by">u/${esc(r.handle)} · ${esc(day(r.at))}${r.edited_at ? ' · edited' : ''}</p>
  <div class="chips">${chips(r)}</div>
  <div class="words">
${paras(r.body)}
  </div>
  <p class="note">Shared by its author for anyone to read. Members see the conversation under it, and every report like this one counts in ${esc(r.compound_name)}’s Community Signal.</p>
  <div class="acts">
    <a class="btn bone" href="${COMMUNITY}/#/new?c=${encodeURIComponent(r.compound)}">Took it too? Share how it went</a>
    ${lib ? `<a class="btn ghost" href="${esc(lib)}">What the studies say about ${esc(r.compound_name)}</a>` : ''}
  </div>
</article>`;
  return shell({
    title: `${clip(r.title, 70)} · ${r.compound_name} · Miracle Health`,
    description: clip(`${r.compound_name}: ${r.body}`, 155),
    url: `/r/${r.id}/`, body,
  });
}

function listPage() {
  const intro = '<p class="lede">Reports members chose to let anyone read: what they took, what for, how long, and how it went compared with before, in their own words. Everything else in the community is for members.</p>';
  let inner;
  if (reports === null) inner = '<p class="empty">The public reports couldn’t be loaded for this hour’s update of the site. They’ll be back at the next one.</p>';
  else if (!reports.length) inner = `<p class="empty">None yet. When a member lets anyone read a report, it’s listed here.</p>`;
  else {
    inner = `<ul class="list">${reports.map((r) => `<li>
    <a href="/r/${esc(r.id)}/"><span class="t">${esc(r.title)}</span>
    <span class="m">${esc(r.compound_name)} · u/${esc(r.handle)} · ${esc(day(r.at))}</span>
    <span class="chips">${chips(r)}</span></a>
  </li>`).join('\n')}</ul>`;
  }
  return shell({
    title: 'Public reports · Miracle Health community',
    description: 'Reports Miracle Health members chose to let anyone read: what they took, for what, for how long, and how it went, in their own words.',
    url: '/r/', noindex: reports === null || !reports?.length,
    body: `<div class="report"><p class="kick">Miracle Health community</p><h1>Public reports</h1>${intro}${inner}
  <div class="acts"><a class="btn bone" href="${COMMUNITY}/#/new">Share how it went</a><a class="btn ghost" href="${SITE}/library/">Look up a compound</a></div></div>`,
  });
}

const rDir = path.join(outDir, 'r');
fs.rmSync(rDir, { recursive: true, force: true });
fs.mkdirSync(rDir, { recursive: true });
for (const [name, from] of STYLES) fs.copyFileSync(from, path.join(rDir, name));
fs.mkdirSync(path.join(rDir, 'fonts'));
for (const f of FONTS) fs.copyFileSync(path.join(ROOT, 'web', 'fonts', f), path.join(rDir, 'fonts', f));
fs.writeFileSync(path.join(rDir, 'index.html'), listPage());
for (const r of reports || []) {
  fs.mkdirSync(path.join(rDir, r.id), { recursive: true });
  fs.writeFileSync(path.join(rDir, r.id, 'index.html'), reportPage(r));
}
// Search engines: the public reports and their list, nothing of the app
fs.writeFileSync(path.join(outDir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${(reports || []).length ? `  <url><loc>${COMMUNITY}/r/</loc></url>\n${reports.map((r) => `  <url><loc>${COMMUNITY}/r/${r.id}/</loc><lastmod>${String(r.edited_at || r.at).slice(0, 10)}</lastmod></url>`).join('\n')}\n` : ''}</urlset>
`);
fs.writeFileSync(path.join(outDir, 'robots.txt'), `User-agent: *\nAllow: /r/\nAllow: /$\nDisallow: /\nSitemap: ${COMMUNITY}/sitemap.xml\n`);
console.log(reports === null ? 'public reports: no list this time; none published' : `public reports: ${reports.length} page${reports.length === 1 ? '' : 's'}`);
