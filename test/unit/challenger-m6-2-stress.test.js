/**
 * @fileoverview Adversarial Stress Test Suite for Milestone M6:
 * CLI Ergonomics, Fuzzing Input Validation, Proof Audit Tally Boundaries,
 * and Proof List Rendering in src/cli/index.js.
 *
 * Authored by: challenger_m6_2 (M6 Adversarial Challenger 2)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runCli, HELP_TEXT } from '../../src/cli/index.js';
import { CouncilEngine } from '../../src/engine/council-engine.js';
import { HarnessRegistry } from '../../src/harness/index.js';

describe('Challenger M6-2 Adversarial Stress Suite: CLI Ergonomics & Proof Audit Rendering', () => {
  function createMockIO(options = {}) {
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let exitCode = null;

    return {
      io: {
        stdout: {
          write: (text) => { stdoutBuffer += text; },
          isTTY: options.isTTY ?? false
        },
        stderr: {
          write: (text) => { stderrBuffer += text; }
        },
        exit: (code) => {
          exitCode = code;
          return code;
        },
        ...options.extraIo
      },
      getStdout: () => stdoutBuffer,
      getStderr: () => stderrBuffer,
      getExitCode: () => exitCode
    };
  }

  // ==========================================================================
  // SECTION 1: CLI ARGUMENT PARSING FUZZING (--timeout and --seat-budget)
  // ==========================================================================
  describe('1. CLI Flag Fuzzing: Negative Numbers, Zero, Floats, and Strings', () => {
    describe('1.1 Negative Numbers', () => {
      const negativeValues = ['-500', '-1', '-999999', '-0.01'];

      it('rejects negative values for --timeout via space and equals syntax with exit code 1', async () => {
        for (const val of negativeValues) {
          // Space syntax: ['--timeout', val]
          const spaceIO = createMockIO();
          const spaceCode = await runCli(['run', '--mock', '-t', 'Neg Timeout Space', '--timeout', val], spaceIO.io);
          assert.equal(spaceCode, 1, `Expected exit code 1 for --timeout ${val}`);
          assert.ok(
            spaceIO.getStderr().includes('Configuration error: --timeout must be a positive integer') ||
            spaceIO.getStderr().includes("Option '--timeout' argument is ambiguous"),
            `Expected descriptive stderr for --timeout ${val}, got: ${spaceIO.getStderr()}`
          );

          // Equals syntax: [`--timeout=${val}`]
          const eqIO = createMockIO();
          const eqCode = await runCli(['run', '--mock', '-t', 'Neg Timeout Eq', `--timeout=${val}`], eqIO.io);
          assert.equal(eqCode, 1, `Expected exit code 1 for --timeout=${val}`);
          assert.match(
            eqIO.getStderr(),
            new RegExp(`Configuration error: --timeout must be a positive integer \\(received "${val.replace('.', '\\.')}"\\)`),
            `Expected positive integer error message for --timeout=${val}`
          );
        }
      });

      it('rejects negative values for --seat-budget and --seatBudget with exit code 1', async () => {
        for (const val of negativeValues) {
          // Space syntax kebab-case
          const spaceIO = createMockIO();
          const spaceCode = await runCli(['run', '--mock', '-t', 'Neg Budget Space', '--seat-budget', val], spaceIO.io);
          assert.equal(spaceCode, 1, `Expected exit code 1 for --seat-budget ${val}`);
          assert.ok(
            spaceIO.getStderr().includes('Configuration error: --seat-budget must be a positive integer') ||
            spaceIO.getStderr().includes("Option '--seat-budget' argument is ambiguous"),
            `Expected descriptive stderr for --seat-budget ${val}, got: ${spaceIO.getStderr()}`
          );

          // Equals syntax kebab-case
          const eqIO = createMockIO();
          const eqCode = await runCli(['run', '--mock', '-t', 'Neg Budget Eq', `--seat-budget=${val}`], eqIO.io);
          assert.equal(eqCode, 1, `Expected exit code 1 for --seat-budget=${val}`);
          assert.match(
            eqIO.getStderr(),
            new RegExp(`Configuration error: --seat-budget must be a positive integer \\(received "${val.replace('.', '\\.')}"\\)`),
            `Expected positive integer error message for --seat-budget=${val}`
          );

          // Space syntax camelCase
          const camelIO = createMockIO();
          const camelCode = await runCli(['run', '--mock', '-t', 'Neg Budget Camel', '--seatBudget', val], camelIO.io);
          assert.equal(camelCode, 1, `Expected exit code 1 for --seatBudget ${val}`);
          assert.ok(
            camelIO.getStderr().includes('Configuration error: --seat-budget must be a positive integer') ||
            camelIO.getStderr().includes("Option '--seatBudget' argument is ambiguous"),
            `Expected descriptive stderr for --seatBudget ${val}`
          );

          // Equals syntax camelCase
          const camelEqIO = createMockIO();
          const camelEqCode = await runCli(['run', '--mock', '-t', 'Neg Budget Camel Eq', `--seatBudget=${val}`], camelEqIO.io);
          assert.equal(camelEqCode, 1, `Expected exit code 1 for --seatBudget=${val}`);
          assert.match(
            camelEqIO.getStderr(),
            new RegExp(`Configuration error: --seat-budget must be a positive integer \\(received "${val.replace('.', '\\.')}"\\)`),
            `Expected positive integer error message for --seatBudget=${val}`
          );
        }
      });
    });

    describe('1.2 Zero Values', () => {
      const zeroValues = ['0', '00', '-0'];

      it('rejects zero values for --timeout with exit code 1 and descriptive stderr', async () => {
        for (const val of zeroValues) {
          const mockIO = createMockIO();
          const code = await runCli(['run', '--mock', '-t', 'Zero Timeout', `--timeout=${val}`], mockIO.io);
          assert.equal(code, 1, `Expected exit code 1 for --timeout=${val}`);
          assert.match(
            mockIO.getStderr(),
            new RegExp(`Configuration error: --timeout must be a positive integer \\(received "${val}"\\)`)
          );
        }
      });

      it('rejects zero values for --seat-budget with exit code 1 and descriptive stderr', async () => {
        for (const val of zeroValues) {
          const mockIO = createMockIO();
          const code = await runCli(['run', '--mock', '-t', 'Zero Budget', `--seat-budget=${val}`], mockIO.io);
          assert.equal(code, 1, `Expected exit code 1 for --seat-budget=${val}`);
          assert.match(
            mockIO.getStderr(),
            new RegExp(`Configuration error: --seat-budget must be a positive integer \\(received "${val}"\\)`)
          );
        }
      });
    });

    describe('1.3 Floating-Point Numbers', () => {
      const floatValues = ['12.34', '0.5', '0.0001', '99.999', '1e-4', '12.00000001'];

      it('rejects float inputs for --timeout with exit code 1 and descriptive stderr', async () => {
        for (const val of floatValues) {
          const mockIO = createMockIO();
          const code = await runCli(['run', '--mock', '-t', 'Float Timeout', '--timeout', val], mockIO.io);
          assert.equal(code, 1, `Expected exit code 1 for float --timeout "${val}"`);
          assert.match(
            mockIO.getStderr(),
            new RegExp(`Configuration error: --timeout must be a positive integer \\(received "${val}"\\)`)
          );
        }
      });

      it('rejects float inputs for --seat-budget with exit code 1 and descriptive stderr', async () => {
        for (const val of floatValues) {
          const mockIO = createMockIO();
          const code = await runCli(['run', '--mock', '-t', 'Float Budget', '--seat-budget', val], mockIO.io);
          assert.equal(code, 1, `Expected exit code 1 for float --seat-budget "${val}"`);
          assert.match(
            mockIO.getStderr(),
            new RegExp(`Configuration error: --seat-budget must be a positive integer \\(received "${val}"\\)`)
          );
        }
      });
    });

    describe('1.4 Non-Numeric Strings & Booleans', () => {
      const stringValues = ['abc', 'fast', 'unlimited', 'true', 'false', 'NaN', 'Infinity', '-Infinity', 'null', 'undefined', '123abc'];

      it('rejects non-numeric string inputs for --timeout with exit code 1 and descriptive stderr', async () => {
        for (const val of stringValues) {
          const mockIO = createMockIO();
          const args = val.startsWith('-')
            ? ['run', '--mock', '-t', 'String Timeout', `--timeout=${val}`]
            : ['run', '--mock', '-t', 'String Timeout', '--timeout', val];
          const code = await runCli(args, mockIO.io);
          assert.equal(code, 1, `Expected exit code 1 for string --timeout "${val}"`);
          assert.match(
            mockIO.getStderr(),
            new RegExp(`Configuration error: --timeout must be a positive integer \\(received "${val}"\\)`)
          );
        }
      });

      it('rejects non-numeric string inputs for --seat-budget with exit code 1 and descriptive stderr', async () => {
        for (const val of stringValues) {
          const mockIO = createMockIO();
          const args = val.startsWith('-')
            ? ['run', '--mock', '-t', 'String Budget', `--seat-budget=${val}`]
            : ['run', '--mock', '-t', 'String Budget', '--seat-budget', val];
          const code = await runCli(args, mockIO.io);
          assert.equal(code, 1, `Expected exit code 1 for string --seat-budget "${val}"`);
          assert.match(
            mockIO.getStderr(),
            new RegExp(`Configuration error: --seat-budget must be a positive integer \\(received "${val}"\\)`)
          );
        }
      });
    });

    describe('1.5 Empty & Whitespace-Only Strings', () => {
      const emptyValues = ['', '   ', '\t', '\n', '  \t  \n  '];

      it('rejects empty or whitespace inputs for --timeout with exit code 1', async () => {
        for (const val of emptyValues) {
          const mockIO = createMockIO();
          const code = await runCli(['run', '--mock', '-t', 'Empty Timeout', '--timeout', val], mockIO.io);
          assert.equal(code, 1, `Expected exit code 1 for empty/whitespace --timeout "${val}"`);
          assert.match(
            mockIO.getStderr(),
            /Configuration error: --timeout must be a positive integer/
          );
        }
      });

      it('rejects empty or whitespace inputs for --seat-budget with exit code 1', async () => {
        for (const val of emptyValues) {
          const mockIO = createMockIO();
          const code = await runCli(['run', '--mock', '-t', 'Empty Budget', '--seat-budget', val], mockIO.io);
          assert.equal(code, 1, `Expected exit code 1 for empty/whitespace --seat-budget "${val}"`);
          assert.match(
            mockIO.getStderr(),
            /Configuration error: --seat-budget must be a positive integer/
          );
        }
      });
    });

    describe('1.6 Missing Values & Dangling Flags', () => {
      it('rejects missing argument value for --timeout with exit code 1', async () => {
        const mockIO = createMockIO();
        const code = await runCli(['run', '--mock', '-t', 'Missing Val', '--timeout'], mockIO.io);
        assert.equal(code, 1);
        assert.match(mockIO.getStderr(), /CLI argument error: Option '--timeout <value>' argument missing/);
      });

      it('rejects missing argument value for --seat-budget with exit code 1', async () => {
        const mockIO = createMockIO();
        const code = await runCli(['run', '--mock', '-t', 'Missing Val', '--seat-budget'], mockIO.io);
        assert.equal(code, 1);
        assert.match(mockIO.getStderr(), /CLI argument error: Option '--seat-budget <value>' argument missing/);
      });

      it('rejects missing argument value for --seatBudget alias with exit code 1', async () => {
        const mockIO = createMockIO();
        const code = await runCli(['run', '--mock', '-t', 'Missing Val', '--seatBudget'], mockIO.io);
        assert.equal(code, 1);
        assert.match(mockIO.getStderr(), /CLI argument error: Option '--seatBudget <value>' argument missing/);
      });

      it('rejects dangling --timeout followed immediately by another flag with exit code 1', async () => {
        const mockIO = createMockIO();
        // Here util.parseArgs flags ambiguous argument because next token starts with '-'
        const code = await runCli(['run', '-t', 'Dangling Flag', '--timeout', '--mock'], mockIO.io);
        assert.equal(code, 1);
        assert.match(
          mockIO.getStderr(),
          /CLI argument error: Option '--timeout' argument is ambiguous|Configuration error: --timeout must be a positive integer/
        );
      });

      it('rejects dangling --seat-budget followed immediately by another flag with exit code 1', async () => {
        const mockIO = createMockIO();
        const code = await runCli(['run', '-t', 'Dangling Flag', '--seat-budget', '--mock'], mockIO.io);
        assert.equal(code, 1);
        assert.match(
          mockIO.getStderr(),
          /CLI argument error: Option '--seat-budget' argument is ambiguous|Configuration error: --seat-budget must be a positive integer/
        );
      });
    });

    describe('1.7 Large Integers & Overflow Bounds', () => {
      it('accepts Number.MAX_SAFE_INTEGER (9007199254740991) and passes through to JSON output', async () => {
        const maxSafe = String(Number.MAX_SAFE_INTEGER);
        const mockIO = createMockIO();
        const code = await runCli(
          ['run', '--mock', '-t', 'Max Safe Int', '--timeout', maxSafe, '--seat-budget', maxSafe, '--json'],
          mockIO.io
        );
        assert.equal(code, 0);
        const parsed = JSON.parse(mockIO.getStdout());
        assert.equal(parsed.ok, true);
        assert.equal(parsed.state.timeoutMs, Number.MAX_SAFE_INTEGER);
        assert.equal(parsed.state.totalSeatBudgetMs, Number.MAX_SAFE_INTEGER);
      });

      it('accepts 32-bit signed max integer (2147483647)', async () => {
        const int32Max = '2147483647';
        const mockIO = createMockIO();
        const code = await runCli(
          ['run', '--mock', '-t', 'Int32 Max', '--timeout', int32Max, '--seat-budget', int32Max, '--json'],
          mockIO.io
        );
        assert.equal(code, 0);
        const parsed = JSON.parse(mockIO.getStdout());
        assert.equal(parsed.ok, true);
        assert.equal(parsed.state.timeoutMs, 2147483647);
        assert.equal(parsed.state.totalSeatBudgetMs, 2147483647);
      });

      it('rejects negative MAX_SAFE_INTEGER with exit code 1', async () => {
        const negMaxSafe = `-${Number.MAX_SAFE_INTEGER}`;
        const mockIO = createMockIO();
        const code = await runCli(
          ['run', '--mock', '-t', 'Neg Max Safe Int', `--timeout=${negMaxSafe}`],
          mockIO.io
        );
        assert.equal(code, 1);
        assert.match(
          mockIO.getStderr(),
          new RegExp(`Configuration error: --timeout must be a positive integer \\(received "${negMaxSafe}"\\)`)
        );
      });

      it('rejects IEEE-754 overflow float (1e309 -> Infinity) with exit code 1', async () => {
        const mockIO = createMockIO();
        const code = await runCli(['run', '--mock', '-t', 'Overflow Float', '--timeout', '1e309'], mockIO.io);
        assert.equal(code, 1);
        assert.match(mockIO.getStderr(), /Configuration error: --timeout must be a positive integer \(received "1e309"\)/);
      });

      it('rejects IEEE-754 underflow float (-1e309 -> -Infinity) with exit code 1', async () => {
        const mockIO = createMockIO();
        const code = await runCli(['run', '--mock', '-t', 'Underflow Float', '--seat-budget=-1e309'], mockIO.io);
        assert.equal(code, 1);
        assert.match(mockIO.getStderr(), /Configuration error: --seat-budget must be a positive integer \(received "-1e309"\)/);
      });
    });

    describe('1.8 Valid Configuration Ingestion', () => {
      it('correctly maps --timeout and --seat-budget into engine overrides and state', async () => {
        const mockIO = createMockIO();
        const code = await runCli(
          ['run', '--mock', '-t', 'Valid Config Ingestion', '--timeout', '75000', '--seat-budget', '150000', '--json'],
          mockIO.io
        );
        assert.equal(code, 0);
        const parsed = JSON.parse(mockIO.getStdout());
        assert.equal(parsed.state.timeoutMs, 75000);
        assert.equal(parsed.state.totalSeatBudgetMs, 150000);
      });

      it('correctly maps --seatBudget (camelCase alias) into engine overrides and state', async () => {
        const mockIO = createMockIO();
        const code = await runCli(
          ['run', '--mock', '-t', 'CamelCase SeatBudget', '--timeout', '60000', '--seatBudget', '180000', '--json'],
          mockIO.io
        );
        assert.equal(code, 0);
        const parsed = JSON.parse(mockIO.getStdout());
        assert.equal(parsed.state.timeoutMs, 60000);
        assert.equal(parsed.state.totalSeatBudgetMs, 180000);
      });
    });
  });

  // ==========================================================================
  // SECTION 2: PROOF AUDIT SUMMARY TALLY ACROSS BOUNDARY DISTRIBUTIONS
  // ==========================================================================
  describe('2. Proof Audit Summary Tally Across Boundary Distributions', () => {
    const origRun = CouncilEngine.prototype.run;

    function mockEngineRun(proofsList, verdictKind = 'Unanimous Consensus') {
      CouncilEngine.prototype.run = async function () {
        return {
          ok: true,
          verdict: {
            kind: verdictKind,
            activeSeatCount: 2,
            excusedSeatCount: 0,
            unresolvedObjections: []
          },
          state: {
            round: 1,
            seats: [
              { id: 's1', harness: 'mock', model: 'm1', status: 'idle' },
              { id: 's2', harness: 'mock', model: 'm2', status: 'idle' }
            ],
            proofs: proofsList
          }
        };
      };
    }

    function restoreEngineRun() {
      CouncilEngine.prototype.run = origRun;
    }

    it('Distribution A: 0 proofs submitted (empty list) -> Proof Audit: 0 Admitted | 0 Partially Admitted | 0 Rejected', async () => {
      mockEngineRun([]);
      try {
        const mockIO = createMockIO();
        const code = await runCli(['run', '--mock', '-t', 'Zero Proofs Tally'], mockIO.io);
        assert.equal(code, 0);
        const out = mockIO.getStdout();
        assert.match(out, /Proof Audit: 0 Admitted \| 0 Partially Admitted \| 0 Rejected/);
      } finally {
        restoreEngineRun();
      }
    });

    it('Distribution B: All admitted (0 partial, 0 rejected) -> Proof Audit: 5 Admitted | 0 Partially Admitted | 0 Rejected', async () => {
      const proofs = [
        { id: 'P1', status: 'admitted', scope: 'S', kind: 'check', source: 'src1', statement: 'stmt1' },
        { id: 'P2', status: 'admitted', scope: 'S', kind: 'citation', source: 'src2', statement: 'stmt2' },
        { id: 'P3', status: 'admitted', scope: 'S', kind: 'benchmark', source: 'src3', statement: 'stmt3' },
        { id: 'P4', status: 'admitted', scope: 'S', kind: 'derivation', source: 'src4', statement: 'stmt4' },
        { id: 'P5', status: 'admitted', scope: 'S', kind: 'check', source: 'src5', statement: 'stmt5' }
      ];
      mockEngineRun(proofs);
      try {
        const mockIO = createMockIO();
        const code = await runCli(['run', '--mock', '-t', 'All Admitted Tally'], mockIO.io);
        assert.equal(code, 0);
        const out = mockIO.getStdout();
        assert.match(out, /Proof Audit: 5 Admitted \| 0 Partially Admitted \| 0 Rejected/);
      } finally {
        restoreEngineRun();
      }
    });

    it('Distribution C: All partially admitted (0 admitted, 0 rejected) -> Proof Audit: 0 Admitted | 4 Partially Admitted | 0 Rejected', async () => {
      const proofs = [
        { id: 'P1', status: 'partially_admitted', scope: 'S', kind: 'check', source: 'src1', statement: 'stmt1', judgeNote: 'Caveat 1', judgeAdmittedStatement: 'Core 1' },
        { id: 'P2', status: 'partially_admitted', scope: 'S', kind: 'citation', source: 'src2', statement: 'stmt2', judgeNote: 'Caveat 2', judgeAdmittedStatement: 'Core 2' },
        { id: 'P3', status: 'partially_admitted', scope: 'S', kind: 'benchmark', source: 'src3', statement: 'stmt3', judgeNote: 'Caveat 3', judgeAdmittedStatement: 'Core 3' },
        { id: 'P4', status: 'partially_admitted', scope: 'S', kind: 'derivation', source: 'src4', statement: 'stmt4', judgeNote: 'Caveat 4', judgeAdmittedStatement: 'Core 4' }
      ];
      mockEngineRun(proofs);
      try {
        const mockIO = createMockIO();
        const code = await runCli(['run', '--mock', '-t', 'All Partial Tally'], mockIO.io);
        assert.equal(code, 0);
        const out = mockIO.getStdout();
        assert.match(out, /Proof Audit: 0 Admitted \| 4 Partially Admitted \| 0 Rejected/);
      } finally {
        restoreEngineRun();
      }
    });

    it('Distribution D: All rejected (0 admitted, 0 partial) -> Proof Audit: 0 Admitted | 0 Partially Admitted | 3 Rejected', async () => {
      const proofs = [
        { id: 'P1', status: 'rejected', scope: 'S', kind: 'check', source: 'src1', statement: 'stmt1', judgeNote: 'Invalid check' },
        { id: 'P2', status: 'rejected', scope: 'S', kind: 'citation', source: 'src2', statement: 'stmt2', judgeNote: 'Inapplicable citation' },
        { id: 'P3', status: 'rejected', scope: 'S', kind: 'benchmark', source: 'src3', statement: 'stmt3', judgeNote: 'Uncalibrated benchmark' }
      ];
      mockEngineRun(proofs, 'Dissent Report');
      try {
        const mockIO = createMockIO();
        const code = await runCli(['run', '--mock', '-t', 'All Rejected Tally'], mockIO.io);
        assert.equal(code, 0);
        const out = mockIO.getStdout();
        assert.match(out, /Proof Audit: 0 Admitted \| 0 Partially Admitted \| 3 Rejected/);
      } finally {
        restoreEngineRun();
      }
    });

    it('Distribution E: Mixed distributions (10 admitted, 5 partially admitted, 2 rejected) -> Proof Audit: 10 Admitted | 5 Partially Admitted | 2 Rejected', async () => {
      const proofs = [];
      for (let i = 1; i <= 10; i++) {
        proofs.push({ id: `PA${i}`, status: 'admitted', scope: 'S', kind: 'check', source: `srcA${i}`, statement: `stmtA${i}` });
      }
      for (let i = 1; i <= 5; i++) {
        proofs.push({
          id: `PP${i}`,
          status: 'partially_admitted',
          scope: 'S',
          kind: 'citation',
          source: `srcP${i}`,
          statement: `stmtP${i}`,
          judgeNote: `Caveat ${i}`,
          judgeAdmittedStatement: `Core ${i}`
        });
      }
      for (let i = 1; i <= 2; i++) {
        proofs.push({
          id: `PR${i}`,
          status: 'rejected',
          scope: 'S',
          kind: 'derivation',
          source: `srcR${i}`,
          statement: `stmtR${i}`,
          judgeNote: `Rejected ${i}`
        });
      }

      mockEngineRun(proofs);
      try {
        const mockIO = createMockIO();
        const code = await runCli(['run', '--mock', '-t', 'Mixed Distribution Tally'], mockIO.io);
        assert.equal(code, 0);
        const out = mockIO.getStdout();
        assert.match(out, /Proof Audit: 10 Admitted \| 5 Partially Admitted \| 2 Rejected/);
      } finally {
        restoreEngineRun();
      }
    });

    it('Distribution F: Correctly maps admissionKind properties (explicitly_admitted, default_admitted, partially_admitted, judge_rejected)', async () => {
      const proofs = [
        { id: 'P1', admissionKind: 'explicitly_admitted', scope: 'S', kind: 'check', source: 'src', statement: 'stmt' },
        { id: 'P2', admissionKind: 'default_admitted', scope: 'S', kind: 'citation', source: 'src', statement: 'stmt' },
        { id: 'P3', admissionKind: 'partially_admitted', scope: 'S', kind: 'benchmark', source: 'src', statement: 'stmt', judgeNote: 'Caveat', judgeAdmittedStatement: 'Core' },
        { id: 'P4', admissionKind: 'judge_rejected', scope: 'S', kind: 'derivation', source: 'src', statement: 'stmt', judgeNote: 'Rejected' }
      ];
      mockEngineRun(proofs);
      try {
        const mockIO = createMockIO();
        const code = await runCli(['run', '--mock', '-t', 'AdmissionKind Tally'], mockIO.io);
        assert.equal(code, 0);
        const out = mockIO.getStdout();
        assert.match(out, /Proof Audit: 2 Admitted \| 1 Partially Admitted \| 1 Rejected/);
      } finally {
        restoreEngineRun();
      }
    });

    it('Distribution G: Robustness against sparse or minimal proof objects without crashing', async () => {
      const proofs = [
        { id: 'P1', status: 'admitted', scope: 'S', kind: 'check', source: 'src', statement: 'stmt' },
        { id: 'P2', status: 'partially_admitted', scope: 'S', kind: 'citation', source: 'src', statement: 'stmt' }, // minimal partial: no note, no admittedStmt
        { id: 'P3', status: 'rejected', scope: 'S', kind: 'benchmark', source: 'src', statement: 'stmt' }, // minimal rejected: no note
        { id: 'P4', status: 'unknown_status', scope: 'S', kind: 'check', source: 'src', statement: 'stmt' } // unrecognized status: counted in neither
      ];
      mockEngineRun(proofs);
      try {
        const mockIO = createMockIO();
        const code = await runCli(['run', '--mock', '-t', 'Sparse Proofs Tally'], mockIO.io);
        assert.equal(code, 0);
        const out = mockIO.getStdout();
        assert.match(out, /Proof Audit: 1 Admitted \| 1 Partially Admitted \| 1 Rejected/);
      } finally {
        restoreEngineRun();
      }
    });

    it('Distribution H: ANSI Color wrapping vs NO_COLOR environment discipline', async () => {
      const proofs = [
        { id: 'P1', status: 'partially_admitted', scope: 'S', kind: 'check', source: 'src', statement: 'stmt', judgeNote: 'Note', judgeAdmittedStatement: 'Core' }
      ];
      mockEngineRun(proofs);

      const savedNoColor = process.env.NO_COLOR;
      const savedForceColor = process.env.FORCE_COLOR;

      try {
        // Test WITH color (FORCE_COLOR=1, NO_COLOR unset)
        delete process.env.NO_COLOR;
        process.env.FORCE_COLOR = '1';
        const colorIO = createMockIO({ isTTY: true });
        await runCli(['run', '--mock', '-t', 'Color Tally Test'], colorIO.io);
        const colorOut = colorIO.getStdout();
        // Cyan bold wrapping for Proof Audit tally
        assert.ok(
          colorOut.includes('\x1b[1m\x1b[36mProof Audit: 0 Admitted | 1 Partially Admitted | 0 Rejected\x1b[0m'),
          'Expected ANSI cyan bold escape codes when color is enabled'
        );
        // Amber wrapping for [PARTIALLY ADMITTED] badge
        assert.ok(
          colorOut.includes('\x1b[33m[PARTIALLY ADMITTED]\x1b[0m'),
          'Expected ANSI amber escape codes for [PARTIALLY ADMITTED] badge'
        );

        // Test WITHOUT color (NO_COLOR=1)
        process.env.NO_COLOR = '1';
        delete process.env.FORCE_COLOR;
        const noColorIO = createMockIO({ isTTY: true });
        await runCli(['run', '--mock', '-t', 'NoColor Tally Test'], noColorIO.io);
        const noColorOut = noColorIO.getStdout();
        assert.ok(
          noColorOut.includes('Proof Audit: 0 Admitted | 1 Partially Admitted | 0 Rejected') &&
          !noColorOut.includes('\x1b[36mProof Audit:'),
          'Expected plain text Proof Audit tally without ANSI codes when NO_COLOR is set'
        );
        assert.ok(
          noColorOut.includes('[PARTIALLY ADMITTED]') &&
          !noColorOut.includes('\x1b[33m[PARTIALLY ADMITTED]'),
          'Expected plain text [PARTIALLY ADMITTED] badge without ANSI amber codes when NO_COLOR is set'
        );
      } finally {
        if (savedNoColor !== undefined) process.env.NO_COLOR = savedNoColor;
        else delete process.env.NO_COLOR;
        if (savedForceColor !== undefined) process.env.FORCE_COLOR = savedForceColor;
        else delete process.env.FORCE_COLOR;
        restoreEngineRun();
      }
    });
  });

  // ==========================================================================
  // SECTION 3: PROOF LIST RENDERING & PARTIAL ADMISSION ERGONOMICS
  // ==========================================================================
  describe('3. Proof List Rendering: Badges, Admitted Core, and Caveat Notes', () => {
    const origRun = CouncilEngine.prototype.run;

    function mockEngineWithProofs(proofs) {
      CouncilEngine.prototype.run = async function () {
        return {
          ok: true,
          verdict: {
            kind: 'Unanimous Consensus',
            activeSeatCount: 2,
            excusedSeatCount: 0,
            unresolvedObjections: []
          },
          state: {
            round: 1,
            seats: [
              { id: 'seat-alpha', harness: 'mock', model: 'alpha-1', status: 'idle' },
              { id: 'seat-beta', harness: 'mock', model: 'beta-1', status: 'idle' }
            ],
            proofs
          }
        };
      };
    }

    function restoreEngine() {
      CouncilEngine.prototype.run = origRun;
    }

    it('renders [PARTIALLY ADMITTED] badge, Judge Note, and Admitted Core for partially admitted proof', async () => {
      mockEngineWithProofs([
        {
          id: 'P1',
          status: 'partially_admitted',
          seatId: 'seat-alpha',
          scope: 'Architecture',
          kind: 'citation',
          source: 'RFC-992',
          statement: 'Full system latency is bounded under 50ms in all conditions.',
          judgeNote: 'Narrowed claim: latency bounded to 50ms only under steady state.',
          judgeAdmittedStatement: 'Steady-state latency is bounded under 50ms.'
        }
      ]);

      try {
        const mockIO = createMockIO();
        const code = await runCli(['run', '--mock', '-t', 'Render Partial Proof'], mockIO.io);
        assert.equal(code, 0);
        const out = mockIO.getStdout();

        assert.match(out, /Submitted Proofs:/);
        assert.match(out, /\[P1\]\s+\(partially_admitted\)\s+\[PARTIALLY ADMITTED\]\s+\[citation\]\s+Architecture/);
        assert.match(out, /Seat : seat-alpha \| Judge Note: Narrowed claim: latency bounded to 50ms only under steady state\./);
        assert.match(out, /Admitted Core: Steady-state latency is bounded under 50ms\./);
      } finally {
        restoreEngine();
      }
    });

    it('renders fallback property names admittedStatement and auditNote properly', async () => {
      mockEngineWithProofs([
        {
          id: 'P2',
          status: 'partially_admitted',
          seatId: 'seat-beta',
          scope: 'Performance',
          kind: 'benchmark',
          source: 'bench.log',
          statement: 'Throughput measured at 10000 rps.',
          auditNote: 'Audit caveat: warm cache only.',
          admittedStatement: 'Warm-cache throughput measured at 10000 rps.'
        }
      ]);

      try {
        const mockIO = createMockIO();
        const code = await runCli(['run', '--mock', '-t', 'Fallback Property Names'], mockIO.io);
        assert.equal(code, 0);
        const out = mockIO.getStdout();

        assert.match(out, /\[P2\]\s+\(partially_admitted\)\s+\[PARTIALLY ADMITTED\]\s+\[benchmark\]/);
        assert.match(out, /Seat : seat-beta \| Judge Note: Audit caveat: warm cache only\./);
        assert.match(out, /Admitted Core: Warm-cache throughput measured at 10000 rps\./);
      } finally {
        restoreEngine();
      }
    });

    it('renders partially admitted proof with caveat note only (without admittedStatement) omitting Admitted Core line', async () => {
      mockEngineWithProofs([
        {
          id: 'P3',
          status: 'partially_admitted',
          seatId: 'seat-gamma',
          scope: 'Security',
          kind: 'check',
          source: 'audit.txt',
          statement: 'All endpoints validate JWT signatures.',
          judgeNote: 'Caveat: /health endpoint bypasses validation by design.'
        }
      ]);

      try {
        const mockIO = createMockIO();
        const code = await runCli(['run', '--mock', '-t', 'Note Only Caveat'], mockIO.io);
        assert.equal(code, 0);
        const out = mockIO.getStdout();

        assert.match(out, /\[P3\]\s+\(partially_admitted\)\s+\[PARTIALLY ADMITTED\]\s+\[check\]/);
        assert.match(out, /Judge Note: Caveat: \/health endpoint bypasses validation by design\./);
        assert.doesNotMatch(out, /Admitted Core:/);
      } finally {
        restoreEngine();
      }
    });

    it('does NOT render [PARTIALLY ADMITTED] badge or Admitted Core for fully admitted proof', async () => {
      mockEngineWithProofs([
        {
          id: 'P4',
          status: 'admitted',
          seatId: 'seat-alpha',
          scope: 'Security',
          kind: 'derivation',
          source: 'proof.md',
          statement: 'Zero open objections ensures consensus.'
        }
      ]);

      try {
        const mockIO = createMockIO();
        const code = await runCli(['run', '--mock', '-t', 'Fully Admitted Proof'], mockIO.io);
        assert.equal(code, 0);
        const out = mockIO.getStdout();

        assert.match(out, /\[P4\]\s+\(admitted\)\s+\[derivation\]/);
        assert.doesNotMatch(out, /\[PARTIALLY ADMITTED\]/);
        assert.doesNotMatch(out, /Admitted Core:/);
      } finally {
        restoreEngine();
      }
    });

    it('renders Judge Note but NOT [PARTIALLY ADMITTED] badge or Admitted Core for rejected proof', async () => {
      mockEngineWithProofs([
        {
          id: 'P5',
          status: 'rejected',
          seatId: 'seat-beta',
          scope: 'Reliability',
          kind: 'check',
          source: 'err.log',
          statement: 'Unbounded retries prevent failure.',
          judgeNote: 'Rejected: Unbounded retries cause exponential latency explosion.'
        }
      ]);

      try {
        const mockIO = createMockIO();
        const code = await runCli(['run', '--mock', '-t', 'Rejected Proof'], mockIO.io);
        assert.equal(code, 0);
        const out = mockIO.getStdout();

        assert.match(out, /\[P5\]\s+\(rejected\)\s+\[check\]/);
        assert.doesNotMatch(out, /\[PARTIALLY ADMITTED\]/);
        assert.match(out, /Judge Note: Rejected: Unbounded retries cause exponential latency explosion\./);
        assert.doesNotMatch(out, /Admitted Core:/);
      } finally {
        restoreEngine();
      }
    });

    it('renders a full mixed suite of proofs with proper badges, notes, and cores', async () => {
      mockEngineWithProofs([
        {
          id: 'P1',
          status: 'admitted',
          seatId: 'seat-1',
          scope: 'Core Engine',
          kind: 'check',
          source: 'unit-tests',
          statement: 'State machine passes all transition checks.'
        },
        {
          id: 'P2',
          status: 'partially_admitted',
          seatId: 'seat-2',
          scope: 'Retry Policy',
          kind: 'citation',
          source: 'Issue #70',
          statement: 'Retry bounds prevent double turn timeouts.',
          judgeNote: 'Caveat: applies when turnTimeoutMs exceeds 90000ms.',
          judgeAdmittedStatement: 'Retry attempts are capped at min(turnTimeoutMs, 90000ms).'
        },
        {
          id: 'P3',
          status: 'rejected',
          seatId: 'seat-3',
          scope: 'Voting Policy',
          kind: 'derivation',
          source: 'heuristic',
          statement: 'Voters should explore filesystem before casting votes.',
          judgeNote: 'Rejected: Voting is strictly closed-context JSON voting.'
        }
      ]);

      try {
        const mockIO = createMockIO();
        const code = await runCli(['run', '--mock', '-t', 'Full Mixed Proofs Render'], mockIO.io);
        assert.equal(code, 0);
        const out = mockIO.getStdout();

        // Check Tally
        assert.match(out, /Proof Audit: 1 Admitted \| 1 Partially Admitted \| 1 Rejected/);

        // Check P1
        assert.match(out, /\[P1\]\s+\(admitted\)\s+\[check\] Core Engine/);
        assert.match(out, /Seat : seat-1/);

        // Check P2
        assert.match(out, /\[P2\]\s+\(partially_admitted\)\s+\[PARTIALLY ADMITTED\]\s+\[citation\] Retry Policy/);
        assert.match(out, /Seat : seat-2 \| Judge Note: Caveat: applies when turnTimeoutMs exceeds 90000ms\./);
        assert.match(out, /Admitted Core: Retry attempts are capped at min\(turnTimeoutMs, 90000ms\)\./);

        // Check P3
        assert.match(out, /\[P3\]\s+\(rejected\)\s+\[derivation\] Voting Policy/);
        assert.match(out, /Seat : seat-3 \| Judge Note: Rejected: Voting is strictly closed-context JSON voting\./);
      } finally {
        restoreEngine();
      }
    });
  });

  // ==========================================================================
  // SECTION 4: END-TO-END VERIFICATION WITH HARNESS REGISTRY
  // ==========================================================================
  describe('4. End-to-End Live CLI Deliberation with Mock Harness Registry', () => {
    it('executes full E2E run producing 3-state proof admission and verifies tally & badge in output', async () => {
      const customAdapter = {
        executeSeatProof: async ({ seat }) => {
          if (seat.id === 'seat-alpha') {
            return {
              scope: 'Engine Budget',
              kind: 'citation',
              source: 'Spec RFC-70',
              statement: 'Shared seat budget bounds retry loops.'
            };
          }
          return {
            scope: 'Voting Efficiency',
            kind: 'derivation',
            source: 'Spec RFC-72',
            statement: 'Voting downshift reduces token consumption by 70%.'
          };
        },
        executeJudgeAuditAndSynthesis: async () => ({
          summary: 'Engine retry budgets and voting downshifts are mathematically verified.',
          proofDecisions: {
            P1: {
              status: 'partially_admitted',
              admittedStatement: 'Shared seat budget bounds retry execution time.',
              note: 'Narrowed statement: budget applies per seat per phase.'
            },
            P2: {
              status: 'admitted',
              note: 'Confirmed against empirical benchmarks.'
            }
          },
          clauses: [
            {
              id: 'C1',
              context: 'Engine Verification',
              conclusion: 'Consensus verified with bounded retry and voting downshift.',
              citedProofIds: ['P1', 'P2']
            }
          ]
        }),
        executeSeatVote: async () => ({ vote: 'accept' })
      };

      const registry = new HarnessRegistry();
      registry.register('codex', customAdapter);
      registry.register('antigravity', customAdapter);

      const tmpConfig = path.join(os.tmpdir(), `challenger-m6-2-live-e2e-${Date.now()}.json`);
      fs.writeFileSync(
        tmpConfig,
        JSON.stringify({
          topic: 'Challenger M6-2 E2E Tally and Proof Rendering Verification',
          minQuorum: 2,
          maxRounds: 1,
          seats: [
            { id: 'seat-alpha', harness: 'codex', model: 'gpt-6.1-sol (high)', soul: 'Soul Alpha' },
            { id: 'seat-beta', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'Soul Beta' }
          ],
          judge: { id: 'judge-argon', harness: 'antigravity', model: 'gemini-4-argon-high', soul: 'Judge Soul' }
        })
      );

      try {
        const mockIO = createMockIO();
        mockIO.io.harnessRegistry = registry;
        mockIO.io.liveWatcher = { attach: () => {}, stop: () => {} };

        const code = await runCli(['run', '--live', '-c', tmpConfig, '--timeout', '120000', '--seat-budget', '240000'], mockIO.io);
        assert.equal(code, 0, `Expected exit code 0, got ${code}. Stderr: ${mockIO.getStderr()}`);
        const out = mockIO.getStdout();

        // 1. Verify Proof Audit Tally: 1 Admitted | 1 Partially Admitted | 0 Rejected
        assert.match(
          out,
          /Proof Audit: 1 Admitted \| 1 Partially Admitted \| 0 Rejected/,
          'Output must contain explicit Proof Audit tally matching 1 Admitted | 1 Partially Admitted | 0 Rejected'
        );

        // 2. Verify Partially Admitted Proof rendering
        assert.match(
          out,
          /\[P1\]\s+\(partially_admitted\)\s+\[PARTIALLY ADMITTED\]\s+\[citation\] Engine Budget/,
          'P1 must be rendered with [PARTIALLY ADMITTED] badge'
        );
        assert.match(
          out,
          /Judge Note: Narrowed statement: budget applies per seat per phase\./,
          'P1 must display its caveat Judge Note'
        );
        assert.match(
          out,
          /Admitted Core: Shared seat budget bounds retry execution time\./,
          'P1 must display its Admitted Core statement'
        );

        // 3. Verify Fully Admitted Proof rendering
        assert.match(
          out,
          /\[P2\]\s+\(admitted\)\s+\[derivation\] Voting Efficiency/,
          'P2 must be rendered with (admitted)'
        );
        assert.doesNotMatch(
          out,
          /\[P2\].*\[PARTIALLY ADMITTED\]/,
          'P2 must NOT carry [PARTIALLY ADMITTED] badge'
        );
      } finally {
        if (fs.existsSync(tmpConfig)) fs.unlinkSync(tmpConfig);
      }
    });
  });
});
