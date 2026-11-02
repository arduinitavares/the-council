import fs from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { currentSourceDigest } from "../../src/pilot/control-audit.js";
import { stableAgyRecipeInputs, encodeAgyInventoryWitness, type InventoryCore } from "../../src/pilot/agy-inventory-witness.js";
import { prepareAgyAuditDirectories, persistAgyInventoryWitness, readAgyInventoryWitness } from "../../src/pilot/agy-inventory-store.js";

// Only syscall faults are doubled; filesystem contents and readbacks stay real.
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof fs & { default: typeof fs }>();
  return { ...actual, default: { ...actual.default, get constants() { return actual.default.constants; } } };
});
let workspace: string;
const budget = () => ({ paths: new Set<string>(), jsonBytes: 0 });
function core(): InventoryCore {
  return { context: { requestingWorkspace: workspace, executionCwd: workspace, home: workspace, rawHome: null, repositoryBoundary: null, selectedAgent: null,
    environmentInputs: { PATH: null, HOME: null, TMPDIR: null, LANG: null, LC_ALL: null, TERM: null, AGY_CLI_DISABLE_AUTO_UPDATE: "true" } },
    recipeInputs: stableAgyRecipeInputs({ protocol: "agy-stream", executable: join(workspace, "fake-agy"), argv: [], cwd: workspace, version: "fixture-1", selection: { route: "antigravity", model: "fixture-1", effort: "high" }, expectedPermission: "plan", sources: [], facts: [] }),
    loaderContract: { id: "synthetic", semanticsDigest: "a".repeat(64), evidenceDigests: [], adapterRevision: "fixture", executable: { path: join(workspace, "fake-agy"), sha256: "b".repeat(64) } },
    inventory: { records: [], orderedEdges: [], rootListings: [], absenceProbes: [], sources: [], activeDescriptorOccurrences: [], ordering: [], effects: [], unavailable: ["synthetic mechanics only"], appliedRuleIds: [], normalizationRuleIds: [] } };
}
const inventories = () => join(workspace, ".council/control-audits/inventories");
beforeEach(() => { workspace = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "agy-witness-"))); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(workspace, { recursive: true, force: true }); });

// Catches excess footprint, recursive unguarded creation and implicit authority artifacts.
it("creates a clean audit store without granting inventory authority", () => {
  const mkdir = fs.mkdirSync, created: string[] = [];
  vi.spyOn(fs, "mkdirSync").mockImplementation(((path: fs.PathLike, options: fs.MakeDirectoryOptions) => { created.push(String(path)); return mkdir(path, options); }) as typeof fs.mkdirSync);
  prepareAgyAuditDirectories(workspace);
  expect(created.map(p => p.slice(workspace.length + 1))).toEqual([".council", ".council/control-audits", ".council/control-audits/inventories", ".council/control-audits/snapshots", ".council/control-audits/dispositions"]);
  for (const path of created) expect(fs.statSync(path).mode & 0o7777).toBe(0o700);
  expect(fs.readdirSync(join(workspace, ".council/control-audits")).sort()).toEqual(["dispositions", "inventories", "snapshots"]);
  const encoded = encodeAgyInventoryWitness(core()), source = persistAgyInventoryWitness(workspace, encoded);
  expect(source).toEqual({ path: join(inventories(), encoded.fingerprint + ".json"), kind: "file", sha256: encoded.sha256 });
  expect(fs.statSync(source.path).mode & 0o7777).toBe(0o600); expect(currentSourceDigest(source)).toBe(encoded.sha256);
  expect(fs.readdirSync(inventories())).toEqual([encoded.fingerprint + ".json"]);
  expect(fs.readdirSync(join(workspace, ".council/control-audits/snapshots"))).toEqual([]);
  expect(fs.readdirSync(join(workspace, ".council/control-audits/dispositions"))).toEqual([]);
  const readBudget = budget(), read = readAgyInventoryWitness(workspace, encoded.fingerprint, readBudget);
  expect(read.state).toBe("present"); if (read.state !== "present") throw Error("read failed");
  expect(read.value.core.inventory.unavailable).toEqual(["synthetic mechanics only"]);
  expect(read.value.encoded).toEqual(encoded); expect(readBudget.jsonBytes).toBe(encoded.bytes.length);
});

it("reuses only an equal guarded exclusive collision", () => {
  const encoded = encodeAgyInventoryWitness(core()), first = persistAgyInventoryWitness(workspace, encoded);
  expect(persistAgyInventoryWitness(workspace, encoded)).toEqual(first);
  fs.writeFileSync(first.path, "partial");
  expect(() => persistAgyInventoryWitness(workspace, encoded)).toThrow(); expect(fs.readFileSync(first.path, "utf8")).toBe("partial");
  expect(readAgyInventoryWitness(workspace, encoded.fingerprint, budget()).state).toBe("unknown");
});

