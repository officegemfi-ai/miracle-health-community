// The Miracle Health Library and the Community Signal, as Miracle AI's agents read them:
// the public index of every compound (miraclehealth.us/library/data/index.json), each fact
// sheet (entries/<id>.json) and the community's public snapshot (aggregate numbers only).
// Everything is fetched from the public sites and kept for a few minutes.

export const GOALS = [
  'weight', 'muscle', 'recovery', 'energy', 'sleep', 'cognition',
  'skin', 'sexual', 'longevity', 'gut', 'immune', 'hormonal',
] as const;
export type Goal = typeof GOALS[number];
export const GOAL_LABEL: Record<Goal, string> = {
  weight: 'weight & metabolic health', muscle: 'muscle & body composition', recovery: 'injury recovery & joints',
  energy: 'energy', sleep: 'sleep', cognition: 'focus, mood & cognition', skin: 'skin, hair & appearance',
  sexual: 'sexual health & libido', longevity: 'healthy aging', gut: 'gut & inflammation',
  immune: 'immune resilience', hormonal: 'hormone balance',
};

export type Item = {
  id: string; name: string; family: string; category: string; aliases: string[]; kind: string; parts: string[];
  sheet: boolean | null;              // null: unknown (the index wasn't available)
  status?: string; status_label?: string; grade?: string; summary?: string;
  goals?: Partial<Record<Goal, number>>;
};
export type Sheet = {
  id: string; name: string; summary: string; what_it_is: string;
  evidence: { grade: string; why: string };
  status_us: { key: string; label: string; note: string };
  goals: Record<string, number>;
  benefits: { claim: string; evidence: string; sources?: number[] }[];
  risks: { risk: string; how_common: string }[];
  avoid_if: string[]; interactions: string[];
  labs: { before: string[]; during: string[]; why: string };
  ask_your_clinician: string[];
  sources: { n: number; title: string; publisher: string; year: number | string; url: string }[];
};
export type Signal = {
  name?: string; score: number; certification?: string; first_hand?: number; voices?: number;
  summary_label?: string; confidence_label?: string; themes?: { theme: string; label: string }[];
  outcomes?: { better: number; same: number; worse: number; better_pct?: number } | null;
  side_effects?: { effect: string; n: number }[];
  by_use?: { use: string; rating?: number | null; reports?: number; forum?: string | null }[];
};
export type Snapshot = { signals: Record<string, Signal>; uses: Record<string, [string, string]> };

export const LEVEL: Record<string, string> = {
  forum: 'Forum data (mostly public forums so far)',
  early: 'Early signal (members\' reports only, still few)',
  backed: 'Community-backed',
  verified: 'Community-verified',
  certified: 'Signal Certified',
};
export const LEVEL_SHORT: Record<string, string> = {
  forum: 'Forum data', early: 'Early signal', backed: 'Community-backed', verified: 'Community-verified', certified: 'Signal Certified',
};
const FAMILY_ONE: Record<string, string> = {
  Supplements: 'Supplement', Peptides: 'Peptide', Medications: 'Medication', Hormones: 'Hormone', Blends: 'Blend',
};
export const familyOne = (f: string) => FAMILY_ONE[f] ?? f;

// Not approved for any use in the US, one way or another
export const UNAPPROVED = new Set(['not_approved', 'investigational', 'under_review', 'category2', 'restricted', 'unclear']);
// Never on a shortlist: FDA's list of substances with significant safety risks, or other restrictions
export const BLOCKED = new Set(['category2', 'restricted']);

const GRADE_W: Record<string, number> = { strong: 1, moderate: 0.8, limited: 0.55, preclinical: 0.3, anecdotal: 0.15 };
const STATUS_W: Record<string, number> = {
  approved: 1, otc: 1, supplement: 0.95, compounded: 0.7, under_review: 0.5, investigational: 0.5,
  not_approved: 0.45, unclear: 0.4, category2: 0.1, restricted: 0.1,
};
// For compounds without a fact sheet yet: the goal their Library category belongs to
const CATEGORY_GOAL: Record<string, Goal> = {
  'Hormone balance': 'hormonal', 'Metabolic & weight': 'weight', 'Cognition & focus': 'cognition', Longevity: 'longevity',
  'Mood & stress': 'cognition', 'Immune & inflammation': 'immune', 'Skin & hair': 'skin', 'Muscle & performance': 'muscle',
  'Growth-hormone axis': 'muscle', 'Gut & digestion': 'gut', 'Heart & circulation': 'longevity',
  'Energy & mitochondria': 'energy', 'Joints & bones': 'recovery', Sleep: 'sleep', 'Healing & recovery': 'recovery',
  'Liver & detox': 'gut', 'Sexual health': 'sexual',
};

