/**
 * Pure Synchronous State Machine Reducer & Graph Introspection for The Council
 * ESM Module (Node >= 22)
 *
 * Implements:
 * - 9 Canonical Phases: ROSTER_CONFIGURATION, DISCOVERY, DELIBERATION,
 *   JUDGE_AUDIT_SYNTHESIS, VOTING, CONSENSUS_REACHED, DISSENT_REPORT,
 *   ROUND_TIMEOUT, RECOVERY
 * - 17 Events/Transitions with full guard enforcement
 * - Objection Immutability Guard (Vulnerability Fix for preserved_excused)
 * - Quorum Double-Gate in EVALUATE_ROUND
 * - Pure, synchronous, zero-I/O, deterministic transitionCouncil(state, event)
 * - getDependencyAndStateGraph(state)
 */

import {
  COUNCIL_PHASES,
  VALID_PROOF_KINDS,
  STATE_NODES,
  PROTOTYPE_STATE_NODES,
  CANONICAL_STATE_NODES,
  STATE_EDGES,
  normalizePhase,
  toPrototypePhase,
  toCanonicalPhase,
  isPhaseMatch
} from './constants.js';

import {
  createInitialCouncilState,
  cloneState,
  activeSeats,
  isQuorumSatisfied,
  findSeat,
  findProof,
  findObjection
} from './state.js';

/**
 * Rejection helper: returns cloned state with lastTransition = { ok: false, message },
 * phase unchanged, history updated.
 */
function reject(state, eventType, reason) {
  const next = cloneState(state);
  next.lastEventName = eventType;
  next.lastTransition = { ok: false, message: 'Guard rejected ' + eventType + ': ' + reason };
  next.history = ['[REJECTED] ' + reason, ...(next.history || [])];
  return next;
}

/**
 * Success helper: updates previousPhase, lastEventName, lastTransition, history.
 */
function succeed(prevState, next, eventType, message) {
  next.previousPhase = prevState.phase;
  const subType = next.faultSeatId
    ? 'seat_fault'
    : next.judge && next.judge.status === 'fault_quota'
    ? 'judge_fault'
    : undefined;
  next.phaseAlias = toPrototypePhase(next.phase, subType);
  next.canonicalPhase = toCanonicalPhase(
    next.phase,
    subType,
    next.verdict ? next.verdict.kind : undefined
  );
  next.lastEventName = eventType;
  next.lastTransition = { ok: true, message: message };
  next.history = ['[OK] ' + message, ...(next.history || [])];
  return next;
}

/**
 * Pure synchronous Council state reducer.
 * @param {Object} state - Current CouncilState
 * @param {Object} event - Action event object with `type` property
 * @returns {Object} next CouncilState
 */
