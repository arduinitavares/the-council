import fs from "node:fs";
import { join, parse, resolve, sep } from "node:path";
import { canonicalJson } from "../domain/hash.js";
import { sha256 } from "./wrapper-contract.js";
import { decodeStrictJson } from "../workers/strict-json.js";

export type InventoryProblem = { code: string; path: string; edge: string | null };
export type NodeIdentity = {
  dev: number; ino: number; uid: number; gid: number; mode: number; size: number;
  mtimeMs: number; ctimeMs: number; type: "file" | "directory" | "symlink" | "other";
};
export type InventoryBudget = { paths: Set<string>; jsonBytes: number };
export type ReadReceipt = {
  path: string; before: NodeIdentity; after: NodeIdentity;
  components: readonly { path: string; identity: NodeIdentity }[];
};
/** Prior custody checked before payload reads; a null leaf pins an observed absence. */
export type InventoryFileBinding = {
  leaf: Readonly<Pick<NodeIdentity, "dev" | "ino" | "uid" | "gid" | "mode" | "size" | "mtimeMs" | "ctimeMs">> | null;
  components: readonly { path: string; dev: number; ino: number; uid: number; gid: number; mode: number }[];
};
export type InventoryRead<T> =
  | { state: "present"; value: T; receipt: ReadReceipt }
  | { state: "absent"; path: string; verifiedParents: ReadReceipt["components"] }
  | { state: "unknown"; problems: readonly InventoryProblem[] };
export type BoundedFile = { bytes: Uint8Array; sha256: string };
export type DirectoryListing = { entries: readonly { name: string; type: NodeIdentity["type"] }[] };

const MAX_PATHS = 1000;
const MAX_ENTRIES = 100;
const MAX_JSON_BYTES = 1048576;
const MAX_TOTAL_JSON_BYTES = 16777216;
const MAX_OBJECT_LEVELS = 64;
const MAX_ANCESTOR_LEVELS = 128;
type Components = { path: string; identity: NodeIdentity }[];

class InventoryFault extends Error {
  constructor(readonly code: string, readonly path: string) { super(code); }
}

function failure(path: string, error: unknown): InventoryRead<never> {
  const fault = error as { code?: unknown; path?: unknown } | null;
  return { state: "unknown", problems: [{
    code: typeof fault?.code === "string" ? fault.code : "INVENTORY_IO_UNKNOWN",
    path: typeof fault?.path === "string" ? fault.path : path,
    edge: null,
  }] };
}

function nodeType(node: Pick<fs.Stats, "isFile" | "isDirectory" | "isSymbolicLink">): NodeIdentity["type"] {
  return node.isSymbolicLink() ? "symlink" : node.isFile() ? "file" : node.isDirectory() ? "directory" : "other";
}

function identity(stat: fs.Stats): NodeIdentity {
  return { dev: stat.dev, ino: stat.ino, uid: stat.uid, gid: stat.gid,
    mode: stat.mode, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs,
    type: nodeType(stat) };
}

function same(before: NodeIdentity, after: NodeIdentity, path: string): void {
  if (canonicalJson(before) !== canonicalJson(after)) throw new InventoryFault("INVENTORY_UNSTABLE", path);
}

/** Charge complete requests, inspected parents and listed children once per budget. */
function chargePath(path: string, budget: InventoryBudget): void {
  if (budget.paths.size > MAX_PATHS || (!budget.paths.has(path) && budget.paths.size === MAX_PATHS)) {
    throw new InventoryFault("INVENTORY_PATH_LIMIT", path);
  }
  budget.paths.add(path);
}

function stableComponents(components: ReadReceipt["components"]): void {
  for (const component of components) same(component.identity, identity(fs.lstatSync(component.path)), component.path);
}

