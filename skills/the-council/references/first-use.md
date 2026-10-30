# Native first use

The native pilot is explicitly selected with `native`; retained controller commands and saved configurations keep their format. E2's xAI/Cursor roster belongs to this pilot. The retained parser returns `CONFIG_NATIVE_ONLY_USE_NATIVE_COMMAND` for it.

Prepare a fresh clone with `npm ci` and `npm run build`. Node.js 22 and a running local macOS Orca 1.4.244 are the inspected protocol. No desktop startup, focus, dialogs, settings edits or installation occur from the launcher. The separate requesting project must already be registered. Resolve it with an explicit path, independently of package location or current-directory discovery.

Create a request in the requesting project:

```json
{
  "runId": "small-manifest-decision",
  "candidate": "Store the small immutable manifest as JSON.",
  "suppliedText": "The manifest is small, written once and read sequentially.",
  "maxProbeCalls": 8,
  "maxTopicCalls": 10,
  "workerTimeoutMs": 120000,
  "proofTtlMs": 3600000,
  "deadline": 1793310000000
}
```

Replace `deadline` with an absolute UTC epoch in milliseconds no more than 30 minutes ahead. The example timestamp is illustrative and expires. Do not reuse an old deadline. Provide the execution host's canonical `~/.agents/policies/model-policy.md`; the package includes no private policy and rejects a different policy file. Set exact configuration using the packaged `first-use-roster.yaml` or an explicit `--config` path. All relative input/config/policy paths resolve from the explicit requesting workspace.

`proofTtlMs` is optional, defaults to one hour and must be positive and no more than 24 hours. A successful qualification's expiry is independent of the current run's deadline. Host/runtime, policy bytes, relevant provider versions, exact selection, workspace/roots and control drift still invalidate reuse.

```sh
node /installed/the-council/skills/the-council/scripts/run-council.mjs native --help
node /installed/the-council/skills/the-council/scripts/run-council.mjs native --workspace /requesting/project --check-config
node /installed/the-council/skills/the-council/scripts/run-council.mjs native --workspace /requesting/project --input request.json --policy /execution-host/model-policy.md --json
```

The launcher installs nothing. A missing build returns a specific preparation message. The default executable is `/usr/local/bin/orca`; use `--orca /absolute/executable` only for the intended supported host. No provider prompts run during inspection. Provider `--version`, `models`, and AGY's documented zero-turn `/usage` command inspect existing access. The `/usage` call must keep slash expansion enabled, return no conversation, no turns and zero tokens.

## Evidence and limits

The journal is `.council/native/<runId>/events.jsonl` and the final record is `outcome.json` beside it. Bounds and a launch request identity are flushed before inference, then owned native Run/Task/Dispatch/handle identities are bound. The journal omits policy bytes, transport authentication and supplied packet contents. Results and qualification scopes stay in the requesting project. Keep this private project data out of public reports unless sanitized.

An existing run directory blocks automatic relaunch, including after a crash. Inspect its recorded owned IDs through Orca before deciding recovery. There is no automatic retry or resume command. Unknown launch or observation state remains unresolved; only recorded owned resources may be stopped/released. Do not delete the journal to force another launch.

The command automatically loads its own `.council/native-qualifications/receipts.json` cache under an exclusive writer lock, then rechecks matching normal/cancellation receipts against native archived inputs, results, exact selections and positive release. It does not import caller-authored proof files. Foreign, expired or drifted proof requires fresh probes; corrupt, busy or unverifiable native cache evidence blocks specifically. Proofs bind exact host/runtime, provider versions, workspace/roots, action, selection/effort encoding and control digest, with normal and cancellation outcomes and finite expiry.

