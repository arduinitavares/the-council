import { existsSync, readFileSync, realpathSync, readdirSync, lstatSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, dirname, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse as parseToml } from "smol-toml";
import { selectionSchema, type ModelSelection } from "./config.js";
import type { Observation } from "./types.js";
import { controlFactSchema, factsObservation, readStrictFile, sha256, type ControlFact, type ProviderRecipe } from "./wrapper-contract.js";
import { codexKernel } from "./codex-controls.js";

export interface ProviderControlEvidence { bootstrap: Observation; controls: Observation; facts: ControlFact[]; recipe?: ProviderRecipe | undefined }
export type ProviderControlSource = (selection: ModelSelection, version: string, workspace: string, billing: Observation) => Promise<ProviderControlEvidence>;
/** Read-only mirror of the inspected exact Cursor version's normalization and
 * eligible-ancestor trust checks. It never creates or copies a trust marker. */
export function existingCursorTrust(cwd: string): string | null {
  const projects = join(process.env.CURSOR_DATA_DIR?.trim() || join(homedir(), ".cursor"), "projects");
  const normalize = (value: string) => value.replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  const marker = (value: string) => join(projects, normalize(value), ".workspace-trusted");
  const direct = marker(cwd);
  if (existsSync(direct) && !lstatSync(direct).isSymbolicLink()) return direct;
  let current = resolve(cwd), parent = dirname(current);
  while (parent !== current) {
    const broad = parent === homedir() || homedir().startsWith(parent+sep) || parent.split(sep).filter(Boolean).length < 3;
    const candidate = marker(parent);
    if (!broad && existsSync(candidate) && !lstatSync(candidate).isSymbolicLink()) return candidate;
    current = parent; parent = dirname(current);
  }
  return null;
}
/** Read-only acquisition. Unsupported pre-input enforcement stays a named fact,
 * never a universal manifest or a caller-authored qualification receipt. */
