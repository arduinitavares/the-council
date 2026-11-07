# Issue 3 native hook validation increment implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate each acquired native hook source before that source can contribute effects or descriptors.

**Architecture:** Add a private whole-source validator at the current AGY acquisition boundary. Keep parser validity separate from loader membership and activation. Preserve specific unknowns through the existing audit refusal path.

**Tech Stack:** TypeScript, Node.js, Vitest, existing guarded inventory reads.

**Spec:** `.superpowers/sdd/2026-11-01-issue-3-loader-witness/research/input/approved-design.md`; refined Task 5.3 in `docs/superpowers/plans/2026-11-02-issue-3-production-inventory-integration-v2.md`.

## Global constraints

- This assignment permits plan authoring only. Only this document and its adjacent language note are new write targets.
- All existing files remain read-only. This assignment executes no implementation, tests, build, Git writes, network, provider, hook, or plugin.
- The assigned process is Sol Max. It uses `workspace-write/never`. It launches no helper, worker, terminal, wrapper, or alternative route.
- The approved complete-task execution method remains in force for later work. Root owns supervision, review, integration, and acceptance.
- No new public authority, audit schema, version allowlist, contract setter, completeness setter, or caller qualification input is permitted.
- Preserve all six native validation events. Preserve the existing five-event Orca authority.
- Preserve disabled metadata. Keep loader disablement, `Plugin.Disabled`, and nullable `Spec.enabled` separate.
- Unknown loader behavior remains unavailable. A parser result cannot establish complete startup inventory.
- Preserve guarded read limits and native authority checks. Preserve all remaining Task 5.3–8.1 outcomes.
- F1-HOOK-EX remains a deferred minor. This proposal does not authorize that work.

## Review focus

| Input or condition | Required behavior | Proposed test owner |
| --- | --- | --- |
| Invalid `SessionStart` inside `enabled:false` | Reject the whole source before descriptor collection. | H1: `rejects an invalid SessionStart in a disabled native spec at acquisition` |
| One invalid named specification beside a valid one | Emit no effects or descriptors from that source. | H1: `does not retain a valid sibling after native whole-source rejection` |
| Parser-valid source with unknown loader or plugin state | Preserve a specific unavailable reason. Perform no active dependency scan. | H1: `does not turn native parser validity into startup qualification` |
| Case variants or unknown model spelling | Keep decoder uncertainty distinct from known validation failure. Duplicate JSON keys fail earlier during guarded acquisition. | H1: `retains specific native decoder and model unknowns`; `refuses duplicate native hook keys before validation` |
| A matching authenticated disposition | Keep parser unknowns unverified despite approval of every listed effect. | H1: `cannot discharge native hook validation unknowns with a disposition` |

## Evidence and current assessment

**Whole proposed increment: provisional, not ready for implementation.** H0 is a separate read-only qualification check. H1 cannot advance from a successful first test alone.

The native rules support the intended validation boundary. They do not establish every decoder choice needed by the whole proposed increment. This document does not declare a production parser ready.

The inspected checkout is `/Users/aaat/.codex/worktrees/council-issue3-inventory/the-council`. Its HEAD is `af5da4093be1cbe19f6e7b29e65af9ba986c2245`. There is no `.codegraph/` directory. Existing untracked evidence and plan files remain unchanged.

Task 5.2 is accepted with 173 affected tests, as supplied by root. The prior default suite result is 1611 passed and 14 failed. The failures remain unresolved. This author did not rerun or classify them as pre-existing.

### Frozen inputs

All paths in the next table are relative to the checkout. `R` denotes `.superpowers/sdd/2026-11-02-issue-3-resume`.

| Input | SHA-256 | Meaning |
| --- | --- | --- |
| Approved design | `60cf740bd15cfc1d294ff3150eccfc48e6928d33507b15cf3ad4a18981af78b1` | Governing approved design. |
| Integration plan v2 | `76f12a8c49f561456aee70f550b4902495a747475d30070c9b639756ecce7213` | Existing task ownership and roadmap. |
| `R/native-contract-review-v2/claims.md` | `1972ed9cc029a33511f2969d96f0569a3c1fa0a7e78d7b122446bfbd20cf737e` | Accepted conditional contract and byte addendum. |
| `R/selector-rules-review-v3/claims.md` | `446fa89e5a408457d9fbe33074ecaae4be29bf68dabf32a986e0a7225186c308` | Corrected selector rules, including separate exclusion collectors. |
| `R/generated-path-review-v1/claims.md` | `3656831676de8fa77e2a59ed5ca3818686e08c5cc944c53f16b5e3b09660672d` | Conditional generated-path consumption and PATH participation. |
| `R/effective-options-review-v3/claims.md` | `3a5d9d07a62fb7b644b7e334b056702858635bb7a48cabf830668e68dd72a746` | Accepted conditional source, result `9b95b903`. Hook object, key, and candidate checker behavior are bound. |

These hashes were checked during authoring. The source reports remain conditional evidence. They supply no runtime admission credential.

`R/native-contract-review-v2/coordinator-dispositions.md` records independent acceptance of the conditional native contract. The older pending-review wording inside the integration plan is historical. Acceptance does not remove the contract's explicit unknowns.

