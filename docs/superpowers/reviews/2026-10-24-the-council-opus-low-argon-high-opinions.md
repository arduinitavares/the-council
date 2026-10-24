# The Council: Opus Low and Argon High design opinions

Date: 2026-10-24
Reviewed commit: `3c4510e153dc0cf2b8353c83eeadd8fff1533729`

Both independent reviewers returned **PROCEED_WITH_CHANGES**. They support the core architecture and identify contract gaps before implementation.

The coordinator checked their concerns against the actual documents. These opinions do not establish recommendation quality or live transport qualification.

The design and implementation plan remain unchanged. This report records findings and proposed dispositions for the user.

## Source key

- **S**: [Design](../specs/2026-10-23-the-council-design.md).
- **P**: [Implementation plan](../plans/2026-10-23-the-council-implementation-plan.md).
- **D**: [State and recovery diagrams](../diagrams/the-council.md).

Prior review conclusions were omitted from the supplied packets. Both reviewers received the same substantive source snapshot and the user requirements.

## Shared conclusions

Both reviewers support the pure control reducer, transactional effect journal, immutable acceptance bindings, and stable reviewer seats.

Both independently identify missing recovery transitions and redundant model calls for format correction.

The coordinator recommends five focused revisions before implementation:

1. Complete the state diagram for restoration, active-phase cancellation, deadlines, and return to the recorded phase.
2. Define how a stopped controller receives and consumes user input when the run resumes.
3. Complete permitted evidence observations before requesting candidate synthesis. Record their exact references in the round context.
4. Give final ballots a structured field for new reviewer-owned objections, with ledger and consensus tests.
5. Use audited local normalization for the two permitted syntax repairs. Keep ambiguous or meaning-changing output invalid.

These proposals preserve the selected defaults, equal reviewer authority, fresh judge, and unanimous acceptance rule.

## Finding disposition

Accepted means that the documents have a gap or unnecessary work. It does not mean that an unimplemented runtime failure was reproduced.

| ID | Reviewer concern | Coordinator disposition and source evidence |
| --- | --- | --- |
| O1 | Recovery cannot return to active work | **Accept the diagram gap.** D:93 returns only to `settling`; D:125 describes reconnecting to active work. P:181 makes the state graph the test contract. Add the missing edges and restoration cases. |
| O2 | Ultra approval is not modelled | **Qualify.** S:174 and P:372 already require current policy permission. Explicit authorization evidence would improve the preflight contract. Reuse existing applicable bounded approval. The policy does not require a new interview for every physical worker when an existing approval covers those roles and bounds. |
| O3 | Format-correction model call adds no value | **Accept.** P:278 already requires a strict, unique local baseline and then requires the model correction to match its hash. Local normalization can produce that same result directly. Removing correction inference would reduce the default worker-attempt bound from 42 to 21. This remains a proposed design change. |
| O4 | Three-hour deadline can expire before round three | **Qualify as a budget tradeoff.** P:23 and S:435 state hard deadlines, not a promise that three rounds finish. Three serial phases at their maximum can exceed the run budget. Show this tradeoff and return the available disagreement record. Typical Astra latency was not established. Do not relabel unknown settlement as completed user action. |
| O5 | Evidence arrives one full round late | **Do not accept that general claim.** S:277 already services requests before candidate freeze; S:241 gives the final responses the frozen evidence within that same round. However, the ordering before candidate synthesis needs a clear barrier, as A3 identifies. Preparing relevant source excerpts early is useful. |
| A1 | Missing active-phase, recovery, and unverifiable transitions | **Accept the missing phase edges.** Use positive ownership/liveness evidence before returning to the saved phase. Do not adopt `unverifiable` to settled `blocked` as a cleanup shortcut. Unknown process state must retain observation and deadline obligations under S:415 and S:439. |
| A2 | User input has no defined consumer after controller exit | **Accept the CLI contract gap.** P:322 targets an active owner; P:352 allows a settled user-action exit. Specify durable enqueue and consumption by the next validated owner, including reconciliation before any new launch. |
| A3 | Evidence may finish after candidate synthesis is requested | **Accept the ordering gap.** S:277 requires completion before freeze, but does not explicitly require completion before the callback in S:84. Add that barrier and tests for denied, missing, and out-of-scope evidence. P:128 already permits immutable round references; name review and evidence references explicitly rather than claim that no reference field exists. |
| A4 | Ballot schema cannot carry a newly discovered objection | **Accept.** P:120 has dispositions and a reason but no structured new-objection field. S:301 explicitly permits new objections. Define owner-bound additions, stable IDs, duplicate/conflict handling, ledger persistence, and consensus tests. |
| A5 | Format-repair sub-attempt is redundant | **Accept local normalization, with a limit.** The same reasoning supports O3. Do not broaden model repair merely because the decision word is extractable. All material content must remain unambiguous; otherwise the existing invalid-output stop remains appropriate. |

