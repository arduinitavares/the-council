import { expect, it } from "vitest";
import { makeBinding } from "../fixtures/builders.js";
async function watchdog() {
  const m = await import("../../src/workers/watchdog.js").catch(() => null);
  expect(m).not.toBeNull();
  return m!;
}
it("binds a stop-only watchdog to the earlier absolute deadline and stable resource key", async () => {
  const m = await watchdog(),
    b = makeBinding();
  const a = m.watchdogDescriptor(b, 5000, 3000),
    again = m.watchdogDescriptor(b, 5000, 3000);
  expect(a).toEqual(again);
  expect(a.deadlineMs).toBe(3000);
  expect(a.authority).toBe("stop-only");
  expect(a.key).not.toBe(
    m.watchdogDescriptor({ ...b, attemptId: "another" }, 5000, 3000).key,
  );
  expect(() => m.watchdogDescriptor(b, NaN, 3000)).toThrow();
});

it("accepts WATCHDOG_ARMED atomically with exact deadline outbox completion and no phase authority", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { WorkerBridge } = await import("../../src/workers/bridge.js");
  const f = fixture(),
    w = new WorkerBridge(f.store, new OrcaTransport(f.store, f.driver), f.now),
    r = (await w.dispatch(f.reservation, f.prepare))!,
    data = f.armProof(r.binding),
    before = f.store.load("run1");
  const event = f.commit(
    { kind: "WATCHDOG_ARMED", data },
    "adapter",
    r.binding.phase,
  );
  const after = f.store.load("run1");
  expect(after.state).toBe(before.state);
  expect(after.context.callsReserved).toBe(before.context.callsReserved);
  expect(after.context.control.settledResourceTasks).toEqual([]);
  expect(f.store.effectRecord(data.key)).toMatchObject({
    status: "receipt_recorded",
    receipt: { eventId: event.id, value: { ...data.receipt } },
  });
  expect(f.store.readJournal("run1").at(-1)!.event.body).toEqual({
    kind: "WATCHDOG_ARMED",
    data,
  });
  f.store.recordEffectReceipt(
    data.key,
    { eventId: event.id, value: { ...data.receipt } },
    after.revision,
  );
  expect(() =>
    f.store.recordEffectReceipt(
      data.key,
      { eventId: event.id, value: { ...data.receipt } },
      after.revision - 1,
    ),
  ).toThrow("REVISION_CONFLICT");
  const priorRevision = after.revision;
  const { reduceRun } = await import("../../src/machine/reduce.js");
  expect(
    f.store.commitTransition(
      "run1",
      priorRevision,
      event,
      reduceRun(after, event),
    ).duplicate,
  ).toBe(true);
  expect(() =>
    f.commit(
      { kind: "WATCHDOG_ARMED", data: { ...data, attemptId: "forged" } },
      "adapter",
      r.binding.phase,
    ),
  ).toThrow();
  expect(() =>
    f.commit(
      {
        kind: "WATCHDOG_ARMED",
        data: {
          ...data,
          deadline: { ...data.deadline, wallMs: data.deadline.wallMs + 1 },
        },
      },
      "adapter",
      r.binding.phase,
    ),
  ).toThrow();
  expect(() =>
    f.commit(
      {
        kind: "WATCHDOG_ARMED",
        data: { ...data, key: f.reservation.effectKey },
      },
      "adapter",
      r.binding.phase,
    ),
  ).toThrow();
  expect(() =>
    f.commit({ kind: "WATCHDOG_ARMED", data }, "user", r.binding.phase),
  ).toThrow();
  expect(f.store.load("run1").revision).toBe(priorRevision);
  f.store.close();
});
it("rejects arbitrary immutable artifacts and conflicting watchdog arming receipts", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { WorkerBridge } = await import("../../src/workers/bridge.js");
  const f = fixture(),
    w = new WorkerBridge(f.store, new OrcaTransport(f.store, f.driver), f.now),
    r = (await w.dispatch(f.reservation, f.prepare))!,
    data = f.armProof(r.binding);
  expect(() =>
    f.commit(
      {
        kind: "WATCHDOG_ARMED",
        data: {
          ...data,
          receipt: f.store.artifacts.putArtifact(Buffer.from("{}"), "receipt"),
        },
      },
      "adapter",
      r.binding.phase,
    ),
  ).toThrow();
  f.commit({ kind: "WATCHDOG_ARMED", data }, "adapter", r.binding.phase);
  expect(() =>
    f.commit(
      {
        kind: "WATCHDOG_ARMED",
        data: {
          ...data,
          receipt: f.store.artifacts.putArtifact(
            Buffer.from('{"other":true}'),
            "watchdog-armed",
          ),
        },
      },
      "adapter",
      r.binding.phase,
    ),
  ).toThrow();
  f.store.close();
});

