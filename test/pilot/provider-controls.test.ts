import { expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync, realpathSync, symlinkSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { inspectProviderControls } from "../../src/pilot/provider-controls.js";
import { auditHash } from "../../src/pilot/control-audit.js";
import { incidentRoster } from "./fixtures.js";

const agyFlags = ["model", "effort", "agent", "add-dir", "mode", "sandbox", "settings", "input-format", "output-format", "print-timeout"];
const agyHelp = (flags = agyFlags) => "Usage of agy:\n"+flags.map(flag => `  --${flag}${flag === "sandbox" ? "" : " string"}\n      public option\n`).join("");

it("keeps ordinary non-Orca hooks in the generic pending effect audit", async () => {
  await withAgyControls(agyHelp(), "1.4.12", result => {
    expect(result.audit?.unavailable).toEqual([]);
    expect(result.audit?.effects.some(effect => effect.startsWith("startup-hook:"))).toBe(true);
    expect(result.recipe).not.toHaveProperty("agyHookShell");
    expect(result.controls.state).toBe("unknown");
  }, 0, (_workspace, settingsFile) => {
    writeFileSync(join(settingsFile, "../hooks.json"), JSON.stringify({hooks: {SessionStart: [{type: "command", command: "/bin/echo sanitized-lifecycle", timeout: 10}]}}));
  });
});

it("retains the generic dynamic guard for an unrelated custom shell script", async () => {
  let hook = "";
  const bytes = "#!/bin/sh\n# inert dynamic dependency ORCA_ENDPOINT\nexit 0\n";
  await withAgyControls(agyHelp(), "1.4.12", result => {
    expect(result.audit?.unavailable).toContain(`HOOK_DYNAMIC_CLOSURE_UNAVAILABLE:${hook}:${createHash("sha256").update(bytes).digest("hex")}`);
    expect(result.audit?.unavailable.some(reason => reason.startsWith("AGY_HOOK_"))).toBe(false);
    expect(result.recipe).not.toHaveProperty("agyHookShell");
  }, 0, (workspace, settingsFile) => {
    hook = join(workspace, "custom.sh"); writeFileSync(hook, bytes, {mode: 0o700});
    writeFileSync(join(settingsFile, "../hooks.json"), JSON.stringify({hooks: {SessionStart: [{type: "command", command: `/bin/sh '${hook}'`, timeout: 10}]}}));
  });
});

// Break caught: name/path recognition alone suppresses the generic guard for
// unsupported hook bytes or a fake provider. These identities must never acquire
// the new known-hook policy, regardless of valid public help or command quoting.
it.each(["raw", "quoted"])("retains dynamic closure for unsupported %s custom hook descriptors", async spelling => {
  let hook = "";
  const bytes = "#!/bin/sh\n# inert fixture: ORCA_ENDPOINT\nexit 0\n";
  await withAgyControls(agyHelp(), "1.4.12", result => {
    expect(result.audit?.unavailable).toContain(`HOOK_DYNAMIC_CLOSURE_UNAVAILABLE:${hook}:${createHash("sha256").update(bytes).digest("hex")}`);
    expect(result.recipe).not.toHaveProperty("agyHookShell");
    expect(result.bootstrap.state).not.toBe("verified");
  }, 0, (workspace, settingsFile) => {
    hook = join(workspace, "antigravity-hook.sh");
    writeFileSync(hook, bytes, { mode: 0o755 });
    const command = (spelling === "raw" ? hook : "'" + hook + "'") + " custom-extra-argument";
    writeFileSync(join(settingsFile, "../hooks.json"), JSON.stringify({ hooks: { SessionStart: [
      { type: "command", command, timeout: 10 },
    ] } }));
  });
});

async function withAgyControls(help: string, version: string, check: (result: Awaited<ReturnType<typeof inspectProviderControls>>, workspace: string) => void, exitCode = 0, prepare?: (workspace: string, settingsFile: string) => void) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "agy-contract-")));
  try {
    vi.stubEnv("HOME", root); vi.stubEnv("PATH", root+delimiter+process.env.PATH);
    const workspace = join(root, "project"); mkdirSync(workspace);
    mkdirSync(join(root, ".agents/policies"), { recursive: true });
    writeFileSync(join(root, ".agents/policies/model-policy.md"), "fixture policy");
    mkdirSync(join(root, ".gemini/antigravity-cli"), { recursive: true });
    const settingsFile = join(root, ".gemini/antigravity-cli/settings.json");
    writeFileSync(settingsFile, "{}");
    prepare?.(workspace, settingsFile);
    const executable = join(root, "agy");
    writeFileSync(executable, `#!${process.execPath}\nprocess.stderr.write(${JSON.stringify(help)});process.exitCode=${exitCode};`); chmodSync(executable, 0o700);
    check(await inspectProviderControls(incidentRoster.reviewers.gemini, version, workspace, { state: "unknown", source: "fixture", detail: "not qualification" }), workspace);
  } finally { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); }
}

