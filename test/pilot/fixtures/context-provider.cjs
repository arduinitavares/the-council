// Credential-free process fixture. Never native provider/control qualification.
// rust-v0.164.0 utils/cli/src/config_override.rs and config/src/overrides.rs:
// only the VALUE is TOML; path segments remain literal, including quotes.
function codexCliLayer(argv) {
  const root = Object.create(null);
  for (let i = 0; i < argv.length; i++) {
    let path, value;
    if (argv[i] === '-c') {
      const argument = argv[++i];
      const equals = argument.indexOf('=');
      if (equals < 0 || !argument.slice(0, equals).trim()) throw Error('Invalid override');
      path = argument.slice(0, equals).trim();
      if (path === 'use_legacy_landlock') path = 'features.use_legacy_landlock';
      const text = argument.slice(equals + 1).trim();
      try { value = require('smol-toml').parse('_x_ = ' + text)._x_; }
      catch { value = text.replace(/^["']+|["']+$/g, ''); }
    } else if (argv[i] === '--disable') { path = 'features.' + argv[++i]; value = false; }
    else continue;
    const segments = path.split('.');
    let current = root;
    for (const segment of segments.slice(0, -1)) {
      if (!Object.hasOwn(current, segment) || !current[segment] || typeof current[segment] !== 'object' || Array.isArray(current[segment])) current[segment] = Object.create(null);
      current = current[segment];
    }
    // Ordinary CLI writes replace a leaf; separate config layers merge later.
    current[segments.at(-1)] = value;
  }
  return root;
}
// config/src/state.rs:599 and merge.rs:133: high-to-low raw layers are
// recursively merged in reverse order, preserving lower per-entry settings.
function codexEffectiveConfig(layers) {
  const table = value => value && typeof value === 'object' && !Array.isArray(value);
  const merge = (base, overlay) => {
    const result = Object.assign(Object.create(null), base);
    for (const [key, value] of Object.entries(overlay)) result[key] = table(value) ? merge(table(result[key]) ? result[key] : {}, value) : value;
    return result;
  };
  return [...layers].reverse().filter(layer => layer.disabledReason == null).reduce((base, layer) => merge(base, layer.config), Object.create(null));
}
const codexFixtureConfiguration = {mcp_servers:{'fixture.mcp':{command:'never-execute',args:['preserve'],enabled:true}},plugins:{'fixture.plugin@local':{enabled:true}}};
module.exports = { codexCliLayer, codexEffectiveConfig, codexFixtureConfiguration };
if (require.main === module) main();
function main() {
const readline = require('node:readline');
const protocol = process.argv[2] || 'agy-stream';
const model = process.argv[3];
let behavior = process.argv[4] || 'normal';
const notifications = behavior.startsWith('codex-notification:') ? JSON.parse(behavior.slice('codex-notification:'.length)) : {};
if(notifications.controlBehavior)behavior=notifications.controlBehavior;
let hold=false;
let startedThreadNotification;
const emit = value => process.stdout.write(JSON.stringify(value)+'\n');
if(notifications.afterReadyEvents){
  // Keep the fake child alive briefly after stop so the input gate must check
  // the stream failure itself instead of relying on an already-closed pipe.
  process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),200));
  const timer=setInterval(()=>{
    const root=require('node:path').dirname(process.argv[5]);
    if(require('node:fs').existsSync(require('node:path').join(root,'notification-session','prepared.json'))){
      clearInterval(timer);
      for(const event of notifications.afterReadyEvents)emit(event);
      require('node:fs').appendFileSync(process.argv[5],'after-ready-event\n');
    }
  },5);
}
if (protocol === 'agy-stream' && behavior !== 'init-after-input') emit({event:'init',init:{model,cwd:process.cwd(),tools:behavior==='tools'?['run_command']:[],permission_mode:'request-review',...(behavior==='wrong-agent'?{agent:'foreign'}:process.argv.includes('--agent')?{agent:process.argv[process.argv.indexOf('--agent')+1]}:{})}});
const respond = text => {
  const packet=JSON.parse(text.slice(text.indexOf('\n')+1));
  if(behavior!=='no-turn-ack') { if(protocol==='agy-stream')emit({event:'step_update',step_update:{step_type:'user_input',state:'DONE',step_index:0,conversation_id:'synthetic-session'}}); if(protocol==='cursor-stream'){emit({type:'system',subtype:'init',model,cwd:process.cwd(),tools:[],session_id:'synthetic-session'});emit({type:'user',message:{content:'original turn accepted'}});} }
  if (packet.phase==='cancel-probe' && /^(tool-before|tool-after|error-after|auth-stderr)$/.test(behavior)) {
    hold=true;
    if(behavior==='tool-before')emit({event:'tool',tool_name:'forbidden'});
    process.on('SIGTERM',()=>{if(behavior==='tool-after')emit({event:'tool',tool_name:'forbidden'});if(behavior==='error-after')emit({event:'error',error:'failure'});if(behavior==='auth-stderr')process.stderr.write('authentication failed\n');setTimeout(()=>process.exit(0),20);});setInterval(()=>{},1000);return;
  }
  if ((packet.phase==='cancel-probe' && behavior!=='final-then-hang') || behavior==='hang') { hold=true;setInterval(()=>{},1000); return; }
  let payload={ready:true};
  if(packet.phase==='review')payload={assessment:'Supported by the supplied manifest.',objections:[]};
  if(packet.phase==='judge')payload={evidenceSupported:true,unresolved:[]};
  if(packet.phase==='ballot')payload={approve:true,reason:'The supplied evidence supports the candidate.'};
  const result={binding:packet.binding,selection:packet.selection,packetHash:packet.packetHash,phase:packet.phase,role:packet.role,payload};
  if(protocol==='agy-stream') {
    emit({event:'step_update',step_update:{step_type:'agent_response',state:'completed',step_index:1,conversation_id:'synthetic-session'}});
    emit({event:'result',result:{status:'SUCCESS',conversation_id:'synthetic-session',response:behavior==='malformed'?'{}':JSON.stringify(result)}});
  } else if(protocol==='cursor-stream') {
    emit({type:'result',subtype:'success',session_id:'synthetic-session',result:JSON.stringify(result)});
  } else {
    emit({method:'item/completed',params:{threadId:'synthetic-session',item:{type:'agentMessage',text:JSON.stringify(result)}}});
    emit({method:'turn/completed',params:{threadId:'synthetic-session',turn:{status:'completed'}}});
  }
  if(behavior==='final-then-hang')setInterval(()=>{},1000);
};
const cursorInput=[];
let inflightNotificationSent=false;
process.stdin.on('data',chunk=>{
  if(!inflightNotificationSent&&(notifications.inflightEvents||notifications.inflightThreadStarted)&&chunk.toString().includes('"method":"turn/start"')){
    inflightNotificationSent=true;
    // A large synthetic input and paused reader keep the parent's write
    // callback pending while this event arrives over the independent stdout.
    process.stdin.pause();
    for(const event of notifications.inflightEvents??[])emit(event);
    if(notifications.inflightThreadStarted)emit(startedThreadNotification);
    setTimeout(()=>process.stdin.resume(),200);
  }
});
readline.createInterface({input:process.stdin}).on('line',line=>{
  if(protocol==='agy-stream') {
    if(behavior==='init-after-input')emit({event:'init',init:{model,cwd:process.cwd(),tools:[],permission_mode:'request-review'}});
    respond(JSON.parse(line).message.content);
  } else if(protocol==='cursor-stream') cursorInput.push(line);
  else {
    const message=JSON.parse(line);
    if(process.argv[5]&&message.method)require('node:fs').appendFileSync(process.argv[5],message.method+'\n');
    if(message.id===1){emit({id:1,result:{userAgent:'synthetic'}});for(const event of notifications.startupEvents??[])emit(event);}
    if(message.id===2){
      // cli/src/main.rs AppServer forwards root_config_overrides only;
      // interactive --model / --ask-for-approval selectors do not configure it.
      const startup=process.argv.slice(6);let raw={model:'fixture-global-default',model_reasoning_effort:'low',approval_policy:'on-request'};
      Object.assign(raw, codexCliLayer(startup));
      const layers=[{name:{type:'sessionFlags'},version:'fixture-session',config:raw},
        {name:{type:'user',file:'/fixture/config.toml'},version:'fixture-user',config:{features:{hooks:true},web_search:'live',...(behavior==='configured-startup'?codexFixtureConfiguration:{})}}];
      const effective=codexEffectiveConfig(layers);
      const config=Object.fromEntries(['model','model_reasoning_effort','approval_policy','model_provider','web_search','apps'].map(key=>[key,effective[key]??null]));
      const origins={model:{name:{type:'sessionFlags'},version:'fixture-session'}};
      if(behavior==='selected-profile')raw.profile='legacy';
      if(behavior==='provider-endpoint')raw.model_providers={openai:{base_url:'https://unverified.invalid'}};
      if(behavior==='typed-provider')config.model_provider='foreign';
      if(behavior==='higher-hook')layers.unshift({name:{type:'legacyManagedConfigTomlFromMdm'},version:'fixture-managed',config:{features:{hooks:true}}});
      if(behavior==='typed-model')config.model='foreign';
      if(behavior==='typed-effort')config.model_reasoning_effort='low';
      // Match config_manager_service.rs: layers are conditional on includeLayers.
      emit({id:2,result:{config,origins,...(behavior==='missing-layers'||message.params?.includeLayers!==true?{}:{layers})}});
      if(message.params?.includeLayers===true&&process.argv[5])require('node:fs').appendFileSync(process.argv[5], 'includeLayers:true\n');
    }
    if(message.id===5)emit({id:5,result:{requirements:behavior==='requirements-denied'?{allowedApprovalPolicies:['on-request']}:behavior==='managed-instructions'?{additionalDeveloperInstructions:'unacquired'}:behavior==='managed-provider'?{modelProvider:'foreign'}:behavior==='managed-unknown'?{futureRequirement:{}}:behavior==='managed-hooks'?{featureRequirements:{hooks:true}}:behavior==='managed-permissions'?{defaultPermissions:'foreign'}:null}});
    if(message.id===6)emit({id:6,result:{data:[{id:'council_packet',allowed:true}],nextCursor:null}});
    if(message.id===3){
      const instruction=require('node:path').join(process.cwd(),'AGENTS.md');
      let instructionSources=[];
      if(['normal-instructions','duplicate-instructions','object-instructions','drift-instructions'].includes(behavior))instructionSources=[instruction];
      if(behavior==='wrong-instructions')instructionSources=['/foreign/AGENTS.md'];
      if(behavior==='duplicate-instructions')instructionSources.push(instruction);
      if(behavior==='object-instructions')instructionSources=[{path:instruction,sha256:'provider-cannot-attest-this'}];
      if(behavior==='missing-instructions')instructionSources=undefined;
      if(behavior==='drift-instructions')require('node:fs').writeFileSync(instruction,'changed after prelaunch fingerprint');
      if(message.params.sandbox||message.params.permissions!=='council_packet'||message.params.modelProvider!=='openai')process.exit(8);
      const result={thread:{id:'synthetic-session',cliVersion:'0.164.0',createdAt:0,updatedAt:0,cwd:process.cwd(),ephemeral:true,modelProvider:behavior==='wrong-thread-provider'?'foreign':behavior==='missing-thread-provider'?undefined:'openai',preview:'',projectId:null,sessionId:'synthetic-session',source:'appServer',status:{type:'idle'},turns:[]},model,modelProvider:behavior==='wrong-provider'?'foreign':behavior==='missing-provider'?undefined:'openai',sandbox:{type:'readOnly',networkAccess:false},approvalsReviewer:'user',reasoningEffort:'max',cwd:process.cwd(),approvalPolicy:'never',activePermissionProfile:{id:behavior==='wrong-profile'?'foreign':'council_packet',extends:null},instructionSources};
      const started={method:'thread/started',params:{thread:{...result.thread,...notifications.threadPatch}},...(notifications.threadStarted===true?{}:notifications.threadStarted)};
      startedThreadNotification=started;
      if(notifications.threadStartedBeforeResponse)emit(started);
      emit({id:3,result});
      // rust-v0.164.0 thread_processor.rs:1678-1711 sends the response, then
      // thread/started with the same Thread snapshot (not params.threadId).
      if(notifications.threadStarted)emit(started);
      if(notifications.repeatThreadStarted)emit(started);
    }
    if(message.id===4){if(notifications.inputThreadStarted)emit(startedThreadNotification);for(const event of notifications.inputEvents??[])emit(event);if(behavior!=='no-turn-ack')emit({id:4,result:{turn:{id:'synthetic-turn',status:'inProgress'}}});respond(message.params.input[0].text);}
  }
}).on('close',()=>{if(protocol==='cursor-stream')respond(cursorInput.join('\n'));if(!hold&&behavior!=='final-then-hang'&&behavior!=='hang')setImmediate(()=>process.exit(0));});
}
