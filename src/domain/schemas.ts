import { posix } from 'node:path';
import { z } from 'zod';
import type { AttemptBinding, BoundQuestion, BoundWorkerPayload, JsonValue, Objection, WorkerPayload } from './contracts.js';
import { canonicalJson } from './hash.js';
import { validateQuestionDependencies } from './dependencies.js';

export const INPUT_LIMIT_BYTES = 8 * 1024 * 1024;
export const WORKER_RESULT_LIMIT_BYTES = 1024 * 1024;
export const idSchema = z.string().min(1).refine(value => value.trim().length > 0, 'Empty identifier');
export const localIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const canonicalPathSchema = z.string().refine(value => value.startsWith('/') && !value.includes('\0') && posix.normalize(value) === value, 'Expected a canonical absolute path');
const nonempty = z.string().min(1).refine(value => value.trim().length > 0, 'Empty text');
const natural = z.number().int().nonnegative();
const positive = z.number().int().positive();
export const reviewerSeatSchema = z.enum(['openai', 'gemini', 'claude']);
export const workerRoleSchema = z.enum(['openai', 'gemini', 'claude', 'judge']);
export const workerPhaseSchema = z.enum(['clarify', 'review', 'judge', 'ballot']);
export const modelSelectionSchema = z.strictObject({ route: z.enum(['codex', 'antigravity']), model: nonempty, effort: nonempty });
export const councilConfigSchema = z.strictObject({
  version: z.literal(1),
  reviewers: z.strictObject({ openai: modelSelectionSchema, gemini: modelSelectionSchema, claude: modelSelectionSchema }),
  judge: modelSelectionSchema,
}).refine(config => config.reviewers.openai.route === 'codex' && config.reviewers.gemini.route === 'antigravity' && config.reviewers.claude.route === 'antigravity', 'Reviewer family/route mismatch');
export const artifactRefSchema = z.strictObject({ kind: localIdSchema, sha256: hashSchema, path: canonicalPathSchema, bytes: natural });
export const configSnapshotSchema = z.strictObject({ sourcePath: canonicalPathSchema, rawSha256: hashSchema, rawArtifact: artifactRefSchema, configArtifact: artifactRefSchema, configHash: hashSchema, resolved: councilConfigSchema });
export const checkSpecSchema = z.strictObject({ id: idSchema, argv: z.array(z.string()).min(1), cwd: canonicalPathSchema, declaredEffects: z.array(nonempty), outputTargets: z.array(canonicalPathSchema) });
export const runScopeSchema = z.strictObject({ sourceRoots: z.array(canonicalPathSchema).min(1), allowedSourceAddresses: z.array(nonempty), checks: z.array(checkSpecSchema) });
export const profileSnapshotSchema = z.strictObject({
  manifest: artifactRefSchema, profileHash: hashSchema, admittedMethodIds: z.array(idSchema),
  sources: z.array(z.strictObject({ id: idSchema, path: canonicalPathSchema, revision: nonempty, sha256: hashSchema })),
  adaptations: z.array(z.strictObject({ methodId: idSchema, retained: z.array(nonempty), replaced: z.array(nonempty), excluded: z.array(nonempty) })),
});
export const sharedContextSchema = z.strictObject({ contextRevision: natural, contextHash: hashSchema, topic: artifactRefSchema, handoff: artifactRefSchema, questionLedgerRefs: z.array(artifactRefSchema), answerLedgerRefs: z.array(artifactRefSchema), userDirections: z.array(artifactRefSchema) });
export const runRequestSchema = z.strictObject({
  runId: localIdSchema, workspace: canonicalPathSchema, topic: nonempty, handoffPath: canonicalPathSchema, handoffHash: hashSchema,
  config: configSnapshotSchema, profile: profileSnapshotSchema, sharedContext: sharedContextSchema, scope: runScopeSchema,
  maxClarificationBatches: positive, maxRounds: positive, workerTimeoutMs: positive, activeBudgetMs: positive,
}).refine(request => Number.isSafeInteger(3 * request.maxClarificationBatches + 7 * request.maxRounds), 'Worker-call limit overflow');
export const boundedExtensionSchema = z.strictObject({
  id: idSchema, baseRevision: natural, authorizationReceipt: nonempty, expiresAt: z.number().finite().positive(),
  additionalClarificationBatches: natural, additionalRounds: natural, additionalActiveBudgetMs: natural,
}).refine(extension => extension.additionalClarificationBatches > 0 || extension.additionalRounds > 0 || extension.additionalActiveBudgetMs > 0, 'Extension must add allowance');
export const jsonValueSchema = z.custom<JsonValue>(value => {
  try { canonicalJson(value as JsonValue); return true; } catch { return false; }
}, 'Expected a JSON value');
export const answerFormSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text') }), z.strictObject({ kind: z.literal('boolean') }),
  z.strictObject({ kind: z.literal('number') }), z.strictObject({ kind: z.literal('json') }),
  z.strictObject({ kind: z.literal('choice'), options: z.array(nonempty).min(1) }),
]);
export const rawQuestionRefSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('local'), id: localIdSchema }),
  z.strictObject({ kind: z.literal('ledger'), id: idSchema }),
]);
const questionContent = { text: nonempty, reason: nonempty, blocking: z.boolean(), answerForm: answerFormSchema };
export const rawQuestionSchema = z.strictObject({ id: localIdSchema, ...questionContent, dependencies: z.array(rawQuestionRefSchema) });
export const questionOriginSchema = z.strictObject({ seat: reviewerSeatSchema, attemptId: idSchema, originAttemptId: idSchema, logicalTaskKey: idSchema, phase: workerPhaseSchema, round: natural, clarificationBatch: positive.nullable() });
const boundQuestionShape = { id: idSchema, ...questionContent, dependencyIds: z.array(idSchema), origin: questionOriginSchema };
function questionNamespaceMatches(question: { id: string; origin: z.infer<typeof questionOriginSchema> }): boolean {
  const match = /^([A-Za-z0-9_-]{1,80})\/(clarify|review|ballot)\/(c[1-9]\d*|r[1-9]\d*)\/(openai|gemini|claude)\/question\/[A-Za-z0-9_-]{1,80}$/.exec(question.id);
  if (!match || question.origin.phase === 'judge') return false;
  const origin = question.origin;
  if (origin.phase === 'clarify' ? origin.round !== 0 || origin.clarificationBatch === null : origin.round < 1 || origin.clarificationBatch !== null) return false;
  return match[2] === origin.phase && match[3] === (origin.phase === 'clarify' ? `c${origin.clarificationBatch}` : `r${origin.round}`) && match[4] === origin.seat;
}
export const boundQuestionSchema = z.strictObject(boundQuestionShape).refine(questionNamespaceMatches, 'Question namespace/origin mismatch');
export const questionSchema = z.strictObject({ ...boundQuestionShape, disposition: z.enum(['presented', 'deferred']) }).refine(questionNamespaceMatches, 'Question namespace/origin mismatch');
const answerShape = {
  id: idSchema, questionId: idSchema, supersededAnswerId: idSchema.nullable().optional(), status: z.enum(['answered', 'unknown', 'declined']), value: jsonValueSchema,
  source: z.strictObject({ author: nonempty, receiptId: idSchema }), evidenceIds: z.array(idSchema),
};
export const answerSchema = z.strictObject(answerShape).refine(answer => answer.status === 'answered' || answer.value === null, 'Unanswered status requires null value');
const revisionAnswerSchema = z.strictObject({ ...answerShape, supersededAnswerId: idSchema.nullable() }).refine(answer => answer.status === 'answered' || answer.value === null, 'Unanswered status requires null value');
export const questionLedgerSchema = z.strictObject({ contextHash: hashSchema, questions: z.array(questionSchema), answers: z.array(answerSchema) });
export const answerRevisionSchema = z.strictObject({ requestId: idSchema, runId: localIdSchema, baseContextHash: hashSchema, unresolvedQuestionIds: z.array(idSchema), answers: z.array(revisionAnswerSchema).min(1) });
export const phaseBindingsSchema = z.strictObject({ runId: localIdSchema, configHash: hashSchema, profileHash: hashSchema, contextHash: hashSchema, round: natural, clarificationBatch: positive.nullable(), inputHash: hashSchema, logicalTaskKey: idSchema, originAttemptId: idSchema });
const roundShape = { runId: localIdSchema, configHash: hashSchema, profileHash: hashSchema, contextHash: hashSchema, round: positive, candidateHash: hashSchema, evidenceHash: hashSchema, judgeHash: hashSchema };
export const roundBindingsSchema = z.strictObject(roundShape);
export const authoritySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('supervised'), runId: localIdSchema, taskId: idSchema, dispatchId: idSchema, receiptId: idSchema }),
  z.strictObject({ kind: z.literal('terminal-only'), terminalId: idSchema, receiptId: idSchema }),
]);
export const attemptBindingSchema = phaseBindingsSchema.extend({
  attemptId: idSchema, role: workerRoleSchema, phase: workerPhaseSchema, requested: modelSelectionSchema, configured: modelSelectionSchema, authority: authoritySchema,
  admittedMethodIds: z.array(idSchema), inputQuestionIds: z.array(idSchema), inputObjectionIds: z.array(idSchema), inputEvidenceIds: z.array(idSchema),
  candidateHash: hashSchema.optional(), evidenceHash: hashSchema.optional(), judgeHash: hashSchema.optional(),
}).superRefine((binding, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (binding.phase === 'clarify' ? binding.round !== 0 || binding.clarificationBatch === null : binding.round < 1 || binding.clarificationBatch !== null) fail('Invalid phase index');
  if ((binding.role === 'judge') !== (binding.phase === 'judge')) fail('Phase/role mismatch');
  if (binding.authority.kind === 'supervised' && binding.authority.runId !== binding.runId) fail('Authority run mismatch');
  if (canonicalJson(binding.requested) !== canonicalJson(binding.configured)) fail('Configured mapping mismatch');
  if (binding.role === 'openai' && binding.requested.route !== 'codex' || (binding.role === 'gemini' || binding.role === 'claude') && binding.requested.route !== 'antigravity') fail('Family/route mismatch');
  if ((binding.phase === 'judge' || binding.phase === 'ballot') && (!binding.candidateHash || !binding.evidenceHash)) fail('Missing candidate/evidence binding');
  if (binding.phase === 'ballot' && !binding.judgeHash) fail('Missing judge binding');
});
export const rawObjectionSchema = z.strictObject({ id: localIdSchema, claimId: idSchema, claim: nonempty, evidenceIds: z.array(idSchema), resolution: nonempty, status: z.literal('open') });
export const objectionDispositionSchema = z.strictObject({ objectionId: idSchema, status: z.enum(['open', 'closed']), reason: nonempty, evidenceIds: z.array(idSchema) });
export const dispositionRecordSchema = objectionDispositionSchema.extend({ seat: reviewerSeatSchema, attemptId: idSchema });
export const objectionSchema = z.strictObject({ id: idSchema, owner: reviewerSeatSchema, claimId: idSchema, claim: nonempty, evidenceIds: z.array(idSchema), resolution: nonempty, status: z.enum(['open', 'closed']), history: z.array(dispositionRecordSchema) }).refine(objection => {
  const match = /^[A-Za-z0-9_-]{1,80}\/(review|ballot)\/r[1-9]\d*\/(openai|gemini|claude)\/objection\/[A-Za-z0-9_-]{1,80}$/.exec(objection.id);
  return match?.[2] === objection.owner;
}, 'Objection namespace/owner mismatch');
export const challengeResponseSchema = z.strictObject({ challengeId: idSchema, response: nonempty, evidenceIds: z.array(idSchema) });
export const evidenceRequestSchema = z.strictObject({ id: idSchema, claimId: idSchema, source: nonempty, reason: nonempty });
export const claimAssessmentSchema = z.strictObject({ claimId: idSchema, status: z.enum(['supported', 'contradicted', 'unresolved']), evidenceIds: z.array(idSchema), reason: nonempty });
export const judgeChallengeSchema = z.strictObject({ id: idSchema, claimId: idSchema, text: nonempty, evidenceIds: z.array(idSchema) });
const methods = { methodIds: z.array(idSchema) };
const clarificationSchema = z.strictObject({ kind: z.literal('clarification'), ready: z.boolean(), questions: z.array(rawQuestionSchema), ...methods }).refine(payload => payload.ready === (payload.questions.length === 0), 'Readiness/questions conflict');
const reviewSchema = z.strictObject({ kind: z.literal('review'), proposals: z.array(nonempty), newObjections: z.array(rawObjectionSchema), evidenceRequests: z.array(evidenceRequestSchema), missingInputQuestions: z.array(rawQuestionSchema), ...methods });
const judgeSchema = z.strictObject({ kind: z.literal('judge'), bindings: roundBindingsSchema.omit({ judgeHash: true }), assessments: z.array(claimAssessmentSchema), challenges: z.array(judgeChallengeSchema), ...methods });
export const rawBallotSchema = z.strictObject({ kind: z.literal('ballot'), bindings: roundBindingsSchema, decision: z.enum(['accept', 'reject', 'abstain']), conditional: z.boolean(), newObjections: z.array(rawObjectionSchema), missingInputQuestions: z.array(rawQuestionSchema), dispositions: z.array(objectionDispositionSchema), challengeResponses: z.array(challengeResponseSchema), reason: nonempty, ...methods });
export const workerPayloadSchema = z.discriminatedUnion('kind', [clarificationSchema, reviewSchema, judgeSchema, rawBallotSchema]);
export const ballotSchema = rawBallotSchema.omit({ kind: true, methodIds: true }).extend({ kind: z.literal('ballot').optional(), methodIds: z.array(idSchema).optional(), binding: attemptBindingSchema, seat: reviewerSeatSchema, newObjections: z.array(objectionSchema), missingInputQuestions: z.array(boundQuestionSchema) });
export const frozenCandidateSchema = z.strictObject({ text: artifactRefSchema, hash: hashSchema, assumptions: z.array(z.string()), tradeoffs: z.array(z.string()), unresolvedUncertainty: z.array(z.string()), acknowledgedUnverifiedEvidenceIds: z.array(idSchema) });
export const confirmationContextSchema = z.strictObject({ expected: roundBindingsSchema, expectedAttempts: z.strictObject({ openai: attemptBindingSchema, gemini: attemptBindingSchema, claude: attemptBindingSchema }), config: councilConfigSchema, candidate: frozenCandidateSchema, ballots: z.array(ballotSchema), objections: z.array(objectionSchema), inputObjectionIds: z.array(idSchema), questionLedger: questionLedgerSchema, judgeChallengeIds: z.array(idSchema) });
export const clockReceiptSchema = z.strictObject({ id: idSchema, wallMs: z.number().finite().nonnegative(), monotonicMs: z.number().finite().nonnegative(), processEpoch: idSchema });
export const activeDeadlineSchema = z.strictObject({ wallMs: z.number().finite().nonnegative(), monotonicMs: z.number().finite(), processEpoch: idSchema });
export const activeBudgetSchema = z.strictObject({ totalMs: natural, remainingMs: z.number().finite().nonnegative(), status: z.enum(['active', 'paused', 'settled']), intervalEpoch: natural, startReceipt: clockReceiptSchema, lastReceipt: clockReceiptSchema, accruedMs: z.number().finite().nonnegative(), appliedExtensionIds: z.array(idSchema), deadline: activeDeadlineSchema.nullable() }).refine(budget => budget.remainingMs <= budget.totalMs && (budget.status === 'active' ? budget.deadline !== null && budget.deadline.processEpoch === budget.lastReceipt.processEpoch : budget.deadline === null), 'Invalid budget allowance or active deadline');
export const budgetEventSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('active-checkpoint') }), z.strictObject({ kind: z.literal('resume-active') }), z.strictObject({ kind: z.literal('crash-reconcile') }),
  z.strictObject({ kind: z.literal('settled-human-pause'), allResourcesSettled: z.boolean() }), z.strictObject({ kind: z.literal('terminal-settlement'), allResourcesSettled: z.boolean() }),
  z.strictObject({ kind: z.literal('authorized-extension'), extensionId: idSchema, additionalMs: natural, authorizationReceipt: nonempty }),
]);

