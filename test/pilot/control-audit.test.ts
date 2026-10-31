import { it, expect, vi } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { join, delimiter } from "node:path";
import { prepareProviderAudit, adoptProviderAudit, inspectProviderControls } from "../../dist/pilot/provider-controls.js";
import { acquiredAuditDisposition, auditHash } from "../../dist/pilot/control-audit.js";
import { incidentRoster, policyTable } from "./fixtures.js";
import { contextFixture } from "./context-fixture.js";

it("prepares actual versioned hook sources, adopts only matching native owner disposition, and invalidates drift", async()=>{
  const h=await contextFixture();
  try{
    vi.stubEnv("HOME",h.root);vi.stubEnv("PATH",h.root+delimiter+process.env.PATH);
    mkdirSync(join(h.root,".agents/policies"),{recursive:true});const policy=join(h.root,".agents/policies/model-policy.md");writeFileSync(policy,policyTable);
    const settings=join(h.root,".gemini/antigravity-cli");mkdirSync(settings,{recursive:true});
    writeFileSync(join(settings,"settings.json"),JSON.stringify({trustedWorkspaces:[join(h.workspace,".council/native-packets")]}));
    const hook=join(settings,"hooks.json");writeFileSync(hook,JSON.stringify({hooks:{SessionStart:[{command:"/bin/echo sanitized-lifecycle"}]}}));
    const help=readFileSync(new URL("./fixtures/agy-1.4.12-help.txt",import.meta.url),"utf8");
    const exe=join(h.root,"agy");writeFileSync(exe,`#!${process.execPath}\nprocess.stderr.write(${JSON.stringify(help)});`);chmodSync(exe,0o700);
    const prepared=await prepareProviderAudit(incidentRoster.reviewers.gemini,"1.4.11",h.workspace);
    expect(prepared.snapshot.sources.find(s=>s.path===hook)?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared.snapshot.sources.some(s=>s.path===policy)).toBe(true);expect(prepared.snapshot.effects).toHaveLength(1);expect(prepared.snapshot.unavailable).toEqual([]);
    const before=await inspectProviderControls(incidentRoster.reviewers.gemini,"1.4.11",h.workspace,{state:"unknown",source:"test",detail:"no billing"},h.command);
    expect(before.bootstrap.state).toBe("unknown");
    await expect(adoptProviderAudit(h.workspace,prepared.hash,"foreign","foreign",h.command)).rejects.toThrow("AUDIT_NATIVE_OWNER_UNVERIFIED");
    const run=(await h.command(["orchestration","run-create","--objective","audit","--json"],h.workspace,5000)).run.id;
    const task=(await h.command(["orchestration","task-create","--run",run,"--spec",`Council control audit sha256=${prepared.hash}`,"--json"],h.workspace,5000)).task.id;
    const dispatch=(await h.command(["orchestration","dispatch","--run",run,"--task",task,"--to","fixture-coordinator","--json"],h.workspace,5000)).dispatch.id;
    const body=JSON.stringify({kind:"council-control-audit",snapshotHash:prepared.hash,approvedEffects:prepared.snapshot.effects});
    await h.command(["orchestration","send","--run",run,"--from","fixture-coordinator","--type","worker_done","--task-id",task,"--dispatch-id",dispatch,"--outcome","succeeded","--body",body,"--json"],h.workspace,5000);
    const foreign=JSON.parse(readFileSync(h.state,"utf8"));foreign.coordinatorWorkspace="/foreign-project";writeFileSync(h.state,JSON.stringify(foreign));
    await expect(adoptProviderAudit(h.workspace,prepared.hash,run,task,h.command)).rejects.toThrow("AUDIT_NATIVE_WORKSPACE_UNVERIFIED");
    delete foreign.coordinatorWorkspace;foreign.coordinatorIncarnation="foreign-incarnation";writeFileSync(h.state,JSON.stringify(foreign));
    await expect(adoptProviderAudit(h.workspace,prepared.hash,run,task,h.command)).rejects.toThrow("AUDIT_NATIVE_IDENTITY_UNVERIFIED");
    delete foreign.coordinatorIncarnation;writeFileSync(h.state,JSON.stringify(foreign));
    const adopted=await adoptProviderAudit(h.workspace,prepared.hash,run,task,h.command);
    expect(adopted.providerQualification).toBe("separate-required");
    const after=await inspectProviderControls(incidentRoster.reviewers.gemini,"1.4.11",h.workspace,{state:"unknown",source:"test",detail:"no billing"},h.command);
    expect(after.bootstrap.state).toBe("verified");expect(after.controls.state).toBe("unknown");
    const state=JSON.parse(readFileSync(h.state,"utf8"));const result=JSON.parse(state.tasks[0].result);state.tasks[0].result=JSON.stringify({...result,reportedBy:"foreign"});writeFileSync(h.state,JSON.stringify(state));
    expect((await acquiredAuditDisposition(prepared.snapshot,h.command)).verified).toBe(false);
    state.tasks[0].result=JSON.stringify(result);writeFileSync(h.state,JSON.stringify(state));
    writeFileSync(hook,JSON.stringify({hooks:{SessionStart:[{command:"/bin/echo changed"}]}}));
    await expect(adoptProviderAudit(h.workspace,prepared.hash,run,task,h.command)).rejects.toThrow("AUDIT_SOURCE_DRIFT");
    const drift=await inspectProviderControls(incidentRoster.reviewers.gemini,"1.4.11",h.workspace,{state:"unknown",source:"test",detail:"no billing"},h.command);
    expect(drift.bootstrap.state).toBe("unknown");
    writeFileSync(hook,JSON.stringify({hooks:{SessionStart:[{command:"/bin/echo sanitized-lifecycle"}]}}));writeFileSync(policy,policyTable+"\nChanged governing authority.\n");
    await expect(adoptProviderAudit(h.workspace,prepared.hash,run,task,h.command)).rejects.toThrow("AUDIT_SOURCE_DRIFT");
  }finally{vi.unstubAllEnvs();await h.close();}
},30000);

