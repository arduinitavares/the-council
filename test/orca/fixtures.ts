import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdmissionEvidence } from "../../src/policy/preflight.js";
import type {
  ActiveDeadline,
  LaunchReservation,
  AttemptBinding,
  ControlEventBody,
  JsonValue,
  ValidatedEvent,
} from "../../src/domain/contracts.js";
import { canonicalJson, hashArtifact } from "../../src/domain/hash.js";
import { openRunStore } from "../../src/store/run-store.js";
import { createInitialSnapshot, reduceRun } from "../../src/machine/reduce.js";
import { request } from "../machine/helpers.js";
import { clock } from "../fixtures/builders.js";
import type {
  LaunchReceipt,
  SyntheticDriver,
  WorkerSpec,
} from "../../src/orca/transport.js";
import { createPrivateWorkerCwd } from "../../src/orca/client.js";
import type { ResourceProof } from "../../src/orca/observations.js";
export function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "council-bridge-"))),
    workspace = join(root, "workspace"),
    cwd = join(root, "private-worker");
  mkdirSync(workspace);
  mkdirSync(cwd);
  const store = openRunStore(join(root, "store")),
    r = request();
  r.workspace = workspace;
  r.scope = {
    sourceRoots: [workspace],
    allowedSourceAddresses: [],
    checks: [],
  };
  r.config.resolved = {
    version: 1,
    reviewers: {
      openai: { route: "codex", model: "gpt-6.1-sol", effort: "max" },
      gemini: {
        route: "antigravity",
        model: "gemini-4-argon-high",
        effort: "high",
      },
      claude: {
        route: "antigravity",
        model: "claude-sonnet-5-5-high",
        effort: "high",
      },
    },
    judge: { route: "codex", model: "gpt-6.1-sol", effort: "max" },
  };
  const raw = Buffer.from("fixture config");
  r.config.rawArtifact = store.artifacts.putArtifact(raw, "raw-config");
  r.config.rawSha256 = createHash("sha256").update(raw).digest("hex");
  r.config.configArtifact = store.artifacts.putArtifact(
    Buffer.from(canonicalJson(r.config.resolved)),
    "config",
  );
  r.config.configHash = hashArtifact(
    "council-config",
    r.config.resolved as unknown as JsonValue,
  );
  store.createRun(createInitialSnapshot(r));
  let tick = 0;
  const now = () => clock(10000 + ++tick, 100 + tick);
  const commit = (
    body: ControlEventBody,
    actor: ValidatedEvent["actor"]["kind"] = "adapter",
    phase: AttemptBinding["phase"] | null = null,
  ) => {
    const s = store.load("run1"),
      event: ValidatedEvent = {
        id:
          body.kind === "WATCHDOG_ARMED"
            ? body.data.key + "/armed"
            : "fixture-event-" + ++tick,
        runId: "run1",
        schemaVersion: 1,
        actor: { kind: actor, receiptId: "fixture-receipt" },
        round: s.context.roundsUsed,
        phase,
        clockReceipt: now(),
        body,
      };
    store.commitTransition("run1", s.revision, event, reduceRun(s, event));
    return event;
  };
  const ref = store.artifacts.putArtifact(
    Buffer.from("preflight"),
    "preflight",
  );
  commit({
    kind: "PREFLIGHT",
    data: {
      status: "pass",
      attestation: ref,
      code: null,
      resourcesSettled: true,
    },
  });
  const reservation = Object.values(
    store.load("run1").context.issuedLogicalTasks,
  ).find((task) => task.reservation.role === "openai")!.reservation;
  chmodSync(cwd, 0o700);
  writeFileSync(
    join(cwd, ".worker-owner.json"),
    canonicalJson({
      runId: reservation.bindings.runId,
      logicalTaskKey: reservation.logicalTaskKey,
      clientAttemptKey: reservation.clientAttemptKey,
    }),
    { mode: 0o600 },
  );
  let launches = 0,
    releases = 0,
    stops = 0;
  const receipts = new Map<string, LaunchReceipt>();
  let proof: ResourceProof | null = null;
  const driver: SyntheticDriver = {
    kind: "synthetic",
    packetBoundBytes: 200000,
    async launch(spec) {
      launches++;
      const q = spec.reservation;
      const binding: AttemptBinding = {
        ...q.bindings,
        attemptId: "fixture-attempt-" + q.clientAttemptKey,
        role: q.role,
        phase: q.phase,
        requested: q.requested,
        configured: q.requested,
        authority: {
          kind: "supervised",
          runId: "run1",
          taskId: "fixture-task-" + q.clientAttemptKey,
          dispatchId: "fixture-dispatch-" + q.clientAttemptKey,
          receiptId: "fixture-authority",
        },
        admittedMethodIds: spec.packet.admittedMethodIds,
        inputQuestionIds: spec.packet.inputQuestionIds,
        inputObjectionIds: spec.packet.inputObjectionIds,
        inputEvidenceIds: spec.packet.inputEvidenceIds,
        ...(spec.packet.candidateHash
          ? { candidateHash: spec.packet.candidateHash }
          : {}),
        ...(spec.packet.evidenceHash
          ? { evidenceHash: spec.packet.evidenceHash }
          : {}),
        ...(spec.packet.judgeHash ? { judgeHash: spec.packet.judgeHash } : {}),
      };
      const exposed = {
        selection: q.requested,
        workspace: spec.workspace,
        cwd: spec.cwd,
        roots: spec.access.grantedRoots,
        mode: "supplied-packet-read-only" as const,
        helpersDisabled: true,
        hooks: [],
        tools: [],
        actions: [],
        children: [],
        delivery: {
          renderedHash: spec.packet.renderedHash,
          bytes: Buffer.byteLength(spec.packet.text),
          verified: true,
        },
      };
      const envelope = {
        clientAttemptKey: q.clientAttemptKey,
        binding,
        exposed,
        synthetic: true,
      };
      const receipt = {
        ...envelope,
        receipt: store.artifacts.putArtifact(
          Buffer.from(JSON.stringify(envelope)),
          "launch",
        ),
      };
      receipts.set(q.clientAttemptKey, receipt);
      return receipt;
    },
    async lookup(key) {
      return receipts.get(key) ?? null;
    },
    async observe(binding) {
      return {
        observation: { status: "exited", exitCode: 0, rawReceipts: [ref] },
        resources: proof ?? {
          attemptId: binding.attemptId,
          authority: binding.authority,
          worker: { status: "exited", exitCode: 0 },
          children: [],
          watchdog: {
            id: hashArtifact("watchdog-resource", {
              attemptId: binding.attemptId,
              authority: binding.authority,
              deadlineMs:
                store.load("run1").context.control.workerDeadlines[
                  binding.logicalTaskKey
                ]!.wallMs,
            } as unknown as JsonValue),
            status: "exited",
            exitCode: 0,
          },
          complete: true,
          receiptRefs: [ref],
        },
      };
    },
    async stop(binding, reason) {
      stops++;
      return {
        attemptId: binding.attemptId,
        requested: true,
        receipt: ref,
        reason,
      };
    },
    async release(binding) {
      releases++;
      return {
        attemptId: binding.attemptId,
        released: true,
        receipt: ref,
        reason: "released",
      };
    },
  };
  const directories = new Map([[reservation.logicalTaskKey, cwd]]);
  const prepare = (
    fence: WorkerSpec["fence"],
    target: LaunchReservation = reservation,
  ): WorkerSpec => {
    const s = store.load("run1"),
      q = s.context.issuedLogicalTasks[target.logicalTaskKey]!.reservation;
    if (!directories.has(q.logicalTaskKey))
      directories.set(q.logicalTaskKey, createPrivateWorkerCwd(q));
    const access = {
      actionClass: "supplied-packet-read-only" as const,
      requiredRoots: [],
      grantedRoots: [],
      receiptId: "fixture-access",
    };
    const base: Omit<AdmissionEvidence, "setHash"> = {
      kind: "phase",
      runId: "run1",
      host: "fixture",
      versions: { orca: "fixture", codex: "fixture", antigravity: "fixture" },
      observedAt: 10000,
      configHash: s.context.config.configHash,
      profileHash: s.context.profile.profileHash,
      policyHash: "a".repeat(64),
      scopeHash: hashArtifact(
        "run-scope",
        s.context.request.scope as unknown as JsonValue,
      ),
      accessHash: hashArtifact("access-facts", access),
      phase: q.phase,
      assignments: [{ role: q.role, selection: q.requested }],
      assignmentReceiptId: "fixture-assignment",
      callerReceiptId: "fixture-caller",
      observationReceiptRefs: [],
      activeObservations: [],
      authorizationReceiptId: "fixture-auth",
      bounds: { maxWorkerCalls: 27, activeMs: 10800000 },
    };
    const text = JSON.stringify({
      phase: q.phase,
      role: q.role,
      inputHash: q.bindings.inputHash,
    });
    const admission = {
      ...base,
      setHash: hashArtifact("launch-admission", base as unknown as JsonValue),
    };
    const admissionReceipt = store.artifacts.putArtifact(
      Buffer.from(canonicalJson(admission)),
      "preflight",
    );
    commit(
      {
        kind: "PREFLIGHT",
        data: {
          status: "pass",
          attestation: admissionReceipt,
          code: null,
          resourcesSettled: false,
        },
      },
      "adapter",
      q.phase,
    );
    const routeEvidence = {
      admission,
      role: q.role,
      now: 10000,
      catalog: {
        ...q.requested,
        family: q.role === "judge" ? ("openai" as const) : q.role,
        efforts: [q.requested.effort],
        receiptId: "fixture-catalog",
        expiresAt: 20000,
      },
      qualification: {
        id: "fixture-qualified",
        host: base.host,
        versions: base.versions,
        actionClass: "supplied-packet-read-only" as const,
        requested: q.requested,
        exposed: q.requested,
        expiresAt: 20000,
        throughOrca: true,
        helpersDisabled: true,
        terminalSandbox: true,
        accessControlled: true,
        roots: [],
        receiptRefs: ["fixture-qualification"],
      },
    };
    return {
      routeEvidence,
      reservation: q,
      config: s.context.config,
      packet: {
        text,
        renderedHash: hashArtifact("rendered-worker-packet", text),
        admittedMethodIds: s.context.profile.admittedMethodIds,
        inputQuestionIds: s.context.questionLedger.questions.map((q) => q.id),
        inputObjectionIds: s.context.objections.map((o) => o.id),
        inputEvidenceIds: s.context.control.evidence.map((e) => e.requestId),
        ...(q.phase === "judge" || q.phase === "ballot"
          ? {
              candidateHash: s.context.control.candidate!.hash,
              evidenceHash: s.context.control.evidenceHash!,
            }
          : {}),
        ...(q.phase === "ballot"
          ? { judgeHash: s.context.control.judgeHash! }
          : {}),
      },
      admission,
      admissionReceipt,
      scope: s.context.request.scope,
      access,
      workspace: { id: "fixture-workspace", path: workspace },
      cwd: directories.get(q.logicalTaskKey)!,
      deadline: s.context.control.workerDeadlines[q.logicalTaskKey]!,
      fence,
    };
  };
  const armProof = (binding: AttemptBinding) => {
    const s = store.load("run1"),
      key = binding.logicalTaskKey + "/deadline",
      intent = store.effectRecord(key).intent,
      deadline = s.context.control.workerDeadlines[binding.logicalTaskKey]!;
    const resourceKey = hashArtifact("watchdog-resource", {
      attemptId: binding.attemptId,
      authority: binding.authority,
      deadlineMs: deadline.wallMs,
    } as unknown as JsonValue);
    const launchReceipt = store.artifacts.putArtifact(
      Buffer.from(
        JSON.stringify({
          pid: 12345,
          processStart: "fixture-process-start",
          resourceKey,
        }),
      ),
      "watchdog-launch",
    );
    const data = {
      key,
      intentHash: hashArtifact("effect", intent),
      logicalTaskKey: binding.logicalTaskKey,
      attemptId: binding.attemptId,
      deadline,
      receipt: store.artifacts.putArtifact(
        Buffer.from(
          JSON.stringify({
            kind: "watchdog-armed",
            key,
            intentHash: hashArtifact("effect", intent),
            logicalTaskKey: binding.logicalTaskKey,
            attemptId: binding.attemptId,
            deadline,
            resourceKey,
            pid: 12345,
            processStart: "fixture-process-start",
            launchReceipt,
          }),
        ),
        "watchdog-armed",
      ),
    };
    return data;
  };
  return {
    root,
    workspace,
    cwd,
    store,
    reservation,
    prepare,
    driver,
    commit,
    now,
    armProof,
    counts: () => ({ launches, releases, stops }),
    setProof: (value: ResourceProof) => {
      proof = value;
    },
    receipts,
  };
}
