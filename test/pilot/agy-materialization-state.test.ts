import fs from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgyRecipeInputs } from "../../src/pilot/agy-inventory-witness.js";
import { inspectAgyMaterializationState } from "../../src/pilot/agy-materialization-state.js";

// Only syscall faults are doubled; listings, payloads and receipts remain real.
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof fs & { default: typeof fs }>();
  return { ...actual, default: { ...actual.default } };
});
let workspace: string;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const budget = () => ({ paths: new Set<string>(), jsonBytes: 0 });
const session = '{"allowNonWorkspaceAccess":false,"permissions":{"deny":["write_file(*)","command(*)","read_url(*)","execute_url(*)","mcp(*)"]}}';
const agent = "---\nname: council-packet\ntools: []\n---\nRead the supplied packet only.\n";
function inputs(): AgyRecipeInputs {
  const cwd = join(workspace, ".council/native-packets");
  const agentPath = join(cwd, ".agents/agents/council-packet/agent.md");
  return { protocol: "agy-stream", executable: join(workspace, "inert-agy"), argv: [], cwd,
    version: "fixture", selection: { route: "antigravity", model: "fixture", effort: "high" },
    expectedPermission: "plan", agent: "council-packet",
    agentDefinition: { path: agentPath, sha256: digest(agent) },
    materializations: [{ path: agentPath, content: agent, sha256: digest(agent) },
      { path: join(cwd, ".council-profiles", digest(session), "session-settings.json"), content: session, sha256: digest(session) }],
    codexPolicy: null, agyHookShell: null };
}
function install(recipe = inputs(), indexes = [0, 1]) {
  for (const index of indexes) {
    const material = recipe.materializations[index]!;
    fs.mkdirSync(dirname(material.path), { recursive: true, mode: 0o700 });
    fs.writeFileSync(material.path, material.content, { mode: material.mode ?? 0o600, flag: "wx" });
  }
  return recipe;
}
function expectedParents(recipe = inputs()) {
  // Independently enumerated; do not derive expected coverage with production code.
  return [workspace, join(workspace, ".council"), recipe.cwd,
    join(recipe.cwd, ".agents"), join(recipe.cwd, ".agents/agents"),
    join(recipe.cwd, ".agents/agents/council-packet"), join(recipe.cwd, ".council-profiles"),
    join(recipe.cwd, ".council-profiles", digest(session))].sort();
}
function inspect(recipe = inputs()) { return inspectAgyMaterializationState(workspace, recipe, budget()); }
beforeEach(() => { workspace = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "task-4-materialization-"))); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(workspace, { recursive: true, force: true }); });

// Breaks caught: conflating partial/absent/complete, omitted parents and invented identities.
it("reports all absent with every exact missing directory and its verified parents", () => {
  const result = inspect();
  expect(result.state).toBe("absent");
  expect(result.directoryObservations.map(item => item.path)).toEqual(expectedParents());
  for (const item of result.directoryObservations) {
    if (item.path === workspace) {
      expect(item.observation).toMatchObject({ state: "present", value: { entries: [] } });
    } else {
      expect(item.observation).toMatchObject({ state: "absent", path: item.path });
      if (item.observation.state !== "absent") throw Error("expected absence");
      expect(item.observation.verifiedParents.at(-1)?.path).toBe(workspace);
      expect(item.observation.verifiedParents.every(parent => parent.identity.type === "directory")).toBe(true);
    }
  }
  expect(fs.readdirSync(workspace)).toEqual([]);
});

it("reports the complete byte-identical static set with real receipts and exact parent coverage", () => {
  const recipe = install(), result = inspect(recipe);
  expect(result.state).toBe("complete");
  expect(result.directoryObservations.map(item => item.path)).toEqual(expectedParents(recipe));
  if (result.state === "unknown") throw Error("expected complete");
  expect(result.receipts.filter(receipt => receipt.before.type === "file").map(receipt => receipt.path).sort())
    .toEqual(recipe.materializations.map(material => material.path).sort());
  for (const receipt of result.receipts) {
    expect(receipt.before).toEqual(receipt.after);
    expect(receipt.before.ino).toBeGreaterThan(0);
  }
  expect(result).not.toHaveProperty("normalizationRuleIds");
  expect(result).not.toHaveProperty("loaderContract");
});

