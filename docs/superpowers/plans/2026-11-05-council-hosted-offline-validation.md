# Council hosted offline validation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add task-scoped hosted macOS validation that preserves command deadlines, fixture settlement, meaningful regression evidence, and the complete Council acceptance requirements.

**Architecture:** Use one small Python standard-library supervisor, one focused test module, one source-bound validation contract, and one GitHub Actions workflow. Qualify the supervisor in each fresh hosted VM before product commands. Use isolated selective delivery to preserve incomplete local work.

**Tech Stack:** Python standard library, Node `22.23.4`, locked npm dependencies, TypeScript `7.0.2`, Vitest `5.0.5`, standard `macos-26` runners, and GitHub CLI.

**Spec:** `/Users/aaat/.codex/worktrees/council-first-use/the-council/docs/superpowers/specs/2026-11-05-council-hosted-offline-validation-design.md`, approved SHA-256 `7d91ff5cb1fffd0cc1527d1af7b10b88af67c6c7bd18d1f9c0c15cd2469b0c7f`.

**Output:** The coordinator records this text at `docs/superpowers/plans/2026-11-05-council-hosted-offline-validation.md`. This assignment performs no file write or execution.

## Global constraints

- Preserve every #3–#10 Agent Brief and parent #1 acceptance requirement.
- Use Sol Max for implementation through Orca. Obtain fresh Astra Ultra and Argon high reviews of identical frozen plans and substantive source changes. The coordinator resolves findings.
- Preserve all assertions, all eleven discovery version rows, zero-input accounting, default Vitest concurrency, existing timeouts, and versioned diagnostic contracts.
- Add no skips, serial flags, production admission exceptions, installed-provider requirements, dependency changes, or credentials.
- Keep the nine-file diagnostic candidate, original qualification runner, and both incomplete main-worktree #5 files unchanged during harness authoring.
- Keep the exhausted local support-runner correction task closed at `5/5`. Preserve the selected Superpowers workflow’s separate fix budgets and ledger.
- Run no Node, npm, build, Vitest, provider, or real process-qualification workload on the user’s host. Later host verification is limited to pure standard-library tests with injected adapters.
- Use only standard `macos-26` runners in the public repository. Fail eligibility if repository visibility or runner class differs.
- Give workflow jobs only `contents: read`. Pin checkout to `d23441a48e516b6c34aea4fa41551a30e30af803` and setup-node to `949feb2413d6458794dcd2491c4babbbce0c15c1`.
- Check out the event commit with `persist-credentials: false`. Disable setup-node package-manager caching.
- Use separate fresh jobs with outer bounds of `15`, `15`, and `20` minutes. These bounds include setup and never extend command limits.
- Cap dependency setup at `300` seconds per job. Preserve `120+30` seconds for build/typecheck, `300+30` for C12, and `180+30` for each final default repetition.
- Treat cancellation, missing receipts, unknown settlement, skipped mandatory work, and incomplete logs as failed verification. VM disposal does not prove fixture cleanup.
- Publish no caches or artifacts. Add no live-provider path, schedule, permission expansion, billing change, account setup, or Orca GUI action.
- Reuse existing approval for reviewed bounded hosted validation. Actual refusals remain binding.

## Review focus

- A deadline expires while detached fixture work or streams remain. Task 2 must preserve the actual outcome and stop within the separate settlement bound.
- A fresh VM lacks `dist` or nested-package cache inputs. Tasks 1 and 3 must identify setup inputs and supply each job’s bounded build.
- Expected RED, bootstrap success, or skipped jobs resemble final acceptance. Tasks 2 and 3 must keep these outcomes distinct.
- A fixture leaves a root, watchdog, lock, port, or timer. Tasks 1 and 2 must bind the cleanup claim to source-backed ownership and lifecycle evidence.
- Selective publication includes unrelated changes or executes an unreviewed hook workload. Tasks 1 and 4 must inspect hooks, ancestry, and the complete outgoing diff.

---

## File map and retained contracts

These new paths are proposed by this plan.

| Path | Responsibility |
| --- | --- |
| `.github/workflows/council-goal-offline.yml` | Restrict triggers, runners, permissions, source selection, and the three job stages. |
| `scripts/ci/offline.py` | Build the explicit environment, supervise bounded commands, validate scoped resource evidence, and emit receipts. |
| `scripts/ci/offline-contract.json` | Bind reviewed command profiles, source identities, dependency-script facts, and fixture evidence rules. |
| `test/ci/test_offline.py` | Run pure adapter tests. Supply disposable runtime qualification fixtures only in hosted VMs. |

