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
  AuthenticationError,
  HeadlessToolDeniedError,
  PROVIDER_HTTP_429_REGEX,
  PROVIDER_HTTP_AUTH_REGEX,
  resolveAttemptExecutionWorkspace,
  captureAttemptInvocationMeta
} from './adapter.js';

import { CodexAdapter } from './codex.js';
import { AntigravityAdapter } from './antigravity.js';
import { CursorAdapter } from './cursor.js';
import { MockAdapter } from './mock.js';
import { T3McpClient } from './t3-mcp-client.js';
import { loginT3OAuth, logoutT3OAuth, getT3AuthStatus } from './t3-oauth.js';
import { T3HarnessAdapter } from './t3.js';

export const VALID_HARNESS_BACKENDS = Object.freeze(['cli', 't3']);

export {
  HarnessAdapter,
  HarnessError,
  QuotaExhaustionError,
  TimeoutError,
  HarnessExecutionError,
  InvalidResponseError,
  AuthenticationError,
  HeadlessToolDeniedError,
  PROVIDER_HTTP_429_REGEX,
  PROVIDER_HTTP_AUTH_REGEX,
  resolveAttemptExecutionWorkspace,
  captureAttemptInvocationMeta,
  CodexAdapter,
  AntigravityAdapter,
  CursorAdapter,
  MockAdapter,
  T3McpClient,
  T3HarnessAdapter,
  loginT3OAuth,
  logoutT3OAuth,
  getT3AuthStatus
};

/**
 * Registry of registered harness adapter classes.
 */
const ADAPTER_REGISTRY = {
  codex: CodexAdapter,
  antigravity: AntigravityAdapter,
  cursor: CursorAdapter,
  mock: MockAdapter,
  t3: T3HarnessAdapter
};

const T3_LOGICAL_PROVIDERS = new Set(['codex', 'antigravity', 'cursor']);

export function resolveHarnessBackend(explicitBackend, env = process.env) {
  const raw =
    explicitBackend !== undefined && explicitBackend !== null && String(explicitBackend).trim() !== ''
      ? String(explicitBackend).trim().toLowerCase()
      : (typeof env?.COUNCIL_HARNESS_BACKEND === 'string' && env.COUNCIL_HARNESS_BACKEND.trim()
          ? env.COUNCIL_HARNESS_BACKEND.trim().toLowerCase()
          : 'cli');
  if (!VALID_HARNESS_BACKENDS.includes(raw)) {
    throw new HarnessExecutionError(
      `Unknown harness backend "${raw}". Allowed: ${VALID_HARNESS_BACKENDS.join(', ')}.`,
      { harness: raw }
    );
  }
  return raw;
}

/**
 * Factory function to create or resolve a harness adapter instance.
 *
 * @param {'codex'|'antigravity'|'cursor'|'mock'|'t3'|string} harnessType
 * @param {Object} [options]
 * @returns {HarnessAdapter}
 */
export function createHarnessAdapter(harnessType, options = {}) {
  const normType = (harnessType || 'mock').toLowerCase();
  if (normType === 'mock') {
    return new MockAdapter(options);
  }
  const backend = resolveHarnessBackend(options.backend);
  if (normType === 't3' || (backend === 't3' && T3_LOGICAL_PROVIDERS.has(normType))) {
    const provider = normType === 't3' ? (options.provider || 'codex') : normType;
    return new T3HarnessAdapter({ ...options, name: provider, provider });
  }
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
    this.backend = resolveHarnessBackend(defaultOptions.backend);
    this._sharedT3Client = defaultOptions.mcpClient || null;
    this._ownsSharedT3Client = false;
    this.instances = new Map();
  }

  _getSharedT3Client(overrideOptions = {}) {
    if (overrideOptions.mcpClient) return overrideOptions.mcpClient;
    if (!this._sharedT3Client) {
      this._sharedT3Client = new T3McpClient({
        url: overrideOptions.url ?? this.defaultOptions.url,
        token: overrideOptions.token ?? this.defaultOptions.token,
        tokenStorePath: overrideOptions.tokenStorePath ?? this.defaultOptions.tokenStorePath,
        headers: overrideOptions.headers ?? this.defaultOptions.headers,
        fetchImpl: overrideOptions.fetchImpl ?? this.defaultOptions.fetchImpl,
        callTool: overrideOptions.callTool ?? this.defaultOptions.callTool
      });
      this._ownsSharedT3Client = true;
    }
    return this._sharedT3Client;
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
      const effectiveBackend = resolveHarnessBackend(overrideOptions.backend ?? this.backend);
      const usesSharedT3 = key === 't3' || (effectiveBackend === 't3' && T3_LOGICAL_PROVIDERS.has(key));
      const mergedOptions = {
        ...this.defaultOptions,
        ...overrideOptions,
        backend: effectiveBackend,
        ...(usesSharedT3 ? { mcpClient: this._getSharedT3Client(overrideOptions) } : {})
      };
      const adapter = createHarnessAdapter(key, mergedOptions);
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
    if (this._ownsSharedT3Client && this._sharedT3Client) {
      await this._sharedT3Client.close();
      this._sharedT3Client = null;
      this._ownsSharedT3Client = false;
    }
  }
}
