# Task-scoped hosted macOS validation design

Status: revision 2, corrected after independent review and coordinator verification. This is a validation design for user choice, not an implementation plan or permission to launch a workflow. No CI file, product source change, commit, push or hosted job has been created.

## Purpose and alternatives

Finish the actual offline verification needed for issues#8-#10, then continue the full approved#3-#10 goal. The required result remains reviewed fixes merged into dev/council-implementation, all eight issues closed with evidence and parent#1 real second-project acceptance. This proposal changes the offline validation environment, not those results.

The existing local route needs a concrete product protocol: the generic runner currently supports only qualification-v1, and its completed real125/0/124 fixtures do not admit build/typecheck/Vitest. Continuing locally means further source discovery, design and qualification of those resource mappings. The old Linux Docker experiment covers one discovery file and39 archives, not the full suite; its host-custody D1 problem remains unresolved.

The recommended alternative is a task-scoped GitHub Actions workflow on the existing PR2 head branch, using standard macos-26 virtual machines. Each job gets a fresh VM and GitHub decommissions it after the job. This separates the test workload from the user's computer and unrelated sessions. Existing fixture cleanup assertions and evidence remain mandatory inside the job; VM disposal cannot replace them.

## Verified capability and limits

The repository arduinitavares/the-council is public; Actions is already enabled with allowed_actions=all. There are zero existing workflows. PR2 is draft/open, head branch dev/issue-1-first-use-reviewed at53be0fe7d654d4667f9d873c4d1b81ec54d6f1c6, base dev/council-implementation at22782d25097dec67daa38203362b9ad4ba78e680. The local reviewed worktree is3f3c3cdf63130d4aa27037c8f0d42ed5fd36dd8b with preserved unrelated/incomplete local Cursor work.

GitHub's current primary runner table lists macos-26 as standard arm64/M1,3CPU/7GB. Standard hosted runners are free on public repositories. This is not a larger or self-hosted runner. The local machine is macOS26.7.1/arm64; CI hardware/image versions differ and must be recorded. Three CI passes do not certify every local hardware/concurrency combination.

Sources:
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job
- https://docs.github.com/en/actions/concepts/billing-and-usage
- https://docs.github.com/en/actions/how-tos/manage-runners/github-hosted-runners/use-github-hosted-runners

GitHub cancellation first signals the step entry process, waits7.5seconds, then TERM/2.5seconds, then kills the process tree. The server may force termination after5minutes. This is not a universal30second cleanup guarantee. A cancelled, disconnected, overdue or unverified attempt is incomplete and cannot pass. Preserve the actual timestamps/status and require terminal job state; do not reinterpret a timeout or VM disposal as successful fixture cleanup.

Source: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-cancellation

## Proposed workflow and scope

A Sol Max implementer would author a task-scoped workflow, tentatively .github/workflows/council-goal-offline.yml, and a bounded command-status/environment supervisor. The supervisor is required to enforce each execution deadline and the separate settlement deadline, retain partial output and actual child status, and report fixture-owned resource settlement. Unknown settlement or missing evidence fails the gate. Its reviewed implementation must use the actual tests' resource ownership/evidence rather than assume that a process sample proves universal cleanup. This design does not select the local qualification-only runner as that implementation.

The first workflow trigger is push to the existing PR2 head branch, with no automatic retry or rerun loop, schedule or live-provider path. Each selected source revision gets one bounded validation attempt. A further attempt needs a verified source correction or a new evidenced diagnosis. All model implementation/review entries continue through Orca; CI runs ordinary offline commands, not AI workers.

Every job must guard that the repository is public and use only macos-26. Permissions are contents:read, with every other permission absent. Checkout uses the exact event commit and persist-credentials:false. Pin official checkout/setup-node actions to verified full commit IDs. Pin test Node to22.23.4 and disable setup-node package-manager caching. No artifact upload, cache publication, release, billing/permission setting change or account setup is part of this first design.

Job stages:
1. A fresh VM installs locked dependencies, runs npm run typecheck and npm run build.
2. A second fresh VM installs dependencies, runs its own bounded npm run build including postbuild, and runs the existing seven-file C12 diagnostic command in its unchanged order.
3. A third fresh VM installs dependencies, runs its own bounded npm run build including postbuild, and runs exactly three consecutive default npm test commands. They share that VM/image and declared job-owned dependency cache, but use declared task-owned temporary directories. Stop the sequence at the first nonzero, timeout, unknown or incomplete result. Verify fixture settlement between repetitions. Record expected nested build effects rather than falsely require the generated dist tree to remain byte-identical when existing tests intentionally rebuild it.

C12 paths remain context-diagnostics.test.ts, workflow-diagnostics.test.ts, native-command.test.ts, allowance.test.ts, journal-diagnostics.test.ts, provider-diagnostics.test.ts and diagnostics.test.ts, all under test/pilot/. These tests import dist directly; dist is not tracked, so every fresh test job needs its own build. No job assumes another VM's generated files are present.

The cause-specific isolated #8 regression is mandatory. Preserve the approved fixture design and existing 450-event causal trace. The implementation plan must specify the bounded old-source RED and corrected-source GREEN commands and their staged source identities before either run. Setup/import/type errors do not establish RED. Record any hardware/concurrency difference from the original macOS failure; a clean result on the smaller CI runner cannot erase the original failure or by itself explain it. Existing meaningful RED evidence remains evidence; rerunning every historical baseline is not required merely to move validation environments. The isolated regression never replaces a default-suite run.

