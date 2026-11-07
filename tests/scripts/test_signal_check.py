"""The Signal API check (scripts/signal_check.py) against a local stand-in for the signal function:
it passes a working API and fails, in plain words, the ways a deployed one could break.
Run: python3 -m unittest discover -s tests/scripts
"""
import contextlib
import io
import json
import os
import re
import sys
import threading
import unittest
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'scripts'))
import signal_check  # noqa: E402

SIGNALS = {'bpc157': {'name': 'BPC-157', 'score': 61}}


class StandIn(BaseHTTPRequestHandler):
    # What the stand-in does; each test sets it
    conf = {}

    def log_message(self, *a):
        pass

    def send(self, status, body=b'', headers=None, with_body=True):
        self.send_response(status)
        for k, v in {'Access-Control-Allow-Origin': '*', **(headers or {})}.items():
            self.send_header(k, v)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if with_body and body:
            self.wfile.write(body)

    def answer(self, with_body):
        c = StandIn.conf
        versions = c.get('versions')
        v = versions.pop(0) if versions and len(versions) > 1 and self.path == '/signal/version' else (versions or [{}])[0]
        checked = datetime.now(timezone.utc) - timedelta(seconds=v.get('age', 20))
        meta = {'version': 7, 'hash': 'a' * 32, 'published_at': '2026-11-07T12:00:00.000123+00:00',
                'checked_at': checked.isoformat(), 'checked_by': v.get('by', 'cron')}
        common = {'X-Signal-Version': '7', 'X-Signal-Checked': meta['checked_at'], 'Content-Type': 'application/json'}
        if self.path == '/signal/version':
            if c.get('down'):
                return self.send(503, b'{"error": "unavailable"}', with_body=with_body)
            return self.send(200, json.dumps(meta).encode(), {**common, 'Cache-Control': 'public, max-age=15'}, with_body)
        if self.path == '/signal':
            body = json.dumps({'signals': SIGNALS, 'community': {'members': 3}, 'uses': {}, 'version': 7}).encode()
            h = {**common, 'ETag': '"abc"', 'Cache-Control': c.get('cache', 'public, max-age=30')}
            if c.get('conditional', True) and self.headers.get('If-None-Match') == '"abc"':
                return self.send(304, b'', h, with_body)
            return self.send(200, body, h, with_body)
        m = re.match(r'^/signal/compounds/([^/]+)$', self.path)
        if m:
            if not re.match(r'^[a-z0-9-]{2,40}$', m.group(1)):
                return self.send(400, b'{"error": "bad_id"}', with_body=with_body)
            body = json.dumps({'version': 7, 'community': {'members': 3}, 'signal': SIGNALS.get(m.group(1))}).encode()
            return self.send(200, body, common, with_body)
        return self.send(404, b'{"error": "not_found"}', with_body=with_body)

    def do_GET(self):
        self.answer(True)

    def do_HEAD(self):
        self.answer(False)

    def do_POST(self):
        self.send(405, b'{"error": "method"}', {'Allow': 'GET, HEAD, OPTIONS'})


class SignalCheck(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), StandIn)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f'http://127.0.0.1:{cls.server.server_address[1]}/signal'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def run_check(self, conf, **kw):
        StandIn.conf = conf
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            c = signal_check.check(self.url, sleep=lambda s: None, **kw)
        return c.failed, out.getvalue()

    def test_a_working_api_passes(self):
        failed, out = self.run_check({})
        self.assertEqual(failed, [], out)
        self.assertIn('ok   the same ETag again gets a 304 with no body', out)

    def test_the_api_publishing_for_a_stopped_minute_job_fails(self):
        failed, out = self.run_check({'versions': [{'by': 'api'}]})
        self.assertEqual(failed, ['the minute job (pg_cron) checked the numbers last'], out)
        self.assertIn('"api" means the API had to publish', out)

    def test_numbers_checked_long_ago_fail(self):
        failed, _ = self.run_check({'versions': [{'age': 900}]})
        self.assertEqual(failed, ['the numbers were checked within 5 minutes'])

    def test_after_a_deploy_it_waits_for_the_minute_job(self):
        ticks = iter(range(0, 1000, 10))
        failed, out = self.run_check({'versions': [{'by': 'deploy'}, {'by': 'deploy'}, {'by': 'cron'}]},
                                     wait_cron=150, clock=lambda: next(ticks))
        self.assertEqual(failed, [], out)
        self.assertEqual(out.count('waiting for the minute job'), 2)

    def test_no_conditional_requests_fails(self):
        failed, _ = self.run_check({'conditional': False})
        self.assertEqual(failed, ['the same ETag again gets a 304 with no body'])

    def test_no_cache_lifetime_fails(self):
        failed, _ = self.run_check({'cache': 'no-store'})
        self.assertEqual(failed, ['browsers may keep it a while (Cache-Control max-age)'])

    def test_an_api_that_cannot_answer_stops_at_the_first_check(self):
        failed, out = self.run_check({'down': True})
        self.assertEqual(failed, ['/signal/version answers'])
        self.assertIn('503', out)

    def test_main_exits_1_on_a_failure(self):
        StandIn.conf = {'versions': [{'by': 'api'}]}
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(signal_check.main([self.url]), 1)
        StandIn.conf = {}
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(signal_check.main([self.url]), 0)


if __name__ == '__main__':
    unittest.main()
