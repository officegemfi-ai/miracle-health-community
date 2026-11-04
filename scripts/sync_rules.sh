#!/usr/bin/env bash
# Copies the shared files to the app and the server functions: the rules, the list of uses and
# the placebo references by use
set -euo pipefail
cd "$(dirname "$0")/.."
cp shared/rules.json web/rules.json
cp shared/rules.json supabase/functions/_shared/rules.json
cp shared/uses.json web/uses.json
cp shared/uses.json supabase/functions/_shared/uses.json
cp shared/baselines.json web/baselines.json
cp shared/baselines.json supabase/functions/_shared/baselines.json
echo "rules, uses and baselines copied"
