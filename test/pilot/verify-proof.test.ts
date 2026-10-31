import { expect, it } from "vitest";
import { verifyNativeProof } from "../../src/pilot/verify-proof.js";
import { canonicalJson, hashArtifact } from "../../src/domain/hash.js";
import { proofKey } from "../../src/pilot/preflight.js";
import { mutationRequestId } from "../../src/pilot/mutation-id.js";
import { incidentRoster } from "./fixtures.js";
import type {
  NativeEvidence,
  QualificationProof,
} from "../../src/pilot/types.js";
it("revalidates cached proofs against native owned scope, archived probe inputs and final output", async () => {
  const o = {
    state: "verified" as const,
    source: "synthetic native source",
    detail: "verified",
  };
  const selection = incidentRoster.reviewers.openai;
  const scope: NativeEvidence = {
    host: "mac",
    runtimeId: "runtime",
    orcaVersion: "1.4.244",
    versions: { orca: "1.4.244" },
    roots: ["/B"],
    workspace: "/B",
    workspaceId: "repo::B",
    action: "supplied-packet-read-only",
    policyHash: "policy",
    controlsHash: "controls",
    routes: [
      {
        role: "openai",
        selection,
        version: "1",
        catalog: o,
        controls: o,
        allowance: o,
        billing: o,
        optionalTelemetry: o,
      },
    ],
  };
  scope.routes.push({ ...scope.routes[0]!, role: "judge" });
  const key = proofKey(scope, scope.routes[0]!);
  expect(proofKey(scope, scope.routes[1]!)).toBe(key);
  const proof: QualificationProof = {
    schemaVersion: 1,
    id: key,
    key,
    issuedAt: 1,
    expiresAt: 100,
    scope,
    normal: { dispatchId: "normal", outcome: "completed", settled: true },
    cancellation: { dispatchId: "cancel", outcome: "cancelled", settled: true,
      stop: { dispatchId: "cancel", requestId: mutationRequestId('stop:'+canonicalJson({runId:"run",taskId:"task",dispatchId:"cancel",handle:"owned",attemptKey:"owned-attempt"})), state: "stopped" } },
    settled: true,
  };
  let forged = false;
  let requestState = "completed";
  let stopDispatch = "cancel";
  let resultEncoding = "valid";
  let cancelRole = "judge";
  const encodeResult = (value: unknown) => {
    const text = JSON.stringify(value);
    return resultEncoding === "duplicate" ? text.replace("{", '{"packetHash":"discarded",')
      : resultEncoding === "extra" ? text.replace("{", '{"admissionOverride":true,') : text;
  };
  const command = async (argv: readonly string[]) => {
    if (argv[1] === "request-show") return { requestId: proof.cancellation.stop!.requestId, state: requestState,
      method: "orchestration.workerStop", receipt: { state: "stopped", dispatchId: stopDispatch, mutation: { requestId: proof.cancellation.stop!.requestId } } };
    const id = argv[argv.indexOf("--dispatch") + 1]!;
    const phase = id === "normal" ? "normal-probe" : "cancel-probe";
    const role = id === "normal" ? "judge" : cancelRole;
    const packet = canonicalJson({
      instruction:
        id === "normal"
          ? "Reply with readiness only."
          : "Wait for cancellation.",
      qualificationFingerprint: forged ? "invented" : key,
    });
    const attemptKey = "owned-attempt";
    const packetHash = hashArtifact("pilot-packet", {
      runId: "run",
      role,
      phase,
      packet,
      attemptKey,
    });
    const exposed = { agent: "codex", model: "gpt-6.1-sol", effort: "max" };
    if (argv[1] === "worker-show")
      return {
        dispatch: {
          id,
          runId: "run",
          taskId: "task",
          assigneeHandle: "owned",
          status: id === "normal" ? "succeeded" : "failed",
          terminationReason: id === "cancel" ? "worker_stop" : null,
        },
        worker: {
          worktreeId: "repo::B",
          startOptions: { launch: { requested: exposed, effective: exposed } },
        },
        terminalResource: { originDispatchId: id, releaseState: "released" },
      };
    return {
      dispatchId: id,
      source: "transcript",
      provider: "codex",
      sourceIdentity: "native-archive",
      transcript: {
        limited: false,
        messages: [
          {
            role: "user",
            blocks: [
              {
                type: "text",
                text:
                  "instructions\nCOUNCIL_PACKET\n" +
                  JSON.stringify({
                    runId: "run",
                    role,
                    phase,
                    packet,
                    selection,
                    packetHash,
                    attemptKey,
                  }),
              },
            ],
          },
          {
            role: "assistant",
            blocks: [
              {
                type: "text",
                text: encodeResult({
                  binding: {
                    runId: "run",
                    taskId: "task",
                    dispatchId: id,
                    handle: "owned",
                    attemptKey,
                  },
                  role,
                  phase,
                  packetHash,
                  selection,
                  payload: { ready: true },
                }),
              },
            ],
          },
        ],
      },
    };
  };
  expect(await verifyNativeProof(proof, command)).toBe(true);
  requestState = "pending";
  expect(await verifyNativeProof(proof, command)).toBe(false);
  requestState = "completed"; stopDispatch = "foreign";
  expect(await verifyNativeProof(proof, command)).toBe(false);
  stopDispatch = "cancel";
  resultEncoding = "duplicate";
  expect(await verifyNativeProof(proof, command)).toBe(false);
  resultEncoding = "extra";
  expect(await verifyNativeProof(proof, command)).toBe(false);
  resultEncoding = "valid"; cancelRole = "openai";
  expect(await verifyNativeProof(proof, command)).toBe(false);
  cancelRole = "judge";
  forged = true;
  expect(await verifyNativeProof(proof, command)).toBe(false);
});
