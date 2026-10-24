import { describe, expect, it } from 'vitest';
import { bindWorkerPayload } from '../../src/domain/schemas.js';
import type { ControlState, ReviewerSeat, ValidatedEvent } from '../../src/domain/contracts.js';
import { H, clock, rawQuestion } from '../fixtures/builders.js';
import {
  createInitialSnapshot,
  reduceRun,
  restoreForReconciliation,
} from '../../src/machine/reduce.js';
import { Flow, request, artifact } from './helpers.js';
describe('deterministic replay and recovery', () => {
  it('replays snapshots, intents, budgets, deadlines and reservations identically', () => {
    const original = new Flow();
    original.ready();
    original.round();
    original.settle();
    for (let pass = 0; pass < 2; pass++) {
      let s = createInitialSnapshot(request());
      const results = [];
      for (const event of original.events) {
        const r = reduceRun(s, event);
        results.push(r);
        s = r.snapshot;
      }
      expect(results).toEqual(original.results);
      expect(s.context.activeBudget).toEqual(original.s.context.activeBudget);
      expect(s.context.issuedLogicalTasks).toEqual(original.s.context.issuedLogicalTasks);
    }
  });
  it('all six reviewer arrival orders produce the same complete review barrier', () => {
    const orders: ReviewerSeat[][] = [
      ['openai', 'gemini', 'claude'],
      ['openai', 'claude', 'gemini'],
      ['gemini', 'openai', 'claude'],
      ['gemini', 'claude', 'openai'],
      ['claude', 'openai', 'gemini'],
      ['claude', 'gemini', 'openai'],
    ];
    const outputs = orders.map((order) => {
      const f = new Flow();
      f.ready();
      f.send('ADMIT_ROUND');
      f.reviews([], order);
      expect(f.s.context.phaseResults.map((result) => result.path)).toEqual([
        '/tmp/review/openai/result',
        '/tmp/review/gemini/result',
        '/tmp/review/claude/result',
      ]);
      expect(new Set(f.s.context.phaseResults.map((result) => result.sha256)).size).toBe(3);
      const receiptPaths = f.events.flatMap((event) =>
        event.phase === 'review' && event.body.kind === 'WORKER_OBSERVED'
          ? event.body.data.observation.rawReceipts.map((receipt) => receipt.path)
          : [],
      );
      expect(new Set(receiptPaths).size).toBe(3);
      return {
        state: f.s.state,
        results: f.s.context.phaseResults,
        payloads: f.s.context.control.phasePayloads,
        objections: f.s.context.objections,
        intents: f.results.at(-1)?.intents,
      };
    });
    for (const o of outputs) expect(o).toEqual(outputs[0]);
  });
  it('qualified fake Sol/Sonnet selections preserve seats, limits and outcomes', () => {
    const outputs = ['gpt-6.1-sol', 'claude-sonnet-5-5-high'].map((model) => {
      const r = request();
      r.config.resolved.reviewers.openai.model =
        model === 'gpt-6.1-sol' ? model : 'qualified-openai';
      r.config.resolved.reviewers.claude.model =
        model === 'gpt-6.1-sol' ? 'qualified-claude' : model;
      const f = new Flow(r);
      f.ready();
      f.round();
      return {
        seats: f.s.context.ballots.map((b) => b.seat),
        objections: f.s.context.objections,
        limits: f.s.context.effectiveLimits,
        outcome: f.s.context.pendingOutcome,
      };
    });
    expect(outputs[0]).toEqual(outputs[1]);
  });
  it('initial missing-handoff pause saves clarifying and resumes through preflight', () => {
    const f = new Flow();
    f.send('PREFLIGHT', {
      status: 'needs_context',
      attestation: null,
      code: 'MISSING_HANDOFF',
      resourcesSettled: true,
    });
    expect(f.s.state).toBe('needs_context');
    expect(f.s.context.resumeTarget).toBe('clarifying');
    const remaining = f.s.context.activeBudget.remainingMs;
    f.resume();
    expect(f.s.state).toBe('clarifying');
    expect(f.s.context.resumeTarget).toBeNull();
    expect(f.s.context.activeBudget.remainingMs).toBeLessThanOrEqual(remaining);
  });
  it('restore preserves original phase and never emits a launch', () => {
    const f = new Flow();
    f.ready();
    f.send('ADMIT_ROUND');
    f.s = restoreForReconciliation(f.s);
    f.s = restoreForReconciliation(f.s);
    expect(f.s.context.reconcileOriginState).toBe('reviewing');
    const r = f.send('RECONCILED', {
      ownership: true,
      priorControllerExited: false,
      resourcesSettled: false,
      receipt: artifact,
      observations: [],
    });
    expect(r.snapshot.state).toBe('reviewing');
    expect(r.intents.filter((i) => i.kind === 'launch')).toHaveLength(0);
    expect(r.snapshot.context.reconcileOriginState).toBeNull();
  });
  it('mid-round third-round context remedy preserves target across preflight without fourth-round admission', () => {
    const f = new Flow();
    f.ready();
    f.round(true);
    f.round(true);
    f.send('ADMIT_ROUND');
    f.reviews();
    const calls = f.s.context.callsReserved;
    f.send('REQUIRE_INPUT', { reason: 'MISSING_HANDOFF', outcome: 'needs_context' });
    f.settle();
    expect(f.s.context.resumeTarget).toBe('prepare_candidate');
    f.resume();
    expect(f.s.state).toBe('prepare_candidate');
    expect(f.s.context.roundsUsed).toBe(3);
    expect(f.s.context.callsReserved).toBe(calls);
  });
  it('unknown dispatch preserves its reservation and cannot settle or relaunch', () => {
    const f = new Flow();
    f.pass();
    const key = Object.keys(f.s.context.issuedLogicalTasks)[0]!;
    f.send('LAUNCH_DISPATCHED', { logicalTaskKey: key });
    const reserved = f.s.context.callsReserved;
    f.send('LIFECYCLE_UNKNOWN');
    const r = f.send('RECONCILED', {
      ownership: true,
      priorControllerExited: false,
      resourcesSettled: false,
      receipt: artifact,
      observations: [
        {
          logicalTaskKey: key,
          observation: { status: 'unverifiable', rawReceipts: [], exitCode: null },
        },
      ],
    });
    expect(f.s.state).toBe('reconciling');
    expect(f.s.context.reconcileOriginState).toBe('clarifying');
    expect(f.s.context.callsReserved).toBe(reserved);
    expect(r.intents.every((i) => i.kind !== 'launch')).toBe(true);
    f.send('CANCEL');
    expect(f.s.state).toBe('settling');
    const unsettled = structuredClone(f.s);
    expect(() => f.settle()).toThrow('Settlement proof incomplete');
    expect(f.s).toEqual(unsettled);
    expect(f.s.context.callsReserved).toBe(reserved);
  });
  it('duplicate events apply budget and effects once; conflicting duplicates fail', () => {
    const f = new Flow();
    f.pass();
    const e = f.events[0]!,
      r = reduceRun(f.s, e);
    expect(r.snapshot).toEqual(f.s);
    expect(r.intents).toEqual([]);
    expect(() => reduceRun(f.s, { ...e, actor: { ...e.actor, receiptId: 'conflict' } })).toThrow();
  });
});

