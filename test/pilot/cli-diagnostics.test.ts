import { it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { incidentRoster, policyTable } from "./fixtures.js";

const shippedEntry = resolve("dist/pilot/cli.js");

it("shipped entry excludes a missing-input canary", () => {
  const workspace = mkdtempSync(join(tmpdir(), "council-cli-diagnostics-"));
  try {
    const config = join(workspace, "council.json");
    const missingInput = join(workspace, "diag-exception-10-missing-input.json");
    const ownedPolicy = join(workspace, "model-policy.md");
    const ownedNeverRunOrca = join(workspace, "never-run-orca.cjs");
    const sentinelInvocation = join(workspace, "orca-invoked.json");

    writeFileSync(config, JSON.stringify(incidentRoster), {
      mode: 0o600,
      flag: "wx",
    });
    // Product policy fixture data; the worker follows its canonical host policy.
    writeFileSync(ownedPolicy, policyTable, { mode: 0o600, flag: "wx" });
    writeFileSync(
      ownedNeverRunOrca,
      `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(sentinelInvocation)}, "invoked\\n", { mode: 0o600, flag: "wx" });\nprocess.exit(97);\n`,
      { mode: 0o700, flag: "wx" },
    );
    expect(existsSync(missingInput)).toBe(false);

    const child = spawnSync(
      process.execPath,
      [
        shippedEntry,
        "--workspace",
        workspace,
        "--config",
        config,
        "--input",
        missingInput,
        "--policy",
        ownedPolicy,
        "--orca",
        ownedNeverRunOrca,
      ],
      { cwd: workspace, encoding: "utf8", timeout: 5000 },
    );

    expect(child.error).toBeUndefined();
    expect(child.signal).toBeNull();
    expect(child.status).toBe(2);
    expect(child.stderr).toBe("");
    const output = JSON.parse(child.stdout);
    expect(output.reason).toEqual(expect.any(String));

    expect(existsSync(missingInput)).toBe(false);
    expect(existsSync(sentinelInvocation)).toBe(false);
    expect(existsSync(join(workspace, ".council"))).toBe(false);
    expect(readdirSync(workspace).sort()).toEqual(
      ["council.json", "model-policy.md", "never-run-orca.cjs"].sort(),
    );
    expect(output.reason).not.toContain("diag-exception-10");
  } finally {
    rmSync(workspace, { recursive: true });
  }
}, 5000);

import { describe, vi, afterEach } from "vitest";
import { readFileSync, statSync, symlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { canonicalJson } from "../../dist/domain/hash.js";
import { runNativeCli } from "../../dist/pilot/cli.js";
import { runPilot } from "../../dist/pilot/workflow.js";
import { PilotJournal } from "../../dist/pilot/journal.js";
import { QualificationCache } from "../../dist/pilot/qualification-cache.js";
import { PilotDiagnosticError, fitDiagnosticSummary, projectDiagnostic } from "../../dist/pilot/diagnostics.js";
import { createNativePilotDriver } from "../../dist/pilot/composition.js";
import { contextFixture } from "./context-fixture.js";
import type { PilotOutcome } from "../../src/pilot/workflow.js";
import type { DiagnosticSummary } from "../../src/pilot/diagnostics.js";
import type { Attempt, NativeEvidence, PilotDriver, PilotRequest } from "../../src/pilot/types.js";
import type { Command } from "../../src/pilot/orca-driver.js";
import type { ScopedRpc } from "../../src/pilot/rpc.js";

type NativeInput = Parameters<typeof createNativePilotDriver>[0];
const offline = vi.hoisted(() => ({
  active: false,
  outcome: undefined as PilotOutcome | undefined,
  command: undefined as Command | undefined,
  evidence: undefined as NativeEvidence | undefined,
  rpc: undefined as ScopedRpc | undefined,
  factory: undefined as ((input: NativeInput) => PilotDriver) | undefined,
  writes: [] as { file: string; text: string; mode: number; inode: number }[],
  replacements: [] as { before: string; temporary: string; after: string; mode: number; inode: number; temporaryInode: number }[],
}));
vi.mock("../../dist/orca/client.js", async original => {
  const actual = await original<typeof import("../../dist/orca/client.js")>();
  return { ...actual, OrcaClient: {
    connect: (...args: Parameters<typeof actual.OrcaClient.connect>) =>
      offline.active ? Promise.resolve({} as Awaited<ReturnType<typeof actual.OrcaClient.connect>>) : actual.OrcaClient.connect(...args),
  } };
});
vi.mock("../../dist/pilot/native-command.js", async original => {
  const actual = await original<typeof import("../../dist/pilot/native-command.js")>();
  return { ...actual, commandFromClient: (...args: Parameters<typeof actual.commandFromClient>) =>
    offline.active ? offline.command! : actual.commandFromClient(...args) };
});
vi.mock("../../dist/pilot/discovery.js", async original => {
  const actual = await original<typeof import("../../dist/pilot/discovery.js")>();
  return { ...actual, NativeHostInspector: class {
    async inspect() {
      if (!offline.active || !offline.evidence) throw Error("offline inspector fixture is not armed");
      return { evidence: structuredClone(offline.evidence), blockers: [] };
    }
  } };
});
vi.mock("../../dist/pilot/rpc.js", async original => {
  const actual = await original<typeof import("../../dist/pilot/rpc.js")>();
  return { ...actual, LocalScopedRpc: class {
    callScoped(...args: Parameters<ScopedRpc["callScoped"]>) {
      if (!offline.active || !offline.rpc) throw Error("offline RPC fixture is not armed");
      return offline.rpc.callScoped(...args);
    }
  } };
});
vi.mock("../../dist/pilot/workflow.js", async original => {
  const actual = await original<typeof import("../../dist/pilot/workflow.js")>();
  return { ...actual, runPilot: async (...args: Parameters<typeof actual.runPilot>) => {
    const outcome = await actual.runPilot(...args);
    offline.outcome = outcome;
    return outcome;
  } };
});
vi.mock("../../dist/pilot/composition.js", async original => {
  const actual = await original<typeof import("../../dist/pilot/composition.js")>();
  return { ...actual, createNativePilotDriver: (input: NativeInput) =>
    offline.active && offline.factory ? offline.factory(input) : actual.createNativePilotDriver(input) };
});
vi.mock("node:fs", async original => {
  const actual = await original<typeof import("node:fs")>();
  return { ...actual,
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      actual.writeFileSync(...args);
      const file = String(args[0]);
      if (offline.active && /\/outcome(?:-[0-9a-f-]+\.tmp|\.json)$/.test(file)) {
        const stat = actual.statSync(file);
        offline.writes.push({ file, text: actual.readFileSync(file, "utf8"), mode: stat.mode & 0o777, inode: stat.ino });
      }
    },
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      const capture = offline.active && String(args[1]).endsWith("/outcome.json");
      const before = capture ? actual.readFileSync(args[1], "utf8") : "";
      const temporary = capture ? actual.readFileSync(args[0], "utf8") : "";
      const stat = capture ? actual.statSync(args[0]) : undefined;
      actual.renameSync(...args);
      if (capture) offline.replacements.push({ before, temporary, after: actual.readFileSync(args[1], "utf8"),
        mode: actual.statSync(args[1]).mode & 0o777, inode: actual.statSync(args[1]).ino, temporaryInode: stat!.ino });
    },
  };
});
afterEach(() => {
  offline.active = false; offline.outcome = undefined; offline.command = undefined; offline.evidence = undefined;
  offline.rpc = undefined; offline.factory = undefined;
  offline.writes.length = 0; offline.replacements.length = 0;
  vi.restoreAllMocks();
});

