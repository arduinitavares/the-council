import { readProvider, type ProviderRead } from "./provider-read.js";
import { readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
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
import { accountAllowance, readFailure } from "./allowance.js";
import { scopedLaunchPlan } from "./scoped-launch.js";
import { inspectProviderControls, type ProviderControlSource } from "./provider-controls.js";
const digest = (x: string | Buffer) => createHash("sha256").update(x).digest("hex");
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
    private readonly controlSource: ProviderControlSource = inspectProviderControls,
  ) {}
  async inspect(
    request: PilotRequest,
  ): Promise<{ evidence: NativeEvidence; blockers: Blocker[] }> {
    const blockers: Blocker[] = [];
    let canonicalPolicy: string;
    try { canonicalPolicy = realpathSync(join(homedir(), ".agents/policies/model-policy.md")); }
    catch (cause) { throw Error("EXECUTION_HOST_POLICY_UNAVAILABLE", { cause }); }
    if (realpathSync(request.policyPath) !== canonicalPolicy)
      throw Error("EXECUTION_HOST_POLICY_PATH_MISMATCH");
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
    if (!process.env.ORCA_TERMINAL_HANDLE || !process.env.ORCA_PANE_KEY) blockers.push({ role: null, control: "native-coordinator",
      reason: "NATIVE_COORDINATOR_CONTEXT_MISSING", source: "Orca-injected terminal caller context", observed: "A genuine stable requesting-workspace coordinator terminal is required before run-create and initialization",
      nextAction: "Invoke the packaged native entry inside an existing task-owned Orca terminal in this requesting workspace; do not copy --from or caller environment from another session." });
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
      "orchestration request-show",
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
    const policyBytes = readFileSync(canonicalPolicy);
    const policy = policyBytes.toString("utf8");
    if (!policy.trim()) throw Error("EXECUTION_HOST_POLICY_EMPTY");
    const api = this.rpc(runtimeId);
    const settings = (await api.call("settings.getAgentLaunch", {})).settings;
    let rateLimits: any;
    let accountFailure: Observation | undefined;
    try {
      rateLimits = (await api.call("accounts.list", { refreshUsage: true })).rateLimits;
    } catch (error) {
      accountFailure = readFailure("Orca accounts.list(refreshUsage=true)", error);
    }
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
      let support: any;
      try { support = await api.call("agentSession.createSupport", {agent:selection.route,worktree:`path:${workspace}`}); }
      catch(error) { support = {observation:readFailure("Orca agentSession.createSupport",error)}; }
      const plan = scopedLaunchPlan(workspace, selection, support);
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
      let providerFallback = false;
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
      ) {
        model = { id: selection.model, efforts: [] };
        providerFallback = true;
      }
      let effortContract: Awaited<ReturnType<NonNullable<ReadRpc["effortSupport"]>>> | undefined;
      if (model && selection.route === "antigravity" && !catalogFailure && api.effortSupport) {
        try { effortContract = await api.effortSupport(selection.route); } catch {}
      }
      const effort =
        model?.efforts?.some((e: any) => e.value === selection.effort) ||
        selection.effortEncoding === "model" || effortContract?.efforts.includes(selection.effort);
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
      const billing = observation(selection.route === "cursor" ? "missing" : "unknown",
        selection.route === "cursor" ? "No supported Cursor included-only debit source integrated" : `execution-host policy sha256=${digest(policyBytes)} and existing authorized provider access`,
        selection.route === "cursor" ? "Included-only enforcement must come from the existing supported account constraint; plan, quota and extraUsage=false alone are insufficient." : "Existing provider access is preserved; no new spending authority.");
      const controls = await this.controlSource(selection, versions[selection.route] ?? "unexposed", workspace, billing);
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
                  : model ? "missing" : "unavailable",
          providerFallback
            ? "documented provider models command; native agentSession.modelCatalog did not expose the selection"
            : `Orca agentSession.modelCatalog${effortContract?.efforts.includes(selection.effort) ? "; " + effortContract.source : ""}`,
          disabled
            ? "route disabled"
            : catalogFailure
              ? "Native catalog request returned " + catalogFailure
              : !catalog.models && !model
                ? `catalog ${catalog.origin ?? "unexposed"}`
                : model && effort
                  ? `exact selection exposed${effortContract?.efforts.includes(selection.effort) ? "; " + effortContract.detail : ""}`
                  : model ? "exact model present; effort mapping unverified" : "exact model unavailable",
        ),
        controls: ["denied","authentication_failed","exhausted"].includes(plan.structuredSupport.state) ? plan.structuredSupport : controls.controls,
        bootstrap: ["denied","authentication_failed","exhausted"].includes(plan.structuredSupport.state) ? plan.structuredSupport : controls.bootstrap,
        controlFacts: controls.facts,
        ...(controls.recipe ? { recipe: controls.recipe } : {}),
        scopedLaunchPlan: plan,
        allowance:
          selection.route === "antigravity"
            ? agyAllowance
            : accountFailure ?? accountAllowance(selection.route, rateLimits?.[selection.route], Date.now()),
        billing,
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
          cells[1]?.split(",")[0]?.trim() === policyRoute &&
          cells[2]?.includes("`" + selection.model + "`")
        );
      });
      const cells = admissionRow?.split("|").map(cell => cell.trim());
      // Bootstrap probes cannot establish the separately required Ultra host,
      // transport and helper-action qualification. No such native source is
      // integrated, so a table mention alone must never admit this effort.
      const requiresPriorQualification = selection.effort === "ultra";
      const admitted =
        !requiresPriorQualification &&
        cells?.[3]?.includes("`" + selection.effort + "`") &&
        (!cells[3].includes("Matching") || selection.model.endsWith("-" + selection.effort));
      if (admitted) {
        const routeCell = cells![1]!;
        const qualifier = routeCell.split(",").slice(1).join(",").trim();
        const conditional = /pending|conditional/i.test(qualifier);
        routes.at(-1)!.policyAdmission = {
          state: conditional ? "conditional" : "admitted", routeCell, qualifier,
          firstUseOnly: conditional,
        };
        // Conditional admission permits this explicitly bounded first-use
        // qualification after bootstrap controls pass. It does not certify
        // the coordinator's ordinary host/model/action route.
      }
      if (!admitted)
        blockers.push({
          role: role as Role,
          control: "policy",
          reason: requiresPriorQualification ? "POLICY_ROUTE_QUALIFICATION_REQUIRED" : "EXACT_SELECTION_NOT_IN_HOST_POLICY",
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
      policyHash: digest(policyBytes),
      controlsHash: digest(
        canonicalJson({
          settings: {
            permissionMode: settings?.permissionMode ?? null,
            agentPermission: settings?.agentPermission ?? null,
            agentDefaultArgs: settings?.agentDefaultArgs ?? null,
          },
          workspaceId: w.id,
          scopedPlans: routes.map(r => r.scopedLaunchPlan),
          providerControls: routes.map(r => ({ bootstrap: r.bootstrap, controls: r.controls,
            recipe: r.recipe ? { ...r.recipe, facts: r.recipe.facts.map(({ observedAt: _observedAt, ...fact }) => fact) } : null })),
        }),
      ),
      routes,
    };
    return { evidence, blockers };
  }
}