export const fold = (s: string) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
const spaced = (s: string) => ' ' + String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
// A name that joins compounds ("BPC-157/TB-500", "CJC-1295 + Ipamorelin") only counts when they
// are written joined the same way, not when someone lists them one by one
const COMBO = /[\/+&]/;
const joined = (s: string) => ' ' + String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\/+&]+/g, ' ').replace(/\s*([\/+&])\s*/g, '$1').trim() + ' ';
// Short aliases that are also everyday words: never matched in free text
const AMBIGUOUS = new Set(['ai', 'same', 'salt', 'test', 'glow', 'dim', 'mag', 'ps', 'nr', 'gh', 'mb', 'ha', 'pea', 'nasa',
  'mic', 'vita', 'ipa', 'kelp', 't 1', 't 4', 'cs 4', 'iron man', 'lira', 'reta', 'tesa', 'sema', 'ala', 'mt i']);

// ---------------------------------------------------------------------------
// Fetching, with a short memory
// ---------------------------------------------------------------------------
type Cached = { at: number; value: unknown };
const memo = new Map<string, Cached>();
export function clearCache() { memo.clear(); }

async function cached<T>(key: string, ttl: number, now: number, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && now - hit.at < ttl) return hit.value as T;
  try {
    const value = await load();
    memo.set(key, { at: now, value });
    return value;
  } catch (e) {
    if (hit) return hit.value as T;   // stale beats nothing
    throw e;
  }
}

export type LibraryOpts = { base: string; snapshotUrl: string; fetchImpl?: typeof fetch; now?: () => number };

export function createLibrary(opts: LibraryOpts) {
  const f = opts.fetchImpl ?? fetch;
  const now = () => (opts.now ? opts.now() : Date.now());
  const getJson = async (url: string) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    try {
      const res = await f(url, { headers: { accept: 'application/json' }, signal: ac.signal });
      if (res.status === 404) { await res.body?.cancel(); return null; }
      if (!res.ok) { await res.body?.cancel(); throw new Error(`${url} answered ${res.status}`); }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    async items(): Promise<Item[]> {
      return await cached('index', 10 * 60_000, now(), async () => {
        const idx = await getJson(`${opts.base}/index.json`).catch(() => null);
        if (idx && Array.isArray(idx.items)) return (idx.items as Item[]).map(cleanItem);
        const cat = await getJson(`${opts.base}/catalog.json`);
        if (!Array.isArray(cat)) throw new Error('The library catalog is unavailable');
        return (cat as Item[]).map((c) => cleanItem({ ...c, sheet: null }));
      });
    },
    async sheet(id: string): Promise<Sheet | null> {
      if (!/^[a-z0-9]{1,40}$/.test(id)) return null;
      return await cached(`sheet:${id}`, 15 * 60_000, now(), async () => (await getJson(`${opts.base}/entries/${id}.json`)) as Sheet | null);
    },
    async snapshot(): Promise<Snapshot> {
      return await cached('snapshot', 10 * 60_000, now(), async () => {
        const s = await getJson(opts.snapshotUrl).catch(() => null);
        return { signals: (s && typeof s.signals === 'object' && s.signals) || {}, uses: (s && s.uses) || {} } as Snapshot;
      });
    },
  };
}
export type Library = ReturnType<typeof createLibrary>;

function cleanItem(x: Item): Item {
  return {
    ...x,
    aliases: Array.isArray(x.aliases) ? x.aliases.map(String) : [],
    parts: Array.isArray(x.parts) ? x.parts.map(String) : [],
  };
}

