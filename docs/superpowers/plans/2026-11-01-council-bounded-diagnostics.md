# Council bounded diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist bounded provider diagnostics without raw protocol capture while preserving validated Council results and lifecycle evidence.

**Architecture:** Use one strict diagnostic contract at producer and propagation boundaries. Keep validated results and required private bindings outside diagnostic summaries. Validate versioned artifacts before consumers use them.

**Tech Stack:** TypeScript, Node.js, Zod 4.6.7, Vitest 5.0.5, existing offline provider and native fixtures.

**Spec:** `docs/superpowers/specs/2026-11-01-council-provider-lifecycle-and-diagnostics-design.md`, SHA-256 `ff07db3e3ffcda082a329a10998448533993ff28bfcb8c1c4f9523b92459479a`. The posted Agent Brief in `issue-10.json`, comment `IC_kwDOVcK9P88AAAABhmkuAg`, is the implementation contract. The user has approved the design. Its earlier status text does not revoke that approval.

## Global Constraints

- “The proposed maximum encoded JSON size is 4,096 UTF-8 bytes per complete diagnostic summary.”
- “Arbitrary messages, stack traces, protocol lines and extra initialization keys must not enter that projection.”
- “Unknown exceptions and unknown provider codes must become an explicit unknown classification.”
- “Absent evidence must remain explicit.”
- “Validated result envelopes and payloads remain separate from diagnostics.”
- “Required binding, packet, assignment and report hashes remain verifiable.”
- “Incompatible historical evidence must fail clearly. There must be no fallback to raw legacy diagnostics.”
- “No timeout increase, blanket test serialization, skipped assertion or weakened acceptance criterion is permitted.”
- Preserve original exit/signal receipts, no-input gates, conservative reservations, ownership, restrictive modes and positive settlement requirements.
- Do not rewrite historical artifacts or journals. Do not add raw-capture modes.
- Do not change provider settings, trust, permissions, accounts, spending, cleanup timing or unrelated work.
- Implement only after integrated #9 and the current-interface check below. Do not execute the paused #9 operation here.
- The authoring baseline is `9aff16ceb97e9420ab346552c04405c38d2ffde8`, branch `dev/issue-1-first-use-reviewed`.
- All new names below are proposals. The current checkout does not contain these contracts.
- The coordinator owns review dispatch, integration and acceptance. Existing design approval requires no repeated user approval gate.

## Review Focus

- An exception before initialization must receive the same projection as a normal report. Task 2 tests fallback files and errors.
- Missing acknowledgement must preserve reservations and unacknowledged cancellation. Tasks 3 and 6 test all delivery states.
- Extra nested metadata and repeated stream chunks must not escape through indirect fields. Tasks 1, 2 and 5 test these paths.
- UTF-8 size boundaries must apply to the complete summary. Task 1 tests exact sizes and multibyte input.
- A projected report must retain native bindings and reject uncertain settlement. Tasks 3 and 7 retain the negative lifecycle matrix.

---

## Execution boundary and file responsibilities

This is the product implementation roadmap, not authorization for this author to execute it. No proposed command was run during authoring.

The reviewed #9 plan has SHA-256 `8c86fadf038743c17a4a9cbf21a1645265be505220844b0fb6930432201658b8`. It proposes `recordFailure(code: string)`, `PROVIDER_INPUT_DEADLINE`, `process.parsingSettled` and `process.processScansSettled`. These are not baseline interfaces. Before Task 1, the coordinator records the integrated #9 commit and inspects its actual signatures. Missing or different interfaces require a bounded plan correction before dependent implementation. This is an interface dependency, not a new design-approval gate.

| File | Responsibility |
| --- | --- |
| `src/pilot/diagnostics.ts` (new) | Finite registry, safe errors, counters, summary construction and size validation |
| `src/pilot/wrapper-contract.ts` | Strict v2 provider/prepared schemas and projected initialization types |
| `src/pilot/provider-session.ts` | Stream measurement, first failure, projected reports and prepared artifacts |
| `src/pilot/host-wrapper.ts` | Safe fallback, native completion and entry errors |
| `src/pilot/context-driver.ts` | Version validation, attempts, cancellation and existing lifecycle gates |
| `src/pilot/types.ts` | Typed attempt/cancellation diagnostics and explicit initialization uncertainty |
| `src/pilot/allowance.ts`, `src/pilot/native-command.ts` | Shared safe native error handling |
| `src/pilot/journal.ts` | Event-specific projection and versioned append-only records |
| `src/pilot/workflow.ts`, `src/pilot/cli.ts` | Code-only failures, bounded summaries and persisted outcomes |
| `src/pilot/orca-driver.ts`, `src/pilot/config.ts`, `src/pilot/qualification-cache.ts` | Finite owned error carriers and separate mutation identities |
| `test/pilot/diagnostic-fixture.ts`, `test/pilot/fixtures/diagnostic-provider.cjs` (new) | Credential-free assignments, canaries and owned fixture settlement |
| `test/pilot/provider-diagnostics.test.ts`, `diagnostics.test.ts`, `wrapper-diagnostics.test.ts`, `context-diagnostics.test.ts`, `journal-diagnostics.test.ts`, `workflow-diagnostics.test.ts`, `cli-diagnostics.test.ts` under `test/pilot/` (new) | Producer and propagation regressions |

Do not edit the existing dirty `test/pilot/fixtures/agy-startup-provider.cjs` or adopt its changes. Keep new diagnostic modes in the new fixture. Do not overwrite untracked #9 tests or their watchdog.

## Shared proposed contract

All tasks consume this single contract. Do not create another local allowlist.

### Registry and exact constants

Export these values from `src/pilot/diagnostics.ts`:

```ts
export const MAX_DIAGNOSTIC_SUMMARY_BYTES = 4096;
export const DIAGNOSTIC_COUNTER_MAX = 2147483647;
export const DIAGNOSTIC_SUMMARY_VERSION = 1;
export const DIAGNOSTIC_ORIGINS = ["provider", "host-wrapper", "context-driver", "native-driver", "native-read", "journal", "workflow", "cli", "unknown"] as const;
export const DIAGNOSTIC_PHASES = ["bootstrap", "initialization", "input", "inference", "cancellation", "cleanup", "validation", "persistence", "native-read", "unknown"] as const;
export const DIAGNOSTIC_CLASSES = ["none", "control", "protocol", "transport", "timeout", "authentication", "denial", "exhaustion", "cancellation", "validation", "persistence", "unknown"] as const;
export const INPUT_DELIVERY_STATES = ["not_attempted", "attempted_unacknowledged", "acknowledged", "unknown"] as const;
```

`DiagnosticCode` is the literal union of the following exact finite set. Export the set as `DIAGNOSTIC_CODES`. Include no prefix, substring or regular-expression admission rule.

