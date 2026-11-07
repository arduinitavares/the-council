# Issue 3 hook validation readiness implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate complete acquired native hook sources against the reviewed compiled source contract before any source contribution escapes.

**Architecture:** A private validator consumes guarded raw bytes at the real AGY acquisition boundary. Its result describes source conformance only. Existing audit refusals retain unavailable activation and startup inputs.

**Tech Stack:** TypeScript, Node.js, Vitest, bounded inventory readers, existing native audit authentication.

**Spec:** `.superpowers/sdd/2026-11-01-issue-3-loader-witness/research/input/approved-design.md`; `docs/superpowers/plans/2026-11-02-issue-3-production-inventory-integration-v2.md`; accepted H1 plan `700c6438`; accepted decoder report `85c76d56`.

## Global constraints

- This fix round edits only this plan and its adjacent language note. It performs static document checks only.
- Root owns supervision, graph changes, delegation, independent reviews, integration, acceptance, and all future execution.
- Preserve the approved Subagent-Driven Development method, templates, verdicts, fix budgets, and ledger. No handoff interview is required.
- Preserve public interfaces, strict recipe schema, audit version 1, source kinds, byte digests, and native authority checks.
- Add no public qualification, completeness, contract, enablement, or runtime setter. A fixture cannot authorize production activity.
- Keep six-event native validation separate from five-event Orca authority. `SessionStart` grants no new authority event.
- Keep loader suppression, `Plugin.Disabled`, and nullable `Spec.enabled` distinct. Retain disabled source metadata.
- Preserve 100 entries per directory, 1 MiB per JSON file, 16 MiB total JSON, and 1,000 distinct paths.
- Preserve 32 inherited edges per path, 128 ancestor levels, and 64 object levels in the complete inventory roadmap.
- Preserve guarded custody, races, strict acquisition, Deny, identity, generation, effect scope, and restored positive controls.
- Preserve the existing generic dependency scanner and recognizer protections. New dependency mechanics and their integration remain provisional Task 5.3 work.
- No new version allowlist, legacy AGY fallback, provider execution, or production qualification follows from this plan.
- F1-HOOK-EX remains deferred. Finder correction remains separately owned and supplies no readiness authority here.

## Review focus

| Input or condition | Required result | Named check |
| --- | --- | --- |
| Disabled invalid sixth event | Whole-source rejection before the disabled shortcut | `rejects an invalid SessionStart in a disabled native spec at acquisition` |
| Equal JavaScript numbers with different raw spelling | `1` valid, `1.0` and `1e0` invalid | `preserves native int32 lexical distinctions at acquisition` |
| Canonical source with unavailable activation | Conformance succeeds while production activity remains unavailable | `does not turn native parser validity into startup qualification` |
| Unknown form with authentic disposition | Adoption succeeds but direct reuse remains unverified | `cannot discharge native hook validation unknowns with a disposition` |
| Fixture migration hides broken native authentication | Separate nonempty authority control succeeds before each negative | `reuses a low-level authenticated AGY authority fixture` |

## Verdict and evidence boundary

**The whole bounded H1 increment is ready to specify and submit for plan review. Implementation remains gated on root acceptance.**

H1 implements a source-conformance check. It does not reproduce a live decoder invocation or qualify startup. The validator has useful positive and negative results. The actual producer consumes every result before effect collection. Specific unsupported forms also produce distinct refusals.

Fix round 1/5 defers the unconsumed production dependency module and its proposed `baseDir` API to Task 5.3. H1 owns the acquisition-boundary validator and producer/audit fixture migration. Standalone dependency tests cannot count as completed H1 production hardening. This correction changes task sequencing within the approved scope. It adds no activation or authority waiver.

The accepted decoder closes the former H0 canonical-decoding prerequisite. H0's old option-field discovery is superseded for this subset. The retained image-state, initialization, and lifetime conditions still limit claims about actual native behavior. They do not prevent an independent validator from implementing the explicitly reviewed compiled source contract.

No static report proves the absence of runtime writers. This plan makes no such claim. A later options mutation could change actual decoder behavior through the concrete pointer read by `jsonopts.(*Struct).Join`. That possibility limits live equivalence. It is not a new prerequisite for checking conformance to frozen reviewed rules. No concrete additional writer or input route was established here.

Ordinary typed runtime allocation, map, string, and error-interface semantics form the reasoning boundary. Arbitrary memory corruption is not an added gate. Known influential feature values, loader selection, command bases, dynamic hooks, and effective runtime inputs remain unavailable until qualified.

The checkout is `/Users/aaat/.codex/worktrees/council-issue3-inventory/the-council`. There is no `.codegraph/` directory. The supplied accepted code baseline is `af5da4093be1cbe19f6e7b29e65af9ba986c2245`, result `d834fac0`. Root supplied 173 affected tests plus build/typecheck success. The older default result remains 1611 passed and 14 failed. Those failures remain unresolved and are not all classified as pre-existing. This author ran no code tests or build.