it("acquires successful recognizable AGY 1.4.12 stderr help without a version-only refusal", async () => {
  await withAgyControls(agyHelp(), "1.4.12", result => {
    expect(result.facts.find(fact => fact.name === "installed-command-contract")?.observation.state).toBe("verified");
    expect(result.bootstrap.state).toBe("verified");
    expect(result.recipe?.version).toBe("1.4.12");
    expect(result.controls.state).toBe("unknown");
    expect(result.audit?.providerVersion).toBe("1.4.12");
  });
});

// Break caught: rejecting the actual successful 1.4.12 double-dash help and
// subcommand section, despite every recipe option being publicly exposed.
it("acquires captured AGY 1.4.12 help including -c, -i, -p aliases and subcommands", async () => {
  const help = readFileSync(new URL("./fixtures/agy-1.4.12-help.txt", import.meta.url), "utf8");
  await withAgyControls(help, "1.4.12", result => {
    expect(result.bootstrap.state).toBe("verified");
    expect(result.recipe?.argv).toContain("--add-dir");
    expect(result.controls.state).toBe("unknown");
  });
});

// Break caught: a legacy single-dash long declaration supplies a required
// current capability even when the other declarations and short aliases match.
it.each(agyFlags)("rejects legacy single-dash -%s as a required AGY 1.4.12 capability", async flag => {
  const help = readFileSync(new URL("./fixtures/agy-1.4.12-help.txt", import.meta.url), "utf8")
    .replace(new RegExp(`^  --${flag}(?=[ \\t]|$)`, "m"), `  -${flag}`);
  await withAgyControls(help, "1.4.12", result => {
    expect(result.facts.find(fact => fact.name === "public-cli-capability-contract")?.observation.state).toBe("unsupported");
    expect(result.bootstrap.state).not.toBe("verified");
  });
});

const absentAgyEnrollment = [
  { label: "absent trustedWorkspaces", enrollment: {} },
  { label: "empty trustedWorkspaces", enrollment: { trustedWorkspaces: [] } },
  { label: "foreign trustedWorkspaces", enrollment: { trustedWorkspaces: ["/different-project/.council/native-packets"] } },
];

