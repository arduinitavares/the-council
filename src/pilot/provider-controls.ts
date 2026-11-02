import { existsSync, readFileSync, realpathSync, readdirSync, lstatSync, statSync, type Stats } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, dirname, resolve, sep, extname, parse } from "node:path";
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
import { validateAgyNativeHookSource } from "./agy-native-hook-validation.js";
import type { AgyRecipeInputs } from "./agy-inventory-witness.js";
import { reconstructCurrentAgyInputs } from "./agy-startup-inventory.js";
import { selectAgySourceRules } from "./agy-loader-contract.js";
import { readInventoryJson, listInventoryDirectory, type InventoryBudget, type InventoryRead, type InventoryProblem, type BoundedFile, type ReadReceipt } from "./inventory-io.js";

export interface ProviderControlEvidence { bootstrap: Observation; controls: Observation; facts: ControlFact[]; audit?: AuditSnapshot | undefined; recipe?: ProviderRecipe | undefined }
export type ProviderControlSource = (selection: ModelSelection, version: string, workspace: string, billing: Observation, command?: Command) => Promise<ProviderControlEvidence>;

/** Recognize the public AGY help layout without treating arbitrary diagnostics
 * as help. This acquires CLI syntax only; effective controls remain separate. */
function agyHelpFlags(text: string): Set<string> | undefined {
  const lines = text.trimEnd().split(/\r?\n/);
  if (lines.shift() !== "Usage of agy:") return;
  const flags = new Set<string>();
  let subcommands = false, subcommandCount = 0, optionIndent = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line === "Available subcommands:" && flags.size && !subcommands) { subcommands = true; continue; }
    // Pin the declaration indentation once; deeper wrapped prose may mention
    // an option without declaring it. Only the inspected short aliases apply.
    const option = line.match(/^( +)(?:--([a-zA-Z][\w-]*)|-([cip]))(?:[ \t]+.*)?$/);
    if (!subcommands && option && (!optionIndent || option[1]!.length === optionIndent)) {
      optionIndent ||= option[1]!.length; flags.add(option[2] ?? option[3]!); continue;
    }
    if (subcommands && /^[ \t]+[a-z][\w-]*[ \t]{2,}\S/.test(line)) { subcommandCount++; continue; }
    const description = line.match(/^( +)\S/);
    if (!subcommands && flags.size && description && description[1]!.length > optionIndent) continue;
    return;
  }
  return flags.size && (!subcommands || subcommandCount > 0) ? flags : undefined;
}
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
  const hookDescriptors: unknown[] = [];
  const inventoryBudget: InventoryBudget = { paths: new Set<string>(), jsonBytes: 0 };
  const add = (name: string, state: Observation["state"], source: string, detail: string, enforcement: string, stage: "bootstrap" | "effective" = "bootstrap") => {
    facts.push(controlFactSchema.parse({ name, stage, observation: { state, source, detail }, enforcement, observedAt: Date.now(), digest: sha256(JSON.stringify({ source, detail })) }));
  };
  const name = { codex: "codex", antigravity: "agy", cursor: "cursor-agent" }[selection.route];
  const currentAgy = selection.route === "antigravity" ? reconstructCurrentAgyInputs({ selection, version, workspace }, inventoryBudget) : null;
  const agyContext = currentAgy?.state === "present" ? currentAgy.value.context : currentAgy?.context;
  const agyExecutable = currentAgy?.state === "present" ? currentAgy.value.executable : currentAgy?.executable;
  const inspectionHome = currentAgy ? agyContext?.home : homedir();
  if (selection.route !== "antigravity") {
    const supportedVersion = selection.route === "codex" ? /(?:^|\s)0\.164\.0(?:\s|$)/.test(version) : /2026\.10\.22-27dcf5f/.test(version);
    add("provider-version-contract", supportedVersion ? "verified" : "unsupported", "Installed exact provider version", supportedVersion ? version : "No current scoped control contract for this exposed version", "No inherited stale qualification");
  }
  let executable: string | undefined = agyExecutable?.path;
  if (selection.route !== "antigravity") for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = join(directory, name);
    if (existsSync(candidate)) { executable = realpathSync(candidate); break; }
  }
  let help = "";
  try {
    if (!executable) throw Error("missing executable");
    const result = await promisify(execFile)(executable, ["--help"], { cwd: workspace, timeout: 5000, maxBuffer: 256000, encoding: "utf8" });
    if (selection.route === "antigravity") {
      if (result.stdout.trim() && result.stderr.trim()) throw Error("help diagnostics");
      const output = result.stdout.trim() ? result.stdout : result.stderr;
      if (!agyHelpFlags(output)) throw Error("unrecognized help");
      help = output;
    } else {
      if (result.stderr.trim()) throw Error("help diagnostics");
      help = result.stdout;
    }
    add("installed-command-contract", "verified", `${name} --help / ${version}`, sha256(help), "Installed public CLI parameters, not effective configuration");
  } catch { add("installed-command-contract", "missing", `${name} --help`, "Bounded non-inference command evidence unavailable", "No initialization"); }
  const inventoryProblems = (problems: readonly InventoryProblem[]) => {
    for (const problem of problems) {
      unavailable.push(`${problem.code}:${problem.path}`);
      add("source-acquisition", "unknown", problem.path, canonicalJson(problem), "No inferred source absence or digest");
    }
  };
  const addAgySource = (source: AuditSource) => {
    if (!sources.some(existing => existing.path === source.path && existing.kind === source.kind)) sources.push(source);
  };
  const readAgyJson = (file: string): InventoryRead<{ value: unknown; file: BoundedFile }> => {
    const result = readInventoryJson(file, inventoryBudget);
    if (result.state === "present") addAgySource({ path: file, kind: "file", sha256: result.value.file.sha256 });
    else if (result.state === "absent") addAgySource({ path: file, kind: "absent", sha256: null });
    else inventoryProblems(result.problems);
    return result;
  };
  const track = (file: string, kind: "file" | "metadata" = "file") => {
    if (selection.route === "antigravity" && kind === "file" && extname(file).toLowerCase() === ".json") { readAgyJson(file); return; }
    if (selection.route !== "antigravity" && sources.some(source => source.path === file)) return;
    try {
      const source: AuditSource = { path: file, kind: existsSync(file) ? kind : "absent", sha256: null };
      if (selection.route === "antigravity" && sources.some(existing => existing.path === file && existing.kind === source.kind)) return;
      source.sha256 = currentSourceDigest(source); sources.push(source);
    }
    catch { unavailable.push(`SOURCE_METADATA_OR_DIGEST_UNAVAILABLE:${file}`); add("source-acquisition", "unknown", file, "Source metadata/digest unavailable", "No inferred source absence"); }
  };
  const read = (file: string): any => {
    if (selection.route === "antigravity") {
      ordering.push(file);
      const result = readAgyJson(file);
      if (result.state === "present") return result.value.value;
      if (result.state === "unknown") {
        unavailable.push(`CONFIGURATION_UNREADABLE:${file}`);
        add("configuration-readable", "unknown", file, "Configuration is unavailable or malformed", "No initialization");
      }
      return undefined;
    }
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
        hookDescriptors.push(value);
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
  const canonicalPolicy=inspectionHome === undefined ? undefined : join(inspectionHome,".agents/policies/model-policy.md");
  if(canonicalPolicy)track(canonicalPolicy);
  if(!canonicalPolicy || !existsSync(canonicalPolicy))unavailable.push("EXECUTION_HOST_CANONICAL_POLICY_UNAVAILABLE");
  if(agyExecutable)addAgySource({path:agyExecutable.path,kind:"file",sha256:agyExecutable.sha256});
  else if(executable)track(executable);
  let recipe: ProviderRecipe | undefined;
  const cwd = join(workspace, ".council/native-packets");
  const argv: string[] = [];
  const materializations: { path: string; content: string; sha256: string }[] = [];
  let codexPolicy: ProviderRecipe["codexPolicy"];
  let agyHookShell: ProviderRecipe["agyHookShell"];
  const agyRecipePlan: AgyRecipeInputs | undefined = currentAgy?.state === "present" ? currentAgy.value.recipeInputs : undefined;
  if (selection.route === "antigravity" && currentAgy && agyContext) {
    const home = agyContext.home;
    const exposed = agyHelpFlags(help);
    const required = ["model", "effort", "agent", "add-dir", "mode", "sandbox", "settings", "input-format", "output-format", "print-timeout"];
    const missing = required.filter(flag => !exposed?.has(flag));
    add("public-cli-capability-contract", missing.length ? "unsupported" : "verified", `installed AGY --help / ${version}`,
      missing.length ? `Required recipe flags not exposed: ${missing.map(flag => "--"+flag).join(", ")}` : `Required recipe flags exposed; help sha256=${sha256(help)}`,
      "Public launch syntax only; version, executable, sources and effective gates remain independently bound");
    const sourceSelection = agyExecutable ? selectAgySourceRules({ path: agyExecutable.path, sha256: agyExecutable.sha256 }) : null;
    if (sourceSelection?.state === "unknown") unavailable.push(`${sourceSelection.problem.code}:${sourceSelection.problem.path}`);
    else if (sourceSelection?.state === "pinned-subset") unavailable.push("AGY_SOURCE_GRAPH_UNQUALIFIED");
    add("provider-startup-source-contract", "unknown", "Acquired AGY executable source-subset identity",
      sourceSelection?.state === "pinned-subset" ? `${sourceSelection.ruleSet}: conditional source subset matched; complete graph, runner dispatch, activity and native authority remain unresolved`
        : sourceSelection?.state === "unknown" ? canonicalJson(sourceSelection.problem) : "Guarded executable identity unavailable",
      "Executable identity selects only reviewed source rules; no version-derived startup qualification");
    const global = join(home, ".gemini/antigravity-cli/settings.json");
    for (const source of currentAgy.sources) addAgySource(source);
    ordering.push(...currentAgy.ordering);
    if (currentAgy.state === "unknown") {
      inventoryProblems(currentAgy.problems.filter(problem => !problem.code.startsWith("AGY_RECIPE_SETTINGS_INVALID:")));
      for (const problem of currentAgy.problems.filter(problem => problem.code.startsWith("AGY_RECIPE_SETTINGS_INVALID:"))) {
        unavailable.push(problem.code);
        add("agy-recipe-settings", "unknown", global, problem.code, "No recipe from malformed controlling settings");
      }
    }
    const settingsUnavailable = !currentAgy.sources.some(source => source.path === global);
    if (settingsUnavailable) {
      unavailable.push(`CONFIGURATION_UNREADABLE:${global}`);
      add("configuration-readable", "unknown", global, "Configuration is unavailable or malformed", "No initialization");
    }
    const hookFiles = [join(home, ".gemini/antigravity-cli/hooks.json"), join(home, ".gemini/config/hooks.json"), join(home, ".gemini/hooks.json"), join(workspace, ".gemini/hooks.json"), join(workspace, ".agents/hooks.json")];
    let inventoryKnown = !settingsUnavailable;
    const inventoryFailuresBefore = unavailable.length;
    const directoryMetadata = (root: string, receipt?: ReadReceipt): AuditSource | InventoryProblem => {
      const custody = ["dev", "ino", "uid", "gid", "mode"] as const;
      const selected = [...custody, "size", "mtimeMs", "ctimeMs"] as const;
      const fault = (code: string, path: string): never => { throw Object.assign(Error(code), { code, path }); };
      try {
        const resolved = resolve(root), traversalRoot = parse(resolved).root;
        const parts = resolved.slice(traversalRoot.length).split(sep).filter(Boolean);
        const observed: { path: string; stat: Stats; leaf: boolean }[] = [];
        let current: string = traversalRoot;
        for (let index = 0; index <= parts.length; index++) {
          if (index) current = join(current, parts[index - 1]!);
          const stat = lstatSync(current), leaf = index === parts.length;
          if (!leaf && stat.isSymbolicLink()) fault("INVENTORY_SYMLINK", current);
          if (!leaf && !stat.isDirectory()) fault("ENOTDIR", current);
          // Only an exact leaf-link refusal may retain link metadata. No link
          // target is opened, and unsafe parents stop before their descendants.
          if (leaf && (receipt ? !stat.isDirectory() || stat.isSymbolicLink() : !stat.isSymbolicLink())) fault("INVENTORY_UNSTABLE", current);
          if (receipt) {
            const expected = receipt.components.find(component => component.path === current)?.identity;
            if (!expected || (leaf ? selected : custody).some(key => stat[key] !== expected[key])) fault("INVENTORY_UNSTABLE", current);
          }
          observed.push({ path: current, stat, leaf });
        }
        for (const entry of observed) {
          const after = lstatSync(entry.path);
          if ((!entry.leaf && (!after.isDirectory() || after.isSymbolicLink())) ||
              after.isSymbolicLink() !== entry.stat.isSymbolicLink() ||
              (entry.leaf ? selected : custody).some(key => after[key] !== entry.stat[key])) fault("INVENTORY_UNSTABLE", entry.path);
        }
        const leaf = observed[observed.length - 1]!.stat;
        // Bind the original metadata meaning to the enumerated generation,
        // rather than fingerprinting a newer directory after its fd closes.
        const stat = receipt?.after ?? leaf;
        return { path: root, kind: "metadata", sha256: sha256(canonicalJson({ mode: stat.mode, dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, symbolicLink: leaf.isSymbolicLink() })) };
      } catch (cause) {
        const error = cause as { code?: unknown; path?: unknown } | null;
        return { code: typeof error?.code === "string" ? error.code : "INVENTORY_IO_UNKNOWN", path: typeof error?.path === "string" ? error.path : root, edge: null };
      }
    };
    const listAgyDirectory = (root: string) => {
      const result = listInventoryDirectory(root, inventoryBudget);
      if (result.state === "unknown") {
        inventoryProblems(result.problems);
        if (result.problems.some(problem => problem.code === "INVENTORY_SYMLINK" && problem.path === root)) {
          const metadata = directoryMetadata(root);
          if ("code" in metadata) inventoryProblems([metadata]);
          else addAgySource(metadata);
        }
      }
      else if (result.state === "absent") addAgySource({ path: root, kind: "absent", sha256: null });
      else {
        const metadata = directoryMetadata(root, result.receipt);
        if ("code" in metadata) {
          inventoryProblems([metadata]);
          return { state: "unknown" as const, problems: [metadata] };
        }
        addAgySource(metadata);
      }
      return result;
    };
    const candidateLeaves = ["plugin.json", ".antigravity-plugin/plugin.json", ".gemini-plugin/plugin.json", ".claude-plugin/plugin.json", "gemini-extension.json"];
    for (const root of [join(home, ".gemini/antigravity-cli/plugins"), join(home, ".gemini/config/plugins"), join(workspace, ".agents/plugins")]) {
      try {
        const listing = listAgyDirectory(root);
        if (listing.state === "absent") continue;
        if (listing.state === "unknown") { inventoryKnown = false; continue; }
        for (const entry of listing.value.entries) {
          if (entry.type === "symlink") { listAgyDirectory(join(root, entry.name)); inventoryKnown = false; continue; }
          if (entry.type !== "directory") continue;
          const plugin = join(root, entry.name);
          try {
            if (listAgyDirectory(plugin).state !== "present") { inventoryKnown = false; continue; }
            let hasMetadata = false;
            for (const leaf of candidateLeaves) {
              const file = join(plugin, leaf);
              const result = readAgyJson(file);
              if (result.state === "present") hasMetadata = true;
              else if (result.state === "unknown") inventoryKnown = false;
            }
            const hook = join(plugin, "hooks.json");
            hookFiles.push(hook);
            // Fingerprints select no manifest and establish no enablement rule.
            // Hookless candidates and unresolved metadata cannot qualify startup.
            if (hasMetadata || !existsSync(hook)) inventoryKnown = false;
          } catch { inventoryKnown = false; }
        }
      } catch { inventoryKnown = false; }
    }
    // Retain guarded bytes and their custody receipt with each complete source.
    // These observations establish acquisition order, not effective loader order.
    const hooks = hookFiles.map(path => {
      ordering.push(path);
      const acquisition = readAgyJson(path);
      if (acquisition.state !== "present") return { path, acquisition };
      const validation = validateAgyNativeHookSource({ path, file: acquisition.value.file });
      if (validation.state === "valid") unavailable.push(`AGY_PLUGIN_RUNTIME_INPUT_UNAVAILABLE:${path}`);
      else for (const problem of validation.problems) unavailable.push(`${problem.code}:${problem.path}:${problem.pointer}`);
      return { path, acquisition, validation };
    });
    if (unavailable.length > inventoryFailuresBefore) inventoryKnown = false;
    if (!inventoryKnown) unavailable.push("AGY_PLUGIN_INVENTORY_UNAVAILABLE");
    // No H1 source has qualified loader membership, activation or command bases.
    // Conforming occurrences remain inert; the generic scanner is for other routes.
    for(const instruction of [join(home,".gemini/GEMINI.md"),join(home,".gemini/antigravity-cli/GEMINI.md"),join(workspace,"GEMINI.md"),join(workspace,"AGENTS.md")])track(instruction);
    const acquiredHooks = hooks.filter(source => source.acquisition.state === "present");
    add("startup-hooks-and-plugins", "unknown", "AGY documented global/workspace/installed-plugin hook sources", `${acquiredHooks.length} acquired sources; native conformance does not establish loader membership or runtime activity`, "SessionStart precedes inference; settings hooks={} is insufficient");
    if (agyRecipePlan) {
      materializations.push(...agyRecipePlan.materializations);
      argv.push(...agyRecipePlan.argv);
    }
    const collisionSources = [join(home, ".gemini/config/agents/council-packet.md"), join(home, ".gemini/config/agents/council-packet/agent.md")];
    for(const file of collisionSources)track(file);const collision=collisionSources.some(existsSync);
    const agentHash = agyRecipePlan?.agentDefinition?.sha256;
    add("custom-agent-definition", collision ? "missing" : agentHash ? "verified" : "unknown", "Generated source-bound AGY main-agent definition", collision ? "A preexisting global agent has the task-owned name" : agentHash ?? "AGY recipe settings unavailable", "Definition metadata only; verify actual selected agent and empty init.tools before input");
    add("effective-input-gate", "unknown", "AGY stream-json init", "Require init before user input, exact model/agent/cwd/permission and empty tools", "Wrapper withholds stdin until effective checks pass", "effective");
  } else if (selection.route === "antigravity") {
    if (currentAgy?.state === "unknown") inventoryProblems(currentAgy.problems);
    add("provider-startup-source-contract", "unknown", "Current AGY context", "Current home/context unavailable", "No inferred startup source qualification");
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
    track(override);for(const file of instructions)track(file);
    for(const config of configurations){
      for(const key of ["model_instructions_file","compact_prompt_file"])if(typeof config[key]==="string")track(resolve(codexHome,config[key]));
    }
    // Ordinary hook/notifier execution occurs at thread/session construction.
    // This owned kernel suppresses it, conditional on raw+managed admission
    // BEFORE thread/start. Fingerprint inputs, never claim executable closure
    // for disabled handlers or read private hook implementation dependencies.
    for(const file of [join(codexHome,"hooks.json"),"/etc/codex/hooks.json",...projectLayers.map(file=>join(dirname(file),"hooks.json"))])track(file);
    inventory(join(codexHome,"rules"),[]);inventory("/etc/codex/rules",[]);
    // In rust-v0.164.0 plugins_for_config returns an empty outcome BEFORE
    // cache discovery when plugins=false. With hooks=false and no plugin
    // sources the hook engine has no handlers. Inactive cache bytes are
    // neither startup dependencies nor builtin cleanup audit candidates.
    add("ordinary-hooks-and-notify-suppression", "verified", "Codex rust-v0.164.0 plugin manager, hook registry and engine", "Owned notify=[], hooks=false and plugins=false suppress this kernel's notifier and hook sources; platform/runtime effects remain audited", "Mandatory raw layer and managed-requirement checks before thread/start; flags alone do not verify startup/platform effects");
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
  if (executable && help && (selection.route !== "antigravity" || agyRecipePlan)) recipe = { protocol: selection.route === "antigravity" ? "agy-stream" : selection.route === "codex" ? "codex-app-server" : "cursor-stream",
    executable, argv, cwd, version, selection: selectionSchema.parse(selection), expectedPermission: "request-review", sources, facts,
    ...(selection.route === "antigravity" ? { agent: "council-packet" } : {}), materializations };
  if (recipe && codexPolicy) recipe.codexPolicy = codexPolicy;
  if (recipe && agyHookShell) recipe.agyHookShell = agyHookShell;
  if(recipe?.agent){const definition=materializations.find(item=>item.path.endsWith("/council-packet/agent.md"));if(definition)recipe.agentDefinition={path:definition.path,sha256:definition.sha256};}
  const audit: AuditSnapshot = { version:1,workspace:realpathSync(workspace),route:selection.route,providerVersion:version,
    contract: selection.route === "codex" ? "rust-v0.164.0" : selection.route === "antigravity" ? "agy-startup-source-v1" : "cursor-2026.10.22-27dcf5f",
    executable:executable??"unavailable",sources,ordering,effects:[...new Set(effects)],unavailable:[...new Set(unavailable)],
    recipeHash:sha256(canonicalJson({argv,materializations,codexPolicy:codexPolicy??null,...(agyHookShell ? { agyHookShell } : {})})) };
  const disposition=await acquiredAuditDisposition(audit,command);
  const auditedNames=new Set(["startup-and-platform-exceptions","startup-hooks-and-plugins","helper-and-startup-effect-enforcement"]);
  for(const fact of facts)if(auditedNames.has(fact.name)&&fact.observation.state!=="verified"){
    fact.observation={state:disposition.verified?"verified":"unknown",source:"Source snapshot and authenticated coordinator disposition",detail:selection.route === "antigravity" && audit.unavailable.length ? audit.unavailable.join("; ") : disposition.detail};
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
