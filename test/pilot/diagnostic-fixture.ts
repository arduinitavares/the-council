import * as childProcess from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { vi } from "vitest";
import { codexKernel } from "../../src/pilot/codex-controls.js";
import { runProviderSession } from "../../src/pilot/provider-session.js";
import { sha256, type ProviderRecipe } from "../../src/pilot/wrapper-contract.js";
import { fixtureAssignment, recordCleanupArtifact } from "./provider-cleanup-fixture.js";
import { incidentRoster } from "./fixtures.js";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

const spawnObservation = vi.hoisted(() => ({ observe: undefined as ((child: childProcess.ChildProcess) => void) | undefined,
  replacement: undefined as (() => childProcess.ChildProcess) | undefined }));
vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: (...args: Parameters<typeof actual.spawn>) => {
    const child = spawnObservation.replacement ? spawnObservation.replacement() : actual.spawn(...args);
    spawnObservation.observe?.(child);
    return child;
  } };
});
const artifactRead = vi.hoisted(() => ({ faultFile: "" }));
vi.mock("../../src/pilot/wrapper-contract.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../../src/pilot/wrapper-contract.js")>();
  return { ...actual, readStrictFile: (...args: Parameters<typeof actual.readStrictFile>) => {
    if (args[0] === artifactRead.faultFile) { artifactRead.faultFile = ""; throw Error("diag-exception-10"); }
    return actual.readStrictFile(...args);
  } };
});

