/**
 * @fileoverview Base Harness Adapter Interface and Error Taxonomy for The Council.
 * ESM Module (Node >= 22). Zero external dependencies.
 */

import { parseModelAndEffort, recordProviderCall, normalizeProviderTrace } from './cli-runner.js';

export const EFFORT_TIMEOUT_MAP = Object.freeze({
  max: 240000,
  xhigh: 240000,
  high: 120000,
  medium: 60000,
  low: 60000
});

export const DEFAULT_TIMEOUT_MS = 60000;

// ============================================================================
// ERROR TAXONOMY
// ============================================================================

/**
 * Base error class for all harness-related failures.
 */
export class HarnessError extends Error {
  /**
   * @param {string} message
   * @param {Object} [options]
   * @param {string} [options.harness='unknown']
   * @param {string} [options.seatId]
   * @param {string} [options.model]
   * @param {boolean} [options.isQuotaFault=false]
   * @param {boolean} [options.isRetryable=false]
   * @param {Error} [options.cause]
   */
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.harness = options.harness || 'unknown';
    this.seatId = options.seatId || null;
    this.model = options.model || null;
    this.isQuotaFault = Boolean(options.isQuotaFault);
    this.isRetryable = Boolean(options.isRetryable);
    this.timestamp = new Date().toISOString();
    if (options.cause) {
      this.cause = options.cause;
    }
    this.exitCode = options.exitCode ?? options.cause?.exitCode ?? null;
    this.stderr = options.stderr ?? options.cause?.stderr ?? '';
  }
}

/**
 * Thrown when a seat or judge encounters rate limits, token quotas,
 * or weekly subscription pool exhaustion (e.g. HTTP 429).
 */
export class QuotaExhaustionError extends HarnessError {
  /**
   * @param {string} message
   * @param {Object} [options]
   */
  constructor(message, options = {}) {
    super(message, {
      ...options,
      isQuotaFault: true,
      isRetryable: true // Retryable within maxRetriesPerSeat
    });
  }
}

/**
 * Thrown when an adapter execution exceeds the configured deadline.
 */
export class TimeoutError extends HarnessError {
  /**
   * @param {string} message
   * @param {Object} [options]
   * @param {number} [options.timeoutMs]
   */
  constructor(message, options = {}) {
    super(message, {
      ...options,
      isQuotaFault: false,
      isRetryable: true
    });
    this.timeoutMs = options.timeoutMs || null;
  }
}

/**
 * Thrown when an underlying process exits with non-zero code or unexpected stderr.
 */
export class HarnessExecutionError extends HarnessError {
  /**
   * @param {string} message
   * @param {Object} [options]
   * @param {number|null} [options.exitCode]
   * @param {string} [options.stderr]
   */
  constructor(message, options = {}) {
    super(message, {
      ...options,
      isQuotaFault: false,
      isRetryable: Boolean(options.isRetryable)
    });
    this.exitCode = options.exitCode ?? null;
    this.stderr = options.stderr || '';
    if (options.code) {
      this.code = options.code;
    }
    if (options.trace) {
      this.trace = options.trace;
    }
  }
}

/**
 * Thrown when the model returns unparseable or schema-violating output.
 */
export class InvalidResponseError extends HarnessError {
  /**
   * @param {string} message
   * @param {Object} [options]
   * @param {string} [options.rawResponse]
   * @param {string[]} [options.validationErrors]
   */
  constructor(message, options = {}) {
    super(message, {
      ...options,
      isQuotaFault: false,
      isRetryable: true
    });
    this.rawResponse = options.rawResponse || '';
    this.validationErrors = options.validationErrors || [];
  }
}

/**
 * Thrown when API or CLI authentication fails (HTTP 401/403).
 */
export class AuthenticationError extends HarnessError {
  /**
   * @param {string} message
   * @param {Object} [options]
   */
  constructor(message, options = {}) {
    super(message, {
      ...options,
      isQuotaFault: false,
      isRetryable: false
    });
  }
}

