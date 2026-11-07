# Inventory ancestor custody correction implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct verified whole-increment finding M1 / IW-01 / IW-02 without weakening selected-source stability or absence evidence.

**Architecture:** Traversal ancestors establish custody. Selected files and observed directories establish content and membership stability. Compare full identity, including ctime, for selected nodes; compare dev, ino, uid, gid, mode and type for traversal-only ancestors. Recheck the exact initially missing edge before returning absence.

**Tech Stack:** TypeScript, Node filesystem APIs, Vitest.

**Spec:** Approved conditional design at `/Users/aaat/.codex/worktrees/council-first-use/the-council/docs/superpowers/specs/2026-11-01-council-gemini-plugin-inventory-design.md`; original reviewed witness plan at `/Users/aaat/.codex/worktrees/council-issue3-inventory/the-council/docs/superpowers/plans/2026-11-01-issue-3-inventory-witness.md`.

## Global Constraints

- This is a prospective narrow amendment to Task2's component ctime rule. Preserve the original reviewed plan and all RED receipts. Full selected-node stability still includes ctime. A directory actually listed is a selected node.
- Keep public schemas, exact return types, bounds, refusal semantics, no-follow custody, stored bindings and unknown states.
- In the static inspector, only ancestors strictly above the requesting workspace use custody comparison across observations. Nodes at and beneath the workspace keep full identity checks and current-owner checks.
- Recheck an initially missing exact edge with lstat after stable-parent checks. If it appears, return unknown without reading its payload. A non-ENOENT error remains unknown; never fall back after refusal. Check parent custody around this recheck. This detects in-inspection changes, not future races.
- No loader, plugin, startup, effect, permission, account or Cursor authority is added. Deferred Task3/Task4 minor validation findings remain open before future integration.
- Use one fresh Sol Max implementer and one scoped paired re-review by Astra Ultra and Argon high through Orca. The coordinator verifies claims and owns integration. No second final fix wave.
- Source ownership is limited to the four files below. Preserve all unrelated work and evidence.

## Review Focus

- Unrelated sibling creation above a selected file/JSON/directory must not invalidate unchanged bytes or membership.
- An initially absent edge appearing during verification must yield unknown, with no payload consumed.
- A traversal ancestor changing inode, type, owner or permissions must still yield unknown.
- A selected file or observed directory changing ctime must still yield unknown.
- A sibling above the workspace changing between individually successful observations must not invalidate a coherent static set; changes to observed workspace membership must remain unknown.

---

### Task 1: Correct traversal custody and retain absence stability

**Files:**
- Modify: `src/pilot/inventory-io.ts`
- Modify: `src/pilot/agy-materialization-state.ts`
- Test: `test/pilot/inventory-io.test.ts`
- Test: `test/pilot/agy-materialization-state.test.ts`

**Interfaces:**
- Consumes: existing `NodeIdentity`, `InventoryRead<T>`, `ReadReceipt`, `InventoryFileBinding` and existing IO exports.
- Produces: unchanged `readInventoryFile`, `readInventoryJson`, `listInventoryDirectory`, and `inspectAgyMaterializationState` signatures and return types.

- [ ] **Step 1: Add maintained regression tests before editing production.** Reuse the independently reproduced inert sibling cases from `.superpowers/sdd/2026-11-01-issue-3-inventory-witness/concurrency-evidence/`. Assert file, JSON and directory remain present with unchanged selected bytes/inode/listing; assert static result remains complete when all ten observations are present and an unrelated sibling above workspace changes between them. Add exact absence appearance, ancestor custody-change and selected-node ctime checks. Assert no payload read for appeared missing edges and retained path budget limits.
- [ ] **Step 2: Record RED on unchanged production.** Run `npm test -- test/pilot/inventory-io.test.ts test/pilot/agy-materialization-state.test.ts` without serialization, using the existing bounded-command runner with 120 seconds. Capture full source/test manifests and byte snapshots before and after. Preserve original failed logs.
- [ ] **Step 3: Correct the two comparison scopes.** Keep full selected-node comparisons; add a narrow ancestor-custody comparison. In absence verification, recheck the exact missing edge without consuming payload and verify parent custody around it. In static `remember`, use full keys at/beneath workspace and custody keys strictly above workspace. Do not change public witness/store APIs or selected membership rules.
- [ ] **Step 4: Verify the same test bytes.** Rerun the exact affected command, without serialization, with final source/test manifests. Run `npm run typecheck` with 120 seconds. Report any unrelated failures honestly. Do not run the full suite in the worker.
- [ ] **Step 5: Return the complete fix wave for coordinator verification.** Report exact file hashes, original RED, covering GREEN, typecheck, scope, concerns and rollback. No worker Git mutation. The coordinator commits the four files only after evidence verification.

### Coordinator verification and scoped review

- [ ] Preserve the original failed default run (62 failures) and the four independent RED assertions. Re-run those probes with fresh GREEN log names after the correction.
- [ ] Run build and typecheck, then the original nine focused files with default parallelism. Capture exact tracked source and all compiled `dist` hashes before/after each integration check. This corrects M2 prospectively; do not invent compiled provenance for prior runs.
- [ ] Observe one post-change `npm test` default full run with a 600-second bound, preserve every failure, and verify all owned processes settle. Do not edit #8 code or classify unrelated failures without evidence.
- [ ] Update qualification docs with new exact results and remaining loader boundaries. Freeze the fix-range artifact; run exactly one paired scoped re-review. Include the original reports, rejected Argon claims, this amendment, original RED and new GREEN evidence. Require findings against actual functions and hashes.
- [ ] Record canonical checkpoint, independent review and coordinator dispositions. Update draft PR11 through GitHub CLI only when the final artifact is reviewable. Do not merge or close #3 while its acceptance criteria remain unmet.

## Authoring and self-review note

Used maintained Superpowers writing-plans 7.0.1, plus adaptive-planning's Superpowers authoring contract. This is a corrective plan inside the already authorized SDD execution; it adds no user approval requirement. Source inspection establishes all named APIs. The five Review Focus conditions map to the one owned regression task. No loader facts are inferred. Future Tasks5–7 remain provisional and retain all unresolved prerequisites. New prose uses plain technical English; dictionary/glossary resources for full STE conformance were unavailable, so no full conformance claim is made.
