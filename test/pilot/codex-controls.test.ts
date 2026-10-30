import { expect, it } from "vitest";
import { codexKernel, verifyCodexConfig } from "../../src/pilot/codex-controls.js";

// rust-v0.164.0 ConfigReadResponse: raw-only fields belong to layers, not Config.
const features = "hooks apps plugins multi_agent multi_agent_v2 shell_tool view_image request_permissions_tool image_generation code_mode code_mode_only code_mode_host browser_use computer_use memories external_agent_memory_import standalone_web_search shell_snapshot shell_snapshot_v2 recommended_plugins remote_plugin skill_search".split(" ");
const cwd = "/test/packet";
const model = "gpt-6.1-sol";
const policy = codexKernel([{ permissions: { old: { filesystem: { "/secret": "deny" } } } }], cwd, model, "max").policy;
function response() {
  const config = { model, model_reasoning_effort: "max", approval_policy: "never", web_search: "disabled", apps: { _default: { enabled: false } } };
  const raw = { ...config, default_permissions: "council_packet", notify: [], features: Object.fromEntries(features.map(f => [f, false])), agents: { enabled: false }, permissions: { council_packet: { filesystem: { [cwd]: "read", "/secret": "deny" }, network: { enabled: false } } }, mcp_servers: {}, plugins: {} };
  return { config, origins: {}, layers: [{ name: { type: "sessionFlags" }, version: "test-version", config: raw }] };
}
it("admits the actual typed config/read envelope with ordered raw evidence and inherited Deny", () => {
  expect(verifyCodexConfig(response(), policy, model, "max")).toBe(true);
});

it("merges high-to-low layers and ignores explicitly disabled layers", () => {
  const value: any = response();
  value.layers.push({name:{type:"user",file:"/test/config.toml"},version:"lower",config:{features:{hooks:true},notify:["must-not-run"]}});
  expect(verifyCodexConfig(value,policy,model,"max")).toBe(true);
  value.layers.unshift({name:{type:"legacyManagedConfigTomlFromFile",file:"/etc/codex/managed_config.toml"},version:"higher",disabledReason:"Untrusted project",config:{features:{hooks:true},notify:["must-not-run"]}});
  expect(verifyCodexConfig(value,policy,model,"max")).toBe(true);
  delete value.layers[0].disabledReason;
  expect(verifyCodexConfig(value,policy,model,"max")).toBe(false);
});

for (const feature of features) it(`rejects a higher-priority ${feature} re-enable`, () => {
  const value: any = response();
  value.layers.unshift({name:{type:"legacyManagedConfigTomlFromMdm"},version:"higher",config:{features:{[feature]:true}}});
  expect(verifyCodexConfig(value,policy,model,"max")).toBe(false);
});

it.each([
  ["typed model", (v: any) => {v.config.model="other";}],
  ["typed effort", (v: any) => {v.config.model_reasoning_effort="low";}],
  ["typed approval", (v: any) => {v.config.approval_policy="on-request";}],
  ["typed web search", (v: any) => {v.config.web_search="live";}],
  ["typed apps", (v: any) => {v.config.apps._default.enabled=true;}],
  ["missing layers", (v: any) => {delete v.layers;}],
  ["null layers", (v: any) => {v.layers=null;}],
  ["empty layers", (v: any) => {v.layers=[];}],
  ["malformed layer", (v: any) => {v.layers[0].config=[];}],
  ["missing version", (v: any) => {delete v.layers[0].version;}],
  ["missing source", (v: any) => {delete v.layers[0].name;}],
  ["unknown source", (v: any) => {v.layers[0].name={type:"future"};}],
  ["ambiguous duplicate layer", (v: any) => {v.layers.push(v.layers[0]);}],
  ["disabled session layer", (v: any) => {v.layers[0].disabledReason="Disabled";}],
  ["malformed disabled reason", (v: any) => {v.layers[0].disabledReason=false;}],
  ["missing origins", (v: any) => {delete v.origins;}],
  ["foreign origin", (v: any) => {v.origins.model={name:{type:"user",file:"/foreign/config.toml"},version:"foreign"};}],
  ["missing filesystem", (v: any) => {delete v.layers[0].config.permissions.council_packet.filesystem;}],
  ["missing Deny", (v: any) => {delete v.layers[0].config.permissions.council_packet.filesystem["/secret"];}],
  ["unpreserved lower-layer Deny", (v: any) => {v.layers.push({name:{type:"user",file:"/test/config.toml"},version:"lower",config:{permissions:{old:{filesystem:{"/another-secret":"none"}}}}});}],
  ["foreign profile collision", (v: any) => {v.layers.push({name:{type:"user",file:"/test/config.toml"},version:"lower",config:{permissions:{council_packet:{}}}});}],
  ["malformed permission map", (v: any) => {v.layers[0].config.permissions=[];}],
  ["malformed inherited Deny", (v: any) => {v.layers[0].config.permissions.old={filesystem:{"/secret":{access:"deny"}}};}],
  ["network enabled", (v: any) => {v.layers[0].config.permissions.council_packet.network.enabled=true;}],
  ["profile inheritance", (v: any) => {v.layers[0].config.permissions.council_packet.extends="danger-full-access";}],
  ["MCP enabled", (v: any) => {v.layers[0].config.mcp_servers={example:{enabled:true}};}],
  ["plugin enabled", (v: any) => {v.layers[0].config.plugins={example:{enabled:true}};}],
  ["notify overridden", (v: any) => {v.layers[0].config.notify=["must-not-run"];}],
  ["helpers enabled", (v: any) => {v.layers[0].config.agents.enabled=true;}],
] as const)("rejects %s", (_label, change) => {
  const value = response(); change(value);
  expect(verifyCodexConfig(value,policy,model,"max")).toBe(false);
});

import { verifyCodexRequirements } from "../../src/pilot/codex-controls.js";
it("accepts the actual map-shaped managed permission allowlist and compatible feature requirements", () => {
  expect(verifyCodexRequirements({allowedApprovalPolicies:["never"],allowedPermissionProfiles:{council_packet:true},defaultPermissions:"council_packet",allowedWebSearchModes:["disabled"],featureRequirements:{hooks:false},network:{enabled:false}},policy.name,model,"max")).toBe(true);
});
it.each([
  undefined, [], {allowedApprovalPolicies:[]}, {allowedApprovalPolicies:"never"},
  {allowedPermissionProfiles:["council_packet"]}, {allowedPermissionProfiles:{council_packet:false}},
  {allowedPermissionProfiles:{}}, {defaultPermissions:"foreign"}, {allowedWebSearchModes:["live"]},
  {featureRequirements:{hooks:true}}, {featureRequirements:{shell_tool:true}}, {featureRequirements:{hooks:"false"}},
  {network:{enabled:true}}, {hooks:{managedDir:"/unacquired"}}, {hooks:{SessionStart:[{hooks:[{command:"unacquired"}]}]}},
  {models:{newThread:{model:"foreign"}}}, {models:{newThread:{modelReasoningEffort:"low"}}},
])("rejects incompatible or malformed managed requirements %j", requirement => {
  expect(verifyCodexRequirements(requirement,policy.name,model,"max")).toBe(false);
});

it("configures app-server model and approval through root -c overrides, independent of interactive selectors", () => {
  const kernel=codexKernel([],cwd,"gpt-6-astra","max");
  const overrides=kernel.argv.filter((_arg,index)=>kernel.argv[index-1]==="-c");
  expect(overrides).toContain('model="gpt-6-astra"');
  expect(overrides).toContain('approval_policy="never"');
});
