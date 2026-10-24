import { randomUUID } from "node:crypto";
import type {
  AttemptBinding,
  ClockReceipt,
  ControlEventBody,
  LaunchReservation,
  ValidatedEvent,
  WorkerResult,
} from "../domain/contracts.js";
import { canonicalJson, hashArtifact } from "../domain/hash.js";
import { reduceRun } from "../machine/reduce.js";
import type { EffectRecord, RunStore } from "../store/run-store.js";
import {
  LaunchControlError,
  OrcaTransport,
  type LaunchReceipt,
  type WorkerSpec,
  type PreparedWorkerInput,
} from "../orca/transport.js";
import { armSyntheticWatchdog, type WatchdogRegistration } from "./watchdog.js";
import { decodeProviderOutputWithReceipt } from "./protocol.js";
export function reconciliationAction(
  record: Pick<EffectRecord, "status" | "receipt">,
): "dispatch-once" | "inspect-original" | "observe-original" | "superseded" {
  return record.status === "pending_execution"
    ? "dispatch-once"
    : record.status === "dispatched"
      ? "inspect-original"
      : record.status === "receipt_recorded"
        ? "observe-original"
        : "superseded";
}
export async function processDelivery<T>(
  delivery: { id: string; messages: readonly T[] },
  process: (message: T) => Promise<void>,
  ack: (id: string) => Promise<void>,
): Promise<void> {
  for (const message of delivery.messages) await process(message);
  await ack(delivery.id);
}
export class WorkerBridge {
  constructor(
    private readonly store: RunStore,
    private readonly transport: OrcaTransport,
    private readonly clock: () => ClockReceipt,
  ) {}
  private commit(
    runId: string,
    body: ControlEventBody,
    phase: AttemptBinding["phase"] | null = null,
    id: string = randomUUID(),
  ): ValidatedEvent {
    const before = this.store.load(runId),
      event: ValidatedEvent = {
        id,
        runId,
        schemaVersion: 1,
        actor: {
          kind: body.kind === "LAUNCH_DISPATCHED" ? "controller" : "adapter",
          receiptId: "worker-bridge",
        },
        round: before.context.roundsUsed,
        phase,
        clockReceipt: this.clock(),
        body,
      };
    this.store.commitTransition(
      runId,
      before.revision,
      event,
      reduceRun(before, event),
    );
    return event;
  }
  /** Commit phase PREFLIGHT before calling dispatch. Preparation must be journal-pure
   * and return frozen original inputs, including during recovery (no new admission).
   * The bridge adds the actual fence and reducer-issued deadline only after commit. */
  async dispatch(
    reservation: LaunchReservation,
    prepare: () => PreparedWorkerInput,
  ): Promise<LaunchReceipt | null> {
    const runId = reservation.bindings.runId,
      record = this.store.effectRecord(reservation.effectKey),
      action = reconciliationAction(record);
    if (action === "superseded") return null;
    if (action !== "dispatch-once") {
      const row = this.store.readJournal(runId).find(
        (row) => row.event.body.kind === "LAUNCH_DISPATCHED" &&
          row.event.body.data.logicalTaskKey === reservation.logicalTaskKey,
      );
      if (!row) throw new Error("MISSING_ORIGINAL_FENCE");
      const prepared = prepare();
      if (canonicalJson(prepared.reservation) !== canonicalJson(reservation))
        throw new Error("RESERVATION_MISMATCH");
      try {
        const receipt = await this.transport.recover({
          ...prepared,
          deadline: this.store.load(runId).context.control.workerDeadlines[reservation.logicalTaskKey]!,
          fence: {
            eventId: row.event.id,
            revision: row.revision,
            intentHash: hashArtifact("effect", record.intent),
          },
        });
        if (receipt && action === "inspect-original")
          this.commit(runId, {
            kind: "LAUNCH_RECEIPT_RECORDED",
            data: { binding: receipt.binding },
          }, reservation.phase);
        return receipt;
      } catch (error) {
        if (error instanceof LaunchControlError && action === "inspect-original")
          this.commit(runId, {
            kind: "LAUNCH_RECEIPT_RECORDED",
            data: {
              binding: error.receipt.binding,
              controlFailure: { code: error.terminalCode, receipt: error.receipt.receipt },
            },
          }, reservation.phase);
        throw error;
      }
    }
    const prepared = structuredClone(prepare());
    if (canonicalJson(prepared.reservation) !== canonicalJson(reservation))
      throw new Error("RESERVATION_MISMATCH");
    this.transport.validatePrepared(prepared);
    const event = this.commit(
      runId,
      {
        kind: "LAUNCH_DISPATCHED",
        data: { logicalTaskKey: reservation.logicalTaskKey },
      },
      reservation.phase,
    );
    const snapshot = this.store.load(runId),
      fence = {
        eventId: event.id,
        revision: snapshot.revision,
        intentHash: hashArtifact("effect", record.intent),
      };
    const spec: WorkerSpec = {
      ...prepared,
      fence,
      deadline: snapshot.context.control.workerDeadlines[reservation.logicalTaskKey]!,
    };
    try {
      const receipt = await this.transport.launch(spec);
      this.commit(
        runId,
        { kind: "LAUNCH_RECEIPT_RECORDED", data: { binding: receipt.binding } },
        reservation.phase,
      );
      return receipt;
    } catch (error) {
      if (error instanceof LaunchControlError) {
        this.commit(
          runId,
          {
            kind: "LAUNCH_RECEIPT_RECORDED",
            data: {
              binding: error.receipt.binding,
              controlFailure: { code: error.terminalCode, receipt: error.receipt.receipt },
            },
          },
          reservation.phase,
        );
      }
      throw error;
    }
  }
  async armSyntheticDeadline(
    binding: AttemptBinding,
    options: {
      root: string;
      executable: string;
      prefix?: readonly string[];
      cwd: string;
    },
  ): Promise<WatchdogRegistration> {
    const snapshot = this.store.load(binding.runId),
      task = snapshot.context.issuedLogicalTasks[binding.logicalTaskKey];
    if (
      !task?.binding ||
      canonicalJson(task.binding) !== canonicalJson(binding)
    )
      throw new Error("OWNED_ATTEMPT_REQUIRED");
    const deadline =
      snapshot.context.control.workerDeadlines[binding.logicalTaskKey];
    if (!deadline) throw new Error("WATCHDOG_DEADLINE_REQUIRED");
    const key = binding.logicalTaskKey + "/deadline",
      effect = this.store.effectRecord(key),
      intentHash = hashArtifact("effect", effect.intent);
    const registration = await armSyntheticWatchdog({
      ...options,
      binding,
      deadline,
      key,
      intentHash,
      artifacts: this.store.artifacts,
    });
    if (registration.status === "armed" && registration.proof) {
      if (effect.status === "receipt_recorded") {
        if (
          canonicalJson(effect.receipt?.value) !==
          canonicalJson(registration.proof)
        )
          throw new Error("WATCHDOG_RECEIPT_CONFLICT");
      } else
        this.commit(
          binding.runId,
          {
            kind: "WATCHDOG_ARMED",
            data: {
              key,
              intentHash,
              logicalTaskKey: binding.logicalTaskKey,
              attemptId: binding.attemptId,
              deadline,
              receipt: registration.proof,
            },
          },
          binding.phase,
          `${key}/armed`,
        );
    }
    return registration;
  }
  ingest(raw: Uint8Array, binding: AttemptBinding): WorkerResult {
    const snapshot = this.store.load(binding.runId),
      task = snapshot.context.issuedLogicalTasks[binding.logicalTaskKey];
    if (
      !task?.binding || task.stage !== "receipt_recorded" ||
      canonicalJson(task.binding) !== canonicalJson(binding)
    )
      throw new Error("OWNED_ATTEMPT_REQUIRED");
    const decoded = decodeProviderOutputWithReceipt(raw, binding);
    this.store.artifacts.putArtifact(decoded.raw, "worker-raw");
    this.store.artifacts.putArtifact(
      Buffer.from(JSON.stringify(decoded.normalization)),
      "normalization",
    );
    const c = snapshot.context;
    const stale =
      c.control.supersededTaskKeys.includes(binding.logicalTaskKey) ||
      binding.configHash !== c.config.configHash ||
      binding.profileHash !== c.profile.profileHash ||
      binding.contextHash !== c.sharedContext.contextHash ||
      binding.round !== (binding.phase === "clarify" ? 0 : c.roundsUsed) ||
      binding.clarificationBatch !== (binding.phase === "clarify" ? c.clarificationBatchesUsed : null);
    if (stale) return decoded.result;
    if (decoded.result.status === "invalid")
      this.commit(
        binding.runId,
        {
          kind: "ERROR",
          data: { code: "INVALID_WORKER_RESULT", terminalInference: true },
        },
        binding.phase,
      );
    else {
      const artifact = this.store.artifacts.putArtifact(
        Buffer.from(canonicalJson(decoded.result.payload)),
        "worker-result",
      );
      this.commit(
        binding.runId,
        {
          kind: "WORKER_RESULT",
          data: { payload: decoded.result.payload, artifact },
        },
        binding.phase,
      );
    }
    return decoded.result;
  }
  async observe(binding: AttemptBinding): Promise<void> {
    const observation = await this.transport.observe(binding);
    this.commit(
      binding.runId,
      {
        kind: "WORKER_OBSERVED",
        data: { logicalTaskKey: binding.logicalTaskKey, observation },
      },
      binding.phase,
    );
    const resources = await this.transport.resources(binding);
    if (resources.settled) {
      const receipt = this.store.artifacts.putArtifact(
        Buffer.from(canonicalJson(resources)),
        "resource-settlement",
      );
      this.commit(
        binding.runId,
        {
          kind: "RESOURCES_SETTLED",
          data: { logicalTaskKeys: [binding.logicalTaskKey], receipt },
        },
        binding.phase,
      );
    }
  }
}
