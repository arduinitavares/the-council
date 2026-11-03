#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../domain/hash.js";
import { assignmentSchema, readStrictFile, sha256, writeExclusive, producerCodeHash, readPreparedReport, preparedReportSchema, providerReportSchema,
  projectProviderInitialization, PREPARED_REPORT_VERSION, PROVIDER_REPORT_VERSION, type ProviderReport } from "./wrapper-contract.js";
import { wrapperIntent } from "./context-driver.js";
import { nativeCommand } from "./native-command.js";
import { mutationRequestId } from "./mutation-id.js";
import { runProviderSession } from "./provider-session.js";
import { projectDiagnostic, diagnosticError, fitDiagnosticSummary, parseDiagnosticSummary, ProviderSessionFailure, type DiagnosticSummary } from "./diagnostics.js";

/** Only a readable, validated session carrier can prove that spawn was never reached. */
function providerNotStarted(cause: unknown, diagnostic: DiagnosticSummary): boolean {
  try {
    if (!(cause instanceof ProviderSessionFailure)) return false;
    const state = Object.getOwnPropertyDescriptor(cause, "providerState");
    const carried = Object.getOwnPropertyDescriptor(cause, "diagnostic");
    return state?.value === "not_started" && !!carried && "value" in carried &&
      canonicalJson(parseDiagnosticSummary(carried.value)) === canonicalJson(diagnostic);
  } catch { return false; }
}


/** Actual shipped entry. It starts no provider while waiting for native
 * assignment, and never obtains caller authority from a copied --from value. */