it("handles an EEXIST race through bounded equality readback", () => {
  prepareAgyAuditDirectories(workspace); const encoded = encodeAgyInventoryWitness(core());
  const open = fs.openSync; let raced = false;
  vi.spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
    if (!raced && typeof flags === "number" && (flags & fs.constants.O_EXCL)) {
      raced = true; fs.writeFileSync(path, encoded.bytes, { flag: "wx", mode: 0o600 });
    }
    return open(path, flags, mode);
  });
  const source = persistAgyInventoryWitness(workspace, encoded);
  expect(raced).toBe(true); expect(fs.readFileSync(source.path)).toEqual(Buffer.from(encoded.bytes));
});

it("rejects mutable or forged encoded identities before creating a store", () => {
  for (const mutation of ["bytes", "F", "W"] as const) {
    const encoded = encodeAgyInventoryWitness(core());
    if (mutation === "bytes") encoded.bytes[0] = 0;
    if (mutation === "F") encoded.fingerprint = "c".repeat(64);
    if (mutation === "W") encoded.sha256 = "d".repeat(64);
    expect(() => persistAgyInventoryWitness(workspace, encoded)).toThrow();
    expect(fs.existsSync(join(workspace, ".council"))).toBe(false);
  }
});

it("retains a copied intended byte sequence if the caller mutates its buffer during open", () => {
  prepareAgyAuditDirectories(workspace); const encoded = encodeAgyInventoryWitness(core()), expected = Buffer.from(encoded.bytes);
  const open = fs.openSync;
  vi.spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
    if (typeof flags === "number" && (flags & fs.constants.O_EXCL)) encoded.bytes.fill(0);
    return open(path, flags, mode);
  });
  const source = persistAgyInventoryWitness(workspace, encoded);
  expect(fs.readFileSync(source.path)).toEqual(expected);
});

it.each(["parent link", "file link", "directory mode", "file mode", "file type"])("refuses %s without repairing it", kind => {
  prepareAgyAuditDirectories(workspace); const encoded = encodeAgyInventoryWitness(core()), target = join(inventories(), encoded.fingerprint + ".json");
  if (kind === "parent link") { fs.rmdirSync(inventories()); fs.mkdirSync(join(workspace, "elsewhere")); fs.symlinkSync(join(workspace, "elsewhere"), inventories()); }
  if (kind === "file link") { fs.writeFileSync(join(workspace, "outside"), encoded.bytes); fs.symlinkSync(join(workspace, "outside"), target); }
  if (kind === "directory mode") fs.chmodSync(inventories(), 0o755);
  if (kind === "file mode") fs.writeFileSync(target, encoded.bytes, { mode: 0o644 });
  if (kind === "file type") fs.mkdirSync(target, { mode: 0o700 });
  expect(() => persistAgyInventoryWitness(workspace, encoded)).toThrow();
  expect(readAgyInventoryWitness(workspace, encoded.fingerprint, budget()).state).toBe("unknown");
});

it("refuses foreign ownership based on custody observations", () => {
  prepareAgyAuditDirectories(workspace); const encoded = encodeAgyInventoryWitness(core()), stat = fs.lstatSync;
  vi.spyOn(fs, "lstatSync").mockImplementation(((path: fs.PathLike, options?: fs.StatOptions) => {
    const result = stat(path, options) as fs.Stats;
    if (String(path) === inventories()) return Object.assign(Object.create(Object.getPrototypeOf(result)), result, { uid: (process.geteuid?.() ?? 0) + 1 });
    return result;
  }) as typeof fs.lstatSync);
  expect(() => persistAgyInventoryWitness(workspace, encoded)).toThrow();
  expect(readAgyInventoryWitness(workspace, encoded.fingerprint, budget()).state).toBe("unknown");
});

it("finishes short writes and closes the exclusive descriptor", () => {
  const encoded = encodeAgyInventoryWitness(core()), write = fs.writeSync, close = fs.closeSync; let writes = 0, closed = 0;
  vi.spyOn(fs, "writeSync").mockImplementation(((fd: number, bytes: Uint8Array, offset: number, length: number) => { writes++; return write(fd, bytes, offset, Math.min(length, 7), null); }) as typeof fs.writeSync);
  vi.spyOn(fs, "closeSync").mockImplementation(fd => { closed++; return close(fd); });
  const source = persistAgyInventoryWitness(workspace, encoded);
  expect(writes).toBeGreaterThan(1); expect(closed).toBeGreaterThan(0); expect(fs.readFileSync(source.path)).toEqual(Buffer.from(encoded.bytes));
});

