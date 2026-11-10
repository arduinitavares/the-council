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
    this.cwd = config.cwd;
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

    if (
      error?.code === 'FORBIDDEN_STATE_ACCESS' ||
      error?.trace?.forbiddenStateAccess === true ||
      /\[ForbiddenStateAccessError\]/i.test(error?.message || '')
    ) {
      return super.classifyError(error, context);
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

  async executeSeat({ seat, soul, round, phase, state, timeoutMs, tools, telemetry, onCallRecord, cwd, context: callerContext }) {
    this.validateModel(seat.model);
    const isVoting = phase === 'VOTING' || phase === 'confirming';
    const effectiveTools =
      tools === 'none' || callerContext?.tools === 'none'
        ? 'none'
        : (tools ??
            callerContext?.tools ??
            (isVoting ? seat?.votingTools ?? seat?.tools : seat?.tools) ??
            'read-only');
    const effectiveCwd =
      effectiveTools === 'none'
        ? undefined
        : [cwd, callerContext?.cwd, seat?.cwd, state?.cwd, this.cwd, this.config?.cwd]
            .find((c) => typeof c === 'string' && c.trim())
            ?.trim();
    const effectiveSeat = {
      ...seat,
      tools: effectiveTools,
      ...(effectiveTools === 'none' ? { cwd: undefined } : {})
    };
    const context = {
      seatId: seat.id,
      model: seat.model,
      tools: effectiveTools,
      ...(telemetry ? { telemetry } : {}),
      ...(onCallRecord ? { onCallRecord } : {}),
      ...(effectiveCwd ? { cwd: effectiveCwd } : {})
    };

    return this.executeWithTimeout(
      async (signal) => {
        try {
          const prompt = this.formatSeatPrompt({
            seat: effectiveSeat,
            soul,
            round,
            phase,
            state,
            tools: effectiveTools,
            cwd: effectiveCwd,
            context
          });
          const rawOutput = await this._dispatchCli({
            model: seat.model,
            prompt,
            signal,
            context,
            tools: effectiveTools,
            ...(effectiveCwd ? { cwd: effectiveCwd } : {})
          });

          const schemaType = isVoting ? 'vote' : 'proof';
          return this.parseStructuredOutput(rawOutput, schemaType);
        } catch (err) {
          if (err?.trace && !err._providerCallRecorded) {
            this.recordProviderCall({
              context,
              onCallRecord,
              record: {
                participantId: context.seatId,
                provider: 'antigravity',
                model: context.model,
                tools: effectiveTools,
                exitCode: typeof err.exitCode === 'number' ? err.exitCode : 1,
                durationMs: typeof err.trace.durationMs === 'number' ? err.trace.durationMs : 0,
                trace: { ...err.trace, outcome: 'error' }
              }
            });
            err._providerCallRecorded = true;
          }
          throw this.classifyError(err, context);
        }
      },
      timeoutMs,
      context
    );
  }

  async executeJudge({ judge, round, phase, proofs, state, timeoutMs, tools, telemetry, onCallRecord, cwd, context: callerContext }) {
    this.validateModel(judge.model);
    const effectiveTools =
      tools === 'none' || callerContext?.tools === 'none'
        ? 'none'
        : (tools ?? callerContext?.tools ?? judge?.tools ?? 'read-only');
    const effectiveCwd =
      effectiveTools === 'none'
        ? undefined
        : [cwd, callerContext?.cwd, judge?.cwd, state?.cwd, this.cwd, this.config?.cwd]
            .find((c) => typeof c === 'string' && c.trim())
            ?.trim();
    const effectiveJudge = {
      ...judge,
      tools: effectiveTools,
      ...(effectiveTools === 'none' ? { cwd: undefined } : {})
    };
    const context = {
      seatId: judge.id,
      model: judge.model,
      tools: effectiveTools,
      ...(telemetry ? { telemetry } : {}),
      ...(onCallRecord ? { onCallRecord } : {}),
      ...(effectiveCwd ? { cwd: effectiveCwd } : {})
    };

    return this.executeWithTimeout(
      async (signal) => {
        try {
          const prompt = this.formatJudgePrompt({
            judge: effectiveJudge,
            round,
            phase,
            proofs,
            state,
            tools: effectiveTools,
            cwd: effectiveCwd,
            context
          });
          const rawOutput = await this._dispatchCli({
            model: judge.model,
            prompt,
            signal,
            context,
            tools: effectiveTools,
            ...(effectiveCwd ? { cwd: effectiveCwd } : {})
          });

          return this.parseStructuredOutput(rawOutput, 'judge_synthesis');
        } catch (err) {
          if (err?.trace && !err._providerCallRecorded) {
            this.recordProviderCall({
              context,
              onCallRecord,
              record: {
                participantId: context.seatId,
                provider: 'antigravity',
                model: context.model,
                tools: effectiveTools,
                exitCode: typeof err.exitCode === 'number' ? err.exitCode : 1,
                durationMs: typeof err.trace.durationMs === 'number' ? err.trace.durationMs : 0,
                trace: { ...err.trace, outcome: 'error' }
              }
            });
            err._providerCallRecorded = true;
          }
          throw this.classifyError(err, context);
        }
      },
      timeoutMs,
      context
    );
  }

  formatSeatPrompt({ seat, soul, round, phase, state, tools, cwd, context: callerContext }) {
    const isVoting = phase === 'VOTING' || phase === 'confirming';
    const effectiveTools =
      tools === 'none' || callerContext?.tools === 'none'
        ? 'none'
        : (tools ??
            callerContext?.tools ??
            (isVoting ? seat?.votingTools ?? seat?.tools : seat?.tools) ??
            'read-only');
    const effectiveCwd =
      effectiveTools === 'none'
        ? undefined
        : [cwd, callerContext?.cwd, seat?.cwd, state?.cwd, this.cwd, this.config?.cwd]
            .find((c) => typeof c === 'string' && c.trim())
            ?.trim();
    const effectiveSeat = seat
      ? { ...seat, tools: effectiveTools, ...(effectiveTools === 'none' ? { cwd: undefined } : {}) }
      : seat;
    if (isVoting) {
      const admittedProofs = (state?.proofs || []).filter(
        (p) => p.status === 'admitted' || p.status === 'partially_admitted'
      );
      const myOpenObjections = (state?.objections || []).filter(
        (o) => o.seatId === seat.id && o.status === 'open'
      );
      return formatVotingPrompt({
        soul,
        seat: effectiveSeat,
        candidate: state?.candidate,
        admittedProofs,
        myOpenObjections,
        state,
        tools: effectiveTools,
        cwd: effectiveCwd
      });
    }

    const openObjections = (state?.objections || []).filter((o) => o.status === 'open');
    return formatDeliberationPrompt({
      soul,
      seat: effectiveSeat,
      topic: state?.topic,
      round,
      maxRounds: state?.maxRounds,
      clarifications: state?.clarifications,
      previousCandidate: state?.candidate,
      openObjections,
      state,
      tools: effectiveTools,
      cwd: effectiveCwd
    });
  }

  formatJudgePrompt({ judge, round, phase, proofs, state, tools, cwd, context: callerContext }) {
    const effectiveTools =
      tools === 'none' || callerContext?.tools === 'none'
        ? 'none'
        : (tools ?? callerContext?.tools ?? judge?.tools ?? 'read-only');
    const effectiveCwd =
      effectiveTools === 'none'
        ? undefined
        : [cwd, callerContext?.cwd, judge?.cwd, state?.cwd, this.cwd, this.config?.cwd]
            .find((c) => typeof c === 'string' && c.trim())
            ?.trim();
    const effectiveJudge = judge
      ? { ...judge, tools: effectiveTools, ...(effectiveTools === 'none' ? { cwd: undefined } : {}) }
      : judge;
    return formatJudgeSoulPrompt({
      judge: effectiveJudge,
      topic: state?.topic,
      round,
      maxRounds: state?.maxRounds,
      proofs,
      state,
      tools: effectiveTools,
      cwd: effectiveCwd
    });
  }

  async _dispatchCli({ model, prompt, signal, context, tools, cwd }) {
    if (this.spawnRunner) {
      const effectiveTools =
        tools === 'none' || context?.tools === 'none'
          ? 'none'
          : (tools ?? context?.tools ?? 'read-only');
      const effectiveCwd =
        effectiveTools === 'none'
          ? undefined
          : [cwd, context?.cwd, this.cwd, this.config?.cwd]
              .find((c) => typeof c === 'string' && c.trim())
              ?.trim();
      return this.spawnRunner({
        executable: this.executable,
        model,
        prompt,
        signal,
        context,
        tools: effectiveTools,
        ...(effectiveCwd ? { cwd: effectiveCwd } : {})
      });
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