Do not add another process-management package or general runner framework.

Retain these supplied product contracts without duplicating their programs:

- `reviewed-issue8-plan.md`, SHA-256 `5e261f9483aebc7fc5b69195eaec545716440eabbabae0f987df91ef6e8d33b8`.
- `reviewed-fourteen-case-plan.md`, SHA-256 `cb84f248e9c8073402fcea1b837cba0e57cef6f6fde2bbf31d4dc3e66b3ae934`.
- The protected nine-file manifest against local reference `3f3c3cdf63130d4aa27037c8f0d42ed5fd36dd8b`.

The hosted supervisor replaces their local execution mechanism. It does not replace their assertions, meaningful RED requirements, or acceptance gates.

## Task 1: Establish the source-bound execution contract

**Owner:** Coordinator or its bounded read-only discovery worker.

**Prerequisite:** Fresh plan review and coordinator disposition.

**Files:** Read the named fixture sources, retained plans, package inputs, relevant installed dependency scripts, publication hooks, and delivery-tool documentation. Return a private discovery record through the coordinator’s carrier. Make no product or harness edits.

**Interfaces:**

- Consumes the frozen packet and the actual source revision.
- Produces exact dependency/setup facts, fixture evidence mappings, baseline identity references, and supported selective-delivery operations.
- Leaves dependent implementation provisional wherever evidence is missing.

- [ ] **Record source and preservation boundaries.**

  Confirm the reference commit, actual authoring cwd, task-owned Orca workspace, and preexisting changes. Bind all nine protected files and the qualification runner to their supplied hashes. Preserve main-worktree `src/pilot/provider-controls.ts` and untracked `src/pilot/cursor-trust.ts`. Coordinator inspection confirms both paths and their protected hashes. Neither enters selective promotion before its own source/runtime gates.

- [ ] **Inspect dependency installation and nested package inputs.**

  The lock lists `fsevents@2.3.3` with `hasInstallScript: true`. It does not provide complete script bodies or download behavior. Inspect the lock-bound package manifests and relevant scripts, including native-package installation behavior and nested packaging tests.

  Record package version, archive integrity, script source hash, command, destination, and any public download URL/version. Do not infer absence of scripts from an absent lockfile flag.

  The intended setup payload is:

  ```sh
  npm ci --no-audit --no-fund
  ```

  Admit it only after its actual script effects are reviewed. Missing package-source evidence holds dependency setup. A bootstrap containing only reviewed supervisor qualification may still proceed.

- [ ] **Map practical fixture settlement evidence.**

  Start with `context-fixture.ts`, `provider-cleanup-fixture.ts`, `provider-watchdog.cjs`, `native-host-fixture.ts`, `discovery.test.ts`, and `test/store/crash-window.test.ts`. Follow only relevant fixture factories and process/resource call sites needed by the selected commands.

  For each resource class, record its allocation owner, identity, available receipt or assertion oracle, successful close condition, and failure-path limitation. Include detached native commands, provider watchdogs, streams, temporary roots, cache locks, ports, and timers where the source creates them.

  Reuse `COUNCIL_TEST_ARTIFACTS` for cleanup-fixture receipts in a unique command-owned directory. Validate its nonce, assignment hash, manifest, watchdog outcome, and settlement fields. Do not treat the mere existence of JSON as proof.

  Assign the supervisor as the explicit outer cleanup owner for the crash-window root. Record its actual allocation pattern and child-reaping evidence. Remove and verify only that invocation’s exact root after positive process settlement.

  Use fixture assertions and lifecycle receipts to support the scoped claim. Process samples alone cannot establish arbitrary descendant closure. Do not require an audit of every third-party dependency.

  If a required fixture has no usable oracle, return the exact missing bridge and permitted source boundary as a separate discovery result. Do not mark dependent suite execution ready or silently add broad instrumentation.

- [ ] **Bind coverage and offline claims.**

  Reuse the retained `1,573` baseline occurrences across `76` files after input verification. Preserve repeated-name multiplicities and the explicit mapping for the matrix’s new describe prefix. Keep the historical `67` files and `1,227` count separate.

  Inspect nested package commands and synthetic provider paths for their actual network behavior. npm offline configuration is not OS network denial. Record the supported claim and its limits.

