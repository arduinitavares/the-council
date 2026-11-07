# Council diagnostics integration implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete #10 Task 7 by reconciling four existing regression files with the accepted diagnostic contracts while preserving all historical behavioral assertions.

**Architecture:** Keep Tasks 1–6 production behavior fixed. Establish current bounded RED before fixture edits, migrate only stale test contracts, and retain the complete diagnostics and campaign acceptance gates. This addendum supplements the approved plan; it approves neither a new design nor a runtime route.

**Tech stack:** TypeScript, Node.js, Zod 4.6.7, Vitest 5.0.5; credential-free existing fixtures.

**Spec:** `docs/superpowers/specs/2026-11-01-council-provider-lifecycle-and-diagnostics-design.md`, SHA-256 `ff07db3e3ffcda082a329a10998448533993ff28bfcb8c1c4f9523b92459479a`.

**Parent plan:** `docs/superpowers/plans/2026-11-01-council-bounded-diagnostics.md`, SHA-256 `b5a0a161d71047388e7af056980194822fcf9746fdf8df41c58bc81806e9302c`. Preserve its Task 7 and all global constraints. The coordinator supplied accepted Task 6 as the predecessor.

**Pinned entry:** `/Users/aaat/.codex/worktrees/council-first-use/the-council`, branch `dev/issue-1-first-use-reviewed`, HEAD `3f3c3cdf63130d4aa27037c8f0d42ed5fd36dd8b`. Reconcile any later revision with the coordinator before execution.

**Status:** Planning only. No current RED, GREEN, build freshness, custody qualification, independent-review verdict, or acceptance result is claimed. Author evidence is confined to `.superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue10-integration-plan-author-20261103/`.

## Global constraints

- “Arbitrary messages, stack traces, protocol lines and extra initialization keys must not enter that projection.”
- “Validated result envelopes and payloads remain separate from diagnostics.”
- “Incompatible historical evidence must fail clearly. There must be no fallback to raw legacy diagnostics.”
- The complete canonical diagnostic summary is at most **4096 UTF-8 bytes**. Diagnostic counters saturate at **2147483647**; business reservations do not.
- Preserve first failure, original exit/signal facts, no-input gates, conservative reservations, bindings, restrictive modes, and positive settlement requirements.
- No timeout increase, blanket serialization, skipped assertion, weakened acceptance criterion, historical rewrite, provider operation, permission/settings change, or publication belongs to this integration.
- The author's permitted writes are this addendum and its task-owned plan evidence. All commands and test edits below are future, coordinator-gated work; no Git mutation is authorized by this authoring assignment.
- Keep #8 separate. Do not edit its six fixture paths, shared fixture/watchdog helpers, approved design, original #10 plan, or another worker's evidence. Missing custody capability holds the affected commands; it is not permission to change the runtime route.

## Review focus

1. A version-only edit can expose previously unreachable cleanup assertions. All nine historical cleanup cases must reach their original assertions at GREEN.
2. An empty journal can fail before testing accounting or stop identity. Valid complete bounds must permit both original scenarios to execute.
3. A fallback code must preserve failed/zero-call disposition and exclude injected input-read text from the report and prepared artifact.
4. Source imports and built imports must exercise the same pinned contracts. Build before the `fix5` dist consumers; exclude a foreign `COUNCIL_FIX5_BASELINE`.
5. A passing command or vanished process group does not establish fixture custody. Demonstrate scope before launching each command class, including failure and detached-child paths.

## Files and current contracts

Only these test files may change in a later authorized fixture migration:

| Path | Responsibility and current anchors |
| --- | --- |
| `test/pilot/rpc.test.ts:7` | Official read-boundary code/class/state and privacy assertions |
| `test/pilot/fix5-regressions.test.ts:47` | Built lost-ack accounting; native code projection at :119; wrapper-stop identity at :124 |
| `test/pilot/provider-cleanup-bounds.test.ts:237` | Shared `noDelivery` contract and all existing cleanup/scan/parser assertions |
| `test/pilot/provider-session-cleanup.test.ts:161` | Private deterministic stand-in; three input-read branches at :274 |

`test/pilot/context-diagnostics.test.ts` is an unchanged supporting control in the third RED command and the original Task 7 selection; include its fixtures in those commands' custody scope.

