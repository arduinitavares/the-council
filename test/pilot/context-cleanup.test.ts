import { it, expect } from "vitest";
import { createNativePilotDriver } from "../../dist/pilot/composition.js";
import { contextFixture } from "./context-fixture.js";
import type { ScopedMethod } from "../../src/pilot/rpc.js";
import { incidentRoster } from "./fixtures.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { verifyContextResult } from "../../dist/pilot/context-driver.js";
import { sha256, type WrapperAssignment } from "../../src/pilot/wrapper-contract.js";
import type { Attempt, PilotRequest } from "../../src/pilot/types.js";
import { recordCleanupArtifact } from "./provider-cleanup-fixture.js";

type ContextFixture = Awaited<ReturnType<typeof contextFixture>>;
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function rewriteBoundReport(h: ContextFixture, a: Attempt, patch: (report: any) => void): void {
  const file = join(a.context!.directory, "result.json");
  const original = JSON.parse(readFileSync(file, "utf8"));
  const report = structuredClone(original);
  const assignmentBefore = sha256(readFileSync(join(a.context!.directory, "assignment.json")));
  patch(report);
  writeFileSync(file, JSON.stringify(report));
  const state = JSON.parse(readFileSync(h.state, "utf8"));
  const task = state.tasks.find((entry: any) => entry.id === a.binding.taskId);
  const native = JSON.parse(task.result);
  const originalNative = structuredClone(native);
  native.body = native.body.replace(/sha256=[a-f0-9]{64}/, `sha256=${sha256(readFileSync(file))}`);
  native.outcome = report.status === "failed" ? "failed" : "succeeded";
  task.status = native.outcome === "failed" ? "failed" : "completed";
  task.result = JSON.stringify(native);
  writeFileSync(h.state, JSON.stringify(state));
  recordCleanupArtifact(`task3-rebound-${randomUUID()}.json`, {
    attempt: a.binding, originalReport: original, reboundReport: report, originalNative, reboundNative: native,
    assignmentBefore, assignmentAfter: sha256(readFileSync(join(a.context!.directory, "assignment.json"))),
    resultHash: sha256(readFileSync(file)),
  });
}

async function launchContext(h: ContextFixture, key: string) {
  let closes = 0;
  const rpc = { callScoped: async (method: ScopedMethod, parameters: any) => {
    if (method === "terminal.close") closes++;
    return h.rpc.callScoped(method, parameters);
  } };
  const driver = createNativePilotDriver({ command: h.command, inspector: { inspect: async () => ({ evidence: h.evidence, blockers: [] }) },
    rpc: () => rpc, orca: h.orca, record: event => h.events.push(event) });
  const request: PilotRequest = { workspace: h.workspace, config: incidentRoster, policyPath: "/synthetic", candidate: "JSON", suppliedText: "manifest",
    maxProbeCalls: 8, maxTopicCalls: 10, workerTimeoutMs: 5000, deadline: Date.now()+30000, proofs: [] };
  await driver.inspect(request);
  const run = await driver.begin(request);
  const a = await driver.launch(run, request, "gemini", "normal-probe", "fixture", key);
  const assignment = JSON.parse(readFileSync(join(a.context!.directory, "assignment.json"), "utf8")) as WrapperAssignment;
  expect(h.terminals.size).toBe(1);
  return { driver, a, assignment, closes: () => closes };
}

async function awaitWrapperReport(h: ContextFixture, a: Attempt) {
  const until = Date.now()+1500;
  const complete = () => existsSync(join(a.context!.directory, "completion-native.json")) &&
    [...h.terminals.values()].every(t => t.child.exitCode !== null && t.child.stdout!.readableEnded && t.child.stderr!.readableEnded);
  while (!complete() && Date.now() < until) await pause(10);
  expect(complete(), "wrapper completion, exit and output closure").toBe(true);
  return JSON.parse(readFileSync(join(a.context!.directory, "result.json"), "utf8"));
}

function processPresence(pid: unknown) {
  if (!Number.isSafeInteger(pid) || pid === 0) return "not-exposed";
  try { process.kill(pid as number, 0); return "present"; }
  catch (cause) { return (cause as NodeJS.ErrnoException).code === "ESRCH" ? "absent" : "unknown"; }
}

