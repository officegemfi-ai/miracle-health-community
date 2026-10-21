// The site password: without it the app can't reach the community; with it,
// sign-in works, and the browser stays unlocked after a reload.
// Run against a build made with SITE_PASSWORD set (see scripts/ci_e2e.sh).
// Usage: BASE_URL=... GATE_PASSWORD=... ANON_KEY=... node tests/e2e/gate.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4174/';
const PASSWORD = process.env.GATE_PASSWORD;
const ANON_KEY = process.env.ANON_KEY || '';
if (!PASSWORD) { console.error('Need GATE_PASSWORD'); process.exit(1); }

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

const config = await fetch(`${BASE}config.js`).then((r) => r.text());
check('The published settings carry the key only in encrypted form',
  config.includes('"gate"') && (!ANON_KEY || !config.includes(ANON_KEY)));

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
const page = await (await browser.newContext()).newPage();
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE);
await page.waitForSelector('#site-password');
check('Visitors see the password screen first', !(await page.isVisible('#phone')));

await page.goto(`${BASE}#/rules`);
await page.waitForTimeout(300);
check('A link deeper into the site still shows the password screen', await page.isVisible('#site-password'));

await page.fill('#site-password', 'not-the-password');
await page.click('form button[type=submit]');
await page.waitForSelector('.err');
check('A wrong password is refused', (await page.textContent('.err')).includes('isn’t right') && !(await page.isVisible('#phone')));

await page.fill('#site-password', PASSWORD);
await page.click('form button[type=submit]');
await page.waitForSelector('#phone, h1:text("Community rules")');
check('The right password opens the site', !(await page.isVisible('#site-password')));

await page.goto(BASE);
await page.reload();
await page.waitForSelector('#phone');
check('The browser stays unlocked after a reload', !(await page.isVisible('#site-password')));

// The unlocked key really reaches the community: a new phone gets through to sign-up
await page.fill('#phone', '5555550104');
await page.click('form button[type=submit]');
await page.waitForSelector('#code');
await page.fill('#code', '123456');
await page.click('form button[type=submit]');
await page.waitForSelector('#handle');
check('Signing in works through the password screen', true);

check('No script errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
