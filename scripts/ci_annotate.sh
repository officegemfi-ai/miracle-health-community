#!/usr/bin/env bash
# In GitHub Actions, turns the end of a step's log into an error note on the run's
# summary page, so a failure can be read there without opening the full log.
# Usage: scripts/ci_annotate.sh "<title>" <log file> [lines]
set -uo pipefail
title="$1"; file="$2"; lines="${3:-60}"
[ -n "${GITHUB_ACTIONS:-}" ] || exit 0
if [ ! -s "$file" ]; then
  echo "::error title=$title::(the step printed nothing)"
  exit 0
fi
msg=$(tail -n "$lines" "$file" \
  | sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g' \
  | sed -e 's/%/%25/g' -e 's/\r/%0D/g' \
  | awk 'BEGIN { ORS = "%0A" } { print }')
echo "::error title=$title::$msg"
