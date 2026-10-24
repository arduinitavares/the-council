import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createEvidenceCollector, createNodeEvidenceIO, readEvidenceReceipt } from '../../src/evidence/adapter.js';
import { openArtifactStore } from '../../src/store/artifacts.js';

it('denies outside, protected, aliased and artifact sources before retrieval without rejecting the whole checkout', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'evidence-scope-'))), outside = realpathSync(mkdtempSync(join(tmpdir(), 'evidence-outside-')));
  const secret = join(root, '.env'); writeFileSync(secret, 'secret'); symlinkSync(secret, join(root, 'alias'));
  const artifacts = openArtifactStore(join(root, 'artifacts')), saved = artifacts.putArtifact(Buffer.from('artifact'));
  const sources = [join(outside, 'external'), secret, join(root, 'alias'), saved.path];
  const collector = createEvidenceCollector({ sourceManifest: sources.map(address => ({ kind: 'source' as const, address, revision: 'r1' })), environment: {}, artifacts,
    retrieve: async () => { throw new Error('Unauthorized retrieval'); }, executeCheck: async () => { throw new Error('Unauthorized check'); } });
  for (const source of sources) expect((await collector.collectEvidence({ id: 'e1', claimId: 'c', source, reason: 'read' }, { sourceRoots: [root], allowedSourceAddresses: [], checks: [] })).status).toBe('unverified');
});

it('revalidates each redirect and stops at an unapproved target without following it', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'evidence-redirect-'))), address = 'https://approved.example/source';
  const artifacts = openArtifactStore(join(root, 'artifacts'));
  const collector = createEvidenceCollector({ sourceManifest: [{ kind: 'source', address, revision: 'r1' }], environment: {}, artifacts,
    retrieve: async ({ address: actual }) => { if (actual !== address) throw new Error('Forbidden redirect followed'); return { kind: 'redirect', address: 'https://unapproved.example/target', receiptId: 'redirect-receipt' }; },
    executeCheck: async () => { throw new Error('check'); } });
  const record = await collector.collectEvidence({ id: 'e1', claimId: 'c', source: address, reason: 'read' }, { sourceRoots: [root], allowedSourceAddresses: [address], checks: [] });
  expect(record.status).toBe('unverified');
  expect(readEvidenceReceipt(record, artifacts).hops).toEqual([{ address, receiptId: 'redirect-receipt' }]);
});

it('does not retry an affected source after an actual permission denial', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'evidence-denial-'))), source = 'https://approved.example/source', artifacts = openArtifactStore(join(root, 'artifacts'));
  let calls = 0;
  const collector = createEvidenceCollector({ sourceManifest: [{ kind: 'source', address: source, revision: 'r1' }], environment: {}, artifacts,
    retrieve: async () => { if (++calls > 1) throw new Error('Denial bypass'); return { kind: 'denied', reason: 'PERMISSION_DENIED', receiptId: 'denial' }; }, executeCheck: async () => { throw new Error('check'); } });
  const request = { id: 'e1', claimId: 'c', source, reason: 'read' }, scope = { sourceRoots: [root], allowedSourceAddresses: [source], checks: [] };
  expect((await collector.collectEvidence(request, scope)).status).toBe('unverified');
  const later = await collector.collectEvidence(request, scope);
  expect(readEvidenceReceipt(later, artifacts).uncertainty).toContain('AFFECTED_ACTION_DENIED');
});

it('the concrete local reader checks scope again after a symlink target changes', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'evidence-alias-'))), target = join(root, 'plain'); writeFileSync(target, 'safe');
  const secret = join(root, '.env'); writeFileSync(secret, 'secret');
  const scope = { sourceRoots: [root], allowedSourceAddresses: [], checks: [] };
  const io = createNodeEvidenceIO({ scope, environment: {}, maxBytes: 1024, timeoutMs: 1000 });
  symlinkSync(secret, join(root, 'later-alias'));
  const result = await io.retrieve({ address: join(root, 'later-alias'), expectedRevision: 'r1', maxBytes: 1024, timeoutMs: 1000 });
  expect(result.kind).toBe('denied');
});
