import datetime, hashlib, json, os, pathlib, re, selectors, signal, subprocess, sys, time

w = pathlib.Path(__file__).resolve().parent
repo = w.parents[2]
label = sys.argv[1] if len(sys.argv) > 1 else 'astra-qualification-v2'
assert label == 'astra-evidence'
case = w / label
assert pathlib.Path.cwd().resolve() == repo
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
codex_root = pathlib.Path(os.environ.get('CODEX_HOME', str(pathlib.Path.home() / '.codex')))
protected = {str(p): digest(p) for p in [pathlib.Path('/Users/aaat/.agents/policies/model-policy.md'), codex_root / 'config.toml']}
argv = ['/opt/homebrew/bin/codex', 'exec', '--model', 'gpt-6-astra', '-c', 'model_reasoning_effort="ultra"',
        '--sandbox', 'read-only', '--cd', str(case), '--json', '--output-last-message', str(case / 'report.md'), '-']
(case / 'launch.json').write_text(json.dumps({'argv': argv, 'cwd': str(case), 'model': 'gpt-6-astra', 'effort': 'ultra',
    'permissionMode': 'read-only sandbox; inherited approval policy', 'protectedBefore': protected,
    'wrapperPid': os.getpid(), 'host': 'local macOS', 'deadlineSeconds': 360}, indent=2))
env = {k: v for k, v in os.environ.items() if k in ['HOME', 'PATH', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'SHELL', 'CODEX_HOME'] or k.startswith('LC_')}
started = time.monotonic()
child = subprocess.Popen(argv, cwd=case, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, start_new_session=True)
child.stdin.write((case / 'prompt.txt').read_bytes())
child.stdin.close()
known = {child.pid}
events, stderr, pending = [], b'', b''
thread_id = None
failure = None
selector = selectors.DefaultSelector()
for fd, label in [(child.stdout, 'stdout'), (child.stderr, 'stderr')]:
    os.set_blocking(fd.fileno(), False)
    selector.register(fd, selectors.EVENT_READ, label)

def census():
    rows = []
    for line in subprocess.check_output(['ps', '-axo', 'pid=,ppid=,pgid='], text=True).splitlines():
        try: rows.append(tuple(map(int, line.split())))
        except ValueError: pass
    changed = True
    while changed:
        changed = False
        for pid, ppid, pgid in rows:
            if (ppid in known or pgid == child.pid) and pid not in known:
                known.add(pid)
                changed = True
    return [pid for pid, _, _ in rows if pid in known]

def consume(line):
    global thread_id, failure
    try: item = json.loads(line)
    except Exception:
        failure = 'MALFORMED_CODEX_STREAM'
        return
    kind = item.get('type', '')
    if kind == 'thread.started': thread_id = item.get('thread_id')
    entry = item.get('item', {})
    entry_type = entry.get('type', '')
    if 'reason' in entry_type or 'thought' in entry_type: return
    if entry_type == 'command_execution':
        output = entry.get('aggregated_output', '')
        events.append({'type': kind, 'itemType': entry_type, 'command': entry.get('command'),
                       'status': entry.get('status'), 'exitCode': entry.get('exit_code'),
                       'outputSha256': hashlib.sha256(output.encode()).hexdigest(),
                       'containsMarker': (case / 'marker.txt').read_text().strip() in output})
    elif entry_type == 'agent_message':
        events.append({'type': kind, 'itemType': entry_type})
    else:
        record = {'type': kind, 'itemType': entry_type}
        for key in ['thread_id', 'usage', 'error', 'message']:
            if key in item: record[key] = item[key]
        if entry_type == 'error':
            record['diagnostic'] = {k: v for k, v in entry.items() if k != 'type'}
        if 'collab' in entry_type or 'agent' in entry_type:
            record['collaboration'] = {k: v for k, v in entry.items() if k != 'prompt'}
        events.append(record)
    if kind in ['error', 'turn.failed']: failure = 'CODEX_ENTRY_ERROR'

while selector.get_map() or child.poll() is None:
    census()
    if failure or time.monotonic() - started > 360:
        failure = failure or 'CODEX_ENTRY_DEADLINE'
        for sig in [signal.SIGTERM, signal.SIGKILL]:
            try: os.killpg(child.pid, sig)
            except ProcessLookupError: break
            try: child.wait(timeout=4); break
            except subprocess.TimeoutExpired: pass
        break
    for key, _ in selector.select(.25):
        data = os.read(key.fd, 65536)
        if not data:
            selector.unregister(key.fileobj)
            continue
        if key.data == 'stderr': stderr += data
        else:
            pending += data
            while b'\n' in pending:
                line, pending = pending.split(b'\n', 1)
                if line.strip(): consume(line)
    (case / 'events.json').write_text(json.dumps(events, indent=2))
if pending.strip(): consume(pending)
child.wait(timeout=10)
selector.close()
remaining = census()
try: os.killpg(child.pid, 0); group_absent = False
except ProcessLookupError: group_absent = True
contexts = []
session_paths = []
if isinstance(thread_id, str) and len(thread_id) == 36 and all(c in '0123456789abcdef-' for c in thread_id):
    for path in (codex_root / 'sessions').glob('*/*/*/*' + thread_id + '*.jsonl'):
        session_paths.append(str(path))
        for line in path.read_text().splitlines():
            try: entry = json.loads(line)
            except ValueError: continue
            if entry.get('type') == 'turn_context':
                value = entry.get('payload', {})
                observed = {k: value.get(k) for k in ['cwd', 'model', 'effort', 'approval_policy', 'sandbox_policy']}
                mode = value.get('collaboration_mode')
                if isinstance(mode, dict):
                    observed['collaboration_mode'] = {'mode': mode.get('mode'),
                        'settings': {k: mode.get('settings', {}).get(k) for k in ['model', 'reasoning_effort']}}
                contexts.append(observed)
unchanged = all(digest(pathlib.Path(p)) == h for p, h in protected.items())
private = case / 'private-stderr.log'
private.write_bytes(stderr); private.chmod(0o600)
diagnostics = re.sub(r'(?i)(Bearer\s+)[^\s]+', r'\1[redacted]', stderr.decode(errors='replace'))
diagnostics = re.sub(r'(?i)((?:api[_-]?key|access[_-]?token|password|secret)\s*[=:]\s*)[^\s,]+', r'\1[redacted]', diagnostics)
result = {'providerExitCode': child.returncode, 'elapsedSeconds': round(time.monotonic() - started, 3),
          'failure': failure, 'threadId': thread_id, 'ownSessionPaths': session_paths, 'effectiveContexts': contexts,
          'stderr': diagnostics, 'remainingPids': remaining,
          'groupAbsent': group_absent, 'protectedUnchanged': unchanged}
(case / 'events.json').write_text(json.dumps(events, indent=2))
(case / 'completion.json').write_text(json.dumps(result, indent=2))
assert group_absent and not remaining and unchanged
(case / 'stopped.json').write_text(json.dumps({'wrapperPid': os.getpid(), 'at': time.time()}))
