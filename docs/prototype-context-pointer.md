# Prototype Context Pointer — Prototype Governance Rule 6

## Metadata
- **Prototype Branch**: `prototype/council-state-machine`
- **Captured At**: 2026-11-06T22:43:00Z
- **Commit SHA**: `954e6ef`
- **Integrity Mode**: development
- **Primary Source Files Captured**:
  - `prototype/council-state-machine.html` (Interactive visualizer, DAG canvas, step-by-step walkthrough playback, telemetry inspector)
  - `prototype/council-machine.js` (Pure state machine reducer, 9 phases, transition guards, zero DOM dependencies)
  - `prototype/council-visualizer.js` (DOM rendering, event streams, graph layout)
  - `prototype/council-walkthroughs.js` (Canonical test walkthrough data & scenario definitions)

## Settled Questions & Architectural Decisions
The interactive prototype established and validated four critical architectural mechanisms prior to production implementation in `src/`:

1. **Dynamic Seats with Souls (ADR 0001)**:
   - Validated that the council roster is not constrained to a fixed 3-family set (`openai`, `gemini`, `claude`), but supports an arbitrary list of $N$ seats (e.g. 3, 10, or more) across multiple Orca harnesses (`codex`, `antigravity`, `cursor`).
   - Multiple seats can share the same underlying model family (e.g., two `gpt-6-astra` seats) by configuring distinct Souls (temperament / domain lenses: e.g. kernel purist vs gamer vs secops auditor).

2. **Direct Orca Harness Dispatch Without Pilot Custody (ADR 0002)**:
   - Discarded the abandoned 18,748-line `src/pilot/` process-custody subsystem.
   - Validated pure state-machine-driven dispatch where harness calls map directly through Orca CLI/API or hermetic test mocks.

3. **Judge Proof-Bound Synthesis (ADR 0003, AC:36-37)**:
   - Validated structured proof validation (`check | citation | benchmark | derivation`).
   - Enforced that the non-voting Judge synthesizes candidate clauses citing strictly admitted Proof IDs from the current round, preventing judges from injecting unsubstantiated personal claims.

4. **Excused-Seat Objection Preservation (ADR 0003, AC:42-43)**:
   - Validated fault recovery: when a seat encounters quota exhaustion or an unrecoverable fault (`SEAT_FAULT`), bounded retry is attempted up to `maxRetriesPerSeat` (default 1).
   - If retries are exhausted, the seat is excused (`EXCUSE_SEAT`).
   - Prior completed turns are preserved.
   - Crucially: any open objection raised by the excused seat is locked as `preserved_excused`.
   - Objections can only be withdrawn by their owner; because excused seats cannot act, no other seat can withdraw the objection.
   - This ensures token or quota exhaustion cannot manufacture false unanimous consensus; unresolved dissents terminate in a Dissent Report.

## Validation Scenarios (100% Pass)
The prototype logic was validated against three canonical walkthroughs ported from `prototype/council-walkthroughs.js`:
- **Walkthrough 1: Context-Partitioned Consensus (`wt-better-os`)**:
  - 3 seats (`astra-kernel`, `astra-gamer`, `opus-secops`), Judge (`sol-judge`).
  - Round 1: Gamer objects to kernel-only recommendation.
  - Round 2: Judge synthesizes partitioned candidate addressing gaming & kernel workloads. All seats accept. Unanimous Consensus reached.
- **Walkthrough 2: 10-Seat Multi-Harness Roster + Quota Fault (`wt-10-seats-quota`)**:
  - 10 seats across Codex, AGY, and Cursor.
  - Round 1: Seat 5 (`grok-performance`) faults on quota (`fault_quota`).
  - Retry cap reached -> Seat 5 excused. Completed turns retained.
  - Active seat count drops from 10 to 9 (exceeds `minQuorum = 2`).
  - Remaining 9 seats vote to accept. Unanimous Consensus reached.
- **Walkthrough 3: Opus 5.5 Guardrails & Excused-Seat Objection Preserved (`wt-opus-guardrails`)**:
  - 3 seats. Seat 3 (`opus-secops`) objects to unvetted memory-unsafe module.
  - Seat 3 then faults on quota and is excused.
  - Objection is locked to `preserved_excused`.
  - Remaining 2 seats accept candidate, but round evaluation detects the `preserved_excused` objection and halts.
  - Verdict emitted: `Dissent Report (Preserved Excused-Seat Objection)`. False consensus successfully blocked.

## Access & Verification
- **Branch Reference**: `git checkout prototype/council-state-machine`
- **Master Files**: Per user instructions, prototype files remain functional on `master` under `prototype/`.
- **Interactive UI**: Open `prototype/council-state-machine.html` in any modern web browser.
- **Production Implementation**: Core logic is folded into `src/` (`src/machine/reducer.js`, `src/proofs/validator.js`, `src/engine/council-engine.js`).
