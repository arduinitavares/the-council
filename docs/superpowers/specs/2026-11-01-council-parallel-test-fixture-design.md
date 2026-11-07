# Correct the version matrix without weakening native discovery checks

Status: proposed design for issue #8. The user has not approved these choices. Implementation requires the coordinator's design review, user approval, and a later concrete plan.

## Intent and constraints

Make ordinary offline `npm test` complete reliably with its default concurrency. Correct the demonstrated matrix failure without changing production admission behavior.

The inspected repository is `/Users/aaat/.codex/worktrees/council-first-use/the-council`. HEAD is `9aff16ceb97e9420ab346552c04405c38d2ffde8` on `dev/issue-1-first-use-reviewed`. Product, original tests, dependencies, and runner configuration were unchanged during this assignment. Only this design was written.

The user's constraints are approved requirements. Preserve every original assertion, all eleven version inputs, capability and readiness rejection, canonical policy checks, and the zero-inference boundary. Preserve default file concurrency and existing timeouts. Do not add skips, installed-provider requirements, credentials, suite serialization, or production admission exceptions. Cache, wrapper, relay, and cleanup failures remain within #8 until reliable default-suite completion is proved.

## Source-backed cause and limits

Evidence paths below are relative to the repository. `E` means `.superpowers/sdd/2026-10-31-council-issues-3-10/`.

The exact contract is issue `number == 8`, Agent Brief comment `IC_kwDOVcK9P88AAAABhmknqw`, in `E/current-issues.json`. Task 1 is in `docs/superpowers/plans/2026-11-01-council-parallel-test-design-authoring.md`.

The trace is `E/parallel-phase-trace/phase-trace-full-workload.jsonl`. It has 450 events. Its SHA-256 is `9f73224f0ea561708ece21701bd4542c64bf5add3b7b3c1d6cc4d07d6c7453ef`. This matches `E/parallel-failure-causal-trace-verification.json`.

| Observed event | Trace lines | Meaning |
| --- | --- | --- |
| Case 1 aborts at 5016.35 ms during synthetic Cursor `version` | 21–25 | The aggregate case deadline expires during this await. |
| Case 2 establishes its fixture environment | 26–30 | The previous async body has not finished. |
| Case 1's await returns at 5479.79 ms | 31 | Timeout rejection did not stop that body. |
| Case 1 enters environment restoration at 5576.88 ms | 43–44 | HOME changes from case 2's fixture home to the original home. Restoration finishes at 5582.21 ms. |
| Case 2 reports `EXECUTION_HOST_POLICY_PATH_MISMATCH` | 57 | Its policy comparison occurs after the recorded environment overwrite. |
| Cases 4 and 5 repeat the sequence | 128–162 | This mechanism occurred twice in this captured workload. |

These times describe this instrumented run only. The provider guards prevent dispatch outside each fixture. After mismatch, they block subsequent metadata reads and surface a diagnostic error. That changes later control flow and cleanup timing. The trace does not establish exact historical timing, CPU saturation, a provider regression, or every other suite's cause.

The source explains the mechanism:

- `test/pilot/discovery.test.ts:217–254` creates and stubs a separate environment per row. Its `finally` calls worker-wide `vi.unstubAllEnvs()`.
- A normal row awaits fourteen synthetic Node launches. Connection contributes three, primary host checks contribute three, provider metadata contributes six, and negative status checks contribute two. This is a source-derived normal-path count.
- `NativeHostInspector` accepts a `ProviderRead` dependency at `src/pilot/discovery.ts:29–34`. Passing `undefined` retains process-backed `readProvider`. The matrix does this for all three inspector constructions.
- `src/pilot/provider-read.ts:25–30` copies ambient environment for each call and permits a 25000 ms child timeout. That exceeds the aggregate 5000 ms case timeout.
- `src/orca/client.ts:90` snapshots command environment. This protects subsequent native command dispatch, but it does not protect `homedir()` or provider reads.
- Installed Vitest 5.0.5 rejects the wrapper and aborts its signal without stopping the original promise. See `run.BPv-BBRv.js:2702`, `:3270–3354`, and `:4088` under `node_modules/vitest/dist/chunks/`. The environment map restores all recorded keys at `index.aTZaPVhf.js:7440–7463`.

`vitest.config.ts` specifies only the file include pattern. Installed defaults retain file isolation, the `forks` pool, parallel files, a 5000 ms test timeout, and a 10000 ms hook timeout. See `defaults.B1FCaFfh.js:52`, `cac.CLrZKo1g.js:928–941`, and `index.1TqnEahn.js:9162–9163`. File isolation does not isolate successive cases inside one worker.

