import { readProvider, type ProviderRead } from "./provider-read.js";
import { readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { canonicalJson } from "../domain/hash.js";
import type { Command } from "./orca-driver.js";
import type { ReadRpc } from "./rpc.js";
import type {
  Blocker,
  HostInspector,
  NativeEvidence,
  Observation,
  PilotRequest,
  RouteEvidence,
} from "./types.js";
import type { Role } from "./config.js";
const digest = (x: string) => createHash("sha256").update(x).digest("hex");
const observation = (
  state: Observation["state"],
  source: string,
  detail: string,
): Observation => ({ state, source, detail });
export class NativeHostInspector implements HostInspector {
  constructor(
    private readonly command: Command,
    private readonly rpc: (runtimeId: string) => ReadRpc,
    private readonly provider: ProviderRead = readProvider,
  ) {}
  async inspect(
    request: PilotRequest,
  ): Promise<{ evidence: NativeEvidence; blockers: Blocker[] }> {
    const blockers: Blocker[] = [];
    const status = await this.command(
      ["status", "--json"],
      request.workspace,
      5000,
    );
    if (status.runtime?.state !== "ready" || status.runtime?.reachable !== true)
      throw Error("ORCA_NOT_RUNNING_OR_READY");
    const version = status.runtime.appVersion;
    if (version !== "1.4.244")
      throw Error("UNSUPPORTED_ORCA_API_VERSION: expected 1.4.244");
    const runtimeId = status.runtime.runtimeId;
    for (const capability of [
      "settings.agent-launch.v1",
      "agent-session.coherent-model-catalog.v1",
      "orchestration.worker-stop-verdict.v1",
    ])
      if (!status.runtime.capabilities?.includes(capability))
        throw Error("UNSUPPORTED_REQUIRED_CAPABILITY:" + capability);
    const registry = await this.command(
      ["agent-context", "--json"],
      request.workspace,
      5000,
    );
    for (const required of [
      "worktree show",
      "orchestration worker-start",
      "orchestration worker-show",
      "orchestration worker-read",
      "orchestration worker-stop",
      "orchestration worker-release",
    ])
      if (!registry.commands?.some((entry: any) => entry.command === required))
        throw Error("UNSUPPORTED_REQUIRED_COMMAND:" + required);
    const workspace = realpathSync(request.workspace);
    const w = (
      await this.command(
        ["worktree", "show", "--worktree", `path:${workspace}`, "--json"],
        workspace,
        5000,
      )
    ).worktree;
    if (!w || w.path !== workspace || typeof w.id !== "string")
      throw Error("REQUESTING_WORKSPACE_UNVERIFIED");
    const policy = readFileSync(request.policyPath, "utf8");
    if (!policy.trim()) throw Error("EXECUTION_HOST_POLICY_EMPTY");
    const api = this.rpc(runtimeId);
    const settings = (await api.call("settings.getAgentLaunch", {})).settings;
    const versions: Record<string, string> = { orca: version };
    for (const route of ["codex", "antigravity", "cursor"] as const) {
      try {
        versions[route] = (
          await this.provider(route, "version", workspace)
        ).trim();
      } catch {
        versions[route] = "unexposed";
      }
    }
    let cursorModels = "";
    try {
      cursorModels = await this.provider("cursor", "models", workspace);
    } catch {}
    let agyModels = "";
    try {
      agyModels = await this.provider("antigravity", "models", workspace);
    } catch {}
    let agyAllowance: Observation = observation(
      "missing",
      "AGY /usage non-inference command",
      "Required command evidence unavailable",
    );
    try {
      const usage = JSON.parse(
        await this.provider("antigravity", "usage", workspace),
      );
      if (
        usage.command?.name !== "usage" ||
        usage.num_turns !== 0 ||
        usage.conversation_id !== "" ||
        usage.usage?.total_tokens !== 0
      )
        throw Error("NON_INFERENCE_USAGE_NOT_PROVEN");
      const groups = usage.command.data.groups;
      const gemini = groups.find((g: any) => g.name === "Gemini Models");
      if (!Array.isArray(gemini?.buckets) || gemini.buckets.length === 0)
        throw Error("ALLOWANCE_WINDOWS_MISSING");
      const values = gemini.buckets.map((b: any) => b.remaining_fraction);
      agyAllowance = observation(
        values.some((n: any) => typeof n === "number" && n <= 0)
          ? "exhausted"
          : values.every((n: any) => typeof n === "number" && n > 0)
            ? "verified"
            : "unknown",
        "AGY documented /usage command",
        canonicalJson({
          groups: groups.map((g: any) => ({
            name: g.name,
            buckets: g.buckets,
          })),
        }),
      );
    } catch {}
    const routes: RouteEvidence[] = [];
    for (const [role, selection] of [
      ...Object.entries(request.config.reviewers),
      ["judge", request.config.judge],
    ] as const) {
      let catalog: any;
      let catalogFailure: Observation["state"] | null = null;
      try {
        catalog = await api.call("agentSession.modelCatalog", {
          agent: selection.route,
          worktree: `path:${workspace}`,
        });
      } catch (error) {
        const diagnostic = String(
          (error as any)?.code ??
            (error as any)?.response?.error?.code ??
            error,
        ).toLowerCase();
        catalogFailure =
          /authentication|unauthorized|not.authenticated|\b401\b/.test(
            diagnostic,
          )
            ? "authentication_failed"
            : /denied|forbidden|\b403\b/.test(diagnostic)
              ? "denied"
              : /unsupported/.test(diagnostic)
                ? "unsupported"
                : "missing";
        catalog = {};
      }
      let model = catalog.models?.find((m: any) => m.id === selection.model);
      const fallback =
        selection.route === "cursor"
          ? cursorModels
          : selection.route === "antigravity"
            ? agyModels
            : "";
      if (
        !catalogFailure &&
        !model &&
        fallback.split(/\s+/).includes(selection.model)
      )
        model = { id: selection.model, efforts: [] };
      const effort =
        model?.efforts?.some((e: any) => e.value === selection.effort) ||
        selection.effortEncoding === "model" ||
        (selection.route === "antigravity" &&
          selection.model.endsWith(`-${selection.effort}`));
      const disabled = settings?.disabledTuiAgents?.includes(selection.route);
      // Launch defaults are observations, not proof of roots/tools/helper containment.
      const mode =
        settings?.agentPermission?.overrides?.[selection.route] ??
        settings?.agentPermission?.default ??
        "unexposed";
      const source = "Orca 1.4.244 settings.getAgentLaunch";
      const args = settings?.agentDefaultArgs?.[selection.route];
      const permission =
        typeof args === "string"
          ? `permission=${mode}; launch argument digest=${digest(args)}`
          : "launch arguments unexposed";
      routes.push({
        role: role as Role,
        selection,
        version: versions[selection.route] ?? "unexposed",
        catalog: observation(
          disabled
            ? "denied"
            : catalogFailure
              ? catalogFailure
              : !catalog.models && !model
                ? "missing"
                : model && effort
                  ? "verified"
                  : "unavailable",
          model && !catalog.models
            ? "documented provider models command"
            : "Orca agentSession.modelCatalog",
          disabled
            ? "route disabled"
            : catalogFailure
              ? "Native catalog request returned " + catalogFailure
              : !catalog.models && !model
                ? `catalog ${catalog.origin ?? "unexposed"}`
                : model && effort
                  ? "exact selection exposed"
                  : "exact model/effort unavailable",
        ),
        controls: observation(
          "missing",
          source,
          `${permission}; required read-only roots, sandbox, hooks/tools, helper control and process-tree settlement are not exposed by this prelaunch API. worker-start cannot carry a per-launch mode in this version.`,
        ),
        allowance:
          selection.route === "antigravity"
            ? agyAllowance
            : observation(
                "missing",
                "Orca settings/catalog APIs",
                "No required provider usage observation was returned. Absence is distinct from an explicitly unknown balance.",
              ),
        billing: observation(
          "missing",
          source,
          selection.route === "cursor"
            ? "Included Premium weekly pool binding is not exposed; credits/overflow are not authorized."
            : "Existing billing-source constraint is not exposed by launch settings.",
        ),
        optionalTelemetry: observation(
          "unknown",
          "Orca prelaunch API",
          "Optional provider telemetry is unexposed",
        ),
      });
      // Interpret only the explicit admission table of the inspected policy
      // format. A model merely mentioned in a retirement paragraph is not admitted.
      const policyRoute = {
        codex: "Codex",
        antigravity: "AGY",
        cursor: "Cursor",
      }[selection.route];
      const admissionRow = policy.split("\n").find((line) => {
        const cells = line.split("|").map((cell) => cell.trim());
        return (
          cells[1]?.startsWith(policyRoute) &&
          cells[2]?.includes("`" + selection.model + "`")
        );
      });
      const admitted =
        admissionRow &&
        (admissionRow.includes("`" + selection.effort + "`") ||
          (admissionRow.includes("Matching") &&
            selection.model.endsWith("-" + selection.effort)));
      if (!admitted)
        blockers.push({
          role: role as Role,
          control: "policy",
          reason: "EXACT_SELECTION_NOT_IN_HOST_POLICY",
          source: "execution-host policy bytes",
          observed: selection.model,
          nextAction:
            "Inspect the execution-host policy; do not substitute a model.",
        });
    }
    const evidence: NativeEvidence = {
      host: w.hostId ?? "local",
      runtimeId,
      orcaVersion: version,
      versions,
      roots: [workspace],
      workspace,
      workspaceId: w.id,
      action: "supplied-packet-read-only",
      policyHash: digest(policy),
      controlsHash: digest(
        canonicalJson({
          settings: {
            permissionMode: settings?.permissionMode ?? null,
            agentPermission: settings?.agentPermission ?? null,
            agentDefaultArgs: settings?.agentDefaultArgs ?? null,
          },
          workspaceId: w.id,
        }),
      ),
      routes,
    };
    return { evidence, blockers };
  }
}
