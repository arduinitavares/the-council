I'll start with the required policy read, then the marker and review inputs.
Now the rest of the policy, the revised plan, spec, language note, and canonical graph.
Now the source files to verify the changes.
council-audit-plan-rereview-opus55-medium-20261031-8b62

**Spec: PASS.** The plan still covers spec outcomes 1–8 and the partial-outcome rules (`spec:44-68`). The authorization remains plan-only (`canonical-plan-v3.json:51-58`, `plan:15-16`). Cursor and full Council qualification stay in the later roadmap (`plan:355-364`).

**Quality: Changes requested.**

I wrote no files and created no artifact, as the read-only scope requires.

## Integration of the original findings
I checked these against current source. I did not take the dispositions on assertion.
- **Built producer (I1):** handled at `plan:65-68,112-117,172-174`. The launcher runs `dist/pilot/cli.js` (`run-council.mjs:10`) and the tests import `dist` (`control-audit.test.ts:4-5`).
- **Drift recovery (I2):** handled at `plan:70-83`.
- **Review before adoption (I3):** handled at `plan:259-264`.
- **Native provenance gate (I4):** handled at `plan:198-205,240`.
- **Retained records (I5):** handled at `plan:271-272,345`.
- **Partial branches (I6):** handled at `plan:85-92,311-314,351-353` and `canonical:178`.
- **Complete blocker set (I7):** handled at `plan:118` and `source-evidence.json:39-228`. `workflow.ts:81-90` collects inspector and classifier blockers before it returns, so the disposition claim holds.
- **Invalidation after fixes (I8):** handled at `plan:339-342`.
- **Minor 1–4:** handled at `plan:232-234,194-195,101,143-146`.
- **AGY example:** the rejection is correct. The judge uses Codex (`source-evidence.json:185-190`).

The new problems below come from how these fixes interact.

## Critical
None.

## Important

1. **Approving only some effects uses up the hash for good.**
   - `plan:256-258` says to "Stop only an effect that requires missing authority", and `plan:231` says to use the reviewed effect IDs. Together they allow adoption of a partial `approvedEffects` set.
   - The schema accepts a subset (`control-audit.ts:46,75`). Verification needs every effect (`:98-99`). Adoption is write-once for each hash, and a different reference fails (`:84-85`). `plan:280` forbids deleting the disposition or forcing a new hash.
   - **Scenario:** The `openai` snapshot has the effects `codex-platform-runtime-reads-and-state` and `startup-hook:X`. The coordinator stops `startup-hook:X` and adopts the other effect.
     - The fact stays `unknown`.
     - Authority is granted later. Re-preparing with unchanged inputs gives the same hash (it is deterministic, `provider-controls.ts:277-280`).
     - The new adoption fails with `AUDIT_DISPOSITION_ALREADY_OWNED`. The role stays blocked until some unrelated input changes.
   - **Fix:** In Task 3, adopt only when the approved set equals `requiredDispositions` and `unavailable` is empty. Otherwise, record the role as blocked and do not adopt.

2. **The reviewer choice before adoption can break the cross-family rule.**
   - `plan:260-261` asks for a cross-family review of the decision packet, then says to "Use Astra Ultra or Argon high".
   - The coordinator writes that packet (`plan:259`). If the coordinator is OpenAI (Codex/Sol), an Astra review is same-family and only supplemental (`model-policy.md:110`).
   - `plan:194-196` applies the author-family rule to code changes only, not to this packet.
   - `plan:189` creates a route-qualification task only "before code assignment". The Task 3 review route has no qualification path.
   - **Scenario:** A Sol coordinator gets an Astra Ultra review and records it as the gate. The effects are then adopted write-once without the independent cross-family check that I3 was meant to add.
   - **Fix:** Name the packet author's family and pick the reviewer from it. Add a qualification branch for the review route.

3. **On the no-gap path, the native provenance qualification is not a dependency in the graph.**
   - Task 1 publishes a provisional qualification task when proof is missing (`plan:124-125`).
   - The plan calls the graph canonical (`plan:39`). In it, `adopt-audits` depends only on `resolve-audit-gaps` (`canonical-plan-v3.json:97-99`).
   - The retire path rewires Task 3 to Task 1 only (`plan:184-185`). The Task 3 checklist (`plan:254-267`) has no step that checks the qualification result. Only prose blocks it (`plan:204,240`).
   - **Scenario:** Task 1 finds no audit gap and no native qualification. Task 2 is retired and Task 3 depends on `prepare-audits` alone. Task 3 becomes ready while the qualification task is still pending. A worker who follows the graph and checklist could create real native records and adopt before self-dispatch is proven.
   - **Fix:** On every path, add the qualification node as an explicit dependency of `adopt-audits`, and add a Task 3 checklist step that checks it.

## Minor
- **The drift loop has no bound, and the required review can cause the drift.**
  - The review before adoption is itself an owned provider launch inside the adoption window (`plan:72-73,260-264`).
  - Codex snapshots fingerprint `~/.codex/rules` folder metadata, including `mtimeMs` (`provider-controls.ts:214`, `control-audit.ts:15`).
  - "If inputs continue to change" (`plan:82`) sets no retry count.
  - Choose a review route that does not share mutable sources with the audited role, where possible. Set a retry limit.
- **The test order can give a stale GREEN result.** `plan:176` runs the changed tests before `plan:177` builds. Tests that import `dist` then run against old output. Rebuild before GREEN.
- **No mechanism is named for the Task 3 verification step.** `plan:269-270` says to "Reinspect each provider through the authenticated command reader". The public CLI has only `prepare` and `adopt` (`cli.ts:37-50`). Name the mechanism, or move this check to Task 4.
- **Two Task 4 checks need more detail.**
  - The saved run reported the pending audit as `controls/CONTROLS_UNKNOWN` (`source-evidence.json:77-83,119-125,221-227`). "No stale audit blocker" (`plan:303`) needs that mapping stated.
  - The deadline must be at most 30 minutes ahead (`workflow.ts:73-74`). `plan:300` says only "future deadline".
- **The plan does not say what state the graph ends in for a partial outcome.**
  - `accept-audit-refresh` is `final_gate:true` (`canonical:146`). The plan does not say whether to accept that step or set `stop_reason`/`block_reason` (`canonical:185-186`) for a partial result.
  - Accepting the final gate could make the dashboard show the plan as complete while the objective is still open (`plan:352-353`).
- **Two task titles differ between document and graph.** Task 3 is "Review and adopt justified dispositions" in the plan (`plan:209`) and "Adopt justified audit dispositions" in the graph (`canonical:96`). Task 5 differs too (`plan:318` vs `canonical:132`).

## Declined judgments
- I did not check the document `version` hashes in the graph, because commands were out of scope.
- I did not check the installed Orca flags (`--return-preamble`, `--dispatch-capability`) or how real self-dispatch behaves.
- I did not read `preflight.ts` (`classify`) or `run-os-question-fresh.py`. The blocker mapping above relies on the saved evidence.
- I did not rule on whether Codex or AGY launches actually write the tracked files, or whether `dist` is under version control.
- I did not judge whether any particular effect should be approved. I did not check the qualification receipts.
- I do not claim ASD-STE100 conformance. The plan's Issue 9 candidate label is appropriately limited.
