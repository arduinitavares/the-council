import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractVerificationDependencies,
  evaluateToolFreeEvidenceReadiness,
  resolveRetryModelAndEffort,
  validateRetryFallbackCapability,
  planParticipantRecovery,
  resolveConfig,
  validateConfig,
  CouncilEngine
} from '../../src/engine/index.js';
import { transitionCouncil } from '../../src/machine/reducer.js';
import { createInitialCouncilState } from '../../src/machine/state.js';
import { MockAdapter } from '../../src/harness/mock.js';
import {
  HeadlessToolDeniedError,
  TimeoutError,
  InvalidResponseError,
  QuotaExhaustionError
} from '../../src/harness/adapter.js';

describe('Issue #102 Task 3 Core: Recovery Policy, Config Metadata, & Reducer Retry Diagnostics', () => {
  describe('extractVerificationDependencies', () => {
    it('extracts file/line/single-segment/broad/URL dependencies while ignoring ellipses, versions, and framework names', () => {
      const deps = extractVerificationDependencies([
        'Inspect src/auth.js:120-145, a.js, src/engine/, and https://datatracker.ietf.org/doc/html/rfc9110, on Node.js v22.1.0 ... ready.'
      ]);
      assert.deepEqual(deps.workspaceFileDeps, [
        { source: 'src/auth.js', startLine: 120, endLine: 145 },
        { source: 'a.js', unbounded: true }
      ]);
      assert.ok(deps.workspaceBroadDeps.includes('src/engine/'));
      assert.deepEqual(deps.externalDeps, ['https://datatracker.ietf.org/doc/html/rfc9110']);
    });

    it('detects glob dependencies such as src/** and **/*.js while ignoring prose ellipses', () => {
      const deps = extractVerificationDependencies([
        'Scan src/** and **/*.js ... check ./foo.ts:10-20.'
      ]);
      assert.ok(deps.workspaceBroadDeps.includes('src/**'));
      assert.ok(deps.workspaceBroadDeps.includes('**/*.js'));
      assert.deepEqual(deps.workspaceFileDeps, [
        { source: 'foo.ts', startLine: 10, endLine: 20 }
      ]);
    });

    it('extracts file:// URLs alongside http/https URLs without treating URL subpaths as workspace files', () => {
      const deps = extractVerificationDependencies([
        'Compare file:///opt/specs/policy.md and https://example.org/spec.'
      ]);
      assert.deepEqual(deps.externalDeps, [
        'file:///opt/specs/policy.md',
        'https://example.org/spec'
      ]);
      assert.deepEqual(deps.workspaceFileDeps, []);
      assert.deepEqual(deps.workspaceBroadDeps, []);
    });
  });

  describe('evaluateToolFreeEvidenceReadiness', () => {
    it('refuses HeadlessToolDeniedError when originalTools was already none even with conceptual contract', () => {
      const res = evaluateToolFreeEvidenceReadiness({
        phase: 'DELIBERATION',
        round: 1,
        errorClass: 'HeadlessToolDeniedError',
        topic: 'Pure conceptual question',
        selfContainedInput: {
          phases: ['DELIBERATION'],
          conceptualNoExternalVerification: true
        },
        originalInvocationMeta: { effectiveTools: 'none', effectiveCwd: undefined }
      });
      assert.equal(res.ready, false);
      assert.equal(res.reasonCode, 'evidence_access_failure');
    });

    it('permits TimeoutError recovery when originalTools was already none and phase prerequisites hold', () => {
      assert.equal(
        evaluateToolFreeEvidenceReadiness({
          phase: 'DELIBERATION',
          round: 1,
          errorClass: 'TimeoutError',
          topic: 'Conceptual question',
          originalInvocationMeta: { effectiveTools: 'none' }
        }).ready,
        true
      );
      assert.equal(
        evaluateToolFreeEvidenceReadiness({
          phase: 'DELIBERATION',
          round: 2,
          errorClass: 'TimeoutError',
          topic: 'Conceptual question',
          previousCandidate: null,
          openObjections: [],
          originalInvocationMeta: { effectiveTools: 'none' }
        }).ready,
        false
      );
      assert.equal(
        evaluateToolFreeEvidenceReadiness({
          phase: 'JUDGE_AUDIT_SYNTHESIS',
          round: 1,
          errorClass: 'TimeoutError',
          proofs: [{ id: 'P1', kind: 'check', source: 'Spec', statement: 'Ok' }],
          originalInvocationMeta: { effectiveTools: 'none' }
        }).ready,
        true
      );
      assert.equal(
        evaluateToolFreeEvidenceReadiness({
          phase: 'VOTING',
          round: 1,
          errorClass: 'TimeoutError',
          candidate: { round: 1, summary: 'Sum', clauses: [] },
          originalInvocationMeta: { effectiveTools: 'none' }
        }).ready,
        true
      );
    });

    it('rejects partial/irrelevant [E1] stubs, roundScope round_1_only in Round 2, and unverified cwd timeouts', () => {
      const resStub = evaluateToolFreeEvidenceReadiness({
        phase: 'DELIBERATION',
        round: 1,
        errorClass: 'TimeoutError',
        topic: 'Using [E1], verify token expiry in src/auth.js',
        evidence: [{ id: 'E1', label: 'Header', source: 'src/auth.js', text: '// Copyright 2026' }],
        originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo' }
      });
      assert.equal(resStub.ready, false);
      assert.equal(resStub.reasonCode, 'evidence_access_failure');

      // Partial line coverage { startLine: 1, endLine: 5 } MUST be refused for unbounded src/auth.js or 120-145
      const resPartialLines = evaluateToolFreeEvidenceReadiness({
        phase: 'DELIBERATION',
        round: 1,
        errorClass: 'TimeoutError',
        topic: 'Verify token expiry in src/auth.js:120-145',
        evidence: [{ id: 'E1', label: 'Header', source: 'src/auth.js', text: '// Copyright 2026' }],
        selfContainedInput: {
          phases: ['DELIBERATION'],
          coveredArtifacts: [{ source: 'src/auth.js', evidenceId: 'E1', coverage: { startLine: 1, endLine: 5 } }]
        },
        originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo' }
      });
      assert.equal(resPartialLines.ready, false);

      const resPartialUnbounded = evaluateToolFreeEvidenceReadiness({
        phase: 'DELIBERATION',
        round: 1,
        errorClass: 'TimeoutError',
        topic: 'Verify token expiry in src/auth.js',
        evidence: [{ id: 'E1', label: 'Header', source: 'src/auth.js', text: '// Copyright 2026' }],
        selfContainedInput: {
          phases: ['DELIBERATION'],
          coveredArtifacts: [{ source: 'src/auth.js', evidenceId: 'E1', coverage: { startLine: 1, endLine: 5 } }]
        },
        originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo' }
      });
      assert.equal(resPartialUnbounded.ready, false);

      // Round > 1 requires roundScope === 'all_rounds'
      const resRound2Blocked = evaluateToolFreeEvidenceReadiness({
        phase: 'DELIBERATION',
        round: 2,
        errorClass: 'TimeoutError',
        topic: 'Conceptual topic',
        previousCandidate: { round: 1, summary: 'Prev', clauses: [] },
        openObjections: [{ id: 'O1', seatId: 's2', proofId: 'P1', reason: 'Dispute' }],
        selfContainedInput: {
          phases: ['DELIBERATION'],
          conceptualNoExternalVerification: true
        },
        originalInvocationMeta: { effectiveTools: 'read-only' }
      });
      assert.equal(resRound2Blocked.ready, false);

      // Valid complete_artifact covers unbounded src/auth.js
      const resCovered = evaluateToolFreeEvidenceReadiness({
        phase: 'DELIBERATION',
        round: 1,
        errorClass: 'TimeoutError',
        topic: 'Verify src/auth.js',
        evidence: [{ id: 'E1', label: 'Auth', source: 'src/auth.js', text: 'export function checkTokenExpiry() { return true; }' }],
        selfContainedInput: {
          phases: ['DELIBERATION'],
          coveredArtifacts: [{ source: 'src/auth.js', evidenceId: 'E1', coverage: 'complete_artifact' }]
        },
        originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo' }
      });
      assert.equal(resCovered.ready, true);

      // Enclosing line coverage satisfies line-bounded dependency
      const resEnclosing = evaluateToolFreeEvidenceReadiness({
        phase: 'DELIBERATION',
        round: 1,
        errorClass: 'HeadlessToolDeniedError',
        topic: 'Verify src/auth.js:120-145',
        evidence: [{ id: 'E1', label: 'Auth slice', source: 'src/auth.js', text: 'function check() {}' }],
        selfContainedInput: {
          phases: ['DELIBERATION'],
          coveredArtifacts: [{ source: 'src/auth.js', evidenceId: 'E1', coverage: { startLine: 100, endLine: 160 } }]
        },
        originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo' }
      });
      assert.equal(resEnclosing.ready, true);
    });

    it('enforces Spec §1 line 119: refuses open-ended Delib R1 when effectiveCwd is set and workspaceFileDeps is empty, even with unrelated coveredArtifacts', () => {
      const resOpenEnded = evaluateToolFreeEvidenceReadiness({
        phase: 'DELIBERATION',
        round: 1,
        errorClass: 'TimeoutError',
        topic: 'Audit the repository architecture for subtle defects',
        evidence: [{ id: 'E1', label: 'Readme', source: 'README.md', text: 'Overview text' }],
        selfContainedInput: {
          phases: ['DELIBERATION'],
          coveredArtifacts: [{ source: 'README.md', evidenceId: 'E1', coverage: 'complete_artifact' }]
        },
        originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo' }
      });
      assert.equal(resOpenEnded.ready, false);
      assert.equal(resOpenEnded.reasonCode, 'evidence_access_failure');
    });

    it('refuses conceptualNoExternalVerification for HeadlessToolDeniedError, attached effectiveCwd, URLs, and external benchmark proofs', () => {
      // Rejects HeadlessToolDeniedError
      assert.equal(
        evaluateToolFreeEvidenceReadiness({
          phase: 'DELIBERATION',
          round: 1,
          errorClass: 'HeadlessToolDeniedError',
          topic: 'Conceptual question',
          selfContainedInput: {
            phases: ['DELIBERATION'],
            conceptualNoExternalVerification: true
          },
          originalInvocationMeta: { effectiveTools: 'read-only' }
        }).ready,
        false
      );

      // Rejects attached effectiveCwd
      assert.equal(
        evaluateToolFreeEvidenceReadiness({
          phase: 'DELIBERATION',
          round: 1,
          errorClass: 'TimeoutError',
          topic: 'Conceptual question',
          selfContainedInput: {
            phases: ['DELIBERATION'],
            conceptualNoExternalVerification: true
          },
          originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo' }
        }).ready,
        false
      );

      // Rejects external URL even without cwd
      assert.equal(
        evaluateToolFreeEvidenceReadiness({
          phase: 'DELIBERATION',
          round: 1,
          errorClass: 'TimeoutError',
          topic: 'Verify https://datatracker.ietf.org/doc/html/rfc9110',
          selfContainedInput: {
            phases: ['DELIBERATION'],
            conceptualNoExternalVerification: true
          },
          originalInvocationMeta: { effectiveTools: 'read-only' }
        }).ready,
        false
      );

      // Rejects external kind: 'benchmark' source absent from coveredArtifacts during JUDGE_AUDIT_SYNTHESIS
      assert.equal(
        evaluateToolFreeEvidenceReadiness({
          phase: 'JUDGE_AUDIT_SYNTHESIS',
          round: 1,
          errorClass: 'TimeoutError',
          topic: 'Throughput analysis',
          proofs: [{ id: 'P1', kind: 'benchmark', source: 'TechEmpower Round 22', statement: '120k req/s' }],
          selfContainedInput: {
            phases: ['JUDGE_AUDIT_SYNTHESIS'],
            conceptualNoExternalVerification: true
          },
          originalInvocationMeta: { effectiveTools: 'read-only' }
        }).ready,
        false
      );
    });

    it('scans clarifications in Delib R1, enforces admittedProofs on tool-removing VOTING, and handles kind: check claims', () => {
      // Clarifications file dependency rejects conceptualNoExternalVerification in Delib R1
      const clarifFileBlocked = evaluateToolFreeEvidenceReadiness({
        phase: 'DELIBERATION',
        round: 1,
        errorClass: 'TimeoutError',
        topic: 'Conceptual architecture question',
        clarifications: [{ batch: 1, answer: 'Focus specifically on src/auth.js:10-20' }],
        selfContainedInput: {
          phases: ['DELIBERATION'],
          conceptualNoExternalVerification: true
        },
        originalInvocationMeta: { effectiveTools: 'read-only' }
      });
      assert.equal(clarifFileBlocked.ready, false);

      // VOTING with removesTools: true refuses missing/empty admittedProofs
      const votingMissingAdmitted = evaluateToolFreeEvidenceReadiness({
        phase: 'VOTING',
        round: 1,
        errorClass: 'TimeoutError',
        candidate: { round: 1, summary: 'Sum', clauses: [] },
        admittedProofs: [],
        selfContainedInput: {
          phases: ['VOTING'],
          conceptualNoExternalVerification: true
        },
        originalInvocationMeta: { effectiveTools: 'read-only' }
      });
      assert.equal(votingMissingAdmitted.ready, false);

      // VOTING with admittedProofs having kind: 'check' command/repo claim refuses tool-free recovery
      const votingCmdCheck = evaluateToolFreeEvidenceReadiness({
        phase: 'VOTING',
        round: 1,
        errorClass: 'TimeoutError',
        candidate: { round: 1, summary: 'Sum', clauses: [] },
        admittedProofs: [{ id: 'P1', kind: 'check', source: 'npm test', statement: 'Ran full test suite' }],
        selfContainedInput: {
          phases: ['VOTING'],
          conceptualNoExternalVerification: true
        },
        originalInvocationMeta: { effectiveTools: 'read-only' }
      });
      assert.equal(votingCmdCheck.ready, false);

      // JUDGE_AUDIT_SYNTHESIS with kind: 'check' external source rejects conceptualNoExternalVerification
      const checkExternal = evaluateToolFreeEvidenceReadiness({
        phase: 'JUDGE_AUDIT_SYNTHESIS',
        round: 1,
        errorClass: 'TimeoutError',
        proofs: [{ id: 'P1', kind: 'check', source: 'RFC 9110 Section 15', statement: 'HTTP status verification' }],
        selfContainedInput: {
          phases: ['JUDGE_AUDIT_SYNTHESIS'],
          conceptualNoExternalVerification: true
        },
        originalInvocationMeta: { effectiveTools: 'read-only' }
      });
      assert.equal(checkExternal.ready, false);

      // VOTING with valid admittedProofs conceptual check & effectiveTools: 'read-only' succeeds
      const votingConceptualOk = evaluateToolFreeEvidenceReadiness({
        phase: 'VOTING',
        round: 1,
        errorClass: 'TimeoutError',
        candidate: { round: 1, summary: 'Sum', clauses: [] },
        admittedProofs: [{ id: 'P1', kind: 'check', source: 'Deterministic mock check', statement: 'Logical invariant holds' }],
        selfContainedInput: {
          phases: ['VOTING'],
          conceptualNoExternalVerification: true
        },
        originalInvocationMeta: { effectiveTools: 'read-only' }
      });
      assert.equal(votingConceptualOk.ready, true);
    });
  });

  describe('planParticipantRecovery precedence & single tool-free limit', () => {
    it('enforces exact 7-step precedence and blocks ALL subsequent errors after toolFreeRecoveryUsed === true', () => {
      // 1. Non-retryable beats retries_exhausted
      const nonRetryable = planParticipantRecovery({
        participantId: 's1',
        role: 'seat',
        error: new Error('Auth failed'),
        errorClass: 'AuthenticationError',
        isRetryable: false,
        retries: 5,
        maxRetries: 1,
        toolFreeRecoveryUsed: true
      });
      assert.equal(nonRetryable.canRetry, false);
      assert.equal(nonRetryable.terminationKind, 'non_retryable');

      // 2. Retries exhausted beats toolFreeRecoveryUsed
      const exhausted = planParticipantRecovery({
        participantId: 's1',
        role: 'seat',
        error: new Error('Bad JSON'),
        errorClass: 'InvalidResponseError',
        isRetryable: true,
        retries: 2,
        maxRetries: 2,
        toolFreeRecoveryUsed: true
      });
      assert.equal(exhausted.canRetry, false);
      assert.equal(exhausted.terminationKind, 'retries_exhausted');

      // 3. Single tool-free recovery guard blocks ALL subsequent error classes
      for (const errorClass of [
        'InvalidResponseError',
        'QuotaExhaustionError',
        'TimeoutError',
        'HeadlessToolDeniedError',
        'HarnessExecutionError'
      ]) {
        const afterToolFree = planParticipantRecovery({
          participantId: 's1',
          role: 'seat',
          error: { message: `Subsequent ${errorClass}`, code: errorClass === 'HeadlessToolDeniedError' ? 'HEADLESS_TOOL_DENIED' : undefined },
          errorClass,
          isRetryable: true,
          retries: 1,
          maxRetries: 3,
          remainingBudget: 50000,
          minViable: 5000,
          toolFreeRecoveryUsed: true,
          originalAttemptTools: 'none'
        });
        assert.equal(afterToolFree.canRetry, false);
        assert.equal(afterToolFree.terminationKind, 'tool_free_already_used');
      }

      // 4. Budget exhausted
      const lowBudget = planParticipantRecovery({
        participantId: 's1',
        role: 'seat',
        error: new Error('Quota'),
        errorClass: 'QuotaExhaustionError',
        isRetryable: true,
        retries: 0,
        maxRetries: 2,
        remainingBudget: 4999,
        minViable: 5000,
        toolFreeRecoveryUsed: false
      });
      assert.equal(lowBudget.canRetry, false);
      assert.equal(lowBudget.terminationKind, 'budget_exhausted');
    });

    it('handles HeadlessToolDeniedError (passed via error object/errorClass) and preserves tools/effort on QuotaExhaustionError', () => {
      // Denied without selfContainedInput -> evidence_access_failure
      const deniedUnattested = planParticipantRecovery({
        participantId: 's1',
        role: 'seat',
        error: { message: 'Bash denied in headless mode', code: 'HEADLESS_TOOL_DENIED' },
        errorClass: 'HeadlessToolDeniedError',
        isRetryable: true,
        retries: 0,
        maxRetries: 1,
        remainingBudget: 50000,
        minViable: 5000,
        toolFreeRecoveryUsed: false,
        originalAttemptTools: 'read-only',
        phase: 'DELIBERATION',
        round: 1,
        topic: 'Inspect src/index.js',
        originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo', configuredWorkspaceCwd: '/repo' }
      });
      assert.equal(deniedUnattested.canRetry, false);
      assert.equal(deniedUnattested.terminationKind, 'evidence_access_failure');
      assert.match(
        deniedUnattested.reason,
        /^Tool-free recovery refused \(insufficient self-contained evidence: [^)]+\): Bash denied in headless mode$/
      );

      // Denied WITH complete_artifact coverage -> approved tool-free retry + setsToolFreeRecoveryUsed
      const deniedAttested = planParticipantRecovery({
        participantId: 's1',
        role: 'seat',
        error: { message: 'Bash denied in headless mode', code: 'HEADLESS_TOOL_DENIED' },
        errorClass: 'HeadlessToolDeniedError',
        isRetryable: true,
        retries: 0,
        maxRetries: 2,
        remainingBudget: 60000,
        minViable: 5000,
        toolFreeRecoveryUsed: false,
        originalAttemptTools: 'read-only',
        phase: 'DELIBERATION',
        round: 1,
        topic: 'Inspect src/index.js',
        evidence: [{ id: 'E1', label: 'Index', source: 'src/index.js', text: 'export const x = 1;' }],
        selfContainedInput: {
          phases: ['DELIBERATION'],
          coveredArtifacts: [{ source: 'src/index.js', evidenceId: 'E1', coverage: 'complete_artifact' }]
        },
        originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo', configuredWorkspaceCwd: '/repo' },
        harness: 'antigravity',
        model: 'gemini-4-argon-high',
        retryEffortFallback: true
      });
      assert.equal(deniedAttested.canRetry, true);
      assert.equal(deniedAttested.nextTools, 'none');
      assert.equal(deniedAttested.nextCwd, undefined);
      assert.equal(deniedAttested.nextModel, 'gemini-4-argon-medium');
      assert.equal(deniedAttested.nextReasoningEffort, 'medium');
      assert.equal(deniedAttested.setsToolFreeRecoveryUsed, true);
      assert.equal(deniedAttested.retryDiagnostics.fallbackApplied, true);
      assert.equal(deniedAttested.retryDiagnostics.fallbackReason, 'HeadlessToolDeniedError');
      assert.equal(deniedAttested.retryDiagnostics.tools, 'none');

      // QuotaExhaustionError preserves tools and requested effort even when retryEffortFallback is true
      const normalQuota = planParticipantRecovery({
        participantId: 's1',
        role: 'seat',
        error: new Error('HTTP 429'),
        errorClass: 'QuotaExhaustionError',
        isRetryable: true,
        retries: 1,
        maxRetries: 3,
        remainingBudget: 50000,
        minViable: 5000,
        toolFreeRecoveryUsed: false,
        originalAttemptTools: 'read-only',
        originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo', configuredWorkspaceCwd: '/repo' },
        retryEffortFallback: true,
        harness: 'antigravity',
        model: 'gemini-4-argon-high'
      });
      assert.equal(normalQuota.canRetry, true);
      assert.equal(normalQuota.nextTools, 'read-only');
      assert.equal(normalQuota.nextCwd, '/repo');
      assert.equal(normalQuota.nextModel, 'gemini-4-argon-high');
      assert.equal(normalQuota.setsToolFreeRecoveryUsed, false);
      assert.equal(normalQuota.retryDiagnostics.fallbackEnabled, true);
      assert.equal(normalQuota.retryDiagnostics.fallbackApplied, false);
      assert.equal(normalQuota.retryDiagnostics.fallbackReason, null);
      assert.equal(normalQuota.retryDiagnostics.capabilityProvenance, null);
      assert.equal(normalQuota.retryDiagnostics.attempt, 2);
    });
  });

  describe('resolveRetryModelAndEffort, validateRetryFallbackCapability, & config metadata', () => {
    it('preserves flag-off compatibility and attaches non-enumerable _explicitReasoningEffort cleanly', () => {
      // Flag off must NOT reject inline + explicit conflict
      const flagOff = resolveConfig({
        retryEffortFallback: false,
        seats: [
          { id: 's1', harness: 'codex', model: 'gpt-6-astra (max)', reasoningEffort: 'low', soul: 'S' },
          { id: 's2', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'A' }
        ]
      });
      assert.equal(flagOff.retryEffortFallback, false);
      assert.equal(flagOff.selfContainedInput, null);
      assert.equal(flagOff.seats[0]._explicitReasoningEffort, true);
      assert.equal(flagOff.seats[1]._explicitReasoningEffort, false);
      assert.equal(Object.keys(flagOff.seats[0]).includes('_explicitReasoningEffort'), false);

      // Flag on: resolveConfig still returns cleanly (so CLI preflight / validateRetryFallbackCapability reports CONFLICTING_MODEL_EFFORT)
      const conflictResolved = resolveConfig({
        retryEffortFallback: true,
        judge: { id: 'j', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'J' },
        seats: [
          { id: 's1', harness: 'codex', model: 'gpt-6-astra (max)', reasoningEffort: 'low', soul: 'S' },
          { id: 's2', harness: 'codex', model: 'gpt-6.1-sol (high)', soul: 'A' }
        ]
      });
      assert.equal(conflictResolved.retryEffortFallback, true);
      const capCheck = validateRetryFallbackCapability({ config: conflictResolved });
      assert.equal(capCheck.valid, false);
      assert.match(capCheck.errors[0], /CONFLICTING_MODEL_EFFORT/);

      // Global inherited reasoningEffort: 'low' with inline model does NOT trigger CONFLICTING_MODEL_EFFORT even across re-resolution
      const globalInherited = resolveConfig({
        retryEffortFallback: true,
        reasoningEffort: 'low',
        judge: { id: 'j', harness: 'codex', model: 'gpt-6-astra (max)', soul: 'J' },
        seats: [
          { id: 's1', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'S' },
          { id: 's2', harness: 'codex', model: 'gpt-6.1-sol (high)', soul: 'A' }
        ]
      });
      assert.equal(globalInherited.seats[0]._explicitReasoningEffort, false);
      assert.equal(globalInherited.seats[0].reasoningEffort, 'low');
      const reResolved = resolveConfig(globalInherited);
      assert.equal(reResolved.seats[0]._explicitReasoningEffort, false);
      assert.equal(validateRetryFallbackCapability({ config: reResolved }).valid, true);
    });

    it('validates retryEffortFallback and selfContainedInput schemas cleanly in validateConfig', () => {
      const base = {
        topic: 'Config schema test',
        maxRounds: 1,
        minQuorum: 2,
        maxClarificationBatches: 0,
        maxRetriesPerSeat: 1,
        seats: [
          { id: 's1', harness: 'mock', model: 'm1', soul: 'A' },
          { id: 's2', harness: 'mock', model: 'm2', soul: 'B' }
        ]
      };
      assert.equal(validateConfig({ ...base, retryEffortFallback: 'yes' }).valid, false);
      assert.equal(validateConfig({ ...base, selfContainedInput: [] }).valid, false);
      assert.equal(validateConfig({ ...base, selfContainedInput: { phases: ['BOGUS'] } }).valid, false);
      assert.equal(validateConfig({ ...base, selfContainedInput: { roundScope: 'round_2' } }).valid, false);
      assert.equal(
        validateConfig({
          ...base,
          selfContainedInput: {
            phases: ['DELIBERATION'],
            roundScope: 'all_rounds',
            coveredArtifacts: [{ source: 'a.js', evidenceId: 'E1', coverage: { startLine: 10, endLine: 5 } }]
          }
        }).valid,
        false
      );
      assert.equal(
        validateConfig({
          ...base,
          retryEffortFallback: true,
          selfContainedInput: {
            phases: ['DELIBERATION', 'VOTING'],
            roundScope: 'all_rounds',
            coveredArtifacts: [{ source: 'a.js', evidenceId: 'E1', coverage: 'complete_artifact' }]
          }
        }).valid,
        true
      );
    });

    it('handles composer-2.5, low-effort preservation, bare model medium cap, live_cli_catalog, and unverified date-stamped selectors', () => {
      const composerPlan = resolveRetryModelAndEffort({
        harness: 'cursor',
        model: 'composer-2.5',
        retryEffortFallback: true
      });
      assert.equal(composerPlan.supported, true);
      assert.equal(composerPlan.effectiveModel, 'composer-2.5');
      assert.equal(composerPlan.requestedEffort, null);
      assert.equal(composerPlan.effectiveEffort, null);
      assert.equal(composerPlan.fallbackApplied, false);
      assert.equal(composerPlan.provenance, 'adapter_static_policy');

      // Never raises low to medium
      const keepLow = resolveRetryModelAndEffort({
        harness: 'antigravity',
        model: 'claude-opus-5-5-low',
        retryEffortFallback: true,
        capabilityCatalog: { selectors: ['claude-opus-5-5-low', 'claude-opus-5-5-medium'], source: 'live_cli_catalog' }
      });
      assert.equal(keepLow.supported, true);
      assert.equal(keepLow.effectiveEffort, 'low');
      assert.equal(keepLow.fallbackApplied, false);
      assert.equal(keepLow.provenance, 'live_cli_catalog');

      // Bare gpt-6-astra with reasoningEffort: 'max' synchronizes to 'gpt-6-astra (medium)'
      const capCodexMedium = resolveRetryModelAndEffort({
        harness: 'codex',
        model: 'gpt-6-astra',
        reasoningEffort: 'max',
        retryEffortFallback: true
      });
      assert.equal(capCodexMedium.supported, true);
      assert.equal(capCodexMedium.effectiveModel, 'gpt-6-astra (medium)');
      assert.equal(capCodexMedium.effectiveEffort, 'medium');
      assert.equal(capCodexMedium.fallbackApplied, true);
      assert.equal(capCodexMedium.provenance, 'adapter_static_policy');

      // Unverified date-stamped claude-opus-5-5-20260501 fails UNSUPPORTED_MODEL_EFFORT with provenance: 'unverified'
      const unverifiedDirect = resolveRetryModelAndEffort({
        harness: 'antigravity',
        model: 'claude-opus-5-5-20260501',
        retryEffortFallback: true
      });
      assert.equal(unverifiedDirect.supported, false);
      assert.equal(unverifiedDirect.errorCode, 'UNSUPPORTED_MODEL_EFFORT');
      assert.equal(unverifiedDirect.provenance, 'unverified');

      // Live catalog miss also reports provenance: 'unverified'
      const liveMiss = resolveRetryModelAndEffort({
        harness: 'antigravity',
        model: 'claude-opus-5-5-20260501-high',
        retryEffortFallback: true,
        capabilityCatalog: { selectors: ['gemini-4-argon-medium'], source: 'live_cli_catalog' }
      });
      assert.equal(liveMiss.supported, false);
      assert.equal(liveMiss.provenance, 'unverified');

      // Static Antigravity policy restricts claude-opus-5-5 / claude-sonnet-5-5 to low/medium/high (rejects xhigh/max)
      for (const disallowed of ['claude-opus-5-5-xhigh', 'claude-sonnet-5-5-max']) {
        const resDisallowed = resolveRetryModelAndEffort({
          harness: 'antigravity',
          model: disallowed,
          retryEffortFallback: true
        });
        assert.equal(resDisallowed.supported, false);
        assert.equal(resDisallowed.errorCode, 'UNSUPPORTED_MODEL_EFFORT');
        assert.equal(resDisallowed.provenance, 'unverified');
      }

      // verifiedCapabilities descriptor permits date-stamped selector cleanly across validateRetryFallbackCapability and planParticipantRecovery
      const verifiedDated = validateRetryFallbackCapability({
        config: {
          seats: [
            {
              id: 's1',
              harness: 'antigravity',
              model: 'claude-opus-5-5-20260501',
              verifiedCapabilities: { selectors: ['claude-opus-5-5-20260501-medium'] }
            }
          ]
        }
      });
      assert.equal(verifiedDated.valid, true);

      const plannedWithVerified = planParticipantRecovery({
        participantId: 's1',
        role: 'seat',
        error: new Error('Timed out'),
        errorClass: 'TimeoutError',
        isRetryable: true,
        retries: 0,
        maxRetries: 1,
        remainingBudget: 50000,
        minViable: 5000,
        toolFreeRecoveryUsed: false,
        originalAttemptTools: 'none',
        phase: 'DELIBERATION',
        round: 1,
        topic: 'Conceptual question',
        harness: 'antigravity',
        model: 'claude-opus-5-5-20260501',
        retryEffortFallback: true,
        verifiedCapabilities: { selectors: ['claude-opus-5-5-20260501-medium'] }
      });
      assert.equal(plannedWithVerified.canRetry, true);
      assert.equal(plannedWithVerified.nextModel, 'claude-opus-5-5-20260501-medium');
      assert.equal(plannedWithVerified.retryDiagnostics.capabilityProvenance, 'adapter_static_policy');

      const unverifiedDated = validateRetryFallbackCapability({
        config: {
          seats: [{ id: 's1', harness: 'antigravity', model: 'claude-opus-5-5-20260501' }]
        },
        catalogByHarness: {}
      });
      assert.equal(unverifiedDated.valid, false);
      assert.match(unverifiedDated.errors[0], /UNSUPPORTED_MODEL_EFFORT/);

      // Direct resolveRetryModelAndEffort conflict when retryEffortFallback is true
      const conflictOptIn = resolveRetryModelAndEffort({
        harness: 'codex',
        model: 'gpt-6-astra (max)',
        explicitReasoningEffort: 'low',
        hasExplicitReasoningEffort: true,
        retryEffortFallback: true
      });
      assert.equal(conflictOptIn.supported, false);
      assert.equal(conflictOptIn.errorCode, 'CONFLICTING_MODEL_EFFORT');

      // Same inputs with retryEffortFallback: false must succeed without CONFLICTING_MODEL_EFFORT
      const conflictFlagOff = resolveRetryModelAndEffort({
        harness: 'codex',
        model: 'gpt-6-astra (max)',
        explicitReasoningEffort: 'low',
        hasExplicitReasoningEffort: true,
        retryEffortFallback: false
      });
      assert.equal(conflictFlagOff.supported, true);
      assert.equal(conflictFlagOff.effectiveEffort, 'max');
      assert.equal(conflictFlagOff.fallbackApplied, false);
    });
  });

  describe('state.js & reducer.js retry diagnostics lifecycle', () => {
    it('initializes, appends, and clears activeRetryDiagnostics without cross-seat or judge wiping', () => {
      let state = createInitialCouncilState({
        topic: 'Reducer retry diagnostics',
        minQuorum: 2,
        maxRetriesPerSeat: 2,
        seats: [
          { id: 's1', harness: 'mock', model: 'gemini-4-argon-high', soul: 'A' },
          { id: 's2', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'B' }
        ],
        judge: { id: 'j', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'J' }
      });
      assert.equal(state.judge.activeRetryDiagnostics, null);
      assert.deepEqual(state.judge.retryDiagnosticsHistory, []);
      assert.equal(state.seats[0].activeRetryDiagnostics, null);
      assert.deepEqual(state.seats[0].retryDiagnosticsHistory, []);

      // ADD_SEAT initializes fields as well
      state = transitionCouncil(state, {
        type: 'ADD_SEAT',
        seat: { id: 's3', harness: 'mock', model: 'gpt-6.1-sol (high)', soul: 'C' }
      });
      assert.equal(state.seats[2].activeRetryDiagnostics, null);
      assert.deepEqual(state.seats[2].retryDiagnosticsHistory, []);

      state = transitionCouncil(state, { type: 'BEGIN_ROUND' });

      const diagS1 = {
        participantId: 's1',
        role: 'seat',
        phase: 'DELIBERATION',
        round: 1,
        attempt: 1,
        requestedModel: 'gemini-4-argon-high',
        requestedEffort: 'high',
        effectiveModel: 'gemini-4-argon-medium',
        effectiveEffort: 'medium',
        capabilityProvenance: 'adapter_static_policy',
        fallbackEnabled: true,
        fallbackApplied: true,
        fallbackReason: 'TimeoutError',
        tools: 'none'
      };
      const diagS2 = { ...diagS1, participantId: 's2', requestedModel: 'gpt-6-astra (max)', effectiveModel: 'gpt-6-astra (medium)' };

      state = transitionCouncil(state, { type: 'SEAT_FAULT', seatId: 's1', status: 'fault_timeout' });
      state = transitionCouncil(state, { type: 'RETRY_SEAT', seatId: 's1', retryDiagnostics: diagS1 });
      assert.deepEqual(state.seats[0].activeRetryDiagnostics, diagS1);
      assert.equal(state.seats[0].retryDiagnosticsHistory.length, 1);
      assert.equal(state.seats[1].activeRetryDiagnostics, null);

      state = transitionCouncil(state, { type: 'SEAT_FAULT', seatId: 's2', status: 'fault_timeout' });
      state = transitionCouncil(state, { type: 'RETRY_SEAT', seatId: 's2', retryDiagnostics: diagS2 });
      assert.deepEqual(state.seats[1].activeRetryDiagnostics, diagS2);
      // s1 activeRetryDiagnostics must remain intact when s2 retries
      assert.deepEqual(state.seats[0].activeRetryDiagnostics, diagS1);

      // SUBMIT_PROOF on s1 clears ONLY s1.activeRetryDiagnostics, leaving s2 intact
      state = transitionCouncil(state, {
        type: 'SUBMIT_PROOF',
        id: 'P1',
        seatId: 's1',
        scope: 'A',
        kind: 'check',
        source: 'a.js',
        statement: 'Ok'
      });
      assert.equal(state.seats[0].activeRetryDiagnostics, null);
      assert.equal(state.seats[0].retryDiagnosticsHistory.length, 1);
      assert.deepEqual(state.seats[1].activeRetryDiagnostics, diagS2);

      // EXCUSE_SEAT on s3 (while quorum >= 2) clears ONLY s3, leaving s2 intact if active
      state = transitionCouncil(state, { type: 'EXCUSE_SEAT', seatId: 's3', reason: 'Fault' });
      assert.deepEqual(state.seats[1].activeRetryDiagnostics, diagS2);

      // START_JUDGING clears all seats & judge activeRetryDiagnostics
      state = transitionCouncil(state, { type: 'START_JUDGING' });
      assert.equal(state.seats[1].activeRetryDiagnostics, null);
      assert.equal(state.judge.activeRetryDiagnostics, null);

      // JUDGE_FAULT -> RETRY_JUDGE populates judge diagnostics -> JUDGE_AUDIT_AND_SYNTHESIZE clears judge diagnostics
      const diagJudge = {
        ...diagS1,
        participantId: 'j',
        role: 'judge',
        phase: 'JUDGE_AUDIT_SYNTHESIS'
      };
      state = transitionCouncil(state, { type: 'JUDGE_FAULT', status: 'fault_timeout', reason: 'Judge timeout' });
      state = transitionCouncil(state, { type: 'RETRY_JUDGE', retryDiagnostics: diagJudge });
      assert.deepEqual(state.judge.activeRetryDiagnostics, diagJudge);
      assert.equal(state.judge.retryDiagnosticsHistory.length, 1);

      state = transitionCouncil(state, {
        type: 'JUDGE_AUDIT_AND_SYNTHESIZE',
        summary: 'Candidate',
        clauses: [{ context: 'A', conclusion: 'Done', citedProofIds: ['P1'] }]
      });
      assert.equal(state.judge.activeRetryDiagnostics, null);
      assert.equal(state.judge.retryDiagnosticsHistory.length, 1);

      // CAST_VOTE clears only voting seat's activeRetryDiagnostics
      state = transitionCouncil(state, { type: 'SEAT_FAULT', seatId: 's1', status: 'fault_timeout' });
      state = transitionCouncil(state, { type: 'RETRY_SEAT', seatId: 's1', retryDiagnostics: { ...diagS1, phase: 'VOTING' } });
      state = transitionCouncil(state, { type: 'SEAT_FAULT', seatId: 's2', status: 'fault_timeout' });
      state = transitionCouncil(state, { type: 'RETRY_SEAT', seatId: 's2', retryDiagnostics: { ...diagS2, phase: 'VOTING' } });
      state = transitionCouncil(state, { type: 'CAST_VOTE', seatId: 's1', vote: 'accept' });
      assert.equal(state.seats[0].activeRetryDiagnostics, null);
      assert.equal(state.seats[0].retryDiagnosticsHistory.length, 2);
      assert.notEqual(state.seats[1].activeRetryDiagnostics, null);

      // BEGIN_ROUND (via object + EVALUATE_ROUND into round 2) leaves activeRetryDiagnostics null
      state = transitionCouncil(state, { type: 'CAST_VOTE', seatId: 's2', vote: 'object', proofId: 'P1', reason: 'Need R2' });
      assert.equal(state.seats[1].activeRetryDiagnostics, null);
      state = transitionCouncil(state, { type: 'EVALUATE_ROUND' });
      assert.equal(state.phase, 'reviewing');
      assert.equal(state.round, 2);
      assert.equal(state.seats[0].activeRetryDiagnostics, null);
      assert.equal(state.seats[1].activeRetryDiagnostics, null);
      assert.equal(state.judge.activeRetryDiagnostics, null);

      // Terminal JUDGE_FAULT clears activeRetryDiagnostics on judge and seats
      state = transitionCouncil(state, { type: 'SUBMIT_PROOF', id: 'P2', seatId: 's1', scope: 'A', kind: 'check', source: 'a.js', statement: 'R2' });
      state = transitionCouncil(state, { type: 'START_JUDGING' });
      state = transitionCouncil(state, { type: 'JUDGE_FAULT', status: 'fault_timeout' });
      state = transitionCouncil(state, { type: 'RETRY_JUDGE', retryDiagnostics: { ...diagJudge, round: 2 } });
      assert.notEqual(state.judge.activeRetryDiagnostics, null);
      state = transitionCouncil(state, { type: 'JUDGE_FAULT', terminal: true, status: 'fault_timeout', reason: 'Exhausted' });
      assert.equal(state.phase, 'completed');
      assert.equal(state.judge.activeRetryDiagnostics, null);
      assert.equal(state.judge.retryDiagnosticsHistory.length, 2);
    });
  });

  describe('CouncilEngine runtime integration', () => {
    it('refuses HeadlessToolDeniedError (exitCode 0) when unattested and preserves valid sibling proofs on quorum collapse (#95)', async () => {
      const mock = new MockAdapter();
      let s2Calls = 0;

      const origProof = mock.executeSeatProof.bind(mock);
      mock.executeSeatProof = async (ctx) => {
        if (ctx.seat.id === 's2') {
          s2Calls += 1;
          throw new HeadlessToolDeniedError('Tool permission prompt blocked', {
            harness: 'codex',
            seatId: 's2',
            exitCode: 0,
            isRetryable: true
          });
        }
        return origProof(ctx);
      };

      const engine = new CouncilEngine(
        {
          topic: 'Audit src/engine/council-engine.js:120 for quorum collapse invariants',
          minQuorum: 2,
          maxRounds: 1,
          maxRetriesPerSeat: 2,
          cwd: '/tmp/live-workspace-102',
          seats: [
            { id: 's1', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S1', tools: 'read-only' },
            { id: 's2', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'S2', tools: 'read-only' }
          ]
        },
        { harnessResolver: () => mock }
      );

      const result = await engine.run();
      assert.equal(result.ok, false);
      assert.equal(result.verdict.kind, 'Dissent Report (Below Quorum)');
      assert.equal(s2Calls, 1, 'Unattested workspace seat must not enter tool-free retry after HeadlessToolDeniedError');
      const s2 = engine.state.seats.find((s) => s.id === 's2');
      assert.equal(s2.status, 'excused');
      assert.match(s2.excusedReason, /insufficient self-contained evidence/i);
      assert.ok(
        engine.state.proofs.some((p) => p.seatId === 's1' && p.round === 1),
        'Valid sibling proof from s1 must be conserved before quorum-collapse excusal (#95)'
      );
    });

    it('initRoster ignores empty seat.cwd so config.cwd protects seat against unattested TimeoutError fallback', async () => {
      const mock = new MockAdapter();
      let s1Calls = 0;

      const origProof = mock.executeSeatProof.bind(mock);
      mock.executeSeatProof = async (ctx) => {
        if (ctx.seat.id === 's1') {
          s1Calls += 1;
          throw new TimeoutError('Seat timed out after 1000ms', { timeoutMs: 1000, harness: 'codex', seatId: 's1' });
        }
        return origProof(ctx);
      };

      const engine = new CouncilEngine(
        {
          topic: 'Check docs/spec.md for workspace verification rules',
          minQuorum: 2,
          maxRounds: 1,
          maxRetriesPerSeat: 2,
          cwd: '/tmp/global-live-cwd',
          seats: [
            { id: 's1', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S1', tools: 'read-only' },
            { id: 's2', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'S2', tools: 'none' },
            { id: 's3', harness: 'cursor', model: 'grok-4', soul: 'S3', tools: 'none' }
          ]
        },
        { harnessResolver: () => mock }
      );

      // Simulate empty seat.cwd reaching initRoster directly (e.g. programmatically constructed seat object)
      engine.config = {
        ...engine.config,
        seats: engine.config.seats.map((s) => (s.id === 's1' ? { ...s, cwd: '' } : s))
      };
      engine.initRoster();

      const result = await engine.run();
      assert.equal(result.ok, true);
      assert.equal(s1Calls, 1, 'Seat with empty string cwd inheriting config.cwd must not fall back tool-free on unattested topic');
      const s1 = engine.state.seats.find((s) => s.id === 's1');
      assert.equal(s1.cwd, '/tmp/global-live-cwd');
      assert.equal(s1.status, 'excused');
      assert.match(s1.excusedReason, /insufficient self-contained evidence/i);
    });

    it('allows at most ONE tool-free recovery per phase when selfContainedInput is present, while keeping multi-retry for votingTools none', async () => {
      const mock = new MockAdapter();
      const s1DelibContexts = [];
      let s1VoteCalls = 0;

      const origProof = mock.executeSeatProof.bind(mock);
      mock.executeSeatProof = async (ctx) => {
        if (ctx.seat.id === 's1') {
          s1DelibContexts.push({ tools: ctx.tools, cwd: ctx.cwd, retryDiagnostics: ctx.retryDiagnostics ?? null });
          if (s1DelibContexts.length === 1) {
            throw new TimeoutError('Initial read-only timeout', { timeoutMs: 1000, harness: 'codex', seatId: 's1' });
          }
          throw new InvalidResponseError('Malformed JSON on tool-free retry', { harness: 'codex', seatId: 's1' });
        }
        return origProof(ctx);
      };

      const origVote = mock.executeSeatVote.bind(mock);
      mock.executeSeatVote = async (ctx) => {
        if (ctx.seat.id === 's3') {
          s1VoteCalls += 1;
          if (s1VoteCalls <= 2) {
            throw new InvalidResponseError(`Transient parse failure #${s1VoteCalls}`, { harness: 'codex', seatId: 's3' });
          }
        }
        return origVote(ctx);
      };

      const engine = new CouncilEngine(
        {
          topic: 'Evaluate src/auth.js tradeoff design',
          evidence: [
            {
              id: 'E1',
              label: 'src/auth.js complete source',
              source: 'src/auth.js',
              text: '[E1] Full inline snapshot of src/auth.js lines 1-50'
            }
          ],
          minQuorum: 2,
          maxRounds: 1,
          maxRetriesPerSeat: 3,
          cwd: '/tmp/live-workspace-102',
          selfContainedInput: {
            kind: 'full_context',
            label: 'Embedded inline spec',
            phases: ['DELIBERATION'],
            roundScope: 'all_rounds',
            coveredArtifacts: [
              { source: 'src/auth.js', evidenceId: 'E1', coverage: 'complete_artifact' }
            ]
          },
          seats: [
            { id: 's1', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S1', tools: 'read-only' },
            { id: 's2', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'S2', tools: 'none' },
            { id: 's3', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S3', tools: 'none', votingTools: 'none' }
          ]
        },
        { harnessResolver: () => mock }
      );

      const result = await engine.run();
      assert.equal(result.ok, true);
      assert.equal(s1DelibContexts.length, 2, 'Should stop after single tool-free retry instead of burning remaining maxRetriesPerSeat=3');
      assert.equal(s1DelibContexts[0].tools, 'read-only');
      assert.equal(s1DelibContexts[0].retryDiagnostics, null);
      assert.equal(s1DelibContexts[1].tools, 'none');
      assert.equal(s1DelibContexts[1].cwd, undefined);
      assert.equal(s1DelibContexts[1].retryDiagnostics?.attempt, 1);

      const s1 = engine.state.seats.find((s) => s.id === 's1');
      assert.equal(s1.status, 'excused');
      assert.match(s1.excusedReason, /Tool-free recovery already used/i);

      // s3 started voting natively with votingTools: 'none' so normal multi-retry (2 failures + 1 success = 3 calls) is preserved
      assert.equal(s1VoteCalls, 3);
      const s3 = engine.state.seats.find((s) => s.id === 's3');
      assert.equal(s3.status, 'accepted');
    });

    it('applies opt-in retryEffortFallback with composer-2.5 null effort, skips downshift on QuotaExhaustionError, and ignores PID 429/401/403 noise', async () => {
      const mock = new MockAdapter();
      const s1Contexts = [];
      const s2Contexts = [];
      const s3Contexts = [];

      const origProof = mock.executeSeatProof.bind(mock);
      mock.executeSeatProof = async (ctx) => {
        if (ctx.seat.id === 's1') {
          s1Contexts.push({
            seatModel: ctx.seat?.model,
            seatReasoningEffort: ctx.seat?.reasoningEffort ?? null,
            contextReasoningEffort: ctx.context?.reasoningEffort ?? null,
            tools: ctx.tools,
            retryDiagnostics: ctx.retryDiagnostics
          });
          if (s1Contexts.length === 1) {
            throw new TimeoutError('Timeout on gpt-6-astra (high)', { timeoutMs: 1000, harness: 'codex', seatId: 's1' });
          }
        } else if (ctx.seat.id === 's2') {
          s2Contexts.push({
            seatModel: ctx.seat?.model,
            seatReasoningEffort: ctx.seat?.reasoningEffort ?? null,
            contextReasoningEffort: ctx.context?.reasoningEffort ?? null,
            retryDiagnostics: ctx.retryDiagnostics
          });
          if (s2Contexts.length === 1) {
            throw new TimeoutError('Timeout on composer-2.5', { timeoutMs: 1000, harness: 'cursor', seatId: 's2' });
          }
        } else if (ctx.seat.id === 's3') {
          s3Contexts.push({
            seatModel: ctx.seat?.model,
            seatReasoningEffort: ctx.seat?.reasoningEffort ?? null,
            contextReasoningEffort: ctx.context?.reasoningEffort ?? null,
            retryDiagnostics: ctx.retryDiagnostics
          });
          if (s3Contexts.length === 1) {
            throw new QuotaExhaustionError('Rate limited 429', { harness: 'codex', seatId: 's3' });
          }
        } else if (ctx.seat.id === 's4-pid') {
          throw new Error('(node:429) (node:401) (node:403) ExperimentalWarning: noisy runtime diagnostic');
        }
        return origProof(ctx);
      };

      const engine = new CouncilEngine(
        {
          topic: 'Conceptual architecture verification',
          minQuorum: 3,
          maxRounds: 1,
          maxRetriesPerSeat: 1,
          retryEffortFallback: true,
          selfContainedInput: {
            kind: 'full_context',
            label: 'Inline spec',
            phases: ['DELIBERATION'],
            roundScope: 'all_rounds',
            conceptualNoExternalVerification: true
          },
          seats: [
            { id: 's1', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S1', tools: 'read-only' },
            { id: 's2', harness: 'cursor', model: 'composer-2.5', soul: 'S2', tools: 'none' },
            { id: 's3', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S3', tools: 'none' },
            { id: 's4-pid', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'S4', tools: 'none' }
          ]
        },
        {
          harnessResolver: () => mock,
          catalogByHarness: {
            codex: ['gpt-6-astra (high)', 'gpt-6-astra (medium)'],
            cursor: ['composer-2.5']
          }
        }
      );

      const result = await engine.run();
      assert.equal(result.ok, true);

      // Wave 0 has null retryDiagnostics; Retry 1 carries structured retryDiagnostics + real seat/context model & effort downshift
      assert.equal(s1Contexts[0].retryDiagnostics, null);
      assert.equal(s1Contexts[0].seatModel, 'gpt-6-astra (high)');
      assert.equal(s1Contexts[0].seatReasoningEffort, null);
      assert.equal(s1Contexts[1].tools, 'none');
      assert.equal(s1Contexts[1].seatModel, 'gpt-6-astra (medium)');
      assert.equal(s1Contexts[1].seatReasoningEffort, 'medium');
      assert.equal(s1Contexts[1].contextReasoningEffort, 'medium');
      assert.equal(s1Contexts[1].retryDiagnostics?.attempt, 1);
      assert.equal(s1Contexts[1].retryDiagnostics?.fallbackApplied, true);
      assert.equal(s1Contexts[1].retryDiagnostics?.effectiveModel, 'gpt-6-astra (medium)');
      assert.equal(s1Contexts[1].retryDiagnostics?.effectiveEffort, 'medium');

      // composer-2.5 must never receive an invented reasoningEffort
      assert.equal(s2Contexts[0].retryDiagnostics, null);
      assert.equal(s2Contexts[0].seatModel, 'composer-2.5');
      assert.equal(s2Contexts[0].seatReasoningEffort, null);
      assert.equal(s2Contexts[1].seatModel, 'composer-2.5');
      assert.equal(s2Contexts[1].seatReasoningEffort, null);
      assert.equal(s2Contexts[1].contextReasoningEffort, null);
      assert.equal(s2Contexts[1].retryDiagnostics?.effectiveEffort, null);
      assert.equal(s2Contexts[1].retryDiagnostics?.fallbackApplied, false);

      // QuotaExhaustionError must preserve requested effort (fallbackApplied: false)
      assert.equal(s3Contexts[0].retryDiagnostics, null);
      assert.equal(s3Contexts[0].seatModel, 'gpt-6-astra (high)');
      assert.equal(s3Contexts[1].seatModel, 'gpt-6-astra (high)');
      assert.equal(s3Contexts[1].seatReasoningEffort, 'high');
      assert.equal(s3Contexts[1].contextReasoningEffort, 'high');
      assert.equal(s3Contexts[1].retryDiagnostics?.fallbackApplied, false);
      assert.equal(s3Contexts[1].retryDiagnostics?.effectiveEffort, 'high');

      // PID numbers 429 / 401 / 403 must NOT classify as QuotaExhaustionError or AuthenticationError
      const s4 = engine.state.seats.find((s) => s.id === 's4-pid');
      assert.notEqual(s4.status, 'fault_quota', 'PID 429 must never trigger fault_quota');
      assert.equal(engine._classifyErrorClass(new Error('(node:429) (node:401) (node:403) Warning')), 'HarnessExecutionError');
    });

    it('looks up catalogByHarness case-insensitively and forwards verifiedCapabilities / verifiedCapabilitiesByHarness into planParticipantRecovery', async () => {
      const mock = new MockAdapter();
      const s1Calls = [];
      const s2Calls = [];
      const s3Calls = [];

      const origProof = mock.executeSeatProof.bind(mock);
      mock.executeSeatProof = async (ctx) => {
        if (ctx.seat.id === 's1-agy-case') {
          s1Calls.push({
            seatModel: ctx.seat?.model,
            seatReasoningEffort: ctx.seat?.reasoningEffort ?? null,
            contextReasoningEffort: ctx.context?.reasoningEffort ?? null,
            retryDiagnostics: ctx.retryDiagnostics
          });
          if (s1Calls.length === 1) {
            throw new TimeoutError('Timeout on mixed-case Antigravity seat', { timeoutMs: 1000, harness: 'antigravity', seatId: 's1-agy-case' });
          }
        } else if (ctx.seat.id === 's2-codex-verified') {
          s2Calls.push({
            seatModel: ctx.seat?.model,
            seatReasoningEffort: ctx.seat?.reasoningEffort ?? null,
            contextReasoningEffort: ctx.context?.reasoningEffort ?? null,
            retryDiagnostics: ctx.retryDiagnostics
          });
          if (s2Calls.length === 1) {
            throw new TimeoutError('Timeout on custom codex seat verified by verifiedCapabilitiesByHarness', { timeoutMs: 1000, harness: 'codex', seatId: 's2-codex-verified' });
          }
        } else if (ctx.seat.id === 's3-top-verified') {
          s3Calls.push({
            seatModel: ctx.seat?.model,
            seatReasoningEffort: ctx.seat?.reasoningEffort ?? null,
            contextReasoningEffort: ctx.context?.reasoningEffort ?? null,
            retryDiagnostics: ctx.retryDiagnostics
          });
          if (s3Calls.length === 1) {
            throw new TimeoutError('Timeout on seat verified by top-level verifiedCapabilities', { timeoutMs: 1000, harness: 'codex', seatId: 's3-top-verified' });
          }
        }
        return origProof(ctx);
      };

      const engine = new CouncilEngine(
        {
          topic: 'Mixed-case catalog and verifiedCapabilities lookup verification',
          minQuorum: 2,
          maxRounds: 1,
          maxRetriesPerSeat: 1,
          retryEffortFallback: true,
          selfContainedInput: {
            kind: 'full_context',
            label: 'Inline spec',
            phases: ['DELIBERATION'],
            roundScope: 'all_rounds',
            conceptualNoExternalVerification: true
          },
          seats: [
            { id: 's1-agy-case', harness: 'Antigravity', model: 'gemini-custom-preview (high)', soul: 'S1', tools: 'none' },
            { id: 's2-codex-verified', harness: 'Codex', model: 'codex-experimental-high', soul: 'S2', tools: 'none' },
            { id: 's3-top-verified', harness: 'Cursor', model: 'grok-experimental (high)', soul: 'S3', tools: 'none' }
          ]
        },
        {
          harnessResolver: () => mock,
          catalogByHarness: {
            antigravity: ['gemini-custom-preview-high', 'gemini-custom-preview-medium']
          },
          verifiedCapabilitiesByHarness: {
            codex: {
              models: ['codex-experimental-high', 'codex-experimental-medium'],
              source: 'live_cli_catalog'
            }
          },
          verifiedCapabilities: {
            Cursor: {
              models: ['grok-experimental-high', 'grok-experimental-medium']
            },
            source: 'live_cli_catalog'
          }
        }
      );

      const result = await engine.run();
      assert.equal(result.ok, true);

      // s1: mixed-case harness 'Antigravity' resolved lowercased catalogByHarness.antigravity
      assert.equal(s1Calls.length, 2);
      assert.equal(s1Calls[1].seatModel, 'gemini-custom-preview-medium');
      assert.equal(s1Calls[1].contextReasoningEffort, 'medium');
      assert.equal(s1Calls[1].retryDiagnostics?.fallbackApplied, true);
      assert.equal(s1Calls[1].retryDiagnostics?.capabilityProvenance, 'live_cli_catalog');

      // s2: mixed-case harness 'Codex' resolved verifiedCapabilitiesByHarness.codex
      assert.equal(s2Calls.length, 2);
      assert.equal(s2Calls[1].seatModel, 'codex-experimental (medium)');
      assert.equal(s2Calls[1].contextReasoningEffort, 'medium');
      assert.equal(s2Calls[1].retryDiagnostics?.fallbackApplied, true);
      assert.equal(s2Calls[1].retryDiagnostics?.capabilityProvenance, 'live_cli_catalog');

      // s3: top-level verifiedCapabilities with mixed-case 'Cursor' key + source preserved
      assert.equal(s3Calls.length, 2);
      assert.equal(s3Calls[1].seatModel, 'grok-experimental-medium');
      assert.equal(s3Calls[1].contextReasoningEffort, 'medium');
      assert.equal(s3Calls[1].retryDiagnostics?.fallbackApplied, true);
      assert.equal(s3Calls[1].retryDiagnostics?.capabilityProvenance, 'live_cli_catalog');
    });
  });
});