/** No authority is created by decoding. Unbound output stays evidence until receipt binding. */
export function parseWorkerPayload(raw: unknown): WorkerPayload {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    if (Buffer.byteLength(raw, 'utf8') > WORKER_RESULT_LIMIT_BYTES) throw new Error('Worker result size limit exceeded');
    value = JSON.parse(raw) as unknown;
  }
  const canonical = canonicalJson(value as JsonValue);
  if (Buffer.byteLength(canonical, 'utf8') > WORKER_RESULT_LIMIT_BYTES) throw new Error('Worker result size limit exceeded');
  return workerPayloadSchema.parse(value);
}

export function namespaceItem(kind: 'question' | 'objection', binding: AttemptBinding, localId: string): string {
  localIdSchema.parse(localId);
  localIdSchema.parse(binding.runId);
  reviewerSeatSchema.parse(binding.role);
  const wave = binding.phase === 'clarify' ? `c${positive.parse(binding.clarificationBatch)}` : `r${positive.parse(binding.round)}`;
  return `${binding.runId}/${workerPhaseSchema.parse(binding.phase)}/${wave}/${binding.role}/${kind}/${localId}`;
}

export function bindWorkerPayload(payload: WorkerPayload, binding: AttemptBinding): BoundWorkerPayload {
  const input = workerPayloadSchema.parse(payload);
  const trusted = attemptBindingSchema.parse(binding) as AttemptBinding;
  const expectedKind = { clarify: 'clarification', review: 'review', judge: 'judge', ballot: 'ballot' } as const;
  if (input.kind !== expectedKind[trusted.phase]) throw new Error('Payload kind/phase mismatch');
  for (const method of input.methodIds) if (!trusted.admittedMethodIds.includes(method)) throw new Error(`Unadmitted method: ${method}`);
  const bindQuestions = (questions: readonly z.infer<typeof rawQuestionSchema>[]): BoundQuestion[] => {
    const ids = new Set(questions.map(question => question.id));
    if (ids.size !== questions.length) throw new Error('Duplicate local question ID');
    const bound = questions.map(({ id, dependencies, ...content }) => ({
      ...content, id: namespaceItem('question', trusted, id),
      dependencyIds: dependencies.map(ref => {
        if (ref.kind === 'local') {
          if (!ids.has(ref.id)) throw new Error('Missing local question dependency');
          return namespaceItem('question', trusted, ref.id);
        }
        if (!trusted.inputQuestionIds.includes(ref.id)) throw new Error('Missing frozen ledger dependency');
        return ref.id;
      }),
      origin: { seat: reviewerSeatSchema.parse(trusted.role), attemptId: trusted.attemptId, originAttemptId: trusted.originAttemptId, logicalTaskKey: trusted.logicalTaskKey, phase: trusted.phase, round: trusted.round, clarificationBatch: trusted.clarificationBatch },
    }));
    validateQuestionDependencies(bound, trusted.inputQuestionIds);
    return bound;
  };
  const bindObjections = (objections: readonly z.infer<typeof rawObjectionSchema>[]): Objection[] => {
    if (new Set(objections.map(objection => objection.id)).size !== objections.length) throw new Error('Duplicate local objection ID');
    return objections.map(objection => ({ ...objection, id: namespaceItem('objection', trusted, objection.id), owner: reviewerSeatSchema.parse(trusted.role), history: [] }));
  };
  if (input.kind === 'clarification') return { ...input, questions: bindQuestions(input.questions), binding: trusted };
  if (input.kind === 'review') return { ...input, newObjections: bindObjections(input.newObjections), missingInputQuestions: bindQuestions(input.missingInputQuestions), binding: trusted };
  // Reported targets are checked before attaching provenance; they are never repaired.
  for (const [key, value] of Object.entries(input.bindings)) {
    if (trusted[key as keyof AttemptBinding] !== value) throw new Error(`Reported binding mismatch: ${key}`);
  }
  if (input.kind === 'judge') return { ...input, binding: trusted };
  for (const disposition of input.dispositions) {
    if (!trusted.inputObjectionIds.includes(disposition.objectionId)) throw new Error('Disposition outside frozen input objections');
    if (disposition.evidenceIds.some(id => !trusted.inputEvidenceIds.includes(id))) throw new Error('Disposition evidence outside frozen packet');
  }
  return { ...input, seat: reviewerSeatSchema.parse(trusted.role), binding: trusted, newObjections: bindObjections(input.newObjections), missingInputQuestions: bindQuestions(input.missingInputQuestions) };
}