it.each([0, 1])("rejects a partial set with only material %i without repairing missing files", index => {
  const recipe = install(inputs(), [index]), result = inspect(recipe);
  expect(result.state).toBe("unknown");
  expect(result.directoryObservations.map(item => item.path)).toEqual(expectedParents(recipe));
  expect(fs.existsSync(recipe.materializations[1 - index]!.path)).toBe(false);
});

// Breaks caught: prefix exclusions, dropping siblings, and treating missing as empty.
it("preserves ordinary siblings and other profile names in every shared parent", () => {
  const recipe = install();
  const shared = [workspace, join(workspace, ".council"), recipe.cwd,
    join(recipe.cwd, ".agents"), join(recipe.cwd, ".agents/agents"), join(recipe.cwd, ".council-profiles")];
  for (const parent of shared) {
    fs.writeFileSync(join(parent, "ordinary-no-extension"), "sibling");
    fs.mkdirSync(join(parent, "agy-hook-ordinary"));
    fs.symlinkSync(recipe.materializations[0]!.path, join(parent, "another-edge"));
  }
  const result = inspect(recipe);
  expect(result.state).toBe("complete");
  for (const parent of shared) {
    const read = result.directoryObservations.find(item => item.path === parent)!.observation;
    expect(read.state).toBe("present");
    if (read.state !== "present") throw Error("expected full listing");
    expect(read.value.entries).toEqual(expect.arrayContaining([
      { name: "ordinary-no-extension", type: "file" }, { name: "agy-hook-ordinary", type: "directory" },
      { name: "another-edge", type: "symlink" },
    ]));
  }
});

it("preserves empty existing managed leaves while both static files are absent", () => {
  const recipe = inputs();
  for (const material of recipe.materializations) fs.mkdirSync(dirname(material.path), { recursive: true, mode: 0o700 });
  const result = inspect(recipe);
  expect(result.state).toBe("absent");
  for (const material of recipe.materializations) {
    expect(result.directoryObservations.find(item => item.path === dirname(material.path))!.observation)
      .toMatchObject({ state: "present", value: { entries: [] } });
  }
  expect(result).not.toHaveProperty("normalizationRuleIds");
  expect(result).not.toHaveProperty("rootListings");
});

it.each([
  [0, "extra-manifest.json", "file"], [1, "instance-123.json", "file"],
  [0, "extra-child", "directory"], [1, "agy-hook-runtime", "directory"],
  [0, "same-source-another-edge", "symlink"],
] as const)("rejects and retains managed leaf %i extra %s (%s)", (index, name, type) => {
  const recipe = install(), parent = dirname(recipe.materializations[index]!.path), extra = join(parent, name);
  if (type === "file") fs.writeFileSync(extra, "{}");
  if (type === "directory") fs.mkdirSync(extra);
  if (type === "symlink") fs.symlinkSync(recipe.materializations[1]!.path, extra);
  const result = inspect(recipe);
  expect(result.state).toBe("unknown");
  expect(result.directoryObservations.find(item => item.path === parent)!.observation)
    .toMatchObject({ state: "present", value: { entries: expect.arrayContaining([{ name, type }]) } });
  expect(fs.lstatSync(extra).isSymbolicLink()).toBe(type === "symlink");
});

it("retains same-name directory substitution instead of accepting a file", () => {
  const recipe = install(), path = recipe.materializations[0]!.path;
  fs.unlinkSync(path); fs.mkdirSync(path);
  const result = inspect(recipe);
  expect(result.state).toBe("unknown");
  expect(result.directoryObservations.find(item => item.path === dirname(path))!.observation)
    .toMatchObject({ state: "present", value: { entries: [{ name: "agent.md", type: "directory" }] } });
});

