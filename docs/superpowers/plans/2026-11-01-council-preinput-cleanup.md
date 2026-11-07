# Council pre-input failure cleanup implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve issue #9 by starting bounded owned cleanup after a terminal pre-input failure without waiting for input.

**Architecture:** Keep lifecycle ownership in `runProviderSession()`. Add a terminal input gate, first-error latch, and bounded waits for parser and process-scan work. Require positive work-settlement facts before the wrapper transport can release an attempt.

**Tech Stack:** TypeScript, Node.js child processes, Vitest 5.0.5, existing native wrapper and context fixtures.

**Spec:** `docs/superpowers/specs/2026-11-01-council-provider-lifecycle-and-diagnostics-design.md`, SHA-256 `ff07db3e3ffcda082a329a10998448533993ff28bfcb8c1c4f9523b92459479a`. The exact issue #9 Agent Brief in `.superpowers/sdd/2026-10-31-council-issues-3-10/current-issues.json` also governs this plan.

## Global Constraints

- The baseline is `9aff16ceb97e9420ab346552c04405c38d2ffde8` on `dev/issue-1-first-use-reviewed`.
- The integration target remains `dev/council-implementation`.
- “The existing cleanup allowance remains at most 30 seconds.”
- “Under the full allowance, SIGKILL becomes eligible at approximately two seconds after cleanup starts.”
- “An earlier cancellation deadline must continue to shorten cleanup.”
- “Calls must remain zero when failure or cancellation occurs before any input mutation begins.”
- “A missing delivery acknowledgement must not prove zero calls or justify refunding a reservation.”
- “There must be no `inference-started.json` receipt when input was never attempted.”
- “Late input must not reopen a terminal attempt.”
- “Existing binding, agent identity, Deny, tool and read-boundary checks remain required.”
- “No timeout increase, blanket test serialization, skipped assertion or weakened acceptance criterion is permitted.”
- Keep issue #10 diagnostic projection, retention, schema migration, and historical evidence changes outside these tasks.
- Keep original exit code, signal, closure, group, descendant, timer, and exact terminal-identity evidence separate.
- This document authorizes no execution. The coordinator must obtain the concrete-plan approval before product edits.
- Use only offline stand-ins. No inference, qualification, network, GUI, account, permission, or global-setting change belongs to execution of these tasks.
- Each implementation task requires a fresh review gate. Whole-change acceptance requires the design's fresh Astra Ultra and Argon high reviews of identical frozen bytes.

## Review Focus

- A parser error and a later stderr overflow must retain the parser error; Task 1 tests the ordered sequence.
- A valid input file can arrive after failure or beside queued terminal data; Task 1 tests both orders for every protocol.
- A cancellation bound can arrive during a pending process scan; Task 2 tests deadline reduction during cleanup.
- Parser or scan work can remain unresolved at expiry; Task 2 tests bounded return and Task 3 rejects release.
- A lost input acknowledgement or terminal-close reply can cause an incorrect refund or duplicate action; Tasks 1 and 3 test these cases.

---

## Source facts and planned file boundaries

The inspected checkout matches the baseline. It has no `.codegraph/` directory. Source ranges below refer to this baseline.

`provider-session.ts:187-202` queues parser work and can overwrite an earlier error on overflow or UTF-8 failure. Lines 239-242 wait without checking that error, then open the input file. Lines 273-286 await scans and final parsing outside a complete bound.

`line()` at lines 95-185 is async but contains no awaited operation. A naturally indefinite parser cannot be produced with the current JSON fixture. Task 2 tests the shared bounded-wait primitive with an unresolved promise. Its producer test injects the primitive's deadline result through the real module boundary. No runtime parser hook is added.

`ContextWrapperTransport.cancel()` distinguishes acknowledged cancellation from `settled_unacknowledged`. `release()` verifies report binding, wrapper exit, native process state, terminal identity, and one close attempt. `workflow.ts:134-150` refunds only `inferenceStarted === false`.

| File | Responsibility and task |
| --- | --- |
| `src/pilot/provider-session.ts` | First failure, input gate, cleanup ownership; Tasks 1 and 2 |
| `src/pilot/provider-cleanup.ts` (new) | Bounded work observation and owned `ps` process; Task 2 |
| `src/pilot/context-driver.ts` | Require positive work facts before result acceptance and release; Task 3 |
| `src/pilot/host-wrapper.ts` | Carry work facts through fallback and completion gate; Task 3 |
| `test/pilot/provider-session-cleanup.test.ts` (new) | Real resistant-provider and input-order tests; Task 1 |
| `test/pilot/provider-cleanup-fixture.ts` (new) | Unique assignment, real-time waits, clock spy, owned teardown; Task 1 |
| `test/pilot/fixtures/provider-watchdog.cjs` (new) | Independent real-time emergency cleanup; Task 1 |
| `test/pilot/fixtures/agy-startup-provider.cjs` | Additional resistant modes without changing existing modes; Task 1 |
| `test/pilot/provider-cleanup-bounds.test.ts` (new) | Pending work, scan expiry, and cancellation bounds; Task 2 |
| `test/pilot/context-cleanup.test.ts` | Work-fact rejection, positive release, and duplicate-close protection; Task 3 |
| `test/pilot/workflow.test.ts` | Conservative reservation checks with the existing harness; Task 3 |

Read-only contracts: `src/pilot/wrapper-contract.ts`, `src/pilot/workflow.ts`, `src/pilot/types.ts`, and the existing provider, context-wrapper, and driver-deadline tests. No assignment-schema or call-budget change is planned.

## Test custody, time, and command budgets

