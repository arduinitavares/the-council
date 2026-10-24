import { z } from "zod";
import { realpathSync } from "node:fs";
import { canonicalJson, hashArtifact } from "../domain/hash.js";
import type {
  ActiveDeadline,
  ArtifactRef,
  AttemptBinding,
  ConfigSnapshot,
  JsonValue,
  LaunchReservation,
  ModelSelection,
  WorkerRole,
  RunScope,
  WorkerObservation,
} from "../domain/contracts.js";
import {
  attemptBindingSchema,
  reservationSchema as launchReservationSchema,
  watchdogArmingProofSchema,
  workerObservationSchema,
  artifactRefSchema,
  canonicalPathSchema,
  hashSchema,
  idSchema,
  modelSelectionSchema,
  INPUT_LIMIT_BYTES,
} from "../domain/schemas.js";
import type { AdmissionEvidence, PreflightInput } from "../policy/preflight.js";
import {
  qualifySelection,
  type QualificationReceipt as PolicyQualificationReceipt,
  type QualificationRequirement,
} from "../policy/qualification.js";
import { isExactModelId } from "../config/schema.js";
import type { RunStore } from "../store/run-store.js";
import { decodeStrictJson } from "../workers/strict-json.js";
import { validatePrivateWorkerCwd } from "./client.js";
import {
  aggregateSettlement,
  observationFromFailure,
  type ResourceProof,
} from "./observations.js";
export { decodeProviderOutput } from "../workers/protocol.js";

export interface WorkerPacket {
  text: string;
  renderedHash: string;
  admittedMethodIds: readonly string[];
  inputQuestionIds: readonly string[];
  inputObjectionIds: readonly string[];
  inputEvidenceIds: readonly string[];
  candidateHash?: string;
  evidenceHash?: string;
  judgeHash?: string;
}
export interface WorkerSpec {
  reservation: LaunchReservation;
  config: ConfigSnapshot;
  packet: WorkerPacket;
  admission: AdmissionEvidence;
  admissionReceipt: ArtifactRef;
  scope: RunScope;
  access: PreflightInput["access"];
  workspace: { id: string; path: string };
  cwd: string;
  routeEvidence: RouteSelectionEvidence;
  deadline: ActiveDeadline;
  fence: { eventId: string; intentHash: string; revision: number };
}
/** Frozen supplied inputs; the bridge adds only the real committed fence and deadline. */
export type PreparedWorkerInput = Omit<WorkerSpec, "fence" | "deadline">;
export interface EffectiveLaunchControls {
  selection: ModelSelection;
  workspace: { id: string; path: string };
  cwd: string;
  roots: readonly string[];
  mode: "supplied-packet-read-only";
  helpersDisabled: boolean;
  hooks: readonly string[];
  tools: readonly string[];
  actions: readonly string[];
  children: readonly string[];
  delivery: { renderedHash: string; bytes: number; verified: boolean };
}
export class LaunchControlError extends Error {
  constructor(
    readonly receipt: LaunchReceipt,
    readonly terminalCode: "INVALID_WORKER_RESULT" | "UNQUALIFIED_ROUTE",
  ) {
    super("LAUNCH_EFFECTIVE_CONTROLS_MISMATCH");
  }
}
export interface LaunchReceipt {
  exposed: EffectiveLaunchControls;
  clientAttemptKey: string;
  binding: AttemptBinding;
  receipt: ArtifactRef;
  synthetic: boolean;
}
export const effectiveLaunchControlsSchema = z.strictObject({
  selection: modelSelectionSchema,
  workspace: z.strictObject({ id: idSchema, path: canonicalPathSchema }),
  cwd: canonicalPathSchema,
  roots: z.array(canonicalPathSchema),
  mode: z.literal("supplied-packet-read-only"),
  helpersDisabled: z.boolean(),
  hooks: z.array(idSchema),
  tools: z.array(idSchema),
  actions: z.array(idSchema),
  children: z.array(idSchema),
  delivery: z.strictObject({
    renderedHash: hashSchema,
    bytes: z.number().int().nonnegative(),
    verified: z.boolean(),
  }),
});
export const launchReceiptSchema = z.strictObject({
  clientAttemptKey: idSchema,
  binding: attemptBindingSchema,
  receipt: artifactRefSchema,
  synthetic: z.literal(true),
  exposed: effectiveLaunchControlsSchema,
});
export interface StopReceipt {
  attemptId: string;
  requested: boolean;
  receipt: ArtifactRef | null;
  reason: string;
}
export interface ReleaseReceipt {
  attemptId: string;
  released: boolean;
  receipt: ArtifactRef | null;
  reason: string;
}
export interface QualificationRequest extends QualificationRequirement {
  evidence?: {
    policy: PolicyQualificationReceipt;
    orchestrationAuthority: boolean;
    replayControlled: boolean;
    stopControlled: boolean;
    watchdogSurvives: boolean;
    positiveSettlement: boolean;
    packetBoundBytes: number;
    deliveryVerified: boolean;
  };
}
export type QualificationReceipt = {
  kind: "blocked";
  reason: "UNQUALIFIED_ROUTE";
  missing: readonly string[];
};
/** No installed live bridge is qualified by synthetic control tests. A future live
 * producer must prove effective controls, delivery and full orchestration first. */
