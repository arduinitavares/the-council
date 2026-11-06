# The Council

> Multi-agent consensus deliberation engine with dynamic seats, structured proof validation, judge synthesis, and excused-seat objection preservation.

## Overview

The Council coordinates structured deliberation among an arbitrary roster of autonomous AI seats across multi-model Orca harnesses (`codex`, `antigravity`, `cursor`). Debates proceed in rounds where participants submit structured Proofs (`check | citation | benchmark | derivation`). A dedicated, non-voting Judge audits proofs, admits/rejects them, and synthesizes Candidate clauses strictly citing admitted Proof IDs. Active seats vote to accept or raise proof-backed objections.

Consensus requires unanimous acceptance from active seats, meeting minimum quorum (`minQuorum`, default 2), with zero open or preserved objections. If a seat suffers quota exhaustion or an unrecoverable fault, it transitions to Excused status, preserving prior turns and locking open objections into `preserved_excused` so that token exhaustion never manufactures false consensus. Telemetry streams seat activity in real time without phase disruption.

## Architecture

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

## Core Invariants

1. **Dynamic Seats with Souls (ADR 0001)**: Seats are defined by unique ID, harness (`codex`, `antigravity`, `cursor`), model/effort, and Soul (temperament or domain lens). Multiple seats may share the same model with different Souls.
2. **Direct Orca Harness Dispatch (ADR 0002)**: Direct harness communication without legacy custody wrappers.
3. **Judge Proof-Bound Synthesis (ADR 0003)**: Non-voting Judge audits proofs (`admitted` / `rejected`). Candidate clauses must cite at least one admitted Proof ID from the current round.
4. **Excused-Seat Objection Preservation (ADR 0003)**: Faulted/quota-exhausted seats are excused with turn retention. Open objections convert to `preserved_excused` and cannot be withdrawn by others, preventing manufactured false consensus.
5. **Real-Time Telemetry Decoupling**: `SEAT_TELEMETRY` events stream seat status updates without disturbing state machine phase transitions.

## Quickstart

### Prerequisites
- Node.js >= 22.0.0
- npm >= 10.0.0

### Running Tests
The test suite runs hermetically using Node's native test runner (`node:test`):

```bash
# Run all tests
npm test

# Run unit tests
npm run test:unit

# Run integration tests
npm run test:integration

# Run e2e tests
npm run test:e2e
```

## Repository Layout

```
.
├── package.json                  # ESM ("type": "module"), Node >=22 target
├── src/
│   ├── index.js                  # Main library exports
│   ├── types.js                  # Domain contracts & JSDoc types
│   ├── machine/                  # Pure state machine (reducer, state, guards, constants)
│   ├── proofs/                   # Proof validation and indexing
│   ├── seats/                    # Dynamic seats, souls, roster management
│   ├── harness/                  # Orca harness adapters (codex, antigravity, cursor, mock)
│   ├── telemetry/                # Real-time observer pub/sub & snapshots
│   ├── engine/                   # Consensus engine coordinator
│   └── cli/                      # CLI entry point
├── test/
│   ├── unit/                     # Unit test suites
│   ├── integration/              # Multi-component integration tests
│   ├── e2e/                      # Opaque-box E2E test suites
│   └── fixtures/                 # Scenario fixtures
├── docs/
│   ├── adr/                      # Architectural Decision Records
│   └── prototype-context-pointer.md  # Prototype Governance Rule 6 pointer
└── prototype/                    # Intact interactive visualizer prototype
    ├── council-state-machine.html
    ├── council-machine.js
    ├── council-visualizer.js
    └── council-walkthroughs.js
```

## Prototype & Governance

In compliance with Prototype Governance Rule 6, the initial interactive prototype has been captured to a dedicated throwaway branch:
- Branch: `prototype/council-state-machine`
- Context Pointer: [docs/prototype-context-pointer.md](docs/prototype-context-pointer.md)
- Interactive Visualizer: Open `prototype/council-state-machine.html` in a web browser.