Options-v3 is accepted conditional evidence. It binds the concrete hook `singleFileCustomization`, refresh key `6`, and `enable-customization-kind-hooks`. Normal checker installation and effective runtime values remain unbound. Conditional acceptance supplies no live admission.

Root also supplied `R/native-decoder-option-primary.json` as a locator. Its metadata identifies a `jsonopts.Options` itab to `*jsonopts.Struct`, a 112-byte object, and destination `map[string]jsonhook.JSONHookSpec`. This identifies the object and destination. It does not establish decoder semantics or complete H0. This correction performs no new decoder source investigation.

### Existing code and interfaces

| Existing surface | Observed behavior and relevance |
| --- | --- |
| `src/pilot/provider-controls.ts:64` | `inspectProviderControls: ProviderControlSource` owns acquisition. Its `readAgyJson` retains bounded bytes and digests. |
| `src/pilot/provider-controls.ts:158` | `hookEffects` skips any object with `enabled === false` before recursive traversal. It can therefore miss invalid disabled content. |
| `src/pilot/provider-controls.ts:304` | The AGY branch reads hook candidates, then sends decoded objects to the generic recursive walk. There is no native whole-source validation step. |
| `src/pilot/provider-controls.ts:321` | `enabledHook` is a recursive heuristic. It is not the native six-event parser. |
| `src/pilot/inventory-io.ts:22` | `InventoryRead<T>` distinguishes `present`, `absent`, and `unknown`. `BoundedFile` retains `bytes: Uint8Array` and `sha256: string`. |
| `src/pilot/inventory-io.ts:230` | `readInventoryJson(path, budget, binding?)` supplies `{ value, file }`. UTF-8, depth, custody, and strict JSON checks precede success. |
| `src/pilot/control-audit.ts:32` | Private `validateAuditSources` checks guarded live AGY JSON bytes before digest comparison. It does not reconstruct native hook selection. |
| `src/pilot/control-audit.ts:134` | `acquiredAuditDisposition(snapshot, command?)` requires no pending effects and an empty `snapshot.unavailable` for verification. |
| `src/pilot/agy-hook-shell.ts:13` | Existing authority covers `PreInvocation`, `PostInvocation`, `Stop`, `PreToolUse`, and `PostToolUse`. |
| `src/pilot/agy-hook-shell.ts:319` | `agyHookShellApplicable(descriptors, workspace)` recognizes possible Orca references. |
| `src/pilot/agy-hook-shell.ts:337` | `acquireAgyHookShellPolicy({workspace, executable, version, descriptors, basePath})` checks the whole referencing descriptor set. |

Existing test fixtures include `withAgyControls` in `test/pilot/provider-controls.test.ts`. Audit fixtures include `contextFixture`, `preparedAgyAudit`, `completedAgyAudit`, and `approveAgySnapshot`. These names exist. All new interfaces and test names below are proposals.

### Accepted native rules

Primary paths below resolve under `R/native-contract-review-v2/`.

| Rule | Primary support | Limit retained |
| --- | --- | --- |
| Native input contains named specifications. | `P/0x1015af8a0.asm`; `P/hook-named-types.json`. | Decoder options and general normalization are not qualified by field names alone. |
| `SessionStart`, `PreInvocation`, `PostInvocation`, `Stop` use handler lists. | `P/hook-named-types.json`, `JSONHookSpec` offsets 8, 32, 56, 80. | These are validation events, not six authorized Orca events. |
| `PreToolUse`, `PostToolUse` use matcher groups containing `hooks`. | Same type, offsets 104 and 128; `ToolHookGroup`. | Matcher runtime behavior remains separate. |
| Validation includes `enabled:false` specifications. Errors reject the source. | `P/0x1015af8a0.asm`, `P/0x1015b08a0.asm`; source rejection at `0x1015b0d84`, caller skip at `0x1015d4e48`. | No valid-sibling salvage is permitted. |
| Missing or empty handler type defaults to `command`. Exact nonempty types are `command` and `prompt`. | `P/0x1015aee20.asm`, `P/0x1015b0df0.asm`. | Preserve length-based payload tests. Do not trim command or prompt text. |
| The selected type requires its nonempty payload. Incompatible nonempty fields reject it. | Same handler decoder and validator slices. | Do not invent acceptance for unqualified fields or coercions. |
| Prompt model defaults to `inherit`. Model parsing trims and lowercases. | `P/0x1015a0010.asm`; accepted literal/call bindings in `X/`. | `inherit`, `flash`, `pro`, `flash_lite` are bound. Additional aliases remain unknown. No model-launch authority follows. |
| `PostToolUse` rejects prompt handlers. | `P/0x1015b0df0.asm`, `0x1015b109c–0x1015b116c`. | Other prompt execution needs the unknown generative-hook runtime value. |
| Timeout uses `int32`. Nonpositive values become 30 seconds. | `P/hook-named-types.json`; `0x1015b0e68–0x1015b0e88`. | JSON numeric decoding must be source-qualified. Do not add JavaScript coercion. |
| Empty or `*` matcher succeeds. Other matchers use `^(?:MATCHER)$`. | `P/0x1015b12e0.asm`; accepted call/literal bindings. | ParseHooks does not validate regex syntax. JavaScript regex behavior is not a substitute for Go matching. |
| Loader hook suppression uses `DisabledCustomizations[6]`, at manager offset `0x70`. | `P/0x1015e0740.asm`, `0x1015e12f0–0x1015e1318`; accepted options-v3 hook-object and `gateKinds` evidence. | The concrete object and refresh key are proved. Normal checker installation and the effective lookup remain unbound. |
| Hook base comes from converted `Plugin.Path`. Failed conversion skips emission. | Accepted forwarding and `LocalPath` bindings. | A handler base is not automatically packet cwd or the source file's parent. |

