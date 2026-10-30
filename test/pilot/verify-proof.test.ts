import { expect, it } from "vitest";
import { verifyNativeProof } from "../../src/pilot/verify-proof.js";
import { canonicalJson, hashArtifact } from "../../src/domain/hash.js";
import { proofKey } from "../../src/pilot/preflight.js";
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
  const key = proofKey(scope, scope.routes[0]!);
  const proof: QualificationProof = {
    schemaVersion: 1,
    id: key,
    key,
    issuedAt: 1,
    expiresAt: 100,
    scope,
    normal: { dispatchId: "normal", outcome: "completed", settled: true },
    cancellation: { dispatchId: "cancel", outcome: "cancelled", settled: true },
    settled: true,
  };
  let forged = false;
  const command = async (argv: readonly string[]) => {
    const id = argv[argv.indexOf("--dispatch") + 1]!;
    const phase = id === "normal" ? "normal-probe" : "cancel-probe";
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
      role: "openai",
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
                    role: "openai",
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
                text: JSON.stringify({
                  binding: {
                    runId: "run",
                    taskId: "task",
                    dispatchId: id,
                    attemptKey,
                  },
                  role: "openai",
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
  forged = true;
  expect(await verifyNativeProof(proof, command)).toBe(false);
});
