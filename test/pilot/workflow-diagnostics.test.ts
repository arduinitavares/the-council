import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { runPilot } from "../../src/pilot/workflow.js";
import { PilotJournal } from "../../src/pilot/journal.js";
import { PilotDiagnosticError, projectDiagnostic } from "../../src/pilot/diagnostics.js";
import { mutationRequestId } from "../../src/pilot/mutation-id.js";
import { incidentRoster } from "./fixtures.js";
import type { Attempt, NativeEvidence, PilotDriver, PilotRequest, Result } from "../../src/pilot/types.js";

const canary = "diag-exception-10";
const now = 1_800_000_000_000;

// The break these fixtures catch is propagation of untrusted exception text or
// conversion of an uncertain mutation/cleanup into reusable qualification.
function harness(workspace: string) {
  const evidence: NativeEvidence = {
    host: "test-host", runtimeId: "offline-runtime", orcaVersion: "1",
    versions: { orca: "1", codex: "1", antigravity: "1", cursor: "1" },
    roots: [workspace], workspace, workspaceId: "repo::" + workspace,
    action: "supplied-packet-read-only", policyHash: "policy", controlsHash: "controls",
    routes: [...Object.entries(incidentRoster.reviewers), ["judge", incidentRoster.judge]].map(([role, selection]) => ({
      role: role as Attempt["role"], selection: selection as Attempt["selection"], version: "1",
      catalog: { state: "verified", source: "offline catalog", detail: "exact" },
      controls: { state: "verified", source: "offline controls", detail: "verified" },
      allowance: { state: "unknown", source: "offline allowance", detail: "unexposed" },
      billing: { state: "verified", source: "offline billing", detail: "included" },
      optionalTelemetry: { state: "unknown", source: "offline telemetry", detail: "unexposed" },
    })),
  };
  const request: PilotRequest = {
    workspace, config: incidentRoster, policyPath: "/offline-policy",
    candidate: "Use the supplied immutable manifest.", suppliedText: "Small and written once.",
    maxProbeCalls: 8, maxTopicCalls: 10, deadline: now + 100000, workerTimeoutMs: 1000, proofs: [],
  };
  const launched: Attempt[] = [];
  const cancelled: string[] = [];
  const released: string[] = [];
  const driver: PilotDriver = {
    inspect: async () => ({ evidence, blockers: [] }),
    begin: async () => "run-native",
    launch: async (_run, _request, role, phase, _packet, key) => {
      const id = "dispatch-" + (launched.length + 1);
      const attempt: Attempt = {
        binding: { runId: "run-native", taskId: "task-" + id, dispatchId: id, handle: "handle-" + id, attemptKey: key },
        role, phase, selection: role === "judge" ? incidentRoster.judge : incidentRoster.reviewers[role],
        packetHash: "packet-" + id, launchVerified: true, inferenceStarted: true, initializations: 1,
      };
      launched.push(attempt);
      return attempt;
    },
    observe: async a => ({
      binding: a.binding, packetHash: a.packetHash, phase: a.phase, role: a.role,
      payload: a.phase === "review" ? { assessment: "Supported", objections: [] }
        : a.phase === "judge" ? { evidenceSupported: true, unresolved: [] }
        : a.phase === "ballot" ? { approve: true, reason: "Evidence" } : { ready: true },
      settlement: "unknown", source: "offline bound output", sourceIdentity: "offline-source", provider: a.selection.route,
    }),
    cancel: async a => {
      cancelled.push(a.binding.dispatchId);
      return { state: "settled", stop: { dispatchId: a.binding.dispatchId, requestId: randomUUID(), state: "stopped" } };
    },
    release: async a => { released.push(a.binding.dispatchId); return true; },
  };
  return { driver, request, evidence, launched, cancelled, released };
}
async function withJournal(test: (h: ReturnType<typeof harness>, journal: PilotJournal) => Promise<void>) {
  const workspace = mkdtempSync(join(tmpdir(), "workflow-diagnostics-"));
  let journal: PilotJournal | undefined;
  try {
    const h = harness(workspace);
    journal = new PilotJournal(workspace, "offline", {
      runId: "offline", maxProbeCalls: 8, maxTopicCalls: 10, deadline: h.request.deadline,
      workerTimeoutMs: 1000, proofTtlMs: 3600000, configHash: "offline-config",
    });
    await test(h, journal);
  } finally {
    try { journal?.close(); } finally { rmSync(workspace, { recursive: true }); }
  }
}
const journalText = (journal: PilotJournal) => readFileSync(join(journal.path, "events.jsonl"), "utf8");