/** Extract original UTF-8 token spans; JSON parsing/reencoding never measures the cap. */
function diagnosticByteSpans(text: string): Buffer[] {
  const bytes = Buffer.from(text, "utf8");
  const spans: Buffer[] = [];
  let cursor = 0;
  const whitespace = () => { while ([9, 10, 13, 32].includes(bytes[cursor]!)) cursor++; };
  const string = () => {
    const start = cursor++;
    while (cursor < bytes.length) {
      const token = bytes[cursor++]!;
      if (token === 92) { cursor++; continue; }
      if (token === 34) return bytes.subarray(start, cursor);
    }
    throw Error("unterminated fixture JSON string");
  };
  const value = (): void => {
    whitespace();
    if (bytes[cursor] === 34) { string(); return; }
    if (bytes[cursor] === 123) {
      cursor++; whitespace();
      if (bytes[cursor] === 125) { cursor++; return; }
      while (cursor < bytes.length) {
        whitespace();
        if (bytes[cursor] !== 34) throw Error("expected fixture JSON property");
        const key = JSON.parse(string().toString("utf8"));
        whitespace();
        if (bytes[cursor++] !== 58) throw Error("expected fixture JSON colon");
        whitespace();
        const start = cursor;
        value();
        if (key === "diagnostic" && bytes[start] === 123) spans.push(bytes.subarray(start, cursor));
        whitespace();
        const token = bytes[cursor++];
        if (token === 125) return;
        if (token !== 44) throw Error("expected fixture JSON object separator");
      }
      throw Error("unterminated fixture JSON object");
    }
    if (bytes[cursor] === 91) {
      cursor++; whitespace();
      if (bytes[cursor] === 93) { cursor++; return; }
      while (cursor < bytes.length) {
        value(); whitespace();
        const token = bytes[cursor++];
        if (token === 93) return;
        if (token !== 44) throw Error("expected fixture JSON array separator");
      }
      throw Error("unterminated fixture JSON array");
    }
    const start = cursor;
    while (cursor < bytes.length && ![9, 10, 13, 32, 44, 93, 125].includes(bytes[cursor]!)) cursor++;
    if (start === cursor) throw Error("expected fixture JSON value");
  };
  value(); whitespace();
  if (cursor !== bytes.length) throw Error("unexpected trailing fixture JSON");
  return spans;
}

