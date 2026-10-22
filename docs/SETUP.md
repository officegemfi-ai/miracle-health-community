# Going live: the setup steps

Everything here is a one-time setup. Secret keys never go in chat or in the code:
they go into GitHub (Settings > Secrets and variables > Actions) or into Supabase.

## 1. GitHub
1. Create a private, empty repository (for example `miracle-health-community`: no README, .gitignore
   or license) and push this code to it. A private repository needs GitHub Pro ($4 a month) for two
   things this setup uses: the website on GitHub Pages and the `test` and `live` environments.
   A public repository works on the free plan, but anyone could read the starting watch list.
2. Your domain, in this order (GitHub's advice, so nobody else can claim the address):
   a. Verify the domain: your profile Settings > Pages > Add a domain > `yourdomain.com`. GitHub shows
      a TXT record; add it in Namecheap (section 3), then press Verify. Leave the record in place.
   b. The repository's Settings > Pages: Source = GitHub Actions. Custom domain =
      `community.yourdomain.com` > Save.
   c. Add the `community` CNAME in Namecheap (section 3).
   d. Back in Settings > Pages, tick Enforce HTTPS once it's offered (up to 24 hours).
   The live app is then at `https://community.yourdomain.com`, the test app at `/test/`, and a
   preview at `/preview/`: the same app with sample posts from made-up members, running entirely in
   the visitor's browser (the same migrations in PGlite, web/preview/), behind the site password.
   Until the test project is connected, `/test/` shows that preview too. To publish by hand:
   Actions > Pages > Run workflow.
3. Settings > Environments: create `test` and `live`. On each, under Deployment branches and tags,
   choose Selected branches and add `main`. Live changes only when you press "Run workflow" on
   "Promote to live". (Required reviewers on an environment work only in public repositories on
   Free, Pro and Team plans, so a private repository relies on that button instead.)
4. Secrets. The test project needs only three repository secrets, plus its project ref in
   `deploy/test.env` (the ref isn't secret: it's in the project's address). The deploy then sets up
   everything else in the project itself: the migrations, the test invites and moderator, sign-in
   (phone codes; test numbers 555-555-0101 to 0104 with code 123456 until Twilio is added), the
   Vault secrets the AI hook reads (a review secret is made and kept there), the functions and
   their secrets. See `scripts/supabase_project.sh` and `.github/workflows/deploy-test.yml`.
   - Repository: `SUPABASE_ACCESS_TOKEN` (Supabase > Account > Access tokens),
     `SUPABASE_DB_PASSWORD` (the test project's database password), `ANTHROPIC_API_KEY`
   - Repository, for texts to real phones on test: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
     `TWILIO_VERIFY_SERVICE_SID`
   - Repository, optional: `SITE_PASSWORD`, a password for the whole site during the beta. Visitors
     type it once per browser, before the sign-in page. Without it the app can't reach Supabase at
     all, because the public key ships encrypted with it. Change it to lock everyone out again;
     delete it to open the site. Either takes effect on the next deploy.
   - The `live` environment, later: `SUPABASE_DB_PASSWORD`, `ANTHROPIC_API_KEY`, `REVIEW_SECRET` (any long
     random text); environment secrets take the place of the repository ones there
5. Variables
   - Each environment: `SUPABASE_PROJECT_REF`, `MODERATION_MODEL` = `claude-haiku-5-5`,
     `APP_ORIGINS` = `https://community.yourdomain.com` (test: the same, the test app is at /test/)
   - Repository: `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `LIVE_SUPABASE_URL`, `LIVE_SUPABASE_ANON_KEY`,
     `TURNSTILE_SITE_KEY`, `POSTHOG_KEY`, `SENTRY_DSN`, `CONTACT_EMAIL`, `PRIVACY_URL`

## 2. Supabase (live on the Pro plan; the test project's settings are made by its deploy)
- Authentication > Sign In / Providers: Phone on (Twilio Verify: Account SID, Auth Token, Verify Service SID); Email sign-up off.
- Authentication > Attack Protection: CAPTCHA on, provider Cloudflare Turnstile, with the Turnstile secret key.
- Authentication > SMTP: Resend's SMTP settings, sender on your domain.
- Database > Extensions: turn pg_graphql OFF (the app doesn't use GraphQL) and pg_net ON.
- After the first deploy: run `scripts/setup_vault.sql` in the SQL editor.
- Live only: run `scripts/first_admin.sql`. It shows a random founding invite code: sign up with it,
  then make yourself admin with the line at the bottom of that file.

## 3. Namecheap (Advanced DNS)
Namecheap's Host field takes only the part before your domain.
- TXT `_github-pages-challenge-officegemfi-ai` -> the value GitHub shows when you add the domain
- CNAME `community` -> `officegemfi-ai.github.io` (your GitHub username, never the repository name)
- No wildcard (`*`) records: they let others claim subdomains.
- Resend's SPF, DKIM and DMARC records, exactly as Resend's Domains page lists them.

## 4. PostHog and Sentry
- PostHog: project settings > turn on "Discard client IP data". Autocapture and session recording are already off in the code.
- Sentry: a Browser JavaScript project; copy its DSN into `SENTRY_DSN`.

## 5. Every change after that
Push to main: tests run, then the test project and the test app update. When test looks right:
Actions > Promote to live > Run workflow.