describe("workflow diagnostic propagation with a real exclusive journal", () => {
  it.each(["inspect", "launch", "observe", "cancel", "release"] as const)("excludes arbitrary %s exception text and never relaunches", async stage => {
    await withJournal(async (h, journal) => {
      if (stage === "cancel") {
        h.driver.observe = async () => { throw Error("NATIVE_RESULT_DEADLINE"); };
        h.driver.cancel = async a => { h.cancelled.push(a.binding.dispatchId); throw Error(canary); };
      } else if (stage === "release") {
        h.driver.release = async a => { h.released.push(a.binding.dispatchId); throw Error(canary); };
      } else {
        h.driver[stage] = async () => { throw Error(canary); };
      }
      let rejection = "";
      const out = await runPilot(h.request, journal.wrap(h.driver), () => now).catch(error => {
        rejection = String(error); return undefined;
      });
      expect(rejection).not.toContain(canary);
      expect(out).toBeDefined();
      expect(JSON.stringify(out)).not.toContain(canary);
      expect(journalText(journal)).not.toContain(canary);
      expect(out?.status).toBe(stage === "inspect" ? "prerequisites_not_verified" : "failed");
      expect(out?.proofs).toEqual([]);
      expect(h.launched.length).toBeLessThanOrEqual(1);
      expect(h.cancelled.length).toBeLessThanOrEqual(1);
      expect(h.released.length).toBeLessThanOrEqual(1);
      if (stage === "cancel" || stage === "release") expect(out?.unresolved).toEqual(["dispatch-1"]);
    });
  });

  it("projects arbitrary controlError without losing delivery accounting", async () => {
    await withJournal(async (h, journal) => {
      const launch = h.driver.launch;
      h.driver.launch = async (...args) => ({ ...await launch(...args), launchVerified: false, controlError: canary as never });
      const out = await runPilot(h.request, journal.wrap(h.driver), () => now);
      expect(JSON.stringify(out)).not.toContain(canary);
      expect(journalText(journal)).not.toContain(canary);
      expect(out.error).toBe("DIAGNOSTIC_UNKNOWN");
      expect(out.calls).toEqual({ probes: 1, topic: 0 });
      expect(out.proofs).toEqual([]);
      expect(h.launched).toHaveLength(1);
      expect(h.cancelled).toEqual(["dispatch-1"]);
      expect(h.released).toEqual(["dispatch-1"]);
    });
  });

  it("projects settled_unacknowledged.error without qualifying the cancelled route", async () => {
    await withJournal(async (h, journal) => {
      h.driver.cancel = async a => {
        h.cancelled.push(a.binding.dispatchId);
        return { state: "settled_unacknowledged", error: canary as never };
      };
      const out = await runPilot(h.request, journal.wrap(h.driver), () => now);
      expect(JSON.stringify(out)).not.toContain(canary);
      expect(journalText(journal)).not.toContain(canary);
      expect(out.error).toBe("DIAGNOSTIC_UNKNOWN");
      expect(out.calls).toEqual({ probes: 2, topic: 0 });
      expect(out.proofs).toEqual([]);
      expect(h.launched).toHaveLength(2);
      expect(h.cancelled).toEqual(["dispatch-2"]);
      expect(h.released).toEqual(["dispatch-1", "dispatch-2"]);
    });
  });

  it.each([[false, 0], [null, 1], [true, 1]] as const)("keeps inferenceStarted=%s accounting and explicit missing initialization", async (inferenceStarted, probes) => {
    await withJournal(async (h, journal) => {
      const launch = h.driver.launch;
      h.driver.launch = async (...args) => ({ ...await launch(...args), launchVerified: false,
        inferenceStarted, initializations: null, controlError: "PROVIDER_STREAM_EVENT_UNSUPPORTED" });
      const out = await runPilot(h.request, journal.wrap(h.driver), () => now);
      expect(out.calls).toEqual({ probes, topic: 0 });
      expect(out.initializations).toBe(0);
      expect(out).toMatchObject({ version: 2, initializationsUnknown: true, pendingMutations: [] });
      expect(out.proofs).toEqual([]);
    });
  });

  for (const path of ["cancel-probe", "normal-result"] as const) {
    it.each(["throw-cancel", "unknown-cancel", "throw-release", "false-release"] as const)(path + " retains %s without duplicate cleanup or proof", async failure => {
      await withJournal(async (h, journal) => {
        const target = path === "cancel-probe" ? "dispatch-2" : "dispatch-1";
        if (failure.endsWith("cancel")) {
          if (path === "normal-result") h.driver.observe = async () => { throw Error("NATIVE_RESULT_DEADLINE"); };
          const cancel = h.driver.cancel;
          h.driver.cancel = async (a, ...args) => {
            if (a.binding.dispatchId !== target) return cancel(a, ...args);
            h.cancelled.push(target);
            if (failure === "throw-cancel") throw Error(canary);
            return { state: "unknown" };
          };
        } else {
          const release = h.driver.release;
          h.driver.release = async (a, ...args) => {
            if (a.binding.dispatchId !== target) return release(a, ...args);
            h.released.push(target);
            if (failure === "throw-release") throw Error(canary);
            return false;
          };
        }
        const out = await runPilot(h.request, journal.wrap(h.driver), () => now);
        expect(out.status).toBe("failed");
        expect(out.unresolved).toEqual([target]);
        expect(out.proofs).toEqual([]);
        expect(out.calls).toEqual({ probes: path === "cancel-probe" ? 2 : 1, topic: 0 });
        expect(h.cancelled.filter(id => id === target)).toHaveLength(failure.endsWith("cancel") || path === "cancel-probe" ? 1 : 0);
        expect(h.released.filter(id => id === target)).toHaveLength(failure.endsWith("release") ? 1 : 0);
        expect(JSON.stringify(out)).not.toContain(canary);
        expect(journalText(journal)).not.toContain(canary);
        if (path === "normal-result" && failure.endsWith("release")) expect(out.results[0]?.settlement).toBe("unknown");
      });
    });
  }

  it.each(["raw-message", "raw-code", "controlled", "controlled-unknown", "controlled-acknowledged"] as const)("refunds packet bounds only with controlled not_attempted evidence: %s", async kind => {
    await withJournal(async (h, journal) => {
      h.driver.launch = async () => {
        if (kind === "raw-message") throw Error("NATIVE_PACKET_ARGUMENT_TOO_LARGE");
        if (kind === "raw-code") throw { code: "NATIVE_PACKET_ARGUMENT_TOO_LARGE", message: canary };
        throw new PilotDiagnosticError(projectDiagnostic("NATIVE_PACKET_ARGUMENT_TOO_LARGE", { origin: "native-driver", phase: "input", inputDelivery: kind === "controlled" ? "not_attempted" : kind === "controlled-acknowledged" ? "acknowledged" : "unknown" }));
      };
      const out = await runPilot(h.request, journal.wrap(h.driver), () => now);
      expect(out.calls).toEqual({ probes: kind === "controlled" ? 0 : 1, topic: 0 });
      const events = journalText(journal);
      expect(events.includes('"event":"launch-rejected-before-mutation"')).toBe(kind === "controlled");
      expect(out.proofs).toEqual([]);
      expect(JSON.stringify(out)).not.toContain(canary);
    });
  });

  it.each(["NATIVE_RUN_CREATION_OUTCOME_UNKNOWN", "LAUNCH_OUTCOME_UNKNOWN", "WRAPPER_TERMINAL_OUTCOME_UNKNOWN"] as const)("retains owned UUID identity separately for %s", async code => {
    await withJournal(async (h, journal) => {
      let requestId = randomUUID() as string;
      let key: string | undefined;
      if (code === "NATIVE_RUN_CREATION_OUTCOME_UNKNOWN") {
        h.driver.begin = async (_r, id) => { requestId = id!; throw new PilotDiagnosticError(projectDiagnostic(code, { origin: "native-driver", phase: "bootstrap" }), id); };
      } else {
        h.driver.launch = async (_run, _r, _role, _phase, _packet, attemptKey) => {
          key = attemptKey;
          if (code === "LAUNCH_OUTCOME_UNKNOWN") requestId = mutationRequestId(attemptKey);
          throw new PilotDiagnosticError(projectDiagnostic(code, { origin: "native-driver", phase: "input" }), requestId);
        };
      }
      const out = await runPilot(h.request, journal.wrap(h.driver), () => now);
      expect(out).toMatchObject({ pendingMutations: [{ requestId, kind: code === "NATIVE_RUN_CREATION_OUTCOME_UNKNOWN" ? "run-create" : code === "LAUNCH_OUTCOME_UNKNOWN" ? "worker-start" : "terminal-create", ...(key ? { attemptKey: key } : {}) }] });
      expect(out.error).toBe(code);
      expect(out.proofs).toEqual([]);
    });
  });

  it.each(["LAUNCH_OUTCOME_UNKNOWN:diag-exception-10", "NATIVE_RUN_CREATION_OUTCOME_UNKNOWN:diag-exception-10", "ORCA_diag-exception-10"])("does not admit arbitrary prefixes or suffix identities: %s", async message => {
    await withJournal(async (h, journal) => {
      h.driver.launch = async () => { throw Error(message); };
      const out = await runPilot(h.request, journal.wrap(h.driver), () => now);
      expect(out.error).toBe("DIAGNOSTIC_UNKNOWN");
      expect(out).toMatchObject({ pendingMutations: [] });
      expect(JSON.stringify(out)).not.toContain(canary);
      expect(out.calls).toEqual({ probes: 1, topic: 0 });
    });
  });

  it("classifies Zod request rejection before dropping issue text", async () => {
    await withJournal(async (h, journal) => {
      const out = await runPilot({ ...h.request, config: { ...incidentRoster, extra: canary } } as PilotRequest, journal.wrap(h.driver), () => now);
      expect(out.status).toBe("invalid_request");
      expect(out.error).toBe("NATIVE_REQUEST_INVALID");
      expect(out.diagnostic?.omissions.exceptionText).toBe(true);
      expect(JSON.stringify(out)).not.toContain(canary);
      expect(out.calls).toEqual({ probes: 0, topic: 0 });
    });
  });
});

