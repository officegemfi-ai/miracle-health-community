// The preview build (sample posts, no backend) behind a site password: someone
// with the password can sign up and use every screen, and the rules still apply.
// Usage: BASE_URL=... GATE_PASSWORD=... node tests/e2e/preview.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4175/';
const PASSWORD = process.env.GATE_PASSWORD;
if (!PASSWORD) { console.error('Need GATE_PASSWORD'); process.exit(1); }

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());

await page.goto(BASE);
await page.waitForSelector('#site-password');
check('The preview asks for the password first', (await page.textContent('.demo-banner')).includes('sample posts'));
await page.fill('#site-password', PASSWORD);
await page.click('form button[type=submit]');
await page.waitForSelector('#phone');

await page.fill('#phone', '5555551234');
await page.click('form button[type=submit]');
await page.waitForSelector('#code');
await page.fill('#code', '123456');
await page.click('form button[type=submit]');
await page.waitForSelector('#handle');
await page.fill('#invite', 'preview');
await page.fill('#handle', 'first_look');
await page.check('#adult');
await page.check('#rules-ok');
await page.check('#health-ok');
await page.click('form button[type=submit]');
await page.waitForSelector('h1:text("Feed")');
await page.waitForSelector('[data-post="p1"]');
check('Signing up with the preview invite opens a feed of sample posts', (await page.locator('[data-post]').count()) >= 6);

await page.goto(`${BASE}#/post/p2`);
await page.waitForSelector('h1:text("BPC-157 for tennis elbow")');
await page.click('article .votes button[aria-label=Helpful]');
await page.waitForFunction(() => document.querySelector('article .votes b')?.textContent === '22');
await page.fill('#comment', 'Same for my knee, the physio work mattered most.');
await page.click('form button[type=submit]');
await page.waitForFunction(() => document.querySelector('h2')?.textContent?.includes('(3)'));
check('Voting and commenting on a sample post work', true);

await page.goto(`${BASE}#/new`);
await page.waitForSelector('#title');
await page.selectOption('#compound', 'semaglutide');
await page.fill('#title', 'Where to buy it cheaper?');
await page.fill('#body', 'Anyone know where to buy it?');
await page.click('form button[type=submit]');
await page.waitForSelector('.err');
check('The rules still refuse a sourcing post', /rule 1/.test(await page.textContent('.err')));

await page.fill('#title', 'Week 1 on semaglutide');
await page.fill('#body', 'Less hungry from day three, a little queasy after dinner.');
await page.click('form button[type=submit]');
await page.waitForSelector('h1:text("Week 1 on semaglutide")');
check('A normal post goes up', true);

await page.goto(`${BASE}#/mod/queue`);
await page.waitForSelector('[data-queue="p9"]');
await page.waitForSelector('[data-queue="c4"]');
check('The moderation queue shows the held post and the reported comment', true);
await page.locator('[data-queue="c4"] button:text-is("Remove")').click();
await page.waitForSelector('[data-queue="c4"]', { state: 'detached' });
check('Removing the reported comment takes it out of the queue', true);

await page.goto(`${BASE}#/mod/numbers`);
await page.waitForSelector('table.metrics');
check('The beta numbers load', (await page.textContent('table.metrics')).includes('members'));

check('No script errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
