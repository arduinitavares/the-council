# The Council Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an explicitly invoked skill that obtains three equal model-family assessments and a fresh judge report, then returns unanimous advice or unresolved questions.

**Architecture:** A thin skill keeps the calling agent in charge of candidate synthesis. A pure XState reducer emits effect intents. A local controller persists those intents in SQLite and executes them through qualified Orca and evidence adapters.

**Tech Stack:** Node.js `22.23.4`, TypeScript `7.0.2`, XState `5.33.3`, Zod `4.6.7`, better-sqlite3 `13.0.3`, Vitest `5.0.5`.

**Spec:** [Approved design](../specs/2026-10-23-the-council-design.md), committed at `1e166a5` and approved by the user on 2026-10-23.

## Global Constraints

- Reviewer seats: `gpt-6-astra` / `ultra` through Codex, `gemini-4-argon-high` / `high` through Antigravity, and `claude-opus-5-5-high` / `high` through Antigravity.
- Judge: a fresh `gpt-6-astra` / `ultra` session between reviewer phases, with no acceptance vote.
- Consensus requires three explicit acceptances of the same immutable candidate, evidence bundle, and judge report.
- Default maximum: three admitted rounds. A round counts when its first initial-review inference starts.
- Maximum worker attempts: `7 * maxRounds * 2`, or `42` at the default. Each logical output permits one format correction.
- Worker attempt timeout: `1_800_000` ms. Invocation timeout: `10_800_000` ms. The earlier deadline always wins.
- Maximum four visible active workstreams including the caller. One active Astra by default, counting the caller.
- Reviewer tasks settle before the judge starts. The judge settles before confirmation tasks start.
- An Astra caller conflict blocks before launch. Version one performs no automatic ownership handoff.
- No worker helpers, nested coordinators, AGY Boost, or AGY Teamwork.
- Use the task's actual Orca workspace. Record the hosting workspace and task-owned process cwd separately.
- Read the execution host's current `/Users/aaat/.agents/policies/model-policy.md` before assignments and fallback decisions.
- No silent route, model, effort, permission, or billing substitution. Preserve denial and unknown-lifecycle states.
- Handoff files stay in the OS temporary directory. Loss of required temporary context leads to `needs_context`.
- Natural-language packets and reports use the installed Simplified Technical English skill as an Issue 9-oriented profile.
- Preserve code, identifiers, paths, URLs, citations, assumptions, and uncertainty exactly.
- Version one targets this local macOS host. Remote hosts and Windows are separate future qualifications.
- This plan authorizes no implementation, global installation, policy change, or deployment until the user selects execution.

## Review Focus

1. A malformed, oversized, stale, or forged worker result must never create assent. Tests belong to Tasks 1 and 5.
2. A crash after external launch but before receipt commit must never create a duplicate worker. Tests belong to Tasks 3 and 5.
3. An unknown caller model, changed owner, or active Astra caller must block an unproven launch. Tests belong to Tasks 4 and 7.
4. Source drift, a changed candidate, or a missing temporary handoff must invalidate dependent acceptance. Tests belong to Tasks 1, 6, and 7.
5. Deadline expiry, clock regression, cancellation, and connection loss must preserve unknown lifecycle until positive settlement evidence exists. Tests belong to Tasks 5 and 7.

---

## Scope and checkpoints

The repository currently contains documentation only. Do not treat the diagrams as an implemented machine.

This is one integrated local application, not several independent projects. Each task below delivers a separately testable boundary.

Tasks 1–4 can use fake external adapters. Task 5 contains the live transport feasibility gate. Later deterministic work can continue with fakes if a live route is unavailable.

Real Council runs and installation remain blocked until every required transport passes. The earlier supplied-text Argon review qualifies assessment only.

### Dependency pins

Use exact dependency versions and commit the generated `package-lock.json`:

| Kind | Package | Version |
| --- | --- | --- |
| Runtime | `xstate` | `5.33.3` |
| Runtime | `zod` | `4.6.7` |
| Runtime | `better-sqlite3` | `13.0.3` |
| Development | `typescript` | `7.0.2` |
| Development | `vitest` | `5.0.5` |
| Development | `@types/node` | `22.20.5` |
| Development | `@types/better-sqlite3` | `9.6.0` |

Registry metadata was checked on 2026-10-23. These packages were not installed during planning.

Use ESM, `module: NodeNext`, `target: ES2022`, `strict`, `exactOptionalPropertyTypes`, and `noUncheckedIndexedAccess`.

Use local package scripts: `test = vitest run`, `typecheck = tsc --noEmit -p tsconfig.json`, and `build = tsc -p tsconfig.build.json`.

The package binary is `council`, targeting `dist/cli/index.js`. Use `.js` import suffixes in TypeScript source.

## File map

