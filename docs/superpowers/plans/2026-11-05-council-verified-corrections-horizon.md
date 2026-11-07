# Council verified corrections implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve verified #8 and #10 defects without weakening the complete issues #3–#10 delivery and parent #1 acceptance.

**Architecture:** This horizon produces two independently reviewable correction plans. The #8 task settles the supervision design before changing its accepted transport. The #10 task specifies narrow changes under its already approved diagnostic design. Neither task implements code or runs a live command.

**Tech Stack:** Python 3, TypeScript, existing offline fixtures, Orca and Adaptive Planning.

**Spec:** `docs/superpowers/plans/2026-11-04-council-runtime-probe-supervisor.md`, `.superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue8-runtime-probe-command-r3-design-20261104/supervisor-design-r3.md` and `docs/superpowers/specs/2026-11-01-council-provider-lifecycle-and-diagnostics-design.md`.

## Global Constraints

- The approved goal still requires every posted Agent Brief, reviewed merge into `dev/council-implementation`, all eight issue closures and real parent #1 second-project acceptance.
- Preserve `#3 -> #4 -> #7` and `#5/#6 -> #7`.
- Use Sol Max for authoring and implementation. Use fresh Astra Ultra and Argon High through Orca for independent review of identical frozen bytes.
- Preserve the main checkout HEAD `3f3c3cdf63130d4aa27037c8f0d42ed5fd36dd8b`, the dirty #5 files and all existing evidence.
- No further Opus launch is allowed while its explicit credit-too-low condition persists. No purchases, resets, overflow or account changes are authorized.
- No Docker, provider, payload or Council command is included in these planning tasks. Keep live execution subject to the separate exact-command decision.
- Preserve every original acceptance assertion. A later pass cannot explain or erase a previous failure.
- Use the original `30-second` phase ceilings, `90-second` overall supervisor limit, at most `three` active command helpers and at most `17` single-use command IDs.
- Diagnostic summaries remain capped at `4,096 bytes`. Preserve raw-data exclusion, private identity bindings, failure classifications, conservative call accounting and mutation uncertainty.
- All detailed output paths below are proposed new artifacts. Existing accepted source and plan snapshots are immutable.

## Review Focus

- Broker reaping or peer loss must not leave a watchdog signal using an identity it no longer owns.
- Nonblocking no-progress and malformed frames require different handling. Neither can silently orphan a permitted helper.
- Writer shutdown must retain ticket outcomes and original deadlines, including storage failure and ENOBUFS.
- A cancellation failure cannot carry success code `NONE`, and projection cannot relabel an actual auth/denial as missing.
- Post-mutation projection rejection must preserve the reserved operation UUID and explicit uncertainty.

## Task 1: Design the bounded transport corrections

**Files:** Read the frozen seven-file Task 3 candidate in `.superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue8-runtime-probe-supervisor-task3-implementation-r1-20261105/author-target/`. Read the source-bound Opus dispositions and coordinator observations in the two `issue8-opus-*-review-20261105` directories. Create only `transport-correction-plan.md` in the assigned isolated author directory.

**Interfaces:** Consume the unchanged `Watchdog.prepare/arm/pump/settle/enqueue_receipt/close` interfaces, the approved R3 design and actual failed combined test report. Produce one exact design recommendation plus an implementation plan, or a demonstrated incompatibility with a minimal proposed amendment. The coordinator retains design approval, integration and acceptance.

- [ ] Read the exact brief, accepted transport, completed Task 3 candidate, failed combined result and deferred findings. Separate natural observations from injected mechanisms.
- [ ] Trace O1, O1b, O2a, F3 and O2b against source. Identify ownership, signal and reap ordering, channel-loss behavior, return-evidence transport and writer ticket outcomes. Do not treat R1 or V1 reviewer recommendations as proven requirements.
- [ ] Give the smallest protocol that meets all original constraints. Explicitly test the reasoning against broker stall/exit, channel loss, delayed notifications, watchdog descheduling, malformed frames and technical backpressure. Do not invent an OS primitive.
- [ ] Plan a decisive inert RED and GREEN for each accepted defect. Preserve the original first natural gate JSON failure and its cascading shared-root failures. Specify checked teardown for every subcase so a failed assertion cannot contaminate the next one.
- [ ] Resolve the storage-failure interface limitation. Either show how already-authorized cleanup fits the existing admission fence or propose the narrowest explicit amendment. No bypass or extra live command is implied.
- [ ] Self-review the recommendation against the approved spec. Save the exact proposed paths, signatures, tests, commands and expected results only where source establishes them. Mark any material design change for coordinator/user review rather than implementation.
- [ ] Return the plan and an evidence-to-finding matrix. No source, fixture, assertion, settings or Git mutation is permitted.

