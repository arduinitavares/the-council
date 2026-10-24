import type { Answer, AnswerForm, AnswerRevision, JsonValue, Question, QuestionLedger } from './contracts.js';
import { answerRevisionSchema, questionLedgerSchema } from './schemas.js';
import { validateQuestionDependencies } from './dependencies.js';

function matchesAnswerForm(form: AnswerForm, value: JsonValue): boolean {
  switch (form.kind) {
    case 'text': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'choice': return typeof value === 'string' && form.options.includes(value);
    case 'json': return true;
  }
}

/** Ledger order is authoritative; an answer must extend its question's current chain. */
export function validateQuestionLedger(ledger: QuestionLedger): void {
  questionLedgerSchema.parse(ledger);
  const questions = new Map<string, Question>();
  for (const question of ledger.questions) {
    if (questions.has(question.id)) throw new Error(`Duplicate question ID: ${question.id}`);
    questions.set(question.id, question);
  }
  validateQuestionDependencies(ledger.questions);
  const answerIds = new Set<string>();
  const latest = new Map<string, Answer>();
  for (const answer of ledger.answers) {
    const question = questions.get(answer.questionId);
    if (!question) throw new Error('Answer references an unknown question');
    if (answer.status === 'answered' && !matchesAnswerForm(question.answerForm, answer.value)) throw new Error('Answered value does not match question answer form');
    if (answerIds.has(answer.id)) throw new Error('Duplicate answer ID');
    if ((answer.supersededAnswerId ?? null) !== (latest.get(answer.questionId)?.id ?? null)) throw new Error('Answer does not extend current predecessor');
    if (question.dependencyIds.some(id => latest.get(id)?.status !== 'answered')) throw new Error('Unanswered question dependency');
    answerIds.add(answer.id); latest.set(answer.questionId, answer);
  }
}

export function latestAnswers(ledger: QuestionLedger): ReadonlyMap<string, Answer> {
  validateQuestionLedger(ledger);
  return new Map(ledger.answers.map(answer => [answer.questionId, answer]));
}

export function unresolvedBlockingQuestions(ledger: QuestionLedger): readonly Question[] {
  const latest = latestAnswers(ledger);
  return ledger.questions.filter(question => question.blocking && latest.get(question.id)?.status !== 'answered');
}

/** Returns an unpublished append; the context publisher assigns its next hash/revision. */
export function appendAnswerRevision(ledger: QuestionLedger, revision: AnswerRevision): QuestionLedger {
  const input = answerRevisionSchema.parse(revision);
  const latest = latestAnswers(ledger);
  if (input.baseContextHash !== ledger.contextHash) throw new Error('Stale answer revision context');
  const questions = new Map(ledger.questions.map(question => [question.id, question]));
  const declared = new Set(input.unresolvedQuestionIds);
  if (declared.size !== input.unresolvedQuestionIds.length) throw new Error('Duplicate unresolved question ID');
  for (const id of declared) if (!questions.has(id) || latest.get(id)?.status === 'answered') throw new Error('Unknown or resolved revision question');
  const revised = new Set<string>();
  for (const answer of input.answers) {
    const question = questions.get(answer.questionId);
    const previous = latest.get(answer.questionId);
    if (!question || !declared.has(question.id) || revised.has(question.id)) throw new Error('Invalid revision question');
    if (!question.id.startsWith(`${input.runId}/`)) throw new Error('Answer revision run mismatch');
    if (previous?.status === 'answered') throw new Error('Question is already resolved');
    if (!previous && question.disposition !== 'deferred') throw new Error('First revision answer requires a deferred question');
    if (answer.supersededAnswerId !== (previous?.id ?? null)) throw new Error('Stale answer predecessor');
    if (question.dependencyIds.some(id => latest.get(id)?.status !== 'answered')) throw new Error('Dependency must be answered in prior published ledger');
    revised.add(question.id);
  }
  const next: QuestionLedger = { ...ledger, answers: [...ledger.answers, ...input.answers] };
  validateQuestionLedger(next);
  return next;
}