function boundarySummary(target: number): DiagnosticSummary {
  const core: DiagnosticSummary = {
    version: 1, origin: "provider", phase: "inference", code: "PROVIDER_STDERR_UNCLASSIFIED", classification: "protocol",
    inputDelivery: "acknowledged", exit: { state: "observed", code: 7, signal: null, signalState: "none" },
    counters: { stdoutBytes: 0, stdoutChunks: 1, stderrBytes: 8, stderrChunks: 2, exceptions: 0, unknownCodes: 0 },
    omissions: { stdout: false, stderr: true, exceptionText: true, initializationExtras: false, details: 0, countersSaturated: false },
    truncated: false, details: [],
  };
  const long = { origin: "context-driver", phase: "initialization", code: "QUALIFICATION_CACHE_NATIVE_EVIDENCE_UNVERIFIED" } as const;
  const short = { origin: "provider", phase: "input", code: "NONE" } as const;
  for (let count = 1; count <= 70; count++) {
    for (let longer = 0; longer <= count; longer++) for (let digits = 1; digits <= 10; digits++) {
      const candidate = { ...core, counters: { ...core.counters, stdoutBytes: 10 ** (digits - 1) },
        details: Array.from({ length: count }, (_, index) => index < longer ? long : short) };
      if (Buffer.byteLength(canonicalJson(candidate)) === target) return candidate;
    }
  }
  throw Error("no finite diagnostic boundary fixture at " + target);
}

function memoryDriver(workspace: string) {
  const observed = { state: "verified" as const, source: "offline native fixture", detail: "verified" };
  const evidence: NativeEvidence = {
    host: "offline-host", runtimeId: "offline-runtime", orcaVersion: "1", versions: { orca: "1", codex: "1", antigravity: "1", cursor: "1" },
    roots: [workspace], workspace, workspaceId: "repo::" + workspace, action: "supplied-packet-read-only", policyHash: "policy", controlsHash: "controls",
    routes: [...Object.entries(incidentRoster.reviewers), ["judge", incidentRoster.judge]].map(([role, selection]) => ({
      role: role as Attempt["role"], selection: selection as Attempt["selection"], version: "1", catalog: observed, controls: observed,
      allowance: { ...observed, state: "unknown" }, billing: observed, optionalTelemetry: { ...observed, state: "unknown" },
    })),
  };
  const assessment = "requested-result-10-秘密" + "認".repeat(1500);
  const launched: Attempt[] = [], cancelled: string[] = [], released: string[] = [];
  const driver: PilotDriver = {
    inspect: async () => ({ evidence, blockers: [] }), begin: async () => "offline-native-run",
    launch: async (_run, _request, role, phase, _packet, key) => {
      const number = launched.length + 1;
      const a: Attempt = { binding: { runId: "offline-native-run", taskId: "task-" + number, dispatchId: "dispatch-" + number, handle: "handle-" + number, attemptKey: key },
        role, phase, selection: role === "judge" ? incidentRoster.judge : incidentRoster.reviewers[role],
        packetHash: "packet-" + number, launchVerified: true, inferenceStarted: true, initializations: 1 };
      launched.push(a); return a;
    },
    observe: async a => ({ binding: a.binding, packetHash: a.packetHash, role: a.role, phase: a.phase,
      payload: a.phase === "review" ? { assessment, objections: [] }
        : a.phase === "judge" ? { evidenceSupported: true, unresolved: [] }
        : a.phase === "ballot" ? { approve: true, reason: "Evidence" } : { ready: true },
      settlement: "unknown", source: "offline native result", sourceIdentity: "offline-result", provider: a.selection.route }),
    cancel: async a => { cancelled.push(a.binding.dispatchId); return { state: "settled", stop: { dispatchId: a.binding.dispatchId, requestId: randomUUID(), state: "stopped" } }; },
    release: async a => { released.push(a.binding.dispatchId); return true; },
  };
  return { evidence, driver, assessment, launched, cancelled, released };
}

