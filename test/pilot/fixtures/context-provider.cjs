// Credential-free process fixture. Never native provider/control qualification.
const readline = require('node:readline');
const protocol = process.argv[2] || 'agy-stream';
const model = process.argv[3];
const behavior = process.argv[4] || 'normal';
let hold=false;
const emit = value => process.stdout.write(JSON.stringify(value)+'\n');
if (protocol === 'agy-stream' && behavior !== 'init-after-input') emit({event:'init',init:{model,cwd:process.cwd(),tools:behavior==='tools'?['run_command']:[],permission_mode:'request-review',...(behavior==='wrong-agent'?{agent:'foreign'}:{})}});
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
readline.createInterface({input:process.stdin}).on('line',line=>{
  if(protocol==='agy-stream') {
    if(behavior==='init-after-input')emit({event:'init',init:{model,cwd:process.cwd(),tools:[],permission_mode:'request-review'}});
    respond(JSON.parse(line).message.content);
  } else if(protocol==='cursor-stream') cursorInput.push(line);
  else {
    const message=JSON.parse(line);
    if(process.argv[5]&&message.method)require('node:fs').appendFileSync(process.argv[5],message.method+'\n');
    if(message.id===1)emit({id:1,result:{userAgent:'synthetic'}});
    if(message.id===2){
      // cli/src/main.rs AppServer forwards root_config_overrides only;
      // interactive --model / --ask-for-approval selectors do not configure it.
      const startup=process.argv.slice(6);let raw={model:'fixture-global-default',model_reasoning_effort:'low',approval_policy:'on-request'};
      const merge=(a,b)=>{for(const [key,value]of Object.entries(b))a[key]=value&&typeof value==='object'&&!Array.isArray(value)?merge(a[key]||{},value):value;return a;};
      for(let i=0;i<startup.length;i++) {
        if(startup[i]==='-c')merge(raw,require('smol-toml').parse(startup[++i]));
        else if(startup[i]==='--disable')merge(raw,{features:{[startup[++i]]:false}});
      }
      const config=Object.fromEntries(['model','model_reasoning_effort','approval_policy','model_provider','web_search','apps'].map(key=>[key,raw[key]??null]));
      const layers=[{name:{type:'sessionFlags'},version:'fixture-session',config:raw},
        {name:{type:'user',file:'/fixture/config.toml'},version:'fixture-user',config:{features:{hooks:true},web_search:'live'}}];
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
      if(message.params.sandbox||message.params.permissions!=='council_packet'||message.params.modelProvider!=='openai')process.exit(8);emit({id:3,result:{thread:{id:'synthetic-session',cliVersion:'0.164.0',createdAt:0,updatedAt:0,cwd:process.cwd(),ephemeral:true,modelProvider:behavior==='wrong-thread-provider'?'foreign':behavior==='missing-thread-provider'?undefined:'openai',preview:'',projectId:null,sessionId:'synthetic-session',source:'appServer',status:{type:'idle'},turns:[]},model,modelProvider:behavior==='wrong-provider'?'foreign':behavior==='missing-provider'?undefined:'openai',sandbox:{type:'readOnly',networkAccess:false},approvalsReviewer:'user',reasoningEffort:'max',cwd:process.cwd(),approvalPolicy:'never',activePermissionProfile:{id:behavior==='wrong-profile'?'foreign':'council_packet',extends:null},instructionSources}});}
    if(message.id===4){if(behavior!=='no-turn-ack')emit({id:4,result:{turn:{id:'synthetic-turn',status:'inProgress'}}});respond(message.params.input[0].text);}
  }
}).on('close',()=>{if(protocol==='cursor-stream')respond(cursorInput.join('\n'));if(!hold&&behavior!=='final-then-hang'&&behavior!=='hang')setImmediate(()=>process.exit(0));});