export const inspectProviderControls: ProviderControlSource = async (selection, version, workspace, billing) => {
  const facts: ControlFact[] = [];
  const sources: { path: string; sha256: string }[] = [];
  const add = (name: string, state: Observation["state"], source: string, detail: string, enforcement: string, stage: "bootstrap" | "effective" = "bootstrap") => {
    facts.push(controlFactSchema.parse({ name, stage, observation: { state, source, detail }, enforcement, observedAt: Date.now(), digest: sha256(JSON.stringify({ source, detail })) }));
  };
  const name = { codex: "codex", antigravity: "agy", cursor: "cursor-agent" }[selection.route];
  const supportedVersion = selection.route === "codex" ? /(?:^|\s)0\.164\.0(?:\s|$)/.test(version) : selection.route === "antigravity" ? /(?:^|\s)1\.4\.11(?:\s|$)/.test(version) : /2026\.10\.22-27dcf5f/.test(version);
  add("provider-version-contract", supportedVersion ? "verified" : "unsupported", "Installed exact provider version", supportedVersion ? version : "No current scoped control contract for this exposed version", "No inherited stale qualification");
  let executable: string | undefined;
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = join(directory, name);
    if (existsSync(candidate)) { executable = realpathSync(candidate); break; }
  }
  let help = "";
  try {
    if (!executable) throw Error("missing executable");
    const result = await promisify(execFile)(executable, ["--help"], { cwd: workspace, timeout: 5000, maxBuffer: 256000, encoding: "utf8" });
    const agyHelpOnStderr = selection.route === "antigravity" && /1\.4\.11/.test(version) && !result.stdout.trim() && /^Usage of agy:/m.test(result.stderr);
    if (result.stderr.trim() && !agyHelpOnStderr) throw Error("help diagnostics");
    help = agyHelpOnStderr ? result.stderr : result.stdout;
    add("installed-command-contract", "verified", `${name} --help / ${version}`, sha256(help), "Installed public CLI parameters, not effective configuration");
  } catch { add("installed-command-contract", "missing", `${name} --help`, "Bounded non-inference command evidence unavailable", "No initialization"); }
  const read = (file: string): any => {
    if (!existsSync(file)) return undefined;
    try { sources.push({ path: realpathSync(file), sha256: sha256(readFileSync(file)) }); return readStrictFile(file, 1024*1024); }
    catch { add("configuration-readable", "missing", file, "Configuration is unavailable or malformed", "No initialization"); return undefined; }
  };
  let recipe: ProviderRecipe | undefined;
  const cwd = join(workspace, ".council/native-packets");
  const argv: string[] = [];
  const materializations: { path: string; content: string; sha256: string }[] = [];
  let codexPolicy: ProviderRecipe["codexPolicy"];
  if (selection.route === "antigravity") {
    const global = join(homedir(), ".gemini/antigravity-cli/settings.json");
    const config = read(global);
    const trusted = Array.isArray(config?.trustedWorkspaces) && config.trustedWorkspaces.some((entry: unknown) => typeof entry === "string" && entry === cwd);
    add("workspace-trust", trusted ? "verified" : "missing", "AGY existing trustedWorkspaces", trusted ? "Exact canonical workspace already trusted" : "Exact workspace trust not established; no trust change attempted", "Existing provider trust gate");
    const hookFiles = [join(homedir(), ".gemini/antigravity-cli/hooks.json"), join(homedir(), ".gemini/config/hooks.json"), join(homedir(), ".gemini/hooks.json"), join(workspace, ".gemini/hooks.json"), join(workspace, ".agents/hooks.json")];
    let inventoryKnown = true;
    for (const root of [join(homedir(), ".gemini/antigravity-cli/plugins"), join(workspace, ".agents/plugins")]) if (existsSync(root)) {
      if (lstatSync(root).isSymbolicLink()) { inventoryKnown = false; continue; }
      const entries = readdirSync(root, { withFileTypes: true });
      if (entries.length > 100) { inventoryKnown = false; continue; }
      for (const entry of entries) { if (entry.isSymbolicLink()) inventoryKnown = false; else if (entry.isDirectory()) hookFiles.push(join(root, entry.name, "hooks.json")); }
    }
    const hooks = hookFiles.filter(existsSync).map(file => read(file));
    const enabledHook = (value: any): boolean => value && typeof value === "object" && (Array.isArray(value) ? value.some(enabledHook) : value.enabled === false ? false : typeof value.command === "string" || typeof value.prompt === "string" || typeof value.type === "string" || Object.values(value).some(enabledHook));
    add("startup-hooks-and-plugins", inventoryKnown && hooks.every(value => value !== undefined && !enabledHook(value)) ? "verified" : "unknown", "AGY documented global/workspace/installed-plugin hook sources", `${hooks.length} sources inventoried; enabled or unreadable hooks require source/effect audit within existing authority, not automatic renewed approval`, "SessionStart precedes inference; settings hooks={} is insufficient");
    const agent = "---\nname: council-packet\ndescription: Supplied-packet Council reader with no tools or helpers.\ntools: []\nmainAgent: true\nsubagent: false\nmcpServers: []\nskills: []\nplugins: []\ncommandExecutionPolicy: off\n---\nRead the supplied packet only and return its strict bound JSON envelope.\n";
    const session = JSON.stringify({ allowNonWorkspaceAccess: false, permissions: { ...(config?.permissions ?? {}), deny: [...new Set([...(config?.permissions?.deny ?? []), "write_file(*)", "command(*)", "read_url(*)", "execute_url(*)", "mcp(*)"])] } });
    materializations.push({ path: join(cwd, ".agents/agents/council-packet/agent.md"), content: agent, sha256: sha256(agent) }, { path: join(cwd, "session-settings.json"), content: session, sha256: sha256(session) });
    const collision = [join(homedir(), ".gemini/config/agents/council-packet.md"), join(homedir(), ".gemini/config/agents/council-packet/agent.md")].some(existsSync);
    add("custom-agent-tool-ceiling", collision ? "missing" : "verified", "AGY public custom main-agent definition", collision ? "A preexisting global agent has the task-owned name" : sha256(agent), "Empty tools/MCP/skills/plugins; verify actual selected agent and init.tools before input");
    add("effective-input-gate", "unknown", "AGY stream-json init", "Require init before user input, exact model/agent/cwd/permission and empty tools", "Wrapper withholds stdin until effective checks pass", "effective");
    if (!/(?:^|\s)--?settings\b/m.test(help) || !/(?:^|\s)--?agent\b/m.test(help)) add("session-controls", "unsupported", "installed AGY --help", "Required session-only settings/custom-agent parameters not exposed", "No initialization");
    argv.push("--model", selection.model, "--effort", selection.effort, "--agent", "council-packet", "--mode", "plan", "--sandbox", "--settings", join(cwd, "session-settings.json"), "--input-format", "stream-json", "--output-format", "stream-json", "--print-timeout", "120s");
  } else if (selection.route === "codex") {
    const configurations: any[] = [];
    for (const file of [join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "config.toml"), join(workspace, ".codex/config.toml")]) if (existsSync(file)) {
      sources.push({ path: realpathSync(file), sha256: sha256(readFileSync(file)) });
      try { configurations.push(parseToml(readFileSync(file, "utf8"))); } catch { add("configuration-readable", "missing", file, "Effective source TOML cannot be parsed", "No initialization"); }
    }
    const kernel = codexKernel(configurations, cwd, selection.model, selection.effort);
    argv.push(...kernel.argv); codexPolicy = kernel.policy;
    add("named-permissions-kernel", kernel.issues.length ? "unknown" : "verified", "Codex rust-v0.164.0 named permission/config contracts", kernel.issues.join(",") || "Implicit-deny filesystem with packet read, no writes, inherited Deny union and restricted network", "Process-scoped default_permissions; no legacy sandbox override");
    add("startup-and-platform-exceptions", "unknown", "Codex exact-version bootstrap/global-instruction and platform helper sources", "Frozen source kernel is available; active host startup inputs, managed layers and runtime platform/helper exceptions still require their explicit audit and host/action qualification", "No initialization until startup effects are established within existing authority");
    add("pre-input-effective-config", "unknown", "Codex 0.164.0 app-server config/read", "Owned initialization must read effective merged config/layers before turn/start; startup config is requirements only", "No turn/start before effective admission", "effective");
    add("all-tool-effects-and-packet-read-boundary", "unknown", "Codex named permissions, sandbox-aware image/patch handlers and view_image feature gate", "Compare frozen merged kernel, requirements/catalogue and active profile identity before the first turn; registration need not be empty when effects are restricted", "No turn/start until selection, Deny preservation and scoped effect qualification pass", "effective");
  } else {
    const configRoot = process.env.CURSOR_CONFIG_DIR?.trim() || (process.env.XDG_CONFIG_HOME?.trim() ? join(process.env.XDG_CONFIG_HOME, "cursor") : join(homedir(), ".cursor"));
    const global = read(join(configRoot, "cli-config.json"));
    const project = read(join(workspace, ".cursor/cli.json"));
    const trusted = existingCursorTrust(cwd);
    if (trusted) sources.push({ path: trusted, sha256: sha256(readFileSync(trusted)) });
    add("workspace-trust", trusted ? "verified" : "missing", "Cursor exact-version project-path normalizer and eligible-ancestor marker semantics", trusted ? "An existing eligible native trust marker covers the exact packet cwd" : "No eligible existing marker covers the exact packet cwd; no marker is created", "Existing provider trust gate");
    const deny = [...(Array.isArray(global?.permissions?.deny) ? global.permissions.deny : []), ...(Array.isArray(project?.permissions?.deny) ? project.permissions.deny : [])];
    const effectsDenied = ["Shell(*)", "Write(**)", "WebFetch(*)", "Mcp(*:*)"].every(value => deny.includes(value));
    add("packet-read-boundary-and-deny-rules", effectsDenied && global?.sandbox?.readBoundary === "workspace" ? "verified" : "missing", "Cursor effective supported global/project configuration inputs", "Requires workspace read boundary plus shell/write/web/MCP Deny; mode ask alone is insufficient", "Public sandbox and Deny precedence");
    const hookInputs = [join(configRoot, "hooks.json"), join(workspace, ".cursor/hooks.json")].filter(existsSync).map(read);
    add("helper-and-startup-effect-enforcement", "unknown", "Cursor public hooks and merged plugin/config sources", `${hookInputs.length} hook sources observed; existing helper guard, startup hooks and complete source merge require effect audit within existing authority`, "No prompt before audited enforceable helper/startup controls");
    add("included-only-billing", billing.state, billing.source, billing.detail, "Existing enforced account cap/debit source, independent of quota");
    add("effective-input-gate", "unknown", "Cursor public one-way print contract and pre-input configuration sources", "The one-way CLI requires complete audited enforcement before prompt submission; current helper/startup/plugin merge evidence is incomplete", "No post-prompt init promoted to preventive control", "effective");
    argv.push("--print", "--mode", "ask", "--sandbox", "enabled", "--workspace", cwd, "--model", selection.model, "--output-format", "stream-json");
  }
  // Sources and their digests are acquired even when enforcement is unavailable.
  // A future supported recipe must satisfy the same fact conjunction; no flag
  // or input file can mark the current missing controls verified.
  if (executable && help) recipe = { protocol: selection.route === "antigravity" ? "agy-stream" : selection.route === "codex" ? "codex-app-server" : "cursor-stream",
    executable, argv, cwd, version, selection: selectionSchema.parse(selection), expectedPermission: "request-review", sources, facts,
    ...(selection.route === "antigravity" ? { agent: "council-packet" } : {}), materializations };
  if (recipe && codexPolicy) recipe.codexPolicy = codexPolicy;
  return { bootstrap: factsObservation(facts, "bootstrap"), controls: factsObservation(facts, "effective"), facts, recipe };
};
