# Issue 3 production inventory integration implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect source-qualified AGY inventory to preparation, adoption, direct reuse, and retained-recipe launch for issue 3.

**Architecture:** Acquire live inputs through bounded readers. Select applicable rules inside the package. Bind the complete source projection to the accepted witness format. Validate physical custody separately from semantic normalization and native effect authority.

**Tech Stack:** Existing TypeScript, Node.js, strict JSON, Zod, and Vitest. No new dependency.

**Spec:** `.superpowers/sdd/2026-11-01-issue-3-loader-witness/research/input/approved-design.md`, SHA-256 `60cf740bd15cfc1d294ff3150eccfc48e6928d33507b15cf3ad4a18981af78b1`. This plan refines Tasks 5–8 of `docs/superpowers/plans/2026-11-01-issue-3-inventory-witness.md`, SHA-256 `8aac2d81af3f37f877e7dcf30e2abc63b6bebd8038779e48f8f1cd54e416ca89`. The approved design and earlier plan remain immutable. Historical pending-design wording does not revoke approval.

V2 corrects only verified finding F1 from `.superpowers/sdd/2026-11-02-issue-3-resume/astra-integration-plan-review/report.md`. Frozen v1 plan SHA-256 is `fe819388048599755a37bd9fe1da16ec7a6dab337fd45156159469ea649e9d82`. Its note SHA-256 is `a76cc9ee8f02ae502ab91c82b999decb986172e75954e5a246bb32d0800c4713`. Both remain unchanged. Coordinator binding remains AP attempt `f6c5de4e`, reserved verifier use `8b8bb997-9708-4f30-8f9f-34b6f78290a7`. This document records that supplied binding without executing or replacing it.

## Global constraints

- Baseline: `2b8f9e4a6f8d5f7238871fe8b973eea8d460dcd2`, draft PR #11. The local HEAD matched this value during authoring.
- The execution method remains Subagent-Driven Development. Complete-task authorization persists within the approved design. The coordinator owns source qualification, assignments, integration, review disposition, and acceptance.
- This authoring entry writes only this plan and its adjacent language note. Its report returns through the supervisor. It executes no implementation, tests, setup, providers, hooks, plugins, network requests, Git writes, or configuration changes. It launches no helpers.
- Future execution preserves the existing SDD templates, verdicts, fix budgets, and progress ledger. This plan creates no new permission, admission flag, or coordination authority.
- Preserve `AuditSnapshot` version 1, the `file`/`metadata`/`absent` source kinds, `ProviderControlEvidence`, and the strict `ProviderRecipe` schema.
- Preserve `currentSourceDigest()` byte, metadata, absence, and null meanings. Do not substitute a directory-list digest in its metadata field.
- Preserve native identity, generation, Run/Task/Dispatch, reference, effect-scope, containment, Deny, and custody checks. Do not suppress inheritance or change the package agent to obtain an empty inventory.
- Preserve the 100-entry directory bound and 1 MiB JSON bound. Bound reads before hashing or parsing.
- Preserve 1,000 distinct paths, 32 inherited edges per path, 128 ancestor levels, 64 object levels, and 16 MiB total inventory JSON. These are Council refusal limits.
- Preserve the five-event Orca policy: `PreInvocation`, `PostInvocation`, `Stop`, `PreToolUse`, `PostToolUse`. Native inventory validation also covers `SessionStart`.
- A saved witness, caller field, synthetic fixture, model agreement, version string, or source report cannot establish production completeness.
- Unknown selectors, native components, runtime values, and normalization rules remain specifically unavailable. Unknown is neither absent nor disabled.
- Keep issue 8's known default-suite failure separate. Keep issue 9's paused operation and all other campaign issues outside this increment.

## Review focus

- An ignored root entry can retain its name and old metadata digest while its type changes. Task 6.2 preserves the positive control and rejects reuse.
- A valid saved witness can contain stale HOME, PATH, agent bytes, or recipe inputs. Task 6.2 reconstructs each value from live inputs.
- A disabled hook specification can contain an invalid sixth event. Tasks 5.1 and 5.3 retain whole-source validation and separate disable mechanisms.
- Bookkeeping can change an actual loader root during clean preparation. Task 6.1 requires exclusion before the first write and checks each later write.
- A second assignment can change physical profile membership and launch PATH. Task 7.1 tests excluded, consumed, and unknown semantic branches with actual distinct instances.

## Source facts and file ownership

Names marked **proposed** below are implementation decisions in this plan. They are not claims about existing exports or tests.

| Existing source | Inspected interface or behavior |
| --- | --- |
| `src/pilot/inventory-io.ts` | `InventoryBudget = { paths: Set<string>; jsonBytes: number }`. `readInventoryJson(path, budget, binding?)` returns `InventoryRead<{ value: unknown; file: BoundedFile }>`. `listInventoryDirectory` retains entry names and types. `InventoryRead` has `present`, `absent`, and `unknown` branches. |
| `src/pilot/agy-inventory-witness.ts` | Exports `AgyRecipeInputs`, `AgyInventoryContext`, `InventoryCore`, `EncodedWitness`, `encodeAgyInventoryWitness`, `decodeAgyInventoryWitness`, `bindAgyRecipeHash`, and `assertInventoryProjection`. Encoding verifies integrity, not loader qualification. |
| `src/pilot/agy-inventory-store.ts` | `prepareAgyAuditDirectories(workspace): void`, `persistAgyInventoryWitness(workspace, encoded): AuditSource`, and `readAgyInventoryWitness(workspace, fingerprint, budget)` exist. Persistence can bootstrap directories. Callers must establish exclusion first. |
| `src/pilot/agy-materialization-state.ts` | `inspectAgyMaterializationState(workspace, inputs, budget): StaticMaterializationState` returns `absent`, `complete`, or `unknown`. Every branch retains `directoryObservations`. These are physical observations, not semantic root declarations. |
| `src/pilot/agy-recipe-plan.ts` | `buildAgyRecipePlan({ selection, version, workspace, executable, legacySettings, agyHookShell }): AgyRecipeInputs` exists. Preserve its two exact materializations, inherited Deny merge, argv, agent bytes, and permission expectation. |
| `src/pilot/agy-plugin-enablement.ts` | `evaluateAgyPluginEnablement(input: AgyPluginEnablementInputs): "enabled" \| "disabled" \| "unknown"` exists. Its seven inputs are observations, not authority. `registryOverride: "absent"` requires proved absence/nil. |
| `src/pilot/provider-controls.ts:64` | `inspectProviderControls: ProviderControlSource` still runs bounded help, uses fixed AGY scans, and calls disposition at its tail. Its `track()` can hash before bounded parsing. The startup fact can begin verified before audit promotion. |
| `src/pilot/provider-controls.ts:374` | `prepareProviderAudit(selection: ModelSelection, version: string, workspace: string)` currently saves inspection's snapshot. Preserve its public signature and successful result shape. |
| `src/pilot/control-audit.ts:94` | `adoptAuditSnapshot(workspace, hash, runId, taskId, command)` and `acquiredAuditDisposition(snapshot, command?)` perform raw digest loops. Preserve their native authority checks. |
| `src/pilot/provider-session.ts:16` | `runProviderSession(a: WrapperAssignment, assignmentHash: string)` checks raw sources before materialization. Static file and agent checks currently reread bytes without inventory bounds. Hook instance creation precedes spawn. |
| `src/pilot/agy-hook-shell.ts` | `agyHookShellApplicable(descriptors, workspace)`, `acquireAgyHookShellPolicy({ workspace, executable, version, descriptors, basePath })`, and `instantiateAgyHookShellPolicy(policy, { packetRoot, directory, assignmentHash }, materialize)` exist. The last returns `{ launchPath, instanceHash, reportPath }`. |