export function transitionCouncil(state, event) {
  if (!event || !event.type) {
    return reject(state, 'UNKNOWN', 'Event must have a valid "type" property.');
  }

  const next = cloneState(state);
  const currentPhase = normalizePhase(state.phase);

  switch (event.type) {
    case 'ADD_SEAT': {
      if (currentPhase !== 'preflight') {
        return reject(state, event.type, 'Seats can only be added during preflight before deliberation begins.');
      }
      const s = event.seat;
      if (!s || !s.id || !s.harness || !s.model || !s.soul) {
        return reject(state, event.type, 'Seat requires id, harness, model, and soul.');
      }
      if (next.seats.some((x) => x.id === s.id)) {
        return reject(state, event.type, 'Seat ID "' + s.id + '" already exists in the Council.');
      }
      next.seats.push({
        id: s.id,
        harness: s.harness,
        model: s.model,
        soul: s.soul,
        status: 'idle',
        retries: 0,
        excusedReason: null
      });
      return succeed(state, next, event.type, 'Added Seat "' + s.id + '" (' + s.harness + ' / ' + s.model + ').');
    }

    case 'SEAT_TELEMETRY': {
      const seat = next.seats.find((s) => s.id === event.seatId);
      if (!seat || seat.status === 'excused') {
        return reject(state, event.type, 'Cannot update telemetry for unknown or excused Seat "' + event.seatId + '".');
      }
      seat.status = event.status;
      return succeed(
        state,
        next,
        event.type,
        'Observer telemetry: Seat "' + seat.id + '" is now [' + String(event.status).toUpperCase() + '].'
      );
    }

    case 'START_CLARIFYING': {
      if (currentPhase !== 'preflight' && currentPhase !== 'clarifying') {
        return reject(
          state,
          event.type,
          'Cannot start clarification from phase "' + toPrototypePhase(state.phase) + '".'
        );
      }
      if (state.clarificationBatch >= state.maxClarificationBatches) {
        return reject(
          state,
          event.type,
          'Maximum clarification batches (' + state.maxClarificationBatches + ') reached.'
        );
      }
      next.phase = 'clarifying';
      next.clarificationBatch += 1;
      activeSeats(next).forEach((s) => {
        s.status = 'thinking';
      });
      return succeed(
        state,
        next,
        event.type,
        'Started Clarification Batch ' + next.clarificationBatch + '/' + next.maxClarificationBatches + '.'
      );
    }

    case 'PUBLISH_CLARIFICATION': {
      if (currentPhase !== 'clarifying') {
        return reject(state, event.type, 'Can only publish clarification answers during clarifying phase.');
      }
      if (!event.answer || !String(event.answer).trim()) {
        return reject(state, event.type, 'Clarification answer cannot be empty.');
      }
      next.clarifications.push({
        batch: state.clarificationBatch,
        answer: String(event.answer).trim()
      });
      activeSeats(next).forEach((s) => {
        s.status = 'idle';
      });
      return succeed(
        state,
        next,
        event.type,
        'Broadcast Batch ' + state.clarificationBatch + ' clarification answer to all active Seats.'
      );
    }

    case 'BEGIN_ROUND': {
      const allowedPhases = ['preflight', 'clarifying', 'confirming'];
      if (!allowedPhases.includes(currentPhase)) {
        return reject(
          state,
          event.type,
          'Cannot begin a deliberation round from phase "' + toPrototypePhase(state.phase) + '".'
        );
      }
      if (state.round >= state.maxRounds) {
        return reject(
          state,
          event.type,
          'Maximum deliberation rounds (' + state.maxRounds + ') already reached.'
        );
      }
      const active = activeSeats(state);
      if (active.length < state.minQuorum) {
        return reject(
          state,
          event.type,
          'Active Seats (' + active.length + ') below minimum quorum (' + state.minQuorum + ').'
        );
      }
      next.round += 1;
      next.phase = 'reviewing';
      next.judge.status = 'idle';
      activeSeats(next).forEach((s) => {
        s.status = 'thinking';
      });
      return succeed(
        state,
        next,
        event.type,
        'Entered Deliberation Round ' + next.round + '/' + next.maxRounds + ' (reviewing).'
      );
    }

    case 'SUBMIT_PROOF': {
      const allowedPhases = ['reviewing', 'confirming'];
      if (!allowedPhases.includes(currentPhase)) {
        return reject(state, event.type, 'Proofs can only be submitted during reviewing or confirming.');
      }
      const seat = next.seats.find((s) => s.id === event.seatId);
      if (!seat || seat.status === 'excused') {
        return reject(state, event.type, 'Seat "' + event.seatId + '" is not an active Seat.');
      }
      if (!event.scope || !String(event.scope).trim()) {
        return reject(state, event.type, 'Structural Proof Guard: "scope" condition is required.');
      }
      if (!VALID_PROOF_KINDS.includes(event.kind)) {
        return reject(
          state,
          event.type,
          'Structural Proof Guard: "kind" must be check, citation, benchmark, or derivation.'
        );
      }
      if (!event.source || !String(event.source).trim()) {
        return reject(
          state,
          event.type,
          'Structural Proof Guard: verifiable "source" is required; bare opinions are forbidden.'
        );
      }
      if (!event.statement || !String(event.statement).trim()) {
        return reject(state, event.type, 'Structural Proof Guard: falsifiable "statement" is required.');
      }
      const proofId = event.id || 'P' + (next.proofs.length + 1);
      next.proofs.push({
        id: proofId,
        round: state.round,
        seatId: seat.id,
        scope: String(event.scope).trim(),
        kind: event.kind,
        source: String(event.source).trim(),
        statement: String(event.statement).trim(),
        status: 'pending',
        judgeNote: null
      });
      if (currentPhase === 'reviewing') {
        seat.status = 'proof_submitted';
      }
      return succeed(
        state,
        next,
        event.type,
        'Seat "' + seat.id + '" submitted Proof ' + proofId + ' (' + event.kind + ').'
      );
    }

    case 'START_JUDGING': {
      if (currentPhase !== 'reviewing') {
        return reject(state, event.type, 'Can only transition to judging from reviewing.');
      }
      const roundProofs = state.proofs.filter((p) => p.round === state.round || p.status === 'pending');
      if (roundProofs.length === 0) {
        return reject(state, event.type, 'At least one Proof must be submitted before entering judging.');
      }
      next.phase = 'judging';
      next.judge.status = 'thinking';
      return succeed(
        state,
        next,
        event.type,
        'Transitioned to judging. Judge "' + next.judge.id + '" is auditing ' + roundProofs.length + ' Proof(s).'
      );
    }

    case 'JUDGE_AUDIT_AND_SYNTHESIZE': {
      if (currentPhase !== 'judging') {
        return reject(state, event.type, 'Judge can only synthesize a Candidate during the judging phase.');
      }
      const decisions = event.proofDecisions || {};
      next.proofs.forEach((p) => {
        if (decisions[p.id]) {
          p.status = decisions[p.id].status;
          p.judgeNote = decisions[p.id].note || '';
        } else if (p.status === 'pending') {
          p.status = 'admitted';
          p.judgeNote = 'Admitted by Judge.';
        }
      });

      const admittedIds = new Set();
      next.proofs.forEach((p) => {
        if (p.status === 'admitted') admittedIds.add(p.id);
      });

      const clauses = event.clauses;
      if (!clauses || !Array.isArray(clauses) || clauses.length === 0) {
        return reject(state, event.type, 'Judge Candidate Guard: Candidate requires at least one clause.');
      }
      for (let i = 0; i < clauses.length; i++) {
        const cl = clauses[i];
        if (!cl || typeof cl !== 'object' || Array.isArray(cl)) {
          return reject(
            state,
            event.type,
            'Judge Candidate Guard: Clause ' + (i + 1) + ' is malformed.'
          );
        }
        const contextLabel = cl.context || ('Clause ' + (i + 1));
        if (!cl.citedProofIds || !Array.isArray(cl.citedProofIds) || cl.citedProofIds.length === 0) {
          return reject(
            state,
            event.type,
            'Judge Candidate Guard: Clause "' + contextLabel + '" cites no Proof IDs.'
          );
        }
        for (let j = 0; j < cl.citedProofIds.length; j++) {
          const pid = cl.citedProofIds[j];
          if (!admittedIds.has(pid)) {
            return reject(
              state,
              event.type,
              'Judge Candidate Guard: Clause "' + contextLabel + '" cites unverified Proof "' + pid + '".'
            );
          }
        }
      }

      next.candidate = {
        round: state.round,
        summary: event.summary,
        clauses: clauses.map((c, idx) => ({
          id: 'C' + (idx + 1),
          context: c.context,
          conclusion: c.conclusion,
          citedProofIds: c.citedProofIds
        }))
      };
      next.judge.status = 'idle';
      next.phase = 'confirming';
      activeSeats(next).forEach((s) => {
        s.status = 'thinking';
      });
      return succeed(
        state,
        next,
        event.type,
        'Judge audited Proofs and synthesized Round ' + state.round + ' Candidate (' + clauses.length + ' clauses).'
      );
    }

    case 'WITHDRAW_OBJECTION': {
      const obj = next.objections.find((o) => o.id === event.objectionId);
      if (!obj) {
        return reject(state, event.type, 'Objection "' + event.objectionId + '" not found.');
      }
      // VULNERABILITY FIX 1: Permanently block withdrawal of preserved_excused objections
      if (obj.status === 'preserved_excused') {
        return reject(
          state,
          event.type,
          'Objection Immutability Guard: Objection "' +
            obj.id +
            '" is locked as preserved_excused and cannot be withdrawn.'
        );
      }
      if (obj.status === 'withdrawn') {
        return reject(state, event.type, 'Objection "' + obj.id + '" is already withdrawn.');
      }
      // VULNERABILITY FIX 2: Check if seat is excused
      const callingSeat = next.seats.find((s) => s.id === event.seatId);
      if (!callingSeat || callingSeat.status === 'excused') {
        return reject(
          state,
          event.type,
          'Objection Ownership Guard: Excused seat "' + event.seatId + '" cannot withdraw objections.'
        );
      }
      // Ownership check
      if (obj.seatId !== event.seatId) {
        return reject(
          state,
          event.type,
          'Objection Ownership Guard: Seat "' +
            event.seatId +
            '" cannot withdraw Objection "' +
            obj.id +
            '" owned by "' +
            obj.seatId +
            '".'
        );
      }
      obj.status = 'withdrawn';
      return succeed(
        state,
        next,
        event.type,
        'Seat "' + event.seatId + '" withdrew its own Objection ' + obj.id + '.'
      );
    }

    case 'CAST_VOTE': {
      if (currentPhase !== 'confirming') {
        return reject(state, event.type, 'Seats can only vote during the confirming phase.');
      }
      const seat = next.seats.find((s) => s.id === event.seatId);
      if (!seat || seat.status === 'excused') {
        return reject(state, event.type, 'Seat "' + event.seatId + '" is not an active voting Seat.');
      }
      if (event.vote === 'accept') {
        next.objections.forEach((o) => {
          if (o.seatId === seat.id && o.status === 'open') {
            o.status = 'withdrawn';
          }
        });
        seat.status = 'accepted';
        return succeed(
          state,
          next,
          event.type,
          'Seat "' + seat.id + '" voted ACCEPT on Round ' + state.round + ' Candidate.'
        );
      }
      if (event.vote === 'object') {
        if (!event.reason || !String(event.reason).trim()) {
          return reject(state, event.type, 'Objection Guard: An Objection requires a concrete reason.');
        }
        const proof = next.proofs.find((p) => p.id === event.proofId);
        if (!proof || proof.status === 'rejected') {
          return reject(state, event.type, 'Objection Guard: Objection must cite a valid Proof ID.');
        }
        const objId = 'O' + (next.objections.length + 1);
        next.objections.push({
          id: objId,
          round: state.round,
          seatId: seat.id,
          reason: String(event.reason).trim(),
          proofId: proof.id,
          status: 'open'
        });
        seat.status = 'objected';
        return succeed(
          state,
          next,
          event.type,
          'Seat "' + seat.id + '" raised Objection ' + objId + ' backed by Proof ' + proof.id + '.'
        );
      }
      return reject(state, event.type, 'Unknown vote type "' + event.vote + '".');
    }

    case 'SEAT_FAULT': {
      const seat = next.seats.find((s) => s.id === event.seatId);
      if (!seat || seat.status === 'excused') {
        return reject(state, event.type, 'Seat "' + event.seatId + '" is not active.');
      }
      seat.status = 'fault_quota';
      next.returnPhase = state.phase;
      next.phase = 'seat_fault';
      next.faultSeatId = seat.id;
      return succeed(
        state,
        next,
        event.type,
        'Seat "' + seat.id + '" faulted (' + (event.reason || 'Quota reached') + '). Paused in seat_fault.'
      );
    }

    case 'RETRY_SEAT': {
      if (currentPhase !== 'seat_fault') {
        return reject(state, event.type, 'Can only retry a Seat from seat_fault.');
      }
      const targetId = event.seatId || state.faultSeatId;
      const seat = next.seats.find((s) => s.id === targetId);
      if (!seat) {
        return reject(state, event.type, 'Faulted Seat not found.');
      }
      if (seat.retries >= state.maxRetriesPerSeat) {
        return reject(
          state,
          event.type,
          'Retry Cap Guard: Seat "' +
            seat.id +
            '" reached ' +
            seat.retries +
            '/' +
            state.maxRetriesPerSeat +
            ' retries. Excuse Seat instead.'
        );
      }
      seat.retries += 1;
      seat.status = 'thinking';
      next.phase = state.returnPhase || 'reviewing';
      next.faultSeatId = null;
      return succeed(
        state,
        next,
        event.type,
        'Retrying Seat "' +
          seat.id +
          '" (' +
          seat.retries +
          '/' +
          state.maxRetriesPerSeat +
          '); resumed "' +
          toPrototypePhase(next.phase) +
          '".'
      );
    }

    case 'EXCUSE_SEAT': {
      const targetId = event.seatId || state.faultSeatId;
      const seat = next.seats.find((s) => s.id === targetId);
      if (!seat || seat.status === 'excused') {
        return reject(state, event.type, 'Seat "' + targetId + '" is not active.');
      }
      seat.status = 'excused';
      seat.excusedReason = event.reason || 'Quota reached — excused mid-run';
      let lockedCount = 0;
      next.objections.forEach((o) => {
        if (o.seatId === seat.id && o.status === 'open') {
          o.status = 'preserved_excused';
          lockedCount += 1;
        }
      });
      if (currentPhase === 'seat_fault') {
        next.phase = state.returnPhase || 'reviewing';
        next.faultSeatId = null;
      }
      const remaining = activeSeats(next).length;
      if (remaining < state.minQuorum) {
        next.phase = 'completed';
        next.verdict = {
          kind: 'Dissent Report (Below Quorum)',
          candidate: next.candidate,
          unresolvedObjections: next.objections.filter((o) => o.status !== 'withdrawn'),
          activeSeatCount: remaining,
          excusedSeatCount: next.seats.length - remaining,
          note:
            'Active seats (' +
            remaining +
            ') dropped below minimum quorum (' +
            state.minQuorum +
            '). Consensus forbidden.'
        };
        return succeed(
          state,
          next,
          event.type,
          'Excused "' + seat.id + '". Active seats fell below quorum → Dissent Report.'
        );
      }
      return succeed(
        state,
        next,
        event.type,
        'Excused Seat "' +
          seat.id +
          '" ("quota is reached, dude is off"). Other ' +
          remaining +
          ' Seats preserved.' +
          (lockedCount > 0 ? ' Locked ' + lockedCount + ' open Objection(s) as preserved_excused.' : '')
      );
    }

    case 'JUDGE_FAULT': {
      next.returnPhase = state.phase;
      next.phase = 'judge_fault';
      next.judge.status = 'fault_quota';
      return succeed(state, next, event.type, 'Judge "' + next.judge.id + '" faulted. Entered judge_fault.');
    }

    case 'RETRY_JUDGE': {
      if (currentPhase !== 'judge_fault' && (currentPhase !== 'seat_fault' || next.judge.status !== 'fault_quota')) {
        return reject(state, event.type, 'Can only retry Judge from judge_fault.');
      }
      next.judge.retries += 1;
      next.judge.status = 'thinking';
      next.phase = state.returnPhase || 'judging';
      return succeed(
        state,
        next,
        event.type,
        'Retried Judge "' + next.judge.id + '"; resumed "' + toPrototypePhase(next.phase) + '".'
      );
    }

    case 'EVALUATE_ROUND': {
      if (currentPhase !== 'confirming') {
        return reject(state, event.type, 'Can only evaluate round from confirming phase.');
      }
      const active = activeSeats(next);
      const unvoted = active.filter((s) => s.status !== 'accepted' && s.status !== 'objected');
      if (unvoted.length > 0) {
        return reject(
          state,
          event.type,
          'Cannot evaluate round: ' + unvoted.length + ' active Seat(s) have not voted yet.'
        );
      }

      // QUORUM DOUBLE-GATE: explicitly ensure active seats >= minQuorum
      if (active.length < state.minQuorum) {
        next.phase = 'completed';
        next.verdict = {
          kind: 'Dissent Report (Below Quorum)',
          candidate: next.candidate,
          unresolvedObjections: next.objections.filter((o) => o.status !== 'withdrawn'),
          activeSeatCount: active.length,
          excusedSeatCount: next.seats.length - active.length,
          note:
            'Active seats (' +
            active.length +
            ') dropped below minimum quorum (' +
            state.minQuorum +
            '). Consensus forbidden.'
        };
        return succeed(
          state,
          next,
          event.type,
          'Cannot evaluate consensus: Active seats (' +
            active.length +
            ') below minimum quorum (' +
            state.minQuorum +
            '). Terminating with Dissent Report.'
        );
      }

      const openObjs = next.objections.filter((o) => o.status === 'open');
      const preservedObjs = next.objections.filter((o) => o.status === 'preserved_excused');

      if (openObjs.length === 0 && preservedObjs.length === 0) {
        next.phase = 'completed';
        next.verdict = {
          kind: 'Unanimous Consensus',
          candidate: next.candidate,
          unresolvedObjections: [],
          activeSeatCount: active.length,
          excusedSeatCount: next.seats.length - active.length,
          note:
            'All ' +
            active.length +
            ' active Seats accepted the Proof-bound Candidate in Round ' +
            state.round +
            ' with zero unresolved Objections.'
        };
        return succeed(state, next, event.type, 'Unanimous Consensus achieved in Round ' + state.round + '!');
      }

      if (openObjs.length === 0 && preservedObjs.length > 0) {
        next.phase = 'completed';
        next.verdict = {
          kind: 'Dissent Report (Preserved Excused-Seat Objection)',
          candidate: next.candidate,
          unresolvedObjections: preservedObjs,
          activeSeatCount: active.length,
          excusedSeatCount: next.seats.length - active.length,
          note:
            'All ' +
            active.length +
            ' remaining active Seats accepted, but ' +
            preservedObjs.length +
            ' Objection(s) from an Excused Seat remain locked.'
        };
        return succeed(
          state,
          next,
          event.type,
          'Completed with Dissent Report: Excused Seat Objection preserved.'
        );
      }

      if (state.round >= state.maxRounds) {
        next.phase = 'completed';
        next.verdict = {
          kind: 'Dissent Report (Round Limit Reached)',
          candidate: next.candidate,
          unresolvedObjections: openObjs.concat(preservedObjs),
          activeSeatCount: active.length,
          excusedSeatCount: next.seats.length - active.length,
          note:
            'Reached max deliberation rounds (' +
            state.maxRounds +
            ') with ' +
            (openObjs.length + preservedObjs.length) +
            ' unresolved Objection(s).'
        };
        return succeed(
          state,
          next,
          event.type,
          'Round limit reached with open Objections → Emitted Dissent Report.'
        );
      }

      next.round += 1;
      next.phase = 'reviewing';
      active.forEach((s) => {
        s.status = 'thinking';
      });
      return succeed(
        state,
        next,
        event.type,
        openObjs.length +
          ' open Objection(s) remain. Advancing to Round ' +
          next.round +
          '/' +
          next.maxRounds +
          '.'
      );
    }

    case 'RESET': {
      const resetConfig = event.config || {
        topic: state.topic,
        minQuorum: state.minQuorum,
        maxRounds: state.maxRounds,
        maxRetriesPerSeat: state.maxRetriesPerSeat
      };
      const fresh = createInitialCouncilState(resetConfig);
      fresh.history = ['[RESET] Council state reset to initial configuration.'];
      fresh.lastTransition = { ok: true, message: 'Council state reset.' };
      return fresh;
    }

    default:
      return reject(state, event.type || 'UNKNOWN', 'Unknown event type.');
  }
}

