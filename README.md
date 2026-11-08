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
2. **Direct Orca Harness Dispatch & Ephemeral Isolation (ADR 0002, R2: #15, #18)**: Direct harness communication without legacy custody wrappers across `codex`, `antigravity`, and `cursor`:
   - **Codex Ephemeral Isolation (`--ephemeral`)**: All live seat and judge invocations pass `--ephemeral` to `codex exec`. This isolates deliberation runs from disk session persistence (`~/.codex/sessions`), preventing disk write bloat and avoiding polluting personal interactive session history across multi-round debates.
   - **Hook Inheritance vs. Strict Isolation**: Because `--ephemeral` stops session persistence but continues reading `$CODEX_HOME/config.toml`, user authentication and API credentials configured in Codex remain active out-of-the-box. User hooks defined in `config.toml` (e.g. `SessionStart`, `UserPromptSubmit`, `Stop`) will still fire by default. For strict isolation where hooks are silenced, passing `--ignore-user-config` is supported (requiring credentials to be supplied via `CODEX_API_KEY` or `OPENAI_API_KEY`).
   - **Verbatim Reasoning Effort Preservation**: Configured reasoning efforts (`low`, `medium`, `high`, `xhigh`, `max`) are mapped directly to Codex CLI flags (`-c model_reasoning_effort="<effort>"`). In particular, `max` is preserved verbatim without downscaling to `xhigh`. Specifying an unsupported effort string immediately raises a descriptive configuration error listing the allowed values.
   - **Provider Invocation Telemetry**: Every CLI execution records execution metadata—including exit code, duration in milliseconds, and effective `argv` with deliberation prompts redacted (capturing prompt length and SHA-256 hash for privacy and auditability).
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
