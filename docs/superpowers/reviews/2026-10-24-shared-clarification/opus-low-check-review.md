# Independent review report: The Council design, implementation plan and diagrams

## Verdict

**PROCEED_WITH_CHANGES**

The design and the plan can be built. Most requirements match across the spec, the plan and the canonical diagram. This includes:

- two clarification batches counted separately from three deliberation rounds;
- six plus 21 calls, for a bound of 27;
- no model calls to repair output format;
- a frozen `council.yaml` roster;
- three equal reviewers and a fresh judge with no vote;
- an evidence barrier before synthesis;
- new ballot objections that block consensus;
- a durable inbox for `respond`;
- budget pauses only after every owned resource settles.

I found two medium defects and three minor ones. None needs a redesign. Each fix is a small text change in the spec, plan or diagram.

The supplied diagram source was cut off after line 0786, inside the `clarification` flowchart. I could not review the rest of that view.

## Material findings

### F1 — Medium: Resuming from a settled pause has no valid diagram edge

- **Where:** `the-council.json` lines 0443–0446 (`reconciling → preflight`) and 0492–0496 (`reconciling → settling`). Spec lines 0486–0494. Plan Task 7 Step 6 (line 0372).
- **Failing scenario:** The run settles in `needs_user` with no live resources. The user finalizes answers. `resume` goes from `needs_user` to `reconciling` (lines 0527–0531). Reconciliation finds nothing live. The edge to `preflight` requires "positive live ownership", so its guard fails. The only other exit is "exit established; saved result or failed attempt accounted", which leads to `settling`. That edge either fits badly or sends the run back into a settled outcome. Spec line 0494 says resume passes through reconciliation and preflight, but no canonical guard covers the case with no live resources. Plan Task 2 Step 1 requires tests for every diagram edge, so a faithful build fails this path, or the builder invents an edge.
- **Smallest fix:** Add a guard to `reconciling → preflight` for the case where no resources are live, every owned resource is positively settled, and a saved resume target exists. Keep the live-reconnect case as its own guarded edge to the saved active phase. State that the two guards are mutually exclusive.

### F2 — Medium: Consensus ignores unresolved blocking questions in the shared ledger

- **Where:** Spec line 0311, lines 0417–0426 (the exact consensus rule) and line 0299. Plan Task 1 Step 5 (line 0178) and Task 2 Step 6 (line 0203).
- **Failing scenario:** In round 2, a review raises a blocking question. A later answer in the same chain makes it depend on another question, so it stays **deferred**. Round 3 reviewers raise no new questions. All three ballots accept with no objections. The consensus rule checks only each accepting ballot's own blocking questions. It does not check unresolved blocking items in the ledger. The clarification-side check (line 0299) only gates entry to deliberation. So the run records unanimity while the shared ledger still holds an unresolved blocking question. Before deliberation, the same state would return `CLARIFICATION_LIMIT`.
- **Smallest fix:** Add one consensus condition: "No unresolved blocking question (presented or deferred) remains in the shared ledger view bound to the context hash." Make `evaluateConsensus` check it and add a Task 1 test. Also state that deliberation-origin batches promote eligible deferred questions, as spec line 0271 already does for clarification.

### F3 — Minor: Rules for non-blocking or source-answerable questions during deliberation are unclear

- **Where:** Spec line 0311 ("material missing-input issue … routes to `collecting_questions`"). Diagram lines 0543–0551.
- **Failing scenario:** A review in round 1 contains only a **non-blocking** `missingInputQuestions` entry, or one that authorized sources can answer. The text routes every case to `collecting_questions`, which consumes round 1 and forces round 2. That costs seven calls for no blocking reason. Builders could choose to continue to `prepare_candidate` or to abort, and the two choices give different call counts and outcomes. Neither breaks the 27-call bound.
- **Smallest fix:** State the routing rule. Option A: only blocking items divert the round, and non-blocking ones are carried into the candidate as explicit uncertainty. Option B: every item diverts the round. Then add one Task 2 test for the chosen rule.

### F4 — Minor: Duplicate canonical edge

