/**
 * @fileoverview Antigravity (AGY) Harness Adapter for The Council.
 * Connects to Google Gemini (gemini-4-argon-high) and Anthropic Claude
 * (claude-sonnet-5-5-*, claude-opus-5-5-*) via Orca CLI/API per ADR 0002.
 */

import { HarnessAdapter, QuotaExhaustionError, HarnessExecutionError } from './adapter.js';

export class AntigravityAdapter extends HarnessAdapter {
  /**
   * @param {Object} [config]
   */
  constructor(config = {}) {
    super({ name: 'antigravity', ...config });
    this.executable = config.executable || process.env.ORCA_CLI_COMMAND || 'orca';
    this.spawnRunner = config.spawnRunner || null;
  }

  validateModel(model) {
    const normalized = (model || '').toLowerCase();
    const isGeminiArgon = normalized.includes('gemini-4-argon');
    const isClaudeSonnet = normalized.includes('claude-sonnet-5-5');
    const isClaudeOpus = normalized.includes('claude-opus-5-5');

    if (!isGeminiArgon && !isClaudeSonnet && !isClaudeOpus) {
      throw new HarnessExecutionError(
        `Model "${model}" is not permitted under Antigravity route. Allowed: gemini-4-argon-high, claude-sonnet-5-5-*, claude-opus-5-5-*.`,
        { harness: this.name, model }
      );
    }
  }

  classifyError(error, context = {}) {
    const raw = (error?.message || '') + ' ' + (error?.stderr || '');

    // Gemini and Claude quota & rate limit signatures
    const isQuota =
      /429|resource_exhausted|rate_limit_error|overloaded_error|quota\s+window\s+exhausted|token_budget_exceeded|quota\s+exceeded/i.test(
        raw
      );

    if (isQuota) {
      return new QuotaExhaustionError(
        error.message || `Antigravity quota limit or rate window exhausted`,
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

  formatSeatPrompt({ seat, soul, round, phase, state }) {
    return [
      `### THE COUNCIL (ANTIGRAVITY HARNESS) — ROUND ${round}`,
      `Topic: ${state?.topic || ''}`,
      `Seat: ${seat.id} (${seat.model})`,
      `Soul: ${soul}`,
      `Phase: ${phase}`,
      '',
      phase === 'VOTING' || phase === 'confirming'
        ? `Review candidate and return JSON: { "vote": "accept" } OR { "vote": "object", "reason": "...", "proofId": "..." }`
        : `Submit structured proof. Return JSON: { "scope": "...", "kind": "check|citation|benchmark|derivation", "source": "...", "statement": "..." }`
    ].join('\n');
  }

  formatJudgePrompt({ judge, round, phase, proofs, state }) {
    return [
      `### THE COUNCIL (ANTIGRAVITY HARNESS) — JUDGE ROUND ${round}`,
      `Topic: ${state?.topic || ''}`,
      `Judge: ${judge.id}`,
      `Soul: ${judge.soul}`,
      `Proofs: ${JSON.stringify(proofs, null, 2)}`,
      `Return JSON: { "summary": "...", "proofDecisions": { ... }, "clauses": [ ... ] }`
    ].join('\n');
  }

  async _dispatchOrcaCli({ model, prompt, signal, context }) {
    if (this.spawnRunner) {
      return this.spawnRunner({ executable: this.executable, model, prompt, signal, context });
    }
    throw new HarnessExecutionError('Antigravity CLI dispatcher runner not configured', {
      harness: this.name,
      ...context
    });
  }
}