```text
NONE DIAGNOSTIC_UNKNOWN DIAGNOSTIC_SUMMARY_INVALID DIAGNOSTIC_SUMMARY_TOO_LARGE
PROVIDER_BOOTSTRAP_UNVERIFIED PROVIDER_CONTROL_SOURCE_DRIFT
PROVIDER_PREINPUT_CONTROL_UNSUPPORTED PROVIDER_PREINPUT_CONTROL_UNVERIFIED
PROVIDER_PACKET_ROOT_MISMATCH PROVIDER_PACKET_ROOT_UNVERIFIED
PROVIDER_PROFILE_SCOPE_INVALID PROVIDER_PROFILE_SYMLINK PROVIDER_PROFILE_CUSTODY_INVALID
PROVIDER_PROFILE_CONTENT_MISMATCH PROVIDER_PROFILE_ROUTE_MISMATCH
PROVIDER_AGENT_DEFINITION_UNBOUND PROVIDER_MULTIPLE_INIT
PROVIDER_EFFECTIVE_CONTROLS_UNVERIFIED PROVIDER_FINAL_ORDER_INVALID PROVIDER_FINAL_INVALID
PROVIDER_CONVERSATION_UNBOUND PROVIDER_UNCONTROLLED_TOOL PROVIDER_STREAM_EVENT_UNSUPPORTED
PROVIDER_MULTIPLE_FINAL PROVIDER_OUTPUT_OVERFLOW PROVIDER_INVALID_UTF8
PROVIDER_STDERR_UNCLASSIFIED PROVIDER_INPUT_CLOSED PROVIDER_PROCESS_START_FAILED
PROVIDER_CANCEL_UNBOUND PROVIDER_PREINPUT_INIT_UNAVAILABLE
PROVIDER_DESCENDANT_CONTROL_UNVERIFIED PROVIDER_INPUT_AUTHORITY_UNVERIFIED
PROVIDER_INPUT_DEADLINE PROVIDER_INITIALIZATION_CANCELLED PROVIDER_INFERENCE_DEADLINE
PROVIDER_FAILURE PROVIDER_TRUNCATED_FINAL PROVIDER_PROCESS_SETTLEMENT_UNVERIFIED
PROVIDER_FINAL_NOT_SUCCESSFUL PROVIDER_RESULT_UNBOUND PROVIDER_INITIALIZATION_FAILED
CODEX_APP_SERVER_ERROR CODEX_EFFECTIVE_CONFIG_UNVERIFIED CODEX_REQUIREMENTS_DENIED
CODEX_PROFILE_NOT_ALLOWED CODEX_THREAD_SELECTION_UNVERIFIED CODEX_ACTIVE_TURN_UNVERIFIED
CODEX_TURN_FAILED CODEX_THREAD_UNBOUND
WRAPPER_START_SCOPE_INVALID WRAPPER_GENUINE_CALLER_UNVERIFIED WRAPPER_PRODUCER_CODE_DRIFT
WRAPPER_NATIVE_DISPATCH_UNVERIFIED WRAPPER_NATIVE_INTENT_UNVERIFIED
WRAPPER_PROVIDER_INITIALIZATION_FAILED WRAPPER_NATIVE_COMPLETION_UNKNOWN WRAPPER_FAILED
WRAPPER_BOOTSTRAP_CONTROLS_UNVERIFIED WRAPPER_DIRECTORY_UNVERIFIED
WRAPPER_TERMINAL_OUTCOME_UNKNOWN WRAPPER_WORKSPACE_MISMATCH WRAPPER_TASK_OUTCOME_UNKNOWN
WRAPPER_DISPATCH_AUTHORITY_UNVERIFIED WRAPPER_EFFECTIVE_CONTROLS_UNVERIFIED
WRAPPER_INPUT_ACK_UNKNOWN WRAPPER_INPUT_MUTATION_UNKNOWN WRAPPER_INPUT_ACK_UNBOUND
WRAPPER_INPUT_DELIVERY_UNVERIFIED WRAPPER_INITIALIZATION_DEADLINE WRAPPER_NOT_OWNED
WRAPPER_PROVIDER_FAILED WRAPPER_RESULT_BINDING_MISMATCH WRAPPER_RESULT_DEADLINE
WRAPPER_RESULT_UNBOUND WRAPPER_NATIVE_AUTHORITY_UNBOUND WRAPPER_NATIVE_COMPLETION_UNVERIFIED
WRAPPER_ARTIFACT_SYMLINK WRAPPER_ARTIFACT_TOO_LARGE WRAPPER_DIAGNOSTIC_VERSION_UNSUPPORTED
INVALID_FINITE_BOUNDS_OR_INPUT INSUFFICIENT_CALL_BUDGET CALL_OR_DEADLINE_LIMIT
NATIVE_INFERENCE_DEADLINE NATIVE_EFFECTIVE_SELECTION_MISMATCH
CANCELLATION_SETTLEMENT_UNKNOWN CANCELLATION_UNACKNOWLEDGED RELEASE_UNKNOWN
INVALID_NORMAL-PROBE_RESULT INVALID_CANCEL-PROBE_RESULT INVALID_READINESS_RESULT
INVALID_REVIEW_RESULT INVALID_JUDGE_RESULT INVALID_BALLOT_RESULT
NATIVE_PACKET_ARGUMENT_TOO_LARGE NATIVE_FAILURE NATIVE_INSPECTION_UNVERIFIED
NATIVE_RUN_CREATION_OUTCOME_UNKNOWN NATIVE_RESOURCE_NOT_JOURNAL_OWNED
NATIVE_RUN_ID_MISSING LAUNCH_OUTCOME_UNKNOWN NATIVE_BINDING_MISMATCH
NATIVE_LIFECYCLE_UNKNOWN NATIVE_WORKER_FAILED NATIVE_RESULT_DEADLINE
NATIVE_TRANSCRIPT_UNBOUND NATIVE_TRANSCRIPT_CLIPPED NATIVE_TRANSCRIPT_INCOMPLETE
NATIVE_RESULT_MALFORMED_OR_MISMATCHED
QUALIFICATION_CACHE_SYMLINK QUALIFICATION_CACHE_CORRUPT
QUALIFICATION_CACHE_NATIVE_EVIDENCE_UNVERIFIED QUALIFICATION_CACHE_CLOCK_INVALID
QUALIFICATION_CACHE_LOCK_OWNERSHIP_CHANGED PILOT_CONFIG_TOO_LARGE_OR_NOT_FILE
PILOT_CONFIG_INCOMPATIBLE
INVALID_NATIVE_RUN_ID NATIVE_JOURNAL_SYMLINK NATIVE_RUN_EXISTS_INSPECT_REQUIRED
INVALID_AUDIT_ACTION INVALID_AUDIT_ARGUMENTS INVALID_AUDIT_ROLE INVALID_NATIVE_ARGUMENTS
MISSING_--workspace MISSING_--input MISSING_--policy MISSING_--role MISSING_--hash
MISSING_--run MISSING_--task ABSOLUTE_ORCA_EXECUTABLE_REQUIRED NATIVE_INPUT_TOO_LARGE
NATIVE_OUTCOME_NOT_RECORDED NATIVE_PERSISTENCE_OR_CLOSE_FAILED
QUALIFICATION_CACHE_BUSY_RECONCILE NATIVE_REQUEST_INVALID NATIVE_JOURNAL_EVENT_UNSUPPORTED
ETIMEDOUT ECONNRESET ECONNREFUSED EPIPE ENOTFOUND TIMEOUT REQUEST_TIMEOUT
runtime_timeout runtime_unavailable invalid_runtime_response permission_denied forbidden
method_not_found unauthorized unsupported quota_exceeded stable_pane_required run_required
terminal_handle_stale operation_unknown incompatible_runtime terminal_gone
HTTP_401 HTTP_403 ORCA_RUNTIME_BINDING_MISMATCH ORCA_COMMAND_REGISTRY_INVALID
ORCA_INVALID_ENVELOPE ORCA_CLI_DIAGNOSTICS_PRESENT
```

Split the text on whitespace to define the literal entries. The hyphens in `INVALID_NORMAL-PROBE_RESULT`, `INVALID_CANCEL-PROBE_RESULT` and `MISSING_--*` are intentional source literals. A code not listed here maps to `DIAGNOSTIC_UNKNOWN`. Match controlled `Error.message` only by whole-string membership. A validated `PilotDiagnosticError` summary has first priority. Otherwise, prefer an exact finite `Error.message` member. For other native exceptions, use the exact `code` property, then `response.error.code`. An arbitrary `ORCA_` prefix grants no membership. Preserve a different allowed native property code as a finite detail when useful. Canonicalize only the listed native string codes, case-insensitively. Map numeric `401` and `403` to `HTTP_401` and `HTTP_403`. Other numbers become unknown. Never call an arbitrary object's `toString()` for persistence.

Export `DIAGNOSTIC_SIGNALS` with these exact entries:

```text
SIGABRT SIGALRM SIGBUS SIGCHLD SIGCONT SIGFPE SIGHUP SIGILL SIGINT SIGIO SIGIOT
SIGKILL SIGPIPE SIGPOLL SIGPROF SIGPWR SIGQUIT SIGSEGV SIGSTKFLT SIGSTOP SIGSYS
SIGTERM SIGTRAP SIGTSTP SIGTTIN SIGTTOU SIGURG SIGUSR1 SIGUSR2 SIGVTALRM SIGWINCH
SIGXCPU SIGXFSZ SIGBREAK SIGINFO SIGEMT SIGLOST SIGUNUSED
```

Use actual child-close evidence for signal and exit status. Never derive them from exception text. Preserve original safe-integer exit values without saturation. An unknown signal has explicit unknown state and no copied text.

### Types, size and omission rules

```ts
export type DiagnosticCode = typeof DIAGNOSTIC_CODES[number];
export type DiagnosticOrigin = typeof DIAGNOSTIC_ORIGINS[number];
export type DiagnosticPhase = typeof DIAGNOSTIC_PHASES[number];
export type DiagnosticClass = typeof DIAGNOSTIC_CLASSES[number];
export type InputDeliveryState = typeof INPUT_DELIVERY_STATES[number];
export type DiagnosticSignal = typeof DIAGNOSTIC_SIGNALS[number];
export interface DiagnosticDetail {
  origin: DiagnosticOrigin; phase: DiagnosticPhase; code: DiagnosticCode;
}
export interface DiagnosticSummary extends DiagnosticDetail {
  version: 1;
  classification: DiagnosticClass;
  inputDelivery: InputDeliveryState;
  exit: { state: "observed" | "not_started" | "unknown"; code: number | null;
    signal: DiagnosticSignal | null; signalState: "observed" | "none" | "unknown" };
  counters: { stdoutBytes: number; stdoutChunks: number; stderrBytes: number;
    stderrChunks: number; exceptions: number; unknownCodes: number };
  omissions: { stdout: boolean; stderr: boolean; exceptionText: boolean;
    initializationExtras: boolean; details: number; countersSaturated: boolean };
  truncated: boolean;
  details: DiagnosticDetail[];
}
export interface DiagnosticContext {
  origin: DiagnosticOrigin; phase: DiagnosticPhase;
  inputDelivery?: InputDeliveryState;
}
export function diagnosticCode(value: unknown): DiagnosticCode;
export function diagnosticClass(code: DiagnosticCode): DiagnosticClass;
export function addDiagnosticCount(current: number, increment: number): number;
export function projectDiagnostic(cause: unknown, context: DiagnosticContext,
  evidence?: Partial<Pick<DiagnosticSummary, "exit" | "counters" | "omissions" | "details">>): DiagnosticSummary;
export function fitDiagnosticSummary(candidate: DiagnosticSummary): DiagnosticSummary;
export function parseDiagnosticSummary(value: unknown): DiagnosticSummary;
export class PilotDiagnosticError extends Error {
  readonly diagnostic: DiagnosticSummary;
  readonly mutationRequestId?: string;
  constructor(diagnostic: DiagnosticSummary, mutationRequestId?: string);
}
export function diagnosticError(cause: unknown, context: DiagnosticContext): PilotDiagnosticError;
```

