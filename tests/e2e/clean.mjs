// The clean check, for the app: the small details that make a screen look machine-made and busy
// (the owner's rule, November 18; the brand book on miraclehealth.us, "Clean, not costume"). It joins
// the preview as a new member and opens every screen at a laptop's and a phone's width, and fails
// when a screen shows
//   - code costume: a file name as a label, a shell path, a prompt, a command or a flag, a code
//     comment as a label;
//   - a dot chain: three or more short bits strung on middle dots, written or drawn by the stylesheet;
//   - a strip of five or more small dots or colours;
//   - words in the code face: Monaspace Neon is for numbers only (a score, a count, a move).
// Drawings (svg) are left alone. The scan is the website's own (its scripts/check_clean.mjs), so the
// two apps are held to one rule.
// Usage: BASE_URL=... GATE_PASSWORD=... node tests/e2e/clean.mjs   (GATE_PASSWORD only if the build asks)
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4175/';
const PASSWORD = process.env.GATE_PASSWORD || '';
// What stays on purpose, each with its reason
const ALLOW = [
  { sel: 'kbd', rules: ['mono'], why: 'keyboard keys are set in the code face everywhere' },
  { sel: '.demo-banner, .preview-boot', rules: ['mono', 'costume', 'chain'], why: 'the preview build’s own notice; the live app never shows it' },
];
const ROUTES = ['#/home', '#/popular', '#/signal', '#/explore', '#/s/bpc157', '#/new', '#/stack', '#/builders', '#/quests', '#/notifications', '#/account', '#/how', '#/rules'];