export const diagnosticCanaries = Object.freeze({
  stdout: "diag-stdout-10", stderrA: "diag-stderr-a-10", stderrB: "diag-stderr-b-10",
  initExtra: "diag-init-extra-10", exception: "diag-exception-10", requestedResult: "requested-result-10-秘密",
});
export type DiagnosticMode = "normal" | "stderr" | "invalid-init" | "cancel-active" | "cancel-before-input";
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function diagnosticFixture(mode: DiagnosticMode, protocol: ProviderRecipe["protocol"] = "agy-stream",
  options: { extras?: boolean; assessment?: string; foreignThread?: boolean } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "council-diagnostic-")));
  const assignment = fixtureAssignment(root, 5000), { directory } = assignment;
  assignment.phase = "review";
  assignment.recipe.protocol = protocol;
  if (protocol !== "agy-stream") {
    assignment.role = protocol === "codex-app-server" ? "openai" : "xai";
    assignment.selection = assignment.recipe.selection = protocol === "codex-app-server" ? incidentRoster.reviewers.openai : incidentRoster.reviewers.xai;
    assignment.recipe.facts = [];
  }
  assignment.recipe.argv = [resolve("test/pilot/fixtures/diagnostic-provider.cjs"), mode, protocol, directory, assignment.selection.model, "--agent", "council-packet"];
  if (protocol === "codex-app-server") {
    const kernel = codexKernel([], assignment.recipe.cwd, assignment.selection.model, assignment.selection.effort);
    assignment.recipe.codexPolicy = kernel.policy;
    assignment.recipe.argv.push(...kernel.argv);
    delete assignment.recipe.agent; delete assignment.recipe.agentDefinition;
  }
  const assignmentHash = sha256(JSON.stringify(assignment)), nonce = randomUUID();
  writeFileSync(join(directory, "fixture-owner.json"), JSON.stringify({ assignmentHash, nonce, parentPid: process.pid }));
  writeFileSync(join(directory, "fixture-options.json"), JSON.stringify({ extras: true, ...options }));
  if (mode !== "cancel-before-input") writeFileSync(join(directory, "input.json"), JSON.stringify({ assignmentHash, requestId: nonce }));
  const watchdog = childProcess.spawn(process.execPath, [resolve("test/pilot/fixtures/provider-watchdog.cjs"), directory, assignmentHash, nonce, String(process.pid)],
    { detached: true, stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let watchdogClosed = false, watchdogCode: number | null = null, watchdogDiagnostic = "", armed = false;
  watchdog.stderr!.on("data", bytes => { watchdogDiagnostic += bytes.toString(); });
  watchdog.once("close", code => { watchdogClosed = true; watchdogCode = code; });
  watchdog.on("message", message => { if ((message as any)?.type === "armed" && (message as any).nonce === nonce) armed = true; });
  const waitFor = async (check: () => boolean, budget = 2000) => {
    const until = performance.now()+budget;
    while (!check() && performance.now() < until) await pause(10);
    if (!check()) throw Error("Diagnostic fixture observation deadline");
  };
  await waitFor(() => armed);
  let report: Awaited<ReturnType<typeof runProviderSession>> | undefined, rejected: unknown;
  let result: ReturnType<typeof runProviderSession> | undefined;
  let polling: ReturnType<typeof setInterval> | undefined;
  let sourceTrace = "";
  const manifest = () => JSON.parse(readFileSync(join(directory, "fixture-manifest.json"), "utf8"));
  const watchdogReport = () => existsSync(join(directory, "watchdog.json")) ? JSON.parse(readFileSync(join(directory, "watchdog.json"), "utf8")) : null;
  const absent = () => {
    if (!existsSync(join(directory, "fixture-manifest.json"))) return false;
    const m = manifest();
    if (m.assignmentHash !== assignmentHash || m.nonce !== nonce || m.parentPid !== process.pid || m.group !== m.providerPid) throw Error("Diagnostic fixture ownership conflict");
    for (const pid of [-m.group, m.providerPid, m.descendantPid].filter(Boolean)) {
      try { process.kill(pid, 0); return false; } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ESRCH") throw cause; }
    }
    return true;
  };
  return {
    assignment, assignmentHash, directory, sourceTrace: () => sourceTrace,
    failNextInputRead: () => { artifactRead.faultFile = join(directory, "input.json"); },
    run: () => {
      if (result) throw Error("Diagnostic fixture already started");
      spawnObservation.observe = child => {
        child.stdout?.on("data", bytes => { sourceTrace += bytes.toString("utf8"); });
      };
      try { result = runProviderSession(assignment, assignmentHash); }
      finally { spawnObservation.observe = undefined; }
      if (mode === "cancel-before-input" || mode === "cancel-active") polling = setInterval(() => {
        const observed = join(directory, mode === "cancel-before-input" ? "prepared.json" : "original-turn-acknowledged");
        const cancel = join(directory, "cancel.json");
        if (existsSync(observed) && !existsSync(cancel)) writeFileSync(cancel, JSON.stringify({ binding: assignment.binding, requestId: nonce, deadline: Date.now()+5000 }));
      }, 10);
      void result.then(value => { report = value; }, cause => { rejected = cause; });
      return result;
    },
    finish: async () => {
      let failure: unknown;
      if (polling) clearInterval(polling);
      if (artifactRead.faultFile === join(directory, "input.json")) artifactRead.faultFile = "";
      try {
        const clean = !!report && absent();
        if (watchdog.connected) watchdog.send({ type: clean ? "disarm" : "cleanup", nonce });
        await waitFor(() => watchdogClosed, 2500);
        if (result) await result;
        if (!absent() || watchdogCode !== 0 || watchdogReport()?.settled !== true || watchdogReport()?.fired !== false)
          throw Error("Diagnostic fixture settlement failed: "+watchdogDiagnostic+JSON.stringify(watchdogReport())+"; setup: "+String(rejected));
      } catch (cause) { failure = cause; }
      finally {
        recordCleanupArtifact(nonce+".json", { kind: "real", mode, protocol, directory, assignmentHash, nonce, parentPid: process.pid,
          watchdogPid: watchdog.pid, watchdogClosed, watchdogCode, watchdog: watchdogReport(),
          manifest: existsSync(join(directory, "fixture-manifest.json")) ? manifest() : null,
          report: report ? { status: report.status, error: report.error, calls: report.calls, diagnostic: report.diagnostic, cancellation: report.cancellation, process: report.process } : null,
          rejected: rejected ? "rejected" : null, failure: failure ? "settlement failed" : null });
        sourceTrace = "";
        if (!failure) rmSync(root, { recursive: true });
      }
      if (failure) throw failure;
    },
  };
}

/** No real PID is signalled: exact synthetic identity, real parser and session. */
export async function syntheticDiagnosticSession(options: { stderr?: Buffer[]; firstFailure?: boolean; writeFailure?: boolean; closeSignal?: string; validResult?: boolean }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "council-diagnostic-synthetic-")));
  const assignment = fixtureAssignment(root, 5000), { directory } = assignment;
  assignment.phase = "review";
  assignment.recipe.argv = ["--agent", "council-packet"];
  const assignmentHash = sha256(JSON.stringify(assignment));
  if (options.writeFailure || options.validResult) writeFileSync(join(directory, "input.json"), JSON.stringify({ assignmentHash, requestId: "synthetic-request" }));
  const child = new EventEmitter() as childProcess.ChildProcess;
  const syntheticPid = 2147483000;
  Object.assign(child, { pid: syntheticPid, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), unref() {} });
  const streams = [child.stdin!, child.stdout!, child.stderr!];
  const streamsClosed = Promise.all(streams.map(stream => new Promise<void>(resolve => { stream.once("close", resolve); })));
  let live = true, stdoutBytes = 0, stdoutChunks = 0;
  const emit = (value: unknown) => {
    const bytes = Buffer.from(JSON.stringify(value)+"\n");
    stdoutBytes += bytes.length; stdoutChunks++; child.stdout!.emit("data", bytes);
  };
  const close = () => {
    if (!live) return;
    live = false;
    child.stdin!.end(); child.stdout!.destroy(); child.stderr!.destroy();
    child.emit("close", options.validResult ? 0 : 7, options.closeSignal ?? null);
  };
  let resultTurn: ReturnType<typeof setImmediate> | undefined;
  child.stdin!.write = ((text: string, _encoding: string, callback: (error?: Error | null) => void) => {
    if (!options.validResult) throw Error(diagnosticCanaries.exception);
    const user = JSON.parse(text);
    const request = JSON.parse(user.message.content.slice(user.message.content.indexOf("\n")+1));
    callback();
    resultTurn = setImmediate(() => {
      const envelope = { binding: request.binding, selection: request.selection, phase: request.phase, role: request.role,
        packetHash: request.packetHash, payload: { assessment: diagnosticCanaries.requestedResult, objections: [] } };
      emit({ event: "result", result: { status: "SUCCESS", conversation_id: "synthetic-session", response: JSON.stringify(envelope) } });
      close();
    });
    return true;
  }) as NonNullable<typeof child.stdin>["write"];
  const originalKill = process.kill.bind(process);
  const kill = vi.spyOn(process, "kill").mockImplementation((pid, signal = "SIGTERM") => {
    if (Math.abs(pid) !== syntheticPid) return originalKill(pid, signal);
    if (!live) throw Object.assign(Error("synthetic absence"), { code: "ESRCH" });
    if (signal !== 0) queueMicrotask(close);
    return true;
  });
  let polling: ReturnType<typeof setInterval> | undefined;
  let stderrTurn: ReturnType<typeof setImmediate> | undefined;
  const initTimer = setTimeout(() => emit({ event: "init", init: { model: assignment.selection.model, cwd: assignment.recipe.cwd,
    tools: [], permission_mode: "request-review", agent: "council-packet" } }), 5);
  spawnObservation.replacement = () => child;
  let session: ReturnType<typeof runProviderSession>;
  try { session = runProviderSession(assignment, assignmentHash); }
  finally { spawnObservation.replacement = undefined; }
  if (!options.writeFailure && !options.validResult) polling = setInterval(() => {
    if (!existsSync(join(directory, "prepared.json"))) return;
    clearInterval(polling); polling = undefined;
    if (options.firstFailure) {
      emit({ event: "unrecognized" });
      stderrTurn = setImmediate(() => { for (const bytes of options.stderr ?? []) child.stderr!.emit("data", bytes); });
    } else for (const bytes of options.stderr ?? []) child.stderr!.emit("data", bytes);
  }, 5);
  let observed: Awaited<ReturnType<typeof runProviderSession>> | undefined;
  try {
    const report = await session;
    observed = report;
    return { report, stdoutBytes, stdoutChunks, inferenceExists: existsSync(join(directory, "inference-started.json")),
      prepared: JSON.parse(readFileSync(join(directory, "prepared.json"), "utf8")) };
  } finally {
    if (polling) clearInterval(polling);
    if (stderrTurn) clearImmediate(stderrTurn);
    if (resultTurn) clearImmediate(resultTurn);
    clearTimeout(initTimer); close(); kill.mockRestore();
    child.stdin!.destroy(); child.stdout!.destroy(); child.stderr!.destroy();
    await streamsClosed;
    recordCleanupArtifact("synthetic-"+randomUUID()+".json", { kind: "synthetic", authority: "deterministic child stand-in; no actual process identity or close evidence",
      options: { firstFailure: options.firstFailure === true, writeFailure: options.writeFailure === true, validResult: options.validResult === true,
        unlistedCloseSignalSupplied: options.closeSignal !== undefined, stderrChunkLengths: options.stderr?.map(bytes => bytes.length) ?? [] },
      originalReport: observed ? { status: observed.status, error: observed.error, calls: observed.calls, diagnostic: observed.diagnostic, process: observed.process } : null,
      teardown: { streamsDestroyed: child.stdin!.destroyed && child.stdout!.destroyed && child.stderr!.destroyed, streamsClosed: true, timerCleared: true, killMockRestored: true } });
    rmSync(root, { recursive: true });
  }
}
