/**
 * Production Constants and Phase Definitions for The Council State Machine
 * ESM Module (Node >= 22)
 */

/**
 * Canonical 9 Phases of The Council mapped to runtime phase identifiers
 * Preserves 100% compatibility with prototype visualizers, tests, and walkthroughs.
 * @readonly
 */
export const COUNCIL_PHASES = Object.freeze({
  ROSTER_CONFIGURATION: 'preflight',
  DISCOVERY: 'clarifying',
  DELIBERATION: 'reviewing',
  JUDGE_AUDIT_SYNTHESIS: 'judging',
  VOTING: 'confirming',
  CONSENSUS_REACHED: 'completed',
  DISSENT_REPORT: 'completed',
  ROUND_TIMEOUT: 'completed',
  RECOVERY: 'seat_fault',
  // Lowercase aliases
  preflight: 'preflight',
  clarifying: 'clarifying',
  reviewing: 'reviewing',
  judging: 'judging',
  confirming: 'confirming',
  completed: 'completed',
  seat_fault: 'seat_fault',
  judge_fault: 'judge_fault'
});

/**
 * Canonical uppercase phase identifiers
 * @readonly
 * @enum {string}
 */
export const CANONICAL_PHASES = Object.freeze({
  ROSTER_CONFIGURATION: 'ROSTER_CONFIGURATION',
  DISCOVERY: 'DISCOVERY',
  DELIBERATION: 'DELIBERATION',
  JUDGE_AUDIT_SYNTHESIS: 'JUDGE_AUDIT_SYNTHESIS',
  VOTING: 'VOTING',
  CONSENSUS_REACHED: 'CONSENSUS_REACHED',
  DISSENT_REPORT: 'DISSENT_REPORT',
  ROUND_TIMEOUT: 'ROUND_TIMEOUT',
  RECOVERY: 'RECOVERY'
});

/**
 * Prototype lowercase aliases mapping to canonical uppercase phases
 * @readonly
 */
export const PROTOTYPE_PHASE_ALIASES = Object.freeze({
  preflight: 'ROSTER_CONFIGURATION',
  clarifying: 'DISCOVERY',
  reviewing: 'DELIBERATION',
  judging: 'JUDGE_AUDIT_SYNTHESIS',
  confirming: 'VOTING',
  completed: 'CONSENSUS_REACHED',
  seat_fault: 'RECOVERY',
  judge_fault: 'RECOVERY'
});

/**
 * Canonical to prototype alias mapping
 * @readonly
 */
export const CANONICAL_TO_PROTOTYPE_PHASES = Object.freeze({
  ROSTER_CONFIGURATION: 'preflight',
  DISCOVERY: 'clarifying',
  DELIBERATION: 'reviewing',
  JUDGE_AUDIT_SYNTHESIS: 'judging',
  VOTING: 'confirming',
  CONSENSUS_REACHED: 'completed',
  DISSENT_REPORT: 'completed',
  ROUND_TIMEOUT: 'completed',
  RECOVERY: 'seat_fault'
});

/**
 * Canonical 17 Events Enum
 * @readonly
 * @enum {string}
 */
export const COUNCIL_EVENTS = Object.freeze({
  ADD_SEAT: 'ADD_SEAT',
  SEAT_TELEMETRY: 'SEAT_TELEMETRY',
  START_CLARIFYING: 'START_CLARIFYING',
  PUBLISH_CLARIFICATION: 'PUBLISH_CLARIFICATION',
  BEGIN_ROUND: 'BEGIN_ROUND',
  SUBMIT_PROOF: 'SUBMIT_PROOF',
  START_JUDGING: 'START_JUDGING',
  JUDGE_AUDIT_AND_SYNTHESIZE: 'JUDGE_AUDIT_AND_SYNTHESIZE',
  WITHDRAW_OBJECTION: 'WITHDRAW_OBJECTION',
  CAST_VOTE: 'CAST_VOTE',
  SEAT_FAULT: 'SEAT_FAULT',
  RETRY_SEAT: 'RETRY_SEAT',
  EXCUSE_SEAT: 'EXCUSE_SEAT',
  JUDGE_FAULT: 'JUDGE_FAULT',
  RETRY_JUDGE: 'RETRY_JUDGE',
  EVALUATE_ROUND: 'EVALUATE_ROUND',
  RESET: 'RESET'
});

/**
 * Supported proof kinds
 * @readonly
 */
export const VALID_PROOF_KINDS = Object.freeze(['check', 'citation', 'benchmark', 'derivation']);

/**
 * Default configuration values
 * @readonly
 */
export const DEFAULT_COUNCIL_CONFIG = Object.freeze({
  topic: 'What is the better operating system?',
  minQuorum: 2,
  maxRounds: 3,
  clarificationBatch: 0,
  maxClarificationBatches: 2,
  maxRetriesPerSeat: 1,
  defaultJudge: Object.freeze({
    id: 'judge-astra',
    harness: 'codex',
    model: 'gpt-6-astra (max)',
    soul: 'Impartial Proof Auditor: admits only scoped, sourced proofs and synthesizes context-partitioned candidates without adding personal claims.',
    status: 'idle',
    retries: 0
  })
});

/**
 * State Nodes for Visualizer and Graph Introspection
 */