import { OrcaPilotDriver, assertNativePacketBounds } from "../../src/pilot/orca-driver.js";
import { QualificationCache } from "../../src/pilot/qualification-cache.js";
import { loadPilotConfig } from "../../src/pilot/config.js";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";

function nativeAttempt(): Attempt {
  return { binding: { runId: "run-native", taskId: "task-native", dispatchId: "dispatch-native", handle: "handle-native", attemptKey: "owned-attempt" },
    role: "openai", phase: "normal-probe", selection: incidentRoster.reviewers.openai, packetHash: "packet-native", launchVerified: true };
}
describe("finite owned producer carriers", () => {
  it.each([
    ["binding", "NATIVE_BINDING_MISMATCH", "control", "validation"],
    ["lifecycle", "NATIVE_LIFECYCLE_UNKNOWN", "control", "inference"],
    ["worker", "NATIVE_WORKER_FAILED", "control", "inference"],
    ["deadline", "NATIVE_RESULT_DEADLINE", "timeout", "inference"],
    ["transcript", "NATIVE_TRANSCRIPT_UNBOUND", "control", "validation"],
    ["clipped", "NATIVE_TRANSCRIPT_CLIPPED", "control", "validation"],
    ["incomplete", "NATIVE_TRANSCRIPT_INCOMPLETE", "control", "validation"],
    ["malformed", "NATIVE_RESULT_MALFORMED_OR_MISMATCHED", "validation", "validation"],
  ] as const)("preserves the exact %s driver failure and class", async (failure, code, classification, phase) => {
    await withJournal(async h => {
      const a = nativeAttempt();
      const command = async (argv: readonly string[]) => argv[1] === "worker-show" ? {
        dispatch: { id: failure === "binding" ? "foreign" : a.binding.dispatchId, runId: a.binding.runId, taskId: a.binding.taskId,
          status: failure === "worker" ? "failed" : "succeeded" },
        observation: { status: failure === "lifecycle" ? "unverifiable" : "exited" },
      } : {
        dispatchId: a.binding.dispatchId, source: failure === "transcript" ? "foreign" : "transcript", sourceIdentity: "offline-source",
        provider: a.selection.route, warnings: failure === "clipped" ? ["clipped"] : [],
        transcript: { messages: [{ role: "assistant", blocks: [{ type: "text", text: "{}" }] }], limited: failure === "incomplete" },
      };
      const driver = new OrcaPilotDriver(command, h.driver, () => now);
      let error: unknown;
      try { await driver.observe(a, failure === "deadline" ? now : now + 1000); } catch (cause) { error = cause; }
      expect(error).toBeInstanceOf(PilotDiagnosticError);
      expect(error).toMatchObject({ message: code, diagnostic: { code, classification, origin: "native-driver", phase } });
    });
  });

  it("carries a missing run id as an exact bootstrap failure", async () => {
    await withJournal(async h => {
      const driver = new OrcaPilotDriver(async () => ({}), h.driver, () => now);
      await expect(driver.begin(h.request)).rejects.toMatchObject({ message: "NATIVE_RUN_ID_MISSING",
        diagnostic: { origin: "native-driver", phase: "bootstrap", code: "NATIVE_RUN_ID_MISSING", classification: "control" } });
    });
  });

  it("carries the exact worker-start UUID rather than an appended attempt key", async () => {
    await withJournal(async h => {
      const driver = new OrcaPilotDriver(async () => ({}), h.driver, () => now);
      const key = "owned-worker-start";
      await expect(driver.launch("run-native", h.request, "openai", "normal-probe", "packet", key))
        .rejects.toMatchObject({ message: "LAUNCH_OUTCOME_UNKNOWN", mutationRequestId: mutationRequestId(key),
          diagnostic: { origin: "native-driver", phase: "input", code: "LAUNCH_OUTCOME_UNKNOWN", classification: "control" } });
    });
  });

  it("makes the actual packet bound check a positive no-mutation carrier", () => {
    expect(() => assertNativePacketBounds("x".repeat(50000))).toThrow(PilotDiagnosticError);
    let error: unknown;
    try { assertNativePacketBounds("x".repeat(50000)); } catch (cause) { error = cause; }
    expect(error).toMatchObject({ message: "NATIVE_PACKET_ARGUMENT_TOO_LARGE",
      diagnostic: { inputDelivery: "not_attempted", origin: "native-driver", phase: "input" } });
  });

  it("retains the reserved terminal-create operation UUID from the actual context transport", async () => {
    await withJournal(async h => {
      const { ContextWrapperTransport } = await import("../../dist/pilot/context-driver.js");
      const e = structuredClone(h.evidence);
      const route = e.routes[0]!;
      route.bootstrap = { state: "verified", source: "offline", detail: "verified" };
      route.recipe = { facts: [] } as unknown as NonNullable<typeof route.recipe>;
      const events: any[] = [];
      const transport = new ContextWrapperTransport(async () => ({}), () => ({ callScoped: async () => ({}) }),
        "/offline-orca", event => events.push(event), () => now);
      transport.configure(e);
      const operationId = mutationRequestId("terminal:owned-terminal");
      await expect(transport.launch("run-native", h.request, "openai", "normal-probe", "packet", "owned-terminal"))
        .rejects.toMatchObject({ message: "WRAPPER_TERMINAL_OUTCOME_UNKNOWN", mutationRequestId: operationId,
          diagnostic: { origin: "native-driver", phase: "initialization", code: "WRAPPER_TERMINAL_OUTCOME_UNKNOWN" } });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ event: "wrapper-terminal-reserved", operationId });
    });
  });

  it.each(["incompatible", "too-large"] as const)("projects %s config failure without retaining validation prose", async failure => {
    await withJournal(async h => {
      const file = join(h.request.workspace, "config.json");
      writeFileSync(file, failure === "incompatible" ? JSON.stringify({ version: canary }) : " ".repeat(2 * 1024 * 1024));
      let error: unknown;
      try { loadPilotConfig(file); } catch (cause) { error = cause; }
      const code = failure === "incompatible" ? "PILOT_CONFIG_INCOMPATIBLE" : "PILOT_CONFIG_TOO_LARGE_OR_NOT_FILE";
      expect(error).toBeInstanceOf(PilotDiagnosticError);
      expect(error).toMatchObject({ message: code, diagnostic: { origin: "cli", phase: "validation", code,
        classification: failure === "incompatible" ? "validation" : "control" } });
      expect(String(error) + JSON.stringify(error)).not.toContain(canary);
    });
  });

  it("uses the exact exclusive-journal inspection code", async () => {
    await withJournal(async (h, journal) => {
      expect(() => new PilotJournal(h.request.workspace, "offline", {})).toThrow("NATIVE_RUN_EXISTS_INSPECT_REQUIRED");
      const before = journalText(journal);
      let error: unknown;
      try { new PilotJournal(h.request.workspace, "offline", {}); } catch (cause) { error = cause; }
      expect(error).toMatchObject({ message: "NATIVE_RUN_EXISTS_INSPECT_REQUIRED",
        diagnostic: { code: "NATIVE_RUN_EXISTS_INSPECT_REQUIRED", origin: "journal", phase: "validation" } });
      expect(journalText(journal)).toBe(before);
    });
  });

  it.each(["busy", "corrupt", "clock", "evidence", "ownership"] as const)("preserves the finite %s cache carrier without changing lock rules", async failure => {
    await withJournal(async h => {
      const cache = new QualificationCache(h.request.workspace);
      const lock = join(h.request.workspace, ".council/native-qualifications/writer.lock");
      const token = readFileSync(lock);
      try {
        let error: unknown;
        try {
          if (failure === "busy") new QualificationCache(h.request.workspace);
          if (failure === "corrupt") { writeFileSync(join(h.request.workspace, ".council/native-qualifications/receipts.json"), canary); cache.read(); }
          if (failure === "clock") cache.write([], Number.NaN);
          if (failure === "evidence") {
            const out = await runPilot(h.request, h.driver, () => now);
            cache.write(out.proofs, now);
            await cache.matching(h.evidence, now, async () => false);
          }
          if (failure === "ownership") { writeFileSync(lock, "foreign"); cache.close(); }
        } catch (cause) { error = cause; }
        const codes = { busy: "QUALIFICATION_CACHE_BUSY_RECONCILE", corrupt: "QUALIFICATION_CACHE_CORRUPT",
          clock: "QUALIFICATION_CACHE_CLOCK_INVALID", evidence: "QUALIFICATION_CACHE_NATIVE_EVIDENCE_UNVERIFIED",
          ownership: "QUALIFICATION_CACHE_LOCK_OWNERSHIP_CHANGED" };
        expect(error).toBeInstanceOf(PilotDiagnosticError);
        expect(error).toMatchObject({ message: codes[failure], diagnostic: { origin: "cli", phase: "persistence", code: codes[failure], classification: "control" } });
        expect(String(error) + JSON.stringify(error)).not.toContain(canary);
      } finally {
        if (failure === "ownership") writeFileSync(lock, token);
        cache.close();
      }
    });
  });

  it("rejects a symlinked cache directory with the finite cache code", async () => {
    await withJournal(async h => {
      const target = join(h.request.workspace, "owned-cache-target");
      mkdirSync(target);
      symlinkSync(target, join(h.request.workspace, ".council/native-qualifications"));
      expect(() => new QualificationCache(h.request.workspace)).toThrow("QUALIFICATION_CACHE_SYMLINK");
      let error: unknown;
      try { new QualificationCache(h.request.workspace); } catch (cause) { error = cause; }
      expect(error).toBeInstanceOf(PilotDiagnosticError);
      expect(error).toMatchObject({ message: "QUALIFICATION_CACHE_SYMLINK", diagnostic: { code: "QUALIFICATION_CACHE_SYMLINK", origin: "cli", phase: "persistence" } });
    });
  });

  it.each(["not-a-uuid", "00000000-0000-0000-0000-000000000000"])("cannot recover a fake mutation UUID %s from a controlled carrier", async invalid => {
    await withJournal(async (h, journal) => {
      h.driver.launch = async () => { throw new PilotDiagnosticError(projectDiagnostic("LAUNCH_OUTCOME_UNKNOWN",
        { origin: "native-driver", phase: "input" }), invalid); };
      const out = await runPilot(h.request, journal.wrap(h.driver), () => now);
      expect(out.pendingMutations).toEqual([]);
      expect(out.unresolved).toHaveLength(1);
      expect(JSON.stringify(out)).not.toContain(invalid);
      expect(out.calls).toEqual({ probes: 1, topic: 0 });
    });
  });
});

