import { it, expect, vi } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { join, delimiter } from "node:path";
import { prepareProviderAudit, adoptProviderAudit, inspectProviderControls } from "../../dist/pilot/provider-controls.js";
import { acquiredAuditDisposition, adoptAuditSnapshot, auditHash, saveAuditSnapshot } from "../../dist/pilot/control-audit.js";
import { createHash } from "node:crypto";
import type { Command } from "../../src/pilot/orca-driver.js";
import { incidentRoster, policyTable } from "./fixtures.js";
import { contextFixture } from "./context-fixture.js";

async function completedAudit(h: Awaited<ReturnType<typeof contextFixture>>) {
  const source = join(h.workspace, "audit-source.txt");
  writeFileSync(source, "reviewed startup source\n");
  const prepared = saveAuditSnapshot({
    version: 1, workspace: h.workspace, route: "codex", providerVersion: "fixture",
    contract: "fixture-contract", executable: "/fixture/codex", recipeHash: "fixture-recipe",
    sources: [{ path: source, sha256: createHash("sha256").update(readFileSync(source)).digest("hex") }],
    ordering: [source], effects: ["codex-platform-runtime-reads-and-state"], unavailable: [],
  });
  const run = (await h.command(["orchestration", "run-create", "--objective", "audit", "--json"], h.workspace, 5000)).run.id;
  const task = (await h.command(["orchestration", "task-create", "--run", run, "--spec", `Council control audit sha256=${prepared.hash}`, "--json"], h.workspace, 5000)).task.id;
  const dispatch = (await h.command(["orchestration", "dispatch", "--run", run, "--task", task, "--to", "fixture-coordinator", "--json"], h.workspace, 5000)).dispatch.id;
  await h.command(["orchestration", "send", "--run", run, "--from", "fixture-coordinator", "--type", "worker_done", "--task-id", task, "--dispatch-id", dispatch, "--outcome", "succeeded", "--body", JSON.stringify({
    kind: "council-control-audit", snapshotHash: prepared.hash, approvedEffects: ["codex-platform-runtime-reads-and-state"],
  }), "--json"], h.workspace, 5000);
  const adopted = await adoptAuditSnapshot(h.workspace, prepared.hash, run, task, h.command);
  expect((await acquiredAuditDisposition(prepared.snapshot, h.command)).verified).toBe(true);
  return { ...prepared, run, task, adopted, source };
}

it.each([null, "replacement-coordinator"])("retains completed approval after a second Run releases the saved owner to %s", async currentOwner => {
  const h = await contextFixture();
  try {
    const audit = await completedAudit(h);
    const referenceBytes = readFileSync(audit.adopted.path, "utf8");
    const before = JSON.parse(readFileSync(h.state, "utf8"));
    await h.command(["orchestration", "run-create", "--objective", "judge audit", "--json"], h.workspace, 5000);
    // Mirror the observed rebind: only the first Run's owner/generation change;
    // its completed Task, Dispatch and saved disposition remain intact.
    const after = JSON.parse(readFileSync(h.state, "utf8"));
    after.runRecords[0].coordinator_handle = currentOwner;
    after.runRecords[0].consumer_generation = 2;
    writeFileSync(h.state, JSON.stringify(after));
    expect(after.tasks).toEqual(before.tasks);
    expect(after.dispatches).toEqual(before.dispatches);
    expect(after.tasks[0].created_by_run_generation).toBe(1);
    expect((await acquiredAuditDisposition(audit.snapshot, h.command)).verified).toBe(true);
    expect(readFileSync(audit.adopted.path, "utf8")).toBe(referenceBytes);
    // Saved evidence is reusable; it does not authorize a fresh adoption by a
    // null or different current owner.
    await expect(adoptAuditSnapshot(h.workspace, audit.hash, audit.run, audit.task, h.command)).rejects.toThrow();
  } finally { await h.close(); }
}, 30000);

