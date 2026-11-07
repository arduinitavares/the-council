# Council parallel test fixtures implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the demonstrated discovery matrix environment overwrite and prove reliable completion of ordinary offline `npm test`.

**Architecture:** One matrix owner controls fixture allocation, environment, one native connection, original case promises, and cleanup. Each row retains real synthetic CLI commands and `LocalReadRpc`. A strict `ProviderRead` supplies fixed test data through the existing constructor seam.

**Tech Stack:** Node.js `22.23.4`, TypeScript `7.0.2`, Vitest `5.0.5`, existing Node filesystem/process APIs. Add no dependency.

**Spec:** [Approved design](../specs/2026-11-01-council-parallel-test-fixture-design.md), SHA-256 `74357031062201ee06cbb2085589e016d2dcf34f62b5ee3775ea17413aed195c`. The supplied current #8 Agent Brief is `.superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue8-plan-author-20261103/issue-8-brief.txt`.

## Global constraints

- Execution cwd is `/Users/aaat/.codex/worktrees/council-first-use/the-council`.
- Baseline is `3f3c3cdf63130d4aa27037c8f0d42ed5fd36dd8b` on `dev/issue-1-first-use-reviewed`.
- Read `/Users/aaat/.agents/policies/model-policy.md` before execution or delegation decisions.
- Preserve every original assertion, all eleven version inputs, capability and readiness rejection, canonical policy checks, and the zero-inference boundary.
- Preserve default file concurrency and existing timeouts.
- Do not add skips, installed-provider requirements, credentials, suite serialization, or production admission exceptions.
- Cache, wrapper, relay, and cleanup failures remain within #8 until reliable default-suite completion is proved.
- Keep `src/pilot/discovery.ts`, `src/pilot/native-command.ts`, `src/pilot/provider-read.ts`, `src/pilot/rpc.ts`, `src/orca/client.ts`, `QualificationCache`, and `vitest.config.ts` unchanged.
- Keep package manifests, lockfiles, production code, runner defaults, and global settings unchanged.
- This authoring assignment permits only this plan and its task-owned evidence. Every execution checkbox below is future work.
- Root owns independent Astra/Argon plan review, review disposition, publication, and execution authorization. Author self-review does not fill either review seat.

## Review focus

- A timed-out observer leaves its original body running. Task 3 checks the next case before policy comparison.
- Setup fails after allocation or while connection is pending. Task 4 checks exact root custody and environment restoration.
- Cancellation occurs during a native await. Task 4 checks post-await cancellation without claiming immediate child termination.
- Inspection catches every provider seam error. Task 5 checks that case and owner verification still fail.
- A drain deadline expires or native closure is uncertain. Tasks 1 and 4 check retention and positive outer settlement.

## Evidence, scope, and readiness

The checked-out baseline and branch match the assignment. Retained runtime collection contains **1,573 occurrences across 76 files**, including all 13 discovery cases. It has 1,568 distinct `(file, name)` keys and four repeated-key groups. Static listing produced only 754 rows. Collection is not test execution. The historical **67 files / 1,227 tests** describe the earlier revision.

The approved design still contains its earlier proposed-status wording. The progress record at lines 711 and 745 records approval of these exact design bytes and scoped Task 6 acceptance. Those records do not establish whole #10 integration or #8 completion.

Retained evidence root `E` is `.superpowers/sdd/2026-10-31-council-issues-3-10`. The 450-event trace `E/parallel-phase-trace/phase-trace-full-workload.jsonl` has SHA-256 `9f73224f0ea561708ece21701bd4542c64bf5add3b7b3c1d6cc4d07d6c7453ef`. Events 23, 26–31, 43–44, and 57 show abort, next-case setup, late continuation, HOME restoration, and policy mismatch. Events 128–162 repeat that sequence. Guards changed subsequent provider behavior. Initial latency and other suites' causes remain unproved.

The relevant matrix, fixture, inspector, provider reader, client, and runner configuration have no diff from traced revision `9aff16ceb97e9420ab346552c04405c38d2ffde8`. Other diagnostics code and tests have changed. Historical results therefore remain separate:

| Evidence | Result and limit |
| --- | --- |
| `E/offline-discovery/focused-discovery-20261101/receipt.json` | Isolated 13/13 pass, exit 0, 16.726 seconds. |
| `E/offline-discovery/focused-four-suites-20261101/receipt.json` | Completed diagnostic, exit 1. Fourth file is `host-relay.test.ts`. |
| `E/offline-discovery/phase-traced-four-suites-20261101/receipt.json` | Guarded diagnostic, exit 0, 32.878 seconds. |
| `E/offline-discovery/phase-traced-full-workload-20261101/receipt.json` | Partial workload, 180-second watchdog, exit -15. No final suite report. |
| `.superpowers/sdd/issue8-default-baseline-dxpmrzd3/baseline.md` | At `39db913`, 33 reported failures across ten files. EPERM prevented the final receipt. npm exit, watchdog outcome, and settlement remain unknown. |

The progress record at lines 695–709 compares those 33 cases. Nineteen passed in isolated controls: eleven discovery, four provider diagnostics, one context diagnostics, and three composition/cleanup cases. Fourteen persisted: two RPC shape assertions, nine cleanup report versions, one raw synthetic error expectation, and two journal fixtures with missing bounds. Selection and concurrency both changed. This comparison establishes neither a shared cause nor broad settlement.

The fourteen diagnostics migration expectations belong to reviewed **#10 integration**. This plan does not edit them. Their semantic assertions must survive any separately reviewed migration. The nineteen passing controls also remain unaccepted under default workload. Any failure blocks final #8 acceptance, regardless of its assigned issue.

