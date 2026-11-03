import { expect, it } from "vitest";
import { readFailure, accountAllowance } from "../../src/pilot/allowance.js";
import { canonicalJson } from "../../src/domain/hash.js";
import { parseDiagnosticSummary } from "../../src/pilot/diagnostics.js";

it("distinguishes an empty bucket list from an explicitly unknown usage window", () => {
  const now = 1800000000000;
  const observed = { provider: "cursor", status: "ok", updatedAt: now };
  expect(accountAllowance("cursor", { ...observed, buckets: [] }, now).state).toBe("missing");
  expect(accountAllowance("cursor", { ...observed, buckets: null }, now).state).toBe("missing");
  expect(accountAllowance("cursor", { ...observed, buckets: [], weekly: null }, now).state).toBe("unknown");
});

it("retains a named timeout diagnostic without account strings", () => {
  const error = Object.assign(new Error("Request timed out for secret-account@example.test"), { code: "ETIMEDOUT" });
  const result = readFailure("Orca accounts.list(refreshUsage=true)", error);
  expect(result.state).toBe("missing");
  expect(JSON.parse(result.detail)).toMatchObject({ classification: "timeout", code: "ETIMEDOUT" });
  expect(JSON.stringify(result)).not.toContain("secret-account");
});

it("keeps authentication and denial separate from transport failures", () => {
  expect(readFailure("accounts.list", { code: 401 }).state).toBe("authentication_failed");
  expect(readFailure("accounts.list", { code: "permission_denied" }).state).toBe("denied");
  const result = readFailure("accounts.list", Object.assign(new Error("private detail"), { code: "ECONNRESET" }));
  expect(JSON.parse(result.detail)).toMatchObject({ classification: "transport", code: "ECONNRESET" });
  expect(result.state).toBe("missing");
});
it("retains the official RuntimeClient runtime_timeout code", () => {
  const result = readFailure("Orca accounts.list(refreshUsage=true)", { code: "runtime_timeout", message: "private-account" });
  expect(JSON.parse(result.detail)).toMatchObject({ classification: "timeout", code: "runtime_timeout" });
});

it("stores a complete canonical version 1 summary with explicit missing evidence", () => {
  const error = Object.assign(Error("diag-exception-10"), {
    code: "runtime_timeout", stack: "diag-exception-10", extra: { account: "diag-exception-10" },
  });
  const result = readFailure("native source read", error);
  const summary = parseDiagnosticSummary(JSON.parse(result.detail));
  expect(summary).toEqual({
    version: 1, origin: "native-read", phase: "native-read", code: "runtime_timeout", classification: "timeout",
    inputDelivery: "unknown", exit: { state: "unknown", code: null, signal: null, signalState: "unknown" },
    counters: { stdoutBytes: 0, stdoutChunks: 0, stderrBytes: 0, stderrChunks: 0, exceptions: 1, unknownCodes: 0 },
    omissions: { stdout: false, stderr: false, exceptionText: true, initializationExtras: false, details: 0, countersSaturated: false },
    truncated: false, details: [],
  });
  expect(result.detail).toBe(canonicalJson(summary));
  expect(Buffer.byteLength(result.detail, "utf8")).toBeLessThanOrEqual(4096);
  expect(JSON.stringify(result)).not.toContain("diag-exception-10");
});

it.each([
  [401, "HTTP_401", "authentication", "authentication_failed"],
  [403, "HTTP_403", "denial", "denied"],
  ["timeout", "TIMEOUT", "timeout", "missing"],
  ["pErMiSsIoN_dEnIeD", "permission_denied", "denial", "denied"],
  ["quota_exceeded", "quota_exceeded", "exhaustion", "exhausted"],
  ["unsupported", "unsupported", "control", "unsupported"],
  [999999, "DIAGNOSTIC_UNKNOWN", "unknown", "missing"],
  ["runtime_timeout-extra", "DIAGNOSTIC_UNKNOWN", "unknown", "missing"],
  ["permission_denied-diag-exception-10", "DIAGNOSTIC_UNKNOWN", "unknown", "denied"],
  ["authentication-diag-exception-10", "DIAGNOSTIC_UNKNOWN", "unknown", "authentication_failed"],
  ["quota_exceeded-diag-exception-10", "DIAGNOSTIC_UNKNOWN", "unknown", "exhausted"],
] as const)("projects native code %s while preserving its in-memory state", (raw, code, classification, state) => {
  const result = readFailure("native boundary", { code: raw, message: "diag-exception-10", nested: { stack: "diag-exception-10" } });
  expect(result.state).toBe(state);
  expect(JSON.parse(result.detail)).toMatchObject({ version: 1, code, classification });
  expect(JSON.stringify(result)).not.toContain("diag-exception-10");
  expect(result.detail).not.toContain("999999");
});

