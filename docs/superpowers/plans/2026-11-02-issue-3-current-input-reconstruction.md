# G1 current AGY input reconstruction implementation plan, correction round 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruct current AGY recipe inputs through guarded acquisition and consume them in the real producer.

**Architecture:** Acquire current context, executable identity, and settings independently of semantic selection. Build the recipe with the existing builder. Select the pinned source subset through a new package-internal selector. The producer retains acquisition success and semantic unknowns separately.

**Tech stack:** Existing TypeScript, Node.js, Vitest, and inventory I/O. No new dependency.

**Specification:** The frozen brief and roadmap, corrected by `g1-readiness-ruling.md` and this round’s `coordinator-ruling.md`.

**Base:** `a4a0d1dbf8f6167d5a82c6c3ceb0ee6b521deaaa`.

## Global constraints

- Preserve public signatures and result shapes.
- Preserve `AuditSnapshot` version 1 and ordinary source-kind/digest meanings.
- Preserve the exact existing `recipeHash` preimage.
- Preserve agent bytes, both materializations, inherited Deny order, and unrelated permission fields.
- Preserve settings acquisition at `homedir()/.gemini/antigravity-cli/settings.json`.
- Capture raw HOME presence separately from `homedir()`.
- Capture base PATH independently of assignment launch PATH.
- Use `268435456` bytes as the executable cap.
- Retain the 1 MiB per-JSON and 16 MiB aggregate JSON limits.
- Share the producer’s existing `InventoryBudget`.
- Keep unknown identity from inheriting source rules or active effects.
- Preserve H1 validation, native authority, custody, and effective initialization gates.
- Keep saved-boundary reconstruction and witness binding in G4.
- Preserve default test concurrency and retained issue 8 failures.
- Treat any new G1 compatibility failure as new work to resolve, not as an issue 8 failure.

## Review focus

| Input | Required behavior |
|---|---|
| Unknown executable bytes with valid settings | Acquisition succeeds; recipe remains available; source selection stays unknown. |
| Same pinned bytes with different version text | Source selection remains the same; recipe preserves the supplied version evidence. |
| Absent versus empty environment values | Observations remain distinct. |
| Settings acquisition failure | No empty-settings fallback or launchable recipe. |
| Repeated executable acquisition | No later `track()` or `currentSourceDigest()` reread in current acquisition. |

## Task 1: acquire current inputs and integrate the source-subset selector

One implementer owns all six files. Start after H1 releases shared files. The coordinator owns integration and independent acceptance.

### Exact files

| Action | File |
|---|---|
| Create | `src/pilot/agy-startup-inventory.ts` |
| Create | `test/pilot/agy-startup-inventory.test.ts` |
| Create | `src/pilot/agy-loader-contract.ts` |
| Create | `test/pilot/agy-loader-contract.test.ts` |
| Modify | `src/pilot/provider-controls.ts` |
| Modify | `test/pilot/provider-controls.test.ts` |

Do not modify the builder, inventory I/O, witness schemas, audit boundary, session runner, public barrels, or test configuration.

The inspected audit suite, installed-plugin suite, and shared helpers are verification inputs. They need no fixture migration.

### Interfaces

The following names are proposed.

In `agy-startup-inventory.ts`:

```ts
type AgyCurrentContext = Pick<
  AgyInventoryContext,
  | "requestingWorkspace"
  | "executionCwd"
  | "home"
  | "rawHome"
  | "selectedAgent"
  | "environmentInputs"
>;

type AgyAcquiredExecutable = {
  path: string;
  sha256: string;
  receipt: ReadReceipt;
};

type AgyCurrentInputs = {
  context: AgyCurrentContext;
  executable: AgyAcquiredExecutable;
  recipeInputs: AgyRecipeInputs;
};

type AgyCurrentInputResult = {
  sources: readonly AuditSource[];
  ordering: readonly string[];
} & (
  | { state: "present"; value: AgyCurrentInputs }
  | {
      state: "unknown";
      context: AgyCurrentContext | null;
      executable: AgyAcquiredExecutable | null;
      problems: readonly InventoryProblem[];
    }
);

function reconstructCurrentAgyInputs(
  request: {
    selection: ModelSelection;
    version: string;
    workspace: string;
  },
  budget: InventoryBudget
): AgyCurrentInputResult;
```