Read-only producer evidence: `src/pilot/allowance.ts:42`, `rpc.ts:100`, `diagnostics.ts:94`, `provider-session.ts:108`, `:349`, `:407`, `:486`, `wrapper-contract.ts:64`, `:106`, `journal.ts:31`, `:165`, `:287`, and `config.ts:87`, all under `src/pilot/`. The source map in the author evidence records hashes and related fixture/command sources.

| Boundary | Required current contract |
| --- | --- |
| Native failure | `readFailure(source:string,error:unknown):Observation`; `detail` is the canonical JSON **summary itself**, parsed with `parseDiagnosticSummary(JSON.parse(detail))`. There is no nested `.diagnostic` or `.class`. Use `.code` and `.classification`; retain the outer observation state. |
| Provider/prepared | `runProviderSession(a:WrapperAssignment,assignmentHash:string):Promise<ProviderReport>`; `PROVIDER_REPORT_VERSION=2`, `PREPARED_REPORT_VERSION=2`; both strict schemas require `diagnostic`. Reports have no `stdout`/`stderr` keys. Readiness is not settlement. |
| Diagnostic | `DIAGNOSTIC_SUMMARY_VERSION=1`, strict shared parser/registry, finite codes, explicit omissions and input-delivery uncertainty. Unknown `EIO`/unrecognized message becomes `DIAGNOSTIC_UNKNOWN`, classification `unknown`. |
| Journal | `PilotJournal(workspace:string,id:string,bounds:unknown)`; new lines are `{version:2,at,event}`. Bounds require **runId, maxProbeCalls, maxTopicCalls, deadline, workerTimeoutMs, proofTtlMs, configHash**. Do not relax production validation. |
| Outcome/identity | Outcome version remains 2. Wrapper cancellation uses `mutationRequestId("wrapper-stop:"+canonicalJson(binding))` when the attempt has context. Mutation attempts do not prove acknowledged delivery or successful close. |

## Task 7a: Qualify command scope and record current RED

**Owner:** Coordinator and a separately assigned Sol Max implementer after the coordinator's paired plan review. This author launches no worker or reviewer.

**Files:** Read the pinned checkout and sources above. Future execution evidence belongs exclusively to `.superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue10-integration-execution-20261103/`, denoted `V` below. Use exclusive per-invocation subdirectories; an existing foreign/unsettled invocation holds reuse.

**Interfaces:** Consume accepted Tasks 1–6 and the reviewed addendum. Produce `V/pre-edit/`, `V/input-manifest.json`, `V/focused-qualification.json`, `V/red-command-index.json`, and raw command/custody receipts. No test edit precedes complete current RED disposition.

- [ ] **Step 1: Freeze inputs and preserve exact preimages.** Record cwd/branch/HEAD, tracked source/test/config hashes, package/lock/configuration bytes, Node/npm/Vitest executable identities and versions, environment relevant to selection/artifacts, and existing changes. Save the four test preimages under `V/pre-edit/test/pilot/` and their SHA-256 values. Preserve all unrelated work. Require `COUNCIL_FIX5_BASELINE` absent or resolving to this checkout's `dist/`; otherwise hold the built-consumer commands for reconciliation. Record generated `dist/` separately from source.

- [ ] **Step 2: Establish custody eligibility before build, tests, or collection.** The #8 report `.superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue8-validation/discovery-report.md` explicitly leaves unchanged-suite allocation coverage, unseen descendants/timers, and general custody reconciliation unqualified. Its prototype rejects arbitrary suite commands. Do not send these commands to it or infer qualification from its cooperative disposable fixtures.

Inspect the existing receipt runner `.superpowers/sdd/2026-11-01-council-bounded-diagnostics/task-6-fix1-20261103/bounded-command.py`. The original plan's `cleanup-execution/bounded-command.py` path is absent. If execution is authorized, retain an unchanged copy of the inspected runner at `V/bounded-command.py`; pin both hashes. This supplies command deadlines/receipts, **not sufficient outer custody**: its 200 ms census can miss short-lived ancestors and detached descendants, and it does not account for arbitrary roots, locks, ports, or timers.