| Area | Files | Responsibility |
| --- | --- | --- |
| Domain | `src/domain/contracts.ts`, `schemas.ts`, `hash.ts`, `consensus.ts`, `objections.ts` | Strict protocol types, hashes, assent, and owned objection changes |
| Machine | `src/machine/council-machine.ts`, `reduce.ts` | Pure transitions and deterministic effect intents |
| Persistence | `src/store/run-store.ts`, `schema.sql`, `artifacts.ts` | Single-writer journal, checkpoints, outbox, and immutable blobs |
| Input and policy | `src/input/handoff.ts`, `src/policy/preflight.ts`, `src/policy/qualification.ts` | Temporary packet, scope manifest, current-policy attestation, route gates |
| Orca | `src/orca/client.ts`, `transport.ts`, `observations.ts` | Version-matched commands, real identities, and lifecycle interpretation |
| Provider bridge | `src/workers/bridge.ts`, `protocol.ts`, `watchdog.ts` | Bounded source-only worker execution and inspected provider results |
| Evidence | `src/evidence/adapter.ts`, `scope.ts` | Permitted retrieval and exact declared checks |
| Runtime | `src/runtime/controller.ts`, `inbox.ts`, `reconcile.ts`, `deadlines.ts` | Foreground coordination, control requests, effects, and recovery |
| Reports | `src/reports/render.ts`, `language-profile.ts` | Consensus, disagreement, blockers, and STE-oriented diagnostics |
| CLI | `src/cli/index.ts`, `parse.ts` | Start, inspect, respond, resume, cancel, and qualification commands |
| Skill | `skills/the-council/SKILL.md`, `agents/openai.yaml`, `scripts/run-council.mjs`, `references/communication.md` | Explicit invocation, caller loop, and portable communication contract |
| Tests | `test/domain/`, `machine/`, `store/`, `policy/`, `orca/`, `evidence/`, `runtime/`, `cli/`, `skill/` | Focused unit, crash, and fake-provider integration tests |
| Fixtures | `test/fixtures/builders.ts`, `fake-orca.mjs`, `fake-provider.mjs` | Deterministic test data and real subprocess fixtures without real models |
| Operations | `docs/qualification/local-macos.md`, `docs/runbook.md` | Qualification receipts, safe recovery, installation, and rollback |

## Shared contracts

Define these names in `src/domain/contracts.ts`. Later tasks import them rather than defining competing variants.

- `ReviewerSeat = 'astra' | 'argon' | 'opus'`; `WorkerRole = ReviewerSeat | 'judge'`.
- `JsonValue` is JSON null, boolean, finite number, string, array, or an object with string keys and JSON values.
- `ArtifactRef`: artifact kind, SHA-256, canonical local path, and byte count.
- `RunScope`: canonical permitted source roots, allowed source addresses, and `CheckSpec[]`. A `CheckSpec` fixes its ID, argv, cwd, declared effects, and output targets.
- `ControlState` is the exact 14-state union from the approved design and diagram source.
- `RunRequest`: `runId`, `workspace`, `topic`, `handoffPath`, `handoffHash`, `scope`, `maxRounds`, `workerTimeoutMs`, `runTimeoutMs`.
- `RoundBindings`: `runId`, `round`, `candidateHash`, `evidenceHash`, `judgeHash`.
- `PhaseBindings`: run ID, round, input hash, logical task key, and `originAttemptId`. Initial reviews use these before a candidate exists.
- Judge bindings add candidate and evidence hashes. Ballot bindings also add the judge report hash.
- `AttemptBinding`: logical task key, actual transport attempt ID, `originAttemptId`, role, phase, exact requested model, and adapter-issued authority.
- Normally the origin and transport attempt IDs match. A format sub-attempt keeps the original assessment's origin ID and records its own transport ID.
- `WorkerPayload` is the strict tagged union `review`, `judge`, or `ballot`. A review contains proposals, objections, evidence requests, and missing-input IDs. A judge report contains evidence assessments and challenges. A ballot contains assent data.
- `WorkerResult` is a validated payload with adapter provenance, or `{ status: 'invalid'; code: string }`. Model output cannot supply adapter provenance.
- `Ballot`: bindings, seat, `decision: 'accept' | 'reject' | 'abstain'`, `conditional`, objection dispositions, challenge responses, and reason.
- `FrozenCandidate`: text artifact reference, hash, stated assumptions, tradeoffs, and unresolved uncertainty.
- `Objection`: ID, owner reviewer seat, claim ID, open/closed status, and an append-only disposition history.
- `EvidenceRecord`: request ID, `status: 'verified' | 'invalid' | 'unverified' | 'not_applicable'`, source location, content hash, and observation receipt.
- `ClaimAssessment`: `supported`, `contradicted`, or `unresolved`, with evidence IDs and reasons. This is separate from evidence provenance.
- `ConfirmationContext`: expected bindings and attempt map, candidate, three ballots, objection ledger, and judge challenge IDs.
- `ConsensusDecision`: `{ kind: 'unanimous' }` or `{ kind: 'unresolved'; reasons: string[] }`.
- `RunSnapshot`: machine version, schema version, revision, control state, and `RunContext`.
- `RunContext`: request manifest, rounds used, current immutable round references, expected attempts, objections, ballots, pending outcome, deadlines, and recorded resume target.
- `EffectIntent`: stable key plus a discriminated kind: launch, observe, stop, release, evidence, candidate request, report, or deadline.
- `TransitionResult`: `{ snapshot: RunSnapshot; intents: EffectIntent[] }`.
- `Authority`: a real supervised Orca Run/Task/Dispatch binding, or a clearly labelled terminal-only binding. They are never interchangeable.
- `WorkerObservation`: `live`, `unverifiable`, or `exited`, with raw receipt references and the exposed exit code, including `null`.
- `ValidatedEvent` is the strict event envelope with event/run IDs, schema version, actor origin, round/phase, and a typed body. The trusted input adapter supplies actor origin.
- `Clock` provides `wallNow(): number` and `monotonicNow(): number`. Neither method is available inside the reducer.
- `RunOutcome`: decision outcome, control state, operational settlement status, report references, and remaining blockers.

