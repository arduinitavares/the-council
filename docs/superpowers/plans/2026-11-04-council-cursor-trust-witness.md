# Council Cursor trust witness implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define a strict private Cursor witness, prevent its public disclosure, and preserve unrelated qualification records without enabling production trust.

**Architecture:** Add a Cursor-only versioned contract beside the existing acquisition module. Separate active authorization from historical cache parsing. Apply explicit public projections before serialization, while retaining complete private audit, assignment, and cache data. No production constructor supplies a bound witness in this increment.

**Tech Stack:** TypeScript ESM, Zod `4.6.7`, existing `canonicalJson`/SHA-256, Node `22.23.4`, and a permission-restricted main-thread source fixture.

**Spec:** [Approved design](../specs/2026-11-03-council-cursor-exact-trust-design.md), SHA-256 `522a6d473907dd32daf939dc85c7c493cf46eaa30cdf856614f3387202897b3d`; [accepted findings](../specs/2026-11-03-council-cursor-exact-trust-review.md); [Task 2 roadmap](2026-11-03-council-cursor-exact-trust.md#provisional-roadmap--not-ready-execution-steps). Narrow inputs: [source notes](../../../.superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue5-exact-trust-task1-fix1-20261104/task2-preflight-source-notes.md) and [Task 1 dispositions](../../../.superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue5-exact-trust-task1-fix1-20261104/r2-code-dispositions.md).

## Global Constraints

- Use `/Users/aaat/.codex/worktrees/council-first-use/the-council` at baseline `3f3c3cdf63130d4aa27037c8f0d42ed5fd36dd8b`.
- Preserve the accepted uncommitted Task 1 patch, SHA-256 `33cfa03855914489a38f478a88c526f639147d879c347bad99424e2dbda02bbd`. Its three frozen diff segments matched current files during authoring. Existing untracked work remains intact.
- This assignment writes only this plan. It runs no tests, build, provider, Docker, external request, helper, or git mutation. The coordinator owns review and acceptance.
- Future execution starts with Task 2.0 only. Task 2.1 remains provisional until its fixture boundary passes and the coordinator records the disposition.
- Contract: `cursor-stored-path-2026.10.22-27dcf5f-v1`, Cursor `2026.10.22-27dcf5f` only. Retain the design's exact launcher and bundle identities.
- “At most 128 path components/candidates and 4,096 UTF-8 bytes per path.” “At most 16 KiB per marker, with a single 16 KiB + 1 buffer and a bounded read loop.”
- Preserve native winner precedence, exact path comparison, earlier absences, refusal states, descriptor closure, and read-only acquisition. Marker-derived fields never become read targets.
- No production trust read, positive Cursor route, caller-authored qualification switch, real marker/account data, or wider test command is authorized here.
- Preserve valid non-Cursor recipe/audit schemas, digest algorithms, and input behavior. `producerCodeHash()` already hashes sibling pilot files. Changed producer bytes can change that aggregate hash across all routes.
- Keep exact witness, fact, recipe, scope, and proof fingerprints private. Public Cursor data contains fixed states/reasons and existing run identity only.
- Checked registration, launched runtime/environment binding, audit revalidation, wrapper timing, actual containment, included-only billing, and full acceptance remain separate gates.

## Review Focus

- A historical Cursor record shares a cache with Codex/AGY proofs. Preserve those records, but never authorize the historical Cursor scope. Task 2.1 tests read, matching, and merge.
- Private evidence occurs inside routes, nested recipes, proofs, blockers, and JSON observation strings. Detect Cursor on either side of a route/recipe pair. Task 2.1 tests real `classify` output at each CLI boundary.
- Directory evidence is empty, incomplete, duplicated, or reordered. Return `CURSOR_TRUST_SOURCE_DRIFT` with both trust facts unknown before persistence. Preserve content-only refusal behavior. Task 2.1 owns the deferred Task 1 minor.
- Marker bytes change with restored metadata, or identical bytes move to another inode. Private witness digests must change. Task 2.1 tests representation; live revalidation remains roadmap Task 4.
- A Cursor schema change alters Codex/AGY serialization or ordinary cache errors. Preserve their prior behavior. Task 2.1 compares frozen synthetic bytes and error codes.

---

## Focused file map and source facts

| File | Responsibility |
| --- | --- |
| Create `test/pilot/cursor-trust-witness.source.mjs` | One source fixture for smoke, behavioral RED, and GREEN. No Vitest or `dist` import. |
| Create `.superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue5-task2-witness-fixture-20261104/{run-witness-source-fixture.py,stubs.mjs,scratch/}` | Task-owned supervisor, explicit external-boundary stubs, and disposable storage. These are proposed paths, not existing qualification evidence. |
| Create `src/pilot/cursor-trust-witness.ts` | Strict data schemas, private digest functions, and witness invariants. No launch authority or filesystem acquisition. |
| Modify `src/pilot/cursor-trust.ts:116–159,184–264` | Add the deterministic directory-completeness helper and selection-custody failure. Preserve accepted content-only refusal and malformed-content behavior. |
| Modify `src/pilot/wrapper-contract.ts:37–63,143–146` | Cursor-only recipe version, private assignment validation, and safe fact detail. Preserve the non-Cursor branches. |
| Modify `src/pilot/control-audit.ts:20–42,94–116` | Cursor-only snapshot version, private persistence, and explicit unavailable revalidation gate. |
| Modify `src/pilot/qualification-cache.ts:41–105,144–203` | Separate strict historical storage parsing from active proof eligibility. Preserve locking, merge, TTL, and corruption behavior. |
| Create `src/pilot/public-projection.ts`; modify `src/pilot/cli.ts:45,182–188,223,248` | Project Cursor audit output and both native outcome writes plus stdout. Cache writes still receive the private outcome. |
| Modify `src/pilot/provider-controls.ts:286–303` | Produce only an unavailable Cursor contract. Add no call to `acquireCursorTrust`. Keep non-Cursor audit/recipe hashing unchanged. |
| Read unchanged `src/pilot/workflow.ts:26–45,137–144,163`, `types.ts:25–76`, `discovery.ts:331–342`, `preflight.ts:9–24,61–79` | Outcomes retain evidence, proofs, and blockers. Test the real `classify` function. Preserve workflow and proof-key algorithms. |

`saveAuditSnapshot()` currently returns the complete private snapshot. CLI audit preparation prints that return directly. `factsObservation()` currently embeds every fact digest in a JSON string. The two native outcome writes and final stdout serialize the private outcome directly. These are observed exposure paths, even though no witness currently exists or is emitted.

The shared cache validates every stored recipe with `recipeSchema`. Tightening that schema without a storage strategy would make a valid mixed cache appear corrupt. Historical parsing must therefore remain separate from authorization.

This correction applies the [coordinator's verified dispositions](../../../.superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue5-cursor-witness-plan-20261104/coordinator-plan-findings.md) to reviewed draft `841204c07015b6d6125a30e06c61823857f48f8ef5ee38d54e98664947563e0f`. The existing review does not make Task 2.1 executable.

## Task 2.0: verify the bounded witness fixture — first executable task

**Owner:** A coordinator-assigned executor. **Prerequisite:** The coordinator's plan gate. **Deliverable:** A qualified fixture boundary, with no product edit.

**Files:** Create only the fixture and task-owned supervisor/stub/scratch paths in the map. Read the existing `issue5-direct-source-fixture-20261103/{run-trust-source-fixture.py,red-check.mjs}` and `test/pilot/cursor-trust-acquisition.source.mjs`. Do not modify them.

**Interfaces:** The supervisor accepts exactly `smoke`, `red`, or `green`. Each invocation starts exactly one Node child. The fixture emits one bounded JSON receipt. CLI calls use the existing `runNativeCli(argv: readonly string[]): Promise<void>` export.

- [ ] **Step 1: create the source loader and explicit boundary stubs.** Reuse the recorded `registerHooks` relative `.js` to current `.ts` resolution. Install filesystem and external-boundary hooks before source imports. Use the existing CLI diagnostic test's dependency seams, but do not copy its `dist`/Vitest runner. Stub `OrcaClient.connect`, `commandFromClient`, `NativeHostInspector`, RPC constructors, `createNativePilotDriver`, `runPilot`, `readProvider`, and audit preparation/adoption only for the CLI consumer. The workflow stub returns a fixture-owned synthetic outcome. The audit stub delegates persistence to the real `saveAuditSnapshot()` with a synthetic snapshot. Keep CLI serialization, cache, journal, audit storage, schemas, fact projection, and hash functions real. Record every substitution by exact module/export. A direct fixture import of an original source module must not resolve to its CLI stub.

  Give every direct CLI call explicit owned paths. For each isolated case, create the following inputs under its own scratch workspace:

```js
const workspace = join(scratch, caseName, 'workspace');
const configFile = join(workspace, 'roster.yaml');
const inputFile = join(workspace, 'request.json');
const policyFile = join(workspace, 'synthetic-policy.md');
const nativeArgv = ['--workspace', workspace, '--config', configFile,
  '--input', inputFile, '--policy', policyFile,
  '--orca', join(workspace, 'never-executed-orca')];
const auditArgv = ['audit', 'prepare', '--workspace', workspace,
  '--config', configFile, '--role', 'xai'];
```

  Write a valid synthetic roster as YAML, a valid bounded native request, and synthetic policy text. Keep real argument parsing, path resolution, and YAML loading. Do not grant Node access to the repository roster or canonical host policy. The never-executed Orca path is fixture data. It is not an executable fixture. Pin `Date.now()` to `2000` within each CLI case and restore it afterwards.

- [ ] **Step 2: implement the supervisor's single-child boundary.** Use `/opt/homebrew/opt/node@22/bin/node --experimental-transform-types --permission`. Allow reads only from current `src`, `node_modules`, `package.json`, the fixture entry, and this task-owned case directory. Allow writes only to this case's `scratch/`. Do not grant child, worker, addon, or WASI permissions. Supply only `PATH=/usr/bin:/bin`, synthetic `HOME`, `LANG=en_US.UTF-8`, `COUNCIL_TEST_SCRATCH`, and `COUNCIL_TEST_PHASE`. Clear inherited Node options and provider variables by constructing this environment from scratch. Permit no external command or transport call. Install throwing spies for child processes, network/fetch/WebSocket, and provider/RPC calls before imports. These spies are fixture controls, not production containment evidence.

  Check the exact cwd and empty owned scratch before launch. Enforce a 12-second deadline, 16,384 stdout bytes, and 4,096 stderr bytes. Stop and reap the owned child on excess output or timeout. Do not start a second Node process to inspect its version. The child reports `process.versions.node`, permission states, import inventory, and stub counters itself.

  Retain bounded raw stderr in the private receipt. For smoke and GREEN, accept only empty stderr or the exact two-line warning recorded in `issue5-cursor-witness-plan-20261104/projection-and-scope-receipt.json`:

```text
(node:<decimal PID>) ExperimentalWarning: Transform Types is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
```

  Match `<decimal PID>` as ASCII `[0-9]+` only. Require exact LF line endings and the final newline. Compare the complete raw bytes without trimming or rewriting. Reject additional stderr bytes or lines. Keep RED's behavioral assertion and expected exit checks separate from this smoke/GREEN allowlist.

- [ ] **Step 3: write the smoke assertions.** Import the existing schema, audit, cache, fact, `classify`, and CLI exports through the source loader. Exercise synthetic cache open/close, private audit save, both explicit CLI argv forms, and restoration without a trust read. Assert that real argument parsing and YAML loading consumed only the owned files. Intercept every CLI `console.log` so that only the final receipt reaches child stdout. Assert Node `22.23.4`, `sourceOnly:true`, `childPermission:false`, `workerPermission:false`, `providerCalls:0`, `externalCalls:0`, `markerReads:0`, all descriptors closed, restored environment/builtins/clock/exit code, and empty scratch. Verify every real Council module comes from current `src`; separately enumerate the declared fixture stubs. Assert that the fixture source contains no `dist` import, build, test-runner, installed command lookup, or provider executable invocation.

- [ ] **Step 4: run only the smoke qualification.** From the exact checkout, run:

```sh
/opt/homebrew/bin/python3 .superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue5-task2-witness-fixture-20261104/run-witness-source-fixture.py smoke
```

Expected: supervisor exit `0`, Node exit `0`, one accepted receipt, stderr accepted only by Step 2's exact empty-or-warning rule, closed descriptors, and empty scratch. Retain exact source/stub hashes and the receipt privately. A loader/import error, unexpected access, timeout, or leftover fails this task. Preserve unexpected objects. Do not widen permissions or fall back to a build, Vitest, or provider.

- [ ] **Step 5: return the qualification result and reassess.** Stop at the fixture boundary. The coordinator reviews the actual runner, substitutions, effects, and receipt. Publish no canonical plan state from this author assignment. Task 2.1 stays provisional if any required source import, CLI seam, write custody, or cleanup assumption is unproved.

## Task 2.1: add the private witness, projections, and compatible cache — provisional

**Readiness:** Not executable yet. Expand or correct this task from Task 2.0 evidence before execution. Its product changes form one reviewable increment because strict persistence is unsafe without its privacy and historical-cache protections.

**Files:** The product files and fixture in the focused map. Do not edit discovery, preflight, provider session, global settings, or Task 1 receipts.

**Interfaces — proposed names, not existing exports:**

- `cursorTrustWitnessSchema`, `CursorTrustWitness`, and `cursorTrustStateSchema` in `cursor-trust-witness.ts`.
- `cursorTrustWitnessDigest(witness: CursorTrustWitness): string` returns `sha256(canonicalJson(cursorTrustWitnessSchema.parse(witness)))`.
- `cursorTrustFactDigest(source: string, detail: string, witness: CursorTrustWitness): string` hashes canonical `{ source, detail, cursorTrust: cursorTrustWitnessDigest(witness) }`. It excludes `observedAt`.
- Extend `CursorTrustEvidence` with `directoryCount: number` and `directoryLayoutSha256: string`. Keep its existing identity fields precise decimal strings.
- `completeCursorDirectoryEvidence(requiredPaths: readonly string[], observed: ReadonlyMap<string, CursorTrustDirectoryIdentity>): CursorTrustDirectoryCoverage` is a pure helper in `cursor-trust.ts`. Its result contains exactly `directories`, `directoryCount`, and `directoryLayoutSha256`. Missing, extra, empty, duplicate, or misordered coverage throws the fixed `CURSOR_TRUST_SOURCE_DRIFT` acquisition failure.
- `CursorTrustFactProjectionInput` is `Pick<CursorTrustAcquisition, 'nativeAdmission' | 'exactIdentity' | 'reason'>`. Its reason comes from the typed acquisition result or an explicit typed unqualified result. Never derive it from observation text or a witness digest.
- Keep `factsObservation(facts, stage, route?, trustProjection?)` compatible with its current two arguments. Both provider-control calls pass `selection.route` and the typed Cursor input where applicable. Missing Cursor provenance produces an unavailable summary. Non-Cursor calls retain their current output.
- `projectCursorFactDetail(input: CursorTrustFactProjectionInput, stage: 'bootstrap' | 'effective'): string` emits the two fixed bootstrap trust names, typed states, and allowlisted reason. It returns canonical `[]` for `effective`, because neither trust fact belongs to that stage. It ignores observation source/detail strings.
- `isCursorBearingRoute(route: unknown): boolean` detects Cursor in the enclosing selection, recipe selection/protocol, or presence of `cursorRecipeVersion`/`cursorTrust`. Use the same predicate for eligibility and conservative public projection, including malformed data.
- `projectCursorBlocker(blocker: Blocker): Blocker` emits a fixed summary for an associated Cursor-bearing role. Preserve only allowlisted control/reason pairs produced by `classify`. Use `source:'Cursor prerequisite gate'`, `observed:'unverified'`, and `nextAction:'Complete the separate Cursor admission gates.'`. Unknown pairs become `controls`/`CONTROLS_UNKNOWN`.
- `projectAuditPreparation(prepared: ReturnType<typeof saveAuditSnapshot>): PublicAuditPreparation` retains the old non-Cursor output. Cursor output contains only `providerQualification` and `trust:{ state, reason }` from the accepted snapshot's typed `cursorTrust`. A bound snapshot reports `state:'bound', reason:null` as a representation status. It supplies no fact array or broader enforcement claim. The CLI adds `status:'audit_prepared'`. Omit snapshot, hash, hash-bearing path, effects text, and unavailable text.
- `projectPilotOutcome(outcome: PilotOutcome): PublicPilotOutcome` returns a detached public view. CLI uses it for both outcome writes and final stdout. `record` remains the existing run record reference. No public view is an authorization artifact.
- Infer `StoredQualificationProof` from a strict storage schema. `QualificationCache.read(): StoredQualificationProof[]`; `matching(evidence, now, verify): Promise<QualificationProof[]>`; `write(proofs: readonly QualificationProof[], now?): void`. Only active proofs reach `verify`.

### Contract decisions

All objects below are strict. Reject extra fields at every nested level. Hash strings use `/^[a-f0-9]{64}$/`. Candidate ordinals are integers `0..127`. Decimal identities never pass through `Number`.

| Witness field | Exact content / invariant |
| --- | --- |
| `version`, `contract` | `1`, `cursor-stored-path-2026.10.22-27dcf5f-v1` |
| `build` | `providerVersion:'2026.10.22-27dcf5f'`; pinned `launcherSha256`, `indexSha256`, `entrySha256`; hash-shaped `runtimeSha256` and `launchChainSha256`. Copy the three pinned identities from the approved design. Synthetic values establish schema behavior only. |
| `binding` | Hashes named `workspaceSha256`, `packetCwdSha256`, `requestedWorkspaceSha256`, `registeredWorkspaceIdSha256`, `environmentSha256`, and `executionSha256`. The last binds actual cwd and `--workspace`; environment binds effective HOME/data-root selection. Task 3 supplies authoritative producers. |
| `evidence` | Existing `CursorTrustEvidence`, plus directory count/layout commitment. `candidateOrdinal === marker.ordinal`; ordinal `0` iff relation is `direct`; `earlierAbsences` equals `[0, ..., candidateOrdinal-1]` exactly. `byteCount` is an integer `1..16384` and equals decimal marker size; marker `nlink === '1'`. |
| Directory coverage | Nonempty identities, exact count, and unique contiguous ordinals `0..directoryCount-1` in order. Count/layout originate in the validated acquisition walk. A caller's count alone never establishes completeness or qualification. |
| `comparison` | Strict `{ writerShape:'known-writer-v1', storedPath:'exact-selected-candidate', nativeSelection:'matched' }`. No timestamp, method value, source hint, normalized key, stored spelling, or body survives. |

`cursorTrustStateSchema` has exactly two alternatives: `{ state:'unavailable', reason:CursorTrustReason }` and `{ state:'bound', witness:CursorTrustWitness }`. Neither alternative grants authority. There is no `qualified:true` or production fixture flag.

The Cursor recipe adds mandatory `cursorRecipeVersion:2` and `cursorTrust`, with both `selection.route === 'cursor'` and `protocol === 'cursor-stream'`. The non-Cursor branch keeps the prior shape and rejects these Cursor fields. A recipe with only one Cursor discriminator is invalid.

For every active Cursor-bearing route, require a recipe and exact equality of enclosing and recipe selections, including model/effort. Require the Cursor protocol, version, and bound witness. Apply the same enclosing-selection rule to assignments. Recipe-less, historical, unavailable, and inconsistent Cursor-bearing scopes fail before native verification. A scope with any such route is wholly ineligible. Storage compatibility does not grant active meaning.

The Cursor audit becomes `version:2`, `route:'cursor'`, the exact trust contract, and mandatory `cursorTrust`. Codex/AGY audits retain version `1` and their existing fields. Cursor version `1` is historical data, not an active audit. Missing or extra witness members fail parsing.

Current production recipes and audit preparation use only `state:'unavailable'` with `CURSOR_TRUST_CONTRACT_UNSUPPORTED`. Both trust facts remain unsupported. No private witness is assembled or emitted from discovery/preparation. A Cursor assignment and an active Cursor proof require a bound witness; unavailable data cannot authorize them, even with forged verified fact text.

Until roadmap Task 4 supplies dedicated validation, Cursor adoption/reuse returns `AUDIT_CURSOR_TRUST_REVALIDATION_UNAVAILABLE` before native authority calls. Keep this audit error separate from fact reasons and diagnostic codes. Saving a synthetic snapshot does not authorize adoption.

### Test cycle and implementation steps

- [ ] **Step 1: add behavioral RED cases using existing exports.** Run the qualified fixture on unchanged product source. Do not import the proposed witness module in RED. Use `recipeSchema`, `auditSnapshotSchema`, `factsObservation`, real `classify`, `QualificationCache`, and actual `runNativeCli`. The following assertions must expose current behavior, not missing symbols:

```js
assert.equal(recipeSchema.safeParse(oldCursorRecipe).success, false,
  'historical Cursor recipe must not be active');
assert.equal(auditSnapshotSchema.safeParse(oldCursorAudit).success, false,
  'historical Cursor audit must not be active');
assert.equal(factsObservation(cursorFacts, 'bootstrap', 'cursor')
  .detail.includes(privateHash), false, 'Cursor fact fingerprint must stay private');
let nativeChecks = 0;
assert.deepEqual(await cache.matching(oldCursorEvidence, 2000, async () => {
  nativeChecks++; return true;
}), [], 'historical Cursor proof must not qualify');
assert.equal(nativeChecks, 0);
for (const bytes of [...cliOutcomeWrites, cliStdout, auditPrepareStdout]) {
  assert.equal(bytes.includes(privateHash), false, 'private fingerprint serialized');
  assert.equal(bytes.includes('PRIVATE_TRUST_SENTINEL'), false);
}
```

  Define `privateHash = sha256('PRIVATE_TRUST_SENTINEL')`. Build `oldCursorRecipe` from the existing required recipe fields, without new fields. Use a synthetic Cursor `grok-4.7-xhigh`/`xhigh` selection. Its fact digest equals `privateHash`; its observation detail is `canonicalJson({ contentSha256:privateHash, path:'PRIVATE_TRUST_SENTINEL' })`. Build `oldCursorAudit` as the current version `1` Cursor shape, with synthetic workspace/executable, empty source/effect lists, and `recipeHash:privateHash`. Create evidence with exposed synthetic Orca version, one route, and that recipe. Construct valid schema-version `1` proofs as follows:

```js
const proof = scope => {
  const key = proofKey(scope, scope.routes[0]);
  return { schemaVersion:1, id:key, key, scope, issuedAt:1000, expiresAt:5000,
    normal:{ dispatchId:'normal-owned', outcome:'completed', settled:true },
    cancellation:{ dispatchId:'cancel-owned', outcome:'cancelled', settled:true },
    settled:true };
};
```

  Seed historical cache bytes directly in owned scratch. Do not use the new active writer to create historical inputs. Put the same synthetic route in both `outcome.evidence.routes` and `outcome.proofs[0].scope.routes`. The CLI stubs supply that outcome without a provider. Run audit preparation through the real CLI with the saved synthetic snapshot. Capture initial and replacement outcome writes, including descriptor writes. Inject `QUALIFICATION_CACHE_CLOCK_INVALID` after the initial write to exercise failure replacement. Keep the real output and persistence code under test.

  Add the independent blocker path using the real classifier. Construct `syntheticRequest` from the owned roster, workspace, request, and policy paths above. Set its proofs to `[]`.

```js
const blockerEvidence = structuredClone(oldCursorEvidence);
const cursorRoute = blockerEvidence.routes[0];
cursorRoute.bootstrap = { state:'unknown', source:'PRIVATE_TRUST_SENTINEL',
  detail:privateHash };
const blockers = classify(syntheticRequest, blockerEvidence, 'bootstrap');
const blocker = blockers.find(b => b.role === cursorRoute.role && b.control === 'controls');
assert(blocker);
assert.equal(blocker.reason, 'CONTROLS_UNKNOWN');
outcome.blockers = blockers;
```

  Pass this private outcome through each actual native serialization boundary. Require the fixed public blocker summary, without either sentinel field. Keep a non-Cursor blocker as a byte-identical control. RED audit stdout uses only the version-1 input accepted by the current schema. GREEN uses the separate accepted and rejected audit cases below.

- [ ] **Step 2: record a meaningful RED.** Run the same supervisor with argument `red`. Collect named assertion failures after exercising the boundaries. Expected: Node exit `1` with at least the historical acceptance or serialization assertion above; supervisor records that expected behavioral failure and exits `0`. Require clean fixture settlement. Missing module, Zod setup error, permission error, or loader failure is not RED. Keep RED input/source hashes separate from GREEN.

- [ ] **Step 3: implement strict data contracts and directory completeness.** Add the proposed witness schemas and digest methods. Before serializing acquisition evidence, retain an independent ordered set of required, successfully validated directory components from each path walk. Include W/P/home/root/projects, selected candidate components, and existing components visited for earlier absences. Pass that required order and the observed identity map to `completeCursorDirectoryEvidence`. Validate one identity per required path and its exact ordinal. The helper hashes the authorized path layout privately and returns no paths. Empty output, gaps, duplicates, or missing/extra components throw `CURSOR_TRUST_SOURCE_DRIFT`. Treat this as invalidated selection custody: both native admission and exact identity become `unknown`, with no evidence or persistence. Resolve this deferred Task 1 minor before persistence. Exclude directory content timestamps and acquisition-clock values.

  Test the pure helper with a complete map and each incomplete mutation. For the acquisition integration case, install a scoped `Map.prototype.set` hook after imports. Suppress only one declared synthetic directory-stat entry during one synchronous acquisition. Restore the hook in `finally`. The independent required-path list must still contain that entry. Assert both trust facts `unknown`, reason `CURSOR_TRUST_SOURCE_DRIFT`, null evidence, and zero persistence. This is a test-only fault seam, not a production option. Replay content-only EACCES/EPERM after established selection: native admission remains `verified`, exact identity is `denied`, and reason is `CURSOR_TRUST_UNREADABLE`. Malformed content retains native admission with unknown exact identity and `CURSOR_TRUST_MALFORMED`. Neither content case becomes selection drift.

  Split recipe and audit schemas into the Cursor and unchanged non-Cursor branches above. Keep `saveAuditSnapshot()`'s full private return and mode `0600` storage. Parse/validate before writing. Add the explicit Cursor revalidation-unavailable gate without implementing live revalidation. Set only the unavailable Cursor contract in `provider-controls.ts`. For Cursor only, include its contract state in the existing recipe-hash input. Do not change the non-Cursor formula. Private synthetic bound witness changes must propagate through fact, recipe, audit, controls, and proof identity. No marker becomes a generic `AuditSource`.

- [ ] **Step 4: implement public projection before every serialization.** Add explicit public types in `public-projection.ts`, using type-only imports for private contracts. Avoid runtime cycles with `wrapper-contract.ts`. Preserve the current overall fact-state calculation and denial priority. For Cursor, use typed trust provenance and the explicit empty effective-stage detail. Do not parse or relay nested detail strings. A bound witness never supplies catalog, billing, containment, or broader control states.

  In a public outcome, use `isCursorBearingRoute` before any non-Cursor passthrough. Replace each Cursor-bearing route with `{ role, selection, states, trust }` using validated fields only. Derive route `trust` from the recipe's typed contract state. Invalid or inconsistent pairs receive a fixed unavailable summary. Omit recipe, control facts, scoped launch data, and free-text observations. For Cursor-bearing evidence, omit `policyHash`, `controlsHash`, and `producerCodeHash`. For any proof with a Cursor-bearing scope, publish only `{ schemaVersion, settled, normal:{outcome,settled}, cancellation:{outcome,settled} }`. Omit scope, id/key, and context hashes. Preserve ordinary consistent non-Cursor views.

  Collect Cursor-bearing roles from evidence and all proof scopes. Project their blockers with `projectCursorBlocker`. Treat role-null blockers conservatively whenever the outcome is Cursor-bearing. Preserve useful allowlisted reasons such as `CONTROLS_UNKNOWN` and `CONTROLS_DENIED`. Never pass through blocker `source`, `observed`, or free text for these roles. Preserve ordinary non-Cursor blockers. Apply this blocker projection to the initial outcome write, replacement write, and stdout, alongside route/proof projection.

  Apply this projection to `cli.ts`'s initial outcome write, failure replacement write, and final stdout. Apply the audit projection before the audit-prepared `console.log`. Preserve outcome version `2`, call counts, diagnostic counters, failure handling, and the existing run `record` reference. Never mutate the private outcome: `cache.write(outcome.proofs)` still receives exact data. Keep exact witnesses in private audit snapshots, assignments, and proof cache. Public projections must not parse as private authorization records.

- [ ] **Step 5: implement strict historical cache storage and active selection.** Preserve the exact pre-change storage shape as a historical branch. Retain structurally valid recipe-less Cursor records and historical enclosing-route/recipe mismatches as inactive data. This compatibility branch permits no new Cursor contract fields. Current records use the new strict schemas and enclosing-selection checks. New-field mismatches, unknown fields, and malformed data remain corruption errors. Do not use passthrough, catch-and-drop, defaults, or migration. Preserve existing TTL/scope/key validation. Keep active `proofSchema` separate from storage parsing.

  `read()` returns validated stored records. `matching()` applies the same Cursor-bearing and enclosing-selection rules as active assignments. Exclude every recipe-less, historical, unavailable, or inconsistent Cursor-bearing proof before its native callback. Do not remove a route or recompute the bound key. Parse eligible proofs before the existing exact-key/TTL/native checks. Preserve valid Codex/AGY-only records and native verification in the same file. A scope containing any ineligible Cursor-bearing route is wholly ineligible.

  `write()` validates incoming active proofs, then merges them with validated stored records under the existing exclusive lock. Validate the merged result with the storage schema. Preserve unexpired historical records byte-equivalently as JSON values. Retain existing expiry and freshest-key rules. Malformed records still raise `QUALIFICATION_CACHE_CORRUPT`; they are not historical compatibility. Preserve busy, symlink, lock ownership, clock, and native verification errors. Do not rewrite the cache merely because `matching()` rejects a historical proof.

- [ ] **Step 6: add GREEN-only witness and compatibility assertions.** Import the new schema only after implementation. Define `w` as a complete synthetic witness with two declared directory identities, count `2`, ordinals `[0,1]`, same-read content hash, and fixed comparison members. Give every required build/binding member its named synthetic commitment. This tests representation, not qualified acquisition. Pin the important mutations directly:

```js
assert(cursorTrustWitnessSchema.safeParse(w).success);
for (const evidence of [
  { ...w.evidence, directories:[] },
  { ...w.evidence, directories:w.evidence.directories.slice(1) },
  { ...w.evidence, directories:[w.evidence.directories[0], w.evidence.directories[0]] },
  { ...w.evidence, earlierAbsences:[1] },
  { ...w.evidence, marker:{ ...w.evidence.marker, ordinal:1 } },
]) assert.equal(cursorTrustWitnessSchema.safeParse({ ...w, evidence }).success, false);
assert.equal(cursorTrustWitnessSchema.safeParse({ ...w, acquiredAt:2000 }).success, false);
assert.equal(cursorTrustWitnessSchema.safeParse({ ...w, comparison:{ ...w.comparison, raw:'PRIVATE_TRUST_SENTINEL' } }).success, false);
const digest = cursorTrustWitnessDigest(w);
for (const change of [
  { contentSha256:sha256('same-size changed bytes') },
  { marker:{ ...w.evidence.marker, ino:'999' } },
]) assert.notEqual(cursorTrustWitnessDigest({ ...w, evidence:{ ...w.evidence, ...change } }), digest);
assert.equal(cursorTrustWitnessDigest(structuredClone(w)), digest);
assert.equal(cursorTrustFactDigest('fixture', 'exact', w),
  cursorTrustFactDigest('fixture', 'exact', structuredClone(w)));
```

  Use separate fixture functions and owned workspaces for accepted audit, rejected audit, normal cache, invalid clock, and outcome replacement cases. They may run sequentially in the same restricted Node process. Restore all fault hooks and clock/exit state between cases. Never fake successful persistence for rejected input. Add the following named cases.

| Case | Required assertions |
| --- | --- |
| `strict-cursor-contract` | Reject missing/extra witness fields, old/missing recipe version, malformed decimals/hash/counts, wrong route/protocol, and non-Cursor witness. Check both enclosing selections for proof and assignment. Recipe-less, historical, unavailable, and mismatched Cursor-bearing inputs cannot reach native verification. |
| `typed-trust-projection` | Feed typed acquired and unqualified results to fact projection. Assert the two bootstrap names and exact typed states/reason. Effective detail is `[]`. Sentinel source/detail text is ignored. Audit projection uses the accepted snapshot's contract state without inventing a fact array or broader enforcement. |
| `complete-directory-coverage` | Test `completeCursorDirectoryEvidence` directly for complete, empty, missing, extra, duplicate, and wrong-ordinal maps. Run the synchronous scoped directory-entry fault through actual acquisition. Both facts become unknown with `CURSOR_TRUST_SOURCE_DRIFT`, null evidence, and no persisted witness. Replay the content-only denial and malformed-content controls unchanged. |
| `stable-and-changed-private-digests` | Vary acquisition time and ordinary packet-directory mtime across acquisitions: same witness digest. Change bytes with equal size/restored mtime, inode with identical bytes, or earlier winner: different evidence/digest or failed acquisition. Test binding/contract changes similarly. Dedicated production reuse rejection remains Task 4. |
| `private-roundtrip` | Round-trip a consistent bound Cursor recipe through `assignmentSchema` with exact hashes. No wrapper runs. Assert witness changes propagate through audit, controls, and proof hashes without changing algorithms. Audit and cache storage use their separate cases below. |
| `audit-accepted-bound`, `audit-accepted-unavailable` | Call real `saveAuditSnapshot` through audit CLI preparation with each accepted version-2 shape. Check private bytes and mode `0600`. Assert exact public status/contract summary. Assert absence of the bare saved hash, full saved path, hash-bearing filename, nested snapshot, effects, unavailable text, and sentinels. Unavailable cannot acquire a disposition. |
| `audit-rejected-historical`, `audit-rejected-malformed` | In GREEN, let real `saveAuditSnapshot` reject version 1 or malformed input. Require CLI exit code `2`, status `invalid_request`, reason/diagnostic code `NATIVE_REQUEST_INVALID`, no snapshot file, and no `audit_prepared` output. Require no private hashes or sentinels. RED retains only the historical version-1 acceptance characterization. |
| `blocker-and-scope-projection` | Use real `classify` with sentinel source/detail. At initial write, replacement, and stdout, require the fixed Cursor blocker summary and preserved stable reason. Test Cursor recipe under Codex selection, Cursor route without recipe, inconsistent selection/model, and malformed Cursor fields. All receive conservative public summaries. Ordinary non-Cursor blocker bytes stay identical. |
| `all-public-boundaries` | Exercise accepted bound/unavailable data and direct invalid-data projection separately from rejected audit persistence. Put sentinels in every witness group and nested detail string. Require no witness/hash/sentinel in fact detail or native output. Assert projection does not mutate its private input. |
| `cache-normal-roundtrip` | With valid clock `2000`, write/read a current consistent bound proof. Assert exact private witness bytes and no fault injection. This case alone verifies successful incoming-cache persistence. |
| `cache-invalid-clock` | Call real `write` with `NaN`. Require `QUALIFICATION_CACHE_CLOCK_INVALID`, zero merge/replace effects, and unchanged existing cache bytes. Do not expect incoming proofs to persist. |
| `outcome-failure-replacement` | After the initial outcome write, wrap only this case's cache write to call the real method with `NaN`. Require the clock diagnostic, unchanged cache, sanitized initial/replacement/stdout bytes, preserved actual calls, and final failed status. This case does not prove a successful cache merge. |
| `historical-mixed-cache` | Seed unexpired Codex-only/AGY-only proofs plus historical, recipe-less, unavailable, and exact legacy mismatched Cursor-bearing records. Read all unchanged. Match only eligible non-Cursor proofs with native callbacks. Merge a current bound proof without changing unrelated records. Ineligible scopes never reach a callback. New-field mismatches, unknown fields, invalid TTL/key remain corruption errors without a rewrite. |
| `non-cursor-regression` | Freeze valid Codex and AGY recipe/audit JSON and expected digest results during RED. After GREEN, compare identical schema outputs, audit/fact/proof-key results, and public bytes for those same inputs. Do not assert unchanged aggregate producer hashes across source edits. |
| `fixture-and-production-gates` | Keep all Task 2.0 custody assertions. Verify current production Cursor contract stays unavailable and both trust facts remain unsupported under isolated discovery stubs. An acquisition spy observes zero marker reads. No fixture input can install a positive production binding. |

- [ ] **Step 7: run bounded GREEN and freeze the handoff.** Run the same supervisor with argument `green`. Expected: Node exit `0`, supervisor exit `0`, all named groups present, stderr accepted only by Task 2.0 Step 2's exact empty-or-warning rule, zero external/provider/marker reads outside declared synthetic acquisition, no children/workers, restored globals, closed descriptors, and empty scratch. Preserve private exact inputs/hashes and bounded receipts. Freeze the Task 2 diff separately from the accepted Task 1 diff. Do not stage, commit, reset, or clean either patch. The coordinator owns independent review, dispositions, and acceptance. Typecheck/build/full regression coverage remain outstanding until their separate custody gate opens.

## Provisional roadmap and expansion conditions

| Outcome | Prerequisite and expansion condition |
| --- | --- |
| Task 3: checked binding and production witness constructor | Accepted Task 2 plus actual launcher/adjacent runtime/bundle, registered workspace, packet preparation, environment, local namespace/ACL, and ancestor-selection evidence. No input flag or synthetic witness supplies this authority. |
| Task 4: audit adoption and retained reuse | A qualified constructor, reconstructable context, and private owner handoff of the saved hash/path required by `--hash`. Expand dedicated validation at adoption and audit/proof reuse. Replace the unavailable gate only after accepted drift and private-handoff tests. |
| Task 5: spawn and final input | Accepted binding/reuse contract and qualified wrapper fixture. Preserve materialization order, the final synchronous check, and a repeated deadline/cancellation/error guard before reservation/write. No atomic handoff is claimed. |
| Task 6: host and campaign acceptance | A supported provider-free native qualification mechanism, alias/filesystem qualification, wider test-loader/process custody, independent #5 containment/Deny/helper/startup controls, and #6 included-only billing enforcement. No positive Cursor route opens before the coordinator's full acceptance. |

Before positive admission, retain three additional privacy conditions. The private audit handoff must support owner adoption without restoring the public digest/path output. Protected journal assignment/intent digests in `context-driver.ts:157–179` and `journal.ts:73–77,103–106,175–196` require private custody and later presentation review. Preserve lifecycle identifiers and settlement behavior. Provider-visible `qualificationFingerprint` in `workflow.ts:281–295` and `verify-proof.ts:124–142` requires a verified correlation/transcript privacy contract before live qualification. Preserve the internal hash chain. Task 2 transmits nothing. This draft changes none of these production paths.

## Five-part self-review

1. **Spec coverage:** Task 2.1 includes blocker and enclosing-recipe paths, typed trust provenance, strict contracts, directory completeness, and compatible cache storage. Private adoption, journal custody, and provider-visible fingerprint handling remain explicit positive-admission conditions.
2. **Step scan:** Task 2.0 remains fixture-only with explicit synthetic CLI argv and custody. Accepted/rejected audit, normal cache, invalid-clock, and replacement cases have separate fixtures. Product work remains provisional. Missing modules cannot establish RED.
3. **Type consistency:** Active proof/assignment eligibility uses the same enclosing Cursor rules. Historical storage and conservative public summaries grant no authority. Fact reasons come from typed results. Audit contract status supplies no invented fact array or broader enforcement.
4. **Review Focus:** Named tests cover real `classify` blockers, inconsistent nested recipes, exact directory failure, both persistence paths, and non-Cursor controls. Content-only refusal and malformed-content behavior remain distinct from selection-custody drift.
5. **Proportion:** One fixture verification task precedes one cohesive provisional increment. Later outcomes remain coarse in the linked roadmap. No implementation or verification result is claimed by this plan. The coordinator retains review and acceptance.

**Planning note:** Loaded writing-plans from `/Users/aaat/.codex/plugins/cache/openai-curated-remote/superpowers/7.0.1/skills/writing-plans/SKILL.md` (version `7.0.1`) and adaptive-planning version `2026-10-23-superpowers-planning-1`, including its maintained integration contract. This repository artifact does not mutate the coordinator's canonical service state. Language review used the installed STE procedure, description, terminology, and protected-literal guidance. This is an Issue 9-oriented candidate. The official dictionary and governed terminology were unavailable. Paths, commands, schema literals, limits, and source references were preserved; full vocabulary conformance remains unverified.