`V/focused-qualification.json` must bind an independently demonstrated, permitted custody/control method to the execution host, runner hash, exact command/cwd/environment, source/test/build hashes, and each selected fixture path. Record `ELIGIBLE` only for demonstrated scope; otherwise record `HOLD` and the exact missing capability. This plan does not select or authorize a new observer, hook, preload, provider route, global tracer, or permission remedy.

Demonstrate the following separately before the relevant payload runs:

- RPC/native projection: actual Vitest worker lifecycle, temporary installed-client files, mocks, and source/dist imports; a pure in-memory subject does not remove runner/worker custody.
- Cleanup files: exact allocated roots, setup failure before a returned handle, real provider/watchdog processes and detached descendants, original parser/scan promises, stand-in streams, timers and restored Date/process mocks. Stand-in PIDs `2000000001`–`2000000003` are synthetic, never host signal targets.
- Journal/context cases: synthetic native executable, actual built wrapper/provider processes, temporary native state and journal files, wrapper terminal identities, input/stop timers, detached children and teardown failures. `h.close()` and `terminal.closed` alone are insufficient evidence of all descendants and original promises.
- Build/typecheck and later broader selections: their actual subprocesses, generated files/asset copies, roots and resources. A four-file qualification does not qualify the 20-file gate or the full suite.

For each scope use declared disposable representatives of success, assertion failure, setup failure, command timeout and a detached child outliving its parent. Retain PID/birth/UID/ancestry and group identities while parents exist; demonstrate ownership and control of every resource class used by that scope. A registration fixture proves only registration. A prefix scan, polling alone, an empty group, a deleted directory, or a fabricated teardown boolean cannot prove unseen resources absent. If the unchanged selected fixtures cannot be covered without new work/authority, **stop before their RED run** and return the gap to the coordinator. Do not edit them to make the RED runnable.

The copied runner retains its existing **10-second settlement allowance** after each command; no silent extension is permitted. Require observed provider/descendant/wrapper and test worker exits, joined original promises/streams/timers, exact terminal closure where applicable, and separately evidenced root/lock/port cleanup. Preserve raw exits/signals, refusals and unknowns. Timeout, emergency cleanup, watchdog intervention, unresolved resources, or incomplete attribution fail the command gate even when the subject's expected assertion fails. A deliberate product report with unresolved facts may be correct regression behavior; its fixture still must settle separately before another command.

- [ ] **Step 3: Build unchanged source, then capture all three current RED groups sequentially.** These definitions are literal shell shorthand, not commands run during planning:

```sh
V=.superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue10-integration-execution-20261103
B() { python3 "$V/bounded-command.py" "$@"; }
B 60 npm run build
B 60 npm test -- test/pilot/rpc.test.ts test/pilot/fix5-regressions.test.ts -t 'preserves sanitized structured RPC diagnostics|retains forbidden and method_not_found'
COUNCIL_TEST_ARTIFACTS="$PWD/$V/red-cleanup" B 120 npm test -- test/pilot/provider-cleanup-bounds.test.ts test/pilot/provider-session-cleanup.test.ts
B 90 npm test -- test/pilot/fix5-regressions.test.ts test/pilot/context-diagnostics.test.ts -t 'reserves an unknown lost input acknowledgement|records the wrapper stop identity|accepts a bound v2 result'
```

Run from the exact pinned cwd. Build includes `postbuild`: `scripts/copy-assets.mjs` removes only generated `dist/pilot/host-relay.js` and `dist/pilot/host-relay.d.ts` and copies `src/store/schema.sql` to `dist/store/schema.sql`; qualify those exact effects along with TypeScript output. Hash its output and prove each built import resolves to that output. `COUNCIL_TEST_ARTIFACTS` is an existing focused evidence opt-in; qualify its exact task-owned destination. Do not set it for default runs. Keep ordinary Vitest configuration and file parallelism; add no `--maxWorkers`, pool, isolation, retry, timeout or reporter override.

Expected RED is the following **prediction from source and retained history**, not a current result:

