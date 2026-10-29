import { expect, it } from "vitest";
import { NativeHostInspector } from "../../src/pilot/discovery.js";
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { incidentRoster } from "./fixtures.js";
import type { PilotRequest } from "../../src/pilot/types.js";
it("uses supported provider catalog/usage sources while preserving actual missing controls and billing binding", async () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "pilot-host-")));
  try {
    const policy = join(workspace, "policy.md");
    writeFileSync(
      policy,
      Object.values(incidentRoster.reviewers)
        .map((s) => s.model)
        .join("\n") +
        "\n" +
        incidentRoster.judge.model,
    );
    const calls: string[] = [];
    let catalogDenied = false;
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
              ].map((command) => ({ command })),
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
        call: async (method, params) => {
          if (catalogDenied && params.agent === "cursor")
            throw Error("permission_denied");
          return method === "settings.getAgentLaunch"
            ? {
                settings: {
                  agentPermission: { default: "full-access" },
                  agentDefaultArgs: {},
                },
              }
            : { origin: "unknown" };
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
    );
    const r = await inspector.inspect({
      workspace,
      policyPath: policy,
      config: incidentRoster,
    } as PilotRequest);
    expect(r.evidence.routes.find((r) => r.role === "xai")?.catalog.state).toBe(
      "verified",
    );
    expect(
      r.evidence.routes.find((r) => r.role === "gemini")?.allowance.state,
    ).toBe("verified");
    expect(
      r.evidence.routes.every(
        (r) => r.controls.state === "missing" && r.billing.state === "missing",
      ),
    ).toBe(true);
    expect(calls).toContain("cursor:models");
    expect(calls).toContain("antigravity:usage");
    catalogDenied = true;
    const denied = await inspector.inspect({
      workspace,
      policyPath: policy,
      config: incidentRoster,
    } as PilotRequest);
    expect(
      denied.evidence.routes.find((r) => r.role === "xai")?.catalog.state,
    ).toBe("denied");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
