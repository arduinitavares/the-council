import { existsSync, mkdirSync, readFileSync, realpathSync, lstatSync } from "node:fs";
import { join, dirname, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, hashArtifact } from "../domain/hash.js";
import { mutationRequestId } from "./mutation-id.js";
import { pilotPayloadSchemas, pilotResultEnvelopeSchema } from "./payload.js";
import { assignmentSchema, identitySchema, readStrictFile, sha256, writeExclusive, producerCodeHash, type ContextProof, type WrapperAssignment } from "./wrapper-contract.js";
import type { Command } from "./orca-driver.js";
import type { ScopedRpc } from "./rpc.js";
import type { Attempt, CancellationResult, NativeEvidence, Phase, PilotRequest, Result } from "./types.js";
import type { Role } from "./config.js";
import type { QualificationProof } from "./types.js";
import { decodeStrictJson } from "../workers/strict-json.js";

export interface ContextWrapperPort {
  configure?(evidence: NativeEvidence): void;
  launch(run: string, request: PilotRequest, role: Role, phase: Phase, packet: string, key: string): Promise<Attempt>;
  observe(attempt: Attempt, deadline: number): Promise<Result>;
  cancel(attempt: Attempt, deadline: number, mode?: "absolute-cleanup"): Promise<CancellationResult>;
  release(attempt: Attempt, deadline?: number): Promise<boolean>;
  proof(attempt: Attempt): ContextProof | null;
}
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const quote = (value: string) => "'"+value.replaceAll("'", "'\\''")+"'";
function secureDirectory(root: string, parts: readonly string[]): string {
  let current = realpathSync(root);
  for (const part of parts) {
    current = join(current, part);
    if (existsSync(current)) { if (lstatSync(current).isSymbolicLink() || realpathSync(current) !== current) throw Error("WRAPPER_DIRECTORY_UNVERIFIED"); }
    else mkdirSync(current, { mode: 0o700 });
  }
  return current;
}
export function wrapperIntent(assignment: Omit<WrapperAssignment, "binding" | "dispatchIncarnation"> | WrapperAssignment) {
  return { runtimeId: assignment.runtimeId, workspaceId: assignment.workspaceId, identity: assignment.identity,
    role: assignment.role, phase: assignment.phase, selection: assignment.selection, packetHash: assignment.packetHash,
    controlsHash: assignment.controlsHash, policyHash: assignment.policyHash, recipe: assignment.recipe,
    directory: assignment.directory, deadline: assignment.deadline, producerHash: assignment.producerHash };
}
export async function verifyContextResult(assignment: WrapperAssignment, command: Command) {
  const file = join(assignment.directory, "result.json");
  const bytes = readFileSync(file);
  const report = readStrictFile(file);
  if (report.version !== 1 || canonicalJson(report.binding) !== canonicalJson(assignment.binding) ||
      report.assignmentHash !== sha256(readFileSync(join(assignment.directory, "assignment.json"))) ||
      report.packetHash !== assignment.packetHash || report.controlsHash !== assignment.controlsHash ||
      report.process?.closed !== true || report.process?.groupSettled !== true || report.process?.trackedDescendantsSettled !== true ||
      report.process?.timersSettled !== true || !Number.isSafeInteger(report.wrapperPid)) throw Error("WRAPPER_RESULT_UNBOUND");
  const shown = await command(["orchestration", "dispatch-show", "--task", assignment.binding.taskId, "--json"], assignment.workspace, 5000);
  const d = shown.dispatch;
  if (d?.id !== assignment.binding.dispatchId || (d.taskId ?? d.task_id) !== assignment.binding.taskId ||
      (d.runId ?? d.run_id) !== assignment.binding.runId || (d.assigneeHandle ?? d.assignee_handle) !== assignment.identity.handle ||
      (d.assigneePaneKey ?? d.assignee_pane_key) !== assignment.identity.paneKey ||
      (d.processIncarnation ?? d.process_incarnation) !== assignment.dispatchIncarnation) throw Error("WRAPPER_NATIVE_AUTHORITY_UNBOUND");
  const listed = await command(["orchestration", "task-list", "--run", assignment.binding.runId, "--json"], assignment.workspace, 5000);
  const task = listed.tasks?.find((entry: any) => entry.id === assignment.binding.taskId);
  const native: any = typeof task?.result === "string" ? decodeStrictJson(task.result) : null;
  const resultHash = sha256(bytes);
  const expectedOutcome = report.status === "failed" ? "failed" : "succeeded";
  if (!task || task.spec !== `Council wrapper intent sha256=${sha256(canonicalJson(wrapperIntent(assignment)))}` ||
      native?.provenance !== "worker_report" || native.outcome !== expectedOutcome || typeof native.messageId !== "string" ||
      native.reportedBy !== assignment.identity.handle || typeof native.body !== "string" || !native.body.includes(`sha256=${resultHash}`) ||
      native.reportPath !== file || task.status !== (expectedOutcome === "succeeded" ? "completed" : "failed")) throw Error("WRAPPER_NATIVE_COMPLETION_UNVERIFIED");
  return { report, resultHash, completionMessageId: native.messageId as string };
}
export async function verifyContextProof(proof: QualificationProof, command: Command): Promise<boolean> {
  try {
    for (const [phase, outcome] of [["normal-probe", proof.normal], ["cancel-probe", proof.cancellation]] as const) {
      const context = outcome.context;
      if (!context) return false;
      const child = relative(join(proof.scope.workspace, ".council/native-host"), context.directory);
      if (!child || child.startsWith("..") || isAbsolute(child) || realpathSync(context.directory) !== context.directory) return false;
      const assignmentFile = join(context.directory, "assignment.json");
      if (sha256(readFileSync(assignmentFile)) !== context.assignmentHash) return false;
      const a = assignmentSchema.parse(readStrictFile(assignmentFile));
      if (a.producerHash !== producerCodeHash() || (proof.scope.producerCodeHash !== undefined && a.producerHash !== proof.scope.producerCodeHash)) return false;
      if (a.phase !== phase || a.binding.dispatchId !== outcome.dispatchId || a.runtimeId !== proof.scope.runtimeId || a.workspaceId !== proof.scope.workspaceId ||
          a.workspace !== proof.scope.workspace || a.controlsHash !== proof.scope.controlsHash || a.policyHash !== proof.scope.policyHash || canonicalJson(a.identity) !== canonicalJson(context.identity)) return false;
      const expected = canonicalJson({ instruction: phase === "normal-probe" ? "Reply with readiness only." : "Wait for cancellation.", qualificationFingerprint: proof.key });
      if (a.packet !== expected || !proof.scope.routes.some(r => r.role === a.role && canonicalJson(r.selection) === canonicalJson(a.selection))) return false;
      const verified = await verifyContextResult(a, command);
      if (verified.resultHash !== context.resultHash || verified.completionMessageId !== context.completionMessageId || verified.report.calls !== 1 ||
          verified.report.status !== (phase === "normal-probe" ? "completed" : "cancelled")) return false;
      if (phase === "normal-probe" && !pilotPayloadSchemas["normal-probe"].safeParse(verified.report.result?.payload).success) return false;
      if (phase === "cancel-probe") {
        const cancel = verified.report.cancellation;
        if (!cancel?.acknowledged || cancel.requestId !== proof.cancellation.stop?.requestId || canonicalJson(cancel.binding) !== canonicalJson(a.binding)) return false;
      }
      const cleanupFile = join(context.directory, "cleanup.json");
      if (sha256(readFileSync(cleanupFile)) !== context.cleanupHash) return false;
      const cleanup = readStrictFile(cleanupFile);
      if (cleanup.wrapperExit !== true || canonicalJson(cleanup.binding) !== canonicalJson(a.binding) || canonicalJson(cleanup.identity) !== canonicalJson(a.identity) ||
          cleanup.close?.handle !== a.identity.handle || cleanup.close?.ptyKilled !== true ||
          !validCleanupSettlement(cleanup, a.identity)) return false;
    }
    return true;
  } catch { return false; }
}
function validCleanupSettlement(cleanup: any, identity: WrapperAssignment["identity"]): boolean {
  if (cleanup.processState?.hasChildProcesses === false && cleanup.processState?.childProcessEvidence === "no-children" && cleanup.processState?.verdict === "exited") return true;
  const shown = cleanup.nativeTerminal;
  return cleanup.inspectFailure === "terminal_gone" && shown?.connected === false &&
    Object.entries(identity).every(([key, value]) => key === "paneKey"
      ? (shown.paneKey ?? `${shown.tabId}:${shown.leafId}`) === value : shown[key] === value);
}
/** Connected native Task/Dispatch lane. Process custody is explicitly external;
 * no WorkerResource, transcript archive or release receipt is invented. */