| Group | Meaningful expected failure and passing controls |
| --- | --- |
| Native projection | Two test identities fail their obsolete nested-summary access/equality. Record both original code loops; GREEN must reach every code/state branch. |
| Cleanup | Nine identities fail `noDelivery`'s version 1 expectation; the non-ENOENT identity fails its raw-message expectation. The unchanged selection has 29+17 test identities; preserve all other controls and every later assertion. |
| Journal/context | Two identities reject incomplete `{}` bounds with `NATIVE_REQUEST_INVALID` before the intended scenario. The bound-v2 context case remains a control. This is fixture-contract RED, not evidence that lost-ack accounting or stop identity currently fails. |

The retained logs are `isolated-rpc.log`, `isolated-cleanup.log`, and `isolated-journal-context.log` under `.superpowers/sdd/issue8-default-baseline-dxpmrzd3/`. They recorded **2+10+2=14 failures** at the historical control, with `--maxWorkers 1`. All four test files are byte-identical between `39db913` and the pinned HEAD. That comparison establishes neither current execution nor later assertions hidden behind an early failure.

- [ ] **Step 4: Close the pre-edit gate.** Index exact receipts, argv, resolved selections/identities, raw logs, source/build hashes before/after, and positive custody evidence. All test preimages must still match. The coordinator verifies/disposes every predicted versus observed difference before edits. Only the two named incomplete-bounds constructor rejections count as the predicted journal fixture-contract RED. Other import/collection/setup errors, stale dist, a different failure, or timeout do not count as intended RED and cannot authorize speculative fixture correction.

## Task 7b: Migrate the four fixtures without changing their behavior

**Files:** Modify only the four listed tests. Local assertion helpers and capturing already produced bytes before teardown may live in those same files. No shared helper, production contract, configuration, fixture mode, timeout, or #8 file changes.

**Interfaces:** Consume current summaries/schemas and explicit journal bounds. Produce an unchanged semantic assertion set plus privacy/version checks, and `V/green-command-index.json` mapping every historical failed identity to its actual current result.

- [ ] **Step 1: Preserve the complete 14-case matrix.** Keep titles, table rows, ordering constraints and all original assertions except the explicitly obsolete representation/value below. Do not merge away parameter rows or turn unknown lifecycle evidence positive.

| Historical identity | Required migration and retained assertions |
| --- | --- |
| `preserves sanitized structured RPC diagnostics through the official read boundary` | Parse `observed.detail` directly. Retain `runtime_timeout` → `timeout`/outer `missing` and `permission_denied` → `denial`/outer `denied`, plus private-account exclusion. |
| `retains forbidden and method_not_found as sanitized native codes` | Parse the direct summary; retain both exact codes. Assert classification/state `denial`/`denied` for `forbidden`, `control`/`missing` for `method_not_found`, and exclusion of the injected `private` text. |
| `expires cleanup with a scan that never closes` | Migrate shared `noDelivery` to report v2; retain zero calls/writes, null cancellation, no inference/cancel-ack artifacts, timer settlement, scan timeout ≤2000 and ≤30000 ms, 1048576 maxBuffer/SIGKILL, exactly one scan stop, unresolved scan/descendants and exact 30000 ms bound. |
| `retains the full cleanup allowance while owned work remains pending` | Retain no report at 29999 ms, two scans, report at 30000 ms, and unresolved scan/descendants. |
| `does not let a slow scan defer two-second escalation` | Retain no KILL at 1999 ms, KILL eligible at 2000 ms, exactly one KILL after 2001 ms, pending report/two scans until bound, and no delivery. |
| `keeps a late scan failure unknown without replacing the first error` | Retain first `PROVIDER_STREAM_EVENT_UNSUPPORTED`, scan settlement true after actual callback+close, descendants false and zero delivery. Exclude `synthetic ps failure`. |
| `rejects a foreign cleanup bound without replacing the first error` | Keep the foreign binding, reject shortening at 750 ms, return at 30000 ms and retain first failure/no delivery. |
| `rejects a malformed cleanup bound without replacing the first error` | Keep the string deadline, the same non-shortening and exact bound assertions; do not coerce it to a valid number. |
| `retains a readiness scan when a terminal event interrupts pre-input polling` | Retain one reused scan, TERM/KILL ordering, one owned scan stop and `processScansSettled:false`. |
| `does not claim parser settlement after the bounded parser wait expires (resolve)` | Keep the retained original parser link, `parsingSettled:false`, late resolution, sealed callbacks, no input writes/unhandled rejection/final/inference artifacts. |
| `does not claim parser settlement after the bounded parser wait expires (reject)` | Keep the distinct late rejection branch and all the same negative assertions; exclude `late parser failure`. |
| `guards a disappearing or failed input read (non-ENOENT)` | Replace only raw expected error with `DIAGNOSTIC_UNKNOWN`. Keep one file-open attempt, status failed, calls 0, cancellation null, inputDelivered false, closed/group/timers true, no write/inference receipt/`turn/start`. Preserve the other table rows' exact `PROVIDER_STREAM_EVENT_UNSUPPORTED` and `PROVIDER_INPUT_DEADLINE` expectations. |
| `reserves an unknown lost input acknowledgement through built workflow and journal` | Supply complete bounds. Retain calls `{probes:1,topic:0}`, exact `WRAPPER_INPUT_ACK_UNKNOWN`, zero proofs, `inferenceStarted:null`, actual wrapper closure and the null value in persisted JSONL. No refund or synthetic acknowledgement. |
| `records the wrapper stop identity actually used by its custody lane` | Supply complete bounds. Retain the attempt's context/binding and exact original `mutationRequestId` equality using `wrapper-stop:` plus sorted canonical binding. Assert one v2 `cancel-reserved` event with that binding; keep returned cancellation unknown rather than inventing a stop acknowledgement. |

