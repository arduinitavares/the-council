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
import { scopedLaunchPlanSchema } from "./scoped-launch.js";
import { proofKey } from "./preflight.js";
import type { NativeEvidence, QualificationProof } from "./types.js";
import { decodeStrictJson } from "../workers/strict-json.js";
import { contextProofSchema, controlFactSchema, recipeSchema } from "./wrapper-contract.js";
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
  producerCodeHash: z.string().optional(),
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
      scopedLaunchPlan: scopedLaunchPlanSchema.optional(),
      bootstrap: observation.optional(),
      controlFacts: z.array(controlFactSchema).optional(),
      recipe: recipeSchema.optional(),
      policyAdmission: z.strictObject({
        state: z.enum(["admitted", "conditional"]),
        routeCell: z.string(), qualifier: z.string(), firstUseOnly: z.boolean(),
      }).optional(),
    }),
  ),
});
const outcome = <Kind extends "completed" | "cancelled">(kind: Kind) =>
  z.strictObject({
    dispatchId: z.string().min(1),
    outcome: z.literal(kind),
    settled: z.literal(true),
  });
const legacyProofSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-f0-9]{64}$/),
    key: z.string().regex(/^[a-f0-9]{64}$/),
    issuedAt: z.number().int().positive(),
    expiresAt: z.number().int().positive(),
    scope,
    normal: outcome("completed"),
    cancellation: outcome("cancelled").extend({ stop: z.strictObject({ dispatchId: z.string().min(1), requestId: z.uuid(), state: z.literal("stopped") }).optional() }),
    settled: z.literal(true),
  })
;
const contextProof = legacyProofSchema.extend({ schemaVersion: z.literal(2), normal: outcome("completed").extend({ context: contextProofSchema }),
  cancellation: outcome("cancelled").extend({ context: contextProofSchema, stop: z.strictObject({ dispatchId: z.string(), requestId: z.uuid(), state: z.literal("stopped"), kind: z.literal("wrapper-control") }) }) });
export const proofSchema = z.union([legacyProofSchema, contextProof]).refine(
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
      return cacheSchema.parse(decodeStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes))).proofs;
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
  write(proofs: readonly QualificationProof[], now = Date.now()): void {
    this.assertLockOwned();
    if (!Number.isSafeInteger(now)) throw Error("QUALIFICATION_CACHE_CLOCK_INVALID");
    const incoming = cacheSchema.parse({ version: 1, proofs }).proofs;
    // The exclusive writer lock covers read/merge/atomic replace. Keep proofs
    // from other policies/configurations and prefer the freshest identical key.
    const merged = new Map<string, QualificationProof>();
    for (const proof of [...this.read(), ...incoming]) {
      if (proof.expiresAt <= now) continue;
      const previous = merged.get(proof.key);
      if (!previous || proof.issuedAt >= previous.issuedAt) merged.set(proof.key, proof);
    }
    const parsed = cacheSchema.parse({ version: 1, proofs: [...merged.values()] });
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
    this.assertLockOwned();
    unlinkSync(this.lock);
  }
  private assertLockOwned(): void {
    try {
      if (lstatSync(this.lock).isSymbolicLink() || readFileSync(this.lock, "utf8") !== this.token)
        throw Error("QUALIFICATION_CACHE_LOCK_OWNERSHIP_CHANGED");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT")
        throw Error("QUALIFICATION_CACHE_LOCK_OWNERSHIP_CHANGED", { cause });
      throw cause;
    }
  }
}
