#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync, renameSync, openSync, fstatSync, lstatSync, closeSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { canonicalJson } from "../domain/hash.js";
import { PilotDiagnosticError, addDiagnosticCount, DIAGNOSTIC_COUNTER_MAX, fitDiagnosticSummary, projectDiagnostic, type DiagnosticSummary } from "./diagnostics.js";
import { OrcaClient } from "../orca/client.js";
import { decodeStrictJson } from "../workers/strict-json.js";
import { freezeConfig, loadPilotConfig } from "./config.js";
import { prepareProviderAudit, adoptProviderAudit } from "./provider-controls.js";
import { readProvider } from "./provider-read.js";
import { NativeHostInspector } from "./discovery.js";
import { LocalReadRpc, LocalScopedRpc } from "./rpc.js";
import { createNativePilotDriver } from "./composition.js";
import { commandFromClient } from "./native-command.js";
import { PilotJournal } from "./journal.js";
import { type Command } from "./orca-driver.js";
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
async function auditCommand(args: string[]): Promise<void> {
  const action=args.shift();const options=new Map<string,string>();
  const allowed=new Set(["--workspace","--config","--role","--orca","--hash","--run","--task"]);
  for(let i=0;i<args.length;i+=2){const key=args[i]!;if(!allowed.has(key)||options.has(key)||!args[i+1]||args[i+1]!.startsWith("--"))throw Error("INVALID_AUDIT_ARGUMENTS");options.set(key,args[i+1]!);}
  const need=(key:string)=>{const value=options.get(key);if(!value)throw Error("MISSING_"+key);return value;};
  const workspace=realpathSync(resolve(need("--workspace")));
  if(action==="prepare"){
    const packageRoot=resolve(dirname(realpathSync(fileURLToPath(import.meta.url))),"../..");
    const config=loadPilotConfig(options.has("--config")?resolve(workspace,options.get("--config")!):resolve(packageRoot,"skills/the-council/references/first-use-roster.yaml"));
    const role=need("--role");if(!["openai","gemini","xai","judge"].includes(role))throw Error("INVALID_AUDIT_ROLE");
    const selection=role==="judge"?config.judge:config.reviewers[role as keyof typeof config.reviewers];
    const version=(await readProvider(selection.route,"version",workspace)).trim();
    console.log(JSON.stringify({status:"audit_prepared",...await prepareProviderAudit(selection,version,workspace)}));return;
  }
  if(action==="adopt"){
    const orca=options.get("--orca")??"/usr/local/bin/orca";if(!isAbsolute(orca))throw Error("ABSOLUTE_ORCA_EXECUTABLE_REQUIRED");
    const client=await OrcaClient.connect({executable:orca,cwd:workspace});
    console.log(JSON.stringify({status:"audit_disposition_acquired",...await adoptProviderAudit(workspace,need("--hash"),need("--run"),need("--task"),commandFromClient(client))}));return;
  }
  throw Error("INVALID_AUDIT_ACTION");
}
function cliDiagnostic(cause: unknown, phase: "validation" | "persistence"): DiagnosticSummary {
  try { return projectDiagnostic(cause, { origin: "cli", phase }); }
  catch { return projectDiagnostic("DIAGNOSTIC_SUMMARY_INVALID", { origin: "cli", phase }); }
}
function retainDiagnostic(first: DiagnosticSummary, next: DiagnosticSummary): DiagnosticSummary {
  try {
    return fitDiagnosticSummary({ ...first,
      details: [...first.details, { origin: next.origin, phase: next.phase, code: next.code }, ...next.details] });
  } catch {
    const omitted = first.details.length + next.details.length + 1;
    return fitDiagnosticSummary({ ...first, details: [], truncated: true, omissions: { ...first.omissions,
      details: addDiagnosticCount(first.omissions.details, omitted),
      countersSaturated: first.omissions.countersSaturated || omitted > DIAGNOSTIC_COUNTER_MAX - first.omissions.details } });
  }
}
async function executeNativeCli(args: string[]): Promise<void> {
  if(args[0]==="audit"){await auditCommand(args.slice(1));return;}
  if (args.length === 1 && args[0] === "--help") {
    console.log(
      "Council native pilot: --workspace /requesting/project --input /request.json --policy /execution-host/model-policy.md [--config /roster.yaml] [--orca /absolute/orca] [--check-config]; audit prepare --workspace /project --role openai|gemini|xai|judge [--config /roster]; audit adopt --workspace /project --hash SNAPSHOT_SHA256 --run NATIVE_RUN --task NATIVE_TASK [--orca /absolute/orca]",
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
  let finalDiagnostic: DiagnosticSummary | undefined;
  const recordFailure = (cause: unknown) => {
    const next = cliDiagnostic(cause, "persistence");
    finalDiagnostic = finalDiagnostic ? retainDiagnostic(finalDiagnostic, next) : next;
  };
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
      canonicalJson(outcome) + "\n",
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
    recordFailure(error);
  } finally {
    try { cache?.close(); } catch (error) { recordFailure(error); }
    try { journal?.close(); } catch (error) { recordFailure(error); }
  }
  if (!outcome) throw new PilotDiagnosticError(finalDiagnostic ?? cliDiagnostic("NATIVE_OUTCOME_NOT_RECORDED", "persistence"));
  const operationalDiagnostic = outcome.diagnostic;
  const failOutcome = () => {
    outcome.status = "failed";
    // Rebuild from the operational failure so each persistence occurrence is counted once.
    outcome.diagnostic = operationalDiagnostic ? retainDiagnostic(operationalDiagnostic, finalDiagnostic!) : finalDiagnostic!;
    outcome.error = outcome.diagnostic.code;
  };
  if (finalDiagnostic) {
    failOutcome();
    if (record) {
      const target = record;
      // The initial snapshot is not a finalized failure record until replacement succeeds.
      record = undefined;
      const temporary = resolve(dirname(target), `outcome-${randomUUID()}.tmp`);
      let fd: number | undefined;
      let identity: { dev: number; ino: number } | undefined;
      let published = false;
      try {
        fd = openSync(temporary, "wx", 0o600);
        const stat = fstatSync(fd);
        identity = { dev: stat.dev, ino: stat.ino };
        writeFileSync(fd, canonicalJson(outcome) + "\n");
        renameSync(temporary, target);
        published = true;
        record = target;
      } catch (cause) {
        recordFailure(cause);
      } finally {
        if (fd !== undefined) {
          if (!published && identity) {
            try {
              const stat = lstatSync(temporary);
              // Keep the fd open through cleanup to retain the exclusively created inode.
              if (stat.isFile() && stat.dev === identity.dev && stat.ino === identity.ino) unlinkSync(temporary);
            } catch (cause) {
              let missing = false;
              try { missing = (cause as NodeJS.ErrnoException)?.code === "ENOENT"; } catch { /* Unreadable evidence is not absence. */ }
              if (!missing) recordFailure(cause);
            }
          }
          try { closeSync(fd); } catch (cause) { record = undefined; recordFailure(cause); }
        }
      }
      failOutcome();
    }
  }
  console.log(canonicalJson({ ...outcome, record: record ?? null }));
  if (outcome.status === "prerequisites_not_verified") process.exitCode = 3;
  else if (outcome.status === "invalid_request") process.exitCode = 2;
  else if (outcome.status === "failed") process.exitCode = 4;
}
/** Direct callers and the package entry share the same safe failure boundary. */
export async function runNativeCli(argv: readonly string[]): Promise<void> {
  try {
    await executeNativeCli([...argv]);
  } catch (error) {
    const diagnostic = cliDiagnostic(error instanceof z.ZodError ? Error("NATIVE_REQUEST_INVALID") : error, "validation");
    const reason = diagnostic.code;
    const busy = reason === "QUALIFICATION_CACHE_BUSY_RECONCILE";
    console.log(canonicalJson({
      version: 2,
      status: busy ? "prerequisites_not_verified" : "invalid_request",
      reason,
      diagnostic,
      ...(busy ? { calls: { probes: 0, topic: 0 } } : {}),
    }));
    process.exitCode = busy ? 3 : 2;
  }
}
function isDirectEntry(): boolean {
  try {
    return !!process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch { return false; }
}
if (isDirectEntry()) void runNativeCli(process.argv.slice(2));
