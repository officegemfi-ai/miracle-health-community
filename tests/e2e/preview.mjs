// The preview build (the real database running in the browser, with a sample
// community) behind a site password: someone with the password can sign up and
// use every screen, the game counts points the way the live database does, and
// the rules still apply.
// Usage: BASE_URL=... GATE_PASSWORD=... node tests/e2e/preview.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:4175/';
const PASSWORD = process.env.GATE_PASSWORD;
if (!PASSWORD) { console.error('Need GATE_PASSWORD'); process.exit(1); }
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}
const points = async (page) => Number((await page.textContent('#my-points')).replace(/\D/g, ''));
// The header counts up to the new total; wait until it settles
async function waitPoints(page, above, ms = 15000) {
  const t = Date.now();
  let last = -1; let same = 0;
  while (Date.now() - t < ms) {
    const now = await points(page);
    if (now > above && now === last) { same += 1; if (same >= 4) return now; } else same = 0;
    last = now;
    await page.waitForTimeout(250);
  }
  return points(page);
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// ---------------------------------------------------------------------------
await page.goto(BASE);
await page.waitForSelector('#site-password');
check('The preview asks for the password first', (await page.textContent('.demo-banner')).includes('made-up members'));
await page.fill('#site-password', PASSWORD);
await page.click('form button[type=submit]');
await page.waitForSelector('#phone', { timeout: 90000 });
check('The password opens the sign-in page, with the database running in the browser', true);

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

// Onboarding with Sig
await page.waitForSelector('dialog.modal h2:text("Hi, I’m Sig.")');
check('Sig welcomes a new member', await page.isVisible('dialog .sig'));
await page.click('dialog button:text("Show me around")');
for (const name of ['BPC-157', 'Tirzepatide', 'Semaglutide']) {
  await page.click(`dialog .pick:has-text("${name}")`);
  await page.waitForSelector(`dialog .pick[aria-pressed=true]:has-text("${name}")`);
}
check('Onboarding joins spaces', (await page.textContent('dialog .kick:has-text("joined")')).startsWith('3'));
await page.click('dialog button:text("Next")');
await page.waitForSelector('dialog h2:text("Earn your emblems.")');
check('It shows the fifteen emblems', (await page.locator('dialog .emb').count()) === 15);
await page.click('dialog button:text("Let’s go")');
await page.waitForSelector('h1:text("Your feed.")');
await page.waitForSelector('.kick:has-text("3 spaces you follow")');
await page.waitForSelector('article.post');
const homeSpaces = await page.locator('article.post .post-head .space').allTextContents();
check('Home shows only the spaces you joined', homeSpaces.length > 0 && homeSpaces.every((s) => /BPC-157|Tirzepatide|Semaglutide/.test(s)), homeSpaces.slice(0, 4).join(', '));
check('The left menu lists them, with their Signal', (await page.locator('#nav .nav-space').count()) === 3);
check('The live ticker runs across the top', (await page.locator('#tick-track .tick-i').count()) >= 50);
check('A preview member founds the community', (await page.textContent('.me-chip')).includes('0'));
await page.screenshot({ path: `${OUT}preview_01_home.png` });

// Quests and points
await page.waitForSelector('.quest button:has-text("Claim +20")');
await page.click('.quest button:has-text("Claim +20")');
const afterQuest = await waitPoints(page, 0);
check('Claiming a finished quest pays its points, plus the first-of-the-day bonus', afterQuest === 25, `${afterQuest} points`);
check('and the emblem card beside the feed shows the same total', Number((await page.textContent('[data-mecard] .pts')).replace(/\D/g, '')) === afterQuest);

// Same for me on a report
await page.goto(`${BASE}#/popular?sort=reports`);
await page.waitForSelector('article.post button.same:not([disabled])');
const sameBtn = page.locator('article.post button.same:not([disabled])').first();
const sameBefore = Number((await sameBtn.textContent()).replace(/\D/g, ''));
await sameBtn.click();
await page.waitForSelector('article.post button.same[aria-pressed=true]');
const afterSame = await waitPoints(page, afterQuest);
check('“Same for me” adds your voice and earns 5', afterSame === afterQuest + 5 && Number((await page.locator('article.post button.same[aria-pressed=true]').first().textContent()).replace(/\D/g, '')) === sameBefore + 1, `${afterSame} points`);

// A Sig sticker and a vote
const post = page.locator('article.post').nth(1);
await post.locator('button:has-text("React")').click();
await page.click('.pop button:has-text("Support")');
await page.waitForTimeout(400);
check('A Sig sticker lands on the post', (await post.locator('.stk-count.mine').count()) === 1);
const upBtn = post.locator('.vrail button.up');
const scoreBefore = Number(await post.locator('.vrail b').textContent());
await upBtn.click();
await page.waitForFunction((n) => Number(document.querySelectorAll('article.post')[1].querySelector('.vrail b').textContent) === n + 1, scoreBefore);
check('Votes count', true);

// A report: Miracle AI reads it, the Signal moves, the author is told. SS-31 has
// no reports here yet, so a first one has to move its number.
const ssBefore = await page.evaluate(() => Number(document.querySelector('#tick-track [data-sig-of="ss31"]')?.textContent));
await page.goto(`${BASE}#/new?c=ss31`);
await page.waitForSelector('#title');
await page.fill('#title', 'Six weeks on SS-31: more stamina on long rides');
await page.fill('#body', 'Took it for 6 weeks through a clinic. I can ride longer before my legs give out. Compared with before I started: better.');
await page.click('form button[type=submit]:text("Post")');
await page.waitForSelector('h1.post-title:text("Six weeks on SS-31")');
check('The new report opens, and Miracle AI starts reading', await page.isVisible('.airead:has-text("Miracle AI is reading")'));
await page.waitForSelector('.airead:has-text("Better")', { timeout: 30000 });
check('Miracle AI reads it as better, for 6 weeks, and it feeds the SS-31 Signal', /6 weeks/.test(await page.textContent('.airead')) && /SS-31 Signal/.test(await page.textContent('.airead')));
await page.waitForSelector('.sigsay.in:has-text("Miracle AI read your report")', { timeout: 15000 });
check('Sig tells the author how the report moved the Signal', /moved the SS-31 Signal [\d.]+ → [\d.]+/.test(await page.textContent('.sigsay')), (await page.textContent('.sigsay')).slice(0, 90));
await page.waitForFunction((before) => Number(document.querySelector('#tick-track [data-sig-of="ss31"]')?.textContent) !== before, ssBefore, { timeout: 10000 });
const ssAfter = await page.evaluate(() => Number(document.querySelector('#tick-track [data-sig-of="ss31"]')?.textContent));
check('The SS-31 number in the live ticker moved by itself', ssAfter > ssBefore, `${ssBefore} → ${ssAfter}`);
const afterReport = await waitPoints(page, afterSame + 40);
check('Posting and a counted report earn 5 and 40', afterReport === afterSame + 45, `${afterReport} points`);
await page.waitForSelector('dialog .celebrate h2:text("You reached Pulse.")', { timeout: 10000 });
check('Passing 60 points celebrates the second emblem, Pulse', await page.isVisible('dialog .celebrate .emb'));
await page.screenshot({ path: `${OUT}preview_02_level_up.png` });
await page.click('dialog button:text("Keep going")');
await page.waitForSelector('dialog.modal', { state: 'detached' });
await page.screenshot({ path: `${OUT}preview_02_report.png` });

// The author checks the read
await page.click('.airead button:text("Better")');
await page.waitForSelector('.airead .kick:text("Confirmed by the author")');
check('Confirming Miracle AI’s read earns 10', (await waitPoints(page, afterReport)) === afterReport + 10);

// A thread
await page.fill('#comment', 'Update at week 5: still better on stairs.');
await page.click('form.composer button:text("Comment")');
await page.waitForSelector('.cm:has-text("Update at week 5")');
await page.click('.cm:has-text("Update at week 5") button:has-text("Reply")');
await page.fill('.reply-box textarea', 'And no swelling after a long walk.');
await page.click('.reply-box button:text("Reply")');
await page.waitForSelector('.cm-kids .cm:has-text("no swelling")');
check('Replies nest under the comment they answer', true);

// The rules still apply
await page.goto(`${BASE}#/new`);
await page.waitForSelector('#title');
await page.selectOption('#compound', 'semaglutide');
await page.fill('#title', 'Where to buy sema cheap?');
await page.fill('#body', 'Anyone know where to buy it?');
await page.click('form button[type=submit]:text("Post")');
await page.waitForSelector('.msg.err');
check('Asking where to buy is refused with the rule', /rule 1/.test(await page.textContent('.msg.err')));

// The Signal, profiles, the leaderboard, notifications, moderation
await page.goto(`${BASE}#/signal`);
await page.waitForSelector('.sig-row');
check('The Signal page ranks every compound', (await page.locator('.sig-row').count()) >= 50);
check('and lists the live moves with their causes', (await page.locator('.move-i').count()) >= 3);
await page.goto(`${BASE}#/u/first_look`);
await page.waitForSelector('h1:text("u/first_look")');
check('Your profile shows your emblem and badges', (await page.locator('.bdg:not(.locked)').count()) >= 2, `${await page.locator('.bdg:not(.locked)').count()} badges`);
await page.click('.space-tabs a:text("Your points")');
await page.waitForSelector('.ledger div');
check('and every line of your points', (await page.locator('.ledger div').count()) >= 6);
await page.goto(`${BASE}#/builders`);
await page.waitForSelector('.lb-row, .pod');
check('Signal Builders ranks this month', (await page.locator('.lb-row, .pod').count()) >= 10);
await page.click('#bell');
await page.waitForSelector('.notif-pop .notif');
check('Notifications open from the bell', (await page.locator('.notif-pop .notif').count()) >= 2);
await page.keyboard.press('Escape');
await page.goto(`${BASE}#/mod/queue`);
await page.waitForSelector('[data-queue]');
check('The preview member can see the moderation queue', (await page.locator('[data-queue]').count()) >= 2);
await page.screenshot({ path: `${OUT}preview_03_mod.png` });

// On a phone: the tab bar and the menu drawer
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}#/home`);
await page.waitForSelector('#tabbar a');
check('On a phone, a tab bar sits at the bottom', await page.isVisible('#tabbar a:has-text("Signal")'));
await page.click('#burger');
await page.waitForSelector('body.drawer #nav .nav-i:has-text("Quests")');
check('and the full menu opens as a drawer (it is never removed)', await page.isVisible('#nav .nav-i:has-text("Explore spaces")'));
await page.screenshot({ path: `${OUT}preview_04_phone.png` });

check('No script errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
