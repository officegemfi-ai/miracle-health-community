#!/usr/bin/env python3
"""The Signal API check: what Deploy to test and the live check run against a project's signal
function (supabase/functions/signal). It only reads; nothing is changed.

  python3 scripts/signal_check.py https://<ref>.supabase.co/functions/v1/signal [--wait-cron 150]

Each check prints "ok" or "FAIL" with what was seen, and the run fails if any did:
  - /signal/version answers a version whose numbers the minute job (pg_cron) checked within the
    last 5 minutes; with --wait-cron N it waits up to N seconds for that, as after a deploy, when
    the job hasn't run yet
  - /signal answers the whole Signal (signals, community, uses) with that version, an ETag, a cache
    lifetime and open CORS; the same ETag again gets a 304 with no body; HEAD has no body
  - /signal/compounds/<id> answers one compound's Signal; a bad id is a 400, any other path a 404,
    and a POST a 405
It also prints how big the answers are, plain and compressed.
Run its tests: python3 -m unittest discover -s tests/scripts
"""
import argparse
import gzip
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

UA = 'miracle-health-signal-check/1'


def fetch(url, method='GET', headers=None, timeout=30):
    """(status, headers with lower-case names, body bytes); an HTTP error status is an answer too"""
    req = urllib.request.Request(url, method=method, headers={'User-Agent': UA, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        with e:
            return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()


def when(s):
    """A Postgres timestamp (microseconds and an offset) as an aware datetime"""
    return datetime.fromisoformat(str(s).replace('Z', '+00:00'))


class Check:
    def __init__(self):
        self.failed = []

    def ok(self, cond, what, seen=''):
        print(f"{'ok  ' if cond else 'FAIL'} {what}{f' ({seen})' if seen and not cond else ''}", flush=True)
        if not cond:
            self.failed.append(what)
        return cond


def check(base, wait_cron=0, max_age=300, compound=None, sleep=time.sleep, clock=time.monotonic, now=None):
    base = base.rstrip('/')
    now = now or (lambda: datetime.now(timezone.utc))
    c = Check()

    # 1. What's current, and whether the minute job is running
    deadline = clock() + wait_cron
    while True:
        st, h, body = fetch(f'{base}/version')
        if st != 200:
            c.ok(False, '/signal/version answers', f'{st}: {body[:200].decode(errors="replace")}')
            return c
        v = json.loads(body)
        age = (now() - when(v['checked_at'])).total_seconds()
        fresh = v.get('checked_by') == 'cron' and age <= max_age
        if fresh or clock() >= deadline:
            break
        print(f'     waiting for the minute job: version {v["version"]}, checked {age:.0f} s ago by {v.get("checked_by")}', flush=True)
        sleep(10)
    print(f'     version {v["version"]}, published {v["published_at"]}, checked {age:.0f} s ago by {v.get("checked_by")}')
    c.ok(isinstance(v.get('version'), int), '/signal/version has a version number', repr(v.get('version')))
    c.ok(v.get('checked_by') == 'cron', 'the minute job (pg_cron) checked the numbers last',
         f'checked_by {v.get("checked_by")}: "api" means the API had to publish because the job hasn\'t run for 3 minutes')
    c.ok(age <= max_age, f'the numbers were checked within {max_age // 60} minutes', f'{age:.0f} s ago')

    # 2. The whole Signal, its tag and its cache lifetime
    st, h, body = fetch(base)
    if not c.ok(st == 200, '/signal answers', f'{st}: {body[:200].decode(errors="replace")}'):
        return c
    data = json.loads(body)
    c.ok(all(isinstance(data.get(k), dict) for k in ('signals', 'community', 'uses')), 'it holds signals, community and uses',
         ', '.join(sorted(data)))
    c.ok(isinstance(data.get('version'), int) and data['version'] >= v['version'], 'with the current version or a newer one',
         f'{data.get("version")} after {v["version"]}')
    c.ok(h.get('x-signal-version') == str(data.get('version')), 'X-Signal-Version names it', h.get('x-signal-version', 'missing'))
    c.ok(bool(h.get('x-signal-checked')), 'X-Signal-Checked says when it was checked', 'missing')
    etag = h.get('etag', '')
    c.ok(etag.startswith(('"', 'W/"')), 'it has an ETag', etag or 'missing')
    c.ok('max-age=' in h.get('cache-control', ''), 'browsers may keep it a while (Cache-Control max-age)', h.get('cache-control', 'missing'))
    c.ok(h.get('access-control-allow-origin') == '*', 'any page may read it (CORS *)', h.get('access-control-allow-origin', 'missing'))
    print(f'     {len(body)} bytes, {len(data["signals"]) if isinstance(data.get("signals"), dict) else 0} Signals')
    for _ in range(2):   # a new version can land between the two requests: then ask once more
        st, h2, body2 = fetch(base, headers={'If-None-Match': etag})
        if st == 304 or h2.get('x-signal-version') == h.get('x-signal-version'):
            break
        st, h, body = fetch(base)
        etag = h.get('etag', '')
    c.ok(st == 304 and body2 == b'', 'the same ETag again gets a 304 with no body', f'{st}, {len(body2)} bytes')
    st, h3, body3 = fetch(base, method='HEAD')
    c.ok(st == 200 and body3 == b'', 'HEAD answers without the body', f'{st}, {len(body3)} bytes')
    st, hz, bz = fetch(base, headers={'Accept-Encoding': 'gzip'})
    if st == 200:
        enc = hz.get('content-encoding', 'none')
        plain = gzip.decompress(bz) if enc == 'gzip' else bz
        c.ok(json.loads(plain).get('version', -1) >= data.get('version', 0), 'a compressed copy reads the same')
        print(f'     compressed for browsers: {len(bz)} bytes ({enc})')

    # 3. One compound, and the errors
    cid = compound or next(iter(sorted(data.get('signals') or {})), None)
    if c.ok(bool(cid), 'there is a compound to ask for', 'no Signals'):
        st, h, body = fetch(f'{base}/compounds/{cid}')
        one = json.loads(body) if st == 200 else {}
        c.ok(st == 200 and isinstance(one.get('signal'), dict), f'/signal/compounds/{cid} answers its Signal', f'{st}')
        c.ok(isinstance(one.get('community'), dict) and isinstance(one.get('version'), int), 'with the totals and the version')
        print(f'     {len(body)} bytes for one compound')
    st, h, body = fetch(f'{base}/compounds/NOT-AN-ID')
    c.ok(st == 400 and json.loads(body or b'{}').get('error') == 'bad_id', 'a bad compound id is a 400', f'{st}')
    st, h, body = fetch(f'{base}/nothing-here')
    c.ok(st == 404, 'any other path is a 404', f'{st}')
    st, h, body = fetch(base, method='POST', headers={'Content-Type': 'application/json'})
    c.ok(st == 405 and 'GET' in h.get('allow', ''), 'a POST is a 405 that says GET', f'{st}, Allow {h.get("allow")}')
    return c


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('base', help='the signal function, e.g. https://<ref>.supabase.co/functions/v1/signal')
    ap.add_argument('--wait-cron', type=int, default=0, help='seconds to wait for the minute job to check the numbers')
    ap.add_argument('--max-age', type=int, default=300, help='the oldest a check may be, in seconds')
    ap.add_argument('--compound', help='the compound to ask for (default: the first with a Signal)')
    a = ap.parse_args(argv)
    c = check(a.base, a.wait_cron, a.max_age, a.compound)
    if c.failed:
        print(f'\nThe Signal API failed {len(c.failed)} check(s): ' + '; '.join(c.failed))
        return 1
    print('\nThe Signal API passed every check.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
