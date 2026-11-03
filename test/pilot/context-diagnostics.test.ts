import { expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { verifyContextResult } from "../../src/pilot/context-driver.js";
import { DIAGNOSTIC_CODES } from "../../src/pilot/diagnostics.js";
import { PilotDiagnosticError } from "../../dist/pilot/diagnostics.js";
import { createNativePilotDriver } from "../../dist/pilot/composition.js";
import { sha256, type WrapperAssignment } from "../../src/pilot/wrapper-contract.js";
import type { Attempt, Phase, PilotRequest } from "../../src/pilot/types.js";
import type { ScopedRpc } from "../../src/pilot/rpc.js";
import { contextFixture } from "./context-fixture.js";
import { incidentRoster } from "./fixtures.js";
import { recordCleanupArtifact } from "./provider-cleanup-fixture.js";

type Fixture = Awaited<ReturnType<typeof contextFixture>>;
type Driver = ReturnType<typeof createNativePilotDriver>;
type Case = {
  h: Fixture;
  make(onBound?: (a: Attempt) => void): Driver;
  report(a: Attempt): Promise<any>;
  facts: Record<string, any>;
};
async function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error("fixture close not observed within bound")), ms);
    })]);
  } finally { clearTimeout(timer); }
}
function presence(pid: number | null | undefined): string {
  if (!pid) return "not-exposed";
  try { process.kill(pid, 0); return "present"; }
  catch (cause) { return (cause as NodeJS.ErrnoException).code === "ESRCH" ? "absent" : "unknown"; }
}
function assignment(a: Attempt): WrapperAssignment {
  return JSON.parse(readFileSync(join(a.context!.directory, "assignment.json"), "utf8"));
}

