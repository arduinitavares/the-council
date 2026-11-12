/**
 * @fileoverview Empirical Challenge Test Suite for Milestone 3 (#24, #25)
 * Author: challenger_m3_2 (teamwork_challenger)
 *
 * Focus Areas:
 * 1. Tool Policy Hostility: strict rejection of invalid / write policies across config, judge, seats, and engine.
 * 2. Chatter-Resilient Parsing: pathological tool chatter, nested/escaped braces, multi-block markdown, unfenced JSON.
 * 3. Dynamic Timeout Scaling: effort-based resolution, constructor override precedence, explicit override priority.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validateConfig, resolveConfig } from '../../src/engine/config.js';
import { CouncilEngine } from '../../src/engine/council-engine.js';
import { VALID_TOOL_POLICIES } from '../../src/types.js';
import {
  formatDeliberationPrompt,
  formatVotingPrompt,
  formatJudgePrompt
} from '../../src/seats/soul.js';
import {
  HarnessAdapter,
  EFFORT_TIMEOUT_MAP,
  DEFAULT_TIMEOUT_MS,
  InvalidResponseError,
  TimeoutError
} from '../../src/harness/adapter.js';

describe('Empirical Challenge: Milestone 3 Hostility, Resilient Parsing & Timeouts (challenger_m3_2)', () => {

  // =========================================================================
  // SECTION 1: Tool Policy Hostility
  // =========================================================================
  describe('1. Tool Policy Hostility & Strict Boundary Enforcement', () => {
    const baseValidConfig = () => ({
      topic: 'Tool Policy Boundary Verification',
      maxRounds: 3,
      minQuorum: 2,
      maxClarificationBatches: 2,
      maxRetriesPerSeat: 2,
      judge: { id: 'judge-1', harness: 'mock', model: 'mock-judge', soul: 'Judge' },
      seats: [
        { id: 's1', harness: 'mock', model: 'gpt-6-astra (max)', soul: 'Soul 1' },
        { id: 's2', harness: 'mock', model: 'gpt-5-sol (high)', soul: 'Soul 2' }
      ]
    });

    const invalidPolicies = ['write', 'read-write', 'bash', true, 123, null, ['read-only'], {}];

    it('VALID_TOOL_POLICIES strictly exposes only ["none", "read-only"] as frozen array', () => {
      assert.deepEqual(Array.from(VALID_TOOL_POLICIES), ['none', 'read-only']);
      assert.ok(Object.isFrozen(VALID_TOOL_POLICIES));
    });

    it('validateConfig rejects invalid tool policies at root config.tools', () => {
      for (const invalid of invalidPolicies) {
        const cfg = { ...baseValidConfig(), tools: invalid };
        const result = validateConfig(cfg);
        assert.equal(result.valid, false, `Expected tools: ${JSON.stringify(invalid)} to be invalid`);
        const matchingError = result.errors.find((e) =>
          e.includes('"tools" policy must be \'none\' or \'read-only\'') &&
          e.includes('Write tools are strictly forbidden.')
        );
        assert.ok(
          matchingError,
          `Expected descriptive write-forbidding error for root tools=${JSON.stringify(invalid)}, got: ${JSON.stringify(result.errors)}`
        );
      }
    });

    it('validateConfig rejects invalid tool policies on config.judge.tools', () => {
      for (const invalid of invalidPolicies) {
        const cfg = baseValidConfig();
        cfg.judge.tools = invalid;
        const result = validateConfig(cfg);
        assert.equal(result.valid, false, `Expected judge.tools: ${JSON.stringify(invalid)} to be invalid`);
        const matchingError = result.errors.find((e) =>
          e.includes('Judge "tools" policy must be \'none\' or \'read-only\'') &&
          e.includes('Write tools are strictly forbidden.')
        );
        assert.ok(
          matchingError,
          `Expected descriptive write-forbidding error for judge.tools=${JSON.stringify(invalid)}, got: ${JSON.stringify(result.errors)}`
        );
      }
    });

    it('validateConfig rejects invalid tool policies on config.seats[i].tools', () => {
      for (const invalid of invalidPolicies) {
        const cfg = baseValidConfig();
        cfg.seats[0].tools = invalid;
        const result = validateConfig(cfg);
        assert.equal(result.valid, false, `Expected seat.tools: ${JSON.stringify(invalid)} to be invalid`);
        const matchingError = result.errors.find((e) =>
          e.includes('Seat "s1" "tools" policy must be \'none\' or \'read-only\'') &&
          e.includes('Write tools are strictly forbidden.')
        );
        assert.ok(
          matchingError,
          `Expected descriptive write-forbidding error for seat.tools=${JSON.stringify(invalid)}, got: ${JSON.stringify(result.errors)}`
        );
      }
    });

    it('resolveConfig throws descriptive Error when root, judge, or seat has invalid tools', () => {
      for (const invalid of ['write', 'read-write', 'bash', true, 123]) {
        assert.throws(
          () => resolveConfig({ ...baseValidConfig(), tools: invalid }),
          /Write tools are strictly forbidden/
        );
        assert.throws(
          () => resolveConfig({
            ...baseValidConfig(),
            judge: { ...baseValidConfig().judge, tools: invalid }
          }),
          /Write tools are strictly forbidden/
        );
        assert.throws(
          () => resolveConfig({
            ...baseValidConfig(),
            seats: [
              { id: 's1', harness: 'mock', model: 'mock', soul: 's1', tools: invalid },
              { id: 's2', harness: 'mock', model: 'mock', soul: 's2' }
            ]
          }),
          /Write tools are strictly forbidden/
        );
      }
    });

    it('CouncilEngine constructor throws immediately when initialized with invalid tools', () => {
      assert.throws(
        () => new CouncilEngine({ ...baseValidConfig(), tools: 'write' }),
        /Write tools are strictly forbidden/
      );
      assert.throws(
        () => new CouncilEngine({
          ...baseValidConfig(),
          judge: { ...baseValidConfig().judge, tools: 'read-write' }
        }),
        /Write tools are strictly forbidden/
      );
      assert.throws(
        () => new CouncilEngine({
          ...baseValidConfig(),
          seats: [
            { id: 's1', harness: 'mock', model: 'mock', soul: 's1', tools: 'bash' },
            { id: 's2', harness: 'mock', model: 'mock', soul: 's2' }
          ]
        }),
        /Write tools are strictly forbidden/
      );
    });

    it('accepts valid tool policies "none" and "read-only" across all positions', () => {
      for (const validPolicy of ['none', 'read-only']) {
        const cfg = {
          ...baseValidConfig(),
          tools: validPolicy,
          judge: { ...baseValidConfig().judge, tools: validPolicy },
          seats: [
            { id: 's1', harness: 'mock', model: 'm1', soul: 'soul1', tools: validPolicy },
            { id: 's2', harness: 'mock', model: 'm2', soul: 'soul2', tools: validPolicy }
          ]
        };
        const validation = validateConfig(cfg);
        assert.equal(validation.valid, true, `Validation failed: ${validation.errors.join('; ')}`);
        const resolved = resolveConfig(cfg);
        assert.equal(resolved.tools, validPolicy);
        assert.equal(resolved.judge.tools, validPolicy);
        assert.equal(resolved.seats[0].tools, validPolicy);
      }
    });

    it('rejects whitespace, empty strings, uppercase, and alternative forms of tools', () => {
      for (const bad of ['', '   ', 'READ-ONLY', 'None', 'read-write', 'write-only', 0, false]) {
        const resRoot = validateConfig({ ...baseValidConfig(), tools: bad });
        assert.equal(resRoot.valid, false, `Expected tools: ${JSON.stringify(bad)} to be invalid at root`);

        const resJudge = validateConfig({
          ...baseValidConfig(),
          judge: { ...baseValidConfig().judge, tools: bad }
        });
        assert.equal(resJudge.valid, false, `Expected judge.tools: ${JSON.stringify(bad)} to be invalid`);

        const resSeat = validateConfig({
          ...baseValidConfig(),
          seats: [
            { id: 's1', harness: 'mock', model: 'm1', soul: 'soul1', tools: bad },
            { id: 's2', harness: 'mock', model: 'm2', soul: 'soul2' }
          ]
        });
        assert.equal(resSeat.valid, false, `Expected seat.tools: ${JSON.stringify(bad)} to be invalid`);
      }
    });

    it('validateConfig validates timeoutMs and maxConcurrentSeats strictly', () => {
      for (const badTimeout of [0, -100, -1, '60000', null, NaN, Infinity]) {
        const res = validateConfig({ ...baseValidConfig(), timeoutMs: badTimeout });
        assert.equal(res.valid, false);
        assert.ok(res.errors.some((e) => e.includes('timeoutMs must be a positive number.')));

        const resJudge = validateConfig({
          ...baseValidConfig(),
          judge: { ...baseValidConfig().judge, timeoutMs: badTimeout }
        });
        assert.equal(resJudge.valid, false);
        assert.ok(resJudge.errors.some((e) => e.includes('Judge requires "timeoutMs" to be a positive number.')));

        const resSeat = validateConfig({
          ...baseValidConfig(),
          seats: [
            { id: 's1', harness: 'mock', model: 'm1', soul: 'soul1', timeoutMs: badTimeout },
            { id: 's2', harness: 'mock', model: 'm2', soul: 'soul2' }
          ]
        });
        assert.equal(resSeat.valid, false);
        assert.ok(resSeat.errors.some((e) => e.includes('requires "timeoutMs" to be a positive number.')));
      }

      for (const badConcurrency of [0, -1, 1.5, '4', null, NaN]) {
        const res = validateConfig({ ...baseValidConfig(), maxConcurrentSeats: badConcurrency });
        assert.equal(res.valid, false);
        assert.ok(res.errors.some((e) => e.includes('maxConcurrentSeats must be an integer >= 1.')));
      }
    });

    it('prompt formatters inject verification directive for "read-only" and omit for "none" or invalid', () => {
      // Deliberation prompt
      const pRead = formatDeliberationPrompt({
        seat: { id: 's1', tools: 'read-only' },
        soul: 'Tester',
        topic: 'Test Topic',
        round: 1,
        maxRounds: 3
      });
      assert.ok(pRead.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));
      assert.ok(pRead.includes('You have read-only inspection tools enabled.'));

      const pNone = formatDeliberationPrompt({
        seat: { id: 's1', tools: 'none' },
        soul: 'Tester',
        topic: 'Test Topic',
        round: 1,
        maxRounds: 3
      });
      assert.ok(!pNone.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));

      const pWriteIgnored = formatDeliberationPrompt({
        seat: { id: 's1', tools: 'write' },
        soul: 'Tester',
        topic: 'Test Topic',
        round: 1,
        maxRounds: 3
      });
      assert.ok(!pWriteIgnored.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));

      // Voting prompt
      const vRead = formatVotingPrompt({
        seat: { id: 's1', tools: 'read-only' },
        soul: 'Tester'
      });
      assert.ok(vRead.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));
      assert.ok(vRead.includes('Verify disputed candidate clauses'));

      const vNone = formatVotingPrompt({
        seat: { id: 's1', tools: 'none' },
        soul: 'Tester'
      });
      assert.ok(!vNone.includes('TOOL USAGE & VERIFICATION DIRECTIVE:'));

      // Judge prompt
      const jRead = formatJudgePrompt({
        judge: { id: 'j1', tools: 'read-only' },
        round: 1
      });
      assert.ok(jRead.includes('4. Spot-check proof sources: You have read-only inspection tools enabled.'));

      const jNone = formatJudgePrompt({
        judge: { id: 'j1', tools: 'none' },
        round: 1
      });
      assert.ok(!jNone.includes('Spot-check proof sources: You have read-only inspection tools enabled.'));
    });
  });

  // =========================================================================
  // SECTION 2: Adversarial Tool Chatter & Resilient Parsing
  // =========================================================================
  describe('2. Chatter-Resilient Parsing Under Pathological LLM Outputs', () => {
    class TestableHarnessAdapter extends HarnessAdapter {
      constructor(cfg) {
        super({ name: 'testable', ...cfg });
      }
      async executeSeat() { return {}; }
      async executeJudge() { return {}; }
    }

    const adapter = new TestableHarnessAdapter();

    it('parses second-to-last block when last markdown block is non-JSON text', () => {
      const rawOutput = `
Here is my structured answer:
\`\`\`json
{
  "scope": "Container cgroups",
  "kind": "check",
  "source": "/sys/fs/cgroup",
  "statement": "Unified cgroup v2 hierarchy is mounted and active."
}
\`\`\`

Here is how you verify it manually:
\`\`\`bash
stat -fc %T /sys/fs/cgroup
\`\`\`
`;
      const parsed = adapter.parseStructuredOutput(rawOutput, 'proof');
      assert.equal(parsed.kind, 'check');
      assert.equal(parsed.source, '/sys/fs/cgroup');
      assert.ok(parsed.statement.includes('cgroup v2'));
    });

    it('parses raw unfenced JSON at bottom when markdown block contains irrelevant tool logs', () => {
      const rawOutput = `
Tool log output:
\`\`\`json
{ "tool_executed": "grep", "lines_matched": 4 }
\`\`\`

Here is my formal proof:
{
  "scope": "POSIX standards",
  "kind": "citation",
  "source": "Single UNIX Specification v4",
  "statement": "Standard streams stdin, stdout, and stderr are pre-opened on process launch."
}
`;
      const parsed = adapter.parseStructuredOutput(rawOutput, 'proof');
      assert.equal(parsed.kind, 'citation');
      assert.equal(parsed.source, 'Single UNIX Specification v4');
      assert.ok(parsed.statement.includes('Standard streams'));
    });

    it('recovers from stray unmatched braces in conversational text outside code block', () => {
      const rawOutput = `
Note: An open brace like { or stray closing brace } should not confuse the scanner.
Neither should unbalanced braces in error logs: "error: unexpected } at column 12".

\`\`\`json
{
  "scope": "Scanner Hardening",
  "kind": "derivation",
  "source": "Balanced brace scanner test harness",
  "statement": "Scanner maintains zero-depth floor and correctly tracks boundary JSON."
}
\`\`\`
`;
      const parsed = adapter.parseStructuredOutput(rawOutput, 'proof');
      assert.equal(parsed.kind, 'derivation');
      assert.equal(parsed.source, 'Balanced brace scanner test harness');
    });

    it('normalizes string backingProof into proofId and rejects object-only backingProof without string proofId', () => {
      const validRawOutput = `
\`\`\`json
{
  "vote": "object",
  "backingProof": "P1",
  "reason": "SLA violation detected during load testing."
}
\`\`\`
`;
      const parsed = adapter.parseStructuredOutput(validRawOutput, 'vote');
      assert.equal(parsed.vote, 'object');
      assert.equal(parsed.proofId, 'P1');
      assert.equal(parsed.reason, 'SLA violation detected during load testing.');

      const objectOnlyBacking = `
\`\`\`json
{
  "vote": "object",
  "backingProof": {
    "scope": "Latency SLA",
    "kind": "benchmark",
    "source": "load-test-report.json",
    "statement": "p99 latency exceeded 500ms"
  },
  "reason": "SLA violation detected during load testing."
}
\`\`\`
`;
      assert.throws(() => adapter.parseStructuredOutput(objectOnlyBacking, 'vote'));
    });

    it('parses proof when preceded by tool chatter containing curly braces and logs', () => {
      const rawOutput = `
[TOOL-START] Running read_file on /etc/os-release
{ "status": "executing", "pid": 4821, "tool": "read_file", "params": { "path": "/etc/os-release" } }
[TOOL-OUTPUT] PRETTY_NAME="Ubuntu 24.04 LTS"
[TOOL-END] execution time 14ms

Based on my tool inspection of the environment, here is my formal proof:
\`\`\`json
{
  "scope": "Operating System & Distribution",
  "kind": "check",
  "source": "/etc/os-release",
  "statement": "The host kernel runs Ubuntu 24.04 LTS with standard POSIX libraries."
}
\`\`\`
Final commentary: this verifies the platform requirement.
`;

      const parsed = adapter.parseStructuredOutput(rawOutput, 'proof');
      assert.equal(parsed.kind, 'check');
      assert.equal(parsed.source, '/etc/os-release');
      assert.ok(parsed.statement.includes('Ubuntu 24.04 LTS'));
    });

    it('parses judge synthesis when multiple markdown blocks exist and the final block is the actual candidate', () => {
      const rawOutput = `
I first audited the proofs. Here was my scratchpad for auditing:
\`\`\`json
{
  "draft_notes": { "P1": "looks solid", "P2": "needs verification" }
}
\`\`\`

Next, I tested an intermediate clause breakdown:
\`\`\`json
{
  "intermediate_clauses": [{ "clause": "draft only", "status": "pending" }]
}
\`\`\`

Here is my official final Judge Audit and Synthesis:
\`\`\`json
{
  "summary": "Unified Consensus: High-Performance Architecture",
  "proofDecisions": {
    "P1": { "status": "admitted", "note": "Verified against POSIX IEEE 1003.1" },
    "P2": { "status": "admitted", "note": "Verified against Linux 6.8 benchmark" }
  },
  "clauses": [
    {
      "context": "Core Kernel Architecture",
      "conclusion": "Deploy cgroups v2 with systemd unit isolation for memory bounds.",
      "citedProofIds": ["P1", "P2"]
    }
  ]
}
\`\`\`
`;

      const parsed = adapter.parseStructuredOutput(rawOutput, 'judge_synthesis');
      assert.equal(parsed.summary, 'Unified Consensus: High-Performance Architecture');
      assert.equal(parsed.clauses.length, 1);
      assert.deepEqual(parsed.clauses[0].citedProofIds, ['P1', 'P2']);
    });

    it('parses unfenced raw JSON surrounded by preceding and trailing tool log lines', () => {
      const rawOutput = `
[DEBUG] Initializing sandbox read-only runner
[DEBUG] Reading citation index: { "index_size": 4920, "entries": [1, 2, 3] }
[INFO] Formulating proof output payload:

{
  "scope": "POSIX Compliance",
  "kind": "citation",
  "source": "IEEE Std 1003.1-2017 Section 3.14",
  "statement": "All compliant implementations guarantee atomic directory creation via mkdir."
}

[DEBUG] Sandbox teardown complete. Exit code: 0
[DEBUG] Telemetry flushed: { "bytes_written": 182 }
`;

      const parsed = adapter.parseStructuredOutput(rawOutput, 'proof');
      assert.equal(parsed.kind, 'citation');
      assert.equal(parsed.source, 'IEEE Std 1003.1-2017 Section 3.14');
      assert.ok(parsed.statement.includes('atomic directory creation'));
    });

    it('correctly handles escaped quotes and nested braces inside JSON string values', () => {
      const rawOutput = `
Tool inspection completed with result:
{
  "scope": "Compiler Diagnostic Inspection",
  "kind": "derivation",
  "source": "rustc --version --verbose",
  "statement": "The compiler emitted JSON diagnostic: {\\\"message\\\": \\\"error: expected ';'\\\", \\\"level\\\": \\\"error\\\", \\\"spans\\\": [{\\\"file\\\": \\\"main.rs\\\", \\\"line\\\": 42}]} which demonstrates strict type enforcement."
}
`;

      const parsed = adapter.parseStructuredOutput(rawOutput, 'proof');
      assert.equal(parsed.kind, 'derivation');
      assert.ok(parsed.statement.includes('expected \';\''));
      assert.ok(parsed.statement.includes('main.rs'));
    });

    it('parses vote objecting with proof citation amidst adversarial chatter', () => {
      const rawOutput = `
Evaluating Candidate Clauses...
Log: { "discrepancy_detected": true, "clause_index": 0 }
I found an irreconcilable defect with the memory bounds assertion.

\`\`\`json
{
  "vote": "object",
  "proofId": "P2",
  "reason": "Clause 1 recommends unlimited swap which directly contradicts benchmark P2 showing 80% latency regression under memory pressure."
}
\`\`\`
Final thoughts: Candidate must be revised.
`;

      const parsed = adapter.parseStructuredOutput(rawOutput, 'vote');
      assert.equal(parsed.vote, 'object');
      assert.equal(parsed.proofId, 'P2');
      assert.ok(parsed.reason.includes('latency regression'));
    });

    it('parses vote accepting amidst tool chatter', () => {
      const rawOutput = `
Inspecting admitted proofs:
[log] { "checked": ["P1", "P2"] }
Candidate completely satisfies my domain constraints.

\`\`\`json
{
  "vote": "accept"
}
\`\`\`
`;

      const parsed = adapter.parseStructuredOutput(rawOutput, 'vote');
      assert.equal(parsed.vote, 'accept');
    });

    it('throws InvalidResponseError when raw response is empty, whitespace, or non-string', () => {
      assert.throws(
        () => adapter.parseStructuredOutput('', 'proof'),
        (err) => err instanceof InvalidResponseError && err.message.includes('empty or not a string')
      );
      assert.throws(
        () => adapter.parseStructuredOutput('   \n  \t ', 'proof'),
        (err) => err instanceof InvalidResponseError && err.message.includes('empty or not a string')
      );
      assert.throws(
        () => adapter.parseStructuredOutput(null, 'proof'),
        (err) => err instanceof InvalidResponseError && err.message.includes('empty or not a string')
      );
    });

    it('throws InvalidResponseError with schema validation errors when JSON parsed but missing required fields', () => {
      const badProof = `
\`\`\`json
{
  "scope": "General",
  "kind": "opinion",
  "source": ""
}
\`\`\`
`;
      assert.throws(
        () => adapter.parseStructuredOutput(badProof, 'proof'),
        (err) => {
          return err instanceof InvalidResponseError &&
            err.message.includes('violates proof schema') &&
            Array.isArray(err.validationErrors) &&
            err.validationErrors.length > 0;
        }
      );
    });

    it('throws InvalidResponseError when text contains malformed unparseable code block', () => {
      const malformedJson = `
\`\`\`json
{ "scope": "Unclosed JSON
\`\`\`
`;
      assert.throws(
        () => adapter.parseStructuredOutput(malformedJson, 'proof'),
        (err) => err instanceof InvalidResponseError && err.message.includes('Failed to parse model JSON')
      );
    });
  });

  // =========================================================================
  // SECTION 3: Dynamic Timeout Scaling & Override Precedence
  // =========================================================================
  describe('3. Dynamic Timeout Scaling & Override Precedence', () => {
    class TestableHarnessAdapter extends HarnessAdapter {
      constructor(cfg) {
        super({ name: 'testable', ...cfg });
      }
      async executeSeat() { return {}; }
      async executeJudge() { return {}; }
    }

    const defaultAdapter = new TestableHarnessAdapter();

    it('verifies EFFORT_TIMEOUT_MAP mapping contracts', () => {
      assert.equal(EFFORT_TIMEOUT_MAP.max, 240000);
      assert.equal(EFFORT_TIMEOUT_MAP.xhigh, 240000);
      assert.equal(EFFORT_TIMEOUT_MAP.high, 120000);
      assert.equal(EFFORT_TIMEOUT_MAP.medium, 60000);
      assert.equal(EFFORT_TIMEOUT_MAP.low, 60000);
      assert.equal(DEFAULT_TIMEOUT_MS, 60000);
      assert.ok(Object.isFrozen(EFFORT_TIMEOUT_MAP));
    });

    it('dynamically scales timeouts based on parenthesized model effort', () => {
      // max / xhigh -> 240,000ms
      assert.equal(defaultAdapter.resolveTimeoutMs('gpt-6-astra (max)'), 240000);
      assert.equal(defaultAdapter.resolveTimeoutMs('gpt-6-astra (xhigh)'), 240000);
      // high -> 120,000ms
      assert.equal(defaultAdapter.resolveTimeoutMs('gpt-5-sol (high)'), 120000);
      // medium / low -> 60,000ms
      assert.equal(defaultAdapter.resolveTimeoutMs('gpt-5-sol (medium)'), 60000);
      assert.equal(defaultAdapter.resolveTimeoutMs('gpt-5-sol (low)'), 60000);
    });

    it('dynamically scales timeouts based on hyphenated model effort suffix', () => {
      // max / xhigh -> 240,000ms
      assert.equal(defaultAdapter.resolveTimeoutMs('gemini-4-argon-max'), 240000);
      assert.equal(defaultAdapter.resolveTimeoutMs('gemini-4-argon-xhigh'), 240000);
      // high -> 120,000ms
      assert.equal(defaultAdapter.resolveTimeoutMs('claude-opus-5-5-high'), 120000);
      // medium / low -> 60,000ms
      assert.equal(defaultAdapter.resolveTimeoutMs('claude-sonnet-4-medium'), 60000);
      assert.equal(defaultAdapter.resolveTimeoutMs('claude-haiku-3-low'), 60000);
    });

    it('handles uppercase and irregular whitespace in model strings', () => {
      assert.equal(defaultAdapter.resolveTimeoutMs('  GPT-6-ASTRA (MAX)  '), 240000);
      assert.equal(defaultAdapter.resolveTimeoutMs('CLAUDE-OPUS-5-5-HIGH'), 120000);
      assert.equal(defaultAdapter.resolveTimeoutMs('gpt-5-sol   ( XHIGH ) '), 240000);
    });

    it('falls back to default 60000ms when effort is unrecognized or absent', () => {
      assert.equal(defaultAdapter.resolveTimeoutMs('gpt-6-astra'), 60000);
      assert.equal(defaultAdapter.resolveTimeoutMs('gpt-6-astra (unknown-effort)'), 60000);
      assert.equal(defaultAdapter.resolveTimeoutMs(''), 60000);
      assert.equal(defaultAdapter.resolveTimeoutMs(null), 60000);
      assert.equal(defaultAdapter.resolveTimeoutMs(undefined), 60000);
    });

    it('precedence: constructor custom override (defaultTimeoutMs !== 60000) overrides effort scaling', () => {
      const customAdapter = new TestableHarnessAdapter({ timeoutMs: 180000 });
      assert.equal(customAdapter.defaultTimeoutMs, 180000);

      // Model effort would normally be 240000, but constructor custom default is 180000
      assert.equal(customAdapter.resolveTimeoutMs('gpt-6-astra (max)'), 180000);
      // Model effort would normally be 60000, but constructor custom default is 180000
      assert.equal(customAdapter.resolveTimeoutMs('gpt-5-sol (low)'), 180000);
      // Plain model
      assert.equal(customAdapter.resolveTimeoutMs('plain-model'), 180000);
    });

    it('precedence: explicit participant timeoutMs takes highest precedence over both constructor and effort', () => {
      const customAdapter = new TestableHarnessAdapter({ timeoutMs: 180000 });

      // Explicit override on custom adapter
      assert.equal(customAdapter.resolveTimeoutMs('gpt-6-astra (max)', 45000), 45000);
      assert.equal(customAdapter.resolveTimeoutMs('gpt-5-sol (low)', 300000), 300000);

      // Explicit override on default adapter
      assert.equal(defaultAdapter.resolveTimeoutMs('gpt-6-astra (max)', 99999), 99999);
      assert.equal(defaultAdapter.resolveTimeoutMs('claude-opus-5-5-high', 15000), 15000);
    });

    it('ignores invalid explicitTimeoutMs and falls through to next priority', () => {
      // Non-positive, NaN, Infinity, non-numeric should NOT be used as explicit override
      assert.equal(defaultAdapter.resolveTimeoutMs('gpt-6-astra (max)', 0), 240000);
      assert.equal(defaultAdapter.resolveTimeoutMs('gpt-6-astra (max)', -500), 240000);
      assert.equal(defaultAdapter.resolveTimeoutMs('gpt-6-astra (max)', Number.NaN), 240000);
      assert.equal(defaultAdapter.resolveTimeoutMs('gpt-6-astra (max)', Number.POSITIVE_INFINITY), 240000);
      assert.equal(defaultAdapter.resolveTimeoutMs('gpt-6-astra (max)', '120000'), 240000);
      assert.equal(defaultAdapter.resolveTimeoutMs('gpt-6-astra (max)', null), 240000);

      const customAdapter = new TestableHarnessAdapter({ timeoutMs: 180000 });
      assert.equal(customAdapter.resolveTimeoutMs('gpt-6-astra (max)', 0), 180000);
      assert.equal(customAdapter.resolveTimeoutMs('gpt-6-astra (max)', -1), 180000);
      assert.equal(customAdapter.resolveTimeoutMs('gpt-6-astra (max)', null), 180000);
    });

    it('executeWithTimeout enforces resolved dynamic timeout and aborts signal on timeout', async () => {
      const shortAdapter = new TestableHarnessAdapter({ timeoutMs: 50 });
      let signalAborted = false;

      await assert.rejects(
        async () => {
          await shortAdapter.executeWithTimeout(
            async (signal) => {
              signal.addEventListener('abort', () => {
                signalAborted = true;
              });
              await new Promise((r) => setTimeout(r, 150));
              return 'should not complete';
            },
            undefined,
            { seatId: 'test-seat', model: 'plain-model' }
          );
        },
        (err) => {
          return err instanceof TimeoutError &&
            err.timeoutMs === 50 &&
            err.message.includes('timed out after 50ms');
        }
      );

      assert.equal(signalAborted, true, 'Expected AbortSignal to be aborted upon timeout');
    });

    it('executeWithTimeout succeeds when operation completes before dynamic timeout', async () => {
      const fastResult = await defaultAdapter.executeWithTimeout(
        async () => {
          await new Promise((r) => setTimeout(r, 10));
          return { success: true };
        },
        500,
        { seatId: 'fast-seat', model: 'gpt-6-astra (max)' }
      );

      assert.deepEqual(fastResult, { success: true });
    });
  });
});
