# Council provider lifecycle and diagnostic persistence design

Status: proposal for independent review and required user design approval.

## Intent and scope

Issues #9 and #10 concern the same provider-report boundary.
Council must stop a failed provider promptly and persist useful, bounded diagnostics.
These changes must preserve validated reviewer results, call accounting and native lifecycle evidence.

This proposal advances two independent parts of the complete #3–#10 goal.
It does not close the Gemini, Cursor, parallel-test or second-project acceptance work.
No product change is authorized by this document alone.

## Verified baseline

The baseline is `9aff16ceb97e9420ab346552c04405c38d2ffde8` on `dev/issue-1-first-use-reviewed`.
The integration target remains `dev/council-implementation`.
The authoritative acceptance criteria remain the posted Agent Briefs for issues #9 and #10.

In `src/pilot/provider-session.ts`, the post-ready input wait does not check its recorded stream error.
The wait can therefore continue until the assignment deadline after a terminal error.
It reads the input file before checking queued parser failures.
The current fixture supplies late input and exits shortly after SIGTERM.
It does not exercise a child that ignores SIGTERM indefinitely.

The same module retains complete initialization metadata, stdout, stderr and arbitrary exception messages in reports.
`src/pilot/host-wrapper.ts` also copies arbitrary exception messages into fallback artifacts.
`src/pilot/context-driver.ts` can propagate report errors into attempts and cancellation results.
Those results can reach journals and the persisted CLI outcome.
These are retention paths. No actual secret disclosure is claimed.

## Approaches and recommendation

For #9, extend the existing pre-input wait with explicit terminal checks and parser ordering.
The alternative is a separate lifecycle state machine.
The existing cleanup path already owns cancellation, process groups and settlement evidence.
The coordinator recommends the smaller control-flow change because it keeps that ownership together.

For #10, use a shared allowlisted diagnostic projection at every affected producer and propagation boundary.
The alternative is to truncate or redact arbitrary diagnostic text.
Text filtering cannot reliably exclude unknown provider content or extra initialization fields.
The coordinator recommends the structured projection.

These are coordinator recommendations. The user has not approved this design yet.

## Issue #9 behavior

The pre-input wait must check recorded terminal errors, child closure, cancellation and the assignment deadline.
It must check queued parser results before opening or authorizing input.
No known terminal error may reserve or deliver model input.
A missing input file at the deadline must produce a stable deadline classification instead of filesystem exception text.
The exact new classification is a concrete-plan decision.

The first terminal failure must remain authoritative.
Later stream overflow, decoder, filesystem or cleanup errors must not replace that failure.
Additional failures can appear only as bounded structured classifications under the #10 contract.

Cleanup must start promptly after the observed terminal error, regardless of the remaining assignment duration.
The existing cleanup allowance remains at most 30 seconds.
Under the full allowance, SIGKILL becomes eligible at approximately two seconds after cleanup starts.
An earlier cancellation deadline must continue to shorten cleanup.
The implementation must account for awaited parsing and process scans within the actual cleanup bound.
It must not report settlement while those operations, streams, timers or observed children remain unresolved.

No-input cancellation must remain distinct from acknowledged active-turn cancellation.
Calls must remain zero when failure or cancellation occurs before any input mutation begins.
Once an input mutation is attempted, existing conservative reservation and uncertainty semantics must remain effective.
A missing delivery acknowledgement must not prove zero calls or justify refunding a reservation.
There must be no `inference-started.json` receipt when input was never attempted.
Late input must not reopen a terminal attempt.
Existing binding, agent identity, Deny, tool and read-boundary checks remain required.

## Issue #10 behavior

Introduce one shared diagnostic contract in a proposed `src/pilot/diagnostics.ts` module.
Its public projection must use fixed keys, finite counters and a finite allowlist of classification codes.
It must retain allowlisted origin and phase, input-delivery state, and original exit and signal facts.
Absent evidence must remain explicit. It must not imply empty tools, containment or successful settlement.
Unknown exceptions and unknown provider codes must become an explicit unknown classification.
Arbitrary messages, stack traces, protocol lines and extra initialization keys must not enter that projection.

The proposed maximum encoded JSON size is 4,096 UTF-8 bytes per complete diagnostic summary.
The concrete plan must define and export this exact limit and the summary types.
It must specify deterministic omission behavior when optional structured details cannot fit.
The summary must indicate omissions explicitly.
Counters must saturate at a declared finite maximum.
Code allowlisting must use an exact finite set, not a permissive prefix or regular expression.

