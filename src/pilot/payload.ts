import {z} from "zod";
/** One phase contract for native transcripts and host-owned completion relays. */
export const pilotPayloadSchemas={
  "normal-probe":z.strictObject({ready:z.literal(true)}),
  readiness:z.strictObject({ready:z.literal(true)}),
  review:z.strictObject({assessment:z.string().min(1),objections:z.array(z.string())}),
  judge:z.strictObject({evidenceSupported:z.boolean(),unresolved:z.array(z.string())}),
  ballot:z.strictObject({approve:z.boolean(),reason:z.string().min(1)}),
  "cancel-probe":z.never(),
};
