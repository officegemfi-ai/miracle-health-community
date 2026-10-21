# Miracle Health Community

The backend and web app for the Miracle Health community beta: phone sign-in with an
invite, posts, comments, votes, reports and moderation, built on Supabase.

## What's where
- `supabase/migrations/`: the database (tables, access rules, the checks on every post, moderation)
- `supabase/tests/database/`: 131 access tests (pgTAP)
- `supabase/functions/`: `review-content` (Claude's first read) and `delete-account`
- `web/`: the app (plain HTML, CSS and JavaScript; no build step)
- `shared/rules.json`: the community rules, copied to the app and the AI reviewer by `scripts/sync_rules.sh`
- `tests/e2e/`: a real-browser test of the whole flow, and a scripted spam attack
- `.github/workflows/`: tests on every change, deploy to test, promote to live
- `docs/SETUP.md`: the one-time setup; `docs/evidence/`: test results and the forum research

## Run it on your machine (no Docker needed)
```
scripts/local_db.sh up      # Postgres 16, set up like a Supabase project
scripts/local_db.sh reset   # rebuild from the migrations and seed data
scripts/local_db.sh test    # the access tests
scripts/local_db.sh lint    # Supabase's security lints
scripts/local_api.sh start  # a stand-in for Supabase's API, serving the app
```
Open http://127.0.0.1:54321, sign in with any phone number and the code 123456,
and join with the invite code BETATEST01. The moderator account is 555-555-0101.

Then: `node tests/e2e/flow.mjs` (browser test) and `node tests/e2e/attack_sim.mjs` (attack).

## Adding to the database later
Write a new file in `supabase/migrations/`. Supabase grants every new table to signed-in
and signed-out users by default, so each new table needs `alter table ... enable row level
security`, policies, and the same `revoke` and `grant` pattern as the foundation migration.
Add tests for it before it ships.