it.each(["leaf", "component"])("rejects a %s symlink without following it", kind => {
  const recipe = install(), path = kind === "leaf" ? recipe.materializations[0]!.path : join(recipe.cwd, ".agents");
  const saved = join(workspace, "saved"); fs.renameSync(path, saved); fs.symlinkSync(saved, path);
  const result = inspect(recipe);
  expect(result.state).toBe("unknown");
  if (result.state !== "unknown") throw Error("expected refusal");
  expect(result.problems.some(problem => problem.code === "INVENTORY_SYMLINK")).toBe(true);
  expect(fs.lstatSync(path).isSymbolicLink()).toBe(true);
});

it("rejects changed payload bytes without overwriting them", () => {
  const recipe = install(), path = recipe.materializations[0]!.path;
  fs.writeFileSync(path, "changed");
  expect(inspect(recipe).state).toBe("unknown");
  expect(fs.readFileSync(path, "utf8")).toBe("changed");
});

it.each(["file", "parent", "workspace"])("rejects stable foreign ownership of a %s", kind => {
  const recipe = install(), path = kind === "file" ? recipe.materializations[0]!.path :
    kind === "parent" ? join(recipe.cwd, ".agents") : workspace;
  const target = fs.lstatSync(path), lstat = fs.lstatSync, fstat = fs.fstatSync;
  const foreign = (stat: fs.Stats) => stat.dev === target.dev && stat.ino === target.ino
    ? Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { uid: (process.geteuid?.() ?? 0) + 1 }) : stat;
  vi.spyOn(fs, "lstatSync").mockImplementation(((...args: Parameters<typeof fs.lstatSync>) => foreign(lstat(...args) as fs.Stats)) as typeof fs.lstatSync);
  vi.spyOn(fs, "fstatSync").mockImplementation(((...args: Parameters<typeof fs.fstatSync>) => foreign(fstat(...args) as fs.Stats)) as typeof fs.fstatSync);
  expect(inspect(recipe).state).toBe("unknown");
});

it("enforces explicit file modes and accepts their exact intended values", () => {
  const recipe = inputs(); recipe.materializations[0]!.mode = 0o400; recipe.materializations[1]!.mode = 0o600;
  install(recipe);
  expect(inspect(recipe).state).toBe("complete");
  fs.chmodSync(recipe.materializations[0]!.path, 0o600);
  expect(inspect(recipe).state).toBe("unknown");
  expect(fs.lstatSync(recipe.materializations[0]!.path).mode & 0o7777).toBe(0o600);
});

// Breaks caught: recipe hash spoofing, duplicate membership and runtime profiles as statics.
it.each(["content", "settings-address", "duplicate", "runtime-path", "extra-material", "agent-path"])("rejects an invalid static recipe: %s", kind => {
  const recipe = inputs();
  if (kind === "content") { install(recipe); recipe.materializations[0]!.content = "different intended content"; }
  if (kind === "settings-address") {
    recipe.materializations[1]!.path = join(recipe.cwd, ".council-profiles", "a".repeat(64), "session-settings.json"); install(recipe);
  }
  if (kind === "duplicate") { recipe.materializations[1] = { ...recipe.materializations[0]! }; install(recipe, [0]); }
  if (kind === "runtime-path") {
    recipe.materializations[0]!.path = join(recipe.cwd, ".council-profiles/agy-hook-fixture/hook.sh"); install(recipe);
  }
  if (kind === "extra-material") {
    install(recipe); recipe.materializations.push({ path: join(recipe.cwd, "instance-123.json"), content: "{}", sha256: digest("{}") });
  }
  if (kind === "agent-path") { recipe.materializations[0]!.path = join(recipe.cwd, ".agents/agents/other/agent.md"); install(recipe); }
  expect(inspect(recipe).state).toBe("unknown");
});