/* eslint-disable no-undef */
const SCAN = ({ sel, allow }) => {
  const out = [];
  const root = document.querySelector(sel);
  if (!root) return out;
  const name = (e) => { let s = e.tagName.toLowerCase(); if (e.id) s += `#${e.id}`; const c = [...e.classList].slice(0, 2); if (c.length) s += `.${c.join('.')}`; return s; };
  const where = (e) => { const a = []; for (let x = e, i = 0; x && x.nodeType === 1 && i < 3; x = x.parentElement, i++) a.unshift(name(x)); return a.join(' > '); };
  const allowed = (e, rule) => allow.some((a) => a.rules.includes(rule) && e.closest(a.sel));
  const shown = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    for (let x = e; x && x.nodeType === 1; x = x.parentElement) {
      const c = getComputedStyle(x);
      if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity === 0 || x.hasAttribute('hidden')) return false;
    }
    return true;
  };
  const own = (e) => { let s = ''; for (const n of e.childNodes) if (n.nodeType === 3) s += n.textContent; return s.replace(/\s+/g, ' ').trim(); };
  const COSTUME = [
    [/(^|[\s(“"'‘])[a-z0-9][\w-]*\.(md|top|log|feed|sh|json|txt|yml|csv)\b/i, 'a file name'],
    [/(^|\s)~\//, 'a shell path'],
    [/\b[a-z]+@[a-z]+\b(?=\s*[~›$#])/i, 'a prompt'],
    [/\b(git|tail|grep|cat|ls|cd|npm)\s+(-|log\b|commit\b)/, 'a command'],
    [/(^|\s)--[a-z][a-z-]+\b/, 'a command flag'],
    [/(^|\s)\/\/\s?\S/, 'a code comment as a label'],
    [/command not found/i, 'a shell error'],
  ];
  const els = [...root.querySelectorAll('*')].filter((e) => !e.closest('svg, script, style, template, noscript') && shown(e));
  for (const e of els) {
    const text = (e.innerText || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    for (const [re, what] of COSTUME) {
      if (!re.test(text) || allowed(e, 'costume')) continue;
      const deeper = [...e.children].some((c) => re.test((c.innerText || c.textContent || '').replace(/\s+/g, ' ')));
      if (!deeper) out.push({ rule: 'costume', what, el: where(e), text: text.slice(0, 90) });
    }
    const drawnText = ['::before', '::after'].map((at) => getComputedStyle(e, at).content).filter((c) => c && c !== 'none' && c !== 'normal').map((c) => c.replace(/^["']|["']$/g, '')).join(' ');
    if (drawnText && !allowed(e, 'costume')) {
      const hit = COSTUME.find(([re]) => re.test(drawnText));
      if (hit || /^\s*(\/\/|~\/|\$\s|›)/.test(drawnText)) out.push({ rule: 'costume', what: `${hit ? hit[1] : 'a prompt or a code comment'}, drawn by the stylesheet`, el: where(e), text: drawnText.slice(0, 60) });
    }
    const chain = (t) => String(t || '').split('\n').find((line) => (line.match(/·/g) || []).length >= 2);
    const line = chain(e.innerText);
    if (line && !allowed(e, 'chain')) {
      const deeper = [...e.children].some((c) => chain(c.innerText || c.textContent));
      if (!deeper) out.push({ rule: 'chain', what: 'three or more bits on middle dots', el: where(e), text: line.replace(/\s+/g, ' ').trim().slice(0, 90) });
    }
    const t = own(e);
    if (t && /[A-Za-z]{3,}/.test(t) && /Monaspace/i.test(getComputedStyle(e).fontFamily.split(',')[0]) && !allowed(e, 'mono')) {
      out.push({ rule: 'mono', what: 'words in the code face', el: where(e), text: t.slice(0, 90) });
    }
  }
  for (const e of els) {
    const kids = [...e.children].filter(shown);
    const drawn = kids.filter((k) => /·/.test(getComputedStyle(k, '::before').content) || /·/.test(getComputedStyle(k, '::after').content));
    if (drawn.length >= 2 && !allowed(e, 'chain')) out.push({ rule: 'chain', what: 'middle dots drawn between three or more bits', el: where(e), text: (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 90) });
    const round = kids.filter((k) => { const r = k.getBoundingClientRect(); const c = getComputedStyle(k); return r.width <= 12 && r.height <= 12 && r.width >= 3 && parseFloat(c.borderTopLeftRadius) >= r.width * 0.4 && !(k.textContent || '').trim(); });
    const thin = kids.filter((k) => { const r = k.getBoundingClientRect(); return r.height <= 4 && r.width >= 4 && !(k.textContent || '').trim(); });
    const colours = new Set(thin.map((k) => getComputedStyle(k).backgroundColor));
    if ((round.length >= 5 || colours.size >= 5) && !allowed(e, 'strip')) out.push({ rule: 'strip', what: round.length >= 5 ? `${round.length} dots in a row` : `a strip of ${colours.size} colours`, el: where(e), text: '' });
  }
  return out;
};
/* eslint-enable no-undef */

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const found = new Map();
let views = 0;
for (const w of [1280, 390]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: w > 600 ? 900 : 844 }, reducedMotion: 'reduce' })).newPage();
  const look = async (screen) => {
    await page.waitForTimeout(600);
    await page.evaluate(() => document.fonts.ready);
    views += 1;
    for (const x of await page.evaluate(SCAN, { sel: 'body', allow: ALLOW })) {
      const key = `${x.rule}|${x.el}|${x.text}`;
      if (!found.has(key)) found.set(key, { ...x, screens: new Set() });
      found.get(key).screens.add(`${screen} at ${w}`);
    }
  };
  await page.goto(BASE);
  await page.waitForSelector('#site-password, #birth-year, #phone', { timeout: 90000 });
  if (await page.isVisible('#site-password')) {
    await look('the password page');
    await page.fill('#site-password', PASSWORD);
    await page.click('form button[type=submit]');
    await page.waitForSelector('#birth-year, #phone', { timeout: 90000 });
  }
  await look('welcome');
  if (await page.isVisible('#birth-year')) {
    await page.selectOption('#birth-month', '1');
    await page.selectOption('#birth-year', '1990');
    await page.click('form button[type=submit]');
    await page.waitForSelector('#phone');
  }
  await look('sign in');
  await page.fill('#phone', w > 600 ? '5555550101' : '5555550102');
  await page.click('form button[type=submit]');
  await page.waitForSelector('#code');
  await look('the code');
  await page.fill('#code', '123456');
  await page.click('form button[type=submit]');
  await page.waitForSelector('#handle');
  await look('the handle');
  await page.fill('#handle', w > 600 ? 'clean_laptop' : 'clean_phone');
  await page.check('#rules-ok');
  await page.check('#health-ok');
  await page.click('form button[type=submit]');
  await page.waitForSelector('dialog.modal h2');
  await look('onboarding, Sig');
  await page.click('dialog button:text("Show me around")');
  for (const n of ['BPC-157', 'Tirzepatide', 'Semaglutide']) {
    await page.click(`dialog .pick:has-text("${n}")`);
    await page.waitForSelector(`dialog .pick[aria-pressed=true]:has-text("${n}")`);
  }
  await look('onboarding, spaces');
  await page.click('dialog button:text("Next")');
  await page.waitForSelector('dialog .emb');
  await look('onboarding, emblems');
  await page.click('dialog button:text("Let’s go")');
  await page.waitForSelector('article.post', { timeout: 30000 });
  // a post and a member, from the feed itself
  const post = await page.getAttribute('article.post a.post-title', 'href');
  const member = await page.getAttribute('article.post .post-head a.who', 'href');
  for (const route of [...ROUTES, post, member].filter(Boolean)) {
    await page.evaluate((h) => { location.hash = h; }, route);
    await page.waitForTimeout(1700);
    await look(route);
  }
  await page.context().close();
}
await browser.close();

if (found.size) {
  console.log(`The clean check found ${found.size} thing${found.size === 1 ? '' : 's'} on ${views} views:`);
  for (const x of found.values()) console.log(`  ${x.what}: ${x.el}${x.text ? ` “${x.text}”` : ''} (${[...x.screens].slice(0, 3).join('; ')}${x.screens.size > 3 ? `, and ${x.screens.size - 3} more` : ''})`);
  process.exit(1);
}
console.log(`clean: ${views} views at two widths: no code costume, no dot chains or strips, no words in the code face`);
