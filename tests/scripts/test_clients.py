"""The shared clients: talking to a deployed Sig (scripts/sig_client.py) and one forced-tool call
to Claude (scripts/claude_call.py). A local server stands in for Sig; Claude's API is stood in for.
Run: python3 -m unittest discover -s tests/scripts
"""
import io
import json
import os
import sys
import threading
import unittest
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'scripts'))
import claude_call  # noqa: E402
import sig_client  # noqa: E402


class StandInSig(BaseHTTPRequestHandler):
    replies = []          # (status, body) per request, in order
    seen = []             # (path, origin, eval key, messages)

    def log_message(self, *a):
        pass

    def do_POST(self):
        n = int(self.headers.get('content-length', 0))
        body = json.loads(self.rfile.read(n))
        StandInSig.seen.append((self.path, self.headers.get('Origin'), self.headers.get('x-eval-key'), body['messages']))
        status, out = StandInSig.replies.pop(0)
        if status == 'drop':
            self.wfile.flush()
            self.connection.close()
            return
        self.send_response(status)
        self.send_header('content-type', 'text/event-stream')
        self.end_headers()
        self.wfile.write(out.encode())


class SigClient(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), StandInSig)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f'http://127.0.0.1:{cls.server.server_address[1]}/ask'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        StandInSig.replies, StandInSig.seen = [], []

    def test_events_come_back_in_order_and_a_broken_one_is_skipped(self):
        raw = 'event: step\ndata: {"agent": "safety"}\n\nevent: text\ndata: {"d": "Hel\ndata: lo"}\n\nevent: text\ndata: {"d": "Hello"}\n\n: comment\n\nevent: done\ndata: {}\n\n'
        self.assertEqual(sig_client.parse_sse(raw), [('step', {'agent': 'safety'}), ('text', {'d': 'Hello'}), ('done', {})])

    def test_a_question_carries_its_page_and_key(self):
        StandInSig.replies = [(200, 'event: text\ndata: {"d": "Hi."}\n\n')]
        r = sig_client.post(self.url, [{'role': 'user', 'content': 'hi'}], key='k' * 40, origin='https://miraclehealth.us')
        self.assertEqual((r['status'], sig_client.text_of(r['events'])), (200, 'Hi.'))
        self.assertEqual(StandInSig.seen[0][1:3], ('https://miraclehealth.us', 'k' * 40))

    def test_an_error_or_a_dropped_connection_is_a_failed_question_not_a_crash(self):
        StandInSig.replies = [(500, 'oops'), ('drop', '')]
        self.assertEqual(sig_client.post(self.url, [])['status'], 500)
        dropped = sig_client.post(self.url, [])
        self.assertEqual((dropped['status'], dropped['events']), (0, []))

    def test_a_limit_waits_and_asks_again(self):
        StandInSig.replies = [(429, ''), (429, ''), (200, 'event: done\ndata: {}\n\n')]
        r = sig_client.ask(self.url, [], waits=(0, 0, 0, 0))
        self.assertEqual((r['status'], len(StandInSig.seen)), (200, 3))

    def test_the_checks_shared_by_the_smoke_check_and_the_test_set(self):
        self.assertTrue(sig_client.DOSE.search('Take 2 mg a day'))
        self.assertFalse(sig_client.DOSE.search('About 1 g of protein per pound of lean mass'))
        self.assertTrue(sig_client.TOOL_TALK.search('I used present_plan for this'))
        self.assertTrue(sig_client.TOOL_TALK.search("The card didn't load, sorry"))
        self.assertTrue(sig_client.DEMOGRAPHICS.search('How old are you?'))


class ClaudeCall(unittest.TestCase):
    def setUp(self):
        self.saved = (claude_call.urllib.request.urlopen, claude_call.time.sleep)
        claude_call.time.sleep = lambda s: None
        self.sent = []

    def tearDown(self):
        claude_call.urllib.request.urlopen, claude_call.time.sleep = self.saved

    def answers(self, *replies):
        replies = list(replies)

        def urlopen(req, timeout=None):
            self.sent.append(json.loads(req.data))
            r = replies.pop(0)
            if isinstance(r, Exception):
                raise r
            return io.BytesIO(json.dumps(r).encode())
        claude_call.urllib.request.urlopen = urlopen

    TOOL = {'name': 'grade', 'input_schema': {'type': 'object'}}

    def test_the_tool_is_forced_and_its_input_comes_back(self):
        self.answers({'content': [{'type': 'tool_use', 'input': {'safety': 5}}]})
        self.assertEqual(claude_call.tool_call('k', 'm', self.TOOL, 'p', system='rules', max_tokens=400), {'safety': 5})
        sent = self.sent[0]
        self.assertEqual((sent['system'], sent['tool_choice'], sent['max_tokens']), ('rules', {'type': 'tool', 'name': 'grade'}, 400))
        self.assertEqual(sent['messages'], [{'role': 'user', 'content': 'p'}])

    def test_errors_that_may_pass_are_tried_again_and_collected(self):
        errors = []
        busy = urllib.error.HTTPError('u', 529, 'busy', {}, io.BytesIO(b'overloaded'))
        self.answers(busy, {'content': []}, {'content': [{'type': 'tool_use', 'input': {'ok': True}}]})
        self.assertEqual(claude_call.tool_call('k', 'm', self.TOOL, 'p', errors=errors), {'ok': True})
        self.assertEqual(len(errors), 2)
        self.assertNotIn('system', self.sent[0])

    def test_a_refused_request_is_not_tried_again(self):
        self.answers(urllib.error.HTTPError('u', 401, 'no', {}, io.BytesIO(b'bad key')), {'content': []})
        self.assertIsNone(claude_call.tool_call('k', 'm', self.TOOL, 'p'))
        self.assertEqual(len(self.sent), 1)


if __name__ == '__main__':
    unittest.main()
