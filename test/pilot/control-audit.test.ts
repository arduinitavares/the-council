import { it, expect, vi } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { join, delimiter } from "node:path";
import { prepareProviderAudit, adoptProviderAudit, inspectProviderControls } from "../../dist/pilot/provider-controls.js";
import { acquiredAuditDisposition } from "../../dist/pilot/control-audit.js";
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
    const exe=join(h.root,"agy");writeFileSync(exe,`#!${process.execPath}\nprocess.stderr.write('Usage of agy:\\n -settings string\\n -agent string\\n');`);chmodSync(exe,0o700);
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
