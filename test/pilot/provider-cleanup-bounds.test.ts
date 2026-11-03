import { expect, it, vi } from "vitest";
import * as childProcesses from "node:child_process";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { PassThrough, Writable } from "node:stream";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProviderSession } from "../../src/pilot/provider-session.js";
import { sha256 } from "../../src/pilot/wrapper-contract.js";
import { fixtureAssignment, recordCleanupArtifact } from "./provider-cleanup-fixture.js";
import * as cleanup from "../../src/pilot/provider-cleanup.js";
import { cleanupFixture } from "./provider-cleanup-fixture.js";

vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { promisify } = await import("node:util");
  const execFile = vi.fn(actual.execFile);
  Object.defineProperty(execFile, promisify.custom, { value: (...args: any[]) => new Promise((resolve, reject) => {
    (execFile as any)(...args, (error: Error | null, stdout: string, stderr: string) => error ? reject(error) : resolve({ stdout, stderr }));
  }) });
  return { ...actual, spawn: vi.fn(actual.spawn), execFile };
});
vi.mock("../../src/pilot/provider-cleanup.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../../src/pilot/provider-cleanup.js")>();
  return { ...actual, waitForProviderWork: vi.fn(actual.waitForProviderWork) };
});

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function observed(check: () => boolean, budget = 500) {
  const until = performance.now()+budget;
  while (!check() && performance.now() < until) await pause(5);
  return check();
}

// The ps callback and close are independently controlled; neither a stop request nor
// a fulfilled callback substitutes for close evidence.
async function heldScanSession(options: { rows?: (pid: number) => string; unknownGroup?: boolean; holdReadiness?: boolean } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "council-cleanup-bound-")));
  const epoch = Date.now(); let clock = epoch;
  const assignment = fixtureAssignment(root, 60_000), pid = 2_000_000_002;
  assignment.recipe.argv = ["--agent", "council-packet"];
  const assignmentHash = sha256(JSON.stringify(assignment));
  let closed = false, inputWrites = 0;
  const signals: { pid: number; signal: NodeJS.Signals | 0; at: number }[] = [];
  const scans: { child: EventEmitter & { kill: ReturnType<typeof vi.fn> }; options: any; finish: (error?: Error | null) => void; close: () => void;
    facts: () => { resultDelivered: boolean; closeObserved: boolean } }[] = [];
  const child = Object.assign(new EventEmitter(), { pid, stdout: new PassThrough(), stderr: new PassThrough(),
    stdin: new Writable({ write(_bytes, _encoding, callback) { inputWrites++; callback(); } }), unref() {} });
  const emit = (event: unknown) => child.stdout.emit("data", Buffer.from(JSON.stringify(event)+"\n"));
  const realSpawn = vi.mocked(childProcesses.spawn).getMockImplementation()!;
  const realExec = vi.mocked(childProcesses.execFile).getMockImplementation()!;
  vi.mocked(childProcesses.spawn).mockImplementation((..._args: any[]) => {
    setImmediate(() => emit({ event: "init", init: { model: assignment.selection.model, cwd: assignment.recipe.cwd,
      tools: [], permission_mode: "request-review", agent: "council-packet" } }));
    return child as unknown as childProcesses.ChildProcess;
  });
  vi.mocked(childProcesses.execFile).mockImplementation(((...args: any[]) => {
    if (args[0] !== "ps") return (realExec as any)(...args);
    const callback = args.at(-1);
    const scanChild = Object.assign(new EventEmitter(), { kill: vi.fn(() => true) });
    let finished = false, scanClosed = false;
    const scan = { child: scanChild, options: args[2],
      finish(error: Error | null = null) { if (!finished) { finished = true; callback(error, options.rows?.(pid) ?? (closed ? "" : `${pid} ${process.pid} ${pid}\n`), ""); } },
      close() { if (!scanClosed) { scanClosed = true; scanChild.emit("close", 0, null); } },
      facts: () => ({ resultDelivered: finished, closeObserved: scanClosed }) };
    scans.push(scan);
    if (scans.length === 1 && !options.holdReadiness) setImmediate(() => { scan.finish(); scan.close(); });
    return scanChild;
  }) as unknown as typeof childProcesses.execFile);
  const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => clock);
  const originalKill = process.kill.bind(process);
  const closeProvider = () => { if (!closed) { closed = true; child.emit("close", null, "SIGKILL"); } };
  const killSpy = vi.spyOn(process, "kill").mockImplementation((target, signal = "SIGTERM") => {
    if (target !== -pid && target !== pid) return originalKill(target, signal);
    signals.push({ pid: target, signal: signal as NodeJS.Signals | 0, at: clock });
    if (signal === 0 && options.unknownGroup) throw Object.assign(Error("synthetic unknown group"), { code: "EPERM" });
    if (closed) throw Object.assign(Error("synthetic exited group"), { code: "ESRCH" });
    if (signal === "SIGKILL") setImmediate(closeProvider);
    return true;
  });
  let report: Awaited<ReturnType<typeof runProviderSession>> | undefined, reportAt: number | undefined;
  const result = runProviderSession(assignment, assignmentHash);
  void result.then(value => { report = value; reportAt = clock; }, () => {});
  return { epoch, assignment, result, scans, signals, emit, pid, clock: (at: number) => { clock = at; },
    report: () => report, inputWrites: () => inputWrites, closeProvider,
    async finish() {
      closeProvider(); clock = epoch+100_000;
      for (const scan of scans) { scan.finish(); scan.close(); }
      try { await result; }
      finally {
        recordCleanupArtifact("bounded-"+randomUUID()+".json", { fixture: "offline provider and ps stand-ins", epoch, reportAt,
          providerPid: pid, providerClosedAfterTeardown: closed, inputWrites, signals,
          scans: scans.map(scan => ({ options: scan.options, ...scan.facts(), stops: scan.child.kill.mock.calls })),
          report: report ? { error: report.error, calls: report.calls, cancellation: report.cancellation, process: report.process } : null });
        child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); nowSpy.mockRestore(); killSpy.mockRestore();
        vi.mocked(childProcesses.spawn).mockImplementation(realSpawn);
        vi.mocked(childProcesses.execFile).mockImplementation(realExec);
        rmSync(root, { recursive: true });
      }
    } };
}

