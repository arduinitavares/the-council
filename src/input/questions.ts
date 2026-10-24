import { z } from 'zod';
import type { Answer, AnswerBatch, AnswerRevision, BatchOrigin, BoundQuestion, Question, QuestionBatch, QuestionLedger, SharedContext, WorkerResult } from '../domain/contracts.js';
import { canonicalJson } from '../domain/hash.js';
import { validateQuestionDependencies } from '../domain/dependencies.js';
import { appendAnswerRevision, latestAnswers, unresolvedBlockingQuestions, validateQuestionLedger } from '../domain/questions.js';
import { answerBatchSchema, answerSchema, attemptBindingSchema, batchOriginSchema, boundQuestionSchema, boundWorkerPayloadSchema, idSchema, questionBatchSchema, sharedContextSchema } from '../domain/schemas.js';

export const groupingProposalSchema = z.strictObject({ id: idSchema, groups: z.array(z.strictObject({ id: idSchema, questionIds: z.array(idSchema).min(1) })) });
export type GroupingProposal = z.infer<typeof groupingProposalSchema>;
export type AnswerDecision = { kind: 'draft' | 'ready-for-publication' | 'unresolved-blocking' | 'invalid'; reason: string; questionIds: readonly string[]; ledger: QuestionLedger | null };
const invalid = (reason: string, questionIds: readonly string[] = []): AnswerDecision => ({ kind: 'invalid', reason, questionIds, ledger: null });
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const workerResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('valid'), payload: boundWorkerPayloadSchema, binding: attemptBindingSchema }),
  z.strictObject({ status: z.literal('invalid'), code: idSchema }),
]);

