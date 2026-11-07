**Marker:** `council-audit-plan-opus55-medium-final-scope-20261031-129c`

**Scoped Spec: PASS.**
**Scoped Quality: Approved.**

I wrote no files. The /plan artifact step was skipped because you did not permit writes.

## Integration check (my own reading, not the coordinator's account)
- **The delta is exact.** I compared `approved-plan-v4.md` with the current plan line by line. The current plan has 466 lines and the approved one has 459. The only differences are the seven inserted lines, at `plan:98-100`, `plan:261` and `plan:327-329`. Nothing else changed.
- **Correction 1, contributor recheck.** It meets all four of your checks.
  - **Comparison:** `plan:327` compares the frozen packet's actual contributor families with the accepted Task 2c record. It sits after the freeze (`:326`) and before the fresh review (`:330`).
  - **Stop on mismatch:** `plan:328` stops adoption and reopens the route gate through material reassessment. That is consistent with `plan:57-59`.
  - **Holds retained:** `plan:329` keeps the adoption hold until every required route has current proof. The graph matches at `canonical:145`.
  - **Other author families:** `plan:261` requires a qualified Astra Ultra or Argon high reviewer from a different family. That covers Claude, Grok and Composer authors, and matches `model-policy.md:103,105-106`.
  - Mixed packets still work: `:257` records each contribution, `:260` keeps reciprocal review, and `:261` requires a reviewer from a different family.
- **Correction 2, block and stop reasons.** `plan:98-100` sits in the general partial-outcome section. It covers "any selected role or required gate" and applies "even when Task 5 cannot start". This closes the case where Task 2b fails (`:233,237`). It matches `canonical:35`.
- **Earlier restrictions are unchanged.**
  - Code models are still exactly Astra Ultra and Argon high (`plan:21,183,185`, `canonical:18,219`).
  - `plan:261` limits the new reviewer choice to those same two routes.
  - Opus still cannot be substituted (`:268`), and an Astra review of an OpenAI packet is still only supplemental (`:266`).
  - Authorization is still plan-only (`plan:15-16`, `canonical:21-22,58-62`).
  - The final gate still stays unaccepted for a partial outcome (`plan:423`, `canonical:34,181`), and an unreachable task is still not marked complete (`plan:96`).

## Critical
None.

## Important
None.

## Minor
1. **The graph's Task 2c completion check was not updated for the new author-family rule.**
   - `canonical:125` still names only the OpenAI→Argon high and Gemini→Astra Ultra cases.
   - The document's new step at `plan:261` adds the case for any other permitted author family. The graph check for Task 2c does not mention it.
   - Since the graph is canonical (`plan:39`), a Claude-authored packet has no graph-level completion criterion for this gate.
   - The adoption check (`canonical:145`) and the constraints (`canonical:35`) were updated correctly. This is a consistency defect in the plan, not a safety gap: `plan:261` and `:329` still govern.
   - **Fix:** add the "other permitted family → qualified Astra Ultra or Argon high from a different family" clause to the `verify-effect-review-route` completion check.

## Declined judgments
- **Task 5 wording:** `plan:424` sets `block_reason` to "unresolved selected roles", which is narrower than the general rule at `:98`. I do not count this as a conflict. Task 5 depends on the accepted gates 2b and 2c, so only role blockers can remain by then.
- **Timing:** I make no ruling on whether `:98` (record when progress blocks) and `:424` (record after eligible work finishes) need to be reconciled. Adaptive Planning service behaviour was out of scope.
- **Not verified:** the document `version` hashes in the graph, and any runtime behaviour, route qualification or Orca/Adaptive Planning mechanics. That is correct for a planning-only artifact.
- **Unchanged self-review section:** `plan:445-461` does not mention the v4 or v5 reviews. The graph facts record them (`canonical:49`), so I did not raise this.
- **Language:** I make no ASD-STE100 or dictionary conformance claim. No engineering conformance is established by this review.
- **Out of scope:** I did not re-examine findings that were already resolved, and this is not a fresh whole-plan review.

This verdict does not decide acceptance. The coordinator must verify these claims.
