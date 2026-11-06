#!/usr/bin/env python3
"""The Library watch: an agent that searches PubMed for studies in people of each Library compound
(and of the drug it's part of) that report an effect on a blood marker, and that its fact sheet
doesn't cite yet, and lists them in one issue to review. Nothing goes into a fact sheet from here:
each study is either added to the sheet by an editor, with what it found and who was studied, or
added to `seen` in the site's library/data/watch.json with why it was left out.

A study naming a marker its sheet doesn't mention at all comes first: that's a gap (enclomiphene and
IGF-1 was one), not just more evidence.

Usage: scripts/library_watch.py --site <miraclehealth-site checkout> [--backfill] [--only id,id]
       [--per 20] [--days 45] [--out DIR] [--issue]

Weekly, it looks at what PubMed added in the last --days; with --backfill, at every year, the --per
most relevant studies per compound. With ANTHROPIC_API_KEY set, Claude (WATCH_MODEL, Haiku by
default) reads each abstract and says which marker moved which way, in whom; without it, a plain
check keeps abstracts that name a marker in a sentence that says it changed.
"""
import argparse
import concurrent.futures as cf
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
TOOL = 'miracle-health-library-watch'
ISSUE_TITLE = 'Library watch: studies to review'
LABEL = 'library-watch'
# Names that are a class of drugs, not the compound: they'd bring in every other member's studies
CLASSY = re.compile(r'\b(?:inhibitors?|analogs?|analogues?|agonists?|antagonists?|blockers?|modulators?|class|bioregulators?|supplements?|peptides?|compounds?|hormones?)\b', re.I)
CHANGE = re.compile(r'\b(?:increas\w*|decreas\w*|reduc\w*|rais\w*|lower\w*|elevat\w*|declin\w*|fell|fall\w*|rose|rise|rising|drop\w*|suppress\w*|higher|improv\w*|worsen\w*|chang\w*|normali[sz]\w*)\b', re.I)
UP = re.compile(r'\b(?:increas\w*|rais\w*|elevat\w*|rose|rise|rising|higher)\b', re.I)
DOWN = re.compile(r'\b(?:decreas\w*|reduc\w*|lower\w*|declin\w*|fell|fall\w*|drop\w*|suppress\w*)\b', re.I)


# ---------------------------------------------------------------------------
# PubMed
# ---------------------------------------------------------------------------
_last = [0.0]


def _get(path, params, tries=4):
    """One E-utilities call, at most three a second (NCBI's limit without a key), retried on errors"""
    params = {**params, 'tool': TOOL}
    if os.environ.get('NCBI_API_KEY'):
        params['api_key'] = os.environ['NCBI_API_KEY']
    data = urllib.parse.urlencode(params).encode()
    for attempt in range(tries):
        wait = 0.36 - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        try:
            req = urllib.request.Request(f'{EUTILS}/{path}', data=data, method='POST')
            with urllib.request.urlopen(req, timeout=60) as res:
                return res.read()
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt == tries - 1:
                raise
            time.sleep(2 * (attempt + 1))
            print(f'  retrying {path}: {e}', file=sys.stderr)
    return b''


def quoted(names):
    return ' OR '.join(f'"{n}"[tiab]' for n in names)


def query(names, markers):
    # In people: everything but studies indexed as animal-only (new papers aren't indexed yet)
    return f'({quoted(names)}) AND ({quoted([t for m in markers for t in m["terms"]])}) NOT (animals[mh] NOT humans[mh])'


def esearch(term, retmax, days=None):
    params = {'db': 'pubmed', 'term': term, 'retmax': str(retmax), 'sort': 'relevance', 'retmode': 'json'}
    if days:
        params.update({'reldate': str(days), 'datetype': 'edat'})
    return json.loads(_get('esearch.fcgi', params) or b'{}').get('esearchresult', {}).get('idlist', [])


def text_of(el):
    return ' '.join(''.join(el.itertext()).split()) if el is not None else ''


