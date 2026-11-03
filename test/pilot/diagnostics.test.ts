import { expect, it } from "vitest";
import { canonicalJson } from "../../src/domain/hash.js";
import {
  addDiagnosticCount, diagnosticClass, diagnosticCode, diagnosticError, fitDiagnosticSummary,
  parseDiagnosticSummary, PilotDiagnosticError, projectDiagnostic, type DiagnosticSummary,
} from "../../src/pilot/diagnostics.js";

// Literal core, independent of the implementation's default/size helpers.
const core = (): DiagnosticSummary => ({
  version: 1, origin: "provider", phase: "inference", code: "NONE", classification: "none", inputDelivery: "unknown",
  exit: { state: "unknown", code: null, signal: null, signalState: "unknown" },
  counters: { stdoutBytes: 0, stdoutChunks: 0, stderrBytes: 0, stderrChunks: 0, exceptions: 0, unknownCodes: 0 },
  omissions: { stdout: false, stderr: false, exceptionText: false, initializationExtras: false, details: 0, countersSaturated: false },
  truncated: false, details: [],
});
const bytes = (value: unknown) => Buffer.byteLength(canonicalJson(value), "utf8");
function atSize(target: number): DiagnosticSummary {
  const long = { origin: "context-driver", phase: "initialization", code: "QUALIFICATION_CACHE_NATIVE_EVIDENCE_UNVERIFIED" } as const;
  const short = { origin: "provider", phase: "input", code: "NONE" } as const;
  for (let count = 1; count <= 128; count++) for (let longer = 0; longer <= count; longer++) for (let digits = 1; digits <= 10; digits++) {
    const value = core();
    value.details = Array.from({ length: count }, (_, i) => i < longer ? long : short);
    value.counters.stdoutBytes = 10**(digits-1);
    if (bytes(value) === target) return value;
  }
  throw Error("No valid boundary fixture for "+target);
}

it("accepts complete summaries at N-1 and N and omits at N+1", () => {
  for (const size of [4095, 4096, 4097]) {
    const value = atSize(size);
    expect(bytes(value)).toBe(size);
    const fitted = fitDiagnosticSummary(value);
    expect(bytes(fitted)).toBeLessThanOrEqual(4096);
    if (size <= 4096) {
      expect(fitted).toEqual(value);
      expect(parseDiagnosticSummary(value)).toEqual(value);
    } else {
      expect(fitted.details).toEqual(value.details.slice(0, -1));
      expect(fitted.omissions.details).toBe(1);
      expect(fitted.truncated).toBe(true);
      expect(fitDiagnosticSummary(value)).toEqual(fitted);
      expect(() => parseDiagnosticSummary(value)).toThrow("DIAGNOSTIC_SUMMARY_TOO_LARGE");
    }
    expect(value.truncated).toBe(false);
  }
});

it("normalizes unknown origin, phase and code without admitting a known suffix", () => {
  const result = projectDiagnostic(Error("private/PROVIDER_INPUT_DEADLINE"), { origin: "secret-origin", phase: "secret-phase" } as any);
  expect(result).toMatchObject({ origin: "unknown", phase: "unknown", code: "DIAGNOSTIC_UNKNOWN", classification: "unknown",
    inputDelivery: "unknown", counters: { exceptions: 1, unknownCodes: 1 }, omissions: { exceptionText: true } });
  expect(JSON.stringify(result)).not.toContain("private/");
  expect(diagnosticCode("ORCA_UNLISTED")).toBe("DIAGNOSTIC_UNKNOWN");
  expect(diagnosticCode("runtime_timeout-extra")).toBe("DIAGNOSTIC_UNKNOWN");
  expect(diagnosticCode("provider_input_deadline")).toBe("DIAGNOSTIC_UNKNOWN");
});

it("projects nested exception properties with exact message priority and finite native details", () => {
  const cause = Object.assign(Error("PROVIDER_INPUT_DEADLINE"), { code: "econnreset", response: { error: { code: 403, secret: "nested-secret" } }, secret: "outer-secret" });
  expect(projectDiagnostic(cause, { origin: "provider", phase: "input" })).toMatchObject({
    code: "PROVIDER_INPUT_DEADLINE", classification: "timeout",
    details: [{ origin: "provider", phase: "input", code: "ECONNRESET" }],
  });
  expect(diagnosticCode({ response: { error: { code: 401 } } })).toBe("HTTP_401");
  expect(diagnosticCode({ code: "pErMiSsIoN_dEnIeD" })).toBe("permission_denied");
  expect(diagnosticCode({ code: 404 })).toBe("DIAGNOSTIC_UNKNOWN");
  expect(JSON.stringify(projectDiagnostic(cause, { origin: "provider", phase: "input" }))).not.toContain("secret");
});

