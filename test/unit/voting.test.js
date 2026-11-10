import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { downshiftEffort, downshiftModel } from '../../src/harness/cli-runner.js';
import { resolveVotingSeatConfig, CouncilEngine } from '../../src/engine/council-engine.js';
import { formatVotingPrompt } from '../../src/seats/soul.js';
import { MockAdapter } from '../../src/harness/mock.js';
import { InvalidResponseError, TimeoutError } from '../../src/harness/adapter.js';

describe('Unit: Confirmation Voting Optimization (Milestone M5 / Issue #72)', () => {
  describe('downshiftEffort helper', () => {
    it('downshifts high and max effort tiers to low by default', () => {
      assert.equal(downshiftEffort('max'), 'low');
      assert.equal(downshiftEffort('xhigh'), 'low');
      assert.equal(downshiftEffort('high'), 'low');
    });

    it('downshifts to intermediate target efforts when requested', () => {
      assert.equal(downshiftEffort('max', 'medium'), 'medium');
      assert.equal(downshiftEffort('xhigh', 'medium'), 'medium');
      assert.equal(downshiftEffort('high', 'medium'), 'medium');
    });

    it('never upshifts lower effort tiers', () => {
      assert.equal(downshiftEffort('low', 'medium'), 'low');
      assert.equal(downshiftEffort('medium', 'high'), 'medium');
      assert.equal(downshiftEffort('low', 'high'), 'low');
    });

    it('handles undefined or unrecognized efforts cleanly', () => {
      assert.equal(downshiftEffort(undefined), 'low');
      assert.equal(downshiftEffort('unknown', 'low'), 'low');
    });
  });

  describe('downshiftModel helper', () => {
    it('downshifts hyphenated model suffixes', () => {
      assert.equal(downshiftModel('grok-4.7-xhigh'), 'grok-4.7-low');
      assert.equal(downshiftModel('grok-4.7-high'), 'grok-4.7-low');
      assert.equal(downshiftModel('gemini-4-argon-high'), 'gemini-4-argon-low');
      assert.equal(downshiftModel('claude-opus-5-5-high'), 'claude-opus-5-5-low');
      assert.equal(downshiftModel('grok-4.7-xhigh', 'medium'), 'grok-4.7-medium');
    });

    it('downshifts parenthesized model syntax', () => {
      assert.equal(downshiftModel('gpt-6-astra (max)'), 'gpt-6-astra (low)');
      assert.equal(downshiftModel('gpt-6.1-sol (high)'), 'gpt-6.1-sol (low)');
      assert.equal(downshiftModel('gpt-6-astra (max)', 'medium'), 'gpt-6-astra (medium)');
    });

    it('leaves models without effort tiers unchanged', () => {
      assert.equal(downshiftModel('composer-2.5'), 'composer-2.5');
      assert.equal(downshiftModel('plain-model'), 'plain-model');
    });

    it('preserves non-string or empty models', () => {
      assert.equal(downshiftModel(''), '');
      assert.equal(downshiftModel(null), null);
      assert.equal(downshiftModel(undefined), undefined);
    });
  });

  describe('resolveVotingSeatConfig helper', () => {
    const baseSeat = {
      id: 'voter-1',
      harness: 'cursor',
      model: 'grok-4.7-xhigh',
      soul: 'Skeptic',
      tools: 'read-only',
      timeoutMs: 240000
    };

    it('defaults tools to "none" when votingTools is undefined', () => {
      const cfg = resolveVotingSeatConfig(baseSeat);
      assert.equal(cfg.tools, 'none');
    });

    it('respects explicit seat.votingTools override', () => {
      const cfg = resolveVotingSeatConfig({ ...baseSeat, votingTools: 'read-only' });
      assert.equal(cfg.tools, 'read-only');
    });

    it('respects engineConfig.votingTools when seat does not specify it', () => {
      const cfg = resolveVotingSeatConfig(baseSeat, { votingTools: 'read-only' });
      assert.equal(cfg.tools, 'read-only');
    });

    it('downshifts model effort from high/max to low by default', () => {
      const cfg = resolveVotingSeatConfig(baseSeat);
      assert.equal(cfg.model, 'grok-4.7-low');

      const astraCfg = resolveVotingSeatConfig({
        ...baseSeat,
        harness: 'codex',
        model: 'gpt-6-astra (max)'
      });
      assert.equal(astraCfg.model, 'gpt-6-astra (low)');
    });

    it('respects seat.votingReasoningEffort override', () => {
      const cfg = resolveVotingSeatConfig({
        ...baseSeat,
        votingReasoningEffort: 'medium'
      });
      assert.equal(cfg.model, 'grok-4.7-medium');
    });

    it('preserves model when preserveVotingEffort is true', () => {
      const cfg = resolveVotingSeatConfig({
        ...baseSeat,
        preserveVotingEffort: true
      });
      assert.equal(cfg.model, 'grok-4.7-xhigh');
    });

    it('uses explicit votingModel when provided', () => {
      const cfg = resolveVotingSeatConfig({
        ...baseSeat,
        votingModel: 'custom-voting-model'
      });
      assert.equal(cfg.model, 'custom-voting-model');
    });

    it('bounds votingTimeoutMs to Math.min(seatTimeout, votingTimeout, 90000)', () => {
      // 240000 timeout bounded to default 90000
      const cfg1 = resolveVotingSeatConfig(baseSeat);
      assert.equal(cfg1.votingTimeoutMs, 90000);

      // 45000 timeout preserved (not inflated)
      const cfg2 = resolveVotingSeatConfig({ ...baseSeat, timeoutMs: 45000 });
      assert.equal(cfg2.votingTimeoutMs, 45000);

      // explicit votingTimeoutMs respected if smaller
      const cfg3 = resolveVotingSeatConfig({ ...baseSeat, votingTimeoutMs: 30000 });
      assert.equal(cfg3.votingTimeoutMs, 30000);

      // engine-level votingTimeoutMs respected
      const cfg4 = resolveVotingSeatConfig(baseSeat, { votingTimeoutMs: 60000 });
      assert.equal(cfg4.votingTimeoutMs, 60000);
    });
  });

  describe('formatVotingPrompt directives', () => {
    const candidate = {
      round: 1,
      summary: 'Test summary',
      clauses: [{ id: 'C1', context: 'General', conclusion: 'Assertion', citedProofIds: ['P1'] }]
    };
    const admittedProofs = [
      { id: 'P1', kind: 'check', scope: 'General', statement: 'Verified', source: 'Spec' }
    ];

    it('injects tool-free immediate JSON voting instruction when tools is "none"', () => {
      const prompt = formatVotingPrompt({
        soul: 'Pragmatic Reviewer',
        candidate,
        admittedProofs,
        tools: 'none'
      });
      assert.ok(
        prompt.includes(
          'Do not invoke any tools during confirmation voting. Evaluate the Candidate Clauses strictly against the audited Proofs provided above and return your JSON vote immediately.'
        )
      );
      assert.ok(!prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));
    });

    it('injects tool usage verification directive when tools is "read-only"', () => {
      const prompt = formatVotingPrompt({
        soul: 'Pragmatic Reviewer',
        candidate,
        admittedProofs,
        tools: 'read-only'
      });
      assert.ok(prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));
      assert.ok(
        !prompt.includes(
          'Do not invoke any tools during confirmation voting. Evaluate the Candidate Clauses strictly against the audited Proofs provided above and return your JSON vote immediately.'
        )
      );
    });
  });

  describe('CouncilEngine end-to-end voting dispatch', () => {
    it('executes active voters with downshifted model, capped timeout, and tool-free prompt', async () => {
      const capturedVoteCalls = [];
      const mockHarness = new MockAdapter();
      const origExecuteSeat = mockHarness.executeSeat.bind(mockHarness);

      mockHarness.executeSeat = async (ctx) => {
        if (ctx.phase === 'VOTING') {
          capturedVoteCalls.push({
            seatId: ctx.seat.id,
            model: ctx.seat.model,
            timeoutMs: ctx.timeoutMs,
            tools: ctx.tools,
            votingTools: ctx.seat.votingTools,
            prompt: formatVotingPrompt({
              soul: ctx.soul,
              seat: ctx.seat,
              tools: ctx.tools,
              candidate: ctx.candidate,
              admittedProofs: (ctx.state?.proofs || []).filter((p) => p.status === 'admitted')
            })
          });
          return { vote: 'accept' };
        }
        return origExecuteSeat(ctx);
      };

      const engine = new CouncilEngine(
        {
          topic: 'Voting optimization end-to-end check',
          maxRounds: 1,
          minQuorum: 2,
          judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            {
              id: 'voter-xhigh',
              harness: 'mock',
              model: 'grok-4.7-xhigh',
              soul: 'Skeptic',
              timeoutMs: 240000
            },
            {
              id: 'voter-max',
              harness: 'mock',
              model: 'gpt-6-astra (max)',
              soul: 'Architect',
              timeoutMs: 240000
            },
            {
              id: 'voter-preserved',
              harness: 'mock',
              model: 'grok-4.7-xhigh',
              soul: 'Conservative',
              preserveVotingEffort: true,
              timeoutMs: 120000
            }
          ]
        },
        { harnessResolver: () => mockHarness }
      );

      engine.initRoster();
      const result = await engine.run();
      assert.equal(result.ok, true);
      assert.equal(capturedVoteCalls.length, 3);

      const xhighCall = capturedVoteCalls.find((c) => c.seatId === 'voter-xhigh');
      assert.ok(xhighCall);
      assert.equal(xhighCall.model, 'grok-4.7-low');
      assert.equal(xhighCall.timeoutMs, 90000);
      assert.equal(xhighCall.tools, 'none');
      assert.ok(
        xhighCall.prompt.includes(
          'Do not invoke any tools during confirmation voting. Evaluate the Candidate Clauses strictly against the audited Proofs provided above and return your JSON vote immediately.'
        )
      );

      const maxCall = capturedVoteCalls.find((c) => c.seatId === 'voter-max');
      assert.ok(maxCall);
      assert.equal(maxCall.model, 'gpt-6-astra (low)');
      assert.equal(maxCall.timeoutMs, 90000);
      assert.equal(maxCall.tools, 'none');

      const preservedCall = capturedVoteCalls.find((c) => c.seatId === 'voter-preserved');
      assert.ok(preservedCall);
      assert.equal(preservedCall.model, 'grok-4.7-xhigh');
      assert.equal(preservedCall.timeoutMs, 90000);
      assert.equal(preservedCall.tools, 'none');
    });

    it('enforces tools: "none" and tool-free prompt directives on voting retry after InvalidResponseError', async () => {
      const capturedVoteCalls = [];
      const mockHarness = new MockAdapter();

      mockHarness.executeSeatVote = async (ctx) => {
        capturedVoteCalls.push({
          seatId: ctx.seat.id,
          attempt: capturedVoteCalls.filter((c) => c.seatId === ctx.seat.id).length + 1,
          tools: ctx.tools,
          seatTools: ctx.seat.tools,
          seatVotingTools: ctx.seat.votingTools,
          prompt: formatVotingPrompt({
            soul: ctx.soul,
            seat: ctx.seat,
            tools: ctx.tools,
            candidate: ctx.candidate,
            admittedProofs: (ctx.state?.proofs || []).filter((p) => p.status === 'admitted')
          })
        });

        if (
          ctx.seat.id === 'voter-invalid-json' &&
          capturedVoteCalls.filter((c) => c.seatId === 'voter-invalid-json').length === 1
        ) {
          throw new InvalidResponseError('Malformed JSON in vote output', {
            seatId: ctx.seat.id,
            harness: 'mock'
          });
        }

        return { vote: 'accept' };
      };

      const engine = new CouncilEngine(
        {
          topic: 'Voting non-timeout retry tool guard check',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 1,
          judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            {
              id: 'voter-invalid-json',
              harness: 'mock',
              model: 'grok-4.7-xhigh',
              soul: 'Skeptic',
              tools: 'read-only',
              timeoutMs: 240000
            },
            {
              id: 'voter-2',
              harness: 'mock',
              model: 'gpt-6-astra (max)',
              soul: 'Partner',
              tools: 'read-only'
            }
          ]
        },
        { harnessResolver: () => mockHarness }
      );

      engine.initRoster();
      const result = await engine.run();
      assert.equal(result.ok, true);

      const invalidVoterCalls = capturedVoteCalls.filter((c) => c.seatId === 'voter-invalid-json');
      assert.equal(invalidVoterCalls.length, 2);

      // Attempt 1: tools is 'none'
      assert.equal(invalidVoterCalls[0].tools, 'none');
      assert.equal(invalidVoterCalls[0].seatVotingTools, 'none');
      assert.ok(invalidVoterCalls[0].prompt.includes('Do not invoke any tools during confirmation voting'));
      assert.ok(!invalidVoterCalls[0].prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));

      // Attempt 2 (retry after InvalidResponseError): tools must STILL be 'none', NOT 'read-only'
      assert.equal(invalidVoterCalls[1].tools, 'none');
      assert.equal(invalidVoterCalls[1].seatTools, 'none');
      assert.equal(invalidVoterCalls[1].seatVotingTools, 'none');
      assert.ok(invalidVoterCalls[1].prompt.includes('Do not invoke any tools during confirmation voting'));
      assert.ok(!invalidVoterCalls[1].prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));
    });

    it('keeps tools: "none" sticky across subsequent non-timeout retries when votingTools is "read-only" and Retry 1 timed out', async () => {
      const capturedVoteCalls = [];
      const mockHarness = new MockAdapter();

      mockHarness.executeSeatVote = async (ctx) => {
        const seatAttempt = capturedVoteCalls.filter((c) => c.seatId === ctx.seat.id).length + 1;
        capturedVoteCalls.push({
          seatId: ctx.seat.id,
          attempt: seatAttempt,
          tools: ctx.tools,
          seatTools: ctx.seat.tools,
          seatVotingTools: ctx.seat.votingTools,
          prompt: formatVotingPrompt({
            soul: ctx.soul,
            seat: ctx.seat,
            tools: ctx.tools,
            candidate: ctx.candidate,
            admittedProofs: (ctx.state?.proofs || []).filter((p) => p.status === 'admitted')
          })
        });

        if (ctx.seat.id === 'voter-sticky-timeout') {
          if (seatAttempt === 1) {
            throw new TimeoutError('Voting tool hang timed out on attempt 1', {
              seatId: ctx.seat.id,
              harness: 'mock',
              timeoutMs: 30000
            });
          }
          if (seatAttempt === 2) {
            throw new InvalidResponseError('Malformed JSON in retry 1 vote output', {
              seatId: ctx.seat.id,
              harness: 'mock'
            });
          }
        }

        return { vote: 'accept' };
      };

      const engine = new CouncilEngine(
        {
          topic: 'Sticky tools:none across chained TimeoutError -> InvalidResponseError voting retries',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 2,
          votingTools: 'read-only',
          judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            {
              id: 'voter-sticky-timeout',
              harness: 'mock',
              model: 'grok-4.7-xhigh',
              soul: 'Skeptic',
              tools: 'read-only',
              timeoutMs: 240000
            },
            {
              id: 'voter-2',
              harness: 'mock',
              model: 'gpt-6-astra (max)',
              soul: 'Partner',
              tools: 'read-only'
            }
          ]
        },
        { harnessResolver: () => mockHarness }
      );

      engine.initRoster();
      const result = await engine.run();
      assert.equal(result.ok, true);

      const stickyCalls = capturedVoteCalls.filter((c) => c.seatId === 'voter-sticky-timeout');
      assert.equal(stickyCalls.length, 3);

      // Attempt 1: configured votingTools: 'read-only'
      assert.equal(stickyCalls[0].tools, 'read-only');
      assert.equal(stickyCalls[0].seatTools, 'read-only');
      assert.equal(stickyCalls[0].seatVotingTools, 'read-only');
      assert.ok(stickyCalls[0].prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));

      // Attempt 2 (Retry 1 after TimeoutError): stripped to tools: 'none'
      assert.equal(stickyCalls[1].tools, 'none');
      assert.equal(stickyCalls[1].seatTools, 'none');
      assert.equal(stickyCalls[1].seatVotingTools, 'none');
      assert.ok(stickyCalls[1].prompt.includes('Do not invoke any tools during confirmation voting'));
      assert.ok(!stickyCalls[1].prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));

      // Attempt 3 (Retry 2 after InvalidResponseError): must remain sticky at tools: 'none'
      assert.equal(stickyCalls[2].tools, 'none');
      assert.equal(stickyCalls[2].seatTools, 'none');
      assert.equal(stickyCalls[2].seatVotingTools, 'none');
      assert.ok(stickyCalls[2].prompt.includes('Do not invoke any tools during confirmation voting'));
      assert.ok(!stickyCalls[2].prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));
    });
  });
});
