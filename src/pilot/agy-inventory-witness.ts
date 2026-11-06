import { isAbsolute, join, normalize, sep } from "node:path";
import { z } from "zod";
import { canonicalJson } from "../domain/hash.js";
import { decodeStrictJson } from "../workers/strict-json.js";
import { recipeSchema, agyHookShellPolicySchema, sha256, type ProviderRecipe } from "./wrapper-contract.js";
import { selectionSchema } from "./config.js";
import type { AuditSource } from "./control-audit.js";
import type { DirectoryListing, InventoryProblem } from "./inventory-io.js";

export type AgyRecipeInputs = Pick<ProviderRecipe, "protocol" | "executable" | "argv" |
  "cwd" | "version" | "selection" | "expectedPermission"> & {
  agent: string | null; agentDefinition: ProviderRecipe["agentDefinition"] | null;
  materializations: NonNullable<ProviderRecipe["materializations"]>;
  codexPolicy: ProviderRecipe["codexPolicy"] | null;
  agyHookShell: ProviderRecipe["agyHookShell"] | null;
};
export type AgyInventoryContext = { requestingWorkspace: string; executionCwd: string;
  home: string; rawHome: string | null; repositoryBoundary: string | null;
  selectedAgent: string | null; environmentInputs: Record<string, string | null> };
export type LoaderBinding = { id: string; semanticsDigest: string; evidenceDigests: readonly string[];
  adapterRevision: string; executable: { path: string; sha256: string } };
export type InventoryRecord = { path: string; role: string; presence: "installed" | "absent" | "unknown";
  enablement: "enabled" | "disabled" | "unknown" | "not-applicable"; enablementOrigin: string | null;
  selection: "selected" | "excluded" | "shadowed" | "unknown"; sha256: string | null;
  problems: readonly InventoryProblem[] };
export type DiscoveryEdge = { from: string; to: string; role: string; ordinal: number;
  declaringPath: string | null; resolutionBase: string | null; ruleIds: readonly string[] };
export type InventoryCore = { context: AgyInventoryContext; recipeInputs: AgyRecipeInputs;
  loaderContract: LoaderBinding; inventory: {
    records: readonly InventoryRecord[]; orderedEdges: readonly DiscoveryEdge[];
    rootListings: readonly { path: string; entries: DirectoryListing["entries"];
      custody: { uid: number; gid: number; mode: number; dev: number | null; ino: number | null } }[];
    absenceProbes: readonly string[]; sources: readonly AuditSource[];
    activeDescriptorOccurrences: readonly { source: string; event: string; matcher: string | null;
      ordinal: number; descriptorJson: string }[];
    ordering: readonly string[]; effects: readonly string[]; unavailable: readonly string[];
    appliedRuleIds: readonly string[]; normalizationRuleIds: readonly string[];
  } };
export type EncodedWitness = { fingerprint: string; bytes: Uint8Array; sha256: string };

const MAX_BYTES = 1048576;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const absolute = z.string().refine(value => isAbsolute(value) && normalize(value) === value &&
  !value.includes("\0") && value.split(sep).filter(Boolean).length <= 128, "INVENTORY_ABSOLUTE_PATH");
