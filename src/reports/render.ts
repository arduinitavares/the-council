import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ArtifactRef, JsonValue, ModelSelection, ReviewerSeat, RunSnapshot, WorkerRole } from '../domain/contracts.js';
import { evaluateConsensus } from '../domain/consensus.js';
import { canonicalJson, hashArtifact } from '../domain/hash.js';
import { latestAnswers } from '../domain/questions.js';
import { artifactRefSchema, modelSelectionSchema, reviewerSeatSchema, runSnapshotSchema, workerRoleSchema } from '../domain/schemas.js';
import { evidenceReceiptSchema, freezeEvidenceBundle, type EvidenceReceipt } from '../evidence/adapter.js';
import { checkLanguageSurface, type LanguageFinding } from './language-profile.js';

export interface ObservedSettings { role: WorkerRole; requested: ModelSelection; exposed: ModelSelection | null; receiptId: string }
export interface ReportResource { id: string; status: 'live' | 'unverifiable' | 'settled'; receiptId: string }
export interface ReportInput {
  snapshot: RunSnapshot;
  candidate: { ref: ArtifactRef; bytes: Uint8Array } | null;
  settings: readonly ObservedSettings[];
  resources: readonly ReportResource[];
  alternatives: readonly { seat: ReviewerSeat; text: string }[];
  evidenceReceipts: readonly EvidenceReceipt[];
  blockers: readonly string[];
}
const nonempty = z.string().min(1);
export const reportInputSchema = z.strictObject({
  snapshot: runSnapshotSchema,
  candidate: z.strictObject({ ref: artifactRefSchema, bytes: z.instanceof(Uint8Array) }).nullable(),
  settings: z.array(z.strictObject({ role: workerRoleSchema, requested: modelSelectionSchema, exposed: modelSelectionSchema.nullable(), receiptId: nonempty })),
  resources: z.array(z.strictObject({ id: nonempty, status: z.enum(['live', 'unverifiable', 'settled']), receiptId: nonempty })),
  alternatives: z.array(z.strictObject({ seat: reviewerSeatSchema, text: nonempty })),
  evidenceReceipts: z.array(evidenceReceiptSchema), blockers: z.array(nonempty),
});
export interface ReportArtifacts {
  outcome: 'completed' | 'needs_user' | 'needs_context' | 'blocked' | 'cancelled';
  settlement: 'settled' | 'unverifiable';
  markdown: string;
  json: string;
  hash: string;
  languageFindings: readonly LanguageFinding[];
  languageProfile: { name: string; dictionaryVerified: false; certified: false; technicalCorrectnessChecked: false };
}

