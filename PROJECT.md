# Project: The Council — Production Consensus Engine

## Architecture

The Council is a multi-agent consensus deliberation engine. Dynamic Seats with specialized Souls run across Orca harnesses (`codex`, `antigravity`, `cursor`). Debates proceed in rounds where participants submit structured Proofs (`check | citation | benchmark | derivation`). A non-voting Judge audits proofs, admits/rejects them, and synthesizes Candidate clauses strictly citing admitted Proof IDs. Seats vote to accept or object (backed by valid proofs). Consensus requires unanimous acceptance from active seats, meeting `minQuorum` (default 2), with zero open or preserved objections. Quota exhaustion or faults trigger Seat Excusal, preserving prior turns and locking open objections into `preserved_excused` so that token exhaustion never manufactures false consensus. Telemetry streams seat activity in real time without phase disruption.

```
                  ┌──────────────────────────────────────────────┐
                  │              Topic Handoff                   │
                  └──────────────────────┬───────────────────────┘
                                         │
                                         ▼
                             ┌───────────────────────┐
                             │ ROSTER_CONFIGURATION  │
                             └───────────┬───────────┘
                                         │
                                         ▼
                             ┌───────────────────────┐
                             │       DISCOVERY       │ (Clarification Batches)
                             └───────────┬───────────┘
                                         │
                                         ▼
                             ┌───────────────────────┐
                        ┌───►│      DELIBERATION     │ (Submit Proofs)
                        │    └───────────┬───────────┘
                        │                │
                        │                ▼
                        │    ┌───────────────────────┐
                        │    │ JUDGE_AUDIT_SYNTHESIS │ (Audit & Proof-Bound Candidate)
                        │    └───────────┬───────────┘
                        │                │
                        │                ▼
                        │    ┌───────────────────────┐
           Next Round   │    │        VOTING         │ (Accept or Proof-Backed Object)
          (if < max)    │    └───────────┬───────────┘
                        │                │
                        │                ▼
                        │        [EVALUATE_ROUND]
                        │         /             \
                        │   No Objections     Objections Open / Preserved
                        │   & >= minQuorum     or Below Quorum / Round Limit
                        │       /                 \
                        │      ▼                   ▼
                        │ ┌──────────────┐     ┌──────────────┐
                        └─┤  Next Round  │     │DISSENT_REPORT│
                          └──────────────┘     │   (Verdict)  │
                                 │             └──────────────┘
                                 ▼
                         ┌─────────────────┐
                         │CONSENSUS_REACHED│
                         │    (Verdict)    │
                         └─────────────────┘
```

## Feature Inventory

