import { existsSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createEvidenceCollector, createNodeEvidenceIO, readEvidenceReceipt } from '../../src/evidence/adapter.js';
import { openArtifactStore } from '../../src/store/artifacts.js';
import type { RunScope } from '../../src/domain/contracts.js';
import { canonicalJson } from '../../src/domain/hash.js';
import { describeNodeCheckAdmission, type CheckRunnerQualification } from '../../src/evidence/adapter.js';

// TEST FIXTURE qualifications exercise real safe subprocess code paths. These
// synthetic receipts establish no production or host-wide containment qualification.
function fixtureAdmission(scope: RunScope, maxBytes: number, timeoutMs: number, change: (claim: CheckRunnerQualification) => void = () => {}) {
  const artifacts = openArtifactStore(join(scope.sourceRoots[0]!, 'fixture-qualifications'));
  const authority = artifacts.putArtifact(Buffer.from('TEST FIXTURE trusted admission authority; not production.'), 'check-authority');
  const containment = artifacts.putArtifact(Buffer.from('TEST FIXTURE no-detach observation; not a host qualification.'), 'check-containment');
  const admission = { artifacts, authority, qualifications: [] as import('../../src/domain/contracts.js').ArtifactRef[] };
  const options = { scope, environment: {}, maxBytes, timeoutMs, checkAdmission: admission };
  for (const check of scope.checks) for (const ms of new Set([timeoutMs, Math.min(timeoutMs, 100)])) {
    const claim: CheckRunnerQualification = { version: 1, id: `fixture-${check.id}-${ms}`, admission: describeNodeCheckAdmission(options, check, { maxBytes, timeoutMs: ms }), issuedAtMs: Date.now() - 1000, expiresAtMs: Date.now() + 60000, authority, containment: { kind: 'no-detach', receipt: containment }, observationReceipts: [containment] };
    change(claim);
    admission.qualifications.push(artifacts.putArtifact(Buffer.from(canonicalJson(claim)), 'check-runner-qualification'));
  }
  return options;
}

const fixtureIO = (scope: RunScope, maxBytes: number, timeoutMs: number) => createNodeEvidenceIO(fixtureAdmission(scope, maxBytes, timeoutMs));

it('executes one exact declared local subprocess and keeps provenance distinct from exit status', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'evidence-check-')));
  const check = { id: 'safe', argv: [process.execPath, '-e', 'process.stdout.write("check output"); process.exitCode = 3;'], cwd: root, declaredEffects: [], outputTargets: [] };
  const scope = { sourceRoots: [root], allowedSourceAddresses: [], checks: [check] }, artifacts = openArtifactStore(join(root, 'artifacts'));
  const io = fixtureIO(scope, 1024, 1000);
  const collector = createEvidenceCollector({ sourceManifest: [{ kind: 'check', address: 'check:safe', checkId: 'safe', revision: 'declared-v1' }], environment: {}, artifacts, ...io });
  const record = await collector.collectEvidence({ id: 'e1', claimId: 'c', source: 'check:safe', reason: 'run check' }, scope);
  expect(record.status).toBe('verified');
  const receipt = readEvidenceReceipt(record, artifacts);
  expect(receipt.command).toEqual(check);
  expect(receipt.exitCode).toBe(3);
  expect(receipt.checkPassed).toBe(false);
  expect(receipt.checkResource?.settlement).toBe('settled');
  expect(receipt.contentHash).toBe(record.contentHash);
  expect(Buffer.from(artifacts.readArtifact(receipt.stdout!)).toString()).toBe('check output');
});

it('stops and records a child that outlives a successful parent with closed stdio', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'evidence-child-')));
  const script = 'const { spawn } = require("node:child_process"); const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], { stdio: "ignore" }); process.stdout.write(String(child.pid)); child.unref();';
  const check = { id: 'child', argv: [process.execPath, '-e', script], cwd: root, declaredEffects: [], outputTargets: [] };
  const scope = { sourceRoots: [root], allowedSourceAddresses: [], checks: [check] }, artifacts = openArtifactStore(join(root, 'artifacts'));
  const io = fixtureIO(scope, 1024, 500);
  const collector = createEvidenceCollector({ sourceManifest: [{ kind: 'check', address: 'check:child', checkId: 'child', revision: 'v1' }], environment: {}, artifacts, ...io });
  const record = await collector.collectEvidence({ id: 'e-child', claimId: 'c', source: 'check:child', reason: 'observe lifecycle' }, scope);
  const receipt = readEvidenceReceipt(record, artifacts);
  const pid = Number(Buffer.from(artifacts.readArtifact(receipt.stdout!)).toString());
  try {
    expect(record.status).toBe('unverified');
    expect(receipt.checkResource).toMatchObject({ parentExitCode: 0, stopRequested: true, settlement: 'settled' });
    expect(() => process.kill(pid, 0)).toThrow();
  } finally { try { process.kill(pid, 'SIGKILL'); } catch { /* The asserted settled child is absent. */ } }
});

