import { expect, it } from "vitest";
async function bridge() {
  const m = await import("../../src/workers/bridge.js").catch(() => null);
  expect(m).not.toBeNull();
  return m!;
}
it("never turns an uncertain dispatched fence into a replacement launch", async () => {
  const m = await bridge();
  expect(m.reconciliationAction({ status: "dispatched", receipt: null })).toBe(
    "inspect-original",
  );
  expect(
    m.reconciliationAction({ status: "pending_execution", receipt: null }),
  ).toBe("dispatch-once");
  expect(
    m.reconciliationAction({
      status: "receipt_recorded",
      receipt: { eventId: "e", value: null },
    }),
  ).toBe("observe-original");
});
it("processes inbox before acknowledgment and does not ack failed processing", async () => {
  const m = await bridge(),
    events: string[] = [];
  await m.processDelivery(
    { id: "d", messages: [1, 2] },
    async (x) => {
      events.push("process" + x);
    },
    async (id) => {
      events.push("ack" + id);
    },
  );
  expect(events).toEqual(["process1", "process2", "ackd"]);
  await expect(
    m.processDelivery(
      { id: "d2", messages: [1] },
      async () => {
        throw new Error("conflict");
      },
      async () => {
        events.push("bad");
      },
    ),
  ).rejects.toThrow("conflict");
  expect(events).not.toContain("bad");
});

it("fences a real store before launch, persists the receipt, and reconnects the original attempt", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { WorkerBridge } = await bridge();
  const f = fixture(),
    transport = new OrcaTransport(f.store, f.driver),
    worker = new WorkerBridge(f.store, transport, f.now);
  const receipt = await worker.dispatch(f.reservation, f.prepare);
  expect(receipt).not.toBeNull();
  expect(f.store.effectRecord(f.reservation.effectKey).status).toBe(
    "receipt_recorded",
  );
  expect(receipt!.binding.inputHash).toBe(f.reservation.bindings.inputHash);
  await new WorkerBridge(
    f.store,
    new OrcaTransport(f.store, f.driver),
    f.now,
  ).dispatch(f.reservation, f.prepare);
  expect(f.counts().launches).toBe(1);
  f.store.close();
});
it("retains uncertain external start and never relaunches after absence", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { WorkerBridge } = await bridge();
  const f = fixture(),
    driver = {
      ...f.driver,
      launch: async () => {
        throw new Error("lost connection");
      },
    },
    transport = new OrcaTransport(f.store, driver),
    worker = new WorkerBridge(f.store, transport, f.now);
  await expect(worker.dispatch(f.reservation, f.prepare)).rejects.toThrow(
    "lost connection",
  );
  expect(f.store.effectRecord(f.reservation.effectKey).status).toBe(
    "dispatched",
  );
  expect(await worker.dispatch(f.reservation, f.prepare)).toBeNull();
  expect(f.counts().launches).toBe(0);
  f.store.close();
});
it("rejects a conflicting duplicate launch receipt and superseded or unfenced work", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { WorkerBridge } = await bridge();
  const f = fixture(),
    transport = new OrcaTransport(f.store, f.driver),
    worker = new WorkerBridge(f.store, transport, f.now);
  expect(() =>
    transport.validateLaunch(
      f.prepare({ eventId: "absent", revision: 0, intentHash: "a".repeat(64) }),
    ),
  ).toThrow("LAUNCH_FENCE_REQUIRED");
  const receipt = (await worker.dispatch(f.reservation, f.prepare))!;
  expect(() =>
    transport.acceptReceipt(
      f.prepare({
        eventId: "ignored",
        revision: 0,
        intentHash: "a".repeat(64),
      }),
      {
        ...receipt,
        binding: { ...receipt.binding, attemptId: "conflicting-attempt" },
      },
    ),
  ).toThrow("CONFLICTING_LAUNCH_RECEIPT");
  f.store.close();
});

