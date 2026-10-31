import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { z } from "zod";
import { CONFIG_LIMIT_BYTES, decodeConfigYaml } from "../config/load.js";
import { canonicalJson, hashArtifact } from "../domain/hash.js";

export const selectionSchema = z
  .strictObject({
    route: z.enum(["codex", "antigravity", "cursor"]),
    model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*[0-9][A-Za-z0-9._-]*$/),
    effort: z.enum(["low", "medium", "high", "xhigh", "max", "ultra"]),
    effortEncoding: z.enum(["native", "model"]).optional(),
  })
  .superRefine((s, ctx) => {
    if (
      (s.effortEncoding === "model" &&
        (s.route !== "cursor" || !s.model.endsWith(`-${s.effort}`))) ||
      (s.route === "cursor" && s.effortEncoding !== "model")
    )
      ctx.addIssue({
        code: "custom",
        message: "Cursor effort must be encoded in its exact model identifier",
      });
  });
export type ModelSelection = import("../domain/contracts.js").ModelSelection<
  import("../domain/contracts.js").NativeProviderRoute
>;
export const pilotConfigSchema = z
  .strictObject({
    version: z.literal(1),
    reviewers: z.strictObject({
      openai: selectionSchema,
      gemini: selectionSchema,
      xai: selectionSchema,
    }),
    judge: selectionSchema,
  })
  .superRefine((c, ctx) => {
    for (const [s, route, family] of [
      [c.reviewers.openai, "codex", /^gpt-/],
      [c.reviewers.gemini, "antigravity", /^gemini-/],
      [c.reviewers.xai, "cursor", /^grok-/],
      [c.judge, "codex", /^gpt-/],
    ] as const) {
      if (s.route !== route || !family.test(s.model))
        ctx.addIssue({
          code: "custom",
          message: "Pilot role/family/route mismatch",
        });
    }
  });
export type PilotConfig = z.infer<typeof pilotConfigSchema>;
export type Role = "openai" | "gemini" | "xai" | "judge";
export function loadPilotConfig(path: string): PilotConfig {
  const fd = openSync(
    realpathSync(path),
    constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
  );
  let value: unknown;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > CONFIG_LIMIT_BYTES)
      throw new Error("PILOT_CONFIG_TOO_LARGE_OR_NOT_FILE");
    const bytes = Buffer.alloc(CONFIG_LIMIT_BYTES + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null);
      if (!count) break;
      size += count;
    }
    value = decodeConfigYaml(bytes.subarray(0, size));
  } finally {
    closeSync(fd);
  }
  const result = pilotConfigSchema.safeParse(value);
  if (!result.success)
    throw new Error(
      "PILOT_CONFIG_INCOMPATIBLE: native requires openai/gemini/xai plus judge; saved controller configurations use the retained controller commands. " +
        result.error.message,
    );
  return result.data;
}
export function freezeConfig(config: PilotConfig): {
  config: PilotConfig;
  hash: string;
} {
  const frozen = pilotConfigSchema.parse(JSON.parse(canonicalJson(config)));
  return {
    config: frozen,
    hash: hashArtifact("pilot-config", canonicalJson(frozen)),
  };
}
export function agentFor(selection: ModelSelection): string {
  return selection.route;
}
export function selectionArgs(selection: ModelSelection): string[] {
  return [
    "--agent",
    agentFor(selection),
    "--model",
    selection.model,
    ...(selection.effortEncoding === "model"
      ? []
      : ["--effort", selection.effort]),
  ];
}