it('CLOCK_CHECKPOINT starts the recorded interval before external preflight work', () => {
  const f = new Flow();
  const start = f.send('CLOCK_CHECKPOINT');
  expect(start.snapshot.state).toBe('preflight');
  expect(start.intents).toEqual([]);
  const before = f.s.context.activeBudget.remainingMs;
  f.pass();
  expect(f.s.context.activeBudget.remainingMs).toBe(before - 1);
});
it('CLOCK_CHECKPOINT leaves a closed human wait paused and uncharged', () => {
  const f = new Flow();
  f.send('PREFLIGHT', {
    status: 'needs_context',
    attestation: null,
    code: 'MISSING_HANDOFF',
    resourcesSettled: true,
  });
  const budget = structuredClone(f.s.context.activeBudget);
  f.tick += 100000;
  const r = f.send('CLOCK_CHECKPOINT');
  expect(r.intents).toEqual([]);
  expect(f.s.context.activeBudget).toEqual(budget);
});
it('active context update at a candidate boundary returns to preflight before judge launch', () => {
  const f = new Flow();
  f.ready();
  f.send('ADMIT_ROUND');
  f.reviews();
  f.send('CONTEXT_UPDATE', {
    update: {
      requestId: 'update-candidate',
      runId: 'run1',
      baseContextHash: f.s.context.sharedContext.contextHash,
      userDirections: [artifact],
    },
  });
  f.send('PHASE_READY');
  expect(f.s.state).toBe('preflight');
  f.pass();
  expect(f.s.state).toBe('prepare_round');
  expect(f.s.context.roundsUsed).toBe(1);
  expect(f.s.context.control.candidate).toBeNull();
});
it('a settled judge phase applies a context remedy through preflight before any ballot launch', () => {
  const f = new Flow();
  f.ready();
  f.send('ADMIT_ROUND');
  f.reviews();
  f.candidate();
  f.judge(false);
  expect(f.s.state).toBe('judging');
  const calls = f.s.context.callsReserved;
  f.send('CONTEXT_UPDATE', {
    update: {
      requestId: 'judge-remedy',
      runId: 'run1',
      baseContextHash: f.s.context.sharedContext.contextHash,
      userDirections: [artifact],
    },
  });
  const result = f.send('PHASE_READY');
  expect(f.s.state).toBe('preflight');
  expect(f.s.context.resumeTarget).toBe('prepare_round');
  expect(result.intents.some((i) => i.kind === 'launch')).toBe(false);
  f.pass();
  expect(f.s.state).toBe('prepare_round');
  expect(f.s.context.callsReserved).toBe(calls);
  expect(f.s.context.roundsUsed).toBe(1);
  expect(
    Object.values(f.s.context.issuedLogicalTasks).some((t) => t.reservation.phase === 'ballot'),
  ).toBe(false);
});
for (const phase of ['review', 'ballot'] as const)
  it(`publishes a queued context update before staged ${phase} questions and requests collection`, () => {
    const f = new Flow();
    f.ready();
    f.send('ADMIT_ROUND');
    if (phase === 'ballot') {
      f.reviews();
      f.candidate();
      f.judge();
    }
    const before = f.s.context.sharedContext;
    if (phase === 'review') f.reviews([rawQuestion()], undefined, false);
    else f.ballots(false, [rawQuestion()], false);
    f.send('CONTEXT_UPDATE', {
      update: {
        requestId: `update-with-${phase}-questions`,
        runId: 'run1',
        baseContextHash: before.contextHash,
        userDirections: [artifact],
      },
    });
    f.send('PHASE_READY');
    expect(f.s.state).toBe('preflight');
    const staged = f.s.context.control.stagedQuestions;
    const calls = f.s.context.callsReserved;
    const routed = f.pass();
    expect(f.s.state).toBe('collecting_questions');
    expect.soft(f.s.context.pendingContextUpdate).toBeNull();
    expect.soft(f.s.context.sharedContext.contextRevision).toBe(before.contextRevision + 1);
    expect.soft(f.s.context.sharedContext.userDirections).toEqual([artifact]);
    expect.soft(routed.intents.filter((i) => i.kind === 'publish-context')).toHaveLength(1);
    expect(
      routed.intents.filter((i) => i.kind === 'question-batch-request').map((i) => i.input),
    ).toEqual([{ questions: staged, origin: { kind: 'deliberation', round: 1 } }]);
    const publishedHash = f.s.context.sharedContext.contextHash;
    expect(f.batch().baseContextHash).toBe(publishedHash);
    f.collect('answered');
    f.publish();
    expect(f.s.state).toBe('prepare_round');
    expect(f.s.context.sharedContext.userDirections).toEqual([artifact]);
    expect(f.s.context.roundsUsed).toBe(1);
    expect(f.s.context.callsReserved).toBe(calls);
  });