// Persisted machine protocol. Strict bodies are decoded before any guard runs.
export const controlStateSchema = z.enum([
  'preflight',
  'needs_context',
  'clarifying',
  'collecting_questions',
  'publishing_answers',
  'prepare_round',
  'reviewing',
  'prepare_candidate',
  'judging',
  'confirming',
  'evaluate_round',
  'reconciling',
  'needs_user',
  'blocked',
  'settling',
  'completed',
  'cancelled',
]);
export const batchOriginSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('clarification'), batchIndex: positive }),
  z.strictObject({ kind: z.literal('deliberation'), round: positive }),
]);
export const questionBatchSchema = z.strictObject({
  id: idSchema,
  origin: batchOriginSchema,
  baseContextHash: hashSchema,
  questions: z.array(questionSchema),
  groups: z.array(z.strictObject({ id: idSchema, questionIds: z.array(idSchema) })),
  aliases: z.array(z.strictObject({ questionId: idSchema, groupId: idSchema })),
  sourceAnswers: z.array(answerSchema),
  presentedQuestionIds: z.array(idSchema),
});
export const answerBatchSchema = z.strictObject({
  requestId: idSchema,
  batchId: idSchema,
  origin: batchOriginSchema,
  baseContextHash: hashSchema,
  answers: z.array(answerSchema),
  finalized: z.boolean(),
});
export const contextUpdateSchema = z.strictObject({
  requestId: idSchema,
  runId: localIdSchema,
  baseContextHash: hashSchema,
  userDirections: z.array(artifactRefSchema).min(1),
});
export const evidenceRecordSchema = z.strictObject({
  requestId: idSchema,
  status: z.enum(['verified', 'invalid', 'unverified', 'not_applicable']),
  sourceLocation: nonempty,
  contentHash: hashSchema,
  observationReceipt: idSchema,
});
export const boundWorkerPayloadSchema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      kind: z.literal('clarification'),
      ready: z.boolean(),
      questions: z.array(boundQuestionSchema),
      methodIds: z.array(idSchema),
      binding: attemptBindingSchema,
    })
    .refine((p) => p.ready === (p.questions.length === 0), 'Readiness/questions conflict'),
  reviewSchema.extend({
    newObjections: z.array(objectionSchema),
    missingInputQuestions: z.array(boundQuestionSchema),
    binding: attemptBindingSchema,
  }),
  judgeSchema.extend({ binding: attemptBindingSchema }),
  rawBallotSchema.extend({
    newObjections: z.array(objectionSchema),
    missingInputQuestions: z.array(boundQuestionSchema),
    binding: attemptBindingSchema,
    seat: reviewerSeatSchema,
  }),
]);
export const workerObservationSchema = z.strictObject({
  status: z.enum(['live', 'unverifiable', 'exited']),
  rawReceipts: z.array(artifactRefSchema),
  exitCode: z.number().int().nullable(),
});
const emptyBody = z.strictObject({});
const body = <K extends string, S extends z.ZodType>(kind: K, data: S) =>
  z.strictObject({ kind: z.literal(kind), data });
