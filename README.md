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
2. **Direct Orca Harness Dispatch & Ephemeral Isolation (ADR 0002, R2: #15, #18, #37)**: Direct harness communication without legacy custody wrappers across `codex`, `antigravity`, and `cursor`:
   - **Codex Ephemeral & Hook Isolation (`--ephemeral --disable hooks`)**: All live seat and judge invocations pass `--ephemeral --disable hooks` to `codex exec`. `--ephemeral` isolates deliberation runs from disk session persistence (`~/.codex/sessions`), and `--disable hooks` prevents user hooks (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`) from executing during Council turns while keeping `$CODEX_HOME/config.toml` and `$CODEX_HOME/auth.json` authentication active. Callers can opt into user hooks with `disableHooks: false` or full config isolation with `ignoreUserConfig: true` (`--ignore-user-config`).
   - **Verbatim Reasoning Effort Preservation**: Configured reasoning efforts (`low`, `medium`, `high`, `xhigh`, `max`) are mapped directly to Codex CLI flags (`-c model_reasoning_effort="<effort>"`). In particular, `max` is preserved verbatim without downscaling to `xhigh`. Specifying an unsupported effort string immediately raises a descriptive configuration error listing the allowed values.
   - **Provider Invocation Telemetry**: Every CLI execution records execution metadata—including `participantId`, `provider`, `tools`, `exitCode`, `durationMs`, and effective `argv` with deliberation prompts redacted (capturing prompt length and SHA-256 hash for privacy and auditability)—wired through `CouncilEngine`, `CouncilTelemetryEmitter`, and `VisualizerLiveWatcher` (`window.CouncilLatestLiveRun.providerCalls`).
3. **Judge Proof-Bound Synthesis (ADR 0003)**: Non-voting Judge audits proofs (`admitted` / `rejected`). Candidate clauses must cite at least one admitted Proof ID from the current round.
4. **Excused-Seat Objection Preservation (ADR 0003)**: Faulted/quota-exhausted seats are excused with turn retention. Open objections convert to `preserved_excused` and cannot be withdrawn by others, preventing manufactured false consensus.
5. **Real-Time Telemetry Decoupling**: `SEAT_TELEMETRY` events stream seat status updates without disturbing state machine phase transitions.
6. **Concurrent Seat Turns & Deterministic Reducer Ordering (ADR 0004, R3: #24)**: Active seats execute asynchronously in parallel during Deliberation (Proof Collection) and Confirmation (Voting) phases up to `maxConcurrentSeats` (defaulting to roster size, or 10). To prevent asynchronous completion race conditions, results are buffered and reduced onto the state machine in strict roster order, guaranteeing deterministic proof IDs (`P1..Pn`), objection IDs (`O1..On`), and reproducible state history.
7. **Read-Only Tool Policy & Verification Injections (R3: #25)**: Deliberation seats and the Judge enforce a strict tool access policy (`tools: 'none' | 'read-only'`, defaulting to `'read-only'`). Write tools are strictly forbidden and rejected at configuration validation. For `read-only` participants, verification directives are injected into prompt contracts instructing seats to inspect codebases, specifications, or benchmarks before submitting proofs or voting, and instructing the Judge to spot-check citations before admitting proofs. For `cursor-agent`, CLI invocation enforces `--mode plan` and `--sandbox enabled`.
8. **Configurable Time Budgets & Dynamic Effort-Scaled Timeouts (R3: #25)**: Per-turn timeouts (`timeoutMs`) can be configured globally or per-seat/judge. Unset timeouts dynamically scale by reasoning effort tier (`max`/`xhigh`: 240s, `high`: 120s, `medium`/`low`: 60s, default: 60s). Structured output extraction evaluates multi-block markdown code blocks in reverse order and extracts balanced-brace candidates, ensuring model outputs parse resiliently even when preceded by extensive read-only tool chatter.

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
