import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PilotJournal } from "../../src/pilot/journal.js";
import { PilotDiagnosticError, parseDiagnosticSummary, projectDiagnostic } from "../../src/pilot/diagnostics.js";
import type { Attempt, PilotDriver, PilotRequest } from "../../src/pilot/types.js";

const canary = "journal-private-exception-秘密";
const extra = "journal-native-extra-秘密";
const binding = { runId: "native-run", taskId: "task-5", dispatchId: "dispatch-5", handle: "terminal-5", attemptKey: "attempt-5" };
const selection = { route: "codex", model: "gpt-6.1-sol", effort: "max" } as const;
const bounds = { runId: "journal-5", maxProbeCalls: 8, maxTopicCalls: 10, deadline: 1800000000000,
  workerTimeoutMs: 1000, proofTtlMs: 10000, configHash: "a".repeat(64) };
const request = {} as PilotRequest;
const attempt: Attempt = { binding, role: "openai", phase: "review", selection, packetHash: "packet-5", launchVerified: true,
  context: { directory: "/owned/fixture", assignmentHash: "b".repeat(64) }, inferenceStarted: true, initializations: 1 };

function fakeDriver(overrides: Partial<PilotDriver> = {}): PilotDriver {
  const unused = async (): Promise<never> => { throw Error("unused fixture method"); };
  return { inspect: unused, begin: async () => "native-run", launch: async () => attempt,
    observe: unused, cancel: unused, release: unused, ...overrides };
}

// Acquisition immediately enters cleanup; a cleanup failure never replaces the first failure.
async function withJournal(run: (journal: PilotJournal, workspace: string) => Promise<void>) {
  const workspace = mkdtempSync(join(tmpdir(), "pilot-journal-diagnostics-"));
  let journal: PilotJournal | undefined;
  let failed = false;
  let failure: unknown;
  try {
    journal = new PilotJournal(workspace, "journal-5", { ...bounds, extra });
    await run(journal, workspace);
  } catch (error) { failed = true; failure = error; }
  finally {
    try { journal?.close(); } catch (error) { if (!failed) { failed = true; failure = error; } }
    try { rmSync(workspace, { recursive: true, force: true }); }
    catch (error) { if (!failed) { failed = true; failure = error; } }
    if (!failed && existsSync(workspace)) { failed = true; failure = Error("fixture cleanup incomplete"); }
  }
  if (failed) throw failure;
}

function journalBytes(journal: PilotJournal) {
  return readFileSync(join(journal.path, "events.jsonl"), "utf8");
}
function records(journal: PilotJournal) {
  return journalBytes(journal).trim().split("\n").map(line => JSON.parse(line));
}
async function launch(driver: PilotDriver) {
  return driver.launch("native-run", request, "openai", "review", "packet", "attempt-5");
}

// These regressions catch whole-object serialization of real driver results.
it("projects the actual attempt-bound JSONL before retaining unchecked control text or nested extras", async () => {
  await withJournal(async journal => {
    const unchecked = { ...attempt, binding: { ...binding, extra }, selection: { ...selection, extra },
      context: { ...attempt.context, extra }, controlError: canary, extra } as unknown as Attempt;
    const driver = journal.wrap(fakeDriver({ launch: async () => unchecked }));
    await driver.begin(request);
    await launch(driver);
    const line = journalBytes(journal).trim().split("\n").at(-1)!;
    expect(line).not.toContain(canary);
    expect(line).not.toContain(extra);
    const persisted = JSON.parse(line);
    expect(persisted.version).toBe(2);
    expect(persisted.event.attempt).toEqual({ ...attempt, controlError: "DIAGNOSTIC_UNKNOWN" });
    expect(records(journal).find(record => record.event.event === "attempt-reserved").event)
      .toMatchObject({ runId: "native-run", key: "attempt-5", mutationRequestId: expect.stringMatching(/^[a-f0-9-]{36}$/) });
  });
});

it("projects the actual cancel-observed JSONL instead of retaining cancellation text", async () => {
  await withJournal(async journal => {
    const driver = journal.wrap(fakeDriver({
      cancel: async () => ({ state: "settled_unacknowledged", error: canary, extra }) as never,
    }));
    const a = await launch(driver);
    await driver.cancel(a, 1800000000000);
    const line = journalBytes(journal).trim().split("\n").at(-1)!;
    expect(line).not.toContain(canary);
    expect(line).not.toContain(extra);
    expect(JSON.parse(line)).toMatchObject({ version: 2, event: {
      event: "cancel-observed", binding, result: { state: "settled_unacknowledged", error: "DIAGNOSTIC_UNKNOWN" },
    } });
    expect(records(journal).at(-2).event).toMatchObject({ event: "cancel-reserved", binding,
      mutationRequestId: expect.stringMatching(/^[a-f0-9-]{36}$/) });
  });
});