Task 1 reuses the captured baseline identities and qualifies the remaining ownership gaps after root accepts this plan. Task 2 requires outer custody qualification for unchanged allocations. Correction checks require custody for their actual allocation paths. The isolated #8 check can establish scoped progress. The six-file boundary and whole-suite gates still require #10 integration and complete outer custody.

## File map and verified seams

| Path | Responsibility and permitted change |
| --- | --- |
| `test/pilot/discovery.test.ts:211` | Modify only the eleven-row matrix and its imports. Add matrix-scoped hooks. Leave the first two tests unchanged. |
| `test/pilot/native-host-fixture.ts:9` | Add allocation custody and local setup-failure cleanup. Preserve existing arguments, returned fields, scripts, and successful behavior. |
| `test/pilot/discovery-matrix-fixture.ts` | Create the matrix owner, strict provider data, and custody writer. No import-time environment or filesystem changes. |
| `test/pilot/discovery-matrix-fixture.test.ts` | Create deterministic lifecycle, setup, cancellation, provider, isolation, and custody regressions. |
| `test/pilot/input-entry.test.ts:42` | Add metadata assertions to the existing shipped run. Preserve its restart check and 20000 ms timeout. |
| `src/pilot/discovery.ts:29` | Read-only constructor seam accepts `Command`, RPC factory, `ProviderRead`, and control source. |
| `src/pilot/discovery.ts:38` | Read-only canonical policy comparison occurs before the first command. |
| `src/pilot/discovery.ts:104` | Read-only six provider reads and zero-turn usage validation. |
| `src/pilot/orca-driver.ts:22` | Read-only `Command` is `(argv: readonly string[], cwd: string, timeoutMs: number) => Promise<any>`. |
| `src/pilot/provider-read.ts:3` | Read-only `ProviderRead` has provider, operation, and cwd arguments. |
| `src/pilot/native-command.ts:7` | Read-only connection and runtime-bound command. Successful calls require a closed receipt. |
| `src/orca/client.ts:90` | Read-only command environment snapshot. Lines 92–116 make three connection reads. Line 139 launches detached children. |
| `test/orca/argv.test.ts`, `test/pilot/native-command.test.ts`, `test/pilot/rpc.test.ts` | Preserve existing transport, diagnostics, runtime binding, and physical exported-client checks. |

Use `V = .superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue8-validation` for future execution evidence. It is a proposed task-owned directory. Existing evidence remains immutable.

## Proposed API and lifecycle contract

These are new test-only APIs fixed by this plan. They are not existing production APIs.

```ts
type NativeFixture = ReturnType<typeof nativeHostFixture>;
type Settlement = "not-started" | "settled" | "unknown";
interface MatrixDependencies {
  readonly fixture: NativeFixture;
  readonly command: Command;
  readonly provider: ProviderRead;
}
interface MatrixSnapshot {
  readonly root: string | null;
  readonly retained: boolean;
  readonly settlement: Settlement;
}
interface MatrixFixtureOptions {
  readonly fixtureFactory?: (onAllocated: (root: string) => void) => NativeFixture;
  readonly connect?: (fixture: NativeFixture) => Promise<Command>;
  readonly custody?: MatrixCustody;
  readonly drainTimeoutMs?: number;
}
class DiscoveryMatrixFixture {
  constructor(options?: MatrixFixtureOptions);
  open(): Promise<void>;
  runCase<T>(signal: AbortSignal,
    body: (dependencies: MatrixDependencies) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  snapshot(): Readonly<MatrixSnapshot>;
}
function nativeHostFixture(version?: string, allowance?: string,
  options?: { readonly onAllocated?: (root: string) => void }): NativeFixture;
```

The last signature specifies the added optional argument. Keep the existing inferred fixture return object. Do not introduce a circular return-type annotation in its implementation.

`open` records one original setup promise before its first await. It captures HOME, PATH, `ORCA_TERMINAL_HANDLE`, and `ORCA_PANE_KEY` privately. Each entry distinguishes absent values from present strings. It installs the existing synthetic values and uses `node:path`'s `delimiter` for PATH. It calls `nativeCommand(fixture.orca, fixture.workspace)` once. It does not use `vi.stubEnv` or `vi.unstubAllEnvs`.

If original setup rejects, restore the private snapshot after that setup settles. Perform safe cleanup before rejecting open. Retain a root with uncertain native closure. Concurrent close joins the same cleanup. A rejected setup observer does not establish original setup settlement. Snapshot root is the canonical root when available, or the exact allocated root before canonicalization.

`runCase` admits work only after successful open and before close starts. It registers the original body promise before invoking the body. A synchronous throw becomes that registered rejection. It creates a case cancellation controller linked to the supplied signal and owner shutdown. It removes listeners only after original settlement. A row releases its registry entry, never the shared environment or root.

Each case receives a separate command wrapper over the same native command. Check cancellation immediately before dispatch and after successful await. Preserve argv, cwd, timeout, decoded responses, and runtime binding. Aborting an outstanding call does not terminate it immediately. After that call returns, cancellation prevents another command.

Track active native work separately from body results. Connection or native rejection latches `unknown`. Later success cannot clear that uncertainty. Cancellation after a successfully closed call does not latch `unknown`. An assertion failure or pure provider rejection alone does not imply a live child.

`close` rejects new cases and requests cancellation. It drains original setup and body promises before restoration. Its default drain budget is **9000 ms**, within the unchanged **10000 ms** hook budget. Clear its timer after settlement. It restores exactly its four keys only after all original work settles. It calls fixture cleanup once when process settlement is `settled` or `not-started`.