`present` means successful acquisition and recipe construction. It says nothing about loader completeness or native authority.

`repositoryBoundary` remains outside this partial context. G1 must not insert an unproved null into a complete witness context. `selectedAgent` records the requested package agent name, not proved native selection.

In `agy-loader-contract.ts`:

```ts
type AgySourceRuleSelection =
  | {
      state: "pinned-subset";
      ruleSet: "agy-34423fc9-source-subset-v1";
      executable: { path: string; sha256: string };
    }
  | {
      state: "unknown";
      problem: InventoryProblem;
    };

function selectAgySourceRules(
  executable: { path: string; sha256: string }
): AgySourceRuleSelection;
```

The selector receives the producer’s privately acquired identity. It accepts no version, contract, qualification, phase, graph, or completeness credential.

Its single initial digest is:

```text
34423fc9b0af3841e7646aa72a2d40ffeab8218b22d1cb99eac7355f9eba31e3
```

The rule-set identifier names only the accepted, conditional source subset. Its module documentation must retain the root, enablement, and filesystem qualifications. It must explicitly leave runner dispatch, complete graph semantics, activity, and native authority unresolved.

Do not construct a `LoaderBinding`, semantics digest, or temporary qualified witness contract from this result.

### Implementation and verification steps

- [ ] **Step 1: Add direct acquisition tests.**

  Use real temporary fixture files and guarded readers. Stub `homedir()` and environment values to fixture data. Do not inspect private host inputs.

  Add these behavioral tests:

  - `reconstructs current AGY inputs without semantic qualification`
  - `preserves raw HOME absence independently of homedir`
  - `distinguishes absent and empty forwarded environment values`
  - `reconstructs changed HOME PATH executable and inherited Deny`
  - `uses current package recipe output`
  - `propagates guarded executable and settings failures`
  - `does not call inspection help disposition or provider boundaries`

  Require successful reconstruction of a small synthetic executable with valid settings. Semantic selection is not part of this function.

  Compare its recipe with the actual builder output. Retain independent literal-byte checks in the existing recipe suite.

- [ ] **Step 2: Add selector tests and producer behavior tests.**

  Selector tests must establish:

  ```ts
  expect(selectAgySourceRules({
    path: "/fixture/agy",
    sha256: pinnedDigest,
  }).state).toBe("pinned-subset");

  expect(selectAgySourceRules({
    path: "/fixture/agy",
    sha256: differentDigest,
  })).toMatchObject({
    state: "unknown",
    problem: {
      code: "AGY_SOURCE_CONTRACT_UNREVIEWED",
      path: "/fixture/agy",
      edge: null,
    },
  });
  ```

  The diagnostic name is proposed. Pin it consistently in implementation and tests.

  Add two real-producer controls:

  1. Unsubstituted production selection receives a synthetic executable. Inspection still returns its acquired recipe and metadata. It retains the specific source unknown, emits no active AGY effects, and cannot become bootstrap-verified.
  2. Isolated private selector substitution exercises synthetic mechanics through the actual producer. Settings changes must change the actual generated session bytes and path.

  Neither control may mock inspection, reconstruction, or an authority validator to return success.

- [ ] **Step 3: Establish compatibility controls and behavioral RED before production edits.**

  Run the existing recipe-byte positive control.

  ```sh
  npm test -- test/pilot/agy-recipe-plan.test.ts
  ```

  Build before the existing dist-consuming audit controls:

  ```sh
  npm run build
  npm test -- test/pilot/control-audit.test.ts -t 'reuses a low-level authenticated AGY authority fixture|bounds AGY JSON revalidation with an existing authenticated disposition|prepares actual versioned hook sources, adopts only matching native owner disposition, and invalidates drift'
  ```

  These unchanged controls must pass. They are compatibility baselines, not new RED tests.

  Run the new behavioral tests:

  ```sh
  npm test -- test/pilot/agy-loader-contract.test.ts test/pilot/agy-startup-inventory.test.ts
  npm test -- test/pilot/provider-controls.test.ts -t 'retains acquired AGY inputs when source selection is unknown'
  ```

  Record the existing producer’s incorrect version-derived qualification and missing unreviewed-identity observation as behavioral failures. A new module’s absence is setup evidence, not the complete RED.

