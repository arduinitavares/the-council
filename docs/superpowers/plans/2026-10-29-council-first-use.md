# Council first-use native pilot implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Repair issue #1 with a packaged first-use path that can qualify exact routes in the requesting project and collect a real bounded Council decision under Orca ownership.

**Architecture:** Add a narrowly scoped supervised native pilot beside the retained controller. Its loader preserves legacy configurations and admits the exact incident roster. Separate inspection, admission, qualification, native execution and results so missing required evidence blocks dependent inference while explicit unknown allowance remains unknown. The shipped adapter uses supported Orca commands and validates owned identities, effective selections, provenance and positive settlement. Synthetic fixtures exercise that same adapter boundary without inference.

**Tech stack:** Existing TypeScript, Zod, YAML and Vitest; Node child_process without a shell for runtime commands.

**Spec:** docs/superpowers/specs/2026-10-29-issue-1-contract.md and docs/superpowers/specs/2026-10-29-issue-1-evidence.md. The public issue comment is authoritative.

## Global Constraints

- Baseline is 22782d25097dec67daa38203362b9ad4ba78e680. Do not copy or publish unrelated dirty work from other checkouts.
- Preserve the exact E2 roster: openai codex gpt-6.1-sol max; gemini antigravity gemini-4-argon-high high; xai cursor grok-4.7-xhigh xhigh with effortEncoding model; judge codex gpt-6-astra max.
- Cursor logical xhigh is encoded in its exact model identifier, not a native effort override.
- Preserve existing persisted configurations or reject with an explicit compatibility explanation rather than silently reinterpreting them.
- Missing matching qualification enters bounded first-use only after bootstrap prerequisites pass. Qualification and topic provider calls are counted separately.
- Explicit unknown allowance and unexposed optional telemetry alone do not imply denial/exhaustion. Missing required evidence, actual denial, authentication failure, confirmed exhaustion or unavailable exact selection blocks dependent calls.
- Qualification binds host, versions, model/effort mapping, action, workspace/roots and relevant control evidence. Normal and cancellation outcomes need positive settlement; lost contact remains unknown.
- Native Orca owns lifecycle. No synthetic success, idle screen, model launch receipt or exit zero alone is operational acceptance.
- No global settings, permissions, billing, model policy, desktop startup/focus, native dialogs, provider substitutions or blind retries. No helpers launched by implementer or reviewer.
- Worker canonical execution-host policy is /Users/aaat/.agents/policies/model-policy.md, read before work. Orca is /usr/local/bin/orca on local macOS. This private policy is never published.
- All provider inference for live acceptance is coordinator-owned, bounded, and uses the shipped entry point; implementation tests are credential-free.
- Fresh independent claude-opus-5-5-medium at medium review is required. A9 stays pending and issue stays open if required live controls or access are unavailable.

## Review Focus

- A second registered project must be distinct from the installed package even through a symlink or a foreign cwd.
- Start or observation loss must preserve an existing attempt and prevent duplicate inference.
- Cancel/release must only affect positively bound owned workers and preserve unrelated resources.
- Probe reuse must fail after scope/control/version/model drift and expiry.
- Worker final output must be bound to the owned provider transcript and validated for its role and phase; disagreement remains a real unresolved outcome.

---

### Task 1: Deliver the packaged native first-use launch path

**Files:**
- Create focused modules under src/pilot/ for native configuration, preflight/evidence, qualification, Orca command adapter, workflow and CLI.
- Modify skills/the-council/scripts/run-council.mjs to route an explicit native command through the built pilot CLI while retaining existing controller commands.
- Modify skills/the-council/SKILL.md, package.json and docs/runbook.md as necessary for the runnable distribution.
- Add skills/the-council/references/first-use.md and a portable incident roster example.
- Add credential-free tests under test/pilot/ and packaging/entry regression coverage.
- Add docs/qualification/issue-1-validation.md with baseline RED, submitted GREEN and an honest live gate record.

