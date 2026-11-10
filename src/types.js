/**
 * @fileoverview Domain contracts, constants, and JSDoc type definitions for The Council.
 * Zero-dependency ESM module defining contracts for Seats, Judges, Proofs, Candidates,
 * Objections, Verdicts, Events, and Council State.
 */

/**
 * Valid proof kinds supported by the Council.
 * @type {readonly ['check', 'citation', 'benchmark', 'derivation']}
 */
export const VALID_PROOF_KINDS = Object.freeze(['check', 'citation', 'benchmark', 'derivation']);

/**
 * Valid participant tool execution policies. Write tools are strictly forbidden.
 * @type {readonly ['none', 'read-only']}
 */
export const VALID_TOOL_POLICIES = Object.freeze(['none', 'read-only']);

/**
 * Valid proof status values.
 * @type {readonly ['pending', 'admitted', 'partially_admitted', 'rejected']}
 */
export const PROOF_STATUSES = Object.freeze(['pending', 'admitted', 'partially_admitted', 'rejected']);

/**
 * Valid objection status values.
 * @type {readonly ['open', 'withdrawn', 'preserved_excused']}
 */
export const OBJECTION_STATUSES = Object.freeze(['open', 'withdrawn', 'preserved_excused']);

/**
 * Valid seat status values.
 * @type {readonly ['idle', 'thinking', 'proof_submitted', 'accepted', 'objected', 'fault_quota', 'fault_timeout', 'fault', 'excused']}
 */
export const SEAT_STATUSES = Object.freeze([
  'idle',
  'thinking',
  'proof_submitted',
  'accepted',
  'objected',
  'fault_quota',
  'fault_timeout',
  'fault',
  'excused'
]);

/**
 * Valid judge status values.
 * @type {readonly ['idle', 'thinking', 'fault_quota', 'fault_timeout', 'fault']}
 */
export const JUDGE_STATUSES = Object.freeze([
  'idle',
  'thinking',
  'fault_quota',
  'fault_timeout',
  'fault'
]);

/**
 * Valid vote types.
 * @type {readonly ['accept', 'object']}
 */
export const VOTE_TYPES = Object.freeze(['accept', 'object']);

/**
 * Canonical Council Phases.
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
 * Prototype Phase Aliases.
 * @enum {string}
 */
export const PROTOTYPE_PHASES = Object.freeze({
  PREFLIGHT: 'preflight',
  CLARIFYING: 'clarifying',
  REVIEWING: 'reviewing',
  JUDGING: 'judging',
  CONFIRMING: 'confirming',
  COMPLETED: 'completed',
  SEAT_FAULT: 'seat_fault',
  JUDGE_FAULT: 'judge_fault'
});

/**
 * Bidirectional Phase Mapping.
 */
