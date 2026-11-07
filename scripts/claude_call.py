"""One call to Claude that must answer by filling in a given tool (the Messages API with forced
tool use), tried again on errors that may pass: the test set's judge (ask_eval.py) and the Library
watch's reader (library_watch.py) both use it. Standard library only.
"""
import json
import time
import urllib.error
import urllib.request

API = 'https://api.anthropic.com/v1/messages'


def tool_call(api_key, model, tool, prompt, system=None, max_tokens=400, tries=3, errors=None):
    """The tool's input as Claude filled it in, or None. A request Claude refuses outright (400,
    401, 403, 404) isn't tried again; anything else waits 5, then 10 seconds. errors, if given,
    collects why a try failed."""
    payload = {'model': model, 'max_tokens': max_tokens}
    if system:
        payload['system'] = system
    payload.update({'tools': [tool], 'tool_choice': {'type': 'tool', 'name': tool['name']},
                    'messages': [{'role': 'user', 'content': prompt}]})
    req = urllib.request.Request(API, data=json.dumps(payload).encode(), method='POST', headers={
        'content-type': 'application/json', 'x-api-key': api_key, 'anthropic-version': '2023-06-01'})
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=90) as res:
                data = json.loads(res.read().decode('utf-8'))
            use = next((c for c in data.get('content', []) if c.get('type') == 'tool_use'), None)
            if use:
                return use['input']
            if errors is not None:
                errors.append(f'no {tool["name"]} call in the answer')
        except urllib.error.HTTPError as e:
            if errors is not None:
                errors.append(f'HTTP {e.code}: {e.read().decode("utf-8", "replace")[:200]}')
            if e.code in (400, 401, 403, 404):
                break   # it won't work on a second try either
            time.sleep(5 * (attempt + 1))
        except Exception as e:
            if errors is not None:
                errors.append(str(e)[:200])
            time.sleep(5 * (attempt + 1))
    return None
