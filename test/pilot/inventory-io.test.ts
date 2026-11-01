import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../../src/domain/hash.js";
import { decodeStrictJson } from "../../src/workers/strict-json.js";
import {
  readInventoryFile, readInventoryJson, listInventoryDirectory,
  type InventoryBudget, type InventoryRead,
} from "../../src/pilot/inventory-io.js";

// Isolate syscall fault injection to this module; all unmodified calls are real.
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof fs & { default: typeof fs }>();
  return { ...actual, default: { ...actual.default, get constants() { return actual.default.constants; } } };
});

let root: string, fixtureContainer: string;
const budget = (): InventoryBudget => ({ paths: new Set(), jsonBytes: 0 });
const file = (name: string, bytes: string | Uint8Array = "abc") => {
  const path = join(root, name);
  fs.writeFileSync(path, bytes);
  return path;
};
function present<T>(result: InventoryRead<T>) {
  expect(result.state).toBe("present");
  if (result.state !== "present") throw new Error(JSON.stringify(result));
  return result;
}
function unknown(result: InventoryRead<unknown>) {
  expect(result.state).toBe("unknown");
  if (result.state !== "unknown") throw new Error("Expected unknown");
  expect(result.problems.length).toBeGreaterThan(0);
  for (const problem of result.problems) {
    expect(problem.code).toEqual(expect.any(String));
    expect(problem.path).toEqual(expect.any(String));
    expect(problem.edge).toBeNull();
  }
}
// Per-file containers isolate fixture churn while files still run in parallel.
const fixtureParent = fileURLToPath(new URL("./fixtures/inventory-io-workspaces/", import.meta.url));
beforeAll(() => { fixtureContainer = fs.realpathSync(fs.mkdtempSync(join(fixtureParent, "suite-"))); });
afterAll(() => { fs.rmSync(fixtureContainer, { recursive: true, force: true }); });
beforeEach(() => { root = fs.mkdtempSync(join(fixtureContainer, "case-")); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });

// Breaks caught: ancestor namespace timestamps masquerading as selected changes,
// blanket identity relaxation, and stale absence returned without an edge recheck.
describe("traversal custody and selected stability", () => {
  it.each(["file", "json", "directory"])("keeps %s present through unrelated ancestor sibling creation", kind => {
    const selected = join(root, "selected"); fs.mkdirSync(selected);
    const target = file("selected/payload.json", '{"stable":true}');
    const bytes = fs.readFileSync(target), leaf = fs.lstatSync(target), directory = fs.lstatSync(selected);
    const fstat = fs.fstatSync;
    let changed = false;
    vi.spyOn(fs, "fstatSync").mockImplementation(((...args: Parameters<typeof fs.fstatSync>) => {
      const stat = Reflect.apply(fstat, fs, args);
      if (!changed) { changed = true; fs.writeFileSync(join(root, "unrelated-sibling"), "inert"); }
      return stat;
    }) as typeof fs.fstatSync);
    const accounting = budget();
    const result = kind === "directory" ? listInventoryDirectory(selected, accounting)
      : kind === "json" ? readInventoryJson(target, accounting) : readInventoryFile(target, 100, accounting);
    expect(changed).toBe(true);
    expect(fs.readFileSync(target)).toEqual(bytes);
    expect(fs.lstatSync(target)).toMatchObject({ ino: leaf.ino, size: leaf.size, mtimeMs: leaf.mtimeMs, ctimeMs: leaf.ctimeMs });
    expect(fs.lstatSync(selected)).toMatchObject({ ino: directory.ino, mtimeMs: directory.mtimeMs, ctimeMs: directory.ctimeMs });
    expect(fs.readdirSync(selected)).toEqual(["payload.json"]);
    expect(result.state).toBe("present");
    if (kind === "directory") expect(result).toMatchObject({ value: { entries: [{ name: "payload.json", type: "file" }] } });
    else if (kind === "json") expect(result).toMatchObject({ value: { value: { stable: true }, file: { bytes } } });
    else expect(result).toMatchObject({ value: { bytes } });
  });

  it.each(["dev", "ino", "uid", "gid", "mode", "type"] as const)("rejects traversal ancestor %s drift before payload reads", field => {
    const target = file("payload.json", '{"stable":true}'), lstat = fs.lstatSync;
    const read = vi.spyOn(fs, "readSync");
    let calls = 0;
    vi.spyOn(fs, "lstatSync").mockImplementation(((...args: Parameters<typeof fs.lstatSync>) => {
      const stat = Reflect.apply(lstat, fs, args) as fs.Stats;
      if (String(args[0]) !== root || ++calls === 1) return stat;
      const changed = Object.create(stat) as fs.Stats;
      if (field === "type") Object.defineProperty(changed, "isDirectory", { value: () => false });
      else Object.defineProperty(changed, field, { value: stat[field] + 1 });
      return changed;
    }) as typeof fs.lstatSync);
    expect(readInventoryJson(target, budget())).toMatchObject({ state: "unknown",
      problems: [{ code: "INVENTORY_UNSTABLE", path: root, edge: null }] });
    expect(read).not.toHaveBeenCalled();
  });

  it.each(["file", "json", "directory"])("retains selected %s ctime checks before payload acquisition", kind => {
    const target = kind === "directory" ? root : file("payload.json", '{"stable":true}');
    const lstat = fs.lstatSync, read = vi.spyOn(fs, "readSync"), opendir = vi.spyOn(fs, "opendirSync");
    let calls = 0;
    vi.spyOn(fs, "lstatSync").mockImplementation(((...args: Parameters<typeof fs.lstatSync>) => {
      const stat = Reflect.apply(lstat, fs, args) as fs.Stats;
      if (String(args[0]) !== target || ++calls === 1) return stat;
      return Object.assign(Object.create(stat), { ctimeMs: stat.ctimeMs + 1 });
    }) as typeof fs.lstatSync);
    const result = kind === "directory" ? listInventoryDirectory(target, budget())
      : kind === "json" ? readInventoryJson(target, budget()) : readInventoryFile(target, 100, budget());
    expect(result).toMatchObject({ state: "unknown", problems: [{ code: "INVENTORY_UNSTABLE", path: target, edge: null }] });
    expect(read).not.toHaveBeenCalled(); expect(opendir).not.toHaveBeenCalled();
  });

  it.each(["file", "json", "directory"])("rejects an appeared missing edge for %s without consuming payload", kind => {
    const edge = join(root, "missing"), lstat = fs.lstatSync;
    // The directory case stops at a missing ancestor, not the requested leaf.
    const target = kind === "directory" ? join(edge, "child") : edge;
    const read = vi.spyOn(fs, "readSync"), open = vi.spyOn(fs, "openSync"), opendir = vi.spyOn(fs, "opendirSync");
    let missing = false, appeared = false, edgeChecks = 0;
    vi.spyOn(fs, "lstatSync").mockImplementation(((...args: Parameters<typeof fs.lstatSync>) => {
      if (String(args[0]) === edge) { edgeChecks++; missing = true; }
      const stat = Reflect.apply(lstat, fs, args);
      if (String(args[0]) === root && missing && !appeared) {
        appeared = true;
        if (kind === "directory") fs.mkdirSync(target, { recursive: true });
        else fs.writeFileSync(edge, '{"mustStayUnread":true}');
      }
      return stat;
    }) as typeof fs.lstatSync);
    const accounting = budget();
    const result = kind === "directory" ? listInventoryDirectory(target, accounting)
      : kind === "json" ? readInventoryJson(target, accounting) : readInventoryFile(target, 100, accounting);
    expect(appeared).toBe(true);
    expect(result).toMatchObject({ state: "unknown", problems: [{ code: "INVENTORY_UNSTABLE", path: edge, edge: null }] });
    expect(edgeChecks).toBe(2);
    expect(read).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled(); expect(opendir).not.toHaveBeenCalled();
    expect(accounting.jsonBytes).toBe(0);
    expect(accounting.paths.has(target)).toBe(true);
  });

  it("keeps an exact missing edge absent through unrelated ancestor namespace noise", () => {
    const selected = join(root, "selected"); fs.mkdirSync(selected);
    const edge = join(selected, "missing"), target = join(edge, "unvisited"), lstat = fs.lstatSync;
    let changed = false, edgeChecks = 0;
    vi.spyOn(fs, "lstatSync").mockImplementation(((...args: Parameters<typeof fs.lstatSync>) => {
      if (String(args[0]) === edge) {
        edgeChecks++;
        if (!changed) { changed = true; fs.writeFileSync(join(root, "unrelated-sibling"), "inert"); }
      }
      return Reflect.apply(lstat, fs, args);
    }) as typeof fs.lstatSync);
    const accounting = budget();
    expect(readInventoryFile(target, 10, accounting)).toMatchObject({ state: "absent", path: target });
    expect(edgeChecks).toBe(2);
    expect(accounting.paths.has(edge)).toBe(true);
    expect(accounting.paths.has(target)).toBe(true);
    expect(accounting.jsonBytes).toBe(0);
  });

  it("checks parent custody again after rechecking the exact missing edge", () => {
    const edge = join(root, "missing"), lstat = fs.lstatSync, read = vi.spyOn(fs, "readSync");
    let edgeChecks = 0;
    vi.spyOn(fs, "lstatSync").mockImplementation(((...args: Parameters<typeof fs.lstatSync>) => {
      if (String(args[0]) === edge) edgeChecks++;
      const stat = Reflect.apply(lstat, fs, args) as fs.Stats;
      return String(args[0]) === root && edgeChecks === 2
        ? Object.assign(Object.create(stat), { mode: stat.mode ^ 0o100 }) : stat;
    }) as typeof fs.lstatSync);
    expect(readInventoryJson(edge, budget())).toMatchObject({ state: "unknown",
      problems: [{ code: "INVENTORY_UNSTABLE", path: root, edge: null }] });
    expect(edgeChecks).toBe(2); expect(read).not.toHaveBeenCalled();
  });

  it("keeps an exact-edge recheck error unknown without retrying or reading payload", () => {
    const edge = join(root, "missing"), lstat = fs.lstatSync, read = vi.spyOn(fs, "readSync");
    let edgeChecks = 0;
    vi.spyOn(fs, "lstatSync").mockImplementation(((...args: Parameters<typeof fs.lstatSync>) => {
      if (String(args[0]) === edge && ++edgeChecks === 2) throw Object.assign(Error("injected recheck IO error"), { code: "EIO", path: edge });
      return Reflect.apply(lstat, fs, args);
    }) as typeof fs.lstatSync);
    expect(readInventoryJson(edge, budget())).toMatchObject({ state: "unknown", problems: [{ code: "EIO", path: edge, edge: null }] });
    expect(edgeChecks).toBe(2); expect(read).not.toHaveBeenCalled();
  });
});

