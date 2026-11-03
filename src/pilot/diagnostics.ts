import { z } from "zod";
import { canonicalJson } from "../domain/hash.js";

export const MAX_DIAGNOSTIC_SUMMARY_BYTES = 4096;
export const DIAGNOSTIC_COUNTER_MAX = 2147483647;
export const DIAGNOSTIC_SUMMARY_VERSION = 1;
export const DIAGNOSTIC_ORIGINS = ["provider", "host-wrapper", "context-driver", "native-driver", "native-read", "journal", "workflow", "cli", "unknown"] as const;
export const DIAGNOSTIC_PHASES = ["bootstrap", "initialization", "input", "inference", "cancellation", "cleanup", "validation", "persistence", "native-read", "unknown"] as const;
export const DIAGNOSTIC_CLASSES = ["none", "control", "protocol", "transport", "timeout", "authentication", "denial", "exhaustion", "cancellation", "validation", "persistence", "unknown"] as const;
export const INPUT_DELIVERY_STATES = ["not_attempted", "attempted_unacknowledged", "acknowledged", "unknown"] as const;
export const DIAGNOSTIC_CODES = [
  "NONE", "DIAGNOSTIC_UNKNOWN", "DIAGNOSTIC_SUMMARY_INVALID", "DIAGNOSTIC_SUMMARY_TOO_LARGE",
  "PROVIDER_BOOTSTRAP_UNVERIFIED", "PROVIDER_CONTROL_SOURCE_DRIFT",
  "PROVIDER_PREINPUT_CONTROL_UNSUPPORTED", "PROVIDER_PREINPUT_CONTROL_UNVERIFIED",
  "PROVIDER_PACKET_ROOT_MISMATCH", "PROVIDER_PACKET_ROOT_UNVERIFIED",
  "PROVIDER_PROFILE_SCOPE_INVALID", "PROVIDER_PROFILE_SYMLINK", "PROVIDER_PROFILE_CUSTODY_INVALID",
  "PROVIDER_PROFILE_CONTENT_MISMATCH", "PROVIDER_PROFILE_ROUTE_MISMATCH",
  "PROVIDER_AGENT_DEFINITION_UNBOUND", "PROVIDER_MULTIPLE_INIT",
  "PROVIDER_EFFECTIVE_CONTROLS_UNVERIFIED", "PROVIDER_FINAL_ORDER_INVALID", "PROVIDER_FINAL_INVALID",
  "PROVIDER_CONVERSATION_UNBOUND", "PROVIDER_UNCONTROLLED_TOOL", "PROVIDER_STREAM_EVENT_UNSUPPORTED",
  "PROVIDER_MULTIPLE_FINAL", "PROVIDER_OUTPUT_OVERFLOW", "PROVIDER_INVALID_UTF8",
  "PROVIDER_STDERR_UNCLASSIFIED", "PROVIDER_INPUT_CLOSED", "PROVIDER_PROCESS_START_FAILED",
  "PROVIDER_CANCEL_UNBOUND", "PROVIDER_PREINPUT_INIT_UNAVAILABLE",
  "PROVIDER_DESCENDANT_CONTROL_UNVERIFIED", "PROVIDER_INPUT_AUTHORITY_UNVERIFIED",
  "PROVIDER_INPUT_DEADLINE", "PROVIDER_INITIALIZATION_CANCELLED", "PROVIDER_INFERENCE_DEADLINE",
  "PROVIDER_FAILURE", "PROVIDER_TRUNCATED_FINAL", "PROVIDER_PROCESS_SETTLEMENT_UNVERIFIED",
  "PROVIDER_FINAL_NOT_SUCCESSFUL", "PROVIDER_RESULT_UNBOUND", "PROVIDER_INITIALIZATION_FAILED",
  "CODEX_APP_SERVER_ERROR", "CODEX_EFFECTIVE_CONFIG_UNVERIFIED", "CODEX_REQUIREMENTS_DENIED",
  "CODEX_PROFILE_NOT_ALLOWED", "CODEX_THREAD_SELECTION_UNVERIFIED", "CODEX_ACTIVE_TURN_UNVERIFIED",
  "CODEX_TURN_FAILED", "CODEX_THREAD_UNBOUND",
  "WRAPPER_START_SCOPE_INVALID", "WRAPPER_GENUINE_CALLER_UNVERIFIED", "WRAPPER_PRODUCER_CODE_DRIFT",
  "WRAPPER_NATIVE_DISPATCH_UNVERIFIED", "WRAPPER_NATIVE_INTENT_UNVERIFIED",
  "WRAPPER_PROVIDER_INITIALIZATION_FAILED", "WRAPPER_NATIVE_COMPLETION_UNKNOWN", "WRAPPER_FAILED",
  "WRAPPER_BOOTSTRAP_CONTROLS_UNVERIFIED", "WRAPPER_DIRECTORY_UNVERIFIED",
  "WRAPPER_TERMINAL_OUTCOME_UNKNOWN", "WRAPPER_WORKSPACE_MISMATCH", "WRAPPER_TASK_OUTCOME_UNKNOWN",
  "WRAPPER_DISPATCH_AUTHORITY_UNVERIFIED", "WRAPPER_EFFECTIVE_CONTROLS_UNVERIFIED",
  "WRAPPER_INPUT_ACK_UNKNOWN", "WRAPPER_INPUT_MUTATION_UNKNOWN", "WRAPPER_INPUT_ACK_UNBOUND",
  "WRAPPER_INPUT_DELIVERY_UNVERIFIED", "WRAPPER_INITIALIZATION_DEADLINE", "WRAPPER_NOT_OWNED",
  "WRAPPER_PROVIDER_FAILED", "WRAPPER_RESULT_BINDING_MISMATCH", "WRAPPER_RESULT_DEADLINE",
  "WRAPPER_RESULT_UNBOUND", "WRAPPER_NATIVE_AUTHORITY_UNBOUND", "WRAPPER_NATIVE_COMPLETION_UNVERIFIED",
  "WRAPPER_ARTIFACT_SYMLINK", "WRAPPER_ARTIFACT_TOO_LARGE", "WRAPPER_DIAGNOSTIC_VERSION_UNSUPPORTED",
  "INVALID_FINITE_BOUNDS_OR_INPUT", "INSUFFICIENT_CALL_BUDGET", "CALL_OR_DEADLINE_LIMIT",
  "NATIVE_INFERENCE_DEADLINE", "NATIVE_EFFECTIVE_SELECTION_MISMATCH",
  "CANCELLATION_SETTLEMENT_UNKNOWN", "CANCELLATION_UNACKNOWLEDGED", "RELEASE_UNKNOWN",
  "INVALID_NORMAL-PROBE_RESULT", "INVALID_CANCEL-PROBE_RESULT", "INVALID_READINESS_RESULT",
  "INVALID_REVIEW_RESULT", "INVALID_JUDGE_RESULT", "INVALID_BALLOT_RESULT",
  "NATIVE_PACKET_ARGUMENT_TOO_LARGE", "NATIVE_FAILURE", "NATIVE_INSPECTION_UNVERIFIED",
  "NATIVE_RUN_CREATION_OUTCOME_UNKNOWN", "NATIVE_RESOURCE_NOT_JOURNAL_OWNED",
  "NATIVE_RUN_ID_MISSING", "LAUNCH_OUTCOME_UNKNOWN", "NATIVE_BINDING_MISMATCH",
  "NATIVE_LIFECYCLE_UNKNOWN", "NATIVE_WORKER_FAILED", "NATIVE_RESULT_DEADLINE",
  "NATIVE_TRANSCRIPT_UNBOUND", "NATIVE_TRANSCRIPT_CLIPPED", "NATIVE_TRANSCRIPT_INCOMPLETE",
  "NATIVE_RESULT_MALFORMED_OR_MISMATCHED",
  "QUALIFICATION_CACHE_SYMLINK", "QUALIFICATION_CACHE_CORRUPT",
  "QUALIFICATION_CACHE_NATIVE_EVIDENCE_UNVERIFIED", "QUALIFICATION_CACHE_CLOCK_INVALID",
  "QUALIFICATION_CACHE_LOCK_OWNERSHIP_CHANGED", "PILOT_CONFIG_TOO_LARGE_OR_NOT_FILE",
  "PILOT_CONFIG_INCOMPATIBLE",
  "INVALID_NATIVE_RUN_ID", "NATIVE_JOURNAL_SYMLINK", "NATIVE_RUN_EXISTS_INSPECT_REQUIRED",
  "INVALID_AUDIT_ACTION", "INVALID_AUDIT_ARGUMENTS", "INVALID_AUDIT_ROLE", "INVALID_NATIVE_ARGUMENTS",
  "MISSING_--workspace", "MISSING_--input", "MISSING_--policy", "MISSING_--role", "MISSING_--hash",
  "MISSING_--run", "MISSING_--task", "ABSOLUTE_ORCA_EXECUTABLE_REQUIRED", "NATIVE_INPUT_TOO_LARGE",
  "NATIVE_OUTCOME_NOT_RECORDED", "NATIVE_PERSISTENCE_OR_CLOSE_FAILED",
  "QUALIFICATION_CACHE_BUSY_RECONCILE", "NATIVE_REQUEST_INVALID", "NATIVE_JOURNAL_EVENT_UNSUPPORTED",
  "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EPIPE", "ENOTFOUND", "TIMEOUT", "REQUEST_TIMEOUT",
  "runtime_timeout", "runtime_unavailable", "invalid_runtime_response", "permission_denied", "forbidden",
  "method_not_found", "unauthorized", "unsupported", "quota_exceeded", "stable_pane_required", "run_required",
  "terminal_handle_stale", "operation_unknown", "incompatible_runtime", "terminal_gone",
  "HTTP_401", "HTTP_403", "ORCA_RUNTIME_BINDING_MISMATCH", "ORCA_COMMAND_REGISTRY_INVALID",
  "ORCA_INVALID_ENVELOPE", "ORCA_CLI_DIAGNOSTICS_PRESENT",
] as const;
export const DIAGNOSTIC_SIGNALS = [
  "SIGABRT", "SIGALRM", "SIGBUS", "SIGCHLD", "SIGCONT", "SIGFPE", "SIGHUP", "SIGILL", "SIGINT", "SIGIO", "SIGIOT",
  "SIGKILL", "SIGPIPE", "SIGPOLL", "SIGPROF", "SIGPWR", "SIGQUIT", "SIGSEGV", "SIGSTKFLT", "SIGSTOP", "SIGSYS",
  "SIGTERM", "SIGTRAP", "SIGTSTP", "SIGTTIN", "SIGTTOU", "SIGURG", "SIGUSR1", "SIGUSR2", "SIGVTALRM", "SIGWINCH",
  "SIGXCPU", "SIGXFSZ", "SIGBREAK", "SIGINFO", "SIGEMT", "SIGLOST", "SIGUNUSED",
] as const;
export type DiagnosticCode = typeof DIAGNOSTIC_CODES[number];
export type DiagnosticOrigin = typeof DIAGNOSTIC_ORIGINS[number];
export type DiagnosticPhase = typeof DIAGNOSTIC_PHASES[number];
export type DiagnosticClass = typeof DIAGNOSTIC_CLASSES[number];
export type InputDeliveryState = typeof INPUT_DELIVERY_STATES[number];
export type DiagnosticSignal = typeof DIAGNOSTIC_SIGNALS[number];
export interface DiagnosticDetail { origin: DiagnosticOrigin; phase: DiagnosticPhase; code: DiagnosticCode }
export interface DiagnosticContext { origin: DiagnosticOrigin; phase: DiagnosticPhase; inputDelivery?: InputDeliveryState }
const countSchema = z.number().int().min(0).max(DIAGNOSTIC_COUNTER_MAX);
const detailSchema = z.strictObject({ origin: z.enum(DIAGNOSTIC_ORIGINS), phase: z.enum(DIAGNOSTIC_PHASES), code: z.enum(DIAGNOSTIC_CODES) });
const summaryShape = z.strictObject({
  ...detailSchema.shape, version: z.literal(1), classification: z.enum(DIAGNOSTIC_CLASSES), inputDelivery: z.enum(INPUT_DELIVERY_STATES),
  exit: z.strictObject({ state: z.enum(["observed", "not_started", "unknown"]), code: z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).nullable(),
    signal: z.enum(DIAGNOSTIC_SIGNALS).nullable(), signalState: z.enum(["observed", "none", "unknown"]) }),
  counters: z.strictObject({ stdoutBytes: countSchema, stdoutChunks: countSchema, stderrBytes: countSchema, stderrChunks: countSchema, exceptions: countSchema, unknownCodes: countSchema }),
  omissions: z.strictObject({ stdout: z.boolean(), stderr: z.boolean(), exceptionText: z.boolean(), initializationExtras: z.boolean(), details: countSchema, countersSaturated: z.boolean() }),
  truncated: z.boolean(), details: z.array(detailSchema),
});
export type DiagnosticSummary = z.infer<typeof summaryShape>;
const encodedBytes = (value: DiagnosticSummary) => Buffer.byteLength(canonicalJson(value), "utf8");
export const diagnosticSummarySchema = summaryShape.refine(value => encodedBytes(value) <= MAX_DIAGNOSTIC_SUMMARY_BYTES, "DIAGNOSTIC_SUMMARY_TOO_LARGE");