### Frozen inputs

`R` means `.superpowers/sdd/2026-11-02-issue-3-resume`. The following document hashes were checked during authoring.

| Input | SHA-256 | Accepted status supplied by root |
| --- | --- | --- |
| Assignment | `53f344e9a70db57910519d05b5825405024add885f76ef816412647577c88fc6` | Current bounded assignment |
| H1 conditional plan | `700c64385009d8533b7be96a467833796309ee872325168d814738b15797f459` | `4d4da971`, correction pair PASS |
| `R/native-decoder-review-v2/claims.md` | `85c76d56ad079f493fb6d6d6b96c3d0635925d4be79ba7f787f8093887e261e6` | `0bf7a170`, conditional source accepted |
| Approved design | `60cf740bd15cfc1d294ff3150eccfc48e6928d33507b15cf3ad4a18981af78b1` | Governing approved design |
| Integration plan v2 | `76f12a8c49f561456aee70f550b4902495a747475d30070c9b639756ecce7213` | Governing task graph and roadmap |
| `R/session-settings-review-v4/claims.md` | `c342d0ae357afc3b1118be6e3ce9ece8daf595fb529244b541fa81dcd534532a` | `ba2d4786`, conditional settings contract |

### Whole-increment readiness matrix

| Dependency | Concrete evidence | H1 disposition | Remaining limit |
| --- | --- | --- | --- |
| Real acquisition consumes bytes | `provider-controls.ts:108` retains `{value,file}` through `readAgyJson`; hook loop currently loses that association | Ready: replace only AGY hook consumption with per-path guarded results | Fixed candidates do not prove loader membership |
| Whole-source validation | Decoder report and `primary/0x1015af8a0.asm`; invalid return skips source emission | Ready: validate all named specifications before returning occurrences | No partial salvage |
| Six native shapes and handler schema | Decoder report; `hook-named-types.json`; `0x1015aee20.asm` allocates the tagged temporary | Ready for the canonical subset below | No six-event authority expansion |
| Exact option consumption | Both decoder calls pass `0x109c76490` / `0x10ba78fe0`; `primary/0x10037b83c-0x10037b884.asm` reads flags | Ready as frozen source-conformance basis | Shared-object lifetime is not qualified |
| Initialized error callback | Accepted additive decoder correction binds initializer and nonnil error preservation | Ready for listed shape/range/lexical failures | No universal claim about arbitrary callback errors or runtime replacement |
| Known prompt models | Accepted initializer installs `inherit`, `flash_lite`, `flash`, `pro` | Ready for those spellings and ASCII trim/lowercase controls | Additional aliases and Unicode edge cases remain unknown |
| Raw numeric spelling | `src/workers/strict-json.ts` has 189 lines; Number conversion is lines 97–98 | Ready: index raw number tokens before semantic comparison | Decoded values alone cannot distinguish `1`, `1.0`, `1e0` |
| Guarded source metadata | `inventory-io.ts:230` returns bytes, SHA-256, receipt after custody/UTF-8/depth/strict checks | Ready: retain original file digest even for disabled or rejected sources | Duplicate and UTF-8 failures remain earlier acquisition refusals |
| Producer activity decision | Existing generic `hookEffects` at line 158 and `enabledHook` at line 321 are heuristics | Ready: no active emission or dependency read on unavailable activity | Effective loader/plugin/refresh/prompt conditions stay unresolved |
| New dependency mechanics and custody integration | Current scanner is inside `hookEffects`; governing Task 5.3 requires qualified activation and command bases | Deferred to Task 5.3 with explicit acceptance prerequisites below; no H1 module, API, or standalone implementation | Existing scanner/recognizer protections remain unchanged; actual bases, shell expansion, and indirect closure stay unavailable |
| Hook recognizer | `agy-hook-shell.ts:13,319,337` binds five events, whole descriptor set, exact keys/type/timeout and custody | Ready: preserve module and its tests | No normalization may manufacture its exact descriptor shape |
| Audit integration | `control-audit.ts:32,134`; reuse needs no pending effects and no unavailable entries | Ready: existing refusal behavior suffices, tests migrate | Reconstructing complete saved inventory stays Task 6.2 |
| Settings contract | Accepted v4 retains registry, current-permission, shared-map conditions | No H1 parser prerequisite | Cannot establish effective activation or permissions |
| Finder correction | No pending output consumed | No H1 conformance prerequisite | Required later for complete graph |
| Whole goal | Integration Tasks 5.3–8.1 | Provisional roadmap retained | H1 cannot close issue 3 |

## Canonical subset and private contract

The private result means conformance to the reviewed compiled source contract, with its documented conditions. `valid` never means loaded, active, complete, or authorized. Production code supplies no rule selection or qualification input.