## Other suggestions

- Explicit Ultra and extra-Astra-slot authorization fields are useful audit details. They do not create permission or replace existing authorization.
- A judge from the OpenAI family can share biases with that reviewer. The user selected Astra as the default judge. Retain that choice and expose its provenance.
- The watchdog needs explicit ownership and cleanup evidence. P:277 already requires its independent deadline and positive settlement checks.
- Resume should record candidate-author changes and preserve earlier amendment provenance. Existing owner and caller checks remain necessary.
- A run-local `.council/.gitignore` could keep internal records out of an arbitrary target repository's status. Preserve preexisting files and tracked state.

## Next validation

First close the specific state, CLI, evidence-barrier, and ballot contract gaps. Add the corresponding replay and fake-provider acceptance cases during implementation.

Qualify the exact Astra Ultra Codex/Orca route early, before depending on it for the full system. That qualification needs its own valid scope and current policy authority.

These opinions authorize no implementation, live Council qualification, installation, policy edit, or deployment.

## Execution evidence and observed transport limitation

- Host: local Mac. Hosting Orca workspace and actual cwd: `/Users/aaat/projects/the-council`.
- Orca: `1.4.237`. Antigravity: `1.4.7`. Exact model IDs appeared in the current catalog and provider initialization.
- Both entries used explicit matching effort, the active system `plan` command, and terminal sandboxing. Exposed permission mode was `request-review`.
- Scope was supplied-text assessment only. No native tool or model-helper call appeared in the event streams.
- Provider-managed backend values beyond exposed observations were not exposed. Allowance was unknown; each opinion had a twenty-minute provider deadline.
- Opus Low used `claude-opus-5-5-low`, effort `low`. Its fixture and review exited `0`, and their owned process groups were absent.
- Opus fixture conversation: `46a7a59e-f503-4318-b026-f94ea8cee077`. Review conversation: `5e860a91-af7c-4739-afc0-cddb8eb9877f`.
- Opus fixture terminal: `term_3d3e3331-725b-43f9-a22a-6fd918d467fe`. Review terminal: `term_6470c7cc-854a-45b6-99a7-f1312f9865b0`.
- Argon High used `gemini-4-argon-high`, effort `high`. Conversation: `91225905-b1a8-4d6c-98ae-26e08fc2c11a`.
- Argon terminal: `term_48a69683-fa15-4ed9-8b54-332338568d8e`.
- Argon emitted a complete final `SUCCESS` response, but its CLI process remained alive. CodeGraph support processes were also observed in the owned group. The cause was not established.
- The owned Argon group did not settle after SIGINT and SIGTERM grace periods. The coordinator verified its ownership and stopped it with SIGKILL.
- The actual Argon provider exit was **`-9`**, not `0`. The wrapper recorded that failure and returned to its shell. The owned group was then absent.
- The saved Argon opinion is available for assessment. This attempt does not qualify normal unattended completion or cleanup of that route.
- All three task-owned terminals were closed after process settlement. The unrelated existing terminal was preserved.
- Provider settings bytes stayed unchanged. No workspace trust, permission, model-default, or billing change was made. Stderr files were empty.
- These custom terminals had terminal/process ownership only. No supervised Run, Task, or Dispatch authority is claimed.

The observed Argon shutdown problem reinforces the design's lifecycle gate. A complete report alone did not prove provider completion.

