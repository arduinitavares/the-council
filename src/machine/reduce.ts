import { initialTransition, transition } from 'xstate';
import type {
  AttemptBinding,
  BoundWorkerPayload,
  ConfirmationContext,
  ControlState,
  EffectIntent,
  EffectKind,
  JsonValue,
  Question,
  QuestionBatch,
  RunContext,
  RunRequest,
  RunSnapshot,
  TransitionResult,
  ValidatedEvent,
  WorkerPhase,
  WorkerRole,
  WorkerObservation,
} from '../domain/contracts.js';
import { accountBudget } from '../domain/budget.js';
import { evaluateConsensus } from '../domain/consensus.js';
import { canonicalJson, hashArtifact } from '../domain/hash.js';
import { applyOwnedDispositions, registerObjections } from '../domain/objections.js';
import {
  appendAnswerRevision,
  latestAnswers,
  unresolvedBlockingQuestions,
  validateQuestionLedger,
} from '../domain/questions.js';
import {
  jsonValueSchema,
  runRequestSchema,
  runSnapshotSchema,
  validatedEventSchema,
} from '../domain/schemas.js';
import { activeStates, councilMachine, stateEventTargets } from './council-machine.js';

const seats = ['openai', 'gemini', 'claude'] as const;
const pauses: readonly ControlState[] = ['needs_user', 'needs_context', 'blocked'];
const midRound: readonly ControlState[] = [
  'reviewing',
  'prepare_candidate',
  'judging',
  'confirming',
  'evaluate_round',
];
const phaseState: Record<WorkerPhase, ControlState> = {
  clarify: 'clarifying',
  review: 'reviewing',
  judge: 'judging',
  ballot: 'confirming',
};
const json = (value: unknown): JsonValue => jsonValueSchema.parse(value);
const hash = (kind: string, value: unknown) => hashArtifact(kind, json(value));
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
function requireThat(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function allSettled(c: RunContext): boolean {
  return Object.values(c.issuedLogicalTasks).every(
    (t) =>
      t.stage === 'pending_execution' ||
      (t.settlement === 'settled' &&
        c.control.settledResourceTasks.includes(t.reservation.logicalTaskKey)),
  );
}
function taskCurrent(c: RunContext, b: AttemptBinding): boolean {
  return (
    b.runId === c.request.runId &&
    b.configHash === c.config.configHash &&
    b.profileHash === c.profile.profileHash &&
    b.contextHash === c.sharedContext.contextHash &&
    b.round === (b.phase === 'clarify' ? 0 : c.roundsUsed) &&
    b.clarificationBatch === (b.phase === 'clarify' ? c.clarificationBatchesUsed : null)
  );
}
function admission(c: RunContext, allowQueuedContextUpdate = false): boolean {
  return (
    !c.inferenceBlock &&
    (!c.pendingContextUpdate || allowQueuedContextUpdate) &&
    !!c.preflightAttestation &&
    c.activeBudget.remainingMs > 0 &&
    c.activeBudget.status === 'active' &&
    allSettled(c)
  );
}
function canRound(c: RunContext, atBoundary = false): boolean {
  return (
    admission(c, atBoundary) &&
    !c.control.questionBatch &&
    !unresolvedBlockingQuestions(c.questionLedger).length &&
    c.roundsUsed < c.effectiveLimits.maxRounds
  );
}
function initialContext(request: RunRequest): RunContext {
  const receipt = { id: 'unstarted', wallMs: 0, monotonicMs: 0, processEpoch: 'unstarted' };
  return {
    request,
    config: request.config,
    profile: request.profile,
    sharedContext: request.sharedContext,
    clarificationBatchesUsed: 0,
    roundsUsed: 0,
    callsReserved: 0,
    phaseResults: [],
    extensions: [],
    effectiveLimits: {
      maxClarificationBatches: request.maxClarificationBatches,
      maxRounds: request.maxRounds,
      activeBudgetMs: request.activeBudgetMs,
      maxWorkerCalls: 3 * request.maxClarificationBatches + 7 * request.maxRounds,
    },
    issuedLogicalTasks: {},
    requiredEvidenceIds: [],
    questionLedger: { contextHash: request.sharedContext.contextHash, questions: [], answers: [] },
    inferenceBlock: null,
    pendingEvidenceIds: [],
    expectedAttempts: {},
    objections: [],
    ballots: [],
    pendingOutcome: null,
    pauseReason: null,
    resumeTarget: null,
    reconcileOriginState: null,
    pendingContextUpdate: null,
    preflightAttestation: null,
    publicationKind: null,
    deadlines: [],
    activeBudget: {
      totalMs: request.activeBudgetMs,
      remainingMs: request.activeBudgetMs,
      status: 'paused',
      intervalEpoch: 0,
      startReceipt: receipt,
      lastReceipt: receipt,
      accruedMs: 0,
      appliedExtensionIds: [],
      deadline: null,
    },
    control: {
      stagedQuestions: [],
      questionBatch: null,
      pendingAnswerBatch: null,
      pendingAnswerRevision: null,
      phasePayloads: {},
      phaseArtifacts: {},
      savedResults: {},
      workerDeadlines: {},
      supersededTaskKeys: [],
      settledResourceTasks: [],
      currentWaveQuestionCount: 0,
      candidate: null,
      evidence: [],
      evidenceHash: null,
      judge: null,
      judgeHash: null,
      confirmation: null,
      publications: [],
      candidateRequested: false,
      acceptedEvents: {},
    },
  };
}
export function createInitialSnapshot(request: RunRequest): RunSnapshot {
  const input = runRequestSchema.parse(request);
  const [s] = initialTransition(councilMachine, initialContext(input));
  return {
    machineVersion: 1,
    schemaVersion: 1,
    revision: 0,
    state: 'preflight',
    context: structuredClone(s.context),
  };
}
function checked(snapshot: RunSnapshot): void {
  runSnapshotSchema.parse(snapshot);
  const c = snapshot.context;
  requireThat(
    same(c.config, c.request.config) && same(c.profile, c.request.profile),
    'Frozen configuration/profile mismatch',
  );
  requireThat(
    c.questionLedger.contextHash === c.sharedContext.contextHash,
    'Ledger context mismatch',
  );
  validateQuestionLedger(c.questionLedger);
  const limits = c.extensions.reduce(
    (l, e) => ({
      maxClarificationBatches: l.maxClarificationBatches + e.additionalClarificationBatches,
      maxRounds: l.maxRounds + e.additionalRounds,
      activeBudgetMs: l.activeBudgetMs + e.additionalActiveBudgetMs,
    }),
    {
      maxClarificationBatches: c.request.maxClarificationBatches,
      maxRounds: c.request.maxRounds,
      activeBudgetMs: c.request.activeBudgetMs,
    },
  );
  requireThat(
    same(c.effectiveLimits, {
      ...limits,
      maxWorkerCalls: 3 * limits.maxClarificationBatches + 7 * limits.maxRounds,
    }),
    'Effective limits mismatch',
  );
  requireThat(
    c.callsReserved === Object.keys(c.issuedLogicalTasks).length,
    'Reservation ledger/counter mismatch',
  );
  requireThat(c.callsReserved <= c.effectiveLimits.maxWorkerCalls, 'Call limit exceeded');
  if (snapshot.state === 'reconciling')
    requireThat(
      c.reconcileOriginState && c.reconcileOriginState !== 'reconciling',
      'Missing reconciliation origin',
    );
}
export function restoreForReconciliation(snapshot: RunSnapshot): RunSnapshot {
  checked(snapshot);
  const next = structuredClone(snapshot);
  if (next.state !== 'reconciling') next.context.reconcileOriginState = next.state;
  next.state = 'reconciling';
  next.context.preflightAttestation = null;
  return next;
}

/** Accepted recorded inputs are the only source of clocks, decisions and identities. */
export function reduceRun(snapshot: RunSnapshot, event: ValidatedEvent): TransitionResult {
  checked(snapshot);
  // Parsing precedes all guards; this cast follows complete strict runtime decoding.
  const e = validatedEventSchema.parse(event) as ValidatedEvent;
  const c = structuredClone(snapshot.context);
  const from = snapshot.state;
  let target = from;
  const intents: EffectIntent[] = [];
  const digest = hash('event', e);
  const prior = Object.hasOwn(c.control.acceptedEvents, e.id)
    ? c.control.acceptedEvents[e.id]
    : undefined;
  if (prior) {
    requireThat(prior === digest, 'Conflicting duplicate event');
    return { snapshot, intents: [] };
  }
  requireThat(e.runId === c.request.runId && e.round === c.roundsUsed, 'Event run/round mismatch');
  requireThat(!['completed', 'cancelled'].includes(from), 'RUN_SETTLED');
  const b = e.body;
  requireThat(stateEventTargets[from][b.kind], 'Event not legal in this state');
  if (b.kind === 'CONTEXT_UPDATE')
    requireThat(from !== 'clarifying', 'CONTEXT_UPDATE_DURING_CLARIFICATION');
  if (b.kind === 'RESUME')
    requireThat(!c.inferenceBlock, 'Terminal inference block permits inspection only');
  const adapterKinds = [
    'LAUNCH_RECEIPT_RECORDED',
    'WORKER_RESULT',
    'WORKER_OBSERVED',
    'RECONCILED',
    'SETTLED',
    'RESOURCES_SETTLED',
    'EVIDENCE_RECORDED',
  ];
  const controllerKinds = [
    'CLOCK_CHECKPOINT',
    'ADMIT_ROUND',
    'PHASE_READY',
    'PUBLISH_ANSWERS',
    'REQUEST_CANDIDATE',
    'CANDIDATE_FROZEN',
    'EVALUATE_ROUND',
    'LAUNCH_DISPATCHED',
    'APPLY_CONTEXT_UPDATE',
    'COLLECT_QUESTIONS',
    'EVIDENCE_REQUESTED',
  ];
  if (['PREFLIGHT', 'ERROR', 'DEADLINE', 'LIFECYCLE_UNKNOWN'].includes(b.kind))
    requireThat(e.actor.kind !== 'user', 'Controller or adapter actor required');
  if (adapterKinds.includes(b.kind))
    requireThat(e.actor.kind === 'adapter', 'Adapter actor required');
  if (controllerKinds.includes(b.kind))
    requireThat(e.actor.kind === 'controller', 'Controller actor required');
  const emit = (
    kind: EffectKind,
    assignment: string,
    input: unknown = {},
    p: WorkerPhase | null = null,
    role: WorkerRole | 'controller' = 'controller',
  ) => {
    const wave =
      p === 'clarify' || c.roundsUsed === 0 ? `c${c.clarificationBatchesUsed}` : `r${c.roundsUsed}`;
    const key = `${c.request.runId}/${wave}/${p ?? target}/${role}/${assignment}`;
    intents.push({ key, kind, input: json(input) });
    return key;
  };
  const enter = (state: ControlState) => {
    target = state;
  };
  const pause = (
    reason: string,
    outcome: 'needs_user' | 'blocked' | 'needs_context' = 'needs_user',
    saved: ControlState = 'prepare_round',
  ) => {
    c.pendingOutcome = outcome;
    c.pauseReason = reason;
    if (!c.resumeTarget) {
      const origin = saved === 'reconciling' ? c.reconcileOriginState : saved;
      c.resumeTarget =
        origin && activeStates.includes(origin) && origin !== 'preflight'
          ? origin
          : c.roundsUsed > 0
            ? 'prepare_round'
            : 'clarifying';
    }
    enter('settling');
  };
  const reconcile = () => {
    if (from !== 'reconciling') c.reconcileOriginState = from;
    requireThat(c.reconcileOriginState, 'Missing reconciliation origin');
    c.preflightAttestation = null;
    enter('reconciling');
    for (const t of Object.values(c.issuedLogicalTasks).filter(
      (t) =>
        t.stage !== 'pending_execution' &&
        (t.settlement !== 'settled' ||
          !c.control.settledResourceTasks.includes(t.reservation.logicalTaskKey)),
    ))
      intents.push({
        key: `${t.reservation.effectKey}/observe/${e.id}`,
        kind: 'observe',
        input: json(t.reservation),
      });
  };
  const stop = () => {
    for (const t of Object.values(c.issuedLogicalTasks).filter(
      (t) =>
        t.stage !== 'pending_execution' &&
        (t.settlement !== 'settled' ||
          !c.control.settledResourceTasks.includes(t.reservation.logicalTaskKey)),
    ))
      intents.push({
        key: `${t.reservation.effectKey}/stop`,
        kind: 'stop',
        input: json(t.reservation),
      });
  };
  const launch = (p: WorkerPhase) => {
    requireThat(admission(c), 'Admission prerequisites failed');
    const roles: readonly WorkerRole[] = p === 'judge' ? ['judge'] : seats;
    requireThat(
      c.callsReserved + roles.length <= c.effectiveLimits.maxWorkerCalls,
      'Worker-call limit',
    );
    c.control.phasePayloads = {};
    c.control.phaseArtifacts = {};
    c.phaseResults = [];
    c.expectedAttempts = {};
    for (const role of roles) {
      const wave = p === 'clarify' ? `c${c.clarificationBatchesUsed}` : `r${c.roundsUsed}`;
      const key = `${c.request.runId}/${wave}/${p}/${role}/inference`;
      requireThat(!c.issuedLogicalTasks[key], 'Inference already reserved');
      const inputHash = hash('phase-input', {
        configHash: c.config.configHash,
        profileHash: c.profile.profileHash,
        contextHash: c.sharedContext.contextHash,
        round: c.roundsUsed,
        batch: c.clarificationBatchesUsed,
        phase: p,
        role,
        candidate: c.control.candidate,
        evidenceHash: c.control.evidenceHash,
        judgeHash: c.control.judgeHash,
        objections: c.objections,
      });
      const reservation = {
        logicalTaskKey: key,
        effectKey: key,
        clientAttemptKey: `${key}/attempt`,
        role,
        phase: p,
        requested: role === 'judge' ? c.config.resolved.judge : c.config.resolved.reviewers[role],
        bindings: {
          runId: c.request.runId,
          configHash: c.config.configHash,
          profileHash: c.profile.profileHash,
          contextHash: c.sharedContext.contextHash,
          round: p === 'clarify' ? 0 : c.roundsUsed,
          clarificationBatch: p === 'clarify' ? c.clarificationBatchesUsed : null,
          inputHash,
          logicalTaskKey: key,
          originAttemptId: `${key}/attempt`,
        },
      };
      c.issuedLogicalTasks = {
        ...c.issuedLogicalTasks,
        [key]: {
          reservation,
          binding: null,
          stage: 'pending_execution',
          settlement: 'unverifiable',
        },
      };
      c.callsReserved++;
      intents.push({ key, kind: 'launch', input: json(reservation) });
    }
  };
  const prepare = () => {
    if (canRound(c, true)) enter('prepare_round');
    else
      pause(
        c.roundsUsed >= c.effectiveLimits.maxRounds
          ? 'ROUND_LIMIT'
          : unresolvedBlockingQuestions(c.questionLedger).length
            ? 'CLARIFICATION_LIMIT'
            : (c.inferenceBlock ?? 'ADMISSION_BLOCKED'),
        c.inferenceBlock ? 'blocked' : 'needs_user',
      );
  };
  const queuedPublication = () =>
    !!c.control.pendingAnswerRevision || !!c.control.pendingAnswerBatch?.finalized;
  const preflightRoute = () => {
    if (c.inferenceBlock) {
      pause(c.inferenceBlock, 'blocked', c.resumeTarget ?? 'clarifying');
      return;
    }
    if (queuedPublication()) {
      c.publicationKind = c.control.pendingAnswerRevision ? 'answer_revision' : 'answer_batch';
      enter('publishing_answers');
      const input = c.control.pendingAnswerRevision ?? c.control.pendingAnswerBatch!;
      emit('publish-context', `publish-${input.requestId}`, input);
      return;
    }
    if (c.control.stagedQuestions.length || c.resumeTarget === 'collecting_questions') {
      enter('collecting_questions');
      return;
    }
    if (c.control.questionBatch) {
      pause('AWAITING_ANSWERS', 'needs_user', 'publishing_answers');
      return;
    }
    const saved = c.resumeTarget ?? (c.roundsUsed === 0 ? 'clarifying' : 'prepare_round');
    if (saved === 'clarifying' && c.roundsUsed === 0) {
      if (
        Object.values(c.issuedLogicalTasks).some(
          (t) =>
            t.reservation.phase === 'clarify' &&
            t.reservation.bindings.clarificationBatch === c.clarificationBatchesUsed,
        )
      ) {
        enter('clarifying');
        return;
      }
      if (admission(c) && c.clarificationBatchesUsed < c.effectiveLimits.maxClarificationBatches) {
        c.clarificationBatchesUsed++;
        enter('clarifying');
        launch('clarify');
        return;
      }
      pause('CLARIFICATION_LIMIT');
      return;
    }
    if (saved === 'prepare_round') {
      prepare();
      return;
    }
    if (
      midRound.includes(saved) &&
      c.roundsUsed > 0 &&
      c.roundsUsed <= c.effectiveLimits.maxRounds &&
      admission(c)
    ) {
      enter(saved);
      return;
    }
    pause('UNAVAILABLE_CONTINUATION');
  };
  const validResult = (payload: BoundWorkerPayload) => {
    const binding = payload.binding;
    const issued = c.issuedLogicalTasks[binding.logicalTaskKey];
    requireThat(
      issued?.binding && issued.stage === 'receipt_recorded' && same(issued.binding, binding),
      'Unknown/stale result attempt',
    );
    requireThat(
      taskCurrent(c, binding) &&
        phaseState[binding.phase] === (from === 'reconciling' ? c.reconcileOriginState : from) &&
        (e.phase === binding.phase || b.kind === 'RECONCILED'),
      'Stale result phase',
    );
    const expectedKind = {
      clarify: 'clarification',
      review: 'review',
      judge: 'judge',
      ballot: 'ballot',
    } as const;
    requireThat(payload.kind === expectedKind[binding.phase], 'Result kind mismatch');
    requireThat(
      payload.methodIds?.every((id) => c.profile.admittedMethodIds.includes(id)),
      'Unadmitted method',
    );
    if (payload.kind === 'ballot')
      requireThat(payload.seat === binding.role, 'Ballot seat mismatch');
    if (payload.kind === 'ballot' || payload.kind === 'review')
      for (const o of payload.newObjections)
        requireThat(
          o.id.startsWith(
            `${binding.runId}/${binding.phase}/r${binding.round}/${binding.role}/objection/`,
          ) &&
            o.owner === binding.role &&
            o.status === 'open' &&
            !o.history.length,
          'Objection provenance mismatch',
        );
    if (payload.kind === 'ballot' || payload.kind === 'judge')
      for (const [k, v] of Object.entries(payload.bindings))
        requireThat(binding[k as keyof AttemptBinding] === v, 'Result target mismatch');
    const questions =
      payload.kind === 'clarification'
        ? payload.questions
        : payload.kind === 'review' || payload.kind === 'ballot'
          ? payload.missingInputQuestions
          : [];
    for (const q of questions)
      requireThat(
        q.origin.seat === binding.role &&
          q.origin.attemptId === binding.attemptId &&
          q.origin.originAttemptId === binding.originAttemptId &&
          q.origin.logicalTaskKey === binding.logicalTaskKey &&
          q.origin.phase === binding.phase &&
          q.origin.round === binding.round &&
          q.origin.clarificationBatch === binding.clarificationBatch &&
          q.id.startsWith(`${binding.runId}/`),
        'Question provenance mismatch',
      );
  };
  const observe = (key: string, o: WorkerObservation) => {
    const t = c.issuedLogicalTasks[key];
    requireThat(t && t.stage !== 'pending_execution', 'Unknown/unsent observation');
    if (o.status !== 'unverifiable')
      requireThat(o.rawReceipts.length > 0, 'Positive lifecycle receipt required');
    c.issuedLogicalTasks = {
      ...c.issuedLogicalTasks,
      [key]: { ...t, settlement: o.status === 'exited' ? 'settled' : o.status },
    };
    if (o.status === 'exited' && o.exitCode !== 0) {
      c.inferenceBlock = 'WORKER_FAILED';
      c.pendingOutcome = 'blocked';
      c.pauseReason = 'WORKER_FAILED';
    }
  };
  const confirmation = (): ConfirmationContext => {
    const a = c.expectedAttempts;
    requireThat(
      a.openai &&
        a.gemini &&
        a.claude &&
        c.control.candidate &&
        c.control.evidenceHash &&
        c.control.judgeHash &&
        c.control.judge,
      'Missing confirmation records',
    );
    return {
      expected: {
        runId: c.request.runId,
        configHash: c.config.configHash,
        profileHash: c.profile.profileHash,
        contextHash: c.sharedContext.contextHash,
        round: c.roundsUsed,
        candidateHash: c.control.candidate.hash,
        evidenceHash: c.control.evidenceHash,
        judgeHash: c.control.judgeHash,
      },
      expectedAttempts: { openai: a.openai, gemini: a.gemini, claude: a.claude },
      config: c.config.resolved,
      candidate: c.control.candidate,
      ballots: c.ballots,
      objections: c.objections,
      inputObjectionIds: a.openai.inputObjectionIds,
      questionLedger: c.questionLedger,
      judgeChallengeIds: c.control.judge.challenges.map((x) => x.id),
    };
  };
  const compileExpected = (): Question[] => {
    const answers = latestAnswers(c.questionLedger);
    const existing = new Set(c.questionLedger.questions.map((q) => q.id));
    requireThat(
      new Set(c.control.stagedQuestions.map((q) => q.id)).size === c.control.stagedQuestions.length,
      'Duplicate staged questions',
    );
    for (const q of c.control.stagedQuestions)
      requireThat(!existing.has(q.id), 'Repeated published question');
    const promoted = c.questionLedger.questions
      .filter(
        (q) =>
          q.disposition === 'deferred' &&
          !answers.has(q.id) &&
          q.dependencyIds.every((id) => answers.get(id)?.status === 'answered'),
      )
      .map((q) => ({ ...q, disposition: 'presented' as const }));
    return [
      ...promoted,
      ...c.control.stagedQuestions.map((q) => ({
        ...q,
        disposition: q.dependencyIds.every((id) => answers.get(id)?.status === 'answered')
          ? ('presented' as const)
          : ('deferred' as const),
      })),
    ];
  };
  const applyContext = () => {
    const update = c.pendingContextUpdate;
    requireThat(
      update && !c.control.questionBatch && allSettled(c),
      'Context update boundary unavailable',
    );
    requireThat(update.baseContextHash === c.sharedContext.contextHash, 'STALE_CONTEXT_UPDATE');
    c.control.supersededTaskKeys = [
      ...new Set([
        ...c.control.supersededTaskKeys,
        ...Object.values(c.issuedLogicalTasks)
          .filter((t) => t.stage === 'pending_execution')
          .map((t) => t.reservation.logicalTaskKey),
      ]),
    ];
    const shared = {
      ...c.sharedContext,
      contextRevision: c.sharedContext.contextRevision + 1,
      userDirections: [...c.sharedContext.userDirections, ...update.userDirections],
    };
    shared.contextHash = hash('shared-context', {
      ...shared,
      contextHash: null,
      ledger: c.questionLedger,
    });
    c.sharedContext = shared;
    c.questionLedger = { ...c.questionLedger, contextHash: shared.contextHash };
    c.pendingContextUpdate = null;
    emit('publish-context', `context-update-${update.requestId}`, shared);
  };
  // Account each newly accepted event exactly once. Closed human wait remains closed.
  const budgetEvent =
    b.kind === 'EXTEND'
      ? {
          kind: 'authorized-extension' as const,
          extensionId: b.data.extension.id,
          additionalMs: b.data.extension.additionalActiveBudgetMs,
          authorizationReceipt: b.data.extension.authorizationReceipt,
        }
      : b.kind === 'RESUME' || c.activeBudget.intervalEpoch === 0
        ? { kind: 'resume-active' as const }
        : from === 'reconciling'
          ? { kind: 'crash-reconcile' as const }
          : { kind: 'active-checkpoint' as const };
  if (b.kind === 'EXTEND') {
    const x = b.data.extension;
    requireThat(
      pauses.includes(from) &&
        !c.inferenceBlock &&
        x.baseRevision === snapshot.revision &&
        x.expiresAt > e.clockReceipt.wallMs &&
        !c.extensions.some((prior) => prior.id === x.id),
      'Invalid bounded extension',
    );
  }
  const budget = accountBudget(c.activeBudget, e.clockReceipt, budgetEvent);
  if (budget.kind === 'clock-blocker') {
    requireThat(b.kind !== 'CLOCK_CHECKPOINT', budget.code);
    c.pauseReason = budget.code;
    reconcile();
  } else {
    c.activeBudget = budget.budget;
    if (
      budget.expired &&
      ![
        'CLOCK_CHECKPOINT',
        'SETTLED',
        'EXTEND',
        'RECONCILED',
        'WORKER_OBSERVED',
        'RESOURCES_SETTLED',
      ].includes(b.kind) &&
      activeStates.includes(from)
    ) {
      pause('ACTIVE_DEADLINE');
      stop();
    } else
      switch (b.kind) {
        case 'CLOCK_CHECKPOINT':
          break;
        case 'CANCEL':
          requireThat(
            activeStates.includes(from) || from === 'reconciling' || pauses.includes(from),
            'Cannot cancel this state',
          );
          c.pendingOutcome = 'cancelled';
          c.pauseReason = 'CANCELLED';
          enter('settling');
          stop();
          break;
        case 'ERROR':
          requireThat(
            activeStates.includes(from) || from === 'reconciling',
            'Error outside active run',
          );
          if (b.data.terminalInference) c.inferenceBlock = b.data.code;
          pause(
            b.data.code,
            'blocked',
            c.resumeTarget ?? (from === 'preflight' ? 'clarifying' : from),
          );
          stop();
          break;
        case 'DEADLINE':
          requireThat(
            activeStates.includes(from) || from === 'reconciling',
            'Deadline outside active run',
          );
          pause('ACTIVE_DEADLINE');
          stop();
          break;
        case 'REQUIRE_INPUT':
          requireThat(activeStates.includes(from), 'Input pause outside active run');
          pause(
            b.data.reason,
            b.data.outcome,
            c.resumeTarget ?? (from === 'preflight' ? 'clarifying' : from),
          );
          stop();
          break;
        case 'LIFECYCLE_UNKNOWN':
          requireThat(
            activeStates.includes(from) || from === 'settling' || from === 'reconciling',
            'Unexpected lifecycle uncertainty',
          );
          reconcile();
          break;
        case 'PREFLIGHT': {
          requireThat(from === 'preflight' || activeStates.includes(from), 'Unexpected preflight');
          if (b.data.status !== 'pass') {
            c.pauseReason = b.data.code ?? 'PREFLIGHT_FAILED';
            c.pendingOutcome = b.data.status;
            c.resumeTarget ??= from === 'preflight' ? 'clarifying' : from;
            if (from === 'preflight' && b.data.resourcesSettled && allSettled(c))
              enter(b.data.status);
            else {
              enter('settling');
              stop();
            }
            break;
          }
          requireThat(b.data.attestation, 'Admission attestation required');
          c.preflightAttestation = b.data.attestation;
          if (from === 'preflight') {
            if (
              c.pendingContextUpdate &&
              !c.control.questionBatch &&
              !queuedPublication() &&
              !c.control.stagedQuestions.length
            )
              applyContext();
            preflightRoute();
          }
          break;
        }
        case 'ADMIT_ROUND':
          requireThat(from === 'prepare_round', 'ADMIT_ROUND outside prepare_round');
          requireThat(!c.pendingContextUpdate, 'PENDING_CONTEXT_UPDATE');
          if (!canRound(c)) {
            prepare();
            break;
          }
          c.roundsUsed++;
          c.pendingEvidenceIds = [];
          c.requiredEvidenceIds = [];
          c.control.candidate = null;
          c.control.evidence = [];
          c.control.evidenceHash = null;
          c.control.judge = null;
          c.control.judgeHash = null;
          c.control.confirmation = null;
          c.control.candidateRequested = false;
          c.ballots = [];
          enter('reviewing');
          launch('review');
          break;
        case 'LAUNCH_DISPATCHED': {
          const key = b.data.logicalTaskKey,
            t = c.issuedLogicalTasks[key];
          requireThat(
            t &&
              t.stage === 'pending_execution' &&
              !c.control.supersededTaskKeys.includes(key) &&
              phaseState[t.reservation.phase] === from &&
              !c.pendingContextUpdate &&
              !c.inferenceBlock &&
              c.preflightAttestation &&
              c.activeBudget.remainingMs > 0,
            'Invalid dispatch fence',
          );
          requireThat(
            t.reservation.bindings.contextHash === c.sharedContext.contextHash,
            'Superseded input',
          );
          c.issuedLogicalTasks = { ...c.issuedLogicalTasks, [key]: { ...t, stage: 'dispatched' } };
          const duration = Math.min(c.request.workerTimeoutMs, c.activeBudget.remainingMs),
            deadline = {
              wallMs: e.clockReceipt.wallMs + duration,
              monotonicMs: e.clockReceipt.monotonicMs + duration,
              processEpoch: e.clockReceipt.processEpoch,
            };
          c.control.workerDeadlines = { ...c.control.workerDeadlines, [key]: deadline };
          intents.push({
            key: `${key}/deadline`,
            kind: 'deadline',
            input: json({ logicalTaskKey: key, deadline }),
          });
          break;
        }
        case 'LAUNCH_RECEIPT_RECORDED': {
          const binding = b.data.binding,
            t = c.issuedLogicalTasks[binding.logicalTaskKey];
          requireThat(
            t &&
              t.stage === 'dispatched' &&
              Object.entries(t.reservation.bindings).every(
                ([key, value]) => binding[key as keyof AttemptBinding] === value,
              ) &&
              same(t.reservation.requested, binding.requested) &&
              same(binding.requested, binding.configured) &&
              t.reservation.role === binding.role &&
              t.reservation.phase === binding.phase &&
              taskCurrent(c, binding),
            'Launch receipt mismatch',
          );
          requireThat(
            e.phase === binding.phase &&
              (phaseState[binding.phase] === from ||
                (from === 'reconciling' && phaseState[binding.phase] === c.reconcileOriginState)),
            'Receipt phase mismatch',
          );
          requireThat(
            Object.entries(c.issuedLogicalTasks).every(
              ([key, value]) =>
                key === binding.logicalTaskKey || value.binding?.attemptId !== binding.attemptId,
            ),
            'Duplicate transport attempt',
          );
          if (binding.phase === 'judge' || binding.phase === 'ballot')
            requireThat(
              binding.candidateHash === c.control.candidate?.hash &&
                binding.evidenceHash === c.control.evidenceHash,
              'Candidate receipt mismatch',
            );
          if (binding.phase === 'ballot')
            requireThat(binding.judgeHash === c.control.judgeHash, 'Judge receipt mismatch');
          requireThat(
            same(binding.admittedMethodIds, c.profile.admittedMethodIds) &&
              same(
                binding.inputQuestionIds,
                c.questionLedger.questions.map((q) => q.id),
              ) &&
              same(
                binding.inputObjectionIds,
                c.objections.map((o) => o.id),
              ) &&
              same(
                binding.inputEvidenceIds,
                c.control.evidence.map((r) => r.requestId),
              ),
            'Frozen packet receipt mismatch',
          );
          c.issuedLogicalTasks = {
            ...c.issuedLogicalTasks,
            [binding.logicalTaskKey]: {
              ...t,
              binding,
              stage: 'receipt_recorded',
              settlement: 'live',
            },
          };
          c.expectedAttempts = { ...c.expectedAttempts, [binding.role]: binding };
          break;
        }
        case 'WORKER_RESULT': {
          const p = b.data.payload;
          validResult(p);
          const previous = c.control.phasePayloads[p.binding.role];
          requireThat(!previous || same(previous, p), 'Conflicting phase result');
          c.control.phasePayloads = { ...c.control.phasePayloads, [p.binding.role]: p };
          c.control.phaseArtifacts = {
            ...c.control.phaseArtifacts,
            [p.binding.role]: b.data.artifact,
          };
          c.control.savedResults = {
            ...c.control.savedResults,
            [p.binding.logicalTaskKey]: { payload: p, artifact: b.data.artifact },
          };
          c.phaseResults = ([...seats, 'judge'] as const).flatMap((role) =>
            c.control.phaseArtifacts[role] ? [c.control.phaseArtifacts[role]!] : [],
          );
          break;
        }
        case 'WORKER_OBSERVED':
          observe(b.data.logicalTaskKey, b.data.observation);
          if (b.data.observation.status === 'unverifiable') reconcile();
          else if (c.inferenceBlock) {
            pause(c.inferenceBlock, 'blocked', from);
            stop();
          }
          break;
        case 'RESOURCES_SETTLED': {
          for (const key of b.data.logicalTaskKeys)
            requireThat(
              c.issuedLogicalTasks[key]?.settlement === 'settled',
              'Provider exit must precede resource settlement',
            );
          c.control.settledResourceTasks = [
            ...new Set([...c.control.settledResourceTasks, ...b.data.logicalTaskKeys]),
          ];
          break;
        }
        case 'PHASE_READY': {
          if (c.pendingContextUpdate && midRound.includes(from) && allSettled(c)) {
            const payloads = seats.flatMap((role) =>
              c.control.phasePayloads[role] ? [c.control.phasePayloads[role]!] : [],
            );
            for (const item of payloads)
              if (item.kind === 'review' || item.kind === 'ballot')
                c.objections = registerObjections(
                  c.objections,
                  item.newObjections,
                  item.binding.role as (typeof seats)[number],
                );
            c.control.stagedQuestions = payloads.flatMap((item) =>
              item.kind === 'review' || item.kind === 'ballot' ? item.missingInputQuestions : [],
            );
            if (
              from === 'confirming' &&
              c.expectedAttempts.openai &&
              c.expectedAttempts.gemini &&
              c.expectedAttempts.claude
            ) {
              c.ballots = payloads.filter(
                (item): item is Extract<BoundWorkerPayload, { kind: 'ballot' }> =>
                  item.kind === 'ballot',
              );
              c.objections = applyOwnedDispositions(confirmation());
            } else if (from === 'confirming') {
              c.objections = commitPartialDispositions(c, payloads);
            }
            c.resumeTarget = c.control.stagedQuestions.length
              ? 'collecting_questions'
              : 'prepare_round';
            enter('preflight');
            break;
          }
          requireThat(
            ['clarifying', 'reviewing', 'judging', 'confirming'].includes(from),
            'No phase barrier here',
          );
          const p =
            from === 'clarifying'
              ? 'clarify'
              : from === 'reviewing'
                ? 'review'
                : from === 'judging'
                  ? 'judge'
                  : 'ballot';
          const roles: readonly WorkerRole[] = p === 'judge' ? ['judge'] : seats;
          requireThat(allSettled(c), 'Phase resources incomplete');
          if (!roles.every((role) => c.control.phasePayloads[role]?.binding.phase === p)) {
            requireThat(
              roles.every((role) =>
                Object.values(c.issuedLogicalTasks).some(
                  (task) =>
                    task.reservation.role === role &&
                    task.reservation.phase === p &&
                    task.reservation.bindings.round === (p === 'clarify' ? 0 : c.roundsUsed) &&
                    task.reservation.bindings.clarificationBatch ===
                      (p === 'clarify' ? c.clarificationBatchesUsed : null) &&
                    task.settlement === 'settled',
                ),
              ),
              'Phase results/resources incomplete',
            );
            c.inferenceBlock = 'MISSING_REQUIRED_RESULT';
            pause(c.inferenceBlock, 'blocked', from);
            break;
          }
          const payloads = roles.map((role) => c.control.phasePayloads[role]!);
          for (const item of payloads)
            if (item.kind === 'review' || item.kind === 'ballot')
              c.objections = registerObjections(
                c.objections,
                item.newObjections,
                item.binding.role as (typeof seats)[number],
              );
          if (p === 'clarify')
            c.control.currentWaveQuestionCount = payloads.reduce(
              (sum, item) => sum + (item.kind === 'clarification' ? item.questions.length : 0),
              0,
            );
          c.control.stagedQuestions = payloads.flatMap((item) =>
            item.kind === 'clarification'
              ? item.questions
              : item.kind === 'review' || item.kind === 'ballot'
                ? item.missingInputQuestions
                : [],
          );
          if (p === 'ballot') {
            c.ballots = payloads.filter(
              (item): item is Extract<BoundWorkerPayload, { kind: 'ballot' }> =>
                item.kind === 'ballot',
            );
            c.control.confirmation = confirmation();
            c.objections = applyOwnedDispositions(c.control.confirmation);
          }
          if (c.pendingContextUpdate) {
            requireThat(p !== 'clarify', 'Clarification context waits for publication');
            c.resumeTarget = c.control.stagedQuestions.length
              ? 'collecting_questions'
              : 'prepare_round';
            enter('preflight');
            break;
          }
          if (p === 'clarify' || c.control.stagedQuestions.length) {
            enter('collecting_questions');
            emit('question-batch-request', 'compile-questions', {
              questions: c.control.stagedQuestions,
              origin:
                p === 'clarify'
                  ? { kind: 'clarification', batchIndex: c.clarificationBatchesUsed }
                  : { kind: 'deliberation', round: c.roundsUsed },
            });
          } else if (p === 'review') {
            const reviews = payloads.filter(
              (item): item is Extract<BoundWorkerPayload, { kind: 'review' }> =>
                item.kind === 'review',
            );
            const requests = reviews.flatMap((r) => r.evidenceRequests);
            requireThat(
              new Set(requests.map((r) => r.id)).size === requests.length,
              'Duplicate evidence request',
            );
            c.requiredEvidenceIds = requests.map((r) => r.id);
            c.pendingEvidenceIds = [...c.requiredEvidenceIds];
            enter('prepare_candidate');
            for (const r of requests) emit('evidence', r.id, r);
            if (!requests.length) {
              c.control.candidateRequested = true;
              emit('candidate-request', 'candidate');
            }
          } else if (p === 'judge') {
            const report = payloads[0];
            requireThat(report?.kind === 'judge', 'Missing judge report');
            c.control.judge = report;
            c.control.judgeHash = c.control.phaseArtifacts.judge!.sha256;
            enter('confirming');
            launch('ballot');
          } else {
            enter('evaluate_round');
            emit('evaluate-round', 'evaluate');
          }
          break;
        }
        case 'COLLECT_QUESTIONS': {
          requireThat(
            from === 'collecting_questions' && allSettled(c),
            'Question collection boundary unavailable',
          );
          const batch = b.data.batch;
          const expectedOrigin =
            c.roundsUsed === 0
              ? { kind: 'clarification', batchIndex: c.clarificationBatchesUsed }
              : { kind: 'deliberation', round: c.roundsUsed };
          requireThat(
            batch.baseContextHash === c.sharedContext.contextHash &&
              same(batch.origin, expectedOrigin),
            'Question batch correlation mismatch',
          );
          const expected = compileExpected();
          requireThat(
            same(batch.questions, expected),
            'Question compilation must preserve every staged/promoted question',
          );
          const presented = expected.filter((q) => q.disposition === 'presented').map((q) => q.id);
          requireThat(same(batch.presentedQuestionIds, presented), 'Invalid presented questions');
          const groups = new Map(batch.groups.map((g) => [g.id, g]));
          requireThat(groups.size === batch.groups.length, 'Duplicate group');
          for (const g of batch.groups)
            requireThat(
              new Set(g.questionIds).size === g.questionIds.length &&
                g.questionIds.every((id) => presented.includes(id)),
              'Invalid group membership',
            );
          for (const a of batch.aliases)
            requireThat(groups.get(a.groupId)?.questionIds.includes(a.questionId), 'Invalid alias');
          c.control.questionBatch = batch;
          c.control.stagedQuestions = [];
          c.publicationKind = 'answer_batch';
          const sourceIds = new Set(batch.sourceAnswers.map((a) => a.questionId));
          requireThat(
            sourceIds.size === batch.sourceAnswers.length &&
              batch.sourceAnswers.every((a) => presented.includes(a.questionId)),
            'Invalid source answers',
          );
          const combined = {
            ...c.questionLedger,
            questions: mergeQuestions(c.questionLedger.questions, batch.questions),
            answers: [...c.questionLedger.answers, ...batch.sourceAnswers],
          };
          validateQuestionLedger(combined);
          if (presented.every((id) => sourceIds.has(id))) {
            c.control.pendingAnswerBatch = {
              requestId: `${batch.id}/controller-finalized`,
              batchId: batch.id,
              origin: batch.origin,
              baseContextHash: batch.baseContextHash,
              answers: batch.sourceAnswers,
              finalized: true,
            };
            enter('publishing_answers');
            emit(
              'publish-context',
              `publish-${c.control.pendingAnswerBatch.requestId}`,
              c.control.pendingAnswerBatch,
            );
          } else {
            c.resumeTarget = 'publishing_answers';
            pause('AWAITING_ANSWERS', 'needs_user', 'publishing_answers');
          }
          break;
        }
        case 'ANSWER_BATCH': {
          requireThat(
            pauses.includes(from) || from === 'preflight',
            'Answer outside settled input boundary',
          );
          requireThat(allSettled(c), 'Answers require resource settlement');
          const batch = c.control.questionBatch,
            a = b.data.batch;
          requireThat(
            batch &&
              a.batchId === batch.id &&
              a.baseContextHash === batch.baseContextHash &&
              same(a.origin, batch.origin) &&
              !c.control.pendingAnswerBatch?.finalized,
            'Answer batch mismatch/finalized',
          );
          const ids = new Set(a.answers.map((x) => x.questionId));
          requireThat(
            ids.size === a.answers.length &&
              a.answers.every((x) => batch.presentedQuestionIds.includes(x.questionId)),
            'Invalid answer identities',
          );
          for (const source of batch.sourceAnswers)
            requireThat(
              a.answers.some((x) => same(x, source)),
              'Missing source answer',
            );
          if (a.finalized)
            requireThat(
              batch.presentedQuestionIds.every((id) => ids.has(id)),
              'Incomplete finalized answer batch',
            );
          validateQuestionLedger({
            ...c.questionLedger,
            questions: mergeQuestions(c.questionLedger.questions, batch.questions),
            answers: [...c.questionLedger.answers, ...a.answers],
          });
          c.control.pendingAnswerBatch = a;
          break;
        }
        case 'ANSWER_REVISION':
          requireThat(
            from === 'needs_user' &&
              allSettled(c) &&
              !c.control.questionBatch &&
              c.pauseReason &&
              ['CLARIFICATION_LIMIT', 'ROUND_LIMIT', 'UNRESOLVED_QUESTIONS'].includes(
                c.pauseReason,
              ),
            'Revision requires settled question pause',
          );
          requireThat(b.data.revision.runId === c.request.runId, 'Revision run mismatch');
          appendAnswerRevision(c.questionLedger, b.data.revision);
          c.control.pendingAnswerRevision = b.data.revision;
          c.resumeTarget = 'prepare_round';
          break;
        case 'PUBLISH_ANSWERS': {
          requireThat(
            from === 'publishing_answers' && allSettled(c),
            'Publication boundary unavailable',
          );
          const revision = c.control.pendingAnswerRevision,
            a = c.control.pendingAnswerBatch,
            batch = c.control.questionBatch;
          const before = c.questionLedger;
          let origin: null | QuestionBatch['origin'] = null;
          let count = 0;
          if (c.publicationKind === 'answer_revision') {
            requireThat(revision, 'Missing revision');
            c.questionLedger = appendAnswerRevision(before, revision);
          } else {
            requireThat(
              a?.finalized && batch && a.batchId === batch.id,
              'Missing finalized answer batch',
            );
            origin = batch.origin;
            count = batch.questions.length;
            c.questionLedger = {
              ...before,
              questions: mergeQuestions(before.questions, batch.questions),
              answers: [...before.answers, ...a.answers],
            };
            validateQuestionLedger(c.questionLedger);
          }
          if (!same(before, c.questionLedger)) {
            const contextHash = hash('published-ledger', {
              base: c.sharedContext.contextHash,
              questions: c.questionLedger.questions,
              answers: c.questionLedger.answers,
            });
            c.sharedContext = {
              ...c.sharedContext,
              contextRevision: c.sharedContext.contextRevision + 1,
              contextHash,
            };
            c.questionLedger = { ...c.questionLedger, contextHash };
          }
          requireThat(revision || a, 'Missing publication input');
          c.control.publications = [
            ...c.control.publications,
            {
              kind: c.publicationKind!,
              origin,
              questionCount: count,
              contextHash: c.sharedContext.contextHash,
              input: revision ?? a!,
            },
          ];
          c.control.pendingAnswerRevision = null;
          c.control.pendingAnswerBatch = null;
          c.control.questionBatch = null;
          if (
            c.pendingContextUpdate &&
            c.pendingContextUpdate.baseContextHash !== c.sharedContext.contextHash
          ) {
            emit('report', `stale-context-${c.pendingContextUpdate.requestId}`, {
              code: 'STALE_CONTEXT_UPDATE',
              requestId: c.pendingContextUpdate.requestId,
              resubmit: true,
            });
            c.pendingContextUpdate = null;
          }
          const blocked = unresolvedBlockingQuestions(c.questionLedger).length > 0;
          if (
            origin?.kind === 'clarification' &&
            c.control.currentWaveQuestionCount > 0 &&
            c.clarificationBatchesUsed < c.effectiveLimits.maxClarificationBatches &&
            c.roundsUsed === 0
          ) {
            requireThat(admission(c), 'Clarification admission failed');
            c.clarificationBatchesUsed++;
            enter('clarifying');
            launch('clarify');
          } else if (blocked)
            pause(
              origin?.kind === 'clarification' ? 'CLARIFICATION_LIMIT' : 'UNRESOLVED_QUESTIONS',
            );
          else prepare();
          break;
        }
        case 'REQUEST_CANDIDATE':
          requireThat(
            from === 'prepare_candidate' &&
              !c.pendingContextUpdate &&
              !c.pendingEvidenceIds.length &&
              !c.control.candidateRequested,
            'Evidence pending or candidate already requested',
          );
          c.control.candidateRequested = true;
          emit('candidate-request', 'candidate');
          break;
        case 'EVIDENCE_REQUESTED':
          requireThat(
            from === 'prepare_candidate' &&
              !c.pendingContextUpdate &&
              !c.control.candidate &&
              !c.requiredEvidenceIds.includes(b.data.request.id),
            'Unexpected or duplicate evidence request',
          );
          c.requiredEvidenceIds = [...c.requiredEvidenceIds, b.data.request.id];
          c.pendingEvidenceIds = [...c.pendingEvidenceIds, b.data.request.id];
          emit('evidence', b.data.request.id, b.data.request);
          break;
        case 'EVIDENCE_RECORDED':
          requireThat(
            from === 'prepare_candidate' &&
              !c.pendingContextUpdate &&
              c.pendingEvidenceIds.includes(b.data.record.requestId),
            'Unexpected evidence record',
          );
          c.control.evidence = [...c.control.evidence, b.data.record].sort(
            (a, b) =>
              c.requiredEvidenceIds.indexOf(a.requestId) -
              c.requiredEvidenceIds.indexOf(b.requestId),
          );
          c.pendingEvidenceIds = c.pendingEvidenceIds.filter(
            (id) => id !== b.data.record.requestId,
          );
          break;
        case 'CANDIDATE_FROZEN':
          requireThat(
            from === 'prepare_candidate' &&
              !c.pendingContextUpdate &&
              !c.pendingEvidenceIds.length &&
              c.control.candidateRequested,
            'Candidate boundary unavailable',
          );
          requireThat(
            c.requiredEvidenceIds.every((id) =>
              c.control.evidence.some(
                (r) =>
                  r.requestId === id &&
                  (r.status === 'verified' ||
                    r.status === 'not_applicable' ||
                    b.data.candidate.acknowledgedUnverifiedEvidenceIds.includes(id)),
              ),
            ),
            'Unacknowledged evidence',
          );
          c.control.candidate = b.data.candidate;
          c.control.evidenceHash = b.data.evidenceHash;
          enter('judging');
          launch('judge');
          break;
        case 'EVALUATE_ROUND':
          requireThat(
            from === 'evaluate_round' && !c.pendingContextUpdate && c.control.confirmation,
            'Evaluation boundary unavailable',
          );
          if (evaluateConsensus(c.control.confirmation).kind === 'unanimous') {
            c.pendingOutcome = 'completed';
            c.pauseReason = null;
            enter('settling');
          } else if (c.roundsUsed >= c.effectiveLimits.maxRounds) pause('ROUND_LIMIT');
          else prepare();
          break;
        case 'CONTEXT_UPDATE':
          requireThat(activeStates.includes(from) || pauses.includes(from), 'RUN_SETTLED');
          requireThat(
            b.data.update.runId === c.request.runId &&
              b.data.update.baseContextHash === c.sharedContext.contextHash &&
              !c.pendingContextUpdate,
            'Context update mismatch',
          );
          c.pendingContextUpdate = b.data.update;
          if (from === 'evaluate_round' && allSettled(c)) {
            c.resumeTarget = 'prepare_round';
            enter('preflight');
          }
          break;
        case 'APPLY_CONTEXT_UPDATE':
          requireThat(from === 'preflight' || from === 'prepare_round', 'Invalid context boundary');
          applyContext();
          break;
        case 'EXTEND': {
          const x = b.data.extension;
          c.extensions = [...c.extensions, x];
          const l = c.effectiveLimits;
          const maxClarificationBatches =
              l.maxClarificationBatches + x.additionalClarificationBatches,
            maxRounds = l.maxRounds + x.additionalRounds,
            activeBudgetMs = l.activeBudgetMs + x.additionalActiveBudgetMs;
          c.effectiveLimits = {
            maxClarificationBatches,
            maxRounds,
            activeBudgetMs,
            maxWorkerCalls: 3 * maxClarificationBatches + 7 * maxRounds,
          };
          requireThat(
            Object.values(c.effectiveLimits).every(Number.isSafeInteger),
            'Extension overflow',
          );
          break;
        }
        case 'RESUME':
          requireThat(
            pauses.includes(from) && allSettled(c) && c.resumeTarget,
            'Resume requires a saved settled target',
          );
          requireThat(!c.inferenceBlock, 'Terminal inference block permits inspection only');
          reconcile();
          break;
        case 'RECONCILED': {
          requireThat(
            from === 'reconciling' && c.reconcileOriginState,
            'Missing reconciliation origin',
          );
          const d = b.data;
          for (const o of d.observations) {
            observe(o.logicalTaskKey, o.observation);
            if (o.savedResult) {
              requireThat(
                o.savedResult.payload.binding.logicalTaskKey === o.logicalTaskKey,
                'Saved result task mismatch',
              );
              validResult(o.savedResult.payload);
              c.control.savedResults = {
                ...c.control.savedResults,
                [o.logicalTaskKey]: o.savedResult,
              };
            }
          }
          const observed = new Set(d.observations.map((o) => o.logicalTaskKey));
          requireThat(
            observed.size === d.observations.length,
            'Duplicate reconciliation observation',
          );
          const unknown = Object.values(c.issuedLogicalTasks).some(
            (t) =>
              t.stage !== 'pending_execution' &&
              (t.settlement === 'unverifiable' ||
                (t.settlement === 'live' && !observed.has(t.reservation.logicalTaskKey)) ||
                (t.settlement === 'settled' &&
                  !c.control.settledResourceTasks.includes(t.reservation.logicalTaskKey) &&
                  !d.resourcesSettled)),
          );
          if (!d.ownership || unknown) {
            reconcile();
            break;
          }
          if (d.resourcesSettled)
            c.control.settledResourceTasks = [
              ...new Set([
                ...c.control.settledResourceTasks,
                ...Object.values(c.issuedLogicalTasks)
                  .filter((t) => t.settlement === 'settled')
                  .map((t) => t.reservation.logicalTaskKey),
              ]),
            ];
          const origin = c.reconcileOriginState;
          const failed = Object.values(c.issuedLogicalTasks).some(
            (t) =>
              t.stage !== 'pending_execution' &&
              t.settlement === 'settled' &&
              (!t.binding || !hasResult(c, t.binding)),
          );
          if (c.inferenceBlock || failed || origin === 'settling') {
            if (failed) c.inferenceBlock = 'MISSING_REQUIRED_RESULT';
            if (c.inferenceBlock) {
              c.pendingOutcome = 'blocked';
              c.pauseReason = c.inferenceBlock;
            } else c.pendingOutcome ??= 'blocked';
            enter('settling');
            stop();
            break;
          }
          if (origin === 'preflight') {
            enter('preflight');
            break;
          }
          if (pauses.includes(origin)) {
            requireThat(
              d.priorControllerExited && d.resourcesSettled && allSettled(c) && c.resumeTarget,
              'Prior owner/resource settlement required',
            );
            enter('preflight');
            break;
          }
          requireThat(activeStates.includes(origin), 'Unsupported recovery origin');
          enter(origin);
          break;
        }
        case 'SETTLED': {
          requireThat(
            from === 'settling' &&
              Object.values(c.issuedLogicalTasks).every(
                (t) => t.stage === 'pending_execution' || t.settlement === 'settled',
              ) &&
              c.pendingOutcome,
            'Settlement proof incomplete',
          );
          c.control.settledResourceTasks = Object.values(c.issuedLogicalTasks)
            .filter((t) => t.settlement === 'settled')
            .map((t) => t.reservation.logicalTaskKey);
          const outcome = c.pendingOutcome;
          requireThat(
            ['completed', 'needs_user', 'needs_context', 'blocked', 'cancelled'].includes(outcome),
            'Invalid settled outcome',
          );
          enter(outcome as ControlState);
          for (const t of Object.values(c.issuedLogicalTasks).filter(
            (t) => t.stage !== 'pending_execution',
          ))
            intents.push({
              key: `${t.reservation.effectKey}/release`,
              kind: 'release',
              input: json(t.reservation),
            });
          emit('report', `outcome-${e.id}`, { outcome, reason: c.pauseReason });
          break;
        }
      }
  }
  if (target === 'reconciling' && from !== 'reconciling') c.reconcileOriginState = from;
  if (target !== 'reconciling') c.reconcileOriginState = null;
  if (target !== from && target === c.resumeTarget) c.resumeTarget = null;
  if (pauses.includes(target) && !c.resumeTarget)
    c.resumeTarget =
      from === 'preflight' ? 'clarifying' : from === 'settling' ? 'prepare_round' : from;
  if (
    (pauses.includes(target) || target === 'completed' || target === 'cancelled') &&
    target !== from
  ) {
    const terminal = target === 'completed' || target === 'cancelled' || !!c.inferenceBlock;
    const closed = accountBudget(c.activeBudget, e.clockReceipt, {
      kind: terminal ? 'terminal-settlement' : 'settled-human-pause',
      allResourcesSettled: allSettled(c),
    });
    requireThat(closed.kind === 'ok', 'Cannot close active budget');
    c.activeBudget = closed.budget;
  }
  c.deadlines = [
    ...(c.activeBudget.deadline ? [c.activeBudget.deadline] : []),
    ...Object.entries(c.control.workerDeadlines)
      .filter(([key]) => !c.control.settledResourceTasks.includes(key))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, deadline]) => deadline),
  ];
  c.control.acceptedEvents = { ...c.control.acceptedEvents, [e.id]: digest };
  const resolved = councilMachine.resolveState({ value: from, context: snapshot.context });
  const [next] = transition(councilMachine, resolved, {
    type: e.body.kind,
    recordedEvent: e,
    target,
    context: c,
  });
  requireThat(
    next.value === target && same(next.context, c),
    'Transition outside canonical event map',
  );
  const result: RunSnapshot = {
    machineVersion: 1,
    schemaVersion: 1,
    revision: snapshot.revision + 1,
    state: target,
    context: next.context,
  };
  checked(result);
  return { snapshot: result, intents };
}
function mergeQuestions(prior: readonly Question[], incoming: readonly Question[]): Question[] {
  const result = new Map(prior.map((q) => [q.id, q]));
  for (const q of incoming) {
    const old = result.get(q.id);
    if (old) {
      const { disposition: _, ...a } = old,
        { disposition: __, ...b } = q;
      requireThat(same(a, b), 'Question content mutation');
    }
    result.set(q.id, q);
  }
  return [...result.values()];
}
function hasResult(c: RunContext, b: AttemptBinding): boolean {
  return c.control.savedResults[b.logicalTaskKey]?.payload.binding.attemptId === b.attemptId;
}

