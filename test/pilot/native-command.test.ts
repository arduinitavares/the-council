import { expect, it } from "vitest";
import { commandFromClient } from "../../src/pilot/native-command.js";
import { readFailure } from "../../src/pilot/allowance.js";
import type { ProcessReceipt } from "../../src/orca/client.js";

// In-memory native receipts acquire no child processes, streams, timers or temporary files.
function receipt(envelope: unknown, overrides: Partial<ProcessReceipt> = {}): ProcessReceipt {
  return { stdout: Buffer.from(JSON.stringify(envelope)), stderr: Buffer.alloc(0), exitCode: 0,
    signal: null, overflow: false, timedOut: false, pid: null, closed: true, ...overrides };
}
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try { await promise; }
  catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw Error("expected native command rejection");
}

it("keeps structured nonzero native error codes without retaining account messages", async () => {
  const command = commandFromClient({run:async()=>({stdout:Buffer.from(JSON.stringify({ok:false,error:{code:"permission_denied",message:"private-account@example.test"},_meta:{runtimeId:"runtime"}})),stderr:Buffer.alloc(0),exitCode:1,signal:null,overflow:false,timedOut:false,pid:1,closed:true})},"runtime");
  try {await command(["orchestration","task-create"],"/synthetic",1000);throw Error("expected failure");}
   catch(error){const diagnostic=readFailure("native boundary",error);expect(JSON.parse(diagnostic.detail)).toMatchObject({classification:"denial",code:"permission_denied"});expect(diagnostic.state).toBe("denied");expect(JSON.stringify(diagnostic)).not.toContain("private-account");}
});

it("rejects malformed success without interpolating an unknown native exception code", async () => {
  const command = commandFromClient({ run: async () => receipt({
    ok: true, result: { extra: "diag-stdout-10" },
    error: { code: "unknown-diag-exception-10", message: "diag-exception-10", stack: "diag-exception-10",
      nested: { account: "diag-exception-10" } },
  }) }, "runtime");
  const error = await rejection(command(["status", "--json"], "/synthetic", 1000));
  const observation = readFailure("native boundary", error);
  expect.soft(error.message).not.toContain("diag-exception-10");
  expect.soft(JSON.stringify(observation)).not.toContain("diag-exception-10");
  expect(error.message).toBe("ORCA_INVALID_ENVELOPE");
  expect(JSON.parse(observation.detail)).toMatchObject({ version: 1, code: "ORCA_INVALID_ENVELOPE", classification: "control" });
  expect(JSON.stringify(error)).not.toContain("diag-stdout-10");
});

it.each([
  ["timeout", "TIMEOUT", "timeout", "missing"],
  ["permission_denied", "permission_denied", "denial", "denied"],
  [401, "HTTP_401", "authentication", "authentication_failed"],
  ["runtime_timeout", "runtime_timeout", "timeout", "missing"],
  ["quota_exceeded", "quota_exceeded", "exhaustion", "exhausted"],
  ["pErMiSsIoN_dEnIeD", "permission_denied", "denial", "denied"],
  [999999, "DIAGNOSTIC_UNKNOWN", "unknown", "missing"],
  ["permission_denied-extra", "DIAGNOSTIC_UNKNOWN", "unknown", "missing"],
  ["ORCA_diag-exception-10", "DIAGNOSTIC_UNKNOWN", "unknown", "missing"],
] as const)("projects failed native envelope code %s exactly", async (raw, code, classification, state) => {
  const command = commandFromClient({ run: async () => receipt({ ok: false,
    error: { code: raw, message: "diag-exception-10", stack: "diag-exception-10", nested: { account: "diag-exception-10" } },
    _meta: { runtimeId: "runtime" },
  }, { exitCode: 1 }) }, "runtime");
  const error = await rejection(command(["orchestration", "run-create"], "/synthetic", 1000));
  const result = readFailure("native run-create", error);
  expect(error.message).toBe(code);
  expect(result.state).toBe(state);
  expect(JSON.parse(result.detail)).toMatchObject({ code, classification });
  expect(JSON.stringify([error, result])).not.toContain("diag-exception-10");
  expect(JSON.stringify([error, result])).not.toContain("999999");
});

it("keeps invalid-envelope precedence over its finite native transport detail", async () => {
  const command = commandFromClient({ run: async () => receipt(null, { stdout: Buffer.from("diag-exception-10") }) });
  const error = await rejection(command(["status", "--json"], "/synthetic", 1000));
  const result = readFailure("native boundary", error);
  expect(error.message).toBe("ORCA_INVALID_ENVELOPE");
  expect(JSON.parse(result.detail)).toMatchObject({ code: "ORCA_INVALID_ENVELOPE", classification: "control",
    details: [{ origin: "native-driver", phase: "native-read", code: "invalid_runtime_response" }] });
  expect(JSON.stringify([error, result])).not.toContain("diag-exception-10");
});