Proposed files are `src/pilot/agy-loader-contract.ts`, `src/pilot/agy-startup-inventory.ts`, `test/pilot/agy-loader-contract.test.ts`, and `test/pilot/agy-startup-inventory.test.ts`. The first owns package-private rule selection. The second owns live acquisition and boundary reconstruction. Existing lifecycle files consume these functions in the same reviewed increment. An unused adapter is not an accepted deliverable.

## Qualified rules and remaining evidence

Read `.superpowers/sdd/2026-11-02-issue-3-resume/root-rule-review-v2/claims.md` in full. Its ten conditional claims are the accepted root-rule input. Its limits remain binding. The source executable digest is `34423fc9b0af3841e7646aa72a2d40ffeab8218b22d1cb99eac7355f9eba31e3`.

The accepted claims distinguish FS app data `G/antigravity` from backend app data `G/antigravity-cli` under the stated defaults. They retain the saved default-project pointer and manifest, added workspace resources, bounded repository discovery, all four customization aliases, personal contexts, and final URI deduplication/sort. They do not prove effective option values, selector conversion, native effects, or normalization. Source address `0x1098aa910` is the rejected RepoInfo descriptor. The accepted descriptor is `0x1098aa110`.

The accepted enablement claims are in `enablement-rule-review/claims.md` under the same resume directory. They qualify this calculation:

```text
setup = V OR (F AND S)
base = M OR (!Plugin.IsBuiltin AND setup)
Plugin.Disabled = K OR (E is present ? !E : base)
Plugin.ForceDisabled = K
```

`V` tests MCP variables length. `S` tests sidecar key and permission-list lengths. These are not interchangeable pointer tests. Effective checker results remain unknown where not bound. `E=false` can settle disabled despite unknown `K`. `E=true` still needs `K=false` to settle enabled. A complete metadata inventory remains necessary in both cases.

`native-component-check/report.md`, `native-hook-parser-followup/report.md`, and `native-coordinator-observations.md` are evidence only. Independent native review remains pending. The coordinator must verify actual source and limits before admitting their rules.

| Unresolved decision | One precise next check | Expansion condition and proposed unavailable code |
| --- | --- | --- |
| Effective root/options and project resources | Trace the normal recipe caller into the accepted root rules, including `CustomizationDotDirs`, `GlobalDirs`, project pointer/resources, and personal contexts. | Bind every encountered value through guarded live sources or a proved invariant. Otherwise use `AGY_LOADER_ROOT_INPUT_UNAVAILABLE`. |
| Declaration and candidate selectors | Inspect the actual caller and conversion of `plugins.txt`/`plugins.json` entries, including inherited paths, filters, resolution bases, and collisions. | Establish exact selected candidates and order for the input. Otherwise use `AGY_PLUGIN_SELECTOR_UNAVAILABLE`. |
| Selected-agent inheritance | Trace `council-packet` selection through `applyDiscoveredAgentPolicy` and its actual caller inputs. | Preserve the established inheritance default `true`. Bind explicit and inherited membership. Otherwise use `AGY_AGENT_INHERITANCE_UNAVAILABLE`. |
| Native hook guard and parser | Independently check `convertPluginPath` at `0x1015e12f0..0x1015e1318`, named map fields, and supplied ParseHooks slices. | Verify `DisabledCustomizations` and all six-event validation rules before adoption. Otherwise use `AGY_NATIVE_HOOK_RULE_UNAVAILABLE`. |
| Native component selectors/effects | Follow encountered skills/rules/agents/workflows/sidecars/MCP branches from conversion into their consumers. | Prove applicable absence or bind complete metadata and effects. Otherwise use `AGY_NATIVE_COMPONENT_RULE_UNAVAILABLE`. |
| Runtime checker values | Bind each encountered feature/kill-switch input at the normal caller, then apply the accepted three-state evaluator. | An invariant may settle a result. Unresolved influential values use `AGY_PLUGIN_RUNTIME_INPUT_UNAVAILABLE`. |
| Bookkeeping/static/profile/PATH membership | Follow traversal and consumption into the exact audit footprint, static paths, assignment profiles, and transformed PATH. | Establish exclusion or exact consumed inputs separately for each class. Otherwise use `AGY_BOOKKEEPING_MEMBERSHIP_UNAVAILABLE`, `AGY_MATERIALIZATION_NORMALIZATION_UNAVAILABLE`, `AGY_PROFILE_MEMBERSHIP_UNAVAILABLE`, or `AGY_LAUNCH_PATH_RELEVANCE_UNAVAILABLE`. |

Codes in this table are proposed diagnostic names. `InventoryProblem` retains the exact source `path` and `edge`. A missing rule must identify its class and source. It must not become an empty graph or a universal fixed-unknown adapter.

A genuinely absent branch can pass only after the complete qualified candidate set has guarded absence observations. A genuinely disabled branch can have zero active effects only after selection, disablement, metadata, and all other encountered branches are complete. Current unknown live inputs do not meet either condition. No fixture or caller can waive them.

