import hashlib, json, os, pathlib, selectors, signal, subprocess, sys, time

w = pathlib.Path(__file__).resolve().parent
repo = w.parents[2]
label = sys.argv[1] if len(sys.argv) > 1 else 'opus-plan-review'
assert label == 'argon-brief-review'
case = w / label
case.mkdir(exist_ok=True)
assert pathlib.Path.cwd().resolve() == repo
policy = pathlib.Path('/Users/aaat/.agents/policies/model-policy.md')
settings = pathlib.Path.home() / '.gemini/antigravity-cli/settings.json'
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
protected = {str(p): digest(p) for p in [policy, settings]}
global_config = json.loads(settings.read_text())
permissions = global_config.get('permissions', {})
profile = {'allowNonWorkspaceAccess': False, 'permissions': {
    **permissions,
    'allow': list(dict.fromkeys(permissions.get('allow', []) + [f'read_file({path})' for path in json.loads((case / 'allowed-reads.json').read_text())])),
    'deny': list(dict.fromkeys(permissions.get('deny', []) + [
        'write_file(*)', 'command(*)', 'read_url(*)', 'execute_url(*)', 'mcp(*)']))}}
(case / 'session-settings.json').write_text(json.dumps(profile))
prompt = (case / 'prompt.txt').read_text()
argv = ['/Users/aaat/.local/bin/agy', '--model', 'gemini-4-argon-high', '--effort', 'high',
        '--mode', 'plan', '--sandbox', '--settings', str(case / 'session-settings.json'),
        '--output-format', 'stream-json', '--print-timeout', '480s',
        '--log-file', str(case / 'provider-cli.log'), '-p', prompt]
(case / 'launch.json').write_text(json.dumps({
    'cwd': str(case), 'host': 'local', 'wrapperPid': os.getpid(), 'parentPid': os.getppid(),
    'model': 'gemini-4-argon-high', 'effort': 'high', 'backendEffort': 'provider-managed; not exposed',
    'mode': 'plan', 'sandbox': True, 'permissionBypass': False,
    'argvWithoutPrompt': argv[:-1], 'protectedBefore': protected,
    'promptSha256': hashlib.sha256(prompt.encode()).hexdigest(),
    'custody': 'Owned Orca custom terminal/process; not a native Dispatch'}, indent=2))
env = {k: v for k, v in os.environ.items() if k in ['HOME','PATH','USER','LOGNAME','TMPDIR','LANG','SHELL'] or k.startswith('LC_')}
start = time.monotonic()
child = subprocess.Popen(argv, cwd=case, env=env, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, start_new_session=True)
known = {child.pid}
events, tools, errors, signals = [], [], [], []
init = final = failure = None
stderr = b''
selector = selectors.DefaultSelector()
for fd, label in [(child.stdout, 'stdout'), (child.stderr, 'stderr')]:
    os.set_blocking(fd.fileno(), False)
    selector.register(fd, selectors.EVENT_READ, label)
buffers = {'stdout': b'', 'stderr': b''}

def census():
    rows = []
    for line in subprocess.check_output(['ps','-axo','pid=,ppid=,pgid='], text=True).splitlines():
        try: rows.append(tuple(map(int, line.split())))
        except ValueError: pass
    changed = True
    while changed:
        changed = False
        for pid, ppid, pgid in rows:
            if (ppid in known or pgid == child.pid) and pid not in known:
                known.add(pid); changed = True
    return [pid for pid, ppid, pgid in rows if pid in known]

def consume(line):
    global init, final, failure
    try: item = json.loads(line)
    except Exception:
        failure = failure or 'MALFORMED_PROVIDER_STREAM'; return
    event = item.get('event')
    if event == 'init':
        raw = item['init']
        init = {k: raw.get(k) for k in ['model','agent','cwd','permission_mode']}
        events.append({'event': event, 'init': init, 'advertisedToolCount': len(raw.get('tools', []))})
        if init['model'] != 'gemini-4-argon-high' or init['cwd'] != str(case) or init['permission_mode'] != 'request-review':
            failure = 'EFFECTIVE_REVIEW_IDENTITY_MISMATCH'
    elif event == 'step_update':
        step = item.get('step_update', {})
        if step.get('step_type') == 'tool':
            tool = {k: step.get(k) for k in ['tool_name','state','step_index']}
            tool['parameters'] = step.get('tool_info', {}).get('parameters')
            tools.append(tool); events.append({'event': event, 'tool': tool})
            if tool['tool_name'] != 'read_file': failure = 'UNEXPECTED_REVIEW_TOOL'
            if tool['state'] not in ['ACTIVE','DONE']:
                errors.append(step); failure = 'REVIEW_TOOL_ERROR'
        else: events.append({'event': event, 'stepType': step.get('step_type'), 'state': step.get('state')})
    elif event == 'result':
        final = item['result']
        (case / 'provider-result.json').write_text(json.dumps(final, indent=2))
        (case / 'report.md').write_text(final.get('response', ''))
        events.append({'event': event, 'status': final.get('status')})
    else: events.append({'event': event})

while selector.get_map() or child.poll() is None:
    census()
    if failure or time.monotonic() - start > 500:
        failure = failure or 'REVIEW_DEADLINE'
        for sig, wait in [(signal.SIGTERM, 4), (signal.SIGKILL, 4)]:
            try: os.killpg(child.pid, sig); signals.append(signal.Signals(sig).name)
            except ProcessLookupError: break
            try: child.wait(wait); break
            except subprocess.TimeoutExpired: pass
        break
    for key, _ in selector.select(.25):
        data = os.read(key.fd, 65536)
        if not data: selector.unregister(key.fileobj); continue
        label = key.data
        if label == 'stderr': stderr += data
        else:
            buffers[label] += data
            while b'\n' in buffers[label]:
                line, buffers[label] = buffers[label].split(b'\n', 1)
                if line.strip(): consume(line)
    (case / 'events.json').write_text(json.dumps(events, indent=2))
if buffers['stdout'].strip(): consume(buffers['stdout'])
child.wait(timeout=10)
selector.close()
remaining = census()
if b'print timeout' in stderr or not (case / 'report.md').exists() or not (case / 'report.md').read_text().strip(): failure = failure or 'REVIEW_NO_VERDICT'
try: os.killpg(child.pid, 0); group_absent = False
except ProcessLookupError: group_absent = True
unchanged = all(digest(pathlib.Path(p)) == h for p, h in protected.items())
result = {'providerExitCode': child.returncode, 'elapsedSeconds': round(time.monotonic()-start,3),
          'failure': failure, 'signals': signals, 'init': init,
          'final': {k: final.get(k) for k in ['status','error','num_turns']} if final else None,
          'actualTools': tools, 'fullToolErrors': errors, 'stderr': stderr.decode(errors='replace'),
          'remainingPids': remaining, 'groupAbsent': group_absent, 'protectedUnchanged': unchanged}
(case / 'events.json').write_text(json.dumps(events, indent=2))
(case / 'completion.json').write_text(json.dumps(result, indent=2))
assert group_absent and not remaining and unchanged
(case / 'stopped.json').write_text(json.dumps({'wrapperPid': os.getpid(), 'at': time.time()}))