/** Compiles one settled common wave. No semantic duplicate detection takes place here. */
export function buildQuestionBatch(prior: QuestionLedger, origin: BatchOrigin, results: readonly WorkerResult[], grouping: GroupingProposal, sourceAnswers: readonly Answer[]): QuestionBatch {
  validateQuestionLedger(prior); batchOriginSchema.parse(origin); groupingProposalSchema.parse(grouping);
  z.array(workerResultSchema).parse(results);
  const latest = latestAnswers(prior), added: BoundQuestion[] = [], seats = new Set<string>();
  let waveRun: string | undefined, wavePhase: string | undefined, configHash: string | undefined, profileHash: string | undefined;
  for (const result of [...results].sort((a, b) => {
    const order = ['openai', 'gemini', 'claude'];
    return order.indexOf(a.status === 'valid' ? a.binding.role : '') - order.indexOf(b.status === 'valid' ? b.binding.role : '');
  })) {
    if (result.status !== 'valid') throw new Error('QUESTION_RESULT_INVALID');
    const binding = attemptBindingSchema.parse(result.binding), payload = boundWorkerPayloadSchema.parse(result.payload);
    if (binding.role === 'judge' || seats.has(binding.role)) throw new Error('QUESTION_WAVE_INCOMPLETE'); seats.add(binding.role);
    if (payload.kind !== (binding.phase === 'clarify' ? 'clarification' : binding.phase) || payload.kind === 'ballot' && payload.seat !== binding.role) throw new Error('QUESTION_ORIGIN_INVALID');
    if (!same(binding, payload.binding) || binding.contextHash !== prior.contextHash || !same(binding.inputQuestionIds, prior.questions.map(question => question.id)) || (waveRun !== undefined && (waveRun !== binding.runId || wavePhase !== binding.phase || configHash !== binding.configHash || profileHash !== binding.profileHash))) throw new Error('QUESTION_ORIGIN_INVALID');
    waveRun = binding.runId; wavePhase = binding.phase; configHash = binding.configHash; profileHash = binding.profileHash;
    if (origin.kind === 'clarification' ? binding.phase !== 'clarify' || binding.clarificationBatch !== origin.batchIndex || binding.round !== 0 : !['review', 'ballot'].includes(binding.phase) || binding.round !== origin.round || binding.clarificationBatch !== null) throw new Error('QUESTION_ORIGIN_INVALID');
    const questions = payload.kind === 'clarification' ? payload.questions : payload.kind === 'review' || payload.kind === 'ballot' ? payload.missingInputQuestions : [];
    for (const question of questions) {
      boundQuestionSchema.parse(question);
      const expected = { seat: binding.role, attemptId: binding.attemptId, originAttemptId: binding.originAttemptId, logicalTaskKey: binding.logicalTaskKey, phase: binding.phase, round: binding.round, clarificationBatch: binding.clarificationBatch };
      if (!same(question.origin, expected) || !question.id.startsWith(`${binding.runId}/`)) throw new Error('QUESTION_ORIGIN_INVALID');
      added.push(question);
    }
  }
  if (seats.size !== 3) throw new Error('QUESTION_WAVE_INCOMPLETE');
  const originals = [...prior.questions, ...added]; validateQuestionDependencies(originals);
  if (prior.questions.some(question => !question.id.startsWith(`${waveRun}/`))) throw new Error('QUESTION_ORIGIN_INVALID');
  const promoted: Question[] = prior.questions.filter(question => question.disposition === 'deferred' && !latest.has(question.id) && question.dependencyIds.every(id => latest.get(id)?.status === 'answered')).map(question => ({ ...question, disposition: 'presented' }));
  const questions: Question[] = [...promoted, ...added.map(question => ({ ...question, disposition: question.dependencyIds.every(id => latest.get(id)?.status === 'answered') ? 'presented' as const : 'deferred' as const }))];
  const presentedQuestionIds = questions.filter(question => question.disposition === 'presented').map(question => question.id);
  // Finalized unknown/declined items use AnswerRevision, never an old-batch resubmission.
  const groups = grouping.groups, aliases: { questionId: string; groupId: string }[] = [], groupIds = new Set<string>(), grouped = new Set<string>();
  for (const group of groups) {
    if (groupIds.has(group.id)) throw new Error('GROUPING_INVALID'); groupIds.add(group.id);
    for (const questionId of group.questionIds) {
      if (!presentedQuestionIds.includes(questionId) || grouped.has(questionId)) throw new Error('GROUPING_INVALID');
      grouped.add(questionId); aliases.push({ questionId, groupId: group.id });
    }
  }
  for (const answer of sourceAnswers) if (!presentedQuestionIds.includes(answerSchema.parse(answer).questionId)) throw new Error('SOURCE_ANSWER_INVALID');
  const merged = new Map(prior.questions.map(question => [question.id, question]));
  for (const question of questions) merged.set(question.id, question);
  validateQuestionLedger({ ...prior, questions: [...merged.values()], answers: [...prior.answers, ...sourceAnswers] });
  const batch: QuestionBatch = { id: grouping.id, origin, baseContextHash: prior.contextHash, questions, groups, aliases, sourceAnswers, presentedQuestionIds };
  questionBatchSchema.parse(batch);
  return structuredClone(batch);
}