Retained supervised cancellation proofs require an acknowledged native stop mutation for the exact Dispatch/request, positively interrupted exit and release, rechecked with `orchestration request-show`. The context-only lane instead requires the wrapper's exact active-turn cancellation acknowledgement, provider settlement, native Task.result digest readback and independent wrapper exit/terminal close. Native worker-stop is never treated as provider-stop proof for external custody. A natural exit after a refused, lost, foreign or late cancellation permits owned cleanup but creates no cancellation proof and starts no topic calls. Older cache formats remain readable. Shared exact selections use one proof across reviewer/judge roles, while all ten topic calls remain required.

A busy cache returns exit 3 before reserving the run ID. A stale `writer.lock` is never stolen or removed automatically. To recover, identify the previous invocation and its journal, positively establish that its writer and owned resources have settled, then archive its cache and lock before removing only that invocation's exact lock. If ownership or settlement cannot be established, retain the lock and reconcile the original invocation. Age alone is insufficient. An existing native run directory continues to fence relaunch after cache recovery.

Cache writes merge unexpired proofs across policies/configurations under the exclusive writer lock. Reused proofs survive a later fresh-probe failure. If native archives needed to revalidate a proof are unavailable, the run stays blocked. After positively settling the previous writer and all owned resources, archive the original cache unchanged, then remove only the independently identified unverifiable proof under exclusive ownership. Never manufacture a proof or discard the journal; fresh probes still require the same admission checks and bounds.

Every inference budget starts before launch and is capped at the earlier of the run deadline and the per-worker limit (at most120seconds). A launch that uses that budget cannot produce a probe proof or start another phase. Cancel probes use that same bound, rather than the whole remaining run.

JSON input and native result envelopes are decoded strictly, including duplicate member and invalid UTF-8 rejection. Policy hashes cover exact bytes. Ultra requires separately established host/transport/action qualification; a policy-table mention alone cannot admit it. A JSON-encoded packet is limited to 24,000 UTF-8 bytes, and the complete native `--spec` argument to 32,768 bytes. Oversized initial input returns `invalid_request` before probes; an oversized later phase cannot submit that launch. The outcome is saved before cache updates and emitted after journal/cache closure; persistence or closure failure remains a single failed result with the recorded evidence.

On failure or absolute deadline expiry, all cleanup shares one absolute30-second settlement window with no new inference, including release commands. It sends at most one stop per bound resource and observes the original identity after ambiguous stop delivery. Cancel probes with only milliseconds of inference time left still receive a bounded5-second stop command window and at least30seconds for settlement observation; this grants no further inference. Repeated cleanup cannot renew the shared deadline or resend a stop. Lost observation contact stays unknown. Results remain `settlement: unknown` until positive resource release. Invalid bounds or insufficient call budget return `invalid_request`; an unresolved judge returns `judge_unresolved`.

Three readiness calls, three reviews, one nonvoting judge and three ballots comprise the ten topic calls. Eight separate normal/cancellation probes cover all four exact selections when current proof is absent. The three voters must each approve unconditionally for consensus. Disagreement and an unresolved judge stay unresolved. Provider start, worker_done, an idle screen or exit zero alone do not substitute for bound transcript results and positive native resource release.

## Current support boundary

The shipped CLI composes `ContextWrapperTransport` and the packaged `host-wrapper` with the same public boundary factory used by credential-free tests. Invoke it inside a genuine task-owned Orca coordinator terminal in the requesting workspace. The native run-create/task/dispatch methods validate that caller; an external shell or copied `--from`/environment is insufficient. `NATIVE_COORDINATOR_CONTEXT_MISSING` identifies an absent injected terminal/pane before initialization. Do not rebind or close unrelated coordinator sessions.

The coordinator creates a background wrapper terminal and a native Task/Dispatch without prompt injection. No supervised WorkerResource, provider transcript archive or worker-release ownership is manufactured. The wrapper checks its genuine terminal/pane and the opaque native Dispatch incarnation, independently checks the Task's immutable intent digest, and withholds provider input until required controls pass. Provider children retain their normal authentication/config roots while receiving no Orca lifecycle context or API-key route. The host sends native completion after provider settlement; the coordinator separately observes wrapper exit and closes the exact terminal with its original incarnation fence.

