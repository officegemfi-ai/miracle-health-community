// The cards the Stack builder and the community lay out on their own (not through a tool): each
// goes through the gate with its labels, and is built only from what the gate let through.
import { BLOCKED, familyOne, type Signal, UNAPPROVED } from './library.ts';
import { cleanField } from './guard.ts';
import { blockedItem, communityOf, type TopRow, type Use } from './community.ts';
import { baseItem, type CardItem, cautionFor, proven, tagFor } from './items.ts';
import { chip, type Ctx, nextId, step, voiceFor } from './context.ts';
import type { Audit } from './types.ts';

// An audit's findings as a card, after the gate has read each note
export function auditCard(a: Audit, ctx: Ctx, forCard?: string, tag?: string) {
  const findings = a.findings.map((f) => ({ ...f, names: f.ids.map((i) => ctx.byId.get(i)?.name ?? i) }));
  ctx.gate.card(findings.map((f, i) => ({ key: `f${i}`, text: f.note })), (ok) => ({
    type: 'audit', ...(forCard ? { for: forCard } : {}), ok: a.ok, summary: '',
    findings: findings.map((f, i) => (ok.has(`f${i}`) ? f : { ...f, note: f.ids.length > 1 ? 'A possible clash. Ask your clinician about this combination.' : 'Worth raising with your clinician before you start it.' })),
  }), { tag });
}

// The Stack builder's card for the compounds the member takes or named together, with the
// Synergy auditor's check attached. It shows what they have, it doesn't suggest anything: items
// on FDA's safety-risk list stay on it, plainly marked.
export function stackCard(ids: string[], a: Audit, ctx: Ctx): string | null {
  const pregnant = ctx.screen.pregnant || ctx.st.pregnant;
  const items: CardItem[] = ids.filter((id) => ctx.byId.has(id)).slice(0, 6).map((id) => {
    const it = ctx.byId.get(id)!;
    const sh = ctx.sheets.get(id);
    const key = sh?.status_us?.key ?? it.status ?? '';
    return {
      ...baseItem(it, sh, ctx, pregnant, ctx.goal),
      role: BLOCKED.has(key) ? 'On FDA’s safety-risk list' : blockedItem(it, ctx.byId) ? 'Contains a safety-risk compound'
        : UNAPPROVED.has(key) || key === 'investigational' ? 'Research stage'
        : ctx.ownMeds.has(id) ? 'Your prescription' : familyOne(it.family),
      why: cleanField(sh?.summary ?? it.summary ?? '', 180),
    };
  });
  if (!items.length) return null;
  items.forEach((i) => ctx.heard.set(i.id, i.community));
  const card = `card${++ctx.stepN}`;
  const one = items.length === 1;
  const stepId = nextId(ctx, 'bld');
  ctx.gate.card(
    items.map((i, n) => ({ key: `i${n}`, text: `${i.name}. Role: ${i.role}. About it: ${i.why}` })),
    (ok) => {
      ctx.stacks++;
      step(ctx, { id: stepId, agent: 'builder', status: 'done', title: one ? `Laid out ${items[0].name}, checked with your details` : `Laid out your stack of ${items.length}`, chips: items.map((i) => chip(i.id, ctx)) });
      const shown = items.map((i, n) => (ok.has(`i${n}`) ? i : { ...i, why: '' }));
      ctx.memo.push(`their stack: ${shown.map((i) => `${i.name} [${i.id}]`).join(', ')}`);
      return {
        type: 'shortlist', kind: 'yours', id: card, title: one ? `${shown[0].name}: to discuss with your clinician` : 'Your stack: to discuss with your clinician', note: '', goal: ctx.screen.goals[0] ?? '', items: shown,
        // Checked with the medicines they mentioned, in their words (they can keep the list on their own device)
        meds: ctx.screen.medications.map((m) => cleanField(m, 40)).filter(Boolean).slice(0, 6),
      };
    },
    { tag: 'stack' },
  );
  auditCard(a, ctx, card, 'stack');
  return card;
}

