# Missing-custody diagnosis and parent timing witness implementation plan

> **For agentic workers:** Use superpowers:executing-plans for the subsequent authoring phase, subject to root disposition and independent review. Steps use checkboxes. This document-only round authorizes no implementation or helpers.

**Goal:** Specify a bounded parent-side timing witness that can narrow the native failure without changing execution behavior or acceptance.

**Architecture:** Collect parent observations in memory alongside existing operations. Freeze execution observations before independent cleanup, retain cleanup observations separately, and expose both through one `nativeTimingWitness` field in each parent-exit case result.

**Tech stack:** Python standard library, injected `unittest` fixtures, and the existing bootstrap evidence route.

**Spec:** `packet/fix-brief.md`, `packet/root-dispositions.json`, and the unchanged bootstrap contract at `a651f26cc096eb4dba7ba37799f55a1cfa49549f`.

## Global constraints

- Preserve fixture budgets of **1+1 seconds**, whole qualification/bootstrap budgets of **30+30 seconds**, and existing job deadlines.
- Preserve admission, ownership, refusal handling, fixture/control protocols, compared frame dictionaries, strict equality, qualification predicates, and all **65 existing pure test method bodies**.
- Preserve the original receipt byte-equivalent across cleanup. Keep existing wait strategy, late-frame handling, timeout classification, and drained-output behavior unchanged.
- Each complete serialized `nativeTimingWitness` must occupy **at most 4096 UTF-8 bytes**, including both phases, failure summaries, and omission metadata. Retain at most **32 records across both phases**, counting failure summaries.
- Preserve `OUTPUT_LIMIT = 1_048_576`, the **4096-byte** `command_diagnostic` limit, and `rawOutputOmitted: true`. Do not copy the witness into that compact projection.
- Add no writer, retry, fallback, sleep, process, syscall, or network action beyond existing operations and clock sampling.
- Keep child frame-emission time unknown. The exhausted old local 5/5 task remains closed; another hosted attempt, native acceptance, and product acceptance remain held.

## Review focus

- Pre-deadline availability during a blind wait versus observation at/after the deadline: both expired sends must still fail.
- Already-expired writer entry versus an on-time, nonwritable select reaching expiry: distinguish them without writing.
- Byte/record exhaustion across execution and cleanup: preserve bounded failure evidence and truthful omission counts.
- Refusal, collector failure, and duplicate/conflicting frames: preserve original errors, control routes, frame equality, and receipts.
- Partial startup and inherited execution allowance: expose unknowns and cumulative requested waits without inventing runtime timing.

---

**Diagnosis status: NEEDS_CONTEXT for the actual native timing cause. Document status: ready for the required scoped re-review before instrumentation authoring.**

I reread the complete canonical policy, writing-plans skill, and every declared fix-round packet file. Earlier unchanged source context was reused. No source edits, tests, imports, network requests, provider/account/permission operations, or helpers were used.

The bound run `42218319269`, attempt 1, failed qualification. Five cases matched; missing-custody did not; the remaining controller-cancellation cases did not run. Qualification exited 1 without a recorded signal, timeout, or refusal. Pure exit 0 and 65 passing methods do not qualify the bootstrap.

| Observation | detached-parent | missing-custody |
|---|---:|---:|
| Receipt status | passed | incomplete |
| Recorded command exit | 0 | null |
| Execution duration | 0.818178666 s | 0.993726291 s |
| Settlement duration | 0.233365334 s | 0.012131834 s |
| Independent owner closed | true | true |
| Original receipt unchanged | true | true |

The duration wording is corrected: `executionDuration` is `max(0, settlement_start - start)`. On this exception path, `settlement_start` is capped at `execution_end`; it is **not the exception timestamp** (`scripts/ci/offline.py:598–599,667`).

The root’s source-derived reconstruction places the clamped execution end at approximately `160.035480207` and inferred case start at `159.035480207`. The inferred allowance consumed before supervision is approximately **6.273709 ms**. The measured case-entry-stage-to-supervise-start interval is **7.247083 ms**. Case-entry is not case start, and neither interval times particular file/socket operations or proves scheduler delay.

The literal `private group control write deadline` exception originates at `test/ci/test_offline.py:2219`. **That failing invocation made no `os.write` call:** reaching lines 2215–2218 would instead return or raise another error. The diagnostic still cannot distinguish entry with an expired deadline from an on-time select remaining nonwritable until expiry.

Anchor RELEASE remains a qualified source inference:

