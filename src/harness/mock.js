/**
 * @fileoverview Hermetic Mock Harness Adapter for The Council.
 * Provides 100% deterministic, offline, zero-network execution for unit, integration,
 * and E2E test suites. Supports scenario replay, scripted queues, multi-stage fault injection,
 * and Soul adherence prompt verification.
 */

import { HarnessAdapter, QuotaExhaustionError } from './adapter.js';
import { formatDeliberationPrompt, formatVotingPrompt, formatJudgePrompt } from '../seats/soul.js';

export class MockAdapter extends HarnessAdapter {
  constructor(config = {}) {
    super({ name: 'mock', ...config });
    this.scenarioName = config.scenario || null;

    // Registries for scripted responses
    this.scriptedSeatResponses = new Map(); // key: `${seatId}:${round}:${phase}` -> result
    this.scriptedJudgeResponses = new Map(); // key: `${round}:${phase}` -> result

    // Fault injection registry
    this.seatFaultInjections = new Map(); // key: seatId -> Array<FaultRule>
    this.judgeFaultInjections = new Map(); // key: round -> FaultRule

    // Soul verification: records all prompts sent to seats
    this.recordedPrompts = []; // Array<{ seatId, soul, round, phase, prompt, timestamp }>

    // Execution counter
    this.callCount = {
      seats: 0,
      judge: 0
    };
  }

  /**
   * Clear all recorded history, scripted queues, and fault rules.
   */
  reset() {
    this.scriptedSeatResponses.clear();
    this.scriptedJudgeResponses.clear();
    this.seatFaultInjections.clear();
    this.judgeFaultInjections.clear();
    this.recordedPrompts = [];
    this.callCount = { seats: 0, judge: 0 };
  }

  /**
   * Script a specific seat response for a given round and phase.
   *
   * @param {Object} options
   * @param {string} options.seatId
   * @param {number} [options.round] - Target round, or wildcard if undefined
   * @param {string} [options.phase] - Target phase, or wildcard if undefined
   * @param {Object|Function} options.response - Payload to return or resolver function
   */
  scriptSeatResponse({ seatId, round, phase, response }) {
    const key = `${seatId}:${round ?? '*'}:${phase ?? '*'}`;
    this.scriptedSeatResponses.set(key, response);
  }

  /**
   * Script a judge response for a given round.
   *
   * @param {Object} options
   * @param {number} [options.round]
   * @param {Object|Function} options.response
   */
  scriptJudgeResponse({ round, response }) {
    const key = `${round ?? '*'}:judging`;
    this.scriptedJudgeResponses.set(key, response);
  }

  /**
   * Inject a deliberate fault on a seat.
   *
   * @param {string} seatId
   * @param {Object} [rule={}]
   * @param {number} [rule.round] - Round to trigger fault (optional)
   * @param {string} [rule.phase] - Phase to trigger fault (optional)
   * @param {Error} [rule.error] - Custom error (defaults to QuotaExhaustionError)
   * @param {number} [rule.afterRetries] - Only fault if seat.retries === afterRetries
   * @param {number} [rule.maxTriggers=Infinity] - Times this fault can trigger
   */
  injectSeatFault(seatId, rule = {}) {
    if (!this.seatFaultInjections.has(seatId)) {
      this.seatFaultInjections.set(seatId, []);
    }
    this.seatFaultInjections.get(seatId).push({
      error:
        rule.error ||
        new QuotaExhaustionError(`Mock quota exhausted for seat "${seatId}"`, {
          harness: this.name,
          seatId
        }),
      round: rule.round ?? null,
      phase: rule.phase ?? null,
      afterRetries: rule.afterRetries ?? null,
      maxTriggers: rule.maxTriggers ?? Infinity,
      triggeredCount: 0
    });
  }