// Acquire once and immediately establish cleanup. Assertions, parsing, hashing
// and optional evidence writes all execute inside this scope.
async function usingContext(behavior: string, body: (c: Case) => Promise<void>) {
  const h = await contextFixture(behavior);
  let failure: unknown;
  const facts: Record<string, any> = { fixture: "offline Node/context; not provider qualification", behavior, root: h.root };
  const closed = new Map<string, Promise<void>>();
  try {
    const rpc: ScopedRpc = { callScoped: async (method, parameters) => {
      const result = await h.rpc.callScoped(method, parameters);
      if (method === "terminal.create") {
        const handle = result.terminal.handle;
        const child = h.terminals.get(handle)!.child;
        // Observe close in the same turn as acquisition, before launch resumes.
        closed.set(handle, new Promise<void>(resolve => child.once("close", () => resolve())));
      }
      return result;
    } };
    await body({
      h, facts,
      make: onBound => createNativePilotDriver({
        command: (...args) => h.command(...args),
        inspector: { inspect: async () => ({ evidence: h.evidence, blockers: [] }) },
        rpc: () => rpc, orca: h.orca,
        record: event => {
          h.events.push(event);
          if ((event as any).event === "wrapper-native-bound") onBound?.((event as any).attempt);
        },
      }),
      report: async a => {
        await within(closed.get(a.binding.handle)!, 7000);
        expect(existsSync(join(a.context!.directory, "completion-native.json"))).toBe(true);
        const report = JSON.parse(readFileSync(join(a.context!.directory, "result.json"), "utf8"));
        facts.originalReport = structuredClone(report);
        facts.originalNative = JSON.parse(readFileSync(h.state, "utf8"));
        return report;
      },
    });
  } catch (cause) { failure = cause; }
  finally {
    try {
      for (const [handle, entry] of h.terminals) {
        const directory = h.events.find(e => e.event === "wrapper-terminal-observed" && e.handle === handle)?.directory;
        if (entry.child.exitCode === null && entry.child.signalCode === null && directory) {
          const a = JSON.parse(readFileSync(join(directory, "assignment.json"), "utf8")) as WrapperAssignment;
          const file = join(directory, "cancel.json");
          if (!existsSync(file)) writeFileSync(file, JSON.stringify({ binding: a.binding, requestId: randomUUID(), deadline: Date.now()+5000 }), { flag: "wx", mode: 0o600 });
        }
        await within(closed.get(handle)!, 7000);
        const file = join(directory, "result.json");
        const bytes = readFileSync(file);
        let report: any;
        try { report = JSON.parse(bytes.toString()); } catch { /* Preserve malformed bytes as fixture evidence. */ }
        const observed = { handle, pid: entry.child.pid, exitCode: entry.child.exitCode, signalCode: entry.child.signalCode,
          closeObserved: true, stdoutEnded: entry.child.stdout!.readableEnded, stderrEnded: entry.child.stderr!.readableEnded,
          terminalClosed: entry.closed, wrapperPresence: presence(entry.child.pid),
          providerPresence: presence(report?.process?.pid), groupPresence: presence(report?.process?.pid ? -report.process.pid : null),
          reportHash: sha256(bytes), report, assignmentHash: sha256(readFileSync(join(directory, "assignment.json"))) };
        (facts.settlement ??= []).push(observed);
        expect(observed.wrapperPresence).toBe("absent");
        if (report?.process?.pid) {
          expect(observed.providerPresence).toBe("absent");
          expect(observed.groupPresence).toBe("absent");
        }
      }
    } catch (cause) {
      facts.teardownError = cause instanceof Error ? cause.message : "unknown";
      failure ??= cause;
    }
    try { await h.close(); } catch (cause) { failure ??= cause; }
    try {
      facts.events = h.events;
      facts.firstFailure = failure instanceof Error ? failure.message : failure ? "unknown" : null;
      facts.remainingWrappers = [...h.terminals.values()].map(t => ({ pid: t.child.pid, presence: presence(t.child.pid) }));
      facts.timers = "close-deadline timers cleared in finally; per-poll timers awaited";
      recordCleanupArtifact(`task3-diagnostics-${randomUUID()}.json`, facts);
    } catch (cause) { failure ??= cause; }
  }
  if (failure) throw failure;
}
async function launch(c: Case, onBound?: (a: Attempt) => void, phase: Phase = "normal-probe") {
  const driver = c.make(onBound);
  const request: PilotRequest = { workspace: c.h.workspace, config: incidentRoster, policyPath: "/synthetic", candidate: "JSON", suppliedText: "manifest",
    maxProbeCalls: 8, maxTopicCalls: 10, workerTimeoutMs: 5000, deadline: Date.now()+30000, proofs: [] };
  await driver.inspect(request);
  const run = await driver.begin(request);
  const a = await driver.launch(run, request, "gemini", phase, "fixture", "diagnostics-"+randomUUID());
  c.facts.attempt = structuredClone(a);
  return { driver, a };
}
function rewriteBoundReport(c: Case, a: Attempt, patch: (report: any) => void) {
  const file = join(a.context!.directory, "result.json");
  const assignmentBefore = sha256(readFileSync(join(a.context!.directory, "assignment.json")));
  const report = JSON.parse(readFileSync(file, "utf8"));
  patch(report);
  writeFileSync(file, JSON.stringify(report));
  const state = JSON.parse(readFileSync(c.h.state, "utf8"));
  const task = state.tasks.find((t: any) => t.id === a.binding.taskId);
  const native = JSON.parse(task.result);
  native.body = native.body.replace(/sha256=[a-f0-9]{64}/, `sha256=${sha256(readFileSync(file))}`);
  native.outcome = report.status === "failed" ? "failed" : "succeeded";
  task.status = native.outcome === "failed" ? "failed" : "completed";
  task.result = JSON.stringify(native);
  writeFileSync(c.h.state, JSON.stringify(state));
  c.facts.rebound = { report, native, resultHash: sha256(readFileSync(file)), assignmentBefore,
    assignmentAfter: sha256(readFileSync(join(a.context!.directory, "assignment.json"))) };
  expect(c.facts.rebound.assignmentAfter).toBe(assignmentBefore);
  return report;
}
function prepared(a: Attempt) {
  const value = assignment(a);
  return {
    version: 2, assignmentHash: a.context!.assignmentHash, ready: true, initializations: 1, error: null,
    diagnostic: { version: 1, origin: "provider", phase: "initialization", code: "NONE", classification: "none", inputDelivery: "not_attempted",
      exit: { state: "unknown", code: null, signal: null, signalState: "unknown" },
      counters: { stdoutBytes: 0, stdoutChunks: 0, stderrBytes: 0, stderrChunks: 0, exceptions: 0, unknownCodes: 0 },
      omissions: { stdout: false, stderr: false, exceptionText: false, initializationExtras: false, details: 0, countersSaturated: false },
      truncated: false, details: [] },
    init: { state: "verified", protocol: "agy-stream", model: value.selection.model, cwd: value.recipe.cwd, tools: [],
      permission: { state: "verified", value: "request-review" }, agent: { state: "unexposed", value: null } },
  };
}