it('records stopped timeout resources and passes shell punctuation as literal argv', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'evidence-argv-')));
  const literal = 'literal;$(not-a-command)';
  const check = { id: 'argv', argv: [process.execPath, '-e', 'process.stdout.write(process.argv[1])', literal], cwd: root, declaredEffects: [], outputTargets: [] };
  const timeout = { ...check, id: 'timeout', argv: [process.execPath, '-e', 'setTimeout(() => {}, 10000)'] };
  const scope = { sourceRoots: [root], allowedSourceAddresses: [], checks: [check, timeout] };
  const io = fixtureIO(scope, 1024, 1000);
  const result = await io.executeCheck({ check, maxBytes: 1024, timeoutMs: 1000 });
  expect(result.kind).toBe('completed');
  if (result.kind === 'completed') expect(Buffer.from(result.stdout).toString()).toBe(literal);
  const expired = await io.executeCheck({ check: timeout, maxBytes: 1024, timeoutMs: 100 });
  expect(expired.kind).toBe('unverified');
  expect(expired.resource).toMatchObject({ stopRequested: true, settlement: 'settled' });
});

it('rejects command substitution, undeclared checks, changed cwd and broadened effects', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'evidence-check-scope-'))), artifacts = openArtifactStore(join(root, 'artifacts'));
  const check = { id: 'safe', argv: ['declared-tool', 'literal;$(not-shell)'], cwd: root, declaredEffects: [], outputTargets: [] };
  const scope = { sourceRoots: [root], allowedSourceAddresses: [], checks: [check] };
  const collector = createEvidenceCollector({ sourceManifest: [{ kind: 'check', address: 'check:safe', checkId: 'safe', revision: 'v1' }, { kind: 'check', address: 'check:missing', checkId: 'missing', revision: 'v1' }], environment: {}, artifacts,
    retrieve: async () => { throw new Error('source'); }, executeCheck: async ({ check: actual }) => ({ kind: 'completed', executed: { ...actual, declaredEffects: ['write'] }, stdout: Buffer.from(''), stderr: Buffer.from(''), exitCode: 0, receiptId: 'runner' }) });
  const result = await collector.collectEvidence({ id: 'e1', claimId: 'c', source: 'check:safe', reason: 'run' }, scope);
  expect(result.status).toBe('invalid');
  const missing = await collector.collectEvidence({ id: 'e2', claimId: 'c', source: 'check:missing', reason: 'run' }, scope);
  expect(missing.status).toBe('unverified');
  const io = createNodeEvidenceIO({ scope, environment: {}, maxBytes: 1024, timeoutMs: 1000 });
  expect((await io.executeCheck({ check: { ...check, cwd: '/tmp' }, maxBytes: 1024, timeoutMs: 1000 })).kind).toBe('denied');
});

it('bounds subprocess time and output and never certifies partial output', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'evidence-check-limit-')));
  const timeout = { id: 'timeout', argv: [process.execPath, '-e', 'setTimeout(() => {}, 10000)'], cwd: root, declaredEffects: [], outputTargets: [] };
  const overflow = { ...timeout, id: 'overflow', argv: [process.execPath, '-e', 'process.stdout.write("x".repeat(10000))'] };
  const scope = { sourceRoots: [root], allowedSourceAddresses: [], checks: [timeout, overflow] };
  const io = fixtureIO(scope, 64, 100);
  expect((await io.executeCheck({ check: timeout, maxBytes: 64, timeoutMs: 100 })).kind).toBe('unverified');
  expect((await io.executeCheck({ check: overflow, maxBytes: 64, timeoutMs: 1000 })).kind).toBe('unverified');
});