- [ ] **Step 4: Implement guarded current reconstruction.**

  Capture the forwarded environment once. Preserve PATH, HOME, TMPDIR, LANG, LC_ALL, and TERM as values or null. Set `AGY_CLI_DISABLE_AUTO_UPDATE` to `"true"`.

  Capture `homedir()` separately. Preserve raw HOME absence without replacing it with the resolved home.

  Resolve the executable through the current lookup behavior. Retain first-candidate selection. Report unsupported lookup or custody conditions specifically.

  Acquire its canonical target with:

  ```ts
  readInventoryFile(executablePath, 268435456, budget)
  ```

  Retain the returned digest and receipt. Release the executable payload after identity acquisition.

  Acquire settings once through `readInventoryJson`. Preserve guarded absence, malformed input, refusal, and successful parsing as distinct outcomes.

  Call `buildAgyRecipePlan` only when required acquisition succeeds. Pass `undefined` only for proved settings absence. Preserve the existing null hook-policy input for this increment.

  Convert `AgyRecipeSettingsError` into its existing named failure. Retain safely acquired context and executable observations when settings fail.

  Return ordinary file/absence sources and the settings acquisition order. Do not invent environment filesystem sources.

- [ ] **Step 5: Implement the selector and connect both functions to inspection.**

  Call reconstruction from the AGY branch of `inspectProviderControls`. Use the producer’s shared budget.

  Consume its executable, recipe fields, settings source, context, ordering, and problems. Use the captured home consistently for AGY paths during that inspection.

  Call `selectAgySourceRules` with the acquired executable identity. Remove the `1.4.12` regex qualification.

  For unknown selection:

  - Retain the returned recipe.
  - Retain the specific unreviewed-source problem in audit unavailable states.
  - Keep `provider-startup-source-contract` unknown.
  - Continue safe metadata acquisition and H1 source validation.
  - Keep startup qualification unknown.
  - Emit no active effects derived from unsupported source rules.

  Keep the source-selection unknown separate from acquisition failure accounting. Do not add `AGY_PLUGIN_INVENTORY_UNAVAILABLE` solely because executable semantics are unreviewed. The existing exactly-100-entry acquisition control must remain meaningful.

  For the pinned subset, report the limited source-subset match. Do not infer full graph completeness from it.

  Preserve bounded help acquisition as separate syntax evidence. Reconstruction itself must execute no command.

  Remove the duplicate AGY settings read and inline builder call. Replace the AGY executable `track()` path with its guarded digest. Do not reread it through `currentSourceDigest()` during acquisition.

  Merge retained sources at their existing producer positions. Preserve deterministic ordering and avoid duplicates. Unchanged prepare/inspect calls must still reach the same disposition hash.

  Preserve the existing disposition call and authority checks. Non-JSON saved-source revalidation in `control-audit.ts` remains a G4 concern. This task does not claim that boundary is already bounded.

- [ ] **Step 6: Verify drift and read limits.**

  Require these assertions:

  | Change | Expected result |
  |---|---|
  | HOME value | Current home/settings observations change. |
  | Raw HOME removal with fixture `homedir()` retained | `rawHome` becomes null; reconstruction can still succeed. |
  | PATH selects another ordinary executable | Acquired path/digest change. Unknown semantics do not erase the recipe. |
  | Executable bytes change at the same path | Source digest changes; production selector returns unreviewed. |
  | Environment variable disappears or becomes empty | Current context distinguishes both cases. |
  | Inherited Deny changes | Generated settings preserve it plus package restrictions. |
  | Settings whitespace changes | Source digest changes even when generated recipe bytes remain equal. |
  | Package builder output changes | The returned producer recipe uses the current output. |
  | Settings are absent | Default recipe succeeds with an absence source. |
  | Settings are malformed, unreadable, or nonregular | No fallback recipe. Metadata acquisition retains the failure. |

  Assert that executable reads receive the exact cap. Assert that executable acquisition does not consume `jsonBytes`.

  Use the existing inventory-I/O suite for generic boundary behavior. Test overflow-result propagation without allocating a 256 MiB test payload.

  Instrument fixture acquisition to reject executable reads through `readFileSync` or `currentSourceDigest`. Verify that the settings payload is acquired once.