Canonical sources are named maps of specifications. Four events contain handler lists: `SessionStart`, `PreInvocation`, `PostInvocation`, `Stop`. `PreToolUse` and `PostToolUse` contain matcher groups with `hooks`. List order survives. Named-map iteration establishes no new loader order.

Exact keys are supported. Unknown keys are ignored as the reviewed decoder specifies. `session_start` is an ignored unknown key, not an event alias. Influential ASCII case aliases remain specifically unavailable in this bounded implementation. The reviewed decoder supports folded matching, but this plan does not implement competing folded-key assignment order. An unsupported alias must never become an empty-payload native error. Exact-key canonical controls still succeed.

Root objects, empty named objects, and null named values have the reviewed interpretations. Root arrays and ordinary scalar roots reject. Ordinary scalar or array named values reject. Root `null` remains outside this subset because the accepted table does not settle its complete ParseHooks result.

Missing/null `enabled` remains `null` in metadata. Native `IsEnabled` defaults that pointer state to enabled, but loader activity remains separate. `false` never bypasses validation. Null event lists and group `hooks` mean no handlers. Null string fields leave empty temporary fields. Null timeout leaves zero. Null handlers reject through the empty default command.

Missing/empty handler `type` defaults to exact `command`. Only exact nonempty `command` and `prompt` are valid types. Payload length is literal string length, without trimming. Command rejects nonempty prompt/model. Prompt rejects nonempty command. Missing/empty prompt model defaults to `inherit`. Known ASCII model controls use trim/lowercase for validation without rewriting the source field. `PostToolUse` rejects prompts.

Unquoted decimal integer timeout tokens within `-2147483648…2147483647` are supported. Positive values remain unchanged. Nonpositive values default to 30 seconds. `1.0`, `1e0`, and the two adjacent out-of-range integers reject the whole source. This is native decoder rejection, with accepted error-preservation support.

Quoted numeric timeouts, Unicode edge cases, unknown model spellings, and competing folded field aliases produce specific unavailable results. They do not acquire guessed coercion or invalidity semantics. Duplicate decoded keys never reach a successful acquisition result. The earlier refusal remains `INVENTORY_JSON_INVALID:<path>`, with `edge:null`.

Other forms outside the stated typed subset also return decoder unavailable. These include unqualified field coercions and unqualified event/group shapes. An unsupported form never falls through to an empty valid specification. Raw integer range checks use the original decimal token, not its converted Number value.

Empty and `*` matchers are supported. ParseHooks does not compile matcher syntax. An invalid regex string therefore does not cause a parser rejection. Actual matcher applicability remains separate. No JavaScript `RegExp` substitutes for Go matching.

Known errors reject the entire source, including disabled specifications and valid siblings. Unsupported influential input also withholds every occurrence. A known error can dominate an unrelated unknown only when its proof does not depend on that unknown. The result must not contain partial occurrences in either refusal state.

### Proposed file ownership

All names in this section are proposals. Future implementation has one writer per file.

| File | Owner and responsibility |
| --- | --- |
| Create `src/pilot/agy-native-hook-validation.ts` | Implementer: pure conformance validation, raw token index, typed occurrences and problems |
| Create `test/pilot/agy-native-hook-validation.test.ts` | Same implementer: accepted command/prompt fixtures, lexical and atomic cases |
| Modify `src/pilot/provider-controls.ts` | Same implementer: consume guarded per-source validation before AGY effects/descriptors/activity |
| Modify `test/pilot/provider-controls.test.ts` | Same implementer: real boundary RED, fixture migration, zero dependency reads on unavailable activity |
| Modify `test/pilot/control-audit.test.ts` | Same implementer: meaningful audit RED, migrated producer fixtures, separate native authority controls |

Production `control-audit.ts`, `agy-hook-shell.ts`, `inventory-io.ts`, `strict-json.ts`, public schemas, and settings remain unchanged. A necessary production edit outside this list returns to root.

The proposed `src/pilot/agy-native-hook-dependencies.ts` is not an H1 file target. Task 5.3 owns any later dependency module and its production caller. Its private API remains undecided until activation and command-base inputs are qualified.

### Proposed private interfaces

```ts
type NativeHookEvent = "SessionStart" | "PreInvocation" | "PostInvocation"
  | "Stop" | "PreToolUse" | "PostToolUse";
type NativeHookProblem = {
  code: "AGY_NATIVE_HOOK_VALIDATION_FAILED" | "AGY_NATIVE_HOOK_DECODER_UNAVAILABLE"
    | "AGY_NATIVE_HOOK_MODEL_UNAVAILABLE";
  path: string; pointer: string; detail: string;
};
type NativeHookOccurrence = {
  specName: string; event: NativeHookEvent; matcher: string | null;
  specEnabled: boolean | null; descriptor: Readonly<Record<string, unknown>>;
  handlerType: "command" | "prompt"; timeoutSeconds: number;
};
type NativeHookValidation =
  | { state: "valid"; basis: "reviewed-compiled-source";
      occurrences: readonly NativeHookOccurrence[] }
  | { state: "invalid" | "unknown"; problems: readonly NativeHookProblem[] };
function validateAgyNativeHookSource(input: {
  path: string; file: Readonly<BoundedFile>;
}): NativeHookValidation;
```

