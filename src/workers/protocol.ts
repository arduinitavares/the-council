import type { AttemptBinding, WorkerResult } from "../domain/contracts.js";
import {
  bindWorkerPayload,
  parseWorkerPayload,
  WORKER_RESULT_LIMIT_BYTES,
} from "../domain/schemas.js";
import {
  normalizeJsonSurface,
  type NormalizationReceipt,
} from "./strict-json.js";
export interface DecodedProviderOutput {
  result: WorkerResult;
  raw: Uint8Array;
  normalization: NormalizationReceipt | null;
}
export function decodeProviderOutputWithReceipt(
  raw: Uint8Array,
  binding: AttemptBinding,
): DecodedProviderOutput {
  const preserved = Uint8Array.from(raw);
  let normalization: NormalizationReceipt | null = null;
  try {
    if (raw.byteLength > WORKER_RESULT_LIMIT_BYTES)
      throw new Error("RESULT_TOO_LARGE");
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(raw);
    normalization = normalizeJsonSurface(text);
    if (normalization.outcome !== "valid") throw new Error("INVALID_JSON");
    return {
      result: {
        status: "valid",
        payload: bindWorkerPayload(
          parseWorkerPayload(normalization.value),
          binding,
        ),
        binding,
      },
      raw: preserved,
      normalization,
    };
  } catch {
    return {
      result: { status: "invalid", code: "INVALID_WORKER_RESULT" },
      raw: preserved,
      normalization,
    };
  }
}
export function decodeProviderOutput(
  raw: Uint8Array,
  binding: AttemptBinding,
): WorkerResult {
  return decodeProviderOutputWithReceipt(raw, binding).result;
}