All commands run from the repository root. The budgets below include a separate 10-second owned-settlement allowance. A command timeout is a failure. Retain its logs and exact owned identities. Never signal by process name or broad process search.

The command owner must run each listed command under its existing owned process watchdog. If that control is absent, use this stdlib-only command form with the command's listed budget. The fixture watchdogs remain independent of this command group.

```python
# Save as .superpowers/sdd/2026-10-31-council-issues-3-10/cleanup-execution/bounded-command.py
# Example: python3 .superpowers/sdd/2026-10-31-council-issues-3-10/cleanup-execution/bounded-command.py 60 npm test -- test/pilot/provider-session-cleanup.test.ts
import os, signal, subprocess, sys
p = subprocess.Popen(sys.argv[2:], start_new_session=True)
try:
    code = p.wait(timeout=int(sys.argv[1]))
except subprocess.TimeoutExpired:
    os.killpg(p.pid, signal.SIGKILL)
    try:
        p.wait(timeout=2)
    finally:
        # Detached fixture watchdogs have an eight-second real expiry.
        # The coordinator verifies their recorded close/cleanup evidence.
        pass
    raise SystemExit(124)
raise SystemExit(code)
```

Task 1 creates this exact execution note before its first command if no owned command watchdog exists. It remains untracked execution evidence. The execution note is a proposed task-owned runner, not an existing repository API. Do not run it during plan authoring. After timeout, verify detached watchdog settlement before another command. An exhausted settlement budget leaves the task unresolved.

Task 1 creates `cleanupFixture(mode, lifetimeMs)` with this test-only interface:

```ts
type CleanupMode = "resistant-post-ready-error" | "resistant-ready" |
  "resistant-sequence" | "close-before-input";
type SessionReport = Awaited<ReturnType<typeof runProviderSession>>;
interface CleanupFixture {
  assignment: WrapperAssignment;
  assignmentHash: string;
  directory: string;
  epoch: number;
  result: Promise<SessionReport>;
  signals: { pid: number; signal: NodeJS.Signals | 0; at: number }[];
  clock(at: number): void;
  waitFor(check: () => boolean, realBudgetMs: number): Promise<void>;
  tick(): Promise<void>;
  trace(): string;
  input(): void;
  cancel(deadline: number): void;
  command(name: "error" | "stderr" | "overflow" | "invalid-utf8"): void;
  watchdogFired(): boolean;
  finish(): Promise<void>;
}
export function cleanupFixture(mode: CleanupMode, lifetimeMs: number): Promise<CleanupFixture>;
```

These names are proposed test helpers. `result` starts the real two-argument `runProviderSession()` after the watchdog is armed.

Use `vi.spyOn(Date, "now").mockImplementation(() => clock)` in the test process. Keep real `setTimeout`, child I/O, `execFile` timeouts, and watchdog clocks. `tick()` waits 80 real milliseconds. `waitFor()` uses `performance.now()` and real 10-millisecond sleeps. It fails at its explicit budget. Restore each owned spy in `finish()`.

Record provider signal attempts with a pass-through spy on `process.kill`. Forward to the captured original function. A zero-signal probe is observation, not a stop. Only unit fault tests replace responses. No clock, shortened cleanup allowance, environment switch, or test hook is added to production.

Each real fixture has an eight-second real watchdog expiry. Readiness has 2,000 real milliseconds. Each later `waitFor` has at most 1,000 real milliseconds. Each test has a 10,000-millisecond Vitest limit. Tests do not run concurrently within this file. Default cross-file parallelism remains unchanged.

The new resistant modes emit valid initialization with `tools: []` and exact `council-packet` identity. They wait for `prepared.json` before terminal output. They ignore SIGTERM indefinitely, record `startup-stop`, and keep stdin/stdout/stderr open. They create one Node descendant in the same owned group. The descendant also ignores SIGTERM. A fixture manifest records the assignment hash, nonce, provider PID, descendant PID, and group.

Start `provider-watchdog.cjs` with `detached: true` as a separate child of the test harness. Its group is separate from both provider and test-command groups. A command-group kill must not disable fixture cleanup. Pass the exact directory, assignment hash, nonce, and parent PID. It must verify the initialization receipt and fixture manifest before any signal. Validate the provider's current group and the descendant relationship with bounded `ps` calls. Never adopt a conflicting or unverifiable PID. Its `ps` subprocess has a 500-millisecond bound.

The watchdog uses real timers and an IPC disarm handshake. On expiry, parent loss, or an explicit failure-cleanup request, it records emergency cleanup and kills only the verified owned provider group. It waits at most one further second for group/descendant absence. Any failed ownership or settlement check becomes an explicit failure. Successful tests assert `watchdogFired() === false` before teardown. They prove provider and descendant absence before disarm. `finish()` waits for watchdog close, clears owned timers, restores spies, and only then removes its unique temporary tree. Failed tests retain the emergency-cleanup classification. A watchdog kill never proves product cleanup.

### Task 1: Stop terminal pre-input waits and fix deadline classification

**Owner:** Sol Max implementer after concrete-plan approval.

**Prerequisites:** Approved plan and unchanged baseline for the first RED.

**Files:**
- Modify: `src/pilot/provider-session.ts:60-88,187-202,211-253,271-287`.
- Modify: `test/pilot/fixtures/agy-startup-provider.cjs:29-54`.
- Create: `test/pilot/provider-session-cleanup.test.ts`, `test/pilot/provider-cleanup-fixture.ts`, `test/pilot/fixtures/provider-watchdog.cjs`.
- Regress: `test/pilot/provider-session.test.ts`.
- Create if required: `.superpowers/sdd/2026-10-31-council-issues-3-10/cleanup-execution/bounded-command.py` as untracked execution evidence.

