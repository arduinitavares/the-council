// Development-only source, deliberately excluded from adapter exports/build/package.
// Genuine native wrapper caller authority is unqualified; do not integrate or
// invoke the mutation-capable relay until that separate qualification succeeds.
import {spawn} from "node:child_process";
import {realpathSync} from "node:fs";
import {isAbsolute} from "node:path";
import {canonicalJson} from "../domain/hash.js";
import {decodeStrictJson} from "../workers/strict-json.js";
import type {Command} from "./orca-driver.js";
import type {Attempt,Result} from "./types.js";
import {pilotPayloadSchemas} from "./payload.js";

export interface HostProcessReceipt {
  pid:number|null;
  exitCode:number|null;
  signal:string|null;
  closed:boolean;
  timedOut:boolean;
  overflow:boolean;
  inputDelivered:boolean;
  groupSettled:boolean;
  timersSettled:boolean;
  stopRequests:number;
  stdout:Uint8Array;
  stderr:Uint8Array;
  cwd:string;
}
const ownedReceipts=new WeakMap<HostProcessReceipt,HostProcessReceipt>();

/** Host-side primitive, not route admission. The caller must establish effective
 * controls before invoking it. It grants the provider no Orca lifecycle tools.
 * Process-group absence proves only that group; escaped children still need the
 * execution host's independently qualified containment/enumeration evidence. */
export async function runGuardedHostCommand(input:{
  executable:string;args:readonly string[];cwd:string;input:string;deadline:number;
  environment?:NodeJS.ProcessEnv;maxBytes?:number;
}):Promise<HostProcessReceipt> {
  const remaining=input.deadline-Date.now();
  if(process.platform!=="darwin"&&process.platform!=="linux")throw Error("HOST_PROCESS_GROUP_UNSUPPORTED");
  if(!Number.isSafeInteger(input.deadline)||remaining<=0||remaining>120000) throw Error("HOST_INFERENCE_DEADLINE");
  if(!isAbsolute(input.executable)||realpathSync(input.cwd)!==input.cwd||!input.args.every(a=>!a.includes("\0"))) throw Error("HOST_COMMAND_SCOPE_INVALID");
  const max=input.maxBytes??1024*1024;
  if(!Number.isSafeInteger(max)||max<1||max>1024*1024) throw Error("HOST_OUTPUT_BOUND_INVALID");
  const environment=Object.fromEntries(Object.entries(input.environment??process.env).filter(([key,value])=>value!==undefined&&!key.startsWith("ORCA_")));
  const child=spawn(realpathSync(input.executable),[...input.args],{cwd:input.cwd,env:environment,detached:true,shell:false,stdio:["pipe","pipe","pipe"]});
  let closed=false,exitCode:number|null=null,signal:string|null=null,timedOut=false,overflow=false,inputDelivered=false;
  let size=0,stopRequests=0;
  const stdout:Buffer[]=[],stderr:Buffer[]=[];
  let escalation:ReturnType<typeof setTimeout>|undefined;
  const timers=new Set<ReturnType<typeof setTimeout>>();
  const schedule=(callback:()=>void,ms:number)=>{
    const timer=setTimeout(()=>{timers.delete(timer);callback();},ms);
    timers.add(timer);return timer;
  };
  const cancelTimer=(timer:ReturnType<typeof setTimeout>|undefined)=>{
    if(timer){clearTimeout(timer);timers.delete(timer);}
  };
  const groupState=():"live"|"exited"|"unknown"=>{
    if(!child.pid)return "unknown";
    try{process.kill(-child.pid,0);return "live";}catch(error){return (error as NodeJS.ErrnoException).code==="ESRCH"?"exited":"unknown";}
  };
  const signalGroup=(value:NodeJS.Signals)=>{
    if(child.pid&&groupState()==="live")try{process.kill(-child.pid,value);}catch{}
  };
  const stop=()=>{
    if(stopRequests)return;
    stopRequests++;
    signalGroup("SIGTERM");
    escalation=schedule(()=>signalGroup("SIGKILL"),1000);
  };
  const collect=(chunks:Buffer[],chunk:Buffer)=>{
    const room=Math.max(0,max-size);size+=chunk.length;
    if(room)chunks.push(Buffer.from(chunk.subarray(0,room)));
    if(size>max){overflow=true;stop();}
  };
  child.stdout.on("data",chunk=>collect(stdout,chunk));
  child.stderr.on("data",chunk=>collect(stderr,chunk));
  child.on("error",()=>{});
  child.stdin.on("error",()=>{inputDelivered=false;});
  child.stdin.end(input.input,"utf8",(error?:Error|null)=>{inputDelivered=!error&&child.stdin.writableFinished;});
  const completion=new Promise<void>(resolve=>child.once("close",(code,why)=>{closed=true;exitCode=code;signal=why;resolve();}));
  const deadlineTimer=schedule(()=>{timedOut=true;stop();},Math.max(0,input.deadline-Date.now()));
  let observationTimer:ReturnType<typeof setTimeout>|undefined;
  // This grace observes/terminates only the original process group, never starts inference.
  const cleanupDeadline=input.deadline+2500;
  await Promise.race([completion,new Promise<void>(resolve=>{observationTimer=schedule(resolve,Math.max(0,cleanupDeadline-Date.now()));})]);
  cancelTimer(observationTimer);
  while(groupState()==="live"&&Date.now()<cleanupDeadline)await new Promise<void>(resolve=>schedule(resolve,10));
  const groupSettled=groupState()==="exited";
  cancelTimer(deadlineTimer);
  cancelTimer(escalation);
  const receipt:HostProcessReceipt={pid:child.pid??null,exitCode,signal,closed,timedOut,overflow,inputDelivered,groupSettled,timersSettled:timers.size===0,stopRequests,stdout:Buffer.concat(stdout),stderr:Buffer.concat(stderr),cwd:input.cwd};
  // Return unresolved facts without leaving this wrapper's streams/timers pending.
  if(!closed){child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();child.unref();}
  ownedReceipts.set(receipt,{...receipt,stdout:Uint8Array.from(receipt.stdout),stderr:Uint8Array.from(receipt.stderr)});
  return Object.freeze(receipt);
}