export async function qualifyRoute(
  _request: QualificationRequest,
): Promise<QualificationReceipt> {
  return {
    kind: "blocked",
    reason: "UNQUALIFIED_ROUTE",
    missing: [
      "qualified per-entry configuration/tool isolation",
      "real dispatch replay authority",
      "qualified stop and resource enumeration",
      "route/model/effort packet delivery bound",
      "live independent watchdog settlement",
    ],
  };
}
export interface RouteSelectionEvidence {
  admission: AdmissionEvidence;
  role: WorkerRole;
  now: number;
  catalog: PreflightInput["catalog"][number];
  qualification: PolicyQualificationReceipt;
}
/** Routing is model-agnostic. The exact current policy/catalog/qualification and
 * frozen phase assignment, rather than a second model list, admit the selection. */
export function selectionArgv(
  selection: ModelSelection,
  evidence?: RouteSelectionEvidence,
): string[] {
  const fail = (): never => {
    throw new Error("UNSUPPORTED_MODEL_OVERRIDE");
  };
  if (
    !evidence ||
    !isExactModelId(selection.model) ||
    !/^[a-z]+$/.test(selection.effort) ||
    /^(?:auto|automatic|default|inherit)$/.test(selection.effort)
  )
    return fail();
  const { catalog, admission, role, qualification, now } = evidence;
  const family = catalog.family;
  const expectedRoute = { openai: "codex", gemini: "antigravity", claude: "antigravity" } as const;
  if (
    selection.route !== expectedRoute[family] ||
    (role !== "judge" && family !== role) ||
    catalog.route !== selection.route ||
    catalog.model !== selection.model ||
    !catalog.efforts.includes(selection.effort) ||
    catalog.expiresAt <= now ||
    !admission.assignments.some(
      (assignment) =>
        assignment.role === role &&
        canonicalJson(assignment.selection) === canonicalJson(selection),
    )
  )
    return fail();
  const decision = qualifySelection(
    {
      selection,
      host: admission.host,
      versions: admission.versions,
      actionClass: qualification.actionClass,
      roots: [],
      now,
    },
    [qualification],
  );
  if (decision.kind !== "ready") return fail();
  return [
    "--agent",
    selection.route === "codex" ? "codex" : "antigravity",
    "--model",
    selection.model,
    "--effort",
    selection.effort,
  ];
}
export function validateProviderControls(input: {
  version: string;
  mode: string;
  disableSlashCommands: boolean;
  expandedPlan: string | null;
}): void {
  if (
    input.mode !== "plan" ||
    input.disableSlashCommands ||
    input.expandedPlan !== "plan"
  )
    throw new Error("UNQUALIFIED_PLAN_CONTROL");
}
/** Test-only driver seam. Its identities are real fixture identities, never local
 * counters synthesized by the adapter. There is deliberately no live driver. */
