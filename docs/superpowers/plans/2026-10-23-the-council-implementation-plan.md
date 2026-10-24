# The Council Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an explicitly invoked skill that obtains three equal model-family assessments and a fresh judge report, then returns unanimous advice or unresolved questions.

**Architecture:** A thin skill keeps the calling agent in charge of candidate synthesis. The runner freezes the reviewer and judge roster from `council.yaml` for each run. A pure XState reducer emits effect intents, which a local controller persists in SQLite and executes through qualified Orca and evidence adapters.

**Tech Stack:** Node.js `22.23.4`, TypeScript `7.0.2`, XState `5.33.3`, Zod `4.6.7`, YAML `2.9.1`, better-sqlite3 `13.0.3`, Vitest `5.0.5`.

**Spec:** [Approved design](../specs/2026-10-23-the-council-design.md). The base design was approved on 2026-10-23. The user authorized the YAML amendment, hybrid methods, active-work budget, and two shared clarification batches on 2026-10-24. This revision incorporates those decisions and the source-checked independent findings recorded below.

## Global Constraints

- Reviewer seats are `openai`, `gemini`, and `claude`, selected through `council.yaml`. Defaults: `gpt-6-astra` / `ultra`, `gemini-4-argon-high` / `high`, and `claude-opus-5-5-high` / `high`.
- The judge is configured separately. Its default is `gpt-6-astra` / `ultra` through Codex. Every judge session is fresh and has no acceptance vote.
- Require exactly one reviewer per named family. Codex routes OpenAI entries; Antigravity routes Gemini and Claude entries. All entries go through Orca.
- Freeze the complete validated configuration and its hash before any effect. Resume uses that snapshot; original-file edits affect new runs only.
- YAML selects models, routes, and efforts only. It cannot weaken consensus, phase settlement, policy, permission, or attempt-limit controls.
- Consensus binds the same immutable candidate, evidence, judge report, configuration, skill profile, and shared context in all three acceptances.
- Default: two clarification batches, then up to three deliberation rounds. Separate counters reserve admission with the first launch intent, including an uncertain external start.
- Maximum worker calls: `3 * maxClarificationBatches + 7 * maxRounds`, or `27`. No model-based format correction or uncounted readiness task.
- Worker timeout: `1_800_000` ms continuously. Run budget: `10_800_000` ms of active work across invocations; the earlier active deadline wins.
- Human wait pauses the budget only after positive settlement of every owned resource. Resume preserves counters and remaining time; active crash downtime remains chargeable.
- All question and answer records go into one append-only shared context. Partial human replies cannot start workers. No judge runs during clarification.
- Every reviewer gets the same frozen admitted skill catalogue. Each independently selects methods; interactive methods emit structured questions instead of private interviews.
- Maximum four visible active workstreams including the caller. One active Astra by default, counting the caller.
- Reviewer tasks settle before the judge starts. The judge settles before confirmation tasks start.
- A caller conflict blocks unless an existing explicit bounded authorization covers the extra Astra slot and assignment. Record and reuse valid authorization; do not ask again for each worker. Version one performs no automatic ownership handoff.
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

1. Partial, duplicate, stale, or dependent answers must not launch workers or diverge seat context. Tests belong to Tasks 1–2 and 7.
2. Active-process crash versus settled human wait must charge different time without increasing the saved budget. Tests belong to Tasks 2–3 and 7.
3. A crash between launch and receipt must never duplicate workers or grant free batch, round, or call reservations. Tests belong to Tasks 2–3 and 5.
4. Candidate synthesis before evidence completion, new ballot objections, and changed context/profile hashes must prevent false consensus. Tests belong to Tasks 1–2 and 6–7.
5. Changed owner, policy, configuration, denied access, or unknown lifecycle must block unproven work; saved YAML remains frozen. Tests belong to Tasks 4–5 and 7.

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
| Runtime | `yaml` | `2.9.1` |
| Runtime | `better-sqlite3` | `13.0.3` |
| Development | `typescript` | `7.0.2` |
| Development | `vitest` | `5.0.5` |
| Development | `@types/node` | `22.20.5` |
| Development | `@types/better-sqlite3` | `9.6.0` |

Original registry metadata was checked on 2026-10-23. YAML `2.9.1` and its Node requirement were checked on 2026-10-24. These packages were not installed during planning.

Use ESM, `module: NodeNext`, `target: ES2022`, `strict`, `exactOptionalPropertyTypes`, and `noUncheckedIndexedAccess`.

Use local package scripts: `test = vitest run`, `typecheck = tsc --noEmit -p tsconfig.json`, and `build = tsc -p tsconfig.build.json`.

The package binary is `council`, targeting `dist/cli/index.js`. Use `.js` import suffixes in TypeScript source.

## File map

| Area | Files | Responsibility |
| --- | --- | --- |
| Domain | `src/domain/contracts.ts`, `schemas.ts`, `hash.ts`, `consensus.ts`, `objections.ts`, `budget.ts` | Strict protocol types, hashes, assent, and owned objection changes |
| Machine | `src/machine/council-machine.ts`, `reduce.ts` | Pure transitions and deterministic effect intents |
| Persistence | `src/store/run-store.ts`, `schema.sql`, `artifacts.ts` | Single-writer journal, checkpoints, outbox, and immutable blobs |
| Model configuration | `council.yaml`, `src/config/{schema,load}.ts` | Shipped defaults, bounded YAML parsing, canonical resolved roster |
| Input and policy | `src/input/{handoff,profiles,questions}.ts`, `src/policy/{preflight,qualification}.ts` | Temporary packet, frozen method manifest, common question batches, launch gates |
| Orca | `src/orca/client.ts`, `transport.ts`, `observations.ts` | Version-matched commands, real identities, and lifecycle interpretation |
| Provider bridge | `src/workers/bridge.ts`, `protocol.ts`, `watchdog.ts` | Bounded source-only worker execution and inspected provider results |
| Evidence | `src/evidence/adapter.ts`, `scope.ts` | Permitted retrieval and exact declared checks |
| Runtime | `src/runtime/{controller,inbox,reconcile,deadlines,clocks}.ts` | Foreground coordination, durable controls, active-time accounting, and recovery |
| Reports | `src/reports/render.ts`, `language-profile.ts` | Consensus, disagreement, blockers, and STE-oriented diagnostics |
| CLI | `src/cli/index.ts`, `parse.ts` | Start, inspect, respond, resume, cancel, and qualification commands |
| Skill | `skills/the-council/SKILL.md`, `agents/openai.yaml`, `scripts/run-council.mjs`, `references/communication.md` | Explicit invocation, caller loop, and portable communication contract |
| Tests | `test/config/`, `domain/`, `machine/`, `store/`, `policy/`, `orca/`, `evidence/`, `runtime/`, `cli/`, `skill/` | Focused unit, crash, and fake-provider integration tests |
| Fixtures | `test/fixtures/builders.ts`, `fake-orca.mjs`, `fake-provider.mjs` | Deterministic test data and real subprocess fixtures without real models |
| Operations | `docs/qualification/local-macos.md`, `docs/runbook.md` | Qualification receipts, safe recovery, installation, and rollback |

## Shared contracts

Define these names in `src/domain/contracts.ts`. Later tasks import them rather than defining competing variants.

