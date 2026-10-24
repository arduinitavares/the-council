import { describe, expect, it } from 'vitest';
import { parseWorkerPayload, bindWorkerPayload, namespaceItem, councilConfigSchema, artifactRefSchema, runRequestSchema, boundedExtensionSchema } from '../../src/domain/schemas.js';
import { makeBinding, rawQuestion, config, H, roundBindings, OTHER } from '../fixtures/builders.js';

const wire = () => ({ kind: 'clarification', ready: false, questions: [rawQuestion()], methodIds: ['test-method'] });
const clarifyBinding = () => makeBinding('openai', { phase: 'clarify', round: 0, clarificationBatch: 1 });
describe('strict worker boundary', () => {
  it('accepts content-only wire output, binds actual provenance and preserves exact text', () => {
    const result = bindWorkerPayload(parseWorkerPayload(wire()), clarifyBinding());
    expect(result.kind).toBe('clarification');
    if (result.kind !== 'clarification') throw Error('wrong kind');
    expect(result.questions[0]).toMatchObject({ id: 'run1/clarify/c1/openai/question/q1', text: '  Exact original question?\n', origin: { seat: 'openai', attemptId: 'attempt-openai' } });
    expect(result.questions[0]).not.toHaveProperty('disposition');
  });
  it.each(['origin', 'owner', 'disposition', 'seat', 'attemptId'])('rejects forged question %s', key => {
    const payload = wire();
    expect(() => parseWorkerPayload({ ...payload, questions: [{ ...rawQuestion(), [key]: 'forged' }] })).toThrow();
  });
  it('rejects forged payload authority, unknown fields and unsafe local IDs', () => {
    expect(() => parseWorkerPayload({ ...wire(), authority: 'forged' })).toThrow();
    expect(() => parseWorkerPayload({ ...wire(), questions: [rawQuestion({ id: '../x' })] })).toThrow();
  });
  it('requires ready to have no questions and non-ready to have questions', () => {
    expect(() => parseWorkerPayload({ ...wire(), ready: true })).toThrow();
    expect(() => parseWorkerPayload({ ...wire(), questions: [] })).toThrow();
  });
  it('keeps two seats using q1 separate and rewrites only local dependencies', () => {
    const binding = clarifyBinding();
    const prior = 'run1/clarify/c1/claude/question/old';
    const p = parseWorkerPayload({ ...wire(), questions: [rawQuestion(), rawQuestion({ id: 'q2', dependencies: [{ kind: 'local', id: 'q1' }, { kind: 'ledger', id: prior }] })] });
    const a = bindWorkerPayload(p, { ...binding, inputQuestionIds: [prior] });
    const b = namespaceItem('question', { ...binding, role: 'gemini' }, 'q1');
    expect(b).toBe('run1/clarify/c1/gemini/question/q1');
    if (a.kind !== 'clarification') throw Error('wrong kind');
    expect(a.questions[1]?.dependencyIds).toEqual(['run1/clarify/c1/openai/question/q1', prior]);
  });
  it('rejects absent receipts, wrong phases/roles, mapping drift and unadmitted methods', () => {
    expect(() => bindWorkerPayload(parseWorkerPayload(wire()), makeBinding())).toThrow();
    expect(() => bindWorkerPayload(parseWorkerPayload(wire()), { ...clarifyBinding(), role: 'judge' })).toThrow();
    expect(() => bindWorkerPayload(parseWorkerPayload(wire()), { ...clarifyBinding(), authority: null } as never)).toThrow();
    expect(() => bindWorkerPayload(parseWorkerPayload(wire()), { ...clarifyBinding(), requested: config.reviewers.gemini })).toThrow();
    expect(() => bindWorkerPayload(parseWorkerPayload(wire()), { ...clarifyBinding(), admittedMethodIds: [] })).toThrow();
  });
  it('rejects cyclic local question dependencies before binding', () => {
    const p = parseWorkerPayload({ ...wire(), questions: [rawQuestion({ dependencies: [{ kind: 'local', id: 'q2' }] }), rawQuestion({ id: 'q2', dependencies: [{ kind: 'local', id: 'q1' }] })] });
    expect(() => bindWorkerPayload(p, clarifyBinding())).toThrow(/cyc/i);
  });
  it.each(['review', 'judge', 'ballot'] as const)('requires the %s kind and actual role mapping', kind => {
    const binding = makeBinding('openai', { phase: kind, role: kind === 'judge' ? 'judge' : 'openai' });
    expect(() => bindWorkerPayload(parseWorkerPayload(wire()), binding)).toThrow();
  });
  it('binds valid review objections open to the actual reviewer', () => {
    const result = bindWorkerPayload(parseWorkerPayload({ kind: 'review', proposals: ['A proposal'], newObjections: [{ id: 'o1', claimId: 'c1', claim: 'Issue', evidenceIds: [], resolution: 'Fix', status: 'open' }], evidenceRequests: [], missingInputQuestions: [], methodIds: [] }), makeBinding('gemini', { phase: 'review' }));
    expect(result).toMatchObject({ kind: 'review', newObjections: [{ id: 'run1/review/r1/gemini/objection/o1', owner: 'gemini', status: 'open', history: [] }] });
  });
  it('rejects judge acceptance fields and binds a valid fresh judge report', () => {
    const { judgeHash: _judgeHash, ...bindings } = roundBindings;
    const judge = { kind: 'judge', bindings, assessments: [], challenges: [], methodIds: [] };
    expect(() => parseWorkerPayload({ ...judge, decision: 'accept' })).toThrow();
    expect(bindWorkerPayload(parseWorkerPayload(judge), makeBinding('openai', { phase: 'judge', role: 'judge' })).kind).toBe('judge');
  });
  it('rejects disposition evidence absent from the frozen packet', () => {
    const id = 'run1/review/r1/openai/objection/o1';
    const ballot = { kind: 'ballot', bindings: roundBindings, decision: 'accept', conditional: false, newObjections: [], missingInputQuestions: [], dispositions: [{ objectionId: id, status: 'closed', reason: 'Resolved', evidenceIds: ['invented'] }], challengeResponses: [], reason: 'Accept', methodIds: [] };
    expect(() => bindWorkerPayload(parseWorkerPayload(ballot), makeBinding('openai', { inputObjectionIds: [id] }))).toThrow(/evidence/i);
  });
  it('rejects a ballot targeting a different input hash rather than replacing it', () => {
    const ballot = { kind: 'ballot', bindings: { ...roundBindings, contextHash: OTHER }, decision: 'accept', conditional: false, newObjections: [], missingInputQuestions: [], dispositions: [], challengeResponses: [], reason: 'Accept', methodIds: [] };
    expect(() => bindWorkerPayload(parseWorkerPayload(ballot), makeBinding())).toThrow();
  });
  it('rejects closed raw objections and same-ballot disposition references', () => {
    const base = { kind: 'ballot', bindings: roundBindings, decision: 'accept', conditional: false, newObjections: [{ id: 'o1', claimId: 'c1', claim: 'Issue', evidenceIds: [], resolution: 'Fix', status: 'open' }], missingInputQuestions: [], dispositions: [], challengeResponses: [], reason: 'Accept', methodIds: [] };
    expect(() => parseWorkerPayload({ ...base, newObjections: [{ ...base.newObjections[0], status: 'closed' }] })).toThrow();
    expect(() => bindWorkerPayload(parseWorkerPayload({ ...base, dispositions: [{ objectionId: 'run1/ballot/r1/openai/objection/o1', status: 'closed', reason: 'Fixed', evidenceIds: [] }] }), makeBinding())).toThrow();
  });
  it('rejects oversized results explicitly', () => {
    expect(() => parseWorkerPayload(JSON.stringify({ ...wire(), padding: 'x'.repeat(1024 * 1024) }))).toThrow(/size|limit|large/i);
  });
  it('validates exact config roster, nonempty settings, hashes and canonical paths', () => {
    expect(councilConfigSchema.parse(config)).toEqual(config);
    expect(() => councilConfigSchema.parse({ ...config, reviewers: { ...config.reviewers, judge: config.judge } })).toThrow();
    expect(() => councilConfigSchema.parse({ ...config, judge: { ...config.judge, effort: '' } })).toThrow();
    expect(() => artifactRefSchema.parse({ kind: 'x', sha256: H, path: '/tmp/../private', bytes: 1 })).toThrow();
    expect(() => artifactRefSchema.parse({ kind: 'x', sha256: 'bad', path: '/tmp/x', bytes: 1 })).toThrow();
  });
  it('validates complete frozen run inputs and positive integer limits without literal-only defaults', () => {
    const artifact = { kind: 'input', sha256: H, path: '/tmp/input', bytes: 1 };
    const request = {
      runId: 'run1', workspace: '/tmp/workspace', topic: 'Topic', handoffPath: '/tmp/handoff', handoffHash: H,
      config: { sourcePath: '/tmp/council.yaml', rawSha256: H, rawArtifact: artifact, configArtifact: artifact, configHash: H, resolved: config },
      profile: { manifest: artifact, profileHash: H, admittedMethodIds: [], sources: [], adaptations: [] },
      sharedContext: { contextRevision: 0, contextHash: H, topic: artifact, handoff: artifact, questionLedgerRefs: [], answerLedgerRefs: [], userDirections: [] },
      scope: { sourceRoots: ['/tmp/workspace'], allowedSourceAddresses: [], checks: [] },
      maxClarificationBatches: 4, maxRounds: 5, workerTimeoutMs: 100, activeBudgetMs: 1000,
    };
    expect(runRequestSchema.parse(request)).toEqual(request);
    expect(() => runRequestSchema.parse({ ...request, maxRounds: 0 })).toThrow();
    expect(() => runRequestSchema.parse({ ...request, activeBudgetMs: 0.5 })).toThrow();
    expect(() => runRequestSchema.parse({ ...request, profile: { ...request.profile, install: true } })).toThrow();
    expect(() => runRequestSchema.parse({ ...request, workspace: '/tmp/../private' })).toThrow();
  });
  it('requires a bounded extension to add a nonnegative authorized amount', () => {
    const extension = { id: 'ext1', baseRevision: 1, authorizationReceipt: 'user-receipt', expiresAt: 20000, additionalClarificationBatches: 0, additionalRounds: 1, additionalActiveBudgetMs: 0 };
    expect(boundedExtensionSchema.parse(extension)).toEqual(extension);
    expect(() => boundedExtensionSchema.parse({ ...extension, additionalRounds: 0 })).toThrow();
    expect(() => boundedExtensionSchema.parse({ ...extension, additionalRounds: -1 })).toThrow();
    expect(() => boundedExtensionSchema.parse({ ...extension, authorizationReceipt: '' })).toThrow();
  });
});