**Interfaces:**
- Consumes: `runProviderSession(a: WrapperAssignment, assignmentHash: string)` with its current inferred promise result, `readStrictFile()`, and existing assignment/recipe contracts.
- Produces: stable error `PROVIDER_INPUT_DEADLINE`, unchanged cancellation error `PROVIDER_INITIALIZATION_CANCELLED`, and unchanged report version `1`.
- Proposed private closures in `runProviderSession`: `recordFailure(code: string): void`, `observePreInputCancellation(): void`, `assertPreInputOpen(): void`, and `drainPreInputParsing(): Promise<void>`.
- `recordFailure` retains the first error and calls the idempotent owned-group stop. It never reserves input.
- `observePreInputCancellation` validates the binding and safe-integer deadline before reducing `cleanupBound`. It does not create a cancellation acknowledgement.

- [ ] **Step 1: Write the failing real-provider tests and their owned fixture.**

Create the fixture controls and watchdog described above. The primary RED supplies no input or cancellation, including during teardown. Its assignment lifetimes are 60,000 and 120,000 milliseconds. Error emission and cleanup start both occur at the frozen `epoch`.

```ts
it.each([60_000, 120_000])("cleans a resistant no-input failure at %i", async lifetime => {
  const h = await cleanupFixture("resistant-post-ready-error", lifetime);
  try {
    await h.waitFor(() => h.trace().includes("startup-stop"), 2_000);
    expect(existsSync(join(h.directory, "input.json"))).toBe(false);
    expect(existsSync(join(h.directory, "cancel.json"))).toBe(false);
    h.clock(h.epoch + 1_999); await h.tick();
    expect(h.signals.filter(s => s.signal === "SIGKILL")).toHaveLength(0);
    h.clock(h.epoch + 2_001);
    await h.waitFor(() => h.signals.some(s => s.signal === "SIGKILL"), 1_000);
    const r = await h.result;
    expect(r).toMatchObject({status:"failed", error:"PROVIDER_STREAM_EVENT_UNSUPPORTED", calls:0,
      cancellation:null, process:{inputDelivered:false, closed:true, groupSettled:true,
      trackedDescendantsSettled:true, timersSettled:true}});
    expect(h.signals.filter(s => s.signal === "SIGTERM")).toHaveLength(1);
    expect(h.signals.filter(s => s.signal === "SIGKILL")).toHaveLength(1);
    expect(h.signals.filter(s => s.signal !== 0).every(s => s.pid === -r.process.pid!)).toBe(true);
    expect(Date.now()).toBeLessThan(h.assignment.deadline);
    expect(Date.now() - h.epoch).toBeLessThanOrEqual(30_000);
    expect(h.trace()).not.toContain("user-input");
    expect(existsSync(join(h.directory,"inference-started.json"))).toBe(false);
    expect(existsSync(join(h.directory,"cancel-ack.json"))).toBe(false);
    expect(h.watchdogFired()).toBe(false);
  } finally { await h.finish(); }
}, 10_000);
```

The assertion on SIGKILL, positive settlement, and watchdog nonintervention proves entry into cleanup. SIGTERM alone is insufficient.

Add these exact named cases in the same file. Each case also applies the zero-input assertions above unless it explicitly attempts a write.

```ts
// "classifies absent input at its deadline": resistant-ready; advance to a.deadline,
// wait for TERM, then advance another 2_001 ms for escalation.
expect(r.error).toBe("PROVIDER_INPUT_DEADLINE");
expect(r.calls).toBe(0);
expect(r.process.inputDelivered).toBe(false);

// "classifies closure before input without opening a missing file": close-before-input.
expect(r.error).toBe("PROVIDER_INPUT_AUTHORITY_UNVERIFIED");
expect(r.error).not.toContain("ENOENT");

// "retains the first terminal error after later stream failures": resistant-sequence.
// Emit unsupported event; wait for TERM; then stderr, >1_048_576 bytes, invalid UTF-8.
expect(r.error).toBe("PROVIDER_STREAM_EVENT_UNSUPPORTED");
expect(r.calls).toBe(0);

// "keeps an earlier stderr failure at the input deadline": stderr first, then deadline.
expect(r.error).toBe("PROVIDER_STDERR_UNCLASSIFIED");
expect(r.error).not.toContain("ENOENT");

// "blocks late input after terminal failure": wait for TERM, then h.input().
expect(r.calls).toBe(0);
expect(r.process.inputDelivered).toBe(false);
expect(h.trace()).not.toContain("user-input");
expect(existsSync(join(h.directory,"inference-started.json"))).toBe(false);
```

Add `"drains queued terminal data before opening input"` for `agy-stream`, `codex-app-server`, and `cursor-stream`. Reuse the existing valid protocol setup from `provider-session.test.ts` and `context-fixture.ts`. The fixture puts valid readiness and an unsupported event into one stdout chunk. Input already exists. For Codex, emit this chunk after the valid `thread/start` response. For Cursor, preserve its verified bootstrap facts and emit terminal data before any input mutation. Capture file reads with a forwarding `readStrictFile` module spy.

```ts
expect(r.error).toBe("PROVIDER_STREAM_EVENT_UNSUPPORTED");
expect(r.calls).toBe(0);
expect(r.process.inputDelivered).toBe(false);
expect(openedFiles).not.toContain(join(directory,"input.json"));
expect(requests).not.toContain("turn/start");
expect(existsSync(join(directory,"inference-started.json"))).toBe(false);
```