// Break caught: exact global enrollment blocks the inspected 1.4.12 direct
// transport even though every other bootstrap source is valid.
it.each(absentAgyEnrollment)("acquires AGY 1.4.12 direct startup with $label while preserving settings and pending effective controls", async ({ enrollment }) => {
  const settingsBytes = JSON.stringify({ ...enrollment, permissions: { deny: ["existing-deny(*)"] } });
  const settingsDigest = createHash("sha256").update(settingsBytes).digest("hex");
  let settingsFile = "";
  let originalMetadata!: { mtimeNs: bigint; ctimeNs: bigint; ino: bigint };
  const help = readFileSync(new URL("./fixtures/agy-1.4.12-help.txt", import.meta.url), "utf8");
  await withAgyControls(help, "1.4.12", result => {
    expect(readFileSync(settingsFile, "utf8")).toBe(settingsBytes);
    expect(statSync(settingsFile, { bigint: true })).toMatchObject(originalMetadata);
    expect(result.recipe?.protocol).toBe("agy-stream");
    expect(result.recipe?.sources.find(source => source.path === settingsFile)).toEqual({ path: settingsFile, kind: "file", sha256: settingsDigest });
    expect(result.audit?.sources.find(source => source.path === settingsFile)?.sha256).toBe(settingsDigest);
    expect(result.audit?.unavailable).toEqual([]);
    const generated = result.recipe?.materializations?.find(item => item.path.endsWith("session-settings.json"));
    expect(generated).toBeDefined();
    expect(JSON.parse(generated!.content).permissions.deny).toEqual(expect.arrayContaining(["existing-deny(*)", "write_file(*)", "command(*)", "read_url(*)", "execute_url(*)", "mcp(*)"]));
    expect(result.recipe?.materializations?.every(item => !existsSync(item.path))).toBe(true);
    expect(result.controls.state).toBe("unknown");
    expect(result.facts.filter(fact => fact.stage === "bootstrap" && fact.observation.state !== "verified")).toEqual([]);
    expect(result.facts.find(fact => fact.name === "workspace-trust")).toBeUndefined();
    expect(result.bootstrap.state).toBe("verified");
  }, 0, (_workspace, file) => {
    settingsFile = file;
    writeFileSync(file, settingsBytes);
    const { mtimeNs, ctimeNs, ino } = statSync(file, { bigint: true });
    originalMetadata = { mtimeNs, ctimeNs, ino };
  });
});

// Break caught: enrollment metadata revives the removed 1.4.11 startup route.
it.each([...absentAgyEnrollment, { label: "exact trustedWorkspaces", enrollment: null }])("rejects unsupported AGY 1.4.11 with $label", async ({ enrollment }) => {
  const help = readFileSync(new URL("./fixtures/agy-1.4.12-help.txt", import.meta.url), "utf8");
  await withAgyControls(help, "1.4.11", result => {
    expect(result.facts.find(fact => fact.name === "provider-startup-source-contract")?.observation.state).toBe("unsupported");
    expect(result.facts.find(fact => fact.name === "workspace-trust")).toBeUndefined();
    expect(result.bootstrap.state).toBe("unsupported");
    expect(result.controls.state).toBe("unknown");
  }, 0, (workspace, settingsFile) => writeFileSync(settingsFile, JSON.stringify(enrollment ?? { trustedWorkspaces: [join(workspace, ".council/native-packets")] })));
});

// Break caught: treating unnecessary enrollment as permission to ignore
// unavailable settings acquisition and its independent audit evidence.
it.each(["malformed", "non-regular"])("keeps AGY 1.4.12 blocked on %s settings", async shape => {
  await withAgyControls(agyHelp(), "1.4.12", (result, workspace) => {
    const settingsFile = join(workspace, "../.gemini/antigravity-cli/settings.json");
    expect(result.facts.find(fact => fact.name === "configuration-readable")?.observation.state).toBe("unknown");
    expect(result.audit?.unavailable).toContain("CONFIGURATION_UNREADABLE:"+settingsFile);
    expect(result.bootstrap.state).not.toBe("verified");
    expect(result.controls.state).toBe("unknown");
  }, 0, (_workspace, settingsFile) => {
    if (shape === "malformed") writeFileSync(settingsFile, "{invalid-json");
    else { rmSync(settingsFile); mkdirSync(settingsFile); }
  });
});