Temporary raw events, receipts, source manifest, and stop records remain at:
`/var/folders/fh/0bmky89j2d54xdptjs_1mrjm0000gn/T/the-council-opus-argon-opinions-g75sb_mr/`.

## Reviewed source hashes

- `docs/superpowers/specs/2026-10-23-the-council-design.md`: `63a9084b1d19f23be435dbc0d2e2291fdd2143928e16e3c1a164b15a743015ed`.
- `docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md`: `cd0ba3e70baa5f6e6a9baf0dfb0098ad2713304d9ab3399e0a2b22cc2d5bb021`.
- `docs/superpowers/diagrams/the-council.md`: `02bda5a70d11972d88388908bbdca1822d980f5fb0bec82c091d7af13eff18af`.
- `docs/superpowers/diagrams/README.md`: `72cbae069947ecf380735ac03bdb4d6b3fe999c7b04de135e9036a49c10fd3aa`.

## Full Opus Low opinion

The following is the original provider response. It is an opinion based on supplied text, with no executed implementation tests.

**Verdict: PROCEED_WITH_CHANGES**

The product choices hold together. The consensus core is sound. Two defects in the source can stop or damage real runs: a missing recovery edge and an incomplete Ultra approval gate. Three smaller defects reduce how useful the design is. None of these defects needs majority voting or a judge override to fix.

**Strongest choices**

1. **Pure reducer with a persisted effect outbox.** The runner records each launch intent before it acts. It does not launch again only because it sees no output. This protects you from expensive duplicate workers (design 336–346 and 409–419, plan Task 3).
2. **Assent is bound to exact hashes.** Each acceptance binds to the run, configuration, round, candidate, evidence and judge report. Seat identity comes from adapter bindings, not from text that a model wrote. Stale, forged or conditional assent cannot satisfy the rule (design 319–328, plan 113–116 and 168).
3. **Each run uses a frozen configuration with stable seats.** Seat keys own objections, so a model change does not move objection ownership. Resume does not read the YAML again (design 133 and 151–161).

**Concerns**

1. **High, source-backed: the recovery state has no exit back to work.** In `the-council.md:92-93`, `reconciling` goes only to `settling`. `[*]` has no edge to `reconciling`. But `the-council.md:54` and `recovery:124-126` say a restored run reconciles and then reconnects to the live attempt. Plan `:181` tells the builder to test every edge in the `states` diagram.
   - **Failure:** the coordinator restarts during `judging`. The live judge proves healthy. The machine can only settle, so it stops valid paid work and uses up the round.
   - **Smallest fix:** add `reconciling → <recorded resume target>` for positive liveness, and add a restore entry into `reconciling`. `RunContext` already stores the resume target (plan `:128`). Also add explicit `cancel` and `deadline` edges from the active states to `settling`, or state that the recovery diagram is normative.

2. **High, source-backed: the default roster needs approval that the design does not model.** The host policy requires explicit approval for Astra `ultra` for each named, bounded attempt. It also requires a verified route that controls every descendant. The design treats Ultra only as a qualification question (design `:161, :176`; plan `:249, :280-281`).
   - **Failure:** each default run either blocks every time, or it launches Ultra without the per-attempt approval that the policy requires.
   - **Smallest fix:** add an `ultraApproval` receipt to preflight (scope, roles, count, expiry). Bind it into the frozen manifest. Resume checks it again, and a missing receipt gives its own reason code. Keep Astra Ultra as the default.

3. **Medium, source-backed: the format-correction step can never add value.** Plan `:278` allows a correction launch only when a fixed deterministic repair already gives a valid baseline. The correction must then match that baseline hash. Any other malformed output blocks the seat with no correction launch.
   - **Failure:** the runner pays for a model call that can only repeat the repair it already made. Real malformations still block the seat.
   - **Smallest fix:** record the deterministic normalization as an adapter event and remove the correction launch. The attempt limit then becomes 21. If model correction must stay, define narrow cases that qualify, such as a schema-valid payload with a missing optional field.