// ============================================================================
// ABSTRACT BASE HARNESS ADAPTER
// ============================================================================

/**
 * Abstract Base Class for Council Harness Adapters.
 */
export class HarnessAdapter {
  /**
   * @param {Object} [config]
   * @param {string} [config.name='base']
   * @param {number} [config.timeoutMs=60000]
   * @param {Function} [config.logger]
   */
  constructor(config = {}) {
    this.config = config;
    this.name = config.name || 'base';
    this.defaultTimeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.logger = config.logger || (() => {});
    this.cwd = config.cwd;
    this.initialized = false;
  }

  /**
   * Resolves execution timeout in milliseconds, dynamically scaling by model reasoning effort when unset.
   *
   * @param {string} [model] - Model string with optional effort (e.g. 'gpt-6-astra (max)')
   * @param {number} [explicitTimeoutMs] - Explicit timeout override
   * @returns {number} Timeout in milliseconds
   */
  resolveTimeoutMs(model, explicitTimeoutMs) {
    if (typeof explicitTimeoutMs === 'number' && explicitTimeoutMs > 0 && Number.isFinite(explicitTimeoutMs)) {
      return explicitTimeoutMs;
    }
    if (this.defaultTimeoutMs !== DEFAULT_TIMEOUT_MS) {
      return this.defaultTimeoutMs;
    }
    if (typeof model === 'string' && model.trim()) {
      const trimmed = model.trim().toLowerCase();
      const parenMatch = trimmed.match(/^([^(]+)\s*\(([^)]+)\)$/);
      if (parenMatch) {
        const effort = parenMatch[2].trim();
        if (EFFORT_TIMEOUT_MAP[effort]) {
          return EFFORT_TIMEOUT_MAP[effort];
        }
      }
      for (const suffix of ['-xhigh', '-max', '-high', '-medium', '-low']) {
        if (trimmed.endsWith(suffix)) {
          const effort = suffix.slice(1);
          if (EFFORT_TIMEOUT_MAP[effort]) {
            return EFFORT_TIMEOUT_MAP[effort];
          }
        }
      }
    }
    return this.defaultTimeoutMs;
  }

  /**
   * Initialize adapter resources, verify executable/API connectivity.
   * @returns {Promise<void>}
   */
  async initialize() {
    this.initialized = true;
  }

  /**
   * Teardown adapter resources, close open handles or processes.
   * @returns {Promise<void>}
   */
  async shutdown() {
    this.initialized = false;
  }

  /**
   * Perform a lightweight health check.
   * @returns {Promise<{ ok: boolean, latencyMs?: number, error?: string }>}
   */
  async healthCheck() {
    return { ok: this.initialized };
  }

  /**
   * Execute a seat turn in the council debate.
   * Dispatches proof submission in DELIBERATION or vote casting in VOTING.
   *
   * @param {Object} params
   * @param {Object} params.seat - Seat configuration object { id, model, soul, ... }
   * @param {string} params.soul - Soul temperament and domain instructions
   * @param {number} params.round - Current deliberation round index
   * @param {string} params.phase - Current canonical council phase
   * @param {Object} params.state - Current council state snapshot
   * @param {number} [params.timeoutMs] - Optional execution timeout override
   * @returns {Promise<Object>} Execution result (proof payload, vote payload, or clarification)
   */
  async executeSeat(params) {
    throw new Error(`executeSeat must be implemented by subclass ${this.constructor.name}`);
  }

