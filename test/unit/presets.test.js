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
      assert.equal(solPrag.model, 'gpt-6.1-sol (high)');
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
      assert.equal(grok.model, 'grok-4.7-high');
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

    it('ensures every judge and seat in every built-in preset and default config passes its live adapter validateModel (Issue #16)', async () => {
      const { HarnessRegistry } = await import('../../src/harness/index.js');
      const registry = new HarnessRegistry();

      for (const [presetName, preset] of Object.entries(COUNCIL_PRESETS)) {
        const judgeAdapter = registry.get(preset.judge.harness);
        assert.doesNotThrow(
          () => judgeAdapter.validateModel(preset.judge.model),
          `Preset "${presetName}" judge "${preset.judge.id}" (${preset.judge.harness} / ${preset.judge.model}) must pass validateModel`
        );

        for (const seat of preset.seats) {
          const seatAdapter = registry.get(seat.harness);
          assert.doesNotThrow(
            () => seatAdapter.validateModel(seat.model),
            `Preset "${presetName}" seat "${seat.id}" (${seat.harness} / ${seat.model}) must pass validateModel`
          );
        }
      }

      // Also verify default config when no preset is specified
      const defaultResolved = resolveConfig({});
      assert.doesNotThrow(() => registry.get(defaultResolved.judge.harness).validateModel(defaultResolved.judge.model));
      for (const seat of defaultResolved.seats) {
        assert.doesNotThrow(() => registry.get(seat.harness).validateModel(seat.model));
      }

      // Verify validateModel also rejects invalid effort tiers and substring-spoofed model names
      assert.throws(() => registry.get('codex').validateModel('gpt-6-astra (ultra)'), /Unsupported reasoning effort/);
      assert.throws(() => registry.get('codex').validateModel('not-gpt-6-astra-high'), /not permitted under Codex route/);
      assert.throws(() => registry.get('antigravity').validateModel('gemini-4-argon (bogus)'), /Unsupported reasoning effort/);
      assert.throws(() => registry.get('antigravity').validateModel('not-gemini-4-argon-high'), /not permitted under Antigravity route/);
      assert.throws(() => registry.get('cursor').validateModel('grok-4.7 (ultra)'), /Unsupported reasoning effort/);
      assert.throws(() => registry.get('cursor').validateModel('composer-2.5 (high)'), /not permitted under Cursor route/);

      // Also verify skills/ask-council/SKILL.md matches COUNCIL_PRESETS models and contains no rejected models
      const skillPath = path.resolve(import.meta.dirname, '../../skills/ask-council/SKILL.md');
      const skillContent = fs.readFileSync(skillPath, 'utf8');
      assert.doesNotMatch(skillContent, /gpt-5-sol/);
      assert.doesNotMatch(skillContent, /grok-4-skeptic/);
      for (const preset of Object.values(COUNCIL_PRESETS)) {
        assert.ok(skillContent.includes(preset.judge.model), `SKILL.md must include judge model ${preset.judge.model}`);
        for (const seat of preset.seats) {
          assert.ok(skillContent.includes(seat.model), `SKILL.md must include seat model ${seat.model}`);
        }
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

    it('rejects prototype properties (toString, valueOf, constructor) as preset names', () => {
      for (const key of ['toString', 'valueOf', 'constructor', '__proto__']) {
        assert.throws(
          () => resolveConfig({ preset: key }),
          new RegExp(`Unknown preset "${key}"\\. Available presets: architecture, product-comparison, security-audit, argon-only`)
        );
      }
    });

    it('rejects Symbol presets with clean Unknown preset error', () => {
      assert.throws(
        () => resolveConfig({ preset: Symbol('arch') }),
        /Unknown preset "Symbol\(arch\)"\. Available presets: architecture, product-comparison, security-audit, argon-only/
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

    it('resolves configs/best-of-families.json, best-of-families.json, and -p best-of-families when process.cwd() is an external directory (#27)', () => {
      const prevCwd = process.cwd();
      const tmpExtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'council-ext-cwd-'));
      try {
        process.chdir(tmpExtDir);

        const fromRelConfig = loadConfigFile('configs/best-of-families.json', {
          topic: 'External CWD relative configs path'
        });
        assert.equal(fromRelConfig.topic, 'External CWD relative configs path');
        assert.equal(fromRelConfig.judge.id, 'judge-astra');
        assert.deepEqual(
          fromRelConfig.seats.map((s) => s.id),
          ['sol-voter', 'argon-voter', 'carbon-voter', 'opus-voter', 'grok-voter']
        );

        const fromShortName = loadConfigFile('best-of-families.json', {
          topic: 'External CWD short filename'
        });
        assert.equal(fromShortName.judge.id, 'judge-astra');
        assert.equal(fromShortName.seats.length, 5);

        const fromBareName = loadConfigFile('best-of-families', {
          topic: 'External CWD bare config name'
        });
        assert.equal(fromBareName.judge.id, 'judge-astra');
        assert.equal(fromBareName.seats.length, 5);

        const fromPreset = resolveConfig({
          preset: 'best-of-families',
          topic: 'External CWD preset best-of-families'
        });
        assert.equal(fromPreset.preset, 'best-of-families');
        assert.equal(fromPreset.topic, 'External CWD preset best-of-families');
        assert.equal(fromPreset.judge.id, 'judge-astra');
        assert.deepEqual(
          fromPreset.seats.map((s) => s.id),
          ['sol-voter', 'argon-voter', 'carbon-voter', 'opus-voter', 'grok-voter']
        );
      } finally {
        process.chdir(prevCwd);
        fs.rmSync(tmpExtDir, { recursive: true, force: true });
      }
    });

    it('resolves best-of-families with all 5 voter seats including carbon-voter (gemini-4-carbon-high) and verifies live adapter and skill parity (#75)', async () => {
      const { HarnessRegistry } = await import('../../src/harness/index.js');
      const registry = new HarnessRegistry();

      const resolved = resolveConfig({ preset: 'best-of-families', topic: 'Test' });
      assert.equal(resolved.seats.length, 5);
      assert.deepEqual(
        resolved.seats.map((s) => s.id),
        ['sol-voter', 'argon-voter', 'carbon-voter', 'opus-voter', 'grok-voter']
      );

      const carbonSeat = resolved.seats.find((s) => s.id === 'carbon-voter');
      assert.ok(carbonSeat, 'carbon-voter must exist in best-of-families');
      assert.equal(carbonSeat.harness, 'antigravity');
      assert.equal(carbonSeat.model, 'gemini-4-carbon-high');
      assert.deepEqual(carbonSeat.soul, {
        name: 'Principal Formal & Analytical Verifier',
        temperament: 'analytical',
        lens: 'Formal logic, causal rigor, algorithmic invariants, and quantitative trade-off verification.',
        rules: [
          'Verify that every causal claim follows strictly from primary evidence or mathematical/structural invariants.',
          'Challenge unstated assumptions, conflated definitions, and under-specified boundary conditions.'
        ]
      });

      const validation = validateConfig(resolved);
      assert.equal(validation.valid, true, `best-of-families failed validateConfig: ${validation.errors.join(', ')}`);

      assert.doesNotThrow(() => registry.get(resolved.judge.harness).validateModel(resolved.judge.model));
      for (const seat of resolved.seats) {
        assert.doesNotThrow(
          () => registry.get(seat.harness).validateModel(seat.model),
          `best-of-families seat "${seat.id}" (${seat.harness} / ${seat.model}) must pass validateModel`
        );
      }

      const skillPath = path.resolve(import.meta.dirname, '../../skills/ask-council/SKILL.md');
      const agentSkillPath = path.resolve(import.meta.dirname, '../../.agents/skills/ask-council/SKILL.md');
      const skillContent = fs.readFileSync(skillPath, 'utf8');
      const agentSkillContent = fs.readFileSync(agentSkillPath, 'utf8');
      assert.equal(skillContent, agentSkillContent, 'skills/ask-council/SKILL.md and .agents/skills/ask-council/SKILL.md must stay in sync');
      assert.ok(skillContent.includes('carbon-voter'), 'SKILL.md must document carbon-voter');
      assert.ok(skillContent.includes('gemini-4-carbon-high'), 'SKILL.md must document gemini-4-carbon-high');
    });
  });
});
