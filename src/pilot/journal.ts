import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { mutationRequestId } from "./mutation-id.js";
import { canonicalJson } from "../domain/hash.js";
import { z } from "zod";
import { selectionSchema } from "./config.js";
import { bindingSchema, identitySchema } from "./wrapper-contract.js";
import { pilotResultEnvelopeSchema } from "./payload.js";
import { DIAGNOSTIC_CODES, PilotDiagnosticError, diagnosticCode, diagnosticError, diagnosticSummarySchema,
  fitDiagnosticSummary, parseDiagnosticSummary, projectDiagnostic } from "./diagnostics.js";
import type { Attempt, PilotDriver, PilotRequest, Phase } from "./types.js";
import type { Role } from "./config.js";

export const PILOT_JOURNAL_VERSION = 2;
const text = z.string().min(1);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const role = pilotResultEnvelopeSchema.shape.role;
const phase = pilotResultEnvelopeSchema.shape.phase;
const boundsSchema = z.strictObject({
  runId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  maxProbeCalls: count, maxTopicCalls: count, deadline: count.positive(),
  workerTimeoutMs: count.positive(), proofTtlMs: count.positive(), configHash: text,
});
const attemptSchema = z.strictObject({
  binding: bindingSchema, role, phase, selection: selectionSchema, packetHash: text, launchVerified: z.boolean(),
  context: z.strictObject({ directory: text, assignmentHash: text }).optional(),
  inferenceStarted: z.boolean().nullable().optional(), initializations: count.nullable().optional(),
  controlError: z.enum(DIAGNOSTIC_CODES).optional(), diagnostic: diagnosticSummarySchema.optional(),
});
const stopSchema = z.strictObject({
  dispatchId: text, requestId: text, state: z.literal("stopped"), kind: z.literal("wrapper-control").optional(),
});
const cancellationSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("settled"), stop: stopSchema, diagnostic: diagnosticSummarySchema.optional() }),
  z.strictObject({ state: z.literal("settled_unacknowledged"), error: z.enum(DIAGNOSTIC_CODES).optional(), diagnostic: diagnosticSummarySchema.optional() }),
  z.strictObject({ state: z.literal("unknown"), diagnostic: diagnosticSummarySchema.optional() }),
]);
// This receipt precedes the transport's binding checks and confers no authority.
const dispatchSchema = z.strictObject({
  state: z.literal("unverified"), id: text.nullable(), taskId: text.nullable(), runId: text.nullable(),
  assigneeHandle: text.nullable(), assigneePaneKey: text.nullable(), processIncarnation: text.nullable(),
});
const reservation = { runId: text, role, phase, key: text, mutationRequestId: uuid };
const eventSchemas = {
  "bounds-recorded-before-inference": z.strictObject({ event: z.literal("bounds-recorded-before-inference"), bounds: boundsSchema, owned: z.tuple([]) }),
  "run-reserved": z.strictObject({ event: z.literal("run-reserved"), mutationRequestId: uuid }),
  "run-creation-unknown": z.strictObject({ event: z.literal("run-creation-unknown"), mutationRequestId: uuid, diagnostic: diagnosticSummarySchema }),
  "native-run-bound": z.strictObject({ event: z.literal("native-run-bound"), runId: text }),
  "attempt-reserved": z.strictObject({ event: z.literal("attempt-reserved"), ...reservation }),
  "launch-rejected-before-mutation": z.strictObject({ event: z.literal("launch-rejected-before-mutation"), ...reservation, diagnostic: diagnosticSummarySchema }),
  "launch-unknown": z.strictObject({ event: z.literal("launch-unknown"), ...reservation, diagnostic: diagnosticSummarySchema }),
  "attempt-bound": z.strictObject({ event: z.literal("attempt-bound"), attempt: attemptSchema }),
  "result-bound": z.strictObject({ event: z.literal("result-bound"), binding: bindingSchema, packetHash: text, phase, role, source: text, sourceIdentity: text }),
  "observation-unknown": z.strictObject({ event: z.literal("observation-unknown"), binding: bindingSchema, diagnostic: diagnosticSummarySchema }),
  "cancel-reserved": z.strictObject({ event: z.literal("cancel-reserved"), binding: bindingSchema, mutationRequestId: uuid }),
  "cancel-observed": z.strictObject({ event: z.literal("cancel-observed"), binding: bindingSchema, result: cancellationSchema }),
  "release-reserved": z.strictObject({ event: z.literal("release-reserved"), binding: bindingSchema }),
  "release-observed": z.strictObject({ event: z.literal("release-observed"), binding: bindingSchema, released: z.boolean() }),
  "outcome-recorded": z.strictObject({ event: z.literal("outcome-recorded"), status: z.enum(["consensus", "disagreement", "judge_unresolved", "invalid_request", "prerequisites_not_verified", "failed"]),
    calls: z.strictObject({ probes: count, topic: count }), unresolved: z.array(text) }),
  "wrapper-terminal-reserved": z.strictObject({ event: z.literal("wrapper-terminal-reserved"), operationId: uuid, directory: text, wrapperHash: text }),
  "wrapper-terminal-observed": z.strictObject({ event: z.literal("wrapper-terminal-observed"), operationId: uuid, handle: text, directory: text }),
  "wrapper-task-reserved": z.strictObject({ event: z.literal("wrapper-task-reserved"), requestId: uuid, run: text, handle: text, intentHash: text }),
  "wrapper-task-observed": z.strictObject({ event: z.literal("wrapper-task-observed"), taskId: text, run: text, handle: text }),
  "wrapper-dispatch-reserved": z.strictObject({ event: z.literal("wrapper-dispatch-reserved"), requestId: uuid, taskId: text, run: text, handle: text }),
  "wrapper-dispatch-observed": z.strictObject({ event: z.literal("wrapper-dispatch-observed"), dispatch: dispatchSchema, injected: z.boolean().nullable() }),
  "wrapper-native-bound": z.strictObject({ event: z.literal("wrapper-native-bound"), attempt: attemptSchema, identity: identitySchema }),
  "wrapper-terminal-close-reserved": z.strictObject({ event: z.literal("wrapper-terminal-close-reserved"), identity: identitySchema }),
};
const rejectedSchema = z.strictObject({ event: z.literal("diagnostic-event-rejected"), diagnostic: diagnosticSummarySchema });
type EventName = keyof typeof eventSchemas;
export type PilotJournalEvent = {
  [Name in EventName]: z.infer<typeof eventSchemas[Name]>
}[EventName] | z.infer<typeof rejectedSchema>;

