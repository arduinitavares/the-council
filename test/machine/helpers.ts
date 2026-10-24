import { expect } from 'vitest';
import type {
  AttemptBinding,
  ControlEventBody,
  Question,
  QuestionBatch,
  RawQuestion,
  RunRequest,
  RunSnapshot,
  ValidatedEvent,
  WorkerPayload,
  WorkerPhase,
  WorkerRole,
} from '../../src/domain/contracts.js';
import { H, config, makeConfirmation, clock } from '../fixtures/builders.js';
import { bindWorkerPayload } from '../../src/domain/schemas.js';
import { latestAnswers } from '../../src/domain/questions.js';
import { createInitialSnapshot, reduceRun } from '../../src/machine/reduce.js';
export function request(): RunRequest {
  const a = { kind: 'input', sha256: H, path: '/tmp/input', bytes: 1 };
  return {
    runId: 'run1',
    workspace: '/tmp',
    topic: 'Topic',
    handoffPath: '/tmp/input',
    handoffHash: H,
    config: {
      sourcePath: '/tmp/config',
      rawSha256: H,
      rawArtifact: a,
      configArtifact: a,
      configHash: H,
      resolved: structuredClone(config),
    },
    profile: {
      manifest: a,
      profileHash: H,
      admittedMethodIds: ['test-method'],
      sources: [],
      adaptations: [],
    },
    sharedContext: {
      contextRevision: 0,
      contextHash: H,
      topic: a,
      handoff: a,
      questionLedgerRefs: [],
      answerLedgerRefs: [],
      userDirections: [],
    },
    scope: { sourceRoots: ['/tmp'], allowedSourceAddresses: [], checks: [] },
    maxClarificationBatches: 2,
    maxRounds: 3,
    workerTimeoutMs: 1800000,
    activeBudgetMs: 10800000,
  };
}
export const artifact = { kind: 'receipt', sha256: H, path: '/tmp/receipt', bytes: 1 };
const adapterKinds = [
  'LAUNCH_RECEIPT_RECORDED',
  'WORKER_RESULT',
  'WORKER_OBSERVED',
  'RECONCILED',
  'SETTLED',
  'RESOURCES_SETTLED',
  'EVIDENCE_RECORDED',
];
export class Flow {
  s: RunSnapshot;
  tick = 0;
  events: ValidatedEvent[] = [];
  results: ReturnType<typeof reduceRun>[] = [];
  constructor(r = request()) {
    this.s = createInitialSnapshot(r);
  }
  send(kind: ControlEventBody['kind'], data: unknown = {}, phase: WorkerPhase | null = null) {
    const e = {
      id: `event${++this.tick}`,
      runId: 'run1',
      schemaVersion: 1,
      actor: {
        kind: adapterKinds.includes(kind) ? 'adapter' : 'controller',
        receiptId: 'trusted-adapter',
      },
      round: this.s.context.roundsUsed,
      phase,
      clockReceipt: clock(10000 + this.tick, 100 + this.tick),
      body: { kind, data },
    } as ValidatedEvent;
    const result = reduceRun(this.s, e);
    this.events.push(e);
    this.results.push(result);
    this.s = result.snapshot;
    return result;
  }
  pass() {
    return this.send('PREFLIGHT', {
      status: 'pass',
      attestation: artifact,
      code: null,
      resourcesSettled: true,
    });
  }
  settle() {
    return this.send('SETTLED', { receipt: artifact });
  }
  resume() {
    this.send('RESUME');
    this.send('RECONCILED', {
      ownership: true,
      priorControllerExited: true,
      resourcesSettled: true,
      receipt: artifact,
      observations: [],
    });
    return this.pass();
  }
  launch(p: WorkerPhase, role: WorkerRole): AttemptBinding {
    const task = Object.values(this.s.context.issuedLogicalTasks).find(
      (t) =>
        t.reservation.phase === p &&
        t.reservation.role === role &&
        t.reservation.bindings.round === (p === 'clarify' ? 0 : this.s.context.roundsUsed) &&
        t.reservation.bindings.clarificationBatch ===
          (p === 'clarify' ? this.s.context.clarificationBatchesUsed : null),
    )!;
    const r = task.reservation;
    const binding: AttemptBinding = {
      ...r.bindings,
      attemptId: `transport-${r.clientAttemptKey}`,
      role,
      phase: p,
      requested: r.requested,
      configured: r.requested,
      authority: {
        kind: 'supervised',
        runId: 'run1',
        taskId: `task-${r.logicalTaskKey}`,
        dispatchId: `dispatch-${r.logicalTaskKey}`,
        receiptId: 'receipt',
      },
      admittedMethodIds: ['test-method'],
      inputQuestionIds: this.s.context.questionLedger.questions.map((q) => q.id),
      inputObjectionIds: this.s.context.objections.map((o) => o.id),
      inputEvidenceIds: this.s.context.control.evidence.map((e) => e.requestId),
      ...(p === 'judge' || p === 'ballot'
        ? {
            candidateHash: this.s.context.control.candidate!.hash,
            evidenceHash: this.s.context.control.evidenceHash!,
          }
        : {}),
      ...(p === 'ballot' ? { judgeHash: this.s.context.control.judgeHash! } : {}),
    };
    this.send('LAUNCH_DISPATCHED', { logicalTaskKey: r.logicalTaskKey });
    this.send('LAUNCH_RECEIPT_RECORDED', { binding }, p);
    return binding;
  }
  finish(
    p: WorkerPhase,
    raw: (role: WorkerRole) => WorkerPayload,
    order: readonly WorkerRole[] = p === 'judge' ? ['judge'] : ['openai', 'gemini', 'claude'],
    barrier = true,
    settleResources = true,
  ) {
    for (const role of order) {
      const binding = this.launch(p, role);
      const payload = bindWorkerPayload(raw(role), binding);
      const roleIndex = ['openai', 'gemini', 'claude', 'judge'].indexOf(role);
      const resultArtifact = {
        ...artifact,
        path: `/tmp/${p}/${role}/result`,
        sha256: role === 'judge' ? H : String(roleIndex + 1).repeat(64),
      };
      const lifecycleReceipt = {
        ...artifact,
        path: `/tmp/${p}/${role}/lifecycle`,
        sha256: String(roleIndex + 4).repeat(64),
      };
      this.send('WORKER_RESULT', { payload, artifact: resultArtifact }, p);
      this.send(
        'WORKER_OBSERVED',
        {
          logicalTaskKey: binding.logicalTaskKey,
          observation: {
            status: 'exited',
            rawReceipts: [lifecycleReceipt],
            exitCode: 0,
          },
        },
        p,
      );
      if (settleResources)
        this.send('RESOURCES_SETTLED', {
          logicalTaskKeys: [binding.logicalTaskKey],
          receipt: lifecycleReceipt,
        });
    }
    if (barrier) return this.send('PHASE_READY');
    return this.results.at(-1)!;
  }
  clarify(questions: readonly RawQuestion[] = []) {
    return this.finish('clarify', (role) => ({
      kind: 'clarification',
      ready: role !== 'openai' || questions.length === 0,
      questions: role === 'openai' ? questions : [],
      methodIds: ['test-method'],
    }));
  }
  batch(sourceStatus: 'answered' | 'unknown' | 'declined' | null = null): QuestionBatch {
    const c = this.s.context,
      answers = latestAnswers(c.questionLedger);
    const promoted = c.questionLedger.questions
      .filter(
        (q) =>
          q.disposition === 'deferred' &&
          !answers.has(q.id) &&
          q.dependencyIds.every((id) => answers.get(id)?.status === 'answered'),
      )
      .map((q) => ({ ...q, disposition: 'presented' as const }));
    const qs: Question[] = [
      ...promoted,
      ...c.control.stagedQuestions.map((q) => ({
        ...q,
        disposition: q.dependencyIds.every((id) => answers.get(id)?.status === 'answered')
          ? ('presented' as const)
          : ('deferred' as const),
      })),
    ];
    const presented = qs.filter((q) => q.disposition === 'presented');
    return {
      id: `batch-${c.control.publications.length + 1}`,
      origin:
        c.roundsUsed === 0
          ? { kind: 'clarification', batchIndex: c.clarificationBatchesUsed }
          : { kind: 'deliberation', round: c.roundsUsed },
      baseContextHash: c.sharedContext.contextHash,
      questions: qs,
      groups: [],
      aliases: [],
      presentedQuestionIds: presented.map((q) => q.id),
      sourceAnswers: sourceStatus
        ? presented.map((q) => ({
            id: `answer-${q.id}`,
            questionId: q.id,
            status: sourceStatus,
            value: sourceStatus === 'answered' ? 'fact' : null,
            source: { author: 'source', receiptId: 'source-receipt' },
            evidenceIds: [],
          }))
        : [],
    };
  }
  collect(status: 'answered' | 'unknown' | 'declined' | null = null) {
    return this.send('COLLECT_QUESTIONS', { batch: this.batch(status) });
  }
  publish() {
    return this.send('PUBLISH_ANSWERS');
  }
  ready() {
    this.pass();
    this.clarify();
    this.collect();
    this.publish();
    expect(this.s.state).toBe('prepare_round');
  }
  reviews(
    questions: readonly RawQuestion[] = [],
    order: readonly WorkerRole[] = ['openai', 'gemini', 'claude'],
    barrier = true,
  ) {
    return this.finish(
      'review',
      (role) => ({
        kind: 'review',
        proposals: ['proposal'],
        newObjections: [],
        evidenceRequests: [],
        missingInputQuestions: role === 'openai' ? questions : [],
        methodIds: ['test-method'],
      }),
      order,
      barrier,
    );
  }
  candidate() {
    if (!this.s.context.control.candidateRequested) this.send('REQUEST_CANDIDATE');
    return this.send('CANDIDATE_FROZEN', {
      candidate: makeConfirmation().candidate,
      evidenceHash: H,
    });
  }
  judge(barrier = true) {
    const c = this.s.context;
    return this.finish(
      'judge',
      () => ({
        kind: 'judge',
        bindings: {
          runId: 'run1',
          configHash: c.config.configHash,
          profileHash: c.profile.profileHash,
          contextHash: c.sharedContext.contextHash,
          round: c.roundsUsed,
          candidateHash: c.control.candidate!.hash,
          evidenceHash: H,
        },
        assessments: [],
        challenges: [],
        methodIds: ['test-method'],
      }),
      undefined,
      barrier,
    );
  }
  ballots(reject = false, questions: readonly RawQuestion[] = [], barrier = true) {
    const c = this.s.context;
    return this.finish(
      'ballot',
      (role) => ({
        kind: 'ballot',
        bindings: {
          runId: 'run1',
          configHash: c.config.configHash,
          profileHash: c.profile.profileHash,
          contextHash: c.sharedContext.contextHash,
          round: c.roundsUsed,
          candidateHash: c.control.candidate!.hash,
          evidenceHash: H,
          judgeHash: H,
        },
        decision: reject && role === 'claude' ? 'reject' : 'accept',
        conditional: false,
        newObjections: [],
        missingInputQuestions: role === 'openai' ? questions : [],
        dispositions: [],
        challengeResponses: [],
        reason: 'Accept the shared candidate.',
        methodIds: ['test-method'],
      }),
      undefined,
      barrier,
    );
  }
  round(reject = false) {
    this.send('ADMIT_ROUND');
    this.reviews();
    this.candidate();
    this.judge();
    this.ballots(reject);
    return this.send('EVALUATE_ROUND');
  }
}
