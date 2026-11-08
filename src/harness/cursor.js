/**
 * @fileoverview Cursor Harness Adapter for The Council.
 * Connects to xAI Grok (grok-4.7-high, grok-4.7-xhigh) and Composer (composer-2.5)
 * via subscription Cursor route through Orca CLI/API per ADR 0002.
 * Strictly adheres to model-policy: Premium weekly pool only, zero paid overflow.
 */

import { HarnessAdapter, HarnessError, QuotaExhaustionError, HarnessExecutionError } from './adapter.js';
import { runCursorCli } from './cli-runner.js';
import {
  formatDeliberationPrompt,
  formatVotingPrompt,
  formatJudgePrompt as formatJudgeSoulPrompt
} from '../seats/soul.js';

export class CursorAdapter extends HarnessAdapter {
  constructor(config = {}) {
    super({ name: 'cursor', ...config });
    this.executable = config.executable || process.env.CURSOR_CLI_COMMAND || 'cursor-agent';
    this.spawnRunner = config.spawnRunner || runCursorCli;
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
    if (error instanceof HarnessError) {
      return error;
    }

    const raw = (error?.message || '') + ' ' + (error?.stderr || '');

    // Cursor weekly included pool exhaustion signature (reproducing wt-10-seats-quota)
    const isPoolExhausted =
      /\b429\b|weekly\s+included\s+pool\s+exhausted|weekly_pool_exhausted|subscription_pool_exhausted|rate_limit/i.test(
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
    const context = { seatId: seat.id, model: seat.model, tools: seat.tools || 'read-only' };

    return this.executeWithTimeout(
      async (signal) => {
        try {
          const prompt = this.formatSeatPrompt({ seat, soul, round, phase, state });
          const rawOutput = await this._dispatchCli({
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
      timeoutMs,
      context
    );
  }

  async executeJudge({ judge, round, phase, proofs, state, timeoutMs }) {
    this.validateModel(judge.model);
    const context = { seatId: judge.id, model: judge.model, tools: judge.tools || 'read-only' };

    return this.executeWithTimeout(
      async (signal) => {
        try {
          const prompt = this.formatJudgePrompt({ judge, round, phase, proofs, state });
          const rawOutput = await this._dispatchCli({
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
      timeoutMs,
      context
    );
  }

  formatSeatPrompt({ seat, soul, round, phase, state }) {
    if (phase === 'VOTING' || phase === 'confirming') {
      const admittedProofs = (state?.proofs || []).filter((p) => p.status === 'admitted');
      const myOpenObjections = (state?.objections || []).filter(
        (o) => o.seatId === seat.id && o.status === 'open'
      );
      return formatVotingPrompt({
        soul,
        seat,
        candidate: state?.candidate,
        admittedProofs,
        myOpenObjections,
        state
      });
    }

    const openObjections = (state?.objections || []).filter((o) => o.status === 'open');
    return formatDeliberationPrompt({
      soul,
      seat,
      topic: state?.topic,
      round,
      maxRounds: state?.maxRounds,
      clarifications: state?.clarifications,
      previousCandidate: state?.candidate,
      openObjections,
      state
    });
  }

  formatJudgePrompt({ judge, round, phase, proofs, state }) {
    return formatJudgeSoulPrompt({
      judge,
      topic: state?.topic,
      round,
      maxRounds: state?.maxRounds,
      proofs,
      state
    });
  }

  async _dispatchCli({ model, prompt, signal, context }) {
    if (this.spawnRunner) {
      return this.spawnRunner({ executable: this.executable, model, prompt, signal, context });
    }
    throw new HarnessExecutionError('Cursor CLI dispatcher runner not configured', {
      harness: this.name,
      ...context
    });
  }

  async _dispatchOrcaCli(params) {
    return this._dispatchCli(params);
  }
}