`BoundedFile` is an existing type. The validator export is an internal import, with no public entry point or setter. The result's `basis` is produced internally. No caller supplies it. This plan defines no H1 dependency API.

The validator decodes the already guarded bytes with `decodeStrictJson`. A private structural token scan records original number tokens by decoded JSON pointer. It respects string escapes, arrays, and decoded member names. Only consumed timeout locations use the numeric policy. A regex search across arbitrary text is insufficient. Number/JSON.parse conversion cannot supply lexical evidence. This change leaves the shared strict decoder unchanged.

`descriptor` retains source fields. Defaults occupy separate semantic fields. No missing `type` or `timeout` is inserted into the descriptor. This preserves effect identities and prevents accidental exact-recognizer qualification. Problems retain the source path and escaped JSON pointer. Producer strings use `<code>:<path>:<pointer>`.

H1 preserves the existing generic scanner body and recognizer protections. It does not extract or replace dependency mechanics. Current acquired AGY handlers retain the applicable activation refusal and trigger zero dependency reads. The validator itself is consumed at actual acquisition. Later operational dependency integration requires Task 5.3's qualified activation and command bases.

## Task H1: Integrate whole-source conformance and migrate all affected fixtures

**Owner:** One root-assigned implementer after plan acceptance. Root retains independent acceptance.

**Dependencies:** Frozen inputs above, root's material reassessment, fresh Astra Ultra and Argon high plan reviews.

**Interfaces:** Consume the existing guarded readers and audit interfaces. Produce the private validator and the actual AGY acquisition consumer defined above.

### 1. Establish meaningful RED on unchanged production

- [ ] Add `rejects an invalid SessionStart in a disabled native spec at acquisition` without importing a missing proposed module.

  Use exact bytes `{"off":{"enabled":false,"SessionStart":[{"command":""}]}}`. Require `AGY_NATIVE_HOOK_VALIDATION_FAILED:<path>:/off/SessionStart/0`. Require no source effect or descriptor. Require unknown startup. Assert the pinned original source digest.

- [ ] Run the boundary RED command below before production edits.

  Expected: the new specific refusal assertion fails. Missing imports, setup failures, timeouts, and unrelated refusals are not meaningful RED.

- [ ] Add `reuses a low-level authenticated AGY authority fixture` using the exact authority fixture below.

  Require `verified === true` after authentic native completion and adoption. Change a guarded source. Require reuse false and drift adoption rejection. Restore its bytes. Require reuse true again.

- [ ] Add `cannot discharge native hook validation unknowns with a disposition` through actual production preparation.

  Use `{"canonical":{"SessionStart":[{"type":"prompt","prompt":"Review context","model":"future_model"}]}}`. Avoid the migrated helper's future unavailable assertion during RED setup. Require guarded source acquisition and authentic native Task completion. Approve every listed effect for the exact snapshot. Require adoption to succeed. Then require direct reuse false with `AGY_NATIVE_HOOK_MODEL_UNAVAILABLE` in the snapshot. Establish the separate authority positive in its own `contextFixture` first.

- [ ] Build unchanged production before the audit RED command.

  The audit suite imports `dist`. A failed build supplies no audit RED. The final rejection assertion must fail after successful authentication and adoption. If another condition prevents that assertion, return evidence to root before implementation.

### 2. Add parser and producer acceptance cases

- [ ] Add the exact accepted command and prompt fixture blocks from decoder report `85c76d56`.

  `validates all six canonical native event schemas` requires six command occurrences. Timeout values are `30,1,30,30,2147483647,30` in event order. `validates canonical known-model prompts` requires five prompts and one PostToolUse command. Models are `inherit`, `flash`, `pro`, `flash_lite`, and omitted/default `inherit`.

- [ ] Add `preserves native int32 lexical distinctions at acquisition` with raw fixture strings.

  Require `1` valid and both `1.0` and `1e0` invalid at the timeout pointer. Require both int32 endpoints valid. Require `2147483648` and `-2147483649` invalid. Require `0` and `-1` to yield 30 seconds. Include a string containing `1e0` and an unrelated unknown numeric field as unaffected controls. Re-serialization is forbidden in lexical fixtures.

- [ ] Add the atomic, metadata, and unsupported-input cases.

  Required names are `validates disabled specs before applying spec enablement`, `rejects the whole source when a sibling native spec is invalid`, `retains native payload whitespace and timeout defaults`, `rejects prompt handlers in PostToolUse`, `retains specific native decoder and model unknowns`, and `does not validate matcher syntax with JavaScript regex`. Each has the exact result specified in the canonical contract. Invalid and unknown results have no occurrences.

  Include empty/null named specs, null lists, missing/null/false enablement, null handler, wrong ordinary shapes, unknown ignored keys, added separators, influential folded aliases, quoted timeout, and Unicode unknown controls. Require exact canonical counterparts to return valid. Disabled-byte changes must alter the retained source digest.

