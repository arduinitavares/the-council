# Council parallel-test correction design authoring

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare and review the cause-specific #8 design without changing product or test behavior.

**Architecture:** A fresh Sol Max designer uses the captured timeout and environment-restoration trace. The coordinator verifies the proposed correction. Fresh Astra Ultra and Argon high review the design before required user approval.

**Tech Stack:** TypeScript, Vitest 5.0.5, synthetic Node CLI fixtures and Orca CLI/API custody.

**Spec:** Issue #8 Agent Brief in `.superpowers/sdd/2026-10-31-council-issues-3-10/current-issues.json` and `parallel-failure-causal-trace-verification.json` in that same directory.

## Global constraints

- Keep baseline `9aff16ceb97e9420ab346552c04405c38d2ffde8` and the complete #3–#10 goal.
- This horizon permits design only. No product edits, fixture edits or diagnostic runs belong to the author assignment.
- Preserve all existing assertions, default concurrency, test coverage and finite owned cleanup.
- Do not solve the failure with suite serialization, broad timeout increases, skips or globally installed providers.
- Keep observed partial-run evidence separate from completed-suite results.
- The trace guard changes behavior after environment mismatch. It does not reproduce every historical effect.
- Do not claim that all cache, wrapper, relay or cleanup failures share the demonstrated matrix mechanism.

## Review focus

- A timed-out async case continues after the next case starts.
- A previous case restores another case's HOME or PATH.
- An isolated run passes while default parallel workload still fails.
- Shared metadata or fixtures could change version, capability or zero-inference assertions.
- A failed or cancelled fixture leaves a process, timer, port, cache lock or temporary resource active.

## Task 1: Design the smallest verified correction

**Files:**
- Read: the #8 brief and `parallel-failure-causal-trace-verification.json`.
- Read: `parallel-phase-trace/phase-trace-full-workload.jsonl`, its fixture verification and the unchanged-source run receipts.
- Read: `test/pilot/discovery.test.ts`, `test/pilot/native-host-fixture.ts`, `src/pilot/discovery.ts`, `src/pilot/native-command.ts` and `src/pilot/provider-read.ts`.
- Read: existing native-command and synthetic host coverage needed to preserve boundary checks.
- Produce: `.superpowers/sdd/2026-11-01-council-parallel-design/design.md` and source-backed design notes.

**Interfaces:**
- Consumes: observed phase timing, async continuation and environment-restoration evidence at the unchanged baseline.
- Produces: a bounded correction design, alternatives, exact regression boundaries and remaining #8 evidence requirements.

- [ ] Verify the recorded causal observations and their limitations.
- [ ] Compare viable fixture-isolation and metadata-acquisition approaches.
- [ ] Recommend the smallest approach that preserves the tested host and version behavior.
- [ ] Define a meaningful RED on unchanged fixture behavior and the corresponding GREEN check.
- [ ] Retain bounded repeated default-suite completion and full fixture settlement as #8 acceptance gates.
- [ ] Identify any remaining unexplained failures and the next decisive check.
- [ ] Check coverage, interfaces, review focus and scope before returning the design.

Verification: Each proposed change has source-backed causal justification.
No passing isolated run may substitute for the required default-concurrency correction.

## Task 2: Review the concrete design

**Files:**
- Read: the accepted design, exact #8 brief, causal evidence and relevant frozen source.
- Produce: independent review reports, coordinator dispositions and the exact user design approval record.

**Interfaces:**
- Consumes: one exact accepted design artifact.
- Produces: verified independent reviews and required user design approval.

- [ ] Freeze the design and its evidence.
- [ ] Obtain fresh Astra Ultra and Argon high reviews through Orca.
- [ ] Verify material findings against source or permitted decisive evidence.
- [ ] Present the corrected, concrete design for user approval.

Verification: Both reviewers inspect the same artifact. Product implementation remains behind later concrete-plan approval.

## Roadmap and self-review

The complete campaign roadmap remains in `2026-10-31-council-issues-3-10-discovery.md`.
This branch progresses independently of #9 planning. It changes no existing dependency.
After design approval, author and review the concrete #8 TDD plan before execution.
Keep remaining #8 failures open until the isolated correction and repeated default suites pass.

Coverage retains every #8 acceptance criterion. Both tasks have observable document outcomes.
Task 2 consumes the exact accepted Task 1 artifact. All five review-focus conditions require explicit design treatment.
No speculative implementation interface or verification result is presented as ready.

This is an STE Issue 9-oriented candidate. Dictionary and governed terminology are unavailable.
Technical identifiers, paths, commands, values and evidence hashes remain protected literals.
Full ASD-STE100 conformance is not claimed.
