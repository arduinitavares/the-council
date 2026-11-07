/**
 * @fileoverview Codex Harness Adapter for The Council.
 * Connects to OpenAI models (gpt-6.1-sol, gpt-6-astra) via Orca CLI/API per ADR 0002.
 * Adheres strictly to the Orca CLI/API-only boundary (no desktop GUI, no native dialogs).
 */

import { HarnessAdapter, QuotaExhaustionError, HarnessExecutionError } from './adapter.js';

export class CodexAdapter extends HarnessAdapter {
  /**
   * @param {Object} [config]
   * @param {string} [config.executable='orca'] - Resolved Orca binary placeholder
   * @param {number} [config.timeoutMs=90000]
   * @param {Function} [config.spawnRunner] - Dependency injection for process execution
   */
  constructor(config = {}) {
    super({ name: 'codex', ...config });
    this.executable = config.executable || process.env.ORCA_CLI_COMMAND || 'orca';
    this.spawnRunner = config.spawnRunner || null;
  }

  /**
   * Verify model admissibility under model-policy.md.
   * @param {string} model
   */
  validateModel(model) {
    const normalized = (model || '').toLowerCase();
    const isSol = normalized.includes('gpt-6.1-sol');
    const isAstra = normalized.includes('gpt-6-astra');
    if (!isSol && !isAstra) {
      throw new HarnessExecutionError(
        `Model "${model}" is not permitted under Codex route. Allowed: gpt-6.1-sol, gpt-6-astra.`,
        { harness: this.name, model }
      );
    }
  }

  /**
   * Classify Codex/OpenAI error output.
   * @param {Error|any} error
   * @param {Object} [context]
   */
  classifyError(error, context = {}) {
    const raw = (error?.message || '') + ' ' + (error?.stderr || '');

    // OpenAI Quota / Rate limit patterns
    const isQuota =
      /429|insufficient_quota|rate_limit_exceeded|tokens_per_minute_exceeded|requests_per_minute_exceeded|usage_limit_reached|quota\s+exceeded/i.test(
        raw
      );

    if (isQuota) {
      return new QuotaExhaustionError(
        error.message || `OpenAI rate limit or token quota exhausted on Codex harness`,
        {
          harness: this.name,
          seatId: context.seatId,
          model: context.model,
          cause: error
        }
      );
    }

    return super.classifyError(error, context);
  }

  /**
   * Execute seat turn on Codex.
   */
  async executeSeat({ seat, soul, round, phase, state, timeoutMs }) {
    this.validateModel(seat.model);
    const context = { seatId: seat.id, model: seat.model };

    return this.executeWithTimeout(
      async (signal) => {
        try {
          const prompt = this.formatSeatPrompt({ seat, soul, round, phase, state });
          const rawOutput = await this._dispatchOrcaCli({
            model: seat.model,
            prompt,
            signal,
            context
          });

          const schemaType = phase === 'VOTING' || phase === 'confirming' ? 'vote' : 'proof';
          return this.parseStructuredOutput(rawOutput, schemaType);
        } catch (err) {
          throw this.classifyError(err, context);
        }
      },
      timeoutMs || this.defaultTimeoutMs,
      context
    );
  }

  /**
   * Execute judge turn on Codex.
   */
  async executeJudge({ judge, round, phase, proofs, state, timeoutMs }) {
    this.validateModel(judge.model);
    const context = { seatId: judge.id, model: judge.model };

    return this.executeWithTimeout(
      async (signal) => {
        try {
          const prompt = this.formatJudgePrompt({ judge, round, phase, proofs, state });
          const rawOutput = await this._dispatchOrcaCli({
            model: judge.model,
            prompt,
            signal,
            context
          });

          return this.parseStructuredOutput(rawOutput, 'judge_synthesis');
        } catch (err) {
          throw this.classifyError(err, context);
        }
      },
      timeoutMs || this.defaultTimeoutMs,
      context
    );
  }

  /**
   * Formats seat prompt with soul temperament injection.
   */
  formatSeatPrompt({ seat, soul, round, phase, state }) {
    return [
      `### THE COUNCIL — DELIBERATION ROUND ${round}`,
      `Topic: ${state?.topic || ''}`,
      `Your Seat ID: ${seat.id}`,
      `Your Soul: ${soul}`,
      `Current Phase: ${phase}`,
      '',
      phase === 'VOTING' || phase === 'confirming'
        ? `Evaluate the Judge's candidate statement:\n${JSON.stringify(state?.candidate, null, 2)}\nReturn JSON: { "vote": "accept" } OR { "vote": "object", "reason": "...", "proofId": "..." }`
        : `Submit a structured Proof addressing the Topic based on your Soul.\nReturn JSON: { "scope": "...", "kind": "check|citation|benchmark|derivation", "source": "...", "statement": "..." }`
    ].join('\n');
  }

  /**
   * Formats judge prompt for auditing and candidate synthesis.
   */
  formatJudgePrompt({ judge, round, phase, proofs, state }) {
    return [
      `### THE COUNCIL — JUDGE AUDIT AND SYNTHESIS ROUND ${round}`,
      `Topic: ${state?.topic || ''}`,
      `Judge ID: ${judge.id}`,
      `Judge Soul: ${judge.soul}`,
      `Submitted Proofs to Audit:\n${JSON.stringify(proofs, null, 2)}`,
      '',
      `Enforce: Every candidate clause MUST cite >= 1 admitted Proof IDs. No unsubstantiated opinions.`,
      `Return JSON: { "summary": "...", "proofDecisions": { "P1": { "status": "admitted|rejected", "note": "..." } }, "clauses": [ { "context": "...", "conclusion": "...", "citedProofIds": ["P1"] } ] }`
    ].join('\n');
  }

  /**
   * Internal CLI execution via Orca.
   * @private
   */
  async _dispatchOrcaCli({ model, prompt, signal, context }) {
    if (this.spawnRunner) {
      return this.spawnRunner({ executable: this.executable, model, prompt, signal, context });
    }
    // Fallback stub: In production, spawns `orca worker` / CLI API without GUI.
    throw new HarnessExecutionError('Orca CLI dispatcher runner not configured', {
      harness: this.name,
      ...context
    });
  }
}
