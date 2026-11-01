import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { canonicalJson } from "../../src/domain/hash.js";
import type { ProviderRecipe } from "../../src/pilot/wrapper-contract.js";
import {
  stableAgyRecipeInputs, encodeAgyInventoryWitness, decodeAgyInventoryWitness,
  bindAgyRecipeHash, assertInventoryProjection, type InventoryCore,
} from "../../src/pilot/agy-inventory-witness.js";

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const a = "a".repeat(64), b = "b".repeat(64);
const recipe = (): ProviderRecipe => ({ protocol: "agy-stream", executable: "/fixture/bin/agy",
  argv: ["--agent", "reviewer"], cwd: "/fixture/work", version: "synthetic-1",
  selection: { route: "antigravity", model: "synthetic-1", effort: "high" }, expectedPermission: "plan",
  agent: "reviewer", agentDefinition: { path: "/fixture/agent.md", sha256: a },
  materializations: [{ path: "/fixture/profile", content: "abc", sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", mode: 0o600 }],
  sources: [], facts: [],
});
function fixture(): InventoryCore {
  return { context: { requestingWorkspace: "/fixture/work", executionCwd: "/fixture/work", home: "/fixture/home",
    rawHome: "/fixture/home", repositoryBoundary: "/fixture", selectedAgent: "reviewer",
    environmentInputs: { PATH: "/fixture/bin:/usr/bin", HOME: "/fixture/home", TMPDIR: null, LANG: "C", LC_ALL: null, TERM: null, AGY_CLI_DISABLE_AUTO_UPDATE: "true" } },
    recipeInputs: stableAgyRecipeInputs(recipe()),
    loaderContract: { id: "synthetic-loader", semanticsDigest: a, evidenceDigests: [a, b], adapterRevision: "fixture-1", executable: { path: "/fixture/bin/agy", sha256: a } },
    inventory: { records: [{ path: "/fixture/disabled", role: "plugin", presence: "installed", enablement: "disabled", enablementOrigin: "/fixture/settings.json", selection: "excluded", sha256: a, problems: [] }],
      orderedEdges: [{ from: "/fixture/work", to: "/fixture/disabled", role: "plugin", ordinal: 0, declaringPath: null, resolutionBase: "/fixture", ruleIds: ["fixture"] }],
      rootListings: [{ path: "/fixture/plugins", entries: [{ name: "ordinary", type: "file" }], custody: { uid: 1, gid: 1, mode: 0o40700, dev: null, ino: null } }],
      absenceProbes: ["/fixture/missing"], sources: [{ path: "/fixture/disabled", kind: "file", sha256: a }, { path: "/fixture/disabled", kind: "metadata", sha256: b }],
      activeDescriptorOccurrences: [{ source: "/fixture/hooks.json", event: "PreToolUse", matcher: null, ordinal: 0, descriptorJson: '{"command":"true","type":"command"}' }],
      ordering: ["first", "second"], effects: ["existing-effect-digest"], unavailable: [], appliedRuleIds: ["fixture"], normalizationRuleIds: [] } };
}

// Catches lost recipe fields, borrowed mutable arrays, and leaked audit facts/sources.
it("normalizes optional recipe inputs to null without retaining unrelated fields or mutable inputs", () => {
  const input = recipe();
  const stable = stableAgyRecipeInputs(input);
  expect(stable.codexPolicy).toBeNull(); expect(stable.agyHookShell).toBeNull();
  expect(Object.keys(stable)).not.toContain("sources"); expect(Object.keys(stable)).not.toContain("facts");
  input.argv.push("changed"); input.materializations![0]!.content = "changed";
  expect(stable.argv).toEqual(["--agent", "reviewer"]); expect(stable.materializations[0]!.content).toBe("abc");
  const optional = recipe(); delete optional.agent; delete optional.agentDefinition; delete optional.materializations;
  optional.argv = [];
  expect(stableAgyRecipeInputs(optional)).toMatchObject({ agent: null, agentDefinition: null, materializations: [] });
});

// Independent preimages catch omitted fields, envelope hashing, wrong newline, and Q binding.
it("binds exact F, W and Q preimages and returns canonical immutable snapshots", () => {
  const core = fixture(), original = structuredClone(core);
  const encoded = encodeAgyInventoryWitness(core);
  const F = hash(canonicalJson(original));
  const bytes = Buffer.from(canonicalJson({ version: 1, fingerprint: F, core: original }) + "\n");
  expect(encoded.fingerprint).toBe(F); expect(Buffer.from(encoded.bytes)).toEqual(bytes); expect(encoded.sha256).toBe(hash(bytes));
  expect(bindAgyRecipeHash(core)).toBe(hash(canonicalJson({ recipeInputs: original.recipeInputs, inventoryFingerprint: F, inventoryContext: original.context })));
  expect(decodeAgyInventoryWitness(encoded.bytes)).toEqual(original);
  core.recipeInputs.argv.push("changed"); expect(decodeAgyInventoryWitness(encoded.bytes)).toEqual(original);
  const reordered = Object.fromEntries(Object.entries(original).reverse()) as InventoryCore;
  expect(encodeAgyInventoryWitness(reordered)).toEqual(encoded);
});

// Each semantic input must change identity or be refused; no qualification is implied.
const mutations: [string, (c: InventoryCore) => void][] = [
  ["workspace", c => { c.context.requestingWorkspace = "/elsewhere"; }],
  ["cwd", c => { c.context.executionCwd = "/elsewhere"; }],
  ["home", c => { c.context.home = "/elsewhere"; }],
  ["raw home", c => { c.context.rawHome = null; }],
  ["boundary", c => { c.context.repositoryBoundary = null; }],
  ["agent", c => { c.context.selectedAgent = null; }],
  ...["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TERM", "AGY_CLI_DISABLE_AUTO_UPDATE"].map(key => [key, (c: InventoryCore) => { c.context.environmentInputs[key] = c.context.environmentInputs[key] === null ? "present" : null; }] as [string, (c: InventoryCore) => void]),
  ["executable bytes", c => { c.loaderContract.executable.sha256 = b; }],
  ["contract", c => { c.loaderContract.semanticsDigest = b; }],
  ["evidence", c => { c.loaderContract.evidenceDigests = [b]; }],
  ["disabled metadata", c => { c.inventory.records = [{ ...c.inventory.records[0]!, enablementOrigin: null }]; }],
  ["argv", c => { c.recipeInputs.argv.push("--other"); }],
  ["version", c => { c.recipeInputs.version = "fixture-2"; }],
  ["permission", c => { c.recipeInputs.expectedPermission = "accept-edits"; }],
  ["selection", c => { c.recipeInputs.selection.model = "synthetic-2"; }],
  ["material content", c => { c.recipeInputs.materializations[0]!.content = "def"; }],
  ["material mode", c => { c.recipeInputs.materializations[0]!.mode = 0o400; }],
  ["definition", c => { c.recipeInputs.agentDefinition!.sha256 = b; }],
  ["policy", c => { c.recipeInputs.codexPolicy = { name: "fixture", filesystem: { "/fixture": "read" }, featureKeys: [] }; }],
  ["loader ordering", c => { c.inventory.ordering = ["second", "first"]; }],
  ["source ordering", c => { c.inventory.sources = [...c.inventory.sources].reverse(); }],
];
it.each(mutations)("binds %s", (_name, mutate) => {
  const core = fixture(), before = encodeAgyInventoryWitness(core).fingerprint; mutate(core);
  try { expect(encodeAgyInventoryWitness(core).fingerprint).not.toBe(before); }
  catch (error) { if (error instanceof Error && error.name === "AssertionError") throw error; }
});

it("preserves edge and descriptor occurrence multiplicity and their order", () => {
  const core = fixture(), before = encodeAgyInventoryWitness(core).fingerprint;
  core.inventory.orderedEdges = [...core.inventory.orderedEdges, { ...core.inventory.orderedEdges[0]!, ordinal: 1 }];
  core.inventory.activeDescriptorOccurrences = [...core.inventory.activeDescriptorOccurrences, core.inventory.activeDescriptorOccurrences[0]!];
  const encoded = encodeAgyInventoryWitness(core), decoded = decodeAgyInventoryWitness(encoded.bytes);
  expect(encoded.fingerprint).not.toBe(before); expect(decoded.inventory.orderedEdges).toHaveLength(2); expect(decoded.inventory.activeDescriptorOccurrences).toHaveLength(2);
  expect(decoded.inventory.effects).toEqual(["existing-effect-digest"]);
  core.inventory.orderedEdges = [...core.inventory.orderedEdges].reverse();
  expect(encodeAgyInventoryWitness(core).fingerprint).not.toBe(encoded.fingerprint);
});

const invalid: [string, (c: any) => void][] = [
  ...[[], ["context"], ["context", "environmentInputs"], ["recipeInputs"], ["recipeInputs", "selection"], ["recipeInputs", "agentDefinition"], ["recipeInputs", "materializations", 0], ["loaderContract"], ["loaderContract", "executable"], ["inventory"], ["inventory", "records", 0], ["inventory", "orderedEdges", 0], ["inventory", "rootListings", 0], ["inventory", "rootListings", 0, "entries", 0], ["inventory", "rootListings", 0, "custody"], ["inventory", "sources", 0], ["inventory", "activeDescriptorOccurrences", 0]].map(keys => ["extra " + keys.join("."), (c: any) => { let at = c; for (const key of keys) at = at[key]; at.extra = true; }] as [string, (c: any) => void]),
  ["bad hash", c => { c.loaderContract.semanticsDigest = "BAD"; }],
  ["relative identity", c => { c.inventory.sources[0].path = "relative"; }],
  ["relative material", c => { c.recipeInputs.materializations[0].path = "relative"; }],
  ["null type", c => { c.context.selectedAgent = 42; }],
  ["material digest", c => { c.recipeInputs.materializations[0].sha256 = a; }],
  ["route", c => { c.recipeInputs.selection.route = "codex"; }],
  ["protocol", c => { c.recipeInputs.protocol = "codex-app-server"; }],
  ["executable mismatch", c => { c.recipeInputs.executable = "/other/agy"; }],
  ["agent argv", c => { c.recipeInputs.argv = []; }],
  ["missing environment absence", c => { delete c.context.environmentInputs.TERM; }],
  ["credential", c => { c.context.environmentInputs.API_KEY = "unrelated"; }],
  ["descriptor whitespace", c => { c.inventory.activeDescriptorOccurrences[0].descriptorJson = '{ "type":"command","command":"true"}'; }],
  ["descriptor duplicate key", c => { c.inventory.activeDescriptorOccurrences[0].descriptorJson = '{"type":"command","type":"command"}'; }],
  ["duplicate record", c => { c.inventory.records.push(c.inventory.records[0]); }],
  ["duplicate source", c => { c.inventory.sources.push(c.inventory.sources[0]); }],
  ["conflicting source", c => { c.inventory.sources.push({ ...c.inventory.sources[0], sha256: b }); }],
  ["duplicate listing", c => { c.inventory.rootListings.push(c.inventory.rootListings[0]); }],
];
it.each(invalid)("rejects %s", (_name, mutate) => { const core = fixture(); mutate(core); expect(() => encodeAgyInventoryWitness(core)).toThrow(); });

it("rejects noncanonical bytes, duplicate keys, changed F, oversized and deeply nested envelopes", () => {
  const encoded = encodeAgyInventoryWitness(fixture()), text = Buffer.from(encoded.bytes).toString();
  for (const bad of [text.trim(), " " + text, text.replace('"version":1', '"version":1,"version":1'), text.replace(encoded.fingerprint, b), "[".repeat(65) + "0" + "]".repeat(65), " ".repeat(1048577)]) {
    expect(() => decodeAgyInventoryWitness(Buffer.from(bad))).toThrow();
  }
  const core = fixture(); core.inventory.unavailable = ["x".repeat(1048576)];
  expect(() => encodeAgyInventoryWitness(core)).toThrow();
});

it("requires the exact ordered source projection and refuses duplicate inputs on either side", () => {
  const sources = fixture().inventory.sources;
  expect(() => assertInventoryProjection(sources, structuredClone(sources))).not.toThrow();
  for (const actual of [[], [...sources].reverse(), [...sources, { path: "/extra", kind: "file" as const, sha256: a }], [{ ...sources[0]!, path: "/relocated" }, sources[1]!], [{ ...sources[0]!, kind: "absent" as const }, sources[1]!], [{ ...sources[0]!, sha256: b }, sources[1]!], [...sources, sources[0]!]]) {
    expect(() => assertInventoryProjection(actual, sources)).toThrow();
  }
  expect(() => assertInventoryProjection(sources, [...sources, sources[0]!])).toThrow();
});

it("round-trips unknown decisions without inventing a verified fact", () => {
  const core = fixture(); core.inventory.records = [{ ...core.inventory.records[0]!, presence: "unknown", selection: "unknown" }];
  core.inventory.unavailable = ["synthetic incomplete decision"];
  const result = decodeAgyInventoryWitness(encodeAgyInventoryWitness(core).bytes);
  expect(result.inventory.unavailable).toEqual(["synthetic incomplete decision"]); expect(Object.keys(result).sort()).toEqual(["context", "inventory", "loaderContract", "recipeInputs"]);
});

it("preserves materialization, descriptor, evidence and rule ordering", () => {
  const core = fixture();
  core.recipeInputs.materializations.push({ ...core.recipeInputs.materializations[0]!, path: "/fixture/second" });
  core.inventory.activeDescriptorOccurrences = [...core.inventory.activeDescriptorOccurrences, { ...core.inventory.activeDescriptorOccurrences[0]!, event: "PostToolUse", ordinal: 1 }];
  core.inventory.appliedRuleIds = ["a", "b"];
  const F = encodeAgyInventoryWitness(core).fingerprint;
  const variants = [structuredClone(core), structuredClone(core), structuredClone(core), structuredClone(core)];
  variants[0]!.recipeInputs.materializations.reverse();
  variants[1]!.inventory.activeDescriptorOccurrences = [...core.inventory.activeDescriptorOccurrences].reverse();
  variants[2]!.loaderContract.evidenceDigests = [...core.loaderContract.evidenceDigests].reverse();
  variants[3]!.inventory.appliedRuleIds = ["b", "a"];
  for (const variant of variants) expect(encodeAgyInventoryWitness(variant).fingerprint).not.toBe(F);
});

function withHook(): InventoryCore {
  const core = fixture();
  const metadata = { dev: 1, ino: 2, uid: 1, gid: 1, mode: 0o100600, type: "file" as const };
  core.recipeInputs.agyHookShell = { version: 1, contract: "agy-orca-hook-v1", route: "antigravity",
    workspace: "/fixture/work", executionCwd: "/fixture/work", executable: "/fixture/bin/agy", providerVersion: "synthetic-1", basePath: "/usr/bin:/bin",
    uid: 1, gid: 1, node: "/fixture/node", installed: "/fixture/hook", hookContent: "inert", templateHash: a,
    descriptors: Array.from({ length: 5 }, () => ({ type: "command", command: "inert", timeout: 10 })),
    identities: Array.from({ length: 10 }, (_, i) => ({ path: "/fixture/source" + i, realpath: "/fixture/source" + i, entry: { ...metadata }, target: { ...metadata }, sha256: a })),
    startupDirectories: [{ path: "/fixture/startup", metadata: { ...metadata, type: "directory" }, entries: [] }], absences: ["/fixture/absent"],
    environment: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", DEVELOPER_DIR: "/Library/Developer/CommandLineTools", PYTHONNOUSERSITE: "1", PYTHONDONTWRITEBYTECODE: "1", __CF_USER_TEXT_ENCODING: "0x1:0:0" } };
  core.recipeInputs.codexPolicy = { name: "retained-input", filesystem: { "/fixture": "read" }, featureKeys: ["one"] };
  core.inventory.records = [{ ...core.inventory.records[0]!, problems: [{ code: "unknown", path: "/fixture/problem", edge: null }] }];
  return core;
}

it("binds the optional static hook policy without qualifying PATH transformation or membership", () => {
  const core = withHook(), F = encodeAgyInventoryWitness(core).fingerprint;
  expect(decodeAgyInventoryWitness(encodeAgyInventoryWitness(core).bytes)).toEqual(core);
  core.recipeInputs.agyHookShell!.basePath = "/other";
  expect(encodeAgyInventoryWitness(core).fingerprint).not.toBe(F);
});

it.each([
  ["recipeInputs", "codexPolicy"], ["recipeInputs", "agyHookShell"],
  ["recipeInputs", "agyHookShell", "descriptors", 0], ["recipeInputs", "agyHookShell", "identities", 0],
  ["recipeInputs", "agyHookShell", "identities", 0, "entry"], ["recipeInputs", "agyHookShell", "identities", 0, "target"],
  ["recipeInputs", "agyHookShell", "startupDirectories", 0], ["recipeInputs", "agyHookShell", "startupDirectories", 0, "metadata"],
  ["recipeInputs", "agyHookShell", "environment"], ["inventory", "records", 0, "problems", 0],
])("rejects unknown fields in optional nested record %j", (...keys) => {
  const core = withHook(); let at: any = core;
  for (const key of keys) at = at[key];
  at.extra = true;
  expect(() => encodeAgyInventoryWitness(core)).toThrow();
});

it("refuses inconsistent and relative static hook identities", () => {
  for (const key of ["workspace", "executionCwd", "executable", "providerVersion", "installed", "node"] as const) {
    const core = withHook(); core.recipeInputs.agyHookShell![key] = "relative";
    expect(() => encodeAgyInventoryWitness(core)).toThrow();
  }
});

it("preserves absence and null digest meanings", () => {
  const core = fixture();
  core.inventory.sources = [{ path: "/fixture/missing", kind: "absent", sha256: null }];
  core.inventory.records = [{ ...core.inventory.records[0]!, presence: "absent", sha256: null }];
  expect(decodeAgyInventoryWitness(encodeAgyInventoryWitness(core).bytes).inventory.sources).toEqual(core.inventory.sources);
});

it.each(["source", "record"])("rejects an absence %s with a content digest", kind => {
  const core = fixture();
  if (kind === "source") core.inventory.sources = [{ path: "/fixture/missing", kind: "absent", sha256: a }];
  else core.inventory.records = [{ ...core.inventory.records[0]!, presence: "absent", sha256: a }];
  expect(() => encodeAgyInventoryWitness(core)).toThrow();
});

it("accepts an envelope at exactly one MiB and rejects the first excess byte", () => {
  const core = fixture(); core.inventory.unavailable = [""];
  const overhead = encodeAgyInventoryWitness(core).bytes.length;
  core.inventory.unavailable = ["x".repeat(1048576 - overhead)];
  const encoded = encodeAgyInventoryWitness(core);
  expect(encoded.bytes.length).toBe(1048576);
  expect(decodeAgyInventoryWitness(encoded.bytes).inventory.unavailable[0]!.length).toBe(1048576 - overhead);
  core.inventory.unavailable = ["x".repeat(1048577 - overhead)];
  expect(() => encodeAgyInventoryWitness(core)).toThrow();
});

it("rejects envelope extras and invalid UTF-8 without weakening strict JSON", () => {
  const encoded = encodeAgyInventoryWitness(fixture());
  const envelope = JSON.parse(Buffer.from(encoded.bytes).toString()); envelope.complete = true;
  expect(() => decodeAgyInventoryWitness(Buffer.from(canonicalJson(envelope) + "\n"))).toThrow();
  expect(() => decodeAgyInventoryWitness(new Uint8Array([0xff]))).toThrow();
});

it.each(["paths", "ancestors"])("refuses inventory identities beyond the %s ceiling", kind => {
  const core = fixture();
  core.inventory.absenceProbes = kind === "paths" ? Array.from({ length: 1001 }, (_, i) => "/fixture/missing-" + i)
    : ["/" + Array.from({ length: 129 }, () => "a").join("/")];
  expect(() => encodeAgyInventoryWitness(core)).toThrow();
});

it("compares explicit and omitted source kinds exactly", () => {
  const file = { path: "/fixture/ordinary", kind: "file" as const, sha256: a };
  expect(() => assertInventoryProjection([{ ...file, kind: "metadata" }], [file])).toThrow();
  expect(() => assertInventoryProjection([{ path: file.path, sha256: a }], [file])).toThrow();
});

it.each(["loader", "source", "hook template", "hook identity"])("rejects a trailing newline in the %s hash", field => {
  const core = withHook(), invalidHash = a + "\n";
  if (field === "loader") core.loaderContract.semanticsDigest = invalidHash;
  if (field === "source") core.inventory.sources = [{ ...core.inventory.sources[0]!, sha256: invalidHash }];
  if (field === "hook template") core.recipeInputs.agyHookShell!.templateHash = invalidHash;
  if (field === "hook identity") core.recipeInputs.agyHookShell!.identities[0]!.sha256 = invalidHash;
  expect(() => encodeAgyInventoryWitness(core)).toThrow();
});