it.each(["invalid-cancellation-state", "truthy-release"] as const)("requires positive literal cleanup evidence for %s from a direct driver", async failure => {
  await withJournal(async h => {
    if (failure === "invalid-cancellation-state") {
      h.driver.observe = async () => { throw Error("NATIVE_RESULT_DEADLINE"); };
      h.driver.cancel = async a => { h.cancelled.push(a.binding.dispatchId); return { state: "foreign" } as never; };
    } else h.driver.release = async a => { h.released.push(a.binding.dispatchId); return "released" as never; };
    const out = await runPilot(h.request, h.driver, () => now);
    expect(out.status).toBe("failed");
    expect(out.unresolved).toEqual(["dispatch-1"]);
    expect(out.proofs).toEqual([]);
    expect(out.calls).toEqual({ probes: 1, topic: 0 });
    expect(h.launched).toHaveLength(1);
    expect(h.released).toHaveLength(failure === "truthy-release" ? 1 : 0);
  });
});

it("keeps the first provider failure authoritative when cleanup throws", async () => {
  await withJournal(async (h, journal) => {
    const first = projectDiagnostic("PROVIDER_STDERR_UNCLASSIFIED", { origin: "provider", phase: "inference", inputDelivery: "acknowledged" },
      { exit: { state: "observed", code: 7, signal: null, signalState: "none" } });
    const launch = h.driver.launch;
    h.driver.launch = async (...args) => ({ ...await launch(...args), launchVerified: false, diagnostic: first, controlError: first.code });
    h.driver.cancel = async a => { h.cancelled.push(a.binding.dispatchId); throw Error(canary); };
    const out = await runPilot(h.request, journal.wrap(h.driver), () => now);
    expect(out.error).toBe("PROVIDER_STDERR_UNCLASSIFIED");
    expect(out.diagnostic).toMatchObject({ ...first, details: [{ origin: "journal", phase: "cancellation", code: "DIAGNOSTIC_UNKNOWN" }] });
    expect(out.status).toBe("failed");
    expect(out.unresolved).toEqual(["dispatch-1"]);
    expect(out.calls).toEqual({ probes: 1, topic: 0 });
    expect(out.proofs).toEqual([]);
    expect(JSON.stringify(out) + journalText(journal)).not.toContain(canary);
    expect(h.cancelled).toEqual(["dispatch-1"]);
    expect(h.released).toEqual([]);
  });
});