export async function runHostWrapper(directory: string, orca: string, runtimeId: string, deadline: number): Promise<void> {
  if (realpathSync(directory) !== directory || !Number.isSafeInteger(deadline) || deadline <= Date.now() || deadline-Date.now() > 120000) throw Error("WRAPPER_START_SCOPE_INVALID");
  writeExclusive(join(directory, "wrapper-ready.json"), { pid: process.pid, directory, runtimeId, terminal: process.env.ORCA_TERMINAL_HANDLE ?? null, pane: process.env.ORCA_PANE_KEY ?? null });
  while (!existsSync(join(directory, "assignment.json")) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  const a = assignmentSchema.parse(readStrictFile(join(directory, "assignment.json")));
  const assignmentHash = sha256(readFileSync(join(directory, "assignment.json")));
  if (a.directory !== directory || a.runtimeId !== runtimeId || a.orca !== orca || a.deadline !== deadline ||
      process.env.ORCA_AGENT_SESSION_ID || process.env.ORCA_TERMINAL_HANDLE !== a.identity.handle || process.env.ORCA_PANE_KEY !== a.identity.paneKey ||
      a.binding.handle !== a.identity.handle) throw Error("WRAPPER_GENUINE_CALLER_UNVERIFIED");
  if (a.producerHash !== producerCodeHash()) throw Error("WRAPPER_PRODUCER_CODE_DRIFT");
  const command = await nativeCommand(orca, a.workspace, runtimeId);
  const current = await command(["orchestration", "dispatch-show", "--task", a.binding.taskId, "--json"], a.workspace, 5000);
  const d = current.dispatch;
  if (d?.id !== a.binding.dispatchId || (d.runId ?? d.run_id) !== a.binding.runId ||
      (d.assigneeHandle ?? d.assignee_handle) !== a.identity.handle || (d.assigneePaneKey ?? d.assignee_pane_key) !== a.identity.paneKey ||
      (d.processIncarnation ?? d.process_incarnation) !== a.dispatchIncarnation || d.status !== "dispatched") throw Error("WRAPPER_NATIVE_DISPATCH_UNVERIFIED");
  const tasks = await command(["orchestration", "task-list", "--run", a.binding.runId, "--json"], a.workspace, 5000);
  if (!tasks.tasks?.some((task: any) => task.id === a.binding.taskId && task.spec === `Council wrapper intent sha256=${sha256(canonicalJson(wrapperIntent(a)))}`)) throw Error("WRAPPER_NATIVE_INTENT_UNVERIFIED");
  let report: ProviderReport;
  try { report = await runProviderSession(a, assignmentHash); }
  catch (cause) {
    let diagnostic = projectDiagnostic(cause, { origin: "host-wrapper", phase: "initialization" });
    const beforeSpawn = providerNotStarted(cause, diagnostic);
    const initializations = beforeSpawn ? 0 : null;
    const init = projectProviderInitialization(undefined, a);
    const preparedFile = join(directory, "prepared.json");
    try {
      writeExclusive(preparedFile, preparedReportSchema.parse({ version: PREPARED_REPORT_VERSION, assignmentHash,
        ready: false, initializations, error: diagnostic.code, diagnostic, init }));
    } catch (creationFailure) {
      let existing = false;
      try { existing = (creationFailure as NodeJS.ErrnoException)?.code === "EEXIST"; } catch {}
      if (!existing) throw diagnosticError(creationFailure, { origin: "host-wrapper", phase: "persistence" });
      try { readPreparedReport(preparedFile, assignmentHash); }
      catch {
        // Historical or unbound readiness is evidence: keep its bytes untouched.
        diagnostic = fitDiagnosticSummary({ ...diagnostic, details: [...diagnostic.details,
          { origin: "host-wrapper", phase: "validation", code: "WRAPPER_RESULT_UNBOUND" }] });
      }
    }
    report = providerReportSchema.parse({ version: PROVIDER_REPORT_VERSION, binding: a.binding, assignmentHash,
      packetHash: a.packetHash, controlsHash: a.controlsHash, status: "failed", calls: beforeSpawn ? 0 : null,
      initializations, error: diagnostic.code, diagnostic, init, result: null, conversationId: null, cancellation: null,
      selectedAgent: { requested: a.recipe.agent ?? null, observed: null, source: "Source-bound argv/definition; init agent identity not exposed" },
      process: { pid: null, providerStarted: beforeSpawn ? false : null, exitCode: null, signal: null,
        closed: beforeSpawn, groupSettled: beforeSpawn, trackedDescendantsSettled: beforeSpawn,
        escapedDescendantObserved: beforeSpawn ? false : null, parsingSettled: beforeSpawn,
        processScansSettled: beforeSpawn, timersSettled: beforeSpawn, inputDelivered: beforeSpawn ? false : null,
        stopRequested: beforeSpawn ? false : null, descendantEvidence: null } });
  }
  report.wrapperPid = process.pid;
  writeExclusive(join(directory, "result.json"), report);
  const digest = sha256(readFileSync(join(directory, "result.json")));
  const ok = ["completed", "cancelled"].includes(report.status) && report.process.closed && report.process.groupSettled && report.process.trackedDescendantsSettled &&
    report.process.parsingSettled === true && report.process.processScansSettled === true && report.process.timersSettled;
  const body = `The host wrapper collected ${report.status === "cancelled" ? "the bound active-turn cancellation acknowledgement" : "the bound provider outcome"}. Artifact sha256=${digest} records original provider exit, input and cleanup evidence. The coordinator must independently verify wrapper exit and exact terminal closure.`;
  const requestId = mutationRequestId(`completion:${canonicalJson(a.binding)}`);
  writeExclusive(join(directory, "completion-reserved.json"), { requestId, binding: a.binding, digest });
  const sent = await command(["orchestration", "send", "--run", a.binding.runId, "--from", process.env.ORCA_TERMINAL_HANDLE!, "--type", "worker_done",
    "--task-id", a.binding.taskId, "--dispatch-id", a.binding.dispatchId, "--outcome", ok ? "succeeded" : "failed",
    "--subject", "Bound Council wrapper outcome", "--body", body, "--report-path", join(directory, "result.json"), "--retry-request", requestId, "--json"], a.workspace, 5000);
  writeExclusive(join(directory, "completion-native.json"), sent);
  if (!["completed", "failed", "settled"].includes(sent.lifecycle?.action) || sent.lifecycle?.action === "rejected") throw Error("WRAPPER_NATIVE_COMPLETION_UNKNOWN");
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const values = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) values.set(process.argv[i]!, process.argv[i+1]!);
  runHostWrapper(values.get("--directory")!, values.get("--orca")!, values.get("--runtime")!, Number(values.get("--deadline")))
    .catch(cause => { console.error(projectDiagnostic(cause, { origin: "host-wrapper", phase: "bootstrap" }).code); process.exitCode = 1; });
}
