import { it, expect, vi } from "vitest";
import { readFileSync, mkdirSync, writeFileSync, cpSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { contextFixture } from "./context-fixture.js";
import { incidentRoster, policyTable } from "./fixtures.js";

it("composes inspector, durable cache, native wrapper proofs, historical PID reuse and bounded requalification",async()=>{
  const h=await contextFixture("normal",!!process.env.COUNCIL_FIX5_BASELINE);
  let cache:any;
  try{
    vi.stubEnv("HOME",h.root);vi.stubEnv("ORCA_TERMINAL_HANDLE","fixture-coordinator");vi.stubEnv("ORCA_PANE_KEY","fixture-coordinator-pane");
    mkdirSync(join(h.root,".agents/policies"),{recursive:true});const policy=join(h.root,".agents/policies/model-policy.md");writeFileSync(policy,policyTable);

    const packageRoot=join(h.root,"package");mkdirSync(packageRoot);cpSync(resolve(process.env.COUNCIL_FIX5_BASELINE??"dist"),join(packageRoot,"dist"),{recursive:true});writeFileSync(join(packageRoot,"package.json"),'{"type":"module"}');symlinkSync(resolve("node_modules"),join(packageRoot,"node_modules"));
    const load=(name:string)=>import(pathToFileURL(join(packageRoot,`dist/pilot/${name}.js`)).href);
    const {NativeHostInspector}=await load("discovery");const {QualificationCache}=await load("qualification-cache");const {createNativePilotDriver}=await load("composition");const {runPilot}=await load("workflow");const {verifyNativeProof}=await load("verify-proof");
    const command=async(argv:string[],cwd:string,timeout?:number)=>{
      if(argv[0]==="status")return{runtime:{state:"ready",reachable:true,appVersion:"1.4.244",runtimeId:h.evidence.runtimeId,capabilities:["settings.agent-launch.v1","agent-session.coherent-model-catalog.v1","orchestration.worker-stop-verdict.v1"]}};
      if(argv[0]==="agent-context")return{commands:["worktree show","orchestration worker-start","orchestration worker-show","orchestration worker-read","orchestration worker-stop","orchestration worker-release","orchestration request-show"].map(command=>({command}))};
      if(argv[0]==="worktree")return{worktree:{id:h.evidence.workspaceId,path:h.workspace,hostId:h.evidence.host}};
      return h.command(argv,cwd,timeout??5000);
    };
    const host=new NativeHostInspector(command,()=>({effortSupport:async()=>({efforts:["high"],source:"fixture explicit effort",detail:"high"}),call:async(method:string,params:any)=>{
      if(method==="settings.getAgentLaunch")return{settings:{agentPermission:{default:"full-access"},agentDefaultArgs:{}}};
      if(method==="accounts.list")return{rateLimits:{codex:{provider:"codex",status:"ok",updatedAt:Date.now(),weekly:null},cursor:{provider:"cursor",status:"ok",updatedAt:Date.now(),weekly:null}}};
      if(method==="agentSession.createSupport")return{agent:params.agent,supported:true,seedOptions:{permissionMode:"full-access"}};
      return{origin:"live-session",models:h.evidence.routes.filter(r=>r.selection.route===params.agent).map(r=>({id:r.selection.model,efforts:[{value:r.selection.effort}]}))};
    }}),async(route:string,operation:string)=>operation==="version"?"synthetic":operation==="models"?route==="cursor"?"grok-4.7-xhigh":"gemini-4-argon-high":JSON.stringify({conversation_id:"",num_turns:0,usage:{total_tokens:0},command:{name:"usage",data:{groups:[{name:"Gemini Models",buckets:[{remaining_fraction:1}]}]}}}),async(selection:any)=>{
      const route=h.evidence.routes.find(r=>r.selection.model===selection.model)!;
      // The synthetic enforcement boundary supplies controls; the real inspector
      // still acquires policy/catalog/allowance and computes the actual key.
      return{bootstrap:route.bootstrap,controls:route.controls,facts:route.recipe!.facts,recipe:route.recipe};
    });
    cache=new QualificationCache(h.workspace);
    const inspect=async(request:any)=>{const result=await host.inspect(request);
      // Real account discovery correctly remains closed; this deterministic
      // external boundary supplies only the fixture's included-only account fact.
      for(const route of result.evidence.routes)if(route.selection.route==="cursor"){expect(route.billing.state).toBe("missing");route.billing=h.evidence.routes.find(r=>r.role===route.role)!.billing;}
      request.proofs.splice(0,request.proofs.length,...await cache.matching(result.evidence,Date.now(),(p:any)=>verifyNativeProof(p,command)));return result;};
    const make=()=>createNativePilotDriver({command,inspector:{inspect},rpc:()=>h.rpc,orca:h.orca,record:(event:any)=>h.events.push(event)});
    const request={workspace:h.workspace,config:incidentRoster,policyPath:policy,candidate:"JSON",suppliedText:"manifest",maxProbeCalls:8,maxTopicCalls:10,workerTimeoutMs:5000,deadline:Date.now()+120000,proofs:[]};
    const first=await runPilot(request,make());expect(first.status,JSON.stringify(first.blockers)).toBe("consensus");expect(first.error).toBeUndefined();expect(first.proofs).toHaveLength(4);cache.write(first.proofs);
    const pids=new Set(first.proofs.flatMap((p:any)=>[p.normal,p.cancellation].map((out:any)=>JSON.parse(readFileSync(join(out.context.directory,"result.json"),"utf8")).wrapperPid)));
    const original=process.kill;const kill=vi.spyOn(process,"kill").mockImplementation(((pid:number,signal:any)=>pids.has(pid)&&signal===0?true:original(pid,signal)) as any);
    const reused=await runPilot({...request,proofs:[],deadline:Date.now()+120000,maxProbeCalls:0},make());
    expect(reused.error).toBeUndefined();expect(reused.calls).toEqual({probes:0,topic:10});expect(kill.mock.calls.some(([pid,signal])=>pids.has(pid)&&signal===0)).toBe(false);kill.mockRestore();
    writeFileSync(join(packageRoot,"dist/pilot/build-marker.js"),"// independently rebuilt package marker\n");
    const fresh=await runPilot({...request,proofs:[],deadline:Date.now()+120000},make());
    expect(fresh.error).toBeUndefined();expect(fresh.calls).toEqual({probes:8,topic:10});cache.write(fresh.proofs);expect(cache.read()).toHaveLength(8);
    const proof=fresh.proofs[0];const artifact=join(proof.normal.context.directory,"cleanup.json");writeFileSync(artifact,'{}');
    await expect(cache.matching(fresh.evidence,Date.now(),(p:any)=>verifyNativeProof(p,command))).rejects.toThrow("QUALIFICATION_CACHE_NATIVE_EVIDENCE_UNVERIFIED");
  }finally{cache?.close();vi.restoreAllMocks();vi.unstubAllEnvs();await h.close();}
},120000);