  /**
   * Inject a deliberate judge fault.
   *
   * @param {Object} [rule={}]
   * @param {number} [rule.round]
   * @param {Error} [rule.error]
   */
  injectJudgeFault(rule = {}) {
    const roundKey = rule.round ?? '*';
    this.judgeFaultInjections.set(roundKey, {
      error:
        rule.error ||
        new QuotaExhaustionError(`Mock judge quota exhausted`, {
          harness: this.name,
          seatId: 'judge'
        }),
      triggered: false
    });
  }

  /**
   * Retrieve all recorded prompt packets for a given seat.
   *
   * @param {string} seatId
   * @returns {Array<Object>}
   */
  getRecordedPrompts(seatId) {
    return this.recordedPrompts.filter((p) => p.seatId === seatId);
  }

  /**
   * Verify whether a seat's Soul instructions were injected into its prompt.
   *
   * @param {string} seatId
   * @param {string|RegExp} pattern
   * @returns {boolean}
   */
  hasReceivedSoulContent(seatId, pattern) {
    const prompts = this.getRecordedPrompts(seatId);
    return prompts.some((p) => {
      const soulStr = typeof p.soul === 'object' && p.soul !== null ? (p.soul.lens || p.soul.name || JSON.stringify(p.soul)) : String(p.soul || '');
      if (pattern instanceof RegExp) {
        return pattern.test(p.prompt) || pattern.test(soulStr);
      }
      return p.prompt.includes(pattern) || soulStr.includes(pattern);
    });
  }

  /**
   * Execute seat turn deterministically.
   */
  async executeSeat({ seat, soul, round, phase, state, tools, cwd, context: callerContext }) {
    this.callCount.seats += 1;

    const isVoting = phase === 'VOTING' || phase === 'confirming';
    const effectiveTools =
      tools ??
      callerContext?.tools ??
      (isVoting ? seat?.votingTools ?? seat?.tools : seat?.tools) ??
      'read-only';
    const effectiveCwd =
      effectiveTools === 'none'
        ? undefined
        : [cwd, callerContext?.cwd, seat?.cwd, state?.cwd, this.cwd, this.config?.cwd]
            .find((c) => typeof c === 'string' && c.trim())
            ?.trim();
    const effectiveSeat = seat
      ? { ...seat, tools: effectiveTools, ...(effectiveTools === 'none' ? { cwd: undefined } : {}) }
      : seat;
    const resolvedSoul = soul || seat?.soul || 'General Seat: Evaluates claims empirically';
    const renderedPrompt = isVoting
      ? formatVotingPrompt({ soul: resolvedSoul, seat: effectiveSeat, candidate: state?.candidate, state, tools: effectiveTools, cwd: effectiveCwd })
      : formatDeliberationPrompt({ soul: resolvedSoul, seat: effectiveSeat, topic: state?.topic, round, maxRounds: state?.maxRounds, state, tools: effectiveTools, cwd: effectiveCwd });

    // Record prompt for soul adherence and evidence/clarifications verification
    const formattedPrompt = `[SEAT: ${seat.id}] [SOUL: ${typeof soul === 'object' ? JSON.stringify(soul) : soul}] [ROUND: ${round}] [PHASE: ${phase}]\n${renderedPrompt}`;
    this.recordedPrompts.push({
      seatId: seat.id,
      role: 'seat',
      soul,
      round,
      phase,
      prompt: formattedPrompt,
      timestamp: new Date().toISOString()
    });

    // Check fault injection rules
    const rules = this.seatFaultInjections.get(seat.id) || [];
    for (const rule of rules) {
      const matchRound = rule.round === null || rule.round === round;
      const matchPhase = rule.phase === null || rule.phase === phase;
      const matchRetries = rule.afterRetries === null || rule.afterRetries === (seat.retries || 0);

      if (matchRound && matchPhase && matchRetries && rule.triggeredCount < rule.maxTriggers) {
        rule.triggeredCount += 1;
        throw rule.error;
      }
    }

    // Check scripted responses (exact match first, then wildcards)
    const exactKey = `${seat.id}:${round}:${phase}`;
    const roundWildcard = `${seat.id}:*:${phase}`;
    const phaseWildcard = `${seat.id}:${round}:*`;
    const fullWildcard = `${seat.id}:*:*`;

    const scripted =
      this.scriptedSeatResponses.get(exactKey) ||
      this.scriptedSeatResponses.get(roundWildcard) ||
      this.scriptedSeatResponses.get(phaseWildcard) ||
      this.scriptedSeatResponses.get(fullWildcard);

    if (scripted) {
      return typeof scripted === 'function' ? scripted({ seat, soul, round, phase, state }) : scripted;
    }

    // Default deterministic fallback
    if (isVoting) {
      return { vote: 'accept' };
    }

    // Default proof in deliberation
    const soulDesc = typeof soul === 'object' && soul !== null ? (soul.lens || soul.name || 'custom') : String(soul || 'general');
    return {
      scope: `General verification for ${seat.id}`,
      kind: 'check',
      source: `Deterministic mock check verified by ${seat.id}`,
      statement: `Proof synthesized according to soul: "${soulDesc}".`
    };
  }