A drain timeout preserves the environment and root. It rejects with `MATRIX_DRAIN_TIMEOUT` and records retention. It does not release custody or start delayed destructive cleanup. An uncertain native closure retains the root after bodies drain. Close rejects that state with `MATRIX_NATIVE_SETTLEMENT_UNKNOWN`. Repeated close returns the recorded close outcome. Outer settlement owns the eventual retained-root removal.

Record the first actual failure and whether `runCase` propagated it before the caller's signal aborted. Do not duplicate an already propagated assertion failure at close when no new failure exists. Close must report new post-observer failures and retained provider violations. Keep setup, custody, settlement, and cleanup failures visible. When failures combine, preserve the first failure as context and retain subsequent failures in an `AggregateError`.

Cooperative cancellation after a successfully closed command is not a new late operational failure. Recognize the wrapper's own cancellation through private provenance, not an error name or message. An unrelated late rejection remains a failure. Neither cancellation nor a later successful command clears latched native uncertainty. A swallowed provider violation must fail both case verification and close.

## Root custody contract

Allocate with `mkdtempSync` before canonicalization. Register the exact allocated path synchronously before `realpathSync` or later writes. Store the canonical path separately after success. Before native work starts, a setup failure can remove the exact allocated root locally. A failed registration must also clean that root or return explicit retained custody.

If registration and local removal both fail, include the allocated root in the returned setup failure. Keep it in the owner snapshot. Preserve that diagnostic in the outer command log. Cross-process custody remains incomplete until root reconciles it. Do not claim successful registration through an inaccessible receipt target.

The owner uses this proposed write interface:

```ts
interface MatrixCustody {
  write(event: Readonly<MatrixCustodyEvent>): void;
}
interface MatrixCustodyEvent {
  schemaVersion: 1;
  invocationId: string | null;
  ownerId: string;
  ownerPid: number;
  sequence: number;
  allocatedRoot: string;
  canonicalRoot: string | null;
  phase: "allocated" | "ready" | "drain-timeout" | "retained" | "removed";
  retained: boolean;
  settlement: Settlement;
  environmentRestored: boolean;
  pendingSetup: boolean;
  pendingCases: number;
}
function fileMatrixCustody(directory: string): MatrixCustody;
```

The default directory is `V/custody/unmanaged`, resolved from the repository-relative test module URL. It requires no preexisting private capture directory. Create it only when the owner opens. Use a random owner ID and one `<ownerId>.json` file. Write updates through an owned temporary file and atomic rename. Preserve failures in the command receipt. Do not overwrite another owner's file.

For a supervised run, the harness exclusively creates `V/active-run.json` before launch. Its schema is `{schemaVersion:1, invocationId, harnessPid, harnessBirth, directory}`. The directory must equal `V/custody/<invocationId>`. Qualification must prove that a registering worker belongs to this exact harness invocation through recorded PID/birth ancestry. A shared cwd or marker alone cannot attribute a worker. This registration changes no environment or runner setting. Without any marker, the owner uses `unmanaged`.

The harness's proposed `inspect_custody(directory, invocation_id)` returns parsed records and validation errors. It validates schema, sequence, exact roots, and invocation identity. It links `ownerPid` to its recorded owned PID/birth census. A receipt alone does not prove process ownership.

An existing foreign, invalid, unreadable, stale, or unsettled marker holds another attempt. Preserve it and separate reconciliation evidence under `V/marker-reconciliation/`. A dead harness PID alone does not establish resource settlement. Root must reconcile its invocation and resources before clearing the hold. Remove a valid owned marker only after positive settlement and a final identity comparison. Record removal separately from retained custody evidence. Never remove a marker unconditionally or select another directory to bypass the hold.

Unit tests can supply a custody writer that records events or throws. Every unit test that allocates a real root must retain its exact identity outside the owner. Await controlled command/body settlement before removing a retained synthetic root. A worker exit must leave file custody available to the outer harness.

## Task 1: Establish current evidence and qualify the bounded harness

**Owner:** Root or its assigned discovery worker. Source remains read-only during this task.

**Files:** Read the frozen baseline, package/configuration, supplied brief, approved design, named receipts, and progress comparison. Create `V/bounded-suite.py`, manifests, qualification fixtures, and receipts. The named build check may update generated `dist/` artifacts.

**Interfaces:** Consumes baseline `3f3c3cd`, historical evidence, and the custody contract. Produces a verified command wrapper, baseline identity manifest, and explicit eligibility decisions for Tasks 2–6.

- [ ] Verify exact cwd, branch, revision, and preexisting changes before any command.
- [ ] Record source/test/configuration hashes and the original eleven matrix rows.
- [ ] Implement the harness invocation `python3 V/bounded-suite.py <seconds> <label> -- <argv...>`.

The wrapper must persist argv, cwd, start time, revision, hashes, and runner PID/birth/group before supervision. Save npm exit and watchdog status before liveness checks. A failing census must not erase them. Always write a final receipt, including access refusals and unknown values.

- [ ] Qualify success, command failure, watchdog, setup failure, and detached-child settlement with disposable owned fixtures.

Qualify an outer observation method for unchanged baseline and non-matrix allocations in a separate bounded read-only discovery check. Include `test/pilot/discovery.test.ts:13`, direct `nativeHostFixture` callers, and `src/orca/client.ts:226–227`. Matrix receipts cannot cover these paths. Do not add automatic instrumentation to every caller.

