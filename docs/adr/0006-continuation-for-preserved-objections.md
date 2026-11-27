# Continuation Runs for Preserved Excused-Seat Objections

Status: accepted

Under ADR-0003, when a Seat faults or times out while holding an open Objection, it becomes an Excused Seat, its Objection locks as `preserved_excused`, and the Council terminates in a `Dissent Report (Preserved Excused-Seat Objection)` even when all remaining active Seats accept the revised Candidate. To resolve that near-consensus outcome without compromising ADR-0003's anti-manufactured-consensus guarantee, we implement an explicit, operator-triggered **Continuation** (`council continue <runId|snapshot-path>`) that keeps the original run and Verdict permanently immutable, persists a new run linked via `parentRunId` and `rootRunId`, and runs a strictly vote-only ratification pass re-invoking only the original objecting Excused Seat(s) (preserving exact Seat ID, Harness, Model, Soul, and read-only tool/skill/workspace access) against the frozen Candidate.

## Considered Options

- **Silent model substitution or majority override:** Rejected because replacing an unavailable Seat or voting away its Objection violates ADR-0003 and allows faults or quota exhaustion to fabricate `Unanimous Consensus`.
- **Automatic mid-run recovery:** Rejected because mutating a finished run or extending rounds silently undermines auditability and operator budget control.
- **Full extra deliberation round inside Continuation:** Rejected because re-synthesizing a new Candidate would invalidate the remaining active Seats' existing `ACCEPT` votes and turn Continuation into a full new Council run.

## Consequences

- `Unanimous Consensus` in a Continuation requires every Excused Seat holding a preserved Objection in the parent run to be re-invoked under its original identity and explicitly withdraw/accept on the frozen Candidate.
- If any re-invoked Seat reaffirms its Objection or faults again, the Continuation terminates as a new `Dissent Report` (and may itself be chained by another explicit Continuation linked to both `parentRunId` and `rootRunId`).
- Only parent runs ending in `Dissent Report (Preserved Excused-Seat Objection)` are eligible; `Unanimous Consensus`, `Below Quorum`, and `Round Limit Reached` outcomes are rejected.