Boundary-specific types are exported by their producing module: handoff input/reference by Task 4's handoff module; preflight and qualification inputs/decisions by Task 4's policy modules; store receipts by Task 3; transport specifications/receipts by Task 5; report input/artifacts by Task 6; and controller options, control requests/receipts, and CLI I/O by Task 7. Each type contains the inputs or receipts named in its task contract. Later tasks must import these types.

All public decoders use strict Zod objects. Unknown fields, duplicate reviewer seats, unsafe paths, and invalid hashes fail explicitly.

Canonical JSON sorts object keys and preserves array order and exact strings. Reject non-JSON values and non-finite numbers. Do not normalize protected text.

Use SHA-256 with an artifact-kind and schema-version prefix. Freeze all inputs before hashing. Runtime IDs and clock observations enter as recorded input.

Default input limit is 8 MiB. Default final worker-result limit is 1 MiB. An oversized result fails explicitly without truncation into a valid vote.

## Task 1: Strict protocol and unanimous acceptance

**Files:** Create package files, TypeScript/Vitest configuration, `.gitignore`, `src/domain/*`, `test/fixtures/builders.ts`, and `test/domain/{schemas,hash,consensus,objections}.test.ts`.

**Interfaces:**
- Consumes: approved requirements and exact model roster.
- Produces: shared contracts, `parseWorkerPayload(raw: unknown): WorkerPayload`, `hashArtifact(kind: string, value: JsonValue): string`, `applyOwnedDispositions(context: ConfirmationContext): readonly Objection[]`, and `evaluateConsensus(context: ConfirmationContext): ConsensusDecision`.
- Test builders: `makeConfirmation(overrides?: Partial<ConfirmationContext>): ConfirmationContext` and `makeBallot(seat: ReviewerSeat, overrides?: Partial<Ballot>): Ballot`.

- [ ] **Step 1: Create the package configuration.** Use the exact pins and compiler settings above. Ignore `node_modules/`, `dist/`, coverage output, and `.council/`.
- [ ] **Step 2: Install project-local dependencies and create the lockfile.** Run `npm install`. Do not update global Node, npm, or agent settings.
- [ ] **Step 3: Add failing protocol tests.** Include these assertions and separate cases for duplicate seats, stale attempt IDs, changed hashes, conditional assent, missing challenge responses, and another seat's objection closure:

```ts
expect(evaluateConsensus(makeConfirmation())).toEqual({ kind: 'unanimous' });
expect(evaluateConsensus(makeConfirmation({
  ballots: [makeBallot('astra'), makeBallot('argon'), makeBallot('opus', { decision: 'reject' })],
})).kind).toBe('unresolved');
```

- [ ] **Step 4: Verify red.** Run `npm test -- test/domain`. Expected: missing domain exports or failed invariant assertions, not a broken test runner.
- [ ] **Step 5: Implement the domain exports.** Derive seat identity from adapter bindings, never model-authored role claims. Apply owner dispositions before consensus. Preserve the frozen input ledger.
- [ ] **Step 6: Verify green.** Run `npm test -- test/domain`, then `npm run typecheck`. All tests must pass.
- [ ] **Step 7: Commit this deliverable.** Commit package/config files, `src/domain`, and the domain fixtures/tests with `feat: add strict council protocol and consensus rules`.

## Task 2: Pure XState control machine

**Files:** Create `src/machine/{council-machine,reduce}.ts` and `test/machine/{rounds,guards,replay}.test.ts`.

