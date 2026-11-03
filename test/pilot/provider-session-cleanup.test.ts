import { expect, it, vi } from "vitest";
import * as childProcesses from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { runProviderSession } from "../../src/pilot/provider-session.js";
import * as contract from "../../src/pilot/wrapper-contract.js";
import { codexKernel } from "../../src/pilot/codex-controls.js";
import { incidentRoster } from "./fixtures.js";
import { cleanupFixture, fixtureAssignment, recordCleanupArtifact } from "./provider-cleanup-fixture.js";

vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { promisify } = await import("node:util");
  const execFile = vi.fn(actual.execFile);
  Object.defineProperty(execFile, promisify.custom, { value: (...args: any[]) => new Promise((resolve, reject) => {
    (execFile as any)(...args, (error: Error | null, stdout: string, stderr: string) => error ? reject(error) : resolve({ stdout, stderr }));
  }) });
  return { ...actual, spawn: vi.fn(actual.spawn), execFile };
});
vi.mock("../../src/pilot/wrapper-contract.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../../src/pilot/wrapper-contract.js")>();
  return { ...actual, readStrictFile: vi.fn(actual.readStrictFile) };
});

type Fixture = Awaited<ReturnType<typeof cleanupFixture>>;
function noInput(h: Fixture, r: Awaited<Fixture["result"]>) {
  expect(r).toMatchObject({ status: "failed", calls: 0, cancellation: null, process: {
    inputDelivered: false, closed: true, groupSettled: true, trackedDescendantsSettled: true, timersSettled: true,
  } });
  expect(h.trace()).not.toContain("user-input");
  expect(existsSync(join(h.directory, "inference-started.json"))).toBe(false);
  expect(existsSync(join(h.directory, "cancel-ack.json"))).toBe(false);
  expect(h.watchdogFired()).toBe(false);
}
async function killed(h: Fixture) {
  // Failure is an explicit product assertion; the independent watchdog settles the fixture afterwards.
  await h.waitFor(() => h.signals.some(s => s.signal === "SIGKILL"), 1000).catch(() => {});
  try {
    expect(h.signals.filter(s => s.signal === "SIGKILL"), "owned cleanup must escalate before the open input deadline").toHaveLength(1);
  } catch (cause) {
    recordCleanupArtifact("behavioral-red-"+h.assignmentHash+".json", {
      at: new Date().toISOString(), clock: Date.now(), deadline: h.assignment.deadline, assignmentHash: h.assignmentHash,
      assertion: String(cause), signals: h.signals, inputExists: existsSync(join(h.directory, "input.json")),
      cancelExists: existsSync(join(h.directory, "cancel.json")), watchdogFiredBeforeTeardown: h.watchdogFired(),
    });
    throw cause;
  }
}

// Break caught: ignoring a terminal error while waiting for an input file prevents owned cleanup.
it.each([60_000, 120_000])("cleans a resistant no-input failure at %i", async lifetime => {
  const h = await cleanupFixture("resistant-post-ready-error", lifetime);
  try {
    await h.waitFor(() => h.trace().includes("startup-stop"), 2000);
    // TERM is requested by the parser; allow the input poll to enter cleanup at epoch.
    await h.tick();
    expect(existsSync(join(h.directory, "input.json"))).toBe(false);
    expect(existsSync(join(h.directory, "cancel.json"))).toBe(false);
    h.clock(h.epoch+1999); await h.tick();
    expect(h.signals.filter(s => s.signal === "SIGKILL")).toHaveLength(0);
    h.clock(h.epoch+2001); await killed(h);
    const r = await h.result;
    noInput(h, r);
    expect(r.error).toBe("PROVIDER_STREAM_EVENT_UNSUPPORTED");
    expect(h.signals.filter(s => s.signal === "SIGTERM")).toHaveLength(1);
    expect(h.signals.filter(s => s.signal !== 0).every(s => s.pid === -r.process.pid!)).toBe(true);
    expect(Date.now()).toBeLessThan(h.assignment.deadline);
    expect(Date.now()-h.epoch).toBeLessThanOrEqual(30_000);
  } finally { await h.finish(); }
}, 10_000);

// Break caught: missing input at expiry leaks an incidental filesystem error.
it("classifies absent input at its deadline", async () => {
  const h = await cleanupFixture("resistant-ready", 60_000);
  try {
    await h.waitFor(() => existsSync(join(h.directory, "prepared.json")), 2000);
    h.clock(h.assignment.deadline);
    await h.waitFor(() => h.trace().includes("startup-stop"), 1000);
    h.clock(h.assignment.deadline+2001); await killed(h);
    const r = await h.result; noInput(h, r);
    expect(r.error).toBe("PROVIDER_INPUT_DEADLINE");
  } finally { await h.finish(); }
}, 10_000);

