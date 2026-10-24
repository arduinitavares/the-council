import type { ConfirmationContext, ConsensusDecision, ReviewerSeat } from './contracts.js';
import { canonicalJson } from './hash.js';
import { applyOwnedDispositions } from './objections.js';
import { unresolvedBlockingQuestions } from './questions.js';
import { confirmationContextSchema } from './schemas.js';

const seats: readonly ReviewerSeat[] = ['openai', 'gemini', 'claude'];

export function evaluateConsensus(context: ConfirmationContext): ConsensusDecision {
  const parsed = confirmationContextSchema.safeParse(context);
  if (!parsed.success) return { kind: 'unresolved', reasons: ['INVALID_CONFIRMATION_CONTEXT'] };
  const reasons: string[] = [];
  if (context.ballots.length !== seats.length || new Set(context.ballots.map(ballot => ballot.seat)).size !== seats.length) reasons.push('EXACT_REVIEWER_ROSTER_REQUIRED');
  if (new Set(seats.map(seat => context.expectedAttempts[seat].attemptId)).size !== seats.length || new Set(seats.map(seat => context.expectedAttempts[seat].logicalTaskKey)).size !== seats.length) reasons.push('DISTINCT_REVIEWER_ATTEMPTS_REQUIRED');
  if (context.candidate.hash !== context.expected.candidateHash) reasons.push('CANDIDATE_HASH_MISMATCH');
  if (context.questionLedger.contextHash !== context.expected.contextHash) reasons.push('QUESTION_CONTEXT_MISMATCH');
  if (new Set(context.judgeChallengeIds).size !== context.judgeChallengeIds.length) reasons.push('DUPLICATE_JUDGE_CHALLENGE');
  for (const seat of seats) {
    const ballot = context.ballots.find(item => item.seat === seat);
    if (!ballot) { reasons.push(`MISSING_BALLOT:${seat}`); continue; }
    if (ballot.decision !== 'accept' || ballot.conditional) reasons.push(`UNCONDITIONAL_ACCEPTANCE_REQUIRED:${seat}`);
    if (canonicalJson(ballot.bindings) !== canonicalJson(context.expected)) reasons.push(`BALLOT_TARGET_MISMATCH:${seat}`);
    const binding = ballot.binding;
    if (binding.role !== seat || binding.phase !== 'ballot' || canonicalJson(binding) !== canonicalJson(context.expectedAttempts[seat])) reasons.push(`ATTEMPT_MISMATCH:${seat}`);
    for (const [key, value] of Object.entries(context.expected)) if (binding[key as keyof typeof binding] !== value) reasons.push(`ATTEMPT_TARGET_MISMATCH:${seat}:${key}`);
    if (canonicalJson(binding.requested) !== canonicalJson(context.config.reviewers[seat])) reasons.push(`CONFIGURED_MAPPING_MISMATCH:${seat}`);
    const responses = new Map(ballot.challengeResponses.map(response => [response.challengeId, response]));
    if (responses.size !== ballot.challengeResponses.length || [...responses.keys()].some(id => !context.judgeChallengeIds.includes(id)) || context.judgeChallengeIds.some(id => !responses.has(id))) reasons.push(`CHALLENGE_RESPONSE_REQUIRED:${seat}`);
    if (ballot.newObjections.length) reasons.push(`NEW_OBJECTION:${seat}`);
    // New ballot questions require publication by the controller, even if nonblocking.
    if (ballot.missingInputQuestions.length) reasons.push(`NEW_INPUT_QUESTION:${seat}`);
  }
  try {
    const ledger = applyOwnedDispositions(context);
    if (ledger.some(objection => objection.status === 'open')) reasons.push('OPEN_OBJECTION');
  } catch (error) { reasons.push(`INVALID_OBJECTION_DISPOSITION:${error instanceof Error ? error.message : 'unknown'}`); }
  try {
    if (unresolvedBlockingQuestions(context.questionLedger).length) reasons.push('UNRESOLVED_BLOCKING_QUESTION');
  } catch { reasons.push('INVALID_QUESTION_LEDGER'); }
  return reasons.length ? { kind: 'unresolved', reasons: [...new Set(reasons)] } : { kind: 'unanimous' };
}