function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("NATIVE_REQUEST_INVALID");
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.hasOwn(value, key)) {
      const field = (value as Record<string, unknown>)[key];
      if (field !== undefined) result[key] = field;
    }
  }
  return result;
}
const projectBinding = (value: unknown) => bindingSchema.parse(fields(value, ["runId", "taskId", "dispatchId", "handle", "attemptKey"]));
const projectIdentity = (value: unknown) => identitySchema.parse(fields(value, ["handle", "worktreeId", "ptyId", "incarnationId", "paneKey"]));
function projectAttempt(value: unknown) {
  const result = fields(value, ["binding", "role", "phase", "selection", "packetHash", "launchVerified", "context", "inferenceStarted", "initializations", "controlError", "diagnostic"]);
  result.binding = projectBinding(result.binding);
  result.selection = selectionSchema.parse(fields(result.selection, ["route", "model", "effort", "effortEncoding"]));
  if (result.context !== undefined) result.context = fields(result.context, ["directory", "assignmentHash"]);
  if (result.controlError !== undefined) result.controlError = diagnosticCode(result.controlError);
  if (result.diagnostic !== undefined) result.diagnostic = parseDiagnosticSummary(result.diagnostic);
  return attemptSchema.parse(result);
}
function projectCancellation(value: unknown) {
  const branch = fields(value, ["state"]).state;
  const result = fields(value, branch === "settled" ? ["state", "stop", "diagnostic"]
    : branch === "settled_unacknowledged" ? ["state", "error", "diagnostic"] : ["state", "diagnostic"]);
  if (branch === "settled") result.stop = fields(result.stop, ["dispatchId", "requestId", "state", "kind"]);
  if (result.error !== undefined) result.error = diagnosticCode(result.error);
  if (result.diagnostic !== undefined) result.diagnostic = parseDiagnosticSummary(result.diagnostic);
  return cancellationSchema.parse(result);
}
function projectDispatch(value: unknown) {
  const input = value == null ? {} : fields(value, ["id", "taskId", "task_id", "runId", "run_id", "assigneeHandle", "assignee_handle",
    "assigneePaneKey", "assignee_pane_key", "processIncarnation", "process_incarnation"]);
  return dispatchSchema.parse({
    state: "unverified", id: input.id ?? null, taskId: input.taskId ?? input.task_id ?? null, runId: input.runId ?? input.run_id ?? null,
    assigneeHandle: input.assigneeHandle ?? input.assignee_handle ?? null,
    assigneePaneKey: input.assigneePaneKey ?? input.assignee_pane_key ?? null,
    processIncarnation: input.processIncarnation ?? input.process_incarnation ?? null,
  });
}
function rejectedEvent(code: "NATIVE_JOURNAL_EVENT_UNSUPPORTED" | "NATIVE_REQUEST_INVALID"): z.infer<typeof rejectedSchema> {
  return { event: "diagnostic-event-rejected", diagnostic: projectDiagnostic(code, { origin: "journal", phase: "persistence" }) };
}