### Fixture compatibility and actual imports

| Test path | Runtime imports | G1 composition |
|---|---|---|
| `provider-controls.test.ts` | Source producer | Use isolated source-selector substitution only for synthetic mechanics controls. Retain unsubstituted identity rejection. |
| `agy-installed-plugin-sources.test.ts` | `../../src/pilot/provider-controls.js` and source audit helper | Leave unchanged. Acquire metadata despite unknown identity. Preserve specific acquisition diagnostics. |
| `control-audit.test.ts` | `../../dist/pilot/provider-controls.js` and `../../dist/pilot/control-audit.js` | Leave unchanged. Use the real compiled selector. No substitution is needed. |
| `context-fixture.ts` | Source native command/client helpers and source Codex kernel | Leave unchanged. Its stateful native records authenticate the audit boundary; they do not qualify AGY startup. |

The audit imports are explicit at [control-audit.test.ts:4](/Users/aaat/.codex/worktrees/council-issue3-inventory/the-council/.superpowers/sdd/2026-11-02-issue-3-resume/g1-plan-fix-r1/input/test/pilot/control-audit.test.ts:4). The installed-plugin source imports appear at [agy-installed-plugin-sources.test.ts:6](/Users/aaat/.codex/worktrees/council-issue3-inventory/the-council/.superpowers/sdd/2026-11-02-issue-3-resume/g1-plan-fix-r1/input/test/pilot/agy-installed-plugin-sources.test.ts:6).

For source producer mechanics tests, substitute `../../src/pilot/agy-loader-contract.js` within the isolated test module. Restore scoped substitution in `finally`. Keep real executable/settings readers and the actual producer body. A source-module substitution must not be assumed to affect the distinct compiled module.

Preserve these audit controls unchanged:

- Low-level authority preparation, adoption, successful reuse, drift rejection, and restored successful reuse at lines 50–79.
- Bounded JSON revalidation, actual native read calls, foreign reporter rejection, and restored successful reuse at lines 137–153.
- Producer-based matching-disposition inspection at lines 158–215. Require the disposition read and guarded revalidation. Restored producer reuse remains false because semantic unknowns remain.
- Exact foreign owner, workspace, incarnation, and reporter rejection, followed by restored adoption, at lines 486–528.
- Codex positive authority and provenance controls. G1 must not alter their route behavior.

The installed-plugin exactly-100-entry control at [line 201](/Users/aaat/.codex/worktrees/council-issue3-inventory/the-council/.superpowers/sdd/2026-11-02-issue-3-resume/g1-plan-fix-r1/input/test/pilot/agy-installed-plugin-sources.test.ts:201) permits successful bounded metadata acquisition. It does not assert semantic qualification.

The future producer-positive complete-projection fixture with `unavailable=[]` remains G4 work. Do not rewrite current unknown assertions to simulate that outcome.

### GREEN and evidence

All commands are future implementation instructions. Cwd is the repository root.

```sh
npm run build
npm test -- test/pilot/agy-loader-contract.test.ts test/pilot/agy-startup-inventory.test.ts test/pilot/agy-recipe-plan.test.ts test/pilot/provider-controls.test.ts test/pilot/agy-installed-plugin-sources.test.ts test/pilot/inventory-io.test.ts test/pilot/agy-inventory-witness.test.ts
npm test -- test/pilot/control-audit.test.ts
npm run typecheck
```

Use the roadmap’s reviewed bounded runner and fresh logs. Allow 120 seconds for build, focused RED commands, audit regression, and typecheck. Allow 300 seconds for the combined affected GREEN.

Build before any dist-consuming suite. Preserve default concurrency. Record argv, cwd, source/dist hashes, assertion results, exit status, log hash, and process settlement.

Require the specific native rejection and restored positive assertions. An earlier source unknown, pending disposition, or failed fixture setup cannot replace them.

Do not repeat full `npm test` during G1 steps. Preserve H1’s retained issue 8 failures for the designated whole integration gate. Investigate new failures separately.

### Acceptance and rollback