`PilotDiagnosticError.message` is exactly `diagnostic.code`. Its constructor retains only an owned UUID mutation identity. It retains no raw `cause`, stack from another error or enumerable exception properties. Do not stringify an injected object.

`diagnosticClass` has these ordered rules. `NONE` maps to `none`. The five input/inference/initialization/native timeout codes plus `ETIMEDOUT`, `TIMEOUT`, `REQUEST_TIMEOUT`, `runtime_timeout` map to `timeout`. These five are `PROVIDER_INPUT_DEADLINE`, `PROVIDER_INFERENCE_DEADLINE`, `WRAPPER_INITIALIZATION_DEADLINE`, `WRAPPER_RESULT_DEADLINE`, `NATIVE_INFERENCE_DEADLINE`. Also map `NATIVE_RESULT_DEADLINE` to `timeout`. `HTTP_401` and `unauthorized` map to `authentication`. `HTTP_403`, `permission_denied`, `forbidden` map to `denial`. `quota_exceeded` maps to `exhaustion`. `ECONNRESET`, `ECONNREFUSED`, `EPIPE`, `ENOTFOUND`, `runtime_unavailable`, `invalid_runtime_response` map to `transport`. `PROVIDER_INITIALIZATION_CANCELLED`, `CANCELLATION_UNACKNOWLEDGED`, `CANCELLATION_SETTLEMENT_UNKNOWN` map to `cancellation`. The two `DIAGNOSTIC_SUMMARY_*` errors, `NATIVE_REQUEST_INVALID`, `PROVIDER_RESULT_UNBOUND`, `NATIVE_RESULT_MALFORMED_OR_MISMATCHED`, `PILOT_CONFIG_INCOMPATIBLE` and six exact `INVALID_*_RESULT` entries map to `validation`. `NATIVE_PERSISTENCE_OR_CLOSE_FAILED`, `NATIVE_OUTCOME_NOT_RECORDED` map to `persistence`. `DIAGNOSTIC_UNKNOWN` maps to `unknown`. Other registry members map to `control`, except these protocol codes: `PROVIDER_MULTIPLE_INIT`, `PROVIDER_FINAL_ORDER_INVALID`, `PROVIDER_FINAL_INVALID`, `PROVIDER_MULTIPLE_FINAL`, `PROVIDER_OUTPUT_OVERFLOW`, `PROVIDER_INVALID_UTF8`, `PROVIDER_STDERR_UNCLASSIFIED`, `PROVIDER_STREAM_EVENT_UNSUPPORTED`, `PROVIDER_TRUNCATED_FINAL`, `CODEX_APP_SERVER_ERROR`, `CODEX_TURN_FAILED`. They map to `protocol`.

The strict summary schema permits exactly these keys, finite integers and enum values. Missing evidence becomes `unknown`, zero measured counters and false omission flags. Zero counters mean no measured bytes, not proof of containment. `not_attempted` requires positive no-mutation evidence. An attempted failed write is `attempted_unacknowledged`. A successful write acknowledgement is `acknowledged`.

Each counter is an integer from `0` through `2147483647`. Reject negative, fractional, NaN and infinite increments. Saturate safe nonnegative totals at the maximum. Set `countersSaturated` when any total exceeds it. This cap applies only to diagnostic counters, never business call reservations.

Measure `Buffer.byteLength(canonicalJson(summary), "utf8")`, including all keys, flags and details. The trailing JSONL newline is framing outside the summary. Use compact `canonicalJson(outcome)+"\n"` for both CLI outcome writes, including atomic replacement. Use compact `canonicalJson({...outcome,record})` for stdout. Pretty printing is not permitted at these diagnostic persistence boundaries. Tests measure the actual emitted summary byte slice before parsing. Retain core fields and first failure. If over budget, remove detail entries from the end, one at a time. Increase `omissions.details` with saturation. Set `truncated=true`. Re-encode after each removal because omission counters can grow. Identical input gives identical output. Never shorten a code, split UTF-8, add free-text padding or drop core evidence. A core that cannot fit throws `DIAGNOSTIC_SUMMARY_TOO_LARGE`; test that the fixed maximum-size core fits. The parser rejects oversized external summaries instead of silently repairing them.

Set `omissions.stdout` or `stderr` when the producer discards measured bytes, even over multiple chunks. Set `exceptionText` when an exception's text was excluded. Set `initializationExtras` when unchecked fields were excluded. These flags do not set `truncated`; that flag describes size-based detail omission. Optional detail entries contain codes only. Stop retaining detail candidates once no further candidate can fit. Count later omissions with a saturated counter. Do not retain an unbounded candidate list.

### Persisted versions and separation

| Contract | New rule |
| --- | --- |
| Provider `result.json` | `version:2`, required `diagnostic`, code-or-null `error`, no `stdout` or `stderr` keys |
| `prepared.json` | Add `version:2`, required `diagnostic`, code-or-null `error`, explicit projected `init` |
| `wrapper-ready.json` | Unchanged identity-only contract; no provider metadata is added |
| New journal lines | Envelope `{version:2,at,event}`; each diagnostic object uses summary version 1 |
| Persisted/printed `PilotOutcome` | Add `version:2`; optional `diagnostic`; `error` is code-only |
| Printed top-level CLI failure | Add `version:2`, required `diagnostic`, finite `reason` |
| Assignment, recipe, Council result envelope, context proof, cleanup receipt, cache container | Existing versions remain unchanged; their diagnostic layout does not change |

Export `PROVIDER_REPORT_VERSION=2`, `PREPARED_REPORT_VERSION=2` from `wrapper-contract.ts`. Export `PILOT_JOURNAL_VERSION=2` from `journal.ts` and `PILOT_OUTCOME_VERSION=2` from `workflow.ts`. Validate exact versions before reading a report's diagnostic fields. Missing, v1 or future report/prepared versions throw `WRAPPER_DIAGNOSTIC_VERSION_UNSUPPORTED`, without embedding document contents. Same-version malformed fields throw `WRAPPER_RESULT_UNBOUND`. New runs remain exclusive. Never append to, upgrade or rewrite an old journal. Existing cache proofs retain their historical bytes; changed `producerCodeHash()` and strict report checks invalidate affected context evidence. Do not add a compatibility reader that copies legacy diagnostics.

Keep assignmentHash, packetHash, controlsHash, binding, wrapperPid, native report digest, context resultHash and cleanupHash outside summaries. Hash the actual final artifact bytes, including projection. Keep every existing native authority check. Keep a validated Council result unchanged, including strings larger than 4096 bytes. Existing transport limits remain unchanged.

Export `projectProviderInitialization(observed: unknown, assignment: WrapperAssignment): ProviderInitialization` from `wrapper-contract.ts`. Call it only after existing effective validation and the additional field checks below. Its strict union is:

- `{state:"unobserved",protocol:ProviderRecipe["protocol"]}` before validated initialization.
- Stream branch: `{state:"verified",protocol:"agy-stream"|"cursor-stream",model:string,cwd:string,tools:[],permission:{state:"verified"|"unexposed",value:string|null},agent:{state:"verified"|"unexposed",value:string|null}}`.
- Codex branch: `{state:"verified",protocol:"codex-app-server",model:string,cwd:string,configDigest:string,modelProvider:"openai",reasoningEffort:string,activePermissionProfile:{id:string,extends:null},instructionSources:string[],tools:{state:"unknown"}}`.

Copy model/cwd only after exact comparison to the assignment/recipe. For AGY, permission must equal `expectedPermission`. For Cursor, permission remains unexposed unless a separate existing check verified it. Tools become `[]` only after the actual array-empty check. Codex tools remain unknown. Retain agent only after exact recipe-agent comparison and source-bound definition validation. An unchecked agent becomes unexposed. Copy only the Codex profile id and null extends, exact checked instruction paths, effective model/effort and existing config digest. Do not spread provider objects. Strip nested extras. Required private paths remain identity/control evidence outside summaries.