it.each(["throw", "zero"])("leaves interrupted %s writes unusable and closes the descriptor", fault => {
  const encoded = encodeAgyInventoryWitness(core()), write = fs.writeSync, close = fs.closeSync; let calls = 0, closed = false;
  vi.spyOn(fs, "writeSync").mockImplementation(((fd: number, bytes: Uint8Array, offset: number, length: number) => {
    if (calls++ === 0) return write(fd, bytes, offset, Math.min(length, 5), null);
    if (fault === "zero") return 0; throw Error("synthetic interruption");
  }) as typeof fs.writeSync);
  vi.spyOn(fs, "closeSync").mockImplementation(fd => { closed = true; return close(fd); });
  expect(() => persistAgyInventoryWitness(workspace, encoded)).toThrow(); expect(closed).toBe(true);
  const target = join(inventories(), encoded.fingerprint + ".json"); expect(fs.readFileSync(target)).toHaveLength(5);
  vi.restoreAllMocks();
  expect(readAgyInventoryWitness(workspace, encoded.fingerprint, budget()).state).toBe("unknown");
  expect(() => persistAgyInventoryWitness(workspace, encoded)).toThrow(); expect(fs.readFileSync(target)).toHaveLength(5);
});

it("bounds reads and preserves absence without bootstrap", () => {
  const encoded = encodeAgyInventoryWitness(core());
  expect(readAgyInventoryWitness(workspace, encoded.fingerprint, budget()).state).toBe("absent");
  expect(fs.existsSync(join(workspace, ".council"))).toBe(false);
  prepareAgyAuditDirectories(workspace); const target = join(inventories(), encoded.fingerprint + ".json");
  fs.writeFileSync(target, " ".repeat(1048577), { mode: 0o600 });
  expect(readAgyInventoryWitness(workspace, encoded.fingerprint, budget()).state).toBe("unknown");
  expect(readAgyInventoryWitness(workspace, "../escape", budget()).state).toBe("unknown");
});

// An unsafe file must be refused before JSON bytes are read or charged.
it("checks private file custody before reading any content", () => {
  prepareAgyAuditDirectories(workspace); const encoded = encodeAgyInventoryWitness(core());
  const target = join(inventories(), encoded.fingerprint + ".json");
  fs.writeFileSync(target, encoded.bytes, { mode: 0o644 });
  const readBudget = budget();
  expect(readAgyInventoryWitness(workspace, encoded.fingerprint, readBudget).state).toBe("unknown");
  expect(readBudget.jsonBytes).toBe(0);
});

it("refuses an unequal EEXIST race without overwriting or repair", () => {
  prepareAgyAuditDirectories(workspace); const encoded = encodeAgyInventoryWitness(core()), open = fs.openSync;
  let raced = false;
  vi.spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
    if (!raced && typeof flags === "number" && (flags & fs.constants.O_EXCL)) {
      raced = true; fs.writeFileSync(path, "interrupted", { flag: "wx", mode: 0o600 });
    }
    return open(path, flags, mode);
  });
  expect(() => persistAgyInventoryWitness(workspace, encoded)).toThrow();
  expect(fs.readFileSync(join(inventories(), encoded.fingerprint + ".json"), "utf8")).toBe("interrupted");
});

it("closes a created file if directory custody changes before the first write", () => {
  prepareAgyAuditDirectories(workspace); const encoded = encodeAgyInventoryWitness(core()), open = fs.openSync, close = fs.closeSync;
  let opened: number | undefined, closed: number | undefined;
  vi.spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
    const fd = open(path, flags, mode);
    if (typeof flags === "number" && (flags & fs.constants.O_EXCL)) { opened = fd; fs.chmodSync(inventories(), 0o755); }
    return fd;
  });
  vi.spyOn(fs, "closeSync").mockImplementation(fd => { closed = fd; return close(fd); });
  expect(() => persistAgyInventoryWitness(workspace, encoded)).toThrow();
  expect(opened).toEqual(expect.any(Number)); expect(closed).toBe(opened);
  expect(fs.readFileSync(join(inventories(), encoded.fingerprint + ".json"))).toHaveLength(0);
  expect(fs.statSync(inventories()).mode & 0o7777).toBe(0o755);
});

