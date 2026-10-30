import { describe, it, expect, vi } from "vitest";
import { runPilot } from "../../src/pilot/workflow.js";
import { OrcaPilotDriver } from "../../src/pilot/orca-driver.js";
import { incidentRoster } from "./fixtures.js";
import type { NativeEvidence, PilotRequest } from "../../src/pilot/types.js";
import { canonicalJson, hashArtifact } from "../../src/domain/hash.js";
import { proofKey } from "../../src/pilot/preflight.js";
import { QualificationCache } from "../../src/pilot/qualification-cache.js";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

it("uses cleanup grace after workflow expiry without launching another inference", async () => {
  const h = harness();
  let clock = now;
  vi.spyOn(h.driver, "observe").mockImplementation(async () => {
    clock = request.deadline;
    throw Error("NATIVE_RESULT_DEADLINE");
  });
  const cancel = vi.spyOn(h.driver, "cancel").mockImplementation(async (_a, deadline) => {
    expect(deadline).toBe(clock + 30000);
    return "settled";
  });
  const result = await runPilot(request, h.driver, () => clock);
  expect(result.status).toBe("failed");
  expect(result.calls).toEqual({ probes: 1, topic: 0 });
  expect(result.unresolved).toEqual([]);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(h.calls.filter(c => c.argv[1] === "worker-release")).toHaveLength(1);
});
it("composes expired workflow cleanup with the real driver and positive release", async () => {
  let clock = now;
  const h = harness({ clock: () => clock });
  vi.spyOn(h.driver, "observe").mockImplementation(async () => {
    clock = request.deadline;
    throw Error("NATIVE_RESULT_DEADLINE");
  });
  const result = await runPilot(request, h.driver, () => clock);
  expect(result.calls).toEqual({ probes: 1, topic: 0 });
  expect(result.unresolved).toEqual([]);
  expect(h.calls.filter(c => c.argv[1] === "worker-stop")).toHaveLength(1);
  expect(h.calls.filter(c => c.argv[1] === "worker-release")).toHaveLength(1);
});

it("composes near-expiry cancel probes with the real driver without duplicate inference or stops", async () => {
  let clock = now;
  const h = harness({ clock: () => clock });
  const launch = h.driver.launch.bind(h.driver);
  vi.spyOn(h.driver, "launch").mockImplementation(async (...args) => {
    const attempt = await launch(...args);
    if (attempt.phase === "cancel-probe") clock += request.workerTimeoutMs - 10;
    return attempt;
  });
  const result = await runPilot(request, h.driver, () => clock);
  expect(result.status).toBe("consensus");
  expect(result.calls).toEqual({ probes: 8, topic: 10 });
  const stops = h.calls.filter(c => c.argv[1] === "worker-stop");
  expect(stops).toHaveLength(4);
  expect(stops.every(c => c.timeout === 5000)).toBe(true);
  expect(new Set(stops.map(c => c.argv[c.argv.indexOf("--dispatch") + 1])).size).toBe(4);
});

it("caps cancel-probe settlement to the per-attempt inference bound", async () => {
  const h = harness();
  const cancel = vi.spyOn(h.driver, "cancel").mockImplementation(async (_a, deadline) => {
    expect(deadline).toBe(now + request.workerTimeoutMs);
    return "settled";
  });
  const result = await runPilot(request, h.driver, () => now);
  expect(result.status).toBe("consensus");
  expect(cancel).toHaveBeenCalledTimes(4);
});

it("never observes or qualifies a launch which exhausted the inference budget",async()=>{
  const h=harness();let clock=now;
  const launch=h.driver.launch.bind(h.driver);
  vi.spyOn(h.driver,"launch").mockImplementation(async(...args)=>{const a=await launch(...args);clock+=request.workerTimeoutMs;return a;});
  const observe=vi.spyOn(h.driver,"observe");
  const result=await runPilot(request,h.driver,()=>clock);
  expect(result.calls).toEqual({probes:1,topic:0});
  expect(result.proofs).toEqual([]);
  expect(observe).not.toHaveBeenCalled();
});
it("retains mixed reused proofs and the first new proof when the next route fails", async () => {
  // Conditional runPilot + real cache composition; production admission remains blocked.
  const first = await runPilot(request, harness().driver, () => now);
  const cached = first.proofs.slice(2);
  const h = harness();
  const observe = h.driver.observe.bind(h.driver);
  vi.spyOn(h.driver, "observe").mockImplementation(async (a, deadline) => {
    if (a.role === "gemini" && a.phase === "normal-probe") throw Error("synthetic partial failure");
    return observe(a, deadline);
  });
  const w = realpathSync(mkdtempSync(join(tmpdir(), "pilot-cache-partial-")));
  try {
    const cache = new QualificationCache(w);
    cache.write(cached, now);
    const reused = await cache.matching(evidence, now, async () => true);
    const result = await runPilot({ ...request, proofs: reused }, h.driver, () => now);
    expect(result.status).toBe("failed");
    expect(result.calls).toEqual({ probes: 3, topic: 0 });
    expect(result.proofs).toHaveLength(3);
    cache.write(result.proofs, now);
    expect(cache.read().map(p => p.key)).toEqual(expect.arrayContaining(cached.map(p => p.key)));
    expect(cache.read()).toHaveLength(3);
    cache.close();
  } finally { rmSync(w, { recursive: true, force: true }); }
});