Provider stdout and stderr can be parsed or classified in memory.
Persisted diagnostic fields must contain only the bounded projection.
Initialization persistence must use a field projection after validation.
Only fields required for checked identity, selection and lifecycle evidence may survive.
Unknown nested initialization fields must be omitted.

The projection must cover normal reports, prepared failures and the wrapper exception fallback.
It must also cover errors propagated through attempts, cancellation, journal events, workflow outcomes and CLI output.
It must cover failed and cancelled attempts, not only successful provider completion.
The design does not authorize rewriting old journals or unrelated files.

Validated result envelopes and payloads remain separate from diagnostics.
The size limit does not truncate or redact a user-requested, schema-validated result.
Required binding, packet, assignment and report hashes remain verifiable.
Lifecycle status, exit receipts, process settlement and restrictive file modes remain effective.
Persisted format changes must have an explicit schema/version policy in the concrete plan.
Incompatible historical evidence must fail clearly. There must be no fallback to raw legacy diagnostics.

## Boundaries and proposed order

First implement and review #9 with its resistant-provider regressions.
Then implement and review #10 against the integrated #9 result.
Both can use offline fixtures without provider inference or account changes.

Expected source boundaries are `src/pilot/provider-session.ts`, `src/pilot/host-wrapper.ts` and `src/pilot/context-driver.ts`.
`src/pilot/workflow.ts`, `src/pilot/journal.ts`, `src/pilot/cli.ts` and `src/pilot/wrapper-contract.ts` require propagation and contract inspection.
Tests belong beside the existing provider-session, context-driver, journal, workflow and CLI coverage under `test/pilot/`.
The concrete implementation plans must name exact files, interfaces, assertions and commands before execution.

No global settings, permissions, trust, billing or provider substitution changes are in scope.
No timeout increase, blanket test serialization, skipped assertion or weakened acceptance criterion is permitted.
Relevant producer changes invalidate affected qualification evidence through the existing fingerprint chain.

## Required verification

For #9, first record RED on unchanged production code.
Use a valid initialization followed by a terminal protocol error.
Keep stdin and output open. Ignore SIGTERM. Supply no input or cancellation.
Use an independent fixture watchdog and two substantially different future assignment deadlines.
Measure prompt cleanup entry, escalation eligibility and actual bounded settlement.
Verify zero calls, no inference receipt, first-error preservation and rejection of late input.
Also verify missing-input deadlines and earlier cancellation bounds.
Do not treat cleanup entry alone as completed cleanup.

For #10, first record RED on unchanged behavior.
Use distinct synthetic canaries in stdout metadata, stderr chunks, extra initialization keys and exceptions.
Inspect prepared/result files, fallback artifacts, cancellation results, journal events, final outcomes and surfaced error strings.
No diagnostic canary may survive in those locations.
A separate canary in a schema-validated result payload must remain intact.
Exercise multiple chunks and encoded sizes at `N-1`, `N` and `N+1` bytes.
Include multibyte text and explicit omission behavior.
Retain forged-binding, tampered-artifact, uncertain-close and duplicate-close rejection tests.

Each substantive change requires fresh Astra Ultra and Argon high reviews through Orca.
Both reviewers must inspect the same frozen artifact.
The coordinator must verify and dispose each material finding against source or a decisive test.
Only Sol Max implementers may make the product changes under the active goal.
No issue closure is justified by this design review.

## Remaining goal work

Gemini #3 still needs current loader and enablement semantics, a portable RED and a reviewed fix.
Gemini #4 requires real startup, normal/cancel qualification and reusable current receipts after #3.
Cursor #5 and #6 still need supported effective containment and existing included-only enforcement evidence.
Missing capability evidence must remain unknown or missing.
Issue #8 still needs a cause-specific reproduction and a verified correction.
The isolated discovery file passed 13 tests. This does not establish default parallel suite health.
A subsequent four-suite diagnostic completed with seven discovery failures and three passing suites.
Six discovery failures were five-second timeouts. One reported `EXECUTION_HOST_POLICY_PATH_MISMATCH`.
The exact hot phase and causal order still require investigation. No parallel-test correction is proposed here.
Issue #7 still requires real configured reviewers, judge comparison and ballots from a distinct requesting project.
The full goal still requires reviewed merges, repeated bounded default tests, typecheck, build and evidence-backed issue closure.

## Language verification note

This is an STE Issue 9-oriented candidate.
The official dictionary and governed project terminology are unavailable.
Code, model IDs, issue numbers, paths, bounds and quoted protocol identifiers remain protected literals.
Full ASD-STE100 conformance is not claimed.