The earlier diagnosis, `E/parallel-failure-causal-diagnosis/report.md`, correctly left occurrence unproved. The new trace proves the captured continuation and overwrite sequence. It still does not explain why that synthetic read took this long.

Run receipts retain different meanings:

- `E/offline-discovery/focused-discovery-20261101/receipt.json`: isolated 13/13 pass, exit 0, 16.726 seconds.
- `E/offline-discovery/focused-four-suites-20261101/receipt.json`: completed diagnostic, exit 1, six discovery timeouts and one policy mismatch. Its fourth file is `host-relay.test.ts`, not `context-wrapper.test.ts`.
- `E/offline-discovery/phase-traced-four-suites-20261101/receipt.json`: completed guarded diagnostic, exit 0, 32.878 seconds.
- `E/offline-discovery/phase-traced-full-workload-20261101/receipt.json`: 67-file workload, 180-second watchdog, exit `-15`, `suiteCompleted: false`. No final suite report exists. All 791 observed identities and the owned group later settled. The wrapper's exit remains unexposed. The verification records positive terminal closure separately.

`E/parallel-phase-trace/coordinator-fixture-verification.json` verifies preserved assertions and unchanged originals. The trace author's separate 300-second entry timeout is recorded in that directory's `completion.json`. It is distinct from the workload watchdog. Its later `settlement-reconciliation.json` preserves the original partial status. None of these receipts is final #8 acceptance.

## Approaches and recommendation

| Approach | Benefit | Tradeoff |
| --- | --- | --- |
| Run each case in a separate process with explicit environment | Separates HOME, PATH, and cleanup ownership completely. | Adds process and lifecycle cost. It does not reduce the work that crossed the deadline. An environment snapshot alone cannot cover the inspector's current ambient `homedir()` access. |
| Reduce or amortize metadata acquisition while retaining per-case cleanup | Removes repeated work unrelated to the varying Orca version. Existing dependency seams support it. | Reduction alone leaves the demonstrated late-cleanup hazard if another boundary times out. Replaying every command would also reduce repeated native boundary exercise. |
| Use the provider seam, one matrix environment owner, and one native connection | Removes six launches per row and repeated connection setup. Late rows cannot restore another row's environment. | The owner must drain original bodies. Five real native command launches remain per normally completed row, so default-suite verification remains decisive. |

**Recommendation: the third approach.** Keep real synthetic CLI commands and `LocalReadRpc` in every version row. Supply fixed synthetic provider metadata through the existing third constructor argument. Move fixture creation, environment stubs, and connection into the matrix suite's owner. This reduces the normal matrix launch count from 154 to 58: three connection reads plus five native commands for each of eleven rows. This is a design estimate, not a measured result.

Each row retains its version mutation and both negative inspections. Each native status command returns a fresh decoded response. No mutable status object, policy mutation, or case result is cached across rows. Every row retains the sentinel assertion.

The provider seam permits only the existing six provider/operation pairs and the fixture workspace. It returns the fixture's existing version strings, model lists, and zero-turn `/usage` JSON. Unexpected requests are recorded in case/owner state before the seam throws. The inspector catches provider errors, so a throw alone does not fail the row. After each original body settles, runCase must reject a recorded seam violation even if inspection swallowed it. close must also check retained violations after draining late bodies and must still perform owned cleanup. Add a regression where every provider call is rejected or an unexpected workspace is supplied; the row cannot pass silently. The seam cannot fall back to PATH or launch a provider. This is test data, not a production metadata cache.

Existing coverage supports this boundary. `test/orca/argv.test.ts:12–99` exercises actual CLI argv, environment filtering, guides, output limits, and timeout receipts. `test/pilot/native-command.test.ts` preserves diagnostic rejection. `test/pilot/rpc.test.ts:64–118` exercises physical exported-client loading, version independence, foreign runtime rejection, and invalid export paths. `test/pilot/input-entry.test.ts:42–73` exercises shipped discovery through actual synthetic provider scripts with zero calls and an absent inference sentinel. These checks remain active.

This recommendation is the author's choice. The user has not selected or approved it.

## Exact proposed boundaries

| File | Proposed responsibility |
| --- | --- |
| `test/pilot/discovery.test.ts:211–255` | Retain the eleven inputs and every assertion. Wrap only the matrix in a describe block. Scope its beforeAll/afterAll hooks to that block so the first two tests retain their environment and behavior. Use a matrix-scoped owner and explicit `ProviderRead` in the primary and negative inspectors. Preserve real CLI/RPC paths. Leave the first two tests unchanged. |
| `test/pilot/discovery-matrix-fixture.ts` — new, proposed | Own matrix setup, case bodies, cancellation, provider test data, and final teardown. No import-time environment changes. |
| `test/pilot/discovery-matrix-fixture.test.ts` — new, proposed | Test late settlement, failure, setup failure, shared-data isolation, and owner cleanup. |
| `test/pilot/input-entry.test.ts:42–73` | Add assertions to the existing shipped integration run for the three actual provider versions and expected metadata-derived observations. Keep every original assertion and timeout. Do not add a second integration launch. |