For the Cursor ordering case, use a deterministic spawned-child stand-in whose queued stdout data is delivered while the readiness scan is pending. Do not rely on scheduling a real one-way CLI faster than its stdin write. This is an offline ordering test, not Cursor qualification.

Add `"keeps the reservation when an attempted input write fails"` with a deterministic child. Its `stdin.write` records the mutation, then invokes its callback with an error. Valid initialization and input authority precede that write. Preserve the first provider failure if one arrives during the write.

```ts
expect(inputWrites).toBe(1);
expect(r.calls).toBe(1);
expect(r.process.inputDelivered).toBe(false);
expect(existsSync(join(directory,"inference-started.json"))).toBe(false);
```

- [ ] **Step 2: Run RED against unchanged production.**

Run: `npm test -- test/pilot/provider-session-cleanup.test.ts` with a 60-second command budget.

Expected: behavioral failures for absent escalation before the future assignment deadline, incidental `ENOENT`, or replacement of the first error. A watchdog or Vitest timeout is fixture failure evidence, not the required behavioral RED. Record the failed assertion before owned emergency teardown. Do not edit production until that assertion is recorded.

- [ ] **Step 3: Implement the input gate and first-error latch.**

Implement the four private closures in `src/pilot/provider-session.ts`. First means the first terminal classification observed by the wrapper. Do not reorder failures by stream arrival estimates. Replace direct terminal error assignments in stdout, stderr, UTF-8, stdin, spawn, catch, and final parser paths with first-error semantics. Preserve existing error codes except the new missing-input result.

At each input poll, observe a valid cancellation bound. Check the recorded error, cancellation, child closure, and assignment deadline before another sleep. Drain the latest queued parser tail before opening input. Repeat the tail check if the parser promise changed. Apply this barrier to all three protocols.

After the barrier, perform the final terminal checks, file read, authority validation, and call reservation without an intervening await. A missing file at the deadline produces `PROVIDER_INPUT_DEADLINE`. Closure without an earlier error produces `PROVIDER_INPUT_AUTHORITY_UNVERIFIED`. A pre-existing terminal error remains first. A bound cancellation without an earlier error produces `PROVIDER_INITIALIZATION_CANCELLED`.

If the file disappears during the final read, classify only `ENOENT` as `PROVIDER_INPUT_DEADLINE` when the deadline has arrived. Before the deadline, return to the guarded wait. Preserve other artifact/authority failures. Never read again after terminal failure.

Keep `calls = 1` immediately before the first provider input mutation. Set `inputDelivered = true` and create `inference-started.json` only after the write acknowledgement. Do not refund failed or uncertain writes. Do not change active-turn cancellation acknowledgement conditions.

Task 2 replaces the temporary raw parser awaits with bounded observation. Task 1 is not whole-change acceptance.

- [ ] **Step 4: Run GREEN and the existing provider regressions.**

Run: `npm test -- test/pilot/provider-session-cleanup.test.ts test/pilot/provider-session.test.ts` with a 120-second command budget.

Expected: exit `0`; both future-lifetime cases finish while their assignment deadline remains open. Every real fixture settles without watchdog intervention. Existing admission, agent identity, queued errors, and in-flight reservation assertions pass unchanged.

- [ ] **Step 5: Commit the independently reviewable input-wait change.**

Run: `git add src/pilot/provider-session.ts test/pilot/provider-session-cleanup.test.ts test/pilot/provider-cleanup-fixture.ts test/pilot/fixtures/provider-watchdog.cjs test/pilot/fixtures/agy-startup-provider.cjs`.

Run: `git commit -m "fix: leave pre-input wait after terminal provider failure"`.

Each Git command has a 30-second budget. Review the exact staged paths before commit. Required review gates remain separate from commit success.

### Task 2: Bound parser and process inspection inside one cleanup interval

**Owner:** Sol Max implementer.

**Prerequisites:** Accepted Task 1 and its fixture custody evidence.

**Files:**
- Create: `src/pilot/provider-cleanup.ts`, `test/pilot/provider-cleanup-bounds.test.ts`.
- Modify: `src/pilot/provider-session.ts:17-18,69-88,187-210,215-286`.
- Reuse: `test/pilot/provider-cleanup-fixture.ts`.

**Interfaces:**
- Consumes: Task 1's error latch, input barrier, and owned fixture.
- Produces these proposed production helpers, with no test-only parameter:

```ts
export type ProviderWorkKind = "parsing" | "scan";
export type ProviderWorkResult<T> = { state:"settled"; value:T } |
  { state:"rejected"; reason:unknown } | { state:"deadline" };
export function waitForProviderWork<T>(kind: ProviderWorkKind, work: Promise<T>,
  deadline: () => number, poll: () => void,
  timers: Set<ReturnType<typeof setTimeout>>): Promise<ProviderWorkResult<T>>;
export interface OwnedProviderScan {
  result: Promise<string>;
  settled(): boolean; // callback/result and child close both observed
  stop(): void;      // idempotent SIGKILL to this owned ps child only
}
export function startProviderProcessScan(deadline: number): OwnedProviderScan;
```

- Produces additive booleans `report.process.parsingSettled` and `report.process.processScansSettled`. They state observed settlement, not whether a stop was requested. Task 3 adds their consumer gates.
- Proposed private closures: `observeCleanupCancellation(): void` and `pollCleanup(): void`.

- [ ] **Step 1: Write the bounded-work and deadline tests.**

For the first RED, write only the producer regressions against the existing session module. Do not import an uncreated helper. Start a held cleanup scan after a successful readiness scan. Advance the clock past the cleanup deadline. Assert bounded report availability with a separate 500-millisecond real assertion sentinel. Settle the held scan in `finally`.