The accepted addendum binds the `.` fallback and `/` trim byte. It does not settle shell expansion or indirect dependencies. `CommandContext("sh", ["-c", command])` consumes PATH. Generated-path evidence prevents an assumption that assignment PATH changes are irrelevant.

### Smallest proposed deliverable

H1 would validate one complete acquired source before any effect collection from that source. It would cover every named specification and all six event shapes. A known error anywhere would reject the source atomically.

This is useful only when the real producer consumes the result. A private validator with no acquisition caller fails acceptance. A result fixed to unknown for every input also fails acceptance.

The deliverable includes parser-valid positive controls and known-invalid negative controls. Unsupported decoder forms remain specific unknowns. A native validation success never clears graph, loader, runtime, component, finder, normalization, or dependency unknowns.

H1 does not implement graph discovery or claim that today's fixed scans cover startup. Current hook candidates are acquisition observations. Their presence does not prove loader membership.

## Task H0: Qualify the remaining whole-source decoder decisions — ready discovery

**Owner:** Root-assigned read-only source investigator. Root owns acceptance. This planner performs no dispatch.

**Dependencies:** Accepted native contract and its matching primary packet.

**Files:** Read the primary packet, the guarded reader, and the current producer. This task creates no product code or tests.

**Interfaces:** Consume the accepted source claims. Produce a source-qualified decision table for root's existing review record. The table is evidence, not a caller-supplied production contract.

- [ ] Identify the decoder option passed by ParseHooks at `0x1015af908–0x1015af93c`.

  `X/direct-call-bindings.json:620` binds call `0x1015af944` to `encoding/json/v2.Unmarshal`. The caller constructs one option interface using type address `0x109c76490` and data address `0x10ba78fe0`. Root's locator supplies its metadata identity. Qualify its semantic fields and decoder consequences from retained primary evidence. If that evidence is insufficient, return the exact missing-source request to root. This task authorizes no binary extraction.

- [ ] Trace the option and custom handler decoder through the accepted input shapes.

  The table must cover exact keys, unknown keys, case variants, nulls, integer range, and named-map values. Preserve absent/null `Spec.enabled` separately from false. Inspect the existing `HookHandler.UnmarshalJSON` primary in `P/0x1015aee20.asm`. Its call at `0x1015aee94` has a separate decoder binding in `X/direct-call-bindings.json:353–365`.

  Record native duplicate-key behavior separately when the retained source qualifies it. At the real producer, `readInventoryJson` already rejects duplicate keys through `decodeStrictJson`. That path returns `INVENTORY_JSON_INVALID` with `edge:null`, before a successful `readAgyJson` result exists. It cannot promise a validator pointer diagnostic. Preserve the acquisition refusal without fallthrough. Do not infer JSON v1 behavior for `encoding/json/v2`.

- [ ] Bind the canonical named-map test envelope to its decoder destination.

  Expected: the root locator's map destination agrees with the retained caller and type metadata. Each proposed canonical test has one demonstrated native interpretation. An existing fixture's spelling is not evidence of native compatibility.

- [ ] Submit the decision table to root for independent review.

  Expected: each required rule has a primary interval, exact predicate, disposition, and retained unknown. Root then reassesses H1 as a whole.

**Exact first read-only checks, from the checkout:**

```sh
sed -n '27,50p' .superpowers/sdd/2026-11-02-issue-3-resume/native-contract-review-v2/P/0x1015af8a0.asm
sed -n '617,625p' .superpowers/sdd/2026-11-02-issue-3-resume/native-contract-review-v2/X/direct-call-bindings.json
sed -n '1,48p' .superpowers/sdd/2026-11-02-issue-3-resume/native-contract-review-v2/P/0x1015aee20.asm
sed -n '353,365p' .superpowers/sdd/2026-11-02-issue-3-resume/native-contract-review-v2/X/direct-call-bindings.json
```

Expected: destination allocation, option construction, and both decoder bindings are visible. These commands do not prove decoder semantics. Completion requires the source-qualified decision table.

**Acceptance:** H0 can finish with a precise missing-source result. It cannot promote H1 without the required decoder decisions.

## Task H1: Consume whole-source validation at acquisition — provisional implementation

**Owner:** One implementer after root accepts H0 and this frozen plan. Fresh independent acceptance remains root's responsibility.

**Dependencies:** H0, accepted Task 5.2 code, qualified private rule binding, and root's material reassessment. All test names below are proposed.

### Proposed file ownership

| File | Action and sole responsibility |
| --- | --- |
| `src/pilot/agy-native-hook-validation.ts` | Create. Own pure native source validation and typed results. Perform no filesystem reads or execution. |
| `src/pilot/agy-native-hook-dependencies.ts` | Create. Own the private command-dependency checks already required by H1. Return observations and refusals, never activation or authority. |
| `test/pilot/agy-native-hook-validation.test.ts` | Create. Own source-derived parser cases and atomic rejection checks. |
| `src/pilot/provider-controls.ts` | Modify the AGY hook-source loop and startup decision. Consume validation before effects, descriptors, or dependency reads. Preserve other routes. |
| `test/pilot/provider-controls.test.ts` | Modify. Prove integration through real `inspectProviderControls`, guarded bytes, and inert fixtures. |
| `test/pilot/control-audit.test.ts` | Modify tests only. Prove native unknowns remain unverified with authentic fixture authority. |

