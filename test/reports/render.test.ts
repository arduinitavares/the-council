import { expect, it } from 'vitest';
import { checkLanguageSurface } from '../../src/reports/language-profile.js';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderReport } from '../../src/reports/render.js';
import { createEvidenceCollector, freezeEvidenceBundle, readEvidenceReceipt } from '../../src/evidence/adapter.js';
import { openArtifactStore } from '../../src/store/artifacts.js';
import { createInitialSnapshot } from '../../src/machine/reduce.js';
import { request } from '../machine/helpers.js';
import { H, config, makeBallot, makeBinding, makeConfirmation, makeObjection, makeQuestion } from '../fixtures/builders.js';

function reportInput() {
  const artifacts = openArtifactStore(join(realpathSync(mkdtempSync(join(tmpdir(), 'council-report-'))), 'artifacts'));
  const content = Buffer.from('Use the exact `/tmp/source.ts` candidate.');
  const ref = artifacts.putArtifact(content, 'candidate'), snapshot = createInitialSnapshot(request());
  const evidenceHash = freezeEvidenceBundle([], []).hash;
  const candidate = { text: ref, hash: ref.sha256, assumptions: ['Assumption: the source remains available.'], tradeoffs: ['Lower cost may increase latency.'], unresolvedUncertainty: ['The external result remains unknown.'], acknowledgedUnverifiedEvidenceIds: [] };
  const ballots = (['openai', 'gemini', 'claude'] as const).map(seat => makeBallot(seat, { bindings: { ...makeBallot(seat).bindings, candidateHash: ref.sha256, evidenceHash }, binding: makeBinding(seat, { candidateHash: ref.sha256, evidenceHash }) }));
  const confirmation = makeConfirmation({ candidate, ballots, expected: ballots[0]!.bindings, expectedAttempts: { openai: ballots[0]!.binding, gemini: ballots[1]!.binding, claude: ballots[2]!.binding } });
  snapshot.state = 'completed'; snapshot.context.pendingOutcome = 'completed'; snapshot.context.roundsUsed = 1; snapshot.context.callsReserved = 10;
  snapshot.context.activeBudget = { ...snapshot.context.activeBudget, status: 'settled', deadline: null };
  snapshot.context.ballots = ballots; snapshot.context.control.candidate = candidate; snapshot.context.control.confirmation = confirmation;
  snapshot.context.expectedAttempts = confirmation.expectedAttempts;
  snapshot.context.control.evidenceHash = evidenceHash; snapshot.context.control.judgeHash = H;
  snapshot.context.control.judge = { kind: 'judge', bindings: { runId: 'run1', configHash: H, profileHash: H, contextHash: H, round: 1, candidateHash: ref.sha256, evidenceHash }, assessments: [{ claimId: 'c1', status: 'supported', evidenceIds: [], reason: 'Judge reasoning only.' }], challenges: [{ id: 'challenge1', claimId: 'c1', text: 'Explain the uncertainty.', evidenceIds: [] }], methodIds: [], binding: makeBinding('openai', { role: 'judge', phase: 'judge', requested: config.judge, configured: config.judge, candidateHash: ref.sha256, evidenceHash }) };
  return { snapshot, candidate: { ref, bytes: content }, settings: [], resources: [], alternatives: [{ seat: 'gemini' as const, text: 'Keep the current design.' }], evidenceReceipts: [], blockers: [] };
}

it('renders accepted consensus with assumptions, uncertainty, alternatives and model-only claim assessments', () => {
  const input = reportInput(), report = renderReport(input);
  expect(report.outcome).toBe('completed');
  for (const literal of ['Assumption', 'The external result remains unknown.', '/tmp/source.ts', 'Keep the current design.', 'Judge reasoning only.', 'model judgment', 'provider-managed; not exposed', '10800000', H]) expect(report.markdown).toContain(literal);
  expect(report.languageProfile.dictionaryVerified).toBe(false);
  expect(report.languageProfile.certified).toBe(false);
  expect(JSON.parse(report.json).outcome).toBe('completed');
});

it('refuses consensus with substituted accepted attempts or mismatched exposed settings', () => {
  const input = reportInput();
  input.snapshot.context.expectedAttempts = {};
  expect(renderReport(input).outcome).toBe('blocked');
  const fresh = reportInput();
  expect(renderReport({ ...fresh, settings: [{ role: 'openai', requested: config.reviewers.openai, exposed: { ...config.reviewers.openai, model: 'unexpected-model' }, receiptId: 'actual-settings' }] }).outcome).toBe('blocked');
});

