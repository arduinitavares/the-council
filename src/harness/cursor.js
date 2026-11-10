/**
 * @fileoverview Cursor Harness Adapter for The Council.
 * Connects to xAI Grok (grok-4.7-high, grok-4.7-xhigh) and Composer (composer-2.5)
 * via subscription Cursor route through Orca CLI/API per ADR 0002.
 * Strictly adheres to model-policy: Premium weekly pool only, zero paid overflow.
 */

import { HarnessAdapter, HarnessError, QuotaExhaustionError, HarnessExecutionError } from './adapter.js';
import { runCursorCli, extractCanonicalBaseModel, parseModelAndEffort } from './cli-runner.js';
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
    this.cwd = config.cwd;
  }

  validateModel(model) {
    let baseModel;
    let parsed;
    try {
      parsed = parseModelAndEffort(model, 'high');
      baseModel = extractCanonicalBaseModel(model, 'high');
    } catch (err) {
      throw new HarnessExecutionError(err.message, { harness: this.name, model, cause: err });
    }

    const rawTrimmedLower = String(model || '').trim().toLowerCase();
    const ALLOWED_GROK_EFFORTS = new Set(['high', 'xhigh', 'medium', 'low']);
    const isGrok = baseModel === 'grok-4.7' && ALLOWED_GROK_EFFORTS.has(parsed.effort);
    const isComposer = baseModel === 'composer-2.5' && rawTrimmedLower === 'composer-2.5';

    if (!isGrok && !isComposer) {
      throw new HarnessExecutionError(
        `Model "${model}" is not permitted under Cursor route. Allowed: grok-4.7-high, grok-4.7-xhigh, grok-4.7-medium, grok-4.7-low, composer-2.5.`,
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

  async executeSeat({ seat, soul, round, phase, state, timeoutMs, telemetry, onCallRecord, cwd, context: callerContext }) {
    this.validateModel(seat.model);
    const effectiveCwd = [cwd, callerContext?.cwd, seat?.cwd, state?.cwd, this.cwd, this.config?.cwd]
      .find((c) => typeof c === 'string' && c.trim())
      ?.trim();
    const context = {
      seatId: seat.id,
      model: seat.model,
      tools: seat.tools || 'read-only',
      ...(telemetry ? { telemetry } : {}),
      ...(onCallRecord ? { onCallRecord } : {}),
      ...(effectiveCwd ? { cwd: effectiveCwd } : {})
    };

    return this.executeWithTimeout(
      async (signal) => {
        try {
          const prompt = this.formatSeatPrompt({ seat, soul, round, phase, state, cwd: effectiveCwd });
          const rawOutput = await this._dispatchCli({
            model: seat.model,
            prompt,
            signal,
            context,
            ...(effectiveCwd ? { cwd: effectiveCwd } : {})
          });

          const schemaType = phase === 'VOTING' || phase === 'confirming' ? 'vote' : 'proof';
          return this.parseStructuredOutput(rawOutput, schemaType);
        } catch (err) {
          if (err?.trace && !err._providerCallRecorded) {
            this.recordProviderCall({
              context,
              onCallRecord,
              record: {
                participantId: context.seatId,
                provider: 'cursor',
                model: context.model,
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

  async executeJudge({ judge, round, phase, proofs, state, timeoutMs, telemetry, onCallRecord, cwd, context: callerContext }) {
    this.validateModel(judge.model);
    const effectiveCwd = [cwd, callerContext?.cwd, judge?.cwd, state?.cwd, this.cwd, this.config?.cwd]
      .find((c) => typeof c === 'string' && c.trim())
      ?.trim();
    const context = {
      seatId: judge.id,
      model: judge.model,
      tools: judge.tools || 'read-only',
      ...(telemetry ? { telemetry } : {}),
      ...(onCallRecord ? { onCallRecord } : {}),
      ...(effectiveCwd ? { cwd: effectiveCwd } : {})
    };

    return this.executeWithTimeout(
      async (signal) => {
        try {
          const prompt = this.formatJudgePrompt({ judge, round, phase, proofs, state, cwd: effectiveCwd });
          const rawOutput = await this._dispatchCli({
            model: judge.model,
            prompt,
            signal,
            context,
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
                provider: 'cursor',
                model: context.model,
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

  formatSeatPrompt({ seat, soul, round, phase, state, cwd, context: callerContext }) {
    const effectiveCwd = [cwd, callerContext?.cwd, seat?.cwd, state?.cwd, this.cwd, this.config?.cwd]
      .find((c) => typeof c === 'string' && c.trim())
      ?.trim();
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
        state,
        cwd: effectiveCwd
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
      state,
      cwd: effectiveCwd
    });
  }

  formatJudgePrompt({ judge, round, phase, proofs, state, cwd, context: callerContext }) {
    const effectiveCwd = [cwd, callerContext?.cwd, judge?.cwd, state?.cwd, this.cwd, this.config?.cwd]
      .find((c) => typeof c === 'string' && c.trim())
      ?.trim();
    return formatJudgeSoulPrompt({
      judge,
      topic: state?.topic,
      round,
      maxRounds: state?.maxRounds,
      proofs,
      state,
      cwd: effectiveCwd
    });
  }

  async _dispatchCli({ model, prompt, signal, context, cwd }) {
    if (this.spawnRunner) {
      const effectiveCwd = [cwd, context?.cwd, this.cwd, this.config?.cwd]
        .find((c) => typeof c === 'string' && c.trim())
        ?.trim();
      return this.spawnRunner({
        executable: this.executable,
        model,
        prompt,
        signal,
        context,
        ...(effectiveCwd ? { cwd: effectiveCwd } : {})
      });
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
