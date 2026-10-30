import { expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { contextFixture } from "./context-fixture.js";
import { runProviderSession } from "../../src/pilot/provider-session.js";
import { sha256 } from "../../src/pilot/wrapper-contract.js";
import type { WrapperAssignment } from "../../src/pilot/wrapper-contract.js";

for (const behavior of ["normal", "normal-judge", "normal-instructions", "duplicate-instructions", "object-instructions", "missing-instructions", "drift-instructions", "higher-hook", "typed-model", "typed-effort", "missing-layers", "managed-hooks", "managed-permissions", "wrong-profile", "wrong-instructions"] as const) {
  it(`checks schema-shaped Codex pre-input controls with ${behavior} and settles the owned process`, async () => {
    const h=await contextFixture(behavior);
    try {
      const directory=join(h.root,"session");mkdirSync(directory);
      const role=behavior==="normal-judge"?"judge":"openai";
      const recipe=h.evidence.routes.find(r=>r.role===role)!.recipe!;
      if(behavior.includes("instructions")&&behavior!=="wrong-instructions") {
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
        expect(result.error).toBeNull();expect(result.status).toBe("completed");expect(result.calls).toBe(1);
        if(behavior==="normal-instructions")expect(result.init.instructionSources).toEqual([join(recipe.cwd,"AGENTS.md")]);
        expect(requests).toEqual(["initialize","initialized","config/read","configRequirements/read","permissionProfile/list","thread/start","turn/start"]);
      } else {
        expect(result.status).toBe("failed");expect(result.calls).toBe(0);expect(result.process.inputDelivered).toBe(false);
        expect(requests).not.toContain("turn/start");
        if(behavior!=="wrong-profile"&&!behavior.includes("instructions"))expect(requests).not.toContain("thread/start");
        expect(result.error).toMatch(/CODEX_(EFFECTIVE_CONFIG_UNVERIFIED|REQUIREMENTS_DENIED|THREAD_SELECTION_UNVERIFIED)/);
      }
    } finally {await h.close();}
  },15000);
}
