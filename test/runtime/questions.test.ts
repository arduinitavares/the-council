import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { fixture } from '../orca/fixtures.js';
import { readInbox, submitControl } from '../../src/runtime/inbox.js';

it('rejects stale candidate input and conflicting duplicate request IDs before enqueue', async () => {
  const f = fixture(), root = f.store.artifacts.root.replace(/\/artifacts$/, '');
  await submitControl(root, { kind: 'cancel', requestId: 'one', runId: 'run1' });
  await expect(submitControl(root, { kind: 'context_update', requestId: 'one', runId: 'run1', update: { requestId: 'one', runId: 'run1', baseContextHash: f.store.load('run1').context.sharedContext.contextHash, userDirections: [f.store.artifacts.putArtifact(Buffer.from('Direction'), 'user-direction')] } })).rejects.toThrow('CONTROL_ID_CONFLICT');
  await expect(submitControl(root, { kind: 'candidate', requestId: 'candidate', runId: 'run1', round: 1, baseContextHash: 'a'.repeat(64), evidenceHash: 'b'.repeat(64), candidate: { text: 'Text', assumptions: [], tradeoffs: [], unresolvedUncertainty: [], acknowledgedUnverifiedEvidenceIds: [] } })).rejects.toThrow('STALE_CANDIDATE');
  expect(readInbox(root)).toHaveLength(1); f.store.close();
});
it('rejects machine context updates during a frozen clarification wave without changing its reservations', async () => {
  const f = fixture(), root = f.store.artifacts.root.replace(/\/artifacts$/, ''), before = f.store.load('run1');
  await expect(submitControl(root, { kind: 'context_update', requestId: 'new-direction', runId: 'run1', update: { requestId: 'new-direction', runId: 'run1', baseContextHash: before.context.sharedContext.contextHash, userDirections: [f.store.artifacts.putArtifact(Buffer.from('Direction'), 'user-direction')] } })).rejects.toThrow('CONTEXT_UPDATE_DURING_CLARIFICATION');
  expect(readdirSync(join(root, 'inbox', 'rejected'))).toHaveLength(1);
  expect(f.store.load('run1')).toEqual(before); f.store.close();
});