const natural = z.number().int().nonnegative().safe();
const strings = z.array(z.string());
const environmentSchema = z.strictObject({
  PATH: z.string().nullable(), HOME: z.string().nullable(), TMPDIR: z.string().nullable(),
  LANG: z.string().nullable(), LC_ALL: z.string().nullable(), TERM: z.string().nullable(),
  AGY_CLI_DISABLE_AUTO_UPDATE: z.literal("true"),
});
const sourceSchema = z.strictObject({
  path: absolute, kind: z.enum(["file", "metadata", "absent"]).optional(), sha256: hash.nullable(),
}).refine(source => source.kind !== "absent" || source.sha256 === null, "INVENTORY_ABSENCE_DIGEST_MISMATCH");
const recipeInputsSchema = z.strictObject({
  protocol: z.literal("agy-stream"), executable: absolute, argv: strings, cwd: absolute,
  version: z.string(), selection: selectionSchema, expectedPermission: z.string(),
  agent: z.string().nullable(),
  agentDefinition: z.strictObject({ path: absolute, sha256: hash }).nullable(),
  materializations: z.array(z.strictObject({ path: absolute, content: z.string(), sha256: hash,
    mode: z.union([z.literal(0o400), z.literal(0o500), z.literal(0o600)]).optional() })),
  codexPolicy: z.strictObject({ name: z.string(), filesystem: z.record(absolute, z.enum(["read", "deny"])), featureKeys: strings }).nullable(),
  agyHookShell: agyHookShellPolicySchema.nullable(),
});
const coreSchema = z.strictObject({
  context: z.strictObject({
    requestingWorkspace: absolute, executionCwd: absolute, home: absolute,
    rawHome: z.string().nullable(), repositoryBoundary: absolute.nullable(),
    selectedAgent: z.string().nullable(), environmentInputs: environmentSchema,
  }),
  recipeInputs: recipeInputsSchema,
  loaderContract: z.strictObject({
    id: z.string().min(1), semanticsDigest: hash, evidenceDigests: z.array(hash),
    adapterRevision: z.string().min(1), executable: z.strictObject({ path: absolute, sha256: hash }),
  }),
  inventory: z.strictObject({
    records: z.array(z.strictObject({
      path: absolute, role: z.string(), presence: z.enum(["installed", "absent", "unknown"]),
      enablement: z.enum(["enabled", "disabled", "unknown", "not-applicable"]),
      enablementOrigin: absolute.nullable(),
      selection: z.enum(["selected", "excluded", "shadowed", "unknown"]), sha256: hash.nullable(),
      problems: z.array(z.strictObject({ code: z.string(), path: absolute, edge: z.string().nullable() })),
    }).refine(record => record.presence !== "absent" || record.sha256 === null, "INVENTORY_ABSENCE_DIGEST_MISMATCH")),
    orderedEdges: z.array(z.strictObject({
      from: absolute, to: absolute, role: z.string(), ordinal: natural,
      declaringPath: absolute.nullable(), resolutionBase: absolute.nullable(), ruleIds: strings,
    })),
    rootListings: z.array(z.strictObject({
      path: absolute,
      entries: z.array(z.strictObject({
        name: z.string().refine(name => !!name && name !== "." && name !== ".." && !/[\0/]/.test(name)),
        type: z.enum(["file", "directory", "symlink", "other"]),
      })).max(100),
      custody: z.strictObject({ uid: natural, gid: natural, mode: natural, dev: natural.nullable(), ino: natural.nullable() }),
    })),
    absenceProbes: z.array(absolute), sources: z.array(sourceSchema),
    activeDescriptorOccurrences: z.array(z.strictObject({
      source: absolute, event: z.string(), matcher: z.string().nullable(), ordinal: natural, descriptorJson: z.string(),
    })),
    ordering: strings, effects: strings, unavailable: strings, appliedRuleIds: strings, normalizationRuleIds: strings,
  }),
});
const envelopeSchema = z.strictObject({ version: z.literal(1), fingerprint: hash, core: coreSchema });

function requireValue(ok: unknown, reason: string): asserts ok { if (!ok) throw Error(reason); }

/** This witness limit does not change the generic decoder's 128-level contract. */
function guardText(text: string): void {
  let depth = 0, quoted = false, escaped = false;
  for (const ch of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === "{" || ch === "[") requireValue(++depth <= 64, "INVENTORY_JSON_DEPTH");
    else if (ch === "}" || ch === "]") depth--;
  }
}