Normal report `selectedAgent` keeps its existing fixed source text and source-bound requested identity. Read its observed value from `init.agent.value` only when both init and agent states are verified. Otherwise use null. Never copy the projected agent object as its observed string. `conversationId` and cancellation `activeTurn.identity` remain private binding fields, not diagnostic text. Retain them only after protocol identity validation. In Codex, compare final thread identity to the checked `threadId`; mismatch uses `PROVIDER_CONVERSATION_UNBOUND`. Failed unchecked finals cannot populate `conversationId`. This does not change the validated result payload.

## Fixture ownership and command bounds

Each test owns a fresh `mkdtemp` root, assignment, nonce and output tree. Use the assignment construction in `test/pilot/provider-session.test.ts:254` as source evidence. New fixtures use `process.execPath`, never a live provider executable or real account. Add no provider dependency.

Export this proposed test helper from `test/pilot/diagnostic-fixture.ts`:

```ts
export const diagnosticCanaries: Readonly<{
  stdout: string; stderrA: string; stderrB: string;
  initExtra: string; exception: string; requestedResult: string;
}>;
export type DiagnosticMode = "normal" | "stderr" | "invalid-init" | "cancel-active" | "cancel-before-input";
export function diagnosticFixture(mode: DiagnosticMode, protocol?: ProviderRecipe["protocol"]): Promise<{
  assignment: WrapperAssignment; assignmentHash: string; directory: string;
  run(): ReturnType<typeof runProviderSession>;
  finish(): Promise<void>;
}>;
```

Values are exactly `diag-stdout-10`, `diag-stderr-a-10`, `diag-stderr-b-10`, `diag-init-extra-10`, `diag-exception-10`, `requested-result-10-秘密`. Put stdout canaries in accepted message/usage metadata, never requested results. Put init canaries in a top-level extra and a nested unknown object. Emit stderr in at least two separately acknowledged writes. Inject `Error(exception)` through forwarding module mocks at actual filesystem/parser/native boundaries. Do not add production fault flags.

The normal case uses phase `review`, valid `{assessment:requestedResult,objections:[]}`, and an intact bound result envelope. Add an assessment larger than 4096 UTF-8 bytes. Keep failures in separate cases because stderr must still fail a session.

Use a deterministic spawned-child stand-in for precise chunk and write-failure ordering. Close every stand-in stream and settle retained promises in `finally`. Real fixture cases reuse the integrated #9 watchdog's ownership protocol, without editing it. Verify the exact provider/group/descendant binding before signaling. Successful cases require child close, group absence, descendant absence, parser/scan settlement, cleared timers, wrapper exit and owned terminal closure where applicable. Assert no watchdog intervention. Await fixture teardown before deleting its unique tree. An emergency stop is failed fixture evidence, never product success. Do not use global fake timers or broad process-name signals.

All future commands run from the integrated repository root. Use the reviewed #9 `cleanup-execution/bounded-command.py` runner after inspecting its actual file. If absent, create the identical task-owned stdlib runner from that plan as execution evidence before testing. No installation is needed. In the commands below, `B <seconds> <argv...>` means exactly:

```text
python3 .superpowers/sdd/2026-10-31-council-issues-3-10/cleanup-execution/bounded-command.py <seconds> <argv...>
```

Each budget has a separate 10-second owned-settlement allowance. Timeout is failure. Reconcile detached watchdogs before another command. Preserve default file parallelism. New unit tests use 5000 ms, real session tests 10000 ms, and context tests 15000 ms limits. The normal fixture writes bound input before run. The cancel-before-input fixture polls prepared.json with a real 10 ms timer, writes only the bound cancellation with a 5000 ms cleanup deadline, and never writes input. The cancel-active fixture supplies input, waits for a checked original-turn event, then writes the exact bound requestId and deadline. Each polling timer clears in finish(). Do not increase existing limits.

### Task 1: Replace provider capture with the finite diagnostic contract

**Owner:** Sol Max implementer. **Prerequisites:** Integrated #9, current-interface check, coordinator review disposition.

**Files:** Create `src/pilot/diagnostics.ts`, `test/pilot/diagnostics.test.ts`, `test/pilot/diagnostic-fixture.ts`, `test/pilot/fixtures/diagnostic-provider.cjs`, `test/pilot/provider-diagnostics.test.ts`. Modify `src/pilot/provider-session.ts`, `src/pilot/wrapper-contract.ts`, `test/pilot/provider-session.test.ts`.

**Interfaces:** Consume existing `runProviderSession(a:WrapperAssignment,assignmentHash:string)`. Produce the shared contract, `ProviderInitialization`, `providerReportSchema`, `preparedReportSchema`, `ProviderReport`, `PreparedReport` and `runProviderSession(...):Promise<ProviderReport>`. Export both schemas/types from `wrapper-contract.ts`. All report keys listed below are strict. `ProviderReport` has exactly version, binding, assignmentHash, packetHash, controlsHash, status, calls, initializations, error, diagnostic, selectedAgent, result, conversationId, init, cancellation, process and optional wrapperPid. Status is completed/failed/cancelled. `result` is a validated Council envelope or null. `PreparedReport` has exactly version, assignmentHash, ready, initializations, error, diagnostic and init. Both error fields are DiagnosticCode|null. Selected-agent fields are requested, observed and source, with the existing two fixed source strings. Cancellation is null or exactly requestId, binding, acknowledged:true, activeTurn and at. activeTurn has only the existing fixed protocol source string and checked identity. Process has exactly pid, providerStarted, exitCode, signal, closed, groupSettled, trackedDescendantsSettled, escapedDescendantObserved, timersSettled, parsingSettled, processScansSettled, inputDelivered, stopRequested and descendantEvidence. The evidence string is the current fixed process-tree/group explanation or null. Unknown fallback pid/exitCode/signal/inputDelivered/stopRequested/escapedDescendantObserved are null. Positive settlement booleans default false when unverified. providerStarted is true/false/null. Normal provider reports set it true. Prepared readiness always includes error:null and an explicit init state. Retain existing process facts plus integrated #9 work facts. Report calls and initializations are `0|1|null`; prepared initializations are `0|1|null`.

- [ ] **Step 1: Add the first behavioral regression using existing APIs only.**

Create the fixture and `"does not persist stdout or initialization canaries through the existing session API"`. Call the existing two-argument session function. Inspect its returned report and actual `prepared.json`. Do not import a new production module in this first test.

```ts
expect(report.status).toBe("completed");
expect(report.calls).toBe(1);
const envelope = pilotResultEnvelopeSchema.parse(report.result);
expect(pilotPayloadSchemas.review.parse(envelope.payload).assessment)
  .toBe(diagnosticCanaries.requestedResult);
expect(JSON.stringify(report)).not.toContain(diagnosticCanaries.stdout);
expect(readFileSync(join(directory,"prepared.json"),"utf8"))
  .not.toContain(diagnosticCanaries.initExtra);
```

The stdout and init canaries must first be demonstrably present in fixture output. Keep that source trace in test memory only. Assert all positive settlement facts before teardown.

- [ ] **Step 2: Record the meaningful RED before production edits.**

Run `B 60 npm test -- test/pilot/provider-diagnostics.test.ts -t "existing session API"`.

Expected: a canary exclusion assertion fails because current stdout or init data survives. Missing imports, collection failures, timeout or failed fixture setup are not this RED.

- [ ] **Step 3: Add contract and edge-case tests before the implementation.**

In `diagnostics.test.ts`, add `"accepts complete summaries at N-1 and N and omits at N+1"`. Build valid candidates of exactly 4095, 4096 and 4097 canonical UTF-8 bytes. Use only allowed detail tuples and valid numeric counters. A bounded search over at most 128 details and counter digit lengths can construct these sizes. Assert the helper's measured size before testing production. Do not introduce a padding/text field. Assert no omission at the first two sizes, deterministic tail removal at 4097, positive omitted count, `truncated:true`, and final size at most 4096. Also assert the parser rejects 4097 with `DIAGNOSTIC_SUMMARY_TOO_LARGE`.

Add `"counts multibyte input bytes across chunks without retaining text"`: split `秘密🙂` across Buffer chunks, including a split UTF-8 code point. Assert byte totals equal the sum of Buffer lengths, not JS string length. Exercise streams totaling 4095/4096/4097 bytes. Assert both stderr chunk canaries are absent and omission flags are true. Test the separate valid result with these characters remains exact.

Add named tests for unknown origin/phase/code, a code that merely contains a known suffix, nested exception properties, throwing property access, all counter maxima and invalid counters, and a maximum-size fixed core. Unknown context values normalize to `unknown`. External malformed summaries fail strict validation. Projection catches unsafe property access and emits unknown.

