import { execFile } from "node:child_process";
import { promisify } from "node:util";
export type ProviderRead = (
  provider: "codex" | "antigravity" | "cursor",
  operation: "version" | "models" | "usage",
  cwd: string,
) => Promise<string>;
/** Deliberately no prompt/inference operation. /usage must retain slash-command handling. */
export const readProvider: ProviderRead = async (provider, operation, cwd) => {
  const executable = {
    codex: "codex",
    antigravity: "agy",
    cursor: "cursor-agent",
  }[provider];
  if (operation === "usage" && provider !== "antigravity")
    throw Error("PROVIDER_USAGE_SOURCE_UNEXPOSED");
  if (operation === "models" && provider === "codex")
    throw Error("CODEX_CATALOG_USE_NATIVE_API");
  const argv =
    operation === "version"
      ? ["--version"]
      : operation === "models"
        ? ["models"]
        : ["-p", "/usage", "--output-format", "json", "--print-timeout", "20s"];
  const r = await promisify(execFile)(executable, argv, {
    cwd,
    timeout: 25000,
    maxBuffer: 1024 * 1024,
    encoding: "utf8",
    env: { ...process.env, AGY_CLI_DISABLE_AUTO_UPDATE: "true" },
  });
  if (r.stderr.trim()) throw Error("PROVIDER_READ_DIAGNOSTICS_PRESENT");
  return r.stdout;
};
