import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import {
  CouncilEngine,
  MockAdapter,
  CodexAdapter,
  AntigravityAdapter,
  CursorAdapter,
  InvalidResponseError,
  resolveConfig,
  loadConfigFile,
  runCli,
  VisualizerLiveWatcher,
  isValidSha256Hex,
  validateExpectedDigestsConfig,
  validateJudgeDigestBinding
} from '../../src/index.js';
import { formatJudgePrompt } from '../../src/seats/soul.js';

const POLICY_HEX = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const EVIDENCE_HEX = '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff';
const UNRELATED_HEX_1 = '9999999988888888777777776666666655555555444444443333333322222222';
const UNRELATED_HEX_2 = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
// Exact reproduced 96-character malformed digest: 64-char policy digest + first 32 characters appended.
const POLICY_HEX_96 = `${POLICY_HEX}${POLICY_HEX.slice(0, 32)}`;

function makeProof(idSuffix = '1') {
  return {
    scope: `Scope ${idSuffix}`,
    kind: 'check',
    source: `docs/spec-${idSuffix}.md:10`,
    statement: `Verified deterministic invariant ${idSuffix}.`
  };
}

function makeBaseConfig(overrides = {}) {
  return {
    topic: 'Validate policy and frozen packet digest binding before confirmation votes',
    minQuorum: 2,
    maxRounds: 1,
    maxRetriesPerSeat: 1,
    maxRetriesPerJudge: 1,
    timeoutMs: 500000,
    totalSeatBudgetMs: 1000000,
    tools: 'none',
    evidence: [
      {
        id: 'E1',
        label: 'Frozen Evidence Packet',
        source: 'evidence/packet.json',
        text: `Frozen evidence sha256=${UNRELATED_HEX_1}`
      }
    ],
    seats: ['seat-a', 'seat-b', 'seat-c'].map((id) => ({
      id,
      harness: 'mock',
      model: 'gpt-6-astra',
      soul: 'Pragmatist'
    })),
    judge: {
      id: 'judge-1',
      harness: 'mock',
      model: 'gpt-6-astra',
      reasoningEffort: 'xhigh',
      tools: 'none'
    },
    ...overrides
  };
}

function validJudgePayload(proofs, summaryText, extraClauses = []) {
  const proofIds = proofs.map((p) => p.id);
  return {
    summary: summaryText,
    proofDecisions: Object.fromEntries(proofs.map((p) => [p.id, { status: 'admitted', note: 'Verified.' }])),
    clauses: [
      {
        context: 'Digest binding evaluation',
        conclusion: 'All submitted checks satisfy the frozen evidence policy.',
        citedProofIds: proofIds.length > 0 ? proofIds : ['P1']
      },
      ...extraClauses
    ]
  };
}

async function runCliBuffered(args, extraIo = {}) {
  const stdoutStream = new PassThrough();
  const stderrStream = new PassThrough();
  let stdoutText = '';
  let stderrText = '';
  stdoutStream.on('data', (chunk) => {
    stdoutText += chunk.toString('utf8');
  });
  stderrStream.on('data', (chunk) => {
    stderrText += chunk.toString('utf8');
  });
  const exitCode = await runCli(args, {
    stdout: stdoutStream,
    stderr: stderrStream,
    exit: (code) => code,
    registerSignalHandlers: false,
    ...extraIo
  });
  return { exitCode, stdout: stdoutText, stderr: stderrText };
}

