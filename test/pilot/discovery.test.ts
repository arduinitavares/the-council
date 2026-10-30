import { expect, it, vi } from "vitest";
import { NativeHostInspector } from "../../src/pilot/discovery.js";
import { mkdtempSync, writeFileSync, rmSync, realpathSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { incidentRoster, policyTable } from "./fixtures.js";
import type { PilotRequest } from "../../src/pilot/types.js";
it("uses supported provider catalog/usage sources while preserving actual missing controls and billing binding", async () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "pilot-host-")));
  vi.stubEnv("HOME", workspace);
  try {
    const policy = join(workspace, ".agents/policies/model-policy.md");
    mkdirSync(join(workspace, ".agents/policies"), { recursive: true });
    writeFileSync(
      policy,
      policyTable,
    );
    const calls: string[] = [];
    let catalogDenied = false;
    let accountVariant = "fresh";
    let supportDenied = false;
    let effortMapping = true;
    let nativeOmission = false;
    let omitRequestShow = false;
    const inspector = new NativeHostInspector(
      async (argv) =>
        argv[0] === "agent-context"
          ? {
              commands: [
                "worktree show",
                "orchestration worker-start",
                "orchestration worker-show",
                "orchestration worker-read",
                "orchestration worker-stop",
                "orchestration worker-release",
                "orchestration request-show",
              ].filter(command => !omitRequestShow || command !== "orchestration request-show").map((command) => ({ command })),
            }
          : argv[0] === "status"
            ? {
                runtime: {
                  state: "ready",
                  reachable: true,
                  appVersion: "1.4.244",
                  runtimeId: "runtime",
                  capabilities: [
                    "settings.agent-launch.v1",
                    "agent-session.coherent-model-catalog.v1",
                    "orchestration.worker-stop-verdict.v1",
                  ],
                },
              }
            : { worktree: { id: "repo::B", path: workspace, hostId: "local" } },
      () => ({
        effortSupport: async () => ({efforts: effortMapping ? ["high"] : [],source:"synthetic explicit AGY option mapping",detail:"--effort value"}),
        call: async (method, params) => {
          if (method === "accounts.list") {
            expect(params).toEqual({ refreshUsage: true });
            calls.push("accounts.list");
            if (accountVariant === "denied") throw Error("permission_denied");
            if (accountVariant === "missing") return { rateLimits: {} };
            const q = { provider: "codex", status: "ok", updatedAt: Date.now() - (accountVariant === "stale" ? 600000 : 0), session: null, weekly: accountVariant === "unknown" ? null : { usedPercent: accountVariant === "exhausted" ? 100 : 60, windowMinutes: 10080, resetsAt: 1800000000000 }, extraUsage: { enabled: true } };
            return { rateLimits: { codex: q, cursor: { ...q, provider: "cursor", weekly: null, monthly: q.weekly, planType: "premium", buckets: [{name:"Cursor Models",...q.weekly}], usageMetadata: { source: "cli", authProvenance: "must-not-persist" } } } };
          }
          if (method === "agentSession.createSupport") {
            if (supportDenied) throw Error("permission_denied");
            return { agent: params.agent, supported: params.agent !== "cursor", ...(params.agent === "cursor" ? { reason: "agent" } : {seedOptions:{permissionMode:"full-access"}}) };
          }
          if (catalogDenied && params.agent === "cursor")
            throw Error("permission_denied");
          return method === "settings.getAgentLaunch"
            ? {
                settings: {
                  agentPermission: { default: "full-access" },
                  agentDefaultArgs: {},
                },
              }
            : params.agent === "antigravity" ? {origin:"live-session",models:[{id:"gemini-4-argon-high",efforts:[]}]} : nativeOmission ? { models: [], origin: "live-session" } : { origin: "unknown" };
        },
      }),
      async (provider, op) => {
        calls.push(provider + ":" + op);
        if (op === "version") return "synthetic-version";
        if (op === "models")
          return provider === "cursor"
            ? "grok-4.7-xhigh - Grok"
            : "gemini-4-argon-high";
        return JSON.stringify({
          conversation_id: "",
          num_turns: 0,
          usage: { total_tokens: 0 },
          command: {
            name: "usage",
            data: {
              groups: [
                {
                  name: "Gemini Models",
                  buckets: [{ remaining_fraction: 0.8, window: "weekly" }],
                },
              ],
            },
          },
        });
      },
      async () => ({ bootstrap: { state: "missing", source: "synthetic control boundary", detail: "No enforcement fixture supplied" }, controls: { state: "missing", source: "synthetic control boundary", detail: "No enforcement fixture supplied" }, facts: [] }),
    );
    const r = await inspector.inspect({
      workspace,
      policyPath: policy,
      config: incidentRoster,
    } as PilotRequest);
    omitRequestShow = true;
    await expect(inspector.inspect({ workspace, policyPath: policy, config: incidentRoster } as PilotRequest)).rejects.toThrow("UNSUPPORTED_REQUIRED_COMMAND:orchestration request-show");
    omitRequestShow = false;
    expect(r.evidence.routes.find((r) => r.role === "xai")?.catalog.state).toBe(
      "verified",
    );
    const policyBytes = Buffer.concat([Buffer.from(policyTable), Buffer.from([0xff])]);
    writeFileSync(policy, policyBytes);
    const raw = await inspector.inspect({ workspace, policyPath: policy, config: incidentRoster } as PilotRequest);
    expect(raw.evidence.policyHash).toBe(createHash("sha256").update(policyBytes).digest("hex"));
    writeFileSync(policy, policyTable.replace("| `max` |", "| `max`; `ultra` on a qualified route |"));
    const ultraConfig = structuredClone(incidentRoster);
    ultraConfig.reviewers.openai.effort = "ultra";
    const ultra = await inspector.inspect({ workspace, policyPath: policy, config: ultraConfig } as PilotRequest);
    expect(ultra.blockers).toContainEqual(expect.objectContaining({ role: "openai", control: "policy", reason: "POLICY_ROUTE_QUALIFICATION_REQUIRED" }));
    writeFileSync(policy, policyTable);
    const foreignPolicy = join(workspace, "caller-policy.md");
    writeFileSync(foreignPolicy, policyTable);
    await expect(inspector.inspect({ workspace, policyPath: foreignPolicy, config: incidentRoster } as PilotRequest)).rejects.toThrow("EXECUTION_HOST_POLICY_PATH_MISMATCH");
    expect(r.evidence.routes.find(r => r.role === "gemini")?.catalog.state).toBe("verified");
    effortMapping = false;
    const noEffortMapping = await inspector.inspect({workspace,policyPath:policy,config:incidentRoster} as PilotRequest);
    expect(noEffortMapping.evidence.routes.find(r => r.role === "gemini")?.catalog).toMatchObject({state:"missing",detail:expect.stringContaining("model present; effort")});
    effortMapping = true;
    expect(
      r.evidence.routes.find((r) => r.role === "gemini")?.allowance.state,
    ).toBe("verified");
    expect(r.evidence.routes.every(r => r.controls.state === "missing")).toBe(true);
    expect(r.evidence.routes.find(r => r.role === "openai")?.allowance.state).toBe("verified");
    expect(r.evidence.routes.find(r => r.role === "xai")?.allowance.state).toBe("verified");
    expect(JSON.parse(r.evidence.routes.find(r => r.role === "xai")!.allowance.detail)).toMatchObject({ windows: { monthly: {windowMinutes:10080,usedPercent:60} } });
    expect(JSON.stringify(r.evidence)).not.toContain("must-not-persist");
    expect(r.evidence.routes.find(r => r.role === "openai")?.billing.state).toBe("unknown");
    expect(r.evidence.routes.find(r => r.role === "xai")?.billing.state).toBe("missing");
    expect(r.evidence.routes.find(r => r.role === "xai")?.billing.source).toBe("No supported Cursor included-only debit source integrated");
    nativeOmission = true;
    const fallback = await inspector.inspect({workspace,policyPath:policy,config:incidentRoster} as PilotRequest);
    expect(fallback.evidence.routes.find(r => r.role === "xai")?.catalog.source).toContain("documented provider models command");
    nativeOmission = false;
    expect(calls).toContain("accounts.list");
    const plan = r.evidence.routes.find(r => r.role === "xai")?.scopedLaunchPlan;
    expect(plan).toMatchObject({
      method: "agent.launch", promptSubmitted: false,
      request: { agent: "cursor", target: { kind: "existing", worktree: `path:${workspace}` },
        surface: "terminal", presentation: "background", sessionOptions: {model:"grok-4.7-xhigh",permissionMode:"own"} },
      custody: "task-created-external", adoption: "worker-start --terminal",
      structuredSupport: {state:"unsupported"},
    });
    expect(plan?.request.sessionOptions).not.toHaveProperty("effort");
    expect(typeof plan?.request.agentArgs).toBe("string");
    expect(plan?.pendingControls).toContain("external-terminal-settlement-and-completion-relay");
    expect(calls).toContain("cursor:models");
    expect(calls).toContain("antigravity:usage");
    expect(r.blockers.filter(b => b.control === "policy")).toEqual([]);
    expect(r.evidence.routes.find(r => r.role === "xai")?.policyAdmission).toEqual({
      state: "conditional", routeCell: "Cursor, pending host/action qualification",
      qualifier: "pending host/action qualification", firstUseOnly: true,
    });
    writeFileSync(policy, policyTable.replace("Matching `xhigh`", "Matching `high`"));
    const wrongEffort = await inspector.inspect({ workspace, policyPath: policy, config: incidentRoster } as PilotRequest);
    expect(wrongEffort.blockers).toContainEqual(expect.objectContaining({ role: "xai", reason: "EXACT_SELECTION_NOT_IN_HOST_POLICY" }));
    writeFileSync(policy, "Retired model mentions are not admission.\n" + Object.values(incidentRoster.reviewers).map(s => s.model).join("\n"));
    const noTable = await inspector.inspect({ workspace, policyPath: policy, config: incidentRoster } as PilotRequest);
    expect(noTable.blockers.filter(b => b.control === "policy")).toHaveLength(4);
    writeFileSync(policy, policyTable);
    catalogDenied = true;
    const denied = await inspector.inspect({
      workspace,
      policyPath: policy,
      config: incidentRoster,
    } as PilotRequest);
    expect(
      denied.evidence.routes.find((r) => r.role === "xai")?.catalog.state,
    ).toBe("denied");
    for (const [variant, expected] of [["stale","missing"],["unknown","unknown"],["exhausted","exhausted"],["denied","denied"],["missing","missing"]]) {
      accountVariant = variant!;
      const observed = await inspector.inspect({workspace,policyPath:policy,config:incidentRoster} as PilotRequest);
      expect(observed.evidence.routes.find(r => r.role === "openai")?.allowance.state, variant).toBe(expected);
    }
    supportDenied = true;
    const refusedSupport = await inspector.inspect({workspace,policyPath:policy,config:incidentRoster} as PilotRequest);
    expect(refusedSupport.evidence.routes[0]?.controls.state).toBe("denied");
  } finally {
    vi.unstubAllEnvs();
    rmSync(workspace, { recursive: true, force: true });
  }
});

it("distinguishes absent usage windows from explicit null windows", async () => {
  const {accountAllowance} = await import("../../src/pilot/allowance.js");
  const value = {provider:"codex",status:"ok",updatedAt:Date.now()};
  expect(accountAllowance("codex",value,Date.now()).state).toBe("missing");
  expect(accountAllowance("codex",{...value,session:null,weekly:null},Date.now()).state).toBe("unknown");
});