- Frozen stdout includes `armed`, supporting completion of the GO transition.
- `work-ready` is stored before anchor RELEASE at `test/ci/test_offline.py:2595–2598`.
- Native output is drained before `_accept` completes, whereas the supervisor appends bytes only after `read_output` returns (`test/ci/test_offline.py:2442–2455,2618–2632`; `scripts/ci/offline.py:503–509`).

A failing RELEASE can therefore leave the work frame recorded while losing newly drained work stdout/stderr from the receipt. No captured call-site trace directly identifies the attempted role/event.

The intended missing-custody trigger requires observed command status 0 and `work-ready` (`test/ci/test_offline.py:2680–2683`). The actual receipt has command status null, both survival observations false, and no intentional missing-custody diagnostic. `matched: false` correctly preserves the stronger requirements at lines 3239–3249.

`NativeGroupIO.wait` requests empty-descriptor waits (`test/ci/test_offline.py:2380–2381`). Requested execution waits are at most **0.05 seconds per iteration**, and requests can accumulate across sequential handshake rounds. Not every frame requires a distinct wait; no measured 50 ms delay at every frame is established; actual scheduled wall time may overshoot. The supplied Python select facts support the readiness limitation, not a native causal conclusion.

The source also permits parsing and control progression before the normal post-read deadline transition (`scripts/ci/offline.py:481–527`). That explains the reachability of an expired send with `timedOut: false`, independently of why this run reached the deadline.

The custody and close-output diagnostics follow the first exception. Missing-custody deliberately reports the armed group unbound; exception settlement can stop without exhausting its budget (`test/ci/test_offline.py:2637–2647`; `scripts/ci/offline.py:614–644`). Independent `finish` subsequently closes retained resources without changing the frozen receipt (`test/ci/test_offline.py:2752–2774,2798–2806`). Its later frames and anchor exit −9 establish separate cleanup, not successful negative-case execution.

**F1 disposition:** Addressed below with fixed interfaces, schema, bounds, refusal/frame preservation, and an explicit behavioral RED/GREEN contract.

**F2 disposition:** Addressed by the corrected duration interpretation, separately qualified intervals, and cumulative requested-wait observations. Scheduler pressure remains unproved.

### Task 1: Add and verify the bounded parent timing witness

**Files:**

- Modify: `test/ci/test_offline.py`, at `PureTests`, `group_frame_write:2208`, `NativeGroupIO:2350`, `ParentExitController:2533`, and `run_parent_exit_case:2777`.
- Test: new methods in the existing `PureTests` class.
- Read-only references: `scripts/ci/offline.py`, `scripts/ci/offline-contract.json`, and `.github/workflows/council-goal-offline.yml`.
- Create no files and perform no unrelated restructuring.

**Proposed internal interfaces:**

- `_NativeTimingWitness(execution_end: float)`
- `_NativeTimingWitness.record(phase: str, observation: dict) -> None`
- `_NativeTimingWitness.record_failure(phase: str, summary: dict) -> None`
- `_NativeTimingWitness.freeze_execution() -> None`
- `_NativeTimingWitness.result() -> dict`
- `_NativeTimingWitness.unavailable(reason: str) -> dict`
- `group_frame_write(fd, message, end, *, witness=None, phase="execution", role=None, event=None)` — retain its existing three positional arguments and control behavior.
- `native_timing_observation(scenario: str) -> dict` — a new injected test helper returning the real case result and recorded fake-kernel effects.

All names above are proposals. Existing transports without a collector receive an explicit unavailable witness rather than requiring changes to existing fake transports or test bodies.

**Proposed witness schema:**

The top-level fields are fixed:

| Field | Value |
|---|---|
| `schemaVersion` | `1` |
| `available` | boolean |
| `unavailableReason` | null, `partial-startup`, `unsupported-transport`, or `collector-error` |
| `executionFrozen` | boolean |
| `childEmissionTime` | always null |
| `execution` | bounded execution block |
| `ownerCleanup` | bounded cleanup block |

Each phase block contains fixed fields: `events`, `lastFailure`, `seenEvents`, `droppedEvents`, `unknownObservations`, `countsSaturated`, `collectorFailed`, `waitCount`, `requestedWaitUs`, and `observedWaitUs`.

The execution block additionally contains `fixtureExecutionUs: 1000000`, `fixtureSettlementUs: 1000000`, and `preSuperviseRemainingUs`. Sample the last field immediately before calling `offline.supervise`; label it as a parent observation, not the supervisor’s exact internal start.

