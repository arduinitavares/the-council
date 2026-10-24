# Independent Review: The Council Design and Implementation Plan

**Verdict:** `PROCEED_WITH_CHANGES`

## Executive Assessment

The Council specification ([2026-10-23-the-council-design.md](file:///Users/aaat/projects/the-council/docs/superpowers/specs/2026-10-23-the-council-design.md)), implementation plan ([2026-10-23-the-council-implementation-plan.md](file:///Users/aaat/projects/the-council/docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md)), and canonical state diagram ([the-council.json](file:///Users/aaat/projects/the-council/docs/superpowers/diagrams/the-council.json)) define a coherent, safety-first architecture. The separation between deterministic XState control transitions and non-deterministic model judgment is well-drawn. Core invariants—two shared clarification batches (`<= 6` calls) separate from three deliberation rounds (`<= 21` calls), a hard 27-call bound without model-based format repair, equal reviewer context and authority, a fresh non-voting judge per round, evidence completion before candidate synthesis, owner-only objection disposition, durable paused input without SQLite contention, and a three-hour active-work budget that pauses only on verified resource settlement—are thoroughly specified.

Five material findings (`F-01` through `F-05`, comprising three `Important` state-machine/barrier contradictions and two `Minor` contract/guard gaps) should be corrected so the pure state machine in Task 2 and controller in Task 7 do not deadlock or drop state on recovery and edge transitions.

---

## Material Findings

### `F-01` — `publishing_answers` Deadlocks on Unresolved Blocking Questions in Deliberation Round 1 or 2, and Duplicates a Transition Instead of the Global Error/Cancel Edge
- **Severity:** Important
- **Source References:**
  - [the-council.json](file:///Users/aaat/projects/the-council/docs/superpowers/diagrams/the-council.json#L288-L301) (`states` transitions from `publishing_answers`)
  - [the-council.json](file:///Users/aaat/projects/the-council/docs/superpowers/diagrams/the-council.json#L373-L376) (duplicate `publishing_answers -> settling` edge)
  - [2026-10-23-the-council-design.md](file:///Users/aaat/projects/the-council/docs/superpowers/specs/2026-10-23-the-council-design.md#L311-L319) (`Clarification after deliberation starts`)
  - [2026-10-23-the-council-design.md](file:///Users/aaat/projects/the-council/docs/superpowers/specs/2026-10-23-the-council-design.md#L484-L485) (`Global transitions and recovery targets`)
  - [2026-10-23-the-council-implementation-plan.md](file:///Users/aaat/projects/the-council/docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md#L203-L204) (Task 2 Step 6)
- **Concrete Failing Scenario:**
  1. During Deliberation Round 1 (`roundsUsed = 1 < maxRounds = 3`), a reviewer raises a blocking question in `missingInputQuestions` (`origin: deliberation(1)`). At the phase barrier, the machine transitions `reviewing -> collecting_questions -> settling -> needs_user`.
  2. The human finalizes the `AnswerBatch` with `status: 'unknown'` or `'declined'` (valid finalized statuses per Spec line 0285), or the wave also contained a same-wave dependent blocking question retained as `deferred`.
  3. On resume (`needs_user -> reconciling -> preflight -> publishing_answers`), `publishing_answers` commits the ledger update and evaluates its outgoing guards in `the-council.json` (lines 0288–0301):
     - `publishing_answers -> clarifying` is false (`origin` is `deliberation(1)` and `roundsUsed = 1`).
     - `publishing_answers -> prepare_round` is false because its guard requires `"no unresolved blocking item"`.
     - `publishing_answers -> settling` is false because its guard requires `"blocking item at clarification limit OR deliberation-origin round allowance exhausted"` (this is neither clarification-origin nor at the round limit, since `roundsUsed = 1 < 3`).
     No outgoing transition is enabled, deadlocking the machine in `publishing_answers`.
  4. Additionally, `the-council.json` lines 0373–0376 duplicate lines 0298–0301 verbatim instead of providing the global `"cancel / operational failure / deadline / required user input"` transition to `settling` that Spec line 0484 and Plan Task 2 Step 6 require for every active state.
- **Smallest Correction:**
  - In [the-council.json](file:///Users/aaat/projects/the-council/docs/superpowers/diagrams/the-council.json#L298-L301) and Task 2 Step 5/6, widen the guard on `publishing_answers -> settling` to `"unresolved blocking item after final clarification or deliberation answer publication, OR deliberation-origin round allowance exhausted"` (so an `unknown`/`declined`/`deferred` blocking question in deliberation also settles to `needs_user` until resolved via `AnswerRevision` or user direction).
  - Replace the duplicate edge at [the-council.json](file:///Users/aaat/projects/the-council/docs/superpowers/diagrams/the-council.json#L373-L376) with `"cancel / operational failure / deadline / required user input"`.

---

### `F-02` — `reconciling` Outgoing Guards Block Valid Exited Worker Results on Crash Recovery and Settled-Pause Resumes
- **Severity:** Important
- **Source References:**
  - [the-council.json](file:///Users/aaat/projects/the-council/docs/superpowers/diagrams/the-council.json#L442-L526) (`reconciling` and `settling` transitions)
  - [the-council.json](file:///Users/aaat/projects/the-council/docs/superpowers/diagrams/the-council.json#L680-L693) (`recovery` diagram `exit -> settling -> outcome`)
  - [2026-10-23-the-council-design.md](file:///Users/aaat/projects/the-council/docs/superpowers/specs/2026-10-23-the-council-design.md#L486-L495) (`Global transitions and recovery targets`)
  - [2026-10-23-the-council-implementation-plan.md](file:///Users/aaat/projects/the-council/docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md#L203-L204) (Task 2 Step 6) and [#L358](file:///Users/aaat/projects/the-council/docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md#L358) (`restart-after-launch`)
- **Concrete Failing Scenario:**
  1. **Crash recovery with completed worker (`restart-after-launch`):** The controller launches the three initial reviewers in `reviewing` and crashes before committing their completion receipts. While the controller is down, all three workers finish on Orca and exit with valid JSON (`WorkerObservation.status === 'exited'`). On restart, `restoreForReconciliation` enters `reconciling`. In `the-council.json`, `reconciling -> reviewing` (line 0470) requires `"positive live ownership"`, while `reconciling -> settling` (line 0495) fires on `"exit established; saved result or failed attempt accounted"`. However, `settling` (lines 0503–0526) can only transition to `reconciling`, `completed`, `needs_user`, `blocked`, or `cancelled`—it has no edges to `prepare_candidate`, `collecting_questions`, `confirming`, or `evaluate_round`. Routing a valid mid-round worker exit to `settling` makes it impossible to advance the round.
  2. **Resume from settled pause (`needs_user` / `needs_context` / `blocked`):** On `resume`, the machine transitions `needs_user -> reconciling` (line 0530). Because all workers exited before the pause and the prior state was `needs_user`, `reconciling -> preflight` (line 0445) cannot require `"positive live ownership; return to this saved phase"`.
- **Smallest Correction:**
  - In [the-council.json](file:///Users/aaat/projects/the-council/docs/superpowers/diagrams/the-council.json#L442-L496) and Task 2 Step 6:
    1. Allow `reconciling -> <savedActivePhase>` when existing attempts are reconciled as either **live** or **exited with valid results** (so `<savedActivePhase>` ingests the reconciled results and advances normally).
    2. Restrict `reconciling -> settling` to failed, invalid, timed-out, or cancelled attempts (or when `savedPhase === 'settling'`).
    3. Guard `reconciling -> preflight` on `"savedPhase === 'preflight' with live ownership, OR resume from settled pause with verified prior-owner exit and no unsettled resources"`.

---

### `F-03` — Deliberation-Origin `collecting_questions` Transitions Omit Objection Ledger Merging and Trigger Polarity
- **Severity:** Important
- **Source References:**
  - [2026-10-23-the-council-design.md](file:///Users/aaat/projects/the-council/docs/superpowers/specs/2026-10-23-the-council-design.md#L311-L318) (`Clarification after deliberation starts`)
  - [2026-10-23-the-council-design.md](file:///Users/aaat/projects/the-council/docs/superpowers/specs/2026-10-23-the-council-design.md#L397-L415) (`Evidence and objection records`)
  - [2026-10-23-the-council-implementation-plan.md](file:///Users/aaat/projects/the-council/docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md#L203-L204) (Task 2 Step 6) and [#L370-L371](file:///Users/aaat/projects/the-council/docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md#L370-L371) (Task 7 Step 4)
  - [the-council.json](file:///Users/aaat/projects/the-council/docs/superpowers/diagrams/the-council.json#L543-L551) (`reviewing -> collecting_questions` and `confirming -> collecting_questions`)
- **Concrete Failing Scenario:**
  1. In Round 1 `confirming`, `openai` submits a ballot with a new objection `O-1` (`newObjections: [O-1]`), `gemini` withdraws its earlier objection `O-0` in `ownedDispositions`, and `claude` submits a blocking question in `missingInputQuestions`.
  2. At the `confirming` barrier, the machine takes `confirming -> collecting_questions` (line 0550), bypassing `evaluate_round` (where ballot objections and dispositions are normally applied) and consuming Round 1. After the user answers `claude`'s question, `publishing_answers -> prepare_round` starts Round 2. Because neither Spec lines 0311–0318 nor Plan Task 2/7 specifies merging initial-review objections on `reviewing -> collecting_questions` or applying ballot `newObjections` and owned dispositions on `confirming -> collecting_questions`, `O-1` and the disposition of `O-0` are lost.
  3. In addition, Spec line 0311 and Diagram lines 0545/0550 route to `collecting_questions` on `"missing input"`, whereas Plan line 0203 specifies `"A single blocking item from review or ballot missingInputQuestions can pause a consumed round"`. If a non-blocking question triggers `reviewing -> collecting_questions`, a minor non-blocking question aborts and consumes an entire deliberation round.
- **Smallest Correction:**
  - Specify in Spec lines 0311–0318 and Plan Task 2 Step 6 / Task 7 Step 4 that:
    1. `reviewing -> collecting_questions` merges initial-review objections into the shared objection ledger before freezing the question batch, and `confirming -> collecting_questions` registers ballot `newObjections` and applies valid `ownedDispositions` before freezing the question batch.
    2. `reviewing -> collecting_questions` and `confirming -> collecting_questions` trigger only when `missingInputQuestions` contains at least one `blocking: true` question (or an earlier promoted deferred blocking question); non-blocking questions are recorded in the ledger as explicit uncertainty without aborting the round.

---

### `F-04` — Guard Labels on `publishing_answers -> prepare_round`, `preflight -> publishing_answers`, and `preflight -> clarifying` Omit All-Ready Wave 1, `AnswerRevision`, and Mid-Wave Clarification Remedies
- **Severity:** Minor
- **Source References:**
  - [the-council.json](file:///Users/aaat/projects/the-council/docs/superpowers/diagrams/the-council.json#L253-L271) and [#L288-L296](file:///Users/aaat/projects/the-council/docs/superpowers/diagrams/the-council.json#L288-L296)
  - [2026-10-23-the-council-design.md](file:///Users/aaat/projects/the-council/docs/superpowers/specs/2026-10-23-the-council-design.md#L295-L304) and [#L494-L498](file:///Users/aaat/projects/the-council/docs/superpowers/specs/2026-10-23-the-council-design.md#L494-L498)
  - [2026-10-23-the-council-implementation-plan.md](file:///Users/aaat/projects/the-council/docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md#L201-L202) and [#L370-L372](file:///Users/aaat/projects/the-council/docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md#L370-L372)
- **Concrete Failing Scenario:**
  1. **Wave 1 all-ready:** In Clarification Wave 1 (`clarificationBatchesUsed = 1`), all three seats return readiness with zero questions. In `the-council.json`, `clarifying` only transitions forward to `collecting_questions` (line 0275), which only transitions forward to `publishing_answers` (line 0280). At `publishing_answers`, `publishing_answers -> prepare_round` (line 0295) is labeled `"no unresolved blocking item; roundsUsed < maxRounds; final clarification or deliberation continuation"`. If `"final clarification"` is implemented as `clarificationBatchesUsed === maxClarificationBatches` (`1 === 2`), Wave 1 all-ready cannot enter `prepare_round`.
  2. **Post-limit `AnswerRevision`:** At `needs_user` (`CLARIFICATION_LIMIT`), Batch 2 is already finalized and published. When the user submits an `AnswerRevision` against `currentContextHash` (Spec line 0301), `preflight -> publishing_answers` (line 0260) only checks `"finalized queued answers for saved batch"`, rejecting or missing the `AnswerRevision`.
  3. **Mid-wave `clarifying` remedy:** `preflight -> clarifying` (line 0255) is labeled `"new or next authorized clarification wave"` (which increments `clarificationBatchesUsed`), with no separate guarded remedy branch (unlike lines 0553–0576 for deliberation phases) to resume unissued `clarifying` effects without consuming the second batch counter.
- **Smallest Correction:**
  - In Task 2 Step 5/6 and [the-council.json](file:///Users/aaat/projects/the-council/docs/superpowers/diagrams/the-council.json#L253-L296):
    1. Define the `publishing_answers -> prepare_round` guard explicitly as `noUnresolvedBlocking && roundsUsed < maxRounds && (origin === 'deliberation' || clarificationBatchesUsed === maxClarificationBatches || currentWaveQuestionCount === 0)`, and treat zero-question waves in `publishing_answers` as a no-op context commit.
    2. Allow `preflight -> publishing_answers` on a valid queued `AnswerRevision` (or user facts/direction update) against `currentContextHash`.
    3. Guard `preflight -> clarifying` so resuming `resumeTarget === 'clarifying'` with unissued effects does not increment `clarificationBatchesUsed` or reserve duplicate call slots.

---

### `F-05` — Pure Reducer Replay and Contract Completeness for `ActiveBudget`, Bounded Extensions, Issued Attempts, and Material Evidence IDs
- **Severity:** Minor
- **Source References:**
  - [2026-10-23-the-council-implementation-plan.md](file:///Users/aaat/projects/the-council/docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md#L116-L145) (`Shared contracts`)
  - [2026-10-23-the-council-implementation-plan.md](file:///Users/aaat/projects/the-council/docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md#L204-L205) (Task 2 Step 7) and [#L329-L330](file:///Users/aaat/projects/the-council/docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md#L329-L330) (Task 7 `accountBudget`)
- **Concrete Failing Scenario:**
  1. `RunContext` (Plan line 0137) stores `ActiveBudget` and `deadlines`, and Task 2 Step 7 requires deterministic replay of `RunSnapshot` from the recorded `ValidatedEvent` history via `reduceRun`. However, `ValidatedEvent` (line 0143) omits `clockReceipt: ClockReceipt`, and `accountBudget` is scheduled for Task 7 (`src/runtime/budget.ts`, line 0329) instead of Task 1/2. If Task 7 mutates `ActiveBudget` outside `reduceRun`, replaying events through `reduceRun` will not reproduce saved budget snapshots.
  2. `RunContext` treats `RunRequest` as frozen (line 0137) with no fields for bounded extensions (`maxClarificationBatches`, `maxRounds`, `activeBudgetMs`), user priority/fact records in `SharedContext` when no `QuestionBatch` is open, or per-task `issuedAttemptIds` needed by pure guards to block retrying an issued worker that failed via timeout or empty exit rather than `INVALID_WORKER_RESULT`.
  3. In `FrozenCandidate` (line 0130), letting the candidate payload alone define which evidence IDs are material allows an unverified reviewer evidence request to bypass the freeze guard if omitted from `materialEvidenceIds`.
- **Smallest Correction:**
  - Add `clockReceipt: ClockReceipt` to `ValidatedEvent` and move pure `accountBudget` into Task 1/2 so `reduceRun` updates `ActiveBudget` deterministically.
  - Add effective limit fields (or an `extensions` ledger) and `issuedLogicalTasks` to `RunContext` (setting `inferenceBlock` on any issued attempt that exits without a valid payload), add a `userDirections` array to `SharedContext`, and require the `prepare_candidate -> judging` freeze guard to check `acknowledgedUnverifiedEvidenceIds` against all reviewer-requested `EvidenceRecord` IDs whose status is `unverified` or `invalid`.

---

## Verification of Remaining Review Dimensions

- **Counting, 27-Call Bound, and Format Normalization:** Separate batch/round counters reserved atomically on first launch intent, `3 * 2 + 7 * 3 = 27` call cap, bounded local JSON surface normalization (single whole-message fence and trailing commas outside strings), and terminal `INVALID_WORKER_RESULT` block with zero replacement inferences are consistent and sound.
- **Equal Information and Phase Settlement:** All reviewer seats receive identical `configHash`, `profileHash`, `contextHash`, `candidateHash`, `evidenceHash`, and `judgeHash`. Reviewers settle before the judge starts; the judge settles before confirmation starts; watchdogs and child processes are included in positive settlement checks.
- **Durable Input and Active-Work Budget:** Atomic per-request inbox files in `respond`, positive prior-owner exit evidence in `resume`, same-epoch monotonic timing in-process, conservative wall-clock charging across active crashes, and zero charge during settled human pauses are properly specified. The plan explicitly and appropriately does not promise that all 27 calls fit inside the three-hour active budget.
- **Model Defaults and Current Host Policy:** Shipped `council.yaml` defaults (`gpt-6-astra`/`ultra` for OpenAI reviewer and fresh judge, `gemini-4-argon-high`/`high` for Gemini, `claude-opus-5-5-high`/`high` for Claude) are preserved. Under `/Users/aaat/.agents/policies/model-policy.md`, `gpt-6-astra` at `ultra` requires explicit approval for a named bounded attempt, verified descendant controls, and explicit extra-slot authorization if the calling parent is also Astra. The design and plan accurately enforce these as preflight and route-qualification gates (`ASTRA_CALLER_CONFLICT`, `UNQUALIFIED_ROUTE`) without silent model or effort fallback.

---

## Remaining Qualification Limitations and Unresolved Design Points

1. **Supplied Source Truncation:** In the supplied review packet, [the-council.json](file:///Users/aaat/projects/the-council/docs/superpowers/diagrams/the-council.json#L784) was truncated (`<truncated 10571 bytes>`) after line 0784 inside the fourth explanatory diagram (`id: "clarification"`). The normative 17-state diagram (`id: "states"`, lines 0163–0579), component diagram (`id: "components"`), and recovery diagram (`id: "recovery"`) were supplied in full and inspected completely. No external file reads or tools were invoked.
2. **Live Route Qualification Gate (Task 5 / Task 8):** No tests were executed and no live transports are certified by this review. As documented in Spec lines 0723–0725 and Plan lines 0058, 0296–0298, live Council execution and skill installation remain gated on qualifying:
   - Codex `gpt-6-astra` at `ultra` with verified descendant controls and explicit bounded user approval,
   - Antigravity `gemini-4-argon-high` and `claude-opus-5-5-high` headless execution with clean process shutdown (reconciling the previously recorded nonzero Argon exit), and
   - Real Orca supervised Run/Task/Dispatch lifecycle receipts rather than terminal-only ownership.
3. **Unresolved Design Points for Coordinator Disposition:**
   - Whether `validateAnswerBatch` requires an explicit `Answer` entry per original question ID when `GroupingProposal` aliases duplicate questions, or expands one representative answer across aliased IDs while inheriting `blocking: true` if any member question is blocking.
   - Whether a deliberation-origin question answered with `status: 'unknown'` or `'declined'` in Round 1 or 2 should pause at `needs_user` (per `F-01` correction above) or allow the user to explicitly convert the unknown fact into a recorded candidate assumption for Round `N+1`.