function copyJson(value: unknown): unknown {
  const stack: { value: unknown; depth: number; exit?: boolean }[] = [{ value, depth: 0 }];
  const ancestors = new Set<object>();
  while (stack.length) {
    const item = stack.pop()!;
    if (item.value === null || typeof item.value !== "object") continue;
    if (item.exit) { ancestors.delete(item.value); continue; }
    requireValue(item.depth < 64 && !ancestors.has(item.value), "INVENTORY_JSON_DEPTH_OR_CYCLE");
    ancestors.add(item.value); stack.push({ ...item, exit: true });
    for (const key of Object.getOwnPropertyNames(item.value)) {
      const descriptor = Object.getOwnPropertyDescriptor(item.value, key)!;
      requireValue("value" in descriptor, "INVENTORY_JSON_ACCESSOR");
      stack.push({ value: descriptor.value, depth: item.depth + 1 });
    }
  }
  const text = canonicalJson(value);
  requireValue(Buffer.byteLength(text) <= MAX_BYTES, "INVENTORY_WITNESS_BYTE_LIMIT");
  return decodeStrictJson(text);
}

function unique<T>(items: readonly T[], key: (item: T) => string): void {
  const seen = new Set<string>();
  for (const item of items) {
    const id = key(item);
    requireValue(!seen.has(id), "INVENTORY_DUPLICATE_RECORD");
    seen.add(id);
  }
}
function sourceKey(source: AuditSource): string { return canonicalJson([source.path, source.kind ?? "file"]); }

function validateCore(value: unknown): InventoryCore {
  const core = coreSchema.parse(value);
  const { context, recipeInputs: recipe, loaderContract, inventory } = core;
  requireValue(recipe.selection.route === "antigravity" && recipe.cwd === context.executionCwd &&
    recipe.executable === loaderContract.executable.path && recipe.agent === context.selectedAgent &&
    context.environmentInputs.HOME === context.rawHome, "INVENTORY_CONTEXT_RECIPE_MISMATCH");
  requireValue((recipe.agent === null) === (recipe.agentDefinition === null), "INVENTORY_AGENT_DEFINITION_MISMATCH");
  const agents = recipe.argv.flatMap((arg, i) => arg === "--agent" ? [recipe.argv[i + 1]] : []);
  requireValue(!recipe.argv.some(arg => arg.startsWith("--agent=")), "INVENTORY_AGENT_ARGV_MISMATCH");
  requireValue(recipe.agent === null ? agents.length === 0 : agents.length === 1 && agents[0] === recipe.agent, "INVENTORY_AGENT_ARGV_MISMATCH");
  for (const material of recipe.materializations) requireValue(sha256(material.content) === material.sha256, "INVENTORY_MATERIAL_DIGEST_MISMATCH");
  unique(recipe.materializations, item => item.path);
  const identities = [context.requestingWorkspace, context.executionCwd, context.home,
    ...[context.repositoryBoundary, recipe.agentDefinition?.path].filter((path): path is string => typeof path === "string"),
    recipe.executable, recipe.cwd, loaderContract.executable.path,
    ...recipe.materializations.map(item => item.path), ...Object.keys(recipe.codexPolicy?.filesystem ?? {}),
    ...inventory.records.flatMap(item => [item.path, ...(item.enablementOrigin === null ? [] : [item.enablementOrigin]), ...item.problems.map(problem => problem.path)]),
    ...inventory.orderedEdges.flatMap(edge => [edge.from, edge.to, ...[edge.declaringPath, edge.resolutionBase].filter((path): path is string => path !== null)]),
    ...inventory.rootListings.flatMap(listing => [listing.path, ...listing.entries.map(entry => join(listing.path, entry.name))]),
    ...inventory.absenceProbes, ...inventory.sources.map(source => source.path),
    ...inventory.activeDescriptorOccurrences.map(occurrence => occurrence.source)];
  const hook = recipe.agyHookShell;
  if (hook) {
    requireValue(hook.workspace === context.requestingWorkspace && hook.executionCwd === context.executionCwd &&
      hook.executable === recipe.executable && hook.providerVersion === recipe.version, "INVENTORY_HOOK_RECIPE_MISMATCH");
    const hookPaths = [hook.workspace, hook.executionCwd, hook.executable, hook.node, hook.installed, ...hook.absences,
      ...hook.identities.flatMap(source => [source.path, source.realpath]), ...hook.startupDirectories.map(directory => directory.path)];
    for (const path of hookPaths) absolute.parse(path);
    identities.push(...hookPaths);
  }
  requireValue(new Set(identities).size <= 1000, "INVENTORY_PATH_LIMIT");
  unique(inventory.records, item => canonicalJson([item.path, item.role]));
  unique(inventory.sources, sourceKey);
  unique(inventory.rootListings, item => item.path);
  unique(inventory.absenceProbes, item => item);
  for (const listing of inventory.rootListings) unique(listing.entries, entry => entry.name);
  for (const occurrence of inventory.activeDescriptorOccurrences) {
    guardText(occurrence.descriptorJson);
    const descriptor = decodeStrictJson(occurrence.descriptorJson);
    requireValue(descriptor !== null && typeof descriptor === "object" && !Array.isArray(descriptor) &&
      canonicalJson(descriptor) === occurrence.descriptorJson, "INVENTORY_DESCRIPTOR_NONCANONICAL");
  }
  return core;
}

