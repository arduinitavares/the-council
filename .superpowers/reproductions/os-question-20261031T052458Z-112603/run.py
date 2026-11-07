import hashlib,json,os,pathlib,shlex,signal,subprocess,time
w=pathlib.Path(__file__).resolve().parent
repo=w.parents[2]
assert pathlib.Path.cwd().resolve()==repo
node='/opt/homebrew/opt/node@22/bin/node'
def save(n,x):
 p=w/n;p.write_text(json.dumps(x,indent=2));p.chmod(0o600)
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
protected=[repo/'src/pilot/provider-controls.ts',repo/'src/pilot/provider-session.ts',repo/'dist/pilot/provider-controls.js',repo/'dist/pilot/provider-session.js',pathlib.Path.home()/'.gemini/antigravity-cli/settings.json',pathlib.Path.home()/'.agents/policies/model-policy.md']
before={str(p):digest(p) for p in protected}
request=json.loads((w/'request-template.json').read_text());request['deadline']=int(time.time()*1000)+15*60*1000
save('request.json',request)
argv=[node,str(repo/'skills/the-council/scripts/run-council.mjs'),'native','--workspace',str(repo),'--input',str(w/'request.json'),'--policy',str(pathlib.Path.home()/'.agents/policies/model-policy.md'),'--orca','/usr/local/bin/orca','--config',str(repo/'skills/the-council/references/first-use-roster.yaml'),'--json']
(w/'command.txt').write_text(shlex.join(argv))
save('launch.json',{'cwd':str(repo),'host':'local macOS','wrapperPid':os.getpid(),'parentPid':os.getppid(),'node':node,'nodeVersion':subprocess.check_output([node,'--version'],text=True).strip(),'gitHead':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'argv':argv,'protectedBefore':before,'injectedTerminalHandle':os.environ.get('ORCA_TERMINAL_HANDLE'),'injectedPaneKey':os.environ.get('ORCA_PANE_KEY'),'runId':request['runId'],'question':'What is the best operating system in the world?','noGlobalSettingsChangesAuthorized':True})
started=time.monotonic()
with (w/'stdout.json').open('wb') as out,(w/'stderr.log').open('wb') as err:
 child=subprocess.Popen(argv,cwd=repo,stdin=subprocess.DEVNULL,stdout=out,stderr=err,start_new_session=True)
 save('process.json',{'pid':child.pid,'pgid':child.pid})
 timed_out=False
 while child.poll() is None:
  if time.monotonic()-started>16*60:
   timed_out=True;os.killpg(child.pid,signal.SIGTERM);break
  time.sleep(.2)
 if timed_out:
  try:child.wait(timeout=40)
  except subprocess.TimeoutExpired:
   save('unresolved.json',{'reason':'CLI did not settle after deadline/TERM; native journal/resource reconciliation required','pid':child.pid});raise RuntimeError('CLI_SETTLEMENT_UNVERIFIED')
 child.wait()
after={str(p):digest(p) for p in protected}
try:os.killpg(child.pid,0);group_absent=False
except ProcessLookupError:group_absent=True
save('completion.json',{'exitCode':child.returncode,'elapsedSeconds':round(time.monotonic()-started,3),'timedOut':timed_out,'groupAbsent':group_absent,'protectedUnchanged':before==after,'protectedDrift':[p for p in before if before[p]!=after[p]],'stdoutBytes':(w/'stdout.json').stat().st_size,'stderrBytes':(w/'stderr.log').stat().st_size})
save('stopped.json',{'wrapperPid':os.getpid(),'at':time.time()})
