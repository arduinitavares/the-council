#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../domain/hash.js";
import { assignmentSchema, readStrictFile, sha256, writeExclusive, producerCodeHash } from "./wrapper-contract.js";
import { wrapperIntent } from "./context-driver.js";
import { nativeCommand } from "./native-command.js";
import { mutationRequestId } from "./mutation-id.js";
import { runProviderSession } from "./provider-session.js";

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
  let report: any;
  try { report = await runProviderSession(a, assignmentHash); }
  catch (cause) {
    const error = cause instanceof Error ? cause.message : "WRAPPER_PROVIDER_INITIALIZATION_FAILED";
    writeExclusive(join(directory, "prepared.json"), { assignmentHash, ready: false, initializations: 0, error });
    const beforeSpawn = ["PROVIDER_BOOTSTRAP_UNVERIFIED", "PROVIDER_CONTROL_SOURCE_DRIFT", "PROVIDER_PREINPUT_CONTROL_UNSUPPORTED", "PROVIDER_PACKET_ROOT_MISMATCH", "PROVIDER_PACKET_ROOT_UNVERIFIED", "PROVIDER_PROFILE_SCOPE_INVALID", "PROVIDER_PROFILE_SYMLINK", "PROVIDER_PROFILE_CONTENT_MISMATCH"].includes(error);
    report = { version: 1, binding: a.binding, assignmentHash, packetHash: a.packetHash, controlsHash: a.controlsHash, status: "failed", calls: beforeSpawn ? 0 : null, initializations: beforeSpawn ? 0 : null, error,
      process: { providerStarted: beforeSpawn ? false : null, closed: beforeSpawn, groupSettled: beforeSpawn, trackedDescendantsSettled: beforeSpawn, timersSettled: beforeSpawn, inputDelivered: false } };
  }
  report.wrapperPid = process.pid;
  writeExclusive(join(directory, "result.json"), report);
  const digest = sha256(readFileSync(join(directory, "result.json")));
  const ok = ["completed", "cancelled"].includes(report.status) && report.process.closed && report.process.groupSettled && report.process.trackedDescendantsSettled && report.process.timersSettled;
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
    .catch(error => { console.error(error instanceof Error ? error.message : "WRAPPER_FAILED"); process.exitCode = 1; });
}
