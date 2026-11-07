# Native fixture descriptor-aware wait implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for this proposed ordinary Sol Max source task. Steps use checkboxes. The coordinator retains verification, fresh independent reviews, integration, and acceptance.

**Goal:** Make the native fixture owner wake for any registered output stream within one supplied wait allowance while preserving all protocol, receipt, deadline, refusal, and witness contracts.

**Architecture:** Change only `NativeGroupIO.wait` in runtime behavior. Gather every attached selector’s registered readable streams and perform one combined `select`. Retain a registration/select `PermissionError` on that IO instance so a later call propagates the same refusal without another observation. Extend the injected kernel and focused tests so the original wait fails a timely-progress assertion and the correction passes.

**Tech stack:** Existing Python standard library, selectors/select, unittest, and injected kernel/filesystem/clocks.

**Spec:** The supplied fix brief, root review dispositions, approved hosted design, and source-context index. This plan is proposed authoring scope; this document entry authorizes no implementation or execution.

## Global constraints

- Modify only `test/ci/test_offline.py`: `NativeGroupIO.wait`, necessary injected kernel helpers, and focused tests.
- Preserve all 65 pre-instrumentation test bodies and meaningful coverage from all nine instrumentation methods.
- Preserve `NativeGroupIO.__init__`, production controllers, startup/read/finish methods, frame/control writers, qualification predicates, receipts, source-binding interfaces, and deadlines.
- Preserve `1+1` fixture, `30+30` qualification, and `15/15/20` job bounds.
- Preserve the 4096-byte/32-record witness cap, 2816/1024-byte phase allocations, existing record limits, `childEmissionTime=null`, and original-supervisor freeze semantics.
- Preserve actual negative, cancellation, parent-exit, ownership, EOF, physical-cleanup, root, lock, port, and refusal predicates.
- No settlement edit, phase split, loader extraction, new control frame, or binding-protocol change.
- No timeout increase, serial workaround, native host fixture, Node/npm/Vitest/build, network, Git, provider/account/permission/settings operation, automatic retry, or breaker reset.
- Subsequent execution is limited to the approved pure command from the existing author-target mirror. Its absolute cwd is not supplied here; the coordinator must bind that existing mirror before execution.

## Review focus

- Readiness on any of four command/anchor stdout/stderr streams wakes one combined wait.
- Partial attachment includes only registered streams; unattached raw streams remain owned but unobserved.
- EOF remains readable until consumed/unregistered; immediate readiness cannot stall the fake clock.
- Absent/late readiness and nonwritable control remain negative under original ends.
- Observation errors retain identity and receive no automatic retry or fallback inside `wait`.
- A registration/select `PermissionError` remains retained across calls. The real supervisor may invoke `wait` again during exception settlement, but that invocation performs no new registration observation or kernel wait. Independent retained-custody cleanup remains unchanged.

### Task 1: correct the combined wait and prove its boundaries

**Files**

- Modify runtime behavior: `test/ci/test_offline.py:3260`, `NativeGroupIO.wait(self, seconds)`.
- Modify injected helpers: `native_timing_observation` at `:377` and necessary selector-interface support in `native_attachment_observation` at `:151`.
- Update intentionally affected instrumentation assertions; add four focused methods in `PureTests`.
- Create no files.

**Interfaces**

- Preserve `NativeGroupIO.wait(self, seconds)` and its existing return behavior.
- Consume selector registration maps containing keys with `fileobj` and `events`.
- Extend the test helper to `native_timing_observation(scenario, *, mode="missing-custody")`; existing calls keep their current mode.
- Expose helper-only kernel wait traces, ordinary-log attempt counts, and cleanup snapshots. Add no runtime witness fields.
- Add helper scenarios `"wait-refusal-map"` and `"wait-refusal-select"` for the existing named refusal test. Return the injected exception, the retained exception reference, physical observation traces, modeled child statuses, and the injected exception’s actual traceback sites. These are test-helper observations, not runtime instrumentation or wrappers around controller/supervisor methods.

