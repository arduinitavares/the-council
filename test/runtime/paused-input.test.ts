import { expect, it } from 'vitest';
import { fixture } from '../orca/fixtures.js';
import { openRunReader } from '../../src/store/run-store.js';

it('queues without the writer lease and keeps conflicting duplicate IDs out', async () => {
  const api = await import('../../src/runtime/inbox.js').catch(() => null);
  expect(api, 'Task7 durable control inbox is missing').not.toBeNull();
  const f = fixture(), root = f.store.artifacts.root.replace(/\/artifacts$/, '');
  const request = { kind: 'cancel' as const, requestId: 'cancel-one', runId: 'run1' };
  expect(await api!.submitControl(root, request)).toMatchObject({ status: 'queued', applied: false });
  expect(await api!.submitControl(root, request)).toMatchObject({ status: 'queued', duplicate: true });
  const reader = openRunReader(root);
  expect(reader.load('run1').revision).toBe(f.store.load('run1').revision);
  reader.close();
  expect(api!.readInbox(root)).toHaveLength(1);
  f.store.close();
});