- **Where:** `the-council.json` lines 0296–0300 and 0372–0376. Both are `publishing_answers → settling` with the same label.
- **Failing scenario:** Plan Task 2 Step 1 ("every state and edge") and Task 8 Step 7 (diagram reconciliation) may count edges or need unique edges. A duplicate gives a mismatched count, or the builder silently drops it.
- **Smallest fix:** Remove one entry.

### F5 — Minor: The all-ready skip after wave one is not named in the `publishing_answers → prepare_round` guard

- **Where:** Diagram line 0295 ("final clarification or deliberation continuation"). Spec line 0295.
- **Failing scenario:** Wave one is all-ready, with no questions and no earlier unresolved items. The run goes `collecting_questions → publishing_answers` (line 0280). The `prepare_round` guard text names only "final clarification" or "continuation", but wave one is not final. A literal guard sends the run nowhere, because the `clarifying` edge requires that "wave one had questions".
- **Smallest fix:** Add "OR all-ready wave with no unresolved blocking ledger item" to that guard label and to the Task 2 Step 5 test list.

## Checked with no material defect

- **Counting:** reservation happens with the first launch intent. An uncertain start still counts. Invalid results permanently end inference for the run. A late question still consumes its round. Extensions are explicit. The bound of 27 is consistent.
- **Two batches:** wave two runs whenever wave one had any question, including questions answered from sources. There is no third readiness wave. A deferred blocking question at the limit gives `CLARIFICATION_LIMIT`. `AnswerRevision` binds to the current context hash, and stale batch answers are rejected. Partial replies stay as drafts and start no worker.
- **Equal information:** there is one shared ledger, no private side answers, stable seat order at barriers, and launch-packet bindings checked by the adapter.
- **Evidence before synthesis:** the candidate request is gated on pending evidence. The pure guard checks only ID coverage, and the judge does the semantic check. This split is sound.
- **New ballot objections:** they must start open, cannot be closed in the same ballot, and any nonempty array blocks consensus. Only the owner can dispose of them.
- **Phase settlement and judge:** all reviewers settle before the judge, and the judge settles before ballots. The judge is fresh each round and has no acceptance field.
- **Durable `respond`:** the atomic inbox does not write SQLite. Applying a request and recording it as consumed is one transaction. A successor owner needs positive evidence. Polling waits at most 1,000 ms.
- **Determinism:** guards are pure. Clocks and IDs are recorded inputs. No launch is triggered by state entry alone. The spec does not claim that model reasoning is deterministic.
- **Clock and recovery:** monotonic time is used within a process. A wall-clock regression blocks work. Crash downtime is charged. The watchdog has stop-only authority and is reconciled by key.
- **Policy approvals:** current policy is rechecked on resume. Bounded authorization receipts are reused. An Astra caller conflict blocks rather than switching models silently.
- **Model defaults:** the defaults are preserved, and the plan avoids a fixed allowlist.

## Unresolved design points (for the coordinator)

1. Which routing rule F3 should use.
2. Whether an `INVALID_WORKER_RESULT` run in `blocked` counts as a "user remedy" pause for budget purposes. It cannot be remedied inside that run, so the active interval should probably close as a terminal settled outcome. State this explicitly.
3. How long a run stays blocked when the prior controller's exit can never be positively proved, for example after a host reboot that leaves no receipts. The plan accepts permanent blocking. It should name the manual remedy in the runbook.

## Qualification limits (not defects)

- The default Astra Ultra roster needs a separately verified Ultra route with control over descendants, plus explicit approval under the current policy. A default Astra caller conflicts unless extra-slot approval exists. Both are documented gates.
- No AGY or Orca transport is qualified for full Council lifecycle control. The earlier Argon assessment exited nonzero.
- I did not verify the dependency versions pinned on 2026-10-23 (TypeScript 7.0.2, Vitest 5.0.5, XState 5.33.3 and others).
- Finishing all 27 calls within three active hours is explicitly not promised, and I do not treat that as a defect.
- I ran no tests and certify no live transport. This review covers only the numbered source supplied, and the diagram source was cut off after line 0786.
