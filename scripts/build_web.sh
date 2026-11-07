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
cp shared/baselines.json "$out/baselines.json"
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
// The page asks for every module and the three lists the app reads first before its scripts, so
// they download beside Supabase's. Left to the imports, a phone found them one round trip at a
// time: app.js, then what it imports, then what those import, and only then the lists.
const early = ['app.js', ...mods.filter((f) => f !== 'app.js'), 'kit/kit.js'].map((f) => `<link rel="modulepreload" href="${f}?v=${v}">`)
  .concat(['rules.json', 'uses.json', 'baselines.json'].map((f) => `<link rel="preload" href="${f}" as="fetch" crossorigin>`));
edit('index.html', (s) => {
  const tag = `<script src="config.js?v=${v}"></script>`;
  if (!s.includes(tag)) throw new Error('index.html no longer loads config.js the way the build expects');
  return s.replace(tag, `${early.join('\n')}\n${tag}`);
});
console.log(`versioned the app's files as ${v}`);
JS