async function withCli(body: (f: { workspace: string; argv: string[]; input: Record<string, unknown>;
  h: ReturnType<typeof memoryDriver>; printed: () => string; invoke: () => Promise<void> }) => Promise<void>) {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "cli-direct-diagnostics-")));
  const previousExit = process.exitCode;
  let capture: ReturnType<typeof vi.spyOn> | undefined;
  try {
    const config = join(workspace, "council.json"), inputPath = join(workspace, "request.json"), policy = join(workspace, "model-policy.md");
    const input = { runId: "offline-" + randomUUID(), candidate: "Use JSON.", suppliedText: "One immutable manifest.",
      maxProbeCalls: 8, maxTopicCalls: 10, deadline: Date.now() + 100000, workerTimeoutMs: 1000 };
    writeFileSync(config, JSON.stringify(incidentRoster), { flag: "wx", mode: 0o600 });
    writeFileSync(inputPath, JSON.stringify(input), { flag: "wx", mode: 0o600 });
    writeFileSync(policy, policyTable, { flag: "wx", mode: 0o600 });
    const argv = ["--workspace", workspace, "--config", config, "--input", inputPath, "--policy", policy, "--orca", join(workspace, "offline-orca")];
    const h = memoryDriver(workspace);
    offline.active = true; offline.command = async () => { throw Error("unexpected offline command"); };
    offline.evidence = h.evidence;
    offline.factory = input => ({ ...h.driver, inspect: request => input.inspector.inspect(request) });
    let printed = "";
    capture = vi.spyOn(console, "log").mockImplementation((text: unknown) => { printed += String(text) + "\n"; });
    await body({ workspace, argv, input, h, printed: () => printed, invoke: () => runNativeCli(argv) });
  } finally {
    process.exitCode = previousExit;
    capture?.mockRestore();
    offline.active = false;
    rmSync(workspace, { recursive: true });
  }
}

function assertRecorded(text: string) {
  const spans = diagnosticByteSpans(text);
  for (const span of spans) {
    expect(span.length).toBeLessThanOrEqual(4096);
    expect(span.equals(Buffer.from(canonicalJson(JSON.parse(span.toString("utf8")))))).toBe(true);
    expect(span.includes(Buffer.from("\n"))).toBe(false);
  }
  return spans;
}