After that behavioral RED, add these helper tests before implementing the helper behavior. Test one unresolved promise for each work kind. Keep real timers and control only `Date.now()`.

```ts
it.each(["parsing","scan"] as const)("bounds pending %s work", async kind => {
  let clock = epoch;
  const spy = vi.spyOn(Date,"now").mockImplementation(() => clock);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  try {
    const p = waitForProviderWork(kind, new Promise<never>(() => {}),
      () => epoch + 30_000, () => {}, timers);
    let returned = false;
    void p.then(() => { returned = true; });
    clock = epoch + 29_999;
    await new Promise(resolve => setTimeout(resolve,80));
    expect(returned).toBe(false);
    clock = epoch + 30_000;
    expect(await p).toEqual({state:"deadline"});
    expect(timers.size).toBe(0);
    expect(Date.now()-epoch).toBe(30_000);
  } finally { spy.mockRestore(); }
});
```

Add `"reduces a pending wait to an earlier cancellation bound"`. Start with `until = epoch + 30_000`. In `poll`, reduce it to `epoch + 750`. Advance the clock to that bound.

```ts
expect(await p).toEqual({state:"deadline"});
expect(Date.now()-epoch).toBe(750);
expect(timers.size).toBe(0);
```

Add producer tests with deterministic child/process-scan stand-ins. Add this parser fault case after the first behavioral RED and helper declaration. Mock only the imported production helper for the parser-expiry fault. For `kind === "parsing"` after the first terminal error, return `{state:"deadline"}` while retaining the unresolved work. Forward every other call to the real helper. Do not add a parser delay flag or export the private parser.

```ts
// "does not claim parser settlement after the bounded parser wait expires"
expect(r.error).toBe("PROVIDER_STREAM_EVENT_UNSUPPORTED");
expect(r.calls).toBe(0);
expect(r.process.parsingSettled).toBe(false);
expect(r.process.timersSettled).toBe(true);
expect(existsSync(join(directory,"inference-started.json"))).toBe(false);
// Resolve/reject the retained promise after the report. No new receipt or input is allowed.
expect(inputWrites).toBe(0);
expect(unhandledRejections).toEqual([]);
```

For scan faults, mock `node:child_process` with `vi.mock` and a forwarding default. Preserve `execFile`'s `promisify.custom` behavior for the pre-change RED. Its promise must return `{stdout, stderr}`, rather than the callback's first string. Return a controllable `execFile` child only for `ps`. Keep provider `spawn` real where the resistant fixture is used. The fake scan can withhold its callback and `close` separately. Register listeners before either event. Add a callback-before-close case. Assert `settled() === false` until close. A single late scan failure makes `processScanKnown` false for the report.

```ts
// "expires cleanup with a scan that never closes"
expect(scanOptions.timeout).toBeLessThanOrEqual(remainingAtScanStart);
expect(scanOptions.timeout).toBeLessThanOrEqual(2_000);
expect(scanOptions.maxBuffer).toBe(1_048_576);
expect(scanOptions.killSignal).toBe("SIGKILL");
expect(ownedScanStops).toBe(1);
expect(r.process.processScansSettled).toBe(false);
expect(r.process.trackedDescendantsSettled).toBe(false);
expect(r.error).toBe("PROVIDER_STREAM_EVENT_UNSUPPORTED");
expect(reportAt-cleanupStartedAt).toBeLessThanOrEqual(30_000);
expect(r.process.timersSettled).toBe(true);
// Initial behavioral RED observes the existing result promise, without new fields.
expect(reportObservedAtDeadline).toBe(true);
```

Add `"retains the full cleanup allowance while owned work remains pending"`. Keep a scan unresolved through 29,999 milliseconds. Assert that no report has returned. At 30,000 milliseconds, assert bounded report availability with false scan settlement. This prevents a shorter hidden cleanup allowance.

Add `"does not let a slow scan defer two-second escalation"`: begin a held scan before the kill threshold. Advance to 1,999, then 2,001 milliseconds. Assert no earlier SIGKILL and one later owned-group SIGKILL, even while `ps` remains pending.

Add `"shortens cleanup when cancellation arrives after the error"`: use the resistant fixture, wait for TERM, then write a bound cancellation with `epoch + 750`. Keep that request distinct from an active-turn acknowledgement.

```ts
expect(r.error).toBe("PROVIDER_STREAM_EVENT_UNSUPPORTED");
expect(r.cancellation).toBeNull();
expect(r.calls).toBe(0);
expect(existsSync(join(h.directory,"cancel-ack.json"))).toBe(false);
expect(reportAt-h.epoch).toBeLessThanOrEqual(750);
expect(h.watchdogFired()).toBe(false);
```

Add `"rejects a foreign or malformed cleanup bound without replacing the first error"`. Use a foreign binding and a string deadline in separate cases. Keep a scan pending until the full deadline.

```ts
expect(r.error).toBe("PROVIDER_STREAM_EVENT_UNSUPPORTED");
expect(r.cancellation).toBeNull();
expect(r.calls).toBe(0);
expect(reportAt-h.epoch).toBe(30_000);
```

Add `"keeps pre-input cancellation unacknowledged"` without a preceding error. Expect `PROVIDER_INITIALIZATION_CANCELLED`, zero calls, no input/inference receipt, no acknowledgement, and positive settlement under the 750-millisecond bound.

Each bounds-file test has a 10,000-millisecond test limit. A test owns at most one provider, one watchdog, and one scan at a time.

Add scan-table cases `"keeps escaped or unknown descendants unresolved"` and `"does not extend an expired cancellation bound"`. Inject ESRCH, EPERM, a child outside the group, and a child still live at expiry separately.