function inspectPath(input: string, budget: InventoryBudget):
  | { state: "present"; path: string; components: Components }
  | Extract<InventoryRead<never>, { state: "absent" }> {
  // Do not normalize away a link/.. traversal before inspecting its components.
  if (input.includes("\0") || input.split(sep).includes("..")) throw new InventoryFault("INVENTORY_PATH_INVALID", input);
  const path = resolve(input);
  const root = parse(path).root;
  const parts = path.slice(root.length).split(sep).filter(Boolean);
  if (parts.length > MAX_ANCESTOR_LEVELS) throw new InventoryFault("INVENTORY_ANCESTOR_LIMIT", path);
  // Account for the full request even when traversal stops at a missing ancestor.
  // Refuse new identities at capacity before doing any filesystem work.
  chargePath(path, budget);
  const components: Components = [];
  let current = root;
  for (let index = 0; index <= parts.length; index++) {
    if (index > 0) current = join(current, parts[index - 1]!);
    chargePath(current, budget);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      // Only traversal ENOENT, with a stable verified parent, proves absence.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || components.length === 0) throw error;
      stableComponents(components);
      return { state: "absent", path, verifiedParents: components };
    }
    const entry = identity(stat);
    if (entry.type === "symlink") throw new InventoryFault("INVENTORY_SYMLINK", current);
    if (index < parts.length && entry.type !== "directory") throw new InventoryFault("ENOTDIR", current);
    components.push({ path: current, identity: entry });
  }
  return { state: "present", path, components };
}

function noFollowFlags(path: string, directory: boolean): number {
  const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK, O_DIRECTORY } = fs.constants;
  if (!Number.isInteger(O_NOFOLLOW) || O_NOFOLLOW === 0 ||
      !Number.isInteger(O_NONBLOCK) || O_NONBLOCK === 0 ||
      (directory && (!Number.isInteger(O_DIRECTORY) || O_DIRECTORY === 0))) {
    throw new InventoryFault("INVENTORY_NOFOLLOW_UNAVAILABLE", path);
  }
  // Nonblocking prevents a raced replacement with a FIFO from blocking open.
  return O_RDONLY | O_NOFOLLOW | O_NONBLOCK | (directory ? O_DIRECTORY : 0);
}

function boundFile(binding: InventoryFileBinding, stat: fs.Stats, components: Components, path: string): void {
  const leafKeys = ["dev", "ino", "uid", "gid", "mode", "size", "mtimeMs", "ctimeMs"] as const;
  const leaf = binding.leaf;
  if (!leaf || !stat.isFile() || stat.nlink !== 1 || leafKeys.some(key => stat[key] !== leaf[key])) {
    throw new InventoryFault("INVENTORY_BOUND_FILE_CHANGED", path);
  }
  const keys = ["dev", "ino", "uid", "gid", "mode"] as const;
  for (const expected of binding.components) {
    const observed = components.find(component => component.path === expected.path)?.identity;
    if (!observed || keys.some(key => observed[key] !== expected[key])) {
      throw new InventoryFault("INVENTORY_BOUND_COMPONENT_CHANGED", expected.path);
    }
  }
}

/** No fallback after a refusal. Checks detect in-inspection changes, not future races. */
function observe<T>(input: string, budget: InventoryBudget, type: "file" | "directory",
  read: (path: string, fd: number, components: Components) => T,
  binding?: InventoryFileBinding): InventoryRead<T> {
  try {
    const inspected = inspectPath(input, budget);
    if (inspected.state === "absent") return inspected;
    const { path, components } = inspected;
    const before = components[components.length - 1]!.identity;
    if (before.type !== type) throw new InventoryFault("INVENTORY_NODE_TYPE", path);
    const flags = noFollowFlags(path, type === "directory");
    stableComponents(components);
    const fd = fs.openSync(path, flags);
    try {
      same(before, identity(fs.fstatSync(fd)), path);
      stableComponents(components);
      if (binding) boundFile(binding, fs.fstatSync(fd), components, path);
      const value = read(path, fd, components);
      const finalStat = fs.fstatSync(fd), after = identity(finalStat);
      same(before, after, path);
      if (binding) boundFile(binding, finalStat, components, path);
      stableComponents(components);
      return { state: "present", value, receipt: { path, before, after, components } };
    } finally { fs.closeSync(fd); }
  } catch (error) { return failure(input, error); }
}

