import { canonicalJson } from "../domain/hash.js";
export const CODEX_DISABLED_FEATURES = ["hooks", "apps", "plugins", "multi_agent", "multi_agent_v2", "shell_tool", "view_image", "request_permissions_tool", "image_generation", "code_mode", "code_mode_only", "code_mode_host", "browser_use", "computer_use", "memories", "external_agent_memory_import", "standalone_web_search", "shell_snapshot", "shell_snapshot_v2", "recommended_plugins", "remote_plugin", "skill_search"] as const;
export interface CodexPolicy { name: string; filesystem: Record<string, "read" | "deny">; featureKeys: string[] }
/** Exact rust-v0.164.0 process-scoped kernel. Requested configuration is still
 * checked against merged sources, requirements and selected thread profile. */
export function codexKernel(configurations: readonly any[], cwd: string, model: string, effort: string) {
  const filesystem: CodexPolicy["filesystem"] = { [cwd]: "read" };
  const issues: string[] = [];
  for (const config of configurations) {
    if (config.permissions?.council_packet) issues.push("EXISTING_PROFILE_NAME_COLLISION");
    for (const profile of Object.values(config.permissions ?? {}) as any[]) {
      for (const [target, access] of Object.entries(profile.filesystem ?? {})) {
        if (access === "deny" || access === "none") filesystem[target] = "deny";
        else if (typeof access !== "string") issues.push("INHERITED_DENY_SHAPE_UNVERIFIED");
      }
    }
  }
  const name = "council_packet";
  const inline = "{"+Object.entries(filesystem).map(([target, access]) => `${JSON.stringify(target)}=${JSON.stringify(access)}`).join(",")+"}";
  const argv = ["--ask-for-approval", "never", "--model", model, "-c", `model_reasoning_effort=${JSON.stringify(effort)}`,
    ...CODEX_DISABLED_FEATURES.flatMap(feature => ["--disable", feature]),
    "-c", `default_permissions=${JSON.stringify(name)}`, "-c", "notify=[]", "-c", "web_search=\"disabled\"", "-c", "agents.enabled=false", "-c", "apps._default.enabled=false",
    "-c", `permissions.${name}.filesystem=${inline}`, "-c", `permissions.${name}.network.enabled=false`];
  for (const config of configurations) {
    for (const key of Object.keys(config.mcp_servers ?? {})) argv.push("-c", `mcp_servers.${JSON.stringify(key)}.enabled=false`);
    for (const key of Object.keys(config.plugins ?? {})) argv.push("-c", `plugins.${JSON.stringify(key)}.enabled=false`);
  }
  argv.push("app-server");
  return { argv, policy: { name, filesystem, featureKeys: [...CODEX_DISABLED_FEATURES] }, issues };
}
export function verifyCodexConfig(config: any, policy: CodexPolicy, model: string, effort: string): boolean {
  const profile = config?.permissions?.[policy.name];
  return !!config && config.model === model && config.model_reasoning_effort === effort && config.approval_policy === "never" &&
    config.default_permissions === policy.name && config.web_search === "disabled" && Array.isArray(config.notify) && config.notify.length === 0 &&
    config.agents?.enabled === false && policy.featureKeys.every(feature => config.features?.[feature] === false) &&
    profile && profile.extends == null && profile.network?.enabled === false && canonicalJson(profile.filesystem) === canonicalJson(policy.filesystem) &&
    Object.values(config.mcp_servers ?? {}).every((entry: any) => entry.enabled === false) && Object.values(config.plugins ?? {}).every((entry: any) => entry.enabled === false);
}
export function verifyCodexRequirements(requirements: any, name: string): boolean {
  if (requirements === null) return true;
  if (!requirements || typeof requirements !== "object") return false;
  return (!requirements.allowedApprovalPolicies || requirements.allowedApprovalPolicies.includes("never")) &&
    (!requirements.allowedPermissionProfiles || requirements.allowedPermissionProfiles.includes(name)) &&
    (!requirements.allowedWebSearchModes || requirements.allowedWebSearchModes.includes("disabled"));
}