4. **Medium, uncertain timing: the deadline can end a run before round three.** Each round has three serial worker phases at up to 30 minutes each, plus candidate synthesis. Three rounds can need about 4.5 hours. The invocation deadline is 3 hours (plan `:23`). Astra Ultra latency makes this likely.
   - **Failure:** the deadline expires in round 2 or 3. The run ends as `blocked`, not as `needs_user` with the unresolved points.
   - **Smallest fix:** when the deadline expires after a completed phase, settle to `needs_user` with the full disagreement report. Also show the time budget for each round in preflight.

5. **Medium, design consequence: reviewers see evidence one round late.** Reviewers get no source roots (plan `:275`). The adapter services evidence requests only before candidate freeze (design `:277`), and the judge cannot request evidence. Round-one reviewers therefore reason without the evidence they asked for. If the judge challenges a claim that needs new evidence, the check waits a full round.
   - **Failure:** in architecture questions, many rounds are spent only to collect evidence.
   - **Smallest fix:** in preflight, collect declared source excerpts and check outputs into the round-one input. Add one bounded evidence sub-step after the initial reviews.

**Optional improvements (not blockers)**

- The default judge (Astra) is in the same family as the `openai` seat. This could look like an advantage for that seat. You could record the judge family in the report, or recommend a judge from a fourth source when one becomes available. This is a matter of taste.
- The watchdog that survives coordinator loss (plan `:277`) is in practice a detached process. Document how it is owned and cleaned up.
- The caller must stay in the loop for hours to write candidates. Document what happens to candidate authorship when the caller changes on resume.

**Best next validation step**

Before Task 1, run one authorized, disposable live qualification: Astra Ultra through Codex through Orca. It must prove exact exposed settings, control of descendants, real Run/Task/Dispatch authority and settled cleanup. Both the default roster and the default judge depend on this route. If it fails, the default configuration cannot run, however correct the control logic is.

I reviewed only the supplied text. I tested nothing, and the software does not exist yet. The wording is Issue 9-oriented only and does not claim ASD-STE100 compliance.

## Full Argon High opinion

The following is the original provider response. Its process exit and cleanup limitation are recorded above.

(1) Overall Verdict
PROCEED_WITH_CHANGES

The design preserves three equal reviewer families, unanimous acceptance, a non-voting fresh judge, a three-round default limit, and frozen `council.yaml` settings. However, five source-backed defects in state transitions, CLI resumption, evidence sequencing, objection schemas, and format repair require correction before implementation.

(2) Strongest Choices
1. Pure state core with transactional outbox (`docs/superpowers/specs/2026-10-23-the-council-design.md:334-345`, `docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md:178-191, 213-216`): XState computes pure state transitions while SQLite records events, checkpoints, and effect intents in one transaction. This design guarantees deterministic control replay without claiming that model inference is deterministic.
2. Caller synthesis with cryptographic bindings (`docs/superpowers/specs/2026-10-23-the-council-design.md:80-94, 319-325`, `docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md:113-126`): The calling agent synthesizes candidates without launching a fourth coordinator family. Every `Ballot` binds to `configHash`, `candidateHash`, `evidenceHash`, and `judgeHash`.
3. Separation of evidence provenance and claim support (`docs/superpowers/specs/2026-10-23-the-council-design.md:269-274`, `docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md:123-124, 302`): The evidence adapter sets `EvidenceRecord.status` from observed sources and checks. The judge records `ClaimAssessment` separately, so model assertions cannot pass as verified provenance.

(3) Consequential Concerns (Source-Backed Defects)

1. [High] Missing active-phase and `unverifiable` transitions in `states` (`docs/superpowers/diagrams/the-council.md:54, 75-96, 122-130`, `docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md:128, 181-190`, `docs/superpowers/specs/2026-10-23-the-council-design.md:415-420`)
- Failure scenario: The coordinator crashes during `reviewing` while three workers run. On restart, `restoreForReconciliation` enters `reconciling` and observes `live` workers. Because Task 2 implements only `states` edges (`reconciling --> settling`), the runner cannot return to `reviewing` or exit to `blocked` when worker exit stays `unverifiable`.
- Smallest useful correction: Add `states` edges from active phases to `settling`, from `reconciling` to `RunContext.resumeTarget` when live, and from `reconciling` to `blocked` when `unverifiable`.

