/**
 * @fileoverview Cursor Harness Adapter for The Council.
 * Connects to xAI Grok (grok-4.7-high, grok-4.7-xhigh) and Composer (composer-2.5)
 * via subscription Cursor route through Orca CLI/API per ADR 0002.
 * Strictly adheres to model-policy: Premium weekly pool only, zero paid overflow.
 */

import { HarnessAdapter, HarnessError, QuotaExhaustionError, HarnessExecutionError } from './adapter.js';
import { runCursorCli, extractCanonicalBaseModel, parseModelAndEffort } from './cli-runner.js';
import {
  formatClarificationPrompt,
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
    this.killGraceMs = config.killGraceMs;
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
      error?.name === 'AbortError' ||
      error?.code === 'ABORT_ERR' ||
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

  async executeSeat({
    seat,
    soul,
    round,
    phase,
    state,
    timeoutMs,
    tools,
    telemetry,
    onCallRecord,
    cwd,
    rebuttalMode,
    mode,
    signal: callerSignal,
    abortDrainMs,
    killGraceMs,
    context: callerContext
  }) {
    this.validateModel(seat.model);
    const baseModel = extractCanonicalBaseModel(seat.model, 'high');
    const isClarification = phase === 'CLARIFICATION' || phase === 'clarifying';
    const isVoting = phase === 'VOTING' || phase === 'confirming';
    const isRebuttal =
      !isVoting &&
      !isClarification &&
      Boolean(
        rebuttalMode ||
          mode === 'rebuttal' ||
          callerContext?.rebuttalMode ||
          callerContext?.mode === 'rebuttal' ||
          seat?.rebuttalMode ||
          seat?.mode === 'rebuttal'
      );
    const effectiveReasoningEffort =
      baseModel === 'composer-2.5'
        ? undefined
        : (callerContext?.reasoningEffort ?? seat?.reasoningEffort);
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
    const externalSignal = callerSignal ?? callerContext?.signal;
    const effectiveAbortDrainMs = abortDrainMs ?? callerContext?.abortDrainMs;
    const effectiveKillGraceMs = killGraceMs ?? callerContext?.killGraceMs ?? this.killGraceMs;
    const context = {
      seatId: seat.id,
      model: seat.model,
      tools: effectiveTools,
      ...(effectiveReasoningEffort ? { reasoningEffort: effectiveReasoningEffort } : {}),
      ...(isRebuttal ? { rebuttalMode: true, mode: 'rebuttal' } : {}),
      ...(telemetry ? { telemetry } : {}),
      ...(onCallRecord ? { onCallRecord } : {}),
      ...(effectiveCwd ? { cwd: effectiveCwd } : {}),
      ...(externalSignal ? { signal: externalSignal } : {}),
      ...(effectiveAbortDrainMs !== undefined ? { abortDrainMs: effectiveAbortDrainMs } : {}),
      ...(effectiveKillGraceMs !== undefined ? { killGraceMs: effectiveKillGraceMs } : {})
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
            rebuttalMode: isRebuttal,
            mode: isRebuttal ? 'rebuttal' : mode,
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

          const schemaType = isClarification ? 'clarification' : (isVoting ? 'vote' : 'proof');
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

  async executeJudge({
    judge,
    round,
    phase,
    proofs,
    state,
    timeoutMs,
    tools,
    telemetry,
    onCallRecord,
    cwd,
    signal: callerSignal,
    abortDrainMs,
    killGraceMs,
    context: callerContext
  }) {
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
    const externalSignal = callerSignal ?? callerContext?.signal;
    const effectiveAbortDrainMs = abortDrainMs ?? callerContext?.abortDrainMs;
    const effectiveKillGraceMs = killGraceMs ?? callerContext?.killGraceMs ?? this.killGraceMs;
    const context = {
      seatId: judge.id,
      model: judge.model,
      tools: effectiveTools,
      ...(telemetry ? { telemetry } : {}),
      ...(onCallRecord ? { onCallRecord } : {}),
      ...(effectiveCwd ? { cwd: effectiveCwd } : {}),
      ...(externalSignal ? { signal: externalSignal } : {}),
      ...(effectiveAbortDrainMs !== undefined ? { abortDrainMs: effectiveAbortDrainMs } : {}),
      ...(effectiveKillGraceMs !== undefined ? { killGraceMs: effectiveKillGraceMs } : {})
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
                provider: 'cursor',
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

  formatSeatPrompt({ seat, soul, round, phase, state, tools, cwd, rebuttalMode, mode, context: callerContext }) {
    const isClarification = phase === 'CLARIFICATION' || phase === 'clarifying';
    const isVoting = phase === 'VOTING' || phase === 'confirming';
    const isRebuttal =
      !isVoting &&
      !isClarification &&
      Boolean(
        rebuttalMode ||
          mode === 'rebuttal' ||
          callerContext?.rebuttalMode ||
          callerContext?.mode === 'rebuttal' ||
          seat?.rebuttalMode ||
          seat?.mode === 'rebuttal'
      );
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
    if (isClarification) {
      return formatClarificationPrompt({
        soul,
        seat: effectiveSeat,
        topic: state?.topic || '',
        batch: round || state?.clarificationBatch || 1,
        maxBatches: state?.maxClarificationBatches || 1
      });
    }
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
      cwd: effectiveCwd,
      ...(isRebuttal ? { rebuttalMode: true, mode: 'rebuttal' } : {})
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
    throw new HarnessExecutionError('Cursor CLI dispatcher runner not configured', {
      harness: this.name,
      ...context
    });
  }

  async _dispatchOrcaCli(params) {
    return this._dispatchCli(params);
  }
}
