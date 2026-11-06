import { createHash } from "node:crypto";
import { join } from "node:path";
import { selectionSchema, type ModelSelection } from "./config.js";
import type { ProviderRecipe } from "./wrapper-contract.js";
import type { AgyRecipeInputs } from "./agy-inventory-witness.js";

export class AgyRecipeSettingsError extends Error {
  constructor(field: "settings" | "permissions" | "permissions.deny") {
    super(`AGY_RECIPE_SETTINGS_INVALID:${field}`);
    this.name = "AgyRecipeSettingsError";
  }
}

const record = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Reconstruct package-owned bytes only. Parsed settings and an optional hook
 * policy are inputs, never proof of source acquisition or startup authority. */
export function buildAgyRecipePlan(input: {
  selection: ModelSelection; version: string; workspace: string; executable: string;
  legacySettings: unknown; agyHookShell: ProviderRecipe["agyHookShell"] | null;
}): AgyRecipeInputs {
  const { selection, version, workspace, executable, legacySettings, agyHookShell } = input;
  if (legacySettings !== undefined && !record(legacySettings)) throw new AgyRecipeSettingsError("settings");
  const settings = legacySettings ?? {};
  if ("permissions" in settings && !record(settings.permissions)) throw new AgyRecipeSettingsError("permissions");
  const permissions = (settings.permissions ?? {}) as Record<string, unknown>;
  if ("deny" in permissions && (!Array.isArray(permissions.deny) || [...permissions.deny].some(value => typeof value !== "string"))) {
    throw new AgyRecipeSettingsError("permissions.deny");
  }
  const inheritedDeny = (permissions.deny ?? []) as string[];
  const cwd = join(workspace, ".council/native-packets");
  const agent = "---\nname: council-packet\ndescription: Supplied-packet Council reader with no tools or helpers.\ntools: []\nmainAgent: true\nsubagent: false\nmcpServers: []\nskills: []\nplugins: []\ncommandExecutionPolicy: off\n---\nRead the supplied packet only and return its strict bound JSON envelope.\n";
  const session = JSON.stringify({ allowNonWorkspaceAccess: false, permissions: { ...permissions, deny: [...new Set([...inheritedDeny, "write_file(*)", "command(*)", "read_url(*)", "execute_url(*)", "mcp(*)"])] } });
  const agentDefinition = { path: join(cwd, ".agents/agents/council-packet/agent.md"), sha256: sha256(agent) };
  const sessionHash = sha256(session);
  const sessionPath = join(cwd, ".council-profiles", sessionHash, "session-settings.json");
  return {
    protocol: "agy-stream", executable, cwd, version, selection: selectionSchema.parse(selection), expectedPermission: "request-review",
    agent: "council-packet", agentDefinition,
    materializations: [{ path: agentDefinition.path, content: agent, sha256: agentDefinition.sha256 }, { path: sessionPath, content: session, sha256: sessionHash }],
    argv: ["--model", selection.model, "--effort", selection.effort, "--agent", "council-packet", "--add-dir", cwd, "--mode", "plan", "--sandbox", "--settings", sessionPath, "--input-format", "stream-json", "--output-format", "stream-json", "--print-timeout", "120s"],
    codexPolicy: null, agyHookShell: agyHookShell ?? null,
  };
}