// Readback-only native boundary: the initial approval above uses the stateful
// authenticated fixture. These records then model individually corrupted API
// responses without launching hundreds of stand-in processes.
async function auditReadback(h: Awaited<ReturnType<typeof contextFixture>>) {
  const audit = await completedAudit(h);
  const native = JSON.parse(readFileSync(h.state, "utf8"));
  const reference = JSON.parse(readFileSync(audit.adopted.path, "utf8"));
  const baseline = {
    reference, run: native.runRecords[0], task: native.tasks[0], dispatch: native.dispatches[0],
    result: JSON.parse(native.tasks[0].result), workspace: { id: reference.identity.worktreeId, path: h.workspace },
  };
  let records = structuredClone(baseline);
  const command: Command = async argv => {
    switch (argv.slice(0, 2).join(" ")) {
      case "orchestration run-show": return { run: records.run };
      case "worktree show": return { worktree: records.workspace };
      case "terminal show": return { terminal: baseline.reference.identity };
      case "orchestration dispatch-show": return { dispatch: records.dispatch };
      case "orchestration task-list": return { tasks: [{ ...records.task, result: JSON.stringify(records.result) }] };
      default: throw Error(`Unexpected readback: ${argv.join(" ")}`);
    }
  };
  const set = (next: typeof baseline) => {
    records = structuredClone(next);
    writeFileSync(audit.adopted.path, JSON.stringify(records.reference));
  };
  return { audit, baseline, command, set };
}

type AuditRecords = Awaited<ReturnType<typeof auditReadback>>["baseline"];
type AuditMutation = { name: string; change: (records: AuditRecords) => void };

// Each row names the authority guard whose removal must allow that bad input.
const provenanceMutations: AuditMutation[] = [
  ...Object.entries({
    run: { id: "other-run", legacy: 1, consumer_generation: 0, coordinator_handle: 3 },
    task: { id: "other-task", run_id: "other-run", parent_id: "worker-parent", created_by_run_generation: 0,
      created_by_terminal_handle: "replacement-coordinator", created_by_pane_key: "foreign:pane",
      created_by_process_incarnation: "foreign:incarnation", status: "failed", spec: "other audit" },
    dispatch: { id: "other-dispatch", run_id: "other-run", task_id: "other-task", status: "failed",
      creator_handle: "replacement-coordinator", creator_pane_key: "foreign:pane", creator_dispatch_id: "parent-dispatch",
      assignee_handle: "replacement-coordinator", assignee_pane_key: "foreign:pane", process_incarnation: "foreign:incarnation",
      retry_of_dispatch_id: "earlier-dispatch", termination_reason: "cancelled", depth: 2, failure_count: 1 },
    result: { provenance: "manual", outcome: "failed", reportedBy: "replacement-coordinator",
      completedBy: "replacement-coordinator", messageId: "other-message", body: "not-json" },
    workspace: { id: "other-workspace", path: "/other-project" },
  }).flatMap(([section, fields]) => Object.entries(fields).flatMap(([field, bad]) => [
    { name: `${section}.${field} changed`, change: (r: AuditRecords) => { (r as any)[section][field] = bad; } },
    { name: `${section}.${field} missing`, change: (r: AuditRecords) => { delete (r as any)[section][field]; } },
  ])),
  ...["run", "task", "dispatch"].map(section => ({
    name: `${section} absent`, change: (r: AuditRecords) => { (r as any)[section] = null; },
  })),
  ...["run", "task"].flatMap(section => [null, "1", -1, 1.5].map(value => ({
    name: `${section} generation malformed: ${JSON.stringify(value)}`,
    change: (r: AuditRecords) => { (r as any)[section][section === "run" ? "consumer_generation" : "created_by_run_generation"] = value; },
  }))),
  { name: "legacy false is not native zero", change: r => { r.run.legacy = false; } },
  { name: "empty current owner is not explicit null", change: r => { r.run.coordinator_handle = ""; } },
  { name: "Run generation rolled back to Task generation", change: r => { r.run.consumer_generation = 1; } },
  { name: "Task generation caught up with changed owner", change: r => { r.task.created_by_run_generation = 2; } },
  { name: "Task generation exceeds Run", change: r => { r.task.created_by_run_generation = 3; } },
];