```ts
expect(r.process.trackedDescendantsSettled).toBe(false); // failed/unfinished scan or live descendant
expect(r.process.escapedDescendantObserved).toBe(true);  // escaped-row case only
expect(r.process.groupSettled).toBe(false);              // EPERM/unknown-group case
expect(providerStopTargets.every(pid => pid === -ownedProviderPid)).toBe(true);
expect(providerStopTargets).not.toContain(foreignPid);
expect(reportAt).toBeLessThanOrEqual(effectiveCleanupDeadline);
```

For the already-expired bound, check the deadline before awaiting anything. Preserve the initial TERM request. Return unresolved facts without an extra cleanup interval. Test this with stand-ins; do not leave a real resistant child for a deliberately expired product budget.

- [ ] **Step 2: Run RED before Task 2 production edits.**

Run: `npm test -- test/pilot/provider-cleanup-bounds.test.ts` with a 60-second command budget.

Expected: the existing awaited scan prevents the report from becoming available at the cleanup deadline. The 500-millisecond real sentinel exposes an explicit failed assertion. A missing module, collection failure, or Vitest timeout is not the required RED. Record this on the accepted Task 1 production, before any Task 2 production edit. The sentinel cannot supply settlement or change production deadlines. Settle all stand-ins in `finally`. Add the helper unit tests only after this behavioral RED is recorded.

- [ ] **Step 3: Implement bounded work observation and cleanup scheduling.**

Implement both production helpers in `src/pilot/provider-cleanup.ts`. `waitForProviderWork` attaches one fulfillment/rejection observer. Its real polling sleep is at most 20 milliseconds and never exceeds the remaining deadline. It calls `poll` between waits, including while work is pending. It rereads the effective deadline after each poll. It removes or clears every owned timer before return. A late rejection remains handled. Deadline return does not claim that work was cancelled or settled.

`startProviderProcessScan` uses `execFile("ps", ["-axo", "pid=,ppid=,pgid="], ...)`. Preserve the 1,048,576-byte output cap and ten-pass descendant walk. Set `timeout` to `min(2000, remaining)` and `killSignal` to `SIGKILL`. Do not start a scan with nonpositive remaining time. Retain the returned child until its result and close settle. Limit concurrency to one owned scan. A stop request without close leaves `settled()` false.

In `runProviderSession`, use the bounded observer for every parser barrier and every awaited scan, including startup scans, inference scans, final parser drain, and final decoder-tail parsing. Initialization reuses the existing `initializationDeadline`, including its 5,000-millisecond cap. Do not move or renew that cap. Input barriers use `a.deadline`. Active inference uses `a.deadline`. Cleanup uses the current effective cleanup deadline. No stage receives a fresh assignment or initialization interval. The pre-input poll exits on the first terminal error. On that exit, preserve outstanding scan ownership for cleanup. Do not abandon a running scan or start a second one.

Set `cleanupStartedAt` once. Use `cleanupDeadline = min(cleanupBound, cleanupStartedAt + 30000)`. `observeCleanupCancellation()` validates an existing bound request and can only reduce this deadline. A foreign or malformed request cannot shorten it or replace an earlier provider error.

Preserve the existing compressed thresholds explicitly:

```ts
termEligibleAt = Math.max(cleanupStartedAt, cleanupDeadline - 29_000);
killEligibleAt = Math.max(cleanupStartedAt, cleanupDeadline - 28_000);
```

A failure requests TERM immediately. Under the full allowance, KILL becomes eligible at 2,000 milliseconds. An earlier 750-millisecond bound makes KILL immediately eligible. Use `>=` at threshold checks. Both stop stages are idempotent. `pollCleanup()` checks cancellation, stop eligibility, and remaining time even while a parser or scan is pending.

At expiry, stop the owned scan once. Seal parser callbacks before detaching streams. Do not perform an unbounded await after the loop. A sealed callback cannot send input, mark a final turn, or write a receipt. On the no-error path, drain queued parsing and the final decoder tail before sealing. Preserve successful result validation. Snapshot actual parser, scan, stream-close, group, descendant, and timer facts. Keep `parsingSettled` false after a parser deadline result. Set `processScansSettled` true only after every owned scan result and close settles. Clear owned scan timers and listeners on settlement. An unresolved scan makes descendant settlement false. Unknown group probes remain unknown through a false `groupSettled` fact. Missing positive settlement retains or sets `PROVIDER_PROCESS_SETTLEMENT_UNVERIFIED`, subject to the first-error latch.

Do not clear a pending promise merely to report settlement. Do not turn `unref()`, pipe destruction, SIGKILL delivery, or elapsed time into positive close evidence.

- [ ] **Step 4: Run GREEN for bounds and provider controls.**

Run: `npm test -- test/pilot/provider-cleanup-bounds.test.ts test/pilot/provider-session-cleanup.test.ts test/pilot/provider-session.test.ts` with a 150-second command budget.

Expected: exit `0`; full allowance is 30,000 milliseconds, normal escalation eligibility is 2,000 milliseconds, and earlier bounds shorten both work and cleanup. Pending parser/scan results remain false settlement facts. The original first error and zero-input assertions survive.

- [ ] **Step 5: Commit the independently reviewable cleanup-bound change.**

Run: `git add src/pilot/provider-cleanup.ts src/pilot/provider-session.ts test/pilot/provider-cleanup-bounds.test.ts`.

Run: `git commit -m "fix: bound owned parsing and process scans during cleanup"`.

Each Git command has a 30-second budget. Task 3 must follow before whole-change acceptance.