// Break caught: dropping the enrollment prerequisite also admits enabled hooks
// whose effects have no authenticated coordinator disposition.
it("keeps AGY 1.4.12 enabled hooks pending a source audit despite absent enrollment", async () => {
  await withAgyControls(agyHelp(), "1.4.12", result => {
    const hooks = result.facts.find(fact => fact.name === "startup-hooks-and-plugins");
    expect(hooks?.observation.state).toBe("unknown");
    expect(hooks?.observation.detail).toMatch(/^AUDIT_DISPOSITION_PENDING:/);
    expect(result.audit?.effects).toHaveLength(1);
    expect(result.audit?.unavailable).toEqual([]);
    expect(result.bootstrap.state).not.toBe("verified");
    expect(result.controls.state).toBe("unknown");
  }, 0, (_workspace, settingsFile) => {
    writeFileSync(settingsFile, JSON.stringify({ permissions: { deny: ["existing-deny(*)"] } }));
    writeFileSync(join(settingsFile, "../hooks.json"), JSON.stringify({ hooks: { SessionStart: [{ prompt: "fixture lifecycle effect requiring audit" }] } }));
  });
});

it("blocks an unreviewed future AGY startup-source contract despite complete recognizable public help", async () => {
  await withAgyControls(agyHelp(), "9.9.9", result => {
    expect(result.facts.find(fact => fact.name === "installed-command-contract")?.observation.state).toBe("verified");
    expect(result.recipe?.version).toBe("9.9.9");
    expect(result.facts.find(fact => fact.name === "workspace-trust")).toBeUndefined();
    expect(result.bootstrap.state).toBe("unsupported");
  });
});

it.each(agyFlags)("rejects an AGY launch contract missing the actual --%s recipe flag", async missing => {
  await withAgyControls(agyHelp(agyFlags.filter(flag => flag !== missing)), "1.4.12", result => {
    expect(result.facts.find(fact => fact.name === "public-cli-capability-contract")?.observation.state).toBe("unsupported");
    expect(result.bootstrap.state).toBe("unsupported");
  });
});

// Break caught: continuation prose impersonates a removed required declaration
// and incorrectly verifies the public recipe capability through the real API.
it.each(agyFlags.flatMap(flag => [
  { flag, layout: "captured double-dash", captured: true },
  { flag, layout: "generated double-dash", captured: false },
]))("does not acquire --$flag from continuation prose in $layout help", async ({ flag, captured }) => {
  const help = captured ? readFileSync(new URL("./fixtures/agy-1.4.12-help.txt", import.meta.url), "utf8") : agyHelp();
  const withoutDeclaration = captured ? help.replace(new RegExp(`^  --${flag}(?:[ \\t].*)?$`, "m"), "") : agyHelp(agyFlags.filter(value => value !== flag));
  const continuation = `      --${flag} ${flag === "sandbox" ? "is unavailable" : "is mentioned only in this description"}`;
  const misleading = captured ? withoutDeclaration.replace("Available subcommands:", continuation+"\n\nAvailable subcommands:") : withoutDeclaration+continuation+"\n";
  await withAgyControls(misleading, "1.4.12", result => {
    expect(result.facts.find(fact => fact.name === "public-cli-capability-contract")?.observation.state).toBe("unsupported");
    expect(result.bootstrap.state).not.toBe("verified");
  });
});

// Break caught: unsupported declaration indentation is treated as valid help.
it.each([
  ["tab-indented", agyHelp().replace(/^  --/gm, "\t\t--")],
  ["inconsistently shallower", agyHelp().replace("  --model string", " --model string")],
])("does not verify AGY capabilities from %s declarations", async (_description, help) => {
  await withAgyControls(help!, "1.4.12", result => {
    expect(result.facts.find(fact => fact.name === "public-cli-capability-contract")?.observation.state).toBe("unsupported");
    expect(result.bootstrap.state).not.toBe("verified");
  });
});