`src/pilot/agy-hook-shell.ts`, `src/pilot/control-audit.ts`, public schemas, settings, and instructions are not proposed production edit targets. A required production change outside this table returns to root.

### Proposed private interfaces

These names do not exist today. They define the intended internal boundary. H0 must qualify the decoder rules before implementation.

```ts
type NativeHookEvent = "SessionStart" | "PreInvocation" | "PostInvocation"
  | "Stop" | "PreToolUse" | "PostToolUse";
type NativeHookProblem = {
  code: string; path: string; pointer: string; detail: string;
};
type NativeHookOccurrence = {
  specName: string; event: NativeHookEvent; matcher: string | null;
  specEnabled: boolean | null;
  descriptor: Readonly<Record<string, unknown>>;
};
type NativeHookValidation =
  | { state: "valid"; occurrences: readonly NativeHookOccurrence[] }
  | { state: "invalid"; problems: readonly NativeHookProblem[] }
  | { state: "unknown"; problems: readonly NativeHookProblem[] };
function validateAgyNativeHookSource(input: {
  path: string; file: Readonly<BoundedFile>;
}): NativeHookValidation;
```

`BoundedFile` is the existing type from `inventory-io.ts`. The producer supplies the exact guarded bytes. The validator accepts no phase, completeness, rule contract, runtime flag, or enablement credential.

`specEnabled:null` retains an absent or null native pointer state. It does not authorize activation. The result retains specification names and event/list occurrence order. It does not invent ordering among named specifications.

The descriptor retains source fields. Defaults used for validation must not silently rewrite existing `startup-hook:` identities or manufacture the recognizer's exact `{command, timeout, type}` shape.

The proposed private dependency interface is:

```ts
function inspectAgyNativeHookDependencies(input: {
  command: string; baseDir: string; budget: InventoryBudget;
}): { sources: readonly AuditSource[]; unavailable: readonly string[] };
```

`InventoryBudget` and `AuditSource` are existing types. Production calls this function only after qualified activation and a source-bound command base. Tests can inspect explicit inert dependencies directly. Such a test proves dependency checks only. It cannot qualify a producer route. This division adds no production setter, activation override, or general shell parser.

### Required fixture migration before GREEN

This migration belongs to H1. The existing fixtures cannot keep their active-effect assumptions under unresolved activation. Every affected case below must migrate before the affected GREEN checks.

**Producer fixtures in `test/pilot/provider-controls.test.ts`:**

| Existing test | Concrete migration and retained control |
| --- | --- |
| `keeps ordinary non-Orca hooks in the generic pending effect audit`, at line 83 | Rename to describe unknown activation. Use the H0-qualified canonical command envelope. Require a specific activation refusal, a pinned hook-source digest, zero source effects, no `agyHookShell`, and unknown controls. |
| `retains the generic dynamic guard for an unrelated custom shell script`, at line 94 | The real producer must retain activation unknown and perform zero script-content reads. Keep the script and source digest assertions. Add a direct dependency-check case that still detects its dynamic closure. |
| `retains dynamic closure for unsupported %s custom hook descriptors`, at line 110 | Keep both raw and quoted spellings. Require production activation refusal, zero active script reads, no known policy, and no verified bootstrap. Pair each spelling with the direct dependency checks below. |
| `keeps AGY 1.4.12 enabled hooks pending a source audit despite absent enrollment`, at line 539 | Rename to describe unresolved native prompt activation. Require the relevant runtime refusal, zero active effects, and unverified startup. Retain settings bytes, inherited Deny checks, and pending effective controls. `AUDIT_DISPOSITION_PENDING` alone no longer proves the case. |

Add `keeps native dependency checks effective without qualifying activation` in the same test file. Call the proposed dependency function with an explicit fixture base and two absolute fixture-owned regular files. One file is an inert interpreter. The other is an inert script. Neither file executes.

Load the proposed helper inside the dependency test with a dynamic import. Do not import missing proposed modules during test-file initialization. Both real-boundary RED commands must reach their assertions before those modules exist.

For the safe control, require pinned dependency digests and no dependency refusal. Add the existing dynamic marker to the script. Require `HOOK_DYNAMIC_CLOSURE_UNAVAILABLE:<script>:<digest>`. Restore the safe bytes. Require the safe result again. Keep the unrelated-script case and both raw/quoted unsupported descriptor cases.

Add component-link, leaf-link, and size-boundary dependency cases from H1's required custody checks. Each negative starts from a successful regular-file control. A restored safe file must pass again. Preserve existing recognizer custody and whole-set tests unchanged. This work does not fix or expand F1-HOOK-EX.

Keep the real guarded JSON read, root-custody, race, source-kind, recipe-byte, CLI-help, and unsupported-version tests. Do not replace their assertions with a generic unknown check. Cases without an acquired hook source retain their original purpose. Parser-positive unit tests must still return `valid` through the actual validator.