/** Bound to the real AGY 1.4.10 stream contract observed in the task-owned review
 * wrapper: init.model/cwd/tools/permission_mode and result.status/response/
 * conversation_id. These fields do not establish sandbox, effort, hooks or roots.
 * This component must run in the task-created wrapper's genuine native caller
 * context; a coordinator cannot impersonate a child via --from. */
export class HostCompletionRelay {
  private readonly attempted=new Set<string>();
  constructor(private readonly command:Command){}
  async complete(attempt:Attempt,receipt:HostProcessReceipt,cwd:string):Promise<Result>{
    if(this.attempted.has(attempt.binding.dispatchId))throw Error("HOST_COMPLETION_ALREADY_ATTEMPTED");
    const owned=ownedReceipts.get(receipt);
    if(!owned)throw Error("HOST_PROCESS_RECEIPT_NOT_OWNED");
    receipt=owned;
    if(!receipt.closed||receipt.exitCode!==0||receipt.signal!==null||receipt.timedOut||receipt.overflow||!receipt.inputDelivered||!receipt.groupSettled||!receipt.timersSettled||receipt.stderr.length)throw Error("HOST_PROVIDER_NOT_SETTLED_SUCCESSFULLY");
    if(attempt.selection.route!=="antigravity"||receipt.cwd!==cwd)throw Error("HOST_PROVIDER_CONTRACT_UNSUPPORTED");
    let events:any[];
    try{events=new TextDecoder("utf-8",{fatal:true}).decode(receipt.stdout).split("\n").filter(line=>line.trim()).map(line=>decodeStrictJson(line));}
    catch{throw Error("HOST_FINAL_STREAM_UNVERIFIED");}
    const inits=events.filter(e=>e.event==="init"),finals=events.filter(e=>e.event==="result");
    if(inits.length!==1||finals.length!==1||events.at(-1)!==finals[0]||finals[0].result?.status!=="SUCCESS"||
       typeof finals[0].result?.conversation_id!=="string"||!finals[0].result.conversation_id||typeof finals[0].result?.response!=="string")throw Error("HOST_FINAL_STREAM_UNVERIFIED");
    const init=inits[0].init;
    if(init?.model!==attempt.selection.model||init.cwd!==cwd)throw Error("HOST_EFFECTIVE_SELECTION_MISMATCH");
    if(!Array.isArray(init.tools)||init.tools.length)throw Error("HOST_TOOLS_EXPOSED");
    let value:any;
    try{value=decodeStrictJson(finals[0].result.response);}catch{throw Error("HOST_RESULT_BINDING_MISMATCH");}
    if(value?.packetHash!==attempt.packetHash||value.phase!==attempt.phase||value.role!==attempt.role||canonicalJson(value.binding)!==canonicalJson(attempt.binding)||canonicalJson(value.selection)!==canonicalJson(attempt.selection))throw Error("HOST_RESULT_BINDING_MISMATCH");
    if(!pilotPayloadSchemas[attempt.phase].safeParse(value.payload).success)throw Error("HOST_PAYLOAD_INVALID");
    // Fence observation and report ambiguity before the first native call.
    this.attempted.add(attempt.binding.dispatchId);
    const show=await this.command(["orchestration","worker-show","--dispatch",attempt.binding.dispatchId,"--json"],cwd,5000);
    if(show.dispatch?.id!==attempt.binding.dispatchId||show.dispatch?.runId!==attempt.binding.runId||show.dispatch?.taskId!==attempt.binding.taskId||show.observation?.exactWorker!==true)throw Error("HOST_NATIVE_BINDING_UNVERIFIED");
    const sent=await this.command(["orchestration","send","--run",attempt.binding.runId,"--from",attempt.binding.handle,"--type","worker_done","--task-id",attempt.binding.taskId,"--dispatch-id",attempt.binding.dispatchId,"--outcome","succeeded","--subject","Bound supplied-packet result collected","--body","The host collected the bound final provider result. The provider process group and wrapper-owned timers settled with their original exit evidence. The coordinator must independently verify external terminal cleanup and acceptance.","--json"],cwd,5000);
    if(sent.lifecycle?.action!=="completed"||sent.lifecycle.taskId!==attempt.binding.taskId||sent.lifecycle.dispatchId!==attempt.binding.dispatchId)throw Error("HOST_NATIVE_COMPLETION_UNKNOWN");
    return {...value,settlement:"unknown",provider:attempt.selection.route,source:"host-owned AGY final stream",sourceIdentity:`antigravity:${finals[0].result.conversation_id}`};
  }
}