- [ ] Add `does not turn native parser validity into startup qualification` through `inspectProviderControls`.

  Require actual validator success on the canonical source. Require `AGY_PLUGIN_RUNTIME_INPUT_UNAVAILABLE:<path>` for unresolved activity. Require zero active source effects, descriptors, policy acquisition, and script payload reads. Retain the source digest. Require startup unknown even after exact effect disposition.

- [ ] Add duplicate and sibling integration checks.

  `refuses duplicate native hook keys before validation` requires `INVENTORY_JSON_INVALID:<path>`, no successful validator call, and no fallback. `does not retain a valid sibling after native whole-source rejection` requires zero source contributions and dependency reads. `retains disabled native hook bytes without active dependency reads` requires changed digest/audit identity after disabled-byte drift.

### 3. Implement and consume the private boundary

- [ ] Implement the proposed validator from the canonical contract.

  Validation precedes every enablement shortcut. Each complete source returns exactly one result. Unsupported influential forms withhold the entire source. No production runtime state is inferred from the compiled contract.

- [ ] Replace AGY hook-source parsing in `inspectProviderControls`.

  Retain each path, successful `readAgyJson` result, digest, and receipt association. Preserve existing `ordering` acquisition observations without claiming effective loader order. Validate once per successful acquired source. Preserve absence and guarded-read failures. No AGY path falls back to `hookEffects` or `enabledHook`. Preserve the generic scanner body and its other callers. Preserve the existing recognizer module and its custody/whole-set tests.

  Invalid/unknown results append their specific problem strings. They contribute no effects or descriptors and force startup unknown. Valid results retain source metadata and semantic occurrences. Current unbound activity uses `AGY_PLUGIN_RUNTIME_INPUT_UNAVAILABLE:<path>`. A failed validation must not be hidden by a later disposition-pending detail. Acquisition and native problems remain in `audit.unavailable`.

  No acquired source, including `{}` or disabled-only metadata, establishes complete loader membership. Preserve non-hook fixture checks without adding refusals solely for a nonexistent source. Full startup qualification still requires the later qualified graph. Parser-valid handlers remain inert under unavailable activation.

  A later qualified active path must supply loader membership, plugin state, spec state, applicable runtime state, and a source-bound command base. That path is provisional Task 5.3 work, not an invented H1 setter. It must submit the complete active Orca-referencing descriptor set to the unchanged recognizer. An extra unsupported active descriptor refuses the set. Disabled metadata supplies no active descriptor.

### 4. Complete every fixture migration before GREEN

Producer/audit fixture migration remains H1 work. The dependency mechanics cases move to Task 5.3 as required by the ruling. A specific activation refusal does not prove that a dependency scanner rejected dynamic closure.

| Existing producer case | Migration |
| --- | --- |
| `keeps ordinary non-Orca hooks in the generic pending effect audit` | Canonical named-map command fixture. Rename for unresolved activation. Require specific runtime refusal, source digest, zero effects, no policy, unknown controls. |
| `retains the generic dynamic guard for an unrelated custom shell script` | Rename for unresolved native activation. Retain the fixture bytes/source digest. Require zero script reads and activation refusal. Task 5.3 retains the operational dynamic marker/digest negative and restored positive. |
| `retains dynamic closure for unsupported %s custom hook descriptors` | Rename for unresolved native activation. Preserve raw and quoted forms. Production stays unavailable. Task 5.3 retains both dynamic negatives and restored safe positives. |
| `keeps AGY 1.4.12 enabled hooks pending a source audit despite absent enrollment` | Correct fixture to explicit prompt type in a named spec. Require runtime refusal and zero active effects. Preserve settings bytes and inherited Deny checks. Pending disposition alone is insufficient. |

`preparedAgyAudit` keeps actual producer preparation. It uses the canonical command source and retains guarded settings/hook assertions. Its new expectation is zero active source effects plus the specific activation refusal. `completedAgyAudit` still authenticates and adopts that incomplete snapshot. Its direct reuse remains false. Adoption retains `providerQualification: "separate-required"`.

Two new test-local helpers are `preparedAgyAuthorityAudit(h)` and `completedAgyAuthorityAudit(h)`. They use `saveAuditSnapshot` directly. They do not copy a production snapshot or delete its unknowns.

