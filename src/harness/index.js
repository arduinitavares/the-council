/**
 * @fileoverview Unified Entrypoint and Factory for Council Harness Adapters.
 * ESM Module (Node >= 22).
 */

import {
  HarnessAdapter,
  HarnessError,
  QuotaExhaustionError,
  TimeoutError,
  HarnessExecutionError,
  InvalidResponseError,
  AuthenticationError
} from './adapter.js';

import { CodexAdapter } from './codex.js';
import { AntigravityAdapter } from './antigravity.js';
import { CursorAdapter } from './cursor.js';
import { MockAdapter } from './mock.js';

export {
  HarnessAdapter,
  HarnessError,
  QuotaExhaustionError,
  TimeoutError,
  HarnessExecutionError,
  InvalidResponseError,
  AuthenticationError,
  CodexAdapter,
  AntigravityAdapter,
  CursorAdapter,
  MockAdapter
};

/**
 * Registry of registered harness adapter classes.
 */
const ADAPTER_REGISTRY = {
  codex: CodexAdapter,
  antigravity: AntigravityAdapter,
  cursor: CursorAdapter,
  mock: MockAdapter
};

/**
 * Factory function to create or resolve a harness adapter instance.
 *
 * @param {'codex'|'antigravity'|'cursor'|'mock'|string} harnessType
 * @param {Object} [options]
 * @returns {HarnessAdapter}
 */
export function createHarnessAdapter(harnessType, options = {}) {
  const normType = (harnessType || 'mock').toLowerCase();
  const AdapterClass = ADAPTER_REGISTRY[normType];

  if (!AdapterClass) {
    throw new HarnessExecutionError(`Unknown harness adapter type "${harnessType}".`, {
      harness: harnessType
    });
  }

  return new AdapterClass(options);
}

/**
 * HarnessRegistry manages cached adapter instances per council run.
 */
export class HarnessRegistry {
  constructor(defaultOptions = {}) {
    this.defaultOptions = defaultOptions;
    this.instances = new Map();
  }

  /**
   * Get or instantiate an adapter for a given harness type.
   * @param {string} harnessType
   * @param {Object} [overrideOptions]
   * @returns {HarnessAdapter}
   */
  get(harnessType, overrideOptions = {}) {
    const key = (harnessType || 'mock').toLowerCase();
    if (!this.instances.has(key)) {
      const adapter = createHarnessAdapter(key, {
        ...this.defaultOptions,
        ...overrideOptions
      });
      this.instances.set(key, adapter);
    }
    return this.instances.get(key);
  }

  /**
   * Register a custom or mock adapter for a given harness key.
   * @param {string} harnessType
   * @param {HarnessAdapter} adapterInstance
   */
  register(harnessType, adapterInstance) {
    const key = (harnessType || '').toLowerCase();
    this.instances.set(key, adapterInstance);
  }

  /**
   * Shutdown all cached adapter instances.
   */
  async shutdownAll() {
    for (const adapter of this.instances.values()) {
      await adapter.shutdown();
    }
    this.instances.clear();
  }
}
