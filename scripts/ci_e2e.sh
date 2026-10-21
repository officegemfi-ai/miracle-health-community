#!/usr/bin/env bash
# CI only: builds the app against the local Supabase that `supabase start` brought up,
# serves it, and runs the browser test. Each stage prints a marker, so if something
# stalls, the end of the log shows where.
set -euo pipefail
cd "$(dirname "$0")/.."
step() { echo "== $(date -u +%H:%M:%S) $*"; }

step "reading the local Supabase settings"
eval "$(supabase status -o env)"
export SUPABASE_URL="$API_URL" SUPABASE_ANON_KEY="$ANON_KEY" ENVIRONMENT=ci

step "building the app"
scripts/build_web.sh _site_ci

step "installing the test tools"
npm ci --prefix tests/e2e --no-audit --no-fund --loglevel=error
install_log="${RUNNER_TEMP:-/tmp}/playwright-install.log"
timeout 600 npx --prefix tests/e2e playwright install --with-deps chromium >"$install_log" 2>&1 \
  || { echo "Playwright install failed:"; grep -v $'■' "$install_log" | tail -n 20; exit 1; }

step "serving the app on port 4173"
# Fully detached from this script's output, or the log pipe would never close
(cd _site_ci && exec python3 -m http.server 4173) </dev/null >/dev/null 2>&1 &
for _ in $(seq 1 20); do
  curl -fsS -o /dev/null http://127.0.0.1:4173/ && break
  sleep 0.5
done

step "running the browser test"
BASE_URL=http://127.0.0.1:4173/ \
DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  timeout 600 node tests/e2e/flow.mjs

step "building and serving a copy behind a site password on port 4174"
SITE_PASSWORD=ci-gate-password scripts/build_web.sh _site_gate
(cd _site_gate && exec python3 -m http.server 4174) </dev/null >/dev/null 2>&1 &
for _ in $(seq 1 20); do
  curl -fsS -o /dev/null http://127.0.0.1:4174/ && break
  sleep 0.5
done

step "running the site-password test"
BASE_URL=http://127.0.0.1:4174/ GATE_PASSWORD=ci-gate-password ANON_KEY="$SUPABASE_ANON_KEY" \
  timeout 300 node tests/e2e/gate.mjs
step "done"