## Task 5.1: Freeze the next source-qualification checkpoint — ready discovery

**Owner:** Coordinator, with independent source reviewers. This author launches no reviewer.

**Dependencies:** Accepted root and enablement claims above. Native reports remain unaccepted.

**Files:** Read the three native reports. Under `.superpowers/sdd/2026-11-02-issue-3-resume/native-parser-review-input/`, read `source-index.md`, `receipts.json`, `named-types.json`, `0x1015af8a0.asm`, `0x1015b08a0.asm`, `0x1015b0df0.asm`, `0x1015aed60.asm`, `0x1015aee20.asm`, and `0x1015d4c10.asm`. Use the index for related caller extracts. Proposed future output: `.superpowers/sdd/2026-11-02-issue-3-production-plan-authoring/implementation-evidence/source-qualification.md`.

**Interfaces:** Consume the seven decision rows above. Produce a decision record per encountered branch: exact input predicate, source interval/digest, verified rule, unresolved limit, and review disposition. This is evidence, not a production admission input.

- [ ] Verify the `DisabledCustomizations` map access against named types and the actual caller.

  Expected: Manager options `+40` plus BaseOptions map `+72` explains manager `+0x70`. A true value for the hook refresh type skips `hooks.json` loading. File presence and `Plugin.Disabled` do not supply that value.

- [ ] Check the six native event schemas against supplied parser slices and caller error handling.

  Expected: named specifications contain four handler-list events and two matcher-group events. Validation includes `SessionStart`, even with `Spec.enabled:false`. A validation error rejects the source. `Spec.enabled` and `Plugin.Disabled` remain separate. Case aliases, duplicate keys, model aliases, and runtime generative-hook values retain their actual limits.

  Verify the supplied assembly digests against their receipts. Reuse indexed slices. Any later authorized binary extraction retains the 4,096-byte per-read limit. A larger function does not justify an oversized read.

- [ ] Record the first missing selector or normal-caller input from the decision table.

  Expected: one exact source/dataflow request for each encountered unresolved class. No request executes AGY, hooks, plugins, or inference. Reuse supplied bounded extracts before requesting more evidence.

- [ ] Freeze the decision record for coordinator review.

  Expected: accepted rules and named gaps remain separate. Independent review covers the actual source claims, including the omitted guard. Review summaries cannot add fields or authority to the accepted claims.

**Acceptance:** A verifiable qualification checkpoint exists. It may contain unresolved outcomes. It performs no dependent implementation. The coordinator reassesses Tasks 5.3–8.1 from this checkpoint.

## Task 5.2: Bound AGY acquisition and existing-disposition source validation. Ready implementation

**Owner:** Implementer under SDD.

**Dependencies:** Accepted `inventory-io.ts` mechanics and the inspected producer/audit source. This task needs no unknown loader-selector or native-parser decision. It hardens current candidate acquisition and byte revalidation. It does not establish semantic completeness.

**Files:** Modify `src/pilot/provider-controls.ts` and `src/pilot/control-audit.ts`. Add tests to `test/pilot/provider-controls.test.ts` and `test/pilot/control-audit.test.ts`. Preserve existing native authority tests and all other route behavior.

**Reachable branch:** `inspectProviderControls` calls `acquiredAuditDisposition(audit, command)` at its tail. A matching disposition plus `command` reaches the source loop before native readback. Fresh fixtures without `command` cannot verify this branch. Direct reuse and adoption also need the same bounded source check.

**Interfaces:** Consume `readInventoryJson(path, budget)` and `listInventoryDirectory(path, budget)`. Use one `InventoryBudget = { paths: new Set<string>(), jsonBytes: 0 }` for producer acquisition. Proposed producer-local closure: `readAgyJson(path: string): InventoryRead<{ value: unknown; file: BoundedFile }>`. It returns the actual reader result to its consumers. It is not a public export.

Add this proposed private contract inside `control-audit.ts`:

```ts
type AuditSourceCheck =
  | { state: "unchanged" }
  | { state: "drift"; source: AuditSource; actual: string | null }
  | { state: "unknown"; problems: readonly InventoryProblem[] };

function validateAuditSources(
  snapshot: Pick<AuditSnapshot, "route" | "sources">
): AuditSourceCheck;
```

The helper performs live reads itself. It accepts no digest map, callback, cached observation, completeness value, contract, phase, or caller-selected reader policy. `unchanged` means only that the listed sources still match. Native authority, unavailable entries, and complete effect coverage remain separate checks.

For the current hardening scope, the helper selects bounded JSON reads when `snapshot.route === "antigravity"`, `(source.kind ?? "file") === "file"`, and `extname(source.path).toLowerCase() === ".json"`. This includes every current guarded settings, hook, and plugin-manifest JSON source. Assert that coverage against the actual current producer paths. The suffix selects a conservative read policy only. It grants no loader membership or completeness. Later extensionless declaration inputs retain their explicit Task 5.3 qualification and Task 6.2 integration requirements.

Use a fresh internal `InventoryBudget` for each validation pass. Call `readInventoryJson` for every selected source, including sources from saved snapshots. For `present`, compare `value.file.sha256` directly to the exact expected digest. Hash original bytes, not canonicalized parsed values. For `absent`, compare actual `null` with the expected digest, retaining existing missing-file semantics. For `unknown`, retain the reader's exact problems and return `unknown`. Never retry through `currentSourceDigest` or `readStrictFile` after a guarded refusal.

Keep the expected source kind unchanged. An `absent` source still uses the existing absence check, including `unexpected-source` on appearance. A `metadata` source still uses the existing metadata digest even when its name ends in `.json`. Other sources and routes use `currentSourceDigest` unchanged. Catch acquisition errors as source-specific unknown problems. Compare each source separately, including file and metadata records for the same path. Do not deduplicate by path alone or rewrite the snapshot source array.

Use this private helper at both existing audit source loops. Preserve `adoptAuditSnapshot(workspace, hash, runId, taskId, command)` and `acquiredAuditDisposition(snapshot, command?)` signatures and result shapes. Keep inspection's call to disposition. Preserve its missing-disposition and missing-command behavior. Adoption still authenticates the saved snapshot hash/workspace before native approval. Unchanged sources still flow through the complete `nativeDisposition` checks and retained-reference comparison. Drift retains `AUDIT_SOURCE_DRIFT` at adoption. Unknown acquisition fails before adoption writes a disposition. Proposed unknown diagnostic: `AUDIT_SOURCE_VALIDATION_UNAVAILABLE`, with source path/problems in its detail. Reuse returns `verified:false` for drift or unknown. Native failures retain their existing behavior. A matching snapshot hash does not replace source or authority validation.