- `ReviewerSeat = 'openai' | 'gemini' | 'claude'`; `WorkerRole = ReviewerSeat | 'judge'`. Model changes never rename seats or objection owners.
- `ProviderRoute = 'codex' | 'antigravity'`; `ModelSelection = { route: ProviderRoute; model: string; effort: string }`.
- `CouncilConfig = { version: 1; reviewers: Record<ReviewerSeat, ModelSelection>; judge: ModelSelection }`. Model and effort strings must be nonempty exact values. Current policy and catalog checks establish admission separately.
- `ConfigSnapshot`: `sourcePath`, `rawSha256`, `rawArtifact: ArtifactRef`, `configArtifact: ArtifactRef`, `configHash`, and `resolved: CouncilConfig`.
- `JsonValue` is JSON null, boolean, finite number, string, array, or an object with string keys and JSON values.
- `ArtifactRef`: artifact kind, SHA-256, canonical local path, and byte count.
- `RunScope`: canonical permitted source roots, allowed source addresses, and `CheckSpec[]`. A `CheckSpec` fixes its ID, argv, cwd, declared effects, and output targets.
- `ControlState` is the exact 17-state union from the design and canonical diagram, including `clarifying`, `collecting_questions`, and `publishing_answers`.
- `ProfileSnapshot`: immutable manifest artifact, `profileHash`, admitted method IDs, canonical source/bundle revisions and hashes, and each adaptation's retained/replaced/excluded requirements. No automatic installation or discovery at runtime.
- `QuestionLedger`: immutable ordered question/answer histories and a derived latest-answer/deferred-question view.
- `SharedContext`: `contextRevision`, `contextHash`, topic/handoff reference, ordered question/answer ledger references, and `userDirections: readonly ArtifactRef[]` containing published user facts/priorities/assumptions. All published historical records remain accessible in each packet.
- `RawQuestion`: content-only local `id`, text, reason, blocking flag, answer-form descriptor, and `dependencies: RawQuestionRef[]`. `RawQuestionRef` is `{ kind: 'local'; id: string }` for the same seat/wave or `{ kind: 'ledger'; id: string }` for a prior published question. Raw local IDs match `[A-Za-z0-9_-]{1,80}`. Unknown provenance/owner/disposition fields are forbidden.
- `RawObjection`: local ID, claim/evidence/resolution content, and `status: 'open'`; no owner or authoritative binding fields. Existing-objection dispositions use fully qualified frozen input IDs.
- `BoundQuestion`: raw content with its local id/dependencies replaced by `id: string`, `dependencyIds: readonly string[]`, and adapter-derived origin, without a presentation disposition. `Question` adds the compiler-derived disposition below.
- `Question`: namespaced ID, exact text, reason, `blocking`, `disposition: presented | deferred`, answer-form descriptor, dependency IDs, and adapter-derived seat/attempt origin. Deferred items remain in the common ledger and block admission when material. `QuestionBatch` fixes ID, `origin: clarification(batchIndex) | deliberation(round)`, base context hash, original questions, recorded grouping/aliases, source answers, and presented question IDs.
- `Answer`: unique answer ID, question ID, optional superseded-answer ID, `status: 'answered' | 'unknown' | 'declined'`, JSON value or null, author/source receipt, and evidence references. `AnswerBatch` fixes request ID, batch ID, matching origin, base context hash, ordered answers, and `finalized: boolean`.
- `RunRequest`: `runId`, `workspace`, `topic`, `handoffPath`, `handoffHash`, `config: ConfigSnapshot`, `profile: ProfileSnapshot`, `sharedContext: SharedContext`, `scope`, `maxClarificationBatches: 2`, `maxRounds: 3`, `workerTimeoutMs: 1_800_000`, `activeBudgetMs: 10_800_000` by default. Limits are validated positive integers, not literal-only types. Input cannot override CLI-selected models.
- `AnswerRevision`: request/run IDs, the current `baseContextHash`, known unresolved question IDs and new answer records with `supersededAnswerId: string | null`. A replacement requires the current predecessor ID; a first answer to an unanswered deferred item requires null. Dependencies must have answered values in the prior published ledger, not in another answer in the same revision. It is a distinct control body, not a resubmitted `AnswerBatch`.
- `ContextUpdate`: request/run IDs, current base context hash, and provenance-linked user facts/priorities/assumptions. Apply only in preflight or prepare_round at a positively settled boundary with no open question batch, before launch intents; an active-wave update stays queued until settlement and invalidates the interrupted round. It publishes one context for all seats before the next admitted round. It does not use publishing_answers; stale queued updates after another publication are rejected for explicit resubmission.
- `BoundedExtension`: ID, base revision, user authorization receipt, expiry, and nonnegative additions to clarification batches, rounds, and active-budget ms; at least one addition is positive. It cannot change the roster/profile or clear an inference block. `EffectiveLimits` derives from the immutable request plus the extension ledger; call capacity is `3 * effective.maxClarificationBatches + 7 * effective.maxRounds`. Added work time increases total/remaining allowance only by the authorized delta.
- `WorkerPhase = 'clarify' | 'review' | 'judge' | 'ballot'`.
- `RoundBindings`: `runId`, `configHash`, `profileHash`, `contextHash`, `round`, `candidateHash`, `evidenceHash`, `judgeHash`.
- `PhaseBindings`: run/config/profile/context hashes, `round`, `clarificationBatch: number | null`, input hash, logical task key, and `originAttemptId`. Clarification uses round `0` and a positive batch index; deliberation uses a positive round and null batch. Initial review has no candidate binding.
- Judge bindings add candidate and evidence hashes. Ballot bindings also add the judge report hash.
- `LaunchReservation`: logical task/effect keys, a stable clientAttemptKey, requested role/phase/model controls and input hashes, with no invented transport IDs or authority. Launch intents/WorkerSpec carry this before a receipt exists. The logical-task registry stores `binding: AttemptBinding | null` until the real receipt is accepted.
- `AttemptBinding`: logical task key, actual transport attempt ID, `originAttemptId`, role, phase, full `PhaseBindings`, exact requested route/model/effort, and adapter-issued authority. One inference per logical task; a supported replay reconnects the same attempt and does not create a repair inference.
- `WorkerPayload` is the strict raw tagged union, discriminated by `kind`, `clarification`, `review`, `judge`, or `ballot`. Clarification contains readiness or `RawQuestion[]` and chosen method IDs. Review contains proposals, `RawObjection[]`, evidence requests, and `missingInputQuestions: RawQuestion[]`. Judge contains evidence assessments/challenges. The raw ballot contains reported assent/input hashes, `RawObjection[]` and `RawQuestion[]`; it is distinct from the bound Ballot below. Every method ID must exist in the frozen profile.
- `BoundWorkerPayload` has the same phase tags/content as WorkerPayload, with bound questions/objections and actual launch bindings. Reported assent/input hashes must match the supplied packet before binding; the binder never silently replaces a mismatched vote target.
- `WorkerResult` is `{ status: 'valid'; payload: BoundWorkerPayload; binding: AttemptBinding }`, or `{ status: 'invalid'; code: string }`. Model output cannot supply adapter provenance.
- `Ballot`: bindings, seat, `decision: 'accept' | 'reject' | 'abstain'`, `conditional`, `newObjections: Objection[]`, `missingInputQuestions: Question[]`, owned objection dispositions, challenge responses, and reason. Add new objections before evaluating closure/consensus; conflicting IDs fail.
- `FrozenCandidate`: text artifact reference, hash, stated assumptions, tradeoffs, unresolved uncertainty, and `acknowledgedUnverifiedEvidenceIds: string[]`. Coordinator freezes `requiredEvidenceIds` as every reviewer-requested ID plus coordinator-required IDs before candidate submission; the pure freeze guard requires coverage of all unverified/invalid IDs in that set, not semantic prose evaluation. No acknowledgment waives a denial.
- `Objection`: ID, owner reviewer seat, claim ID, open/closed status, and an append-only disposition history.
- `EvidenceRecord`: request ID, `status: 'verified' | 'invalid' | 'unverified' | 'not_applicable'`, source location, content hash, and observation receipt.
- `ClaimAssessment`: `supported`, `contradicted`, or `unresolved`, with evidence IDs and reasons. This is separate from evidence provenance.
- `ConfirmationContext`: expected bindings and attempt map, candidate, three ballots, objection ledger, frozen `inputObjectionIds: readonly string[]`, `questionLedger: QuestionLedger` bound to the expected context hash, and judge challenge IDs.
- `ConsensusDecision`: `{ kind: 'unanimous' }` or `{ kind: 'unresolved'; reasons: string[] }`.
- `RunSnapshot`: machine version, schema version, revision, control state, and `RunContext`.
- `RunContext`: frozen request/config/profile/shared context, `clarificationBatchesUsed`, `roundsUsed`, `callsReserved`, immutable current-phase result references, `extensions: readonly BoundedExtension[]`, `effectiveLimits: EffectiveLimits`, `issuedLogicalTasks` keyed by logical task with attempt/provenance, `stage: pending_execution | dispatched | receipt_recorded`, and separate observed settlement status, `requiredEvidenceIds: readonly string[]`, question/answer ledgers, `inferenceBlock: string | null`, pending evidence IDs, expected attempts, objections/ballots, pending outcome, `pauseReason`, `resumeTarget`, `reconcileOriginState: ControlState | null`, `pendingContextUpdate: ContextUpdate | null`, current resume/preflight attestation reference, `publicationKind: answer_batch | answer_revision | null`, deadlines, and `ActiveBudget`.
- `ActiveBudget`: total/remaining ms, active or paused status, current interval epoch, start/last clock receipt references, and accrued charge. A closed human-wait interval cannot be reopened or charged again. `ClockReceipt` records wall and monotonic values plus process epoch; only same-epoch monotonic values are comparable.
- `EffectIntent`: stable key plus a discriminated kind: launch, observe, stop, release, evidence, question-batch request, candidate request, publish-context, evaluate-round, report, or deadline. Source retrieval/grouping decisions are recorded inputs, never hidden reducer work.
- `TransitionResult`: `{ snapshot: RunSnapshot; intents: EffectIntent[] }`.
- `Authority`: a real supervised Orca Run/Task/Dispatch binding, or a clearly labelled terminal-only binding. They are never interchangeable.
- `WorkerObservation`: `live`, `unverifiable`, or `exited`, with raw receipt references and the exposed exit code, including `null`.
- `ValidatedEvent` is the strict event envelope with event/run IDs, schema version, actor origin, round/phase, a trusted adapter-issued `clockReceipt: ClockReceipt`, and a typed body. Raw provider/user timestamps cannot supply the trusted receipt. The trusted input adapter supplies actor origin.
- `Clock` provides `wallNow(): number` and `monotonicNow(): number`. Neither method is available inside the reducer.
- `RunOutcome`: decision outcome, control state, operational settlement status, report references, and remaining blockers.