export interface SyntheticDriver {
  readonly kind: "synthetic";
  readonly packetBoundBytes: number;
  launch(spec: WorkerSpec): Promise<LaunchReceipt>;
  lookup(clientAttemptKey: string): Promise<LaunchReceipt | null>;
  observe(
    binding: AttemptBinding,
  ): Promise<{ observation: WorkerObservation; resources: ResourceProof }>;
  stop(binding: AttemptBinding, reason: string): Promise<StopReceipt>;
  release(binding: AttemptBinding): Promise<ReleaseReceipt>;
}
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const hash = (kind: string, value: unknown) =>
  hashArtifact(kind, value as JsonValue);
export class OrcaTransport {
  private readonly receipts = new Map<string, LaunchReceipt>();
  private readonly launches = new Map<string, Promise<LaunchReceipt>>();
  constructor(
    private readonly store: RunStore,
    private readonly driver: SyntheticDriver | null = null,
  ) {
    if (driver && driver.kind !== "synthetic")
      throw new Error("UNQUALIFIED_ROUTE");
  }
  private owned(binding: AttemptBinding): void {
    attemptBindingSchema.parse(binding);
    const task = this.store.load(binding.runId).context.issuedLogicalTasks[
      binding.logicalTaskKey
    ];
    if (
      !task?.binding ||
      task.stage !== "receipt_recorded" ||
      !same(task.binding, binding)
    )
      throw new Error("OWNED_ATTEMPT_REQUIRED");
  }
  validatePrepared(spec: PreparedWorkerInput): void {
    if (!this.driver) throw new Error("UNQUALIFIED_ROUTE");
    const r = launchReservationSchema.parse(spec.reservation) as LaunchReservation;
    const snapshot = this.store.load(r.bindings.runId),
      task = snapshot.context.issuedLogicalTasks[r.logicalTaskKey],
      effect = this.store.effectRecord(r.effectKey);
    if (
      !task || !same(task.reservation, r) || effect.intent.kind !== "launch" ||
      !["pending_execution", "dispatched"].includes(task.stage) ||
      effect.status !== task.stage
    )
      throw new Error("RESERVATION_MISMATCH");
    if (
      !same(spec.config, snapshot.context.config) ||
      snapshot.context.inferenceBlock ||
      snapshot.context.pendingContextUpdate ||
      snapshot.context.control.supersededTaskKeys.includes(r.logicalTaskKey)
    )
      throw new Error("STALE_LAUNCH_INPUT");
    const selection =
      r.role === "judge"
        ? spec.config.resolved.judge
        : spec.config.resolved.reviewers[r.role];
    if (!same(selection, r.requested))
      throw new Error("CONFIGURED_MAPPING_MISMATCH");
    if (
      !same(spec.routeEvidence.admission, spec.admission) ||
      spec.routeEvidence.role !== r.role
    )
      throw new Error("PHASE_ADMISSION_REQUIRED");
    selectionArgv(selection, spec.routeEvidence);
    if (
      qualifySelection(
        {
          selection,
          host: spec.admission.host,
          versions: spec.admission.versions,
          actionClass: spec.access.actionClass,
          roots: spec.access.grantedRoots,
          now: spec.routeEvidence.now,
        },
        [spec.routeEvidence.qualification],
      ).kind !== "ready"
    )
      throw new Error("UNQUALIFIED_ROUTE");
    const { setHash, ...admission } = spec.admission;
    if (
      setHash !== hash("launch-admission", admission) ||
      admission.kind !== "phase" ||
      admission.runId !== r.bindings.runId ||
      admission.phase !== r.phase ||
      admission.configHash !== r.bindings.configHash ||
      admission.profileHash !== r.bindings.profileHash ||
      !admission.assignments.some(
        (assignment) =>
          assignment.role === r.role && same(assignment.selection, r.requested),
      ) ||
      admission.assignments.some(
        (assignment) =>
          !same(
            assignment.selection,
            assignment.role === "judge"
              ? spec.config.resolved.judge
              : spec.config.resolved.reviewers[assignment.role],
          ),
      ) ||
      admission.assignments.length !==
        new Set(admission.assignments.map((a) => a.role)).size
    )
      throw new Error("PHASE_ADMISSION_REQUIRED");
    if (
      admission.scopeHash !== hash("run-scope", spec.scope) ||
      admission.accessHash !== hash("access-facts", spec.access) ||
      !same(spec.scope, snapshot.context.request.scope)
    )
      throw new Error("SCOPE_ADMISSION_MISMATCH");
    if (
      !same(spec.admissionReceipt, snapshot.context.preflightAttestation) ||
      !same(
        decodeStrictJson(
          Buffer.from(
            this.store.artifacts.readArtifact(spec.admissionReceipt),
          ).toString("utf8"),
        ),
        spec.admission,
      )
    )
      throw new Error("ADMISSION_ATTESTATION_MISMATCH");
    // Hosting workspace and process cwd are independent facts; source roots grant neither.
    if (
      !spec.workspace.id ||
      realpathSync(spec.workspace.path) !== spec.workspace.path ||
      spec.workspace.path !== snapshot.context.request.workspace ||
      realpathSync(spec.cwd) !== spec.cwd ||
      spec.cwd === spec.workspace.path ||
      spec.access.actionClass !== "supplied-packet-read-only" ||
      spec.access.grantedRoots.some((root) => root !== spec.cwd)
    )
      throw new Error("WORKER_ROOT_SEPARATION_REQUIRED");
    validatePrivateWorkerCwd(spec.cwd, r);
    if (
      hash("rendered-worker-packet", spec.packet.text) !==
        spec.packet.renderedHash ||
      Buffer.byteLength(spec.packet.text) >
        Math.min(INPUT_LIMIT_BYTES, this.driver?.packetBoundBytes ?? 0)
    )
      throw new Error("PACKET_DELIVERY_UNQUALIFIED");
    if (
      spec.packet.candidateHash !== ((r.phase === "judge" || r.phase === "ballot") ? snapshot.context.control.candidate?.hash : undefined) ||
      spec.packet.evidenceHash !== ((r.phase === "judge" || r.phase === "ballot") ? snapshot.context.control.evidenceHash ?? undefined : undefined) ||
      spec.packet.judgeHash !== (r.phase === "ballot" ? snapshot.context.control.judgeHash ?? undefined : undefined) ||
      !same(
        spec.packet.admittedMethodIds,
        snapshot.context.profile.admittedMethodIds,
      ) ||
      !same(
        spec.packet.inputQuestionIds,
        snapshot.context.questionLedger.questions.map((q) => q.id),
      ) ||
      !same(
        spec.packet.inputObjectionIds,
        snapshot.context.objections.map((o) => o.id),
      ) ||
      !same(
        spec.packet.inputEvidenceIds,
        snapshot.context.control.evidence.map((e) => e.requestId),
      )
    )
      throw new Error("PACKET_BINDING_MISMATCH");
  }
  validateLaunch(spec: WorkerSpec): void {
    const r = launchReservationSchema.parse(spec.reservation) as LaunchReservation;
    const snapshot = this.store.load(r.bindings.runId),
      task = snapshot.context.issuedLogicalTasks[r.logicalTaskKey],
      effect = this.store.effectRecord(r.effectKey);
    if (
      !task || task.stage !== "dispatched" || effect.status !== "dispatched" ||
      effect.intent.kind !== "launch" || !same(task.reservation, r) ||
      spec.fence.intentHash !== hash("effect", effect.intent)
    )
      throw new Error("LAUNCH_FENCE_REQUIRED");
    const journal = this.store.readJournal(r.bindings.runId).find(row => row.event.id === spec.fence.eventId);
    if (
      !journal || journal.revision !== spec.fence.revision ||
      journal.event.body.kind !== "LAUNCH_DISPATCHED" ||
      journal.event.body.data.logicalTaskKey !== r.logicalTaskKey
    )
      throw new Error("LAUNCH_FENCE_REQUIRED");
    if (!same(spec.deadline, snapshot.context.control.workerDeadlines[r.logicalTaskKey]))
      throw new Error("DEADLINE_BINDING_MISMATCH");
    this.validatePrepared(spec);
  }
  async launch(spec: WorkerSpec): Promise<LaunchReceipt> {
    if (!this.driver) throw new Error("UNQUALIFIED_ROUTE");
    this.validateLaunch(spec);
    const prior = this.receipts.get(spec.reservation.clientAttemptKey);
    if (prior) return prior;
    const key = spec.reservation.clientAttemptKey;
    const pending = this.launches.get(key);
    if (pending) return pending;
    const operation = this.driver
      .launch(spec)
      .then((receipt) => this.acceptReceipt(spec, receipt));
    // Retain a rejected promise too: an uncertain start is never a fresh launch.
    this.launches.set(key, operation);
    return operation;
  }
  acceptReceipt(spec: WorkerSpec, receipt: LaunchReceipt): LaunchReceipt {
    receipt = launchReceiptSchema.parse(receipt) as LaunchReceipt;
    const r = spec.reservation,
      binding = attemptBindingSchema.parse(receipt.binding) as AttemptBinding;
    if (
      !receipt.synthetic ||
      receipt.clientAttemptKey !== r.clientAttemptKey ||
      binding.authority.kind !== "supervised" ||
      !Object.entries(r.bindings).every(
        ([key, value]) => binding[key as keyof AttemptBinding] === value,
      ) ||
      binding.role !== r.role ||
      binding.phase !== r.phase ||
      !same(binding.requested, r.requested) ||
      !same(binding.configured, r.requested) ||
      !same(binding.admittedMethodIds, spec.packet.admittedMethodIds) ||
      !same(binding.inputQuestionIds, spec.packet.inputQuestionIds) ||
      !same(binding.inputObjectionIds, spec.packet.inputObjectionIds) ||
      !same(binding.inputEvidenceIds, spec.packet.inputEvidenceIds) ||
      ["candidateHash", "evidenceHash", "judgeHash"].some(
        (key) =>
          binding[key as keyof AttemptBinding] !==
          spec.packet[key as keyof WorkerPacket],
      )
    )
      throw new Error("LAUNCH_RECEIPT_MISMATCH");
    const prior = this.receipts.get(r.clientAttemptKey);
    if (prior && !same(prior, receipt))
      throw new Error("CONFLICTING_LAUNCH_RECEIPT");
    const { receipt: artifact, ...envelope } = receipt;
    if (
      !same(
        decodeStrictJson(
          Buffer.from(this.store.artifacts.readArtifact(artifact)).toString(
            "utf8",
          ),
        ),
        envelope,
      )
    )
      throw new Error("LAUNCH_RECEIPT_PROOF_MISMATCH");
    const controls = receipt.exposed;
    const delivered =
      controls?.delivery?.verified &&
      controls.delivery.renderedHash === spec.packet.renderedHash &&
      controls.delivery.bytes === Buffer.byteLength(spec.packet.text);
    if (
      !delivered ||
      !same(controls.selection, r.requested) ||
      !same(controls.workspace, spec.workspace) ||
      controls.cwd !== spec.cwd ||
      !same(controls.roots, spec.access.grantedRoots) ||
      controls.mode !== "supplied-packet-read-only" ||
      !controls.helpersDisabled ||
      controls.hooks.length ||
      controls.tools.length ||
      controls.actions.length ||
      controls.children.length
    )
      throw new LaunchControlError(
        receipt,
        delivered ? "UNQUALIFIED_ROUTE" : "INVALID_WORKER_RESULT",
      );
    this.receipts.set(r.clientAttemptKey, structuredClone(receipt));
    return structuredClone(receipt);
  }
  async recover(spec: WorkerSpec): Promise<LaunchReceipt | null> {
    if (!this.driver) return null;
    const effect = this.store.effectRecord(spec.reservation.effectKey);
    if (effect.status !== "dispatched" && effect.status !== "receipt_recorded")
      throw new Error("NO_DISPATCH_TO_RECONCILE");
    const receipt = await this.driver.lookup(spec.reservation.clientAttemptKey);
    return receipt ? this.acceptReceipt(spec, receipt) : null; // Never replacement launch on absence.
  }
  async observe(binding: AttemptBinding): Promise<WorkerObservation> {
    this.owned(binding);
    try {
      if (!this.driver) return observationFromFailure();
      const result = await this.driver.observe(binding);
      if (
        result.resources.attemptId !== binding.attemptId ||
        !same(result.resources.authority, binding.authority)
      )
        return observationFromFailure();
      const observation = workerObservationSchema.parse(result.observation);
      if (
        observation.status !== result.resources.worker.status ||
        observation.exitCode !== result.resources.worker.exitCode
      )
        return observationFromFailure();
      return observation;
    } catch {
      return observationFromFailure();
    }
  }
  async resources(
    binding: AttemptBinding,
  ): Promise<ReturnType<typeof aggregateSettlement>> {
    this.owned(binding);
    try {
      const arming = this.store.effectRecord(
        binding.logicalTaskKey + "/deadline",
      );
      if (
        this.driver &&
        arming.status === "receipt_recorded" &&
        arming.receipt
      ) {
        const ref = arming.receipt.value;
        const artifact =
          typeof ref === "object" && ref !== null && !Array.isArray(ref)
            ? ref
            : null;
        if (!artifact) throw new Error("WATCHDOG_PROOF_REQUIRED");
        const proof = watchdogArmingProofSchema.parse(
          decodeStrictJson(
            Buffer.from(
              this.store.artifacts.readArtifact(
                artifact as unknown as ArtifactRef,
              ),
            ).toString("utf8"),
          ),
        );
        if (proof.attemptId !== binding.attemptId)
          throw new Error("WATCHDOG_BINDING_MISMATCH");
        return aggregateSettlement(
          binding,
          (await this.driver.observe(binding)).resources,
          proof.resourceKey,
        );
      }
    } catch {
      /* unknown stays active */
    }
    return { settled: false, reason: "UNVERIFIABLE_RESOURCES", receipts: [] };
  }
  async stop(binding: AttemptBinding, reason: string): Promise<StopReceipt> {
    this.owned(binding);
    if (!this.driver)
      return {
        attemptId: binding.attemptId,
        requested: false,
        receipt: null,
        reason: "UNQUALIFIED_ROUTE",
      };
    return this.driver.stop(binding, reason);
  }
  async release(binding: AttemptBinding): Promise<ReleaseReceipt> {
    const snapshot = this.store.load(binding.runId),
      task = snapshot.context.issuedLogicalTasks[binding.logicalTaskKey];
    if (
      !task?.binding ||
      !same(task.binding, binding) ||
      !snapshot.context.control.settledResourceTasks.includes(
        binding.logicalTaskKey,
      ) ||
      !(await this.resources(binding)).settled ||
      !this.driver
    )
      return {
        attemptId: binding.attemptId,
        released: false,
        receipt: null,
        reason: "ACCEPTED_SETTLEMENT_REQUIRED",
      };
    return this.driver.release(binding);
  }
}