it('retains original unsettled check identity when a later request is stopped without retry', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'check-retained-'))), artifacts = openArtifactStore(join(root, 'artifacts'));
  const check = { id: 'unknown', argv: ['/declared/check'], cwd: root, declaredEffects: [], outputTargets: [] };
  const scope = { sourceRoots: [root], allowedSourceAddresses: [], checks: [check] };
  let calls = 0;
  const collector = createEvidenceCollector({ artifacts, environment: {}, sourceManifest: [{ kind: 'check', address: 'check:unknown', checkId: 'unknown', revision: 'v1' }],
    retrieve: async () => { throw new Error('source'); }, executeCheck: async () => {
      if (++calls > 1) throw new Error('Unsettled check retried');
      return { kind: 'unverified', reason: 'CHECK_RESOURCES_UNVERIFIABLE', receiptId: 'original', resource: { id: 'original', pid: 123, processGroupId: 123, startedAtMs: 10, parentExitCode: 0, parentSignal: null, settlement: 'unverifiable', stopRequested: true, settlementReceiptId: null } };
    } });
  const original = await collector.collectEvidence({ id: 'e1', claimId: 'c', source: 'check:unknown', reason: 'run' }, scope);
  const later = await collector.collectEvidence({ id: 'e2', claimId: 'c', source: 'check:unknown', reason: 'run' }, scope);
  const receipt = readEvidenceReceipt(later, artifacts);
  expect(receipt.checkResource?.id).toBe('original');
  expect(receipt.checkResourceState).toBe('unverifiable');
  expect(receipt.priorObservationReceipt).toBe(original.observationReceipt);
});

it('does not spawn a concrete check without existing containment qualification', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'check-unqualified-'))), marker = join(root, 'spawned');
  const check = { id: 'unqualified', argv: [process.execPath, '-e', 'require("node:fs").writeFileSync(process.argv[1], "started")', marker], cwd: root, declaredEffects: [], outputTargets: [] };
  const scope = { sourceRoots: [root], allowedSourceAddresses: [], checks: [check] };
  const io = createNodeEvidenceIO({ scope, environment: {}, maxBytes: 1024, timeoutMs: 1000 });
  const observation = await io.executeCheck({ check, maxBytes: 1024, timeoutMs: 1000 });
  expect(observation).toMatchObject({ kind: 'unverified', reason: 'CHECK_RUNNER_UNQUALIFIED', notStarted: true });
  const artifacts = openArtifactStore(join(root, 'artifacts'));
  const collector = createEvidenceCollector({ sourceManifest: [{ kind: 'check', address: 'check:unqualified', checkId: check.id, revision: 'v1' }], environment: {}, artifacts, ...io });
  const record = await collector.collectEvidence({ id: 'e1', claimId: 'c1', source: 'check:unqualified', reason: 'check admission' }, scope);
  expect(record.status).toBe('unverified');
  expect(readEvidenceReceipt(record, artifacts)).toMatchObject({ checkResourceState: 'none', uncertainty: ['CHECK_RUNNER_UNQUALIFIED'] });
  expect(existsSync(marker)).toBe(false);
});

it.each(['expired', 'host', 'runner', 'command', 'environment', 'scope', 'bounds', 'proof'] as const)('rejects %s qualification before a concrete execution', async mismatch => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'check-stale-'))), marker = join(root, 'spawned');
  const check = { id: 'guarded', argv: [process.execPath, '-e', 'require("node:fs").writeFileSync(process.argv[1], "started")', marker], cwd: root, declaredEffects: [], outputTargets: [] };
  const scope = { sourceRoots: [root], allowedSourceAddresses: [], checks: [check] };
  const options = fixtureAdmission(scope, 1024, 1000, claim => {
    if (mismatch === 'expired') claim.expiresAtMs = 1;
    if (mismatch === 'host') claim.admission.host = 'other-host';
    if (mismatch === 'runner') claim.admission.runner.implementationHash = '0'.repeat(64);
    if (mismatch === 'command') claim.admission.check.argv = ['/other-command'];
    if (mismatch === 'environment') claim.admission.environmentScopeHash = '0'.repeat(64);
    if (mismatch === 'scope') claim.admission.scopeHash = '0'.repeat(64);
    if (mismatch === 'bounds') claim.admission.maxBytes = 2048;
    if (mismatch === 'proof') claim.containment.receipt = { ...claim.containment.receipt, sha256: '0'.repeat(64) };
  });
  const result = await createNodeEvidenceIO(options).executeCheck({ check, maxBytes: 1024, timeoutMs: 1000 });
  expect(result).toMatchObject({ kind: 'unverified', reason: 'CHECK_RUNNER_UNQUALIFIED', notStarted: true });
  expect(existsSync(marker)).toBe(false);
});
