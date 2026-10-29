import { describe, it, expect } from "vitest";
import { runPilot } from "../../src/pilot/workflow.js";
import { OrcaPilotDriver } from "../../src/pilot/orca-driver.js";
import { incidentRoster } from "./fixtures.js";
import type { NativeEvidence, PilotRequest } from "../../src/pilot/types.js";
import { canonicalJson, hashArtifact } from "../../src/domain/hash.js";

const now = 1_800_000_000_000;
const evidence: NativeEvidence = {
  host: "test-mac",
  runtimeId: "runtime-B",
  orcaVersion: "1.4.244",
  versions: { orca: "1.4.244", codex: "1", antigravity: "1", cursor: "1" },
  roots: ["/project-B"],
  workspace: "/project-B",
  workspaceId: "repo::/project-B",
  action: "supplied-packet-read-only",
  policyHash: "policy-v1",
  controlsHash: "controls-v1",
  routes: [
    ...Object.entries(incidentRoster.reviewers),
    ["judge", incidentRoster.judge],
  ].map(([role, selection]) => ({
    role: role as any,
    selection: selection as any,
    version: "1",
    catalog: {
      state: "verified",
      source: "native catalog fixture",
      detail: "exact",
    },
    controls: {
      state: "verified",
      source: "host inspector fixture",
      detail: "contained",
    },
    allowance: {
      state: "unknown",
      source: "provider usage fixture",
      detail: "explicit unknown",
    },
    billing: {
      state: "verified",
      source: "included pool fixture",
      detail: "included-only",
    },
    optionalTelemetry: {
      state: "unknown",
      source: "not exposed",
      detail: "optional",
    },
  })),
};
const request: PilotRequest = {
  workspace: "/project-B",
  config: incidentRoster,
  policyPath: "/policy",
  candidate: "Use JSON for one immutable supplied manifest.",
  suppliedText: "The manifest is small and written once.",
  maxProbeCalls: 8,
  maxTopicCalls: 10,
  deadline: now + 100_000,
  workerTimeoutMs: 1000,
  proofs: [],
};
function harness(
  options: {
    fail?: string;
    mismatch?: boolean;
    disagree?: boolean;
    unknown?: boolean;
    cancelUnknown?: boolean;
    releaseUnknown?: boolean;
    evidence?: NativeEvidence;
  } = {},
) {
  const calls: { argv: readonly string[]; packet?: any }[] = [];
  const attempts = new Map<string, any>();
  let count = 0;
  const command = async (argv: readonly string[]) => {
    calls.push({ argv });
    const verb = argv[1];
    if (verb === "run-create") return { run: { id: "run-native" } };
    if (verb === "worker-start") {
      const val = (k: string) => argv[argv.indexOf(k) + 1]!;
      const packet = JSON.parse(val("--spec").split("\nCOUNCIL_PACKET\n")[1]!);
      const id = `dispatch-${++count}`;
      const b = {
        runId: "run-native",
        taskId: `task-${count}`,
        dispatchId: id,
        handle: `handle-${count}`,
        attemptKey: packet.attemptKey,
      };
      attempts.set(id, { packet, b });
      calls.at(-1)!.packet = packet;
      const selected = {
        agent: val("--agent"),
        model: val("--model"),
        ...(argv.includes("--effort") ? { effort: val("--effort") } : {}),
      };
      return {
        status: "ready",
        dispatch: {
          id,
          taskId: b.taskId,
          runId: b.runId,
          assigneeHandle: b.handle,
        },
        launch: { requested: selected, effective: selected },
      };
    }
    const id = argv[argv.indexOf("--dispatch") + 1]!;
    const a = attempts.get(id);
    if (verb === "worker-show")
      return {
        dispatch: {
          id,
          taskId: a.b.taskId,
          runId: a.b.runId,
          status: options.unknown ? "dispatched" : "succeeded",
        },
        observation: {
          status: options.unknown ? "unverifiable" : "exited",
          exactWorker: true,
        },
        terminalResource: { releaseState: "released" },
      };
    if (verb === "worker-read") {
      let payload: any = { ready: true };
      if (a.packet.phase === "review")
        payload = { assessment: "Supported by supplied text", objections: [] };
      if (a.packet.phase === "judge")
        payload = { evidenceSupported: true, unresolved: [] };
      if (a.packet.phase === "ballot")
        payload = {
          approve: !(options.disagree && a.packet.role === "xai"),
          reason: "Supplied evidence",
        };
      if (options.fail === a.packet.phase) payload = { wrong: true };
      const result = {
        binding: {
          ...a.b,
          ...(options.mismatch ? { dispatchId: "foreign" } : {}),
        },
        packetHash: a.packet.packetHash,
        phase: a.packet.phase,
        role: a.packet.role,
        selection: a.packet.selection,
        payload,
      };
      return {
        dispatchId: id,
        source: "transcript",
        sourceIdentity: "captured-source-id",
        provider: a.packet.selection.route,
        transcript: {
          messages: [
            {
              role: "assistant",
              blocks: [{ type: "text", text: JSON.stringify(result) }],
            },
          ],
          limited: false,
        },
      };
    }
    if (verb === "worker-stop")
      return {
        status:
          options.unknown || options.cancelUnknown ? "stop_unknown" : "stopped",
        processAction: "closed_agent_terminal",
      };
    if (verb === "worker-release")
      return { state: options.releaseUnknown ? "release_unknown" : "released" };
    throw Error("unexpected command " + argv.join(" "));
  };
  const driver = new OrcaPilotDriver(
    command,
    {
      inspect: async () => ({
        evidence: structuredClone(options.evidence || evidence),
        blockers: [],
      }),
    },
    () => now,
  );
  return { driver, calls };
}
describe("native first use through Orca command adapter", () => {
  it("qualifies every exact project-B route before topic dispatch and collects bound ballots", async () => {
    const h = harness();
    const r = await runPilot(request, h.driver, () => now);
    expect(r.status).toBe("consensus");
    expect(r.calls).toEqual({ probes: 8, topic: 10 });
    expect(r.proofs).toHaveLength(4);
    expect(r.results.filter((x) => x.phase === "ballot")).toHaveLength(3);
    expect(r.unresolved).toEqual([]);
    const launches = h.calls.filter((c) => c.argv[1] === "worker-start");
    expect(
      launches.slice(0, 8).every((c) => c.packet.phase.endsWith("probe")),
    ).toBe(true);
    const xai = launches.find((c) => c.packet.role === "xai")!;
    expect(xai.argv).toContain("grok-4.7-xhigh");
    expect(xai.argv).not.toContain("--effort");
    expect(h.calls.filter((c) => c.argv[1] === "worker-release")).toHaveLength(
      18,
    );
  });
});

