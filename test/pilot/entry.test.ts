import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { configSchema } from "../../src/config/schema.js";
import { incidentRoster } from "./fixtures.js";
const launcher = resolve("skills/the-council/scripts/run-council.mjs");
it("publishes pseudonymous prerequisite evidence without raw IDs, account settings or usage", () => {
  const text = readFileSync(resolve("docs/qualification/issue-1-second-project-prerequisites.json"), "utf8");
  expect(text).not.toMatch(/usedPercent|remaining_fraction|extraUsage|planType|unlimited|\/Users\/|\/home\//);
  expect(text).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
  expect(text).not.toMatch(/"(?:projectId|workspaceIdentity|workspaceId|runtimeId|hostId)"\s*:/);
  const receipt = JSON.parse(text);
  expect(receipt.privacyProjection).toContain("pseudonyms");
  expect(receipt.sourceRevision).toBe("ec3b00c48796901f7246c0602dbd07d18fca1185");
});
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
  expect(files.some((path: string) => /(?:^|\/)host-relay\./.test(path))).toBe(false);
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
