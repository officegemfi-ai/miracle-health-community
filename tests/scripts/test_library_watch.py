"""The Library watch's review list carries over from run to run (scripts/library_watch.py): what a
run finds is added; a study leaves only once its sheet cites it, it's in `seen`, or its box is
ticked in the review issue; and a first run with no list goes back through every year. PubMed,
Claude and GitHub are stood in for; the Library is the small copy in fixtures/.
Run: python3 -m unittest discover -s tests/scripts
"""
import contextlib
import io
import json
import os
import re
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'scripts'))
import library_watch as W  # noqa: E402

ART = {
    '50001': ('Enclomiphene lowers IGF-1 in men', 'IGF-1 decreased with enclomiphene citrate in 30 men in a randomized trial.'),
    '50002': ('Enclomiphene and lipids', 'LDL cholesterol was lower with enclomiphene citrate in 40 men.'),
    '50003': ('Clomiphene and cortisol', 'Cortisol increased with clomiphene in 12 men.'),
    '50004': ('Somatropin and glucose', 'Fasting glucose increased with somatropin in 50 adults, randomized placebo-controlled.'),
    '50005': ('BPC-157 case', 'A case of tendon pain treated with BPC-157 and nothing measured in blood.'),
    '50006': ('Enclomiphene and hematocrit', 'Hematocrit increased with enclomiphene in 25 men.'),
    '50007': ('BPC-157 and kidney function', 'Creatinine increased after BPC-157 in one person.'),
}


class Watch:
    """PubMed, the reader and the review issue, stood in for"""

    def __init__(self):
        self.search, self.searched, self.read, self.issue, self.writes = {}, [], [], None, 0

    def esearch(self, term, retmax, days=None):
        self.searched.append(days)
        return next((list(ids) for name, ids in self.search.items() if f'"{name}"' in term), [])

    def efetch(self, pmids):
        return [{'pmid': p, 'title': ART[p][0], 'abstract': ART[p][1], 'journal': 'J Test', 'year': '2024', 'types': [], 'doi': f'10.1/{p}', 'pmc': ''}
                for p in pmids if p in ART]

    def github(self):
        def call(method, path, data=None):
            if method == 'GET' and path.startswith('/issues'):
                return [{'number': 1, 'title': W.ISSUE_TITLE, 'body': self.issue, 'html_url': 'https://x/issues/1'}] if self.issue is not None else []
            if method == 'POST' and path == '/labels':
                return {}
            if method in ('PATCH', 'POST') and path.startswith('/issues'):
                self.issue, self.writes = data['body'], self.writes + 1
                return {'html_url': 'https://x/issues/1'}
            raise AssertionError((method, path))
        return call