function checkedSummary(value: unknown): DiagnosticSummary {
  try { return summaryShape.parse(value); }
  catch { throw Error("DIAGNOSTIC_SUMMARY_INVALID"); }
}
export function parseDiagnosticSummary(value: unknown): DiagnosticSummary {
  const result = checkedSummary(value);
  if (encodedBytes(result) > MAX_DIAGNOSTIC_SUMMARY_BYTES) throw Error("DIAGNOSTIC_SUMMARY_TOO_LARGE");
  return result;
}
export function addDiagnosticCount(current: number, increment: number): number {
  if (!Number.isSafeInteger(current) || current < 0 || !Number.isSafeInteger(increment) || increment < 0) throw Error("DIAGNOSTIC_SUMMARY_INVALID");
  return increment > DIAGNOSTIC_COUNTER_MAX-current ? DIAGNOSTIC_COUNTER_MAX : current+increment;
}
export function fitDiagnosticSummary(candidate: DiagnosticSummary): DiagnosticSummary {
  const result = checkedSummary(candidate);
  while (encodedBytes(result) > MAX_DIAGNOSTIC_SUMMARY_BYTES) {
    if (!result.details.length) throw Error("DIAGNOSTIC_SUMMARY_TOO_LARGE");
    result.details.pop();
    if (result.omissions.details === DIAGNOSTIC_COUNTER_MAX) result.omissions.countersSaturated = true;
    result.omissions.details = addDiagnosticCount(result.omissions.details, 1); result.truncated = true;
  }
  return result;
}