**Interfaces:**
- Consumes: Task 1 contracts and acceptance functions.
- Produces: `createInitialSnapshot(request: RunRequest): RunSnapshot`, `reduceRun(snapshot: RunSnapshot, event: ValidatedEvent): TransitionResult`, and `restoreForReconciliation(snapshot: RunSnapshot): RunSnapshot`.
- Machine version and schema version both start at `1`. Incompatible snapshots are never silently upgraded.

- [ ] **Step 1: Add failing state tests.** Cover every state and edge in the canonical file's `states` diagram. The component and recovery flowcharts are explanatory views, not additional machine states. Include these exact outcomes:

```ts
expect(reduceRun(roundThreeWithOneReject, ballotsReady).snapshot.state).toBe('settling');
expect(reduceRun(roundThreeWithOneReject, ballotsReady).snapshot.context.pendingOutcome).toBe('needs_user');
expect(reduceRun(confirmationReady, ballotsReady).snapshot.context.pendingOutcome).toBe('completed');
```

- [ ] **Step 2: Verify red.** Run `npm test -- test/machine`.
- [ ] **Step 3: Implement pure transitions.** Use XState `initialTransition` and `transition`. Use `machine.resolveState` to reconstruct the pinned state/context. Do not start provider actors in the machine. Emit launch intents only on explicit admission or phase-advance events, never on state entry alone. A reconciliation re-entry must observe the existing attempt.
- [ ] **Step 4: Implement deterministic intents.** Keys contain run, round, phase, role, logical assignment, and sub-attempt. Read no clock, filesystem, network, or random source in guards or reducers.
- [ ] **Step 5: Add round and safety assertions.** Initial-review admission increments the counter exactly once. A unanimous missing-issue ID pauses after review and consumes the round. A judge cannot author a ballot. A fourth round requires an explicit authorized extension event.
- [ ] **Step 6: Verify replay and ordering.** Replay the same event history twice and compare all snapshots/intents. Deliver the three reviewer results in all six arrival orders and compare the completed phase output.
- [ ] **Step 7: Verify green and commit.** Run `npm test -- test/machine` and `npm run typecheck`. Commit with `feat: model deterministic council control states`.

## Task 3: Transactional journal, artifacts, and effect outbox

**Files:** Create `src/store/{run-store,artifacts}.ts`, `src/store/schema.sql`, and `test/store/{transactions,writer,crash-window,artifacts}.test.ts`.

**Interfaces:**
- Consumes: `RunSnapshot`, `ValidatedEvent`, `EffectIntent`, and canonical hashes.
- Produces: `openRunStore(root: string): RunStore`; `RunStore.load(runId): RunSnapshot`; `RunStore.commitTransition(runId, expectedRevision, event, result): CommitReceipt`; `RunStore.pendingEffects(runId): EffectIntent[]`; `RunStore.recordEffectReceipt(key, receipt): void`; and `putArtifact(bytes: Uint8Array): ArtifactRef`.

- [ ] **Step 1: Add failing transaction tests.** Use a temporary database and an injected failure after each journal/checkpoint/outbox write:

```ts
expect(() => store.commitTransition(runId, 4, event, transition)).toThrow('REVISION_CONFLICT');
expect(reopened.pendingEffects(runId).map(x => x.key)).toEqual([intent.key]);
expect(reopened.load(runId).revision).toBe(1);
```

- [ ] **Step 2: Verify red.** Run `npm test -- test/store`.
- [ ] **Step 3: Implement schema and transaction boundaries.** Use WAL, `synchronous = FULL`, foreign keys, and a 5,000 ms busy timeout. Use an immediate transaction for event, checkpoint, and outbox writes. Keep all external I/O outside the transaction.
- [ ] **Step 4: Enforce one active writer.** Record owner identity and generation. Require expected revision on each mutation. A timeout alone cannot steal an owner's lease. A new owner requires release or positive process-exit evidence.
- [ ] **Step 5: Implement immutable artifacts.** Write task-owned temporary bytes, hash them, then atomically rename into the run's content store before referencing them. Existing hash conflicts are fatal. Orphaned blobs receive no automatic destructive cleanup.
- [ ] **Step 6: Verify crash windows.** Kill the test child before external launch, after a fake launch, and before receipt commit. Confirm the intent remains reconcilable and no new launch is authorized by missing data alone.
- [ ] **Step 7: Verify green and commit.** Run `npm test -- test/store` and `npm run typecheck`. Commit with `feat: persist council journal and effect outbox`.

## Task 4: Handoff, scope, and policy preflight

**Files:** Create `src/input/handoff.ts`, `src/policy/{preflight,qualification}.ts`, and `test/policy/{handoff,models,ownership,scope}.test.ts`.