  /**
   * Execute judge turn deterministically.
   */
  async executeJudge({ judge, round, phase, proofs, state, tools, cwd, context: callerContext }) {
    this.callCount.judge += 1;

    const effectiveTools = tools ?? callerContext?.tools ?? judge?.tools ?? 'read-only';
    const effectiveCwd =
      effectiveTools === 'none'
        ? undefined
        : [cwd, callerContext?.cwd, judge?.cwd, state?.cwd, this.cwd, this.config?.cwd]
            .find((c) => typeof c === 'string' && c.trim())
            ?.trim();
    const effectiveJudge = judge
      ? { ...judge, tools: effectiveTools, ...(effectiveTools === 'none' ? { cwd: undefined } : {}) }
      : judge;
    const judgePrompt = formatJudgePrompt({
      judge: effectiveJudge,
      topic: state?.topic,
      round,
      maxRounds: state?.maxRounds,
      proofs,
      state,
      tools: effectiveTools,
      cwd: effectiveCwd
    });
    this.recordedPrompts.push({
      seatId: judge?.id || 'judge',
      role: 'judge',
      soul: judge?.soul,
      round,
      phase: phase || 'JUDGE_AUDIT_SYNTHESIS',
      prompt: `[JUDGE: ${judge?.id || 'judge'}] [ROUND: ${round}] [PHASE: ${phase || 'JUDGE_AUDIT_SYNTHESIS'}]\n${judgePrompt}`,
      timestamp: new Date().toISOString()
    });

    // Check judge fault injection
    const faultRule = this.judgeFaultInjections.get(round) || this.judgeFaultInjections.get('*');
    if (faultRule && !faultRule.triggered) {
      faultRule.triggered = true;
      throw faultRule.error;
    }

    // Check scripted judge response
    const exactKey = `${round}:judging`;
    const wildcardKey = `*:judging`;
    const scripted = this.scriptedJudgeResponses.get(exactKey) || this.scriptedJudgeResponses.get(wildcardKey);

    if (scripted) {
      return typeof scripted === 'function' ? scripted({ judge, round, phase, proofs, state }) : scripted;
    }

    // Default deterministic candidate synthesis admitting all pending proofs
    const roundProofs = (proofs || []).filter((p) => p.round === round || p.status === 'pending');
    const admittedIds = roundProofs.map((p) => p.id);
    const proofDecisions = {};
    roundProofs.forEach((p) => {
      proofDecisions[p.id] = { status: 'admitted', note: `Admitted by mock judge.` };
    });

    return {
      summary: `Deterministic consensus candidate synthesized by ${judge?.id || 'judge'} for round ${round}.`,
      proofDecisions,
      clauses: [
        {
          context: `Target workload evaluated in round ${round}`,
          conclusion: `Resolved recommendation supported by proofs ${admittedIds.join(', ')}.`,
          citedProofIds: admittedIds.length > 0 ? admittedIds : ['P1']
        }
      ]
    };
  }
}
