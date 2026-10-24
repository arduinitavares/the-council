/** Shared protocol vocabulary. Models author content; adapters author provenance. */
export type ReviewerSeat = 'openai' | 'gemini' | 'claude';
export type WorkerRole = ReviewerSeat | 'judge';
export type ProviderRoute = 'codex' | 'antigravity';
export interface ModelSelection { route: ProviderRoute; model: string; effort: string }
export interface CouncilConfig { version: 1; reviewers: Record<ReviewerSeat, ModelSelection>; judge: ModelSelection }
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export interface ArtifactRef { kind: string; sha256: string; path: string; bytes: number }
export interface ConfigSnapshot { sourcePath: string; rawSha256: string; rawArtifact: ArtifactRef; configArtifact: ArtifactRef; configHash: string; resolved: CouncilConfig }
export interface CheckSpec { id: string; argv: readonly string[]; cwd: string; declaredEffects: readonly string[]; outputTargets: readonly string[] }
export interface RunScope { sourceRoots: readonly string[]; allowedSourceAddresses: readonly string[]; checks: readonly CheckSpec[] }
export type ControlState = 'preflight' | 'needs_context' | 'clarifying' | 'collecting_questions' | 'publishing_answers' | 'prepare_round' | 'reviewing' | 'prepare_candidate' | 'judging' | 'confirming' | 'evaluate_round' | 'reconciling' | 'needs_user' | 'blocked' | 'settling' | 'completed' | 'cancelled';
export interface ProfileSource { id: string; path: string; revision: string; sha256: string }
export interface ProfileAdaptation { methodId: string; retained: readonly string[]; replaced: readonly string[]; excluded: readonly string[] }
export interface ProfileSnapshot { manifest: ArtifactRef; profileHash: string; admittedMethodIds: readonly string[]; sources: readonly ProfileSource[]; adaptations: readonly ProfileAdaptation[] }
export interface SharedContext { contextRevision: number; contextHash: string; topic: ArtifactRef; handoff: ArtifactRef; questionLedgerRefs: readonly ArtifactRef[]; answerLedgerRefs: readonly ArtifactRef[]; userDirections: readonly ArtifactRef[] }
export type AnswerForm = { kind: 'text' } | { kind: 'boolean' } | { kind: 'number' } | { kind: 'json' } | { kind: 'choice'; options: readonly string[] };
export type RawQuestionRef = { kind: 'local'; id: string } | { kind: 'ledger'; id: string };
export interface RawQuestion { id: string; text: string; reason: string; blocking: boolean; answerForm: AnswerForm; dependencies: readonly RawQuestionRef[] }
export type WorkerPhase = 'clarify' | 'review' | 'judge' | 'ballot';
export interface QuestionOrigin { seat: ReviewerSeat; attemptId: string; originAttemptId: string; logicalTaskKey: string; phase: WorkerPhase; round: number; clarificationBatch: number | null }
export interface BoundQuestion { id: string; text: string; reason: string; blocking: boolean; answerForm: AnswerForm; dependencyIds: readonly string[]; origin: QuestionOrigin }
export interface Question extends BoundQuestion { disposition: 'presented' | 'deferred' }
export interface AnswerSource { author: string; receiptId: string }
export interface Answer { id: string; questionId: string; supersededAnswerId?: string | null; status: 'answered' | 'unknown' | 'declined'; value: JsonValue; source: AnswerSource; evidenceIds: readonly string[] }
export interface QuestionLedger { contextHash: string; questions: readonly Question[]; answers: readonly Answer[] }
export type BatchOrigin = { kind: 'clarification'; batchIndex: number } | { kind: 'deliberation'; round: number };
export interface QuestionBatch { id: string; origin: BatchOrigin; baseContextHash: string; questions: readonly Question[]; groups: readonly { id: string; questionIds: readonly string[] }[]; aliases: readonly { questionId: string; groupId: string }[]; sourceAnswers: readonly Answer[]; presentedQuestionIds: readonly string[] }
export interface AnswerBatch { requestId: string; batchId: string; origin: BatchOrigin; baseContextHash: string; answers: readonly Answer[]; finalized: boolean }
export interface AnswerRevision { requestId: string; runId: string; baseContextHash: string; unresolvedQuestionIds: readonly string[]; answers: readonly (Answer & { supersededAnswerId: string | null })[] }
export interface ContextUpdate { requestId: string; runId: string; baseContextHash: string; userDirections: readonly ArtifactRef[] }
export interface BoundedExtension { id: string; baseRevision: number; authorizationReceipt: string; expiresAt: number; additionalClarificationBatches: number; additionalRounds: number; additionalActiveBudgetMs: number }
export interface EffectiveLimits { maxClarificationBatches: number; maxRounds: number; activeBudgetMs: number; maxWorkerCalls: number }
export interface RunRequest { runId: string; workspace: string; topic: string; handoffPath: string; handoffHash: string; config: ConfigSnapshot; profile: ProfileSnapshot; sharedContext: SharedContext; scope: RunScope; maxClarificationBatches: number; maxRounds: number; workerTimeoutMs: number; activeBudgetMs: number }
export interface RoundBindings { runId: string; configHash: string; profileHash: string; contextHash: string; round: number; candidateHash: string; evidenceHash: string; judgeHash: string }
export interface PhaseBindings { runId: string; configHash: string; profileHash: string; contextHash: string; round: number; clarificationBatch: number | null; inputHash: string; logicalTaskKey: string; originAttemptId: string }
export type Authority = { kind: 'supervised'; runId: string; taskId: string; dispatchId: string; receiptId: string } | { kind: 'terminal-only'; terminalId: string; receiptId: string };
export interface LaunchReservation { logicalTaskKey: string; effectKey: string; clientAttemptKey: string; role: WorkerRole; phase: WorkerPhase; requested: ModelSelection; bindings: PhaseBindings }
/** Additional frozen packet fields are trusted adapter input, never worker JSON. */
export interface AttemptBinding extends PhaseBindings {
  attemptId: string; role: WorkerRole; phase: WorkerPhase; requested: ModelSelection; configured: ModelSelection; authority: Authority;
  admittedMethodIds: readonly string[]; inputQuestionIds: readonly string[]; inputObjectionIds: readonly string[]; inputEvidenceIds: readonly string[];
  candidateHash?: string; evidenceHash?: string; judgeHash?: string;
}
export interface RawObjection { id: string; claimId: string; claim: string; evidenceIds: readonly string[]; resolution: string; status: 'open' }
export interface ObjectionDisposition { objectionId: string; status: 'open' | 'closed'; reason: string; evidenceIds: readonly string[] }
export interface DispositionRecord extends ObjectionDisposition { seat: ReviewerSeat; attemptId: string }
export interface Objection { id: string; owner: ReviewerSeat; claimId: string; claim: string; evidenceIds: readonly string[]; resolution: string; status: 'open' | 'closed'; history: readonly DispositionRecord[] }
export interface EvidenceRequest { id: string; claimId: string; source: string; reason: string }
export interface ClaimAssessment { claimId: string; status: 'supported' | 'contradicted' | 'unresolved'; evidenceIds: readonly string[]; reason: string }
export interface JudgeChallenge { id: string; claimId: string; text: string; evidenceIds: readonly string[] }
export interface ChallengeResponse { challengeId: string; response: string; evidenceIds: readonly string[] }
export interface EvidenceRecord { requestId: string; status: 'verified' | 'invalid' | 'unverified' | 'not_applicable'; sourceLocation: string; contentHash: string; observationReceipt: string }
export interface ClarificationPayload { kind: 'clarification'; ready: boolean; questions: readonly RawQuestion[]; methodIds: readonly string[] }
export interface ReviewPayload { kind: 'review'; proposals: readonly string[]; newObjections: readonly RawObjection[]; evidenceRequests: readonly EvidenceRequest[]; missingInputQuestions: readonly RawQuestion[]; methodIds: readonly string[] }
export interface JudgePayload { kind: 'judge'; bindings: Omit<RoundBindings, 'judgeHash'>; assessments: readonly ClaimAssessment[]; challenges: readonly JudgeChallenge[]; methodIds: readonly string[] }
export interface RawBallot { kind: 'ballot'; bindings: RoundBindings; decision: 'accept' | 'reject' | 'abstain'; conditional: boolean; newObjections: readonly RawObjection[]; missingInputQuestions: readonly RawQuestion[]; dispositions: readonly ObjectionDisposition[]; challengeResponses: readonly ChallengeResponse[]; reason: string; methodIds: readonly string[] }
export type WorkerPayload = ClarificationPayload | ReviewPayload | JudgePayload | RawBallot;
export interface Ballot { kind?: 'ballot'; methodIds?: readonly string[]; bindings: RoundBindings; binding: AttemptBinding; seat: ReviewerSeat; decision: 'accept' | 'reject' | 'abstain'; conditional: boolean; newObjections: readonly Objection[]; missingInputQuestions: readonly BoundQuestion[]; dispositions: readonly ObjectionDisposition[]; challengeResponses: readonly ChallengeResponse[]; reason: string }
export type BoundWorkerPayload =
  | (Omit<ClarificationPayload, 'questions'> & { questions: readonly BoundQuestion[]; binding: AttemptBinding })
  | (Omit<ReviewPayload, 'newObjections' | 'missingInputQuestions'> & { newObjections: readonly Objection[]; missingInputQuestions: readonly BoundQuestion[]; binding: AttemptBinding })
  | (JudgePayload & { binding: AttemptBinding })
  | (Ballot & { kind: 'ballot'; methodIds: readonly string[] });
