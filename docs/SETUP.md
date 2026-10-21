# Going live: the setup steps

Everything here is a one-time setup. Secret keys never go in chat or in the code:
they go into GitHub (Settings > Secrets and variables > Actions) or into Supabase.

## 1. GitHub
1. Create a private, empty repository (for example `miracle-health-community`: no README, .gitignore
   or license) and push this code to it. A private repository needs GitHub Pro ($4 a month) for two
   things this setup uses: the website on GitHub Pages and the `test` and `live` environments.
   A public repository works on the free plan, but anyone could read the starting watch list.
2. Settings > Pages: Source = GitHub Actions. Custom domain = `community.yourdomain.com`, then Enforce HTTPS.
3. Settings > Environments: create `test` and `live`. On each, under Deployment branches and tags,
   choose Selected branches and add `main`. Live changes only when you press "Run workflow" on
   "Promote to live". (Required reviewers on an environment work only in public repositories on
   Free, Pro and Team plans, so a private repository relies on that button instead.)
4. Secrets
   - Repository: `SUPABASE_ACCESS_TOKEN` (Supabase > Account > Access tokens)
   - Each environment: `SUPABASE_DB_PASSWORD`, `ANTHROPIC_API_KEY`, `REVIEW_SECRET` (any long random text)
5. Variables
   - Each environment: `SUPABASE_PROJECT_REF`, `MODERATION_MODEL` = `claude-haiku-5-5`,
     `APP_ORIGINS` = `https://community.yourdomain.com` (test: the same, the test app is at /test/)
   - Repository: `TEST_SUPABASE_URL`, `TEST_SUPABASE_ANON_KEY`, `LIVE_SUPABASE_URL`, `LIVE_SUPABASE_ANON_KEY`,
     `TURNSTILE_SITE_KEY`, `POSTHOG_KEY`, `SENTRY_DSN`, `CONTACT_EMAIL`, `PRIVACY_URL`, `COMMUNITY_DOMAIN`

## 2. Supabase (both projects; live on the Pro plan)
- Authentication > Sign In / Providers: Phone on (Twilio Verify: Account SID, Auth Token, Verify Service SID); Email sign-up off.
- Authentication > Attack Protection: CAPTCHA on, provider Cloudflare Turnstile, with the Turnstile secret key.
- Authentication > SMTP: Resend's SMTP settings, sender on your domain.
- Database > Extensions: turn pg_graphql OFF (the app doesn't use GraphQL) and pg_net ON.
- After the first deploy: run `scripts/setup_vault.sql` in the SQL editor.
- Live only: run `scripts/first_admin.sql`, sign up, then make yourself admin.

## 3. Namecheap (Advanced DNS)
- CNAME `community` -> `YOUR-GITHUB-USERNAME.github.io`
- Resend's SPF, DKIM and DMARC records, exactly as Resend's Domains page lists them.

## 4. PostHog and Sentry
- PostHog: project settings > turn on "Discard client IP data". Autocapture and session recording are already off in the code.
- Sentry: a Browser JavaScript project; copy its DSN into `SENTRY_DSN`.

## 5. Every change after that
Push to main: tests run, then the test project and the test app update. When test looks right:
Actions > Promote to live > Run workflow.
