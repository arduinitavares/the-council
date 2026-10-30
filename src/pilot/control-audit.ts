import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { canonicalJson } from "../domain/hash.js";
import { decodeStrictJson } from "../workers/strict-json.js";
import { readStrictFile, sha256, writeExclusive } from "./wrapper-contract.js";
import type { Command } from "./orca-driver.js";

export const auditSourceSchema = z.strictObject({ path: z.string(), sha256: z.string().nullable(), kind: z.enum(["file", "metadata", "absent"]).optional() });
export type AuditSource = z.infer<typeof auditSourceSchema>;
export function currentSourceDigest(source: AuditSource): string | null {
  try {
    const stat = lstatSync(source.path);
    if (source.kind === "absent") return "unexpected-source";
    if (source.kind === "metadata") return sha256(canonicalJson({ mode: stat.mode, dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, symbolicLink: stat.isSymbolicLink() }));
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error("AUDIT_SOURCE_NOT_REGULAR");
    return sha256(readFileSync(source.path));
  } catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null; throw cause; }
}
export const auditSnapshotSchema = z.strictObject({
  version: z.literal(1), workspace: z.string(), route: z.enum(["codex", "antigravity", "cursor"]), providerVersion: z.string(),
  contract: z.string(), executable: z.string(), sources: z.array(auditSourceSchema),
  // Order is effective loader precedence, not alphabetical presentation.
  ordering: z.array(z.string()), effects: z.array(z.string()), unavailable: z.array(z.string()), recipeHash: z.string(),
});
export type AuditSnapshot = z.infer<typeof auditSnapshotSchema>;
export const auditHash = (snapshot: AuditSnapshot) => sha256(canonicalJson(auditSnapshotSchema.parse(snapshot)));
function directory(workspace: string, leaf: string) {
  let current = realpathSync(workspace);
  for (const part of [".council", "control-audits", leaf]) {
    current = join(current, part);
    if (!existsSync(current)) mkdirSync(current, { mode: 0o700 });
    if (lstatSync(current).isSymbolicLink() || realpathSync(current) !== current) throw Error("AUDIT_DIRECTORY_UNVERIFIED");
  }
  return current;
}
export function saveAuditSnapshot(snapshot: AuditSnapshot) {
  const hash = auditHash(snapshot);
  const file = join(directory(snapshot.workspace, "snapshots"), hash+".json");
  if (!existsSync(file)) writeExclusive(file, snapshot);
  else if (auditHash(auditSnapshotSchema.parse(readStrictFile(file))) !== hash) throw Error("AUDIT_SNAPSHOT_COLLISION");
  return { hash, path: file, snapshot, requiredDispositions: snapshot.effects, unavailable: snapshot.unavailable, providerQualification: "separate-required" };
}
const auditIdentitySchema=z.strictObject({handle:z.string(),worktreeId:z.string(),worktreePath:z.string(),ptyId:z.string(),incarnationId:z.string(),paneKey:z.string()});
const referenceSchema = z.strictObject({ identity:auditIdentitySchema, version: z.literal(1), snapshotHash: z.string(), runId: z.string(), taskId: z.string(), dispatchId: z.string(), messageId: z.string() });
const dispositionSchema = z.strictObject({ kind: z.literal("council-control-audit"), snapshotHash: z.string(), approvedEffects: z.array(z.string()) });
async function nativeDisposition(snapshot: AuditSnapshot, runId: string, taskId: string, command: Command, retainedIdentity?: z.infer<typeof auditIdentitySchema>) {
  const hash = auditHash(snapshot);
  const run = (await command(["orchestration", "run-show", "--id", runId, "--json"], snapshot.workspace, 5000)).run;
  const coordinator = run?.coordinator_handle ?? run?.coordinatorHandle;
  if (run?.id !== runId || typeof coordinator !== "string" || !coordinator) throw Error("AUDIT_NATIVE_OWNER_UNVERIFIED");
  const workspace=(await command(["worktree","show","--worktree",`path:${snapshot.workspace}`,"--json"],snapshot.workspace,5000)).worktree;
  const terminal=retainedIdentity??(await command(["terminal","show","--terminal",coordinator,"--json"],snapshot.workspace,5000)).terminal;
  if(workspace?.path!==snapshot.workspace||typeof workspace.id!=="string"||terminal?.worktreePath!==snapshot.workspace||terminal?.worktreeId!==workspace.id)throw Error("AUDIT_NATIVE_WORKSPACE_UNVERIFIED");
  const identity=auditIdentitySchema.parse({handle:terminal.handle,worktreeId:terminal.worktreeId,worktreePath:terminal.worktreePath,ptyId:terminal.ptyId,incarnationId:terminal.incarnationId,paneKey:terminal.paneKey??`${terminal.tabId}:${terminal.leafId}`});
  if(identity.handle!==coordinator||!identity.ptyId.startsWith(workspace.id+"@@"))throw Error("AUDIT_NATIVE_IDENTITY_UNVERIFIED");
  const dispatch = (await command(["orchestration", "dispatch-show", "--task", taskId, "--json"], snapshot.workspace, 5000)).dispatch;
  const tasks = await command(["orchestration", "task-list", "--run", runId, "--json"], snapshot.workspace, 5000);
  const task = tasks.tasks?.find((entry: any) => entry.id === taskId);
  const result = typeof task?.result === "string" ? decodeStrictJson(task.result) as any : null;
  if ((dispatch?.runId ?? dispatch?.run_id) !== runId || (dispatch?.taskId ?? dispatch?.task_id) !== taskId ||
      (dispatch?.assigneeHandle ?? dispatch?.assignee_handle) !== coordinator || dispatch?.status !== "completed" ||
      typeof dispatch.id !== "string" || typeof (dispatch.processIncarnation ?? dispatch.process_incarnation) !== "string" ||
      task?.spec !== `Council control audit sha256=${hash}` || task.status !== "completed" || result?.provenance !== "worker_report" ||
      result.outcome !== "succeeded" || result.reportedBy !== coordinator || typeof result.messageId !== "string") throw Error("AUDIT_NATIVE_DISPOSITION_UNVERIFIED");
  // The durable native incarnation is ptyId:incarnationId.
  // Native Task creator provenance lets reuse verify this after terminal close,
  // without asking a historical process or a reused PID whether it is alive.
  const incarnation=`${identity.ptyId}:${identity.incarnationId}`;
  if((dispatch.assigneePaneKey??dispatch.assignee_pane_key)!==identity.paneKey||
      (dispatch.processIncarnation??dispatch.process_incarnation)!==incarnation||
      task.created_by_terminal_handle!==coordinator||task.created_by_pane_key!==identity.paneKey||
      task.created_by_process_incarnation!==incarnation)throw Error("AUDIT_NATIVE_IDENTITY_UNVERIFIED");
  const disposition = dispositionSchema.parse(decodeStrictJson(result.body));
  if (disposition.snapshotHash !== hash || disposition.approvedEffects.some(effect => !snapshot.effects.includes(effect))) throw Error("AUDIT_DISPOSITION_SCOPE_MISMATCH");
  return { reference: { identity, version: 1 as const, snapshotHash: hash, runId, taskId, dispatchId: dispatch.id as string, messageId: result.messageId as string }, approvedEffects: disposition.approvedEffects };
}
export async function adoptAuditSnapshot(workspace: string, hash: string, runId: string, taskId: string, command: Command) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw Error("AUDIT_HASH_INVALID");
  const snapshot = auditSnapshotSchema.parse(readStrictFile(join(workspace, ".council/control-audits/snapshots", hash+".json")));
  if (snapshot.workspace !== realpathSync(workspace) || auditHash(snapshot) !== hash || snapshot.sources.some(source => currentSourceDigest(source) !== source.sha256)) throw Error("AUDIT_SOURCE_DRIFT");
  const verified = await nativeDisposition(snapshot, runId, taskId, command);
  const file = join(directory(workspace,"dispositions"),hash+".json");
  if (!existsSync(file)) writeExclusive(file, verified.reference);
  else if (canonicalJson(referenceSchema.parse(readStrictFile(file))) !== canonicalJson(verified.reference)) throw Error("AUDIT_DISPOSITION_ALREADY_OWNED");
  return { hash, path: file, approvedEffects: verified.approvedEffects, unavailable: snapshot.unavailable, providerQualification: "separate-required" };
}
export async function acquiredAuditDisposition(snapshot: AuditSnapshot, command?: Command) {
  const hash = auditHash(snapshot);
  const file = join(snapshot.workspace, ".council/control-audits/dispositions",hash+".json");
  if (!existsSync(file)) return { verified: false, detail: `AUDIT_DISPOSITION_PENDING:${hash}` };
  if (!command) return { verified: false, detail: "AUDIT_NATIVE_AUTHORITY_READER_UNAVAILABLE" };
  try {
    const reference = referenceSchema.parse(readStrictFile(file));
    if (reference.snapshotHash !== hash || snapshot.sources.some(source => currentSourceDigest(source) !== source.sha256)) throw Error("AUDIT_SOURCE_DRIFT");
    const native = await nativeDisposition(snapshot, reference.runId, reference.taskId, command, reference.identity);
    if (canonicalJson(native.reference) !== canonicalJson(reference)) throw Error("AUDIT_NATIVE_REFERENCE_CHANGED");
    const pending = snapshot.effects.filter(effect => !native.approvedEffects.includes(effect));
    return { verified: pending.length === 0 && snapshot.unavailable.length === 0, detail: canonicalJson({ hash, pending, unavailable: snapshot.unavailable, reference }) };
  } catch { return { verified: false, detail: "AUDIT_NATIVE_DISPOSITION_UNVERIFIED" }; }
}