it('restores a settled pause with valid saved results and charges the resumed active interval', () => {
  const f = new Flow();
  f.ready();
  f.send('ADMIT_ROUND');
  f.reviews();
  f.send('REQUIRE_INPUT', { reason: 'MISSING_HANDOFF', outcome: 'needs_context' });
  f.settle();
  const paused = f.s.context.activeBudget;
  const calls = f.s.context.callsReserved;
  const savedResults = f.s.context.control.savedResults;
  f.tick += 1000; // A closed human wait must not be charged on restoration.
  f.s = restoreForReconciliation(f.s);
  const reconciled = f.send('RECONCILED', {
    ownership: true,
    priorControllerExited: true,
    resourcesSettled: true,
    receipt: artifact,
    observations: [],
  });
  expect(f.s.state).toBe('preflight');
  expect(f.s.context.activeBudget.status).toBe('active');
  expect(f.s.context.activeBudget.remainingMs).toBe(paused.remainingMs);
  expect(f.s.context.activeBudget.intervalEpoch).toBe(paused.intervalEpoch + 1);
  expect(f.s.context.control.savedResults).toEqual(savedResults);
  expect(reconciled.intents.some((i) => i.kind === 'launch')).toBe(false);
  f.pass();
  expect(f.s.state).toBe('prepare_candidate');
  expect(f.s.context.activeBudget.remainingMs).toBe(paused.remainingMs - 1);
  expect(f.s.context.callsReserved).toBe(calls);
});
it('synthetic corrupted history with a missing actual result remains terminally blocked on restore', () => {
  const f = new Flow();
  f.ready();
  f.send('ADMIT_ROUND');
  f.reviews();
  const key = Object.keys(f.s.context.control.savedResults)[0]!;
  expect(f.s.context.issuedLogicalTasks[key]?.stage).toBe('receipt_recorded');
  const recordedHistory = structuredClone(f.results);
  f.s = structuredClone(f.s); // Deliberately corrupted persisted negative fixture.
  const { [key]: _missing, ...remainingResults } = f.s.context.control.savedResults;
  f.s.context.control.savedResults = remainingResults;
  f.send('REQUIRE_INPUT', { reason: 'MISSING_HANDOFF', outcome: 'needs_context' });
  f.settle();
  f.s = restoreForReconciliation(f.s);
  const result = f.send('RECONCILED', {
    ownership: true,
    priorControllerExited: true,
    resourcesSettled: true,
    receipt: artifact,
    observations: [],
  });
  expect(f.s.state).toBe('settling');
  expect(f.s.context.inferenceBlock).toBe('MISSING_REQUIRED_RESULT');
  expect(result.intents.some((i) => i.kind === 'launch')).toBe(false);
  f.settle();
  expect(f.s.state).toBe('blocked');
  expect(() => f.send('RESUME')).toThrow(/Terminal inference block/);
  expect(() =>
    f.send('EXTEND', {
      extension: {
        id: 'cannot-repair',
        baseRevision: f.s.revision,
        authorizationReceipt: 'user-auth',
        expiresAt: 100000,
        additionalClarificationBatches: 0,
        additionalRounds: 1,
        additionalActiveBudgetMs: 1000,
      },
    }),
  ).toThrow(/Invalid bounded extension/);
  expect(f.results.slice(0, recordedHistory.length)).toEqual(recordedHistory);
});
it('context update can invalidate unissued review slots without extra inference', () => {
  const f = new Flow();
  f.ready();
  f.send('ADMIT_ROUND');
  const before = f.s.context.callsReserved;
  f.send('CONTEXT_UPDATE', {
    update: {
      requestId: 'update-unissued',
      runId: 'run1',
      baseContextHash: f.s.context.sharedContext.contextHash,
      userDirections: [artifact],
    },
  });
  f.send('PHASE_READY');
  expect(f.s.state).toBe('preflight');
  f.pass();
  expect(f.s.state).toBe('prepare_round');
  expect(f.s.context.callsReserved).toBe(before);
  f.s = restoreForReconciliation(f.s);
  const reconciled = f.send('RECONCILED', {
    ownership: true,
    priorControllerExited: true,
    resourcesSettled: true,
    receipt: artifact,
    observations: [],
  });
  expect(f.s.state).toBe('prepare_round');
  expect(f.s.context.inferenceBlock).toBeNull();
  expect(f.s.context.callsReserved).toBe(before);
  expect(reconciled.intents.some((i) => i.kind === 'launch')).toBe(false);
});
it('saved valid exited results return to their phase before ingestion', () => {
  const f = new Flow();
  f.pass();
  const binding = f.launch('clarify', 'openai');
  const key = binding.logicalTaskKey;
  const saved = {
    payload: bindWorkerPayload(
      {
        kind: 'clarification',
        ready: true,
        questions: [],
        methodIds: ['test-method'],
      },
      binding,
    ),
    artifact,
  };
  expect(f.s.context.control.savedResults[key]).toBeUndefined();
  f.s = restoreForReconciliation(f.s);
  const r = f.send('RECONCILED', {
    ownership: true,
    priorControllerExited: false,
    resourcesSettled: true,
    receipt: artifact,
    observations: [
      {
        logicalTaskKey: key,
        observation: { status: 'exited', rawReceipts: [artifact], exitCode: 0 },
        savedResult: saved,
      },
    ],
  });
  expect(r.snapshot.state).toBe('clarifying');
  expect(r.intents.some((i) => i.kind === 'launch')).toBe(false);
  expect(f.s.context.control.phasePayloads.openai).toBeUndefined();
  expect(f.s.context.control.savedResults[key]).toEqual(saved);
  f.send('WORKER_RESULT', saved, 'clarify');
  expect(f.s.context.control.phasePayloads.openai).toEqual(saved.payload);
});
it('a dispatched attempt failing on its first observation terminally blocks inference', () => {
  const f = new Flow();
  f.pass();
  const key = f.launch('clarify', 'openai').logicalTaskKey;
  f.send(
    'WORKER_OBSERVED',
    {
      logicalTaskKey: key,
      observation: { status: 'exited', rawReceipts: [artifact], exitCode: 2 },
    },
    'clarify',
  );
  expect(f.s.state).toBe('settling');
  f.settle();
  expect(f.s.state).toBe('blocked');
  expect(f.s.context.activeBudget.status).toBe('settled');
  expect(() => f.send('RESUME')).toThrow();
});
for (const reason of ['failed', 'invalid', 'timed-out', 'cancelled'] as const)
  it(`reconciling routes ${reason} work to settling without replacement inference`, () => {
    const f = new Flow();
    f.pass();
    const key = f.launch('clarify', 'openai').logicalTaskKey;
    const calls = f.s.context.callsReserved;
    f.send('LIFECYCLE_UNKNOWN');
    expect(f.s.state).toBe('reconciling');
    expect(f.s.context.reconcileOriginState).toBe('clarifying');
    let result;
    if (reason === 'failed') {
      result = f.send('RECONCILED', {
        ownership: true,
        priorControllerExited: false,
        resourcesSettled: true,
        receipt: artifact,
        observations: [
          {
            logicalTaskKey: key,
            observation: {
              status: 'exited',
              rawReceipts: [artifact],
              exitCode: 2,
            },
          },
        ],
      });
      expect(f.s.context.inferenceBlock).toBe('MISSING_REQUIRED_RESULT');
    } else if (reason === 'invalid') {
      result = f.send('ERROR', {
        code: 'INVALID_WORKER_RESULT',
        terminalInference: true,
      });
      expect(f.s.context.inferenceBlock).toBe('INVALID_WORKER_RESULT');
    } else {
      result = f.send(reason === 'timed-out' ? 'DEADLINE' : 'CANCEL');
      expect(f.s.context.pauseReason).toBe(
        reason === 'timed-out' ? 'ACTIVE_DEADLINE' : 'CANCELLED',
      );
    }
    expect(f.s.state).toBe('settling');
    expect(f.s.context.pendingOutcome).toBe(
      reason === 'cancelled' ? 'cancelled' : reason === 'timed-out' ? 'needs_user' : 'blocked',
    );
    expect(f.s.context.callsReserved).toBe(calls);
    expect(result.intents.some((i) => i.kind === 'launch' || i.kind === 'release')).toBe(false);
    if (reason !== 'failed') expect(() => f.settle()).toThrow('Settlement proof incomplete');
  });