// The studies and the community on what the member named, side by side, when no stack card lays
// them out: what each says about what they asked, and which leads. All of it comes from the
// Library and the community's public totals; nothing the guide wrote.
export function voicesCard(ids: string[], ctx: Ctx): string | null {
  const items = ids.filter((id) => ctx.byId.has(id)).slice(0, 4).map((id) => {
    const it = ctx.byId.get(id)!;
    const sh = ctx.sheets.get(id);
    const v = voiceFor(id, ctx)!;
    const { tag, tone } = tagFor(it, sh, ctx.byId);
    return {
      id, name: v.name, url: `/library/${id}/`, family: familyOne(it.family), tag, tone,
      status: sh ? { key: sh.status_us.key, label: sh.status_us.label } : null,
      studies: v.studies, community: v.community, lead: v.lead,
    };
  });
  if (!items.length) return null;
  const card = `card${++ctx.stepN}`;
  ctx.gate.card([], () => {
    ctx.memo.push(`the studies and the community on ${items.map((i) => `${i.name} [${i.id}]`).join(', ')}`);
    return { type: 'voices', id: card, use: ctx.use ? { id: ctx.use.id, label: ctx.use.label } : null, items };
  }, { tag: 'voices', count: false });
  return card;
}

// Two to four compounds side by side for what the member asked: what the studies show, what the
// community reports, US status and the one caution for each. Proven options first, then in the
// order they named them; never ranked by what people report, and no winner.
export function compareCard(ids: string[], ctx: Ctx): string | null {
  const pregnant = ctx.screen.pregnant || ctx.st.pregnant;
  const note: CardItem['communityNote'] | null = pregnant ? 'pregnancy' : ctx.screen.reaction ? 'reaction' : ctx.snap.ok === false ? 'down' : !ctx.on('community') ? 'off' : null;
  const items = ids.filter((id) => ctx.byId.has(id)).slice(0, 4).map((id, order) => {
    const it = ctx.byId.get(id)!;
    const sh = ctx.sheets.get(id);
    const v = voiceFor(id, ctx)!;
    const key = sh?.status_us?.key ?? it.status ?? '';
    const { tag, tone } = tagFor(it, sh, ctx.byId);
    return {
      id, name: v.name, url: `/library/${id}/`, family: familyOne(it.family), tag, tone, order,
      status: sh ? { key: sh.status_us.key, label: sh.status_us.label } : null,
      studies: v.studies, community: note ? null : v.community, lead: v.lead, ...(note ? { communityNote: note } : {}),
      caution: cautionFor(it, sh, pregnant), proven: proven(key) === 0,
    };
  }).sort((a, b) => Number(b.proven) - Number(a.proven) || a.order - b.order).map(({ order: _o, ...i }) => i);
  if (items.length < 2) return null;
  const card = `card${++ctx.stepN}`;
  ctx.gate.card([], () => {
    ctx.memo.push(`a comparison of ${items.map((i) => `${i.name} [${i.id}]`).join(', ')}`);
    step(ctx, { id: nextId(ctx, 'cmp'), agent: 'builder', status: 'done', title: `Laid ${items.length} side by side`, chips: items.map((i) => chip(i.id, ctx)) });
    return { type: 'compare', id: card, use: ctx.use ? { id: ctx.use.id, label: ctx.use.label } : null, items };
  }, { tag: 'compare', count: false });
  return card;
}

// What the community reports most for what they want it for, when they ask: members' ratings
// first, then the public forums. What people report, never a recommendation: each shows its US
// status, and nothing on FDA's safety-risk list is ever on it.
export function crowdCard(top: TopRow[], use: Use, ctx: Ctx): string | null {
  const items = top.filter((r) => ctx.byId.has(r.id)).map((r) => {
    const it = ctx.byId.get(r.id)!;
    const { tag, tone } = tagFor(it, ctx.sheets.get(r.id), ctx.byId);
    if (!ctx.heard.has(r.id)) ctx.heard.set(r.id, communityOf(ctx.snap.signals[r.id] as Signal | undefined, use, ctx.snap.uses));
    return { ...r, url: `/library/${r.id}/`, family: familyOne(it.family), tag, tone, proven: proven(r.status) === 0 };
  });
  if (items.length < 2) return null;   // a list of one isn't a list: the guide says it in words
  const card = `card${++ctx.stepN}`;
  const p = ctx.snap.community ?? {};
  ctx.gate.card([], () => {
    ctx.memo.push(`what the community reports most for ${use.label.toLowerCase()}: ${items.map((i) => `${i.name} [${i.id}]`).join(', ')}`);
    return {
      type: 'community', id: card, use: { id: use.id, label: use.label }, items,
      crowd: { members: Math.max(0, Math.round(Number(p.members) || 0)), reports: Math.max(0, Math.round(Number(p.reports) || 0)) },
    };
  }, { tag: 'crowd' });
  return card;
}