  /**
   * Helper alias to execute proof submission for a seat.
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async executeSeatProof(params) {
    return this.executeSeat({ ...params, phase: params.phase || 'DELIBERATION' });
  }

  /**
   * Helper alias to execute vote casting for a seat.
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async executeSeatVote(params) {
    return this.executeSeat({ ...params, phase: params.phase || 'VOTING' });
  }

  /**
   * Execute a judge turn in the council debate.
   * Audits submitted proofs and synthesizes proof-bound candidate clauses.
   *
   * @param {Object} params
   * @param {Object} params.judge - Judge configuration object { id, model, soul, ... }
   * @param {number} params.round - Current deliberation round index
   * @param {string} [params.phase] - Current canonical council phase
   * @param {Array<Object>} params.proofs - Proofs submitted for auditing
   * @param {Object} params.state - Current council state snapshot
   * @param {number} [params.timeoutMs] - Optional execution timeout override
   * @returns {Promise<Object>} Synthesis payload { summary, proofDecisions, clauses }
   */
  async executeJudge(params) {
    throw new Error(`executeJudge must be implemented by subclass ${this.constructor.name}`);
  }

  /**
   * Helper alias to execute judge audit and candidate synthesis.
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async executeJudgeAuditAndSynthesis(params) {
    return this.executeJudge({ ...params, phase: params.phase || 'JUDGE_AUDIT_SYNTHESIS' });
  }

  /**
   * Execute an async operation with strict timeout boundary.
   *
   * @template T
   * @param {(signal: AbortSignal) => Promise<T>} fn
   * @param {number} [timeoutMs]
   * @param {Object} [context]
   * @returns {Promise<T>}
   */
  async executeWithTimeout(fn, timeoutMs, context = {}) {
    const effectiveTimeoutMs = this.resolveTimeoutMs(context.model, timeoutMs);
    const controller = new AbortController();
    let timer;

    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new TimeoutError(
            `Harness "${this.name}" execution timed out after ${effectiveTimeoutMs}ms for seat "${context.seatId || 'unknown'}"`,
            {
              harness: this.name,
              seatId: context.seatId,
              model: context.model,
              timeoutMs: effectiveTimeoutMs
            }
          )
        );
        controller.abort();
      }, effectiveTimeoutMs);
    });

    try {
      return await Promise.race([fn(controller.signal), timeoutPromise]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Safely records provider call telemetry via cli-runner.
   *
   * @param {Object} params
   */
  recordProviderCall(params) {
    recordProviderCall(params);
  }

  /**
   * Template method: Classifies a raw error into the canonical error taxonomy.
   *
   * @param {Error|any} error
   * @param {Object} [context]
   * @returns {HarnessError}
   */
  classifyError(error, context = {}) {
    if (error instanceof HarnessError) {
      return error;
    }

    const msg = error?.message || String(error);
    const raw = `${msg} ${error?.stderr || ''}`;

    // Forbidden .council/ state access guard
    if (
      error?.code === 'FORBIDDEN_STATE_ACCESS' ||
      error?.trace?.forbiddenStateAccess === true ||
      /\[ForbiddenStateAccessError\]/i.test(msg)
    ) {
      return new HarnessExecutionError(msg, {
        harness: this.name,
        seatId: context.seatId,
        model: context.model,
        exitCode: typeof error?.exitCode === 'number' ? error.exitCode : null,
        stderr: error?.stderr || '',
        code: 'FORBIDDEN_STATE_ACCESS',
        trace: error?.trace || null,
        isRetryable: true,
        cause: error
      });
    }

    // Timeout pattern
    if (
      error?.name === 'TimeoutError' ||
      error?.code === 'ETIMEDOUT' ||
      (error?.killed && error?.signal === 'SIGTERM') ||
      /\btimed?\s*out\b/i.test(raw)
    ) {
      return new TimeoutError(msg, {
        harness: this.name,
        seatId: context.seatId,
        model: context.model,
        timeoutMs: error?.timeoutMs || null,
        cause: error
      });
    }

    // Authentication / HTTP 401/403 pattern
    if (/\b(?:401|403)\b|unauthorized|authentication\s+failed|invalid[\s_-]*api[\s_-]*key/i.test(raw)) {
      return new AuthenticationError(msg, {
        harness: this.name,
        seatId: context.seatId,
        model: context.model,
        exitCode: error?.exitCode ?? error?.code ?? error?.status ?? null,
        stderr: error?.stderr || '',
        cause: error
      });
    }

    // Common HTTP 429 / Quota pattern
    if (/\b429\b|\bquota\b|rate[\s_-]*limit|resource_exhausted/i.test(raw)) {
      return new QuotaExhaustionError(msg, {
        harness: this.name,
        seatId: context.seatId,
        model: context.model,
        cause: error
      });
    }

    // Process execution error
    if (error?.code || error?.status || error?.exitCode) {
      return new HarnessExecutionError(msg, {
        harness: this.name,
        seatId: context.seatId,
        model: context.model,
        exitCode: error.exitCode || error.code || error.status,
        stderr: error.stderr || '',
        trace: error?.trace || null,
        cause: error
      });
    }

    return new HarnessExecutionError(msg, {
      harness: this.name,
      seatId: context.seatId,
      model: context.model,
      trace: error?.trace || null,
      cause: error
    });
  }

  /**
   * Extracts and parses JSON from raw LLM output, stripping markdown fences.
   *
   * @param {string} rawText
   * @param {'proof'|'vote'|'judge_synthesis'|'clarification'} schemaType
   * @returns {Object}
   */
  parseStructuredOutput(rawText, schemaType) {
    if (rawText && typeof rawText === 'object' && rawText.trace && typeof rawText.trace === 'object') {
      const normalizedTrace = normalizeProviderTrace(rawText.trace);
      if (normalizedTrace.forbiddenStateAccess) {
        const err = new Error(
          `[ForbiddenStateAccessError] Seat attempted to access forbidden .council/ state artifact: ${normalizedTrace.forbiddenAccessDetails.join(', ')}`
        );
        err.code = 'FORBIDDEN_STATE_ACCESS';
        err.trace = normalizedTrace;
        throw err;
      }
    }

    const resolvedText =
      rawText && typeof rawText === 'object'
        ? (typeof rawText.text === 'string'
          ? rawText.text
          : (typeof rawText.rawOutput === 'string' ? rawText.rawOutput : null))
        : rawText;
    if (typeof resolvedText !== 'string' || !resolvedText.trim()) {
      throw new InvalidResponseError('Model output was empty or not a string', {
        harness: this.name,
        rawResponse: String(resolvedText ?? rawText)
      });
    }

    const trimmed = resolvedText.trim();

    // 1. Search for all markdown code blocks (```(?:json)? ... ```)
    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g;
    const codeBlocks = [];
    let match;
    while ((match = codeBlockRegex.exec(trimmed)) !== null) {
      codeBlocks.push(match[1].trim());
    }

    // Evaluate code blocks in reverse (last block first, since final answer is placed at end)
    for (let i = codeBlocks.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(codeBlocks[i]);
        const errors = this._validatePayloadSchema(parsed, schemaType);
        if (errors.length === 0) {
          return parsed;
        }
      } catch {
        // Not valid JSON in this block, continue
      }
    }

    // 2. Extract balanced JSON objects from raw text (handles tool chatter preceding output)
    const candidates = [];
    let braceDepth = 0;
    let startIndex = -1;
    let inString = false;
    let escape = false;

    for (let i = 0; i < trimmed.length; i++) {
      const char = trimmed[i];

      if (inString) {
        if (escape) {
          escape = false;
        } else if (char === '\\') {
          escape = true;
        } else if (char === '"') {
          inString = false;
        }
      } else {
        if (char === '"') {
          inString = true;
        } else if (char === '{') {
          if (braceDepth === 0) {
            startIndex = i;
          }
          braceDepth++;
        } else if (char === '}') {
          braceDepth--;
          if (braceDepth === 0 && startIndex !== -1) {
            candidates.push(trimmed.substring(startIndex, i + 1));
            startIndex = -1;
          } else if (braceDepth < 0) {
            braceDepth = 0;
            startIndex = -1;
          }
        }
      }
    }

    // Test extracted candidates in reverse order
    let lastParsedObj = null;
    let lastValidationError = null;

    for (let i = candidates.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(candidates[i]);
        const errors = this._validatePayloadSchema(parsed, schemaType);
        if (errors.length === 0) {
          return parsed;
        }
        if (!lastParsedObj) {
          lastParsedObj = parsed;
          lastValidationError = errors;
        }
      } catch {
        // Candidate was not valid JSON
      }
    }

    // 3. Fallback: If we parsed a valid JSON object that failed schema validation, report schema errors
    if (lastParsedObj && lastValidationError) {
      throw new InvalidResponseError(
        `Model response violates ${schemaType} schema: ${lastValidationError.join('; ')}`,
        {
          harness: this.name,
          rawResponse: rawText,
          validationErrors: lastValidationError
        }
      );
    }

    // 4. Fallback: If single code block was present but had invalid JSON
    if (codeBlocks.length > 0) {
      try {
        JSON.parse(codeBlocks[codeBlocks.length - 1]);
      } catch (err) {
        throw new InvalidResponseError(`Failed to parse model JSON: ${err.message}`, {
          harness: this.name,
          rawResponse: rawText,
          cause: err
        });
      }
    }

    // 5. Direct parse fallback
    try {
      const direct = JSON.parse(trimmed);
      const errors = this._validatePayloadSchema(direct, schemaType);
      if (errors.length > 0) {
        throw new InvalidResponseError(
          `Model response violates ${schemaType} schema: ${errors.join('; ')}`,
          {
            harness: this.name,
            rawResponse: rawText,
            validationErrors: errors
          }
        );
      }
      return direct;
    } catch (err) {
      if (err instanceof InvalidResponseError) throw err;
      throw new InvalidResponseError(`Failed to parse model JSON: ${err.message}`, {
        harness: this.name,
        rawResponse: rawText,
        cause: err
      });
    }
  }

  /**
   * Internal schema validator for parsed responses.
   * @private
   */
  _validatePayloadSchema(data, schemaType) {
    const errors = [];
    if (!data || typeof data !== 'object') {
      return ['Response payload must be a non-null object'];
    }

    switch (schemaType) {
      case 'proof':
        if (!data.scope || typeof data.scope !== 'string' || !data.scope.trim()) {
          errors.push('"scope" condition is required.');
        }
        if (!['check', 'citation', 'benchmark', 'derivation'].includes(data.kind)) {
          errors.push('"kind" must be check, citation, benchmark, or derivation.');
        }
        if (!data.source || typeof data.source !== 'string' || !data.source.trim()) {
          errors.push('verifiable "source" is required; bare opinions are forbidden.');
        }
        if (!data.statement || typeof data.statement !== 'string' || !data.statement.trim()) {
          errors.push('falsifiable "statement" is required.');
        }
        break;

      case 'vote':
        if (!['accept', 'object'].includes(data.vote)) {
          errors.push('"vote" must be "accept" or "object".');
        }
        if (data.vote === 'object') {
          if (!data.reason || typeof data.reason !== 'string' || !data.reason.trim()) {
            errors.push('An objection requires a concrete "reason".');
          }
          if (!data.proofId && !data.backingProof) {
            errors.push('An objection must cite a "proofId" or provide a "backingProof".');
          }
        }
        break;

      case 'judge_synthesis':
        if (!data.summary || typeof data.summary !== 'string') {
          errors.push('Candidate "summary" is required.');
        }
        if (!Array.isArray(data.clauses) || data.clauses.length === 0) {
          errors.push('Candidate requires at least one clause.');
        } else {
          data.clauses.forEach((c, idx) => {
            if (!c.context || typeof c.context !== 'string') {
              errors.push(`Clause ${idx + 1} requires a "context" string.`);
            }
            if (!c.conclusion || typeof c.conclusion !== 'string') {
              errors.push(`Clause ${idx + 1} requires a "conclusion" string.`);
            }
            if (!Array.isArray(c.citedProofIds) || c.citedProofIds.length === 0) {
              errors.push(`Clause ${idx + 1} must cite at least one Proof ID.`);
            }
          });
        }
        break;
    }

    return errors;
  }
}
