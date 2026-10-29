import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { configSchema } from "../../src/config/schema.js";

export const incidentRoster = {
  version: 1,
  reviewers: {
    openai: { route: "codex", model: "gpt-6.1-sol", effort: "max" },
    gemini: {
      route: "antigravity",
      model: "gemini-4-argon-high",
      effort: "high",
    },
    xai: {
      route: "cursor",
      model: "grok-4.7-xhigh",
      effort: "xhigh",
      effortEncoding: "model",
    },
  },
  judge: { route: "codex", model: "gpt-6-astra", effort: "max" },
};
const launcher = resolve("skills/the-council/scripts/run-council.mjs");
describe("packaged native entry (E2 public incident fixture)", () => {
  it("documents the explicit shipped native topic path", () => {
    const child = spawnSync(process.execPath, [launcher, "native", "--help"], {
      encoding: "utf8",
    });
    expect(child.stdout).toContain("Council native pilot");
    expect(child.stdout).toContain("--workspace");
  });
  it("accepts and freezes E2 independently of the retained controller format", () => {
    const workspace = mkdtempSync(join(tmpdir(), "council-project-B-"));
    try {
      const config = join(workspace, "council.json");
      writeFileSync(config, JSON.stringify(incidentRoster));
      const child = spawnSync(
        process.execPath,
        [
          launcher,
          "native",
          "--workspace",
          workspace,
          "--config",
          config,
          "--check-config",
        ],
        { cwd: workspace, encoding: "utf8" },
      );
      expect(child.stdout).toContain("configuration_valid");
      const result = JSON.parse(child.stdout);
      expect(result.config).toEqual(incidentRoster);
      // Separate pilot: do not silently reinterpret persisted controller configurations.
      expect(configSchema.safeParse(incidentRoster).success).toBe(false);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

it("ships every native resource and resolves a symlinked installation from a foreign cwd", () => {
  const pack = spawnSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    { encoding: "utf8" },
  );
  expect(pack.status).toBe(0);
  const files = JSON.parse(pack.stdout)[0].files.map((f: any) => f.path);
  for (const path of [
    "dist/pilot/cli.js",
    "dist/pilot/rpc.js",
    "skills/the-council/references/first-use.md",
    "skills/the-council/references/first-use-roster.yaml",
  ])
    expect(files).toContain(path);
  const foreign = mkdtempSync(join(tmpdir(), "council-package-"));
  try {
    const link = join(foreign, "installed-launcher.mjs");
    symlinkSync(launcher, link);
    const child = spawnSync(
      process.execPath,
      [link, "native", "--workspace", foreign, "--check-config"],
      { cwd: foreign, encoding: "utf8" },
    );
    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout).config).toEqual(incidentRoster);
  } finally {
    rmSync(foreign, { recursive: true, force: true });
  }
});
