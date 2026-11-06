import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { buildAgyRecipePlan, AgyRecipeSettingsError } from "../../src/pilot/agy-recipe-plan.js";
import { incidentRoster } from "./fixtures.js";

const input = { selection: incidentRoster.reviewers.gemini, version: "1.4.12", workspace: "/fixture/project", executable: "/fixture/agy", agyHookShell: null };
const emptySession = '{"allowNonWorkspaceAccess":false,"permissions":{"deny":["write_file(*)","command(*)","read_url(*)","execute_url(*)","mcp(*)"]}}';

// Break caught: missing/empty settings generate distinct or unstable profiles,
// or recipe construction acquires startup authority rather than only inputs.
it.each([undefined, {}, { permissions: {} }, { permissions: { deny: [] } }])("builds the same recipe for valid empty settings %j", legacySettings => {
  const plan = buildAgyRecipePlan({ ...input, legacySettings });
  const sessionHash = createHash("sha256").update(emptySession).digest("hex");
  expect(plan).toMatchObject({ protocol: "agy-stream", executable: "/fixture/agy", version: "1.4.12", cwd: "/fixture/project/.council/native-packets",
    selection: { route: "antigravity", model: "gemini-4-argon-high", effort: "high" }, expectedPermission: "request-review", agent: "council-packet", codexPolicy: null, agyHookShell: null });
  expect(plan.materializations[1]).toEqual({ path: `/fixture/project/.council/native-packets/.council-profiles/${sessionHash}/session-settings.json`, content: emptySession, sha256: sessionHash });
  expect(plan.agentDefinition).toEqual({ path: plan.materializations[0]!.path, sha256: plan.materializations[0]!.sha256 });
  expect(plan).not.toHaveProperty("facts");
  expect(plan).not.toHaveProperty("sources");
});

// Break caught: Deny merging mutates frozen inputs, reorders inherited rules,
// loses unrelated permission fields, or binds hashes to different bytes.
it("preserves inherited Deny order and permission fields without mutating inputs", () => {
  const legacySettings = Object.freeze({ permissions: Object.freeze({ allow: Object.freeze(["read_file(*)"]), deny: Object.freeze(["custom(*)", "command(*)", "custom(*)"]) }) });
  const selection = Object.freeze({ ...input.selection });
  const plan = buildAgyRecipePlan({ ...input, selection, legacySettings });
  expect(plan.materializations[1]!.content).toBe('{"allowNonWorkspaceAccess":false,"permissions":{"allow":["read_file(*)"],"deny":["custom(*)","command(*)","write_file(*)","read_url(*)","execute_url(*)","mcp(*)"]}}');
  for (const item of plan.materializations) expect(item.sha256).toBe(createHash("sha256").update(item.content).digest("hex"));
  expect(legacySettings.permissions.deny).toEqual(["custom(*)", "command(*)", "custom(*)"]);
  expect(selection).toEqual({ route: "antigravity", model: "gemini-4-argon-high", effort: "high" });
});

// Break caught: optional acquired hook policy is dropped or rewritten by the
// pure builder, or a new version gate is invented during extraction.
it("retains an optional hook policy without acquiring sources or gating versions", () => {
  const policy = {
    version: 1 as const, contract: "agy-orca-hook-v1" as const, route: "antigravity" as const,
    workspace: input.workspace, executionCwd: "/fixture/project/.council/native-packets", executable: input.executable, providerVersion: "fixture-version", basePath: "/usr/bin:/bin",
    uid: 501, gid: 20, node: "/fixture/node", installed: "/fixture/hook.sh", hookContent: "fixture only", templateHash: "a".repeat(64),
    descriptors: [], identities: [], startupDirectories: [], absences: [],
    environment: { PATH: "/usr/bin:/bin" as const, LANG: "C" as const, LC_ALL: "C" as const, DEVELOPER_DIR: "/Library/Developer/CommandLineTools" as const,
      PYTHONNOUSERSITE: "1" as const, PYTHONDONTWRITEBYTECODE: "1" as const, __CF_USER_TEXT_ENCODING: "0x1F5:0:0" },
  };
  const before = JSON.stringify(policy);
  const plan = buildAgyRecipePlan({ ...input, version: "fixture-version", legacySettings: undefined, agyHookShell: policy });
  expect(plan.version).toBe("fixture-version");
  expect(plan.agyHookShell).toEqual(policy);
  expect(JSON.stringify(policy)).toBe(before);
});

// Break caught: malformed controlling settings become a launchable profile or
// throw an incidental spread error that callers cannot classify.
it.each([
  [null, "settings"], [[], "settings"], ["invalid", "settings"],
  [new Date(0), "settings"],
  [{ permissions: null }, "permissions"], [{ permissions: [] }, "permissions"], [{ permissions: true }, "permissions"],
  [{ permissions: new Date(0) }, "permissions"],
  [{ permissions: { deny: null } }, "permissions.deny"], [{ permissions: { deny: "command(*)" } }, "permissions.deny"],
  [{ permissions: { deny: {} } }, "permissions.deny"], [{ permissions: { deny: [1] } }, "permissions.deny"],
  [{ permissions: { deny: Array(1) } }, "permissions.deny"],
])("rejects malformed settings %j with a named error", (legacySettings, field) => {
  const build = () => buildAgyRecipePlan({ ...input, legacySettings });
  expect(build).toThrow(AgyRecipeSettingsError);
  expect(build).toThrow(`AGY_RECIPE_SETTINGS_INVALID:${field}`);
});
