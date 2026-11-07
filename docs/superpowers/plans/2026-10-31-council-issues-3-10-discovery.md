# Council follow-up discovery implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish verified facts for all eight follow-ups before implementation decisions.

**Architecture:** This horizon permits review and discovery. It does not permit product changes. Each investigation returns evidence for a later design.

**Tech Stack:** TypeScript, Node.js, Vitest, Orca CLI/API, GitHub CLI and the selected Adaptive Planning service.

**Spec:** The active goal and the current authoritative Agent Brief comments for issues #3–#10.

## Global constraints

- Start from PR #2 HEAD `9aff16ceb97e9420ab346552c04405c38d2ffde8` or a verified descendant containing that implementation.
- Preserve branch `dev/issue-1-first-use-reviewed`. Integrate reviewed changes into `dev/council-implementation`.
- Use owning Orca workspace `a7a80763-17f4-4250-9180-7cf8ddfad5a6::/Users/aaat/.codex/worktrees/council-first-use/the-council`.
- Preserve all acceptance criteria and the complete final outcome.
- Use Sol Max for implementation assignments.
- Use Sol Max for new delegated discovery and design assignments. Preserve the existing parent chat settings.
- Use fresh Astra Ultra and Argon high for independent reviews.
- Use Orca CLI/API for ordinary delegation.
- Preserve required controls, included-only billing, journals and unrelated work.
- Do not change global settings, trust, permissions, billing or account state.
- Do not use Orca GUI operations.
- Do not redeem resets, buy credits, enable paid overflow or change payment settings.
- Do not use API-key inference routes. Preserve existing authorized authentication.
- Do not substitute fixtures or zero-call diagnostics for live acceptance.
- Do not implement a design before the required approval.

## Review focus

- A stale or incomplete plugin inventory must not discharge an audit.
- A reported provider error must not be confused with a Council admission gate.
- A cancelled or failed test must not become a completed suite pass.
- Missing billing enforcement must not become inferred included-only access.
- Unknown cleanup or containment must remain unknown.

## Task 1: Review the execution contract

**Files:**
- Read: the frozen active goal and current issue briefs.
- Read: this plan and the progress record.
- Freeze: the active goal, current briefs, plan, progress snapshot, current scope and goal-guidance context.
- Produce: separate Astra and Argon review reports in task-owned evidence directories.

**Interfaces:**
- Consumes: the approved scope, current source revision and authoritative briefs.
- Produces: evidence-backed findings and a coordinator disposition.

- [ ] Freeze the same input bytes for both reviewers.
- [ ] Launch fresh Astra Ultra and Argon high read-only reviews through Orca.
- [ ] Inspect actual models, efforts, tool actions and lifecycle receipts.
- [ ] Check each material claim against its cited source.
- [ ] Record a disposition for every finding.

Verification: Both reports bind to the same artifact hashes.
The coordinator resolves material findings before dependent work starts.

## Task 2: Inspect Gemini inventory sources

**Files:**
- Read: `src/pilot/provider-controls.ts` and `src/pilot/control-audit.ts`.
- Read: `test/pilot/provider-controls.test.ts` and the #3 brief.
- Read: the #4 brief, `src/pilot/provider-session.ts`, `src/pilot/workflow.ts` and `src/pilot/qualification-cache.ts`.
- Read: `docs/qualification/gemini-hook-profile-verification.md`.
- Produce: a source and loader-contract report. This artifact name is provisional.

**Interfaces:**
- Consumes: current source, the #3 criteria and version-matched loader evidence.
- Produces: supported inventory roots, enablement semantics, existing bounds and exact regression locations.

- [ ] Inspect the current acquisition boundary.
- [ ] Locate the supported installed, global and workspace loader inputs.
- [ ] Separate installed presence from active, disabled and unknown enablement.
- [ ] Identify the portable failing case required by #3.
- [ ] Record each unavailable source explicitly.
- [ ] Map #4 startup, input-gate and proof-reuse contracts without starting live Gemini qualification.
- [ ] Identify which inventory changes affect audit and qualification reuse.

Verification: Every proposed source rule has primary evidence.
The report specifies exact files and observable regression assertions.
Do not run a real plugin or provider for this investigation.

## Task 3: Reproduce and inspect offline failures

**Files:**
- Read: `src/pilot/provider-session.ts`.
- Read: `test/pilot/provider-session.test.ts`.
- Read: `test/pilot/discovery.test.ts`, `test/pilot/cache-composition.test.ts`, `test/pilot/context-cleanup.test.ts` and `test/pilot/context-wrapper.test.ts`.
- Read: the #8, #9 and #10 briefs.
- Read: `vitest.config.ts`, `src/pilot/discovery.ts` and `src/pilot/qualification-cache.ts`.
- Read: `src/pilot/context-driver.ts`, `src/pilot/host-wrapper.ts`, `src/pilot/allowance.ts`, `src/pilot/journal.ts` and `src/pilot/workflow.ts`.
- Read: `docs/qualification/gemini-startup-verification.md`.
- Produce: failure receipts and a source-bound diagnosis report.

**Interfaces:**
- Consumes: the unchanged production baseline and existing tests.
- Produces: bounded failure evidence and exact candidate regression boundaries.

