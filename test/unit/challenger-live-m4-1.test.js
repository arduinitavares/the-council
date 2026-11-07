/**
 * @fileoverview Adversarial Stress Test Suite — Milestone 4 (Challenger 1)
 *
 * Evaluates Built-In Presets (COUNCIL_PRESETS), Preset-Aware resolveConfig,
 * and CLI Flag Handling under hostile, boundary, and mutating inputs.
 *
 * EMPIRICAL ADVERSARIAL CHALLENGES:
 * 1. Deep immutability of COUNCIL_PRESETS and resolved config objects.
 * 2. Option merging permutations (topic, maxRounds, minQuorum, seat overrides, judge overrides) across all 4 presets.
 * 3. Malformed and invalid preset inputs (empty strings, case mismatches, symbols, non-string types).
 * 4. Prototype pollution / prototype property inheritance keys (toString, valueOf, constructor, __proto__).
 * 5. Config file loading with preset properties and override combinations.
 * 6. CLI flag resolution and crash behavior when combining -c with overrides.
 *
 * Author: challenger_live_m4_1 (Empirical Challenger)
 * Framework: Native Node 22 test runner (node:test, node:assert/strict)
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  COUNCIL_PRESETS,
  resolveConfig,
  loadConfigFile,
  validateConfig
} from '../../src/engine/config.js';
import { CouncilEngine } from '../../src/engine/council-engine.js';
import { runCli } from '../../src/cli/index.js';

describe('Adversarial Stress: Milestone 4 Presets & Config Resolution (Challenger 1)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-m4-challenger-'));
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ==========================================================================
  // SECTION 1: Deep Immutability & Boundary Protections
  // ==========================================================================
  describe('1. Deep Immutability of COUNCIL_PRESETS & Resolved Config', () => {
    it('verifies COUNCIL_PRESETS is deeply frozen across all presets, judges, and seats', () => {
      assert.ok(Object.isFrozen(COUNCIL_PRESETS), 'COUNCIL_PRESETS root must be frozen');

      for (const [name, preset] of Object.entries(COUNCIL_PRESETS)) {
        assert.ok(Object.isFrozen(preset), `Preset "${name}" must be frozen`);
        assert.ok(Object.isFrozen(preset.judge), `Preset "${name}.judge" must be frozen`);
        assert.ok(Object.isFrozen(preset.seats), `Preset "${name}.seats" array must be frozen`);

        // Test immutability of individual seat definitions
        for (let i = 0; i < preset.seats.length; i++) {
          const seat = preset.seats[i];
          assert.ok(Object.isFrozen(seat), `Preset "${name}.seats[${i}]" (${seat.id}) must be frozen`);

          // Verify strict-mode mutation fails
          assert.throws(
            () => { seat.model = 'mutated-model'; },
            /Cannot assign to read only property 'model'/,
            'Mutating seat property must throw TypeError in strict mode'
          );
        }

        // Verify array mutation fails
        assert.throws(
          () => { preset.seats.push({ id: 'injected-seat' }); },
          /Cannot add property \d+, object is not extensible/,
          'Pushing to preset.seats must throw TypeError'
        );

        // Verify judge mutation fails
        assert.throws(
          () => { preset.judge.id = 'hacked-judge'; },
          /Cannot assign to read only property 'id'/,
          'Mutating preset.judge must throw TypeError'
        );
      }
    });

    it('verifies resolveConfig produces an isolated copy that does not corrupt COUNCIL_PRESETS', () => {
      const resolved = resolveConfig({ preset: 'architecture' });
      assert.ok(Object.isFrozen(resolved), 'Root of resolvedConfig must be frozen');

      // The seats array in resolvedConfig must be a distinct copy from preset
      assert.notEqual(
        resolved.seats,
        COUNCIL_PRESETS.architecture.seats,
        'resolvedConfig.seats must be a new array copy'
      );

      // Verify that even if a consumer mutates resolved.seats or resolved.judge, COUNCIL_PRESETS remains untouched
      const originalJudgeId = COUNCIL_PRESETS.architecture.judge.id;
      const originalSeat0Model = COUNCIL_PRESETS.architecture.seats[0].model;
      const originalSeatCount = COUNCIL_PRESETS.architecture.seats.length;

      // Note: resolved.judge and resolved.seats are shallow copies (not deep frozen)
      resolved.judge.id = 'mutated-resolved-judge';
      resolved.seats[0].model = 'mutated-resolved-seat';
      resolved.seats.push({ id: 'injected-seat', harness: 'mock', model: 'm', soul: 's' });

      assert.equal(COUNCIL_PRESETS.architecture.judge.id, originalJudgeId, 'COUNCIL_PRESETS judge must remain intact');
      assert.equal(COUNCIL_PRESETS.architecture.seats[0].model, originalSeat0Model, 'COUNCIL_PRESETS seat 0 model must remain intact');
      assert.equal(COUNCIL_PRESETS.architecture.seats.length, originalSeatCount, 'COUNCIL_PRESETS seats count must remain intact');
    });

    it('documents shallow vs deep freezing on resolveConfig return value', () => {
      const resolved = resolveConfig({ preset: 'security-audit' });

      // Root is frozen
      assert.equal(Object.isFrozen(resolved), true, 'Root must be frozen');

      // Sub-objects are NOT deep frozen (empirical observation)
      assert.equal(Object.isFrozen(resolved.judge), false, 'resolved.judge is not deep frozen');
      assert.equal(Object.isFrozen(resolved.seats), false, 'resolved.seats is not deep frozen');
      assert.equal(Object.isFrozen(resolved.seats[0]), false, 'resolved.seats[0] is not deep frozen');
    });
  });

  // ==========================================================================
  // SECTION 2: Option Merging Permutations Across All 4 Presets
  // ==========================================================================
  describe('2. Option Merging Permutations across Presets', () => {
    const presets = ['architecture', 'product-comparison', 'security-audit', 'argon-only'];

    for (const presetName of presets) {
      describe(`Preset: ${presetName}`, () => {
        it('merges custom topic while preserving all preset seats and judge', () => {
          const customTopic = `Adversarial Deliberation Topic for ${presetName} #${Date.now()}`;
          const resolved = resolveConfig({ preset: presetName, topic: customTopic });

          assert.equal(resolved.topic, customTopic);
          assert.equal(resolved.preset, presetName);

          const expectedSeats = COUNCIL_PRESETS[presetName].seats;
          assert.equal(resolved.seats.length, expectedSeats.length);
          for (let i = 0; i < expectedSeats.length; i++) {
            assert.equal(resolved.seats[i].id, expectedSeats[i].id);
            assert.equal(resolved.seats[i].model, expectedSeats[i].model);
            assert.equal(resolved.seats[i].harness, expectedSeats[i].harness);
          }

          assert.equal(resolved.judge.id, COUNCIL_PRESETS[presetName].judge.id);
          assert.equal(resolved.judge.model, COUNCIL_PRESETS[presetName].judge.model);
        });

        it('merges custom maxRounds and minQuorum within valid boundaries', () => {
          const resolved = resolveConfig({
            preset: presetName,
            maxRounds: 10,
            minQuorum: 2
          });

          assert.equal(resolved.maxRounds, 10);
          assert.equal(resolved.minQuorum, 2);
          assert.equal(resolved.seats.length, COUNCIL_PRESETS[presetName].seats.length);
        });

        it('allows custom seats to completely override preset seats while retaining preset judge', () => {
          const customSeats = [
            { id: 'custom-seat-alpha', harness: 'mock', model: 'mock-model-1', soul: 'Custom Alpha Soul' },
            { id: 'custom-seat-beta', harness: 'mock', model: 'mock-model-2', soul: 'Custom Beta Soul' }
          ];

          const resolved = resolveConfig({
            preset: presetName,
            seats: customSeats
          });

          assert.equal(resolved.seats.length, 2);
          assert.equal(resolved.seats[0].id, 'custom-seat-alpha');
          assert.equal(resolved.seats[1].id, 'custom-seat-beta');
          assert.equal(resolved.judge.id, COUNCIL_PRESETS[presetName].judge.id);
        });

        it('allows partial judge overrides to merge over preset judge definition', () => {
          const resolved = resolveConfig({
            preset: presetName,
            judge: {
              soul: 'Overridden Judge Temperament for Stress Testing'
            }
          });

          assert.equal(resolved.judge.id, COUNCIL_PRESETS[presetName].judge.id);
          assert.equal(resolved.judge.model, COUNCIL_PRESETS[presetName].judge.model);
          assert.equal(resolved.judge.harness, COUNCIL_PRESETS[presetName].judge.harness);
          assert.equal(resolved.judge.soul, 'Overridden Judge Temperament for Stress Testing');
        });

        it('executes full debate to unanimous consensus with MockAdapter in CouncilEngine', async () => {
          const resolved = resolveConfig({
            preset: presetName,
            topic: `Live execution verification for ${presetName}`
          });
          const engine = new CouncilEngine(resolved);
          const result = await engine.run();

          assert.equal(result.ok, true, `Preset ${presetName} must complete debate successfully`);
          assert.equal(result.verdict?.kind, 'Unanimous Consensus');
          assert.equal(result.state.round, 1);
          assert.equal(result.state.proofs.length, resolved.seats.length);
        });
      });
    }

    it('rejects custom seat overrides that violate minQuorum', () => {
      assert.throws(
        () => resolveConfig({
          preset: 'architecture',
          minQuorum: 3,
          seats: [
            { id: 'lone-seat', harness: 'mock', model: 'm', soul: 's' }
          ]
        }),
        /Configured seats \(1\) below minQuorum \(3\)/
      );
    });

    it('rejects custom seat overrides containing duplicate seat IDs', () => {
      assert.throws(
        () => resolveConfig({
          preset: 'architecture',
          seats: [
            { id: 'dup-seat', harness: 'mock', model: 'm', soul: 's' },
            { id: 'dup-seat', harness: 'mock', model: 'm', soul: 's' }
          ]
        }),
        /Duplicate seat ID "dup-seat" detected/
      );
    });

    it('demonstrates non-iterable seat override causes TypeError before validateConfig', () => {
      // In src/engine/config.js line 255: `seats: userConfig.seats ? [...userConfig.seats] : defaultSeats`
      // When seats is a non-iterable truthy value (e.g. object), it throws TypeError instead of validateConfig error
      assert.throws(
        () => resolveConfig({ preset: 'architecture', seats: { not: 'an-array' } }),
        { name: 'TypeError', message: /userConfig\.seats is not iterable/ }
      );
    });
  });

  // ==========================================================================
  // SECTION 3: Malformed & Invalid Preset Inputs
  // ==========================================================================
  describe('3. Malformed & Invalid Preset Inputs', () => {
    it('rejects case mismatches with descriptive available presets list', () => {
      const caseMismatches = [
        'Architecture',
        'ARCHITECTURE',
        'Product-Comparison',
        'PRODUCT-COMPARISON',
        'Security-Audit',
        'SECURITY-AUDIT',
        'Argon-Only',
        'ARGON-ONLY'
      ];

      for (const badName of caseMismatches) {
        assert.throws(
          () => resolveConfig({ preset: badName }),
          (err) => {
            assert.match(
              err.message,
              new RegExp(`^Unknown preset "${badName}"\\. Available presets: architecture, product-comparison, security-audit, argon-only$`)
            );
            return true;
          }
        );
      }
    });

    it('rejects whitespace-padded preset names', () => {
      for (const padded of [' architecture', 'architecture ', ' product-comparison ']) {
        assert.throws(
          () => resolveConfig({ preset: padded }),
          new RegExp(`Unknown preset "${padded}"\\. Available presets:`)
        );
      }
    });

    it('rejects non-existent preset names', () => {
      assert.throws(
        () => resolveConfig({ preset: 'quantum-computing' }),
        /Unknown preset "quantum-computing"\. Available presets: architecture, product-comparison, security-audit, argon-only/
      );
    });

    it('rejects non-string primitives (numbers, booleans, objects)', () => {
      assert.throws(
        () => resolveConfig({ preset: 42 }),
        /Unknown preset "42"\. Available presets:/
      );
      assert.throws(
        () => resolveConfig({ preset: true }),
        /Unknown preset "true"\. Available presets:/
      );
      assert.throws(
        () => resolveConfig({ preset: {} }),
        /Unknown preset "\[object Object\]"\. Available presets:/
      );
    });

    it('safely handles Symbol preset without uncaught TypeError during string interpolation', () => {
      assert.throws(
        () => resolveConfig({ preset: Symbol('architecture') }),
        /Unknown preset "Symbol\(architecture\)"\. Available presets:/
      );
    });

    it('throws on empty string preset in resolveConfig', () => {
      assert.throws(
        () => resolveConfig({ preset: '' }),
        /Unknown preset ""\. Available presets: architecture, product-comparison, security-audit, argon-only/
      );
    });
  });

  // ==========================================================================
  // SECTION 4: Prototype Pollution & Prototype Key Vulnerabilities
  // ==========================================================================
  describe('4. Prototype Property Lookup Vulnerabilities', () => {
    const protoKeys = [
      'toString',
      'valueOf',
      'constructor',
      '__proto__',
      'hasOwnProperty',
      'isPrototypeOf',
      'propertyIsEnumerable',
      'toLocaleString'
    ];

    for (const key of protoKeys) {
      it(`rejects prototype property "${key}" with clean Unknown preset error`, () => {
        assert.throws(
          () => resolveConfig({ preset: key }),
          new RegExp(`Unknown preset "${key}"\\. Available presets: architecture, product-comparison, security-audit, argon-only`),
          `Passing prototype key "${key}" should be rejected as an unknown preset`
        );
      });
    }

    it('rejects prototype key passed to -p / --preset flag with clean configuration error', async () => {
      let stderrOutput = '';
      const exitCode = await runCli(['run', '-p', 'toString'], {
        stdout: { write: () => true },
        stderr: { write: (m) => { stderrOutput += m; return true; } },
        exit: (code) => code
      });

      assert.equal(exitCode, 1);
      assert.match(
        stderrOutput,
        /Configuration error: Unknown preset "toString"\. Available presets: architecture, product-comparison, security-audit, argon-only/,
        'CLI rejects prototype key as unknown preset'
      );
    });
  });

  // ==========================================================================
  // SECTION 5: Config File Resolution with Presets & Overrides
  // ==========================================================================
  describe('5. Config File Loading with Preset Property', () => {
    it('loads and resolves a JSON file specifying preset and custom topic', () => {
      const cfgPath = path.join(tmpDir, 'valid-preset.json');
      fs.writeFileSync(
        cfgPath,
        JSON.stringify({
          preset: 'security-audit',
          topic: 'Audit of authentication microservice token handling'
        })
      );

      const resolved = loadConfigFile(cfgPath);
      assert.equal(resolved.preset, 'security-audit');
      assert.equal(resolved.topic, 'Audit of authentication microservice token handling');
      assert.equal(resolved.judge.id, 'judge-astra');
      assert.equal(resolved.seats.length, 3);
      assert.equal(resolved.seats[0].id, 'astra-secops');
    });

    it('loads a JSON file with preset and custom seat overrides', () => {
      const cfgPath = path.join(tmpDir, 'override-preset.json');
      fs.writeFileSync(
        cfgPath,
        JSON.stringify({
          preset: 'product-comparison',
          seats: [
            { id: 'reviewer-1', harness: 'mock', model: 'm1', soul: 's1' },
            { id: 'reviewer-2', harness: 'mock', model: 'm2', soul: 's2' }
          ]
        })
      );

      const resolved = loadConfigFile(cfgPath);
      assert.equal(resolved.preset, 'product-comparison');
      assert.equal(resolved.seats.length, 2);
      assert.equal(resolved.seats[0].id, 'reviewer-1');
      assert.equal(resolved.judge.id, 'judge-opus');
    });

    it('applies programmatic overrides passed to loadConfigFile', () => {
      const cfgPath = path.join(tmpDir, 'base-preset.json');
      fs.writeFileSync(
        cfgPath,
        JSON.stringify({
          preset: 'architecture',
          topic: 'Initial Topic in File'
        })
      );

      const resolved = loadConfigFile(cfgPath, {
        topic: 'Overridden Topic from Caller',
        maxRounds: 5
      });

      assert.equal(resolved.preset, 'architecture');
      assert.equal(resolved.topic, 'Overridden Topic from Caller');
      assert.equal(resolved.maxRounds, 5);
      assert.equal(resolved.seats.length, 4);
    });

    it('throws on config file with unknown preset', () => {
      const cfgPath = path.join(tmpDir, 'invalid-preset.json');
      fs.writeFileSync(
        cfgPath,
        JSON.stringify({
          preset: 'non-existent-preset'
        })
      );

      assert.throws(
        () => loadConfigFile(cfgPath),
        /Unknown preset "non-existent-preset"/
      );
    });
  });

  // ==========================================================================
  // SECTION 6: CLI Integration & Flag Combinations Stress
  // ==========================================================================
  describe('6. CLI Flag Resolution and Crash Vectors', () => {
    it('executes CLI run with --preset architecture cleanly with code 0', async () => {
      let stdoutOutput = '';
      const exitCode = await runCli(['run', '--preset', 'architecture', '-t', 'CLI Architecture Test'], {
        stdout: { write: (m) => { stdoutOutput += m; return true; } },
        stderr: { write: () => true },
        exit: (c) => c
      });

      assert.equal(exitCode, 0);
      assert.match(stdoutOutput, /Topic\s+:\s+CLI Architecture Test/);
      assert.match(stdoutOutput, /Seats\s+:\s+4 total/);
      assert.match(stdoutOutput, /Submitted Proofs:/);
      assert.match(stdoutOutput, /astra-systems/);
      assert.match(stdoutOutput, /opus-domain/);
    });

    it('rejects empty string preset flag with clean configuration error', async () => {
      let stderrOutput = '';
      const exitCode = await runCli(['run', '--preset', ''], {
        stdout: { write: () => true },
        stderr: { write: (m) => { stderrOutput += m; return true; } },
        exit: (c) => c
      });

      assert.equal(exitCode, 1);
      assert.match(
        stderrOutput,
        /Configuration error: Unknown preset ""\. Available presets:/
      );
    });

    it('successfully combines -c <config.json> with -t <topic> override', async () => {
      const cfgPath = path.join(tmpDir, 'freeze-test.json');
      fs.writeFileSync(cfgPath, JSON.stringify({ preset: 'argon-only', topic: 'File Topic' }));

      let stdoutOutput = '';
      const exitCode = await runCli(['run', '-c', cfgPath, '-t', 'Overridden Topic', '--json'], {
        stdout: { write: (m) => { stdoutOutput += m; return true; } },
        stderr: { write: () => true },
        exit: (c) => c
      });

      assert.equal(exitCode, 0);
      const parsed = JSON.parse(stdoutOutput);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.state.topic, 'Overridden Topic');
      assert.equal(parsed.state.seats.length, 3);
    });

    it('successfully combines -c <config.json> with -p <preset> override', async () => {
      const cfgPath = path.join(tmpDir, 'freeze-test-preset.json');
      fs.writeFileSync(cfgPath, JSON.stringify({ topic: 'Topic Without Preset' }));

      let stdoutOutput = '';
      const exitCode = await runCli(['run', '-c', cfgPath, '-p', 'architecture', '--json'], {
        stdout: { write: (m) => { stdoutOutput += m; return true; } },
        stderr: { write: () => true },
        exit: (c) => c
      });

      assert.equal(exitCode, 0);
      const parsed = JSON.parse(stdoutOutput);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.state.seats.length, 4);
      assert.equal(parsed.state.judge.id, 'judge-opus');
    });

    it('successfully combines -c <config.json> with -r <rounds> or -q <quorum>', async () => {
      const cfgPath = path.join(tmpDir, 'freeze-test-rounds.json');
      fs.writeFileSync(cfgPath, JSON.stringify({ preset: 'argon-only', topic: 'File Topic' }));

      let out1 = '';
      const exit1 = await runCli(['run', '-c', cfgPath, '-r', '5', '--json'], {
        stdout: { write: (m) => { out1 += m; return true; } },
        stderr: { write: () => true },
        exit: (c) => c
      });
      assert.equal(exit1, 0);
      assert.equal(JSON.parse(out1).state.maxRounds, 5);

      let out2 = '';
      const exit2 = await runCli(['run', '-c', cfgPath, '-q', '3', '--json'], {
        stdout: { write: (m) => { out2 += m; return true; } },
        stderr: { write: () => true },
        exit: (c) => c
      });
      assert.equal(exit2, 0);
      assert.equal(JSON.parse(out2).state.minQuorum, 3);
    });
  });
});