**Interfaces:**
- Consumes: `RunRequest`, source manifest, caller identity, current policy bytes, exposed allowance, and qualification receipts.
- Produces: `writeHandoff(input: HandoffInput, tempRoot: string): HandoffRef`; `validateScope(scope: RunScope): ScopeDecision`; and `runPreflight(input: PreflightInput): PreflightDecision`.
- `PreflightDecision` is `ready`, `needs_context`, or `blocked`, with stable reason codes and supporting receipt references.

- [ ] **Step 1: Add failing preflight tests.** Use injected OS paths and current-policy hashes:

```ts
expect(runPreflight(astraCallerWithoutExtraSlot).reason).toBe('ASTRA_CALLER_CONFLICT');
expect(runPreflight(unknownCaller).reason).toBe('CALLER_MODEL_UNKNOWN');
expect(runPreflight(unqualifiedUltra).reason).toBe('UNQUALIFIED_ROUTE');
```

- [ ] **Step 2: Verify red.** Run `npm test -- test/policy`.
- [ ] **Step 3: Implement temporary handoff creation.** Use `$TMPDIR`, else `/tmp`, on this host. Include suggested skills, requirements, priorities, prior decisions, references, and uncertainty. Reference existing artifacts instead of copying them. Reject known secret fields and leave sensitive exclusions visible to the calling agent.
- [ ] **Step 4: Implement policy attestation.** The calling agent must read the current human policy and supply its normalized choices. The runner verifies the file hash, fixed roster, caller/slot observations, and qualification receipts. It must not pretend that a regex parser can interpret arbitrary policy prose.
- [ ] **Step 5: Implement route and access gates.** Require exact requested/exposed settings, current host/version/action-class qualification, separate quota states, and approved action roots. Unknown quota permits only the declared bounded invocation. Authentication failure, denial, and quota exhaustion stay distinct.
- [ ] **Step 6: Reject unsafe scope.** Resolve canonical roots and reject symlink escapes. Keep source credentials, protected instructions, and coordinator control state outside worker roots unless an existing qualified control protects them. Do not add directories or persistent grants merely to make reads work.
- [ ] **Step 7: Verify green and commit.** Run `npm test -- test/policy` and `npm run typecheck`. Commit with `feat: validate council handoff and launch prerequisites`.

## Task 5: Qualified Orca transport and bounded worker bridge

**Files:** Create `src/orca/{client,transport,observations}.ts`, `src/workers/{bridge,protocol,strict-json,watchdog}.ts`, subprocess fixtures, and `test/orca/{argv,protocol,lifecycle,reconcile,deadline,qualification}.test.ts`.

**Interfaces:**
- Consumes: effect intents, immutable task packets, Task 4 qualification/access decisions, and current Orca guides.
- Produces `OrcaTransport` with `launch(spec: WorkerSpec): Promise<LaunchReceipt>`, `observe(binding: AttemptBinding): Promise<WorkerObservation>`, `stop(binding, reason): Promise<StopReceipt>`, and `release(binding): Promise<ReleaseReceipt>`.
- Also produces `qualifyRoute(request: QualificationRequest): Promise<QualificationReceipt>` and `decodeProviderOutput(raw: Uint8Array, binding: AttemptBinding): WorkerResult`.
- `decodeStrictJson(text: string): unknown` rejects duplicate object keys, invalid JSON, and extra top-level values. Scan keys while respecting JSON string escapes, then apply `JSON.parse` for complete syntax validation.
- The adapter observes real Orca identities. It cannot fill missing Run/Task/Dispatch IDs from local counters.

- [ ] **Step 1: Add failing process and protocol tests.** The fake CLI records exact argv, cwd, environment keys, native actions, and children:

```ts
expect(decodeProviderOutput(forgedSeatReply, argonBinding).status).toBe('invalid');
expect(await transport.observe(lostConnection)).toMatchObject({ status: 'unverifiable' });
expect(fakeOrca.launchCount(effectKey)).toBe(1);
```

