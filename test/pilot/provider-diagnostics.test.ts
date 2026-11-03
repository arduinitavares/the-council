import { expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pilotPayloadSchemas, pilotResultEnvelopeSchema } from "../../src/pilot/payload.js";
import { diagnosticCanaries, diagnosticFixture, syntheticDiagnosticSession } from "./diagnostic-fixture.js";
import { preparedReportSchema, providerReportSchema } from "../../src/pilot/wrapper-contract.js";
import { parseDiagnosticSummary } from "../../src/pilot/diagnostics.js";

it("does not persist stdout or initialization canaries through the existing session API", async () => {
  const h = await diagnosticFixture("normal");
  try {
    const report = await h.run();
    expect(report.status).toBe("completed");
    expect(report.calls).toBe(1);
    const envelope = pilotResultEnvelopeSchema.parse(report.result);
    expect(pilotPayloadSchemas.review.parse(envelope.payload).assessment).toBe(diagnosticCanaries.requestedResult);
    expect(report.process).toMatchObject({ closed: true, groupSettled: true, trackedDescendantsSettled: true,
      parsingSettled: true, processScansSettled: true, timersSettled: true, inputDelivered: true, escapedDescendantObserved: false });
    expect(h.sourceTrace()).toContain(diagnosticCanaries.stdout);
    expect(h.sourceTrace()).toContain(diagnosticCanaries.initExtra);
    expect(JSON.stringify(report)).not.toContain(diagnosticCanaries.stdout);
    expect(readFileSync(join(h.directory, "prepared.json"), "utf8")).not.toContain(diagnosticCanaries.initExtra);
  } finally { await h.finish(); }
}, 10000);

function settled(report: Awaited<ReturnType<Awaited<ReturnType<typeof diagnosticFixture>>["run"]>>) {
  expect(report.process).toMatchObject({ providerStarted: true, closed: true, groupSettled: true, trackedDescendantsSettled: true,
    parsingSettled: true, processScansSettled: true, timersSettled: true, escapedDescendantObserved: false });
}