export const STATE_NODES = Object.freeze([
  { id: 'preflight', label: 'Preflight', subtitle: 'Roster & Souls', x: 80, y: 120 },
  { id: 'clarifying', label: 'Clarifying', subtitle: 'Shared Q&A', x: 250, y: 52 },
  { id: 'reviewing', label: 'Reviewing', subtitle: 'Seats Submit Proof', x: 430, y: 120 },
  { id: 'judging', label: 'Judging', subtitle: 'Audit & Candidate', x: 630, y: 120 },
  { id: 'confirming', label: 'Confirming', subtitle: 'Accept or Object', x: 830, y: 120 },
  { id: 'completed', label: 'Completed', subtitle: 'Verdict Emitted', x: 1030, y: 120 },
  { id: 'seat_fault', label: 'Seat Fault', subtitle: 'Quota: Retry / Excuse', x: 530, y: 235 },
  { id: 'judge_fault', label: 'Judge Fault', subtitle: 'Retry Judge', x: 730, y: 235 }
]);

export const PROTOTYPE_STATE_NODES = STATE_NODES;

/**
 * Canonical 9-node presentation metadata for visualizers
 */
export const CANONICAL_STATE_NODES = Object.freeze([
  { id: 'ROSTER_CONFIGURATION', alias: 'preflight', label: 'Roster Configuration', subtitle: 'Seats & Souls', x: 80, y: 120 },
  { id: 'DISCOVERY', alias: 'clarifying', label: 'Discovery', subtitle: 'Shared Q&A', x: 250, y: 52 },
  { id: 'DELIBERATION', alias: 'reviewing', label: 'Deliberation', subtitle: 'Seats Submit Proof', x: 430, y: 120 },
  { id: 'JUDGE_AUDIT_SYNTHESIS', alias: 'judging', label: 'Judge Audit & Synthesis', subtitle: 'Audit & Candidate', x: 630, y: 120 },
  { id: 'VOTING', alias: 'confirming', label: 'Voting', subtitle: 'Accept or Object', x: 830, y: 120 },
  { id: 'CONSENSUS_REACHED', alias: 'completed', label: 'Consensus Reached', subtitle: 'Unanimous Agreement', x: 1030, y: 80 },
  { id: 'DISSENT_REPORT', alias: 'completed', label: 'Dissent Report', subtitle: 'Preserved Objections', x: 1030, y: 160 },
  { id: 'ROUND_TIMEOUT', alias: 'completed', label: 'Round Timeout', subtitle: 'Max Rounds Limit', x: 1030, y: 240 },
  { id: 'RECOVERY', alias: 'seat_fault', label: 'Recovery', subtitle: 'Quota / Fault Recovery', x: 530, y: 235 }
]);

/**
 * State Edges representing valid transitions between phases
 */
export const STATE_EDGES = Object.freeze([
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
  { id: 'e-jud-jfault', from: 'judging', to: 'judge_fault', event: 'JUDGE_FAULT', label: 'Judge Quota', guard: 'Judge faulted' },
  { id: 'e-jfault-jud', from: 'judge_fault', to: 'judging', event: 'RETRY_JUDGE', label: 'Retry Judge', guard: 'Judge cannot be excused' }
]);

/**
 * Normalizes any phase representation into a runtime phase identifier ('preflight', 'reviewing', etc.)
 * @param {string} phase
 * @returns {string} runtime phase
 */
export function normalizePhase(phase) {
  if (!phase) return 'preflight';
  const str = String(phase);
  if (CANONICAL_TO_PROTOTYPE_PHASES[str]) return CANONICAL_TO_PROTOTYPE_PHASES[str];
  const upper = str.toUpperCase();
  if (CANONICAL_TO_PROTOTYPE_PHASES[upper]) return CANONICAL_TO_PROTOTYPE_PHASES[upper];
  return str.toLowerCase();
}

/**
 * Converts a phase to its canonical uppercase representation.
 * @param {string} phase
 * @param {string} [subType]
 * @param {string} [verdictKind]
 * @returns {string} canonical uppercase phase
 */
export function toCanonicalPhase(phase, subType, verdictKind) {
  const norm = normalizePhase(phase);
  if (norm === 'completed') {
    if (verdictKind === 'Unanimous Consensus') return 'CONSENSUS_REACHED';
    if (verdictKind && String(verdictKind).includes('Round Limit')) return 'ROUND_TIMEOUT';
    return 'DISSENT_REPORT';
  }
  if (norm === 'seat_fault' || norm === 'judge_fault') return 'RECOVERY';
  return PROTOTYPE_PHASE_ALIASES[norm] || norm.toUpperCase();
}

/**
 * Converts a phase to its prototype lowercase alias.
 * @param {string} phase
 * @param {string} [subType] e.g. 'judge_fault'
 * @returns {string} prototype phase alias
 */
export function toPrototypePhase(phase, subType) {
  const norm = normalizePhase(phase);
  if (norm === 'seat_fault' && subType === 'judge_fault') {
    return 'judge_fault';
  }
  return norm;
}

/**
 * Checks if two phase representations match (resolving aliases).
 * @param {string} phaseA
 * @param {string} phaseB
 * @returns {boolean}
 */
export function isPhaseMatch(phaseA, phaseB) {
  return normalizePhase(phaseA) === normalizePhase(phaseB);
}
