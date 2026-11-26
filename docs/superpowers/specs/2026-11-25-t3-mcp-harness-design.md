# T3 MCP `HarnessAdapter` Design Spec

- **Status:** **Approved — Ready for Stage 2 (`superpowers:writing-plans`)**
- **Date:** 2026-11-25
- **Branch:** `feat/t3-mcp-harness` (branched from `main` at `8920b32`)
- **ADR:** [0005-t3-mcp-harness-dispatch.md](file:///Users/aaat/projects/the-council/docs/adr/0005-t3-mcp-harness-dispatch.md) (supersedes ADR-0004's outbound dispatch choice; updates ADR-0002)

---

## 1. Problem Statement & Goal

Maintaining direct `node:child_process.execFile` dispatch across three independent Harness CLIs (`codex --json`, `agy` `json`, `cursor-agent` `stream-json`), divergent NDJSON parsers, POSIX process-group kill/drain logic, and nested error-redaction code expanded `src/harness/*.js` from `9,586` LOC on `main` (`8920b32`) to ~`66,000` LOC across 61 hardening rounds on `fix/issue-107-agy-stream-json`.

T3 Code (`http://127.0.0.1:3773/mcp`) now exposes a single Streamable HTTP MCP control plane across `codex`, `antigravity`, and `cursor`. The goal of `feat/t3-mcp-harness` is to introduce `T3HarnessAdapter` and a zero-dependency `T3McpClient` (built on Node >= 22 global `fetch`) behind `HarnessAdapter` (`executeSeat`, `executeJudge`), while keeping `CouncilEngine`, Clarification Batch and Deliberation Round state transitions, Proof admission, Candidate synthesis, Objection locking (`preserved_excused`), `bin/council`, and `VisualizerLiveWatcher` telemetry completely intact.

> [!IMPORTANT]
> **Spec Review Outcome (Round 1: 5/10 across 3 Review Seats -> Round 2: Astra 6.2 6/10 -> Approved with Honest T3 Trust Boundary):**
> Round 1 surfaced 6 P0 architectural gaps; Round 2 verified 8 additional low-cost protocol, pagination, telemetry-gate, env-stripping, and test fixes while identifying 3 areas where extra custody machinery would recreate `src/pilot/` complexity. All 8 low-cost Round 2 fixes are folded in below, the **Honest T3 Trust Boundary** is explicitly documented, and all 3 Stage 1 open choices are locked in for Stage 2 planning.

---

## 2. Verified Runtime & Codebase Facts

### 2.1 Local T3 MCP Server (`http://127.0.0.1:3773/mcp`)
- **Wire revisions & transport:** Installed T3 Code Beta (`0.1.12`) exposes Streamable HTTP MCP supporting `2025-06-18` (sessionful `initialize` -> `notifications/initialized` -> `Mcp-Session-Id`) and `2026-07-28`. `GET` returns `405` (no GET SSE stream replay). Every HTTP `POST` (including `initialize`, `notifications/initialized`, and `tools/call`) MUST send `Accept: application/json, text/event-stream` (preventing T3 HTTP `406`), and `Mcp-Session-Id` captured from `initialize` MUST be sent on `notifications/initialized` and all subsequent calls. HTTP `POST` returns `application/json`, `text/event-stream`, or `202` empty body for notifications.
- **Credential boundary:** Unauthenticated `POST http://127.0.0.1:3773/mcp` returns HTTP `401` (`{"error":"invalid_mcp_credential",...}`) with an OAuth resource-metadata challenge. `the-council` will **never** read or scrape external clients' private config/credential stores; standalone CLI execution requires an explicitly configured `T3_MCP_TOKEN` / header callback or an injected in-process `callTool` caller (`mcpClient`). During coexistence, `T3_MCP_TOKEN` MUST be stripped from legacy CLI child environments (`buildSanitizedCliEnv()` at `src/harness/cli-runner.js:3858` and `listAntigravityModels()` at `src/harness/cli-runner.js:5673`).
- **Registered project (`t3_project_list`):** `/Users/aaat/projects/the-council` resolves to `projectId: "305c72ed-c258-4618-860f-75a24d1ad2fc"`.
- **Live T3 model catalog & option keys (`orchestrator_capabilities`):**
  - `codex` (`canRunChildTask: true`): `gpt-6.2-sol`, `gpt-6.2-astra`, `gpt-6.1-terra`, `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-luna` -> `reasoningEffort`
  - `antigravity` (`canRunChildTask: true`): `gemini-4-neon`, `gemini-4-hydrogen`, `gemini-pro-orchestrator-neon` (no effort option), `claude-opus-5-5`, `claude-sonnet-5-5` -> `thought_level` *(Note: legacy `gemini-4-argon` and `gemini-4-carbon` in `configs/best-of-families.json` / Council Presets do NOT appear in live T3 `orchestrator_capabilities`)*
  - `cursor` (`canRunChildTask: true`): `grok-4.7` (`reasoning_effort`), `grok-4.6` (`effort`), `composer-2.5` (no effort option), `gemini-4-neon`, `gemini-4-hydrogen`, `muse-wonder-1.0`
- **T3 control primitives & limits:**
  - `t3_thread_launch`: requires nonempty `title`, enforces `message.maxLength: 120000`, `scratch` (mutually exclusive with `projectId` / `workspaceStrategy`), `workspaceStrategy` (`root` | `worktree` | `existing_worktree`; note `worktree` does NOT copy uncommitted edits), `interactionMode` (`default` | `plan`), `runtimeMode` (`approval-required` | `auto-accept-edits` | `auto` | `full-access`), `modelSelection`, `clientRequestId`, `outputSchema`.
  - `t3_thread_wait`: server-capped ~45s wait slices (`timedOut: true` means the slice elapsed, NOT necessarily Seat timeout), returns run `status` and `untilOutput` support.
  - `t3_thread_read`: newest-first by default (`afterPosition: -1` for forward scan), `maxCharsPerItem <= 20000`, `limit <= 100`, `hasMore` (authoritative forward-pagination terminator; `nextPosition` may remain non-null on the final page), `itemId` + `textOffset=nextTextOffset` (pages clipped text), `view: "messages" | "activity"`, and `thread.pendingRequestCount` (detects pending interactive prompts).
  - `t3_thread_interrupt`: **passing `stop: true` ignores `runId`** and invokes thread-wide `thread.stop`; **omit `stop`** and pass `{ threadId, runId, reason, clientRequestId }` for run-scoped cancellation.
  - `t3_pending_request`: explicitly does **not** list permission approvals (`"approvals are not listed"`).
  - `t3_thread_organize`: supports archiving finished threads (`action: "archive"`).

### 2.2 `the-council` Contracts on `main` (`8920b32`)
- **Non-legacy `src/` importers of `src/harness/cli-runner.js` (6 files):**
  - `src/harness/adapter.js` (18 symbols: `VALID_DRAIN_STATUSES`, `MAX_CLI_ERROR_MESSAGE_BYTES`, `MAX_CLI_STDERR_BYTES`, `recordProviderCall`, `normalizeProviderTrace`, `normalizeExitCode`, `normalizeSignalName`, `sliceUtf8Bytes`, `redactPromptInText`, `sanitizeLifecycleMetadata`, `createAttemptTelemetryGate`, `runWithAttemptTelemetryGate`, `getActiveAttemptTelemetryGate`, `markAttemptGateCancelled`, `markAttemptGateFinalized`, `PROVIDER_HTTP_429_REGEX`, `PROVIDER_HTTP_AUTH_REGEX`, unused `parseModelAndEffort`)
  - `src/engine/recovery.js` (7 symbols: `ALLOWED_EFFORTS`, `VALID_DRAIN_STATUSES`, `normalizeExitCode`, `normalizeSignalName`, `extractCanonicalBaseModel`, `downshiftEffort`, `downshiftModel`)
  - `src/engine/council-engine.js` (4 symbols: `downshiftEffort`, `downshiftModel`, `extractCanonicalBaseModel`, `parseModelAndEffort`)
  - `src/telemetry/ledger.js` (2 symbols: `parseModelAndEffort`, `extractCanonicalBaseModel`)
  - `src/engine/config.js` (1 symbol: `ALLOWED_EFFORTS`)
  - `src/cli/index.js` (1 symbol: `listAntigravityModels`)
- **Hidden invariants that `T3HarnessAdapter` must preserve:**
  - `captureAttemptInvocationMeta()` mutates `callerContext._invocationMeta` **in place** for post-attempt citation validation (`trustedEphemeralRoots`, `forbiddenWorkspaceRoots`).
  - `validateModel(model)` is called **synchronously** in `src/cli/index.js` and `test/unit/presets.test.js` before `initialize()`.
  - `CouncilEngine` can mutate `tools` (`read-only` -> `none` in Voting, Round 2+ Rebuttal, and Step 5 retries), `cwd` (cleared on tool-free retries), `model`, and `reasoningEffort` dynamically within a single Council.
  - `onCallRecord` + `telemetry.emitProviderCall` must fire **exactly once** per attempt by reusing the active gate created inside `HarnessAdapter.executeWithTimeout()` via `getActiveAttemptTelemetryGate()` (never constructing a duplicate gate), keep `provider` as the logical Council Harness (`'codex' | 'antigravity' | 'cursor'`, NOT `'t3'`, because `ledger.js` and `src/visualizer/index.html` key styles and metrics on it), and attach `transport: 't3-mcp'`, `threadId`, `runId` as additive metadata.

---

## 3. Council Review Summary (Rounds 1 & 2)

| Review Seat | Round 1 | Round 2 | Thread / Reference |
| --- | --- | --- | --- |
| Astra 6.2 | 5/10 | 6/10 | [Round 1 T3 Thread](https://app.t3.codes/threads/fd5f11b9-19f2-4ab4-9a8f-3fb1e4ad00e0/mcp%3A3994db18-905c-4f40-b1a5-f0085e8a313c) · [Round 2 T3 Thread](https://app.t3.codes/threads/fd5f11b9-19f2-4ab4-9a8f-3fb1e4ad00e0/mcp%3Adf4a69d4-d7d8-4416-adf6-779b53e0d505) |
| Sol 6.2 | 5/10 | — | [Round 1 T3 Thread](https://app.t3.codes/threads/fd5f11b9-19f2-4ab4-9a8f-3fb1e4ad00e0/mcp%3A46f50c4d-1f2f-4845-93ef-b37131c8cf92) |
| Gemini 4 Neon | 5/10 | — | Swarm `#22` (`neon-reviewer`, plus `#23` `compat-auditor`) |

*(Delegation note: Astra 6.2, Sol 6.2, and Gemini 4 Neon were selected to honor the user's explicit `"ONLY NEON, ASTRA OR SOL"` model preference. Claude Opus 5.5 is available at 100% quota if a 3rd model family is requested.)*

### 3.1 Consensus Round 1 P0 Fixes Incorporated
1. **Fresh T3 thread per attempt (no thread reuse across Deliberation Rounds or retries):**
   - `t3_thread_send` cannot alter workspace, `runtimeMode`, `interactionMode`, or `modelSelection`. Because `CouncilEngine` shifts `tools` (`read-only` -> `none`), `cwd`, `model`, and `reasoningEffort` across Clarification Batch, Deliberation Round, Voting, Rebuttal, and Retries, each attempt uses a fresh `t3_thread_launch` with a nonempty `title` and attempt-scoped `clientRequestId`.
2. **Run-scoped cancellation (never pass `stop: true`):**
   - Passing `stop: true` in `t3_thread_interrupt` ignores `runId`. Always call `t3_thread_interrupt({ threadId, runId, reason, clientRequestId })` without `stop`, using a **fresh bounded `AbortSignal.timeout(1500)`** (`1,000–2,000 ms`, never the already-aborted attempt signal) and preserving `executeWithTimeout`'s `_latchedTimeout` / `AbortError` first-cause latch.
3. **Never default headless runs to `runtimeMode: "approval-required"`:**
   - Because `t3_pending_request` cannot approve permission prompts, `approval-required` can strand headless Seats and the Judge waiting for UI clicks until `timeoutMs` expires. Target non-blocking mode (`interactionMode: "plan"`, `runtimeMode: "auto"`), detect stalled UI prompts via `thread.pendingRequestCount > 0` after wait slices -> interrupt & throw `HeadlessToolDeniedError`, and verify per-Harness behavior under the live smoke gate before cutover.
4. **Three-regime workspace mapping:**
   - `tools: "none"` -> ALWAYS `scratch: true` (never mount repo root).
   - `tools: "read-only"` with **no `cwd`** -> `scratch: true` (matching `/ask-council` without `--cwd`; never silently mount `the-council`'s own `projectId`).
   - `tools: "read-only"` with **explicit `cwd`** -> resolve `projectId` from `t3_project_list` and bind `workspaceStrategy: { type: "root" }` with `interactionMode: "plan"`, `runtimeMode: "auto"` (failing preflight if the explicit `cwd` does not map to a T3 project), plus post-turn `t3_thread_read({ view: "activity" })` `.council/` audit (see Section 3.3).
5. **Strict completion check, pagination & message-length guard:**
   - Require `timedOut === false && status === 'completed'` for the expected `runId` before reading/parsing `assistant_message` (never accept schema-valid text from a failed/interrupted run).
   - Page `t3_thread_read({ view: 'messages', afterPosition: -1, maxCharsPerItem: 20000 })` forward until `hasMore === false` (not `nextPosition`) AND reassemble clipped text via `itemId` + `textOffset=nextTextOffset`, bounded by `maxPages` / `maxResponseBytes` (fail closed on truncation).
   - Reject formatted turn messages `> 120,000` chars pre-launch (matching `t3_thread_launch.message.maxLength: 120000`).
6. **Preflight `healthCheck()` + Auth + Capability Discovery before Round 1:**
   - Run deduplicated preflight in `src/cli/index.js` before `validateModel()` and `engine.run()`: validate `T3_MCP_TOKEN` / caller authority, reject cleartext non-loopback `http://` URLs when a token is configured, discover live `orchestrator_capabilities` + `t3_project_list`, and fail fast before Round 1 on `401 invalid_mcp_credential` or missing capabilities. Redact `T3_MCP_TOKEN` everywhere.

### 3.2 Verified Low-Cost Round 2 Fixes Incorporated (All 8)
1. **HTTP `Accept` & session header handshake:** Send `Accept: application/json, text/event-stream` on every HTTP `POST` (prevents T3 `406`), and forward `Mcp-Session-Id` captured from `initialize` onto `notifications/initialized` as well as `tools/call`.
2. **`hasMore === false` pagination terminator:** Terminate forward `t3_thread_read` paging strictly on `hasMore === false` (never treating non-null `nextPosition` alone as more pages, since T3 may return a non-null cursor on the final page).
3. **Strict completion gate, nonempty `title`, and `> 120,000` char pre-launch guard:** Require `timedOut === false && status === 'completed'` for the expected `runId` before parsing `assistant_message`; always send a nonempty `title` on `t3_thread_launch`; reject formatted turn text `> 120,000` chars before calling T3.
4. **Reuse active attempt telemetry gate:** Call `getActiveAttemptTelemetryGate()` inside `T3HarnessAdapter` to reuse the gate already created by `HarnessAdapter.executeWithTimeout()` (never create a duplicate gate).
5. **Headless stall detection via `thread.pendingRequestCount`:** Check `thread.pendingRequestCount > 0` after wait slices and immediately interrupt + throw `HeadlessToolDeniedError` so headless approval/question stalls never burn the full turn deadline.
6. **Strip `T3_MCP_TOKEN` from legacy CLI subprocesses during coexistence:** Explicitly delete `T3_MCP_TOKEN` inside `buildSanitizedCliEnv()` (`src/harness/cli-runner.js:3858`) and `listAntigravityModels()` (`src/harness/cli-runner.js:5673`) so `--backend cli` subprocesses cannot inherit the T3 MCP credential.
7. **Capability-driven validation + `recovery.js` descriptors:** Drive T3 capability/option validation from `orchestrator_capabilities` (separating T3 catalog availability from `model-policy.md` policy) and pass T3 capability descriptors into `recovery.js` so `--backend t3 --retry-effort-fallback` NEVER falls through to `listAntigravityModels()` / `agy models`.
8. **Direct Clarification contract test:** Add direct Harness contract tests for `QUESTION:` / `CLEAR:` clarification parsing in `test/unit/t3-harness-adapter.test.js` alongside `CouncilEngine` E2E tests.

### 3.3 Honest T3 Trust Boundary (Explicit Scope Guard Against Overbuilding)
Round 2 also raised three hardening suggestions that would re-introduce `src/pilot/` custody complexity or alter core `CouncilEngine` semantics. We explicitly decline overbuilding and document the honest trust boundary for v1:

- **Execution permissions (P0 #1 boundary):** T3 MCP does not expose OS-level per-turn tool-disable flags or `.council/` path exclusions (and Codex `runtimeMode: "auto"` uses `workspaceWrite` under the hood, relying on `interactionMode: "plan"` for read-only behavior). Under `--backend t3`, **T3 owns execution sandboxing and permissions** (`scratch: true` + `interactionMode: "plan"` + `runtimeMode: "auto"` for `tools: "none"` or absent `cwd`; resolved `projectId` + `workspaceStrategy: { type: "root" }` + `interactionMode: "plan"` + `runtimeMode: "auto"` for explicit `cwd`), with post-turn `view: "activity"` `.council/` inspection acting as best-effort telemetry and `FORBIDDEN_STATE_ACCESS` guard. Users needing strict OS-level `read-only` sandboxing or `.council/` filtered-copy isolation continue using `--backend cli` during coexistence.
- **Bounded pragmatic cancellation (P0 #2 boundary):** Pass attempt-scoped `clientRequestId` on `t3_thread_launch`; if `runId` is null on the launch reply, perform **one** bounded `t3_thread_read` check for `latestRunId` or fail cleanly; on timeout/abort send run-scoped `t3_thread_interrupt({ threadId, runId, reason, clientRequestId })` (omitting `stop: true`) under a short `1,000–2,000 ms` bounded cleanup timeout (`1500 ms` default); **ONLY** archive threads (`t3_thread_organize({ action: "archive" })`) when confirmed terminal (leaving unconfirmed or interrupted-in-flight threads visible in T3 UI rather than building a background reaper).
- **Keep `CouncilEngine` untouched (P1 #5b boundary):** Preflight `healthCheck()` catches missing or expired `T3_MCP_TOKEN` before Round 1 begins. We intentionally do **not** modify `CouncilEngine`'s `EXCUSE_SEAT` reducer for rare mid-Council token expiry in v1.

### 3.4 Structured Output Resolution (`parseStructuredOutput` vs. `outputSchema`)
- *Sol 6.2 & Gemini 4 Neon* recommend **v1 on `parseStructuredOutput()`** over final `assistant_message` text, because `clarification` uses `QUESTION:`/`CLEAR:` plain text and `judge_synthesis` uses dynamic `proofDecisions` keys (`P1`, `P2`, ...) that break strict `additionalProperties: false` across Harnesses, plus T3 `outputSchema` exposes `t3_submit_output` even when `tools: "none"`.
- *Astra 6.2* favors `outputSchema` + `wait({ untilOutput: true })` if qualified across Harnesses, or an explicitly qualified text-only mode.
- **Spec resolution:** Default v1 to the unified `parseStructuredOutput()` text contract (no `outputSchema` on `t3_thread_launch`), preserving 100% `clarification` / `proof` / `vote` / `judge_synthesis` fidelity and avoiding `t3_submit_output` tool injection on `tools: "none"`.

---

## 4. Target Architecture & Compatibility Plan

### 4.1 Clean Module Decomposition
To decouple `T3HarnessAdapter`, `CouncilEngine`, `config.js`, `recovery.js`, and `ledger.js` from `src/harness/cli-runner.js` (6,021 LOC) with **zero breakage to existing tests**:

1. **Extract pure shared modules (~500 LOC) with re-exports from `cli-runner.js`:**
   - `src/harness/model-utils.js` (~160 LOC): `ALLOWED_EFFORTS`, `CODEX_EFFORT_MAP`, `parseModelAndEffort`, `extractCanonicalBaseModel`, `downshiftEffort`, `downshiftModel`.
   - `src/harness/telemetry-utils.js` (~350 LOC): `VALID_DRAIN_STATUSES`, `LIFECYCLE_ISO_KEYS`, `LIFECYCLE_INT_KEYS`, `MAX_CLI_ERROR_MESSAGE_BYTES`, `MAX_CLI_STDERR_BYTES`, `PROVIDER_HTTP_429_REGEX`, `PROVIDER_HTTP_AUTH_REGEX`, `sliceUtf8Bytes`, `redactPromptInText`, `normalizeExitCode`, `normalizeSignalName`, `sanitizeLifecycleMetadata`, `createAttemptTelemetryGate`, `runWithAttemptTelemetryGate`, `getActiveAttemptTelemetryGate`, `markAttemptGateFinalized`, `markAttemptGateCancelled`, `normalizeProviderTrace`, `recordProviderCall` (plus lightweight `.council/` forbidden-access token/path detector decoupled from shell parser).
   - Strip `T3_MCP_TOKEN` inside `buildSanitizedCliEnv()` (`src/harness/cli-runner.js:3858`) and `listAntigravityModels()` (`src/harness/cli-runner.js:5673`).
2. **Add `src/harness/t3-mcp-client.js` (`T3McpClient`):**
   - Zero npm dependencies (Node >= 22 global `fetch`, NOT `import('node:fetch')`).
   - Streamable HTTP MCP `2025-06-18` client: single-flight serialized `initialize` -> capture `Mcp-Session-Id` & negotiated `MCP-Protocol-Version` -> send `notifications/initialized` with `Mcp-Session-Id` and `Accept: application/json, text/event-stream` (`202` empty-body handling).
   - Every HTTP `POST` sends `Accept: application/json, text/event-stream`, uses `redirect: 'error'` when auth headers are attached, rejects cleartext non-loopback `http://` URLs with tokens, parses `application/json` & chunk-safe UTF-8 `text/event-stream` SSE (CRLF, multiline `data:`, comments, JSON-RPC `id` correlation, bounded bytes), maps HTTP `401`/`403` (`invalid_mcp_credential`) -> non-retryable `AuthenticationError`, performs single serialized re-init on HTTP `404` session loss, distinguishes JSON-RPC errors and MCP `result.isError === true`, redacts tokens everywhere, and exposes an injected `callTool(name, args, { signal })` testing/host seam.
3. **Add `src/harness/t3.js` (`T3HarnessAdapter extends HarnessAdapter`):**
   - Uses existing `src/seats/soul.js` formatters, `captureAttemptInvocationMeta` (in-place mutation), `registerAttemptPrompt`, `_withRetryFeedback`, `super.executeWithTimeout`, and **`getActiveAttemptTelemetryGate()`** + `recordProviderCall` (never creating a duplicate gate).
   - Rejects formatted turn messages `> 120,000` chars pre-launch; enforces nonempty `title` and attempt-scoped `clientRequestId`.
   - Implements `validateModel()` synchronously and dynamic capability-driven `translateModelSelection()` from `orchestrator_capabilities` descriptors (`reasoningEffort` / `thought_level` / `reasoning_effort` / `effort` / omitted for `composer-2.5` & `gemini-pro-orchestrator-neon`), separating catalog availability from `model-policy.md` policy, plus `healthCheck()` and `shutdown()`.
   - Fresh `t3_thread_launch` per attempt (no `outputSchema` in v1; `scratch: true` for `tools: 'none'` or absent `cwd`; resolved `projectId` + `workspaceStrategy: { type: 'root' }` for explicit `cwd`; `interactionMode: 'plan'`, `runtimeMode: 'auto'`). If launch omits `runId`, performs one bounded `t3_thread_read` check for `latestRunId` or fails cleanly.
   - Loops `t3_thread_wait({ threadId, runId, timeoutMs })` slices within Seat/Judge deadline + `AbortSignal`, checking `thread.pendingRequestCount > 0` after slices -> interrupt & throw `HeadlessToolDeniedError`.
   - Requires `timedOut === false && status === 'completed'` for expected `runId`; reads `view: 'messages'` paging forward until `hasMore === false` + bounded `itemId`/`textOffset` reassembly (fail closed on truncation); reads `view: 'activity'` for best-effort `.council/` trace audit; validates via `super.parseStructuredOutput(rawText, schemaType)`.
   - On timeout/abort: calls run-scoped `t3_thread_interrupt({ threadId, runId, reason, clientRequestId })` (**omitting `stop: true`**) under fresh `AbortSignal.timeout(1500)`, preserving `_latchedTimeout` / `AbortError`.
   - Archives via `t3_thread_organize({ threadId, action: 'archive' })` **ONLY** when `archiveThreads && confirmedTerminal`.
4. **Coexistence wiring (`src/harness/index.js`, `src/cli/index.js`, `src/engine/recovery.js`, `GLOSSARY.md`):**
   - Add explicit backend selector (`--backend cli|t3` and `COUNCIL_HARNESS_BACKEND=cli|t3`; default `'cli'`, selected once per Council, no silent mid-Council failover). Share one `T3McpClient` across logical Harnesses inside `HarnessRegistry`.
   - In `runCli --live --backend t3`, run deduplicated `healthCheck()` before `validateModel()` and `engine.run()`, feed T3 `orchestrator_capabilities` descriptors into adapters and `validateRetryFallbackCapability()` (NEVER invoking `listAntigravityModels()` / `agy models`), and validate explicit `cwd` resolves to a T3 project when any participant uses `tools !== 'none'`.
   - Add T3 v5 models (`gpt-6.2-sol`, `gpt-6.2-astra`, `gemini-4-neon`, `gemini-4-hydrogen`, `gemini-pro-orchestrator-neon: null`) to `STATIC_CAPABILITY_CATALOG` in `src/engine/recovery.js` and honor T3 capability descriptors cleanly.
   - Update `GLOSSARY.md` (`Harness` entry) so Orca retirement matches ADR-0005.

---

## 5. Verification & Qualification Strategy

1. **Shared Utility Extraction & Env Isolation Tests (`test/unit/t3-shared-utils.test.js`):** Verify backward-compatible re-exports from `cli-runner.js`, zero circular dependency on subprocess code, and `T3_MCP_TOKEN` stripping in `buildSanitizedCliEnv()` and `listAntigravityModels()`.
2. **Hermetic HTTP MCP Client Tests (`test/unit/t3-mcp-client.test.js`):** Local ephemeral `node:http` server covering `Accept: application/json, text/event-stream` on every `POST`, concurrent single-flight `initialize`, `Mcp-Session-Id` on `notifications/initialized` + `tools/call`, `401 invalid_mcp_credential`, `404` session expiry re-init, `application/json` & chunked/UTF-8 `text/event-stream` SSE, JSON-RPC errors, MCP `isError: true`, cleartext non-loopback rejection, `redirect: 'error'`, and token redaction.
3. **Direct `T3HarnessAdapter` Contract Tests (`test/unit/t3-harness-adapter.test.js`):** Direct `QUESTION:` and `CLEAR:` clarification parsing, Proof/Vote/Judge turns, forward pagination stopping on `hasMore === false` (even when `nextPosition` is non-null) + `> 20 KB` `itemId`/`textOffset` reassembly, rejecting schema-valid text from non-`completed` runs, `> 120,000`-char pre-launch guard, `thread.pendingRequestCount > 0` -> `HeadlessToolDeniedError`, run-scoped `t3_thread_interrupt` (no `stop: true`), no archive unless confirmed terminal, and single-receipt gate reuse via `getActiveAttemptTelemetryGate()`.
4. **Real `CouncilEngine` + CLI E2E Tests (`test/unit/t3-council-e2e.test.js`):** Mock HTTP T3 server driving full `Clarification Batch -> Deliberation Round -> Proof -> Judge Candidate -> Voting (tools: "none") -> Timeout Recovery -> Excused Seat Objection lock`, `VisualizerLiveWatcher` single-receipt telemetry, and `runCli --live --backend t3` preflight `401` + `--retry-effort-fallback` zero `agy models` invocation assertions.
5. **Existing Suite Preservation:** Full `npm test` (`1,493` tests) remains `100%` passing under `--backend cli` coexistence.
6. **Opt-In Pre-Cutover Live Qualification Gate (`test/unit/t3-live-smoke.test.js`, gated on `LIVE_T3_SMOKE=1 && T3_MCP_TOKEN`):** Verify real standalone `bin/council` dispatch against `codex`, `antigravity`, and `cursor` for `(interactionMode: "plan", runtimeMode: "auto")`, tool-free isolation, model/effort fidelity, and run-scoped interrupt settlement before proposing a follow-up PR to make `t3` default and delete `cli-runner.js`.

---

## 6. Locked Decisions (Approved at Stage 1 Gate)

All three open choices are **locked in** (backed unanimously by Astra 6.2, Sol 6.2, and Gemini 4 Neon, and approved for Stage 2 `superpowers:writing-plans`):

1. **Thread Lifecycle Across Deliberation Rounds — LOCKED: Option B (Fresh T3 thread per attempt + archive only confirmed terminal threads).**
   Each Seat, Judge, or retry dispatches a fresh `t3_thread_launch` (never reusing threads via `t3_thread_send`), and archives via `t3_thread_organize({ action: "archive" })` **only** when the run is confirmed terminal (leaving unconfirmed threads visible in T3 UI).
2. **Legacy CLI Runners During Implementation — LOCKED: Option B (Coexist behind `--backend t3|cli` with `cli` default).**
   Keep direct CLI (`cli`) as default during implementation and live qualification (`0` broken existing tests; `T3_MCP_TOKEN` stripped from CLI child environments), keeping `CouncilEngine` untouched and deleting `cli-runner.js` + legacy adapters in a follow-up cleanup PR only after `--backend t3` live parity is verified across Codex, Antigravity, and Cursor.
3. **Old Issue #107 Branch (`fix/issue-107-agy-stream-json`) — LOCKED: Option A (Keep untouched locally until `--backend t3` parity is verified live).**
   Leave `fix/issue-107-agy-stream-json` unmerged and untouched locally until `feat/t3-mcp-harness` is implemented, live-verified, and ready, then delete (`git branch -D fix/issue-107-agy-stream-json`).
