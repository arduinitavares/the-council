import { z } from "zod";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, lstatSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../domain/hash.js";
import { selectionSchema } from "./config.js";
import { decodeStrictJson } from "../workers/strict-json.js";
import { DIAGNOSTIC_CODES, DIAGNOSTIC_SIGNALS, diagnosticSummarySchema } from "./diagnostics.js";
import { pilotPayloadSchemas, pilotResultEnvelopeSchema } from "./payload.js";

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
export const PROVIDER_REPORT_VERSION = 2;
export const PREPARED_REPORT_VERSION = 2;
const exposedValueSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("verified"), value: z.string() }),
  z.strictObject({ state: z.literal("unexposed"), value: z.null() }),
]);
export const providerInitializationSchema = z.union([
  z.strictObject({ state: z.literal("unobserved"), protocol: z.enum(["agy-stream", "cursor-stream", "codex-app-server"]) }),
  z.strictObject({ state: z.literal("verified"), protocol: z.enum(["agy-stream", "cursor-stream"]), model: z.string(), cwd: z.string(),
    tools: z.tuple([]), permission: exposedValueSchema, agent: exposedValueSchema }),
  z.strictObject({ state: z.literal("verified"), protocol: z.literal("codex-app-server"), model: z.string(), cwd: z.string(),
    configDigest: z.string().regex(/^[a-f0-9]{64}$/), modelProvider: z.literal("openai"), reasoningEffort: z.string(),
    activePermissionProfile: z.strictObject({ id: z.string(), extends: z.null() }), instructionSources: z.array(z.string()), tools: z.strictObject({ state: z.literal("unknown") }) }),
]);
export type ProviderInitialization = z.infer<typeof providerInitializationSchema>;

/** This projection follows effective validation; no unchecked object is spread. */
export function projectProviderInitialization(observed: unknown, assignment: WrapperAssignment): ProviderInitialization {
  const { recipe, selection } = assignment;
  const unobserved = { state: "unobserved", protocol: recipe.protocol } as const;
  if (observed == null) return unobserved;
  const value = observed as any;
  if (value.model !== selection.model || value.cwd !== recipe.cwd) throw Error("PROVIDER_EFFECTIVE_CONTROLS_UNVERIFIED");
  if (recipe.protocol === "codex-app-server") {
    if (value.modelProvider !== "openai" || value.reasoningEffort !== selection.effort || value.activePermissionProfile?.id !== recipe.codexPolicy?.name || value.activePermissionProfile?.extends != null ||
        !Array.isArray(value.instructionSources) || canonicalJson(value.instructionSources) !== canonicalJson((recipe.instructionSources ?? []).map(source => source.path))) throw Error("CODEX_THREAD_SELECTION_UNVERIFIED");
    return providerInitializationSchema.parse({ state: "verified", protocol: recipe.protocol, model: selection.model, cwd: recipe.cwd,
      configDigest: value.configDigest, modelProvider: "openai", reasoningEffort: selection.effort,
      activePermissionProfile: { id: recipe.codexPolicy!.name, extends: null }, instructionSources: (recipe.instructionSources ?? []).map(source => source.path), tools: { state: "unknown" } });
  }
  if (!Array.isArray(value.tools) || value.tools.length || (recipe.protocol === "agy-stream" && value.permission_mode !== recipe.expectedPermission)) throw Error("PROVIDER_EFFECTIVE_CONTROLS_UNVERIFIED");
  const agentVerified = !!recipe.agent && value.agent === recipe.agent && !!recipe.agentDefinition &&
    sha256(readFileSync(recipe.agentDefinition.path)) === recipe.agentDefinition.sha256 && recipe.argv.includes("--agent") && recipe.argv[recipe.argv.indexOf("--agent")+1] === recipe.agent;
  return { state: "verified", protocol: recipe.protocol, model: selection.model, cwd: recipe.cwd, tools: [],
    permission: recipe.protocol === "agy-stream" ? { state: "verified", value: recipe.expectedPermission } : { state: "unexposed", value: null },
    agent: agentVerified ? { state: "verified", value: recipe.agent! } : { state: "unexposed", value: null } };
}
const callCountSchema = z.union([z.literal(0), z.literal(1), z.null()]);
const safeIntegerSchema = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const processSchema = z.strictObject({
  pid: safeIntegerSchema.positive().nullable(), providerStarted: z.boolean().nullable(), exitCode: safeIntegerSchema.nullable(), signal: z.enum(DIAGNOSTIC_SIGNALS).nullable(),
  closed: z.boolean(), groupSettled: z.boolean(), trackedDescendantsSettled: z.boolean(), escapedDescendantObserved: z.boolean().nullable(),
  timersSettled: z.boolean(), parsingSettled: z.boolean(), processScansSettled: z.boolean(), inputDelivered: z.boolean().nullable(), stopRequested: z.boolean().nullable(),
  descendantEvidence: z.literal("observed process tree plus process group; prequalified no-escape controls required").nullable(),
});
export const providerReportSchema = z.strictObject({
  version: z.literal(PROVIDER_REPORT_VERSION), binding: bindingSchema, assignmentHash: z.string(), packetHash: z.string(), controlsHash: z.string(),
  status: z.enum(["completed", "failed", "cancelled"]), calls: callCountSchema, initializations: callCountSchema, error: z.enum(DIAGNOSTIC_CODES).nullable(),
  diagnostic: diagnosticSummarySchema,
  selectedAgent: z.strictObject({ requested: z.string().nullable(), observed: z.string().nullable(), source: z.enum(["Source-bound argv/definition; init agent identity not exposed", "Provider init agent field"]) }),
  result: pilotResultEnvelopeSchema.refine(value => pilotPayloadSchemas[value.phase].safeParse(value.payload).success).nullable(), conversationId: z.string().min(1).nullable(), init: providerInitializationSchema,
  cancellation: z.strictObject({ requestId: z.string(), binding: bindingSchema, acknowledged: z.literal(true),
    activeTurn: z.strictObject({ source: z.enum(["AGY original user_input DONE", "Cursor initialized original user event", "Codex original turn/start response"]), identity: z.string().min(1) }), at: safeIntegerSchema }).nullable(),
  process: processSchema, wrapperPid: safeIntegerSchema.positive().optional(),
});
export const preparedReportSchema = z.strictObject({ version: z.literal(PREPARED_REPORT_VERSION), assignmentHash: z.string(), ready: z.boolean(), initializations: callCountSchema,
  error: z.enum(DIAGNOSTIC_CODES).nullable(), diagnostic: diagnosticSummarySchema, init: providerInitializationSchema });
export type ProviderReport = z.infer<typeof providerReportSchema>;
export type PreparedReport = z.infer<typeof preparedReportSchema>;
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

/** Validate the artifact's version before inspecting its diagnostic contract. */
export function readPreparedReport(file: string, assignmentHash: string): PreparedReport {
  const value = readStrictFile(file);
  if (value?.version !== PREPARED_REPORT_VERSION) throw Error("WRAPPER_DIAGNOSTIC_VERSION_UNSUPPORTED");
  const prepared = preparedReportSchema.safeParse(value);
  if (!prepared.success || prepared.data.assignmentHash !== assignmentHash) throw Error("WRAPPER_RESULT_UNBOUND");
  return prepared.data;
}