Every feature from the Survey phase is mapped to an implementation milestone below:

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | `ROSTER_CONFIGURATION` (`preflight`) | Dynamic seat configuration (`ADD_SEAT`) with ID, harness, model, and soul; verify `activeSeats >= minQuorum`. | M1 | Survey (Spec Miner #1) |
| 2 | `SEAT_TELEMETRY` | Real-time seat status updates decoupled from state machine phase transitions. | M2 | Survey (Spec Miner #2) |
| 3 | `DISCOVERY` (`clarifying`) | Shared Q&A pre-deliberation clarification batches (`START_CLARIFYING`, `PUBLISH_CLARIFICATION`). | M1 | Survey (Spec Miner #3, #4) |
| 4 | `DELIBERATION` (`reviewing`) | Round initialization (`BEGIN_ROUND`) and proof collection from active seats. | M1 | Survey (Spec Miner #5) |
| 5 | Structured Proofs (`SUBMIT_PROOF`) | Proof submissions with strict validation of `scope`, `kind` (`check \| citation \| benchmark \| derivation`), `source`, `statement`. | M1 | Survey (Spec Miner #6, AC:36) |
| 6 | Proof Validation Guard | Reject proofs with empty scope, invalid kind, whitespace source, or missing statement. | M1 | Survey (Explorer 2 #3-6) |
| 7 | Proof Judging Transition (`START_JUDGING`) | Closes seat proof submissions; requires >= 1 submitted proof in round. | M1 | Survey (Spec Miner #7) |
| 8 | Judge Candidate Synthesis (`JUDGE_AUDIT_AND_SYNTHESIZE`) | Judge audits proofs (`admitted` / `rejected`) and synthesizes context-partitioned Candidate. | M1 | Survey (Spec Miner #8) |
| 9 | Judge Proof-Binding Guard | Candidate requires >= 1 clause; each clause must cite >= 1 admitted Proof IDs; reject unadmitted/unsubstantiated citations. | M1 | Survey (Spec Miner #8, AC:37) |
| 10 | Voting Accept (`CAST_VOTE: accept`) | Active seat accepts Candidate; automatically withdraws seat's own open objections. | M1 | Survey (Spec Miner #9) |
| 11 | Voting Object (`CAST_VOTE: object`) | Active seat objects; requires non-empty reason and cites valid, non-rejected Proof ID. | M1 | Survey (Spec Miner #10) |
| 12 | Objection Ownership Guard | Only the seat that raised an objection can withdraw it (`WITHDRAW_OBJECTION`). | M1 | Survey (Explorer 2 #13) |
| 13 | Objection Immutability Guard (Vulnerability Fix) | Prevent withdrawal of `preserved_excused` objections; reject withdrawal attempts by excused seats. | M1 | Survey (Explorer 2 Section 2) |
| 14 | Seat Quota Fault (`SEAT_FAULT`) | Capture quota exhaustion / error, pause state machine in `RECOVERY` (`seat_fault`). | M1 | Survey (Spec Miner #12) |
| 15 | Bounded Seat Retry (`RETRY_SEAT`) | Retry seat up to `maxRetriesPerSeat`; reject retry once cap is reached. | M1 | Survey (Spec Miner #13) |
| 16 | Seat Excusal (`EXCUSE_SEAT`) | Excise faulted seat, preserve completed turns, lock open objections as `preserved_excused`. | M1 | Survey (Spec Miner #14, AC:42-43) |
| 17 | Quorum Drop Termination | If excusal drops active seats below `minQuorum`, terminate immediately to `DISSENT_REPORT` (`Below Quorum`). | M1 | Survey (Spec Miner #14, Explorer 2 #17) |
| 18 | Judge Fault & Retry (`JUDGE_FAULT`, `RETRY_JUDGE`) | Handle Judge quota/timeout; retry Judge (Judge cannot be excused). | M1 | Survey (Spec Miner #15, #16) |
| 19 | Round Evaluation (`EVALUATE_ROUND`) | Evaluate votes, quorum, and objections: emit `CONSENSUS_REACHED` or `DISSENT_REPORT` or loop to next round. | M1 | Survey (Spec Miner #17, AC:38) |
| 20 | Round Limit Exceeded (`ROUND_TIMEOUT`) | Terminate in `DISSENT_REPORT` (`Round Limit Reached`) when `round >= maxRounds` with unresolved objections. | M1 | Survey (Spec Miner #17, #20) |
| 21 | State Machine Introspection (`getDependencyAndStateGraph`) | Pure state introspection computing active nodes, traversed edges, and causal links. | M1 | Survey (Spec Miner #18) |
| 22 | Prototype Governance Rule 6 | Capture prototype to `prototype/council-state-machine` branch with context pointer; keep `prototype/` intact. | M1 | Survey (Spec Miner #19, AC:51-52) |
| 23 | Multi-Harness Seat Roster | Dynamic configuration of seats across Orca harnesses (`codex`, `antigravity`, `cursor`) with distinct Souls. | M2 | Survey (Explorer 3 #43-57, AC:41) |
| 24 | Soul Prompt Injection | Format and inject Soul temperament/perspective into seat prompts. | M2 | Survey (Explorer 3 Section 1.3) |
| 25 | Real-Time Telemetry Emitter | EventEmitter pub/sub decoupled from state machine transitions for live UI/observer telemetry. | M2 | Survey (Explorer 2 #260-268, AC:46) |
| 26 | Deterministic State Snapshots | Deterministic emission of `{ event, stateSnapshot, timestamp }` on state transitions. | M2 | Survey (Explorer 3 #89-90, AC:47) |
| 27 | Consensus Engine Coordinator | High-level engine coordinating debate loop, seat dispatch, judge audit, and telemetry. | M2 | Survey (Explorer 3 Section 4.3) |
| 28 | Comprehensive E2E Test Suite | 100% pass of Tiers 1-4 tests (including walkthrough ports `wt-better-os`, `wt-10-seats-quota`, `wt-opus-guardrails`). | M3 | Survey (AC:50, R4) |
| 29 | Adversarial Coverage Hardening | Tier 5 white-box stress testing, gap audit, and boundary hardening. | M3 | Dual Track Phase 2 |

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Core Consensus State Machine, Guards & Prototype Governance | `package.json`, layout, throwaway branch `prototype/council-state-machine`, `docs/prototype-context-pointer.md`, types, proof validator, guards (proof, candidate citations, objection immutability, quorum), pure reducer implementing all 9 phases and 17 events/transitions. | none | PLANNED |
| M2 | Dynamic Seats, Multi-Harness Adapters, Telemetry & Runtime Engine | Dynamic seats with souls across Orca harnesses (`codex`, `antigravity`, `cursor`, `mock`), excusal & turn retention, real-time `SEAT_TELEMETRY` emitter, deterministic state snapshots, engine coordinator and CLI. | M1 | PLANNED |
| M3 | Final Milestone: 100% E2E Test Pass & Adversarial Hardening | Phase 1: Pass 100% of E2E tests (Tiers 1-4) published in `TEST_READY.md`. Phase 2: Adversarial Coverage Hardening (Tier 5) with Challengers and coverage audit. | M2, E2E Track | PLANNED |

## Interface Contracts

### Reducer ↔ Engine
```typescript
function createInitialCouncilState(config?: Partial<CouncilConfig>): CouncilState;
function transitionCouncil(state: CouncilState, event: CouncilEvent): CouncilState;
```
- `transitionCouncil` is pure, synchronous, zero-I/O, and deterministic.
- If transition is rejected by a guard: returns state clone with `lastTransition = { ok: false, message: string }`, `phase` unchanged.
- If transition succeeds: returns updated state clone with `lastTransition = { ok: true, message: string }`.

### Proof Validator
```typescript
interface ProofInput {
  id?: string;
  round: number;
  seatId: string;
  scope: string;
  kind: 'check' | 'citation' | 'benchmark' | 'derivation';
  source: string;
  statement: string;
}
function validateProof(input: ProofInput): { valid: boolean; errors: string[] };
```

### Judge Candidate Proof-Binding Guard
```typescript
function validateCandidateClauses(clauses: CandidateClause[], admittedProofIds: Set<string>): { valid: boolean; errors: string[] };
```
- Enforces: `clauses.length >= 1`.
- Enforces: For each clause, `citedProofIds.length >= 1`.
- Enforces: Every ID in `citedProofIds` must be present in `admittedProofIds`.

### Objection Immutability Guard
```typescript
function canWithdrawObjection(state: CouncilState, objectionId: string, seatId: string): { allowed: boolean; reason?: string };
```
- Returns `allowed: false` if objection status is `'preserved_excused'` (permanently locked).
- Returns `allowed: false` if seat is not the owner or if seat is `'excused'`.

### Telemetry Emitter
```typescript
interface TelemetryEmitter {
  emitSeatTelemetry(seatId: string, status: SeatStatus): void;
  emitStateTransition(event: CouncilEvent, snapshot: CouncilState): void;
  on(event: 'seat_telemetry', listener: (data: { seatId: string; status: SeatStatus; timestamp: string }) => void): void;
  on(event: 'state_transition', listener: (data: { event: CouncilEvent; state: CouncilState; timestamp: string }) => void): void;
}
```

## Code Layout

```
/Users/aaat/projects/the-council/
├── package.json                  # ESM, node >= 22
├── src/
│   ├── index.js                  # Main library exports
│   ├── types.js                  # Domain types and JSDoc contracts
│   ├── machine/
│   │   ├── constants.js          # Phases, events, proof kinds, defaults
│   │   ├── guards.js             # Pure validation guards
│   │   ├── state.js              # Initial state factory & state helpers
│   │   └── reducer.js            # Pure transitionCouncil reducer
│   ├── proofs/
│   │   ├── validator.js          # Structural proof validator
│   │   └── registry.js           # Proof collection & round indexing
│   ├── seats/
│   │   ├── seat.js               # Dynamic seat lifecycle & status
│   │   ├── soul.js               # Soul prompt injection
│   │   └── roster.js             # Roster management & active/excused tracking
│   ├── harness/
│   │   ├── adapter.js            # Base harness interface
│   │   ├── codex.js              # Codex harness
│   │   ├── antigravity.js        # Antigravity harness
│   │   ├── cursor.js             # Cursor harness
│   │   └── mock.js               # Hermetic mock harness for test suites
│   ├── telemetry/
│   │   ├── emitter.js            # Real-time observer pub/sub
│   │   └── snapshot.js           # Deterministic snapshot generator
│   ├── engine/
│   │   ├── council-engine.js     # High-level coordinator
│   │   └── config.js             # Council configuration loader
│   └── cli/
│       └── index.js              # CLI runner
├── test/
│   ├── e2e/                      # Opaque-box E2E test suite (Tiers 1-4)
│   ├── unit/                     # Module unit tests
│   └── fixtures/                 # Test scenarios and walkthrough data
├── docs/
│   ├── adr/                      # ADRs 0001, 0002, 0003
│   └── prototype-context-pointer.md  # Rule 6 context pointer
└── prototype/                    # Intact interactive prototype files
    ├── council-state-machine.html
    ├── council-machine.js
    ├── council-visualizer.js
    └── council-walkthroughs.js
```