**Verification:** The coordinator verifies each source claim, all covered invariants and the proposed test's decisive failure. Fresh Astra Ultra and Argon High review the same frozen document before implementation becomes eligible.

## Task 2: Plan the narrow diagnostic corrections

**Files:** Read current `src/pilot/context-driver.ts`, `workflow.ts`, `native-command.ts`, `allowance.ts`, `journal.ts` and `diagnostics.ts`. Read their existing diagnostic tests, the current #10 Agent Brief and `issue10-opus-whole-change-audit-20261105/coordinator-consolidated-dispositions.json`. Create only `diagnostic-correction-plan.md` in the assigned isolated author directory.

**Interfaces:** Preserve public driver/report types unless an evidenced change is required. Consume `DiagnosticSummary`, `CancellationResult`, `commandFromClient`, `nativeDiagnosticError/readFailure`, `PilotJournal.wrap` and the existing diagnostic test harnesses. Produce concrete independently testable correction tasks under the approved #10 design.

- [ ] Verify the four coordinator reproductions against current source. The wrong `NONE` cancellation is a failure-classification defect, not an observed false success.
- [ ] Specify a RED for unacknowledged cancellation carrying `NONE`, then require an explicit cancellation failure while preserving actual delivery, exit and call facts.
- [ ] Specify RED cases for `not_authenticated` and `access_denied` through the actual native-command/readFailure boundary. Preserve denial/authentication state before finite projection discards arbitrary text.
- [ ] Specify RED for nested native diagnostic details silently lost by the journal. Preserve each detail or an explicit omission count within 4,096 encoded bytes.
- [ ] Specify RED for a malformed returned run ID after a reserved mutation. Require uncertainty and the reserved UUID without retrying the mutation. Verify launch reachability before adding any analogous launch change.
- [ ] Triage the remaining provider/journal minors against the actual Agent Brief. Do not add arbitrary ASCII identity restrictions or replace provider IDs with hashes. Keep required private identity bindings distinct from diagnostics.
- [ ] Give exact file paths, signatures, expected assertions, minimal implementation choices and bounded offline verification commands. The full repeated default test/typecheck/build goal remains required later; the unresolved #8 custody problem does not authorize changing that gate.
- [ ] Self-review against the approved design and return the plan. No code, test, provider, network, settings or Git mutation is permitted.

**Verification:** The coordinator verifies source reachability, reproduction coverage, unchanged acceptance criteria and exact proposed commands. Fresh Astra Ultra and Argon High review the same frozen plan before implementation.

## Provisional roadmap

The #8 correction implementation becomes concrete only after Task 1 resolves the custody protocol and its independent review. The completed Task 3 candidate then needs integration with corrected transport and a qualified combined run. The original failed run remains evidence.

The #10 implementation becomes concrete after Task 2 and its review. It then needs meaningful RED, minimal corrections, GREEN and fresh paired review of identical bytes.

The complete inert supervisor still needs its whole-change review. A final reviewed live wrapper and exact Docker commands must be shown before any container execution. The existing Linux workload, repeated default tests, build/typecheck, #3/#4/#5/#6 qualification, distinct-project #7 acceptance, PR integration and evidence-backed closures remain in the canonical roadmap. No planning task substitutes for those outcomes.

## Self-review

Both ready tasks are document-only and independently verifiable. They preserve the approved outcome, existing accepted history, source ownership and live boundary. Task 1 explicitly handles unresolved design facts without pretending implementation is ready. Task 2 stays within the approved diagnostic design and verifies actual data-flow reachability. Each review-focus item maps to one or both tasks. Further implementation steps remain provisional until the documented expansion conditions are met.