Add `"preserves first failure and measures every stderr chunk"`, `"keeps attempted writes reserved"`, `"does not infer tools from missing initialization"`, and a three-protocol valid-init projection table. Assert zero calls before mutation, one call after attempted write, no false inference receipt, and retain false or unresolved settlement facts. Add nested Codex profile extras through the actual protocol fixture. Retain existing selected-agent tests.

- [ ] **Step 4: Implement the shared contract and producer projection.**

Replace raw stdout/stderr accumulation with byte/chunk counters and the existing bounded parser buffer. Keep the existing 1048576-byte protocol cap. Keep only a `stderrSeen` flag for failure/cancellation gates. Feed first failures through integrated #9's latch using exact codes. Unknown exceptions become `DIAGNOSTIC_UNKNOWN`; they still fail the attempt. Clear consumed protocol data after validation.

Check initialization extras before discarding raw keys. For AGY init, known keys are model, cwd, tools, permission_mode and agent. Cursor also has known type, subtype and session_id protocol keys. For Codex thread/start, inspect the raw selected object before the current filtered init construction. Its checked keys are thread, modelProvider, model, reasoningEffort, cwd, approvalPolicy, activePermissionProfile and instructionSources. In activePermissionProfile, only id and extends are known. Unknown top-level or nested profile keys set initializationExtras. Do not classify known protocol fields as extras. Recheck these sets against the actual integrated validator before changing verification states. Construct projected initialization after validation. Construct a v2 prepared artifact on readiness or failure only when the owned artifact is absent. Construct a v2 report with no raw stream fields. Keep result validation unchanged. Snapshot original process evidence into the summary without replacing the process receipt. Use phases from the actual program stage. Success uses `NONE`; cancellation uses the actual cancellation classification. Update existing init assertions to the explicit projected shape without weakening their checks.

- [ ] **Step 5: Verify and commit this producer unit.**

Run `B 120 npm test -- test/pilot/diagnostics.test.ts test/pilot/provider-diagnostics.test.ts test/pilot/provider-session.test.ts`. Expected: exit 0, including the original canary assertion. Consumer migration follows before whole-change acceptance.

Run `B 30 git add src/pilot/diagnostics.ts src/pilot/wrapper-contract.ts src/pilot/provider-session.ts test/pilot/diagnostics.test.ts test/pilot/diagnostic-fixture.ts test/pilot/fixtures/diagnostic-provider.cjs test/pilot/provider-diagnostics.test.ts test/pilot/provider-session.test.ts`.
Run `B 30 git commit -m "feat: project bounded provider diagnostics"` after reviewing exactly those staged paths.

### Task 2: Apply projection to wrapper fallback and persisted result files

**Files:** Modify `src/pilot/host-wrapper.ts`, `src/pilot/provider-session.ts`, `src/pilot/diagnostics.ts`, `src/pilot/wrapper-contract.ts`. Create `test/pilot/wrapper-diagnostics.test.ts`. Reuse `test/pilot/context-fixture.ts` without altering its existing behavior.

**Interfaces:** Consume Task 1 contracts. Preserve `runHostWrapper(directory:string,orca:string,runtimeId:string,deadline:number):Promise<void>`. Add `ProviderSessionFailure extends PilotDiagnosticError` with `readonly providerState:"not_started"|"unknown"`, constructor `(diagnostic:DiagnosticSummary,providerState:"not_started"|"unknown")`. Export it from `diagnostics.ts`.

- [ ] **Step 1: Add fallback and entry-error tests.**

Inject the exception canary into pre-spawn `readFileSync` materialization and into a mocked session rejection. Use valid assignment/native caller fixtures before entering the catch. Assert both `prepared.json` and `result.json` exclude the canary and stack. Assert their diagnostic sizes and versions. Assert the completion body contains only fixed prose and the hash of actual result bytes. Assert file modes `0600` and owned directories `0700`.

For a program-location-proven pre-spawn failure, assert calls/initializations 0, `providerStarted:false`, no initialization/inference receipt and positive no-owned-work facts. For unknown post-spawn failure, assert calls/initializations null, input state unknown, no successful completion or release. Add "preserves existing readiness bytes after session rejection": create valid bound v2 prepared readiness, save its exact bytes, then inject a session rejection with the exception canary. Assert prepared bytes and mode remain unchanged. Assert result.json is safely persisted with failed status and unknown lifecycle facts. Assert the actual native completion reports failed with the digest of that result file. Also test absent prepared.json with unknown provider state: both prepared and result initialization counts are null. A forged exception message equal to a pre-spawn code must not prove no spawn.

- [ ] **Step 2: Run `B 60 npm test -- test/pilot/wrapper-diagnostics.test.ts`.**

Expected RED: current wrapper fallback copies injected exception text or produces v1/missing structured fields. Native setup must succeed before this assertion.

- [ ] **Step 3: Implement the fallback boundary.**

Wrap only the actual pre-spawn section with `ProviderSessionFailure(...,"not_started")`. After child ownership begins, an escaping failure can carry only unknown lifecycle unless a complete report already exists. Remove the message-based `beforeSpawn` list. Construct every fallback field explicitly under v2. If prepared.json is absent, create its failed v2 artifact exclusively. Use initializations 0 only for proven not_started, otherwise null. If prepared.json exists, read and validate its version, assignmentHash and schema without rewriting it. Preserve valid readiness bytes, but never infer provider settlement from readiness. An invalid existing artifact stays untouched and adds the finite WRAPPER_RESULT_UNBOUND detail to the fallback. A creation race with EEXIST follows the existing-artifact validation branch. Never replace the file or retry its exclusive creation. Continue to write the safe failed result and native failed completion. Preserve `wrapperPid` addition, exclusive result writes, report digest and native completion binding. Keep #9's strict parser/scan completion checks. Project the direct-entry `.catch` to a code-only error. Do not log an exception object or raw stack.

- [ ] **Step 4: Run `B 60 npm run build`, then `B 90 npm test -- test/pilot/wrapper-diagnostics.test.ts`.**

Expected GREEN: all canary, lifecycle, digest and mode assertions pass. A direct unit import uses `src/`; real wrapper cases use freshly built `dist/`.

- [ ] **Step 5: Commit only this task's modified/new paths.**

Run `B 30 git add src/pilot/host-wrapper.ts src/pilot/provider-session.ts src/pilot/diagnostics.ts src/pilot/wrapper-contract.ts test/pilot/wrapper-diagnostics.test.ts`.
Run `B 30 git commit -m "fix: project wrapper fallback diagnostics"`.

### Task 3: Validate versioned reports and sanitize attempts and cancellation

**Files:** Modify `src/pilot/context-driver.ts`, `src/pilot/types.ts`. Create `test/pilot/context-diagnostics.test.ts`. Update `test/pilot/context-wrapper.test.ts`, `test/pilot/context-cleanup.test.ts` only for explicit new shapes. Preserve their negative cases.

**Interfaces:** Preserve `verifyContextResult(assignment:WrapperAssignment,command:Command)` and all `ContextWrapperPort` signatures. Add optional `diagnostic?:DiagnosticSummary|undefined` to `Attempt` and every `CancellationResult` union branch. Restrict `Attempt.controlError` and cancellation `error` to `DiagnosticCode`. Permit `Attempt.initializations?:number|null|undefined`. For a fully verified report with status failed, observe rejects with `new PilotDiagnosticError(report.diagnostic)`. It must not replace the original summary with WRAPPER_PROVIDER_FAILED. Unverified reports still fail the existing binding checks.

- [ ] **Step 1: Add source-backed consumer tests.**

Use the actual context transport and bound artifact/native fixture. Add `"rejects legacy and future prepared/report versions without raw fallback"` for missing/1/3 versions. Add `"rejects raw fields in an otherwise bound v2 report"`. Rewrite report bytes and matching native hash/body together, as proposed by #9's `rewriteBoundReport`, to isolate validation from unrelated tamper rejection.

Add `"propagates projected pre-input failure through attempt and cancellation"`. Assert controlError is a finite code, diagnostic origin/phase/input/exit remain intact, cancellation is `settled_unacknowledged`, no cancel acknowledgement exists, and proven settled release occurs exactly once. Add active-turn acknowledged cancellation with exact requestId/binding. Add unknown settlement with no proof/close. Unknown or forged code text never becomes a successful result. Add "preserves acknowledged-input failure through observe": launchVerified true, calls 1, inputDelivered true, original exitCode 7, signal null, positive process/work settlement, and diagnostic `{origin:"provider",phase:"inference",code:"PROVIDER_STDERR_UNCLASSIFIED",inputDelivery:"acknowledged"}`. Bind the failed report and native failed completion to the same bytes. Assert observe throws PilotDiagnosticError with that exact summary. A companion signal case keeps original SIGTERM and null exitCode. Neither report yields a requested Result.