A narrow change to `test/pilot/native-host-fixture.ts` must establish root ownership immediately after allocation, before later setup can throw. Split the current nested allocation/canonicalization expression. Register the allocated root before canonicalization and subsequent writes, or give the factory an equivalent local failure-cleanup owner. An optional test-only allocation callback is one supported approach. Preserve existing callers and successful fixture contents. A failure after allocation must leave the exact root cleaned or retained with an explicit owner; a rejected setup promise alone is insufficient. Add a controlled failure after allocation and verify that custody. This is a test helper change only.

The proposed owner exposes `open(): Promise<void>`, `runCase<T>(signal: AbortSignal, body: (dependencies: MatrixDependencies) => Promise<T>): Promise<T>`, `close(): Promise<void>`, and a read-only `snapshot()`. The proposed snapshot contains `root: string | null`, `retained: boolean`, and `settlement: "not-started" | "settled" | "unknown"`. An allocation observer receives the exact root immediately. In harness runs it persists the identity to an owned cross-process custody receipt before further setup. The concrete plan must pin that receipt format, task-owned path and registration/inspection interface. Unit tests must verify retention through snapshot and await cleanup of their exact synthetic root. An in-memory property alone cannot provide outer-harness custody after worker exit. `MatrixDependencies` contains the existing fixture return type, `Command`, and `ProviderRead`. These names are proposals, not existing APIs.

`open` registers its original setup promise before its first await. The owner uses a private snapshot of HOME, PATH, `ORCA_TERMINAL_HANDLE`, and `ORCA_PANE_KEY`. It preserves absent values separately from present values. It does not use Vitest's shared environment-stub map. If setup rejects, it restores the owned environment snapshot after the original setup settles and retains or cleans the registered root as its actual process evidence permits. close remains idempotent after that path.

`runCase` registers its original body promise before its first await. Case completion releases only its registry entry. Case code never restores environment or removes the shared fixture. `close` stops new cases and drains registered setup and bodies. It then restores its keys. It closes the fixture exactly once when native process settlement is established. Cleanup does not use global unstubbing as a substitute for ownership.

Use a separate command wrapper for each case's signal checks before and after awaited native calls. Preserve the shared native command's runtime binding. Cancellation prevents another command after an outstanding call returns. It does not claim to terminate that call immediately. Vitest's installed `it.each` does not append `TestContext`. The proposed matrix uses `it.for` with the same table and generated names to receive context explicitly (`run.BPv-BBRv.js:2872–2907`).

Preserve existing `native-host-fixture.ts` callers and successful behavior. Permit only the allocation-custody change and its setup-failure regression described above. Keep `src/pilot/discovery.ts`, `native-command.ts`, `provider-read.ts`, `rpc.ts`, `src/orca/client.ts`, `QualificationCache`, and `vitest.config.ts` unchanged. A production host-context API or cancellation redesign needs new causal evidence and another design decision.

## Meaningful RED and GREEN

These checks describe future work. None ran during this assignment.

1. **Establish RED before correction.** Extract the current per-case setup/body/`finally` into the test-only lifecycle seam if necessary. Preserve its behavior and assertion order. Do not count a missing helper or type error as RED.
2. **Control the demonstrated interleaving.** Hold case A's body on a deferred boundary through the existing command/provider seams. Retain `nativeHostFixture` and `NativeHostInspector`. Reject only A's timeout observer. Start case B with its fixture environment. Place B's deferred gate before invoking `inspect()`, because canonical policy comparison precedes its first command call. Release A while B remains at that gate before policy comparison. Let A's actual `finally` finish. Assert that B retains HOME, PATH, caller keys, canonical policy, and a successful real inspector policy check. The unchanged lifecycle fails because A restores B's environment. No live provider or wall-clock sleep is needed. This checks the proven continuation model without claiming a new timing reproduction.
3. **Demonstrate GREEN with the same invariant.** Repeat that schedule with the proposed owner. A may fail or abort. Its settlement must leave B's environment and fixture intact. Verify restoration only after the last original body settles. Cover setup rejection and ordinary assertion failure as well.
4. **Preserve boundary coverage.** Run every original version and negative assertion. Verify that one row's status mutation cannot affect another row. Retain real shipped provider coverage. Add unsafe `/usage` variants for nonzero turns, nonzero tokens, and a nonempty conversation ID. They must leave allowance unverified. No synthetic success may satisfy that boundary.

