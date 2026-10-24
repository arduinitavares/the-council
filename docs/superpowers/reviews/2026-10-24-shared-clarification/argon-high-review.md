## Verdict: `PROCEED_WITH_CHANGES`

The Council design (`docs/superpowers/specs/2026-10-23-the-council-design.md`), implementation plan (`docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md`), and canonical diagrams (`docs/superpowers/diagrams/the-council.json` and `README.md`) form a well-structured, implementable specification. The separation between pure XState transitions and persisted effect intents, the 27-call ceiling (`3 * 2 + 7 * 3`) without model format-repair calls, the frozen `council.yaml` roster, equal reviewer authority with a voteless fresh judge, monotonic/wall-clock active-budget accounting, and host-policy preflight gates are coherent and testable.

Four material specification and contract gaps exist around late deliberation questions, same-wave question dependencies and post-limit answer revisions, same-ballot objection closure, and foreground controller inbox/resume handling. Resolving these bounded items requires no architectural redesign.

---

## Material Findings

### `C-01` — Late missing-input questions in deliberation can misroute to `clarifying` or bypass `QuestionBatch` binding
- **Severity:** Important
- **Source locations:**
  - `docs/superpowers/specs/2026-10-23-the-council-design.md` (`Clarification after deliberation starts`, lines `0303–0311`; `Global transitions and recovery targets`, lines `0482–0485`)
  - `docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md` (`Shared contracts`, lines `0117–0122`, `0125`; `Task 2`, lines `0200–0201`; `Task 4`, lines `0237–0238`; `Task 7`, line `0368`)
  - `docs/superpowers/diagrams/the-council.json` (`states`, lines `0256–0301`, `0308–0311`, `0393–0396`)
- **Failing scenario:**
  1. In Clarification Wave 1 (`clarificationBatchesUsed = 1`), all three reviewers return readiness with no questions. The run skips Wave 2 (`Spec 0291`) and starts Deliberation Round 1 (`roundsUsed = 1`, while `clarificationBatchesUsed = 1 < maxClarificationBatches = 2`).
  2. During Round 1 `reviewing`, one reviewer raises a structured material missing-input issue (`Spec 0305`, `Plan 0125`).
  3. First, in `the-council.json` (`0393–0396`), `reviewing` transitions directly to `settling` (`pendingOutcome: 'needs_user'`) rather than `collecting_questions`, and `PhaseBindings` (`Plan 0122`) sets `clarificationBatch: null` during deliberation. Neither `Task 2` nor `Task 7` specifies freezing a `QuestionBatch` before `settling -> needs_user` when a missing-input issue is raised in `reviewing`, leaving `council respond` without a target `batchId` and `baseContextHash` (`Plan 0118`, `Spec 0490`).
  4. Second, once answers are queued and `council resume` transitions `needs_user -> reconciling -> preflight -> publishing_answers`, `clarificationBatchesUsed` is still `1 < 2`. Because the transition `publishing_answers -> clarifying` (`the-council.json` `0288–0291`, `Plan 0200`) checks whether follow-up clarification allowance remains without checking `roundsUsed === 0`, the state machine routes from Deliberation Round 1 back into pre-deliberation `clarifying`, violating `Spec 0309` (*"The runner never returns to the pre-deliberation clarification allowance to gain free rounds"*).
  5. Third, if a missing-input issue pauses Round 3 (`roundsUsed === maxRounds === 3`) and the user submits answers without an explicit bounded `maxRounds` extension (`Spec 0311`), `publishing_answers -> prepare_round` (`the-council.json` `0293–0296`) transitions into `prepare_round` with no remaining round allowance.
- **Smallest correction:**
  - Emit a `question-batch request` intent and freeze a `QuestionBatch` (with a round-scoped batch ID) before `reviewing` settles to `needs_user` for missing input (or route `reviewing -> collecting_questions` when missing-input issues exist).
  - Guard `publishing_answers -> clarifying` with `roundsUsed === 0 && clarificationBatchesUsed < maxClarificationBatches`.
  - Guard `publishing_answers -> prepare_round` with `noUnresolvedBlockingQuestions && roundsUsed < maxRounds`, and route `publishing_answers -> settling` (`pendingOutcome: 'needs_user'`) when `roundsUsed === maxRounds` or a blocking question remains unresolved.

---

### `C-02` — Same-wave dependent questions and post-limit blocking-answer revisions deadlock under `QuestionBatch` / `AnswerBatch` rules
- **Severity:** Important
- **Source locations:**
  - `docs/superpowers/specs/2026-10-23-the-council-design.md` (`Shared clarification before deliberation`, lines `0269`, `0277`, `0283–0287`, `0293–0297`; `Durable input when the controller has exited`, lines `0488–0494`)
  - `docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md` (`Shared contracts`, lines `0117–0118`; `Task 1`, line `0175`; `Task 4`, lines `0237–0238`, `0262`; `Task 7`, lines `0342`, `0369`)