it("checks disposition directory custody without repairing modes or following links", () => {
  prepareAgyAuditDirectories(workspace);
  const dispositions = join(workspace, ".council/control-audits/dispositions");
  fs.chmodSync(dispositions, 0o755);
  expect(() => prepareAgyAuditDirectories(workspace)).toThrow();
  expect(fs.statSync(dispositions).mode & 0o7777).toBe(0o755);
  fs.chmodSync(dispositions, 0o700); fs.rmdirSync(dispositions);
  fs.mkdirSync(join(workspace, "external"), { mode: 0o700 }); fs.symlinkSync(join(workspace, "external"), dispositions);
  expect(() => prepareAgyAuditDirectories(workspace)).toThrow();
  expect(fs.readdirSync(join(workspace, "external"))).toEqual([]);
});

it("returns unknown if an initially present witness disappears before bounded acquisition", () => {
  const encoded = encodeAgyInventoryWitness(core()), source = persistAgyInventoryWitness(workspace, encoded);
  const stat = fs.lstatSync; let seen = false, removed = false;
  vi.spyOn(fs, "lstatSync").mockImplementation(((path: fs.PathLike, options?: fs.StatOptions) => {
    if (String(path) === source.path) seen = true;
    else if (seen && !removed && String(path) === workspace) { removed = true; fs.unlinkSync(source.path); }
    return stat(path, options);
  }) as typeof fs.lstatSync);
  expect(readAgyInventoryWitness(workspace, encoded.fingerprint, budget()).state).toBe("unknown");
  expect(removed).toBe(true);
});

it("keeps original directory custody through the final equality readback", () => {
  const encoded = encodeAgyInventoryWitness(core()), open = fs.openSync, close = fs.closeSync;
  let created: number | undefined, replaced = false;
  vi.spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
    const fd = open(path, flags, mode);
    if (typeof flags === "number" && (flags & fs.constants.O_EXCL)) created = fd;
    return fd;
  });
  vi.spyOn(fs, "closeSync").mockImplementation(fd => {
    close(fd);
    if (fd === created && !replaced) {
      replaced = true; fs.renameSync(inventories(), inventories() + "-old"); fs.mkdirSync(inventories(), { mode: 0o700 });
      fs.writeFileSync(join(inventories(), encoded.fingerprint + ".json"), encoded.bytes, { mode: 0o600 });
    }
  });
  expect(() => persistAgyInventoryWitness(workspace, encoded)).toThrow();
  expect(replaced).toBe(true);
  expect(fs.readFileSync(join(inventories(), encoded.fingerprint + ".json"))).toEqual(Buffer.from(encoded.bytes));
});

it("refuses a fingerprint containing a trailing newline", () => {
  expect(readAgyInventoryWitness(workspace, "a".repeat(64) + "\n", budget()).state).toBe("unknown");
  expect(fs.existsSync(join(workspace, ".council"))).toBe(false);
});

// T3-01: a fresh self-consistent reader observation must not replace prior custody.
it.each(["mode", "owner", "links", "leaf", "component"])("rejects a changed %s before payload acquisition", kind => {
  const encoded = encodeAgyInventoryWitness(core()), source = persistAgyInventoryWitness(workspace, encoded);
  const stat = fs.lstatSync, fstat = fs.fstatSync;
  let seen = false, changed = false;
  const foreign = (value: fs.Stats) => Object.assign(Object.create(Object.getPrototypeOf(value)), value, { uid: value.uid + 1 }) as fs.Stats;
  vi.spyOn(fs, "lstatSync").mockImplementation(((path: fs.PathLike, options?: fs.StatOptions) => {
    const name = String(path);
    if (name === source.path) seen = true;
    const trigger = kind === "component" ? parse(workspace).root : workspace;
    if (seen && !changed && name === trigger) {
      changed = true;
      if (kind === "mode") fs.chmodSync(source.path, 0o644);
      else if (kind === "links") fs.linkSync(source.path, source.path + ".link");
      else if (kind === "component") {
        fs.renameSync(inventories(), inventories() + "-prior"); fs.mkdirSync(inventories(), { mode: 0o700 });
        fs.writeFileSync(source.path, encoded.bytes, { mode: 0o600 });
      } else { fs.renameSync(source.path, source.path + ".prior"); fs.writeFileSync(source.path, encoded.bytes, { mode: 0o600 }); }
    }
    const value = stat(path, options) as fs.Stats;
    return kind === "owner" && changed && name === source.path ? foreign(value) : value;
  }) as typeof fs.lstatSync);
  vi.spyOn(fs, "fstatSync").mockImplementation(((fd: number) => {
    const value = fstat(fd);
    return kind === "owner" && changed && value.ino === stat(source.path).ino ? foreign(value) : value;
  }) as typeof fs.fstatSync);
  const b = budget(), read = readAgyInventoryWitness(workspace, encoded.fingerprint, b);
  expect(changed).toBe(true); expect(read.state).toBe("unknown"); expect(b.jsonBytes).toBe(0);
});

