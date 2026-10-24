import { mkdirSync, mkdtempSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseCouncilConfig } from '../../src/config/load.js';
import { canonicalJson, hashArtifact } from '../../src/domain/hash.js';
import type { JsonValue, WorkerRole } from '../../src/domain/contracts.js';
import { freezeProfile, initialProfileInput } from '../../src/input/profiles.js';
import { runPreflight, type PreflightInput } from '../../src/policy/preflight.js';

function fixture(): PreflightInput {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'preflight-'))), config = parseCouncilConfig(readFileSync(new URL('../../council.yaml', import.meta.url)));
  const profile = freezeProfile(initialProfileInput(join(root, 'artifacts'))), bytes = Buffer.from('Current human policy; interpreted by caller.');
  const policyHash = createHash('sha256').update(bytes).digest('hex');
  const policyPath = join(root, 'policy.md'), handoffPath = join(root, 'handoff.md'); writeFileSync(policyPath, bytes); writeFileSync(handoffPath, 'Decision context');
  const selections = [...Object.entries(config.reviewers), ['judge', config.judge]] as [WorkerRole, typeof config.judge][];
  return {
    runId: 'run1', now: 1000, host: 'local-mac', versions: { orca: '1', codex: '2', antigravity: '3' }, config, configHash: hashArtifact('council-config', config as unknown as JsonValue), profile, artifactRoot: join(root, 'artifacts'),
    handoff: { path: handoffPath, hash: createHash('sha256').update('Decision context').digest('hex') }, sourceManifest: [],
    policy: { path: policyPath, bytes, hash: policyHash, readReceipt: 'policy-read', admitted: selections.map(([role, selection]) => ({ role, ...selection })), maxVisibleWorkstreams: 4, maxAstra: 1, astraModels: ['gpt-6-astra'] },
    authorization: { id: 'approval', runId: 'run1', policyHash, configHash: hashArtifact('council-config', config as unknown as JsonValue), profileHash: profile.profileHash, selections: selections.map(([role, selection]) => ({ role, ...selection })), expiresAt: 10000, maxWorkerCalls: 27, maxActiveMs: 10800000, extraAstraSlots: 0, purpose: 'Bounded Council run' },
    bounds: { maxWorkerCalls: 27, activeMs: 10800000 }, caller: { model: 'gpt-6.1-sol', receiptId: 'caller-observed' }, activeWorkers: [], scope: { sourceRoots: [root], allowedSourceAddresses: [], checks: [] },
    catalog: selections.map(([, selection]) => ({ ...selection, family: selection.model.startsWith('gpt-') ? 'openai' as const : selection.model.startsWith('claude-') ? 'claude' as const : 'gemini' as const, efforts: [selection.effort], receiptId: 'catalog', expiresAt: 10000 })),
    qualifications: [...new Map(selections.map(([, selection]) => [canonicalJson(selection), selection])).values()].map(selection => ({ id: 'qualified-' + selection.model, host: 'local-mac', versions: { orca: '1', codex: '2', antigravity: '3' }, actionClass: 'supplied-packet-read-only' as const, requested: selection, exposed: selection, expiresAt: 10000, throughOrca: true, helpersDisabled: true, terminalSandbox: true, accessControlled: true, roots: [], receiptRefs: ['qualification-receipt'] })),
    access: { actionClass: 'supplied-packet-read-only', requiredRoots: [], grantedRoots: [], receiptId: 'access' }, allowance: [{ route: 'codex', group: 'subscription', state: 'unknown', receiptId: 'quota' }, { route: 'antigravity', group: 'subscription', state: 'available', receiptId: 'quota' }],
  };
}
describe('attested dynamic model and launch admission', () => {
  it('requires current evidence and separates reasons', () => {
    const good = fixture(); expect(runPreflight(good).kind).toBe('ready');
    const cases: [string, (x: PreflightInput) => void][] = [
      ['CALLER_MODEL_UNKNOWN', x => { x.caller.model = null; }],
      ['CALLER_MODEL_UNKNOWN', x => { x.caller.model = 'astra'; }],
      ['CALLER_MODEL_UNKNOWN', x => { x.caller.model = ' gpt-6-astra'; }],
      ['ASTRA_CALLER_CONFLICT', x => { x.caller.model = 'gpt-6-astra'; }],
      ['MODEL_FAMILY_MISMATCH', x => { x.catalog[0]!.family = 'claude'; }],
      ['MODEL_UNAVAILABLE', x => { x.catalog = []; }],
      ['EFFORT_UNSUPPORTED', x => { x.catalog[0]!.efforts = ['low']; }],
      ['UNQUALIFIED_ROUTE', x => { x.qualifications = []; }],
      ['EFFECTIVE_SETTINGS_UNKNOWN', x => { x.qualifications[0]!.exposed = null; }],
      ['EFFECTIVE_SETTINGS_MISMATCH', x => { x.qualifications[0]!.exposed = { ...x.config.reviewers.openai, effort: 'high' }; }],
      ['POLICY_HASH_MISMATCH', x => { x.policy.hash = 'a'.repeat(64); }],
      ['CONFIG_HASH_MISMATCH', x => { x.configHash = 'b'.repeat(64); }],
      ['PROFILE_HASH_MISMATCH', x => { x.profile.profileHash = 'b'.repeat(64); }],
      ['AUTHORIZATION_INVALID', x => { x.authorization.expiresAt = 1; }],
      ['AUTHORIZATION_INVALID', x => { x.bounds.maxWorkerCalls = 28; }],
      ['WORKSTREAM_LIMIT', x => { x.activeWorkers.push({ id: 'foreign-worker', model: 'claude-sonnet-5-5-high', receiptId: 'observed' }); }],
      ['UNQUALIFIED_ROUTE', x => { x.qualifications[0]!.helpersDisabled = false; }],
      ['QUOTA_EXHAUSTED', x => { x.allowance[0]!.state = 'exhausted'; }],
      ['PERMISSION_DENIED', x => { x.allowance[0]!.state = 'denied'; }],
      ['AUTHENTICATION_FAILED', x => { x.allowance[0]!.state = 'authentication_failed'; }],
    ];
    for (const [reason, mutate] of cases) { const input = structuredClone(good); mutate(input); expect(runPreflight(input).reason, reason).toBe(reason); }
  });
  it('checks current policy, temporary context and the frozen source manifest', () => {
    const changedPolicy = fixture(); writeFileSync(changedPolicy.policy.path, 'Changed policy');
    expect(runPreflight(changedPolicy).reason).toBe('POLICY_HASH_MISMATCH');
    const missing = fixture(); unlinkSync(missing.handoff.path);
    expect(runPreflight(missing)).toMatchObject({ kind: 'needs_context', reason: 'HANDOFF_MISSING' });
    const altered = fixture(); writeFileSync(altered.handoff.path, 'Changed');
    expect(runPreflight(altered)).toMatchObject({ kind: 'needs_context', reason: 'HANDOFF_HASH_MISMATCH' });
    const foreign = fixture(); foreign.sourceManifest.push({ address: 'https://unapproved.example/source', hash: 'a'.repeat(64), receiptId: 'source', artifact: null });
    expect(runPreflight(foreign).reason).toBe('SOURCE_MANIFEST_DENIED');
    const profile = fixture(); writeFileSync(profile.profile.manifest.path, '{}');
    expect(runPreflight(profile)).toMatchObject({ kind: 'needs_context', reason: 'PROFILE_UNAVAILABLE' });
  });
  it('rejects broad or nonexistent effective grants and a control without path-specific qualification', () => {
    const broad = fixture(); broad.access.grantedRoots = [realpathSync(tmpdir())];
    expect(runPreflight(broad).reason).toBe('ACCESS_ROOT_DENIED');
    const missing = fixture(); missing.access.requiredRoots = ['/not/a/real/root'];
    expect(() => runPreflight(missing)).not.toThrow(); expect(runPreflight(missing).kind).toBe('blocked');
    const unqualified = fixture(); unqualified.scopeControls = [{ path: unqualified.policy.path, receiptId: 'deny', qualificationId: unqualified.qualifications[0]!.id }];
    expect(runPreflight(unqualified).reason).toBe('ACCESS_CONTROL_UNQUALIFIED');
  });
  it('keeps source scope separate from actual worker grants in a normal repository', () => {
    const x = fixture(), root = x.scope.sourceRoots[0]!;
    for (const path of ['.git', '.council']) mkdirSync(join(root, path));
    for (const path of ['AGENTS.md', '.env']) writeFileSync(join(root, path), 'protected');
    expect(runPreflight(x).kind).toBe('ready');
    x.access = { ...x.access, actionClass: 'source-read-only', requiredRoots: [root], grantedRoots: [root] };
    for (const qualification of x.qualifications) { qualification.actionClass = 'source-read-only'; qualification.roots = [root]; }
    expect(runPreflight(x).reason).toBe('SCOPE_PROTECTED_PATH');
    const source = join(root, 'src'); mkdirSync(source); writeFileSync(join(source, 'code.ts'), 'source');
    x.access.requiredRoots = [source]; x.access.grantedRoots = [source];
    for (const qualification of x.qualifications) qualification.roots = [source];
    expect(runPreflight(x).kind).toBe('ready');
  });
  it('admits attested same-family replacements only with new qualification and no false Astra caller conflict', () => {
    const x = fixture(); x.caller.model = 'gpt-6-astra';
    const replace = (model: string, effort: string) => {
      for (const role of ['openai', 'judge'] as const) {
        const selection = { route: 'codex' as const, model, effort };
        if (role === 'judge') x.config.judge = selection; else x.config.reviewers.openai = selection;
        for (const list of [x.policy.admitted, x.authorization.selections]) { const i = list.findIndex(s => s.role === role); list[i] = { role, ...selection }; }
      }
      x.configHash = hashArtifact('council-config', x.config as unknown as JsonValue); x.authorization.configHash = x.configHash;
      x.catalog.push({ route: 'codex', model, effort, family: 'openai', efforts: [effort], receiptId: 'new-catalog', expiresAt: 10000 });
    };
    replace('gpt-6.1-sol', 'max'); expect(runPreflight(x).reason).toBe('UNQUALIFIED_ROUTE');
    x.qualifications.push({ ...x.qualifications[0]!, requested: x.config.judge, exposed: x.config.judge }); expect(runPreflight(x).kind).toBe('ready');
    x.config.judge = { route: 'codex', model: 'gpt-6-astra', effort: 'ultra' }; x.configHash = hashArtifact('council-config', x.config as unknown as JsonValue); x.authorization.configHash = x.configHash;
    x.policy.admitted.push({ role: 'judge', ...x.config.judge }); x.authorization.selections.push({ role: 'judge', ...x.config.judge });
    expect(runPreflight(x).reason).toBe('ASTRA_CALLER_CONFLICT');
    x.authorization.extraAstraSlots = 1; expect(runPreflight(x).kind).toBe('ready');
    expect(canonicalJson(x.config)).toContain('gpt-6.1-sol');
  });
  it('admits a separately qualified Sonnet judge and follows attested concurrency groups for new exact model IDs', () => {
    const x = fixture(), selection = { route: 'antigravity' as const, model: 'claude-sonnet-5-5-high', effort: 'high' };
    x.config.judge = selection; x.configHash = hashArtifact('council-config', x.config as unknown as JsonValue); x.authorization.configHash = x.configHash;
    x.policy.admitted.push({ role: 'judge', ...selection }); x.authorization.selections.push({ role: 'judge', ...selection });
    x.catalog.push({ ...selection, family: 'claude', efforts: ['high'], receiptId: 'sonnet-catalog', expiresAt: 10000 });
    x.qualifications.push({ ...x.qualifications[2]!, requested: selection, exposed: selection });
    expect(runPreflight(x).kind).toBe('ready');
    x.policy.astraModels.push('new-astra-model9'); x.caller.model = 'new-astra-model9';
    expect(runPreflight(x).reason).toBe('ASTRA_CALLER_CONFLICT');
  });
  it('keeps independent exposed allowance groups bound to their declared models', () => {
    const x = fixture(); x.allowance.push({ route: 'codex', group: 'other-model-group', state: 'exhausted', receiptId: 'other-quota', models: ['unassigned-model9'] });
    expect(runPreflight(x).kind).toBe('ready');
    x.allowance.at(-1)!.models = ['gpt-6-astra'];
    expect(runPreflight(x)).toMatchObject({ kind: 'blocked', reason: 'QUOTA_EXHAUSTED', receiptRefs: ['other-quota'] });
  });
  it('admits only the pending judge or missing reviewer with actual active workers counted once', () => {
    const judge = fixture(); judge.pendingAssignment = { phase: 'judge', roles: ['judge'], receiptId: 'pending-judge' };
    judge.activeWorkers = [{ id: 'other-a', model: 'gpt-6.1-sol', receiptId: 'a' }, { id: 'other-b', model: 'claude-sonnet-5-5-high', receiptId: 'b' }];
    expect(runPreflight(judge)).toMatchObject({ kind: 'ready', admission: { kind: 'phase', phase: 'judge', assignments: [{ role: 'judge', selection: judge.config.judge }] } });
    const recovery = fixture(); recovery.pendingAssignment = { phase: 'review', roles: ['claude'], receiptId: 'unissued-claude' };
    recovery.activeWorkers = [
      { id: 'owned-openai', model: 'gpt-6-astra', receiptId: 'openai-live', assignment: { runId: 'run1', phase: 'review', role: 'openai', logicalTaskKey: 'review-openai' } },
      { id: 'owned-gemini', model: 'gemini-4-argon-high', receiptId: 'gemini-live', assignment: { runId: 'run1', phase: 'review', role: 'gemini', logicalTaskKey: 'review-gemini' } },
    ];
    const decision = runPreflight(recovery);
    expect(decision).toMatchObject({ kind: 'ready', admission: { assignments: [{ role: 'claude', selection: recovery.config.reviewers.claude }], observationReceiptRefs: ['openai-live', 'gemini-live'], assignmentReceiptId: 'unissued-claude' } });
    if (decision.kind === 'ready') expect(decision.admission.setHash).toMatch(/^[a-f0-9]{64}$/);
    const activeAstra = fixture(); activeAstra.pendingAssignment = { phase: 'review', roles: ['gemini'], receiptId: 'only-gemini' };
    activeAstra.activeWorkers = [{ id: 'astra', model: 'gpt-6-astra', receiptId: 'astra-live' }];
    expect(runPreflight(activeAstra).kind).toBe('ready');
    activeAstra.activeWorkers[0]!.assignment = undefined;
    expect(() => runPreflight(activeAstra)).not.toThrow(); expect(runPreflight(activeAstra).kind).toBe('ready');
    recovery.pendingAssignment.roles = ['openai']; expect(runPreflight(recovery).reason).toBe('ASSIGNMENT_ALREADY_ACTIVE');
  });
  it('rejects duplicate or phase-invalid roles without changing the frozen selections or limits', () => {
    for (const pendingAssignment of [
      { phase: 'judge', roles: ['openai'], receiptId: 'wrong-role' },
      { phase: 'review', roles: ['judge'], receiptId: 'wrong-phase' },
      { phase: 'review', roles: ['claude', 'claude'], receiptId: 'duplicate' },
      { phase: 'review', roles: [], receiptId: 'empty' },
      { phase: 'review', roles: ['claude'], receiptId: 'override', model: 'other-model9' },
    ]) {
      const x = fixture(); Object.assign(x, { pendingAssignment }); expect(runPreflight(x).kind).toBe('blocked');
    }
    const x = fixture(); x.pendingAssignment = { phase: 'review', roles: ['gemini'], receiptId: 'new' };
    x.activeWorkers = [{ id: 'same', model: 'gpt-6-astra', receiptId: 'a' }, { id: 'same', model: 'gpt-6-astra', receiptId: 'b' }];
    expect(runPreflight(x).reason).toBe('ACTIVE_OBSERVATION_INVALID');
  });
});
