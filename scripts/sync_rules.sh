#!/usr/bin/env bash
set -euo pipefail
cp shared/rules.json web/rules.json
cp shared/rules.json supabase/functions/_shared/rules.json
echo "rules copied"