describe("absence lookup namespace custody", () => {
  it.each(["file", "json", "directory"])("keeps an existing %s unknown through repeated transient parent substitution", kind => {
    const parent = join(root, "parent"), retained = join(root, "retained"), target = join(parent, "existing");
    fs.mkdirSync(parent);
    if (kind === "directory") fs.mkdirSync(target);
    const payload = kind === "directory" ? join(target, "payload.json") : target;
    fs.writeFileSync(payload, '{"stable":true}');
    const lstat = fs.lstatSync, before = lstat(target);
    const read = vi.spyOn(fs, "readSync"), open = vi.spyOn(fs, "openSync"), opendir = vi.spyOn(fs, "opendirSync");
    let substitutions = 0;
    vi.spyOn(fs, "lstatSync").mockImplementation(((...args: Parameters<typeof fs.lstatSync>) => {
      if (String(args[0]) !== target) return Reflect.apply(lstat, fs, args);
      substitutions++; fs.renameSync(parent, retained); fs.mkdirSync(parent);
      try { return Reflect.apply(lstat, fs, args); }
      finally { fs.rmdirSync(parent); fs.renameSync(retained, parent); }
    }) as typeof fs.lstatSync);
    const accounting = budget();
    const result = kind === "directory" ? listInventoryDirectory(target, accounting)
      : kind === "json" ? readInventoryJson(target, accounting) : readInventoryFile(target, 100, accounting);
    expect(substitutions).toBe(2);
    const after = lstat(target);
    for (const key of ["dev", "ino", "uid", "gid", "mode", "size", "mtimeMs", "ctimeMs"] as const) expect(after[key]).toBe(before[key]);
    expect(result.state).toBe("unknown");
    expect(read).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled(); expect(opendir).not.toHaveBeenCalled();
    expect(accounting.jsonBytes).toBe(0);
    expect(accounting.paths.has(target)).toBe(true);
    expect(fs.readFileSync(payload, "utf8")).toBe('{"stable":true}');
  });

  it("refuses ambiguous parent namespace churn during the final bounded missing-edge lookup", () => {
    const parent = join(root, "parent"); fs.mkdirSync(parent);
    const target = join(parent, "missing"), lstat = fs.lstatSync;
    const read = vi.spyOn(fs, "readSync"), open = vi.spyOn(fs, "openSync"), opendir = vi.spyOn(fs, "opendirSync");
    let checks = 0;
    vi.spyOn(fs, "lstatSync").mockImplementation(((...args: Parameters<typeof fs.lstatSync>) => {
      if (String(args[0]) === target && ++checks === 2) fs.writeFileSync(join(parent, "unrelated"), "inert");
      return Reflect.apply(lstat, fs, args);
    }) as typeof fs.lstatSync);
    const accounting = budget(), result = readInventoryJson(target, accounting);
    expect(checks).toBe(2);
    expect(result.state).toBe("unknown");
    expect(read).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled(); expect(opendir).not.toHaveBeenCalled();
    expect(accounting.jsonBytes).toBe(0);
  });
});

// A held fd does not bind a separately opened named stream, or a child lstat.
describe("directory stream namespace custody", () => {
  it("refuses a stream opened through a transiently substituted traversal parent", () => {
    const parent = join(root, "parent"), selected = join(parent, "selected");
    const retained = join(root, "retained"), replacement = join(root, "replacement");
    fs.mkdirSync(selected, { recursive: true }); file("parent/selected/original", "inert");
    const before = fs.lstatSync(selected), opendir = fs.opendirSync;
    let substituted = false, stream: fs.Dir | undefined, reads = 0;
    vi.spyOn(fs, "opendirSync").mockImplementation(((...args: Parameters<typeof fs.opendirSync>) => {
      if (String(args[0]) !== selected) return Reflect.apply(opendir, fs, args);
      substituted = true;
      fs.renameSync(parent, retained);
      fs.mkdirSync(selected, { recursive: true }); file("parent/selected/substituted", "inert");
      stream = Reflect.apply(opendir, fs, args);
      const read = stream!.readSync.bind(stream);
      vi.spyOn(stream!, "readSync").mockImplementation(() => { reads++; return read(); });
      fs.renameSync(parent, replacement); fs.renameSync(retained, parent);
      return stream;
    }) as typeof fs.opendirSync);
    const result = listInventoryDirectory(selected, budget()), after = fs.lstatSync(selected);
    expect(substituted).toBe(true);
    for (const key of ["dev", "ino", "uid", "gid", "mode", "size", "mtimeMs", "ctimeMs"] as const) expect(after[key]).toBe(before[key]);
    expect(fs.readdirSync(selected)).toEqual(["original"]);
    expect(result.state).toBe("unknown");
    expect(reads).toBe(0);
    expect(() => stream!.readSync()).toThrow();
  });

  it("refuses a substituted child type during the separate by-path fallback", () => {
    const parent = join(root, "parent"), selected = join(parent, "selected"), child = join(selected, "slot");
    const retained = join(root, "retained"), replacement = join(root, "replacement");
    fs.mkdirSync(selected, { recursive: true }); file("parent/selected/slot", "inert");
    const before = fs.lstatSync(selected), opendir = fs.opendirSync, lstat = fs.lstatSync;
    let substituted = false;
    vi.spyOn(fs, "opendirSync").mockImplementation(((...args: Parameters<typeof fs.opendirSync>) => {
      const stream = Reflect.apply(opendir, fs, args), read = stream.readSync.bind(stream);
      vi.spyOn(stream, "readSync").mockImplementation(() => {
        const entry = read();
        if (entry) {
          vi.spyOn(entry, "isFile").mockReturnValue(false);
          vi.spyOn(entry, "isDirectory").mockReturnValue(false);
          vi.spyOn(entry, "isSymbolicLink").mockReturnValue(false);
        }
        return entry;
      });
      return stream;
    }) as typeof fs.opendirSync);
    vi.spyOn(fs, "lstatSync").mockImplementation(((...args: Parameters<typeof fs.lstatSync>) => {
      if (String(args[0]) !== child || substituted) return Reflect.apply(lstat, fs, args);
      substituted = true; fs.renameSync(parent, retained);
      fs.mkdirSync(child, { recursive: true });
      const stat = Reflect.apply(lstat, fs, args);
      fs.renameSync(parent, replacement); fs.renameSync(retained, parent);
      return stat;
    }) as typeof fs.lstatSync);
    const result = listInventoryDirectory(selected, budget()), after = lstat(selected);
    expect(substituted).toBe(true);
    for (const key of ["dev", "ino", "size", "mtimeMs", "ctimeMs"] as const) expect(after[key]).toBe(before[key]);
    expect(lstat(child).isFile()).toBe(true);
    expect(result.state).toBe("unknown");
  });

  it("refuses ambiguous ancestor namespace churn during the by-path stream bridge", () => {
    const selected = join(root, "selected"); fs.mkdirSync(selected); file("selected/original", "inert");
    const opendir = fs.opendirSync;
    let changed = false, stream: fs.Dir | undefined, reads = 0;
    vi.spyOn(fs, "opendirSync").mockImplementation(((...args: Parameters<typeof fs.opendirSync>) => {
      stream = Reflect.apply(opendir, fs, args);
      const read = stream!.readSync.bind(stream);
      vi.spyOn(stream!, "readSync").mockImplementation(() => { reads++; return read(); });
      changed = true; file("unrelated-at-bridge", "inert");
      return stream;
    }) as typeof fs.opendirSync);
    const result = listInventoryDirectory(selected, budget());
    expect(changed).toBe(true);
    expect(fs.readdirSync(selected)).toEqual(["original"]);
    expect(result.state).toBe("unknown");
    expect(reads).toBe(0);
    expect(() => stream!.readSync()).toThrow();
  });

  it("keeps already acquired stream entries present through later unrelated ancestor churn", () => {
    const selected = join(root, "selected"); fs.mkdirSync(selected); file("selected/original", "inert");
    const opendir = fs.opendirSync;
    let changed = false;
    vi.spyOn(fs, "opendirSync").mockImplementation(((...args: Parameters<typeof fs.opendirSync>) => {
      const stream = Reflect.apply(opendir, fs, args), read = stream.readSync.bind(stream);
      vi.spyOn(stream, "readSync").mockImplementation(() => {
        if (!changed) { changed = true; file("unrelated-after-bridge", "inert"); }
        return read();
      });
      return stream;
    }) as typeof fs.opendirSync);
    expect(listInventoryDirectory(selected, budget())).toMatchObject({ state: "present",
      value: { entries: [{ name: "original", type: "file" }] } });
    expect(changed).toBe(true);
  });
});

