#!/usr/bin/env bash
# The rules live in shared/rules.json; the web app and the AI reviewer use copies.
set -euo pipefail
cmp -s shared/rules.json web/rules.json || { echo "web/rules.json is out of date: run scripts/sync_rules.sh"; exit 1; }
cmp -s shared/rules.json supabase/functions/_shared/rules.json || { echo "functions copy is out of date: run scripts/sync_rules.sh"; exit 1; }
echo "rules in sync"
