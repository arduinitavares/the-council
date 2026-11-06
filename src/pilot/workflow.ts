import { z } from "zod";
import { canonicalJson, hashArtifact } from "../domain/hash.js";
import { pilotConfigSchema } from "./config.js";
import type { Role } from "./config.js";
import { classify, proofKey } from "./preflight.js";
import { CLEANUP_GRACE_MS, assertNativePacketBounds } from "./orca-driver.js";
import {pilotPayloadSchemas} from "./payload.js";
import type {
  Attempt,
  Blocker,
  NativeEvidence,
  Phase,
  PilotDriver,
  PilotRequest,
  QualificationProof,
  Result,
  StopAcknowledgement,
} from "./types.js";

export interface PilotOutcome {
  status:
    | "consensus"
    | "disagreement"
    | "judge_unresolved"
    | "invalid_request"
    | "prerequisites_not_verified"
    | "failed";
  calls: { probes: number; topic: number };
  initializations: number;
  evidence: NativeEvidence | null;
  blockers: Blocker[];
  proofs: QualificationProof[];
  results: Result[];
  unresolved: string[];
  error?: string;
}
export async function runPilot(
  request: PilotRequest,
  driver: PilotDriver,
  now = Date.now,
): Promise<PilotOutcome> {
  const out: PilotOutcome = {
    status: "failed",
    calls: { probes: 0, topic: 0 },
    initializations: 0,
    evidence: null,
    blockers: [],
    proofs: [],
    results: [],
    unresolved: [],
  };
  const owned: Attempt[] = [];
  const settled = new Set<string>();
  const released = new Set<string>();
  const acknowledgedStops = new Map<string, StopAcknowledgement>();
  let pendingKey: string | null = null;
  let pendingCounter: "probes" | "topic" | null = null;
  const proofTtlMs = request.proofTtlMs ?? 3600000;
  try {
    pilotConfigSchema.parse(request.config);
    if (
      ![
        request.maxProbeCalls,
        request.maxTopicCalls,
        request.workerTimeoutMs,
        request.deadline,
      ].every(Number.isSafeInteger) ||
      request.maxProbeCalls < 0 ||
      request.maxProbeCalls > 8 ||
      request.maxTopicCalls !== 10 ||
      request.workerTimeoutMs < 1 ||
      request.workerTimeoutMs > 120000 ||
      request.deadline <= now() ||
      request.deadline - now() > 1800000 ||
      !Number.isSafeInteger(proofTtlMs) || proofTtlMs < 1 || proofTtlMs > 86400000 ||
      !request.candidate.trim() ||
      !request.suppliedText.trim()
    )
      throw Error("INVALID_FINITE_BOUNDS_OR_INPUT");
    assertNativePacketBounds(canonicalJson({ candidate: request.candidate, suppliedText: request.suppliedText }));
    const inspected = await driver.inspect(request);
    out.evidence = inspected.evidence;
    out.blockers = [
      ...inspected.blockers,
      ...classify(request, inspected.evidence, "bootstrap"),
    ];
    if (out.blockers.length) {
      out.status = "prerequisites_not_verified";
      return out;
    }
    const routes = [...new Map(inspected.evidence.routes.map(r => [proofKey(inspected.evidence, r), r])).values()];
    const reusable = routes.flatMap(
      (r) => request.proofs.filter(
          (p) =>
            p.key === proofKey(inspected.evidence, r) &&
            p.expiresAt > now() &&
            p.settled &&
            [1, 2].includes(p.schemaVersion) &&
            p.normal?.outcome === "completed" &&
            p.normal.settled &&
            p.cancellation?.outcome === "cancelled" &&
            p.cancellation.settled &&
            p.issuedAt <= now() &&
            p.expiresAt - p.issuedAt <= 86400000,
        ).slice(0, 1),
    );
    // Preserve already revalidated reuse even if a subsequent fresh probe fails.
    out.proofs.push(...reusable);
    const needed = routes.filter(r => !reusable.some(p => p.key === proofKey(inspected.evidence, r)));
    if (request.maxProbeCalls < 2 * needed.length || request.maxTopicCalls < 10)
      throw Error("INSUFFICIENT_CALL_BUDGET");
    const run = await driver.begin(request);
    const execute = async (
      role: Role,
      phase: Phase,
      packet: string,
    ): Promise<Result | null> => {
      assertNativePacketBounds(packet);
      const counter = phase.endsWith("probe") ? "probes" : "topic";
      if (
        out.calls[counter] >=
          (counter === "probes"
            ? request.maxProbeCalls
            : request.maxTopicCalls) ||
        now() >= request.deadline
      )
        throw Error("CALL_OR_DEADLINE_LIMIT");
      pendingKey = hashArtifact("pilot-attempt", {
        run,
        role,
        phase,
        index: out.calls[counter],
      });
      out.calls[counter]++;
      pendingCounter = counter;
      // Launch/readiness time consumes this same inference budget.
      const inferenceDeadline = Math.min(request.deadline, now() + request.workerTimeoutMs);
      const a = await driver.launch(
        run,
        request,
        role,
        phase,
        packet,
        pendingKey,
      );
      owned.push(a);
      out.initializations += a.initializations ?? 0;
      if (a.inferenceStarted === false) out.calls[counter]--;
      pendingKey = null;
      pendingCounter = null;
      if(now()>=inferenceDeadline)throw Error(a.controlError ?? "NATIVE_INFERENCE_DEADLINE");
      if (!a.launchVerified) throw Error(a.controlError ?? "NATIVE_EFFECTIVE_SELECTION_MISMATCH");
      if (phase === "cancel-probe") {
        const cancellation = await driver.cancel(a, inferenceDeadline);
        if (cancellation.state === "unknown")
          throw Error("CANCELLATION_SETTLEMENT_UNKNOWN");
        settled.add(a.binding.dispatchId);
        if (!(await driver.release(a))) {
          out.unresolved.push(a.binding.dispatchId);
          throw Error("RELEASE_UNKNOWN");
        }
        released.add(a.binding.dispatchId);
        if (cancellation.state !== "settled") throw Error(cancellation.error ?? "CANCELLATION_UNACKNOWLEDGED");
        acknowledgedStops.set(a.binding.dispatchId, cancellation.stop);
        return null;
      }
      const result = await driver.observe(
        a,
        inferenceDeadline,
      );
      if (!pilotPayloadSchemas[phase].safeParse(result.payload).success)
        throw Error("INVALID_" + phase.toUpperCase() + "_RESULT");
      const p = result.payload as any;
      if (
        (phase === "normal-probe" || phase === "readiness") &&
        p?.ready !== true
      )
        throw Error("INVALID_READINESS_RESULT");
      if (
        phase === "review" &&
        (typeof p?.assessment !== "string" || !Array.isArray(p?.objections))
      )
        throw Error("INVALID_REVIEW_RESULT");
      if (
        phase === "judge" &&
        (typeof p?.evidenceSupported !== "boolean" ||
          !Array.isArray(p?.unresolved))
      )
        throw Error("INVALID_JUDGE_RESULT");
      if (
        phase === "ballot" &&
        (typeof p?.approve !== "boolean" || typeof p?.reason !== "string")
      )
        throw Error("INVALID_BALLOT_RESULT");
      // A valid result proves completion of the task, not resource release.
      result.settlement = "unknown";
      out.results.push(result);
      settled.add(a.binding.dispatchId);
      released.add(a.binding.dispatchId);
      if (!(await driver.release(a))) {
        out.unresolved.push(a.binding.dispatchId);
        throw Error("RELEASE_UNKNOWN");
      }
      result.settlement = "settled";
      return result;
    };
    for (const r of needed) {
      const start = owned.length;
      await execute(
        r.role,
        "normal-probe",
        canonicalJson({
          instruction: "Reply with readiness only.",
          qualificationFingerprint: proofKey(inspected.evidence, r),
        }),
      );
      await execute(
        r.role,
        "cancel-probe",
        canonicalJson({
          instruction: "Wait for cancellation.",
          qualificationFingerprint: proofKey(inspected.evidence, r),
        }),
      );
      const normalContext = driver.proof?.(owned[start]!) ?? undefined;
      const cancelContext = driver.proof?.(owned[start+1]!) ?? undefined;
      out.proofs.push({
        schemaVersion: normalContext && cancelContext ? 2 : 1,
        id: proofKey(inspected.evidence, r),
        key: proofKey(inspected.evidence, r),
        scope: inspected.evidence,
        issuedAt: now(),
        expiresAt: now() + proofTtlMs,
        normal: {
          dispatchId: owned[start]!.binding.dispatchId,
          outcome: "completed",
          settled: true,
          ...(normalContext ? { context: normalContext } : {}),
        },
        cancellation: {
          dispatchId: owned[start + 1]!.binding.dispatchId,
          outcome: "cancelled",
          settled: true,
          stop: acknowledgedStops.get(owned[start + 1]!.binding.dispatchId)!,
          ...(cancelContext ? { context: cancelContext } : {}),
        },
        settled: true,
      });
    }
    const packet = canonicalJson({
      candidate: request.candidate,
      suppliedText: request.suppliedText,
    });
    const voters = ["openai", "gemini", "xai"] as const;
    for (const role of voters) await execute(role, "readiness", packet);
    const reviews: Result[] = [];
    for (const role of voters)
      reviews.push((await execute(role, "review", packet))!);
    const judge = (await execute(
      "judge",
      "judge",
      canonicalJson({ packet, reviews }),
    ))!;
    for (const role of voters)
      await execute(role, "ballot", canonicalJson({ packet, reviews, judge }));
    const jp = judge.payload as any;
    if (!jp.evidenceSupported || jp.unresolved.length > 0) {
      out.status = "judge_unresolved";
    } else {
      out.status = out.results
        .filter((r) => r.phase === "ballot")
        .every((r) => (r.payload as any).approve === true)
        ? "consensus" : "disagreement";
    }
  } catch (error) {
    out.error = error instanceof Error ? error.message : "NATIVE_FAILURE";
    if (out.error === "NATIVE_PACKET_ARGUMENT_TOO_LARGE" && pendingKey && pendingCounter) {
      out.calls[pendingCounter]--;
      pendingKey = null;
      pendingCounter = null;
    }
    if (out.error.startsWith("NATIVE_RUN_CREATION_OUTCOME_UNKNOWN:")) out.unresolved.push(out.error);
    if (out.error === "INVALID_FINITE_BOUNDS_OR_INPUT" || out.error === "INSUFFICIENT_CALL_BUDGET" ||
        (out.error === "NATIVE_PACKET_ARGUMENT_TOO_LARGE" && out.calls.probes === 0 && out.calls.topic === 0) || error instanceof z.ZodError) {
      out.status = "invalid_request";
      out.blockers.push({ role: null, control: "request", reason: out.error, source: "native request validation", observed: out.error, nextAction: "Correct the input bounds or configuration before starting a new run." });
    } else if (
      out.evidence === null &&
      out.calls.probes === 0 &&
      out.calls.topic === 0
    ) {
      out.status = "prerequisites_not_verified";
      out.blockers.push({
        role: null,
        control: "bootstrap",
        reason: "NATIVE_INSPECTION_UNVERIFIED",
        source: "native host inspector",
        observed: out.error,
        nextAction:
          "Inspect the named native source without launching dependent inference.",
      });
    }
    if (pendingKey) out.unresolved.push(`launch outcome unknown:${pendingKey}`);
  } finally {
    // One shared, finite grace for cleanup only; no execute()/launch occurs here.
    const cleanupDeadline = now() + CLEANUP_GRACE_MS;
    for (const a of owned) {
      if (!settled.has(a.binding.dispatchId)) {
        if ((await driver.cancel(a, cleanupDeadline, "absolute-cleanup")).state === "unknown") {
          out.unresolved.push(a.binding.dispatchId);
          continue;
        }
        settled.add(a.binding.dispatchId);
      }
      if (
        !released.has(a.binding.dispatchId) &&
        !(await driver.release(a, cleanupDeadline)) &&
        !out.unresolved.includes(a.binding.dispatchId)
      )
        out.unresolved.push(a.binding.dispatchId);
    }
    if (out.unresolved.length) out.status = "failed";
  }
  return out;
}
