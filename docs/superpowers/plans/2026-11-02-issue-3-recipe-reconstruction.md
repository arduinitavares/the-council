# Issue 3 recipe reconstruction

The approved conditional inventory design requires reconstruction without importing provider inspection. This increment extracts the existing recipe into a pure builder. It does not qualify loader rules or grant effect authority.

Spec: the approved design and Task 6 of `2026-11-01-issue-3-inventory-witness.md`.

## Constraints

Use a fresh Sol Max implementer through Orca. Use fresh Astra Ultra and Argon high reviewers through Orca. The coordinator verifies their findings. Preserve valid recipe bytes, arguments, permissions and materialization paths. Preserve unrelated dirty work. Do not invoke a live provider or alter global settings. Do not commit or push from the worker.

## Task 1: extract the recipe builder

Files: create `src/pilot/agy-recipe-plan.ts` and `test/pilot/agy-recipe-plan.test.ts`. Modify only the AGY recipe construction in `src/pilot/provider-controls.ts` and related tests in `test/pilot/provider-controls.test.ts`.

1. Add a regression at the existing inspection boundary for a malformed controlling permissions or deny value. Run it on unchanged production code and retain the actual failure. Invalid controlling settings must remain unavailable and cannot produce a launchable recipe. A missing settings file remains distinct from malformed settings.
2. Implement `buildAgyRecipePlan({ selection, version, workspace, executable, legacySettings, agyHookShell })` returning `AgyRecipeInputs`. Use only types and pure helpers. Reproduce the current agent text, session JSON, merged Deny entries, materialization hashes and paths, argv, expected permission and optional hook policy. Reject malformed controlling settings with a named error. Do not introduce a new permission, inheritance setting or version gate.
3. Use the builder in the existing inspection path. Preserve all unrelated facts, source tracking, collision checks and audit calculations. An invalid builder input must produce a named unavailable reason and no provider recipe. Avoid an inventory/provider-controls runtime import cycle.
4. Test valid missing/empty/settings cases, Deny preservation, stable content hashes and input immutability. Verify the existing AGY recipe remains byte-equivalent for valid inputs. Run focused recipe/provider-control tests, typecheck and build. The coordinator runs the whole-suite gate for the completed integration; existing full-suite failures remain open under #8.
5. Return the diff, exact RED/GREEN commands and results, any remaining failures, and a self-review. The coordinator owns fresh reviews and integration.

## Subsequent work

Task 2 freezes the actual diff for fresh Astra Ultra and Argon high reviews. The coordinator checks every actionable claim. A finding causes a bounded correction and re-review. Task 3 integrates this builder into the source-qualified acquisition and four lifecycle boundaries only after applicable loader rules are established.

Language check: this is a provisional Issue 9-oriented candidate. Technical literals and uncertainty are preserved. No full dictionary conformance is claimed.
