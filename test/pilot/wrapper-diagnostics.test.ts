import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { canonicalJson } from "../../src/domain/hash.js";
import { runHostWrapper } from "../../src/pilot/host-wrapper.js";
import { wrapperIntent } from "../../src/pilot/context-driver.js";
import { selectionSchema } from "../../src/pilot/config.js";
import { projectDiagnostic, MAX_DIAGNOSTIC_SUMMARY_BYTES } from "../../src/pilot/diagnostics.js";
import { assignmentSchema, preparedReportSchema, providerReportSchema, producerCodeHash, sha256, writeExclusive } from "../../src/pilot/wrapper-contract.js";
import { contextFixture } from "./context-fixture.js";

const fault = vi.hoisted(() => ({ material: "", rejectSession: false, rejection: undefined as unknown, preparedRace: "", raceBytes: "", preparedAttempts: 0, readPath: "", readError: undefined as unknown, invalidJson: false, evidencePath: "", evidenceError: undefined as unknown, entryEvidenceError: undefined as unknown, entrySpawn: undefined as (() => ChildProcess) | undefined, evidencePresent: undefined as boolean | undefined }));
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: (file: Parameters<typeof actual.existsSync>[0]) =>
    file === evidenceDirectory && fault.evidencePresent !== undefined ? fault.evidencePresent : actual.existsSync(file),
  readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
    if (args[0] === fault.readPath) { if (fault.invalidJson) return "{"; throw fault.readError; }
    if (args[0] === fault.material) throw Error("diag-exception-10");
    return actual.readFileSync(...args);
  }, writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
    if (fault.entryEvidenceError && typeof args[0] === "string" && args[0].startsWith(evidenceDirectory+"/entry-")) throw fault.entryEvidenceError;
    if (args[0] === fault.preparedRace) {
      if (++fault.preparedAttempts !== 1) throw Error("Unexpected prepared creation retry");
      actual.writeFileSync(args[0], fault.raceBytes, { flag: "wx", mode: 0o600 });
      throw Object.assign(Error("diag-exception-10"), { code: "EEXIST" });
    }
    return actual.writeFileSync(...args);
  }, appendFileSync: (...args: Parameters<typeof actual.appendFileSync>) => {
    if (args[0] === fault.evidencePath) throw fault.evidenceError;
    return actual.appendFileSync(...args);
  } };
});
vi.mock("../../src/pilot/provider-session.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../../src/pilot/provider-session.js")>();
  return { ...actual, runProviderSession: (...args: Parameters<typeof actual.runProviderSession>) =>
    fault.rejectSession ? Promise.reject(fault.rejection) : actual.runProviderSession(...args) };
});

vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: (...args: Parameters<typeof actual.spawn>) =>
    fault.entrySpawn && args[0] === process.execPath && Array.isArray(args[1]) && args[1][0] === resolve("dist/pilot/host-wrapper.js")
      ? fault.entrySpawn() : actual.spawn(...args) };
});