it("catches throwing property access and emits unknown without invoking toString", () => {
  const cause = new Proxy({}, { get() { throw Error("getter-secret"); } });
  const result = projectDiagnostic(cause, { origin: "provider", phase: "bootstrap" });
  expect(result.code).toBe("DIAGNOSTIC_UNKNOWN");
  expect(result.omissions.exceptionText).toBe(true);
  expect(diagnosticCode({ toString() { throw Error("must not run"); } })).toBe("DIAGNOSTIC_UNKNOWN");
});

it("validates all counter maxima and saturates only safe nonnegative totals", () => {
  const value = core();
  for (const key of Object.keys(value.counters) as (keyof typeof value.counters)[]) {
    value.counters[key] = 2147483647;
    expect(parseDiagnosticSummary(value).counters[key]).toBe(2147483647);
    for (const invalid of [-1, 0.5, NaN, Infinity, 2147483648]) {
      expect(() => parseDiagnosticSummary({ ...value, counters: { ...value.counters, [key]: invalid } })).toThrow("DIAGNOSTIC_SUMMARY_INVALID");
    }
  }
  expect(addDiagnosticCount(2147483646, 1)).toBe(2147483647);
  expect(addDiagnosticCount(2147483647, Number.MAX_SAFE_INTEGER)).toBe(2147483647);
  for (const invalid of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER+1]) expect(() => addDiagnosticCount(0, invalid)).toThrow("DIAGNOSTIC_SUMMARY_INVALID");
  const saturated = projectDiagnostic(Error("unknown"), { origin: "provider", phase: "input" }, { counters: { ...value.counters } });
  expect(saturated.counters.exceptions).toBe(2147483647);
  expect(saturated.counters.unknownCodes).toBe(2147483647);
  expect(saturated.omissions.countersSaturated).toBe(true);
});

it("fits a maximum-size fixed core without dropping original exit evidence", () => {
  const value = core();
  value.origin = "context-driver"; value.phase = "initialization";
  value.code = "QUALIFICATION_CACHE_NATIVE_EVIDENCE_UNVERIFIED"; value.classification = "control";
  value.inputDelivery = "attempted_unacknowledged";
  value.exit = { state: "observed", code: Number.MIN_SAFE_INTEGER, signal: "SIGVTALRM", signalState: "observed" };
  for (const key of Object.keys(value.counters) as (keyof typeof value.counters)[]) value.counters[key] = 2147483647;
  value.omissions = { stdout: true, stderr: true, exceptionText: true, initializationExtras: true, details: 2147483647, countersSaturated: true };
  value.truncated = true;
  expect(bytes(value)).toBeLessThanOrEqual(4096);
  expect(fitDiagnosticSummary(value)).toEqual(value);
  expect(parseDiagnosticSummary(value).exit.code).toBe(Number.MIN_SAFE_INTEGER);
});

it("saturates omitted detail counts while retaining the first failure", () => {
  const value = atSize(4097);
  value.code = "PROVIDER_INPUT_DEADLINE"; value.classification = "timeout";
  value.omissions.details = 2147483647;
  const fitted = fitDiagnosticSummary(value);
  expect(fitted.code).toBe("PROVIDER_INPUT_DEADLINE");
  expect(fitted.omissions.details).toBe(2147483647);
  expect(fitted.omissions.countersSaturated).toBe(true);
  expect(fitted.truncated).toBe(true);
  expect(bytes(fitted)).toBeLessThanOrEqual(4096);
});

it.each([
  ["NONE", "none"], ["NATIVE_RESULT_DEADLINE", "timeout"], ["ETIMEDOUT", "timeout"],
  ["HTTP_401", "authentication"], ["HTTP_403", "denial"], ["quota_exceeded", "exhaustion"],
  ["EPIPE", "transport"], ["PROVIDER_INITIALIZATION_CANCELLED", "cancellation"],
  ["INVALID_NORMAL-PROBE_RESULT", "validation"], ["NATIVE_OUTCOME_NOT_RECORDED", "persistence"],
  ["PROVIDER_STDERR_UNCLASSIFIED", "protocol"], ["CODEX_REQUIREMENTS_DENIED", "control"],
] as const)("classifies %s as %s", (code, wanted) => { expect(diagnosticClass(code)).toBe(wanted); });