export class ContextWrapperTransport implements ContextWrapperPort {
  private evidence?: NativeEvidence;
  private readonly owned = new Map<string, { assignment: WrapperAssignment; assignmentHash: string; closeAttempted: boolean; proof: ContextProof | null }>();
  constructor(private readonly command: Command, private readonly rpc: (runtimeId: string) => ScopedRpc,
    private readonly orca: string, private readonly record: (event: unknown) => void, private readonly now = Date.now) {}
  configure(evidence: NativeEvidence) { this.evidence = evidence; }
  async launch(run: string, request: PilotRequest, role: Role, phase: Phase, packet: string, key: string): Promise<Attempt> {
    const e = this.evidence;
    const route = e?.routes.find(entry => entry.role === role);
    if (!e || route?.bootstrap?.state !== "verified" || !route.recipe || route.recipe.facts.some(f => f.stage === "bootstrap" && f.observation.state !== "verified"))
      throw Error("WRAPPER_BOOTSTRAP_CONTROLS_UNVERIFIED");
    const directory = secureDirectory(request.workspace, [".council", "native-host", key]);
    const entry = fileURLToPath(new URL("./host-wrapper.js", import.meta.url));
    const deadline = Math.min(request.deadline, this.now()+request.workerTimeoutMs);
    const operationId = mutationRequestId(`terminal:${key}`);
    this.record({ event: "wrapper-terminal-reserved", operationId, directory, wrapperHash: sha256(readFileSync(entry)) });
    const rpc = this.rpc(e.runtimeId);
    const created = await rpc.callScoped("terminal.create", { worktree: `path:${request.workspace}`, cwd: directory,
      command: `exec ${[process.execPath, entry, "--directory", directory, "--orca", this.orca, "--runtime", e.runtimeId, "--deadline", String(deadline)].map(quote).join(" ")}`,
      presentation: "background", clientMutationId: operationId,
      envToDelete: ["ORCA_AGENT_SESSION_ID", "ORCA_AGENT_SESSION_SPAWN_TOKEN", "ORCA_SESSION_ID"] });
    const handle = created.terminal?.handle ?? created.handle;
    if (typeof handle !== "string") throw Error(`WRAPPER_TERMINAL_OUTCOME_UNKNOWN:${operationId}`);
    this.record({ event: "wrapper-terminal-observed", operationId, handle, directory });
    const terminal = (await rpc.callScoped("terminal.show", { terminal: handle })).terminal;
    const identity = identitySchema.parse({ handle, worktreeId: terminal?.worktreeId, ptyId: terminal?.ptyId, incarnationId: terminal?.incarnationId,
      paneKey: terminal?.paneKey ?? (typeof terminal?.tabId === "string" && typeof terminal?.leafId === "string" ? `${terminal.tabId}:${terminal.leafId}` : undefined) });
    if (identity.worktreeId !== e.workspaceId) throw Error("WRAPPER_WORKSPACE_MISMATCH");
    const selection = role === "judge" ? request.config.judge : request.config.reviewers[role];
    const packetHash = hashArtifact("pilot-packet", { runId: run, role, phase, packet, attemptKey: key });
    const base = { version: 1 as const, runtimeId: e.runtimeId, workspace: request.workspace, workspaceId: e.workspaceId, directory, identity,
      role, phase, selection, packetHash, packet, controlsHash: e.controlsHash, policyHash: e.policyHash, deadline, orca: this.orca, recipe: route.recipe, producerHash: producerCodeHash() };
    const spec = `Council wrapper intent sha256=${sha256(canonicalJson(wrapperIntent(base)))}`;
    this.record({ event: "wrapper-task-reserved", requestId: mutationRequestId(`task:${key}`), run, handle, intentHash: sha256(canonicalJson(wrapperIntent(base))) });
    const task = await this.command(["orchestration", "task-create", "--run", run, "--spec", spec, "--retry-request", mutationRequestId(`task:${key}`), "--json"], request.workspace, 5000);
    if (typeof task.task?.id !== "string") throw Error("WRAPPER_TASK_OUTCOME_UNKNOWN");
    this.record({ event: "wrapper-task-observed", taskId: task.task.id, run, handle });
    this.record({ event: "wrapper-dispatch-reserved", requestId: mutationRequestId(`dispatch:${key}`), taskId: task.task.id, run, handle });
    const receipt = await this.command(["orchestration", "dispatch", "--run", run, "--task", task.task.id, "--to", handle,
      "--retry-request", mutationRequestId(`dispatch:${key}`), "--json"], request.workspace, 5000);
    const d = receipt.dispatch;
    this.record({ event: "wrapper-dispatch-observed", dispatch: d ?? null, injected: receipt.injected ?? null });
    if (receipt.injected !== false || !d || (d.assigneeHandle ?? d.assignee_handle) !== handle ||
        (d.assigneePaneKey ?? d.assignee_pane_key) !== identity.paneKey ||
        typeof (d.processIncarnation ?? d.process_incarnation) !== "string" || !(d.processIncarnation ?? d.process_incarnation))
      throw Error("WRAPPER_DISPATCH_AUTHORITY_UNVERIFIED");
    const binding = { runId: run, taskId: task.task.id, dispatchId: d.id, handle, attemptKey: key };
    const assignment = assignmentSchema.parse({ ...base, binding, dispatchIncarnation: d.processIncarnation ?? d.process_incarnation });
    writeExclusive(join(directory, "assignment.json"), assignment);
    const assignmentHash = sha256(readFileSync(join(directory, "assignment.json")));
    const attempt: Attempt = { binding, role, phase, selection, packetHash, launchVerified: false, context: { directory, assignmentHash }, inferenceStarted: false, initializations: 0 };
    this.owned.set(binding.dispatchId, { assignment, assignmentHash, closeAttempted: false, proof: null });
    this.record({ event: "wrapper-native-bound", attempt, identity });
    while (this.now() < deadline) {
      if (existsSync(join(directory, "prepared.json"))) {
        const prepared = readStrictFile(join(directory, "prepared.json"));
        attempt.initializations = prepared.initializations;
        if (prepared.assignmentHash !== assignmentHash || prepared.ready !== true) { attempt.controlError = prepared.error ?? "WRAPPER_EFFECTIVE_CONTROLS_UNVERIFIED"; return attempt; }
        attempt.inferenceStarted = null;
        attempt.controlError = "WRAPPER_INPUT_ACK_UNKNOWN";
        try { writeExclusive(join(directory, "input.json"), { assignmentHash, requestId: mutationRequestId(`input:${key}`) }); }
        catch { attempt.controlError = "WRAPPER_INPUT_MUTATION_UNKNOWN"; return attempt; }
        while (this.now() < deadline) {
          if (existsSync(join(directory, "inference-started.json"))) {
            const started = readStrictFile(join(directory, "inference-started.json"));
            if (started.assignmentHash !== assignmentHash || started.calls !== 1) throw Error("WRAPPER_INPUT_ACK_UNBOUND");
            attempt.inferenceStarted = true; attempt.launchVerified = true; delete attempt.controlError; return attempt;
          }
          if (existsSync(join(directory, "result.json"))) {
            const observed = readStrictFile(join(directory, "result.json"));
            attempt.inferenceStarted = observed.calls === 0 ? false : observed.calls === 1 ? true : null;
            attempt.controlError = "WRAPPER_INPUT_DELIVERY_UNVERIFIED"; return attempt;
          }
          await pause(20);
        }
        return attempt;
      }
      await pause(20);
    }
    attempt.controlError = "WRAPPER_INITIALIZATION_DEADLINE";
    attempt.initializations = existsSync(join(directory, "initialization-started.json")) ? 1 : 0;
    return attempt;
  }
  private get(a: Attempt) {
    const owned = this.owned.get(a.binding.dispatchId);
    if (!owned || canonicalJson(owned.assignment.binding) !== canonicalJson(a.binding) || a.context?.assignmentHash !== owned.assignmentHash) throw Error("WRAPPER_NOT_OWNED");
    return owned;
  }
  async observe(a: Attempt, deadline: number): Promise<Result> {
    const { assignment } = this.get(a);
    while (this.now() < deadline) {
      try {
        const verified = await verifyContextResult(assignment, this.command);
        if (verified.report.status !== "completed" || verified.report.calls !== 1) throw Error("WRAPPER_PROVIDER_FAILED");
        const value = pilotResultEnvelopeSchema.parse(verified.report.result);
        if (canonicalJson(value.binding) !== canonicalJson(a.binding) || value.packetHash !== a.packetHash || value.role !== a.role || value.phase !== a.phase ||
            canonicalJson(value.selection) !== canonicalJson(a.selection) || !pilotPayloadSchemas[a.phase].safeParse(value.payload).success) throw Error("WRAPPER_RESULT_BINDING_MISMATCH");
        return { ...value, settlement: "unknown", source: "native Task.result bound host artifact", sourceIdentity: verified.completionMessageId, provider: a.selection.route };
      } catch (error) {
        if (existsSync(join(assignment.directory, "result.json")) && existsSync(join(assignment.directory, "completion-native.json"))) throw error;
      }
      await pause(20);
    }
    throw Error("WRAPPER_RESULT_DEADLINE");
  }
  async cancel(a: Attempt, deadline: number, mode?: "absolute-cleanup"): Promise<CancellationResult> {
    const { assignment } = this.get(a);
    const until = mode === "absolute-cleanup" ? deadline : Math.max(Math.min(deadline, this.now()+120000), this.now()+30000);
    if (until <= this.now()) return { state: "unknown" };
    const file = join(assignment.directory, "cancel.json");
    const requestId = mutationRequestId(`wrapper-stop:${canonicalJson(a.binding)}`);
    if (!existsSync(file)) writeExclusive(file, { requestId, binding: a.binding, deadline: until });
    while (this.now() < until) {
      try {
        const verified = await verifyContextResult(assignment, this.command);
        const cancel = verified.report.cancellation;
        return verified.report.status === "cancelled" && cancel?.requestId === requestId && cancel?.acknowledged === true && canonicalJson(cancel.binding) === canonicalJson(a.binding)
          ? { state: "settled", stop: { dispatchId: a.binding.dispatchId, requestId, state: "stopped", kind: "wrapper-control" } }
          : { state: "settled_unacknowledged", ...(verified.report.error ? { error: verified.report.error as string } : {}) };
      } catch { /* Observe the same owned attempt; never resend a provider stop. */ }
      await pause(20);
    }
    return { state: "unknown" };
  }
  async release(a: Attempt, deadline = this.now()+30000): Promise<boolean> {
    const owned = this.get(a);
    if (owned.proof) return true;
    if (owned.closeAttempted) return false;
    const { assignment } = owned;
    while (this.now() < deadline) {
      try {
        const verified = await verifyContextResult(assignment, this.command);
        let exited = false;
        try { process.kill(verified.report.wrapperPid, 0); } catch (error) { exited = (error as NodeJS.ErrnoException).code === "ESRCH"; }
        if (!exited) { await pause(20); continue; }
        const rpc = this.rpc(assignment.runtimeId);
        const shown = (await rpc.callScoped("terminal.show", { terminal: assignment.identity.handle })).terminal;
        if (!Object.entries(assignment.identity).filter(([key]) => key !== "paneKey").every(([key, value]) => shown?.[key] === value)) return false;
        const parameters = { terminal: assignment.identity.handle, expectedIncarnationId: assignment.identity.incarnationId };
        let processState: any = null;
        let inspectFailure: string | null = null;
        try { processState = (await rpc.callScoped("terminal.inspectProcess", { ...parameters, scanChildProcesses: true })).process; }
        catch (cause) {
          const code = (cause as any)?.code ?? (cause as any)?.response?.error?.code;
          if (shown?.connected !== false || code !== "terminal_gone") return false;
          inspectFailure = code;
        }
        const settlement = { processState, inspectFailure, nativeTerminal: shown };
        if (!validCleanupSettlement(settlement, assignment.identity)) return false;
        owned.closeAttempted = true;
        this.record({ event: "wrapper-terminal-close-reserved", identity: assignment.identity });
        const closed = await rpc.callScoped("terminal.close", parameters);
        if (closed.close?.handle !== assignment.identity.handle || closed.close.ptyKilled !== true || closed.close.ptyStopVerdict !== undefined) return false;
        const cleanup = { binding: a.binding, identity: assignment.identity, wrapperPid: verified.report.wrapperPid, wrapperExit: true, ...settlement, close: closed.close };
        writeExclusive(join(assignment.directory, "cleanup.json"), cleanup);
        owned.proof = { custody: "context-only-external", directory: assignment.directory, assignmentHash: owned.assignmentHash,
          resultHash: verified.resultHash, completionMessageId: verified.completionMessageId, identity: assignment.identity,
          wrapperExit: true, terminalClosed: true, cleanupHash: sha256(readFileSync(join(assignment.directory, "cleanup.json"))) };
        return true;
      } catch { if (owned.closeAttempted) return false; await pause(20); }
    }
    return false;
  }
  proof(a: Attempt) { return this.get(a).proof; }
}