**Audit fixtures in `test/pilot/control-audit.test.ts`:**

The existing `preparedAgyAudit` calls `prepareProviderAudit` and asserts `unavailable === []`. `completedAgyAudit` adopts that snapshot. Both currently depend on an unqualified active hook. Keep these helper names for real producer integration, but change their expectations after migration.

`preparedAgyAudit` must use the H0-qualified canonical source. Retain the settings/hook guarded-source assertions. Require the specific unresolved activation reason and zero active source effects. `completedAgyAudit` may adopt the incomplete snapshot through actual fixture authority. Its direct reuse remains unverified. Adoption still returns `providerQualification: "separate-required"`.

Add two proposed test-local helpers, `preparedAgyAuthorityAudit(h)` and `completedAgyAuthorityAudit(h)`. The former calls the existing `saveAuditSnapshot` directly. It must not copy a producer snapshot or remove a producer's unavailable entries. The latter uses unchanged `approveAgySnapshot`, followed by actual `adoptAuditSnapshot`.

Use this exact low-level fixture definition:

| Field or file | Fixture value |
| --- | --- |
| Settings file | `join(h.root, "authority-inputs/settings.json")`, bytes `{"fixture":"settings"}`. |
| Hook-named file | `join(h.root, "authority-inputs/hooks.json")`, bytes `{"fixture":"hook-source"}`. This is opaque audit data, not an asserted native hook schema. |
| `version`, `workspace`, `route` | `1`, `h.workspace`, `"antigravity"`. |
| `providerVersion`, `contract` | `"fixture-native-authority-only"`, `"fixture-native-authority-only"`. |
| `executable`, `recipeHash` | `"/fixture/agy"`, `"fixture-native-authority-recipe"`. These satisfy existing string fields only. |
| `sources`, `ordering` | Both fixture files, kind `file`, with actual byte SHA-256. Order is settings then hook-named file. |
| `effects`, `unavailable` | `["fixture-native-authority-effect"]`, `[]`. The nonempty effect tests exact approval scope. |
| Returned fields | Existing saved-snapshot result plus `settings`, `hook`, and `guarded: [settings, hook]`. The completed helper also returns `run`, `task`, and `adopted`. |

These are narrowly constructed audit fixtures. They prove guarded source checks and low-level native authentication. They never enter `inspectProviderControls` or production rule selection. They establish no current runtime qualification.

Keep the existing exact native sequence. `approveAgySnapshot` creates a Run, creates the hash-bound root Task, dispatches to `fixture-coordinator`, and sends the completed `worker_done` body. Approve the exact snapshot hash and its exact nonempty effect set. Do not mock `nativeDisposition`, the source validator, or the result's `verified` field.

Migrate all affected audit cases as follows:

| Existing case or helper use | Concrete migration and required positive control |
| --- | --- |
| `bounds AGY JSON revalidation with an existing authenticated disposition`, line 87 | Use `completedAgyAuthorityAudit`. Preserve successful reuse, bounded reads, native readback calls, repeated adoption, tamper rejection, and restored successful reuse. Move its producer-inspection assertions to the companion below. |
| New `bounds incomplete native hook inspection with an existing authenticated disposition` | Use real `completedAgyAudit`. Assert equal inspected audit hash, matching disposition read, bounded current-source reads, native readback calls, retained activation refusal, and unknown startup. It cannot claim verified production reuse. |
| `rejects guarded AGY JSON drift during matching-disposition inspection`, line 112 | Keep real `completedAgyAudit` and the armed mutation after disposition-file read. Preserve equal acquisition hash, at least two guarded settings opens, failed drift adoption, and restored successful adoption. Startup and production direct reuse remain unknown after restoration. |
| New `rejects low-level authenticated AGY JSON drift after successful reuse` | Use `completedAgyAuthorityAudit`. Require reuse true, changed source false, adoption drift rejection, restored source true. This prevents an always-refusing result from satisfying drift coverage. |
| `rejects %s guarded AGY JSON without writing a disposition or falling back`, line 141 | Use `completedAgyAuthorityAudit` for all six existing shapes. Preserve the initial and restored `verified === true`, refusal code/path/edge, bounded reads, and absent disposition after failed adoption. |
| `preserves %s AGY audit source semantics`, line 193 | Use `preparedAgyAuthorityAudit` for all six source-kind cases. Preserve initial successful reuse, mode/byte/absence drift negatives, and existing restored controls. |
| `prepares actual versioned hook sources, adopts only matching native owner disposition, and invalidates drift`, line 406 | Keep real production preparation, hook/policy digests, and exact native provenance checks. Replace the one-effect/empty-unavailable assumptions with zero source effects and the specific activation refusal. After valid adoption, startup remains unknown. For reportedBy tampering, assert adoption rejects, then restore provenance and require adoption to succeed. Preserve hook drift and governing-policy drift rejection. |

Leave the separate `completedAudit` Codex authority helper and its generation, owner, workspace, incarnation, effect-scope, and restored-authentication controls intact. Do not weaken either route's native authority checks.

The new `cannot discharge native hook validation unknowns with a disposition` test must not fail in setup. Prepare through the real producer without a helper assertion about its future unavailable result. Use a prompt with a H0-qualified envelope and an unqualified model spelling. Before the tested assertion, require guarded source acquisition, authentic Task completion, and successful adoption. Approve every listed effect. Then require direct reuse to remain unverified with `AGY_NATIVE_HOOK_MODEL_UNAVAILABLE` retained.

