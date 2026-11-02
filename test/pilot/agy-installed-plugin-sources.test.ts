import { expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { inspectProviderControls, type ProviderControlEvidence } from "../../src/pilot/provider-controls.js";
import { currentSourceDigest, type AuditSource } from "../../src/pilot/control-audit.js";
import { incidentRoster } from "./fixtures.js";

const help = readFileSync(new URL("./fixtures/agy-1.4.12-help.txt", import.meta.url), "utf8");
const inventoryUnavailable = "AGY_PLUGIN_INVENTORY_UNAVAILABLE";
const digest = (bytes: string) => createHash("sha256").update(bytes).digest("hex");

async function withFixture(run: (fixture: { home: string; workspace: string; store: string; inspect: () => Promise<ProviderControlEvidence> }) => Promise<void>) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "agy-plugin-sources-")));
  const workspace = join(home, "project");
  const bin = join(home, "bin");
  mkdirSync(workspace); mkdirSync(bin);
  put(join(home, ".agents/policies/model-policy.md"), "inert fixture policy\n");
  put(join(home, ".gemini/antigravity-cli/settings.json"), "{}");
  const executable = join(bin, "agy");
  // No provider, shell, or hook execution: accept exactly the acquisition query.
  put(executable, `#!${process.execPath}\nif (process.argv.length !== 3 || process.argv[2] !== '--help') process.exitCode = 64;\nelse process.stderr.write(${JSON.stringify(help)});\n`);
  chmodSync(executable, 0o700);
  vi.stubEnv("HOME", home); vi.stubEnv("PATH", bin);
  try {
    await run({ home, workspace, store: join(home, ".gemini/config/plugins"), inspect: () => inspectProviderControls(
      incidentRoster.reviewers.gemini, "1.4.12", workspace,
      { state: "unknown", source: "fixture", detail: "No provider qualification" },
    ) });
  } finally {
    // Every call is awaited: execFile has closed the help-only child before cleanup.
    vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true });
  }
}

function put(file: string, bytes: string) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes); }
function source(result: ProviderControlEvidence, file: string): AuditSource {
  const found = result.audit?.sources.find(item => item.path === file);
  expect(found, `missing acquired source: ${file}`).toBeDefined();
  return found!;
}
function expectUnavailable(result: ProviderControlEvidence) {
  expect(result.audit?.unavailable).toContain(inventoryUnavailable);
  expect(result.facts.find(fact => fact.name === "startup-hooks-and-plugins")?.observation.state).toBe("unknown");
  expect(result.bootstrap.state).not.toBe("verified");
  expect(result.controls.state).toBe("unknown");
}

// Break caught: the installed store disappears while a recognized workspace hook survives.
it("acquires current-store metadata and command hooks alongside a separate workspace hook", async () => {
  await withFixture(async ({ store, workspace, inspect }) => {
    const plugin = join(store, "installed");
    const manifest = join(plugin, "plugin.json");
    const hook = join(plugin, "hooks.json");
    const workspaceHook = join(workspace, ".agents/plugins/control/hooks.json");
    put(manifest, '{"name":"installed"}');
    put(hook, '{"hooks":{"SessionStart":[{"type":"command","command":"/bin/echo inert-store-fixture"}]}}');
    put(workspaceHook, '{"hooks":{"SessionStart":[{"type":"prompt","prompt":"inert workspace control"}]}}');
    const result = await inspect();
    expect(result.facts.find(fact => fact.name === "installed-command-contract")?.observation.state).toBe("verified");
    expect(source(result, store).kind).toBe("metadata");
    expect(source(result, plugin).kind).toBe("metadata");
    expect(source(result, manifest).sha256).toBe(digest('{"name":"installed"}'));
    expect(source(result, hook).sha256).toBe(digest(readFileSync(hook, "utf8")));
    expect(source(result, workspaceHook).kind).toBe("file");
    expect(result.audit?.effects.filter(effect => effect.startsWith("startup-hook:"))).toHaveLength(2);
    expect(result.facts.find(fact => fact.name === "startup-hooks-and-plugins")?.observation.state).toBe("unknown");
    expect(result.bootstrap.state).not.toBe("verified");
  });
});

it("retains recognized workspace hook acquisition without an installed store", async () => {
  await withFixture(async ({ workspace, inspect }) => {
    const hook = join(workspace, ".agents/plugins/control/hooks.json");
    put(hook, '{"hooks":{"SessionStart":[{"type":"prompt","prompt":"workspace control"}]}}');
    const result = await inspect();
    expect(source(result, hook).kind).toBe("file");
    expect(result.audit?.effects).toHaveLength(1);
    expect(result.facts.find(fact => fact.name === "startup-hooks-and-plugins")?.observation.state).toBe("unknown");
  });
});

// Break caught: absence is omitted, allowing a later store to reuse an old snapshot.
it("tracks every recognized root while absent and invalidates on later appearance", async () => {
  await withFixture(async ({ home, workspace, store, inspect }) => {
    const result = await inspect();
    for (const root of [store, join(home, ".gemini/antigravity-cli/plugins"), join(workspace, ".agents/plugins")]) {
      const retained = source(result, root);
      expect(retained).toMatchObject({ kind: "absent", sha256: null });
      mkdirSync(root, { recursive: true });
      expect(currentSourceDigest(retained)).toBe("unexpected-source");
    }
  });
});