it.each(["agy-stream", "cursor-stream", "codex-app-server"] as const)("projects valid %s initialization after actual validation", async protocol => {
  const h = await diagnosticFixture("normal", protocol);
  try {
    const report = await h.run();
    settled(report);
    expect(report).toMatchObject({ version: 2, status: "completed", calls: 1, error: null,
      diagnostic: { code: "NONE", classification: "none", inputDelivery: "acknowledged", omissions: { stdout: true, initializationExtras: true } },
      init: { state: "verified", protocol, model: h.assignment.selection.model, cwd: h.assignment.recipe.cwd } });
    if (report.init.state !== "verified") throw Error("Expected verified fixture");
    if (report.init.protocol === "codex-app-server") {
      expect(report.init).toMatchObject({ tools: { state: "unknown" }, activePermissionProfile: { id: "council_packet", extends: null }, instructionSources: [] });
      expect(report.init.configDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(report.selectedAgent.observed).toBeNull();
    } else {
      expect(report.init.tools).toEqual([]);
      expect(report.init.permission).toEqual(protocol === "agy-stream" ? { state: "verified", value: "request-review" } : { state: "unexposed", value: null });
      expect(report.init.agent).toEqual({ state: "verified", value: "council-packet" });
      expect(report.selectedAgent.observed).toBe("council-packet");
    }
    expect(providerReportSchema.parse(report)).toEqual(report);
    expect(h.sourceTrace()).toContain(diagnosticCanaries.initExtra);
    expect(JSON.stringify(report)).not.toContain(diagnosticCanaries.initExtra);
    expect(JSON.stringify(report)).not.toContain(diagnosticCanaries.stdout);
    const prepared = JSON.parse(readFileSync(join(h.directory, "prepared.json"), "utf8"));
    expect(preparedReportSchema.parse(prepared)).toEqual(prepared);
    expect(prepared).toMatchObject({ version: 2, ready: true, error: null });
    expect(JSON.stringify(prepared)).not.toContain(diagnosticCanaries.initExtra);
    expect(parseDiagnosticSummary(report.diagnostic)).toEqual(report.diagnostic);
    expect(() => providerReportSchema.parse({ ...report, stdout: "secret" })).toThrow();
    expect(() => providerReportSchema.parse({ ...report, process: { ...report.process, secret: true } })).toThrow();
    expect(() => preparedReportSchema.parse({ ...prepared, error: "secret" })).toThrow();
  } finally { await h.finish(); }
}, 10000);

it.each(["agy-stream", "cursor-stream", "codex-app-server"] as const)("does not mark known %s init fields as extras", async protocol => {
  const h = await diagnosticFixture("normal", protocol, { extras: false });
  try {
    const report = await h.run(); settled(report);
    expect(report.status).toBe("completed");
    expect(report.diagnostic.omissions.initializationExtras).toBe(false);
  } finally { await h.finish(); }
}, 10000);

it("does not infer tools from missing initialization", async () => {
  const h = await diagnosticFixture("invalid-init");
  try {
    const report = await h.run(); settled(report);
    expect(report).toMatchObject({ status: "failed", calls: 0, error: "PROVIDER_EFFECTIVE_CONTROLS_UNVERIFIED",
      init: { state: "unobserved", protocol: "agy-stream" }, diagnostic: { inputDelivery: "not_attempted", phase: "initialization" } });
    expect(report.init).not.toHaveProperty("tools");
    expect(existsSync(join(h.directory, "inference-started.json"))).toBe(false);
    const prepared = JSON.parse(readFileSync(join(h.directory, "prepared.json"), "utf8"));
    expect(preparedReportSchema.parse(prepared)).toMatchObject({ version: 2, ready: false, error: "PROVIDER_EFFECTIVE_CONTROLS_UNVERIFIED", init: report.init });
    const unresolved = { ...report, calls: null, initializations: null, process: { ...report.process, pid: null, providerStarted: null,
      exitCode: null, signal: null, closed: false, groupSettled: false, trackedDescendantsSettled: false, timersSettled: false,
      parsingSettled: false, processScansSettled: false, escapedDescendantObserved: null, inputDelivered: null, stopRequested: null, descendantEvidence: null } };
    expect(providerReportSchema.parse(unresolved)).toEqual(unresolved);
  } finally { await h.finish(); }
}, 10000);

it("keeps validated multibyte results larger than the diagnostic budget exact", async () => {
  const assessment = "秘密🙂".repeat(600);
  const h = await diagnosticFixture("normal", "agy-stream", { assessment });
  try {
    const report = await h.run(); settled(report);
    expect(report.status).toBe("completed");
    expect(pilotPayloadSchemas.review.parse(pilotResultEnvelopeSchema.parse(report.result).payload).assessment).toBe(assessment);
    expect(Buffer.byteLength(JSON.stringify(report.diagnostic))).toBeLessThanOrEqual(4096);
  } finally { await h.finish(); }
}, 10000);

it("keeps foreign Codex final identity out of private bindings", async () => {
  const h = await diagnosticFixture("normal", "codex-app-server", { foreignThread: true });
  try {
    const report = await h.run(); settled(report);
    expect(report).toMatchObject({ status: "failed", error: "PROVIDER_CONVERSATION_UNBOUND", conversationId: null, result: null });
  } finally { await h.finish(); }
}, 10000);

it.each(["cancel-before-input", "cancel-active"] as const)("records actual delivery and cancellation facts for %s", async mode => {
  const h = await diagnosticFixture(mode);
  try {
    const report = await h.run(); settled(report);
    if (mode === "cancel-before-input") {
      expect(report).toMatchObject({ status: "failed", calls: 0, error: "PROVIDER_INITIALIZATION_CANCELLED", cancellation: null,
        diagnostic: { code: "PROVIDER_INITIALIZATION_CANCELLED", classification: "cancellation", inputDelivery: "not_attempted", phase: "cancellation" } });
      expect(existsSync(join(h.directory, "input.json"))).toBe(false);
      expect(existsSync(join(h.directory, "inference-started.json"))).toBe(false);
    } else expect(report).toMatchObject({ status: "cancelled", calls: 1, error: null,
      cancellation: { acknowledged: true, activeTurn: { source: "AGY original user_input DONE", identity: "diagnostic-session" } },
      diagnostic: { code: "NONE", classification: "none", inputDelivery: "acknowledged", phase: "cancellation" } });
  } finally { await h.finish(); }
}, 10000);

it("excludes two separately acknowledged real stderr canaries", async () => {
  const h = await diagnosticFixture("stderr");
  try {
    const report = await h.run(); settled(report);
    expect(report).toMatchObject({ status: "failed", error: "PROVIDER_STDERR_UNCLASSIFIED", calls: 1,
      diagnostic: { counters: { stderrBytes: 32 }, omissions: { stderr: true } } });
    expect(JSON.stringify(report)).not.toContain(diagnosticCanaries.stderrA);
    expect(JSON.stringify(report)).not.toContain(diagnosticCanaries.stderrB);
  } finally { await h.finish(); }
}, 10000);

it("counts multibyte input bytes across chunks without retaining text", async () => {
  for (const size of [4095, 4096, 4097]) {
    const text = Buffer.from("秘密🙂"+diagnosticCanaries.stderrA+diagnosticCanaries.stderrB);
    const all = Buffer.concat([text, Buffer.alloc(size-text.length, 120)]);
    const chunks = [all.subarray(0, 1), all.subarray(1, 8), all.subarray(8)];
    expect(chunks.reduce((n, chunk) => n+chunk.length, 0)).toBe(size);
    expect(all.toString("utf8").length).toBeLessThan(size);
    const { report, stdoutBytes, stdoutChunks, inferenceExists } = await syntheticDiagnosticSession({ stderr: chunks });
    expect(report).toMatchObject({ status: "failed", calls: 0, diagnostic: {
      inputDelivery: "not_attempted", counters: { stdoutBytes, stdoutChunks, stderrBytes: size, stderrChunks: 3 },
      omissions: { stdout: true, stderr: true } } });
    expect(inferenceExists).toBe(false);
    expect(JSON.stringify(report)).not.toContain(diagnosticCanaries.stderrA);
    expect(JSON.stringify(report)).not.toContain(diagnosticCanaries.stderrB);
    expect(JSON.stringify(report)).not.toContain("秘密");
  }
});

it("preserves first failure and measures every stderr chunk", async () => {
  const chunks = [Buffer.from(diagnosticCanaries.stderrA), Buffer.from(diagnosticCanaries.stderrB)];
  const { report, inferenceExists } = await syntheticDiagnosticSession({ firstFailure: true, stderr: chunks });
  expect(report).toMatchObject({ status: "failed", error: "PROVIDER_STREAM_EVENT_UNSUPPORTED", calls: 0,
    diagnostic: { code: "PROVIDER_STREAM_EVENT_UNSUPPORTED", counters: { stderrBytes: 32, stderrChunks: 2 } } });
  expect(inferenceExists).toBe(false);
});

it("keeps attempted writes reserved", async () => {
  const { report, inferenceExists } = await syntheticDiagnosticSession({ writeFailure: true });
  expect(report).toMatchObject({ status: "failed", calls: 1, error: "DIAGNOSTIC_UNKNOWN", process: { inputDelivered: false, exitCode: 7 },
    diagnostic: { code: "DIAGNOSTIC_UNKNOWN", inputDelivery: "attempted_unacknowledged", phase: "input",
      exit: { state: "observed", code: 7, signal: null, signalState: "none" }, omissions: { exceptionText: true } } });
  expect(inferenceExists).toBe(false);
  expect(JSON.stringify(report)).not.toContain(diagnosticCanaries.exception);
});

it("projects exceptions at the real strict artifact-read boundary before reserving input", async () => {
  const h = await diagnosticFixture("normal");
  h.failNextInputRead();
  try {
    const report = await h.run(); settled(report);
    expect(report).toMatchObject({ status: "failed", calls: 0, error: "DIAGNOSTIC_UNKNOWN", diagnostic: {
      code: "DIAGNOSTIC_UNKNOWN", phase: "input", inputDelivery: "not_attempted", omissions: { exceptionText: true } } });
    expect(existsSync(join(h.directory, "inference-started.json"))).toBe(false);
    expect(JSON.stringify(report)).not.toContain(diagnosticCanaries.exception);
    expect(readFileSync(join(h.directory, "prepared.json"), "utf8")).not.toContain(diagnosticCanaries.exception);
  } finally { await h.finish(); }
}, 10000);