- [ ] **Step 2: Run `B 90 npm test -- test/pilot/context-diagnostics.test.ts`.**

Expected RED: v2 is currently rejected wholesale, or legacy prepared error text is copied into `controlError`. Record the relevant behavioral assertion.

- [ ] **Step 3: Implement strict reader and propagation boundaries.**

Validate prepared versions before deriving readiness or initialization count. Validate reports before deriving calls from early-result files. Keep uncertain input `null`. Require strict report schema and bounded summary in `verifyContextResult` before native checks. Preserve all existing hash, dispatch, incarnation, task, payload, process and #9 work checks. Do not re-project tampered evidence into validity.

Set attempt and cancellation error fields from validated codes only. Transfer validated summaries, not report objects. Catch filesystem/parser failures as safe errors at public launch/observe/cancel boundaries. Cancellation still returns unknown for unverified settlement. Keep the stop request idempotent and exact release rules unchanged.

- [ ] **Step 4: Run `B 60 npm run build`, then `B 180 npm test -- test/pilot/context-diagnostics.test.ts test/pilot/context-cleanup.test.ts test/pilot/context-wrapper.test.ts`.**

Expected GREEN: valid v2 paths pass; old evidence fails clearly; forged binding, report tampering, permission-denied inspection, uncertain close and duplicate close remain rejected. Positive release retains one exact close.

- [ ] **Step 5: Run `B 30 git add src/pilot/context-driver.ts src/pilot/types.ts test/pilot/context-diagnostics.test.ts test/pilot/context-wrapper.test.ts test/pilot/context-cleanup.test.ts`.**
Run `B 30 git commit -m "fix: validate projected wrapper diagnostics at consumers"`.

### Task 4: Share finite projection with native source failures

**Files:** Modify `src/pilot/allowance.ts`, `src/pilot/native-command.ts`, `test/pilot/allowance.test.ts`, `test/pilot/native-command.test.ts`.

**Interfaces:** Preserve `readFailure(source:string,error:unknown):Observation` and `commandFromClient(...)`. `Observation.detail` becomes the canonical complete `DiagnosticSummary`, version 1. Its `source` is a finite selection from `"Orca accounts.list(refreshUsage=true)"`, `"accounts.list"`, `"native boundary"`, `"native run-create"`, `"native source read"`, `"Orca accounts.list(refreshUsage=true) rateLimits.codex"`, `"Orca accounts.list(refreshUsage=true) rateLimits.cursor"`; unknown caller labels use `"native source read"`.

- [ ] **Step 1: Add native-boundary canary regressions.**

Exercise the real `commandFromClient` with synthetic `client.run` receipts. Cover ok=true with missing runtime metadata and an unknown `error.code` containing the exception canary. This reaches the existing unchecked interpolation branch. Assert the thrown message and `readFailure` output exclude it. Also inject message/stack/nested extras and stderr chunks. Assert known native code/state pairs remain: timeout/missing, permission_denied/denied, 401/authentication_failed, runtime_timeout/missing. Numeric 999999 and near-match codes become unknown. Preserve runtime binding and stderr-success rejection. For each provider-specific rateLimits label, call actual accountAllowance with an error snapshot. Assert the exact source label survives and allowance/state/spending semantics remain unchanged. Pin native precedence: ORCA_INVALID_ENVELOPE and ORCA_CLI_DIAGNOSTICS_PRESENT remain primary codes, with invalid_runtime_response permitted as a secondary finite detail.

- [ ] **Step 2: Run `B 60 npm test -- test/pilot/native-command.test.ts test/pilot/allowance.test.ts`.**

Expected RED: the malformed-success native branch surfaces the unchecked code. Existing safe source-read tests continue to demonstrate the separate prior protection.

- [ ] **Step 3: Implement exact code projection.**

Use the shared native entries for `commandFromClient` errors, including its malformed-success branch. Keep native protocol errors and runtime binding failures distinct. Preserve existing `Observation.state` classification in memory, including denied/authentication/exhaustion. Persist only shared classification and allowed codes. Unknown numeric codes must not survive. Update old `.diagnostic.class/code` test assertions to the shared `.classification/code` shape. Keep `accountAllowance` field projection and spending semantics unchanged.

- [ ] **Step 4: Run `B 60 npm test -- test/pilot/native-command.test.ts test/pilot/allowance.test.ts`.** Expected GREEN: exit 0.

- [ ] **Step 5: Run `B 30 git add src/pilot/allowance.ts src/pilot/native-command.ts test/pilot/allowance.test.ts test/pilot/native-command.test.ts`.**
Run `B 30 git commit -m "fix: share finite native diagnostic projection"`.

### Task 5: Project journal event payloads before durable append

**Files:** Modify `src/pilot/journal.ts`. Create `test/pilot/journal-diagnostics.test.ts`. Modify `test/pilot/journal.test.ts` for safe error expectations.

**Interfaces:** Preserve `PilotJournal.append(event:unknown):void` and `.wrap(driver:PilotDriver):PilotDriver`. Add `projectPilotJournalEvent(event:unknown):PilotJournalEvent` and export the strict event union from `journal.ts`. Every event keeps only its explicitly owned fields.

The exact event set is `bounds-recorded-before-inference`, `run-reserved`, `run-creation-unknown`, `native-run-bound`, `attempt-reserved`, `launch-rejected-before-mutation`, `launch-unknown`, `attempt-bound`, `result-bound`, `observation-unknown`, `cancel-reserved`, `cancel-observed`, `release-reserved`, `release-observed`, `outcome-recorded`, `wrapper-terminal-reserved`, `wrapper-terminal-observed`, `wrapper-task-reserved`, `wrapper-task-observed`, `wrapper-dispatch-reserved`, `wrapper-dispatch-observed`, `wrapper-native-bound`, `wrapper-terminal-close-reserved`.

- [ ] **Step 1: Add journal data-flow tests.**

Use a real journal and `journal.wrap(fakeDriver)` returning a bound Attempt with a canary controlError, nested extra keys and a cancellation error. Read actual JSONL. Assert canaries are absent, version 2 is present, summaries fit, and binding/mutation ids survive. Exercise a rejected begin carrying a native code plus exception text. Assert run-creation-unknown.diagnostic is a version-1 DiagnosticSummary, not an Observation or JSON string. Assert primary code NATIVE_RUN_CREATION_OUTCOME_UNKNOWN and one finite detail for the underlying native code. Assert the thrown PilotDiagnosticError carries the same summary and the exact UUID from the earlier run-reserved event. Exercise unknown event and nested dispatch extras through `append`. Verify a pre-existing journal's bytes remain unchanged after rejected duplicate construction. Assert `0600`/`0700` modes.

- [ ] **Step 2: Run `B 60 npm test -- test/pilot/journal-diagnostics.test.ts`.**

Expected RED: `attempt-bound` or `cancel-observed` retains the canary through the existing append API.

- [ ] **Step 3: Implement event-specific projection.**

Retain only the current producer's fields for each named event. Keep required post-binding identities and write-ahead reservation fields mandatory. Correct incomplete journal.test.ts fixtures to provide full bounds and attempt-reserved fields. Do not make production fields optional to preserve incomplete fixtures. For bounds, allow only runId, maxProbeCalls, maxTopicCalls, deadline, workerTimeoutMs, proofTtlMs and configHash. Validate identity/binding/selection using existing schemas. Project attempts by explicit keys from `Attempt`, and cancellation by its discriminated branch. Project `wrapper-dispatch-observed` to id, task/run/assignee/incarnation identity fields and boolean/null injected. This observation precedes dispatch validation. Represent absent pre-binding fields explicitly as null in a fixed unverified-dispatch shape. Retain no claim of bound authority until wrapper-native-bound passes the existing checks. Normalize camel/snake aliases to the existing checked identities. Drop other native dispatch properties. Result events retain binding, packetHash, phase, role, source and completion identity only as currently produced; they add no raw result.

Unknown event names produce `{event:"diagnostic-event-rejected",diagnostic:...NATIVE_JOURNAL_EVENT_UNSUPPORTED}` with no copied name or payload. This output variant is part of `PilotJournalEvent`. All diagnostics pass the shared parser/projector before writing. Wrap thrown begin/launch/observe/cancel/release exceptions with `PilotDiagnosticError`. Preserve an existing validated summary and owned mutation UUID. For observation-unknown, add the caught summary to the event before rethrowing. Do not rethrow raw errors or retain `cause:error`. Preserve write-ahead reservations and fsync order. For run-creation-unknown, construct `projectDiagnostic("NATIVE_RUN_CREATION_OUTCOME_UNKNOWN",{origin:"journal",phase:"bootstrap"})`. Add the cause's projected origin/phase/code as one detail, then fit the complete summary. Store that object directly as diagnostic and the owned UUID as mutationRequestId. Throw `new PilotDiagnosticError(summary,mutationRequestId)`. Do not put readFailure's Observation wrapper in diagnostic. Preserve UUID mutation identity on unknown run creation. For malformed known events, write a finite diagnostic-event-rejected record and throw PilotDiagnosticError before any dependent mutation. Never emit raw Zod issue text. Unknown event names use the same safe rejection. Legitimate pre-binding nulls do not weaken post-binding identity requirements.

