import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
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

    it('Important 3 & 4: resolves prior-round backing proofs for Round 2 DELIBERATION, extension-independent paths, and named external standards across all inputs', async () => {
      // 1. Extension-independent file paths + named external standards across phase inputs,
      // while ignoring prose pairs (and/or, read/write), frameworks (Node.js), versions, and ellipses
      const deps = extractVerificationDependencies([
        'Inspect include/auth.h:120-145, proto/service.proto, bin/council, Makefile:42, Dockerfile, and/or read/write paths.',
        'Check RFC 9110 Section 15, ISO 27001, CVE-2026-1234, OWASP ASVS, FIPS 140-3, POSIX.1-2017, example.org on Node.js v22.1.0 ... ready.',
        'URL https://datatracker.ietf.org/doc/html/rfc9110 must not duplicate the standard token from its path.'
      ]);
      assert.ok(
        deps.workspaceFileDeps.some(
          (d) => d.source === 'include/auth.h' && d.startLine === 120 && d.endLine === 145
        ),
        `Expected include/auth.h:120-145 in ${JSON.stringify(deps.workspaceFileDeps)}`
      );
      assert.ok(
        deps.workspaceFileDeps.some((d) => d.source === 'proto/service.proto' && d.unbounded === true),
        `Expected proto/service.proto in ${JSON.stringify(deps.workspaceFileDeps)}`
      );
      assert.ok(
        deps.workspaceFileDeps.some((d) => d.source === 'bin/council' && d.unbounded === true),
        `Expected bin/council in ${JSON.stringify(deps.workspaceFileDeps)}`
      );
      assert.ok(
        deps.workspaceFileDeps.some((d) => d.source === 'Makefile' && d.startLine === 42),
        `Expected Makefile:42 in ${JSON.stringify(deps.workspaceFileDeps)}`
      );
      assert.ok(
        deps.workspaceFileDeps.some((d) => d.source === 'Dockerfile' && d.unbounded === true),
        `Expected Dockerfile in ${JSON.stringify(deps.workspaceFileDeps)}`
      );
      assert.ok(!deps.workspaceFileDeps.some((d) => /and\/or|read\/write|Node\.js|v22/.test(d.source)));
      assert.ok(!deps.workspaceBroadDeps.some((d) => /and\/or|read\/write/.test(d)));

      assert.ok(deps.externalDeps.includes('RFC 9110'));
      assert.ok(deps.externalDeps.includes('ISO 27001'));
      assert.ok(deps.externalDeps.includes('CVE-2026-1234'));
      assert.ok(deps.externalDeps.includes('OWASP ASVS'));
      assert.ok(deps.externalDeps.includes('FIPS 140-3'));
      assert.ok(deps.externalDeps.includes('POSIX.1-2017'));
      assert.ok(deps.externalDeps.includes('example.org'));
      assert.ok(deps.externalDeps.includes('https://datatracker.ietf.org/doc/html/rfc9110'));
      assert.equal(
        deps.externalDeps.filter((d) => d.toLowerCase().replace(/\s+/g, '') === 'rfc9110').length,
        1,
        `Should extract single RFC 9110 token without duplicating URL slug: ${JSON.stringify(deps.externalDeps)}`
      );

      // 2. Named external standard in topic refuses conceptualNoExternalVerification (even with NO effectiveCwd),
      // and matches coveredArtifacts case-insensitively
      const topicRfcDenied = evaluateToolFreeEvidenceReadiness({
        phase: 'DELIBERATION',
        round: 1,
        errorClass: 'TimeoutError',
        topic: 'Verify caching behavior against RFC 9110 Section 15',
        selfContainedInput: {
          phases: ['DELIBERATION'],
          conceptualNoExternalVerification: true
        },
        originalInvocationMeta: { effectiveTools: 'read-only' }
      });
      assert.equal(topicRfcDenied.ready, false);
      assert.equal(topicRfcDenied.reasonCode, 'evidence_access_failure');
      assert.ok(topicRfcDenied.missingDependencies.includes('RFC 9110'));

      const caseInsensitiveRfcOk = evaluateToolFreeEvidenceReadiness({
        phase: 'DELIBERATION',
        round: 1,
        errorClass: 'TimeoutError',
        topic: 'Verify caching behavior against RFC 9110',
        evidence: [{ id: 'E1', label: 'RFC 9110 text', source: 'rfc 9110', text: '[E1] Complete RFC 9110 spec.' }],
        selfContainedInput: {
          phases: ['DELIBERATION'],
          coveredArtifacts: [{ source: 'rfc 9110', evidenceId: 'E1', coverage: 'complete_artifact' }]
        },
        originalInvocationMeta: { effectiveTools: 'read-only' }
      });
      assert.equal(caseInsensitiveRfcOk.ready, true);

      // 3. Round 2 DELIBERATION resolves prior-round backing proofs referenced by openObjections / previousCandidate
      // (including judgeAdmittedStatement!) even when Round 2 has 0 proofs submitted yet
      const r2BackingUncovered = evaluateToolFreeEvidenceReadiness({
        phase: 'DELIBERATION',
        round: 2,
        errorClass: 'TimeoutError',
        topic: 'Evaluate consensus soundness',
        proofs: [],
        priorProofs: [
          {
            id: 'P1',
            round: 1,
            seatId: 's1',
            status: 'contested',
            kind: 'citation',
            source: 'Spec',
            statement: 'Claim passes invariant',
            judgeAdmittedStatement: 'Core verified at include/auth.h:120-145'
          }
        ],
        previousCandidate: {
          round: 1,
          summary: 'Round 1 synthesis',
          clauses: [{ id: 'C1', context: 'Auth', conclusion: 'Core invariant holds', citedProofIds: ['P1'] }]
        },
        openObjections: [{ id: 'O1', seatId: 's2', proofId: 'P1', reason: 'Boundary condition disputed' }],
        admittedProofs: [],
        selfContainedInput: {
          phases: ['DELIBERATION'],
          roundScope: 'all_rounds',
          conceptualNoExternalVerification: true
        },
        originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo' }
      });
      assert.equal(r2BackingUncovered.ready, false);
      assert.equal(r2BackingUncovered.reasonCode, 'evidence_access_failure');

      // Reproducer from Review-102 Important 3: admitted Round 1 proof with uncovered external URL referenced by R2 objection
      const r2ExternalUrlObjection = evaluateToolFreeEvidenceReadiness({
        phase: 'DELIBERATION',
        round: 2,
        errorClass: 'TimeoutError',
        topic: 'Evaluate HTTP cache compliance',
        proofs: [],
        priorProofs: [
          {
            id: 'P1',
            round: 1,
            seatId: 's1',
            status: 'admitted',
            kind: 'citation',
            source: 'https://example.org/rfc9110',
            statement: 'Cache-Control must be respected'
          }
        ],
        previousCandidate: {
          round: 1,
          summary: 'Round 1 synthesis',
          clauses: [{ id: 'C1', context: 'HTTP', conclusion: 'Cache header holds', citedProofIds: ['P1'] }]
        },
        openObjections: [{ id: 'O1', seatId: 's2', proofId: 'P1', reason: 'Header exception missing' }],
        admittedProofs: [
          {
            id: 'P1',
            round: 1,
            seatId: 's1',
            status: 'admitted',
            kind: 'citation',
            source: 'https://example.org/rfc9110',
            statement: 'Cache-Control must be respected'
          }
        ],
        selfContainedInput: {
          phases: ['DELIBERATION'],
          roundScope: 'all_rounds',
          conceptualNoExternalVerification: true
        },
        originalInvocationMeta: { effectiveTools: 'read-only' }
      });
      assert.equal(r2ExternalUrlObjection.ready, false);
      assert.equal(r2ExternalUrlObjection.reasonCode, 'evidence_access_failure');

      // 4. CouncilEngine Round 2 DELIBERATION passes priorProofs into recovery planning:
      // Seat s1 submits P1 citing include/auth.h:120-145 in R1 (tools: 'read-only'); s2 objects in R1 voting (prose reason);
      // in R2 deliberation under conceptualNoExternalVerification, TimeoutError for s2 MUST terminate (NOT drop tools).
      const mock = new MockAdapter();
      let s2DelibR2Attempts = 0;
      const origProof = mock.executeSeatProof.bind(mock);
      const origJudge = mock.executeJudgeAuditAndSynthesis.bind(mock);
      const origVote = mock.executeSeatVote.bind(mock);

      mock.executeSeatProof = async (ctx) => {
        if (ctx.round === 1) {
          if (ctx.seat.id === 's1') {
            return {
              scope: 'Auth header',
              kind: 'citation',
              source: 'include/auth.h:120-145',
              statement: 'Expiry verified in include/auth.h:120-145'
            };
          }
          return {
            scope: 'Invariant',
            kind: 'check',
            source: 'Logical invariant',
            statement: 'Check holds conceptually'
          };
        }
        if (ctx.round === 2 && ctx.seat.id === 's2') {
          s2DelibR2Attempts += 1;
          throw new TimeoutError('Round 2 delib timeout', { timeoutMs: 1000, harness: 'codex', seatId: 's2' });
        }
        return origProof(ctx);
      };
      mock.executeJudgeAuditAndSynthesis = async (ctx) => {
        const base = await origJudge(ctx);
        if (ctx.round === 1) {
          return {
            ...base,
            summary: 'Round 1 candidate relying on P1',
            clauses: [{ id: 'C1', context: 'Auth', conclusion: 'Expiry check holds', citedProofIds: ['P1'] }],
            proofDecisions: {
              ...base.proofDecisions,
              P1: { status: 'partially_admitted', admittedStatement: 'Verified include/auth.h:120-145', note: 'Header only' }
            }
          };
        }
        return base;
      };
      mock.executeSeatVote = async (ctx) => {
        if (ctx.round === 1 && ctx.seat.id === 's2') {
          return { vote: 'object', proofId: 'P1', reason: 'Expiry edge case disputed' };
        }
        if (ctx.round === 1) {
          return { vote: 'accept' };
        }
        return origVote(ctx);
      };

      const engine = new CouncilEngine(
        {
          topic: 'Evaluate protocol consistency',
          minQuorum: 2,
          maxRounds: 2,
          maxRetriesPerSeat: 1,
          cwd: '/tmp/test-repo-r2',
          selfContainedInput: {
            kind: 'full_context',
            label: 'Conceptual only',
            phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
            roundScope: 'all_rounds',
            conceptualNoExternalVerification: true
          },
          judge: { id: 'judge', harness: 'codex', model: 'gpt-6-astra (high)' },
          seats: [
            { id: 's1', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S1', tools: 'read-only' },
            { id: 's2', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S2', tools: 'read-only' },
            { id: 's3', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S3', tools: 'read-only' }
          ]
        },
        { harnessResolver: () => mock }
      );

      await engine.run();
      assert.equal(s2DelibR2Attempts, 1, 'Round 2 Delib timeout referencing uncovered prior proof P1 must NOT retry tool-free');
    });

    it('ReReview-102 fixes: detects broader bare domains (.io/.dev/.ai/.co.uk), extensionless repo paths (assets/NOTICE), and preserves standard-named workspace files (src/openapi.js, docs/rfc9110.md)', () => {
      // 1. Bare external domains & host+path endpoints
      const domainCases = [
        { prompt: 'Verify the API at example.io.', expected: 'example.io' },
        { prompt: 'Verify the API at example.dev.', expected: 'example.dev' },
        { prompt: 'Verify the API at example.ai.', expected: 'example.ai' },
        { prompt: 'Verify the API at example.co.uk.', expected: 'example.co.uk' },
        { prompt: 'Check phoronix.com/benchmarks/kernel-6-8.', expected: 'phoronix.com/benchmarks/kernel-6-8' }
      ];
      for (const { prompt, expected } of domainCases) {
        const extracted = extractVerificationDependencies([prompt]);
        assert.deepEqual(extracted.workspaceFileDeps, [], `Expected no file deps for "${prompt}"`);
        assert.deepEqual(extracted.workspaceBroadDeps, [], `Expected no broad deps for "${prompt}"`);
        assert.deepEqual(extracted.externalDeps, [expected], `Expected "${expected}" external dep for "${prompt}"`);

        const denied = evaluateToolFreeEvidenceReadiness({
          phase: 'DELIBERATION',
          round: 1,
          errorClass: 'TimeoutError',
          topic: prompt,
          selfContainedInput: { phases: ['DELIBERATION'], conceptualNoExternalVerification: true },
          originalInvocationMeta: { effectiveTools: 'read-only' }
        });
        assert.equal(denied.ready, false);
        assert.equal(denied.reasonCode, 'evidence_access_failure');
        assert.ok(denied.missingDependencies.includes(expected));
      }

      const coveredCoUk = evaluateToolFreeEvidenceReadiness({
        phase: 'DELIBERATION',
        round: 1,
        errorClass: 'TimeoutError',
        topic: 'Verify the API at example.co.uk.',
        evidence: [{ id: 'E1', label: 'Spec', source: 'example.co.uk', text: 'API response fixture' }],
        selfContainedInput: {
          phases: ['DELIBERATION'],
          coveredArtifacts: [{ source: 'EXAMPLE.CO.UK', evidenceId: 'E1', coverage: 'complete_artifact' }]
        },
        originalInvocationMeta: { effectiveTools: 'read-only' }
      });
      assert.equal(coveredCoUk.ready, true);

      // 2. Extensionless workspace paths (assets/NOTICE, legal/ATTRIBUTION, hooks/pre-commit, packaging/debian/rules)
      const partialNoticeDenied = evaluateToolFreeEvidenceReadiness({
        phase: 'DELIBERATION',
        round: 1,
        errorClass: 'TimeoutError',
        topic: 'Inspect src/auth.js and assets/NOTICE.',
        evidence: [{ id: 'E1', label: 'Auth', source: 'src/auth.js', text: 'export const auth = true;' }],
        selfContainedInput: {
          phases: ['DELIBERATION'],
          coveredArtifacts: [{ source: 'src/auth.js', evidenceId: 'E1', coverage: 'complete_artifact' }]
        },
        originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo' }
      });
      assert.equal(partialNoticeDenied.ready, false);
      assert.equal(partialNoticeDenied.reasonCode, 'evidence_access_failure');
      assert.ok(partialNoticeDenied.missingDependencies.includes('assets/NOTICE'));

      const fullNoticeReady = evaluateToolFreeEvidenceReadiness({
        phase: 'DELIBERATION',
        round: 1,
        errorClass: 'TimeoutError',
        topic: 'Inspect src/auth.js and assets/NOTICE.',
        evidence: [
          { id: 'E1', label: 'Auth', source: 'src/auth.js', text: 'export const auth = true;' },
          { id: 'E2', label: 'Notice', source: 'assets/NOTICE', text: 'Copyright 2026 The Council' }
        ],
        selfContainedInput: {
          phases: ['DELIBERATION'],
          coveredArtifacts: [
            { source: 'src/auth.js', evidenceId: 'E1', coverage: 'complete_artifact' },
            { source: 'assets/NOTICE', evidenceId: 'E2', coverage: 'complete_artifact' }
          ]
        },
        originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo' }
      });
      assert.equal(fullNoticeReady.ready, true);

      const extlessBatch = extractVerificationDependencies([
        'Inspect legal/ATTRIBUTION, hooks/pre-commit, and packaging/debian/rules.'
      ]);
      assert.deepEqual(extlessBatch.workspaceBroadDeps, []);
      assert.deepEqual(extlessBatch.externalDeps, []);
      assert.deepEqual(extlessBatch.workspaceFileDeps, [
        { source: 'legal/ATTRIBUTION', unbounded: true },
        { source: 'hooks/pre-commit', unbounded: true },
        { source: 'packaging/debian/rules', unbounded: true }
      ]);

      // 3. Standard-named workspace files must remain file dependencies, not masked into external standards
      for (const filePath of ['src/openapi.js', 'docs/rfc9110.md', 'openapi.yaml']) {
        const extracted = extractVerificationDependencies([`Inspect ${filePath}.`]);
        assert.deepEqual(extracted.workspaceFileDeps, [{ source: filePath, unbounded: true }]);
        assert.deepEqual(extracted.workspaceBroadDeps, []);
        assert.deepEqual(extracted.externalDeps, []);

        const ready = evaluateToolFreeEvidenceReadiness({
          phase: 'DELIBERATION',
          round: 1,
          errorClass: 'TimeoutError',
          topic: `Inspect ${filePath}.`,
          evidence: [{ id: 'E1', label: 'File', source: filePath, text: 'full content' }],
          selfContainedInput: {
            phases: ['DELIBERATION'],
            coveredArtifacts: [{ source: filePath, evidenceId: 'E1', coverage: 'complete_artifact' }]
          },
          originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo' }
        });
        assert.equal(ready.ready, true, `Expected ${filePath} with complete_artifact to be ready`);
      }

      const rangedStandardFile = extractVerificationDependencies(['Check specs/cve-2026-1234.json:1-20.']);
      assert.deepEqual(rangedStandardFile.workspaceFileDeps, [
        { source: 'specs/cve-2026-1234.json', startLine: 1, endLine: 20 }
      ]);
      assert.deepEqual(rangedStandardFile.workspaceBroadDeps, []);
      assert.deepEqual(rangedStandardFile.externalDeps, []);

      // Co-occurrence of standard-named workspace file and external standards in one prompt
      const mixedPrompt = 'Verify that src/openapi.js conforms to OpenAPI 3.1.0 and ISO/IEC 27001.';
      const mixedDeps = extractVerificationDependencies([mixedPrompt]);
      assert.deepEqual(mixedDeps.workspaceFileDeps, [{ source: 'src/openapi.js', unbounded: true }]);
      assert.deepEqual(mixedDeps.workspaceBroadDeps, []);
      assert.deepEqual(mixedDeps.externalDeps, ['OpenAPI 3.1.0', 'ISO/IEC 27001']);

      const mixedMissingStd = evaluateToolFreeEvidenceReadiness({
        phase: 'DELIBERATION',
        round: 1,
        errorClass: 'TimeoutError',
        topic: mixedPrompt,
        evidence: [{ id: 'E1', label: 'OpenAPI File', source: 'src/openapi.js', text: 'export const spec = {};' }],
        selfContainedInput: {
          phases: ['DELIBERATION'],
          coveredArtifacts: [{ source: 'src/openapi.js', evidenceId: 'E1', coverage: 'complete_artifact' }]
        },
        originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo' }
      });
      assert.equal(mixedMissingStd.ready, false);
      assert.equal(mixedMissingStd.reasonCode, 'evidence_access_failure');

      const mixedAllCovered = evaluateToolFreeEvidenceReadiness({
        phase: 'DELIBERATION',
        round: 1,
        errorClass: 'TimeoutError',
        topic: mixedPrompt,
        evidence: [
          { id: 'E1', label: 'OpenAPI File', source: 'src/openapi.js', text: 'export const spec = {};' },
          { id: 'E2', label: 'OpenAPI Spec', source: 'OpenAPI 3.1.0', text: 'OpenAPI 3.1.0 specification text' },
          { id: 'E3', label: 'ISO Spec', source: 'ISO/IEC 27001', text: 'ISO/IEC 27001 specification text' }
        ],
        selfContainedInput: {
          phases: ['DELIBERATION'],
          coveredArtifacts: [
            { source: 'src/openapi.js', evidenceId: 'E1', coverage: 'complete_artifact' },
            { source: 'OpenAPI 3.1.0', evidenceId: 'E2', coverage: 'complete_artifact' },
            { source: 'ISO/IEC 27001', evidenceId: 'E3', coverage: 'complete_artifact' }
          ]
        },
        originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo' }
      });
      assert.equal(mixedAllCovered.ready, true);

      // 4. Conceptual prose & technical non-path slash tokens remain non-blocking
      const conceptualPrompt =
        'Consider and/or, read/write, public/private, internal/external, 10k ops/sec, 4500 tx/sec, codex/gpt-6-astra, Math.min, Node.js v22.1.0 ... conceptually.';
      const conceptualDeps = extractVerificationDependencies([conceptualPrompt]);
      assert.deepEqual(conceptualDeps.workspaceFileDeps, []);
      assert.deepEqual(conceptualDeps.workspaceBroadDeps, []);
      assert.deepEqual(conceptualDeps.externalDeps, []);

      const conceptualReady = evaluateToolFreeEvidenceReadiness({
        phase: 'DELIBERATION',
        round: 1,
        errorClass: 'TimeoutError',
        topic: conceptualPrompt,
        selfContainedInput: { phases: ['DELIBERATION'], conceptualNoExternalVerification: true },
        originalInvocationMeta: { effectiveTools: 'read-only' }
      });
      assert.equal(conceptualReady.ready, true);
    });

    it('ReReview-102 Round 2 regressions: preserves multi-segment extensions, workspace root paths, ranged JS nouns, relative globs/dirs, exact bare endpoint path/query coverage, and linear version scanning', () => {
      function params(topic, sources = [], cwd = '/repo', errorClass = 'TimeoutError', evidenceOverrides = null) {
        return {
          phase: 'DELIBERATION',
          round: 1,
          errorClass,
          topic,
          evidence: sources.map((source, i) => ({
            id: `E${i + 1}`,
            source: evidenceOverrides?.[i] ?? source,
            text: `complete content for ${source}`
          })),
          selfContainedInput: {
            phases: ['DELIBERATION'],
            coveredArtifacts: sources.map((source, i) => ({
              source,
              evidenceId: `E${i + 1}`,
              coverage: 'complete_artifact'
            }))
          },
          originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: cwd }
        };
      }

      // 1. Consolidated 24-case refusal matrix (12 targets x 2 error classes, both bare & period-terminated)
      const regressionTargets = [
        'reports/audit.pdf',
        'web/logo.png',
        'foo/bar.weird',
        'src/ops',
        'config/rows',
        'src/min',
        'Node.js:1-20',
        './example.dev/',
        './example.dev/*',
        './site.io/**',
        'example.com/API',
        'example.com/api?version=2'
      ];
      let refusalCases = 0;
      for (const target of regressionTargets) {
        const coveredOnlySources = target.startsWith('example.com/')
          ? ['src/auth.js', 'example.com/api']
          : ['src/auth.js'];
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          for (const suffix of ['', '.']) {
            const verdict = evaluateToolFreeEvidenceReadiness(
              params(`Inspect src/auth.js and ${target}${suffix}`, coveredOnlySources, '/repo', errorClass)
            );
            assert.equal(verdict.ready, false, `Expected refusal for ${target}${suffix} (${errorClass})`);
            assert.equal(verdict.reasonCode, 'evidence_access_failure');
          }
          refusalCases += 1;
        }
      }
      assert.equal(refusalCases, 24);

      // 2. Exact dependency extraction & positive coverage checks
      for (const fileTarget of [
        'reports/audit.pdf',
        'web/logo.png',
        'foo/bar.weird',
        'src/ops',
        'config/rows',
        'src/min',
        'releases/v1.2.json'
      ]) {
        const extracted = extractVerificationDependencies([`Inspect ${fileTarget}.`]);
        assert.deepEqual(extracted.workspaceFileDeps, [{ source: fileTarget, unbounded: true }]);
        assert.deepEqual(extracted.workspaceBroadDeps, []);
        assert.deepEqual(extracted.externalDeps, []);
      }

      for (const coveredFile of ['reports/audit.pdf', 'src/ops']) {
        assert.equal(
          evaluateToolFreeEvidenceReadiness(
            params(`Inspect src/auth.js and ${coveredFile}`, ['src/auth.js', coveredFile], '/repo')
          ).ready,
          true,
          `Expected complete coverage to allow ${coveredFile}`
        );
      }

      const rangedNode = extractVerificationDependencies(['Inspect Node.js:1-20.']);
      assert.deepEqual(rangedNode, {
        workspaceFileDeps: [{ source: 'Node.js', startLine: 1, endLine: 20 }],
        workspaceBroadDeps: [],
        externalDeps: []
      });
      assert.equal(
        evaluateToolFreeEvidenceReadiness(
          params('Inspect src/auth.js and Node.js:1-20', ['src/auth.js', 'Node.js'], '/repo')
        ).ready,
        true
      );

      const rangedDomainFile = extractVerificationDependencies(['Inspect example.dev:1-20.']);
      assert.deepEqual(rangedDomainFile, {
        workspaceFileDeps: [{ source: 'example.dev', startLine: 1, endLine: 20 }],
        workspaceBroadDeps: [],
        externalDeps: []
      });

      const domainWithPort = extractVerificationDependencies(['Verify example.dev:8080.']);
      assert.deepEqual(domainWithPort, {
        workspaceFileDeps: [],
        workspaceBroadDeps: [],
        externalDeps: ['example.dev:8080']
      });

      assert.deepEqual(extractVerificationDependencies(['Inspect ./example.dev/.']), {
        workspaceFileDeps: [],
        workspaceBroadDeps: ['example.dev/'],
        externalDeps: []
      });
      assert.deepEqual(extractVerificationDependencies(['Inspect ./example.dev/*.']), {
        workspaceFileDeps: [],
        workspaceBroadDeps: ['example.dev/*'],
        externalDeps: []
      });
      assert.deepEqual(extractVerificationDependencies(['Inspect ./site.io/**.']), {
        workspaceFileDeps: [],
        workspaceBroadDeps: ['site.io/**'],
        externalDeps: []
      });

      assert.deepEqual(extractVerificationDependencies(['Compare example.com/api and example.com/API.']), {
        workspaceFileDeps: [],
        workspaceBroadDeps: [],
        externalDeps: ['example.com/api', 'example.com/API']
      });
      assert.deepEqual(extractVerificationDependencies(['Inspect example.com/api?version=2.']), {
        workspaceFileDeps: [],
        workspaceBroadDeps: [],
        externalDeps: ['example.com/api?version=2']
      });

      assert.equal(
        evaluateToolFreeEvidenceReadiness(
          params('Inspect src/auth.js and example.com/API', ['src/auth.js', 'example.com/API'], '/repo')
        ).ready,
        true
      );
      assert.equal(
        evaluateToolFreeEvidenceReadiness(
          params('Inspect src/auth.js and example.com/API', ['src/auth.js', 'EXAMPLE.COM/API'], '/repo')
        ).ready,
        true
      );
      assert.equal(
        evaluateToolFreeEvidenceReadiness(
          params(
            'Inspect src/auth.js and example.com/api?version=2',
            ['src/auth.js', 'example.com/api?version=2'],
            '/repo'
          )
        ).ready,
        true
      );
      // Spoofed/mismatched evidence.source ('example.com/api' vs artifact.source 'example.com/API') must refuse
      assert.equal(
        evaluateToolFreeEvidenceReadiness(
          params(
            'Inspect src/auth.js and example.com/API',
            ['src/auth.js', 'example.com/API'],
            '/repo',
            'TimeoutError',
            ['src/auth.js', 'example.com/api']
          )
        ).ready,
        false
      );

      // 3. Linear-time scan check on 32k version/path strings (< 50 ms)
      for (const { sample, expectEmpty } of [
        { sample: `v1.${'1.'.repeat(16000)}_`, expectEmpty: true },
        { sample: `foo/${'1.'.repeat(16000)}!`, expectEmpty: true },
        { sample: `foo/${'1.'.repeat(16000)}_`, expectEmpty: false }
      ]) {
        const startMs = performance.now();
        const deps = extractVerificationDependencies(sample);
        const elapsedMs = performance.now() - startMs;
        if (expectEmpty) {
          assert.deepEqual(deps, { workspaceFileDeps: [], workspaceBroadDeps: [], externalDeps: [] });
        }
        assert.ok(elapsedMs < 50, `Expected linear scan <50ms, took ${elapsedMs.toFixed(2)}ms`);
      }
    });

    it('ReReview-102 Round 3 fixes: preserves punctuation in explicitly delimited or standalone endpoints/URLs and keeps unprefixed domain wildcards external', async () => {
      function params(topic, sources = [], cwd = '/repo', errorClass = 'TimeoutError', extra = {}) {
        return {
          phase: 'DELIBERATION',
          round: 1,
          errorClass,
          topic,
          evidence: sources.map((source, i) => ({
            id: `E${i + 1}`,
            source,
            text: `complete content for ${source}`
          })),
          selfContainedInput: {
            phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
            roundScope: 'all_rounds',
            coveredArtifacts: sources.map((source, i) => ({
              source,
              evidenceId: `E${i + 1}`,
              coverage: 'complete_artifact'
            }))
          },
          originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: cwd },
          ...extra
        };
      }

      // 1. Delimited endpoint & URL trailing punctuation preservation across all symmetric delimiter pairs
      const bareEndpoint = 'example.com/api?token=abc!';
      const bareStripped = 'example.com/api?token=abc';
      for (const wrapped of [
        `\`${bareEndpoint}\``,
        `"${bareEndpoint}"`,
        `'${bareEndpoint}'`,
        `<${bareEndpoint}>`,
        `(${bareEndpoint})`,
        `[${bareEndpoint}]`
      ]) {
        const topic = `Inspect src/auth.js and ${wrapped}.`;
        assert.deepEqual(extractVerificationDependencies([topic]), {
          workspaceFileDeps: [{ source: 'src/auth.js', unbounded: true }],
          workspaceBroadDeps: [],
          externalDeps: [bareEndpoint]
        });
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          const incomplete = evaluateToolFreeEvidenceReadiness(
            params(topic, ['src/auth.js', bareStripped], '/repo', errorClass)
          );
          assert.equal(incomplete.ready, false, `Expected refusal for ${wrapped} when covered only with ${bareStripped} (${errorClass})`);
          assert.equal(incomplete.reasonCode, 'evidence_access_failure');

          const complete = evaluateToolFreeEvidenceReadiness(
            params(topic, ['src/auth.js', bareEndpoint], '/repo', errorClass)
          );
          assert.equal(complete.ready, true, `Expected ready=true for ${wrapped} with exact ${bareEndpoint} (${errorClass})`);
        }
      }

      // Delimited full-scheme URL punctuation preservation
      const fullUrl = 'https://example.com/api?token=abc!';
      const fullUrlStripped = 'https://example.com/api?token=abc';
      const urlTopic = `Inspect src/auth.js and \`${fullUrl}\`.`;
      assert.deepEqual(extractVerificationDependencies([urlTopic]), {
        workspaceFileDeps: [{ source: 'src/auth.js', unbounded: true }],
        workspaceBroadDeps: [],
        externalDeps: [fullUrl]
      });
      assert.equal(
        evaluateToolFreeEvidenceReadiness(params(urlTopic, ['src/auth.js', fullUrlStripped], '/repo')).ready,
        false
      );
      assert.equal(
        evaluateToolFreeEvidenceReadiness(params(urlTopic, ['src/auth.js', fullUrl], '/repo')).ready,
        true
      );

      // Standalone structured proof.source punctuation preservation across JUDGE_AUDIT_SYNTHESIS & VOTING
      const proofList = [
        {
          id: 'P1',
          round: 1,
          seatId: 's1',
          status: 'admitted',
          kind: 'citation',
          source: bareEndpoint,
          statement: 'Verified response from `example.com/api?token=abc!`'
        }
      ];
      for (const phaseCheck of [
        { phase: 'JUDGE_AUDIT_SYNTHESIS', extra: { proofs: proofList } },
        {
          phase: 'VOTING',
          extra: {
            proofs: proofList,
            admittedProofs: proofList,
            candidate: {
              summary: 'Summary',
              clauses: [{ id: 'C1', context: 'API', conclusion: 'Valid', citedProofIds: ['P1'] }]
            }
          }
        }
      ]) {
        assert.equal(
          evaluateToolFreeEvidenceReadiness(
            params('Verify `example.com/api?token=abc!` behavior', [bareStripped], '/repo', 'TimeoutError', {
              phase: phaseCheck.phase,
              ...phaseCheck.extra
            })
          ).ready,
          false,
          `${phaseCheck.phase} must refuse mismatched stripped proof.source coverage`
        );
        assert.equal(
          evaluateToolFreeEvidenceReadiness(
            params('Verify `example.com/api?token=abc!` behavior', [bareEndpoint], '/repo', 'TimeoutError', {
              phase: phaseCheck.phase,
              ...phaseCheck.extra
            })
          ).ready,
          true,
          `${phaseCheck.phase} must allow exact proof.source coverage`
        );
      }

      // Runtime CouncilEngine end-to-end refusal across Deliberation, Judging & Voting with bareStripped coverage only
      const mock = new MockAdapter();
      let s1DelibCalls = 0;
      const origProof = mock.executeSeatProof.bind(mock);
      mock.executeSeatProof = async (ctx) => {
        if (ctx.seat.id === 's1') {
          s1DelibCalls += 1;
          throw new TimeoutError('Delib timeout', { timeoutMs: 1000, harness: 'codex', seatId: 's1' });
        }
        return origProof(ctx);
      };
      const engine = new CouncilEngine(
        {
          topic: 'Inspect src/auth.js and `example.com/api?token=abc!` for correctness',
          minQuorum: 2,
          maxRounds: 1,
          maxRetriesPerSeat: 1,
          cwd: '/repo',
          evidence: [
            { id: 'E1', label: 'Auth', source: 'src/auth.js', text: 'export const ok = true;' },
            { id: 'E2', label: 'Wrong Endpoint', source: bareStripped, text: 'wrong endpoint body' }
          ],
          selfContainedInput: {
            kind: 'full_context',
            label: 'Mismatched endpoint test',
            phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
            roundScope: 'all_rounds',
            coveredArtifacts: [
              { source: 'src/auth.js', evidenceId: 'E1', coverage: 'complete_artifact' },
              { source: bareStripped, evidenceId: 'E2', coverage: 'complete_artifact' }
            ]
          },
          seats: [
            { id: 's1', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S1', tools: 'read-only' },
            { id: 's2', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'S2', tools: 'none' },
            { id: 's3', harness: 'cursor', model: 'grok-4', soul: 'S3', tools: 'none' }
          ]
        },
        { harnessResolver: () => mock }
      );
      await engine.run();
      assert.equal(s1DelibCalls, 1, 'CouncilEngine must refuse tool-free retry when coverage omits trailing ! inside backticks');

      // Unquoted prose sentence punctuation must still be stripped cleanly
      assert.deepEqual(extractVerificationDependencies(['He asked: "Verify example.com/api?token=abc."']), {
        workspaceFileDeps: [],
        workspaceBroadDeps: [],
        externalDeps: ['example.com/api?token=abc']
      });
      assert.deepEqual(extractVerificationDependencies(['Verify example.com/api?version=2.']), {
        workspaceFileDeps: [],
        workspaceBroadDeps: [],
        externalDeps: ['example.com/api?version=2']
      });

      // 2. Minor 2: Unprefixed domain wildcard stays externalDep; explicit relative ./ globs remain workspaceBroadDeps
      assert.deepEqual(extractVerificationDependencies(['Inspect src/auth.js and example.com/api*.']), {
        workspaceFileDeps: [{ source: 'src/auth.js', unbounded: true }],
        workspaceBroadDeps: [],
        externalDeps: ['example.com/api*']
      });
      for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
        assert.equal(
          evaluateToolFreeEvidenceReadiness(
            params('Inspect src/auth.js and example.com/api*', ['src/auth.js'], '/repo', errorClass)
          ).ready,
          false
        );
        assert.equal(
          evaluateToolFreeEvidenceReadiness(
            params('Inspect src/auth.js and example.com/api*', ['src/auth.js', 'example.com/api'], '/repo', errorClass)
          ).ready,
          false
        );
        assert.equal(
          evaluateToolFreeEvidenceReadiness(
            params('Inspect src/auth.js and example.com/api*', ['src/auth.js', 'example.com/api*'], '/repo', errorClass)
          ).ready,
          true
        );
      }

      for (const [input, expectedBroad] of [
        ['./example.com/api*', 'example.com/api*'],
        ['./example.dev/', 'example.dev/'],
        ['./example.dev/*', 'example.dev/*'],
        ['./site.io/**', 'site.io/**']
      ]) {
        assert.deepEqual(extractVerificationDependencies([`Inspect ${input}.`]), {
          workspaceFileDeps: [],
          workspaceBroadDeps: [expectedBroad],
          externalDeps: []
        });
        assert.equal(
          evaluateToolFreeEvidenceReadiness(params(`Inspect ${input}`, [expectedBroad], '/repo')).ready,
          false
        );
      }
    });

    it('ReReview-102 Round 4 fix: extracts complete standard-prefixed bare domains and wildcard endpoints before embedded standard names', async () => {
      function params(
        topic,
        coveredSources = [],
        effectiveCwd = '/repo',
        errorClass = 'TimeoutError',
        phase = 'DELIBERATION',
        round = 1
      ) {
        return {
          phase,
          round,
          errorClass,
          topic,
          evidence: coveredSources.map((source, i) => ({
            id: `E${i + 1}`,
            source,
            text: `complete content for ${source}`
          })),
          selfContainedInput: {
            phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
            roundScope: 'all_rounds',
            coveredArtifacts: coveredSources.map((source, i) => ({
              source,
              evidenceId: `E${i + 1}`,
              coverage: 'complete_artifact'
            }))
          },
          originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd }
        };
      }

      const cases = [
        ['openapi.org/api*', 'OpenAPI'],
        ['ietf.org/api*', 'IETF'],
        ['rfc9110.com/api*', 'RFC 9110'],
        ['w3c.org/TR/CSP3', 'W3C'],
        ['owasp.org/Top10', 'OWASP'],
        ['mdn.dev/docs*', 'MDN'],
        ['posix.org/spec*', 'POSIX'],
        ['ieee802.org/11*', 'IEEE 802'],
        ['iso27001.org/controls*', 'ISO 27001'],
        ['fips140.org/annex*', 'FIPS 140'],
        ['bcp14.org/keywords*', 'BCP 14'],
        ['ecma-262.org/sec*', 'ECMA-262'],
        ['cwe-79.org/xss*', 'CWE-79'],
        ['cve-2026-1234.org/advisory*', 'CVE-2026-1234'],
        ['openapi.org', 'OpenAPI'],
        ['docs.openapi.org/spec/rfc9110', 'RFC 9110']
      ];

      for (const [endpoint, wrongStd] of cases) {
        const topic = `Inspect src/auth.js and ${endpoint}.`;
        assert.deepEqual(extractVerificationDependencies([topic]), {
          workspaceFileDeps: [{ source: 'src/auth.js', unbounded: true }],
          workspaceBroadDeps: [],
          externalDeps: [endpoint]
        });

        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          const wrongRes = evaluateToolFreeEvidenceReadiness(
            params(topic, ['src/auth.js', wrongStd], '/repo', errorClass)
          );
          assert.equal(wrongRes.ready, false, `Expected refusal for ${endpoint} covered only with ${wrongStd} (${errorClass})`);
          assert.equal(wrongRes.reasonCode, 'evidence_access_failure');

          const exactRes = evaluateToolFreeEvidenceReadiness(
            params(topic, ['src/auth.js', endpoint], '/repo', errorClass)
          );
          assert.equal(exactRes.ready, true, `Expected ready=true for ${endpoint} with exact coverage (${errorClass})`);
        }
      }

      assert.deepEqual(
        extractVerificationDependencies([
          'Verify src/openapi.js against OpenAPI 3.1.0, `openapi.org/api*!`, ietf.org/api*, and ISO/IEC 27001.'
        ]),
        {
          workspaceFileDeps: [{ source: 'src/openapi.js', unbounded: true }],
          workspaceBroadDeps: [],
          externalDeps: ['openapi.org/api*!', 'ietf.org/api*', 'OpenAPI 3.1.0', 'ISO/IEC 27001']
        }
      );

      for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
        const wrongMock = new MockAdapter();
        let wrongCalls = 0;
        const origWrongProof = wrongMock.executeSeatProof.bind(wrongMock);
        wrongMock.executeSeatProof = async (ctx) => {
          if (ctx.seat.id === 's1') {
            wrongCalls += 1;
            throw errorClass === 'TimeoutError'
              ? new TimeoutError('Delib timeout', { timeoutMs: 1000, harness: 'codex', seatId: 's1' })
              : new HeadlessToolDeniedError('Tool denied', {
                  harness: 'codex',
                  seatId: 's1',
                  exitCode: 0,
                  isRetryable: true
                });
          }
          return origWrongProof(ctx);
        };

        const refusedEngine = new CouncilEngine(
          {
            topic: 'Inspect src/auth.js and openapi.org/api*.',
            minQuorum: 2,
            maxRounds: 1,
            maxRetriesPerSeat: 1,
            cwd: '/repo',
            evidence: [
              { id: 'E1', label: 'Auth', source: 'src/auth.js', text: 'export const ok = true;' },
              { id: 'E2', label: 'Standard', source: 'OpenAPI', text: 'General OpenAPI summary' }
            ],
            selfContainedInput: {
              kind: 'full_context',
              label: 'Wrong standard coverage for endpoint',
              phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
              roundScope: 'all_rounds',
              coveredArtifacts: [
                { source: 'src/auth.js', evidenceId: 'E1', coverage: 'complete_artifact' },
                { source: 'OpenAPI', evidenceId: 'E2', coverage: 'complete_artifact' }
              ]
            },
            seats: [
              { id: 's1', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S1', tools: 'read-only' },
              { id: 's2', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'S2', tools: 'none' },
              { id: 's3', harness: 'cursor', model: 'grok-4', soul: 'S3', tools: 'none' }
            ]
          },
          { harnessResolver: () => wrongMock }
        );
        await refusedEngine.run();
        assert.equal(wrongCalls, 1, `CouncilEngine must refuse tool-free retry under ${errorClass} when covered only with OpenAPI`);
        const refusedS1 = refusedEngine.state.seats.find((s) => s.id === 's1');
        assert.equal(refusedS1.status, 'excused');
        assert.match(String(refusedS1.excusedReason || ''), /evidence_access_failure|insufficient self-contained evidence/i);

        const rightMock = new MockAdapter();
        const rightCalls = [];
        const origRightProof = rightMock.executeSeatProof.bind(rightMock);
        rightMock.executeSeatProof = async (ctx) => {
          if (ctx.seat.id === 's1') {
            rightCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (rightCalls.length === 1) {
              throw errorClass === 'TimeoutError'
                ? new TimeoutError('Delib timeout', { timeoutMs: 1000, harness: 'codex', seatId: 's1' })
                : new HeadlessToolDeniedError('Tool denied', {
                    harness: 'codex',
                    seatId: 's1',
                    exitCode: 0,
                    isRetryable: true
                  });
            }
          }
          return origRightProof(ctx);
        };

        const allowedEngine = new CouncilEngine(
          {
            topic: 'Inspect src/auth.js and openapi.org/api*.',
            minQuorum: 2,
            maxRounds: 1,
            maxRetriesPerSeat: 1,
            cwd: '/repo',
            evidence: [
              { id: 'E1', label: 'Auth', source: 'src/auth.js', text: 'export const ok = true;' },
              { id: 'E2', label: 'Endpoint', source: 'openapi.org/api*', text: 'Complete endpoint snapshot' }
            ],
            selfContainedInput: {
              kind: 'full_context',
              label: 'Exact endpoint coverage',
              phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
              roundScope: 'all_rounds',
              coveredArtifacts: [
                { source: 'src/auth.js', evidenceId: 'E1', coverage: 'complete_artifact' },
                { source: 'openapi.org/api*', evidenceId: 'E2', coverage: 'complete_artifact' }
              ]
            },
            seats: [
              { id: 's1', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S1', tools: 'read-only' },
              { id: 's2', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'S2', tools: 'none' },
              { id: 's3', harness: 'cursor', model: 'grok-4', soul: 'S3', tools: 'none' }
            ]
          },
          { harnessResolver: () => rightMock }
        );
        await allowedEngine.run();
        assert.equal(rightCalls.length, 2, `CouncilEngine must permit one bounded tool-free retry under ${errorClass} with exact openapi.org/api* coverage`);
        assert.equal(rightCalls[0].tools, 'read-only');
        assert.equal(rightCalls[0].cwd, '/repo');
        assert.equal(rightCalls[1].tools, 'none');
        assert.equal(rightCalls[1].cwd, undefined);
      }
    });

    it('ReReview-102 Round 5 fixes: preserves embedded .. in bare endpoints, literal punctuation in structured proof/clarification sources, and port-qualified wildcard endpoints', async () => {
      function makeReadinessParams({
        phase = 'DELIBERATION',
        round = 1,
        errorClass = 'TimeoutError',
        topic = 'Inspect src/auth.js.',
        clarifications = [],
        proofs = [],
        priorProofs = [],
        candidate = null,
        previousCandidate = null,
        openObjections = [],
        admittedProofs = [],
        coveredSources = ['src/auth.js'],
        effectiveCwd = '/repo'
      }) {
        return {
          phase,
          round,
          errorClass,
          topic,
          clarifications,
          proofs,
          priorProofs,
          candidate,
          previousCandidate,
          openObjections,
          admittedProofs,
          evidence: coveredSources.map((source, i) => ({
            id: `E${i + 1}`,
            source,
            text: `complete snapshot for ${source}`
          })),
          selfContainedInput: {
            phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
            roundScope: 'all_rounds',
            coveredArtifacts: coveredSources.map((source, i) => ({
              source,
              evidenceId: `E${i + 1}`,
              coverage: 'complete_artifact'
            }))
          },
          originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd }
        };
      }

      async function runPhaseEngineCase({
        phase,
        errorClass,
        topic = 'Inspect src/auth.js.',
        clarifications = [],
        s1Proof = null,
        coveredSources = []
      }) {
        const mock = new MockAdapter();
        const targetCalls = [];
        const origProof = mock.executeSeatProof.bind(mock);
        const origJudge = mock.executeJudgeAuditAndSynthesis.bind(mock);
        const origVote = mock.executeSeatVote.bind(mock);

        const makeFault = (participantId) =>
          errorClass === 'TimeoutError'
            ? new TimeoutError(`${phase} timeout`, { timeoutMs: 1000, harness: 'codex', seatId: participantId })
            : new HeadlessToolDeniedError(`${phase} tool denied`, {
                harness: 'codex',
                seatId: participantId,
                exitCode: 0,
                isRetryable: true
              });

        mock.executeSeatProof = async (ctx) => {
          if (phase === 'R1_DELIBERATION' && ctx.round === 1 && ctx.seat.id === 's1') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s1');
            }
          }
          if (phase === 'R2_DELIBERATION' && ctx.round === 2 && ctx.seat.id === 's2') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s2');
            }
          }
          if (ctx.round === 1 && ctx.seat.id === 's1' && s1Proof) {
            return s1Proof;
          }
          return origProof(ctx);
        };

        mock.executeJudgeAuditAndSynthesis = async (ctx) => {
          if (phase === 'JUDGE_AUDIT_SYNTHESIS' && ctx.round === 1) {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('judge');
            }
          }
          return origJudge(ctx);
        };

        mock.executeSeatVote = async (ctx) => {
          if (phase === 'VOTING' && ctx.round === 1 && ctx.seat.id === 's1') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s1');
            }
          }
          if (phase === 'R2_DELIBERATION' && ctx.round === 1 && ctx.seat.id === 's2') {
            return { vote: 'object', proofId: 'P1', reason: 'Dispute R1 proof in R2' };
          }
          return origVote(ctx);
        };

        const engine = new CouncilEngine(
          {
            topic,
            clarifications,
            maxClarificationBatches: clarifications.length,
            minQuorum: 2,
            maxRounds: phase === 'R2_DELIBERATION' ? 2 : 1,
            maxRetriesPerSeat: 1,
            maxRetriesPerJudge: 1,
            cwd: '/repo',
            evidence: coveredSources.map((source, i) => ({
              id: `E${i + 1}`,
              label: `Artifact ${i + 1}`,
              source,
              text: `complete snapshot for ${source}`
            })),
            selfContainedInput: {
              kind: 'full_context',
              label: 'Phase matrix check',
              phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
              roundScope: 'all_rounds',
              coveredArtifacts: coveredSources.map((source, i) => ({
                source,
                evidenceId: `E${i + 1}`,
                coverage: 'complete_artifact'
              }))
            },
            judge: { id: 'judge', harness: 'codex', model: 'gpt-6-astra (high)', tools: 'read-only', cwd: '/repo' },
            seats: [
              {
                id: 's1',
                harness: 'codex',
                model: 'gpt-6-astra (high)',
                soul: 'S1',
                tools: 'read-only',
                votingTools: 'read-only',
                cwd: '/repo'
              },
              { id: 's2', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S2', tools: 'read-only', cwd: '/repo' },
              { id: 's3', harness: 'cursor', model: 'grok-4', soul: 'S3', tools: 'none' }
            ]
          },
          { harnessResolver: () => mock }
        );

        await engine.run();
        return { engine, targetCalls };
      }

      // 1. Finding 1 (Important): Embedded `..` in bare endpoints must NOT be truncated before extraction.
      const embeddedDotCases = [
        { input: 'Inspect src/auth.js and `openapi.org/api?token=a..b`.', expected: 'openapi.org/api?token=a..b' },
        { input: 'Inspect src/auth.js and openapi.org/api?token=a..b.', expected: 'openapi.org/api?token=a..b' },
        { input: 'Check src/auth.js and example.com/v1..v2/spec*.', expected: 'example.com/v1..v2/spec*' },
        { input: 'Inspect src/auth.js. Wait...openapi.org/api?token=a..b', expected: 'openapi.org/api?token=a..b' }
      ];
      for (const { input, expected } of embeddedDotCases) {
        assert.deepEqual(extractVerificationDependencies([input]), {
          workspaceFileDeps: [{ source: 'src/auth.js', unbounded: true }],
          workspaceBroadDeps: [],
          externalDeps: [expected]
        });
      }

      assert.deepEqual(extractVerificationDependencies(['Check openapi.org/api...']), {
        workspaceFileDeps: [],
        workspaceBroadDeps: [],
        externalDeps: ['openapi.org/api']
      });
      assert.deepEqual(extractVerificationDependencies(['Check `openapi.org/api...`']), {
        workspaceFileDeps: [],
        workspaceBroadDeps: [],
        externalDeps: ['openapi.org/api...']
      });

      const dotTopic = 'Inspect src/auth.js and `openapi.org/api?token=a..b`.';
      for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
        const truncatedRes = evaluateToolFreeEvidenceReadiness(
          makeReadinessParams({
            errorClass,
            topic: dotTopic,
            coveredSources: ['src/auth.js', 'openapi.org/api?token=a']
          })
        );
        assert.equal(truncatedRes.ready, false);
        assert.equal(truncatedRes.reasonCode, 'evidence_access_failure');
        assert.ok(truncatedRes.missingDependencies.includes('openapi.org/api?token=a..b'));

        const exactRes = evaluateToolFreeEvidenceReadiness(
          makeReadinessParams({
            errorClass,
            topic: dotTopic,
            coveredSources: ['src/auth.js', 'openapi.org/api?token=a..b']
          })
        );
        assert.equal(exactRes.ready, true);
      }

      for (const phase of ['R1_DELIBERATION', 'R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING']) {
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          const isR1 = phase === 'R1_DELIBERATION';
          const wrongRun = await runPhaseEngineCase({
            phase,
            errorClass,
            topic: isR1 ? dotTopic : 'Inspect src/auth.js.',
            s1Proof: isR1
              ? null
              : {
                  scope: 'Token range',
                  kind: 'citation',
                  source: 'src/auth.js',
                  statement: 'Verified `openapi.org/api?token=a..b` in src/auth.js.'
                },
            coveredSources: ['src/auth.js', 'openapi.org/api?token=a']
          });
          assert.equal(
            wrongRun.targetCalls.length,
            1,
            `Finding 1: ${phase}/${errorClass} must refuse tool-free retry when covered with truncated openapi.org/api?token=a`
          );

          const exactRun = await runPhaseEngineCase({
            phase,
            errorClass,
            topic: isR1 ? dotTopic : 'Inspect src/auth.js.',
            s1Proof: isR1
              ? null
              : {
                  scope: 'Token range',
                  kind: 'citation',
                  source: 'src/auth.js',
                  statement: 'Verified `openapi.org/api?token=a..b` in src/auth.js.'
                },
            coveredSources: ['src/auth.js', 'openapi.org/api?token=a..b']
          });
          assert.equal(
            exactRun.targetCalls.length,
            2,
            `Finding 1: ${phase}/${errorClass} must permit tool-free retry with exact openapi.org/api?token=a..b`
          );
          assert.equal(exactRun.targetCalls[0].tools, 'read-only');
          assert.equal(exactRun.targetCalls[0].cwd, '/repo');
          assert.equal(exactRun.targetCalls[1].tools, 'none');
          assert.equal(exactRun.targetCalls[1].cwd, undefined);
        }
      }

      // 2. Finding 2 (Important): Structured proof.source & clarification.source preserve literal punctuation.
      const structuredSourceCases = [
        { literal: 'openapi.org/api*!', stripped: 'openapi.org/api*' },
        { literal: 'openapi.org/api*.', stripped: 'openapi.org/api*' },
        { literal: 'openapi.org:443/api*!', stripped: 'openapi.org:443/api*' },
        { literal: 'https://example.com/api!', stripped: 'https://example.com/api' },
        { literal: 'https://en.wikipedia.org/wiki/URI_(general)', stripped: 'https://en.wikipedia.org/wiki/URI_(general' },
        { literal: 'openapi.org/v1/item(1)', stripped: 'openapi.org/v1/item(1' }
      ];

      assert.deepEqual(
        extractVerificationDependencies([], { structuredSources: ['openapi.org/api*!', 'openapi.org/api*.'] }),
        {
          workspaceFileDeps: [],
          workspaceBroadDeps: [],
          externalDeps: ['openapi.org/api*!', 'openapi.org/api*.']
        }
      );
      assert.deepEqual(extractVerificationDependencies(['openapi.org/api*!']), {
        workspaceFileDeps: [],
        workspaceBroadDeps: [],
        externalDeps: ['openapi.org/api*!']
      });

      for (const { literal, stripped } of structuredSourceCases) {
        const makeProof = (kind = 'citation') => ({
          id: 'P1',
          round: 1,
          seatId: 's1',
          status: 'admitted',
          kind,
          source: literal,
          statement: 'Contract check'
        });

        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          const r1Wrong = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'DELIBERATION',
              round: 1,
              errorClass,
              topic: 'Inspect src/auth.js.',
              clarifications: [{ label: 'Spec', source: literal, text: 'Reference source' }],
              coveredSources: ['src/auth.js', stripped]
            })
          );
          assert.equal(r1Wrong.ready, false, `R1 clarification structured source ${literal} must refuse stripped ${stripped}`);
          assert.ok(r1Wrong.missingDependencies.includes(literal));

          const r1Right = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'DELIBERATION',
              round: 1,
              errorClass,
              topic: 'Inspect src/auth.js.',
              clarifications: [{ label: 'Spec', source: literal, text: 'Reference source' }],
              coveredSources: ['src/auth.js', literal]
            })
          );
          assert.equal(r1Right.ready, true, `R1 clarification structured source ${literal} must allow exact coverage`);

          const judgeWrong = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'JUDGE_AUDIT_SYNTHESIS',
              round: 1,
              errorClass,
              topic: 'Inspect src/auth.js.',
              proofs: [makeProof('citation')],
              coveredSources: ['src/auth.js', stripped]
            })
          );
          assert.equal(judgeWrong.ready, false, `JUDGE structured proof.source ${literal} must refuse stripped ${stripped}`);

          const benchWrong = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'JUDGE_AUDIT_SYNTHESIS',
              round: 1,
              errorClass,
              topic: 'Inspect src/auth.js.',
              proofs: [makeProof('benchmark')],
              coveredSources: ['src/auth.js', stripped]
            })
          );
          assert.equal(benchWrong.ready, false, `JUDGE benchmark structured source ${literal} must refuse stripped ${stripped}`);
          assert.ok(!benchWrong.missingDependencies.includes(stripped));

          const judgeRight = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'JUDGE_AUDIT_SYNTHESIS',
              round: 1,
              errorClass,
              topic: 'Inspect src/auth.js.',
              proofs: [makeProof('benchmark')],
              coveredSources: ['src/auth.js', literal]
            })
          );
          assert.equal(judgeRight.ready, true, `JUDGE benchmark structured source ${literal} must allow exact coverage`);

          const voteWrong = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'VOTING',
              round: 1,
              errorClass,
              topic: 'Inspect src/auth.js.',
              candidate: { summary: 'Candidate', clauses: [{ id: 'C1', context: 'c', conclusion: 'k', citedProofIds: ['P1'] }] },
              admittedProofs: [makeProof('citation')],
              coveredSources: ['src/auth.js', stripped]
            })
          );
          assert.equal(voteWrong.ready, false, `VOTING structured source ${literal} must refuse stripped ${stripped}`);

          const voteRight = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'VOTING',
              round: 1,
              errorClass,
              topic: 'Inspect src/auth.js.',
              candidate: { summary: 'Candidate', clauses: [{ id: 'C1', context: 'c', conclusion: 'k', citedProofIds: ['P1'] }] },
              admittedProofs: [makeProof('citation')],
              coveredSources: ['src/auth.js', literal]
            })
          );
          assert.equal(voteRight.ready, true, `VOTING structured source ${literal} must allow exact coverage`);
        }
      }

      for (const phase of ['R1_DELIBERATION', 'R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING']) {
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          const isR1 = phase === 'R1_DELIBERATION';
          const wrongRun = await runPhaseEngineCase({
            phase,
            errorClass,
            topic: 'Inspect src/auth.js.',
            clarifications: isR1 ? [{ label: 'Spec', source: 'openapi.org/api*!', text: 'Endpoint contract' }] : [],
            s1Proof: isR1
              ? null
              : {
                  scope: 'Endpoint',
                  kind: 'citation',
                  source: 'openapi.org/api*!',
                  statement: 'Contract checked for src/auth.js'
                },
            coveredSources: ['src/auth.js', 'openapi.org/api*']
          });
          assert.equal(
            wrongRun.targetCalls.length,
            1,
            `Finding 2: ${phase}/${errorClass} must refuse stripped openapi.org/api* for literal openapi.org/api*!`
          );

          const exactRun = await runPhaseEngineCase({
            phase,
            errorClass,
            topic: 'Inspect src/auth.js.',
            clarifications: isR1 ? [{ label: 'Spec', source: 'openapi.org/api*!', text: 'Endpoint contract' }] : [],
            s1Proof: isR1
              ? null
              : {
                  scope: 'Endpoint',
                  kind: 'citation',
                  source: 'openapi.org/api*!',
                  statement: 'Contract checked for src/auth.js'
                },
            coveredSources: ['src/auth.js', 'openapi.org/api*!']
          });
          assert.equal(
            exactRun.targetCalls.length,
            2,
            `Finding 2: ${phase}/${errorClass} must permit exact openapi.org/api*!`
          );
          assert.equal(exactRun.targetCalls[0].tools, 'read-only');
          assert.equal(exactRun.targetCalls[0].cwd, '/repo');
          assert.equal(exactRun.targetCalls[1].tools, 'none');
          assert.equal(exactRun.targetCalls[1].cwd, undefined);
        }
      }

      // 3. Finding 3 (Minor): Port-qualified wildcard/path bare endpoints classify as externalDeps, never workspaceBroadDeps.
      for (const endpoint of ['openapi.org:443/api*', 'example.com:8080/v1*', 'openapi.org:9/api*']) {
        assert.deepEqual(extractVerificationDependencies([`Inspect src/auth.js and ${endpoint}.`]), {
          workspaceFileDeps: [{ source: 'src/auth.js', unbounded: true }],
          workspaceBroadDeps: [],
          externalDeps: [endpoint]
        });
      }
      assert.deepEqual(extractVerificationDependencies(['Check ./openapi.org:443/api* and example.dev:1-20.']), {
        workspaceFileDeps: [{ source: 'example.dev', startLine: 1, endLine: 20 }],
        workspaceBroadDeps: ['openapi.org:443/api*'],
        externalDeps: []
      });

      const portTopic = 'Inspect src/auth.js and openapi.org:443/api*.';
      for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
        const portlessDenied = evaluateToolFreeEvidenceReadiness(
          makeReadinessParams({
            errorClass,
            topic: portTopic,
            coveredSources: ['src/auth.js', 'openapi.org/api*']
          })
        );
        assert.equal(portlessDenied.ready, false);
        assert.ok(portlessDenied.missingDependencies.includes('openapi.org:443/api*'));

        const exactAllowed = evaluateToolFreeEvidenceReadiness(
          makeReadinessParams({
            errorClass,
            topic: portTopic,
            coveredSources: ['src/auth.js', 'OPENAPI.ORG:443/api*']
          })
        );
        assert.equal(exactAllowed.ready, true);
      }

      for (const phase of ['R1_DELIBERATION', 'R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING']) {
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          const isR1 = phase === 'R1_DELIBERATION';
          const wrongRun = await runPhaseEngineCase({
            phase,
            errorClass,
            topic: isR1 ? portTopic : 'Inspect src/auth.js.',
            s1Proof: isR1
              ? null
              : {
                  scope: 'Port endpoint',
                  kind: 'citation',
                  source: 'src/auth.js',
                  statement: 'Checked openapi.org:443/api* against src/auth.js.'
                },
            coveredSources: ['src/auth.js', 'openapi.org/api*']
          });
          assert.equal(
            wrongRun.targetCalls.length,
            1,
            `Finding 3: ${phase}/${errorClass} must refuse portless openapi.org/api*`
          );

          const exactRun = await runPhaseEngineCase({
            phase,
            errorClass,
            topic: isR1 ? portTopic : 'Inspect src/auth.js.',
            s1Proof: isR1
              ? null
              : {
                  scope: 'Port endpoint',
                  kind: 'citation',
                  source: 'src/auth.js',
                  statement: 'Checked openapi.org:443/api* against src/auth.js.'
                },
            coveredSources: ['src/auth.js', 'openapi.org:443/api*']
          });
          assert.equal(
            exactRun.targetCalls.length,
            2,
            `Finding 3: ${phase}/${errorClass} must permit exact openapi.org:443/api*`
          );
          assert.equal(exactRun.targetCalls[0].tools, 'read-only');
          assert.equal(exactRun.targetCalls[0].cwd, '/repo');
          assert.equal(exactRun.targetCalls[1].tools, 'none');
          assert.equal(exactRun.targetCalls[1].cwd, undefined);
        }
      }
    });

    it('ReReview-102 Round 6 fixes: preserves backticked check command vetoes, parenthesized/delimited URLs and endpoints in prose, and CouncilConfig selfContainedInput types', async () => {
      function makeReadinessParams({
        phase = 'DELIBERATION',
        round = 1,
        errorClass = 'TimeoutError',
        topic = 'Inspect src/auth.js.',
        clarifications = [],
        proofs = [],
        priorProofs = [],
        candidate = null,
        previousCandidate = null,
        openObjections = [],
        admittedProofs = [],
        coveredSources = ['src/auth.js'],
        effectiveCwd = '/repo'
      }) {
        return {
          phase,
          round,
          errorClass,
          topic,
          clarifications,
          proofs,
          priorProofs,
          candidate,
          previousCandidate,
          openObjections,
          admittedProofs,
          evidence: coveredSources.map((source, i) => ({
            id: `E${i + 1}`,
            source,
            text: `complete snapshot for ${source}`
          })),
          selfContainedInput: {
            phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
            roundScope: 'all_rounds',
            coveredArtifacts: coveredSources.map((source, i) => ({
              source,
              evidenceId: `E${i + 1}`,
              coverage: 'complete_artifact'
            }))
          },
          originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd }
        };
      }

      async function runPhaseEngineCase({
        phase,
        errorClass,
        topic = 'Inspect src/auth.js.',
        clarifications = [],
        s1Proof = null,
        coveredSources = []
      }) {
        const mock = new MockAdapter();
        const targetCalls = [];
        const origProof = mock.executeSeatProof.bind(mock);
        const origJudge = mock.executeJudgeAuditAndSynthesis.bind(mock);
        const origVote = mock.executeSeatVote.bind(mock);

        const makeFault = (participantId) =>
          errorClass === 'TimeoutError'
            ? new TimeoutError(`${phase} timeout`, { timeoutMs: 1000, harness: 'codex', seatId: participantId })
            : new HeadlessToolDeniedError(`${phase} tool denied`, {
                harness: 'codex',
                seatId: participantId,
                exitCode: 0,
                isRetryable: true
              });

        mock.executeSeatProof = async (ctx) => {
          if (phase === 'R1_DELIBERATION' && ctx.round === 1 && ctx.seat.id === 's1') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s1');
            }
          }
          if (phase === 'R2_DELIBERATION' && ctx.round === 2 && ctx.seat.id === 's2') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s2');
            }
          }
          if (ctx.round === 1 && ctx.seat.id === 's1' && s1Proof) {
            return s1Proof;
          }
          return origProof(ctx);
        };

        mock.executeJudgeAuditAndSynthesis = async (ctx) => {
          if (phase === 'JUDGE_AUDIT_SYNTHESIS' && ctx.round === 1) {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('judge');
            }
          }
          return origJudge(ctx);
        };

        mock.executeSeatVote = async (ctx) => {
          if (phase === 'VOTING' && ctx.round === 1 && ctx.seat.id === 's1') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s1');
            }
          }
          if (phase === 'R2_DELIBERATION' && ctx.round === 1 && ctx.seat.id === 's2') {
            return { vote: 'object', proofId: 'P1', reason: 'Dispute R1 proof in R2' };
          }
          return origVote(ctx);
        };

        const engine = new CouncilEngine(
          {
            topic,
            clarifications,
            maxClarificationBatches: clarifications.length,
            minQuorum: 2,
            maxRounds: phase === 'R2_DELIBERATION' ? 2 : 1,
            maxRetriesPerSeat: 1,
            maxRetriesPerJudge: 1,
            cwd: '/repo',
            evidence: coveredSources.map((source, i) => ({
              id: `E${i + 1}`,
              label: `Artifact ${i + 1}`,
              source,
              text: `complete snapshot for ${source}`
            })),
            selfContainedInput: {
              kind: 'full_context',
              label: 'Phase matrix check',
              phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
              roundScope: 'all_rounds',
              coveredArtifacts: coveredSources.map((source, i) => ({
                source,
                evidenceId: `E${i + 1}`,
                coverage: 'complete_artifact'
              }))
            },
            judge: { id: 'judge', harness: 'codex', model: 'gpt-6-astra (high)', tools: 'read-only', cwd: '/repo' },
            seats: [
              {
                id: 's1',
                harness: 'codex',
                model: 'gpt-6-astra (high)',
                soul: 'S1',
                tools: 'read-only',
                votingTools: 'read-only',
                cwd: '/repo'
              },
              { id: 's2', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S2', tools: 'read-only', cwd: '/repo' },
              { id: 's3', harness: 'cursor', model: 'grok-4', soul: 'S3', tools: 'none' }
            ]
          },
          { harnessResolver: () => mock }
        );

        await engine.run();
        return { engine, targetCalls };
      }

      // 1. Finding 1 (Important): Structured kind:'check' command sources (including backticked/quoted) preserve veto.
      for (const cmdSource of ['`ls`', '`cat README`', '`cat src/auth.js`', '`uname -a`', '"pytest"']) {
        const checkProof = {
          id: 'P1',
          round: 1,
          seatId: 's1',
          status: 'admitted',
          scope: 'Command check',
          kind: 'check',
          source: cmdSource,
          statement: 'Observed expected directory listing'
        };

        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          const r2Res = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'DELIBERATION',
              round: 2,
              errorClass,
              topic: 'Inspect src/auth.js.',
              priorProofs: [checkProof],
              previousCandidate: {
                summary: 'Summary',
                clauses: [{ id: 'C1', context: 'c', conclusion: 'k', citedProofIds: ['P1'] }]
              },
              openObjections: [{ id: 'O1', proofId: 'P1', reason: 'Re-check claim' }],
              coveredSources: ['src/auth.js']
            })
          );
          assert.equal(r2Res.ready, false, `R2 DELIBERATION must refuse check source ${cmdSource} (${errorClass})`);
          assert.equal(r2Res.reasonCode, 'evidence_access_failure');

          const judgeRes = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'JUDGE_AUDIT_SYNTHESIS',
              round: 1,
              errorClass,
              topic: 'Inspect src/auth.js.',
              proofs: [checkProof],
              coveredSources: ['src/auth.js']
            })
          );
          assert.equal(judgeRes.ready, false, `JUDGE must refuse check source ${cmdSource} (${errorClass})`);

          const voteRes = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'VOTING',
              round: 1,
              errorClass,
              topic: 'Inspect src/auth.js.',
              candidate: {
                summary: 'Summary',
                clauses: [{ id: 'C1', context: 'c', conclusion: 'k', citedProofIds: ['P1'] }]
              },
              admittedProofs: [checkProof],
              coveredSources: ['src/auth.js']
            })
          );
          assert.equal(voteRes.ready, false, `VOTING must refuse check source ${cmdSource} (${errorClass})`);
        }
      }

      for (const cmdSource of ['`ls`', '`cat README`']) {
        for (const phase of ['R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING']) {
          for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
            const run = await runPhaseEngineCase({
              phase,
              errorClass,
              topic: 'Inspect src/auth.js.',
              s1Proof: {
                scope: 'Directory check',
                kind: 'check',
                source: cmdSource,
                statement: 'Checked workspace files'
              },
              coveredSources: ['src/auth.js']
            });
            assert.equal(
              run.targetCalls.length,
              1,
              `Finding 1: ${phase}/${errorClass} must refuse tool-free retry for check source ${cmdSource}`
            );
          }
        }
      }

      // Single backticked concrete file source still resolves as file dep and permits when covered.
      const backtickFileProof = {
        id: 'P1',
        round: 1,
        seatId: 's1',
        status: 'admitted',
        scope: 'Auth file',
        kind: 'check',
        source: '`src/auth.js`',
        statement: 'Verified invariants'
      };
      assert.equal(
        evaluateToolFreeEvidenceReadiness(
          makeReadinessParams({
            phase: 'JUDGE_AUDIT_SYNTHESIS',
            round: 1,
            errorClass: 'HeadlessToolDeniedError',
            topic: 'Inspect src/auth.js.',
            proofs: [backtickFileProof],
            coveredSources: ['src/auth.js']
          })
        ).ready,
        true
      );
      assert.equal(
        evaluateToolFreeEvidenceReadiness(
          makeReadinessParams({
            phase: 'JUDGE_AUDIT_SYNTHESIS',
            round: 1,
            errorClass: 'HeadlessToolDeniedError',
            topic: 'Inspect other/file.js.',
            proofs: [backtickFileProof],
            coveredSources: ['other/file.js']
          })
        ).ready,
        false
      );

      // 2. Finding 2 (Important): Parenthesized & bracketed URLs and bare endpoints stay intact in prose fields.
      const bareParen = 'openapi.org/v1/item(1)';
      const urlParen = 'https://en.wikipedia.org/wiki/URI_(general)';
      const bareBracket = 'openapi.org/v1/items?filter[id]=1';

      for (const sample of [
        `Inspect src/auth.js and \`${bareParen}\`.`,
        `Inspect src/auth.js and "${bareParen}".`,
        `Inspect src/auth.js and '${bareParen}'.`,
        `Inspect src/auth.js and <${bareParen}>.`,
        `Inspect src/auth.js and (${bareParen}).`,
        `Inspect src/auth.js and [${bareParen}].`,
        `Inspect src/auth.js (see ${bareParen}).`,
        `Inspect src/auth.js and ${bareParen}.`
      ]) {
        assert.deepEqual(
          extractVerificationDependencies([sample]),
          {
            workspaceFileDeps: [{ source: 'src/auth.js', unbounded: true }],
            workspaceBroadDeps: [],
            externalDeps: [bareParen]
          },
          `Expected intact ${bareParen} from: ${sample}`
        );
      }

      for (const sample of [
        `Inspect src/auth.js and \`${urlParen}\`.`,
        `Inspect src/auth.js and "${urlParen}".`,
        `Inspect src/auth.js and '${urlParen}'.`,
        `Inspect src/auth.js and <${urlParen}>.`,
        `Inspect src/auth.js and [${urlParen}].`,
        `Inspect src/auth.js ([URI](${urlParen})).`,
        `Inspect src/auth.js (see ${urlParen}).`,
        `Inspect src/auth.js and ${urlParen}.`
      ]) {
        assert.deepEqual(
          extractVerificationDependencies([sample]),
          {
            workspaceFileDeps: [{ source: 'src/auth.js', unbounded: true }],
            workspaceBroadDeps: [],
            externalDeps: [urlParen]
          },
          `Expected intact ${urlParen} from: ${sample}`
        );
      }

      assert.deepEqual(extractVerificationDependencies([`Inspect src/auth.js and \`${bareBracket}\`.`]), {
        workspaceFileDeps: [{ source: 'src/auth.js', unbounded: true }],
        workspaceBroadDeps: [],
        externalDeps: [bareBracket]
      });

      const proseCases = [
        { literal: bareParen, truncated: 'openapi.org/v1/item' },
        { literal: urlParen, truncated: 'https://en.wikipedia.org/wiki/URI_' }
      ];
      for (const { literal, truncated } of proseCases) {
        const topic = `Inspect src/auth.js and \`${literal}\`.`;
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          const refused = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'DELIBERATION',
              round: 1,
              errorClass,
              topic,
              coveredSources: ['src/auth.js', truncated]
            })
          );
          assert.equal(refused.ready, false);
          assert.equal(refused.reasonCode, 'evidence_access_failure');
          assert.ok(refused.missingDependencies.includes(literal));

          const allowed = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'DELIBERATION',
              round: 1,
              errorClass,
              topic,
              coveredSources: ['src/auth.js', literal]
            })
          );
          assert.equal(allowed.ready, true);
        }

        for (const phase of ['R1_DELIBERATION', 'R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING']) {
          for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
            const isR1 = phase === 'R1_DELIBERATION';
            const wrongRun = await runPhaseEngineCase({
              phase,
              errorClass,
              topic: isR1 ? topic : 'Inspect src/auth.js.',
              s1Proof: isR1
                ? null
                : {
                    scope: 'Prose endpoint',
                    kind: 'citation',
                    source: 'src/auth.js',
                    statement: `Cross-checked \`${literal}\` with src/auth.js.`
                  },
              coveredSources: ['src/auth.js', truncated]
            });
            assert.equal(
              wrongRun.targetCalls.length,
              1,
              `Finding 2: ${phase}/${errorClass} must refuse truncated ${truncated} for ${literal}`
            );

            const exactRun = await runPhaseEngineCase({
              phase,
              errorClass,
              topic: isR1 ? topic : 'Inspect src/auth.js.',
              s1Proof: isR1
                ? null
                : {
                    scope: 'Prose endpoint',
                    kind: 'citation',
                    source: 'src/auth.js',
                    statement: `Cross-checked \`${literal}\` with src/auth.js.`
                  },
              coveredSources: ['src/auth.js', literal]
            });
            assert.equal(
              exactRun.targetCalls.length,
              2,
              `Finding 2: ${phase}/${errorClass} must permit exact ${literal}`
            );
            assert.equal(exactRun.targetCalls[0].tools, 'read-only');
            assert.equal(exactRun.targetCalls[0].cwd, '/repo');
            assert.equal(exactRun.targetCalls[1].tools, 'none');
            assert.equal(exactRun.targetCalls[1].cwd, undefined);
          }
        }
      }

      // 3. Finding 3 (Minor): src/types.js documents SelfContainedInputContract rather than boolean selfContainedInput.
      const typesSource = fs.readFileSync(path.resolve(process.cwd(), 'src/types.js'), 'utf8');
      assert.equal(typesSource.includes('@property {boolean} [selfContainedInput]'), false);
      assert.ok(typesSource.includes('@typedef {Object} SelfContainedInputContract'));
      assert.ok(typesSource.includes('@property {SelfContainedInputContract | null} [selfContainedInput]'));

      const boolValidation = validateConfig({
        topic: 'Test config validation',
        maxRounds: 1,
        minQuorum: 2,
        maxClarificationBatches: 0,
        maxRetriesPerSeat: 1,
        selfContainedInput: true
      });
      assert.equal(boolValidation.valid, false);
      assert.ok(boolValidation.errors.some((e) => e.includes('selfContainedInput must be a plain object or null')));

      const objectValidation = validateConfig({
        topic: 'Test config validation',
        maxRounds: 1,
        minQuorum: 2,
        maxClarificationBatches: 0,
        maxRetriesPerSeat: 1,
        selfContainedInput: {
          phases: ['DELIBERATION'],
          roundScope: 'all_rounds',
          conceptualNoExternalVerification: false,
          coveredArtifacts: [{ source: 'src/auth.js', evidenceId: 'E1', coverage: 'complete_artifact' }]
        }
      });
      assert.equal(objectValidation.valid, true);

      // 4. Adversarial 48KB linear regex timing checks (zero quadratic backtracking on repeated delimiters/parens)
      extractVerificationDependencies(['warmup src/auth.js https://example.com/a(1)']);
      for (const [label, payload] of [
        ['nested-parens-48k', '('.repeat(24000) + ')'.repeat(24000)],
        ['open-brackets-48k', '['.repeat(48000)],
        ['open-angles-48k', '<'.repeat(48000)],
        ['trailing-parens-url-48k', 'https://example.com/' + ')'.repeat(48000)]
      ]) {
        const t0 = performance.now();
        extractVerificationDependencies([payload]);
        const elapsedMs = performance.now() - t0;
        assert.ok(elapsedMs < 25, `Expected <25ms for ${label}, got ${elapsedMs.toFixed(2)}ms`);
      }
    });

    it('ReReview-102 Round 7 fix: preserves character-class, bracketed, brace, extglob, and wildcard workspace globs while keeping 48KB delimiter scans linear', async () => {
      // 1. Direct extractVerificationDependencies assertions across glob & non-glob shapes
      const expectedGlobCases = [
        ['Inspect src/auth.js and src/*[0-9].js', ['src/*[0-9].js']],
        ['Inspect src/auth.js and src/**/[ab].js', ['src/**/[ab].js']],
        ['Inspect src/auth.js and [a-z]*.js', ['[a-z]*.js']],
        ['Inspect src/auth.js and (src/*[0-9].js).', ['src/*[0-9].js']],
        ['Inspect src/auth.js and [src/**/[ab].js]!', ['src/**/[ab].js']],
        ['Inspect src/auth.js and `src/*[0-9].js`', ['src/*[0-9].js']],
        ['Inspect src/auth.js and src/@(a|b)/*.js', ['src/@(a|b)/*.js']],
        ['Inspect src/auth.js and src/*.{js,ts}', ['src/*.{js,ts}']],
        ['Inspect src/auth.js and src/[ab].js', ['src/[ab].js']],
        ['Inspect src/auth.js and src/{a,b}.js', ['src/{a,b}.js']],
        ['Inspect src/auth.js and src/auth?.js', ['src/auth?.js']],
        ['See [glob](src/*[0-9].js) and [file](src/auth.js)', ['src/*[0-9].js']],
        ['Inspect src/auth.js and src/*[[:digit:]].js', ['src/*[[:digit:]].js']]
      ];

      for (const [text, expectedBroad] of expectedGlobCases) {
        assert.deepEqual(
          extractVerificationDependencies([text]),
          {
            workspaceFileDeps: [{ source: 'src/auth.js', unbounded: true }],
            workspaceBroadDeps: expectedBroad,
            externalDeps: []
          },
          `Expected broad workspace deps ${JSON.stringify(expectedBroad)} for: ${text}`
        );
      }

      // Non-glob prose/citations/brackets must NOT trigger false-positive broad workspace deps
      assert.deepEqual(
        extractVerificationDependencies([
          'Verify **[E1]** and *(note)* and [E1]/[E2] and seats[0].key in src/auth.js?'
        ]),
        {
          workspaceFileDeps: [{ source: 'src/auth.js', unbounded: true }],
          workspaceBroadDeps: [],
          externalDeps: []
        }
      );

      // 2. Readiness & full mocked CouncilEngine refusal matrix across all 4 phases x both error classes
      const globTopics = [
        { token: 'src/*[0-9].js', expectedBroad: 'src/*[0-9].js' },
        { token: 'src/**/[ab].js', expectedBroad: 'src/**/[ab].js' },
        { token: '`src/*[0-9].js`', expectedBroad: 'src/*[0-9].js' },
        { token: '(src/**/[ab].js).', expectedBroad: 'src/**/[ab].js' },
        { token: 'src/[ab].js', expectedBroad: 'src/[ab].js' }
      ];

      function buildReadinessParams(topic, errorClass, coveredSources) {
        return {
          phase: 'DELIBERATION',
          round: 1,
          errorClass,
          topic,
          evidence: coveredSources.map((source, i) => ({
            id: `E${i + 1}`,
            source,
            text: `complete snapshot for ${source}`
          })),
          selfContainedInput: {
            phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
            roundScope: 'all_rounds',
            coveredArtifacts: coveredSources.map((source, i) => ({
              source,
              evidenceId: `E${i + 1}`,
              coverage: 'complete_artifact'
            }))
          },
          originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo' }
        };
      }

      async function runGlobPhaseEngineCase({ phase, errorClass, topic, coveredSources }) {
        const mock = new MockAdapter();
        const targetCalls = [];
        const origProof = mock.executeSeatProof.bind(mock);
        const origJudge = mock.executeJudgeAuditAndSynthesis.bind(mock);
        const origVote = mock.executeSeatVote.bind(mock);

        const makeFault = (participantId) =>
          errorClass === 'TimeoutError'
            ? new TimeoutError(`${phase} timeout`, { timeoutMs: 1000, harness: 'codex', seatId: participantId })
            : new HeadlessToolDeniedError(`${phase} tool denied`, {
                harness: 'codex',
                seatId: participantId,
                exitCode: 0,
                isRetryable: true
              });

        mock.executeSeatProof = async (ctx) => {
          if (phase === 'R1_DELIBERATION' && ctx.round === 1 && ctx.seat.id === 's1') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s1');
            }
          }
          if (phase === 'R2_DELIBERATION' && ctx.round === 2 && ctx.seat.id === 's2') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s2');
            }
          }
          return origProof(ctx);
        };

        mock.executeJudgeAuditAndSynthesis = async (ctx) => {
          if (phase === 'JUDGE_AUDIT_SYNTHESIS' && ctx.round === 1) {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('judge');
            }
          }
          return origJudge(ctx);
        };

        mock.executeSeatVote = async (ctx) => {
          if (phase === 'VOTING' && ctx.round === 1 && ctx.seat.id === 's1') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s1');
            }
          }
          if (phase === 'R2_DELIBERATION' && ctx.round === 1 && ctx.seat.id === 's2') {
            return { vote: 'object', proofId: 'P1', reason: 'Dispute R1 proof in R2' };
          }
          return origVote(ctx);
        };

        const engine = new CouncilEngine(
          {
            topic,
            clarifications: [],
            maxClarificationBatches: 0,
            minQuorum: 2,
            maxRounds: phase === 'R2_DELIBERATION' ? 2 : 1,
            maxRetriesPerSeat: 1,
            maxRetriesPerJudge: 1,
            cwd: '/repo',
            evidence: coveredSources.map((source, i) => ({
              id: `E${i + 1}`,
              label: `Artifact ${i + 1}`,
              source,
              text: `complete snapshot for ${source}`
            })),
            selfContainedInput: {
              kind: 'full_context',
              label: 'Glob matrix check',
              phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
              roundScope: 'all_rounds',
              coveredArtifacts: coveredSources.map((source, i) => ({
                source,
                evidenceId: `E${i + 1}`,
                coverage: 'complete_artifact'
              }))
            },
            judge: { id: 'judge', harness: 'codex', model: 'gpt-6-astra (high)', tools: 'read-only', cwd: '/repo' },
            seats: [
              {
                id: 's1',
                harness: 'codex',
                model: 'gpt-6-astra (high)',
                soul: 'S1',
                tools: 'read-only',
                votingTools: 'read-only',
                cwd: '/repo'
              },
              { id: 's2', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S2', tools: 'read-only', cwd: '/repo' },
              { id: 's3', harness: 'cursor', model: 'grok-4', soul: 'S3', tools: 'none' }
            ]
          },
          { harnessResolver: () => mock }
        );

        await engine.run();
        return { engine, targetCalls };
      }

      for (const { token, expectedBroad } of globTopics) {
        const topic = `Inspect src/auth.js and ${token}`;
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          const verdict = evaluateToolFreeEvidenceReadiness(
            buildReadinessParams(topic, errorClass, ['src/auth.js'])
          );
          assert.equal(verdict.ready, false, `Readiness must refuse ${token} under ${errorClass}`);
          assert.equal(verdict.reasonCode, 'evidence_access_failure');
          assert.ok(
            verdict.missingDependencies.includes(expectedBroad),
            `Expected missingDependencies to include ${expectedBroad}, got ${JSON.stringify(verdict.missingDependencies)}`
          );

          for (const phase of ['R1_DELIBERATION', 'R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING']) {
            const run = await runGlobPhaseEngineCase({
              phase,
              errorClass,
              topic,
              coveredSources: ['src/auth.js']
            });
            assert.equal(
              run.targetCalls.length,
              1,
              `${phase}/${errorClass} must refuse tool-free retry for uncovered glob ${token}`
            );
            assert.equal(run.targetCalls[0].tools, 'read-only');
            assert.equal(run.targetCalls[0].cwd, '/repo');
          }
        }
      }

      // 3. Adversarial 48KB linear-time delimiter & glob probes (< 25ms)
      extractVerificationDependencies(['warmup src/*[0-9].js src/**/[ab].js']);
      for (const [label, payload, expectedBroad] of [
        ['nested-parens-48k', '('.repeat(24000) + ')'.repeat(24000), []],
        ['wrapped-glob-48k', '('.repeat(24000) + 'src/*[0-9].js' + ')'.repeat(24000), ['src/*[0-9].js']],
        ['open-brackets-glob-48k', '['.repeat(48000) + 'src/*[0-9].js', ['src/*[0-9].js']],
        ['unclosed-brace-commas-48k', '{' + 'a,'.repeat(24000) + '/b.js', null],
        ['repeated-questions-48k', '?'.repeat(48000) + 'a/b.js', null]
      ]) {
        const t0 = performance.now();
        const deps = extractVerificationDependencies([payload]);
        const elapsedMs = performance.now() - t0;
        assert.ok(elapsedMs < 25, `Expected <25ms for ${label}, got ${elapsedMs.toFixed(2)}ms`);
        if (expectedBroad !== null) {
          assert.deepEqual(deps.workspaceBroadDeps, expectedBroad, `Unexpected broad deps for ${label}`);
        }
      }
    });

    it('ReReview-102 Round 8 fixes: enforces directory-extglob vetoes, preserves unquoted bracketed query endpoints, and blocks quoted/POSIX check commands', async () => {
      function makeReadinessParams({
        phase = 'DELIBERATION',
        round = 1,
        errorClass,
        topic = 'Inspect src/auth.js.',
        coveredSources = ['src/auth.js'],
        clarifications = [],
        proofs = [],
        priorProofs = [],
        previousCandidate = undefined,
        openObjections = [],
        candidate = undefined,
        admittedProofs = []
      }) {
        return {
          phase,
          round,
          errorClass,
          topic,
          clarifications,
          proofs,
          priorProofs,
          previousCandidate,
          openObjections,
          candidate,
          admittedProofs,
          evidence: coveredSources.map((source, i) => ({
            id: `E${i + 1}`,
            source,
            text: `complete snapshot for ${source}`
          })),
          selfContainedInput: {
            phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
            roundScope: 'all_rounds',
            coveredArtifacts: coveredSources.map((source, i) => ({
              source,
              evidenceId: `E${i + 1}`,
              coverage: 'complete_artifact'
            }))
          },
          originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo' }
        };
      }

      async function runPhaseEngineCase({
        phase,
        errorClass,
        topic,
        clarifications = [],
        s1Proof = null,
        coveredSources = ['src/auth.js']
      }) {
        const mock = new MockAdapter();
        const targetCalls = [];
        const origProof = mock.executeSeatProof.bind(mock);
        const origJudge = mock.executeJudgeAuditAndSynthesis.bind(mock);
        const origVote = mock.executeSeatVote.bind(mock);

        const makeFault = (participantId) =>
          errorClass === 'TimeoutError'
            ? new TimeoutError(`${phase} timeout`, { timeoutMs: 1000, harness: 'codex', seatId: participantId })
            : new HeadlessToolDeniedError(`${phase} tool denied`, {
                harness: 'codex',
                seatId: participantId,
                exitCode: 0,
                isRetryable: true
              });

        mock.executeSeatProof = async (ctx) => {
          if (phase === 'R1_DELIBERATION' && ctx.round === 1 && ctx.seat.id === 's1') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s1');
            }
          }
          if (phase === 'R2_DELIBERATION' && ctx.round === 2 && ctx.seat.id === 's2') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s2');
            }
          }
          if (ctx.round === 1 && ctx.seat.id === 's1' && s1Proof) {
            return s1Proof;
          }
          return origProof(ctx);
        };

        mock.executeJudgeAuditAndSynthesis = async (ctx) => {
          if (phase === 'JUDGE_AUDIT_SYNTHESIS' && ctx.round === 1) {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('judge');
            }
          }
          return origJudge(ctx);
        };

        mock.executeSeatVote = async (ctx) => {
          if (phase === 'VOTING' && ctx.round === 1 && ctx.seat.id === 's1') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s1');
            }
          }
          if (phase === 'R2_DELIBERATION' && ctx.round === 1 && ctx.seat.id === 's2') {
            return { vote: 'object', proofId: 'P1', reason: 'Dispute R1 proof in R2' };
          }
          return origVote(ctx);
        };

        const engine = new CouncilEngine(
          {
            topic,
            clarifications,
            maxClarificationBatches: clarifications.length,
            minQuorum: 2,
            maxRounds: phase === 'R2_DELIBERATION' ? 2 : 1,
            maxRetriesPerSeat: 1,
            maxRetriesPerJudge: 1,
            cwd: '/repo',
            evidence: coveredSources.map((source, i) => ({
              id: `E${i + 1}`,
              label: `Artifact ${i + 1}`,
              source,
              text: `complete snapshot for ${source}`
            })),
            selfContainedInput: {
              kind: 'full_context',
              label: 'Round 8 regression matrix',
              phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
              roundScope: 'all_rounds',
              coveredArtifacts: coveredSources.map((source, i) => ({
                source,
                evidenceId: `E${i + 1}`,
                coverage: 'complete_artifact'
              }))
            },
            judge: { id: 'judge', harness: 'codex', model: 'gpt-6-astra (high)', tools: 'read-only', cwd: '/repo' },
            seats: [
              {
                id: 's1',
                harness: 'codex',
                model: 'gpt-6-astra (high)',
                soul: 'S1',
                tools: 'read-only',
                votingTools: 'read-only',
                cwd: '/repo'
              },
              { id: 's2', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S2', tools: 'read-only', cwd: '/repo' },
              { id: 's3', harness: 'cursor', model: 'grok-4', soul: 'S3', tools: 'none' }
            ]
          },
          { harnessResolver: () => mock }
        );

        await engine.run();
        return { engine, targetCalls };
      }

      // 1. Finding 1: non-* glob directories & extensionless braced/extglob workspace paths
      const globDirAndExtCases = [
        ['Inspect src/auth.js and src/!(a|b)/', ['src/!(a|b)/']],
        ['Inspect src/auth.js and (src/!(a|b)/).', ['src/!(a|b)/']],
        ['Inspect src/auth.js and src/@(a|b)/', ['src/@(a|b)/']],
        ['Inspect src/auth.js and src/[ab]/', ['src/[ab]/']],
        ['Inspect src/auth.js and src/{a,b}/', ['src/{a,b}/']],
        ['Inspect src/auth.js and src/foo?/', ['src/foo?/']],
        ['Inspect src/auth.js and !(a|b)/', ['!(a|b)/']],
        ['Inspect src/auth.js and foo/!(a|b)', ['foo/!(a|b)']],
        ['Inspect src/auth.js and foo/{a,b}', ['foo/{a,b}']]
      ];

      for (const [text, expectedBroad] of globDirAndExtCases) {
        assert.deepEqual(
          extractVerificationDependencies([text]),
          {
            workspaceFileDeps: [{ source: 'src/auth.js', unbounded: true }],
            workspaceBroadDeps: expectedBroad,
            externalDeps: []
          },
          `Finding 1: expected broad deps ${JSON.stringify(expectedBroad)} for: ${text}`
        );

        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          const verdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({ phase: 'DELIBERATION', round: 1, errorClass, topic: text, coveredSources: ['src/auth.js'] })
          );
          assert.equal(verdict.ready, false, `Finding 1: readiness must refuse ${text} under ${errorClass}`);
          assert.equal(verdict.reasonCode, 'evidence_access_failure');
          assert.ok(
            verdict.missingDependencies.includes(expectedBroad[0]),
            `Expected missingDependencies to include ${expectedBroad[0]}, got ${JSON.stringify(verdict.missingDependencies)}`
          );

          for (const phase of ['R1_DELIBERATION', 'R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING']) {
            const run = await runPhaseEngineCase({
              phase,
              errorClass,
              topic: text,
              coveredSources: ['src/auth.js']
            });
            assert.equal(run.targetCalls.length, 1, `Finding 1: ${phase}/${errorClass} must refuse ${text}`);
          }
        }
      }

      // Non-glob prose/citations control
      assert.deepEqual(
        extractVerificationDependencies([
          'Verify **[E1]** and *(note)* and [E1]/[E2] and seats[0].key in src/auth.js?'
        ]),
        {
          workspaceFileDeps: [{ source: 'src/auth.js', unbounded: true }],
          workspaceBroadDeps: [],
          externalDeps: []
        }
      );

      // 2. Finding 2: balanced bracketed query/path segments preserved in externalDeps
      const bracketEndpointCases = [
        {
          text: 'Inspect src/auth.js and openapi.org/v1/items?filter[id]=1',
          expectedExternal: ['openapi.org/v1/items?filter[id]=1']
        },
        {
          text: 'Inspect src/auth.js and openapi.org/v1/items?filter[id]=1.',
          expectedExternal: ['openapi.org/v1/items?filter[id]=1']
        },
        {
          text: 'Inspect src/auth.js and https://example.com/v1/items?filter[id]=1',
          expectedExternal: ['https://example.com/v1/items?filter[id]=1']
        },
        {
          text: 'Inspect src/auth.js and [openapi.org/v1/items?filter[id]=1].',
          expectedExternal: ['openapi.org/v1/items?filter[id]=1']
        },
        {
          text: 'Inspect src/auth.js and (openapi.org/v1/items?filter[id]=1).',
          expectedExternal: ['openapi.org/v1/items?filter[id]=1']
        },
        {
          text: 'Inspect src/auth.js and `openapi.org/v1/items?filter[id]=1`',
          expectedExternal: ['openapi.org/v1/items?filter[id]=1']
        },
        {
          text: 'Inspect src/auth.js and [https://example.com/v1/items?filter[id]=1].',
          expectedExternal: ['https://example.com/v1/items?filter[id]=1']
        },
        {
          text: 'Inspect src/auth.js and [example.com/api?token=abc!]',
          expectedExternal: ['example.com/api?token=abc!']
        },
        {
          text: 'Inspect src/auth.js and See [https://a.com/x?f[id]=1](https://b.com/y?g[id]=2).',
          expectedExternal: ['https://a.com/x?f[id]=1', 'https://b.com/y?g[id]=2']
        }
      ];

      for (const { text, expectedExternal } of bracketEndpointCases) {
        const deps = extractVerificationDependencies([text]);
        assert.deepEqual(
          deps.workspaceFileDeps,
          [{ source: 'src/auth.js', unbounded: true }],
          `Finding 2: unexpected file deps for: ${text}`
        );
        assert.deepEqual(deps.workspaceBroadDeps, [], `Finding 2: unexpected broad deps for: ${text}`);
        assert.deepEqual(
          new Set(deps.externalDeps),
          new Set(expectedExternal),
          `Finding 2: expected externalDeps ${JSON.stringify(expectedExternal)} for: ${text}`
        );
        assert.equal(deps.externalDeps.length, expectedExternal.length);
      }

      for (const { full, truncated, proseTopic } of [
        {
          full: 'openapi.org/v1/items?filter[id]=1',
          truncated: 'openapi.org/v1/items?filter',
          proseTopic: 'Inspect src/auth.js and openapi.org/v1/items?filter[id]=1.'
        },
        {
          full: 'https://example.com/v1/items?filter[id]=1',
          truncated: 'https://example.com/v1/items?filter',
          proseTopic: 'Inspect src/auth.js and https://example.com/v1/items?filter[id]=1.'
        }
      ]) {
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          const refusedReadiness = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'DELIBERATION',
              round: 1,
              errorClass,
              topic: proseTopic,
              coveredSources: ['src/auth.js', truncated]
            })
          );
          assert.equal(refusedReadiness.ready, false);
          assert.ok(refusedReadiness.missingDependencies.includes(full));

          const allowedReadiness = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'DELIBERATION',
              round: 1,
              errorClass,
              topic: proseTopic,
              coveredSources: ['src/auth.js', full]
            })
          );
          assert.equal(allowedReadiness.ready, true);

          for (const phase of ['R1_DELIBERATION', 'R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING']) {
            const refusedRun = await runPhaseEngineCase({
              phase,
              errorClass,
              topic: proseTopic,
              coveredSources: ['src/auth.js', truncated]
            });
            assert.equal(
              refusedRun.targetCalls.length,
              1,
              `Finding 2: ${phase}/${errorClass} must refuse truncated ${truncated} for ${full}`
            );

            const allowedRun = await runPhaseEngineCase({
              phase,
              errorClass,
              topic: proseTopic,
              coveredSources: ['src/auth.js', full]
            });
            assert.equal(
              allowedRun.targetCalls.length,
              2,
              `Finding 2: ${phase}/${errorClass} must permit exact ${full}`
            );
            assert.equal(allowedRun.targetCalls[1].tools, 'none');
            assert.equal(allowedRun.targetCalls[1].cwd, undefined);
          }
        }
      }

      // 3. Finding 3: kind:'check' quoted & POSIX command sources veto vs safe positive controls
      const checkCommandSources = [
        '"uname -a"',
        "'cat README'",
        '"cat src/auth.js"',
        "'ls'",
        'uname -a',
        'cat README',
        '"./scripts/verify.sh"'
      ];

      for (const source of checkCommandSources) {
        const makeCheckProof = () => ({
          id: 'P1',
          round: 1,
          seatId: 's1',
          status: 'admitted',
          scope: 'Environment check',
          kind: 'check',
          source,
          statement: 'Verified command execution'
        });

        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          const r2Verdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'DELIBERATION',
              round: 2,
              errorClass,
              priorProofs: [makeCheckProof()],
              previousCandidate: {
                summary: 'R1 candidate',
                clauses: [{ id: 'C1', context: 'c', conclusion: 'k', citedProofIds: ['P1'] }]
              },
              openObjections: [{ id: 'O1', seatId: 's2', targetProofId: 'P1', reason: 'Need check' }]
            })
          );
          assert.equal(r2Verdict.ready, false, `Finding 3: R2 readiness must refuse check source ${source}`);

          const judgeVerdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'JUDGE_AUDIT_SYNTHESIS',
              round: 1,
              errorClass,
              proofs: [makeCheckProof()]
            })
          );
          assert.equal(judgeVerdict.ready, false, `Finding 3: JUDGE readiness must refuse check source ${source}`);

          const voteVerdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'VOTING',
              round: 1,
              errorClass,
              candidate: {
                summary: 'Candidate',
                clauses: [{ id: 'C1', context: 'c', conclusion: 'k', citedProofIds: ['P1'] }]
              },
              admittedProofs: [makeCheckProof()]
            })
          );
          assert.equal(voteVerdict.ready, false, `Finding 3: VOTING readiness must refuse check source ${source}`);

          for (const phase of ['R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING']) {
            const refusedRun = await runPhaseEngineCase({
              phase,
              errorClass,
              topic: 'Inspect src/auth.js.',
              s1Proof: {
                scope: 'Environment check',
                kind: 'check',
                source,
                statement: 'Verified command execution'
              },
              coveredSources: ['src/auth.js']
            });
            assert.equal(
              refusedRun.targetCalls.length,
              1,
              `Finding 3: ${phase}/${errorClass} must refuse check source ${source}`
            );
          }
        }
      }

      const positiveCheckControls = [
        {
          source: '"src/auth.js"',
          statement: 'Proof synthesized according to soul: "S1".',
          coveredSources: ['src/auth.js']
        },
        {
          source: '"openapi.org/v1/items?filter[id]=1"',
          statement: 'Endpoint check verified.',
          coveredSources: ['src/auth.js', 'openapi.org/v1/items?filter[id]=1']
        },
        {
          source: 'Deterministic mock check verified by s1',
          statement: 'Proof synthesized according to soul: "S1".',
          coveredSources: ['src/auth.js']
        }
      ];

      for (const control of positiveCheckControls) {
        const makeControlProof = () => ({
          id: 'P1',
          round: 1,
          seatId: 's1',
          status: 'admitted',
          scope: 'Control check',
          kind: 'check',
          source: control.source,
          statement: control.statement
        });

        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          const judgeOk = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'JUDGE_AUDIT_SYNTHESIS',
              round: 1,
              errorClass,
              proofs: [makeControlProof()],
              coveredSources: control.coveredSources
            })
          );
          assert.equal(
            judgeOk.ready,
            true,
            `Positive control ${control.source} must remain ready under JUDGE/${errorClass}`
          );

          for (const phase of ['R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING']) {
            const okRun = await runPhaseEngineCase({
              phase,
              errorClass,
              topic: 'Inspect src/auth.js.',
              s1Proof: {
                scope: 'Control check',
                kind: 'check',
                source: control.source,
                statement: control.statement
              },
              coveredSources: control.coveredSources
            });
            assert.equal(
              okRun.targetCalls.length,
              2,
              `Positive control ${control.source} must permit tool-free retry in ${phase}/${errorClass}`
            );
          }
        }
      }

      // 4. 48KB linear-time regression probes for bracket endpoints
      extractVerificationDependencies(['warmup https://example.com/api?f[id]=1 openapi.org/v1?a[b]=c']);
      for (const [label, payload] of [
        ['https-open-brackets-48k', 'https://example.com/api?' + '['.repeat(48000)],
        ['https-close-brackets-48k', 'https://example.com/api?' + ']'.repeat(48000)],
        ['bare-open-bracket-pairs-48k', 'openapi.org/v1?' + '[a'.repeat(24000)],
        ['bare-balanced-brackets-48k', 'openapi.org/v1?' + '[a]'.repeat(16000)]
      ]) {
        const t0 = performance.now();
        extractVerificationDependencies([payload]);
        const elapsedMs = performance.now() - t0;
        assert.ok(elapsedMs < 25, `Expected <25ms for ${label}, got ${elapsedMs.toFixed(2)}ms`);
      }
    });

    it('ReReview-102 Round 9 fixes: enforces nested glob directories & extensionless char-class paths, and allows quoted relative files & quoted prose filenames in check proofs', async () => {
      function makeReadinessParams({
        phase = 'DELIBERATION',
        round = 1,
        errorClass,
        topic = 'Inspect src/auth.js.',
        coveredSources = ['src/auth.js'],
        clarifications = [],
        proofs = [],
        priorProofs = [],
        previousCandidate = undefined,
        openObjections = [],
        candidate = undefined,
        admittedProofs = []
      }) {
        return {
          phase,
          round,
          errorClass,
          topic,
          clarifications,
          proofs,
          priorProofs,
          previousCandidate,
          openObjections,
          candidate,
          admittedProofs,
          evidence: coveredSources.map((source, i) => ({
            id: `E${i + 1}`,
            source,
            text: `complete snapshot for ${source}`
          })),
          selfContainedInput: {
            phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
            roundScope: 'all_rounds',
            coveredArtifacts: coveredSources.map((source, i) => ({
              source,
              evidenceId: `E${i + 1}`,
              coverage: 'complete_artifact'
            }))
          },
          originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo' }
        };
      }

      async function runPhaseEngineCase({
        phase,
        errorClass,
        topic,
        clarifications = [],
        s1Proof = null,
        coveredSources = ['src/auth.js']
      }) {
        const mock = new MockAdapter();
        const targetCalls = [];
        const origProof = mock.executeSeatProof.bind(mock);
        const origJudge = mock.executeJudgeAuditAndSynthesis.bind(mock);
        const origVote = mock.executeSeatVote.bind(mock);

        const makeFault = (participantId) =>
          errorClass === 'TimeoutError'
            ? new TimeoutError(`${phase} timeout`, { timeoutMs: 1000, harness: 'codex', seatId: participantId })
            : new HeadlessToolDeniedError(`${phase} tool denied`, {
                harness: 'codex',
                seatId: participantId,
                exitCode: 0,
                isRetryable: true
              });

        mock.executeSeatProof = async (ctx) => {
          if (phase === 'R1_DELIBERATION' && ctx.round === 1 && ctx.seat.id === 's1') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s1');
            }
          }
          if (phase === 'R2_DELIBERATION' && ctx.round === 2 && ctx.seat.id === 's2') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s2');
            }
          }
          if (ctx.round === 1 && ctx.seat.id === 's1' && s1Proof) {
            return s1Proof;
          }
          return origProof(ctx);
        };

        mock.executeJudgeAuditAndSynthesis = async (ctx) => {
          if (phase === 'JUDGE_AUDIT_SYNTHESIS' && ctx.round === 1) {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('judge');
            }
          }
          return origJudge(ctx);
        };

        mock.executeSeatVote = async (ctx) => {
          if (phase === 'VOTING' && ctx.round === 1 && ctx.seat.id === 's1') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s1');
            }
          }
          if (phase === 'R2_DELIBERATION' && ctx.round === 1 && ctx.seat.id === 's2') {
            return { vote: 'object', proofId: 'P1', reason: 'Dispute R1 proof in R2' };
          }
          return origVote(ctx);
        };

        const engine = new CouncilEngine(
          {
            topic,
            clarifications,
            maxClarificationBatches: clarifications.length,
            minQuorum: 2,
            maxRounds: phase === 'R2_DELIBERATION' ? 2 : 1,
            maxRetriesPerSeat: 1,
            maxRetriesPerJudge: 1,
            cwd: '/repo',
            evidence: coveredSources.map((source, i) => ({
              id: `E${i + 1}`,
              label: `Artifact ${i + 1}`,
              source,
              text: `complete snapshot for ${source}`
            })),
            selfContainedInput: {
              kind: 'full_context',
              label: 'Round 9 regression matrix',
              phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
              roundScope: 'all_rounds',
              coveredArtifacts: coveredSources.map((source, i) => ({
                source,
                evidenceId: `E${i + 1}`,
                coverage: 'complete_artifact'
              }))
            },
            judge: { id: 'judge', harness: 'codex', model: 'gpt-6-astra (high)', tools: 'read-only', cwd: '/repo' },
            seats: [
              {
                id: 's1',
                harness: 'codex',
                model: 'gpt-6-astra (high)',
                soul: 'S1',
                tools: 'read-only',
                votingTools: 'read-only',
                cwd: '/repo'
              },
              { id: 's2', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S2', tools: 'read-only', cwd: '/repo' },
              { id: 's3', harness: 'cursor', model: 'grok-4', soul: 'S3', tools: 'none' }
            ]
          },
          { harnessResolver: () => mock }
        );

        await engine.run();
        return { engine, targetCalls };
      }

      // 1. Findings 1 & 2: nested brace/extglob directories & extensionless char-class workspace paths
      const nestedAndCharClassCases = [
        ['Inspect src/auth.js and src/{a,{b,c}}/', ['src/{a,{b,c}}/']],
        ['Inspect src/auth.js and (src/{a,{b,c}}/).', ['src/{a,{b,c}}/']],
        ['Inspect src/auth.js and src/+(a|@(b|c))/', ['src/+(a|@(b|c))/']],
        ['Inspect src/auth.js and (src/+(a|@(b|c))/).', ['src/+(a|@(b|c))/']],
        ['Inspect src/auth.js and src/@(a|{b,c})/', ['src/@(a|{b,c})/']],
        ['Inspect src/auth.js and src/{a,[[:digit:]]}/', ['src/{a,[[:digit:]]}/']],
        ['Inspect src/auth.js and !(a|+(b|c))/', ['!(a|+(b|c))/']],
        ['Inspect src/auth.js and foo/[ab]', ['foo/[ab]']],
        ['Inspect src/auth.js and (foo/[ab]).', ['foo/[ab]']],
        ['Inspect src/auth.js and foo/[[:digit:]]', ['foo/[[:digit:]]']],
        ['Inspect src/auth.js and [ab]/foo', ['[ab]/foo']],
        ['Inspect src/auth.js and foo/+(a|@(b|c))', ['foo/+(a|@(b|c))']],
        ['Inspect src/auth.js and foo/{a,{b,c}}', ['foo/{a,{b,c}}']]
      ];

      const sampleAuthProof = {
        id: 'P1',
        round: 1,
        seatId: 's1',
        status: 'admitted',
        scope: 'Auth check',
        kind: 'code',
        source: 'src/auth.js',
        statement: 'Auth contract verified in src/auth.js.'
      };
      const sampleCandidate = {
        summary: 'R1 candidate',
        clauses: [{ id: 'C1', context: 'c', conclusion: 'k', citedProofIds: ['P1'] }]
      };
      const sampleObjections = [{ id: 'O1', seatId: 's2', targetProofId: 'P1', reason: 'Re-check claim' }];

      for (const [text, expectedBroad] of nestedAndCharClassCases) {
        const deps = extractVerificationDependencies([text]);
        assert.deepEqual(
          deps,
          {
            workspaceFileDeps: [{ source: 'src/auth.js', unbounded: true }],
            workspaceBroadDeps: expectedBroad,
            externalDeps: []
          },
          `Finding 1/2: expected broad deps ${JSON.stringify(expectedBroad)} for: ${text}`
        );

        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          const r1Verdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({ phase: 'DELIBERATION', round: 1, errorClass, topic: text, coveredSources: ['src/auth.js'] })
          );
          const r2Verdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'DELIBERATION',
              round: 2,
              errorClass,
              topic: text,
              clarifications: [text],
              priorProofs: [sampleAuthProof],
              previousCandidate: sampleCandidate,
              openObjections: sampleObjections,
              coveredSources: ['src/auth.js']
            })
          );
          const judgeVerdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'JUDGE_AUDIT_SYNTHESIS',
              round: 1,
              errorClass,
              topic: text,
              proofs: [sampleAuthProof],
              coveredSources: ['src/auth.js']
            })
          );
          const voteVerdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'VOTING',
              round: 1,
              errorClass,
              topic: text,
              candidate: sampleCandidate,
              admittedProofs: [sampleAuthProof],
              coveredSources: ['src/auth.js']
            })
          );

          for (const [label, verdict] of [
            ['R1_DELIBERATION', r1Verdict],
            ['R2_DELIBERATION', r2Verdict],
            ['JUDGE_AUDIT_SYNTHESIS', judgeVerdict],
            ['VOTING', voteVerdict]
          ]) {
            assert.equal(verdict.ready, false, `Finding 1/2: ${label}/${errorClass} must refuse ${text}`);
            assert.equal(verdict.reasonCode, 'evidence_access_failure');
            assert.ok(
              verdict.missingDependencies.includes(expectedBroad[0]),
              `${label}/${errorClass}: expected missingDependencies to include ${expectedBroad[0]}, got ${JSON.stringify(verdict.missingDependencies)}`
            );
          }

          for (const phase of ['R1_DELIBERATION', 'R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING']) {
            const run = await runPhaseEngineCase({
              phase,
              errorClass,
              topic: text,
              coveredSources: ['src/auth.js']
            });
            assert.equal(run.targetCalls.length, 1, `Finding 1/2: ${phase}/${errorClass} engine must refuse ${text}`);
          }
        }
      }

      // Non-glob prose & citation slash-list control
      const citationProseText = 'Verify **[E1]** and *(note)* and [E1]/[E2] and [1]/[2] and seats[0].key in src/auth.js?';
      assert.deepEqual(extractVerificationDependencies([citationProseText]), {
        workspaceFileDeps: [{ source: 'src/auth.js', unbounded: true }],
        workspaceBroadDeps: [],
        externalDeps: []
      });
      for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
        assert.equal(
          evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'DELIBERATION',
              round: 1,
              errorClass,
              topic: citationProseText,
              coveredSources: ['src/auth.js']
            })
          ).ready,
          true
        );
      }

      // 2. Finding 3: quoted relative non-script check sources permitted when covered, refused when missing; scripts still vetoed
      const makeCheckProof = ({ source, statement }) => ({
        id: 'P1',
        round: 1,
        seatId: 's1',
        status: 'admitted',
        scope: 'File check',
        kind: 'check',
        source,
        statement
      });

      async function assertCheckProofBehavior({ source, statement, coveredSources, shouldAllow, label }) {
        const proof = makeCheckProof({ source, statement });
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          const r2Verdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'DELIBERATION',
              round: 2,
              errorClass,
              priorProofs: [proof],
              previousCandidate: sampleCandidate,
              openObjections: sampleObjections,
              coveredSources
            })
          );
          const judgeVerdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'JUDGE_AUDIT_SYNTHESIS',
              round: 1,
              errorClass,
              proofs: [proof],
              coveredSources
            })
          );
          const voteVerdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'VOTING',
              round: 1,
              errorClass,
              candidate: sampleCandidate,
              admittedProofs: [proof],
              coveredSources
            })
          );

          for (const [phaseLabel, verdict] of [
            ['R2_DELIBERATION', r2Verdict],
            ['JUDGE_AUDIT_SYNTHESIS', judgeVerdict],
            ['VOTING', voteVerdict]
          ]) {
            assert.equal(verdict.ready, shouldAllow, `${label}: ${phaseLabel}/${errorClass} ready mismatch`);
          }

          for (const phase of ['R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING']) {
            const run = await runPhaseEngineCase({
              phase,
              errorClass,
              topic: 'Inspect src/auth.js.',
              s1Proof: {
                scope: 'File check',
                kind: 'check',
                source,
                statement
              },
              coveredSources
            });
            if (shouldAllow) {
              assert.equal(run.targetCalls.length, 2, `${label}: ${phase}/${errorClass} must permit tool-free retry`);
              assert.equal(run.targetCalls[1].tools, 'none');
              assert.equal(run.targetCalls[1].cwd, undefined);
            } else {
              assert.equal(run.targetCalls.length, 1, `${label}: ${phase}/${errorClass} must refuse tool-free retry`);
            }
          }
        }
      }

      for (const control of [
        { source: '"./docs/policy.md"', statement: 'Policy check verified.', coveredSources: ['src/auth.js', 'docs/policy.md'] },
        { source: '"./src/auth.js"', statement: 'Auth check verified.', coveredSources: ['src/auth.js'] },
        { source: "'./src/auth.js'", statement: 'Auth check verified.', coveredSources: ['src/auth.js'] },
        { source: '`./src/auth.js`', statement: 'Auth check verified.', coveredSources: ['src/auth.js'] }
      ]) {
        await assertCheckProofBehavior({ ...control, shouldAllow: true, label: `Finding 3 allowed ${control.source}` });
      }

      // Missing-file negative controls for quoted relative non-script files
      await assertCheckProofBehavior({
        source: '"./docs/policy.md"',
        statement: 'Policy check verified.',
        coveredSources: ['src/auth.js'],
        shouldAllow: false,
        label: 'Finding 3 missing uncovered ./docs/policy.md'
      });

      // Executable scripts still vetoed even when covered in evidence
      for (const scriptSource of ['"./scripts/verify.sh"', "'./scripts/verify.sh'", './scripts/verify.sh', '"./gradlew"']) {
        await assertCheckProofBehavior({
          source: scriptSource,
          statement: 'Script execution verified.',
          coveredSources: ['src/auth.js', 'scripts/verify.sh', 'gradlew'],
          shouldAllow: false,
          label: `Finding 3 executable veto ${scriptSource}`
        });
      }

      // 3. Finding 4: quoted filenames, package specifiers, and keys in prose check statements allowed when covered, refused when missing; real commands vetoed
      for (const control of [
        {
          source: 'src/auth.js',
          statement: 'The value in "cat.md" is constant.',
          coveredSources: ['src/auth.js', 'cat.md']
        },
        {
          source: 'src/auth.js',
          statement: 'The values in "cat.md", \'ls.js\', "pytest.ini", and "./docs/policy.md" are constant.',
          coveredSources: ['src/auth.js', 'cat.md', 'ls.js', 'pytest.ini', 'docs/policy.md']
        },
        {
          source: 'src/auth.js',
          statement: 'Imports "node:fs" and "node-fetch" and keys "cat", "node", "git", "sh", "make", "env" are valid.',
          coveredSources: ['src/auth.js']
        }
      ]) {
        await assertCheckProofBehavior({ ...control, shouldAllow: true, label: `Finding 4 prose allowed (${control.statement})` });
      }

      // Missing-file negative control for quoted filename in prose
      await assertCheckProofBehavior({
        source: 'src/auth.js',
        statement: 'The value in "cat.md" is constant.',
        coveredSources: ['src/auth.js'],
        shouldAllow: false,
        label: 'Finding 4 missing uncovered cat.md'
      });

      // Real quoted commands in check proof statements still vetoed
      for (const cmdStatement of [
        'Verified via "uname -a" output.',
        "Verified via 'cat README' output.",
        'Verified via "ls" output.',
        'Verified via "./scripts/verify.sh" output.',
        'Verified via "head -n 5 src/auth.js" output.'
      ]) {
        await assertCheckProofBehavior({
          source: 'src/auth.js',
          statement: cmdStatement,
          coveredSources: ['src/auth.js', 'README', 'scripts/verify.sh'],
          shouldAllow: false,
          label: `Finding 4 quoted command veto (${cmdStatement})`
        });
      }

      // 4. 48KB linear-time regression probes for nested braces & nested extglobs
      extractVerificationDependencies(['warmup src/{a,{b,c}}/ src/+(a|@(b|c))/']);
      for (const [label, payload] of [
        ['nested-braces-48k', 'src/' + '{a,'.repeat(12000) + 'b' + '}'.repeat(12000) + '/'],
        ['nested-extglob-48k', 'src/' + '+(a|'.repeat(9600) + 'b' + ')'.repeat(9600) + '/']
      ]) {
        assert.ok(Buffer.byteLength(payload, 'utf8') >= 48000, `Expected >=48KB for ${label}`);
        const t0 = performance.now();
        const deps = extractVerificationDependencies([payload]);
        const elapsedMs = performance.now() - t0;
        assert.ok(elapsedMs < 20, `Expected <20ms for ${label}, got ${elapsedMs.toFixed(2)}ms`);
        assert.equal(deps.workspaceBroadDeps.length, 1, `Expected 1 broad dep for ${label}`);
      }
    });

    it('ReReview-102 Round 10 fixes: enforces literal-closing-bracket char classes, empty-alt/sequence brace globs, and whitespace-padded quoted check commands', async () => {
      function makeReadinessParams({
        phase = 'DELIBERATION',
        round = 1,
        errorClass,
        topic = 'Inspect src/auth.js.',
        coveredSources = ['src/auth.js'],
        clarifications = [],
        proofs = [],
        priorProofs = [],
        previousCandidate = undefined,
        openObjections = [],
        candidate = undefined,
        admittedProofs = []
      }) {
        return {
          phase,
          round,
          errorClass,
          topic,
          clarifications,
          proofs,
          priorProofs,
          previousCandidate,
          openObjections,
          candidate,
          admittedProofs,
          evidence: coveredSources.map((source, i) => ({
            id: `E${i + 1}`,
            source,
            text: `complete snapshot for ${source}`
          })),
          selfContainedInput: {
            phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
            roundScope: 'all_rounds',
            coveredArtifacts: coveredSources.map((source, i) => ({
              source,
              evidenceId: `E${i + 1}`,
              coverage: 'complete_artifact'
            }))
          },
          originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo' }
        };
      }

      async function runPhaseEngineCase({
        phase,
        errorClass,
        topic,
        clarifications = [],
        s1Proof = null,
        coveredSources = ['src/auth.js']
      }) {
        const mock = new MockAdapter();
        const targetCalls = [];
        const origProof = mock.executeSeatProof.bind(mock);
        const origJudge = mock.executeJudgeAuditAndSynthesis.bind(mock);
        const origVote = mock.executeSeatVote.bind(mock);

        const makeFault = (participantId) =>
          errorClass === 'TimeoutError'
            ? new TimeoutError(`${phase} timeout`, { timeoutMs: 1000, harness: 'codex', seatId: participantId })
            : new HeadlessToolDeniedError(`${phase} tool denied`, {
                harness: 'codex',
                seatId: participantId,
                exitCode: 0,
                isRetryable: true
              });

        mock.executeSeatProof = async (ctx) => {
          if (phase === 'R1_DELIBERATION' && ctx.round === 1 && ctx.seat.id === 's1') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s1');
            }
          }
          if (phase === 'R2_DELIBERATION' && ctx.round === 2 && ctx.seat.id === 's2') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s2');
            }
          }
          if (ctx.round === 1 && ctx.seat.id === 's1' && s1Proof) {
            return s1Proof;
          }
          return origProof(ctx);
        };

        mock.executeJudgeAuditAndSynthesis = async (ctx) => {
          if (phase === 'JUDGE_AUDIT_SYNTHESIS' && ctx.round === 1) {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('judge');
            }
          }
          return origJudge(ctx);
        };

        mock.executeSeatVote = async (ctx) => {
          if (phase === 'VOTING' && ctx.round === 1 && ctx.seat.id === 's1') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s1');
            }
          }
          if (phase === 'R2_DELIBERATION' && ctx.round === 1 && ctx.seat.id === 's2') {
            return { vote: 'object', proofId: 'P1', reason: 'Dispute R1 proof in R2' };
          }
          return origVote(ctx);
        };

        const engine = new CouncilEngine(
          {
            topic,
            clarifications,
            maxClarificationBatches: clarifications.length,
            minQuorum: 2,
            maxRounds: phase === 'R2_DELIBERATION' ? 2 : 1,
            maxRetriesPerSeat: 1,
            maxRetriesPerJudge: 1,
            cwd: '/repo',
            evidence: coveredSources.map((source, i) => ({
              id: `E${i + 1}`,
              label: `Artifact ${i + 1}`,
              source,
              text: `complete snapshot for ${source}`
            })),
            selfContainedInput: {
              kind: 'full_context',
              label: 'Round 10 regression matrix',
              phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
              roundScope: 'all_rounds',
              coveredArtifacts: coveredSources.map((source, i) => ({
                source,
                evidenceId: `E${i + 1}`,
                coverage: 'complete_artifact'
              }))
            },
            judge: { id: 'judge', harness: 'codex', model: 'gpt-6-astra (high)', tools: 'read-only', cwd: '/repo' },
            seats: [
              {
                id: 's1',
                harness: 'codex',
                model: 'gpt-6-astra (high)',
                soul: 'S1',
                tools: 'read-only',
                votingTools: 'read-only',
                cwd: '/repo'
              },
              { id: 's2', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S2', tools: 'read-only', cwd: '/repo' },
              { id: 's3', harness: 'cursor', model: 'grok-4', soul: 'S3', tools: 'none' }
            ]
          },
          { harnessResolver: () => mock }
        );

        await engine.run();
        return { engine, targetCalls };
      }

      const sampleAuthProof = {
        id: 'P1',
        round: 1,
        seatId: 's1',
        status: 'admitted',
        scope: 'Auth check',
        kind: 'code',
        source: 'src/auth.js',
        statement: 'Auth contract verified in src/auth.js.'
      };
      const sampleCandidate = {
        summary: 'R1 candidate',
        clauses: [{ id: 'C1', context: 'c', conclusion: 'k', citedProofIds: ['P1'] }]
      };
      const sampleObjections = [{ id: 'O1', seatId: 's2', targetProofId: 'P1', reason: 'Re-check claim' }];

      async function assertTopicBroadVetoAllPhases(text, expectedBroad) {
        const deps = extractVerificationDependencies([text]);
        assert.deepEqual(
          deps,
          {
            workspaceFileDeps: [{ source: 'src/auth.js', unbounded: true }],
            workspaceBroadDeps: expectedBroad,
            externalDeps: []
          },
          `Expected broad deps ${JSON.stringify(expectedBroad)} for: ${text}`
        );

        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          const r1Verdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({ phase: 'DELIBERATION', round: 1, errorClass, topic: text, coveredSources: ['src/auth.js'] })
          );
          const r2Verdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'DELIBERATION',
              round: 2,
              errorClass,
              topic: text,
              clarifications: [text],
              priorProofs: [sampleAuthProof],
              previousCandidate: sampleCandidate,
              openObjections: sampleObjections,
              coveredSources: ['src/auth.js']
            })
          );
          const judgeVerdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'JUDGE_AUDIT_SYNTHESIS',
              round: 1,
              errorClass,
              topic: text,
              proofs: [sampleAuthProof],
              coveredSources: ['src/auth.js']
            })
          );
          const voteVerdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'VOTING',
              round: 1,
              errorClass,
              topic: text,
              candidate: sampleCandidate,
              admittedProofs: [sampleAuthProof],
              coveredSources: ['src/auth.js']
            })
          );

          for (const [label, verdict] of [
            ['R1_DELIBERATION', r1Verdict],
            ['R2_DELIBERATION', r2Verdict],
            ['JUDGE_AUDIT_SYNTHESIS', judgeVerdict],
            ['VOTING', voteVerdict]
          ]) {
            assert.equal(verdict.ready, false, `${label}/${errorClass} must refuse ${text}`);
            assert.equal(verdict.reasonCode, 'evidence_access_failure');
            assert.ok(
              verdict.missingDependencies.includes(expectedBroad[0]),
              `${label}/${errorClass}: expected missingDependencies to include ${expectedBroad[0]}, got ${JSON.stringify(verdict.missingDependencies)}`
            );
          }

          for (const phase of ['R1_DELIBERATION', 'R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING']) {
            const run = await runPhaseEngineCase({
              phase,
              errorClass,
              topic: text,
              coveredSources: ['src/auth.js']
            });
            assert.equal(run.targetCalls.length, 1, `${phase}/${errorClass} engine must refuse ${text}`);
          }
        }
      }

      // 1. Finding 1 & cousins: literal closing brackets in char classes, comma in char class, & citation controls
      for (const [text, expectedBroad] of [
        ['Inspect foo/[!]]', ['foo/[!]]']],
        ['Inspect (foo/[!]]).', ['foo/[!]]']],
        ['Inspect [foo/[!]]].', ['foo/[!]]']],
        ['Inspect (foo/[)]). and (foo/[(]).', ['foo/[)]', 'foo/[(]']],
        ['Inspect foo/[]a] and foo/[^]]', ['foo/[]a]', 'foo/[^]]']],
        ['Inspect foo/[]] and foo/[[] and foo/[![]', ['foo/[]]', 'foo/[[]', 'foo/[![]']],
        ['Inspect [!]]/foo and [[!]]/foo].', ['[!]]/foo']],
        ['Inspect [[]/foo and [[[]/foo].', ['[[]/foo']],
        ['Inspect [a]/foo/[b] and [[a]/foo/[b]].', ['[a]/foo/[b]']],
        ['Inspect src/[!]]/', ['src/[!]]/']],
        ['Inspect foo/[a,b] and src/[a,b]/', ['foo/[a,b]', 'src/[a,b]/']],
        ['Inspect (src/**,lib/**).', ['src/**', 'lib/**']],
        ['Inspect foo/[!]],bar/[!]]', ['foo/[!]]', 'bar/[!]]']],
        ['Compare [E1]/[E2] and [[E1]/[E2]].', []]
      ]) {
        const deps = extractVerificationDependencies([text]);
        assert.deepEqual(deps.workspaceBroadDeps, expectedBroad, `Char-class extraction mismatch on: ${text}`);
      }

      for (const [text, expectedBroad] of [
        ['Inspect src/auth.js and foo/[!]]', ['foo/[!]]']],
        ['Inspect src/auth.js and foo/[]a]', ['foo/[]a]']],
        ['Inspect src/auth.js and foo/[^]]', ['foo/[^]]']],
        ['Inspect src/auth.js and [foo/[!]]].', ['foo/[!]]']],
        ['Inspect src/auth.js and foo/[a,b]', ['foo/[a,b]']]
      ]) {
        await assertTopicBroadVetoAllPhases(text, expectedBroad);
      }

      // 2. Finding 2 & cousins: brace lists with empty alternatives & sequence braces
      for (const [text, expectedBroad] of [
        ['Inspect src/auth.js and src/{a,}/', ['src/{a,}/']],
        ['Inspect src/{,a}/ and src/{,}/', ['src/{,a}/', 'src/{,}/']],
        ['Inspect foo/{a,} and foo/{,a} and {a,}/foo', ['foo/{a,}', 'foo/{,a}', '{a,}/foo']],
        ['Inspect src/{a,{b,}}/', ['src/{a,{b,}}/']],
        ['Inspect src/{1..3}/ and foo/{a..c}', ['src/{1..3}/', 'foo/{a..c}']]
      ]) {
        const deps = extractVerificationDependencies([text]);
        assert.deepEqual(deps.workspaceBroadDeps, expectedBroad, `Brace extraction mismatch on: ${text}`);
      }

      for (const [text, expectedBroad] of [
        ['Inspect src/auth.js and src/{a,}/', ['src/{a,}/']],
        ['Inspect src/auth.js and src/{,a}/', ['src/{,a}/']],
        ['Inspect src/auth.js and foo/{a,}', ['foo/{a,}']],
        ['Inspect src/auth.js and src/{1..3}/', ['src/{1..3}/']]
      ]) {
        await assertTopicBroadVetoAllPhases(text, expectedBroad);
      }

      // 3. Finding 3 & cousins: surrounding/trailing whitespace in quoted check commands & controls
      async function assertCheckProofBehavior({ source, statement, coveredSources, shouldAllow, label }) {
        const proof = {
          id: 'P1',
          round: 1,
          seatId: 's1',
          status: 'admitted',
          scope: 'File check',
          kind: 'check',
          source,
          statement
        };
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          const r2Verdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'DELIBERATION',
              round: 2,
              errorClass,
              priorProofs: [proof],
              previousCandidate: sampleCandidate,
              openObjections: sampleObjections,
              coveredSources
            })
          );
          const judgeVerdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'JUDGE_AUDIT_SYNTHESIS',
              round: 1,
              errorClass,
              proofs: [proof],
              coveredSources
            })
          );
          const voteVerdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'VOTING',
              round: 1,
              errorClass,
              candidate: sampleCandidate,
              admittedProofs: [proof],
              coveredSources
            })
          );

          for (const [phaseLabel, verdict] of [
            ['R2_DELIBERATION', r2Verdict],
            ['JUDGE_AUDIT_SYNTHESIS', judgeVerdict],
            ['VOTING', voteVerdict]
          ]) {
            assert.equal(verdict.ready, shouldAllow, `${label}: ${phaseLabel}/${errorClass} ready mismatch`);
          }

          for (const phase of ['R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING']) {
            const run = await runPhaseEngineCase({
              phase,
              errorClass,
              topic: 'Inspect src/auth.js.',
              s1Proof: {
                scope: 'File check',
                kind: 'check',
                source,
                statement
              },
              coveredSources
            });
            if (shouldAllow) {
              assert.equal(run.targetCalls.length, 2, `${label}: ${phase}/${errorClass} must permit tool-free retry`);
              assert.equal(run.targetCalls[1].tools, 'none');
              assert.equal(run.targetCalls[1].cwd, undefined);
            } else {
              assert.equal(run.targetCalls.length, 1, `${label}: ${phase}/${errorClass} must refuse tool-free retry`);
            }
          }
        }
      }

      for (const badStmt of [
        'Verified via "ls " output.',
        'Verified via " ls" output.',
        'Verified via " ls " output.',
        "Verified via 'ls ' output.",
        "Verified via ' ls ' output.",
        'Verified via "uname " output.',
        'Verified via "go test " output.',
        'Verified via "whoami " output.',
        'Verified via "printenv " output.',
        'Verified via " cat README " output.',
        'Verified via " ./scripts/verify.sh " output.',
        'Verified via " head -n 5 src/auth.js " output.',
        'Checked "key" then "ls ".'
      ]) {
        await assertCheckProofBehavior({
          source: 'src/auth.js',
          statement: badStmt,
          coveredSources: ['src/auth.js', 'README', 'scripts/verify.sh'],
          shouldAllow: false,
          label: `Finding 3 whitespace-padded command statement (${badStmt})`
        });
      }

      for (const badSource of ['"ls "', "' ls '", '" ./scripts/verify.sh "']) {
        await assertCheckProofBehavior({
          source: badSource,
          statement: 'Verified output.',
          coveredSources: ['src/auth.js', 'README', 'scripts/verify.sh'],
          shouldAllow: false,
          label: `Finding 3 whitespace-padded command source (${badSource})`
        });
      }

      for (const control of [
        {
          source: 'src/auth.js',
          statement: 'Proof synthesized according to soul: "S1".',
          coveredSources: ['src/auth.js']
        },
        {
          source: 'src/auth.js',
          statement: 'Keys " cat ", " node ", " git ", " make ", and "note!" are valid.',
          coveredSources: ['src/auth.js']
        },
        {
          source: 'src/auth.js',
          statement: 'Keys " ls.js ", " uname.txt ", and " cat.md " are covered.',
          coveredSources: ['src/auth.js', 'ls.js', 'uname.txt', 'cat.md']
        },
        {
          source: 'src/auth.js',
          statement: "Empty \"\" and \"   \" and didn't fail on users' roles or 'can't' text.",
          coveredSources: ['src/auth.js']
        }
      ]) {
        await assertCheckProofBehavior({
          ...control,
          shouldAllow: true,
          label: `Finding 3 positive control (${control.statement})`
        });
      }

      await assertCheckProofBehavior({
        source: 'src/auth.js',
        statement: 'Keys " ls.js " and " cat.md " are covered.',
        coveredSources: ['src/auth.js'],
        shouldAllow: false,
        label: 'Finding 3 missing-coverage negative control'
      });

      // 4. 48KB linear-time regression probes (<20ms)
      extractVerificationDependencies(['warmup src/{a,{b,c}}/ foo/[!]]']);
      for (const [label, payload] of [
        ['literal-close-bracket-48k', '['.repeat(48000) + '[!]]/foo'],
        ['empty-alt-braces-48k', 'src/' + '{,a'.repeat(12000) + '}'.repeat(12000) + '/']
      ]) {
        assert.ok(Buffer.byteLength(payload, 'utf8') >= 48000, `Expected >=48KB for ${label}`);
        const t0 = performance.now();
        const deps = extractVerificationDependencies([payload]);
        const elapsedMs = performance.now() - t0;
        assert.ok(elapsedMs < 20, `Expected <20ms for ${label}, got ${elapsedMs.toFixed(2)}ms`);
        assert.equal(deps.workspaceBroadDeps.length, 1, `Expected 1 broad dep for ${label}`);
      }

      const alternatingQuotesPayload = ' "a'.repeat(16000);
      assert.ok(Buffer.byteLength(alternatingQuotesPayload, 'utf8') >= 48000);
      const qt0 = performance.now();
      const quoteVerdict = evaluateToolFreeEvidenceReadiness(
        makeReadinessParams({
          phase: 'JUDGE_AUDIT_SYNTHESIS',
          round: 1,
          errorClass: 'TimeoutError',
          proofs: [{ ...sampleAuthProof, kind: 'check', statement: alternatingQuotesPayload }],
          coveredSources: ['src/auth.js']
        })
      );
      const quoteElapsedMs = performance.now() - qt0;
      assert.ok(quoteElapsedMs < 20, `Expected <20ms for alternating-quotes-48k, got ${quoteElapsedMs.toFixed(2)}ms`);
      assert.equal(quoteVerdict.ready, true);
    });

    it('ReReview-102 Round 11 fixes: enforces quoted command prefixes/chaining, root-level non-star globs, and commas inside extglobs', async () => {
      function makeReadinessParams({
        phase = 'DELIBERATION',
        round = 1,
        errorClass,
        topic = 'Inspect src/auth.js.',
        coveredSources = ['src/auth.js'],
        clarifications = [],
        proofs = [],
        priorProofs = [],
        previousCandidate = undefined,
        openObjections = [],
        candidate = undefined,
        admittedProofs = []
      }) {
        return {
          phase,
          round,
          errorClass,
          topic,
          clarifications,
          proofs,
          priorProofs,
          previousCandidate,
          openObjections,
          candidate,
          admittedProofs,
          evidence: coveredSources.map((source, i) => ({
            id: `E${i + 1}`,
            source,
            text: `complete snapshot for ${source}`
          })),
          selfContainedInput: {
            phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
            roundScope: 'all_rounds',
            coveredArtifacts: coveredSources.map((source, i) => ({
              source,
              evidenceId: `E${i + 1}`,
              coverage: 'complete_artifact'
            }))
          },
          originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo' }
        };
      }

      async function runPhaseEngineCase({
        phase,
        errorClass,
        topic,
        clarifications = [],
        s1Proof = null,
        coveredSources = ['src/auth.js']
      }) {
        const mock = new MockAdapter();
        const targetCalls = [];
        const origProof = mock.executeSeatProof.bind(mock);
        const origJudge = mock.executeJudgeAuditAndSynthesis.bind(mock);
        const origVote = mock.executeSeatVote.bind(mock);

        const makeFault = (participantId) =>
          errorClass === 'TimeoutError'
            ? new TimeoutError(`${phase} timeout`, { timeoutMs: 1000, harness: 'codex', seatId: participantId })
            : new HeadlessToolDeniedError(`${phase} tool denied`, {
                harness: 'codex',
                seatId: participantId,
                exitCode: 0,
                isRetryable: true
              });

        mock.executeSeatProof = async (ctx) => {
          if (phase === 'R1_DELIBERATION' && ctx.round === 1 && ctx.seat.id === 's1') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s1');
            }
          }
          if (phase === 'R2_DELIBERATION' && ctx.round === 2 && ctx.seat.id === 's2') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s2');
            }
          }
          if (ctx.round === 1 && ctx.seat.id === 's1' && s1Proof) {
            return s1Proof;
          }
          return origProof(ctx);
        };

        mock.executeJudgeAuditAndSynthesis = async (ctx) => {
          if (phase === 'JUDGE_AUDIT_SYNTHESIS' && ctx.round === 1) {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('judge');
            }
          }
          return origJudge(ctx);
        };

        mock.executeSeatVote = async (ctx) => {
          if (phase === 'VOTING' && ctx.round === 1 && ctx.seat.id === 's1') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s1');
            }
          }
          if (phase === 'R2_DELIBERATION' && ctx.round === 1 && ctx.seat.id === 's2') {
            return { vote: 'object', proofId: 'P1', reason: 'Dispute R1 proof in R2' };
          }
          return origVote(ctx);
        };

        const engine = new CouncilEngine(
          {
            topic,
            clarifications,
            maxClarificationBatches: clarifications.length,
            minQuorum: 2,
            maxRounds: phase === 'R2_DELIBERATION' ? 2 : 1,
            maxRetriesPerSeat: 1,
            maxRetriesPerJudge: 1,
            cwd: '/repo',
            evidence: coveredSources.map((source, i) => ({
              id: `E${i + 1}`,
              label: `Artifact ${i + 1}`,
              source,
              text: `complete snapshot for ${source}`
            })),
            selfContainedInput: {
              kind: 'full_context',
              label: 'Round 11 regression matrix',
              phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
              roundScope: 'all_rounds',
              coveredArtifacts: coveredSources.map((source, i) => ({
                source,
                evidenceId: `E${i + 1}`,
                coverage: 'complete_artifact'
              }))
            },
            judge: { id: 'judge', harness: 'codex', model: 'gpt-6-astra (high)', tools: 'read-only', cwd: '/repo' },
            seats: [
              {
                id: 's1',
                harness: 'codex',
                model: 'gpt-6-astra (high)',
                soul: 'S1',
                tools: 'read-only',
                votingTools: 'read-only',
                cwd: '/repo'
              },
              { id: 's2', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S2', tools: 'read-only', cwd: '/repo' },
              { id: 's3', harness: 'cursor', model: 'grok-4', soul: 'S3', tools: 'none' }
            ]
          },
          { harnessResolver: () => mock }
        );

        await engine.run();
        return { engine, targetCalls };
      }

      const sampleAuthProof = {
        id: 'P1',
        round: 1,
        seatId: 's1',
        status: 'admitted',
        scope: 'Auth check',
        kind: 'code',
        source: 'src/auth.js',
        statement: 'Auth contract verified in src/auth.js.'
      };
      const sampleCandidate = {
        summary: 'R1 candidate',
        clauses: [{ id: 'C1', context: 'c', conclusion: 'k', citedProofIds: ['P1'] }]
      };
      const sampleObjections = [{ id: 'O1', seatId: 's2', targetProofId: 'P1', reason: 'Re-check claim' }];

      async function assertCheckProofBehavior({ source, statement, coveredSources, shouldAllow, label }) {
        const proof = {
          id: 'P1',
          round: 1,
          seatId: 's1',
          status: 'admitted',
          scope: 'File check',
          kind: 'check',
          source,
          statement
        };
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          const r2Verdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'DELIBERATION',
              round: 2,
              errorClass,
              priorProofs: [proof],
              previousCandidate: sampleCandidate,
              openObjections: sampleObjections,
              coveredSources
            })
          );
          const judgeVerdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'JUDGE_AUDIT_SYNTHESIS',
              round: 1,
              errorClass,
              proofs: [proof],
              coveredSources
            })
          );
          const voteVerdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'VOTING',
              round: 1,
              errorClass,
              candidate: sampleCandidate,
              admittedProofs: [proof],
              coveredSources
            })
          );

          for (const [phaseLabel, verdict] of [
            ['R2_DELIBERATION', r2Verdict],
            ['JUDGE_AUDIT_SYNTHESIS', judgeVerdict],
            ['VOTING', voteVerdict]
          ]) {
            assert.equal(verdict.ready, shouldAllow, `${label}: ${phaseLabel}/${errorClass} ready mismatch`);
          }

          for (const phase of ['R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING']) {
            const run = await runPhaseEngineCase({
              phase,
              errorClass,
              topic: 'Inspect src/auth.js.',
              s1Proof: {
                scope: 'File check',
                kind: 'check',
                source,
                statement
              },
              coveredSources
            });
            if (shouldAllow) {
              assert.equal(run.targetCalls.length, 2, `${label}: ${phase}/${errorClass} must permit tool-free retry`);
              assert.equal(run.targetCalls[1].tools, 'none');
              assert.equal(run.targetCalls[1].cwd, undefined);
            } else {
              assert.equal(run.targetCalls.length, 1, `${label}: ${phase}/${errorClass} must refuse tool-free retry`);
            }
          }
        }
      }

      // 1. Finding 1: quoted command prefixes, wrappers, shell chaining, subshells, redirections, & command substitutions
      for (const badStmt of [
        'Checked "CI=1 npm test" output.',
        'Checked "FOO=1 BAR=2 pytest -q" output.',
        'Checked \'FOO="a b" npm test\' output.',
        'Checked "FOO=\\"bar\\" ./scripts/verify.sh" output.',
        'Checked "env npm test" output.',
        'Checked "env CI=1 go test " output.',
        'Checked "env -i ls" output.',
        'Checked "env -u PATH ls" output.',
        'Checked "/usr/bin/env npm test" output.',
        'Checked "cd src && npm test" output.',
        'Checked "cd src && pwd" output.',
        'Checked "cd ./src" output.',
        'Checked "(cd src && go test)" output.',
        'Checked "{ cd src; npm test; }" output.',
        'Checked "cat src/auth.js | wc -l" output.',
        'Checked "time cargo test" output.',
        'Checked "command ls" output.',
        'Checked "command -v git" output.',
        'Checked "exec ./scripts/verify.sh" output.',
        'Checked "timeout 10s npm test" output.',
        'Checked "nice -n 10 make" output.',
        'Checked "CI=1 make" output.',
        'Checked "make test" output.',
        'Checked "pwd > out.txt" output.',
        'Checked "$(uname -a)" output.',
        'Checked "$(pwd)" output.',
        'Checked $(pwd) output.'
      ]) {
        await assertCheckProofBehavior({
          source: 'src/auth.js',
          statement: badStmt,
          coveredSources: ['src/auth.js', 'README', 'scripts/verify.sh', 'out.txt'],
          shouldAllow: false,
          label: `R11 Finding 1 veto statement (${badStmt})`
        });
      }

      for (const badSource of ['"CI=1 npm test"', '"env npm test"', '"cd src && npm test"']) {
        await assertCheckProofBehavior({
          source: badSource,
          statement: 'Verified output.',
          coveredSources: ['src/auth.js', 'README', 'scripts/verify.sh', 'out.txt'],
          shouldAllow: false,
          label: `R11 Finding 1 veto source (${badSource})`
        });
      }

      for (const control of [
        {
          source: 'src/auth.js',
          statement: 'Proof synthesized according to soul: "S1".',
          coveredSources: ['src/auth.js']
        },
        {
          source: 'src/auth.js',
          statement: 'Keys " cat ", " node ", " git ", " make ", " env ", " pwd ", " id ", and "note!" are valid.',
          coveredSources: ['src/auth.js']
        },
        {
          source: 'src/auth.js',
          statement: 'Values "CI=1", "NODE_ENV=production", "time is constant", "command pattern", "make sure", "env variable", "user && user.isAdmin", "a | b" are strings.',
          coveredSources: ['src/auth.js']
        },
        {
          source: 'src/auth.js',
          statement: 'Keys " ls.js ", " uname.txt ", and " cat.md " are covered.',
          coveredSources: ['src/auth.js', 'ls.js', 'uname.txt', 'cat.md']
        }
      ]) {
        await assertCheckProofBehavior({
          ...control,
          shouldAllow: true,
          label: `R11 Finding 1 positive control (${control.statement})`
        });
      }

      // 2 & 3. Finding 2 & Finding 3: root-level non-star globs, comma-containing extglobs, & prose/subscript controls
      for (const [input, expBroad, expFiles] of [
        ['file[0-9].js', ['file[0-9].js'], []],
        ['(file[0-9].js).', ['file[0-9].js'], []],
        ['[file[0-9].js].', ['file[0-9].js'], []],
        ['([file[0-9].js]).', ['file[0-9].js'], []],
        ['`file[0-9].js`', ['file[0-9].js'], []],
        ['[glob](file[0-9].js)', ['file[0-9].js'], []],
        ['[ext](src/@(a,b|c)/)', ['src/@(a,b|c)/'], []],
        ['[0-9].js', ['[0-9].js'], []],
        ['[a-z][0-9].js', ['[a-z][0-9].js'], []],
        ['[[a-z][0-9].js].', ['[a-z][0-9].js'], []],
        ['[[!]].js].', ['[!]].js'], []],
        ['file[ab].js', ['file[ab].js'], []],
        ['file[!a].js', ['file[!a].js'], []],
        ['file[!]].js', ['file[!]].js'], []],
        ['file[[:digit:]].js', ['file[[:digit:]].js'], []],
        ['file.[ch]', ['file.[ch]'], []],
        ['{foo,bar}.js', ['{foo,bar}.js'], []],
        ['{foo,}.js', ['{foo,}.js'], []],
        ['{,bar}.js', ['{,bar}.js'], []],
        ['{,}.js', ['{,}.js'], []],
        ['{node,deno}.js', ['{node,deno}.js'], []],
        ['app.{js,ts}', ['app.{js,ts}'], []],
        ['{Makefile,Dockerfile}', ['{Makefile,Dockerfile}'], []],
        ['{.env,.npmrc}', ['{.env,.npmrc}'], []],
        ['file{1..3}.js', ['file{1..3}.js'], []],
        ['{a..c}.ts', ['{a..c}.ts'], []],
        ['@(foo|bar).js', ['@(foo|bar).js'], []],
        ['+(foo|bar).js', ['+(foo|bar).js'], []],
        ['?(foo|bar).js', ['?(foo|bar).js'], []],
        ['!(foo|bar).js', ['!(foo|bar).js'], []],
        ['*(foo|bar).js', ['*(foo|bar).js'], []],
        ['app.@(js|ts)', ['app.@(js|ts)'], []],
        ['file?.js', ['file?.js'], []],
        ['src/@(a,b|c)/', ['src/@(a,b|c)/'], []],
        ['foo/+(a,b)', ['foo/+(a,b)'], []],
        ['src/*(a,b)/', ['src/*(a,b)/'], []],
        ['*(a,b).js', ['*(a,b).js'], []],
        ['@(a,b|c).js', ['@(a,b|c).js'], []],
        ['src/+(a|{b,c},d)/', ['src/+(a|{b,c},d)/'], []],
        ['(src/@(a,b|c)/,lib/@(d,e|f)/).', ['src/@(a,b|c)/', 'lib/@(d,e|f)/'], []],
        ['(file[0-9].js,{foo,bar}.js).', ['file[0-9].js', '{foo,bar}.js'], []],
        ['Inspect [auth.js].', [], ['auth.js']],
        ['Inspect [[auth.js]].', [], ['auth.js']],
        ['Did you inspect auth.js?', [], ['auth.js']],
        ['Check seats[0].key and items[i].map and {foo,bar} and !(valid) and v1.{0..2} and [E1]/[E2].', [], []]
      ]) {
        const got = extractVerificationDependencies([input]);
        assert.deepEqual(got.workspaceBroadDeps, expBroad, `Extraction broad mismatch for: ${input}`);
        assert.deepEqual(
          got.workspaceFileDeps.map((d) => d.source),
          expFiles,
          `Extraction file mismatch for: ${input}`
        );
        assert.deepEqual(got.externalDeps, [], `Extraction external mismatch for: ${input}`);
      }

      async function assertTopicBroadVetoAllPhases(text, expectedBroad) {
        const deps = extractVerificationDependencies([text]);
        assert.deepEqual(
          deps,
          {
            workspaceFileDeps: [{ source: 'src/auth.js', unbounded: true }],
            workspaceBroadDeps: expectedBroad,
            externalDeps: []
          },
          `Expected broad deps ${JSON.stringify(expectedBroad)} for: ${text}`
        );

        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          const r1Verdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({ phase: 'DELIBERATION', round: 1, errorClass, topic: text, coveredSources: ['src/auth.js'] })
          );
          const r2Verdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'DELIBERATION',
              round: 2,
              errorClass,
              topic: text,
              clarifications: [text],
              priorProofs: [sampleAuthProof],
              previousCandidate: sampleCandidate,
              openObjections: sampleObjections,
              coveredSources: ['src/auth.js']
            })
          );
          const judgeVerdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'JUDGE_AUDIT_SYNTHESIS',
              round: 1,
              errorClass,
              topic: text,
              proofs: [sampleAuthProof],
              coveredSources: ['src/auth.js']
            })
          );
          const voteVerdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'VOTING',
              round: 1,
              errorClass,
              topic: text,
              candidate: sampleCandidate,
              admittedProofs: [sampleAuthProof],
              coveredSources: ['src/auth.js']
            })
          );

          for (const [label, verdict] of [
            ['R1_DELIBERATION', r1Verdict],
            ['R2_DELIBERATION', r2Verdict],
            ['JUDGE_AUDIT_SYNTHESIS', judgeVerdict],
            ['VOTING', voteVerdict]
          ]) {
            assert.equal(verdict.ready, false, `${label}/${errorClass} must refuse ${text}`);
            assert.equal(verdict.reasonCode, 'evidence_access_failure');
            assert.ok(
              verdict.missingDependencies.includes(expectedBroad[0]),
              `${label}/${errorClass}: expected missingDependencies to include ${expectedBroad[0]}, got ${JSON.stringify(verdict.missingDependencies)}`
            );
          }

          for (const phase of ['R1_DELIBERATION', 'R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING']) {
            const run = await runPhaseEngineCase({
              phase,
              errorClass,
              topic: text,
              coveredSources: ['src/auth.js']
            });
            assert.equal(run.targetCalls.length, 1, `${phase}/${errorClass} engine must refuse ${text}`);
          }
        }
      }

      for (const [pattern, expectedBroad] of [
        ['file[0-9].js', ['file[0-9].js']],
        ['[file[0-9].js].', ['file[0-9].js']],
        ['{foo,bar}.js', ['{foo,bar}.js']],
        ['app.{js,ts}', ['app.{js,ts}']],
        ['{Makefile,Dockerfile}', ['{Makefile,Dockerfile}']],
        ['file{1..3}.js', ['file{1..3}.js']],
        ['@(foo|bar).js', ['@(foo|bar).js']],
        ['file?.js', ['file?.js']],
        ['src/@(a,b|c)/', ['src/@(a,b|c)/']],
        ['foo/+(a,b)', ['foo/+(a,b)']],
        ['@(a,b|c).js', ['@(a,b|c).js']],
        ['(src/@(a,b|c)/,lib/@(d,e|f)/).', ['src/@(a,b|c)/', 'lib/@(d,e|f)/']]
      ]) {
        await assertTopicBroadVetoAllPhases(`Inspect src/auth.js and ${pattern}`, expectedBroad);
      }

      // Positive control across all 4 phases x 2 errors
      const posTopic = 'Inspect [src/auth.js] with seats[0].key, {foo,bar}, and [E1]/[E2].';
      for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
        for (const [label, verdict] of [
          ['R1_DELIBERATION', evaluateToolFreeEvidenceReadiness(makeReadinessParams({ phase: 'DELIBERATION', round: 1, errorClass, topic: posTopic, coveredSources: ['src/auth.js'] }))],
          ['R2_DELIBERATION', evaluateToolFreeEvidenceReadiness(makeReadinessParams({ phase: 'DELIBERATION', round: 2, errorClass, topic: posTopic, clarifications: [posTopic], priorProofs: [sampleAuthProof], previousCandidate: sampleCandidate, openObjections: sampleObjections, coveredSources: ['src/auth.js'] }))],
          ['JUDGE_AUDIT_SYNTHESIS', evaluateToolFreeEvidenceReadiness(makeReadinessParams({ phase: 'JUDGE_AUDIT_SYNTHESIS', round: 1, errorClass, topic: posTopic, proofs: [sampleAuthProof], coveredSources: ['src/auth.js'] }))],
          ['VOTING', evaluateToolFreeEvidenceReadiness(makeReadinessParams({ phase: 'VOTING', round: 1, errorClass, topic: posTopic, candidate: sampleCandidate, admittedProofs: [sampleAuthProof], coveredSources: ['src/auth.js'] }))]
        ]) {
          assert.equal(verdict.ready, true, `${label}/${errorClass} positive control must allow retry`);
        }
        for (const phase of ['R1_DELIBERATION', 'R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING']) {
          const run = await runPhaseEngineCase({
            phase,
            errorClass,
            topic: posTopic,
            coveredSources: ['src/auth.js']
          });
          assert.equal(run.targetCalls.length, 2, `${phase}/${errorClass} positive control must retry without tools`);
          assert.equal(run.targetCalls[1].tools, 'none');
          assert.equal(run.targetCalls[1].cwd, undefined);
        }
      }

      // 4. 48KB linear-time regression probes (<20ms)
      extractVerificationDependencies(['warmup src/{a,{b,c}}/ foo/[!]] file[0-9].js src/@(a,b|c)/']);
      for (const [label, payload] of [
        ['extglob-commas-48k', 'src/' + '@(a,b|'.repeat(6857) + 'c' + ')'.repeat(6857) + '/'],
        ['root-charclass-48k', '['.repeat(24000) + 'file[0-9].js' + ']'.repeat(24000)],
        ['root-nested-brace-48k', '{,'.repeat(16000) + 'foo' + '}'.repeat(16000) + '.js'],
        ['root-nested-extglob-48k', '@(|'.repeat(12000) + 'foo' + ')'.repeat(12000) + '.js']
      ]) {
        assert.ok(Buffer.byteLength(payload, 'utf8') >= 48000, `Expected >=48KB for ${label}`);
        const t0 = performance.now();
        const deps = extractVerificationDependencies([payload]);
        const elapsedMs = performance.now() - t0;
        assert.ok(elapsedMs < 20, `Expected <20ms for ${label}, got ${elapsedMs.toFixed(2)}ms`);
        assert.equal(deps.workspaceBroadDeps.length, 1, `Expected 1 broad dep for ${label}`);
      }

      for (const [label, payload] of [
        ['quoted-env-prefix-48k', '"' + 'A=1 '.repeat(12000) + '"'],
        ['quoted-wrappers-48k', '"' + 'command '.repeat(6000) + 'pattern"']
      ]) {
        assert.ok(Buffer.byteLength(payload, 'utf8') >= 48000, `Expected >=48KB for ${label}`);
        const qt0 = performance.now();
        const quoteVerdict = evaluateToolFreeEvidenceReadiness(
          makeReadinessParams({
            phase: 'JUDGE_AUDIT_SYNTHESIS',
            round: 1,
            errorClass: 'TimeoutError',
            proofs: [{ ...sampleAuthProof, kind: 'check', statement: payload }],
            coveredSources: ['src/auth.js']
          })
        );
        const quoteElapsedMs = performance.now() - qt0;
        assert.ok(quoteElapsedMs < 20, `Expected <20ms for ${label}, got ${quoteElapsedMs.toFixed(2)}ms`);
        assert.equal(quoteVerdict.ready, true);
      }
    });

    it('ReReview-102 Round 12 fixes: linear O(n) shell command scanner, R1/prose command vetoes, and order-independent root non-star globs', async () => {
      function makeReadinessParams({
        phase = 'DELIBERATION',
        round = 1,
        errorClass,
        topic = 'Inspect src/auth.js.',
        coveredSources = ['src/auth.js'],
        clarifications = [],
        proofs = [],
        priorProofs = [],
        previousCandidate = undefined,
        openObjections = [],
        candidate = undefined,
        admittedProofs = []
      }) {
        return {
          phase,
          round,
          errorClass,
          topic,
          clarifications,
          proofs,
          priorProofs,
          previousCandidate,
          openObjections,
          candidate,
          admittedProofs,
          evidence: coveredSources.map((source, i) => ({
            id: `E${i + 1}`,
            source,
            text: `complete snapshot for ${source}`
          })),
          selfContainedInput: {
            phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
            roundScope: 'all_rounds',
            coveredArtifacts: coveredSources.map((source, i) => ({
              source,
              evidenceId: `E${i + 1}`,
              coverage: 'complete_artifact'
            }))
          },
          originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo' }
        };
      }

      async function runPhaseEngineCase({
        phase,
        errorClass,
        topic,
        clarifications = [],
        s1Proof = null,
        coveredSources = ['src/auth.js']
      }) {
        const mock = new MockAdapter();
        const targetCalls = [];
        const origProof = mock.executeSeatProof.bind(mock);
        const origJudge = mock.executeJudgeAuditAndSynthesis.bind(mock);
        const origVote = mock.executeSeatVote.bind(mock);

        const makeFault = (participantId) =>
          errorClass === 'TimeoutError'
            ? new TimeoutError(`${phase} timeout`, { timeoutMs: 1000, harness: 'codex', seatId: participantId })
            : new HeadlessToolDeniedError(`${phase} tool denied`, {
                harness: 'codex',
                seatId: participantId,
                exitCode: 0,
                isRetryable: true
              });

        mock.executeSeatProof = async (ctx) => {
          if (phase === 'R1_DELIBERATION' && ctx.round === 1 && ctx.seat.id === 's1') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s1');
            }
          }
          if (phase === 'R2_DELIBERATION' && ctx.round === 2 && ctx.seat.id === 's2') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s2');
            }
          }
          if (ctx.round === 1 && ctx.seat.id === 's1' && s1Proof) {
            return s1Proof;
          }
          return origProof(ctx);
        };

        mock.executeJudgeAuditAndSynthesis = async (ctx) => {
          if (phase === 'JUDGE_AUDIT_SYNTHESIS' && ctx.round === 1) {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('judge');
            }
          }
          return origJudge(ctx);
        };

        mock.executeSeatVote = async (ctx) => {
          if (phase === 'VOTING' && ctx.round === 1 && ctx.seat.id === 's1') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s1');
            }
          }
          if (phase === 'R2_DELIBERATION' && ctx.round === 1 && ctx.seat.id === 's2') {
            return { vote: 'object', proofId: 'P1', reason: 'Dispute R1 proof in R2' };
          }
          return origVote(ctx);
        };

        const engine = new CouncilEngine(
          {
            topic,
            clarifications,
            maxClarificationBatches: clarifications.length,
            minQuorum: 2,
            maxRounds: phase === 'R2_DELIBERATION' ? 2 : 1,
            maxRetriesPerSeat: 1,
            maxRetriesPerJudge: 1,
            cwd: '/repo',
            evidence: coveredSources.map((source, i) => ({
              id: `E${i + 1}`,
              label: `Artifact ${i + 1}`,
              source,
              text: `complete snapshot for ${source}`
            })),
            selfContainedInput: {
              kind: 'full_context',
              label: 'Round 12 regression matrix',
              phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
              roundScope: 'all_rounds',
              coveredArtifacts: coveredSources.map((source, i) => ({
                source,
                evidenceId: `E${i + 1}`,
                coverage: 'complete_artifact'
              }))
            },
            judge: { id: 'judge', harness: 'codex', model: 'gpt-6-astra (high)', tools: 'read-only', cwd: '/repo' },
            seats: [
              {
                id: 's1',
                harness: 'codex',
                model: 'gpt-6-astra (high)',
                soul: 'S1',
                tools: 'read-only',
                votingTools: 'read-only',
                cwd: '/repo'
              },
              { id: 's2', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S2', tools: 'read-only', cwd: '/repo' },
              { id: 's3', harness: 'cursor', model: 'grok-4', soul: 'S3', tools: 'none' }
            ]
          },
          { harnessResolver: () => mock }
        );

        await engine.run();
        return { engine, targetCalls };
      }

      const sampleAuthProof = {
        id: 'P1',
        round: 1,
        seatId: 's1',
        status: 'admitted',
        scope: 'Auth check',
        kind: 'code',
        source: 'src/auth.js',
        statement: 'Auth contract verified in src/auth.js.'
      };
      const sampleCandidate = {
        summary: 'R1 candidate',
        clauses: [{ id: 'C1', context: 'c', conclusion: 'k', citedProofIds: ['P1'] }]
      };
      const sampleObjections = [{ id: 'O1', seatId: 's2', targetProofId: 'P1', reason: 'Re-check claim' }];

      async function assertCheckProofBehavior({ source, statement, coveredSources, shouldAllow, label }) {
        const proof = {
          id: 'P1',
          round: 1,
          seatId: 's1',
          status: 'admitted',
          scope: 'File check',
          kind: 'check',
          source,
          statement
        };

        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          const r2Verdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'DELIBERATION',
              round: 2,
              errorClass,
              priorProofs: [proof],
              previousCandidate: sampleCandidate,
              openObjections: sampleObjections,
              coveredSources
            })
          );
          const judgeVerdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'JUDGE_AUDIT_SYNTHESIS',
              round: 1,
              errorClass,
              proofs: [proof],
              coveredSources
            })
          );
          const voteVerdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'VOTING',
              round: 1,
              errorClass,
              candidate: sampleCandidate,
              admittedProofs: [proof],
              coveredSources
            })
          );

          for (const [phaseLabel, verdict] of [
            ['R2_DELIBERATION', r2Verdict],
            ['JUDGE_AUDIT_SYNTHESIS', judgeVerdict],
            ['VOTING', voteVerdict]
          ]) {
            assert.equal(verdict.ready, shouldAllow, `${label}: ${phaseLabel}/${errorClass} ready mismatch`);
          }

          for (const phase of ['R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING']) {
            const run = await runPhaseEngineCase({
              phase,
              errorClass,
              topic: 'Inspect src/auth.js.',
              s1Proof: {
                scope: 'File check',
                kind: 'check',
                source,
                statement
              },
              coveredSources
            });
            if (shouldAllow) {
              assert.equal(run.targetCalls.length, 2, `${label}: ${phase}/${errorClass} must permit tool-free retry`);
              assert.equal(run.targetCalls[1].tools, 'none');
              assert.equal(run.targetCalls[1].cwd, undefined);
            } else {
              assert.equal(run.targetCalls.length, 1, `${label}: ${phase}/${errorClass} must refuse tool-free retry`);
            }
          }
        }
      }

      async function assertTopicBroadVetoAllPhases(text, expectedBroad = null) {
        const deps = extractVerificationDependencies([text]);
        assert.ok(deps.workspaceBroadDeps.length >= 1, `Expected broad deps for: ${text}`);
        if (expectedBroad) {
          assert.deepEqual(deps.workspaceBroadDeps, expectedBroad, `Expected broad deps ${JSON.stringify(expectedBroad)} for: ${text}`);
        }

        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          const r1Verdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({ phase: 'DELIBERATION', round: 1, errorClass, topic: text, coveredSources: ['src/auth.js'] })
          );
          const r2Verdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'DELIBERATION',
              round: 2,
              errorClass,
              topic: text,
              clarifications: [text],
              priorProofs: [sampleAuthProof],
              previousCandidate: sampleCandidate,
              openObjections: sampleObjections,
              coveredSources: ['src/auth.js']
            })
          );
          const judgeVerdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'JUDGE_AUDIT_SYNTHESIS',
              round: 1,
              errorClass,
              topic: text,
              proofs: [sampleAuthProof],
              coveredSources: ['src/auth.js']
            })
          );
          const voteVerdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'VOTING',
              round: 1,
              errorClass,
              topic: text,
              candidate: sampleCandidate,
              admittedProofs: [sampleAuthProof],
              coveredSources: ['src/auth.js']
            })
          );

          for (const [label, verdict] of [
            ['R1_DELIBERATION', r1Verdict],
            ['R2_DELIBERATION', r2Verdict],
            ['JUDGE_AUDIT_SYNTHESIS', judgeVerdict],
            ['VOTING', voteVerdict]
          ]) {
            assert.equal(verdict.ready, false, `${label}/${errorClass} must refuse ${text}`);
            assert.equal(verdict.reasonCode, 'evidence_access_failure');
            if (expectedBroad) {
              assert.ok(
                verdict.missingDependencies.includes(expectedBroad[0]),
                `${label}/${errorClass}: expected missingDependencies to include ${expectedBroad[0]}, got ${JSON.stringify(verdict.missingDependencies)}`
              );
            } else {
              assert.ok(verdict.missingDependencies.length >= 1, `${label}/${errorClass} must list missing dependency`);
            }
          }

          for (const phase of ['R1_DELIBERATION', 'R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING']) {
            const run = await runPhaseEngineCase({
              phase,
              errorClass,
              topic: text,
              coveredSources: ['src/auth.js']
            });
            assert.equal(run.targetCalls.length, 1, `${phase}/${errorClass} engine must refuse ${text}`);
          }
        }
      }

      // Warmup JIT paths before 48KB latency checks
      extractVerificationDependencies(['Inspect {notes,Makefile} and [a-z] and "CI=1 npm test"']);
      evaluateToolFreeEvidenceReadiness(
        makeReadinessParams({
          phase: 'JUDGE_AUDIT_SYNTHESIS',
          round: 1,
          errorClass: 'TimeoutError',
          proofs: [{ ...sampleAuthProof, kind: 'check', statement: 'Checked "CI=1 npm test" output.' }],
          coveredSources: ['src/auth.js']
        })
      );

      // 1. Finding 1: 48KB linear-time regression probes (<20ms, no ReDoS / stack overflow)
      const backslash40 = 'Checked "' + 'A=' + '\\'.repeat(40) + '" output.';
      const t40 = performance.now();
      const v40 = evaluateToolFreeEvidenceReadiness(
        makeReadinessParams({
          phase: 'JUDGE_AUDIT_SYNTHESIS',
          round: 1,
          errorClass: 'TimeoutError',
          proofs: [{ ...sampleAuthProof, kind: 'check', statement: backslash40 }],
          coveredSources: ['src/auth.js']
        })
      );
      assert.ok(performance.now() - t40 < 20, 'Expected <20ms for env-backslash-40');
      assert.equal(v40.ready, true);

      for (const [label, stmt, expectReady] of [
        ['env-backslash-48k', 'Checked "' + 'A=' + '\\'.repeat(48000) + '" output.', true],
        ['env-assign-repeat-48k', 'a='.repeat(24000), true],
        ['command-repeat-48k', '"' + 'command '.repeat(6000) + 'pattern"', true],
        ['dollar-paren-unclosed-48k', '$('.repeat(24000), true],
        ['nested-subshell-12000', 'Checked "' + '$(a '.repeat(12000) + 'b' + ')'.repeat(12000) + '" output.', true],
        ['nested-subshell-cmd-hit', 'Checked "' + '$(a '.repeat(500) + '$(uname -a)' + ')'.repeat(500) + '" output.', false],
        ['redir-spaces-48k', '<' + ' '.repeat(48000), true],
        ['concat-quotes-48k', 'Checked ' + 'a"b"'.repeat(12000) + ' output.', true],
        ['script-semi-48k', './src/auth.js;'.repeat(4000), true]
      ]) {
        if (label !== 'nested-subshell-cmd-hit') {
          assert.ok(Buffer.byteLength(stmt, 'utf8') >= 48000, `Expected >=48KB for ${label}`);
        }
        const t0 = performance.now();
        const verdict = evaluateToolFreeEvidenceReadiness(
          makeReadinessParams({
            phase: 'JUDGE_AUDIT_SYNTHESIS',
            round: 1,
            errorClass: 'TimeoutError',
            proofs: [{ ...sampleAuthProof, kind: 'check', statement: stmt }],
            coveredSources: ['src/auth.js']
          })
        );
        const elapsed = performance.now() - t0;
        assert.ok(elapsed < 20, `Expected <20ms for ${label}, got ${elapsed.toFixed(2)}ms`);
        assert.equal(verdict.ready, expectReady, `Unexpected readiness for ${label}`);
      }

      for (const [label, topicText, expectHit] of [
        ['topic-env-assign-48k', 'Inspect src/auth.js ' + 'a='.repeat(24000), false],
        ['topic-dollar-paren-48k', 'Inspect src/auth.js ' + '$('.repeat(24000), false],
        ['topic-char-class-48k', 'Inspect ' + '[a-z.]'.repeat(8000), true],
        ['topic-char-class-miss-48k', 'Inspect ' + '[0-9_]'.repeat(10000), false],
        ['topic-alt-char-class-48k', 'Inspect ' + '[0-9][a-f]'.repeat(5000), false],
        ['topic-redir-spaces-48k', 'Inspect src/auth.js <' + ' '.repeat(48000), false],
        ['topic-5000-alt-brace', 'Inspect {' + Array.from({ length: 5000 }, (_, i) => `a${i}`).join(',') + ',Makefile}', true]
      ]) {
        const t0 = performance.now();
        const deps = extractVerificationDependencies([topicText]);
        const elapsed = performance.now() - t0;
        assert.ok(elapsed < 20, `Expected <20ms for ${label}, got ${elapsed.toFixed(2)}ms`);
        if (expectHit) {
          assert.equal(deps.workspaceBroadDeps.length, 1, `Expected broad dep for ${label}`);
        } else {
          assert.deepEqual(deps.workspaceBroadDeps, [], `Expected no broad deps for ${label}`);
        }
      }

      // 2. Finding 2: quoted/escaped executables, leading redirections, wrapper argument flags, & nested command substitutions
      for (const badStmt of [
        'Checked "npm" test output.',
        '"npm" test',
        'Verified "\\"npm\\" test" output.',
        'Verified "n\\pm test" output.',
        "Verified n'pm' test output.",
        'Verified "echo \\`uname -a\\`" output.',
        "Verified 'np''m' test output.",
        'Verified "< src/auth.js wc -l" output.',
        '< src/auth.js wc -l',
        '2>/dev/null cat README',
        'Verified "exec -a tag npm test" output.',
        'Verified "env -C dir -u FOO npm test" output.',
        'Verified "stdbuf -o0 python3 app.py" output.',
        'Verified "timeout -k 5s 10 cargo test" output.',
        'Verified "nice -n 10 make test" output.',
        'Verified "sudo -u root bash -c ls" output.',
        'Verified "$(echo $(uname -a))" output.',
        'Verified "$(printf \'%s\' \\"$(git rev-parse HEAD)\\")" output.'
      ]) {
        await assertCheckProofBehavior({
          source: 'src/auth.js',
          statement: badStmt,
          coveredSources: ['src/auth.js', 'README'],
          shouldAllow: false,
          label: `Finding 2 command statement (${badStmt})`
        });
      }

      for (const goodStmt of [
        'Keys " npm " and " cargo " and " didn\'t fail on users\' roles " are valid.',
        'Property "exec" and key "env" in config.json matched "checkTokenExpiry()".',
        'Notes <section> and >quote do not invoke shell commands.',
        'Use "cat.md" and "make" key names safely.'
      ]) {
        await assertCheckProofBehavior({
          source: 'src/auth.js',
          statement: goodStmt,
          coveredSources: ['src/auth.js', 'README', 'cat.md', 'config.json'],
          shouldAllow: true,
          label: `Finding 2 prose control (${goodStmt})`
        });
      }

      // 3. Finding 3: order-independent root non-star globs across char classes, braces, and extglobs
      for (const [text, expectedBroad] of [
        ['Inspect src/auth.js and {notes,Makefile}', ['{notes,Makefile}']],
        ['Inspect src/auth.js and {Makefile,notes}', ['{Makefile,notes}']],
        ['Inspect src/auth.js and @(notes|Makefile)', ['@(notes|Makefile)']],
        ['Inspect src/auth.js and @(Makefile|notes)', ['@(Makefile|notes)']],
        ['Inspect src/auth.js and +(notes|Makefile)', ['+(notes|Makefile)']],
        ['Inspect src/auth.js and ?(notes|Makefile)', ['?(notes|Makefile)']],
        ['Inspect src/auth.js and !(notes|Makefile)', ['!(notes|Makefile)']],
        ['Inspect src/auth.js and *(notes|Makefile)', ['*(notes|Makefile)']],
        ['Inspect src/auth.js and file.[a-c]', ['file.[a-c]']],
        ['Inspect src/auth.js and file.{txt,js}', ['file.{txt,js}']],
        ['Inspect src/auth.js and {.gitignore,notes}', ['{.gitignore,notes}']],
        ['Inspect src/auth.js and {notes,.env.local}', ['{notes,.env.local}']],
        ['Inspect src/auth.js and {notes,.eslintrc.js}', ['{notes,.eslintrc.js}']],
        ['Inspect src/auth.js and {notes,CMakeLists}', ['{notes,CMakeLists}']]
      ]) {
        const deps = extractVerificationDependencies([text]);
        assert.deepEqual(
          deps,
          {
            workspaceFileDeps: [{ source: 'src/auth.js', unbounded: true }],
            workspaceBroadDeps: expectedBroad,
            externalDeps: []
          },
          `Finding 3 order-independent root glob mismatch on: ${text}`
        );
      }

      for (const [text, expectedBroad] of [
        ['Inspect src/auth.js and {notes,Makefile}', ['{notes,Makefile}']],
        ['Inspect src/auth.js and @(notes|Makefile)', ['@(notes|Makefile)']],
        ['Inspect src/auth.js and !(notes|Makefile)', ['!(notes|Makefile)']],
        ['Inspect src/auth.js and *(notes|Makefile)', ['*(notes|Makefile)']],
        ['Inspect src/auth.js and file.[a-c]', ['file.[a-c]']]
      ]) {
        await assertTopicBroadVetoAllPhases(text, expectedBroad);
      }

      for (const benignTopic of [
        'Inspect src/auth.js and {notes,summary}.',
        'Inspect src/auth.js and @(alpha|beta).',
        'Inspect src/auth.js and !(valid).',
        'Inspect src/auth.js and *(note)*.',
        'Inspect src/auth.js and **[E1]**.',
        'Inspect src/auth.js and v1.[0-9].'
      ]) {
        const deps = extractVerificationDependencies([benignTopic]);
        assert.deepEqual(deps.workspaceBroadDeps, [], `Expected no broad deps for benign topic: ${benignTopic}`);
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          const verdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({ phase: 'DELIBERATION', round: 1, errorClass, topic: benignTopic, coveredSources: ['src/auth.js'] })
          );
          assert.equal(verdict.ready, true, `Expected ready for benign topic (${errorClass}): ${benignTopic}`);
        }
      }

      // 4. Finding 4: R1 topic & clarification command vetoes + R1 positive controls
      for (const cmdTopic of [
        'Inspect src/auth.js and verify "CI=1 npm test" output.',
        'Inspect src/auth.js and verify "npm" test output.',
        'Inspect src/auth.js and verify "`npm test`" output.',
        'Inspect src/auth.js and verify "echo \\`uname -a\\`" output.',
        'Inspect src/auth.js and run < src/auth.js wc -l.',
        'Inspect src/auth.js and verify "exec -a tag npm test" output.',
        'Inspect src/auth.js and evaluate "$(echo $(uname -a))".',
        'Inspect src/auth.js and run `npm test`.'
      ]) {
        await assertTopicBroadVetoAllPhases(cmdTopic);
      }

      for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
        const r1ClarifyVerdict = evaluateToolFreeEvidenceReadiness(
          makeReadinessParams({
            phase: 'DELIBERATION',
            round: 1,
            errorClass,
            topic: 'Inspect src/auth.js.',
            clarifications: ['Also verify "CI=1 npm test" output.'],
            coveredSources: ['src/auth.js']
          })
        );
        assert.equal(r1ClarifyVerdict.ready, false, `R1 clarification command must veto (${errorClass})`);
        assert.equal(r1ClarifyVerdict.reasonCode, 'evidence_access_failure');

        const clarifyRun = await runPhaseEngineCase({
          phase: 'R1_DELIBERATION',
          errorClass,
          topic: 'Inspect src/auth.js.',
          clarifications: ['Also verify "CI=1 npm test" output.'],
          coveredSources: ['src/auth.js']
        });
        assert.equal(clarifyRun.targetCalls.length, 1, `R1 clarification command engine must refuse (${errorClass})`);
      }

      for (const safeR1Topic of [
        'Inspect `src/auth.js` and `checkTokenExpiry()` for token expiry.',
        'Inspect src/auth.js and verify keys " npm ", " cargo ", and " make sure " logic.',
        'Inspect src/auth.js and verify "the `id` and `checkTokenExpiry()` helpers" logic.',
        'Smoke check fallback flag on src/auth.js.'
      ]) {
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          const r1Verdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'DELIBERATION',
              round: 1,
              errorClass,
              topic: safeR1Topic,
              coveredSources: ['src/auth.js']
            })
          );
          assert.equal(r1Verdict.ready, true, `Safe R1 topic must stay allowed (${errorClass}): ${safeR1Topic}`);

          const run = await runPhaseEngineCase({
            phase: 'R1_DELIBERATION',
            errorClass,
            topic: safeR1Topic,
            coveredSources: ['src/auth.js']
          });
          assert.equal(run.targetCalls.length, 2, `Safe R1 topic engine must permit retry (${errorClass}): ${safeR1Topic}`);
          assert.equal(run.targetCalls[1].tools, 'none');
          assert.equal(run.targetCalls[1].cwd, undefined);
        }
      }
    });

    it('ReReview-102 Round 13 fixes: enforces O(n) command dedup, quoted command arguments, per-node glob repeat budget, full POSIX classes, and cross-phase clarifications', async () => {
      function makeReadinessParams({
        phase = 'DELIBERATION',
        round = 1,
        errorClass,
        topic = 'Inspect src/auth.js.',
        coveredSources = ['src/auth.js'],
        clarifications = [],
        proofs = [],
        priorProofs = [],
        previousCandidate = undefined,
        openObjections = [],
        candidate = undefined,
        admittedProofs = []
      }) {
        return {
          phase,
          round,
          errorClass,
          topic,
          clarifications,
          proofs,
          priorProofs,
          previousCandidate,
          openObjections,
          candidate,
          admittedProofs,
          evidence: coveredSources.map((source, i) => ({
            id: `E${i + 1}`,
            source,
            text: `complete snapshot for ${source}`
          })),
          selfContainedInput: {
            phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
            roundScope: 'all_rounds',
            coveredArtifacts: coveredSources.map((source, i) => ({
              source,
              evidenceId: `E${i + 1}`,
              coverage: 'complete_artifact'
            }))
          },
          originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo' }
        };
      }

      async function runPhaseEngineCase({
        phase,
        errorClass,
        topic,
        clarifications = [],
        s1Proof = null,
        coveredSources = ['src/auth.js']
      }) {
        const mock = new MockAdapter();
        const targetCalls = [];
        const origProof = mock.executeSeatProof.bind(mock);
        const origJudge = mock.executeJudgeAuditAndSynthesis.bind(mock);
        const origVote = mock.executeSeatVote.bind(mock);

        const makeFault = (participantId) =>
          errorClass === 'TimeoutError'
            ? new TimeoutError(`${phase} timeout`, { timeoutMs: 1000, harness: 'codex', seatId: participantId })
            : new HeadlessToolDeniedError(`${phase} tool denied`, {
                harness: 'codex',
                seatId: participantId,
                exitCode: 0,
                isRetryable: true
              });

        mock.executeSeatProof = async (ctx) => {
          if (phase === 'R1_DELIBERATION' && ctx.round === 1 && ctx.seat.id === 's1') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s1');
            }
          }
          if (phase === 'R2_DELIBERATION' && ctx.round === 2 && ctx.seat.id === 's2') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s2');
            }
          }
          if (ctx.round === 1 && ctx.seat.id === 's1' && s1Proof) {
            return s1Proof;
          }
          return origProof(ctx);
        };

        mock.executeJudgeAuditAndSynthesis = async (ctx) => {
          if (phase === 'JUDGE_AUDIT_SYNTHESIS' && ctx.round === 1) {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('judge');
            }
          }
          return origJudge(ctx);
        };

        mock.executeSeatVote = async (ctx) => {
          if (phase === 'VOTING' && ctx.round === 1 && ctx.seat.id === 's1') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s1');
            }
          }
          if (phase === 'R2_DELIBERATION' && ctx.round === 1 && ctx.seat.id === 's2') {
            return { vote: 'object', proofId: 'P1', reason: 'Dispute R1 proof in R2' };
          }
          return origVote(ctx);
        };

        const engine = new CouncilEngine(
          {
            topic,
            clarifications,
            maxClarificationBatches: clarifications.length,
            minQuorum: 2,
            maxRounds: phase === 'R2_DELIBERATION' ? 2 : 1,
            maxRetriesPerSeat: 1,
            maxRetriesPerJudge: 1,
            cwd: '/repo',
            evidence: coveredSources.map((source, i) => ({
              id: `E${i + 1}`,
              label: `Artifact ${i + 1}`,
              source,
              text: `complete snapshot for ${source}`
            })),
            selfContainedInput: {
              kind: 'full_context',
              label: 'Round 14 regression matrix',
              phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
              roundScope: 'all_rounds',
              coveredArtifacts: coveredSources.map((source, i) => ({
                source,
                evidenceId: `E${i + 1}`,
                coverage: 'complete_artifact'
              }))
            },
            judge: { id: 'judge', harness: 'codex', model: 'gpt-6-astra (high)', tools: 'read-only', cwd: '/repo' },
            seats: [
              {
                id: 's1',
                harness: 'codex',
                model: 'gpt-6-astra (high)',
                soul: 'S1',
                tools: 'read-only',
                votingTools: 'read-only',
                cwd: '/repo'
              },
              { id: 's2', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S2', tools: 'read-only', cwd: '/repo' },
              { id: 's3', harness: 'cursor', model: 'grok-4', soul: 'S3', tools: 'none' }
            ]
          },
          { harnessResolver: () => mock }
        );

        await engine.run();
        return { engine, targetCalls };
      }

      const sampleAuthProof = {
        id: 'P1',
        round: 1,
        seatId: 's1',
        status: 'admitted',
        scope: 'Auth check',
        kind: 'code',
        source: 'src/auth.js',
        statement: 'Auth contract verified in src/auth.js.'
      };
      const sampleCandidate = {
        summary: 'R1 candidate',
        clauses: [{ id: 'C1', context: 'c', conclusion: 'k', citedProofIds: ['P1'] }]
      };
      const sampleObjections = [{ id: 'O1', seatId: 's2', proofId: 'P1', reason: 'Re-check claim' }];

      async function assertVetoAllPhases({
        topic = 'Inspect src/auth.js.',
        clarifications = [],
        coveredSources = ['src/auth.js'],
        label
      }) {
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          const r1Verdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({ phase: 'DELIBERATION', round: 1, errorClass, topic, clarifications, coveredSources })
          );
          const r2Verdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'DELIBERATION',
              round: 2,
              errorClass,
              topic,
              clarifications,
              priorProofs: [sampleAuthProof],
              previousCandidate: sampleCandidate,
              openObjections: sampleObjections,
              coveredSources
            })
          );
          const judgeVerdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'JUDGE_AUDIT_SYNTHESIS',
              round: 1,
              errorClass,
              topic,
              clarifications,
              proofs: [sampleAuthProof],
              coveredSources
            })
          );
          const voteVerdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'VOTING',
              round: 1,
              errorClass,
              topic,
              clarifications,
              candidate: sampleCandidate,
              admittedProofs: [sampleAuthProof],
              coveredSources
            })
          );

          for (const [phaseLabel, verdict] of [
            ['R1_DELIBERATION', r1Verdict],
            ['R2_DELIBERATION', r2Verdict],
            ['JUDGE_AUDIT_SYNTHESIS', judgeVerdict],
            ['VOTING', voteVerdict]
          ]) {
            assert.equal(verdict.ready, false, `${label}: ${phaseLabel}/${errorClass} must refuse`);
            assert.equal(verdict.reasonCode, 'evidence_access_failure');
          }

          for (const phase of ['R1_DELIBERATION', 'R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING']) {
            const run = await runPhaseEngineCase({
              phase,
              errorClass,
              topic,
              clarifications,
              coveredSources
            });
            assert.equal(run.targetCalls.length, 1, `${label}: ${phase}/${errorClass} engine must refuse`);
          }
        }
      }

      async function assertCheckProofVetoAllPhases({ source, statement, coveredSources, shouldAllow, label }) {
        const proof = {
          id: 'P1',
          round: 1,
          seatId: 's1',
          status: 'admitted',
          scope: 'File check',
          kind: 'check',
          source,
          statement
        };
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          const r2Verdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'DELIBERATION',
              round: 2,
              errorClass,
              priorProofs: [proof],
              previousCandidate: sampleCandidate,
              openObjections: sampleObjections,
              coveredSources
            })
          );
          const judgeVerdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'JUDGE_AUDIT_SYNTHESIS',
              round: 1,
              errorClass,
              proofs: [proof],
              coveredSources
            })
          );
          const voteVerdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'VOTING',
              round: 1,
              errorClass,
              candidate: sampleCandidate,
              admittedProofs: [proof],
              coveredSources
            })
          );
          for (const [phaseLabel, verdict] of [
            ['R2_DELIBERATION', r2Verdict],
            ['JUDGE_AUDIT_SYNTHESIS', judgeVerdict],
            ['VOTING', voteVerdict]
          ]) {
            assert.equal(verdict.ready, shouldAllow, `${label}: ${phaseLabel}/${errorClass} ready mismatch`);
          }

          for (const phase of ['R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING']) {
            const run = await runPhaseEngineCase({
              phase,
              errorClass,
              topic: 'Inspect src/auth.js.',
              s1Proof: { scope: 'File check', kind: 'check', source, statement },
              coveredSources
            });
            if (shouldAllow) {
              assert.equal(run.targetCalls.length, 2, `${label}: ${phase}/${errorClass} must permit retry`);
              assert.equal(run.targetCalls[1].tools, 'none');
              assert.equal(run.targetCalls[1].cwd, undefined);
            } else {
              assert.equal(run.targetCalls.length, 1, `${label}: ${phase}/${errorClass} must refuse retry`);
            }
          }
        }
      }

      // Warmup
      extractVerificationDependencies(['"ls 0000" npm "test" src/auth.js @(a|+(M|a|k|e|f|i|l)) file.[[:print:]]']);

      // 1. Finding 1: Linear O(n) command & file deduplication (<20ms at >=48KB)
      const distinctQuotedCmds48k =
        Array.from({ length: 4800 }, (_, i) => `"ls ${String(i).padStart(4, '0')}"`).join(' ') + ' ';
      assert.equal(Buffer.byteLength(distinctQuotedCmds48k, 'utf8'), 48000);
      const tCmdQ = performance.now();
      const quotedCmdDeps = extractVerificationDependencies([distinctQuotedCmds48k]);
      const elapsedCmdQ = performance.now() - tCmdQ;
      assert.ok(elapsedCmdQ < 20, `Expected <20ms for 48KB distinct quoted commands, got ${elapsedCmdQ.toFixed(2)}ms`);
      assert.equal(quotedCmdDeps.workspaceBroadDeps.length, 4800);

      const compoundCmds48k = Array.from({ length: 4800 }, (_, i) => `ls -a${String(i).padStart(4, '0')};`).join(' ');
      assert.ok(Buffer.byteLength(compoundCmds48k, 'utf8') >= 48000);
      const tCmdU = performance.now();
      const unquotedCmdDeps = extractVerificationDependencies([compoundCmds48k]);
      const elapsedCmdU = performance.now() - tCmdU;
      assert.ok(elapsedCmdU < 20, `Expected <20ms for >=48KB distinct compound commands, got ${elapsedCmdU.toFixed(2)}ms`);
      assert.equal(unquotedCmdDeps.workspaceBroadDeps.length, 4800);

      const distinctFiles48k = 'Inspect ' + Array.from({ length: 4800 }, (_, i) => `src/f${i}.js`).join(' ');
      assert.ok(Buffer.byteLength(distinctFiles48k, 'utf8') >= 48000);
      const tFiles = performance.now();
      const fileDeps = extractVerificationDependencies([distinctFiles48k]);
      const elapsedFiles = performance.now() - tFiles;
      assert.ok(elapsedFiles < 20, `Expected <20ms for >=48KB distinct workspace files, got ${elapsedFiles.toFixed(2)}ms`);
      assert.equal(fileDeps.workspaceFileDeps.length, 4800);

      // 2. Finding 2: Quoted/split-quoted/escaped command arguments, wrappers, redirections, & positive controls
      const quotedArgTopics = [
        'Inspect src/auth.js. npm "test"',
        "Inspect src/auth.js. npm 'test'",
        'Inspect src/auth.js and npm te"st"',
        'Inspect src/auth.js and "npm" "test"',
        'Inspect src/auth.js and git "status"',
        'Inspect src/auth.js and make "test"',
        'Inspect src/auth.js and go "test"',
        'Inspect src/auth.js and env "CI=1" npm "test"',
        'Inspect src/auth.js and "CI=1" npm "test"',
        'Inspect src/auth.js and < "src/auth.js" wc "-l"',
        'Inspect src/auth.js and bash "-c" "echo hi"',
        'Inspect src/auth.js and grep "expiry" src/auth.js',
        'Inspect src/auth.js and cat "README"',
        'Inspect src/auth.js and $(npm "test")'
      ];
      for (const topic of quotedArgTopics) {
        const deps = extractVerificationDependencies([topic]);
        assert.ok(deps.workspaceBroadDeps.length >= 1, `Expected broad command veto for topic: ${topic}`);
        await assertVetoAllPhases({
          topic,
          coveredSources: ['src/auth.js', 'README'],
          label: `Finding 2 topic (${topic})`
        });
      }

      for (const checkSpec of [
        { source: 'npm "test"', statement: 'Tests pass.' },
        { source: "npm 'test'", statement: 'Tests pass.' },
        { source: 'src/auth.js', statement: 'Verified npm "test" output.' },
        { source: 'src/auth.js', statement: "Verified git 'rev-parse' HEAD output." },
        { source: 'src/auth.js', statement: 'Verified env "CI=1" "npm" "test" output.' },
        { source: 'src/auth.js', statement: 'Verified < "src/auth.js" wc "-l" output.' }
      ]) {
        await assertCheckProofVetoAllPhases({
          ...checkSpec,
          coveredSources: ['src/auth.js'],
          shouldAllow: false,
          label: `Finding 2 check (${checkSpec.source} | ${checkSpec.statement})`
        });
      }

      const safeProseControls = [
        'Inspect src/auth.js: each node validates token expiry and git history concepts; at the same time make sure package.json npm "exports" field is preserved.',
        'Inspect src/auth.js. Imports "node:fs" and keys "cat", "node", "git", "sh", "make", "env" in src/auth.js are valid.',
        'Inspect src/auth.js. Property "exec" and key "env" in config.json matched "checkTokenExpiry()".',
        'Inspect src/auth.js. Target Node >= 22, node > 22, python < 3.12, and git -> main or node => callback are valid.'
      ];
      for (const safeTopic of safeProseControls) {
        const deps = extractVerificationDependencies([safeTopic]);
        assert.deepEqual(deps.workspaceBroadDeps, [], `Expected 0 broad deps for prose control: ${safeTopic}`);
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          const verdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'DELIBERATION',
              round: 1,
              errorClass,
              topic: safeTopic,
              coveredSources: ['src/auth.js', 'package.json', 'config.json']
            })
          );
          assert.equal(verdict.ready, true, `Expected ready=true for safe prose control (${errorClass}): ${safeTopic}`);
        }
      }

      // 3. Finding 3: Per-node glob repeat budget & associative flattening
      const leaf = '+(M|a|k|e|f|i|l)';
      const padding64 = Array(64).fill('+(a)');
      const late64 = '@(' + [...padding64, leaf].join('|') + ')';
      const first64 = '@(' + [leaf, ...padding64].join('|') + ')';
      assert.equal(extractVerificationDependencies([late64]).workspaceBroadDeps.length, 1);
      assert.equal(extractVerificationDependencies([first64]).workspaceBroadDeps.length, 1);

      await assertVetoAllPhases({ topic: `Inspect src/auth.js and ${late64}`, label: 'Finding 3 late64' });
      await assertVetoAllPhases({ topic: `Inspect src/auth.js and ${first64}`, label: 'Finding 3 first64' });

      const late500 = '@(' + [...Array(500).fill('+(a)'), leaf].join('|') + ')';
      const deepNestedLeaf = '+(+(+(+(+(+(M|a|k|e|f|i|l))))))';
      for (const [label, pattern] of [
        ['late-500-alt-extglob', late500],
        ['deep-nested-plus-leaf', deepNestedLeaf]
      ]) {
        const t0 = performance.now();
        const deps = extractVerificationDependencies([pattern]);
        const elapsed = performance.now() - t0;
        assert.ok(elapsed < 20, `Expected <20ms for ${label}, got ${elapsed.toFixed(2)}ms`);
        assert.deepEqual(deps.workspaceBroadDeps, [pattern], `Expected 1 broad dep for ${label}`);
      }

      // 4. Finding 4: Full POSIX character classes
      for (const posixGlob of [
        'file.[[:print:]]',
        'file.[[:graph:]]',
        'file.[[:ascii:]]',
        'file.[[:alpha:]]',
        'file.[[:alnum:]]',
        'file.[[:lower:]]',
        'file.[[:word:]]',
        'file.[[:xdigit:]]',
        'file.[![:cntrl:]]',
        'file.[![:digit:]]',
        '[[:punct:]]env',
        'src/file.[[:space:]]'
      ]) {
        const deps = extractVerificationDependencies([`Inspect src/auth.js and ${posixGlob}`]);
        assert.deepEqual(deps.workspaceBroadDeps, [posixGlob], `Expected broad dep for POSIX glob ${posixGlob}`);
      }
      await assertVetoAllPhases({ topic: 'Inspect src/auth.js and file.[[:print:]]', label: 'Finding 4 [:print:]' });
      await assertVetoAllPhases({ topic: 'Inspect src/auth.js and file.[[:graph:]]', label: 'Finding 4 [:graph:]' });

      for (const benignPosixTopic of [
        'Inspect src/auth.js and file.[[:cntrl:]]',
        'Inspect src/auth.js and file.[[:unknown:]]'
      ]) {
        const deps = extractVerificationDependencies([benignPosixTopic]);
        assert.deepEqual(deps.workspaceBroadDeps, [], `Expected 0 broad deps for benign POSIX case: ${benignPosixTopic}`);
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          const verdict = evaluateToolFreeEvidenceReadiness(
            makeReadinessParams({
              phase: 'DELIBERATION',
              round: 1,
              errorClass,
              topic: benignPosixTopic,
              coveredSources: ['src/auth.js']
            })
          );
          assert.equal(verdict.ready, true, `Expected ready=true for ${benignPosixTopic} (${errorClass})`);
        }
      }

      // 5. Finding 5: Broadcast clarifications across Deliberation, Judge, and Voting
      await assertVetoAllPhases({
        topic: 'Inspect src/auth.js.',
        clarifications: [{ answer: 'Verify "CI=1 npm test" output.' }],
        label: 'Finding 5 clarification command'
      });

      for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
        const judgeMissingFile = evaluateToolFreeEvidenceReadiness(
          makeReadinessParams({
            phase: 'JUDGE_AUDIT_SYNTHESIS',
            round: 1,
            errorClass,
            clarifications: [{ answer: 'Also check src/missing.js.' }],
            proofs: [sampleAuthProof]
          })
        );
        assert.equal(judgeMissingFile.ready, false, `Judge clarification missing file must refuse (${errorClass})`);
        assert.ok(judgeMissingFile.missingDependencies.includes('src/missing.js'));

        const voteMissingUrl = evaluateToolFreeEvidenceReadiness(
          makeReadinessParams({
            phase: 'VOTING',
            round: 1,
            errorClass,
            clarifications: [{ question: 'Check https://example.com/spec?' }],
            candidate: sampleCandidate,
            admittedProofs: [sampleAuthProof]
          })
        );
        assert.equal(voteMissingUrl.ready, false, `Voting clarification missing URL must refuse (${errorClass})`);
        assert.ok(voteMissingUrl.missingDependencies.includes('https://example.com/spec'));

        for (const phase of ['R1_DELIBERATION', 'R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING']) {
          const coveredRun = await runPhaseEngineCase({
            phase,
            errorClass,
            topic: 'Inspect src/auth.js.',
            clarifications: [{ answer: 'Focus on src/auth.js token expiry.' }],
            coveredSources: ['src/auth.js']
          });
          assert.equal(
            coveredRun.targetCalls.length,
            2,
            `Covered clarification must allow retry (${phase}/${errorClass})`
          );
          assert.equal(coveredRun.targetCalls[1].tools, 'none');
          assert.equal(coveredRun.targetCalls[1].cwd, undefined);
        }
      }
    });

    it('ReReview-102 Round 14 fixes: enforces subcommand and strong-shell precedence over prose stopwords, fail-closed glob budgets, and O(n) nested-alternative glob parsing', async () => {
      const sampleAuthProof = {
        id: 'P1',
        seatId: 's1',
        round: 1,
        kind: 'claim',
        source: 'src/auth.js',
        statement: 'Token expiry verified in src/auth.js.'
      };
      const sampleCandidate = {
        id: 'C1',
        round: 1,
        summary: 'Token expiry handling in src/auth.js.',
        admittedProofIds: ['P1']
      };
      const sampleObjections = [{ seatId: 's2', proofId: 'P1', reason: 'Verify token expiry details.' }];

      function makeR15ReadinessParams({
        phase = 'DELIBERATION',
        round = 1,
        errorClass,
        topic = 'Inspect src/auth.js.',
        clarifications = [],
        coveredSources = ['src/auth.js'],
        proofs = [],
        priorProofs = [],
        previousCandidate = undefined,
        openObjections = [],
        candidate = undefined,
        admittedProofs = []
      }) {
        return {
          phase,
          round,
          errorClass,
          topic,
          clarifications,
          proofs,
          priorProofs,
          previousCandidate,
          openObjections,
          candidate,
          admittedProofs,
          evidence: coveredSources.map((source, i) => ({
            id: `E${i + 1}`,
            source,
            text: `complete snapshot for ${source}`
          })),
          selfContainedInput: {
            phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
            roundScope: 'all_rounds',
            coveredArtifacts: coveredSources.map((source, i) => ({
              source,
              evidenceId: `E${i + 1}`,
              coverage: 'complete_artifact'
            }))
          },
          originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo' }
        };
      }

      async function runR15PhaseEngineCase({
        phase,
        errorClass,
        topic = 'Inspect src/auth.js.',
        clarifications = [],
        s1Proof = null,
        coveredSources = ['src/auth.js']
      }) {
        const mock = new MockAdapter();
        const targetCalls = [];
        const origProof = mock.executeSeatProof.bind(mock);
        const origJudge = mock.executeJudgeAuditAndSynthesis.bind(mock);
        const origVote = mock.executeSeatVote.bind(mock);

        const makeFault = (participantId) =>
          errorClass === 'TimeoutError'
            ? new TimeoutError(`${phase} timeout`, { timeoutMs: 1000, harness: 'codex', seatId: participantId })
            : new HeadlessToolDeniedError(`${phase} tool denied`, {
                harness: 'codex',
                seatId: participantId,
                exitCode: 0,
                isRetryable: true
              });

        mock.executeSeatProof = async (ctx) => {
          if (phase === 'R1_DELIBERATION' && ctx.round === 1 && ctx.seat.id === 's1') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s1');
            }
          }
          if (phase === 'R2_DELIBERATION' && ctx.round === 2 && ctx.seat.id === 's2') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s2');
            }
          }
          if (ctx.round === 1 && ctx.seat.id === 's1' && s1Proof) {
            return s1Proof;
          }
          return origProof(ctx);
        };

        mock.executeJudgeAuditAndSynthesis = async (ctx) => {
          if (
            (phase === 'JUDGE_AUDIT_SYNTHESIS_R1' && ctx.round === 1) ||
            (phase === 'JUDGE_AUDIT_SYNTHESIS_R2' && ctx.round === 2)
          ) {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('judge');
            }
          }
          return origJudge(ctx);
        };

        mock.executeSeatVote = async (ctx) => {
          if (phase === 'VOTING' && ctx.round === 1 && ctx.seat.id === 's1') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) {
              throw makeFault('s1');
            }
          }
          if (
            (phase === 'R2_DELIBERATION' || phase === 'JUDGE_AUDIT_SYNTHESIS_R2') &&
            ctx.round === 1 &&
            ctx.seat.id === 's2'
          ) {
            return { vote: 'object', proofId: 'P1', reason: 'Dispute R1 proof in R2' };
          }
          return origVote(ctx);
        };

        const engine = new CouncilEngine(
          {
            topic,
            clarifications,
            maxClarificationBatches: clarifications.length,
            minQuorum: 2,
            maxRounds: phase === 'R2_DELIBERATION' || phase === 'JUDGE_AUDIT_SYNTHESIS_R2' ? 2 : 1,
            maxRetriesPerSeat: 1,
            maxRetriesPerJudge: 1,
            cwd: '/repo',
            evidence: coveredSources.map((source, i) => ({
              id: `E${i + 1}`,
              label: `Artifact ${i + 1}`,
              source,
              text: `complete snapshot for ${source}`
            })),
            selfContainedInput: {
              kind: 'full_context',
              label: 'R15 five-phase matrix',
              phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
              roundScope: 'all_rounds',
              coveredArtifacts: coveredSources.map((source, i) => ({
                source,
                evidenceId: `E${i + 1}`,
                coverage: 'complete_artifact'
              }))
            },
            judge: { id: 'judge', harness: 'codex', model: 'gpt-6-astra (high)', tools: 'read-only', cwd: '/repo' },
            seats: [
              {
                id: 's1',
                harness: 'codex',
                model: 'gpt-6-astra (high)',
                soul: 'S1',
                tools: 'read-only',
                votingTools: 'read-only',
                cwd: '/repo'
              },
              { id: 's2', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S2', tools: 'read-only', cwd: '/repo' },
              { id: 's3', harness: 'cursor', model: 'grok-4', soul: 'S3', tools: 'none' }
            ]
          },
          { harnessResolver: () => mock }
        );

        await engine.run();
        return { engine, targetCalls };
      }

      const allFivePhases = [
        'R1_DELIBERATION',
        'R2_DELIBERATION',
        'JUDGE_AUDIT_SYNTHESIS_R1',
        'JUDGE_AUDIT_SYNTHESIS_R2',
        'VOTING'
      ];

      async function assertVetoAllFivePhases({ topic, clarifications = [], coveredSources = ['src/auth.js'], label }) {
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          const phaseVerdicts = [
            [
              'R1_DELIBERATION',
              evaluateToolFreeEvidenceReadiness(
                makeR15ReadinessParams({ phase: 'DELIBERATION', round: 1, errorClass, topic, clarifications, coveredSources })
              )
            ],
            [
              'R2_DELIBERATION',
              evaluateToolFreeEvidenceReadiness(
                makeR15ReadinessParams({
                  phase: 'DELIBERATION',
                  round: 2,
                  errorClass,
                  topic,
                  clarifications,
                  priorProofs: [sampleAuthProof],
                  previousCandidate: sampleCandidate,
                  openObjections: sampleObjections,
                  coveredSources
                })
              )
            ],
            [
              'JUDGE_AUDIT_SYNTHESIS_R1',
              evaluateToolFreeEvidenceReadiness(
                makeR15ReadinessParams({
                  phase: 'JUDGE_AUDIT_SYNTHESIS',
                  round: 1,
                  errorClass,
                  topic,
                  clarifications,
                  proofs: [sampleAuthProof],
                  coveredSources
                })
              )
            ],
            [
              'JUDGE_AUDIT_SYNTHESIS_R2',
              evaluateToolFreeEvidenceReadiness(
                makeR15ReadinessParams({
                  phase: 'JUDGE_AUDIT_SYNTHESIS',
                  round: 2,
                  errorClass,
                  topic,
                  clarifications,
                  proofs: [sampleAuthProof],
                  priorProofs: [sampleAuthProof],
                  previousCandidate: sampleCandidate,
                  openObjections: sampleObjections,
                  coveredSources
                })
              )
            ],
            [
              'VOTING',
              evaluateToolFreeEvidenceReadiness(
                makeR15ReadinessParams({
                  phase: 'VOTING',
                  round: 1,
                  errorClass,
                  topic,
                  clarifications,
                  candidate: sampleCandidate,
                  admittedProofs: [sampleAuthProof],
                  coveredSources
                })
              )
            ]
          ];
          for (const [phaseLabel, verdict] of phaseVerdicts) {
            assert.equal(verdict.ready, false, `${label}: ${phaseLabel}/${errorClass} must refuse`);
            assert.equal(verdict.reasonCode, 'evidence_access_failure');
          }

          for (const phase of allFivePhases) {
            const run = await runR15PhaseEngineCase({
              phase,
              errorClass,
              topic,
              clarifications,
              coveredSources
            });
            assert.equal(run.targetCalls.length, 1, `${label}: ${phase}/${errorClass} must refuse tools:none retry`);
          }
        }
      }

      // 1. Finding 1: Recognized subcommands & strong shell syntax take precedence over SPLIT_QUOTE_PROSE_STOPWORDS
      const finding1CommandTopics = [
        ['quoted cargo check', 'Inspect src/auth.js. Verify "cargo" "check" output.'],
        ['quoted verb cargo + unquoted subcommand check', 'Inspect src/auth.js. Verify "cargo" check output.'],
        ['split-quoted cargo + unquoted check', 'Inspect src/auth.js. Verify c"argo" check output.'],
        ['quoted make check', 'Inspect src/auth.js. Verify "make" "check" output.'],
        ['env -- quoted cat < README', 'Inspect src/auth.js. Verify env -- "cat" < "README" output.'],
        ['env -- quoted ls > out.txt', 'Inspect src/auth.js. Verify env -- "ls" > "out.txt" output.'],
        ['env -- quoted make > out.txt', 'Inspect src/auth.js. Verify env -- "make" > "out.txt" output.'],
        ['quoted grep quoted output', 'Inspect src/auth.js. Verify "grep" "output" src/auth.js.'],
        ['command -v quoted check', 'Inspect src/auth.js. Verify command -v "check" output.']
      ];

      for (const [label, topic] of finding1CommandTopics) {
        const deps = extractVerificationDependencies([topic]);
        assert.ok(deps.workspaceBroadDeps.length >= 1, `Expected broad dep for ${label}`);
        await assertVetoAllFivePhases({ topic, label });
      }

      for (const [label, checkSource, checkStatement] of [
        ['kind:check proof "cargo" "check" source', 'Verify "cargo" "check" output', 'Checked src/auth.js'],
        ['kind:check proof c"argo" check statement', 'src/auth.js', 'Ran c"argo" check before returning'],
        ['kind:check proof env -- "cat" < "README"', 'src/auth.js', 'Verify env -- "cat" < "README" output.']
      ]) {
        const checkDeps = extractVerificationDependencies([checkSource, checkStatement]);
        assert.ok(checkDeps.workspaceBroadDeps.length >= 1, `Expected broad dep for ${label}`);
        const checkProof = {
          id: 'P1',
          seatId: 's1',
          round: 1,
          scope: 'Verify workspace evidence',
          kind: 'check',
          source: checkSource,
          statement: checkStatement
        };
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          for (const [phaseName, round, extra] of [
            ['DELIBERATION', 2, { priorProofs: [checkProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }],
            ['JUDGE_AUDIT_SYNTHESIS', 1, { proofs: [checkProof] }],
            ['JUDGE_AUDIT_SYNTHESIS', 2, { proofs: [checkProof], priorProofs: [checkProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }],
            ['VOTING', 1, { candidate: sampleCandidate, admittedProofs: [checkProof] }]
          ]) {
            const verdict = evaluateToolFreeEvidenceReadiness(
              makeR15ReadinessParams({
                phase: phaseName,
                round,
                errorClass,
                coveredSources: ['src/auth.js'],
                ...extra
              })
            );
            assert.equal(verdict.ready, false, `${label}: ${phaseName} R${round}/${errorClass} must refuse`);
            assert.equal(verdict.reasonCode, 'evidence_access_failure');
          }
          for (const enginePhase of ['R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS_R1', 'JUDGE_AUDIT_SYNTHESIS_R2', 'VOTING']) {
            const run = await runR15PhaseEngineCase({
              phase: enginePhase,
              errorClass,
              s1Proof: checkProof,
              coveredSources: ['src/auth.js']
            });
            assert.equal(run.targetCalls.length, 1, `${label}: engine ${enginePhase}/${errorClass} must refuse`);
          }
        }
      }

      assert.deepEqual(extractVerificationDependencies(['Notes <section> and >quote do not invoke shell commands.']), {
        workspaceFileDeps: [],
        workspaceBroadDeps: [],
        externalDeps: []
      });

      const positiveProseControls = [
        'Keys "cat", "node", "git", "sh", "make", "env" in src/auth.js are valid.',
        'Property "exec" and key "env" in config.json matched "checkTokenExpiry()".',
        'Inspect src/auth.js. Notes <section> and >quote do not invoke shell commands.',
        'Use "cat.md" and "make" key names safely.',
        'Inspect src/auth.js: each node validates token expiry and git history concepts; at the same time make sure package.json npm "exports" field is preserved.'
      ];
      for (const proseTopic of positiveProseControls) {
        const covered = proseTopic.includes('config.json')
          ? ['config.json']
          : proseTopic.includes('package.json')
            ? ['src/auth.js', 'package.json']
            : proseTopic.includes('cat.md')
              ? ['cat.md']
              : ['src/auth.js'];
        const deps = extractVerificationDependencies([proseTopic]);
        assert.deepEqual(deps.workspaceBroadDeps, [], `Expected 0 broad deps for prose control: ${proseTopic}`);
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          for (const phase of allFivePhases) {
            const run = await runR15PhaseEngineCase({
              phase,
              errorClass,
              topic: proseTopic,
              coveredSources: covered
            });
            assert.equal(
              run.targetCalls.length,
              2,
              `Prose control must allow tool-free retry (${phase}/${errorClass}): ${proseTopic}`
            );
            assert.equal(run.targetCalls[1].tools, 'none');
            assert.equal(run.targetCalls[1].cwd, undefined);
          }
        }
      }

      // 2. Finding 2: Nested + and ?(a) glob evaluation & fail-closed budget
      let p11 = '+(M|a|k|e|f|i|l)';
      for (let i = 0; i < 11; i += 1) {
        p11 = `+(${p11}?(a))`;
      }
      assert.deepEqual(extractVerificationDependencies([`Inspect src/auth.js and ${p11}`]).workspaceBroadDeps, [p11]);
      await assertVetoAllFivePhases({ topic: `Inspect src/auth.js and ${p11}`, label: 'Finding 2 p11' });

      let p50 = '+(M)';
      for (let i = 0; i < 50; i += 1) {
        p50 = `+(${p50}?([a-z]))`;
      }
      const p50Start = performance.now();
      const p50Deps = extractVerificationDependencies([`Inspect src/auth.js and ${p50}`]);
      const p50Ms = performance.now() - p50Start;
      assert.ok(p50Ms < 20, `Expected <20ms for 50-deep char-class extglob, got ${p50Ms.toFixed(2)}ms`);
      assert.deepEqual(p50Deps.workspaceBroadDeps, [p50]);

      const p48kPlus = `${'+('.repeat(6856)}Makefile${'?(a))'.repeat(6856)}`;
      assert.deepEqual(extractVerificationDependencies([p48kPlus]).workspaceBroadDeps, [p48kPlus]);

      let benign11 = '+(n|o|t|e)';
      for (let i = 0; i < 11; i += 1) {
        benign11 = `+(${benign11}?(x))`;
      }
      assert.deepEqual(extractVerificationDependencies([`Inspect src/auth.js and ${benign11}`]).workspaceBroadDeps, []);
      for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
        const benignVerdict = evaluateToolFreeEvidenceReadiness(
          makeR15ReadinessParams({
            phase: 'DELIBERATION',
            round: 1,
            errorClass,
            topic: `Inspect src/auth.js and ${benign11}`,
            coveredSources: ['src/auth.js']
          })
        );
        assert.equal(benignVerdict.ready, true, `Benign nested extglob must remain ready (${errorClass})`);
      }

      // 3. Finding 3: O(n) nested-alternative glob parsing <20ms at 12KB, 24KB, and 48KB
      for (const [label, pattern] of [
        ['12KB right-nested extglob alt', `${'@(aa|'.repeat(2000)}Makefile${')'.repeat(2000)}`],
        ['24KB right-nested extglob alt', `${'@(aa|'.repeat(4000)}Makefile${')'.repeat(4000)}`],
        ['48KB right-nested extglob alt', `${'@(aa|'.repeat(8000)}Makefile${')'.repeat(8000)}`],
        ['48KB left-nested extglob alt', `${'@('.repeat(8000)}Makefile${'|aa)'.repeat(8000)}`],
        [
          '48KB alternating *(@(...)) extglob alt',
          `${'*(@('.repeat(5333)}Makefile${'|aa))'.repeat(5333)}`
        ],
        [
          '5000-branch distinct nested extglob alt',
          `${Array.from({ length: 5000 }, (_, i) => `@(x${i}|`).join('')}Makefile${')'.repeat(5000)}`
        ]
      ]) {
        const t0 = performance.now();
        const deps = extractVerificationDependencies([pattern]);
        const elapsed = performance.now() - t0;
        assert.ok(elapsed < 20, `Expected <20ms for ${label}, got ${elapsed.toFixed(2)}ms`);
        assert.deepEqual(deps.workspaceBroadDeps, [pattern], `Expected 1 broad dep for ${label}`);
      }
    });

    it('ReReview-102 Round 15 fixes: detects command-associated redirections after prose stopwords and later arguments while preserving prose controls', async () => {
      const sampleAuthProof = {
        id: 'P1',
        seatId: 's1',
        round: 1,
        kind: 'claim',
        source: 'src/auth.js',
        statement: 'Token expiry verified in src/auth.js.'
      };
      const sampleCandidate = {
        id: 'C1',
        round: 1,
        summary: 'Token expiry handling in src/auth.js.',
        admittedProofIds: ['P1']
      };
      const sampleObjections = [{ seatId: 's2', proofId: 'P1', reason: 'Verify token expiry details.' }];
      const allFivePhases = [
        'R1_DELIBERATION',
        'R2_DELIBERATION',
        'JUDGE_AUDIT_SYNTHESIS_R1',
        'JUDGE_AUDIT_SYNTHESIS_R2',
        'VOTING'
      ];

      function makeReadinessParams({
        phase = 'DELIBERATION',
        round = 1,
        errorClass,
        topic = 'Inspect src/auth.js.',
        coveredSources = ['src/auth.js'],
        proofs = [],
        priorProofs = [],
        previousCandidate = undefined,
        openObjections = [],
        candidate = undefined,
        admittedProofs = []
      }) {
        return {
          phase,
          round,
          errorClass,
          topic,
          clarifications: [],
          proofs,
          priorProofs,
          previousCandidate,
          openObjections,
          candidate,
          admittedProofs,
          evidence: coveredSources.map((source, i) => ({
            id: `E${i + 1}`,
            source,
            text: `complete snapshot for ${source}`
          })),
          selfContainedInput: {
            phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
            roundScope: 'all_rounds',
            coveredArtifacts: coveredSources.map((source, i) => ({
              source,
              evidenceId: `E${i + 1}`,
              coverage: 'complete_artifact'
            }))
          },
          originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo' }
        };
      }

      async function runPhaseEngineCase({
        phase,
        errorClass,
        topic = 'Inspect src/auth.js.',
        s1Proof = null,
        coveredSources = ['src/auth.js']
      }) {
        const mock = new MockAdapter();
        const targetCalls = [];
        const origProof = mock.executeSeatProof.bind(mock);
        const origJudge = mock.executeJudgeAuditAndSynthesis.bind(mock);
        const origVote = mock.executeSeatVote.bind(mock);

        const makeFault = (participantId) =>
          errorClass === 'TimeoutError'
            ? new TimeoutError(`${phase} timeout`, { timeoutMs: 1000, harness: 'codex', seatId: participantId })
            : new HeadlessToolDeniedError(`${phase} tool denied`, {
                harness: 'codex',
                seatId: participantId,
                exitCode: 0,
                isRetryable: true
              });

        mock.executeSeatProof = async (ctx) => {
          if (phase === 'R1_DELIBERATION' && ctx.round === 1 && ctx.seat.id === 's1') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) throw makeFault('s1');
          }
          if (phase === 'R2_DELIBERATION' && ctx.round === 2 && ctx.seat.id === 's2') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) throw makeFault('s2');
          }
          if (ctx.round === 1 && ctx.seat.id === 's1' && s1Proof) {
            return s1Proof;
          }
          return origProof(ctx);
        };

        mock.executeJudgeAuditAndSynthesis = async (ctx) => {
          if (
            (phase === 'JUDGE_AUDIT_SYNTHESIS_R1' && ctx.round === 1) ||
            (phase === 'JUDGE_AUDIT_SYNTHESIS_R2' && ctx.round === 2)
          ) {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) throw makeFault('judge');
          }
          return origJudge(ctx);
        };

        mock.executeSeatVote = async (ctx) => {
          if (phase === 'VOTING' && ctx.round === 1 && ctx.seat.id === 's1') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) throw makeFault('s1');
          }
          if (
            (phase === 'R2_DELIBERATION' || phase === 'JUDGE_AUDIT_SYNTHESIS_R2') &&
            ctx.round === 1 &&
            ctx.seat.id === 's2'
          ) {
            return { vote: 'object', proofId: 'P1', reason: 'Dispute R1 proof in R2' };
          }
          return origVote(ctx);
        };

        const engine = new CouncilEngine(
          {
            topic,
            clarifications: [],
            maxClarificationBatches: 0,
            minQuorum: 2,
            maxRounds: phase === 'R2_DELIBERATION' || phase === 'JUDGE_AUDIT_SYNTHESIS_R2' ? 2 : 1,
            maxRetriesPerSeat: 1,
            maxRetriesPerJudge: 1,
            cwd: '/repo',
            evidence: coveredSources.map((source, i) => ({
              id: `E${i + 1}`,
              label: `Artifact ${i + 1}`,
              source,
              text: `complete snapshot for ${source}`
            })),
            selfContainedInput: {
              kind: 'full_context',
              label: 'R15 redirection regression matrix',
              phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
              roundScope: 'all_rounds',
              coveredArtifacts: coveredSources.map((source, i) => ({
                source,
                evidenceId: `E${i + 1}`,
                coverage: 'complete_artifact'
              }))
            },
            judge: { id: 'judge', harness: 'codex', model: 'gpt-6-astra (high)', tools: 'read-only', cwd: '/repo' },
            seats: [
              {
                id: 's1',
                harness: 'codex',
                model: 'gpt-6-astra (high)',
                soul: 'S1',
                tools: 'read-only',
                votingTools: 'read-only',
                cwd: '/repo'
              },
              { id: 's2', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S2', tools: 'read-only', cwd: '/repo' },
              { id: 's3', harness: 'cursor', model: 'grok-4', soul: 'S3', tools: 'none' }
            ]
          },
          { harnessResolver: () => mock }
        );

        await engine.run();
        return { engine, targetCalls };
      }

      async function assertVetoAllFivePhases(topic, label, coveredSources = ['src/auth.js']) {
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          const phaseVerdicts = [
            [
              'R1_DELIBERATION',
              evaluateToolFreeEvidenceReadiness(
                makeReadinessParams({ phase: 'DELIBERATION', round: 1, errorClass, topic, coveredSources })
              )
            ],
            [
              'R2_DELIBERATION',
              evaluateToolFreeEvidenceReadiness(
                makeReadinessParams({
                  phase: 'DELIBERATION',
                  round: 2,
                  errorClass,
                  topic,
                  priorProofs: [sampleAuthProof],
                  previousCandidate: sampleCandidate,
                  openObjections: sampleObjections,
                  coveredSources
                })
              )
            ],
            [
              'JUDGE_AUDIT_SYNTHESIS_R1',
              evaluateToolFreeEvidenceReadiness(
                makeReadinessParams({
                  phase: 'JUDGE_AUDIT_SYNTHESIS',
                  round: 1,
                  errorClass,
                  topic,
                  proofs: [sampleAuthProof],
                  coveredSources
                })
              )
            ],
            [
              'JUDGE_AUDIT_SYNTHESIS_R2',
              evaluateToolFreeEvidenceReadiness(
                makeReadinessParams({
                  phase: 'JUDGE_AUDIT_SYNTHESIS',
                  round: 2,
                  errorClass,
                  topic,
                  proofs: [sampleAuthProof],
                  priorProofs: [sampleAuthProof],
                  previousCandidate: sampleCandidate,
                  openObjections: sampleObjections,
                  coveredSources
                })
              )
            ],
            [
              'VOTING',
              evaluateToolFreeEvidenceReadiness(
                makeReadinessParams({
                  phase: 'VOTING',
                  round: 1,
                  errorClass,
                  topic,
                  candidate: sampleCandidate,
                  admittedProofs: [sampleAuthProof],
                  coveredSources
                })
              )
            ]
          ];
          for (const [phaseLabel, verdict] of phaseVerdicts) {
            assert.equal(verdict.ready, false, `${label}: ${phaseLabel}/${errorClass} must refuse`);
            assert.equal(verdict.reasonCode, 'evidence_access_failure');
          }
          for (const phase of allFivePhases) {
            const run = await runPhaseEngineCase({ phase, errorClass, topic, coveredSources });
            assert.equal(run.targetCalls.length, 1, `${label}: ${phase}/${errorClass} must refuse tools:none retry`);
          }
        }
      }

      const redirectionTopics = [
        'Inspect src/auth.js. Verify "cat" output > result.',
        'Inspect src/auth.js. Verify c"at" output > result.',
        'Inspect src/auth.js. Verify "grep" output src/auth.js > result.',
        'Inspect src/auth.js. Verify cat output > result.',
        'Inspect src/auth.js. Verify "cat" output >> result.',
        'Inspect src/auth.js. Verify "cat" output < input.txt.',
        'Inspect src/auth.js. Verify "cat" output 2>&1.',
        'Inspect src/auth.js. Verify "cat" output 2>&$fd.',
        'Inspect src/auth.js. Verify "cat" output <&$fd.',
        'Inspect src/auth.js. Verify "cat" output 2> err.log.',
        'Inspect src/auth.js. Verify "cat" output &> result.',
        'Inspect src/auth.js. Verify "cat" output >& result.',
        'Inspect src/auth.js. Verify "cat" output<README>result.',
        'Inspect src/auth.js. Verify < README "cat" output.',
        'Inspect src/auth.js. Verify env output > result.',
        'Inspect src/auth.js. Verify "env" -0 > result.',
        'Inspect src/auth.js. Verify exec 2> err.log.'
      ];
      for (const topic of redirectionTopics) {
        const deps = extractVerificationDependencies([topic]);
        assert.ok(deps.workspaceBroadDeps.length >= 1, `Expected broad dep for redirection topic: ${topic}`);
        await assertVetoAllFivePhases(topic, topic);
      }

      for (const [label, checkSource, checkStatement] of [
        ['kind:check c"at" output > result', 'src/auth.js', 'Verify c"at" output > result.'],
        ['kind:check "cat" output > result', 'Verify "cat" output > result', 'Checked src/auth.js'],
        ['kind:check "grep" output src/auth.js > result', 'src/auth.js', 'Verify "grep" output src/auth.js > result.'],
        ['kind:check c"at" output 2>&$fd', 'src/auth.js', 'Verify c"at" output 2>&$fd.']
      ]) {
        const checkDeps = extractVerificationDependencies([checkSource, checkStatement]);
        assert.ok(checkDeps.workspaceBroadDeps.length >= 1, `Expected broad dep for ${label}`);
        const checkProof = {
          id: 'P1',
          seatId: 's1',
          round: 1,
          scope: 'Verify workspace evidence',
          kind: 'check',
          source: checkSource,
          statement: checkStatement
        };
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          for (const [phaseName, round, extra] of [
            ['DELIBERATION', 2, { priorProofs: [checkProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }],
            ['JUDGE_AUDIT_SYNTHESIS', 1, { proofs: [checkProof] }],
            ['JUDGE_AUDIT_SYNTHESIS', 2, { proofs: [checkProof], priorProofs: [checkProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }],
            ['VOTING', 1, { candidate: sampleCandidate, admittedProofs: [checkProof] }]
          ]) {
            const verdict = evaluateToolFreeEvidenceReadiness(
              makeReadinessParams({
                phase: phaseName,
                round,
                errorClass,
                coveredSources: ['src/auth.js'],
                ...extra
              })
            );
            assert.equal(verdict.ready, false, `${label}: ${phaseName} R${round}/${errorClass} must refuse`);
            assert.equal(verdict.reasonCode, 'evidence_access_failure');
          }
          for (const enginePhase of ['R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS_R1', 'JUDGE_AUDIT_SYNTHESIS_R2', 'VOTING']) {
            const run = await runPhaseEngineCase({
              phase: enginePhase,
              errorClass,
              s1Proof: checkProof,
              coveredSources: ['src/auth.js']
            });
            assert.equal(run.targetCalls.length, 1, `${label}: engine ${enginePhase}/${errorClass} must refuse`);
          }
        }
      }

      const positiveProseControls = [
        'Inspect src/auth.js. Notes <section> and >quote do not invoke shell commands.',
        'Inspect src/auth.js. Keys "cat" and "node" in src/auth.js are valid. Notes <section> and >quote do not invoke shell commands.',
        'Inspect src/auth.js. Keys "cat", "node", and "sh" in Notes <section> and >quote do not invoke shell commands.',
        'Inspect src/auth.js. Notes >quote. "cat" key in src/auth.js is valid.',
        'Inspect src/auth.js. Notes 2>&1. "cat" key in src/auth.js is valid.',
        'Inspect src/auth.js. Target Node >= 22, node > 22, python < 3.12, and git -> main or node => callback are valid.'
      ];
      for (const proseTopic of positiveProseControls) {
        const deps = extractVerificationDependencies([proseTopic]);
        assert.deepEqual(deps.workspaceBroadDeps, [], `Expected 0 broad deps for prose control: ${proseTopic}`);
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          for (const phase of allFivePhases) {
            const run = await runPhaseEngineCase({
              phase,
              errorClass,
              topic: proseTopic,
              coveredSources: ['src/auth.js']
            });
            assert.equal(
              run.targetCalls.length,
              2,
              `Prose control must allow tool-free retry (${phase}/${errorClass}): ${proseTopic}`
            );
            assert.equal(run.targetCalls[1].tools, 'none');
            assert.equal(run.targetCalls[1].cwd, undefined);
          }
        }
      }

      const redir48kTopic = 'Inspect ' + '"cat" output '.repeat(3700) + '> result.';
      const tRedir0 = performance.now();
      const redir48kDeps = extractVerificationDependencies([redir48kTopic]);
      const redir48kMs = performance.now() - tRedir0;
      assert.ok(redir48kMs < 20, `Expected <20ms for 48KB redirection scan, got ${redir48kMs.toFixed(2)}ms`);
      assert.ok(redir48kDeps.workspaceBroadDeps.length >= 1, 'Expected broad dep for 48KB redirection topic');

      const prose48kTopic = '"cat" key is valid. '.repeat(2400) + 'Notes <section> and >quote do not invoke shell commands.';
      const tProse0 = performance.now();
      const prose48kDeps = extractVerificationDependencies([prose48kTopic]);
      const prose48kMs = performance.now() - tProse0;
      assert.ok(prose48kMs < 20, `Expected <20ms for 48KB prose control, got ${prose48kMs.toFixed(2)}ms`);
      assert.deepEqual(prose48kDeps.workspaceBroadDeps, [], 'Expected 0 broad deps for 48KB prose control');

      const p48kPlus = `${'+('.repeat(6856)}Makefile${'?(a))'.repeat(6856)}`;
      const tPlus0 = performance.now();
      const plus48kDeps = extractVerificationDependencies([p48kPlus]);
      const plus48kMs = performance.now() - tPlus0;
      assert.ok(plus48kMs < 20, `Expected <20ms for 48KB p48kPlus extglob, got ${plus48kMs.toFixed(2)}ms`);
      assert.deepEqual(plus48kDeps.workspaceBroadDeps, [p48kPlus]);
    });

    it('ReReview-102 Round 16 fixes: handles escaped punctuation, paired <in> out redirections, numeric redirection targets, and <20ms 48KB repeated redirections', async () => {
      const sampleAuthProof = {
        id: 'P1',
        seatId: 's1',
        round: 1,
        kind: 'claim',
        source: 'src/auth.js',
        statement: 'Token expiry verified in src/auth.js.'
      };
      const sampleCandidate = {
        id: 'C1',
        round: 1,
        summary: 'Token expiry handling in src/auth.js.',
        admittedProofIds: ['P1']
      };
      const sampleObjections = [{ seatId: 's2', proofId: 'P1', reason: 'Verify token expiry details.' }];
      const allFivePhases = [
        'R1_DELIBERATION',
        'R2_DELIBERATION',
        'JUDGE_AUDIT_SYNTHESIS_R1',
        'JUDGE_AUDIT_SYNTHESIS_R2',
        'VOTING'
      ];
      const defaultCovered = ['src/auth.js', 'README'];

      function buildReadinessInputs({
        phase = 'DELIBERATION',
        round = 1,
        errorClass,
        topic = 'Inspect src/auth.js.',
        coveredSources = defaultCovered,
        proofs = [],
        priorProofs = [],
        previousCandidate = undefined,
        openObjections = [],
        candidate = undefined,
        admittedProofs = []
      }) {
        return {
          phase,
          round,
          errorClass,
          topic,
          clarifications: [],
          proofs,
          priorProofs,
          previousCandidate,
          openObjections,
          candidate,
          admittedProofs,
          evidence: coveredSources.map((source, i) => ({
            id: `E${i + 1}`,
            source,
            text: `complete snapshot for ${source}`
          })),
          selfContainedInput: {
            phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
            roundScope: 'all_rounds',
            coveredArtifacts: coveredSources.map((source, i) => ({
              source,
              evidenceId: `E${i + 1}`,
              coverage: 'complete_artifact'
            }))
          },
          originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo' }
        };
      }

      async function executePhaseEngine({ phase, errorClass, topic = 'Inspect src/auth.js.', s1Proof = null }) {
        const mock = new MockAdapter();
        const targetCalls = [];
        const origProof = mock.executeSeatProof.bind(mock);
        const origJudge = mock.executeJudgeAuditAndSynthesis.bind(mock);
        const origVote = mock.executeSeatVote.bind(mock);
        const makeFault = (participantId) =>
          errorClass === 'TimeoutError'
            ? new TimeoutError(`${phase} timeout`, { timeoutMs: 1000, harness: 'codex', seatId: participantId })
            : new HeadlessToolDeniedError(`${phase} tool denied`, {
                harness: 'codex',
                seatId: participantId,
                exitCode: 0,
                isRetryable: true
              });

        mock.executeSeatProof = async (ctx) => {
          if (
            (phase === 'R1_DELIBERATION' && ctx.round === 1 && ctx.seat.id === 's1') ||
            (phase === 'R2_DELIBERATION' && ctx.round === 2 && ctx.seat.id === 's2')
          ) {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) throw makeFault(ctx.seat.id);
          }
          if (ctx.round === 1 && ctx.seat.id === 's1' && s1Proof) return s1Proof;
          return origProof(ctx);
        };
        mock.executeJudgeAuditAndSynthesis = async (ctx) => {
          if (
            (phase === 'JUDGE_AUDIT_SYNTHESIS_R1' && ctx.round === 1) ||
            (phase === 'JUDGE_AUDIT_SYNTHESIS_R2' && ctx.round === 2)
          ) {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) throw makeFault('judge');
          }
          return origJudge(ctx);
        };
        mock.executeSeatVote = async (ctx) => {
          if (phase === 'VOTING' && ctx.round === 1 && ctx.seat.id === 's1') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) throw makeFault('s1');
          }
          if ((phase === 'R2_DELIBERATION' || phase === 'JUDGE_AUDIT_SYNTHESIS_R2') && ctx.round === 1 && ctx.seat.id === 's2') {
            return { vote: 'object', proofId: 'P1', reason: 'Dispute R1 proof in R2' };
          }
          return origVote(ctx);
        };

        const engine = new CouncilEngine(
          {
            topic,
            clarifications: [],
            maxClarificationBatches: 0,
            minQuorum: 2,
            maxRounds: phase === 'R2_DELIBERATION' || phase === 'JUDGE_AUDIT_SYNTHESIS_R2' ? 2 : 1,
            maxRetriesPerSeat: 1,
            maxRetriesPerJudge: 1,
            cwd: '/repo',
            evidence: defaultCovered.map((source, i) => ({
              id: `E${i + 1}`,
              label: `Artifact ${i + 1}`,
              source,
              text: `complete snapshot for ${source}`
            })),
            selfContainedInput: {
              kind: 'full_context',
              label: 'R16 regression matrix',
              phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
              roundScope: 'all_rounds',
              coveredArtifacts: defaultCovered.map((source, i) => ({
                source,
                evidenceId: `E${i + 1}`,
                coverage: 'complete_artifact'
              }))
            },
            judge: { id: 'judge', harness: 'codex', model: 'gpt-6-astra (high)', tools: 'read-only', cwd: '/repo' },
            seats: [
              { id: 's1', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S1', tools: 'read-only', votingTools: 'read-only', cwd: '/repo' },
              { id: 's2', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S2', tools: 'read-only', cwd: '/repo' },
              { id: 's3', harness: 'cursor', model: 'grok-4', soul: 'S3', tools: 'none' }
            ]
          },
          { harnessResolver: () => mock }
        );
        await engine.run();
        return { targetCalls };
      }

      function evaluateCheckProofReadiness(checkProof, phaseName, round, errorClass) {
        const extra =
          phaseName === 'DELIBERATION'
            ? { priorProofs: [checkProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }
            : phaseName === 'JUDGE_AUDIT_SYNTHESIS' && round === 1
              ? { proofs: [checkProof] }
              : phaseName === 'JUDGE_AUDIT_SYNTHESIS'
                ? { proofs: [checkProof], priorProofs: [checkProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }
                : { candidate: sampleCandidate, admittedProofs: [checkProof] };
        return evaluateToolFreeEvidenceReadiness(buildReadinessInputs({ phase: phaseName, round, errorClass, ...extra }));
      }

      const mustRefuseTopics = [
        'Inspect src/auth.js. Verify c"at" output\\, src/auth.js > result',
        'Inspect src/auth.js. Verify "cat" output\\. src/auth.js > result',
        'Inspect src/auth.js. Verify c"at" output\\; src/auth.js > result',
        'Inspect src/auth.js. Verify c"at" output\\: src/auth.js > result',
        'Inspect src/auth.js. Notes >result\\. "cat" output',
        'Inspect src/auth.js. Verify "cat" output <README> result',
        'Inspect src/auth.js. Verify c"at" output <README> result',
        'Inspect src/auth.js. Verify "cat" output <section> result',
        'Inspect src/auth.js. Verify "cat" output <section> and',
        'Inspect src/auth.js. Verify "cat" output <README>> result',
        'Inspect src/auth.js. Verify "cat" output <README>&2',
        'Inspect src/auth.js. Verify <README> result "cat" output',
        'Inspect src/auth.js. Verify c"at" output > 22',
        'Inspect src/auth.js. Verify "cat" output > 22',
        'Inspect src/auth.js. Verify cat output > 22',
        'Inspect src/auth.js. Verify cat > 22',
        'Inspect src/auth.js. Verify "node" > 22',
        'Inspect src/auth.js. Verify node > "22"',
        'Inspect src/auth.js. Verify env node > 22',
        'Inspect src/auth.js. Verify node src/auth.js > 22'
      ];

      for (const topic of mustRefuseTopics) {
        const deps = extractVerificationDependencies([topic]);
        assert.ok(deps.workspaceBroadDeps.length >= 1, `Expected broad dep for topic: ${topic}`);
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          for (const [phase, round, extra] of [
            ['DELIBERATION', 1, {}],
            ['DELIBERATION', 2, { priorProofs: [sampleAuthProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }],
            ['JUDGE_AUDIT_SYNTHESIS', 1, { proofs: [sampleAuthProof] }],
            ['JUDGE_AUDIT_SYNTHESIS', 2, { proofs: [sampleAuthProof], priorProofs: [sampleAuthProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }],
            ['VOTING', 1, { candidate: sampleCandidate, admittedProofs: [sampleAuthProof] }]
          ]) {
            const verdict = evaluateToolFreeEvidenceReadiness(
              buildReadinessInputs({ phase, round, errorClass, topic, ...extra })
            );
            assert.equal(verdict.ready, false, `${phase} R${round}/${errorClass} must refuse: ${topic}`);
            assert.equal(verdict.reasonCode, 'evidence_access_failure');
          }
          for (const enginePhase of allFivePhases) {
            const run = await executePhaseEngine({ phase: enginePhase, errorClass, topic });
            assert.equal(run.targetCalls.length, 1, `Engine ${enginePhase}/${errorClass} must refuse: ${topic}`);
          }
        }
      }

      for (const [label, checkSource, checkStatement] of [
        ['kind:check escaped punct', 'src/auth.js', 'Verify c"at" output\\, src/auth.js > result'],
        ['kind:check paired redir statement', 'src/auth.js', 'Verify "cat" output <README> result'],
        ['kind:check paired redir source', 'Verify "cat" output <README> result', 'Checked src/auth.js'],
        ['kind:check numeric target statement', 'src/auth.js', 'Verify c"at" output > 22'],
        ['kind:check numeric target source', 'Verify c"at" output > 22', 'Checked src/auth.js']
      ]) {
        const checkDeps = extractVerificationDependencies([checkSource, checkStatement]);
        assert.ok(checkDeps.workspaceBroadDeps.length >= 1, `Expected broad dep for ${label}`);
        const checkProof = {
          id: 'P1',
          seatId: 's1',
          round: 1,
          scope: 'Verify workspace evidence',
          kind: 'check',
          source: checkSource,
          statement: checkStatement
        };
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          for (const [phaseName, round] of [
            ['DELIBERATION', 2],
            ['JUDGE_AUDIT_SYNTHESIS', 1],
            ['JUDGE_AUDIT_SYNTHESIS', 2],
            ['VOTING', 1]
          ]) {
            const verdict = evaluateCheckProofReadiness(checkProof, phaseName, round, errorClass);
            assert.equal(verdict.ready, false, `${label}: ${phaseName} R${round}/${errorClass} must refuse`);
            assert.equal(verdict.reasonCode, 'evidence_access_failure');
          }
          for (const enginePhase of ['R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS_R1', 'JUDGE_AUDIT_SYNTHESIS_R2', 'VOTING']) {
            const run = await executePhaseEngine({ phase: enginePhase, errorClass, s1Proof: checkProof });
            assert.equal(run.targetCalls.length, 1, `${label}: engine ${enginePhase}/${errorClass} must refuse`);
          }
        }
      }

      const positiveProseControls = [
        'Inspect src/auth.js. Notes <section> and >quote do not invoke shell commands.',
        'Inspect src/auth.js. Keys "cat", "node", and "sh" in Notes <section> and >quote do not invoke shell commands.',
        'Inspect src/auth.js. Summary <code>auth</code> is valid.',
        'Inspect src/auth.js. Target Node >= 22, node > 22, python < 3.12, and git -> main or node => callback are valid.',
        'Inspect src/auth.js. Ensure each node validates inputs and python < 3.12 is rejected while latency < 20ms.',
        'Inspect src/auth.js. Requires node >= 22 and python < 3.12 while value > 22 is valid.'
      ];
      for (const proseTopic of positiveProseControls) {
        const deps = extractVerificationDependencies([proseTopic]);
        assert.deepEqual(deps.workspaceBroadDeps, [], `Expected 0 broad deps for prose control: ${proseTopic}`);
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          for (const phase of allFivePhases) {
            const run = await executePhaseEngine({ phase, errorClass, topic: proseTopic });
            assert.equal(run.targetCalls.length, 2, `Prose control must allow retry (${phase}/${errorClass}): ${proseTopic}`);
            assert.equal(run.targetCalls[1].tools, 'none');
            assert.equal(run.targetCalls[1].cwd, undefined);
          }
        }
      }

      // Warmup + <20ms 48KB repeated redirection and markup scan bounds
      extractVerificationDependencies(['Inspect src/auth.js "cat" output >result. <section>']);
      for (const [label, payload, expectMinDeps] of [
        ['r16-repeat-cat-redir-48k', '"cat" output >result. '.repeat(2181).padEnd(48000, ' '), 1],
        ['r16-distinct-cat-target-48k', Array.from({ length: 2100 }, (_, i) => `"cat" output >r${i}. `).join('').padEnd(48000, ' '), 1],
        ['r16-distinct-cat-out-48k', Array.from({ length: 2100 }, (_, i) => `"cat" out${i} >result. `).join('').padEnd(48000, ' '), 1],
        ['r16-split-cat-redir-48k', 'c"at" output >result. '.repeat(2181).padEnd(48000, ' '), 1],
        ['r16-paired-angle-redir-48k', '"cat" output <README> result. '.repeat(1600).padEnd(48000, ' '), 1],
        ['r16-repeat-cat-quote-48k', '"cat" '.repeat(8000), 1],
        ['r16-angle-section-48k', '<section> '.repeat(4800), 0]
      ]) {
        assert.ok(Buffer.byteLength(payload, 'utf8') >= 48000, `Expected >=48KB for ${label}`);
        const t0 = performance.now();
        const deps = extractVerificationDependencies([payload]);
        const elapsedMs = performance.now() - t0;
        assert.ok(elapsedMs < 20, `Expected <20ms for ${label}, got ${elapsedMs.toFixed(2)}ms`);
        if (expectMinDeps === 0) {
          assert.deepEqual(deps.workspaceBroadDeps, [], `Expected 0 broad deps for ${label}`);
        } else {
          assert.ok(deps.workspaceBroadDeps.length >= expectMinDeps, `Expected broad deps for ${label}`);
        }
      }
    });

    it('ReReview-102 Round 17 fixes: enforces bare runtime numeric redirections, leading paired redirections before split-quoted commands, and <20ms 48KB linear escape/segment scanning', async () => {
      const sampleAuthProof = {
        id: 'P1',
        seatId: 's1',
        round: 1,
        kind: 'claim',
        source: 'src/auth.js',
        statement: 'Token expiry verified in src/auth.js.'
      };
      const sampleCandidate = {
        id: 'C1',
        round: 1,
        summary: 'Token expiry handling in src/auth.js.',
        admittedProofIds: ['P1']
      };
      const sampleObjections = [{ seatId: 's2', proofId: 'P1', reason: 'Verify token expiry details.' }];
      const allFivePhases = [
        'R1_DELIBERATION',
        'R2_DELIBERATION',
        'JUDGE_AUDIT_SYNTHESIS_R1',
        'JUDGE_AUDIT_SYNTHESIS_R2',
        'VOTING'
      ];
      const defaultCovered = ['src/auth.js', 'README'];

      function buildReadinessInputs({
        phase = 'DELIBERATION',
        round = 1,
        errorClass,
        topic = 'Inspect src/auth.js.',
        proofs = [],
        priorProofs = [],
        previousCandidate = undefined,
        openObjections = [],
        candidate = undefined,
        admittedProofs = []
      }) {
        return {
          phase,
          round,
          errorClass,
          topic,
          clarifications: [],
          proofs,
          priorProofs,
          previousCandidate,
          openObjections,
          candidate,
          admittedProofs,
          evidence: defaultCovered.map((source, i) => ({
            id: `E${i + 1}`,
            source,
            text: `complete snapshot for ${source}`
          })),
          selfContainedInput: {
            phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
            roundScope: 'all_rounds',
            coveredArtifacts: defaultCovered.map((source, i) => ({
              source,
              evidenceId: `E${i + 1}`,
              coverage: 'complete_artifact'
            }))
          },
          originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo' }
        };
      }

      async function executePhaseEngine({ phase, errorClass, topic = 'Inspect src/auth.js.', s1Proof = null }) {
        const mock = new MockAdapter();
        const targetCalls = [];
        const origProof = mock.executeSeatProof.bind(mock);
        const origJudge = mock.executeJudgeAuditAndSynthesis.bind(mock);
        const origVote = mock.executeSeatVote.bind(mock);
        const makeFault = (participantId) =>
          errorClass === 'TimeoutError'
            ? new TimeoutError(`${phase} timeout`, { timeoutMs: 1000, harness: 'codex', seatId: participantId })
            : new HeadlessToolDeniedError(`${phase} tool denied`, {
                harness: 'codex',
                seatId: participantId,
                exitCode: 0,
                isRetryable: true
              });

        mock.executeSeatProof = async (ctx) => {
          if (
            (phase === 'R1_DELIBERATION' && ctx.round === 1 && ctx.seat.id === 's1') ||
            (phase === 'R2_DELIBERATION' && ctx.round === 2 && ctx.seat.id === 's2')
          ) {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) throw makeFault(ctx.seat.id);
          }
          if (ctx.round === 1 && ctx.seat.id === 's1' && s1Proof) return s1Proof;
          return origProof(ctx);
        };
        mock.executeJudgeAuditAndSynthesis = async (ctx) => {
          if (
            (phase === 'JUDGE_AUDIT_SYNTHESIS_R1' && ctx.round === 1) ||
            (phase === 'JUDGE_AUDIT_SYNTHESIS_R2' && ctx.round === 2)
          ) {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) throw makeFault('judge');
          }
          return origJudge(ctx);
        };
        mock.executeSeatVote = async (ctx) => {
          if (phase === 'VOTING' && ctx.round === 1 && ctx.seat.id === 's1') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) throw makeFault('s1');
          }
          if ((phase === 'R2_DELIBERATION' || phase === 'JUDGE_AUDIT_SYNTHESIS_R2') && ctx.round === 1 && ctx.seat.id === 's2') {
            return { vote: 'object', proofId: 'P1', reason: 'Dispute R1 proof in R2' };
          }
          return origVote(ctx);
        };

        const engine = new CouncilEngine(
          {
            topic,
            clarifications: [],
            maxClarificationBatches: 0,
            minQuorum: 2,
            maxRounds: phase === 'R2_DELIBERATION' || phase === 'JUDGE_AUDIT_SYNTHESIS_R2' ? 2 : 1,
            maxRetriesPerSeat: 1,
            maxRetriesPerJudge: 1,
            cwd: '/repo',
            evidence: defaultCovered.map((source, i) => ({
              id: `E${i + 1}`,
              label: `Artifact ${i + 1}`,
              source,
              text: `complete snapshot for ${source}`
            })),
            selfContainedInput: {
              kind: 'full_context',
              label: 'R17 regression matrix',
              phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
              roundScope: 'all_rounds',
              coveredArtifacts: defaultCovered.map((source, i) => ({
                source,
                evidenceId: `E${i + 1}`,
                coverage: 'complete_artifact'
              }))
            },
            judge: { id: 'judge', harness: 'codex', model: 'gpt-6-astra (high)', tools: 'read-only', cwd: '/repo' },
            seats: [
              { id: 's1', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S1', tools: 'read-only', votingTools: 'read-only', cwd: '/repo' },
              { id: 's2', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S2', tools: 'read-only', cwd: '/repo' },
              { id: 's3', harness: 'cursor', model: 'grok-4', soul: 'S3', tools: 'none' }
            ]
          },
          { harnessResolver: () => mock }
        );
        await engine.run();
        return { targetCalls };
      }

      const readinessPhaseCases = [
        ['DELIBERATION', 1, {}],
        ['DELIBERATION', 2, { priorProofs: [sampleAuthProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }],
        ['JUDGE_AUDIT_SYNTHESIS', 1, { proofs: [sampleAuthProof] }],
        ['JUDGE_AUDIT_SYNTHESIS', 2, { proofs: [sampleAuthProof], priorProofs: [sampleAuthProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }],
        ['VOTING', 1, { candidate: sampleCandidate, admittedProofs: [sampleAuthProof] }]
      ];

      function evaluateCheckProofReadiness(checkProof, phaseName, round, errorClass) {
        const extra =
          phaseName === 'DELIBERATION'
            ? { priorProofs: [checkProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }
            : phaseName === 'JUDGE_AUDIT_SYNTHESIS' && round === 1
              ? { proofs: [checkProof] }
              : phaseName === 'JUDGE_AUDIT_SYNTHESIS'
                ? { proofs: [checkProof], priorProofs: [checkProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }
                : { candidate: sampleCandidate, admittedProofs: [checkProof] };
        return evaluateToolFreeEvidenceReadiness(buildReadinessInputs({ phase: phaseName, round, errorClass, ...extra }));
      }

      const mustRefuseTopics = [
        'Inspect src/auth.js. Verify node > 22',
        'Inspect src/auth.js. Verify node > 22.',
        'Inspect src/auth.js. node > 22',
        'Inspect src/auth.js. Verify python < 3.12',
        'Inspect src/auth.js. Verify git > 2',
        'Inspect src/auth.js. Verify > 22 c"at" output',
        'Inspect src/auth.js. Verify > 22 ls',
        'Inspect src/auth.js. Verify <section> and c"at" output',
        'Inspect src/auth.js. Verify <section> and \'cat\' output',
        'Inspect src/auth.js. Verify <section> and cat src/auth.js',
        'Inspect src/auth.js. Verify <section> and ls',
        'Inspect src/auth.js. Verify <section> and ./run.sh'
      ];

      for (const topic of mustRefuseTopics) {
        const deps = extractVerificationDependencies([topic]);
        assert.ok(deps.workspaceBroadDeps.length >= 1, `Expected broad dep for topic: ${topic}`);
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          for (const [phase, round, extra] of readinessPhaseCases) {
            const verdict = evaluateToolFreeEvidenceReadiness(
              buildReadinessInputs({ phase, round, errorClass, topic, ...extra })
            );
            assert.equal(verdict.ready, false, `${phase} R${round}/${errorClass} must refuse: ${topic}`);
            assert.equal(verdict.reasonCode, 'evidence_access_failure');
          }
          for (const enginePhase of allFivePhases) {
            const run = await executePhaseEngine({ phase: enginePhase, errorClass, topic });
            assert.equal(run.targetCalls.length, 1, `Engine ${enginePhase}/${errorClass} must refuse: ${topic}`);
          }
        }
      }

      for (const [label, checkSource, checkStatement] of [
        ['kind:check bare node > 22 statement', 'src/auth.js', 'Verify node > 22'],
        ['kind:check bare node > 22 source', 'Verify node > 22', 'Checked src/auth.js'],
        ['kind:check leading paired redir split-quote statement', 'src/auth.js', 'Verify <section> and c"at" output'],
        ['kind:check leading paired redir split-quote source', 'Verify <section> and c"at" output', 'Checked src/auth.js']
      ]) {
        const checkDeps = extractVerificationDependencies([checkSource, checkStatement]);
        assert.ok(checkDeps.workspaceBroadDeps.length >= 1, `Expected broad dep for ${label}`);
        const checkProof = {
          id: 'P1',
          seatId: 's1',
          round: 1,
          scope: 'Verify workspace evidence',
          kind: 'check',
          source: checkSource,
          statement: checkStatement
        };
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          for (const [phaseName, round] of [
            ['DELIBERATION', 2],
            ['JUDGE_AUDIT_SYNTHESIS', 1],
            ['JUDGE_AUDIT_SYNTHESIS', 2],
            ['VOTING', 1]
          ]) {
            const verdict = evaluateCheckProofReadiness(checkProof, phaseName, round, errorClass);
            assert.equal(verdict.ready, false, `${label}: ${phaseName} R${round}/${errorClass} must refuse`);
            assert.equal(verdict.reasonCode, 'evidence_access_failure');
          }
          for (const enginePhase of ['R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS_R1', 'JUDGE_AUDIT_SYNTHESIS_R2', 'VOTING']) {
            const run = await executePhaseEngine({ phase: enginePhase, errorClass, s1Proof: checkProof });
            assert.equal(run.targetCalls.length, 1, `${label}: engine ${enginePhase}/${errorClass} must refuse`);
          }
        }
      }

      const positiveProseControls = [
        'Inspect src/auth.js. Notes <section> and >quote do not invoke shell commands.',
        'Inspect src/auth.js. Keys "cat", "node", and "sh" in Notes <section> and >quote do not invoke shell commands.',
        'Inspect src/auth.js. Summary <code>auth</code> is valid.',
        'Inspect src/auth.js. Target Node >= 22, node > 22, python < 3.12, and git -> main or node => callback are valid.',
        'Inspect src/auth.js. Ensure each node validates inputs and python < 3.12 is rejected while latency < 20ms.',
        'Inspect src/auth.js. Requires node >= 22 and python < 3.12 while value > 22 is valid.',
        'Inspect src/auth.js. Ensure Node > 22 for ESM and python < 3.12 in CI.'
      ];
      for (const proseTopic of positiveProseControls) {
        const deps = extractVerificationDependencies([proseTopic]);
        assert.deepEqual(deps.workspaceBroadDeps, [], `Expected 0 broad deps for prose control: ${proseTopic}`);
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          for (const [phase, round, extra] of readinessPhaseCases) {
            const verdict = evaluateToolFreeEvidenceReadiness(
              buildReadinessInputs({ phase, round, errorClass, topic: proseTopic, ...extra })
            );
            assert.equal(verdict.ready, true, `${phase} R${round}/${errorClass} must permit prose control: ${proseTopic}`);
          }
          for (const phase of allFivePhases) {
            const run = await executePhaseEngine({ phase, errorClass, topic: proseTopic });
            assert.equal(run.targetCalls.length, 2, `Prose control must allow retry (${phase}/${errorClass}): ${proseTopic}`);
            assert.equal(run.targetCalls[1].tools, 'none');
            assert.equal(run.targetCalls[1].cwd, undefined);
          }
        }
      }

      // Warmup + <20ms 48KB linear escape, markup/segment, and comparison scan bounds
      extractVerificationDependencies(['Inspect src/auth.js "cat" output >result. <section> value > 22 \\.a']);
      for (const [label, payload, expectMinDeps] of [
        ['r17-escaped-dots-48k', '\\.'.repeat(24000), 0],
        ['r17-escaped-dot-a-48k', '\\.a'.repeat(16000), 0],
        ['r17-section-and-48k', '<section> and '.repeat(3428).padEnd(48000, ' '), 0],
        ['r17-value-gt-22-48k', 'value > 22 '.repeat(4363).padEnd(48000, ' '), 0],
        ['r17-repeat-cat-redir-48k', '"cat" output >result. '.repeat(2181).padEnd(48000, ' '), 1]
      ]) {
        assert.ok(Buffer.byteLength(payload, 'utf8') >= 48000, `Expected >=48KB for ${label}`);
        const t0 = performance.now();
        const deps = extractVerificationDependencies([payload]);
        const elapsedMs = performance.now() - t0;
        assert.ok(elapsedMs < 20, `Expected <20ms for ${label}, got ${elapsedMs.toFixed(2)}ms`);
        if (expectMinDeps === 0) {
          assert.deepEqual(deps.workspaceBroadDeps, [], `Expected 0 broad deps for ${label}`);
        } else {
          assert.ok(deps.workspaceBroadDeps.length >= expectMinDeps, `Expected broad deps for ${label}`);
        }
      }
    });

    it('ReReview-102 Round 18 fix: expires prose comparison context at sentence boundaries while preserving comma-separated version lists', async () => {
      const sampleAuthProof = {
        id: 'P1',
        seatId: 's1',
        round: 1,
        kind: 'claim',
        source: 'src/auth.js',
        statement: 'Token expiry verified in src/auth.js.'
      };
      const sampleCandidate = {
        id: 'C1',
        round: 1,
        summary: 'Token expiry handling in src/auth.js.',
        admittedProofIds: ['P1']
      };
      const sampleObjections = [{ seatId: 's2', proofId: 'P1', reason: 'Verify token expiry details.' }];
      const allFivePhases = [
        'R1_DELIBERATION',
        'R2_DELIBERATION',
        'JUDGE_AUDIT_SYNTHESIS_R1',
        'JUDGE_AUDIT_SYNTHESIS_R2',
        'VOTING'
      ];
      const defaultCovered = ['src/auth.js', 'README'];

      function buildReadinessInputs({
        phase = 'DELIBERATION',
        round = 1,
        errorClass,
        topic = 'Inspect src/auth.js.',
        proofs = [],
        priorProofs = [],
        previousCandidate = undefined,
        openObjections = [],
        candidate = undefined,
        admittedProofs = []
      }) {
        return {
          phase,
          round,
          errorClass,
          topic,
          clarifications: [],
          proofs,
          priorProofs,
          previousCandidate,
          openObjections,
          candidate,
          admittedProofs,
          evidence: defaultCovered.map((source, i) => ({
            id: `E${i + 1}`,
            source,
            text: `complete snapshot for ${source}`
          })),
          selfContainedInput: {
            phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
            roundScope: 'all_rounds',
            coveredArtifacts: defaultCovered.map((source, i) => ({
              source,
              evidenceId: `E${i + 1}`,
              coverage: 'complete_artifact'
            }))
          },
          originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo' }
        };
      }

      async function executePhaseEngine({ phase, errorClass, topic = 'Inspect src/auth.js.', s1Proof = null }) {
        const mock = new MockAdapter();
        const targetCalls = [];
        const origProof = mock.executeSeatProof.bind(mock);
        const origJudge = mock.executeJudgeAuditAndSynthesis.bind(mock);
        const origVote = mock.executeSeatVote.bind(mock);
        const makeFault = (participantId) =>
          errorClass === 'TimeoutError'
            ? new TimeoutError(`${phase} timeout`, { timeoutMs: 1000, harness: 'codex', seatId: participantId })
            : new HeadlessToolDeniedError(`${phase} tool denied`, {
                harness: 'codex',
                seatId: participantId,
                exitCode: 0,
                isRetryable: true
              });

        mock.executeSeatProof = async (ctx) => {
          if (
            (phase === 'R1_DELIBERATION' && ctx.round === 1 && ctx.seat.id === 's1') ||
            (phase === 'R2_DELIBERATION' && ctx.round === 2 && ctx.seat.id === 's2')
          ) {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) throw makeFault(ctx.seat.id);
          }
          if (ctx.round === 1 && ctx.seat.id === 's1' && s1Proof) return s1Proof;
          return origProof(ctx);
        };
        mock.executeJudgeAuditAndSynthesis = async (ctx) => {
          if (
            (phase === 'JUDGE_AUDIT_SYNTHESIS_R1' && ctx.round === 1) ||
            (phase === 'JUDGE_AUDIT_SYNTHESIS_R2' && ctx.round === 2)
          ) {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) throw makeFault('judge');
          }
          return origJudge(ctx);
        };
        mock.executeSeatVote = async (ctx) => {
          if (phase === 'VOTING' && ctx.round === 1 && ctx.seat.id === 's1') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) throw makeFault('s1');
          }
          if ((phase === 'R2_DELIBERATION' || phase === 'JUDGE_AUDIT_SYNTHESIS_R2') && ctx.round === 1 && ctx.seat.id === 's2') {
            return { vote: 'object', proofId: 'P1', reason: 'Dispute R1 proof in R2' };
          }
          return origVote(ctx);
        };

        const engine = new CouncilEngine(
          {
            topic,
            clarifications: [],
            maxClarificationBatches: 0,
            minQuorum: 2,
            maxRounds: phase === 'R2_DELIBERATION' || phase === 'JUDGE_AUDIT_SYNTHESIS_R2' ? 2 : 1,
            maxRetriesPerSeat: 1,
            maxRetriesPerJudge: 1,
            cwd: '/repo',
            evidence: defaultCovered.map((source, i) => ({
              id: `E${i + 1}`,
              label: `Artifact ${i + 1}`,
              source,
              text: `complete snapshot for ${source}`
            })),
            selfContainedInput: {
              kind: 'full_context',
              label: 'R18 sentence-boundary regression matrix',
              phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
              roundScope: 'all_rounds',
              coveredArtifacts: defaultCovered.map((source, i) => ({
                source,
                evidenceId: `E${i + 1}`,
                coverage: 'complete_artifact'
              }))
            },
            judge: { id: 'judge', harness: 'codex', model: 'gpt-6-astra (high)', tools: 'read-only', cwd: '/repo' },
            seats: [
              { id: 's1', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S1', tools: 'read-only', votingTools: 'read-only', cwd: '/repo' },
              { id: 's2', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S2', tools: 'read-only', cwd: '/repo' },
              { id: 's3', harness: 'cursor', model: 'grok-4', soul: 'S3', tools: 'none' }
            ]
          },
          { harnessResolver: () => mock }
        );
        await engine.run();
        return { targetCalls };
      }

      const readinessPhaseCases = [
        ['DELIBERATION', 1, {}],
        ['DELIBERATION', 2, { priorProofs: [sampleAuthProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }],
        ['JUDGE_AUDIT_SYNTHESIS', 1, { proofs: [sampleAuthProof] }],
        ['JUDGE_AUDIT_SYNTHESIS', 2, { proofs: [sampleAuthProof], priorProofs: [sampleAuthProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }],
        ['VOTING', 1, { candidate: sampleCandidate, admittedProofs: [sampleAuthProof] }]
      ];

      function evaluateCheckProofReadiness(checkProof, phaseName, round, errorClass) {
        const extra =
          phaseName === 'DELIBERATION'
            ? { priorProofs: [checkProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }
            : phaseName === 'JUDGE_AUDIT_SYNTHESIS' && round === 1
              ? { proofs: [checkProof] }
              : phaseName === 'JUDGE_AUDIT_SYNTHESIS'
                ? { proofs: [checkProof], priorProofs: [checkProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }
                : { candidate: sampleCandidate, admittedProofs: [checkProof] };
        return evaluateToolFreeEvidenceReadiness(buildReadinessInputs({ phase: phaseName, round, errorClass, ...extra }));
      }

      const mustRefuseTopics = [
        'Inspect src/auth.js. Ensure latency < 20ms. Verify node > 22',
        'Inspect src/auth.js. Requires Node >= 22. Verify node > 22.',
        'Inspect src/auth.js. Ensure latency < 20ms. Verify python < 3.12',
        'Inspect src/auth.js. Ensure latency < 20ms. Verify git > 2',
        'Inspect src/auth.js. Requires Node >= 22. node > 22',
        'Inspect src/auth.js. Ensure latency < 20ms! Verify node > 22',
        'Inspect src/auth.js. Is latency < 20ms? Verify node > 22',
        'Inspect src/auth.js. Note latency < 20ms: Verify node > 22',
        'Inspect src/auth.js. Ensure latency < 20ms, Verify node > 22',
        'Inspect src/auth.js. Requires Node >= 22, Verify node > 22',
        'Inspect src/auth.js. Ensure latency < 20ms and verify node > 22',
        'Inspect src/auth.js. Ensure latency < 20ms, node > 22'
      ];

      for (const topic of mustRefuseTopics) {
        const deps = extractVerificationDependencies([topic]);
        assert.ok(deps.workspaceBroadDeps.length >= 1, `Expected broad dep for topic: ${topic}`);
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          for (const [phase, round, extra] of readinessPhaseCases) {
            const verdict = evaluateToolFreeEvidenceReadiness(
              buildReadinessInputs({ phase, round, errorClass, topic, ...extra })
            );
            assert.equal(verdict.ready, false, `${phase} R${round}/${errorClass} must refuse: ${topic}`);
            assert.equal(verdict.reasonCode, 'evidence_access_failure');
          }
          for (const enginePhase of allFivePhases) {
            const run = await executePhaseEngine({ phase: enginePhase, errorClass, topic });
            assert.equal(run.targetCalls.length, 1, `Engine ${enginePhase}/${errorClass} must refuse: ${topic}`);
          }
        }
      }

      const r18CheckTexts = [
        'Inspect src/auth.js. Ensure latency < 20ms. Verify node > 22',
        'Inspect src/auth.js. Requires Node >= 22. Verify node > 22.',
        'Inspect src/auth.js. Ensure latency < 20ms. Verify python < 3.12',
        'Inspect src/auth.js. Ensure latency < 20ms. Verify git > 2'
      ];
      for (const text of r18CheckTexts) {
        for (const [field, checkSource, checkStatement] of [
          ['statement', 'src/auth.js', text],
          ['source', text, 'Checked src/auth.js']
        ]) {
          const checkDeps = extractVerificationDependencies([checkSource, checkStatement]);
          assert.ok(checkDeps.workspaceBroadDeps.length >= 1, `Expected broad dep for kind:check ${field}: ${text}`);
          const checkProof = {
            id: 'P1',
            seatId: 's1',
            round: 1,
            scope: 'Verify workspace evidence',
            kind: 'check',
            source: checkSource,
            statement: checkStatement
          };
          for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
            for (const [phaseName, round] of [
              ['DELIBERATION', 2],
              ['JUDGE_AUDIT_SYNTHESIS', 1],
              ['JUDGE_AUDIT_SYNTHESIS', 2],
              ['VOTING', 1]
            ]) {
              const verdict = evaluateCheckProofReadiness(checkProof, phaseName, round, errorClass);
              assert.equal(verdict.ready, false, `kind:check ${field}: ${phaseName} R${round}/${errorClass} must refuse: ${text}`);
              assert.equal(verdict.reasonCode, 'evidence_access_failure');
            }
            for (const enginePhase of ['R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS_R1', 'JUDGE_AUDIT_SYNTHESIS_R2', 'VOTING']) {
              const run = await executePhaseEngine({ phase: enginePhase, errorClass, s1Proof: checkProof });
              assert.equal(run.targetCalls.length, 1, `kind:check ${field}: engine ${enginePhase}/${errorClass} must refuse: ${text}`);
            }
          }
        }
      }

      const positiveProseControls = [
        'Inspect src/auth.js. Target Node >= 22, node > 22, python < 3.12.',
        'Inspect src/auth.js. Target Node >= 22, node > 22, and python < 3.12.',
        'Inspect src/auth.js. Target Node >= 22, python < 3.12.',
        'Inspect src/auth.js. Requires node >= 22 and python < 3.12.',
        'Inspect src/auth.js. Ensure latency < 20ms, memory < 512MB, and python < 3.12.',
        'Inspect src/auth.js. Ensure latency < 20ms and python < 3.12.',
        'Inspect src/auth.js. Ensure git -> main and python < 3.12.'
      ];
      for (const proseTopic of positiveProseControls) {
        const deps = extractVerificationDependencies([proseTopic]);
        assert.deepEqual(deps.workspaceBroadDeps, [], `Expected 0 broad deps for prose control: ${proseTopic}`);
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          for (const [phase, round, extra] of readinessPhaseCases) {
            const verdict = evaluateToolFreeEvidenceReadiness(
              buildReadinessInputs({ phase, round, errorClass, topic: proseTopic, ...extra })
            );
            assert.equal(verdict.ready, true, `${phase} R${round}/${errorClass} must permit prose control: ${proseTopic}`);
          }
          for (const phase of allFivePhases) {
            const run = await executePhaseEngine({ phase, errorClass, topic: proseTopic });
            assert.equal(run.targetCalls.length, 2, `Prose control must allow retry (${phase}/${errorClass}): ${proseTopic}`);
            assert.equal(run.targetCalls[1].tools, 'none');
            assert.equal(run.targetCalls[1].cwd, undefined);
          }
        }
      }

      extractVerificationDependencies(['Ensure latency < 20ms. Target Node >= 22, node > 22, python < 3.12.']);
      for (const [label, payload] of [
        ['r18-sentence-latency-48k', 'Ensure latency < 20ms. '.repeat(2087).slice(0, 48000)],
        ['r18-comma-versions-48k', 'Target Node >= 22, node > 22, python < 3.12. '.repeat(1091).slice(0, 48000)]
      ]) {
        assert.ok(Buffer.byteLength(payload, 'utf8') >= 48000, `Expected >=48KB for ${label}`);
        const t0 = performance.now();
        const deps = extractVerificationDependencies([payload]);
        const elapsedMs = performance.now() - t0;
        assert.ok(elapsedMs < 20, `Expected <20ms for ${label}, got ${elapsedMs.toFixed(2)}ms`);
        assert.deepEqual(deps.workspaceBroadDeps, [], `Expected 0 broad deps for ${label}`);
      }
    });

    it('ReReview-102 Round 19 fixes: bounds forward comparison context to the same sentence, requires genuine comma coordination, unifies separated units, and skips matched inline close HTML tags', async () => {
      const sampleAuthProof = {
        id: 'P1',
        seatId: 's1',
        round: 1,
        kind: 'claim',
        source: 'src/auth.js',
        statement: 'Token expiry verified in src/auth.js.'
      };
      const sampleCandidate = {
        id: 'C1',
        round: 1,
        summary: 'Token expiry handling in src/auth.js.',
        admittedProofIds: ['P1']
      };
      const sampleObjections = [{ seatId: 's2', proofId: 'P1', reason: 'Verify token expiry details.' }];
      const allFivePhases = [
        'R1_DELIBERATION',
        'R2_DELIBERATION',
        'JUDGE_AUDIT_SYNTHESIS_R1',
        'JUDGE_AUDIT_SYNTHESIS_R2',
        'VOTING'
      ];
      const defaultCovered = ['src/auth.js', 'README'];

      function buildReadinessInputs({
        phase = 'DELIBERATION',
        round = 1,
        errorClass,
        topic = 'Inspect src/auth.js.',
        proofs = [],
        priorProofs = [],
        previousCandidate = undefined,
        openObjections = [],
        candidate = undefined,
        admittedProofs = []
      }) {
        return {
          phase,
          round,
          errorClass,
          topic,
          clarifications: [],
          proofs,
          priorProofs,
          previousCandidate,
          openObjections,
          candidate,
          admittedProofs,
          evidence: defaultCovered.map((source, i) => ({
            id: `E${i + 1}`,
            source,
            text: `complete snapshot for ${source}`
          })),
          selfContainedInput: {
            phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
            roundScope: 'all_rounds',
            coveredArtifacts: defaultCovered.map((source, i) => ({
              source,
              evidenceId: `E${i + 1}`,
              coverage: 'complete_artifact'
            }))
          },
          originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo' }
        };
      }

      async function executePhaseEngine({ phase, errorClass, topic = 'Inspect src/auth.js.', s1Proof = null }) {
        const mock = new MockAdapter();
        const targetCalls = [];
        const origProof = mock.executeSeatProof.bind(mock);
        const origJudge = mock.executeJudgeAuditAndSynthesis.bind(mock);
        const origVote = mock.executeSeatVote.bind(mock);
        const makeFault = (participantId) =>
          errorClass === 'TimeoutError'
            ? new TimeoutError(`${phase} timeout`, { timeoutMs: 1000, harness: 'codex', seatId: participantId })
            : new HeadlessToolDeniedError(`${phase} tool denied`, {
                harness: 'codex',
                seatId: participantId,
                exitCode: 0,
                isRetryable: true
              });

        mock.executeSeatProof = async (ctx) => {
          if (
            (phase === 'R1_DELIBERATION' && ctx.round === 1 && ctx.seat.id === 's1') ||
            (phase === 'R2_DELIBERATION' && ctx.round === 2 && ctx.seat.id === 's2')
          ) {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) throw makeFault(ctx.seat.id);
          }
          if (ctx.round === 1 && ctx.seat.id === 's1' && s1Proof) return s1Proof;
          return origProof(ctx);
        };
        mock.executeJudgeAuditAndSynthesis = async (ctx) => {
          if (
            (phase === 'JUDGE_AUDIT_SYNTHESIS_R1' && ctx.round === 1) ||
            (phase === 'JUDGE_AUDIT_SYNTHESIS_R2' && ctx.round === 2)
          ) {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) throw makeFault('judge');
          }
          return origJudge(ctx);
        };
        mock.executeSeatVote = async (ctx) => {
          if (phase === 'VOTING' && ctx.round === 1 && ctx.seat.id === 's1') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) throw makeFault('s1');
          }
          if ((phase === 'R2_DELIBERATION' || phase === 'JUDGE_AUDIT_SYNTHESIS_R2') && ctx.round === 1 && ctx.seat.id === 's2') {
            return { vote: 'object', proofId: 'P1', reason: 'Dispute R1 proof in R2' };
          }
          return origVote(ctx);
        };

        const engine = new CouncilEngine(
          {
            topic,
            clarifications: [],
            maxClarificationBatches: 0,
            minQuorum: 2,
            maxRounds: phase === 'R2_DELIBERATION' || phase === 'JUDGE_AUDIT_SYNTHESIS_R2' ? 2 : 1,
            maxRetriesPerSeat: 1,
            maxRetriesPerJudge: 1,
            cwd: '/repo',
            evidence: defaultCovered.map((source, i) => ({
              id: `E${i + 1}`,
              label: `Artifact ${i + 1}`,
              source,
              text: `complete snapshot for ${source}`
            })),
            selfContainedInput: {
              kind: 'full_context',
              label: 'R19 sentence-boundary & unit parity regression matrix',
              phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
              roundScope: 'all_rounds',
              coveredArtifacts: defaultCovered.map((source, i) => ({
                source,
                evidenceId: `E${i + 1}`,
                coverage: 'complete_artifact'
              }))
            },
            judge: { id: 'judge', harness: 'codex', model: 'gpt-6-astra (high)', tools: 'read-only', cwd: '/repo' },
            seats: [
              { id: 's1', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S1', tools: 'read-only', votingTools: 'read-only', cwd: '/repo' },
              { id: 's2', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S2', tools: 'read-only', cwd: '/repo' },
              { id: 's3', harness: 'cursor', model: 'grok-4', soul: 'S3', tools: 'none' }
            ]
          },
          { harnessResolver: () => mock }
        );
        await engine.run();
        return { targetCalls };
      }

      const readinessPhaseCases = [
        ['DELIBERATION', 1, {}],
        ['DELIBERATION', 2, { priorProofs: [sampleAuthProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }],
        ['JUDGE_AUDIT_SYNTHESIS', 1, { proofs: [sampleAuthProof] }],
        ['JUDGE_AUDIT_SYNTHESIS', 2, { proofs: [sampleAuthProof], priorProofs: [sampleAuthProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }],
        ['VOTING', 1, { candidate: sampleCandidate, admittedProofs: [sampleAuthProof] }]
      ];

      function evaluateCheckProofReadiness(checkProof, phaseName, round, errorClass) {
        const extra =
          phaseName === 'DELIBERATION'
            ? { priorProofs: [checkProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }
            : phaseName === 'JUDGE_AUDIT_SYNTHESIS' && round === 1
              ? { proofs: [checkProof] }
              : phaseName === 'JUDGE_AUDIT_SYNTHESIS'
                ? { proofs: [checkProof], priorProofs: [checkProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }
                : { candidate: sampleCandidate, admittedProofs: [checkProof] };
        return evaluateToolFreeEvidenceReadiness(buildReadinessInputs({ phase: phaseName, round, errorClass, ...extra }));
      }

      const mustRefuseTopics = [
        'Inspect src/auth.js. Ensure latency < 20ms. Verify node > 22. And latency < 20ms.',
        'Inspect src/auth.js. Ensure latency < 20ms. Verify node > 22! And latency < 20ms.',
        'Inspect src/auth.js. Ensure latency < 20ms. Verify node > 22? And latency < 20ms.',
        'Inspect src/auth.js. Ensure latency < 20ms. Verify node > 22: and latency < 20ms.',
        'Inspect src/auth.js. Verify node > 22, verify latency < 20ms',
        'Inspect src/auth.js. node > 22, verify latency < 20ms',
        'Inspect src/auth.js. Verify node > 22 and verify latency < 20ms',
        'Inspect src/auth.js. Ensure width < 20 px. Verify node > 22',
        'Inspect src/auth.js. Ensure <em>latency</em> < 20ms. Verify <em>node</em> > 22',
        'Inspect src/auth.js. cat</etc>'
      ];

      for (const topic of mustRefuseTopics) {
        const deps = extractVerificationDependencies([topic]);
        assert.ok(deps.workspaceBroadDeps.length >= 1, `Expected broad dep for topic: ${topic}`);
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          for (const [phase, round, extra] of readinessPhaseCases) {
            const verdict = evaluateToolFreeEvidenceReadiness(
              buildReadinessInputs({ phase, round, errorClass, topic, ...extra })
            );
            assert.equal(verdict.ready, false, `${phase} R${round}/${errorClass} must refuse: ${topic}`);
            assert.equal(verdict.reasonCode, 'evidence_access_failure');
          }
          for (const enginePhase of allFivePhases) {
            const run = await executePhaseEngine({ phase: enginePhase, errorClass, topic });
            assert.equal(run.targetCalls.length, 1, `Engine ${enginePhase}/${errorClass} must refuse: ${topic}`);
          }
        }
      }

      const r19CheckTexts = [
        'Inspect src/auth.js. Ensure latency < 20ms. Verify node > 22. And latency < 20ms.',
        'Inspect src/auth.js. Verify node > 22, verify latency < 20ms'
      ];
      for (const text of r19CheckTexts) {
        for (const [field, checkSource, checkStatement] of [
          ['statement', 'src/auth.js', text],
          ['source', text, 'Checked src/auth.js']
        ]) {
          const checkDeps = extractVerificationDependencies([checkSource, checkStatement]);
          assert.ok(checkDeps.workspaceBroadDeps.length >= 1, `Expected broad dep for kind:check ${field}: ${text}`);
          const checkProof = {
            id: 'P1',
            seatId: 's1',
            round: 1,
            scope: 'Verify workspace evidence',
            kind: 'check',
            source: checkSource,
            statement: checkStatement
          };
          for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
            for (const [phaseName, round] of [
              ['DELIBERATION', 2],
              ['JUDGE_AUDIT_SYNTHESIS', 1],
              ['JUDGE_AUDIT_SYNTHESIS', 2],
              ['VOTING', 1]
            ]) {
              const verdict = evaluateCheckProofReadiness(checkProof, phaseName, round, errorClass);
              assert.equal(verdict.ready, false, `kind:check ${field}: ${phaseName} R${round}/${errorClass} must refuse: ${text}`);
              assert.equal(verdict.reasonCode, 'evidence_access_failure');
            }
            for (const enginePhase of ['R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS_R1', 'JUDGE_AUDIT_SYNTHESIS_R2', 'VOTING']) {
              const run = await executePhaseEngine({ phase: enginePhase, errorClass, s1Proof: checkProof });
              assert.equal(run.targetCalls.length, 1, `kind:check ${field}: engine ${enginePhase}/${errorClass} must refuse: ${text}`);
            }
          }
        }
      }

      const positiveProseControls = [
        'Inspect src/auth.js. Ensure width < 20 px and python < 3.12.',
        'Inspect src/auth.js. Ensure latency < 20 % and python < 3.12.',
        'Inspect src/auth.js. Ensure latency < 20ms and <em>python</em> < 3.12.',
        'Inspect src/auth.js. Target <em>Node</em> >= 22, <em>node</em> > 22, and <code>python</code> < 3.12.',
        'Inspect src/auth.js. Target node > 22, python < 3.12.',
        'Inspect src/auth.js. If node > 22, reject legacy polyfills.'
      ];
      for (const proseTopic of positiveProseControls) {
        const deps = extractVerificationDependencies([proseTopic]);
        assert.deepEqual(deps.workspaceBroadDeps, [], `Expected 0 broad deps for prose control: ${proseTopic}`);
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          for (const [phase, round, extra] of readinessPhaseCases) {
            const verdict = evaluateToolFreeEvidenceReadiness(
              buildReadinessInputs({ phase, round, errorClass, topic: proseTopic, ...extra })
            );
            assert.equal(verdict.ready, true, `${phase} R${round}/${errorClass} must permit prose control: ${proseTopic}`);
          }
          for (const phase of allFivePhases) {
            const run = await executePhaseEngine({ phase, errorClass, topic: proseTopic });
            assert.equal(run.targetCalls.length, 2, `Prose control must allow retry (${phase}/${errorClass}): ${proseTopic}`);
            assert.equal(run.targetCalls[1].tools, 'none');
            assert.equal(run.targetCalls[1].cwd, undefined);
          }
        }
      }

      for (const unit of ['%', 'k', 'x', 'px', 'rem', 'em', 'vh', 'vw']) {
        for (const formTopic of [
          `Inspect src/auth.js. Ensure metric < 20 ${unit} and python < 3.12.`,
          `Inspect src/auth.js. Ensure metric < 20${unit} and python < 3.12.`
        ]) {
          const deps = extractVerificationDependencies([formTopic]);
          assert.deepEqual(deps.workspaceBroadDeps, [], `Expected 0 broad deps for unit '${unit}': ${formTopic}`);
          const verdict = evaluateToolFreeEvidenceReadiness(
            buildReadinessInputs({ phase: 'DELIBERATION', round: 1, errorClass: 'TimeoutError', topic: formTopic })
          );
          assert.equal(verdict.ready, true, `Expected ready: true for unit '${unit}': ${formTopic}`);
        }
      }

      extractVerificationDependencies(['Ensure width < 20 px and <em>python</em> < 3.12.']);
      const payload = 'Ensure width < 20 px and <em>python</em> < 3.12. '.repeat(980).slice(0, 48000);
      assert.ok(Buffer.byteLength(payload, 'utf8') >= 48000, 'Expected >=48KB for r19-units-and-close-tags-48k');
      const t0 = performance.now();
      const deps = extractVerificationDependencies([payload]);
      const elapsedMs = performance.now() - t0;
      assert.ok(elapsedMs < 20, `Expected <20ms for r19-units-and-close-tags-48k, got ${elapsedMs.toFixed(2)}ms`);
      assert.deepEqual(deps.workspaceBroadDeps, [], 'Expected 0 broad deps for r19-units-and-close-tags-48k');
    });

    it('ReReview-102 Round 20 fixes: consumes matched closing HTML tags and marks attached RHS units as consumed', async () => {
      const sampleAuthProof = {
        id: 'P1',
        seatId: 's1',
        round: 1,
        kind: 'claim',
        source: 'src/auth.js',
        statement: 'Token expiry verified in src/auth.js.'
      };
      const sampleCandidate = {
        id: 'C1',
        round: 1,
        summary: 'Token expiry handling in src/auth.js.',
        admittedProofIds: ['P1']
      };
      const sampleObjections = [{ seatId: 's2', proofId: 'P1', reason: 'Verify token expiry details.' }];
      const allFivePhases = [
        'R1_DELIBERATION',
        'R2_DELIBERATION',
        'JUDGE_AUDIT_SYNTHESIS_R1',
        'JUDGE_AUDIT_SYNTHESIS_R2',
        'VOTING'
      ];
      const defaultCovered = ['src/auth.js', 'README'];

      function buildReadinessInputs({
        phase = 'DELIBERATION',
        round = 1,
        errorClass,
        topic = 'Inspect src/auth.js.',
        proofs = [],
        priorProofs = [],
        previousCandidate = undefined,
        openObjections = [],
        candidate = undefined,
        admittedProofs = []
      }) {
        return {
          phase,
          round,
          errorClass,
          topic,
          clarifications: [],
          proofs,
          priorProofs,
          previousCandidate,
          openObjections,
          candidate,
          admittedProofs,
          evidence: defaultCovered.map((source, i) => ({
            id: `E${i + 1}`,
            source,
            text: `complete snapshot for ${source}`
          })),
          selfContainedInput: {
            phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
            roundScope: 'all_rounds',
            coveredArtifacts: defaultCovered.map((source, i) => ({
              source,
              evidenceId: `E${i + 1}`,
              coverage: 'complete_artifact'
            }))
          },
          originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo' }
        };
      }

      async function executePhaseEngine({ phase, errorClass, topic = 'Inspect src/auth.js.', s1Proof = null }) {
        const mock = new MockAdapter();
        const targetCalls = [];
        const origProof = mock.executeSeatProof.bind(mock);
        const origJudge = mock.executeJudgeAuditAndSynthesis.bind(mock);
        const origVote = mock.executeSeatVote.bind(mock);
        const makeFault = (participantId) =>
          errorClass === 'TimeoutError'
            ? new TimeoutError(`${phase} timeout`, { timeoutMs: 1000, harness: 'codex', seatId: participantId })
            : new HeadlessToolDeniedError(`${phase} tool denied`, {
                harness: 'codex',
                seatId: participantId,
                exitCode: 0,
                isRetryable: true
              });

        mock.executeSeatProof = async (ctx) => {
          if (
            (phase === 'R1_DELIBERATION' && ctx.round === 1 && ctx.seat.id === 's1') ||
            (phase === 'R2_DELIBERATION' && ctx.round === 2 && ctx.seat.id === 's2')
          ) {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) throw makeFault(ctx.seat.id);
          }
          if (ctx.round === 1 && ctx.seat.id === 's1' && s1Proof) return s1Proof;
          return origProof(ctx);
        };
        mock.executeJudgeAuditAndSynthesis = async (ctx) => {
          if (
            (phase === 'JUDGE_AUDIT_SYNTHESIS_R1' && ctx.round === 1) ||
            (phase === 'JUDGE_AUDIT_SYNTHESIS_R2' && ctx.round === 2)
          ) {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) throw makeFault('judge');
          }
          return origJudge(ctx);
        };
        mock.executeSeatVote = async (ctx) => {
          if (phase === 'VOTING' && ctx.round === 1 && ctx.seat.id === 's1') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) throw makeFault('s1');
          }
          if (
            (phase === 'R2_DELIBERATION' || phase === 'JUDGE_AUDIT_SYNTHESIS_R2') &&
            ctx.round === 1 &&
            ctx.seat.id === 's2'
          ) {
            return { vote: 'object', proofId: 'P1', reason: 'Dispute R1 proof in R2' };
          }
          return origVote(ctx);
        };

        const engine = new CouncilEngine(
          {
            topic,
            clarifications: [],
            maxClarificationBatches: 0,
            minQuorum: 2,
            maxRounds: phase === 'R2_DELIBERATION' || phase === 'JUDGE_AUDIT_SYNTHESIS_R2' ? 2 : 1,
            maxRetriesPerSeat: 1,
            maxRetriesPerJudge: 1,
            cwd: '/repo',
            evidence: defaultCovered.map((source, i) => ({
              id: `E${i + 1}`,
              label: `Artifact ${i + 1}`,
              source,
              text: `complete snapshot for ${source}`
            })),
            selfContainedInput: {
              kind: 'full_context',
              label: 'R20 close-tag consumption & attached-unit regression matrix',
              phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
              roundScope: 'all_rounds',
              coveredArtifacts: defaultCovered.map((source, i) => ({
                source,
                evidenceId: `E${i + 1}`,
                coverage: 'complete_artifact'
              }))
            },
            judge: { id: 'judge', harness: 'codex', model: 'gpt-6-astra (high)', tools: 'read-only', cwd: '/repo' },
            seats: [
              { id: 's1', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S1', tools: 'read-only', votingTools: 'read-only', cwd: '/repo' },
              { id: 's2', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S2', tools: 'read-only', cwd: '/repo' },
              { id: 's3', harness: 'cursor', model: 'grok-4', soul: 'S3', tools: 'none' }
            ]
          },
          { harnessResolver: () => mock }
        );
        await engine.run();
        return { targetCalls };
      }

      const readinessPhaseCases = [
        ['DELIBERATION', 1, {}],
        ['DELIBERATION', 2, { priorProofs: [sampleAuthProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }],
        ['JUDGE_AUDIT_SYNTHESIS', 1, { proofs: [sampleAuthProof] }],
        ['JUDGE_AUDIT_SYNTHESIS', 2, { proofs: [sampleAuthProof], priorProofs: [sampleAuthProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }],
        ['VOTING', 1, { candidate: sampleCandidate, admittedProofs: [sampleAuthProof] }]
      ];

      function evaluateCheckProofReadiness(checkProof, phaseName, round, errorClass) {
        const extra =
          phaseName === 'DELIBERATION'
            ? { priorProofs: [checkProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }
            : phaseName === 'JUDGE_AUDIT_SYNTHESIS' && round === 1
              ? { proofs: [checkProof] }
              : phaseName === 'JUDGE_AUDIT_SYNTHESIS'
                ? { proofs: [checkProof], priorProofs: [checkProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }
                : { candidate: sampleCandidate, admittedProofs: [checkProof] };
        return evaluateToolFreeEvidenceReadiness(buildReadinessInputs({ phase: phaseName, round, errorClass, ...extra }));
      }

      const mustRefuseTopics = [
        'Inspect src/auth.js. Ensure <em>latency</em> < 20ms. cat</em> out',
        'Inspect src/auth.js. Ensure <em>latency</em> < 20ms. cat </em> out',
        'Inspect src/auth.js. Ensure <em>latency < 20ms. cat</em> out',
        'Inspect src/auth.js. Ensure <em>latency</em> < 20ms and python</em> < 3.12.',
        'Inspect src/auth.js. Ensure latency < 20ms and python</em> < 3.12.',
        'Inspect src/auth.js. Ensure <em>node > 22</em> and python</em> < 3.12.',
        'Inspect src/auth.js. Ensure node > 22 and <em>python < 3.12',
        'Inspect src/auth.js. Ensure node > 22 and <em>python</em></em> < 3.12.',
        'Inspect src/auth.js. Ensure width < 20px rem and python < 3.12.',
        'Inspect src/auth.js. Ensure width < 20 px rem and python < 3.12.',
        'Inspect src/auth.js. Ensure width < 20px rem, and python < 3.12.',
        'Inspect src/auth.js. Ensure latency < 20% px and python < 3.12.',
        'Inspect src/auth.js. Requires Node >= v22 rem and python < 3.12.',
        'Inspect src/auth.js. Ensure git -> main rem and python < 3.12.'
      ];

      for (const topic of mustRefuseTopics) {
        const deps = extractVerificationDependencies([topic]);
        assert.ok(deps.workspaceBroadDeps.length >= 1, `Expected broad dep for topic: ${topic}`);
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          for (const [phase, round, extra] of readinessPhaseCases) {
            const verdict = evaluateToolFreeEvidenceReadiness(
              buildReadinessInputs({ phase, round, errorClass, topic, ...extra })
            );
            assert.equal(verdict.ready, false, `${phase} R${round}/${errorClass} must refuse: ${topic}`);
            assert.equal(verdict.reasonCode, 'evidence_access_failure');
          }
          for (const enginePhase of allFivePhases) {
            const run = await executePhaseEngine({ phase: enginePhase, errorClass, topic });
            assert.equal(run.targetCalls.length, 1, `Engine ${enginePhase}/${errorClass} must refuse: ${topic}`);
          }
        }
      }

      const r20CheckTexts = [
        'Inspect src/auth.js. Ensure <em>latency</em> < 20ms. cat</em> out',
        'Inspect src/auth.js. Ensure width < 20px rem and python < 3.12.'
      ];
      for (const text of r20CheckTexts) {
        for (const [field, checkSource, checkStatement] of [
          ['statement', 'src/auth.js', text],
          ['source', text, 'Checked src/auth.js']
        ]) {
          const checkDeps = extractVerificationDependencies([checkSource, checkStatement]);
          assert.ok(checkDeps.workspaceBroadDeps.length >= 1, `Expected broad dep for kind:check ${field}: ${text}`);
          const checkProof = {
            id: 'P1',
            seatId: 's1',
            round: 1,
            scope: 'Verify workspace evidence',
            kind: 'check',
            source: checkSource,
            statement: checkStatement
          };
          for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
            for (const [phaseName, round] of [
              ['DELIBERATION', 2],
              ['JUDGE_AUDIT_SYNTHESIS', 1],
              ['JUDGE_AUDIT_SYNTHESIS', 2],
              ['VOTING', 1]
            ]) {
              const verdict = evaluateCheckProofReadiness(checkProof, phaseName, round, errorClass);
              assert.equal(verdict.ready, false, `kind:check ${field}: ${phaseName} R${round}/${errorClass} must refuse: ${text}`);
              assert.equal(verdict.reasonCode, 'evidence_access_failure');
            }
            for (const enginePhase of ['R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS_R1', 'JUDGE_AUDIT_SYNTHESIS_R2', 'VOTING']) {
              const run = await executePhaseEngine({ phase: enginePhase, errorClass, s1Proof: checkProof });
              assert.equal(run.targetCalls.length, 1, `kind:check ${field}: engine ${enginePhase}/${errorClass} must refuse: ${text}`);
            }
          }
        }
      }

      const positiveProseControls = [
        'Inspect src/auth.js. Ensure width < 20px and python < 3.12.',
        'Inspect src/auth.js. Ensure width < 20 px and python < 3.12.',
        'Inspect src/auth.js. Ensure width < 20px, and python < 3.12.',
        'Inspect src/auth.js. Ensure <em>latency</em> < 20ms and <em>python</em> < 3.12.',
        'Inspect src/auth.js. Ensure node > 22 and <em><code>python</code></em> < 3.12.',
        'Inspect src/auth.js. Target <em>node > 22</em>, python < 3.12.'
      ];
      for (const proseTopic of positiveProseControls) {
        const deps = extractVerificationDependencies([proseTopic]);
        assert.deepEqual(deps.workspaceBroadDeps, [], `Expected 0 broad deps for prose control: ${proseTopic}`);
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          for (const [phase, round, extra] of readinessPhaseCases) {
            const verdict = evaluateToolFreeEvidenceReadiness(
              buildReadinessInputs({ phase, round, errorClass, topic: proseTopic, ...extra })
            );
            assert.equal(verdict.ready, true, `${phase} R${round}/${errorClass} must permit prose control: ${proseTopic}`);
          }
          for (const enginePhase of allFivePhases) {
            const run = await executePhaseEngine({ phase: enginePhase, errorClass, topic: proseTopic });
            assert.equal(
              run.targetCalls.length,
              2,
              `Prose control must allow retry (${enginePhase}/${errorClass}): ${proseTopic}`
            );
            assert.equal(run.targetCalls[1].tools, 'none');
            assert.equal(run.targetCalls[1].cwd, undefined);
          }
        }
      }

      const all37Units = [
        '%', 'ms', 's', 'sec', 'secs', 'us', 'ns', 'm', 'min', 'mins', 'h', 'hr', 'hrs', 'd',
        'b', 'kb', 'mb', 'gb', 'tb', 'kib', 'mib', 'gib', 'k', 'x', 'px', 'rem', 'em', 'vh', 'vw',
        'hz', 'khz', 'mhz', 'ghz', 'fps', 'rps', 'qps', 'tps'
      ];
      for (const unit of all37Units) {
        for (const badTopic of [
          `Inspect src/auth.js. Ensure metric < 20${unit} rem and python < 3.12.`,
          `Inspect src/auth.js. Ensure metric < 20 ${unit} rem and python < 3.12.`
        ]) {
          const deps = extractVerificationDependencies([badTopic]);
          assert.ok(
            deps.workspaceBroadDeps.includes('python'),
            `Expected python in broad deps for double unit '${unit}': ${badTopic}`
          );
          const verdict = evaluateToolFreeEvidenceReadiness(
            buildReadinessInputs({ phase: 'DELIBERATION', round: 1, errorClass: 'TimeoutError', topic: badTopic })
          );
          assert.equal(verdict.ready, false, `Expected ready: false for double unit '${unit}': ${badTopic}`);
        }
      }

      extractVerificationDependencies(['Ensure <em>latency</em> < 20ms and <em><code>python</code></em> < 3.12.']);
      const payload = 'Ensure <em>latency</em> < 20ms and <em><code>python</code></em> < 3.12. '.repeat(750).slice(0, 48000);
      assert.ok(Buffer.byteLength(payload, 'utf8') >= 48000, 'Expected >=48KB for r20-close-tags-and-units-48k');
      const t0 = performance.now();
      const deps = extractVerificationDependencies([payload]);
      const elapsedMs = performance.now() - t0;
      assert.ok(elapsedMs < 20, `Expected <20ms for r20-close-tags-and-units-48k, got ${elapsedMs.toFixed(2)}ms`);
      assert.deepEqual(deps.workspaceBroadDeps, [], 'Expected 0 broad deps for r20-close-tags-and-units-48k');
    });

    it('ReReview-102 Round 21 fixes: preserves standalone FD redirections and supports deep balanced inline tag stacks', async () => {
      const sampleAuthProof = {
        id: 'P1',
        seatId: 's1',
        round: 1,
        kind: 'claim',
        source: 'src/auth.js',
        statement: 'Token expiry verified in src/auth.js.'
      };
      const sampleCandidate = {
        id: 'C1',
        round: 1,
        summary: 'Token expiry handling in src/auth.js.',
        admittedProofIds: ['P1']
      };
      const sampleObjections = [{ seatId: 's2', proofId: 'P1', reason: 'Verify token expiry details.' }];
      const allFivePhases = [
        'R1_DELIBERATION',
        'R2_DELIBERATION',
        'JUDGE_AUDIT_SYNTHESIS_R1',
        'JUDGE_AUDIT_SYNTHESIS_R2',
        'VOTING'
      ];
      const defaultCovered = ['src/auth.js', 'README'];

      function buildReadinessInputs({
        phase = 'DELIBERATION',
        round = 1,
        errorClass,
        topic = 'Inspect src/auth.js.',
        clarifications = [],
        proofs = [],
        priorProofs = [],
        previousCandidate = undefined,
        openObjections = [],
        candidate = undefined,
        admittedProofs = []
      }) {
        return {
          phase,
          round,
          errorClass,
          topic,
          clarifications,
          proofs,
          priorProofs,
          previousCandidate,
          openObjections,
          candidate,
          admittedProofs,
          evidence: defaultCovered.map((source, i) => ({
            id: `E${i + 1}`,
            source,
            text: `complete snapshot for ${source}`
          })),
          selfContainedInput: {
            phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
            roundScope: 'all_rounds',
            coveredArtifacts: defaultCovered.map((source, i) => ({
              source,
              evidenceId: `E${i + 1}`,
              coverage: 'complete_artifact'
            }))
          },
          originalInvocationMeta: { effectiveTools: 'read-only', effectiveCwd: '/repo' }
        };
      }

      async function executePhaseEngine({
        phase,
        errorClass,
        topic = 'Inspect src/auth.js.',
        clarifications = [],
        s1Proof = null
      }) {
        const mock = new MockAdapter();
        const targetCalls = [];
        const origProof = mock.executeSeatProof.bind(mock);
        const origJudge = mock.executeJudgeAuditAndSynthesis.bind(mock);
        const origVote = mock.executeSeatVote.bind(mock);
        const makeFault = (participantId) =>
          errorClass === 'TimeoutError'
            ? new TimeoutError(`${phase} timeout`, { timeoutMs: 1000, harness: 'codex', seatId: participantId })
            : new HeadlessToolDeniedError(`${phase} tool denied`, {
                harness: 'codex',
                seatId: participantId,
                exitCode: 0,
                isRetryable: true
              });

        mock.executeSeatProof = async (ctx) => {
          if (
            (phase === 'R1_DELIBERATION' && ctx.round === 1 && ctx.seat.id === 's1') ||
            (phase === 'R2_DELIBERATION' && ctx.round === 2 && ctx.seat.id === 's2')
          ) {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) throw makeFault(ctx.seat.id);
          }
          if (ctx.round === 1 && ctx.seat.id === 's1' && s1Proof) return s1Proof;
          return origProof(ctx);
        };
        mock.executeJudgeAuditAndSynthesis = async (ctx) => {
          if (
            (phase === 'JUDGE_AUDIT_SYNTHESIS_R1' && ctx.round === 1) ||
            (phase === 'JUDGE_AUDIT_SYNTHESIS_R2' && ctx.round === 2)
          ) {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) throw makeFault('judge');
          }
          return origJudge(ctx);
        };
        mock.executeSeatVote = async (ctx) => {
          if (phase === 'VOTING' && ctx.round === 1 && ctx.seat.id === 's1') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) throw makeFault('s1');
          }
          if (
            (phase === 'R2_DELIBERATION' || phase === 'JUDGE_AUDIT_SYNTHESIS_R2') &&
            ctx.round === 1 &&
            ctx.seat.id === 's2'
          ) {
            return { vote: 'object', proofId: 'P1', reason: 'Dispute R1 proof in R2' };
          }
          return origVote(ctx);
        };

        const engine = new CouncilEngine(
          {
            topic,
            clarifications,
            maxClarificationBatches: 0,
            minQuorum: 2,
            maxRounds: phase === 'R2_DELIBERATION' || phase === 'JUDGE_AUDIT_SYNTHESIS_R2' ? 2 : 1,
            maxRetriesPerSeat: 1,
            maxRetriesPerJudge: 1,
            cwd: '/repo',
            evidence: defaultCovered.map((source, i) => ({
              id: `E${i + 1}`,
              label: `Artifact ${i + 1}`,
              source,
              text: `complete snapshot for ${source}`
            })),
            selfContainedInput: {
              kind: 'full_context',
              label: 'R21 standalone FD redirections & unbounded LIFO tag stack matrix',
              phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
              roundScope: 'all_rounds',
              coveredArtifacts: defaultCovered.map((source, i) => ({
                source,
                evidenceId: `E${i + 1}`,
                coverage: 'complete_artifact'
              }))
            },
            judge: { id: 'judge', harness: 'codex', model: 'gpt-6-astra (high)', tools: 'read-only', cwd: '/repo' },
            seats: [
              { id: 's1', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S1', tools: 'read-only', votingTools: 'read-only', cwd: '/repo' },
              { id: 's2', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S2', tools: 'read-only', cwd: '/repo' },
              { id: 's3', harness: 'cursor', model: 'grok-4', soul: 'S3', tools: 'none' }
            ]
          },
          { harnessResolver: () => mock }
        );
        await engine.run();
        return { targetCalls };
      }

      const readinessPhaseCases = [
        ['DELIBERATION', 1, {}],
        ['DELIBERATION', 2, { priorProofs: [sampleAuthProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }],
        ['JUDGE_AUDIT_SYNTHESIS', 1, { proofs: [sampleAuthProof] }],
        ['JUDGE_AUDIT_SYNTHESIS', 2, { proofs: [sampleAuthProof], priorProofs: [sampleAuthProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }],
        ['VOTING', 1, { candidate: sampleCandidate, admittedProofs: [sampleAuthProof] }]
      ];

      function evaluateCheckProofReadiness(checkProof, phaseName, round, errorClass) {
        const extra =
          phaseName === 'DELIBERATION'
            ? { priorProofs: [checkProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }
            : phaseName === 'JUDGE_AUDIT_SYNTHESIS' && round === 1
              ? { proofs: [checkProof] }
              : phaseName === 'JUDGE_AUDIT_SYNTHESIS'
                ? { proofs: [checkProof], priorProofs: [checkProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }
                : { candidate: sampleCandidate, admittedProofs: [checkProof] };
        return evaluateToolFreeEvidenceReadiness(buildReadinessInputs({ phase: phaseName, round, errorClass, ...extra }));
      }

      const mustRefuseTopics = [
        'Inspect src/auth.js. 2</em>',
        'Inspect src/auth.js; 2</em>',
        'Inspect src/auth.js. <em>ok</em> 2</em>',
        'Inspect src/auth.js. 2>err.log',
        'Inspect src/auth.js. 2<input',
        'Inspect src/auth.js. &>out',
        'Inspect src/auth.js. Target <em><b>node</em> > 22</b>, python < 3.12.',
        'Inspect src/auth.js. Target <em><b>node </em> > 22</b>, python < 3.12.',
        'Inspect src/auth.js. Target <em><b>node > 22</em></b>, python < 3.12.',
        'Inspect src/auth.js. Target <t1><t2><t3><t4><t5><t6><t7><t8><t9>node</t9></t8></t7></t6></t5></t4></t3></t2></t1></t0> > 22, python < 3.12.'
      ];

      for (const topic of mustRefuseTopics) {
        const deps = extractVerificationDependencies([topic]);
        assert.ok(deps.workspaceBroadDeps.length >= 1, `Expected broad dep for topic: ${topic}`);
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          for (const [phase, round, extra] of readinessPhaseCases) {
            const verdict = evaluateToolFreeEvidenceReadiness(
              buildReadinessInputs({ phase, round, errorClass, topic, ...extra })
            );
            assert.equal(verdict.ready, false, `${phase} R${round}/${errorClass} must refuse topic: ${topic}`);
            assert.equal(verdict.reasonCode, 'evidence_access_failure');
          }
          for (const enginePhase of allFivePhases) {
            const run = await executePhaseEngine({ phase: enginePhase, errorClass, topic });
            assert.equal(run.targetCalls.length, 1, `Engine ${enginePhase}/${errorClass} must refuse topic: ${topic}`);
          }
        }
      }

      const r1ClarificationMustRefuse = [
        'Inspect src/auth.js. 2</em>',
        'Inspect src/auth.js. 2>err.log',
        'Inspect src/auth.js. 2<input',
        'Inspect src/auth.js. &>out',
        'Inspect src/auth.js. Target <em><b>node</em> > 22</b>, python < 3.12.',
        'Inspect src/auth.js. Target <t1><t2><t3><t4><t5><t6><t7><t8><t9>node</t9></t8></t7></t6></t5></t4></t3></t2></t1></t0> > 22, python < 3.12.'
      ];
      for (const clarText of r1ClarificationMustRefuse) {
        const clarifications = [{ question: 'Clarify runtime constraints?', answer: clarText }];
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          for (const [phase, round, extra] of readinessPhaseCases) {
            const verdict = evaluateToolFreeEvidenceReadiness(
              buildReadinessInputs({ phase, round, errorClass, clarifications, ...extra })
            );
            assert.equal(verdict.ready, false, `Clarification ${phase} R${round}/${errorClass} must refuse: ${clarText}`);
            assert.equal(verdict.reasonCode, 'evidence_access_failure');
          }
          for (const enginePhase of allFivePhases) {
            const run = await executePhaseEngine({ phase: enginePhase, errorClass, clarifications });
            assert.equal(run.targetCalls.length, 1, `Clarification engine ${enginePhase}/${errorClass} must refuse: ${clarText}`);
          }
        }
      }

      const r21CheckTexts = [
        'Inspect src/auth.js. 2</em>',
        'Inspect src/auth.js. 2>err.log',
        'Inspect src/auth.js. &>out',
        'Inspect src/auth.js. Target <em><b>node</em> > 22</b>, python < 3.12.',
        'Inspect src/auth.js. Target <t1><t2><t3><t4><t5><t6><t7><t8><t9>node</t9></t8></t7></t6></t5></t4></t3></t2></t1></t0> > 22, python < 3.12.'
      ];
      for (const text of r21CheckTexts) {
        for (const [field, checkSource, checkStatement] of [
          ['statement', 'src/auth.js', text],
          ['source', text, 'Checked src/auth.js']
        ]) {
          const checkDeps = extractVerificationDependencies([checkSource, checkStatement]);
          assert.ok(checkDeps.workspaceBroadDeps.length >= 1, `Expected broad dep for kind:check ${field}: ${text}`);
          const checkProof = {
            id: 'P1',
            seatId: 's1',
            round: 1,
            scope: 'Verify workspace evidence',
            kind: 'check',
            source: checkSource,
            statement: checkStatement
          };
          for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
            for (const [phaseName, round] of [
              ['DELIBERATION', 2],
              ['JUDGE_AUDIT_SYNTHESIS', 1],
              ['JUDGE_AUDIT_SYNTHESIS', 2],
              ['VOTING', 1]
            ]) {
              const verdict = evaluateCheckProofReadiness(checkProof, phaseName, round, errorClass);
              assert.equal(verdict.ready, false, `kind:check ${field}: ${phaseName} R${round}/${errorClass} must refuse: ${text}`);
              assert.equal(verdict.reasonCode, 'evidence_access_failure');
            }
            for (const enginePhase of ['R2_DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS_R1', 'JUDGE_AUDIT_SYNTHESIS_R2', 'VOTING']) {
              const run = await executePhaseEngine({ phase: enginePhase, errorClass, s1Proof: checkProof });
              assert.equal(run.targetCalls.length, 1, `kind:check ${field}: engine ${enginePhase}/${errorClass} must refuse: ${text}`);
            }
          }
        }
      }

      const positiveProseControls = [
        'Inspect src/auth.js. Target <t1><t2><t3><t4><t5><t6><t7><t8><t9>node</t9></t8></t7></t6></t5></t4></t3></t2></t1> > 22, python < 3.12.',
        'Inspect src/auth.js. Target <a><b><i><u><s><code><span><em><strong><t1><t2><t3><t4><t5>node</t5></t4></t3></t2></t1></strong></em></span></code></s></u></i></b></a> > 22, python < 3.12.',
        'Inspect src/auth.js. Target <d1><d2><d3><d4><d5><d6><d7><d8><d9><d10><d11><d12>node > 22</d12></d11></d10></d9></d8></d7></d6></d5></d4></d3></d2></d1>, python < 3.12.',
        'Inspect src/auth.js. Notes >quote.',
        'Inspect src/auth.js. Notes 2>&1.'
      ];
      for (const proseTopic of positiveProseControls) {
        const deps = extractVerificationDependencies([proseTopic]);
        assert.deepEqual(deps.workspaceBroadDeps, [], `Expected 0 broad deps for prose control: ${proseTopic}`);
        for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
          for (const [phase, round, extra] of readinessPhaseCases) {
            const verdict = evaluateToolFreeEvidenceReadiness(
              buildReadinessInputs({ phase, round, errorClass, topic: proseTopic, ...extra })
            );
            assert.equal(verdict.ready, true, `${phase} R${round}/${errorClass} must permit prose control: ${proseTopic}`);
          }
          for (const enginePhase of allFivePhases) {
            const run = await executePhaseEngine({ phase: enginePhase, errorClass, topic: proseTopic });
            assert.equal(
              run.targetCalls.length,
              2,
              `Prose control must allow retry (${enginePhase}/${errorClass}): ${proseTopic}`
            );
            assert.equal(run.targetCalls[1].tools, 'none');
            assert.equal(run.targetCalls[1].cwd, undefined);
          }
        }
      }

      const deep20Open = Array.from({ length: 20 }, (_, i) => `<t${i}>`).join('');
      const deep20Close = Array.from({ length: 20 }, (_, i) => `</t${19 - i}>`).join('');
      const deep20Unit = `Target ${deep20Open}node${deep20Close} > 22, ${deep20Open}python${deep20Close} < 3.12. `;
      const deep20Payload = deep20Unit.repeat(Math.ceil(48000 / Buffer.byteLength(deep20Unit, 'utf8')));
      assert.ok(Buffer.byteLength(deep20Payload, 'utf8') >= 48000, 'Expected >=48KB for r21-deep-nested-20-tags-48k');
      extractVerificationDependencies([deep20Unit]);
      const t20 = performance.now();
      const deep20Deps = extractVerificationDependencies([deep20Payload]);
      const elapsed20Ms = performance.now() - t20;
      assert.ok(elapsed20Ms < 20, `Expected <20ms for r21-deep-nested-20-tags-48k, got ${elapsed20Ms.toFixed(2)}ms`);
      assert.deepEqual(deep20Deps.workspaceBroadDeps, [], 'Expected 0 broad deps for r21-deep-nested-20-tags-48k');

      const open2000 = Array.from({ length: 2000 }, (_, i) => `<t${i}>`).join('');
      const close2000 = Array.from({ length: 2000 }, (_, i) => `</t${1999 - i}>`).join('');
      const single2000Tail = `Target ${open2000}node${close2000} > 22, python < 3.12.`;
      const padUnit = 'Notes <section> and >quote do not invoke shell commands. ';
      const padCount = Math.ceil(Math.max(0, 48000 - Buffer.byteLength(single2000Tail, 'utf8')) / Buffer.byteLength(padUnit, 'utf8'));
      const single2000Payload = `${padUnit.repeat(padCount)}${single2000Tail}`;
      assert.ok(Buffer.byteLength(single2000Payload, 'utf8') >= 48000, 'Expected >=48KB for r21-single-2000-tag-padded-48k');
      const t2000 = performance.now();
      const single2000Deps = extractVerificationDependencies([single2000Payload]);
      const elapsed2000Ms = performance.now() - t2000;
      assert.ok(elapsed2000Ms < 20, `Expected <20ms for r21-single-2000-tag-padded-48k, got ${elapsed2000Ms.toFixed(2)}ms`);
      assert.deepEqual(single2000Deps.workspaceBroadDeps, [], 'Expected 0 broad deps for r21-single-2000-tag-padded-48k');

      const repeatedFdPayload = '2</em> '.repeat(7000);
      assert.ok(Buffer.byteLength(repeatedFdPayload, 'utf8') >= 48000, 'Expected >=48KB for r21-repeated-fd-close-tag-48k');
      const tFd = performance.now();
      const repeatedFdDeps = extractVerificationDependencies([repeatedFdPayload]);
      const elapsedFdMs = performance.now() - tFd;
      assert.ok(elapsedFdMs < 20, `Expected <20ms for r21-repeated-fd-close-tag-48k, got ${elapsedFdMs.toFixed(2)}ms`);
      assert.ok(repeatedFdDeps.workspaceBroadDeps.includes('2</em>'), 'Expected 2</em> in broad deps for r21-repeated-fd-close-tag-48k');
    });

    it('ReReview-102 Round 23 fixes: records FD-less redirections (excluding benign blockquote words), distinguishes benign 2>1 and runtime comparisons, and passes <20ms 48KB stress probes', async () => {
      const sampleAuthProof = {
        id: 'P1',
        seatId: 's1',
        round: 1,
        kind: 'claim',
        source: 'src/auth.js',
        statement: 'Token expiry verified in src/auth.js.'
      };
      const sampleCandidate = {
        id: 'C1',
        round: 1,
        summary: 'Token expiry handling in src/auth.js.',
        admittedProofIds: ['P1']
      };
      const sampleObjections = [{ seatId: 's2', proofId: 'P1', reason: 'Verify token expiry details.' }];
      const allFivePhases = [
        'R1_DELIBERATION',
        'R2_DELIBERATION',
        'JUDGE_AUDIT_SYNTHESIS_R1',
        'JUDGE_AUDIT_SYNTHESIS_R2',
        'VOTING'
      ];
      const defaultCovered = ['src/auth.js', 'README'];

      function buildReadinessInputs({
        phase = 'DELIBERATION',
        round = 1,
        errorClass,
        topic = 'Inspect src/auth.js.',
        clarifications = [],
        proofs = [],
        priorProofs = [],
        previousCandidate = undefined,
        openObjections = [],
        candidate = undefined,
        admittedProofs = [],
        effectiveCwd = '/repo',
        conceptualNoExternalVerification = false,
        coveredSources = defaultCovered
      }) {
        return {
          phase,
          round,
          errorClass,
          topic,
          clarifications,
          proofs,
          priorProofs,
          previousCandidate,
          openObjections,
          candidate,
          admittedProofs,
          evidence: coveredSources.map((source, i) => ({
            id: `E${i + 1}`,
            source,
            text: `complete snapshot for ${source}`
          })),
          selfContainedInput: {
            phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
            roundScope: 'all_rounds',
            conceptualNoExternalVerification,
            coveredArtifacts: coveredSources.map((source, i) => ({
              source,
              evidenceId: `E${i + 1}`,
              coverage: 'complete_artifact'
            }))
          },
          originalInvocationMeta: { effectiveTools: 'read-only', ...(effectiveCwd ? { effectiveCwd } : {}) }
        };
      }

      async function executePhaseEngine({ phase, errorClass, topic = 'Inspect src/auth.js.', clarifications = [], s1Proof = null }) {
        const mock = new MockAdapter();
        const targetCalls = [];
        const origProof = mock.executeSeatProof.bind(mock);
        const origJudge = mock.executeJudgeAuditAndSynthesis.bind(mock);
        const origVote = mock.executeSeatVote.bind(mock);
        const makeFault = (participantId) =>
          errorClass === 'TimeoutError'
            ? new TimeoutError(`${phase} timeout`, { timeoutMs: 1000, harness: 'codex', seatId: participantId })
            : new HeadlessToolDeniedError(`${phase} tool denied`, {
                harness: 'codex',
                seatId: participantId,
                exitCode: 0,
                isRetryable: true
              });

        mock.executeSeatProof = async (ctx) => {
          if (
            (phase === 'R1_DELIBERATION' && ctx.round === 1 && ctx.seat.id === 's1') ||
            (phase === 'R2_DELIBERATION' && ctx.round === 2 && ctx.seat.id === 's2')
          ) {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) throw makeFault(ctx.seat.id);
          }
          if (ctx.round === 1 && ctx.seat.id === 's1' && s1Proof) return s1Proof;
          return origProof(ctx);
        };
        mock.executeJudgeAuditAndSynthesis = async (ctx) => {
          if (
            (phase === 'JUDGE_AUDIT_SYNTHESIS_R1' && ctx.round === 1) ||
            (phase === 'JUDGE_AUDIT_SYNTHESIS_R2' && ctx.round === 2)
          ) {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) throw makeFault('judge');
          }
          return origJudge(ctx);
        };
        mock.executeSeatVote = async (ctx) => {
          if (phase === 'VOTING' && ctx.round === 1 && ctx.seat.id === 's1') {
            targetCalls.push({ tools: ctx.tools, cwd: ctx.cwd });
            if (targetCalls.length === 1) throw makeFault('s1');
          }
          if ((phase === 'R2_DELIBERATION' || phase === 'JUDGE_AUDIT_SYNTHESIS_R2') && ctx.round === 1 && ctx.seat.id === 's2') {
            return { vote: 'object', proofId: 'P1', reason: 'Dispute R1 proof in R2' };
          }
          return origVote(ctx);
        };

        const engine = new CouncilEngine(
          {
            topic,
            clarifications,
            maxClarificationBatches: 0,
            minQuorum: 2,
            maxRounds: phase === 'R2_DELIBERATION' || phase === 'JUDGE_AUDIT_SYNTHESIS_R2' ? 2 : 1,
            maxRetriesPerSeat: 1,
            maxRetriesPerJudge: 1,
            cwd: '/repo',
            evidence: defaultCovered.map((source, i) => ({
              id: `E${i + 1}`,
              label: `Artifact ${i + 1}`,
              source,
              text: `complete snapshot for ${source}`
            })),
            selfContainedInput: {
              kind: 'full_context',
              label: 'R23 regression matrix',
              phases: ['DELIBERATION', 'JUDGE_AUDIT_SYNTHESIS', 'VOTING'],
              roundScope: 'all_rounds',
              coveredArtifacts: defaultCovered.map((source, i) => ({
                source,
                evidenceId: `E${i + 1}`,
                coverage: 'complete_artifact'
              }))
            },
            judge: { id: 'judge', harness: 'codex', model: 'gpt-6-astra (high)', tools: 'read-only', cwd: '/repo' },
            seats: [
              { id: 's1', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S1', tools: 'read-only', votingTools: 'read-only', cwd: '/repo' },
              { id: 's2', harness: 'codex', model: 'gpt-6-astra (high)', soul: 'S2', tools: 'read-only', cwd: '/repo' },
              { id: 's3', harness: 'cursor', model: 'grok-4', soul: 'S3', tools: 'none' }
            ]
          },
          { harnessResolver: () => mock }
        );
        await engine.run();
        return { targetCalls };
      }

      const readinessPhaseCases = [
        ['DELIBERATION', 1, {}],
        ['DELIBERATION', 2, { priorProofs: [sampleAuthProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }],
        ['JUDGE_AUDIT_SYNTHESIS', 1, { proofs: [sampleAuthProof] }],
        ['JUDGE_AUDIT_SYNTHESIS', 2, { proofs: [sampleAuthProof], priorProofs: [sampleAuthProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }],
        ['VOTING', 1, { candidate: sampleCandidate, admittedProofs: [sampleAuthProof] }]
      ];

      function evaluateCheckProofReadiness(checkProof, phaseName, round, errorClass) {
        const extra =
          phaseName === 'DELIBERATION'
            ? { priorProofs: [checkProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }
            : phaseName === 'JUDGE_AUDIT_SYNTHESIS' && round === 1
              ? { proofs: [checkProof] }
              : phaseName === 'JUDGE_AUDIT_SYNTHESIS' && round === 2
                ? { proofs: [checkProof], priorProofs: [sampleAuthProof], previousCandidate: sampleCandidate, openObjections: sampleObjections }
                : { candidate: sampleCandidate, admittedProofs: [checkProof] };
        return evaluateToolFreeEvidenceReadiness(
          buildReadinessInputs({ phase: phaseName, round, errorClass, ...extra })
        );
      }

      const unmatched10thCloser = '<t1><t2><t3><t4><t5><t6><t7><t8><t9>2</t9></t8></t7></t6></t5></t4></t3></t2></t1></t0>';
      const depth20WrappedRuntime = `node ${Array.from({ length: 20 }, (_, i) => `<t${i + 1}>`).join('')}22${Array.from({ length: 20 }, (_, i) => `</t${20 - i}>`).join('')} > 20, and python 3 > 2`;
      const mustRefuseTexts = [
        '<em>2</em> >/tmp/err',
        '>/tmp/err',
        unmatched10thCloser,
        `${unmatched10thCloser} >/tmp/err`,
        '<a><b>2</a></b>',
        '<a><b>2</a></b> >/tmp/err',
        'cat README 2>1',
        'ls 2>1',
        '2>1 cat README',
        'node 2>1',
        '2>1.log',
        '2>|1',
        '<openapi.org> result',
        '<openapi.org>out',
        '<openapi.org/v1> out',
        '<https://example.com> result',
        '<https://example.com>out',
        '<var> out',
        '<code> out',
        '<code>out',
        '<em>ok</em>; <em>out',
        '<em>ok</em>; <em>out.txt',
        'Verify node 22 > 20',
        'Verify node <em>22</em> > 20',
        'Ensure latency < 20ms, node 22 > 20'
      ];

      for (const text of mustRefuseTexts) {
        const deps = extractVerificationDependencies([text]);
        assert.ok(
          deps.workspaceBroadDeps.length > 0 || deps.workspaceFileDeps.length > 0,
          `Expected workspace dependency for ${JSON.stringify(text)}, got broad=${JSON.stringify(deps.workspaceBroadDeps)} file=${JSON.stringify(deps.workspaceFileDeps)}`
        );
      }

      const positiveProseControls = [
        '2>1',
        'Ratio 2>1 holds.',
        'Score 2>=1 holds.',
        'Value 2<=5 holds.',
        'Delta 2<-1 holds.',
        '<em>2</em> > 1, and <em>3</em> > 2',
        'node 22 > 20, and python 3 > 2',
        'node 22>20, and python 3>2',
        '<em>node 22</em> > 20, and <em>python 3</em> > 2',
        'node <em>22</em> > 20, and python 3 > 2',
        depth20WrappedRuntime,
        'npm 10 > 9, and pnpm 9 > 8',
        'node 22 -> 24, and python 3 > 2',
        'See <https://example.com/docs> for details.',
        'Notes >quote.'
      ];

      for (const prose of positiveProseControls) {
        const deps = extractVerificationDependencies([prose]);
        assert.deepEqual(deps.workspaceBroadDeps, [], `Expected 0 workspaceBroadDeps for prose ${JSON.stringify(prose)}`);
        assert.deepEqual(deps.workspaceFileDeps, [], `Expected 0 workspaceFileDeps for prose ${JSON.stringify(prose)}`);
        if (prose.includes('https://example.com/docs')) {
          assert.deepEqual(deps.externalDeps, ['https://example.com/docs'], `Expected docs externalDep for prose ${JSON.stringify(prose)}`);
        } else {
          assert.deepEqual(deps.externalDeps, [], `Expected 0 externalDeps for prose ${JSON.stringify(prose)}`);
        }
      }

      const mustRefuseTopics = [
        'Inspect src/auth.js; <em>2</em> >/tmp/err',
        'Inspect src/auth.js; >/tmp/err',
        `Inspect src/auth.js; ${unmatched10thCloser}`,
        'Inspect src/auth.js; <a><b>2</a></b>',
        'Inspect src/auth.js; <openapi.org> result',
        'Inspect src/auth.js; <openapi.org>out',
        'Inspect src/auth.js; <openapi.org/v1> out',
        'Inspect src/auth.js; <https://example.com> result',
        'Inspect src/auth.js; <var> out',
        'Inspect src/auth.js; <code> out',
        'Inspect src/auth.js; <code>out',
        'Inspect src/auth.js; <em>ok</em>; <em>out',
        'Inspect src/auth.js; 2>|1',
        'cat README 2>1',
        'ls 2>1',
        '2>1 cat README',
        'node 2>1',
        'Inspect src/auth.js; 2>1.log',
        'Verify node 22 > 20',
        'Verify node <em>22</em> > 20',
        'Ensure latency < 20ms, node 22 > 20'
      ];

      const r1ClarificationMustRefuse = [
        '<em>2</em> >/tmp/err',
        '>/tmp/err',
        unmatched10thCloser,
        '<a><b>2</a></b>',
        '<openapi.org> result',
        '<openapi.org>out',
        '<openapi.org/v1> out',
        '<https://example.com> result',
        '<var> out',
        '<code> out',
        '<code>out',
        '<em>ok</em>; <em>out',
        '2>|1',
        'cat README 2>1',
        'ls 2>1',
        '2>1 cat README',
        'node 2>1',
        'Verify node 22 > 20',
        'Verify node <em>22</em> > 20'
      ];

      const r23CheckTexts = [
        '<em>2</em> >/tmp/err',
        '>/tmp/err',
        unmatched10thCloser,
        '<a><b>2</a></b>',
        '<openapi.org> result',
        '<openapi.org>out',
        '<openapi.org/v1> out',
        '<https://example.com> result',
        '<var> out',
        '<code> out',
        '<code>out',
        '<em>ok</em>; <em>out',
        '2>|1',
        'cat README 2>1',
        'ls 2>1',
        '2>1 cat README',
        'node 2>1',
        'Verify node 22 > 20',
        'Verify node <em>22</em> > 20'
      ];

      for (const errorClass of ['TimeoutError', 'HeadlessToolDeniedError']) {
        for (const [phaseName, round, extra] of readinessPhaseCases) {
          for (const topic of mustRefuseTopics) {
            const res = evaluateToolFreeEvidenceReadiness(
              buildReadinessInputs({ phase: phaseName, round, errorClass, topic, ...extra })
            );
            assert.equal(res.ready, false, `Expected refusal for topic ${JSON.stringify(topic)} in ${phaseName} R${round} (${errorClass})`);
          }
          for (const clarificationText of r1ClarificationMustRefuse) {
            const res = evaluateToolFreeEvidenceReadiness(
              buildReadinessInputs({
                phase: phaseName,
                round,
                errorClass,
                clarifications: [{ batch: 1, answer: clarificationText }],
                ...extra
              })
            );
            assert.equal(res.ready, false, `Expected refusal for clarification ${JSON.stringify(clarificationText)} in ${phaseName} R${round} (${errorClass})`);
          }
          for (const prose of positiveProseControls) {
            const coveredSources = prose.includes('https://example.com/docs')
              ? [...defaultCovered, 'https://example.com/docs']
              : defaultCovered;
            const res = evaluateToolFreeEvidenceReadiness(
              buildReadinessInputs({
                phase: phaseName,
                round,
                errorClass,
                topic: `Inspect src/auth.js. ${prose}`,
                coveredSources,
                ...extra
              })
            );
            assert.equal(res.ready, true, `Expected ready=true for prose ${JSON.stringify(prose)} in ${phaseName} R${round} (${errorClass}), got ${JSON.stringify(res)}`);
          }
        }

        for (const checkText of r23CheckTexts) {
          const checkProof = {
            id: 'P1',
            seatId: 's1',
            round: 1,
            kind: 'check',
            source: 'Command verification',
            statement: checkText
          };
          for (const [phaseName, round] of readinessPhaseCases.slice(1)) {
            const res = evaluateCheckProofReadiness(checkProof, phaseName, round, errorClass);
            assert.equal(res.ready, false, `Expected check proof refusal for ${JSON.stringify(checkText)} in ${phaseName} R${round} (${errorClass})`);
          }
        }

        for (const enginePhase of allFivePhases) {
          for (const topic of [
            'Inspect src/auth.js; <em>2</em> >/tmp/err',
            'Inspect src/auth.js; <openapi.org> result',
            'Inspect src/auth.js; <https://example.com> result',
            'Inspect src/auth.js; <var> out',
            'Inspect src/auth.js; <code>out',
            'Inspect src/auth.js; <em>ok</em>; <em>out',
            'Inspect src/auth.js; 2>|1',
            'cat README 2>1',
            'node 2>1',
            'Verify node 22 > 20',
            'Verify node <em>22</em> > 20'
          ]) {
            const out = await executePhaseEngine({ phase: enginePhase, errorClass, topic });
            assert.equal(out.targetCalls.length, 1, `Expected engine refusal (1 attempt) for ${JSON.stringify(topic)} in ${enginePhase} (${errorClass})`);
          }
          for (const prose of [
            '2>1',
            '<em>2</em> > 1, and <em>3</em> > 2',
            'node 22 > 20, and python 3 > 2',
            'node 22>20, and python 3>2',
            '<em>node 22</em> > 20, and <em>python 3</em> > 2',
            'node <em>22</em> > 20, and python 3 > 2',
            depth20WrappedRuntime,
            'npm 10 > 9, and pnpm 9 > 8',
            'node 22 -> 24, and python 3 > 2'
          ]) {
            const out = await executePhaseEngine({
              phase: enginePhase,
              errorClass,
              topic: `Inspect src/auth.js. ${prose}`
            });
            assert.equal(out.targetCalls.length, 2, `Expected engine tool-free recovery (2 attempts) for ${JSON.stringify(prose)} in ${enginePhase} (${errorClass})`);
            assert.equal(out.targetCalls[1].tools, 'none');
            assert.equal(out.targetCalls[1].cwd, undefined);
          }
        }
      }

      // Three <20ms 48KB stress probes (warmed once before timing to avoid one-time JIT variance)
      const stressProbes = [
        { name: 'r23-2gt1-48k', unit: '2>1 ', expectBroad: false },
        { name: 'r23-runtime-pair-48k', unit: 'node 22 > 20, and python 3 > 2; ', expectBroad: false },
        { name: 'r23-em2-fdless-48k', unit: '<em>2</em> >/tmp/err; ', expectBroad: true }
      ];
      for (const probe of stressProbes) {
        extractVerificationDependencies([probe.unit.repeat(200)]);
        const repeatCount = Math.ceil(49152 / Buffer.byteLength(probe.unit, 'utf8'));
        const payload = probe.unit.repeat(repeatCount);
        assert.ok(Buffer.byteLength(payload, 'utf8') >= 48000, `Expected >=48KB for ${probe.name}`);
        const t0 = performance.now();
        const deps = extractVerificationDependencies([payload]);
        const elapsedMs = performance.now() - t0;
        assert.ok(elapsedMs < 20, `Expected <20ms for ${probe.name}, got ${elapsedMs.toFixed(2)}ms`);
        if (probe.expectBroad) {
          assert.ok(deps.workspaceBroadDeps.length > 0, `Expected broad deps for ${probe.name}`);
        } else {
          assert.deepEqual(deps.workspaceBroadDeps, [], `Expected 0 broad deps for ${probe.name}`);
        }
      }
    });
  });
});