it('reports unresolved disagreement at round three as needs_user and preserves objection ownership', () => {
  const input = reportInput(); input.snapshot.state = 'needs_user'; input.snapshot.context.pendingOutcome = null; input.snapshot.context.roundsUsed = 3;
  input.snapshot.context.objections = [makeObjection()]; input.snapshot.context.control.confirmation = null;
  const report = renderReport(input);
  expect(report.outcome).toBe('needs_user');
  expect(report.markdown).toContain('openai'); expect(report.markdown).toContain('Missing evidence');
  expect(report.markdown).toContain('3 / 3');
});

it('includes every question and historical answer with provenance/status and keeps user directions outside votes', () => {
  const input = reportInput(), q = makeQuestion();
  input.snapshot.context.questionLedger.questions = [q];
  input.snapshot.context.questionLedger.answers = [{ id: 'a1', questionId: q.id, status: 'unknown', value: null, source: { author: 'user', receiptId: 'answer-original' }, evidenceIds: [] }, { id: 'a2', questionId: q.id, supersededAnswerId: 'a1', status: 'answered', value: 'Exact /tmp/value', source: { author: 'user', receiptId: 'answer-revision' }, evidenceIds: [] }];
  input.snapshot.context.sharedContext.userDirections = [input.candidate.ref];
  const report = renderReport(input);
  for (const value of [q.text, 'unknown', 'answered', 'answer-original', 'answer-revision', 'Exact /tmp/value', 'deferred']) expect(report.markdown).toContain(value);
  expect(JSON.parse(report.json).ballots).toHaveLength(3);
});

it('shows operational blockers and actual unsettled resources even when a caller claims completed state', () => {
  const input = reportInput();
  const report = renderReport({ ...input, resources: [{ id: 'resource-1', status: 'unverifiable', receiptId: 'observed-resource' }], blockers: ['OWNERSHIP_UNKNOWN'] });
  expect(report.outcome).toBe('blocked');
  expect(report.settlement).toBe('unverifiable');
  expect(report.markdown).toContain('OWNERSHIP_UNKNOWN'); expect(report.markdown).toContain('resource-1');
});

it('renders cancellation without creating a vote or claiming resource settlement', () => {
  const input = reportInput(); input.snapshot.state = 'cancelled'; input.snapshot.context.pendingOutcome = 'cancelled'; input.snapshot.context.control.confirmation = null;
  const report = renderReport({ ...input, resources: [{ id: 'worker', status: 'live', receiptId: 'live-observation' }] });
  expect(report.outcome).toBe('cancelled'); expect(report.settlement).toBe('unverifiable');
  expect(report.markdown).toContain('live-observation');
});

it('rejects rendered candidate substitution and does not accept a malformed completed consensus', () => {
  const input = reportInput();
  expect(() => renderReport({ ...input, candidate: { ...input.candidate, bytes: Buffer.from('Substituted decision') } })).toThrow('REPORT_CANDIDATE_MISMATCH');
  input.snapshot.context.control.confirmation = null;
  expect(renderReport(input).outcome).toBe('blocked');
});

it('keeps an unsettled evidence check visible even after all reviewer tasks settle', async () => {
  const input = reportInput(), root = realpathSync(mkdtempSync(join(tmpdir(), 'report-check-resource-'))), artifacts = openArtifactStore(join(root, 'artifacts'));
  const check = { id: 'unknown', argv: ['/declared/check'], cwd: root, declaredEffects: [], outputTargets: [] };
  const scope = { sourceRoots: [root], allowedSourceAddresses: [], checks: [check] };
  const collector = createEvidenceCollector({ artifacts, environment: {}, sourceManifest: [{ kind: 'check', address: 'check:unknown', checkId: 'unknown', revision: 'v1' }],
    retrieve: async () => { throw new Error('source'); }, executeCheck: async () => ({ kind: 'unverified', reason: 'CHECK_RESOURCES_UNVERIFIABLE', receiptId: 'check-original', resource: { id: 'check-original', pid: 123, processGroupId: 123, startedAtMs: 100, parentExitCode: 0, parentSignal: null, settlement: 'unverifiable', stopRequested: true, settlementReceiptId: null } }) });
  const record = await collector.collectEvidence({ id: 'e1', claimId: 'c1', source: 'check:unknown', reason: 'check lifecycle' }, scope);
  input.snapshot.context.control.evidence = [record];
  input.snapshot.context.request.scope = scope;
  const report = renderReport({ ...input, evidenceReceipts: [readEvidenceReceipt(record, artifacts)] });
  expect(report.outcome).toBe('blocked');
  expect(report.settlement).toBe('unverifiable');
  expect(report.markdown).toContain('check-original');
});