Boundary-specific types are exported by their producing module: loaded configuration by Task 4's configuration loader; handoff input/reference by Task 4's handoff module; preflight and qualification inputs/decisions by Task 4's policy modules; store receipts by Task 3; transport specifications/receipts by Task 5; report input/artifacts by Task 6; and controller options, control requests/receipts, and CLI I/O by Task 7. Each type contains the inputs or receipts named in its task contract. Later tasks must import these types.

All public decoders use strict Zod objects. Unknown fields, duplicate reviewer seats, unsafe paths, and invalid hashes fail explicitly.

Canonical JSON sorts object keys and preserves array order and exact strings. Reject non-JSON values and non-finite numbers. Do not normalize protected text.

Use SHA-256 with an artifact-kind and schema-version prefix. Freeze all inputs before hashing. Runtime IDs and clock observations enter as recorded input.

Default input limit is 8 MiB. Default final worker-result limit is 1 MiB. An oversized result fails explicitly without truncation into a valid vote.

## Task 1: Strict protocol and unanimous acceptance

**Files:** Create package files, TypeScript/Vitest configuration, `.gitignore`, `src/domain/*`, `test/fixtures/builders.ts`, and `test/domain/{schemas,hash,questions,consensus,objections,budget}.test.ts`.

**Interfaces:**
- Consumes: approved requirements, stable family seats, and the frozen configuration contract.
- Produces: shared contracts, `parseWorkerPayload(raw: unknown): WorkerPayload`, `bindWorkerPayload(payload: WorkerPayload, binding: AttemptBinding): BoundWorkerPayload`, `namespaceItem(kind: 'question' | 'objection', binding: AttemptBinding, localId: string): string`, `hashArtifact(kind: string, value: JsonValue): string`, `applyOwnedDispositions(context: ConfirmationContext): readonly Objection[]`, and `evaluateConsensus(context: ConfirmationContext): ConsensusDecision`; and pure `accountBudget(budget: ActiveBudget, observation: ClockReceipt, event: BudgetEvent): BudgetDecision` in `src/domain/budget.ts`. `BudgetEvent` is active-checkpoint, settled-human-pause, terminal-settlement, resume-active, crash-reconcile, or authorized-extension. `BudgetDecision` returns updated budget/deadline or a clock blocker. It reads no clock directly.
- Test builders: `makeConfirmation(overrides?: Partial<ConfirmationContext>): ConfirmationContext` and `makeBallot(seat: ReviewerSeat, overrides?: Partial<Ballot>): Ballot`.

- [ ] **Step 1: Create the package configuration.** Use the exact pins and compiler settings above. Ignore `node_modules/`, `dist/`, coverage output, and `.council/`.
- [ ] **Step 2: Install project-local dependencies and create the lockfile.** Run `npm install`. Do not update global Node, npm, or agent settings.
- [ ] **Step 3: Add failing protocol and budget tests.** Include these assertions and separate cases for duplicate seats, stale attempt IDs, changed hashes, conditional assent, missing challenge responses, another seat's objection closure, context/profile drift, an accepting ballot with an earlier unresolved/deferred blocking ledger question, and an accepting ballot that opens a new objection, declares it already closed, or closes that same new ID in its dispositions:

```ts
expect(evaluateConsensus(makeConfirmation())).toEqual({ kind: 'unanimous' });
expect(evaluateConsensus(makeConfirmation({
  ballots: [makeBallot('openai'), makeBallot('gemini'), makeBallot('claude', { decision: 'reject' })],
})).kind).toBe('unresolved');
```

- [ ] **Step 4: Verify red.** Run `npm test -- test/domain`. Expected: missing domain exports or failed invariant assertions, not a broken test runner.
- [ ] **Step 5: Implement the domain exports.** Decode raw wire content first; then bind actual seat/attempt provenance. Require the phase/kind mapping clarify→clarification, review→review, judge→judge, ballot→ballot, and the matching actual reviewer/judge role. A kind mismatch is invalid. Bind only after a real receipt establishes authority; retain pre-receipt data as unbound evidence. Namespace as `<runId>/<phase>/<cN-or-rN>/<seat>/<question-or-objection>/<localId>`, rewriting local dependency refs under the same prefix; prior-ledger refs retain their full ID for ledger validation. Derive seat identity from adapter bindings, never model-authored role claims. Test two seats using q1, valid wire output without origin/disposition, forged provenance fields, and first deferred answers with null predecessor. Require matching configuration/profile/context hashes and the configured mapping. Require every new review/ballot objection to start open; register owned objections and reject conflicting IDs. Dispositions can reference only frozen `inputObjectionIds`, never same-ballot new IDs. Any nonempty ballot `newObjections` prevents consensus, regardless of disposition/accept fields. Then apply valid owner dispositions and evaluate consensus. Any unresolved presented/deferred blocking question in the complete bound question ledger prevents consensus, including one omitted from current ballots. No other seat or judge can close them. Validate question dependency graphs for missing IDs/cycles; preserve exact original questions and append-only answer history.
- [ ] **Step 6: Verify green.** Run `npm test -- test/domain`, then `npm run typecheck`. All tests must pass.
- [ ] **Step 7: Commit this deliverable.** Commit package/config files, `src/domain`, and the domain fixtures/tests with `feat: add strict council protocol and consensus rules`.

## Task 2: Pure XState control machine

**Files:** Create `src/machine/{council-machine,reduce}.ts` and `test/machine/{clarification,rounds,guards,replay}.test.ts`.

**Interfaces:**
- Consumes: Task 1 contracts and acceptance functions.
- Produces: `createInitialSnapshot(request: RunRequest): RunSnapshot`, `reduceRun(snapshot: RunSnapshot, event: ValidatedEvent): TransitionResult`, and `restoreForReconciliation(snapshot: RunSnapshot): RunSnapshot`.
- Machine version and schema version both start at `1`. Incompatible snapshots are never silently upgraded. restoreForReconciliation captures the prior state in reconcileOriginState; if already reconciling, preserve its non-null original value. Missing origin is a blocker. Every reducer transition into reconciling from another state also captures its prior state; a reconciling self-loop preserves origin. Clear origin on reconciliation exit. Preserve resumeTarget through intermediate preflight/publication; clear it only on committed entry into that exact target. Record prepare_round for question/clarification/round-limit pauses and publishing_answers for collection awaiting answers. Every other settled pause captures its legal interrupted target; an initial preflight context/route pause defaults to clarifying, while a terminal inference block permits inspection only. Test an initial missing-handoff pause/resume and a mid-round context remedy.