const codes = new Set<string>(DIAGNOSTIC_CODES);
const nativeCodes = new Map(DIAGNOSTIC_CODES.slice(DIAGNOSTIC_CODES.indexOf("ETIMEDOUT")).map(code => [code.toLowerCase(), code]));
function finiteCode(value: unknown): DiagnosticCode {
  if (value === 401) return "HTTP_401";
  if (value === 403) return "HTTP_403";
  if (typeof value !== "string") return "DIAGNOSTIC_UNKNOWN";
  return codes.has(value) ? value as DiagnosticCode : nativeCodes.get(value.toLowerCase()) ?? "DIAGNOSTIC_UNKNOWN";
}
function exceptionCodes(value: unknown): { code: DiagnosticCode; native?: DiagnosticCode; carried?: DiagnosticSummary } {
  try {
    if (value instanceof PilotDiagnosticError) { const carried = parseDiagnosticSummary(value.diagnostic); return { code: carried.code, carried }; }
    if (typeof value === "string" || typeof value === "number") return { code: finiteCode(value) };
    if (!value || typeof value !== "object") return { code: "DIAGNOSTIC_UNKNOWN" };
    const native = finiteCode((value as any).code);
    const nested = native === "DIAGNOSTIC_UNKNOWN" ? finiteCode((value as any).response?.error?.code) : native;
    const message = value instanceof Error && codes.has(value.message) ? value.message as DiagnosticCode : undefined;
    return message && nested !== message && nested !== "DIAGNOSTIC_UNKNOWN" ? { code: message, native: nested } : { code: message ?? nested };
  } catch { return { code: "DIAGNOSTIC_UNKNOWN" }; }
}
export function diagnosticCode(value: unknown): DiagnosticCode { return exceptionCodes(value).code; }