function artifactDigest(ref: ArtifactRef, bytes: Uint8Array): boolean {
  return ref.bytes === bytes.byteLength && createHash('sha256').update(`council:v1:${ref.kind}\n`).update(bytes).digest('hex') === ref.sha256;
}
function literal(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map(match => match[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}\n${text}\n${fence}`;
}
const structured = (value: unknown) => literal(JSON.stringify(value, null, 2));
const lines = (items: readonly string[]) => items.length ? items.map(item => `- ${item}`).join('\n') : 'None recorded.';

/** Renders accepted data only; no source reads, model calls, state changes, or votes. */
export function renderReport(raw: ReportInput): ReportArtifacts {
  const input = reportInputSchema.parse(raw);
  canonicalJson(input.snapshot);
  const snapshot = input.snapshot as RunSnapshot, c = snapshot.context;
  const frozen = c.control.candidate;
  let candidateText: string | null = null;
  if (frozen) {
    if (frozen.hash !== frozen.text.sha256 || !input.candidate || canonicalJson(input.candidate.ref) !== canonicalJson(frozen.text) || !artifactDigest(frozen.text, input.candidate.bytes)) throw new Error('REPORT_CANDIDATE_MISMATCH');
    candidateText = Buffer.from(input.candidate.bytes).toString('utf8');
    if (!Buffer.from(candidateText).equals(Buffer.from(input.candidate.bytes))) throw new Error('REPORT_CANDIDATE_NOT_UTF8');
  } else if (input.candidate !== null) throw new Error('REPORT_CANDIDATE_UNBOUND');

  if (new Set(input.resources.map(resource => resource.id)).size !== input.resources.length) throw new Error('DUPLICATE_REPORT_RESOURCE');
  for (const setting of input.settings) {
    const configured = setting.role === 'judge' ? c.config.resolved.judge : c.config.resolved.reviewers[setting.role];
    if (canonicalJson(setting.requested) !== canonicalJson(configured)) throw new Error('REPORT_REQUESTED_SETTINGS_MISMATCH');
  }
  const receiptIds = new Set<string>();
  for (const receipt of input.evidenceReceipts) {
    const record = c.control.evidence.find(record => record.requestId === receipt.request.id);
    if (!record || receiptIds.has(record.requestId)) throw new Error('REPORT_EVIDENCE_RECEIPT_MISMATCH');
    const ref = artifactRefSchema.parse(JSON.parse(record.observationReceipt));
    if (ref.kind !== 'evidence-receipt' || !artifactDigest(ref, Buffer.from(canonicalJson(receipt))) || record.status !== receipt.status || record.contentHash !== receipt.contentHash || record.sourceLocation !== receipt.sourceLocation || receipt.scopeHash !== hashArtifact('evidence-scope', c.request.scope as unknown as JsonValue)) throw new Error('REPORT_EVIDENCE_RECEIPT_MISMATCH');
    receiptIds.add(record.requestId);
  }
  const evidenceBundle = freezeEvidenceBundle(c.control.evidence, []);
  const answerView = latestAnswers(c.questionLedger);
  const missingEvidence = c.requiredEvidenceIds.filter(id => !c.control.evidence.some(record => record.requestId === id && (record.status === 'verified' || record.status === 'not_applicable')));
  const unavailableReceiptDetails = c.control.evidence.filter(record => !receiptIds.has(record.requestId)).map(record => record.requestId);
  const evidenceChecks = input.evidenceReceipts.filter(receipt => receipt.command !== null).map(receipt => ({ requestId: receipt.request.id, state: receipt.checkResourceState, resource: receipt.checkResource }));
  const owned = Object.entries(c.issuedLogicalTasks).map(([id, task]) => {
    const unissued = task.stage === 'pending_execution' && task.binding === null &&
      id === task.reservation.logicalTaskKey && !Object.hasOwn(c.control.workerDeadlines, id);
    return { id, stage: task.stage, status: task.settlement, authority: task.binding?.authority ?? null,
      physicalState: unissued ? 'reserved_unissued' : task.stage !== 'pending_execution' && task.binding !== null ? 'issued' : 'inconsistent' };
  });
  const settlement: ReportArtifacts['settlement'] = !unavailableReceiptDetails.length && owned.every(resource => resource.physicalState === 'reserved_unissued' || resource.physicalState === 'issued' && resource.status === 'settled') && input.resources.every(resource => resource.status === 'settled') && evidenceChecks.every(check => check.state !== 'unverifiable') ? 'settled' : 'unverifiable';
  const confirmation = c.control.confirmation;
  const consensus = confirmation ? evaluateConsensus(confirmation) : { kind: 'unresolved' as const, reasons: ['NO_ACCEPTED_CONFIRMATION'] };
  const expected = frozen && c.control.evidenceHash && c.control.judgeHash ? {
    runId: c.request.runId, configHash: c.config.configHash, profileHash: c.profile.profileHash,
    contextHash: c.sharedContext.contextHash, round: c.roundsUsed, candidateHash: frozen.hash,
    evidenceHash: c.control.evidenceHash, judgeHash: c.control.judgeHash,
  } : null;
  const judge = c.control.judge;
  const confirmationBound = confirmation !== null && expected !== null && c.control.judge !== null &&
    canonicalJson(confirmation.expected) === canonicalJson(expected) && canonicalJson(confirmation.config) === canonicalJson(c.config.resolved) &&
    canonicalJson(confirmation.candidate) === canonicalJson(frozen) && canonicalJson(confirmation.ballots) === canonicalJson(c.ballots) &&
    canonicalJson(confirmation.objections) === canonicalJson(c.objections) && canonicalJson(confirmation.questionLedger) === canonicalJson(c.questionLedger) &&
    (['openai', 'gemini', 'claude'] as const).every(seat => c.expectedAttempts[seat] && canonicalJson(confirmation.expectedAttempts[seat]) === canonicalJson(c.expectedAttempts[seat])) &&
    canonicalJson(confirmation.judgeChallengeIds) === canonicalJson(c.control.judge.challenges.map(challenge => challenge.id)) &&
    judge !== null && canonicalJson(judge.bindings) === canonicalJson({ runId: expected.runId, configHash: expected.configHash, profileHash: expected.profileHash, contextHash: expected.contextHash, round: expected.round, candidateHash: expected.candidateHash, evidenceHash: expected.evidenceHash }) &&
    Object.entries(judge.bindings).every(([key, value]) => judge.binding[key as keyof typeof judge.binding] === value) &&
    canonicalJson(judge.binding.configured) === canonicalJson(c.config.resolved.judge) &&
    (!c.expectedAttempts.judge || canonicalJson(judge.binding) === canonicalJson(c.expectedAttempts.judge));
  const blockers = [...input.blockers, ...(c.inferenceBlock ? [c.inferenceBlock] : []), ...(settlement === 'unverifiable' ? ['RESOURCES_NOT_POSITIVELY_SETTLED'] : []),
    ...(c.control.evidenceHash !== null && evidenceBundle.hash !== c.control.evidenceHash ? ['EVIDENCE_BUNDLE_DRIFT'] : []),
    ...(snapshot.state === 'completed' ? c.requiredEvidenceIds.filter(id => !c.control.evidence.some(record => record.requestId === id)).map(id => `REQUIRED_EVIDENCE_MISSING:${id}`) : []),
    ...(snapshot.state === 'completed' ? missingEvidence.filter(id => !frozen?.acknowledgedUnverifiedEvidenceIds.includes(id)).map(id => `REQUIRED_EVIDENCE_UNACKNOWLEDGED:${id}`) : []),
    ...input.evidenceReceipts.filter(receipt => receipt.denied).map(receipt => `EVIDENCE_ACTION_DENIED:${receipt.request.id}`),
    ...input.settings.filter(setting => setting.exposed !== null && canonicalJson(setting.requested) !== canonicalJson(setting.exposed)).map(setting => `EXPOSED_SETTINGS_MISMATCH:${setting.role}`)];
  let outcome: ReportArtifacts['outcome'];
  if (snapshot.state === 'cancelled' || c.pendingOutcome === 'cancelled') outcome = 'cancelled';
  else if (snapshot.state === 'blocked' || c.pendingOutcome === 'blocked' || blockers.length) outcome = 'blocked';
  else if (snapshot.state === 'needs_context' || c.pendingOutcome === 'needs_context') outcome = 'needs_context';
  else if (snapshot.state === 'completed' && consensus.kind === 'unanimous' && confirmationBound) outcome = 'completed';
  else if (snapshot.state === 'completed') { outcome = 'blocked'; blockers.push('COMPLETED_CONSENSUS_NOT_VERIFIED'); }
  else if (snapshot.state === 'needs_user' || c.pendingOutcome === 'needs_user') outcome = 'needs_user';
  else { outcome = 'blocked'; blockers.push('RUN_NOT_AT_TERMINAL_OR_PAUSE_STATE'); }
  const form = outcome === 'completed' ? 'consensus' : outcome === 'cancelled' ? 'cancellation' : outcome === 'needs_user' ? 'unresolved disagreement' : 'operational blocker';
  const mapping = (['openai', 'gemini', 'claude', 'judge'] as const).map(role => ({
    role, configured: role === 'judge' ? c.config.resolved.judge : c.config.resolved.reviewers[role],
    requests: Object.values(c.issuedLogicalTasks).filter(task => task.reservation.role === role).map(task => ({ logicalTaskKey: task.reservation.logicalTaskKey, requested: task.reservation.requested, authority: task.binding?.authority ?? null })),
    observations: input.settings.filter(setting => setting.role === role),
    exposure: input.settings.some(setting => setting.role === role && setting.exposed !== null) ? 'See receipt-backed observations.' : 'provider-managed; not exposed',
  }));
  const languageProfile = { name: 'Issue 9-oriented scoped surface profile', dictionaryVerified: false, certified: false, technicalCorrectnessChecked: false } as const;
  const data = {
    version: 1, runId: c.request.runId, outcome, form, state: snapshot.state, pendingOutcome: c.pendingOutcome, settlement, consensus, confirmationBound,
    candidate: frozen, candidateText, ballots: c.ballots, alternatives: input.alternatives, objections: c.objections,
    questions: c.questionLedger.questions, answers: c.questionLedger.answers, userDirections: c.sharedContext.userDirections,
    evidence: c.control.evidence, evidenceReceipts: input.evidenceReceipts, missingEvidence, unavailableReceiptDetails,
    judge: c.control.judge, judgeAssessmentsAre: 'model judgment', blockers, mapping,
    resources: { accepted: owned, observed: input.resources, evidenceChecks },
    counts: { clarificationBatches: c.clarificationBatchesUsed, rounds: c.roundsUsed, callsReserved: c.callsReserved, limits: c.effectiveLimits },
    budget: c.activeBudget, hashes: { config: c.config.configHash, profile: c.profile.profileHash, context: c.sharedContext.contextHash, candidate: frozen?.hash ?? null, evidence: c.control.evidenceHash, judge: c.control.judgeHash },
    languageProfile, acceptedSnapshot: snapshot,
  };
  const questions = c.questionLedger.questions.map(question => [
    `### ${question.id}`, literal(question.text),
    structured({ disposition: question.disposition, blocking: question.blocking, status: answerView.get(question.id)?.status ?? 'unanswered', reason: question.reason, origin: question.origin, dependencyIds: question.dependencyIds, answerForm: question.answerForm }),
    'Answer history:', structured(c.questionLedger.answers.filter(answer => answer.questionId === question.id)),
  ].join('\n\n')).join('\n\n') || 'No shared questions recorded.';
  const sections: [string, string][] = [
    ['Decision', `Report form: ${form}.\nOutcome: ${outcome}.\nAccepted state: ${snapshot.state}.\nPending outcome: ${c.pendingOutcome ?? 'none'}.\nResource settlement: ${settlement}.\n\n${structured(consensus)}`],
    ['Candidate', candidateText === null ? 'No frozen candidate recorded.' : literal(candidateText)],
    ['Assumptions', lines(frozen?.assumptions ?? [])],
    ['Tradeoffs', lines(frozen?.tradeoffs ?? [])],
    ['Uncertainty', lines(frozen?.unresolvedUncertainty ?? [])],
    ['Alternatives', structured(input.alternatives)],
    ['Objections and owners', structured(c.objections)],
    ['Judge assessments and challenges', `Each assessment is a model judgment with reasons. Verified provenance does not establish claim support.\n\n${structured(c.control.judge)}`],
    ['Evidence observations and receipts', structured({ records: c.control.evidence, receipts: input.evidenceReceipts, missingEvidence, unavailableReceiptDetails })],
    ['Shared questions and answers', questions],
    ['User directions', `User directions remain context records. They do not create reviewer votes.\n\n${structured(c.sharedContext.userDirections)}`],
    ['Reviewer ballots', structured(c.ballots)],
    ['Counts and remaining active budget', `Clarification batches: ${c.clarificationBatchesUsed} / ${c.effectiveLimits.maxClarificationBatches}.\nRounds: ${c.roundsUsed} / ${c.effectiveLimits.maxRounds}.\nWorker calls reserved: ${c.callsReserved} / ${c.effectiveLimits.maxWorkerCalls}.\nRemaining active budget: ${c.activeBudget.remainingMs} ms (${c.activeBudget.status}).`],
    ['Frozen hashes', structured(data.hashes)],
    ['Stable seats and requested/exposed settings', structured(mapping)],
    ['Actual resource state', structured(data.resources)],
    ['Operational blockers', lines(blockers)],
    ['Language profile', 'Issue 9-oriented surface diagnostics are advisory. Dictionary verification and technical correctness are outside this profile. This report has no ASD certification.'],
  ];
  const markdown = `# Council decision: ${c.request.topic}\n\n${sections.map(([heading, content]) => `## ${heading}\n\n${content}`).join('\n\n')}\n`;
  const json = canonicalJson(data);
  return { outcome, settlement, markdown, json, hash: hashArtifact('council-report', JSON.parse(json) as JsonValue), languageProfile, languageFindings: checkLanguageSurface(markdown, 'description') };
}
