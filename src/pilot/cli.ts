#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { OrcaClient } from "../orca/client.js";
import { decodeStrictJson } from "../workers/strict-json.js";
import { freezeConfig, loadPilotConfig } from "./config.js";
import { NativeHostInspector } from "./discovery.js";
import { LocalReadRpc } from "./rpc.js";
import { PilotJournal } from "./journal.js";
import { OrcaPilotDriver, type Command } from "./orca-driver.js";
import { QualificationCache } from "./qualification-cache.js";
import { verifyNativeProof } from "./verify-proof.js";
import { runPilot } from "./workflow.js";
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
  const input = inputSchema.parse(JSON.parse(bytes.toString("utf8")));
  const policyPath = realpathSync(resolve(workspace, required("--policy")));
  const orca = opts.get("--orca") ?? "/usr/local/bin/orca";
  if (!isAbsolute(orca)) throw Error("ABSOLUTE_ORCA_EXECUTABLE_REQUIRED");
  let journal: PilotJournal | undefined;
  let cache: QualificationCache | undefined;
  try {
    // A competing cache writer does not reserve or consume this run identity.
    cache = new QualificationCache(workspace);
    journal = new PilotJournal(workspace, input.runId, {
      runId: input.runId,
      maxProbeCalls: input.maxProbeCalls,
      maxTopicCalls: input.maxTopicCalls,
      deadline: input.deadline,
      workerTimeoutMs: input.workerTimeoutMs,
      proofTtlMs: input.proofTtlMs ?? 3600000,
      configHash: config.hash,
    });
    const client = await OrcaClient.connect({
      executable: orca,
      cwd: workspace,
    });
    const command: Command = async (argv, cwd, timeoutMs) => {
      const p = await client.run(argv, { cwd, timeoutMs });
      if (p.exitCode !== 0 || p.timedOut || p.overflow || !p.closed)
        throw Error(
          `ORCA_COMMAND_UNVERIFIED:${argv.slice(0, 2).join(" ")}:${p.exitCode ?? "unknown"}`,
        );
      const envelope: any = decodeStrictJson(
        new TextDecoder().decode(p.stdout),
      );
      // agent-context is a CLI registry document, not an RPC envelope.
      if (argv[0] === "agent-context") {
        if (envelope.schemaVersion !== 1 || !Number.isSafeInteger(envelope.commandCount) ||
            !Array.isArray(envelope.commands) || envelope.commandCount !== envelope.commands.length ||
            !envelope.commands.every((entry:any) => typeof entry?.command === "string" && entry.command.length > 0))
          throw Error("ORCA_COMMAND_REGISTRY_INVALID");
        return envelope;
      }
      if (envelope.ok !== true)
        throw Error(`ORCA_${envelope.error?.code ?? "INVALID_ENVELOPE"}`);
      return envelope.result;
    };
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
    const driver = new OrcaPilotDriver(command, cachedInspector);
    const outcome = await runPilot(
      { workspace, config: config.config, policyPath, ...input, proofs: [] },
      journal.wrap(driver),
    );
    // Each proof already requires both positively released probes. A later
    // unrelated topic cleanup failure must not discard that valid evidence.
    if (outcome.proofs.length) cache.write(outcome.proofs);
    writeFileSync(
      resolve(journal.path, "outcome.json"),
      JSON.stringify(outcome, null, 2) + "\n",
      { mode: 0o600, flag: "wx" },
    );
    journal.append({
      event: "outcome-recorded",
      status: outcome.status,
      calls: outcome.calls,
      unresolved: outcome.unresolved,
    });
    console.log(
      JSON.stringify({
        ...outcome,
        record: resolve(journal.path, "outcome.json"),
      }),
    );
    if (outcome.status === "prerequisites_not_verified") process.exitCode = 3;
    else if (outcome.status === "invalid_request") process.exitCode = 2;
    else if (outcome.status === "failed") process.exitCode = 4;
  } finally {
    try {
      cache?.close();
    } finally {
      journal?.close();
    }
  }
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
