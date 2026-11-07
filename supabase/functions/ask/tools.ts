// The guide's tools: looking things up in the Library, and the cards it can put on the member's
// screen (shortlists, the Miracle Plan, questions, when to get help), each checked by the gate.
import { BLOCKED, familyOne, GOAL_LABEL, GOALS, type Goal, optionLine, rank, search, UNAPPROVED } from './library.ts';
import { cleanField, maskTargets } from './guard.ts';
import { blockedItem } from './community.ts';
import { warningCard } from './urgency.ts';
import { evidenceNote } from './outcomes.ts';
import { auditSet, auditText, auditTitle } from './audit.ts';
import { baseItem, type CardItem, GENERIC_WELLBEING, PILLAR_NAME, PILLAR_STATES, PILLAR_STEP, type PillarState, PILLARS, type PlanItem, PROTEIN_STEP, proven } from './items.ts';
import { auditCard } from './cards.ts';
import { evidenceStep } from './evidence.ts';
import { chip, type Ctx, nextId, openSheets, sheetText, step } from './context.ts';
import { strs } from './fence.ts';

// Food-like, low-risk supplements a plan may add before the Library has a fact sheet for them
// (protein, amino acids, fiber, electrolytes, basic vitamins and minerals); any other
// supplement needs a fact sheet first
const FOOD_LIKE = new Set(['whey', 'eaa', 'bcaa', 'hmb', 'electrolytes', 'psyllium', 'prebiotic', 'multivitamin', 'vitc', 'calcium', 'magcitrate',
  'magmalate', 'magtaurate', 'betaalanine', 'lcitrulline', 'tartcherry', 'bcomplex', 'chondroitin', 'hyaluronic', 'msm', 'uc2']);
