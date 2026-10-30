#!/usr/bin/env bash
# Builds the web app for one environment into a folder.
# Usage: scripts/build_web.sh <out_dir>   (settings come from environment variables;
# see scripts/write_config.mjs)
set -euo pipefail
out="$1"
mkdir -p "$out"
cp -R web/. "$out/"
cp shared/rules.json "$out/rules.json"
cp shared/uses.json "$out/uses.json"
node scripts/write_config.mjs "$out"
if [ "${DEMO:-}" = "1" ]; then node scripts/build_preview.mjs "$out"; fi

# Every build asks for its own versions of the stylesheet, the settings and the app's modules, so
# a browser or GitHub Pages' 10-minute cache never mixes an old file with a new one after a deploy.
# All relative imports in app.js and lib/ get the same version, so each module still loads once.
node - "$out" <<'JS'
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const out = process.argv[2];
const mods = ['app.js', ...fs.readdirSync(path.join(out, 'lib')).filter((f) => f.endsWith('.js')).map((f) => `lib/${f}`)];
const v = crypto.createHash('sha256').update(['styles.css', 'kit/kit.css', 'kit/kit.js', 'config.js', ...mods].map((f) => fs.readFileSync(path.join(out, f))).join('\n')).digest('hex').slice(0, 10);
const edit = (f, fn) => { const p = path.join(out, f); fs.writeFileSync(p, fn(fs.readFileSync(p, 'utf8'))); };
edit('index.html', (s) => s.replace('href="kit/kit.css"', `href="kit/kit.css?v=${v}"`).replace('href="styles.css"', `href="styles.css?v=${v}"`).replace('src="config.js"', `src="config.js?v=${v}"`).replace('src="app.js"', `src="app.js?v=${v}"`));
for (const f of [...mods, 'kit/kit.js']) edit(f, (s) => s.replace(/(from '\.{1,2}\/[^'?]+\.js)'/g, `$1?v=${v}'`).replace(/(import\('\.{1,2}\/[^'?]+\.js)'\)/g, `$1?v=${v}')`));
console.log(`versioned the app's files as ${v}`);
JS
