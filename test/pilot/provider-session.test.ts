import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { codexKernel } from "../../src/pilot/codex-controls.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { contextFixture } from "./context-fixture.js";
import { runProviderSession } from "../../src/pilot/provider-session.js";
import { sha256 } from "../../src/pilot/wrapper-contract.js";
import type { WrapperAssignment } from "../../src/pilot/wrapper-contract.js";

for (const behavior of ["normal", "normal-judge", "normal-instructions", "duplicate-instructions", "object-instructions", "missing-instructions", "drift-instructions", "higher-hook", "typed-model", "typed-effort", "missing-layers", "managed-hooks", "managed-permissions", "wrong-profile", "wrong-provider", "missing-provider", "wrong-thread-provider", "missing-thread-provider", "typed-provider", "provider-endpoint", "selected-profile", "managed-instructions", "managed-provider", "managed-unknown", "wrong-instructions"] as const) {
  it(`checks schema-shaped Codex pre-input controls with ${behavior} and settles the owned process`, async () => {
    const h=await contextFixture(behavior);
    try {
      const directory=join(h.root,"session");mkdirSync(directory);
      const role=behavior==="normal-judge"?"judge":"openai";
      const recipe=h.evidence.routes.find(r=>r.role===role)!.recipe!;
      if(["normal-instructions","duplicate-instructions","object-instructions","missing-instructions","drift-instructions"].includes(behavior)) {
        mkdirSync(recipe.cwd,{recursive:true});const instruction=join(recipe.cwd,"AGENTS.md");writeFileSync(instruction,"source-bound instruction fixture");
        const digest=sha256(readFileSync(instruction));recipe.instructionSources=[{path:instruction,sha256:digest}];recipe.sources=[{path:instruction,kind:"file",sha256:digest}];
      }
      const trace=join(h.root,"requests.txt");writeFileSync(trace,"");recipe.argv[4]=trace;
      const assignmentHash="assignment-hash";
      writeFileSync(join(directory,"input.json"),JSON.stringify({assignmentHash,requestId:"request"}));
      const assignment: WrapperAssignment={version:1,runtimeId:"synthetic-runtime",workspace:h.workspace,workspaceId:"synthetic-repo::B",directory,
        identity:{handle:"fixture",worktreeId:"synthetic-repo::B",ptyId:"fixture-pty",incarnationId:"fixture-incarnation",paneKey:"fixture:pane"},
        binding:{runId:"fixture-run",taskId:"fixture-task",dispatchId:"fixture-dispatch",handle:"fixture",attemptKey:"fixture-attempt"},
        dispatchIncarnation:"fixture-incarnation",producerHash:"fixture-producer",phase:"normal-probe",role,selection:recipe.selection,
        packetHash:"packet-hash",packet:"immutable fixture",controlsHash:"fixture-controls",policyHash:"fixture-policy",deadline:Date.now()+10000,orca:h.orca,recipe};
      const result=await runProviderSession(assignment,assignmentHash);
      const requests=readFileSync(trace,"utf8").trim().split("\n");
      expect(result.process.closed).toBe(true);expect(result.process.groupSettled).toBe(true);expect(result.process.trackedDescendantsSettled).toBe(true);
      expect(result.process.timersSettled).toBe(true);
      if(behavior==="normal"||behavior==="normal-judge"||behavior==="normal-instructions") {
        expect(result.init.modelProvider).toBe("openai");
        expect(result.error).toBeNull();expect(result.status).toBe("completed");expect(result.calls).toBe(1);
        if(behavior==="normal-instructions")expect(result.init.instructionSources).toEqual([join(recipe.cwd,"AGENTS.md")]);
        expect(requests).toEqual(["initialize","initialized","config/read","includeLayers:true","configRequirements/read","permissionProfile/list","thread/start","turn/start"]);
      } else {
        expect(result.status).toBe("failed");expect(result.calls).toBe(0);expect(result.process.inputDelivered).toBe(false);
        expect(requests).not.toContain("turn/start");
        if(!["wrong-profile","wrong-provider","missing-provider","wrong-thread-provider","missing-thread-provider"].includes(behavior)&&!["duplicate-instructions","object-instructions","missing-instructions","drift-instructions","wrong-instructions"].includes(behavior))expect(requests).not.toContain("thread/start");
        expect(result.error).toMatch(/CODEX_(EFFECTIVE_CONFIG_UNVERIFIED|REQUIREMENTS_DENIED|THREAD_SELECTION_UNVERIFIED)/);
      }
    } finally {await h.close();}
  },15000);
}