Schema2 qualification proofs retain the native Task.result reporter/message/body digest, immutable assignment/result artifacts and independent cleanup receipt. Readback strictly decodes the actual native JSON-string Task.result. Modified artifacts, a foreign reporter/Run/Dispatch, missing native completion or live/unsettled custody invalidate reuse. Native Task completion cannot attest the wrapper's own future exit. Process-group absence and tracked descendant PIDs remain bounded evidence; they do not establish universal containment of escaped or unobserved children.

The actual 1.4.244 inspector reads runtime/workspace identity, launch settings, native catalogs, `accounts.list` and `agentSession.createSupport` through the inspected exported read-only RuntimeClient API, plus documented non-inference provider sources. It validates the unwrapped `agent-context` CLI registry separately from runtime RPC envelopes. The version-bounded adapter loads RuntimeClient from the canonical selected Orca installation and fences the exact runtime ID; Orca owns authentication and no token enters pilot code or evidence. If that export is absent or the installed version differs, the API fails closed. This is an explicitly approved version-bounded integration, not a claim of a separately stable SDK.

Codex and Cursor allowance now comes from `accounts.list({refreshUsage:true})`, with only quota fields retained. Observations older than five minutes are missing evidence; explicit null windows remain unknown. A response exposing no window fields is missing evidence. Original field names and window lengths are preserved, including Cursor's seven-day window exposed under `monthly`. Neither quota nor Premium membership creates spending authority. Existing authorized Codex access and AGY credit use are preserved; only Cursor requires the additional included-Premium-only debit constraint.

No supported Cursor included-only debit source is integrated. The billing blocker reports that gap directly; it is not attributed to launch settings. Even `extraUsage.enabled=false` alone would not prove the permitted debit source. Allowance read failures retain only a structured error class and allowlisted code, without raw account messages. The supported account-refresh read has a30-second timeout; other native reads retain5seconds. This does not establish the cause of any historical failure.

An AGY model with an empty native effort list is still present. The adapter separately reads the installed explicit effort-option mapping, records its source digest and uses its declared `--effort` choices. It never derives an exposed effort from a model-name suffix. A missing mapping is reported as effort unverified.

Each route separately records bootstrap and effective control facts, their source/config digests, enforcement mechanism and observation time. Supported recipes use exact provider versions and public controls. Codex0.164.0 uses a named implicit-deny read profile with inherited Deny preserved, no writes, notify disabled and22 explicit feature disables; it checks merged config, requirements/profile allowance and active thread selection before turn/start. AGY1.4.11 uses a task-owned custom main agent with no tools/MCP/skills/plugins, restrictive session settings and actual pre-input init checks. Its versioned non-inference help may use stderr; inference/native diagnostics retain strict handling. Cursor discovery reads existing exact/eligible-ancestor trust markers, effective supported permission inputs and workspace read boundary. No trust or global configuration is changed.

The older `scopedLaunchPlan` and development-only host relay remain comparative evidence, not the shipped producer or admission authority. The new wrapper uses supported terminal creation and context-only native dispatch, retaining external custody explicitly. Offline tests run real deterministic Node stand-ins through the built composition and stateful native boundaries, including normal/cancel probes, ten topic stages, proof reuse, malformed controls, source/result tampering and final-before-cancel ordering. They confer no live provider or native-route qualification.

C1 remains open operationally. The producer is connected, while current host startup/platform exceptions, inherited-source/Deny audits, AGY hook effects and empty-input timing, Cursor helper/startup/config merge enforcement and included-only account evidence still need their specific source/qualification disposition. Enabled normal Orca/ai-memory hooks do not automatically require renewed approval; audit their effects within existing authority. Missing or unsupported facts stop the affected initialization/input without fabrication. Fresh native product qualification, A9 live acceptance and independent cross-family review remain coordinator-owned; green stand-ins do not close the issue.