export function diagnosticClass(code: DiagnosticCode): DiagnosticClass {
  if (code === "NONE") return "none";
  if ((["PROVIDER_INPUT_DEADLINE", "PROVIDER_INFERENCE_DEADLINE", "WRAPPER_INITIALIZATION_DEADLINE", "WRAPPER_RESULT_DEADLINE", "NATIVE_INFERENCE_DEADLINE", "NATIVE_RESULT_DEADLINE", "ETIMEDOUT", "TIMEOUT", "REQUEST_TIMEOUT", "runtime_timeout"] as string[]).includes(code)) return "timeout";
  if (code === "HTTP_401" || code === "unauthorized") return "authentication";
  if (["HTTP_403", "permission_denied", "forbidden"].includes(code)) return "denial";
  if (code === "quota_exceeded") return "exhaustion";
  if (["ECONNRESET", "ECONNREFUSED", "EPIPE", "ENOTFOUND", "runtime_unavailable", "invalid_runtime_response"].includes(code)) return "transport";
  if (["PROVIDER_INITIALIZATION_CANCELLED", "CANCELLATION_UNACKNOWLEDGED", "CANCELLATION_SETTLEMENT_UNKNOWN"].includes(code)) return "cancellation";
  if (["DIAGNOSTIC_SUMMARY_INVALID", "DIAGNOSTIC_SUMMARY_TOO_LARGE", "NATIVE_REQUEST_INVALID", "PROVIDER_RESULT_UNBOUND", "NATIVE_RESULT_MALFORMED_OR_MISMATCHED", "PILOT_CONFIG_INCOMPATIBLE", "INVALID_NORMAL-PROBE_RESULT", "INVALID_CANCEL-PROBE_RESULT", "INVALID_READINESS_RESULT", "INVALID_REVIEW_RESULT", "INVALID_JUDGE_RESULT", "INVALID_BALLOT_RESULT"].includes(code)) return "validation";
  if (["NATIVE_PERSISTENCE_OR_CLOSE_FAILED", "NATIVE_OUTCOME_NOT_RECORDED"].includes(code)) return "persistence";
  if (code === "DIAGNOSTIC_UNKNOWN") return "unknown";
  if (["PROVIDER_MULTIPLE_INIT", "PROVIDER_FINAL_ORDER_INVALID", "PROVIDER_FINAL_INVALID", "PROVIDER_MULTIPLE_FINAL", "PROVIDER_OUTPUT_OVERFLOW", "PROVIDER_INVALID_UTF8", "PROVIDER_STDERR_UNCLASSIFIED", "PROVIDER_STREAM_EVENT_UNSUPPORTED", "PROVIDER_TRUNCATED_FINAL", "CODEX_APP_SERVER_ERROR", "CODEX_TURN_FAILED"].includes(code)) return "protocol";
  return "control";
}

