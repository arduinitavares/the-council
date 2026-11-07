# Issue #3 inventory witness implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the inventory witness mechanics, then connect qualified live reconstruction to preparation, adoption, reuse, and launch for issue #3.

**Architecture:** Separate bounded observations, witness integrity, loader decisions, and native effect authority. Store canonical witness bytes as an ordinary audit file source. Reconstruct live inputs before reuse and check exact physical materializations before spawn.

**Tech Stack:** Existing TypeScript, Node.js, strict JSON, Zod, and Vitest. Add no dependency.

**Spec:** `.superpowers/sdd/2026-11-01-issue-3-loader-witness/research/input/approved-design.md`, SHA-256 `60cf740bd15cfc1d294ff3150eccfc48e6928d33507b15cf3ad4a18981af78b1`. Use `research/coordinator-verified-evidence.json`, `research/worker/contract-matrix.json`, and `coordinator-interface-map.md` under the same continuation directory. The design approval persists. Its historical pending-approval wording is stale.

## Global constraints

- Start from `22805755e9776a894328c07fbdbf472c382cdff7` in PR #11. Preserve existing work and all other campaign issues.
- This document authorizes no action by itself. This authoring assignment changes only this plan and its `plan-author/` evidence.
- Execution uses the already selected SDD method after independent frozen-plan review. The coordinator owns assignments, integration, rulings, and acceptance.
- Keep the whole #3–#10 goal. Only #3 belongs to this increment. Keep #8 and the paused #9 operation separate.
- Preserve `AuditSnapshot` version 1, `AuditSource` kinds, `ProviderControlEvidence`, and the strict `ProviderRecipe` schema.
- Preserve `currentSourceDigest()` byte, metadata, absence, and null meanings. Do not substitute a synthetic directory digest.
- Preserve all actual Deny rules, external source custody, and the five-event Orca hook boundary.
- Do not run real AGY, plugins, hooks, an installer, or a provider diagnostic. Portable fixtures use inert files and fake help only.
- Do not change models, global settings, account state, trust, permissions, billing, or spending. Do not perform Git mutation in this assignment.
- A witness constructor, saved snapshot, test fixture, or caller completeness flag cannot qualify a production provider.
- Unknown inventory cannot be approved away by native effect dispositions. Integrity, semantic completeness, effect approval, and runtime qualification remain separate.
- Retain the 100-entry directory bound and the 1 MiB JSON bound. Bound reads before hashing or parsing.
- Use the design's finite safety ceilings: 1,000 distinct paths, 32 inherited edges per path, 128 ancestor levels, 64 object levels, and 16 MiB total inventory JSON. These are Council refusal limits, not AGY limits.
- Treat saved context as expected data. Obtain current HOME, PATH, environment absence, executable, agent, and package recipe from live inputs.

## Review focus

- A same-name entry can change type while old root metadata and every old source digest remain unchanged. Tasks 1–3 own these tests.
- Saved HOME/PATH, selected agent, or recipe bytes cannot authenticate current host values. Tasks 3 and 6 own these tests.
- An incomplete static set or an extra discovered entry must fail exact-set validation. Full parent custody listings must not become semantic loader roots by implication. Tasks 3–7 test clean preparation, complete loader-root entries, and two distinct assignment profiles under excluded, consumed, and unknown membership rules.
- A bounded validation must not be followed by an unbounded reread. Tasks 2, 3, 6, and 7 own these tests.
- A synthetic complete mechanics fixture cannot qualify a production loader or hide an encountered semantic unknown. Tasks 3, 5, and 8 own these tests.

---

## Source facts and proposed file boundaries

Inspected source facts are listed below. All new names and signatures in this plan are proposals until implemented.

| Existing interface | Current behavior to preserve or change at its stated task |
| --- | --- |
| `ProviderControlSource = (selection: ModelSelection, version: string, workspace: string, billing: Observation, command?: Command) => Promise<ProviderControlEvidence>` | `inspectProviderControls` has this public type. It resolves PATH and calls bounded `--help`, then calls disposition at its tail. Do not call it from saved-witness reconstruction. |
| `prepareProviderAudit(selection: ModelSelection, version: string, workspace: string)` | Calls inspection and `saveAuditSnapshot`. Keep its public signature and result shape. |
| `adoptAuditSnapshot(workspace: string, hash: string, runId: string, taskId: string, command: Command)` | Checks raw sources before native authority. Preserve native identity, generation, scope, and reference checks. |
| `acquiredAuditDisposition(snapshot: AuditSnapshot, command?: Command)` | Returns `{ verified: boolean, detail: string }`. Saved sources currently drive its raw loop. |
| `currentSourceDigest(source: AuditSource): string \| null` | Reads files without a size bound. Metadata contains mode/dev/ino/size/mtimeMs/symlink status, but no entry listing. |
| `runProviderSession(a: WrapperAssignment, assignmentHash: string)` | Checks facts and raw sources, materializes files, binds agent, builds environment, instantiates optional hook policy, then spawns. |
| `instantiateAgyHookShellPolicy(policy, { packetRoot, directory, assignmentHash }, materialize)` | At `agy-hook-shell.ts:416–461`, returns `{ launchPath, instanceHash, reportPath }`. It binds actual assignment identities and exact copied materials. |
| `contextFixture(behavior = "normal", legacyExitAbi = false)` | Returns `root`, `workspace`, `command`, `state`, `orca`, `rpc`, `evidence`, `events`, `terminals`, and async `close`. The audit test imports this helper, not `nativeHostFixture`. |

Source evidence is frozen in `plan-author/source-receipt.json`. Current AGY roots include the current store, but metadata-only membership remains insufficient. The matrix is not a qualified loader.

| Proposed file | Responsibility and readiness |
| --- | --- |
| `src/pilot/inventory-io.ts` | Bounded no-follow observations and read receipts. Ready, Task 2. |
| `src/pilot/agy-inventory-witness.ts` | Strict witness format, canonical bytes, stable recipe/context binding, exact projection comparison. Ready, Task 3. |
| `src/pilot/agy-inventory-store.ts` | Content-addressed immutable file persistence. Ready, Task 3. |
| `src/pilot/agy-materialization-state.ts` | Physical exact-set checks, without loader normalization authority. Ready, Task 4. |
| `src/pilot/agy-recipe-plan.ts` | Current package's deterministic AGY recipe builder, extracted from existing source. Provisional integration, Task 6. |
| `src/pilot/agy-loader-contract.ts` | Evidence-bound decisions and input-specific qualification. Provisional, Task 5. |
| `src/pilot/agy-startup-inventory.ts` | Qualified graph acquisition and live boundary reconstruction. Provisional, Tasks 5–6. |
| Existing `provider-controls.ts`, `control-audit.ts`, `provider-session.ts` | Lifecycle wiring after prerequisites. Provisional, Tasks 6–7. |

Task 1 records an unchanged-source behavioral RED. Tasks 2–4 have complete mechanical inputs and can reach focused GREEN independently. Tasks 5–7 cannot be promoted as whole tasks while their stated semantic prerequisites remain open. Task 8 is the final acceptance gate. A mechanics checkpoint does not close #3.