- [ ] Add `bounds AGY inventory reads before digest or parse` to the producer suite.

  Assert a 1 MiB valid JSON input can be read. Assert 1 MiB plus one is unknown. Assert a 101-entry directory is unknown. Add malformed/duplicate-key/invalid UTF-8, component-link, leaf-link, and unstable-read cases. Assert each problem retains its source path. Assert startup remains unknown on acquisition failure. Assert unknown controlling settings cannot become an empty-settings recipe.

- [ ] Add `bounds AGY JSON revalidation with an existing authenticated disposition` to `control-audit.test.ts`.

  Use the actual `contextFixture`, captured help, policy fixture, and inert active hook from the existing versioned AGY audit test. Prepare through `prepareProviderAudit`. Complete the exact fixture Run/Task/Dispatch sequence for `prepared.hash` and `prepared.snapshot.effects`. Adopt through the actual audit boundary. Require `prepared.snapshot.unavailable` to equal `[]` before the positive control. No fixture field marks inventory complete.

  Wrap `h.command` to record native readback calls. Observe file payload reads for the exact canonical guarded JSON source paths. Record `openSync`/`readSync`/`closeSync` per descriptor and intercept named/default `readFileSync` consistently in the test module. Leave fixture setup, native-state reads, and unrelated file reads functional. This is test instrumentation, not a production dependency injection argument.

  Assert these concrete results on unchanged evidence:

  ```ts
  expect((await acquiredAuditDisposition(prepared.snapshot, command)).verified).toBe(true);
  const after = await inspectProviderControls(
    incidentRoster.reviewers.gemini, "1.4.12", h.workspace,
    { state: "unknown", source: "test", detail: "no billing" }, command
  );
  expect(auditHash(after.audit!)).toBe(prepared.hash);
  expect(after.facts.find(f => f.name === "startup-hooks-and-plugins")?.observation.state)
    .toBe("verified");
  expect(nativeReads).toEqual(expect.arrayContaining([
    "orchestration run-show", "worktree show",
    "orchestration dispatch-show", "orchestration task-list"
  ]));
  expect(unboundedGuardedPaths).toEqual([]);
  expect(guardedOpens.length).toBeGreaterThan(0);
  for (const open of guardedOpens) {
    expect(open.bytesRead).toBeLessThanOrEqual(1048577);
    expect(open.maxRequest).toBeLessThanOrEqual(65536);
  }
  ```

  `nativeReads`, `unboundedGuardedPaths`, and `guardedOpens` are proposed test-local trace arrays. Each guarded-open record contains `{ path: string; bytesRead: number; maxRequest: number }`. Populate them from actual calls. Check bounds per open, since acquisition and disposition perform separate live bounded passes. The unchanged positive control must pass after the fix. The absence of guarded reads is not a passing result.

- [ ] Add `rejects guarded AGY JSON drift during matching-disposition inspection` to the same suite.

  Reuse the authenticated fixture and its original source bytes. Arm a one-shot test interception of the exact adopted disposition file read. Mutate the guarded settings JSON after producer acquisition and before disposition source validation. Keep the disposition reference and native records unchanged. This retains the matching original audit hash at lookup and reaches the reviewed branch.

  Use a valid changed JSON value first. Assert that the exact disposition path was read, guarded source revalidation occurred, and inspection's startup fact stays unknown. Assert direct saved-snapshot reuse returns `verified:false`. Assert adoption of the old snapshot rejects with `AUDIT_SOURCE_DRIFT`. Restore original bytes. Assert direct reuse and matching-disposition inspection succeed again. Do not accept a test that only changes the hash before lookup and receives `AUDIT_DISPOSITION_PENDING`.

- [ ] Add guarded refusal and source-kind controls to the audit suite.

  Replace a guarded JSON file with 1 MiB plus one bytes after preparation. Assert bounded reads, `verified:false`, and no raw fallback. Repeat for a component/leaf link, malformed JSON, unreadable input, and instability during the read. Adoption must reject without writing a new disposition. Restore bytes/custody between cases. Verify restored unchanged reuse succeeds.

  Exercise implicit `file`, explicit `file`, `metadata`, and `absent` kinds. Assert exact byte-digest comparison for both file forms. Assert a missing file compares as `null`, metadata retains its existing digest, and an appeared absence is drift. Include file plus metadata for the same path. A small changed valid file must fail even when its expected snapshot hash remains unchanged. Preserve current native provenance/generation mutation tests. Also corrupt authenticated `reportedBy` after a successful bounded read, assert reuse rejects, restore the record, and assert reuse succeeds. Bounded source success cannot supply approval authority.

- [ ] Run both Task 5.2 RED commands in the verification table before production edits.

  Build current unchanged source before the audit RED, since its imports use `dist`. Expected: the existing-disposition positive control reaches native readback, then the no-unbounded-read assertion fails. A timeout, missing disposition, omitted command, collection failure, or stale build is not RED. Retain separate producer and audit receipts.

- [ ] Connect bounded acquisition and shared live source validation to the actual boundaries.

  Project producer `present` as a byte-digest `file` source. Project guarded `absent` as an absence source. Preserve unknown problems without forging a digest. Deduplicate by `(path, kind)`. Replace unbounded root enumeration with bounded complete name/type observations. Preserve strict Council refusals where native decoding remains unqualified.

  Implement the private helper above in `control-audit.ts`. Replace the raw source comparisons in adoption and acquired disposition with its checked result. Inspection reaches the latter unchanged. Preparation's inspection without `command` retains its current authority-reader requirement. No public caller supplies a precomputed success result. Keep saved/current hash checks and every native approval check. The source helper adds no loader or permission authority.

- [ ] Run Task 5.2 GREEN, typecheck, and build commands.

  Rebuild after source edits before the audit suite. Run both affected suites. Expected: the reachable existing-disposition branch uses bounded live bytes, unchanged authenticated reuse succeeds, drift/refusal fails safely, and all native authority assertions remain intact. Existing recipe bytes, Deny merging, ordinary hooks, and other routes retain their tests.