it("returns a report at the cleanup deadline while a producer scan is held", async () => {
  const h = await heldScanSession();
  try {
    expect(await observed(() => existsSync(join(h.assignment.directory, "prepared.json")))).toBe(true);
    h.emit({ event: "unsupported" });
    expect(await observed(() => h.scans.length === 2)).toBe(true);
    h.clock(h.epoch+30_000);
    // Independent real assertion sentinel: it never settles ps or alters the product bound.
    const reportObservedAtDeadline = await observed(() => !!h.report(), 500);
    expect(reportObservedAtDeadline, "report missing at cleanup deadline while ps remains pending").toBe(true);
    expect(h.report()!.error).toBe("PROVIDER_STREAM_EVENT_UNSUPPORTED");
    expect(h.report()!.calls).toBe(0);
  } finally { await h.finish(); }
}, 10_000);

it.each(["parsing", "scan"] as const)("bounds pending %s work", async kind => {
  const epoch = Date.now(); let clock = epoch;
  const spy = vi.spyOn(Date, "now").mockImplementation(() => clock);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let settle!: () => void;
  const work = new Promise<void>(resolve => { settle = resolve; });
  try {
    const p = cleanup.waitForProviderWork(kind, work, () => epoch+30_000, () => {}, timers);
    let returned = false; void p.then(() => { returned = true; });
    clock = epoch+29_999; await pause(80);
    expect(returned).toBe(false);
    clock = epoch+30_000;
    expect(await p).toEqual({ state: "deadline" });
    expect(timers.size).toBe(0);
    expect(Date.now()-epoch).toBe(30_000);
  } finally { settle(); spy.mockRestore(); }
}, 10_000);