it.each([null, "replacement-coordinator"])("rejects each provenance mutation from a verified retained baseline with owner %s", async currentOwner => {
  const h = await contextFixture();
  try {
    const { audit, baseline, command, set } = await auditReadback(h);
    baseline.run.coordinator_handle = currentOwner;
    baseline.run.consumer_generation = 2;
    expect(baseline.task.created_by_run_generation).toBe(1);
    const mutations: AuditMutation[] = [
      ...provenanceMutations,
      ...["handle", "worktreeId", "worktreePath", "ptyId", "incarnationId", "paneKey"].flatMap(field => [
        { name: `saved identity ${field} changed`, change: (r: AuditRecords) => { r.reference.identity[field] = "replacement-coordinator"; } },
        { name: `saved identity ${field} missing`, change: (r: AuditRecords) => { delete r.reference.identity[field]; } },
      ]),
      ...["runId", "taskId", "dispatchId", "messageId", "snapshotHash"].flatMap(field => [
        { name: `saved ${field} changed`, change: (r: AuditRecords) => { r.reference[field] = "other-id"; } },
        { name: `saved ${field} missing`, change: (r: AuditRecords) => { delete r.reference[field]; } },
      ]),
      { name: "new owner cannot replace saved identity and reporter", change: r => {
        r.reference.identity.handle = "replacement-coordinator";
        r.result.reportedBy = "replacement-coordinator";
      } },
      { name: "changed body snapshot hash", change: r => { r.result.body = JSON.stringify({ kind: "council-control-audit", snapshotHash: "0".repeat(64), approvedEffects: audit.snapshot.effects }); } },
      { name: "incomplete effect approval", change: r => { r.result.body = JSON.stringify({ kind: "council-control-audit", snapshotHash: audit.hash, approvedEffects: [] }); } },
      { name: "foreign effect approval", change: r => { r.result.body = JSON.stringify({ kind: "council-control-audit", snapshotHash: audit.hash, approvedEffects: ["foreign-effect"] }); } },
    ];
    set(baseline);
    expect((await acquiredAuditDisposition(audit.snapshot, command)).verified, "valid unbound baseline").toBe(true);
    for (const mutation of mutations) {
      const changed = structuredClone(baseline);
      mutation.change(changed);
      set(changed);
      expect((await acquiredAuditDisposition(audit.snapshot, command)).verified, mutation.name).toBe(false);
      set(baseline);
      expect((await acquiredAuditDisposition(audit.snapshot, command)).verified, `restored after ${mutation.name}`).toBe(true);
    }
    writeFileSync(audit.source, "drifted startup source\n");
    expect((await acquiredAuditDisposition(audit.snapshot, command)).verified).toBe(false);
    writeFileSync(audit.source, "reviewed startup source\n");
    expect((await acquiredAuditDisposition(audit.snapshot, command)).verified).toBe(true);
    expect((await acquiredAuditDisposition({ ...audit.snapshot, unavailable: ["source-unavailable"] }, command)).verified).toBe(false);
    expect((await acquiredAuditDisposition(audit.snapshot, command)).verified).toBe(true);
  } finally { await h.close(); }
}, 30000);