for (const role of ["openai", "judge"] as const) it(`withholds all ${role} model input during startup-only cancellation`, async()=>{
  const h=await contextFixture();let timer:ReturnType<typeof setInterval>|undefined;
  try {
    const directory=join(h.root,"startup-only");mkdirSync(directory);
    const recipe=h.evidence.routes.find(r=>r.role===role)!.recipe!;
    const trace=join(h.root,"requests.txt");writeFileSync(trace,"");recipe.argv[4]=trace;
    const binding={runId:"fixture-run",taskId:"fixture-task",dispatchId:"fixture-dispatch",handle:"fixture",attemptKey:"fixture-attempt"};
    const assignment:WrapperAssignment={version:1,runtimeId:"synthetic-runtime",workspace:h.workspace,workspaceId:"synthetic-repo::B",directory,
      identity:{handle:"fixture",worktreeId:"synthetic-repo::B",ptyId:"fixture-pty",incarnationId:"fixture-incarnation",paneKey:"fixture:pane"},binding,
      dispatchIncarnation:"fixture-incarnation",producerHash:"fixture-producer",phase:"cancel-probe",role,selection:recipe.selection,
      packetHash:sha256(""),packet:"",controlsHash:"fixture-controls",policyHash:"fixture-policy",deadline:Date.now()+10000,orca:h.orca,recipe};
    timer=setInterval(()=>{
      const prepared=join(directory,"prepared.json");
      if(existsSync(prepared)&&JSON.parse(readFileSync(prepared,"utf8")).ready&&!existsSync(join(directory,"cancel.json")))
        writeFileSync(join(directory,"cancel.json"),JSON.stringify({binding,deadline:Date.now()+5000}));
    },10);
    const result=await runProviderSession(assignment,"assignment-hash");
    expect(JSON.parse(readFileSync(join(directory,"prepared.json"),"utf8")).ready).toBe(true);
    expect(result.status).toBe("failed");expect(result.error).toBe("PROVIDER_INITIALIZATION_CANCELLED");
    expect(result.calls).toBe(0);expect(result.process.inputDelivered).toBe(false);
    expect(result.process.closed&&result.process.groupSettled&&result.process.trackedDescendantsSettled&&result.process.timersSettled).toBe(true);
    expect(existsSync(join(directory,"input.json"))).toBe(false);expect(existsSync(join(directory,"inference-started.json"))).toBe(false);
    expect(readFileSync(trace,"utf8")).not.toContain("turn/start");
  } finally {if(timer)clearInterval(timer);await h.close();}
},15000);

it.each([true,false,undefined])("stand-in exposes layers only for includeLayers=true (requested %s)",includeLayers=>{
  const kernel=codexKernel([],process.cwd(),"gpt-6.1-sol","max");
  const result=spawnSync(process.execPath,[resolve("test/pilot/fixtures/context-provider.cjs"),"codex-app-server","gpt-6.1-sol","normal","",...kernel.argv],
    {cwd:process.cwd(),encoding:"utf8",input:JSON.stringify({id:2,method:"config/read",params:{includeLayers}})+"\n",timeout:5000});
  expect(result.status).toBe(0);expect(result.stderr).toBe("");
  const response=JSON.parse(result.stdout.trim());
  expect(Array.isArray(response.result.layers)).toBe(includeLayers===true);
});