- [ ] **Step 4: Run `B 60 npm test -- test/pilot/journal-diagnostics.test.ts test/pilot/journal.test.ts`.** Expected GREEN: exit 0. The old test expecting arbitrary launch text now expects `DIAGNOSTIC_UNKNOWN` and unchanged reservation evidence.

- [ ] **Step 5: Run `B 30 git add src/pilot/journal.ts test/pilot/journal-diagnostics.test.ts test/pilot/journal.test.ts`.**
Run `B 30 git commit -m "fix: project diagnostics before journal append"`.

### Task 6: Preserve workflow outcomes and safe CLI errors end to end

**Files:** Modify `src/pilot/workflow.ts`, `src/pilot/cli.ts`, `src/pilot/orca-driver.ts`, `src/pilot/context-driver.ts`, `src/pilot/config.ts`, `src/pilot/qualification-cache.ts`, `src/pilot/journal.ts`. Create `test/pilot/workflow-diagnostics.test.ts`, `test/pilot/cli-diagnostics.test.ts`. Modify `test/pilot/workflow.test.ts` only for deliberate version/finite-error expectations.

**Interfaces:** Preserve `runPilot(request:PilotRequest,driver:PilotDriver,now?:()=>number):Promise<PilotOutcome>`. Add required `PilotOutcome.version:2`, optional `diagnostic?:DiagnosticSummary`, `initializationsUnknown:boolean`, and `pendingMutations:{requestId:string;kind:"run-create"|"worker-start"|"terminal-create";attemptKey?:string}[]`. Restrict `error` to `DiagnosticCode`. Export proposed `runNativeCli(argv:readonly string[]):Promise<void>` from `cli.ts`; it replaces private `main` and copies argv before parsing. The function itself catches pre-outcome failures, emits one compact v2 failure JSON value and sets process.exitCode to 3 for QUALIFICATION_CACHE_BUSY_RECONCILE or 2 otherwise. It resolves after a handled failure. The direct-entry guard only calls `runNativeCli(process.argv.slice(2))`. Direct calls have the same catch/output behavior. No import runs the CLI. Add this export and guard only after Step 2 records behavioral RED through the existing shipped entry.

- [ ] **Step 1: Add workflow and real persistence regressions.**

Use `runPilot` with existing `workflow.test.ts` harness behavior and a real journal. Inject exception text from inspect, launch, observe, cancel and release separately. Inject arbitrary controlError and `settled_unacknowledged.error`. Assert returned outcome, JSONL and surfaced rejection contain no canary. Assert failed/unknown remains failed, no proof is created, no second launch occurs, and cleanup is attempted once per owned resource. For false/null/true `inferenceStarted`, assert probes 0/1/1. Missing initialization count sets `initializationsUnknown`, without inventing a successful initialization.

For the first CLI test, use the existing package bin `dist/pilot/cli.js`, not a new export. Create an owned workspace and a valid incidentRoster config. Leave an owned path named `diag-exception-10-missing-input.json` absent. Invoke `spawnSync(process.execPath,[resolve("dist/pilot/cli.js"),"--workspace",workspace,"--config",config,"--input",missingInput,"--policy",ownedPolicy,"--orca",ownedNeverRunOrca],{cwd:workspace,encoding:"utf8",timeout:5000})`. Resolve the entry before changing cwd. Assert child.status is 2 and JSON.parse(child.stdout).reason excludes `diag-exception-10`. Baseline readFileSync at cli.ts:113 fails before policy resolution or Orca connection, and its surfaced ENOENT includes that canary. Assert no native run/journal artifacts exist. Do not import cli.ts or any uncreated export in this test.

After that behavioral RED and the Step 3 export, add direct-call tests using actual `runNativeCli` with a unique workspace/config/input and offline mocked native driver factories. Keep actual `PilotJournal` and filesystem writes. Inject canary errors from cache persistence/close and journal close after an outcome exists. Spy on stdout only for capture. Assert saved `outcome.json` and printed JSON are version 2, failed, code-only, and contain the same bounded summary. Assert temporary outcome file mode 0600 and atomic replacement. A direct pre-outcome failure prints one safe finite reason and resolves rather than rejecting. Restore process.exitCode after each direct-call case. QUALIFICATION_CACHE_BUSY_RECONCILE retains status prerequisites_not_verified, zero calls and exit 3. Other invalid CLI failures retain exit 2; failed outcomes retain exit 4.

Add a successful review result with `requested-result-10-秘密` and an assessment over 4096 bytes. Assert exact result payload equality in the returned outcome, saved file and stdout. Do not apply diagnostic projection to requested results.

For both actual outcome writes and stdout, inject fitted candidates originating at exactly 4095/4096/4097 bytes. At 4097, assert explicit size omission and a final summary at most 4096 bytes. Capture the initial file bytes before an injected cache/close failure, then capture the atomic replacement bytes and stdout. Add private test helper `diagnosticByteSpans(text:string):Buffer[]` in cli-diagnostics.test.ts. Its JSON token scanner extracts each diagnostic object's exact UTF-8 byte span from emitted text before JSON parsing. It must respect strings, escapes and nested braces. Assert byte lengths on those raw spans, not parsed/reencoded values. Assert each span equals its compact canonical encoding and contains no indentation. For N-1/N, assert exact emitted 4095/4096 byte lengths. The cap excludes the separate requested result, record path and enclosing outcome.

Add "retains acknowledged-input failed observe across journal workflow and CLI" using Task 3's actual bound context fixture. Run observe through journal.wrap and runPilot, then the real CLI persistence path with offline native factories. Assert the original provider/inference code, acknowledged delivery and exit/signal facts in the observe exception, observation-unknown event diagnostic, outcome, saved file and stdout. Assert probes 1, topic 0, no proof and no second inference. Cleanup may acknowledge settlement only through actual verified receipts. In this context integration case, import composition, journal, workflow and CLI consistently from freshly built dist. Use src imports only for types. This keeps the diagnostic carrier constructor identical across the tested runtime.

- [ ] **Step 2: Record behavioral RED through current APIs before production edits.**

Run `B 60 npm run build` to compile the current accepted Tasks 1–5 source, without changing cli.ts for the new test. Run `B 60 npm test -- test/pilot/cli-diagnostics.test.ts -t "shipped entry excludes a missing-input canary"`. Expected RED: the reason exclusion assertion fails because actual stdout contains the owned missing-input canary. Missing imports, absent dist output or fixture/config failure are not this RED. The test name is exactly "shipped entry excludes a missing-input canary".

Run `B 60 npm test -- test/pilot/workflow-diagnostics.test.ts` with tests using existing workflow/journal APIs only. Expected RED: the relevant canary, unresolved-binding or duplicate-operation assertion fails. Add tests that import runNativeCli only after this RED and the Step 3 export. Do not edit production merely to make an uncreated import collect.

- [ ] **Step 3: Implement workflow and CLI propagation.**

Classify request-validation failures before discarding their text. Zod errors map to `NATIVE_REQUEST_INVALID` with invalid_request status. Preserve the exact packet-size refund rule using a controlled carrier from the actual pre-mutation bounds check. Convert assertNativePacketBounds and the pre-worker-start size check to PilotDiagnosticError with inputDelivery not_attempted. A matching raw Error.message cannot authorize a refund. Keep call reservation immediately before input mutation. Consume `PilotDiagnosticError` without losing its original allowed origin/phase. Retain unknown mutation identities in pendingMutations. Use exact code-to-kind mapping: NATIVE_RUN_CREATION_OUTCOME_UNKNOWN to run-create, LAUNCH_OUTCOME_UNKNOWN to worker-start, WRAPPER_TERMINAL_OUTCOME_UNKNOWN to terminal-create. Read requestId only from PilotDiagnosticError.mutationRequestId, validated as the owned UUID. Retain the current owned pendingKey as attemptKey for launch cases. Never recover an identity from an error suffix or admit a code prefix.

Replace the controlled suffixed throws at orca-driver.ts:126, context-driver.ts:130, journal.ts:37 and config.ts:83-85 with exact finite PilotDiagnosticError messages. For worker-start retain mutationRequestId(attemptKey); for terminal-create retain the already generated operationId. Use the exact NATIVE_RUN_EXISTS_INSPECT_REQUIRED and PILOT_CONFIG_INCOMPATIBLE codes without appended prose or Zod text. Preserve each fixed driver/cache error through the shared registry. Driver carriers use origin native-driver. Use bootstrap for NATIVE_RUN_ID_MISSING, input for LAUNCH_OUTCOME_UNKNOWN, inference for NATIVE_LIFECYCLE_UNKNOWN/NATIVE_WORKER_FAILED/NATIVE_RESULT_DEADLINE, and validation for binding/transcript/malformed-result codes. Config carriers use cli/validation. Cache carriers use cli/persistence. The journal launch-rejected-before-mutation branch requires the controlled no-mutation bounds carrier, not arbitrary matching text. Do not change cache lock or config validation rules. Add code/class tables for the listed driver/cache/config errors, exact mutation identity assertions and fake arbitrary-prefix exceptions. Retain workflow.test.ts:152,160,487 expectations for NATIVE_RESULT_MALFORMED_OR_MISMATCHED. Do not change them to unknown.