it("rejects a foreign requesting workspace before creating any store directories", () => {
  const foreign = core(); foreign.context.requestingWorkspace = join(workspace, "foreign");
  expect(() => persistAgyInventoryWitness(workspace, encodeAgyInventoryWitness(foreign))).toThrow();
  expect(fs.existsSync(join(workspace, ".council"))).toBe(false);
});

it("returns unknown for a valid witness relocated to another canonical workspace", () => {
  const encoded = encodeAgyInventoryWitness(core()), source = persistAgyInventoryWitness(workspace, encoded);
  const other = join(workspace, "other"); fs.mkdirSync(other); prepareAgyAuditDirectories(other);
  const relocated = join(other, ".council/control-audits/inventories", encoded.fingerprint + ".json");
  fs.writeFileSync(relocated, fs.readFileSync(source.path), { mode: 0o600 });
  expect(currentSourceDigest({ path: relocated, kind: "file", sha256: encoded.sha256 })).toBe(encoded.sha256);
  expect(readAgyInventoryWitness(other, encoded.fingerprint, budget()).state).toBe("unknown");
});

it("canonicalizes a supplied workspace alias while binding the real store", () => {
  const alias = join(workspace, "alias"); fs.symlinkSync(workspace, alias);
  const encoded = encodeAgyInventoryWitness(core()), source = persistAgyInventoryWitness(alias, encoded);
  expect(source.path).toBe(join(inventories(), encoded.fingerprint + ".json"));
  expect(readAgyInventoryWitness(alias, encoded.fingerprint, budget()).state).toBe("present");
});

it("rejects an equal-byte leaf replacement after closing the newly written inode", () => {
  const encoded = encodeAgyInventoryWitness(core()), open = fs.openSync, close = fs.closeSync;
  let created: number | undefined, replaced = false, oldInode: number | undefined, newInode: number | undefined;
  vi.spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
    const fd = open(path, flags, mode);
    if (typeof flags === "number" && (flags & fs.constants.O_EXCL)) created = fd;
    return fd;
  });
  vi.spyOn(fs, "closeSync").mockImplementation(fd => {
    close(fd);
    if (fd === created && !replaced) {
      replaced = true; const target = join(inventories(), encoded.fingerprint + ".json");
      oldInode = fs.statSync(target).ino; fs.renameSync(target, target + ".prior");
      fs.writeFileSync(target, encoded.bytes, { mode: 0o600 }); newInode = fs.statSync(target).ino;
    }
  });
  expect(() => persistAgyInventoryWitness(workspace, encoded)).toThrow();
  expect(replaced).toBe(true); expect(newInode).toEqual(expect.any(Number)); expect(newInode).not.toBe(oldInode);
  expect(fs.readFileSync(join(inventories(), encoded.fingerprint + ".json"))).toEqual(Buffer.from(encoded.bytes));
});

it("keeps the existing full-budget absent-read refusal", () => {
  const b = budget(); for (let i = 0; i < 1000; i++) b.paths.add("/already/" + i);
  const read = readAgyInventoryWitness(workspace, "a".repeat(64), b);
  expect(read.state).toBe("unknown");
  if (read.state === "unknown") expect(read.problems[0]!.code).toBe("INVENTORY_PATH_LIMIT");
});

it.each(["private", "public", "linked"])("refuses a %s leaf that appears after the initial absence before reading it", kind => {
  prepareAgyAuditDirectories(workspace);
  const encoded = encodeAgyInventoryWitness(core()), target = join(inventories(), encoded.fingerprint + ".json"), stat = fs.lstatSync;
  let absent = false, appeared = false;
  vi.spyOn(fs, "lstatSync").mockImplementation(((path: fs.PathLike, options?: fs.StatOptions) => {
    const name = String(path);
    if (name === target && !appeared) absent = true;
    else if (name === workspace && absent && !appeared) {
      appeared = true; fs.writeFileSync(target, encoded.bytes, { mode: kind === "public" ? 0o644 : 0o600 });
      if (kind === "linked") fs.linkSync(target, target + ".link");
    }
    return stat(path, options);
  }) as typeof fs.lstatSync);
  const b = budget(), read = readAgyInventoryWitness(workspace, encoded.fingerprint, b);
  expect(appeared).toBe(true); expect(read.state).toBe("unknown"); expect(b.jsonBytes).toBe(0);
  expect(fs.readFileSync(target)).toEqual(Buffer.from(encoded.bytes));
});