/** Prior ledger is required when validating batches with published answer history. */
export function validateAnswerBatch(batch: QuestionBatch, answers: AnswerBatch, prior?: QuestionLedger, previousRequest?: AnswerBatch): AnswerDecision {
  try {
    questionBatchSchema.parse(batch); answerBatchSchema.parse(answers);
    if (answers.baseContextHash !== batch.baseContextHash || prior && prior.contextHash !== batch.baseContextHash) return invalid('STALE_CONTEXT');
    if (answers.batchId !== batch.id || !same(answers.origin, batch.origin)) return invalid('ANSWER_BATCH_MISMATCH');
    if (!prior && (batch.origin.kind !== 'clarification' || batch.origin.batchIndex !== 1 || batch.questions.some(question => question.origin.phase !== 'clarify' || question.origin.clarificationBatch !== 1 || question.dependencyIds.some(id => !batch.questions.some(candidate => candidate.id === id))))) return invalid('QUESTION_LEDGER_REQUIRED');
    if (previousRequest?.requestId === answers.requestId && !same(previousRequest, answers)) return invalid('REQUEST_ID_CONFLICT');
    if (previousRequest?.finalized && !same(previousRequest, answers)) return invalid('ANSWER_BATCH_FINALIZED');
    const ledger = prior ?? { contextHash: batch.baseContextHash, questions: batch.questions, answers: [] };
    validateQuestionLedger(ledger);
    const previousAnswers = latestAnswers(ledger);
    const presented = batch.questions.filter(question => question.disposition === 'presented').map(question => question.id);
    if (!same(presented, batch.presentedQuestionIds)) return invalid('QUESTION_PRESENTATION_INVALID', presented);
    if (new Set(batch.questions.map(question => question.id)).size !== batch.questions.length) return invalid('QUESTION_ID_CONFLICT', batch.questions.map(question => question.id));
    const questions = new Map(ledger.questions.map(question => [question.id, question]));
    for (const question of batch.questions) {
      const old = questions.get(question.id);
      if (old && !same({ ...old, disposition: question.disposition }, question)) return invalid('QUESTION_CHANGED', [question.id]);
      questions.set(question.id, question);
    }
    const answered = new Set<string>();
    for (const answer of answers.answers) {
      if (!batch.presentedQuestionIds.includes(answer.questionId) || answered.has(answer.questionId)) return invalid('ANSWER_ID_INVALID', [answer.questionId]);
      const question = questions.get(answer.questionId);
      if (!question) return invalid('ANSWER_ID_INVALID', [answer.questionId]);
      if (question.dependencyIds.some(id => previousAnswers.get(id)?.status !== 'answered')) return invalid('ANSWER_DEPENDENCY_UNRESOLVED', [answer.questionId]);
      try { validateQuestionLedger({ ...ledger, questions: [...questions.values()], answers: [...ledger.answers, answer] }); }
      catch { return invalid('ANSWER_INVALID', [answer.questionId]); }
      answered.add(answer.questionId);
    }
    for (const source of batch.sourceAnswers) if (!answers.answers.some(answer => same(answer, source))) return invalid('SOURCE_ANSWER_MISSING', [source.questionId]);
    const missing = batch.presentedQuestionIds.filter(id => !answered.has(id));
    if (answers.finalized && missing.length) return invalid('ANSWER_BATCH_INCOMPLETE', missing);
    const next = { contextHash: batch.baseContextHash, questions: [...questions.values()], answers: [...ledger.answers, ...answers.answers] };
    validateQuestionLedger(next);
    if (!answers.finalized) return { kind: 'draft', reason: 'ANSWER_BATCH_DRAFT', questionIds: missing, ledger: null };
    const unresolved = unresolvedBlockingQuestions(next).map(q => q.id);
    return { kind: unresolved.length ? 'unresolved-blocking' : 'ready-for-publication', reason: unresolved.length ? batch.origin.kind === 'clarification' && batch.origin.batchIndex >= 2 ? 'CLARIFICATION_LIMIT' : 'UNRESOLVED_QUESTIONS' : 'READY', questionIds: unresolved, ledger: next };
  } catch (error) { return invalid('ANSWER_INVALID:' + (error instanceof Error ? error.message : 'unknown')); }
}
export function validateAnswerRevision(context: SharedContext, ledger: QuestionLedger, request: AnswerRevision): AnswerDecision {
  try {
    sharedContextSchema.parse(context);
    if (context.contextHash !== ledger.contextHash || request.baseContextHash !== context.contextHash) return invalid('STALE_CONTEXT');
    const next = appendAnswerRevision(ledger, request), unresolved = unresolvedBlockingQuestions(next).map(q => q.id);
    return { kind: unresolved.length ? 'unresolved-blocking' : 'ready-for-publication', reason: unresolved.length ? 'UNRESOLVED_QUESTIONS' : 'READY', questionIds: unresolved, ledger: next };
  } catch (error) { return invalid('ANSWER_REVISION_INVALID:' + (error instanceof Error ? error.message : 'unknown'), Array.isArray(request?.answers) ? request.answers.map(answer => answer.questionId) : []); }
}