**Interfaces:**
- The pilot has its own strict configuration validation and uses ModelSelection semantics including optional model-encoded effort. Existing controller config/run formats are preserved.
- A typed PilotDriver boundary inspects native evidence, launches an exact owned attempt, observes its bound final output, cancels, and releases. The actual shipped Orca adapter implements it; tests inject command receipts at the subprocess boundary.
- runPilot drives bootstrap classification, matching proof reuse or normal/cancel qualification, then readiness/review/judge/ballot and outcome collection. A supplied candidate and supplied text permit a bounded one-round smoke decision.
- The CLI accepts an explicit requesting workspace and input/config paths, resolves package resources canonically, records finite call/deadline limits before inference and persists sanitized evidence in the requesting project.
- Required control evidence must be discovered from supported real host/provider sources, not a user-invented trusted receipt. If the current host cannot expose a required fact, return its specific blocker and retain the implementation for review. Do not invent an unsupported capability or add an always-unqualified stub.

- [ ] Step 1: Read the task brief, both public spec files, the relevant existing config/launcher/policy/transport code, and execution-host policy. Keep runtime investigation bounded to supported public CLI/API sources. Escalate concrete architecture gaps to the coordinator.
- [ ] Step 2: Write and run baseline regressions that prove E2 roster rejection and missing shipped native first-use/topic path against unchanged baseline bytes. Capture exact failing assertions, command, baseline SHA and fixture provenance.
- [ ] Step 3: Implement strict pilot configuration and compatibility, preserving exact selections through freeze/reload, agent mapping and encoded effort launch assertions.
- [ ] Step 4: Implement real bootstrap classification and qualification lifecycle, then launch/collection. Cover every A3-A6 matrix variant through the shipped adapter boundary. Assert separate probe/topic counts, order, bound identities and cleanup.
- [ ] Step 5: Implement bound role results, required nonvoting judge and actual ballots/outcome. Add meaningful malformed/mismatched output and disagreement tests; do not manufacture consensus. Settle all owned resources or explicitly retain unknown status.
- [ ] Step 6: Package launcher, configuration example, procedure and diagnostics. Test cross-project invocation and fresh-clone/package assets without provider credentials or reporter-home files. No production behavior may depend on private files.
- [ ] Step 7: Run focused tests while editing, then npm test -- --maxWorkers 2, npm run typecheck and npm run build once on the completed implementation. Record outputs. The global default Vitest worker count stalled on this host, while --maxWorkers 2 runs bounded checks.
- [ ] Step 8: Self-review and commit only the issue repair, specs, plan and public sanitized evidence. Do not push or open a PR. Write the full implementer report including RED/GREEN evidence and live prerequisites; return DONE or DONE_WITH_CONCERNS with concrete evidence.
- [ ] Step 9: Coordinator performs bounded second-project acceptance with the shipped entry and records positive native evidence or precise prerequisites_not_verified with zero dependent calls. The fresh Opus review examines both implementation and evidence. Live gate pending cannot close the issue.

## Plan review revision, 2026-10-29

The fresh Opus review lives in this plan's SDD workspace. These concrete requirements amend Task 1 and are part of its brief.

### Control sources and admission

Supported protocol floor for this repair: Orca 1.4.244 local macOS. Current observation: AGY 1.4.10 and Codex 0.164.0. Record the actual Cursor version before accepting its route. Inspect the installed registry and schema before native calls; do not import private application modules or publish transport authentication. The implementation may use a small version-bounded local NDJSON RPC adapter after its request/authentication/runtimeId fencing behavior is verified against Orca's exported runtime client and strict registered parameter schemas.

