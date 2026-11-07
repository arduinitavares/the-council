# Issue 3 installed-plugin source coverage implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the reproduced omission of the current AGY plugin store from Council's source acquisition and drift detection.

**Architecture:** Extend the existing AGY acquisition path and audit sources. Reuse its existing strict reads, source digests, bounded enumeration and unknown states. This is an incremental implementation task inside the approved complete-inventory design. It does not replace the remaining #3 criteria or certify startup qualification.

**Tech Stack:** TypeScript, Node.js, Vitest and the existing audit contracts. No new dependency.

**Spec:** The user-approved conditional design is `/Users/aaat/.codex/worktrees/council-first-use/the-council/docs/superpowers/specs/2026-11-01-council-gemini-plugin-inventory-design.md`, SHA-256 `60cf740bd15cfc1d294ff3150eccfc48e6928d33507b15cf3ad4a18981af78b1`. The source-backed omission is recorded in the parent campaign's `gemini-inventory-reproduction/report.md`.

## Global constraints

- Preserve the complete #3–#10 objective and every posted acceptance criterion.
- Modify only AGY plugin source coverage and its regressions. Leave Cursor and the paused #9 files unchanged.
- Use current-store location `~/.gemini/config/plugins`, as supported by the retained exact-binary documentation and actual list observations.
- Retain existing recognized roots and their behavior. Do not add legacy parsers or a new version allowlist.
- Do not infer activation from a manifest name or a listing row.
- Preserve unknown states and all existing launch, audit, custody, billing and effective-control gates.
- Do not perform real provider inference, global setup, account changes, process inspection or the consumed agent-list diagnostic.
- Record meaningful RED on unchanged production source before implementation.
- Use Sol Max for implementation. Use fresh Astra Ultra and Argon high reviews through Orca. The coordinator verifies their findings.

## Review focus

- A current-store hook must not disappear while a workspace hook is detected.
- Observed directory metadata changes and tracked candidate-byte changes must invalidate their old source snapshots. Metadata-preserving membership changes still require the complete-inventory witness.
- An absent plugin root must be watched so later appearance is detected.
- Symlinks, unreadable inventory and existing enumeration bounds must remain nonverified.
- Acquiring manifest bytes must not certify enablement, complete discovery or effective containment.

### Task 1: Repair the known installed-store omission with TDD

**Files:**

- Modify `src/pilot/provider-controls.ts`, in the AGY source acquisition branch.
- Create `test/pilot/agy-installed-plugin-sources.test.ts`.
- Create `docs/qualification/agy-installed-plugin-source-coverage.md` with the exact limited result.

**Interfaces:** Consume the existing `inspectProviderControls(selection, version, workspace, billing)` and `currentSourceDigest(source)`. Preserve `ProviderControlEvidence`, `ProviderRecipe`, `AuditSource` and their existing schemas. Add no public input or runtime bypass.

- [ ] Write isolated tests that call the real acquisition function using fake HOME, fake workspace and a fake help-only AGY executable. Use the captured 1.4.12 help fixture and `process.execPath` shebang. Restore environment and await fake-command completion before fixture deletion.
- [ ] Assert that the current-store root, plugin manifest metadata and root hooks are acquired. Assert a current-store command hook contributes an audit effect and keeps startup nonverified. Include a separate recognized workspace control.
- [ ] Assert root absence is tracked. Assert root appearance, observed directory membership metadata changes, removal, and manifest/hook byte changes invalidate the captured relevant source digest. Test disabled manifest metadata without treating it as activation proof. Preserve metadata-restored membership coverage as remaining complete-witness work.
- [ ] Retain explicit symlink and over-100-entry failures. An inventory failure must not produce a verified startup fact. Do not widen bounds to make tests pass.
- [ ] Check root and candidate-path components before reading candidate bytes. A dangling root or symlinked nested manifest directory must produce unavailable inventory. Add real-function regressions for both. Do not follow intermediate links or treat dangling links as absent.
- [ ] Propagate acquisition failures into both inventory-specific unavailable evidence and the initial startup predicate. Include hook-read failures and unresolved hookless candidate metadata. Candidate bytes without verified activation semantics must remain unknown. Test these cases. Verify that unavailable evidence cannot be discharged by the existing disposition path; its authenticated unavailable regression is already in the combined audit suite.
- [ ] Run the new file before any production edit. Use a 60-second outer command limit. Save the full RED output, exact source hash and command receipt. Collection/setup failure is not a behavioral RED.
- [ ] Extend the existing AGY root loop to include the supported current store. Track each root before checking existence. Track discovered plugin-directory membership and candidate metadata at `plugin.json`, `.antigravity-plugin/plugin.json`, `.gemini-plugin/plugin.json`, `.claude-plugin/plugin.json` and `gemini-extension.json` as source bytes. This fingerprints candidates without selecting or activating them. Continue acquiring root `hooks.json` through the existing reader. Preserve unavailable acquisition failures.
- [ ] Keep unsupported parser, enablement and declaration-resolution cases outside positive qualification. Do not claim to implement their missing semantics. If this patch would require such a semantic choice, return it to the coordinator before editing that behavior.
- [ ] Run the new source-importing tests to GREEN. Run `npm run typecheck` and `npm run build`, each with a 60-second bound.
- [ ] After the build, run `npm test -- test/pilot/provider-controls.test.ts test/pilot/control-audit.test.ts test/pilot/agy-installed-plugin-sources.test.ts` with a 90-second bound. The audit tests import compiled code, so rebuilding first is required. Save results. Do not change default test parallelism or unrelated failing tests.
- [ ] Document the tested source acquisition and remaining complete-inventory/startup gaps. Do not claim issue #3 or parent #1 is fixed.
- [ ] Return the complete diff and exact test evidence for independent review. Make no Git mutation. The coordinator commits only the three named files after the reviews pass. Do not push or merge.

## Coordinator ruling and remaining work

Ruling: verified current-store source acquisition can be repaired without resolving every unimplemented loader rule. The location and omission are already supported by primary evidence and a real production-function RED. Missing primary rules still block their semantics and positive complete-inventory qualification. This is an increment toward the approved end state, not a replacement end state. If wrong, the bounded diff is reversible and the independent spec review must block integration.

The current checkout's paused #9 assignment retains exclusive resources and dirty work. A clean managed worktree at the same baseline isolates this task. No existing changes are adopted or removed. Default-suite instability remains #8 work. Full repeated-suite, complete #3 inventory, #4 live startup, #5/#6 Cursor controls and billing, #7 separate-project acceptance, reviewed integration and issue closure remain mandatory campaign work.

## Self-review and language note

The task implements the proven source-coverage defect only. It preserves the complete design and its unverified conditions. Tests observe source acquisition and invalidation rather than duplicate the proposed loop. Existing signatures and exact bounds remain unchanged. The task has one independent acceptance unit and no speculative production interface. This is an STE Issue 9-oriented candidate. The official dictionary and governed terminology are unavailable. Full conformance is not claimed.