Require invocation attribution and separate evidence for filesystem roots, locks, ports, and timers. Process observation alone proves none of those ownership classes. Qualification must also cover foreign, stale, invalid, and unsettled marker holds. If the host cannot demonstrate a required capability, preserve the exact gap. Stop only affected suite execution and reassess before dependent commands.

Use a maximum 30-second command budget per qualification fixture. Use **30 seconds** for settlement after command end or watchdog. Record child identities and lineage while parents exist. Reconcile detached native children separately from the runner group. Verify owned timers, ports, cache locks, and roots. Do not infer aggregate settlement from an empty group or deleted directory.

The observer's ability to identify detached descendants is an unresolved host fact. Require a positive qualification with a detached child that outlives its parent. If that fails, stop affected suite execution. Return the exact missing observer/control to root. Do not claim that polling proves an unseen child absent. Do not widen permissions or alter production to obtain evidence.

- [ ] Record the effective default configuration and relevant environment inputs without exposing secrets.

Record Node/Vitest versions, OS/architecture, available CPUs, CI/agent detection, selected ordinary reporter, and any concurrency-affecting inputs. Installed defaults are file isolation, `forks`, parallel files, 5000 ms test timeout, and 10000 ms hook timeout. The reporter can depend on runner environment. Preserve the ordinary selected reporter without a reporter override.

- [ ] Verify that current built artifacts match the frozen production revision.

Use retained build receipts and matching artifact hashes when available. Otherwise run `npm run build` under a 120-second watchdog. Preserve its source and output hashes before baseline collection or execution. A stale built package cannot establish current behavior.

- [ ] Reuse the exact-baseline runtime manifest after hash and input verification. Do not rerun baseline collection.

Let `B = .superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue8-baseline-file-inventory`. Verify `B/baseline-tests-expanded.json`, SHA-256 `7724371d521bd77b8525408f2a9f9eed1235fea8b6feb92ef70f25bbf822c824`. Verify normalized `B/baseline-test-identities.json`, SHA-256 `f6306d22d5f6544c7ee30622f5481804c3dbc7432738ee80a45a1b2e31d877e5`. Match revision, source, tests, configuration, lockfile, and installed dependency evidence. Missing input proof remains a discovery hold, not authority to recollect.

The normalized schema is `{file, name, count}` under `testIdentities`. Preserve exact names and multiplicities. The runtime JSON exposes `file` and `name`; do not invent locations or modes. `B/command-20261103T214947024213Z.json` records exit 0, no watchdog, and process/group settlement. The coordinator's collection record separately reports an owned TMPDIR and exact `rmdir` of its empty packaging root after settlement. Keep that cleanup evidence distinct from process settlement.

- [ ] Reconcile historical original identities against the collected baseline and reviewed #10 changes.

Use retained historical runtime identities when complete. Otherwise use the proven runtime route below in the frozen historical archive with matching pinned dependencies. Use the same route for final identities. Each needed collection has a 120-second command budget and a separate invocation-owned `V/collection/<label>/tmp` directory, with `<label>` exactly `historical` or `final`.

Payload: `./node_modules/.bin/vitest list --no-staticParse --json <absolute-output-path>`. Set TMPDIR only for that collection child to its exact owned directory. Record the literal cwd, TMPDIR, output path, input hashes, and created roots. Module evaluation can allocate a packaging root without running its cleanup hook. After positive settlement, remove only each recorded empty packaging root by exact `rmdir`. Preserve unexpected or nonempty roots for reconciliation. These collection overrides never enter ordinary default `npm test` attempts. Every historical identity needs preservation or a reviewed mapping.

- [ ] Submit discovery evidence and reassess the remaining tasks before fixture edits.

Expected result: complete identity evidence and qualified custody/settlement. Stop this discovery task before suite execution or fixture correction. Missing collection or process coverage holds dependent work. #10 expectations remain outside this task.

## Task 2: Capture current default behavior before fixture edits

**Owner:** Root or its assigned validation worker.

**Files:** Read the unchanged baseline and Task 1 qualification. Write only `V/baseline` logs, receipts, and the failure comparison.

**Interfaces:** Consumes complete baseline identities and qualified supervision. Produces current-revision reproduction evidence and an explicit correction eligibility decision.

- [ ] Run one bounded unchanged baseline `npm test`, with 180 seconds plus settlement, after harness qualification.

This is the current-revision reproduction attempt. Preserve its exact failures, elapsed phases, collection progress, and partial status. A historical failure does not satisfy this check. If it does not reproduce the old failure, record that fact. The controlled causal regression remains required.

- [ ] Reconcile this run with the historical 33-case comparison.
- [ ] Submit the baseline evidence and reassessment to root.

Expected result: a complete or explicitly partial baseline receipt with positive settlement. An expected test failure can establish RED context. It does not prevent Task 3's controlled cause-specific regression. Nonreproduction remains an explicit fact. Unknown settlement holds correction. A #10 failure does not authorize fixture workers to edit diagnostics expectations.

## Task 3: Prove RED through the matrix's actual lifecycle

**Files:** Modify `test/pilot/discovery.test.ts:217–254`. Create `test/pilot/discovery-matrix-fixture.ts` and `test/pilot/discovery-matrix-fixture.test.ts`. Retain extraction diff and RED bytes under `V/red`.

**Interfaces:** Extract temporary `runMatrixCase<T>(body: (dependencies: MatrixDependencies) => Promise<T>): Promise<T>`. It contains the actual current allocation, four `vi.stubEnv` calls, native connection, and `finally` cleanup. `provider` initially refers to existing `readProvider`. The matrix must call this extracted lifecycle. This temporary function is removed in Task 4.