Allowed phase values are `execution` and `owner-cleanup`. Allowed record kinds are `send`, `select`, `write`, `read`, `frame`, `wait`, and `startup`. Roles are null, `command`, `anchor`, `work`, or `unknown`. Events are null, `ARM`, `GO`, `RELEASE`, `STOP`, the existing group output-event names, or `unknown`.

Record fields are fixed by kind:

| Kind | Observations |
|---|---|
| `send` | role/event, entry time, deadline, entry-expired boolean, encoded frame byte count |
| `select` | role/event, entry/return times, deadline, writability |
| `write` | role/event, attempt time, attempted/written byte counts, classified exception |
| `read` | observation time, read identifier, drained stdout/stderr byte counts |
| `frame` | read identifier, observed event/time, armed/released/stop-sent state |
| `wait` | entry/return times, requested and observed duration |
| `startup` | parent observation time and classified startup exception |

Use fixed exception classifications: null, `deadline`, `permission`, `would-block`, `broken-pipe`, `os-error`, `value`, `type`, or `other`. Never retain exception messages or class-name strings.

`lastFailure` is a fixed summary containing phase/kind/role/event, send entry/deadline, entry-expired state, select count and last select entry/return/writability, write-attempt count, frame/attempted/written bytes, and exception classification. Inapplicable or unavailable observations remain null.

**Bounds and retention:**

- Retain at most **23 execution events plus one execution failure summary**, and **7 cleanup events plus one cleanup failure summary**: at most **32 records total**.
- The complete serialized execution block is at most **2816 bytes**; cleanup block at most **1024 bytes**; fixed outer envelope at most **256 bytes**. Their sum is at most **4096 bytes**.
- Reserve **512 bytes inside each phase allocation** for its failure summary, including before a failure occurs. Evict oldest event records within that phase when required. Never evict its current failure summary.
- Count evicted/rejected events and superseded failure summaries in `droppedEvents`. Preserve counters when records are omitted.
- Counts use integers from 0 through `2_147_483_647`, saturating with `countsSaturated: true`.
- Encode times as integer microseconds relative to the original execution end, within ±`60_000_000`; durations and cumulative wait totals use 0 through `60_000_000`. Out-of-range, nonfinite, or unavailable observations become null and increment `unknownObservations`. These encoding limits do not assert a wall-time bound.
- Control byte counts are bounded by 4096; drained byte counts by the unchanged `OUTPUT_LIMIT`. Reject arbitrary fields and map unrecognized string values to fixed enums.
- Use the existing compact JSON encoding for byte accounting. Test the complete witness length, including summaries and metadata.

Execution counters, records, and failure summary become immutable at the original supervisor return. Cleanup uses its separate allocation and cannot evict or alter execution evidence. The result’s cleanup block may reflect subsequent existing final-settlement calls before aggregate serialization.

- [ ] **Step 1: Write the injected helper and all nine new tests.**

Use the real `run_parent_exit_case`, `ParentExitController`, `NativeGroupIO.send`, and `group_frame_write`. Do not substitute a deadline-ignoring send.

Inject every kernel effect: process construction/status/signals, pipes and descriptors, selectors, select/write/read, sockets, locks, exact-root filesystem operations, receipt emission, and all clocks. Patch `RealOps.monotonic` as well as module clock references. Explicitly replace the effects prohibited by `run_pure`; retain guards against any unexpected syscall.

The fake kernel schedules bound frames and responds to actual mocked control writes. Empty-descriptor waits advance the injected clock without waking on stream readiness. Additional diagnostic clock samples do not advance time.

Each new test first obtains a real returned case and asserts that `result.get("nativeTimingWitness")` is a dictionary. It must reach this assertion against unchanged source before accessing proposed interfaces.

