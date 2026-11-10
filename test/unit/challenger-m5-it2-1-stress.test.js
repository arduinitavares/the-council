/**
 * @fileoverview Adversarial Stress Test Suite: Voting Retry Tool Enforcement Across Fault Classes.
 * Milestone M5 Iteration 2 Challenger 1.
 *
 * Verifies:
 * 1. Default voting retry when deliberation seat has tools: 'read-only':
 *    a) InvalidResponseError (malformed JSON)
 *    b) Generic Error (unhandled execution exception)
 *    c) TimeoutError (timeout fault)
 *    d) Multi-round retries under maxRetriesPerSeat: 3
 *    - Asserts that executeSeatVote and formatVotingPrompt strictly receive tools: 'none'
 *      and never leak deliberation 'read-only' across all attempts.
 * 2. Explicit seat.votingTools: 'read-only':
 *    a) Non-timeout retry (InvalidResponseError) preserves 'read-only'
 *    b) Non-timeout retry (Generic Error) preserves 'read-only'
 *    c) Timeout retry (TimeoutError) strictly forces 'none'
 *    d) Mixed retry sequence (InvalidResponseError -> TimeoutError) transitions to 'none'
 * 3. Harness execution paths:
 *    a) executeSeat fallback when executeSeatVote is not defined
 *    b) MockAdapter prompt recording integration
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CouncilEngine } from '../../src/engine/council-engine.js';
import { MockAdapter } from '../../src/harness/mock.js';
import {
  InvalidResponseError,
  TimeoutError,
  HarnessExecutionError
} from '../../src/harness/adapter.js';
import { formatVotingPrompt } from '../../src/seats/soul.js';

describe('Adversarial Stress Test: Voting Retry Tool Enforcement Across Fault Classes', () => {
  describe('1. Default Voting (Deliberation tools: "read-only", votingTools undefined)', () => {
    it('1a: Retry after InvalidResponseError (malformed JSON) strictly enforces tools: "none" without leaking "read-only"', async () => {
      const capturedVoteCalls = [];
      const mockHarness = new MockAdapter();

      mockHarness.executeSeatVote = async (ctx) => {
        const attempt = capturedVoteCalls.filter((c) => c.seatId === ctx.seat.id).length + 1;
        const prompt = formatVotingPrompt({
          soul: ctx.soul,
          seat: ctx.seat,
          tools: ctx.tools,
          candidate: ctx.candidate,
          admittedProofs: (ctx.state?.proofs || []).filter((p) => p.status === 'admitted')
        });

        capturedVoteCalls.push({
          seatId: ctx.seat.id,
          attempt,
          tools: ctx.tools,
          seatTools: ctx.seat.tools,
          seatVotingTools: ctx.seat.votingTools,
          prompt
        });

        if (ctx.seat.id === 'voter-fault' && attempt === 1) {
          throw new InvalidResponseError('SyntaxError: Unexpected token < in JSON at position 0', {
            seatId: ctx.seat.id,
            harness: 'mock'
          });
        }

        return { vote: 'accept' };
      };

      const engine = new CouncilEngine(
        {
          topic: 'Adversarial 1a: InvalidResponseError voting retry tool guard',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 2,
          judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            {
              id: 'voter-fault',
              harness: 'mock',
              model: 'grok-4.7-xhigh',
              soul: 'Purist',
              tools: 'read-only',
              timeoutMs: 240000
            },
            {
              id: 'voter-stable',
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
      assert.equal(result.ok, true, 'Engine run must complete successfully');

      const faultCalls = capturedVoteCalls.filter((c) => c.seatId === 'voter-fault');
      assert.equal(faultCalls.length, 2, 'Should execute initial attempt + 1 retry');

      // Attempt 1: Initial voting
      assert.equal(faultCalls[0].tools, 'none', 'Attempt 1 tools parameter must be none');
      assert.equal(faultCalls[0].seatVotingTools, 'none', 'Attempt 1 seat.votingTools must be none');
      assert.ok(
        faultCalls[0].prompt.includes('Do not invoke any tools during confirmation voting'),
        'Attempt 1 prompt must include tool-free instruction'
      );
      assert.ok(
        !faultCalls[0].prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'),
        'Attempt 1 prompt must NOT include tool directive'
      );

      // Attempt 2: Retry after InvalidResponseError
      assert.equal(faultCalls[1].tools, 'none', 'Attempt 2 tools parameter must be none');
      assert.equal(faultCalls[1].seatTools, 'none', 'Attempt 2 seat.tools must be none (never leak read-only)');
      assert.equal(faultCalls[1].seatVotingTools, 'none', 'Attempt 2 seat.votingTools must be none');
      assert.ok(
        faultCalls[1].prompt.includes('Do not invoke any tools during confirmation voting'),
        'Attempt 2 prompt must include tool-free instruction'
      );
      assert.ok(
        !faultCalls[1].prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'),
        'Attempt 2 prompt must NOT include tool directive'
      );
      assert.ok(
        !faultCalls[1].prompt.includes('You have read-only inspection tools enabled'),
        'Attempt 2 prompt must NOT claim read-only tools enabled'
      );
    });

    it('1b: Retry after Generic Error (unhandled exception) strictly enforces tools: "none"', async () => {
      const capturedVoteCalls = [];
      const mockHarness = new MockAdapter();

      mockHarness.executeSeatVote = async (ctx) => {
        const attempt = capturedVoteCalls.filter((c) => c.seatId === ctx.seat.id).length + 1;
        const prompt = formatVotingPrompt({
          soul: ctx.soul,
          seat: ctx.seat,
          tools: ctx.tools,
          candidate: ctx.candidate,
          admittedProofs: (ctx.state?.proofs || []).filter((p) => p.status === 'admitted')
        });

        capturedVoteCalls.push({
          seatId: ctx.seat.id,
          attempt,
          tools: ctx.tools,
          seatTools: ctx.seat.tools,
          seatVotingTools: ctx.seat.votingTools,
          prompt
        });

        if (ctx.seat.id === 'voter-generic-err' && attempt === 1) {
          throw new Error('Unhandled execution exception: Worker pipe ECONNRESET');
        }

        return { vote: 'accept' };
      };

      const engine = new CouncilEngine(
        {
          topic: 'Adversarial 1b: Generic Error voting retry tool guard',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 2,
          judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            {
              id: 'voter-generic-err',
              harness: 'mock',
              model: 'grok-4.7-xhigh',
              soul: 'Purist',
              tools: 'read-only',
              timeoutMs: 240000
            },
            {
              id: 'voter-peer',
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
      assert.equal(result.ok, true, 'Engine run must complete successfully');

      const faultCalls = capturedVoteCalls.filter((c) => c.seatId === 'voter-generic-err');
      assert.equal(faultCalls.length, 2, 'Should execute initial attempt + 1 retry');

      // Attempt 2: Retry after Generic Error
      assert.equal(faultCalls[1].tools, 'none', 'Attempt 2 tools parameter must be none');
      assert.equal(faultCalls[1].seatTools, 'none', 'Attempt 2 seat.tools must be none (never leak read-only)');
      assert.equal(faultCalls[1].seatVotingTools, 'none', 'Attempt 2 seat.votingTools must be none');
      assert.ok(
        faultCalls[1].prompt.includes('Do not invoke any tools during confirmation voting'),
        'Attempt 2 prompt must be tool-free'
      );
      assert.ok(
        !faultCalls[1].prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'),
        'Attempt 2 prompt must NOT include tool directive'
      );
    });

    it('1c: Retry after TimeoutError (timeout fault) strictly enforces tools: "none" and bounded timeout', async () => {
      const capturedVoteCalls = [];
      const mockHarness = new MockAdapter();

      mockHarness.executeSeatVote = async (ctx) => {
        const attempt = capturedVoteCalls.filter((c) => c.seatId === ctx.seat.id).length + 1;
        const prompt = formatVotingPrompt({
          soul: ctx.soul,
          seat: ctx.seat,
          tools: ctx.tools,
          candidate: ctx.candidate,
          admittedProofs: (ctx.state?.proofs || []).filter((p) => p.status === 'admitted')
        });

        capturedVoteCalls.push({
          seatId: ctx.seat.id,
          attempt,
          timeoutMs: ctx.timeoutMs,
          tools: ctx.tools,
          seatTools: ctx.seat.tools,
          seatVotingTools: ctx.seat.votingTools,
          prompt
        });

        if (ctx.seat.id === 'voter-timeout' && attempt === 1) {
          throw new TimeoutError('Harness execution timed out after 90000ms', {
            harness: 'mock',
            seatId: ctx.seat.id,
            model: ctx.seat.model,
            timeoutMs: 90000
          });
        }

        return { vote: 'accept' };
      };

      const engine = new CouncilEngine(
        {
          topic: 'Adversarial 1c: TimeoutError voting retry tool guard',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 2,
          votingTimeoutMs: 60000,
          totalSeatBudgetMs: 180000,
          judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            {
              id: 'voter-timeout',
              harness: 'mock',
              model: 'grok-4.7-xhigh',
              soul: 'Purist',
              tools: 'read-only',
              timeoutMs: 240000
            },
            {
              id: 'voter-stable-2',
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

      const timeoutCalls = capturedVoteCalls.filter((c) => c.seatId === 'voter-timeout');
      assert.equal(timeoutCalls.length, 2);

      // Attempt 2: Retry after TimeoutError
      assert.equal(timeoutCalls[1].tools, 'none');
      assert.equal(timeoutCalls[1].seatTools, 'none');
      assert.equal(timeoutCalls[1].seatVotingTools, 'none');
      assert.ok(timeoutCalls[1].timeoutMs <= 60000, 'Retry timeout must be bounded by votingTimeoutMs');
      assert.ok(
        timeoutCalls[1].prompt.includes('Do not invoke any tools during confirmation voting'),
        'Prompt must be tool-free'
      );
      assert.ok(!timeoutCalls[1].prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));
    });

    it('1d: Multi-round retries under maxRetriesPerSeat: 3 maintain tools: "none" across all fault classes', async () => {
      const capturedVoteCalls = [];
      const mockHarness = new MockAdapter();

      mockHarness.executeSeatVote = async (ctx) => {
        const attempt = capturedVoteCalls.filter((c) => c.seatId === ctx.seat.id).length + 1;
        const prompt = formatVotingPrompt({
          soul: ctx.soul,
          seat: ctx.seat,
          tools: ctx.tools,
          candidate: ctx.candidate,
          admittedProofs: (ctx.state?.proofs || []).filter((p) => p.status === 'admitted')
        });

        capturedVoteCalls.push({
          seatId: ctx.seat.id,
          attempt,
          tools: ctx.tools,
          seatTools: ctx.seat.tools,
          seatVotingTools: ctx.seat.votingTools,
          prompt
        });

        if (ctx.seat.id === 'voter-multi-fault') {
          if (attempt === 1) {
            // Fault 1: Malformed JSON
            throw new InvalidResponseError('Unparsable JSON payload', {
              seatId: ctx.seat.id,
              harness: 'mock'
            });
          }
          if (attempt === 2) {
            // Fault 2: Generic exception
            throw new Error('Connection abruptly closed by remote harness host');
          }
          if (attempt === 3) {
            // Fault 3: Timeout error
            throw new TimeoutError('Voting turn deadline exceeded', {
              seatId: ctx.seat.id,
              harness: 'mock',
              timeoutMs: 90000
            });
          }
        }

        return { vote: 'accept' };
      };

      const engine = new CouncilEngine(
        {
          topic: 'Adversarial 1d: Multi-round retries under maxRetriesPerSeat: 3',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 3,
          judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            {
              id: 'voter-multi-fault',
              harness: 'mock',
              model: 'grok-4.7-xhigh',
              soul: 'Purist',
              tools: 'read-only',
              timeoutMs: 240000
            },
            {
              id: 'voter-reliable',
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
      assert.equal(result.ok, true, 'Engine must reach consensus after 3 retries');

      const calls = capturedVoteCalls.filter((c) => c.seatId === 'voter-multi-fault');
      assert.equal(calls.length, 4, 'Should execute 1 initial + 3 retries = 4 attempts total');

      for (let i = 0; i < 4; i++) {
        const call = calls[i];
        assert.equal(call.tools, 'none', `Attempt ${i + 1} tools must be none`);
        assert.equal(call.seatVotingTools, 'none', `Attempt ${i + 1} seatVotingTools must be none`);
        if (i > 0) {
          assert.equal(call.seatTools, 'none', `Attempt ${i + 1} seatTools must be none (no deliberation leak)`);
        }
        assert.ok(
          call.prompt.includes('Do not invoke any tools during confirmation voting'),
          `Attempt ${i + 1} prompt must have tool-free directive`
        );
        assert.ok(
          !call.prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'),
          `Attempt ${i + 1} prompt must NOT contain TOOL USAGE directive`
        );
        assert.ok(
          !call.prompt.includes('You have read-only inspection tools enabled'),
          `Attempt ${i + 1} prompt must NOT claim inspection tools enabled`
        );
      }
    });
  });

  describe('2. Explicit seat.votingTools: "read-only" Configuration', () => {
    it('2a: Non-timeout retry (InvalidResponseError) preserves explicit "read-only" votingTools', async () => {
      const capturedVoteCalls = [];
      const mockHarness = new MockAdapter();

      mockHarness.executeSeatVote = async (ctx) => {
        const attempt = capturedVoteCalls.filter((c) => c.seatId === ctx.seat.id).length + 1;
        const prompt = formatVotingPrompt({
          soul: ctx.soul,
          seat: ctx.seat,
          tools: ctx.tools,
          candidate: ctx.candidate,
          admittedProofs: (ctx.state?.proofs || []).filter((p) => p.status === 'admitted')
        });

        capturedVoteCalls.push({
          seatId: ctx.seat.id,
          attempt,
          tools: ctx.tools,
          seatTools: ctx.seat.tools,
          seatVotingTools: ctx.seat.votingTools,
          prompt
        });

        if (ctx.seat.id === 'voter-explicit-ro' && attempt === 1) {
          throw new InvalidResponseError('Vote JSON syntax error', {
            seatId: ctx.seat.id,
            harness: 'mock'
          });
        }

        return { vote: 'accept' };
      };

      const engine = new CouncilEngine(
        {
          topic: 'Adversarial 2a: Explicit read-only votingTools non-timeout retry',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 1,
          judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            {
              id: 'voter-explicit-ro',
              harness: 'mock',
              model: 'grok-4.7-xhigh',
              soul: 'Purist',
              tools: 'read-only',
              votingTools: 'read-only',
              timeoutMs: 240000
            },
            {
              id: 'voter-partner',
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

      const calls = capturedVoteCalls.filter((c) => c.seatId === 'voter-explicit-ro');
      assert.equal(calls.length, 2);

      // Attempt 1: has read-only
      assert.equal(calls[0].tools, 'read-only');
      assert.equal(calls[0].seatVotingTools, 'read-only');
      assert.ok(calls[0].prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));

      // Attempt 2 (non-timeout retry): PRESERVES read-only
      assert.equal(calls[1].tools, 'read-only');
      assert.equal(calls[1].seatTools, 'read-only');
      assert.equal(calls[1].seatVotingTools, 'read-only');
      assert.ok(calls[1].prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));
      assert.ok(calls[1].prompt.includes('You have read-only inspection tools enabled'));
    });

    it('2b: Non-timeout retry (Generic Error) preserves explicit "read-only" votingTools', async () => {
      const capturedVoteCalls = [];
      const mockHarness = new MockAdapter();

      mockHarness.executeSeatVote = async (ctx) => {
        const attempt = capturedVoteCalls.filter((c) => c.seatId === ctx.seat.id).length + 1;
        capturedVoteCalls.push({
          seatId: ctx.seat.id,
          attempt,
          tools: ctx.tools,
          seatTools: ctx.seat.tools,
          seatVotingTools: ctx.seat.votingTools
        });

        if (ctx.seat.id === 'voter-ro-generic' && attempt === 1) {
          throw new Error('Worker subprocess crash in remote sandbox');
        }

        return { vote: 'accept' };
      };

      const engine = new CouncilEngine(
        {
          topic: 'Adversarial 2b: Explicit read-only votingTools generic error retry',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 1,
          judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            {
              id: 'voter-ro-generic',
              harness: 'mock',
              model: 'grok-4.7-xhigh',
              soul: 'Purist',
              tools: 'read-only',
              votingTools: 'read-only'
            },
            {
              id: 'voter-other',
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

      const calls = capturedVoteCalls.filter((c) => c.seatId === 'voter-ro-generic');
      assert.equal(calls.length, 2);

      // Attempt 2 preserves read-only
      assert.equal(calls[1].tools, 'read-only');
      assert.equal(calls[1].seatTools, 'read-only');
      assert.equal(calls[1].seatVotingTools, 'read-only');
    });

    it('2c: Timeout retry (TimeoutError) strictly FORCES tools: "none" even with explicit votingTools: "read-only"', async () => {
      const capturedVoteCalls = [];
      const mockHarness = new MockAdapter();

      mockHarness.executeSeatVote = async (ctx) => {
        const attempt = capturedVoteCalls.filter((c) => c.seatId === ctx.seat.id).length + 1;
        const prompt = formatVotingPrompt({
          soul: ctx.soul,
          seat: ctx.seat,
          tools: ctx.tools,
          candidate: ctx.candidate,
          admittedProofs: (ctx.state?.proofs || []).filter((p) => p.status === 'admitted')
        });

        capturedVoteCalls.push({
          seatId: ctx.seat.id,
          attempt,
          tools: ctx.tools,
          seatTools: ctx.seat.tools,
          seatVotingTools: ctx.seat.votingTools,
          prompt
        });

        if (ctx.seat.id === 'voter-ro-timeout' && attempt === 1) {
          throw new TimeoutError('Exploratory tool loop timed out after 90000ms', {
            harness: 'mock',
            seatId: ctx.seat.id,
            timeoutMs: 90000
          });
        }

        return { vote: 'accept' };
      };

      const engine = new CouncilEngine(
        {
          topic: 'Adversarial 2c: Explicit read-only votingTools timeout retry tool-loop guard',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 1,
          judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            {
              id: 'voter-ro-timeout',
              harness: 'mock',
              model: 'grok-4.7-xhigh',
              soul: 'Purist',
              tools: 'read-only',
              votingTools: 'read-only',
              timeoutMs: 240000
            },
            {
              id: 'voter-co-seat',
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

      const calls = capturedVoteCalls.filter((c) => c.seatId === 'voter-ro-timeout');
      assert.equal(calls.length, 2);

      // Attempt 1: read-only
      assert.equal(calls[0].tools, 'read-only');
      assert.equal(calls[0].seatVotingTools, 'read-only');
      assert.ok(calls[0].prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));

      // Attempt 2 (timeout retry): FORCED to none
      assert.equal(calls[1].tools, 'none', 'Timeout retry must force tools: "none"');
      assert.equal(calls[1].seatTools, 'none', 'Timeout retry must force seat.tools: "none"');
      assert.equal(calls[1].seatVotingTools, 'none', 'Timeout retry must force seat.votingTools: "none"');
      assert.ok(
        calls[1].prompt.includes('Do not invoke any tools during confirmation voting'),
        'Timeout retry prompt must be tool-free'
      );
      assert.ok(
        !calls[1].prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'),
        'Timeout retry prompt must NOT contain TOOL USAGE directive'
      );
    });

    it('2d: Mixed retry sequence under explicit votingTools: "read-only" (InvalidResponseError then TimeoutError)', async () => {
      const capturedVoteCalls = [];
      const mockHarness = new MockAdapter();

      mockHarness.executeSeatVote = async (ctx) => {
        const attempt = capturedVoteCalls.filter((c) => c.seatId === ctx.seat.id).length + 1;
        const prompt = formatVotingPrompt({
          soul: ctx.soul,
          seat: ctx.seat,
          tools: ctx.tools,
          candidate: ctx.candidate,
          admittedProofs: (ctx.state?.proofs || []).filter((p) => p.status === 'admitted')
        });

        capturedVoteCalls.push({
          seatId: ctx.seat.id,
          attempt,
          tools: ctx.tools,
          seatTools: ctx.seat.tools,
          seatVotingTools: ctx.seat.votingTools,
          prompt
        });

        if (ctx.seat.id === 'voter-mixed-ro') {
          if (attempt === 1) {
            // Fault 1: non-timeout
            throw new InvalidResponseError('Malformed JSON', {
              seatId: ctx.seat.id,
              harness: 'mock'
            });
          }
          if (attempt === 2) {
            // Fault 2: timeout
            throw new TimeoutError('Timeout on attempt 2', {
              seatId: ctx.seat.id,
              harness: 'mock',
              timeoutMs: 90000
            });
          }
        }

        return { vote: 'accept' };
      };

      const engine = new CouncilEngine(
        {
          topic: 'Adversarial 2d: Mixed retry sequence under explicit votingTools: "read-only"',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 2,
          judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            {
              id: 'voter-mixed-ro',
              harness: 'mock',
              model: 'grok-4.7-xhigh',
              soul: 'Purist',
              tools: 'read-only',
              votingTools: 'read-only'
            },
            {
              id: 'voter-friend',
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

      const calls = capturedVoteCalls.filter((c) => c.seatId === 'voter-mixed-ro');
      assert.equal(calls.length, 3, 'Should execute 1 initial + 2 retries = 3 attempts');

      // Attempt 1: read-only
      assert.equal(calls[0].tools, 'read-only');

      // Attempt 2 (non-timeout retry after malformed JSON): PRESERVES read-only
      assert.equal(calls[1].tools, 'read-only');
      assert.equal(calls[1].seatTools, 'read-only');
      assert.equal(calls[1].seatVotingTools, 'read-only');
      assert.ok(calls[1].prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));

      // Attempt 3 (timeout retry after TimeoutError): FORCES none
      assert.equal(calls[2].tools, 'none');
      assert.equal(calls[2].seatTools, 'none');
      assert.equal(calls[2].seatVotingTools, 'none');
      assert.ok(calls[2].prompt.includes('Do not invoke any tools during confirmation voting'));
      assert.ok(!calls[2].prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));
    });

    it('2e: Sticky tool-loop guard: Attempt 1 TimeoutError strips tools to "none"; subsequent non-timeout retry stays "none"', async () => {
      const capturedVoteCalls = [];
      const mockHarness = new MockAdapter();

      mockHarness.executeSeatVote = async (ctx) => {
        const attempt = capturedVoteCalls.filter((c) => c.seatId === ctx.seat.id).length + 1;
        capturedVoteCalls.push({
          seatId: ctx.seat.id,
          attempt,
          tools: ctx.tools,
          seatTools: ctx.seat.tools,
          seatVotingTools: ctx.seat.votingTools
        });

        if (ctx.seat.id === 'voter-sticky-timeout') {
          if (attempt === 1) {
            // Fault 1: TimeoutError
            throw new TimeoutError('Turn timed out', {
              seatId: ctx.seat.id,
              harness: 'mock',
              timeoutMs: 90000
            });
          }
          if (attempt === 2) {
            // Fault 2: Malformed JSON
            throw new InvalidResponseError('Syntax error in vote JSON', {
              seatId: ctx.seat.id,
              harness: 'mock'
            });
          }
        }

        return { vote: 'accept' };
      };

      const engine = new CouncilEngine(
        {
          topic: 'Adversarial 2e: Sticky timeout tool guard test',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 2,
          judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            {
              id: 'voter-sticky-timeout',
              harness: 'mock',
              model: 'grok-4.7-xhigh',
              soul: 'Purist',
              tools: 'read-only',
              votingTools: 'read-only'
            },
            {
              id: 'voter-pal',
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

      const calls = capturedVoteCalls.filter((c) => c.seatId === 'voter-sticky-timeout');
      assert.equal(calls.length, 3);

      // Attempt 1: starts with read-only
      assert.equal(calls[0].tools, 'read-only');

      // Attempt 2: retry after TimeoutError -> tools forced to 'none'
      assert.equal(calls[1].tools, 'none');

      // Attempt 3: retry after InvalidResponseError -> tools remains sticky at 'none'
      assert.equal(calls[2].tools, 'none', 'Sticky tool-loop guard keeps tools stripped to "none" on subsequent non-timeout retry');
      assert.equal(calls[2].seatTools, 'none');
      assert.equal(calls[2].seatVotingTools, 'none');
    });

    it('2f: Seat-level votingTools: "none" overrides engine-level votingTools: "read-only" on retry', async () => {
      const capturedVoteCalls = [];
      const mockHarness = new MockAdapter();

      mockHarness.executeSeatVote = async (ctx) => {
        const attempt = capturedVoteCalls.filter((c) => c.seatId === ctx.seat.id).length + 1;
        capturedVoteCalls.push({
          seatId: ctx.seat.id,
          attempt,
          tools: ctx.tools,
          seatTools: ctx.seat.tools,
          seatVotingTools: ctx.seat.votingTools
        });

        if (ctx.seat.id === 'voter-override' && attempt === 1) {
          throw new InvalidResponseError('Syntax error in vote JSON', {
            seatId: ctx.seat.id,
            harness: 'mock'
          });
        }

        return { vote: 'accept' };
      };

      const engine = new CouncilEngine(
        {
          topic: 'Adversarial 2f: Seat votingTools override engineConfig',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 1,
          votingTools: 'read-only', // Engine default
          judge: { id: 'judge', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            {
              id: 'voter-override',
              harness: 'mock',
              model: 'grok-4.7-xhigh',
              soul: 'Purist',
              tools: 'read-only',
              votingTools: 'none' // Seat override
            },
            {
              id: 'voter-default',
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

      const calls = capturedVoteCalls.filter((c) => c.seatId === 'voter-override');
      assert.equal(calls.length, 2);

      // Attempt 1: seat override wins -> tools is 'none'
      assert.equal(calls[0].tools, 'none');
      assert.equal(calls[0].seatVotingTools, 'none');

      // Attempt 2 (retry after InvalidResponseError): seat override preserved -> tools is 'none'
      assert.equal(calls[1].tools, 'none');
      assert.equal(calls[1].seatTools, 'none');
      assert.equal(calls[1].seatVotingTools, 'none');
    });
  });

  describe('3. Harness Dispatch Integration (executeSeat fallback & prompt generation)', () => {
    it('3a: Harness defining only executeSeat (no executeSeatVote) properly receives tools: "none" on retry', async () => {
      const capturedSeatCalls = [];
      // Create adapter without executeSeatVote
      const plainHarness = {
        name: 'plain-harness',
        executeSeat: async (ctx) => {
          if (ctx.phase === 'VOTING') {
            const attempt = capturedSeatCalls.filter((c) => c.seatId === ctx.seat.id).length + 1;
            capturedSeatCalls.push({
              seatId: ctx.seat.id,
              attempt,
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

            if (ctx.seat.id === 'voter-plain' && attempt === 1) {
              throw new InvalidResponseError('JSON parse failure in plain harness', {
                seatId: ctx.seat.id,
                harness: 'plain-harness'
              });
            }

            return { vote: 'accept' };
          }

          // Deliberation turn
          return {
            id: `P-${ctx.seat.id}-1`,
            kind: 'check',
            scope: 'general',
            statement: 'Proof from plain harness',
            source: 'Deterministic test'
          };
        },
        executeJudge: async () => ({
          summary: 'Consensus synthesis',
          proofDecisions: { 'P-voter-plain-1': { status: 'admitted' }, 'P-voter-co-1': { status: 'admitted' } },
          clauses: [{ context: 'General', conclusion: 'Solid consensus', citedProofIds: ['P-voter-plain-1'] }]
        })
      };

      const engine = new CouncilEngine(
        {
          topic: 'Adversarial 3a: Plain executeSeat fallback harness',
          maxRounds: 1,
          minQuorum: 2,
          maxRetriesPerSeat: 1,
          judge: { id: 'judge', harness: 'plain', model: 'gpt-6-astra (max)', soul: 'Judge' },
          seats: [
            {
              id: 'voter-plain',
              harness: 'plain',
              model: 'grok-4.7-xhigh',
              soul: 'Purist',
              tools: 'read-only'
            },
            {
              id: 'voter-co',
              harness: 'plain',
              model: 'gpt-6-astra (max)',
              soul: 'Partner',
              tools: 'read-only'
            }
          ]
        },
        { harnessResolver: () => plainHarness }
      );

      engine.initRoster();
      const result = await engine.run();
      assert.equal(result.ok, true);

      const calls = capturedSeatCalls.filter((c) => c.seatId === 'voter-plain');
      assert.equal(calls.length, 2);

      // Attempt 2 (retry through executeSeat) must receive tools: "none"
      assert.equal(calls[1].tools, 'none');
      assert.equal(calls[1].seatTools, 'none');
      assert.equal(calls[1].seatVotingTools, 'none');
      assert.ok(calls[1].prompt.includes('Do not invoke any tools during confirmation voting'));
      assert.ok(!calls[1].prompt.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));
    });
  });
});
