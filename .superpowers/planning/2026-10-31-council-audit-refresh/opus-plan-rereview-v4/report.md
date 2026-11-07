council-audit-plan-opus55-medium-v4-20261031-bef3

**Spec: PASS.** Spec outcomes 1–8, the partial-outcome rules and the new adoption conditions (`spec:42-72`) all map to plan Tasks 1–5. Scope stays plan-only (`plan:15-16`, `canonical-plan-v4.json:21-22,56-62`). Cursor and full Council qualification stay in the roadmap (`plan:427-436`).

**Quality: Approved.** Two minor items remain (listed below). I wrote no files. The /plan artifact step was skipped because writes were not permitted.

## Graph and document comparison
- **All seven step IDs, titles and dependencies match.**
  - Titles: `canonical:67,83,101,119,137,157,175` match `plan:99,156,208,239,268,347,387`.
  - Dependencies: `adopt-audits` depends on `resolve-audit-gaps`, `verify-native-provenance` and `verify-effect-review-route` (`canonical:138-142`).
  - Only `accept-audit-refresh` has `final_gate:true`.
- **The fixes from the first re-review hold.** I checked each against source, not the disposition text.
  - **I1, complete effect set:** handled at `plan:315,319-321` and `canonical:32,143`. The source confirms the need: `control-audit.ts:75` accepts a subset of effects, `:98-99` needs all of them to verify, and `:84-85` makes adoption write-once.
  - **I2, author-based reviewer:** handled at `plan:254-264,323-324`. The author-family rule and the Astra-is-supplemental rule match `model-policy.md:96,110`. The new route gate covers the missing qualification branch.
  - **I3, gate dependencies:** the graph edges are present. No-gap retirement keeps the 2b and 2c edges (`plan:191-194`, `canonical:87`), and role branches keep them (`plan:131,231`). Task 3 checks both at `plan:316`.
- **The six earlier Minor findings are resolved.**
  - Drift is bounded, including drift during review (`plan:84-88`).
  - The build runs before RED and before GREEN (`plan:178,183-184`).
  - Native records are read back through public interfaces, and fact checks are left to Task 4 (`plan:332-335`).
  - Task 4 checks the exact `controlFacts` names and `observation.state` (`plan:367-369`). This matches `source-evidence.json:90-97,168-175,366-373`.
  - The deadline is 15 minutes and at most 30 minutes ahead (`plan:363-364`), within `workflow.ts:73-74`.
  - A partial outcome leaves the final gate unaccepted (`plan:416-418`), and the titles now match.
- **The earlier v2 conditions are still in place.** I1–I8 are kept at `plan:65-68,117-122`, `70-88`, `322-327`, `208-237`, `333-334,414`, `90-97`, `123,371` and `408-411`. M1–M4 are kept at `plan:292-294`, `202-203`, `106` and `149-152`.
- **The blocker mapping is consistent with source.** The classifier runs only on `"bootstrap"` facts (`workflow.ts:85`). So effective-stage unknowns should not add `CONTROLS_UNKNOWN` once an audit verifies, and `plan:378-383` is consistent with that.

## Critical
None.

## Important
None.

## Minor
1. **Task 2c fixes the reviewer before the packet and its authors exist.**
   - Task 2c depends only on `prepare-audits` (`canonical:120-122`), yet it must "record the actual family of each consequential packet contribution" (`plan:254`).
   - The packet is frozen later, in Task 3 (`plan:322`). Task 3 checks the gate (`plan:316`) and reuses the 2c selection (`plan:324`). Nothing reopens 2c if the frozen packet's authorship differs.
   - **Scenario:** 2c records an OpenAI coordinator as the author and qualifies only an Argon route. An Argon-authored repair diagnosis from Task 2 then supplies consequential effect rationale to the packet. Reciprocal Astra review is now needed (`plan:257`), but no Astra route was qualified. The packet would be reviewed by Argon alone.
   - 2c also names no reviewer for a Claude-authored packet, so a Claude coordinator would have no selection rule.
   - **Fix:** Add a Task 3 step to compare the frozen packet's actual contributor families with the 2c record. Reopen 2c through reassessment on mismatch, and add the Claude-author case.
   - This is a planning defect. It is not a runtime gate.
2. **The plan-level `block_reason` and `stop_reason` are set only inside Task 5.**
   - They appear only at `plan:416-418`. The general partial rules (`plan:90-97`) do not say who records them when Task 5 cannot start.
   - **Scenario:** Task 2b finds that native self-dispatch fails (`plan:230,234`). Tasks 3, 4 and 5 become unreachable and must not be marked complete (`plan:96`). The graph then keeps `block_reason:null` and `stop_reason:null` (`canonical:229-230`) with no instruction to record "native provenance gate unaccepted: <gap>".
   - **Fix:** Move the block and stop recording into the general partial-outcome section, so it applies to any unaccepted gate.
   - The failed 2b gate is an explicit unresolved runtime gate, which is correct. The missing step to record it is a planning defect.

## Declined judgments
- **Ten-task horizon:** I did not rule on whether role-specific splits plus expanded qualification tasks (`plan:93-94,197,225,259`) can stay within ten upcoming tasks. That depends on Task 1 results.
- **Not verified, out of scope:**
  - The graph's document `version` hashes.
  - The installed Orca flags and real self-dispatch behaviour.
  - The helper's actual 15-minute deadline (`run-os-question-fresh.py` was not read).
  - The exact `evidence.routes[]` path in `outcome.json`.
  - Whether the `classify` stage filtering in `preflight.ts` is exhaustive.
- **Unresolved runtime gates, correctly so:** native provenance (2b), the effect review route (2c), code-route qualification, and whether any effect should be approved. None of these is a planning defect.
- **Language:** I make no ASD-STE100 conformance claim. The Issue 9-oriented candidate label is suitably limited.

This verdict does not decide acceptance. The coordinator must verify these claims.