Project arbitrary Attempt.controlError and cancellation errors before throwing. Keep delivery-state accounting unchanged. Track `cancelAttempted` and `releaseAttempted` sets separately from positive `settled` and `released` sets. Add the dispatch id to the attempted set before awaiting each operation in execute or finally. Add settled only after a verified completed result or a cancellation result in settled/settled_unacknowledged. Add released only after release returns true. A thrown/unknown cancellation or thrown/false release adds the binding to unresolved exactly once. It never enters a positive set. After uncertain cancellation, do not release or repeat cancellation in finally. After an uncertain release, do not retry release. Finally uses attempted sets only to prevent duplicate mutations. It uses positive sets only for settlement/release facts. Preserve result.settlement unknown until positive release. Catch errors inside each resource iteration, then continue independent cleanup within the same existing grace. Keep the first diagnostic authoritative. Add cleanup failures only as finite details. Test cancel-probe and normal-result paths separately for thrown cancel, unknown cancellation, thrown release and false release. Assert attempted counts at most one per operation, unresolved binding, absent proof and unchanged calls. A positive release still produces exactly one close. Do not launch in cleanup. Failure in projection must fail closed with a finite diagnostic, never return consensus.

After the meaningful RED, add runNativeCli and its direct-entry guard with the catch contract above. At CLI file/stdout boundaries, write only typed outcomes and safe summaries. Replace both JSON.stringify(outcome,null,2) writes with canonicalJson(outcome)+"\n". Emit stdout through compact canonicalJson({...outcome,record}). This requirement applies to the initial write and atomic replacement. Preserve 0600, wx and rename behavior. Project post-outcome cache/close failures before atomic replacement. Project top-level argument/filesystem/JSON errors before printing. Do not interpolate arbitrary exceptions, raw Zod issue arrays or native protocol codes. Preserve direct execution, symlink path behavior, help and config-only operation.

- [ ] **Step 4: Run `B 60 npm run build`, then `B 180 npm test -- test/pilot/workflow-diagnostics.test.ts test/pilot/cli-diagnostics.test.ts test/pilot/workflow.test.ts test/pilot/journal-diagnostics.test.ts test/pilot/entry.test.ts`.**

Expected GREEN: all producer-to-file-to-consumer assertions pass. Entry package tests use newly built assets. Unknown outcomes remain unresolved and reservations remain conservative.

- [ ] **Step 5: Run `B 30 git add src/pilot/workflow.ts src/pilot/cli.ts src/pilot/orca-driver.ts src/pilot/context-driver.ts src/pilot/config.ts src/pilot/qualification-cache.ts src/pilot/journal.ts test/pilot/workflow-diagnostics.test.ts test/pilot/cli-diagnostics.test.ts test/pilot/workflow.test.ts`.**
Run `B 30 git commit -m "fix: retain safe diagnostics through workflow and CLI outcomes"`.

### Task 7: Verify integrated diagnostics and preserve campaign acceptance

**Owner:** Coordinator with the implementing Sol Max worker. **Prerequisites:** Tasks 1–6 integrated, each review disposition recorded.

**Files:** All changed source/tests and source-map evidence. No new source feature belongs to this verification task.

**Interfaces:** Consume v2 artifacts, validated result envelopes and existing native/context proofs. Produce frozen verification evidence and coordinator acceptance disposition.

- [ ] Run `B 90 npm run typecheck`. Expected: exit 0 under strict TypeScript and exact optional properties.
- [ ] Run `B 60 npm run build`. Expected: exit 0, including asset copy.
- [ ] Run `B 300 npm test -- test/pilot/diagnostics.test.ts test/pilot/provider-diagnostics.test.ts test/pilot/wrapper-diagnostics.test.ts test/pilot/context-diagnostics.test.ts test/pilot/native-command.test.ts test/pilot/allowance.test.ts test/pilot/journal-diagnostics.test.ts test/pilot/workflow-diagnostics.test.ts test/pilot/cli-diagnostics.test.ts test/pilot/provider-session.test.ts test/pilot/provider-session-cleanup.test.ts test/pilot/provider-cleanup-bounds.test.ts test/pilot/context-cleanup.test.ts test/pilot/context-wrapper.test.ts test/pilot/workflow.test.ts test/pilot/journal.test.ts test/pilot/driver-deadlines.test.ts test/pilot/verify-proof.test.ts test/pilot/cache-composition.test.ts test/pilot/entry.test.ts`. Expected: exit 0 with no watchdog intervention or unresolved owned fixtures.
- [ ] Inspect the actual files from normal, prepared failure, fallback, active cancellation and pre-input cancellation cases. Check every diagnostic object with the shared strict parser and byte measurement. Check exception and all distinct stream/init canaries are absent. Check requested-result equality separately.
- [ ] Verify forged binding, altered report bytes, altered native completion, missing/false #9 work facts, generic missing process state, denied inspection, uncertain close and repeated close regressions. Valid positive release closes once. Lost close replies are not retried.
- [ ] Verify producer fingerprint drift invalidates affected qualification reuse without editing cached historical receipts. Verify assignment/packet/control hashes, result/native completion hashes, private identity and cleanup hash bindings remain checked.
- [ ] Freeze source, tests, spec, plan, source map and measured RED/GREEN evidence. The coordinator obtains fresh Astra Ultra and Argon high reviews against identical bytes. Preserve workflow verdicts, fix budgets and ledger. This author dispatches no reviewer.
- [ ] After #8 integration, run `B 300 npm test` twice as separate default-suite runs. Expected: exit 0 with default parallelism. A current failure remains campaign evidence and leaves whole-branch acceptance open. Do not claim these checks passed during planning.

## Roadmap and readiness

Task 1 is conditional on the integrated #9 interface check. Tasks 2–6 then proceed in order, each with its targeted test cycle. Task 7 establishes whole-change evidence. Intermediate targeted success does not make the partially migrated application acceptable.

No known unresolved product decision requires a new design gate. The actual #9 implementation, runtime test permission and default-suite health are unverified dependencies. If integrated #9 differs from its reviewed proposal, correct the affected tasks before execution. Do not invent the missing interface. The coordinator retains any material scope decision.

This #10 plan does not resolve #8, perform paused #9 work, close #1, or claim the remaining #3–#10 operational outcomes. Reviewed integration, repeated default tests after #8, qualified route evidence and separate-project Council acceptance remain campaign work.

## Five-part self-review

1. **Spec coverage:** Task 1 covers finite summaries, streams, counters, byte limits, validated initialization and intact results. Task 2 covers fallback. Task 3 covers versions, attempts, cancellation and binding. Task 4 covers native error interaction. Tasks 5–6 cover journals, workflow and CLI. Task 7 retains lifecycle and campaign acceptance.
2. **Step scan:** Every implementation task has exact files, consumed/produced signatures, a behavioral RED, implementation choices, targeted GREEN and a commit boundary. Only future commands appear here. No test or source edit was executed by this author.
3. **Type consistency:** Summary version 1 nests inside report/prepared/outcome/journal version 2. Business calls remain separate from saturated diagnostic counters. Null initialization evidence flows to an explicit uncertainty flag. All tasks use the shared code registry and delivery states. Controlled driver/cache/config errors and separate mutation UUIDs retain their meaning. Mutation-attempt sets do not prove positive settlement. Journal diagnostics are Summary objects, not Observation wrappers.
4. **Review focus:** The five named conditions map to source-backed tests in Tasks 1–3 and 5–6. The first RED uses the existing session API. The first CLI RED uses the existing shipped entry before its export. Complete-summary boundaries include actual compact file/stdout bytes. Acknowledged-input failures retain their original summary through observe and persistence.
5. **Proportion:** Most detail fixes otherwise ambiguous contract decisions, test custody and propagation boundaries. Production function bodies remain implementation work. The wider #9/#10 spec includes lifecycle work that this plan references instead of repeating.

## Language verification note

This is an STE Issue 9-oriented candidate. Procedure and description references were applied separately. The official dictionary and governed terminology are unavailable. General-word approval and technical-term status remain unverified. Code, paths, model IDs, signatures, versions, numbers and required header wording are protected literals. Full ASD-STE100 conformance is not claimed. Planning evidence and source uncertainty are recorded in `source-map.md`.