for (const [role, selection] of [["openai", incidentRoster.reviewers.openai], ["judge", incidentRoster.judge]] as const) {
  it(`admits ${role} bootstrap only after matching complete authenticated Codex disposition`, async () => {
    const h=await contextFixture();
    try {
      vi.stubEnv("HOME",h.root);vi.stubEnv("CODEX_HOME",join(h.root,".codex"));vi.stubEnv("PATH",h.root+delimiter+process.env.PATH);
      mkdirSync(join(h.root,".agents/policies"),{recursive:true});writeFileSync(join(h.root,".agents/policies/model-policy.md"),policyTable);
      mkdirSync(join(h.root,".codex"));const config=join(h.root,".codex/config.toml");
      writeFileSync(config,'notify=["unresolved-notifier"]\n[hooks]\nSessionStart=[{command="unresolved-hook ./private.cjs"}]\n');
      const hook=join(h.root,".codex/hooks.json");writeFileSync(hook,'{"hooks":{"SessionStart":[{"command":"unresolved-hook ./private.cjs"}]}}');
      // Cached builtin-looking handlers are inactive for the feature-disabled kernel.
      const cachedHook=join(h.root,".codex/plugins/cache/market/example/v1/hooks/hooks.json");
      mkdirSync(join(cachedHook,".."),{recursive:true});
      writeFileSync(cachedHook,JSON.stringify({hooks:{Stop:[{hooks:[{type:"mcp_tool",server:"node_repl",tool:"turn_ended",input:{}}]}]}}));
      const exe=join(h.root,"codex");writeFileSync(exe,`#!${process.execPath}\nconsole.log('Usage: codex --model --disable --config');`);chmodSync(exe,0o700);
      const prepared=await prepareProviderAudit(selection,"codex-cli 0.164.0",h.workspace);
      expect(prepared.snapshot.effects).toEqual(["codex-platform-runtime-reads-and-state"]);
      expect(prepared.snapshot.unavailable).toEqual([]);
      const other=await prepareProviderAudit(role==="openai"?incidentRoster.judge:incidentRoster.reviewers.openai,"codex-cli 0.164.0",h.workspace);
      expect(other.hash).not.toBe(prepared.hash);
      const inspect=()=>inspectProviderControls(selection,"codex-cli 0.164.0",h.workspace,{state:"unknown",source:"fixture",detail:"No account check"},h.command);
      expect((await inspect()).bootstrap.state).toBe("unknown");
      await expect(adoptProviderAudit(h.workspace,prepared.hash,"foreign","foreign",h.command)).rejects.toThrow("AUDIT_NATIVE_OWNER_UNVERIFIED");
      const run=(await h.command(["orchestration","run-create","--objective","Codex fixture audit","--json"],h.workspace,5000)).run.id;
      const task=(await h.command(["orchestration","task-create","--run",run,"--spec",`Council control audit sha256=${prepared.hash}`,"--json"],h.workspace,5000)).task.id;
      const dispatch=(await h.command(["orchestration","dispatch","--run",run,"--task",task,"--to","fixture-coordinator","--json"],h.workspace,5000)).dispatch.id;
      const body=JSON.stringify({kind:"council-control-audit",snapshotHash:prepared.hash,approvedEffects:prepared.snapshot.effects});
      await h.command(["orchestration","send","--run",run,"--from","fixture-coordinator","--type","worker_done","--task-id",task,"--dispatch-id",dispatch,"--outcome","succeeded","--body",body,"--json"],h.workspace,5000);
      const adopted=await adoptProviderAudit(h.workspace,prepared.hash,run,task,h.command);
      expect(adopted.providerQualification).toBe("separate-required");
      const after=await inspect();expect(after.bootstrap.state).toBe("verified");expect(after.controls.state).toBe("unknown");
      writeFileSync(cachedHook,"invalid inactive cache bytes");
      expect(auditHash((await inspect()).audit!)).toBe(prepared.hash);
      expect((await inspect()).bootstrap.state).toBe("verified");
      expect((await acquiredAuditDisposition(prepared.snapshot)).detail).toBe("AUDIT_NATIVE_AUTHORITY_READER_UNAVAILABLE");
      expect((await acquiredAuditDisposition(other.snapshot,h.command)).verified).toBe(false);
      // Mutate only the stateful native stand-in to exercise each integrity gate.
      const state=JSON.parse(readFileSync(h.state,"utf8"));const index=state.tasks.findIndex((t:any)=>t.id===task);const original=state.tasks[index].result;const result=JSON.parse(original);
      for(const mutation of [
        {...result,reportedBy:"foreign"},
        {...result,body:JSON.stringify({kind:"council-control-audit",snapshotHash:prepared.hash,approvedEffects:[]})},
        {...result,body:JSON.stringify({kind:"council-control-audit",snapshotHash:other.hash,approvedEffects:prepared.snapshot.effects})},
        {...result,body:JSON.stringify({kind:"council-control-audit",snapshotHash:prepared.hash,approvedEffects:[...prepared.snapshot.effects,"unapproved-effect"]})},
      ]) {
        state.tasks[index].result=JSON.stringify(mutation);writeFileSync(h.state,JSON.stringify(state));
        expect((await inspect()).bootstrap.state).toBe("unknown");
      }
      state.tasks[index].result=original;writeFileSync(h.state,JSON.stringify(state));
      writeFileSync(hook,'{"changed":true}');
      await expect(adoptProviderAudit(h.workspace,prepared.hash,run,task,h.command)).rejects.toThrow("AUDIT_SOURCE_DRIFT");
      expect((await inspect()).bootstrap.state).toBe("unknown");
      writeFileSync(hook,'{"hooks":{"SessionStart":[{"command":"unresolved-hook ./private.cjs"}]}}');
      const absent=prepared.snapshot.sources.find(s=>s.kind==="absent"&&s.path===join(h.root,".codex/AGENTS.md"));expect(absent).toBeDefined();
      writeFileSync(absent!.path,"new source");
      expect((await acquiredAuditDisposition(prepared.snapshot,h.command)).verified).toBe(false);
    } finally {vi.unstubAllEnvs();await h.close();}
  },30000);
}