/**
 * Computes the state machine topology and causal artifact dependency graph.
 * Pure introspection, zero side effects.
 *
 * @param {Object} state - Current CouncilState
 * @param {Object} [options] - Introspection options
 * @param {boolean} [options.canonicalFormat=false] - Return canonical nodes if true
 * @returns {Object} Graph representation
 */
export function getDependencyAndStateGraph(state, options = {}) {
  const nodes = options.canonicalFormat === true ? CANONICAL_STATE_NODES : STATE_NODES;
  const currentPhase = normalizePhase(state.phase);

  const outgoingEdges = STATE_EDGES.filter((e) => e.from === currentPhase).map((e) => {
    let unlocked = true;
    let reason = e.guard;

    if (e.from === 'preflight' && e.to === 'reviewing') {
      unlocked = activeSeats(state).length >= state.minQuorum;
    } else if (e.from === 'reviewing' && e.to === 'judging') {
      const rp = state.proofs.filter((p) => p.round === state.round || p.status === 'pending');
      unlocked = rp.length > 0;
      reason = unlocked ? rp.length + ' Proof(s) ready for Judge' : 'Waiting for >= 1 Proof in Round ' + state.round;
    } else if (e.from === 'confirming' && e.to === 'completed') {
      const active = activeSeats(state);
      const allVoted = active.every((s) => s.status === 'accepted' || s.status === 'objected');
      const openObjs = state.objections.filter((o) => o.status === 'open');
      unlocked = allVoted && (openObjs.length === 0 || state.round >= state.maxRounds);
    } else if (e.from === 'confirming' && e.to === 'reviewing') {
      const active = activeSeats(state);
      const allVoted = active.every((s) => s.status === 'accepted' || s.status === 'objected');
      const openObjs = state.objections.filter((o) => o.status === 'open');
      unlocked = allVoted && openObjs.length > 0 && state.round < state.maxRounds;
    }

    return {
      ...e,
      unlocked,
      dynamicReason: reason
    };
  });

  const lastEdge =
    STATE_EDGES.find(
      (e) => e.from === state.previousPhase && e.to === currentPhase
    ) || null;

  const causalLinks = [];
  (state.proofs || []).forEach((p) => {
    causalLinks.push({
      id: 'dep-seat-proof-' + p.id,
      fromKind: 'seat',
      fromId: p.seatId,
      toKind: 'proof',
      toId: p.id,
      status: p.status,
      label: p.kind
    });
  });

  if (state.candidate && state.candidate.clauses) {
    state.candidate.clauses.forEach((cl) => {
      (cl.citedProofIds || []).forEach((pid) => {
        causalLinks.push({
          id: 'dep-proof-clause-' + pid + '-' + cl.id,
          fromKind: 'proof',
          fromId: pid,
          toKind: 'clause',
          toId: cl.id,
          status: 'admitted',
          label: 'cites ' + pid
        });
      });
    });
  }

  (state.objections || []).forEach((o) => {
    if (o.status !== 'withdrawn') {
      causalLinks.push({
        id: 'dep-obj-seat-' + o.id,
        fromKind: 'seat',
        fromId: o.seatId,
        toKind: 'objection',
        toId: o.id,
        status: o.status,
        label: 'owns ' + o.id
      });
      causalLinks.push({
        id: 'dep-obj-proof-' + o.id,
        fromKind: 'proof',
        fromId: o.proofId,
        toKind: 'objection',
        toId: o.id,
        status: o.status,
        label: 'backs ' + o.id
      });
    }
  });

  return {
    nodes,
    edges: STATE_EDGES,
    activeNodeId: currentPhase,
    activeAlias: currentPhase,
    canonicalPhase: toCanonicalPhase(currentPhase),
    lastEdgeId: lastEdge ? lastEdge.id : null,
    outgoingEdges,
    causalLinks
  };
}
