# Two local corrections after the approved whole-plan review

Opus v4 returned Spec PASS and Quality Approved with two Minor findings.
The whole-plan review report remains unchanged.
The coordinator verified both remaining gaps.
This delta adds only the requested contributor recheck and general blocker recording.
It also covers another permitted packet author family without changing code model restrictions.
No task, source code, runtime permission, audit approval, or authorization changed.

```diff
--- approved-plan-v4.md
+++ docs/superpowers/plans/2026-10-31-council-audit-refresh.md
@@ -95,6 +95,9 @@
 Revise downstream completion checks before assignment.
 Do not mark an unreachable task complete.
 The overall objective remains incomplete if any selected role remains blocked.
+The coordinator records `block_reason` when any selected role or required gate blocks progress.
+The coordinator records `stop_reason` when no authorized eligible work remains.
+These rules apply even when Task 5 cannot start.
 
 ### Task 1: Prepare the current audit reports
 
@@ -255,6 +258,7 @@
 - [ ] Select Argon high for an OpenAI-authored packet.
 - [ ] Select Astra Ultra for a Gemini-authored packet.
 - [ ] Require reciprocal cross-family review for consequential contributions from both families.
+- [ ] For another permitted author family, select a qualified Astra Ultra or Argon high reviewer from a different family.
 - [ ] Verify the exact host, model, effort, transport, actions, permissions, and stopped lifecycle proof.
 - [ ] If required proof is missing, publish a concrete disposable qualification task before launch.
 - [ ] Keep Task 3 dependent on the accepted route gate.
@@ -320,6 +324,9 @@
 - [ ] Verify set equality between proposed `approvedEffects` and `requiredDispositions`.
 - [ ] Adopt no disposition for that hash when any required effect remains unapproved.
 - [ ] Freeze a proposed decision packet with the role, hash, source manifest, effects, and authority rationale.
+- [ ] Compare the frozen packet's actual contributor families with the accepted Task 2c record.
+- [ ] On a mismatch, stop adoption and reopen the route gate through material reassessment.
+- [ ] Preserve the adoption hold until every required independent route has current proof.
 - [ ] Obtain fresh cross-family review of that exact packet before adoption.
 - [ ] Use the primary reviewer selected from the packet author's family in Task 2c.
 - [ ] Verify each review claim against the current evidence.
```

The coordinator checked the exact insertions against the approved report.
The final scoped review must inspect these insertions and matching graph conditions.