def parse_articles(xml_bytes):
    """PubMed XML to the fields the watch reads"""
    out = []
    root = ET.fromstring(xml_bytes)
    for art in root.iter('PubmedArticle'):
        cit = art.find('MedlineCitation')
        a = cit.find('Article') if cit is not None else None
        if a is None:
            continue
        abstract = ' '.join(
            (f'{p.get("Label")}: ' if p.get('Label') else '') + text_of(p) for p in a.findall('Abstract/AbstractText'))
        year = a.findtext('Journal/JournalIssue/PubDate/Year') or (a.findtext('Journal/JournalIssue/PubDate/MedlineDate') or '')[:4]
        ids = {i.get('IdType'): (i.text or '').strip() for i in art.findall('PubmedData/ArticleIdList/ArticleId')}
        out.append({
            'pmid': cit.findtext('PMID', '').strip(), 'title': text_of(a.find('ArticleTitle')), 'abstract': abstract,
            'journal': a.findtext('Journal/ISOAbbreviation') or a.findtext('Journal/Title') or '', 'year': year,
            'types': [text_of(t) for t in a.findall('PublicationTypeList/PublicationType')],
            'doi': ids.get('doi', '').lower(), 'pmc': ids.get('pmc', '').upper(),
        })
    return out


def efetch(pmids):
    arts = []
    for i in range(0, len(pmids), 150):
        raw = _get('efetch.fcgi', {'db': 'pubmed', 'id': ','.join(pmids[i:i + 150]), 'retmode': 'xml'})
        if raw:
            arts += parse_articles(raw)
    return arts


# ---------------------------------------------------------------------------
# The Library
# ---------------------------------------------------------------------------
def names_of(item, skip):
    """What PubMed may call a compound: its name, the short name in brackets, and its aliases, but
    not a drug class or a word too common to search on its own"""
    name = item['name']
    out = [re.sub(r'\s*\([^)]*\)', '', name).strip()]
    out += [m.strip() for m in re.findall(r'\(([^)]{3,40})\)', name)]
    for a in item.get('aliases') or []:
        a = str(a).strip()
        if len(a) >= 4 and not CLASSY.search(a) and a.lower() not in skip:
            out.append(a)
    seen, names = set(), []
    for n in out:
        k = n.lower()
        if n and k not in seen and k not in skip:
            seen.add(k)
            names.append(n.replace('"', ''))
    return names[:8]


def norm(t):
    return re.sub(r'[^a-z0-9]+', ' ', str(t).lower()).strip()


def cited(sheet):
    """What a fact sheet already cites: PubMed and PMC ids, DOIs and titles"""
    ids, titles = set(), set()
    for s in sheet.get('sources') or []:
        url = str(s.get('url', ''))
        for rx, pre in ((r'pubmed\.ncbi\.nlm\.nih\.gov/(\d+)', ''), (r'(PMC\d+)', ''), (r'doi\.org/(10\.[^\s?#]+)', '')):
            m = re.search(rx, url, re.I)
            if m:
                ids.add(pre + m.group(1).upper() if m.group(1).upper().startswith('PMC') else pre + m.group(1).lower())
        titles.add(norm(s.get('title', '')))
    for s in sheet.get('studies') or []:
        titles.add(norm(s.get('title', '')))
    return ids, {t for t in titles if len(t) > 20}


def is_cited(art, ids, titles):
    return art['pmid'] in ids or (art['pmc'] and art['pmc'] in ids) or (art['doi'] and art['doi'] in ids) or norm(art['title']) in titles


def sheet_mentions(sheet, marker):
    """Whether a sheet says anything about a marker anywhere (its risks, findings, labs, studies)"""
    blob = json.dumps({k: sheet.get(k) for k in ('summary', 'what_it_is', 'benefits', 'risks', 'labs', 'studies', 'interactions')}, ensure_ascii=False)
    return re.search(marker['match'], blob, re.I) is not None


# ---------------------------------------------------------------------------
# Reading each abstract
# ---------------------------------------------------------------------------
def plain_read(art, markers):
    """Without a model: a marker named in a sentence that says something changed, and which way"""
    effects = []
    for sentence in re.split(r'(?<=[.;])\s+', f'{art["title"]}. {art["abstract"]}'):
        if not CHANGE.search(sentence):
            continue
        for m in markers:
            if re.search(m['match'], sentence, re.I) and not any(e['marker'] == m['id'] for e in effects):
                up, down = bool(UP.search(sentence)), bool(DOWN.search(sentence))
                effects.append({'marker': m['id'], 'direction': 'up' if up and not down else 'down' if down and not up else 'unclear', 'who': '', 'design': ''})
    return {'relevant': bool(effects), 'effects': effects, 'by': 'plain check'}


