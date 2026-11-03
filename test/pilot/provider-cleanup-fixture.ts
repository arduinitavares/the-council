import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { vi } from "vitest";
import { runProviderSession } from "../../src/pilot/provider-session.js";
import { sha256, type WrapperAssignment } from "../../src/pilot/wrapper-contract.js";
import { incidentRoster } from "./fixtures.js";

export type CleanupMode = "resistant-post-ready-error" | "resistant-ready" | "resistant-sequence" | "close-before-input";
export type SessionReport = Awaited<ReturnType<typeof runProviderSession>>;
const artifacts = resolve(".superpowers/sdd/2026-11-01-council-preinput-cleanup/task-1-resumed-20261103/fixtures");
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function fixtureAssignment(root: string, lifetimeMs: number): WrapperAssignment {
  const workspace = join(root, "project"), directory = join(root, "session");
  mkdirSync(workspace); mkdirSync(directory);
  const packetRoot = join(workspace, ".council/native-packets");
  const agentPath = join(packetRoot, ".agents/agents/council-packet/agent.md");
  const agent = "---\nname: council-packet\ntools: []\nmainAgent: true\n---\nFixture reader\n";
  return {
    version: 1, runtimeId: "synthetic-runtime", workspace, workspaceId: "synthetic-workspace", directory,
    identity: { handle: "fixture", worktreeId: "synthetic-workspace", ptyId: "fixture-pty", incarnationId: "fixture-incarnation", paneKey: "fixture:pane" },
    binding: { runId: "fixture-run", taskId: "fixture-task", dispatchId: "fixture-dispatch", handle: "fixture", attemptKey: "fixture-attempt" },
    dispatchIncarnation: "fixture-incarnation", producerHash: "fixture-producer", phase: "normal-probe", role: "gemini", selection: incidentRoster.reviewers.gemini,
    packetHash: sha256("immutable fixture"), packet: "immutable fixture", controlsHash: "fixture-controls", policyHash: "fixture-policy", deadline: Date.now()+lifetimeMs, orca: "unused-fixture-orca",
    recipe: { protocol: "agy-stream", executable: process.execPath, argv: [], cwd: packetRoot, version: "synthetic", selection: incidentRoster.reviewers.gemini,
      expectedPermission: "request-review", sources: [],
      facts: [{ name: "effective-input-gate", stage: "effective", observation: { state: "unknown", source: "fixture init", detail: "not qualification" }, enforcement: "real wrapper checks", observedAt: Date.now(), digest: "fixture" }],
      agent: "council-packet", agentDefinition: { path: agentPath, sha256: sha256(agent) }, materializations: [{ path: agentPath, content: agent, sha256: sha256(agent) }] },
  };
}

