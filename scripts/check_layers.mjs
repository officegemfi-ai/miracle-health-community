// Checks the community app's layers (docs/web-architecture.md), so the structure can't drift:
// - each layer imports only from itself and the layers inside it:
//     core/ ← data/ ← app/ ← ui/ ← app.js     (kit/, the shared design kit, from data/ and ui/)
// - only data/ reaches Supabase, the network or the browser's storage
// - core/ and app/ never touch the page
// - no two modules import each other, directly or round a loop
// Usage: node scripts/check_layers.mjs [web dir]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const web = resolve(process.argv[2] || new URL('../web', import.meta.url).pathname);
const LAYERS = ['core', 'data', 'app', 'ui', 'kit'];
// What each layer may import, besides itself
const MAY = { core: [], data: ['core', 'kit'], app: ['core', 'data'], ui: ['core', 'data', 'app', 'kit'], kit: [], root: LAYERS };

const files = [];
const walk = (d) => readdirSync(d).sort().forEach((f) => {
  const p = join(d, f);
  if (statSync(p).isDirectory()) { if (LAYERS.includes(relative(web, p).split('/')[0])) walk(p); } else if (f.endsWith('.js')) files.push(p);
});
LAYERS.forEach((l) => { try { walk(join(web, l)); } catch (_) { /* a layer with no folder yet */ } });
files.push(join(web, 'app.js'));

const layerOf = (p) => { const top = relative(web, p).split('/')[0]; return LAYERS.includes(top) ? top : 'root'; };
// Code without its comments and strings' contents, for the content rules
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const problems = [];
const graph = new Map();
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const me = layerOf(f);
  const deps = [];
  for (const m of text.matchAll(/(?:import|export)\s[^'"]*?from\s+'([^']+)'|import\(\s*'([^']+)'\s*\)/g)) {
    const spec = m[1] || m[2];
    if (!spec.startsWith('.')) continue;
    const target = resolve(dirname(f), spec);
    deps.push(target);
    const them = layerOf(target);
    if (them !== me && !MAY[me].includes(them)) problems.push(`${relative(web, f)} (${me}) imports ${relative(web, target)} (${them})`);
  }
  graph.set(f, deps);
  const body = code(text);
  const rule = (re, what) => { if (re.test(body)) problems.push(`${relative(web, f)} (${me}) ${what}`); };
  if (me !== 'data') {
    rule(/\bsb\./, 'talks to Supabase (only data/ may)');
    rule(/\bwindow\.supabase\b/, 'makes a Supabase client (only data/ may)');
    rule(/\bfetch\(/, 'fetches (only data/ may)');
    rule(/\b(?:localStorage|sessionStorage)\b/, 'uses the browser\'s storage (only data/ may)');
  }
  if (me === 'core' || me === 'app') {
    rule(/(?<![.\w$])(?:document|window|navigator)\b|(?<![.\w$])(?:location|history)\./, 'touches the page (core/ and app/ may not)');
    rule(/\bh\(/, 'builds elements (core/ and app/ may not)');
  }
}

// Loops: a module that, through its imports, comes back to itself
const state = new Map();
const stack = [];
const loops = new Set();
const visit = (f) => {
  state.set(f, 1); stack.push(f);
  for (const d of graph.get(f) || []) {
    if (!graph.has(d)) continue;
    if (state.get(d) === 1) loops.add(stack.slice(stack.indexOf(d)).concat(d).map((p) => relative(web, p)).join(' → '));
    else if (!state.get(d)) visit(d);
  }
  stack.pop(); state.set(f, 2);
};
files.forEach((f) => { if (!state.get(f)) visit(f); });
loops.forEach((l) => problems.push(`import loop: ${l}`));

const count = Object.fromEntries([...LAYERS, 'root'].map((l) => [l, files.filter((f) => layerOf(f) === l).length]));
if (problems.length) {
  console.log(`The app's layers are broken in ${problems.length} place${problems.length === 1 ? '' : 's'}:`);
  problems.forEach((p) => console.log(`  ${p}`));
  process.exit(1);
}
console.log(`The app's layers hold: ${files.length} modules (core ${count.core}, data ${count.data}, app ${count.app}, ui ${count.ui}, kit ${count.kit}), no import loops.`);
