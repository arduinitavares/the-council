import { expect, it } from "vitest";
import { OrcaPilotDriver } from "../../src/pilot/orca-driver.js";
import { incidentRoster } from "./fixtures.js";
import type { PilotRequest } from "../../src/pilot/types.js";
import { contextFixture } from "./context-fixture.js";
import { createNativePilotDriver } from "../../dist/pilot/composition.js";
import { runPilot } from "../../dist/pilot/workflow.js";
import { verifyNativeProof } from "../../dist/pilot/verify-proof.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

it("runs E4 through the shipped composition, actual wrapper processes and stateful native boundaries", async () => {
  const h = await contextFixture();
  try {
    const make = () => createNativePilotDriver({ command: h.command, inspector: { inspect: async () => ({ evidence: h.evidence, blockers: [] }) }, rpc: () => h.rpc, orca: h.orca, record: event => h.events.push(event) });
    const request: PilotRequest = { workspace: h.workspace, config: incidentRoster, policyPath: "/synthetic", candidate: "Use JSON", suppliedText: "A small immutable manifest", maxProbeCalls: 8, maxTopicCalls: 10, workerTimeoutMs: 5000, deadline: Date.now()+120000, proofs: [] };
    const result = await runPilot(request, make());
    expect(result.error, JSON.stringify({calls:result.calls,unresolved:result.unresolved,events:h.events.filter(e=>e.event||e.diagnostic).map(e=>({event:e.event,diagnostic:e.diagnostic,attempt:e.attempt?.binding}))})).toBeUndefined();
    expect(result.status).toBe("consensus");
    expect(result.calls).toEqual({ probes: 8, topic: 10 });
    expect(result.initializations).toBe(18);
    expect(result.proofs).toHaveLength(4);
    expect(result.proofs.every(p => p.schemaVersion === 2)).toBe(true);
    expect([...h.terminals.values()].every(t => t.closed)).toBe(true);
    for (const proof of result.proofs) expect(await verifyNativeProof(proof, h.command)).toBe(true);
    const reused = await runPilot({ ...request, deadline: Date.now()+120000, maxProbeCalls: 0, proofs: result.proofs }, make());
    expect(reused.status).toBe("consensus");
    expect(reused.calls).toEqual({ probes: 0, topic: 10 });
    const proof = result.proofs[0]!;
    const file = proof.normal.context!.directory+"/result.json";
    const original = readFileSync(file);
    writeFileSync(file, original.toString().replace('"calls":1','"calls":2'));
    expect(await verifyNativeProof(proof, h.command)).toBe(false);
    writeFileSync(file, original);
    const state = JSON.parse(readFileSync(h.state,"utf8"));
    state.tasks[0].result = JSON.stringify({ provenance: "worker_report", outcome: "succeeded", reportedBy: "foreign", messageId: "forged", body: "forged" });
    writeFileSync(h.state, JSON.stringify(state));
    expect(await verifyNativeProof(proof, h.command)).toBe(false);
  } finally { await h.close(); }
}, 120000);

for (const behavior of ["wrong-profile", "requirements-denied", "tools", "init-after-input"] as const) {
  it(`blocks ${behavior} at the real pre-input process boundary and never starts topics`, async () => {
    const h = await contextFixture(behavior);
    try {
      const driver = createNativePilotDriver({ command: h.command, inspector: { inspect: async () => ({ evidence: h.evidence, blockers: [] }) }, rpc: () => h.rpc, orca: h.orca, record: event => h.events.push(event) });
      const result = await runPilot({workspace:h.workspace,config:incidentRoster,policyPath:"/synthetic",candidate:"JSON",suppliedText:"immutable",maxProbeCalls:8,maxTopicCalls:10,workerTimeoutMs:2000,deadline:Date.now()+60000,proofs:[]},driver);
      expect(result.status).toBe("failed");
      expect(result.calls.topic).toBe(0);
      expect(result.calls.probes).toBe(behavior==="tools"||behavior==="init-after-input"?2:0);
      expect(result.error).toMatch(/CODEX_|PROVIDER_|WRAPPER_|NATIVE_INFERENCE_DEADLINE/);
      expect([...h.terminals.values()].every(value=>value.closed)).toBe(true);
    } finally {await h.close();}
  }, 30000);
}

it("never acknowledges cancellation after a final turn while its process is still alive", async () => {
  const h=await contextFixture("final-then-hang");
  try {
    const driver=createNativePilotDriver({command:h.command,inspector:{inspect:async()=>({evidence:h.evidence,blockers:[]})},rpc:()=>h.rpc,orca:h.orca,record:event=>h.events.push(event)});
    const request={workspace:h.workspace,config:incidentRoster,policyPath:"/synthetic",candidate:"JSON",suppliedText:"immutable",maxProbeCalls:8,maxTopicCalls:10,workerTimeoutMs:5000,deadline:Date.now()+30000,proofs:[]};
    await driver.inspect(request);const run=await driver.begin(request);
    const attempt=await driver.launch(run,request,"gemini","cancel-probe","synthetic fixture","final-then-cancel");
    while(!existsSync(attempt.context!.directory+"/turn-final.json"))await new Promise(resolve=>setTimeout(resolve,10));
    const cancelled=await driver.cancel(attempt,Date.now()+10000);
    expect(cancelled.state).toBe("settled_unacknowledged");
    expect(existsSync(attempt.context!.directory+"/cancel-ack.json")).toBe(false);
    expect(await driver.release(attempt,Date.now()+10000)).toBe(true);
  } finally {await h.close();}
},30000);

it("routes the shipped wrapper composition through its explicit custody port instead of worker-start", async () => {
  const calls: string[] = [];
  const port = { launch: async () => { calls.push("task-owned-wrapper"); return { launchVerified: true }; } };
  const driver = new OrcaPilotDriver(async argv => { calls.push(argv.slice(0, 2).join(" ")); return {}; },
    { inspect: async () => { throw Error("not used"); } }, Date.now, port as any);
  await driver.launch("run", { workspace: "/B", config: incidentRoster, deadline: Date.now()+10000, workerTimeoutMs: 1000 } as PilotRequest,
    "openai", "normal-probe", "packet", "key");
  expect(calls).toEqual(["task-owned-wrapper"]);
});
