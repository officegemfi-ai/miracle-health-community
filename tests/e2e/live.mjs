// After going live: miraclehealth.us works the way a visitor uses it, against the live Sig.
//   1. The Library serves what Sig reads: enclomiphene's fact sheet and the body map carry the
//      IGF-1 finding (it falls with enclomiphene, rises with HGH), and its page shows it.
//   2. Ask Sig on a laptop: the navigation is there; a question about two compounds gets an answer
//      with each agent's step; the screen shows the blood marker they push both ways, and the
//      evidence for the goal opens on it.
//   3. Ask Sig on a phone: the menu opens with the navigation; a question about one compound gets
//      an answer, the peek bar, and the screen as a sheet with the evidence.
// No errors in the page. Screenshots go to tests/e2e/out/live_*.png; with SHOTS_IN_LOG=1 a small
// copy of each is printed to the log too.
// Usage: [SITE=https://miraclehealth.us] [SHOTS_IN_LOG=1] node tests/e2e/live.mjs
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const SITE = (process.env.SITE || 'https://miraclehealth.us').replace(/\/$/, '');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}
function finish() {
  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  if (process.env.GITHUB_ACTIONS) {
    if (failed.length) failed.forEach((f) => console.log(`::error title=Live site::${f.name}${f.detail ? ` (${f.detail})` : ''}`));
    else console.log(`::notice title=Live site::All ${results.length} checks passed on ${SITE}`);
  }
  return failed.length ? 1 : 0;
}
const fresh = (path) => `${SITE}${path}${path.includes('?') ? '&' : '?'}${Date.now()}`;

// 1. The Library
try {
  const sheet = await (await fetch(fresh('/library/data/entries/enclomiphene.json'), { cache: 'no-store' })).json();
  const blob = JSON.stringify(sheet);
  check('Enclomiphene\'s fact sheet has the IGF-1 finding, with its trial', /IGF-1 falls/.test(blob) && (sheet.sources || []).some((s) => String(s.url).includes('23875626')));
  const body = await (await fetch(fresh('/library/data/body.json'), { cache: 'no-store' })).json();
  const moves = (id, dir) => (body.compounds?.[id]?.lines || []).some((l) => l.op === dir && (l.markers || []).includes('igf1'));
  check('The body map: enclomiphene lowers IGF-1, HGH raises it', moves('enclomiphene', 'down') && moves('somatropin', 'up'));
  const page = await (await fetch(fresh('/library/enclomiphene/'), { cache: 'no-store' })).text();
  check('Enclomiphene\'s page shows it', /IGF-1 falls/.test(page));
} catch (e) {
  check('The Library answers', false, String(e).slice(0, 160));
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function open(ctxOpts, name) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`script: ${String(e).slice(0, 200)}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`); });
  await page.goto(`${SITE}/ai/`, { waitUntil: 'domcontentloaded' });
  // A visitor says they're an adult once; the page remembers it on this device
  await page.evaluate(() => { try { localStorage.setItem('mh-ai-adult', 'true'); } catch {} });
  await page.reload({ waitUntil: 'networkidle' });
  return { ctx, page, errors, name };
}

async function shot(page, name, target) {
  const path = `${OUT}live_${name}.png`;
  await (target ? page.locator(target).screenshot({ path }) : page.screenshot({ path }));
  if (process.env.SHOTS_IN_LOG) {
    // In short lines: GitHub leaves very long lines out of the log
    const small = (await (target ? page.locator(target).screenshot({ type: 'jpeg', quality: 45 }) : page.screenshot({ type: 'jpeg', quality: 45 }))).toString('base64');
    const n = Math.ceil(small.length / 4000);
    for (let i = 0; i < n; i++) console.log(`SHOT live_${name} ${i + 1}/${n} ${small.slice(i * 4000, (i + 1) * 4000)}`);
  }
}

// Ask, and wait for the whole answer: the thread is busy while Sig works
async function ask(page, q) {
  await page.fill('#ai-input', q);
  await page.click('#ai-send');
  await page.waitForSelector('#ai-thread[aria-busy="true"]', { timeout: 15000 });
  const t = Date.now();
  await page.waitForSelector('#ai-thread[aria-busy="false"]', { timeout: 200000 });
  await page.waitForTimeout(2500);   // the last words are written out at reading pace
  const last = page.locator('.msg.ai').last();
  return {
    secs: Math.round((Date.now() - t) / 1000),
    text: (await last.innerText().catch(() => '')) || '',
    // each step's agent, by its key (the page has shown it as a name and as a short name)
    agents: await last.locator('.tstep').evaluateAll((els) => els.map((el) => el.dataset.agent)).catch(() => []),
  };
}