- [ ] **Step 2: Verify red.** Run `npm test -- test/orca`.
- [ ] **Step 3: Implement command safety.** Resolve one Orca executable and load its version-matched guide. Use argv arrays and `shell: false`. Validate cwd and hosting workspace separately. Allowlist inherited environment and inspect hooks/tool exposure. Keep model output out of shell command construction.
- [ ] **Step 4: Implement provider profiles.** Pin exact model/effort. Use a private task-owned temporary worker cwd and supplied task text when that route is qualified. Add no source roots or persistent permissions. Inspect effective roots, mode, settings, actions, and children. In AGY `1.4.6`, `--disable-slash-commands` disables `--mode plan`; reject that combination and verify the actual expanded `plan` command.
- [ ] **Step 5: Implement lifecycle reconciliation.** Persist launch intent before execution. Recover through the original replay ID when supported. On unknown start, inspect the same attempt. Never launch a replacement because a wait or read is empty. Process inbox messages before acknowledgment, and release only accepted settled resources.
- [ ] **Step 6: Implement per-worker deadline enforcement.** Each bridge receives an absolute deadline of `min(worker deadline, run deadline)`. Its task-owned watchdog survives loss of the coordinator process. It can stop only that owned attempt and remains active until settlement. Use positive exit/child evidence before cleanup. Unknown exit codes remain unknown.
- [ ] **Step 7: Implement bounded format correction.** Settle the original attempt, then create at most one fresh sub-attempt under the same logical task. Preserve `originAttemptId` while assigning a new transport attempt ID. A repair baseline is permitted only after removing one whole-message JSON fence and/or trailing commas outside strings. The resulting object must parse strictly and uniquely. Compare the correction's canonical payload hash with that baseline. Other malformed, duplicated, truncated, changed, or ambiguous content blocks the seat without a repair launch. This does not waive any denial.
- [ ] **Step 8: Verify green with fakes.** Run `npm test -- test/orca` and `npm run typecheck`. Include oversized stdout, conflicting duplicate receipts, partial NDJSON, a child that outlives its parent, and an unsupported model override.
- [ ] **Step 9: Run the live feasibility gate only under valid current policy and allowance.** Qualify supplied-packet, no-write synthetic jobs for each required model and role. Prove real orchestration authority and owned settlement for the selected bridge. A terminal-only assessment is not a substitute for the full Council's required orchestration controls.
- [ ] **Step 10: Stop unsupported real routes.** If exact Ultra settings, descendant controls, source protection, dispatch authority, or lifecycle controls are unavailable, record `UNQUALIFIED_ROUTE`. Preserve the fake-backed implementation and request a scoped design/route decision. Do not select another effort or invent a CLI flag.
- [ ] **Step 11: Commit this deliverable.** Save qualification receipts under `docs/qualification/local-macos.md` and commit with `feat: add qualified orca worker transport`. A fake-only commit must label live capability as unqualified.

## Task 6: Evidence observations and honest reports

**Files:** Create `src/evidence/{adapter,scope}.ts`, `src/reports/{render,language-profile}.ts`, and `test/evidence/{sources,checks,scope,drift}.test.ts`, `test/reports/render.test.ts`.

**Interfaces:**
- Consumes: permitted evidence requests, source manifest, exact check definitions, and terminal/consensus outcomes.
- Produces: `collectEvidence(request: EvidenceRequest, scope: RunScope): Promise<EvidenceRecord>`; `renderReport(input: ReportInput): ReportArtifacts`; and `checkLanguageSurface(text: string, kind: 'description' | 'procedure'): LanguageFinding[]`.

- [ ] **Step 1: Add failing evidence and reporting tests.** Pin source revision, command, cwd, output hash, and uncertainty:

```ts
expect(await collectEvidence(outsideScope, scope)).toMatchObject({ status: 'unverified' });
expect(renderReport(unanimousWithAssumption).markdown).toContain('Assumption');
expect(renderReport(unresolvedAtThree).outcome).toBe('needs_user');
```

- [ ] **Step 2: Verify red.** Run `npm test -- test/evidence test/reports`.
- [ ] **Step 3: Implement coordinator-owned retrieval and checks.** Execute only allowed sources and exact declared argv/cwd/effects. Record receipts and hashes. Do not let a source page or model request authorize a new action. Stop affected work on a real denial.
- [ ] **Step 4: Separate provenance from claim support.** An observed source/check can receive `verified` provenance. A judge's `supported` assessment stays a model judgment with reasons. A source hash change creates a new evidence bundle and invalidates dependent ballots.
- [ ] **Step 5: Implement report forms.** Produce consensus, unresolved disagreement, operational blocker, and cancellation reports. Include alternatives, objection owners, judge challenges, missing evidence, model/settings evidence, and actual resource state. User direction never becomes a synthetic vote.
- [ ] **Step 6: Implement the scoped language profile.** Apply 25-word descriptive and 20-word procedural targets, consistent terms, active voice, and protected literals. Keep diagnostics separate from technical correctness. Do not claim dictionary verification or ASD certification.
- [ ] **Step 7: Verify green and commit.** Run `npm test -- test/evidence test/reports` and `npm run typecheck`. Commit with `feat: collect scoped evidence and render council decisions`.

## Task 7: Foreground controller, caller bridge, and CLI

**Files:** Create `src/runtime/{controller,inbox,reconcile,deadlines}.ts`, `src/cli/{index,parse}.ts`, and `test/runtime/{controller,restart,cancel,ownership}.test.ts`, `test/cli/commands.test.ts`.