- [ ] **Step 2: Pin version/privacy assertions at the actual boundaries.** Use the shared strict parser/constants, with source imports for the source-based files and `load("diagnostics")`/`load("wrapper-contract")` for `fix5`'s built consumers. Do not invent a second diagnostic schema or catch parser rejection as success.

For each native observation assert `version:1`, the matrix's exact code/classification, `origin:"native-read"`, `phase:"native-read"`, canonical `detail` equality and `Buffer.byteLength(observed.detail,"utf8") <= MAX_DIAGNOSTIC_SUMMARY_BYTES`. Keep the outer observation state assertion. Preserve the existing `private account` and `private` messages. Add `diag-integration-rpc-stack-10` and nested `diag-integration-rpc-extra-10` to the injected RPC error envelope; add `diag-integration-native-stack-10` and nested `diag-integration-native-extra-10` to the fix5 injected Error. Assert all these values absent from the complete public observations and surfaced error message/stack. Verify each canary is present in its injected input before asserting exclusion; never persist that raw exception input.

In shared `noDelivery`, retain every original field assertion and add `version:PROVIDER_REPORT_VERSION`, `status:"failed"`, strict `providerReportSchema.parse(r)`, strict summary version 1, code `PROVIDER_STREAM_EVENT_UNSUPPORTED`, classification `protocol`, origin `provider`, and `inputDelivery:"not_attempted"`. Expected first-failure phase is `initialization` for the interrupted-readiness case and `input` for the other eight rows; pass that expectation explicitly. Do not replace per-case process assertions with a generic all-settled helper. Add top-level `diag-integration-init-extra-10` and nested `diag-integration-init-nested-10` values to the existing held stand-in's otherwise valid init event, without changing its ordering. Confirm their presence in that event in memory. Strict-parse actual prepared v2 bytes, assert `initializationExtras:true` in both summaries, absent own `stdout`/`stderr` report keys, and no init/scan/parser canary in returned report or prepared bytes. Keep each case's readiness/settlement disposition.

For non-ENOENT, assert summary `{version:1,origin:"provider",phase:"input",code:"DIAGNOSTIC_UNKNOWN",classification:"unknown",inputDelivery:"not_attempted"}`, `omissions.exceptionText:true`, and positive exception/unknown-code counts. Preserve the injected `SYNTHETIC_INPUT_READ_FAILURE` message and `code:"EIO"`; add stack `diag-integration-input-stack-10` and nested value `diag-integration-input-extra-10` to that same Error. Capture `prepared.json` bytes inside the existing private deterministic helper **before its finally removes the root**; return that snapshot for assertions. Parse prepared v2 with the shared schema and preserve its readiness state independently. Assert the raw message, `EIO` and both added canaries are absent from report, prepared bytes and any public diagnostics captured by the case. Do not expect a `result.json` from the direct session API, which only returns a report.