// T3-01 requires the actual acquisition boundary, before read/hash/parse.
it("refuses a bound descriptor with multiple links before consuming JSON", () => {
  const path = file("private.json", "{\"ok\":true}"); fs.chmodSync(path, 0o600);
  const leaf = fs.lstatSync(path), parent = fs.lstatSync(root), fstat = fs.fstatSync;
  vi.spyOn(fs, "fstatSync").mockImplementation(((fd: number) => {
    const value = fstat(fd);
    return Object.assign(Object.create(Object.getPrototypeOf(value)), value, { nlink: 2 });
  }) as typeof fs.fstatSync);
  const b = budget();
  const read = readInventoryJson(path, b, { leaf, components: [{ path: root, dev: parent.dev, ino: parent.ino, uid: parent.uid, gid: parent.gid, mode: parent.mode }] });
  unknown(read); expect(b.jsonBytes).toBe(0);
});

it("refuses an original component identity mismatch before consuming JSON", () => {
  const path = file("private.json", "{\"ok\":true}"); fs.chmodSync(path, 0o600);
  const leaf = fs.lstatSync(path), parent = fs.lstatSync(root), b = budget();
  const read = readInventoryJson(path, b, { leaf, components: [{ path: root, dev: parent.dev, ino: parent.ino + 1, uid: parent.uid, gid: parent.gid, mode: parent.mode }] });
  unknown(read); expect(b.jsonBytes).toBe(0);
});

// Breaks caught: string decoding/re-encoding, partial listings, and metadata-only membership.
it("returns exact bytes and their digest with stable component and descriptor receipts", () => {
  const path = file("raw", new Uint8Array([0, 255, 10, 128]));
  const result = present(readInventoryFile(path, 4, budget()));
  expect([...result.value.bytes]).toEqual([0, 255, 10, 128]);
  expect(result.value.sha256).toBe(createHash("sha256").update(new Uint8Array([0, 255, 10, 128])).digest("hex"));
  expect(result.receipt.path).toBe(path);
  expect(result.receipt.before).toEqual(result.receipt.after);
  expect(result.receipt.before).toMatchObject({ type: "file", size: 4 });
  expect(result.receipt.before.ctimeMs).toEqual(expect.any(Number));
  expect(result.receipt.components.at(-1)?.path).toBe(path);
  expect(result.receipt.components.every(component => component.identity.type !== "symlink")).toBe(true);
});

it("returns complete empty listings", () => {
  expect(present(listInventoryDirectory(root, budget())).value.entries).toEqual([]);
});

it("preserves Unicode filenames including the valid replacement character", () => {
  file("\ufffd"); file("\u2603");
  fs.mkdirSync(join(root, "日本語"));
  file("日本語/漢字");
  expect(present(listInventoryDirectory(root, budget())).value.entries).toEqual([
    { name: "\u2603", type: "file" }, { name: "日本語", type: "directory" }, { name: "\ufffd", type: "file" },
  ]);
  expect(present(listInventoryDirectory(join(root, "日本語"), budget())).value.entries).toEqual([{ name: "漢字", type: "file" }]);
});

