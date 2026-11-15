# Design Specification: Issue #102 — Headless Workspace Resilience, Evidence-Gated Recovery, & Attributed Retry Diagnostics

**Status**: Approved Design Specification (incorporating all final amendments before TDD planning)
**Branch**: `fix/issue-102-live-cwd-resilience`
**Issue**: [#102](https://github.com/arduinitavares/the-council/issues/102)

---

## 0. Evidence Provenance, Preserved Invariants, & Compatibility Scope

Configured limits, observed call durations, incomplete attempts, source-verified behavior, and local CLI observations are kept strictly distinct:

- **Saved Run Bundle Facts (`.council/runs/run-1794534519522-a561c5.js` & `run-1794535320119-71d307.js`)**:
  - **`run-1794534519522-a561c5`** (`verdictKind: "Aborted"`):
    - `argon-voter` (`20291ms`, `21027ms`) and `opus-voter` (`10861ms`, `9809ms`) recorded `exitCode: 0`, `outcome: "error"`, and were excused with `[InvalidResponseError] Model output was empty or not a string`.
    - `carbon-voter` recorded an Attempt-0 failure at `119522ms` (`tools: "read-only"`, `exitCode: 1`) followed by a completed Attempt-1 retry timeout at `90270ms` (`tools: "none"`, `exitCode: 1`, against the `90000ms` retry ceiling).
    - `judge-astra` (`gpt-6-astra (max)`, configured default Attempt-0 timeout `240000ms`, `totalSeatBudgetMs: 480000`) recorded **one** completed `providerCalls` entry (`tools: "read-only"`, `exitCode: 1`, `durationMs: 239289` — ~239.3s, `outcome: "error"`), followed by final saved Judge state `status: "thinking"`, `retries: 1`. The bundle records an **incomplete** Judge retry in flight when the run aborted — **not** a completed second `90000ms` Judge timeout.
  - **`run-1794535320119-71d307`** (`verdictKind: "Dissent Report (Below Quorum)"`, configured `timeoutMs: 120000`, `totalSeatBudgetMs: 180000`):
    - `sol-voter` (`119304ms` `read-only` -> `60018ms` `none`) and `grok-voter` (`119231ms` `read-only` -> `60026ms` `none`) exhausted their `180000ms` seat budgets on tool-free retries; `judge-astra` stayed `status: "idle"`, `retries: 0` because quorum collapsed during Deliberation.
- **Repository Source-Verified Facts**:
  - [cli-runner.js](file:///Users/aaat/projects/the-council/src/harness/cli-runner.js#L4024-L4221) gates isolated workspace copies only on `hasDotCouncilEntry(explicitCwd)` (bypassing copy isolation when `.codegraph/` exists without `.council/`), copies `.codegraph/` inside `copySafeWorkspace`, and returns uncanonicalized `tempSafeCwd` as `effectiveCwd`.
  - [antigravity.js](file:///Users/aaat/projects/the-council/src/harness/antigravity.js#L126-L138), [codex.js](file:///Users/aaat/projects/the-council/src/harness/codex.js#L139-L150), and [cursor.js](file:///Users/aaat/projects/the-council/src/harness/cursor.js#L125-L137) resolve `effectiveCwd` via `[cwd, callerContext?.cwd, participant?.cwd, state?.cwd, this.cwd, this.config?.cwd].find((c) => typeof c === 'string' && c.trim())?.trim()`.
  - [validator.js](file:///Users/aaat/projects/the-council/src/proofs/validator.js#L19-L53) (`validateProof`) checks structure only (non-empty strings + `VALID_PROOF_KINDS`), currently accepting `../outside.js:3` and `.council/state.json:1`.
  - [adapter.js](file:///Users/aaat/projects/the-council/src/harness/adapter.js#L57-L69) sets `QuotaExhaustionError.isRetryable = true`, and [council-engine.js](file:///Users/aaat/projects/the-council/src/engine/council-engine.js) permits bounded retries unless `error.isRetryable === false`.
  - [adapter.js](file:///Users/aaat/projects/the-council/src/harness/adapter.js#L607-L627), [antigravity.js](file:///Users/aaat/projects/the-council/src/harness/antigravity.js#L71-L74), [codex.js](file:///Users/aaat/projects/the-council/src/harness/codex.js#L78-L81), [cursor.js](file:///Users/aaat/projects/the-council/src/harness/cursor.js#L67-L70), and [council-engine.js](file:///Users/aaat/projects/the-council/src/engine/council-engine.js#L763-L801) match bare `/\b429\b/` and `/\b(?:401|403)\b/`, which falsely classify harmless warnings containing numeric PIDs such as `(node:429)`, `(node:401)`, and `(node:403)` as quota or authentication failures.
  - [council-engine.js](file:///Users/aaat/projects/the-council/src/engine/council-engine.js) duplicates retryability checks across 7 sites and unconditionally strips `tools` to `'none'` on `TimeoutError` without checking whether the phase input is self-contained, and allows subsequent non-timeout retries even after a single tool-removing recovery already occurred.
  - [live-watcher.js](file:///Users/aaat/projects/the-council/src/visualizer/live-watcher.js#L380-L479) and `_buildBundleScript` ([live-watcher.js](file:///Users/aaat/projects/the-council/src/visualizer/live-watcher.js#L932-L996)) seed `baseSeats`/`baseJudge` from `data.currentState`, so fields omitted from sparse `seatChanges` / `judgeState` deltas leak final-state values backward into earlier replay steps.
- **Local Live `agy` Probe Observations (`task-4108`, Non-Contractual External CLI Evidence)**:
  - Probing the installed `agy` binary in `os.tmpdir()` observed: `agy models` listing `{gemini-4-argon,gemini-4-carbon,claude-opus-5-5,claude-sonnet-5-5}-{low,medium,high}`; `warning: --mode plan has no effect while slash command expansion is disabled.` on `stderr` during clean `exitCode: 0`; native file reads succeeding inside canonicalized `os.tmpdir()`; and headless `Bash` calls auto-denied under `denied_actions` with `response: ""`. Because external CLI payloads can change across versions, parser checks are schema-tolerant and never assume prompt text prevents tool calls.
- **Preserved Contracts & Explicitly Identified Test Adjustments**:
  - Preserve **Issue `#90`**, **Issue `#95`**, **Issue `#96`**, and **Issue `#97`** contracts and leave unstaged [configs/best-of-families.json](file:///Users/aaat/projects/the-council/configs/best-of-families.json) untouched.
  - **Explicit Legacy Test Fixture Adjustments (10 single-retry `TimeoutError` fixtures)**:
    Because tool-removing recovery (`read-only -> none`) is now refused by default unless explicitly attested under `selfContainedInput`, the following pre-existing unit test fixtures that test budget clamping, wave concurrency, rebuttal timeout stripping, or live-watcher step deltas via synthetic `read-only -> none` `TimeoutError` mocks will opt into `selfContainedInput` (preserving their original assertions while keeping production defaults strictly conservative):
    1. [issue-83-judge-budget-concurrent-retries.test.js](file:///Users/aaat/projects/the-council/test/unit/issue-83-judge-budget-concurrent-retries.test.js#L12-L185) (`conceptualNoExternalVerification: true`; note line 273 starts `voter-0` with default `votingTools: 'none'`).
    2. [issue-89-engine-judge-context.test.js](file:///Users/aaat/projects/the-council/test/unit/issue-89-engine-judge-context.test.js#L970-L1029) (`conceptualNoExternalVerification: true` for `JUDGE_AUDIT_SYNTHESIS`).
    3. [live-watcher.test.js](file:///Users/aaat/projects/the-council/test/unit/live-watcher.test.js#L735-L802) (`conceptualNoExternalVerification: true`).
    4. [engine.test.js](file:///Users/aaat/projects/the-council/test/unit/engine.test.js#L924-L1220) (`conceptualNoExternalVerification: true` for the 3 retry-bounding tests at lines 924, 1068, 1135).
    5. [challenger-m3-concurrency.test.js](file:///Users/aaat/projects/the-council/test/unit/challenger-m3-concurrency.test.js#L617-L685) (`conceptualNoExternalVerification: true`).
    6. [challenger-m5-1-stress.test.js](file:///Users/aaat/projects/the-council/test/unit/challenger-m5-1-stress.test.js#L517-L660) (`conceptualNoExternalVerification: true` on lines 517, 608).
    7. [challenger-m5-2-stress.test.js](file:///Users/aaat/projects/the-council/test/unit/challenger-m5-2-stress.test.js#L485-L545) (`conceptualNoExternalVerification: true`).
    8. [challenger-m5-it2-1-stress.test.js](file:///Users/aaat/projects/the-council/test/unit/challenger-m5-it2-1-stress.test.js#L549-L725) (`2c` at line 549, `2d` at line 638).
    9. [challenger-m7-1-stress.test.js](file:///Users/aaat/projects/the-council/test/unit/challenger-m7-1-stress.test.js#L264-L505) (`1.4` at line 264, `2.1` at line 345, `2.2` at line 428).
    10. [issue-85-rebuttal-downshift.test.js](file:///Users/aaat/projects/the-council/test/unit/issue-85-rebuttal-downshift.test.js#L981-L1065): attaches `cwd: tmpDir` on Round 2 rebuttal (`tools: 'read-only'` -> `'none'`). Because `effectiveCwd !== undefined` rejects `conceptualNoExternalVerification`, this fixture supplies `evidence: [{ id: 'E1', label: 'Rebuttal fixture', source: 'rebuttal-spec.md', text: 'Self-contained rebuttal fixture.' }]` and `selfContainedInput: { phases: ['DELIBERATION'], roundScope: 'all_rounds', coveredArtifacts: [{ source: 'rebuttal-spec.md', evidenceId: 'E1', coverage: 'complete_artifact' }] }`.
  - **Multi-Retry Tests Impacted by Single-Tool-Free-Recovery Rule (`§1` & `§2`)**:
    1. [challenger-m7-1-stress.test.js](file:///Users/aaat/projects/the-council/test/unit/challenger-m7-1-stress.test.js#L175-L262) (`1.3`): set `tools: 'none'` on `multi-retry-seat` so it continues verifying 3-step cumulative phase budget clamping (`[100000, 65000, 20000]`) without invoking tool-removing recovery.
    2. [voting.test.js](file:///Users/aaat/projects/the-council/test/unit/voting.test.js#L355-L420) and [challenger-m5-it2-1-stress.test.js](file:///Users/aaat/projects/the-council/test/unit/challenger-m5-it2-1-stress.test.js#L734-L814) (`2e`): opt into `selfContainedInput` (`VOTING`) so Attempt 1's `TimeoutError` enters the single tool-free recovery on Attempt 2 (`tools: 'none'`), and update assertions to enforce that when Attempt 2 fails with `InvalidResponseError`, recovery terminates immediately after Attempt 2 (`calls.length === 2`, seat excused without a 3rd attempt despite `maxRetriesPerSeat: 2`), alongside a companion check that `votingTools: 'none'` from Attempt 0 (`toolFreeRecoveryUsed === false`) still completes multi-retry (`QuotaExhaustionError -> InvalidResponseError -> accept`) with sticky `tools: 'none'`.

---

## 1. Evidence Readiness & Shared Adapter Workspace Resolution

Every recovery transition that removes tools (`removesTools === true`, i.e., `originalAttemptTools !== 'none' && nextTools === 'none'` on **either `TimeoutError` or `HeadlessToolDeniedError`**) is **refused by default** unless an **explicit caller-attested self-contained-input contract** covers the required claims **and** dependency extraction finds zero missing workspace, line-range, or external verification dependencies.

### Why Heuristics & Filename Matching Do Not Prove Sufficiency (Caller-Attested Boundary)
- **Same-file partial/irrelevant excerpts**: `[E1]` with `source: "src/auth.js"` containing only a copyright header matches the filename `src/auth.js` while omitting token-expiry logic elsewhere in `src/auth.js`.
- **`[E#]` prose mentions**: `topic` mentioning `[E1]` ("Using `[E1]`, verify token expiry in `src/auth.js`") does not establish that `[E1]` contains all material required to verify the claim.
- **External verification dependencies**: `read-only` turns without `cwd` may still require verifying HTTP/HTTPS URLs, specifications, or external benchmarks in `topic`, `openObjections`, or `roundProofs`.
- **Rule (Caller-Attested Completeness + Negative Veto)**: Semantic completeness under `selfContainedInput` is **caller-attested** (via `coveredArtifacts` / `conceptualNoExternalVerification`). Dependency extraction (`extractVerificationDependencies`) detects known omissions as a **strict negative veto** and does **not** independently prove semantic completeness.

### Step 1: Shared Original-Attempt Workspace Resolution
Extract a single shared helper `resolveAttemptExecutionWorkspace({ role, phase, participant, state, tools, cwd, callerContext, adapter })` in [src/harness/adapter.js](file:///Users/aaat/projects/the-council/src/harness/adapter.js) matching [antigravity.js](file:///Users/aaat/projects/the-council/src/harness/antigravity.js#L126-L138), [codex.js](file:///Users/aaat/projects/the-council/src/harness/codex.js#L139-L150), and [cursor.js](file:///Users/aaat/projects/the-council/src/harness/cursor.js#L125-L137) verbatim:
- `isVoting = phase === 'VOTING' || phase === 'confirming'`.
- `effectiveTools`:
  - `'none'` when `tools === 'none' || callerContext?.tools === 'none'`,
  - else for `role === 'judge'`: `tools ?? callerContext?.tools ?? participant?.tools ?? 'read-only'`,
  - else for `role === 'seat'`: `tools ?? callerContext?.tools ?? (isVoting ? participant?.votingTools ?? participant?.tools : participant?.tools) ?? 'read-only'`.
- `configuredWorkspaceCwd` (resolved **before** `effectiveTools === 'none'` masking, skipping empty/whitespace strings):
  `[cwd, callerContext?.cwd, participant?.cwd, state?.cwd, adapter?.cwd, adapter?.config?.cwd].find((c) => typeof c === 'string' && c.trim())?.trim()`.
- `effectiveCwd = effectiveTools === 'none' ? undefined : configuredWorkspaceCwd`.
- Also fix `CouncilEngine.prototype.initRoster` ([council-engine.js](file:///Users/aaat/projects/the-council/src/engine/council-engine.js)) to resolve `[seat.cwd, this.config.cwd].find((c) => typeof c === 'string' && c.trim())?.trim()` so `seat.cwd: ""` does not shadow a non-empty `config.cwd`.

`AntigravityAdapter`, `CodexAdapter`, `CursorAdapter`, and `MockAdapter` call `resolveAttemptExecutionWorkspace` directly in `executeSeat` and `executeJudge` and record `{ effectiveTools, effectiveCwd, configuredWorkspaceCwd }` onto `callerContext._invocationMeta` during execution. `_planParticipantRecovery` reads that exact captured record (or calls the identical helper with the original attempt's dispatch arguments if a mock threw before adapter entry), **before** clearing `cwd` or changing `tools`.

### Step 2: Non-Tool-Removing Retries, Single Tool-Free Recovery Limit, & Tool-Removing Recoveries
1. **Single Tool-Free Recovery Enforced Across All Subsequent Error Types**:
   - Track `toolFreeRecoveryUsed` per participant per phase (reset on round/phase transitions alongside `retries`).
   - Once a participant enters a tool-removing recovery (`originalAttemptTools !== 'none' && nextTools === 'none'`), set `toolFreeRecoveryUsed = true` on that participant for the rest of that phase.
   - Any subsequent failure on that participant in that phase — including **`InvalidResponseError`**, **`QuotaExhaustionError`**, **`TimeoutError`**, **`HeadlessToolDeniedError`**, or **retryable `HarnessExecutionError`** — MUST terminate immediately (`canRetry: false`, `terminationKind: 'tool_free_already_used'`) even when `maxRetriesPerSeat > 1` or `maxJudgeRetries > 1`.
   - Participants that have **not** used a tool-removing recovery (`toolFreeRecoveryUsed === false`, such as `tools: 'none'` from Attempt 0 or `read-only` turns hitting `QuotaExhaustionError`/`InvalidResponseError`) retain normal bounded retries up to `maxRetries` within remaining phase budget.

2. **Non-Tool-Removing Retries (`removesTools === false` & `toolFreeRecoveryUsed === false`)**:
   - **`QuotaExhaustionError`, `InvalidResponseError`, or retryable `HarnessExecutionError`**: `nextTools` stays equal to `originalAttemptTools`; no tools are removed.
   - **Already-Tool-Free `TimeoutError` (`originalAttemptTools === 'none'` on Attempt 0, e.g., `seat.tools: 'none'`, Round 2+ `rebuttalTools: 'none'`, or default `VOTING` `votingTools: 'none'`)**:
     - Requires only phase-specific structural inputs:
       - `DELIBERATION` Round 1: non-empty `topic` (does **not** require `candidate`).
       - `DELIBERATION` Round 2+: `previousCandidate !== null` and `openObjections.length > 0`.
       - `JUDGE_AUDIT_SYNTHESIS`: `roundProofs.length > 0` (does **not** require `candidate`).
       - `VOTING`: `candidate !== null`.
   - **Already-Tool-Free `HeadlessToolDeniedError` (`originalAttemptTools === 'none'`)**: always refused (`canRetry: false`, participant attempted denied tool execution despite `tools: 'none'`).

3. **Tool-Removing Recoveries (`removesTools === true`: `originalAttemptTools !== 'none' && nextTools === 'none'` on `TimeoutError` or `HeadlessToolDeniedError`)**:
   Requires **both** (A) an **Explicit Caller-Attested Self-Contained-Input Contract** and (B) **Zero Dependency-Extraction Vetoes**:

   - **(A) Explicit Caller-Attested Self-Contained-Input Contract (`config.selfContainedInput` / `state.selfContainedInput`)**:
     - Default: `null` (disabled — unannotated `evidence`, `evidence.length > 0`, matching `source` filenames, `[E1]` prose mentions, `roundProofs.length > 0`, and absence of `cwd` **never** satisfy this contract).
     - Structured schema:
       ```js
       {
         phases: Array<'DELIBERATION' | 'JUDGE_AUDIT_SYNTHESIS' | 'VOTING'>,
         roundScope?: 'round_1_only' | 'all_rounds', // default 'round_1_only'
         coveredArtifacts?: Array<{
           source: string,     // canonical workspace-relative path or exact URL
           evidenceId: string, // matching [E#] item id with non-empty text
           coverage: 'complete_artifact' | { startLine: number, endLine: number }
         }>,
         conceptualNoExternalVerification?: boolean // valid ONLY when effectiveCwd === undefined, zero dependencies exist in (B), and errorClass === 'TimeoutError'
       }
       ```
     - The current `phase` must be listed in `phases`, and if `round > 1`, `roundScope` must explicitly equal `'all_rounds'`.
     - When `effectiveCwd !== undefined` on the original attempt, `conceptualNoExternalVerification` is rejected; at least one `coveredArtifacts` entry backed by a non-empty `[E#]` item must exist.

   - **(B) Phase-Specific Dependency Extraction Veto (`extractVerificationDependencies`)**:
     - Scans phase-required inputs (`topic` + `clarifications` in Delib R1; `topic` + `openObjections` + backing proofs in Delib R2+; `roundProofs` + `openObjections` in Judging; `candidate` + `admittedProofs` + `openObjections` in Voting) to extract:
       1. `workspaceFileDeps`: normalized workspace-relative file paths + optional `{ startLine, endLine }` ranges (or `'unbounded'` when no line range is given).
       2. `workspaceBroadDeps`: directory/glob/repo-wide targets (`src/engine/`, `src/**`) or local `kind: 'check'` command/repo claims.
       3. `externalDeps`: HTTP/HTTPS/`file://` URLs, external standards/endpoints, or `kind: 'benchmark' | 'check'` external sources.
     - **Any of the following vetoes tool-free recovery (`ready: false`)**:
       - Phase prerequisites missing (`DELIBERATION` R2+ lacking `previousCandidate` or `openObjections`; `JUDGE_AUDIT_SYNTHESIS` with `roundProofs.length === 0`; `VOTING` lacking `candidate` or `admittedProofs`).
       - `workspaceBroadDeps.size > 0`, OR (`phase === 'DELIBERATION' && round === 1 && effectiveCwd !== undefined && workspaceFileDeps.size === 0 && (!Array.isArray(contract.coveredArtifacts) || contract.coveredArtifacts.length === 0)` — wait: if `workspaceFileDeps.size === 0` with `effectiveCwd !== undefined` in Delib R1, open-ended workspace exploration cannot be certified without explicit file coverage or explicit `workspaceFileDeps` covered in `coveredArtifacts`; specifically when `effectiveCwd !== undefined && phase === 'DELIBERATION' && round === 1 && workspaceFileDeps.size === 0`, refuse open-ended repo exploration!).
       - Any `dep` in `workspaceFileDeps` lacks a `coveredArtifacts` entry (backed by a non-empty `[E#]` item) for that exact file whose `coverage` is `'complete_artifact'` (required when `dep` is `'unbounded'`, rejecting line-limited/header excerpts like `1-5` for whole-file claims!) or `{ startLine, endLine }` strictly enclosing `dep`'s cited lines (`startLine <= dep.startLine && endLine >= dep.endLine`).
       - Any `ext` in `externalDeps` lacks a `coveredArtifacts` entry with `coverage: 'complete_artifact'` and non-empty `[E#]` text for that exact normalized URL/source.

### Step 3: Explicit Evidence-Access Failure Termination
When `ready === false`, `_planParticipantRecovery` returns `canRetry: false`, `terminationKind: 'evidence_access_failure'`, preserving the primary `errorClass` (`'TimeoutError'` or `'HeadlessToolDeniedError'`) and excusing/terminating with:
`Tool-free recovery refused (insufficient self-contained evidence: <vetoOrContractReason>): <primaryFaultReason>`.

---

## 2. Centralized Recovery Decision & Error Taxonomy

### Single Authority: `CouncilEngine.prototype._planParticipantRecovery`
Replace all 7 inline retryability checks in [council-engine.js](file:///Users/aaat/projects/the-council/src/engine/council-engine.js) with `_planParticipantRecovery`, evaluated in this exact precedence order:
1. **Non-Retryable Check**: `!_isRetryableError(error)` -> `canRetry: false, terminationKind: 'non_retryable'` (preserves non-retryable `AuthenticationError`, `AbortError`, and default `HarnessExecutionError` while keeping Issue `#90` `FORBIDDEN_STATE_ACCESS` retryable contract intact).
2. **Retry Cap Check**: `retries >= maxRetries` -> `canRetry: false, terminationKind: 'retries_exhausted'`.
3. **Single Tool-Free Recovery Limit (All Subsequent Error Types)**: `toolFreeRecoveryUsed === true` -> `canRetry: false, terminationKind: 'tool_free_already_used'`, terminating immediately regardless of whether the subsequent failure is `InvalidResponseError`, `QuotaExhaustionError`, `TimeoutError`, `HeadlessToolDeniedError`, or retryable `HarnessExecutionError`.
4. **Remaining Budget Check**: `remainingBudget < minViableBudgetMs` (`Math.min(5000, Math.floor(totalBudgetMs * 0.1))`) -> `canRetry: false, terminationKind: 'budget_exhausted'`.
5. **Tool Transition & Evidence Readiness**:
   - Only `TimeoutError` and `HeadlessToolDeniedError` set `nextTools = 'none'`; `QuotaExhaustionError`, `InvalidResponseError`, and retryable `HarnessExecutionError` preserve `originalAttemptTools` (`removesTools = false`).
   - Evaluate §1 against the original attempt's `_invocationMeta` / `resolveAttemptExecutionWorkspace` **before** clearing `cwd` or changing `tools`; if `!ready`, return `canRetry: false, terminationKind: 'evidence_access_failure'`.
6. **Effort Fallback Gate (Eligible Errors Only)**:
   - `isEffortFallbackEligible = errorClass === 'TimeoutError' || errorClass === 'HeadlessToolDeniedError'`.
   - When `config.retryEffortFallback === true && isEffortFallbackEligible`, run §5's `CONFLICTING_MODEL_EFFORT` check, `'medium'` cap (`resolveRetryModelAndEffort`), and capability check (`validateRetryFallbackCapability`); if unsupported or conflicting, return `canRetry: false, terminationKind: 'unsupported_fallback'`.
   - Retries for `QuotaExhaustionError`, `InvalidResponseError`, and retryable `HarnessExecutionError` keep `(requestedModel, requestedEffort)` unchanged (`fallbackApplied: false`).
7. **Approved Retry**: return `canRetry: true` with `nextTools`, `setsToolFreeRecoveryUsed: removesTools`, `retryTimeoutMs`, and full `retryDiagnostics`.

### Unified Engine Call Sites & Issue `#95` Sibling Conservation
- Deliberation Wave-0 `catch`, Deliberation retry-wave `catch`, Voting Wave-0 `catch`, and Voting retry-wave `catch` increment `unrecoverable*Faults` whenever `!plan.canRetry` and abort wave stragglers as soon as `activeCount - unrecoverableFaults < state.minQuorum`.
- `_willSeatFaultExcuseAndCollapseQuorum` consumes the exact same `plan`; when `!plan.canRetry` and excusing `seatId` drops active seats below `minQuorum`, [council-engine.js](file:///Users/aaat/projects/the-council/src/engine/council-engine.js) flushes `_commitDelibSlots(delibSlots, { preCollapse: true })` and `_commitVoteSlots(voteSlots, { preCollapse: true })` in strict roster order **before** `EXCUSE_SEAT`, preserving Issue `#95` sibling proofs, votes, and objections.
- `handleSeatFault` and `JUDGE_AUDIT_SYNTHESIS` recovery consume `plan` for `RETRY_SEAT` / `EXCUSE_SEAT` / `RETRY_JUDGE` / terminal `JUDGE_FAULT` and set `toolFreeRecoveryUsed = true` on `RETRY_SEAT` / `RETRY_JUDGE` when `plan.setsToolFreeRecoveryUsed` is true.

### Error Taxonomy Registration & Exports
- Define `HeadlessToolDeniedError extends HarnessError` in [src/harness/adapter.js](file:///Users/aaat/projects/the-council/src/harness/adapter.js) (`name: 'HeadlessToolDeniedError'`, `code: 'HEADLESS_TOOL_DENIED'`, `isRetryable: true`, `isQuotaFault: false`, `deniedActions`, `exitCode`, `stderr`, `trace`).
- Preserve `HeadlessToolDeniedError` (and raw `err?.code === 'HEADLESS_TOOL_DENIED'`) in `HarnessAdapter.prototype.classifyError` and `AntigravityAdapter.prototype.classifyError`.
- Export `HeadlessToolDeniedError` from [src/harness/adapter.js](file:///Users/aaat/projects/the-council/src/harness/adapter.js), [src/harness/index.js](file:///Users/aaat/projects/the-council/src/harness/index.js), and [src/index.js](file:///Users/aaat/projects/the-council/src/index.js); add `'HeadlessToolDeniedError'` to `ErrorClass` in [src/types.js](file:///Users/aaat/projects/the-council/src/types.js) and `knownClasses` in `_classifyErrorClass` ([council-engine.js](file:///Users/aaat/projects/the-council/src/engine/council-engine.js)).

---

## 3. Complete Antigravity Envelope-Handling Contract & PID-Safe Provider Matchers

### PID-Safe Provider Error Matching Across All Harnesses & Engine
Never match bare `/\b429\b/` or `/\b(?:401|403)\b/` anywhere in `src/` (which falsely classify harmless Node/OS warnings carrying numeric PIDs such as `(node:429) ExperimentalWarning: Example harmless warning`, `(node:401) ...`, `(node:403) ...` as quota or authentication failures). Define shared context-qualified regexes exported from [src/harness/adapter.js](file:///Users/aaat/projects/the-council/src/harness/adapter.js) and used consistently across [src/harness/adapter.js](file:///Users/aaat/projects/the-council/src/harness/adapter.js), [src/harness/cli-runner.js](file:///Users/aaat/projects/the-council/src/harness/cli-runner.js), [src/harness/antigravity.js](file:///Users/aaat/projects/the-council/src/harness/antigravity.js), [src/harness/codex.js](file:///Users/aaat/projects/the-council/src/harness/codex.js), [src/harness/cursor.js](file:///Users/aaat/projects/the-council/src/harness/cursor.js), and [src/engine/council-engine.js](file:///Users/aaat/projects/the-council/src/engine/council-engine.js):
- `PROVIDER_HTTP_429_REGEX`: `/(?:\bhttp(?:\/\d(?:\.\d)?)?\s*429\b|\b(?:status(?:\s*code)?|error(?:\s*code)?|response(?:\s*code)?)\s*[:=]?\s*429\b|"status"\s*:\s*429\b|"code"\s*:\s*429\b|\b429\s+(?:too\s+many\s+requests|resource[\s_-]*exhausted|rate[\s_-]*limit))/i` (paired with each module's existing structured rate-limit/quota tokens).
- `PROVIDER_HTTP_AUTH_REGEX`: `/(?:\bhttp(?:\/\d(?:\.\d)?)?\s*(?:401|403)\b|\b(?:status(?:\s*code)?|error(?:\s*code)?|response(?:\s*code)?)\s*[:=]?\s*(?:401|403)\b|"status"\s*:\s*(?:401|403)\b|"code"\s*:\s*(?:401|403)\b|\b(?:401|403)\s+(?:unauthorized|forbidden|unauthenticated|permission[\s_-]*denied))/i` (paired with `unauthorized`, `unauthenticated`, `authentication\s+failed`, `invalid[\s_-]*api[\s_-]*key`, `permission_denied`).

### Sanitized Envelope Extraction & Non-Fatal Warning Preservation
In [src/harness/cli-runner.js](file:///Users/aaat/projects/the-council/src/harness/cli-runner.js):
- `parseAntigravityOutput(rawStdout, { forbiddenWorkspaceRoots })` extracts `unwrappedResponse`, sanitized `deniedActions` (`json.denied_actions`), sanitized `envelopeError` (`json.error`), `finishedReason`, and `forbiddenStateAccess` (scanning **both** `toolCalls` and `json.denied_actions`).
- `stripKnownBenignAntigravityWarning(stderr)` removes **only** full lines matching `/^[ \t]*warning:\s+--mode\s+plan\s+has\s+no\s+effect\s+while\s+slash\s+command\s+expansion\s+is\s+disabled\.?[ \t]*$/i`, producing sanitized `diagnosticStderr` while keeping co-occurring error lines and any other warnings intact.
- **Unknown warnings do not automatically fail empty responses**: `hasExplicitProviderErrorSignature(diagnosticStderr)` matches **only** explicit provider error signatures — PID-safe `PROVIDER_HTTP_429_REGEX` / `resource_exhausted` / `rate_limit_error` / `overloaded_error` / `quota\s+window\s+exhausted` / `token_budget_exceeded` / `quota\s+exceeded`, PID-safe `PROVIDER_HTTP_AUTH_REGEX` / `unauthenticated` / `unauthorized` / `authentication\s+failed` / `invalid[\s_-]*api[\s_-]*key` / `permission_denied`, or explicit fatal model/request errors (`/\b(?:model_not_found|unknown\s+model|unsupported\s+model|invalid_argument)\b/i`). Unrelated benign/unknown warnings (e.g., `(node:429) ExperimentalWarning: ...`, `(node:401) ...`, `(node:403) ...`, `DeprecationWarning`, generic `warning: ...`) are preserved in `trace.stderr` diagnostics without throwing.

### Precedence on `exitCode === 0` (`runAntigravityCli`)
1. **`parsedOut.forbiddenStateAccess === true`**: record provider call once (`exitCode: 0`, `trace.outcome: 'error'`) and throw `FORBIDDEN_STATE_ACCESS` (`exitCode: 0`, `trace`, `_providerCallRecorded: true`).
2. **Non-empty `resolvedOutput` (`resolvedOutput.trim().length > 0`) — Preserves Issue `#97` Verbatim**:
   - Never throw, even when `hasFailureMetadata` (`finishedReason` in `{'error', 'print_timeout', 'interrupted'}`, `envelopeError`, or `deniedActions`) is present; record `trace.outcome: parsedOut.hasFailureMetadata ? 'error' : 'success'` (preserving non-empty `diagnosticStderr` on `trace.stderr`) and return `resolvedOutput` verbatim.
3. **Empty `resolvedOutput` (`""`) with `parsedOut.deniedActions.length > 0`**:
   - Record provider call once (`exitCode: 0`, `trace` with `outcome: 'error'`, `deniedActions`, and `stderr: diagnosticStderr`) and throw `HeadlessToolDeniedError` (`code: 'HEADLESS_TOOL_DENIED'`, `exitCode: 0`, `deniedActions`, `stderr: diagnosticStderr`, `trace`, `_providerCallRecorded: true`).
4. **Empty `resolvedOutput` (`""`) with `deniedActions.length === 0`, when `parsedOut.envelopeError` is non-empty OR `hasExplicitProviderErrorSignature(diagnosticStderr)` is `true`**:
   - Record provider call once (`exitCode: 0`, `trace.outcome: 'error'`) and throw a sanitized CLI `Error` (`exitCode: 0`, `stderr: [parsedOut.envelopeError, diagnosticStderr].filter(Boolean).join(' — ')`, `trace`, `_providerCallRecorded: true`) so `AntigravityAdapter.classifyError` maps `QuotaExhaustionError`, `AuthenticationError`, or `HarnessExecutionError`.
5. **Empty `resolvedOutput` (`""`) otherwise** (including empty/whitespace output, `{"response":""}`, `finished_reason: "print_timeout"|"interrupted"`, or unknown/harmless warnings on `stderr`):
   - **Preserves Issue `#97` Verbatim**: record provider call once (`exitCode: 0`, `trace.outcome: 'error'`, attaching `trace.stderr: diagnosticStderr` when non-empty) and return `""` so `parseStructuredOutput` throws retryable `InvalidResponseError` rather than escalating unknown warnings into non-retryable `HarnessExecutionError`.

### Precedence on Nonzero Exit / Signal / Timeout (`exitCode !== 0`)
In `runAntigravityCli`'s `catch (err)`: sanitize `err`, strip only the known `--mode plan` warning line from `err.stderr`, parse `err.stdout` when non-empty, escalate `FORBIDDEN_STATE_ACCESS` first, preserve `ABORT_ERR` / `ETIMEDOUT` / `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` second, convert to `HeadlessToolDeniedError` (preserving nonzero `exitCode`, `stderr`, `deniedActions`, `trace`) when `parsedErr?.deniedActions.length > 0` and no quota/auth signature is present, and otherwise attach `parsedErr?.envelopeError` + `errorTrace` (`_providerCallRecorded = true`), record `providerCalls` once with actual `exitCode`, and rethrow for `AntigravityAdapter.classifyError`.

---

## 4. Workspace Isolation, Trusted Invocation Roots, & Explicit Citation Validation

### `.codegraph`-Without-`.council` Safe Copy & Consistent Canonicalization
In [src/harness/cli-runner.js](file:///Users/aaat/projects/the-council/src/harness/cli-runner.js#L4024-L4221):
- Replace `hasDotCouncilEntry(dirPath)` with `requiresIsolatedSafeWorkspaceCopy(dirPath)` checking case-insensitively for **`.council` OR `.codegraph`** (`fs.lstatSync` + `fs.readdirSync`, returning `false` on `ENOENT`/`ENOTDIR` and rethrowing permission errors). Workspaces containing `.codegraph/` without `.council/` enter the `council-safe-cwd-*` copy branch instead of bypassing isolation.
- `copySafeWorkspace` omits `.council`, `.codegraph` (case-insensitive), and `node_modules` at every directory depth, plus symlinks whose resolved targets traverse `.council`, `.codegraph`, or `node_modules`. `forbiddenWorkspaceRoots = [...new Set([resolvedRoot, realRoot])]` is always populated whenever `council-safe-cwd-*` is created.
- Canonicalize `effectiveCwd` and `effectiveEnv` (`PWD`, with `OLDPWD` and `INIT_CWD` deleted) via `fs.realpathSync` consistently across all three `prepareIsolatedCliWorkspace` branches:
  1. `!explicitCwd` (`council-seat-cwd-*`),
  2. direct clean `explicitCwd` (when existing on disk; preserving `ENOENT` virtual paths for mocked-`exec` unit tests while rethrowing non-`ENOENT` errors), and
  3. isolated `council-safe-cwd-*` copy.

### Trusted Invocation Root Plumbing & Explicit Citation Validation
1. **Exact Metadata Plumbing (`context._invocationMeta`)**:
   - `CouncilEngine` allocates a fresh per-attempt `invocationMeta = { trustedEphemeralRoots: [], forbiddenWorkspaceRoots: [], effectiveCwd: undefined, effectiveTools: undefined }` and passes it via `context._invocationMeta` on each seat/judge execution call.
   - `AntigravityAdapter`, `CodexAdapter`, and `CursorAdapter` forward `_invocationMeta` on the `context` object passed into `_dispatchCli` (`runAntigravityCli`, `runCodexCli`, `runCursorCli`).
   - Inside `prepareIsolatedCliWorkspace`, **only** the `council-safe-cwd-*` branch populates `context._invocationMeta.trustedEphemeralRoots = [...new Set([tempSafeCwd, realTempSafeCwd])]` and `context._invocationMeta.forbiddenWorkspaceRoots = [...new Set([resolvedRoot, realRoot])]`.
   - Arbitrary `<tmpRoot>/council-safe-cwd-*` or `council-seat-cwd-*` paths **not** present in this invocation's `trustedEphemeralRoots` are **never** normalized.

2. **Normalization + Explicit Validation Failure (`validateProof` & Engine Output Validators)**:
   - Run `normalizeTrustedInvocationCitations(payload, invocationMeta)` before validation/persistence (`validateDelibWave` before `validateProof`/`SUBMIT_PROOF`, vote validation before `CAST_VOTE`, and Judge output validation before `CANDIDATE_SYNTHESIZED`):
     - Strips **only** exact path prefixes in `invocationMeta.trustedEphemeralRoots` (`<trustedRoot>/<relPath>` -> POSIX `<relPath>`, preserving `:line` / `:start-end` suffixes) when `<relPath>` is non-empty, contains zero `..` segments, and does not target `.council`. If `<trustedRoot>` is followed by `..` or `.council`, leave it unstripped so validation rejects it explicitly.
   - Update [src/proofs/validator.js](file:///Users/aaat/projects/the-council/src/proofs/validator.js#L19) (`validateProof(input, options = {})`) **and** engine Vote (`reason`) / Judge (`summary`, `clauses`, `proofDecisions`) citation guards to return **explicit `{ valid: false, errors: [...] }` validation failures** (raising `InvalidResponseError` / explicit rejection before state transition) whenever any citation/path field contains:
     - **Parent traversal segments**: `../outside.js:3`, `src/../../outside.js:3`, `..\\outside.js`, or bare `..` (matched on path-segment boundaries so `...` prose ellipses remain valid).
     - **Forbidden `.council` artifacts**: `.council/...`, `latest.js`, `*.meta.json`, `*.events.jsonl`, `telemetry-summary.*`.
     - **Host workspace roots**: any prefix in `options.forbiddenWorkspaceRoots` (`invocationMeta.forbiddenWorkspaceRoots`).
     - **Untrusted temporary roots**: any `/.../council-safe-cwd-*` or `/.../council-seat-cwd-*` path remaining after stripping `invocationMeta.trustedEphemeralRoots` (rejecting foreign or fabricated sandbox paths).
   - During `JUDGE_AUDIT_SYNTHESIS`, the Judge receives its own isolated `council-safe-cwd-*` copy and resolves persisted portable `file:line` citations inside its own workspace.

3. **Workspace Directives & Bounded Unresolved-Objection Inspection** ([src/seats/soul.js](file:///Users/aaat/projects/the-council/src/seats/soul.js#L207-L702)):
   - Update **both** `ISOLATED_WORKSPACE_PATH_DIRECTIVE` and `CLARIFICATION_WORKSPACE_DIRECTIVE`: explain that `"."` is the attached workspace (an isolated `.council`-free and `.codegraph`-free copy when `.council` or `.codegraph` exists on host); allow native read/search tools (`Read`/`read_file`, `Glob`, `Grep`, `LS`) to pass `"."`-relative paths or absolute paths strictly inside the current isolated workspace when required by tool schemas; discourage headless `Bash`/`codegraph` CLI invocations when native tools suffice; **require** all submitted citations (`source`, `statement`, `reason`, Judge `clauses`/`proofDecisions`) to use portable workspace-relative `file:line` references; and preserve all Issue `#96` host-path (`FORBIDDEN_STATE_ACCESS`), `cd`, `..`, `git -C`, and no-`cwd`-interpolation rules (updating only incidental phrasing assertions in [issue-96-soul-isolated-workspace.test.js](file:///Users/aaat/projects/the-council/test/unit/issue-96-soul-isolated-workspace.test.js)).
   - Add bounded read caps: Deliberation R1 (`5–8` targeted reads), Deliberation R2+ (`3–5` reads targeting `Unresolved Objections to Address` without re-inspecting settled clauses), Voting `read-only` (`3–5` reads), and Judge `read-only` (`3–5` reads covering concrete paths cited in current-round `Submitted Proofs for Auditing` **and** disputed claims in Round 2+ `Unresolved Open Objections`, `0` reads when neither cites workspace files, while **never** reopening, re-auditing, or emitting `proofDecisions` for `Prior-Round Admitted Proofs`).

---

## 5. Joint Model + Effort Resolution & Capability Provenance

### Flag-Off Compatibility & Scoped `CONFLICTING_MODEL_EFFORT`
- `retryEffortFallback` defaults to `false` (opt-in via `retryEffortFallback: true` or CLI `--retry-effort-fallback`).
- In [src/engine/config.js](file:///Users/aaat/projects/the-council/src/engine/config.js), record non-enumerable `_explicitReasoningEffort: Boolean(rawParticipant?.reasoningEffort !== undefined || rawParticipant?.['reasoning-effort'] !== undefined)` on `judge` and each `seat` **before** merging global defaults.
- **When `retryEffortFallback === false`**:
  - Initial-call `adapter.validateModel(model)` ([antigravity.js](file:///Users/aaat/projects/the-council/src/harness/antigravity.js#L28-L51), [codex.js](file:///Users/aaat/projects/the-council/src/harness/codex.js#L37-L53), [cursor.js](file:///Users/aaat/projects/the-council/src/harness/cursor.js#L26-L47)) and Attempt-0 CLI dispatch (`runAntigravityCli`, `runCodexCli`, `runCursorCli`) remain **completely unchanged** — introducing **zero** incidental initial-call compatibility changes.
  - Existing selector precedence is preserved: even if a participant has both an inline effort on `model` and an explicit `reasoningEffort`, `retryEffortFallback === false` preserves the existing `parseModelAndEffort(model, defaultEffort)` precedence without throwing `CONFLICTING_MODEL_EFFORT`.
  - Retries preserve the phase-resolved `(requestedModel, requestedEffort)` unchanged (`fallbackApplied: false`).
- **When `retryEffortFallback === true` (Opted-In Validation & Resolution Path ONLY)**:
  - **Explicit Same-Participant Conflict**: if a participant has an explicit inline effort on `participant.model` (e.g., `"gpt-6-astra (max)"`) **and** `_explicitReasoningEffort === true` with a contradicting effort (e.g., `seat.reasoningEffort: "low"`), the opted-in fallback validation/resolution path rejects it explicitly with `CONFLICTING_MODEL_EFFORT` (both at `--live --retry-effort-fallback` preflight and in `_planParticipantRecovery`).
  - **Inherited Defaults & Phase-Derived Configs (Non-Conflicting)**: when `_explicitReasoningEffort === false` (global `config.reasoningEffort` or adapter `'high'` default), inline effort on `participant.model` wins cleanly; phase-derived configs from `resolveRebuttalSeatConfig` and `resolveVotingSeatConfig` rewrite `model` and `reasoningEffort` together as the phase-resolved baseline.
- **Bounded Retry Ceiling & Budget Rules Preserved**: retry timeout remains `Math.min(baseTimeoutMs, 90000, Math.max(1, remainingBudget))`; preserving `high`/`xhigh`/`max` effort does not guarantee completion within `<= 90000ms`, and `remainingBudget < minViableBudgetMs` terminates immediately with a clear budget-exhausted reason rather than reducing effort further.

### Joint Fallback Resolution & Capability Provenance (`retryEffortFallback: true`)
Evaluated **only** when `retryEffortFallback === true` on eligible `TimeoutError` / `HeadlessToolDeniedError` retries (and upfront in `--live --retry-effort-fallback` CLI preflight):
1. **Joint Effort Cap (`resolveRetryModelAndEffort`)**:
   - `'composer-2.5'` (without effort): `requestedEffort = null`, `effectiveModel = 'composer-2.5'`, `effectiveEffort = null`, `fallbackApplied = false`.
   - Effort-bearing models: `effectiveEffort = downshiftEffort(resolvedRequestedEffort, 'medium')` (`max`/`xhigh`/`high` -> `'medium'`, `fallbackApplied = true`; `'medium'` -> `'medium'`, `fallbackApplied = false`; `'low'` -> `'low'`, `fallbackApplied = false` — **never raising `low`**).
   - Synchronize **both** inline selector (`gpt-6-astra (medium)`, `gemini-4-argon-medium`, `grok-4.7-medium`) and `reasoningEffort: effectiveEffort` (`currentSeatConfig.reasoningEffort` / `judgeConfig.reasoningEffort` + `context.reasoningEffort`) so bare models (`gpt-6-astra` + `reasoningEffort: 'max'`) also execute at `'medium'`.
2. **Capability Provenance & Limits (`validateRetryFallbackCapability`)**:
   - Returns `{ supported: boolean, provenance: 'live_cli_catalog' | 'adapter_static_policy' | 'unverified', reason?: string }`:
     - **`live_cli_catalog`**: in `bin/council run --live --retry-effort-fallback`, preflight probes `agy models` (when `antigravity` is active and not overridden) to verify the exact selector (e.g., `gemini-4-carbon-medium` or any installed selector) against the local `agy` binary's model list.
     - **`adapter_static_policy`**: when no live CLI catalog exists (including `codex` and `cursor`, whose CLIs expose no offline model-effort matrix command), static policy checks known canonical CLI contracts **only**:
       - `CodexAdapter`: `gpt-6-astra`, `gpt-6.1-sol` with `effectiveEffort` in `{'low', 'medium', 'high', 'xhigh', 'max'}`.
       - `AntigravityAdapter`: canonical **non-date-stamped** `gemini-4-argon`, `gemini-4-carbon`, `claude-opus-5-5`, `claude-sonnet-5-5` with `effectiveEffort` in `{'low', 'medium', 'high'}` (`xhigh`/`max` rejected).
       - `CursorAdapter`: `grok-4.7` with `effectiveEffort` in `{'low', 'medium', 'high', 'xhigh'}` (`max` rejected); `composer-2.5` with `effectiveEffort === null` only.
     - **`unverified` (Explicit Failure)**: date-stamped selectors (e.g., `claude-opus-5-5-20260501`) and custom/unrecognized model names **cannot** have `'medium'` fallback capability inferred from family prefixes alone. Unless confirmed by `live_cli_catalog` or an explicit adapter `verifiedCapabilities` descriptor, `validateRetryFallbackCapability` returns `{ supported: false, provenance: 'unverified' }`, failing explicitly (`UNSUPPORTED_MODEL_EFFORT`, `canRetry: false`, `terminationKind: 'unsupported_fallback'`) — **never** silently substituting another model and **never** retaining `'high'`/`'xhigh'`/`'max'`.
   - **Documented Limit**: neither `adapter_static_policy` nor `live_cli_catalog` guarantees runtime subscription quota or account entitlement; runtime CLI rejections still surface via `classifyError`.

---

## 6. End-to-End Attributed Retry Diagnostics Pipeline

### Schema & Lifecycle (Zero Cross-Turn Leakage, Zero Model Mutation)
Compute `retryDiagnostics` in `_planParticipantRecovery` **before** dispatching `RETRY_SEAT` / `RETRY_JUDGE` and `emitSeatTelemetry(id, 'thinking', { retryDiagnostics })`:
```js
{
  participantId: string,          // seat.id or judge.id
  role: 'seat' | 'judge',
  phase: 'DELIBERATION' | 'JUDGE_AUDIT_SYNTHESIS' | 'VOTING',
  round: number,
  attempt: number,                // 1-indexed retry attempt
  requestedModel: string,
  requestedEffort: string | null,
  effectiveModel: string,
  effectiveEffort: string | null,
  capabilityProvenance: 'live_cli_catalog' | 'adapter_static_policy' | 'unverified' | null,
  fallbackEnabled: boolean,
  fallbackApplied: boolean,
  fallbackReason: string | null,  // 'TimeoutError' | 'HeadlessToolDeniedError' when fallbackApplied
  tools: 'read-only' | 'none'
}
```
State fields on `state.seats[i]` and `state.judge` (configured `seat.model` and `judge.model` are **never** mutated):
- `activeRetryDiagnostics: RetryDiagnostics | null`: set on `RETRY_SEAT` / `RETRY_JUDGE` for the in-flight retry turn; **cleared to `null`** on `BEGIN_ROUND`, `SUBMIT_PROOF` (for that seat), `START_JUDGING` (for all seats & judge), `CANDIDATE_SYNTHESIZED` / `JUDGE_AUDIT_AND_SYNTHESIZE` (for judge), `CAST_VOTE` (for that seat), and `EXCUSE_SEAT` (for that seat) so retry metadata **never leaks** into subsequent ordinary calls.
- `retryDiagnosticsHistory: RetryDiagnostics[]`: append-only array initialized to `[]` in [state.js](file:///Users/aaat/projects/the-council/src/machine/state.js) and appended on `RETRY_SEAT` / `RETRY_JUDGE` in [reducer.js](file:///Users/aaat/projects/the-council/src/machine/reducer.js).

### Full Pipeline Integration & Sparse Replay Deltas
1. **Engine Dispatch & `providerCalls`** ([council-engine.js](file:///Users/aaat/projects/the-council/src/engine/council-engine.js), [cli-runner.js](file:///Users/aaat/projects/the-council/src/harness/cli-runner.js#L260-L315)):
   - Pass `retryDiagnostics` on `RETRY_SEAT` / `RETRY_JUDGE` reducer events, `emitSeatTelemetry(id, 'thinking', { retryDiagnostics })`, and `context.retryDiagnostics` **only** during that retry turn (Wave-0 calls pass `retryDiagnostics: null`).
   - `recordProviderCall` records `phase`, `round`, `attempt` (`0` on Wave 0, `retryDiagnostics.attempt` on retries), `requestedModel`, `requestedEffort`, `model` (`effectiveModel`), `effectiveEffort`, `capabilityProvenance`, `fallbackApplied`, and `fallbackReason`.
2. **Visualizer Live Watcher & Sparse Step Replay** ([src/visualizer/live-watcher.js](file:///Users/aaat/projects/the-council/src/visualizer/live-watcher.js)):
   - `_handleStateTransition`: emit `activeRetryDiagnostics` and `retryDiagnosticsHistory` in `seatChanges` whenever those fields change (using serialized equality in `_prevSeatMap`), and include `activeRetryDiagnostics`, `retryDiagnosticsHistory`, and `retries` on `stateDelta.judgeState`. Note that `seatChanges` only includes changed seats (deltas are **sparse**).
   - `_handleSeatTelemetry`: forward `event.retryDiagnostics` onto telemetry step metadata.
   - `_rehydrateStepAt` **and** `_buildBundleScript` browser replay loop — **Sparse Replay Delta Contract**:
     - Seed baseline `baseSeats` and `baseJudge` with `activeRetryDiagnostics: null` and `retryDiagnosticsHistory: []` before step `0` (stripping end-of-run `data.currentState` values so they never leak backward into step `0`).
     - As steps `0..i` accumulate in `seatMap` and `judgeAcc`, **retain** a participant's prior accumulated `activeRetryDiagnostics` and `retryDiagnosticsHistory` whenever a subsequent step's delta omits that participant or omits that field (`!Object.prototype.hasOwnProperty.call(...)`).
     - Update or clear `activeRetryDiagnostics` (`null`) **only** when a delta explicitly delivers a new value (`activeRetryDiagnostics: <obj>` on `RETRY_SEAT`/`RETRY_JUDGE` or `activeRetryDiagnostics: null` on explicit lifecycle completion/reset transitions). Transitioning an unrelated participant must **never** wipe another seat's or Judge's in-flight `activeRetryDiagnostics`.
   - `getTransitionSummary`: include attributed `requested -> effective` model/effort, `tools`, and `fallbackReason` on `RETRY_SEAT` / `RETRY_JUDGE`.
3. **Telemetry Ledger** ([src/telemetry/ledger.js](file:///Users/aaat/projects/the-council/src/telemetry/ledger.js#L470-L530)):
   - Persist `retryDiagnosticsHistory` on per-seat and judge run records in `persistRunTelemetry` while preserving canonical `modelKey` bucket identity on configured `seat.model` / `judge.model`.
4. **CLI Output** ([src/cli/index.js](file:///Users/aaat/projects/the-council/src/cli/index.js#L430-L870)):
   - Support `--retry-effort-fallback` CLI flag (`retryEffortFallback: true`) and `agy models` preflight check when `--live --retry-effort-fallback` is used with Antigravity seats/Judge.
   - `--verbose` stderr logs attributed `requested -> effective` model/effort, `tools`, and `fallbackReason` on `RETRY_SEAT` / `RETRY_JUDGE`.
   - Final human summary (`Judge`, `Seat Roll Call`, `Excused Seats`) appends concise retry attribution from `retryDiagnosticsHistory` when fallback occurred; `--json` output includes `activeRetryDiagnostics`, `retryDiagnosticsHistory`, and attributed `providerCalls`.
5. **Visualizer Participant Cards** ([src/visualizer/index.html](file:///Users/aaat/projects/the-council/src/visualizer/index.html#L2203-L2253)):
   - Render retry diagnostics on **both** the Judge card (`judgeHtml`) and Seat cards (`seatsHtml`): show live `activeRetryDiagnostics` while retrying (`Retry #1 · effective: <effectiveModel> (<effectiveEffort>) · <fallbackReason>`) and compact `retryDiagnosticsHistory` badge afterward without altering primary `judge.model` / `s.model` labels, identically in live view and step replay.

---

## 7. Focused Verification Matrix (Positive & Negative TDD Cases)

1. **Same-File-But-Irrelevant Evidence, `[E1]` Mention, & Caller-Attested Boundary**:
   - `cwd` attached, `topic: "Using [E1], verify token expiry in src/auth.js"`, `evidence: [{ id: "E1", source: "src/auth.js", text: "// Copyright 2026" }]` (unattested, or attested with `coverage: { startLine: 1, endLine: 5 }` while `topic` / `P1.source` cites unbounded `src/auth.js` or `src/auth.js:120-145`) -> both `TimeoutError` and `HeadlessToolDeniedError` **refuse** tool-free recovery (`ready: false`, `terminationKind: 'evidence_access_failure'`).
   - Positive counterpart: explicit caller-attested `selfContainedInput` covering `DELIBERATION` + `coveredArtifacts: [{ source: "src/auth.js", evidenceId: "E1", coverage: "complete_artifact" }]` with zero other dependencies -> permits **at most 1** tool-free retry.
2. **External Verification Dependency Negative Cases**:
   - `cwd: undefined`, `topic` or `roundProofs` citing `https://datatracker.ietf.org/doc/html/rfc9110` or external `kind: 'benchmark'` source absent from `coveredArtifacts` -> `TimeoutError` / `HeadlessToolDeniedError` refuses tool-free recovery even when `conceptualNoExternalVerification: true` is set.
3. **Adapter-Only `cwd` & Whitespace Precedence Negative Cases**:
   - `seat.cwd: ""`, `state.cwd: "   "`, `config.cwd: undefined`, with `cwd` set **only** on `adapter.cwd` or `adapter.config.cwd` (and `callerContext.cwd` override) -> `resolveAttemptExecutionWorkspace` resolves the non-empty `adapter.cwd` / `adapter.config.cwd` identically in adapter execution and `_planParticipantRecovery`, refusing unattested tool-free recovery.
4. **Single Tool-Free Recovery Across All Subsequent Errors & Preserved Ordinary Retries**:
   - Once `toolFreeRecoveryUsed === true` (`read-only -> none` retry was dispatched), a subsequent `InvalidResponseError`, `QuotaExhaustionError`, `TimeoutError`, `HeadlessToolDeniedError`, or retryable `HarnessExecutionError` in the same phase **terminates immediately** (`terminationKind: 'tool_free_already_used'`) even when `maxRetriesPerSeat > 1` or `maxJudgeRetries > 1`.
   - When `toolFreeRecoveryUsed === false`: `QuotaExhaustionError` retries up to `maxRetries` with `tools` preserved (`read-only` stays `read-only`); already-tool-free (`tools: 'none'` on Attempt 0) `TimeoutError` / `InvalidResponseError` chains retry normally; with `retryEffortFallback: true`, `QuotaExhaustionError`, `InvalidResponseError`, and retryable `HarnessExecutionError` keep requested effort unchanged (`fallbackApplied: false`).
5. **Untrusted Temporary Roots & Explicit Traversal / Forbidden Citation Rejection**:
   - Trusted `<realTempSafeCwd>/src/engine/config.js:42` recorded in `invocationMeta.trustedEphemeralRoots` normalizes to `src/engine/config.js:42` before `SUBMIT_PROOF` and resolves inside the Judge's isolated copy.
   - Unknown/foreign temp root `/tmp/council-safe-cwd-other-seat/src/engine/config.js:42` is **not** normalized and fails validation explicitly.
   - `validateProof` and engine Vote/Judge guards explicitly reject `../outside.js:3`, `.council/state.json:1`, and `<hostWorkspaceRoot>/src/foo.js:1` (`valid: false`), while keeping prose `...` ellipses valid.
6. **Harmless PID Warnings (`429`/`401`/`403`) vs Explicit Provider Errors**:
   - Warning fixtures `(node:429) ExperimentalWarning: Example harmless warning`, `(node:401) ExperimentalWarning: Example harmless warning`, and `(node:403) ExperimentalWarning: Example harmless warning` (alone or paired with `exitCode: 0` + `{"response":""}` and optional benign `--mode plan` warning) **never** trigger `QuotaExhaustionError` or `AuthenticationError`, preserve warnings in `trace.stderr`, return `""`, and classify as retryable `InvalidResponseError`.
   - Explicit `HTTP 429 Too Many Requests` / `429 RESOURCE_EXHAUSTED` / `HTTP 401 Unauthorized` / `status: 403` classify into `QuotaExhaustionError` / `AuthenticationError`.
7. **Capability Provenance, Flag-Off Compatibility for `CONFLICTING_MODEL_EFFORT`, & Zero Initial-Call Breakage**:
   - `retryEffortFallback: false` keeps existing Attempt-0 `validateModel` acceptance and selector precedence untouched: `{ model: "gpt-6-astra (max)", reasoningEffort: "low" }` succeeds with `'max'` without raising `CONFLICTING_MODEL_EFFORT`.
   - Under `retryEffortFallback: true`: explicit same-seat conflict (`model: "gpt-6-astra (max)"` + explicit `seat.reasoningEffort: "low"`) fails with `CONFLICTING_MODEL_EFFORT`, whereas inherited global `config.reasoningEffort: "low"` with `seat.model: "gemini-4-argon-high"` resolves `'high'` cleanly; bare `gpt-6-astra` + `reasoningEffort: 'max'` caps to `'medium'`; `claude-opus-5-5-low` stays `'low'`; `composer-2.5` stays `null`; and unverified date-stamped `claude-opus-5-5-20260501` (without `live_cli_catalog` confirmation) fails explicitly (`UNSUPPORTED_MODEL_EFFORT`, `provenance: 'unverified'`).
8. **`.codegraph`-Only Isolation, Issue `#95` Quorum Conservation, Sparse Replay Deltas, & Regression Suite**:
   - `.codegraph`-without-`.council` workspace triggers `council-safe-cwd-*` copy omitting `.codegraph`; 3-seat `minQuorum: 2` collapse preserves valid sibling proofs/votes (`#95`).
   - Sparse replay step where Seat A enters retry (`activeRetryDiagnostics !== null`) and an unrelated Seat B subsequently changes (Seat A omitted from Seat B's `seatChanges`) **retains** Seat A's `activeRetryDiagnostics` until Seat A's own lifecycle completion clears it to `null`, while step `0` starts clean without end-of-run `currentState` leakage.
   - `providerCalls`, `ledger.js`, CLI (`--retry-effort-fallback`, `--verbose`, human summary, `--json`), and `index.html` Judge & Seat cards render attributed retry diagnostics accurately; `#90`/`#95`/`#96`/`#97` suites and full `npm test` pass with [configs/best-of-families.json](file:///Users/aaat/projects/the-council/configs/best-of-families.json) untouched.
