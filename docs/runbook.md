# Council operations and deployment gate

Version `0.1.0` is a locally tested package with an **unqualified live transport**. Persistent installation and live Council work remain on HOLD for the actual review, route, policy/control, allowance and settlement gaps below. Execution/deployment authorization is already recorded in Ruling 3 and the latest human instruction; reuse it without another general approval request. [Local qualification evidence](qualification/local-macos.md) records the exact missing route controls. A supplied-text Argon assessment is useful review evidence but cannot qualify supervised launches, containment, descendant controls, replay, deadlines, or cleanup. Task outcomes and effort labels are not model-quality guarantees.

## Prepare and invoke

Use Node.js with project-local dependencies. Prepare dependencies explicitly with `npm ci` in the repository, then `npm run build`. The postbuild step copies `src/store/schema.sql` to `dist/store/schema.sql`; the packed store needs this asset. The launcher never installs dependencies or builds implicitly. A symlink installation resolves the real repository path, so retain that checkout and its build.

Explicit invocation is `$the-council`. `agents/openai.yaml` sets `policy.allow_implicit_invocation: false`; unrelated questions must not start a costly Council. The installed client checked for this package is Codex `0.164.0`. A disposable repository-local symlink was discovered through its read-only `skills/list` API with the intended display name and prompt, no skill errors, and positive client exit. No thread or model call was created. Its generated app-server schema exposes skill interface metadata, and its binary includes the invocation-policy key. The list API does not expose that policy field. The [official skill documentation](https://developers.openai.com/codex/skills/) and OpenAI's skill-creator reference describe the explicit policy. Fresh-session discovery of the proposed personal installation remains pending until the deployment gates pass and the link is created.

Require a topic and a complete structured handoff. The CLI's `runInputSchema` in `src/cli/index.ts` and `handoffInputSchema` in `src/input/handoff.ts` are authoritative. The handoff includes decision, outcome, requirements, priorities, constraints, excluded actions, prior decisions, references, uncertainty, candidates, suggested skills, sensitive exclusions, permitted sources/commands/effects, and worker access. Provide explicit empty arrays where appropriate; do not fill missing facts with guesses. It writes a mode-0600 handoff in the OS temporary directory. Loss of required temporary context produces `needs_context`.

The request file also supplies `scope: { sourceRoots, allowedSourceAddresses, checks }` and an optional `runId`. Freeze only authorized canonical roots and exact check argv/cwd/effects/output targets. Do not include credentials or unrelated conversation. Use the installed handoff, orchestration, Orca CLI and language skills linked in [SKILL.md](../skills/the-council/SKILL.md).

From this checkout, commands are:

```sh
node skills/the-council/scripts/run-council.mjs start --workspace /absolute/task/workspace --input /temporary/request.json --json
node skills/the-council/scripts/run-council.mjs inspect --workspace /absolute/task/workspace --run decision-1 --json
node skills/the-council/scripts/run-council.mjs respond --workspace /absolute/task/workspace --run decision-1 --input /temporary/control.json --json
node skills/the-council/scripts/run-council.mjs resume --workspace /absolute/task/workspace --run decision-1 --json
node skills/the-council/scripts/run-council.mjs cancel --workspace /absolute/task/workspace --run decision-1 --json
```

The built equivalent is `node dist/cli/index.js` with the same argv. The launcher passes arguments without a shell and preserves CLI stdout, diagnostics, and exit codes. Exit codes are `0` for a settled unanimous outcome, `2` for settled user/context input, `3` for blocked/unresolved/unverifiable work, `4` for input/usage failure, and `130` for settled cancellation. `inspect` and queued `respond` can return zero without proving run completion. Cancellation may remain pending and unverifiable.

## Select configuration for new runs

The default comes from package-root `council.yaml`, independent of invocation cwd. It contains exactly these named reviewer seats and a separately configured judge:

| Role | Route | Model | Effort |
| --- | --- | --- | --- |
| OpenAI reviewer | codex | gpt-6-astra | ultra |
| Gemini reviewer | antigravity | gemini-4-argon-high | high |
| Claude reviewer | antigravity | claude-opus-5-5-high | high |
| Fresh judge | codex | gpt-6-astra | ultra |

Edit the package-root file for later runs, or supply an explicit configuration file resolved relative to invocation cwd:

```sh
node skills/the-council/scripts/run-council.mjs start --workspace /absolute/task/workspace --input /temporary/request.json --config /temporary/sol-sonnet.yaml --json
```

For Sol Max and Sonnet High, the complete alternative is:

```yaml
version: 1
reviewers:
  openai: { route: codex, model: gpt-6.1-sol, effort: max }
  gemini: { route: antigravity, model: gemini-4-argon-high, effort: high }
  claude: { route: antigravity, model: claude-sonnet-5-5-high, effort: high }
judge: { route: codex, model: gpt-6.1-sol, effort: max }
```

This example does not authorize a launch or qualify those routes. YAML validation rejects unknown fields, duplicate keys, malformed selection values and missing seats. Policy and catalog validation separately require the exact family, route, model and effort. A new model requires new current exact-selection qualification and allowance evidence; there is no silent fallback or hardcoded version substitution. YAML cannot weaken phase settlement, consensus, permission, budgets or attempt controls. A run stores source bytes, canonical configuration, method profile and hashes. Resume uses those snapshots. File edits affect new runs only; there is no hot reload, and `--config` is rejected outside `start`.

## Questions, candidates and limits

Default limits are **2 clarification batches**, **3 deliberation rounds**, **27 worker calls** (`3 * 2 + 7 * 3`), **30 minutes per worker**, and **3 hours of active work** across invocations. Admission reserves counters at the first launch intent, including an unknown external start. No uncounted readiness, format-repair, helper or judge call is allowed. At most four visible active workstreams include the caller; the default one-Astra limit counts an Astra caller. Reuse valid bounded slot authorizations; do not infer them from a configured Ultra role.

Read the [communication contract](../skills/the-council/references/communication.md) for common batches and precise control examples. A batch can ask all seats' questions together, such as rate, data location and budget. If only the rate arrives, submit a partial draft with `finalized: false`; no model starts. Every presented ID, including a nonblocking budget question, needs a sourced answer/status before finalization. Explicit unknown/declined blocking answers remain unresolved. A nonempty first wave completes into a second clarification wave; an all-ready wave can skip the remaining allowance.

When `inspect` exposes `action_required: 'candidate'`, read `pendingCandidate` and its immutable input artifact plus `candidateInputs`. Author a candidate from those records. Submit `kind: 'candidate'` with the current `baseContextHash`, round, evidence hash and all required candidate fields: text, assumptions, tradeoffs, unresolved uncertainty and acknowledged unverified evidence IDs. The caller does not supply ballots. The three settled reviewer tasks precede the fresh judge, and the settled judge precedes confirmation. All three votes bind identical candidate/evidence/judge/config/profile/context hashes. The judge has no acceptance vote.

`respond` only queues a durable request. Keep the active controller alive, inspect its subsequent disposition, and verify publication before claiming answers applied. For questions, this CLI exposes `pendingQuestion` and `answerDraft`; integrations may name that action `questions`. Do not infer an empty batch from a missing alias.

For next-day continuation, preserve the run ID, temporary handoff and artifacts. Confirm all owned resources and the prior controller have positively settled, queue the correlated complete control, then run `resume`. An intentional settled human wait charges zero overnight active budget. Crash downtime and unknown resources remain chargeable. Resume rechecks policy/allowance/ownership and preserves counters and remaining time.

A late question in deliberation round 2 consumes round 2. Its answers publish one common context before round 3; they do not restart clarification or refund calls. A round-3 question leaves no default new round: report unresolved or obtain an explicitly authorized bounded extension. Published-answer corrections use `answer_revision` with predecessor IDs. New facts/priorities use `context_update` at a permitted settled boundary; active deliberation updates wait for settlement and invalidate the consumed round. Clarification-wave updates are rejected for explicit resubmission later.

An unresolved example is: `decision: unresolved`, `state: needs_user`, `settlement: settled`, round limit reached, with the remaining objections and question IDs in the report. A blocked route is operational failure, not reviewer disagreement. Read actual reports and hashes; a final message or exit zero alone is insufficient.

## Ownership, recovery and cleanup

Use the actual task Orca workspace and record host workspace identity separately from private worker cwd. `live`, `unverifiable`, and `exited` are distinct observations. Reconnect only the same proven attempt. Empty observations, contact loss, a ready terminal, `SUCCESS`, and a model's final answer do not prove resource exit. Cleanup requires positive worker, descendant, CLI/MCP, watchdog and watchdog-child settlement. Release only resources owned by that run through its accepted lifecycle authority; never close unrelated terminals.

If prior-controller exit is unprovable, keep the run read-only. Obtain or restore positive execution-host owner/resource settlement receipts before resume. There is **no force-unlock override**, marker deletion, or manual checkpoint repair. A new run still requires prior-resource settlement evidence; it cannot erase ownership uncertainty. Do not reset the store, delete a writer marker, change provider/mode, or manufacture proof to bypass a denial.

The accepted Task 7 boundary remains: evidence recovery requires a correlated accepted `EVIDENCE_RECORDED` event and its CAS completion. If cancellation, deadline, or context diversion occurs before that completion, positive original-resource sidecar proof alone can leave the run unverifiable because version 1 admits no generic completion/core edit for that case. Not all cancellation/recovery permutations complete. Whole-branch review must triage this limitation and the deferred missing-origin corruption guard. This package adds no producer, permission or recovery bypass.

## Diagrams and live qualification

The [canonical source and maps](superpowers/diagrams/README.md) show components, shared clarification, recovery and all 17 states: `preflight`, `needs_context`, `clarifying`, `collecting_questions`, `publishing_answers`, `prepare_round`, `reviewing`, `prepare_candidate`, `judging`, `confirming`, `evaluate_round`, `reconciling`, `needs_user`, `blocked`, `settling`, `completed`, `cancelled`. Reviewer phases are clarify/review/ballot; the separate judge phase is judge. Source reconciliation and static lint/export do not prove native Mermaid rendering or live execution.

![Clarification map](superpowers/diagrams/clarification-map.png)
![Components map](superpowers/diagrams/components-map.png)
![States map](superpowers/diagrams/states-map.png)
![Recovery map](superpowers/diagrams/recovery-map.png)

The current `OrcaTransport` accepts synthetic drivers only. Version 1 targets this local macOS host. Windows and remote execution require separate qualification; a receipt does not extend to another host, transport, version or action class. The ordinary CLI has no qualified live admission provider and stops with `CURRENT_ADMISSION_REQUIRED`; `qualify` requires an explicitly disposable profile and reports `UNQUALIFIED_ROUTE`. This command is an admission check, not an automatic live qualification runner:

```sh
node skills/the-council/scripts/run-council.mjs qualify --workspace /absolute/task/workspace --profile /temporary/disposable-profile.json --json
```

Before deployment require passing fake/runtime/package tests; fresh independent different-family change review under the selected Superpowers seats/fix budgets; completed fresh skill application samples; qualified exact live routes for every selected role, host, version, transport and action class; current policy approval and complete controls for every Ultra role; observed allowance; effective containment; and positive resource settlement. Unknown allowance is not unlimited. No live call is admitted by this runbook. The coordinator owns qualification dispatch and acceptance.

## Dry-run installation manifest

This is a proposal, not an installed link:

```json
{
  "package": "the-council", "version": "0.1.0", "action": "propose-symlink",
  "source": "/Users/aaat/.codex/worktrees/council-implementation/the-council/skills/the-council",
  "target": "/Users/aaat/.agents/skills/the-council",
  "targetStateObserved": "absent at 2026-10-24T21:55:26.574Z; recheck before installation",
  "writePerformed": false,
  "authorization": "existing Ruling 3 and latest human deployment authorization; reuse after gates pass",
  "rollback": "after all Council processes settle, remove only the recorded task-owned symlink"
}
```

Before installation, present the exact source/target, package version and commit, test/typecheck/build and actual pack receipts, qualification decision, source hashes, rollback, current `lstat` target state, and the existing authorization record. An existing file, directory or dangling symlink is preserved and stops installation for a scoped decision. Never replace it automatically. Record owned-link identity and preexisting state when the gates pass and installation occurs. Verify `$the-council` discovery and explicit-only metadata from a fresh client session. Rollback removes only the owned link after all processes settle; it does not restore whole settings files, remove an existing skill, or modify model policy. Ask only for a material new action/permission or a conflicting existing target that the recorded authorization does not cover.

Language profile: Issue 9-oriented technical description. The official dictionary and full ASD-STE100 conformance were not verified. Commands, identifiers, paths and model selections retain their exact forms.


## Packaged native first use

See [the native first-use procedure](../skills/the-council/references/first-use.md) and [issue #1 validation](qualification/issue-1-validation.md). The explicit `native` command is separate from retained controller runs. Build a fresh clone with `npm ci` and `npm run build`. This repair includes real read-only host discovery and native lifecycle commands, but scoped native launch controls and Cursor debit binding remain unverified. A blocked first-use record is not operational acceptance.
