import type { AttemptBinding, Ballot, ConfirmationContext, CouncilConfig, Objection, Question, QuestionLedger, RawQuestion, ReviewerSeat, RoundBindings, ClockReceipt, ActiveBudget } from '../../src/domain/contracts.js';

export const H = 'a'.repeat(64);
export const OTHER = 'b'.repeat(64);
export const config: CouncilConfig = {
  version: 1,
  reviewers: {
    openai: { route: 'codex', model: 'openai-model', effort: 'high' },
    gemini: { route: 'antigravity', model: 'gemini-model', effort: 'high' },
    claude: { route: 'antigravity', model: 'claude-model', effort: 'high' },
  },
  judge: { route: 'codex', model: 'judge-model', effort: 'high' },
};
export const roundBindings: RoundBindings = { runId: 'run1', configHash: H, profileHash: H, contextHash: H, round: 1, candidateHash: H, evidenceHash: H, judgeHash: H };
export function makeBinding(seat: ReviewerSeat = 'openai', overrides: Partial<AttemptBinding> = {}): AttemptBinding {
  return {
    runId: 'run1', configHash: H, profileHash: H, contextHash: H, round: 1,
    clarificationBatch: null, inputHash: H, logicalTaskKey: `ballot-${seat}`,
    originAttemptId: `attempt-${seat}`, attemptId: `attempt-${seat}`, role: seat, phase: 'ballot',
    requested: config.reviewers[seat], configured: config.reviewers[seat],
    authority: { kind: 'supervised', runId: 'run1', taskId: `task-${seat}`, dispatchId: `dispatch-${seat}`, receiptId: `receipt-${seat}` },
    admittedMethodIds: ['test-method'], inputQuestionIds: [], inputObjectionIds: [], inputEvidenceIds: [],
    candidateHash: H, evidenceHash: H, judgeHash: H,
    ...overrides,
  };
}
export function makeBallot(seat: ReviewerSeat, overrides: Partial<Ballot> = {}): Ballot {
  return { bindings: { ...roundBindings }, binding: makeBinding(seat), seat, decision: 'accept', conditional: false, newObjections: [], missingInputQuestions: [], dispositions: [], challengeResponses: [{ challengeId: 'challenge1', response: 'Addressed with evidence.', evidenceIds: [] }], reason: 'Accept the frozen candidate and its stated assumptions, tradeoffs and uncertainty.', ...overrides };
}
export function makeLedger(overrides: Partial<QuestionLedger> = {}): QuestionLedger {
  return { contextHash: H, questions: [], answers: [], ...overrides };
}
export function makeConfirmation(overrides: Partial<ConfirmationContext> = {}): ConfirmationContext {
  return {
    expected: { ...roundBindings }, config,
    expectedAttempts: { openai: makeBinding('openai'), gemini: makeBinding('gemini'), claude: makeBinding('claude') },
    candidate: { text: { kind: 'candidate', sha256: H, path: '/tmp/candidate', bytes: 12 }, hash: H, assumptions: [], tradeoffs: [], unresolvedUncertainty: [], acknowledgedUnverifiedEvidenceIds: [] },
    ballots: [makeBallot('openai'), makeBallot('gemini'), makeBallot('claude')],
    objections: [], inputObjectionIds: [], questionLedger: makeLedger(), judgeChallengeIds: ['challenge1'], ...overrides,
  };
}
export function rawQuestion(overrides: Partial<RawQuestion> = {}): RawQuestion {
  return { id: 'q1', text: '  Exact original question?\n', reason: 'Required fact', blocking: true, answerForm: { kind: 'text' }, dependencies: [], ...overrides };
}
export function makeQuestion(overrides: Partial<Question> = {}): Question {
  return { id: 'run1/clarify/c1/openai/question/q1', text: '  Exact original question?\n', reason: 'Required fact', blocking: true, answerForm: { kind: 'text' }, dependencyIds: [], origin: { seat: 'openai', attemptId: 'attempt-openai', originAttemptId: 'attempt-openai', logicalTaskKey: 'clarify-openai', phase: 'clarify', round: 0, clarificationBatch: 1 }, disposition: 'deferred', ...overrides };
}
export function makeObjection(overrides: Partial<Objection> = {}): Objection {
  return { id: 'run1/review/r1/openai/objection/o1', owner: 'openai', claimId: 'claim1', claim: 'Missing evidence', evidenceIds: [], resolution: 'Supply evidence', status: 'open', history: [], ...overrides };
}
export function clock(wallMs: number, monotonicMs: number, processEpoch = 'epoch1'): ClockReceipt {
  return { id: `${processEpoch}-${wallMs}-${monotonicMs}`, wallMs, monotonicMs, processEpoch };
}
export function makeBudget(overrides: Partial<ActiveBudget> = {}): ActiveBudget {
  return { totalMs: 1000, remainingMs: 1000, status: 'active', intervalEpoch: 1, startReceipt: clock(10000, 100), lastReceipt: clock(10000, 100), accruedMs: 0, appliedExtensionIds: [], deadline: overrides.status && overrides.status !== 'active' ? null : { wallMs: 11000, monotonicMs: 1100, processEpoch: 'epoch1' }, ...overrides };
}
