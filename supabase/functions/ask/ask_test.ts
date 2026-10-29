import { deepStrictEqual as assertEquals, ok as assert } from 'node:assert/strict';
import { sse, stream, tuning, canForceTool } from './claude.ts';
import { clearCache, condense, createLibrary, indexText, type Item, mentioned, rank, resolve, search, type Sheet } from './library.ts';
import { cleanField, CRISIS, redact, scan } from './guard.ts';
import { plainScreen, screenTitle, tagFor, cautionFor } from './agents.ts';
import { corsHeaders, handle, type HttpDeps, readConversation, visitorKey } from './index.ts';
import { guideSystem } from './prompts.ts';

// ---------------------------------------------------------------------------
// Fixtures: a tiny library, two fact sheets and a snapshot
// ---------------------------------------------------------------------------
const ITEMS: Item[] = [
  { id: 'creatine', name: 'Creatine monohydrate', family: 'Supplements', category: 'Muscle & performance', aliases: ['Creatine'], kind: 'compound', parts: [], sheet: true, status: 'supplement', status_label: 'Dietary supplement', grade: 'strong', goals: { muscle: 1, energy: 0.5 }, summary: 'The best-studied supplement for strength.' },
  { id: 'bpc157', name: 'BPC-157', family: 'Peptides', category: 'Healing & recovery', aliases: ['BPC'], kind: 'compound', parts: [], sheet: true, status: 'under_review', status_label: 'Not approved; compounding not yet allowed', grade: 'limited', goals: { recovery: 1, gut: 0.75 }, summary: 'A peptide fragment studied mostly in rodents.' },
  { id: 'tb500', name: 'TB-500', family: 'Peptides', category: 'Healing & recovery', aliases: ['Thymosin beta-4 fragment'], kind: 'compound', parts: [], sheet: false },
  { id: 'hmb', name: 'HMB', family: 'Supplements', category: 'Muscle & performance', aliases: [], kind: 'compound', parts: [], sheet: true, status: 'supplement', status_label: 'Dietary supplement', grade: 'moderate', goals: { muscle: 0.75 }, summary: 'A leucine metabolite.' },
  { id: 'mk677', name: 'MK-677', family: 'Peptides', category: 'Growth-hormone axis', aliases: ['Ibutamoren'], kind: 'compound', parts: [], sheet: true, status: 'category2', status_label: 'On FDA’s safety-risk list', grade: 'limited', goals: { muscle: 0.75 }, summary: 'An oral GH secretagogue.' },
  { id: 'testosterone', name: 'Testosterone', family: 'Hormones', category: 'Hormone balance', aliases: ['TRT', 'Test'], kind: 'compound', parts: [], sheet: true, status: 'approved', status_label: 'FDA-approved (Schedule III)', grade: 'strong', goals: { hormonal: 1, muscle: 0.75 }, summary: 'The main male sex hormone.' },
  { id: 'same', name: 'SAMe', family: 'Supplements', category: 'Mood & stress', aliases: ['S-adenosylmethionine'], kind: 'compound', parts: [], sheet: false },
];
const SHEET_BPC: Sheet = {
  id: 'bpc157', name: 'BPC-157', summary: 'A peptide.', what_it_is: 'A 15-amino-acid peptide studied in rodents.',
  evidence: { grade: 'limited', why: 'Mostly rodent studies.' },
  status_us: { key: 'under_review', label: 'Not approved; compounding not yet allowed', note: 'FDA has not decided.' },
  goals: { recovery: 1 }, benefits: [{ claim: 'Faster tendon healing in rodents', evidence: 'preclinical' }],
  risks: [{ risk: 'Unknown cancer risk', how_common: 'theoretical' }], avoid_if: ['Pregnant or breastfeeding'],
  interactions: ['None well documented'], labs: { before: ['CBC'], during: [], why: '' },
  ask_your_clinician: ['What does the human evidence show?'],
  sources: [{ n: 1, title: 'FDA Briefing Document', publisher: 'FDA', year: 2026, url: 'https://www.fda.gov/x' }],
};
const SHEET_CREATINE: Sheet = {
  ...SHEET_BPC, id: 'creatine', name: 'Creatine monohydrate', what_it_is: 'A compound muscles use for quick energy.',
  evidence: { grade: 'strong', why: 'Many trials.' }, status_us: { key: 'supplement', label: 'Dietary supplement', note: '' },
  benefits: [{ claim: 'More strength gains with resistance training in adults', evidence: 'strong' }],
};
const SNAPSHOT = {
  signals: {
    bpc157: { score: 71.2, certification: 'backed', first_hand: 14, outcomes: { better: 10, same: 3, worse: 1, better_pct: 71 }, side_effects: [{ effect: 'Nausea', n: 3 }], by_use: [{ use: 'injury', rating: 78, reports: 9 }] },
    creatine: { score: 80, certification: 'forum' },
  },
  uses: { injury: ['Injury healing', 'recovery'] },
};