Before that production test, establish successful low-level authenticated reuse in a separate `contextFixture` using the authority helpers. The existing producer should reach the final rejection assertion and fail it before H1 implementation. If its setup fails or it already refuses for another reason, record no meaningful RED. Return the evidence to root before changing production code.

No prior plan specified zero-byte or empty-object authority controls. The reviewer phrase that claimed those controls is not adopted. The new authority control above uses nonempty JSON files and a nonempty effect.

### Steps after promotion

- [ ] Add the source-derived parser RED cases.

  Proposed unit tests and required assertions:

  | Proposed test name | Assertions |
  | --- | --- |
  | `validates all six canonical native event schemas` | Four direct lists and two matcher-group lists yield `state === "valid"`. All six event values survive. |
  | `validates disabled specs before applying spec enablement` | An invalid handler in `enabled:false` yields `state === "invalid"`. The result contains no occurrence list. |
  | `rejects the whole source when a sibling native spec is invalid` | One valid spec plus one known-invalid spec yields invalid. No valid sibling escapes. |
  | `retains native payload whitespace and timeout defaults` | Whitespace payload remains nonempty. Nonpositive timeout validates with native 30-second semantics. Source descriptor bytes remain unchanged. |
  | `rejects prompt handlers in PostToolUse` | The accepted prompt restriction gives invalid with the event pointer. |
  | `retains specific native decoder and model unknowns` | Reachable unqualified forms give unknown with source and pointer. Canonical supported controls give valid. No unknown alias is declared invalid without evidence. |
  | `does not validate matcher syntax with JavaScript regex` | An invalid regex spelling does not become a ParseHooks validation error. Runtime applicability remains unresolved. |

  H0 supplies the exact canonical envelope and decoder edge fixtures before this step becomes executable. Known handler failures use the accepted nonempty-payload and exact-type rules. This plan supplies no guessed coercion fixtures.

- [ ] Add the real-acquisition RED cases.

  Use the existing isolated `withAgyControls` fixture. Use fake help and inert source text. Do not execute source commands.

  For `rejects an invalid SessionStart in a disabled native spec at acquisition`, assert a source-specific validation refusal. Assert no effect or descriptor from the rejected source. Assert the startup fact remains unknown.

  For `does not retain a valid sibling after native whole-source rejection`, place a valid handler beside the invalid spec. Assert zero source effects. Spy on dependency reads to prove neither sibling starts active scanning.

  For `does not turn native parser validity into startup qualification`, use a canonical parser-valid source. Assert validation succeeds. Assert the encountered loader/plugin/runtime unknown remains in `audit.unavailable`. Assert no active dependency read occurs on unknown activation.

  For `retains disabled native hook bytes without active dependency reads`, change only disabled source bytes. Assert the source digest and audit identity change. Assert no active effect or script read follows.

  The proposed problem codes are `AGY_NATIVE_HOOK_VALIDATION_FAILED`, `AGY_NATIVE_HOOK_DECODER_UNAVAILABLE`, and `AGY_NATIVE_HOOK_MODEL_UNAVAILABLE`. Existing Task 5.3 problems retain their meanings. The refusal includes source path and pointer. These are diagnostics, not schema additions.

  For `refuses duplicate native hook keys before validation`, use duplicate JSON keys in the real fixture file. Assert `INVENTORY_JSON_INVALID:<path>` and no validator call. Assert no source effects, dependency reads, or fallback. The guarded reader owns this diagnostic. A raw-byte unit case cannot establish reachability through successful acquisition.

- [ ] Run the proposed RED commands in the command table.

  Expected: the current acquisition test fails because disabled content bypasses native validation. A missing proposed module alone is insufficient evidence. Retain the real-boundary assertion failure.

  Add the audit RED before any production edit. Build unchanged production first because that suite imports `dist`. Keep its low-level positive control independent of the new validator import. Unit fixture imports that require a missing proposed module must not prevent the audit RED from reaching its assertion.

- [ ] Implement `validateAgyNativeHookSource` in the proposed private module.

  Validate the whole source before returning occurrences. Collect known errors without emitting partial results. Preserve each unresolved decoder or model class as unknown. Use the accepted rules and H0 decisions only.

- [ ] Replace the AGY recursive parsing path at the hook-source loop.

  Consume the exact successful `readAgyJson` result once per source. Preserve its byte digest. Preserve acquisition failures and absences. Validate every acquired source before any spec-disable shortcut.

  On invalid or unknown, append the specific refusal and force the startup fact unknown. Emit no effects or descriptors from that source. Never fall back to `hookEffects` or `enabledHook` for AGY.

  On valid, retain parsed metadata and nullable spec enablement. Determine activity only from qualified loader, plugin, spec, and runtime inputs. Unknown influential inputs remain unavailable. This increment must not invent a normal caller or registry value.

  Call the proposed dependency function only for qualified active commands with a qualified base. Its direct fixture controls do not supply production activity. An unavailable production activity path cannot be replaced by a test admission switch.

  For qualified active commands, preserve existing effect identities. Preserve every occurrence sent to the recognizer. For equivalent supported inputs, submit the complete active Orca-referencing set to the existing functions. An extra active unsupported descriptor rejects the set. A disabled counterpart stays metadata.

  Preserve command/prompt text exactly. Retain unknown prompt runtime activation. Retain unknown command base, expansion, indirect scripts, credentials, endpoints, and transitive closure. Existing bounded custody checks remain mandatory. Successful parsing clears none of these problems.

  Remove only the existing exact dynamic-closure reason after successful known-policy acquisition. `SessionStart` validation grants no new Orca policy event.

