import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { acquireAgyHookShellPolicy, instantiateAgyHookShellPolicy, hookCommand } from '../../../dist/pilot/agy-hook-shell.js';
import { agyHookShellPolicySchema, recipeSchema, producerCodeHash } from '../../../dist/pilot/wrapper-contract.js';
// Explicit, qualified-current-host check; never run by npm test or a provider.
// Usage: node test/pilot/fixtures/agy-hook-profile-check.mjs /existing/task-owned/directory
assert.equal(process.argv.length,3,'supply exactly one existing task-owned working directory');
const supplied=path.resolve(process.argv[2]);
assert.ok(fs.lstatSync(supplied).isDirectory(),'working directory must be a real directory');
assert.equal(fs.realpathSync(supplied),supplied,'working directory must be canonical, without symlinks');
assert.equal(fs.lstatSync(supplied).uid,process.getuid(),'working directory must be owned by the caller');
const root=fs.mkdtempSync(path.join(supplied,"agy-hook-check's space $literal `text`-"));
const resultPath=path.join(root,'runtime-result.json');
console.log('Results: '+resultPath);
const sha=b=>createHash('sha256').update(b).digest('hex');
const installed=path.join(homedir(),'.orca/agent-hooks/antigravity-hook.sh');
const events=['PreInvocation','PostInvocation','Stop','PreToolUse','PostToolUse'];
const descriptors=events.map(e=>({type:'command',command:hookCommand(installed,e),timeout:10}));
const args={workspace:root,executable:fs.realpathSync(path.join(homedir(),'.local/bin/agy')),version:'1.4.12',descriptors:[...descriptors,...descriptors],basePath:'/usr/bin/../bin:/bin'};
const results=[];
function check(name,fn){fn();results.push(name);console.log('PASS '+name);}
let instance;
let pythonObservation;
try {
const acquired=acquireAgyHookShellPolicy(args);
assert.ok(acquired.policy,acquired.unavailable.join(','));
const policy=acquired.policy;
check('acquisition creates no profile and preserves complete duplicate descriptor set',()=>{assert.deepEqual(fs.readdirSync(root),[]);assert.equal(policy.descriptors.length,10);assert.equal(policy.basePath,'/usr/bin:/bin');agyHookShellPolicySchema.parse(policy);});
check('additional unsupported descriptor prevents all known-hook discharge',()=>{for(const command of [descriptors[0].command+' ', "'"+installed+"' custom"]){const r=acquireAgyHookShellPolicy({...args,descriptors:[...descriptors,{type:'command',command,timeout:10}]});assert.equal(r.policy,undefined);assert.match(r.unavailable.join(),/DESCRIPTOR/);}});
check('unsupported PATH/version/executable/descriptor shapes refuse',()=>{for(const mutate of [a=>a.basePath=':/bin',a=>a.basePath='relative:/bin',a=>a.version='1.4.13',a=>a.executable='/bin/sh',a=>a.descriptors=[...descriptors,{...descriptors[0],qualified:true}]]){const a=structuredClone(args);mutate(a);assert.equal(acquireAgyHookShellPolicy(a).policy,undefined);}});
check('strict policy rejects receipt and cross-protocol attachment',()=>{assert.equal(agyHookShellPolicySchema.safeParse({...policy,qualified:true}).success,false);assert.equal(recipeSchema.safeParse({protocol:'codex-app-server',executable:'/bin/sh',argv:[],cwd:root,version:'x',selection:{route:'codex',model:'gpt-6-astra',effort:'ultra'},expectedPermission:'x',sources:[],facts:[],agyHookShell:policy}).success,false);});
check('explicit developer selection is acquired and required by the strict policy',()=>{
  assert.equal(policy.environment.DEVELOPER_DIR,'/Library/Developer/CommandLineTools','missing explicit developer selection binding');
  for(const value of [undefined,'/Applications/OtherXcode.app']){
    const p=structuredClone(policy);
    if(value===undefined)delete p.environment.DEVELOPER_DIR;else p.environment.DEVELOPER_DIR=value;
    assert.equal(agyHookShellPolicySchema.safeParse(p).success,false);
  }
});
const packetRoot=path.join(root,'.council/native-packets');fs.mkdirSync(packetRoot,{recursive:true,mode:0o700});
const directory=path.join(root,'attempt');fs.mkdirSync(directory,{mode:0o700});
const context={packetRoot,directory,assignmentHash:sha('owned-runtime-check')};
const materialize=files=>{for(const f of files)fs.writeFileSync(f.path,f.content,{mode:f.mode,flag:'wx'});};
check('policy/template/source/assignment tampering refuses before materialization',()=>{for(const mutate of [p=>p.templateHash='0'.repeat(64),p=>p.hookContent+='\n',p=>p.identities[0].target.mode=0o700,p=>p.environment.__CF_USER_TEXT_ENCODING='0x0:0:0',p=>delete p.environment.DEVELOPER_DIR,p=>p.environment.DEVELOPER_DIR='/Applications/OtherXcode.app']){const p=structuredClone(policy);mutate(p);assert.throws(()=>instantiateAgyHookShellPolicy(p,context,()=>{throw Error('MATERIALIZED');}),/POLICY_DRIFT/);}assert.throws(()=>instantiateAgyHookShellPolicy(policy,{...context,assignmentHash:'unbound'},materialize),/ASSIGNMENT_SCOPE/);});
instance=instantiateAgyHookShellPolicy(policy,context,materialize);
const bin=instance.launchPath.split(':')[0], adapter=path.join(bin,'sh'), copy=path.join(bin,'hook.sh'), run=path.dirname(bin), empty=path.join(run,'empty'), scratch=path.join(run,'scratch');
const report=JSON.parse(fs.readFileSync(instance.reportPath));
check('instance binds actual custody, assignment and producer with separate roots',()=>{assert.equal(report.assignmentHash,context.assignmentHash);assert.equal(report.producerHash,producerCodeHash());assert.equal(report.instanceHash,instance.instanceHash);for(const [p,m]of[[bin,0o500],[empty,0o500],[scratch,0o700],[adapter,0o500],[copy,0o500],[path.join(bin,'verify-hook.mjs'),0o400]])assert.equal(fs.lstatSync(p).mode&0o7777,m);assert.deepEqual(fs.readdirSync(empty),[]);});
check('existing valid artifacts are verified and attempt reports remain exclusive',()=>{assert.throws(()=>instantiateAgyHookShellPolicy(policy,context,files=>{for(const f of files){assert.equal(sha(fs.readFileSync(f.path)),f.sha256);assert.equal(fs.lstatSync(f.path).mode&0o7777,f.mode);}}),/EEXIST/);assert.deepEqual(JSON.parse(fs.readFileSync(instance.reportPath)),report);});
const sentinel=path.join(root,'endpoint.sentinel');const startup=path.join(root,'startup.sh');fs.writeFileSync(startup,`printf reached > '${sentinel.replaceAll("'","'\\''")}'\nexit 93\n`,{mode:0o400});
const py=path.join(root,'python');fs.mkdirSync(py);fs.writeFileSync(path.join(py,'sitecustomize.py'),"raise Exception('hostile startup')\n");
const hostile={DEVELOPER_DIR:'/nonexistent/hostile-developer-selection',PATH:instance.launchPath,HOME:root,TMPDIR:root,ORCA_AGENT_HOOK_ENDPOINT:startup,ORCA_PANE_KEY:'fake-pane',ORCA_AGENT_HOOK_TOKEN:'fake-token',ENV:startup,BASH_ENV:startup,SHELLOPTS:'xtrace',PYTHONPATH:py,PYTHONHOME:py,PYTHONSTARTUP:startup,NODE_OPTIONS:'--require='+path.join(root,'nonexistent.cjs'),__CF_USER_TEXT_ENCODING:'fake-inherited',SETUPTOOLS_USE_DISTUTILS:'local','BASH_FUNC_printf%%':`() { /bin/sh '${startup}'; }`};
let seq=0;
function execute(argv,env=hostile){const input=path.join(root,'stdin-'+seq++);fs.writeFileSync(input,'invalid json'.repeat(4096));const fd=fs.openSync(input,'r');let r,remaining;try{r=spawnSync(adapter,argv,{env,cwd:root,stdio:[fd,'pipe','pipe'],encoding:'utf8',timeout:15000,killSignal:'SIGKILL',detached:true});remaining=fs.readSync(fd,Buffer.alloc(1),0,1,null);}finally{fs.closeSync(fd);}assert.equal(r.error,undefined,r.error?.message);assert.equal(r.signal,null);let gone=false;try{process.kill(-r.pid,0);}catch(e){if(e.code==='ESRCH')gone=true;else throw e;}assert.equal(gone,true);return {...r,remaining};}
const expected=['{}\n','{}\n','{"decision":""}\n','{"decision":"ask"}\n','{}\n'];
for(let i=0;i<5;i++)check(events[i]+' preserves JSON, drains stdin and excludes hostile inputs',()=>{const r=execute(['-c',descriptors[i].command]);assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,expected[i]);assert.equal(r.stderr,'');assert.equal(r.remaining,0);assert.equal(fs.existsSync(sentinel),false);});
check('unrelated shell commands retain inherited environment',()=>{const r=execute(['-c','printf "%s" "$BENIGN_VALUE"'],{PATH:'/usr/bin:/bin',BENIGN_VALUE:'preserved'});assert.equal(r.status,0);assert.equal(r.stdout,'preserved');});
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
check('raw and quoted unknown hook references never delegate',()=>{for(const p of [installed,copy])for(const form of [p,quote(p),quote(quote(p))]){const r=execute(['-c','echo before; '+form+' unexpected']);assert.equal(r.status,76);assert.equal(r.stdout,'');}assert.equal(execute(['-xc',descriptors[0].command]).status,76);});
const alias=path.join(root,'ordinary-alias');fs.symlinkSync(installed,alias);
// Keep the original relative-alias assertion meaningful in the provider cwd too.
fs.symlinkSync(installed,path.join(packetRoot,'ordinary-alias'));
const alternateReferences=[installed.replace('/antigravity','/./antigravity'),installed.replace('/agent-hooks/','/agent-hooks/../agent-hooks/'),installed.replace('/agent-hooks/','//agent-hooks///'),quote(installed.replace('/antigravity','/./antigravity')),'"'+installed.replace('/antigravity','/./antigravity')+'"','"$HOME/.orca/agent-hooks/antigravity-hook.sh"','"${HOME}/.orca/agent-hooks/antigravity-hook.sh"','~/.orca/agent-hooks/antigravity-hook.sh',quote(alias),'./ordinary-alias'];
check('alternate and indirect references refuse before inherited fallback, without running the hook',()=>{
  for(const reference of alternateReferences){const r=execute(['-c',`if false; then /bin/sh ${reference}; fi; printf '%s' "$INERT_MARKER"`],{PATH:'/usr/bin:/bin',HOME:homedir(),INERT_MARKER:'FALLBACK_LEAK'});assert.equal(r.status,76,reference+': '+r.stderr);assert.equal(r.stdout,'');assert.match(r.stderr,/UNRECOGNIZED_ORCA_COMMAND/);}
});
check('shell line continuation cannot conceal the known source',()=>{
  const reference=installed.replace('.orca','.or\\\nca').replace('antigravity-hook','antigravity-ho\\\nok');
  const r=execute(['-c',`if false; then /bin/sh ${reference}; fi; printf '%s' "$INERT_MARKER"`],{PATH:'/usr/bin:/bin',INERT_MARKER:'FALLBACK_LEAK'});
  assert.equal(r.status,76,r.stderr);assert.equal(r.stdout,'');
});
check('acquisition refuses every alternate extra descriptor instead of omitting it',()=>{
  for(const reference of alternateReferences){const r=acquireAgyHookShellPolicy({...args,descriptors:[...descriptors,{type:'command',command:`if false; then /bin/sh ${reference}; fi`,timeout:10}]});assert.equal(r.policy,undefined,reference);assert.deepEqual(r.unavailable,['AGY_HOOK_DESCRIPTOR_UNSUPPORTED']);}
});
check('copied-hook aliases also refuse and ordinary nested shells preserve their environment',()=>{
  const copyAlias=path.join(root,'copied-alias');fs.symlinkSync(copy,copyAlias);
  for(const reference of [quote(copy.replace('/hook.sh','/./hook.sh')),quote(copyAlias)]){
    const r=execute(['-c',`if false; then /bin/sh ${reference}; fi; printf '%s' "$INERT_MARKER"`],{PATH:'/usr/bin:/bin',INERT_MARKER:'FALLBACK_LEAK'});
    assert.equal(r.status,76,reference+': '+r.stderr);assert.equal(r.stdout,'');
  }
  for(const command of ['/bin/sh -c \'printf "%s" "$BENIGN_VALUE"\'','/usr/bin/env /bin/sh -c \'printf "%s" "$BENIGN_VALUE"\'']){
    const r=execute(['-c',command],{PATH:'/usr/bin:/bin',BENIGN_VALUE:'preserved'});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'preserved');
  }
});
check('UID-derived explicit CF environment survives actual clean Node child',()=>{const environment={...policy.environment,HOME:empty,TMPDIR:scratch};const r=spawnSync('/usr/bin/env',['-i',...Object.entries(environment).map(([k,v])=>k+'='+v),policy.node,'-e','process.stdout.write(JSON.stringify(process.env))'],{encoding:'utf8',cwd:empty});assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout),environment);assert.equal(environment.__CF_USER_TEXT_ENCODING,'0x'+process.getuid().toString(16).toUpperCase()+':0:0');});
const computedBodies=[
  'if false; then "$a$b$c"; fi', 'false && "$a$b$c"', 'true || "$a$b$c"',
  'if false; then :; "$a$b$c"; fi', 'if false; then :\n"$a$b$c"; fi',
  'if false; then : | "$a$b$c"; fi', 'f() { "$a$b$c"; }; :',
  'if false; then 2>/dev/null "$a$b$c"; fi',
  'if false; then 2>&1 "$a$b$c"; fi', 'alias invoke=\'"$a$b$c"\'; if false; then invoke; fi',
  'if false; then trap \'"$a$b$c"\' EXIT; fi',
  'if false; then /bin/sh -o errexit -c \'"$a$b$c"\'; fi',
  'if false; then ( "$a$b$c" ); fi', 'if false; then { "$a$b$c"; }; fi',
  'if false; then exec "$a$b$c"; fi', 'if false; then command "$a$b$c"; fi',
  'if false; then /usr/bin/env "$a$b$c"; fi',
  'if false; then printf "%s" "$("$a$b$c")"; fi',
  'if false; then printf "%s" `"$a$b$c"`; fi',
  'if false; then /bin/sh "$REF"; fi',
];
const computedCommands=computedBodies.map(body=>'/bin/sh -c '+quote(`a=${quote(homedir()+'/.or')}; b=ca/agent-hooks/antigravity; c=-hook.sh\n${body}\nprintf '%s' "$BENIGN_VALUE"`));
check('computed command positions reject whole acquisition without evaluating branches',()=>{
  for(const command of computedCommands){const r=acquireAgyHookShellPolicy({...args,descriptors:[...descriptors,{type:'command',command,timeout:10}]});assert.equal(r.policy,undefined,command);assert.deepEqual(r.unavailable,['AGY_HOOK_DESCRIPTOR_UNSUPPORTED']);}
});
check('materialized adapter refuses computed commands at every supported boundary',()=>{
  for(const command of computedCommands){const r=execute(['-c',command],{PATH:'/usr/bin:/bin',BENIGN_VALUE:'INHERITED_FALLBACK_MARKER'});assert.equal(r.status,76,command+': '+r.stderr);assert.equal(r.stdout,'');assert.match(r.stderr,/UNRECOGNIZED_ORCA_COMMAND/);}
});
check('acquisition binds provider cwd and rejects aliases from that cwd',()=>{
  assert.equal(policy.executionCwd,packetRoot);
  const r=acquireAgyHookShellPolicy({...args,descriptors:[...descriptors,{type:'command',command:'/bin/sh ../../ordinary-alias',timeout:10}]});
  assert.equal(r.policy,undefined);assert.deepEqual(r.unavailable,['AGY_HOOK_DESCRIPTOR_UNSUPPORTED']);
  const p=spawnSync(adapter,['-c','if false; then /bin/sh ../../ordinary-alias; fi; printf "%s" "$BENIGN_VALUE"'],{cwd:packetRoot,env:{PATH:'/usr/bin:/bin',BENIGN_VALUE:'INHERITED_FALLBACK_MARKER'},encoding:'utf8',timeout:10000});
  assert.equal(p.status,76,p.stderr);assert.equal(p.stdout,'');
});
check('absent first-use packet cwd stays read-only and relative uncertainty refuses',()=>{
  const first=path.join(root,'first-use');fs.mkdirSync(first);
  fs.symlinkSync(installed,path.join(first,'ordinary-alias'));
  const r=acquireAgyHookShellPolicy({...args,workspace:first,descriptors:[...descriptors,{type:'command',command:'/bin/sh ../../ordinary-alias',timeout:10}]});
  assert.equal(r.policy,undefined);assert.deepEqual(r.unavailable,['AGY_HOOK_DESCRIPTOR_UNSUPPORTED']);assert.equal(fs.existsSync(path.join(first,'.council')),false);
});
check('ordinary arguments and compound nested shells preserve inherited values',()=>{
  for(const body of ['if true; then printf "%s" "$BENIGN_VALUE"; fi','f() { printf "%s" "$BENIGN_VALUE"; }; f','printf "%s" "$BENIGN_VALUE" && :','echo "$BENIGN_VALUE"']){
    const r=execute(['-c','/bin/sh -c '+quote(body)],{PATH:'/usr/bin:/bin',BENIGN_VALUE:'preserved'});assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'preserved');
  }
});
check('explicit selection resolves the actual clean Python child to the bound CLT runtime',()=>{
  const environment={...policy.environment,HOME:empty,TMPDIR:scratch};
  const code='import json, os, sys; print(json.dumps(dict(prefix=sys.prefix, base_prefix=sys.base_prefix, executable=sys.executable, real_executable=os.path.realpath(sys.executable), environment=dict(os.environ))))';
  const r=spawnSync('/usr/bin/env',['-i',...Object.entries(environment).map(([k,v])=>k+'='+v),'/usr/bin/python3','-c',code],{env:hostile,encoding:'utf8',cwd:empty,timeout:10000,killSignal:'SIGKILL',detached:true});
  assert.equal(r.error,undefined,r.error?.message);assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');
  let gone=false;try{process.kill(-r.pid,0);}catch(e){if(e.code==='ESRCH')gone=true;else throw e;}assert.equal(gone,true);
  pythonObservation=JSON.parse(r.stdout);
  assert.equal(pythonObservation.prefix,'/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9');
  assert.equal(pythonObservation.base_prefix,pythonObservation.prefix);
  assert.equal(pythonObservation.real_executable,policy.identities.find(s=>s.path==='/Library/Developer/CommandLineTools/usr/bin/python3').realpath);
  // The source-bound Apple shim adds these exact values on this qualified host.
  // xcrun(1) documents CPATH, LIBRARY_PATH and SDKROOT; MANPATH is observed.
  // This is an exact current-host assertion, not an arbitrary-extra-key exception.
  assert.deepEqual(pythonObservation.environment,{
    ...environment,CPATH:'/usr/local/include',LIBRARY_PATH:'/usr/local/lib',
    SDKROOT:'/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk',
    MANPATH:'/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/share/man:/Library/Developer/CommandLineTools/usr/share/man:/Library/Developer/CommandLineTools/Toolchains/XcodeDefault.xctoolchain/usr/share/man:',
  });
  console.log('Python: '+JSON.stringify({prefix:pythonObservation.prefix,executable:pythonObservation.executable,real_executable:pythonObservation.real_executable,DEVELOPER_DIR:pythonObservation.environment.DEVELOPER_DIR}));
});
const shellEffectBodies=[
  'hash -p "$a$b$c" x; x', 'command hash -p "$a$b$c" x; x', 'builtin hash -p "$a$b$c" x; x',
  'enable -n printf', 'enable -f "$a$b$c" x', 'builtin unknown_builtin',
  'builtin printf -v TARGET "%s" value', 'printf "$FORMAT" value',
  'printf -- "$FORMAT" value', 'printf "%n" TARGET', 'printf "%10n" TARGET', 'printf -- "%n" TARGET',
  'export TARGET=value', 'set -f', 'read TARGET', 'unset TARGET', 'let "$EXPR"',
  'eval "$CODE"', 'source file', '. file', 'hash',
  'printf \'%s\\n\' "$a$b$c" | /bin/sh', '/bin/sh', '/bin/sh; :', '/bin/sh\nprintf ok',
  '/bin/sh | :', '( /bin/sh )', 'f() { /bin/sh; }; :',
  '/bin/sh -s', '/bin/sh -', '/bin/sh +s', '/bin/sh /dev/stdin', '/bin/sh /dev/fd/0',
  '/bin/sh /dev/null', '/bin/sh </dev/null', '/bin/sh -c \'/bin/sh\'',
  '/usr/bin/env /bin/sh', 'exec', 'builtin', 'command',
];
const shellEffectCommands=shellEffectBodies.map(body=>'/bin/sh -c '+quote(`a=${quote(homedir()+'/.or')}; b=ca/agent-hooks/antigravity; c=-hook.sh\nif false; then ${body}; fi\nprintf '%s' "$BENIGN_VALUE"`));
check('unsupported builtin effects and program sources reject complete acquisition',()=>{
  for(const command of shellEffectCommands){const r=acquireAgyHookShellPolicy({...args,descriptors:[...descriptors,{type:'command',command,timeout:10}]});assert.equal(r.policy,undefined,command);assert.deepEqual(r.unavailable,['AGY_HOOK_DESCRIPTOR_UNSUPPORTED']);}
});
check('fresh adapter refuses unsupported builtin effects and program sources before delegation',()=>{
  for(const command of shellEffectCommands){const r=execute(['-c',command],{PATH:'/usr/bin:/bin',BENIGN_VALUE:'INHERITED_FALLBACK_MARKER'});assert.equal(r.status,76,command+': '+r.stderr);assert.equal(r.stdout,'');assert.ok(r.remaining>0,'classifier must not consume stdin');}
});
check('stdin aliases and nonregular shell files refuse without reading their contents',()=>{
  const inputAlias=path.join(root,'input-alias');fs.symlinkSync('/dev/stdin',inputAlias);
  const fdDirectory=path.join(root,'fd-directory');fs.symlinkSync('/dev/fd',fdDirectory);
  for(const file of [inputAlias,path.join(fdDirectory,'0'),root]){
    const command='if false; then /bin/sh '+quote(file)+'; fi; printf "%s" "$BENIGN_VALUE"';
    const r=acquireAgyHookShellPolicy({...args,descriptors:[...descriptors,{type:'command',command,timeout:10}]});assert.equal(r.policy,undefined,file);assert.deepEqual(r.unavailable,['AGY_HOOK_DESCRIPTOR_UNSUPPORTED']);
    const p=execute(['-c',command],{PATH:'/usr/bin:/bin',BENIGN_VALUE:'INHERITED_FALLBACK_MARKER'});assert.equal(p.status,76,file+': '+p.stderr);assert.equal(p.stdout,'');assert.ok(p.remaining>0);
  }
});
check('outer empty stdin and unclassified option forms refuse harmless piped code',()=>{
  // A real file named like an option must not make that option a file program.
  fs.writeFileSync(path.join(root,'+s'),'inert');fs.writeFileSync(path.join(packetRoot,'+s'),'inert');
  const acquired=acquireAgyHookShellPolicy({...args,descriptors:[...descriptors,{type:'command',command:'/bin/sh +s',timeout:10}]});
  assert.equal(acquired.policy,undefined);assert.deepEqual(acquired.unavailable,['AGY_HOOK_DESCRIPTOR_UNSUPPORTED']);
  for(const argv of [[],['-s'],['-'],['+s'],['--'],['-c'],['-xc','printf ignored'],['/dev/stdin'],['/dev/fd/0']]){
    const r=spawnSync(adapter,argv,{cwd:root,env:{PATH:'/usr/bin:/bin',BENIGN_VALUE:'INHERITED_FALLBACK_MARKER'},input:'printf "%s" "$BENIGN_VALUE"\n',encoding:'utf8',timeout:10000});
    assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,76,JSON.stringify(argv)+': '+r.stderr);assert.equal(r.stdout,'');
  }
});
check('IO numbers cannot satisfy shell program sources or conceal printf state forms',()=>{
  for(const d of [root,packetRoot])fs.writeFileSync(path.join(d,'0'),'printf "%s" "$BENIGN_VALUE"\n',{mode:0o400});
  for(const body of ['/bin/sh 0</dev/null','printf 2>/dev/null "%n" TARGET']){
    const command='if false; then '+body+'; fi; printf "%s" "$BENIGN_VALUE"';
    const a=acquireAgyHookShellPolicy({...args,descriptors:[...descriptors,{type:'command',command,timeout:10}]});assert.equal(a.policy,undefined,body);assert.deepEqual(a.unavailable,['AGY_HOOK_DESCRIPTOR_UNSUPPORTED']);
    const r=execute(['-c',command],{PATH:'/usr/bin:/bin',BENIGN_VALUE:'INHERITED_FALLBACK_MARKER'});assert.equal(r.status,76,body+': '+r.stderr);assert.equal(r.stdout,'');assert.ok(r.remaining>0);
  }
  for(const command of ["/bin/sh '0'</dev/null",'/bin/sh 0 </dev/null']){
    const r=execute(['-c',command],{PATH:'/usr/bin:/bin',BENIGN_VALUE:'preserved'});assert.equal(r.status,0,command+': '+r.stderr);assert.equal(r.stdout,'preserved');
  }
});
check('supported consumers prefixes files and stdin retain ordinary environment and input',()=>{
  const script=path.join(root,'ordinary-script');fs.writeFileSync(script,'printf "%s" "$BENIGN_VALUE"; /bin/cat\n',{mode:0o400});
  const scriptAlias=path.join(root,'ordinary-script-alias');fs.symlinkSync(script,scriptAlias);
  for(const command of ['printf "%s" "$BENIGN_VALUE"','printf -- "%s" "$BENIGN_VALUE"','echo "$BENIGN_VALUE"','command printf "%s" "$BENIGN_VALUE"','builtin printf "%s" "$BENIGN_VALUE"','exec /usr/bin/printf "%s" "$BENIGN_VALUE"','/usr/bin/env VALUE="$BENIGN_VALUE" /bin/sh -c \'printf "%s" "$VALUE"\'','/bin/sh '+quote(script),'if [ -n "$BENIGN_VALUE" ]; then printf "%s" "$BENIGN_VALUE"; fi','if true; then :; fi; printf "%s" "$BENIGN_VALUE"','f() { printf "%s" "$BENIGN_VALUE"; }; f']){
    const r=execute(['-c',command],{PATH:'/usr/bin:/bin',BENIGN_VALUE:'preserved'});assert.equal(r.status,0,command+': '+r.stderr);assert.ok(r.stdout.startsWith('preserved'),command);
  }
  for(const argv of [['-c','/bin/cat'],[script],[scriptAlias],['-c','/bin/sh '+quote(scriptAlias)]]){
    const r=spawnSync(adapter,argv,{cwd:root,env:{PATH:'/usr/bin:/bin',BENIGN_VALUE:'preserved'},input:'ordinary input',encoding:'utf8',timeout:10000});
    assert.equal(r.error,undefined);assert.equal(r.status,0,JSON.stringify(argv)+': '+r.stderr);assert.equal(r.stdout,argv[1]==='/bin/cat'?'ordinary input':'preservedordinary input');
  }
});
const prefixLookaheadBodies=[
  'command 2>/dev/null -p "$a$b$c"', 'exec >/dev/null -- "$a$b$c"',
  '/usr/bin/env A=1 -i "$a$b$c"', '/usr/bin/command "$a$b$c"',
  '/bin/sh -c 2>/dev/null "$a$b$c"', '/bin/sh -c 0</dev/null \'hash -p "$a$b$c" x; x\'',
  'command 2>/dev/null -p hash -p "$a$b$c" x; x',
  'command 2>/dev/null -p /bin/sh', '/bin/sh -c 2>/dev/null \'/bin/sh\'',
];
const prefixLookaheadCommands=prefixLookaheadBodies.map(body=>'/bin/sh -c '+quote(`a=${quote(homedir()+'/.or')}; b=ca/agent-hooks/antigravity; c=-hook.sh\nif false; then ${body}; fi\nprintf '%s' "$BENIGN_VALUE"`));
check('pending prefix options and nested IO-number bodies reject whole acquisition',()=>{
  // env A=1 -i is unsupported syntax here, not an asserted macOS execution path.
  for(const command of prefixLookaheadCommands){const a=acquireAgyHookShellPolicy({...args,descriptors:[...descriptors,{type:'command',command,timeout:10}]});assert.equal(a.policy,undefined,command);assert.deepEqual(a.unavailable,['AGY_HOOK_DESCRIPTOR_UNSUPPORTED']);}
});
check('fresh adapter refuses prefix lookahead cases without inherited fallback',()=>{
  for(const command of prefixLookaheadCommands){const r=execute(['-c',command],{PATH:'/usr/bin:/bin',BENIGN_VALUE:'INHERITED_FALLBACK_MARKER'});assert.equal(r.status,76,command+': '+r.stderr);assert.equal(r.stdout,'');assert.match(r.stderr,/UNRECOGNIZED_ORCA_COMMAND/);assert.ok(r.remaining>0);}
});
check('no-option prefixes retain redirections assignments arguments and nested literal bodies',()=>{
  for(const command of [
    'command 2>/dev/null printf "%s" "$BENIGN_VALUE"',
    'exec 2>/dev/null /usr/bin/printf "%s" "$BENIGN_VALUE"',
    '/usr/bin/env 2>/dev/null VALUE="$BENIGN_VALUE" /bin/sh -c \'printf "%s" "$VALUE"\'',
    '/usr/bin/env VALUE="$BENIGN_VALUE" 2>/dev/null /bin/sh -c \'printf "%s" "$VALUE"\'',
    '/usr/bin/command printf "%s" "$BENIGN_VALUE"',
    '/bin/sh -c \'printf "%s" "$BENIGN_VALUE"\' 2>/dev/null',
  ]){
    const a=acquireAgyHookShellPolicy({...args,descriptors:[...descriptors,{type:'command',command,timeout:10}]});assert.ok(a.policy,command+': '+a.unavailable.join());assert.deepEqual(a.unavailable,[]);
    const r=execute(['-c',command],{PATH:'/usr/bin:/bin',BENIGN_VALUE:'preserved'});assert.equal(r.status,0,command+': '+r.stderr);assert.equal(r.stdout,'preserved');assert.ok(r.remaining>0);
  }
});
check('copy drift refuses in the actual clean verifier',()=>{const bytes=fs.readFileSync(copy);fs.chmodSync(copy,0o700);fs.writeFileSync(copy,Buffer.concat([bytes,Buffer.from('\n# drift\n')]));fs.chmodSync(copy,0o500);try{const r=execute(['-c',descriptors[0].command]);assert.equal(r.status,76);assert.match(r.stderr,/FILE_BYTES/);}finally{fs.chmodSync(copy,0o700);fs.writeFileSync(copy,bytes);fs.chmodSync(copy,0o500);}});
check('invalid existing executable mode refuses without repair before PATH lookup',()=>{fs.chmodSync(adapter,0o600);try{assert.throws(()=>instantiateAgyHookShellPolicy(policy,context,materialize),/FILE_CUSTODY/);assert.equal(fs.lstatSync(adapter).mode&0o7777,0o600);}finally{fs.chmodSync(adapter,0o500);}});
check('invalid existing directories refuse without repair',()=>{for(const p of [bin,empty,scratch]){const mode=fs.lstatSync(p).mode&0o7777;fs.chmodSync(p,0o755);try{assert.throws(()=>instantiateAgyHookShellPolicy(policy,context,materialize),/DIRECTORY_CUSTODY/);assert.equal(fs.lstatSync(p).mode&0o7777,0o755);}finally{fs.chmodSync(p,mode);}}});
check('missing existing profile roots refuse without reconstruction',()=>{const saved=empty+'-saved';fs.renameSync(empty,saved);try{assert.throws(()=>instantiateAgyHookShellPolicy(policy,context,materialize),/ENOENT|DIRECTORY_CUSTODY/);assert.equal(fs.existsSync(empty),false);}finally{if(fs.existsSync(empty))fs.rmdirSync(empty);fs.renameSync(saved,empty);}});
check('nonempty HOME/cwd refuses',()=>{fs.chmodSync(empty,0o700);fs.writeFileSync(path.join(empty,'unexpected'),'test');fs.chmodSync(empty,0o500);assert.throws(()=>instantiateAgyHookShellPolicy(policy,context,materialize),/HOME_CWD_NOT_EMPTY/);assert.equal(execute(['-c',descriptors[0].command]).status,76);});
fs.writeFileSync(resultPath,JSON.stringify({root,results,pass:true,liveAgy:false,instance,pythonObservation,producerHash:producerCodeHash(),limits:['local hook stand-in only','system runtime/helper/cache trust remains explicit','no proof of total containment or outside-TMP cache effects']},null,2)+'\n',{flag:'wx',mode:0o600});
console.log('PASS '+results.length+' checks; no provider launched');

} catch(error) {
  fs.writeFileSync(resultPath,JSON.stringify({root,results,pass:false,liveAgy:false,instance,pythonObservation,error:String(error)},null,2)+'\n',{flag:'wx',mode:0o600});
  console.error('FAIL after '+results.length+' checks: '+error);
  process.exitCode=1;
}