/** Pick owned fields before validation; no untrusted object is serialized wholesale. */
export function projectPilotJournalEvent(value: unknown): PilotJournalEvent {
  try {
    const name = fields(value, ["event"]).event;
    if (typeof name !== "string" || !Object.hasOwn(eventSchemas, name))
      return rejectedEvent("NATIVE_JOURNAL_EVENT_UNSUPPORTED");
    const schema = eventSchemas[name as EventName];
    const event = fields(value, Object.keys(schema.shape));
    if ("bounds" in schema.shape) event.bounds = fields(event.bounds, Object.keys(boundsSchema.shape));
    if ("binding" in schema.shape) event.binding = projectBinding(event.binding);
    if ("attempt" in schema.shape) event.attempt = projectAttempt(event.attempt);
    if ("identity" in schema.shape) event.identity = projectIdentity(event.identity);
    if ("diagnostic" in schema.shape) event.diagnostic = parseDiagnosticSummary(event.diagnostic);
    if (name === "cancel-observed") event.result = projectCancellation(event.result);
    if (name === "wrapper-dispatch-observed") {
      event.dispatch = projectDispatch(event.dispatch);
      event.injected = typeof event.injected === "boolean" ? event.injected : null;
    }
    if (name === "outcome-recorded") {
      event.calls = fields(event.calls, ["probes", "topic"]);
    }
    return schema.parse(event);
  } catch {
    // Zod issues and malformed input values are intentionally not retained.
    return rejectedEvent("NATIVE_REQUEST_INVALID");
  }
}