it("reduces a pending wait to an earlier cancellation bound", async () => {
  const epoch = Date.now(); let clock = epoch, until = epoch+30_000, cancel = false;
  const spy = vi.spyOn(Date, "now").mockImplementation(() => clock);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let settle!: () => void;
  try {
    const p = cleanup.waitForProviderWork("scan", new Promise<void>(resolve => { settle = resolve; }),
      () => until, () => { if (cancel) until = epoch+750; }, timers);
    cancel = true; clock = epoch+750;
    expect(await p).toEqual({ state: "deadline" });
    expect(Date.now()-epoch).toBe(750);
    expect(timers.size).toBe(0);
  } finally { settle?.(); spy.mockRestore(); }
}, 10_000);

it("observes fulfilled and rejected work without losing a late rejection", async () => {
  const epoch = Date.now(); let clock = epoch;
  const spy = vi.spyOn(Date, "now").mockImplementation(() => clock);
  const timers = new Set<ReturnType<typeof setTimeout>>(), unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
  process.on("unhandledRejection", onUnhandled);
  let reject!: (reason: unknown) => void;
  try {
    expect(await cleanup.waitForProviderWork("parsing", Promise.resolve("value"), () => epoch+1000, () => {}, timers))
      .toEqual({ state: "settled", value: "value" });
    const reason = Error("synthetic parser fault");
    expect(await cleanup.waitForProviderWork("parsing", Promise.reject(reason), () => epoch+1000, () => {}, timers))
      .toEqual({ state: "rejected", reason });
    const p = cleanup.waitForProviderWork("scan", new Promise<never>((_resolve, fail) => { reject = fail; }), () => epoch+750, () => {}, timers);
    clock = epoch+750; expect(await p).toEqual({ state: "deadline" });
    reject(Error("late owned failure")); await pause(30);
    expect(unhandled).toEqual([]); expect(timers.size).toBe(0);
  } finally { reject?.(Error("fixture settled")); process.off("unhandledRejection", onUnhandled); spy.mockRestore(); }
}, 10_000);

function scanBoundary() {
  const realExec = vi.mocked(childProcesses.execFile).getMockImplementation()!;
  const child = Object.assign(new EventEmitter(), { kill: vi.fn(() => true) });
  let callback: ((error: Error | null, stdout: string, stderr: string) => void) | undefined, finished = false;
  vi.mocked(childProcesses.execFile).mockImplementation(((...args: any[]) => {
    callback = args.at(-1); return child;
  }) as unknown as typeof childProcesses.execFile);
  const finish = (error: Error | null = null) => { if (callback && !finished) { finished = true; callback(error, "fixture rows", ""); } };
  return { child, finish,
    restore() { finish(); child.emit("close", 0, null); vi.mocked(childProcesses.execFile).mockImplementation(realExec); } };
}

it.each(["callback-first", "close-first"])("requires scan result and close separately (%s)", async order => {
  const b = scanBoundary();
  try {
    const scan = cleanup.startProviderProcessScan(Date.now()+750);
    expect(scan.settled()).toBe(false);
    const [, args, options] = vi.mocked(childProcesses.execFile).mock.calls.at(-1)!;
    expect(args).toEqual(["-axo", "pid=,ppid=,pgid="]);
    expect(options).toMatchObject({ maxBuffer: 1_048_576, killSignal: "SIGKILL" });
    expect((options as any).timeout).toBeLessThanOrEqual(750);
    expect((options as any).timeout).toBeGreaterThan(0);
    if (order === "callback-first") { b.finish(); expect(await scan.result).toBe("fixture rows"); }
    else b.child.emit("close", 0, null);
    expect(scan.settled()).toBe(false);
    if (order === "callback-first") b.child.emit("close", 0, null); else b.finish();
    expect(await scan.result).toBe("fixture rows"); expect(scan.settled()).toBe(true);
    expect(b.child.listenerCount("close")).toBe(0); expect(b.child.listenerCount("error")).toBe(0);
  } finally { b.restore(); }
}, 10_000);