- [ ] Extract the lifecycle without changing its behavior or any matrix assertion.
- [ ] Review the extraction against baseline source before running the regression.

Keep all eleven inputs, version mutations, primary inspection, both negative inspections, and sentinel assertion. Preserve the three `undefined` provider arguments during extraction. Do not count a helper absence, import failure, type error, or changed cleanup as causal RED.

- [ ] Add `retains the next case environment after a timed-out observer's original body settles`.

Use deferred promises, not sleeps or a real five-second timeout. Save presence and value for all four real outer environment keys privately. Create a controlled outer fixture with its canonical policy. Set HOME to its home and prepend its bin to PATH. Set distinct outer caller-handle and pane values. Legacy unstubbing must restore those controlled values, not ambient host values. After all originals and cleanup settle, restore the four real values, including originally absent keys. Do not use global unstubbing as the test driver's restoration mechanism.

1. Start A through the extracted lifecycle and real `NativeHostInspector`.
2. Hold A at its injected Cursor version read after policy comparison.
3. Reject only A's observer with `CONTROLLED_OBSERVER_TIMEOUT` and abort A's supplied signal.
4. Keep A's original promise registered in the test driver with a rejection handler.
5. Start B through the same lifecycle and record B's four environment values.
6. Hold B immediately **before calling `inspect()`**, after its fixture setup and connection.
7. Release A's provider gate and await A's original lifecycle, including its actual `finally`.
8. Check B's environment while B remains at the pre-inspection gate.
9. Release B and exercise the real inspector's canonical policy check.

For both A and B, explicitly call `new NativeHostInspector(command, rpc, controlledProvider, controls)`. Define a local callback with the exact synthetic data at `discovery.test.ts:234`. Both observations have `state: "missing"`, `source: "synthetic boundary"`, and `detail: "No launch controls"`. `facts` is `[]`. This callback is not an exported API. Apply it to each controlled inspection. Use finite fixed provider strings with no PATH fallback. Keep native CLI/RPC reads real. This schedule does not claim a new wall-clock timeout reproduction.

Required invariant assertions include:

```ts
expect(observedEnvironment).toEqual(bEnvironment);
expect(bRootPresentBeforeInspection).toBe(true);
expect(realpathSync(join(homedir(), ".agents/policies/model-policy.md")))
  .toBe(realpathSync(bFixture.policy));
expect(bInspectionError).toBeUndefined();
expect(bResult?.evidence.policyHash).toBe(hashOfBPolicy);
expect(bUnexpectedInferenceBeforeCleanup).toBe(false);
```

Capture environment, root presence, and canonical policy while B remains at its gate. Check the sentinel inside B's body before lifecycle cleanup. Collect B's inspection outcome even when environment assertions fail. Use soft assertions or separate captured outcomes. In `finally`, release every deferred gate. Await both original bodies before restoring the outer environment and removing exact owned roots.

- [ ] Run the focused test through the qualified harness with a 120-second watchdog.

Command payload: `npm test -- test/pilot/discovery-matrix-fixture.test.ts -t "retains the next case environment"`.

Expected RED: restored outer HOME/PATH/caller keys differ from B's values, and the real policy check reports `EXECUTION_HOST_POLICY_PATH_MISMATCH`. Production and original fixture behavior remain unchanged. Retain source hashes, extraction diff, assertion output, and settlement. If RED differs, diagnose before correction.

- [ ] Freeze the meaningful RED evidence for root review.

This task's deliverable is the verified failing causal regression. It is not a passing implementation checkpoint.

## Task 4: Implement owner lifetime, cancellation, and setup custody

**Files:** Modify `test/pilot/native-host-fixture.ts:9–19`, the new owner, and its new test file. Modify only the matrix lifecycle wiring in `test/pilot/discovery.test.ts`.

**Interfaces:** Produces `DiscoveryMatrixFixture`, the proposed snapshot/options/custody types, and the compatible optional fixture allocation callback. Consumes Task 3's unchanged invariant schedule.

- [ ] Add failing owner tests for open, original-promise tracking, setup failure, cancellation, close, and custody.

Pin these cases and assertions:

