COUNCIL-END-5da76df289524f838ea5e2e1466c3077 | diagrams=4 | controlStates=17

**Verdict:** `PROCEED_WITH_CHANGES`

**Source Completeness:** All four supplied sources ([2026-10-23-the-council-design.md](file:///Users/aaat/projects/the-council/docs/superpowers/specs/2026-10-23-the-council-design.md) lines 0001–0730, [2026-10-23-the-council-implementation-plan.md](file:///Users/aaat/projects/the-council/docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md) lines 0001–0440, [the-council.json](file:///Users/aaat/projects/the-council/docs/superpowers/diagrams/the-council.json), and [README.md](file:///Users/aaat/projects/the-council/docs/superpowers/diagrams/README.md) lines 0001–0043) arrived complete with no truncation.

---

### Executive Assessment

The specification, implementation plan, and four canonical diagrams establish a sound architecture for a local XState-controlled Council runner over Orca. The core invariants—two shared clarification batches (`<= 6` calls) separated from three deliberation rounds (`<= 21` calls), a 27-call default bound with local-only JSON normalization, phase-barrier collection in stable seat order, shared append-only question/answer ledgers, evidence-before-synthesis barriers, fresh non-voting round judges, owner-bound objections where same-ballot new objections start open and prevent consensus, terminal inference blocking on invalid worker output with budget closure, and frozen `council.yaml` rosters preserving default models (`gpt-6-astra` `ultra`, `gemini-4-argon-high` `high`, `claude-opus-5-5-high` `high`)—are well-aligned across the documents.

Five material defects in transition guards, crash-recovery state tracking, and wire-to-ledger TypeScript contracts can cause false consensus, premature deliberation admission, un-reconcilable pre-launch crash states, or strict schema rejection on valid worker output. Each has a small, bounded correction.

---

### Material Findings

#### `F-01` — High: Queued `ContextUpdate` During Active Deliberation Has No Valid State Transition Path

* **Source Locations:**
  * [2026-10-23-the-council-design.md](file:///Users/aaat/projects/the-council/docs/superpowers/specs/2026-10-23-the-council-design.md#L515) (`### Durable input when the controller has exited`, line 0515; `## Limits and user intervention`, line 0621)
  * [2026-10-23-the-council-implementation-plan.md](file:///Users/aaat/projects/the-council/docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md#L122) (`## Shared contracts`, line 0122)
  * [the-council.json](file:///Users/aaat/projects/the-council/docs/superpowers/diagrams/the-council.json) (`states` diagram: outgoing transitions from `reviewing`, `prepare_candidate`, `judging`, `confirming`, and `settling`)
* **Defect:** Spec line 0621 and Plan line 0122 state that a `ContextUpdate` submitted during an active deliberation wave *"stays queued until settlement and consumes/invalidates the interrupted deliberation round,"* *"publishes one context for all seats before the next admitted round,"* and applies *"only in `preflight` or `prepare_round` at a positively settled boundary with no open question batch, before launch intents; ... It does not use `publishing_answers`."* However, in the normative 17-state machine ([the-council.json](file:///Users/aaat/projects/the-council/docs/superpowers/diagrams/the-council.json)), none of `reviewing`, `prepare_candidate`, `judging`, or `confirming` has a transition to `prepare_round` (or `preflight`) when the active phase settles with a queued `ContextUpdate`. Nor can `-> settling` (`"required user input"`) reach `prepare_round`, because `settling` exits only to `completed`, `needs_user`, `blocked`, `cancelled`, or `reconciling`.
* **Concrete Failing Scenario:** While Round 1 `confirming` is running, the user submits a `ContextUpdate` via `council respond`. When all three `confirming` worker tasks settle, the active controller polls the inbox (Spec line 0515) and sees the queued `ContextUpdate`, but cannot apply it in `confirming` and has no transition to `prepare_round`. Instead, `confirming -> evaluate_round` runs against the pre-update `contextHash`; if all three ballots accepted the Round 1 candidate, `evaluate_round -> settling -> completed` reports unanimous consensus while silently discarding the user's `ContextUpdate`. Similarly, if `ContextUpdate` arrives during `reviewing` in Round 1, the machine cannot divert to Round 2 after the three reviews settle and instead wastes four worker calls (`judging` + three `confirming` ballots) on the invalidated round; or if `ContextUpdate` interrupts Round 3 (`roundsUsed == maxRounds`), `ContextUpdate` cannot be committed before `settling -> needs_user`.
* **Smallest Correction:** Add guarded diversion edges (or extend the settled phase-barrier transitions on `reviewing`, `prepare_candidate`, `judging`, and `confirming`, after committing valid review/ballot objections and dispositions) when a valid `ContextUpdate` is queued: if `roundsUsed < effectiveLimits.maxRounds`, transition to `prepare_round` and apply the `ContextUpdate` before Round `N+1` launch intents; if `roundsUsed >= effectiveLimits.maxRounds`, commit the `ContextUpdate` and transition to `settling` with `pendingOutcome = 'needs_user'` (`ROUND_LIMIT`).

---

#### `F-02` — High: `preflight -> prepare_round` and `publishing_answers -> clarifying` Guards Omit Blocking-Question and Extended-Batch Checks

* **Source Locations:**
  * [the-council.json](file:///Users/aaat/projects/the-council/docs/superpowers/diagrams/the-council.json) (`states` diagram: transitions `preflight -> prepare_round` and `publishing_answers -> clarifying`)
  * [2026-10-23-the-council-design.md](file:///Users/aaat/projects/the-council/docs/superpowers/specs/2026-10-23-the-council-design.md#L299) (`## Shared clarification before deliberation`, lines 0299–0305; `### Global transitions and recovery targets`, line 0499; `## Limits and user intervention`, line 0579)
  * [2026-10-23-the-council-implementation-plan.md](file:///Users/aaat/projects/the-council/docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md#L123) (`## Shared contracts`, line 0123; `## Task 2`, lines 0204–0205)
* **Defect:**
  1. In [the-council.json](file:///Users/aaat/projects/the-council/docs/superpowers/diagrams/the-council.json), `publishing_answers -> prepare_round` enforces `"no unresolved blocking ledger item + roundsUsed < maxRounds"`, and records `resumeTarget = 'prepare_round'` when settling to `needs_user` so a subsequent `AnswerRevision` can proceed to deliberation. However, `preflight -> prepare_round` checks only `"checks pass; saved deliberation target"`, omitting `"no unresolved blocking ledger item"` and `"roundsUsed < effectiveLimits.maxRounds"`.
  2. In [the-council.json](file:///Users/aaat/projects/the-council/docs/superpowers/diagrams/the-council.json), `publishing_answers -> clarifying` hardcodes `"answer_batch only; clarification origin; roundsUsed = 0; wave one had questions; allowance remains"`, which blocks transitioning from Wave 2's `publishing_answers` into Wave 3 when a `BoundedExtension` (Plan line 0123, Spec line 0579) increases `effectiveLimits.maxClarificationBatches`.
* **Concrete Failing Scenario:**
  1. After Wave 2 publishes an `AnswerBatch` containing an `unknown` blocking answer (or after Round 3 exhausts `maxRounds = 3`), the run settles to `needs_user` with `resumeTarget = 'prepare_round'`. The user submits a `BoundedExtension` that increases only `activeBudgetMs` (valid under Plan line 0123: *"nonnegative additions to clarification batches, rounds, and active-budget ms; at least one addition is positive"*) and runs `council resume`. The machine transitions `needs_user -> reconciling -> preflight`, does not enter `publishing_answers` (no `AnswerBatch` or `AnswerRevision` is queued), and takes `preflight -> prepare_round` (`"checks pass; saved deliberation target"`), admitting deliberation with an unresolved blocking question or launching an unauthorized 4th round.
  2. A user authorizes a `BoundedExtension` raising `maxClarificationBatches` to `3`. After Wave 2's `AnswerBatch` is published in `publishing_answers`, the guard `"wave one had questions"` evaluates false (`clarificationBatchesUsed == 2`), preventing Wave 3 from starting.
* **Smallest Correction:** Require `no unresolved blocking ledger item && roundsUsed < effectiveLimits.maxRounds` on `preflight -> prepare_round` (routing to `settling -> needs_user` if either check fails, or `preflight -> clarifying` if `roundsUsed == 0 && clarificationBatchesUsed < effectiveLimits.maxClarificationBatches`), and replace `"wave one had questions"` on `publishing_answers -> clarifying` with `"current wave had questions; clarificationBatchesUsed < effectiveLimits.maxClarificationBatches"`.

---

#### `F-03` — Medium: Missing `reconcileOriginState` in `RunContext` Creates Guard Overlap in `reconciling` and Skips Preflight Rechecks After Active Crash Recovery

* **Source Locations:**
  * [2026-10-23-the-council-implementation-plan.md](file:///Users/aaat/projects/the-council/docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md#L138) (`## Shared contracts`, lines 0138–0139; `## Task 2`, lines 0190, 0205; `## Task 7`, lines 0342, 0374)
  * [2026-10-23-the-council-design.md](file:///Users/aaat/projects/the-council/docs/superpowers/specs/2026-10-23-the-council-design.md#L168) (`### Frozen run configuration`, line 0168; `### Global transitions and recovery targets`, lines 0491–0493)
  * [the-council.json](file:///Users/aaat/projects/the-council/docs/superpowers/diagrams/the-council.json) (`states` diagram description and outgoing transitions from `reconciling`)
* **Defect:**
  1. `restoreForReconciliation(snapshot: RunSnapshot): RunSnapshot` (Plan line 0190) sets `snapshot.state = 'reconciling'`, and [the-council.json](file:///Users/aaat/projects/the-council/docs/superpowers/diagrams/the-council.json) relies on `"saved active phase"` vs `"saved target"` to make return edges from `reconciling` mutually exclusive. However, `RunContext` (Plan line 0139) defines only `resumeTarget` and has no field (`savedPhase` / `reconcileOriginState`) recording the state that was active before `restoreForReconciliation` or `-> reconciling` overwrote `snapshot.state`.
  2. If `resumeTarget` is overloaded to hold the interrupted active state (or retains a prior pause target), and the controller crashes during `reviewing` while all three workers and watchdogs finish with valid saved results before `council resume` runs, both `reconciling -> preflight` (`"all external resources settled + prior controller exited + saved target"`) and `reconciling -> reviewing` (`"saved active phase; ... exited valid saved result"`) are simultaneously satisfied.
  3. When `reconciling -> reviewing` fires after a controller crash, the machine ingests the saved `reviewing` results and transitions `reviewing -> prepare_candidate -> judging -> confirming`, emitting new `launch` intents for the judge and confirmation workers without passing through the `preflight` state—even though Spec line 0168 and Plan lines 0342/0374 require `resume` to recheck current policy, availability, allowance, concurrency, and qualification before new launches.
* **Smallest Correction:** Add `reconcileOriginState: ControlState | null` to `RunContext` (set whenever entering `reconciling` and cleared upon exiting `reconciling`, while clearing `resumeTarget` upon leaving `preflight`). Guard `reconciling -> preflight` on `reconcileOriginState` in `{'preflight', 'needs_user', 'needs_context', 'blocked'}`, guard `reconciling -> <active_phase>` on `reconcileOriginState === <active_phase>`, and require the controller's `resume` path to run `runPreflight` before executing any new outbox `launch` intent after active-phase recovery.

---

#### `F-04` — Medium: Recording Logical Issuance in the Pure Reducer Prevents Recovery of Pre-Launch Crash Windows

* **Source Locations:**
  * [2026-10-23-the-council-design.md](file:///Users/aaat/projects/the-council/docs/superpowers/specs/2026-10-23-the-council-design.md#L501) (`### Global transitions and recovery targets`, line 0501; `## Required implementation verification`, line 0686)
  * [2026-10-23-the-council-implementation-plan.md](file:///Users/aaat/projects/the-council/docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md#L139) (`## Shared contracts`, line 0139; `## Task 2`, line 0203; `## Task 3`, line 0229; `## Task 5`, line 0294; `## Task 7`, line 0374)
* **Defect:** Plan line 0374 states both *"preserved valid results and unissued effects can continue, but issued inferences cannot repeat"* and *"Record logical issuance at launch intent and reconcile the same attempt."* In Task 2/Task 3, `reduceRun` emits all three `launch` `EffectIntent`s when entering a wave (`clarifying`, `reviewing`, `confirming`), and `commitTransition` commits `RunSnapshot` (including `RunContext.issuedLogicalTasks`) and the outbox intents in a single SQLite transaction before any external `transport.launch` call executes (Plan lines 0226, 0371). If `issuedLogicalTasks` marks all three tasks as issued inside `reduceRun`, SQLite has identical state whether the process is killed 1 ms *before* invoking `transport.launch` or 1 ms *after* invoking `transport.launch` (before `recordEffectReceipt`).
* **Concrete Failing Scenario:** In Task 3 Step 6 (Plan line 0229: *"Kill the test child before external launch, after a fake launch, and before receipt commit"*), the controller commits `prepare_round -> reviewing` and is killed before calling `transport.launch` for `gemini` and `claude`. On `resume`, Orca reports no existing attempt for `gemini` or `claude`. Because both tasks are already marked as issued in `issuedLogicalTasks`, the controller treats them as issued inferences that exited without a valid result and terminally blocks the run (`Spec line 0501`) instead of executing the unissued outbox intents.
* **Smallest Correction:** Record `pending_execution` in `issuedLogicalTasks` / outbox during `commitTransition`, write a synchronous `dispatched` state (with the deterministic attempt/replay key) to `RunStore` immediately before invoking `transport.launch`, and write `receipt_recorded` upon return. Treat only `dispatched` and `receipt_recorded` entries as issued inferences during reconciliation; `pending_execution` entries were never sent to Orca and remain eligible unissued effects.

---

#### `F-05` — Medium: Wire-vs-Ledger Schema Mismatch in `parseWorkerPayload`, Question ID Namespacing, and `AnswerRevision` First Answers for Deferred Questions

* **Source Locations:**
  * [2026-10-23-the-council-design.md](file:///Users/aaat/projects/the-council/docs/superpowers/specs/2026-10-23-the-council-design.md#L269) (`## Shared clarification before deliberation`, lines 0269–0275, 0301)
  * [2026-10-23-the-council-implementation-plan.md](file:///Users/aaat/projects/the-council/docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md#L118) (`## Shared contracts`, lines 0118, 0121, 0129–0133, 0151; `## Task 1`, lines 0165, 0180; `## Task 4`, lines 0241–0242, 0266)
* **Defect:**
  1. Plan line 0118 defines `Question` with `namespaced ID`, `disposition: presented | deferred`, and `adapter-derived seat/attempt origin`, and Plan line 0133 defines `Objection` with `owner reviewer seat`. Yet Plan lines 0129/0131 embed `Question[]` and `Objection[]` directly in `WorkerPayload`, which `parseWorkerPayload(raw: unknown): WorkerPayload` (Plan line 0165) decodes from raw model output with strict Zod objects (Plan line 0151) before adapter provenance binding or batch compilation—while Plan lines 0130/0180 prohibit model output from supplying adapter provenance or seat claims.
  2. Spec line 0269 specifies that reviewers emit a `seat-local ID` and `dependencyIds` referencing either earlier ledger questions or current-wave questions. The plan does not specify the deterministic namespacing rule converting seat-local IDs into ledger IDs and rewriting same-seat current-wave `dependencyIds`.
  3. Spec line 0301 and Plan line 0266 state that `AnswerRevision` can supply *"a first answer for an already recorded deferred question whose dependencies are now satisfied,"* whereas Plan line 0121 requires `AnswerRevision` to contain *"new answer records with explicit predecessor references."* A previously deferred question was never presented and has no prior `Answer` record in the ledger.
* **Concrete Failing Scenario:**
  1. A reviewer returns a valid question with seat-local fields (`id`, `text`, `reason`, `blocking`, `answerForm`, `dependencyIds`). Strict Zod decoding in `parseWorkerPayload(raw)` fails because `disposition` and adapter `origin` are missing (or fails provenance rules if included), causing a false `INVALID_WORKER_RESULT` terminal block.
  2. `openai` and `gemini` independently emit seat-local question ID `"q1"` in Wave 1 and collide in `buildQuestionBatch`.
  3. At `CLARIFICATION_LIMIT`, the user submits an `AnswerRevision` providing a first answer to a deferred blocking question whose dependency was answered in Wave 2; validation rejects the revision because no predecessor `Answer` ID exists for that question.
* **Smallest Correction:** Define raw wire schemas (`RawQuestion`, `RawObjection`) inside `WorkerPayload` for `parseWorkerPayload(raw: unknown)`, and produce bound `Question` / `Objection` records in `decodeProviderOutput` / `buildQuestionBatch` by attaching adapter provenance, namespacing IDs as `<origin>:<seat>:<localId>`, rewriting same-wave seat-local `dependencyIds` to that seat's namespaced IDs, and computing `disposition: 'presented' | 'deferred'`. In `AnswerRevision` (Plan line 0121), require `supersededAnswerId: string` when superseding a prior `unknown`/`declined` answer and `supersededAnswerId: null` when recording the first answer to a previously un-answered `deferred` question whose dependencies are `'answered'` (either in the prior ledger or within the same `AnswerRevision`).

---

### Verification of Regression Cases and Non-Defect Boundaries

* **Regression checks verified:**
  1. *Settled resume with no live resources reaches preflight:* Present in [the-council.json](file:///Users/aaat/projects/the-council/docs/superpowers/diagrams/the-council.json) (`needs_user`/`needs_context`/`blocked -> reconciling -> preflight`), subject to `F-02` and `F-03`.
  2. *Consensus checks the entire bound question ledger:* Enforced in Spec line 0429 and Plan lines 0136, 0180.
  3. *Every late `missingInputQuestions` entry diverts the round (including nonblocking/source-answerable):* Enforced in Spec line 0315, Plan line 0205, and [the-council.json](file:///Users/aaat/projects/the-council/docs/superpowers/diagrams/the-council.json) (`reviewing -> collecting_questions` and `confirming -> collecting_questions`).
  4. *All-ready Wave 1 skips remaining clarification:* Enforced in Spec line 0295, Plan line 0204, and [the-council.json](file:///Users/aaat/projects/the-council/docs/superpowers/diagrams/the-council.json) (`clarifying -> collecting_questions -> publishing_answers -> prepare_round`).
  5. *`AnswerRevision` after batch-two exhaustion resolves an earlier question without another wave:* Enforced in Spec lines 0301–0307 and [the-council.json](file:///Users/aaat/projects/the-council/docs/superpowers/diagrams/the-council.json), subject to `F-05` for deferred questions.
  6. *New same-ballot objections cannot be closed:* Enforced in Spec line 0419 and Plan lines 0136, 0180 (`inputObjectionIds` snapshot and non-empty `newObjections` consensus block).
  7. *Invalid-result terminal settlement closes the budget:* Enforced in Spec line 0541 and Plan lines 0165, 0296 (`terminal-settlement`).
  8. *No exact duplicate canonical transitions:* Confirmed across all 67 transitions in [the-council.json](file:///Users/aaat/projects/the-council/docs/superpowers/diagrams/the-council.json).
* **Three-hour active-work budget vs 27-call bound:** Correctly documented as an independent ceiling (`min(worker deadline, run deadline)`), not a promise that 27 calls at 30 minutes each fit inside three hours (Spec line 0605).

---

### Remaining Qualification Limitations and Unresolved Design Points

1. **Live Transport and Model Qualification Gates (Documented Prerequisite, Not a Plan Defect):**
   * No tests or live provider runs were executed during this review.
   * Under `/Users/aaat/.agents/policies/model-policy.md`, the default roster (`gpt-6-astra` `ultra` reviewer and judge, `gemini-4-argon-high` `high`, `claude-opus-5-5-high` `high`) requires: (a) explicit user approval for a named bounded attempt using `gpt-6-astra` at `ultra`, (b) a verified Codex `ultra` route exposing descendant model, effort, route, and concurrency controls, (c) explicit extra-slot approval if the calling coordinator is also an active Astra session, and (d) live process-settlement qualification on macOS (noting Spec line 0728's observation that an earlier Argon assessment required forced cleanup). Task 5 Steps 9–10 and Task 8 Step 9 properly gate live execution on these receipts.
2. **Unresolved Design Points for Builder Clarification in Contracts:**
   * **All-ready vs source-answered `publicationKind` in `publishing_answers`:** When `collecting_questions -> publishing_answers` fires with no human questions (Transition 8), `reduceRun` should explicitly set `publicationKind = null` when the wave had zero questions (all-ready skip) and `publicationKind = 'answer_batch'` when the wave had source-answered questions so Wave 1 source-answered batches deterministically take `publishing_answers -> clarifying` (Spec line 0295, Plan line 0372).
   * **Same-epoch wall-clock jitter vs cross-epoch crash accounting:** In `accountBudget` (Plan line 0165, 0374), specify that same-epoch events compute elapsed time strictly from `monotonicMs` (ignoring minor NTP wall-clock jitter), whereas cross-epoch `crash-reconcile` events compute elapsed downtime from `wallMs` and block on `observation.wallMs < budget.lastReceipt.wallMs`.
