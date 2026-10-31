import { expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, delimiter } from "node:path";
import { pathToFileURL } from "node:url";
import { contextFixture } from "./context-fixture.js";
import { incidentRoster } from "./fixtures.js";
const base = pathToFileURL(resolve(process.env.COUNCIL_FIX5_BASELINE ?? "dist")+"/");
const load = (name: string) => import(new URL(`pilot/${name}.js`, base).href);
const wait = async (condition: () => boolean) => { const end=Date.now()+6000;while(!condition()){if(Date.now()>end)throw Error("fixture timeout");await new Promise(r=>setTimeout(r,10));} };

for (const behavior of ["tool-before", "tool-after", "error-after", "auth-stderr"]) {
  it(`rejects ${behavior} during cancellation and preserves owned settlement`, async () => {
    const h=await contextFixture(behavior);
    try {
      const {runProviderSession}=await load("provider-session");
      const directory=join(h.root,"session");mkdirSync(directory);
      const route=h.evidence.routes.find(r=>r.role==="gemini")!;
      const binding={runId:"r",taskId:"t",dispatchId:"d",handle:"h",attemptKey:"k"};
      const a={workspace:h.workspace,directory,binding,recipe:route.recipe,selection:route.selection,packetHash:"p",controlsHash:"c",phase:"cancel-probe",role:"gemini",packet:"wait",deadline:Date.now()+5000};
      const pending=runProviderSession(a,"assignment");
      await wait(()=>existsSync(join(directory,"prepared.json")));
      writeFileSync(join(directory,"input.json"),JSON.stringify({assignmentHash:"assignment",requestId:"input"}));
      await wait(()=>existsSync(join(directory,"inference-started.json")));
      writeFileSync(join(directory,"cancel.json"),JSON.stringify({requestId:"stop",binding,deadline:Date.now()+5000}));
      const report=await pending;
      expect(report.status).toBe("failed");
      expect(report.error).toMatch(/PROVIDER_(UNCONTROLLED_TOOL|STREAM_EVENT_UNSUPPORTED|STDERR_UNCLASSIFIED)/);
      expect(report.calls).toBe(1);
      expect(report.process).toMatchObject({closed:true,groupSettled:true,trackedDescendantsSettled:true,timersSettled:true});
      if(behavior==="tool-before")expect(existsSync(join(directory,"cancel-ack.json"))).toBe(false);
    } finally { await h.close(); }
  },15000);
}

it("gates every provider on required effective facts before input", async()=>{
  const h=await contextFixture();
  try{
    const {runProviderSession}=await load("provider-session");
    const route=h.evidence.routes[0]!;
    const directory=join(h.root,"denied");mkdirSync(directory);
    const recipe={...route.recipe!,facts:[...route.recipe!.facts,{name:"required-remote-capability",stage:"effective",observation:{state:"denied",source:"native requirements",detail:"deny"},enforcement:"preinput",observedAt:1,digest:"d"}]};
    await expect(runProviderSession({workspace:h.workspace,directory,recipe,selection:route.selection,deadline:Date.now()+1000},"hash")).rejects.toThrow("PROVIDER_PREINPUT_CONTROL_UNVERIFIED");
    expect(existsSync(join(directory,"initialization-started.json"))).toBe(false);
  }finally{await h.close();}
},10000);

it("reserves an unknown lost input acknowledgement through built workflow and journal",async()=>{
  const h=await contextFixture("hang");
  try{
    const {createNativePilotDriver}=await load("composition");const {runPilot}=await load("workflow");const {PilotJournal}=await load("journal");
    let expired=false;const now=()=>{const a=h.events.find(e=>e.event==="wrapper-native-bound")?.attempt;if(!expired&&a&&existsSync(join(a.context.directory,"input.json"))){expired=true;return Date.now()+100000;}return Date.now();};
    const driver=createNativePilotDriver({command:h.command,inspector:{inspect:async()=>({evidence:h.evidence,blockers:[]})},rpc:()=>h.rpc,orca:h.orca,record:(e:any)=>h.events.push(e),now});
    const journal=new PilotJournal(h.workspace,"lost-ack",{});
    try{
      const result=await runPilot({workspace:h.workspace,config:incidentRoster,policyPath:"/synthetic",candidate:"JSON",suppliedText:"immutable",maxProbeCalls:8,maxTopicCalls:10,workerTimeoutMs:3000,deadline:Date.now()+30000,proofs:[]},journal.wrap(driver));
      expect(result.calls).toEqual({probes:1,topic:0});
      expect(result.error).toBe("WRAPPER_INPUT_ACK_UNKNOWN");
      expect(result.proofs).toHaveLength(0);
      const a=h.events.find(e=>e.event==="wrapper-native-bound").attempt;
      expect(a.inferenceStarted).toBeNull();
      expect([...h.terminals.values()].every(t=>t.closed)).toBe(true);
      expect(readFileSync(join(journal.path,"events.jsonl"),"utf8")).toContain('"inferenceStarted":null');
    }finally{journal.close();}
  }finally{await h.close();}
},15000);

