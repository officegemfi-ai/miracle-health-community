// Builds the evidence files: for every compound in the Library, the two voices for each use it's
// known for (what the studies show, what the community reports, which leads, and how many improve
// anyway), worked out with the very code Miracle AI uses (supabase/functions/ask/community.ts and
// agents.ts) from the same hourly snapshot. The library's fact sheets read these files, so a fact
// sheet and Miracle AI say the same thing about the same question.
//
// Usage: deno run --allow-read --allow-write --allow-net=miraclehealth.us \
//          scripts/build_evidence.ts <snapshot.json> <out_dir> [library_data_url]
// Writes <out_dir>/evidence/index.json and <out_dir>/evidence/<id>.json. Aggregate numbers only,
// as in the snapshot: no posts, no names.
import { communityOf, leadOf, USES, useById, type Use } from '../supabase/functions/ask/community.ts';
import { studiesOf } from '../supabase/functions/ask/agents.ts';
import { BLOCKED, type Item, type Sheet, type Signal, type Snapshot } from '../supabase/functions/ask/library.ts';

const [snapPath, outDir, base = 'https://miraclehealth.us/library/data'] = Deno.args;
if (!snapPath || !outDir) {
  console.error('Usage: build_evidence.ts <snapshot.json> <out_dir> [library_data_url]');
  Deno.exit(2);
}

async function getJson<T>(url: string): Promise<T | null> {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json() as T;
      if (r.status === 404) return null;
    } catch { /* try again */ }
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  return null;
}

const snap = JSON.parse(await Deno.readTextFile(snapPath)) as Snapshot;
if (!snap?.signals) {
  console.error('No snapshot to build from');
  Deno.exit(1);
}
const index = await getJson<{ items: Item[] }>(`${base}/index.json`);
if (!index?.items?.length) {
  console.error('The Library index could not be read');
  Deno.exit(1);
}
const byId = new Map(index.items.map((it) => [it.id, it]));

// The fact sheets, eight at a time
const sheets = new Map<string, Sheet | null>();
const want = index.items.filter((it) => it.sheet).map((it) => it.id);
for (let i = 0; i < want.length; i += 8) {
  const batch = want.slice(i, i + 8);
  const got = await Promise.all(batch.map((id) => getJson<Sheet>(`${base}/entries/${id}.json`)));
  batch.forEach((id, n) => sheets.set(id, got[n]));
}

// The uses a compound is known for: what the community reports it for (rated by members, or
// mentioned on the forums), then the uses of the goals its fact sheet is mainly about
function usesFor(it: Item, sheet: Sheet | null | undefined, sig: Signal | undefined): Use[] {
  const out: Use[] = [];
  const add = (u: Use | null) => { if (u && !out.some((x) => x.id === u.id)) out.push(u); };
  (sig?.by_use ?? []).filter((u) => u.rating != null || u.forum).forEach((u) => add(useById(u.use)));
  const goals = Object.entries(sheet?.goals ?? it.goals ?? {}).filter(([, w]) => Number(w) >= 0.75).map(([g]) => g);
  goals.forEach((g) => USES.filter((u) => u.goal === g).slice(0, 2).forEach(add));
  return out.slice(0, 6);
}

const compounds: string[] = [];
await Deno.mkdir(`${outDir}/evidence`, { recursive: true });
for (const it of index.items) {
  if (it.kind === 'stack') continue;
  const sheet = sheets.get(it.id);
  const sig = snap.signals[it.id] as Signal | undefined;
  if (!sheet && !sig) continue;
  const blocked = BLOCKED.has(sheet?.status_us?.key ?? it.status ?? '') || (it.parts ?? []).some((p) => BLOCKED.has(byId.get(p)?.status ?? ''));
  const uses = usesFor(it, sheet, sig).map((u) => {
    const studies = studiesOf(sheet, u.goal);
    const community = communityOf(sig, u, snap.uses);
    return {
      use: u.id, label: u.label, goal: u.goal,
      lead: leadOf(studies, community, { blocked }),
      studies: studies ? { grade: studies.grade, forUse: studies.forUse, main: studies.main, finding: studies.finding } : null,
      community: community ? {
        score: community.score, level: community.level, firstHand: community.firstHand, memberShare: community.memberShare,
        use: community.use, near: community.near, baseline: community.baseline,
      } : null,
    };
  });
  const community = communityOf(sig, null, snap.uses);
  const file = {
    id: it.id, name: sheet?.name ?? it.name, version: snap.generated_at ?? null,
    status: sheet?.status_us ? { key: sheet.status_us.key, label: sheet.status_us.label } : null,
    blocked,
    uses,
    // Safety notes that hold whatever the use: the side-effect watch, serious reactions, check-ins
    watch: community?.watch ?? [], serious: community?.serious ?? 0, checkins: community?.checkins ?? null,
  };
  await Deno.writeTextFile(`${outDir}/evidence/${it.id}.json`, JSON.stringify(file));
  compounds.push(it.id);
}
await Deno.writeTextFile(`${outDir}/evidence/index.json`, JSON.stringify({
  version: snap.generated_at ?? null, built_at: new Date().toISOString(), compounds,
  note: 'Both voices for each compound and use, worked out with Miracle AI\'s own code from the same snapshot. Aggregate numbers only.',
}));
console.log(`evidence: ${compounds.length} compounds from the snapshot of ${snap.generated_at ?? 'unknown'}`);