it("keeps unavailable Codex startup sources unknown even with authenticated disposition of every listed effect", async () => {
  const h=await contextFixture();
  try {
    vi.stubEnv("HOME",h.root);vi.stubEnv("CODEX_HOME",join(h.root,".codex"));vi.stubEnv("PATH",h.root+delimiter+process.env.PATH);
    // The canonical host policy is intentionally absent in this disposable fixture.
    const exe=join(h.root,"codex");writeFileSync(exe,`#!${process.execPath}\nconsole.log('Usage: codex --model --disable --config');`);chmodSync(exe,0o700);
    const prepared=await prepareProviderAudit(incidentRoster.reviewers.openai,"codex-cli 0.164.0",h.workspace);
    expect(prepared.snapshot.unavailable).toContain("EXECUTION_HOST_CANONICAL_POLICY_UNAVAILABLE");
    const run=(await h.command(["orchestration","run-create","--objective","incomplete fixture audit","--json"],h.workspace,5000)).run.id;
    const task=(await h.command(["orchestration","task-create","--run",run,"--spec",`Council control audit sha256=${prepared.hash}`,"--json"],h.workspace,5000)).task.id;
    const dispatch=(await h.command(["orchestration","dispatch","--run",run,"--task",task,"--to","fixture-coordinator","--json"],h.workspace,5000)).dispatch.id;
    const body=JSON.stringify({kind:"council-control-audit",snapshotHash:prepared.hash,approvedEffects:prepared.snapshot.effects});
    await h.command(["orchestration","send","--run",run,"--from","fixture-coordinator","--type","worker_done","--task-id",task,"--dispatch-id",dispatch,"--outcome","succeeded","--body",body,"--json"],h.workspace,5000);
    await adoptProviderAudit(h.workspace,prepared.hash,run,task,h.command);
    expect((await acquiredAuditDisposition(prepared.snapshot,h.command)).verified).toBe(false);
    const result=await inspectProviderControls(incidentRoster.reviewers.openai,"codex-cli 0.164.0",h.workspace,{state:"unknown",source:"fixture",detail:"No account check"},h.command);
    expect(result.bootstrap.state).toBe("unknown");expect(result.controls.state).toBe("unknown");
  } finally {vi.unstubAllEnvs();await h.close();}
},30000);