it('an active-budget-only extension cannot bypass an open nonblocking batch', () => {
  const f = new Flow();
  f.ready();
  f.send('ADMIT_ROUND');
  f.reviews([rawQuestion({ blocking: false })]);
  f.collect();
  f.settle();
  f.send('EXTEND', {
    extension: {
      id: 'work-time',
      baseRevision: f.s.revision,
      authorizationReceipt: 'auth',
      expiresAt: 100000,
      additionalClarificationBatches: 0,
      additionalRounds: 0,
      additionalActiveBudgetMs: 1000,
    },
  });
  const before = f.s.context.callsReserved;
  f.resume();
  expect(f.s.state).toBe('settling');
  expect(f.s.context.pauseReason).toBe('AWAITING_ANSWERS');
  expect(f.s.context.resumeTarget).toBe('publishing_answers');
  expect(f.s.context.callsReserved).toBe(before);
  expect(f.s.context.effectiveLimits.maxRounds).toBe(3);
});
for (const finalized of [true, false])
  it(`synthetic overlapping preflight inputs prioritize ${finalized ? 'publication over staged collection' : 'staged collection over an open unfinalized batch'}`, () => {
    const f = new Flow();
    f.ready();
    f.send('ADMIT_ROUND');
    f.reviews([rawQuestion({ blocking: false })]);
    const staged = structuredClone(f.s.context.control.stagedQuestions);
    f.collect();
    f.settle();
    const batch = f.s.context.control.questionBatch!;
    if (finalized)
      f.send('ANSWER_BATCH', {
        batch: {
          requestId: 'priority-answer',
          batchId: batch.id,
          origin: batch.origin,
          baseContextHash: batch.baseContextHash,
          answers: batch.presentedQuestionIds.map((id) => ({
            id: `priority-${id}`,
            questionId: id,
            status: 'answered',
            value: 'fact',
            source: { author: 'user', receiptId: 'receipt' },
            evidenceIds: [],
          })),
          finalized: true,
        },
      });
    const recordedHistory = structuredClone(f.results);
    // Normal collection clears staged questions. Deliberately overlap these
    // independently valid inputs on a clone to exercise competing route guards.
    f.s = structuredClone(f.s);
    f.s.context.control.stagedQuestions = staged;
    expect(staged).toHaveLength(1);
    expect(f.s.context.control.questionBatch).toEqual(batch);
    expect(f.s.context.control.pendingAnswerBatch?.finalized ?? false).toBe(finalized);
    const calls = f.s.context.callsReserved;
    const result = f.resume();
    expect(f.s.state).toBe(finalized ? 'publishing_answers' : 'collecting_questions');
    expect(result.intents.filter((i) => i.kind === 'publish-context')).toHaveLength(
      finalized ? 1 : 0,
    );
    expect(result.intents.filter((i) => i.kind === 'question-batch-request')).toHaveLength(
      finalized ? 0 : 1,
    );
    expect(result.intents.some((i) => i.kind === 'launch')).toBe(false);
    expect(f.s.context.callsReserved).toBe(calls);
    expect(f.results.slice(0, recordedHistory.length)).toEqual(recordedHistory);
  });
