# Gemini hook closure investigation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the Gemini hook blocker without changing Cursor or global provider settings.

**Architecture:** Reproduce the current audit result. Investigate AGY controls and the complete Orca hook commands in separate read-only entries. Promote a repair only when its required contract has evidence. Keep audit adoption and runtime qualification separate.

**Tech Stack:** TypeScript, Node.js, Vitest, Orca 1.4.245, AGY 1.4.12.

**Spec:** docs/superpowers/specs/2026-10-31-council-audit-refresh.md

## Global constraints

Use only `gpt-6-astra` at `ultra` and `gemini-4-argon-high` at `high` through Orca. Keep the canonical policy at `/Users/aaat/.agents/policies/model-policy.md`. Preserve existing source and evidence. Do not read endpoint or credential files. Do not change global settings, hooks, permissions, trust or billing. Do not use Cursor. Do not infer hook environment inheritance from the parent environment filter. Keep unresolved inputs unresolved until the evidence establishes their closure. Do not approve effects during discovery.

## Review focus

- AGY can construct a hook environment independently of the parent environment.
- A fallback branch can execute a command that an incomplete sanitizer omits.
- A supported setting can merge with other hook sources instead of replacing them.
- An executable permission can change without a byte hash change.
- A source repair can leave old audit evidence unusable.

### Task 50: Establish the installed AGY hook control contract

**Files:** Read `src/pilot/provider-controls.ts`, `src/pilot/provider-session.ts`, the installed AGY help and version, and the task-owned primary documentation packet. Read installed executable metadata only if useful. Produce `.superpowers/sdd/2026-10-31-council-audit-refresh/gemini-hook-contract/report.md` through the supervising wrapper.

**Interfaces:** Consume the Gemini-only reproduction receipt and current source. Produce source-backed supported controls, missing evidence, and one bounded next experiment or repair proposal. The coordinator owns experiments and acceptance.

- [ ] Read the reproduction receipt and exact current producer guard.
- [ ] Check documented per-session hook controls and source acquisition rules. Cite exact evidence. Distinguish absent documentation from unsupported behavior.
- [ ] Identify evidence for actual hook subprocess environment construction. Do not assert inheritance without proof.
- [ ] Return a bounded proposal with expected observations and explicit unknowns. Make no provider, product or configuration changes.
- [ ] Verify model, effort, native tool actions, protected inputs and process settlement externally.

**Expected result:** The report establishes a supported control or names an exact missing premise. A proposal alone is not a ready implementation task.

### Task 51: Complete the static Orca hook analysis

**Files:** Read `src/pilot/provider-controls.ts`, `src/pilot/provider-session.ts`, `.superpowers/sdd/2026-10-31-council-audit-refresh/gemini-hook-static-inputs.json`, and `/Users/aaat/.orca/agent-hooks/antigravity-hook.sh`. Produce `.superpowers/sdd/2026-10-31-council-audit-refresh/gemini-hook-static-review/report.md` through the supervising wrapper.

**Interfaces:** Consume sanitized actual descriptors, settings key names, script bytes and current code. Produce complete branch analysis, safety premises and a proposed decisive check. Do not consume the other worker report before the first verdict.

- [ ] Classify every command in all five descriptors. Include both condition branches and fallback commands.
- [ ] Trace the script before endpoint sourcing, spool writes and network calls. State all conditions on those paths.
- [ ] Check source, mode and environment assumptions. Do not treat filtered parent variables as proof of hook-entry variables.
- [ ] Separate demonstrated defects from proposed behavior. Do not label a desired new assertion as a reproduced software defect.
- [ ] Return file and line evidence. Verify model, effort, tool actions and process settlement externally.

**Expected result:** The report has no unclassified command branch or hidden assumption. Remaining unknown runtime premises remain explicit.

## Later roadmap

1. Verify both reports against primary evidence. Conduct a bounded task-owned experiment if it can establish the missing contract without global changes.
2. Refine the Gemini resolution task with exact files, interfaces and meaningful RED/GREEN checks. Obtain a fresh cross-family review before implementation.
3. Use Astra Ultra for product edits under the qualified native edit route. Record RED on unchanged production before the edit. Run focused checks, typecheck, build and the controlled full suite.
4. Obtain fresh Argon high review of frozen bytes. Use a fresh Astra review for any consequential Gemini contribution. Resolve findings against evidence.
5. Prepare complete Gemini audit effects. Review and adopt them through genuine native provenance only when no unavailable input remains. Verify the Gemini hook fact independently of later runtime gates.
6. Keep full Council and second-project acceptance open until those separate outcomes have evidence. Leave Cursor unchanged.

## Authoring and language check

The two ready tasks are evidence-only. Their outputs, owners, files and observable checks are explicit. The later repair is provisional. Accepted tasks and historical documents remain unchanged. This is an Issue 9-oriented language candidate. The official dictionary and governed glossary are unavailable. Commands, paths, model IDs and error literals are protected.
