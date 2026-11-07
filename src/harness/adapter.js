/**
 * @fileoverview Base Harness Adapter Interface and Error Taxonomy for The Council.
 * ESM Module (Node >= 22). Zero external dependencies.
 */

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
      isRetryable: false
    });
    this.exitCode = options.exitCode ?? null;
    this.stderr = options.stderr || '';
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
    this.name = config.name || 'base';
    this.defaultTimeoutMs = config.timeoutMs || 60000;
    this.logger = config.logger || (() => {});
    this.initialized = false;
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
  async executeWithTimeout(fn, timeoutMs = this.defaultTimeoutMs, context = {}) {
    const controller = new AbortController();
    let timer;

    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(
          new TimeoutError(
            `Harness "${this.name}" execution timed out after ${timeoutMs}ms for seat "${context.seatId || 'unknown'}"`,
            {
              harness: this.name,
              seatId: context.seatId,
              model: context.model,
              timeoutMs
            }
          )
        );
      }, timeoutMs);
    });

    try {
      return await Promise.race([fn(controller.signal), timeoutPromise]);
    } finally {
      clearTimeout(timer);
    }
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

    // Common HTTP 429 / Quota pattern
    if (/429|quota|rate\s*limit|resource_exhausted/i.test(msg)) {
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
        cause: error
      });
    }

    return new HarnessExecutionError(msg, {
      harness: this.name,
      seatId: context.seatId,
      model: context.model,
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
    if (typeof rawText !== 'string' || !rawText.trim()) {
      throw new InvalidResponseError('Model output was empty or not a string', {
        harness: this.name,
        rawResponse: String(rawText)
      });
    }

    let cleaned = rawText.trim();

    // 1. Strip markdown code block fences if present
    const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      cleaned = codeBlockMatch[1].trim();
    } else {
      // 2. Extract outermost JSON object or array if surrounded by chatter
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleaned = cleaned.substring(firstBrace, lastBrace + 1);
      }
    }

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      throw new InvalidResponseError(`Failed to parse model JSON: ${err.message}`, {
        harness: this.name,
        rawResponse: rawText,
        cause: err
      });
    }

    // 3. Structural schema validation
    const errors = this._validatePayloadSchema(parsed, schemaType);
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

    return parsed;
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
