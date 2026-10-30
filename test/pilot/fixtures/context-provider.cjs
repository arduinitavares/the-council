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
    if(message.id===1)emit({id:1,result:{userAgent:'synthetic'}});
    if(message.id===2)emit({id:2,result:{config:{model,model_reasoning_effort:'max',approval_policy:'never',default_permissions:'council_packet',notify:[],web_search:'disabled',features:Object.fromEntries('hooks apps plugins multi_agent multi_agent_v2 shell_tool view_image request_permissions_tool image_generation code_mode code_mode_only code_mode_host browser_use computer_use memories external_agent_memory_import standalone_web_search shell_snapshot shell_snapshot_v2 recommended_plugins remote_plugin skill_search'.split(' ').map(key=>[key,false])),agents:{enabled:false},mcp_servers:{},plugins:{},permissions:{council_packet:{filesystem:{[process.cwd()]:'read'},network:{enabled:false}}}}}});
    if(message.id===5)emit({id:5,result:{requirements:behavior==='requirements-denied'?{allowedApprovalPolicies:['on-request']}:null}});
    if(message.id===6)emit({id:6,result:{data:[{id:'council_packet',allowed:true}],nextCursor:null}});
    if(message.id===3){if(message.params.sandbox||message.params.permissions!=='council_packet')process.exit(8);emit({id:3,result:{thread:{id:'synthetic-session'},model,reasoningEffort:'max',cwd:process.cwd(),approvalPolicy:'never',activePermissionProfile:{id:behavior==='wrong-profile'?'foreign':'council_packet',extends:null},instructionSources:[]}});}
    if(message.id===4){if(behavior!=='no-turn-ack')emit({id:4,result:{turn:{id:'synthetic-turn',status:'inProgress'}}});respond(message.params.input[0].text);}
  }
}).on('close',()=>{if(protocol==='cursor-stream')respond(cursorInput.join('\n'));if(!hold&&behavior!=='final-then-hang'&&behavior!=='hang')setImmediate(()=>process.exit(0));});
