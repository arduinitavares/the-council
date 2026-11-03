import { z } from "zod";
import { canonicalJson, hashArtifact } from "../domain/hash.js";
import { pilotConfigSchema } from "./config.js";
import type { Role } from "./config.js";
import { classify, proofKey } from "./preflight.js";
import { CLEANUP_GRACE_MS, assertNativePacketBounds } from "./orca-driver.js";
import {pilotPayloadSchemas} from "./payload.js";
import { PilotDiagnosticError, addDiagnosticCount, DIAGNOSTIC_COUNTER_MAX, fitDiagnosticSummary, projectDiagnostic,
  type DiagnosticCode, type DiagnosticPhase, type DiagnosticSummary } from "./diagnostics.js";

import type {
  Attempt,
  CancellationResult,
  Blocker,
  NativeEvidence,
  Phase,
  PilotDriver,
  PilotRequest,
  QualificationProof,
  Result,
  StopAcknowledgement,
} from "./types.js";

export const PILOT_OUTCOME_VERSION = 2;

export interface PilotOutcome {
  version: 2;
  status:
    | "consensus"
    | "disagreement"
    | "judge_unresolved"
    | "invalid_request"
    | "prerequisites_not_verified"
    | "failed";
  calls: { probes: number; topic: number };
  initializations: number;
  initializationsUnknown: boolean;
  pendingMutations: { requestId: string; kind: "run-create" | "worker-start" | "terminal-create"; attemptKey?: string }[];
  evidence: NativeEvidence | null;
  blockers: Blocker[];
  proofs: QualificationProof[];
  results: Result[];
  unresolved: string[];
  error?: DiagnosticCode;
  diagnostic?: DiagnosticSummary;
}
export async function runPilot(
  request: PilotRequest,
  driver: PilotDriver,
  now = Date.now,
): Promise<PilotOutcome> {
  const out: PilotOutcome = {
    version: PILOT_OUTCOME_VERSION,
    status: "failed",
    calls: { probes: 0, topic: 0 },
    initializations: 0,
    initializationsUnknown: false,
    pendingMutations: [],
    evidence: null,
    blockers: [],
    proofs: [],
    results: [],
    unresolved: [],
  };
  const owned: Attempt[] = [];
  const settled = new Set<string>();
  const released = new Set<string>();
  const cancelAttempted = new Set<string>();
  const releaseAttempted = new Set<string>();
  const unresolved = (id: string) => {
    if (!out.unresolved.includes(id)) out.unresolved.push(id);
  };
  const failure = (cause: unknown, phase: DiagnosticPhase): DiagnosticSummary => {
    try { return projectDiagnostic(cause, { origin: "workflow", phase }); }
    catch { return projectDiagnostic("DIAGNOSTIC_SUMMARY_INVALID", { origin: "workflow", phase }); }
  };
  const retainFailure = (first: DiagnosticSummary, next: DiagnosticSummary): DiagnosticSummary => {
    try {
      return fitDiagnosticSummary({ ...first,
        details: [...first.details, { origin: next.origin, phase: next.phase, code: next.code }, ...next.details] });
    } catch {
      // Keep the checked first core and explicitly omit optional details on failure.
      const omitted = first.details.length + next.details.length + 1;
      return fitDiagnosticSummary({ ...first, details: [], truncated: true, omissions: { ...first.omissions,
        details: addDiagnosticCount(first.omissions.details, omitted),
        countersSaturated: first.omissions.countersSaturated || omitted > DIAGNOSTIC_COUNTER_MAX - first.omissions.details } });
    }
  };
  const rememberFailure = (cause: unknown, phase: DiagnosticPhase) => {
    const next = failure(cause, phase);
    out.diagnostic = out.diagnostic ? retainFailure(out.diagnostic, next) : next;
    out.error = out.diagnostic.code;
  };
  const cancellationFailure = (cancellation: CancellationResult): DiagnosticSummary => {
    if (cancellation.diagnostic) {
      try { return new PilotDiagnosticError(cancellation.diagnostic).diagnostic; }
      catch { return failure("DIAGNOSTIC_SUMMARY_INVALID", "cancellation"); }
    }
    return failure(cancellation.state === "settled_unacknowledged"
      ? cancellation.error ?? "CANCELLATION_UNACKNOWLEDGED" : "CANCELLATION_SETTLEMENT_UNKNOWN", "cancellation");
  };
  const attemptFailure = (a: Attempt, fallback: DiagnosticCode, phase: DiagnosticPhase) => {
    if (a.diagnostic) {
      try { return new PilotDiagnosticError(a.diagnostic); }
      catch { return new PilotDiagnosticError(failure("DIAGNOSTIC_SUMMARY_INVALID", phase)); }
    }
    return new PilotDiagnosticError(projectDiagnostic(a.controlError ?? fallback, { origin: "workflow", phase,
      inputDelivery: a.inferenceStarted === false ? "not_attempted" : a.inferenceStarted === true ? "acknowledged" : "unknown" }));
  };
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
      // Launch/readiness time consumes this same inference budget.
      const inferenceDeadline = Math.min(request.deadline, now() + request.workerTimeoutMs);
      pendingCounter = counter;
      out.calls[counter]++;
      const a = await driver.launch(
        run,
        request,
        role,
        phase,
        packet,
        pendingKey,
      );
      owned.push(a);
      if (a.initializations == null || !Number.isSafeInteger(a.initializations) || a.initializations < 0)
        out.initializationsUnknown = true;
      else out.initializations += a.initializations;
      if (a.inferenceStarted === false) out.calls[counter]--;
      pendingKey = null;
      pendingCounter = null;
      if (now() >= inferenceDeadline) throw attemptFailure(a, "NATIVE_INFERENCE_DEADLINE", "inference");
      if (!a.launchVerified) throw attemptFailure(a, "NATIVE_EFFECTIVE_SELECTION_MISMATCH", "initialization");
      if (phase === "cancel-probe") {
        const id = a.binding.dispatchId;
        cancelAttempted.add(id);
        let cancellation;
        try { cancellation = await driver.cancel(a, inferenceDeadline); }
        catch (cause) { unresolved(id); throw new PilotDiagnosticError(failure(cause, "cancellation")); }
        if (cancellation.state !== "settled" && cancellation.state !== "settled_unacknowledged") {
          unresolved(id);
          throw new PilotDiagnosticError(cancellationFailure(cancellation));
        }
        const cancellationDiagnostic = cancellation.state === "settled_unacknowledged" ? cancellationFailure(cancellation) : undefined;
        settled.add(id);
        releaseAttempted.add(id);
        try {
          if ((await driver.release(a)) !== true) { unresolved(id); throw Error("RELEASE_UNKNOWN"); }
          released.add(id);
        } catch (cause) {
          unresolved(id);
          const releaseDiagnostic = failure(cause, "cleanup");
          throw new PilotDiagnosticError(cancellationDiagnostic ? retainFailure(cancellationDiagnostic, releaseDiagnostic) : releaseDiagnostic);
        }
        if (cancellation.state === "settled_unacknowledged") throw new PilotDiagnosticError(cancellationDiagnostic!);
        acknowledgedStops.set(id, cancellation.stop);
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
      releaseAttempted.add(a.binding.dispatchId);
      try {
        if ((await driver.release(a)) !== true) { unresolved(a.binding.dispatchId); throw Error("RELEASE_UNKNOWN"); }
        released.add(a.binding.dispatchId);
      } catch (cause) {
        unresolved(a.binding.dispatchId);
        throw new PilotDiagnosticError(failure(cause, "cleanup"));
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
    out.status = "failed";
    rememberFailure(error instanceof z.ZodError ? Error("NATIVE_REQUEST_INVALID") : error, "validation");
    const noMutationBounds = error instanceof PilotDiagnosticError &&
      out.error === "NATIVE_PACKET_ARGUMENT_TOO_LARGE" && out.diagnostic?.inputDelivery === "not_attempted";
    if (noMutationBounds && pendingKey && pendingCounter) {
      out.calls[pendingCounter]--;
      pendingKey = null;
      pendingCounter = null;
    }
    const kinds = {
      NATIVE_RUN_CREATION_OUTCOME_UNKNOWN: "run-create",
      LAUNCH_OUTCOME_UNKNOWN: "worker-start",
      WRAPPER_TERMINAL_OUTCOME_UNKNOWN: "terminal-create",
    } as const;
    if (error instanceof PilotDiagnosticError && out.error && Object.hasOwn(kinds, out.error)) {
      const requestId = error.mutationRequestId;
      if (typeof requestId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
        const kind = kinds[out.error as keyof typeof kinds];
        out.pendingMutations.push({ requestId, kind, ...(pendingKey && kind !== "run-create" ? { attemptKey: pendingKey } : {}) });
        if (kind === "run-create") unresolved(requestId);
      }
    }
    if (out.error === "INVALID_FINITE_BOUNDS_OR_INPUT" || out.error === "INSUFFICIENT_CALL_BUDGET" ||
        (noMutationBounds && out.calls.probes === 0 && out.calls.topic === 0) || out.error === "NATIVE_REQUEST_INVALID") {
      out.status = "invalid_request";
      out.blockers.push({ role: null, control: "request", reason: out.error ?? "DIAGNOSTIC_UNKNOWN", source: "native request validation", observed: out.error ?? "DIAGNOSTIC_UNKNOWN", nextAction: "Correct the input bounds or configuration before starting a new run." });
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
        observed: out.error ?? "DIAGNOSTIC_UNKNOWN",
        nextAction:
          "Inspect the named native source without launching dependent inference.",
      });
    }
    if (pendingKey) unresolved(`launch outcome unknown:${pendingKey}`);
  } finally {
    // One shared, finite grace for cleanup only; no execute()/launch occurs here.
    const cleanupDeadline = now() + CLEANUP_GRACE_MS;
    for (const a of owned) {
      const id = a.binding.dispatchId;
      if (!settled.has(id)) {
        if (cancelAttempted.has(id)) { unresolved(id); continue; }
        cancelAttempted.add(id);
        try {
          const cancellation = await driver.cancel(a, cleanupDeadline, "absolute-cleanup");
          if (cancellation.state !== "settled" && cancellation.state !== "settled_unacknowledged") {
            unresolved(id);
            rememberFailure(new PilotDiagnosticError(cancellationFailure(cancellation)), "cancellation");
            continue;
          }
          if (cancellation.state === "settled_unacknowledged")
            rememberFailure(new PilotDiagnosticError(cancellationFailure(cancellation)), "cancellation");
          settled.add(id);
        } catch (cause) {
          unresolved(id); rememberFailure(cause, "cancellation"); continue;
        }
      }
      if (!released.has(id)) {
        if (releaseAttempted.has(id)) { unresolved(id); continue; }
        releaseAttempted.add(id);
        try {
          if ((await driver.release(a, cleanupDeadline)) === true) released.add(id);
          else { unresolved(id); rememberFailure("RELEASE_UNKNOWN", "cleanup"); }
        } catch (cause) {
          unresolved(id); rememberFailure(cause, "cleanup");
        }
      }
    }
    if (out.unresolved.length) out.status = "failed";
  }
  return out;
}