- [ ] Add `cannot discharge native hook validation unknowns with a disposition` to the audit suite.

  Use the fixture design above. Approve every listed effect for the exact production snapshot. Require direct reuse to return `verified === false` while the specific parser unknown remains. Require the separate low-level authority control to succeed.

  This test uses existing audit behavior. It does not add hook-path guessing to `validateAuditSources`. Saved-snapshot graph reconstruction remains Task 6.2.

- [ ] Run the GREEN and affected checks in the command table.

  Complete every fixture migration above before GREEN. Expected: parser positives succeed, production unknowns refuse, dependency controls pass, and native authority controls succeed and reject their mutations. Unexpected failures return to root for disposition.

- [ ] Submit the frozen change and rollback record to root.

  Record each changed path and its prior hash. Root obtains fresh review before integration. Commit and publication remain root-owned actions. This authoring assignment performs neither.

### Exact future commands and expected results

All commands run from the checkout. None ran during authoring. Root applies the existing reviewed command bounds and receipt workflow. This worker launches no wrapper.

| Phase | Exact command | Expected result and bound |
| --- | --- | --- |
| Unit RED | `npm test -- test/pilot/agy-native-hook-validation.test.ts` | Fails before implementation. Missing-module failure is only unit setup evidence. 90 seconds. |
| Boundary RED | `npm test -- test/pilot/provider-controls.test.ts -t 'rejects an invalid SessionStart in a disabled native spec at acquisition'` | Fails on the required refusal/effect assertion before production edits. 120 seconds. |
| Unchanged-production build before audit RED | `npm run build` | Exit 0 before any H1 production edit. Build failure supplies no audit RED. 120 seconds. |
| Audit RED | `npm test -- test/pilot/control-audit.test.ts -t 'cannot discharge native hook validation unknowns with a disposition'` | The low-level authenticated control succeeds. Real producer preparation and adoption succeed. The final required rejection fails on unchanged production. Setup failure, unrelated refusal, and timeout are not RED. 120 seconds. |
| Parser and producer GREEN | `npm test -- test/pilot/agy-native-hook-validation.test.ts test/pilot/provider-controls.test.ts` | Passes all proposed cases and existing producer checks. 120 seconds. |
| Current build | `npm run build` | Exit 0 before the dist-consuming audit suite. 120 seconds. |
| Audit/authority GREEN | `npm test -- test/pilot/control-audit.test.ts test/pilot/agy-hook-shell.test.ts` | Exit 0. Existing five-event, whole-set, custody, drift, and native provenance checks remain effective. 120 seconds. |
| Typecheck | `npm run typecheck` | Exit 0. 120 seconds. |

The audit test has a separate positive authentic-authority control. An always-unknown implementation cannot pass the actual parser-positive or dependency-positive tests. A synthetic snapshot never enters production qualification. Existing incomplete production snapshots remain unavailable after authenticated disposition.

Root records command, cwd, source hashes, dist hashes where applicable, output, exit code, and process settlement. A timeout is not RED. A failed assertion with incomplete setup is not the required defect reproduction.

The whole-branch campaign remains Task 8.1. The 1611/14 default result is not a passing baseline. No default-suite failure is waived here.

**Acceptance after promotion:** The real producer consumes the validator. Whole-source invalidity rejects every contribution from that source. Supported sources produce meaningful validation results. Specific unknowns survive disposition. No legacy AGY parsing fallback remains. All affected tests pass under fresh independent review.

## Remaining unknowns and expansion conditions

| Unknown | Required treatment now | Expansion condition |
| --- | --- | --- |
| Exact JSON v2 option and decoder forms | H1 remains provisional. Do not copy JSON v1 assumptions. | H0 qualifies each required form or a source-backed conservative refusal boundary. |
| Hook-refresh effective value | `AGY_NATIVE_HOOK_RULE_UNAVAILABLE` remains applicable. Object identity, key `6`, and `enable-customization-kind-hooks` are proved. File presence proves no effective value. | Accepted normal-caller evidence binds the encountered lookup. |
| Normal options, registry, checker factories | Options-v3 is accepted conditional source. Normal backend installation at `+616/+632`, registry `0x10bb1f230`, and live values remain unbound. | Source-qualified normal receiver installation and guarded current inputs. |
| Plugin selection and disablement | Keep selected/enabled/disabled/unknown distinct. | Accepted selector and enablement rules have qualified current inputs. |
| Prompt aliases and `enable-generative-hooks` | Specific model/runtime refusal for influential unknowns. | Exact alias or runtime input is source-qualified. |
| Handler base, shell expansion, indirect and sensitive dependencies | Retain specific dependency refusals. Do no speculative reads. | Accepted source/base and bounded dependency custody cover the encountered command. |
| Full graph, finder behavior, other native components | Preserve all existing Task 5.3 unknowns. | Qualified complete traversal and effects for actual inputs. |
| Generated files, bookkeeping, assignment PATH, normalization | No exclusion, wildcard exemption, or reuse-equivalence claim. | Actual membership and consumption rules justify the exact projection. |