it("accepts a bound v2 result through the strict source reader and actual context transport", async () => {
  await usingContext("normal", async c => {
    const { driver, a } = await launch(c);
    await c.report(a);
    expect((await verifyContextResult(assignment(a), c.h.command)).report.version).toBe(2);
    expect((await driver.observe(a, Date.now()+1000)).payload).toEqual({ ready: true });
    expect(await driver.release(a, Date.now()+1000)).toBe(true);
  });
}, 15000);

it.each([undefined, 1, 3])("rejects unsupported prepared version %s before readiness, initialization counts or input", async version => {
  await usingContext("normal", async c => {
    const { a } = await launch(c, a => {
      const value: any = prepared(a);
      if (version === undefined) delete value.version; else value.version = version;
      writeFileSync(join(a.context!.directory, "prepared.json"), JSON.stringify(value), { flag: "wx" });
    });
    expect(a.controlError).toBe("WRAPPER_DIAGNOSTIC_VERSION_UNSUPPORTED");
    expect(a.diagnostic?.code).toBe("WRAPPER_DIAGNOSTIC_VERSION_UNSUPPORTED");
    expect(a.launchVerified).toBe(false);
    expect(a.initializations).toBeNull();
    expect(a.inferenceStarted).toBe(false);
    expect(existsSync(join(a.context!.directory, "input.json"))).toBe(false);
  });
}, 15000);

it.each([undefined, 1, 3])("rejects unsupported bound report version %s without raw fallback", async version => {
  await usingContext("normal", async c => {
    const { driver, a } = await launch(c);
    await c.report(a);
    rewriteBoundReport(c, a, report => { if (version === undefined) delete report.version; else report.version = version; });
    await expect(verifyContextResult(assignment(a), c.h.command)).rejects.toThrow("WRAPPER_DIAGNOSTIC_VERSION_UNSUPPORTED");
    await expect(driver.observe(a, Date.now()+1000)).rejects.toThrow("WRAPPER_DIAGNOSTIC_VERSION_UNSUPPORTED");
    const stop = await driver.cancel(a, Date.now()+100, "absolute-cleanup");
    expect(stop.state).toBe("unknown");
    expect(await driver.release(a, Date.now()+100)).toBe(false);
    expect(driver.proof!(a)).toBeNull();
    expect(c.h.events.filter(e => e.method === "terminal.close")).toHaveLength(0);
    c.facts.cancellation = stop;
  });
}, 15000);

it.each(["stdout", "stderr", "diagnostic-extra", "unknown-code"])("rejects %s raw fields in an otherwise bound v2 report", async field => {
  await usingContext("normal", async c => {
    const { driver, a } = await launch(c);
    await c.report(a);
    rewriteBoundReport(c, a, report => {
      if (field === "diagnostic-extra") report.diagnostic.message = "diag-exception-10";
      else if (field === "unknown-code") { report.error = "ORCA_forged-secret"; report.diagnostic.code = "ORCA_forged-secret"; }
      else report[field] = "diag-stdout-10";
    });
    await expect(verifyContextResult(assignment(a), c.h.command)).rejects.toThrow("WRAPPER_RESULT_UNBOUND");
    await expect(driver.observe(a, Date.now()+1000)).rejects.toThrow("WRAPPER_RESULT_UNBOUND");
    const cancellation = await driver.cancel(a, Date.now()+100, "absolute-cleanup");
    expect(cancellation.state).toBe("unknown");
    expect(JSON.stringify(cancellation)).not.toMatch(/diag-stdout-10|diag-exception-10|ORCA_forged-secret/);
    expect(await driver.release(a, Date.now()+100)).toBe(false);
    expect(driver.proof!(a)).toBeNull();
    expect(c.h.events.filter(e => e.method === "terminal.close")).toHaveLength(0);
    c.facts.cancellation = cancellation;
  });
}, 15000);