export function projectDiagnostic(cause: unknown, context: DiagnosticContext,
  evidence?: Partial<Pick<DiagnosticSummary, "exit" | "counters" | "omissions" | "details">>): DiagnosticSummary {
  const selected = exceptionCodes(cause);
  if (selected.carried) return selected.carried;
  const origin = (DIAGNOSTIC_ORIGINS as readonly unknown[]).includes(context.origin) ? context.origin : "unknown";
  const phase = (DIAGNOSTIC_PHASES as readonly unknown[]).includes(context.phase) ? context.phase : "unknown";
  const result: DiagnosticSummary = {
    version: 1, origin, phase, code: selected.code, classification: diagnosticClass(selected.code),
    inputDelivery: (INPUT_DELIVERY_STATES as readonly unknown[]).includes(context.inputDelivery) ? context.inputDelivery! : "unknown",
    exit: evidence?.exit ?? { state: "unknown", code: null, signal: null, signalState: "unknown" },
    counters: evidence?.counters ? { ...evidence.counters } : { stdoutBytes: 0, stdoutChunks: 0, stderrBytes: 0, stderrChunks: 0, exceptions: 0, unknownCodes: 0 },
    omissions: evidence?.omissions ? { ...evidence.omissions } : { stdout: false, stderr: false, exceptionText: false, initializationExtras: false, details: 0, countersSaturated: false },
    truncated: false, details: [],
  };
  // Validate supplied evidence before arithmetic can normalize invalid counters.
  checkedSummary(result);
  const increment = (key: keyof DiagnosticSummary["counters"], amount: number) => {
    if (amount > DIAGNOSTIC_COUNTER_MAX-result.counters[key]) result.omissions.countersSaturated = true;
    result.counters[key] = addDiagnosticCount(result.counters[key], amount);
  };
  if (typeof cause !== "string" && cause != null) increment("exceptions", 1);
  if (selected.code === "DIAGNOSTIC_UNKNOWN") increment("unknownCodes", 1);
  if ((typeof cause !== "string" && cause != null) || (typeof cause === "string" && !codes.has(cause))) result.omissions.exceptionText = true;
  const details = evidence?.details ?? [];
  let full = false;
  const append = (detail: DiagnosticDetail) => {
    if (!full) {
      result.details.push(detailSchema.parse(detail));
      if (encodedBytes(result) <= MAX_DIAGNOSTIC_SUMMARY_BYTES) return;
      result.details.pop(); full = true;
    }
    if (result.omissions.details === DIAGNOSTIC_COUNTER_MAX) result.omissions.countersSaturated = true;
    result.omissions.details = addDiagnosticCount(result.omissions.details, 1); result.truncated = true;
  };
  for (const detail of details) append(detail);
  if (selected.native) append({ origin, phase, code: selected.native });
  return fitDiagnosticSummary(result);
}

export class PilotDiagnosticError extends Error {
  readonly diagnostic: DiagnosticSummary;
  readonly mutationRequestId?: string;
  constructor(diagnostic: DiagnosticSummary, mutationRequestId?: string) {
    const checked = parseDiagnosticSummary(diagnostic);
    super(checked.code);
    this.diagnostic = checked;
    if (typeof mutationRequestId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(mutationRequestId)) this.mutationRequestId = mutationRequestId;
  }
}
export function diagnosticError(cause: unknown, context: DiagnosticContext): PilotDiagnosticError {
  const diagnostic = projectDiagnostic(cause, context);
  let mutationRequestId: string | undefined;
  try { if (cause instanceof PilotDiagnosticError) mutationRequestId = cause.mutationRequestId; }
  catch { /* Optional identity access cannot discard a validated diagnostic. */ }
  return new PilotDiagnosticError(diagnostic, mutationRequestId);
}

/** Lifecycle provenance is attached only by the session's pre-spawn boundary. */
export class ProviderSessionFailure extends PilotDiagnosticError {
  readonly providerState: "not_started" | "unknown";
  constructor(diagnostic: DiagnosticSummary, providerState: "not_started" | "unknown") {
    super(diagnostic);
    this.providerState = providerState;
  }
}
