# Gemini effort catalog fix

Spec: the current user request: fix only the first ranked blocker, Gemini model/high effort verification through Orca, reviewed independently with Opus 5.5 medium. All other blockers remain outside scope.

## Global Constraints

- Work in /Users/aaat/.codex/worktrees/council-first-use/the-council, branch dev/issue-1-first-use-reviewed, baseline 1e99f2c37e11c74a4f92da4481012c52633c7a35.
- Fix only Gemini/AGY explicit effort discovery. Preserve all other catalog, control, trust, billing, startup, transport and version behavior. No global/provider configuration changes and no permission bypasses.
- Exact target gemini-4-argon-high, effort high. Do not infer supported effort from a model suffix. Unknown or invalid mappings still fail closed. No version pin.
- Use supported Orca CLI/API only; installation files may be inspected as data but do not import/execute private Orca modules.
- Every delegated entry goes through Orca. Read /Users/aaat/.agents/policies/model-policy.md before model/mode selection; no delegation by this implementer. Parent owns independent review and acceptance.
- Preserve all existing untracked work and unrelated sessions. No reset/clean, no push, no unrelated changes.

## Task 1: repair explicit AGY effort contract discovery

Read the Global Constraints copied below as binding requirements. Implement only this task, not the rest of issue #1.

Repository baseline is 1e99f2c37e11c74a4f92da4481012c52633c7a35 on dev/issue-1-first-use-reviewed. Allowed production areas: src/pilot/rpc.ts, and a small adjacent helper if required; targeted tests test/pilot/rpc.test.ts and discovery tests if necessary. Canonical execution policy /Users/aaat/.agents/policies/model-policy.md. No other production file without reporting the need to coordinator first. Preserve existing untracked .superpowers and docs files. No global/provider config, permission, trust, billing, startup, version or transport changes; no private Orca module execution. No helpers or reviewers; coordinator owns delegation/review. No push or full suite (coordinator runs once after freeze).

Root cause: LocalReadRpc.effortSupport source-text regex only recognizes a literal launchArgs arrow. Installed Orca 1.4.245 instead spreads agentChoiceCliApply(antigravity, [{kind:value,names:[--effort],lift:separate-and-long-equals}], --effort). ANTIGRAVITY_EFFORT still explicitly advertises low, medium, high and unknownModelOptions references it with supportsWorkerLaunchPreferences true. Source files: /Applications/Orca.app/Contents/Resources/app.asar.unpacked/out/shared/agent-session-option-catalog-antigravity.js and agent-choice-cli-apply.js. agentSession.options requires a live sessionId, so cannot replace a prelaunch contract check directly.

1. Before ANY production edit, add a meaningful regression fixture matching current installed contract shape, run targeted test RED on unchanged production, and record exact command/output in the report/evidence files. Existing rpc fixture covers the old literal mapping; preserve coverage for old accepted contract unless a concrete supported alternative supersedes it.
2. Repair the prelaunch effort contract recognition without assuming high from model ID or accepting arbitrary high strings. Recognize the explicit current helper declaration only with evidence it maps to the --effort value invocation; inspect helper source as data as needed and include relevant dependency identity in evidence. Keep unknown/missing/invalid choices or mappings unavailable. Avoid broad text matching that accepts comments or unrelated declarations; choose a narrow structured representation or validated static parsing appropriate to existing dependencies. Do not import private app modules or add an Orca version restriction.
3. Add negative cases for misleading/unmapped effort, unsupported choices, and missing/helper-contract mismatch as relevant. Verify installed current mapping is recognized read-only through built LocalReadRpc if possible; do not launch providers or contact reviewers yourself.
4. Run meaningful focused tests (rpc, affected discovery). npm run build. Do not overlap builds with tests and do not run full suite. Self-review scope and report status DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED, commit IDs if any, RED/GREEN commands/results, changed files, source/dependency evidence, and concerns. Commit only task changes after passing checks; do not include plan artifacts or old untracked docs. Do not push.

Write task-1-report.md next to your task brief. Return only status, commits, one-line tests and concerns. Send one worker_done after reporting and settle per the native lifecycle instructions.

Coordinator ruling after initial implementation inspection: full token-stream equality against complete installed source templates would bind unrelated labels/functions and retain the original fragility. Validate required structural semantics instead. A small production Acorn dependency (npm reports 8.19.0; official API parse with ecmaVersion latest and sourceType script) is authorized in package.json/package-lock.json if needed. Add a positive test for harmless label/metadata/formatting changes while preserving all negative mapping/override checks. No private source execution. This is the same task and author, prior RED remains valid; run further RED for the generalized behavior as needed. Broader issue remains out of scope.