it("propagates projected pre-input failure through attempt and cancellation with exact one-time release", async () => {
  await usingContext("tools", async c => {
    const { driver, a } = await launch(c);
    const report = await c.report(a);
    expect(a.launchVerified).toBe(false);
    expect(a.inferenceStarted).toBe(false);
    expect(a.controlError).toBe("PROVIDER_EFFECTIVE_CONTROLS_UNVERIFIED");
    expect(DIAGNOSTIC_CODES).toContain(a.controlError);
    expect(a.diagnostic).toEqual(report.diagnostic);
    expect(a.diagnostic).toMatchObject({ origin: "provider", phase: "initialization", inputDelivery: "not_attempted", exit: { state: "observed" } });
    const cancellation = await driver.cancel(a, Date.now()+1000, "absolute-cleanup");
    expect(cancellation).toEqual({ state: "settled_unacknowledged", error: "PROVIDER_EFFECTIVE_CONTROLS_UNVERIFIED", diagnostic: report.diagnostic });
    expect(report.cancellation).toBeNull();
    expect(report.calls).toBe(0);
    expect(existsSync(join(a.context!.directory, "cancel-ack.json"))).toBe(false);
    expect(existsSync(join(a.context!.directory, "inference-started.json"))).toBe(false);
    const stopBytes = readFileSync(join(a.context!.directory, "cancel.json"));
    expect(await driver.cancel(a, Date.now()+1000, "absolute-cleanup")).toEqual(cancellation);
    expect(readFileSync(join(a.context!.directory, "cancel.json"))).toEqual(stopBytes);
    expect(await driver.release(a, Date.now()+1000)).toBe(true);
    const proof = structuredClone(driver.proof!(a));
    expect(proof).not.toBeNull();
    expect(await driver.release(a, Date.now()+1000)).toBe(true);
    expect(driver.proof!(a)).toEqual(proof);
    expect(c.h.events.filter(e => e.method === "terminal.close").map(e => e.parameters)).toEqual([
      { terminal: a.binding.handle, expectedIncarnationId: assignment(a).identity.incarnationId },
    ]);
    c.facts.cancellation = cancellation;
    c.facts.proof = proof;
  });
}, 15000);

it("retains acknowledged active-turn cancellation diagnostic and the exact request and binding", async () => {
  await usingContext("normal", async c => {
    const { driver, a } = await launch(c, undefined, "cancel-probe");
    expect(a.launchVerified).toBe(true);
    const first = await driver.cancel(a, Date.now()+5000, "absolute-cleanup");
    const report = await c.report(a);
    const stopBytes = readFileSync(join(a.context!.directory, "cancel.json"));
    const request = JSON.parse(stopBytes.toString());
    expect(request.binding).toEqual(a.binding);
    expect(report.cancellation).toMatchObject({ binding: a.binding, requestId: request.requestId, acknowledged: true,
      activeTurn: { source: "AGY original user_input DONE", identity: "synthetic-session" } });
    expect(first).toEqual({ state: "settled", stop: { dispatchId: a.binding.dispatchId, requestId: request.requestId, state: "stopped", kind: "wrapper-control" }, diagnostic: report.diagnostic });
    expect(report.diagnostic).toMatchObject({ code: "NONE", inputDelivery: "acknowledged" });
    expect(await driver.cancel(a, Date.now()+1000, "absolute-cleanup")).toEqual(first);
    expect(readFileSync(join(a.context!.directory, "cancel.json"))).toEqual(stopBytes);
    rewriteBoundReport(c, a, value => { value.cancellation.requestId = "foreign-request"; });
    expect((await driver.cancel(a, Date.now()+1000, "absolute-cleanup")).state).toBe("settled_unacknowledged");
    rewriteBoundReport(c, a, value => { value.cancellation.requestId = request.requestId; value.cancellation.binding.dispatchId = "foreign-dispatch"; });
    expect((await driver.cancel(a, Date.now()+1000, "absolute-cleanup")).state).toBe("settled_unacknowledged");
    expect(await driver.release(a, Date.now()+1000)).toBe(true);
    c.facts.cancellation = first;
  });
}, 15000);