async function closeContext(h: ContextFixture, test: string) {
  const reports = h.events.filter(e => e.method === "terminal.create").map(created => {
    const directory = created.parameters.cwd;
    const file = directory && join(directory, "result.json");
    return file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  });
  const wrappersBeforeTeardown = [...h.terminals.values()].map(t => ({ pid: t.child.pid, exitCode: t.child.exitCode,
    signalCode: t.child.signalCode, terminalClosed: t.closed }));
  try { await h.close(); }
  finally {
    recordCleanupArtifact(`task3-context-${randomUUID()}.json`, { test, fixture: "offline context provider; not route qualification",
      reportTimeFacts: reports.map(report => report && ({ calls: report.calls, error: report.error, cancellation: report.cancellation, process: report.process })),
      wrappersBeforeTeardown,
      afterAwaitedTeardown: [...h.terminals.values()].map(t => ({ pid: t.child.pid, exitCode: t.child.exitCode, signalCode: t.child.signalCode,
        presence: processPresence(t.child.pid), stdoutEnded: t.child.stdout!.readableEnded, stderrEnded: t.child.stderr!.readableEnded, terminalClosed: t.closed })),
      laterProviderObservations: reports.map(report => ({ pid: report?.process?.pid ?? null, presence: processPresence(report?.process?.pid),
        groupPresence: processPresence(report?.process?.pid ? -report.process.pid : null) })),
      descendantAndScanPids: "not individually exposed by context report; retain producer settlement facts above",
      timers: "producer timersSettled fact above; wrapper timers cease on observed process exit", events: h.events,
    });
  }
}
for (const failure of ["connected", "generic-missing", "permission-denied", "foreign-incarnation", "uncertain-close"]) {
  it(`does not promote ${failure} to cleanup or duplicate close`,async()=>{
    const h=await contextFixture();let closes=0;
    try{
      const rpc={callScoped:async(method:ScopedMethod,parameters:any)=>{
        if(method==="terminal.show"){
          const shown=await h.rpc.callScoped(method,parameters);
          if(shown.terminal.connected===false){if(failure==="connected")shown.terminal.connected=true;if(failure==="foreign-incarnation")shown.terminal.incarnationId="foreign";}
          return shown;
        }
        if(method==="terminal.inspectProcess"&&["generic-missing","permission-denied"].includes(failure))throw Object.assign(Error("no receipt"),{code:failure==="permission-denied"?"permission_denied":"host_status_unavailable"});
        if(method==="terminal.close"){closes++;const closed=await h.rpc.callScoped(method,parameters);if(failure==="uncertain-close")throw Object.assign(Error("lost close reply"),{code:"ETIMEDOUT"});return closed;}
        return h.rpc.callScoped(method,parameters);
      }};
      const driver=createNativePilotDriver({command:h.command,inspector:{inspect:async()=>({evidence:h.evidence,blockers:[]})},rpc:()=>rpc,orca:h.orca,record:e=>h.events.push(e)});
      const request={workspace:h.workspace,config:incidentRoster,policyPath:"/synthetic",candidate:"JSON",suppliedText:"manifest",maxProbeCalls:8,maxTopicCalls:10,workerTimeoutMs:5000,deadline:Date.now()+30000,proofs:[]};
      await driver.inspect(request);const run=await driver.begin(request);const a=await driver.launch(run,request,"gemini","normal-probe","fixture",failure);
      await driver.observe(a,Date.now()+5000);
      expect(await driver.release(a,Date.now()+500)).toBe(false);expect(driver.proof!(a)).toBeNull();
      expect(await driver.release(a,Date.now()+500)).toBe(false);
      expect(closes).toBe(failure==="uncertain-close"?1:0);
      expect(driver.proof!(a)).toBeNull();
      recordCleanupArtifact(`task3-release-control-${randomUUID()}.json`, { test: failure, closes, proofAfterRepeatedRelease: driver.proof!(a) });
    }finally{await closeContext(h,failure);}
  },15000);
}

it.each([
  ["parsingSettled", false], ["parsingSettled", "deleted"],
  ["processScansSettled", false], ["processScansSettled", "deleted"],
] as const)("rejects a bound report with missing or false parser/scan settlement (%s=%s)", async (fact, value) => {
  const h = await contextFixture();
  try {
    const { driver, a, assignment, closes } = await launchContext(h, `${fact}-${value}`);
    await driver.observe(a, Date.now()+5000);
    const original = await awaitWrapperReport(h, a);
    expect(original.process).toMatchObject({ parsingSettled: true, processScansSettled: true });
    rewriteBoundReport(h, a, report => {
      if (value === "deleted") delete report.process[fact]; else report.process[fact] = value;
    });
    await expect(verifyContextResult(assignment, h.command)).rejects.toThrow("WRAPPER_RESULT_UNBOUND");
    const cancellation = await driver.cancel(a, Date.now()+200, "absolute-cleanup");
    expect(cancellation.state).toBe("unknown");
    const releases = [await driver.release(a, Date.now()+200), await driver.release(a, Date.now()+200)];
    expect(releases).toEqual([false, false]);
    expect(driver.proof!(a)).toBeNull();
    expect(closes()).toBe(0);
    recordCleanupArtifact(`task3-work-gate-${randomUUID()}.json`, { fact, value, cancellation, releases, closes: closes(), proof: driver.proof!(a) });
  } finally { await closeContext(h, `${fact}-${value}`); }
}, 15000);

