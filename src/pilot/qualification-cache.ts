import {
  constants,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "../domain/hash.js";
import { selectionSchema } from "./config.js";
import { proofKey } from "./preflight.js";
import type { NativeEvidence, QualificationProof } from "./types.js";
const observation = z.strictObject({
  state: z.enum([
    "verified",
    "unknown",
    "missing",
    "denied",
    "authentication_failed",
    "exhausted",
    "unavailable",
    "unsupported",
  ]),
  source: z.string().min(1),
  detail: z.string(),
});
const scope = z.strictObject({
  host: z.string(),
  runtimeId: z.string(),
  orcaVersion: z.string(),
  versions: z.record(z.string(), z.string()),
  roots: z.array(z.string()),
  workspace: z.string(),
  workspaceId: z.string(),
  action: z.literal("supplied-packet-read-only"),
  policyHash: z.string(),
  controlsHash: z.string(),
  routes: z.array(
    z.strictObject({
      role: z.enum(["openai", "gemini", "xai", "judge"]),
      selection: selectionSchema,
      version: z.string(),
      catalog: observation,
      controls: observation,
      allowance: observation,
      billing: observation,
      optionalTelemetry: observation,
    }),
  ),
});
const outcome = <Kind extends "completed" | "cancelled">(kind: Kind) =>
  z.strictObject({
    dispatchId: z.string().min(1),
    outcome: z.literal(kind),
    settled: z.literal(true),
  });
export const proofSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-f0-9]{64}$/),
    key: z.string().regex(/^[a-f0-9]{64}$/),
    issuedAt: z.number().int().positive(),
    expiresAt: z.number().int().positive(),
    scope,
    normal: outcome("completed"),
    cancellation: outcome("cancelled"),
    settled: z.literal(true),
  })
  .refine(
    (p) =>
      p.expiresAt > p.issuedAt &&
      p.expiresAt - p.issuedAt <= 86400000 &&
      p.scope.routes.some((r) => proofKey(p.scope, r) === p.key),
    "Invalid qualification scope or TTL",
  );
const cacheSchema = z.strictObject({
  version: z.literal(1),
  proofs: z.array(proofSchema),
});
/** One invocation owns the cache lock. Unknown/stale ownership is never auto-broken. */
export class QualificationCache {
  private readonly directory: string;
  private readonly lock: string;
  private readonly token = randomUUID();
  private readonly file: string;
  constructor(workspace: string) {
    let root = realpathSync(workspace);
    for (const part of [".council", "native-qualifications"]) {
      root = join(root, part);
      if (existsSync(root)) {
        if (lstatSync(root).isSymbolicLink() || realpathSync(root) !== root)
          throw Error("QUALIFICATION_CACHE_SYMLINK");
      } else mkdirSync(root, { mode: 0o700 });
    }
    this.directory = root;
    this.lock = join(root, "writer.lock");
    this.file = join(root, "receipts.json");
    let fd: number;
    try {
      fd = openSync(
        this.lock,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
    } catch {
      throw Error("QUALIFICATION_CACHE_BUSY_RECONCILE");
    }
    try {
      writeSync(fd, this.token);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
  read(): QualificationProof[] {
    if (!existsSync(this.file)) return [];
    if (lstatSync(this.file).isSymbolicLink())
      throw Error("QUALIFICATION_CACHE_SYMLINK");
    try {
      const bytes = readFileSync(this.file);
      if (bytes.length > 1024 * 1024) throw Error("size");
      return cacheSchema.parse(JSON.parse(bytes.toString("utf8"))).proofs;
    } catch {
      throw Error("QUALIFICATION_CACHE_CORRUPT");
    }
  }
  async matching(
    evidence: NativeEvidence,
    now: number,
    verify: (p: QualificationProof) => Promise<boolean>,
  ): Promise<QualificationProof[]> {
    const matches = this.read().filter(
      (p) =>
        p.issuedAt <= now &&
        p.expiresAt > now &&
        evidence.routes.some((r) => proofKey(evidence, r) === p.key),
    );
    for (const p of matches)
      if (!(await verify(p)))
        throw Error("QUALIFICATION_CACHE_NATIVE_EVIDENCE_UNVERIFIED");
    return matches;
  }
  write(proofs: readonly QualificationProof[]): void {
    const parsed = cacheSchema.parse({ version: 1, proofs });
    const temporary = join(this.directory, `receipts-${this.token}.tmp`);
    const fd = openSync(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      writeSync(fd, canonicalJson(parsed) + "\n");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, this.file);
  }
  close() {
    if (readFileSync(this.lock, "utf8") !== this.token)
      throw Error("QUALIFICATION_CACHE_LOCK_OWNERSHIP_CHANGED");
    unlinkSync(this.lock);
  }
}
