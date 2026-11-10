import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CursorAdapter } from '../../src/harness/cursor.js';

describe('Unit: CursorAdapter Validation (Milestone M5 / Issue #72)', () => {
  const adapter = new CursorAdapter();

  describe('validateModel with downshifted voting efforts', () => {
    it('permits grok-4.7-low and grok-4.7-medium downshifted models', () => {
      assert.doesNotThrow(() => adapter.validateModel('grok-4.7-low'));
      assert.doesNotThrow(() => adapter.validateModel('grok-4.7-medium'));
    });

    it('permits grok-4.7-high, grok-4.7-xhigh, and composer-2.5', () => {
      assert.doesNotThrow(() => adapter.validateModel('grok-4.7-high'));
      assert.doesNotThrow(() => adapter.validateModel('grok-4.7-xhigh'));
      assert.doesNotThrow(() => adapter.validateModel('composer-2.5'));
    });

    it('handles model case-insensitivity', () => {
      assert.doesNotThrow(() => adapter.validateModel('GROK-4.7-LOW'));
      assert.doesNotThrow(() => adapter.validateModel('Grok-4.7-Medium'));
      assert.doesNotThrow(() => adapter.validateModel('COMPOSER-2.5'));
    });

    it('rejects unsupported reasoning effort tiers like grok-4.7-max', () => {
      assert.throws(
        () => adapter.validateModel('grok-4.7-max'),
        (err) => {
          assert.match(err.message, /Model "grok-4.7-max" is not permitted under Cursor route/);
          assert.match(
            err.message,
            /Allowed: grok-4.7-high, grok-4.7-xhigh, grok-4.7-medium, grok-4.7-low, composer-2.5\./
          );
          return true;
        }
      );
    });

    it('rejects effort suffixes attached to composer-2.5', () => {
      assert.throws(
        () => adapter.validateModel('composer-2.5-high'),
        (err) => {
          assert.match(err.message, /Model "composer-2.5-high" is not permitted under Cursor route/);
          return true;
        }
      );
      assert.throws(
        () => adapter.validateModel('composer-2.5-low'),
        (err) => {
          assert.match(err.message, /Model "composer-2.5-low" is not permitted under Cursor route/);
          return true;
        }
      );
    });

    it('rejects models outside the Cursor admitted lineage', () => {
      const unauthorized = [
        'gpt-6-astra (max)',
        'gpt-6.1-sol (high)',
        'gemini-4-argon-high',
        'claude-opus-5-5-high',
        'llama-3.1-70b'
      ];
      for (const m of unauthorized) {
        assert.throws(
          () => adapter.validateModel(m),
          /is not permitted under Cursor route/
        );
      }
    });
  });
});
