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
  const argv = ["-c", `model=${JSON.stringify(model)}`, "-c", 'approval_policy="never"', "-c", `model_reasoning_effort=${JSON.stringify(effort)}`,
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
const object = (value: any): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = (value: any) => typeof value === "string" && value.length > 0;
const absolute = (value: any) => nonempty(value) && value.startsWith("/");
function layerName(name: any): boolean {
  if (!object(name)) return false;
  switch (name.type) {
    case "sessionFlags": case "legacyManagedConfigTomlFromMdm": return true;
    case "mdm": return nonempty(name.domain) && nonempty(name.key);
    case "system": case "legacyManagedConfigTomlFromFile": return absolute(name.file);
    case "user": return absolute(name.file) && (name.profile == null || nonempty(name.profile));
    case "project": return absolute(name.dotCodexFolder);
    case "enterpriseManaged": return nonempty(name.id) && nonempty(name.name);
    default: return false; // Packaged defaults are deliberately omitted by config/read.
  }
}
function merge(base: Record<string, any>, overlay: Record<string, any>): Record<string, any> {
  const result = Object.assign(Object.create(null), base);
  for (const [key, value] of Object.entries(overlay)) {
    result[key] = object(value) ? merge(object(result[key]) ? result[key] : {}, value) : value;
  }
  return result;
}
/** config/read exposes a typed public Config (which omits raw controls) plus
 * raw layers in HIGH-to-LOW precedence. Disabled layers are UI evidence only.
 * Never treat the typed projection or the raw stack alone as effective proof. */
export function verifyCodexConfig(response: any, policy: CodexPolicy, model: string, effort: string): boolean {
  if (!object(response) || !object(response.config) || !object(response.origins) ||
      !Array.isArray(response.layers) || !response.layers.length) return false;
  const config = response.config;
  if (config.model !== model || config.model_reasoning_effort !== effort || config.approval_policy !== "never" ||
      config.web_search !== "disabled" || config.apps?._default?.enabled !== false) return false;
  const identities = new Set<string>();
  let session = 0;
  for (const layer of response.layers) {
    if (!object(layer) || !layerName(layer.name) || !nonempty(layer.version) || !object(layer.config) ||
        !(layer.disabledReason == null || nonempty(layer.disabledReason))) return false;
    const identity = canonicalJson(layer.name);
    if (identities.has(identity)) return false;
    identities.add(identity);
    if (layer.name.type === "sessionFlags" && layer.disabledReason == null) session++;
  }
  if (session !== 1) return false;
  for (const origin of Object.values(response.origins)) {
    if (!object(origin) || !layerName(origin.name) || !nonempty(origin.version) ||
        !response.layers.some((layer: any) => layer.disabledReason == null && layer.version === origin.version && canonicalJson(layer.name) === canonicalJson(origin.name))) return false;
  }
  let raw: Record<string, any> = {};
  for (const layer of [...response.layers].reverse()) {
    if (layer.disabledReason != null) continue;
    // Preserve every active source's Deny, even if a higher layer shadows it.
    if (layer.config.permissions != null && !object(layer.config.permissions)) return false;
    for (const [name, profile] of Object.entries(layer.config.permissions ?? {}) as [string, any][]) {
      if (!object(profile) || (profile.filesystem != null && !object(profile.filesystem))) return false;
      if (name === policy.name && layer.name.type !== "sessionFlags") return false;
      for (const [target, access] of Object.entries(profile.filesystem ?? {})) {
        if (typeof access !== "string") return false;
        if ((access === "deny" || access === "none") && policy.filesystem[target] !== "deny") return false;
      }
    }
    raw = merge(raw, layer.config);
  }
  const profile = raw.permissions?.[policy.name];
  const disabledEntries = (entries: any) => entries === undefined || (object(entries) && Object.values(entries).every(entry => object(entry) && entry.enabled === false));
  return raw.model === model && raw.model_reasoning_effort === effort && raw.approval_policy === "never" &&
    raw.default_permissions === policy.name && raw.web_search === "disabled" && Array.isArray(raw.notify) && raw.notify.length === 0 &&
    raw.agents?.enabled === false && raw.apps?._default?.enabled === false &&
    // The policy must cover the entire pinned ceiling, not a caller's subset.
    canonicalJson(policy.featureKeys) === canonicalJson([...CODEX_DISABLED_FEATURES]) &&
    policy.featureKeys.every(feature => raw.features?.[feature] === false) &&
    object(profile) && profile.extends == null && profile.network?.enabled === false &&
    Object.keys(profile).every(key => ["filesystem", "network", "extends"].includes(key)) &&
    Object.keys(profile.network).every(key => key === "enabled") &&
    object(profile.filesystem) && canonicalJson(profile.filesystem) === canonicalJson(policy.filesystem) &&
    disabledEntries(raw.mcp_servers) && disabledEntries(raw.plugins);
}
/** Managed requirements can override raw layers. Check these independently
 * before thread/start, including the real map-shaped permission allowlist. */
export function verifyCodexRequirements(requirements: any, name: string, model?: string, effort?: string): boolean {
  if (requirements === null) return true;
  if (!object(requirements)) return false;
  const allows = (values: any, expected: string) => values == null || (Array.isArray(values) && values.every(value => typeof value === "string") && values.includes(expected));
  if (!allows(requirements.allowedApprovalPolicies, "never") || !allows(requirements.allowedWebSearchModes, "disabled")) return false;
  const profiles = requirements.allowedPermissionProfiles;
  if (profiles != null && (!object(profiles) || !Object.values(profiles).every(value => typeof value === "boolean") || profiles[name] !== true)) return false;
  if (requirements.defaultPermissions != null && requirements.defaultPermissions !== name) return false;
  const features = requirements.featureRequirements;
  if (features != null && (!object(features) || !Object.values(features).every(value => typeof value === "boolean") ||
      CODEX_DISABLED_FEATURES.some(feature => features[feature] === true))) return false;
  if (requirements.network != null && (!object(requirements.network) || (requirements.network.enabled != null && requirements.network.enabled !== false))) return false;
  // Unknown managed hook sources must not be dispositioned as ordinary disabled hooks.
  if (requirements.hooks != null && (!object(requirements.hooks) || Object.values(requirements.hooks).some(value => value != null && (!Array.isArray(value) || value.length > 0)))) return false;
  if (requirements.models != null) {
    const defaults = requirements.models.newThread;
    if (!object(requirements.models) || (defaults != null && (!object(defaults) ||
        (defaults.model != null && defaults.model !== model) || (defaults.modelReasoningEffort != null && defaults.modelReasoningEffort !== effort)))) return false;
  }
  return true;
}