class CarriedOverList(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        shutil.copytree(os.path.join(HERE, 'fixtures', 'library'), os.path.join(self.dir, 'library'))
        self.queue = os.path.join(self.dir, 'queue', 'queue.json')
        self.w = Watch()
        plain = W.plain_read

        def read(art, markers):
            self.w.read.append(art['pmid'])
            return plain(art, markers)
        self.patches = {'esearch': self.w.esearch, 'efetch': self.w.efetch, 'plain_read': read, 'github': self.w.github}
        self.saved = {k: getattr(W, k) for k in self.patches}
        for k, v in self.patches.items():
            setattr(W, k, v)
        self.env = os.environ.pop('ANTHROPIC_API_KEY', None)

    def tearDown(self):
        for k, v in self.saved.items():
            setattr(W, k, v)
        if self.env is not None:
            os.environ['ANTHROPIC_API_KEY'] = self.env
        shutil.rmtree(self.dir)

    def run_watch(self, *argv):
        self.w.searched.clear()
        self.w.read.clear()
        sys.argv = ['library_watch.py', '--site', self.dir, '--queue', self.queue, '--list-url', 'https://example/queue.md', '--issue', *argv]
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            W.main()
        with open(self.queue, encoding='utf-8') as f:
            return out.getvalue(), json.load(f)

    @staticmethod
    def keys(q):
        return sorted(f"{f['id']}:{f['pmid']}" for f in q['items'])

    def test_the_list_carries_over(self):
        w = self.w
        # A first run with no list goes back through every year
        w.search.update({'Enclomiphene': ['50001', '50002'], 'clomiphene': ['50003'], 'Somatropin': ['50004'], 'BPC-157': ['50005']})
        log, q = self.run_watch()
        self.assertIn('No review list yet', log)
        self.assertTrue(w.searched and all(d is None for d in w.searched))
        self.assertEqual(self.keys(q), ['enclomiphene:50001', 'enclomiphene:50002', 'enclomiphene:50003', 'somatropin:50004'])
        self.assertEqual(q['not_relevant'], ['bpc157:50005'])
        self.assertTrue(os.path.exists(os.path.join(self.dir, 'queue', 'queue.md')))
        self.assertIn('**4 to review**', w.issue)
        self.assertEqual(w.issue.count('**new**'), 4)
        self.assertIn('[The whole list](https://example/queue.md)', w.issue)
        # IGF-1 is on enclomiphene's sheet (more evidence); LDL isn't (a gap)
        gaps = {f['pmid']: any(e['gap'] for e in f['effects']) for f in q['items']}
        self.assertFalse(gaps['50001'])
        self.assertTrue(gaps['50002'])
        first = {f['pmid']: f['first_seen'] for f in q['items']}

        # A weekly run looks at the last 45 days, reads only what's new, and keeps the backlog
        w.search.update({'Enclomiphene': ['50002', '50006'], 'clomiphene': [], 'Somatropin': [], 'BPC-157': ['50005']})
        log, q = self.run_watch()
        self.assertTrue(w.searched and all(d == 45 for d in w.searched))
        self.assertEqual(w.read, ['50006'])
        self.assertEqual(len(q['items']), 5)
        self.assertTrue(all(f['first_seen'] == first.get(f['pmid'], f['first_seen']) for f in q['items']))
        self.assertIn('**5 to review**', w.issue)
        self.assertIn(', 1 new to the list', w.issue)

        # Ticked in the issue, or cited by its sheet: it leaves, and a tick is remembered
        body = w.issue
        w.issue = re.sub(r'- \[ \] (.*pubmed\.ncbi\.nlm\.nih\.gov/50004/)', r'- [x] \1', body)
        self.assertNotEqual(w.issue, body)
        self.assertEqual(W.ticked_in(w.issue), {'somatropin:50004'})
        path = os.path.join(self.dir, 'library', 'data', 'entries', 'enclomiphene.json')
        with open(path, encoding='utf-8') as f:
            sheet = json.load(f)
        sheet['sources'].append({'n': 2, 'title': 'Enclomiphene and lipids', 'url': 'https://pubmed.ncbi.nlm.nih.gov/50002/'})
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(sheet, f)
        w.search.update({'Enclomiphene': [], 'BPC-157': []})
        log, q = self.run_watch()
        self.assertEqual(self.keys(q), ['enclomiphene:50001', 'enclomiphene:50003', 'enclomiphene:50006'])
        self.assertIn('somatropin:50004', q['done'])
        self.assertIn('**3 to review**', w.issue)
        self.assertNotIn('50004', w.issue)

        # A run for one compound keeps everyone else's
        w.search.update({'BPC-157': ['50007']})
        log, q = self.run_watch('--only', 'bpc157')
        self.assertEqual(self.keys(q), ['bpc157:50007', 'enclomiphene:50001', 'enclomiphene:50003', 'enclomiphene:50006'])
        self.assertTrue(any(e['gap'] for f in q['items'] if f['pmid'] == '50007' for e in f['effects']))

        # A full pass reads everything again but what was ticked or cited, and keeps them out
        w.search.update({'Enclomiphene': ['50001', '50002', '50006'], 'clomiphene': ['50003'], 'Somatropin': ['50004'], 'BPC-157': ['50005', '50007']})
        log, q = self.run_watch('--backfill')
        self.assertEqual(sorted(w.read), ['50001', '50003', '50005', '50006', '50007'])
        self.assertEqual(self.keys(q), ['bpc157:50007', 'enclomiphene:50001', 'enclomiphene:50003', 'enclomiphene:50006'])
        self.assertEqual(w.writes, 5)

    def test_a_long_issue_is_cut_at_a_line_and_links_the_whole_list(self):
        with open(os.path.join(HERE, 'fixtures', 'library', 'data', 'watch.json'), encoding='utf-8') as f:
            markers = json.load(f)['markers']
        rows = [{'id': 'enclomiphene', 'name': 'Enclomiphene', 'via': '', 'pmid': str(60000 + i), 'title': 'A long title about enclomiphene and a marker ' * 4,
                 'journal': 'J', 'year': '2020', 'first_seen': '2026-11-07',
                 'effects': [{'marker': 'lipids', 'direction': 'down', 'who': '40 men', 'design': 'randomized trial', 'gap': True}]} for i in range(700)]
        counts = {'open': 700, 'gaps': 700, 'compounds': 1, 'read': 700, 'new': 0, 'mode': 'every year', 'when': '2026-11-07'}
        issue = W.render(rows, markers, 'Claude', counts, '2026-11-07', 'https://example/queue.md')
        whole = W.render(rows, markers, 'Claude', counts, '2026-11-07', 'https://example/queue.md', cap=False)
        self.assertLess(len(issue), 60000)
        self.assertTrue(issue.rstrip().endswith('[the whole list](https://example/queue.md).'))
        self.assertEqual(whole.count('- [ ]'), 700)

    def test_ticks_are_read_from_the_issue_under_their_compound(self):
        body = ('**[Cagrilintide](https://miraclehealth.us/library/cagrilintide/)**\r\n'
                '- [x] **Blood sugar ↓** · A title (J, 2025) · [PubMed 123](https://pubmed.ncbi.nlm.nih.gov/123/)\r\n'
                '- [ ] **Lipids ↓** · Another (J, 2025) · [PubMed 456](https://pubmed.ncbi.nlm.nih.gov/456/)\r\n'
                '**[BPC-157](https://miraclehealth.us/library/bpc157/)**\r\n'
                '- [X] **Liver ↑** · A case (J, 2020) · [PubMed 789](https://pubmed.ncbi.nlm.nih.gov/789/)\r\n')
        self.assertEqual(W.ticked_in(body), {'cagrilintide:123', 'bpc157:789'})


if __name__ == '__main__':
    unittest.main()