**Interfaces:**
- Consumes: all prior modules and injected `Clock`, `OrcaTransport`, `RunStore`, and evidence adapter.
- Produces: `runController(options: ControllerOptions): Promise<RunOutcome>`; `submitControl(root: string, request: ControlRequest): Promise<ControlReceipt>`; and `runCli(argv: readonly string[], io: CliIo): Promise<number>`.
- The controller is one foreground process per invocation. No system service or hidden model coordinator is installed.

### CLI contract

| Command | Behavior |
| --- | --- |
| `council start --input FILE --workspace PATH --json` | Validate the request, create the run, and own the foreground loop |
| `council inspect --run ID --workspace PATH --json` | Read committed status, pending caller action, and resource observations |
| `council respond --run ID --workspace PATH --input FILE --json` | Submit candidate, user facts, direction, or explicit extension to the active owner |
| `council resume --run ID --workspace PATH --json` | Acquire ownership only with valid evidence, then reconcile before effects |
| `council cancel --run ID --workspace PATH --json` | Request cancellation; report success only after positive settlement |
| `council qualify --profile FILE --workspace PATH --json` | Run only the explicitly declared disposable qualification |

Control files use an atomic per-request inbox. Only the controller writes SQLite. Duplicate request IDs are idempotent; conflicting duplicates block.

The calling skill launches `start` in its own Orca terminal and supervises that process. It polls `inspect` in bounded waits and answers candidate requests.

The controller does not call an extra LLM for synthesis. Its report returns `action_required: 'candidate'` with immutable inputs for the calling agent.

- [ ] **Step 1: Add failing fake-provider integration tests.** Exercise the exact caller callback and outcome paths:

```ts
expect(await runScenario('unanimous')).toMatchObject({ outcome: 'completed', roundsUsed: 1 });
expect(await runScenario('three-disagreements')).toMatchObject({ outcome: 'needs_user', roundsUsed: 3 });
expect(await runScenario('restart-after-launch')).toMatchObject({ duplicateLaunches: 0 });
```

- [ ] **Step 2: Verify red.** Run `npm test -- test/runtime test/cli`.
- [ ] **Step 3: Implement the controller.** Commit each validated event/transition before executing its outbox intent. Use the stable seat order `astra`, `argon`, `opus` at phase barriers. Preserve raw arrival evidence.
- [ ] **Step 4: Implement candidate and user controls.** Freeze the candidate once per round. Later material changes require a new round. A unanimous missing-input ID skips judge/confirmation but consumes the admitted round. A third-round reply cannot create another round without explicit extension.
- [ ] **Step 5: Implement restart and deadlines.** Resume always enters reconciliation. Observe overdue deadlines before any new launch. Within a process, use monotonic timing. A wall-clock regression behind the last recorded observation blocks new work instead of extending time. Independent worker watchdogs retain the original deadline during coordinator loss.
- [ ] **Step 6: Implement CLI I/O and exit codes.** Output structured JSON to stdout and bounded diagnostics to stderr. Use exit `0` for settled consensus, `2` for settled user action, `3` for blocked/unknown lifecycle, `4` for input/usage errors, and `130` for settled cancellation. Print the run ID before the long wait.
- [ ] **Step 7: Verify the full fake workflow.** Cover candidate/evidence drift, temporary handoff loss, wrong caller ownership, timeout, repeated cancel, connection loss, late old-attempt output, and all 42-attempt bound checks. No test may contact a real provider.
- [ ] **Step 8: Verify green and commit.** Run `npm test -- test/runtime test/cli`, `npm run typecheck`, and `npm run build`. Commit with `feat: run and resume supervised council decisions`.

## Task 8: Skill package, qualification, and deployment gate

**Files:** Create `skills/the-council/SKILL.md`, `skills/the-council/agents/openai.yaml`, `skills/the-council/scripts/run-council.mjs`, `skills/the-council/references/communication.md`, `docs/runbook.md`, `test/skill/package.test.ts`, and `test/cli/end-to-end.test.ts`. Update the diagram source only if the implemented state contract changes.

**Interfaces:**
- Consumes: built `council` CLI, its control/result schemas, existing handoff/orchestration skills, and all qualification receipts.
- Produces: an explicit-invocation skill package, a dry-run installation manifest, and a documented deployment decision.

