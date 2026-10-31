import {expect,it} from "vitest";
import * as adapter from "../../src/pilot/orca-driver.js";
import * as developmentRelay from "../../src/pilot/host-relay.js";
import {mkdtempSync,realpathSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {Attempt} from "../../src/pilot/types.js";

const attempt:Attempt={binding:{runId:"run",taskId:"task",dispatchId:"dispatch",handle:"owned",attemptKey:"key"},
  role:"gemini",phase:"readiness",selection:{route:"antigravity",model:"gemini-4-argon-high",effort:"high"},packetHash:"packet",launchVerified:true};
function api():any {
  return developmentRelay;
}
it("keeps the unqualified mutation-capable relay out of the shipped adapter", () => {
  expect(adapter).not.toHaveProperty("HostCompletionRelay");
  expect(adapter).not.toHaveProperty("runGuardedHostCommand");
});

it("does not claim input delivery after a real child closes stdin early", async () => {
  const cwd=realpathSync(mkdtempSync(join(tmpdir(),"council-relay-stdin-")));
  try {
    const receipt=await developmentRelay.runGuardedHostCommand({executable:process.execPath,args:["-e","process.stdin.destroy();setTimeout(()=>process.exit(0),40)"],cwd,input:"x".repeat(4*1024*1024),deadline:Date.now()+2000});
    expect(receipt.inputDelivered).toBe(false);
    expect(receipt.timersSettled).toBe(true);
  } finally {rmSync(cwd,{recursive:true,force:true});}
});
function finalProgram(a=attempt,payload:unknown={ready:true},tools:unknown[]=[]) {
  return `let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{
    console.log(JSON.stringify({event:'init',init:{model:${JSON.stringify(a.selection.model)},cwd:process.cwd(),tools:${JSON.stringify(tools)},permission_mode:'request-review'}}));
    console.log(JSON.stringify({event:'result',result:{conversation_id:'synthetic-session',status:'SUCCESS',response:JSON.stringify({...JSON.parse(input),payload:${JSON.stringify(payload)}})}}));
  });`;
}
function packet(a=attempt) {return JSON.stringify({binding:a.binding,phase:a.phase,role:a.role,selection:a.selection,packetHash:a.packetHash});}

it("relays only the bound final AGY stream after real host-process and timer settlement",async()=>{
  const {runGuardedHostCommand,HostCompletionRelay}=api();
  const cwd=realpathSync(mkdtempSync(join(tmpdir(),"council-relay-")));
  try {
    // A real credential-free Node child stands in for AGY; this is not route qualification.
    const processReceipt=await runGuardedHostCommand({executable:process.execPath,args:["-e",finalProgram()],cwd,input:packet(),deadline:Date.now()+2000});
    expect(processReceipt).toMatchObject({exitCode:0,groupSettled:true,timersSettled:true,timedOut:false});
    const commands:readonly string[][]=[] as any;
    const relay=new HostCompletionRelay(async(argv:readonly string[])=>{
      (commands as string[][]).push([...argv]);
      if(argv[1]==="worker-show") return {dispatch:{id:"dispatch",taskId:"task",runId:"run"},observation:{exactWorker:true}};
      // Captured 1.4.244 local worker_done result shape, sanitized identities.
      return {lifecycle:{action:"completed",taskId:"task",dispatchId:"dispatch"}};
    });
    const result=await relay.complete(attempt,processReceipt,cwd);
    expect(result.payload).toEqual({ready:true});
    expect(result.sourceIdentity).toContain("synthetic-session");
    expect(commands.filter(c=>c[1]==="send")).toHaveLength(1);
    expect(commands[1]).toEqual(expect.arrayContaining(["--from","owned","--task-id","task","--dispatch-id","dispatch"]));
    await expect(relay.complete(attempt,processReceipt,cwd)).rejects.toThrow("HOST_COMPLETION_ALREADY_ATTEMPTED");
  } finally {rmSync(cwd,{recursive:true,force:true});}
});

it("preserves timeout/nonzero evidence and settles the owned descendant group and timer",async()=>{
  const {runGuardedHostCommand,HostCompletionRelay}=api();
  const cwd=realpathSync(mkdtempSync(join(tmpdir(),"council-relay-timeout-")));
  try {
    const receipt=await runGuardedHostCommand({executable:process.execPath,args:["-e",`require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});setInterval(()=>{},1000);`],cwd,input:"",deadline:Date.now()+150});
    expect(receipt).toMatchObject({timedOut:true,groupSettled:true,timersSettled:true,stopRequests:1});
    expect(receipt.exitCode).not.toBe(0);
    const relay=new HostCompletionRelay(async()=>{throw Error("must not send");});
    await expect(relay.complete(attempt,receipt,cwd)).rejects.toThrow("HOST_PROVIDER_NOT_SETTLED_SUCCESSFULLY");
  } finally {rmSync(cwd,{recursive:true,force:true});}
});

it("rejects caller-authored process receipts and expired starts without native mutation",async()=>{
  const {runGuardedHostCommand,HostCompletionRelay}=api();
  const cwd=realpathSync(mkdtempSync(join(tmpdir(),"council-relay-invalid-")));
  try {
    const relay=new HostCompletionRelay(async()=>{throw Error("must not send");});
    await expect(relay.complete(attempt,{exitCode:0,groupSettled:true,timersSettled:true,stdout:""},cwd)).rejects.toThrow("HOST_PROCESS_RECEIPT_NOT_OWNED");
    await expect(runGuardedHostCommand({executable:process.execPath,args:["-e","throw Error('must not spawn')"],cwd,input:"",deadline:Date.now()-1})).rejects.toThrow("HOST_INFERENCE_DEADLINE");
  } finally {rmSync(cwd,{recursive:true,force:true});}
});

it("rejects duplicate finals, mismatched payloads and native contact loss before reporting",async()=>{
  const {runGuardedHostCommand,HostCompletionRelay}=api();
  const cwd=realpathSync(mkdtempSync(join(tmpdir(),"council-relay-bind-")));
  try {
    const foreign={...attempt,packetHash:"foreign"};
    const receipt=await runGuardedHostCommand({executable:process.execPath,args:["-e",finalProgram(foreign)],cwd,input:packet(foreign),deadline:Date.now()+2000});
    const relay=new HostCompletionRelay(async()=>{throw Error("must not send");});
    await expect(relay.complete(attempt,receipt,cwd)).rejects.toThrow("HOST_RESULT_BINDING_MISMATCH");
    const duplicate=await runGuardedHostCommand({executable:process.execPath,args:["-e",finalProgram()+"process.on('beforeExit',()=>console.log(JSON.stringify({event:'result',result:{status:'SUCCESS',response:'{}'}})));"],cwd,input:packet(),deadline:Date.now()+2000});
    await expect(relay.complete(attempt,duplicate,cwd)).rejects.toThrow("HOST_FINAL_STREAM_UNVERIFIED");
    const valid=await runGuardedHostCommand({executable:process.execPath,args:["-e",finalProgram()],cwd,input:packet(),deadline:Date.now()+2000});
    const contactLost=new HostCompletionRelay(async()=>{throw Error("transport lost");});
    await expect(contactLost.complete(attempt,valid,cwd)).rejects.toThrow("transport lost");
    await expect(contactLost.complete(attempt,valid,cwd)).rejects.toThrow("HOST_COMPLETION_ALREADY_ATTEMPTED");
  } finally {rmSync(cwd,{recursive:true,force:true});}
});

it("rejects malformed phase payload and exposed helper tools before any completion report",async()=>{
  const {runGuardedHostCommand,HostCompletionRelay}=api();
  const cwd=realpathSync(mkdtempSync(join(tmpdir(),"council-relay-controls-")));
  try{
    for(const [payload,tools,reason] of [[{wrong:true},[],"HOST_PAYLOAD_INVALID"],[{ready:true},["invoke_subagent"],"HOST_TOOLS_EXPOSED"]] as const){
      const receipt=await runGuardedHostCommand({executable:process.execPath,args:["-e",finalProgram(attempt,payload,[...tools])],cwd,input:packet(),deadline:Date.now()+2000});
      const relay=new HostCompletionRelay(async()=>{throw Error("must not send");});
      await expect(relay.complete(attempt,receipt,cwd)).rejects.toThrow(reason);
    }
  }finally{rmSync(cwd,{recursive:true,force:true});}
});
