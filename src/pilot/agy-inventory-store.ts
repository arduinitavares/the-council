import fs from "node:fs";
import { isAbsolute, join, normalize, parse, sep } from "node:path";
import type { AuditSource } from "./control-audit.js";
import { sha256 } from "./wrapper-contract.js";
import { readInventoryJson, type InventoryBudget, type InventoryRead, type ReadReceipt, type InventoryFileBinding } from "./inventory-io.js";
import { decodeAgyInventoryWitness, encodeAgyInventoryWitness, type EncodedWitness, type InventoryCore } from "./agy-inventory-witness.js";

type DirectoryIdentity = { path: string; dev: number; ino: number; uid: number; gid: number; mode: number };
const LIMIT = 1048576;
const fingerprintPattern = /^[a-f0-9]{64}$/;
const freshBudget = (): InventoryBudget => ({ paths: new Set(), jsonBytes: 0 });

function need(ok: unknown, code: string): asserts ok { if (!ok) throw Error(code); }
function errno(error: unknown): string | undefined { return (error as NodeJS.ErrnoException | null)?.code; }
function owner(): number {
  const uid = process.geteuid?.();
  need(uid !== undefined && Number.isSafeInteger(uid), "INVENTORY_STORE_OWNER_UNAVAILABLE");
  return uid;
}
function directoryIdentity(path: string, privateDirectory: boolean): DirectoryIdentity {
  const stat = fs.lstatSync(path);
  need(stat.isDirectory() && !stat.isSymbolicLink() && fs.realpathSync(path) === path, "INVENTORY_STORE_DIRECTORY_CUSTODY");
  if (privateDirectory) need(stat.uid === owner() && (stat.mode & 0o7777) === 0o700, "INVENTORY_STORE_DIRECTORY_CUSTODY");
  return { path, dev: stat.dev, ino: stat.ino, uid: stat.uid, gid: stat.gid, mode: stat.mode };
}
function sameDirectory(expected: DirectoryIdentity, privateDirectory: boolean): void {
  const actual = directoryIdentity(expected.path, privateDirectory);
  need(actual.dev === expected.dev && actual.ino === expected.ino && actual.uid === expected.uid &&
    actual.gid === expected.gid && actual.mode === expected.mode, "INVENTORY_STORE_DIRECTORY_CHANGED");
}
function workspacePath(workspace: string): string {
  need(isAbsolute(workspace) && normalize(workspace) === workspace && !workspace.includes("\0"), "INVENTORY_STORE_WORKSPACE_INVALID");
  const real = fs.realpathSync(workspace);
  // Canonical identities still receive no-follow component checks.
  const root = parse(real).root, parts = real.slice(root.length).split(sep).filter(Boolean);
  need(parts.length <= 128, "INVENTORY_STORE_ANCESTOR_LIMIT");
  let current = root;
  directoryIdentity(current, false);
  for (const part of parts) { current = join(current, part); directoryIdentity(current, false); }
  return real;
}
function directories(real: string): string[] {
  const council = join(real, ".council"), audits = join(council, "control-audits");
  return [council, audits, join(audits, "inventories"), join(audits, "snapshots"), join(audits, "dispositions")];
}
function verifyChain(workspace: DirectoryIdentity, chain: readonly DirectoryIdentity[]): void {
  sameDirectory(workspace, false);
  for (const entry of chain) sameDirectory(entry, true);
}

