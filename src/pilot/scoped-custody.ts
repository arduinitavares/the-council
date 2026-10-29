import {randomUUID} from "node:crypto";
import type {ScopedRpc} from "./rpc.js";
import {scopedLaunchPlanSchema,type ScopedLaunchPlan} from "./scoped-launch.js";
import type {Observation} from "./types.js";

export interface OwnedScopedTerminal {readonly operationId:string;readonly handle:string;}
interface Identity {handle:string;worktreeId:string;ptyId:string;incarnationId:string;}

/** Task-owned external custody, separate from native worker-release authority.
 * These executable registered API components are not a qualification receipt.
 * Current host discovery still blocks inference until its missing effective
 * controls and this complete composition have independent native qualification. */
export class ScopedTerminalCustody {
  private readonly owned=new WeakMap<OwnedScopedTerminal,Identity>();
  private readonly closeAttempted=new WeakSet<OwnedScopedTerminal>();
  private unknownOperation=false;
  constructor(private readonly rpc:ScopedRpc,private readonly record:(event:unknown)=>void){}
  async launch(plan:ScopedLaunchPlan,workspaceId:string,controls:Observation):Promise<OwnedScopedTerminal>{
    if(this.unknownOperation)throw Error("SCOPED_LAUNCH_PREVIOUS_UNKNOWN");
    plan=scopedLaunchPlanSchema.parse(plan);
    if(controls.state!=="verified"||plan.pendingControls.length)throw Error("SCOPED_CONTROLS_UNVERIFIED");
    const operationId=`${Date.now()}-${randomUUID().replaceAll("-","")}`;
    this.record({event:"scoped-launch-reserved",operationId,workspaceId,request:plan.request,controlSource:controls.source});
    this.unknownOperation=true;
    let result:any;
    try{result=await this.rpc.callScoped("agent.launch",{...plan.request,operationId});}
    catch(error){this.record({event:"scoped-launch-unknown",operationId});throw Error(`SCOPED_LAUNCH_OUTCOME_UNKNOWN:${operationId}`,{cause:error});}
    // Shape checked against installed shared/agent-launch-intent.js, not a guessed CLI envelope.
    const handle=result.outcome?.kind==="terminal"?result.outcome.handle:undefined;
    this.record({event:"scoped-launch-observed",operationId,handle:typeof handle==="string"?handle:null,workspaceId:result.worktreeId??null});
    if(typeof handle!=="string"||!handle||result.worktreeId!==workspaceId||result.prompt!==undefined)throw Error(`SCOPED_LAUNCH_BINDING_UNKNOWN:${operationId}`);
    const shown=(await this.rpc.callScoped("terminal.show",{terminal:handle})).terminal;
    if(shown?.handle!==handle||shown.worktreeId!==workspaceId||typeof shown.ptyId!=="string"||!shown.ptyId||typeof shown.incarnationId!=="string"||!shown.incarnationId)throw Error(`SCOPED_TERMINAL_IDENTITY_UNKNOWN:${operationId}`);
    const token=Object.freeze({operationId,handle});
    this.owned.set(token,{handle,worktreeId:workspaceId,ptyId:shown.ptyId,incarnationId:shown.incarnationId});
    this.record({event:"scoped-terminal-bound",operationId,identity:this.owned.get(token)});
    this.unknownOperation=false;
    return token;
  }
  async close(token:OwnedScopedTerminal):Promise<"closed"|"unknown">{
    const identity=this.owned.get(token);
    if(!identity)throw Error("SCOPED_TERMINAL_NOT_OWNED");
    if(this.closeAttempted.has(token))return "unknown";
    this.closeAttempted.add(token);
    this.unknownOperation=true;
    try{
      const shown=(await this.rpc.callScoped("terminal.show",{terminal:identity.handle})).terminal;
      if(!Object.entries(identity).every(([key,value])=>shown?.[key]===value))return "unknown";
      const params={terminal:identity.handle,expectedIncarnationId:identity.incarnationId};
      const observed=(await this.rpc.callScoped("terminal.inspectProcess",{...params,scanChildProcesses:true})).process;
      if(observed?.verdict==="unverifiable"||observed?.childProcessEvidence!=="no-children"||observed.hasChildProcesses!==false)return "unknown";
      this.record({event:"external-terminal-close-reserved",operationId:token.operationId,identity});
      const receipt=await this.rpc.callScoped("terminal.close",params);
      const closed=receipt.close?.handle===identity.handle&&receipt.close.ptyKilled===true&&receipt.close.ptyStopVerdict===undefined;
      this.record({event:"external-terminal-close-observed",operationId:token.operationId,closed,ptyStopVerdict:receipt.close?.ptyStopVerdict??null});
      if(closed)this.unknownOperation=false;
      // "closed" is only the exact PTY receipt. It never relabels an external
      // native worker-release's retained/unknown receipt as released, or proves
      // escaped descendants, provider final output, wrapper or timer settlement.
      return closed?"closed":"unknown";
    }catch{this.record({event:"external-terminal-close-unknown",operationId:token.operationId,identity});return "unknown";}
  }
}
