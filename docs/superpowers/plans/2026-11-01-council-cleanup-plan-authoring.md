# Council cleanup implementation-plan authoring

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare and review the concrete implementation plan for issue #9 before product edits.

**Architecture:** A fresh Sol Max author converts the approved design into exact TDD tasks. The coordinator verifies the plan. Fresh Astra Ultra and Argon high then review identical frozen bytes before required user plan approval.

**Tech Stack:** TypeScript, Node.js, Vitest 5.0.5, Python diagnostic custody, Orca CLI/API and adaptive-planning.

**Spec:** `/Users/aaat/.codex/worktrees/council-first-use/the-council/docs/superpowers/specs/2026-11-01-council-provider-lifecycle-and-diagnostics-design.md`, approved at SHA-256 `ff07db3e3ffcda082a329a10998448533993ff28bfcb8c1c4f9523b92459479a`.

## Global constraints

- The baseline is `9aff16ceb97e9420ab346552c04405c38d2ffde8`.
- The active branch is `dev/issue-1-first-use-reviewed`.
- The integration target is `dev/council-implementation`.
- This horizon authorizes planning and review. Product edits remain behind the concrete-plan approval gate.
- Use Sol Max authors and fresh Astra Ultra plus Argon high reviewers through Orca.
- Preserve all posted #9 criteria, conservative attempted-input accounting and separate settlement facts.
- Preserve existing controls, journals, global settings, unrelated work and included-only access.
- No real provider inference, global configuration change, timeout increase, serialization or skipped assertion is permitted.
- Keep #10 diagnostic changes separate from the #9 implementation tasks.

## Review focus

- A terminal error arrives after readiness, with no input and a child that ignores SIGTERM.
- An input write is attempted but its delivery acknowledgement is uncertain.
- A cancellation deadline is earlier than the normal cleanup deadline.
- Parsing or process inspection remains pending at cleanup expiry.
- A second stream error or missing input could replace the first substantive failure.

## Task 1: Author the exact #9 TDD plan

**Files:**
- Read: the approved design and issue #9 Agent Brief in `.superpowers/sdd/2026-10-31-council-issues-3-10/current-issues.json`.
- Read: `src/pilot/provider-session.ts`, `src/pilot/wrapper-contract.ts`, `src/pilot/context-driver.ts` and `src/pilot/workflow.ts`.
- Read: `test/pilot/provider-session.test.ts`, `test/pilot/fixtures/agy-startup-provider.cjs` and `test/pilot/context-cleanup.test.ts`.
- Produce: `.superpowers/sdd/2026-10-31-council-issues-3-10/cleanup-plan-author/plan.md`.
- Integrate: `docs/superpowers/plans/2026-11-01-council-preinput-cleanup.md` after coordinator verification.

**Interfaces:**
- Consumes: the approved #9 behavior, `runProviderSession()` and `WrapperAssignment` lifecycle contracts.
- Produces: independently verifiable implementation tasks with exact files, interfaces, test assertions, commands and expected results.

- [ ] Read the current source and applicable planning skills.
- [ ] Define the stable missing-input classification and first-failure semantics.
- [ ] Specify exact resistant-child, controlled-time, cancellation and accounting assertions.
- [ ] Specify bounded parsing and process-inspection behavior without inventing a runtime capability.
- [ ] Require a meaningful RED on unchanged production before each implementation task.
- [ ] Give each task a GREEN check and an independent review boundary.
- [ ] Include separate owned fixture watchdog and cleanup verification.
- [ ] Include necessary source-regression checks, typecheck and build commands.
- [ ] Run the maintained five-part plan self-review.

Verification: Every #9 criterion and each review-focus row maps to an exact task and assertion.
The author must not execute tests or modify product files while preparing this plan.
The coordinator must reject guessed APIs, placeholder actions, weakened checks and uncontrolled fixture signals.

## Task 2: Review and approve the concrete plan

**Files:**
- Read: the accepted plan from Task 1, the approved design, exact #9 brief and relevant frozen source copies.
- Produce: owned review reports and a coordinator finding disposition under `.superpowers/sdd/2026-10-31-council-issues-3-10/`.
- Update: `docs/superpowers/plans/council-issues-3-10-progress.md`.

**Interfaces:**
- Consumes: one exact accepted concrete-plan artifact and baseline-bound sources.
- Produces: verified review findings, settled review resources and explicit user plan approval.

- [ ] Freeze the concrete plan and its required evidence.
- [ ] Dispatch fresh Astra Ultra and Argon high reviews through Orca.
- [ ] Verify material findings against source or a decisive permitted check.
- [ ] Correct the plan and verify the corrected artifact at the applicable review gate.
- [ ] Present the concrete reviewed plan for required user approval.
- [ ] Preserve all review attempts, findings and unknown receipts.

Verification: Both reviewers assess the same artifact. The coordinator records every material disposition.
Product implementation becomes eligible only after the exact concrete plan is approved.

## Provisional roadmap

The complete #3–#10 goal remains authoritative.
The original discovery roadmap retains the Gemini, Cursor, parallel-test and second-project outcomes.
After this horizon, expand #9 implementation from its approved concrete plan.
Then prepare #10 implementation against the integrated #9 boundary.
Continue independent #8 causal diagnostics and #3 loader-contract discovery within their declared scopes.
Preserve #3 -> #4 -> #7 and #5/#6 -> #7.
Completion still requires reviewed merges, repeated bounded default tests, typecheck, build and evidence-backed closure of all eight issues.

## Self-review and language note

Spec coverage: The horizon prepares all #9 criteria and retains the complete goal through the roadmap.
Step scan: Both ready tasks produce verifiable documents. They do not claim implementation readiness.
Interface consistency: Task 2 consumes the exact accepted plan artifact from Task 1.
Review focus: Task 1 must pin all five rows to executable regressions before acceptance.
Proportion: Unknown implementation decisions belong to the authoring task, not guessed product instructions in this horizon.

This is an STE Issue 9-oriented candidate. The dictionary and governed project terminology are unavailable.
Paths, commands, model IDs, hashes, limits and protocol identifiers remain protected literals.
Full ASD-STE100 conformance is not claimed.