it("keeps failed run creation as one complete summary and the original reserved UUID", async () => {
  await withJournal(async journal => {
    const driver = journal.wrap(fakeDriver({ begin: async () => {
      throw Object.assign(Error(canary), { code: "runtime_timeout", extra });
    } }));
    const error = await driver.begin(request).catch(cause => cause);
    const events = records(journal);
    const reserved = events.find(record => record.event.event === "run-reserved").event;
    const unknown = events.at(-1).event;
    expect(error).toBeInstanceOf(PilotDiagnosticError);
    expect(error.message).toBe("NATIVE_RUN_CREATION_OUTCOME_UNKNOWN");
    expect(error.mutationRequestId).toBe(reserved.mutationRequestId);
    expect(error.cause).toBeUndefined();
    expect(unknown).toMatchObject({ event: "run-creation-unknown", mutationRequestId: reserved.mutationRequestId });
    expect(parseDiagnosticSummary(unknown.diagnostic)).toMatchObject({ version: 1, origin: "journal", phase: "bootstrap",
      code: "NATIVE_RUN_CREATION_OUTCOME_UNKNOWN", details: [
        { origin: "journal", phase: "bootstrap", code: "runtime_timeout" },
      ] });
    expect(error.diagnostic).toEqual(unknown.diagnostic);
    expect(journalBytes(journal)).not.toContain(canary);
    expect(journalBytes(journal)).not.toContain(extra);
  });
});

it("leaves an existing journal byte-identical after duplicate construction and keeps restrictive modes", async () => {
  await withJournal(async (journal, workspace) => {
    const bytes = journalBytes(journal);
    const digest = createHash("sha256").update(bytes).digest("hex");
    expect(() => new PilotJournal(workspace, "journal-5", bounds)).toThrow("NATIVE_RUN_EXISTS_INSPECT_REQUIRED");
    expect(journalBytes(journal)).toBe(bytes);
    expect(createHash("sha256").update(journalBytes(journal)).digest("hex")).toBe(digest);
    for (const directory of [join(workspace, ".council"), join(workspace, ".council", "native"), journal.path])
      expect(statSync(directory).mode & 0o777).toBe(0o700);
    expect(statSync(join(journal.path, "events.jsonl")).mode & 0o777).toBe(0o600);
  });
});


// A missing boundary projection would persist both the payload and forged nested identities.
it("retains only result completion identity and leaves the validated payload with the caller", async () => {
  await withJournal(async journal => {
    const payload = { assessment: "requested-result-秘密".repeat(1000), objections: [] };
    const driver = journal.wrap(fakeDriver({ observe: async () => ({
      binding, packetHash: "packet-5", phase: "review", role: "openai", payload,
      settlement: "unknown", source: "native Task.result bound host artifact", sourceIdentity: "completion-5", provider: "codex", extra,
    }) }));
    const a = await launch(driver);
    const result = await driver.observe(a, 1800000000000);
    expect(result.payload).toEqual(payload);
    expect(records(journal).at(-1)).toMatchObject({ version: 2, event: { event: "result-bound", binding,
      packetHash: "packet-5", phase: "review", role: "openai", source: "native Task.result bound host artifact", sourceIdentity: "completion-5" } });
    expect(journalBytes(journal)).not.toContain("requested-result-秘密");
    expect(journalBytes(journal)).not.toContain(extra);
  });
});

it.each(["launch", "observe", "cancel", "release"] as const)("wraps raw %s exceptions without retaining their messages or causes", async method => {
  await withJournal(async journal => {
    const fail = async (): Promise<never> => { throw Object.assign(Error(canary), { privatePayload: extra }); };
    const driver = journal.wrap(fakeDriver({ [method]: fail }));
    const a = method === "launch" ? attempt : await launch(driver);
    const error = await (method === "launch" ? launch(driver)
      : method === "observe" ? driver.observe(a, 1800000000000)
      : method === "cancel" ? driver.cancel(a, 1800000000000)
      : driver.release(a, 1800000000000)).catch(cause => cause);
    expect(error).toBeInstanceOf(PilotDiagnosticError);
    expect(error.message).toBe("DIAGNOSTIC_UNKNOWN");
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain(canary);
    expect(JSON.stringify(error)).not.toContain(extra);
    expect(error.diagnostic.omissions.exceptionText).toBe(true);
    expect(parseDiagnosticSummary(error.diagnostic)).toEqual(error.diagnostic);
    if (method === "observe") expect(records(journal).at(-1).event).toEqual({
      event: "observation-unknown", binding, diagnostic: error.diagnostic,
    });
    expect(journalBytes(journal)).not.toContain(canary);
    expect(journalBytes(journal)).not.toContain(extra);
  });
});