it.each(["add", "remove"])("invalidates observed root membership metadata on %s", async change => {
  await withFixture(async ({ store, inspect }) => {
    mkdirSync(join(store, "first"), { recursive: true });
    const retained = source(await inspect(), store);
    if (change === "add") mkdirSync(join(store, "second"));
    else rmSync(join(store, "first"), { recursive: true });
    // Make the observed metadata change deterministic on coarse timestamp filesystems.
    utimesSync(store, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    expect(currentSourceDigest(retained)).not.toBe(retained.sha256);
  });
});

it("invalidates observed membership metadata inside a discovered plugin directory", async () => {
  await withFixture(async ({ store, inspect }) => {
    const plugin = join(store, "candidate"); mkdirSync(plugin, { recursive: true });
    const retained = source(await inspect(), plugin);
    put(join(plugin, "new-metadata.json"), "{}");
    utimesSync(plugin, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    expect(currentSourceDigest(retained)).not.toBe(retained.sha256);
  });
});

// Break caught: one supported candidate spelling or root hooks is not fingerprinted.
it.each(["plugin.json", ".antigravity-plugin/plugin.json", ".gemini-plugin/plugin.json", ".claude-plugin/plugin.json", "gemini-extension.json", "hooks.json"])("invalidates acquired %s bytes and removal", async leaf => {
  await withFixture(async ({ store, inspect }) => {
    const file = join(store, "candidate", leaf);
    put(file, "{}");
    const retained = source(await inspect(), file);
    expect(retained).toMatchObject({ kind: "file", sha256: digest("{}") });
    put(file, '{"changed":true}');
    expect(currentSourceDigest(retained)).not.toBe(retained.sha256);
    rmSync(file);
    expect(currentSourceDigest(retained)).toBeNull();
  });
});

it("invalidates a retained store digest after root removal", async () => {
  await withFixture(async ({ store, inspect }) => {
    mkdirSync(store, { recursive: true });
    const retained = source(await inspect(), store);
    rmSync(store, { recursive: true });
    expect(currentSourceDigest(retained)).toBeNull();
  });
});

// Break caught: marker names or disabled metadata are mistaken for proven activation.
it.each(['{"name":"candidate","disabled":true}', '{"name":"candidate"}'])("keeps hookless manifest metadata unresolved: %s", async manifest => {
  await withFixture(async ({ store, inspect }) => {
    const file = join(store, "candidate/plugin.json"); put(file, manifest);
    const result = await inspect();
    expect(source(result, file).sha256).toBe(digest(manifest));
    expect(result.audit?.effects).toEqual([]);
    expectUnavailable(result);
  });
});

it("keeps an unrecognized hookless directory unresolved", async () => {
  await withFixture(async ({ store, inspect }) => {
    mkdirSync(join(store, "candidate"), { recursive: true });
    expectUnavailable(await inspect());
  });
});

// Break caught: lstat/exists on the leaf alone follows an unsafe intermediate component.
it.each(["root", "dangling-root", "root-parent", "plugin-directory", "nested-manifest-directory", "manifest", "hooks"])("rejects a symlink at %s without acquiring target bytes", async shape => {
  await withFixture(async ({ home, store, inspect }) => {
    const target = join(home, "outside-inventory"); mkdirSync(target);
    const targetFile = join(target, "plugin.json"); put(targetFile, '{"name":"must-not-read"}');
    const plugin = join(store, "candidate");
    if (shape === "root" || shape === "dangling-root") {
      mkdirSync(dirname(store), { recursive: true });
      symlinkSync(shape === "root" ? target : join(home, "missing-target"), store);
    } else if (shape === "root-parent") {
      symlinkSync(target, dirname(store));
    } else {
      mkdirSync(plugin, { recursive: true });
      if (shape === "plugin-directory") symlinkSync(target, join(store, "linked"));
      else if (shape === "nested-manifest-directory") symlinkSync(target, join(plugin, ".gemini-plugin"));
      else symlinkSync(targetFile, join(plugin, shape === "manifest" ? "plugin.json" : "hooks.json"));
    }
    const result = await inspect();
    expectUnavailable(result);
    if (shape === "dangling-root") expect(source(result, store).kind).toBe("metadata");
    expect(result.audit?.sources.some(item => item.kind === "file" && (item.path.startsWith(store) || item.path.startsWith(target)))).toBe(false);
  });
});

it.each(["current", "legacy", "workspace"])("preserves the 100-entry bound for the %s root", async location => {
  await withFixture(async ({ home, workspace, store, inspect }) => {
    const root = location === "current" ? store : location === "legacy" ? join(home, ".gemini/antigravity-cli/plugins") : join(workspace, ".agents/plugins");
    mkdirSync(root, { recursive: true });
    for (let index = 0; index < 101; index++) mkdirSync(join(root, `entry-${index}`));
    expectUnavailable(await inspect());
  });
});

it("allows exactly 100 directory entries without widening the inventory bound", async () => {
  await withFixture(async ({ store, inspect }) => {
    for (let index = 0; index < 100; index++) put(join(store, `entry-${index}.txt`), "inert");
    expect((await inspect()).audit?.unavailable).not.toContain(inventoryUnavailable);
  });
});

// Break caught: acquisition failures are filtered out before the initial startup predicate.
it.each(["non-directory-root", "malformed-manifest", "oversized-manifest", "non-regular-manifest", "malformed-hook", "oversized-hook", "global-hook"])("keeps %s acquisition unavailable and startup nonverified", async shape => {
  await withFixture(async ({ home, store, inspect }) => {
    if (shape === "non-directory-root") put(store, "{}");
    else if (shape === "global-hook") put(join(home, ".gemini/config/hooks.json"), "{malformed");
    else {
      const file = join(store, "candidate", shape.endsWith("hook") ? "hooks.json" : "plugin.json");
      if (shape === "non-regular-manifest") mkdirSync(file, { recursive: true });
      else put(file, shape.startsWith("oversized") ? " ".repeat(1024 * 1024 + 1) : "{malformed");
    }
    expectUnavailable(await inspect());
  });
});