| Low-level authority fixture field | Exact value |
| --- | --- |
| Settings path/bytes | `join(h.root,"authority-inputs/settings.json")`, `{"fixture":"settings"}` |
| Hook-named path/bytes | `join(h.root,"authority-inputs/hooks.json")`, `{"fixture":"hook-source"}` |
| Version/workspace/route | `1`, `h.workspace`, `"antigravity"` |
| Provider version/contract | Both `"fixture-native-authority-only"` |
| Executable/recipe hash | `"/fixture/agy"`, `"fixture-native-authority-recipe"` |
| Sources/ordering | Both actual file SHA-256 values, kind `file`, settings then hook-named file |
| Effects/unavailable | `["fixture-native-authority-effect"]`, `[]` |
| Helper return | Existing saved result plus `settings`, `hook`, `guarded`; completed helper adds `run`, `task`, `adopted` |

The hook-named file is opaque audit data. It is not asserted to be a native hook schema. These nonempty files and effect prove low-level authentication only.

`approveAgySnapshot` remains unchanged. It creates the Run, hash-bound root Task, and Dispatch to `fixture-coordinator`. It completes through actual fixture `worker_done` with the exact effect set. No test mocks `nativeDisposition`, source validation, or `verified`.

| Existing audit case | Required migration and controls |
| --- | --- |
| `bounds AGY JSON revalidation with an existing authenticated disposition` | Use authority helpers for initial/restored reuse true, bounded reads, native readback, repeated adoption, and tamper negative. Move producer assertions to the next companion. |
| New `bounds incomplete native hook inspection with an existing authenticated disposition` | Real producer helper. Equal audit hash, matching disposition read, guarded bounds, native readback, activation refusal, unknown startup. |
| `rejects guarded AGY JSON drift during matching-disposition inspection` | Keep producer helper and armed post-disposition mutation. Preserve acquisition hash, at least two guarded settings opens, drift rejection, restored adoption. Restored startup/reuse remain unknown. |
| New `rejects low-level authenticated AGY JSON drift after successful reuse` | Authority helper. Reuse true, mutation false, drift adoption rejection, restoration true. |
| `rejects %s guarded AGY JSON without writing a disposition or falling back` | Authority helper for overflow, malformed, component-link, leaf-link, unreadable, unstable. Preserve exact code/path/edge, no disposition after failure, initial/restored reuse true, and bounds. |
| `preserves %s AGY audit source semantics` | Authority helper for implicit, explicit, metadata, absent, missing-file, file-and-metadata. Preserve initial success, byte/mode/absence negatives, `(path,kind)` identity, and existing restorations. |
| `prepares actual versioned hook sources, adopts only matching native owner disposition, and invalidates drift` | Real producer. Zero effects and specific activation refusal replace old active assumptions. Preserve policy/hook digests and native owner/workspace/incarnation/provenance negatives. Valid adoption succeeds. Startup remains unknown. Restore provenance and require adoption success. Retain hook/policy drift rejection. |

Keep `completedAudit` Codex fixtures and all generation, owner, workspace, incarnation, effect-scope, and restored-authentication checks unchanged. Keep existing inventory bounds, races, source-kind, recipe bytes, help, and unsupported-version checks. No generic unknown assertion replaces their exact controls.

### 5. Verify, freeze, and return to root

- [ ] Run the GREEN commands after all fixture migrations.

  Require canonical parser positives and distinct known-invalid/unknown results. Require real producer consumption and no fallback. Require all independent authority controls. Deferred dependency mechanics do not enter H1 GREEN.

- [ ] Run bare `npm test` after the final current build and scoped checks.

  Record every failing suite/test name and its diagnostic. Record environment/setup failures separately. Name failures even when evidence proves they predate H1. Keep unclassified failures unclassified. Scoped passes cannot replace or disguise this full-suite result. Root must dispose every failure before H1 acceptance. Unresolved failures block a passing H1 acceptance claim.

- [ ] Record changed paths and prior hashes for rollback.

  Rollback covers only the five proposed implementation/test paths. Restore modified tracked bytes only after root's disposition. Preserve unrelated work and all historical evidence. This authoring assignment executes no rollback or Git write.

- [ ] Submit frozen implementation bytes and command receipts to root.

  Root retains fresh independent change review and acceptance. Plan review is not implementation acceptance. No checkbox here claims canonical graph completion.

### Future commands

All commands use the checkout cwd. None ran during authoring. Root retains command supervision and settlement.