// ---------------------------------------------------------------------------
// Finding compounds
// ---------------------------------------------------------------------------
// The compounds a list of names refers to (as the Safety agent wrote them down)
export function resolve(items: Item[], names: string[]): string[] {
  const out: string[] = [];
  for (const raw of names.slice(0, 12)) {
    const q = fold(raw);
    if (q.length < 2) continue;
    let best: { id: string; rank: number; len: number } | null = null;
    for (const it of items) {
      for (const k of [it.id, it.name, ...it.aliases]) {
        const kf = fold(k);
        if (!kf) continue;
        let rank = 0;
        if (kf === q) rank = 3;
        else if (q.length >= 4 && kf.startsWith(q)) rank = 2;
        else if (kf.length >= 4 && q.includes(kf)) rank = 1.5;
        else if (q.length >= 5 && kf.includes(q)) rank = 1;
        if (rank && (!best || rank > best.rank || (rank === best.rank && it.name.length < best.len))) {
          best = { id: it.id, rank, len: it.name.length };
        }
      }
    }
    if (best && !out.includes(best.id)) out.push(best.id);
  }
  return out;
}

// Compounds named anywhere in a message, as a backstop to the Safety agent's list
export function mentioned(items: Item[], text: string): string[] {
  const t = spaced(text);
  const j = joined(text);
  const squashed = fold(text);
  const out: string[] = [];
  for (const it of items) {
    for (const k of [it.name, it.id, ...it.aliases]) {
      const ks = spaced(k);
      const core = ks.trim();
      if (core.length < 2 || AMBIGUOUS.has(core)) continue;
      const hit = COMBO.test(k) ? j.includes(joined(k)) : t.includes(ks) || (fold(k).length >= 6 && squashed.includes(fold(k)));
      if (hit) { if (!out.includes(it.id)) out.push(it.id); break; }
    }
    if (out.length >= 8) break;
  }
  return out;
}

// A blend named along with every one of its parts: either they're listing the parts (keep the
// parts) or describing the blend they take, by its own name (keep the blend), never both
export function tidyBlends(items: Item[], ids: string[], text: string): string[] {
  const byId = new Map(items.map((it) => [it.id, it]));
  const t = spaced(text);
  let out = [...ids];
  for (const id of ids) {
    const it = byId.get(id);
    if (!it || !it.parts.length || !out.includes(id) || !it.parts.every((p) => out.includes(p))) continue;
    const own = [it.id, it.name.replace(/\([^)]*\)/g, ' '), ...it.aliases].filter((k) => !COMBO.test(k)).some((k) => {
      const ks = spaced(k);
      const core = ks.trim();
      return core.length >= 3 && !AMBIGUOUS.has(core) && t.includes(ks);
    });
    out = own ? out.filter((x) => !it.parts.includes(x)) : out.filter((x) => x !== id);
  }
  return out;
}

export function search(items: Item[], query: string, limit = 8): Item[] {
  const q = fold(query);
  const words = spaced(query).trim().split(' ').filter((w) => w.length >= 3);
  if (!q) return [];
  const scored = items.map((it) => {
    const keys = [it.id, it.name, ...it.aliases].map(fold);
    let s = 0;
    if (keys.some((k) => k === q)) s = 10;
    else if (keys.some((k) => k.startsWith(q))) s = 6;
    else if (keys.some((k) => k.includes(q) || (k.length >= 4 && q.includes(k)))) s = 4;
    const hay = spaced([it.name, ...it.aliases, it.category, it.family, it.summary ?? ''].join(' '));
    s += words.filter((w) => hay.includes(` ${w}`)).length;
    if (it.sheet) s += 0.5;
    return { it, s };
  }).filter((x) => x.s > 0);
  scored.sort((a, b) => b.s - a.s || a.it.name.localeCompare(b.it.name));
  return scored.slice(0, limit).map((x) => x.it);
}

export type Option = Item & { fit: number; score: number; signal?: Signal | null; gate?: string };