it("fails closed when an attempt's diagnostic projection is invalid", async () => {
  await withJournal(async h => {
    const launch = h.driver.launch;
    h.driver.launch = async (...args) => ({ ...await launch(...args), launchVerified: false,
      diagnostic: { ...projectDiagnostic("NONE", { origin: "provider", phase: "inference" }), secret: canary } as never });
    const out = await runPilot(h.request, h.driver, () => now);
    expect(out.status).toBe("failed");
    expect(out.error).toBe("DIAGNOSTIC_SUMMARY_INVALID");
    expect(out.diagnostic?.code).toBe("DIAGNOSTIC_SUMMARY_INVALID");
    expect(JSON.stringify(out)).not.toContain(canary);
    expect(out.proofs).toEqual([]);
    expect(h.launched).toHaveLength(1);
    expect(h.cancelled).toEqual(["dispatch-1"]);
    expect(h.released).toEqual(["dispatch-1"]);
  });
});

it("makes the actual pre-worker-start envelope bound a no-mutation carrier", async () => {
  await withJournal(async h => {
    let mutations = 0;
    const driver = new OrcaPilotDriver(async () => { mutations++; return {}; }, h.driver, () => now);
    const config = structuredClone(incidentRoster);
    config.reviewers.openai.model = "gpt-" + "6".repeat(40000);
    await expect(driver.launch("run-native", { ...h.request, config }, "openai", "normal-probe", "small packet", "owned-envelope"))
      .rejects.toMatchObject({ message: "NATIVE_PACKET_ARGUMENT_TOO_LARGE",
        diagnostic: { code: "NATIVE_PACKET_ARGUMENT_TOO_LARGE", origin: "native-driver", phase: "input", inputDelivery: "not_attempted" } });
    expect(mutations).toBe(0);
  });
});