**Acceptance:** Current guarded AGY JSON acquisition and all existing-disposition source-validation paths are bounded before hashing. Adoption and direct reuse consume live guarded bytes through the same enforceable internal contract. Valid unchanged authenticated evidence stays reusable. Source drift, guarded refusal, and native tampering remain rejecting cases. This is production hardening, not final inventory or issue acceptance. Full witness/source-partition reconstruction and retained-recipe launch remain provisional in Tasks 6.2 and 7.1.

## Task 5.3: Integrate private qualified graph selection — provisional

**Owner:** Implementer after coordinator qualification. **Dependencies:** Tasks 5.1–5.2 and applicable qualified selector/native rules. The entire task remains provisional while an implementation choice depends on a missing rule.

**Files:** Create the proposed loader/inventory modules and their two suites. Modify AGY acquisition in `src/pilot/provider-controls.ts` in the same task.

**Proposed interfaces:** `AgyAcquisitionInput = { context: AgyInventoryContext; recipeInputs: AgyRecipeInputs }`. `AgyInventoryAcquisition = { core: InventoryCore; qualification: "qualified" | "unknown"; problems: readonly InventoryProblem[] }`. `acquireAgyStartupInventory(input: AgyAcquisitionInput): AgyInventoryAcquisition`. These are package-internal interfaces. No caller provides a contract, phase, graph, or completeness credential. Final private rule-selector types require the Task 5.1 checkpoint before promotion.

- [ ] Add applicable-rule RED tests before replacing fixed discovery.

  Cover packet cwd versus requesting workspace, saved project resources, repository/YAML branches, four aliases, personal direct-only contexts, inherited declarations, filters, case-insensitive root markers, duplicate URIs, and effective order. Prove excluded historical candidates separately. Preserve all entries of each actual loader root. A custody-only parent does not become a semantic root.

- [ ] Add native validation and enablement tests from accepted source rules.

  Cover the `DisabledCustomizations` guard with true, false, and unknown observations. Cover all six events, including invalid `SessionStart` in a disabled specification. Keep absent/null `Spec.enabled`, plugin disablement, parser rejection, and generative-hook runtime values distinct. Treat prompt model parsing as native metadata, not permission to launch that model.

  Pair enabled and disabled plugins with identical source bytes. Assert disabled byte changes alter the fingerprint but create no active effects or active command-dependency scans. Unknown enablement creates a specific problem. Test invariant outcomes from the accepted evaluator without defaulting unknown inputs.

- [ ] Acquire selected candidates through live guarded reads and package-selected rules.

  Bind every root entry, absence, declaration edge, manifest, registry/provenance input, selected-agent input, native contribution, and effective ordering decision. Retain duplicates in descriptor occurrences. Keep unresolved components unavailable. Do not union incompatible path interpretations.

- [ ] Connect active descriptors to the existing effect and custody boundaries.

  Preserve `startup-hook:` identities for equivalent supported descriptors. Submit the complete active Orca-referencing set to the existing recognizer. An extra active unsupported descriptor rejects that whole set. A disabled counterpart stays metadata. Remove only the existing exact known dynamic-closure reason after successful policy acquisition.

  Bind each supported command executable and literal script operand against its qualified base. Reject component/leaf links and script size `>=262144`. Preserve `AGY_PLUGIN_HOOK_DEPENDENCY_UNBOUND`, `AGY_PLUGIN_HOOK_DEPENDENCY_SYMLINK`, and `AGY_PLUGIN_HOOK_DEPENDENCY_TOO_LARGE` as proposed errors from the approved design. Computed shell syntax, unproved transitive closure, credential dependencies, and endpoint dependencies remain unavailable. Add no general shell parser.

- [ ] Run the Task 5.3 targeted command after this task becomes ready.

  Expected: graph tests and existing five-event policy tests pass together. The real producer consumes the adapter. Production rule selection rejects synthetic rules and unresolved live inputs.

**Expansion condition:** The coordinator has accepted enough source rules to specify every encountered implementation branch. Qualified absence can avoid a nonencountered branch. It cannot erase an encountered unknown.

## Task 6.1: Prepare reusable witnesses from a clean store — provisional

**Owner:** Implementer. **Dependencies:** Task 5.3 and source-backed exclusion of the exact bookkeeping footprint. Unknown or consumed bookkeeping keeps positive preparation provisional.

**Files:** Modify `src/pilot/provider-controls.ts` and the proposed `src/pilot/agy-startup-inventory.ts`. Add preparation tests in `test/pilot/control-audit.test.ts` and `test/pilot/provider-controls.test.ts`.

**Interfaces:** Preserve `inspectProviderControls: ProviderControlSource` and `prepareProviderAudit(selection, version, workspace)`. Consume the existing recipe builder, witness encoder/hash binder, store helpers, and physical inspector. Preflight is a private live acquisition path. No caller-supplied exclusion result can enable writes.

- [ ] Add `prepares from a clean workspace after qualified bookkeeping bootstrap`.

  Assert this exact order: read-only exclusion preflight, directory bootstrap, final live acquisition, witness persistence, snapshot persistence, post-write reconstruction. Start with no audit store. Assert unknown preflight performs zero store/snapshot/disposition writes. Cover a bookkeeping path reached through an alternate declaration edge.

- [ ] Separate read-only acquisition from effect disposition in the producer.

  Inspection performs no persistence. Missing witness returns `AGY_INVENTORY_WITNESS_PENDING`. Every relevant initial startup fact stays unknown when semantic completeness is unknown. Bind its digest and detail to `auditHash()` even when effects are empty. Keep effective runtime qualification separate.

- [ ] Implement explicit preparation only after exclusion passes.

  Derive the footprint for inventories, snapshots, dispositions, and affected ancestors. Require source-backed exclusion for each resulting write. Unknown exclusion raises a specific preparation failure before any write. Read-only inspection still supplies unavailable diagnostic evidence. Do not create a diagnostic snapshot in an unqualified footprint.

  Call `prepareAgyAuditDirectories(workspace)` before final acquisition. Encode the complete qualified core. Persist immutable witness bytes. Reacquire before saving the snapshot. Recheck after snapshot persistence. The rule must also cover adoption's later disposition write. Do not seek a hash fixed point or drop a consumed entry.