**One next check:** Qualify the semantic fields and decoder consequences of the identified ParseHooks option at `0x10ba78fe0`. Use retained primary evidence for both source and handler decoding. Return a precise missing-source request if that evidence is absent.

## Existing roadmap and acceptance map

This proposal refines Task 5.3. It does not replace the approved design or create a competing plan graph. Root synchronizes any accepted refinement through the existing workflow.

| Existing outcome | Retained work and expansion condition |
| --- | --- |
| Task 5.1 | Remaining source qualification, normal caller inputs, and review. Native acceptance supplies conditional rules only. |
| Task 5.2 | Accepted bounded acquisition and digest validation. No accepted behavior is rewritten by this plan. |
| Task 5.3 | H0/H1 cover only native whole-source hook validation. Full graph, declarations, finder, ordering, components, enablement, and dependency closure remain provisional. |
| Task 6.1 | Clean-store preparation waits for qualified bookkeeping exclusion and full acquisition. Parser success cannot authorize writes. |
| Task 6.2 | Adoption and direct reuse require live reconstruction, complete sources, witness validation, exact recipe identity, and the maintained same-name type-change regression. |
| Task 7.1 | Retained-recipe launch requires current source validation, exact physical materializations, and the current assignment's hook instance. |
| Task 8.1 | Whole-branch and campaign tests, unresolved default failures, fresh independent review, and operational acceptance remain open. |

AC1 remains the accepted real-acquisition reproduction and later maintained regression. AC2 remains complete version-bound membership and order. AC3 retains disabled metadata and accurate activation. H1 contributes to AC3 without completing it.

AC4 retains specific unavailable results and all finite bounds. H1 contributes whole-source refusal. AC5 still requires preparation/adoption/reuse/launch drift checks and unchanged positive reuse. AC6 retains five-event custody, unrelated-hook checks, offline verification, and independent acceptance.

This increment cannot close GitHub issue 3. It supplies no live startup, final inventory, reuse-equivalence, or campaign acceptance claim.

## Author self-review

**Spec coverage:** All six criteria retain owners in the existing roadmap. H1 covers only the named validation increment. No full-goal outcome was removed.

**Step scan:** H0 has one checkable evidence product. H1 has named tests, file owners, private interfaces, and exact commands. Its unknown decoder decisions remain explicit prerequisites.

**Type consistency:** `BoundedFile`, `InventoryBudget`, `AuditSource`, and the current audit interfaces exist. Proposed names are marked. `valid` means parser validity only. Dependency observations supply no activation authority.

**Review focus:** Each focus class has a named H1 test. Actual parser positives, direct dependency controls, and independent low-level authority controls prevent vacuous success. Guarded duplicate refusal precedes validation.

**Proportion:** The plan defines boundary decisions and assertions. It supplies no production implementation. Detailed graph and lifecycle work remains in the governing integration plan.

**Findings:** The existing disabled shortcut and recursive parser are concrete integration gaps. The JSON v2 option's semantic fields remain a readiness gap. Its metadata identity is available as a root-supplied locator. The whole implementation remains provisional.

### Correction dispositions

| Review finding | Disposition in this correction |
| --- | --- |
| `fixture-plan` / `H1-EXIST-TESTS`, important | Addressed in the required fixture migration. All affected producer cases and audit helper users have explicit changes. Low-level positive authority uses a separately constructed snapshot and actual fixture provenance. Production unknowns remain unavailable. Direct dependency tests retain successful and restored controls without production activation. |
| `OPT-V3-STALE`, important | Addressed. Added the exact accepted conditional hash and result `9b95b903`. Corrected concrete hook object, refresh key `6`, and checker key. Normal installation, registry contents, and effective runtime values remain unbound. |
| `JSON-DUP-BOUND`, minor | Addressed. Duplicate keys retain the earlier `INVENTORY_JSON_INVALID` acquisition refusal. No validator pointer or successful-read reachability is promised. |
| `H0-H1-CMD-GAP`, minor | Addressed. Initial range is `27–50`. H0 includes the handler primary and separate decoder binding. A build and meaningful dist-consuming audit RED precede production edits. |
| Reviewer strength about zero-byte/empty-object controls | Not adopted. Those controls were not in the original proposal. The new low-level fixture uses nonempty JSON files and a nonempty effect. |

The prior plan hash is `a8a258c5de824822c6b48b2eafbf84ca5734646105f303e3eb1cd8f51bdf6d30`. The prior note hash is `07016855e2d21fbf70647ff581220dd605f32645eb33b0ac5f52ea9db20bfa6b`. Frozen review inputs and original reports remain unchanged.

H0 is not complete. H0 success alone does not qualify unresolved production activity. Root must reassess the whole H1 dependency set before promotion. This correction does not claim independent acceptance or completed fixture implementation.

**Verification limits:** Inspection and hash checks were read-only. No tests, build, provider, hooks, plugins, network, or implementation ran. Language is an Issue 9-oriented candidate with incomplete vocabulary verification.

**Review handoff:** Root verifies these exact two file hashes before fresh Astra Ultra and Argon high review. Root owns all findings and acceptance. This worker performs no delegation or execution-method interview.