- **Failing scenario:**
  - **Scenario A (Orphaned deferred question):** `Plan 0238` states: *"Dependencies can reference only earlier answered ledger entries; same-wave dependent follow-ups defer to the next batch."* First, the two clauses conflict: if `dependencyIds` may reference only earlier answered ledger entries, a same-wave dependency ID fails validation as a missing ledger entry (`Plan 0175`) instead of deferring. Second, if `Q2` (`blocking: true`, `dependencyIds: ['openai:Q1']`) in Wave 1 is recorded in `QuestionBatch.originalQuestions` (entering the append-only ledger, `Spec 0285`) but deferred from Batch 1's `presentedQuestionIds` (`Spec 0277`), the user answers only `Q1` in Batch 1. In Batch 2, `buildQuestionBatch(results, grouping, sourceAnswers)` (`Plan 0237`) takes only Wave 2 `WorkerResult[]` and not prior deferred ledger questions. If `openai` returns readiness in Wave 2, `Q2` is never presented in Batch 1 or Batch 2, remains unanswered in the complete ledger, and triggers a permanent `CLARIFICATION_LIMIT` block after Batch 2 under `Spec 0295` (*"Any unresolved blocking question in the complete ledger, including an earlier batch, prevents admission to deliberation"*). Similarly, a blocking same-wave dependent question emitted in Batch 2 (the final clarification batch) has no Batch 3 to defer to.
  - **Scenario B (Blocked revision at `CLARIFICATION_LIMIT`):** A blocking question `Q1` in Batch 1 or Batch 2 is finalized with `status: 'unknown'`. When `publishing_answers` commits the batch, `SharedContext.contextHash` advances from `H1` to `H2` (`Spec 0287`), and after Batch 2 `publishing_answers` transitions to `settling -> needs_user` with `CLARIFICATION_LIMIT` (`Spec 0295`). `Spec 0297` promises: *"Later user evidence creates an explicit ledger revision and is revalidated without another clarification inference."* However, `AnswerBatch` (`Plan 0118`) and `validateAnswerBatch(batch, answers)` (`Plan 0238`) validate answers only against a single `QuestionBatch` and its pre-publication `baseContextHash` (`H1`), while `Plan 0342` and `0369` reject stale `baseContextHash` values and already-finalized batches. Any subsequent `council respond` attempting to resolve `Q1` against `H2` is rejected.
- **Smallest correction:**
  - Either restrict `Question.dependencyIds` to questions already answered in prior published ledger revisions (requiring reviewers to ask dependent follow-up questions in Wave 2 after seeing Wave 1 answers), or pass prior deferred ledger questions into `buildQuestionBatch` so Batch 2 promotes satisfied Batch 1 deferred questions into `presentedQuestionIds` and rejects/presents (rather than deferring) same-wave dependencies in the final batch.
  - Allow `AnswerBatch` / `validateAnswerBatch` when paused at `CLARIFICATION_LIMIT` to bind the current `SharedContext.contextHash` (`H2`) and append superseding `Answer` records for unresolved blocking `questionId`s in the ledger (and allow a seat in Wave 2 to explicitly supersede its own Batch 1 blocking question if proceeding under an assumption).

---

### `C-03` — `applyOwnedDispositions` order allows a ballot to open and close a new objection in the same round
- **Severity:** Important
- **Source locations:**
  - `docs/superpowers/specs/2026-10-23-the-council-design.md` (`Evidence and objection records`, lines `0383–0393`; `Exact consensus rule`, line `0412`; `Required implementation verification`, line `0646`)
  - `docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md` (`Shared contracts`, lines `0127`, `0129`; `Task 1`, lines `0160`, `0166`, `0175`)
- **Failing scenario:**
  - `Plan 0127` defines `Ballot` with `newObjections: Objection[]` and `ownedObjectionDispositions`, where `Objection` (`Plan 0129`) includes `status: 'open' | 'closed'`. `Plan 0175` specifies: *"Register new owned objections, reject conflicting IDs, then apply owner dispositions and evaluate consensus."*
  - If a reviewer's `confirming` ballot emits an entry in `newObjections` with `status: 'closed'`, or emits `newObjections: [{ id: 'obj-new', status: 'open', ... }]` alongside a disposition in `ownedObjectionDispositions` closing `'obj-new'`, registering `newObjections` before applying `ownedObjectionDispositions` results in `'obj-new'` being closed before `evaluateConsensus` checks for open objections. Consensus then succeeds (`{ kind: 'unanimous' }`) even though peers and the judge never saw `'obj-new'`, violating `Spec 0391` (*"A new objection prevents consensus for that candidate"*).
- **Smallest correction:**
  - Require every item in `Ballot.newObjections` (and initial `review.objections`) to be validated with `status: 'open'`.
  - Restrict `Ballot.ownedObjectionDispositions` to objection IDs present in the round's immutable input objection snapshot (`ConfirmationContext.objectionLedger`).
  - Require `ballot.newObjections.length === 0` across all three ballots in `evaluateConsensus`, and state in `Task 2` that new objections from initial `review` payloads are merged into the objection ledger at the `reviewing -> prepare_candidate` barrier.