it('restored live work requires a fresh positive observation before phase return', () => {
  const f = new Flow();
  f.pass();
  const key = f.launch('clarify', 'openai').logicalTaskKey;
  f.send(
    'WORKER_OBSERVED',
    {
      logicalTaskKey: key,
      observation: { status: 'live', rawReceipts: [artifact], exitCode: null },
    },
    'clarify',
  );
  f.s = restoreForReconciliation(f.s);
  const r = f.send('RECONCILED', {
    ownership: true,
    priorControllerExited: false,
    resourcesSettled: false,
    receipt: artifact,
    observations: [],
  });
  expect(r.snapshot.state).toBe('reconciling');
  const connected = f.send('RECONCILED', {
    ownership: true,
    priorControllerExited: false,
    resourcesSettled: false,
    receipt: artifact,
    observations: [
      {
        logicalTaskKey: key,
        observation: { status: 'live', rawReceipts: [artifact], exitCode: null },
      },
    ],
  });
  expect(connected.snapshot.state).toBe('clarifying');
  expect(connected.intents.some((i) => i.kind === 'launch')).toBe(false);
});
it('resource settlement is separate from provider exit', () => {
  const f = new Flow();
  f.pass();
  f.finish(
    'clarify',
    () => ({
      kind: 'clarification',
      ready: true,
      questions: [],
      methodIds: ['test-method'],
    }),
    undefined,
    false,
    false,
  );
  expect(f.s.state).toBe('clarifying');
  expect(
    Object.values(f.s.context.issuedLogicalTasks).every((t) => t.settlement === 'settled'),
  ).toBe(true);
  expect(f.s.context.control.settledResourceTasks).toEqual([]);
  expect(() => f.send('PHASE_READY')).toThrow(/incomplete/);
  f.send('RESOURCES_SETTLED', {
    logicalTaskKeys: Object.keys(f.s.context.issuedLogicalTasks),
    receipt: artifact,
  });
  f.send('PHASE_READY');
  expect(f.s.state).toBe('collecting_questions');
});
it('rejects regressed clock receipts without changing state or allowance', () => {
  const f = new Flow();
  f.pass();
  const budget = structuredClone(f.s.context.activeBudget);
  const before = structuredClone(f.s);
  const e = {
    ...f.events[0]!,
    id: 'clock-regression',
    clockReceipt: clock(10000, 1),
    body: { kind: 'CLOCK_CHECKPOINT', data: {} },
  } as import('../../src/domain/contracts.js').ValidatedEvent;
  expect(() => reduceRun(f.s, e)).toThrow(/REGRESSION/);
  expect(f.s.context.activeBudget).toEqual(budget);
  expect(f.s).toEqual(before);
});
it('active crash downtime is charged with recorded wall receipts', () => {
  const f = new Flow();
  f.pass();
  f.s = restoreForReconciliation(f.s);
  const before = f.s.context.activeBudget.remainingMs,
    last = f.s.context.activeBudget.lastReceipt;
  const e = {
    id: 'reconcile-new-epoch',
    runId: 'run1',
    schemaVersion: 1,
    actor: { kind: 'adapter', receiptId: 'adapter' },
    round: 0,
    phase: null,
    clockReceipt: clock(last.wallMs + 500, 20, 'epoch2'),
    body: {
      kind: 'RECONCILED',
      data: {
        ownership: true,
        priorControllerExited: false,
        resourcesSettled: false,
        receipt: artifact,
        observations: [],
      },
    },
  } as import('../../src/domain/contracts.js').ValidatedEvent;
  const r = reduceRun(f.s, e);
  expect(r.snapshot.context.activeBudget.remainingMs).toBe(before - 500);
  expect(r.snapshot.context.activeBudget.deadline?.processEpoch).toBe('epoch2');
  expect(r.intents.some((i) => i.kind === 'launch')).toBe(false);
});