### Task 3: Require work settlement and preserve exact release and accounting controls

**Owner:** Sol Max implementer.

**Prerequisites:** Accepted Task 2. Build before tests that import `dist/`.

**Files:**
- Modify: `src/pilot/context-driver.ts:40-64`, `src/pilot/host-wrapper.ts:32-44`.
- Modify: `test/pilot/context-cleanup.test.ts`, `test/pilot/workflow.test.ts`.
- Regress: `test/pilot/context-wrapper.test.ts`, `test/pilot/driver-deadlines.test.ts`.

**Interfaces:**
- Consumes: Task 2's `parsingSettled: boolean` and `processScansSettled: boolean` process facts.
- Preserves: `verifyContextResult(assignment: WrapperAssignment, command: Command)`, `ContextWrapperTransport.cancel(a: Attempt, deadline: number, mode?: "absolute-cleanup"): Promise<CancellationResult>`, and `release(a: Attempt, deadline?: number): Promise<boolean>`.
- Produces: rejection `WRAPPER_RESULT_UNBOUND` for missing/false work facts, no release proof for unknown settlement, and unchanged reservation semantics.
- Proposed test helper: `rewriteBoundReport(h: Awaited<ReturnType<typeof contextFixture>>, a: Attempt, patch: (report: any) => void): void`.

- [ ] **Step 1: Write the consumer and reservation regressions.**

Extend the existing context-cleanup fixture. `rewriteBoundReport` updates `result.json` and the matching native task's report hash/body so binding remains valid. It preserves the assignment, terminal identity, and unrelated state. Test a false fact and a missing fact separately. This avoids a false PASS caused by unrelated tamper rejection.

```ts
// "rejects a bound report with missing or false parser/scan settlement"
// Matrix: parsingSettled/processScansSettled x false/deleted.
await expect(verifyContextResult(assignment, h.command)).rejects.toThrow("WRAPPER_RESULT_UNBOUND");
expect((await driver.cancel(a, Date.now()+200,"absolute-cleanup")).state).toBe("unknown");
expect(await driver.release(a,Date.now()+200)).toBe(false);
expect(await driver.release(a,Date.now()+200)).toBe(false);
expect(driver.proof!(a)).toBeNull();
expect(closes).toBe(0);

// "releases a positively settled wrapper exactly once"
expect(await driver.release(a,Date.now()+1_000)).toBe(true);
const proof = driver.proof!(a);
expect(proof).not.toBeNull();
expect(await driver.release(a,Date.now()+1_000)).toBe(true);
expect(driver.proof!(a)).toEqual(proof);
expect(closes).toBe(1);
```

Use the existing uncertain-close case to retain these assertions:

```ts
expect(await driver.release(a,Date.now()+500)).toBe(false);
expect(await driver.release(a,Date.now()+500)).toBe(false);
expect(closes).toBe(1); // lost reply is never retried
expect(driver.proof!(a)).toBeNull();
```

Add `"does not acknowledge a settled pre-input failure as active cancellation"`. Construct a bound failed report with `calls:0`, `inputDelivered:false`, positive work/process facts, and `cancellation:null`. Update the native task outcome to `failed` with its correct report hash.

```ts
expect(await driver.cancel(a,Date.now()+1_000,"absolute-cleanup"))
  .toMatchObject({state:"settled_unacknowledged",error:"PROVIDER_STREAM_EVENT_UNSUPPORTED"});
expect(existsSync(join(a.context!.directory,"cancel-ack.json"))).toBe(false);
expect(await driver.release(a,Date.now()+1_000)).toBe(true);
expect(closes).toBe(1);
```

Add `"records positive no-provider work facts in the pre-spawn fallback"`. Give the Gemini recipe a source file with a deliberately mismatched digest. Keep transport bootstrap facts valid so the host wrapper performs the source check. No provider may start.

```ts
expect(report.error).toBe("PROVIDER_CONTROL_SOURCE_DRIFT");
expect(report.calls).toBe(0);
expect(report.process).toMatchObject({providerStarted:false, parsingSettled:true, processScansSettled:true});
expect(existsSync(join(a.context!.directory,"initialization-started.json"))).toBe(false);
expect(await driver.release(a,Date.now()+1_000)).toBe(true);
expect(closes).toBe(1);
```

In `workflow.test.ts`, use the existing `harness()` and real `runPilot()`. Override only `driver.launch` after obtaining its actual bound attempt. Return `launchVerified:false`, `controlError:"PROVIDER_STREAM_EVENT_UNSUPPORTED"`, and each explicit `inferenceStarted` value. Keep cleanup and release calls real within that harness.

```ts
// "refunds only a proven no-input launch"; table [false,0], [null,1], [true,1].
expect(out.calls).toEqual({probes: expectedCalls, topic:0});
expect(out.proofs).toEqual([]);
expect(out.status).toBe("failed");
expect(out.error).toBe("PROVIDER_STREAM_EVENT_UNSUPPORTED");
expect(launchSpy).toHaveBeenCalledTimes(1);
expect(h.calls.filter(c => c.argv[1] === "worker-stop")).toHaveLength(1);
expect(h.calls.filter(c => c.argv[1] === "worker-release")).toHaveLength(1);
```

All new context tests have a 15,000-millisecond test limit, matching the existing file. Use at most one real wrapper per case. All fixture teardown is awaited. Existing foreign-incarnation, connected, generic-missing, permission-denied, uncertain-close, forged-binding, and tampered-artifact cases remain unchanged.

- [ ] **Step 2: Build and record the consumer RED before production edits.**

Run: `npm run build` with a 60-second command budget.

