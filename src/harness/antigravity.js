/**
 * @fileoverview Antigravity (AGY) Harness Adapter for The Council.
 * Connects to Google Gemini (gemini-4-argon-*, gemini-4-carbon-*) and Anthropic Claude
 * (claude-sonnet-5-5-*, claude-opus-5-5-*) via Orca CLI/API per ADR 0002.
 */

import {
  HarnessAdapter,
  QuotaExhaustionError,
  HarnessExecutionError,
  PROVIDER_HTTP_429_REGEX,
  resolveAttemptExecutionWorkspace,
  captureAttemptInvocationMeta,
  registerAttemptPrompt,
  isReservedClassificationError
} from './adapter.js';
import { runAntigravityCli, extractCanonicalBaseModel } from './cli-runner.js';
import {
  formatClarificationPrompt,
  formatDeliberationPrompt,
  formatVotingPrompt,
  formatJudgePrompt as formatJudgeSoulPrompt,
  resolvePriorAdmittedProofs
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
    this.killGraceMs = config.killGraceMs;
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
    const isGeminiCarbon = baseModel === 'gemini-4-carbon';
    const isClaudeSonnet = baseModel === 'claude-sonnet-5-5';
    const isClaudeOpus = baseModel === 'claude-opus-5-5';

    if (!isGeminiArgon && !isGeminiCarbon && !isClaudeSonnet && !isClaudeOpus) {
      throw new HarnessExecutionError(
        `Model "${model}" is not permitted under Antigravity route. Allowed: gemini-4-argon-*, gemini-4-carbon-*, claude-sonnet-5-5-*, claude-opus-5-5-*.`,
        { harness: this.name, model }
      );
    }
  }

  classifyError(error, context = {}) {
    if (isReservedClassificationError(error)) {
      return super.classifyError(error, context);
    }

    const baseOptions = this._buildClassifiedErrorOptions(error, context);
    const raw = [error?.message, baseOptions.stderr, baseOptions.envelopeError].filter(Boolean).join(' ');

    // Gemini and Claude quota & rate limit signatures
    const isQuota =
      PROVIDER_HTTP_429_REGEX.test(raw) ||
      /resource_exhausted|rate_limit_error|overloaded_error|quota\s+window\s+exhausted|token_budget_exceeded|quota\s+exceeded/i.test(
        raw
      );

    if (isQuota) {
      const msg =
        typeof error?.message === 'string' && error.message
          ? (typeof baseOptions.cause?.message === 'string' && baseOptions.cause.message
            ? baseOptions.cause.message
            : error.message)
          : 'Antigravity quota limit or rate window exhausted';
      return new QuotaExhaustionError(msg, baseOptions);
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
    reasoningEffort,
    signal: callerSignal,
    abortDrainMs,
    killGraceMs,
    context: callerContext
  }) {
    this.validateModel(seat.model);
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
      reasoningEffort ?? callerContext?.reasoningEffort ?? seat?.reasoningEffort;
    const { effectiveTools, effectiveCwd, invocationMeta, retryDiagnostics } =
      captureAttemptInvocationMeta({
        role: 'seat',
        phase,
        participant: seat,
        state,
        tools,
        cwd,
        callerContext,
        adapter: this
      });
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
      ...(phase !== undefined ? { phase } : {}),
      ...(round !== undefined ? { round } : {}),
      _invocationMeta: invocationMeta,
      retryDiagnostics,
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
          const effectivePrompt = this._withRetryFeedback(prompt, callerContext?.retryFeedback);
          registerAttemptPrompt(context, effectivePrompt);
          const rawOutput = await this._dispatchCli({
            model: seat.model,
            prompt: effectivePrompt,
            signal,
            context,
            tools: effectiveTools,
            ...(effectiveCwd ? { cwd: effectiveCwd } : {})
          });

          const schemaType = isClarification ? 'clarification' : (isVoting ? 'vote' : 'proof');
          return this.parseStructuredOutput(rawOutput, schemaType);
        } catch (err) {
          this._handleAttemptError(err, {
            provider: 'antigravity',
            context,
            onCallRecord,
            tools: effectiveTools
          });
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
    reasoningEffort,
    signal: callerSignal,
    abortDrainMs,
    killGraceMs,
    context: callerContext
  }) {
    this.validateModel(judge.model);
    const effectiveReasoningEffort =
      reasoningEffort ?? callerContext?.reasoningEffort ?? judge?.reasoningEffort;
    const { effectiveTools, effectiveCwd, invocationMeta, retryDiagnostics } =
      captureAttemptInvocationMeta({
        role: 'judge',
        phase,
        participant: judge,
        state,
        tools,
        cwd,
        callerContext,
        adapter: this
      });
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
      ...(phase !== undefined ? { phase } : {}),
      ...(round !== undefined ? { round } : {}),
      _invocationMeta: invocationMeta,
      retryDiagnostics,
      ...(effectiveReasoningEffort ? { reasoningEffort: effectiveReasoningEffort } : {}),
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
          const effectivePrompt = this._withRetryFeedback(prompt, callerContext?.retryFeedback);
          registerAttemptPrompt(context, effectivePrompt);
          const rawOutput = await this._dispatchCli({
            model: judge.model,
            prompt: effectivePrompt,
            signal,
            context,
            tools: effectiveTools,
            ...(effectiveCwd ? { cwd: effectiveCwd } : {})
          });

          return this.parseStructuredOutput(rawOutput, 'judge_synthesis');
        } catch (err) {
          this._handleAttemptError(err, {
            provider: 'antigravity',
            context,
            onCallRecord,
            tools: effectiveTools
          });
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
    const { effectiveTools, effectiveCwd } = resolveAttemptExecutionWorkspace({
      role: 'seat',
      phase,
      participant: seat,
      state,
      tools,
      cwd,
      callerContext,
      adapter: this
    });
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
        (p) => p && (p.status === 'admitted' || p.status === 'partially_admitted')
      );
      const myOpenObjections = seat?.id
        ? (state?.objections || []).filter((o) => o && o.seatId === seat.id && o.status === 'open')
        : [];
      return formatVotingPrompt({
        soul,
        seat: effectiveSeat,
        topic: state?.topic || '',
        candidate: state?.candidate,
        admittedProofs,
        myOpenObjections,
        state,
        tools: effectiveTools,
        cwd: effectiveCwd
      });
    }

    const openObjections = (state?.objections || []).filter((o) => o && o.status === 'open');
    const resolvedRound = round || state?.round || 1;
    const priorAdmittedProofs = resolvedRound > 1
      ? resolvePriorAdmittedProofs([], state, resolvedRound)
      : [];
    return formatDeliberationPrompt({
      soul,
      seat: effectiveSeat,
      topic: state?.topic,
      round,
      maxRounds: state?.maxRounds,
      clarifications: state?.clarifications,
      previousCandidate: state?.candidate,
      openObjections,
      priorAdmittedProofs,
      state,
      tools: effectiveTools,
      cwd: effectiveCwd,
      ...(isRebuttal ? { rebuttalMode: true, mode: 'rebuttal' } : {})
    });
  }

  formatJudgePrompt({ judge, round, phase, proofs, state, tools, cwd, context: callerContext }) {
    const { effectiveTools, effectiveCwd } = resolveAttemptExecutionWorkspace({
      role: 'judge',
      phase,
      participant: judge,
      state,
      tools,
      cwd,
      callerContext,
      adapter: this
    });
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