it.each(["launch", "observe", "cancel", "release"] as const)("preserves a validated %s carrier summary and its owned UUID", async method => {
  await withJournal(async journal => {
    const diagnostic = projectDiagnostic("runtime_timeout", { origin: "native-driver", phase: "cleanup" });
    const uuid = "b8cfe79e-83aa-4ab7-98fe-ae67f518ff32";
    const failure = new PilotDiagnosticError(diagnostic, uuid);
    const fail = async (): Promise<never> => { throw failure; };
    const driver = journal.wrap(fakeDriver({ [method]: fail }));
    const a = method === "launch" ? attempt : await launch(driver);
    const error = await (method === "launch" ? launch(driver)
      : method === "observe" ? driver.observe(a, 1800000000000)
      : method === "cancel" ? driver.cancel(a, 1800000000000)
      : driver.release(a, 1800000000000)).catch(cause => cause);
    expect(error).toBeInstanceOf(PilotDiagnosticError);
    expect(error.diagnostic).toEqual(diagnostic);
    expect(error.mutationRequestId).toBe(uuid);
    expect(error.cause).toBeUndefined();
  });
});

it("preserves safe rejection-before-mutation classification and its durable launch reservation", async () => {
  await withJournal(async journal => {
    const driver = journal.wrap(fakeDriver({ launch: async () => { throw Error("NATIVE_PACKET_ARGUMENT_TOO_LARGE"); } }));
    await expect(launch(driver)).rejects.toMatchObject({ message: "NATIVE_PACKET_ARGUMENT_TOO_LARGE" });
    const events = records(journal);
    expect(events.at(-2).event).toMatchObject({ event: "attempt-reserved", runId: "native-run", role: "openai", phase: "review", key: "attempt-5" });
    expect(events.at(-1).event).toMatchObject({ event: "launch-rejected-before-mutation", mutationRequestId: events.at(-2).event.mutationRequestId });
  });
});

it("rejects an unsupported name without copying it or its payload into JSONL", async () => {
  await withJournal(async journal => {
    expect(() => journal.append({ event: canary, payload: extra })).toThrow(PilotDiagnosticError);
    expect(records(journal).at(-1).event).toEqual({ event: "diagnostic-event-rejected",
      diagnostic: expect.objectContaining({ version: 1, code: "NATIVE_JOURNAL_EVENT_UNSUPPORTED" }) });
    expect(journalBytes(journal)).not.toContain(canary);
    expect(journalBytes(journal)).not.toContain(extra);
  });
});

it.each([
  { event: "attempt-bound", attempt: { ...attempt, binding: { runId: "native-run" } } },
  { event: "wrapper-native-bound", attempt, identity: { handle: "terminal-5" } },
  { event: "attempt-reserved", key: "incomplete-reservation" },
  { event: "bounds-recorded-before-inference", bounds: { deadline: 1 }, owned: [] },
  { event: "attempt-bound", attempt: { ...attempt, diagnostic: { version: 1, privatePayload: extra } } },
])("rejects malformed $event with a finite record instead of Zod issue text", async event => {
  await withJournal(async journal => {
    const error = (() => { try { journal.append({ ...event, privatePayload: canary }); } catch (cause) { return cause; } })();
    expect(error).toBeInstanceOf(PilotDiagnosticError);
    expect(error).toMatchObject({ message: "NATIVE_REQUEST_INVALID" });
    if (!(error instanceof PilotDiagnosticError)) throw Error("missing safe error");
    expect(records(journal).at(-1).event).toEqual({ event: "diagnostic-event-rejected", diagnostic: error.diagnostic });
    expect(journalBytes(journal)).not.toContain(canary);
    expect(journalBytes(journal)).not.toContain(extra);
    expect(journalBytes(journal)).not.toContain("privatePayload");
  });
});

it("rejects an incomplete write-ahead reservation before calling the underlying mutation", async () => {
  await withJournal(async journal => {
    let mutations = 0;
    const driver = journal.wrap(fakeDriver({ launch: async () => { mutations++; return attempt; } }));
    await expect(driver.launch("", request, "openai", "review", "packet", "attempt-5")).rejects.toThrow(PilotDiagnosticError);
    expect(mutations).toBe(0);
    expect(records(journal).at(-1).event.event).toBe("diagnostic-event-rejected");
  });
});