it("records absence only beneath verified existing parents", () => {
  for (const path of [join(root, "missing"), join(root, "missing", "child")]) {
    const result = readInventoryFile(path, 4, budget());
    expect(result.state).toBe("absent");
    if (result.state !== "absent") throw new Error("Expected absence");
    expect(result.path).toBe(path);
    expect(result.verifiedParents.at(-1)?.path).toBe(root);
    expect(result.verifiedParents.every(parent => parent.identity.type === "directory")).toBe(true);
  }
  expect(readInventoryJson(join(root, "missing"), budget()).state).toBe("absent");
  expect(listInventoryDirectory(join(root, "missing"), budget()).state).toBe("absent");
});

it("lists ignored files and detects same-name type replacement", () => {
  file("slot"); file("no-extension"); file(".ignored");
  fs.symlinkSync("missing", join(root, "dangling"));
  const time = new Date(1700000000000);
  fs.utimesSync(root, time, time);
  const before = present(listInventoryDirectory(root, budget())).value;
  expect(before.entries).toEqual([
    { name: ".ignored", type: "file" }, { name: "dangling", type: "symlink" },
    { name: "no-extension", type: "file" }, { name: "slot", type: "file" },
  ]);
  fs.unlinkSync(join(root, "slot")); fs.mkdirSync(join(root, "slot"));
  fs.utimesSync(root, time, time);
  const after = present(listInventoryDirectory(root, budget())).value;
  expect(after.entries.at(-1)).toEqual({ name: "slot", type: "directory" });
  expect(canonicalJson(after)).not.toBe(canonicalJson(before));
});

it.each(["add", "remove", "rename"])("detects %s with restored root timestamps", operation => {
  file("slot");
  const time = new Date(1700000000000);
  fs.utimesSync(root, time, time);
  const before = present(listInventoryDirectory(root, budget())).value;
  if (operation === "add") file("extra");
  if (operation === "remove") fs.unlinkSync(join(root, "slot"));
  if (operation === "rename") fs.renameSync(join(root, "slot"), join(root, "renamed"));
  fs.utimesSync(root, time, time);
  expect(canonicalJson(present(listInventoryDirectory(root, budget())).value)).not.toBe(canonicalJson(before));
});

it.each([100, 101])("enforces the %i-entry directory boundary without truncating success", count => {
  for (let index = 0; index < count; index++) file(`entry-${index}`);
  const result = listInventoryDirectory(root, budget());
  if (count === 100) expect(present(result).value.entries).toHaveLength(100);
  else unknown(result);
});

it("buffers one directory entry and stops at entry 101, closing both handles", () => {
  for (let index = 0; index < 120; index++) file(`entry-${index}`);
  const open = fs.openSync, opendir = fs.opendirSync;
  let descriptor = -1, stream: fs.Dir | undefined, reads = 0;
  let bufferSize: number | undefined;
  vi.spyOn(fs, "openSync").mockImplementation((...args: Parameters<typeof fs.openSync>) => {
    descriptor = open(...args); return descriptor;
  });
  vi.spyOn(fs, "opendirSync").mockImplementation((...args: Parameters<typeof fs.opendirSync>) => {
    bufferSize = typeof args[1] === "object" ? args[1]?.bufferSize : undefined;
    stream = opendir(...args);
    const read = stream.readSync.bind(stream);
    vi.spyOn(stream, "readSync").mockImplementation(() => { reads++; return read(); });
    return stream;
  });
  unknown(listInventoryDirectory(root, budget()));
  expect(bufferSize).toBe(1);
  expect(reads).toBe(101);
  expect(descriptor).toBeGreaterThanOrEqual(0);
  expect(() => fs.fstatSync(descriptor)).toThrow();
  expect(() => stream!.readSync()).toThrow();
});

// Breaks caught: trusting stat size, unbounded reads, re-reading JSON after hashing.
it.each([1048576, 1048577])("enforces the exact %i-byte JSON boundary", size => {
  const path = file("large.json", '"' + "x".repeat(size - 2) + '"');
  const original = fs.readSync;
  let bytes = 0;
  vi.spyOn(fs, "readSync").mockImplementation((...args: Parameters<typeof fs.readSync>) => {
    const read = Reflect.apply(original, fs, args) as number;
    bytes += read;
    return read;
  });
  const result = readInventoryJson(path, budget());
  expect(bytes).toBe(size);
  if (size === 1048576) expect(present(result).value.file.bytes.length).toBe(size);
  else unknown(result);
});

it("stops a growing descriptor at limit plus one bytes", () => {
  const path = file("growing", "a");
  const original = fs.readSync;
  let bytes = 0;
  let reads = 0;
  vi.spyOn(fs, "readSync").mockImplementation((...args: Parameters<typeof fs.readSync>) => {
    if (reads++ === 0) fs.appendFileSync(path, "b".repeat(100000));
    const read = Reflect.apply(original, fs, args) as number;
    bytes += read;
    return read;
  });
  unknown(readInventoryFile(path, 7, budget()));
  expect(bytes).toBe(8);
});

it.each(["", "a"])("handles zero-byte limits for %j", text => {
  const result = readInventoryFile(file("zero", text), 0, budget());
  if (text === "") expect(present(result).value.bytes).toHaveLength(0);
  else unknown(result);
});

it("continues short descriptor reads until all bytes have been observed", () => {
  const path = file("short", "abcdef");
  const read = fs.readSync;
  vi.spyOn(fs, "readSync").mockImplementation((fd, buffer, ...rest: unknown[]) => {
    const [offset, length, position] = rest;
    if (typeof offset !== "number" || typeof length !== "number" ||
        (position !== null && typeof position !== "number")) throw new Error("Expected explicit bounded descriptor read");
    return read(fd, buffer, offset, Math.min(length, 2), position);
  });
  expect(Buffer.from(present(readInventoryFile(path, 6, budget())).value.bytes).toString()).toBe("abcdef");
});