- [ ] **Inspect publication prerequisites.**

  Read the required Orca worktree guides before selecting supported native managed-worktree operations. Record their exact supported invocation for the delivery checkout.

  Inspect effective commit/push hooks without executing them. Identify any host workload they would run. Do not disable hooks or alter settings to avoid a boundary.

  Recheck the relationship between remote PR2 head `53be0fe7d654d4667f9d873c4d1b81ec54d6f1c6` and local reference `3f3c3cdf63130d4aa27037c8f0d42ed5fd36dd8b`.

- [ ] **Submit the discovery checkpoint and reassess.**

  Completion requires concrete mappings and exact unresolved gaps. Stop this task before implementation. The coordinator must expand any missing bridge into reviewed work before its dependent command becomes eligible.

## Task 2: Implement and test the focused supervisor

**Owner:** Sol Max implementer.

**Prerequisite:** Accepted Task 1 contract for the command classes being implemented.

**Files:**

- Create `scripts/ci/offline.py`.
- Create `scripts/ci/offline-contract.json`.
- Create `test/ci/test_offline.py`.

**Interfaces:**

```python
def command_plan(job: str, phase: str, contract: dict) -> list[dict]: ...

def command_environment(
    node: str, command_root: str, job_cache: str, *, offline: bool
) -> dict[str, str]: ...

def supervise(
    spec: dict, context: dict, *, ops: object
) -> dict: ...

def main(argv: list[str], *, ops: object | None = None) -> int: ...
```

`ops` is the private test seam for clock, process, output, signal, filesystem, and resource observations. Production uses standard-library operations. Pure tests inject every operation that could spawn, wait, signal, write, or contact a socket.

Each command specification contains `id`, `argv`, `executionSeconds`, and `settlementSeconds`. The supervisor accepts only reviewed profiles from the contract.

- [ ] **Write meaningful failing pure tests.**

  Write the named test before adding or changing implementation. For the new module, add only the smallest importable interface stub after that test exists. Its default result is unsupported/incomplete, and it spawns nothing. Establish a named assertion failure for a positive fake normal-run case before implementing success. Do not start from an incorrect success default. Missing modules, syntax errors and import failures do not establish issue-regression RED.

  Pin these tests:

  | Test | Required assertion |
  | --- | --- |
  | `test_observed_zero_exit_with_complete_fixture_evidence_passes` | The positive fake case returns actual `0`, complete output and known closed resources; the initial incomplete stub must fail this assertion. |
  | `test_zero_exit_requires_complete_resource_evidence` | Exit `0` with retained or unknown fixture state cannot pass. |
  | `test_preserves_nonzero_and_unknown_child_status` | Preserve exit `7`, a signal exit, and unknown status separately. |
  | `test_deadline_and_settlement_use_separate_monotonic_bounds` | Stop execution at its limit; never grant another execution allowance during settlement. |
  | `test_open_stream_does_not_extend_settlement` | A descendant-held pipe cannot cause an unbounded read or wait. |
  | `test_cancellation_preserves_partial_output_and_fails` | Retain output and actual child status; cancellation cannot pass. |
  | `test_unbound_or_reused_identity_is_never_signalled` | A foreign or conflicting process identity blocks that signal. |
  | `test_refusal_is_retained_without_an_alternate_signal_route` | Preserve the refusing operation and diagnostic. |
  | `test_crash_root_cleanup_requires_settlement_and_exact_ownership` | Remove only the registered invocation-owned root after settlement; verify absence. |
  | `test_private_environment_excludes_inherited_credentials_and_node_options` | A hostile inherited environment cannot enter command execution. |
  | `test_three_defaults_stop_at_first_incomplete_result` | Never start repetition two after a failed or incomplete repetition one. |
  | `test_each_product_job_has_its_own_build` | All three candidate job plans include bounded builds. |
  | `test_bootstrap_and_expected_red_cannot_satisfy_acceptance` | Neither outcome creates final verification success. |

- [ ] **Run pure RED under a finite test-runner guard.**

  ```sh
  python3 -I -S -B test/ci/test_offline.py --pure --deadline-seconds 30
  ```

  The test runner owns the 30-second guard. Pure tests perform no real subprocess, filesystem mutation, socket, or sleep operation. Retain named assertion failures.