export async function cleanupFixture(mode: CleanupMode, lifetimeMs: number) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "council-cleanup-")));
  const epoch = Date.now(); let clock = epoch;
  const assignment = fixtureAssignment(root, lifetimeMs), { directory } = assignment;
  const traceFile = join(directory, "trace.txt"); writeFileSync(traceFile, "");
  assignment.recipe.argv = [resolve("test/pilot/fixtures/agy-startup-provider.cjs"), mode, directory, traceFile, "--agent", "council-packet"];
  const assignmentHash = sha256(JSON.stringify(assignment)), nonce = randomUUID();
  writeFileSync(join(directory, "fixture-owner.json"), JSON.stringify({ assignmentHash, nonce, parentPid: process.pid }));
  const watchdog = spawn(process.execPath, [resolve("test/pilot/fixtures/provider-watchdog.cjs"), directory, assignmentHash, nonce, String(process.pid)],
    { detached: true, stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let watchdogClosed = false, watchdogCode: number | null = null, watchdogDiagnostic = "";
  watchdog.stderr!.on("data", bytes => { watchdogDiagnostic += bytes.toString(); });
  watchdog.once("close", code => { watchdogClosed = true; watchdogCode = code; });
  const waitFor = async (check: () => boolean, realBudgetMs: number) => {
    const until = performance.now()+realBudgetMs;
    while (!check() && performance.now() < until) await pause(10);
    if (!check()) throw Error("Fixture observation did not arrive within "+realBudgetMs+" real ms");
  };
  let armed = false;
  watchdog.on("message", message => { if ((message as any)?.type === "armed" && (message as any).nonce === nonce) armed = true; });
  try { await waitFor(() => armed, 2000); }
  catch (cause) { if (watchdog.connected) watchdog.send({ type: "cleanup", nonce }); await waitFor(() => watchdogClosed, 2000); throw cause; }
  const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => clock);
  const originalKill = process.kill.bind(process);
  const signals: { pid: number; signal: NodeJS.Signals | 0; at: number }[] = [];
  const killSpy = vi.spyOn(process, "kill").mockImplementation((pid, signal = "SIGTERM") => {
    signals.push({ pid, signal: signal as NodeJS.Signals | 0, at: clock }); return originalKill(pid, signal);
  });
  let report: SessionReport | undefined, rejected: unknown;
  const result = runProviderSession(assignment, assignmentHash);
  void result.then(value => { report = value; }, cause => { rejected = cause; });
  const manifest = () => JSON.parse(readFileSync(join(directory, "fixture-manifest.json"), "utf8"));
  const absent = () => {
    if (!existsSync(join(directory, "fixture-manifest.json"))) return false;
    const m = manifest();
    for (const pid of [-m.group, m.providerPid, m.descendantPid].filter(Boolean)) {
      try { originalKill(pid, 0); return false; } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ESRCH") throw cause; }
    }
    return true;
  };
  const watchdogReport = () => existsSync(join(directory, "watchdog.json")) ? JSON.parse(readFileSync(join(directory, "watchdog.json"), "utf8")) : null;
  const h = {
    assignment, assignmentHash, directory, epoch, result, signals,
    clock: (at: number) => { clock = at; }, waitFor, tick: () => pause(80),
    trace: () => readFileSync(traceFile, "utf8"),
    input: () => writeFileSync(join(directory, "input.json"), JSON.stringify({ assignmentHash, requestId: "fixture-request" })),
    cancel: (deadline: number) => writeFileSync(join(directory, "cancel.json"), JSON.stringify({ binding: assignment.binding, deadline })),
    command: (name: "error" | "stderr" | "overflow" | "invalid-utf8") => writeFileSync(join(directory, "command-"+name), "go"),
    watchdogFired: () => watchdogReport()?.fired === true,
    finish: async () => {
      let failure: unknown;
      try {
        const clean = !!report && absent() && !h.watchdogFired();
        if (watchdog.connected) watchdog.send({ type: clean ? "disarm" : "cleanup", nonce });
        if (!clean) clock = assignment.deadline+60000;
        await waitFor(() => watchdogClosed, 2500);
        await waitFor(() => !!report || !!rejected, 1000);
        if (!absent()) throw Error("Fixture provider/descendant settlement unverified");
        if (watchdogCode !== 0 || watchdogReport()?.settled !== true) throw Error("Fixture watchdog settlement failed: "+watchdogDiagnostic+JSON.stringify(watchdogReport()));
        if (clean && watchdogReport()?.fired !== false) throw Error("Fixture watchdog intervened during successful teardown");
      } catch (cause) { failure = cause; }
      finally {
        nowSpy.mockRestore(); killSpy.mockRestore();
        mkdirSync(artifacts, { recursive: true });
        writeFileSync(join(artifacts, nonce+".json"), JSON.stringify({ mode, lifetimeMs, assignmentHash, nonce, parentPid: process.pid,
          watchdogPid: watchdog.pid, watchdogClosed, watchdogCode, watchdog: watchdogReport(), manifest: existsSync(join(directory, "fixture-manifest.json")) ? manifest() : null,
          trace: h.trace(), signals, report: report ? { status: report.status, error: report.error, calls: report.calls, cancellation: report.cancellation, process: report.process } : null,
          rejected: String(rejected ?? ""), failure: String(failure ?? "") }, null, 2));
        if (!failure) rmSync(root, { recursive: true });
      }
      if (failure) throw failure;
    },
  };
  return h;
}