// Break caught: child closure must be checked before attempting to open absent input.
it("classifies closure before input without opening a missing file", async () => {
  const h = await cleanupFixture("close-before-input", 60_000);
  try {
    const r = await h.result; noInput(h, r);
    expect(r.error).toBe("PROVIDER_INPUT_AUTHORITY_UNVERIFIED");
    expect(r.error).not.toContain("ENOENT");
    expect(vi.mocked(contract.readStrictFile).mock.calls.map(([file]) => file)).not.toContain(join(h.directory, "input.json"));
  } finally { await h.finish(); }
}, 10_000);

// Break caught: later stdout overflow/decoder errors replace the first terminal classification.
it.each([
  ["overflow", "invalid-utf8"], ["invalid-utf8", "overflow"],
] as const)("retains the first terminal error after later stream failures (%s then %s)", async (second, third) => {
  // Reach the input deadline while remaining inside an error-triggered cleanup window.
  const h = await cleanupFixture("resistant-sequence", 1000);
  try {
    await h.waitFor(() => existsSync(join(h.directory, "prepared.json")), 2000);
    h.command("error"); await h.waitFor(() => h.trace().includes("startup-stop"), 1000);
    for (const command of ["stderr", second, third] as const) {
      h.command(command); await h.waitFor(() => h.trace().includes("command-"+command), 1000); await h.tick();
    }
    // Advance through the old wait too, so the classification assertion is behavioral on baseline.
    h.clock(h.assignment.deadline); await h.tick();
    h.clock(h.assignment.deadline+2001); await killed(h);
    const r = await h.result; noInput(h, r);
    expect(r.error).toBe("PROVIDER_STREAM_EVENT_UNSUPPORTED");
  } finally { await h.finish(); }
}, 10_000);

// Break caught: expiry/file absence may not replace an already observed stderr error.
it("keeps an earlier stderr failure at the input deadline", async () => {
  const h = await cleanupFixture("resistant-sequence", 1000);
  try {
    await h.waitFor(() => existsSync(join(h.directory, "prepared.json")), 2000);
    h.command("stderr"); await h.waitFor(() => h.trace().includes("startup-stop"), 1000);
    h.clock(h.assignment.deadline); await h.tick();
    h.clock(h.assignment.deadline+2001); await killed(h);
    const r = await h.result; noInput(h, r);
    expect(r.error).toBe("PROVIDER_STDERR_UNCLASSIFIED"); expect(r.error).not.toContain("ENOENT");
  } finally { await h.finish(); }
}, 10_000);

// Break caught: a late file must not reopen a failed attempt or even be read for authority.
it("blocks late input after terminal failure", async () => {
  const h = await cleanupFixture("resistant-post-ready-error", 60_000);
  try {
    await h.waitFor(() => h.trace().includes("startup-stop"), 2000);
    h.input(); await h.tick(); h.clock(h.epoch+2001); await killed(h);
    const r = await h.result; noInput(h, r);
    expect(r.error).toBe("PROVIDER_STREAM_EVENT_UNSUPPORTED");
    expect(vi.mocked(contract.readStrictFile).mock.calls.map(([file]) => file)).not.toContain(join(h.directory, "input.json"));
  } finally { await h.finish(); }
}, 10_000);

// Break caught: observing cancellation must shorten cleanup without acknowledging an active turn.
it("honors a pre-input cancellation bound without reserving a call", async () => {
  const h = await cleanupFixture("resistant-ready", 60_000);
  try {
    await h.waitFor(() => existsSync(join(h.directory, "prepared.json")), 2000);
    h.cancel(h.epoch+1000);
    // A short cleanup bound allows KILL before the child's TERM handler can run.
    await h.waitFor(() => h.signals.some(s => s.signal === "SIGTERM"), 1000);
    await killed(h);
    const r = await h.result; noInput(h, r);
    expect(r.error).toBe("PROVIDER_INITIALIZATION_CANCELLED");
  } finally { await h.finish(); }
}, 10_000);

const { codexCliLayer } = createRequire(import.meta.url)("./fixtures/context-provider.cjs");