- [ ] **Step 1: Add failing state tests.** Cover every state and edge in the canonical file's `states` diagram. The component and recovery flowcharts are explanatory views, not additional machine states. Include these exact outcomes:

```ts
expect(reduceRun(roundThreeWithOneReject, ballotsReady).snapshot.state).toBe('evaluate_round');
expect(reduceRun(roundThreeEvaluation, evaluateRound).snapshot.state).toBe('settling');
expect(reduceRun(roundThreeEvaluation, evaluateRound).snapshot.context.pendingOutcome).toBe('needs_user');
expect(reduceRun(unanimousEvaluation, evaluateRound).snapshot.context.pendingOutcome).toBe('completed');
```

- [ ] **Step 2: Verify red.** Run `npm test -- test/machine`.
- [ ] **Step 3: Implement pure transitions.** Use XState `initialTransition` and `transition`. Use `machine.resolveState` to reconstruct the pinned state/context. Do not start provider actors in the machine. All 17 states are stable, including evaluate_round and prepare_round. The confirming barrier emits an evaluate-round intent; a recorded EVALUATE_ROUND event performs outcome guards. Explicit ADMIT_ROUND drives prepare_round. Persist these events and checkpoints normally; no hidden synthetic or eventless transition is required. Emit launch intents only on explicit admission or phase-advance events, never on state entry alone. A reconciliation re-entry must observe the existing attempt.
- [ ] **Step 4: Implement deterministic intents.** Keys contain run, batch or round, phase, role, and logical assignment. Reserve the batch/round once, and each call slot atomically with its first launch intent. Unknown start retains reservations. Read no clock, filesystem, network, or random source in guards or reducers. `reduceRun` applies Task 1 `accountBudget` using each accepted event receipt and includes the new budget in its returned checkpoint. Task 7 may sample clocks but cannot mutate budget outside reduction. Replay tests compare budgets, deadlines, effective extensions, and issued-task ledgers too.
- [ ] **Step 5: Add clarification guards.** Assert two waves use six calls and zero deliberation rounds; an all-ready wave can skip remaining clarification. If wave one contains questions, publish answers then admit wave two when permitted. After wave two, complete finalized answers with no unresolved blocking question permit deliberation directly; no third readiness task. A blocking unknown/declined answer reaches settled `needs_user` with `CLARIFICATION_LIMIT` at the allowance. Partial answers launch nothing. Every clarification result publication, including all-ready/source-only cases, uses answer_batch; zero questions produce a controller-finalized empty batch in phase history without changing contextRevision/contextHash when no ledger content changed. Test an extended max of three, all-ready wave two, and an earlier unresolved blocker: settled needs_user, no wave three. Test a batch-two deferred blocking follow-up and a batch-two all-ready reply with an earlier unresolved item; both remain blocked from deliberation.
- [ ] **Step 6: Add round and recovery guards.** Every nonempty review or ballot `missingInputQuestions` array diverts the consumed round, including nonblocking/source-answerable cases; test both. Round-origin collection also promotes prior deferred questions. A single blocking item can require a human pause; an accept ballot with an unresolved blocking question cannot produce consensus. Late answers require a next round, never a free return to clarification. A fourth round needs a bounded extension. Use the spec's explicit preflight routing priority: eligible answer publication, staged question collection, open unfinalized batch wait, then a legal target. Add cases for a limit-state AnswerRevision, round-three answers/staged questions, and a budget-only extension with an open nonblocking batch. Normal clarification/round/saved-phase returns exclude preceding routes and open unfinalized batches. A legal saved mid-round third-round remedy is not a fourth-round admission. Every entry to prepare_round and ADMIT_ROUND rechecks the full ledger, effective remaining rounds, budget, inference block and admission attestation. An active-budget-only extension cannot bypass questions or add a round. With an authorized maxClarificationBatches of three, a nonempty second wave can admit a third wave; no hardcoded wave-one guard. Candidate request cannot occur while any evidence request is pending. For every active state test cancellation/error/deadline to settling; restore enters reconciliation, a settled resume with prior-controller exit and a saved target reaches preflight, reconciliation of live attempts or exited attempts with valid saved results returns to the recorded phase without inference, then ingests saved results; only failed/invalid/timed-out/cancelled work or a saved settling phase routes to settling, and unverifiable state cannot settle.
- [ ] **Step 7: Verify replay and ordering.** Replay the same event history and frozen configuration twice and compare all snapshots/intents. Deliver the three reviewer results in all six arrival orders and compare the completed phase output. Run the same control scenarios with qualified Sol/Sonnet fake selections; seat IDs, objections, limits, and outcomes must stay unchanged.
- [ ] **Step 8: Verify green and commit.** Run `npm test -- test/machine` and `npm run typecheck`. Commit with `feat: model deterministic council control states`.

## Task 3: Transactional journal, artifacts, and effect outbox

**Files:** Create `src/store/{run-store,artifacts}.ts`, `src/store/schema.sql`, and `test/store/{transactions,writer,crash-window,artifacts}.test.ts`.

**Interfaces:**
- Consumes: `RunSnapshot`, `ValidatedEvent`, `EffectIntent`, and canonical hashes.
- Produces: `openRunStore(root: string): RunStore`; `RunStore.load(runId): RunSnapshot`; `RunStore.commitTransition(runId, expectedRevision, event, result): CommitReceipt`; `RunStore.pendingEffects(runId): EffectIntent[]`; `RunStore.recordEffectReceipt(key, receipt): void`; `openRunReader(root: string): RunReader` with read-only `load(runId): RunSnapshot`; and `putArtifact(bytes: Uint8Array): ArtifactRef`.

- [ ] **Step 1: Add failing transaction tests.** Use a temporary database and an injected failure after each journal/checkpoint/outbox write:

```ts
expect(() => store.commitTransition(runId, 4, event, transition)).toThrow('REVISION_CONFLICT');
expect(reopened.pendingEffects(runId).map(x => x.key)).toEqual([intent.key]);
expect(reopened.load(runId).revision).toBe(1);
```

- [ ] **Step 2: Verify red.** Run `npm test -- test/store`.
- [ ] **Step 3: Implement schema and transaction boundaries.** Use WAL, `synchronous = FULL`, foreign keys, and a 5,000 ms busy timeout. Use an immediate transaction for event, checkpoint, and outbox writes. Accepted LAUNCH_DISPATCHED and LAUNCH_RECEIPT_RECORDED events update both checkpoint task stage and the matching outbox fence/receipt atomically. recordEffectReceipt may only mirror already accepted receipt data; it cannot authorize launch or change snapshot issuance outside reduction. Keep all external I/O outside the transaction.
- [ ] **Step 4: Enforce one active writer.** Record owner identity and generation. Require expected revision on each mutation. Read-only clients use openRunReader without taking this lease; they may observe a consistent committed snapshot while the writer is active. A timeout alone cannot steal an owner's lease. A new owner requires release or positive process-exit evidence.
- [ ] **Step 5: Implement immutable artifacts.** Write task-owned temporary bytes, hash them, then atomically rename into the run's content store before referencing them. Include the raw YAML and canonical configuration. Verify both hashes before recovery and reject missing/corrupt configuration artifacts. Existing hash conflicts are fatal. Orphaned blobs receive no automatic destructive cleanup.
- [ ] **Step 6: Verify crash windows.** Kill the test child before external launch, after a fake launch, and before receipt commit. Confirm the intent remains reconcilable and no new launch is authorized by missing data alone.
- [ ] **Step 7: Verify green and commit.** Run `npm test -- test/store` and `npm run typecheck`. Commit with `feat: persist council journal and effect outbox`.

## Task 4: YAML roster, handoff, scope, and policy preflight

**Files:** Create `council.yaml`, `src/config/{schema,load}.ts`, `src/input/{handoff,profiles,questions}.ts`, `src/policy/{preflight,qualification}.ts`, `test/config/{load,defaults,snapshot}.test.ts`, and `test/policy/{handoff,profiles,questions,models,ownership,scope}.test.ts`.