describe("actual direct CLI persistence", () => {
  it("resolves a pre-outcome error with one compact safe version 2 failure", async () => {
    await withCli(async f => {
      const args = Object.freeze([...f.argv, "--diag-exception-10"]);
      await expect(runNativeCli(args)).resolves.toBeUndefined();
      const output = JSON.parse(f.printed());
      expect(output).toMatchObject({ version: 2, status: "invalid_request", reason: "INVALID_NATIVE_ARGUMENTS",
        diagnostic: { origin: "cli", phase: "validation", code: "INVALID_NATIVE_ARGUMENTS" } });
      expect(f.printed()).toBe(canonicalJson(output) + "\n");
      expect(f.printed()).not.toContain("diag-exception-10");
      expect(process.exitCode).toBe(2);
      expect(existsSync(join(f.workspace, ".council"))).toBe(false);
    });
  });

  it("projects Zod input issues before discarding their text", async () => {
    await withCli(async f => {
      const inputPath = f.argv[f.argv.indexOf("--input") + 1]!;
      writeFileSync(inputPath, JSON.stringify({ ...f.input, "diag-exception-10": true }));
      await f.invoke();
      expect(JSON.parse(f.printed())).toMatchObject({ version: 2, status: "invalid_request", reason: "NATIVE_REQUEST_INVALID",
        diagnostic: { classification: "validation", omissions: { exceptionText: true }, counters: { exceptions: 1 } } });
      expect(f.printed()).not.toContain("diag-exception-10");
      expect(process.exitCode).toBe(2);
      expect(existsSync(join(f.workspace, ".council"))).toBe(false);
    });
  });

  it("keeps cache-busy zero-call prerequisites and exit 3", async () => {
    await withCli(async f => {
      const owner = new QualificationCache(f.workspace);
      try {
        await expect(f.invoke()).resolves.toBeUndefined();
        expect(JSON.parse(f.printed())).toMatchObject({ version: 2, reason: "QUALIFICATION_CACHE_BUSY_RECONCILE",
          status: "prerequisites_not_verified", calls: { probes: 0, topic: 0 }, diagnostic: { classification: "control" } });
        expect(process.exitCode).toBe(3);
        expect(existsSync(join(f.workspace, ".council/native"))).toBe(false);
      } finally { owner.close(); }
    });
  });

  it.each(["cache-write", "cache-close", "journal-close"] as const)("retains a safe failed outcome after %s canary", async failure => {
    await withCli(async f => {
      const closeCache = QualificationCache.prototype.close, closeJournal = PilotJournal.prototype.close;
      if (failure === "cache-write") vi.spyOn(QualificationCache.prototype, "write").mockImplementation(() => { throw Error("diag-exception-10"); });
      if (failure === "cache-close") vi.spyOn(QualificationCache.prototype, "close").mockImplementation(function(this: QualificationCache) { closeCache.call(this); throw Error("diag-exception-10"); });
      if (failure === "journal-close") vi.spyOn(PilotJournal.prototype, "close").mockImplementation(function(this: PilotJournal) { closeJournal.call(this); throw Error("diag-exception-10"); });
      await expect(f.invoke()).resolves.toBeUndefined();
      const output = JSON.parse(f.printed()), savedText = readFileSync(output.record, "utf8"), saved = JSON.parse(savedText);
      expect(saved).toMatchObject({ version: 2, status: "failed", error: "DIAGNOSTIC_UNKNOWN",
        diagnostic: { code: "DIAGNOSTIC_UNKNOWN", origin: "cli", phase: "persistence", omissions: { exceptionText: true } } });
      expect(output.diagnostic).toEqual(saved.diagnostic);
      expect(output.results).toEqual(saved.results);
      expect(saved.results.filter((r: any) => r.phase === "review").map((r: any) => r.payload))
        .toEqual(Array(3).fill({ assessment: f.h.assessment, objections: [] }));
      expect(savedText + f.printed()).not.toContain("diag-exception-10");
      expect(savedText).toBe(canonicalJson(saved) + "\n");
      expect(f.printed()).toBe(canonicalJson(output) + "\n");
      expect(process.exitCode).toBe(4);
      expect(offline.writes).toHaveLength(2);
      expect(offline.writes.every(w => w.mode === 0o600)).toBe(true);
      expect(JSON.parse(offline.writes[0]!.text).status).toBe("consensus");
      expect(offline.replacements).toHaveLength(1);
      expect(offline.replacements[0]).toMatchObject({ before: offline.writes[0]!.text, temporary: savedText, after: savedText, mode: 0o600 });
      expect(offline.replacements[0]!.inode).toBe(offline.replacements[0]!.temporaryInode);
      expect(statSync(output.record).mode & 0o777).toBe(0o600);
      expect(readdirSync(join(f.workspace, ".council/native-qualifications"))).not.toContain("writer.lock");
      assertRecorded(savedText); assertRecorded(f.printed());
    });
  });

  it.each([undefined, null, false])("retains a post-outcome failure even when its thrown value is %s", async cause => {
    await withCli(async f => {
      const close = QualificationCache.prototype.close;
      vi.spyOn(QualificationCache.prototype, "close").mockImplementation(function(this: QualificationCache) { close.call(this); throw cause; });
      await f.invoke();
      const output = JSON.parse(f.printed());
      expect(output).toMatchObject({ version: 2, status: "failed", error: "DIAGNOSTIC_UNKNOWN" });
      expect(process.exitCode).toBe(4);
      expect(JSON.parse(readFileSync(output.record, "utf8")).diagnostic).toEqual(output.diagnostic);
    });
  });

  it("preserves requested review results beyond the diagnostic byte cap", async () => {
    await withCli(async f => {
      const actualObserve = f.h.driver.observe;
      const returned: unknown[] = [];
      f.h.driver.observe = async (...args) => { const result = await actualObserve(...args); if (result.phase === "review") returned.push(result.payload); return result; };
      // Re-arm because the factory above copies the driver only when invoked.
      await f.invoke();
      const output = JSON.parse(f.printed()), saved = JSON.parse(readFileSync(output.record, "utf8"));
      expect(Buffer.byteLength(f.h.assessment)).toBeGreaterThan(4096);
      const expected = Array(3).fill({ assessment: f.h.assessment, objections: [] });
      expect(returned).toEqual(expected);
      expect(offline.outcome!.results.filter(r => r.phase === "review").map(r => r.payload)).toEqual(expected);
      expect(output.results.filter((r: any) => r.phase === "review").map((r: any) => r.payload)).toEqual(expected);
      expect(saved.results.filter((r: any) => r.phase === "review").map((r: any) => r.payload)).toEqual(expected);
      expect(output.status).toBe("consensus");
    });
  });

  it.each([4095, 4096, 4097])("measures raw diagnostic tokens across initial/atomic/stdout at %i bytes", async target => {
    await withCli(async f => {
      const candidate = boundarySummary(target);
      expect(Buffer.byteLength(canonicalJson(candidate))).toBe(target);
      const fitted = fitDiagnosticSummary(candidate);
      offline.factory = () => ({ ...f.h.driver, inspect: async () => { throw new PilotDiagnosticError(fitted); } });
      const close = QualificationCache.prototype.close;
      vi.spyOn(QualificationCache.prototype, "close").mockImplementation(function(this: QualificationCache) { close.call(this); throw new PilotDiagnosticError(fitted); });
      await f.invoke();
      const output = JSON.parse(f.printed()), savedText = readFileSync(output.record, "utf8");
      expect(offline.writes).toHaveLength(2);
      const texts = [offline.writes[0]!.text, offline.writes[1]!.text, savedText, f.printed()];
      for (const text of texts) {
        const spans = assertRecorded(text);
        expect(spans).toHaveLength(1);
        if (target <= 4096) expect(spans[0]!.length).toBe(target);
        else {
          expect(JSON.parse(spans[0]!.toString())).toMatchObject({ truncated: true, omissions: { details: 1 } });
        }
        expect(JSON.parse(spans[0]!.toString())).toEqual(fitted);
      }
      expect(output.status).toBe("failed");
      expect(output.error).toBe("PROVIDER_STDERR_UNCLASSIFIED");
      expect(process.exitCode).toBe(4);
      expect(offline.replacements[0]!.before).toBe(offline.writes[0]!.text);
      expect(offline.replacements[0]!.after).toBe(savedText);
    });
  });

  it("scans escaped strings, nested objects and multibyte JSON without mistaking result text for a diagnostic", () => {
    const raw = '{"result":"秘密 \\"diagnostic\\": { \\"x\\": 1 }","nested":[{"diagnostic":{"a":"} \\" { 秘密","b":{"c":[1,2]}}}]}';
    expect(diagnosticByteSpans(raw).map(b => b.toString())).toEqual(['{"a":"} \\" { 秘密","b":{"c":[1,2]}}']);
  });
});

