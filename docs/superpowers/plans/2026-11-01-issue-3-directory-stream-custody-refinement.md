# Directory stream custody correction implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve refusal of a substituted directory stream while correcting unrelated ancestor false invalidation.

**Architecture:** Keep traversal custody and selected-node stability from the ancestor-custody amendment. A separate path-based directory open needs a fresh, bounded namespace-stability guard around that acquisition, because the checked file descriptor does not identify the separately opened stream. Ambiguous ancestor changes during that guard remain unknown. Ordinary file reads and cross-observation comparisons do not acquire directory streams and retain the narrower custody rule.

**Tech Stack:** TypeScript, Node22, Vitest, existing filesystem APIs only.

**Spec:** Approved conditional inventory design and `2026-11-01-issue-3-ancestor-custody-amendment.md`. This prospective refinement qualifies that amendment's broad noise wording; it does not rewrite the original evidence or add loader authority.

## Global Constraints

- Same one final corrective Sol Max author/wave, same four source/test files and one final paired scoped review. No new dependency, process, undocumented Node internal, public schema or permission change.
- Preserve selected-node/descriptor ctime, custody, exact absence recheck, complete bounded listings, refusal behavior and every original budget.
- Refuse ambiguous namespace change during separate stream acquisition. Do not claim universal tolerance of ancestor churn. This is a conservative availability limit, not proof that every namespace change was a substitution.
- The current Node22 public `opendirSync` accepts a path and returns `fs.Dir`; its documented API does not expose a descriptor for fstat. This is distinct from the descriptor returned by `openSync`. Primary reference: https://nodejs.org/docs/latest-v22.x/api/fs.html#fsopendirsyncpath-options . Context7 was queried first but returned mainly libuv material; the version-matched official API supplied the needed signatures.

## Review Focus

- Temporarily replacing/restoring an ancestor during the path-based open must not return substituted names as present.
- Selected-directory mutation and ancestor custody changes must remain unknown.
- Ordinary unrelated sibling changes before the separate stream guard remain tolerated.
- Ambiguous churn during the guard must be explicitly refused and documented, with no fallback.
- All original bounds, exact absence and static cross-observation counterchecks remain covered.

### Task 1: Close the verified stream substitution regression

**Files:** Modify `src/pilot/inventory-io.ts`; test `test/pilot/inventory-io.test.ts`. The same wave retains ownership of the two original static inspector files but does not expand its API.

**Interfaces:** Consume existing components and selected descriptor observations. Preserve all public signatures and `InventoryRead` return types.

- [ ] Add maintained coverage from `concurrency-evidence/ancestor-aba.test.ts`; preserve root postfix failure and exact ba792 copied-source control.
- [ ] Record RED on the first correction before editing production, with full source/test snapshots.
- [ ] Use only supported APIs for a bounded conservative guard around any separately named directory acquisition. Do not infer stream identity from `dir.path` or from another open descriptor. If required guarantees remain unavailable, report the exact gap.
- [ ] Run `npm test -- test/pilot/inventory-io.test.ts test/pilot/agy-materialization-state.test.ts` without serialization (120 seconds), then `npm run typecheck` (120 seconds), binding identical test bytes and final source hashes.
- [ ] Preserve the initial report and return a follow-up report. Coordinator verifies source, root probes, build/dist bindings and broad results before the one paired scoped re-review. Full issue3 integration remains provisional.

## Self-review and language note

The refinement follows the maintained writing-plans structure. All named APIs come from current source and Node22 documentation. The existing four-file corrective scope and all five review conditions have decisive checks. No unsupported descriptor API or loader rule is invented. This corrects a verified in-inspection regression; it does not claim an atomic filesystem snapshot. Full STE conformance is not claimed because the required dictionary/glossary resources are unavailable.