---

### `C-04` — Foreground controller inbox consumption during `prepare_candidate` and resume behavior after settled `needs_context` / `blocked` pauses are incomplete
- **Severity:** Important
- **Source locations:**
  - `docs/superpowers/specs/2026-10-23-the-council-design.md` (`Calling agent bridge`, lines `0091–0097`; `Global transitions and recovery targets`, lines `0480–0485`; `Durable input when the controller has exited`, lines `0488–0496`; `Limits and user intervention`, lines `0570–0581`)
  - `docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md` (`Task 7`, lines `0328`, `0335–0351`, `0367–0370`)
  - `docs/superpowers/diagrams/the-council.json` (`states`, lines `0252–0271`, `0518–0521`, `0533–0541`)
- **Failing scenario:**
  - **Scenario A (In-process `prepare_candidate` wait):** In `prepare_candidate`, after all permitted evidence requests complete, the foreground `council start` process emits the `candidate request` intent (`action_required: 'candidate'`, `Plan 0350`). The supervising skill polls `council inspect` and submits the synthesized candidate via `council respond` (`Plan 0336–0337, 0348`), which writes a file to the durable inbox without accessing SQLite (`Plan 0342`). However, `Plan 0338` and `0369` specify consuming the inbox only in `council resume` (which cannot acquire the single-writer lock while the foreground controller is running in `prepare_candidate`, where the active budget must stay running per `Spec 0581`). Without inbox polling in the live foreground controller loop during `prepare_candidate`, the controller waits until the 3-hour active budget expires.
  - **Scenario B (Overnight wait in `needs_context` or settled `blocked`, and mid-round `blocked` resume targets):** `the-council.json` (`0533–0541`) allows resuming from `needs_context` and settled `blocked` via `reconciling -> preflight`. However, `Plan 0328` and `0370` tie `settled-human-pause` budget closure to human question pauses; if `needs_context` or positively-settled `blocked` exits without closing the budget interval, a next-day `resume` treats the pause as an `active-process crash` and charges elapsed wall time. Additionally, `preflight` in `the-council.json` (`0252–0271`) has return edges only to `clarifying`, `publishing_answers`, `collecting_questions`, and `prepare_round`, leaving no transition if `blocked` was entered mid-round (e.g., an access/scope block in `prepare_candidate`, `judging`, or `confirming`).
- **Smallest correction:**
  - In `Task 7`, require the live foreground controller loop to poll/consume correlated `candidate` and `cancel` inbox requests while waiting in `prepare_candidate` (keeping the active monotonic budget interval open).
  - Close the active-budget interval (`settled-human-pause`) whenever the run enters any positively settled human-wait or remedy state (`needs_user`, `needs_context`, or positively-settled `blocked`, while keeping the budget `active` if the process exits in `reconciling` with unknown lifecycle), and specify whether resuming from a mid-round settled `blocked` state returns to the saved mid-round phase from `preflight` or routes to `prepare_round` only with an explicit round/call extension.

---

## Non-Blocking Notes and Unresolved Design Points

1. **Deterministic guard for unverified evidence at candidate freeze (`Spec 0371` vs `Plan 0128, 0201`):** `Spec 0371` states that *"Material missing evidence blocks candidate freeze unless the candidate states the uncertainty."* To keep the `prepare_candidate -> judging` guard pure (`Spec 0432`), `FrozenCandidate` (`Plan 0128`) should carry an explicit `acknowledgedUnverifiedEvidenceIds: string[]` field checked against any `EvidenceRecord` with `status: 'unverified' | 'invalid'`.
2. **Explanatory `clarification` diagram edge (`the-council.json` lines `0753–0761`):** In the explanatory `clarification` flowchart, node `ready` has an edge `ready -> deliberate` (`"no earlier blocking issue"`) but omits `ready -> limit` for the case where Wave 2 has zero new questions while a Batch 1 blocking question remains `unknown` or `declined` (the normative `states` diagram already covers this via `collecting_questions -> publishing_answers -> settling`).

---

## Remaining Qualification Limitations

- **No live transport or Ultra route is certified by this review:** Under `/Users/aaat/.agents/policies/model-policy.md` and `Spec 0668–0673, 0696–0698`, synthetic tests and supplied-text assessments do not qualify live Council orchestration.
- **Default `gpt-6-astra` (`ultra`) reviewer and judge seats remain gated:** `gpt-6-astra` at `ultra` requires explicit bounded user approval, exposed descendant controls, and Astra slot availability (`ASTRA_CALLER_CONFLICT` when called from an active Astra parent without explicit extra-slot approval; `UNQUALIFIED_ROUTE` until live route controls pass in Task 5).
- **Per-host, per-version transport qualification required before deployment:** Each configured route (`codex` and `antigravity`), model, effort, and Orca lifecycle control (`launch`, `observe`, `stop`, `release`) must pass Task 5's disposable read-only qualification on the local macOS host before Task 8 deployment approval.
