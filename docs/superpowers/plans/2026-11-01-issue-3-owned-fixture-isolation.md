# Inventory fixture isolation correction implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the two inventory unit suites stable, independently owned fixture namespaces while retaining conservative acquisition guards and all race assertions.

**Architecture:** Keep production bytes unchanged. Each test file creates disposable cases beneath its own existing checked-in fixture parent. Creating a child inside one parent does not change the other parent's ancestor membership. Keep the two empty parent directories through tracked `.gitkeep` files; remove only each suite's owned disposable container after its tests settle.

**Tech Stack:** TypeScript, Node22 filesystem APIs, Vitest; default parallel execution.

**Spec:** The conditional inventory design, ancestor-custody amendment and directory-stream refinement. The default nine-file run on the current correction failed20/638, exclusively in the two inventory suites. Several explicit diagnostics identify `INVENTORY_UNSTABLE` at the shared macOS temp root. The short named-acquisition guard must remain; unqualified universal noise tolerance is not an acceptance claim.

## Global Constraints

- Same final Sol Max author/wave; the one paired scoped re-review has not started.
- Do not alter production sources, expected states/assertions, deliberate sibling/substitution injection, budgets, public APIs, global test configuration, concurrency, timeouts, provider fixtures or other issue code.
- Do not remove guards, mock away real ancestor stability, retry unknown observations, or set a global TMPDIR.
- Each suite uses its own fixture parent and unique owned disposable container. Cleanup only that container. Never remove tracked parents, other sessions' fixtures or the real project's `.council`.
- The reviewed fixture files are empty markers only; they add no agent/provider instructions or runnable content.

## Review Focus

- Both suite fixture parents exist on a fresh checkout before parallel tests begin.
- Neither suite's setup/cleanup changes a shared ancestor namespace used by the other.
- All deliberate ancestor churn and substitution counterchecks retain the same assertions and real filesystem effects.
- The exact nine-file command retains default file parallelism and original timeouts.
- No tracked file or fixture owned by another task is changed or removed.

### Task 1: Isolate the two owned unit fixture parents

**Files:** Modify `test/pilot/inventory-io.test.ts`, `test/pilot/agy-materialization-state.test.ts`. Create empty `test/pilot/fixtures/inventory-io-workspaces/.gitkeep` and `test/pilot/fixtures/agy-materialization-workspaces/.gitkeep`.

**Interfaces:** Consume existing suite fixtures and supported Node path/module APIs. Preserve every test's public production calls, names, assertions and deliberate race semantics.

- [ ] Verify the existing root failed receipt `final-verification/focused-01.log.receipt.json` against current entry production/test hashes. It is the actual default-parallel RED (20 failed,618 passed). Do not rerun unchanged solely to reproduce the same check.
- [ ] Create the two empty marker files; choose each file's distinct fixture parent relative to that test module. Create its unique disposable suite container under that parent. Preserve per-case ownership and cleanup. Do not infer the parent from a mutable process cwd.
- [ ] Run `npm test -- test/pilot/inventory-io.test.ts test/pilot/agy-materialization-state.test.ts` (120seconds), then the exact original nine-file command from the failed receipt (300seconds), without serialization, retries or changed timeouts. Record before/after full manifests including the two new marker files, source/test snapshots, logs and actual failures.
- [ ] Run `npm run typecheck` (120seconds). Verify original production hashes and every assertion/race action are unchanged; only setup/imports and the empty markers may differ in this followup.
- [ ] Return a concise report and complete evidence. Coordinator verifies it, runs one post-final-change default full suite and the one paired scoped re-review. Complete issue3 and loader integration remain provisional.

## Self-review and language note

The source supplies the existing per-file fixture setup. The observed parallel failure and supported filesystem membership behavior justify changing fixture location rather than production refusal semantics. All five review conditions have direct source/evidence checks. This is a test-only correction within issue3 mechanics, not an implementation of the separate issue8 design. The maintained writing-plans structure is used; full STE conformance is not claimed without the missing dictionary/glossary resources.