/** Mechanical custody only. Calling this helper conveys no loader authority. */
export function prepareAgyAuditDirectories(workspace: string): void {
  const real = workspacePath(workspace), base = directoryIdentity(real, false), chain: DirectoryIdentity[] = [];
  for (const path of directories(real)) {
    verifyChain(base, chain);
    try { fs.lstatSync(path); }
    catch (error) {
      if (errno(error) !== "ENOENT") throw error;
      verifyChain(base, chain);
      try { fs.mkdirSync(path, { mode: 0o700 }); }
      catch (mkdirError) { if (errno(mkdirError) !== "EEXIST") throw mkdirError; }
    }
    chain.push(directoryIdentity(path, true));
    verifyChain(base, chain);
  }
}
function checkedLayout(workspace: string): { real: string; base: DirectoryIdentity; chain: DirectoryIdentity[] } {
  const real = workspacePath(workspace), base = directoryIdentity(real, false), chain: DirectoryIdentity[] = [];
  for (const path of directories(real)) {
    try { chain.push(directoryIdentity(path, true)); }
    catch (error) { if (errno(error) !== "ENOENT") throw error; }
  }
  verifyChain(base, chain);
  return { real, base, chain };
}
function pathFor(real: string, fingerprint: string): string {
  need(fingerprintPattern.test(fingerprint), "INVENTORY_STORE_FINGERPRINT_INVALID");
  return join(real, ".council", "control-audits", "inventories", fingerprint + ".json");
}
function fileCustody(stat: Pick<fs.Stats, "isFile" | "isSymbolicLink" | "uid" | "mode" | "nlink">): void {
  need(stat.isFile() && !stat.isSymbolicLink() && stat.uid === owner() &&
    (stat.mode & 0o7777) === 0o600 && stat.nlink === 1, "INVENTORY_STORE_FILE_CUSTODY");
}
function receiptCustody(receipt: ReadReceipt): void {
  need(receipt.before.type === "file" && receipt.before.uid === owner() &&
    (receipt.before.mode & 0o7777) === 0o600, "INVENTORY_STORE_FILE_CUSTODY");
}
function sameFile(stat: fs.Stats, receipt: ReadReceipt): void {
  const before = receipt.before;
  need(stat.dev === before.dev && stat.ino === before.ino && stat.uid === before.uid &&
    stat.gid === before.gid && stat.mode === before.mode && stat.size === before.size &&
    stat.mtimeMs === before.mtimeMs && stat.ctimeMs === before.ctimeMs, "INVENTORY_STORE_FILE_CHANGED");
}
function unknown(path: string, error: unknown): InventoryRead<never> {
  return { state: "unknown", problems: [{ code: errno(error) ?? (error instanceof Error ? error.message : "INVENTORY_STORE_UNKNOWN"), path, edge: null }] };
}

function acquireWitness(workspace: string, fingerprint: string, budget: InventoryBudget, retained?: InventoryFileBinding):
  InventoryRead<{ core: InventoryCore; encoded: EncodedWitness }> {
  let path = workspace;
  try {
    const { real, base, chain } = checkedLayout(workspace);
    path = pathFor(real, fingerprint);
    verifyChain(base, chain);
    let initial: fs.Stats | undefined;
    try { initial = fs.lstatSync(path); fileCustody(initial); }
    catch (error) { if (errno(error) !== "ENOENT") throw error; }
    if (retained) need(initial, "INVENTORY_STORE_FILE_CHANGED");
    verifyChain(base, chain);
    const binding = retained ?? { leaf: initial ?? null, components: [base, ...chain.filter(component => path.startsWith(component.path + sep))] };
    const read = readInventoryJson(path, budget, binding);
    need(!initial || read.state !== "absent", "INVENTORY_STORE_FILE_CHANGED");
    if (read.state !== "present") {
      if (read.state === "absent") verifyChain(base, chain);
      return read;
    }
    receiptCustody(read.receipt);
    need(initial, "INVENTORY_STORE_FILE_CHANGED");
    sameFile(initial, read.receipt);
    const linked = fs.lstatSync(path);
    fileCustody(linked); sameFile(linked, read.receipt);
    verifyChain(base, chain);
    const core = decodeAgyInventoryWitness(read.value.file.bytes);
    need(core.context.requestingWorkspace === real, "INVENTORY_STORE_WORKSPACE_MISMATCH");
    const encoded = encodeAgyInventoryWitness(core);
    need(encoded.fingerprint === fingerprint && encoded.sha256 === read.value.file.sha256, "INVENTORY_STORE_IDENTITY_MISMATCH");
    const final = fs.lstatSync(path);
    fileCustody(final); sameFile(final, read.receipt);
    verifyChain(base, chain);
    return { state: "present", value: { core, encoded }, receipt: read.receipt };
  } catch (error) { return unknown(path, error); }
}

