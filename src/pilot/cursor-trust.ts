import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync, type BigIntStats } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { decodeStrictJson } from "../workers/strict-json.js";
import type { Observation } from "./types.js";

export interface CursorTrustContext {
  workspace: string;
  packetCwd: string;
  home: string;
  dataRoot: string | undefined;
}
export type CursorTrustReason =
  | "CURSOR_TRUST_ABSENT" | "CURSOR_TRUST_UNREADABLE" | "CURSOR_TRUST_NOT_REGULAR"
  | "CURSOR_TRUST_TOO_LARGE" | "CURSOR_TRUST_MALFORMED" | "CURSOR_TRUST_CONTRACT_UNSUPPORTED"
  | "CURSOR_TRUST_PATH_MISMATCH" | "CURSOR_TRUST_PATH_UNVERIFIED" | "CURSOR_TRUST_SOURCE_DRIFT";
export interface CursorTrustDirectoryIdentity {
  ordinal: number;
  dev: string;
  ino: string;
  uid: string;
  gid: string;
  mode: string;
}
export interface CursorTrustMarkerIdentity extends CursorTrustDirectoryIdentity {
  nlink: string;
  size: string;
  mtimeNs: string;
  ctimeNs: string;
}
export interface CursorTrustEvidence {
  candidateOrdinal: number;
  relation: "direct" | "ancestor";
  earlierAbsences: number[];
  contextSha256: string;
  directories: CursorTrustDirectoryIdentity[];
  marker: CursorTrustMarkerIdentity;
  byteCount: number;
  contentSha256: string;
}
export interface CursorTrustAcquisition {
  nativeAdmission: Observation;
  exactIdentity: Observation;
  reason: CursorTrustReason | null;
  evidence: CursorTrustEvidence | null;
}

const PATH_BYTES = 4096, COMPONENTS = 128, MARKER_BYTES = 16384;
const ENTRY_COUNT = 4096, ENTRY_BYTES = 1024 * 1024;
const normalize = (value: string) => value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const identityFields = ["dev", "ino", "uid", "gid", "mode"] as const;
const markerFields = [...identityFields, "nlink", "size", "mtimeNs", "ctimeNs"] as const;
const directoryFields = [...identityFields, "mtimeNs", "ctimeNs"] as const;
class AcquisitionFailure extends Error {
  constructor(readonly reason: CursorTrustReason, readonly state: Observation["state"] = "unknown") { super(reason); }
}
function fail(reason: CursorTrustReason, state?: Observation["state"]): never { throw new AcquisitionFailure(reason, state); }
const pathShape = (value: string) => typeof value === "string" && isAbsolute(value) && !value.includes("\0") &&
  Buffer.byteLength(value, "utf8") <= PATH_BYTES && value.split(sep).filter(Boolean).length <= COMPONENTS &&
  (value === sep || value.split(sep).slice(1).every(part => part !== "" && part !== "." && part !== ".."));
const within = (parent: string, child: string) => {
  const suffix = relative(parent, child);
  return suffix !== "" && suffix !== ".." && !suffix.startsWith(".." + sep) && !isAbsolute(suffix);
};
// Only these fixed macOS root aliases are recognized. Descendant aliases are
// rejected, and no path obtained from marker content is ever resolved.
const initialCanonical = (value: string) => value === "/var" || value.startsWith("/var/") || value === "/tmp" || value.startsWith("/tmp/") ? "/private" + value : value;
const same = (a: BigIntStats, b: BigIntStats, fields: readonly (keyof BigIntStats)[]) => fields.every(field => a[field] === b[field]);
const directoryIdentity = (stat: BigIntStats, ordinal: number): CursorTrustDirectoryIdentity => ({
  ordinal, dev: stat.dev.toString(), ino: stat.ino.toString(), uid: stat.uid.toString(), gid: stat.gid.toString(), mode: stat.mode.toString(),
});
const markerIdentity = (stat: BigIntStats, ordinal: number): CursorTrustMarkerIdentity => ({
  ...directoryIdentity(stat, ordinal), nlink: stat.nlink.toString(), size: stat.size.toString(), mtimeNs: stat.mtimeNs.toString(), ctimeNs: stat.ctimeNs.toString(),
});
const errno = (cause: unknown) => cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
const observation = (state: Observation["state"], native: boolean, detail: string): Observation => ({
  state, source: native ? "Cursor source-derived admission evidence" : "Council local stored-path comparison",
  detail: native ? `Source-derived admission evidence: ${detail}` : detail,
});