it("releases a positively settled wrapper exactly once", async () => {
  const h = await contextFixture();
  try {
    const { driver, a, closes } = await launchContext(h, "positive-release");
    await driver.observe(a, Date.now()+5000);
    const report = await awaitWrapperReport(h, a);
    expect(report.process).toMatchObject({ parsingSettled: true, processScansSettled: true });
    const firstRelease = await driver.release(a, Date.now()+1000);
    expect(firstRelease).toBe(true);
    const proof = structuredClone(driver.proof!(a));
    expect(proof).not.toBeNull();
    const cleanup = readFileSync(join(a.context!.directory, "cleanup.json"));
    const secondRelease = await driver.release(a, Date.now()+1000);
    expect(secondRelease).toBe(true);
    expect(driver.proof!(a)).toEqual(proof);
    expect(readFileSync(join(a.context!.directory, "cleanup.json"))).toEqual(cleanup);
    expect(closes()).toBe(1);
    recordCleanupArtifact(`task3-positive-release-${randomUUID()}.json`, { firstRelease, secondRelease, firstProof: proof,
      secondProof: driver.proof!(a), closes: closes(), cleanup: JSON.parse(cleanup.toString()) });
  } finally { await closeContext(h, "positive-release"); }
}, 15000);

it("does not acknowledge a settled pre-input failure as active cancellation", async () => {
  const h = await contextFixture("tools");
  try {
    const { driver, a, assignment, closes } = await launchContext(h, "pre-input-failure");
    const original = await awaitWrapperReport(h, a);
    expect(original).toMatchObject({ status: "failed", calls: 0, cancellation: null,
      process: { inputDelivered: false, closed: true, groupSettled: true, trackedDescendantsSettled: true,
        parsingSettled: true, processScansSettled: true, timersSettled: true } });
    rewriteBoundReport(h, a, report => { report.error = "PROVIDER_STREAM_EVENT_UNSUPPORTED"; });
    expect((await verifyContextResult(assignment, h.command)).report.error).toBe("PROVIDER_STREAM_EVENT_UNSUPPORTED");
    const cancellation = await driver.cancel(a, Date.now()+1000, "absolute-cleanup");
    expect(cancellation).toMatchObject({ state: "settled_unacknowledged", error: "PROVIDER_STREAM_EVENT_UNSUPPORTED" });
    expect(existsSync(join(a.context!.directory, "cancel-ack.json"))).toBe(false);
    expect(existsSync(join(a.context!.directory, "inference-started.json"))).toBe(false);
    const released = await driver.release(a, Date.now()+1000);
    expect(released).toBe(true);
    expect(closes()).toBe(1);
    recordCleanupArtifact(`task3-preinput-cancel-${randomUUID()}.json`, { cancellation, released, closes: closes(),
      cancelAck: existsSync(join(a.context!.directory, "cancel-ack.json")), inferenceStarted: existsSync(join(a.context!.directory, "inference-started.json")) });
  } finally { await closeContext(h, "pre-input-failure"); }
}, 15000);

it("records positive no-provider work facts in the pre-spawn fallback", async () => {
  const h = await contextFixture();
  try {
    const source = join(h.root, "drifted-source.txt");
    writeFileSync(source, "current fixture source", { flag: "wx" });
    h.evidence.routes.find(route => route.role === "gemini")!.recipe!.sources.push({ path: source, kind: "file", sha256: "0".repeat(64) });
    const { driver, a, assignment, closes } = await launchContext(h, "pre-spawn-fallback");
    const report = await awaitWrapperReport(h, a);
    expect(report.version).toBe(2);
    expect(report.diagnostic).toMatchObject({ version: 1, code: "PROVIDER_CONTROL_SOURCE_DRIFT", inputDelivery: "not_attempted" });
    expect(report.error).toBe("PROVIDER_CONTROL_SOURCE_DRIFT");
    expect(report.calls).toBe(0);
    expect(report.process).toMatchObject({ providerStarted: false, parsingSettled: true, processScansSettled: true });
    expect(existsSync(join(a.context!.directory, "initialization-started.json"))).toBe(false);
    expect(existsSync(join(a.context!.directory, "inference-started.json"))).toBe(false);
    expect((await verifyContextResult(assignment, h.command)).report.status).toBe("failed");
    const released = await driver.release(a, Date.now()+1000);
    expect(released).toBe(true);
    expect(closes()).toBe(1);
    recordCleanupArtifact(`task3-before-spawn-${randomUUID()}.json`, { report, released, closes: closes(),
      initializationStarted: existsSync(join(a.context!.directory, "initialization-started.json")),
      inferenceStarted: existsSync(join(a.context!.directory, "inference-started.json")) });
  } finally { await closeContext(h, "pre-spawn-fallback"); }
}, 15000);
