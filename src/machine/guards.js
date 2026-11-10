/**
 * @fileoverview Pure functional state machine guards for The Council.
 * Enforces proof submission validity, judge proof-binding, voting rules,
 * objection ownership, permanent objection immutability for excused seats,
 * quorum maintenance, and bounded retry limits.
 */

import { validateProof } from '../proofs/validator.js';
import { VALID_PROOF_KINDS, PHASE_MAP } from '../types.js';

/**
 * Returns all active (non-excused) seats in the council.
 * @param {import('../types.js').CouncilState} state
 * @returns {import('../types.js').Seat[]}
 */
export function getActiveSeats(state) {
  if (!state || !Array.isArray(state.seats)) return [];
  return state.seats.filter((s) => s && s.status !== 'excused');
}

/**
 * Checks if current state phase matches any of the target phases,
 * supporting both canonical uppercase and prototype lowercase aliases.
 * @param {string} currentPhase
 * @param {string[]} targetPhases
 * @returns {boolean}
 */
export function matchesPhase(currentPhase, targetPhases) {
  if (!currentPhase || !Array.isArray(targetPhases)) return false;
  for (const target of targetPhases) {
    if (!target) continue;
    if (currentPhase === target) return true;
    if (PHASE_MAP[currentPhase] === target) return true;
    if (PHASE_MAP[target] === currentPhase) return true;
    if (String(currentPhase).toUpperCase() === String(target).toUpperCase()) return true;
    if (String(currentPhase).toLowerCase() === String(target).toLowerCase()) return true;
  }
  return false;
}

// ============================================================================
// 1. PROOF SUBMISSION GUARDS
// ============================================================================

/**
 * Validates that a seat exists and is currently active.
 * @param {import('../types.js').CouncilState} state
 * @param {string} seatId
 * @returns {{ allowed: boolean; reason?: string; seat?: import('../types.js').Seat }}
 */
export function validateSeatActive(state, seatId) {
  const seat = (state.seats || []).find((s) => s.id === seatId);
  if (!seat || seat.status === 'excused') {
    return {
      allowed: false,
      reason: `Seat "${seatId}" is not an active Seat.`
    };
  }
  return { allowed: true, seat };
}

/**
 * Guards the SUBMIT_PROOF event.
 * @param {import('../types.js').CouncilState} state
 * @param {any} event
 * @returns {{ ok: boolean; message?: string }}
 */
export function guardSubmitProof(state, event) {
  if (!matchesPhase(state.phase, ['reviewing', 'confirming', 'DELIBERATION', 'VOTING'])) {
    return { ok: false, message: 'Proofs can only be submitted during reviewing or confirming.' };
  }

  const seatCheck = validateSeatActive(state, event.seatId);
  if (!seatCheck.allowed) {
    return { ok: false, message: seatCheck.reason };
  }

  const proofCheck = validateProof(event);
  if (!proofCheck.valid) {
    return { ok: false, message: proofCheck.errors[0] };
  }

  return { ok: true };
}

// ============================================================================
// 2. JUDGE CANDIDATE PROOF-BINDING GUARD
// ============================================================================

/**
 * Validates that candidate clauses cite at least one proof ID and that all cited
 * proof IDs have been admitted by the Judge.
 *
 * @param {import('../types.js').CandidateClause[]} clauses
 * @param {Set<string> | Record<string, boolean> | string[]} admittedProofIds
 * @returns {import('../types.js').CandidateValidationResult}
 */