// Break caught: a fixed width rejects consistently indented current declarations.
it.each([1, 2, 4])("acquires current AGY declarations consistently indented by %i spaces", async indent => {
  const help = agyHelp().replace(/^  --/gm, " ".repeat(indent)+"--");
  await withAgyControls(help, "1.4.12", result => {
    expect(result.facts.find(fact => fact.name === "public-cli-capability-contract")?.observation.state).toBe("verified");
    expect(result.bootstrap.state).toBe("verified");
  });
});

// Break caught: a subcommand section header alone is accepted as a complete section.
it.each(["", "  \n\n"])("rejects an empty AGY subcommand section with trailing %j", async trailing => {
  await withAgyControls(agyHelp()+"\nAvailable subcommands:\n"+trailing, "1.4.12", result => {
    expect(result.facts.find(fact => fact.name === "installed-command-contract")?.observation.state).toBe("missing");
    expect(result.recipe).toBeUndefined();
  });
});

// Break caught: requiring a subcommand section would reject valid options-only help.
it("acquires captured AGY help without an optional subcommand section", async () => {
  const help = readFileSync(new URL("./fixtures/agy-1.4.12-help.txt", import.meta.url), "utf8").split("Available subcommands:")[0]!;
  await withAgyControls(help, "1.4.12", result => {
    expect(result.bootstrap.state).toBe("verified");
  });
});

// Break caught: rejecting all option-shaped continuation prose breaks legitimate wrapping.
it("preserves wrapped AGY descriptions when required declarations are present", async () => {
  const help = agyHelp().replace("  --sandbox\n", "      --sandbox is also mentioned in this wrapped description\n  --sandbox\n");
  await withAgyControls(help, "1.4.12", result => {
    expect(result.bootstrap.state).toBe("verified");
  });
});

it.each([
  ["arbitrary diagnostics", "authentication unavailable\n", 0],
  ["diagnostics appended to recognizable help", agyHelp()+"authentication unavailable\n", 0],
  ["diagnostics before recognizable help", "authentication unavailable\n"+agyHelp(), 0],
  ["a usage heading without flag definitions", "Usage of agy:\n", 0],
  ["nonzero help", agyHelp(), 2],
])("does not acquire AGY command evidence from %s", async (_description, help, exitCode) => {
  await withAgyControls(help as string, "1.4.12", result => {
    expect(result.facts.find(fact => fact.name === "installed-command-contract")?.observation.state).toBe("missing");
    expect(result.recipe).toBeUndefined();
  }, exitCode as number);
});

it("binds AGY discovery to the exact packet directory containing its source-bound agent", async () => {
  await withAgyControls(agyHelp(), "1.4.12", (result, workspace) => {
    const packet = join(workspace, ".council/native-packets");
    expect(result.recipe?.argv).toEqual(expect.arrayContaining(["--add-dir", packet]));
    expect(result.recipe?.argv.filter(arg => arg === "--add-dir")).toHaveLength(1);
    expect(result.recipe?.argv[result.recipe.argv.indexOf("--add-dir")+1]).toBe(packet);
    expect(result.recipe?.agentDefinition?.path).toBe(join(packet, ".agents/agents/council-packet/agent.md"));
  });
});

