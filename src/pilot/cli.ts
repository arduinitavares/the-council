#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync, renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { OrcaClient } from "../orca/client.js";
import { decodeStrictJson } from "../workers/strict-json.js";
import { freezeConfig, loadPilotConfig } from "./config.js";
import { NativeHostInspector } from "./discovery.js";
import { LocalReadRpc, LocalScopedRpc } from "./rpc.js";
import { createNativePilotDriver } from "./composition.js";
import { commandFromClient } from "./native-command.js";
import { PilotJournal } from "./journal.js";
import { OrcaPilotDriver, type Command } from "./orca-driver.js";
import { QualificationCache } from "./qualification-cache.js";
import { verifyNativeProof } from "./verify-proof.js";
import { runPilot, type PilotOutcome } from "./workflow.js";
const inputSchema = z.strictObject({
  runId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  candidate: z.string().min(1).max(100000),
  suppliedText: z.string().min(1).max(100000),
  maxProbeCalls: z.number().int().min(0).max(8),
  maxTopicCalls: z.number().int().min(10).max(10),
  deadline: z.number().int().positive(),
  workerTimeoutMs: z.number().int().positive().max(120000),
  proofTtlMs: z.number().int().positive().max(86400000).optional(),
});
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(
      "Council native pilot: --workspace /requesting/project --input /request.json --policy /execution-host/model-policy.md [--config /roster.yaml] [--orca /absolute/orca] [--check-config]",
    );
    return;
  }
  const flags = new Set([
    "--workspace",
    "--config",
    "--input",
    "--policy",
    "--orca",
  ]);
  const opts = new Map<string, string>();
  let check = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--check-config") {
      check = true;
      continue;
    }
    if (a === "--json") continue;
    if (
      !flags.has(a) ||
      opts.has(a) ||
      !args[i + 1] ||
      args[i + 1]!.startsWith("--")
    )
      throw Error("INVALID_NATIVE_ARGUMENTS");
    opts.set(a, args[++i]!);
  }
  const required = (k: string) => {
    const v = opts.get(k);
    if (!v) throw Error(`MISSING_${k}`);
    return v;
  };
  const workspace = realpathSync(resolve(required("--workspace")));
  const packageRoot = resolve(
    dirname(realpathSync(fileURLToPath(import.meta.url))),
    "../..",
  );
  const config = freezeConfig(
    loadPilotConfig(
      opts.has("--config")
        ? resolve(workspace, opts.get("--config")!)
        : resolve(
            packageRoot,
            "skills/the-council/references/first-use-roster.yaml",
          ),
    ),
  );
  if (check) {
    console.log(
      JSON.stringify({ status: "configuration_valid", workspace, ...config }),
    );
    return;
  }
  const inputPath = resolve(workspace, required("--input"));
  const bytes = readFileSync(inputPath);
  if (bytes.length > 250000) throw Error("NATIVE_INPUT_TOO_LARGE");
  const input = inputSchema.parse(decodeStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  const policyPath = realpathSync(resolve(workspace, required("--policy")));
  const orca = opts.get("--orca") ?? "/usr/local/bin/orca";
  if (!isAbsolute(orca)) throw Error("ABSOLUTE_ORCA_EXECUTABLE_REQUIRED");
  let journal: PilotJournal | undefined;
  let cache: QualificationCache | undefined;
  let outcome: PilotOutcome | undefined;
  let record: string | undefined;
  let finalError: unknown;
  try {
    // A competing cache writer does not reserve or consume this run identity.
    cache = new QualificationCache(workspace);
    const client = await OrcaClient.connect({ executable: orca, cwd: workspace });
    journal = new PilotJournal(workspace, input.runId, {
      runId: input.runId,
      maxProbeCalls: input.maxProbeCalls,
      maxTopicCalls: input.maxTopicCalls,
      deadline: input.deadline,
      workerTimeoutMs: input.workerTimeoutMs,
      proofTtlMs: input.proofTtlMs ?? 3600000,
      configHash: config.hash,
    });
    const command: Command = commandFromClient(client);
    const host = new NativeHostInspector(
      command,
      (id) => new LocalReadRpc(id, orca),
    );
    const cachedInspector = {
      inspect: async (request: import("./types.js").PilotRequest) => {
        const observation = await host.inspect(request);
        const proofs = await cache!.matching(
          observation.evidence,
          Date.now(),
          (p) => verifyNativeProof(p, command),
        );
        request.proofs.splice(0, request.proofs.length, ...proofs);
        return observation;
      },
    };
    const driver = createNativePilotDriver({ command, inspector: cachedInspector, rpc: id => new LocalScopedRpc(id, orca), orca, record: event => journal!.append(event) });
    outcome = await runPilot(
      { workspace, config: config.config, policyPath, ...input, proofs: [] },
      journal.wrap(driver),
    );
    // Preserve the operational outcome before optional cache persistence or
    // lifecycle cleanup can fail. Both failures remain visible in the final copy.
    const outcomePath = resolve(journal.path, "outcome.json");
    writeFileSync(
      outcomePath,
      JSON.stringify(outcome, null, 2) + "\n",
      { mode: 0o600, flag: "wx" },
    );
    record = outcomePath;
    if (outcome.proofs.length) cache.write(outcome.proofs);
    journal.append({
      event: "outcome-recorded",
      status: outcome.status,
      calls: outcome.calls,
      unresolved: outcome.unresolved,
    });
  } catch (error) {
    finalError = error;
  } finally {
    try { cache?.close(); } catch (error) { finalError ??= error; }
    try { journal?.close(); } catch (error) { finalError ??= error; }
  }
  if (!outcome || !record) throw finalError ?? Error("NATIVE_OUTCOME_NOT_RECORDED");
  if (finalError !== undefined) {
    outcome.status = "failed";
    outcome.error = finalError instanceof Error ? finalError.message : "NATIVE_PERSISTENCE_OR_CLOSE_FAILED";
    const temporary = resolve(dirname(record), `outcome-${randomUUID()}.tmp`);
    writeFileSync(temporary, JSON.stringify(outcome, null, 2)+"\n", { mode: 0o600, flag: "wx" });
    renameSync(temporary, record);
  }
  console.log(JSON.stringify({ ...outcome, record }));
  if (outcome.status === "prerequisites_not_verified") process.exitCode = 3;
  else if (outcome.status === "invalid_request") process.exitCode = 2;
  else if (outcome.status === "failed") process.exitCode = 4;
}
main().catch((error) => {
  const reason = error instanceof Error ? error.message : "NATIVE_FAILURE";
  const busy = reason === "QUALIFICATION_CACHE_BUSY_RECONCILE";
  console.log(
    JSON.stringify({
      status: busy ? "prerequisites_not_verified" : "invalid_request",
      reason,
      ...(busy ? { calls: { probes: 0, topic: 0 } } : {}),
    }),
  );
  process.exitCode = busy ? 3 : 2;
});