Measure returned summaries' canonical UTF-8 bytes against 4096. Retain raw prepared/file/JSONL bytes for privacy inspection and actual emitted-summary byte-span checks at Task 7c; do not apply 4096 to an entire report or requested-result payload. Capture only credential-free test artifacts under the command's owned evidence root. Do not persist the raw injected exception as diagnostic evidence.

- [ ] **Step 3: Provide valid explicit journal bounds.** In each of the two tests use `freezeConfig(incidentRoster).hash` from the matching built `config` module. Construct these exact fields locally, sharing the lost-ack request's deadline and limits:

```ts
const bounds = {
  runId: "lost-ack", // "stop-journal" in the stop-identity case
  maxProbeCalls: 8, maxTopicCalls: 10,
  deadline: Date.now() + 30_000, workerTimeoutMs: 3000,
  proofTtlMs: 3_600_000, configHash: freezeConfig(incidentRoster).hash,
};
const journal = new PilotJournal(h.workspace, bounds.runId, bounds);
```

Use `bounds.deadline`, `bounds.workerTimeoutMs` and `bounds.proofTtlMs` in the lost-ack `runPilot` request, with its existing limits. Keep its injected lost-ack clock and fixture behavior. Before checking the scenario events, verify the first line's envelope version 2 and exact `bounds-recorded-before-inference` bounds with `owned:[]`. Assert every new line has version 2, all diagnostic objects pass the shared parser/byte cap, and no private canary survives. Never append to, rewrite, or relax validation for an old journal.

- [ ] **Step 4: Run covering GREEN under newly matched custody scope.** Replay the three RED test commands with the same selectors and budgets (60, 120 and 90 seconds), changing only the cleanup replay's artifact destination to the distinct exclusive `V/green-replay-cleanup`. Then run the unfiltered four-file covering command with its unchanged 180-second budget. Rebuild first if any compiled input changed; source production remains pinned. Requalify hashes/scope after test edits rather than silently reusing a pre-edit certificate.

Each attempt, including any separately declared retry, must use its own exclusively created evidence directory. Record its exact directory, `COUNCIL_TEST_ARTIFACTS` destination when used, argv and budget in `V/green-command-index.json` before launch; index the exact generated receipt/log paths and retain copies in that attempt's directory. Keep RED `V/red-cleanup`, cleanup GREEN replay `V/green-replay-cleanup`, and covering GREEN `V/green-cleanup` separate and never reuse them. Any declared retry requires a fresh exclusive directory and a new exact artifact destination when used, indexed before launch and covered by the custody qualification; keep its selector and budget unchanged. An existing or unsettled destination holds the attempt for reconciliation, without deletion or reuse. `recordCleanupArtifact` uses `wx` writes (`test/pilot/provider-cleanup-fixture.ts:17–21`); sharing a destination can mix attempt evidence, while an actual filename collision remains unproven. This requirement authorizes no retry or relaxation of the runtime custody holds.

```sh
B 60 npm test -- test/pilot/rpc.test.ts test/pilot/fix5-regressions.test.ts -t 'preserves sanitized structured RPC diagnostics|retains forbidden and method_not_found'
COUNCIL_TEST_ARTIFACTS="$PWD/$V/green-replay-cleanup" B 120 npm test -- test/pilot/provider-cleanup-bounds.test.ts test/pilot/provider-session-cleanup.test.ts
B 90 npm test -- test/pilot/fix5-regressions.test.ts test/pilot/context-diagnostics.test.ts -t 'reserves an unknown lost input acknowledgement|records the wrapper stop identity|accepts a bound v2 result'
COUNCIL_TEST_ARTIFACTS="$PWD/$V/green-cleanup" B 180 npm test -- test/pilot/rpc.test.ts test/pilot/fix5-regressions.test.ts test/pilot/provider-cleanup-bounds.test.ts test/pilot/provider-session-cleanup.test.ts
```

Expected GREEN: exit 0, all **128 existing identities** across these four files (63+19+29+17), all 14 historical failed identities and their later original assertions executed, new privacy checks passed, no unexplained skips/unhandled errors/watchdog intervention, and positive fixture/command settlement. Reconcile the actual `(file, full name, occurrence)` multiset; counts alone do not prove preservation. A remaining product/lifecycle failure holds integration; do not fix production under this four-file amendment.

