#!/usr/bin/env bash
# Builds the web app for one environment into a folder.
# Usage: scripts/build_web.sh <out_dir>   (settings come from environment variables;
# see scripts/write_config.mjs)
set -euo pipefail
out="$1"
mkdir -p "$out"
cp -R web/. "$out/"
cp shared/rules.json "$out/rules.json"
node scripts/write_config.mjs "$out"
if [ "${DEMO:-}" = "1" ]; then node scripts/build_demo_data.mjs "$out"; fi