READ_TOOL = {
    'name': 'read_study',
    'description': 'Record what this study found about the compound and blood markers.',
    'input_schema': {
        'type': 'object',
        'properties': {
            'relevant': {'type': 'boolean', 'description': 'True only if the study measured, in people, an effect of this compound (or the drug named) on at least one of the listed markers.'},
            'given': {'type': 'boolean', 'description': 'True if people in the study were given this compound (or the drug named); false if it was only a comparator, a background treatment, or mentioned.'},
            'effects': {'type': 'array', 'maxItems': 6, 'items': {'type': 'object', 'properties': {
                'marker': {'type': 'string', 'description': 'One of the marker ids listed.'},
                'direction': {'type': 'string', 'enum': ['up', 'down', 'no change', 'mixed']},
                'who': {'type': 'string', 'description': 'Who was studied, at most 12 words (for example "20 men treated for low testosterone").'},
                'design': {'type': 'string', 'description': 'The design, at most 6 words (for example "retrospective study", "randomized trial").'},
            }, 'required': ['marker', 'direction', 'who', 'design']}},
        },
        'required': ['relevant', 'given', 'effects'],
    },
}


def claude_read(art, compound, via, markers, key, model):
    listing = '\n'.join(f'- {m["id"]}: {m["name"]}' for m in markers)
    prompt = (f'Compound: {compound}{f" (searched through {via})" if via else ""}\n\nBlood markers:\n{listing}\n\n'
              f'<study>\nTitle: {art["title"]}\nJournal: {art["journal"]} {art["year"]}\nAbstract: {art["abstract"][:5000]}\n</study>\n\n'
              'Did this study measure, in people, an effect of the compound (or the drug named) on any of these markers? '
              'Record each marker it reports for this compound, which way it moved and in whom. Animal or lab studies, reviews that report no new '
              'measurement, and studies where the compound is only a comparator, a background treatment or a mention are not relevant: '
              'an effect of another drug in the same study is not this compound\'s. Read only what the abstract says.')
    body = json.dumps({'model': model, 'max_tokens': 500, 'tools': [READ_TOOL], 'tool_choice': {'type': 'tool', 'name': 'read_study'},
                       'messages': [{'role': 'user', 'content': prompt}]}).encode()
    req = urllib.request.Request('https://api.anthropic.com/v1/messages', data=body, method='POST', headers={
        'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=90) as res:
                data = json.loads(res.read().decode('utf-8'))
            use = next((c for c in data.get('content', []) if c.get('type') == 'tool_use'), None)
            if use:
                ids = {m['id'] for m in markers}
                g = use['input']
                effects = [{'marker': e.get('marker'), 'direction': e.get('direction', 'mixed'), 'who': str(e.get('who', ''))[:120], 'design': str(e.get('design', ''))[:60]}
                           for e in g.get('effects') or [] if e.get('marker') in ids]
                return {'relevant': bool(g.get('relevant')) and g.get('given') is not False and bool(effects), 'effects': effects, 'by': 'Claude'}
        except urllib.error.HTTPError as e:
            if e.code in (400, 401, 403, 404):
                break
            time.sleep(5 * (attempt + 1))
        except Exception:
            time.sleep(5 * (attempt + 1))
    return None


# ---------------------------------------------------------------------------
# The review issue
# ---------------------------------------------------------------------------
ARROW = {'up': '↑', 'down': '↓', 'no change': '=', 'mixed': '↕', 'unclear': '?'}
# What to review first: the stronger the design, the more a marker matters for safety, the newer
SAFETY = {'liver', 'kidney', 'hematocrit', 'glucose', 'psa', 'igf1', 'lipids', 'prolactin'}


def strength(f):
    text = ' '.join([f['title']] + [e.get('design', '') for e in f['effects']])
    design = 3 if re.search(r'meta-analys|systematic review', text, re.I) else 2 if re.search(r'randomi[sz]ed|placebo|\bRCT\b|controlled trial', text, re.I) \
        else 0 if re.search(r'case report', text, re.I) else 1
    moved = [e for e in f['effects'] if e['gap'] and e['direction'] in ('up', 'down')]
    return design + (1 if any(e['marker'] in SAFETY for e in moved) else 0) + (0.5 if moved else 0) + (0.5 if (f['year'] or '0') >= '2015' else 0)


def render(found, markers, mode, by, counts):
    name = {m['id']: m['name'] for m in markers}
    gaps = sorted([f for f in found if any(e['gap'] for e in f['effects'])], key=strength, reverse=True)
    more = [f for f in found if not any(e['gap'] for e in f['effects'])]
    first = [f for f in gaps if strength(f) >= 3.5][:30]

    def line(f):
        fx = ', '.join(f'**{name[e["marker"]]} {ARROW.get(e["direction"], "?")}**{" (not on its sheet)" if e["gap"] else ""}' for e in f['effects'])
        who = '; '.join(sorted({x for e in f['effects'] for x in (e.get('who'), e.get('design')) if x}))[:160]
        via = f' (via {f["via"]})' if f['via'] else ''
        return f'- [ ] {fx} · {f["title"][:200]} ({f["journal"]}, {f["year"]}){f" · {who}" if who else ""} · [PubMed {f["pmid"]}](https://pubmed.ncbi.nlm.nih.gov/{f["pmid"]}/){via}'

    def section(rows):
        out, cur = [], None
        for f in sorted(rows, key=lambda x: (x['name'].lower(), -strength(x))):
            if f['name'] != cur:
                cur = f['name']
                out.append(f'\n**[{cur}](https://miraclehealth.us/library/{f["id"]}/)**')
            out.append(line(f))
        return out

    head = [
        f'Studies in people that report an effect on a blood marker, found by the Library watch ({mode}; abstracts read by {by}), that the compound\'s fact sheet doesn\'t cite yet. '
        'For each: add it to the fact sheet (and the body map) with what it found and who was studied, or add its PubMed id to `seen` in '
        '[library/data/watch.json](https://github.com/officegemfi-ai/miraclehealth-site/blob/main/library/data/watch.json) with why it was left out. '
        'Nothing reaches Sig or the screen until it\'s in a fact sheet.',
        '',
        f'Searched {counts["compounds"]} compounds; {counts["new"]} studies not cited yet; {counts["kept"]} report an effect on a marker.',
        '',
        f'### Review these first ({len(first)})',
        'Markers their sheets don\'t mention at all, from the strongest studies (meta-analyses and randomized trials first), on markers that matter most for safety.',
        *(section(first) or ['\nNone this time.']),
        '',
        f'### The rest on markers their sheets don\'t mention ({len(gaps) - len(first)})',
        *(section([f for f in gaps if f not in first]) or ['\nNone this time.']),
        '',
        f'<details><summary>More evidence on markers their sheets already mention ({len(more)})</summary>',
        '',
        *(section(more) or ['None this time.']),
        '',
        '</details>',
    ]
    body = '\n'.join(head)
    return body if len(body) < 60000 else body[:59000] + '\n\n…cut here: the full list is in the run\'s summary and its saved results.'


def upsert_issue(body):
    repo, token = os.environ.get('GH_REPO') or os.environ.get('GITHUB_REPOSITORY'), os.environ.get('GITHUB_TOKEN')
    if not repo or not token:
        print('No GitHub repo or token: the issue was not written.', file=sys.stderr)
        return None
    api = f'https://api.github.com/repos/{repo}'
    hdr = {'authorization': f'Bearer {token}', 'accept': 'application/vnd.github+json', 'content-type': 'application/json'}

    def call(method, url, data=None):
        req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None, method=method, headers=hdr)
        with urllib.request.urlopen(req, timeout=60) as res:
            return json.loads(res.read().decode('utf-8') or 'null')
    try:
        call('POST', f'{api}/labels', {'name': LABEL, 'color': 'D8FF3D', 'description': 'Studies the Library watch found for review'})
    except urllib.error.HTTPError:
        pass   # it's there already
    issues = call('GET', f'{api}/issues?labels={LABEL}&state=open&per_page=5') or []
    issue = next((i for i in issues if i.get('title') == ISSUE_TITLE), None)
    if issue:
        call('PATCH', f'{api}/issues/{issue["number"]}', {'body': body})
        return issue['html_url']
    return call('POST', f'{api}/issues', {'title': ISSUE_TITLE, 'body': body, 'labels': [LABEL]})['html_url']


# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--site', required=True, help='a checkout of miraclehealth-site')
    ap.add_argument('--backfill', action='store_true', help='every year, not just what PubMed added lately')
    ap.add_argument('--days', type=int, default=45)
    ap.add_argument('--per', type=int, default=20, help='studies per compound and name group')
    ap.add_argument('--only', default='')
    ap.add_argument('--out', default='')
    ap.add_argument('--issue', action='store_true')
    ap.add_argument('--show', default='', help='print these PubMed ids\' abstracts, to check a study before it goes into a sheet')
    args = ap.parse_args()
    if args.show:
        for a in efetch([p.strip() for p in args.show.split(',') if p.strip()]):
            print(f'\nPMID {a["pmid"]}: {a["title"]} ({a["journal"]}, {a["year"]}; doi {a["doi"] or "-"}; {a["pmc"] or "no PMC"})\n{a["abstract"]}\n', flush=True)
        return

    data = os.path.join(args.site, 'library', 'data')
    cfg = json.load(open(os.path.join(data, 'watch.json')))
    markers, parents, seen = cfg['markers'], cfg.get('parents', {}), set(cfg.get('seen', {}))
    skip = {s.lower() for s in cfg.get('skip_aliases', [])}
    items = [i for i in json.load(open(os.path.join(data, 'index.json')))['items'] if i.get('sheet')]
    if args.only:
        want = set(args.only.split(','))
        items = [i for i in items if i['id'] in want]
    key, model = os.environ.get('ANTHROPIC_API_KEY', ''), os.environ.get('WATCH_MODEL', 'claude-haiku-5-5')
    by = f'Claude ({model})' if key else 'a plain check'
    days = None if args.backfill else args.days
    mode = 'every year' if args.backfill else f'added to PubMed in the last {args.days} days'

    # 1. Search: each compound under its own names, and under its parent's
    jobs = []
    for it in items:
        sheet = json.load(open(os.path.join(data, 'entries', f'{it["id"]}.json')))
        groups = [(names_of(it, skip), '')]
        if it['id'] in parents:
            groups.append((parents[it['id']]['names'], parents[it['id']].get('say', '')))
        for names, via in groups:
            if not names:
                continue
            try:
                pmids = esearch(query(names, markers), args.per, days)
            except Exception as e:
                print(f'{it["id"]}: search failed ({e})', file=sys.stderr)
                continue
            jobs.append((it, sheet, via, pmids))
    allp = sorted({p for _, _, _, ps in jobs for p in ps})
    print(f'Searched {len(items)} compounds: {len(allp)} studies to look at.', flush=True)
    arts = {a['pmid']: a for a in efetch(allp)} if allp else {}

    # 2. Leave out what each sheet already cites, and what was reviewed and left out
    todo = []
    for it, sheet, via, pmids in jobs:
        ids, titles = cited(sheet)
        for p in pmids:
            a = arts.get(p)
            if a and p not in seen and not is_cited(a, ids, titles) and a['abstract']:
                todo.append((it, sheet, via, a))
    print(f'{len(todo)} not cited yet; reading them ({by}).', flush=True)

    # 3. Read each one: which marker, which way, in whom
    def read(job):
        it, sheet, via, a = job
        r = claude_read(a, it['name'], via, markers, key, model) if key else None
        return job, r or plain_read(a, markers)
    found = []
    with cf.ThreadPoolExecutor(max_workers=4 if key else 1) as pool:
        for (it, sheet, via, a), r in pool.map(read, todo):
            if not r['relevant']:
                continue
            mk = {m['id']: m for m in markers}
            effects = [{**e, 'gap': not sheet_mentions(sheet, mk[e['marker']])} for e in r['effects'] if e['marker'] in mk]
            if effects:
                found.append({'id': it['id'], 'name': it['name'], 'via': via, **{k: a[k] for k in ('pmid', 'title', 'journal', 'year')}, 'effects': effects, 'by': r['by']})
    # One study, one line per compound
    uniq = {}
    for f in found:
        uniq.setdefault((f['id'], f['pmid']), f)
    found = list(uniq.values())
    counts = {'compounds': len(items), 'new': len(todo), 'kept': len(found)}
    body = render(found, markers, mode, by, counts)
    print(f'{len(found)} report an effect on a marker; {sum(any(e["gap"] for e in f["effects"]) for f in found)} on a marker their sheet doesn\'t mention.', flush=True)

    if args.out:
        os.makedirs(args.out, exist_ok=True)
        json.dump({'mode': mode, 'by': by, 'counts': counts, 'found': found}, open(os.path.join(args.out, 'watch.json'), 'w'), indent=1, ensure_ascii=False)
        open(os.path.join(args.out, 'watch.md'), 'w').write(body)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        open(os.environ['GITHUB_STEP_SUMMARY'], 'a').write(f'## {ISSUE_TITLE}\n\n{body}\n')
    if args.issue:
        url = upsert_issue(body)
        if url:
            print(f'Review issue: {url}')


if __name__ == '__main__':
    main()
