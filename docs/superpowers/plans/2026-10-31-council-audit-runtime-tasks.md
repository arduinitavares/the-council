# Council audit runtime checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the concrete runtime questions found by the accepted audit inventory.

**Architecture:** Keep diagnosis, native metadata qualification, and model route qualification separate. Preserve the original audit adoption gates. Use the resulting evidence for the next material revision.

**Tech Stack:** Node.js, TypeScript source inspection, Orca CLI/API, AGY 1.4.12, Codex 0.164.0.

**Spec:** [Audit refresh specification](../specs/2026-10-31-council-audit-refresh.md).

## Global Constraints

- Execute only the reviewed audit refresh scope.
- Use only Astra `gpt-6-astra` at `ultra` and Argon `gemini-4-argon-high` at explicit `high` for code and reviews.
- Use Orca CLI/API operations only.
- Preserve global settings, trust, permissions, accounts, billing, old evidence, and unrelated sessions.
- Leave Cursor unchanged.
- Do not read runtime endpoint files or credential values.
- Keep source implementation behind a proven defect, concrete plan, qualified edit route, and RED evidence.
- Keep every effect and native provenance check active.
- Do not replace a required model or lower its effort silently.

## Review Focus

1. A filtered parent environment does not prove every hook command has the same environment.
2. A source inspection result must distinguish a demonstrated defect from unresolved behavior.
3. A synthetic native task does not approve any real provider effect.
4. Catalog support does not prove the actual requested model and effort took effect.
5. Read-route qualification does not establish native edits or full Council containment.

The graph IDs remain stable.
Task 20 refines the main plan's Task 2.
Task 21 refines Task 2b.
Task 22 refines Task 2c.
The numeric labels support exact extraction through the maintained task-brief helper.

### Task 20: Diagnose the unresolved Gemini hook closure

**Graph ID:** `resolve-audit-gaps`

**Files:**
- Read: `src/pilot/provider-controls.ts` and `src/pilot/provider-session.ts`.
- Read: `test/pilot/provider-controls.test.ts` and `test/pilot/provider-session.test.ts`.
- Read: `/Users/aaat/.orca/agent-hooks/antigravity-hook.sh`.
- Read: the frozen Gemini audit and sanitized hook command evidence.
- Create: a diagnosis report in this plan's isolated `gemini-diagnosis` case.
- Preserve: production source, settings, credential files, and runtime endpoint files.

**Interfaces:**
- Consumes: the accepted Task 1 bundle and exact unresolved hook path and digest.
- Produces: a source-backed diagnosis, remaining uncertainty, and a decisive test proposal if appropriate.
- Supplies: the next repair or explicit blocked-role revision.

- [ ] Read the exact source contracts and current hook script.
- [ ] Trace the source of `HOOK_DYNAMIC_CLOSURE_UNAVAILABLE`.
- [ ] Compare the provider environment filter with the hook's actual input paths.
- [ ] Check sanitized command metadata for environment assignments.
- [ ] Identify any premise that still needs AGY behavior or runtime evidence.
- [ ] Classify the result as a demonstrated producer defect, legitimate unresolved dependency, or insufficient evidence.
- [ ] Give exact source lines for each consequential claim.
- [ ] If a defect is demonstrated, propose the smallest falsifiable regression test.
- [ ] Describe the expected RED result on unchanged production code.
- [ ] Return the report without editing source or running providers.
- [ ] Obtain a fresh Astra Ultra review after its exact read route passes qualification.
- [ ] Verify the review against the actual sources before acceptance.

Do not clear the unresolved input by assertion or approval.
Do not implement a proposed repair within this diagnosis task.
A repair requires another material revision with exact files and tests.
An unresolved role must not stop independent eligible work.

**Completion check:** The diagnosis and its independent review have exact evidence and explicit limits. No effect approval, source edit, or credential read occurred.

### Task 21: Qualify native coordinator audit provenance

**Graph ID:** `verify-native-provenance`

**Files:**
- Read: `src/pilot/control-audit.ts` and the installed Orca command help.
- Create: an isolated `native-qualification` case with synthetic metadata receipts.
- Retain: the native Run, Task, Dispatch, and final report records.
- Keep transport capabilities in private working records outside the repository.

