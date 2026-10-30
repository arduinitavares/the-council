import { existsSync, readFileSync, realpathSync, readdirSync, lstatSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, dirname, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse as parseToml } from "smol-toml";
import { selectionSchema, type ModelSelection } from "./config.js";
import type { Observation } from "./types.js";
import { controlFactSchema, factsObservation, readStrictFile, sha256, type ControlFact, type ProviderRecipe } from "./wrapper-contract.js";
import { acquiredAuditDisposition, adoptAuditSnapshot, currentSourceDigest, saveAuditSnapshot, auditHash, type AuditSnapshot, type AuditSource } from "./control-audit.js";
import { canonicalJson } from "../domain/hash.js";
import type { Command } from "./orca-driver.js";
import { codexKernel } from "./codex-controls.js";

export interface ProviderControlEvidence { bootstrap: Observation; controls: Observation; facts: ControlFact[]; audit?: AuditSnapshot | undefined; recipe?: ProviderRecipe | undefined }
export type ProviderControlSource = (selection: ModelSelection, version: string, workspace: string, billing: Observation, command?: Command) => Promise<ProviderControlEvidence>;
/** Read-only mirror of the inspected exact Cursor version's normalization and
 * eligible-ancestor trust checks. It never creates or copies a trust marker. */
export const nonblankRoot = (value: string | undefined) => value?.trim() ? value : undefined;
export function existingCursorTrust(cwd: string): string | null {
  const projects = join(nonblankRoot(process.env.CURSOR_DATA_DIR) ?? join(homedir(), ".cursor"), "projects");
  const normalize = (value: string) => value.replace(/[^a-zA-Z0-9]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  const marker = (value: string) => join(projects, normalize(value), ".workspace-trusted");
  const present = (file: string) => { try { statSync(file); return true; } catch(cause) { if(["ENOENT","ENOTDIR"].includes((cause as NodeJS.ErrnoException).code??"")) return false; throw cause; } };
  const direct = marker(cwd);
  if (present(direct)) return direct;
  let current = resolve(cwd), parent = dirname(current);
  while (parent !== current) {
    const broad = parent === homedir() || homedir().startsWith(parent+sep) || parent.split(sep).filter(Boolean).length < 3;
    const candidate = marker(parent);
    if (!broad && present(candidate)) return candidate;
    current = parent; parent = dirname(current);
  }
  return null;
}
/** Read-only acquisition. Unsupported pre-input enforcement stays a named fact,
 * never a universal manifest or a caller-authored qualification receipt. */
export const inspectProviderControls: ProviderControlSource = async (selection, version, workspace, billing, command) => {
  const facts: ControlFact[] = [];
  const sources: AuditSource[] = [];
  const unavailable: string[] = [];
  const effects: string[] = [];
  const ordering: string[] = [];
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
  const track = (file: string, kind: "file" | "metadata" = "file") => {
    if (sources.some(source => source.path === file)) return;
    try { const source: AuditSource = { path: file, kind: existsSync(file) ? kind : "absent", sha256: null }; source.sha256 = currentSourceDigest(source); sources.push(source); }
    catch { unavailable.push(`SOURCE_METADATA_OR_DIGEST_UNAVAILABLE:${file}`); add("source-acquisition", "unknown", file, "Source metadata/digest unavailable", "No inferred source absence"); }
  };
  const read = (file: string): any => {
    track(file); ordering.push(file);
    if (!existsSync(file)) return undefined;
    try { return readStrictFile(file, 1024*1024); }
    catch { unavailable.push(`CONFIGURATION_UNREADABLE:${file}`); add("configuration-readable", "unknown", file, "Configuration is unavailable or malformed", "No initialization"); return undefined; }
  };
  const inventory = (root: string, leaves: readonly string[]) => {
    track(root,"metadata");
    if (!existsSync(root)) return;
    try {
      if (lstatSync(root).isSymbolicLink()) throw Error("symlink");
      const entries = readdirSync(root,{withFileTypes:true});
      if (entries.length > 100) throw Error("bounded inventory exceeded");
      for (const entry of entries) {
        if (entry.isSymbolicLink()) throw Error("symlink");
        if (entry.isDirectory()) for (const leaf of leaves) { const file=join(root,entry.name,leaf);track(file);if(existsSync(file)&&/hooks.*\.json$/.test(leaf)){try{hookEffects(readStrictFile(file));}catch{unavailable.push(`PLUGIN_HOOK_SOURCE_UNREADABLE:${file}`);}} }
        else if (entry.isFile() && /\.(rules|toml|json|md)$/.test(entry.name)) track(join(root,entry.name));
      }
    } catch { unavailable.push(`SOURCE_INVENTORY_UNAVAILABLE:${root}`); }
  };
  const gitRoot = (directory: string) => { let current=resolve(directory); for (;;) { if(existsSync(join(current,".git")))return current;const parent=dirname(current);if(parent===current)return directory;current=parent; } };
  const hookEffects = (value: any) => {
    if (!value || typeof value !== "object" || value.enabled === false) return;
    if (typeof value.command === "string" || typeof value.prompt === "string") {
      effects.push(`startup-hook:${sha256(canonicalJson(value))}`);
      if (typeof value.command === "string") {
        const literals=value.command.match(/(?:~?\/[^\s"';|&()<>]+)|(?:["'][~\/][^"']+["'])/g) ?? [];
        let pinned=0;
        for(const literal of literals){
          const file=literal.replace(/^["']|["']$/g,"").replace(/^~(?=\/)/,homedir());
          if(/\$|`/.test(file)){unavailable.push(`HOOK_DYNAMIC_EXECUTABLE_UNRESOLVED:${sha256(value.command)}`);continue;}
          // Runtime credentials/endpoints are neither reconstructed nor read.
          if(/(?:auth|credential|token|endpoint|secret)/i.test(file)){unavailable.push(`HOOK_RUNTIME_DEPENDENCY_NOT_PINNED:${sha256(file)}`);continue;}
          if(existsSync(file)){
            try{
              const stat=lstatSync(file);if(!stat.isFile()&&!stat.isSymbolicLink())continue;
              const target=realpathSync(file);track(target);pinned++;
              if(stat.size<262144&&/\.(sh|py|mjs|js)$/.test(target)){
                const text=readFileSync(target,"utf8");
                if(/(?:^|[;\n])\s*(?:source|\.)\s|(?:ENDPOINT|TOKEN|SECRET|CREDENTIAL)|(?:readFile|source)\s*\(?[^\n]*\$/m.test(text))unavailable.push(`HOOK_DYNAMIC_CLOSURE_UNAVAILABLE:${target}:${sha256(text)}`);
              }
            }catch{unavailable.push(`HOOK_EXECUTABLE_SOURCE_UNAVAILABLE:${sha256(file)}`);}
          }
        }
        if(!pinned)unavailable.push(`HOOK_EXECUTABLE_UNRESOLVED:${sha256(value.command)}`);
      }
    }
    for (const nested of Object.values(value)) if (typeof nested === "object") hookEffects(nested);
  };
  const canonicalPolicy=join(homedir(),".agents/policies/model-policy.md");
  track(canonicalPolicy);
  if(!existsSync(canonicalPolicy))unavailable.push("EXECUTION_HOST_CANONICAL_POLICY_UNAVAILABLE");
  if(executable)track(executable);
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
    if(!inventoryKnown)unavailable.push("AGY_PLUGIN_INVENTORY_UNAVAILABLE");
    const hooks = hookFiles.map(file => read(file)).filter(value=>value!==undefined);
    for(const hooksSource of hooks)hookEffects(hooksSource);
    for(const instruction of [join(homedir(),".gemini/GEMINI.md"),join(homedir(),".gemini/antigravity-cli/GEMINI.md"),join(workspace,"GEMINI.md"),join(workspace,"AGENTS.md")])track(instruction);
    const enabledHook = (value: any): boolean => value && typeof value === "object" && (Array.isArray(value) ? value.some(enabledHook) : value.enabled === false ? false : typeof value.command === "string" || typeof value.prompt === "string" || typeof value.type === "string" || Object.values(value).some(enabledHook));
    add("startup-hooks-and-plugins", inventoryKnown && hooks.every(value => value !== undefined && !enabledHook(value)) ? "verified" : "unknown", "AGY documented global/workspace/installed-plugin hook sources", `${hooks.length} sources inventoried; enabled or unreadable hooks require source/effect audit within existing authority, not automatic renewed approval`, "SessionStart precedes inference; settings hooks={} is insufficient");
    const agent = "---\nname: council-packet\ndescription: Supplied-packet Council reader with no tools or helpers.\ntools: []\nmainAgent: true\nsubagent: false\nmcpServers: []\nskills: []\nplugins: []\ncommandExecutionPolicy: off\n---\nRead the supplied packet only and return its strict bound JSON envelope.\n";
    const session = JSON.stringify({ allowNonWorkspaceAccess: false, permissions: { ...(config?.permissions ?? {}), deny: [...new Set([...(config?.permissions?.deny ?? []), "write_file(*)", "command(*)", "read_url(*)", "execute_url(*)", "mcp(*)"])] } });
    materializations.push({ path: join(cwd, ".agents/agents/council-packet/agent.md"), content: agent, sha256: sha256(agent) }, { path: join(cwd, ".council-profiles", sha256(session), "session-settings.json"), content: session, sha256: sha256(session) });
    const collisionSources = [join(homedir(), ".gemini/config/agents/council-packet.md"), join(homedir(), ".gemini/config/agents/council-packet/agent.md")];
    for(const file of collisionSources)track(file);const collision=collisionSources.some(existsSync);
    add("custom-agent-tool-ceiling", collision ? "missing" : "verified", "AGY public custom main-agent definition", collision ? "A preexisting global agent has the task-owned name" : sha256(agent), "Empty tools/MCP/skills/plugins; verify actual selected agent and init.tools before input");
    add("effective-input-gate", "unknown", "AGY stream-json init", "Require init before user input, exact model/agent/cwd/permission and empty tools", "Wrapper withholds stdin until effective checks pass", "effective");
    if (!/(?:^|\s)--?settings\b/m.test(help) || !/(?:^|\s)--?agent\b/m.test(help)) add("session-controls", "unsupported", "installed AGY --help", "Required session-only settings/custom-agent parameters not exposed", "No initialization");
    argv.push("--model", selection.model, "--effort", selection.effort, "--agent", "council-packet", "--mode", "plan", "--sandbox", "--settings", join(cwd, ".council-profiles", sha256(session), "session-settings.json"), "--input-format", "stream-json", "--output-format", "stream-json", "--print-timeout", "120s");
  } else if (selection.route === "codex") {
    const configurations: any[] = [];
    const codexHome = nonblankRoot(process.env.CODEX_HOME) ?? join(homedir(),".codex");
    const root=gitRoot(cwd); const projectLayers:string[]=[];let current=resolve(cwd);
    for(;;){projectLayers.unshift(join(current,".codex/config.toml"));if(current===root||dirname(current)===current)break;current=dirname(current);}
    for (const file of ["/etc/codex/config.toml", "/etc/codex/managed_config.toml",join(codexHome,"config.toml"),...projectLayers]) {
      track(file);ordering.push(file);if(!existsSync(file))continue;
      try { configurations.push(parseToml(readFileSync(file, "utf8"))); } catch { add("configuration-readable", "missing", file, "Effective source TOML cannot be parsed", "No initialization"); }
    }
    for(const file of ["/etc/codex/requirements.toml",join(codexHome,"requirements.toml")])track(file);
    const override=join(codexHome,"AGENTS.override.md");const instructions=[existsSync(override)?override:join(codexHome,"AGENTS.md")];
    for(const file of instructions)track(file);
    for(const config of configurations){
      for(const key of ["model_instructions_file","compact_prompt_file"])if(typeof config[key]==="string")track(resolve(codexHome,config[key]));
      if(config.notify?.length)effects.push(`legacy-notify:${sha256(canonicalJson(config.notify))}`);
      hookEffects(config.hooks);
    }
    inventory(join(codexHome,"rules"),[]);inventory("/etc/codex/rules",[]);
    for(const root of [join(codexHome,"plugins"),join(workspace,".codex/plugins")])inventory(root,["hooks/hooks.json","hooks.json",".codex-plugin/plugin.json"]);
    // This is a concrete exception in the pinned platform contract, never an
    // unknown capability turned into a verified tool boundary by approval.
    effects.push("codex-platform-runtime-reads-and-state");
    const kernel = codexKernel(configurations, cwd, selection.model, selection.effort);
    argv.push(...kernel.argv); codexPolicy = kernel.policy;
    add("named-permissions-kernel", kernel.issues.length ? "unknown" : "verified", "Codex rust-v0.164.0 named permission/config contracts", kernel.issues.join(",") || "Implicit-deny filesystem with packet read, no writes, inherited Deny union and restricted network", "Process-scoped default_permissions; no legacy sandbox override");
    add("startup-and-platform-exceptions", "unknown", "Codex exact-version bootstrap/global-instruction and platform helper sources", "Frozen source kernel is available; active host startup inputs, managed layers and runtime platform/helper exceptions still require their explicit audit and host/action qualification", "No initialization until startup effects are established within existing authority");
    add("pre-input-effective-config", "unknown", "Codex 0.164.0 app-server config/read", "Owned initialization must read effective merged config/layers before turn/start; startup config is requirements only", "No turn/start before effective admission", "effective");
    add("all-tool-effects-and-packet-read-boundary", "unknown", "Codex named permissions, sandbox-aware image/patch handlers and view_image feature gate", "Compare frozen merged kernel, requirements/catalogue and active profile identity before the first turn; registration need not be empty when effects are restricted", "No turn/start until selection, Deny preservation and scoped effect qualification pass", "effective");
  } else {
    const configRoot = nonblankRoot(process.env.CURSOR_CONFIG_DIR) ?? (nonblankRoot(process.env.XDG_CONFIG_HOME) ? join(process.env.XDG_CONFIG_HOME!, "cursor") : join(homedir(), ".cursor"));
    const global = read(join(configRoot,"cli-config.json"));
    const root=gitRoot(cwd);const layers:string[]=[];let current=resolve(cwd);
    for(;;){layers.unshift(join(current,".cursor/cli.json"));if(current===root||dirname(current)===current)break;current=dirname(current);}
    const merge=(left:any,right:any):any=>{const result={...(left??{})};for(const [key,value]of Object.entries(right??{}))result[key]=value&&typeof value==="object"&&!Array.isArray(value)?merge(result[key],value):value;return result;};
    let merged=global??{};const inheritedDeny:string[]=[...(global?.permissions?.deny??[])];
    for(const layer of layers){const value=read(layer);if(value){inheritedDeny.push(...(value.permissions?.deny??[]));merged=merge(merged,value);}}
    for(const file of [join(configRoot,"permissions.json"),join(root,".claude/settings.json"),join(homedir(),".claude/settings.json")]){const value=read(file);inheritedDeny.push(...(value?.permissions?.deny??value?.deny??[]));}
    let trusted:string|null=null;
    try{trusted=existingCursorTrust(cwd);if(trusted)track(trusted,"metadata");}
    catch{unavailable.push("CURSOR_TRUST_METADATA_UNAVAILABLE");add("workspace-trust-metadata","unknown","Cursor existing marker metadata","Native trust metadata could not be acquired","No trust mutation");}
    add("workspace-trust",trusted?"verified":"missing","Cursor native direct/eligible-ancestor existence semantics",trusted?"Existing marker covers exact packet cwd; contents are not read":"No acquired eligible marker covers packet cwd","Existing trust; no marker creation");
    const configured=merged?.sandbox?.readBoundary;
    add("configured-read-boundary",["workspace","system"].includes(configured)?"verified":"missing","Cursor ordered CLI configuration sources",canonicalJson({readBoundary:configured??null,effectiveDeny:merged?.permissions?.deny??[]}),"Configuration input only; not effective containment");
    for(const file of [join(homedir(),".cursor/sandbox.json"),join(root,".cursor/sandbox.json"),join(cwd,".cursor/sandbox.json")])read(file);
    add("packet-read-boundary-and-deny-rules","unknown","Cursor sandbox portal/team/approval/read-allow inputs","Configured readBoundary and Deny cannot attest remote portal, team policy, effective sandbox or read-allow expansion","Require qualified pre-established effective boundary");
    unavailable.push("CURSOR_REMOTE_PORTAL_TEAM_AND_EFFECTIVE_SANDBOX_UNEXPOSED");
    const hookFiles=["/Library/Application Support/Cursor/hooks.json",join(homedir(),".cursor/hooks.json"),join(root,".cursor/hooks.json"),join(homedir(),".claude/settings.json"),join(root,".claude/settings.json"),join(root,".claude/settings.local.json")];
    for(const file of hookFiles)hookEffects(read(file));
    for(const pluginRoot of [join(homedir(),".cursor/plugins"),join(root,".cursor/plugins")])inventory(pluginRoot,["hooks.json","hooks/hooks.json",".cursor-plugin/plugin.json"]);
    const installed=join(homedir(),".local/share/cursor-agent/versions/2026.10.22-27dcf5f");
    for(const file of ["index.js","1841.index.js","3863.index.js","5866.index.js","752.index.js"])track(join(installed,file));
    ordering.push("enterprise","team","project","user","runtime","compatible-Claude","plugins");
    unavailable.push("CURSOR_REMOTE_TEAM_AND_ENABLED_PLUGIN_HOOKS_UNEXPOSED");
    add("helper-loader-root",root===cwd?"verified":"missing","Cursor detected Git root or cwd fallback",canonicalJson({detectedGitRoot:root,packetCwd:cwd}),"Task-owned helper guard is valid only when loader selects packet root; no Git/trust/workspace mutation");
    const deny=[...new Set([...inheritedDeny,"Shell(*)","Write(**)","WebFetch(*)","Mcp(*:*)"])];
    const profile=JSON.stringify({permissions:{...(merged.permissions??{}),allow:[],deny}});
    materializations.push({path:join(cwd,".cursor/cli.json"),content:profile,sha256:sha256(profile)});
    if(root===cwd){
      const guard=`#!/bin/sh\nprintf '%s\\n' '{"permission":"deny","user_message":"Subagents are disabled for this packet."}'\n`;
      const hooks=JSON.stringify({version:1,hooks:{subagentStart:[{command:"/bin/sh .cursor/hooks/deny-subagents.sh",timeout:5,failClosed:true}]}});
      if(existsSync(join(cwd,".cursor/hooks.json")))add("helper-guard-ownership","missing","Existing task packet hooks","Existing hooks preserved; candidate does not overwrite them","No ancestor/global hook edits");
      else materializations.push({path:join(cwd,".cursor/hooks.json"),content:hooks,sha256:sha256(hooks)},{path:join(cwd,".cursor/hooks/deny-subagents.sh"),content:guard,sha256:sha256(guard)});
    }
    add("helper-and-startup-effect-enforcement","unknown","Cursor actual enterprise/team/project/user/compatible/plugin source order","A source audit can disposition observed effects; unavailable remote sources remain a distinct named gate","No prompt before complete pre-established controls");
    add("included-only-billing",billing.state,billing.source,billing.detail,"Existing enforced account cap/debit source, independent of quota");
    add("effective-input-gate","unknown","Cursor one-way print and pre-established controls","Requires qualified complete controls before prompt; no public hold handshake is not a universal impossibility","No post-input prevention claim","effective");
    argv.push("--print", "--mode", "ask", "--sandbox", "enabled", "--workspace", cwd, "--model", selection.model, "--output-format", "stream-json");
  }
  // Sources and their digests are acquired even when enforcement is unavailable.
  // A future supported recipe must satisfy the same fact conjunction; no flag
  // or input file can mark the current missing controls verified.
  if (executable && help) recipe = { protocol: selection.route === "antigravity" ? "agy-stream" : selection.route === "codex" ? "codex-app-server" : "cursor-stream",
    executable, argv, cwd, version, selection: selectionSchema.parse(selection), expectedPermission: "request-review", sources, facts,
    ...(selection.route === "antigravity" ? { agent: "council-packet" } : {}), materializations };
  if (recipe && codexPolicy) recipe.codexPolicy = codexPolicy;
  if(recipe?.agent){const definition=materializations.find(item=>item.path.endsWith("/council-packet/agent.md"));if(definition)recipe.agentDefinition={path:definition.path,sha256:definition.sha256};}
  const audit: AuditSnapshot = { version:1,workspace:realpathSync(workspace),route:selection.route,providerVersion:version,
    contract: selection.route === "codex" ? "rust-v0.164.0" : selection.route === "antigravity" ? "agy-1.4.11" : "cursor-2026.10.22-27dcf5f",
    executable:executable??"unavailable",sources,ordering,effects:[...new Set(effects)],unavailable:[...new Set(unavailable)],
    recipeHash:sha256(canonicalJson({argv,materializations,codexPolicy:codexPolicy??null})) };
  const disposition=await acquiredAuditDisposition(audit,command);
  const auditedNames=new Set(["startup-and-platform-exceptions","startup-hooks-and-plugins","helper-and-startup-effect-enforcement"]);
  for(const fact of facts)if(auditedNames.has(fact.name)&&fact.observation.state!=="verified"){
    fact.observation={state:disposition.verified?"verified":"unknown",source:"Source snapshot and authenticated coordinator disposition",detail:disposition.detail};
    fact.digest=auditHash(audit);
  }
  if(recipe&&selection.route==="codex")recipe.instructionSources=sources.filter(source=>source.kind!=="absent"&&/(?:AGENTS(?:\.override)?\.md|GEMINI\.md)$/.test(source.path)).map(source=>({path:source.path,sha256:source.sha256!}));
  return { bootstrap: factsObservation(facts, "bootstrap"), controls: factsObservation(facts, "effective"), facts, recipe, audit };
};

/** Public preparation persists package-owned source bytes; it grants no effects. */
export async function prepareProviderAudit(selection: ModelSelection, version: string, workspace: string) {
  const evidence=await inspectProviderControls(selection,version,workspace,{state:"unknown",source:"audit preparation",detail:"No account or provider qualification performed"});
  return saveAuditSnapshot(evidence.audit!);
}
export const adoptProviderAudit=adoptAuditSnapshot;
