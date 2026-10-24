COUNCIL-END-5da76df289524f838ea5e2e1466c3077 | diagrams=4 | controlStates=17

# Verdict: PROCEED_WITH_CHANGES

I received all four sources in full and found no truncation: the spec runs to line 0730, the plan to line 0440, the diagram JSON closes, and the README runs to line 0043. I used no tools, ran no tests, read no other files, and did not check any live transport. I did not create the `/plan` artifact because the brief forbids writes; I treated that command as superseded by the review constraints.

The design and plan can be implemented and are mostly consistent. Counting, the 27-call bound, equal information, the evidence barrier, ballot objections, durable `respond`, and recovery are all specified precisely enough to test. The findings below are wording and guard-precision defects. None blocks planning, but fix F1 and F2 before Task 2 starts, because they set the reducer's guard semantics.

## Findings

**F1 — Medium — `publishing_answers → settling` guard label is ambiguous and seems to contradict the spec** (`the-council.json`, states transition `publishing_answers→settling`, label "unresolved blocker after final clarification OR any deliberation/revision publication; OR deliberation allowance exhausted"; spec 0305, 0321).
- **Scenario:** Round 1 diverts on a late question. The user answers it fully, and rounds remain. The spec (0321) routes this to `prepare_round`, and the `prepare_round` edge allows "deliberation continuation". But one reading of the settling label is "unresolved blocker after final clarification" OR "any deliberation/revision publication". Under that reading, every deliberation publication matches both edges, so the guards stop being mutually exclusive, which the states description requires. An implementer could send every resolved deliberation answer to `needs_user` and lose the remaining rounds.
- **Correction:** Rewrite the label as "(unresolved blocking ledger item after final clarification, deliberation, or revision publication) OR roundsUsed ≥ effective maxRounds". Add a Task 2 test where a fully resolved deliberation-origin batch reaches `prepare_round`.

**F2 — Low/Medium — `evaluate_round` (and `prepare_round`) transition kind is not specified** (plan Task 2 Step 1, lines 0196–0198; diagram `confirming→evaluate_round→settling`; `reconciling→evaluate_round`).
- **Scenario:** The test expects one `ballotsReady` event to land in `settling` with `pendingOutcome` set. That only works if `evaluate_round` is an eventless (`always`) transient state. If the builder models it as an event-waiting state, either the test fails or a hidden synthetic event appears. That event would break the "ordered event history" replay contract (spec 0447). The same doubt applies to `reconciling → evaluate_round` as a saved target: no committed snapshot should rest in a transient state.
- **Correction:** State in the spec's states table and in plan Task 2 Step 3 that `evaluate_round` is transient (eventless guards only). Say that checkpoints never persist it. Make the recovery target for it `confirming`, with its saved ballots. Or, if you keep `evaluate_round` as a target, define the event that drives it.

**F3 — Low — Diagram label for `publishing_answers → clarifying` omits the source-answered-only case** (diagram; spec 0295; plan Task 7 Step 4 "A wave containing source-answered questions still admits wave two").
- **Scenario:** Wave one returns only source-answerable questions. The flow goes `collecting_questions → publishing_answers` with no human pause. The label "wave one had questions" covers this, but the clarification flowchart routes only through "answers / one user batch". This is consistent but easy to misread.
- **Correction:** In the clarification flowchart, add an edge "source answers only → publish" (barrier → publish).

**F4 — Low — `respond` correlation validation needs a defined read path** (spec 0507–0509; plan Task 7 Step 5, "verify size/schema/correlation before enqueue"; "does not mutate SQLite").
- **Scenario:** Checking the batch ID and base context hash before enqueue means reading run state while a live controller may be writing. The plan does not say whether `respond` opens SQLite read-only or reads a published artifact. A builder might take a writer lock, which would conflict with the single-writer lease.
- **Correction:** State that `respond` opens the store read-only and treats its validation as advisory. The consuming controller does the authoritative revalidation inside its transaction (stale requests are rejected there).

**F5 — Low — Watchdog processes and the four-workstream limit** (spec 0199, 0611–0613; plan Global Constraint line 0027).
- **Scenario:** Three reviewers, three watchdogs, and the caller make seven processes. A strict reader of "visible workstreams" might block the launch.
- **Correction:** State explicitly that stop-only, model-free watchdogs are owned resources, not workstreams. They still count toward settlement.

## Regression cases checked against the source

- **Settled resume reaches `preflight`:** Yes, via the `reconciling→preflight` label and spec 0493.
- **Consensus checks the whole bound ledger:** Yes (spec 0429, plan 0180, `ConfirmationContext.questionLedger`).
- **Every nonempty late `missingInputQuestions` diverts, including nonblocking ones:** Yes (spec 0315, plan Task 2 Step 6, diagram diversion edges).
- **All-ready wave one skips the rest of clarification:** Yes (spec 0295; the publish→`prepare_round` "all-ready wave" guard).
- **`AnswerRevision` after batch two is exhausted:** Yes, through `preflight→publishing_answers` and then `prepare_round` with no extra wave (spec 0301–0307; plan Task 7 Step 8). It depends on F1 being fixed so the guard is exclusive.
- **New objections cannot be closed in the same ballot:** Yes (spec 0419; plan 0180).
- **Invalid result closes the budget terminally:** Yes (spec 0541; plan Task 5 Step 7).
- **No exact duplicate transitions:** Correct. `publishing_answers→settling` and `evaluate_round→settling` each appear twice, but with different labels and guards. They are not exact duplicates. Consider merging each pair into one guarded edge for readability.

## Areas checked without a material defect

- **Call counting:** `3·2 + 7·3 = 27`. Reservations happen at the first launch intent, uncertain starts are conservative, there is no format-repair call, and invalid outputs never reuse a slot.
- **Equal information:** One common batch after the phase barrier. One explicit answer per original question ID. An append-only ledger. A new `contextHash` per publication with launch-packet binding checks. No private answers.
- **Evidence before synthesis:** The `prepare_candidate` self-loop. The required-evidence set is frozen before candidate submission and covered by an ID-level guard.
- **Determinism:** Pure guards, clock receipts as recorded events, and budget changes only through reducer transitions. The source honestly says model judgment stays nondeterministic.
- **Clock, owner, and recovery:**
  - The pause starts only after positive settlement.
  - Crash downtime is charged.
  - Clock regression blocks work.
  - A new owner needs positive evidence that the prior owner exited, and there is no force-unlock.
  - Watchdog replay is idempotent.
- **Model defaults:** Preserved exactly in the YAML, the table, the plan constraints, and the tests. The frozen roster is enforced on resume, and current policy is rechecked.
- **Current-policy approvals:** A reusable bounded authorization receipt, with no repeated interviews (plan Task 4 Step 9).

## Unresolved design points (not defects)

- With the default Astra roster, a run started from an Astra caller always needs explicit extra-slot authorization. This is documented, and it is a real operational constraint.
- A nonblocking late question at round 3 consumes the last round and ends in `needs_user`. This is a documented coordinator choice. The user should confirm it is acceptable.
- Version one has no replacement inference after one invalid or empty output. That makes a run fragile against transient provider faults. It is documented, and the remedy is a new run.

## Remaining qualification limitations

None of the following is established by these documents, and I verified none of it:
- Live Codex or AGY routes, `ultra` effort availability, and control over descendants.
- Orca Run/Task/Dispatch authority and real settlement behaviour.
- AGY 1.4.7 mode and slash-command interaction.
- That the pinned dependency versions behave as described.

These remain qualification gates under plan Task 5 Step 9 and Task 8 Step 9.