**Interfaces:**
- Consumes: selected YAML path and bytes, package root, invocation cwd, source manifest, caller identity, current policy/catalog evidence, exposed allowance, and qualification receipts.
- Produces: `resolveConfigPath(override: string | undefined, invocationCwd: string, packageRoot: string): string`; `parseCouncilConfig(raw: Uint8Array): CouncilConfig`; and `loadCouncilConfig(path: string): Promise<LoadedCouncilConfig>`.
- `LoadedCouncilConfig` contains canonical `sourcePath`, `sourceBytes: Uint8Array`, `rawSha256`, `resolved: CouncilConfig`, and `configHash`. Task 7 stores those bytes and canonical JSON to construct `ConfigSnapshot` before machine creation.
- Produces: `writeHandoff(input: HandoffInput, tempRoot: string): HandoffRef`; `validateScope(scope: RunScope): ScopeDecision`; and `runPreflight(input: PreflightInput): PreflightDecision`.
- Produces: `freezeProfile(input: ProfileInput): ProfileSnapshot`; `buildQuestionBatch(prior: QuestionLedger, origin: QuestionOrigin, results: readonly WorkerResult[], grouping: GroupingProposal, sourceAnswers: readonly Answer[]): QuestionBatch`; and `validateAnswerBatch(batch: QuestionBatch, answers: AnswerBatch): AnswerDecision`; and `validateAnswerRevision(context: SharedContext, ledger: QuestionLedger, request: AnswerRevision): AnswerDecision`. `QuestionOrigin` is the clarification/batch or deliberation/round union above.
- `GroupingProposal` is a coordinator-supplied, recorded mapping, not semantic inference in a pure function. Compilation derives presented/deferred disposition from bound questions and ledger dependencies; no raw worker supplies it. Every original ID is retained; aliases cannot remove blocking flags or answer requirements. A finalized batch needs one explicit answer per presented original ID; grouped presentation alone cannot copy an answer. A user response naming several IDs produces separate provenance-linked answers for those IDs. `AnswerDecision` distinguishes draft, ready-for-publication, unresolved-blocking, and invalid with exact IDs/reasons. Dependency IDs can reference the prior ledger or current wave, must exist and be acyclic. Same-wave dependent questions are retained as deferred and not presented until a later wave. Merge the prior ledger; promote eligible earlier deferred questions even when a seat returns readiness. Each dependency needs a valid latest finalized answer with status `answered`. A deferred blocking item at batch two remains unresolved with `CLARIFICATION_LIMIT`; it is never discarded.
- `PreflightDecision` is `ready`, `needs_context`, or `blocked`, with stable reason codes and supporting receipt references.

- [ ] **Step 1: Add failing configuration and preflight tests.** Use injected OS paths, supplied catalog facts, and current-policy hashes. Define fixtures for the default configuration, an alternate Sol Max/Sonnet High roster, and a Sonnet judge:

```ts
expect(runPreflight(astraCallerWithoutExtraSlot).reason).toBe('ASTRA_CALLER_CONFLICT');
expect(runPreflight(unknownCaller).reason).toBe('CALLER_MODEL_UNKNOWN');
expect(runPreflight(unqualifiedUltra).reason).toBe('UNQUALIFIED_ROUTE');
expect(parseCouncilConfig(defaultYaml).reviewers.openai.model).toBe('gpt-6-astra');
expect(parseCouncilConfig(defaultYaml).judge.effort).toBe('ultra');
expect(parseCouncilConfig(solSonnetYaml).reviewers.claude.model).toBe('claude-sonnet-5-5-high');
expect(runPreflight(wrongFamily).reason).toBe('MODEL_FAMILY_MISMATCH');
expect(runPreflight(astraCallerWithNoAstraAssignments).kind).toBe('ready');
expect(runPreflight(astraCallerWithAstraJudge).reason).toBe('ASTRA_CALLER_CONFLICT');
expect(runPreflight(astraCallerWithValidBoundedExtraSlot).kind).toBe('ready');
```

- [ ] **Step 2: Verify red.** Run `npm test -- test/config test/policy`.
- [ ] **Step 3: Add the default YAML and bounded loader.** Copy the exact complete YAML from the design to package-root `council.yaml`. Resolve only explicit `--config` or the real package-root file. Reject missing/unreadable files, invalid UTF-8, and input over 65,536 bytes. Do not search workspace/parent directories or merge partial settings.
- [ ] **Step 4: Implement strict YAML decoding and hashes.** Use `yaml` `parseDocument` with `version: '1.2'`, `schema: 'core'`, `strict: true`, `uniqueKeys: true`, `merge: false`, and `resolveKnownTags: false`. Reject parse errors/warnings, non-1.2 directives, and unsupported node tags before `toJS({ maxAliasCount: 0 })`. Validate with strict Zod objects. Required keys are exactly those in the design. Reject aliases, merge keys, extra documents, unknown fields, missing seats, and non-string selections. Hash original bytes separately from `hashArtifact('council-config', normalizedConfig)`. Never expand variables, includes, commands, or secrets.
- [ ] **Step 5: Pin configuration failure and replacement behavior.** Add explicit assertions for duplicate `judge` keys, YAML anchors with aliases, `<<`, custom tags, extra documents, typo fields, non-1.2 directives, unsupported schema versions, whitespace/alias model names, missing fields, and 65,537-byte input. Expect `CONFIG_INVALID`, `CONFIG_VERSION_UNSUPPORTED`, or `CONFIG_NOT_FOUND` as appropriate, with zero launches. An unsupported model or effort returns the distinct preflight reason `MODEL_UNAVAILABLE` or `EFFORT_UNSUPPORTED`. A permitted replacement needs fresh matching qualification; old-model receipts yield `UNQUALIFIED_ROUTE`.
- [ ] **Step 6: Implement temporary handoff creation.** Use `$TMPDIR`, else `/tmp`, on this host. Include suggested skills, requirements, priorities, prior decisions, references, and uncertainty. Reference existing artifacts instead of copying them. Reject known secret fields and leave sensitive exclusions visible to the calling agent.
- [ ] **Step 7: Freeze the hybrid method manifest.** Admit a small activity profile from the inventory candidates, with exact source bundle hashes and transparent adaptations. Record retained/replaced/excluded source requirements, unavailable dependencies, permissions, and explicit-only/disabled restrictions. Reject methods needing private interviews, hidden helpers, unsolicited writes/installs, or conflicting mandatory output. All seats receive the same catalogue; choices remain independent. `council.yaml` remains models-only.
- [ ] **Step 8: Implement shared question compilation.** Validate adapter origins, group only with a recorded coordinator proposal, preserve originals, and include authorized source answers. Tests cover duplicate aliases, cyclic/missing dependencies, partial replies, unknown/declined blocking answers, stale base context, post-limit current-context revisions versus stale finalized-batch resubmissions, deferred questions promoted without the original seat repeating them, conflicting request IDs, and the same ordered finalized ledger in all three next packets. Test current-hash correction at `CLARIFICATION_LIMIT`, a deferred first answer after dependencies resolve, ledger blocking items omitted by current ballots, and rejected stale old-batch answers.
- [ ] **Step 9: Implement policy attestation.** The calling agent must read the current human policy and supply its normalized choices. The runner verifies the policy hash, frozen configuration/profile hashes, a reusable bounded authorization receipt (roles, efforts, limits, expiry, extra Astra slots), seat families against current catalog evidence, route/model/effort admission, caller/slot observations, and qualification receipts. It must not pretend that a regex parser can interpret arbitrary policy prose. Do not compile the default model IDs into a fixed selection allowlist; current attested policy and exact qualified adapter controls govern replacements.
- [ ] **Step 10: Implement route and access gates.** Require exact requested/exposed settings, current host/version/action-class qualification, separate quota states, and approved action roots. Unknown quota permits only the declared bounded invocation. Authentication failure, denial, and quota exhaustion stay distinct.
- [ ] **Step 11: Reject unsafe scope.** Resolve canonical roots and reject symlink escapes. Keep source credentials, protected instructions, and coordinator control state outside worker roots unless an existing qualified control protects them. Do not add directories or persistent grants merely to make reads work.
- [ ] **Step 12: Verify green and commit.** Run `npm test -- test/config test/policy` and `npm run typecheck`. Commit with `feat: configure council roster and validate launch prerequisites`.

## Task 5: Qualified Orca transport and bounded worker bridge

