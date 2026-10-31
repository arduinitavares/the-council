import {z} from "zod";
import { selectionSchema } from "./config.js";
/** One phase contract for native transcripts and host-owned completion relays. */
export const pilotPayloadSchemas={
  "normal-probe":z.strictObject({ready:z.literal(true)}),
  readiness:z.strictObject({ready:z.literal(true)}),
  review:z.strictObject({assessment:z.string().min(1),objections:z.array(z.string())}),
  judge:z.strictObject({evidenceSupported:z.boolean(),unresolved:z.array(z.string())}),
  ballot:z.strictObject({approve:z.boolean(),reason:z.string().min(1)}),
  "cancel-probe":z.never(),
};
/** Provider-authored envelope only; transport provenance is added by the host. */
export const pilotResultEnvelopeSchema = z.strictObject({
  binding: z.strictObject({ runId: z.string().min(1), taskId: z.string().min(1), dispatchId: z.string().min(1), handle: z.string().min(1), attemptKey: z.string().min(1) }),
  packetHash: z.string().min(1),
  phase: z.enum(["normal-probe", "cancel-probe", "readiness", "review", "judge", "ballot"]),
  role: z.enum(["openai", "gemini", "xai", "judge"]),
  selection: selectionSchema,
  payload: z.unknown(),
});