const phaseSetup: Record<string, (f: Flow) => void> = {
  preflight: () => {},
  clarifying: (f) => {
    f.pass();
  },
  collecting_questions: (f) => {
    f.pass();
    f.clarify();
  },
  publishing_answers: (f) => {
    f.pass();
    f.clarify();
    f.collect();
  },
  prepare_round: (f) => {
    f.ready();
  },
  reviewing: (f) => {
    f.ready();
    f.send('ADMIT_ROUND');
  },
  prepare_candidate: (f) => {
    f.ready();
    f.send('ADMIT_ROUND');
    f.reviews();
  },
  judging: (f) => {
    f.ready();
    f.send('ADMIT_ROUND');
    f.reviews();
    f.candidate();
  },
  confirming: (f) => {
    f.ready();
    f.send('ADMIT_ROUND');
    f.reviews();
    f.candidate();
    f.judge();
  },
  evaluate_round: (f) => {
    f.ready();
    f.send('ADMIT_ROUND');
    f.reviews();
    f.candidate();
    f.judge();
    f.ballots();
  },
};
for (const [state, setup] of Object.entries(phaseSetup))
  it(`reconciliation returns exactly to saved ${state} without inference`, () => {
    const f = new Flow();
    setup(f);
    expect(f.s.state).toBe(state);
    const calls = f.s.context.callsReserved;
    f.s = restoreForReconciliation(f.s);
    const r = f.send('RECONCILED', {
      ownership: true,
      priorControllerExited: false,
      resourcesSettled: true,
      receipt: artifact,
      observations: [],
    });
    expect(f.s.state).toBe(state);
    expect(f.s.context.reconcileOriginState).toBeNull();
    expect(f.s.context.callsReserved).toBe(calls);
    expect(r.intents.some((i) => i.kind === 'launch')).toBe(false);
  });
for (const [state, setup] of Object.entries(phaseSetup).filter(([s]) => s !== 'preflight'))
  it(`settled ${state} remedy returns via preflight to its saved target`, () => {
    const f = new Flow();
    setup(f);
    const calls = f.s.context.callsReserved;
    f.send('REQUIRE_INPUT', { reason: 'CONTEXT_REMEDY', outcome: 'needs_context' });
    f.settle();
    expect(f.s.context.resumeTarget).toBe(state);
    f.send('RESUME');
    f.send('RECONCILED', {
      ownership: true,
      priorControllerExited: true,
      resourcesSettled: true,
      receipt: artifact,
      observations: [],
    });
    expect(f.s.state).toBe('preflight');
    expect(f.s.context.resumeTarget).toBe(state);
    const r = f.pass();
    expect(f.s.state).toBe(state);
    expect(f.s.context.callsReserved).toBe(calls);
    expect(f.s.context.resumeTarget).toBeNull();
    expect(r.intents.some((i) => i.kind === 'launch')).toBe(false);
  });
