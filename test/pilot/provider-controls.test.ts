import { expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, realpathSync, symlinkSync } from "node:fs";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { inspectProviderControls } from "../../src/pilot/provider-controls.js";
import { incidentRoster } from "./fixtures.js";

it("acquires a reachable AGY recipe from its versioned stderr help and existing trust without changing global files", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "provider-controls-")));
  try {
    vi.stubEnv("HOME", root); vi.stubEnv("PATH", root+delimiter+process.env.PATH);
    const workspace = join(root,"project"); mkdirSync(workspace);
    mkdirSync(join(root,".gemini/antigravity-cli"),{recursive:true});
    const settings = { trustedWorkspaces:[join(workspace,".council/native-packets")], permissions:{deny:["existing-deny(*)"]} };
    writeFileSync(join(root,".gemini/antigravity-cli/settings.json"),JSON.stringify(settings));
    const executable=join(root,"agy");writeFileSync(executable,`#!${process.execPath}\nprocess.stderr.write('Usage of agy:\\n -settings string\\n -agent string\\n');`);chmodSync(executable,0o700);
    const result=await inspectProviderControls(incidentRoster.reviewers.gemini,"1.4.11",workspace,{state:"unknown",source:"existing access",detail:"unchanged"});
    expect(result.bootstrap.state).toBe("verified");
    expect(result.recipe?.argv).toEqual(expect.arrayContaining(["--agent","council-packet","--settings"]));
    expect(result.recipe?.materializations?.find(item=>item.path.endsWith("session-settings.json"))?.content).toContain("existing-deny(*)");
    expect(result.controls.state).toBe("unknown");
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

it("fingerprints suppressed Codex notify and hook inputs without auditing their executable closure", async () => {
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
    for(let i=0;i<600;i++)writeFileSync(join(assets,`unrelated-${i}.md`),"not a startup source");
    const executable=join(root,"codex"); writeFileSync(executable,`#!${process.execPath}\nconsole.log('Usage: codex --model --disable --config');`); chmodSync(executable,0o700);
    const result=await inspectProviderControls(incidentRoster.reviewers.openai,"codex-cli 0.164.0",workspace,{state:"unknown",source:"fixture",detail:"unchanged"});
    expect(result.audit?.effects).toEqual(["codex-platform-runtime-reads-and-state"]);
    expect(result.audit?.unavailable).toEqual([]);
    expect(result.audit?.sources.some(s=>s.path.includes("/assets/"))).toBe(false);
    expect(result.audit?.sources.find(s=>s.path===hook)?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.audit?.sources.find(s=>s.path===pluginHook)?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.audit?.sources.find(s=>s.path===manifest)?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.audit?.sources.find(s=>s.path===declared)?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.bootstrap.state).toBe("unknown");
    expect(result.facts.find(f=>f.name==="startup-and-platform-exceptions")?.observation.detail).toContain("AUDIT_DISPOSITION_PENDING");
    writeFileSync(declared,JSON.stringify({hooks:{Stop:[{hooks:[{type:"mcp_tool",server:"node_repl",tool:"turn_ended",input:{}}]}]}}));
    const builtin=await inspectProviderControls(incidentRoster.reviewers.openai,"codex-cli 0.164.0",workspace,{state:"unknown",source:"fixture",detail:"unchanged"});
    expect(builtin.audit?.effects.some(effect=>effect.startsWith("codex-builtin-cleanup-candidate:"))).toBe(true);
    expect(builtin.bootstrap.state).toBe("unknown");
    symlinkSync(assets,join(plugin,"linked"));writeFileSync(manifest,JSON.stringify({name:"example",hooks:"./linked/boot.json"}));
    const unsupported=await inspectProviderControls(incidentRoster.reviewers.openai,"codex-cli 0.164.0",workspace,{state:"unknown",source:"fixture",detail:"unchanged"});
    expect(unsupported.audit?.unavailable).toContain(`CODEX_PLUGIN_STARTUP_SOURCE_UNAVAILABLE:${join(plugin,"linked/boot.json")}`);
    expect(unsupported.bootstrap.state).toBe("unknown");
  } finally { vi.unstubAllEnvs(); rmSync(root,{recursive:true,force:true}); }
});