/** Exclusive write-ahead journal. Restart never silently retries a reserved native attempt. */
export class PilotJournal {
  readonly path: string;
  private readonly fd: number;
  constructor(workspace: string, id: string, bounds: unknown) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw Error("INVALID_NATIVE_RUN_ID");
    let root = realpathSync(workspace);
    for (const part of [".council", "native"]) {
      root = join(root, part);
      if (existsSync(root)) {
        if (lstatSync(root).isSymbolicLink() || realpathSync(root) !== root)
          throw Error("NATIVE_JOURNAL_SYMLINK");
      } else mkdirSync(root, { mode: 0o700 });
    }
    this.path = join(root, id);
    if (existsSync(this.path))
      throw Error(
        "NATIVE_RUN_EXISTS_INSPECT_REQUIRED: no automatic resume or duplicate calls",
      );
    mkdirSync(this.path, { mode: 0o700 });
    this.fd = openSync(
      join(this.path, "events.jsonl"),
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      this.append({ event: "bounds-recorded-before-inference", bounds, owned: [] });
    } catch (error) {
      try { closeSync(this.fd); } catch { /* Preserve the append failure. */ }
      throw error;
    }
  }
  append(event: unknown) {
    const projected = projectPilotJournalEvent(event);
    writeSync(this.fd, canonicalJson({ version: PILOT_JOURNAL_VERSION, at: Date.now(), event: projected }) + "\n");
    fsyncSync(this.fd);
    if (projected.event === "diagnostic-event-rejected") throw new PilotDiagnosticError(projected.diagnostic);
  }
  close() {
    closeSync(this.fd);
  }
  wrap(driver: PilotDriver): PilotDriver {
    const owned = new Set<string>();
    const check = (a: Attempt) => {
      if (!owned.has(a.binding.dispatchId))
        throw new PilotDiagnosticError(projectDiagnostic("NATIVE_RESOURCE_NOT_JOURNAL_OWNED", { origin: "journal", phase: "validation" }));
    };
    return {
      ...(driver.proof ? { proof: (a: Attempt) => { check(a); return driver.proof!(a); } } : {}),
      inspect: (r) => driver.inspect(r),
      begin: async (r) => {
        const mutationRequestId=randomUUID();
        this.append({ event: "run-reserved", mutationRequestId });
        let id:string;
        try { id = await driver.begin(r,mutationRequestId); }
        catch(error) {
          const underlying = projectDiagnostic(error, { origin: "journal", phase: "bootstrap" });
          const diagnostic = projectDiagnostic("NATIVE_RUN_CREATION_OUTCOME_UNKNOWN", { origin: "journal", phase: "bootstrap" });
          diagnostic.details = [{ origin: underlying.origin, phase: underlying.phase, code: underlying.code }];
          diagnostic.inputDelivery = underlying.inputDelivery;
          diagnostic.exit = underlying.exit;
          diagnostic.counters = underlying.counters;
          diagnostic.omissions = underlying.omissions;
          diagnostic.truncated = underlying.truncated;
          const summary = fitDiagnosticSummary(diagnostic);
          this.append({ event: "run-creation-unknown", mutationRequestId, diagnostic: summary });
          throw new PilotDiagnosticError(summary, mutationRequestId);
        }
        this.append({ event: "native-run-bound", runId: id });
        return id;
      },
      launch: async (
        runId: string,
        r: PilotRequest,
        role: Role,
        phase: Phase,
        packet: string,
        key: string,
      ) => {
        this.append({
          event: "attempt-reserved",
          runId,
          role,
          phase,
          key,
          mutationRequestId: mutationRequestId(key),
        });
        let a:Attempt;
        try { a = await driver.launch(runId, r, role, phase, packet, key); }
        catch(error) {
          const safe = diagnosticError(error, { origin: "journal", phase: "initialization" });
          const beforeMutation = safe.diagnostic.code === "NATIVE_PACKET_ARGUMENT_TOO_LARGE";
          this.append({ event: beforeMutation ? "launch-rejected-before-mutation" : "launch-unknown",
            runId, role, phase, key, mutationRequestId: mutationRequestId(key), diagnostic: safe.diagnostic });
          throw safe;
        }
        this.append({ event: "attempt-bound", attempt: a });
        owned.add(a.binding.dispatchId);
        return a;
      },
      observe: async (a, d) => {
        check(a);
        try {
          const result = await driver.observe(a, d);
          this.append({
            event: "result-bound",
            binding: a.binding,
            packetHash: result.packetHash,
            phase: result.phase,
            role: result.role,
            source: result.source,
            sourceIdentity: result.sourceIdentity,
          });
          return result;
        } catch (error) {
          const safe = diagnosticError(error, { origin: "journal", phase: "validation" });
          this.append({ event: "observation-unknown", binding: a.binding, diagnostic: safe.diagnostic });
          throw safe;
        }
      },
      cancel: async (a, deadline, mode) => {
        check(a);
        this.append({ event: "cancel-reserved", binding: a.binding, mutationRequestId: mutationRequestId(`${a.context ? "wrapper-stop" : "stop"}:${canonicalJson(a.binding)}`) });
        try {
          const result = await driver.cancel(a, deadline, mode);
          this.append({ event: "cancel-observed", binding: a.binding, result });
          return result;
        } catch (error) {
          throw diagnosticError(error, { origin: "journal", phase: "cancellation" });
        }
      },
      release: async (a, deadline) => {
        check(a);
        this.append({ event: "release-reserved", binding: a.binding });
        try {
          const released = await driver.release(a, deadline);
          this.append({ event: "release-observed", binding: a.binding, released });
          return released;
        } catch (error) {
          throw diagnosticError(error, { origin: "journal", phase: "cleanup" });
        }
      },
    };
  }
}