describe("fix round 1 cancellation precedence and direct phases", () => {
  for (const path of ["execute", "finally"] as const) for (const releaseFailure of ["false", "throw"] as const) {
    it(`${path} keeps first cancellation before ${releaseFailure} release`, async () => {
      await withJournal(async (h, journal) => {
        const target = path === "execute" ? "dispatch-2" : "dispatch-1";
        const primary = projectDiagnostic("PROVIDER_STDERR_UNCLASSIFIED",
          { origin: "provider", phase: "inference", inputDelivery: "acknowledged" },
          { exit: { state: "observed", code: 7, signal: null, signalState: "none" } });
        const cancellation = projectDiagnostic("PROVIDER_INITIALIZATION_CANCELLED",
          { origin: "provider", phase: "cancellation", inputDelivery: "attempted_unacknowledged" },
          { exit: { state: "observed", code: null, signal: "SIGTERM", signalState: "observed" } });
        if (path === "finally") h.driver.observe = async () => { throw new PilotDiagnosticError(primary); };
        h.driver.cancel = async a => {
          h.cancelled.push(a.binding.dispatchId);
          return { state: "settled_unacknowledged", error: canary as never, diagnostic: cancellation };
        };
        h.driver.release = async a => {
          h.released.push(a.binding.dispatchId);
          if (a.binding.dispatchId !== target) return true;
          if (releaseFailure === "throw") throw Error(canary);
          return false;
        };
        const out = await runPilot(h.request, journal.wrap(h.driver), () => now);
        const first = path === "execute" ? cancellation : primary;
        expect(out).toMatchObject({ version: 2, status: "failed", error: first.code,
          calls: { probes: path === "execute" ? 2 : 1, topic: 0 }, proofs: [], unresolved: [target] });
        expect(out.diagnostic).toMatchObject({ origin: first.origin, phase: first.phase, inputDelivery: first.inputDelivery, exit: first.exit });
        const details = out.diagnostic!.details;
        expect(details).toHaveLength(path === "execute" ? 1 : 2);
        if (path === "finally") expect(details[0]).toEqual({ origin: "provider", phase: "cancellation", code: cancellation.code });
        expect(details.at(-1)).toEqual({ origin: releaseFailure === "throw" ? "journal" : "workflow", phase: "cleanup",
          code: releaseFailure === "throw" ? "DIAGNOSTIC_UNKNOWN" : "RELEASE_UNKNOWN" });
        expect(h.cancelled.filter(id => id === target)).toHaveLength(1);
        expect(h.released.filter(id => id === target)).toHaveLength(1);
        expect(h.launched).toHaveLength(path === "execute" ? 2 : 1);
        expect(JSON.stringify(out) + journalText(journal)).not.toContain(canary);
      });
    });
  }

  it.each(["unknown", "throw", "unacknowledged"] as const)("uses cancellation phase for a direct %s cancellation", async kind => {
    await withJournal(async h => {
      h.driver.cancel = async a => {
        h.cancelled.push(a.binding.dispatchId);
        if (kind === "throw") throw Error(canary);
        return kind === "unknown" ? { state: "unknown" } : { state: "settled_unacknowledged", error: "CANCELLATION_UNACKNOWLEDGED" };
      };
      const out = await runPilot(h.request, h.driver, () => now);
      expect(out.diagnostic).toMatchObject({ origin: "workflow", phase: "cancellation", inputDelivery: "unknown",
        code: kind === "throw" ? "DIAGNOSTIC_UNKNOWN" : kind === "unknown" ? "CANCELLATION_SETTLEMENT_UNKNOWN" : "CANCELLATION_UNACKNOWLEDGED" });
      expect(out.status).toBe("failed");
      expect(out.calls).toEqual({ probes: 2, topic: 0 });
      expect(out.proofs).toEqual([]);
      expect(h.cancelled).toEqual(["dispatch-2"]);
      expect(h.released.filter(id => id === "dispatch-2")).toHaveLength(kind === "unacknowledged" ? 1 : 0);
      expect(JSON.stringify(out)).not.toContain(canary);
    });
  });

  for (const path of ["normal-result", "cancel-probe"] as const) {
    it.each(["false", "throw"] as const)(`uses cleanup phase for direct ${path} %s release`, async kind => {
      await withJournal(async h => {
        const target = path === "normal-result" ? "dispatch-1" : "dispatch-2";
        h.driver.release = async a => {
          h.released.push(a.binding.dispatchId);
          if (a.binding.dispatchId !== target) return true;
          if (kind === "throw") throw Error(canary);
          return false;
        };
        const out = await runPilot(h.request, h.driver, () => now);
        expect(out.diagnostic).toMatchObject({ origin: "workflow", phase: "cleanup", inputDelivery: "unknown",
          code: kind === "throw" ? "DIAGNOSTIC_UNKNOWN" : "RELEASE_UNKNOWN" });
        expect(out.status).toBe("failed");
        expect(out.unresolved).toEqual([target]);
        expect(out.calls).toEqual({ probes: path === "normal-result" ? 1 : 2, topic: 0 });
        expect(out.proofs).toEqual([]);
        expect(h.released.filter(id => id === target)).toHaveLength(1);
        expect(h.cancelled.filter(id => id === target)).toHaveLength(path === "cancel-probe" ? 1 : 0);
        if (path === "normal-result") expect(out.results[0]!.settlement).toBe("unknown");
        expect(JSON.stringify(out)).not.toContain(canary);
      });
    });
  }

  it.each(["unknown", "throw", "unacknowledged"] as const)("keeps direct finally %s cancellation as a finite cancellation detail", async kind => {
    await withJournal(async h => {
      h.driver.observe = async () => { throw new PilotDiagnosticError(projectDiagnostic("PROVIDER_STDERR_UNCLASSIFIED",
        { origin: "provider", phase: "inference", inputDelivery: "unknown" })); };
      h.driver.cancel = async a => {
        h.cancelled.push(a.binding.dispatchId);
        if (kind === "throw") throw Error(canary);
        return kind === "unknown" ? { state: "unknown" } : { state: "settled_unacknowledged", error: "CANCELLATION_UNACKNOWLEDGED" };
      };
      h.driver.release = async a => { h.released.push(a.binding.dispatchId); return false; };
      const out = await runPilot(h.request, h.driver, () => now);
      expect(out.diagnostic).toMatchObject({ code: "PROVIDER_STDERR_UNCLASSIFIED", phase: "inference", inputDelivery: "unknown" });
      expect(out.diagnostic!.details[0]).toEqual({ origin: "workflow", phase: "cancellation",
        code: kind === "throw" ? "DIAGNOSTIC_UNKNOWN" : kind === "unknown" ? "CANCELLATION_SETTLEMENT_UNKNOWN" : "CANCELLATION_UNACKNOWLEDGED" });
      if (kind === "unacknowledged") expect(out.diagnostic!.details[1]).toEqual({ origin: "workflow", phase: "cleanup", code: "RELEASE_UNKNOWN" });
      expect(out.unresolved).toEqual(["dispatch-1"]);
      expect(out.calls).toEqual({ probes: 1, topic: 0 });
      expect(out.proofs).toEqual([]);
      expect(h.cancelled).toEqual(["dispatch-1"]);
      expect(h.released).toHaveLength(kind === "unacknowledged" ? 1 : 0);
      expect(JSON.stringify(out)).not.toContain(canary);
    });
  });
});