function harness(
  options: {
    fail?: string;
    mismatch?: boolean;
    disagree?: boolean;
    unknown?: boolean;
    cancelUnknown?: boolean;
    releaseUnknown?: boolean;
    judgeUnresolved?: boolean;
    clock?: () => number;
    evidence?: NativeEvidence;
  } = {},
) {
  const calls: { argv: readonly string[]; packet?: any; timeout?: number }[] = [];
  const attempts = new Map<string, any>();
  let count = 0;
  const command = async (argv: readonly string[], _cwd?: string, timeout?: number) => {
    calls.push({ argv, ...(timeout === undefined ? {} : { timeout }) });
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
          status: options.unknown || (options.cancelUnknown && a.packet.phase === "cancel-probe") ? "unverifiable" : "exited",
          exactWorker: true,
        },
        terminalResource: { releaseState: "released" },
      };
    if (verb === "worker-read") {
      let payload: any = { ready: true };
      if (a.packet.phase === "review")
        payload = { assessment: "Supported by supplied text", objections: [] };
      if (a.packet.phase === "judge")
        payload = { evidenceSupported: !options.judgeUnresolved, unresolved: options.judgeUnresolved ? ["unsupported evidence"] : [] };
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
    options.clock ?? (() => now),
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
    for (const launch of launches)
      expect(launch.argv[launch.argv.indexOf("--retry-request")+1]).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
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
      e.routes[control === "billing" ? 2 : 0]![control].state = "missing";
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
  for (const variation of ["foreign", "expired", "controls", "model", "version"] as const)
    it(`requalifies ${variation} proof before topic work`, async () => {
      const first = await runPilot(request, harness().driver, () => now);
      let proofs = structuredClone(first.proofs);
      const e = structuredClone(evidence);
      if (variation === "expired")
        proofs = proofs.map((p) => ({ ...p, expiresAt: now - 1 }));
      if (variation === "foreign")
        proofs = first.proofs.map((original) => {
          const p=structuredClone(original);
          const route = p.scope.routes.find(r => proofKey(p.scope,r) === p.key)!;
          p.scope.workspace = "/project-A"; p.scope.workspaceId="repo::/project-A"; p.scope.roots=["/project-A"];
          p.key=proofKey(p.scope,route); p.id=p.key;
          return p;
        });
      if (variation === "controls") e.controlsHash = "controls-v2";
      if (variation === "model") {
        proofs = first.proofs.map(original => {
          const p=structuredClone(original);
          const route = p.scope.routes.find(r => proofKey(p.scope,r) === p.key)!;
          route.selection.model += "-prior";
          p.key=proofKey(p.scope,route); p.id=p.key;
          return p;
        });
      }
      if (variation === "version")
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
    expect(r.results[0]?.settlement).toBe("unknown");
  });
});

it("distinguishes an unresolved judge from voter disagreement", async () => {
  const result = await runPilot(request,harness({judgeUnresolved:true}).driver,()=>now);
  expect(result.results.filter(r=>r.phase==='ballot').every(r=>(r.payload as any).approve)).toBe(true);
  expect(result.status).toBe('judge_unresolved');
});

it("reports insufficient budget as an invalid request before inference", async () => {
  const r=await runPilot({...request,maxProbeCalls:7},harness().driver,()=>now);
  expect(r.status).toBe('invalid_request');
  expect(r.blockers).toContainEqual(expect.objectContaining({reason:'INSUFFICIENT_CALL_BUDGET'}));
  expect(r.calls).toEqual({probes:0,topic:0});
});

it("permits explicitly conditional first-use probes once controls pass without unrelated historical proof", async () => {
  const e=structuredClone(evidence);
  e.routes[2]!.policyAdmission={state:'conditional',routeCell:'Cursor, pending host/action qualification',qualifier:'pending host/action qualification',firstUseOnly:true};
  e.routes[0]!.billing.state='unknown'; e.routes[1]!.billing.state='unknown'; e.routes[3]!.billing.state='unknown';
  const r=await runPilot(request,harness({evidence:e}).driver,()=>now);
  expect(r.status).toBe('consensus');
  expect(r.calls).toEqual({probes:8,topic:10});
});

it("reuses qualification after the previous run deadline and before its independent default one-hour TTL", async () => {
  const first = await runPilot(request, harness().driver, () => now);
  expect(first.proofs[0]?.expiresAt).toBe(now + 3600000);
  const later = now + 200000;
  const second = await runPilot({ ...request, deadline: later + 100000, proofs: first.proofs }, harness().driver, () => later);
  expect(second.status).toBe("consensus");
  expect(second.calls).toEqual({ probes: 0, topic: 10 });
});

it("bounds a separately configured proof TTL to 24 hours", async () => {
  const valid = await runPilot({ ...request, proofTtlMs: 86400000 }, harness().driver, () => now);
  expect(valid.proofs[0]?.expiresAt).toBe(now + 86400000);
  const invalid = await runPilot({ ...request, proofTtlMs: 86400001 }, harness().driver, () => now);
  expect(invalid.status).toBe("invalid_request");
  expect(invalid.calls).toEqual({ probes: 0, topic: 0 });
});

it("retains an unknown cancellation without repeating the stop mutation", async () => {
  const h = harness({ cancelUnknown: true });
  const r = await runPilot(request, h.driver, () => now);
  expect(r.status).toBe("failed");
  expect(r.calls).toEqual({ probes: 2, topic: 0 });
  expect(r.unresolved).toHaveLength(1);
  expect(h.calls.filter((c) => c.argv[1] === "worker-stop")).toHaveLength(1);
});
