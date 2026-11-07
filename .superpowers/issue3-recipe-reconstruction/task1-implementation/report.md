# Task1 implementation report

Status: DONE. Work stayed in the requested checkout at HEAD `13c045f`. No helpers, commits, pushes, merges, real provider calls, plugin/hook execution, global settings, account, or spending changes. Existing evidence and unrelated files were preserved. Test fixtures use the existing disposable fake-help executable harness.

Implemented `buildAgyRecipePlan({ selection, version, workspace, executable, legacySettings, agyHookShell }): AgyRecipeInputs`. It reconstructs the existing agent bytes, permission/Deny merge, session JSON, hashes, paths, argv, expected permission, and optional supplied hook policy. The inventory witness and wrapper contracts are type-only imports. Runtime imports are Node computation utilities and the existing pure selection parser; compiled output has no inventory/provider-controls import.

The inspection path consumes the builder and suppresses recipes when controlling settings are malformed or the existing settings acquisition has reported unavailability. Missing settings remain permitted and source-tracked as absent. Malformed roots, permissions objects, and non-string/sparse Deny arrays raise `AgyRecipeSettingsError` with `AGY_RECIPE_SETTINGS_INVALID:<field>`. Source tracking, collision checks, unrelated facts, audit calculation, and effective-input gates remain in the existing inspector. No inheritance control, permission expansion, version gate, startup qualification, or effect authority was added.

Changed application/test paths:

- `src/pilot/agy-recipe-plan.ts` (new)
- `src/pilot/provider-controls.ts` (AGY recipe construction and recipe-admission condition)
- `test/pilot/agy-recipe-plan.test.ts` (new)
- `test/pilot/provider-controls.test.ts` (related AGY cases)

Additional task evidence is confined to this directory. `implementation.patch` includes all four files, including the new files. `source-sha256.json` identifies the frozen bytes for review.

TDD evidence before any production edit:

```sh
npm test -- test/pilot/provider-controls.test.ts -t "rejects malformed AGY controlling settings"
```

Exit 1: 9 failed, 76 skipped. Exact output is `red-output.log`; invocation and exit receipt are in `red-command.txt` and `red-exit-code.txt`. Failures were malformed permissions (`"deny-all"`, null, array), malformed Deny (string, null, object, mixed string/number array), and malformed settings roots (array, null). Eight cases failed the expected unavailable-reason assertion against `[]`; object-valued Deny raised the existing production `TypeError: ((intermediate value) ?? []) is not iterable`. This was real boundary execution, not an import/collection failure.

Before production edits, the characterization command also passed against the original inspector:

```sh
npm test -- test/pilot/provider-controls.test.ts -t "preserves the existing AGY recipe bytes"
```

Exit 0: 1 passed, 85 skipped. See `valid-before-output.log`. Literal expected agent/session bytes, complete argv, permission, identities, paths, and hashes are checked by that maintained test and still pass after extraction.

An additional self-review RED used `npm test -- test/pilot/agy-recipe-plan.test.ts`: 3 failed / 16 passed. Non-record settings (`Date`), non-record permissions (`Date`), and a sparse Deny array were accepted before tightening the shape checks. Each failed with “expected function to throw an error, but it didn't.” See `validation-red-output.log`. These now pass.

Final GREEN commands:

```sh
npm test -- test/pilot/agy-recipe-plan.test.ts test/pilot/provider-controls.test.ts
npm run typecheck
npm run build
git diff --check
```

All exit 0. Focused tests: 2 files passed, 106 tests passed (19 recipe builder / 87 provider controls), duration 16.45 seconds. Final logs are `green-output.log`, `typecheck-output.log`, `build-output.log`, and `diff-check-output.log`, with corresponding exit receipts. Earlier focused runs passed 102 and 103 tests while coverage was being extended; logs were retained as `green-attempt1-output.log` and `green-attempt2-output.log`.

Every other observed failure: the initial typecheck and build both reported TS2322 at the returned selection because `ModelSelection.effort` is a string while the recipe schema narrows it. Fixed by using the same `selectionSchema.parse` already used by inspection. The original diagnostics remain in `typecheck-attempt1-output.log` and `build-attempt1-output.log`. No unresolved focused, typing, build, or whitespace failures remain.

The whole suite was not rerun, per assignment. Recorded default baseline supplied by root: **1527 pass / 14 fail**, open under #8. Root owns the whole-integration test gate and fresh Astra Ultra / Argon high acceptance reviews.

Self-review inspected the actual changed production/test diff and both new files. Checked valid byte preservation; inherited Deny order/deduplication and unrelated permission fields; immutable/frozen inputs; absent versus unreadable settings; named invalid-input failure and recipe suppression; hook-policy passthrough; unchanged collision/source/audit code; no runtime inventory/provider-controls cycle; no new version/inheritance/startup authority. The only corrections found were the reported effort type mismatch and direct-input shape edge cases, now verified.

Remaining boundary: this builder only reconstructs supplied inputs. Current source acquisition and loader/effect qualification remain caller responsibilities and subsequent integration is conditional, as the plan requires. No unresolved implementation question or correctness concern remains within Task1. Independent acceptance is pending root review.