## Task 1: Record the unchanged-source behavioral RED — ready

**Owner:** Implementer, with coordinator verification of the receipt.

**Files:** Create the preserved diagnostic `.superpowers/sdd/2026-11-01-issue-3-loader-witness/implementation-evidence/baseline-membership-red.test.ts` and its task-local `vitest.baseline-red.config.ts` in that same directory. Write logs and hash receipts there. Leave `test/` and project `vitest.config.ts` unchanged for this task. Do not edit production source before this RED.

**Interfaces:** Consume the existing native `contextFixture()` and compiled audit boundaries with these exact diagnostic imports:

```ts
import { it, expect, vi } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, chmodSync, lstatSync,
  readdirSync, unlinkSync, utimesSync } from "node:fs";
import { join, delimiter } from "node:path";
import { contextFixture } from "../../../../test/pilot/context-fixture.js";
import { incidentRoster, policyTable } from "../../../../test/pilot/fixtures.js";
import { prepareProviderAudit, adoptProviderAudit }
  from "../../../../dist/pilot/provider-controls.js";
import { acquiredAuditDisposition, currentSourceDigest }
  from "../../../../dist/pilot/control-audit.js";
```

Follow the native Run/Task/Dispatch completion sequence in the existing AGY audit test around lines 197–233. Do not invent `fixture.audit()` or an unconditional authority reader.

- [ ] Record hashes of the five production integration files and the native fixture helper before any production edit.

  Run `shasum -a 256 src/pilot/provider-controls.ts src/pilot/control-audit.ts src/pilot/provider-session.ts src/pilot/wrapper-contract.ts src/pilot/agy-hook-shell.ts test/pilot/context-fixture.ts test/pilot/control-audit.test.ts vitest.config.ts`. Retain stdout, cwd, baseline, and UTC time.

- [ ] Add `rejects saved AGY reuse after an ignored root entry changes type` with a 30-second test timeout.

  Use `const h = await contextFixture()` and `try/finally`. Stub HOME to `h.root` and prepend `h.root` to saved PATH. Use `policyTable` and the existing settings fixture. Read captured help with `readFileSync(new URL("../../../../test/pilot/fixtures/agy-1.4.12-help.txt", import.meta.url), "utf8")`. The fake executable emits help only. A global hook can contain the inert descriptor `/bin/echo sanitized-lifecycle`. Never execute that descriptor.

  Create `root = join(h.root, ".gemini/config/plugins")`. Create a regular file `slot = join(root, "slot")` with innocuous bytes. Set root atime/mtime to an exact whole-second value before preparation. Use the existing native completion sequence to approve precisely `prepared.snapshot.effects`. Save the positive reuse result in the RED receipt.

  Record `readdirSync(root, { withFileTypes: true })` as name/type pairs. Record each old source's `currentSourceDigest`. Require `prepared.snapshot.unavailable` to equal `[]` and baseline native reuse to be verified. These are unchanged-source diagnostic preconditions, not claims of actual provider qualification.

  Unlink only the task-created regular `slot`, then create a directory at that exact path. Add inert `slot/hooks.json` with a distinct command descriptor. Do not add a manifest or invoke a hook. Restore root atime/mtime. Require the old and new root metadata digest to be equal. Require the name list to remain equal and `slot`'s type to differ. Require every old source digest to remain equal to its saved value.

  The decisive assertion is:

  ```ts
  expect((await acquiredAuditDisposition(prepared.snapshot, h.command)).verified).toBe(false);
  ```

  Existing source returns `true`. A metadata precondition failure is a fixture failure, not this RED. Do not mock metadata, omit the precondition, or report a module collection error as RED. If the filesystem cannot preserve the root's compared fields, return the exact failed precondition for coordinator reassessment.

  The coordinator's `membership-proof-rCo4SD/result.json` under this continuation corroborates the host precondition: root size 96, mtime 1700000000000, and metadata digest stayed equal across a file-to-directory replacement. It is not the authenticated reuse RED required here.

- [ ] Create the diagnostic-only temporary configuration with this exact content.

  Save it as `implementation-evidence/vitest.baseline-red.config.ts` under this continuation. Retain its bytes as diagnostic evidence after execution. It does not extend or modify project configuration.

  ```ts
  import { defineConfig } from "vitest/config";
  import { fileURLToPath } from "node:url";

  export default defineConfig({
    root: fileURLToPath(new URL("../../../../", import.meta.url)),
    test: {
      include: [".superpowers/sdd/2026-11-01-issue-3-loader-witness/implementation-evidence/baseline-membership-red.test.ts"],
      testTimeout: 30000,
      hookTimeout: 30000,
    },
  });
  ```

- [ ] Build unchanged production source before the audit test imports `dist`.

  Run `npm run build`, then `npm test -- --config .superpowers/sdd/2026-11-01-issue-3-loader-witness/implementation-evidence/vitest.baseline-red.config.ts -t 'rejects saved AGY reuse after an ignored root entry changes type'`. Expected RED is the final `false` assertion receiving `true`, after all preconditions pass. Confirm that the selected test is exactly `baseline-membership-red.test.ts`.

- [ ] Record the exit code, assertion, old sources, directory pairs, and matching source hashes.

  Verify the production, fixture, maintained audit test, and project configuration hashes still match the pre-run receipt. Record the diagnostic/configuration SHA-256 values, exact configured command, selected file, positive control, metadata preconditions, and expected failing assertion. Always run `vi.unstubAllEnvs()` and `await h.close()` in `finally`. Do not run tests during plan authorship.

- [ ] Freeze this RED as baseline evidence before Task 2.

  The old positive precondition describes the defect and is not a future production admission requirement. Keep the diagnostic, its configuration, and original RED receipt unchanged. Project configuration includes only `test/**/*.test.ts`, so this task-local expected RED is outside maintained-suite discovery. Tasks 2–4 and a labeled mechanics checkpoint do not park a new failing test in that suite. They do not claim this diagnostic fixed or GREEN. Task 6 must port the counterexample into the maintained audit suite with a positive unchanged-evidence control and actual validation. Do not skip an implemented behavior test or call blanket legacy rejection full GREEN.

**Acceptance:** A behavioral failure from the existing saved-audit boundary, with unchanged production hashes. This evidence task deliberately does not deliver a production fix.

## Task 2: Build bounded inventory observations — ready after Task 1

**Owner:** Implementer. **Files:** Create `src/pilot/inventory-io.ts` and `test/pilot/inventory-io.test.ts`.

**Interfaces:** Consume `canonicalJson`, `sha256`, and `decodeStrictJson`. Produce these mechanical types and functions:

```ts
type InventoryProblem = { code: string; path: string; edge: string | null };
type NodeIdentity = { dev: number; ino: number; uid: number; gid: number;
  mode: number; size: number; mtimeMs: number; ctimeMs: number;
  type: "file" | "directory" | "symlink" | "other" };
type InventoryBudget = { paths: Set<string>; jsonBytes: number };
type ReadReceipt = { path: string; before: NodeIdentity; after: NodeIdentity;
  components: readonly { path: string; identity: NodeIdentity }[] };
type InventoryRead<T> =
  | { state: "present"; value: T; receipt: ReadReceipt }
  | { state: "absent"; path: string; verifiedParents: ReadReceipt["components"] }
  | { state: "unknown"; problems: readonly InventoryProblem[] };
type BoundedFile = { bytes: Uint8Array; sha256: string };
type DirectoryListing = { entries: readonly {
  name: string; type: NodeIdentity["type"] }[] };
function readInventoryFile(path: string, limit: number,
  budget: InventoryBudget): InventoryRead<BoundedFile>;
function readInventoryJson(path: string,
  budget: InventoryBudget): InventoryRead<{ value: unknown; file: BoundedFile }>;
function listInventoryDirectory(path: string,
  budget: InventoryBudget): InventoryRead<DirectoryListing>;
```

`InventoryBudget` is task-local mutable accounting, not serialized authority. Functions report unknown instead of returning a truncated successful observation. An absence records filesystem evidence only. Its loader relevance belongs to Task 5.

- [ ] Add failing tests for exact file bytes, empty listings, absent paths, and full name/type listings.

  Use `lists ignored files and detects same-name type replacement`. Assert that regular `slot` and directory `slot` yield different canonical listings even after root mtime restoration. Add add/remove/rename cases with preserved root timestamps. Include names without a recognized extension.

- [ ] Run `npm test -- test/pilot/inventory-io.test.ts` to record the local RED.

  This new-module RED supplements Task 1. It does not replace the behavioral baseline RED.