Per-command budgets remain120seconds execution+at most30settlement for typecheck/build,300+30 for C12 and180+30 for each final default repetition. The historic C14 budget is300+30 and remains a separate diagnostic attempt. Dependency installation is setup, capped at5minutes per job. Proposed outer job bounds are15minutes for stage1,15minutes for stage2 and20minutes for stage3, including setup and overhead. These outer bounds do not extend any command deadline or prove timely cleanup. Separately staged RED/regression commands need their exact finite budgets in the reviewed implementation plan. Implementation must expose actual command exit/status and timing, and show that cancellation/cleanup measurement can enforce or conservatively fail the declared limits. If the hosted API cannot provide the necessary budget/evidence, keep that part blocked; do not silently replace it with a weaker check.

Pass only when every mandatory command actually ran and exited0 at the same frozen source revision. Skipped jobs/steps, expected-RED runs, cancelled jobs and partial totals never count as successful verification. Keep Vitest's default concurrency, existing assertions, all11 discovery version rows, zero-input accounting and cleanup checks. Do not introduce serial flags, broader timeouts, skips or globally installed-provider requirements.

## Environment, publication and TDD

Use an explicit process environment for npm/test commands: pinned Node PATH, private HOME/temp/cache, empty task-owned user/global npmrc, fixed shell, disabled notifier/audit/fund and no provider credentials, NODE_OPTIONS or unrelated inherited settings. Installation may fetch public lock-bound packages; inspect declared install-script downloads in the implementation plan and preserve their source/version evidence. Test commands use the declared offline profile. npm offline configuration is not an operating-system network denial; verify the tests' actual network behavior and do not claim stronger containment. Reuse one job-owned dependency cache where required for nested package tests, without publishing it. Do not dump environment values.

Record source commit/tree, lock hash, Node/npm versions, OS/image/architecture/CPU information, exact commands, actual exit/status, durations and available fixture lifecycle facts in ordinary logs. Collect sanitized logs and GitHub job/run metadata through gh. Default logs are evidence; a green top-level workflow alone is insufficient. Real reviewer responses, judge comparison and ballots for#7 remain separate shipped-producer work on the approved host.

Before publication, inspect relevant commit/push hooks so they do not silently run an unreviewed local workload. Preserve all existing work, global hooks/settings, local journals and private .superpowers evidence. The current PR head is an ancestor of local HEAD. Prepare selected reviewed commits in an isolated delivery worktree, then fast-forward the existing PR branch only after rechecking that relationship and the complete outgoing diff. Keep the dirty #5 files and private evidence out of that promotion. Never stage the whole working directory. Do not force-push, reset, clean or alter permissions to overcome a refusal. Missing workflow-write/authentication capability stops only that publication route with the exact diagnostic retained.

Retain the small reviewed workflow as ordinary PR validation when PR2 merges into dev/council-implementation. Keep its trigger restricted to the declared issue branch unless a later separately reviewed design expands it. This first design adds no scheduled or recurring activity after the branch is retired.

Use the existing reviewed source/test snapshots and plans:
- The four product corrections and five regression files in the nine-file frozen diagnostic candidate remain separate until integration is reviewed.
- Where a fresh public RED is needed, promote tests before the corresponding production correction and require named assertion failures on unchanged behavior. A setup/import/type error or aggregate failure is not meaningful RED.
- The reviewed fourteen-case diagnostic fixture migration plan and approved#8 deterministic fixture design remain the implementation contracts. Preserve every behavioral assertion and versioned diagnostic contract.
- After each verified change, freeze/review actual bytes, run one bounded CI attempt and investigate actual failures. No blind repeated attempt or silent source change is permitted.
- The exhausted local support-runner correction task remains closed at5/5. Moving validation environments does not reopen it or reset its breaker. Fresh implementation tasks retain the applicable Superpowers fix budgets; reaching a task's breaker requires coordinator reassessment, not another disguised round of that task. The full goal and independent work remain in scope.
- The final gate is three consecutive default passes plus typecheck/build0, issue-specific evidence, fresh whole-change Astra Ultra/ArgonHigh reviews and coordinator disposition before merge. Use gh for PR updates/merge/issue evidence.

Successful hosted validation can support offline code acceptance. It cannot qualify Gemini startup, Cursor controls/billing, or parent#1/#7 live acceptance. Those dependencies and the complete goal remain unchanged. A known leaking fixture or incomplete cleanup remains a defect even if the VM is later destroyed.

## Approval boundary

The requested user decision is the validation environment: adopt this hosted design or continue the local mapping investigation. Approval would cover authoring and reviewing this task-scoped workflow and, after its source gate, bounded goal-related validation runs within these terms. It grants no live provider call, global setting, paid overflow, permission expansion or weakening of acceptance. An implementation plan follows the selected/approved design.

The code and all actual workflow commands must receive the required fresh Astra Ultra/ArgonHigh review through Orca before the first push/run. The coordinator verifies findings and runtime evidence rather than accepting reviewer agreement.


Verified action references:
- checkout: d23441a48e516b6c34aea4fa41551a30e30af803
- setup-node: 949feb2413d6458794dcd2491c4babbbce0c15c1