- [ ] **Implement command supervision and receipts.**

  Use `subprocess.Popen` with a new session and nonblocking output handling. Use monotonic time for deadlines. Preserve stdout/stderr as they arrive.

  Start settlement when command exit is observed, the execution deadline fires, or cancellation arrives. Keep all observations and waits inside the remaining settlement allowance. Attempt graceful termination, then bounded escalation, only for proven owned identities. Validate detached groups separately from the npm runner group.

  Emit a receipt even when observation or cleanup fails. Include:

  - Source commit/tree, contract hash, lock hash, invocation, job, and phase.
  - Exact argv/cwd, start/end timestamps, execution and settlement durations.
  - Raw child exit code or signal, timeout/cancellation flags, and unknown values.
  - Output completeness and partial-output locations.
  - Source-bound resource evidence, cleanup actions, remaining resources, and actual errors.
  - A status of `passed`, `failed`, `timed-out`, `cancelled`, or `incomplete`.

  Return wrapper exit `0` only for a passing command/profile. Return nonzero otherwise. Preserve the child’s actual status inside the receipt.

  A failed or missing final receipt fails the gate. GitHub’s cancellation fallback does not extend settlement or supply missing evidence.

- [ ] **Implement the explicit command environment.**

  Construct a whitelist. Do not copy the inherited environment and delete selected names.

  Supply pinned Node PATH, command-private HOME/temp directories, empty task-owned user/global npmrc files, fixed shell/locale, and the job-owned npm dependency cache. Disable notifier, audit, and fund behavior. Exclude provider credentials, GitHub tokens, `NODE_OPTIONS`, and unrelated npm/concurrency settings.

  Use online setup only for reviewed public lock-bound installation. Use `npm_config_offline=true` for product commands. Preserve lifecycle scripts, including `postbuild`. Nested package commands inherit the same cache and offline profile.

  Give each repetition separate temporary directories. Preserve intentional nested `dist` rebuilds.

- [ ] **Run the identical pure tests for GREEN.**

  Require all named tests to pass. Review the implementation and test adapters for accidental real operations.

- [ ] **Add finite hosted qualification fixtures.**

  In `test/ci/test_offline.py`, add `--qualify` and private `--fixture` modes. Exercise real success, exit `7`, deadline, cancellation, and a detached resistant child that outlives its parent. Include an open stream and known root/lock/port in the disposable fixture.

  Add a missing-custody negative case. Its independent fixture owner must retain the identity and clean it within the qualification’s outer settlement bound. That later cleanup must not rewrite the supervisor’s original incomplete receipt.

  Bound the complete qualification to `30` seconds execution plus `30` seconds settlement. Use finite readiness handshakes. Do not run qualification on the user’s host.

- [ ] **Freeze the deliverable for source review.**

  Review actual supervisor, contract, tests, command effects, and denial paths. Passing pure tests permits consideration of hosted qualification. It does not establish runtime correctness.

## Task 3: Add the three-job workflow and command profiles

**Owner:** Sol Max implementer.

**Prerequisite:** Task 2 source is reviewed for bounded hosted qualification.

**File:** Create `.github/workflows/council-goal-offline.yml`.

**Interfaces:** Each job invokes:

```sh
python3 -I -S -B scripts/ci/offline.py job JOB \
  --source "$GITHUB_SHA" \
  --root "$RUNNER_TEMP/council-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT-$GITHUB_JOB" \
  --node "$(command -v node)"
```

`JOB` is exactly `checks`, `diagnostics`, or `defaults`. The checked-in contract selects `bootstrap` or `candidate`; arbitrary event inputs cannot enable another command.

- [ ] **Restrict workflow eligibility.**

  Trigger only on pushes to `dev/issue-1-first-use-reviewed` in `arduinitavares/the-council`. Guard every job for public visibility and the declared branch. Disable automatic retries. A further attempt requires the approved evidenced correction or diagnosis and an explicitly bounded invocation; do not add a blanket first-run-only restriction.

  Use `runs-on: macos-26`. Use `permissions: contents: read`. Add no other permission, schedule, automatic retry, live-provider command, cache publication, or artifact upload.

  Run `checks`, then `diagnostics`, then `defaults` through job dependencies. Failure stops dependent stages. Skipped stages never satisfy acceptance.