it("deduplicates concurrent transport calls for the same committed fence", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js");
  const f = fixture(),
    t = new OrcaTransport(f.store, {
      ...f.driver,
      launch: async (spec) => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return f.driver.launch(spec);
      },
    });
  const event = f.commit(
      {
        kind: "LAUNCH_DISPATCHED",
        data: { logicalTaskKey: f.reservation.logicalTaskKey },
      },
      "controller",
      f.reservation.phase,
    ),
    s = f.store.load("run1"),
    { hashArtifact } = await import("../../src/domain/hash.js");
  const spec = f.prepare({
    eventId: event.id,
    revision: s.revision,
    intentHash: hashArtifact(
      "effect",
      f.store.effectRecord(f.reservation.effectKey).intent,
    ),
  });
  const result = await Promise.all([t.launch(spec), t.launch(spec)]);
  expect(result[0]).toEqual(result[1]);
  expect(f.counts().launches).toBe(1);
  f.store.close();
});
it("rejects tampered phase admission, worker roots, and a reducer inputHash replaced with a rendered hash", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { hashArtifact } = await import("../../src/domain/hash.js");
  const f = fixture(),
    t = new OrcaTransport(f.store, f.driver),
    event = f.commit(
      {
        kind: "LAUNCH_DISPATCHED",
        data: { logicalTaskKey: f.reservation.logicalTaskKey },
      },
      "controller",
      f.reservation.phase,
    ),
    s = f.store.load("run1"),
    spec = f.prepare({
      eventId: event.id,
      revision: s.revision,
      intentHash: hashArtifact(
        "effect",
        f.store.effectRecord(f.reservation.effectKey).intent,
      ),
    });
  expect(() =>
    t.validateLaunch({
      ...spec,
      admission: { ...spec.admission, phase: "review" },
    }),
  ).toThrow();
  expect(() => t.validateLaunch({ ...spec, cwd: f.workspace })).toThrow(
    "WORKER_ROOT_SEPARATION_REQUIRED",
  );
  expect(() =>
    t.validateLaunch({
      ...spec,
      reservation: {
        ...spec.reservation,
        bindings: {
          ...spec.reservation.bindings,
          inputHash: spec.packet.renderedHash,
        },
      },
    }),
  ).toThrow("LAUNCH_FENCE_REQUIRED");
  expect(() =>
    t.validateLaunch({ ...spec, packet: { ...spec.packet, text: "changed" } }),
  ).toThrow("PACKET_DELIVERY_UNQUALIFIED");
  f.store.close();
});
it("refuses a foreign attempt for stop and release while permitting lifecycle reconciliation without launch admission", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { WorkerBridge } = await bridge();
  const f = fixture(),
    t = new OrcaTransport(f.store, f.driver),
    w = new WorkerBridge(f.store, t, f.now),
    r = (await w.dispatch(f.reservation, f.prepare))!;
  await expect(
    t.stop({ ...r.binding, attemptId: "foreign-attempt" }, "deadline"),
  ).rejects.toThrow("OWNED_ATTEMPT_REQUIRED");
  expect(f.counts().stops).toBe(0);
  expect((await t.observe(r.binding)).status).toBe("exited");
  f.store.close();
});

it("requires an owned private temporary cwd and never treats source scope as a worker grant", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { hashArtifact } = await import("../../src/domain/hash.js"),
    fs = await import("node:fs"),
    { join } = await import("node:path");
  const f = fixture(),
    t = new OrcaTransport(f.store, f.driver),
    event = f.commit(
      {
        kind: "LAUNCH_DISPATCHED",
        data: { logicalTaskKey: f.reservation.logicalTaskKey },
      },
      "controller",
      f.reservation.phase,
    ),
    s = f.store.load("run1"),
    spec = f.prepare({
      eventId: event.id,
      revision: s.revision,
      intentHash: hashArtifact(
        "effect",
        f.store.effectRecord(f.reservation.effectKey).intent,
      ),
    }),
    foreign = join(f.root, "unowned");
  fs.mkdirSync(foreign, { mode: 0o700 });
  expect(() => t.validateLaunch({ ...spec, cwd: foreign })).toThrow(
    "WORKER_CWD_NOT_OWNED",
  );
  f.store.close();
});