it.each([
  { dispatch: null, injected: null },
  { dispatch: {}, injected: extra },
  { dispatch: { id: "dispatch-5", task_id: "task-5", run_id: "native-run", assignee_handle: "terminal-5",
    assignee_pane_key: "tab:leaf", process_incarnation: "incarnation-5", metadata: { extra }, extra }, injected: false },
])("records dispatch observation as unverified with explicit missing identities", async receipt => {
  await withJournal(async journal => {
    journal.append({ event: "wrapper-dispatch-observed", ...receipt, extra });
    const observed = records(journal).at(-1).event;
    expect(observed).toEqual({ event: "wrapper-dispatch-observed", injected: receipt.injected === false ? false : null,
      dispatch: receipt.dispatch && "id" in receipt.dispatch
        ? { state: "unverified", id: "dispatch-5", taskId: "task-5", runId: "native-run", assigneeHandle: "terminal-5",
          assigneePaneKey: "tab:leaf", processIncarnation: "incarnation-5" }
        : { state: "unverified", id: null, taskId: null, runId: null, assigneeHandle: null, assigneePaneKey: null, processIncarnation: null } });
    expect(journalBytes(journal)).not.toContain(extra);
  });
});

it.each([
  { state: "settled", stop: { dispatchId: "dispatch-5", requestId: "stop-5", state: "stopped", kind: "wrapper-control", extra }, error: canary, extra },
  { state: "unknown", error: canary, stop: { extra }, extra },
])("projects cancellation $state by its discriminated branch", async result => {
  await withJournal(async journal => {
    const driver = journal.wrap(fakeDriver({ cancel: async () => result as never }));
    const a = await launch(driver);
    await driver.cancel(a, 1800000000000);
    expect(records(journal).at(-1).event.result).toEqual(result.state === "settled"
      ? { state: "settled", stop: { dispatchId: "dispatch-5", requestId: "stop-5", state: "stopped", kind: "wrapper-control" } }
      : { state: "unknown" });
    expect(journalBytes(journal)).not.toContain(canary);
    expect(journalBytes(journal)).not.toContain(extra);
  });
});