- [ ] Implement bounded reads and receipts in `inventory-io.ts`.

  Validate every existing path component with `lstat`. Reject component and leaf links before following them. Use a no-follow file open and descriptor checks. Read at most `limit + 1` bytes with a bounded descriptor loop. Hash and parse those same bytes. Close descriptors on every path. Check components and descriptor identity before and after reading. Include ctime in stability checks, not in replacement metadata digest semantics.

  Use a directory stream with bounded buffering and stop at entry 101. Include every name and type. Resolve unknown directory-entry types with guarded `lstat`. Sort names only for canonical listing presentation. Do not convert this order into loader order. Close the stream on success or failure.

  Only ENOENT after verified parent traversal establishes absence. ENOTDIR, dangling links, denied access, malformed bytes, and unsupported no-follow controls remain unknown. No fallback read is permitted after a refusal. No unbounded `readFileSync` follows a bounded read.

  Node exposes `openSync`, descriptor reads, and directory streams. The [official filesystem reference](https://nodejs.org/download/release/v22.20.0/docs/api/fs.html#fsopensyncpath-flags-mode) documents the relevant flags and APIs. Component checks remain necessary. These checks detect instability within inspection and do not promise a race-free filesystem after inspection.

- [ ] Add exact bound and failure tests.

  Assert success at 100 entries and 1,048,576 JSON bytes. Assert unknown at 101 entries and 1,048,577 bytes. Count read bytes and prove a bound-plus-one stop, including a growing file. Assert unknown for duplicate JSON keys, invalid UTF-8, malformed JSON, FIFO/nonregular leaves, root/component/leaf/dangling links, and changed inode or size during reading.

  Test EACCES/EPERM through a local filesystem-call fault, since chmod alone can pass under elevated users. Assert no fallback access. Test 1,000/1,001 distinct paths, 16 MiB aggregate/one-byte overflow, and object nesting 64/65. Guard nesting before recursive traversal. Reuse strict JSON duplicate detection. Keep the generic decoder's existing 128-level contract unchanged.

- [ ] Run `npm test -- test/pilot/inventory-io.test.ts` and retain its receipt.

**Acceptance:** Complete bounded observations or explicit unknowns. No function asserts loader completeness, writes sources, or invokes providers.

## Task 3: Bind canonical witnesses and persist immutable bytes — ready after Task 2

**Owner:** Implementer. **Files:** Create `src/pilot/agy-inventory-witness.ts`, `src/pilot/agy-inventory-store.ts`, `test/pilot/agy-inventory-witness.test.ts`, and `test/pilot/agy-inventory-store.test.ts`.

**Interfaces:** Consume Task 2 observations and existing `ProviderRecipe`/`AuditSource` types. Produce a strict internal witness schema. The following exact core is the proposal:

```ts
type AgyRecipeInputs = Pick<ProviderRecipe, "protocol" | "executable" | "argv" |
  "cwd" | "version" | "selection" | "expectedPermission"> & {
  agent: string | null; agentDefinition: ProviderRecipe["agentDefinition"] | null;
  materializations: NonNullable<ProviderRecipe["materializations"]>;
  codexPolicy: ProviderRecipe["codexPolicy"] | null;
  agyHookShell: ProviderRecipe["agyHookShell"] | null };
type AgyInventoryContext = { requestingWorkspace: string; executionCwd: string;
  home: string; rawHome: string | null; repositoryBoundary: string | null;
  selectedAgent: string | null;
  environmentInputs: Record<string, string | null> };
type LoaderBinding = { id: string; semanticsDigest: string;
  evidenceDigests: readonly string[]; adapterRevision: string;
  executable: { path: string; sha256: string } };
type InventoryRecord = { path: string; role: string;
  presence: "installed" | "absent" | "unknown";
  enablement: "enabled" | "disabled" | "unknown" | "not-applicable";
  enablementOrigin: string | null;
  selection: "selected" | "excluded" | "shadowed" | "unknown";
  sha256: string | null; problems: readonly InventoryProblem[] };
type DiscoveryEdge = { from: string; to: string; role: string; ordinal: number;
  declaringPath: string | null; resolutionBase: string | null;
  ruleIds: readonly string[] };
type InventoryCore = { context: AgyInventoryContext; recipeInputs: AgyRecipeInputs;
  loaderContract: LoaderBinding; inventory: {
    records: readonly InventoryRecord[]; orderedEdges: readonly DiscoveryEdge[];
    rootListings: readonly { path: string; entries: DirectoryListing["entries"];
      custody: { uid: number; gid: number; mode: number; dev: number | null;
        ino: number | null } }[];
    absenceProbes: readonly string[]; sources: readonly AuditSource[];
    activeDescriptorOccurrences: readonly { source: string; event: string;
      matcher: string | null; ordinal: number; descriptorJson: string }[];
    ordering: readonly string[]; effects: readonly string[];
    unavailable: readonly string[]; appliedRuleIds: readonly string[];
    normalizationRuleIds: readonly string[] } };
type EncodedWitness = { fingerprint: string; bytes: Uint8Array; sha256: string };
function stableAgyRecipeInputs(recipe: ProviderRecipe): AgyRecipeInputs;
function encodeAgyInventoryWitness(core: InventoryCore): EncodedWitness;
function decodeAgyInventoryWitness(bytes: Uint8Array): InventoryCore;
function bindAgyRecipeHash(core: InventoryCore): string;
function assertInventoryProjection(actual: readonly AuditSource[],
  expected: readonly AuditSource[]): void;
function prepareAgyAuditDirectories(workspace: string): void;
function persistAgyInventoryWitness(workspace: string,
  encoded: EncodedWitness): AuditSource;
function readAgyInventoryWitness(workspace: string, fingerprint: string,
  budget: InventoryBudget): InventoryRead<{ core: InventoryCore; encoded: EncodedWitness }>;
```

Import Task 2 types by name. `decodeAgyInventoryWitness` validates the envelope and returns its core. The strict envelope is `{ version: 1, fingerprint: F, core }`. Every nested record is strict. Reject extra fields, duplicate keys, invalid hashes, noncanonical bytes, and nonabsolute filesystem identities. Enforce the 1 MiB limit on encoded envelope bytes as well as reads. Validate material content hashes and route consistency. `descriptorJson` is canonical JSON of the original supported handler. Preserve occurrence multiplicity and its existing effect digest. No `complete` field or production admission token exists here.

`inventory.rootListings` contains only evidence-qualified loader-relevant roots and their complete effective membership. Task 4's full-parent `directoryObservations` are physical custody observations. They are not serialized into this field merely because a material has that parent. Task 5 establishes root relevance and every exclusion through qualified rules and live discovery edges. Preserve every entry of an actual loader root, including ordinary siblings and empty listings. Preserve extra discovered paths and alternate edges. Physical observations remain available for custody checks even when qualified rules exclude that parent from semantic inventory.

- [ ] Add failing tests for canonical binding and immutable round trips.

  Require equal bytes for equal cores. Object-key insertion order may differ. Edge, source, materialization, descriptor occurrence, and loader ordering must remain meaningful. Mutate each context field, relevant environment value/absence, selected agent, executable bytes, contract/evidence digest, disabled metadata, and recipe input. Each mutation must change F or fail validation.

- [ ] Run `npm test -- test/pilot/agy-inventory-witness.test.ts test/pilot/agy-inventory-store.test.ts` for local RED.

- [ ] Implement the exact hash preimages.

  Set `F = sha256(canonicalJson(core))`. Encode `canonicalJson({ version: 1, fingerprint: F, core }) + "\n"` as UTF-8. Set `W = sha256(bytes)`. Set `Q = sha256(canonicalJson({ recipeInputs: core.recipeInputs, inventoryFingerprint: F, inventoryContext: core.context }))`.

  F excludes its own identity, witness source, snapshot hash, Q, facts, timestamps, and physical-only phase/custody receipts. R retains argv, materializations, codexPolicy, and optional static agyHookShell, which are all current recipe-hash inputs. Do not invent future assignment identities. Actual loader-consumed instance paths, membership, bytes, and relevant PATH inputs must remain bound in the semantic core. A physical-only profile change can preserve F only after applicable exclusion is proven. Deep-copy inputs before encoding. Returned byte mutations must not alter retained store expectations.

- [ ] Implement exclusive content-addressed persistence.

  Implement `prepareAgyAuditDirectories(workspace)` as a mechanical custody helper. Validate/create exactly `.council`, `.council/control-audits`, and its `inventories`, `snapshots`, and `dispositions` directories, in parent-first order, with existing directory custody and mode 0700 requirements. Return no qualification or authority. Production may call this helper before final acquisition only after Task 6's separate live exclusion preflight. Synthetic clean-store tests need no provider qualification.

  Derive only `<real workspace>/.council/control-audits/inventories/<F>.json`. Validate existing components, owner, type, modes, and realpath. Create only exact missing project directories with mode 0700. Create the file exclusively with mode 0600. Verify the complete intended bytes before reporting a source. Existing files require bounded no-follow readback and exact equality. Never overwrite, repair, or follow a collision. Handle an EEXIST race by the same guarded equality check.

  Return `{ path, kind: "file", sha256: W }`. The store cannot save an audit, call disposition, promote facts, or prove bookkeeping exclusion. A partial failed write remains unusable. Do not delete or repair it automatically. Production preparation calls this store only after Task 5–6 qualification. Synthetic stores in unit tests confer no production authority.

- [ ] Add projection and corruption tests.

  Require exact ordered `(path, kind, sha256)` projection. Deduplicate producer inputs by `(path, kind)` while retaining graph edges. Reject duplicate, missing, extra, relocated, or conflicting witness records. A file and metadata source for the same ordinary path can both be valid. Reject unexpected ordinary sources and a changed source kind. Test changed F, changed W, oversized witness, symlinked parent/file, wrong owner/mode, partial file, collision, and interrupted persistence.

  Assert file W equals the existing `currentSourceDigest` result for a valid regular fixture. Test absence of credential and unrelated environment fields. A witness with unknown semantic decisions can pass integrity tests but cannot produce a verified startup fact. A fully specified synthetic core proves round-trip mechanics only.

  Add `creates a clean audit store without granting inventory authority`. Start without `.council/control-audits`. Assert the exact directory set, parent-first creation, guarded custody, and exclusive witness write/readback. Assert no fact promotion or native authority call. Encoding a supplied synthetic core tests integrity only. Task 6 separately tests semantic identity across this bootstrap and later bookkeeping writes.

- [ ] Run the same focused witness/store command and retain the GREEN receipt.

**Acceptance:** Stable integrity artifacts and exact binding. No production loader admission is delivered by this task.

## Task 4: Check exact physical materialization sets — ready after Tasks 2–3

**Owner:** Implementer. **Files:** Create `src/pilot/agy-materialization-state.ts` and `test/pilot/agy-materialization-state.test.ts`.

**Interfaces:** Consume `AgyRecipeInputs` and bounded readers. Produce:

```ts
type MaterializationDirectoryObservation = {
  path: string; observation: InventoryRead<DirectoryListing> };
type StaticMaterializationState =
  | { state: "absent" | "complete"; receipts: readonly ReadReceipt[];
      directoryObservations: readonly MaterializationDirectoryObservation[] }
  | { state: "unknown"; problems: readonly InventoryProblem[];
      directoryObservations: readonly MaterializationDirectoryObservation[] };
function inspectAgyMaterializationState(workspace: string,
  inputs: AgyRecipeInputs, budget: InventoryBudget): StaticMaterializationState;
```

The function has no phase parameter. It observes custody and contents only. It cannot decide whether loader normalization is valid. `directoryObservations` explicitly carries Task 2's full listing, absence, or unknown result with its receipts. Identities alone cannot replace a listing.

- [ ] Add failing tests for all absent, all exact complete, and partial static sets.

  Use the exact two existing paths: packet `.agents/agents/council-packet/agent.md` and packet `.council-profiles/<sha256(session)>/session-settings.json`. Bind intended content hashes. Check missing ancestors through verified existing parents. Never invent a future inode.

- [ ] Run `npm test -- test/pilot/agy-materialization-state.test.ts` for local RED.

- [ ] Implement the mechanical exact-set check.

  Require regular no-follow byte-identical files, current owner, expected real parents, and explicit recipe modes where supplied. Preserve existing mode requirements. Check component identities throughout each observation. Required missing directories carry exact creation requirements, rather than fabricated metadata. Existing ordinary roots retain stable recorded identity where custody requires it.

  Derive the affected parent set from each static material's parent through the requesting workspace, inclusive. Return one `directoryObservations` entry per distinct canonical path in sorted path order. Include complete empty listings as `present` with `value.entries: []`. Preserve absent and unknown observations explicitly. A missing observation or unknown listing prevents a successful exact-set result. Never present a partial listing as complete.

  Preserve every extra ordinary sibling in its parent's complete listing, including entries without a recognized extension. Reject extras inside the exact managed leaf directories and any unexpected descendant proposed as managed. Retain acquired directory observations even when the overall result is unknown. Do not hide ordinary siblings merely because a parent is shared.

  Task 5's `acquireAgyStartupInventory` consumes every `directoryObservations` result for physical custody and completeness checks. Root relevance is a separate evidence-qualified decision. Do not copy all parent listings into `InventoryCore.inventory.rootListings`. For an actual loader root, preserve its complete listing, including ordinary siblings and empty entries. Otherwise retain the full observation outside semantic F for custody checks. Absent/unknown results cannot become empty successful listings. Unknown loader relevance remains unknown. The helper supplies no loader selection, exclusion, or normalization authority.

- [ ] Add custody and normalization-separation tests.

  Reject one-present/one-absent sets, changed bytes, leaf/component links, wrong owner, explicit wrong mode, and directory replacement during inspection. Test an extra manifest, extra child, same-name type change, and a source reachable through another edge. None can disappear from a complete listing.

  Assert that an ordinary sibling in a shared parent appears with its exact name/type in `directoryObservations`. Assert that an empty existing parent has an explicit present observation with `entries: []`. Assert that a missing parent retains its absent observation and verified parents. Assert that an unknown overall result retains complete observations already obtained and the failed parent's unknown observation. Assert exact parent-path coverage, without duplicates or silent omissions.

  Assert no runtime `agy-hook-*` prefix is accepted as a static material. Assert an extra `instance-*.json` does not gain authority from its name. Test that both absent and complete physical results exist without issuing any loader completeness claim. Task 5 must separately authorize exact normalization before these states can share F.

- [ ] Run the same focused command and retain its GREEN receipt.

**Acceptance:** Independent physical checks work without a guessed loader rule. No wildcard profile or bookkeeping exclusion exists.

## Task 5: Implement source-qualified graph decisions — provisional

**Owner:** Coordinator for prerequisite disposition, then implementer. **Files:** Proposed `src/pilot/agy-loader-contract.ts`, `src/pilot/agy-startup-inventory.ts`, `test/pilot/agy-loader-contract.test.ts`, and `test/pilot/agy-startup-inventory.test.ts`.

**Prerequisites:** Tasks 2–4. The coordinator must identify evidence that qualifies every decision encountered by the intended production input. Do not repeat the supplied research. Unresolved groups do not need invented universal answers. They need either an applicable rule or proof that the condition cannot affect this input.

| Decision class | Current exact dependency and promotion condition |
| --- | --- |
| Paths and boundary | Release/binary-bound resolver/caller for an encountered relative, tilde, global, inherited, worktree, nested-repository, missing-cwd, or no-repository branch. Absolute paths or identical documented bases can avoid a particular conflict only when all applicable interpretations agree. Never union targets. |
| Selection/order/agent | Applicable root aliases, ancestor/manifest order, filter syntax, duplicate identity, and selected-agent translation. Current empty arrays do not establish `inheritCustomizations` or `inherit_user` defaults. A nonencountered collision need not be guessed, but inherited input membership must still be known. |
| Enablement | Exact applicable store/override schema and initializer branch. One-time seed and the variable-dependent initial disablement are verified corrections. Absent file, absent key, missing enabled, malformed state, collisions, and seed failures remain distinct unknowns until resolved. Do not seed or use manifest-only fallback. |
| Native components | Applicable marker selection, root hook parser, supported error behavior, and active MCP/rule/skill/bin contributions. Validator permutations do not qualify startup. Native root hooks differ from installation staging. |
| Normalization | Traversal/consumption for exact static outputs, packet ancestors, assignment profiles, transformed PATH, and witness/audit bookkeeping. Names alone prove nothing. Any assignment-specific consumed input needs binding or a new audit identity. |

**Interfaces:** Proposed `acquireAgyStartupInventory(input: AgyAcquisitionInput): AgyInventoryAcquisition`. Define `AgyAcquisitionInput = { context: AgyInventoryContext; recipeInputs: AgyRecipeInputs }`. Define `AgyInventoryAcquisition = { core: InventoryCore; qualification: "qualified" | "unknown"; problems: readonly InventoryProblem[] }` inside the inventory module. This return discriminant reports evaluated rules. No public function accepts it as a completeness credential.

Consume `StaticMaterializationState["directoryObservations"]` from Task 4 inside acquisition. Validate the exact derived physical parent set. Keep every complete listing available for custody. Project only evidence-qualified loader-relevant roots into semantic `rootListings`. Bind that decision to the applicable rule/evidence IDs and live discovery edges. For each actual loader root, preserve every entry and explicit empty listing. Preserve ordinary siblings, extra discovered paths, and alternate edges. A parent excluded from one discovery route remains included if another live edge selects it or its contents. An absent/unknown observation cannot become an empty successful listing. Unknown relevance blocks qualification. No caller-supplied physical state or completeness flag authorizes this projection.

`agy-loader-contract.ts` owns its production rule table privately. Each decision retains rule IDs, evidence digests, applicability, inputs, and unresolved alternatives. Production reconstruction calls the closed acquisition path, not a caller-provided graph or contract. Unit tests can exercise a separate synthetic rule fixture through module-local test substitution. No environment toggle, schema field, public constructor, or version allowlist admits that fixture in production.

- [ ] Resolve the applicable prerequisite rows against exact frozen evidence before promoting this task.

  Record encountered conditions and the rule that decides each one. For equivalent interpretations, record why every documented applicable interpretation gives the same target, membership, or ordering. Unknown alternatives remain unknown. An empty path manifest can avoid relative resolution while selected-agent inheritance remains unresolved.

- [ ] Add RED tables for known and unknown decision branches.

  Test absolute paths, identical bases, divergent relative targets, literal versus expanded tilde, filtered declarations, inheritance cycles, 32/33 inherited edges, and 128/129 ancestors. Test single versus colliding directory identities, explicit registry booleans, absent/malformed states, and configuration-variable dependent initialization. Never infer a seed from `disabled`.

- [ ] Implement typed graph acquisition from qualified decisions.

  Discover from actual execution cwd, not just requesting workspace. Retain all relevant roots and absences. Preserve provenance and duplicate edges. Preserve source/event/matcher order. Alphabetical listing serialization cannot resolve loader precedence. Inventory disabled metadata with the same guarded readers. Separate installed, enabled, selected, active, and unknown states.

  Add projection tests with identical physical parent coverage. A qualified custody-only parent remains outside semantic `rootListings`, while its complete physical observation remains checked. An actual loader root retains an ordinary sibling, an empty listing, and every extra discovered entry. An alternate declaration edge selecting previously excluded contents must add the relevant membership and change F. Unresolved relevance produces unknown. Directory names and profile/bookkeeping prefixes cannot decide any case.

  Parse supported native handler shapes rather than recursively treating arbitrary objects as active hooks. Preserve equivalent `startup-hook:` IDs. Unsupported MCP/rule/skill/bin startup contributions remain specifically unavailable. Only selected, enabled descriptors enter active effect/dependency extraction. Disabled commands do not acquire executable dependencies.

- [ ] Add active dependency and five-event tests to this task.

  Bind a supported interpreter and every literal script operand against a qualified command base. Reject an unbound relative operand, component/leaf link, script size at or above 262144 bytes, computed syntax, unproven transitive closure, and credential/endpoint dependencies. Do not add a general shell parser.

  Pass the complete active referencing descriptor set, including duplicates, to existing `agyHookShellApplicable`/`acquireAgyHookShellPolicy`. An extra unsupported active Orca reference must reject the whole set. A disabled counterpart remains metadata. Preserve unrelated generic dynamic-hook failures. A successful known-hook policy removes only its exact existing known dynamic-closure reason.

- [ ] Verify with `npm test -- test/pilot/agy-loader-contract.test.ts test/pilot/agy-startup-inventory.test.ts test/pilot/agy-hook-shell.test.ts`.

**Acceptance:** Only applicable evidence-bound decisions can yield qualified acquisition. If a prerequisite remains encountered and unresolved, keep this whole task provisional. Do not replace it with a fixed false or true implementation and close #3.

## Task 6: Connect preparation, adoption, and direct reuse — provisional

**Owner:** Implementer after coordinator prerequisite approval. **Files:** Create `src/pilot/agy-recipe-plan.ts`. Modify `src/pilot/agy-startup-inventory.ts`, `src/pilot/provider-controls.ts:63–365`, and `src/pilot/control-audit.ts:94–117`. Add focused tests in `test/pilot/control-audit.test.ts` and `test/pilot/provider-controls.test.ts`.

**Prerequisites:** Task 5 qualified for the input. Bookkeeping placement and exact source partition must be justified. Preserve all public signatures.

**Interfaces:** Extract the current AGY recipe construction into the proposed pure function `buildAgyRecipePlan(input: { selection: ModelSelection; version: string; workspace: string; executable: string; legacySettings: unknown; agyHookShell: ProviderRecipe["agyHookShell"] | null }): AgyRecipeInputs` in `agy-recipe-plan.ts`. Preserve current agent text, deny merging, argv, settings bytes, expected permission, and static policy. Invalid controlling settings remain unavailable. A caller's parsed settings are not live evidence by themselves.

Produce `reconstructAgyAuditInput(boundary: AuditSnapshot | ProviderRecipe): AgyAcquisitionInput | { problems: readonly InventoryProblem[] }` and `validateAgyInventoryBoundary(boundary: AuditSnapshot | ProviderRecipe): Promise<AgyBoundaryValidation>` in `agy-startup-inventory.ts`.

Define `AgyBoundaryValidation = { state: "verified"; core: InventoryCore; encoded: EncodedWitness; sources: readonly AuditSource[]; ordering: readonly string[]; effects: readonly string[]; unavailable: readonly string[]; recipeHash: string; guardedDigests: ReadonlyMap<string, string | null> } | { state: "unknown"; problems: readonly InventoryProblem[] }`. Key guarded digests by `canonicalJson([path, kind ?? "file"])`, not by path alone. The public validator takes no live-context, graph, phase, contract, or completeness argument.

An `AuditSnapshot` supplies workspace/route/version/executable and witness location expectations, but no selection or environment. Locate exactly one witness at its derived content address. Its strict selection can identify the requested allowed model. Recheck it through `selectionSchema` and the applicable contract. It cannot supply current HOME, PATH, agent text, or package recipe. A missing/ambiguous witness requires fresh preparation, not a default selection.

- [ ] Add lifecycle RED tests before modifying each boundary.

  Keep the Task 1 diagnostic, temporary configuration, and RED receipt unchanged outside `test/`. Add the maintained `rejects saved AGY reuse after an ignored root entry changes type` regression to `test/pilot/control-audit.test.ts`. Use that file's existing `./context-fixture.js` and `./fixtures.js` imports, the `../../dist/pilot/provider-controls.js` and `../../dist/pilot/control-audit.js` audit boundaries, and `new URL("./fixtures/agy-1.4.12-help.txt", import.meta.url)` for captured help. Exercise the actual new validator through the implemented internal fixture reconstruction seam. Require successful unchanged prepare/adopt/reuse before the mutation, then reject the same-name type change while every old source digest remains equal. Its positive unchanged control must have a complete synthetic graph, not a forged production version identity. Keep public production tests proving the synthetic fixture cannot be admitted by real rule selection.

  Add unchanged fixture prepare/adopt/reuse and complete no-effect cases. Retain the real `contextFixture` native authority sequence. A synthetic semantic fixture exercises integration mechanics only. Separate production applicable-rule tests from this synthetic positive control.

- [ ] Implement reconstruction without inspection recursion or provider invocation.

  Canonicalize current workspace components. Derive current packet cwd from live workspace. Read live `homedir()`, raw HOME presence/value, and relevant environment presence/value. Use the current wrapper child-environment projection. Bind forwarded PATH, HOME, TMPDIR, LANG, LC_ALL, TERM, and the constant auto-update setting. Keep base PATH distinct from assignment launch PATH. Do not capture unrelated variables.

  Resolve the current executable through current PATH and verify identity and bytes with applicable guarded custody. Re-read current selected-agent and settings sources. Rebuild current recipe using `buildAgyRecipePlan`. Compare it to expected saved inputs. Do not invoke `--help`, a diagnostic, or a provider to fill missing saved evidence. Bind version evidence to executable/contract identity. Missing reconstructible input returns a named unknown.

  Avoid a runtime import from inventory reconstruction to `provider-controls.ts` or `control-audit.ts`. Use type-only imports for audit types. The recipe builder imports types and pure helpers only. `provider-controls` may import acquisition and audit authority. `control-audit` may import the boundary validator. This direction prevents the existing inspection/disposition cycle.

- [ ] Implement read-only inspection and explicit preparation.

  Internal acquisition constructs the recipe/inventory without disposition. Inspection then performs its existing separate disposition step. An absent persisted witness produces `AGY_INVENTORY_WITNESS_PENDING`. Unknown semantic decisions remain unavailable, including initially verified startup facts. Bind the startup fact digest/detail to `auditHash`, even for zero effects.

  Before any bookkeeping bootstrap, perform a separate read-only qualification preflight from live inputs and applicable loader rules. Prove exclusion of the exact audit-directory footprint and the witness/snapshot/disposition writes that will follow. Check direct traversal, relevant ancestor membership, declaration targets, and alternate edges. A path name, successful directory creation, generic store helper, or caller flag cannot prove exclusion. If the required exclusion is unresolved, do not bootstrap on the assumption that it is harmless. Keep positive preparation provisional and unavailable.

  After exclusion is proven, call Task 3's `prepareAgyAuditDirectories(workspace)` before final inventory acquisition. Acquire the final live C/R/N after those exact directories exist. Include every resulting entry of any actual loader root. Persist only a complete qualified matching witness, then reacquire before saving its snapshot. Recheck after snapshot persistence as well. The separately proven rule must cover the exact later disposition write at adoption. Bootstrap and persistence create no effect authority. Diagnostic snapshots remain explicitly unavailable and cannot pass positive witness preparation. If the witness or another bookkeeping write changes consumed membership, return unknown rather than remove its entry, seek a hash fixed point, or claim reusable preparation.

  Add `prepares from a clean workspace after qualified bookkeeping bootstrap`. Start without the audit store. Assert preflight qualification, exact bootstrap, final acquisition, witness persistence, snapshot persistence, and post-write checks in that order. Under a justified exclusion rule, final acquisition and post-persistence F/Q/audit identity stay equal despite changed physical parent listings. Under consumed membership, the write must change semantic identity and reject this preparation. Under unresolved exclusion, assert unknown, no bootstrap, and no positive persistence. Add a declaration reaching the exact store through an alternate edge and require the consumed/unknown result.

- [ ] Implement source partition and guarded adoption/reuse validation before the raw loops.

  Ordinary files, metadata, and absences keep their current meanings. Exact static files and affected transitional ancestors are witness-only. They cannot also appear as raw absent/file/mutable-metadata records. Reject an invalid saved partition before comparisons. Never suppress a failed comparison or search for another witness after a mismatch.

  Qualified normalization adds only the recipe's exact intended file/directory name and type when physically absent. Complete existing materials must have the intended bytes and custody. Never drop another entry or another discovery edge. Required new directories retain path/creation requirements in the core, without a future inode. Their actual post-write identities stay in physical receipts. Keep ordinary root identities stable. If the applicable rule cannot justify this projection, return unknown.

  Recompute C, R, N, F, W, Q, the complete ordered sources, ordering, effects, unavailable, contract, executable, and version binding. Require exact snapshot equality for all corresponding fields. Require exactly one witness source. Use bounded receipts for inventory JSON and witness digests. The remaining ordinary sources use existing `currentSourceDigest`. Never reread a guarded source through the generic unbounded loop. Keep all native disposition checks after successful inventory validation.

  Reconstruction must pass Task 4's complete `directoryObservations` through physical custody checks and Task 5's qualified root projection. Test that an ordinary sibling and an explicit empty listing of an actual loader root survive into the compared graph. Test that a proven custody-only parent remains fully observed without being hashed as a loader root. Do not reduce physical observations to identity receipts or exclude an actual loader entry. Adoption and reuse do not repair or bootstrap missing bookkeeping to manufacture a match.

  Old AGY snapshots without the inventory contract cannot verify completeness. Preserve their bytes and return a fresh-preparation reason. Other routes keep existing behavior.

- [ ] Add the review-focus invalidation tests.

  Change live HOME while expected witness HOME stays fixed. Repeat for base PATH, raw HOME absence, relevant environment absence, executable bytes, selected-agent bytes, current package recipe output, order/filter, semantic digest, disabled hook bytes, and appeared absences. Adoption must reject and reuse must remain unverified. Spy on acquisition to prove no call to inspection, disposition, or provider process occurs inside reconstruction.

  Reject missing/duplicate/extra sources, raw transitional records, bad Q, misplaced witness, malformed witness, and altered native reference. Assert guarded JSON paths never reach unbounded digest reads. A synthetically complete fixture with unresolved production selected-agent or bookkeeping rules must still fail production admission.

- [ ] Run `npm run build`, then `npm test -- test/pilot/control-audit.test.ts test/pilot/provider-controls.test.ts`.

**Acceptance:** All three lifecycle boundaries reconstruct live evidence and preserve native authority. No source subset or saved self-assertion can pass. Unchanged production reuse remains conditional on actual applicable rules.

## Task 7: Enforce retained-recipe and post-materialization checks — provisional

**Owner:** Implementer. **Files:** Modify `src/pilot/provider-session.ts:16–58`. Add tests in `test/pilot/provider-session.test.ts` and existing hook-policy tests. Preserve `agy-hook-shell.ts:416–461` unless a separately reviewed narrow integration need is demonstrated.

**Prerequisites:** Tasks 5–6, including applicable static/profile/PATH/bookkeeping consumption rules. If profiles are loader inputs, bind their actual membership and effects. A changed assignment may require a fresh audit. Do not promise unchanged second-launch reuse without exact equivalence evidence.

**Interfaces:** Consume `validateAgyInventoryBoundary(recipe)` and `inspectAgyMaterializationState(workspace, inputs, budget)`. Preserve its complete `StaticMaterializationState["directoryObservations"]` for pre/post physical custody. Task 5's applicable rules determine semantic root projection. Consume the existing assignment-bound hook materializer unchanged. Preserve `runProviderSession`'s public signature and result.

- [ ] Add RED tests for retained recipe drift before spawn.

  Use the existing synthetic session fixture and a spawn spy for rejection cases. Assert zero spawn calls and no provider input for changed live context, extra inventory entries, malformed partition, absent witness, or different live package recipe. Add a witness that passes integrity while its selected-agent semantics remain unknown. It must not launch.

- [ ] Validate live inventory before ordinary raw source reads and before writing static materials.

  Check the same exact projection and guarded digests as adoption. Reject partial static state before any repair write. Preserve ordinary source loops and fact gates. Write only the current exact static set through the existing materializer. Use bounded content checks for inventoried static files and agent verification. A successful size check cannot lead to an unbounded reread.

- [ ] Reacquire and require complete physical state before spawn.

  Require all exact static files and parent custody. Where qualified normalization applies, absent and complete states must produce equal C, R, N, F, witness bytes, W, source arrays, ordering, effects, unavailable, contract, Q, audit hash, and disposition identity. Infer physical state from inspected files. No phase parameter or prior hash selection can force equality.

- [ ] Preserve and validate actual assignment hook custody before spawn.

  Reacquire the static hook policy. Use this assignmentHash and directory in `instantiateAgyHookShellPolicy`. Check actual report/material identities and exact returned launch PATH. Keep full physical parent observations across instance creation. Reconstruct semantic post-instance inputs through Task 5's qualified relevance rules. Bind every consumed profile input and relevant PATH value. Keep a proven custody-only profile parent outside semantic `rootListings`, while retaining actual assignment custody checks. Do not use a previous instance's report or fabricated future inode. Unknown PATH/profile participation blocks launch even when static files match.

- [ ] Add exact-set and multi-assignment tests to this task.

  Reject one missing static file, altered agent/settings bytes, replaced parent, wrong explicit mode, symlink, extra manifest, extra managed entry, and an extra source reached through another loader edge. Reject mutation between precheck and materialization or postcheck and final custody observation. Test normal and cancellation assignments with distinct actual instance bindings.

  Add `projects two distinct assignment profiles according to qualified membership`. Create two actual fixture assignments with distinct assignmentHash and directory values. Preserve the first profile when the second is created. Assert distinct producer instance/report bindings and verify each exact launch PATH, source bytes, and custody. Observe the changed complete physical `.council-profiles` listing. Under justified profile and PATH exclusion, equal effective semantic inputs preserve C/R/N/F/W/Q, audit hash, and disposition identity without copying the second report into the first assignment. Physical observations can differ.

  Under a rule that consumes profile artifacts or the changed launch PATH, bind those exact relevant inputs. Their change must change F and audit identity, so the prior disposition cannot authorize reuse. Require a fresh matching audit or reject launch. If current preparation cannot bind the consumed instance inputs, return unknown. Under unresolved membership, expect unknown. Add an alternate edge into an otherwise excluded profile and preserve every entry of the resulting actual loader root. Never exempt `.council-profiles`, `agy-hook-*`, or audit directories by prefix. Synthetic rules prove these integration mechanics only.

- [ ] Run `npm test -- test/pilot/provider-session.test.ts test/pilot/agy-hook-shell.test.ts` after rebuilding if a test imports dist.

**Acceptance:** Retained recipes cannot bypass live reconstruction. Complete static state and actual assignment custody pass before spawn. These tests establish software behavior only.

## Task 8: Verify the increment and preserve the campaign gate — conditional final gate

**Owner:** Coordinator, with fresh independent reviewers under the existing SDD ledger and fix budgets. This plan author does not dispatch reviewers.

**Files:** Task-local implementation evidence and existing SDD progress ledger. Keep this version-bound plan immutable. Track checkboxes in the workflow ledger or a separate progress copy.

- [ ] Run one consolidated affected-interface gate after eligible tasks pass.

  Run `npm run build`. Run `npm test -- test/pilot/inventory-io.test.ts test/pilot/agy-inventory-witness.test.ts test/pilot/agy-inventory-store.test.ts test/pilot/agy-materialization-state.test.ts test/pilot/agy-loader-contract.test.ts test/pilot/agy-startup-inventory.test.ts test/pilot/provider-controls.test.ts test/pilot/control-audit.test.ts test/pilot/provider-session.test.ts test/pilot/agy-hook-shell.test.ts`. Run `npm run typecheck` once. Omit not-yet-implemented provisional suites only from a clearly labeled mechanics checkpoint, never from final #3 acceptance.

  Keep project `vitest.config.ts` unchanged. Its `test/**/*.test.ts` include excludes the preserved Task 1 diagnostic outside `test/`. A mechanics checkpoint can therefore use maintained-suite discovery without a new parked failure or skip. Keep the expected diagnostic RED receipt distinct from mechanics GREEN and the existing #8 suite issue. The Task 6 maintained regression remains required for full #3 acceptance.

- [ ] Run the existing full-campaign `npm test` gate once at the designated campaign point.

  Keep the existing #8 suite issue separate. Record its exact failure if it persists. Do not repair #8 here, rewrite fixtures to hide it, or report the full suite as passed. Do not repeat package-wide tests after every task. Repeat only affected checks after a meaningful change or unresolved failure.

- [ ] Inspect source/hash receipts, semantic prerequisites, and frozen results before acceptance.

  Map AC1 to Task 1 and its ported regression. Map AC2–AC3 to Task 5. Map AC4 to Tasks 2–5. Map AC5 to Tasks 3–7. Map AC6 to Tasks 5–8. Confirm qualified live rules, complete source coverage, disabled metadata, active effects, immutable witness, and all four lifecycle boundaries. Synthetic positive cases cannot satisfy the production rule gate.

  Confirm the R1 tests at their owner tasks: clean store mechanics in Task 3, complete physical parent observations in Task 4, qualified semantic projection in Task 5, clean preparation/bootstrap ordering in Task 6, and two distinct assignment profiles in Task 7. Require justified-exclusion equality, consumed-change identity drift, and unknown membership refusal. No actual loader-root entry or alternate edge may disappear to obtain equality. Full-parent physical observations alone cannot qualify semantic membership.

- [ ] Obtain frozen-plan review, then actual-change review at their existing workflow gates.

  The coordinator arranges fresh Astra Ultra supplemental review and fresh Argon high cross-family review against identical frozen plan bytes. Preserve their independent judgments. Implementation review must inspect actual authored bytes and tests. Self-review does not fill either independent seat. Resolve findings through evidence and the established fix budget.

**Acceptance:** Full #3 completion requires all applicable provisional conditions to close, required tests, and independent acceptance. Ready mechanics alone are a useful partial deliverable. They do not replace the requested full inventory or advance #4/#7 operational acceptance.

## Bounded execution and evidence receipts

All commands above are future execution instructions. None was run during this authoring assignment.

Use cwd `/Users/aaat/.codex/worktrees/council-issue3-inventory/the-council`. Each command receipt records argv, cwd, start/end UTC, source SHA-256 manifest, exit code, test selection, assertion summary, and log SHA-256. Build receipts include current dist hashes for imported audit modules. Do not treat stale dist as source evidence.

Before Task 1 runs checks, create task-local `implementation-evidence/bounded-command.py`. Its interface is `python3 <script> --seconds <N> --log <exact-task-log> -- <argv...>`. It starts only that command in an owned process group, captures bounded log output, and enforces the deadline. On timeout it terminates that group, waits, escalates only for its still-owned group, and records timeout separately from a test failure. It performs no process census and never stops an unrelated session. A timeout does not count as RED or GREEN. Review this small runner before use.

Use 120 seconds for build/typecheck, 90 seconds for a focused new-module suite, 120 seconds for an existing focused integration command, 300 seconds for the consolidated affected gate, and 600 seconds for the designated full campaign gate. Existing per-test fixture timeouts remain active. Report incomplete settlement rather than inventing success. No automatic retry broadens scope or permissions.

For example, the exact baseline pair through that runner is:

```sh
python3 .superpowers/sdd/2026-11-01-issue-3-loader-witness/implementation-evidence/bounded-command.py --seconds 120 --log .superpowers/sdd/2026-11-01-issue-3-loader-witness/implementation-evidence/red-build.log -- npm run build
python3 .superpowers/sdd/2026-11-01-issue-3-loader-witness/implementation-evidence/bounded-command.py --seconds 120 --log .superpowers/sdd/2026-11-01-issue-3-loader-witness/implementation-evidence/baseline-red.log -- npm test -- --config .superpowers/sdd/2026-11-01-issue-3-loader-witness/implementation-evidence/vitest.baseline-red.config.ts -t 'rejects saved AGY reuse after an ignored root entry changes type'
```

Rollback evidence records exact changed files and prior hashes. New witness files are immutable and cannot overwrite an approved artifact. A failed preparation cannot create authority. Preserve historical snapshots and dispositions. Do not delete task or user data, revert unrelated work, or commit from this authoring assignment.

## Author self-review and language note

The approved design maps to Tasks 1–8. Ready mechanics include complete bounded listings, absences, canonical bytes, source/recipe/context binding, exclusive persistence, and physical exact-set checks. Provisional work retains all preparation/adoption/reuse/launch requirements and active dependency custody. Unknown loader decisions are explicit dependencies, not hidden defaults.

Types introduced in one task are named at their consumers. No public schema expansion is planned. The five review-focus classes have owner tests. Task 1 uses the actual fixture and an assertion on existing production behavior. Its metadata and source-equality preconditions distinguish a real counterexample from a fixture failure. New-module collection failures cannot replace it.

This is an STE Issue 9-oriented candidate. Technical literals follow current source and the approved design. The official dictionary and governed project terminology are unavailable. Vocabulary, approved meanings, and full language conformance remain unverified.