const canary = "diag-exception-10";
const evidenceDirectory = resolve(".superpowers/sdd/2026-11-01-council-bounded-diagnostics/task-2-fix-1-20261103");
afterEach(() => { fault.material = ""; fault.rejectSession = false; fault.rejection = undefined; fault.preparedRace = ""; fault.raceBytes = ""; fault.preparedAttempts = 0; fault.readPath = ""; fault.readError = undefined; fault.invalidJson = false; fault.evidencePath = ""; fault.evidenceError = undefined; fault.entryEvidenceError = undefined; fault.entrySpawn = undefined; fault.evidencePresent = undefined; vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function wrapperFixture() {
  const h = await contextFixture();
  try {
    let directory = h.workspace;
    for (const part of [".council", "native-host", randomUUID()]) {
      directory = join(directory, part); mkdirSync(directory, { mode: 0o700 });
    }
    const route = h.evidence.routes.find(entry => entry.role === "gemini")!;
    const base = {
      version: 1 as const, runtimeId: h.evidence.runtimeId, workspace: h.workspace, workspaceId: h.evidence.workspaceId,
      directory, identity: { handle: "terminal-1", worktreeId: h.evidence.workspaceId, ptyId: "pty-1", incarnationId: "incarnation-1", paneKey: "tab:1" },
      producerHash: producerCodeHash(), phase: "review" as const, role: "gemini" as const, selection: selectionSchema.parse(route.selection),
      packetHash: "synthetic-packet-hash", packet: "Offline wrapper diagnostics fixture", controlsHash: h.evidence.controlsHash,
      policyHash: h.evidence.policyHash, deadline: Date.now()+10000, orca: h.orca, recipe: { ...route.recipe!,
        materializations: [{ path: join(route.recipe!.cwd, "diagnostic-profile.json"), content: "{}", sha256: sha256("{}") }] },
    };
    const run = await h.command(["orchestration", "run-create", "--json"], h.workspace, 5000);
    const task = await h.command(["orchestration", "task-create", "--run", run.run.id, "--spec",
      `Council wrapper intent sha256=${sha256(canonicalJson(wrapperIntent(base)))}`, "--json"], h.workspace, 5000);
    const dispatched = await h.command(["orchestration", "dispatch", "--run", run.run.id, "--task", task.task.id, "--to", base.identity.handle, "--json"], h.workspace, 5000);
    const assignment = assignmentSchema.parse({ ...base, binding: { runId: run.run.id, taskId: task.task.id,
      dispatchId: dispatched.dispatch.id, handle: base.identity.handle, attemptKey: "wrapper-diagnostics" },
      dispatchIncarnation: dispatched.dispatch.process_incarnation });
    // The fixture's coordinator command retains its own identity; only the wrapper uses these.
    vi.stubEnv("ORCA_AGENT_SESSION_ID", undefined);
    vi.stubEnv("ORCA_TERMINAL_HANDLE", assignment.identity.handle); vi.stubEnv("ORCA_PANE_KEY", assignment.identity.paneKey);
    const evidence = existsSync(evidenceDirectory) ? join(evidenceDirectory, `fixture-${Date.now()}-${randomUUID()}.jsonl`) : null;
    const record = (entry: unknown) => { if (evidence) appendFileSync(evidence, JSON.stringify(entry)+"\n", { mode: 0o600 }); };
    let assignmentHash = "";
    return { ...h, directory, assignment, evidence,
      run: async () => {
        writeExclusive(join(directory, "assignment.json"), assignment);
        assignmentHash = sha256(readFileSync(join(directory, "assignment.json")));
        await runHostWrapper(directory, h.orca, assignment.runtimeId, assignment.deadline);
      },
      get assignmentHash() { return assignmentHash; },
      finish: async () => {
        let failed = false;
        try {
          const artifacts: Record<string, string> = {};
          for (const name of ["assignment.json", "wrapper-ready.json", "prepared.json", "result.json", "completion-reserved.json", "completion-native.json"]) {
            const file = join(directory, name);
            if (existsSync(file)) artifacts[name] = readFileSync(file, "utf8");
          }
          record({ stage: "original-before-teardown", testPid: process.pid, root: h.root, directory, assignmentHash,
            artifacts, nativeState: JSON.parse(readFileSync(h.state, "utf8")),
            initializationReceipt: existsSync(join(directory, "initialization-started.json")),
            inferenceReceipt: existsSync(join(directory, "inference-started.json")),
            terminalIdentities: [...h.terminals.keys()], events: h.events });
        } catch (cause) { failed = true; throw cause; }
        finally {
          try { await h.close(); }
          catch (cause) { if (!failed) throw cause; }
        }
        record({ stage: "fixture-teardown", rootAbsent: !existsSync(h.root), syntheticWrapperProcesses: h.terminals.size });
      } };
  } catch (cause) { await h.close(); throw cause; }
}


/** Measure the diagnostic object in the emitted bytes, including its whitespace. */
function diagnosticBytes(bytes: string): number {
  const key = /"diagnostic"\s*:\s*/.exec(bytes);
  if (!key) throw Error("Missing emitted diagnostic");
  const start = key.index+key[0].length;
  let depth = 0, quoted = false, escaped = false;
  for (let index = start; index < bytes.length; index++) {
    const char = bytes[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return Buffer.byteLength(bytes.slice(start, index+1), "utf8");
  }
  throw Error("Incomplete emitted diagnostic");
}
function artifacts(h: Awaited<ReturnType<typeof wrapperFixture>>, checkPrepared = true) {
  const preparedBytes = readFileSync(join(h.directory, "prepared.json"), "utf8");
  const resultBytes = readFileSync(join(h.directory, "result.json"), "utf8");
  // This is the required pre-implementation RED: setup reached the real fallback.
  expect(preparedBytes).not.toContain(canary); expect(resultBytes).not.toContain(canary);
  for (const bytes of [preparedBytes, resultBytes]) { expect(bytes).not.toContain("stack"); expect(bytes).not.toContain(" at "); }
  for (const bytes of checkPrepared ? [preparedBytes, resultBytes] : [resultBytes]) {
    expect(diagnosticBytes(bytes)).toBeLessThanOrEqual(MAX_DIAGNOSTIC_SUMMARY_BYTES);
  }
  const prepared = checkPrepared ? preparedReportSchema.parse(JSON.parse(preparedBytes)) : null;
  const report = providerReportSchema.parse(JSON.parse(resultBytes));
  expect(report.version).toBe(2); if (prepared) expect(prepared.version).toBe(2);
  for (const name of ["wrapper-ready.json", "prepared.json", "result.json", "completion-reserved.json", "completion-native.json"]) {
    expect(statSync(join(h.directory, name)).mode & 0o777).toBe(0o600);
  }
  for (const directory of [h.directory, join(h.workspace, ".council"), join(h.workspace, ".council/native-host")]) {
    expect(statSync(directory).mode & 0o777).toBe(0o700);
  }
  expect(report).toMatchObject({ status: "failed", binding: h.assignment.binding, assignmentHash: h.assignmentHash,
    packetHash: h.assignment.packetHash, controlsHash: h.assignment.controlsHash, wrapperPid: process.pid, result: null, cancellation: null });
  const state = JSON.parse(readFileSync(h.state, "utf8"));
  const task = state.tasks.find((entry: any) => entry.id === h.assignment.binding.taskId);
  const dispatch = state.dispatches.find((entry: any) => entry.id === h.assignment.binding.dispatchId);
  const completion = JSON.parse(task.result);
  const digest = sha256(resultBytes);
  expect(task.status).toBe("failed"); expect(dispatch.status).toBe("failed");
  expect(completion).toMatchObject({ provenance: "worker_report", outcome: "failed", reportedBy: h.assignment.identity.handle,
    completedBy: h.assignment.identity.handle, reportPath: join(h.directory, "result.json") });
  expect(completion.body).toBe(`The host wrapper collected the bound provider outcome. Artifact sha256=${digest} records original provider exit, input and cleanup evidence. The coordinator must independently verify wrapper exit and exact terminal closure.`);
  expect(JSON.parse(readFileSync(join(h.directory, "completion-reserved.json"), "utf8"))).toMatchObject({ binding: h.assignment.binding, digest });
  expect(JSON.parse(readFileSync(join(h.directory, "completion-native.json"), "utf8"))).toMatchObject({
    lifecycle: { action: "failed", taskId: h.assignment.binding.taskId, dispatchId: h.assignment.binding.dispatchId } });
  expect(existsSync(join(h.directory, "cleanup.json"))).toBe(false);
  return { prepared, report };
}

it("projects an actual pre-spawn materialization exception and proves no owned work", async () => {
  const h = await wrapperFixture();
  try {
    const material = join(h.assignment.recipe.cwd, "diagnostic-profile.json");
    fault.material = material;
    await h.run();
    const { prepared, report } = artifacts(h);
    expect(prepared).toMatchObject({ ready: false, initializations: 0, init: { state: "unobserved" } });
    expect(report).toMatchObject({ error: "DIAGNOSTIC_UNKNOWN", calls: 0, initializations: 0,
      diagnostic: { inputDelivery: "not_attempted", exit: { state: "not_started", code: null, signal: null, signalState: "none" }, omissions: { exceptionText: true } },
      process: { pid: null, providerStarted: false, exitCode: null, signal: null, closed: true, groupSettled: true,
        trackedDescendantsSettled: true, escapedDescendantObserved: false, parsingSettled: true, processScansSettled: true,
        timersSettled: true, inputDelivered: false, stopRequested: false, descendantEvidence: null } });
    expect(existsSync(join(h.directory, "initialization-started.json"))).toBe(false);
    expect(existsSync(join(h.directory, "inference-started.json"))).toBe(false);
  } finally { fault.material = ""; await h.finish(); }
});

it("keeps absent readiness and rejected session accounting explicitly unknown", async () => {
  const h = await wrapperFixture();
  try {
    fault.rejectSession = true; fault.rejection = Error(canary);
    await h.run();
    const { prepared, report } = artifacts(h);
    expect(prepared).toMatchObject({ ready: false, initializations: null, init: { state: "unobserved" } });
    expect(report).toMatchObject({ error: "DIAGNOSTIC_UNKNOWN", calls: null, initializations: null,
      diagnostic: { inputDelivery: "unknown", exit: { state: "unknown", code: null, signal: null, signalState: "unknown" } },
      process: { pid: null, providerStarted: null, exitCode: null, signal: null, closed: false, groupSettled: false,
        trackedDescendantsSettled: false, escapedDescendantObserved: null, parsingSettled: false, processScansSettled: false,
        timersSettled: false, inputDelivered: null, stopRequested: null, descendantEvidence: null } });
  } finally { await h.finish(); }
});

it("preserves existing readiness bytes after session rejection", async () => {
  const h = await wrapperFixture();
  try {
    fault.rejectSession = true; fault.rejection = Error(canary);
    const preparedBytes = readinessBytes(h);
    writeFileSync(join(h.directory, "prepared.json"), preparedBytes, { mode: 0o600, flag: "wx" });
    await h.run();
    expect(readFileSync(join(h.directory, "prepared.json"), "utf8")).toBe(preparedBytes);
    const { report } = artifacts(h);
    expect(report).toMatchObject({ calls: null, initializations: null, process: { providerStarted: null, closed: false } });
  } finally { await h.finish(); }
});

function readinessBytes(h: Awaited<ReturnType<typeof wrapperFixture>>) {
  return JSON.stringify({ version: 2, assignmentHash: sha256(canonicalJson(h.assignment)+"\n"), ready: true, initializations: 1,
    error: null, diagnostic: projectDiagnostic("NONE", { origin: "provider", phase: "initialization" }),
    init: { state: "verified", protocol: "agy-stream", model: h.assignment.selection.model, cwd: h.assignment.recipe.cwd,
      tools: [], permission: { state: "verified", value: h.assignment.recipe.expectedPermission }, agent: { state: "unexposed", value: null } } }, null, 2)+"\n";
}

it("never treats a forged pre-spawn Error.message as proof of no provider", async () => {
  const h = await wrapperFixture();
  try {
    fault.rejectSession = true; fault.rejection = Error("PROVIDER_BOOTSTRAP_UNVERIFIED");
    await h.run();
    const { prepared, report } = artifacts(h);
    expect(prepared).toMatchObject({ initializations: null });
    expect(report).toMatchObject({ error: "PROVIDER_BOOTSTRAP_UNVERIFIED", calls: null, initializations: null,
      diagnostic: { inputDelivery: "unknown", exit: { state: "unknown" } },
      process: { providerStarted: null, closed: false, groupSettled: false, trackedDescendantsSettled: false,
        parsingSettled: false, processScansSettled: false, timersSettled: false, inputDelivered: null } });
  } finally { await h.finish(); }
});

it("retains a validated original diagnostic without raw cause or stack", async () => {
  const h = await wrapperFixture();
  try {
    const { ProviderSessionFailure } = await import("../../src/pilot/diagnostics.js");
    const original = projectDiagnostic(Error("PROVIDER_INPUT_DEADLINE"), { origin: "provider", phase: "input", inputDelivery: "attempted_unacknowledged" },
      { exit: { state: "observed", code: 7, signal: "SIGTERM", signalState: "observed" },
        details: [{ origin: "provider", phase: "cleanup", code: "PROVIDER_PROCESS_SETTLEMENT_UNVERIFIED" }] });
    const failure = new ProviderSessionFailure(original, "unknown");
    Object.defineProperty(failure, "cause", { value: Error(canary), enumerable: true });
    failure.stack = canary;
    fault.rejectSession = true; fault.rejection = failure;
    await h.run();
    const { prepared, report } = artifacts(h);
    expect(prepared!.diagnostic).toEqual(original);
    expect(report.diagnostic).toEqual(original);
    expect(report).toMatchObject({ calls: null, initializations: null, process: { providerStarted: null, exitCode: null, signal: null, closed: false } });
  } finally { await h.finish(); }
});

it.each(["throwing-prototype", "revoked-proxy", "unreadable-state", "invalid-state", "unreadable-diagnostic", "invalid-diagnostic"] as const)(
  "keeps unsafe carrier lifecycle unknown: %s", async mode => {
    const h = await wrapperFixture();
    try {
      const { ProviderSessionFailure } = await import("../../src/pilot/diagnostics.js");
      const diagnostic = projectDiagnostic("PROVIDER_PROFILE_SCOPE_INVALID", { origin: "provider", phase: "bootstrap" });
      const failure = new ProviderSessionFailure(diagnostic, "not_started");
      if (mode === "throwing-prototype") fault.rejection = new Proxy({}, { getPrototypeOf() { throw Error(canary); } });
      else if (mode === "revoked-proxy") { const proxy = Proxy.revocable({}, {}); proxy.revoke(); fault.rejection = proxy.proxy; }
      else {
        if (mode === "unreadable-state") Object.defineProperty(failure, "providerState", { get() { throw Error(canary); } });
        if (mode === "invalid-state") Object.defineProperty(failure, "providerState", { value: canary });
        if (mode === "unreadable-diagnostic") Object.defineProperty(failure, "diagnostic", { get() { throw Error(canary); } });
        if (mode === "invalid-diagnostic") Object.defineProperty(failure, "diagnostic", { value: { secret: canary } });
        fault.rejection = failure;
      }
      fault.rejectSession = true;
      await h.run();
      const { prepared, report } = artifacts(h);
      expect(prepared).toMatchObject({ initializations: null });
      expect(report).toMatchObject({ calls: null, initializations: null, process: { providerStarted: null, closed: false,
        groupSettled: false, trackedDescendantsSettled: false, parsingSettled: false, processScansSettled: false, timersSettled: false } });
      if (mode === "unreadable-state" || mode === "invalid-state") expect(report.diagnostic).toEqual(diagnostic);
      else expect(report.error).toBe("DIAGNOSTIC_UNKNOWN");
    } finally { await h.finish(); }
  });

it.each(["missing-version", "legacy-version", "future-version", "foreign-assignment", "malformed-schema", "duplicate-key", "symlink"] as const)(
  "preserves invalid existing readiness and records a finite detail: %s", async mode => {
    const h = await wrapperFixture();
    try {
      const file = join(h.directory, "prepared.json");
      const prepared = JSON.parse(readinessBytes(h));
      if (mode === "missing-version") delete prepared.version;
      if (mode === "legacy-version") prepared.version = 1;
      if (mode === "future-version") prepared.version = 3;
      if (mode === "foreign-assignment") prepared.assignmentHash = "foreign-assignment";
      if (mode === "malformed-schema") prepared.initializations = 2;
      const bytes = mode === "duplicate-key" ? '{"version":2,"version":2}\n' : JSON.stringify(prepared, null, 2)+"\n";
      if (mode === "symlink") {
        const { symlinkSync } = await import("node:fs");
        const target = join(h.directory, "existing-readiness.json");
        writeFileSync(target, bytes, { flag: "wx", mode: 0o600 }); symlinkSync(target, file);
      } else writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
      fault.rejectSession = true; fault.rejection = Error(canary);
      await h.run();
      expect(readFileSync(file, "utf8")).toBe(bytes);
      const { report } = artifacts(h, false);
      expect(report).toMatchObject({ calls: null, initializations: null, diagnostic: { code: "DIAGNOSTIC_UNKNOWN",
        details: [{ origin: "host-wrapper", phase: "validation", code: "WRAPPER_RESULT_UNBOUND" }] },
        process: { providerStarted: null, closed: false } });
      if (mode === "symlink") {
        const { lstatSync } = await import("node:fs"); expect(lstatSync(file).isSymbolicLink()).toBe(true);
      }
    } finally { await h.finish(); }
  });

it.each([true, false])("validates a prepared creation race without retry or rewrite (bound=%s)", async bound => {
  const h = await wrapperFixture();
  try {
    fault.rejectSession = true; fault.rejection = Error(canary);
    fault.preparedRace = join(h.directory, "prepared.json");
    fault.raceBytes = bound ? readinessBytes(h) : '{"version":1}\n';
    const expectedBytes = fault.raceBytes;
    await h.run();
    expect(readFileSync(join(h.directory, "prepared.json"), "utf8")).toBe(expectedBytes);
    const { report } = artifacts(h, bound);
    expect(report.calls).toBeNull(); expect(report.initializations).toBeNull();
    expect(report.diagnostic.details).toEqual(bound ? [] : [{ origin: "host-wrapper", phase: "validation", code: "WRAPPER_RESULT_UNBOUND" }]);
    // A second exclusive creation would fail this fixture before result persistence.
    expect(fault.preparedAttempts).toBe(1);
  } finally { fault.preparedRace = ""; await h.finish(); }
});

it("never overwrites an existing result artifact", async () => {
  const h = await wrapperFixture();
  try {
    const file = join(h.directory, "result.json"), bytes = '{"prior":"owned-evidence"}\n';
    writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
    fault.rejectSession = true; fault.rejection = Error(canary);
    await expect(h.run()).rejects.toThrow();
    expect(readFileSync(file, "utf8")).toBe(bytes);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(existsSync(join(h.directory, "completion-native.json"))).toBe(false);
    const state = JSON.parse(readFileSync(h.state, "utf8"));
    expect(state.tasks[0].status).toBe("dispatched");
  } finally { await h.finish(); }
});


type DirectEntryDependencies = {
  contextFixture: typeof contextFixture;
  setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
};
const directEntryDependencies: DirectEntryDependencies = { contextFixture, setTimeout, clearTimeout };

function cleanupFaultEvidence(name: string, stage: string, facts: unknown) {
  if (existsSync(evidenceDirectory)) writeFileSync(join(evidenceDirectory, `cleanup-fault-${name}-${stage}-${randomUUID()}.json`),
    JSON.stringify(facts)+"\n", { flag: "wx", mode: 0o600 });
}

/** Only this direct-entry invocation uses this observed real clock. */
function observedEntryClock() {
  const pending = new Set<ReturnType<typeof setTimeout>>();
  return { pending,
    setTimeout: (callback: () => void, delay: number) => {
      const timer = setTimeout(() => { pending.delete(timer); callback(); }, delay);
      pending.add(timer); return timer;
    },
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => { clearTimeout(timer); pending.delete(timer); },
  };
}

/** No OS process is acquired; the synthetic PID is intercepted only by its owned probe. */
function controlledEntryChild(streamFailure?: Error, completeNormally = false) {
  const child = new EventEmitter() as ChildProcess;
  const stdout = new PassThrough(), stderr = new PassThrough();
  const pid = 2147483647;
  let acquired = false, closed = false, killRequests = 0, streamFailed = false;
  let observeClose!: () => void;
  const stopped = new Promise<void>(resolve => { observeClose = resolve; });
  child.once("close", () => { closed = true; observeClose(); });
  const on = stdout.on.bind(stdout);
  stdout.on = ((...args: Parameters<typeof stdout.on>) => {
    if (streamFailure && !streamFailed) { streamFailed = true; throw streamFailure; }
    return on(...args);
  }) as typeof stdout.on;
  const settle = (code: number | null, signal: NodeJS.Signals | null) => {
    if (closed) return;
    stdout.end(); stderr.end(); child.emit("close", code, signal);
  };
  Object.assign(child, { pid, stdout, stderr, kill: () => {
    killRequests++; queueMicrotask(() => settle(null, "SIGKILL")); return true;
  } });
  return { child, pid, stopped, get acquired() { return acquired; }, get closed() { return closed; },
    get killRequests() { return killRequests; },
    spawn: () => {
      acquired = true;
      if (completeNormally) queueMicrotask(() => { stderr.write("DIAGNOSTIC_UNKNOWN\n"); settle(1, null); });
      return child;
    },
    probe: () => {
      const actualKill = process.kill.bind(process);
      return vi.spyOn(process, "kill").mockImplementation((target, signal) => {
        if (target === pid || target === -pid) {
          if (closed) throw Object.assign(Error("synthetic owned process absent"), { code: "ESRCH" });
          return true;
        }
        return actualKill(target, signal);
      });
    },
  };
}

async function directEntryFixture({ contextFixture, setTimeout, clearTimeout }: DirectEntryDependencies = directEntryDependencies) {
  const h = await contextFixture();
  let child: ChildProcess | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let childClose: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
  let closed = false, failed = false;
  const entryEvidence: Record<string, unknown> = {};
  try {
    entryEvidence.root = h.root;
    const builtWrapperHash = sha256(readFileSync(resolve("dist/pilot/host-wrapper.js")));
    const { spawn } = await import("node:child_process");
    child = spawn(process.execPath, [resolve("dist/pilot/host-wrapper.js"), "--directory", join(h.root, canary),
      "--orca", h.orca, "--runtime", h.evidence.runtimeId, "--deadline", String(Date.now()+5000)], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let childError: unknown, childErrored = false;
    // Retain close/error observation before any stream setup can fail.
    childClose = new Promise(resolve => {
      child!.once("error", cause => { childError = cause; childErrored = true; });
      child!.once("close", (code, signal) => { closed = true; resolve({ code, signal }); });
    });
    Object.assign(entryEvidence, { pid: child.pid, pgid: child.pid, builtWrapperHash });
    let stdout = "", stderr = "", timedOut = false;
    child.stdout!.on("data", bytes => { stdout += bytes.toString(); });
    child.stderr!.on("data", bytes => { stderr += bytes.toString(); });
    timer = setTimeout(() => { timedOut = true; child!.kill("SIGKILL"); }, 2000);
    const result = await childClose;
    if (childErrored) throw childError;
    clearTimeout(timer);
    let groupAbsent = false, pidAbsent = false;
    for (const [target, label] of [[-child.pid!, "group"], [child.pid!, "pid"]] as const) {
      try { process.kill(target, 0); }
      catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ESRCH") throw cause; if (label === "group") groupAbsent = true; else pidAbsent = true; }
    }
    Object.assign(entryEvidence, { originalClose: result, closed, groupAbsent, pidAbsent, timerCleared: true, timedOut, stdout, stderr });
    expect(timedOut).toBe(false); expect(closed).toBe(true); expect(groupAbsent).toBe(true); expect(pidAbsent).toBe(true);
    expect(result).toEqual({ code: 1, signal: null }); expect(stdout).toBe(""); expect(stderr).toBe("DIAGNOSTIC_UNKNOWN\n");
  } catch (cause) { failed = true; throw cause; }
  finally {
    let cleanupFailed = false, cleanupError: unknown;
    const settle = async (action: () => void | Promise<void>) => {
      try { await action(); }
      catch (cause) { if (!cleanupFailed) { cleanupFailed = true; cleanupError = cause; } }
    };
    await settle(() => { if (timer !== undefined) clearTimeout(timer); });
    await settle(async () => {
      if (child) {
        if (!closed) child.kill("SIGKILL");
        await childClose;
      }
    });
    await settle(() => h.close());
    await settle(() => {
      if (existsSync(evidenceDirectory)) writeFileSync(join(evidenceDirectory, `entry-${Date.now()}-${randomUUID()}.json`), JSON.stringify({ ...entryEvidence,
        teardown: { fixtureRootAbsent: !existsSync(h.root), wrapperClosed: closed } })+"\n", { mode: 0o600, flag: "wx" });
    });
    if (!failed && cleanupFailed) throw cleanupError;
  }
}

it("projects a real built direct-entry filesystem rejection to code-only stderr", () => directEntryFixture(), 10000);

it.each(["artifact-read", "native-state-read", "native-state-parse", "evidence-write"] as const)(
  "cleanup fault: collector %s always removes its fixture and retains its error", async mode => {
    const injected = Error(`cleanup-${mode}-canary`);
    if (mode === "evidence-write") fault.evidencePresent = true;
    const h = await wrapperFixture();
    let originalError: unknown, parserError: unknown;
    let parseSpy: ReturnType<typeof vi.spyOn> | undefined;
    const name = `collector-${mode}`;
    try {
      if (mode === "artifact-read") {
        const file = join(h.directory, "wrapper-ready.json");
        writeFileSync(file, "{}", { flag: "wx", mode: 0o600 });
        fault.readPath = file; fault.readError = injected;
      } else if (mode === "native-state-read") {
        fault.readPath = h.state; fault.readError = injected;
      } else if (mode === "native-state-parse") {
        fault.readPath = h.state; fault.invalidJson = true;
        const parse = JSON.parse;
        parseSpy = vi.spyOn(JSON, "parse").mockImplementation((text, reviver) => {
          try { return parse(text, reviver); }
          catch (cause) { if (text === "{") parserError = cause; throw cause; }
        });
      } else {
        expect(h.evidence).not.toBeNull();
        fault.evidencePath = h.evidence!; fault.evidenceError = injected;
      }
      try { await h.finish(); } catch (cause) { originalError = cause; }
      fault.evidencePresent = undefined;
      const original = { root: h.root, rootAbsent: !existsSync(h.root), errorRetained: originalError === (parserError ?? injected),
        errorName: originalError instanceof Error ? originalError.name : null, fixtureTerminals: h.terminals.size };
      cleanupFaultEvidence(name, "original", original);
      expect.soft(original.errorRetained).toBe(true);
      if (mode === "native-state-parse") expect.soft(originalError).toBeInstanceOf(SyntaxError);
      expect.soft(original.rootAbsent).toBe(true);
    } finally {
      fault.readPath = ""; fault.readError = undefined; fault.invalidJson = false;
      fault.evidencePath = ""; fault.evidenceError = undefined; fault.evidencePresent = undefined; parseSpy?.mockRestore();
      // Independent containment after recording the helper's original failure facts.
      await h.close();
      const emergency = { root: h.root, rootAbsent: !existsSync(h.root), fixtureTerminals: h.terminals.size };
      cleanupFaultEvidence(name, "emergency", emergency);
      expect(emergency.rootAbsent).toBe(true);
    }
  });

it.each(["built-artifact-read", "child-stream-setup", "entry-evidence-write"] as const)(
  "cleanup fault: direct entry %s settles acquired work and retains its error", async mode => {
    const injected = Error(`cleanup-${mode}-canary`);
    const actor = controlledEntryChild(mode === "child-stream-setup" ? injected : undefined, mode === "entry-evidence-write");
    const clock = observedEntryClock();
    const probe = actor.probe();
    let h: Awaited<ReturnType<typeof contextFixture>> | undefined;
    let originalError: unknown;
    try {
      fault.entrySpawn = actor.spawn;
      if (mode === "built-artifact-read") { fault.readPath = resolve("dist/pilot/host-wrapper.js"); fault.readError = injected; }
      if (mode === "entry-evidence-write") { fault.entryEvidenceError = injected; fault.evidencePresent = true; }
      try {
        await directEntryFixture({ contextFixture: async () => { h = await contextFixture(); return h; },
          setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
      } catch (cause) { originalError = cause; }
      fault.evidencePresent = undefined;
      const original = { root: h?.root, rootAbsent: !!h && !existsSync(h.root), errorRetained: originalError === injected,
        simulatedChild: true, acquired: actor.acquired, childClosed: actor.closed, pendingTimers: clock.pending.size,
        killRequests: actor.killRequests };
      cleanupFaultEvidence(mode, "original", original);
      expect.soft(original.errorRetained).toBe(true);
      expect.soft(original.rootAbsent).toBe(true);
      expect.soft(clock.pending.size).toBe(0);
      expect.soft(!actor.acquired || actor.closed).toBe(true);
      if (mode === "built-artifact-read") expect.soft(actor.acquired).toBe(false);
    } finally {
      fault.entrySpawn = undefined; fault.readPath = ""; fault.readError = undefined; fault.entryEvidenceError = undefined; fault.evidencePresent = undefined;
      for (const timer of [...clock.pending]) clock.clearTimeout(timer);
      if (actor.acquired && !actor.closed) { actor.child.kill("SIGKILL"); await actor.stopped; }
      if (h) await h.close();
      const emergency = { root: h?.root, rootAbsent: !!h && !existsSync(h.root), simulatedChild: true,
        acquired: actor.acquired, childClosed: actor.closed, pendingTimers: clock.pending.size, killRequests: actor.killRequests };
      cleanupFaultEvidence(mode, "emergency", emergency);
      expect(emergency.rootAbsent).toBe(true); expect(emergency.pendingTimers).toBe(0);
      expect(!actor.acquired || actor.closed).toBe(true);
      probe.mockRestore();
    }
  });
