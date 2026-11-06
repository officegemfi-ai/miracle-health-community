// The Markers agent, plain code over the Library's body map (body.json, every line from a fact
// sheet): the blood markers each compound named may move, and, for two or more, the ones on more
// than one list, pushed the same way (their effects add up) or opposite ways (read alone, the
// marker may show neither one's effect). It's about what the compounds do in studies, never
// about the member's own results: what to ask a clinician about.
export type BodyLine = { at: string; op: string; say: string; markers?: string[]; src?: number[] };
export type Body = {
  markers: Record<string, { name: string; what?: string }>;
  compounds: Record<string, { lines?: BodyLine[]; dirs?: Record<string, string> }>;
};
export type Shared = { m: string; name: string; what: string; up: string[]; down: string[]; watch: string[] };
export type MarkerRead = { drawn: string[]; moves: Map<string, { m: string; name: string; dir: string; say: string }[]>; shared: Shared[] };

const DIRS = new Set(['up', 'down', 'watch']);
export function readMarkers(ids: string[], body: Body | null): MarkerRead {
  const moves = new Map<string, { m: string; name: string; dir: string; say: string }[]>();
  const drawn: string[] = [];
  for (const id of ids) {
    const c = body?.compounds?.[id];
    const dirs = Object.entries(c?.dirs ?? {}).filter(([m, d]) => body?.markers?.[m] && DIRS.has(d));
    if (!dirs.length) continue;
    drawn.push(id);
    moves.set(id, dirs.map(([m, d]) => ({ m, name: body!.markers[m].name, dir: d, say: (c?.lines ?? []).find((l) => (l.markers ?? []).includes(m))?.say ?? '' })));
  }
  const shared: Shared[] = [];
  const all = new Set(drawn.flatMap((id) => moves.get(id)!.map((x) => x.m)));
  for (const m of all) {
    const on = drawn.filter((id) => moves.get(id)!.some((x) => x.m === m));
    if (on.length < 2) continue;
    const dir = (id: string) => moves.get(id)!.find((x) => x.m === m)!.dir;
    shared.push({ m, name: body!.markers[m].name, what: body!.markers[m].what ?? '', up: on.filter((id) => dir(id) === 'up'), down: on.filter((id) => dir(id) === 'down'), watch: on.filter((id) => dir(id) === 'watch') });
  }
  // Pushed opposite ways first, then the same way
  shared.sort((a, b) => Number(!!(b.up.length && b.down.length)) - Number(!!(a.up.length && a.down.length)));
  return { drawn, moves, shared };
}
const listOf = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const opposed = (s: Shared) => s.up.length > 0 && s.down.length > 0;

export function markersTitle(r: MarkerRead): string {
  const o = r.shared.filter(opposed);
  if (o.length) return `${listOf(o.map((s) => s.name))}: pushed both ways`;
  const same = r.shared.filter((s) => s.up.length > 1 || s.down.length > 1);
  if (same.length) return `${listOf(same.map((s) => s.name))}: pushed the same way by more than one`;
  const n = new Set([...r.moves.values()].flat().map((x) => x.m)).size;
  return `Read ${n} blood marker${n === 1 ? '' : 's'} from the body map`;
}
// For Sig's notes: the markers that matter for these together, and what each one does alone
export function markersNote(r: MarkerRead, name: (id: string) => string): string {
  if (!r.drawn.length) return '';
  const say = (dir: string) => (dir === 'up' ? 'may raise it' : dir === 'down' ? 'may lower it' : 'calls for checking it');
  const lines = r.shared.map((s) => {
    const who = [...s.up.map((id) => `${name(id)} ${say('up')}`), ...s.down.map((id) => `${name(id)} ${say('down')}`), ...s.watch.map((id) => `${name(id)} ${say('watch')}`)].join('; ');
    const how = opposed(s) ? `Pushed opposite ways: read alone, ${s.name} may show neither one's effect.${s.what ? ` What ${s.name} is: ${s.what}` : ''}`
      : s.up.length > 1 || s.down.length > 1 ? 'Pushed the same way: their effects on it can add up.' : 'On both lists.';
    return `- ${s.name}: ${who}. ${how}`;
  });
  const alone = r.drawn.map((id) => {
    const xs = r.moves.get(id)!;
    const by = (d: string) => xs.filter((x) => x.dir === d).map((x) => x.name);
    return `- ${name(id)} alone: ${[by('up').length ? `${listOf(by('up'))} may rise` : '', by('down').length ? `${listOf(by('down'))} may fall` : '', by('watch').length ? `${listOf(by('watch'))} worth checking` : ''].filter(Boolean).join('; ')}.`;
  });
  return `Markers agent, from the Library's body map (each line from a fact sheet; the screen lists every marker, so name at most the one or two that matter most, as things to ask a clinician about, and never read or judge their own results):\n${[...lines, ...alone].join('\n')}`;
}
