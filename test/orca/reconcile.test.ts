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
      f.fenced({ eventId: "absent", revision: 0, intentHash: "a".repeat(64) }),
    ),
  ).toThrow("LAUNCH_FENCE_REQUIRED");
  const receipt = (await worker.dispatch(f.reservation, f.prepare))!;
  expect(() =>
    transport.acceptReceipt(
      f.fenced({
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
  const spec = f.fenced({
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
    spec = f.fenced({
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
    spec = f.fenced({
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
        ) => {
          const rejected = mutate(await f.driver.launch(spec));
          const { receipt: _old, ...envelope } = rejected;
          return { ...envelope, receipt: f.store.artifacts.putArtifact(Buffer.from(JSON.stringify(envelope)), "launch") };
        },
      },
      t = new OrcaTransport(f.store, driver),
      w = new WorkerBridge(f.store, t, f.now);
    await expect(w.dispatch(f.reservation, f.prepare)).rejects.toThrow(
      "LAUNCH_EFFECTIVE_CONTROLS_MISMATCH",
    );
    expect(f.store.effectRecord(f.reservation.effectKey).status).toBe(
      "receipt_recorded",
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
    spec = f.fenced({
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
    spec = f.fenced({
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

it("keeps a deterministically rejected launch pending and permits corrected preparation without a replacement reservation", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { WorkerBridge } = await bridge();
  const f = fixture(), t = new OrcaTransport(f.store, f.driver),
    w = new WorkerBridge(f.store, t, f.now);
  const calls = f.store.load("run1").context.callsReserved;
  await expect(w.dispatch(f.reservation, () => {
    const spec = f.prepare();
    return { ...spec, packet: { ...spec.packet, text: "tampered" } };
  })).rejects.toThrow("PACKET_DELIVERY_UNQUALIFIED");
  expect(f.counts().launches).toBe(0);
  expect(f.store.effectRecord(f.reservation.effectKey).status).toBe("pending_execution");
  expect(f.store.load("run1").context.callsReserved).toBe(calls);
  expect(await w.dispatch(f.reservation, f.prepare)).not.toBeNull();
  expect(f.counts().launches).toBe(1);
  f.store.close();
});

it("durably owns and terminally blocks a proven started attempt with rejected effective controls", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { WorkerBridge } = await bridge();
  const f = fixture(), driver = { ...f.driver, launch: async (spec: import("../../src/orca/transport.js").WorkerSpec) => {
    const original = await f.driver.launch(spec);
    const { receipt: _proof, ...envelope } = original;
    envelope.exposed = { ...envelope.exposed, tools: ["unexpected-shell"] };
    const rejected = { ...envelope, receipt: f.store.artifacts.putArtifact(Buffer.from(JSON.stringify(envelope)), "launch") };
    f.receipts.set(spec.reservation.clientAttemptKey, rejected);
    return rejected;
  } }, t = new OrcaTransport(f.store, driver), w = new WorkerBridge(f.store, t, f.now);
  await expect(w.dispatch(f.reservation, f.prepare)).rejects.toThrow("LAUNCH_EFFECTIVE_CONTROLS_MISMATCH");
  const snapshot = f.store.load("run1"), task = snapshot.context.issuedLogicalTasks[f.reservation.logicalTaskKey]!;
  expect(task.stage).toBe("receipt_recorded");
  expect(task.binding).not.toBeNull();
  expect(snapshot.context.inferenceBlock).toBe("UNQUALIFIED_ROUTE");
  const receiptRow = f.store.readJournal("run1").find(row => row.event.body.kind === "LAUNCH_RECEIPT_RECORDED")!;
  expect(receiptRow.intents.some(intent => intent.kind === "stop")).toBe(true);
  expect((await new OrcaTransport(f.store, driver).stop(task.binding!, "control failure")).requested).toBe(true);
  expect((await t.observe(task.binding!)).status).toBe("exited");
  expect((await t.resources(task.binding!)).settled).toBe(false);
  expect(snapshot.context.ballots).toEqual([]);
  expect(f.counts().launches).toBe(1);
  f.store.close();
});


it("builds phase packets without journal transitions and recovers in reconciling without new admission", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { WorkerBridge } = await bridge();
  const f = fixture(), t = new OrcaTransport(f.store, f.driver), w = new WorkerBridge(f.store, t, f.now);
  const before = f.store.load("run1");
  f.prepare();
  expect(f.store.load("run1")).toEqual(before);
  const r = (await w.dispatch(f.reservation, f.prepare))!;
  f.commit({ kind: "LIFECYCLE_UNKNOWN", data: {} }, "adapter");
  const reconciling = f.store.load("run1");
  expect(reconciling.state).toBe("reconciling");
  expect(await new WorkerBridge(f.store, new OrcaTransport(f.store, f.driver), f.now).dispatch(f.reservation, f.prepare)).toEqual(r);
  expect(f.store.load("run1")).toEqual(reconciling);
  expect(f.counts().launches).toBe(1);
  f.store.close();
});

it("retains lifecycle ownership for another already dispatched receipt arriving after a control failure", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { WorkerBridge } = await bridge();
  const f = fixture();
  let releaseLater!: () => void;
  const gate = new Promise<void>(resolve => { releaseLater = resolve; });
  const driver = { ...f.driver, launch: async (spec: import("../../src/orca/transport.js").WorkerSpec) => {
    const original = await f.driver.launch(spec);
    if (spec.reservation.role !== "openai") { await gate; return original; }
    const { receipt: _ref, ...envelope } = original;
    envelope.exposed = { ...envelope.exposed, delivery: { ...envelope.exposed.delivery, verified: false } };
    const rejected = { ...envelope, receipt: f.store.artifacts.putArtifact(Buffer.from(JSON.stringify(envelope)), "launch") };
    f.receipts.set(spec.reservation.clientAttemptKey, rejected);
    return rejected;
  } }, t = new OrcaTransport(f.store, driver), w = new WorkerBridge(f.store, t, f.now);
  const other = Object.values(f.store.load("run1").context.issuedLogicalTasks).find(task => task.reservation.role === "gemini")!.reservation;
  const first = w.dispatch(f.reservation, f.prepare), later = w.dispatch(other, () => f.prepare(other));
  await expect(first).rejects.toThrow("LAUNCH_EFFECTIVE_CONTROLS_MISMATCH");
  releaseLater();
  const receipt = await later;
  const s = f.store.load("run1");
  expect(s.state).toBe("settling");
  expect(s.context.inferenceBlock).toBe("INVALID_WORKER_RESULT");
  expect(s.context.issuedLogicalTasks[other.logicalTaskKey]!.binding).toEqual(receipt!.binding);
  expect((await t.stop(receipt!.binding, "terminal failure")).requested).toBe(true);
  expect(f.counts().launches).toBe(2);
  f.store.close();
});

it("retains every deterministic local rejection before the dispatch fence", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { WorkerBridge } = await bridge();
  type Input = import("../../src/orca/transport.js").PreparedWorkerInput;
  const cases: ((spec: Input) => Input)[] = [
    s => ({ ...s, admission: { ...s.admission, phase: "review" } }),
    s => ({ ...s, workspace: { ...s.workspace, id: "" } }),
    s => ({ ...s, cwd: s.workspace.path }),
    s => ({ ...s, packet: { ...s.packet, inputQuestionIds: ["forged-question"] } }),
    s => ({ ...s, packet: { ...s.packet, candidateHash: "b".repeat(64) } }),
    s => ({ ...s, reservation: { ...s.reservation, clientAttemptKey: "foreign" } }),
    s => ({ ...s, packet: { ...s.packet, text: "x".repeat(200001) } }),
    s => ({ ...s, admissionReceipt: { ...s.admissionReceipt, sha256: "b".repeat(64) } }),
    s => ({ ...s, access: { ...s.access, receiptId: "foreign-access" } }),
  ];
  for (const mutate of cases) {
    const f = fixture(), before = f.store.load("run1"),
      w = new WorkerBridge(f.store, new OrcaTransport(f.store, f.driver), f.now);
    await expect(w.dispatch(f.reservation, () => mutate(f.prepare()))).rejects.toThrow();
    expect(f.store.load("run1")).toEqual(before);
    expect(f.store.effectRecord(f.reservation.effectKey).status).toBe("pending_execution");
    expect(f.counts().launches).toBe(0);
    f.store.close();
  }
  const f = fixture(), w = new WorkerBridge(f.store, new OrcaTransport(f.store), f.now);
  await expect(w.dispatch(f.reservation, f.prepare)).rejects.toThrow("UNQUALIFIED_ROUTE");
  expect(f.store.effectRecord(f.reservation.effectKey).status).toBe("pending_execution");
  f.store.close();
});

it("keeps a post-fence validation race uncertain and never creates a replacement call", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { WorkerBridge } = await bridge(), fs = await import("node:fs"), { join } = await import("node:path");
  const f = fixture(), marker = join(f.cwd, ".worker-owner.json");
  const store = new Proxy(f.store, { get(target, key) {
    if (key === "commitTransition") return (...args: Parameters<typeof target.commitTransition>) => {
      const result = target.commitTransition(...args);
      if (args[2].body.kind === "LAUNCH_DISPATCHED") fs.renameSync(marker, marker + ".race");
      return result;
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  const w = new WorkerBridge(store, new OrcaTransport(store, f.driver), f.now);
  await expect(w.dispatch(f.reservation, f.prepare)).rejects.toThrow("WORKER_CWD_NOT_OWNED");
  expect(f.store.effectRecord(f.reservation.effectKey).status).toBe("dispatched");
  fs.renameSync(marker + ".race", marker);
  expect(await w.dispatch(f.reservation, f.prepare)).toBeNull();
  expect(f.counts().launches).toBe(0);
  f.store.close();
});

it("survives a crash immediately after the atomic rejected-launch commit with exact ownership and settlement", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { WorkerBridge } = await bridge(),
    { openRunStore } = await import("../../src/store/run-store.js"),
    { reduceRun } = await import("../../src/machine/reduce.js"),
    { join } = await import("node:path");
  const f = fixture(), driver = { ...f.driver, launch: async (spec: import("../../src/orca/transport.js").WorkerSpec) => {
    const { receipt: _original, ...envelope } = await f.driver.launch(spec);
    envelope.exposed.delivery.verified = false;
    const rejected = { ...envelope, receipt: f.store.artifacts.putArtifact(Buffer.from(JSON.stringify(envelope)), "launch") };
    f.receipts.set(spec.reservation.clientAttemptKey, rejected);
    return rejected;
  } };
  const crashing = new Proxy(f.store, { get(target, key) {
    if (key === "commitTransition") return (...args: Parameters<typeof target.commitTransition>) => {
      const receipt = target.commitTransition(...args);
      if (args[2].body.kind === "LAUNCH_RECEIPT_RECORDED") throw new Error("crash-after-accepted-commit");
      return receipt;
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  const w = new WorkerBridge(crashing, new OrcaTransport(crashing, driver), f.now);
  await expect(w.dispatch(f.reservation, f.prepare)).rejects.toThrow("crash-after-accepted-commit");
  const before = f.store.load("run1"), binding = before.context.issuedLogicalTasks[f.reservation.logicalTaskKey]!.binding!,
    arm = f.armProof(binding), armingProof = JSON.parse(Buffer.from(f.store.artifacts.readArtifact(arm.receipt)).toString("utf8"));
  f.setProof({ attemptId: binding.attemptId, authority: binding.authority, worker: { status: "exited", exitCode: 7 },
    children: [], watchdog: { id: armingProof.resourceKey, status: "exited", exitCode: 0 }, complete: true, receiptRefs: [arm.receipt] });
  f.store.close();
  const recovered = openRunStore(join(f.root, "store")), t = new OrcaTransport(recovered, {
    ...driver, observe: async () => ({ observation: { status: "exited", exitCode: 7, rawReceipts: [arm.receipt] },
      resources: { attemptId: binding.attemptId, authority: binding.authority, worker: { status: "exited", exitCode: 7 },
        children: [], watchdog: { id: armingProof.resourceKey, status: "exited", exitCode: 0 }, complete: true, receiptRefs: [arm.receipt] } }),
  }), resumed = new WorkerBridge(recovered, t, f.now);
  expect(recovered.load("run1")).toEqual(before);
  expect(before.context.inferenceBlock).toBe("INVALID_WORKER_RESULT");
  const row = recovered.readJournal("run1").find(row => row.event.body.kind === "LAUNCH_RECEIPT_RECORDED")!;
  expect(recovered.commitTransition("run1", before.revision, row.event, reduceRun(before, row.event)).duplicate).toBe(true);
  expect((await t.stop(binding, "failure")).requested).toBe(true);
  expect((await t.observe(binding)).exitCode).toBe(7);
  const event: import("../../src/domain/contracts.js").ValidatedEvent = { id: arm.key + "/armed", runId: "run1", schemaVersion: 1,
    actor: { kind: "adapter", receiptId: "restart" }, round: before.context.roundsUsed, phase: binding.phase, clockReceipt: f.now(),
    body: { kind: "WATCHDOG_ARMED", data: arm } };
  recovered.commitTransition("run1", before.revision, event, reduceRun(before, event));
  await resumed.observe(binding);
  const settled = recovered.load("run1");
  const finish: import("../../src/domain/contracts.js").ValidatedEvent = { ...event, id: "recovered-settlement", phase: null, clockReceipt: f.now(),
    body: { kind: "SETTLED", data: { receipt: arm.receipt } } };
  recovered.commitTransition("run1", settled.revision, finish, reduceRun(settled, finish));
  const end = recovered.load("run1");
  expect(end.state).toBe("blocked");
  expect(end.context.activeBudget.status).toBe("settled");
  expect(end.context.issuedLogicalTasks[binding.logicalTaskKey]!.binding).toEqual(binding);
  expect(end.context.callsReserved).toBe(before.context.callsReserved);
  expect(f.counts().launches).toBe(1);
  recovered.close();
});

it("rolls back rejected-launch ownership, terminal block and stop effects on a failed receipt write", async () => {
  const { fixture } = await import("./fixtures.js"),
    { default: Database } = await import("better-sqlite3"), { join } = await import("node:path");
  const f = fixture();
  const event = f.commit({ kind: "LAUNCH_DISPATCHED", data: { logicalTaskKey: f.reservation.logicalTaskKey } }, "controller", f.reservation.phase);
  const { hashArtifact } = await import("../../src/domain/hash.js");
  const spec = f.fenced({ eventId: event.id, revision: f.store.load("run1").revision,
    intentHash: hashArtifact("effect", f.store.effectRecord(f.reservation.effectKey).intent) });
  const original = await f.driver.launch(spec), { receipt: _old, ...envelope } = original;
  envelope.exposed.delivery.verified = false;
  const proof = f.store.artifacts.putArtifact(Buffer.from(JSON.stringify(envelope)), "launch"), before = f.store.load("run1"), journal = f.store.readJournal("run1");
  const db = new Database(join(f.root, "store", "journal.sqlite"));
  db.exec("CREATE TRIGGER fail_launch_owned AFTER UPDATE ON outbox WHEN NEW.status = 'receipt_recorded' BEGIN SELECT RAISE(ABORT, 'LAUNCH_WRITE_FAILED'); END;");
  expect(() => f.commit({ kind: "LAUNCH_RECEIPT_RECORDED", data: { binding: original.binding, controlFailure: { code: "INVALID_WORKER_RESULT", receipt: proof } } }, "adapter", original.binding.phase)).toThrow("LAUNCH_WRITE_FAILED");
  expect(f.store.load("run1")).toEqual(before);
  expect(f.store.readJournal("run1")).toEqual(journal);
  expect(f.store.effectRecord(f.reservation.effectKey).status).toBe("dispatched");
  expect(f.store.pendingEffects("run1").some(effect => effect.kind === "stop")).toBe(false);
  db.exec("DROP TRIGGER fail_launch_owned"); db.close(); f.store.close();
});

it("retains lifecycle ownership for another already dispatched receipt while reconciling a terminal control failure", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { WorkerBridge } = await bridge();
  const f = fixture();
  let releaseLater!: () => void;
  const gate = new Promise<void>(resolve => { releaseLater = resolve; });
  const driver = { ...f.driver, launch: async (spec: import("../../src/orca/transport.js").WorkerSpec) => {
    const original = await f.driver.launch(spec);
    if (spec.reservation.role !== "openai") { await gate; return original; }
    const { receipt: _ref, ...envelope } = original;
    envelope.exposed = { ...envelope.exposed, delivery: { ...envelope.exposed.delivery, verified: false } };
    const rejected = { ...envelope, receipt: f.store.artifacts.putArtifact(Buffer.from(JSON.stringify(envelope)), "launch") };
    f.receipts.set(spec.reservation.clientAttemptKey, rejected);
    return rejected;
  } }, t = new OrcaTransport(f.store, driver), w = new WorkerBridge(f.store, t, f.now);
  const other = Object.values(f.store.load("run1").context.issuedLogicalTasks).find(task => task.reservation.role === "gemini")!.reservation;
  const first = w.dispatch(f.reservation, f.prepare), later = w.dispatch(other, () => f.prepare(other));
  await expect(first).rejects.toThrow("LAUNCH_EFFECTIVE_CONTROLS_MISMATCH");
  f.commit({ kind: "LIFECYCLE_UNKNOWN", data: {} }, "adapter");
  releaseLater();
  const receipt = await later;
  const s = f.store.load("run1");
  expect(s.state).toBe("reconciling");
  expect(s.context.inferenceBlock).toBe("INVALID_WORKER_RESULT");
  expect(s.context.issuedLogicalTasks[other.logicalTaskKey]!.binding).toEqual(receipt!.binding);
  expect((await t.stop(receipt!.binding, "terminal failure")).requested).toBe(true);
  expect(f.counts().launches).toBe(2);
  f.store.close();
});

it("records started-attempt ownership before enforcing a budget that expires during launch", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { WorkerBridge } = await bridge();
  for (const failedControls of [false, true]) {
    const f = fixture(), driver = { ...f.driver, launch: async (spec: import("../../src/orca/transport.js").WorkerSpec) => {
      const original = await f.driver.launch(spec);
      if (!failedControls) return original;
      const { receipt: _old, ...envelope } = original;
      envelope.exposed.delivery.verified = false;
      return { ...envelope, receipt: f.store.artifacts.putArtifact(Buffer.from(JSON.stringify(envelope)), "launch") };
    } };
    let events = 0;
    const clock = () => { const receipt = f.now(); return ++events === 2 ? { ...receipt, wallMs: receipt.wallMs + 10800001, monotonicMs: receipt.monotonicMs + 10800001 } : receipt; };
    const w = new WorkerBridge(f.store, new OrcaTransport(f.store, driver), clock);
    if (failedControls) await expect(w.dispatch(f.reservation, f.prepare)).rejects.toThrow("LAUNCH_EFFECTIVE_CONTROLS_MISMATCH");
    else await w.dispatch(f.reservation, f.prepare);
    const snapshot = f.store.load("run1");
    expect(snapshot.context.issuedLogicalTasks[f.reservation.logicalTaskKey]!.stage).toBe("receipt_recorded");
    expect(snapshot.state).toBe("settling");
    expect(snapshot.context.activeBudget.remainingMs).toBe(0);
    expect(snapshot.context.inferenceBlock).toBe(failedControls ? "INVALID_WORKER_RESULT" : null);
    const task = snapshot.context.issuedLogicalTasks[f.reservation.logicalTaskKey]!;
    expect((await new OrcaTransport(f.store, driver).stop(task.binding!, "expired")).requested).toBe(true);
    expect(f.counts().launches).toBe(1);
    f.store.close();
  }
});

it("does not report a launch receipt accepted when its trusted clock regresses", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { WorkerBridge } = await bridge();
  const f = fixture(); let events = 0;
  const now = () => { const receipt = f.now(); return ++events === 2 ? { ...receipt, monotonicMs: 0 } : receipt; };
  const w = new WorkerBridge(f.store, new OrcaTransport(f.store, f.driver), now);
  await expect(w.dispatch(f.reservation, f.prepare)).rejects.toThrow();
  expect(f.store.effectRecord(f.reservation.effectKey).status).toBe("dispatched");
  expect(f.store.readJournal("run1").some(row => row.event.body.kind === "LAUNCH_RECEIPT_RECORDED")).toBe(false);
  const recovered = await new WorkerBridge(f.store, new OrcaTransport(f.store, f.driver), f.now).dispatch(f.reservation, f.prepare);
  expect(recovered).not.toBeNull();
  expect((await new OrcaTransport(f.store, f.driver).stop(recovered!.binding, "reconciled")).requested).toBe(true);
  expect(f.store.effectRecord(f.reservation.effectKey).status).toBe("receipt_recorded");
  expect(f.counts().launches).toBe(1);
  f.store.close();
});

it("recovers rejected controls through the original replay key without fresh inference admission", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { WorkerBridge } = await bridge();
  const f = fixture(), driver = { ...f.driver, launch: async (spec: import("../../src/orca/transport.js").WorkerSpec) => {
    const { receipt: _old, ...envelope } = await f.driver.launch(spec);
    envelope.exposed.tools = ["unexpected-shell"];
    f.receipts.set(spec.reservation.clientAttemptKey, { ...envelope,
      receipt: f.store.artifacts.putArtifact(Buffer.from(JSON.stringify(envelope)), "launch") });
    throw new Error("lost-launch-reply");
  } }, t = new OrcaTransport(f.store, driver), w = new WorkerBridge(f.store, t, f.now);
  await expect(w.dispatch(f.reservation, f.prepare)).rejects.toThrow("lost-launch-reply");
  f.commit({ kind: "LIFECYCLE_UNKNOWN", data: {} }, "adapter");
  const admitted = f.store.readJournal("run1").filter(row => row.event.body.kind === "PREFLIGHT").length;
  await expect(new WorkerBridge(f.store, new OrcaTransport(f.store, driver), f.now).dispatch(f.reservation, f.prepare)).rejects.toThrow("LAUNCH_EFFECTIVE_CONTROLS_MISMATCH");
  const task = f.store.load("run1").context.issuedLogicalTasks[f.reservation.logicalTaskKey]!;
  expect(task.binding).not.toBeNull();
  expect(task.stage).toBe("receipt_recorded");
  expect(f.store.load("run1").context.inferenceBlock).toBe("UNQUALIFIED_ROUTE");
  expect(f.store.readJournal("run1").filter(row => row.event.body.kind === "PREFLIGHT")).toHaveLength(admitted);
  expect((await t.stop(task.binding!, "failure")).requested).toBe(true);
  expect(f.counts().launches).toBe(1);
  f.store.close();
});

it("does not own or terminally block an unproven or mismatched returned attempt", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { WorkerBridge } = await bridge();
  for (const mismatch of ["proof", "model"] as const) {
    const f = fixture(), driver = { ...f.driver, launch: async (spec: import("../../src/orca/transport.js").WorkerSpec) => {
      const original = await f.driver.launch(spec);
      if (mismatch === "proof") return { ...original, exposed: { ...original.exposed, tools: ["unproven-shell"] } };
      const { receipt: _old, ...envelope } = original;
      envelope.binding = { ...envelope.binding, requested: { ...envelope.binding.requested, effort: "high" }, configured: { ...envelope.binding.configured, effort: "high" } };
      return { ...envelope, receipt: f.store.artifacts.putArtifact(Buffer.from(JSON.stringify(envelope)), "launch") };
    } }, t = new OrcaTransport(f.store, driver), w = new WorkerBridge(f.store, t, f.now);
    await expect(w.dispatch(f.reservation, f.prepare)).rejects.toThrow(mismatch === "proof" ? "LAUNCH_RECEIPT_PROOF_MISMATCH" : "LAUNCH_RECEIPT_MISMATCH");
    const snapshot = f.store.load("run1");
    expect(snapshot.context.issuedLogicalTasks[f.reservation.logicalTaskKey]!.binding).toBeNull();
    expect(snapshot.context.inferenceBlock).toBeNull();
    expect(f.store.pendingEffects("run1").some(effect => effect.kind === "stop")).toBe(false);
    expect(f.counts().stops).toBe(0);
    f.store.close();
  }
});

it("rejects an uncorrelated immutable failure proof before changing ownership or the terminal block", async () => {
  const { fixture } = await import("./fixtures.js"),
    { hashArtifact } = await import("../../src/domain/hash.js");
  const f = fixture(), fence = f.commit({ kind: "LAUNCH_DISPATCHED", data: { logicalTaskKey: f.reservation.logicalTaskKey } }, "controller", f.reservation.phase),
    original = await f.driver.launch(f.fenced({ eventId: fence.id, revision: f.store.load("run1").revision,
      intentHash: hashArtifact("effect", f.store.effectRecord(f.reservation.effectKey).intent) }));
  const { receipt: _ref, ...envelope } = original;
  envelope.exposed.delivery.verified = false;
  const proof = f.store.artifacts.putArtifact(Buffer.from(JSON.stringify({ ...envelope, clientAttemptKey: "foreign-key" })), "launch"),
    before = f.store.load("run1");
  expect(() => f.commit({ kind: "LAUNCH_RECEIPT_RECORDED", data: { binding: original.binding,
    controlFailure: { code: "INVALID_WORKER_RESULT", receipt: proof } } }, "adapter", original.binding.phase)).toThrow("LAUNCH_RECEIPT_PROOF_MISMATCH");
  expect(f.store.load("run1")).toEqual(before);
  expect(f.store.effectRecord(f.reservation.effectKey).status).toBe("dispatched");
  expect(f.store.pendingEffects("run1").some(effect => effect.kind === "stop")).toBe(false);
  f.store.close();
});