it('refuses old ballots after an observed evidence bundle changes', async () => {
  const input = reportInput(), root = realpathSync(mkdtempSync(join(tmpdir(), 'report-drift-'))), artifacts = openArtifactStore(join(root, 'artifacts'));
  const address = 'https://approved.example/source', scope = { sourceRoots: [root], allowedSourceAddresses: [address], checks: [] };
  const collector = createEvidenceCollector({ artifacts, environment: {}, sourceManifest: [{ kind: 'source', address, revision: 'v1' }],
    retrieve: async () => ({ kind: 'observed', bytes: Buffer.from('New source bytes.'), revision: 'v1', receiptId: 'changed-source' }), executeCheck: async () => { throw new Error('check'); } });
  const record = await collector.collectEvidence({ id: 'e1', claimId: 'c1', source: address, reason: 'source drift' }, scope);
  input.snapshot.context.control.evidence = [record]; input.snapshot.context.request.scope = scope;
  const report = renderReport({ ...input, evidenceReceipts: [readEvidenceReceipt(record, artifacts)] });
  expect(report.outcome).toBe('blocked');
  expect(report.markdown).toContain('EVIDENCE_BUNDLE_DRIFT');
});

it('does not let unanimous ballots or an evidence acknowledgement waive an actual denial', async () => {
  const input = reportInput(), root = realpathSync(mkdtempSync(join(tmpdir(), 'report-denial-'))), artifacts = openArtifactStore(join(root, 'artifacts'));
  const address = 'https://approved.example/source', scope = { sourceRoots: [root], allowedSourceAddresses: [address], checks: [] };
  const collector = createEvidenceCollector({ artifacts, environment: {}, sourceManifest: [{ kind: 'source', address, revision: 'v1' }],
    retrieve: async () => ({ kind: 'denied', reason: 'PERMISSION_DENIED', receiptId: 'actual-denial' }), executeCheck: async () => { throw new Error('check'); } });
  const record = await collector.collectEvidence({ id: 'e1', claimId: 'c1', source: address, reason: 'read' }, scope);
  const c = input.snapshot.context, hash = freezeEvidenceBundle([record], []).hash;
  c.request.scope = scope; c.requiredEvidenceIds = ['e1']; c.control.evidence = [record]; c.control.evidenceHash = hash;
  c.control.candidate!.acknowledgedUnverifiedEvidenceIds = ['e1'];
  c.control.confirmation!.expected.evidenceHash = hash; c.control.judge!.bindings.evidenceHash = hash;
  for (const ballot of c.ballots) { ballot.bindings.evidenceHash = hash; ballot.binding.evidenceHash = hash; }
  const report = renderReport({ ...input, evidenceReceipts: [readEvidenceReceipt(record, artifacts)] });
  expect(report.outcome).toBe('blocked');
  expect(report.markdown).toContain('EVIDENCE_ACTION_DENIED:e1');
});

it('flags sentences above the separate description and procedure targets', () => {
  const sentence = `${Array.from({ length: 21 }, () => 'word').join(' ')}.`;
  expect(checkLanguageSurface(sentence, 'description')).toEqual([]);
  expect(checkLanguageSurface(sentence, 'procedure').map(f => f.code)).toContain('SENTENCE_LENGTH');
  expect(checkLanguageSurface(`${sentence.slice(0, -1)} word word word word word.`, 'description').map(f => f.code)).toContain('SENTENCE_LENGTH');
});

it('keeps protected code, paths, URLs and identifiers outside prose diagnostics', () => {
  const literals = '```sh\nThe item was verified; do not rewrite.\n```\n`The item was verified;` https://example.com/was-verified /tmp/was-verified.txt evidence_record';
  expect(checkLanguageSurface(literals, 'procedure')).toEqual([]);
  expect(checkLanguageSurface('The report was verified by the judge.', 'description').map(f => f.code)).toContain('PASSIVE_VOICE');
});

it('treats nested backticks and unclosed fenced code as protected literals', () => {
  const code = '````md\n```\nThe item was verified; do not rewrite.\n```\n````\n';
  expect(checkLanguageSurface(code, 'procedure')).toEqual([]);
  expect(checkLanguageSurface('```\nThe item was verified; do not rewrite.', 'procedure')).toEqual([]);
});

it('reports inconsistent governed terms as advice without changing the text', () => {
  const text = 'The voter accepts the proposal; the evidence is certified.';
  const findings = checkLanguageSurface(text, 'description');
  expect(findings.map(f => f.code)).toContain('TERM_CONSISTENCY');
  expect(findings.map(f => f.code)).toContain('SEMICOLON');
  expect(findings.every(f => f.severity === 'advisory')).toBe(true);
  expect(text).toBe('The voter accepts the proposal; the evidence is certified.');
});