- [ ] Record the environment and current process ownership.
- [ ] Run one default `npm test` baseline with a 180-second watchdog.
- [ ] Preserve the exact exit code or partial watchdog result.
- [ ] Settle only fixture-owned resources.
- [ ] Trace the #8 failures through production code and fixtures. Identify the candidate isolated RED regression.
- [ ] Trace the pre-input failure and diagnostic persistence paths.
- [ ] Propose resistant-child and canary assertions from the briefs.

Verification: The baseline receipt identifies its revision, failures, duration and cleanup.
The report separates observed runtime failures from source-derived hypotheses.
Do not edit production code or weaken the tests.

## Task 4: Inspect Cursor capabilities without inference

**Files:**
- Read: `src/pilot/provider-controls.ts`, `src/pilot/preflight.ts`, `src/pilot/provider-session.ts`, `src/pilot/discovery.ts` and `src/pilot/allowance.ts`.
- Read: `test/pilot/provider-controls.test.ts` and `test/pilot/discovery.test.ts`.
- Read: the #5 and #6 briefs.
- Read: the #1 and #7 briefs, `src/pilot/workflow.ts` and `src/pilot/qualification-cache.ts`.
- Read: `skills/the-council/SKILL.md`, `skills/the-council/scripts/run-council.mjs` and `skills/the-council/references/first-use.md`.
- Read: `docs/qualification/issue-1-validation.md`.
- Produce: a capability matrix with primary source references.

**Interfaces:**
- Consumes: current code and supported read-only CLI/API documentation.
- Produces: verified available controls and specific unsupported or unknown controls.

- [ ] Locate the current Cursor trust, read-boundary and helper evidence producers.
- [ ] Locate the included-only billing evidence producer.
- [ ] Verify the supported prevention and enforcement interfaces.
- [ ] Record the exact evidence required before a live test.
- [ ] Preserve each missing or unknown capability.
- [ ] Map #7 package resolution, requesting-project identity and proof-reuse inputs without running Council inference.

Verification: Each positive capability has a supported source and its limits.
Do not launch model inference, change settings or create spending authority.

## Task 5: Prepare the first technical design

**Files:**
- Produce: subsystem design documents under `docs/superpowers/specs/`. Names remain provisional until discovery.
- Update: `docs/superpowers/plans/council-issues-3-10-progress.md`.

**Interfaces:**
- Consumes: accepted discovery reports from Tasks 2–4.
- Produces: bounded design proposals and the proposed implementation order.

- [ ] Compare viable approaches for each affected subsystem.
- [ ] Preserve every posted acceptance criterion.
- [ ] Review the proposals with fresh Astra Ultra and Argon high.
- [ ] Verify reviewer claims against source and decisive checks.
- [ ] Present the concrete design for required user approval.

Verification: The design identifies exact boundaries, regressions, risks and remaining external prerequisites.
Implementation remains provisional until approval.

## Provisional roadmap

This roadmap retains outcomes outside the current discovery horizon.
It does not assert implementation readiness.
After design approval, author concrete plans with `superpowers:writing-plans`.
Review each applicable plan gate with fresh Astra Ultra and Argon high against the same frozen artifact.
Obtain required concrete-plan approval before product edits.
Reuse matching audit approvals within their recorded scope.
Obtain specific authority before adopting a new effect set.
Verify included-only billing before any dependent Cursor probe.
Offline Cursor controls and billing discovery remain independent.
Integrate the final producer candidate before final operational acceptance.
Requalify affected routes when their relevant fingerprint inputs change.
Test-only or documentation-only changes do not automatically imply producer drift.
Earlier bounded qualification remains permitted when its prerequisites and authority are satisfied.

| Outcome | Known prerequisites | Expansion condition |
|---|---|---|
| Fix #3 | Verified loader and source contract. | Approve the inventory design and regression plan. |
| Fix #4 | Accepted #3 and valid current audit inputs. | Verify a matching authorized audit disposition before bounded live probes. |
| Fix #5 | Supported control evidence and scoped authority. | Approve the design and plan. Verify billing before dependent live qualification. |
| Fix #6 | A supported existing billing enforcement source. | Verify the source and approve its integration. |
| Fix #8 | A cause demonstrated by the bounded reproduction. | Approve the cause-specific correction. |
| Fix #9 | Exact pre-input lifecycle and resistant-child assertions. | Approve the lifecycle correction. |
| Fix #10 | Complete diagnostic flow and canary assertions. | Approve the bounded diagnostic contract. |
| Complete #7 | Accepted #4, #5 and #6. | Revalidate all roles for a distinct requesting project. |
| Integrate independent fixes | The affected issue criteria and reviews pass. | Merge through GitHub CLI. Close only issues whose complete criteria pass. |
| Complete the campaign | All eight criteria, reviews, required live evidence and default suite checks pass. | Verify all merges, all eight closures and parent acceptance. |

## Self-review

All eight outcomes remain in the roadmap.
The current tasks produce verifiable discovery artifacts.
No unknown implementation interface is declared ready.
The discovery tasks do not include product edits.
The design and implementation approval gates remain explicit.

## Language verification

This text is an STE Issue 9-oriented candidate.
The official dictionary and governed terminology are unavailable.
Technical literals and the mandated worker header remain unchanged.
Full conformance is not claimed.