// The Recommender's ranking for one goal: how much each compound is used or studied for it,
// the strength of its evidence and its US status, with a nudge from a well-backed Signal.
// Compounds without a fact sheet yet come after, marked as such.
export function rank(items: Item[], signals: Record<string, Signal>, goal: Goal, opts: { families?: string[]; exclude?: string[]; limit?: number } = {}): Option[] {
  const fams = opts.families?.length ? new Set(opts.families) : null;
  const skip = new Set(opts.exclude ?? []);
  const pool = items.filter((it) => !skip.has(it.id) && (!fams || fams.has(it.family)));
  const withSheet: Option[] = [];
  const without: Option[] = [];
  for (const it of pool) {
    const sig = signals[it.id] ?? null;
    if (it.sheet && it.goals) {
      const fit = Number(it.goals[goal] ?? 0);
      if (fit < 0.5) continue;
      // A fact sheet grades the evidence for the compound's main use; for a side goal the
      // evidence is counted as limited at best
      const main = GRADE_W[it.grade ?? ''] ?? 0.3;
      const g = fit >= 1 ? main : Math.min(main, GRADE_W.limited);
      const st = STATUS_W[it.status ?? ''] ?? 0.4;
      const lvl = sig?.certification;
      const bonus = sig && (lvl === 'backed' || lvl === 'verified' || lvl === 'certified') ? (Number(sig.score) / 100) * 0.08 : 0;
      const gate = BLOCKED.has(it.status ?? '') ? 'Never on a shortlist (FDA safety-risk list or restricted)'
        : it.status === 'investigational' ? 'Not for use outside a clinical trial'
        : it.family === 'Hormones' ? (it.status === 'supplement' ? 'A hormone sold as a supplement: test levels with a clinician first'
          : 'A prescription hormone: only after testing, with a clinician monitoring')
        : undefined;
      withSheet.push({ ...it, fit, score: fit * g * st + bonus, signal: sig, gate });
    } else if (!it.sheet && CATEGORY_GOAL[it.category] === goal) {
      without.push({ ...it, fit: 0.5, score: 0, signal: sig });
    }
  }
  withSheet.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  without.sort((a, b) => Number(b.signal?.score ?? 0) - Number(a.signal?.score ?? 0) || a.name.localeCompare(b.name));
  const limit = opts.limit ?? 10;
  return [...withSheet.slice(0, limit), ...without.slice(0, Math.max(0, Math.min(4, limit - withSheet.length)))];
}

// ---------------------------------------------------------------------------
// Writing it down for the agents
// ---------------------------------------------------------------------------
const pct = (n: number) => `${Math.round(n)}%`;

export function signalLine(sig: Signal | null | undefined, uses: Record<string, [string, string]> = {}): string {
  if (!sig || typeof sig.score !== 'number') return 'Community Signal: not available yet.';
  const parts = [`Community Signal: ${Number(sig.score).toFixed(1)}/100`, LEVEL[sig.certification ?? 'forum'] ?? LEVEL.forum];
  if (sig.summary_label) parts.push(`overall: ${String(sig.summary_label).toLowerCase()}`);
  parts.push(sig.first_hand ? `${sig.first_hand} first-hand report${sig.first_hand === 1 ? '' : 's'} from members` : 'no first-hand reports from members yet');
  const themes = (sig.themes ?? []).slice(0, 4).map((t) => `${t.theme} (${String(t.label).toLowerCase()})`);
  if (themes.length) parts.push(`what people describe: ${themes.join(', ')}`);
  const o = sig.outcomes;
  if (o && typeof o.better === 'number') {
    const n = o.better + o.same + o.worse;
    if (n) parts.push(`members' outcomes: ${pct(o.better_pct ?? (100 * o.better) / n)} better, ${o.same} same, ${o.worse} worse (of ${n} read)`);
  }
  const rated = (sig.by_use ?? []).filter((u) => typeof u.rating === 'number').slice(0, 3)
    .map((u) => `${uses[u.use]?.[0] ?? u.use} ${u.rating} (${u.reports ?? 0} reports)`);
  if (rated.length) parts.push(`rated by use: ${rated.join(', ')}`);
  const forum = (sig.by_use ?? []).filter((u) => u.rating == null && u.forum).slice(0, 3)
    .map((u) => `${uses[u.use]?.[0] ?? u.use} (${String(u.forum).toLowerCase()})`);
  if (forum.length) parts.push(`what forums mostly use it for: ${forum.join(', ')}`);
  const fx = (sig.side_effects ?? []).slice(0, 4).map((s) => `${s.effect} (${s.n})`);
  if (fx.length) parts.push(`side effects members mention: ${fx.join(', ')}`);
  return parts.join(' · ');
}

const list = (xs: string[] | undefined, n: number) => (xs ?? []).filter(Boolean).slice(0, n);