describe('Issue #117 — Validate required evidence digests before confirmation votes', () => {
  describe('Q1: Opt-in config & CLI digest validation before provider calls', () => {
    it('validates 64-character hex strings and normalizes expectedDigests only when provided', () => {
      assert.equal(isValidSha256Hex(POLICY_HEX), true);
      assert.equal(isValidSha256Hex(POLICY_HEX.toUpperCase()), true);
      assert.equal(isValidSha256Hex(POLICY_HEX_96), false);
      assert.equal(isValidSha256Hex(POLICY_HEX.slice(0, 63)), false);
      assert.equal(isValidSha256Hex('z'.repeat(64)), false);
      assert.equal(isValidSha256Hex(123), false);

      assert.deepEqual(validateExpectedDigestsConfig(undefined), { valid: true, errors: [], normalized: null });
      assert.deepEqual(validateExpectedDigestsConfig(null), { valid: true, errors: [], normalized: null });

      const omitted = resolveConfig(makeBaseConfig());
      assert.equal('expectedDigests' in omitted, false);

      const upper = resolveConfig(
        makeBaseConfig({
          expectedDigests: {
            policy: POLICY_HEX.toUpperCase(),
            evidence: EVIDENCE_HEX.toUpperCase()
          }
        })
      );
      assert.deepEqual(upper.expectedDigests, {
        policy: POLICY_HEX,
        evidence: EVIDENCE_HEX
      });
    });

    it('rejects partial, empty, non-object, or non-64-hex expectedDigests in resolveConfig & CouncilEngine', () => {
      const invalidCases = [
        'not-an-object',
        [],
        {},
        { policy: POLICY_HEX },
        { evidence: EVIDENCE_HEX },
        { policy: '', evidence: EVIDENCE_HEX },
        { policy: POLICY_HEX, evidence: EVIDENCE_HEX.slice(0, 63) },
        { policy: POLICY_HEX_96, evidence: EVIDENCE_HEX },
        { policy: `${POLICY_HEX.slice(0, 63)}g`, evidence: EVIDENCE_HEX }
      ];

      for (const expectedDigests of invalidCases) {
        assert.throws(
          () => resolveConfig(makeBaseConfig({ expectedDigests })),
          /Invalid Council configuration:.*expectedDigests/
        );
        assert.throws(
          () => new CouncilEngine(makeBaseConfig({ expectedDigests })),
          /Invalid Council configuration:.*expectedDigests/
        );
      }
    });

    it('rejects partial or malformed CLI --policy-digest / --evidence-digest before any provider call', async () => {
      const badArgSets = [
        ['run', '--mock', '--policy-digest', POLICY_HEX],
        ['run', '--mock', '--evidence-digest', EVIDENCE_HEX],
        ['run', '--live', '--policy-digest', POLICY_HEX.slice(0, 32), '--evidence-digest', EVIDENCE_HEX],
        ['run', '--live', '--policy-digest', POLICY_HEX, '--evidence-digest', POLICY_HEX_96]
      ];

      for (const args of badArgSets) {
        let resolverCalls = 0;
        let registryCalls = 0;
        const { exitCode, stderr } = await runCliBuffered(args, {
          harnessResolver: () => {
            resolverCalls += 1;
            throw new Error('Provider should never be resolved');
          },
          harnessRegistry: {
            get: () => {
              registryCalls += 1;
              throw new Error('Registry should never be accessed');
            }
          }
        });
        assert.equal(exitCode, 1);
        assert.match(stderr, /Configuration error:.*expectedDigests/);
        assert.equal(resolverCalls, 0);
        assert.equal(registryCalls, 0);
      }
    });

    it('accepts --policy-digest and --evidence-digest in CLI --mock mode and merges one-sided CLI override with config file', async () => {
      const { exitCode, stdout } = await runCliBuffered([
        'run',
        '--mock',
        '--json',
        '--topic',
        'Verify CLI digest binding',
        '--policy-digest',
        POLICY_HEX.toUpperCase(),
        '--evidence-digest',
        EVIDENCE_HEX
      ]);
      assert.equal(exitCode, 0);
      const payload = JSON.parse(stdout);
      assert.equal(payload.ok, true);
      assert.deepEqual(payload.state.expectedDigests, {
        policy: POLICY_HEX,
        evidence: EVIDENCE_HEX
      });

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-117-cli-'));
      try {
        const cfgPath = path.join(tmpDir, 'council.json');
        fs.writeFileSync(
          cfgPath,
          JSON.stringify(
            makeBaseConfig({
              expectedDigests: {
                policy: POLICY_HEX
              }
            })
          )
        );
        // Without CLI --evidence-digest, single-sided config file fails.
        const missingSide = await runCliBuffered(['run', '--mock', '--config', cfgPath]);
        assert.equal(missingSide.exitCode, 1);
        assert.match(missingSide.stderr, /expectedDigests\.evidence is required/);

        // Supplying --evidence-digest via CLI completes the pair cleanly.
        const mergedCfg = loadConfigFile(cfgPath, { expectedDigests: { evidence: EVIDENCE_HEX } });
        assert.deepEqual(mergedCfg.expectedDigests, { policy: POLICY_HEX, evidence: EVIDENCE_HEX });
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('Q2: Binding field validation rules on Judge summary and clauses', () => {
    const expected = { policy: POLICY_HEX, evidence: EVIDENCE_HEX };

    it('accepts a valid single binding pair (including case-insensitive hex and unrelated evidence hashes)', () => {
      const res = validateJudgeDigestBinding(
        {
          summary:
            `Verdict verified (artifact sha256=${UNRELATED_HEX_1}). ` +
            `**policy_sha256:** \`${POLICY_HEX.toUpperCase()}\`, ` +
            `frozen_packet_sha256="${EVIDENCE_HEX}".`,
          proofDecisions: {
            P1: {
              status: 'admitted',
              note: `Audited policy_sha256: ${POLICY_HEX} and frozen_packet_sha256: ${EVIDENCE_HEX}`
            }
          },
          clauses: [
            {
              context: `Artifact ${UNRELATED_HEX_2}`,
              conclusion: `Evidence hash ${UNRELATED_HEX_1} satisfies invariant.`,
              citedProofIds: ['P1']
            }
          ]
        },
        expected
      );
      assert.equal(res.valid, true);
      assert.deepEqual(res.errors, []);

      const localWrappedPairs = validateJudgeDigestBinding(
        {
          summary:
            `* Scope \`src/*\` (**policy_sha256: "${POLICY_HEX}"**), ` +
            `* Scope \`src/*\` (*frozen_packet_sha256: ${EVIDENCE_HEX}*)`,
          clauses: []
        },
        expected
      );
      assert.equal(localWrappedPairs.valid, true);
      assert.deepEqual(localWrappedPairs.errors, []);
    });

    it('rejects missing, mismatched, swapped, malformed, and duplicate summary bindings', () => {
      const missingBoth = validateJudgeDigestBinding({ summary: 'Clean verdict.', clauses: [] }, expected);
      assert.equal(missingBoth.valid, false);
      assert.ok(missingBoth.diagnostics.some((d) => d.kind === 'missing' && d.field === 'policy_sha256'));
      assert.ok(missingBoth.diagnostics.some((d) => d.kind === 'missing' && d.field === 'frozen_packet_sha256'));

      const mismatched = validateJudgeDigestBinding(
        {
          summary: `policy_sha256: ${UNRELATED_HEX_1}, frozen_packet_sha256: ${EVIDENCE_HEX}`,
          clauses: []
        },
        expected
      );
      assert.equal(mismatched.valid, false);
      assert.ok(mismatched.diagnostics.some((d) => d.kind === 'mismatch' && d.field === 'policy_sha256'));

      const swapped = validateJudgeDigestBinding(
        {
          summary: `policy_sha256: ${EVIDENCE_HEX}, frozen_packet_sha256: ${POLICY_HEX}`,
          clauses: []
        },
        expected
      );
      assert.equal(swapped.valid, false);
      assert.ok(swapped.diagnostics.some((d) => d.kind === 'swapped' && d.field === 'policy_sha256'));
      assert.ok(swapped.diagnostics.some((d) => d.kind === 'swapped' && d.field === 'frozen_packet_sha256'));

      const malformedCases = [
        `policy_sha256: ${POLICY_HEX.slice(0, 32)}, frozen_packet_sha256: ${EVIDENCE_HEX}`,
        `policy_sha256: ${POLICY_HEX_96}, frozen_packet_sha256: ${EVIDENCE_HEX}`,
        `policy_sha256: nothex, frozen_packet_sha256: ${EVIDENCE_HEX}`,
        `policy_sha256: "" ${POLICY_HEX}, frozen_packet_sha256: ${EVIDENCE_HEX}`,
        `policy_sha256: '' ${POLICY_HEX}, frozen_packet_sha256: ${EVIDENCE_HEX}`,
        `policy_sha256: \`\` ${POLICY_HEX}, frozen_packet_sha256: ${EVIDENCE_HEX}`,
        `policy_sha256: **** ${POLICY_HEX}, frozen_packet_sha256: ${EVIDENCE_HEX}`,
        `policy_sha256: "${POLICY_HEX}, frozen_packet_sha256: ${EVIDENCE_HEX}`,
        `policy_sha256: "${POLICY_HEX}"extra, frozen_packet_sha256: ${EVIDENCE_HEX}`,
        `policy_sha256: "${POLICY_HEX}""extra, frozen_packet_sha256: ${EVIDENCE_HEX}`,
        `policy_sha256: "${POLICY_HEX}"", frozen_packet_sha256: ${EVIDENCE_HEX}`,
        `policy_sha256: \`${POLICY_HEX}\`\`extra, frozen_packet_sha256: ${EVIDENCE_HEX}`,
        `policy_sha256: *${POLICY_HEX}**, frozen_packet_sha256: ${EVIDENCE_HEX}`,
        `* policy_sha256: ${POLICY_HEX}*\n* frozen_packet_sha256: ${EVIDENCE_HEX}`,
        `* Scope \`src/*\`; policy_sha256: ${POLICY_HEX}*\n* frozen_packet_sha256: ${EVIDENCE_HEX}`,
        `policy_sha256: "${POLICY_HEX}"**, frozen_packet_sha256: ${EVIDENCE_HEX}`,
        `policy_sha256: ${POLICY_HEX}**, frozen_packet_sha256: ${EVIDENCE_HEX}`,
        `policy_sha256:**${POLICY_HEX}, frozen_packet_sha256: ${EVIDENCE_HEX}`,
        `policy_sha256: __${POLICY_HEX}, frozen_packet_sha256: ${EVIDENCE_HEX}`,
        `policy_sha256 is missing separator, frozen_packet_sha256: ${EVIDENCE_HEX}`,
        `POLICY_SHA256: ${POLICY_HEX}, frozen_packet_sha256: ${EVIDENCE_HEX}`,
        `policy_sha256: \`${POLICY_HEX}\`extra, frozen_packet_sha256: ${EVIDENCE_HEX}`
      ];
      for (const summary of malformedCases) {
        const res = validateJudgeDigestBinding({ summary, clauses: [] }, expected);
        assert.equal(res.valid, false, `Expected failure for summary: ${summary}`);
        assert.ok(res.diagnostics.some((d) => d.kind === 'malformed' && d.field === 'policy_sha256'));
      }

      const duplicate = validateJudgeDigestBinding(
        {
          summary: `policy_sha256: ${POLICY_HEX}, policy_sha256: ${POLICY_HEX}, frozen_packet_sha256: ${EVIDENCE_HEX}`,
          clauses: []
        },
        expected
      );
      assert.equal(duplicate.valid, false);
      assert.ok(duplicate.diagnostics.some((d) => d.kind === 'duplicate' && d.field === 'policy_sha256'));
    });

    it('rejects valid or malformed binding fields in substantive clauses (including reproduced 96-char policy_sha256)', () => {
      const reproduced = validateJudgeDigestBinding(
        {
          summary: `Binding verified (policy_sha256: ${POLICY_HEX}, frozen_packet_sha256: ${EVIDENCE_HEX}).`,
          clauses: [
            {
              context: 'Policy verification',
              conclusion: `Confirmed against policy_sha256=${POLICY_HEX_96}`,
              citedProofIds: ['P1']
            }
          ]
        },
        expected
      );
      assert.equal(reproduced.valid, false);
      assert.deepEqual(
        reproduced.diagnostics.map((d) => [d.location, d.field, d.kind]),
        [['judge.clauses[0].conclusion', 'policy_sha256', 'clause_repetition']]
      );

      const valuelessMention = validateJudgeDigestBinding(
        {
          summary: `policy_sha256: ${POLICY_HEX}, frozen_packet_sha256: ${EVIDENCE_HEX}`,
          clauses: [
            {
              id: 'clause-1',
              context: 'See frozen_packet_sha256 in header',
              conclusion: 'Valid claim',
              citedProofIds: ['P1']
            }
          ]
        },
        expected
      );
      assert.equal(valuelessMention.valid, false);
      assert.deepEqual(
        valuelessMention.diagnostics.map((d) => [d.location, d.field, d.kind]),
        [['judge.clauses[0].context', 'frozen_packet_sha256', 'clause_repetition']]
      );

      const clausePropertyMention = validateJudgeDigestBinding(
        {
          summary: `policy_sha256: ${POLICY_HEX}, frozen_packet_sha256: ${EVIDENCE_HEX}`,
          clauses: [
            {
              context: 'Valid context',
              conclusion: 'Valid claim',
              policy_sha256: 'malformed',
              notes: `nested ${'a'}`,
              nested: { frozen_packet_sha256: EVIDENCE_HEX },
              citedProofIds: ['P1']
            }
          ]
        },
        expected
      );
      assert.equal(clausePropertyMention.valid, false);
      assert.ok(
        clausePropertyMention.diagnostics.some(
          (d) =>
            d.location === 'judge.clauses[0].policy_sha256' &&
            d.field === 'policy_sha256' &&
            d.kind === 'clause_repetition'
        )
      );
      assert.ok(
        clausePropertyMention.diagnostics.some(
          (d) =>
            d.location === 'judge.clauses[0].nested.frozen_packet_sha256' &&
            d.field === 'frozen_packet_sha256' &&
            d.kind === 'clause_repetition'
        )
      );
    });

    it('includes nested hyphenated clause paths in Judge retryFeedback and never hijacks citation errors referencing policy_sha256', async () => {
      const h1 = new MockAdapter();
      const nestedAttempts = [];
      h1.executeSeatProof = async ({ seat }) => makeProof(seat.id);
      h1.executeSeatVote = async () => ({ vote: 'accept' });
      h1.executeJudgeAuditAndSynthesis = async ({ proofs, context }) => {
        nestedAttempts.push(context?.retryFeedback);
        if (nestedAttempts.length === 1) {
          return validJudgePayload(
            proofs,
            `Approved (policy_sha256: ${POLICY_HEX}, frozen_packet_sha256: ${EVIDENCE_HEX}).`,
            [
              {
                context: 'Clean context',
                conclusion: 'Clean conclusion',
                metadata: { 'review-notes': `policy_sha256: ${POLICY_HEX_96}` },
                citedProofIds: proofs.map((p) => p.id)
              }
            ]
          );
        }
        return validJudgePayload(
          proofs,
          `Approved (policy_sha256: ${POLICY_HEX}, frozen_packet_sha256: ${EVIDENCE_HEX}).`
        );
      };

      const res1 = await new CouncilEngine(
        makeBaseConfig({ expectedDigests: { policy: POLICY_HEX, evidence: EVIDENCE_HEX } }),
        { harnessResolver: () => h1 }
      ).run();
      assert.equal(res1.ok, true);
      assert.equal(nestedAttempts.length, 2);
      assert.match(nestedAttempts[1], /judge\.clauses\[1\]\.metadata\.review-notes: remove policy_sha256/);

      // Non-opted-in citation failure mentioning a host workspace named "policy_sha256" keeps portable-citation feedback.
      const h2 = new MockAdapter();
      const citationAttempts = [];
      h2.executeSeatProof = async ({ seat }) => makeProof(seat.id);
      h2.executeSeatVote = async () => ({ vote: 'accept' });
      h2.executeJudgeAuditAndSynthesis = async ({ proofs, context }) => {
        citationAttempts.push(context?.retryFeedback);
        if (citationAttempts.length === 1) {
          return validJudgePayload(proofs, 'Verified from /tmp/policy_sha256/repo/src/index.js:1');
        }
        return validJudgePayload(proofs, 'Verified cleanly.');
      };

      const res2 = await new CouncilEngine(
        makeBaseConfig({ judge: { id: 'judge-1', harness: 'mock', model: 'gpt-6-astra', tools: 'none', cwd: '/tmp/policy_sha256/repo' } }),
        { harnessResolver: () => h2 }
      ).run();
      assert.equal(res2.ok, true);
      assert.equal(citationAttempts.length, 2);
      assert.match(citationAttempts[1], /judge\.summary: use portable workspace-relative citations\./);
      assert.doesNotMatch(citationAttempts[1], /64-character hex digest/);
    });
  });

  describe('Q3: Engine bounded Judge retry, diagnostics preservation, and confirmation gating', () => {
    it('reproduced regression: retries Judge once with corrective feedback, fixed inputs/model/effort, then votes once to Unanimous Consensus', async () => {
      const h = new MockAdapter();
      const seatVoteCalls = [];
      const judgeCalls = [];

      h.executeSeatProof = async ({ seat }) => makeProof(seat.id);
      h.executeSeatVote = async ({ seat }) => {
        seatVoteCalls.push(seat.id);
        return { vote: 'accept' };
      };
      h.executeJudgeAuditAndSynthesis = async (args) => {
        judgeCalls.push({
          model: args.judge.model,
          reasoningEffort: args.judge.reasoningEffort,
          tools: args.tools,
          evidence: args.state.evidence,
          expectedDigests: args.state.expectedDigests,
          retryFeedback: args.context?.retryFeedback
        });
        if (judgeCalls.length === 1) {
          return {
            ...validJudgePayload(
              args.proofs,
              `Approved (policy_sha256: ${POLICY_HEX}, frozen_packet_sha256: ${EVIDENCE_HEX}).`,
              [
                {
                  context: 'Policy check',
                  conclusion: `Repeated digest policy_sha256: ${POLICY_HEX_96} (secret-marker-do-not-echo)`,
                  citedProofIds: args.proofs.map((p) => p.id)
                }
              ]
            )
          };
        }
        return validJudgePayload(
          args.proofs,
          `Approved (policy_sha256: ${POLICY_HEX}, frozen_packet_sha256: ${EVIDENCE_HEX}). Unrelated artifact: ${UNRELATED_HEX_2}.`
        );
      };

      const engine = new CouncilEngine(
        makeBaseConfig({
          expectedDigests: { policy: POLICY_HEX, evidence: EVIDENCE_HEX },
          retryEffortFallback: true
        }),
        { harnessResolver: () => h }
      );
      const result = await engine.run();

      assert.equal(result.ok, true);
      assert.equal(result.verdict.kind, 'Unanimous Consensus');
      assert.equal(judgeCalls.length, 2);
      assert.equal(seatVoteCalls.length, 3);

      // Fixed model, effort, tools, and frozen inputs across Judge retry
      assert.equal(judgeCalls[1].model, 'gpt-6-astra');
      assert.equal(judgeCalls[1].reasoningEffort, 'xhigh');
      assert.equal(judgeCalls[1].tools, 'none');
      assert.deepEqual(judgeCalls[1].evidence, judgeCalls[0].evidence);
      assert.deepEqual(judgeCalls[1].expectedDigests, judgeCalls[0].expectedDigests);

      // Bounded coordinator-owned retryFeedback identifies field without echoing raw untrusted content
      assert.match(judgeCalls[1].retryFeedback, /judge\.clauses\[1\]\.conclusion/);
      assert.match(judgeCalls[1].retryFeedback, /policy_sha256/);
      assert.doesNotMatch(judgeCalls[1].retryFeedback, /secret-marker-do-not-echo/);

      // Preserved rejected Judge response + validation errors inspectable after recovery
      assert.ok(result.state.judge.lastRejectedResponse.includes(POLICY_HEX_96));
      assert.ok(
        result.state.judge.lastValidationErrors.some(
          (e) => e.includes('judge.clauses[1].conclusion') && e.includes('policy_sha256')
        )
      );
      const faultEvents = engine.getTelemetry().getTelemetryHistory('judge-1').filter((t) => t.status === 'fault');
      assert.equal(faultEvents.length, 1);
      assert.ok(faultEvents[0].metadata.rejectedResponse.includes(POLICY_HEX_96));
    });

    it('keeps digest binding errors ahead of numerous citation errors in retryFeedback and lastValidationErrors', async () => {
      const h = new MockAdapter();
      const judgeAttempts = [];
      h.executeSeatProof = async ({ seat }) => makeProof(seat.id);
      h.executeSeatVote = async () => ({ vote: 'accept' });
      h.executeJudgeAuditAndSynthesis = async ({ proofs, context }) => {
        judgeAttempts.push(context?.retryFeedback);
        if (judgeAttempts.length === 1) {
          const manyBadClauses = Array.from({ length: 10 }, (_, idx) => ({
            context: `Clause ../bad-${idx} context`,
            conclusion: `Clause ../bad-${idx} conclusion`,
            citedProofIds: proofs.map((p) => p.id)
          }));
          return {
            summary: `Approved (policy_sha256: ${POLICY_HEX}).`,
            proofDecisions: Object.fromEntries(proofs.map((p) => [p.id, { status: 'admitted', note: 'Verified.' }])),
            clauses: manyBadClauses
          };
        }
        return validJudgePayload(
          proofs,
          `Approved (policy_sha256: ${POLICY_HEX}, frozen_packet_sha256: ${EVIDENCE_HEX}).`
        );
      };

      const engine = new CouncilEngine(
        makeBaseConfig({ expectedDigests: { policy: POLICY_HEX, evidence: EVIDENCE_HEX } }),
        { harnessResolver: () => h }
      );
      const res = await engine.run();
      assert.equal(res.ok, true);
      assert.equal(judgeAttempts.length, 2);
      assert.match(judgeAttempts[1], /frozen_packet_sha256/);
      assert.ok(
        res.state.judge.lastValidationErrors.some((e) => e.includes('frozen_packet_sha256'))
      );
    });

    it('terminates with Dissent Report (Judge Fault) and zero confirmation votes when retries run out across invalid binding modes', async () => {
      const invalidBuilders = [
        {
          name: 'missing',
          build: (proofs) => validJudgePayload(proofs, 'No digest bindings here.')
        },
        {
          name: 'mismatched',
          build: (proofs) =>
            validJudgePayload(proofs, `policy_sha256: ${UNRELATED_HEX_1}, frozen_packet_sha256: ${EVIDENCE_HEX}`)
        },
        {
          name: 'swapped',
          build: (proofs) =>
            validJudgePayload(proofs, `policy_sha256: ${EVIDENCE_HEX}, frozen_packet_sha256: ${POLICY_HEX}`)
        },
        {
          name: 'malformed',
          build: (proofs) =>
            validJudgePayload(proofs, `policy_sha256: ${POLICY_HEX.slice(0, 63)}, frozen_packet_sha256: ${EVIDENCE_HEX}`)
        },
        {
          name: 'duplicate',
          build: (proofs) =>
            validJudgePayload(
              proofs,
              `policy_sha256: ${POLICY_HEX}, policy_sha256: ${POLICY_HEX}, frozen_packet_sha256: ${EVIDENCE_HEX}`
            )
        },
        {
          name: 'reproduced-96-char-clause',
          build: (proofs) =>
            validJudgePayload(
              proofs,
              `policy_sha256: ${POLICY_HEX}, frozen_packet_sha256: ${EVIDENCE_HEX}`,
              [{ context: 'Clause', conclusion: `policy_sha256: ${POLICY_HEX_96}`, citedProofIds: ['P1'] }]
            )
        }
      ];

      for (const scenario of invalidBuilders) {
        const h = new MockAdapter();
        let voteCalls = 0;
        let judgeCalls = 0;

        h.executeSeatProof = async ({ seat }) => makeProof(seat.id);
        h.executeSeatVote = async () => {
          voteCalls += 1;
          return { vote: 'accept' };
        };
        h.executeJudgeAuditAndSynthesis = async ({ proofs }) => {
          judgeCalls += 1;
          return scenario.build(proofs);
        };

        const engine = new CouncilEngine(
          makeBaseConfig({
            expectedDigests: { policy: POLICY_HEX, evidence: EVIDENCE_HEX },
            maxRetriesPerJudge: 1
          }),
          { harnessResolver: () => h }
        );
        const result = await engine.run();

        assert.equal(result.ok, false, `Expected failure for ${scenario.name}`);
        assert.equal(result.verdict.kind, 'Dissent Report (Judge Fault)', `Expected Judge Fault for ${scenario.name}`);
        assert.equal(judgeCalls, 2, `Expected initial attempt + 1 retry for ${scenario.name}`);
        assert.equal(voteCalls, 0, `Expected 0 confirmation votes for ${scenario.name}`);
        assert.ok(result.state.judge.lastRejectedResponse, `Expected preserved rejected response for ${scenario.name}`);
        assert.ok(
          Array.isArray(result.state.judge.lastValidationErrors) && result.state.judge.lastValidationErrors.length > 0,
          `Expected preserved validationErrors for ${scenario.name}`
        );
      }
    });

    it('preserves rejected Judge response through VisualizerLiveWatcher, snapshots, and CLI --json on maxRetriesPerJudge: 0', async () => {
      const h = new MockAdapter();
      let voteCalls = 0;
      let judgeCalls = 0;

      h.executeSeatProof = async ({ seat }) => makeProof(seat.id);
      h.executeSeatVote = async () => {
        voteCalls += 1;
        return { vote: 'accept' };
      };
      h.executeJudgeAuditAndSynthesis = async ({ proofs }) => {
        judgeCalls += 1;
        return validJudgePayload(
          proofs,
          `policy_sha256: ${POLICY_HEX}, frozen_packet_sha256: ${EVIDENCE_HEX}`,
          [{ context: 'Repeated binding', conclusion: `policy_sha256=${POLICY_HEX_96}`, citedProofIds: ['P1'] }]
        );
      };

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-117-watcher-'));
      try {
        const watcher = new VisualizerLiveWatcher({
          outputDir: tmpDir,
          initialConfig: makeBaseConfig({
            maxRetriesPerJudge: 0,
            expectedDigests: { policy: POLICY_HEX, evidence: EVIDENCE_HEX }
          })
        });
        const engine = new CouncilEngine(
          makeBaseConfig({
            maxRetriesPerJudge: 0,
            expectedDigests: { policy: POLICY_HEX, evidence: EVIDENCE_HEX }
          }),
          { harnessResolver: () => h }
        );
        watcher.attach(engine.getTelemetry());
        const res = await engine.run();
        watcher.stop();

        assert.equal(res.ok, false);
        assert.equal(judgeCalls, 1);
        assert.equal(voteCalls, 0);
        assert.equal(res.verdict.kind, 'Dissent Report (Judge Fault)');
        assert.ok(res.state.judge.lastRejectedResponse.includes(POLICY_HEX_96));
        assert.ok(watcher.liveRun.currentState.judge.lastRejectedResponse.includes(POLICY_HEX_96));

        const terminalSnap = res.snapshots[res.snapshots.length - 1];
        assert.equal(terminalSnap.event.type, 'JUDGE_FAULT');
        assert.ok(terminalSnap.event.rejectedResponse.includes(POLICY_HEX_96));
        assert.ok(terminalSnap.stateSnapshot.judge.lastRejectedResponse.includes(POLICY_HEX_96));

        // Verify rehydrated step retains preserved rejected response
        const lastStep = watcher.liveRun.steps[watcher.liveRun.steps.length - 1];
        assert.ok(lastStep.stateSnapshot.judge.lastRejectedResponse.includes(POLICY_HEX_96));
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('keeps existing runs without expectedDigests unchanged (including Judge InvalidResponseError retry config and fault shape)', async () => {
      const h = new MockAdapter();
      let voteCalls = 0;
      const judgeEfforts = [];
      h.executeSeatProof = async ({ seat }) => makeProof(seat.id);
      h.executeSeatVote = async () => {
        voteCalls += 1;
        return { vote: 'accept' };
      };
      h.executeJudgeAuditAndSynthesis = async ({ proofs, judge }) => {
        judgeEfforts.push(judge.reasoningEffort);
        if (judgeEfforts.length === 1) {
          return validJudgePayload(proofs, 'Invalid .council/runs/latest.js:12 path');
        }
        return validJudgePayload(proofs, 'Consensus summary without any SHA-256 digests.');
      };

      const cfgWithoutEffort = makeBaseConfig();
      delete cfgWithoutEffort.judge.reasoningEffort;
      const engine = new CouncilEngine(cfgWithoutEffort, { harnessResolver: () => h });
      const result = await engine.run();
      assert.equal(result.ok, true);
      assert.equal(result.verdict.kind, 'Unanimous Consensus');
      assert.equal(voteCalls, 3);
      assert.deepEqual(judgeEfforts, [undefined, 'high']);
      assert.equal('lastRejectedResponse' in result.state.judge, false);
      assert.equal('lastValidationErrors' in result.state.judge, false);
      const faultEvents = engine.getTelemetry().getTelemetryHistory('judge-1').filter((t) => t.status === 'fault');
      assert.equal(faultEvents.length, 1);
      assert.equal('rejectedResponse' in faultEvents[0].metadata, false);
      assert.equal('validationErrors' in faultEvents[0].metadata, false);

      const promptWithout = formatJudgePrompt({
        judge: { id: 'j', model: 'm', tools: 'none' },
        round: 1,
        proofs: [],
        state: { topic: 'Test' }
      });
      assert.doesNotMatch(promptWithout, /Required Digest Binding/);

      const promptWith = formatJudgePrompt({
        judge: { id: 'j', model: 'm', tools: 'none' },
        round: 1,
        proofs: [],
        state: { topic: 'Test', expectedDigests: { policy: POLICY_HEX, evidence: EVIDENCE_HEX } }
      });
      assert.match(promptWith, /Required Digest Binding/);
      assert.ok(promptWith.includes(POLICY_HEX));
      assert.ok(promptWith.includes(EVIDENCE_HEX));
    });

    it('delivers digest binding retryFeedback into CodexAdapter, AntigravityAdapter, and CursorAdapter Judge retry prompts', async () => {
      const feedback =
        'The previous response failed validation. Return the required JSON contract. ' +
        'judge.clauses[0].conclusion: remove policy_sha256 from substantive clauses; place policy_sha256 and frozen_packet_sha256 only once in judge.summary and cite proof IDs in clauses.';

      for (const Adapter of [CodexAdapter, AntigravityAdapter, CursorAdapter]) {
        const prompts = [];
        const adapter = new Adapter({
          spawnRunner: async ({ prompt }) => {
            prompts.push(prompt);
            return JSON.stringify(
              validJudgePayload(
                [{ id: 'P1' }],
                `Verified (policy_sha256: ${POLICY_HEX}, frozen_packet_sha256: ${EVIDENCE_HEX}).`
              )
            );
          }
        });
        adapter.validateModel = () => {};
        await adapter.executeJudge({
          judge: { id: 'judge-1', model: 'test-model', tools: 'none' },
          phase: 'JUDGE_AUDIT_SYNTHESIS',
          round: 1,
          proofs: [],
          state: {
            topic: 'Digest binding retry prompt delivery',
            expectedDigests: { policy: POLICY_HEX, evidence: EVIDENCE_HEX }
          },
          context: { retryFeedback: feedback }
        });
        assert.equal(prompts.length, 1);
        assert.match(prompts[0], /Validation retry instructions:/);
        assert.match(prompts[0], /judge\.clauses\[0\]\.conclusion: remove policy_sha256/);
      }
    });
  });
});