it("hashes and parses the same single bounded byte observation", () => {
  const path = file("data.json", '{"answer":42}');
  const original = fs.readSync;
  let bytes = 0;
  vi.spyOn(fs, "readSync").mockImplementation((...args: Parameters<typeof fs.readSync>) => {
    const read = Reflect.apply(original, fs, args) as number;
    bytes += read;
    return read;
  });
  const result = present(readInventoryJson(path, budget())).value;
  expect(result.value).toEqual({ answer: 42 });
  expect(Buffer.from(result.file.bytes).toString("utf8")).toBe('{"answer":42}');
  expect(result.file.sha256).toBe(createHash("sha256").update('{"answer":42}').digest("hex"));
  expect(bytes).toBe(13);
});

it.each([
  ['duplicate', '{"a":1,"a":2}'], ['escaped duplicate', '{"a":1,"\\u0061":2}'],
  ['malformed', '{"a":}'], ['UTF-8', new Uint8Array([34, 255, 34])],
])("returns unknown for %s JSON", (_name, input) => {
  unknown(readInventoryJson(file("bad.json", input), budget()));
});

it.each([64, 65])("enforces %i object levels before recursive decoding", levels => {
  const text = '{"x":'.repeat(levels) + "0" + "}".repeat(levels);
  const result = readInventoryJson(file("nested.json", text), budget());
  if (levels === 64) present(result); else unknown(result);
  // The shared decoder's separate 128-level contract must remain unchanged.
  expect(() => decodeStrictJson('{"x":'.repeat(128) + "0" + "}".repeat(128))).not.toThrow();
});

it("counts nesting outside strings including escaped quotes", () => {
  present(readInventoryJson(file("string.json", JSON.stringify({ text: '{["\\'.repeat(100) })), budget()));
  unknown(readInventoryJson(file("arrays.json", "[".repeat(65) + "0" + "]".repeat(65)), budget()));
});

it("permits 16 MiB aggregate JSON and refuses its one-byte overflow", () => {
  const path = file("unit.json", '"' + "x".repeat(1048574) + '"');
  const accounting = budget();
  for (let index = 0; index < 16; index++) present(readInventoryJson(path, accounting));
  expect(accounting.jsonBytes).toBe(16777216);
  unknown(readInventoryJson(file("one.json", "0"), accounting));
});

it("permits 1,000 distinct inspected paths and refuses path 1,001", () => {
  const path = file("known");
  const accounting = budget();
  present(readInventoryFile(path, 3, accounting));
  let index = 0;
  while (accounting.paths.size < 1000) {
    expect(readInventoryFile(join(root, `missing-${index++}`), 1, accounting).state).toBe("absent");
  }
  expect(accounting.paths.size).toBe(1000);
  present(readInventoryFile(path, 3, accounting));
  unknown(readInventoryFile(join(root, "overflow"), 1, accounting));
  expect(accounting.paths.size).toBe(1000);
});

// F1: a shared missing ancestor must not hide distinct complete requested identities.
it.each(["file", "json", "directory"])("bounds distinct absent %s targets beneath a shared missing ancestor", kind => {
  const missing = join(root, "missing");
  const unvisited = join(missing, "unvisited");
  const accounting = budget();
  const expectedPaths = new Set([missing]);
  for (let parent = root;; parent = dirname(parent)) {
    expectedPaths.add(parent);
    if (dirname(parent) === parent) break;
  }
  const observe = (path: string) => kind === "file" ? readInventoryFile(path, 4, accounting)
    : kind === "json" ? readInventoryJson(path, accounting) : listInventoryDirectory(path, accounting);
  const lstat = fs.lstatSync;
  let statCalls = 0, descendantProbes = 0;
  vi.spyOn(fs, "lstatSync").mockImplementation((...args: Parameters<typeof fs.lstatSync>) => {
    statCalls++;
    if (String(args[0]).startsWith(missing + "/")) descendantProbes++;
    return Reflect.apply(lstat, fs, args);
  });
  let callsAtLimit: number | undefined;
  let lastAccepted = "";
  const first = join(unvisited, "requested-0");
  for (let index = 0; index < 1001; index++) {
    const path = join(unvisited, `requested-${index}`);
    if (expectedPaths.size < 1000) {
      expectedPaths.add(path);
      const result = observe(path);
      expect(result.state).toBe("absent");
      if (result.state !== "absent") throw new Error("Expected verified absence");
      expect(result.path).toBe(path);
      expect(result.verifiedParents.at(-1)?.path).toBe(root);
      lastAccepted = path;
      if (expectedPaths.size === 1000) callsAtLimit = statCalls;
    } else {
      unknown(observe(path));
      expect(statCalls).toBe(callsAtLimit);
    }
  }
  expect(accounting.paths).toEqual(expectedPaths);
  expect(accounting.paths.size).toBe(1000);
  expect(accounting.paths.has(lastAccepted)).toBe(true);
  expect(accounting.paths.has(unvisited)).toBe(false);
  expect(descendantProbes).toBe(0);
  // Reuse remains possible at the ceiling, without retaining rejected targets.
  for (let index = 0; index < 3; index++) expect(observe(first).state).toBe("absent");
  expect(accounting.paths).toEqual(expectedPaths);
});

// Breaks caught: following links, ENOTDIR-as-absence, blocking on nonregular leaves.
it.each(["root", "component", "leaf", "dangling"])("rejects a %s link without following it", location => {
  const target = file("target");
  fs.mkdirSync(join(root, "directory"));
  file("directory/child");
  const link = join(root, "link");
  fs.symlinkSync(location === "dangling" ? "missing" : location === "root" || location === "component" ? "directory" : target, link);
  const path = location === "component" ? join(link, "child") : link;
  unknown(readInventoryFile(path, 20, budget()));
  unknown(listInventoryDirectory(path, budget()));
});