- [ ] Run the Task 6 targeted command after this task becomes ready.

  Expected: unchanged complete preparation succeeds under qualified rules. Unknown membership refuses writes. Changed consumed membership cannot yield the old approval identity.

**Expansion condition:** A reviewed rule proves exclusion of the exact footprint, including alternate edges. If consumed bookkeeping defeats the approved equivalence, the coordinator resolves that material design choice before implementation.

## Task 6.2: Reconstruct and validate adoption and direct reuse — provisional

**Owner:** Implementer. **Dependencies:** Tasks 5.3 and 6.1. Preserve the actual native authority sequence.

**Files:** Modify `src/pilot/control-audit.ts`, `src/pilot/provider-controls.ts`, and the proposed inventory module. Add regressions to `test/pilot/control-audit.test.ts` and `test/pilot/provider-controls.test.ts`.

**Proposed interfaces:** `reconstructAgyAuditInput(boundary: AuditSnapshot | ProviderRecipe): AgyAcquisitionInput | { problems: readonly InventoryProblem[] }`. `validateAgyInventoryBoundary(boundary: AuditSnapshot | ProviderRecipe): Promise<AgyBoundaryValidation>`.

```ts
type AgyBoundaryValidation =
  | { state: "verified"; core: InventoryCore; encoded: EncodedWitness;
      sources: readonly AuditSource[]; ordering: readonly string[];
      effects: readonly string[]; unavailable: readonly string[];
      recipeHash: string; guardedDigests: ReadonlyMap<string, string | null> }
  | { state: "unknown"; problems: readonly InventoryProblem[] };
```

The guarded key is `canonicalJson([path, kind ?? "file"])`. The public validator accepts only the boundary. Type-only audit imports prevent the existing inspection/disposition cycle. Reconstruction does not import or call inspection, disposition, help, or a provider.

- [ ] Port the meaningful same-name regression into the maintained audit suite.

  Preserve `.superpowers/sdd/2026-11-01-issue-3-loader-witness/implementation-evidence/baseline-membership-red.test.ts`, its configuration, `baseline-membership-red.1793545376222.json`, and original RED logs/receipts unchanged outside `test/`. Preserve the approved design's earlier real-acquisition RED evidence as well.

  Keep the name `rejects saved AGY reuse after an ignored root entry changes type`. Require successful unchanged prepare/adopt/reuse first. Mutate only the fixture-created regular `slot` into a directory with inert `hooks.json`. Restore root time. Assert unchanged root metadata digest, unchanged names, changed entry type, and equal old source digests. The final reuse assertion is `verified === false`. Merely failing before the mutation does not prove this defect is fixed.

  Use `contextFixture`, `fixtures.js`, captured `agy-1.4.12-help.txt`, and the existing Run/Task/Dispatch completion sequence. Keep fixture cleanup in `finally`.

- [ ] Add a private synthetic mechanics seam without production admission.

  Use isolated test-module substitution of the package's private rule-selection dependency. Run the actual acquisition/reconstruction/validator and native authority boundary. Do not stub the validator to return verified. Do not expose a production setter or accept rule/graph fields from callers. Real production selection must reject the same synthetic identity. The exact test composition is finalized after Task 5.1 defines the private selector.

- [ ] Add live-reconstruction and exact-partition RED tests.

  Change live HOME, raw HOME absence, base PATH, relevant environment absence, executable bytes, selected-agent bytes, package recipe output, order/filter, semantic digest, disabled hook bytes, and appeared absences. Adoption rejects each mismatch. Direct reuse remains unverified. Spy on process and inspection boundaries to prove reconstruction invokes none.

  Reject missing/duplicate/extra sources, raw transitional records, bad recipe hash, misplaced witness, malformed witness, and altered native references. Test complete zero-effect prepare/adopt/reuse. Assert every guarded JSON/witness path avoids unbounded rereads.

- [ ] Reconstruct current context and recipe before existing raw-source loops.

  Derive canonical workspace and packet cwd from live guarded paths. Read live `homedir()`, raw HOME, and child-environment presence/value. Bind PATH, HOME, TMPDIR, LANG, LC_ALL, TERM, and `AGY_CLI_DISABLE_AUTO_UPDATE="true"`. Keep base PATH distinct from assignment launch PATH. Bind all additional discovery-relevant inputs selected by the qualified contract without retaining secrets or unrelated environment.

  Resolve the current executable through live PATH. Verify custody and contract-bound bytes. Validate saved requested selection with `selectionSchema`. Acquire current settings and selected-agent inputs. Rebuild the current package recipe. Saved context supplies expectations only. Missing reconstruction gives a specific unknown and requires fresh preparation.

- [ ] Compare the entire saved projection before native disposition can verify reuse.

  Require exactly one witness file at `.council/control-audits/inventories/<F>.json` with digest `W`. Bound its read and verify custody. Do not search for a replacement witness after mismatch. Require exact projected source arrays, ordering, effects, unavailable, executable, provider-version evidence, contract, and `Q`.

  Ordinary external files/metadata/absences retain existing meanings. Exact static materialization files and mutable affected ancestors use witness validation, not contradictory raw transitional records. Existing unrelated sources remain checked. `assertInventoryProjection` enforces the exact ordered source set. Use guarded byte digests only after exact-partition validation. Preserve all existing native identity/generation/reference/effect checks.

  Old AGY contracts require fresh preparation. Preserve historical bytes. Adoption and reuse do not bootstrap or repair missing state. Other routes retain their contracts.

- [ ] Run the Task 6 targeted command after this task becomes ready.

  Expected: positive unchanged controls pass. Every drift and malformed partition fails through the actual lifecycle boundary. Native approval cannot discharge inventory unknowns.

**Expansion condition:** Task 5.1 settles private selector composition, and Task 6.1 proves reusable preparation. Until then, the positive integration tests and their implementation remain provisional.

## Task 7.1: Validate retained recipes and actual launch instances — provisional

**Owner:** Implementer. **Dependencies:** Tasks 6.1–6.2 plus qualified static/profile/PATH membership rules.

**Files:** Modify `src/pilot/provider-session.ts`. Add tests in `test/pilot/provider-session.test.ts` and `test/pilot/agy-hook-shell.test.ts`. Preserve the accepted hook producer/verifier unless a narrow change receives separate review.

**Interfaces:** Consume `validateAgyInventoryBoundary(recipe)`, `inspectAgyMaterializationState(workspace, inputs, budget)`, and the existing assignment-bound hook materializer. Preserve `runProviderSession(a, assignmentHash)` and its result.