export function stableAgyRecipeInputs(recipe: ProviderRecipe): AgyRecipeInputs {
  const parsed = recipeSchema.parse(copyJson(recipe));
  const result = recipeInputsSchema.parse({
    protocol: parsed.protocol, executable: parsed.executable, argv: parsed.argv,
    cwd: parsed.cwd, version: parsed.version, selection: parsed.selection, expectedPermission: parsed.expectedPermission,
    agent: parsed.agent ?? null, agentDefinition: parsed.agentDefinition ?? null,
    materializations: parsed.materializations ?? [], codexPolicy: parsed.codexPolicy ?? null, agyHookShell: parsed.agyHookShell ?? null,
  });
  for (const material of result.materializations) requireValue(sha256(material.content) === material.sha256, "INVENTORY_MATERIAL_DIGEST_MISMATCH");
  return result;
}

export function encodeAgyInventoryWitness(input: InventoryCore): EncodedWitness {
  const core = validateCore(copyJson(input));
  const fingerprint = sha256(canonicalJson(core));
  const bytes = Buffer.from(canonicalJson({ version: 1, fingerprint, core }) + "\n", "utf8");
  requireValue(bytes.length <= MAX_BYTES, "INVENTORY_WITNESS_BYTE_LIMIT");
  guardText(bytes.toString("utf8"));
  return { fingerprint, bytes, sha256: sha256(bytes) };
}

export function decodeAgyInventoryWitness(input: Uint8Array): InventoryCore {
  requireValue(input.byteLength <= MAX_BYTES, "INVENTORY_WITNESS_BYTE_LIMIT");
  const bytes = Buffer.from(input);
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  guardText(text);
  const envelope = envelopeSchema.parse(decodeStrictJson(text));
  const core = validateCore(envelope.core);
  requireValue(envelope.fingerprint === sha256(canonicalJson(core)), "INVENTORY_FINGERPRINT_MISMATCH");
  requireValue(text === canonicalJson({ version: 1, fingerprint: envelope.fingerprint, core }) + "\n", "INVENTORY_NONCANONICAL_BYTES");
  return core;
}

export function bindAgyRecipeHash(core: InventoryCore): string {
  const encoded = encodeAgyInventoryWitness(core);
  const snapshot = decodeAgyInventoryWitness(encoded.bytes);
  return sha256(canonicalJson({ recipeInputs: snapshot.recipeInputs, inventoryFingerprint: encoded.fingerprint, inventoryContext: snapshot.context }));
}

export function assertInventoryProjection(actual: readonly AuditSource[], expected: readonly AuditSource[]): void {
  const a = z.array(sourceSchema).parse(copyJson(actual)), e = z.array(sourceSchema).parse(copyJson(expected));
  unique(a, sourceKey); unique(e, sourceKey);
  requireValue(canonicalJson(a) === canonicalJson(e), "INVENTORY_SOURCE_PROJECTION_MISMATCH");
}