function libFetch(): typeof fetch {
  return (async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith('/index.json')) return new Response(JSON.stringify({ items: ITEMS }));
    if (u.endsWith('/entries/bpc157.json')) return new Response(JSON.stringify(SHEET_BPC));
    if (u.endsWith('/entries/creatine.json')) return new Response(JSON.stringify(SHEET_CREATINE));
    if (u.includes('/entries/')) return new Response('not found', { status: 404 });
    if (u.endsWith('snapshot.json')) return new Response(JSON.stringify(SNAPSHOT));
    return new Response('?', { status: 500 });
  }) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// A pretend Claude: forms answer with a tool call, the guide streams scripted rounds
// ---------------------------------------------------------------------------
type Round = { text?: string; tool?: { name: string; input: unknown }; stop?: string };
function sseBody(round: Round): string {
  const ev = (o: unknown) => `event: x\ndata: ${JSON.stringify(o)}\n\n`;
  let s = ev({ type: 'message_start', message: { usage: { input_tokens: 10, cache_read_input_tokens: 5 } } });
  s += ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } });
  s += ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '' } });
  s += ev({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig123' } });
  s += ev({ type: 'content_block_stop', index: 0 });
  let i = 1;
  if (round.text) {
    s += ev({ type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } });
    for (const part of round.text.match(/.{1,7}/gs) ?? []) s += ev({ type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: part } });
    s += ev({ type: 'content_block_stop', index: i });
    i++;
  }
  if (round.tool) {
    const js = JSON.stringify(round.tool.input);
    s += ev({ type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: `tu${i}`, name: round.tool.name, input: {} } });
    s += ev({ type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: js.slice(0, 9) } });
    s += ev({ type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: js.slice(9) } });
    s += ev({ type: 'content_block_stop', index: i });
  }
  s += ev({ type: 'message_delta', delta: { stop_reason: round.stop ?? (round.tool ? 'tool_use' : 'end_turn') }, usage: { output_tokens: 42 } });
  s += ev({ type: 'message_stop' });
  return s;
}