| Required fact | Supported source and parse rule | Missing/negative result |
| --- | --- | --- |
| Already-running runtime and exact supported host version | `orca status --json`; reachable runtimeId/appVersion and advertised required capabilities | RUNTIME_UNAVAILABLE or UNSUPPORTED_RUNTIME; zero dependent inference |
| Requesting workspace identity, canonical path and roots | `orca worktree show --worktree path:<explicit-requesting-path> --json`; exact returned path/identity, checked against realpath; never infer from package or current selector | WORKSPACE_UNVERIFIED |
| Exact model/effort/catalog admission | Registered `agentSession.modelCatalog` read API with exact agent/worktree and source metadata, plus current provider catalog where documented; exact ID/effort, never aliases | MODEL_UNAVAILABLE or CATALOG_EVIDENCE_MISSING |
| Current policy admission | Read explicit canonical policy path, hash exact bytes and record the selected policy interpretation; no policy edits | POLICY_EVIDENCE_MISSING or POLICY_SELECTION_DENIED |
| Prelaunch mode, permissions, sandbox, tools, roots, helper and hook controls | Registered `settings.getAgentLaunch` read API and applicable documented provider settings; parse only real exposed schema fields. Saved full-access defaults do not prove read-only containment. Verify resulting per-entry settings via registered `agentSession.options` and native result/step evidence when available | REQUIRED_CONTROL_MISSING or REQUIRED_CONTROL_UNSUPPORTED; do not launch a probe requiring the missing control |
| AGY catalog/version/allowance | `agy --version`, `agy models`, and documented non-inference `agy -p /usage --output-format json --print-timeout 20s` without disabled slash expansion; require zero-turn command envelope, inspect all exposed group windows | ALLOWANCE_EVIDENCE_MISSING; explicit unknown is preserved; actual denied/authentication/exhausted states stop |
| Cursor included-Premium-only billing-source binding | Current supported Cursor account/billing/configuration observation that proves the permitted debit source without changing it. Source still requires actual host verification; catalog or remaining quota alone does not prove debit binding | BILLING_SOURCE_UNVERIFIED, REQUIRED; zero dependent Cursor probes/topic calls |
| Allowance amount | Current provider-specific observation, including explicit unknown with a source | Optional precision; unknown amount is allowed within fixed scope and bounds; a missing required observation is not explicit unknown |
| Requested versus exposed execution selection | Native worker-start requested/effective values plus provider options/result identity; Cursor requires exact exposed grok-4.7-xhigh and omits native effort override | EFFECTIVE_SELECTION_MISMATCH or EFFECTIVE_SELECTION_UNVERIFIED |
| Final result provenance and owned lifecycle | worker-show/read transcript sourceIdentity/provider/session/Dispatch, unclipped final result, worker_done, stop and release receipts bound to the recorded owned attempt | RESULT_UNBOUND or SETTLEMENT_UNKNOWN; no fresh retry on contact loss |
| Optional telemetry and hidden backend effort | Preserve unexposed states, with source. Encoded logical effort differs from hidden backend computation | Not denial/exhaustion by itself; never manufacture an exposed value |

All supplied-text review entries have no-write scope. Granted roots must remain confined to the declared task packet area; protected instruction/settings/credential targets need verified read-only controls or exclusion. AGY plan mode and sandbox must be verified rather than inferred from prompt text. Native per-entry controls may restrict scope but cannot broaden it or bypass existing Ask/Deny. Cursor read-only/ask and included-pool restrictions require their own verified host/action evidence. If a required source remains unavailable, publish its exact blocker and keep live acceptance pending.

### Receipt, journal and outcome contracts