it("reports ENOTDIR and nonregular file leaves as unknown", () => {
  const path = file("regular");
  unknown(readInventoryFile(join(path, "child"), 3, budget()));
  unknown(listInventoryDirectory(path, budget()));
  unknown(readInventoryFile(root, 3, budget()));
  const fifo = join(root, "pipe");
  execFileSync("mkfifo", [fifo]);
  unknown(readInventoryFile(fifo, 3, budget()));
  expect(present(listInventoryDirectory(root, budget())).value.entries).toContainEqual({ name: "pipe", type: "other" });
});

it.each(["replace", "resize", "same-size-write"])("refuses a %s during descriptor reads", operation => {
  const path = file("changing", "abc");
  const time = new Date(1700000000000);
  fs.utimesSync(path, time, time);
  const original = fs.readSync;
  let changed = false;
  let priorMtime: number | undefined, restoredMtime: number | undefined;
  vi.spyOn(fs, "readSync").mockImplementation((...args: Parameters<typeof fs.readSync>) => {
    const read = Reflect.apply(original, fs, args) as number;
    if (!changed) {
      changed = true;
      const stat = fs.statSync(path);
      priorMtime = stat.mtimeMs;
      if (operation === "replace") { fs.renameSync(path, path + ".old"); fs.writeFileSync(path, "abc"); }
      else fs.writeFileSync(path, operation === "resize" ? "abcd" : "xyz");
      fs.utimesSync(path, time, time);
      restoredMtime = fs.statSync(path).mtimeMs;
    }
    return read;
  });
  unknown(readInventoryFile(path, 10, budget()));
  expect(changed).toBe(true);
  expect(restoredMtime).toBe(priorMtime);
});

it("refuses parent replacement during a read", () => {
  fs.mkdirSync(join(root, "parent"));
  const path = file("parent/child");
  const original = fs.readSync;
  let changed = false;
  vi.spyOn(fs, "readSync").mockImplementation((...args: Parameters<typeof fs.readSync>) => {
    const read = Reflect.apply(original, fs, args) as number;
    if (!changed) {
      changed = true;
      fs.renameSync(join(root, "parent"), join(root, "old-parent"));
      fs.mkdirSync(join(root, "parent")); file("parent/child");
    }
    return read;
  });
  unknown(readInventoryFile(path, 10, budget()));
});