export function validateCandidateClauses(clauses, admittedProofIds) {
  const errors = [];

  if (!clauses || !Array.isArray(clauses) || clauses.length === 0) {
    return {
      valid: false,
      errors: ['Judge Candidate Guard: Candidate requires at least one clause.']
    };
  }

  const isAdmitted = (pid) => {
    if (!admittedProofIds) return false;
    if (admittedProofIds instanceof Set) return admittedProofIds.has(pid);
    if (Array.isArray(admittedProofIds)) return admittedProofIds.includes(pid);
    if (typeof admittedProofIds === 'object') {
      return Object.hasOwn(admittedProofIds, pid) && Boolean(admittedProofIds[pid]);
    }
    return false;
  };

  for (let i = 0; i < clauses.length; i++) {
    const cl = clauses[i];
    if (!cl || typeof cl !== 'object' || Array.isArray(cl)) {
      errors.push(`Judge Candidate Guard: Clause ${i + 1} is malformed.`);
      continue;
    }

    const contextLabel = cl.context || `Clause ${i + 1}`;

    if (!cl.citedProofIds || !Array.isArray(cl.citedProofIds) || cl.citedProofIds.length === 0) {
      errors.push(`Judge Candidate Guard: Clause "${contextLabel}" cites no Proof IDs.`);
      continue;
    }

    for (let j = 0; j < cl.citedProofIds.length; j++) {
      const pid = cl.citedProofIds[j];
      if (!isAdmitted(pid)) {
        errors.push(`Judge Candidate Guard: Clause "${contextLabel}" cites unverified Proof "${pid}".`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Guards the JUDGE_AUDIT_AND_SYNTHESIZE event.
 * @param {import('../types.js').CouncilState} state
 * @param {any} event
 * @returns {{ ok: boolean; message?: string; admittedIds?: Set<string> }}
 */
export function guardJudgeAuditAndSynthesize(state, event) {
  if (!matchesPhase(state.phase, ['judging', 'JUDGE_AUDIT_SYNTHESIS'])) {
    return { ok: false, message: 'Judge can only synthesize a Candidate during the judging phase.' };
  }

  if (event.proofDecisions !== undefined && event.proofDecisions !== null) {
    if (typeof event.proofDecisions !== 'object' || Array.isArray(event.proofDecisions)) {
      return { ok: false, message: 'Judge Candidate Guard: proofDecisions must be an object.' };
    }
  }

  const decisions = event.proofDecisions || {};
  const admittedIds = new Set();

  for (const p of (state.proofs || [])) {
    const hasExplicitDecision = Object.prototype.hasOwnProperty.call(decisions, p.id);
    if (hasExplicitDecision) {
      const dec = decisions[p.id];
      if (typeof dec === 'boolean') {
        if (dec === true) {
          admittedIds.add(p.id);
        }
        // false: explicitly rejected, not added to admittedIds
      } else if (typeof dec === 'string') {
        if (dec === 'admitted') {
          admittedIds.add(p.id);
        } else if (dec === 'rejected') {
          // explicitly rejected, not added to admittedIds
        } else if (dec === 'partially_admitted' || dec === 'admitted_with_caveat') {
          return {
            ok: false,
            message: `Judge Candidate Guard: Proof "${p.id}" was partially admitted without a required caveat; requires a non-empty note or admittedStatement.`
          };
        } else {
          return {
            ok: false,
            message: `Judge Candidate Guard: Proof "${p.id}" has unrecognized decision status "${dec}".`
          };
        }
      } else if (typeof dec === 'object' && dec !== null && !Array.isArray(dec)) {
        if (dec.status !== undefined) {
          if (typeof dec.status !== 'string') {
            return {
              ok: false,
              message: `Judge Candidate Guard: Proof "${p.id}" has invalid decision status type.`
            };
          }
          if (dec.status === 'admitted') {
            admittedIds.add(p.id);
          } else if (dec.status === 'rejected') {
            // explicitly rejected, not added to admittedIds
          } else if (dec.status === 'partially_admitted' || dec.status === 'admitted_with_caveat') {
            const hasStmt = typeof dec.admittedStatement === 'string' && dec.admittedStatement.trim().length > 0;
            const hasNote = typeof dec.note === 'string' && dec.note.trim().length > 0;
            const hasReason = typeof dec.reason === 'string' && dec.reason.trim().length > 0;
            if (!hasStmt && !hasNote && !hasReason) {
              return {
                ok: false,
                message: `Judge Candidate Guard: Proof "${p.id}" was partially admitted without a required caveat; requires a non-empty note or admittedStatement.`
              };
            }
            admittedIds.add(p.id);
          } else {
            return {
              ok: false,
              message: `Judge Candidate Guard: Proof "${p.id}" has unrecognized decision status "${dec.status}".`
            };
          }
        } else if (dec.admitted !== undefined) {
          if (typeof dec.admitted !== 'boolean') {
            return {
              ok: false,
              message: `Judge Candidate Guard: Proof "${p.id}" has invalid admitted property.`
            };
          }
          if (dec.admitted === true) {
            admittedIds.add(p.id);
          }
          // false: explicitly rejected, not added to admittedIds
        } else {
          const hasNote = typeof dec.note === 'string' && dec.note.trim().length > 0;
          const hasReason = typeof dec.reason === 'string' && dec.reason.trim().length > 0;
          if (hasNote || hasReason) {
            if (p.status === 'pending' || p.status === 'admitted' || p.status === 'partially_admitted') {
              admittedIds.add(p.id);
            }
          } else {
            return {
              ok: false,
              message: `Judge Candidate Guard: Proof "${p.id}" decision object is empty or missing recognized status (invalid status).`
            };
          }
        }
      } else {
        return {
          ok: false,
          message: `Judge Candidate Guard: Proof "${p.id}" has invalid decision type.`
        };
      }
    } else {
      // Omitted key: preserve default admission for pending or previously admitted proofs
      if (p.status === 'pending' || p.status === 'admitted' || p.status === 'partially_admitted') {
        admittedIds.add(p.id);
      }
    }
  }

  const clauseCheck = validateCandidateClauses(event.clauses, admittedIds);
  if (!clauseCheck.valid) {
    return { ok: false, message: clauseCheck.errors[0] };
  }

  return { ok: true, admittedIds };
}

// ============================================================================
// 3. VOTING GUARDS
// ============================================================================

/**
 * Guards the CAST_VOTE event.
 * @param {import('../types.js').CouncilState} state
 * @param {any} event
 * @returns {{ ok: boolean; message?: string }}
 */
export function guardCastVote(state, event) {
  if (!matchesPhase(state.phase, ['confirming', 'VOTING'])) {
    return { ok: false, message: 'Seats can only vote during the confirming phase.' };
  }

  const seat = (state.seats || []).find((s) => s.id === event.seatId);
  if (!seat || seat.status === 'excused') {
    return { ok: false, message: `Seat "${event.seatId}" is not an active voting Seat.` };
  }

  if (event.vote === 'accept') {
    return { ok: true };
  }

  if (event.vote === 'object') {
    if (!event.reason || typeof event.reason !== 'string' || !event.reason.trim()) {
      return { ok: false, message: 'Objection Guard: An Objection requires a concrete reason.' };
    }

    const proof = (state.proofs || []).find((p) => p.id === event.proofId);
    if (!proof || proof.status === 'rejected') {
      return { ok: false, message: 'Objection Guard: Objection must cite a valid Proof ID.' };
    }

    return { ok: true };
  }

  return { ok: false, message: `Unknown vote type "${event.vote}".` };
}

// ============================================================================
// 4. OBJECTION OWNERSHIP AND IMMUTABILITY GUARD (VULNERABILITY FIX)
// ============================================================================

/**
 * Evaluates whether an objection can be withdrawn:
 * 1. Objection must exist.
 * 2. VULNERABILITY FIX: Preserved excused objections are permanently locked.
 * 3. Already withdrawn objections cannot be withdrawn again.
 * 4. VULNERABILITY FIX: Excused seats cannot withdraw objections.
 * 5. Ownership Guard: Only the seat that raised the objection can withdraw it.
 *
 * @param {import('../types.js').CouncilState} state
 * @param {string} objectionId
 * @param {string} seatId
 * @returns {import('../types.js').ObjectionWithdrawalResult}
 */
export function canWithdrawObjection(state, objectionId, seatId) {
  if (!state) return { allowed: false, reason: 'Invalid state.' };
  const obj = (state.objections || []).find((o) => o && o.id === objectionId);
  if (!obj) {
    return {
      allowed: false,
      reason: `Objection "${objectionId}" not found.`
    };
  }

  // Vulnerability Fix 1: Permanently lock preserved_excused objections
  if (obj.status === 'preserved_excused') {
    return {
      allowed: false,
      reason: `Objection Immutability Guard: Objection "${objectionId}" is locked as preserved_excused and cannot be withdrawn.`
    };
  }

  // Check if objection is already withdrawn
  if (obj.status === 'withdrawn') {
    return {
      allowed: false,
      reason: `Objection "${objectionId}" is already withdrawn.`
    };
  }

  // Vulnerability Fix 2: Disallow actions from excused seats
  const seat = (state.seats || []).find((s) => s.id === seatId);
  if (!seat) {
    return {
      allowed: false,
      reason: `Seat "${seatId}" does not exist in the Council.`
    };
  }
  if (seat.status === 'excused') {
    return {
      allowed: false,
      reason: `Objection Ownership Guard: Excused seat "${seatId}" cannot withdraw objections.`
    };
  }

  // Ownership Guard: Only owning seat can withdraw
  if (obj.seatId !== seatId) {
    return {
      allowed: false,
      reason: `Objection Ownership Guard: Seat "${seatId}" cannot withdraw Objection "${obj.id}" owned by "${obj.seatId}".`
    };
  }

  return { allowed: true };
}

/**
 * Guards the WITHDRAW_OBJECTION event.
 * @param {import('../types.js').CouncilState} state
 * @param {any} event
 * @returns {{ ok: boolean; message?: string }}
 */
export function guardWithdrawObjection(state, event) {
  const result = canWithdrawObjection(state, event.objectionId, event.seatId);
  if (!result.allowed) {
    return { ok: false, message: result.reason };
  }
  return { ok: true };
}

// ============================================================================
// 5. QUORUM GUARDS
// ============================================================================

/**
 * Evaluates active seat count against minimum quorum.
 * @param {import('../types.js').CouncilState} state
 * @param {number} [minQuorum]
 * @returns {{ hasQuorum: boolean; activeCount: number; minQuorum: number }}
 */
export function checkQuorum(state, minQuorum) {
  if (!state) return { hasQuorum: false, activeCount: 0, minQuorum: minQuorum ?? 2 };
  const quorum = minQuorum ?? state.minQuorum ?? 2;
  const activeCount = getActiveSeats(state).length;
  return {
    hasQuorum: activeCount >= quorum,
    activeCount,
    minQuorum: quorum
  };
}

/**
 * Guards BEGIN_ROUND for quorum and round limits.
 * @param {import('../types.js').CouncilState} state
 * @returns {{ ok: boolean; message?: string }}
 */
export function guardBeginRound(state) {
  if (!matchesPhase(state.phase, ['preflight', 'clarifying', 'confirming', 'ROSTER_CONFIGURATION', 'DISCOVERY', 'VOTING'])) {
    return { ok: false, message: `Cannot begin a deliberation round from phase "${state.phaseAlias || state.phase}".` };
  }

  if (state.round >= state.maxRounds) {
    return { ok: false, message: `Maximum deliberation rounds (${state.maxRounds}) already reached.` };
  }

  const q = checkQuorum(state);
  if (!q.hasQuorum) {
    return { ok: false, message: `Active Seats (${q.activeCount}) below minimum quorum (${q.minQuorum}).` };
  }

  return { ok: true };
}

/**
 * Determines whether excusing a seat causes quorum failure.
 * @param {import('../types.js').CouncilState} state
 * @param {string} excusedSeatId
 * @returns {boolean} True if remaining active seats fall below minQuorum.
 */
export function dropsBelowQuorumOnExcusal(state, excusedSeatId) {
  if (!state) return true;
  const remaining = (state.seats || []).filter((s) => s && s.id !== excusedSeatId && s.status !== 'excused').length;
  return remaining < (state.minQuorum ?? 2);
}

/**
 * Guards EVALUATE_ROUND to enforce all votes cast and assert quorum.
 * @param {import('../types.js').CouncilState} state
 * @returns {{ ok: boolean; message?: string; unvotedCount?: number }}
 */
export function guardEvaluateRound(state) {
  if (!matchesPhase(state.phase, ['confirming', 'VOTING'])) {
    return { ok: false, message: 'Can only evaluate round from confirming phase.' };
  }

  const active = getActiveSeats(state);
  const unvoted = active.filter((s) => s.status !== 'accepted' && s.status !== 'objected');
  if (unvoted.length > 0) {
    return {
      ok: false,
      message: `Cannot evaluate round: ${unvoted.length} active Seat(s) have not voted yet.`,
      unvotedCount: unvoted.length
    };
  }

  return { ok: true };
}

// ============================================================================
// 6. RETRY CAP GUARDS
// ============================================================================

/**
 * Evaluates whether a faulted seat can be retried.
 * @param {import('../types.js').Seat} seat
 * @param {number} maxRetriesPerSeat
 * @returns {{ allowed: boolean; reason?: string }}
 */
export function canRetrySeat(seat, maxRetriesPerSeat) {
  if (!seat) return { allowed: false, reason: 'Seat not found.' };
  const cap = maxRetriesPerSeat ?? 1;
  if ((seat.retries || 0) >= cap) {
    return {
      allowed: false,
      reason: `Retry Cap Guard: Seat "${seat.id}" reached ${seat.retries || 0}/${cap} retries. Excuse Seat instead.`
    };
  }
  return { allowed: true };
}

/**
 * Guards RETRY_SEAT event.
 * @param {import('../types.js').CouncilState} state
 * @param {any} event
 * @returns {{ ok: boolean; message?: string }}
 */
export function guardRetrySeat(state, event) {
  if (!matchesPhase(state.phase, ['seat_fault', 'RECOVERY'])) {
    return { ok: false, message: 'Can only retry a Seat from seat_fault.' };
  }

  const targetId = event.seatId || state.faultSeatId;
  const seat = (state.seats || []).find((s) => s.id === targetId);
  if (!seat) {
    return { ok: false, message: 'Faulted Seat not found.' };
  }

  const retryCheck = canRetrySeat(seat, state.maxRetriesPerSeat);
  if (!retryCheck.allowed) {
    return { ok: false, message: retryCheck.reason };
  }

  return { ok: true };
}

// ============================================================================
// 7. ROSTER, TELEMETRY & CLARIFICATION GUARDS
// ============================================================================

/**
 * Guards ADD_SEAT event.
 * @param {import('../types.js').CouncilState} state
 * @param {any} event
 * @returns {{ ok: boolean; message?: string }}
 */
export function guardAddSeat(state, event) {
  if (!matchesPhase(state.phase, ['preflight', 'ROSTER_CONFIGURATION'])) {
    return { ok: false, message: 'Seats can only be added during preflight before deliberation begins.' };
  }
  const s = event.seat;
  if (!s || !s.id || !s.harness || !s.model || !s.soul) {
    return { ok: false, message: 'Seat requires id, harness, model, and soul.' };
  }
  if ((state.seats || []).some((x) => x.id === s.id)) {
    return { ok: false, message: `Seat ID "${s.id}" already exists in the Council.` };
  }
  return { ok: true };
}

/**
 * Guards SEAT_TELEMETRY event.
 * @param {import('../types.js').CouncilState} state
 * @param {any} event
 * @returns {{ ok: boolean; message?: string }}
 */
export function guardSeatTelemetry(state, event) {
  const seat = (state.seats || []).find((s) => s.id === event.seatId);
  if (!seat || seat.status === 'excused') {
    return { ok: false, message: `Cannot update telemetry for unknown or excused Seat "${event.seatId}".` };
  }
  return { ok: true };
}

/**
 * Guards START_CLARIFYING event.
 * @param {import('../types.js').CouncilState} state
 * @returns {{ ok: boolean; message?: string }}
 */
export function guardStartClarifying(state) {
  if (!matchesPhase(state.phase, ['preflight', 'clarifying', 'ROSTER_CONFIGURATION', 'DISCOVERY'])) {
    return { ok: false, message: `Cannot start clarification from phase "${state.phaseAlias || state.phase}".` };
  }
  if (state.clarificationBatch >= state.maxClarificationBatches) {
    return { ok: false, message: `Maximum clarification batches (${state.maxClarificationBatches}) reached.` };
  }
  return { ok: true };
}

/**
 * Guards PUBLISH_CLARIFICATION event.
 * @param {import('../types.js').CouncilState} state
 * @param {any} event
 * @returns {{ ok: boolean; message?: string }}
 */
export function guardPublishClarification(state, event) {
  if (!matchesPhase(state.phase, ['clarifying', 'DISCOVERY'])) {
    return { ok: false, message: 'Can only publish clarification answers during clarifying phase.' };
  }
  if (!event.answer || typeof event.answer !== 'string' || !event.answer.trim()) {
    return { ok: false, message: 'Clarification answer cannot be empty.' };
  }
  return { ok: true };
}

/**
 * Guards START_JUDGING event.
 * @param {import('../types.js').CouncilState} state
 * @returns {{ ok: boolean; message?: string }}
 */
export function guardStartJudging(state) {
  if (!matchesPhase(state.phase, ['reviewing', 'DELIBERATION'])) {
    return { ok: false, message: 'Can only transition to judging from reviewing.' };
  }
  const roundProofs = (state.proofs || []).filter((p) => p.round === state.round || p.status === 'pending');
  if (roundProofs.length === 0) {
    return { ok: false, message: 'At least one Proof must be submitted before entering judging.' };
  }
  return { ok: true };
}

/**
 * Guards EXCUSE_SEAT event.
 * @param {import('../types.js').CouncilState} state
 * @param {any} event
 * @returns {{ ok: boolean; message?: string }}
 */
export function guardExcuseSeat(state, event) {
  const targetId = event.seatId || state.faultSeatId;
  const seat = (state.seats || []).find((s) => s.id === targetId);
  if (!seat || seat.status === 'excused') {
    return { ok: false, message: `Seat "${targetId}" is not active.` };
  }
  return { ok: true };
}

/**
 * Guards RETRY_JUDGE event.
 * @param {import('../types.js').CouncilState} state
 * @returns {{ ok: boolean; message?: string }}
 */
export function guardRetryJudge(state) {
  if (!matchesPhase(state.phase, ['judge_fault', 'RECOVERY'])) {
    return { ok: false, message: 'Can only retry Judge from judge_fault.' };
  }
  return { ok: true };
}