it("rejects multiple stderr chunks without retaining them or replacing the primary code", async () => {
  const command = commandFromClient({ run: async () => receipt({ ok: true, result: {}, _meta: { runtimeId: "runtime" } }, {
    stderr: Buffer.concat([Buffer.from("diag-stderr-a-10"), Buffer.from("diag-stderr-b-10")]),
  }) }, "runtime");
  const error = await rejection(command(["status", "--json"], "/synthetic", 1000));
  const result = readFailure("native boundary", error);
  expect(error.message).toBe("ORCA_CLI_DIAGNOSTICS_PRESENT");
  expect(JSON.parse(result.detail)).toMatchObject({ code: "ORCA_CLI_DIAGNOSTICS_PRESENT", classification: "control",
    details: [{ origin: "native-driver", phase: "native-read", code: "invalid_runtime_response" }] });
  expect(JSON.stringify([error, result])).not.toContain("diag-stderr-a-10");
  expect(JSON.stringify([error, result])).not.toContain("diag-stderr-b-10");
});

it.each([
  [{ timedOut: true }, "runtime_timeout", "timeout"],
  [{ overflow: true }, "invalid_runtime_response", "transport"],
  [{ closed: false }, "invalid_runtime_response", "transport"],
] as const)("rejects unsettled native receipt %j", async (overrides, code, classification) => {
  const command = commandFromClient({ run: async () => receipt({ ok: true, result: {}, _meta: { runtimeId: "runtime" } }, overrides) });
  const error = await rejection(command(["status", "--json"], "/synthetic", 1000));
  expect(error.message).toBe(code);
  expect(JSON.parse(readFailure("native boundary", error).detail)).toMatchObject({ code, classification });
});

it("projects a client rejection without leaking arbitrary exception properties", async () => {
  const cause = Object.assign(Error("diag-exception-10"), { code: "ECONNRESET", stack: "diag-exception-10", extra: { account: "diag-exception-10" } });
  const command = commandFromClient({ run: async () => { throw cause; } });
  const error = await rejection(command(["status", "--json"], "/synthetic", 1000));
  expect(error.message).toBe("ECONNRESET");
  expect(JSON.parse(readFailure("native boundary", error).detail)).toMatchObject({ code: "ECONNRESET", classification: "transport" });
  expect(JSON.stringify(error)).not.toContain("diag-exception-10");
});

it("rejects a different runtime both before and after learning the binding", async () => {
  const first = receipt({ ok: true, result: { value: "checked-result" }, _meta: { runtimeId: "runtime" } });
  const changed = receipt({ ok: true, result: {}, _meta: { runtimeId: "other" } });
  const pinned = commandFromClient({ run: async () => changed }, "runtime");
  await expect(pinned(["status", "--json"], "/synthetic", 1000)).rejects.toThrow("ORCA_RUNTIME_BINDING_MISMATCH");
  const receipts = [first, changed];
  const learned = commandFromClient({ run: async () => receipts.shift()! });
  expect(await learned(["status", "--json"], "/synthetic", 1000)).toEqual({ value: "checked-result" });
  await expect(learned(["status", "--json"], "/synthetic", 1000)).rejects.toThrow("ORCA_RUNTIME_BINDING_MISMATCH");
});

it("preserves the agent-context registry validation boundary", async () => {
  const valid = { schemaVersion: 1, commandCount: 1, commands: [{ command: "status" }] };
  const command = commandFromClient({ run: async () => receipt(valid) });
  expect(await command(["agent-context"], "/synthetic", 1000)).toEqual(valid);
  const invalid = commandFromClient({ run: async () => receipt({ ...valid, commandCount: 2 }) });
  await expect(invalid(["agent-context"], "/synthetic", 1000)).rejects.toThrow("ORCA_COMMAND_REGISTRY_INVALID");
});
it("rejects unexpected stderr on an otherwise successful native command", async () => {
  const command = commandFromClient({run:async()=>({stdout:Buffer.from(JSON.stringify({ok:true,result:{},_meta:{runtimeId:"runtime"}})),stderr:Buffer.from("unexpected diagnostic"),exitCode:0,signal:null,overflow:false,timedOut:false,pid:1,closed:true})},"runtime");
  await expect(command(["status","--json"],"/synthetic",1000)).rejects.toThrow("ORCA_CLI_DIAGNOSTICS_PRESENT");
});