/** Bounded, read-only local acquisition under the declared stable namespace
 * model. This is not a production qualification constructor: it establishes no
 * build, ACL, registration, launch or atomic handoff authority. */
export function acquireCursorTrust(context: CursorTrustContext): CursorTrustAcquisition {
  let native: Observation["state"] = "unknown";
  let selectionCheck: (() => void) | undefined, checkingSelection = false;
  const result = (state: Observation["state"], reason: CursorTrustReason | null, evidence: CursorTrustEvidence | null = null): CursorTrustAcquisition => ({
    nativeAdmission: observation(native, true, reason ?? "Local source-derived admission evidence acquired"),
    exactIdentity: observation(state, false, reason ?? `Local exact ${evidence!.relation} coverage`), reason, evidence,
  });
  try {
    const { workspace, packetCwd, home } = context;
    const root = context.dataRoot?.trim() ? context.dataRoot : join(home, ".cursor");
    if (![workspace, packetCwd, home].every(pathShape)) fail("CURSOR_TRUST_PATH_UNVERIFIED");
    if (!pathShape(root)) fail("CURSOR_TRUST_CONTRACT_UNSUPPORTED", "unsupported");
    if (packetCwd !== join(workspace, ".council/native-packets")) fail("CURSOR_TRUST_PATH_UNVERIFIED");
    if (process.platform !== "darwin" || typeof process.getuid !== "function" || !constants.O_NONBLOCK || !constants.O_NOFOLLOW) {
      fail("CURSOR_TRUST_CONTRACT_UNSUPPORTED", "unsupported");
    }
    const uid = BigInt(process.getuid());
    const canonical = { workspace: initialCanonical(workspace), packetCwd: initialCanonical(packetCwd), home: initialCanonical(home), root: initialCanonical(root) };
    const projects = join(canonical.root, "projects");
    const candidates = [{ spelling: packetCwd, canonical: canonical.packetCwd, key: normalize(packetCwd) }];
    let current = packetCwd;
    while (dirname(current) !== current) {
      current = dirname(current);
      if (current === home || within(current, home) || current.split(sep).filter(Boolean).length < 3) continue;
      candidates.push({ spelling: current, canonical: initialCanonical(current), key: normalize(current) });
    }
    // Bound all candidate work before the first filesystem lookup.
    if (candidates.length > COMPONENTS || !Object.values(canonical).every(pathShape) ||
        candidates.some(candidate => !candidate.key || !pathShape(candidate.canonical) ||
          !pathShape(join(projects, candidate.key, ".workspace-trusted")))) fail("CURSOR_TRUST_PATH_UNVERIFIED");

    const directories = new Map<string, BigIntStats>();
    const absences = new Set<string>();
    const stat = (target: string): BigIntStats | null => {
      try { return lstatSync(target, { bigint: true }); }
      catch (cause) {
        if (errno(cause) === "ENOENT") { absences.add(target); return null; }
        throw cause;
      }
    };
    const directory = (target: string, owned: boolean, missing: boolean): BigIntStats | null => {
      let component: string = sep;
      for (const part of ["", ...target.split(sep).filter(Boolean)]) {
        if (part) component = join(component, part);
        const value = stat(component);
        if (!value) { if (missing) return null; fail("CURSOR_TRUST_PATH_UNVERIFIED"); }
        if (!value.isDirectory() || value.isSymbolicLink()) fail("CURSOR_TRUST_PATH_UNVERIFIED");
        if ((value.uid !== uid && value.uid !== 0n) || (value.mode & 0o022n) !== 0n || (owned && component === target && value.uid !== uid)) {
          fail("CURSOR_TRUST_CONTRACT_UNSUPPORTED", "unsupported");
        }
        if (realpathSync(component) !== component) fail("CURSOR_TRUST_PATH_UNVERIFIED");
        const previous = directories.get(component);
        if (previous && !same(previous, value, directoryFields)) fail("CURSOR_TRUST_SOURCE_DRIFT");
        directories.set(component, value);
      }
      return directories.get(target)!;
    };
    const recheck = () => {
      for (const [target, before] of directories) {
        const after = lstatSync(target, { bigint: true });
        if (!after.isDirectory() || after.isSymbolicLink() || !same(before, after, directoryFields) || realpathSync(target) !== target) fail("CURSOR_TRUST_SOURCE_DRIFT");
      }
      for (const target of absences) if (stat(target)) fail("CURSOR_TRUST_SOURCE_DRIFT");
    };
    const absent = () => { recheck(); native = "missing"; return result("missing", "CURSOR_TRUST_ABSENT"); };
    directory(canonical.workspace, true, false);
    directory(canonical.packetCwd, true, false);
    directory(canonical.home, true, false);
    if (!directory(canonical.root, true, true) || !directory(projects, true, true)) return absent();

    const probe = (ordinal: number): BigIntStats | null => {
      const candidate = candidates[ordinal]!;
      if (!directory(join(projects, candidate.key), true, true)) return null;
      return stat(join(projects, candidate.key, ".workspace-trusted"));
    };
    const earlierAbsences: number[] = [];
    let ordinal = 0, leaf = probe(0);
    if (!leaf) {
      earlierAbsences.push(0);
      const names = new Set<string>();
      const wanted = new Set(candidates.slice(1).map(candidate => candidate.key));
      const dir = opendirSync(projects);
      try {
        let count = 0, bytes = 0;
        for (;;) {
          const entry = dir.readSync();
          if (!entry) break;
          if (++count > ENTRY_COUNT || (bytes += Buffer.byteLength(entry.name, "utf8")) > ENTRY_BYTES) fail("CURSOR_TRUST_PATH_UNVERIFIED");
          if (wanted.has(entry.name)) names.add(entry.name);
        }
      } finally { dir.closeSync(); }
      recheck();
      for (ordinal = 1; ordinal < candidates.length; ordinal++) {
        if (names.has(candidates[ordinal]!.key)) leaf = probe(ordinal);
        if (leaf) break;
        earlierAbsences.push(ordinal);
      }
      if (!leaf) return absent();
    }
    const candidate = candidates[ordinal]!;
    if (leaf.isSymbolicLink()) fail("CURSOR_TRUST_NOT_REGULAR");
    if (ordinal && (candidate.canonical === canonical.home || within(candidate.canonical, canonical.home) ||
        candidate.canonical.split(sep).filter(Boolean).length < 3 || !within(candidate.canonical, canonical.packetCwd))) fail("CURSOR_TRUST_PATH_UNVERIFIED");
    directory(candidate.canonical, ordinal === 0, false);
    const target = join(projects, candidate.key, ".workspace-trusted");
    selectionCheck = () => {
      checkingSelection = true;
      const current = lstatSync(target, { bigint: true });
      if (current.isSymbolicLink() || !same(leaf, current, markerFields)) fail("CURSOR_TRUST_SOURCE_DRIFT");
      recheck();
      checkingSelection = false;
    };
    selectionCheck();
    native = "verified";
    if (!leaf.isFile()) fail("CURSOR_TRUST_NOT_REGULAR");
    if (leaf.nlink !== 1n || leaf.uid !== uid || (leaf.mode & 0o022n) !== 0n) fail("CURSOR_TRUST_CONTRACT_UNSUPPORTED", "unsupported");
    if (leaf.size > BigInt(MARKER_BYTES)) fail("CURSOR_TRUST_TOO_LARGE");
    const fd = openSync(target, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    let buffer: Buffer | undefined;
    try {
      const before = fstatSync(fd, { bigint: true });
      if (!before.isFile()) fail("CURSOR_TRUST_SOURCE_DRIFT");
      if (!same(leaf, before, markerFields)) fail("CURSOR_TRUST_SOURCE_DRIFT");
      buffer = Buffer.alloc(MARKER_BYTES + 1);
      let size = 0;
      while (size < buffer.length) {
        const bytes = readSync(fd, buffer, size, buffer.length - size, null);
        if (!bytes) break;
        size += bytes;
      }
      if (size > MARKER_BYTES) fail("CURSOR_TRUST_TOO_LARGE");
      const after = fstatSync(fd, { bigint: true });
      checkingSelection = true;
      const finalLeaf = lstatSync(target, { bigint: true });
      if (!after.isFile() || !finalLeaf.isFile() || finalLeaf.isSymbolicLink() ||
          !same(before, after, markerFields) || !same(before, finalLeaf, markerFields) || BigInt(size) !== before.size) fail("CURSOR_TRUST_SOURCE_DRIFT");
      recheck();
      checkingSelection = false;
      let parsed: unknown;
      try { parsed = decodeStrictJson(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, size))); }
      catch { fail("CURSOR_TRUST_MALFORMED"); }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("CURSOR_TRUST_MALFORMED");
      const record = parsed as Record<string, unknown>;
      if (Object.keys(record).some(field => !["workspacePath", "trustedAt", "trustMethod", "sourceWorkspacePath"].includes(field))) fail("CURSOR_TRUST_CONTRACT_UNSUPPORTED", "unsupported");
      if (typeof record.workspacePath !== "string" || typeof record.trustedAt !== "string" ||
          ("trustMethod" in record && typeof record.trustMethod !== "string") ||
          ("sourceWorkspacePath" in record && (typeof record.sourceWorkspacePath !== "string" || Buffer.byteLength(record.sourceWorkspacePath, "utf8") > PATH_BYTES))) fail("CURSOR_TRUST_MALFORMED");
      if ("trustMethod" in record && record.trustMethod !== "cli-flag" && record.trustMethod !== "inherited") fail("CURSOR_TRUST_CONTRACT_UNSUPPORTED", "unsupported");
      const timestamp = new Date(record.trustedAt);
      if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== record.trustedAt) fail("CURSOR_TRUST_MALFORMED");
      if (!pathShape(record.workspacePath)) fail("CURSOR_TRUST_PATH_UNVERIFIED");
      // Exact spelling identifies an already validated candidate; foreign fields
      // never cause stat/realpath calls, including a source-workspace hint.
      if (record.workspacePath !== candidate.spelling || normalize(record.workspacePath) !== candidate.key) fail("CURSOR_TRUST_PATH_MISMATCH");
      return result("verified", null, {
        candidateOrdinal: ordinal, relation: ordinal ? "ancestor" : "direct", earlierAbsences,
        contextSha256: hash(JSON.stringify([canonical.workspace, canonical.packetCwd, canonical.home, canonical.root])),
        directories: [...directories.values()].map((value, index) => directoryIdentity(value, index)),
        marker: markerIdentity(before, ordinal), byteCount: size, contentSha256: hash(buffer.subarray(0, size)),
      });
    } finally { try { closeSync(fd); } finally { buffer?.fill(0); } }
  } catch (cause) {
    const denied = (error: unknown) => ["EACCES", "EPERM", "ERR_ACCESS_DENIED"].includes(String(errno(error)));
    const drift = (error: unknown) => (error instanceof AcquisitionFailure && error.reason === "CURSOR_TRUST_SOURCE_DRIFT") ||
      (selectionCheck !== undefined && ["ENOENT", "ENOTDIR", "ELOOP"].includes(String(errno(error))));
    let failure = cause, invalidated = checkingSelection || drift(cause);
    // Content failure does not erase native existence, but it cannot preserve
    // stale selection. Recheck metadata only; never retry a refused reader or
    // a failed selection check.
    if (native === "verified" && !invalidated && selectionCheck) {
      try { selectionCheck(); }
      catch (change) { failure = change; invalidated = true; }
    }
    const reason = selectionCheck && ["ENOENT", "ENOTDIR"].includes(String(errno(failure))) ? "CURSOR_TRUST_SOURCE_DRIFT" :
      selectionCheck && errno(failure) === "ELOOP" ? "CURSOR_TRUST_NOT_REGULAR" :
      failure instanceof AcquisitionFailure ? failure.reason : "CURSOR_TRUST_UNREADABLE";
    const state = denied(cause) || denied(failure) ? "denied" : failure instanceof AcquisitionFailure ? failure.state : "unknown";
    if (invalidated) native = denied(failure) ? "denied" : "unknown";
    else if (native !== "verified") native = state;
    return result(state, reason);
  }
}