- [ ] **Step 1: extend the injected kernel and write the timely-progress RED.**

  Keep `qualification_fixture → run_parent_exit_case → ParentExitController → NativeGroupIO` real. Do not replace or wrap their wait, start, read, or finish methods.

  Give injected selectors faithful registration maps: `register`, `unregister`, `get_map`, `select`, and `close`. Include `events`; return no map after closure. Use one shared readiness model for selector observations and combined `select`. Old empty-set waits must remain supported.

  Model the kernel as follows:

  - Queue bytes in stable time order. Reads consume at most their requested limit, retaining remainder.
  - Return queued readable data or EOF only for requested descriptors. A live empty pipe would block.
  - For a readable-set wait, return at the first eligible readiness time or the supplied end. Return all requested descriptors ready then.
  - For an empty set, advance to the supplied end.
  - Apply scheduled process termination/EOF before evaluating readiness, independently of whether its diagnostic frame has been consumed.
  - For already-readable positive-timeout calls, charge a declared synthetic cost of `min(0.001, timeout)` seconds. This makes unread persistent readiness advance simulated time. It is a test-model choice, not hosted timing evidence.
  - Permit zero-time observations; impose a finite guard of 4096 readiness operations per helper invocation so a model defect fails instead of hanging.
  - Preserve control-pipe writable behavior, including the nonwritable scenario’s deliberate expiry.

  For the two wait-refusal scenarios, inject a fresh `PermissionError(13, "injected wait refusal")` at the first `NativeGroupIO.wait` registration observation or combined kernel wait, respectively. Keep that physical route refusing on every attempted use; do not make the injection succeed automatically after its first refusal.

  The initial real read accepts `command-ready` and starts the anchor. Refuse the following wait before `anchor-ready` is consumed. Both retained command and anchor children remain live and unarmed. The unchanged supervisor’s exception settlement can therefore identify and signal its independently owned children and then invoke `wait` again.

  Extend the helper’s direct-signal kernel model only as required for these scenarios: accept `SIGTERM` for the retained command PID `61` and anchor PID `62`, record those effects, and schedule their termination at `now + 0.010`. Keep both statuses live until modeled time actually reaches that event. Preserve the existing partial-attachment signal behavior separately. Reject other targets, signals, or alternate signal routes.

  Neither a refused physical observation nor a cached rethrow advances the clock. Do not advance time merely to close the children, manufacture EOF, inject successful protocol frames, or suppress the supervisor’s second invocation. The resulting refusal case is expected to remain incomplete. Existing writable control/receipt effects remain available for their independently authorized purposes.

  Retain the work schedule at `0.975` for `"blind"`. Replace its defective-behavior test at `:654` with `test_native_wait_makes_timely_progress_for_predeadline_frame`, invoking:

  ```python
  observed = native_timing_observation("blind", mode="detached-parent")
  releases = [w for w in observed["writes"] if w[1] == "RELEASE"]
  self.assertTrue(
      len(releases) == 2 and all(w[2] < 1.0 for w in releases),
      "TIMELY PROGRESS: predeadline readiness must permit both RELEASE writes",
  )
  ```

  Then assert a passing receipt, command exit zero, matched qualification, owner closure, actual outlived/held-stream evidence, anchor `-SIGKILL`, unchanged original receipt, null child-emission time, and no execution failure summary.

  On the original wait, the required RED is the named **TIMELY PROGRESS** assertion: the frame waits until the deadline and release cannot complete. Missing `get_map`, unsupported readiness, setup/import errors, or a model operation-limit failure do not establish RED.

  Remove the helper’s existing `offline.supervise` and `ParentExitController.finish` wrappers. Retain owners through the existing `qualificationOwners` context list. Capture the first owner-cleanup snapshot from the injected clock/kernel boundary before its first effect, using the existing `timing_phase=="owner-cleanup"` marker. This permits the freeze assertion to observe an incorrectly late freeze without replacing `finish`.

  Use the real ordinary JSON writer with injected stdout descriptor, blocking-state calls, writable selection, and `os.write`. Separate attempted ordinary writes from completely delivered JSON records. A refused first write is one attempt and zero delivered records.

- [ ] **Step 2: run the approved command with the original wait body intact.**

  From the coordinator-bound existing author-target mirror:

  ```bash
  python3 -I -S -B test/ci/test_offline.py --pure --deadline-seconds 30
  ```

  Capture the exact source bytes/identity, command, actual exit, full output, and named assertion failure. The coordinator must verify that the original `NativeGroupIO.wait` body is unchanged in this RED snapshot.

