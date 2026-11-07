**Marker:** `council-audit-plan-opus55-medium-20261031-e9a4`

**Spec: PASS.** Tasks 1–5 and the later roadmap cover spec outcomes 1–8 (`specs/…audit-refresh.md:39-50`). The plan keeps the planning-only boundary, leaves Cursor out of ready work and does not touch the older campaign.

**Quality: Changes requested.**

I checked these plan claims against the code, and they hold:
- **Command path:** the `native audit prepare` command at plan:83 is valid. `run-council.mjs:9-17` strips `native` and runs `dist/pilot/cli.js`.
- **No `--json`:** the instruction at plan:87 is correct. The audit parser at `cli.ts:33-34` has no `--json` entry, so adding it fails with `INVALID_AUDIT_ARGUMENTS`.
- **Returned fields:** the fields at plan:73 match `saveAuditSnapshot` (`control-audit.ts:42`).
- **Adoption binding:** spec, binding and result-body rules at plan:155-161 match `control-audit.ts:46,61-75`.
- **Check order:** `acquiredAuditDisposition` does report a missing disposition before it looks at unresolved inputs (`control-audit.ts:91` vs `:99`).
- **Helper effort:** the Astra Max helper rule at plan:137 matches the canonical policy.

## Critical
None.

## Important

1. **The producer is the built `dist` output, not `src`, and the plan never pins it.**
   - Preparation runs `dist/pilot/cli.js` (`run-council.mjs:10`).
   - The tests import `../../dist/...` (`control-audit.test.ts:4-5`).
   - The plan's steps don't account for this:
     - plan:76 says "current code hashes".
     - plan:119 says "RED on unchanged production code" with no build step before it.
     - plan:178 says "producer hashes".
   - **Scenario 1:** `dist` was built from an earlier commit. Task 1 then produces snapshots whose sources and `recipeHash` don't match the reviewed baseline `src`, yet acceptance cites `src` hashes.
   - **Scenario 2:** a new RED test runs against stale `dist`. It fails or passes for reasons unrelated to the change.

2. **The plan never says how to keep inputs stable between preparation and adoption, or how to recover from drift.**
   - The snapshot fingerprints host files that routine work can change:
     - `~/.agents/policies/model-policy.md` (`provider-controls.ts:150-151`)
     - `~/.codex/config.toml` and hook layers (`:199,213`)
     - metadata of the `~/.codex/rules` folder, including `mtimeMs` and `ino` (`control-audit.ts:15`, `provider-controls.ts:214`)
     - AGY `settings.json` and hooks (`:170-172`)
   - **Scenario:** after Task 1, Task 2 launches an Astra or Argon assignment. Codex records project trust in `config.toml`, or a policy edit lands. Task 3 adopt then throws `AUDIT_SOURCE_DRIFT` (`control-audit.ts:81`).
   - plan:126 refreshes snapshots only after a *producer or source change made by Task 2*. plan:168 only checks digests. No step says:
     - re-prepare and re-review after drift that the task itself did not cause, or
     - which provider launches or Orca actions are forbidden between prepare and adopt.
   - The same gap exists between Task 3 and Task 4.

3. **Effect approval is write-once, and the plan reviews it only after the fact.**
   - `adoptAuditSnapshot` writes the disposition exclusively. A different reference for the same hash fails with `AUDIT_DISPOSITION_ALREADY_OWNED` (`control-audit.ts:84-85`).
   - Every Codex snapshot always carries `codex-platform-runtime-reads-and-state` (`provider-controls.ts:222`). Enabled hooks add `startup-hook:*` effects (`:125`). Approving these is a security judgment.
   - Task 3 (plan:170-175) leaves the decision to the coordinator alone. Cross-family review comes only at Task 5 (plan:224), and only "if production code changed".
   - **Scenario:** the coordinator approves a hook effect it should not have. Undoing that means deleting the disposition (destructive) or forcing a new hash. The plan needs an independent review of the disposition set before adopt runs.

4. **The native audit steps name no Orca commands, and real Orca support is unproven.**
   - plan:173 says only "Create the required native audit task and disposition through supported Orca operations".
   - The verifier requires the same terminal to be run coordinator, task creator, dispatch assignee and `worker_report` reporter. Pane keys must match, and the process incarnation must be `ptyId:incarnationId` with a `ptyId` prefixed by the workspace ID (`control-audit.ts:51-73`).
   - The only evidence that this sequence works is a stateful stand-in: `run-create`, `task-create`, `dispatch --to fixture-coordinator`, `send --type worker_done` (`control-audit.test.ts:26-30`).
   - Real Orca behaviour is unverified on two points:
     - whether a terminal can dispatch to itself;
     - whether `send` populates `created_by_*`, `reportedBy`, `processIncarnation` and the `provenance:"worker_report"` result.
   - Task 1 should check this feasibility read-only (orca-cli and orchestration guides) and record the exact commands before Task 3 goes ahead.