- [ ] **Configure pinned checkout and Node setup.**

  Checkout `${{ github.sha }}` using the approved full action commit. Set `persist-credentials: false`, `clean: false`, and `set-safe-directory: false`.

  Use the approved setup-node commit with `node-version: '22.23.4'`, `architecture: arm64`, `check-latest: false`, and `package-manager-cache: false`. Leave cache publication and registry setup absent.

  Record actual Python, Node/npm, OS/image, architecture, and CPU facts. The official actions’ own Node runtime is separate from test Node.

- [ ] **Implement bootstrap behavior.**

  Every fresh VM runs the pure tests and finite real supervisor qualification before any product command. In `bootstrap`, stop there.

  Label this result `bootstrap-qualified`. Do not manufacture npm/build/test receipts or claim final validation. Runtime failure holds product commands.

- [ ] **Implement the candidate schedule exactly.**

  Each job first qualifies its supervisor, then installs dependencies in its own VM.

  | Job | Ordered product payloads | Execution + settlement |
  | --- | --- | --- |
  | `checks` | `npm run typecheck` | `120+30` seconds |
  | `checks` | `npm run build` | `120+30` seconds |
  | `checks` | Isolated causal regression below | `120+30` seconds |
  | `diagnostics` | `npm run build` | `120+30` seconds |
  | `diagnostics` | C12 below | `300+30` seconds |
  | `defaults` | `npm run build` | `120+30` seconds |
  | `defaults` | `npm test`, three consecutive invocations | `180+30` seconds each |

  The isolated causal payload is:

  ```sh
  npm test -- test/pilot/discovery-matrix-fixture.test.ts -t "retains the next case environment"
  ```

  C12 remains:

  ```sh
  npm test -- test/pilot/context-diagnostics.test.ts test/pilot/workflow-diagnostics.test.ts test/pilot/native-command.test.ts test/pilot/allowance.test.ts test/pilot/journal-diagnostics.test.ts test/pilot/provider-diagnostics.test.ts test/pilot/diagnostics.test.ts
  ```

  All builds include npm’s existing `postbuild`. Every default payload is exactly `npm test`. Preserve the ordinary reporter and configuration.

  Dependency setup consumes at most `300` seconds total per job. Job outer limits remain `15/15/20` minutes. Setup or overhead consuming the remaining outer allowance causes an incomplete result; it does not extend a command deadline.

- [ ] **Enforce between-command gates.**

  Start the next command only after inspecting actual exit, output completeness, source identity, and scoped settlement. Verify cleanup between default repetitions.

  Record generated build effects without requiring `dist` to remain byte-identical. Require tracked source/test/configuration inputs to remain frozen.

- [ ] **Review the complete workflow source before publication.**

  Fresh Astra Ultra and Argon high reviewers inspect the identical workflow, supervisor, tests, contract, install-script evidence, and every actual command. The coordinator resolves findings before the first push/run.

## Task 4: Publish selectively and accept bootstrap evidence

**Owner:** Coordinator.

**Prerequisites:** Tasks 1–3 source gates pass. The contract remains in `bootstrap`.

**Inputs:** Reviewed frozen files, protected manifests, hook inspection, supported managed-worktree operations, and current PR2 metadata.

**Output:** One selectively published source revision and its bounded hosted qualification evidence.

- [ ] **Prepare the isolated delivery worktree.**

  Use the verified native managed-worktree route from Task 1. Start from the approved local reference. Copy only explicitly selected reviewed files.

  Exclude incomplete #5 files, private `.superpowers` evidence, journals, and unrelated edits. Never stage the whole directory. Inspect the complete outgoing history and diff, including commits already between PR2’s remote head and the delivery head.

- [ ] **Recheck publication eligibility.**

  Recheck public visibility, Actions settings, remote head, ancestry, hooks, source hashes, and the outgoing file list immediately before publication.

  If a hook would run an unauthorized host workload, stop that operation and retain the exact gap. Do not bypass it through hook suppression or settings changes.

- [ ] **Fast-forward the existing PR branch.**

  Push the reviewed delivery head to `refs/heads/dev/issue-1-first-use-reviewed` without force. An unexpected remote change requires reconciliation and another outgoing-diff check.

  A missing workflow-write/authentication capability stops only publication. Preserve the actual diagnostic.