- [ ] **Step 3: replace only `NativeGroupIO.wait` runtime behavior.**

  Before adding refusal retention, introduce the existing named refusal test described in Step 4 and capture its missing-retention regression. Use the descriptor-aware body below with only the cached-refusal guard and `PermissionError` storage omitted, equivalent to the previous report’s proposal. Run the same approved pure command and retain the specific **STICKY REFUSAL** failure showing that the unchanged real supervisor caused a second physical attempt. This is a separate, necessary regression capture; it does not replace the first timely-progress RED on the original wait. Setup errors, prevented cleanup, fabricated closure, or a suppressed second invocation do not establish this RED.

  Then use this complete replacement:

  ```python
  def wait(self, seconds):
      witness = getattr(self, "timing_witness", None)
      phase = getattr(self, "timing_phase", "execution")
      entry = _timing_now(witness)
      try:
          refusal = getattr(self, "_wait_refusal", None)
          if refusal is not None:
              raise refusal
          wait_end = time.monotonic() + seconds
          readers = []
          for handle in self.handles:
              selector = handle["selector"]
              if selector is None:
                  continue
              registered = selector.get_map()
              if registered is None:
                  continue
              readers.extend(
                  key.fileobj for key in registered.values()
                  if key.events & selectors.EVENT_READ
              )
          remaining = min(seconds, max(0.0, wait_end - time.monotonic()))
          select.select(readers, [], [], remaining)
      except Exception as exc:
          if isinstance(exc, PermissionError):
              self._wait_refusal = exc
          _timing_call(witness, "record_failure", phase,
                       {"kind": "wait", "exception": _timing_exception(exc)})
          raise
      finally:
          returned = _timing_now(witness)
          _timing_call(
              witness, "record", phase,
              {"kind": "wait", "entry": entry, "return": returned,
               "requested": seconds,
               "observedDuration": None if entry is None or returned is None
               else returned - entry},
          )
  ```

  This makes exactly one kernel wait across all registered readable outputs on an invocation without a retained refusal. Descriptor collection consumes the supplied allowance; the selected timeout cannot exceed it. OS scheduling can still delay actual return, so callers’ existing monotonic checks remain authoritative.

  An empty registration set naturally produces one empty-set timed wait. A selector factory failure leaves `None` and contributes no descriptors. Partial registration contributes only established registrations. `RealOps.read_output` consumes EOF, unregisters, closes, and removes streams (`scripts/ci/offline.py:820`); the next wait sees the updated maps.

  Registration-map or select errors propagate through the existing failure accounting with their original exception. A `PermissionError` is stored lazily on this IO instance; `NativeGroupIO.__init__` remains unchanged. Every later invocation raises that same object before collecting registrations or calling `select`, even if the handles or registrations subsequently change. There is no alternate observation, retry, fallback, or fresh wait allowance after the retained refusal.

  Ordinary non-permission exceptions are not made sticky. They retain their existing propagation behavior and receive no automatic retry within an invocation.

  The existing witness failure and `finally` accounting still runs for each invocation, including a cached rethrow. Consequently two supervisor wait invocations can produce two witness wait records while corresponding to only one refused physical observation. Do not alter the witness schema or redefine its execution block to hide that distinction.

  Refusal retention does not mark control or signal routes refused, populate finalization refusal state, or alter supervisor/controller cleanup decisions. The supervisor retains receipt refusal evidence through its existing error handling. Its independently authorized cleanup remains unchanged.

  Newly spawned anchor streams enter the following wait’s combined map. Cancellation sampling and execution/settlement transitions remain in the unchanged supervisor/controller; the wait creates no new budget.