| Test | Required assertion |
| --- | --- |
| `opens one fixture and one native connection for all matrix cases` | Factory and connect each run once. No environment change occurs at import. |
| `restores present and absent owned keys exactly after final settlement` | All four saved entries match, including deletion of originally absent keys. An unrelated environment key remains unchanged. |
| `drains original bodies after observer rejection` | The Task 3 schedule retains B's environment and real policy check. Restoration occurs only after both originals settle. |
| `registers synchronous body rejection and still cleans once` | Body failure remains visible. Registry drains. Cleanup runs once. Repeated close has the same recorded outcome. |
| `registers allocation before canonicalization failure` | Register the exact allocated root synchronously. In the allocation callback, use exact `rmdirSync(root)` while that new synthetic directory is empty. The real subsequent `realpathSync` fails. Assert prior custody, no native call, and truthful cleanup. No dangling symlink is needed. |
| `cleans allocation when its observer throws` | The callback receives the exact allocated root. Its thrown setup error cannot strand an unowned root. |
| `cleans a later filesystem setup failure` | The allocation callback creates a file at the owned `providers` path. The real later directory creation fails. The factory cleans the nonempty root or retains explicit custody. |
| `retains custody after connection rejection` | Snapshot has the exact root, `retained: true`, and `settlement: "unknown"`. File custody survives owner failure. |
| `keeps command rejection unknown after a later command succeeds` | Open succeeds. One case command rejects and its live observer receives that failure. A later case command succeeds. Close still rejects `MATRIX_NATIVE_SETTLEMENT_UNKNOWN`, restores the four keys after drain, and retains the exact root in snapshot/file custody. |
| `restores environment before reporting original setup rejection` | All four original entries match immediately after rejected open. Close repeats no restoration or cleanup. |
| `waits for original setup after its observer fails` | Close leaves keys/root intact while injected connect is pending. Restoration follows its actual settlement. |
| `prevents a second command after cancellation during the first` | One deferred command returns successfully. The case then rejects for cancellation. Dispatch count stays one. Known closure stays settled. |
| `retains root and environment when drain expires` | `MATRIX_DRAIN_TIMEOUT`, retained root, pending count, and `environmentRestored: false` appear in file custody. |
| `rejects a case after close starts` | Body and command dispatch counts remain zero. |
| `close awaits a held original after its observer aborts` | Invoke close while the original body remains behind a deferred gate. After a microtask checkpoint, close is pending, root exists, keys remain installed, and cleanup count is zero. Release the body. Await original and close settlement. Assert exact restoration and one owned cleanup. |
| `reports a new late failure but does not duplicate a delivered assertion or cooperative abort` | A live observer receives an ordinary body failure directly. Safe close adds no duplicate failure. A new post-abort body rejection remains visible at close. The wrapper's cooperative abort after a closed command adds no new late failure. Retained seam violations and real cleanup errors still fail close. |

Use injected deferred connections/commands for uncertainty tests. Use fake timers only around the injected drain deadline. Restore timers before any real native invocation. Await exact synthetic settlement in each test's cleanup. For intentional close failures, restore the test's private outer environment after all original work settles. Remove only its exact retained synthetic root. Record that outer cleanup separately from the owner's retained snapshot.

- [ ] Add allocation registration and local pre-process cleanup to `nativeHostFixture`.

Split the nested allocation/canonicalization expression. Cover callback failure and canonicalization failure explicitly. Preserve existing callers, successful scripts, and fixture return fields. Do not treat a rejected setup promise as root cleanup evidence.

- [ ] Implement the owner and custody contract above.
- [ ] Replace the temporary matrix lifecycle with owner `open/runCase/close` wiring.

Put hooks inside a describe block containing only the matrix. Use `beforeAll(() => owner.open())` and `afterAll(() => owner.close())` with existing hook timeouts. Replace `it.each` with `it.for` using the identical table and title. Its handler receives `([version, expectedVersion], { signal })`. Pass that signal to `runCase`.

- [ ] Repeat the Task 3 invariant schedule through the owner.

Only the lifecycle adapter changes. Keep the gates and retention assertions. A and B now share the owner fixture. Capture B's expected values from its actual dependencies. Do not assert distinct A/B roots in this test.

That causal replay drains A and B before close. It does not prove close waits. The separate held-original test owns that assertion. It uses deferred gates and a microtask checkpoint, without sleeps or timeout changes.

- [ ] Remove the unsafe temporary `runMatrixCase` implementation after retaining its RED bytes and diff.
- [ ] Run the controlled regression and owner tests once, bounded to 120 seconds.

Expected GREEN: the original causal invariant and all owner tests pass. Every test root is removed after positive settlement or remains in truthful outer custody. A retained uncertain root is not a successful overall settlement result.

## Task 5: Supply strict metadata and preserve the tested boundaries

**Files:** Modify the new owner/provider helper, its test file, the matrix, and `test/pilot/input-entry.test.ts:42–73`.

**Interfaces:** Each `MatrixDependencies.provider` is a case-scoped `ProviderRead`. It records violations in both case and owner state before rejecting. All three matrix inspector constructions consume it explicitly.

- [ ] Add failing provider-data, swallowed-error, freshness, and unsafe-usage tests.

Permit only these six pairs and the canonical fixture workspace:

| Provider | Operation | Exact default output |
| --- | --- | --- |
| `codex` | `version` | `codex-cli 0.164.0` |
| `antigravity` | `version` | `1.4.12` |
| `cursor` | `version` | `2026.10.22-27dcf5f` |
| `cursor` | `models` | `grok-4.7-xhigh` |
| `antigravity` | `models` | `gemini-4-argon-high` |
| `antigravity` | `usage` | The JSON below, matching the fixture script. |

```json
{"command":{"name":"usage","data":{"groups":[{"name":"Gemini Models","buckets":[{"remaining_fraction":0.8}]}]}},"num_turns":0,"conversation_id":"","usage":{"total_tokens":0}}
```

Use immutable string data. Produce fresh native decoded responses through the real command on every status request. Do not cache status, policy, case results, or mutable usage objects.

For focused tests, expose this proposed pure factory in the owner module:

```ts
interface MatrixProviderData {
  readonly codexVersion: string;
  readonly antigravityVersion: string;
  readonly cursorVersion: string;
  readonly cursorModels: string;
  readonly antigravityModels: string;
  readonly usage: string;
}
function matrixProviderRead(workspace: string,
  onViolation: (violation: Readonly<{
    provider: string; operation: string; cwd: string;
  }>) => void, data?: Readonly<MatrixProviderData>): ProviderRead;
```

The owner binds its case/owner recorder to this factory. It copies supplied data at construction. No branch invokes `readProvider`, resolves PATH, or launches a provider.

Required tests:

- `rejects every unexpected pair and workspace before returning metadata` checks each forbidden pair and a different cwd.
- `fails a case when inspection swallows every provider rejection` wraps the case provider to pass a wrong cwd on all six reads. The real inspector may return fallback observations. `runCase` must reject `MATRIX_PROVIDER_SEAM_VIOLATION` afterward.
- `reports a late swallowed violation during close and still performs safe cleanup` verifies retained violation evidence and root cleanup after draining.
- `does not carry a mutated status or negative check into another row` mutates one returned status. A later real status has original capability/state values and the same runtime binding.
- `does not verify unsafe usage` varies only `num_turns: 1`, `usage.total_tokens: 1`, or a nonempty `conversation_id`. Each real inspector result has Gemini allowance state `missing`, never `verified`.

- [ ] Implement strict provider data and final violation checks.
- [ ] Pass `dependencies.provider` to primary and both negative matrix inspectors.

Retain every original version and rejection assertion. Keep the per-row inference sentinel. Keep real native commands and `LocalReadRpc` for every version. The source-derived launch estimate changes from 154 to 58. Record measured counts separately. Do not assert that this estimate proves adequate latency.

- [ ] Add assertions to the existing first shipped child result in `input-entry.test.ts`.

```ts
expect(outcome.evidence.versions).toMatchObject({
  codex: "codex-cli 0.164.0", antigravity: "1.4.12",
  cursor: "2026.10.22-27dcf5f",
});
expect(outcome.evidence.routes.find((r: any) => r.role === "gemini")
  .allowance.state).toBe("verified");
expect(outcome.evidence.routes.find((r: any) => r.role === "gemini")
  .catalog.state).toBe("verified");
```

These assertions use the actual synthetic provider scripts through the shipped entry. Preserve zero calls, policy admission, missing controls, cache-lock removal, journal events, sentinel, and existing restart assertions. Add no integration launch and no timeout change.

- [ ] Run `npm run build` and `npm run typecheck`, each bounded to 120 seconds.
- [ ] Run the isolated #8-only check once, bounded to 120 seconds.

Payload: `npm test -- test/pilot/discovery-matrix-fixture.test.ts test/pilot/discovery.test.ts test/pilot/input-entry.test.ts`.

Label this scoped fixture evidence. It can establish #8-only GREEN after its custody checks. It cannot complete Task 5, waive RPC failures, or replace the following boundary gate.

- [ ] Run the affected boundary command once, bounded to 120 seconds.

Payload: `npm test -- test/pilot/discovery-matrix-fixture.test.ts test/pilot/discovery.test.ts test/pilot/input-entry.test.ts test/orca/argv.test.ts test/pilot/native-command.test.ts test/pilot/rpc.test.ts`.

Expected result: every selected assertion passes, build/typecheck exit 0, and owned resources settle. A legacy diagnostics failure blocks this result. Route it to separately reviewed #10 integration. Do not remove that file, filter the failure away, or call the boundary check green.

## Task 6: Prove complete default behavior and close the evidence gate

**Owner:** Root coordinates validation, independent review, and acceptance.

**Files:** Read the frozen implementation and test manifests. Write validation receipts, logs, identity reconciliation, risk/rollback evidence, and root dispositions under `V`.

**Interfaces:** Consumes verified RED/GREEN, passing boundary/build/typecheck evidence, complete custody, and separately resolved #10 integration. Produces either complete #8 acceptance evidence or a precise remaining gap.

- [ ] Freeze the candidate revision, source/test/configuration hashes, and complete diff before repeated runs.
- [ ] Reconcile the final collection against both current baseline and historical original identities.

Use Task 1's runtime collection route for the frozen final candidate. Reconcile the normalized `(file, name, count)` multiset with all 1,573 baseline occurrences and added regressions. Retain all 76 current baseline files and all 67 historical original files. Verify original assertions and generated rows. Map the new matrix describe prefix explicitly. Preserve leaf titles, whitespace, table values, and repeated occurrences. Counts alone cannot prove preservation or execution.

- [ ] Run the exact four-file diagnostic selection once with a 120-second watchdog.

Payload: `npm test -- test/pilot/discovery.test.ts test/pilot/cache-composition.test.ts test/pilot/context-cleanup.test.ts test/pilot/host-relay.test.ts --reporter=json --outputFile V/four-file-vitest.json`.

This preserves the recorded four-file selection and JSON diagnostic purpose. It is supporting evidence only. `context-wrapper.test.ts` remains mandatory in the full suite. A failure stops dependent acceptance work.

- [ ] Run three consecutive complete default attempts on identical candidate bytes.

Task 2 has one separate baseline attempt. The corrected-candidate budget is **three attempts**, **180 seconds per command**, plus **30 seconds settlement per attempt**. Run them sequentially. Each payload is exactly `npm test`, with no extra arguments, configuration, environment override, pool/worker change, timeout change, ordering change, isolation change, or reporter override.

```text
python3 V/bounded-suite.py 180 default-01 -- npm test
python3 V/bounded-suite.py 180 default-02 -- npm test
python3 V/bounded-suite.py 180 default-03 -- npm test
```

`V` in these examples denotes the exact directory defined above. Substitute that path before invocation. The wrapper creates its custody registration file without changing the child's environment. Record the effective inputs from Task 1 for every attempt.

- [ ] Check each attempt's complete result before starting the next attempt.

Every attempt requires final npm exit **0**, complete expected identities, no unexplained skips, no unhandled errors, unchanged frozen bytes, and positive resource settlement. Raw stdout/stderr and the ordinary reporter remain retained. Preserve unknown npm exit or inaccessible process state as unknown. A timeout is a partial run even if its last displayed tests passed.