// Tools that put a card on the member's screen
const CARD_TOOLS = new Set(['present_shortlist', 'present_plan', 'clinician_questions', 'warning_signs', 'ask_member', 'audit_combination']);
const TOOL_LIMITS: Record<string, number> = {
  find_options: 3, read_fact_sheets: 4, search_library: 4, audit_combination: 2, present_shortlist: 2, clinician_questions: 2, ask_member: 2,
  warning_signs: 1, present_plan: 1,
};
// A card of questions comes before a full answer, never after one: past this many characters of
// answer, the guide ends with one question in prose instead
const ASK_AFTER = 700;
// A question as the member sees it: if it runs long, it ends at its last question mark rather
// than mid-sentence
function question(raw: unknown): string {
  const t = cleanField(raw, 400);
  if (t.length <= 160) return t;
  const cut = t.lastIndexOf('?', 160);
  return cut >= 40 ? t.slice(0, cut + 1) : cleanField(t, 160);
}
// What Sig never asks a member: who they are or how to reach them, amounts they take,
// or where they get things
const NOT_TO_ASK = /\byour\s+(?:full\s+|first\s+|last\s+)?name\b|\be-?mail\b|\b(?:phone|cell)\s+number\b|\b(?:home|street|mailing)\s+address\b|\byour\s+address\b|\bzip\s*code\b|\bpostal\s+code\b|\bdate\s+of\s+birth\b|\bbirth\s?day\b|\bsocial\s+security\b|\binsurance\s+(?:id|number)\b|\bhow\s+(?:much|many)\b[^?]*\b(?:take|taking|use|using|inject|injecting|run|running)\b|\bdos(?:e|es|age|ing)\b|\bwhere\s+(?:do|did|would|will|can|could)\s+you\s+(?:get|buy|order|source)\b|\b(?:buy|purchase|vendor|seller|supplier|pharmac(?:y|ies))\b/i;
// Sig never asks someone's age or sex (they can say if they like)
const NO_DEMOGRAPHICS = /\bhow\s+old\b|\b(?:your|what(?:'s|\s+is))\s+(?:age|sex|gender)\b|\bage\s+(?:range|group|bracket)\b|\b(?:biological\s+)?sex\s+(?:were\s+you\s+)?assigned\b|\bbiological\s+sex\b|\b(?:male|man)\s+or\s+(?:female|woman)\b|\b(?:female|woman)\s+or\s+(?:male|man)\b/i;
const DEMOGRAPHIC_OPTION = /^(?:under\s+18|\d{2}\s?(?:[–-]|to)\s?\d{2}|\d{2}\s?(?:\+|or\s+older|and\s+(?:up|over))|(?:fe)?male|(?:wo)?man|non-?binary|prefer\s+not\s+to\s+say)$/i;

export async function runTool(name: string, input: Record<string, unknown>, ctx: Ctx): Promise<string> {
  const s = ctx.screen;
  ctx.uses[name] = (ctx.uses[name] ?? 0) + 1;
  if (ctx.uses[name] > (TOOL_LIMITS[name] ?? 2)) return 'That tool has been used enough for this turn; answer from what you have.';
  if (ctx.wordsOnly && CARD_TOOLS.has(name)) return 'The cards are already on their screen: write the reply in words now.';
  switch (name) {
    case 'find_options': {
      const goal = String(input.goal ?? '') as Goal;
      if (!(GOALS as readonly string[]).includes(goal)) return `Unknown goal. Use one of: ${GOALS.join(', ')}.`;
      const fams = strs(input.families, 5, 20);
      const opts = rank(ctx.items, ctx.snap.signals, goal, { families: fams, exclude: strs(input.exclude, 20, 40) });
      step(ctx, { id: nextId(ctx, 'rec'), agent: 'recommender', status: 'done', title: `Looked up options for ${GOAL_LABEL[goal]} in the Library` });
      if (!opts.length) return `Nothing in the Library is mainly used or studied for ${GOAL_LABEL[goal]}.`;
      return `Options for ${GOAL_LABEL[goal]}, best first (fit = how much it's used or studied for this goal, 0.5 to 1):\n${opts.map(optionLine).join('\n')}\nOpen the ones you want to discuss with read_fact_sheets before making specific claims.`;
    }
    case 'read_fact_sheets': {
      const ids = strs(input.ids, 4, 40).filter((id) => ctx.byId.has(id));
      const unknown = strs(input.ids, 4, 40).filter((id) => !ctx.byId.has(id));
      if (ctx.opened.size >= 12) return 'You have opened enough fact sheets for this turn; answer from what you have.';
      if (!ids.length) return `None of these ids are in the Library: ${unknown.join(', ')}. Use search_library.`;
      await openSheets(ids, ctx);
      ids.forEach((id) => ctx.opened.add(id));
      step(ctx, { id: nextId(ctx, 'rec'), agent: 'recommender', status: 'done', title: `Opened ${ids.length} fact sheet${ids.length === 1 ? '' : 's'}`, chips: ids.map((id) => chip(id, ctx)) });
      // What they asked about, in each of these sheets
      const ev = ctx.plan.outcomes.length ? evidenceStep(ids, ctx) : [];
      return ids.map((id) => sheetText(id, ctx)).join('\n\n') + (ev.length ? `\n\n${evidenceNote(ev, ctx.plan)}` : '') + (unknown.length ? `\n\nNot in the Library: ${unknown.join(', ')}.` : '');
    }
    case 'search_library': {
      const q = String(input.query ?? '').slice(0, 80);
      const found = search(ctx.items, q, 8);
      step(ctx, { id: nextId(ctx, 'rec'), agent: 'recommender', status: 'done', title: found.length ? 'Searched the Library' : 'Searched the Library: nothing matched', chips: found.slice(0, 6).map((it) => chip(it.id, ctx)) });
      if (!found.length) return 'Nothing in the Library matches that.';
      return found.map((it) => `${it.name} [${it.id}] · ${familyOne(it.family)} · ${it.category}${it.sheet ? ` · evidence ${it.grade ?? '?'} · ${it.status_label ?? it.status ?? ''}` : ' · no fact sheet yet'}`).join('\n');
    }
    case 'audit_combination': {
      const ids = [...new Set(strs(input.ids, 8, 40).filter((id) => ctx.byId.has(id)))];
      if (!ids.length) return 'None of these ids are in the Library.';
      const meds = [...new Set([...s.medications, ...strs(input.medications, 10)])].slice(0, 10);
      const conds = [...new Set([...s.conditions, ...strs(input.conditions, 10)])].slice(0, 10);
      const sid = nextId(ctx, 'syn');
      step(ctx, { id: sid, agent: 'synergy', status: 'run', title: `Checking ${ids.length} together${meds.length ? ' with your medicines' : ''}`, chips: ids.map((id) => chip(id, ctx)) });
      await openSheets(ids, ctx);
      const a = await auditSet(ids, meds, conds, s.pregnant || ctx.st.pregnant, ctx, ctx.deps);
      step(ctx, { id: sid, agent: 'synergy', status: 'done', title: auditTitle(a, ids.length) });
      if (a.ok && a.findings.length) auditCard(a, ctx);
      return auditText(a, ctx.byId);
    }
    case 'present_shortlist': {
      if (!ctx.shortlistsOn) return 'Not shown: shortlists are off for this turn (the Safety agent\'s flags). Don\'t suggest compounds; answer generally.';
      const pregnant = s.pregnant || ctx.st.pregnant;
      const raw = (Array.isArray(input.items) ? input.items : []) as Record<string, unknown>[];
      const seen = new Set<string>();
      const dropped: string[] = [];
      const picks = raw.map((r, i) => ({ id: String(r.id ?? '').trim(), role: r.role, why: r.why, i }))
        .filter((r) => {
          if (!ctx.byId.has(r.id)) { if (r.id) dropped.push(`${r.id} (not in the Library)`); return false; }
          if (seen.has(r.id)) return false;
          seen.add(r.id);
          return true;
        }).slice(0, 6);
      await openSheets(picks.map((p) => p.id), ctx);
      const items: CardItem[] = [];
      for (const p of picks) {
        const it = ctx.byId.get(p.id)!;
        const sh = ctx.sheets.get(p.id);
        const key = sh?.status_us?.key ?? it.status ?? '';
        if (BLOCKED.has(key)) { dropped.push(`${it.name} (removed by the Safety agent: ${sh?.status_us?.label ?? 'restricted'})`); continue; }
        if (blockedItem(it, ctx.byId)) { dropped.push(`${it.name} (removed by the Safety agent: contains a compound on FDA's safety-risk list)`); continue; }
        if (pregnant && (ctx.unread.has(p.id) || UNAPPROVED.has(key) || key === 'compounded' || it.family === 'Hormones' || (sh?.avoid_if ?? []).some((a) => /pregnan|breast-?fe|conceiv/i.test(a)))) {
          dropped.push(`${it.name} (removed by the Safety agent: not for pregnancy, trying to conceive or breastfeeding)`);
          continue;
        }
        const research = UNAPPROVED.has(key) || key === 'investigational';
        items.push({
          ...baseItem(it, sh, ctx, pregnant, ctx.goal),
          role: research ? 'Research stage' : cleanField(p.role, 40) || familyOne(it.family),
          why: cleanField(p.why, 180),
        });
      }
      if (!items.length) return `Nothing could be shown. ${dropped.join('; ')}`;
      items.forEach((i) => ctx.heard.set(i.id, i.community));
      // Proven options first, research-stage ones last, whatever order they came in
      items.sort((a, b) => proven(a.status?.key ?? '') - proven(b.status?.key ?? ''));
      const title = cleanField(input.title, 60) || 'To discuss with your clinician';
      const allResearch = items.every((i) => proven(i.status?.key ?? '') >= 2);
      const card = `card${++ctx.stepN}`;
      ctx.shortlists++;
      step(ctx, { id: nextId(ctx, 'bld'), agent: 'builder', status: 'done', title: `Shortlist of ${items.length} to discuss`, chips: items.map((i) => chip(i.id, ctx)) });
      ctx.gate.card(
        [{ key: 'title', text: title }, ...items.map((i, n) => ({ key: `i${n}`, text: `${i.name}. Role: ${i.role}. Why: ${i.why}` }))],
        (ok) => {
          const shown = items.map((i, n) => (ok.has(`i${n}`) ? i : { ...i, role: i.role === 'Research stage' ? i.role : i.family, why: '' }));
          const shownTitle = ok.has('title') ? title : 'To discuss with your clinician';
          ctx.memo.push(`shortlist "${shownTitle}": ${shown.map((i) => `${i.name} [${i.id}] (${i.role})`).join(', ')}`);
          return {
            type: 'shortlist', id: card, title: shownTitle, goal: s.goals[0] ?? '',
            note: allResearch ? 'Everything here is research-stage: not approved, with little evidence in people. A clinician may suggest proven options first.' : '',
            items: shown,
          };
        },
      );
      // The Synergy auditor checks every shortlist
      let auditLine = '';
      if (items.length > 1 || s.medications.length || s.conditions.length || pregnant) {
        const sid = nextId(ctx, 'syn');
        step(ctx, { id: sid, agent: 'synergy', status: 'run', title: `Checking the shortlist together${s.medications.length ? ' with your medicines' : ''}` });
        const a = await auditSet(items.map((i) => i.id), s.medications, s.conditions, pregnant, ctx, ctx.deps);
        step(ctx, { id: sid, agent: 'synergy', status: 'done', title: auditTitle(a, items.length) });
        auditCard(a, ctx, card);
        auditLine = `\nSynergy auditor on this shortlist:\n${auditText(a, ctx.byId)}`;
      }
      const order = `in this order: ${items.map((i) => `${i.name} (${i.tag})`).join(', ')}.${dropped.length ? ` Left out: ${dropped.join('; ')}.` : ''}${auditLine}`;
      // Asked for before the answer was explained: the card follows the words instead
      return ctx.gate.waiting
        ? `The card will be shown right after your explanation, ${order}\nNow write your answer in words: what the evidence shows, the US status, the risks, what matters for this member. Don't mention when the card appears. Then call clinician_questions.`
        : `Shown to the member, ${order}\nNow mention briefly anything the auditor found, then call clinician_questions.`;
    }
    case 'present_plan': {
      if (!ctx.shortlistsOn) return 'Not shown: plans are off for this turn (the Safety agent\'s flags). Answer generally, without a plan.';
      const pregnant = s.pregnant || ctx.st.pregnant;
      const rawF = (Array.isArray(input.foundations) ? input.foundations : []) as Record<string, unknown>[];
      // Exactly one pillar to start with: the first one marked start (or focus, or next, in the
      // order they were given); any other start is next
      const order = rawF.map((x) => String(x?.pillar ?? '').toLowerCase());
      const stateOf = (pillar: string) => String(rawF.find((x) => String(x?.pillar ?? '').toLowerCase() === pillar)?.state ?? '');
      const lead = order.find((p) => ['start', 'focus'].includes(stateOf(p))) ?? order.find((p) => stateOf(p) === 'next') ?? '';
      const foundations = PILLARS.map((pillar) => {
        const f = rawF.find((x) => String(x?.pillar ?? '').toLowerCase() === pillar);
        const said = String(f?.state ?? '');
        const state: PillarState = pillar === lead ? 'start'
          : ['start', 'focus', 'next'].includes(said) ? 'next'
          : (PILLAR_STATES as readonly string[]).includes(said) ? said as PillarState : 'unknown';
        return { pillar, state, step: cleanField(f?.step ?? f?.note, 90, true) || PILLAR_STEP[pillar] };
      });
      const startPillar = foundations.find((f) => f.state === 'start');
      const firstStep = startPillar ? cleanField(input.first_step, 80, true) : '';
      const dropped: string[] = [];
      const seen = new Set<string>();
      const asked = [...(Array.isArray(input.peptides) ? input.peptides : []), ...(Array.isArray(input.supplements) ? input.supplements : [])] as Record<string, unknown>[];
      const want = asked.map((r) => ({ id: String(r?.id ?? '').trim(), role: r?.role }))
        .filter((r) => {
          if (!ctx.byId.has(r.id)) { if (r.id) dropped.push(`${r.id} (not in the Library)`); return false; }
          if (seen.has(r.id)) return false;
          seen.add(r.id);
          return true;
        }).slice(0, 8);
      await openSheets(want.map((w) => w.id), ctx);
      const peptides: PlanItem[] = [];
      const supplements: PlanItem[] = [];
      for (const w of want) {
        const it = ctx.byId.get(w.id)!;
        const sh = ctx.sheets.get(w.id);
        const key = sh?.status_us?.key ?? it.status ?? '';
        const theirs = ctx.mine.has(w.id);
        const supplement = it.family === 'Supplements';
        // Their own stack is always shown as it is; anything added is a supplement with a known,
        // legal status, never a peptide, hormone or prescription they don't take
        if (!theirs && !supplement) { dropped.push(`${it.name} (not something they take: their plan holds only their own peptides, hormones and medicines; mention other options in words, to ask a clinician about)`); continue; }
        const foodLike = !sh && FOOD_LIKE.has(it.id);
        if (!theirs && !foodLike && !['supplement', 'otc', 'approved'].includes(key)) { dropped.push(`${it.name} (no fact sheet yet, or not a plain supplement: mention it in words if it matters)`); continue; }
        if (!theirs && pregnant && (ctx.unread.has(w.id) || (sh?.avoid_if ?? []).some((a) => /pregnan|breast-?fe|conceiv/i.test(a)))) {
          dropped.push(`${it.name} (removed by the Safety agent: not for pregnancy, trying to conceive or breastfeeding)`);
          continue;
        }
        const b = baseItem(it, sh, ctx, pregnant, ctx.goal);
        (supplement ? supplements : peptides).push({
          id: it.id, name: b.name, url: b.url, family: b.family, tag: foodLike ? 'Supplement' : b.tag, tone: foodLike ? 'none' : b.tone, grade: b.grade, use: b.use,
          role: cleanField(w.role, 50) || b.family, yours: theirs,
        });
      }
      const byProof = (a: PlanItem, b: PlanItem) => proven(ctx.sheets.get(a.id)?.status_us?.key ?? ctx.byId.get(a.id)?.status ?? '') - proven(ctx.sheets.get(b.id)?.status_us?.key ?? ctx.byId.get(b.id)?.status ?? '');
      peptides.sort(byProof).splice(4);
      supplements.sort(byProof).splice(4);
      const wellbeing = strs(input.wellbeing, 3, 160).map((w) => cleanField(w, 80, true)).filter((w) => w && !GENERIC_WELLBEING.test(w)).slice(0, 2);
      const title = cleanField(input.title, 60) || 'Your Miracle Plan';
      const card = `card${++ctx.stepN}`;
      ctx.plans++;
      // Their people: the community space for what they take (or the plan's first supplement)
      const hub = peptides[0] ?? supplements[0];
      const community = hub ? { id: hub.id, name: hub.name } : null;
      step(ctx, { id: nextId(ctx, 'plan'), agent: 'builder', status: 'done', title: `Built your plan${startPillar ? `, starting with ${PILLAR_NAME[startPillar.pillar].toLowerCase()}` : ''}`, chips: [...peptides, ...supplements].map((i) => chip(i.id, ctx)) });
      const listed = [...peptides, ...supplements];
      ctx.gate.card(
        [
          { key: 'title', text: title },
          ...(firstStep ? [{ key: 'first', text: `First step this week: ${firstStep}` }] : []),
          ...foundations.map((f, n) => ({ key: `f${n}`, text: `${PILLAR_NAME[f.pillar]} (${f.state}): ${f.step}` })),
          ...listed.map((i, n) => ({ key: `i${n}`, text: `${i.name}: ${i.role}` })),
          ...wellbeing.map((w, n) => ({ key: `w${n}`, text: w })),
        ],
        (ok) => {
          const fs = foundations.map((f, n) => (ok.has(`f${n}`) ? f
            : { ...f, step: f.pillar === 'nutrition' && maskTargets(f.step).targets.length ? PROTEIN_STEP : PILLAR_STEP[f.pillar] }));
          const keep = (i: PlanItem) => (ok.has(`i${listed.indexOf(i)}`) ? i : { ...i, role: i.family });
          const ps = peptides.map(keep);
          const ss = supplements.map(keep);
          const ws = wellbeing.filter((_, n) => ok.has(`w${n}`));
          const t = ok.has('title') ? title : 'Your Miracle Plan';
          const lead = fs.find((f) => f.state === 'start');
          const first = lead ? { pillar: lead.pillar, step: (firstStep && ok.has('first') ? firstStep : '') || lead.step } : null;
          ctx.memo.push(`Miracle Plan "${t}"${first ? `, first step: ${first.step}` : ''}: ${fs.map((f) => `${f.pillar} ${f.state}${f.step ? ` (${f.step})` : ''}`).join('; ')}`
            + (ps.length ? `; peptides and medicines: ${ps.map((i) => `${i.name} [${i.id}]`).join(', ')}` : '')
            + (ss.length ? `; supplements: ${ss.map((i) => `${i.name} [${i.id}]`).join(', ')}` : '')
            + (ws.length ? `; wellbeing: ${ws.join(' / ')}` : ''));
          return { type: 'plan', id: card, title: t, first, foundations: fs, peptides: ps, supplements: ss, wellbeing: ws, community };
        },
      );
      // The Synergy auditor checks what the plan adds (their own stack was checked upfront)
      let auditLine = '';
      const ids = listed.map((i) => i.id);
      const added = ids.filter((id) => !ctx.audited.has(id));
      if (added.length && (ids.length > 1 || s.medications.length || s.conditions.length || pregnant)) {
        const sid = nextId(ctx, 'syn');
        step(ctx, { id: sid, agent: 'synergy', status: 'run', title: `Checking your plan together${s.medications.length ? ' with your medicines' : ''}` });
        const a = await auditSet(ids, s.medications, s.conditions, pregnant, ctx, ctx.deps);
        const shown = ctx.audited.size ? { ...a, findings: a.findings.filter((f) => f.ids.some((id) => added.includes(id))) } : a;
        step(ctx, { id: sid, agent: 'synergy', status: 'done', title: auditTitle(shown, ids.length) });
        auditCard(shown, ctx, card);
        added.forEach((id) => ctx.audited.add(id));
        auditLine = `\nSynergy auditor on the plan:\n${auditText(shown, ctx.byId)}`;
      }
      const summary = `${firstStep ? `first step: ${firstStep}; ` : ''}${foundations.map((f) => `${PILLAR_NAME[f.pillar].toLowerCase()} (${f.state})`).join(', ')}`
        + (peptides.length ? `; peptides and medicines: ${peptides.map((i) => `${i.name} (${i.tag})`).join(', ')}` : '')
        + (supplements.length ? `; supplements: ${supplements.map((i) => i.name).join(', ')}` : '')
        + (dropped.length ? `. Left out: ${dropped.join('; ')}` : '');
      return ctx.gate.waiting
        ? `Their plan will be shown right after your words: ${summary}.${auditLine}\nNow, in words: why the start pillar matters most for them and the first step, and for the compounds, their benefits and how they work. The card lists the steps and roles, so don't repeat them as a list. Don't mention when the card appears. Then call clinician_questions.`
        : `Shown to the member as their Miracle Plan: ${summary}.${auditLine}\nIn a line or two, point them to where they start and the first step if you haven't yet (the card lists the rest), then call clinician_questions.`;
    }
    case 'clinician_questions': {
      const qs = strs(input.questions, 4, 400).map((q) => cleanField(q, 160))
        .filter((q) => q && !/\b(buy|purchase|order|vendor|seller|supplier|source|pharmac(?:y|ies)|purity|pure|vial|reconstitut\w*|where (?:can|do|to) (?:i )?get)\b/i.test(q));
      if (!qs.length) return 'No questions shown.';
      ctx.questions++;
      ctx.gate.card(qs.map((q, i) => ({ key: `q${i}`, text: q })), (ok) => {
        const kept = qs.filter((_, i) => ok.has(`q${i}`));
        if (kept.length) ctx.memo.push('questions for a clinician');
        return kept.length ? { type: 'questions', items: kept } : null;
      });
      return ctx.gate.waiting ? 'They\'ll be shown right after your answer in words. Write it now.' : 'Shown.';
    }
    case 'warning_signs': {
      const ids = strs(input.ids, 8, 40);
      const fresh = ids.filter((id) => !ctx.signs.has(id));
      if (ids.length && !fresh.length) return 'Those signs are already on the injection safety card shown this turn; don\'t repeat them.';
      const card = warningCard(fresh);
      if (!card) return 'No card shown: use ids from the list.';
      fresh.forEach((id) => ctx.signs.add(id));
      const n = card.groups.reduce((t, g) => t + g.signs.length, 0);
      step(ctx, { id: nextId(ctx, 'warn'), agent: 'safety', status: 'done', title: `When to get help: ${n} sign${n === 1 ? '' : 's'}, at levels from Miracle Health’s table` });
      ctx.gate.card([], () => {
        ctx.memo.push(`when to get help: ${card.groups.map((g) => `${g.label}: ${g.signs.join('; ')}`).join(' / ')}`);
        return card;
      }, { first: true });
      return 'Shown to the member as a "When to get help" card, each sign at its fixed level. Don\'t repeat these signs or when to get seen in your words.';
    }
    case 'ask_member': {
      // Ask or answer, not both: after a full answer, one question in prose is enough
      if (ctx.gate.written > ASK_AFTER) {
        return 'Not shown: you have already answered in full, so don\'t add a card of questions. If one thing would sharpen your answer, end with one short question in prose.';
      }
      const raw = (Array.isArray(input.questions) ? input.questions : []) as Record<string, unknown>[];
      const qs = raw.slice(0, 4).map((r) => ({
        q: question(r?.q),
        options: [...new Set(strs(r?.options, 6, 80).map((o) => cleanField(o, 40)).filter(Boolean))],
        multi: r?.multi === true,
      })).filter((x) => x.q && !NOT_TO_ASK.test(x.q) && !x.options.some((o) => NOT_TO_ASK.test(o))
        && !NO_DEMOGRAPHICS.test(x.q) && !x.options.some((o) => DEMOGRAPHIC_OPTION.test(o.trim())));
      if (!qs.length) return 'No questions shown. Don\'t ask for names, contact details, birthdays, age or sex, amounts or where they get things.';
      ctx.asked++;
      // Their stack is checked once they've said what else they take, not before; the studies and
      // the community on what they named come with the full answer
      ctx.gate.dropWaiting('voices');
      ctx.gate.dropWaiting('crowd');
      ctx.gate.dropWaiting('compare');
      if (ctx.gate.dropWaiting('stack')) {
        step(ctx, { id: 'synergy', agent: 'synergy', status: 'done', title: 'Will check your stack with your answers' });
      }
      const card = `card${++ctx.stepN}`;
      step(ctx, { id: nextId(ctx, 'ask'), agent: 'recommender', status: 'done', title: `Asked ${qs.length} question${qs.length === 1 ? '' : 's'} to tailor this` });
      ctx.gate.card(qs.map((x, i) => ({ key: `q${i}`, text: x.options.length ? `${x.q} Answers to tap: ${x.options.join(' | ')}` : x.q })), (ok) => {
        const kept = qs.filter((_, i) => ok.has(`q${i}`));
        if (kept.length) ctx.memo.push(`questions for the member: ${kept.map((x) => x.q).join(' / ')}`);
        return kept.length ? { type: 'intake', id: card, questions: kept } : null;
      });
      return ctx.gate.waiting
        ? 'The questions will be shown right after your words. If you have said what you need to, end your reply here.'
        : 'Shown. Your reply ends here; their answers come back as their next message.';
    }
  }
  return 'Unknown tool.';
}