- [ ] **Step 4: complete focused coverage and reconcile intentional expectations.**

  Add these four methods, introducing the refusal method before retention as required in Step 3:

  | Method | Required assertions |
  |---|---|
  | `test_native_wait_wakes_for_each_registered_output_stream_under_one_allowance` | Four subcases schedule an ordinary data line on FD 51, 52, 53, or 54 at `0.125`, before work at `0.150`. Through the real fixture path, each wakes at `0.125`; the combined read set contains all four active outputs, with one timeout allowance and no sequential blocking selector waits. |
  | `test_native_wait_uses_registered_streams_and_times_empty_sets` | Exercise the real wait with absent, empty, closed, and partially registered injected selectors. Exclude unregistered raw streams. Empty sets consume one timeout. A simulated 7 ms map-observation cost leaves at most 43 ms of an original 50 ms allowance. |
  | `test_native_wait_propagates_observation_errors_without_retry` | Cover direct method errors at both registration and select boundaries, plus `"wait-refusal-map"` and `"wait-refusal-select"` through the real fixture/supervisor route. Prove exact exception identity, retention across calls, one refused physical attempt across supervisor exception settlement, retained receipt refusals, independently authorized cleanup, and no fallback. Detailed assertions follow below. |
  | `test_native_wait_absent_readiness_stays_negative_at_original_bounds` | Schedule no work readiness after GO in detached-parent mode. Require timeout/nonpass, incomplete qualification, no credited parent-exit boundary, and simulated completion within the original two-second cap. Do not require successful cleanup where its predicates remain unproven. |

  Extend the named refusal method with direct subcases:

  - Use fresh IO instances and fresh exact exception objects for each boundary.
  - For `PermissionError` from `get_map`, catch the same object on both explicit calls. Require one registration attempt total and zero kernel waits across both calls.
  - For `PermissionError` from combined `select`, catch the same object on both explicit calls. Require one failed combined wait total, with no additional registration queries on the later call.
  - Assert `io._wait_refusal is injected_exception`; changing the available registration set after the first refusal must not reopen observation.
  - Preserve direct non-permission observation-error coverage at both boundaries: the original object propagates, no alternate observation occurs within the failed call, and no permission-refusal state is created. A separately requested later invocation may observe normally after the test removes that ordinary error.
  - Preserve witness failure classification and per-invocation accounting, including the cached rethrow.

  For the real-path subcases, use:

  ```python
  observed = native_timing_observation(
      "wait-refusal-" + boundary, mode="detached-parent"
  )
  ```

  The helper must return these test-only values:

  - `waitRefusal`: the fresh injected `PermissionError`.
  - `retainedWaitRefusal`: `getattr(io, "_wait_refusal", None)`.
  - `waitRefusedAttempts`: the physical attempts at the selected refusing boundary.
  - Registration-query and combined-wait traces, including a separate list of any observation attempts after the first refusal.
  - Actual modeled child statuses and the independent direct-signal effects.
  - `waitRefusalTraceback`: `(frame.f_code, traceback_line)` pairs from that injected exception’s actual traceback, collected without wrapping `wait`, `offline.supervise`, or controller methods.

  First require:

  ```python
  self.assertEqual(
      len(observed["waitRefusedAttempts"]), 1,
      "STICKY REFUSAL: one physical attempt across supervisor settlement",
  )
  self.assertIs(observed["retainedWaitRefusal"], observed["waitRefusal"])
  ```

  Also require all of the following concrete evidence:

  - Both command and anchor were actually spawned and registered before the first refusal. Their modeled statuses remain live through the refused execution wait, independently authorized TERM actions, and the subsequent cached rethrow.
  - The exact injected exception’s traceback contains two `NativeGroupIO.wait` frames at distinct raise/call sites, two `ParentExitController.wait` frames, and two `offline.supervise` sites corresponding to execution and exception-settlement waiting. Together with the retained-object identity, this proves propagation of the same object through the actual second invocation.
  - For the map-refusal case, there is exactly one `get_map` attempt and zero combined kernel waits. For the select-refusal case, the two active selector maps are collected once and exactly one combined kernel wait is attempted.
  - There are no registration queries, readable/empty-set kernel waits, positive-time selector waits, or alternate output observations after the first refusal. Writable effects for independent cleanup or receipt delivery are counted separately.
  - The unchanged exception-settlement path attempts TERM only for the two retained unarmed children. There is no group signal, KILL escalation, STOP, ARM, GO, RELEASE, or alternate target. These independent cleanup attempts must occur; a test that avoids them does not cover the required path.
  - The receipt contains refusal items for both `observation-or-spawn` and `settlement-wait`, each with target `None`, the injected exception’s diagnostic, and errno `13`.
  - The receipt is incomplete/nonpassing, qualification does not match, `ownerClosed` is false, child/anchor exit remains unknown, and resources remain incomplete. Do not claim EOF or physical closure.
  - With writable ordinary output and the original remaining budget, receipt delivery remains available. Preserve the actual original receipt comparison and immutability across both owner finishes.
  - Witness evidence retains the wait refusal and two wait-invocation records without changing caps, failure semantics, phase attribution, or freeze behavior.

  Before retention is installed, the permanently refusing kernel must expose the second physical attempt and fail the named **STICKY REFUSAL** assertion. After retention, the supervisor still invokes `wait` twice, but the physical count is one. Keep these subcases inside the existing named method; they add no test methods and preserve the planned total of 78.

  Account for all nine existing instrumentation methods explicitly:

  | Original location | Coverage disposition |
  |---|---|
  | `:654`, blind delay | Replace with the timely-progress test above. The old assertion deliberately encoded the defect. Preserve the rename/mapping in the author’s result. |
  | `:676`, late observation | Keep work at `1.001`. Make its explicit overshoot trigger when a wait reaches the execution end, rather than depending on the old `.95` entry. Preserve expired-entry failure, zero release attempts, and negative outcome. |
  | `:691`, nonwritable | Keep work at `.950` and one unwritable RELEASE selection ending at `1.0`. Preserve entry `−50000 µs`, one select, zero writes, and failure. |
  | `:704`, snapshot | Preserve `994000 µs` pre-supervision remainder, first-cleanup freeze, execution byte equality through both finishes, actual first-receipt immutability, and exact receipt bytes across the second finish. Replace the blind-wait count with agreement against captured kernel waits. Under the specified model, expect six execution waits, `300000 µs` requested and `145000 µs` observed. |
  | `:747`, caps/failures | Preserve cap, failure retention, saturation/count, and frozen-execution checks. |
  | `:781`, unknowns/errors | Preserve the body and its original exception/unknown-accounting coverage. |
  | `:898`, frame equality | Preserve control-byte equality, duplicate handling, and conflicting-frame rejection. |
  | `:924`, refusals | Preserve one refused control attempt, no STOP/alternate route, receipt refusal, and unknown-byte counts. Count one refused ordinary-write attempt separately from zero delivered JSON records. |
  | `:945`, partial startup | Preserve retained child ownership, negative qualification, unavailable startup evidence, original error, cleanup behavior, and null child-emission time. Use truthful first-receipt immutability and before/after-second-finish snapshots. |

  The first-receipt check must continue asserting `run_parent_exit_case`’s comparison against its actual saved supervisor receipt (`test/ci/test_offline.py:3749`). Do not label a snapshot taken after first cleanup as a pre-cleanup receipt.

  Keep the 65 older test bodies byte-identical, including the post-spawn custody and separate partial-channel tests at `:1486` and `:1501`.