| New test method | Required assertions |
|---|---|
| `test_native_timing_witness_records_predeadline_frame_delayed_by_blind_wait` | Work becomes available at 0.975 during the existing 0.950→1.000 blind wait. First observation and RELEASE entry occur at 1.000. Original failure remains; failing invocation has zero select/write attempts; entry-expired is true. |
| `test_native_timing_witness_records_first_observation_after_deadline` | Work first becomes available/observed at 1.001 after an injected scheduling overshoot. Failure remains; no write occurs; child emission time remains unknown. |
| `test_native_timing_witness_distinguishes_nonwritable_select_expiry` | RELEASE enters at 0.950 before end 1.000; select returns nonwritable at expiry. Entry-expired is false, select count is one, writability is false, and write attempts are zero. |
| `test_native_timing_witness_preserves_ontime_negative_case_and_snapshot` | An on-time handshake still reaches the existing intentional negative condition and existing matched result. Freeze execution before cleanup; its serialized bytes and original receipt remain unchanged through both existing finish opportunities. |
| `test_native_timing_witness_caps_both_phases_and_retains_failures` | Feed more than 32 observations, including identical accepted frames. Assert complete size ≤4096, record count ≤32, phase limits, retained failure summaries, and accurate omission counts after cleanup overflow. |
| `test_native_timing_witness_keeps_unknowns_and_does_not_mask_errors` | After the initial returned-witness assertion, exercise nonfinite/out-of-range diagnostic inputs, counter saturation, and collector failure. Assert nulls/counts and preservation of the original operation’s exception identity and outcome. |
| `test_native_timing_witness_preserves_frame_equality_and_control_bytes` | Identical frames remain accepted; conflicting duplicates remain rejected. Compared dictionaries and serialized control payloads remain unchanged; witness data never enters them. |
| `test_native_timing_witness_preserves_refusals_without_extra_io` | Inject control-write and receipt-route refusals. Assert existing refusal details remain, no retry/alternate route occurs, and no witness writer or extra non-clock operation appears. |
| `test_native_timing_witness_reports_partial_startup_unknown` | Cover retained partial Popen attachment and failure before collector availability. Preserve existing cleanup outcomes; unavailable evidence remains explicit unknown and never implies closure. |

For the first two schedules, fixture availability is known only to the injected test kernel. **Do not copy that knowledge into the production witness.** Parent observations alone may not distinguish early production from late production.

The snapshot test also injects **0.006 seconds** of pre-supervise elapsed time and checks an observed remaining allowance of **994000 μs**, plus cumulative requested/observed waits across multiple iterations. This is a synthetic assertion, not attribution of the native 6.273709 ms interval.

- [ ] **Step 2: Run the sole permitted future verification command for RED.**

`python3 -I -S -B test/ci/test_offline.py --pure --deadline-seconds 30`

Expected RED: the actual returned case lacks `nativeTimingWitness`. It must not fail first from imports, missing attributes, setup, or prohibited syscalls. Preserve all nine method names, selection, schedules, and assertions for GREEN.

- [ ] **Step 3: Implement only the proposed bounded collector and instrumentation.**

Initialize the collector before fallible native setup where possible. Keep diagnostic computations isolated: a collector error marks evidence unavailable/unknown and cannot replace or suppress an original exception.

Instrument existing send/select/write operations, native waits, drained reads, and observed frame handling. Add only clock sampling; do not add readiness probes or change arguments to existing operations.

Classify and re-raise original exceptions unchanged. Preserve refused routes and existing receipt/log refusal stops. Record zero write attempts for the literal deadline path; retain unknown written bytes when a write exception supplies no count.

- [ ] **Step 4: Integrate freeze and result publication.**

Freeze execution immediately after normal `offline.supervise` return, before independent `finish`. On an earlier startup exception, freeze available observations or publish the explicit unavailable form before cleanup.

Add exactly one `nativeTimingWitness` field to each parent-exit result. Keep cleanup observations separately labeled. Use the existing full case-evidence route and downloadable archive; add no protocol field, compact-summary copy, or alternate emission path.

- [ ] **Step 5: Repeat the identical verification command and assertions for GREEN.**

Expected GREEN: all **65 existing plus nine new methods** pass under the pure guard. Expired cases still fail, on-time outcomes remain unchanged, and witness assertions pass. No test becomes green by accepting late frames, increasing timeouts, changing timeout status, or repairing drained output.

- [ ] **Step 6: Return the frozen authoring evidence for root review.**

Return the focused change, actual RED/GREEN results, serialized cap examples, operation/refusal assertions, and unchanged-receipt/frame evidence. Root retains acceptance and any decision about subsequent native execution.

## Self-review and remaining unknowns

F1 is covered by fixed schema/interfaces, whole-object caps, failure retention, refusal/frame protection, and behavioral RED/GREEN tests. F2 is covered by corrected duration semantics, inherited-budget sampling, and cumulative requested/observed waits. All five review-focus conditions map to named tests. The plan changes one responsible file and introduces no causal correction.

The actual native send-entry/select timing, child frame-emission time, scheduling history, and final command exit value remain unknown. The prior run’s missing qualification receipt remains unexplained. Instrumentation itself does not establish native or product acceptance.

This document is ready for fresh Astra Ultra and Argon high scoped re-review before source authoring. No test was run in this document-only round.

COMPLETE_MISSING_CUSTODY_DIAGNOSIS_FIX1_b20e26a6cfb3a1c3