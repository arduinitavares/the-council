/**
 * @fileoverview Codex Harness Adapter for The Council.
 * Connects to OpenAI models (gpt-6.1-sol, gpt-6-astra) via Orca CLI/API per ADR 0002.
 * Adheres strictly to the Orca CLI/API-only boundary (no desktop GUI, no native dialogs).
 */

import { HarnessAdapter, HarnessError, QuotaExhaustionError, HarnessExecutionError } from './adapter.js';
import { runCodexCli, parseModelAndEffort } from './cli-runner.js';
import {
  formatDeliberationPrompt,
  formatVotingPrompt,
  formatJudgePrompt as formatJudgeSoulPrompt
} from '../seats/soul.js';

const EFFORT_SUFFIXES = ['-max', '-xhigh', '-high', '-medium', '-low'];

export class CodexAdapter extends HarnessAdapter {
  /**
   * @param {Object} [config]
   * @param {string} [config.executable='codex'] - CLI executable name or path
   * @param {number} [config.timeoutMs=90000]
   * @param {Function} [config.spawnRunner] - Dependency injection for process execution
   */
  constructor(config = {}) {
    super({ name: 'codex', ...config });
    this.executable = config.executable || process.env.CODEX_CLI_COMMAND || 'codex';
    this.spawnRunner = config.spawnRunner || runCodexCli;
    this.disableHooks = config.disableHooks;
    this.ignoreUserConfig = config.ignoreUserConfig;
  }

  /**
   * Verify model admissibility under model-policy.md.
   * @param {string} model
   */
  validateModel(model) {
    let parsed;
    try {
      parsed = parseModelAndEffort(model, 'high');
    } catch (err) {
      throw new HarnessExecutionError(err.message, { harness: this.name, model, cause: err });
    }

    const hasParens = /\([^)]*\)\s*$/.test(String(model || '').trim());
    let baseModel = parsed.model.trim().toLowerCase();
    if (!hasParens) {
      for (const suffix of EFFORT_SUFFIXES) {
        if (baseModel.endsWith(suffix)) {
          baseModel = baseModel.slice(0, -suffix.length);
          break;
        }
      }
    }

    const isSol = baseModel === 'gpt-6.1-sol';
    const isAstra = baseModel === 'gpt-6-astra';
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
    if (error instanceof HarnessError) {
      return error;
    }

    const raw = (error?.message || '') + ' ' + (error?.stderr || '');

    // OpenAI Quota / Rate limit patterns
    const isQuota =
      /\b429\b|insufficient_quota|rate_limit_exceeded|tokens_per_minute_exceeded|requests_per_minute_exceeded|usage_limit_reached|quota\s+exceeded/i.test(
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
  async executeSeat({ seat, soul, round, phase, state, timeoutMs, telemetry, onCallRecord }) {
    this.validateModel(seat.model);
    const disableHooks = seat.disableHooks !== undefined ? seat.disableHooks : this.disableHooks;
    const ignoreUserConfig = seat.ignoreUserConfig !== undefined ? seat.ignoreUserConfig : this.ignoreUserConfig;
    const context = {
      seatId: seat.id,
      model: seat.model,
      tools: seat.tools || 'read-only',
      ...(telemetry ? { telemetry } : {}),
      ...(onCallRecord ? { onCallRecord } : {}),
      ...(disableHooks !== undefined ? { disableHooks } : {}),
      ...(ignoreUserConfig !== undefined ? { ignoreUserConfig } : {})
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

  /**
   * Execute judge turn on Codex.
   */
  async executeJudge({ judge, round, phase, proofs, state, timeoutMs, telemetry, onCallRecord }) {
    this.validateModel(judge.model);
    const disableHooks = judge.disableHooks !== undefined ? judge.disableHooks : this.disableHooks;
    const ignoreUserConfig = judge.ignoreUserConfig !== undefined ? judge.ignoreUserConfig : this.ignoreUserConfig;
    const context = {
      seatId: judge.id,
      model: judge.model,
      tools: judge.tools || 'read-only',
      ...(telemetry ? { telemetry } : {}),
      ...(onCallRecord ? { onCallRecord } : {}),
      ...(disableHooks !== undefined ? { disableHooks } : {}),
      ...(ignoreUserConfig !== undefined ? { ignoreUserConfig } : {})
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

  /**
   * Formats seat prompt with soul temperament injection.
   */
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

  /**
   * Formats judge prompt for auditing and candidate synthesis.
   */
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

  /**
   * Internal CLI execution via direct runner.
   * @private
   */
  async _dispatchCli({ model, prompt, signal, context }) {
    if (this.spawnRunner) {
      return this.spawnRunner({ executable: this.executable, model, prompt, signal, context });
    }
    throw new HarnessExecutionError('Codex CLI dispatcher runner not configured', {
      harness: this.name,
      ...context
    });
  }

  async _dispatchOrcaCli(params) {
    return this._dispatchCli(params);
  }
}