- [ ] **Step 5: run GREEN once and return frozen evidence for review.**

  Run the same approved pure command from the same bound mirror. With the replaced method and four added methods, the planned total is 78 tests. Require actual exit zero, the full successful test output, the timely-progress assertions, all negative/refusal checks, and the unchanged invariants.

  A failed GREEN requires diagnosis within the task’s applicable fix budget; it does not authorize automatic retries or native workloads.

  The coordinator’s static covering check must establish:

  - Runtime behavior changed only in `NativeGroupIO.wait`.
  - Refusal storage is lazy within `wait`; `NativeGroupIO.__init__`, supervisor, controllers, startup/read/finish methods, and writers remain unchanged.
  - The first registration/select `PermissionError` and every cached propagation retain the same exception identity; later calls reach no registration observation or kernel wait.
  - The real supervisor exception-settlement regression includes independent cleanup and an actual second wait invocation; it neither fabricates closure nor suppresses the invocation.
  - All 65 older test bodies remain unchanged.
  - Every change to the nine instrumentation methods has the recorded reason and retained coverage above.
  - Controllers, startup/read/finish methods, writers, qualification gates, receipts, bindings, budgets, and witness schema/allocation/freeze code remain unchanged.
  - The fixture path is real; injected replacements are confined to kernel/filesystem/clocks and output effects.
  - RED failed on timely progress with the original wait; the separate sticky-refusal RED demonstrated repeated physical observation before retention; GREEN passed at the frozen corrected source.

  Return the exact change, both RED outputs and identities, GREEN output and identity, actual test count/status, static preservation results, and remaining unknowns. Root supplies fresh scoped Astra Ultra and Argon high reviews and resolves their findings. No commit, push, or hosted execution is part of this source task.

The plan’s scope is one cohesive wait correction. Additional startup instrumentation is conditional on a specific unresolved question after its reviewed hosted result. Final-cleanup observability, terminal-negative settlement, receipt finalization, and loader extraction retain separate evidence and review requirements.

A later accepted source may receive **one separately tracked, already-authorized hosted attempt** after fresh paired code review and root verification. This entry launches none. Pure GREEN would establish source behavior under the injected kernel; it would not establish the cause or resolution of the hosted startup failure.

The former local 5/5 breaker remains closed. Bootstrap/product holds remain intact. The complete goal remains reviewed fixes for issues #3–#10 merged into `dev/council-implementation`, all eight issues closed with evidence, and parent #1 real second-project acceptance. Required typecheck/build, unchanged seven-file C12 validation, three consecutive default-suite passes, default concurrency, all 11 discovery rows, zero-input accounting, fixture cleanup, and separate #1/#7 live gates remain required. Skips, expected RED, VM disposal, and bootstrap qualification cannot replace them.
