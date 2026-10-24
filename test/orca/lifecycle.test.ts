import { expect, it } from "vitest";
import { makeBinding } from "../fixtures/builders.js";
async function observations() {
  const m = await import("../../src/orca/observations.js").catch(() => null);
  expect(m).not.toBeNull();
  return m!;
}
it("provider SUCCESS and exit do not settle live/unverifiable children or watchdogs", async () => {
  const m = await observations(),
    b = makeBinding();
  const proof = {
    attemptId: b.attemptId,
    authority: b.authority,
    worker: { status: "exited" as const, exitCode: 0 },
    children: [{ id: "mcp", status: "live" as const, exitCode: null }],
    watchdog: { id: "watch", status: "exited" as const, exitCode: 0 },
    complete: true,
    receiptRefs: [
      {
        kind: "receipt",
        sha256: "a".repeat(64),
        path: "/tmp/synthetic-receipt",
        bytes: 1,
      },
    ],
  };
  expect(m.aggregateSettlement(b, proof, "watch")).toMatchObject({
    settled: false,
  });
  expect(
    m.aggregateSettlement(
      b,
      {
        ...proof,
        children: [{ id: "mcp", status: "unverifiable", exitCode: null }],
      },
      "watch",
    ),
  ).toMatchObject({ settled: false });
  expect(
    m.aggregateSettlement(
      b,
      {
        ...proof,
        children: [],
        watchdog: { id: "watch", status: "live", exitCode: null },
      },
      "watch",
    ),
  ).toMatchObject({ settled: false });
  expect(
    m.aggregateSettlement(b, { ...proof, children: [] }, "watch"),
  ).toMatchObject({ settled: true });
});
it("unknown codes remain unknown and a lost connection remains unverifiable", async () => {
  const m = await observations();
  expect(m.observationFromFailure()).toEqual({
    status: "unverifiable",
    rawReceipts: [],
    exitCode: null,
  });
});

it("a valid final result with a live child cannot authorize aggregate settlement, pause, or release", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { WorkerBridge } = await import("../../src/workers/bridge.js");
  const f = fixture(),
    t = new OrcaTransport(f.store, f.driver),
    w = new WorkerBridge(f.store, t, f.now),
    receipt = (await w.dispatch(f.reservation, f.prepare))!,
    binding = receipt.binding;
  expect(
    w.ingest(
      Buffer.from(
        JSON.stringify({
          kind: "clarification",
          ready: true,
          questions: [],
          methodIds: ["test-method"],
        }),
      ),
      binding,
    ).status,
  ).toBe("valid");
  f.setProof({
    attemptId: binding.attemptId,
    authority: binding.authority,
    worker: { status: "exited", exitCode: 0 },
    children: [{ id: "still-live-mcp", status: "live", exitCode: null }],
    watchdog: { id: "watchdog", status: "live", exitCode: null },
    complete: true,
    receiptRefs: [],
  });
  await w.observe(binding);
  expect(f.store.load("run1").context.control.settledResourceTasks).toEqual([]);
  expect(f.store.load("run1").context.activeBudget.status).toBe("active");
  expect((await t.release(binding)).released).toBe(false);
  expect(f.counts().releases).toBe(0);
  f.store.close();
});
it("invalid output terminally blocks inference, consumes no repair call and closes only after all resources settle", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { WorkerBridge } = await import("../../src/workers/bridge.js");
  const f = fixture(),
    t = new OrcaTransport(f.store, f.driver),
    w = new WorkerBridge(f.store, t, f.now),
    r = (await w.dispatch(f.reservation, f.prepare))!;
  expect(w.ingest(Buffer.from('{"kind":'), r.binding)).toEqual({
    status: "invalid",
    code: "INVALID_WORKER_RESULT",
  });
  const s = f.store.load("run1");
  expect(s.context.inferenceBlock).toBe("INVALID_WORKER_RESULT");
  expect(s.state).toBe("settling");
  expect(s.context.callsReserved).toBe(3);
  await w.observe(r.binding);
  expect(f.counts().launches).toBe(1);
  expect(f.store.load("run1").context.ballots).toEqual([]);
  f.store.close();
});

it("closes invalid-output time terminally only after aggregate settlement and preserves counters against resume/extensions", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { WorkerBridge } = await import("../../src/workers/bridge.js");
  const f = fixture(),
    t = new OrcaTransport(f.store, f.driver),
    w = new WorkerBridge(f.store, t, f.now),
    r = (await w.dispatch(f.reservation, f.prepare))!;
  f.commit(
    { kind: "WATCHDOG_ARMED", data: f.armProof(r.binding) },
    "adapter",
    r.binding.phase,
  );
  w.ingest(Buffer.from("invalid"), r.binding);
  const pending = f.store.load("run1");
  expect(pending.context.activeBudget.status).toBe("active");
  await w.observe(r.binding);
  const proof = f.store.artifacts.putArtifact(
    Buffer.from("synthetic complete resource receipt"),
    "settlement",
  );
  f.commit({ kind: "SETTLED", data: { receipt: proof } }, "adapter");
  const end = f.store.load("run1");
  expect(end.state).toBe("blocked");
  expect(end.context.activeBudget.status).toBe("settled");
  expect(end.context.callsReserved).toBe(pending.context.callsReserved);
  expect(() => f.commit({ kind: "RESUME", data: {} }, "controller")).toThrow(
    "Terminal inference block",
  );
  expect(() =>
    f.commit(
      {
        kind: "EXTEND",
        data: {
          extension: {
            id: "extension",
            baseRevision: end.revision,
            authorizationReceipt: "authorization",
            expiresAt: 1000000,
            additionalClarificationBatches: 1,
            additionalRounds: 1,
            additionalActiveBudgetMs: 1000,
          },
        },
      },
      "user",
    ),
  ).toThrow();
  expect(f.counts().launches).toBe(1);
  f.store.close();
});

it("requires positive resource receipts rather than an empty successful status assertion", async () => {
  const m = await observations(),
    b = makeBinding();
  expect(
    m.aggregateSettlement(b, {
      attemptId: b.attemptId,
      authority: b.authority,
      worker: { status: "exited", exitCode: 0 },
      children: [],
      watchdog: { id: "watchdog", status: "exited", exitCode: 0 },
      complete: true,
      receiptRefs: [],
    }).settled,
  ).toBe(false);
});

it("cannot claim aggregate settlement without the registered watchdog arming receipt", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { WorkerBridge } = await import("../../src/workers/bridge.js");
  const f = fixture(),
    t = new OrcaTransport(f.store, f.driver),
    w = new WorkerBridge(f.store, t, f.now),
    r = (await w.dispatch(f.reservation, f.prepare))!;
  expect((await t.resources(r.binding)).settled).toBe(false);
  f.store.close();
});
