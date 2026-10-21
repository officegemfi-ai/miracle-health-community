#!/usr/bin/env bash
# In GitHub Actions, turns the end of a step's log into an error note on the run's
# summary page, so a failure can be read there without opening the full log.
# GitHub keeps only the first 4 KB of a note, so progress bars are dropped and
# only the last part of the log is kept.
# Usage: scripts/ci_annotate.sh "<title>" <log file> [lines]
set -uo pipefail
[ -n "${GITHUB_ACTIONS:-}" ] || exit 0
python3 - "$1" "$2" "${3:-60}" <<'PY'
import re, sys
title, path, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
try:
    text = open(path, encoding='utf-8', errors='replace').read()
except OSError:
    text = ''
text = re.sub(r'\x1b\[[0-9;?]*[A-Za-z]', '', text)
lines = [l for l in text.splitlines()
         if '■' not in l and not re.match(r'^\|\s*\|?\s*\d+% of', l)]
msg = '\n'.join(lines[-n:]).strip() or '(the step printed nothing)'
raw = msg.encode('utf-8')
if len(raw) > 3500:
    msg = '...' + raw[-3500:].decode('utf-8', errors='ignore')
esc = msg.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
print(f'::error title={title}::{esc}')
PY