async function deterministicSession(protocol: "agy-stream" | "codex-app-server" | "cursor-stream", writeFailure = false, errorDuringWrite = false,
  inputFault?: "before-expiry" | "at-expiry" | "non-ENOENT") {
  let clock = Date.now();
  const nowSpy = inputFault ? vi.spyOn(Date, "now").mockImplementation(() => clock) : undefined;
  const root = realpathSync(mkdtempSync(join(tmpdir(), "council-ordered-input-")));
  const a = fixtureAssignment(root, 60_000);
  const selection = protocol === "codex-app-server" ? incidentRoster.reviewers.openai : protocol === "cursor-stream" ? incidentRoster.reviewers.xai : incidentRoster.reviewers.gemini;
  a.selection = selection; a.recipe.selection = selection; a.recipe.protocol = protocol;
  a.role = protocol === "codex-app-server" ? "openai" : protocol === "cursor-stream" ? "xai" : "gemini";
  if (protocol !== "agy-stream") { delete a.recipe.agent; delete a.recipe.agentDefinition; delete a.recipe.materializations; }
  a.recipe.facts = [{ name: "fixture-bootstrap", stage: "bootstrap", observation: { state: "verified", source: "offline protocol stand-in", detail: "not qualification" }, enforcement: "fixture", observedAt: Date.now(), digest: "fixture" }];
  a.recipe.argv = ["--agent", "council-packet"];
  const kernel = codexKernel([], a.recipe.cwd, selection.model, selection.effort);
  if (protocol === "codex-app-server") a.recipe.codexPolicy = kernel.policy;
  const assignmentHash = contract.sha256(JSON.stringify(a));
  const inputFile = join(a.directory, "input.json");
  writeFileSync(inputFile, JSON.stringify({ assignmentHash, requestId: "fixture-request" }));
  const requests: string[] = [], openedFiles: string[] = [];
  const pid = 2_000_000_001;
  let closed = false, inputWrites = 0, pendingScan: (() => void) | undefined;
  const child = Object.assign(new EventEmitter(), { pid, stdout: new PassThrough(), stderr: new PassThrough(), unref() {} });
  const emit = (events: unknown[]) => child.stdout.emit("data", Buffer.from(events.map(event => JSON.stringify(event)+"\n").join("")));
  const unsupported = protocol === "agy-stream" ? { event: "unexpected-startup-event" } : protocol === "cursor-stream" ? { type: "unexpected-startup-event" } : { method: "unexpected/startup" };
  const initialized = protocol === "agy-stream" ? { event: "init", init: { model: selection.model, cwd: a.recipe.cwd, tools: [], permission_mode: "request-review", agent: "council-packet" } } :
    { type: "system", subtype: "init", model: selection.model, cwd: a.recipe.cwd, tools: [], session_id: "synthetic-session" };
  const stdin = new Writable({ write(bytes, _encoding, callback) {
    const text = bytes.toString();
    const message = protocol === "codex-app-server" ? JSON.parse(text) : null;
    if (message?.method) requests.push(message.method);
    const input = protocol !== "codex-app-server" || message?.method === "turn/start";
    if (input) {
      inputWrites++;
      if (writeFailure) {
        setImmediate(() => { if (errorDuringWrite) emit([unsupported]); setImmediate(() => callback(Error("synthetic input write failed"))); });
        return;
      }
    }
    if (message?.id === 1) queueMicrotask(() => emit([{ id: 1, result: { userAgent: "synthetic" } }]));
    if (message?.id === 2) {
      const raw = codexCliLayer(kernel.argv);
      queueMicrotask(() => emit([{ id: 2, result: { config: raw, origins: {}, layers: [{ name: { type: "sessionFlags" }, version: "fixture-session", config: raw }] } }]));
    }
    if (message?.id === 5) queueMicrotask(() => emit([{ id: 5, result: { requirements: null } }]));
    if (message?.id === 6) queueMicrotask(() => emit([{ id: 6, result: { data: [{ id: "council_packet", allowed: true }] } }]));
    if (message?.id === 3) queueMicrotask(() => emit([{ id: 3, result: {
      thread: { id: "synthetic-session", cliVersion: "0.164.0", createdAt: 0, updatedAt: 0, cwd: a.recipe.cwd, ephemeral: true,
        modelProvider: "openai", preview: "", projectId: null, sessionId: "synthetic-session", source: "appServer", status: { type: "idle" }, turns: [] },
      modelProvider: "openai", model: selection.model, reasoningEffort: selection.effort,
      cwd: a.recipe.cwd, approvalPolicy: "never", activePermissionProfile: { id: "council_packet", extends: null }, instructionSources: [],
    } }, unsupported]));
    callback();
  } });
  const fakeChild = Object.assign(child, { stdin });
  const realSpawn = vi.mocked(childProcesses.spawn).getMockImplementation()!;
  const realExec = vi.mocked(childProcesses.execFile).getMockImplementation()!;
  const realRead = vi.mocked(contract.readStrictFile).getMockImplementation()!;
  vi.mocked(childProcesses.spawn).mockImplementation((..._args: any[]) => {
    if (protocol === "agy-stream") setImmediate(() => emit(writeFailure || inputFault ? [initialized] : [initialized, unsupported]));
    return fakeChild as unknown as childProcesses.ChildProcess;
  });
  vi.mocked(childProcesses.execFile).mockImplementation(((...args: any[]) => {
    const callback = args.at(-1);
    const scanChild = new EventEmitter();
    const respond = () => { callback(null, closed ? "" : `${pid} ${process.pid} ${pid}\n`, ""); scanChild.emit("close", 0, null); };
    if (protocol === "cursor-stream" && !pendingScan) {
      pendingScan = respond;
      // Real I/O turn; terminal bytes queue while the readiness process scan is outstanding.
      setImmediate(() => { emit([initialized, unsupported]); respond(); });
    } else setImmediate(respond);
    return scanChild;
  }) as typeof childProcesses.execFile);
  let inputFaultInjected = false;
  vi.mocked(contract.readStrictFile).mockImplementation((file, limit) => {
    openedFiles.push(file);
    if (file === inputFile && inputFault && !inputFaultInjected) {
      inputFaultInjected = true;
      if (inputFault === "at-expiry") clock = a.deadline;
      if (inputFault === "before-expiry") emit([unsupported]);
      throw Object.assign(Error(inputFault === "non-ENOENT" ? "SYNTHETIC_INPUT_READ_FAILURE" : "synthetic disappeared input"),
        { code: inputFault === "non-ENOENT" ? "EIO" : "ENOENT" });
    }
    return realRead(file, limit);
  });
  const originalKill = process.kill.bind(process);
  const killSpy = vi.spyOn(process, "kill").mockImplementation((target, signal = "SIGTERM") => {
    if (target !== -pid && target !== pid) return originalKill(target, signal);
    if (closed) throw Object.assign(Error("synthetic exited process"), { code: "ESRCH" });
    if (signal !== 0) setImmediate(() => { closed = true; child.emit("close", null, "SIGTERM"); });
    return true;
  });
  try {
    const result = await runProviderSession(a, assignmentHash);
    return { result, requests, openedFiles, inputFile, inputWrites, inferenceExists: existsSync(join(a.directory, "inference-started.json")) };
  } finally {
    stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); killSpy.mockRestore(); nowSpy?.mockRestore();
    vi.mocked(childProcesses.spawn).mockImplementation(realSpawn);
    vi.mocked(childProcesses.execFile).mockImplementation(realExec);
    vi.mocked(contract.readStrictFile).mockImplementation(realRead);
    rmSync(root, { recursive: true });
  }
}