**Files:** Create `src/orca/{client,transport,observations}.ts`, `src/workers/{bridge,protocol,strict-json,watchdog}.ts`, subprocess fixtures, and `test/orca/{argv,protocol,lifecycle,reconcile,deadline,qualification}.test.ts`.

**Interfaces:**
- Consumes: effect intents, immutable task packets, the frozen configured selections, Task 4 qualification/access decisions, and current Orca guides.
- Produces `OrcaTransport` with `launch(spec: WorkerSpec): Promise<LaunchReceipt>`, `observe(binding: AttemptBinding): Promise<WorkerObservation>`, `stop(binding, reason): Promise<StopReceipt>`, and `release(binding): Promise<ReleaseReceipt>`.
- Also produces `qualifyRoute(request: QualificationRequest): Promise<QualificationReceipt>` and `decodeProviderOutput(raw: Uint8Array, binding: AttemptBinding): WorkerResult`.
- `decodeStrictJson(text: string): unknown` rejects duplicate keys, invalid JSON, and extra top-level values. `normalizeJsonSurface(raw: string): NormalizationReceipt` optionally removes one complete whole-message fence and trailing commas outside strings. Receipt records operations, raw/normalized hashes, and decoder outcome; it cannot change JSON values.
- WorkerSpec uses LaunchReservation; LaunchReceipt establishes the actual transport attempt/authority and must correlate its client key. The adapter observes real Orca identities. It cannot fill missing Run/Task/Dispatch IDs from local counters.

- [ ] **Step 1: Add failing process and protocol tests.** The fake CLI records exact argv, cwd, environment keys, native actions, and children:

```ts
expect(decodeProviderOutput(forgedSeatReply, geminiBinding).status).toBe('invalid');
expect(await transport.observe(lostConnection)).toMatchObject({ status: 'unverifiable' });
expect(fakeOrca.launchCount(effectKey)).toBe(1);
```

- [ ] **Step 2: Verify red.** Run `npm test -- test/orca`.
- [ ] **Step 3: Implement command safety.** Resolve one Orca executable and load its version-matched guide. Use argv arrays and `shell: false`. Validate cwd and hosting workspace separately. Allowlist inherited environment and inspect hooks/tool exposure. Keep model output out of shell command construction.
- [ ] **Step 4: Implement provider profiles.** Pin route/model/effort from the frozen selection for the logical role. Use one adapter per supported provider route, not one implementation per default model. Assert that Sol/Sonnet replacements produce their exact configured argv and that all four phases retain exact packet context/profile/config bindings. Use a private task-owned temporary worker cwd and supplied task text when that route is qualified. Add no source roots or persistent permissions. Inspect effective roots, mode, settings, actions, and children. The historical AGY `1.4.6` fixture found that `--disable-slash-commands` disables `--mode plan`; treat that as a version-specific warning, not current-version proof, and reject that combination and verify the actual expanded `plan` command. Requalify after an installed-version change.
- [ ] **Step 5: Implement lifecycle reconciliation.** Persist launch intent/reservations as pending_execution. Commit LAUNCH_DISPATCHED with its stable replay/attempt key before transport.launch; a qualified adapter must never call launch before this fence. On return, commit LAUNCH_RECEIPT_RECORDED. Only pending_execution is proven unsent; dispatched with no receipt remains uncertain and uses the original attempt/replay lookup, never absence-based replacement. Recover through the original replay ID when supported. On unknown start, inspect the same attempt. Never launch a replacement because a wait or read is empty. Process inbox messages before acknowledgment, and release only accepted settled resources.
- [ ] **Step 6: Implement per-worker deadline enforcement.** Each bridge receives an absolute deadline of `min(worker deadline, run deadline)`. Its task-owned watchdog survives loss of the coordinator process. Register it with a stable attempt/deadline resource key, process identity, launch/exit receipts, and stop-only authority over one owned attempt. It cannot start workers or make decisions. Reconcile the existing watchdog rather than duplicate it; include it and its children in positive settlement checks. It can stop only that owned attempt and remains active until settlement. Use positive exit/child evidence before cleanup. Unknown exit codes remain unknown.
- [ ] **Step 7: Implement local-only surface normalization.** Decode strictly first; if needed, apply only the bounded fence/trailing-comma operations above. Preserve raw bytes and receipts. Duplicate keys, truncated/ambiguous content, new fields, semantic changes, or extra top-level values remain invalid. Tests prove a valid locally decoded result uses no extra worker; invalid output settles and terminally blocks further inference for that run with `INVALID_WORKER_RESULT`, never creates a vote or readiness. Version one permits no replacement inference in that run, even after a limit extension. After positive settlement its active interval closes terminally. A separately user-authorized new run references the failure and retains its original counters.
- [ ] **Step 8: Verify green with fakes.** Run `npm test -- test/orca` and `npm run typecheck`. Include oversized stdout, conflicting duplicate receipts, partial NDJSON, a child that outlives its parent, final JSON with a still-live CLI/MCP process, and an unsupported model override. A provider `SUCCESS` is not settlement. Preserve nonzero/forced exit codes and inspect remaining owned groups.
- [ ] **Step 9: Run the live feasibility gate only under valid current policy and allowance.** Qualify supplied-packet, no-write synthetic jobs for every route/model/effort required by the frozen configuration and its role/action class. A replacement cannot reuse another model's qualification. Prove real orchestration authority and owned settlement for the selected bridge. A terminal-only assessment is not a substitute for the full Council's required orchestration controls.
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
- [ ] **Step 5: Implement report forms.** Produce consensus, unresolved disagreement, operational blocker, and cancellation reports. Include every shared question and answer with provenance/status, alternatives, objection owners, judge challenges, missing evidence, clarification/round/call counts, remaining active budget, configuration/profile/context hashes, stable seat-to-model mapping, requested/exposed settings, and actual resource state. User direction never becomes a synthetic vote.
- [ ] **Step 6: Implement the scoped language profile.** Apply 25-word descriptive and 20-word procedural targets, consistent terms, active voice, and protected literals. Keep diagnostics separate from technical correctness. Do not claim dictionary verification or ASD certification.
- [ ] **Step 7: Verify green and commit.** Run `npm test -- test/evidence test/reports` and `npm run typecheck`. Commit with `feat: collect scoped evidence and render council decisions`.

## Task 7: Foreground controller, caller bridge, and CLI

**Files:** Create `src/runtime/{controller,inbox,reconcile,deadlines,clocks}.ts`, `src/cli/{index,parse}.ts`, and `test/runtime/{controller,questions,budget,paused-input,restart,cancel,ownership}.test.ts`, `test/cli/commands.test.ts`.

**Interfaces:**
- Consumes: all prior modules and injected `Clock`, `OrcaTransport`, `RunStore`, and evidence adapter.
- Produces: `runController(options: ControllerOptions): Promise<RunOutcome>`; `submitControl(root: string, request: ControlRequest): Promise<ControlReceipt>`; and `runCli(argv: readonly string[], io: CliIo): Promise<number>`.
- Produces: `captureClock(clock: Clock, processEpoch: string): ClockReceipt` in `src/runtime/clocks.ts`. Budget accounting is Task 1's pure function consumed by Task 2; the controller records clock receipts as events and persists only reducer results.
- The controller is one foreground process per invocation. No system service or hidden model coordinator is installed.

### CLI contract

| Command | Behavior |
| --- | --- |
| `council start --input FILE --workspace PATH [--config FILE] --json` | Load and freeze the selected YAML, validate the request, create the run, and own the foreground loop |
| `council inspect --run ID --workspace PATH --json` | Read committed status, pending question/candidate action, shared context hash, remaining budget, and resource observations |
| `council respond --run ID --workspace PATH --input FILE --json` | Durably enqueue answers, candidate, user facts/direction, or a bounded extension, including when no controller is active |
| `council resume --run ID --workspace PATH --json` | Acquire with positive prior-owner evidence, reconcile, recheck preflight, consume inbox, then execute eligible effects |
| `council cancel --run ID --workspace PATH --json` | Request cancellation; report success only after positive settlement |
| `council qualify --profile FILE --workspace PATH --json` | Run only the explicitly declared disposable qualification |

Control files use an atomic per-request inbox. Only the controller writes SQLite. Duplicate IDs/payloads are idempotent; conflicting duplicates and stale batch/context/candidate bindings are rejected. The response receipt means queued, not applied. Partial answers persist as drafts and keep the run paused.