it.each([
  "Orca accounts.list(refreshUsage=true)", "accounts.list", "native boundary", "native run-create", "native source read",
  "Orca accounts.list(refreshUsage=true) rateLimits.codex", "Orca accounts.list(refreshUsage=true) rateLimits.cursor",
])("retains the approved source label %s", source => {
  expect(readFailure(source, { code: "ETIMEDOUT" }).source).toBe(source);
});

it("normalizes unknown source labels without retaining their text", () => {
  const result = readFailure("private-source-diag-exception-10", { code: "ETIMEDOUT" });
  expect(result.source).toBe("native source read");
  expect(JSON.stringify(result)).not.toContain("diag-exception-10");
});

it("safely handles thrown getters and objects with hostile string conversion", () => {
  const getter = new Proxy({}, { get() { throw Error("diag-exception-10"); } });
  const conversion = { toString() { throw Error("diag-exception-10"); } };
  const rawCode = { code: conversion };
  for (const error of [getter, conversion, rawCode, null, undefined, Symbol("diag-exception-10")]) {
    const result = readFailure("native source read", error);
    expect(result.state).toBe("missing");
    expect(JSON.parse(result.detail)).toMatchObject({ code: "DIAGNOSTIC_UNKNOWN", classification: "unknown" });
    expect(JSON.stringify(result)).not.toContain("diag-exception-10");
  }
});

it("classifies message-only failures in memory without persisting exception text", () => {
  for (const [error, state] of [[Error("authentication diag-exception-10"), "authentication_failed"],
    [Error("forbidden diag-exception-10"), "denied"], ["quota exceeded diag-exception-10", "exhausted"]] as const) {
    const result = readFailure("accounts.list", error);
    expect(result.state).toBe(state);
    expect(JSON.parse(result.detail)).toMatchObject({ code: "DIAGNOSTIC_UNKNOWN", classification: "unknown" });
    expect(JSON.stringify(result)).not.toContain("diag-exception-10");
  }
});

it.each(["codex", "cursor"] as const)("retains the %s allowance source and failure state without account fields", provider => {
  const result = accountAllowance(provider, {
    provider, status: "error", updatedAt: 1800000000000,
    error: { code: "quota_exceeded", message: "diag-exception-10", account: "diag-exception-10" },
    weekly: { usedPercent: 0 }, extraUsage: { enabled: true, unlimited: true },
  }, 1800000000000);
  expect(result.source).toBe(`Orca accounts.list(refreshUsage=true) rateLimits.${provider}`);
  expect(result.state).toBe("exhausted");
  expect(JSON.parse(result.detail)).toMatchObject({ code: "quota_exceeded", classification: "exhaustion" });
  expect(result.detail).not.toContain("extraUsage");
  expect(JSON.stringify(result)).not.toContain("diag-exception-10");
});

it("keeps successful allowance snapshots separate from diagnostic failures and spending authority", () => {
  const now = 1800000000000;
  const result = accountAllowance("cursor", {
    provider: "cursor", status: "ok", updatedAt: now, planType: "premium",
    weekly: { usedPercent: 50, windowMinutes: 10080, resetsAt: now + 1000, account: "diag-exception-10" },
    buckets: [{ name: "private-diag-exception-10", usedPercent: 100 }],
    usageMetadata: { source: "cli", account: "diag-exception-10" },
    extraUsage: { enabled: false, unlimited: false, account: "diag-exception-10" }, account: "diag-exception-10",
  }, now);
  expect(result).toMatchObject({ state: "exhausted", source: "Orca accounts.list(refreshUsage=true) rateLimits.cursor" });
  expect(JSON.parse(result.detail)).toEqual({
    provider: "cursor", updatedAt: now, observedAt: now,
    windows: { session: null, weekly: { usedPercent: 50, windowMinutes: 10080, resetsAt: now + 1000 }, monthly: null },
    buckets: [{ name: "provider bucket", usedPercent: 100, windowMinutes: null, resetsAt: null }],
    planType: "premium", usageSource: "cli", extraUsage: { enabled: false, unlimited: false },
  });
  expect(JSON.stringify(result)).not.toContain("diag-exception-10");
});
