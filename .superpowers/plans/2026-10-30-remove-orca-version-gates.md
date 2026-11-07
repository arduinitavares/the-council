# Remove Orca version restrictions

## User specification

The user explicitly requests removing every Orca version restriction: Council must accept any Orca version number, rather than an exact version, allowlist or minimum/maximum range.

## Global Constraints

- Work only in /Users/aaat/.codex/worktrees/council-first-use/the-council on the existing dev/issue-1-first-use-reviewed branch. Preserve all existing work and private evidence.
- Remove all version-number admission checks for Orca. Do not substitute another version allowlist or range. Retain actual readiness, required-command/capability, client export/method, workspace/runtime identity, permission, model, billing and lifecycle checks. Recording the actual version and invalidating cached proof on runtime drift are evidence, not a supported-version gate.
- Preserve historical dated qualification evidence. Update current-use instructions and version-labelled source metadata to avoid suggesting the current host must be 1.4.244.
- The canonical execution-host policy is /Users/aaat/.agents/policies/model-policy.md. Orca executable /usr/local/bin/orca; CLI/API only, no desktop startup/focus, settings, trust, billing or permission changes. No provider calls from Council during unit tests. No reset, clean, unrelated edits or destructive operations.
- Coordinator owns integration and independent review. Fresh Opus 5.5 medium through Orca/AGY reviews the frozen change. This is a newly authorized narrow change, not another attempt to repair the previously parked control/lifecycle findings.

### Task 1: Accept every Orca version string

1. Read src/pilot/discovery.ts, src/pilot/rpc.ts and their tests. Inventory production Orca-version admission checks; inspect remaining literal labels in src/pilot/allowance.ts and current-use docs.
2. Add meaningful regression tests first and record RED on unchanged production code. Exercise the real NativeHostInspector and installed-client loader through existing synthetic host fixtures for the installed patch version, a different older/major version, and a development version string. Assert they get past version admission and retain genuine missing-export/runtime/capability failures. These are synthetic compatibility-shape tests, not live provider qualification.
3. Remove every exact/range/allowlist admission check for Orca versions. Do not loosen other controls or mask missing exports/capabilities. Remove the loader's now-useless subprocess/version read when not otherwise needed. Keep actual version as observed metadata in host evidence/cache. Make current source labels version-neutral or use the observed version.
4. Update skills/the-council/references/first-use.md to describe version-independent admission and distinguish inspected historical evidence from supported feature requirements. Do not rewrite historical qualification reports.
5. Run focused regressions, full npm test with at most two workers, npm run typecheck and npm run build. Record all actual exit codes and full logs in this plan workspace. Self-review the diff and ensure no production Orca version gate remains.
6. Commit only task-owned source/test/current-use documentation files. Do not stage the original three untracked docs or private artifacts. Do not push; coordinator owns PR integration.
7. Write the implementer report alongside the task brief with RED/GREEN evidence, commands, changed files, commit and concerns. Return DONE/DONE_WITH_CONCERNS/BLOCKED/NEEDS_CONTEXT and report path. Do not dispatch helpers; this small task needs one writer and the coordinator will assign independent review.

### Task 2: Accept empty CLI version output in the shared client

The scoped review found a pre-existing presence restriction at src/orca/client.ts:108-109: after successful --version execution the shared client rejects empty output with ORCA_VERSION_UNKNOWN. Remove that rejection as part of the user's instruction to remove ANY Orca version restriction and the coordinator's explicit decision to accept unreported metadata. A successful empty or whitespace-only version response should be recorded as the string unexposed. Preserve arbitrary nonempty version output (existing trimming behavior is fine), successful guide reads, executable/cwd constraints, process timeout/overflow/exit handling, and all real guide/permission errors. Do not suppress command failure or introduce a replacement gate.

Add a behavior regression before implementation using the existing real fake-Orca executable/process boundary and OrcaClient.connect; verify empty/whitespace version output permits successful guide acquisition and records unexposed, with arbitrary newer/development output still accepted. Record RED on unchanged production. Then make the minimal normalization, run focused client/protocol tests and typecheck/build, followed once by full npm test -- --maxWorkers 2 with stable source/build (allow at least eight minutes; normal suite duration is about330seconds). No overlapping builds or further full-suite retries without concrete new evidence. No real provider calls, global changes, helpers, unrelated production repairs or push.

Only src/orca/client.ts and directly relevant test fixtures/tests may change. Preserve other source, original untracked docs and all private evidence. Append task2-report.md in this plan workspace with command/results, RED/GREEN, exact commit, actual model/effort/cwd, concerns. Commit only task files and report short status. Fresh native Sol medium via Orca, standard context; canonical host policy /Users/aaat/.agents/policies/model-policy.md and TDD skill apply. Coordinator owns independent review and integration.