- Qualification receipt fields: schema version, ID, issuedAt, expiresAt, host/runtime identity, Orca/AGY/Codex/Cursor versions, exact selection with logical effort and effortEncoding, action class, requesting Orca workspace ID and canonical realpath, exact roots, control-source digest, normal and cancellation attempt IDs/outcomes, and positive settlement evidence for every owned resource. TTL is finite, with a maximum of 24 hours.
- Store native pilot run evidence below the requesting workspace's `.council/` directory. The implementer documents exact stable subpaths. Qualification reuse requires equality of host, relevant versions, selection/encoding, workspace/roots, action and control digest plus unexpired successful normal/cancel outcomes and positive settlement. Missing, foreign, expired and drifted proof require fresh qualification.
- Persist a write-ahead attempt reservation and mutation request ID before launch; update Run/Task/Dispatch/provider/terminal bindings from native receipts. Unknown mutation/observation fences that slot against new inference, including after restart. Reconcile the original request/owned IDs; never guess a fresh identity. No unrecorded handle may be cancelled or released.
- A cancellation probe launches its exact route, requests stop before normal completion, and requires positively proven provider/children/wrapper/timer/terminal settlement and acknowledged release. Contact loss is unknown. Launch-start timeout is not an inference deadline.
- Strictly parse final readiness, review, nonvoting judge and ballots against role, phase, packet/context/candidate bindings and source identity. A success-shaped object without a bound final native transcript is insufficient. Do not coerce malformed output or ignore clipping warnings.
- Preserve exactly three equal voters and a nonvoting judge. Unanimity requires three unconditional current acceptances; disagreement stays unresolved. Reuse domain primitives when compatible with the native xAI seat; never silently map xAI to Claude just to call the legacy controller.
- Extend shared ModelSelection syntax for optional encoded effort/route compatibility where that avoids duplication without changing persisted legacy hashes. The native roster and orchestration may have separate strict schemas. The retained entry must explicitly direct a native-only roster to the native command rather than silently reinterpret or generically reject it.
- Subprocess fixtures must cite captured, sanitized native output shapes and versions and remain labelled synthetic. Future/exposed-control variants must be distinguished from current-host observations. A synthetic positive never becomes live qualification.
- Fresh clone setup is explicit: `npm ci`, `npm run build`, then the shipped skill launcher. Test package assets and a symlinked installation from a foreign cwd without provider credentials. Unsupported runtime versions/capabilities fail specifically.
- Live acceptance is bounded to 8 qualification calls plus 10 topic calls, zero automatic retries, a 30-minute absolute deadline and at most 120 seconds per inference call. Record exact revision, versions, requesting project, policy/config/control sources, included billing constraints and owned resources before inference. If preflight fails, provider calls remain zero. Do not substitute a 7-call workflow that omits the final ballots.
- Verification can and must be rerun when review fixes, failures or changed bytes justify it. The successful clean baseline is 596 tests / 44 files in 318 seconds; do not misclassify its normal runtime as a hang.

### Traceability and review disposition

A1/A2 are covered by strict config, compatibility and package entry tests. A3-A6 are covered by table-driven subprocess/native-adapter workflow tests, receipt reuse, journal recovery and call-order/count assertions. A7 is covered by bound full-stage result and disagreement tests. A8 needs meaningful selected-baseline schema/stub/entry RED and submitted GREEN. A9 requires the shipped bounded entry and a sanitized native receipt or a precise zero-dependent-call blocker. A10 requires task and whole-change reviews of frozen artifacts and evidence.

The plan retains one cohesive implementation task because configuration, host inspection, journal, adapter and workflow must agree to produce the single working first-use path. Its modules have separate focused tests; the task and whole-change independent reviews remain mandatory. Splitting scaffolding into eight independently accepted deliveries would not satisfy the issue sooner. This is a coordinator ruling, not reviewer approval.



### Scoped plan re-review guardrails

Use only native API methods publicly exported by the inspected installed Orca client and verified against its strict registry. Prefer that official client to a hand-written transport. Do not probe arbitrary local services, reconstruct private authentication, or read/reuse transport credentials outside the supported client. If a method has no supported client binding, report that precise external blocker. No private app-module import may become a reporter-home or offline-test dependency.

Qualification receipts and reuse include the exact policy-bytes hash. The documented non-inference AGY usage command is outside the 18-call inference bound and must report zero turns/tokens; otherwise record ALLOWANCE_EVIDENCE_MISSING and stop that discovery path. The absolute 30-minute deadline is stricter than the sum of per-call ceilings: on expiry stop and settle every positively owned resource, record partial evidence and no retry. A malformed ballot cannot count toward acceptance and leaves the decision unresolved or blocked. The pilot uses its documented native preflight/qualification schemas while preserving retained-controller evidence distinctions and saved formats; it does not silently bypass a required check.

Council bootstrap probes do not automatically qualify the coordinator's separate ordinary host/model/action route under model policy. Keep those scopes explicit. Every route needs exact model/effort, no-write scope, sandbox/permission/roots/helper controls, billing-source binding and allowance observation before its normal/cancel probes; optional telemetry and hidden backend computation do not by themselves block.