If the ordinary reporter cannot establish identity coverage, obtain supporting collection evidence against identical bytes. Collection alone does not prove that each identity executed. Do not silently add a reporter to the default runs. If coverage still cannot be proved, leave acceptance open.

After failure or watchdog, stop the sequence. Record the failing assertions, last completed phases, resources, and limits. Do not discard an attempt or silently add retries. A correction requires reassessment and another declared repeated-run budget before execution. An insufficient 180-second budget is a reported limitation, not authority to change test timeouts.

- [ ] Obtain root-owned fresh independent change review on the actual frozen artifact.

Give reviewers RED source/diff, GREEN output, all baseline distinctions, identity mappings, custody qualifications, actual default receipts, and limitations. Preserve the selected Superpowers verdicts, fix budget, ledger, and review disposition. Same-family Astra review supplements cross-family review. Author self-review and implementation-team review do not replace it.

- [ ] Record risk, rollback evidence, and the acceptance decision.

Acceptance requires the whole brief. Matrix GREEN, serial controls, diagnostics-only success, or historical passes cannot close #8. No issue closure, merge, push, or external message is implicit in this plan.

## Unresolved facts and discovery checks

| Fact | Next observable check | Effect if unresolved |
| --- | --- | --- |
| Historical identity mapping and final preservation | Reuse the captured 1,573-occurrence baseline; apply Task 1 runtime collection to needed historical/final identities | Hold coverage acceptance until exact multiplicities and prefix mappings reconcile. |
| Current default failure set after scoped #10 changes | Task 2 unchanged bounded baseline | Preserve nonreproduction or new failures honestly. |
| Effective host concurrency and ordinary reporter | Task 1 installed-default/environment receipt | Hold claims about equivalent default execution. |
| Outer custody coverage for detached native children and owned ports/locks/timers | Task 1 disposable qualification, including watchdog and parent-first exit | Hold affected suite execution if ownership or settlement is unproved. |
| Complete #10 integration of the fourteen historical persistent cases | Separate reviewed #10 gate, then frozen boundary/default results | No #8 edits to those expectations. No failed-test waiver. |
| Initial synthetic provider latency and adequacy of five native calls per row | Phase evidence if the corrected matrix still exceeds 5000 ms | Return a cause-specific discovery task. No broader timeout or production redesign. |
| Other environment writers and other suite resource failures | Current bounded default evidence and exact failing boundary | Keep remaining #8 work open. Replan only from causal evidence. |
| Whether 180 seconds permits reliable whole-suite completion | The approved three-attempt gate | Report insufficient budget before proposing any change. |
| Cross-platform behavior outside this Darwin/Node fixture environment | A separately authorized platform run | Claim only the platform actually verified. |

## Risk and rollback

Shared setup can carry mutable state between rows. Fresh decoded native responses and the row-isolation regression address that risk. Provider data can hide a real boundary regression. The shipped-entry assertions and unchanged transport suites preserve real synthetic provider coverage.

Cancellation can leave outstanding native work. The owner retains its original promise and exact root. The qualified outer harness must establish settlement before removal. A census denial or uncertain identity stops that operation. It does not authorize another signal route or broader access.

Before implementation, retain exact baseline bytes and hashes for the five changed/new test paths and unchanged configuration. Keep RED and candidate diffs. Root may authorize a scoped revert of the implementation commits after all owned work settles. Remove new files only when they are task-owned and unchanged by another writer. Restore changed files from the recorded baseline only after conflict checks. Do not use a hard reset or broad cleanup.

After rollback, compare the recorded baseline hashes. Reconcile fixture custody and all owned resources separately. Rollback restores source behavior. It does not turn the known baseline failures into passing evidence.

## Author self-review and language verification

Spec coverage maps to Tasks 1–6: default reproduction, meaningful unchanged-behavior RED, minimal fixture correction, repeated default GREEN, resource settlement, and honest platform limits. The file map preserves the first two discovery tests and all production/configuration boundaries. The provider plan preserves six pairs, real native/RPC checks, and shipped synthetic metadata coverage.

The step scan separates discovery from dependent implementation. Proposed APIs are declared together. Contracts match their consuming tasks. The return-type alias caveat prevents a circular fixture annotation. Each review-focus condition has a named test. Fix round 1 adds command-rejection latching and pending-close tests, runtime identity reuse, separate outer custody qualification, explicit controlled environment/controls, and an isolated #8 check. Code blocks specify contracts or assertions, not implementation bodies.

Readiness is **ready for scoped independent re-review, with execution discovery gates**. The captured baseline collection is reused. Tasks 1 and 2 still gate affected correction checks through outer custody and current default evidence. Task 5's isolated check cannot replace its six-file gate or Task 6. Root verifies current coordination ownership before publication. This author changed no service state. No collection, test, build, typecheck, provider operation, helper, Git mutation, or publication ran during this fix round.

Language verification is an Issue 9-oriented candidate. The official ASD-STE100 dictionary and governed terminology are unavailable. Procedure and description rules informed new prose. Paths, identifiers, commands, counts, hashes, conditions, and authorization limits were compared with source evidence. Mandated Superpowers template wording remains protected. Full ASD-STE100 conformance is unverified.

Planning provenance: `/Users/aaat/.codex/plugins/cache/openai-curated-remote/superpowers/7.0.1/skills/writing-plans/SKILL.md`, SHA-256 `a6c67c1900064347c2a329990dd3c555657c51c3ec53b259a08aa01a2c26139a`. Adaptive-planning and its maintained Superpowers integration reference were loaded. Context7 documentation corroborates Vitest behavior. Installed `5.0.5` sources establish the exact timeout and `it.for` behavior used here.
