import { expect, it } from 'vitest';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fixture } from '../orca/fixtures.js';
import { WorkerBridge } from '../../src/workers/bridge.js';
import { OrcaTransport } from '../../src/orca/transport.js';
import { originalPrepared, persistPrepared } from '../../src/runtime/reconcile.js';
import { verifyConfiguration } from '../../src/store/artifacts.js';

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