// 2. Ask Sig on a laptop
try {
  const { ctx, page, errors } = await open({ viewport: { width: 1440, height: 1000 } }, 'laptop');
  // the site's links: in the top bar, or in the side panel beside the chats on Sig's own page
  const nav = await page.locator('header .top-nav a, .sg-site a').allInnerTexts();
  check('Laptop: the navigation is there', ['Library', 'Ask Sig', 'Community', 'My Miracle'].every((x) => nav.includes(x)), nav.join(', '));
  const a = await ask(page, 'Is HGH plus enclomiphene good for fat loss?');
  check('Laptop: Sig answers about HGH and enclomiphene', a.text.length > 200 && /enclomiphene/i.test(a.text), `${a.text.length} characters in ${a.secs} s`);
  const need = ['planner', 'evidence', 'relatives', 'combination', 'markers', 'safety'];
  const missing = need.filter((x) => !a.agents.includes(x));
  check('Laptop: each agent\'s step shows', !missing.length, missing.length ? `missing ${missing.join(', ')}; got ${[...new Set(a.agents)].join(', ')}` : [...new Set(a.agents)].join(', '));
  const chips = await page.locator('.sc-chip').allInnerTexts();
  check('Laptop: the screen shows IGF-1 pushed both ways', chips.some((c) => /IGF-1: pushed both ways/.test(c)), chips.join(' | ').slice(0, 200));
  check('Laptop: the screen has the evidence for the goal', await page.locator('[data-key="chip:goal"]').count() > 0 && await page.locator('.sc-evtab').count() > 0);
  await shot(page, 'laptop', null);
  await page.click('[data-key="chip:goal"]');
  await page.waitForTimeout(800);
  const tab = await page.locator('.sc-file[aria-pressed="true"]').first().innerText().catch(() => '');
  const rungs = await page.locator('.sc-grid.sc-ladder .sc-tr').count();
  check('Laptop: the evidence opens on the screen, rung by rung', /^evidence/i.test(tab.trim()) && rungs > 0, `${tab.trim()}; ${rungs} rows`);
  await shot(page, 'laptop_evidence', '#ai-screen');
  check('Laptop: no errors in the page', !errors.length, errors.slice(0, 3).join(' / '));
  await ctx.close();
} catch (e) {
  check('Laptop: Ask Sig', false, String(e).slice(0, 200));
}

// 3. Ask Sig on a phone
try {
  const { ctx, page, errors } = await open({ ...devices['iPhone 13'] }, 'phone');
  // the menu: the side panel with the chats and the site's links on Sig's own page (or the
  // site's menu, on a page with the site's bar)
  const sidePanel = await page.locator('#tm-menu').count() > 0;
  await page.click(sidePanel ? '#tm-menu' : '.menu-btn');
  await page.waitForTimeout(400);
  check('Phone: the menu opens with the navigation', await page.locator(sidePanel ? '#sg-side a[href="/library/"]' : '#menu a[href="/library/"]').first().isVisible());
  await shot(page, 'phone_menu', null);
  if (sidePanel) await page.keyboard.press('Escape');
  else await page.click('.menu-close');
  await page.waitForTimeout(400);
  const a = await ask(page, 'Is ipamorelin good for fat loss?');
  check('Phone: Sig answers about ipamorelin', a.text.length > 200 && /ipamorelin/i.test(a.text), `${a.text.length} characters in ${a.secs} s`);
  check('Phone: the Relatives agent looked at its relatives', a.agents.includes('relatives'), [...new Set(a.agents)].join(', '));
  await shot(page, 'phone_answer', null);
  const peek = page.locator('.sc-peek');
  check('Phone: the peek bar shows', await peek.isVisible().catch(() => false));
  await peek.click();
  await page.waitForTimeout(1200);
  const opened = await page.locator('#ai-screen').isVisible();
  const sheet = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll('#ai-screen .sc-file')].map((t) => t.textContent.trim()),
    head: (document.querySelector('#ai-screen .sc-headline')?.textContent || '').trim().slice(0, 90),
  }));
  check('Phone: the screen opens as a sheet, with the evidence', opened && sheet.tabs.some((t) => /^evidence/.test(t)),
    `${opened ? 'open' : 'not open'}; tabs: ${sheet.tabs.join(', ') || 'none'}; "${sheet.head}"`);
  await shot(page, 'phone_screen', null);
  check('Phone: no errors in the page', !errors.length, errors.slice(0, 3).join(' / '));
  await ctx.close();
} catch (e) {
  check('Phone: Ask Sig', false, String(e).slice(0, 200));
}

await browser.close();
process.exit(finish());