it("changes the actual proof matching key on producer drift without changing retained controls hashes",async()=>{
  const {proofKey}=await load("preflight");const h=await contextFixture();
  try{const first={...h.evidence,producerCodeHash:"first"};const second={...first,producerCodeHash:"second"};expect(proofKey(first,first.routes[0])).not.toBe(proofKey(second,second.routes[0]));expect(second.controlsHash).toBe(first.controlsHash);}finally{await h.close();}
});

it("acquires Cursor roots/trust metadata without content reads or overstating containment",async()=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),"cursor-audit-")));
  try{
    vi.stubEnv("HOME",root);vi.stubEnv("CURSOR_DATA_DIR",root+" data ");vi.stubEnv("CURSOR_CONFIG_DIR",root+" config ");vi.stubEnv("PATH",root+delimiter+process.env.PATH);
    const workspace=join(root,"project");mkdirSync(workspace);mkdirSync(join(workspace,".git"));
    const cwd=join(workspace,".council/native-packets");mkdirSync(cwd,{recursive:true});
    const normalized=cwd.replace(/[^a-zA-Z0-9]/g,"-").replace(/-+/g,"-").replace(/^-+|-+$/g,"");
    const marker=join(root+" data ","projects",normalized,".workspace-trusted");mkdirSync(marker,{recursive:true});
    mkdirSync(root+" config ");writeFileSync(join(root+" config ","cli-config.json"),JSON.stringify({sandbox:{readBoundary:"workspace"},permissions:{deny:["Shell(*)","Write(**)","WebFetch(*)","Mcp(*:*)"]}}));
    const executable=join(root,"cursor-agent");writeFileSync(executable,`#!${process.execPath}\nconsole.log('Usage --print --mode --sandbox --workspace');`);chmodSync(executable,0o700);
    const {inspectProviderControls,existingCursorTrust}=await load("provider-controls");
    expect(existingCursorTrust(cwd)).toBe(marker);
    const result=await inspectProviderControls(incidentRoster.reviewers.xai,"2026.10.22-27dcf5f",workspace,{state:"missing",source:"account",detail:"not exposed"});
    expect(result.facts.find((f:any)=>f.name==="workspace-trust").observation.state).toBe("verified");
    expect(result.facts.find((f:any)=>f.name==="packet-read-boundary-and-deny-rules").observation.state).not.toBe("verified");
    expect(result.facts.some((f:any)=>f.name==="helper-loader-root"&&f.observation.state!=="verified")).toBe(true);
  }finally{vi.unstubAllEnvs();rmSync(root,{recursive:true,force:true});}
});

it("exposes packaged source snapshot preparation independently from provider qualification",async()=>{
  const controls=await load("provider-controls");expect(typeof controls.prepareProviderAudit).toBe("function");expect(typeof controls.adoptProviderAudit).toBe("function");
});

it("does not acknowledge an input that has no provider active-turn evidence", async()=>{
  const h=await contextFixture("no-turn-ack");
  try{
    const {runProviderSession}=await load("provider-session");const directory=join(h.root,"not-active");mkdirSync(directory);const route=h.evidence.routes.find(r=>r.role==="gemini")!;const binding={runId:"r",taskId:"t",dispatchId:"d",handle:"h",attemptKey:"k"};
    const pending=runProviderSession({workspace:h.workspace,directory,binding,recipe:route.recipe,selection:route.selection,packetHash:"p",controlsHash:"c",phase:"cancel-probe",role:"gemini",packet:"wait",deadline:Date.now()+1000},"assignment");
    await wait(()=>existsSync(join(directory,"prepared.json")));writeFileSync(join(directory,"input.json"),JSON.stringify({assignmentHash:"assignment",requestId:"input"}));await wait(()=>existsSync(join(directory,"inference-started.json")));writeFileSync(join(directory,"cancel.json"),JSON.stringify({requestId:"stop",binding,deadline:Date.now()+3000}));
    const result=await pending;expect(result.status).toBe("failed");expect(existsSync(join(directory,"cancel-ack.json"))).toBe(false);expect(result.process.closed).toBe(true);
  }finally{await h.close();}
},10000);

