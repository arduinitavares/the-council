import { describe, it } from 'node:test';
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

describe('Unit: Built-in Council Presets & Preset-Aware resolveConfig', () => {
  describe('COUNCIL_PRESETS Definition & Invariants', () => {
    const expectedPresetNames = ['architecture', 'product-comparison', 'security-audit', 'argon-only'];

    it('exports all 4 canonical presets', () => {
      assert.ok(COUNCIL_PRESETS, 'COUNCIL_PRESETS must be exported');
      const actualNames = Object.keys(COUNCIL_PRESETS);
      assert.deepEqual(actualNames.sort(), expectedPresetNames.slice().sort());
    });

    it('freezes presets and prevents runtime mutation', () => {
      assert.ok(Object.isFrozen(COUNCIL_PRESETS), 'COUNCIL_PRESETS must be frozen');
      for (const [name, preset] of Object.entries(COUNCIL_PRESETS)) {
        assert.ok(Object.isFrozen(preset), `Preset ${name} must be frozen`);
        assert.ok(Object.isFrozen(preset.seats), `Preset ${name}.seats must be frozen`);
        assert.ok(Object.isFrozen(preset.judge), `Preset ${name}.judge must be frozen`);
      }
    });

    it('verifies "architecture" preset structure', () => {
      const p = COUNCIL_PRESETS.architecture;
      assert.equal(p.seats.length, 4);
      assert.equal(p.judge.id, 'judge-opus');
      assert.equal(p.judge.harness, 'antigravity');
      assert.equal(p.judge.model, 'claude-opus-5-5-high');
      assert.match(p.judge.soul, /Impartial Architecture Judge/);

      const seatIds = p.seats.map((s) => s.id);
      assert.deepEqual(seatIds, ['astra-systems', 'sol-pragmatic', 'argon-staff', 'opus-domain']);

      const astraSys = p.seats.find((s) => s.id === 'astra-systems');
      assert.equal(astraSys.harness, 'codex');
      assert.equal(astraSys.model, 'gpt-6-astra (max)');
      assert.match(astraSys.soul, /Systems & Architecture Purist/);

      const solPrag = p.seats.find((s) => s.id === 'sol-pragmatic');
      assert.equal(solPrag.harness, 'codex');
      assert.equal(solPrag.model, 'gpt-5-sol (high)');
      assert.match(solPrag.soul, /Pragmatic Systems Engineer/);

      const argonStaff = p.seats.find((s) => s.id === 'argon-staff');
      assert.equal(argonStaff.harness, 'antigravity');
      assert.equal(argonStaff.model, 'gemini-4-argon-high');
      assert.match(argonStaff.soul, /Staff Distributed Systems Engineer/);

      const opusDomain = p.seats.find((s) => s.id === 'opus-domain');
      assert.equal(opusDomain.harness, 'antigravity');
      assert.equal(opusDomain.model, 'claude-opus-5-5-high');
      assert.match(opusDomain.soul, /Enterprise Domain Architect/);
    });

    it('verifies "product-comparison" preset structure', () => {
      const p = COUNCIL_PRESETS['product-comparison'];
      assert.equal(p.seats.length, 4);
      assert.equal(p.judge.id, 'judge-opus');
      assert.equal(p.judge.harness, 'antigravity');
      assert.equal(p.judge.model, 'claude-opus-5-5-high');
      assert.match(p.judge.soul, /Impartial Product Judge/);

      const seatIds = p.seats.map((s) => s.id);
      assert.deepEqual(seatIds, ['astra-specs', 'astra-ux', 'argon-value', 'grok-skeptic']);

      const astraSpecs = p.seats.find((s) => s.id === 'astra-specs');
      assert.equal(astraSpecs.harness, 'codex');
      assert.equal(astraSpecs.model, 'gpt-6-astra (max)');
      assert.match(astraSpecs.soul, /Technical Specifications Auditor/);

      const astraUx = p.seats.find((s) => s.id === 'astra-ux');
      assert.equal(astraUx.harness, 'codex');
      assert.equal(astraUx.model, 'gpt-6-astra (max)');
      assert.match(astraUx.soul, /User Experience & Ergonomics Reviewer/);

      const argonVal = p.seats.find((s) => s.id === 'argon-value');
      assert.equal(argonVal.harness, 'antigravity');
      assert.equal(argonVal.model, 'gemini-4-argon-high');
      assert.match(argonVal.soul, /Price-to-Performance & Longevity Analyst/);

      const grok = p.seats.find((s) => s.id === 'grok-skeptic');
      assert.equal(grok.harness, 'cursor');
      assert.equal(grok.model, 'grok-4-skeptic');
      assert.match(grok.soul, /Independent Skeptic & Edge-Case Prober/);
    });

    it('verifies "security-audit" preset structure', () => {
      const p = COUNCIL_PRESETS['security-audit'];
      assert.equal(p.seats.length, 3);
      assert.equal(p.judge.id, 'judge-astra');
      assert.equal(p.judge.harness, 'codex');
      assert.equal(p.judge.model, 'gpt-6-astra (max)');
      assert.match(p.judge.soul, /Impartial Security Judge/);

      const seatIds = p.seats.map((s) => s.id);
      assert.deepEqual(seatIds, ['astra-secops', 'opus-threat', 'argon-supplychain']);

      const astraSec = p.seats.find((s) => s.id === 'astra-secops');
      assert.equal(astraSec.harness, 'codex');
      assert.equal(astraSec.model, 'gpt-6-astra (max)');
      assert.match(astraSec.soul, /Application Security Engineer/);

      const opusThreat = p.seats.find((s) => s.id === 'opus-threat');
      assert.equal(opusThreat.harness, 'antigravity');
      assert.equal(opusThreat.model, 'claude-opus-5-5-high');
      assert.match(opusThreat.soul, /Threat Modeling Architect/);

      const argonSupply = p.seats.find((s) => s.id === 'argon-supplychain');
      assert.equal(argonSupply.harness, 'antigravity');
      assert.equal(argonSupply.model, 'gemini-4-argon-high');
      assert.match(argonSupply.soul, /Supply Chain & Dependency Auditor/);
    });

    it('verifies "argon-only" preset structure', () => {
      const p = COUNCIL_PRESETS['argon-only'];
      assert.equal(p.seats.length, 3);
      assert.equal(p.judge.id, 'judge-argon');
      assert.equal(p.judge.harness, 'antigravity');
      assert.equal(p.judge.model, 'gemini-4-argon-high');
      assert.match(p.judge.soul, /Impartial Consensus Judge/);

      const seatIds = p.seats.map((s) => s.id);
      assert.deepEqual(seatIds, ['argon-systems', 'argon-pragmatic', 'argon-skeptic']);

      for (const seat of p.seats) {
        assert.equal(seat.harness, 'antigravity');
        assert.equal(seat.model, 'gemini-4-argon-high');
        assert.ok(seat.soul && typeof seat.soul === 'string');
      }

      const souls = new Set(p.seats.map((s) => s.soul));
      assert.equal(souls.size, 3, 'All argon-only seats must have distinct souls');
    });

    it('ensures each preset validates under validateConfig', () => {
      for (const [name, preset] of Object.entries(COUNCIL_PRESETS)) {
        const fullConfig = {
          topic: `Test topic for ${name}`,
          maxRounds: 3,
          minQuorum: 2,
          maxClarificationBatches: 2,
          maxRetriesPerSeat: 1,
          judge: preset.judge,
          seats: preset.seats
        };
        const validation = validateConfig(fullConfig);
        assert.equal(validation.valid, true, `Preset ${name} failed validateConfig: ${validation.errors.join(', ')}`);
      }
    });
  });

  describe('Preset-Aware resolveConfig', () => {
    it('resolves preset by name and adopts its seats and judge', () => {
      const resolved = resolveConfig({ preset: 'architecture' });
      assert.equal(resolved.preset, 'architecture');
      assert.equal(resolved.judge.id, 'judge-opus');
      assert.equal(resolved.judge.model, 'claude-opus-5-5-high');
      assert.equal(resolved.seats.length, 4);
      assert.equal(resolved.seats[0].id, 'astra-systems');
    });

    it('merges user topic without clobbering preset seats or judge', () => {
      const resolved = resolveConfig({
        preset: 'product-comparison',
        topic: 'Best smartphone under R$ 1000'
      });
      assert.equal(resolved.preset, 'product-comparison');
      assert.equal(resolved.topic, 'Best smartphone under R$ 1000');
      assert.equal(resolved.judge.id, 'judge-opus');
      assert.equal(resolved.seats.length, 4);
      assert.equal(resolved.seats[3].id, 'grok-skeptic');
    });

    it('allows overriding specific options like maxRounds and minQuorum', () => {
      const resolved = resolveConfig({
        preset: 'security-audit',
        maxRounds: 5,
        minQuorum: 3
      });
      assert.equal(resolved.preset, 'security-audit');
      assert.equal(resolved.maxRounds, 5);
      assert.equal(resolved.minQuorum, 3);
      assert.equal(resolved.seats.length, 3);
    });

    it('allows explicit seat overrides to take precedence over preset seats', () => {
      const customSeats = [
        { id: 'custom-1', harness: 'mock', model: 'm1', soul: 's1' },
        { id: 'custom-2', harness: 'mock', model: 'm2', soul: 's2' }
      ];
      const resolved = resolveConfig({
        preset: 'architecture',
        seats: customSeats
      });
      assert.equal(resolved.seats.length, 2);
      assert.equal(resolved.seats[0].id, 'custom-1');
      // Preset judge is preserved
      assert.equal(resolved.judge.id, 'judge-opus');
    });

    it('allows explicit judge overrides to take precedence or merge', () => {
      const resolved = resolveConfig({
        preset: 'architecture',
        judge: { soul: 'Custom Overridden Judge Soul' }
      });
      assert.equal(resolved.judge.id, 'judge-opus');
      assert.equal(resolved.judge.harness, 'antigravity');
      assert.equal(resolved.judge.soul, 'Custom Overridden Judge Soul');
    });

    it('throws descriptive error on unknown preset name', () => {
      assert.throws(
        () => resolveConfig({ preset: 'invalid-name' }),
        (err) => {
          assert.equal(
            err.message,
            'Unknown preset "invalid-name". Available presets: architecture, product-comparison, security-audit, argon-only'
          );
          return true;
        }
      );
    });

    it('throws descriptive error when preset is non-string or empty', () => {
      assert.throws(
        () => resolveConfig({ preset: '' }),
        /Unknown preset ""\. Available presets: architecture, product-comparison, security-audit, argon-only/
      );
      assert.throws(
        () => resolveConfig({ preset: 123 }),
        /Unknown preset "123"\. Available presets: architecture, product-comparison, security-audit, argon-only/
      );
    });

    it('falls back to default roster and judge when preset is omitted', () => {
      const resolved = resolveConfig({});
      assert.equal(resolved.preset, undefined);
      assert.equal(resolved.judge.id, 'judge-astra');
      assert.equal(resolved.seats.length, 3);
      assert.equal(resolved.seats[0].id, 'astra-kernel');
    });

    it('preserves preset immutability during resolveConfig', () => {
      const resolved = resolveConfig({ preset: 'argon-only' });
      // Mutating resolved should not mutate preset
      assert.ok(Object.isFrozen(resolved));
      assert.notEqual(resolved.seats, COUNCIL_PRESETS['argon-only'].seats);
    });
  });

  describe('loadConfigFile with preset', () => {
    it('loads a JSON file specifying a preset', () => {
      const tmpFile = path.join(os.tmpdir(), `preset-config-${Date.now()}.json`);
      fs.writeFileSync(
        tmpFile,
        JSON.stringify({
          preset: 'argon-only',
          topic: 'Token-efficient consensus on cache eviction strategy'
        })
      );

      try {
        const resolved = loadConfigFile(tmpFile);
        assert.equal(resolved.preset, 'argon-only');
        assert.equal(resolved.topic, 'Token-efficient consensus on cache eviction strategy');
        assert.equal(resolved.judge.id, 'judge-argon');
        assert.equal(resolved.seats.length, 3);
        assert.equal(resolved.seats[0].id, 'argon-systems');
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });
  });
});
