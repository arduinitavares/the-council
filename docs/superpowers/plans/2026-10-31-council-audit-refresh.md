# Council audit refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore valid current startup-audit evidence for `openai`, `gemini`, and `judge`.

**Architecture:** Use the existing audit preparation and native adoption interfaces. Inspect current evidence before selecting any repair. Keep Cursor and full Council qualification outside the ready work.

**Tech Stack:** Node.js `22.23.4`, TypeScript, Zod, Vitest, Orca CLI/API, Adaptive Planning MCP.

**Spec:** [Audit refresh specification](../specs/2026-10-31-council-audit-refresh.md).

## Global Constraints

- The user authorized execution of this reviewed plan on 31 October 2026.
- Complete the bounded audit refresh and its verification within this scope.
- Preserve the current checkout, old evidence, and unrelated sessions.
- Use Orca CLI/API operations only.
- Do not open or focus the Orca desktop.
- Do not change global settings, trust, permissions, accounts, or billing.
- Use Astra `gpt-6-astra` at `ultra` and Argon `gemini-4-argon-high` at explicit `high` for code work.
- Verify route qualification and effective settings before each assignment.
- Do not substitute models or lower effort silently.
- Use only Astra Ultra and Argon high for execution reviews.
- The earlier Opus plan reviews remain historical evidence.
- Keep model grants and service tokens in private records outside the repository.
- Require complete source evidence and authenticated effect disposition.
- Preserve current AGY behavior and all existing refusal checks.

## Review Focus

1. A configuration or executable change invalidates exact audit evidence before adoption.
2. An unresolved dependency blocks approval even when every listed effect is accepted.
3. A foreign workspace, coordinator, task, or incarnation cannot approve an audit.
4. A repaired audit does not establish effective tool containment or Cursor billing.
5. A request needs a new run ID, a current deadline, and a genuine Orca terminal context.

## Authority and adaptive horizon