Run: `npm test -- test/pilot/context-cleanup.test.ts -t "missing or false parser/scan settlement"` with a 90-second command budget.

Expected: the new validly bound negative work-fact reports are incorrectly accepted, so the explicit rejection assertion fails. A stale `dist/` module or unrelated hash failure is not this RED.

- [ ] **Step 3: Add the positive work-fact gates.**

In `verifyContextResult`, require `report.process.parsingSettled === true` and `report.process.processScansSettled === true`. Preserve all current binding, report-hash, dispatch, task, wrapper-exit, incarnation, native-process, and terminal-close checks.

In the host-wrapper fallback, set each new fact to `beforeSpawn`, matching the existing positive no-provider evidence. Unknown post-spawn failure keeps them false. Add both strict true checks to the completion-success predicate. Preserve raw error handling and all diagnostic fields for issue #10's separate plan.

Keep report version `1`: these are additive settlement facts under the existing producer fingerprint. Old reports without positive facts fail closed. `producerCodeHash()` already fingerprints all pilot source files. Do not adopt old qualification receipts or rewrite historical reports. No assignment schema changes are required.

- [ ] **Step 4: Run GREEN and the required targeted regressions.**

Run: `npm run build` with a 60-second command budget.

Run: `npm test -- test/pilot/context-cleanup.test.ts test/pilot/context-wrapper.test.ts test/pilot/workflow.test.ts test/pilot/driver-deadlines.test.ts` with a 240-second command budget.

Expected: exit `0`; exact release remains independent of provider completion. Positive release closes once. Unknown or uncertain release never creates a proof. Missing acknowledgements retain reservations. No new provider stop, inference, or topic call occurs during cleanup.

- [ ] **Step 5: Commit the independently reviewable consumer gates.**

Run: `git add src/pilot/context-driver.ts src/pilot/host-wrapper.ts test/pilot/context-cleanup.test.ts test/pilot/workflow.test.ts`.

Run: `git commit -m "fix: require settled provider work before wrapper release"`.

Each Git command has a 30-second budget.

## Issue #9 verification and campaign completion

These checks follow the three TDD tasks. They are acceptance checks, not separate implementation tasks.
The targeted checks and independent issue review establish the scoped #9 result.
The two default-suite runs remain mandatory campaign completion checks after the #8 correction and relevant producer integration.
They do not create a new prerequisite that prevents independent #9 or #10 work while #8 remains open.

- [ ] Run `npm run typecheck` with a 90-second command budget. Expected: exit `0`.
- [ ] Run `npm run build` with a 60-second command budget. Expected: exit `0`, including asset copy.
- [ ] Run `npm test -- test/pilot/provider-session.test.ts test/pilot/provider-session-cleanup.test.ts test/pilot/provider-cleanup-bounds.test.ts test/pilot/context-cleanup.test.ts test/pilot/context-wrapper.test.ts test/pilot/workflow.test.ts test/pilot/driver-deadlines.test.ts` with a 300-second command budget. Expected: exit `0` without altered test limits.
- [ ] Run `npm test` twice with a separate 300-second budget for each run. Expected: exit `0` with default parallelism.
- [ ] Retain any default-suite failure with its exact failing test and diagnostics. Existing issue #8 observations are not permission to skip or serialize tests. Leave whole-branch and goal acceptance open if these checks fail.
- [ ] Verify no fixture watchdog fired on passing cases. Verify every owned provider, observed descendant, scan child, watcher, stream, and timer has settled.
- [ ] Freeze source, tests, plan, and verification evidence. Obtain the required fresh independent reviews through the coordinator's qualified Orca routes.
- [ ] Record each finding and its disposition in the selected workflow ledger. Preserve its fix budgets and review verdicts.
- [ ] Integrate only the accepted issue #9 change. Keep remaining #3-#10 operational acceptance open.

## Five-part self-review

1. **Spec coverage:** Task 1 covers immediate cleanup, two future deadlines, missing-input classification, first error, queued/late input, zero calls, and attempted writes. Task 2 covers the full allowance, escalation, earlier cancellation, parsing, scans, groups, descendants, and timers. Task 3 covers cancellation meaning, exact release, duplicate close, fingerprints, and conservative workflow accounting. Issue #10 remains separate.
2. **Step scan:** Each task names files, signatures, assertion code, behavioral RED, implementation choices, GREEN commands, finite budgets, and a commit boundary. Fixture setup belongs to Task 1. Final suite checks do not claim another TDD deliverable.
3. **Type consistency:** Later tasks consume the exact `parsingSettled` and `processScansSettled` names from Task 2. Existing session, transport, assignment, and workflow signatures remain intact. New helper names are explicit proposals.
4. **Review focus:** All five conditions map to named tests. Real child tests prove actual group settlement. Stand-ins test unknown facts without claiming route qualification.
5. **Proportion:** The plan gives algorithms only where ordering, bounded observation, signal thresholds, and watchdog custody need exact decisions. Function bodies remain implementation work. Test code carries the required assertions. The added length records fixture custody, exact failure cases, and finite execution budgets.

## Execution readiness and language note

No unresolved source fact prevents these tasks from execution after concrete-plan approval. Test and build results remain unmeasured in this planning assignment. Cross-family review and user approval remain coordinator gates.

This is an STE Issue 9-oriented candidate. The official dictionary and governed project terminology are unavailable. General-word approval, approved meanings, parts of speech, and technical-term status remain unverified. Paths, commands, identifiers, values, error strings, protocol data, and the required header are protected literals. Full ASD-STE100 conformance is not claimed. See `authoring-notes.md` for source and language checks.