export const controlEventBodySchema = z.discriminatedUnion('kind', [
  body(
    'PREFLIGHT',
    z.strictObject({
      status: z.enum(['pass', 'needs_context', 'blocked']),
      attestation: artifactRefSchema.nullable(),
      code: idSchema.nullable(),
      resourcesSettled: z.boolean(),
    }),
  ),
  ...(
    [
      'CLOCK_CHECKPOINT',
      'ADMIT_ROUND',
      'PHASE_READY',
      'PUBLISH_ANSWERS',
      'REQUEST_CANDIDATE',
      'EVALUATE_ROUND',
      'CANCEL',
      'DEADLINE',
      'LIFECYCLE_UNKNOWN',
      'RESUME',
      'APPLY_CONTEXT_UPDATE',
    ] as const
  ).map((kind) => body(kind, emptyBody)),
  body('ERROR', z.strictObject({ code: idSchema, terminalInference: z.boolean() })),
  body(
    'REQUIRE_INPUT',
    z.strictObject({
      reason: idSchema,
      outcome: z.enum(['needs_user', 'needs_context', 'blocked']),
    }),
  ),
  body('LAUNCH_DISPATCHED', z.strictObject({ logicalTaskKey: idSchema })),
  body('LAUNCH_RECEIPT_RECORDED', z.strictObject({ binding: attemptBindingSchema })),
  body('EFFECT_RECEIPT_RECORDED', z.strictObject({ key: idSchema, intentHash: hashSchema, receipt: artifactRefSchema })),
  body(
    'WORKER_RESULT',
    z.strictObject({ payload: boundWorkerPayloadSchema, artifact: artifactRefSchema }),
  ),
  body(
    'WORKER_OBSERVED',
    z.strictObject({ logicalTaskKey: idSchema, observation: workerObservationSchema }),
  ),
  body('COLLECT_QUESTIONS', z.strictObject({ batch: questionBatchSchema })),
  body('ANSWER_BATCH', z.strictObject({ batch: answerBatchSchema })),
  body('ANSWER_REVISION', z.strictObject({ revision: answerRevisionSchema })),
  body('CONTEXT_UPDATE', z.strictObject({ update: contextUpdateSchema })),
  body('EVIDENCE_RECORDED', z.strictObject({ record: evidenceRecordSchema })),
  body('EVIDENCE_REQUESTED', z.strictObject({ request: evidenceRequestSchema })),
  body(
    'CANDIDATE_FROZEN',
    z.strictObject({ candidate: frozenCandidateSchema, evidenceHash: hashSchema }),
  ),
  body('EXTEND', z.strictObject({ extension: boundedExtensionSchema })),
  body('SETTLED', z.strictObject({ receipt: artifactRefSchema })),
  body(
    'RESOURCES_SETTLED',
    z.strictObject({ logicalTaskKeys: z.array(idSchema), receipt: artifactRefSchema }),
  ),
  body(
    'RECONCILED',
    z.strictObject({
      ownership: z.boolean(),
      priorControllerExited: z.boolean(),
      resourcesSettled: z.boolean(),
      receipt: artifactRefSchema,
      observations: z.array(
        z.strictObject({
          logicalTaskKey: idSchema,
          observation: workerObservationSchema,
          savedResult: z
            .strictObject({ payload: boundWorkerPayloadSchema, artifact: artifactRefSchema })
            .optional(),
        }),
      ),
    }),
  ),
]);
export const validatedEventSchema = z.strictObject({
  id: idSchema,
  runId: localIdSchema,
  schemaVersion: z.literal(1),
  actor: z.strictObject({ kind: z.enum(['adapter', 'user', 'controller']), receiptId: idSchema }),
  round: natural,
  phase: workerPhaseSchema.nullable(),
  clockReceipt: clockReceiptSchema,
  body: controlEventBodySchema,
});
const roleRecord = <S extends z.ZodType>(schema: S) => z.partialRecord(workerRoleSchema, schema);
const reservationSchema = z.strictObject({
  logicalTaskKey: idSchema,
  effectKey: idSchema,
  clientAttemptKey: idSchema,
  role: workerRoleSchema,
  phase: workerPhaseSchema,
  requested: modelSelectionSchema,
  bindings: phaseBindingsSchema,
});
export const persistedControlSchema = z.strictObject({
  stagedQuestions: z.array(boundQuestionSchema),
  questionBatch: questionBatchSchema.nullable(),
  pendingAnswerBatch: answerBatchSchema.nullable(),
  pendingAnswerRevision: answerRevisionSchema.nullable(),
  workerDeadlines: z.record(idSchema, activeDeadlineSchema),
  supersededTaskKeys: z.array(idSchema),
  settledResourceTasks: z.array(idSchema),
  currentWaveQuestionCount: natural,
  phasePayloads: roleRecord(boundWorkerPayloadSchema),
  phaseArtifacts: roleRecord(artifactRefSchema),
  savedResults: z.record(
    idSchema,
    z.strictObject({ payload: boundWorkerPayloadSchema, artifact: artifactRefSchema }),
  ),
  candidate: frozenCandidateSchema.nullable(),
  evidence: z.array(evidenceRecordSchema),
  evidenceHash: hashSchema.nullable(),
  judge: judgeSchema.extend({ binding: attemptBindingSchema }).nullable(),
  judgeHash: hashSchema.nullable(),
  confirmation: confirmationContextSchema.nullable(),
  publications: z.array(
    z.strictObject({
      kind: z.enum(['answer_batch', 'answer_revision']),
      origin: batchOriginSchema.nullable(),
      questionCount: natural,
      contextHash: hashSchema,
      input: z.union([answerBatchSchema, answerRevisionSchema]),
    }),
  ),
  candidateRequested: z.boolean(),
  acceptedEvents: z.record(idSchema, hashSchema),
});
export const runSnapshotSchema = z.strictObject({
  machineVersion: z.literal(1),
  schemaVersion: z.literal(1),
  revision: natural,
  state: controlStateSchema,
  context: z.strictObject({
    request: runRequestSchema,
    config: configSnapshotSchema,
    profile: profileSnapshotSchema,
    sharedContext: sharedContextSchema,
    clarificationBatchesUsed: natural,
    roundsUsed: natural,
    callsReserved: natural,
    phaseResults: z.array(artifactRefSchema),
    extensions: z.array(boundedExtensionSchema),
    effectiveLimits: z.strictObject({
      maxClarificationBatches: positive,
      maxRounds: positive,
      activeBudgetMs: positive,
      maxWorkerCalls: positive,
    }),
    issuedLogicalTasks: z.record(
      idSchema,
      z.strictObject({
        reservation: reservationSchema,
        binding: attemptBindingSchema.nullable(),
        stage: z.enum(['pending_execution', 'dispatched', 'receipt_recorded']),
        settlement: z.enum(['live', 'unverifiable', 'settled']),
      }),
    ),
    requiredEvidenceIds: z.array(idSchema),
    questionLedger: questionLedgerSchema,
    inferenceBlock: idSchema.nullable(),
    pendingEvidenceIds: z.array(idSchema),
    expectedAttempts: roleRecord(attemptBindingSchema),
    objections: z.array(objectionSchema),
    ballots: z.array(ballotSchema),
    pendingOutcome: z.string().nullable(),
    pauseReason: z.string().nullable(),
    resumeTarget: controlStateSchema.nullable(),
    reconcileOriginState: controlStateSchema.nullable(),
    pendingContextUpdate: contextUpdateSchema.nullable(),
    preflightAttestation: artifactRefSchema.nullable(),
    publicationKind: z.enum(['answer_batch', 'answer_revision']).nullable(),
    deadlines: z.array(activeDeadlineSchema),
    activeBudget: activeBudgetSchema,
    control: persistedControlSchema,
  }),
});