| Phase | Command | Expected result |
| --- | --- | --- |
| Boundary RED, before production edits | `npm test -- test/pilot/provider-controls.test.ts -t 'rejects an invalid SessionStart in a disabled native spec at acquisition'` | Specific refusal assertion fails, setup succeeds; 120 seconds |
| Unchanged build before audit RED | `npm run build` | Exit 0; 120 seconds |
| Authority positive before audit RED | `npm test -- test/pilot/control-audit.test.ts -t 'reuses a low-level authenticated AGY authority fixture'` | Authenticated reuse and restored control succeed; 120 seconds |
| Audit RED | `npm test -- test/pilot/control-audit.test.ts -t 'cannot discharge native hook validation unknowns with a disposition'` | Production final rejection fails after successful setup/adoption; 120 seconds |
| Unit RED | `npm test -- test/pilot/agy-native-hook-validation.test.ts` | Missing implementation may fail setup here only; 90 seconds |
| Parser/producer GREEN | `npm test -- test/pilot/agy-native-hook-validation.test.ts test/pilot/provider-controls.test.ts` | All pass; 120 seconds |
| Current build | `npm run build` | Exit 0 before dist-consuming audit tests; 120 seconds |
| Audit/authority GREEN | `npm test -- test/pilot/control-audit.test.ts test/pilot/agy-hook-shell.test.ts` | All pass with custody and authority mutations effective; 120 seconds |
| Typecheck | `npm run typecheck` | Exit 0; 120 seconds |
| Full H1 suite, after current build | `npm test` | Exit 0 for a passing full-suite result. Otherwise name every failure and obtain root disposition before H1 acceptance. Root sets the supervised bound from the complete suite's recorded duration. |

Root records actual cwd, source hashes, relevant dist hashes, command, output, exit, and settled process state. A timeout is not RED or a passing full-suite result. Source-only plan checks are not new code-test results. The prior 1611/14 result remains unresolved history. Bare `npm test` is required for H1 and does not complete Task 8.1's remaining campaign.

## Full roadmap and material reassessment

This proposal updates Task 5.3's H1 specification. Root must synchronize accepted document references and pending definitions before dispatch. Existing accepted history remains unchanged. This worker changes no service state or graph.

| Outcome | Retained prerequisite and expansion condition |
| --- | --- |
| Task 5.1, source qualification | Preserve accepted conditional reports. Qualify actual normal callers and influential inputs. Finder correction remains separate. |
| Task 5.2, bounded acquisition | Accepted code/result remain intact. H1 consumes its raw guarded results. |
| Task 5.3, complete graph | H1 adds useful conformance only. The deferred dependency module/API, operational caller, and acceptance prerequisites below remain here. Full declarations, membership, ordering, inherited agents, components, enablement, runtime values, bases, and transitive closure remain provisional. |
| Task 6.1, clean-store preparation | Requires complete acquisition and qualified bookkeeping exclusion before the first write. Each later write retains a drift check. |
| Task 6.2, adoption/direct reuse | Requires complete live reconstruction, exact recipe identity, witness validation, and source-kind semantics. Preserve `rejects saved AGY reuse after an ignored root entry changes type`. |
| Task 7.1, retained launch | Requires exact physical materializations, current sources, actual assignment PATH/profile membership, and the current assignment's hook instance. |
| Task 8.1, whole branch and goal | Requires campaign checks, unresolved failure dispositions, fresh independent review, and operational acceptance. H1 cannot close this outcome. |

The maintained same-name regression must first prepare/adopt/reuse unchanged successfully. It changes only regular `slot` into a directory with inert `hooks.json`. It restores root time. It proves equal old metadata digest, names, and source digests but changed entry type. Its final assertion remains `verified === false`. Earlier failure is insufficient. Original reproduction files and RED receipts remain unchanged.

AC1 retains the real-acquisition reproduction and maintained regression. AC2 retains complete version-bound membership/order. AC3 retains disabled metadata and accurate activation. AC4 retains specific unavailable results and finite bounds. AC5 retains preparation/adoption/reuse/launch drift plus unchanged reuse success. AC6 retains five-event custody, unrelated-hook coverage, offline verification, and independent acceptance.

### Task 5.3 deferred dependency prerequisites

**Owner:** Task 5.3 implementer after root qualifies activation and command-base inputs. Root owns API approval, independent review, and acceptance.

**Status:** Provisional. No module, `baseDir` signature, standalone mechanics implementation, or direct helper tests belong to H1. The proposed module path above remains a later option. Its interface must follow the qualified production caller, rather than define an unused standalone API.

**Expansion condition:** Qualified graph selection supplies the actual active occurrence set and each source-bound command base. The accepted Task 5.3 plan must specify a real consumer and its private interface before implementation. Standalone mechanics alone cannot satisfy this condition.

The following acceptance cases remain required prerequisites to accepting Task 5.3's dependency integration:

| Case | Required evidence after Task 5.3 becomes ready |
| --- | --- |
| Production consumption | The real AGY acquisition path uses qualified activation and command bases. Unknown activity/base emits a specific refusal and performs no speculative dependency payload read. No public setter or fixture supplies qualification. |
| Safe and restored dependency positives | Inert fixture-owned interpreter/script files yield pinned digests through bounded reads. A dynamic-marker mutation yields `HOOK_DYNAMIC_CLOSURE_UNAVAILABLE:<path>:<digest>`. Restored safe bytes pass again. Cover unrelated scripts and raw/quoted absolute candidate forms. Direct controls supplement the real caller. |
| Link and size custody | Component-link and leaf-link controls reject with `AGY_PLUGIN_HOOK_DEPENDENCY_SYMLINK`. A 262143-byte safe script passes. Size `>=262144` rejects before unbounded payload reads with `AGY_PLUGIN_HOOK_DEPENDENCY_TOO_LARGE`. Each negative has an initial and restored regular-file positive. |
| Bounds and unstable reads | Shared path/read budgets remain effective before hashing. Unreadable or unstable custody refuses with its specific diagnostic. Restoration returns to the successful control. |
| Unbound command influence | `AGY_PLUGIN_HOOK_DEPENDENCY_UNBOUND` covers unqualified command/base influence. Relative/tilde/dynamic expansion, computed shell syntax, unproved transitive closure, and credential/endpoint dependencies remain unavailable without source qualification. Sensitive inputs are not read speculatively. Add no general shell parser. |
| Existing protections | Keep the generic scanner's dynamic/unresolved/sensitive guards and recognizer's whole active descriptor set, raw descriptor shape, five-event scope, and custody checks. Only successful known-policy acquisition can discharge its exact existing closure reason. |

These prerequisites retain the earlier dependency/custody requirements. Their placement supplies no claim of completed operational hardening in H1. Root must expand the Task 5.3 tests and commands when the actual caller and API are known.

## Author self-review and dispositions

| Check or concern | Disposition |
| --- | --- |
| Whole H1 readiness | Assessed across parser, producer, audit, fixture migration, and preserved recognizer protections. The bounded conformance change is specified. Dependency mechanics/integration and live activation remain provisional Task 5.3 work. |
| Decoder conditions | Retained for actual native equivalence. Source-conformance implementation does not falsely discharge image state, initialization, or lifetime. No speculative writer-closure gate was added. |
| Useful integration | Actual acquisition consumes valid/invalid/unknown results. Canonical positives reject a fixed-unknown validator. Meaningful production RED rejects a test-only adapter. |
| Numeric evidence correction | Uses 189-line `src/workers/strict-json.ts`, Number at 97–98. No invented line 276 or `Number.isInteger` source claim. Raw fixtures preserve lexical spelling. |
| Interface consistency | Existing public signatures stay unchanged. The proposed private validator uses existing `BoundedFile`. `basis` is output only. The unconsumed dependency signature is removed. Task 5.3 must establish its API from the actual caller. |
| Exact descriptor preservation | Semantic defaults stay separate. The recognizer's exact `{command,timeout,type}` requirement is not manufactured. Five events remain unchanged. |
| Fixture-plan/H1-EXIST-TESTS | Every producer/audit migration remains explicit. The ruling moves dependency mechanics cases to Task 5.3 prerequisites. Separate nonempty native authority positives prevent vacuous authentication coverage. |
| Guarded refusal | Duplicates/UTF-8 fail acquisition first. Invalid sources retain digests after successful guarded reads. No diagnostic pretends an earlier failure reached the validator. |
| Review focus | Each of five focus rows maps to named H1 assertions. Restored authority positives and canonical parser controls remain mandatory. Restored dependency positives remain Task 5.3 prerequisites. |
| Spec coverage | All six acceptance criteria and Tasks 5.1–8.1 remain mapped. No graph, clean-store, reuse, retained-launch, or whole-goal outcome was removed. |
| Step scan and proportion | Steps specify interfaces, assertions, ownership, and commands. No production function body or guessed runtime implementation is supplied. |
| Author verification | Read-only inspection and static document checks only. Two authorized document edits. No code tests, build, provider, hooks, network, Git writes, helpers, private configuration/session reads, or temporary files. |
| Full-suite requirement | Final H1 checks include bare `npm test`. Every failure requires a named diagnostic and root disposition, including failures proved to predate H1. Scoped passes do not replace this result. |

### Fix round 1/5 disposition

`H1-UNUSED-DEP`, important, is addressed in this revision. The author checked the finding against the current scanner and governing Task 5.3. Root's ruling requires deferral because H1 has no qualified activation/base caller.

The correction removes the new dependency module from H1 ownership, its `baseDir` API, implementation steps, and standalone test obligations. Task 5.3 retains explicit production-consumption, safe/restored, dynamic, custody, size, and unavailable-input prerequisites. H1 preserves the generic scanner and recognizer protections. It retains real acquisition consumption, all canonical/unknown/lexical boundaries, raw descriptor authority, and authentic approval positives/RED.

The pre-fix plan hash is `51763cc9c4461497a9e5494d37c19874366c30b89b92e111e21836a086e1493c`. The pre-fix note hash is `1067f959520561e9da1ddaf356f3ecc630544f6b03f84e92b6862272498c150e`. Original assignment, author report, fresh review, and ruling remain unchanged. This disposition is an author correction, not independent acceptance.

**One next step:** Root verifies these two frozen document hashes and obtains fresh Astra Ultra and Argon high review against identical bytes. Root then disposes findings and synchronizes the material H1 reassessment before implementation.