it("acquires an AGY 1.4.12 recipe while preserving settings and inherited Deny without enrollment", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "provider-controls-")));
  try {
    vi.stubEnv("HOME", root); vi.stubEnv("PATH", root+delimiter+process.env.PATH);
    const workspace = join(root,"project"); mkdirSync(workspace);
    mkdirSync(join(root,".gemini/antigravity-cli"),{recursive:true});
    const settings = { permissions:{deny:["existing-deny(*)"]} };
    writeFileSync(join(root,".gemini/antigravity-cli/settings.json"),JSON.stringify(settings));
    const executable=join(root,"agy");writeFileSync(executable,`#!${process.execPath}\nprocess.stderr.write(${JSON.stringify(agyHelp())});`);chmodSync(executable,0o700);
    const result=await inspectProviderControls(incidentRoster.reviewers.gemini,"1.4.12",workspace,{state:"unknown",source:"existing access",detail:"unchanged"});
    expect(result.bootstrap.state).toBe("verified");
    expect(result.recipe?.argv).toEqual(expect.arrayContaining(["--agent","council-packet","--settings"]));
    expect(result.recipe?.materializations?.find(item=>item.path.endsWith("session-settings.json"))?.content).toContain("existing-deny(*)");
    expect(result.controls.state).toBe("unknown");
    expect(result.facts.find(fact=>fact.name==="workspace-trust")).toBeUndefined();
    expect(JSON.parse(readFileSync(join(root,".gemini/antigravity-cli/settings.json"),"utf8"))).toEqual(settings);
  } finally {vi.unstubAllEnvs();rmSync(root,{recursive:true,force:true});}
});

it("produces the exact named Codex profile without legacy sandbox override and preserves inherited Deny", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codex-controls-")));
  try {
    vi.stubEnv("HOME",root);vi.stubEnv("CODEX_HOME",join(root,".codex"));vi.stubEnv("PATH",root+delimiter+process.env.PATH);
    const workspace=join(root,"project");mkdirSync(workspace);mkdirSync(join(root,".codex"));
    writeFileSync(join(root,".codex/config.toml"),'[permissions.old.filesystem]\n"/sensitive"="deny"\n');
    const executable=join(root,"codex");writeFileSync(executable,`#!${process.execPath}\nconsole.log('Usage: codex --model --disable --config');`);chmodSync(executable,0o700);
    const result=await inspectProviderControls(incidentRoster.reviewers.openai,"codex-cli 0.164.0",workspace,{state:"unknown",source:"existing access",detail:"unchanged"});
    expect(result.recipe?.argv).not.toContain("--sandbox");
    expect(result.recipe?.argv).toContain('default_permissions="council_packet"');
    expect(result.recipe?.argv).toContain('notify=[]');
    expect(result.recipe?.codexPolicy?.filesystem).toEqual({"/sensitive":"deny",[join(workspace,".council/native-packets")]:"read"});
    expect(result.recipe?.codexPolicy?.featureKeys).toHaveLength(22);
  } finally {vi.unstubAllEnvs();rmSync(root,{recursive:true,force:true});}
});