export function condense(sheet: Sheet, item: Item | undefined, sig: Signal | null | undefined, uses: Record<string, [string, string]> = {}): string {
  const fam = item ? `${familyOne(item.family)} · ${item.category}` : '';
  const out = [
    `### ${sheet.name} (id ${sheet.id})${fam ? ` · ${fam}` : ''}`,
    `US status: ${sheet.status_us?.label ?? 'unknown'} [${sheet.status_us?.key ?? '?'}]. ${sheet.status_us?.note ?? ''}`.trim(),
    `Evidence: ${sheet.evidence?.grade ?? '?'}. ${sheet.evidence?.why ?? ''}`.trim(),
    `What it is: ${sheet.what_it_is ?? sheet.summary ?? ''}`,
  ];
  const ben = list(sheet.benefits?.map((b) => `${b.claim} [${b.evidence}]`), 5);
  if (ben.length) out.push('What studies show:\n' + ben.map((b) => `- ${b}`).join('\n'));
  const risks = list(sheet.risks?.map((r) => `${r.risk} [${r.how_common}]`), 5);
  if (risks.length) out.push('Risks:\n' + risks.map((r) => `- ${r}`).join('\n'));
  const avoid = list(sheet.avoid_if, 5);
  if (avoid.length) out.push('Avoid it or check with a clinician first if: ' + avoid.join('; '));
  const inter = list(sheet.interactions, 5);
  if (inter.length) out.push('Interactions: ' + inter.join('; '));
  const before = list(sheet.labs?.before, 3);
  const during = list(sheet.labs?.during, 3);
  if (before.length || during.length) {
    out.push(`Blood markers a clinician may check: ${before.length ? `before: ${before.join('; ')}` : ''}${before.length && during.length ? ' · ' : ''}${during.length ? `during: ${during.join('; ')}` : ''}`);
  }
  const q = list(sheet.ask_your_clinician, 3);
  if (q.length) out.push('Questions the fact sheet suggests for a clinician: ' + q.join(' | '));
  out.push(signalLine(sig, uses));
  const src = list(sheet.sources?.map((s) => `${s.title} (${s.publisher}, ${s.year})`), 5);
  if (src.length) out.push('Sources on the fact sheet: ' + src.join('; '));
  return out.join('\n');
}

// One line per compound with no fact sheet: what little the catalog says
export function stub(item: Item, sig: Signal | null | undefined, uses: Record<string, [string, string]> = {}): string {
  const parts = item.kind === 'blend' && item.parts.length ? ` · a blend of ${item.parts.join(', ')}` : '';
  return `### ${item.name} (id ${item.id}) · ${familyOne(item.family)} · ${item.category}${parts}\nNo fact sheet yet: it's still being researched for the Library. Keep to what is well established and say the fact sheet isn't ready.\n${signalLine(sig, uses)}`;
}

export function optionLine(o: Option, i: number): string {
  const sig = o.signal && typeof o.signal.score === 'number'
    ? ` · Signal ${Number(o.signal.score).toFixed(0)} (${LEVEL_SHORT[o.signal.certification ?? 'forum'] ?? 'Forum data'})` : '';
  if (!o.sheet) return `${i + 1}. ${o.name} (${o.id}) · ${familyOne(o.family)} · no fact sheet yet${sig}`;
  const ev = o.fit >= 1 ? `evidence ${o.grade} (this is its main use)` : `evidence ${o.grade} for its main use, not this goal (check the fact sheet)`;
  return `${i + 1}. ${o.name} (${o.id}) · ${familyOne(o.family)} · ${ev} · ${o.status_label ?? o.status} · fit ${o.fit}${sig}${o.gate ? ` · ${o.gate}` : ''}`;
}

// The whole Library in a few lines, for the guide's standing instructions
export function indexText(items: Item[]): string {
  const fams = ['Supplements', 'Peptides', 'Medications', 'Hormones', 'Blends'];
  const groups = fams.map((f) => {
    const xs = items.filter((it) => it.family === f).sort((a, b) => a.name.localeCompare(b.name));
    if (!xs.length) return '';
    return `${f}: ` + xs.map((it) => `${it.name} [${it.id}]${it.sheet ? '*' : ''}`).join(', ');
  }).filter(Boolean);
  const other = items.filter((it) => !fams.includes(it.family));
  if (other.length) groups.push('Other: ' + other.map((it) => `${it.name} [${it.id}]${it.sheet ? '*' : ''}`).join(', '));
  return groups.join('\n');
}
