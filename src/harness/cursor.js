/**
 * @fileoverview Cursor Harness Adapter for The Council.
 * Connects to xAI Grok (grok-4.7-high, grok-4.7-xhigh) and Composer (composer-2.5)
 * via subscription Cursor route through Orca CLI/API per ADR 0002.
 * Strictly adheres to model-policy: Premium weekly pool only, zero paid overflow.
 */

import { HarnessAdapter, QuotaExhaustionError, HarnessExecutionError } from './adapter.js';

export class CursorAdapter extends HarnessAdapter {
  constructor(config = {}) {
    super({ name: 'cursor', ...config });
    this.executable = config.executable || process.env.ORCA_CLI_COMMAND || 'orca';
    this.spawnRunner = config.spawnRunner || null;
  }

  validateModel(model) {
    const normalized = (model || '').toLowerCase();
    const isGrok = normalized.includes('grok-4.7');
    const isComposer = normalized.includes('composer-2.5');

    if (!isGrok && !isComposer) {
      throw new HarnessExecutionError(
        `Model "${model}" is not permitted under Cursor route. Allowed: grok-4.7-high, grok-4.7-xhigh, composer-2.5.`,
        { harness: this.name, model }
      );
    }
  }

  classifyError(error, context = {}) {
    const raw = (error?.message || '') + ' ' + (error?.stderr || '');

    // Cursor weekly included pool exhaustion signature (reproducing wt-10-seats-quota)
    const isPoolExhausted =
      /429|weekly\s+included\s+pool\s+exhausted|weekly_pool_exhausted|subscription_pool_exhausted|rate_limit/i.test(
        raw
      );

    if (isPoolExhausted) {
      return new QuotaExhaustionError(
        error.message || `Cursor weekly included pool exhausted (HTTP 429)`,
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
      `### THE COUNCIL (CURSOR HARNESS) — ROUND ${round}`,
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
      `### THE COUNCIL (CURSOR HARNESS) — JUDGE ROUND ${round}`,
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
    throw new HarnessExecutionError('Cursor CLI dispatcher runner not configured', {
      harness: this.name,
      ...context
    });
  }
}