const waitWithin = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error("owned context fixture close deadline")), ms);
    })]);
  } finally { clearTimeout(timer); }
};
function assertAbsent(pid: number) {
  let code: unknown;
  try { process.kill(pid, 0); } catch (cause) { code = (cause as NodeJS.ErrnoException).code; }
  expect(code).toBe("ESRCH");
}

it.each(["exit", "signal"] as const)("retains acknowledged-input failed observe across journal workflow and CLI (%s)", async termination => {
  // All four production composition layers and their diagnostic constructors
  // come from the same freshly built dist graph. Source imports above are types.
  const realComposition = await vi.importActual<typeof import("../../dist/pilot/composition.js")>("../../dist/pilot/composition.js");
  for (const throughCli of [false, true]) {
    const h = await contextFixture("normal");
    let journal: PilotJournal | undefined;
    let stdout: ReturnType<typeof vi.spyOn> | undefined;
    const previousExit = process.exitCode;
    const closes = new Map<string, Promise<void>>();
    let captured: unknown, attempt: Attempt | undefined;
    try {
      const provider = join(h.root, "acknowledged-failure.cjs");
      writeFileSync(provider, [
        'const readline=require("node:readline");',
        termination === "exit" ? 'process.on("SIGTERM",()=>process.exit(7));' : '',
        'const emit=value=>process.stdout.write(JSON.stringify(value)+"\\n");',
        'emit({event:"init",init:{model:process.argv[2],cwd:process.cwd(),tools:[],permission_mode:"request-review"}});',
        'readline.createInterface({input:process.stdin}).once("line",()=>{',
        'emit({event:"step_update",step_update:{step_type:"user_input",state:"DONE",step_index:0,conversation_id:"synthetic-session"}});',
        'process.stderr.write("diag-stderr-a-10\\n",()=>process.stderr.write("diag-stderr-b-10\\n",()=>{',
        termination === "exit" ? 'process.exit(7);' : 'process.kill(process.pid,"SIGTERM");',
        '}));});',
      ].join("\n"), { mode: 0o600, flag: "wx" });
      const gemini = h.evidence.routes.find(r => r.role === "gemini")!;
      gemini.recipe!.argv = [provider, gemini.selection.model];
      h.evidence.routes = [gemini, ...h.evidence.routes.filter(r => r !== gemini)];
      const rpc: ScopedRpc = { callScoped: async (method, parameters) => {
        const receipt = await h.rpc.callScoped(method, parameters);
        if (method === "terminal.create") {
          const child = h.terminals.get(receipt.terminal.handle)!.child;
          closes.set(receipt.terminal.handle, new Promise<void>(resolve => child.once("close", () => resolve())));
        }
        return receipt;
      } };
      const instrument = (driver: PilotDriver) => {
        const launch = driver.launch.bind(driver), observe = driver.observe.bind(driver);
        driver.launch = async (...args) => { attempt = await launch(...args); return attempt; };
        driver.observe = async (...args) => { try { return await observe(...args); } catch (cause) { captured = cause; throw cause; } };
        return driver;
      };
      const input = { runId: "bound-" + randomUUID(), candidate: "Use JSON.", suppliedText: "The supplied manifest.",
        maxProbeCalls: 8, maxTopicCalls: 10, deadline: Date.now() + 30000, workerTimeoutMs: 5000 };
      let outcome: PilotOutcome;
      let printed = "";
      if (throughCli) {
        const config = join(h.workspace, "council.json"), request = join(h.workspace, "request.json"), policy = join(h.workspace, "model-policy.md");
        writeFileSync(config, JSON.stringify(incidentRoster), { flag: "wx", mode: 0o600 });
        writeFileSync(request, JSON.stringify(input), { flag: "wx", mode: 0o600 });
        writeFileSync(policy, policyTable, { flag: "wx", mode: 0o600 });
        offline.active = true; offline.command = h.command; offline.evidence = h.evidence; offline.rpc = rpc;
        offline.factory = input => instrument(realComposition.createNativePilotDriver(input));
        stdout = vi.spyOn(console, "log").mockImplementation((text: unknown) => { printed += String(text) + "\n"; });
        await runNativeCli(["--workspace", h.workspace, "--config", config, "--input", request, "--policy", policy, "--orca", h.orca]);
        outcome = JSON.parse(printed);
        expect(process.exitCode).toBe(4);
        const savedText = readFileSync((outcome as any).record, "utf8"), saved = JSON.parse(savedText);
        expect(saved).toEqual(offline.outcome);
        expect(saved.diagnostic).toEqual(outcome.diagnostic);
        expect(assertRecorded(savedText)[0]).toEqual(assertRecorded(printed)[0]);
        expect(savedText + printed).not.toMatch(/diag-stderr|diag-exception/);
        expect(statSync((outcome as any).record).mode & 0o777).toBe(0o600);
        journal = undefined;
      } else {
        journal = new PilotJournal(h.workspace, input.runId, { ...input, proofTtlMs: 3600000, configHash: "offline-config" });
        const driver = instrument(realComposition.createNativePilotDriver({
          command: h.command, inspector: { inspect: async () => ({ evidence: h.evidence, blockers: [] }) },
          rpc: () => rpc, orca: h.orca, record: event => { h.events.push(event); journal!.append(event); },
        }));
        outcome = await runPilot({ workspace: h.workspace, config: incidentRoster, policyPath: "/offline-policy", ...input, proofs: [] }, journal.wrap(driver));
      }
      expect(attempt).toMatchObject({ launchVerified: true, inferenceStarted: true, initializations: 1 });
      expect(captured).toBeInstanceOf(PilotDiagnosticError);
      const diagnostic = (captured as PilotDiagnosticError).diagnostic;
      expect((captured as PilotDiagnosticError).message).toBe("PROVIDER_STDERR_UNCLASSIFIED");
      expect(diagnostic).toMatchObject({ origin: "provider", phase: "inference", code: "PROVIDER_STDERR_UNCLASSIFIED",
        inputDelivery: "acknowledged", exit: { state: "observed", code: termination === "exit" ? 7 : null,
          signal: termination === "signal" ? "SIGTERM" : null, signalState: termination === "signal" ? "observed" : "none" } });
      expect(outcome).toMatchObject({ version: 2, status: "failed", calls: { probes: 1, topic: 0 },
        error: "PROVIDER_STDERR_UNCLASSIFIED", diagnostic, proofs: [], unresolved: [], pendingMutations: [] });
      const directory = attempt!.context!.directory;
      const report = JSON.parse(readFileSync(join(directory, "result.json"), "utf8"));
      expect(report.diagnostic).toEqual(diagnostic);
      expect(outcome.diagnostic).toEqual(report.diagnostic);
      expect(report).toMatchObject({ calls: 1, result: null, process: { inputDelivered: true, closed: true, groupSettled: true,
        trackedDescendantsSettled: true, parsingSettled: true, processScansSettled: true, timersSettled: true } });
      const journalPath = throughCli ? join(h.workspace, ".council/native", input.runId) : journal!.path;
      const eventsText = readFileSync(join(journalPath, "events.jsonl"), "utf8");
      expect(eventsText).not.toMatch(/diag-stderr|diag-exception/);
      const events = eventsText.trim().split("\n").map(line => JSON.parse(line).event);
      expect(events.find(event => event.event === "observation-unknown")?.diagnostic).toEqual(diagnostic);
      expect(events.filter(event => event.event === "attempt-reserved")).toHaveLength(1);
      expect(events.filter(event => event.event === "cancel-reserved")).toHaveLength(1);
      expect(events.filter(event => event.event === "release-reserved")).toHaveLength(1);
      expect(events.find(event => event.event === "release-observed")?.released).toBe(true);
      expect(h.terminals.size).toBe(1);
      expect(h.events.filter(event => event.method === "terminal.close")).toHaveLength(1);
      const cleanup = JSON.parse(readFileSync(join(directory, "cleanup.json"), "utf8"));
      expect(cleanup).toMatchObject({ wrapperExit: true, close: { handle: attempt!.binding.handle, ptyKilled: true } });
      expect(existsSync(join(directory, "inference-started.json"))).toBe(true);
      const terminal = h.terminals.get(attempt!.binding.handle)!;
      await waitWithin(closes.get(attempt!.binding.handle)!, 7000);
      expect(terminal.closed).toBe(true);
      expect(terminal.child.stdout!.readableEnded).toBe(true);
      expect(terminal.child.stderr!.readableEnded).toBe(true);
      assertAbsent(terminal.child.pid!);
      assertAbsent(report.process.pid);
      assertAbsent(-report.process.pid);
    } finally {
      offline.active = false; offline.factory = undefined; offline.rpc = undefined;
      process.exitCode = previousExit;
      stdout?.mockRestore();
      try { journal?.close(); } finally {
        // Complete the original bound attempt even when an assertion fails.
        for (const [handle, terminal] of h.terminals) {
          if (terminal.child.exitCode === null && terminal.child.signalCode === null && attempt?.context) {
            const file = join(attempt.context.directory, "cancel.json");
            if (!existsSync(file)) writeFileSync(file, JSON.stringify({ binding: attempt.binding, requestId: randomUUID(), deadline: Date.now() + 5000 }), { mode: 0o600, flag: "wx" });
          }
          await waitWithin(closes.get(handle)!, 7000);
        }
        await h.close();
      }
    }
  }
}, 15000);

it("imports the shipped CLI without running it and preserves a direct symlinked help entry", () => {
  const workspace = mkdtempSync(join(tmpdir(), "cli-entry-diagnostics-"));
  try {
    const imported = spawnSync(process.execPath, ["--input-type=module", "--eval",
      `await import(${JSON.stringify(pathToFileURL(shippedEntry).href)}); console.log("imported");`],
      { cwd: workspace, encoding: "utf8", timeout: 5000 });
    expect(imported.error).toBeUndefined();
    expect(imported.status).toBe(0);
    expect(imported.stdout).toBe("imported\n");
    expect(imported.stderr).toBe("");
    const link = join(workspace, "native-cli.js");
    symlinkSync(shippedEntry, link);
    const help = spawnSync(process.execPath, [link, "--help"], { cwd: workspace, encoding: "utf8", timeout: 5000 });
    expect(help.error).toBeUndefined();
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Council native pilot:");
    expect(help.stderr).toBe("");
    expect(existsSync(join(workspace, ".council"))).toBe(false);
  } finally { rmSync(workspace, { recursive: true }); }
}, 5000);