describe("bootstrap and lifecycle matrix (synthetic native-shaped subprocess fixtures)", () => {
  for (const control of [
    "controls",
    "allowance",
    "catalog",
    "billing",
  ] as const)
    it(`blocks missing ${control} before any dependent call`, async () => {
      const e = structuredClone(evidence);
      e.routes[0]![control].state = "missing";
      const h = harness({ evidence: e });
      const r = await runPilot(request, h.driver, () => now);
      expect(r.status).toBe("prerequisites_not_verified");
      expect(r.blockers[0]?.reason).toBe(`${control.toUpperCase()}_MISSING`);
      expect(r.calls).toEqual({ probes: 0, topic: 0 });
      expect(h.calls).toHaveLength(0);
    });
  for (const state of [
    "denied",
    "authentication_failed",
    "exhausted",
    "unavailable",
    "unsupported",
  ] as const)
    it(`preserves genuine ${state} without route substitution`, async () => {
      const e = structuredClone(evidence);
      e.routes[2]!.controls.state = state;
      const h = harness({ evidence: e });
      const r = await runPilot(request, h.driver, () => now);
      expect(r.blockers[0]?.role).toBe("xai");
      expect(r.blockers[0]?.reason).toBe(`CONTROLS_${state.toUpperCase()}`);
      expect(r.calls).toEqual({ probes: 0, topic: 0 });
    });
  it("reuses valid project-B proof without redundant probes", async () => {
    const first = await runPilot(request, harness().driver, () => now);
    const second = await runPilot(
      { ...request, proofs: first.proofs },
      harness().driver,
      () => now,
    );
    expect(second.status).toBe("consensus");
    expect(second.calls).toEqual({ probes: 0, topic: 10 });
  });
  for (const variation of ["foreign", "expired", "controls", "model"] as const)
    it(`requalifies ${variation} proof before topic work`, async () => {
      const first = await runPilot(request, harness().driver, () => now);
      let proofs = structuredClone(first.proofs);
      const e = structuredClone(evidence);
      if (variation === "expired")
        proofs = proofs.map((p) => ({ ...p, expiresAt: now - 1 }));
      if (variation === "foreign")
        proofs = proofs.map((p) => ({ ...p, key: "project-A" }));
      if (variation === "controls") e.controlsHash = "controls-v2";
      if (variation === "model")
        e.versions = { ...e.versions, codex: "updated" };
      const r = await runPilot(
        { ...request, proofs },
        harness({ evidence: e }).driver,
        () => now,
      );
      expect(r.calls).toEqual({ probes: 8, topic: 10 });
    });
  it("a failed normal probe prevents all topic work", async () => {
    const r = await runPilot(
      request,
      harness({ fail: "normal-probe" }).driver,
      () => now,
    );
    expect(r.calls).toEqual({ probes: 1, topic: 0 });
    expect(r.status).toBe("failed");
  });
  it("lost cancellation contact remains unknown with no duplicate dispatch or release", async () => {
    const h = harness({ unknown: true });
    const r = await runPilot(request, h.driver, () => now);
    expect(r.status).toBe("failed");
    expect(r.unresolved).toHaveLength(1);
    expect(r.calls).toEqual({ probes: 1, topic: 0 });
    expect(h.calls.filter((c) => c.argv[1] === "worker-release")).toHaveLength(
      0,
    );
  });
  it("rejects foreign bound final output", async () => {
    const r = await runPilot(
      request,
      harness({ mismatch: true }).driver,
      () => now,
    );
    expect(r.error).toBe("NATIVE_RESULT_MALFORMED_OR_MISMATCHED");
    expect(r.calls.topic).toBe(0);
  });
  it("preserves disagreement rather than manufacturing unanimity", async () => {
    const r = await runPilot(
      request,
      harness({ disagree: true }).driver,
      () => now,
    );
    expect(r.status).toBe("disagreement");
    expect(
      r.results
        .filter((r) => r.phase === "ballot")
        .map((r) => (r.payload as any).approve),
    ).toEqual([true, true, false]);
  });
  it("reports failed release explicitly", async () => {
    const r = await runPilot(
      request,
      harness({ releaseUnknown: true }).driver,
      () => now,
    );
    expect(r.status).toBe("failed");
    expect(r.unresolved).toHaveLength(1);
    expect(r.calls.topic).toBe(0);
  });
});

it("retains an unknown cancellation without repeating the stop mutation", async () => {
  const h = harness({ cancelUnknown: true });
  const r = await runPilot(request, h.driver, () => now);
  expect(r.status).toBe("failed");
  expect(r.calls).toEqual({ probes: 2, topic: 0 });
  expect(r.unresolved).toHaveLength(1);
  expect(h.calls.filter((c) => c.argv[1] === "worker-stop")).toHaveLength(1);
});