it('saved settling phase returns to settling before its recorded terminal result', () => {
  const f = new Flow();
  f.ready();
  f.round();
  f.send('LIFECYCLE_UNKNOWN');
  expect(f.s.state).toBe('reconciling');
  expect(f.s.context.reconcileOriginState).toBe('settling');
  f.send('RECONCILED', {
    ownership: true,
    priorControllerExited: false,
    resourcesSettled: true,
    receipt: artifact,
    observations: [],
  });
  expect(f.s.state).toBe('settling');
  f.settle();
  expect(f.s.state).toBe('completed');
});
it('a settled pause cannot bypass positive prior-controller exit', () => {
  const f = new Flow();
  f.send('PREFLIGHT', {
    status: 'blocked',
    attestation: null,
    code: 'ROUTE_GAP',
    resourcesSettled: true,
  });
  expect(f.s.state).toBe('blocked');
  expect(f.s.context.resumeTarget).toBe('clarifying');
  f.send('RESUME');
  expect(() =>
    f.send('RECONCILED', {
      ownership: true,
      priorControllerExited: false,
      resourcesSettled: true,
      receipt: artifact,
      observations: [],
    }),
  ).toThrow(/Prior owner/);
  expect(f.s.state).toBe('reconciling');
});
it('a positively settled required phase with a missing payload terminally blocks inference', () => {
  const f = new Flow();
  f.pass();
  for (const role of ['openai', 'gemini', 'claude'] as const) {
    const key = f.launch('clarify', role).logicalTaskKey;
    f.send(
      'WORKER_OBSERVED',
      {
        logicalTaskKey: key,
        observation: { status: 'exited', rawReceipts: [artifact], exitCode: 0 },
      },
      'clarify',
    );
    f.send('RESOURCES_SETTLED', { logicalTaskKeys: [key], receipt: artifact });
  }
  expect(f.s.context.control.phasePayloads).toEqual({});
  f.send('PHASE_READY');
  expect(f.s.state).toBe('settling');
  expect(f.s.context.inferenceBlock).toBe('MISSING_REQUIRED_RESULT');
  expect(f.s.context.pendingOutcome).toBe('blocked');
});
it('qualified fake selections preserve a real objection owner and unresolved outcome', () => {
  const variants = [
    ['gpt-6.1-sol', 'qualified-claude'],
    ['qualified-openai', 'claude-sonnet-5-5-high'],
  ];
  const out = variants.map(([openai, claude]) => {
    const r = request();
    r.config.resolved.reviewers.openai.model = openai!;
    r.config.resolved.reviewers.claude.model = claude!;
    const f = new Flow(r);
    f.ready();
    f.send('ADMIT_ROUND');
    f.finish('review', (role) => ({
      kind: 'review',
      proposals: ['candidate'],
      newObjections:
        role === 'openai'
          ? [
              {
                id: 'o1',
                claimId: 'claim1',
                claim: 'Missing evidence',
                evidenceIds: [],
                resolution: 'Supply evidence',
                status: 'open',
              },
            ]
          : [],
      evidenceRequests: [],
      missingInputQuestions: [],
      methodIds: [],
    }));
    f.candidate();
    f.judge();
    f.ballots();
    f.send('EVALUATE_ROUND');
    expect(f.s.context.objections[0]?.owner).toBe('openai');
    expect(f.s.state).toBe('prepare_round');
    return {
      seats: f.s.context.ballots.map((b) => b.seat),
      objections: f.s.context.objections,
      limits: f.s.context.effectiveLimits,
      state: f.s.state,
      calls: f.s.context.callsReserved,
    };
  });
  expect(out[0]).toEqual(out[1]);
});
it('a context update commits a valid partial ballot disposition before invalidating unsent peers', () => {
  const f = new Flow();
  f.ready();
  f.send('ADMIT_ROUND');
  f.finish('review', (role) => ({
    kind: 'review',
    proposals: [],
    newObjections:
      role === 'openai'
        ? [
            {
              id: 'o1',
              claimId: 'claim',
              claim: 'Objection',
              evidenceIds: [],
              resolution: 'Supply fact',
              status: 'open',
            },
          ]
        : [],
    evidenceRequests: [],
    missingInputQuestions: [],
    methodIds: [],
  }));
  f.candidate();
  f.judge();
  const c = f.s.context,
    id = c.objections[0]!.id;
  f.finish(
    'ballot',
    () => ({
      kind: 'ballot',
      bindings: {
        runId: 'run1',
        configHash: c.config.configHash,
        profileHash: c.profile.profileHash,
        contextHash: c.sharedContext.contextHash,
        round: c.roundsUsed,
        candidateHash: H,
        evidenceHash: H,
        judgeHash: H,
      },
      decision: 'accept',
      conditional: false,
      newObjections: [],
      missingInputQuestions: [],
      dispositions: [{ objectionId: id, status: 'closed', reason: 'Resolved', evidenceIds: [] }],
      challengeResponses: [],
      reason: 'Accept',
      methodIds: [],
    }),
    ['openai'],
    false,
  );
  f.send('CONTEXT_UPDATE', {
    update: {
      requestId: 'partial-ballot-update',
      runId: 'run1',
      baseContextHash: f.s.context.sharedContext.contextHash,
      userDirections: [artifact],
    },
  });
  f.send('PHASE_READY');
  expect(f.s.state).toBe('preflight');
  expect(f.s.context.objections[0]?.status).toBe('closed');
  expect(f.s.context.objections[0]?.history).toHaveLength(1);
});
it('replays a nonempty extension ledger, added budget and fourth round exactly twice', () => {
  const f = new Flow();
  f.ready();
  for (let n = 0; n < 3; n++) f.round(true);
  f.settle();
  f.send('EXTEND', {
    extension: {
      id: 'bounded-fourth',
      baseRevision: f.s.revision,
      authorizationReceipt: 'user-authorized',
      expiresAt: 100000,
      additionalClarificationBatches: 0,
      additionalRounds: 1,
      additionalActiveBudgetMs: 1000,
    },
  });
  f.resume();
  f.round();
  f.settle();
  expect(f.s.context.extensions).toHaveLength(1);
  expect(f.s.context.activeBudget.appliedExtensionIds).toEqual(['bounded-fourth']);
  for (let pass = 0; pass < 2; pass++) {
    let snapshot = createInitialSnapshot(request());
    const results = [];
    for (const event of f.events) {
      const result = reduceRun(snapshot, event);
      results.push(result);
      snapshot = result.snapshot;
    }
    expect(results).toEqual(f.results);
    expect(snapshot.context.effectiveLimits).toEqual(f.s.context.effectiveLimits);
    expect(snapshot.context.deadlines).toEqual(f.s.context.deadlines);
  }
});
it('provider exit without watchdog/child settlement stays in reconciliation and retains its deadline', () => {
  const f = new Flow();
  f.pass();
  f.finish(
    'clarify',
    () => ({
      kind: 'clarification',
      ready: true,
      questions: [],
      methodIds: ['test-method'],
    }),
    ['openai'],
    false,
    false,
  );
  const key = Object.keys(f.s.context.issuedLogicalTasks)[0]!;
  const deadline = f.s.context.control.workerDeadlines[key];
  expect(deadline).toBeDefined();
  expect(f.s.context.issuedLogicalTasks[key]?.settlement).toBe('settled');
  expect(f.s.context.control.settledResourceTasks).not.toContain(key);
  f.s = restoreForReconciliation(f.s);
  const r = f.send('RECONCILED', {
    ownership: true,
    priorControllerExited: false,
    resourcesSettled: false,
    receipt: artifact,
    observations: [],
  });
  expect(f.s.state).toBe('reconciling');
  expect(f.s.context.deadlines).toContainEqual(deadline);
  expect(r.intents.some((i) => i.kind === 'observe' && i.key.includes(key))).toBe(true);
});