- [ ] **Step 5: Freeze the four-file diff and evidence for coordinator integration.** Include original preimage hashes, final hashes, exact semantic mapping, actual RED/GREEN logs/receipts and custody disposition. Verify no source/config/shared fixture change and preserve both approved document hashes. No commit, merge, publication, or acceptance is performed by this author.

## Task 7c: Preserve the full original diagnostics and campaign gates

**Files/interfaces:** Consume all accepted Tasks 1–6 artifacts plus the four-file integration, strict v2 artifacts, validated result envelopes and native/context proofs. Produce a frozen whole-change packet and coordinator disposition. The following original gates remain mandatory; focused GREEN does not replace them.

- [ ] Qualify the actual build/typecheck and complete 20-file command scope, including its unchanged fixture allocations and detached descendants, before running it. A missing capability keeps this gate pending independently of four-file GREEN.
- [ ] Run `B 90 npm run typecheck`, then `B 60 npm run build`. Expected: exit 0 under strict TypeScript/exact optional properties, including asset copy; record source-to-dist freshness and settlement.
- [ ] Run the original full Task 7 selection unchanged:

```sh
B 300 npm test -- test/pilot/diagnostics.test.ts test/pilot/provider-diagnostics.test.ts test/pilot/wrapper-diagnostics.test.ts test/pilot/context-diagnostics.test.ts test/pilot/native-command.test.ts test/pilot/allowance.test.ts test/pilot/journal-diagnostics.test.ts test/pilot/workflow-diagnostics.test.ts test/pilot/cli-diagnostics.test.ts test/pilot/provider-session.test.ts test/pilot/provider-session-cleanup.test.ts test/pilot/provider-cleanup-bounds.test.ts test/pilot/context-cleanup.test.ts test/pilot/context-wrapper.test.ts test/pilot/workflow.test.ts test/pilot/journal.test.ts test/pilot/driver-deadlines.test.ts test/pilot/verify-proof.test.ts test/pilot/cache-composition.test.ts test/pilot/entry.test.ts
```

Expected: exit 0, complete selected identity coverage, no watchdog intervention or unresolved owned fixture. Preserve default file parallelism and existing per-test deadlines.

- [ ] Inspect actual normal, prepared-failure, fallback, active-cancellation and pre-input-cancellation artifacts, cancellation results, JSONL, saved outcomes, stdout and surfaced failures. Strict-parse every diagnostic; measure actual emitted UTF-8 summary spans at N−1/N/N+1 = 4095/4096/4097 with deterministic omission and multibyte coverage. Exclude all distinct original stdout/stderr/init/exception canaries, including both stderr chunks. Separately verify exact `requested-result-10-秘密` and the validated result larger than 4096 bytes survive intact. Retain `0600` files/`0700` directories, exclusive writes and actual compact outcome bytes before/after atomic replacement.
- [ ] Retain forged-binding, changed report bytes/native completion, missing/false parser/scan work facts, generic missing process state, denied inspection, uncertain close and duplicate-close rejection. Positive release closes exactly once; lost close replies are not retried. Attempted/unacknowledged input stays reserved; unknown cancel/release stays unresolved without proof or extra inference.
- [ ] Verify producer fingerprint drift invalidates affected qualification reuse without rewriting cached historical receipts. Verify assignment/packet/control/report/result/native-completion/private identity/cleanup hash bindings against actual final bytes.
- [ ] Freeze source/tests/config/build manifests, approved spec/original plan, this addendum, source map, identity matrix, measured RED/GREEN/custody evidence and prior task dispositions. Carry deferred Task 1 findings ASTRA-3, ARGON-F1, ROOT-Q1 and Task 2's recorded verification/sequencing qualifications into whole-change triage. Preserve the applicable Superpowers templates, verdicts, fix budgets and ledger.
- [ ] The coordinator obtains **fresh Astra Ultra and Argon high** reviews through qualified owned Orca routes against **identical frozen bytes**, in separate contexts with no exchanged findings before initial verdicts. Pin `gpt-6-astra`/`ultra` and `gemini-4-argon-high`/explicit `high` subject to actual policy/route controls; report unexposed backend values honestly. Astra supplements the independent cross-family seat. The coordinator resolves every material finding using source or decisive tests and settles owned review entries; this author dispatches neither seat. This whole-change pair is distinct from the addendum's pre-execution plan review.
- [ ] **After #8 integration and its custody/default-suite gates**, freeze the integrated candidate and declare two separate #10 default attempts, `V/default-01/` and `V/default-02/`, each `B 300 npm test`, with the runner's separate 10-second settlement allowance. Declare both before launch. Immediately bind each runner-generated `.started.json`, final `.json` and `.log` path to its predeclared `V/default-01/command-index.json` or `V/default-02/command-index.json`; retain any incomplete receipt. Both payloads are exactly `npm test`: no extra flags, reporter, environment override, pool/worker/timeout/isolation/order change. Use the actual configured defaults on identical frozen bytes. #8's separate three-attempt requirements remain its own gates; these two are not waived or assumed from that work.
- [ ] Require each default attempt's raw npm exit 0, complete expected executed identities, no unexplained skips/unhandled errors, no watchdog intervention, unchanged frozen inputs and positive settlement before starting the next. The #8 unchanged-suite outer capability is **not qualified now**; do not run either default attempt until actual whole-suite coverage/control is demonstrated and accepted. A failure, unknown exit or missing custody leaves campaign/whole-branch acceptance open. Preserve it as evidence rather than relabelling a partial run successful.