describe("module-local syscall faults with real fixtures", () => {
  it.each(["EACCES", "EPERM", "ENOTSUP"])("does not fall back after open %s", code => {
    const path = file("denied");
    let attempts = 0, fallbackReads = 0;
    const readFile = fs.readFileSync, read = fs.readSync;
    vi.spyOn(fs, "readFileSync").mockImplementation((...args: Parameters<typeof fs.readFileSync>) => {
      fallbackReads++; return Reflect.apply(readFile, fs, args);
    });
    vi.spyOn(fs, "readSync").mockImplementation((...args: Parameters<typeof fs.readSync>) => {
      fallbackReads++; return Reflect.apply(read, fs, args);
    });
    vi.spyOn(fs, "openSync").mockImplementation(() => {
      attempts++; throw Object.assign(new Error("injected filesystem refusal"), { code });
    });
    unknown(readInventoryFile(path, 3, budget()));
    expect(attempts).toBe(1);
    expect(fallbackReads).toBe(0);
  });

  it("requires no-follow support before attempting access", () => {
    const path = file("no-follow");
    let opens = 0;
    const open = fs.openSync;
    vi.spyOn(fs, "openSync").mockImplementation((...args: Parameters<typeof fs.openSync>) => {
      opens++; return open(...args);
    });
    vi.spyOn(fs, "constants", "get").mockReturnValue({ ...fs.constants, O_NOFOLLOW: undefined } as unknown as typeof fs.constants);
    unknown(readInventoryFile(path, 3, budget()));
    expect(opens).toBe(0);
  });

  it("rejects a leaf swapped for a link at open without reading its target", () => {
    const path = file("swapped"), target = file("target", "target must stay unread");
    const open = fs.openSync, read = fs.readSync;
    let bytes = 0;
    vi.spyOn(fs, "openSync").mockImplementation((...args: Parameters<typeof fs.openSync>) => {
      if (args[0] === path) { fs.unlinkSync(path); fs.symlinkSync(target, path); }
      return open(...args);
    });
    vi.spyOn(fs, "readSync").mockImplementation((...args: Parameters<typeof fs.readSync>) => {
      const count = Reflect.apply(read, fs, args) as number; bytes += count; return count;
    });
    unknown(readInventoryFile(path, 100, budget()));
    expect(bytes).toBe(0);
  });

  it.each(["EACCES", "EPERM"])("keeps parent traversal %s unknown without opening", code => {
    fs.mkdirSync(join(root, "parent"));
    const path = file("parent/child");
    const lstat = fs.lstatSync, open = fs.openSync;
    let opens = 0;
    vi.spyOn(fs, "lstatSync").mockImplementation((...args: Parameters<typeof fs.lstatSync>) => {
      if (args[0] === join(root, "parent")) throw Object.assign(new Error("injected traversal refusal"), { code });
      return Reflect.apply(lstat, fs, args);
    });
    vi.spyOn(fs, "openSync").mockImplementation((...args: Parameters<typeof fs.openSync>) => { opens++; return open(...args); });
    unknown(readInventoryFile(path, 3, budget()));
    expect(opens).toBe(0);
  });

  it("does not convert disappearance after traversal into absence", () => {
    const path = file("disappearing");
    vi.spyOn(fs, "openSync").mockImplementation(() => {
      fs.unlinkSync(path);
      throw Object.assign(new Error("disappeared at open"), { code: "ENOENT" });
    });
    unknown(readInventoryFile(path, 3, budget()));
  });

  it("does not certify absence after its parent identity changes", () => {
    fs.mkdirSync(join(root, "parent"));
    const missing = join(root, "parent", "missing");
    const lstat = fs.lstatSync;
    vi.spyOn(fs, "lstatSync").mockImplementation((...args: Parameters<typeof fs.lstatSync>) => {
      if (args[0] === missing) {
        fs.renameSync(join(root, "parent"), join(root, "old-parent"));
        fs.mkdirSync(join(root, "parent"));
        throw Object.assign(new Error("injected absent child after parent replacement"), { code: "ENOENT" });
      }
      return Reflect.apply(lstat, fs, args);
    });
    unknown(readInventoryFile(missing, 3, budget()));
  });

  it.each(["ino", "ctimeMs"] as const)("compares descriptor %s again after the read", field => {
    const path = file("descriptor-identity");
    const fstat = fs.fstatSync;
    let calls = 0;
    vi.spyOn(fs, "fstatSync").mockImplementation((...args: Parameters<typeof fs.fstatSync>) => {
      const stat = Reflect.apply(fstat, fs, args) as fs.Stats;
      if (++calls === 2) {
        const changed = Object.create(stat) as fs.Stats;
        Object.defineProperty(changed, field, { value: stat[field] + 1 });
        return changed;
      }
      return stat;
    });
    unknown(readInventoryFile(path, 3, budget()));
    expect(calls).toBe(2);
  });

  it("rejects a different descriptor before reading and closes it", () => {
    const path = file("expected"), other = file("other", "xyz");
    const open = fs.openSync, read = fs.readSync;
    let descriptor = -1, bytes = 0;
    vi.spyOn(fs, "openSync").mockImplementation((...args: Parameters<typeof fs.openSync>) => {
      descriptor = open(other, args[1]); return descriptor;
    });
    vi.spyOn(fs, "readSync").mockImplementation((...args: Parameters<typeof fs.readSync>) => {
      const count = Reflect.apply(read, fs, args) as number; bytes += count; return count;
    });
    unknown(readInventoryFile(path, 3, budget()));
    expect(bytes).toBe(0);
    expect(descriptor).toBeGreaterThanOrEqual(0);
    expect(() => fs.fstatSync(descriptor)).toThrow();
  });

  it("closes the descriptor on read failure", () => {
    const path = file("read-failure");
    const original = fs.openSync;
    let descriptor = -1;
    vi.spyOn(fs, "openSync").mockImplementation((...args: Parameters<typeof fs.openSync>) => {
      descriptor = original(...args); return descriptor;
    });
    vi.spyOn(fs, "readSync").mockImplementation(() => { throw Object.assign(new Error("read fault"), { code: "EIO" }); });
    unknown(readInventoryFile(path, 3, budget()));
    expect(descriptor).toBeGreaterThanOrEqual(0);
    expect(() => fs.fstatSync(descriptor)).toThrow();
  });

  it.each(["success", "overflow", "descriptor-fault"])("closes file descriptors after %s", outcome => {
    const path = file("closure");
    const open = fs.openSync, fstat = fs.fstatSync;
    let descriptor = -1;
    vi.spyOn(fs, "openSync").mockImplementation((...args: Parameters<typeof fs.openSync>) => { descriptor = open(...args); return descriptor; });
    if (outcome === "descriptor-fault") vi.spyOn(fs, "fstatSync").mockImplementation(() => { throw Object.assign(new Error("descriptor fault"), { code: "EIO" }); });
    const result = readInventoryFile(path, outcome === "overflow" ? 2 : 3, budget());
    if (outcome === "success") present(result); else unknown(result);
    expect(descriptor).toBeGreaterThanOrEqual(0);
    expect(() => fstat(descriptor)).toThrow();
  });

  it.each([false, true])("closes directory streams on success/failure=%s", fail => {
    file("entry");
    const original = fs.opendirSync;
    let stream: fs.Dir | undefined;
    vi.spyOn(fs, "opendirSync").mockImplementation((...args: Parameters<typeof fs.opendirSync>) => {
      stream = original(...args);
      if (fail) vi.spyOn(stream, "readSync").mockImplementation(() => { throw Object.assign(new Error("directory fault"), { code: "EIO" }); });
      return stream;
    });
    const result = listInventoryDirectory(root, budget());
    if (fail) unknown(result); else present(result);
    expect(stream).toBeDefined();
    expect(() => stream!.readSync()).toThrow();
  });

  it("resolves unknown entry types with lstat without following links", () => {
    file("entry");
    fs.mkdirSync(join(root, "directory"));
    fs.symlinkSync("entry", join(root, "link"));
    const original = fs.opendirSync;
    vi.spyOn(fs, "opendirSync").mockImplementation((...args: Parameters<typeof fs.opendirSync>) => {
      const stream = original(...args);
      const read = stream.readSync.bind(stream);
      vi.spyOn(stream, "readSync").mockImplementation(() => {
        const entry = read();
        if (entry) {
          vi.spyOn(entry, "isFile").mockReturnValue(false);
          vi.spyOn(entry, "isDirectory").mockReturnValue(false);
          vi.spyOn(entry, "isSymbolicLink").mockReturnValue(false);
        }
        return entry;
      });
      return stream;
    });
    expect(present(listInventoryDirectory(root, budget())).value.entries).toEqual([
      { name: "directory", type: "directory" }, { name: "entry", type: "file" }, { name: "link", type: "symlink" },
    ]);
  });
});