The controlled regression uses the lifecycle exercised by the actual matrix. A copied miniature cleanup implementation is insufficient. The pre-correction extraction requires source review to confirm unchanged fixture behavior. The existing guarded trace supplies runtime evidence for Vitest continuation, not the acceptance result.

## Bounded verification and settlement

The following budgets are recommendations for the later approved plan. They authorize no execution now.

- Run the controlled regression and affected boundary files once, each invocation under a 120-second watchdog. Run `npm run typecheck` with a finite 120-second limit.
- Run the exact recorded four-file diagnostic once, with its 120-second watchdog. Label it supporting evidence even if GREEN.
- Then run **three consecutive complete `npm test` attempts**, each with a 180-second watchdog. Use the checked-in configuration and ordinary default reporter. Do not change pool, worker count, isolation, test timeouts, ordering, or file parallelism. Capture host, Node/Vitest versions, effective concurrency inputs, revision, diff, elapsed phases, failures, and final exit status.
- Require all 67 original files and every original test identity, plus added regressions. The stated 1,227 original-test count is preliminary until the concrete plan reconciles collection with the frozen baseline. Record the actual baseline identity/count manifest before correction. Reconcile the final suite against that manifest; a count alone does not prove preserved coverage. Require exit 0, no unexplained skips or unhandled errors, and complete settlement for each attempt. A retry after failure does not erase that failure.

After a failure or watchdog, stop dependent acceptance work. Preserve partial output and the failing boundary. All other #8 failures remain open. A changed correction requires another declared repeated-run budget. A serial control may check coverage equivalence, but it cannot replace these runs.

The matrix owner retains original promises after runner timeout. It requests cancellation and waits within the existing hook budget. It must not restore HOME or remove files while an original body can still use them. A drain timeout fails verification. It does not imply successful cleanup.

Successful native commands already require a closed process receipt (`native-command.ts:13`). A connection or native command failure can leave closure uncertain. The owner records that uncertainty and retains the exact fixture root for the outer harness. It does not infer child settlement from body rejection. The harness receives fixture root identities when setup creates them. It removes retained roots only after positive process settlement. Cancellation after a successfully closed command does not itself create that uncertainty.

The outer harness owns a finite settlement phase: proposed 30 seconds after each command ends or its watchdog fires. It records owned process identities and groups before execution. It includes detached native children, timers, ports, cache locks, and temporary roots. `OrcaClient` uses detached children, so killing only the test runner's process group is insufficient.

After success, the harness verifies that those resources settled. After failure or watchdog, it stops only proven owned resources and verifies their absence. It preserves unknown exit codes and incomplete descendant evidence. Fixture directory deletion alone is not settlement. An access refusal stops that operation and remains in the receipt. No alternate signal path or permission expansion bypasses it. Unrelated sessions remain untouched.

## Unresolved facts and decisions

- The precise source of the initial synthetic read latency remains unknown. Reduced process work is a justified correction candidate, not proof of CPU contention.
- Five native command launches per row might still exceed the default deadline under load. A remaining timeout requires phase evidence before further amortization or another design.
- Matrix ownership does not establish safety for every other environment writer. Other discovery cases and the cache, wrapper, relay, and cleanup suites retain their own failure and settlement obligations.
- The 180-second full-run budget is proposed from the current receipt. Reliable complete-suite runtime has not been measured. If it is insufficient, report that limitation before proposing a different harness budget. Do not raise test timeouts to conceal it.
- The coordinator must resolve review findings and obtain the user's approach/design decision. Fresh Astra Ultra and Argon high reviewers must inspect identical frozen design bytes. Their review and final acceptance remain with the root coordinator. This author launched no reviewers or helpers.

The next horizon is design review, user design approval, and concrete TDD plan authoring. Implementation and validation remain provisional until those gates pass.

Language verification: Issue 9-oriented candidate, with descriptive rules for findings and procedural rules for checks. The official dictionary and governed terminology were unavailable. Vocabulary approval and full ASD-STE100 conformance remain unverified. Protected identifiers, paths, values, evidence sequence, and authorization limits were compared with the sources. Adaptive-planning guidance and Superpowers 7.0.1 brainstorming/writing-plans informed the design boundary. No implementation plan or service state was published.

The loaded Superpowers sources are `/Users/aaat/.codex/plugins/cache/openai-curated-remote/superpowers/7.0.1/skills/brainstorming/SKILL.md` and `/Users/aaat/.codex/plugins/cache/openai-curated-remote/superpowers/7.0.1/skills/writing-plans/SKILL.md`. The user's explicit author-only assignment retains all questions and independent review with the root coordinator.