export const PHASE_MAP = Object.freeze({
  // Canonical -> Prototype
  ROSTER_CONFIGURATION: 'preflight',
  DISCOVERY: 'clarifying',
  DELIBERATION: 'reviewing',
  JUDGE_AUDIT_SYNTHESIS: 'judging',
  VOTING: 'confirming',
  CONSENSUS_REACHED: 'completed',
  DISSENT_REPORT: 'completed',
  ROUND_TIMEOUT: 'completed',
  RECOVERY: 'seat_fault',
  // Prototype -> Canonical
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
 * Verdict Kinds.
 * @enum {string}
 */
export const VERDICT_KINDS = Object.freeze({
  UNANIMOUS_CONSENSUS: 'Unanimous Consensus',
  DISSENT_PRESERVED_OBJECTION: 'Dissent Report (Preserved Excused-Seat Objection)',
  DISSENT_ROUND_LIMIT: 'Dissent Report (Round Limit Reached)',
  DISSENT_BELOW_QUORUM: 'Dissent Report (Below Quorum)',
  DISSENT_JUDGE_FAULT: 'Dissent Report (Judge Fault)'
});

/**
 * Default Council Engine Configuration.
 */
export const DEFAULT_CONFIG = Object.freeze({
  topic: 'What is the better operating system?',
  maxRounds: 3,
  clarificationBatch: 0,
  maxClarificationBatches: 2,
  minQuorum: 2,
  maxRetriesPerSeat: 1
});

// ============================================================================
// JSDOC DOMAIN CONTRACTS
// ============================================================================

/**
 * @typedef {'codex' | 'antigravity' | 'cursor' | 'mock' | string} HarnessType
 */

/**
 * @typedef {'check' | 'citation' | 'benchmark' | 'derivation'} ProofKind
 */

/**
 * @typedef {'pending' | 'admitted' | 'partially_admitted' | 'rejected'} ProofStatus
 */

/**
 * @typedef {'open' | 'withdrawn' | 'preserved_excused'} ObjectionStatus
 */

/**
 * @typedef {'idle' | 'thinking' | 'proof_submitted' | 'accepted' | 'objected' | 'fault_quota' | 'fault_timeout' | 'fault' | 'excused'} SeatStatus
 */

/**
 * @typedef {'idle' | 'thinking' | 'fault_quota' | 'fault_timeout' | 'fault'} JudgeStatus
 */

/**
 * @typedef {'accept' | 'object'} VoteType
 */

/**
 * @typedef {Object} Seat
 * @property {string} id - Unique identifier for the seat (e.g. 'astra-kernel', 'sol-speed').
 * @property {HarnessType} harness - Execution harness adapter.
 * @property {string} model - Underlying model identifier (e.g. 'gpt-6-astra (max)').
 * @property {string} soul - Pre-configured persona, temperament, or domain lens.
 * @property {'none' | 'read-only'} [tools] - Participant tool execution policy (default: 'read-only').
 * @property {number} [timeoutMs] - Explicit execution timeout in ms.
 * @property {SeatStatus} status - Live seat status.
 * @property {number} retries - Number of times this seat has been retried after faulting.
 * @property {string | null} excusedReason - Reason why this seat was excused, or null if active.
 */

/**
 * @typedef {Object} Judge
 * @property {string} id - Unique identifier for the judge (e.g. 'judge-astra').
 * @property {HarnessType} harness - Execution harness adapter.
 * @property {string} model - Underlying model identifier.
 * @property {string} soul - Judge persona (impartial proof auditor).
 * @property {'none' | 'read-only'} [tools] - Participant tool execution policy (default: 'read-only').
 * @property {number} [timeoutMs] - Explicit execution timeout in ms.
 * @property {JudgeStatus} status - Live judge status.
 * @property {number} retries - Number of times judge has been retried after faulting.
 */

/**
 * @typedef {Object} Proof
 * @property {string} id - Unique proof identifier (e.g. 'P1', 'P2').
 * @property {number} round - Deliberation round index when submitted.
 * @property {string} seatId - ID of the seat that submitted this proof.
 * @property {string} scope - Context boundary / scope condition.
 * @property {ProofKind} kind - Verification modality.
 * @property {string} source - Verifiable evidence source (bare opinions forbidden).
 * @property {string} statement - Falsifiable assertion.
 * @property {ProofStatus} status - Admission status determined by Judge.
 * @property {string | null} judgeNote - Note from Judge explaining admission/rejection.
 * @property {string | null} [judgeAdmittedStatement] - Narrowed statement of verified citable core when status is partially_admitted.
 * @property {'explicitly_admitted' | 'default_admitted' | 'partially_admitted' | 'judge_rejected'} [admissionKind]
 */

/**
 * @typedef {Object} ProofInput
 * @property {string} [id] - Optional client-supplied proof ID.
 * @property {number} [round] - Deliberation round index.
 * @property {string} [seatId] - Submitting seat ID.
 * @property {string} scope - Context boundary / scope condition.
 * @property {ProofKind} kind - Verification modality.
 * @property {string} source - Verifiable evidence source.
 * @property {string} statement - Falsifiable assertion.
 */

/**
 * @typedef {Object} CandidateClause
 * @property {string} [id] - Clause ID (e.g. 'C1', 'C2').
 * @property {string} context - Context partition / scenario (e.g. 'Server workloads').
 * @property {string} conclusion - Synthesized resolution statement.
 * @property {string[]} citedProofIds - List of Judge-admitted Proof IDs substantiating this clause.
 */

/**
 * @typedef {Object} Candidate
 * @property {number} round - Deliberation round in which candidate was synthesized.
 * @property {string} summary - Overarching resolution summary.
 * @property {CandidateClause[]} clauses - Context-partitioned candidate clauses.
 */

/**
 * @typedef {Object} Objection
 * @property {string} id - Unique identifier (e.g. 'O1', 'O2').
 * @property {number} round - Round in which objection was raised.
 * @property {string} seatId - ID of seat raising the objection.
 * @property {string} reason - Concrete reason for objection.
 * @property {string} proofId - ID of proof substantiating objection (cannot be rejected).
 * @property {ObjectionStatus} status - Objection lifecycle status.
 */

/**
 * @typedef {Object} Verdict
 * @property {string} kind - Final consensus outcome from VERDICT_KINDS.
 * @property {Candidate | null} candidate - Final candidate statement.
 * @property {Objection[]} unresolvedObjections - Open or preserved_excused objections.
 * @property {number} activeSeatCount - Count of non-excused seats at conclusion.
 * @property {number} excusedSeatCount - Count of excused seats at conclusion.
 * @property {string} note - Detailed verdict explanation.
 */

/**
 * @typedef {Object} Clarification
 * @property {number} [batch] - Batch number (1-based).
 * @property {string} answer - Broadcast clarification answer.
 * @property {string} [question] - Optional clarification question.
 */

/**
 * @typedef {Object} EvidenceItem
 * @property {string} [id] - Canonical evidence ID (e.g. 'E1', 'E2').
 * @property {string} label - Short human-readable label for the evidence item.
 * @property {string} source - Verifiable file path, URL, or command that produced the evidence.
 * @property {string} text - Grounded evidence content.
 */

/**
 * @typedef {Object} TransitionResult
 * @property {boolean} ok - Whether transition succeeded or was guard-rejected.
 * @property {string} message - Human-readable success or guard-rejection message.
 */

/**
 * @typedef {Object} CouncilConfig
 * @property {string} [topic] - Topic handoff problem statement.
 * @property {number} [maxRounds] - Max deliberation rounds (default: 3).
 * @property {number} [maxClarificationBatches] - Max clarification cycles (default: 2).
 * @property {number} [minQuorum] - Minimum active seats for consensus (default: 2).
 * @property {number} [maxRetriesPerSeat] - Max retries before seat excusal (default: 1).
 * @property {number} [timeoutMs] - Optional global execution timeout in ms.
 * @property {number} [maxConcurrentSeats] - Max concurrent seats during deliberation/voting.
 * @property {'none' | 'read-only'} [tools] - Global participant tool policy.
 * @property {EvidenceItem[]} [evidence] - Pre-collected grounded evidence items passed to seats and judge.
 * @property {Clarification[]} [clarifications] - Pre-supplied clarification answers broadcast to seats and judge.
 * @property {Partial<Judge>} [judge] - Optional judge configuration.
 * @property {Array<Partial<Seat>>} [seats] - Initial seat roster.
 */

/**
 * @typedef {Object} CouncilState
 * @property {string} topic
 * @property {string} phase
 * @property {string} [phaseAlias]
 * @property {string | null} previousPhase
 * @property {string} lastEventName
 * @property {string | null} returnPhase
 * @property {string | null} faultSeatId
 * @property {number} round
 * @property {number} maxRounds
 * @property {number} clarificationBatch
 * @property {number} maxClarificationBatches
 * @property {number} minQuorum
 * @property {number} maxRetriesPerSeat
 * @property {readonly EvidenceItem[]} evidence
 * @property {Clarification[]} clarifications
 * @property {Judge} judge
 * @property {Seat[]} seats
 * @property {Proof[]} proofs
 * @property {Candidate | null} candidate
 * @property {Objection[]} objections
 * @property {Verdict | null} verdict
 * @property {TransitionResult} lastTransition
 * @property {string[]} history
 */

/**
 * @typedef {Object} ProofValidationResult
 * @property {boolean} valid - True if all fields are valid.
 * @property {string[]} errors - List of validation failure messages.
 */

/**
 * @typedef {Object} CandidateValidationResult
 * @property {boolean} valid - True if clauses and cited proofs are valid.
 * @property {string[]} errors - List of validation failure messages.
 */

/**
 * @typedef {Object} ObjectionWithdrawalResult
 * @property {boolean} allowed - True if objection can be withdrawn.
 * @property {string} [reason] - Rejection reason if not allowed.
 */
