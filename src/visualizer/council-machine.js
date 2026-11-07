/**
 * Portable State Machine & Dependency Graph Module for The Council
 * Zero DOM dependencies. Can be imported in Node/TypeScript/React or loaded via <script>.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CouncilMachine = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VALID_PROOF_KINDS = ['check', 'citation', 'benchmark', 'derivation'];

  /**
   * Canonical State Machine Topology (Nodes & Directed Edges)
   * Used by the visualizer to show current state, legal next steps, and dependencies.
   */
  const STATE_NODES = [
    { id: 'preflight', label: 'Preflight', subtitle: 'Roster & Souls', x: 80, y: 120 },
    { id: 'clarifying', label: 'Clarifying', subtitle: 'Shared Q&A', x: 250, y: 52 },
    { id: 'reviewing', label: 'Reviewing', subtitle: 'Seats Submit Proof', x: 430, y: 120 },
    { id: 'judging', label: 'Judging', subtitle: 'Audit & Candidate', x: 630, y: 120 },
    { id: 'confirming', label: 'Confirming', subtitle: 'Accept or Object', x: 830, y: 120 },
    { id: 'completed', label: 'Completed', subtitle: 'Verdict Emitted', x: 1030, y: 120 },
    { id: 'seat_fault', label: 'Seat Fault', subtitle: 'Quota: Retry / Excuse', x: 530, y: 235 },
    { id: 'judge_fault', label: 'Judge Fault', subtitle: 'Retry Judge', x: 730, y: 235 }
  ];

  const STATE_EDGES = [
    { id: 'e-pre-clar', from: 'preflight', to: 'clarifying', event: 'START_CLARIFYING', label: 'Ask Clarifications', guard: 'Batch < maxBatches' },
    { id: 'e-pre-rev', from: 'preflight', to: 'reviewing', event: 'BEGIN_ROUND', label: 'Begin Round 1', guard: 'Active Seats >= Quorum' },
    { id: 'e-clar-rev', from: 'clarifying', to: 'reviewing', event: 'BEGIN_ROUND', label: 'Start Round 1', guard: 'Answers broadcast' },
    { id: 'e-rev-jud', from: 'reviewing', to: 'judging', event: 'START_JUDGING', label: 'Send Proofs', guard: '>= 1 Proof in round' },
    { id: 'e-jud-conf', from: 'judging', to: 'confirming', event: 'JUDGE_AUDIT_AND_SYNTHESIZE', label: 'Synthesize Candidate', guard: 'Clauses cite admitted Proofs' },
    { id: 'e-conf-comp', from: 'confirming', to: 'completed', event: 'EVALUATE_ROUND', label: 'Emit Verdict', guard: 'All active Seats voted' },
    { id: 'e-conf-rev', from: 'confirming', to: 'reviewing', event: 'EVALUATE_ROUND', label: 'Next Round', guard: 'Open Objection & round < max' },
    { id: 'e-rev-sfault', from: 'reviewing', to: 'seat_fault', event: 'SEAT_FAULT', label: 'Quota / Timeout', guard: 'Seat faulted' },
    { id: 'e-conf-sfault', from: 'confirming', to: 'seat_fault', event: 'SEAT_FAULT', label: 'Quota / Timeout', guard: 'Seat faulted' },
    { id: 'e-sfault-rev', from: 'seat_fault', to: 'reviewing', event: 'RETRY_SEAT / EXCUSE_SEAT', label: 'Retry or Excuse', guard: 'Retries <= cap or Quorum kept' },
    { id: 'e-sfault-conf', from: 'seat_fault', to: 'confirming', event: 'RETRY_SEAT / EXCUSE_SEAT', label: 'Retry or Excuse', guard: 'Locks open Objection if excused' },
    { id: 'e-jud-jfault', from: 'judging', to: 'judge_fault', event: 'JUDGE_FAULT', label: 'Judge Quota / Fault', guard: 'Judge faulted' },
    { id: 'e-jfault-jud', from: 'judge_fault', to: 'judging', event: 'RETRY_JUDGE', label: 'Retry Judge', guard: 'Judge cannot be excused' },
    { id: 'e-jfault-comp', from: 'judge_fault', to: 'completed', event: 'JUDGE_FAULT', label: 'Judge Fault Verdict', guard: 'Retries exhausted or non-retryable' }
  ];

  function createInitialCouncilState(config) {
    const cfg = config || {};
    return {
      topic: cfg.topic || 'What is the better operating system?',
      phase: 'preflight',
      previousPhase: null,
      lastEventName: 'INIT',
      returnPhase: null,
      faultSeatId: null,
      round: 0,
      maxRounds: cfg.maxRounds || 3,
      clarificationBatch: 0,
      maxClarificationBatches: cfg.maxClarificationBatches ?? 2,
      minQuorum: cfg.minQuorum || 2,
      maxRetriesPerSeat: cfg.maxRetriesPerSeat ?? 1,
      clarifications: [],
      judge: {
        id: (cfg.judge && cfg.judge.id) || 'judge-astra',
        harness: (cfg.judge && cfg.judge.harness) || 'codex',
        model: (cfg.judge && cfg.judge.model) || 'gpt-6-astra (max)',
        soul: (cfg.judge && cfg.judge.soul) || 'Impartial Proof Auditor: admits only scoped, sourced proofs and synthesizes context-partitioned candidates without adding personal claims.',
        status: 'idle',
        retries: 0
      },
      seats: (cfg.seats || []).map(function (s) {
        return {
          id: s.id,
          harness: s.harness,
          model: s.model,
          soul: s.soul,
          status: 'idle',
          retries: 0,
          excusedReason: null
        };
      }),
      proofs: [],
      candidate: null,
      objections: [],
      verdict: null,
      lastTransition: { ok: true, message: 'Initialized Council state machine in Preflight.' },
      history: ['[INIT] Council initialized in preflight state.']
    };
  }

  function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
  }

  function activeSeats(state) {
    return state.seats.filter(function (s) { return s.status !== 'excused'; });
  }

  function reject(state, eventType, reason) {
    const next = cloneState(state);
    next.lastEventName = eventType;
    next.lastTransition = { ok: false, message: 'Guard rejected ' + eventType + ': ' + reason };
    next.history.unshift('[REJECTED] ' + reason);
    return next;
  }

  function succeed(prevState, next, eventType, message) {
    next.previousPhase = prevState.phase;
    next.lastEventName = eventType;
    next.lastTransition = { ok: true, message: message };
    next.history.unshift('[OK] ' + message);
    return next;
  }

  function transitionCouncil(state, event) {
    const next = cloneState(state);

    switch (event.type) {
      case 'ADD_SEAT': {
        if (state.phase !== 'preflight') {
          return reject(state, event.type, 'Seats can only be added during preflight before deliberation begins.');
        }
        const s = event.seat;
        if (!s || !s.id || !s.harness || !s.model || !s.soul) {
          return reject(state, event.type, 'Seat requires id, harness, model, and soul.');
        }
        if (next.seats.some(function (x) { return x.id === s.id; })) {
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
        const seat = next.seats.find(function (s) { return s.id === event.seatId; });
        if (!seat || seat.status === 'excused') {
          return reject(state, event.type, 'Cannot update telemetry for unknown or excused Seat "' + event.seatId + '".');
        }
        seat.status = event.status;
        return succeed(state, next, event.type, 'Observer telemetry: Seat "' + seat.id + '" is now [' + event.status.toUpperCase() + '].');
      }

      case 'START_CLARIFYING': {
        if (state.phase !== 'preflight' && state.phase !== 'clarifying') {
          return reject(state, event.type, 'Cannot start clarification from phase "' + state.phase + '".');
        }
        if (state.clarificationBatch >= state.maxClarificationBatches) {
          return reject(state, event.type, 'Maximum clarification batches (' + state.maxClarificationBatches + ') reached.');
        }
        next.phase = 'clarifying';
        next.clarificationBatch += 1;
        activeSeats(next).forEach(function (s) { s.status = 'thinking'; });
        return succeed(state, next, event.type, 'Started Clarification Batch ' + next.clarificationBatch + '/' + next.maxClarificationBatches + '.');
      }

      case 'PUBLISH_CLARIFICATION': {
        if (state.phase !== 'clarifying') {
          return reject(state, event.type, 'Can only publish clarification answers during clarifying phase.');
        }
        if (!event.answer || !event.answer.trim()) {
          return reject(state, event.type, 'Clarification answer cannot be empty.');
        }
        next.clarifications.push({
          batch: state.clarificationBatch,
          answer: event.answer.trim()
        });
        activeSeats(next).forEach(function (s) { s.status = 'idle'; });
        return succeed(state, next, event.type, 'Broadcast Batch ' + state.clarificationBatch + ' clarification answer to all active Seats.');
      }

      case 'BEGIN_ROUND': {
        if (['preflight', 'clarifying', 'confirming'].indexOf(state.phase) === -1) {
          return reject(state, event.type, 'Cannot begin a deliberation round from phase "' + state.phase + '".');
        }
        if (state.round >= state.maxRounds) {
          return reject(state, event.type, 'Maximum deliberation rounds (' + state.maxRounds + ') already reached.');
        }
        if (activeSeats(state).length < state.minQuorum) {
          return reject(state, event.type, 'Active Seats (' + activeSeats(state).length + ') below minimum quorum (' + state.minQuorum + ').');
        }
        next.round += 1;
        next.phase = 'reviewing';
        next.judge.status = 'idle';
        activeSeats(next).forEach(function (s) { s.status = 'thinking'; });
        return succeed(state, next, event.type, 'Entered Deliberation Round ' + next.round + '/' + next.maxRounds + ' (reviewing).');
      }

      case 'SUBMIT_PROOF': {
        if (['reviewing', 'confirming'].indexOf(state.phase) === -1) {
          return reject(state, event.type, 'Proofs can only be submitted during reviewing or confirming.');
        }
        const seat = next.seats.find(function (s) { return s.id === event.seatId; });
        if (!seat || seat.status === 'excused') {
          return reject(state, event.type, 'Seat "' + event.seatId + '" is not an active Seat.');
        }
        if (!event.scope || !event.scope.trim()) {
          return reject(state, event.type, 'Structural Proof Guard: "scope" condition is required.');
        }
        if (VALID_PROOF_KINDS.indexOf(event.kind) === -1) {
          return reject(state, event.type, 'Structural Proof Guard: "kind" must be check, citation, benchmark, or derivation.');
        }
        if (!event.source || !event.source.trim()) {
          return reject(state, event.type, 'Structural Proof Guard: verifiable "source" is required; bare opinions are forbidden.');
        }
        if (!event.statement || !event.statement.trim()) {
          return reject(state, event.type, 'Structural Proof Guard: falsifiable "statement" is required.');
        }
        const proofId = event.id || ('P' + (next.proofs.length + 1));
        next.proofs.push({
          id: proofId,
          round: state.round,
          seatId: seat.id,
          scope: event.scope.trim(),
          kind: event.kind,
          source: event.source.trim(),
          statement: event.statement.trim(),
          status: 'pending',
          judgeNote: null
        });
        if (state.phase === 'reviewing') {
          seat.status = 'proof_submitted';
        }
        return succeed(state, next, event.type, 'Seat "' + seat.id + '" submitted Proof ' + proofId + ' (' + event.kind + ').');
      }

      case 'START_JUDGING': {
        if (state.phase !== 'reviewing') {
          return reject(state, event.type, 'Can only transition to judging from reviewing.');
        }
        const roundProofs = state.proofs.filter(function (p) { return p.round === state.round || p.status === 'pending'; });
        if (roundProofs.length === 0) {
          return reject(state, event.type, 'At least one Proof must be submitted before entering judging.');
        }
        next.phase = 'judging';
        next.judge.status = 'thinking';
        return succeed(state, next, event.type, 'Transitioned to judging. Judge "' + next.judge.id + '" is auditing ' + roundProofs.length + ' Proof(s).');
      }

      case 'JUDGE_AUDIT_AND_SYNTHESIZE': {
        if (state.phase !== 'judging') {
          return reject(state, event.type, 'Judge can only synthesize a Candidate during the judging phase.');
        }
        const decisions = event.proofDecisions || {};
        next.proofs.forEach(function (p) {
          if (decisions[p.id]) {
            p.status = decisions[p.id].status;
            p.judgeNote = decisions[p.id].note || '';
          } else if (p.status === 'pending') {
            p.status = 'admitted';
            p.judgeNote = 'Admitted by Judge.';
          }
        });

        const admittedIds = {};
        next.proofs.forEach(function (p) {
          if (p.status === 'admitted') admittedIds[p.id] = true;
        });

        const clauses = event.clauses || [];
        if (clauses.length === 0) {
          return reject(state, event.type, 'Judge Candidate Guard: Candidate requires at least one clause.');
        }
        for (let i = 0; i < clauses.length; i++) {
          const cl = clauses[i];
          if (!cl.citedProofIds || cl.citedProofIds.length === 0) {
            return reject(state, event.type, 'Judge Candidate Guard: Clause "' + cl.context + '" cites no Proof IDs.');
          }
          for (let j = 0; j < cl.citedProofIds.length; j++) {
            const pid = cl.citedProofIds[j];
            if (!admittedIds[pid]) {
              return reject(state, event.type, 'Judge Candidate Guard: Clause "' + cl.context + '" cites unverified Proof "' + pid + '".');
            }
          }
        }

        next.candidate = {
          round: state.round,
          summary: event.summary,
          clauses: clauses.map(function (c, idx) {
            return {
              id: 'C' + (idx + 1),
              context: c.context,
              conclusion: c.conclusion,
              citedProofIds: c.citedProofIds
            };
          })
        };
        next.judge.status = 'idle';
        next.phase = 'confirming';
        activeSeats(next).forEach(function (s) { s.status = 'thinking'; });
        return succeed(state, next, event.type, 'Judge audited Proofs and synthesized Round ' + state.round + ' Candidate (' + clauses.length + ' clauses).');
      }

      case 'WITHDRAW_OBJECTION': {
        const obj = next.objections.find(function (o) { return o.id === event.objectionId; });
        if (!obj) {
          return reject(state, event.type, 'Objection "' + event.objectionId + '" not found.');
        }
        if (obj.seatId !== event.seatId) {
          return reject(state, event.type, 'Objection Ownership Guard: Seat "' + event.seatId + '" cannot withdraw Objection "' + obj.id + '" owned by "' + obj.seatId + '".');
        }
        obj.status = 'withdrawn';
        return succeed(state, next, event.type, 'Seat "' + event.seatId + '" withdrew its own Objection ' + obj.id + '.');
      }

      case 'CAST_VOTE': {
        if (state.phase !== 'confirming') {
          return reject(state, event.type, 'Seats can only vote during the confirming phase.');
        }
        const seat = next.seats.find(function (s) { return s.id === event.seatId; });
        if (!seat || seat.status === 'excused') {
          return reject(state, event.type, 'Seat "' + event.seatId + '" is not an active voting Seat.');
        }
        if (event.vote === 'accept') {
          next.objections.forEach(function (o) {
            if (o.seatId === seat.id && o.status === 'open') {
              o.status = 'withdrawn';
            }
          });
          seat.status = 'accepted';
          return succeed(state, next, event.type, 'Seat "' + seat.id + '" voted ACCEPT on Round ' + state.round + ' Candidate.');
        }
        if (event.vote === 'object') {
          if (!event.reason || !event.reason.trim()) {
            return reject(state, event.type, 'Objection Guard: An Objection requires a concrete reason.');
          }
          const proof = next.proofs.find(function (p) { return p.id === event.proofId; });
          if (!proof || proof.status === 'rejected') {
            return reject(state, event.type, 'Objection Guard: Objection must cite a valid Proof ID.');
          }
          const objId = 'O' + (next.objections.length + 1);
          next.objections.push({
            id: objId,
            round: state.round,
            seatId: seat.id,
            reason: event.reason.trim(),
            proofId: proof.id,
            status: 'open'
          });
          seat.status = 'objected';
          return succeed(state, next, event.type, 'Seat "' + seat.id + '" raised Objection ' + objId + ' backed by Proof ' + proof.id + '.');
        }
        return reject(state, event.type, 'Unknown vote type "' + event.vote + '".');
      }

      case 'SEAT_FAULT': {
        const seat = next.seats.find(function (s) { return s.id === event.seatId; });
        if (!seat || seat.status === 'excused') {
          return reject(state, event.type, 'Seat "' + event.seatId + '" is not active.');
        }
        const isValidSeatFaultStatus =
          event.status === 'fault_quota' || event.status === 'fault_timeout' || event.status === 'fault';
        seat.status = isValidSeatFaultStatus ? event.status : 'fault_quota';
        next.returnPhase = state.phase;
        next.phase = 'seat_fault';
        next.faultSeatId = seat.id;
        return succeed(state, next, event.type, 'Seat "' + seat.id + '" faulted (' + (event.reason || 'Quota reached') + '). Paused in seat_fault.');
      }

      case 'RETRY_SEAT': {
        if (state.phase !== 'seat_fault') {
          return reject(state, event.type, 'Can only retry a Seat from seat_fault.');
        }
        const seat = next.seats.find(function (s) { return s.id === (event.seatId || state.faultSeatId); });
        if (!seat) {
          return reject(state, event.type, 'Faulted Seat not found.');
        }
        if (seat.retries >= state.maxRetriesPerSeat) {
          return reject(state, event.type, 'Retry Cap Guard: Seat "' + seat.id + '" reached ' + seat.retries + '/' + state.maxRetriesPerSeat + ' retries. Excuse Seat instead.');
        }
        seat.retries += 1;
        seat.status = 'thinking';
        next.phase = state.returnPhase || 'reviewing';
        next.faultSeatId = null;
        return succeed(state, next, event.type, 'Retrying Seat "' + seat.id + '" (' + seat.retries + '/' + state.maxRetriesPerSeat + '); resumed "' + next.phase + '".');
      }

      case 'EXCUSE_SEAT': {
        const targetId = event.seatId || state.faultSeatId;
        const seat = next.seats.find(function (s) { return s.id === targetId; });
        if (!seat || seat.status === 'excused') {
          return reject(state, event.type, 'Seat "' + targetId + '" is not active.');
        }
        seat.status = 'excused';
        seat.excusedReason = event.reason || 'Quota reached — excused mid-run';
        let lockedCount = 0;
        next.objections.forEach(function (o) {
          if (o.seatId === seat.id && o.status === 'open') {
            o.status = 'preserved_excused';
            lockedCount += 1;
          }
        });
        if (state.phase === 'seat_fault') {
          next.phase = state.returnPhase || 'reviewing';
          next.faultSeatId = null;
        }
        const remaining = activeSeats(next).length;
        if (remaining < state.minQuorum) {
          next.phase = 'completed';
          next.verdict = {
            kind: 'Dissent Report (Below Quorum)',
            candidate: next.candidate,
            unresolvedObjections: next.objections.filter(function (o) { return o.status !== 'withdrawn'; }),
            activeSeatCount: remaining,
            excusedSeatCount: next.seats.length - remaining,
            note: 'Active seats (' + remaining + ') dropped below minimum quorum (' + state.minQuorum + '). Consensus forbidden.'
          };
          return succeed(state, next, event.type, 'Excused "' + seat.id + '" (' + seat.excusedReason + '). Active seats fell below quorum → Dissent Report.');
        }
        return succeed(
          state,
          next,
          event.type,
          'Excused Seat "' + seat.id + '" (' + seat.excusedReason + '). Other ' + remaining + ' Seats preserved.' +
            (lockedCount > 0 ? ' Locked ' + lockedCount + ' open Objection(s) as preserved_excused.' : '')
        );
      }

      case 'JUDGE_FAULT': {
        if (state.phase === 'preflight' || state.phase === 'completed') {
          return reject(state, event.type, 'Judge cannot fault in "' + state.phase + '" phase.');
        }
        if (event.terminal === true && state.phase !== 'judging' && state.phase !== 'judge_fault') {
          return reject(state, event.type, 'Terminal Judge fault is only valid during judging or judge_fault.');
        }
        const faultReason = event.reason || event.error || '';
        const isValidJudgeFaultStatus =
          event.status === 'fault_quota' || event.status === 'fault_timeout' || event.status === 'fault';
        const faultStatus = isValidJudgeFaultStatus ? event.status : 'fault_quota';
        next.judge.status = faultStatus;
        if (event.terminal === true) {
          const remaining = activeSeats(next).length;
          next.phase = 'completed';
          next.verdict = {
            kind: 'Dissent Report (Judge Fault)',
            candidate: next.candidate || null,
            unresolvedObjections: (next.objections || []).filter(function (o) { return o.status !== 'withdrawn'; }),
            activeSeatCount: remaining,
            excusedSeatCount: next.seats.length - remaining,
            note: 'Judge candidate synthesis failed: ' + (faultReason || 'Judge fault')
          };
          return succeed(
            state,
            next,
            event.type,
            'Judge "' + next.judge.id + '" faulted' + (faultReason ? ' (' + faultReason + ')' : '') + ' → Dissent Report (Judge Fault).'
          );
        }
        next.returnPhase = state.phase;
        next.phase = 'judge_fault';
        return succeed(
          state,
          next,
          event.type,
          'Judge "' + next.judge.id + '" faulted' + (faultReason ? ' (' + faultReason + ')' : '') + '. Entered judge_fault.'
        );
      }

      case 'RETRY_JUDGE': {
        const isJudgeFaultStatus =
          next.judge.status === 'fault_quota' ||
          next.judge.status === 'fault_timeout' ||
          next.judge.status === 'fault';
        const isCanonicalRecoveryForJudge =
          String(state.phase).toUpperCase() === 'RECOVERY' && isJudgeFaultStatus && !state.faultSeatId;
        if (state.phase !== 'judge_fault' && !isCanonicalRecoveryForJudge) {
          return reject(state, event.type, 'Can only retry Judge from judge_fault.');
        }
        next.judge.retries += 1;
        next.judge.status = 'thinking';
        next.phase = state.returnPhase || 'judging';
        return succeed(state, next, event.type, 'Retried Judge "' + next.judge.id + '"; resumed "' + next.phase + '".');
      }

      case 'EVALUATE_ROUND': {
        if (state.phase !== 'confirming') {
          return reject(state, event.type, 'Can only evaluate round from confirming phase.');
        }
        const active = activeSeats(next);
        const unvoted = active.filter(function (s) { return s.status !== 'accepted' && s.status !== 'objected'; });
        if (unvoted.length > 0) {
          return reject(state, event.type, 'Cannot evaluate round: ' + unvoted.length + ' active Seat(s) have not voted yet.');
        }
        const openObjs = next.objections.filter(function (o) { return o.status === 'open'; });
        const preservedObjs = next.objections.filter(function (o) { return o.status === 'preserved_excused'; });

        if (openObjs.length === 0 && preservedObjs.length === 0) {
          next.phase = 'completed';
          next.verdict = {
            kind: 'Unanimous Consensus',
            candidate: next.candidate,
            unresolvedObjections: [],
            activeSeatCount: active.length,
            excusedSeatCount: next.seats.length - active.length,
            note: 'All ' + active.length + ' active Seats accepted the Proof-bound Candidate in Round ' + state.round + ' with zero unresolved Objections.'
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
            note: 'All ' + active.length + ' remaining active Seats accepted, but ' + preservedObjs.length + ' Objection(s) from an Excused Seat remain locked.'
          };
          return succeed(state, next, event.type, 'Completed with Dissent Report: Excused Seat Objection preserved.');
        }

        if (state.round >= state.maxRounds) {
          next.phase = 'completed';
          next.verdict = {
            kind: 'Dissent Report (Round Limit Reached)',
            candidate: next.candidate,
            unresolvedObjections: openObjs.concat(preservedObjs),
            activeSeatCount: active.length,
            excusedSeatCount: next.seats.length - active.length,
            note: 'Reached max deliberation rounds (' + state.maxRounds + ') with ' + (openObjs.length + preservedObjs.length) + ' unresolved Objection(s).'
          };
          return succeed(state, next, event.type, 'Round limit reached with open Objections → Emitted Dissent Report.');
        }

        next.round += 1;
        next.phase = 'reviewing';
        active.forEach(function (s) { s.status = 'thinking'; });
        return succeed(state, next, event.type, openObjs.length + ' open Objection(s) remain. Advancing to Round ' + next.round + '/' + next.maxRounds + '.');
      }

      default:
        return reject(state, event.type || 'UNKNOWN', 'Unknown event type.');
    }
  }

  /**
   * Computes the live State Machine Graph + Causal Dependency Graph for visualization:
   * - Which state node is active
   * - Which transition edge just fired
   * - Which outgoing transitions ("What Comes Next") are currently unlocked vs guard-locked
   * - Causal dependency links: Seat -> Proof -> Judge -> Candidate Clause -> Objection
   */
  function getDependencyAndStateGraph(state) {
    const outgoingEdges = STATE_EDGES.filter(function (e) { return e.from === state.phase; }).map(function (e) {
      let unlocked = true;
      let reason = e.guard;
      if (e.from === 'preflight' && e.to === 'reviewing') {
        unlocked = activeSeats(state).length >= state.minQuorum;
      } else if (e.from === 'reviewing' && e.to === 'judging') {
        const rp = state.proofs.filter(function (p) { return p.round === state.round || p.status === 'pending'; });
        unlocked = rp.length > 0;
        reason = unlocked ? rp.length + ' Proof(s) ready for Judge' : 'Waiting for >= 1 Proof in Round ' + state.round;
      } else if (e.from === 'confirming' && e.to === 'completed') {
        const active = activeSeats(state);
        const allVoted = active.every(function (s) { return s.status === 'accepted' || s.status === 'objected'; });
        const openObjs = state.objections.filter(function (o) { return o.status === 'open'; });
        unlocked = allVoted && (openObjs.length === 0 || state.round >= state.maxRounds);
      } else if (e.from === 'confirming' && e.to === 'reviewing') {
        const active = activeSeats(state);
        const allVoted = active.every(function (s) { return s.status === 'accepted' || s.status === 'objected'; });
        const openObjs = state.objections.filter(function (o) { return o.status === 'open'; });
        unlocked = allVoted && openObjs.length > 0 && state.round < state.maxRounds;
      }
      return Object.assign({}, e, { unlocked: unlocked, dynamicReason: reason });
    });

    const lastEdge = STATE_EDGES.find(function (e) {
      return e.from === state.previousPhase && e.to === state.phase;
    }) || null;

    // Build causal artifact dependency edges:
    // Seat -> Proof, Proof -> Candidate Clause, Objection -> Proof & Seat
    const causalLinks = [];
    state.proofs.forEach(function (p) {
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
      state.candidate.clauses.forEach(function (cl) {
        (cl.citedProofIds || []).forEach(function (pid) {
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

    state.objections.forEach(function (o) {
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
      nodes: STATE_NODES,
      edges: STATE_EDGES,
      activeNodeId: state.phase,
      lastEdgeId: lastEdge ? lastEdge.id : null,
      outgoingEdges: outgoingEdges,
      causalLinks: causalLinks
    };
  }

  return {
    VALID_PROOF_KINDS: VALID_PROOF_KINDS,
    STATE_NODES: STATE_NODES,
    STATE_EDGES: STATE_EDGES,
    createInitialCouncilState: createInitialCouncilState,
    transitionCouncil: transitionCouncil,
    getDependencyAndStateGraph: getDependencyAndStateGraph
  };
});
