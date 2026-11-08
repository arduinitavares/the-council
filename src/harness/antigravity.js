/**
 * @fileoverview Antigravity (AGY) Harness Adapter for The Council.
 * Connects to Google Gemini (gemini-4-argon-high) and Anthropic Claude
 * (claude-sonnet-5-5-*, claude-opus-5-5-*) via Orca CLI/API per ADR 0002.
 */

import { HarnessAdapter, HarnessError, QuotaExhaustionError, HarnessExecutionError } from './adapter.js';
import { runAntigravityCli, extractCanonicalBaseModel } from './cli-runner.js';
import {
  formatDeliberationPrompt,
  formatVotingPrompt,
  formatJudgePrompt as formatJudgeSoulPrompt
} from '../seats/soul.js';

export class AntigravityAdapter extends HarnessAdapter {
  /**
   * @param {Object} [config]
   */
  constructor(config = {}) {
    super({ name: 'antigravity', ...config });
    this.executable = config.executable || process.env.AGY_CLI_COMMAND || 'agy';
    this.spawnRunner = config.spawnRunner || runAntigravityCli;
  }

  validateModel(model) {
    let baseModel;
    try {
      baseModel = extractCanonicalBaseModel(model, 'high');
    } catch (err) {
      throw new HarnessExecutionError(err.message, { harness: this.name, model, cause: err });
    }

    if (/^claude-(sonnet|opus)-5-5-\d{8}$/.test(baseModel)) {
      baseModel = baseModel.slice(0, -9);
    }

    const isGeminiArgon = baseModel === 'gemini-4-argon';
    const isClaudeSonnet = baseModel === 'claude-sonnet-5-5';
    const isClaudeOpus = baseModel === 'claude-opus-5-5';

    if (!isGeminiArgon && !isClaudeSonnet && !isClaudeOpus) {
      throw new HarnessExecutionError(
        `Model "${model}" is not permitted under Antigravity route. Allowed: gemini-4-argon-high, claude-sonnet-5-5-*, claude-opus-5-5-*.`,
        { harness: this.name, model }
      );
    }
  }

  classifyError(error, context = {}) {
    if (error instanceof HarnessError) {
      return error;
    }

    const raw = (error?.message || '') + ' ' + (error?.stderr || '');

    // Gemini and Claude quota & rate limit signatures
    const isQuota =
      /\b429\b|resource_exhausted|rate_limit_error|overloaded_error|quota\s+window\s+exhausted|token_budget_exceeded|quota\s+exceeded/i.test(
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

  async executeSeat({ seat, soul, round, phase, state, timeoutMs, telemetry, onCallRecord }) {
    this.validateModel(seat.model);
    const context = {
      seatId: seat.id,
      model: seat.model,
      tools: seat.tools || 'read-only',
      ...(telemetry ? { telemetry } : {}),
      ...(onCallRecord ? { onCallRecord } : {})
    };

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

  async executeJudge({ judge, round, phase, proofs, state, timeoutMs, telemetry, onCallRecord }) {
    this.validateModel(judge.model);
    const context = {
      seatId: judge.id,
      model: judge.model,
      tools: judge.tools || 'read-only',
      ...(telemetry ? { telemetry } : {}),
      ...(onCallRecord ? { onCallRecord } : {})
    };

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
    throw new HarnessExecutionError('Antigravity CLI dispatcher runner not configured', {
      harness: this.name,
      ...context
    });
  }

  async _dispatchOrcaCli(params) {
    return this._dispatchCli(params);
  }
}
