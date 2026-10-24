import { expect, it } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fixture } from '../orca/fixtures.js';
import { WorkerBridge } from '../../src/workers/bridge.js';
import { OrcaTransport } from '../../src/orca/transport.js';
import { originalPrepared, persistPrepared } from '../../src/runtime/reconcile.js';
import { verifyConfiguration } from '../../src/store/artifacts.js';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { canonicalJson, hashArtifact } from '../../src/domain/hash.js';
import { evidenceResourcesSettled, markSemanticStarted, readExecutionProjection } from '../../src/runtime/reconcile.js';
import { inspectRun } from '../../src/cli/index.js';
import type { EffectIntent } from '../../src/domain/contracts.js';

it('recovers the original fenced launch and frozen preparation without another inference', async () => {
  const f = fixture(), root = f.store.artifacts.root.replace(/\/artifacts$/, ''), prepared = f.prepare();
  persistPrepared(root, prepared, f.store);
  const bridge = new WorkerBridge(f.store, new OrcaTransport(f.store, f.driver), f.now);
  const first = await bridge.dispatch(f.reservation, () => prepared);
  const recovered = await bridge.dispatch(f.reservation, () => originalPrepared(root, f.reservation.logicalTaskKey, f.store, 'run1'));
  expect(recovered?.binding).toEqual(first?.binding);
  expect(f.counts().launches).toBe(1);
  expect(originalPrepared(root, f.reservation.logicalTaskKey, f.store, 'run1')).toEqual(prepared); f.store.close();
});
it('verifies saved configuration artifacts independently of the original source file', () => {
  const f = fixture(), config = f.store.load('run1').context.config;
  expect(() => verifyConfiguration(config, f.store.artifacts.root)).not.toThrow();
  writeFileSync(config.rawArtifact.path, 'corrupt');
  expect(() => verifyConfiguration(config, f.store.artifacts.root)).toThrow(); f.store.close();
});

it('final fix holds orphaned outbox evidence with unknown origin and preserves start-marker uncertainty', () => {
  const f = fixture(), root = f.store.artifacts.root.replace(/\/artifacts$/, '');
  const before = f.store.load('run1');
  const intent: EffectIntent = { key: 'run1/orphan-evidence', kind: 'evidence', input: { id: 'orphan', claimId: 'claim', source: 'https://example.test/unknown', reason: 'Disposable corruption fixture' } };
  const db = new Database(join(root, 'journal.sqlite'));
  try {
    // Damage only the disposable outbox; accepted checkpoints and journal stay intact.
    db.prepare('INSERT INTO outbox (key, run_id, created_revision, intent, intent_hash, status, receipt, receipt_event_id) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)').run(intent.key, 'run1', before.revision, canonicalJson(intent), hashArtifact('effect', intent), 'pending_execution');
    expect(readExecutionProjection(root, 'run1').effects.find(effect => effect.key === intent.key)).toMatchObject({ reason: 'ORIGIN_UNKNOWN', derived: 'held' });
    expect(evidenceResourcesSettled(root, before)).toBe(false);
    markSemanticStarted(root, intent);
    expect(readExecutionProjection(root, 'run1').effects.find(effect => effect.key === intent.key)).toMatchObject({ derived: 'held_may_have_executed' });
    expect(inspectRun(root, 'run1').settlement).toBe('unverifiable');
    expect(f.store.load('run1')).toEqual(before);
    expect(f.counts().launches).toBe(0);
  } finally { db.close(); f.store.close(); }
});
