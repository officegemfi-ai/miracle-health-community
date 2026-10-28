#!/usr/bin/env bash
# Shared files and their copies must match:
# - the rules (shared/rules.json), used by the web app and the AI reviewer
# - the uses (shared/uses.json), used by the web app and the AI reviewer, and seeded in the
#   database by 20261029000200_signal_by_use.sql
# - the Signal baseline (shared/signal_baseline.json), loaded by a generated migration
set -euo pipefail
cd "$(dirname "$0")/.."
for f in rules uses; do
  cmp -s "shared/$f.json" "web/$f.json" || { echo "web/$f.json is out of date: run scripts/sync_rules.sh"; exit 1; }
  cmp -s "shared/$f.json" "supabase/functions/_shared/$f.json" || { echo "functions copy of $f.json is out of date: run scripts/sync_rules.sh"; exit 1; }
done
node -e '
const fs = require("fs");
const uses = JSON.parse(fs.readFileSync("shared/uses.json", "utf8")).uses;
const sql = fs.readFileSync("supabase/migrations/20261029000200_signal_by_use.sql", "utf8");
const seeded = [...sql.matchAll(/^\s+\(\x27([a-z_]+)\x27, \x27([^\x27]+)\x27, \x27([a-z]+)\x27, (\d+)\)[,;]$/gm)].map((m) => m.slice(1, 4).join("|"));
const want = uses.map((u) => [u.id, u.label, u.goal].join("|"));
if (seeded.join("\n") !== want.join("\n")) {
  console.error("shared/uses.json and the uses the database seeds differ:\n  database: " + seeded.join(", ") + "\n  shared:   " + want.join(", "));
  process.exit(1);
}
'
echo "rules and uses in sync"
node scripts/build_signal_baseline_sql.mjs --check
