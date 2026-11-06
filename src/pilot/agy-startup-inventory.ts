import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { ModelSelection } from "./config.js";
import type { AuditSource } from "./control-audit.js";
import type { AgyInventoryContext, AgyRecipeInputs } from "./agy-inventory-witness.js";
import { AgyRecipeSettingsError, buildAgyRecipePlan } from "./agy-recipe-plan.js";
import { readInventoryFile, readInventoryJson, type InventoryBudget, type InventoryProblem, type ReadReceipt } from "./inventory-io.js";

export type AgyCurrentContext = Pick<AgyInventoryContext, "requestingWorkspace" | "executionCwd" | "home" | "rawHome" | "selectedAgent" | "environmentInputs">;
export type AgyAcquiredExecutable = { path: string; sha256: string; receipt: ReadReceipt };
export type AgyCurrentInputs = { context: AgyCurrentContext; executable: AgyAcquiredExecutable; recipeInputs: AgyRecipeInputs };
export type AgyCurrentInputResult = { sources: readonly AuditSource[]; ordering: readonly string[] } & (
  | { state: "present"; value: AgyCurrentInputs }
  | { state: "unknown"; context: AgyCurrentContext | null; executable: AgyAcquiredExecutable | null; problems: readonly InventoryProblem[] }
);

/** Acquire current launch inputs only. No command, loader qualification, saved
 * witness binding, or native authority is obtained by successful reconstruction. */
export function reconstructCurrentAgyInputs(request: { selection: ModelSelection; version: string; workspace: string }, budget: InventoryBudget): AgyCurrentInputResult {
  const environmentInputs: Record<string, string | null> = {};
  for (const name of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TERM"]) environmentInputs[name] = process.env[name] ?? null;
  environmentInputs.AGY_CLI_DISABLE_AUTO_UPDATE = "true";
  const sources: AuditSource[] = [], ordering: string[] = [], problems: InventoryProblem[] = [];
  let context: AgyCurrentContext;
  try {
    context = { requestingWorkspace: request.workspace, executionCwd: join(request.workspace, ".council/native-packets"),
      home: homedir(), rawHome: environmentInputs.HOME!, selectedAgent: "council-packet", environmentInputs };
  } catch {
    return { state: "unknown", context: null, executable: null, sources, ordering,
      problems: [{ code: "AGY_CURRENT_CONTEXT_UNAVAILABLE", path: request.workspace, edge: null }] };
  }
  let executable: AgyAcquiredExecutable | null = null;
  let executablePath: string | null = null;
  try {
    // Retain the producer's first existing candidate and canonical-target lookup.
    // A guarded refusal never advances to another PATH candidate.
    for (const directory of (environmentInputs.PATH ?? "").split(delimiter)) {
      const candidate = join(directory, "agy");
      if (existsSync(candidate)) { executablePath = realpathSync(candidate); break; }
    }
    if (executablePath === null) problems.push({ code: "AGY_EXECUTABLE_NOT_FOUND", path: "agy", edge: null });
    else {
      const acquired = readInventoryFile(executablePath, 268435456, budget);
      if (acquired.state === "present") {
        executable = { path: executablePath, sha256: acquired.value.sha256, receipt: acquired.receipt };
        sources.push({ path: executablePath, kind: "file", sha256: executable.sha256 });
      } else if (acquired.state === "unknown") problems.push(...acquired.problems);
      else problems.push({ code: "AGY_EXECUTABLE_ABSENT", path: executablePath, edge: null });
      // Do not retain the executable payload after identity acquisition.
    }
  } catch (cause) {
    const error = cause as NodeJS.ErrnoException;
    problems.push({ code: error.code ?? "AGY_EXECUTABLE_LOOKUP_UNAVAILABLE", path: error.path ?? executablePath ?? "agy", edge: null });
  }
  const settingsPath = join(context.home, ".gemini/antigravity-cli/settings.json");
  ordering.push(settingsPath);
  const settings = readInventoryJson(settingsPath, budget);
  if (settings.state === "present") sources.push({ path: settingsPath, kind: "file", sha256: settings.value.file.sha256 });
  else if (settings.state === "absent") sources.push({ path: settingsPath, kind: "absent", sha256: null });
  else problems.push(...settings.problems);
  if (executable && settings.state !== "unknown" && problems.length === 0) {
    try {
      const recipeInputs = buildAgyRecipePlan({ ...request, executable: executable.path,
        legacySettings: settings.state === "absent" ? undefined : settings.value.value, agyHookShell: null });
      return { state: "present", value: { context, executable, recipeInputs }, sources, ordering };
    } catch (cause) {
      if (!(cause instanceof AgyRecipeSettingsError)) throw cause;
      problems.push({ code: cause.message, path: settingsPath, edge: null });
    }
  }
  return { state: "unknown", context, executable, problems, sources, ordering };
}