it("runs one detached watchdog, records its process, stops only its dispatch, and reconciles registration", async () => {
  const m = await watchdog(),
    { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { WorkerBridge } = await import("../../src/workers/bridge.js");
  const fs = await import("node:fs"),
    { fileURLToPath } = await import("node:url"),
    { join } = await import("node:path");
  const f = fixture(),
    worker = new WorkerBridge(
      f.store,
      new OrcaTransport(f.store, f.driver),
      f.now,
    ),
    r = (await worker.dispatch(f.reservation, f.prepare))!,
    directory = join(f.root, "watchdogs");
  fs.mkdirSync(directory);
  const deadline = {
      wallMs: Date.now() + 120,
      monotonicMs: 1000,
      processEpoch: "synthetic",
    },
    key = r.binding.logicalTaskKey + "/deadline",
    intentHash = "a".repeat(64);
  const args = {
    root: directory,
    binding: r.binding,
    deadline,
    key,
    intentHash,
    executable: process.execPath,
    prefix: [
      fileURLToPath(new URL("./fixtures/fake-orca.mjs", import.meta.url)),
    ],
    cwd: f.cwd,
    artifacts: f.store.artifacts,
  };
  const first = await m.armSyntheticWatchdog(args),
    second = await m.armSyntheticWatchdog(args);
  expect(first.status).toBe("armed");
  expect(second.pid).toBe(first.pid);
  expect(second.proof).toEqual(first.proof);
  for (
    let n = 0;
    n < 100 && !fs.existsSync(join(first.directory, "stop-exit.json"));
    n++
  )
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect(
    JSON.parse(fs.readFileSync(join(first.directory, "stop-exit.json"), "utf8"))
      .exitCode,
  ).toBe(0);
  const request = JSON.parse(
    fs.readFileSync(join(first.directory, "request.json"), "utf8"),
  );
  expect(request.argv.slice(-5)).toEqual([
    "orchestration",
    "worker-stop",
    "--dispatch",
    r.binding.authority.kind === "supervised"
      ? r.binding.authority.dispatchId
      : "unexpected",
    "--json",
  ]);
  fs.writeFileSync(
    join(first.directory, "settled.json"),
    JSON.stringify({
      attemptId: r.binding.attemptId,
      resourceKey: first.descriptor.key,
      settled: true,
      receiptRefs: [first.proof],
    }),
  );
  for (
    let n = 0;
    n < 100 && !fs.existsSync(join(first.directory, "exit.json"));
    n++
  )
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect(fs.existsSync(join(first.directory, "exit.json"))).toBe(true);
  f.store.close();
});
it("watchdog stop authority survives loss of its launching coordinator process", async () => {
  const m = await watchdog(),
    fs = await import("node:fs"),
    { spawn } = await import("node:child_process"),
    { join } = await import("node:path"),
    { tmpdir } = await import("node:os"),
    { fileURLToPath } = await import("node:url");
  const root = fs.realpathSync(
      fs.mkdtempSync(join(tmpdir(), "council-detached-")),
    ),
    binding = makeBinding(),
    descriptor = m.watchdogDescriptor(
      binding,
      Date.now() + 180,
      Date.now() + 180,
    );
  fs.writeFileSync(
    join(root, "request.json"),
    JSON.stringify({
      descriptor,
      executable: process.execPath,
      argv: [
        fileURLToPath(new URL("./fixtures/fake-orca.mjs", import.meta.url)),
        "orchestration",
        "worker-stop",
        "--dispatch",
        "dispatch-openai",
        "--json",
      ],
      cwd: root,
      environment: { PATH: process.env.PATH },
    }),
  );
  const parent = spawn(
    process.execPath,
    [
      "-e",
      "const {spawn}=require('node:child_process');const p=spawn(process.execPath,['-e',process.argv[1],process.argv[2]],{detached:true,stdio:'ignore'});p.unref();",
      m.watchdogProgram,
      root,
    ],
    { stdio: "ignore" },
  );
  await new Promise<void>((resolve) => parent.on("close", () => resolve()));
  for (let n = 0; n < 100 && !fs.existsSync(join(root, "stop-exit.json")); n++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect(fs.existsSync(join(root, "stop-exit.json"))).toBe(true);
  fs.writeFileSync(
    join(root, "settled.json"),
    JSON.stringify({
      attemptId: binding.attemptId,
      resourceKey: descriptor.key,
      settled: true,
      receiptRefs: ["synthetic-exit-receipt"],
    }),
  );
  for (let n = 0; n < 100 && !fs.existsSync(join(root, "exit.json")); n++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect(fs.existsSync(join(root, "exit.json"))).toBe(true);
});

it("rolls back checkpoint, arming registry, journal and outbox on an injected receipt write failure", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { WorkerBridge } = await import("../../src/workers/bridge.js"),
    { default: Database } = await import("better-sqlite3"),
    { join } = await import("node:path");
  const f = fixture(),
    w = new WorkerBridge(f.store, new OrcaTransport(f.store, f.driver), f.now),
    r = (await w.dispatch(f.reservation, f.prepare))!,
    data = f.armProof(r.binding),
    before = f.store.load("run1");
  const db = new Database(join(f.root, "store", "journal.sqlite"));
  db.exec(
    "CREATE TRIGGER fail_arm AFTER UPDATE ON outbox WHEN NEW.status = 'receipt_recorded' BEGIN SELECT RAISE(ABORT, 'ARMING_WRITE_FAILED'); END;",
  );
  expect(() =>
    f.commit({ kind: "WATCHDOG_ARMED", data }, "adapter", r.binding.phase),
  ).toThrow("ARMING_WRITE_FAILED");
  expect(f.store.load("run1")).toEqual(before);
  expect(f.store.effectRecord(data.key).status).toBe("pending_execution");
  db.exec("DROP TRIGGER fail_arm");
  db.close();
  f.store.close();
});
it("watchdog arming does not complete through generic receipts or deadline expiry", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { WorkerBridge } = await import("../../src/workers/bridge.js");
  const f = fixture(),
    w = new WorkerBridge(f.store, new OrcaTransport(f.store, f.driver), f.now),
    r = (await w.dispatch(f.reservation, f.prepare))!,
    data = f.armProof(r.binding);
  expect(() =>
    f.commit(
      {
        kind: "EFFECT_RECEIPT_RECORDED",
        data: {
          key: data.key,
          intentHash: data.intentHash,
          receipt: data.receipt,
        },
      },
      "adapter",
      r.binding.phase,
    ),
  ).toThrow("GENERIC_EFFECT_RECEIPT_FORBIDDEN");
  expect(() =>
    f.commit(
      { kind: "WATCHDOG_ARMED", data: { ...data, intentHash: "b".repeat(64) } },
      "adapter",
      r.binding.phase,
    ),
  ).toThrow();
  f.commit({ kind: "DEADLINE", data: {} }, "adapter", r.binding.phase);
  expect(f.store.effectRecord(data.key).status).toBe("pending_execution");
  f.store.close();
});

it("records arming through the actual watchdog producer and bridge consumer", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { WorkerBridge } = await import("../../src/workers/bridge.js"),
    fs = await import("node:fs"),
    { join } = await import("node:path"),
    { fileURLToPath } = await import("node:url");
  const f = fixture(),
    worker = new WorkerBridge(
      f.store,
      new OrcaTransport(f.store, f.driver),
      f.now,
    ),
    r = (await worker.dispatch(f.reservation, f.prepare))!,
    root = join(f.root, "producer-watchdogs");
  fs.mkdirSync(root);
  const registration = await worker.armSyntheticDeadline(r.binding, {
    root,
    executable: process.execPath,
    prefix: [
      fileURLToPath(new URL("./fixtures/fake-orca.mjs", import.meta.url)),
    ],
    cwd: f.cwd,
  });
  try {
    expect(registration.status).toBe("armed");
    expect(
      f.store.effectRecord(r.binding.logicalTaskKey + "/deadline").status,
    ).toBe("receipt_recorded");
  } finally {
    fs.writeFileSync(
      join(registration.directory, "settled.json"),
      JSON.stringify({
        attemptId: r.binding.attemptId,
        resourceKey: registration.descriptor.key,
        settled: true,
        receiptRefs: [registration.proof],
      }),
    );
    for (
      let n = 0;
      n < 100 && !fs.existsSync(join(registration.directory, "exit.json"));
      n++
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    f.store.close();
  }
});

it("preserves the version-one persisted snapshot shape without requiring a new watchdog registry field", async () => {
  const { fixture } = await import("./fixtures.js"),
    { runSnapshotSchema } = await import("../../src/domain/schemas.js");
  const f = fixture(),
    snapshot = f.store.load("run1");
  const historical = structuredClone(snapshot) as unknown as {
    context: { control: Record<string, unknown> };
  };
  delete historical.context.control.watchdogArmings;
  expect(runSnapshotSchema.safeParse(historical).success).toBe(true);
  f.store.close();
});

it("watchdog monotonic elapsed time cannot be extended by a backwards wall clock", async () => {
  const m = await watchdog(),
    fs = await import("node:fs"),
    { spawn } = await import("node:child_process"),
    { join } = await import("node:path"),
    { tmpdir } = await import("node:os"),
    { fileURLToPath } = await import("node:url");
  const root = fs.realpathSync(
      fs.mkdtempSync(join(tmpdir(), "council-clock-")),
    ),
    binding = makeBinding(),
    descriptor = m.watchdogDescriptor(
      binding,
      Date.now() + 120,
      Date.now() + 120,
    );
  fs.writeFileSync(
    join(root, "request.json"),
    JSON.stringify({
      descriptor,
      executable: process.execPath,
      argv: [
        fileURLToPath(new URL("./fixtures/fake-orca.mjs", import.meta.url)),
        "orchestration",
        "worker-stop",
        "--dispatch",
        "dispatch-openai",
        "--json",
      ],
      cwd: root,
      environment: { PATH: process.env.PATH },
    }),
  );
  const child = spawn(
    process.execPath,
    [
      "-e",
      "const realNow=Date.now;let ticks=0;Date.now=()=>++ticks<=2?realNow():realNow()-100000;" +
        m.watchdogProgram,
      root,
    ],
    { stdio: "ignore" },
  );
  try {
    for (let n = 0; n < 70 && !fs.existsSync(join(root, "stop-exit.json")); n++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fs.existsSync(join(root, "stop-exit.json"))).toBe(true);
  } finally {
    fs.writeFileSync(
      join(root, "settled.json"),
      JSON.stringify({
        attemptId: binding.attemptId,
        resourceKey: descriptor.key,
        settled: true,
        receiptRefs: ["synthetic-exit-receipt"],
      }),
    );
    await new Promise<void>((resolve) => child.on("close", () => resolve()));
  }
});

it("allows watchdog completion only after positive worker and child settlement", async () => {
  const m = await watchdog(),
    { fixture } = await import("./fixtures.js"),
    fs = await import("node:fs"),
    { join } = await import("node:path");
  const f = fixture(),
    binding = makeBinding(),
    descriptor = m.watchdogDescriptor(binding, 5000, 5000),
    directory = join(f.root, "synthetic-watchdog");
  fs.mkdirSync(directory);
  const registration = {
      descriptor,
      directory,
      pid: 1234,
      proof: null,
      status: "armed" as const,
    },
    receipt = f.store.artifacts.putArtifact(
      Buffer.from("positive exit"),
      "worker-exit",
    ),
    proof = {
      attemptId: binding.attemptId,
      authority: binding.authority,
      worker: { status: "exited" as const, exitCode: 0 },
      children: [{ id: "child", status: "live" as const, exitCode: null }],
      watchdog: { id: descriptor.key, status: "live" as const, exitCode: null },
      complete: true,
      receiptRefs: [receipt],
    };
  expect(() =>
    m.markSyntheticWatchdogSettled(registration, binding, proof),
  ).toThrow("WORKER_RESOURCE_SETTLEMENT_REQUIRED");
  m.markSyntheticWatchdogSettled(registration, binding, {
    ...proof,
    children: [],
  });
  expect(
    JSON.parse(fs.readFileSync(join(directory, "settled.json"), "utf8")),
  ).toMatchObject({
    attemptId: binding.attemptId,
    resourceKey: descriptor.key,
    settled: true,
  });
  f.store.close();
});

it("revalidates the actual committed deadline before calling the driver", async () => {
  const { fixture } = await import("./fixtures.js"),
    { OrcaTransport } = await import("../../src/orca/transport.js"),
    { hashArtifact } = await import("../../src/domain/hash.js");
  const f = fixture(), t = new OrcaTransport(f.store, f.driver), event = f.commit({
    kind: "LAUNCH_DISPATCHED", data: { logicalTaskKey: f.reservation.logicalTaskKey },
  }, "controller", f.reservation.phase);
  const spec = f.fenced({ eventId: event.id, revision: f.store.load("run1").revision,
    intentHash: hashArtifact("effect", f.store.effectRecord(f.reservation.effectKey).intent) });
  await expect(t.launch({ ...spec, deadline: { ...spec.deadline, wallMs: spec.deadline.wallMs + 1 } })).rejects.toThrow("DEADLINE_BINDING_MISMATCH");
  expect(f.counts().launches).toBe(0);
  expect(f.store.effectRecord(f.reservation.effectKey).status).toBe("dispatched");
  f.store.close();
});