- [ ] Add retained-recipe rejection tests before spawn.

  Assert zero spawn calls and zero provider input for changed context, missing witness, extra entry, malformed partition, changed recipe, partial static set, or unresolved selected-agent semantics. Preserve bootstrap and effective input gates.

- [ ] Validate the exact live projection before writes and ordinary raw digests.

  Reject partial state before repair. Retain full `directoryObservations`, including entry names/types, for workspace and affected parents. Materialize only the current package's two static files. Use bounded static-file and agent checks. Do not perform an unbounded reread after a bounded check.

- [ ] Reacquire complete physical state after static materialization.

  Require actual files, exact bytes, owner, explicit modes, no links, and stable component custody. Reject missing files, extra managed-leaf entries, extra manifests, replaced parents, and mutation between inspection boundaries. Preserve alternate loader edges.

  Under qualified normalization, absent and complete states have equal `C`, `R`, `N`, `F`, witness bytes, `W`, source arrays, ordering, effects, unavailable, contract, `Q`, audit hash, and disposition identity. Infer state from observations. No phase argument or prior hash forces equality.

- [ ] Validate the current assignment's hook instance before spawn.

  Reacquire the static policy. Use actual `assignmentHash` and assignment directory with the existing producer. Check returned report/material identities, instance hash, and exact launch PATH. Preserve full physical observations across creation. Retain the generated verifier's repeated runtime checks.

- [ ] Add `projects two distinct assignment profiles according to qualified membership`.

  Create normal and cancellation fixture assignments with different hashes/directories. Keep the first profile while creating the second. Assert distinct actual reports and instance bindings. Assert each exact launch PATH and source custody. Observe the changed complete physical profile-parent listing.

  Qualified exclusion preserves semantic identity while physical listings differ. Qualified consumption binds every relevant instance/PATH input and changes audit identity when those inputs differ. Require a fresh matching audit or reject launch. If preparation cannot bind consumed inputs, return unknown. Unknown membership always refuses launch. An alternate discovery edge prevents exclusion from hiding an actual loader-root entry. No prefix exemption or copied prior report is permitted.

- [ ] Run the Task 7 targeted command after this task becomes ready.

  Expected: launch occurs only after complete static state, source reconstruction, and actual assignment custody pass. Fixture results do not qualify a live provider.

**Expansion condition:** Accepted source rules settle static equivalence, profile participation, and transformed PATH relevance for the actual input. Consumed assignment-specific effects can require a coordinator design decision before promotion.

## Task 8.1: Verify the integration and obtain independent acceptance — provisional final gate

**Owner:** Coordinator. **Dependencies:** Every applicable task above, closed semantic prerequisites, and frozen implementation evidence.

**Files:** Future task-local implementation evidence and the existing SDD progress ledger. Keep this plan snapshot immutable. Use the workflow ledger or a separate progress copy for checkbox changes.

- [ ] Run the consolidated affected gate once after integration passes focused checks.

  Expected: build, all affected suites, and typecheck pass. Do not omit provisional suites from final issue 3 acceptance. A narrower mechanics checkpoint must say which outcomes remain open.

- [ ] Run the full offline suite at the designated campaign point.

  Expected: record the actual result. Preserve default test parallelism and all assertions. Record the known issue 8 failure separately if it persists. Do not change fixtures, skip tests, or serialize the suite to hide it. Repeat only after a relevant change or unresolved failure warrants it.

- [ ] Obtain frozen-plan review and fresh actual-change review at their SDD gates.

  The coordinator freezes identical bytes for each required independent reviewer. Fresh cross-family review covers the actual author. Astra review of Sol is supplemental. Source qualification, implementation-team review, and self-review do not fill independent acceptance seats. Preserve existing verdicts, fix budgets, and ledger. No review is launched by this plan author.

- [ ] Verify the acceptance map against source, receipts, and frozen artifacts.

  Expected: all six criteria below have production evidence. Synthetic positive mechanics cannot establish native source qualification. Issue 3 completion remains separate from live operational qualification and later campaign issues.

## Verification commands and receipts

All commands in this section are future execution instructions. None ran during authoring. Cwd is `/Users/aaat/.codex/worktrees/council-issue3-inventory/the-council`.

Use the existing reviewed runner `.superpowers/sdd/2026-11-01-issue-3-loader-witness/implementation-evidence/bounded-command.py`. Write fresh logs under `.superpowers/sdd/2026-11-02-issue-3-production-plan-authoring/implementation-evidence/`. Do not overwrite old receipts. Apply the runner as follows:

```sh
python3 .superpowers/sdd/2026-11-01-issue-3-loader-witness/implementation-evidence/bounded-command.py --seconds 120 --log .superpowers/sdd/2026-11-02-issue-3-production-plan-authoring/implementation-evidence/5.2-red-01.log -- npm test -- test/pilot/provider-controls.test.ts -t 'bounds AGY inventory reads before digest or parse'
```


The additional exact RED command for F1 is:

```sh
python3 .superpowers/sdd/2026-11-01-issue-3-loader-witness/implementation-evidence/bounded-command.py --seconds 120 --log .superpowers/sdd/2026-11-02-issue-3-production-plan-authoring/implementation-evidence/5.2-disposition-red-v2-01.log -- npm test -- test/pilot/control-audit.test.ts -t 'bounds AGY JSON revalidation with an existing authenticated disposition'
```

Run the existing 120-second build gate immediately before this dist-consuming RED. Give that build a fresh `5.2-disposition-red-v2-build-01.log` receipt in the same evidence directory.

Use the same runner with the exact argv and bounds below. Each RED/GREEN invocation has a fresh task/phase log name. Existing per-test fixture timeouts remain active.