function readFile(input: string, limit: number, budget: InventoryBudget,
  onRead: (bytes: number) => void = () => {}, binding?: InventoryFileBinding): InventoryRead<BoundedFile> {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit >= Number.MAX_SAFE_INTEGER) {
    return failure(input, new InventoryFault("INVENTORY_BYTE_LIMIT_INVALID", input));
  }
  return observe(input, budget, "file", (path, fd) => {
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= limit) {
      const chunk = Buffer.alloc(Math.min(65536, limit + 1 - total));
      const count = fs.readSync(fd, chunk, 0, chunk.length, null);
      onRead(count);
      if (count === 0) break;
      total += count;
      if (total > limit) throw new InventoryFault("INVENTORY_BYTE_LIMIT", path);
      chunks.push(chunk.subarray(0, count));
    }
    const bytes = Buffer.concat(chunks, total);
    return { bytes, sha256: sha256(bytes) };
  }, binding);
}

export function readInventoryFile(path: string, limit: number, budget: InventoryBudget): InventoryRead<BoundedFile> {
  return readFile(path, limit, budget);
}

/** Scan delimiters iteratively before either recursive JSON decoder/validator runs. */
function guardJsonDepth(text: string, path: string): void {
  let depth = 0, quoted = false, escaped = false;
  for (const character of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === "{" || character === "[") {
      if (++depth > MAX_OBJECT_LEVELS) throw new InventoryFault("INVENTORY_JSON_DEPTH", path);
    } else if (character === "}" || character === "]") depth--;
  }
}

export function readInventoryJson(path: string, budget: InventoryBudget,
  binding?: InventoryFileBinding): InventoryRead<{ value: unknown; file: BoundedFile }> {
  if (!Number.isSafeInteger(budget.jsonBytes) || budget.jsonBytes < 0 || budget.jsonBytes > MAX_TOTAL_JSON_BYTES) {
    return failure(path, new InventoryFault("INVENTORY_TOTAL_JSON_LIMIT", path));
  }
  const limit = Math.min(MAX_JSON_BYTES, MAX_TOTAL_JSON_BYTES - budget.jsonBytes);
  const expected = binding && { leaf: binding.leaf && { ...binding.leaf }, components: binding.components.map(component => ({ ...component })) };
  const result = readFile(path, limit, budget, count => { budget.jsonBytes += count; }, expected);
  if (result.state !== "present") return result;
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(result.value.bytes);
    guardJsonDepth(text, path);
    const value = decodeStrictJson(text);
    return { state: "present", value: { value, file: result.value }, receipt: result.receipt };
  } catch (error) {
    return failure(path, error instanceof InventoryFault ? error : new InventoryFault("INVENTORY_JSON_INVALID", path));
  }
}

export function listInventoryDirectory(input: string, budget: InventoryBudget): InventoryRead<DirectoryListing> {
  return observe(input, budget, "directory", (path, _fd, components) => {
    // Latin-1 preserves each filename byte until fatal UTF-8 decoding below.
    const directory = fs.opendirSync(path, { bufferSize: 1, encoding: "latin1" });
    try {
      stableComponents(components);
      const entries: { name: string; type: NodeIdentity["type"] }[] = [];
      for (;;) {
        const entry = directory.readSync();
        if (!entry) break;
        // Fetch only the one overflow entry, never return a successful prefix.
        if (entries.length === MAX_ENTRIES) throw new InventoryFault("INVENTORY_DIRECTORY_LIMIT", path);
        let name: string;
        try { name = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.from(entry.name, "latin1")); }
        catch { throw new InventoryFault("INVENTORY_ENTRY_NAME_INVALID", path); }
        if (!name || name === "." || name === ".." || name.includes(sep)) {
          throw new InventoryFault("INVENTORY_ENTRY_NAME_INVALID", path);
        }
        const child = join(path, name);
        chargePath(child, budget);
        let type = nodeType(entry);
        if (type === "other") {
          stableComponents(components);
          type = nodeType(fs.lstatSync(child));
          stableComponents(components);
        }
        entries.push({ name, type });
      }
      // This order is presentation only; it is never provider loader order.
      entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      return { entries };
    } finally { directory.closeSync(); }
  });
}