**Interfaces:**
- Consumes: the current workspace identity and the native verifier contract.
- Produces: current native provenance proof or an exact supported-API failure.
- Supplies: a mandatory adoption prerequisite.

- [ ] Start a genuine owned Orca shell terminal in this checkout.
- [ ] Verify its actual cwd and injected handle and pane identity.
- [ ] Generate a synthetic hash that identifies this qualification only.
- [ ] Create an owned Run through `orchestration run-create`.
- [ ] Create a task with exact spec `Council control audit sha256=<syntheticHash>`.
- [ ] Dispatch that task to the same genuine coordinator handle.
- [ ] Use only actual returned lifecycle IDs and capability arguments.
- [ ] Report success through `orchestration send --type worker_done --outcome succeeded`.
- [ ] Use the exact result body schema from the main plan with the synthetic hash and empty `approvedEffects`.
- [ ] Read back the Run, Task, Dispatch, result provenance, and identities.
- [ ] Check creator, assignee, reporter, pane, workspace, and process incarnation.
- [ ] Record any exact failure without substituting another identity or API.
- [ ] Verify that all owned CLI processes settled.
- [ ] Close only the owned settled terminal.
- [ ] Verify retained native records after terminal closure.
- [ ] Obtain a fresh independent Argon high review of the qualification artifact.

Use a 120-second outer bound and bounded individual CLI calls.
Do not call `native audit adopt` for this synthetic task.
Do not create a real provider approval.
Do not delete historical native records.
An unsupported native action remains a named blocker.

**Completion check:** The current native records meet every required identity and provenance check before and after terminal closure. Otherwise, adoption remains blocked.

### Task 22: Verify the independent review routes

**Graph ID:** `verify-effect-review-route`

**Files:**
- Read: the accepted Argon read-route receipt and current model policy.
- Create: an isolated `astra-qualification` marker and runtime receipts.
- Preserve: source code, global configuration, and native audit evidence.

**Interfaces:**
- Consumes: accepted Argon read proof, current catalogs, and required contributor-family rules.
- Produces: exact available route proofs and explicit unsupported controls.
- Supplies: route evidence for diagnosis and effect review.

- [ ] Recheck the accepted Argon receipt against its current executable and scoped launch construction.
- [ ] Check exposed allowance before the Astra entry.
- [ ] Start Astra through an owned Orca terminal with an isolated task cwd.
- [ ] Pin `gpt-6-astra` and `model_reasoning_effort="ultra"`.
- [ ] Use the supported read-only sandbox for this marker qualification.
- [ ] Require actual policy and marker reads through native tools.
- [ ] Inspect exposed effective model, effort, cwd, and permissions.
- [ ] Inspect only the qualification entry's own runtime metadata.
- [ ] Record every observed native helper and its exposed settings.
- [ ] Keep an untested native helper route unqualified.
- [ ] Verify unchanged protected inputs and settled process and terminal ownership.
- [ ] Record an exact unsupported control without a fallback.
- [ ] Give an OpenAI-authored effect packet an Argon primary reviewer.
- [ ] Give a Gemini-authored contribution an Astra Ultra primary reviewer.
- [ ] Require reciprocal review for consequential contributions from both families.
- [ ] Recheck the actual frozen packet contributors before adoption.
- [ ] Obtain fresh Argon high review of the coordinator's route proof artifact.

Use a finite 600-second outer bound for the Astra disposable entry.
This read test does not qualify edits or full Council controls.
Any later native helper must satisfy the canonical Astra Max helper contract before use.
Only the affected route and its consumers stop on a missing control.

**Completion check:** Every required independent seat has exact current model, effort, action, permission, and settlement evidence. Missing routes remain explicit blockers.

## Self-review and language note

The three tasks have separate artifacts and write ownership.
Each task can report a concrete failure without inventing a repair.
The public native command names match installed help.
The model qualifiers preserve the user's exact model and effort restrictions.
The original adoption, drift, full-effect, and partial-outcome rules remain binding.
The text is an Issue 9-oriented candidate.
The official dictionary and governed glossary remain unavailable.
