import type { ModelSelection, PilotConfig, Role } from "./config.js";
import type { ScopedLaunchPlan } from "./scoped-launch.js";
import type { ContextProof, ControlFact, ProviderRecipe } from "./wrapper-contract.js";
export type Phase =
  | "normal-probe"
  | "cancel-probe"
  | "readiness"
  | "review"
  | "judge"
  | "ballot";
export interface Observation {
  state:
    | "verified"
    | "unknown"
    | "missing"
    | "denied"
    | "authentication_failed"
    | "exhausted"
    | "unavailable"
    | "unsupported";
  source: string;
  detail: string;
}
export interface RouteEvidence {
  role: Role;
  selection: ModelSelection;
  version: string;
  catalog: Observation;
  controls: Observation;
  allowance: Observation;
  billing: Observation;
  optionalTelemetry: Observation;
  scopedLaunchPlan?: ScopedLaunchPlan | undefined;
  bootstrap?: Observation | undefined;
  controlFacts?: ControlFact[] | undefined;
  recipe?: ProviderRecipe | undefined;
  policyAdmission?: {
    state: "admitted" | "conditional";
    routeCell: string;
    qualifier: string;
    firstUseOnly: boolean;
  } | undefined;
}
export interface NativeEvidence {
  host: string;
  runtimeId: string;
  orcaVersion: string;
  versions: Record<string, string>;
  roots: string[];
  workspace: string;
  workspaceId: string;
  action: "supplied-packet-read-only";
  policyHash: string;
  controlsHash: string;
  producerCodeHash?: string | undefined;
  routes: RouteEvidence[];
}
export interface Blocker {
  role: Role | null;
  control: string;
  reason: string;
  source: string;
  observed: string;
  nextAction: string;
}
export interface QualificationProof {
  schemaVersion: 1 | 2;
  id: string;
  key: string;
  issuedAt: number;
  expiresAt: number;
  scope: NativeEvidence;
  normal: { dispatchId: string; outcome: "completed"; settled: true; context?: ContextProof | undefined };
  cancellation: { dispatchId: string; outcome: "cancelled"; settled: true; stop?: StopAcknowledgement | undefined; context?: ContextProof | undefined };
  settled: true;
}
export interface StopAcknowledgement {
  dispatchId: string;
  requestId: string;
  state: "stopped";
  kind?: "wrapper-control" | undefined;
}
export type CancellationResult =
  | { state: "settled"; stop: StopAcknowledgement }
  | { state: "settled_unacknowledged"; error?: string | undefined }
  | { state: "unknown" };
export interface Binding {
  runId: string;
  taskId: string;
  dispatchId: string;
  handle: string;
  attemptKey: string;
}
export interface Attempt {
  binding: Binding;
  role: Role;
  phase: Phase;
  selection: ModelSelection;
  packetHash: string;
  launchVerified: boolean;
  context?: { directory: string; assignmentHash: string } | undefined;
  inferenceStarted?: boolean | null | undefined;
  initializations?: number | undefined;
  controlError?: string | undefined;
}
export interface Result {
  binding: Binding;
  packetHash: string;
  phase: Phase;
  role: Role;
  payload: unknown;
  settlement: "settled" | "unknown";
  source: string;
  sourceIdentity: string;
  provider: string;
}
export interface PilotRequest {
  workspace: string;
  config: PilotConfig;
  policyPath: string;
  candidate: string;
  suppliedText: string;
  maxProbeCalls: number;
  maxTopicCalls: number;
  deadline: number;
  workerTimeoutMs: number;
  proofTtlMs?: number | undefined;
  proofs: QualificationProof[];
}
export interface HostInspector {
  inspect(
    request: PilotRequest,
  ): Promise<{ evidence: NativeEvidence; blockers: Blocker[] }>;
}
export interface PilotDriver extends HostInspector {
  proof?(attempt: Attempt): ContextProof | null;
  begin(request: PilotRequest, mutationRequestId?: string): Promise<string>;
  launch(
    runId: string,
    request: PilotRequest,
    role: Role,
    phase: Phase,
    packet: string,
    attemptKey: string,
  ): Promise<Attempt>;
  observe(attempt: Attempt, deadline: number): Promise<Result>;
  cancel(attempt: Attempt, deadline: number, mode?: "absolute-cleanup"): Promise<CancellationResult>;
  release(attempt: Attempt, deadline?: number): Promise<boolean>;
}
