import {expect,it} from "vitest";
import * as adapter from "../../src/pilot/orca-driver.js";
import {scopedLaunchPlan} from "../../src/pilot/scoped-launch.js";
const workspace="/requesting-project";
const workspaceId="repo::/requesting-project";
const selection={route:"antigravity",model:"gemini-4-argon-high",effort:"high"} as const;
function harness(){
  expect(typeof (adapter as any).ScopedTerminalCustody).toBe("function");
  const calls:{method:string;params:any}[]=[],events:any[]=[];
  let foreign=false,unknownChildren=false,closeUnknown=false;
  const custody=new (adapter as any).ScopedTerminalCustody({callScoped:async(method:string,params:any)=>{
    calls.push({method,params});
    if(method==="agent.launch")return{outcome:{kind:"terminal",handle:"task-created"},worktreeId:workspaceId,receipt:{mode:"terminal",preferred:"terminal",reason:"explicit",detail:"synthetic native shape"}};
    if(method==="terminal.show")return{terminal:{handle:"task-created",ptyId:"pty",incarnationId:foreign?"foreign":"incarnation",worktreeId:workspaceId}};
    if(method==="terminal.inspectProcess")return{process:{foregroundProcess:null,hasChildProcesses:false,childProcessEvidence:unknownChildren?"unverifiable":"no-children"}};
    if(method==="terminal.close")return{close:{handle:"task-created",ptyKilled:!closeUnknown,ptyStopVerdict:closeUnknown?"unverifiable":undefined}};
    throw Error("unexpected registered API");
  }},(event:any)=>events.push(event));
  return{custody,calls,events,foreign:()=>{foreign=true},unknownChildren:()=>{unknownChildren=true},closeUnknown:()=>{closeUnknown=true}};
}
it("stops an unverified route before creating any native session",async()=>{
  const h=harness();
  await expect(h.custody.launch(scopedLaunchPlan(workspace,selection,{}),workspaceId,{state:"missing",source:"real current-host missing controls",detail:"not verified"})).rejects.toThrow("SCOPED_CONTROLS_UNVERIFIED");
  expect(h.calls).toEqual([]);
});
it("composes actual registered no-prompt launch and exact external-custody cleanup",async()=>{
  const h=harness();
  const plan=scopedLaunchPlan(workspace,selection,{});
  // Conditional synthetic control source, never a current-host admission receipt.
  plan.pendingControls=[];
  const owned=await h.custody.launch(plan,workspaceId,{state:"verified",source:"synthetic conditional source",detail:"fixture only"});
  expect(h.events[0]).toMatchObject({event:"scoped-launch-reserved",operationId:expect.stringMatching(/^\d{13}-[0-9a-f]{32}$/)});
  expect(h.calls[0]).toMatchObject({method:"agent.launch",params:{surface:"terminal",presentation:"background",agentArgs:expect.any(String)}});
  expect(h.calls[0]!.params).not.toHaveProperty("prompt");
  expect(await h.custody.close(owned)).toBe("closed");
  expect(h.calls.filter(c=>c.method==="terminal.close")).toEqual([{method:"terminal.close",params:{terminal:"task-created",expectedIncarnationId:"incarnation"}}]);
  expect(await h.custody.close(owned)).toBe("unknown");
  expect(h.calls.filter(c=>c.method==="terminal.close")).toHaveLength(1);
});
it("preserves foreign identity, unknown child enumeration and close contact loss",async()=>{
  for(const variant of ["foreign","unknownChildren","closeUnknown"] as const){
    const h=harness();const plan=scopedLaunchPlan(workspace,selection,{});plan.pendingControls=[];
    const owned=await h.custody.launch(plan,workspaceId,{state:"verified",source:"synthetic",detail:"fixture only"});
    h[variant]();
    expect(await h.custody.close(owned)).toBe("unknown");
    expect(h.calls.filter(c=>c.method==="terminal.close")).toHaveLength(variant==="closeUnknown"?1:0);
  }
});

it("fences an ambiguous native launch instead of creating another operation",async()=>{
  expect(typeof (adapter as any).ScopedTerminalCustody).toBe("function");
  let calls=0;const events:any[]=[];
  const custody=new (adapter as any).ScopedTerminalCustody({callScoped:async()=>{calls++;throw Error("transport lost");}},(e:any)=>events.push(e));
  const plan=scopedLaunchPlan(workspace,selection,{});plan.pendingControls=[];
  const control={state:"verified",source:"synthetic fixture",detail:"not qualification"};
  await expect(custody.launch(plan,workspaceId,control)).rejects.toThrow("SCOPED_LAUNCH_OUTCOME_UNKNOWN");
  await expect(custody.launch(plan,workspaceId,control)).rejects.toThrow("SCOPED_LAUNCH_PREVIOUS_UNKNOWN");
  expect(calls).toBe(1);
  expect(events[0].operationId).toBe(events[1].operationId);
});