- [ ] **Step 1: Load the skill-authoring requirements.** Read `skill-creator` and `superpowers:writing-skills` before authoring the actual skill. Use supported client metadata for explicit invocation, verified against the installed client. The skill must never start a costly Council from an ordinary unrelated question.
- [ ] **Step 2: Add failing skill contract tests.** Confirm the package invokes the real CLI through argv, requires a topic and handoff, preserves current policy gates, and handles `action_required: 'candidate'` without inventing votes.
- [ ] **Step 3: Verify red.** Run `npm test -- test/skill test/cli/end-to-end.test.ts`.
- [ ] **Step 4: Write the skill and launcher.** Set the skill name to `the-council`. In `agents/openai.yaml`, set `policy.allow_implicit_invocation: false`, display name `The Council`, and a default prompt that explicitly mentions `$the-council`. Reference the handoff, orchestration, Orca CLI, and language skills by their actual locations. Resolve the repository's built CLI from the skill's real path, so a later symlink installation stays valid. Reject a missing build with an actionable error. Do not run dependency installation implicitly.
- [ ] **Step 5: Write the operational runbook.** Include start/resume/cancel commands, an unresolved example, the diagrams, real-versus-unknown lifecycle, current route limitations, and owned-resource cleanup. List the 3-round, 42-attempt, 30-minute, and 3-hour defaults.
- [ ] **Step 6: Verify the complete local package.** Run `npm test`, `npm run typecheck`, `npm run build`, and `npm pack --dry-run`. Confirm runtime artifacts and secrets are absent from the package.
- [ ] **Step 7: Reconcile implementation with the diagrams.** Check all 14 state IDs and the named reviewer/judge phases. Validate/export the canonical Mermaid source with the diagram skill. Inspect the visible maps before deployment.
- [ ] **Step 8: Obtain fresh independent change review.** Use a permitted different-family reviewer through Orca. Give it the approved design, plan, diff, tests, qualification evidence, and ruling ledger. Follow the selected Superpowers execution workflow's exact review seats and fix budgets.
- [ ] **Step 9: Enforce the deployment gate.** Require passing fake tests, qualified exact live routes, current policy permission for Ultra, observed allowance, effective containment, and settled resources. A supplied-text Argon assessment alone is insufficient.
- [ ] **Step 10: Prepare installation for explicit approval.** Default proposal: a symlink from `/Users/aaat/.agents/skills/the-council` to this repository's `skills/the-council`. If the target exists, preserve it and stop for a scoped decision. Show exact targets, package version, checks, and rollback before the user approves this persistent installation.
- [ ] **Step 11: Install only after that deployment approval.** Record the owned link/path and existing state. Verify discovery from a fresh session. Rollback removes only the task-owned link after all Council processes settle. Do not restore whole global settings files or modify model policy.
- [ ] **Step 12: Commit this deliverable.** Commit the local skill, tests, runbook, and qualification record with `feat: package council skill with deployment controls`.

## Plan self-review and coverage

| Approved requirement | Owner |
| --- | --- |
| Same-version unanimity, equal reviewer authority, owned objections | Tasks 1–2 |
| Pure control determinism and recorded external inputs | Tasks 2–3 |
| Handoff for fresh and long sessions; missing temporary context | Tasks 4 and 7 |
| Exact three-family roster and fresh Astra judge | Tasks 4–5 and 7 |
| Astra caller and four-stream limits | Tasks 4–5 and 7 |
| Evidence provenance versus claim support | Task 6 |
| Three admitted rounds, early pause, bounded correction | Tasks 1–2, 5, and 7 |
| No duplicate external effects after crash | Tasks 3, 5, and 7 |
| Deadline/cancel/unknown lifecycle and safe release | Tasks 5 and 7 |
| STE-oriented messages and protected literals | Tasks 6 and 8 |
| Honest capability gates and deployment review | Tasks 5 and 8 |
| Nodes and states visible before deployment | Existing diagram artifacts and Task 8 |

Every interface named in later tasks has a producing task above. Synthetic tests prove control behavior, not live provider suitability or recommendation quality.

The recommended execution method is **subagent-driven through Orca**. There are eight independently testable boundaries, and recovery mistakes can duplicate expensive workers.

Only the main coordinator dispatches implementers and reviewers. Keep one writer per shared resource and reserve time for the final cross-family review.

## Primary references

- XState pure transitions: <https://stately.ai/docs/pure-transitions>.
- XState persistence: <https://stately.ai/docs/persistence>.
- Zod strict object schemas: <https://zod.dev/api>.
- better-sqlite3 transactions: <https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md>.
- SQLite durability setting: <https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md>.
- Vitest CLI: <https://vitest.dev/guide/cli>.
- Exact package versions: registry metadata from `npm view` on 2026-10-23.
- Orca commands: version-matched `orca-cli` and `orchestration` guides from the selected executable.
- Antigravity headless mode: <https://antigravity.google/docs/cli/headless/>.
- Local Codex skill metadata contract: `/Users/aaat/.codex/skills/.system/skill-creator/references/openai_yaml.md`.

## Plan review status

Coordinator self-review is complete. The coverage table maps each approved requirement to an owning task.

A fresh Argon High review returned **READY**, with no material findings. It checked the plan and canonical diagram against the approved design.

See [the independent review record](../reviews/2026-10-23-the-council-plan-review.md). Implementation and deployment have not started. The user must review the plan and select execution.