type Script = { screen?: unknown; audit?: unknown; review?: unknown; rounds: Round[]; failGuide?: number };
function fakeWorld(script: Script) {
  const calls: { kind: string; body: Record<string, unknown> }[] = [];
  let round = 0;
  const lib = libFetch();
  const f = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (!u.startsWith('https://api.anthropic.com')) return lib(url, init);
    const body = JSON.parse(String(init?.body));
    const tools = (body.tools ?? []) as { name: string }[];
    const form = (name: string, input: unknown) => new Response(JSON.stringify({ content: [{ type: 'tool_use', id: 't', name, input }], stop_reason: 'tool_use', usage: {} }));
    if (tools.some((t) => t.name === 'screen')) { calls.push({ kind: 'screen', body }); return form('screen', script.screen); }
    if (tools.some((t) => t.name === 'audit')) { calls.push({ kind: 'audit', body }); return form('audit', script.audit ?? { findings: [], summary: 'Nothing known.' }); }
    if (tools.some((t) => t.name === 'review')) { calls.push({ kind: 'review', body }); return form('review', 'review' in script ? script.review : { ok: true }); }
    calls.push({ kind: 'guide', body });
    if (script.failGuide && script.failGuide-- > 0) return new Response(JSON.stringify({ error: { type: 'not_found_error', message: 'model: nope' } }), { status: 404 });
    const r = script.rounds[Math.min(round++, script.rounds.length - 1)];
    return new Response(sseBody(r), { headers: { 'content-type': 'text/event-stream' } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const NONE = { red_flag: 'none', compounds: [], goals: [], medications: [], conditions: [], pregnant: false, tested_athlete: false, asks_dose: false, asks_source: false, note: '' };

function deps(f: typeof fetch, over: Partial<HttpDeps> = {}): HttpDeps {
  clearCache();
  return {
    origins: ['https://miraclehealth.us'],
    apiKey: 'k',
    models: { guide: 'claude-sonnet-5-5', fast: 'claude-haiku-5-5', fallback: 'claude-haiku-5-5' },
    library: createLibrary({ base: 'https://miraclehealth.us/library/data', snapshotUrl: 'https://community.miraclehealth.us/snapshot.json', fetchImpl: f }),
    salt: 'salt',
    quota: async () => ({ ok: true, left: 39 }),
    fetchImpl: f,
    ...over,
  };
}
const ask = (messages: unknown, origin = 'https://miraclehealth.us') =>
  new Request('https://x.supabase.co/functions/v1/ask', { method: 'POST', headers: { Origin: origin, 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' }, body: JSON.stringify({ messages }) });

async function events(res: Response): Promise<{ event: string; data: Record<string, any> }[]> {
  const out = [];
  for await (const e of sse(res.body!)) out.push({ event: e.event, data: JSON.parse(e.data) });
  return out;
}

// ---------------------------------------------------------------------------
// Claude client
// ---------------------------------------------------------------------------
Deno.test('a stream comes back as blocks: thinking with its signature, text, a tool call with its input', async () => {
  const f = (async () => new Response(sseBody({ text: 'Hello there.', tool: { name: 'read_fact_sheets', input: { ids: ['bpc157'] } } }))) as unknown as typeof fetch;
  let seen = '';
  const r = await stream({ model: 'm' }, { apiKey: 'k', fetchImpl: f, onText: (t) => { seen += t; } });
  assertEquals(seen, 'Hello there.');
  assertEquals(r.stop, 'tool_use');
  assertEquals(r.content.map((b) => b.type), ['thinking', 'text', 'tool_use']);
  assertEquals(r.content[0].signature, 'sig123');
  assertEquals(r.content[2].input, { ids: ['bpc157'] });
});

Deno.test('5.x models get low effort; forms turn thinking off only where allowed', () => {
  assertEquals(tuning('claude-sonnet-5-5'), { output_config: { effort: 'low' } });
  assertEquals(tuning('claude-haiku-5-5', { form: true }), { output_config: { effort: 'low' }, thinking: { type: 'disabled' } });
  assertEquals(tuning('claude-haiku-4-5', { form: true }), {});
  assert(canForceTool('claude-haiku-5-5') && canForceTool('claude-haiku-4-5') && !canForceTool('claude-sonnet-5-5'));
});

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------
Deno.test('names resolve to Library ids, everyday words never do', () => {
  assertEquals(resolve(ITEMS, ['bpc 157', 'TB500', 'creatine', 'nothing here']), ['bpc157', 'tb500', 'creatine']);
  assertEquals(mentioned(ITEMS, 'Is BPC-157 ok with creatine? Same as before, just a test.'), ['creatine', 'bpc157']);
  assertEquals(mentioned(ITEMS, 'I was on TRT for a year'), ['testosterone']);
  assertEquals(search(ITEMS, 'thymosin')[0].id, 'tb500');
});

Deno.test('the ranking puts proven options first and marks the ones never to shortlist', () => {
  const r = rank(ITEMS, SNAPSHOT.signals as never, 'muscle');
  assertEquals(r.map((o) => o.id), ['creatine', 'testosterone', 'hmb', 'mk677']);
  assert(r.find((o) => o.id === 'mk677')!.gate!.includes('Never on a shortlist'));
  assert(r.find((o) => o.id === 'testosterone')!.gate!.includes('prescription hormone'));
});

Deno.test('a condensed fact sheet carries status, evidence, risks and the Signal, and no URLs', () => {
  const t = condense(SHEET_BPC, ITEMS[1], SNAPSHOT.signals.bpc157 as never, SNAPSHOT.uses as never);
  for (const s of ['Not approved; compounding not yet allowed', 'Evidence: limited', 'Unknown cancer risk', 'Community Signal: 71.2/100', 'Community-backed', 'Injury healing 78', 'Nausea (3)']) assert(t.includes(s), s);
  assert(!t.includes('https://'));
  const idx = indexText(ITEMS);
  assert(idx.includes('BPC-157 [bpc157]*') && idx.includes('TB-500 [tb500]') && !idx.includes('TB-500 [tb500]*'));
});

// ---------------------------------------------------------------------------
// Plain checks
// ---------------------------------------------------------------------------
Deno.test('the plain checks catch amounts, schedules, outside links and sales talk', () => {
  const hits = scan('Take 250 mcg twice a day, or 5 g. Buy it from https://shop.example.com with discount code X.').map((h) => h.kind);
  for (const k of ['dose', 'schedule', 'link', 'sales']) assert(hits.includes(k as never), k);
  assertEquals(scan('Vitamin B12, omega-3, GLP-1, CoQ10 and 5-HTP; a trial of 53 people lost 15% of body weight.'), []);
  assertEquals(scan('See [BPC-157](lib:bpc157) and https://miraclehealth.us/library/'), []);
  assert(redact('Use 2.5mg weekly').includes('[amount removed]'));
  assertEquals(cleanField('Strong evidence: 5 g a day <b>helps</b>', 80), 'Strong evidence: a day helps');
});

Deno.test('crisis words are caught; a gym injury is not', () => {
  assert(CRISIS.test('honestly I want to die'));
  assert(CRISIS.test('thinking about ending my life'));
  assert(!CRISIS.test('I hurt myself deadlifting and want to heal faster'));
  assertEquals(plainScreen('I want to kill myself').red_flag, 'self_harm');
  assertEquals(plainScreen('my chest pain started an hour ago').red_flag, 'emergency');
});

Deno.test('card tags and cautions follow US status and family', () => {
  assertEquals(tagFor(ITEMS[1], SHEET_BPC).tag, 'Not approved');
  assertEquals(tagFor(ITEMS[0], SHEET_CREATINE), { tag: 'Supplement', tone: 'ok' });
  assertEquals(tagFor(ITEMS[2], null), { tag: 'No fact sheet yet', tone: 'none' });
  const s = { ...plainScreen(''), pregnant: true };
  assert(cautionFor(ITEMS[5], null, s).startsWith('A prescription hormone: only after testing'));
  assert(cautionFor(ITEMS[1], SHEET_BPC, s).includes('obstetric'));
  assert(screenTitle({ ...plainScreen(''), ok: true, asks_dose: true }).includes('asked for a dose'));
});

Deno.test('the guide is told the rules and the Library', () => {
  const s = guideSystem(indexText(ITEMS));
  for (const k of ['No doses', 'No sellers', '988', '911', 'under 18', 'lib:bpc157', 'BPC-157 [bpc157]*', 'clinician']) assert(s.includes(k), k);
});

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------
Deno.test('the conversation is tidied: alternating, ends with the member, limits kept', () => {
  const r = readConversation({ messages: [{ role: 'assistant', content: 'hi' }, { role: 'user', content: 'a' }, { role: 'user', content: 'b\u0007' }, { role: 'system', content: 'x' }] });
  assert('messages' in r);
  assertEquals((r as { messages: unknown }).messages, [{ role: 'user', content: 'a\n\nb' }]);
  assertEquals((readConversation({ messages: [{ role: 'user', content: 'x'.repeat(2001) }] }) as { status: number }).status, 413);
  assertEquals((readConversation({ messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }] }) as { status: number }).status, 400);
  assertEquals((readConversation({}) as { status: number }).status, 400);
});

Deno.test('a visitor key is a daily HMAC, never the address', async () => {
  const req = new Request('https://x', { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } });
  const a = await visitorKey(req, 's', '2026-10-30');
  const b = await visitorKey(req, 's', '2026-10-31');
  assert(/^[0-9a-f]{64}$/.test(a) && a !== b && !a.includes('203'));
});

Deno.test('only our own site may call it; preflight answers', async () => {
  const { f } = fakeWorld({ screen: NONE, rounds: [{ text: 'x' }] });
  const d = deps(f);
  assertEquals((await handle(ask([{ role: 'user', content: 'hi' }], 'https://evil.example'), d)).status, 403);
  const pre = await handle(new Request('https://x', { method: 'OPTIONS', headers: { Origin: 'https://miraclehealth.us' } }), d);
  assertEquals(pre.status, 204);
  assertEquals(pre.headers.get('Access-Control-Allow-Origin'), 'https://miraclehealth.us');
  assertEquals(corsHeaders(new Request('https://x', { headers: { Origin: 'https://evil.example' } }), ['https://miraclehealth.us'])['Access-Control-Allow-Origin'], 'https://miraclehealth.us');
});

Deno.test('over the limit: a clear 429, and Claude is never called', async () => {
  const { f, calls } = fakeWorld({ screen: NONE, rounds: [{ text: 'x' }] });
  const res = await handle(ask([{ role: 'user', content: 'hi' }]), deps(f, { quota: async () => ({ ok: false, reason: 'visitor_day' }) }));
  assertEquals(res.status, 429);
  assert((await res.json()).error.includes('tomorrow'));
  assertEquals(calls.length, 0);
  const res2 = await handle(ask([{ role: 'user', content: 'hi' }]), deps(f, { quota: async () => { throw new Error('db down'); } }));
  assertEquals(res2.status, 503);
});

Deno.test('a full turn: screen, lookup, audit, streamed answer, shortlist with its audit, questions, final check', async () => {
  const { f, calls } = fakeWorld({
    screen: { ...NONE, compounds: ['BPC-157', 'creatine'], goals: ['recovery'], medications: ['sertraline'] },
    audit: { findings: [{ ids: ['bpc157', 'creatine'], kind: 'additive', level: 'caution', note: 'Little is known about them together.' }], summary: 'One caution.' },
    rounds: [
      { text: 'Here is what the Library says about [BPC-157](lib:bpc157). ', tool: { name: 'present_shortlist', input: { title: 'For tendon recovery', items: [{ id: 'creatine', role: 'Best-studied supplement', why: 'Strong evidence for strength; take 5 g daily' }, { id: 'bpc157', role: 'Research stage', why: 'Rodent data only' }, { id: 'mk677', role: 'x', why: 'y' }, { id: 'nope', role: 'x', why: 'y' }] } } },
      { tool: { name: 'clinician_questions', input: { questions: ['Is BPC-157 worth the unknowns for my tendon?', 'Where can I buy it?'] } } },
      { text: 'The auditor flagged one caution.' },
    ],
  });
  const res = await handle(ask([{ role: 'user', content: 'I take sertraline. Is BPC-157 with creatine good for my tendon?' }]), deps(f));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Content-Type'), 'text/event-stream; charset=utf-8');
  const ev = await events(res);
  const kinds = ev.map((e) => e.event);
  assertEquals(kinds[0], 'meta');
  assertEquals(kinds[kinds.length - 1], 'done');
  const steps = ev.filter((e) => e.event === 'step').map((e) => `${e.data.agent}:${e.data.status}`);
  for (const s of ['safety:run', 'safety:done', 'recommender:done', 'synergy:run', 'synergy:done', 'builder:done', 'review:done', 'clinician:pending']) assert(steps.includes(s), s);
  const text = ev.filter((e) => e.event === 'text').map((e) => e.data.d).join('');
  assert(text.startsWith('Here is what the Library says') && text.includes('\n\nThe auditor flagged'));
  const short = ev.find((e) => e.event === 'card' && e.data.type === 'shortlist')!.data;
  assertEquals(short.items.map((i: { id: string }) => i.id), ['creatine', 'bpc157']);           // MK-677 removed, unknown dropped
  assertEquals(short.items[0].why, 'Strong evidence for strength; take daily');                   // the amount is gone
  assertEquals(short.items[1].tag, 'Not approved');
  assert(short.items[1].signal.score === 71.2);
  const audits = ev.filter((e) => e.event === 'card' && e.data.type === 'audit');
  assert(audits.length >= 1 && audits.some((a) => a.data.for === short.id));
  const qs = ev.find((e) => e.event === 'card' && e.data.type === 'questions')!.data.items;
  assertEquals(qs, ['Is BPC-157 worth the unknowns for my tendon?']);                             // no sourcing questions
  assertEquals(ev.find((e) => e.event === 'review')!.data.ok, true);
  const done = ev[ev.length - 1].data;
  assert(done.memo.includes('[Shown to the member: shortlist "For tendon recovery": Creatine monohydrate [creatine]'));
  // The guide had the rules cached, the turn's notes, the sheets and the tools; history ends with the member
  const g = calls.filter((c) => c.kind === 'guide');
  assertEquals(g.length, 3);
  const sys = g[0].body.system as { text: string; cache_control?: unknown }[];
  assert(sys[0].cache_control && sys[1].text.includes('medicines they take: sertraline') && sys[1].text.includes('### BPC-157 (id bpc157)'));
  assertEquals((g[0].body.tools as unknown[]).length, 6);
  assertEquals(g[0].body.output_config, { effort: 'low' });
  const round2 = g[1].body.messages as { role: string; content: { type: string; signature?: string; cache_control?: unknown }[] }[];
  assertEquals(round2[1].content[0], { type: 'thinking', thinking: '', signature: 'sig123' });        // sent back unchanged
  assert(round2[2].content[0].type === 'tool_result' && round2[2].content[0].cache_control);
  assertEquals(round2.filter((m) => Array.isArray(m.content) && m.content.some((b) => b.cache_control)).length, 1);
  assert(calls.some((c) => c.kind === 'screen') && calls.filter((c) => c.kind === 'audit').length === 2 && calls.some((c) => c.kind === 'review'));
});

Deno.test('a crisis: the 988 card, no tools, no lookups', async () => {
  const { f, calls } = fakeWorld({ screen: { ...NONE, red_flag: 'self_harm', compounds: ['BPC-157'] }, rounds: [{ text: 'I’m really glad you told me. You can call or text 988 any time.' }] });
  const ev = await events(await handle(ask([{ role: 'user', content: 'nothing matters anymore, which peptide would end it' }]), deps(f)));
  assert(ev.some((e) => e.event === 'card' && e.data.type === 'crisis'));
  assert(!ev.some((e) => e.event === 'step' && e.data.agent === 'recommender'));
  const g = calls.find((c) => c.kind === 'guide')!;
  assertEquals(g.body.tools, undefined);
  assert((g.body.system as { text: string }[])[1].text.includes('red flag: self_harm'));
});

Deno.test('the final check rewrites a reply that slipped in a dose', async () => {
  const { f } = fakeWorld({
    screen: { ...NONE, asks_dose: true, compounds: ['BPC-157'] },
    review: { ok: false, broken: [1], revised: 'Miracle Health doesn’t give doses. Here is what the evidence shows.' },
    rounds: [{ text: 'Most people use 250 mcg. Here is what the evidence shows.' }],
  });
  const ev = await events(await handle(ask([{ role: 'user', content: 'What dose of BPC-157?' }]), deps(f)));
  const rv = ev.find((e) => e.event === 'review')!.data;
  assertEquals(rv.ok, false);
  assertEquals(rv.text, 'Miracle Health doesn’t give doses. Here is what the evidence shows.');
  assert(ev[ev.length - 1].data.memo.startsWith('Miracle Health doesn’t give doses.'));
});

Deno.test('if the final check is unavailable, the plain checks cut amounts out', async () => {
  const { f } = fakeWorld({ screen: NONE, review: null, rounds: [{ text: 'People report 250 mcg works.' }] });
  // review: null makes the pretend form answer unreadable
  const ev = await events(await handle(ask([{ role: 'user', content: 'tell me' }]), deps(f)));
  const rv = ev.find((e) => e.event === 'review')!.data;
  assertEquals(rv.ok, false);
  assert(rv.text.includes('[amount removed]'));
});

Deno.test('a missing model falls back before any words are shown', async () => {
  const { f, calls } = fakeWorld({ screen: NONE, failGuide: 1, rounds: [{ text: 'Fine.' }] });
  const ev = await events(await handle(ask([{ role: 'user', content: 'hi' }]), deps(f)));
  const g = calls.filter((c) => c.kind === 'guide');
  assertEquals(g.map((c) => c.body.model), ['claude-sonnet-5-5', 'claude-haiku-5-5']);
  assertEquals(ev.filter((e) => e.event === 'text').map((e) => e.data.d).join(''), 'Fine.');
});

Deno.test('when the Safety agent fails, the plain checks still screen and the turn goes on', async () => {
  const { f } = fakeWorld({ screen: null, rounds: [{ text: 'Sure.' }] });
  const ev = await events(await handle(ask([{ role: 'user', content: 'what helps sleep?' }]), deps(f)));
  const s = ev.find((e) => e.event === 'step' && e.data.id === 'safety' && e.data.status === 'done')!.data;
  assertEquals(s.title, 'Screened with the plain checks');
  assertEquals(ev[ev.length - 1].event, 'done');
});