Only `start` accepts `--config`. Its default is the real Council package-root `council.yaml`, not the target workspace. `resume` rejects that flag.

The run input file contains topic, handoff, scope, and operational limits. It cannot supply competing reviewer/judge selections or override the resolved configuration.

The calling skill launches `start` in its own Orca terminal and supervises that process. After a settled clarification pause exits, it presents one common question batch, enqueues replies, and starts `resume` only when the batch is finalized. All answers enter the shared ledger; none go privately to a worker. It polls `inspect` in bounded waits and answers candidate requests.

The controller does not call an extra LLM for synthesis. Its report returns `action_required: 'candidate'` with immutable inputs for the calling agent.

- [ ] **Step 1: Add failing fake-provider integration tests.** Exercise the exact caller callback and outcome paths:

```ts
expect(await runScenario('unanimous')).toMatchObject({ outcome: 'completed', roundsUsed: 1 });
expect(await runScenario('three-disagreements')).toMatchObject({ outcome: 'needs_user', roundsUsed: 3 });
expect(await runScenario('restart-after-launch')).toMatchObject({ duplicateLaunches: 0 });
expect(await runScenario('edit-yaml-then-resume')).toMatchObject({ configChanged: false, duplicateLaunches: 0 });
expect(await runScenario('original-yaml-deleted')).toMatchObject({ usesSavedConfig: true });
expect(await runScenario('saved-config-corrupt')).toMatchObject({ outcome: 'blocked', reason: 'CONFIG_SNAPSHOT_INVALID' });
expect(await runScenario('two-clarification-batches')).toMatchObject({ clarificationBatchesUsed: 2, roundsUsed: 1, equalSeatContext: true });
expect(await runScenario('partial-paused-answer')).toMatchObject({ newLaunches: 0, stillPaused: true });
expect(await runScenario('next-day-resume')).toMatchObject({ humanWaitChargedMs: 0, budgetReset: false });
```

- [ ] **Step 2: Verify red.** Run `npm test -- test/runtime test/cli`.
- [ ] **Step 3: Implement the controller.** On `start`, load configuration once, persist both immutable artifacts, and commit the manifest/checkpoint with `ConfigSnapshot` before any outbox effect can run. Use saved config/profile/context for every clarification, review, judge, and ballot. Publish Q+A context as one immutable transaction; validate all later launch packets against it. Commit each validated event/transition before executing its outbox intent. Before the dispatch fence, revalidate current phase/round/config/profile/context hashes and expected task, no pending context update, and current admission. Mark invalidated unsent effects superseded without refunding reservations; never discard dispatched work on silence. Commit the launch dispatch fence before any transport call and the returned receipt afterward. On every resume, runPreflight must produce a current accepted attestation before a new launch, even after direct active-phase reconciliation. For an evaluate-round intent, check its stable event ID in the store before generating its trusted clock receipt; if already accepted, reuse its committed result and acknowledge the intent. Otherwise commit the EVALUATE_ROUND event exactly once. Use stable seat order `openai`, `gemini`, `claude` at phase barriers. Preserve raw arrival evidence.
- [ ] **Step 4: Implement clarification and candidate barriers.** Collect three independent clarification results; settle resources; compile one question batch. Source checks finish before presenting the remaining questions. Partial replies cause no launches. Finalization creates one shared revision; after wave one with questions, admit a second wave, or after wave two start deliberation only without unresolved blocking issues. All-ready waves can skip remaining allowance only without earlier blocking items. A wave containing source-answered questions still admits wave two. Deliberation-origin answers always publish a new shared context before round N+1; exhausted rounds return to settled `needs_user`. Origin guards forbid a return to clarification. Merge initial review objections and register/apply valid ballot objections/dispositions at every completed barrier before either normal advancement or question diversion, so bypassing evaluation loses no ledger updates. Every ordinary-advance and question-diversion guard from review/candidate/judge/ballot/evaluation phases requires pendingContextUpdate === null. At settled barriers consume eligible controls before creating EVALUATE_ROUND; a pending update with three accept ballots must reach preflight, never completed. A valid pending ContextUpdate takes priority over old-context advancement at settled active barriers, including evaluation. Commit the ledger, invalidate the consumed round, and transition to preflight to apply/publish the update with no open question batch. Preflight then selects question collection, a guarded next round, or settled ROUND_LIMIT; retain an update at the last round in that unresolved report. Late post-completion controls are explicitly RUN_SETTLED. For late questions, route review or ballot barriers to `collecting_questions`, freeze a round-origin batch with ID/base hash, and settle before human wait. Accept post-limit `AnswerRevision` only against the current context and known unresolved IDs; append without extra inference. Complete evidence before requesting candidate synthesis; freeze once, with later material changes requiring a new round.
- [ ] **Step 5: Implement durable paused input.** `respond` works after controller exit without taking the SQLite writer. Use atomic per-request files; verify size/schema and advisory correlation using openRunReader before enqueue. Never acquire a SQLite writer lease; the consuming owner revalidates authoritatively in its application transaction. Resume uses positive owner evidence, reconciles first, and consumes queued controls before effects. Crash between inbox acceptance and acknowledgment is idempotent. Old answers never rebound to a new batch. The active owner also consumes its inbox before effects, at barriers, and during candidate waits with at most a 1,000 ms poll. Apply request/consumed-ID/checkpoint atomically, then acknowledge its file; a live candidate is applied exactly once without restart. An owner-exit race leaves queued input for positive successor acquisition.
- [ ] **Step 6: Implement restart and deadlines.** Resume verifies saved configuration artifacts and hashes, then enters reconciliation. Never reread the original YAML or substitute current defaults. Recheck current admission/availability/qualification/slot evidence against the saved roster. Observe overdue deadlines before any new launch. Within a process epoch, use monotonic timing only; ignore wall-clock jitter. Cross-epoch crash-reconcile uses wall elapsed time and blocks on backward wall observations. A cross-epoch wall-clock regression behind the last recorded observation blocks new work instead of extending time. Independent worker watchdogs retain original deadlines during coordinator loss. Open a new interval only for eligible resumed automated work, using saved remaining allowance; never reuse a closed interval's wall deadline. A finalized settled human wait in `needs_user`, `needs_context`, or a user-remedy `blocked` state charges zero overnight time, while active-process crash downtime charges conservatively from saved wall receipts. Unknown lifecycle cannot pause the clock. Returning through preflight uses a guarded saved-phase target, including mid-round phases; preserved valid results and unissued effects can continue, but issued inferences cannot repeat. Record reservation/pending_execution at intent; issued status begins only at the committed dispatch fence. Reconcile dispatched/receipt_recorded attempts by their original keys. Pending effects cannot have been sent under the qualified versioned protocol and can execute once after current preflight. Every issued attempt that exits without a valid required result, including empty/timeout output, sets the terminal inference block; no resume/extension can repeat it. After pause commit the controller may only report/exit; resume needs positive old-controller exit. Expiry allows only observation/stop/release until settled; it cannot reset at another invocation.
- [ ] **Step 7: Implement CLI I/O and exit codes.** Output structured JSON to stdout and bounded diagnostics to stderr. Use exit `0` for settled consensus, `2` for settled user action, `3` for blocked/unknown lifecycle, `4` for input/usage errors, and `130` for settled cancellation. Print the run ID before the long wait.
- [ ] **Step 8: Verify the full fake workflow.** Cover candidate/evidence drift, temporary handoff loss, wrong caller ownership, timeout, repeated cancel, connection loss, late old-attempt output, and all 27-call bound checks. Pin two independent batch counters, all-ready skip, second-wave dependent follow-up, unknown blocking answers at the limit, late questions consuming the next round, and source-answer parity. Apply `AnswerRevision` only at a positively settled question-related `needs_user` pause, for already published question IDs. Revision publication never triggers clarification; use the saved target and remaining-round/full-ledger guards. Test correcting a batch-one unknown after batch two is exhausted, with zero extra clarification calls. A correction appends a new answer linked to its predecessor; latest valid finalized answers determine unresolved status, without hiding history. Reject duplicate question entries with conflicting answers, invalid supersession chains, or cycles. Test 24-hour settled human wait, active crash elapsed time, repeated pauses, live candidate delivery, candidate delivery during owner exit, watchdog replay and child exit, terminal invalid-output block after resume/extension, zero remaining allowance, clock regression, uncertain shutdown, and partial inbox drafts without a controller. Verify budget replay after an extension/active crash, context updates during review/judge/ballot/evaluation and at round three, budget-only extensions with unresolved questions or exhausted rounds, an extended third clarification wave, origin-preserving repeated reconciliation, pending-versus-dispatched crash windows, raw-to-bound namespace/deferred-first-answer cases, a resolved round-one answer returning to prepare_round, explicit evaluation-event replay after a crash, advisory respond validation racing with phase advancement, all valid worker exits while the controller was down, objection/disposition retention on question diversion, and default package resolution from another cwd, explicit relative paths, missing-file failure without defaults, editing/deleting the original YAML during a run, new-run adoption of edits, unchanged objection ownership after model replacement, current-policy rejection on resume, and rejection of `--config` on resume. No test may contact a real provider.
- [ ] **Step 9: Verify green and commit.** Run `npm test -- test/runtime test/cli`, `npm run typecheck`, and `npm run build`. Commit with `feat: run and resume supervised council decisions`.

