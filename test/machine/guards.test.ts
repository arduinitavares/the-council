import { describe, expect, it } from 'vitest';
import { H, config, makeConfirmation, makeQuestion, clock } from '../fixtures/builders.js';
import type {
  ControlState,
  RunRequest,
  RunSnapshot,
  ValidatedEvent,
} from '../../src/domain/contracts.js';
import * as core from '../../src/machine/reduce.js';
function request(): RunRequest {
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
      resolved: config,
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
function initial(state: ControlState = 'preflight'): RunSnapshot {
  expect(core, 'pure machine module must exist').not.toBeNull();
  return { ...core!.createInitialSnapshot(request()), state };
}
let seq = 0;
function event(kind: string, data: unknown = {}, s?: RunSnapshot): ValidatedEvent {
  return {
    id: `e${++seq}`,
    runId: 'run1',
    schemaVersion: 1,
    actor: { kind: kind === 'SETTLED' ? 'adapter' : 'controller', receiptId: 'controller' },
    round: s?.context.roundsUsed ?? 0,
    phase: null,
    clockReceipt: clock(10000 + seq, 100 + seq),
    body: { kind, data },
  } as ValidatedEvent;
}
function step(s: RunSnapshot, k: string, d: unknown = {}) {
  return core!.reduceRun(s, event(k, d, s));
}
const active: ControlState[] = [
  'preflight',
  'clarifying',
  'collecting_questions',
  'publishing_answers',
  'prepare_round',
  'reviewing',
  'prepare_candidate',
  'judging',
  'confirming',
  'evaluate_round',
];
describe('stable control and full admission guards', () => {
  it('starts at a versioned stable preflight without effects', () => {
    const s = initial();
    expect(s.state).toBe('preflight');
    expect(s.machineVersion).toBe(1);
    expect(s.schemaVersion).toBe(1);
    expect(s.context.callsReserved).toBe(0);
  });
  for (const state of active)
    for (const kind of ['CANCEL', 'ERROR', 'DEADLINE'])
      it(`${state} handles ${kind} through settling`, () => {
        const s = initial(state);
        expect(
          step(s, kind, kind === 'ERROR' ? { code: 'FAILURE', terminalInference: false } : {})
            .snapshot.state,
        ).toBe('settling');
      });
  for (const state of active)
    it(`${state} captures reconciliation origin`, () => {
      const s = initial(state);
      const r = step(s, 'LIFECYCLE_UNKNOWN');
      expect(r.snapshot.state).toBe('reconciling');
      expect(r.snapshot.context.reconcileOriginState).toBe(state);
      expect(r.intents.some((x: { kind: string }) => x.kind === 'launch')).toBe(false);
    });
  it('cannot admit a round with unresolved blocking input', () => {
    const s = initial('prepare_round');
    s.context.questionLedger.questions = [makeQuestion()];
    const r = step(s, 'ADMIT_ROUND');
    expect(r.snapshot.state).toBe('settling');
    expect(r.snapshot.context.callsReserved).toBe(0);
    expect(r.snapshot.context.resumeTarget).toBe('prepare_round');
  });
  it('round three reject reaches stable evaluation before needs_user', () => {
    const s = initial('evaluate_round');
    const c = makeConfirmation();
    s.context.roundsUsed = 3;
    s.context.ballots = c.ballots.map((b) => ({
      ...b,
      decision: b.seat === 'claude' ? 'reject' : 'accept',
    }));
    s.context.control.confirmation = c;
    s.context.control.confirmation.ballots = s.context.ballots;
    const r = step(s, 'EVALUATE_ROUND');
    expect(r.snapshot.state).toBe('settling');
    expect(r.snapshot.context.pendingOutcome).toBe('needs_user');
  });
  it('unanimous evaluation completes only through settlement', () => {
    const s = initial('evaluate_round');
    s.context.roundsUsed = 1;
    s.context.control.confirmation = makeConfirmation();
    const r = step(s, 'EVALUATE_ROUND');
    expect(r.snapshot.state).toBe('settling');
    expect(r.snapshot.context.pendingOutcome).toBe('completed');
    expect(
      step(r.snapshot, 'SETTLED', {
        receipt: { kind: 'settlement', sha256: H, path: '/tmp/settled', bytes: 1 },
      }).snapshot.state,
    ).toBe('completed');
  });
  it('rejects unknown event kinds, payload fields, actors and stale correlation', () => {
    const s = initial();
    expect(() => step(s, 'BOGUS')).toThrow();
    expect(() => step(s, 'CANCEL', { extra: true })).toThrow();
    const e = event('ADMIT_ROUND', {}, s);
    e.actor.kind = 'user';
    expect(() => core!.reduceRun(s, e)).toThrow();
    e.actor.kind = 'controller';
    e.runId = 'other';
    expect(() => core!.reduceRun(s, e)).toThrow();
  });
  it('rejects incompatible snapshots and missing reconciliation origin', () => {
    const s = initial();
    expect(() => core!.restoreForReconciliation({ ...s, machineVersion: 2 })).toThrow();
    expect(() => core!.restoreForReconciliation({ ...s, state: 'reconciling' })).toThrow();
  });
  it('does not request a candidate while evidence remains pending', () => {
    const s = initial('prepare_candidate');
    s.context.pendingEvidenceIds = ['evidence1'];
    expect(() => step(s, 'REQUEST_CANDIDATE')).toThrow();
  });
  it('rejects evidence requests after candidate admission without revoking the request', () => {
    const s = initial('prepare_candidate');
    s.context.control.candidateRequested = true;
    const before = structuredClone(s);
    expect(() =>
      step(s, 'EVIDENCE_REQUESTED', {
        request: {
          id: 'late',
          claimId: 'claim',
          source: 'https://example.org',
          reason: 'Late request',
        },
      }),
    ).toThrow(/Unexpected or duplicate evidence request/);
    expect(s).toEqual(before);
  });
});
it('user-origin preflight cannot authorize inference', () => {
  const s = initial(),
    e = event(
      'PREFLIGHT',
      {
        status: 'pass',
        attestation: { kind: 'receipt', sha256: H, path: '/tmp/a', bytes: 1 },
        code: null,
        resourcesSettled: true,
      },
      s,
    );
  e.actor.kind = 'user';
  expect(() => core.reduceRun(s, e)).toThrow(/actor/i);
});

it('wrong-state admission and evaluation are rejected before budget or reservations change', () => {
  for (const state of ['preflight', 'clarifying', 'reviewing', 'confirming', 'settling'] as const) {
    const s = initial(state),
      before = structuredClone(s);
    for (const kind of ['ADMIT_ROUND', 'EVALUATE_ROUND']) {
      expect(() => step(s, kind)).toThrow(/legal|outside/);
      expect(s).toEqual(before);
    }
  }
});
it('the XState event map has no admission/evaluation carrier in other states', async () => {
  const { stateEventTargets, councilMachine } = await import(
    '../../src/machine/council-machine.js'
  );
  const { transition } = await import('xstate');
  for (const [state, mapping] of Object.entries(stateEventTargets)) {
    if (state !== 'prepare_round') expect(mapping.ADMIT_ROUND).toBeUndefined();
    if (state !== 'evaluate_round') expect(mapping.EVALUATE_ROUND).toBeUndefined();
    expect(mapping.CLOCK_CHECKPOINT).toEqual(
      ['completed', 'cancelled'].includes(state) ? undefined : [state],
    );
  }
  const s = initial();
  const recordedEvent = event('ADMIT_ROUND');
  const resolved = councilMachine.resolveState({ value: 'preflight', context: s.context });
  const [next, actions] = transition(councilMachine, resolved, {
    type: 'ADMIT_ROUND',
    recordedEvent,
    target: 'reviewing',
    context: { ...s.context, callsReserved: 3 },
  });
  expect(next.value).toBe('preflight');
  expect(next.context.callsReserved).toBe(0);
  expect(actions).toEqual([]);
});
it('an operational error in reconciliation saves the original legal phase', () => {
  const s = initial('reviewing');
  const r = step(s, 'LIFECYCLE_UNKNOWN');
  const failed = step(r.snapshot, 'ERROR', { code: 'ACCESS_GAP', terminalInference: false });
  expect(failed.snapshot.context.resumeTarget).toBe('reviewing');
});
