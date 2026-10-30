#!/usr/bin/env bash
# Copies the design kit (shared/kit) into the community app, and into a checkout of the website
# when one is given: scripts/sync_kit.sh [path/to/miraclehealth-site]
# The website then needs rebuilding (node scripts/build_library.mjs) and publishing.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p web/kit
cp shared/kit/kit.js shared/kit/kit.css web/kit/
cp shared/kit/signalviz.js web/lib/signalviz.js
site="${1:-}"
if [ -n "$site" ]; then
  mkdir -p "$site/kit"
  cp shared/kit/kit.js shared/kit/kit.css "$site/kit/"
  cp shared/kit/signalviz.js "$site/library/signalviz.js"
  echo "kit copied to the app and to $site"
else
  echo "kit copied to the app"
fi