for(const behavior of ["tool-before","tool-after","error-after","auth-stderr"]){
  it(`composed ${behavior} cancellation creates no proof or topic and closes owned wrappers`,async()=>{
    const h=await contextFixture(behavior);
    try{
      h.evidence.routes.sort((left,right)=>(left.role==="gemini"?-1:0)-(right.role==="gemini"?-1:0));
      const {createNativePilotDriver}=await load("composition");const {runPilot}=await load("workflow");
      const driver=createNativePilotDriver({command:h.command,inspector:{inspect:async()=>({evidence:h.evidence,blockers:[]})},rpc:()=>h.rpc,orca:h.orca,record:(e:any)=>h.events.push(e)});
      const result=await runPilot({workspace:h.workspace,config:incidentRoster,policyPath:"/synthetic",candidate:"JSON",suppliedText:"manifest",maxProbeCalls:8,maxTopicCalls:10,workerTimeoutMs:3000,deadline:Date.now()+30000,proofs:[]},driver);
      expect(result.status).toBe("failed");expect(result.error).toMatch(/PROVIDER_(UNCONTROLLED_TOOL|STREAM_EVENT_UNSUPPORTED|STDERR_UNCLASSIFIED)/);expect(result.calls).toEqual({probes:2,topic:0});expect(result.proofs).toHaveLength(0);expect([...h.terminals.values()].every(t=>t.closed)).toBe(true);
    }finally{await h.close();}
  },15000);
}

it("retains forbidden and method_not_found as sanitized native codes",async()=>{
  const {readFailure}=await load("allowance");
  for(const code of ["forbidden","method_not_found"])expect(JSON.parse(readFailure("native",Object.assign(Error("private"),{code})).detail).diagnostic.code).toBe(code);
});

it("records the wrapper stop identity actually used by its custody lane",async()=>{
  const h=await contextFixture();
  try{
    const {PilotJournal}=await load("journal");const {mutationRequestId}=await load("mutation-id");
    const binding={runId:"r",taskId:"t",dispatchId:"d",handle:"h",attemptKey:"k"};const a={binding,role:"gemini",phase:"cancel-probe",selection:incidentRoster.reviewers.gemini,packetHash:"p",launchVerified:true,context:{directory:h.root,assignmentHash:"a"}};
    const journal=new PilotJournal(h.workspace,"stop-journal",{});
    try{const wrapped=journal.wrap({launch:async()=>a,cancel:async()=>({state:"unknown"})});await wrapped.launch("r",{},"gemini","cancel-probe","p","k");await wrapped.cancel(a,Date.now()+1000);const event=readFileSync(join(journal.path,"events.jsonl"),"utf8").split("\n").filter(Boolean).map(line=>JSON.parse(line).event).find(e=>e.event==="cancel-reserved");expect(event.mutationRequestId).toBe(mutationRequestId(`wrapper-stop:${JSON.stringify(binding,Object.keys(binding).sort())}`));}finally{journal.close();}
  }finally{await h.close();}
});

it("does not accept unrelated termination reasons containing stop",async()=>{
  const {OrcaPilotDriver}=await load("orca-driver");const binding={runId:"r",taskId:"t",dispatchId:"d",handle:"h",attemptKey:"k"};
  const driver=new OrcaPilotDriver(async(argv:string[])=>argv[1]==="worker-stop"?{state:"stopped",dispatchId:"d",mutation:{requestId:argv[argv.indexOf("--retry-request")+1]}}:{dispatch:{id:"d",runId:"r",taskId:"t",status:"failed",terminationReason:"unexpected-stop-in-log"},observation:{exactWorker:true,status:"exited"}},{});
  expect((await driver.cancel({binding},Date.now()+1000)).state).toBe("settled_unacknowledged");
});

for(const behavior of ["normal","wrong-agent"]){
  it(`requires AGY init to expose its source-bound selected agent: ${behavior}`,async()=>{
    const h=await contextFixture(behavior);
    try{
      const {runProviderSession}=await load("provider-session");const {sha256}=await load("wrapper-contract");const directory=join(h.root,"agent-session");mkdirSync(directory);const route=h.evidence.routes.find(r=>r.role==="gemini")!;
      const definition=join(h.root,"approved-agent.md");writeFileSync(definition,"---\nname: council-packet\ntools: []\nmainAgent: true\nsubagent: false\n---\nRead the supplied packet.\n");
      const recipe={...route.recipe,agent:"council-packet",agentDefinition:{path:definition,sha256:sha256(readFileSync(definition))},argv:[...route.recipe!.argv,"--agent","council-packet"]};
      const binding={runId:"r",taskId:"t",dispatchId:"d",handle:"h",attemptKey:"k"};
      const pending=runProviderSession({workspace:h.workspace,directory,binding,recipe,selection:route.selection,packetHash:"p",controlsHash:"c",phase:"normal-probe",role:"gemini",packet:"ready",deadline:Date.now()+3000},"assignment");
      await wait(()=>existsSync(join(directory,"prepared.json")));
      if(behavior==="normal")writeFileSync(join(directory,"input.json"),JSON.stringify({assignmentHash:"assignment",requestId:"input"}));
      const report=await pending;
      if(behavior==="normal"){expect(report.status).toBe("completed");expect(report.selectedAgent.observed).toBe("council-packet");expect(report.selectedAgent.source).toBe("Provider init agent field");expect(report.calls).toBe(1);}
      else{expect(report.status).toBe("failed");expect(report.error).toBe("PROVIDER_EFFECTIVE_CONTROLS_UNVERIFIED");expect(report.calls).toBe(0);}
    }finally{await h.close();}
  },10000);
}