2. [High] Controller exit breaks `council respond` and `council resume` (`docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md:313-328, 350-352`, `docs/superpowers/diagrams/the-council.md:76-78, 89-95`)
- Failure scenario: Round three ends unresolved, transitions through `settling` to `needs_user`, and exits `council start` with code `2`. When the user supplies facts or an extension, `council respond` writes to the inbox for an active owner that already exited. Running `council resume` enters `reconciling` instead of taking `needs_user --> preflight`.
- Smallest useful correction: Allow `council resume` to consume pending inbox requests (or `--input FILE`) on settled pause states (`needs_context`, `needs_user`, `blocked`) and transition to `preflight`.

3. [High] Unordered evidence collection and missing exit edge in `prepare_candidate` (`docs/superpowers/specs/2026-10-23-the-council-design.md:83-90, 275-285, 360`, `docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md:128-129, 335`, `docs/superpowers/diagrams/the-council.md:81-83`)
- Failure scenario: Reviewers submit `evidenceRequests` in `reviewing`. If the controller emits `action_required: 'candidate'` before `evidence` intents complete, the caller authors a candidate without knowing which requests returned `unverified`. When out-of-scope evidence blocks freeze, `prepare_candidate` lacks an edge to `settling`, and `RunContext` omits round review and evidence references.
- Smallest useful correction: Complete round `evidence` intents and store `EvidenceRecord` references in `RunContext` before requesting a candidate. Add `prepare_candidate --> settling` for blocked or user-scope decisions.

4. [Medium] `Ballot` schema omits new objections against synthesized candidates (`docs/superpowers/specs/2026-10-23-the-council-design.md:236-243, 291-301`, `docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md:118-125, 153, 168`)
- Failure scenario: In round one, reviewers submit `review` payloads before any candidate exists. The synthesized candidate introduces a flaw that a reviewer rejects during `confirming`. Because `Ballot` only updates prior objections, the new objection cannot enter the round-two objection ledger.
- Smallest useful correction: Add `newObjections: readonly Objection[]` to `Ballot`. Append those objections in `applyOwnedDispositions` and block consensus while any objection remains open.

5. [Medium] Format-correction baseline rule makes repair sub-attempts redundant or unreachable (`docs/superpowers/specs/2026-10-23-the-council-design.md:251, 387-399`, `docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md:278`)
- Failure scenario: Task 5 Step 7 strips one JSON fence or trailing comma, parses the object strictly, and hashes that baseline before launching a repair worker. If local parsing succeeds, the extra worker call is redundant. If local parsing fails, the seat blocks without launching repair.
- Smallest useful correction: Accept deterministic fence and trailing-comma cleanup locally without a new worker. Launch a repair sub-attempt only when strict parsing fails and extracted decision literals are unambiguous.

(4) Optional Improvements (Non-Blocking)
- Explicit policy-approval fields in `PreflightInput` (`docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md:227-249`): Default `council.yaml` selects `gpt-6-astra` at `ultra`, which requires explicit bounded-attempt approval under `/Users/aaat/.agents/policies/model-policy.md`. Add explicit fields for `ultra` approval and extra Astra slot approval in `PreflightInput`.
- Local ignore file for `.council/` (`docs/superpowers/specs/2026-10-23-the-council-design.md:423`, `docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md:156`): Write `*` to `.council/.gitignore` when initializing `.council/runs/<run_id>/` so run state never dirties a reviewed repository.

(5) Best Next Validation Step
Update the state edges in `docs/superpowers/diagrams/the-council.md` and the `RunContext`, `Ballot`, and CLI resume contracts in `docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md`. Run Task 1 and Task 2 replay tests (`npm test -- test/domain test/machine`) and Task 5 live read-only route qualification (`council qualify`) before building the runtime controller.

STE Verification Note: This report uses an Issue 9-oriented profile. The official ASD-STE100 dictionary is unavailable, so vocabulary status is unverified. Technical literals and paths remain unchanged. No ASD certification or full compliance is claimed.
