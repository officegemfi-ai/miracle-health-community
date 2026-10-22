#!/usr/bin/env bash
# Shared files and their copies must match:
# - the rules (shared/rules.json), used by the web app and the AI reviewer
# - the Signal baseline (shared/signal_baseline.json), loaded by a generated migration
set -euo pipefail
cd "$(dirname "$0")/.."
cmp -s shared/rules.json web/rules.json || { echo "web/rules.json is out of date: run scripts/sync_rules.sh"; exit 1; }
cmp -s shared/rules.json supabase/functions/_shared/rules.json || { echo "functions copy is out of date: run scripts/sync_rules.sh"; exit 1; }
echo "rules in sync"
node scripts/build_signal_baseline_sql.mjs --check