// Measure the complete summary's actual byte slice before parsing the JSONL.
function summarySlice(line: string): string {
  const start = line.indexOf('"diagnostic":') + '"diagnostic":'.length;
  expect(start).toBeGreaterThan('"diagnostic":'.length - 1);
  let depth = 0, quoted = false, escaped = false;
  for (let index = start; index < line.length; index++) {
    const char = line[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return line.slice(start, index + 1);
  }
  throw Error("missing complete diagnostic object");
}

it("persists complete shared summaries within the UTF-8 bound for attempts and cancellations", async () => {
  await withJournal(async journal => {
    const diagnostic = projectDiagnostic("PROVIDER_FAILURE", { origin: "provider", phase: "inference" }, {
      details: Array.from({ length: 100 }, () => ({ origin: "provider", phase: "inference", code: "PROVIDER_FAILURE" })),
    });
    expect(diagnostic.truncated).toBe(true);
    const driver = journal.wrap(fakeDriver({ launch: async () => ({ ...attempt, diagnostic }),
      cancel: async () => ({ state: "unknown", diagnostic }) }));
    const a = await launch(driver);
    const attemptLine = journalBytes(journal).trim().split("\n").at(-1)!;
    await driver.cancel(a, 1800000000000);
    const cancelLine = journalBytes(journal).trim().split("\n").at(-1)!;
    for (const line of [attemptLine, cancelLine]) {
      const encoded = summarySlice(line);
      expect(Buffer.byteLength(encoded, "utf8")).toBeLessThanOrEqual(4096);
      expect(parseDiagnosticSummary(JSON.parse(encoded))).toEqual(diagnostic);
    }
  });
});


it("accepts each producer event with only its owned fields and intact reservation identities", async () => {
  await withJournal(async journal => {
    const diagnostic = projectDiagnostic("runtime_timeout", { origin: "journal", phase: "validation" });
    const uuid = "b8cfe79e-83aa-4ab7-98fe-ae67f518ff32";
    const identity = { handle: "terminal-5", worktreeId: "workspace-5", ptyId: "pty-5", incarnationId: "incarnation-5", paneKey: "tab:leaf" };
    const reservation = { runId: "native-run", role: "openai", phase: "review", key: "attempt-5", mutationRequestId: uuid };
    const events = [
      { event: "bounds-recorded-before-inference", bounds, owned: [] },
      { event: "run-reserved", mutationRequestId: uuid },
      { event: "run-creation-unknown", mutationRequestId: uuid, diagnostic },
      { event: "native-run-bound", runId: "native-run" },
      { event: "attempt-reserved", ...reservation },
      { event: "launch-rejected-before-mutation", ...reservation, diagnostic },
      { event: "launch-unknown", ...reservation, diagnostic },
      { event: "attempt-bound", attempt },
      { event: "result-bound", binding, packetHash: "packet-5", phase: "review", role: "openai",
        source: "native Task.result bound host artifact", sourceIdentity: "completion-5" },
      { event: "observation-unknown", binding, diagnostic },
      { event: "cancel-reserved", binding, mutationRequestId: uuid },
      { event: "cancel-observed", binding, result: { state: "unknown", diagnostic } },
      { event: "release-reserved", binding },
      { event: "release-observed", binding, released: false },
      { event: "outcome-recorded", status: "consensus", calls: { probes: 8, topic: 10 }, unresolved: ["dispatch-5"] },
      { event: "wrapper-terminal-reserved", operationId: uuid, directory: "/owned/fixture", wrapperHash: "c".repeat(64) },
      { event: "wrapper-terminal-observed", operationId: uuid, handle: "terminal-5", directory: "/owned/fixture" },
      { event: "wrapper-task-reserved", requestId: uuid, run: "native-run", handle: "terminal-5", intentHash: "d".repeat(64) },
      { event: "wrapper-task-observed", taskId: "task-5", run: "native-run", handle: "terminal-5" },
      { event: "wrapper-dispatch-reserved", requestId: uuid, taskId: "task-5", run: "native-run", handle: "terminal-5" },
      { event: "wrapper-dispatch-observed", injected: false, dispatch: { state: "unverified", id: "dispatch-5", taskId: "task-5",
        runId: "native-run", assigneeHandle: "terminal-5", assigneePaneKey: "tab:leaf", processIncarnation: "incarnation-5" } },
      { event: "wrapper-native-bound", attempt, identity },
      { event: "wrapper-terminal-close-reserved", identity },
    ];
    expect(records(journal)[0].event).toEqual(events[0]);
    for (const event of events) {
      journal.append({ ...event, extra });
      expect(records(journal).at(-1)).toMatchObject({ version: 2, at: expect.any(Number), event });
      expect(records(journal).at(-1).event).toEqual(event);
    }
    expect(journalBytes(journal)).not.toContain(extra);
  });
});

it("keeps validated run-failure evidence while owning the primary code and reserved UUID", async () => {
  await withJournal(async journal => {
    const underlying = projectDiagnostic("runtime_timeout", { origin: "native-driver", phase: "native-read", inputDelivery: "attempted_unacknowledged" }, {
      exit: { state: "observed", code: -9007199254740991, signal: "SIGKILL", signalState: "observed" },
      counters: { stdoutBytes: 17, stdoutChunks: 2, stderrBytes: 41, stderrChunks: 3, exceptions: 1, unknownCodes: 2 },
      omissions: { stdout: true, stderr: true, exceptionText: true, initializationExtras: false, details: 0, countersSaturated: false },
    });
    const previousId = "b8cfe79e-83aa-4ab7-98fe-ae67f518ff32";
    const driver = journal.wrap(fakeDriver({ begin: async () => { throw new PilotDiagnosticError(underlying, previousId); } }));
    const error = await driver.begin(request).catch(cause => cause);
    expect(error).toBeInstanceOf(PilotDiagnosticError);
    expect(error.diagnostic.counters).toEqual({ stdoutBytes: 17, stdoutChunks: 2, stderrBytes: 41, stderrChunks: 3, exceptions: 1, unknownCodes: 2 });
    expect(error.diagnostic.exit).toEqual({ state: "observed", code: -9007199254740991, signal: "SIGKILL", signalState: "observed" });
    expect(error.diagnostic.inputDelivery).toBe("attempted_unacknowledged");
    expect(error.diagnostic.omissions).toEqual(underlying.omissions);
    expect(error.diagnostic.code).toBe("NATIVE_RUN_CREATION_OUTCOME_UNKNOWN");
    expect(error.diagnostic.details).toEqual([{ origin: "native-driver", phase: "native-read", code: "runtime_timeout" }]);
    const events = records(journal);
    expect(error.mutationRequestId).toBe(events.find(record => record.event.event === "run-reserved").event.mutationRequestId);
    expect(error.mutationRequestId).not.toBe(previousId);
    expect(events.at(-1).event.diagnostic).toEqual(error.diagnostic);
  });
});