export type WorkerResult = { status: 'valid'; payload: BoundWorkerPayload; binding: AttemptBinding } | { status: 'invalid'; code: string };
export interface FrozenCandidate { text: ArtifactRef; hash: string; assumptions: readonly string[]; tradeoffs: readonly string[]; unresolvedUncertainty: readonly string[]; acknowledgedUnverifiedEvidenceIds: readonly string[] }
export interface ConfirmationContext { expected: RoundBindings; expectedAttempts: Record<ReviewerSeat, AttemptBinding>; config: CouncilConfig; candidate: FrozenCandidate; ballots: readonly Ballot[]; objections: readonly Objection[]; inputObjectionIds: readonly string[]; questionLedger: QuestionLedger; judgeChallengeIds: readonly string[] }
export type ConsensusDecision = { kind: 'unanimous' } | { kind: 'unresolved'; reasons: string[] };
export interface ClockReceipt { id: string; wallMs: number; monotonicMs: number; processEpoch: string }
export interface Clock { wallNow(): number; monotonicNow(): number }
export interface ActiveBudget { totalMs: number; remainingMs: number; status: 'active' | 'paused' | 'settled'; intervalEpoch: number; startReceipt: ClockReceipt; lastReceipt: ClockReceipt; accruedMs: number; appliedExtensionIds: readonly string[]; deadline: ActiveDeadline | null }
export type BudgetEvent = { kind: 'active-checkpoint' | 'resume-active' | 'crash-reconcile' } | { kind: 'settled-human-pause' | 'terminal-settlement'; allResourcesSettled: boolean } | { kind: 'authorized-extension'; extensionId: string; additionalMs: number; authorizationReceipt: string };
export interface ActiveDeadline { wallMs: number; monotonicMs: number; processEpoch: string }
export type BudgetDecision = { kind: 'ok'; budget: ActiveBudget; deadline: ActiveDeadline | null; expired: boolean } | { kind: 'clock-blocker'; code: string; budget: ActiveBudget };
export type EffectKind = 'launch' | 'observe' | 'stop' | 'release' | 'evidence' | 'question-batch-request' | 'candidate-request' | 'publish-context' | 'evaluate-round' | 'report' | 'deadline';
export type EffectIntent = { [K in EffectKind]: { key: string; kind: K; input: JsonValue } }[EffectKind];
export interface IssuedLogicalTask { reservation: LaunchReservation; binding: AttemptBinding | null; stage: 'pending_execution' | 'dispatched' | 'receipt_recorded'; settlement: 'live' | 'unverifiable' | 'settled' }
export interface RunContext {
  control: PersistedControl;
  request: RunRequest; config: ConfigSnapshot; profile: ProfileSnapshot; sharedContext: SharedContext;
  clarificationBatchesUsed: number; roundsUsed: number; callsReserved: number; phaseResults: readonly ArtifactRef[];
  extensions: readonly BoundedExtension[]; effectiveLimits: EffectiveLimits; issuedLogicalTasks: Readonly<Record<string, IssuedLogicalTask>>;
  requiredEvidenceIds: readonly string[]; questionLedger: QuestionLedger; inferenceBlock: string | null; pendingEvidenceIds: readonly string[];
  expectedAttempts: Readonly<Partial<Record<WorkerRole, AttemptBinding>>>; objections: readonly Objection[]; ballots: readonly Ballot[];
  pendingOutcome: string | null; pauseReason: string | null; resumeTarget: ControlState | null; reconcileOriginState: ControlState | null;
  pendingContextUpdate: ContextUpdate | null; preflightAttestation: ArtifactRef | null; publicationKind: 'answer_batch' | 'answer_revision' | null;
  deadlines: readonly ActiveDeadline[]; activeBudget: ActiveBudget;
}
export interface RunSnapshot { machineVersion: number; schemaVersion: number; revision: number; state: ControlState; context: RunContext }
export interface TransitionResult { snapshot: RunSnapshot; intents: readonly EffectIntent[] }
export type WorkerObservation = { status: 'live' | 'unverifiable' | 'exited'; rawReceipts: readonly ArtifactRef[]; exitCode: number | null };
export interface PublicationRecord {
  kind: 'answer_batch' | 'answer_revision';
  origin: BatchOrigin | null;
  questionCount: number;
  contextHash: string;
  input: AnswerBatch | AnswerRevision;
}
export interface WatchdogArming { key: string; intentHash: string; logicalTaskKey: string; attemptId: string; deadline: ActiveDeadline; receipt: ArtifactRef }
/** All data needed to resume a phase is journaled, never held in an actor. */
export interface PersistedControl {
  stagedQuestions: readonly BoundQuestion[];
  questionBatch: QuestionBatch | null;
  pendingAnswerBatch: AnswerBatch | null;
  pendingAnswerRevision: AnswerRevision | null;
  phasePayloads: Readonly<Partial<Record<WorkerRole, BoundWorkerPayload>>>;
  phaseArtifacts: Readonly<Partial<Record<WorkerRole, ArtifactRef>>>;
  savedResults: Readonly<Record<string, { payload: BoundWorkerPayload; artifact: ArtifactRef }>>;
  workerDeadlines: Readonly<Record<string, ActiveDeadline>>;
  supersededTaskKeys: readonly string[];
  settledResourceTasks: readonly string[];
  currentWaveQuestionCount: number;
  candidate: FrozenCandidate | null;
  evidence: readonly EvidenceRecord[];
  evidenceHash: string | null;
  judge: (JudgePayload & { binding: AttemptBinding }) | null;
  judgeHash: string | null;
  confirmation: ConfirmationContext | null;
  publications: readonly PublicationRecord[];
  candidateRequested: boolean;
  acceptedEvents: Readonly<Record<string, string>>;
}
export type ControlEventBody =
  | {
      kind: 'PREFLIGHT';
      data: {
        status: 'pass' | 'needs_context' | 'blocked';
        attestation: ArtifactRef | null;
        code: string | null;
        resourcesSettled: boolean;
      };
    }
  | {
      kind:
        | 'CLOCK_CHECKPOINT'
        | 'ADMIT_ROUND'
        | 'PHASE_READY'
        | 'PUBLISH_ANSWERS'
        | 'REQUEST_CANDIDATE'
        | 'EVALUATE_ROUND'
        | 'CANCEL'
        | 'DEADLINE'
        | 'LIFECYCLE_UNKNOWN'
        | 'RESUME'
        | 'APPLY_CONTEXT_UPDATE';
      data: Record<string, never>;
    }
  | { kind: 'ERROR'; data: { code: string; terminalInference: boolean } }
  | {
      kind: 'REQUIRE_INPUT';
      data: { reason: string; outcome: 'needs_user' | 'needs_context' | 'blocked' };
    }
  | { kind: 'LAUNCH_DISPATCHED'; data: { logicalTaskKey: string } }
  | { kind: 'LAUNCH_RECEIPT_RECORDED'; data: { binding: AttemptBinding } }
  | { kind: 'WATCHDOG_ARMED'; data: WatchdogArming }
  | { kind: 'EFFECT_RECEIPT_RECORDED'; data: { key: string; intentHash: string; receipt: ArtifactRef } }
  | { kind: 'WORKER_RESULT'; data: { payload: BoundWorkerPayload; artifact: ArtifactRef } }
  | { kind: 'WORKER_OBSERVED'; data: { logicalTaskKey: string; observation: WorkerObservation } }
  | { kind: 'COLLECT_QUESTIONS'; data: { batch: QuestionBatch } }
  | { kind: 'ANSWER_BATCH'; data: { batch: AnswerBatch } }
  | { kind: 'ANSWER_REVISION'; data: { revision: AnswerRevision } }
  | { kind: 'CONTEXT_UPDATE'; data: { update: ContextUpdate } }
  | { kind: 'EVIDENCE_RECORDED'; data: { record: EvidenceRecord } }
  | { kind: 'EVIDENCE_REQUESTED'; data: { request: EvidenceRequest } }
  | { kind: 'CANDIDATE_FROZEN'; data: { candidate: FrozenCandidate; evidenceHash: string } }
  | { kind: 'EXTEND'; data: { extension: BoundedExtension } }
  | { kind: 'SETTLED'; data: { receipt: ArtifactRef } }
  | {
      kind: 'RESOURCES_SETTLED';
      data: { logicalTaskKeys: readonly string[]; receipt: ArtifactRef };
    }
  | {
      kind: 'RECONCILED';
      data: {
        ownership: boolean;
        priorControllerExited: boolean;
        resourcesSettled: boolean;
        receipt: ArtifactRef;
        observations: readonly {
          logicalTaskKey: string;
          observation: WorkerObservation;
          savedResult?: { payload: BoundWorkerPayload; artifact: ArtifactRef };
        }[];
      };
    };
export interface ValidatedEvent {
  id: string;
  runId: string;
  schemaVersion: number;
  actor: { kind: 'adapter' | 'user' | 'controller'; receiptId: string };
  round: number;
  phase: WorkerPhase | null;
  clockReceipt: ClockReceipt;
  body: ControlEventBody;
}
export interface RunOutcome {
  decision: 'unanimous' | 'unresolved' | 'cancelled' | 'blocked';
  state: ControlState;
  settlement: 'settled' | 'unverifiable';
  reports: readonly ArtifactRef[];
  blockers: readonly string[];
}