it("requires current root ownership and equal generations for adoption while same-owner reuse permits advancement", async () => {
  const h = await contextFixture();
  try {
    const { audit, baseline, command, set } = await auditReadback(h);
    const adopt = () => adoptAuditSnapshot(h.workspace, audit.hash, audit.run, audit.task, command);
    await expect(adopt()).resolves.toMatchObject({ hash: audit.hash });
    // The same-owner branch has a different boundary from null/changed owners.
    const advanced = structuredClone(baseline);
    advanced.run.consumer_generation = 2;
    set(advanced);
    expect((await acquiredAuditDisposition(audit.snapshot, command)).verified).toBe(true);
    await expect(adopt()).rejects.toThrow();
    const rollback = structuredClone(baseline);
    rollback.task.created_by_run_generation = 2;
    set(rollback);
    expect((await acquiredAuditDisposition(audit.snapshot, command)).verified).toBe(false);
    set(baseline);
    expect((await acquiredAuditDisposition(audit.snapshot, command)).verified).toBe(true);
    for (const mutation of provenanceMutations.filter(m => !m.name.includes("rolled back"))) {
      const changed = structuredClone(baseline);
      mutation.change(changed);
      set(changed);
      await expect(adopt(), mutation.name).rejects.toThrow();
      set(baseline);
      await expect(adopt(), `restored after ${mutation.name}`).resolves.toMatchObject({ hash: audit.hash });
    }
  } finally { await h.close(); }
}, 30000);

it("prepares actual versioned hook sources, adopts only matching native owner disposition, and invalidates drift", async()=>{
  const h=await contextFixture();
  try{
    vi.stubEnv("HOME",h.root);vi.stubEnv("PATH",h.root+delimiter+process.env.PATH);
    mkdirSync(join(h.root,".agents/policies"),{recursive:true});const policy=join(h.root,".agents/policies/model-policy.md");writeFileSync(policy,policyTable);
    const settings=join(h.root,".gemini/antigravity-cli");mkdirSync(settings,{recursive:true});
    writeFileSync(join(settings,"settings.json"),"{}");
    const hook=join(settings,"hooks.json");writeFileSync(hook,JSON.stringify({hooks:{SessionStart:[{command:"/bin/echo sanitized-lifecycle"}]}}));
    const help=readFileSync(new URL("./fixtures/agy-1.4.12-help.txt",import.meta.url),"utf8");
    const exe=join(h.root,"agy");writeFileSync(exe,`#!${process.execPath}\nprocess.stderr.write(${JSON.stringify(help)});`);chmodSync(exe,0o700);
    const prepared=await prepareProviderAudit(incidentRoster.reviewers.gemini,"1.4.12",h.workspace);
    expect(prepared.snapshot.sources.find(s=>s.path===hook)?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared.snapshot.sources.some(s=>s.path===policy)).toBe(true);expect(prepared.snapshot.effects).toHaveLength(1);expect(prepared.snapshot.unavailable).toEqual([]);
    const before=await inspectProviderControls(incidentRoster.reviewers.gemini,"1.4.12",h.workspace,{state:"unknown",source:"test",detail:"no billing"},h.command);
    expect(before.facts.find(f=>f.name==="workspace-trust")).toBeUndefined();
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
    const after=await inspectProviderControls(incidentRoster.reviewers.gemini,"1.4.12",h.workspace,{state:"unknown",source:"test",detail:"no billing"},h.command);
    expect(after.bootstrap.state).toBe("verified");expect(after.controls.state).toBe("unknown");
    const state=JSON.parse(readFileSync(h.state,"utf8"));const result=JSON.parse(state.tasks[0].result);state.tasks[0].result=JSON.stringify({...result,reportedBy:"foreign"});writeFileSync(h.state,JSON.stringify(state));
    expect((await acquiredAuditDisposition(prepared.snapshot,h.command)).verified).toBe(false);
    state.tasks[0].result=JSON.stringify(result);writeFileSync(h.state,JSON.stringify(state));
    writeFileSync(hook,JSON.stringify({hooks:{SessionStart:[{command:"/bin/echo changed"}]}}));
    await expect(adoptProviderAudit(h.workspace,prepared.hash,run,task,h.command)).rejects.toThrow("AUDIT_SOURCE_DRIFT");
    const drift=await inspectProviderControls(incidentRoster.reviewers.gemini,"1.4.12",h.workspace,{state:"unknown",source:"test",detail:"no billing"},h.command);
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