- [ ] **Inspect the single hosted attempt.**

  Use `gh` to locate the run for the exact pushed SHA, collect ordinary logs and run/job metadata, and wait for terminal state within the declared outer bounds. Do not rerun automatically.

  Require all three fresh-VM qualifications to complete. Inspect negative-case receipts, actual signals, resource cleanup, partial-output handling, child statuses, and final settlement.

- [ ] **Record the checkpoint and reassess.**

  Bootstrap completion establishes the tested supervisor capability only. Any failed qualification requires an evidenced correction or diagnosis before another attempt.

  Preserve raw failed receipts. Freeze and review corrected source before publication. Do not relabel an earlier attempt or reopen the exhausted local runner task.

## Provisional product horizon

Expand these outcomes only after their prerequisites are verified. Preserve the retained product plans and the complete goal.

| Outcome | Prerequisites and expansion condition |
| --- | --- |
| Meaningful #8 RED | Publish the retained plan’s behavior-preserving lifecycle extraction and controlled regression before the owner correction. Freeze the RED commit and test hash. Run the isolated causal command at `120+30`. Require named environment-retention assertion failures and the captured real policy-check mismatch. Setup/import/type errors are invalid RED. |
| #8 correction and GREEN | Implement the retained owner, allocation custody, provider seam, and shipped metadata checks. Freeze the corrected commit. Run the identical causal selection at `120+30`, then the retained focused/boundary checks through reviewed hosted profiles. Preserve the 450-event trace and hardware differences. |
| Fourteen #10 fixture migrations | Follow the retained four-file migration contract. Preserve diagnostic v1, report v2, complete journal bounds, privacy, accounting, and every downstream lifecycle assertion. Keep the separate #5 expectation conflict and unexplained failures open. |
| Integrated candidate | Review integration of the four product corrections, five regression files, #8 work, and #10 migrations. Resolve remaining failures from actual assertions and phase evidence. Historical C14 remains a separate `300+30` diagnostic attempt. |
| Final offline gate | At one frozen candidate revision, require typecheck/build `0`, isolated causal GREEN, C12 `0`, and three consecutive complete default passes with positive settlement. Reconcile baseline identities, multiplicities, original assertions, and additions. Collection alone cannot prove execution. Inadequate ordinary-reporter evidence leaves coverage acceptance open. |
| Complete #3–#10 and parent #1 delivery | Retain shipped reviewer/judge/ballot work, provider qualification, and real second-project acceptance. Hosted offline results cannot establish those outcomes. Obtain fresh whole-change Astra Ultra/Argon high reviews and coordinator disposition before merge. Use `gh` for PR, merge, and issue evidence. |

Existing meaningful RED need not be recreated merely because validation moved hosts. A failed or incomplete attempt remains evidence. A corrected source requires a newly declared bounded attempt; blind reruns are prohibited.

## Evidence and rollback

Keep sanitized command receipts in ordinary job logs. Collect logs and GitHub metadata through `gh` before temporary evidence disappears. Keep private custody evidence and review ledgers out of public commits.

Remove invocation-owned temporary roots only after positive settlement. Unknown ownership or settlement retains the root and fails verification.

Rollback uses reviewed inverse changes or scoped restoration after conflict checks and resource settlement. Preserve baseline bytes and receipts. Do not reset, clean, force-push, restore whole settings snapshots, or erase unrelated work.

## Self-review and readiness

The immediate horizon contains four independently verifiable tasks. Task 1 is ready for bounded discovery after plan review. Later tasks remain conditional on its concrete source mappings.

The plan covers the approved three fresh-job builds, isolated causal RED/GREEN staging, unchanged C12 order, three default repetitions, explicit environment, dependency inspection, actual status/timing, crash-root ownership, selective publication, and later full-goal acceptance.

Unresolved facts remain explicit: complete dependency-script behavior, fixture evidence gaps, the second incomplete #5 path, effective delivery operations, and runtime qualification. None is presented as an existing passing interface.

Planning sources were the fully read canonical model policy, Superpowers writing-plans `7.0.1`, adaptive-planning, and its integration reference. All thirteen mandatory source chunks were read. Supplied platform facts were used as captured evidence; no network lookup, test, build, helper, Git mutation, file write, or hosted execution occurred.
