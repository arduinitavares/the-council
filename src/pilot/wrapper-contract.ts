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
  const files = readdirSync(directory).filter(name => name.endsWith(".js")).sort().map(name => join(directory, name));
  for (const suffix of ["../orca/client.js", "../domain/hash.js", "../workers/strict-json.js"]) files.push(join(directory, suffix));
  return sha256(canonicalJson(files.map(file => ({ name: file.slice(directory.length+1), sha256: sha256(readFileSync(file)) }))));
}
export const observationSchema = z.strictObject({ state: z.enum(["verified", "unknown", "missing", "denied", "authentication_failed", "exhausted", "unavailable", "unsupported"]), source: z.string().min(1), detail: z.string() });
export const controlFactSchema = z.strictObject({ name: z.string(), stage: z.enum(["bootstrap", "effective"]), observation: observationSchema, enforcement: z.string(), observedAt: z.number().int(), digest: z.string() });
export type ControlFact = z.infer<typeof controlFactSchema>;
export const recipeSchema = z.strictObject({
  protocol: z.enum(["agy-stream", "codex-app-server", "cursor-stream"]),
  executable: z.string(), argv: z.array(z.string()), cwd: z.string(), version: z.string(),
  selection: selectionSchema, expectedPermission: z.string(),
  sources: z.array(z.strictObject({ path: z.string(), sha256: z.string() })),
  facts: z.array(controlFactSchema),
  agent: z.string().optional(),
  materializations: z.array(z.strictObject({ path: z.string(), content: z.string(), sha256: z.string() })).optional(),
  codexPolicy: z.strictObject({ name: z.string(), filesystem: z.record(z.string(), z.enum(["read", "deny"])), featureKeys: z.array(z.string()) }).optional(),
});
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
