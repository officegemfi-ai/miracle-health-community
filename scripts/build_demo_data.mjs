// Preview builds only: copies the compound list, the starting watch list and the
// allowed link sites out of the reference migration into demo-data.json, so the
// preview uses exactly the same lists as the real database.
// Usage: node scripts/build_demo_data.mjs <out_dir>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2];
if (!out) { console.error('Need an output folder'); process.exit(1); }
const sql = readFileSync(new URL('../supabase/migrations/20261021000200_reference_data.sql', import.meta.url), 'utf8');

function section(table) {
  const start = sql.indexOf(`insert into public.${table}`);
  if (start < 0) throw new Error(`no insert into ${table}`);
  const end = sql.indexOf(';', start);
  return sql.slice(start, end);
}
// Rows like ('a', 'b', 'c'), with '' as an escaped quote
function tuples(text) {
  const rows = [];
  const re = /\(\s*('(?:[^']|'')*'(?:\s*,\s*'(?:[^']|'')*')*)\s*\)/g;
  let m;
  while ((m = re.exec(text))) {
    rows.push([...m[1].matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1].replace(/''/g, "'")));
  }
  return rows;
}

const compounds = tuples(section('compounds')).map(([id, name, category]) => ({ id, name, category }));
const watch = tuples(section('watch_terms')).map(([term, action, reason], i) => ({ id: i + 1, term, action, reason }));
const domains = tuples(section('link_domains')).map(([domain]) => domain);
if (compounds.length < 10 || watch.length < 10 || domains.length < 5) {
  console.error(`Unexpected reference data: ${compounds.length} compounds, ${watch.length} terms, ${domains.length} domains`);
  process.exit(1);
}
writeFileSync(join(out, 'demo-data.json'), JSON.stringify({ compounds, watch_terms: watch, link_domains: domains }));
console.log(`wrote demo-data.json: ${compounds.length} compounds, ${watch.length} watched terms, ${domains.length} link sites`);
