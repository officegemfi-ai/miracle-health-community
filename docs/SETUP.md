# Going live: the setup steps

Everything here is a one-time setup. Secret keys never go in chat or in the code:
they go into GitHub (Settings > Secrets and variables > Actions) or into Supabase.

## 1. GitHub
1. Create an empty repository (for example `miracle-health-community`: no README, .gitignore
   or license) and push this code to it. A private repository needs GitHub Pro ($4 a month) for the
   website on GitHub Pages; a public one works on the free plan, but anyone can read the code,
   the starting watch list and the test sign-in numbers.
2. Your domain, in this order (GitHub's advice, so nobody else can claim the address):
   a. Verify the domain: your profile Settings > Pages > Add a domain > `yourdomain.com`. GitHub shows
      a TXT record; add it in Namecheap (section 3), then press Verify. Leave the record in place.
   b. The repository's Settings > Pages: Source = GitHub Actions. Custom domain =
      `community.yourdomain.com` > Save.
   c. Add the `community` CNAME in Namecheap (section 3).
   d. Back in Settings > Pages, tick Enforce HTTPS once it's offered (up to 24 hours).
   Until the community opens, the site has an "opening soon" page at the root, the test app at
   `/test/`, and a preview at `/preview/`: the same app with sample posts from made-up members,
   running entirely in the visitor's browser (the same migrations in PGlite, web/preview/). Once it
   opens, the live app is at the root and the other two come off the site. To publish by hand:
   Actions > Pages > Run workflow.
3. Secrets (repository secrets). The deploys set up everything else in the Supabase projects
   themselves: the migrations, sign-in (phone codes), the Vault secrets the AI hook reads (a review
   secret is made and kept there), the functions and their secrets. See `scripts/supabase_project.sh`,
   `.github/workflows/deploy-test.yml` and `.github/workflows/promote-live.yml`.
   - `SUPABASE_ACCESS_TOKEN` (Supabase > Account > Access tokens), `SUPABASE_DB_PASSWORD` (the test
     project's database password), `ANTHROPIC_API_KEY`
   - Texts to real phones: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`
     (Twilio Console > Verify > Services). Live needs them; on test, without them only the test
     numbers 555-555-0101 to 0104 sign in, with the code 123456.
   - `FOUNDING_INVITE`: the founder's own invite code, 6 to 40 letters and numbers. Promote to live
     makes it a one-use invite; sign up with it, run Promote to live again, and that account is
     the admin. The admin makes everyone else's invites in the app (Moderation > Invites).
   - Optional: `SITE_PASSWORD`, a password for the whole site. Visitors type it once per browser,
     before the sign-in page; without it the app can't reach Supabase at all, because the public key
     ships encrypted with it. Delete it to open the site. Either takes effect on the next deploy.
   - Optional: `LIVE_SUPABASE_DB_PASSWORD`, only if the live database ever refuses the access
     token's temporary sign-in (reset the password in Supabase and save it here).
4. Variables (all optional): `MODERATION_MODEL` (default `claude-haiku-5-5`), `PRIVACY_URL`
   (default https://miraclehealth.us/privacy), `CONTACT_EMAIL` (default hello@miraclehealth.us),
   `TURNSTILE_SITE_KEY`, `POSTHOG_KEY`, `SENTRY_DSN`.

## 2. Supabase
- The test project: create it (any name), and put its ref in `deploy/test.env`. Its deploy does the rest.
- The live project: Promote to live creates it on its first run (`miracle-health-live`, in the test
  project's organization and region) and sets it up the same way, without the test data and
  without test numbers. Supabase's free plan allows two active projects; move the organization
  to the Pro plan before the community grows (daily backups, and no pausing after a quiet week).
- Optional, both: Authentication > Attack Protection: CAPTCHA with Cloudflare Turnstile
  (`TURNSTILE_SECRET_KEY` and `TURNSTILE_SITE_KEY`).

## 3. Namecheap (Advanced DNS)
Namecheap's Host field takes only the part before your domain.
- TXT `_github-pages-challenge-officegemfi-ai` -> the value GitHub shows when you add the domain
- CNAME `community` -> `officegemfi-ai.github.io` (your GitHub username, never the repository name)
- No wildcard (`*`) records: they let others claim subdomains.

## 4. PostHog and Sentry (optional)
- PostHog: project settings > turn on "Discard client IP data". Autocapture and session recording are already off in the code.
- Sentry: a Browser JavaScript project; copy its DSN into `SENTRY_DSN`.
- Add either one to the privacy notice before turning it on.

## 5. Opening, and every change after that
- Open the community: Actions > Promote to live > Run workflow. Then sign up at the community with
  `FOUNDING_INVITE` and run Promote to live once more to become the admin.
- Every change after that: push to main; the tests run, then the test project updates and the
  test app is checked end to end. When it's right: Actions > Promote to live > Run workflow.