## Rollback and unresolved facts

Before any later test edit, keep the four exact preimages and a manifest of unrelated state. After stopping/joining only owned work, verify current test bytes equal the integration candidate being rolled back; concurrent changes hold restoration for reconciliation. The following future commands restore only the owned preimages, without changing Git history:

```sh
cp "$V/pre-edit/test/pilot/rpc.test.ts" test/pilot/rpc.test.ts
cp "$V/pre-edit/test/pilot/fix5-regressions.test.ts" test/pilot/fix5-regressions.test.ts
cp "$V/pre-edit/test/pilot/provider-cleanup-bounds.test.ts" test/pilot/provider-cleanup-bounds.test.ts
cp "$V/pre-edit/test/pilot/provider-session-cleanup.test.ts" test/pilot/provider-session-cleanup.test.ts
shasum -a 256 test/pilot/rpc.test.ts test/pilot/fix5-regressions.test.ts test/pilot/provider-cleanup-bounds.test.ts test/pilot/provider-session-cleanup.test.ts
```

Record exact restored hashes versus preimages, unchanged production/config/approved documents, retained failed receipts, and final owned-resource identities/settlement in `V/rollback.json`. Preserve uncertain roots/resources in explicit custody, with no broad deletion or process-name signals. Restoring tests does not establish build freshness or erase a failed run; invalidate mismatched generated-artifact evidence.

Unresolved at authoring: actual current RED/GREEN and built-output freshness; a qualified permitted custody method for each focused and broader command; complete default-suite coverage/control after #8; paired plan and whole-change verdicts; campaign acceptance. The known absent original runner path and limited replacement census are explicit dependencies, not a certified runtime remedy. Unexpected source/contract drift or a required new design/runtime route returns to the coordinator for a scoped decision; no such approval is inferred. No issue closure, merge, live qualification, or separate-project Council acceptance follows from this addendum.

## Five-part self-review

1. **Spec coverage:** This is fixture integration within Task 7; all original privacy/result/binding/lifecycle/whole-change/default gates remain.
2. **Step scan:** Current unchanged RED precedes edits; four paths, exact commands, all 14 identities, GREEN criteria and rollback evidence are specified. Custody is a prerequisite rather than an assumed outcome.
3. **Type consistency:** Summary v1, envelopes v2, direct native detail, seven-field bounds, built imports and wrapper-stop UUID derivation match current producers.
4. **Review focus:** Each of the five conditions above has an explicit owning step and assertion/evidence gate. Unknown product settlement remains distinct from completed fixture teardown.
5. **Proportion:** No production algorithm, new feature, shared fixture redesign, #8 correction, or runtime qualification is implemented here. The coordinator owns paired review and subsequent execution/integration.
