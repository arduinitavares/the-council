import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { canonicalJson, hashArtifact } from '../../src/domain/hash.js';
import type { JsonValue, ValidatedEvent } from '../../src/domain/contracts.js';
import { createInitialSnapshot, reduceRun, restoreForReconciliation } from '../../src/machine/reduce.js';
import { clock, rawQuestion } from '../fixtures/builders.js';
import { Flow, artifact } from '../machine/helpers.js';

async function fixture() {
  const { openRunStore } = await import('../../src/store/run-store.js');
  const root = mkdtempSync(join(tmpdir(), 'council-store-'));
  const store = openRunStore(root);
  const flow = new Flow();
  const raw = Buffer.from('version: 1\n');
  const config = flow.s.context.config;
  config.rawArtifact = store.artifacts.putArtifact(raw, 'raw-config');
  config.configArtifact = store.artifacts.putArtifact(Buffer.from(canonicalJson(config.resolved)), 'config');
  config.rawSha256 = createHash('sha256').update(raw).digest('hex');
  config.configHash = hashArtifact('council-config', config.resolved as unknown as JsonValue);
  flow.s.context.request.config = structuredClone(config);
  store.createRun(flow.s);
  return { root, store, flow, openRunStore };
}

describe('transactional journal/checkpoint/outbox', () => {
  it('commits once, rejects stale revisions and conflicting event identities', async () => {
    const { root, store, flow, openRunStore } = await fixture();
    const r = flow.pass(), e = flow.events.at(-1)!;
    expect(() => store.commitTransition('run1', 4, e, r)).toThrow('REVISION_CONFLICT');
    const receipt = store.commitTransition('run1', 0, e, r);
    expect(receipt).toMatchObject({ runId: 'run1', eventId: e.id, revision: 1, duplicate: false });
    expect(store.commitTransition('run1', 1, e, { snapshot: flow.s, intents: [] }).duplicate).toBe(true);
    expect(() => store.commitTransition('run1', 1, { ...e, actor: { ...e.actor, receiptId: 'conflict' } }, r)).toThrow('EVENT_ID_CONFLICT');
    store.close();
    const reopened = openRunStore(root);
    expect(reopened.load('run1').revision).toBe(1);
    expect(reopened.pendingEffects('run1').map(i => i.key)).toEqual(r.intents.map(i => i.key));
    reopened.close();
  });

  for (const table of ['journal', 'checkpoints', 'outbox']) {
    it(`rolls back every write when failure is injected after ${table}`, async () => {
      const { root, store, flow, openRunStore } = await fixture();
      const db = new Database(join(root, 'journal.sqlite'));
      const operation = table === 'checkpoints' ? 'UPDATE' : 'INSERT';
      db.exec(`CREATE TRIGGER fail_write AFTER ${operation} ON ${table} BEGIN SELECT RAISE(ABORT, 'INJECTED_FAILURE'); END;`);
      const r = flow.pass();
      expect(() => store.commitTransition('run1', 0, flow.events.at(-1)!, r)).toThrow('INJECTED_FAILURE');
      expect(store.load('run1').revision).toBe(0);
      expect(store.pendingEffects('run1')).toEqual([]);
      expect(db.prepare('SELECT count(*) AS n FROM journal').get()).toEqual({ n: 0 });
      db.exec('DROP TRIGGER fail_write');
      db.close();
      store.close();
      const reopened = openRunStore(root);
      reopened.commitTransition('run1', 0, flow.events.at(-1)!, r);
      expect(reopened.load('run1').revision).toBe(1);
      reopened.close();
    });
  }

  it('rejects forged reduction output and protects pinned versions on load', async () => {
    const { store, flow, root } = await fixture();
    const r = flow.pass();
    expect(() => store.commitTransition('run1', 0, flow.events.at(-1)!, { ...r, intents: [] })).toThrow('TRANSITION_MISMATCH');
    const db = new Database(join(root, 'journal.sqlite'));
    const altered = structuredClone(store.load('run1'));
    altered.machineVersion = 99;
    db.prepare('UPDATE checkpoints SET snapshot = ? WHERE run_id = ?').run(canonicalJson(altered), 'run1');
    expect(() => store.load('run1')).toThrow('INCOMPATIBLE_CHECKPOINT');
    db.close();
    store.close();
  });

  it('accepts only the reducer-produced initial checkpoint for a new run', async () => {
    const { store, flow } = await fixture();
    const forged = structuredClone(flow.s);
    forged.context.request.runId = 'forged';
    forged.context.activeBudget.remainingMs = 1;
    expect(() => store.createRun(forged)).toThrow('INVALID_INITIAL_CHECKPOINT');
    expect(() => store.load('forged')).toThrow('RUN_NOT_FOUND');
    store.close();
  });

  for (const kind of ['LAUNCH_DISPATCHED', 'LAUNCH_RECEIPT_RECORDED'] as const) {
    it(`rolls back the checkpoint and journal if the ${kind} outbox update fails`, async () => {
      const { store, flow, root } = await fixture();
      const admitted = flow.pass();
      store.commitTransition('run1', 0, flow.events.at(-1)!, admitted);
      const t = Object.values(flow.s.context.issuedLogicalTasks)[0]!;
      if (kind === 'LAUNCH_RECEIPT_RECORDED') {
        const fence = flow.send('LAUNCH_DISPATCHED', { logicalTaskKey: t.reservation.logicalTaskKey });
        store.commitTransition('run1', 1, flow.events.at(-1)!, fence);
      }
      const before = store.load('run1');
      const db = new Database(join(root, 'journal.sqlite'));
      db.exec("CREATE TRIGGER fail_fence AFTER UPDATE ON outbox BEGIN SELECT RAISE(ABORT, 'INJECTED_FENCE_FAILURE'); END;");
      const data = kind === 'LAUNCH_DISPATCHED' ? { logicalTaskKey: t.reservation.logicalTaskKey } : {
        binding: {
          ...t.reservation.bindings, attemptId: 'actual-attempt', role: t.reservation.role,
          phase: t.reservation.phase, requested: t.reservation.requested, configured: t.reservation.requested,
          authority: { kind: 'supervised', runId: 'run1', taskId: 'real-task', dispatchId: 'real-dispatch', receiptId: 'real-receipt' },
          admittedMethodIds: ['test-method'], inputQuestionIds: [], inputObjectionIds: [], inputEvidenceIds: [],
        },
      };
      const result = flow.send(kind, data, kind === 'LAUNCH_RECEIPT_RECORDED' ? 'clarify' : null);
      expect(() => store.commitTransition('run1', before.revision, flow.events.at(-1)!, result)).toThrow('INJECTED_FENCE_FAILURE');
      expect(store.load('run1')).toEqual(before);
      expect(store.effectRecord(t.reservation.effectKey).status).toBe(kind === 'LAUNCH_DISPATCHED' ? 'pending_execution' : 'dispatched');
      expect(db.prepare('SELECT count(*) AS n FROM journal').get()).toEqual({ n: before.revision });
      db.close(); store.close();
    });
  }

  it('atomically fences launches and mirrors only accepted receipts', async () => {
    const { root, store, flow, openRunStore } = await fixture();
    const r = flow.pass();
    store.commitTransition('run1', 0, flow.events.at(-1)!, r);
    const launch = r.intents.find(i => i.kind === 'launch')!;
    const task = Object.values(flow.s.context.issuedLogicalTasks)[0]!;
    const key = task.reservation.logicalTaskKey;
    expect(() => store.recordEffectReceipt(launch.key, { eventId: 'absent', value: {} }, 1)).toThrow('UNACCEPTED_EFFECT_RECEIPT');
    const fence = flow.send('LAUNCH_DISPATCHED', { logicalTaskKey: key });
    store.commitTransition('run1', 1, flow.events.at(-1)!, fence);
    expect(store.pendingEffects('run1').some(i => i.key === launch.key)).toBe(false);
    const binding = {
      ...task.reservation.bindings, attemptId: 'actual-attempt', role: task.reservation.role,
      phase: task.reservation.phase, requested: task.reservation.requested, configured: task.reservation.requested,
      authority: { kind: 'supervised' as const, runId: 'run1', taskId: 'real-task', dispatchId: 'real-dispatch', receiptId: 'real-receipt' },
      admittedMethodIds: ['test-method'], inputQuestionIds: [], inputObjectionIds: [], inputEvidenceIds: [],
    };
    const got = flow.send('LAUNCH_RECEIPT_RECORDED', { binding }, 'clarify');
    const e = flow.events.at(-1)!;
    store.commitTransition('run1', 2, e, got);
    const receipt = { eventId: e.id, value: binding as unknown as JsonValue };
    expect(() => store.recordEffectReceipt(launch.key, receipt, 2)).toThrow('REVISION_CONFLICT');
    expect(() => store.recordEffectReceipt(launch.key, { ...receipt, value: {} }, 3)).toThrow('UNACCEPTED_EFFECT_RECEIPT');
    store.recordEffectReceipt(launch.key, receipt, 3);
    expect(store.effectRecord(launch.key)).toMatchObject({ status: 'receipt_recorded', receipt });
    store.close();
    const reopened = openRunStore(root);
    expect(reopened.load('run1').context.issuedLogicalTasks[key]!.stage).toBe('receipt_recorded');
    expect(reopened.effectRecord(launch.key).receipt).toEqual(receipt);
    reopened.close();
  });

  it('retains a new one-shot observation after completing an earlier observation', async () => {
    const { store, flow } = await fixture();
    const commit = (r: ReturnType<Flow['send']>) => store.commitTransition('run1', r.snapshot.revision - 1, flow.events.at(-1)!, r);
    commit(flow.pass());
    const task = Object.values(flow.s.context.issuedLogicalTasks)[0]!;
    commit(flow.send('LAUNCH_DISPATCHED', { logicalTaskKey: task.reservation.logicalTaskKey }));
    const first = flow.send('LIFECYCLE_UNKNOWN');
    commit(first);
    const observe = first.intents.find(i => i.kind === 'observe')!;
    const observation = { status: 'unverifiable', rawReceipts: [], exitCode: null } as const;
    commit(flow.send('WORKER_OBSERVED', { logicalTaskKey: task.reservation.logicalTaskKey, observation }, 'clarify'));
    store.recordEffectReceipt(observe.key, { eventId: flow.events.at(-1)!.id, value: observation }, flow.s.revision);
    const later = flow.send('RECONCILED', { ownership: true, priorControllerExited: true, resourcesSettled: false, receipt: artifact, observations: [] });
    commit(later);
    const next = later.intents.find(i => i.kind === 'observe')!;
    expect(next.key).not.toBe(observe.key);
    expect(store.pendingEffects('run1').map(i => i.key)).toContain(next.key);
    expect(store.pendingEffects('run1').map(i => i.key)).not.toContain(observe.key);
    expect(flow.s.context.callsReserved).toBe(3);
    expect(Object.values(flow.s.context.issuedLogicalTasks)[0]!.reservation.clientAttemptKey).toBe(task.reservation.clientAttemptKey);
    store.close();
  });

  it('atomically records terminal report completion from an adapter-owned immutable receipt', async () => {
    const { store, flow, root } = await fixture();
    const cancel = flow.send('CANCEL');
    store.commitTransition('run1', 0, flow.events.at(-1)!, cancel);
    const settled = flow.settle();
    store.commitTransition('run1', 1, flow.events.at(-1)!, settled);
    expect(flow.s.state).toBe('cancelled');
    const report = settled.intents.find(i => i.kind === 'report')!;
    const proof = store.artifacts.putArtifact(Buffer.from('inspected report completion'), 'effect-receipt');
    const e: ValidatedEvent = {
      id: 'report-completed', runId: 'run1', schemaVersion: 1,
      actor: { kind: 'adapter', receiptId: 'host-adapter' }, round: 0, phase: null,
      clockReceipt: clock(10020, 120),
      body: { kind: 'EFFECT_RECEIPT_RECORDED', data: { key: report.key, intentHash: hashArtifact('effect', report as unknown as JsonValue), receipt: proof } },
    };
    const result = reduceRun(flow.s, e);
    const db = new Database(join(root, 'journal.sqlite'));
    db.exec("CREATE TRIGGER fail_receipt AFTER UPDATE ON outbox BEGIN SELECT RAISE(ABORT, 'INJECTED_RECEIPT_FAILURE'); END;");
    expect(() => store.commitTransition('run1', 2, e, result)).toThrow('INJECTED_RECEIPT_FAILURE');
    expect(store.load('run1').revision).toBe(2);
    expect(store.effectRecord(report.key).receipt).toBeNull();
    db.exec('DROP TRIGGER fail_receipt'); db.close();
    store.commitTransition('run1', 2, e, result);
    expect(store.effectRecord(report.key)).toMatchObject({ status: 'receipt_recorded', receipt: { eventId: e.id, value: proof } });
    store.recordEffectReceipt(report.key, { eventId: e.id, value: proof as unknown as JsonValue }, 3);
    expect(store.pendingEffects('run1').some(i => i.key === report.key)).toBe(false);
    expect(store.commitTransition('run1', 3, e, { snapshot: result.snapshot, intents: [] }).duplicate).toBe(true);
    const conflictingProof = store.artifacts.putArtifact(Buffer.from('different receipt'), 'effect-receipt');
    const conflict = { ...e, id: 'conflict', body: { ...e.body, data: { ...e.body.data, receipt: conflictingProof } } } as ValidatedEvent;
    expect(() => store.commitTransition('run1', 3, conflict, reduceRun(result.snapshot, conflict))).toThrow('EFFECT_RECEIPT_CONFLICT');
    store.close();
  });

  it('rejects wrong effect key/hash and generic launch completion', async () => {
    const { store, flow } = await fixture();
    const admitted = flow.pass();
    store.commitTransition('run1', 0, flow.events.at(-1)!, admitted);
    const launch = admitted.intents.find(i => i.kind === 'launch')!;
    const proof = store.artifacts.putArtifact(Buffer.from('real proof'), 'effect-receipt');
    const make = (key: string, intentHash: string): ValidatedEvent => ({
      id: 'generic-receipt', runId: 'run1', schemaVersion: 1,
      actor: { kind: 'adapter', receiptId: 'host-adapter' }, round: 0, phase: null,
      clockReceipt: clock(10020, 120),
      body: { kind: 'EFFECT_RECEIPT_RECORDED', data: { key, intentHash, receipt: proof } },
    });
    const unknown = make('missing', 'a'.repeat(64));
    expect(() => store.commitTransition('run1', 1, unknown, reduceRun(flow.s, unknown))).toThrow('EFFECT_NOT_FOUND');
    const wrongHash = make(launch.key, '0'.repeat(64));
    expect(() => store.commitTransition('run1', 1, wrongHash, reduceRun(flow.s, wrongHash))).toThrow('EFFECT_INTENT_HASH_MISMATCH');
    const genericLaunch = make(launch.key, hashArtifact('effect', launch as unknown as JsonValue));
    expect(() => store.commitTransition('run1', 1, genericLaunch, reduceRun(flow.s, genericLaunch))).toThrow('GENERIC_LAUNCH_RECEIPT_FORBIDDEN');
    const deadline = admitted.intents.find(i => i.kind !== 'launch');
    if (deadline) throw new Error('Fixture unexpectedly has another effect');
    const fence = flow.send('LAUNCH_DISPATCHED', { logicalTaskKey: String((launch.input as { logicalTaskKey: string }).logicalTaskKey) });
    store.commitTransition('run1', 1, flow.events.at(-1)!, fence);
    expect(store.load('run1').revision).toBe(2);
    expect(store.effectRecord(launch.key).status).toBe('dispatched');
    store.close();
  });

  it('rejects corrupt proof for an eligible report completion', async () => {
    const { store, flow } = await fixture();
    const cancel = flow.send('CANCEL');
    store.commitTransition('run1', 0, flow.events.at(-1)!, cancel);
    const settled = flow.settle();
    store.commitTransition('run1', 1, flow.events.at(-1)!, settled);
    const report = settled.intents.find(i => i.kind === 'report')!;
    const proof = store.artifacts.putArtifact(Buffer.from('real proof'), 'effect-receipt');
    const event: ValidatedEvent = {
      id: 'corrupt-completion', runId: 'run1', schemaVersion: 1,
      actor: { kind: 'adapter', receiptId: 'host-adapter' }, round: 0, phase: null,
      clockReceipt: clock(10020, 120),
      body: { kind: 'EFFECT_RECEIPT_RECORDED', data: { key: report.key, intentHash: hashArtifact('effect', report as unknown as JsonValue), receipt: proof } },
    };
    const { writeFileSync } = await import('node:fs');
    writeFileSync(proof.path, 'corrupt');
    expect(() => store.commitTransition('run1', 2, event, reduceRun(flow.s, event))).toThrow('ARTIFACT_CORRUPT');
    expect(store.load('run1')).toEqual(flow.s);
    expect(store.effectRecord(report.key)).toMatchObject({ status: 'pending_execution', receipt: null });
    store.close();
  });

  for (const kind of ['publish-context', 'release'] as const) {
    it(`records and mirrors an eligible ${kind} completion with its immutable proof`, async () => {
      const { store, flow } = await fixture();
      if (kind === 'publish-context') flow.ready();
      else {
        flow.pass();
        flow.finish('clarify', () => ({ kind: 'clarification', ready: true, questions: [], methodIds: ['test-method'] }), ['openai'], false);
        flow.send('CANCEL'); flow.settle();
      }
      for (let index = 0; index < flow.events.length; index++)
        store.commitTransition('run1', index, flow.events[index]!, flow.results[index]!);
      const intent = store.pendingEffects('run1').find(i => i.kind === kind)!;
      expect(intent).toBeDefined();
      const proof = store.artifacts.putArtifact(Buffer.from(`inspected ${kind} completion`), 'effect-receipt');
      const event: ValidatedEvent = {
        id: 'allowed-completion', runId: 'run1', schemaVersion: 1,
        actor: { kind: 'adapter', receiptId: 'host-adapter' }, round: 0, phase: null,
        clockReceipt: clock(10001 + flow.tick, 101 + flow.tick),
        body: { kind: 'EFFECT_RECEIPT_RECORDED', data: { key: intent.key, intentHash: hashArtifact('effect', intent as unknown as JsonValue), receipt: proof } },
      };
      const result = reduceRun(flow.s, event), receipt = { eventId: event.id, value: proof as unknown as JsonValue };
      store.commitTransition('run1', flow.s.revision, event, result);
      store.recordEffectReceipt(intent.key, receipt, result.snapshot.revision);
      expect(store.effectRecord(intent.key)).toMatchObject({ status: 'receipt_recorded', receipt });
      expect(store.pendingEffects('run1').map(i => i.key)).not.toContain(intent.key);
      expect(store.readJournal('run1').at(-1)!.event).toEqual(event);
      store.close();
    });
  }

  it('journals explicit recovery restoration and replays downtime and fixed launch fences exactly', async () => {
    const { store, flow, root, openRunStore } = await fixture();
    const admitted = flow.pass();
    store.commitTransition('run1', 0, flow.events.at(-1)!, admitted);
    const task = Object.values(flow.s.context.issuedLogicalTasks)[0]!;
    const fence = flow.send('LAUNCH_DISPATCHED', { logicalTaskKey: task.reservation.logicalTaskKey });
    store.commitTransition('run1', 1, flow.events.at(-1)!, fence);
    store.close();
    const next = openRunStore(root), before = next.load('run1');
    const event: ValidatedEvent = {
      id: 'recovery-clock', runId: 'run1', schemaVersion: 1,
      actor: { kind: 'controller', receiptId: 'recovery' }, round: 0, phase: null,
      clockReceipt: clock(20002, 1, 'recovery-epoch'), body: { kind: 'CLOCK_CHECKPOINT', data: {} },
    };
    const result = reduceRun(restoreForReconciliation(before), event);
    next.commitTransition('run1', 2, event, result, { restoreForReconciliation: true });
    expect(next.load('run1').state).toBe('reconciling');
    expect(next.load('run1').context.activeBudget.remainingMs).toBe(before.context.activeBudget.remainingMs - 10000);
    expect(next.load('run1').context.preflightAttestation).toBeNull();
    expect(next.load('run1').context.issuedLogicalTasks[task.reservation.logicalTaskKey]!.stage).toBe('dispatched');
    expect(next.pendingEffects('run1').some(i => i.key === task.reservation.effectKey)).toBe(false);
    expect(() => next.commitTransition('run1', 3, event, { snapshot: result.snapshot, intents: [] })).toThrow('EVENT_RESTORATION_CONFLICT');
    expect(next.commitTransition('run1', 3, event, { snapshot: result.snapshot, intents: [] }, { restoreForReconciliation: true }).duplicate).toBe(true);
    let replay = createInitialSnapshot(before.context.request);
    const entries = next.readJournal('run1');
    expect(entries.map(entry => entry.restoration)).toEqual(['none', 'none', 'reconcile']);
    for (const entry of entries) {
      expect(hashArtifact('checkpoint', replay as unknown as JsonValue)).toBe(entry.inputCheckpointHash);
      if (entry.restoration === 'reconcile') replay = restoreForReconciliation(replay);
      const replayed = reduceRun(replay, entry.event);
      expect(replayed.intents).toEqual(entry.intents);
      expect(hashArtifact('checkpoint', replayed.snapshot as unknown as JsonValue)).toBe(entry.checkpointHash);
      replay = replayed.snapshot;
    }
    expect(replay).toEqual(next.load('run1'));
    next.close();
  });

  for (const kind of ['stop', 'observe', 'evidence', 'question-batch-request', 'candidate-request', 'evaluate-round', 'deadline'] as const) {
    it(`rejects generic ${kind} completion before changing the journal, checkpoint, or outbox`, async () => {
      const { store, flow, root } = await fixture();
      if (kind === 'stop' || kind === 'observe' || kind === 'deadline') {
        flow.pass();
        const task = Object.values(flow.s.context.issuedLogicalTasks)[0]!;
        flow.send('LAUNCH_DISPATCHED', { logicalTaskKey: task.reservation.logicalTaskKey });
        if (kind === 'stop') flow.send('CANCEL');
        if (kind === 'observe') flow.send('LIFECYCLE_UNKNOWN');
      } else if (kind === 'question-batch-request') {
        flow.pass(); flow.clarify();
      } else {
        flow.ready(); flow.send('ADMIT_ROUND'); flow.reviews();
        if (kind === 'evidence') flow.send('EVIDENCE_REQUESTED', { request: { id: 'evidence1', claimId: 'claim1', source: 'local', reason: 'Verify claim' } });
        if (kind === 'candidate-request') flow.send('REQUEST_CANDIDATE');
        if (kind === 'evaluate-round') { flow.candidate(); flow.judge(); flow.ballots(); }
      }
      for (let index = 0; index < flow.events.length; index++)
        store.commitTransition('run1', index, flow.events[index]!, flow.results[index]!);
      const intent = store.pendingEffects('run1').find(i => i.kind === kind)!;
      expect(intent).toBeDefined();
      const proof = store.artifacts.putArtifact(Buffer.from('arbitrary immutable artifact'), 'effect-receipt');
      const event: ValidatedEvent = {
        id: 'unsupported-completion', runId: 'run1', schemaVersion: 1,
        actor: { kind: 'adapter', receiptId: 'host-adapter' }, round: flow.s.context.roundsUsed, phase: null,
        clockReceipt: clock(10001 + flow.tick, 101 + flow.tick),
        body: { kind: 'EFFECT_RECEIPT_RECORDED', data: { key: intent.key, intentHash: hashArtifact('effect', intent as unknown as JsonValue), receipt: proof } },
      };
      const before = store.load('run1'), pending = store.pendingEffects('run1');
      const db = new Database(join(root, 'journal.sqlite'));
      const outbox = db.prepare('SELECT * FROM outbox ORDER BY key').all();
      db.exec("CREATE TRIGGER forbid_receipt_journal BEFORE INSERT ON journal BEGIN SELECT RAISE(ABORT, 'UNSUPPORTED_RECEIPT_REACHED_JOURNAL'); END;");
      db.exec("CREATE TRIGGER forbid_receipt_outbox BEFORE UPDATE ON outbox BEGIN SELECT RAISE(ABORT, 'UNSUPPORTED_RECEIPT_REACHED_OUTBOX'); END;");
      try {
        expect(() => store.commitTransition('run1', before.revision, event, reduceRun(before, event))).toThrow('GENERIC_EFFECT_RECEIPT_FORBIDDEN');
        expect(store.load('run1')).toEqual(before);
        expect(store.readJournal('run1')).toHaveLength(before.revision);
        expect(store.pendingEffects('run1')).toEqual(pending);
        expect(db.prepare('SELECT * FROM outbox ORDER BY key').all()).toEqual(outbox);
      } finally { db.close(); store.close(); }
    });
  }

  it('does not treat deadline expiry as proof that its watchdog was armed', async () => {
    const { store, flow } = await fixture();
    flow.pass();
    const task = Object.values(flow.s.context.issuedLogicalTasks)[0]!;
    const fence = flow.send('LAUNCH_DISPATCHED', { logicalTaskKey: task.reservation.logicalTaskKey });
    const deadline = fence.intents.find(i => i.kind === 'deadline')!;
    flow.send('DEADLINE');
    for (let index = 0; index < flow.events.length; index++)
      store.commitTransition('run1', index, flow.events[index]!, flow.results[index]!);
    const event = flow.events.at(-1)!;
    try {
      expect(() => store.recordEffectReceipt(deadline.key, { eventId: event.id, value: {} }, flow.s.revision)).toThrow('UNACCEPTED_EFFECT_RECEIPT');
      expect(store.effectRecord(deadline.key)).toMatchObject({ status: 'pending_execution', receipt: null });
      expect(store.pendingEffects('run1').map(i => i.key)).toContain(deadline.key);
    } finally { store.close(); }
  });

  for (const state of ['needs_user', 'needs_context', 'blocked'] as const) {
    it(`restores a settled ${state} pause under a new owner without charging human wait`, async () => {
      const { store, flow, root, openRunStore } = await fixture();
      flow.ready();
      const remainingBeforePause = flow.s.context.activeBudget.remainingMs;
      flow.send('REQUIRE_INPUT', { reason: 'MISSING_INPUT', outcome: state });
      const settled = flow.settle();
      for (let index = 0; index < flow.events.length; index++)
        store.commitTransition('run1', index, flow.events[index]!, flow.results[index]!);
      const paused = store.load('run1');
      expect(paused.state).toBe(state);
      expect(paused.context.inferenceBlock).toBeNull();
      expect(paused.context.activeBudget.status).toBe('paused');
      expect(paused.context.activeBudget.remainingMs).toBe(remainingBeforePause - 2);
      expect(paused.context.callsReserved).toBe(3);
      expect(Object.values(paused.context.issuedLogicalTasks).every(task => task.settlement === 'settled')).toBe(true);
      const report = settled.intents.find(i => i.kind === 'report')!;
      store.close();
      const next = openRunStore(root);
      const make = (id: string, wall: number, mono: number, body: ValidatedEvent['body'], adapter = false): ValidatedEvent => ({
        id, runId: 'run1', schemaVersion: 1, actor: { kind: adapter ? 'adapter' : 'controller', receiptId: 'new-owner' },
        round: 0, phase: null, clockReceipt: clock(wall, mono, 'next-day'), body,
      });
      try {
        const event = make('restore-paused-clock', 90000000, 1, { kind: 'CLOCK_CHECKPOINT', data: {} });
        const restored = reduceRun(restoreForReconciliation(paused), event);
        next.commitTransition('run1', paused.revision, event, restored, { restoreForReconciliation: true });
        expect(next.load('run1').context.activeBudget.remainingMs).toBe(paused.context.activeBudget.remainingMs);
        expect(next.load('run1').context.activeBudget.status).toBe('paused');
        const uncertain = make('uncertain-recovery', 180000000, 2, { kind: 'RECONCILED', data: { ownership: false, priorControllerExited: false, resourcesSettled: false, receipt: artifact, observations: [] } }, true);
        let before = next.load('run1');
        next.commitTransition('run1', before.revision, uncertain, reduceRun(before, uncertain));
        expect(next.load('run1').state).toBe('reconciling');
        expect(next.load('run1').context.activeBudget.status).toBe('paused');
        expect(next.load('run1').context.activeBudget.remainingMs).toBe(paused.context.activeBudget.remainingMs);
        const positive = make('positive-recovery', 270000000, 3, { kind: 'RECONCILED', data: { ownership: true, priorControllerExited: true, resourcesSettled: true, receipt: artifact, observations: [] } }, true);
        before = next.load('run1');
        next.commitTransition('run1', before.revision, positive, reduceRun(before, positive));
        expect(next.load('run1').state).toBe('preflight');
        expect(next.load('run1').context.activeBudget.status).toBe('active');
        expect(next.load('run1').context.activeBudget.remainingMs).toBe(paused.context.activeBudget.remainingMs);
        const proof = next.artifacts.putArtifact(Buffer.from('inspected report completion'), 'effect-receipt');
        const receipt = make('active-receipt', 270000025, 28, { kind: 'EFFECT_RECEIPT_RECORDED', data: { key: report.key, intentHash: hashArtifact('effect', report as unknown as JsonValue), receipt: proof } }, true);
        before = next.load('run1');
        next.commitTransition('run1', before.revision, receipt, reduceRun(before, receipt));
        expect(next.load('run1').context.activeBudget.remainingMs).toBe(paused.context.activeBudget.remainingMs - 25);
        expect(next.load('run1').context.callsReserved).toBe(paused.context.callsReserved);
        let replay = createInitialSnapshot(paused.context.request);
        const entries = next.readJournal('run1');
        expect(entries.filter(entry => entry.restoration === 'reconcile').map(entry => entry.event.id)).toEqual(['restore-paused-clock']);
        for (const entry of entries) {
          expect(hashArtifact('checkpoint', replay as unknown as JsonValue)).toBe(entry.inputCheckpointHash);
          const result = reduceRun(entry.restoration === 'reconcile' ? restoreForReconciliation(replay) : replay, entry.event);
          expect(result.intents).toEqual(entry.intents);
          expect(hashArtifact('checkpoint', result.snapshot as unknown as JsonValue)).toBe(entry.checkpointHash);
          replay = result.snapshot;
        }
        expect(replay).toEqual(next.load('run1'));
      } finally { next.close(); }
    });
  }

  it('resumes a released paused owner without charging the long human wait', async () => {
    const { store, flow, root, openRunStore } = await fixture();
    const paused = flow.send('PREFLIGHT', { status: 'needs_context', attestation: null, code: 'MISSING_INPUT', resourcesSettled: true });
    store.commitTransition('run1', 0, flow.events.at(-1)!, paused);
    store.close();
    const next = openRunStore(root), before = next.load('run1');
    const event: ValidatedEvent = {
      id: 'human-resume', runId: 'run1', schemaVersion: 1,
      actor: { kind: 'controller', receiptId: 'recovery' }, round: 0, phase: null,
      clockReceipt: clock(90000000, 1, 'next-day'), body: { kind: 'RESUME', data: {} },
    };
    const resumed = reduceRun(before, event);
    next.commitTransition('run1', 1, event, resumed);
    expect(next.load('run1').context.activeBudget.remainingMs).toBe(before.context.activeBudget.remainingMs);
    expect(next.load('run1').state).toBe('reconciling');
    expect(next.load('run1').context.callsReserved).toBe(0);
    next.close();
  });

  it('rejects restoration on a non-recovery event and on an already owned active mutation', async () => {
    const { store, flow } = await fixture();
    const admitted = flow.pass();
    expect(() => store.commitTransition('run1', 0, flow.events.at(-1)!, admitted, { restoreForReconciliation: true })).toThrow('INVALID_RESTORATION_EVENT');
    store.commitTransition('run1', 0, flow.events.at(-1)!, admitted);
    const event = { ...flow.events.at(-1)!, id: 'own-recovery', body: { kind: 'CLOCK_CHECKPOINT', data: {} } } as ValidatedEvent;
    const restored = reduceRun(restoreForReconciliation(flow.s), event);
    expect(() => store.commitTransition('run1', 1, event, restored, { restoreForReconciliation: true })).toThrow('RESTORATION_REQUIRES_NEW_OWNER');
    expect(store.load('run1').revision).toBe(1);
    store.close();
  });

  for (const corruption of ['intents', 'input-hash', 'truncated']) {
    it(`rejects ${corruption} journal corruption instead of returning unverified replay evidence`, async () => {
      const { store, flow, root } = await fixture();
      const admitted = flow.pass();
      store.commitTransition('run1', 0, flow.events.at(-1)!, admitted);
      const db = new Database(join(root, 'journal.sqlite'));
      if (corruption === 'intents') db.prepare('UPDATE journal SET intents = ?').run('[]');
      else if (corruption === 'input-hash') db.prepare('UPDATE journal SET input_checkpoint_hash = ?').run('0'.repeat(64));
      else db.exec('DELETE FROM journal');
      expect(() => store.readJournal('run1')).toThrow('JOURNAL_CORRUPT');
      db.close(); store.close();
    });
  }

  it('does not let a later round collection acknowledge an earlier clarification request', async () => {
    const { store, flow } = await fixture();
    flow.ready();
    flow.send('ADMIT_ROUND');
    flow.reviews([rawQuestion()]);
    flow.collect();
    for (let index = 0; index < flow.events.length; index++)
      store.commitTransition('run1', index, flow.events[index]!, flow.results[index]!);
    const first = flow.results.flatMap(r => r.intents).find(i => i.kind === 'question-batch-request')!;
    const collection = flow.events.at(-1)!;
    if (collection.body.kind !== 'COLLECT_QUESTIONS') throw new Error('Expected collection fixture');
    const batch = collection.body.data.batch;
    expect(() => store.recordEffectReceipt(first.key, { eventId: collection.id, value: batch as unknown as JsonValue }, flow.s.revision)).toThrow('UNACCEPTED_EFFECT_RECEIPT');
    expect(store.effectRecord(first.key).status).toBe('pending_execution');
    store.close();
  });
});