// Break caught: a readiness observation must not bypass terminal data already queued before input.
it.each(["agy-stream", "codex-app-server", "cursor-stream"] as const)("drains queued terminal data before opening input (%s)", async protocol => {
  const h = await deterministicSession(protocol);
  expect(h.result).toMatchObject({ status: "failed", error: "PROVIDER_STREAM_EVENT_UNSUPPORTED", calls: 0, process: { inputDelivered: false } });
  expect(h.openedFiles).not.toContain(h.inputFile);
  expect(h.requests).not.toContain("turn/start");
  expect(h.inputWrites).toBe(0);
  expect(h.inferenceExists).toBe(false);
}, 10_000);

// A disappearing file must re-enter the terminal guard instead of granting input.
it.each([
  ["before-expiry", "PROVIDER_STREAM_EVENT_UNSUPPORTED"],
  ["at-expiry", "PROVIDER_INPUT_DEADLINE"],
  ["non-ENOENT", "SYNTHETIC_INPUT_READ_FAILURE"],
] as const)("guards a disappearing or failed input read (%s)", async (fault, error) => {
  const h = await deterministicSession("agy-stream", false, false, fault);
  expect(h.openedFiles.filter(file => file === h.inputFile)).toHaveLength(1);
  expect(h.result).toMatchObject({ status: "failed", error, calls: 0, cancellation: null,
    process: { inputDelivered: false, closed: true, groupSettled: true, timersSettled: true } });
  expect(h.inputWrites).toBe(0); expect(h.inferenceExists).toBe(false);
  expect(h.requests).not.toContain("turn/start");
}, 10_000);

// Break caught: a failed write callback may not refund an already attempted mutation or claim delivery.
it.each([false, true])("keeps the reservation when an attempted input write fails (earlier provider error: %s)", async errorDuringWrite => {
  const h = await deterministicSession("agy-stream", true, errorDuringWrite);
  expect(h.inputWrites).toBe(1);
  expect(h.result.calls).toBe(1);
  expect(h.result.process.inputDelivered).toBe(false);
  expect(h.result.error).toBe(errorDuringWrite ? "PROVIDER_STREAM_EVENT_UNSUPPORTED" : "PROVIDER_INPUT_CLOSED");
  expect(h.inferenceExists).toBe(false);
}, 10_000);