it.each(["false", "throw"] as const)("fix round 1 keeps the direct finally %s release phase after observe failure", async kind => {
  await withJournal(async h => {
    h.driver.observe = async () => { throw new PilotDiagnosticError(projectDiagnostic("PROVIDER_STDERR_UNCLASSIFIED",
      { origin: "provider", phase: "inference", inputDelivery: "unknown" })); };
    h.driver.release = async a => {
      h.released.push(a.binding.dispatchId);
      if (kind === "throw") throw Error(canary);
      return false;
    };
    const out = await runPilot(h.request, h.driver, () => now);
    expect(out.diagnostic).toMatchObject({ origin: "provider", phase: "inference", code: "PROVIDER_STDERR_UNCLASSIFIED", inputDelivery: "unknown" });
    expect(out.diagnostic!.details).toEqual([{ origin: "workflow", phase: "cleanup", code: kind === "throw" ? "DIAGNOSTIC_UNKNOWN" : "RELEASE_UNKNOWN" }]);
    expect(out.unresolved).toEqual(["dispatch-1"]);
    expect(out.calls).toEqual({ probes: 1, topic: 0 });
    expect(out.proofs).toEqual([]);
    expect(h.cancelled).toEqual(["dispatch-1"]);
    expect(h.released).toEqual(["dispatch-1"]);
    expect(JSON.stringify(out)).not.toContain(canary);
  });
});