## Task 8: Skill package, qualification, and deployment gate

**Files:** Create `skills/the-council/SKILL.md`, `skills/the-council/agents/openai.yaml`, `skills/the-council/scripts/run-council.mjs`, `skills/the-council/references/communication.md`, `docs/runbook.md`, `test/skill/package.test.ts`, and `test/cli/end-to-end.test.ts`. Update the diagram source only if the implemented state contract changes.

**Interfaces:**
- Consumes: built `council` CLI, its control/result schemas, existing handoff/orchestration skills, and all qualification receipts.
- Produces: an explicit-invocation skill package, a dry-run installation manifest, and a documented deployment decision.

- [ ] **Step 1: Load the skill-authoring requirements.** Read `skill-creator` and `superpowers:writing-skills` before authoring the actual skill. Use supported client metadata for explicit invocation, verified against the installed client. The skill must never start a costly Council from an ordinary unrelated question.
- [ ] **Step 2: Add failing skill contract tests.** Confirm the package invokes the real CLI through argv, requires a topic and handoff, preserves current policy gates, forwards an explicit configuration path only to `start`, and handles `action_required: 'candidate'` and `action_required: 'questions'` without inventing votes, answers, or private interviews. Confirm package-root `council.yaml` is included in the package with the exact default roster.
- [ ] **Step 3: Verify red.** Run `npm test -- test/skill test/cli/end-to-end.test.ts`.
- [ ] **Step 4: Write the skill and launcher.** Set the skill name to `the-council`. In `agents/openai.yaml`, set `policy.allow_implicit_invocation: false`, display name `The Council`, and a default prompt that explicitly mentions `$the-council`. Reference the handoff, orchestration, Orca CLI, and language skills by their actual locations. Resolve the repository's built CLI from the skill's real path, so a later symlink installation stays valid. Reject a missing build with an actionable error. Do not run dependency installation implicitly.
- [ ] **Step 5: Write the operational runbook.** Include start/resume/cancel commands, an unresolved example, the diagrams, real-versus-unknown lifecycle, current route limitations, and owned-resource cleanup. If prior-controller exit is unprovable, keep the run read-only: obtain or restore positive execution-host owner/resource settlement receipts before resuming. There is no force-unlock override; a new run still needs prior-resource settlement evidence. Show how to edit package-root `council.yaml` or supply `--config`, with exact Sol Max/Sonnet High examples and a separately configured judge. Explain validation, new-model qualification, saved-run behavior, and the absence of hot reload. List the 2-clarification-batch, 3-deliberation-round, 27-call, 30-minute-per-worker, and 3-hour-active-work defaults. Show a common question batch, partial drafts, next-day resume, and a late-question round consumption example. Explain that task outcomes are not model-quality guarantees.
- [ ] **Step 6: Verify the complete local package.** Run `npm test`, `npm run typecheck`, `npm run build`, and `npm pack --dry-run`. Confirm runtime artifacts and secrets are absent from the package.
- [ ] **Step 7: Reconcile implementation with the diagrams.** Check all 17 state IDs and the named reviewer/judge phases. Validate/export the canonical Mermaid source with the diagram skill. Inspect the visible maps before deployment.
- [ ] **Step 8: Obtain fresh independent change review.** Use a permitted different-family reviewer through Orca. Give it the approved design, plan, diff, tests, qualification evidence, and ruling ledger. Follow the selected Superpowers execution workflow's exact review seats and fix budgets.
- [ ] **Step 9: Enforce the deployment gate.** Require passing fake tests, qualified exact live routes for the selected configuration, current policy permission and controls for any configured Ultra role, observed allowance, effective containment, and settled resources. A supplied-text Argon assessment alone is insufficient.
- [ ] **Step 10: Prepare installation for explicit approval.** Default proposal: a symlink from `/Users/aaat/.agents/skills/the-council` to this repository's `skills/the-council`. If the target exists, preserve it and stop for a scoped decision. Show exact targets, package version, checks, and rollback before the user approves this persistent installation.
- [ ] **Step 11: Install only after that deployment approval.** Record the owned link/path and existing state. Verify discovery from a fresh session. Rollback removes only the task-owned link after all Council processes settle. Do not restore whole global settings files or modify model policy.
- [ ] **Step 12: Commit this deliverable.** Commit the local skill, tests, runbook, and qualification record with `feat: package council skill with deployment controls`.

## Plan self-review and coverage

| Approved requirement | Owner |
| --- | --- |
| Same-version unanimity, equal reviewer authority, owned objections | Tasks 1–2 |
| Pure control determinism and recorded external inputs | Tasks 2–3 |
| Handoff for fresh and long sessions; missing temporary context | Tasks 4 and 7 |
| YAML roster, unchanged defaults, exact three-family reviewers, and separately configured fresh judge | Tasks 1, 4–5, 7–8 |
| Immutable configuration, stable seats, and saved-roster recovery | Tasks 1–4 and 7 |
| Configured model conflicts, Astra caller, and four-stream limits | Tasks 4–5 and 7 |
| Evidence provenance versus claim support | Task 6 |
| Two clarification batches, common question/answer ledger, transparent interactive-skill adaptations | Tasks 1–2, 4, and 7–8 |
| Three deliberation rounds, 27-call cap, local-only normalization | Tasks 1–2, 5, and 7 |
| Active work accounting, settled human pause, next-day durable input | Tasks 2–3, 5, and 7 |
| Hybrid profile source/adaptation hashes and equal catalogue delivery | Tasks 1, 4–5, and 7 |
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
- YAML `2.9.1` parser options: <https://github.com/eemeli/yaml/blob/v2.9.1/src/options.ts>.
- YAML `2.9.1` single-document decoding: <https://github.com/eemeli/yaml/blob/v2.9.1/src/public-api.ts>.
- better-sqlite3 transactions: <https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md>.
- SQLite durability setting: <https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md>.
- Vitest CLI: <https://vitest.dev/guide/cli>.
- Exact package versions: registry metadata from `npm view` on 2026-10-23.
- Orca commands: version-matched `orca-cli` and `orchestration` guides from the selected executable.
- Antigravity headless mode: <https://antigravity.google/docs/cli/headless/>.
- Local Codex skill metadata contract: `/Users/aaat/.codex/skills/.system/skill-creator/references/openai_yaml.md`.

## Plan review status

The base and YAML amendment reviews apply only to their historical recorded revisions. Fresh Opus Low and Argon High opinions/checks of the shared-clarification revision returned PROCEED_WITH_CHANGES. The [review record](../reviews/2026-10-24-the-council-shared-clarification-review.md) preserves every report, source hash, finding disposition, actual exit, and the bounded corrections applied afterward. No reviewer verdict was changed to READY.

Coordinator static checks cover the 17-state source, declaration/producer consistency, eight sequential task lists, local links, Markdown fences, and the intended publication/preflight cases. No application/runtime tests exist or ran. The final corrections are directly checked; another whole-artifact model pass is not claimed.

Implementation and deployment have not started. Please review the revised plan and choose an execution method before implementation. Subagent-driven execution through Orca remains recommended for the eight boundaries and their recovery risks.
