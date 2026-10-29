import { expect, it } from "vitest";
import {
  freezeConfig,
  pilotConfigSchema,
  selectionArgs,
  loadPilotConfig,
} from "../../src/pilot/config.js";
import { parseCouncilConfig } from "../../src/config/load.js";
import { incidentRoster } from "./fixtures.js";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
it("preserves exact selection encoding across freeze/reload and rejects native-only input in retained entry explicitly", () => {
  const frozen = freezeConfig(incidentRoster);
  expect(
    freezeConfig(
      pilotConfigSchema.parse(JSON.parse(JSON.stringify(frozen.config))),
    ),
  ).toEqual(frozen);
  expect(selectionArgs(frozen.config.reviewers.xai)).toEqual([
    "--agent",
    "cursor",
    "--model",
    "grok-4.7-xhigh",
  ]);
  expect(() =>
    parseCouncilConfig(Buffer.from(JSON.stringify(incidentRoster))),
  ).toThrow("CONFIG_NATIVE_ONLY_USE_NATIVE_COMMAND");
  expect(
    parseCouncilConfig(readFileSync("council.yaml")).reviewers.claude.route,
  ).toBe("antigravity");
});
it("rejects mismatched encoded effort and unknown native config fields", () => {
  const c = structuredClone(incidentRoster);
  c.reviewers.xai.effort = "high";
  expect(pilotConfigSchema.safeParse(c).success).toBe(false);
  expect(
    pilotConfigSchema.safeParse({ ...incidentRoster, paidOverflow: true })
      .success,
  ).toBe(false);
});

it("rejects non-UTF8, oversized, anchored, tagged, duplicate-key and YAML-1.1 native configuration before launch", () => {
  const dir = mkdtempSync(join(tmpdir(), "pilot-config-"));
  try {
    const valid = readFileSync(
      "skills/the-council/references/first-use-roster.yaml",
      "utf8",
    );
    for (const [name, bytes] of [
      ["utf8", Buffer.from([0xff, 0xfe])],
      ["size", Buffer.from(" ".repeat(65537))],
      [
        "anchor",
        Buffer.from(valid.replace("version: 1", "version: &unused 1")),
      ],
      [
        "tag",
        Buffer.from(valid.replace("version: 1", "version: !untrusted 1")),
      ],
      ["duplicate", Buffer.from(valid + "\nversion: 1\n")],
      ["yaml11", Buffer.from("%YAML 1.1\n---\n" + valid)],
    ] as const) {
      const file = join(dir, name);
      writeFileSync(file, bytes);
      expect(() => loadPilotConfig(file), name).toThrow();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