it.each([{ exitCode: 7, signal: null }, { exitCode: null, signal: "SIGTERM" }])("preserves acknowledged-input failure through observe (%j)", async exit => {
  await usingContext("normal", async c => {
    const { driver, a } = await launch(c);
    await c.report(a);
    expect(a).toMatchObject({ launchVerified: true, inferenceStarted: true, initializations: 1 });
    const report = rewriteBoundReport(c, a, value => {
      value.status = "failed"; value.error = "PROVIDER_STDERR_UNCLASSIFIED"; value.result = null;
      value.diagnostic = { ...value.diagnostic, origin: "provider", phase: "inference", code: "PROVIDER_STDERR_UNCLASSIFIED",
        classification: "protocol", inputDelivery: "acknowledged",
        exit: { state: "observed", code: exit.exitCode, signal: exit.signal, signalState: exit.signal ? "observed" : "none" } };
      value.process.exitCode = exit.exitCode; value.process.signal = exit.signal;
    });
    expect(report).toMatchObject({ calls: 1, process: { inputDelivered: true, closed: true, groupSettled: true, trackedDescendantsSettled: true,
      parsingSettled: true, processScansSettled: true, timersSettled: true, exitCode: exit.exitCode, signal: exit.signal } });
    expect((await verifyContextResult(assignment(a), c.h.command)).report.diagnostic).toEqual(report.diagnostic);
    let rejected: unknown;
    try { await driver.observe(a, Date.now()+1000); } catch (cause) { rejected = cause; }
    expect(rejected).toBeInstanceOf(PilotDiagnosticError);
    expect((rejected as PilotDiagnosticError).message).toBe("PROVIDER_STDERR_UNCLASSIFIED");
    expect((rejected as PilotDiagnosticError).diagnostic).toEqual(report.diagnostic);
    expect(report.result).toBeNull();
    const cancellation = await driver.cancel(a, Date.now()+1000, "absolute-cleanup");
    expect(cancellation).toEqual({ state: "settled_unacknowledged", error: "PROVIDER_STDERR_UNCLASSIFIED", diagnostic: report.diagnostic });
    expect(await driver.release(a, Date.now()+1000)).toBe(true);
    c.facts.cancellation = cancellation;
  });
}, 15000);

it("keeps unverified early-result calls and initialization accounting unknown", async () => {
  await usingContext("normal", async c => {
    const { a } = await launch(c, a => {
      writeFileSync(join(a.context!.directory, "prepared.json"), JSON.stringify(prepared(a)), { flag: "wx" });
      writeFileSync(join(a.context!.directory, "result.json"), JSON.stringify({ version: 3, calls: 0, initializations: 0, error: "diag-exception-10" }), { flag: "wx" });
    });
    c.facts.earlyReport = readFileSync(join(a.context!.directory, "result.json"), "utf8");
    renameSync(join(a.context!.directory, "result.json"), join(a.context!.directory, "early-result-fixture.json"));
    expect(a.launchVerified).toBe(false);
    expect(a.inferenceStarted).toBeNull();
    expect(a.initializations).toBe(1);
    expect(a.controlError).toBe("WRAPPER_DIAGNOSTIC_VERSION_UNSUPPORTED");
    expect(a.diagnostic?.inputDelivery).toBe("unknown");
    expect(JSON.stringify(a)).not.toContain("diag-exception-10");
  });
}, 15000);

it("rejects malformed prepared fields without copying raw errors or inventing initialization counts", async () => {
  await usingContext("normal", async c => {
    const { a } = await launch(c, a => {
      writeFileSync(join(a.context!.directory, "prepared.json"), JSON.stringify({ ...prepared(a), ready: false, initializations: 987, error: "diag-exception-10" }), { flag: "wx" });
    });
    expect(a.launchVerified).toBe(false);
    expect(a.initializations).toBeNull();
    expect(a.controlError).toBe("WRAPPER_RESULT_UNBOUND");
    expect(a.diagnostic?.code).toBe("WRAPPER_RESULT_UNBOUND");
    expect(JSON.stringify(a)).not.toContain("diag-exception-10");
    expect(existsSync(join(a.context!.directory, "input.json"))).toBe(false);
  });
}, 15000);

it("sanitizes actual native-boundary exceptions and keeps unverified cancellation unknown", async () => {
  await usingContext("normal", async c => {
    const { driver, a } = await launch(c);
    await c.report(a);
    const original = c.h.command;
    c.h.command = async (...args) => {
      if (args[0][1] === "dispatch-show") throw Error("diag-exception-10");
      return original(...args);
    };
    let rejected: unknown;
    try { await driver.observe(a, Date.now()+1000); } catch (cause) { rejected = cause; }
    expect(rejected).toBeInstanceOf(PilotDiagnosticError);
    expect((rejected as PilotDiagnosticError).message).toBe("DIAGNOSTIC_UNKNOWN");
    expect((rejected as PilotDiagnosticError).diagnostic.omissions.exceptionText).toBe(true);
    const cancellation = await driver.cancel(a, Date.now()+100, "absolute-cleanup");
    expect(cancellation.state).toBe("unknown");
    expect(cancellation.diagnostic?.code).toBe("DIAGNOSTIC_UNKNOWN");
    expect(JSON.stringify(cancellation)).not.toContain("diag-exception-10");
    expect(await driver.release(a, Date.now()+100)).toBe(false);
    expect(driver.proof!(a)).toBeNull();
    expect(c.h.events.filter(e => e.method === "terminal.close")).toHaveLength(0);
    c.facts.cancellation = cancellation;
  });
}, 15000);