G1 passes when the actual producer consumes guarded current reconstruction. Unknown source identity must coexist with successful recipe acquisition. The new selector must identify only its pinned subset. Positive mechanics, unchanged authority controls, and specific failures must pass.

Preserve the existing preimage exactly:

```ts
sha256(canonicalJson({
  argv,
  materializations,
  codexPolicy: codexPolicy ?? null,
  ...(agyHookShell ? { agyHookShell } : {}),
}))
```

Context comparison in G1 does not establish saved-reuse invalidation. G4 owns that binding.

Record these prior hashes:

| Existing editable file | SHA-256 |
|---|---|
| `src/pilot/provider-controls.ts` | `4840e1c49b70721d8d1d8cfa6fe07309201dca61b31a647976d7a57b77772bef` |
| `test/pilot/provider-controls.test.ts` | `2cc0e116bc289b7d0e4fd1a1f94f5f49457906cf601a81836f48fa9ea4c5cca5` |

The four new files are absent from the frozen base. Record post-H1 starting hashes before editing. Rollback reverses only G1-owned changes.

The added verification inputs remain unchanged:

| Protected verification input | SHA-256 |
|---|---|
| `test/pilot/control-audit.test.ts` | `80225e07f8d39e28815274c9fd9e757abff95339109489b4a32a443b038c4ff3` |
| `test/pilot/agy-installed-plugin-sources.test.ts` | `6f205244a6a31b6d462f98bc5418f1b39a955a8a95db739e19b0bd2f4e0078c7` |
| `test/pilot/context-fixture.ts` | `2642de310522660791b73d7d571e14ab8a128149693eeca2554c57d2f732369f` |
| `test/pilot/fixtures.ts` | `5c45b095f352ad9c21030c928631434b41375a5d1f405fe9147a91341e020a80` |

Preserve H1, unrelated work, immutable audit evidence, and original review reports.

## Preserved later outcomes

| Outcome | Retained scope and expansion condition |
|---|---|
| G2 | Resolve actual runner registration, recipe predicates, and influential callback preservation. Retain accepted conditional root, enablement, and filesystem claims. The unaccepted runner follow-up establishes no dispatch result. |
| G3 | Complete root/declaration graph, ordering, inherited membership, native metadata, enablement, activity, and dependencies. Consume H1 without duplicating its parser. Preserve disabled bytes and all finite bounds. |
| G4 | Prove exclusion before writes. Implement clean preparation, saved-boundary reconstruction, exact witness/source projection, adoption, and reuse. Preserve public signatures and native authority. Include the actual producer-positive complete-projection lifecycle fixture. |
| Mandatory G4 regression | Keep `rejects saved AGY reuse after an ignored root entry changes type`. Require unchanged positive reuse, equal old digests, unchanged names, changed type, rejected reuse, and restored positive reuse. |
| G5 | Validate retained recipes before writes/spawn. Preserve the two static files, complete physical custody, two distinct actual assignment profiles, verifier checks, and exact launch PATH. |
| Final acceptance | Run affected checks and the designated full suite. Resolve retained failures. Freeze actual bytes. Obtain fresh cross-family review. Runtime qualification #4 remains separate. |

AC1 retains the real-acquisition regression evidence. AC2 requires complete locations, ordering, and enablement. AC3 retains disabled metadata and accurate activity. AC4 retains bounds and specific unknowns. AC5 requires drift rejection and successful unchanged reuse. AC6 preserves custody, authority, offline checks, and fixture-only execution.

## Language and self-review note

Used the previously loaded Superpowers writing-plans 7.0.1, adaptive-planning integration contract, and STE references. The writing-plans source hash remains `a6c67c1900064347c2a329990dd3c555657c51c3ec53b259a08aa01a2c26139a`.

This is an Issue 9-oriented candidate. The official dictionary and governed terminology were unavailable. Technical literals, bounds, conditions, and authority distinctions were checked.

Self-review confirms that the correction preserves the six-file scope. Current audit positives bypass producer qualification where intended. Producer fixtures retain unknowns while still testing actual native authentication. Source and dist imports require separate module identities. No audit fixture migration or weaker validation is justified.

No implementation, tests, builds, providers, network requests, helpers, private-input acquisition, or file writes ran. Fresh review of this corrected artifact remains pending.