/** A superseded, unissued peer has no AttemptBinding to invent for the full barrier helper. */
function commitPartialDispositions(c: RunContext, payloads: readonly BoundWorkerPayload[]) {
  const ledger = new Map(c.objections.map((objection) => [objection.id, objection]));
  for (const ballot of payloads) {
    if (ballot.kind !== 'ballot') continue;
    requireThat(same(ballot.binding, c.expectedAttempts[ballot.seat]), 'Stale partial ballot');
    const seen = new Set<string>();
    for (const disposition of ballot.dispositions) {
      requireThat(!seen.has(disposition.objectionId), 'Duplicate objection disposition');
      seen.add(disposition.objectionId);
      requireThat(
        ballot.binding.inputObjectionIds.includes(disposition.objectionId) &&
          !ballot.newObjections.some((objection) => objection.id === disposition.objectionId) &&
          disposition.evidenceIds.every((id) => ballot.binding.inputEvidenceIds.includes(id)),
        'Disposition outside frozen partial ballot input',
      );
      const objection = ledger.get(disposition.objectionId);
      requireThat(
        objection && objection.owner === ballot.seat,
        'Only the owner can dispose objection',
      );
      const record = { ...disposition, seat: ballot.seat, attemptId: ballot.binding.attemptId };
      const previous = objection.history.find((item) => item.attemptId === record.attemptId);
      if (previous) requireThat(same(previous, record), 'Conflicting partial disposition');
      else
        ledger.set(objection.id, {
          ...objection,
          status: disposition.status,
          history: [...objection.history, record],
        });
    }
  }
  return [...ledger.values()];
}
