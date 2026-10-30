#!/usr/bin/env bash
# The design kit (shared/kit) and its copies must match: the community app's (web/kit and
# web/lib/signalviz.js) and the website's (kit/ and library/signalviz.js in
# officegemfi-ai/miraclehealth-site, as published on its main branch). So the two can't drift.
set -euo pipefail
cd "$(dirname "$0")/.."
status=0
same() { cmp -s "$1" "$2" || { echo "$2 differs from $1: run scripts/sync_kit.sh"; status=1; }; }
same shared/kit/kit.js web/kit/kit.js
same shared/kit/kit.css web/kit/kit.css
same shared/kit/signalviz.js web/lib/signalviz.js
# The app's top bar is written into web/index.html (so it's there before any script runs): it
# must be exactly what the kit draws
node --input-type=module -e "
import { barHtml } from './shared/kit/kit.js';
import fs from 'node:fs';
const want = barHtml('community', { community: '', cls: 'family' });
if (!fs.readFileSync('web/index.html', 'utf8').includes(want)) { console.log('web/index.html: the bar of the four places isn’t what the kit draws:\n  ' + want); process.exit(1); }
" || status=1
if [ "${SKIP_SITE_KIT:-}" != "1" ]; then
  api="https://api.github.com/repos/officegemfi-ai/miraclehealth-site/contents"
  auth=()
  if [ -n "${GITHUB_TOKEN:-}" ]; then auth=(-H "Authorization: Bearer $GITHUB_TOKEN"); fi
  tmp=$(mktemp -d)
  for pair in kit/kit.js:shared/kit/kit.js kit/kit.css:shared/kit/kit.css library/signalviz.js:shared/kit/signalviz.js; do
    remote="${pair%%:*}"; src="${pair##*:}"
    if curl -fsSL "${auth[@]}" -H "Accept: application/vnd.github.raw" "$api/$remote?ref=main" -o "$tmp/copy"; then
      cmp -s "$src" "$tmp/copy" || { echo "the website's $remote differs from $src: run scripts/sync_kit.sh path/to/miraclehealth-site, rebuild and publish the website"; status=1; }
    else
      echo "couldn't read the website's $remote"; status=1
    fi
  done
  rm -rf "$tmp"
fi
if [ "$status" = 0 ]; then echo "the kit and its copies match"; fi
exit "$status"