it("strictly rejects malformed external summaries and retains explicit absent evidence", () => {
  for (const value of [{ ...core(), padding: "secret" }, { ...core(), code: "unlisted" },
    { ...core(), exit: { ...core().exit, signal: "secret-signal" } }, { ...core(), counters: { ...core().counters, text: "secret" } }])
    expect(() => parseDiagnosticSummary(value)).toThrow("DIAGNOSTIC_SUMMARY_INVALID");
  expect(projectDiagnostic("NONE", { origin: "provider", phase: "bootstrap" })).toMatchObject({
    inputDelivery: "unknown", exit: { state: "unknown", code: null, signal: null, signalState: "unknown" },
    counters: { stdoutBytes: 0, stderrBytes: 0 }, omissions: { stdout: false, stderr: false },
  });
});

it("carries a validated finite summary and only an owned UUID mutation identity", () => {
  const summary = projectDiagnostic(Error("EPIPE"), { origin: "native-driver", phase: "input" });
  const error = new PilotDiagnosticError(summary, "f3904db2-476a-46e2-81ab-004a694debe1");
  expect(error.message).toBe("EPIPE");
  expect(error.mutationRequestId).toBe("f3904db2-476a-46e2-81ab-004a694debe1");
  expect(new PilotDiagnosticError(summary, "unowned-secret").mutationRequestId).toBeUndefined();
  expect(projectDiagnostic(error, { origin: "cli", phase: "persistence" })).toEqual(summary);
  expect(diagnosticError(Error("exception-secret"), { origin: "provider", phase: "validation" }).message).toBe("DIAGNOSTIC_UNKNOWN");
  expect(Object.keys(error)).not.toContain("cause");
});

it("round 1: diagnosticError contains throwing getPrototypeOf access", () => {
  const cause = new Proxy({}, { getPrototypeOf() { throw Error("diag-exception-10"); } });
  let carrier: PilotDiagnosticError | undefined;
  expect(() => { carrier = diagnosticError(cause, { origin: "provider", phase: "input" }); }).not.toThrow();
  expect(carrier).toBeInstanceOf(PilotDiagnosticError);
  expect(carrier?.message).toBe("DIAGNOSTIC_UNKNOWN");
  expect(carrier?.diagnostic).toMatchObject({ code: "DIAGNOSTIC_UNKNOWN", classification: "unknown", phase: "input", omissions: { exceptionText: true } });
  expect(JSON.stringify(carrier)).not.toContain("diag-exception-10");
});

it("round 1: diagnosticError preserves a valid summary when mutationRequestId access throws", () => {
  const summary = core();
  summary.origin = "native-driver"; summary.phase = "input"; summary.code = "EPIPE"; summary.classification = "transport";
  summary.inputDelivery = "attempted_unacknowledged";
  summary.exit = { state: "observed", code: 7, signal: null, signalState: "none" };
  const cause = new PilotDiagnosticError(summary);
  Object.defineProperty(cause, "mutationRequestId", { get() { throw Error("diag-exception-10"); } });
  let carrier: PilotDiagnosticError | undefined;
  expect(() => { carrier = diagnosticError(cause, { origin: "cli", phase: "persistence" }); }).not.toThrow();
  expect(carrier?.diagnostic).toEqual(summary);
  expect(carrier?.message).toBe("EPIPE");
  expect(carrier?.mutationRequestId).toBeUndefined();
  expect(JSON.stringify(carrier)).not.toContain("diag-exception-10");
});

it("round 1: diagnosticError propagates a valid owned UUID without replacing the carried diagnostic", () => {
  const summary = core(); summary.code = "EPIPE"; summary.classification = "transport";
  const cause = new PilotDiagnosticError(summary, "f3904db2-476a-46e2-81ab-004a694debe1");
  const carrier = diagnosticError(cause, { origin: "cli", phase: "persistence" });
  expect(carrier.diagnostic).toEqual(summary);
  expect(carrier.mutationRequestId).toBe("f3904db2-476a-46e2-81ab-004a694debe1");
});