describe('accepted non-launch effect receipts', () => {
  const states: ControlState[] = ['preflight', 'needs_context', 'clarifying', 'collecting_questions', 'publishing_answers', 'prepare_round', 'reviewing', 'prepare_candidate', 'judging', 'confirming', 'evaluate_round', 'reconciling', 'needs_user', 'blocked', 'settling', 'completed', 'cancelled'];
  const receiptEvent = (snapshot: Flow['s']): ValidatedEvent => ({
    id: 'effect-receipt', runId: 'run1', schemaVersion: 1,
    actor: { kind: 'adapter', receiptId: 'host-owned' }, round: 0, phase: null,
    clockReceipt: clock(10010, 110),
    body: { kind: 'EFFECT_RECEIPT_RECORDED', data: { key: 'effect', intentHash: H, receipt: artifact } },
  });
  for (const state of states) {
    it(`records bookkeeping in ${state} with fixed counters, stages and no effects`, () => {
      const f = new Flow();
      f.s.state = state;
      if (state === 'reconciling') f.s.context.reconcileOriginState = 'preflight';
      if (state === 'completed' || state === 'cancelled') f.s.context.activeBudget.status = 'settled';
      const before = structuredClone(f.s);
      const r = reduceRun(f.s, receiptEvent(f.s));
      expect(r.snapshot.state).toBe(state);
      expect(r.snapshot.revision).toBe(1);
      expect(r.intents).toEqual([]);
      expect(r.snapshot.context.callsReserved).toBe(0);
      expect(r.snapshot.context.roundsUsed).toBe(0);
      expect(r.snapshot.context.clarificationBatchesUsed).toBe(0);
      expect(r.snapshot.context.issuedLogicalTasks).toEqual(before.context.issuedLogicalTasks);
      expect(r.snapshot.context.activeBudget.status).toBe(before.context.activeBudget.status);
      expect(r.snapshot.context.activeBudget.remainingMs).toBe(before.context.activeBudget.remainingMs);
      expect(r.snapshot.context.inferenceBlock).toBeNull();
      expect(r.snapshot.context.control.settledResourceTasks).toEqual([]);
    });
  }
  it('requires adapter origin and rejects clock regression without recording completion', () => {
    const f = new Flow(); f.pass();
    const e = receiptEvent(f.s);
    expect(() => reduceRun(f.s, { ...e, actor: { kind: 'user', receiptId: 'wrong' } })).toThrow('Adapter actor required');
    expect(() => reduceRun(f.s, { ...e, clockReceipt: clock(9999, 1) })).toThrow('MONOTONIC_CLOCK_REGRESSION');
    const expired = { ...e, clockReceipt: clock(20000000, 20000000) };
    const r = reduceRun(f.s, expired);
    expect(r.snapshot.state).toBe('clarifying');
    expect(r.snapshot.context.activeBudget.remainingMs).toBe(0);
    expect(r.snapshot.context.callsReserved).toBe(3);
    expect(r.intents).toEqual([]);
  });
});
