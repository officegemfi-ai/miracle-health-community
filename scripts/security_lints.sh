#!/usr/bin/env bash
# Runs Supabase's own database linter (splinter, the checks behind the dashboard's
# Security Advisor) and fails if any SECURITY lint fires.
# Usage: scripts/security_lints.sh <postgres-url> [path/to/splinter.sql]
set -euo pipefail
DB="$1"
SPLINTER="${2:-}"
SPLINTER_COMMIT=fccca4b1c4d8b48b8ccd69bd6b30e84adcb92975
if [ -z "$SPLINTER" ]; then
  tmp=$(mktemp -d)
  git clone --quiet https://github.com/supabase/splinter "$tmp/splinter"
  git -C "$tmp/splinter" checkout --quiet "$SPLINTER_COMMIT"
  SPLINTER="$tmp/splinter/splinter.sql"
fi
out=$(mktemp)
{ echo 'begin;'; cat "$SPLINTER"; echo ';'; echo 'rollback;'; } | psql "$DB" --csv -q -v ON_ERROR_STOP=1 > "$out"
python3 - "$out" <<'PY'
import csv, sys
rows = [r for r in csv.DictReader(open(sys.argv[1])) if r.get('name')]
sec = [r for r in rows if 'SECURITY' in (r.get('categories') or '')]
other = [r for r in rows if r not in sec]
print(f"Security lints: {len(sec)}   Other lints (performance): {len(other)}")
for r in sec:
    print(f"  SECURITY {r['level']}: {r['name']}: {r['detail']}")
for r in other:
    print(f"  {r['level']}: {r['name']}: {r['detail'][:140]}")
sys.exit(1 if sec else 0)
PY