export function readAgyInventoryWitness(workspace: string, fingerprint: string, budget: InventoryBudget):
  InventoryRead<{ core: InventoryCore; encoded: EncodedWitness }> {
  return acquireWitness(workspace, fingerprint, budget);
}

function intendedCopy(encoded: EncodedWitness): EncodedWitness {
  // Copy once before a filesystem operation can expose caller mutation.
  const intended = { fingerprint: encoded.fingerprint, sha256: encoded.sha256, bytes: Buffer.from(encoded.bytes) };
  need(intended.bytes.length <= LIMIT && fingerprintPattern.test(intended.fingerprint) &&
    fingerprintPattern.test(intended.sha256) && sha256(intended.bytes) === intended.sha256, "INVENTORY_STORE_ENCODED_MISMATCH");
  const canonical = encodeAgyInventoryWitness(decodeAgyInventoryWitness(intended.bytes));
  need(canonical.fingerprint === intended.fingerprint && canonical.sha256 === intended.sha256, "INVENTORY_STORE_ENCODED_MISMATCH");
  return intended;
}
function equalExisting(workspace: string, intended: EncodedWitness, retained?: InventoryFileBinding): AuditSource {
  const read = acquireWitness(workspace, intended.fingerprint, freshBudget(), retained);
  need(read.state === "present", "INVENTORY_STORE_COLLISION");
  need(read.value.encoded.sha256 === intended.sha256 &&
    Buffer.from(read.value.encoded.bytes).equals(intended.bytes), "INVENTORY_STORE_COLLISION");
  return { path: read.receipt.path, kind: "file", sha256: intended.sha256 };
}

export function persistAgyInventoryWitness(workspace: string, encoded: EncodedWitness): AuditSource {
  const intended = intendedCopy(encoded);
  const real = workspacePath(workspace);
  need(decodeAgyInventoryWitness(intended.bytes).context.requestingWorkspace === real, "INVENTORY_STORE_WORKSPACE_MISMATCH");
  prepareAgyAuditDirectories(real);
  const { base, chain } = checkedLayout(real), path = pathFor(real, intended.fingerprint);
  verifyChain(base, chain);
  const { O_WRONLY, O_CREAT, O_EXCL, O_NOFOLLOW, O_NONBLOCK } = fs.constants;
  need(Number.isInteger(O_NOFOLLOW) && O_NOFOLLOW !== 0 && Number.isInteger(O_NONBLOCK) && O_NONBLOCK !== 0,
    "INVENTORY_STORE_NOFOLLOW_UNAVAILABLE");
  let fd: number;
  try { fd = fs.openSync(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_NONBLOCK, 0o600); }
  catch (error) {
    if (errno(error) !== "EEXIST") throw error;
    verifyChain(base, chain);
    const source = equalExisting(real, intended);
    verifyChain(base, chain);
    return source;
  }
  let written: fs.Stats | undefined;
  try {
    fileCustody(fs.fstatSync(fd)); verifyChain(base, chain);
    let offset = 0;
    while (offset < intended.bytes.length) {
      const count = fs.writeSync(fd, intended.bytes, offset, intended.bytes.length - offset, null);
      need(Number.isInteger(count) && count > 0 && count <= intended.bytes.length - offset, "INVENTORY_STORE_PARTIAL_WRITE");
      offset += count;
      verifyChain(base, chain);
    }
    fs.fsyncSync(fd);
    written = fs.fstatSync(fd);
    const linked = fs.lstatSync(path);
    fileCustody(written); fileCustody(linked);
    need(written.dev === linked.dev && written.ino === linked.ino && written.size === intended.bytes.length,
      "INVENTORY_STORE_FILE_CHANGED");
    verifyChain(base, chain);
  } finally { fs.closeSync(fd); }
  // A failed write is intentionally left in place; only exact bounded readback succeeds.
  need(written, "INVENTORY_STORE_FILE_CHANGED");
  const source = equalExisting(real, intended, { leaf: written, components: [base, ...chain.filter(component => path.startsWith(component.path + sep))] });
  verifyChain(base, chain);
  return source;
}