| Gate | Bound | Exact argv |
| --- | --- | --- |
| Task 5.2 RED | 120 seconds | `npm test -- test/pilot/provider-controls.test.ts -t 'bounds AGY inventory reads before digest or parse'` |
| Task 5.2 existing-disposition RED | 120 seconds | `npm test -- test/pilot/control-audit.test.ts -t 'bounds AGY JSON revalidation with an existing authenticated disposition'` |
| Task 5.2 GREEN | 120 seconds | `npm test -- test/pilot/provider-controls.test.ts test/pilot/control-audit.test.ts` |
| Task 5.3 focused graph GREEN | 90 seconds | `npm test -- test/pilot/agy-loader-contract.test.ts test/pilot/agy-startup-inventory.test.ts test/pilot/agy-hook-shell.test.ts` |
| Task 6 integration RED/GREEN | 120 seconds | `npm test -- test/pilot/control-audit.test.ts test/pilot/provider-controls.test.ts` |
| Task 7 integration RED/GREEN | 120 seconds | `npm test -- test/pilot/provider-session.test.ts test/pilot/agy-hook-shell.test.ts` |
| Build | 120 seconds | `npm run build` |
| Typecheck | 120 seconds | `npm run typecheck` |
| Consolidated affected gate | 300 seconds | `npm test -- test/pilot/inventory-io.test.ts test/pilot/agy-inventory-witness.test.ts test/pilot/agy-inventory-store.test.ts test/pilot/agy-materialization-state.test.ts test/pilot/agy-recipe-plan.test.ts test/pilot/agy-plugin-enablement.test.ts test/pilot/agy-loader-contract.test.ts test/pilot/agy-startup-inventory.test.ts test/pilot/provider-controls.test.ts test/pilot/control-audit.test.ts test/pilot/provider-session.test.ts test/pilot/agy-hook-shell.test.ts` |
| Designated full campaign suite | 600 seconds | `npm test` |

Build current source before any suite that imports `dist`, including the audit suite. Preserve `vitest.config.ts` and default parallelism. Its `test/**/*.test.ts` include keeps the original diagnostic outside maintained discovery. Record argv, cwd, UTC interval, source hashes, current dist hashes when used, exit code, assertion result, log hash, and owned-process settlement. Timeout, truncated output, and unverified settlement are not RED or GREEN.

Rollback evidence records exact changed paths and prior hashes. Preserve immutable witnesses, snapshots, dispositions, and original diagnostics. Do not delete user data, repair unrelated issues, or revert unrelated work. Git publication is a separate coordinator action under its existing authorization.

## Acceptance map and provisional roadmap

| Criterion retained from the approved design | Work and required evidence |
| --- | --- |
| AC1: portable unchanged-source real-acquisition RED | Preserve original acquisition evidence and the outside-`test/` diagnostic/receipt. Task 6.2 adds the maintained same-name regression with positive unchanged reuse and equal-old-digest preconditions. |
| AC2: version-bound complete locations, ordering, enablement, global/workspace/installed and supported layouts | Tasks 5.1 and 5.3 bind actual caller inputs, selectors, native components, and inheritance. Root-rule review alone cannot close this criterion. |
| AC3: disabled metadata fingerprinted, active effects accurate, unknown enablement retained | Task 5.3 consumes the accepted evaluator with source-backed inputs. Disabled mutations change identity without active effects. Unknowns cannot be dispositioned away. |
| AC4: specific unavailable states and retained finite bounds | Task 5.2 closes current read-before-bound defects. Task 5.3 covers full graph limits, cycles, malformed inputs, links, unstable reads, and unresolved native semantics. |
| AC5: drift invalidates reuse and valid unchanged evidence remains reusable | Tasks 6.1–7.1 cover clean preparation, live context, exact source partition, stable Q, zero-effect audit binding, static equivalence, and distinct actual assignment instances. |
| AC6: five-event custody, unrelated-hook checks, offline checks, and no live fixture execution | Tasks 5.3, 7.1, and 8.1 preserve the known policy, all six-event inventory validation, active dependency custody, bounded checks, and independent acceptance. |

The ready horizon contains Task 5.1 discovery and Task 5.2 production hardening. Tasks 5.3, 6.1, 6.2, 7.1, and 8.1 remain named provisional outcomes. Their expansion conditions are stated at their task boundaries. After each checkpoint, the coordinator reassesses every dependent task. It applies maintained writing-plans before promoting new concrete execution steps. It synchronizes existing workflow references without creating a competing plan service or fabricated completion state.

No ready task contains a hidden selector/native/normalization implementation decision. The provisional roadmap retains full useful production integration. A fixed-unknown adapter, unused helper, partial current-store patch, or synthetic fixture admission cannot replace it.

## Author self-review

Spec coverage: all six acceptance criteria map to tasks. Clean-store ordering, exact partition, zero-effect binding, full physical observations, qualified normalization, native authority, and all four lifecycle boundaries remain explicit.

Step scan and task size: ready discovery produces a checkable decision record. Ready implementation changes the actual producer and has behavioral RED/GREEN checks. Each provisional task retains its missing prerequisite and one next evidence check. It cannot advance on a successful first checkbox alone.

Type consistency: interfaces use the inspected accepted types. New signatures are marked proposed. `directoryObservations` remains distinct from semantic `rootListings`. The witness hash binder and source projection functions retain their existing names. No public schema field or test-only admission input is added.

Review focus: each of the five classes above has an owner task and explicit assertions. The original defect cannot pass through an always-unknown negative control. The unchanged positive control remains mandatory.

Proportion: the plan specifies decisions, signatures, assertions, and gates. It does not supply speculative provider implementations. Source qualification and final acceptance remain coordinator obligations. This document claims neither implementation nor issue completion.

Language review: this is an Issue 9-oriented candidate. The official dictionary and governed project terminology are unavailable. The adjacent language note records sources, protected literals, and limits. Full STE conformance is unverified.

## F1 correction self-review

F1 is verified against inspection's disposition call and both audit source loops. Task 5.2 now owns the affected audit file and suite. Its private source helper performs current bounded reads and preserves exact kind/digest comparisons. It accepts no caller-computed digest or completeness claim.

Spec coverage and roadmap are unchanged. All six criteria and Tasks 5.3 through 8.1 remain present. The additional ready-task tests cover matching-disposition inspection, direct reuse, adoption, restored positive reuse, read limits, source kinds, and native tampering. Existing native tests remain intact.

Step size and types remain concrete. The new helper is private to the two audit consumers. Its results cannot bypass native authority. The executable remains an ordinary non-JSON source, so the JSON limit does not make every AGY binary unavailable. Current guarded JSON paths all satisfy the declared reader predicate. The full semantic loader and witness contract remain provisional.

The five original review-focus classes are unchanged. F1 adds a reachable read-order case under Task 5.2. The added detail specifies the missing contract and assertions. It does not rewrite unaffected design or provide production code. Source checks were static only. No tests or implementation ran during this correction.
