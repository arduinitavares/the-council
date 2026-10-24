import { z } from "zod";
import type {
  ArtifactRef,
  AttemptBinding,
  WorkerObservation,
} from "../domain/contracts.js";
import { canonicalJson } from "../domain/hash.js";
import {
  artifactRefSchema,
  authoritySchema,
  idSchema,
} from "../domain/schemas.js";
const status = z.enum(["live", "unverifiable", "exited"]);
const resource = z.strictObject({
  id: idSchema,
  status,
  exitCode: z.number().int().nullable(),
});
export const resourceProofSchema = z.strictObject({
  attemptId: idSchema,
  authority: authoritySchema,
  worker: z.strictObject({ status, exitCode: z.number().int().nullable() }),
  children: z.array(resource),
  watchdog: resource.nullable(),
  complete: z.boolean(),
  receiptRefs: z.array(artifactRefSchema),
});
export type ResourceProof = z.infer<typeof resourceProofSchema>;
export interface SettlementDecision {
  settled: boolean;
  reason: string;
  receipts: readonly ArtifactRef[];
}
/** Provider exit never establishes child/watchdog or dispatch settlement. */
export function aggregateSettlement(
  binding: AttemptBinding,
  input: ResourceProof,
  expectedWatchdogKey?: string,
): SettlementDecision {
  const parsed = resourceProofSchema.safeParse(input);
  if (!parsed.success)
    return { settled: false, reason: "UNVERIFIABLE_RESOURCES", receipts: [] };
  const proof = parsed.data;
  const same =
    proof.attemptId === binding.attemptId &&
    canonicalJson(proof.authority) === canonicalJson(binding.authority);
  const resources = [
    ...proof.children,
    ...(proof.watchdog ? [proof.watchdog] : []),
  ];
  const ids = resources.map((resource) => resource.id);
  const settled =
    same &&
    proof.receiptRefs.length > 0 &&
    proof.watchdog?.id === expectedWatchdogKey &&
    expectedWatchdogKey !== undefined &&
    proof.complete &&
    proof.worker.status === "exited" &&
    proof.watchdog !== null &&
    new Set(ids).size === ids.length &&
    resources.every((resource) => resource.status === "exited");
  return {
    settled,
    reason: settled ? "POSITIVE_RESOURCE_SETTLEMENT" : "UNVERIFIABLE_RESOURCES",
    receipts: proof.receiptRefs,
  };
}
export function observationFromFailure(): WorkerObservation {
  return { status: "unverifiable", rawReceipts: [], exitCode: null };
}
