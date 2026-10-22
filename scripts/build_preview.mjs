// Builds the preview's in-browser database into <out>/preview: PGlite (Postgres
// as WebAssembly), the migrations exactly as they deploy to Supabase, a small
// shim that makes Postgres look like a Supabase project, the sample community,
// and a manifest. See web/preview/engine.js for how the browser uses them.
// Needs: npm ci --prefix scripts/preview
// Usage: node scripts/build_preview.mjs <out_dir>
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const out = process.argv[2];
if (!out) { console.error('Usage: node scripts/build_preview.mjs <out_dir>'); process.exit(1); }
const root = new URL('../', import.meta.url).pathname;
const pkg = join(root, 'scripts/preview/node_modules/@electric-sql/pglite');
if (!existsSync(join(pkg, 'dist'))) { console.error('PGlite is missing. Run: npm ci --prefix scripts/preview'); process.exit(1); }
const dist = join(pkg, 'dist');
const dest = join(out, 'preview');
mkdirSync(join(dest, 'pglite/fs'), { recursive: true });
mkdirSync(join(dest, 'sql'), { recursive: true });

// The runtime: the ES modules and the three binary assets (raw and gzipped)
for (const f of readdirSync(dist)) if (/^(index|chunk-[A-Z0-9]+)\.js$/.test(f)) cpSync(join(dist, f), join(dest, 'pglite', f));
for (const f of readdirSync(join(dist, 'fs'))) if (f.endsWith('.js')) cpSync(join(dist, 'fs', f), join(dest, 'pglite/fs', f));
const assets = ['pglite.wasm', 'initdb.wasm', 'pglite.data'].map((name) => {
  const raw = readFileSync(join(dist, name));
  const gz = gzipSync(raw, { level: 9 });
  writeFileSync(join(dest, 'pglite', name), raw);
  writeFileSync(join(dest, 'pglite', `${name}.gz`), gz);
  return { name, raw: `pglite/${name}`, gz: `pglite/${name}.gz`, bytes: gz.length };
});

// The SQL, in the order it runs: shim, every migration, the sample community
const sql = [];
const add = (name, text) => { writeFileSync(join(dest, 'sql', name), text); sql.push(name); };
const shim = readFileSync(join(root, 'scripts/local_db/supabase_shim.sql'), 'utf8')
  .replace(/^create extension if not exists (pgtap|citext|pgcrypto)[^\n]*\n/gm, '');
add('000_supabase_shim.sql', shim);
for (const f of readdirSync(join(root, 'supabase/migrations')).filter((x) => x.endsWith('.sql')).sort()) {
  add(f, readFileSync(join(root, 'supabase/migrations', f), 'utf8'));
}
add('zzz_preview_seed.sql', readFileSync(join(root, 'web/preview/seed.sql'), 'utf8'));
rmSync(join(dest, 'seed.sql'), { force: true });

// The version changes whenever the database would: browsers then start fresh
const pgliteVersion = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version;
const hash = createHash('sha256').update(pgliteVersion);
sql.forEach((f) => hash.update(readFileSync(join(dest, 'sql', f))));
const version = hash.digest('hex').slice(0, 12);
writeFileSync(join(dest, 'manifest.json'), JSON.stringify({ version, pglite: pgliteVersion, sql, assets }, null, 2));
const mb = (n) => (n / 1048576).toFixed(1);
console.log(`preview database ${version}: PGlite ${pgliteVersion}, ${sql.length} SQL files, ${mb(assets.reduce((n, a) => n + a.bytes, 0))} MB to download`);
