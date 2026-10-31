import { z } from "zod";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, lstatSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../domain/hash.js";
import { selectionSchema } from "./config.js";
import { decodeStrictJson } from "../workers/strict-json.js";

export const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function producerCodeHash(): string {
  const directory = dirname(fileURLToPath(import.meta.url));
  const extension = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
  const files = readdirSync(directory).filter(name => name.endsWith(extension)).sort().map(name => join(directory, name));
  for (const suffix of ["../orca/client", "../domain/hash", "../workers/strict-json"]) files.push(join(directory, suffix+extension));
  return sha256(canonicalJson(files.map(file => ({ name: file.slice(directory.length+1), sha256: sha256(readFileSync(file)) }))));
}
export const observationSchema = z.strictObject({ state: z.enum(["verified", "unknown", "missing", "denied", "authentication_failed", "exhausted", "unavailable", "unsupported"]), source: z.string().min(1), detail: z.string() });
export const controlFactSchema = z.strictObject({ name: z.string(), stage: z.enum(["bootstrap", "effective"]), observation: observationSchema, enforcement: z.string(), observedAt: z.number().int(), digest: z.string() });
export type ControlFact = z.infer<typeof controlFactSchema>;
const hookMetadataSchema = z.strictObject({ dev: z.number(), ino: z.number(), uid: z.number().int(), gid: z.number().int(), mode: z.number().int(), type: z.enum(["file", "directory", "symlink", "other"]) });
const hookSourceSchema = z.strictObject({ path: z.string(), realpath: z.string(), entry: hookMetadataSchema, target: hookMetadataSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/) });
export const agyHookShellPolicySchema = z.strictObject({
  version: z.literal(1), contract: z.literal("agy-orca-hook-v1"), route: z.literal("antigravity"),
  workspace: z.string(), executionCwd: z.string(), executable: z.string(), providerVersion: z.string(), basePath: z.string(),
  uid: z.number().int().nonnegative(), gid: z.number().int().nonnegative(), node: z.string(),
  installed: z.string(), hookContent: z.string(), templateHash: z.string().regex(/^[a-f0-9]{64}$/),
  descriptors: z.array(z.strictObject({ type: z.literal("command"), command: z.string(), timeout: z.literal(10) })).min(5),
  identities: z.array(hookSourceSchema).min(10),
  startupDirectories: z.array(z.strictObject({ path: z.string(), metadata: hookMetadataSchema, entries: z.array(z.string()) })),
  absences: z.array(z.string()),
  environment: z.strictObject({ PATH: z.literal("/usr/bin:/bin"), LANG: z.literal("C"), LC_ALL: z.literal("C"), DEVELOPER_DIR: z.literal("/Library/Developer/CommandLineTools"), PYTHONNOUSERSITE: z.literal("1"), PYTHONDONTWRITEBYTECODE: z.literal("1"), __CF_USER_TEXT_ENCODING: z.string().regex(/^0x[0-9A-F]+:0:0$/) }),
});
export type AgyHookShellPolicy = z.infer<typeof agyHookShellPolicySchema>;
export const recipeSchema = z.strictObject({
  protocol: z.enum(["agy-stream", "codex-app-server", "cursor-stream"]),
  executable: z.string(), argv: z.array(z.string()), cwd: z.string(), version: z.string(),
  selection: selectionSchema, expectedPermission: z.string(),
  sources: z.array(z.strictObject({ path: z.string(), sha256: z.string().nullable(), kind: z.enum(["file","metadata","absent"]).optional() })),
  instructionSources: z.array(z.strictObject({path:z.string(),sha256:z.string()})).optional(),
  facts: z.array(controlFactSchema),
  agent: z.string().optional(),
  agentDefinition: z.strictObject({path:z.string(),sha256:z.string()}).optional(),
  materializations: z.array(z.strictObject({ path: z.string(), content: z.string(), sha256: z.string(), mode: z.union([z.literal(0o400), z.literal(0o500), z.literal(0o600)]).optional() })).optional(),
  agyHookShell: agyHookShellPolicySchema.optional(),
  codexPolicy: z.strictObject({ name: z.string(), filesystem: z.record(z.string(), z.enum(["read", "deny"])), featureKeys: z.array(z.string()) }).optional(),
}).refine(recipe => !recipe.agyHookShell || (recipe.protocol === "agy-stream" && recipe.selection.route === "antigravity"), "AGY_HOOK_PROTOCOL_MISMATCH");
export type ProviderRecipe = z.infer<typeof recipeSchema>;
export const identitySchema = z.strictObject({ handle: z.string().min(1), worktreeId: z.string().min(1), ptyId: z.string().min(1), incarnationId: z.string().min(1), paneKey: z.string().min(1) });
export const bindingSchema = z.strictObject({ runId: z.string().min(1), taskId: z.string().min(1), dispatchId: z.string().min(1), handle: z.string().min(1), attemptKey: z.string().min(1) });
export const assignmentSchema = z.strictObject({
  version: z.literal(1), runtimeId: z.string(), workspace: z.string(), workspaceId: z.string(),
  directory: z.string(), identity: identitySchema, binding: bindingSchema,
  dispatchIncarnation: z.string().min(1),
  producerHash: z.string().min(1),
  phase: z.enum(["normal-probe", "cancel-probe", "readiness", "review", "judge", "ballot"]),
  role: z.enum(["openai", "gemini", "xai", "judge"]), selection: selectionSchema,
  packetHash: z.string(), packet: z.string(), controlsHash: z.string(), policyHash: z.string(),
  deadline: z.number().int(), orca: z.string(), recipe: recipeSchema,
});
export type WrapperAssignment = z.infer<typeof assignmentSchema>;
export const contextProofSchema = z.strictObject({
  custody: z.literal("context-only-external"), directory: z.string(), assignmentHash: z.string(),
  resultHash: z.string(), completionMessageId: z.string(), identity: identitySchema,
  wrapperExit: z.literal(true), terminalClosed: z.literal(true), cleanupHash: z.string(),
});
export type ContextProof = z.infer<typeof contextProofSchema>;
export function readStrictFile(file: string, limit = 1024 * 1024): any {
  if (lstatSync(file).isSymbolicLink()) throw Error("WRAPPER_ARTIFACT_SYMLINK");
  const bytes = readFileSync(file);
  if (bytes.length > limit) throw Error("WRAPPER_ARTIFACT_TOO_LARGE");
  return decodeStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
export function writeExclusive(file: string, value: unknown): void {
  writeFileSync(file, canonicalJson(value)+"\n", { mode: 0o600, flag: "wx" });
}
export function writeAtomic(file: string, value: unknown): void {
  const temporary = file+".pending";
  writeExclusive(temporary, value);
  renameSync(temporary, file);
}
export function factsObservation(facts: readonly ControlFact[], stage: "bootstrap" | "effective") {
  const relevant = facts.filter(f => f.stage === stage);
  const failed = relevant.find(f => ["denied", "authentication_failed", "exhausted"].includes(f.observation.state)) ?? relevant.find(f => f.observation.state !== "verified");
  return { state: failed?.observation.state ?? (relevant.length ? "verified" : "missing"), source: "provider-specific control sources", detail: canonicalJson(relevant.map(f => ({ name: f.name, ...f.observation, enforcement: f.enforcement, digest: f.digest }))) } as z.infer<typeof observationSchema>;
}