it("retains earlier full observations and an explicit failed listing after a bounded IO fault", () => {
  const recipe = install(), failed = join(recipe.cwd, ".agents/agents"), opendir = fs.opendirSync;
  vi.spyOn(fs, "opendirSync").mockImplementation(((path: fs.PathLike, options?: fs.OpenDirOptions) => {
    if (String(path) === failed) throw Object.assign(new Error("fixture IO fault"), { code: "EIO", path: failed });
    return opendir(path, options);
  }) as typeof fs.opendirSync);
  const result = inspect(recipe);
  expect(result.state).toBe("unknown");
  expect(result.directoryObservations.map(item => item.path)).toEqual(expectedParents(recipe));
  expect(result.directoryObservations[0]!.observation.state).toBe("present");
  expect(result.directoryObservations.find(item => item.path === failed)!.observation)
    .toMatchObject({ state: "unknown", problems: [{ code: "EIO", path: failed, edge: null }] });
  expect(result.directoryObservations.at(-1)!.observation.state).toBe("present");
});

it("retains an unknown overflowing listing instead of a successful 100-entry prefix", () => {
  const recipe = install(), parent = dirname(recipe.materializations[0]!.path);
  for (let i = 0; i < 100; i++) fs.writeFileSync(join(parent, `ordinary-${i}`), "x");
  const result = inspect(recipe);
  expect(result.state).toBe("unknown");
  expect(result.directoryObservations.find(item => item.path === parent)!.observation)
    .toMatchObject({ state: "unknown", problems: [{ code: "INVENTORY_DIRECTORY_LIMIT", path: parent, edge: null }] });
});

it("shares the caller's aggregate JSON budget for the settings payload", () => {
  const recipe = install(), full = { paths: new Set<string>(), jsonBytes: 16777216 };
  const result = inspectAgyMaterializationState(workspace, recipe, full);
  expect(result.state).toBe("unknown");
  expect(full.jsonBytes).toBeGreaterThanOrEqual(16777216);
});

it.each(["directory-directory", "directory-file"])("rejects a replacement between %s observations even when each IO call is stable", kind => {
  const recipe = install(), agents = join(recipe.cwd, ".agents"), staged = join(workspace, "staged");
  fs.mkdirSync(join(staged, "agents/council-packet"), { recursive: true, mode: 0o700 });
  fs.writeFileSync(join(staged, "agents/council-packet/agent.md"), agent, { mode: 0o600 });
  const trigger = kind === "directory-directory" ? agents : dirname(recipe.materializations[1]!.path);
  const open = fs.openSync, close = fs.closeSync;
  let descriptor: number | undefined, replaced = false;
  vi.spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
    const fd = open(path, flags, mode);
    if (String(path) === trigger) descriptor = fd;
    return fd;
  });
  vi.spyOn(fs, "closeSync").mockImplementation(fd => {
    close(fd);
    if (fd === descriptor && !replaced) {
      replaced = true; fs.renameSync(agents, join(recipe.cwd, ".agents-retired")); fs.renameSync(staged, agents);
    }
  });
  const result = inspect(recipe);
  expect(replaced).toBe(true);
  expect(result.directoryObservations.every(item => item.observation.state === "present")).toBe(true);
  expect(result.state).toBe("unknown");
});

it.each([false, true])("performs no writes, repairs, or creation for installed=%s", installed => {
  const recipe = installed ? install() : inputs();
  const writes = [vi.spyOn(fs, "writeFileSync"), vi.spyOn(fs, "mkdirSync"), vi.spyOn(fs, "renameSync"),
    vi.spyOn(fs, "unlinkSync"), vi.spyOn(fs, "rmSync"), vi.spyOn(fs, "chmodSync")];
  const result = inspect(recipe);
  expect(result.state).toBe(installed ? "complete" : "absent");
  for (const write of writes) expect(write).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