The MCP graph is the canonical plan.
This document provides the detailed task definitions.
Start with seven upcoming tasks in the current horizon.
Expand conditional work only after its discovery checkpoint.
Keep at most ten upcoming tasks.
The related campaign is [the older Council plan](http://192.168.15.199:8790/plans/af97b843-8f9b-476d-958c-da3d7a2773cc).
Do not take over that plan or alter its work.

The current baseline is `f0b89f9fa7d223acdffed4db932c45c96f3816f7`.
Treat its source, configuration observations, and audit hashes as dated evidence.
Read current service identity, plan ownership, holds, and evidence before execution.
Check the actual checkout before assignment.
Declare repository, isolated worker directory, and external resource claims.
Keep obligations until the owner records stopped-use evidence.
Use one writer for each shared file.
Give each reviewer an isolated directory and read-only scope.

At each checkpoint, reassess every pending task.
Publish a material reassessment when evidence changes dependencies, definitions, or document references.
Keep accepted history and record invalidation separately.
Do not continue a dependent task while its reassessment hold remains active.
Use actual activity reports at least every five minutes.
Sweep stale attempts before recovery when the service requires it.

### Evidence validity and partial outcomes

The launcher executes `dist/pilot/cli.js`.
The producer manifest must bind `src`, `dist`, build configuration, package files, and tool versions.
Record the build command and its result.
Do not infer the producer identity from the Git commit alone.

Check file bytes and recorded metadata at each approval boundary.
This includes changes made by another session.
Complete owned code work and its reviews before the final adoption window.
Avoid unrelated owned provider launches during that window.
Do not lock global files or interrupt unrelated sessions.

If an input changes, stop use of the affected evidence.
Prepare a new snapshot for that role.
Review the changed effects against the new hash.
Create a new native report only after that review passes.
Recheck affected downstream results through a material reassessment.
Retain the earlier records as history.
If inputs continue to change, report that role as blocked.
Continue independent eligible work.
Allow one repeated preparation and review cycle per role after the first drift.
Stop that role after a second drift in this attempt.
This limit includes drift during the review itself.
Select a review route with separate mutable sources when the family rules permit it.
Further drift recovery requires a material reassessment with new evidence.

An unresolved input can be a valid environmental constraint.
It does not prove a software defect.
Do not change global configuration to remove it within this scope.
After Task 1, publish separate eligible and blocked role branches when necessary.
Use role-specific resolution and adoption nodes within the ten-task horizon.
Revise downstream completion checks before assignment.
Do not mark an unreachable task complete.
The overall objective remains incomplete if any selected role remains blocked.
The coordinator records `block_reason` when any selected role or required gate blocks progress.
The coordinator records `stop_reason` when no authorized eligible work remains.
These rules apply even when Task 5 cannot start.

### Task 1: Prepare the current audit reports

**Graph ID:** `prepare-audits`

**Files:**
- Read: `src/pilot/cli.ts`, `src/pilot/provider-controls.ts`, `src/pilot/control-audit.ts`.
- Read: `skills/the-council/references/first-use-roster.yaml`.
- Read: historical files under this checkout's `.council/control-audits/snapshots/` and `.council/control-audits/dispositions/`.
- Rebuild after execution authorization: `dist/` through the existing build command.
- Create after execution authorization: `.council/control-audits/snapshots/<hash>.json` through the public command.
- Create: a private three-role comparison report and source-hash manifest.

**Interfaces:**
- Consumes: the current roster, provider versions, existing source files, and recorded historical snapshots.
- Produces: `{ hash, path, snapshot, requiredDispositions, unavailable, providerQualification }` for each selected role.
- Supplies: exact audit hashes, source differences, effects, and unresolved inputs to Tasks 2 and 3.

- [ ] Verify the execution checkout and current source hashes.
- [ ] Inspect `package.json`, the lockfile, build configuration, and `scripts/copy-assets.mjs`.
- [ ] Record Node, package-manager, and TypeScript versions.
- [ ] Preserve any existing generated-file changes before a rebuild.
- [ ] Claim the generated output and snapshot directories as write resources.
- [ ] Rebuild the unchanged baseline with `npm run build`.
- [ ] Freeze the resulting source and generated producer manifest.
- [ ] Record every role's complete bootstrap blocker set, catalog state, provider version, source contract, and required-flag coverage.
- [ ] Keep effective runtime controls separate from bootstrap facts.
- [ ] Inspect current Astra Ultra and Argon high qualification receipts for the required future actions.
- [ ] Record any missing route proof without launching a qualification probe in this inventory task.
- [ ] Verify available allowance without purchases, reset redemption, or paid overflow.
- [ ] Inspect current Orca help for the native command sequence in Task 3.
- [ ] Record whether matching host-specific native provenance qualification exists.
- [ ] Refine Tasks 2b and 2c from the current qualification evidence before assignment.
- [ ] Keep both qualification nodes as explicit adoption dependencies on every path.
- [ ] Run the public audit preparation command for `openai`, `gemini`, and `judge` separately.

```text
/opt/homebrew/opt/node@22/bin/node /Users/aaat/.codex/worktrees/council-first-use/the-council/skills/the-council/scripts/run-council.mjs native audit prepare --workspace /Users/aaat/.codex/worktrees/council-first-use/the-council --config /Users/aaat/.codex/worktrees/council-first-use/the-council/skills/the-council/references/first-use-roster.yaml --role openai
```

Use the same command with `--role gemini` and `--role judge`.
Do not add `--json` to the audit subcommand.

- [ ] Compare each complete current snapshot with the relevant historical evidence.
- [ ] Record source, version, recipe, loader-order, effect, and unavailable-input differences separately.
- [ ] Check the stored hash through `auditHash(snapshot)`.
- [ ] Verify that preparation created no disposition.
- [ ] Classify each role as eligible, unresolved, unsupported, or awaiting authority.
- [ ] Record a checkpoint with the three reports and current source hashes.
- [ ] Reassess Tasks 2 through 5 before further assignment.

Preparation creates snapshot directories and files.
It executes provider version and help commands.
Record these actions and their results in the resource evidence.
It does not make model inference calls.

**Completion check:** Every role has a complete report or an exact preparation failure. The report identifies the built producer and native provenance feasibility. No effect approval occurred.

### Task 2: Resolve a demonstrated audit gap

**Graph ID:** `resolve-audit-gaps`

**Status:** Provisional discovery branch.

**Expansion condition:** Task 1 identifies an unresolved input or a reproducible local software defect.
Do not invent an implementation before that evidence exists.

**Likely files after expansion:**
- Inspect: `src/pilot/provider-controls.ts`, `src/pilot/control-audit.ts`.
- Test: `test/pilot/provider-controls.test.ts`, `test/pilot/control-audit.test.ts`.
- Change only the files that own the proven defect.

**Interfaces:**
- Consumes: Task 1 reports and exact failing input.
- Produces: complete evidence or a narrowly repaired audit producer with independent acceptance.

- [ ] Classify each gap as source evidence, software behavior, or missing authority.
- [ ] Keep credential-dependent or unresolved effects blocked.
- [ ] Record unsupported provider contracts as separate blockers.
- [ ] If the gap requires code, publish the exact defect, files, interface, test assertions, and expected failure.
- [ ] Build unchanged production code before running a new RED test.
- [ ] Verify which tests import `src` and which import `dist`.
- [ ] Assign the failing regression test to Astra Ultra or Argon high.
- [ ] Record RED on unchanged production code before any implementation edit.
- [ ] Assign the minimal correction to Astra Ultra or Argon high.
- [ ] Run typecheck and build when code changes.
- [ ] Run the changed behavior tests and directly affected safety tests after that build.
- [ ] Run one full suite on the final frozen software artifact when code changes.
- [ ] Obtain a fresh cross-family task review of the actual diff.
- [ ] Verify each review claim and record its disposition.
- [ ] Refresh the affected snapshots after a producer or source change.
- [ ] Record the checkpoint and reassess every remaining task.

If no gap exists, retire this task with evidence.
Replace only the repair dependency with Task 1 before dispatch.
Keep the Task 2b and Task 2c dependencies on Task 3.
Resolve the material reassessment hold explicitly.
Do not report an unperformed repair as completed work.

A missing code-route qualification requires a separate provisional qualification task before code assignment.
That task requires an authorized disposable target and exact action checks.
It cannot alter persistent settings or use a lower effort as a fallback.
Any Astra Ultra native helper must use Astra at `max` under the canonical policy.
Those internal helpers do not replace independent acceptance.
An Astra-authored change requires an Argon primary review.
An Argon-authored change requires an Astra primary review.
Apply this rule to consequential integration changes too.

**Completion check after expansion:** Each role has complete evidence or an explicit blocked outcome. A source repair requires verified RED/GREEN evidence and independent approval. Revise the role branches before adoption.

### Task 2b: Verify the native provenance gate

**Graph ID:** `verify-native-provenance`

**Status:** Provisional qualification branch after Task 1.

**Files:**
- Read: current host-specific native qualification records and the audit verifier.
- Create after concrete expansion: a declared synthetic qualification target and native metadata receipts.
- Preserve: real provider snapshots and dispositions.

**Interfaces:**
- Consumes: Task 1 feasibility findings and the exact current native identity contract.
- Produces: a verified qualification receipt or an exact blocker.
- Supplies: a mandatory accepted prerequisite for Task 3.

- [ ] Check any existing receipt against the current host, runtime contract, workspace, and required actions.
- [ ] If matching proof is missing, publish the concrete disposable test before assigning its execution.
- [ ] Use an owned Orca terminal and a declared synthetic audit target for that test.
- [ ] Test native metadata creation and readback without provider inference or real effect approval.
- [ ] Verify the exact creator, assignee, reporter, pane, workspace, and incarnation fields.
- [ ] Verify retained provenance after the owned terminal closes.
- [ ] Record the exact runtime gap if self-dispatch or required fields fail.
- [ ] Keep every eligible role's adoption node dependent on this accepted gate.

Do not fabricate native identity or write disposition files directly.
A missing or failed proof keeps this gate unaccepted.
It does not authorize a production repair within the qualification task.

**Completion check:** Current native provenance proof covers every required field and retained readback. Otherwise, adoption remains blocked.

### Task 2c: Verify the effect review route

**Graph ID:** `verify-effect-review-route`

**Status:** Provisional route gate after Task 1.

**Files:**
- Read: the decision packet's author record and current route qualification receipts.
- Create after concrete expansion: an isolated disposable read-only qualification record if needed.

**Interfaces:**
- Consumes: the actual packet author's family and required review actions.
- Produces: exact qualified reviewer settings or an exact route blocker.
- Supplies: a mandatory accepted prerequisite for Task 3.

- [ ] Record the actual family of each consequential packet contribution.
- [ ] Select Argon high for an OpenAI-authored packet.
- [ ] Select Astra Ultra for a Gemini-authored packet.
- [ ] Require reciprocal cross-family review for consequential contributions from both families.
- [ ] For another permitted author family, select a qualified Astra Ultra or Argon high reviewer from a different family.
- [ ] Verify the exact host, model, effort, transport, actions, permissions, and stopped lifecycle proof.
- [ ] If required proof is missing, publish a concrete disposable qualification task before launch.
- [ ] Keep Task 3 dependent on the accepted route gate.

An Astra review of an OpenAI-authored packet is supplemental.
A missing required route blocks the effect review and adoption.
Do not substitute Opus or a lower effort for this runtime evidence review.

**Completion check:** Each required independent seat has matching current route proof. Otherwise, adoption remains blocked.

### Task 3: Review and adopt justified dispositions

**Graph ID:** `adopt-audits`

**Files:**
- Read: the exact current snapshots and approved effect evidence.
- Create through the public adoption path: `.council/control-audits/dispositions/<hash>.json`.
- Preserve: historical snapshots, dispositions, and native records.

**Interfaces:**
- Consumes: current snapshots with complete source closure and resolved Task 2 evidence.
- Requires: accepted Tasks 2b and 2c on every graph path.
- Produces: authenticated dispositions bound to the exact snapshot and native coordinator identity.

The native task specification is exactly `Council control audit sha256=<hash>`.
The owned coordinator is the task creator, dispatch assignee, and result reporter.
The task and dispatch must complete with a successful native worker report.
The result body has this exact schema:

```json
{"kind":"council-control-audit","snapshotHash":"<hash>","approvedEffects":["<reviewed-effect-id>"]}
```

Use the actual reviewed effect IDs.
The public adoption command is `native audit adopt --workspace <workspace> --hash <hash> --run <orcaRunId> --task <orcaTaskId> --orca /usr/local/bin/orca`.
`orcaRunId` is an Orca orchestration Run ID.
It is not the Council request `runId` used in Task 4.
Do not substitute an independent reviewer's identity for the native coordinator.

The following command templates use the installed CLI's supported flags.
Run them from the same genuine owned coordinator terminal.
Use actual returned IDs and the dispatch preamble's exact lifecycle arguments.
The disposable qualification must establish self-dispatch before these templates become executable work.

```text
/usr/local/bin/orca orchestration run-create --objective "Council control audit" --json
/usr/local/bin/orca orchestration task-create --run <orcaRunId> --spec "Council control audit sha256=<hash>" --json
/usr/local/bin/orca orchestration dispatch --run <orcaRunId> --task <orcaTaskId> --to <coordinatorHandle> --return-preamble --json
/usr/local/bin/orca orchestration send --run <orcaRunId> --from <coordinatorHandle> --type worker_done --task-id <orcaTaskId> --dispatch-id <dispatchId> --dispatch-capability <returnedCapability> --outcome succeeded --subject "Council control audit" --body '<exact-reviewed-JSON-body>' --json
```

Do not invent a capability when the preamble does not expose one.
Inspect the actual native records before adoption.
The CLI supports `--body`, not `--body-file`.
Keep the effect IDs exact when constructing the JSON argument.

- [ ] Verify that each required source digest still matches.
- [ ] Verify that each `unavailable` list is empty.
- [ ] Verify the accepted native provenance and effect review route gates.
- [ ] Compare every required effect with existing task authority.
- [ ] Reuse existing applicable authority without a routine permission request.
- [ ] If any effect lacks authority or violates a refusal, block that role before adoption.
- [ ] Verify set equality between proposed `approvedEffects` and `requiredDispositions`.
- [ ] Adopt no disposition for that hash when any required effect remains unapproved.
- [ ] Freeze a proposed decision packet with the role, hash, source manifest, effects, and authority rationale.
- [ ] Compare the frozen packet's actual contributor families with the accepted Task 2c record.
- [ ] On a mismatch, stop adoption and reopen the route gate through material reassessment.
- [ ] Preserve the adoption hold until every required independent route has current proof.
- [ ] Obtain fresh cross-family review of that exact packet before adoption.
- [ ] Use the primary reviewer selected from the packet author's family in Task 2c.
- [ ] Verify each review claim against the current evidence.
- [ ] Recheck source and producer hashes after the review.
- [ ] Recheck them immediately before each adoption.
- [ ] Create the required native audit task and disposition through supported Orca operations.
- [ ] Verify its workspace, coordinator, task, dispatch, and incarnation bindings.
- [ ] Run the public `native audit adopt` command with its actual hash, run, and task IDs.
- [ ] Recheck source and producer hashes after adoption.
- [ ] Read back the native Run, Task, Dispatch, result body, and adopted reference through their public interfaces.
- [ ] Retain native Run, Task, Dispatch, result, and workspace registration records while Council uses the disposition.
- [ ] Verify native record readback after the owned coordinator terminal closes.
- [ ] Leave the provider startup-fact verification to Task 4's saved preflight outcome.
- [ ] Record the checkpoint with exact source and producer hashes.
- [ ] Reassess Tasks 4 and 5 after the result.

Adoption is write-once for each hash and native reference.
An independent review does not create missing user authority.
If later evidence disproves an adopted decision, stop its reuse.
Report the supported correction or revocation gap.
Do not delete a disposition or force a new hash to hide that decision.

**Completion check:** Each eligible role has an authenticated adoption with the complete required effect set and unchanged inputs. Each blocked role has a revised branch and exact reason. Task 4 must still verify the provider facts.

### Task 4: Verify the scoped roster result

**Graph ID:** `verify-preflight`

**Files:**
- Use: `.superpowers/reproductions/run-os-question-fresh.py`.
- Read: the new `.council/native/<runId>/outcome.json` and native lifecycle records.
- Create: a sanitized result comparison and stopped-resource receipts.

**Interfaces:**
- Consumes: Task 3 dispositions and the same frozen source inputs.
- Produces: a fresh roster preflight result with separate role, audit, and operational states.

- [ ] Start or reuse an owned Orca terminal in the requesting checkout.
- [ ] Verify its actual cwd and genuine injected caller context.
- [ ] Recheck all source and producer hashes before preflight.
- [ ] Generate a new Council request `runId` with the helper's 15-minute deadline and unchanged call bounds.
- [ ] Verify that the deadline is future and at most 30 minutes ahead.
- [ ] Run the existing helper once with `--run`.
- [ ] Compare stdout with the persisted outcome.
- [ ] Check each selected `evidence.routes[].controlFacts` entry for the exact startup-audit name and `observation.state: verified`.
- [ ] Require `startup-and-platform-exceptions` for OpenAI and judge.
- [ ] Require `startup-hooks-and-plugins` for Gemini.
- [ ] Confirm that accepted eligible roles have no stale audit blocker.
- [ ] Compare every selected role's complete bootstrap blockers with Task 1.
- [ ] Report blocked roles through the revised partial-outcome criteria.
- [ ] Confirm that Cursor blockers remain explicit.
- [ ] Confirm zero provider initializations and zero probe/topic calls while Cursor still blocks the roster.
- [ ] Inspect failure diagnostics and reconcile every owned resource.
- [ ] Record the checkpoint and reassess Task 5.

If all three selected roles are eligible and their other bootstrap facts remain verified, expect only Cursor prerequisites.
In that case, expect exit `3` with `prerequisites_not_verified`.
If a selected role remains blocked, expect its named blockers as well.
A partial result does not meet the full three-role objective.
A stale audit fact can appear as `controls/CONTROLS_UNKNOWN` in the blocker list.
Inspect its named control facts as well as the top-level reason.
A passing scoped result does not prove normal provider inference or full Council qualification.
If sources change, invalidate affected results before reuse.

### Task 5: Review the complete artifact and report the result

**Graph ID:** `accept-audit-refresh`

**Files:**
- Review: the complete scoped diff, source manifests, audit evidence, and Task 4 outcome.
- Update after authorization: the relevant qualification records and existing draft PR.

**Interfaces:**
- Consumes: all accepted task artifacts and exact lifecycle evidence.
- Produces: an evidence-checked scoped acceptance report and a revised roadmap.

- [ ] Freeze the complete source and evidence artifact.
- [ ] Obtain fresh Astra Ultra and Argon high whole-change reviews if production code changed.
- [ ] Give both reviewers the same frozen inputs and independent read-only contexts.
- [ ] Identify the primary cross-family seat from the actual author of each consequential contribution.
- [ ] Reproduce material findings when a safe local check exists.
- [ ] Classify each finding as accepted, qualified, or rejected with evidence.
- [ ] Use the preserved Superpowers fix budgets if the review requires source fixes.
- [ ] Use one final fix wave and one scoped re-review at the whole-change gate.
- [ ] Keep unresolved load-bearing findings visible after that budget.
- [ ] Invalidate affected producer, snapshot, disposition, and preflight results after any source fix.
- [ ] Publish the corrective preparation, effect review, adoption, and preflight work before accepting downstream results.
- [ ] Rebuild the final producer before regenerating its evidence.
- [ ] Keep the earlier results as history with explicit invalidation.
- [ ] Verify source hashes after any metadata-only update.
- [ ] Release only owned, positively settled resources.
- [ ] Preserve native audit records and workspace registration needed for later readback.
- [ ] Record the required checkpoint, review, acceptance, and resource evidence in the canonical service.
- [ ] Keep this final gate unaccepted for a partial outcome.
- [ ] Set `block_reason` to the unresolved selected roles after independent eligible work finishes.
- [ ] Set `stop_reason` to the exact reason that no authorized eligible work remains.
- [ ] Report source acceptance, audit acceptance, and operational qualification separately.

**Completion check:** The report cites the exact verified artifact and every finding disposition. No full Council success or issue closure is claimed from audit approval alone.

Evidence regeneration does not authorize a second source fix wave.
Report a partial or blocked result when the remaining scope cannot pass.
Do not mark the overall objective achieved in that case.

## Later roadmap

Cursor trust, read boundaries, helper loading, and included-only billing remain outside this bounded repair.
Expand them only after a separate scope decision and current evidence.
Keep both code model restrictions after authorization for that work.

Normal and cancellation qualification remain separate from audit adoption.
Expand those tasks only after evidence establishes their effective controls and required routes.
Use a fresh Council question and a judge comparison only after the full roster passes its prerequisites.
Keep second-project acceptance and issue closure behind that evidence.

## Self-review and language note

The specification requirements map to the seven graph tasks and the later roadmap.
The conditional repair branch requires a material revision before code assignment.
The exact preparation command and returned fields match the current public interfaces.
The five review-focus cases have checks in Tasks 1 through 4.
The plan does not prescribe a speculative patch.
The first Opus review returned Spec PASS and Quality Changes requested.
The coordinator checked all eight Important findings and four Minor findings.
The retained review ledger records the accepted and qualified claims.
The coordinator corrected the AGY version example because the judge uses Codex.
Apply a scoped Opus re-review to these revised planning bytes.
Record its final verdict in the canonical plan.
The first re-review found three further Important gaps and six Minor gaps.
The coordinator checked those claims against the current interfaces and graph.
The revised graph keeps both qualification gates before adoption.

Language review: Issue 9-oriented candidate.
The official dictionary and governed project glossary are unavailable.
The coordinator checked procedure and description structure against the installed companion references.
Commands, paths, model IDs, error text, limits, and schema fields remain protected literals.
The adjacent language note records the limits of this review.
