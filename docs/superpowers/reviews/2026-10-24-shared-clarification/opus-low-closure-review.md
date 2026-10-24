COUNCIL-CLOSURE-d0cf7940c1e64da98cac305703ae0d3f | diagrams=4 | controlStates=17

# Verdict: PROCEED_WITH_CHANGES for this closure scope

I reviewed only the source in the packet. I used no tools, ran no tests, and did not check the omitted sections or live transports. Two defects block READY: one is a deadlock and one is an ambiguous guard. Both have small fixes. The other closure cases check out.

## Defect 1: no exit from `publishing_answers` when an all-ready wave still has an earlier blocker (cases 2 and 6)

**Edges:** the `states` diagram has three exits from `publishing_answers`: to `clarifying`, to `prepare_round`, and to `settling`. Spec 0299/0301 and plan Task 7 Step 4 also apply ("All-ready waves can skip remaining allowance only without earlier blocking items").

**Counterexample:** an authorized extension sets `effective.maxClarificationBatches = 3`.
1. Wave 1 asks a blocking question, and the user answers `unknown`. The answer publishes.
2. Wave 2 returns all-ready. The run goes `clarifying → collecting_questions → publishing_answers` with no human answers. Now `used = 2 < 3`.
3. No exit guard passes:
   - **To `clarifying`:** needs "current wave had questions". This wave had none, and the spec says "There is no third readiness wave."
   - **To `prepare_round`:** needs "no unresolved blocking ledger item". One remains.
   - **To `settling`:** needs "unresolved blocking ledger item **after final clarification**, deliberation, or answer revision". Wave 2 is not the final allowed batch, so this fails.

The run stalls in `publishing_answers`. That is a stable checkpoint with no way out except cancel or failure, which breaks spec 0307 ("It cannot deadlock in publication"). A deferred blocking question whose dependency was answered `unknown` causes the same stall.

**Smallest fix:** in the `publishing_answers → settling` guard, change "after final clarification" to "after final clarification **or an all-ready clarification wave**". Then add one test to plan Task 2 Step 5: an extended allowance of 3, wave 2 all-ready, and an earlier unresolved blocker. The expected result is settled `needs_user` with `CLARIFICATION_LIMIT`.

**Related wording problem:** the `publishing_answers → prepare_round` label has no parentheses ("no unresolved blocking ledger item + roundsUsed < effective.maxRounds; all-ready wave OR final clarification OR …"). A reader could group it as `(A ∧ B ∧ allReady) ∨ final ∨ …`. That would let a final clarification or an answer revision skip the full-ledger check and the round limit. Rewrite it as `(no unresolved blocking item) ∧ (roundsUsed < effective.maxRounds) ∧ (allReady ∨ finalClarification ∨ deliberationContinuation ∨ answerRevisionTarget)`. The `settling` edge is already parenthesized correctly. The `preflight → prepare_round` and `ADMIT_ROUND` rechecks (Task 2 Step 6) give a second defense, but the diagram is declared normative and should not rely on that.

## Defect 2: a pending `ContextUpdate` does not reliably win at settled barriers (case 3)

**Edges:**
- `confirming → evaluate_round` and `confirming → collecting_questions`
- `reviewing → prepare_candidate` and `reviewing → collecting_questions`
- `judging → confirming`
- `evaluate_round → prepare_round` and `evaluate_round → settling` (both on `EVALUATE_ROUND`)
- each of these phases `→ preflight` labelled "accepted pending ContextUpdate"

**Counterexample:** a `ContextUpdate` is accepted as pending while ballots are running. All three ballots then settle as accept.
- The `confirming → evaluate_round` guard ("three valid responses/resources settled") is also true, and it does not exclude a pending update.
- In XState the first passing guard in listed order wins. The `→ preflight` edges are listed last in the canonical JSON.
- So the run reaches `evaluate_round`. The `EVALUATE_ROUND` guard "unanimous" then fires to `settling` with outcome `completed`. Old ballots have accepted against a context that the user already changed.

The same overlap exists in `evaluate_round` itself. Its `EVALUATE_ROUND` edges do not exclude a pending update, so priority depends on whether the controller applies the update or the evaluation event first. The spec states the priority (0629) and plan Task 7 Step 4 restates it, but no guard enforces it.

**Smallest fix:** add `pendingContextUpdate = null` to every normal-advance and question-diversion guard leaving `reviewing`, `prepare_candidate`, `judging`, `confirming`, and `evaluate_round`. Also state that at a barrier the controller applies a consumed update before creating the `EVALUATE_ROUND` event. Then add a Task 2 test: a pending update plus three accept ballots must go to `preflight`, never to `completed`.

The rest of case 3 holds:
- The barrier commits objections, dispositions and staged questions before going to `preflight`.
- `preflight → settling` (round limit) keeps the round-three update for the unresolved report.
- An update stays queued while a question batch is open, and stale base hashes are rejected.

## Closure cases with no defect found

1. **Explicit `EVALUATE_ROUND`:** `evaluate_round` and `prepare_round` are stable checkpoints. The event ID comes from the intent key, recovery checks for an accepted event before creating a new one (Task 7 Step 3), and each accepted event carries a trusted clock receipt. `ADMIT_ROUND` drives `prepare_round`. Correct.
2. **Publication guards, apart from Defect 1:** an extension that adds only time cannot add rounds or skip questions; call capacity is derived from the effective counters (plan 0126). There is no hardcoded wave-one guard, so an extended third clarification wave is admitted after a nonempty second wave. Correct.
4. **Reconciliation:** restore records `reconcileOriginState` and keeps a non-null origin on repeated restore; a missing origin blocks (spec 0497, plan Task 2). The edge back to `preflight` and the active-phase return edges use separate origin guards and do not overlap. Every resume needs a current preflight attestation before launching (spec 0505, Task 7 Steps 3 and 6). Correct.
   - Minor: the diagram's `reconciling → preflight` label leaves out the "saved target" condition from spec 0499. Add it to the label.
5. **Launch fence:** the run commits `LAUNCH_DISPATCHED` and its outbox fence before calling `transport.launch`, so a `pending_execution` entry is provably unsent. A `dispatched` entry without a receipt stays uncertain. `LaunchReservation` holds no transport IDs, and the registry binding stays `null` until the real receipt (plan 0131). Correct.
6. **Wire format and binding:** raw records forbid provenance, owner and disposition fields. Binding checks the phase/kind mapping and requires matching vote hashes. Namespacing includes the seat, so two seats can both emit `q1`. The compiler, not the worker, derives disposition. Predecessor rules match: `null` for a first deferred answer, the current ID for a replacement, and dependencies already answered in the published ledger (spec 0303, plan 0124). Correct.
7. **`respond` and watchdogs:** `respond` uses read-only `openRunReader` without the writer lease; its pre-enqueue check is advisory and the consuming transaction decides. Watchdogs have no model, are owned resources that must settle, and use no model slot (spec 0619–0621). Correct.

The user invariants hold in the supplied sections, and the default model strings are unchanged in plan 0015–0016.