it.each(["oversized", "unsupported"])("ignores %s inactive Codex plugin caches while preserving startup fingerprints and platform audit", async cacheShape => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codex-suppressed-")));
  try {
    vi.stubEnv("HOME", root); vi.stubEnv("CODEX_HOME", join(root, ".codex")); vi.stubEnv("PATH", root+delimiter+process.env.PATH);
    const workspace=join(root,"project"); mkdirSync(workspace); mkdirSync(join(root,".codex"));
    mkdirSync(join(root,".agents/policies"),{recursive:true}); writeFileSync(join(root,".agents/policies/model-policy.md"),"fixture policy");
    writeFileSync(join(root,".codex/config.toml"),'notify=["missing-notifier"]\n[hooks]\nSessionStart=[{command="missing-hook ./private.cjs"}]\n');
    const hook=join(root,".codex/hooks.json"); writeFileSync(hook,JSON.stringify({hooks:{SessionStart:[{command:"missing-hook ./private.cjs"}]}}));
    const nested=join(root,".codex/plugins/cache/marketplace/example/version/hooks"); mkdirSync(nested,{recursive:true}); const pluginHook=join(nested,"hooks.json"); writeFileSync(pluginHook,'{"hooks":{"SessionStart":[{"type":"future-hook"}]}}');
    const plugin=join(root,".codex/plugins/cache/marketplace/example/version");
    const manifest=join(plugin,".codex-plugin/plugin.json");mkdirSync(join(plugin,".codex-plugin"));writeFileSync(manifest,JSON.stringify({name:"example",hooks:["./lifecycle/boot.json"]}));
    mkdirSync(join(plugin,"lifecycle"));const declared=join(plugin,"lifecycle/boot.json");writeFileSync(declared,'{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"unresolved ./private.cjs","async":false}]}]}}');
    const assets=join(root,".codex/plugins/cache/marketplace/example/version/assets");mkdirSync(assets);
    // Exceeds the old loader inventory bound, not just the unrelated asset bound.
    if(cacheShape==="oversized")for(let i=0;i<600;i++)mkdirSync(join(root,".codex/plugins/cache",`inactive-${i}`));
    if(cacheShape==="unsupported")writeFileSync(manifest,JSON.stringify({name:"example",hooks:"../outside.json"}));
    for(let i=0;i<600;i++)writeFileSync(join(assets,`unrelated-${i}.md`),"not a startup source");
    const executable=join(root,"codex"); writeFileSync(executable,`#!${process.execPath}\nconsole.log('Usage: codex --model --disable --config');`); chmodSync(executable,0o700);
    const result=await inspectProviderControls(incidentRoster.reviewers.openai,"codex-cli 0.164.0",workspace,{state:"unknown",source:"fixture",detail:"unchanged"});
    expect(result.audit?.effects).toEqual(["codex-platform-runtime-reads-and-state"]);
    expect(result.audit?.unavailable).toEqual([]);
    expect(result.audit?.sources.some(s=>s.path.includes("/assets/"))).toBe(false);
    expect(result.audit?.sources.find(s=>s.path===hook)?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.audit?.sources.some(s=>s.path.startsWith(join(root,".codex/plugins")))).toBe(false);
    for(const file of [executable,join(root,".agents/policies/model-policy.md"),join(root,".codex/config.toml"),join(root,".codex/requirements.toml"),join(root,".codex/AGENTS.override.md"),join(root,".codex/AGENTS.md")]) {
      expect(result.audit?.sources.find(s=>s.path===file)).toBeDefined();
    }
    const disabled=result.recipe?.argv.filter((_arg,index)=>result.recipe?.argv[index-1]==="--disable");
    expect(disabled).toEqual(expect.arrayContaining(["plugins","hooks"]));
    expect(result.bootstrap.state).toBe("unknown");
    expect(result.facts.find(f=>f.name==="startup-and-platform-exceptions")?.observation.detail).toContain("AUDIT_DISPOSITION_PENDING");
    writeFileSync(declared,JSON.stringify({hooks:{Stop:[{hooks:[{type:"mcp_tool",server:"node_repl",tool:"turn_ended",input:{}}]}]}}));
    const builtin=await inspectProviderControls(incidentRoster.reviewers.openai,"codex-cli 0.164.0",workspace,{state:"unknown",source:"fixture",detail:"unchanged"});
    expect(builtin.audit?.effects).toEqual(["codex-platform-runtime-reads-and-state"]);
    expect(builtin.audit?.unavailable).toEqual([]);
    expect(auditHash(builtin.audit!)).toBe(auditHash(result.audit!));
    expect(builtin.bootstrap.state).toBe("unknown");
    symlinkSync(assets,join(plugin,"linked"));writeFileSync(manifest,JSON.stringify({name:"example",hooks:"./linked/boot.json"}));
    const unsupported=await inspectProviderControls(incidentRoster.reviewers.openai,"codex-cli 0.164.0",workspace,{state:"unknown",source:"fixture",detail:"unchanged"});
    expect(unsupported.audit?.unavailable).toEqual([]);
    expect(unsupported.audit?.effects).toEqual(["codex-platform-runtime-reads-and-state"]);
    expect(auditHash(unsupported.audit!)).toBe(auditHash(result.audit!));
    expect(unsupported.bootstrap.state).toBe("unknown");
  } finally { vi.unstubAllEnvs(); rmSync(root,{recursive:true,force:true}); }
});