it("stops only the owned scan once without claiming close and handles late failure", async () => {
  const b = scanBoundary(), unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
  process.on("unhandledRejection", onUnhandled);
  try {
    const scan = cleanup.startProviderProcessScan(Date.now()+30_000);
    expect((vi.mocked(childProcesses.execFile).mock.calls.at(-1)![2] as any).timeout).toBe(2000);
    scan.stop(); scan.stop();
    expect(b.child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL"); expect(scan.settled()).toBe(false);
    b.child.emit("error", Error("synthetic scan error"));
    b.finish(Error("late ps failure")); await pause(30);
    expect(scan.settled()).toBe(false); expect(unhandled).toEqual([]);
    b.child.emit("close", 1, null);
    await expect(scan.result).rejects.toThrow("late ps failure"); expect(scan.settled()).toBe(true);
  } finally { process.off("unhandledRejection", onUnhandled); b.restore(); }
}, 10_000);

it("does not spawn a scan after its deadline", async () => {
  const b = scanBoundary();
  try {
    const calls = vi.mocked(childProcesses.execFile).mock.calls.length;
    const scan = cleanup.startProviderProcessScan(Date.now()-1);
    await expect(scan.result).rejects.toThrow();
    expect(vi.mocked(childProcesses.execFile).mock.calls).toHaveLength(calls);
    expect(scan.settled()).toBe(true);
    scan.stop(); expect(b.child.kill).not.toHaveBeenCalled();
  } finally { b.restore(); }
}, 10_000);

async function beginCleanup(h: Awaited<ReturnType<typeof heldScanSession>>) {
  expect(await observed(() => existsSync(join(h.assignment.directory, "prepared.json")))).toBe(true);
  h.emit({ event: "unsupported" });
  expect(await observed(() => h.scans.length === 2)).toBe(true);
}
function noDelivery(h: Awaited<ReturnType<typeof heldScanSession>>, r: Awaited<typeof h.result>) {
  expect(r).toMatchObject({ version: 1, error: "PROVIDER_STREAM_EVENT_UNSUPPORTED", calls: 0, cancellation: null,
    process: { inputDelivered: false, timersSettled: true } });
  expect(h.inputWrites()).toBe(0);
  expect(existsSync(join(h.assignment.directory, "inference-started.json"))).toBe(false);
  expect(existsSync(join(h.assignment.directory, "cancel-ack.json"))).toBe(false);
}

it("expires cleanup with a scan that never closes", async () => {
  const h = await heldScanSession();
  try {
    await beginCleanup(h);
    const scan = h.scans[1]!;
    expect(scan.options.timeout).toBeLessThanOrEqual(30_000);
    expect(scan.options.timeout).toBeLessThanOrEqual(2000);
    expect(scan.options).toMatchObject({ maxBuffer: 1_048_576, killSignal: "SIGKILL" });
    // A callback result cannot stand in for scan child closure.
    scan.finish(); await pause(40); expect(h.scans).toHaveLength(2);
    h.clock(h.epoch+30_000);
    expect(await observed(() => !!h.report())).toBe(true);
    const r = await h.result; noDelivery(h, r);
    expect(scan.child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
    expect(r.process).toMatchObject({ processScansSettled: false, trackedDescendantsSettled: false });
    expect(Date.now()-h.epoch).toBe(30_000);
  } finally { await h.finish(); }
}, 10_000);

it("retains the full cleanup allowance while owned work remains pending", async () => {
  const h = await heldScanSession();
  try {
    await beginCleanup(h); h.clock(h.epoch+29_999); await pause(80);
    expect(h.report()).toBeUndefined(); expect(h.scans).toHaveLength(2);
    h.clock(h.epoch+30_000); expect(await observed(() => !!h.report())).toBe(true);
    const r = await h.result; noDelivery(h, r);
    expect(r.process).toMatchObject({ processScansSettled: false, trackedDescendantsSettled: false });
    expect(Date.now()-h.epoch).toBe(30_000);
  } finally { await h.finish(); }
}, 10_000);

it("does not let a slow scan defer two-second escalation", async () => {
  const h = await heldScanSession();
  try {
    await beginCleanup(h); h.clock(h.epoch+1999); await pause(60);
    expect(h.signals.filter(s => s.signal === "SIGKILL")).toEqual([]);
    h.clock(h.epoch+2000);
    expect(await observed(() => h.signals.some(s => s.signal === "SIGKILL"))).toBe(true);
    h.clock(h.epoch+2001); await pause(30);
    expect(h.signals.filter(s => s.signal === "SIGKILL")).toHaveLength(1);
    expect(h.scans).toHaveLength(2); expect(h.report()).toBeUndefined();
    h.clock(h.epoch+30_000); expect(await observed(() => !!h.report())).toBe(true);
    noDelivery(h, await h.result);
  } finally { await h.finish(); }
}, 10_000);

it("keeps a late scan failure unknown without replacing the first error", async () => {
  const h = await heldScanSession();
  try {
    await beginCleanup(h); h.clock(h.epoch+2001);
    expect(await observed(() => h.signals.some(s => s.signal === "SIGKILL"))).toBe(true);
    h.scans[1]!.finish(Error("synthetic ps failure")); h.scans[1]!.close();
    expect(await observed(() => !!h.report())).toBe(true);
    const r = await h.result; noDelivery(h, r);
    expect(r.process).toMatchObject({ processScansSettled: true, trackedDescendantsSettled: false });
  } finally { await h.finish(); }
}, 10_000);

it("shortens cleanup when cancellation arrives after the error", async () => {
  const h = await cleanupFixture("resistant-post-ready-error", 60_000);
  try {
    await h.waitFor(() => h.trace().includes("startup-stop"), 2000);
    h.cancel(h.epoch+750);
    await h.waitFor(() => h.signals.some(s => s.signal === "SIGKILL"), 500);
    const r = await h.result;
    expect(r).toMatchObject({ error: "PROVIDER_STREAM_EVENT_UNSUPPORTED", calls: 0, cancellation: null });
    expect(existsSync(join(h.directory, "cancel-ack.json"))).toBe(false);
    expect(existsSync(join(h.directory, "inference-started.json"))).toBe(false);
    expect(h.trace()).not.toContain("user-input");
    expect(Date.now()-h.epoch).toBeLessThanOrEqual(750); expect(h.watchdogFired()).toBe(false);
  } finally { await h.finish(); }
}, 10_000);

it.each(["foreign", "malformed"])("rejects a %s cleanup bound without replacing the first error", async kind => {
  const h = await heldScanSession();
  try {
    await beginCleanup(h);
    writeFileSync(join(h.assignment.directory, "cancel.json"), JSON.stringify({
      binding: kind === "foreign" ? { ...h.assignment.binding, taskId: "foreign" } : h.assignment.binding,
      deadline: kind === "malformed" ? String(h.epoch+750) : h.epoch+750,
    }));
    h.clock(h.epoch+750); await pause(60); expect(h.report()).toBeUndefined();
    h.clock(h.epoch+30_000); expect(await observed(() => !!h.report())).toBe(true);
    noDelivery(h, await h.result); expect(Date.now()-h.epoch).toBe(30_000);
  } finally { await h.finish(); }
}, 10_000);

it("keeps pre-input cancellation unacknowledged", async () => {
  const h = await cleanupFixture("resistant-ready", 60_000);
  try {
    await h.waitFor(() => existsSync(join(h.directory, "prepared.json")), 2000);
    h.cancel(h.epoch+750);
    const r = await h.result;
    expect(r).toMatchObject({ error: "PROVIDER_INITIALIZATION_CANCELLED", calls: 0, cancellation: null,
      process: { closed: true, groupSettled: true, trackedDescendantsSettled: true, parsingSettled: true,
        processScansSettled: true, timersSettled: true, inputDelivered: false } });
    expect(existsSync(join(h.directory, "cancel-ack.json"))).toBe(false);
    expect(existsSync(join(h.directory, "inference-started.json"))).toBe(false);
    expect(h.trace()).not.toContain("user-input");
    expect(Date.now()-h.epoch).toBeLessThanOrEqual(750); expect(h.watchdogFired()).toBe(false);
  } finally { await h.finish(); }
}, 10_000);

it.each(["escaped", "live", "EPERM", "ESRCH"])("keeps escaped or unknown descendants unresolved (%s)", async mode => {
  const foreignPid = 2_000_000_003;
  const h = await heldScanSession({ rows: pid => `${pid} ${process.pid} ${pid}\n${foreignPid} ${pid} ${mode === "escaped" ? foreignPid : pid}\n`, unknownGroup: mode === "EPERM" });
  const priorKill = vi.mocked(process.kill).getMockImplementation()!;
  vi.mocked(process.kill).mockImplementation((pid, signal = "SIGTERM") => {
    if (pid !== foreignPid) return priorKill(pid, signal);
    if (signal !== 0) throw Error("must never signal a foreign process");
    if (mode === "ESRCH") throw Object.assign(Error("synthetic gone descendant"), { code: "ESRCH" });
    if (mode === "EPERM") throw Object.assign(Error("synthetic unknown descendant"), { code: "EPERM" });
    return true;
  });
  try {
    expect(await observed(() => h.signals.some(s => s.signal === "SIGTERM")) || await observed(() => existsSync(join(h.assignment.directory, "prepared.json")))).toBe(true);
    if (!h.signals.some(s => s.signal === "SIGTERM")) h.emit({ event: "unsupported" });
    expect(await observed(() => h.scans.length === 2)).toBe(true);
    h.clock(h.epoch+30_000); expect(await observed(() => !!h.report())).toBe(true);
    const r = await h.result;
    // The held scan leaves descendants unresolved even if a previous PID probe is ESRCH.
    expect(r.process.trackedDescendantsSettled).toBe(false);
    expect(r.process.escapedDescendantObserved).toBe(mode === "escaped");
    if (mode === "EPERM") expect(r.process.groupSettled).toBe(false);
    expect(h.signals.filter(s => s.signal !== 0).every(s => s.pid === -h.pid)).toBe(true);
    expect(h.signals.map(s => s.pid)).not.toContain(foreignPid);
    expect(Date.now()).toBeLessThanOrEqual(h.epoch+30_000);
  } finally { await h.finish(); }
}, 10_000);

it("does not extend an expired cancellation bound", async () => {
  const h = await heldScanSession();
  try {
    expect(await observed(() => existsSync(join(h.assignment.directory, "prepared.json")))).toBe(true);
    const initialScans = h.scans.length;
    writeFileSync(join(h.assignment.directory, "cancel.json"), JSON.stringify({ binding: h.assignment.binding, deadline: h.epoch-1 }));
    expect(await observed(() => !!h.report())).toBe(true);
    const r = await h.result;
    expect(r).toMatchObject({ error: "PROVIDER_INITIALIZATION_CANCELLED", calls: 0, cancellation: null,
      process: { closed: false, groupSettled: false, timersSettled: true } });
    expect(h.scans).toHaveLength(initialScans);
    expect(h.signals.filter(s => s.signal === "SIGTERM")).toHaveLength(1);
    expect(h.inputWrites()).toBe(0); expect(Date.now()).toBe(h.epoch);
  } finally { await h.finish(); }
}, 10_000);

// A terminal event during readiness must transfer the existing scan to cleanup.
it("retains a readiness scan when a terminal event interrupts pre-input polling", async () => {
  const h = await heldScanSession({ holdReadiness: true });
  try {
    expect(await observed(() => h.scans.length === 1)).toBe(true);
    h.emit({ event: "unsupported" });
    expect(await observed(() => h.signals.some(s => s.signal === "SIGTERM"))).toBe(true);
    await pause(40); expect(h.scans).toHaveLength(1);
    h.clock(h.epoch+2001);
    expect(await observed(() => h.signals.some(s => s.signal === "SIGKILL"))).toBe(true);
    h.clock(h.epoch+30_000); expect(await observed(() => !!h.report())).toBe(true);
    const r = await h.result; noDelivery(h, r);
    expect(h.scans).toHaveLength(1);
    expect(h.scans[0]!.child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
    expect(r.process.processScansSettled).toBe(false);
  } finally { await h.finish(); }
}, 10_000);

// With scan callback AND close observed, positive absence requires ESRCH;
// EPERM and a live PID must stay unresolved, including outside the owned group.
it.each([
  ["ESRCH", true], ["EPERM", false], ["live", false], ["escaped", false],
] as const)("uses actual descendant probe evidence after scan settlement (%s)", async (mode, wantSettled) => {
  const foreignPid = 2_000_000_003;
  const h = await heldScanSession({ rows: pid => `${pid} ${process.pid} ${pid}\n${foreignPid} ${pid} ${mode === "escaped" ? foreignPid : pid}\n`, unknownGroup: mode === "EPERM" });
  const priorKill = vi.mocked(process.kill).getMockImplementation()!;
  let descendantProbes = 0;
  vi.mocked(process.kill).mockImplementation((pid, signal = "SIGTERM") => {
    if (pid !== foreignPid) return priorKill(pid, signal);
    if (signal !== 0) throw Error("must never signal a foreign process");
    descendantProbes++;
    if (mode === "ESRCH" || mode === "EPERM") throw Object.assign(Error("synthetic descendant probe"), { code: mode });
    return true;
  });
  try {
    expect(await observed(() => h.scans.length === 2 || existsSync(join(h.assignment.directory, "prepared.json")))).toBe(true);
    if (existsSync(join(h.assignment.directory, "prepared.json"))) h.emit({ event: "unsupported" });
    expect(await observed(() => h.scans.length === 2)).toBe(true);
    h.clock(h.epoch+2001);
    expect(await observed(() => h.signals.some(s => s.signal === "SIGKILL"))).toBe(true);
    await pause(20);
    h.scans[1]!.finish(); h.scans[1]!.close();
    expect(await observed(() => !!h.report())).toBe(true);
    const r = await h.result;
    expect(descendantProbes).toBeGreaterThan(0);
    expect(r.process.processScansSettled).toBe(true);
    expect(r.process.trackedDescendantsSettled).toBe(wantSettled);
    expect(r.process.escapedDescendantObserved).toBe(mode === "escaped");
    if (mode === "EPERM") expect(r.process.groupSettled).toBe(false);
    expect(h.signals.filter(s => s.signal !== 0).every(s => s.pid === -h.pid)).toBe(true);
  } finally { await h.finish(); }
}, 10_000);

it.each(["resolve", "reject"])("does not claim parser settlement after the bounded parser wait expires (%s)", async settlement => {
  const realWait = vi.mocked(cleanup.waitForProviderWork).getMockImplementation()!;
  const h = await heldScanSession();
  let release!: () => void, reject!: (reason: unknown) => void, retained: Promise<void> | undefined;
  const unhandled: unknown[] = [], onUnhandled = (reason: unknown) => { unhandled.push(reason); };
  process.on("unhandledRejection", onUnhandled);
  vi.mocked(cleanup.waitForProviderWork).mockImplementation((kind, work, deadline, poll, timers) => {
    if (kind === "parsing" && h.signals.some(s => s.signal === "SIGTERM")) {
      if (!retained) {
        const held = new Promise<void>((resolve, fail) => { release = resolve; reject = fail; });
        retained = work.then(() => held);
        // The injected work remains linked to the real parser and late failures stay observed.
        void retained.catch(() => {});
      }
      poll(); return Promise.resolve({ state: "deadline" });
    }
    return realWait(kind, work, deadline, poll, timers);
  });
  try {
    await beginCleanup(h); h.clock(h.epoch+30_000);
    expect(await observed(() => !!h.report())).toBe(true);
    const r = await h.result; noDelivery(h, r);
    expect(retained).toBeDefined(); expect(r.process.parsingSettled).toBe(false);
    if (settlement === "resolve") release(); else reject(Error("late parser failure"));
    writeFileSync(join(h.assignment.directory, "input.json"), JSON.stringify({ assignmentHash: "late", requestId: "late" }));
    h.emit({ event: "result", result: { status: "SUCCESS", conversation_id: "late", response: "{}" } });
    h.emit({ event: "unsupported" }); await pause(40);
    expect(h.inputWrites()).toBe(0); expect(unhandled).toEqual([]);
    expect(existsSync(join(h.assignment.directory, "turn-final.json"))).toBe(false);
    expect(existsSync(join(h.assignment.directory, "inference-started.json"))).toBe(false);
  } finally {
    release?.(); vi.mocked(cleanup.waitForProviderWork).mockImplementation(realWait);
    process.off("unhandledRejection", onUnhandled); await h.finish();
  }
}, 10_000);