5. **Native records must outlive adoption, but Task 5 cleanup could remove them.**
   - Every later preflight re-verifies the disposition live through `run-show`, `worktree show`, `dispatch-show` and `task-list` (`control-audit.ts:49-60`, called from `:96`).
   - plan:232 releases "owned, positively settled resources", and no step marks the audit run, task, dispatch and worktree as retained evidence.
   - **Scenario:** the coordinator archives the Orca audit run, or removes the worktree registration. Task 4, or any later run, sees `AUDIT_NATIVE_DISPOSITION_UNVERIFIED` and the startup-audit facts go back to unknown.

6. **There is no planned outcome for an input that is unresolvable but legitimate.**
   - Some `unavailable` entries come from the host environment and fit neither "source evidence" nor "software defect":
     - `HOOK_RUNTIME_DEPENDENCY_NOT_PINNED` for credential or endpoint hook paths (`provider-controls.ts:133`)
     - `HOOK_DYNAMIC_CLOSURE_UNAVAILABLE` (`:140`)
   - Fixing them would mean changing global settings, which plan:20 forbids.
   - Task 2 (plan:117,140) can end with "names the blocked effects". But Task 3's completion check (plan:181) and Task 4's expected result (plan:207, only Cursor prerequisites) assume all three roles verify.
   - The plan needs an explicit per-role partial or stop branch, with Tasks 3 and 4 revised to match, instead of leaving them unreachable.

7. **The Task 4 expectation assumes audit is the only non-Cursor blocker, and the evidence doesn't show that.**
   - `source-evidence.json:13-19` lists only the pending audit roles.
   - Other facts can block independently of any disposition:
     - exact version contracts: Codex `0.164.0` (`provider-controls.ts:73`) and AGY `1.4.12` (`:166`);
     - AGY required-flag coverage (`:161-163`).
   - The evidence also records AGY executable or version drift (`source-evidence.json:22`).
   - **Scenario:** the installed AGY is no longer `1.4.12`. gemini and judge stay blocked whatever disposition is adopted. Spec:73 forbids changing that contract, yet plan:96 and :207 don't name this as a precondition.
   - Task 1 should record each role's full blocker set and its version-contract match, not only the audit differences.

8. **A source fix in Task 5 doesn't invalidate earlier results.**
   - plan:228-231 allows a fix wave, but only checks hashes after metadata-only updates.
   - **Scenario:** a fix to `provider-controls.ts` changes `recipeHash` or the source set. The Task 3 dispositions and Task 4 outcome are now stale, yet the report cites them.
   - A source fix should send the work back to Tasks 1, 3 and 4, or the report should mark those results invalidated.

## Minor

- **Run ID wording is ambiguous.** plan:35 and :198-199 mean the Council request `runId`, while plan:165 `--run` means an Orca orchestration run (`run-show`, `control-audit.ts:49`). Name the two separately.
- **Reviewer role assumes the author.** plan:138 says "independent Argon review", which assumes Astra wrote the fix. If Argon writes it, Astra fills the cross-family seat. plan:224 should also say which review is the acceptance gate and which is supplemental.
- **Historical snapshot location is unstated.** plan:72 says "recorded historical snapshots" without a location. If they live in the other checkout, state that access is read-only.
- **Preparation is not purely a read.** It creates `.council/control-audits/snapshots` in the checkout (`control-audit.ts:28-35`) and runs each provider's `--help` (`provider-controls.ts:84`). Count these effects in the Task 1 resource and isolation claims.

## Declined judgments

- I did not inspect `run-os-question-fresh.py` or `workflow.ts`, so I can't say whether the preflight lists every blocker or stops at the first. Finding 7 is stated as an evidence gap for that reason.
- No ruling on real Orca self-dispatch semantics beyond the code and the fixture.
- No check of the MCP plan graph against this document, since I did not browse it.
- No check of the actual Astra Ultra or Argon high qualification receipts.
- No ruling on ASD-STE100 vocabulary conformance; the language note correctly claims a candidate only.
- No ruling on whether any particular effect should be approved.

I wrote no files and made no edits.
