#!/usr/bin/env bash
# Copies the shared files to the app and the AI reviewer: the rules and the list of uses
set -euo pipefail
cd "$(dirname "$0")/.."
cp shared/rules.json web/rules.json
cp shared/rules.json supabase/functions/_shared/rules.json
cp shared/uses.json web/uses.json
cp shared/uses.json supabase/functions/_shared/uses.json
echo "rules and uses copied"