it("rejects post-launch packet delivery failure and unexpected effective tools instead of accepting readiness", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { WorkerBridge } = await bridge();
  for (const mutate of [
    (r: import("../../src/orca/transport.js").LaunchReceipt) => ({
      ...r,
      exposed: {
        ...r.exposed,
        delivery: { ...r.exposed.delivery, verified: false },
      },
    }),
    (r: import("../../src/orca/transport.js").LaunchReceipt) => ({
      ...r,
      exposed: { ...r.exposed, tools: ["unqualified-shell"] },
    }),
  ]) {
    const f = fixture(),
      driver = {
        ...f.driver,
        launch: async (
          spec: import("../../src/orca/transport.js").WorkerSpec,
        ) => mutate(await f.driver.launch(spec)),
      },
      t = new OrcaTransport(f.store, driver),
      w = new WorkerBridge(f.store, t, f.now);
    await expect(w.dispatch(f.reservation, f.prepare)).rejects.toThrow(
      "LAUNCH_EFFECTIVE_CONTROLS_MISMATCH",
    );
    expect(f.store.effectRecord(f.reservation.effectKey).status).toBe(
      "dispatched",
    );
    expect(f.counts().launches).toBe(1);
    expect(f.store.load("run1").context.inferenceBlock).not.toBeNull();
    f.store.close();
  }
});

it("strictly rejects unknown fields in a transport receipt envelope", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { WorkerBridge } = await bridge();
  const f = fixture(),
    driver = {
      ...f.driver,
      launch: async (
        spec: import("../../src/orca/transport.js").WorkerSpec,
      ) => {
        const { receipt, ...envelope } = await f.driver.launch(spec),
          expanded = { ...envelope, extraAuthority: "forged" };
        return {
          ...expanded,
          receipt: f.store.artifacts.putArtifact(
            Buffer.from(JSON.stringify(expanded)),
            "launch",
          ),
        };
      },
    },
    t = new OrcaTransport(f.store, driver),
    w = new WorkerBridge(f.store, t, f.now);
  await expect(w.dispatch(f.reservation, f.prepare)).rejects.toThrow();
  f.store.close();
});

it("binds phase admission to the current immutable preflight attestation artifact", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { hashArtifact } = await import("../../src/domain/hash.js");
  const f = fixture(),
    t = new OrcaTransport(f.store, f.driver),
    event = f.commit(
      {
        kind: "LAUNCH_DISPATCHED",
        data: { logicalTaskKey: f.reservation.logicalTaskKey },
      },
      "controller",
      f.reservation.phase,
    ),
    s = f.store.load("run1"),
    spec = f.prepare({
      eventId: event.id,
      revision: s.revision,
      intentHash: hashArtifact(
        "effect",
        f.store.effectRecord(f.reservation.effectKey).intent,
      ),
    });
  const forged = f.store.artifacts.putArtifact(
    Buffer.from('{"madeUp":true}'),
    "preflight",
  );
  expect(() => t.validateLaunch({ ...spec, admissionReceipt: forged })).toThrow(
    "ADMISSION_ATTESTATION_MISMATCH",
  );
  f.store.close();
});

it("keeps the global input limit even when a synthetic route advertises a larger packet bound", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { hashArtifact } = await import("../../src/domain/hash.js");
  const f = fixture(),
    t = new OrcaTransport(f.store, {
      ...f.driver,
      packetBoundBytes: 16 * 1024 * 1024,
    }),
    event = f.commit(
      {
        kind: "LAUNCH_DISPATCHED",
        data: { logicalTaskKey: f.reservation.logicalTaskKey },
      },
      "controller",
      f.reservation.phase,
    ),
    s = f.store.load("run1"),
    spec = f.prepare({
      eventId: event.id,
      revision: s.revision,
      intentHash: hashArtifact(
        "effect",
        f.store.effectRecord(f.reservation.effectKey).intent,
      ),
    }),
    text = "x".repeat(8 * 1024 * 1024 + 1);
  expect(() =>
    t.validateLaunch({
      ...spec,
      packet: {
        ...spec.packet,
        text,
        renderedHash: hashArtifact("rendered-worker-packet", text),
      },
    }),
  ).toThrow("PACKET_DELIVERY_UNQUALIFIED");
  f.store.close();
});
