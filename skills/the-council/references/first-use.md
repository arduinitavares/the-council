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

Replace `deadline` with an absolute UTC epoch in milliseconds no more than 30 minutes ahead. The example timestamp is illustrative and expires. Do not reuse an old deadline. Provide the actual execution-host policy path; the package includes no private policy. Set exact configuration using the packaged `first-use-roster.yaml` or an explicit `--config` path. All relative input/config/policy paths resolve from the explicit requesting workspace.

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

A busy cache returns exit 3 before reserving the run ID. A stale `writer.lock` is never stolen or removed automatically. To recover, identify the previous invocation and its journal, positively establish that its writer and owned resources have settled, then archive its cache and lock before removing only that invocation's exact lock. If ownership or settlement cannot be established, retain the lock and reconcile the original invocation. Age alone is insufficient. An existing native run directory continues to fence relaunch after cache recovery.

Every inference budget starts before launch and is capped at the earlier of the run deadline and the per-worker limit (at most120seconds). A launch that uses that budget cannot produce a probe proof or start another phase. Cancel probes use that same bound, rather than the whole remaining run.

On failure or absolute deadline expiry, cleanup gets a separate30-second settlement window with no new inference. It sends one stop and polls the original bound resource; a following release command has its own maximum5-second command timeout. A direct cancellation begun after its inference deadline also gets at most30seconds of settlement grace. Contact loss stays unknown and never authorizes another stop or launch. Results remain `settlement: unknown` until positive resource release. Invalid bounds or insufficient call budget return `invalid_request`; an unresolved judge returns `judge_unresolved`.

Three readiness calls, three reviews, one nonvoting judge and three ballots comprise the ten topic calls. Eight separate normal/cancellation probes cover all four exact selections when current proof is absent. The three voters must each approve unconditionally for consensus. Disagreement and an unresolved judge stay unresolved. Provider start, worker_done, an idle screen or exit zero alone do not substitute for bound transcript results and positive native resource release.

## Current support boundary

The shipped adapter implements native Run/worker launch, requested/effective selection checks, bounded transcript collection, owned cancellation and release. Credential-free tests inject synthetic receipts at the subprocess/API boundaries. Those tests are not native qualification.

The actual 1.4.244 inspector reads runtime/workspace identity, launch settings, native catalogs, `accounts.list` and `agentSession.createSupport` through the inspected exported read-only RuntimeClient API, plus documented non-inference provider sources. It validates the unwrapped `agent-context` CLI registry separately from runtime RPC envelopes. The version-bounded adapter loads RuntimeClient from the canonical selected Orca installation and fences the exact runtime ID; Orca owns authentication and no token enters pilot code or evidence. If that export is absent or the installed version differs, the API fails closed. This is an explicitly approved version-bounded integration, not a claim of a separately stable SDK.

Codex and Cursor allowance now comes from `accounts.list({refreshUsage:true})`, with only quota fields retained. Observations older than five minutes are missing evidence; explicit null windows remain unknown. A response exposing no window fields is missing evidence. Original field names and window lengths are preserved, including Cursor's seven-day window exposed under `monthly`. Neither quota nor Premium membership creates spending authority. Existing authorized Codex access and AGY credit use are preserved; only Cursor requires the additional included-Premium-only debit constraint.

An AGY model with an empty native effort list is still present. The adapter separately reads the installed explicit effort-option mapping, records its source digest and uses its declared `--effort` choices. It never derives an exposed effort from a model-name suffix. A missing mapping is reported as effort unverified.

Each route records `scopedLaunchPlan`: the registered `agent.launch` request, background terminal presentation, exact selection and supported provider arguments, a declared packet cwd, no prompt, and external terminal custody after `worker-start --terminal` adoption. Operation identity must be journaled before any future mutation. These are actionable plans, not qualification receipts. Conditional policy rows retain their pending host/action qualifier; they permit explicitly authorized disposable first-use probes after bootstrap controls pass, without requiring unrelated historic qualification.

On the inspected host, structured Cursor sessions are unsupported, while a scoped terminal route is supported in the registered API. The package now includes host-side AGY final-stream collection and one-shot native completion reporting, an owned POSIX process-group/timer guard, and registered no-prompt `agent.launch` / exact external-terminal inspection/close components. The launch recipe uses the API's actual string-valued `agentArgs`. Conditional offline tests exercise these components, including ambiguous launch/report/close fencing, without provider credentials or inference.

C1 remains open. The native entry does not yet connect those components into a qualified scoped wrapper/adoption producer. Effective tools/hooks/helpers/read roots, pre-inference sandbox evidence and complete provider/escaped-child/wrapper/timer/terminal settlement are still unverified. A process-group exit proves only that group. Native worker release cannot certify external custody, and an external close receipt is not a qualification proof. A host relay must run under the task-created wrapper's genuine native caller identity; the coordinator cannot impersonate a child with `--from`. Current-task Cursor trust and supported included-Premium-only spending evidence are also missing. These facts block dependent probes/topic calls. Live A9, independent review and issue closure remain pending.
