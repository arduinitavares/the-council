# The Council design

Date: 2026-10-23

Status: Approved by the user on 2026-10-23 after a fresh independent builder check. Implementation planning is authorized. This document authorizes no implementation or installation.

Revision: On 2026-10-24, the user authorized `council.yaml` for reviewer and judge selection, with the current models as defaults.

Revision: On 2026-10-24, the user approved two shared clarification batches before three deliberation rounds and requested this integrated revision.

This revision also closes the documented recovery, paused-input, evidence-ordering, new-objection, and redundant-format-call gaps. Fresh independent opinions, finding dispositions, and applied corrections are recorded below. No post-correction whole-artifact READY verdict is claimed.

## Purpose

The Council helps the user make difficult decisions. Most topics concern software architecture, but the workflow accepts other topics.

Three reviewers examine the same problem. They use different model families. A fresh judge checks the evidence between review phases.

The result is either a unanimous recommendation or a precise account of the unresolved disagreement. Agreement does not establish factual truth.

## Confirmed requirements

- A skill starts and supervises the workflow through Orca orchestration.
- The skill always prepares a topic-specific handoff. This applies to new sessions and long conversations.
- The handoff follows the existing `handoff` skill and stays in the operating system temporary directory.
- `council.yaml` selects the reviewers and judge by exact model, route, and effort. The reviewer seats remain OpenAI, Gemini, and Claude.
- Reviewer defaults are Astra Ultra through Codex, Argon High through Antigravity, and Opus High through Antigravity.
- A fresh configured judge acts between rounds. Its default is Astra Ultra. The judge is separate from every reviewer session.
- The judge validates evidence and challenges weak arguments. It cannot overrule a reviewer and has no acceptance vote.
- All three reviewers must accept the same recommendation.
- Two clarification batches are the default allowance before deliberation. They do not consume the three deliberation rounds.
- All three reviewer seats receive every published question and answer in the same immutable context revision.
- Three deliberation rounds are the default limit. Remaining disagreements return to the user.
- Waiting for human input pauses the active-work budget only after verified resource settlement.
- Natural-language communication uses the `simplified-technical-english` skill as its basis.
- Quality takes priority over minimizing model use. This preference grants no billing or permission changes.

## Goals and boundaries

The workflow gives each reviewer equal authority over consensus. It preserves disagreements, source evidence, and revisions.

It can resume after a coordinator process stops. It must first reconcile any existing provider work.

The first version performs assessment only. It does not implement the recommendation, modify source files, deploy changes, or publish results.

The runner can write its own local records. Reviewer access to sources and verification commands requires an explicit, bounded task scope.

The workflow must not force agreement, count silence as acceptance, use majority voting, or let a judge substitute its preferred solution.

It must not claim that a state machine makes model reasoning deterministic. It must not present an unsupported claim as verified.

## Approaches and decisions

### Judge approaches considered

1. The calling agent acts as judge. This reduces launches but shares the calling agent's earlier context and commitments.
2. A fresh judge checks each round. This adds launches but separates the judge's context from the preceding discussion.

The user selected a fresh judge, with Astra Ultra as its configurable default.

### Proposed implementation form

A thin skill calls a local TypeScript runner. XState controls the runner's workflow. Orca controls worker placement and lifecycle.

This is a coordinator design choice for approval. A prompt-only skill cannot enforce the required transitions or restart protocol.

A continuously running service is outside the first version. A local process can persist its state without adding a service installation.

The builder will select and pin a supported stable XState release. The design uses the XState 5 persistence semantics checked during this discussion.

## Responsibilities

| Component | Responsibility | Authority limit |
| --- | --- | --- |
| Calling agent | Select topic context, compile candidates, and explain the result | Cannot vote for a reviewer |
| Skill | Apply required skills and start or resume the runner | Cannot bypass runner checks |
| XState runner | Validate events, advance states, enforce limits, and record effects | Cannot decide whether an argument is true |
| Orca adapter | Start workers, deliver messages, inspect evidence, and settle resources | Uses real Orca identities and receipts |
| Reviewers | Propose solutions, challenge claims, and accept or reject a proposal | Each controls only its own acceptance |
| Judge | Check sources, expose weak arguments, and issue questions | No acceptance vote or power to remove objections |
| User | Resolve priorities, provide missing facts, or authorize another bounded attempt | User instructions never become synthetic reviewer votes |

The coordinator owns the proposal artifact. Each reviewer can propose amendments. No reviewer has privileged access to that artifact.

The coordinator records each material amendment and its source. It cannot remove an objection without the objection owner's explicit disposition.

### Calling agent bridge

The current calling agent is the coordinator and candidate author. The runner does not launch another model to compile a candidate.

At `prepare_candidate`, the runner yields a structured request to that agent. It supplies the common input, reviewer outputs, alternatives, and objections.

The calling agent proposes one candidate against the stated requirements. It records why it selected that proposal and how it treated each alternative.

The skill keeps the calling agent in the supervised loop. The agent submits the candidate through a validated runner operation.

The runner checks the candidate's structure and bindings. It then records the immutable candidate and starts the judge phase.

Candidate synthesis remains a model judgment. Its output becomes recorded input to the deterministic state machine.

The three reviewers can reject that synthesis. The calling agent has no additional acceptance authority.

## Model selection and placement

### Configuration file and defaults

The planned runner reads `council.yaml`. Its default location is the Council package root, beside `package.json`.

This location is independent of the reviewed project's workspace. A linked skill resolves the real Council package path.

`council start --config FILE` selects another complete configuration. Relative paths resolve against the invocation's recorded working directory.

There is no directory search, environment override, or configuration merge. An unreadable or missing selected file fails before any provider launch.

The shipped file contains these defaults:

```yaml
version: 1

reviewers:
  openai:
    route: codex
    model: gpt-6-astra
    effort: ultra
  gemini:
    route: antigravity
    model: gemini-4-argon-high
    effort: high
  claude:
    route: antigravity
    model: claude-opus-5-5-high
    effort: high

judge:
  route: codex
  model: gpt-6-astra
  effort: ultra
```

The three reviewer keys are stable seat identities. Replacing Astra with Sol does not rename the `openai` seat or its objection ownership.

Each reviewer must use a model from its named family. The judge has its own configuration and can use any currently admitted, qualified model.

All entries still launch through Orca. `codex` and `antigravity` select the existing provider adapters, not alternative orchestration systems.

The accepted file is one UTF-8 YAML 1.2 document of at most 65,536 bytes. Every displayed field is required.

Reject unknown fields, duplicate keys, aliases, merge keys, unsupported tags, invalid values, and unsupported schema versions. Do not expand environment variables or includes.

This file selects models only. It cannot define commands, credentials, permission grants, helpers, or changes to the consensus rules.

Exact model IDs and efforts are validated against current policy, catalog evidence, and route qualifications. Short names such as `sonnet` are not model IDs.

A supported replacement within an existing adapter needs no code change. A new provider or required control can require adapter work and qualification.

### Frozen run configuration

Before any effect, the runner saves the original configuration bytes and a canonical validated configuration as immutable run artifacts.

It records the source path, raw-file SHA-256, configuration schema version, and canonical configuration hash. The run manifest binds all four worker roles.

The machine context, round bindings, launch registry, and reports use that saved configuration hash. Reviewer phases use the same seat-to-model mapping throughout a run.

Edits to `council.yaml` apply only to new runs. There is no hot reload or mid-run model replacement.

Resume uses the saved configuration. It does not reread or require the original file. A missing or corrupt saved configuration blocks launch.

Resume still rechecks current policy, availability, allowance, concurrency, and qualification. A previously valid snapshot does not authorize a currently forbidden launch.

### Default routes and launch checks

| Seat | Route through Orca | Exact model | Requested effort |
| --- | --- | --- | --- |
| OpenAI reviewer | Codex | `gpt-6-astra` | `ultra` |
| Gemini reviewer | Antigravity | `gemini-4-argon-high` | `high` |
| Claude reviewer | Antigravity | `claude-opus-5-5-high` | `high` |
| Fresh judge | Codex | `gpt-6-astra` | `ultra` |

The runner reads the execution host's current model policy before each assignment or fallback decision. It does not change that policy.

The table shows the shipped defaults. Actual launch uses the frozen configuration and remains subject to current policy and qualified route controls.

An Ultra launch requires verified control of any descendants. The first version permits no worker-created helpers or nested coordinators.

The preflight records authorization evidence for the named run, configured roles, bounds, and any additional Astra slot permission.

It reuses applicable existing approval and checks its scope or expiry. Selecting Ultra in YAML does not create permission or require repeated interviews when approval already covers the run.

The runner records requested settings and exposed effective settings separately. Missing evidence is `unknown`. There is no silent model or effort substitution.

The runner checks exposed allowance before a costly wave. Unknown allowance permits only a bounded attempt. Exhaustion and permission denial have separate outcomes.

All workers use the task's own registered Orca workspace. A standalone chat uses its existing folder without Git initialization.

The first version supports one qualified local execution host. A later version can support remote placement. Each additional host requires separate route qualification.

### Concurrency

At most four visible workstreams can be active, including the coordinator. Reviewer work uses up to three worker slots.

All reviewer tasks must settle before the judge starts. The judge must settle before the final reviewer responses start.

This order prevents concurrent reviewer and judge workers. The runner derives model-specific limits from the frozen roster and current active ownership.

An active Astra caller still counts while it waits. With the default roster, that caller conflicts with the configured Astra assignments.

If neither the reviewers nor judge use Astra, caller identity alone does not create an Astra worker conflict. Other policy and slot limits still apply.

The first version returns `blocked` before worker launch when the configured schedule requires unapproved concurrency.

The result explains two remedies: resume from a non-Astra calling agent, or obtain specific additional-concurrency authorization.

The first version does not transfer ownership automatically. It does not detach a hidden coordinator or end the calling session itself.

The runner cannot solve this conflict by silently changing the caller's model or bypassing Orca.

## Hybrid skill selection

The user selected a hybrid approach after considering unrestricted choice and a fixed universal skill set.

The coordinator proposes a small topic profile. Reviewers choose independently within the same admitted method catalog and record their choices.

The inventory at `../research/2026-10-24-skills-inventory/README.md` supplies candidates. It does not admit every installed or cached source.

Each admitted profile records its source paths, complete required bundle hashes, revision, and original requirements retained, replaced, or excluded.

Profile bundles are frozen for a run. A material profile change requires a separately recorded continuation and invalidates dependent round inputs and assent.

Original interactive skills are not invoked unchanged inside reviewer seats. A Council adaptation emits structured questions and evidence requests.

The coordinator owns interviews, authorized retrieval, report writes, and Orca dispatch. No skill can create helpers, permissions, or uncounted inference calls.

Explicit-only and disabled sources retain their restrictions. Persistent promotional instructions and unrelated private history are excluded from automatic seat catalogs.

`council.yaml` continues to select models only. Profile selection belongs to the run request and its frozen profile manifest.

## Input and handoff

The minimum input is a topic and the decision to make. The calling agent supplies relevant context already present in the conversation.

If a material requirement is missing, the workflow requests it before launching reviewers. Routine technical choices can remain explicit proposals.

The temporary handoff contains:

- The decision question and desired outcome.
- User requirements, priorities, constraints, and excluded actions.
- Relevant prior decisions and their reasons.
- References to existing specifications, source revisions, issues, and other artifacts.
- Known uncertainties and candidate solutions, with their status stated.
- Permitted sources, commands, effects, and worker access.
- Suggested skills, including orchestration and Simplified Technical English.

The handoff does not copy complete specifications or conversation transcripts. It excludes secrets, unrelated material, and sensitive personal data.

The runner records the handoff path and content hash. It freezes a source manifest for each round.

The run record stores normalized requirements and artifact references. It does not redistribute the official ASD-STE100 document or dictionary.

The handoff stays in `$TMPDIR`, else `/tmp`, on macOS and Linux. A later Windows implementation uses `%TEMP%`.

If temporary material disappears, resume stops at `needs_context`. It requests a new handoff instead of inventing the missing context.

## Shared clarification before deliberation

The default allowance is two clarification batches. A batch is one admitted wave of three fresh tasks, one per configured reviewer seat.

Each task returns either readiness or structured questions. It does not propose a solution, expose private deliberation, or open an interactive question interface.

Each question has a seat-local ID, exact text, reason, blocking flag, expected answer form, and dependency IDs. Dependencies may reference earlier ledger questions or current-wave questions, but must exist and be acyclic.

A question dependent on a current-wave answer is retained as `deferred`, with its original ID, wording, origin, and blocking flag. It is not presented in the same human answer batch. Batch compilation consumes the complete prior ledger as well as new results. It promotes any prior deferred question whose dependencies now have valid finalized answers with status `answered`, even if its original seat returns readiness in the new wave. Its original identity and origin remain unchanged.

A deferred blocking question at the second-batch limit remains unresolved in the shared ledger. It triggers `CLARIFICATION_LIMIT`; it cannot disappear or count as readiness. Nonblocking deferred questions remain explicit uncertainty.

Workers emit content-only wire records, never ledger provenance. Raw question references distinguish same-seat current-wave local IDs from fully qualified prior-ledger IDs. The pure binder namespaces questions and objections as `<runId>/<phase>/<cN-or-rN>/<seat>/<question-or-objection>/<localId>`, using actual launch bindings. Local IDs use 1–80 ASCII letters, digits, underscores, or hyphens. Same-wave local dependency references receive that same namespace; prior-ledger references must exist in the frozen input ledger.

The adapter binds origin/owner to the actual seat and attempt. Batch compilation derives presentation/deferment; workers cannot author these fields. The coordinator preserves original wording and records any grouping or duplicate alias.

Questions can stream into the coordinator inbox. They are not published to peers or answered piecemeal while the independent wave is still running.

The coordinator waits for all three tasks and their resources to settle. It then freezes one common question batch in stable seat order.

It first resolves facts available through authorized sources. Remaining user questions are presented together. Dependent follow-ups wait for the next batch.

A question's blocking status needs no majority. The coordinator can identify a duplicate or an existing answer, but cannot fabricate an answer or reviewer readiness.

Each question and answer batch records its origin as `clarification(batchIndex)` or `deliberation(round)`. An answer states its question ID, value, status, author/source, and evidence references. Status is `answered`, `unknown`, or `declined`.

Partial replies remain durable drafts. They start no worker. Finalization requires an explicit status for every presented question and validation of dependencies.

Each presented original question ID needs its own explicit Answer record. A grouping alias shares presentation only; it cannot manufacture an answer for another ID. A shared user response may explicitly name several IDs, in which case the coordinator records one provenance-linked answer per named ID. Grouping retains `blocking` when any member is blocking. All questions and their answers, including answers obtained from sources, enter an append-only shared ledger. Private side answers are not permitted. Each answer has a unique ID. An explicit correction identifies the answer it supersedes; it never overwrites history. The unresolved-question view uses the latest valid finalized answer in that chain, while every prior answer remains visible.

Every clarification wave, including all-ready/source-only waves, sets publicationKind to answer_batch with its recorded origin and question count. An all-ready wave has a controller-finalized empty AnswerBatch and no invented answer records. A changed question/answer ledger creates a new contextRevision and contextHash. An all-ready wave adding no questions or answers preserves both; its empty-batch/readiness evidence remains in phase history. Every later reviewer and judge task receives the same complete ledger and context snapshot.

The runner verifies actual launch-packet bindings. A model-authored claim that it saw a hash is not delivery evidence or proof of understanding.

If every seat returns readiness with no questions and no earlier blocking item remains, deliberation can start and skip the remaining clarification allowance. An all-ready wave with an earlier unresolved blocker settles to needs_user even when an extended allowance has unused waves. Otherwise, after batch one publishes finalized answers, batch two collects follow-up questions. A question answered from sources still counts as a question in that wave.

After the final allowed clarification batch, default batch two, complete answers permit deliberation directly. An authorized clarification extension applies the same rules to each additional batch: any nonempty current wave proceeds to the next allowed wave, while an all-ready wave can skip the remaining allowance. There is no third readiness wave. The first deliberation reviews use that same published context.

Any unresolved blocking question in the complete ledger, including an earlier batch, prevents admission to deliberation and returns `needs_user` with reason `CLARIFICATION_LIMIT` when the allowance is exhausted.

A finalized unresolved answer cannot be silently changed in place. Later user evidence uses an explicit `AnswerRevision` against the current published context hash, not the finalized batch's old hash. It appends superseding answers for known unresolved question IDs, or a first answer for an already recorded deferred question whose dependencies are now satisfied. A revision uses a non-null predecessor ID when replacing an answer, and null for a first answer to a previously unanswered deferred question. Dependencies must already be answered in the published ledger; answers within that same revision cannot activate another deferred question. The shared ledger records the change and retains every earlier answer.

`AnswerRevision` applies only at a positively settled question-related `needs_user` pause, against questions already in the published ledger. It does not interrupt an active wave or apply privately to one seat.

`publishing_answers` records whether its input is `answer_batch` or `answer_revision`. A revision never triggers a clarification wave. After its new context commits, the recorded continuation target goes to `prepare_round` only with no unresolved blocking ledger item and remaining round allowance. Otherwise it settles back to `needs_user`. A deliberation-origin finalized unknown, declined, or deferred blocking item also settles back to `needs_user` in rounds one or two, even when more rounds remain. It cannot deadlock in publication or start a round with that item unresolved. This works even when the corrected question came from batch one and the clarification allowance is now exhausted.

This permits resolution at `CLARIFICATION_LIMIT` without another inference wave. It cannot add a new model question, change its blocking flag, edit a finalized batch, or reset a counter. A stale answer-batch resubmission remains invalid.

The budget and batch counters do not reset on pause or resume. Empty waves and failed or uncertain launches cannot earn free repeat inferences.

Clarification consumes at most six worker calls under the default. No judge runs during clarification.

### Clarification after deliberation starts

Any reviewer can raise a material missing-input issue during a deliberation round. Initial reviews and final ballots both have a structured `missingInputQuestions` array. An accept ballot with an unresolved blocking question cannot produce consensus. Every nonempty deliberation `missingInputQuestions` array diverts the round, including nonblocking or source-answerable entries. This coordinator choice keeps context publication and round counting explicit. A late question consumes its round even if sources answer it without a human pause. Before either diversion, the review barrier merges every valid initial objection, and the ballot barrier registers new objections and applies valid owned dispositions. These ledger updates are committed even when `evaluate_round` is bypassed. At the completed review or ballot phase barrier, the coordinator routes to `collecting_questions` and freezes a round-origin `QuestionBatch` with a unique batch ID and current base context hash before any human pause. It collects and shares all issues with that common binding. Deliberation-origin batch compilation also promotes eligible deferred questions from the complete prior ledger. It cannot drop an earlier blocking item when current reviewers return no questions.

The run settles before waiting for human input. New answers create a new shared context and require the next deliberation round.

The interrupted round remains consumed. The runner never returns to the pre-deliberation clarification allowance to gain free rounds.

Finalized deliberation-origin answers pass through `publishing_answers`, create a new shared context, then go to `prepare_round` only when round N+1 is allowed. At the round limit they go through `settling` to `needs_user`. These guards exclude clarification-origin routes.

When no deliberation round remains, the runner returns the unresolved record. Another round requires an explicit bounded extension.

## One deliberation round

Each round has one candidate proposal and one fresh judge. A candidate has an immutable version and content hash.

1. Three fresh reviewer tasks examine the common round input. Round one requests independent solutions before reviewers see the other outputs.
2. The coordinator publishes all three outputs in stable seat order. Later rounds include the preceding arguments and unresolved points.
3. The evidence adapter completes all permitted requests and records their results. No candidate request is emitted before that barrier.
4. The coordinator compiles one candidate from those outputs and evidence results. It preserves alternatives, objections, assumptions, and amendment provenance.
5. The candidate and evidence bundle become immutable for this round. All initial reviewer tasks settle.
6. A fresh configured judge checks the frozen material. It returns evidence assessments and specific challenges. The judge then settles.
7. Three fresh reviewer tasks receive the identical candidate, evidence bundle, judge report, shared context, and objection record.
8. Each reviewer responds to the challenges and submits its own explicit acceptance or rejection of that exact candidate.
9. The runner validates all responses. It either records consensus, starts the next permitted round, or returns the unresolved points.

Fresh final-response tasks avoid relying on an unqualified session-resume route. They retain the same three logical reviewer seats.

This can require seven logical worker tasks per round: three initial reviews, one judge, and three final responses. Three rounds can require 21 tasks.

The calling agent's synthesis uses its current session. It is additional model work, but it does not create an eighth worker entry.

Formatting normalization is local and creates no model call. A logical worker task permits one inference attempt, with no hidden retry.

The default maximum is `3 * 2 + 7 * 3 = 27` worker calls: six clarification calls and 21 deliberation calls.

Replaying the same qualified transport request is not a new inference. If replay cannot establish that fact, reconciliation remains blocked.

Qualification runs are separate, explicit prerequisites. They cannot become hidden retries inside this attempt limit.

These are bounded ordinary entries, not an AGY managed batch. No Boost, Teamwork, or internal delegation is part of this design.

Later rounds focus on remaining issues. They do not repeat completed investigations without a reason.

A substantive amendment after candidate freeze requires a new candidate in the next round. A third-round amendment cannot silently create a fourth round.

## Evidence and objection records

Each material claim has an identifier, an owner, and a classification: fact, assumption, proposal, or value preference.

Evidence records contain a source reference, relevant location, revision or retrieval time, and the claim they support.

A test record also identifies the exact command, working directory, input revision, observed output, and permitted effects.

Evidence status is one of `verified`, `invalid`, `unverified`, or `not_applicable`. A model's assertion alone cannot establish `verified`.

Here, `verified` means that the adapter observed the source or check result and validated its provenance. It does not establish a claim's universal truth.

The judge records a separate claim assessment: `supported`, `contradicted`, or `unresolved`. The final report keeps provenance and claim assessment separate.

The coordinator-owned evidence adapter performs permitted source retrieval and check execution. Reviewers submit evidence requests as data in their reports.

The adapter services those requests before candidate synthesis and freeze. It uses only the preflight's allowed sources, exact commands, working directories, and declared effects.

For a source, it records the retrieved content hash and location. For a command, it records the execution receipt and output hash.

It checks those observations against the permitted request. Unknown outcomes and mismatches cannot receive `verified` status.

The first version does not rely on workers to execute checks. An evidence request cannot authorize a new host command or access grant.

A request outside the declared scope requires a user decision or remains unverified. The frozen required-evidence set includes all reviewer-requested IDs plus coordinator-required IDs. The coordinator cannot remove a reviewer request by reclassifying it as immaterial. Candidate freeze requires acknowledgment of every unverified/invalid ID in that set and records the uncertainty. The coordinator records the required set before candidate submission; the candidate cannot define it. The pure guard checks ID coverage, not whether prose proves a claim; the judge evaluates that judgment. An acknowledgment cannot override a permission denial.

The judge explains how each cited source supports the claim. It checks contrary evidence and states source-access limits.

Source retrieval and checks use the authorized adapter. Untrusted text remains data. It cannot change model routing, scope, or permissions.

An objection states the disputed claim, supporting evidence or missing evidence, and a condition that would resolve it.

An objection remains open until its owner explicitly withdraws it or records a supported resolution. Rejecting the candidate because the objection is unresolved keeps the objection open.

An objection cannot disappear because the coordinator summarizes it differently. All reviewers receive the complete current objection record.

The round input contains an immutable objection snapshot. A final response can append dispositions for that reviewer's own objections and structured new objections.

Each new objection has an owner-bound ID, disputed claim, evidence or missing evidence, and a resolution condition. It is retained for the next round.

Conflicting reuse of an objection ID fails validation. Identical duplicate delivery is idempotent. Other seats cannot create or close an objection for its owner.

The runner collects all final responses before it applies their disposition events. It then evaluates the consensus guard against the resulting objection state.

Other seats cannot close that objection. All dispositions remain in the event history. A new ballot objection prevents consensus in the current round.

A closure can cite only the frozen evidence and candidate. A material new fact or candidate amendment requires the next round.

The judge's challenges are visible to all reviewers. Each reviewer must address them in its final response.

The judge does not own a veto. The reviewers can reject a judge argument with stated evidence and reasons.

The final report preserves that exchange. It must not describe a disputed fact as proven merely because all reviewers accept a recommendation.

If evidence cannot establish a fact, the candidate can state an explicit assumption and its consequences. All reviewers must accept that same assumption.

A new assumption introduced only in a final response changes the candidate. That response is not unconditional acceptance.

New objections from initial reviews are merged into the shared objection ledger at the `reviewing` barrier, before candidate synthesis and judge input.

A new review or ballot objection must start open. A ballot can dispose only objection IDs present in its frozen input snapshot. It cannot close an objection it introduces in that ballot. Any nonempty ballot `newObjections` array prevents consensus for that round, even if other fields claim acceptance or closure.

## Exact consensus rule

Consensus requires all of the following:

- Exactly one current, valid final response from each configured reviewer seat.
- Every response belongs to the same run, configuration hash, profile hash, context hash, round, candidate hash, evidence hash, and judge report hash.
- Every reviewer explicitly accepts the candidate and its stated tradeoffs, assumptions, and uncertainty.
- No reviewer retains an open objection to that candidate.
- No unresolved blocking question, presented or deferred, remains in the complete shared ledger view bound to the context hash.
- Every reviewer addresses the judge's challenges. Remaining uncertainty appears in the frozen candidate and final report.
- The runner has verified the provenance and exposed required settings for each worker.

Conditional acceptance, silence, abstention, missing output, stale output, and a majority do not satisfy this rule.

The judge has no acceptance field. A judge report cannot mutate reviewer responses or close reviewer objections.

The system checks the structure and identity of assent. It cannot prove that a model understood the material or reasoned correctly.

## XState and determinism

XState represents the allowed control states and transitions. Model inference, source retrieval, and Orca processes remain external effects.

The deterministic core follows this relation:

`next_state, effect_intents = transition(current_state, validated_event)`

The same machine version, frozen configuration, saved context, and ordered event history must produce the same state and effect intents.

This guarantee does not extend to another model call. It also does not imply that different event histories produce identical recommendations.

Guards are pure, synchronous functions. They check recorded values. They do not call a model, read a clock, fetch a source, or inspect Orca.

The adapter turns external observations into validated events. Every accepted event carries a trusted clock receipt. The pure reducer applies budget accounting from those recorded values; the controller never mutates budget state outside a committed transition. Deadlines enter as recorded timer events. Generated identifiers enter as recorded values.

A single coordinator owns event acceptance. It collects parallel reviewer responses behind a phase barrier. It publishes them in stable seat order.

This avoids giving the first response extra authority. Raw arrival order remains available for operational audit.

### Principal control states

| State | Exit condition or result |
| --- | --- |
| `preflight` | Policy, workspace, models, allowance, access, and ownership are qualified |
| `needs_context` | User or caller supplies a valid missing input |
| `clarifying` | Three current clarification results and their resources settle |
| `collecting_questions` | The common batch and permitted evidence observations are complete |
| `publishing_answers` | The answer ledger and next shared context are committed |
| `prepare_round` | Stable checkpoint; explicit `ADMIT_ROUND` reserves admission after immutable inputs are ready |
| `reviewing` | All three initial review tasks settle with valid results |
| `prepare_candidate` | Evidence barrier completes, then the caller freezes candidate and evidence |
| `judging` | The fresh judge settles with a valid report |
| `confirming` | All three final-response tasks settle with valid results |
| `evaluate_round` | Stable checkpoint; a journaled `EVALUATE_ROUND` event runs pure outcome guards |
| `reconciling` | Existing worker and effect state is positively established |
| `needs_user` | The unresolved report identifies the required user decision |
| `blocked` | An operational, permission, policy, or evidence-access gap prevents progress |
| `settling` | Every owned provider resource has an inspected cleanup outcome |
| `completed` | Consensus report is available and cleanup is settled |
| `cancelled` | Cancellation is recorded and owned resource settlement is established |

Operational state and decision outcome are separate fields. An unresolved decision can have fully settled resources.

A useful model result with unknown process state is not operationally complete.

### Global transitions and recovery targets

The canonical `states` diagram is normative and contains 17 states. All are stable checkpoint states; none requires an unrecorded eventless transition.

After final responses, `confirming` commits `evaluate_round` and an `evaluate-round` effect intent. The controller supplies a trusted journaled `EVALUATE_ROUND` event with a clock receipt. Its stable ID comes from that intent key; recovery checks whether it was already accepted before creating or applying it. The resulting reduction selects consensus, the next allowed round, or unresolved. `prepare_round` likewise waits for explicit `ADMIT_ROUND`, so state entry alone starts no inference.

Every guard uses the effective limits derived from authorized extensions, never the immutable request's original limit.

At each active barrier, priority is cancellation/failure/deadline, unknown lifecycle, an accepted pending ContextUpdate, then normal advancement. Every normal-advance or question-diversion guard from reviewing, prepare_candidate, judging, confirming, and evaluate_round requires pendingContextUpdate to be null. The controller consumes eligible queued controls before creating EVALUATE_ROUND. These guards do not rely on transition listing order. The recovery view illustrates the same global handlers.

Every active phase has an explicit path to `settling` for cancellation, operational failure, deadline expiry, or a required user decision.

Both restoration and every in-machine transition into reconciling capture the prior state in reconcileOriginState, before it is overwritten. A reconciling self-transition preserves the existing non-null origin. Re-restoring a reconciling checkpoint preserves its original origin. A missing origin blocks instead of guessing from a stale pause target. This is an external restoration operation, not a provider launch or a new inference admission.

A resume with every external resource positively settled, positive prior-controller exit, and a saved target goes from `reconciling` to `preflight`. For an origin of preflight, established current ownership permits return to preflight even before an initial pause target exists. A settled-pause origin (needs_user, needs_context, blocked) additionally requires its valid saved target and positive prior-owner/resource settlement. Active-phase return edges require that exact active origin. These cases are mutually exclusive. This is distinct from live reconnection. Positive liveness and ownership permit return to the recorded phase without launching a duplicate. An existing attempt that exited with a valid saved result returns to its saved active phase for result ingestion and normal advancement, without inference. Reconciliation sends failed, invalid, timed-out, or cancelled work to `settling`, as well as a saved settling phase. A valid result does not by itself establish every owned resource has settled; reconciliation still accounts for watchdogs and children.

`reconciling` keeps unknown outcomes visible and continues observation. It cannot publish a settled outcome or release resources merely because exit is unverifiable.

Only after verified settlement can the run enter `completed`, `needs_user`, `blocked`, or `cancelled` as an operationally settled outcome.

Every resume obtains a current runPreflight attestation before executing any new launch intent, including when active-origin recovery returns directly to its saved phase. Failure settles/blocks rather than launching. Resume from a settled pause passes through reconciliation and preflight, then consumes queued controls and returns to its recorded target. Preflight has guarded return edges to every saved active phase.

A mid-round remedy can continue only from preserved valid results and unissued permitted effects. It cannot relaunch an already issued inference or override a denial. The launch registry reserves every logical task/attempt as `pending_execution` with its launch intent. The controller must commit a `LAUNCH_DISPATCHED` event and outbox fence as `dispatched` before calling transport.launch, then record its real receipt through `LAUNCH_RECEIPT_RECORDED` as `receipt_recorded`. These accepted events update the pure checkpoint and outbox in the same transaction.

A `pending_execution` entry is a proven unsent effect under this versioned controller protocol and can execute once under the current owner only while its phase, round, context/profile/config hashes and expected task remain current. A pending context update or superseded input prevents its dispatch fence. Invalidated unsent effects are recorded as superseded, with no counter refund. Dispatched work must still be observed and settled; it cannot be discarded on silence. A `dispatched` entry without a receipt is uncertain; absence from Orca is not proof of exit or permission to launch again. Qualified idempotent replay may reconnect that same attempt; otherwise observation continues. Reservations and counters remain consumed at intent commit. An issued attempt that exits without a valid required payload, including an empty result or timeout, terminally blocks inference for that run. A missing/invalid required result has no replacement inference in version one; it remains blocked for that run. Specific access remedies still require their own authorization and positive evidence.

Targets distinguish answering a clarification batch, starting another allowed batch, entering deliberation, and continuing a later deliberation round.

Preflight continuation routing has this priority after current launch prerequisites pass:

1. A valid finalized AnswerBatch or current-hash AnswerRevision goes to publishing_answers, including at a round limit.
2. Otherwise, a saved staged-question collection target goes to collecting_questions, including at a round limit.
3. Otherwise, an open unfinalized QuestionBatch returns to settled needs_user, even if all its questions are nonblocking.
4. Otherwise, an allowed saved/initial clarification target can continue within effective clarification capacity; a next-round target requires no blocking ledger item and roundsUsed below the effective round limit.
5. A legal saved mid-round remedy can continue the already admitted round, including round three. Next-round exhaustion does not prevent finishing that round. No issued inference may repeat.
6. Remaining unresolved, exhausted or unsupported continuation targets settle to needs_user or the specific operational blocker. They cannot bypass the preceding publication/collection/open-batch checks.

Every settled pause records its continuation target before overwriting the active phase. An initial needs_context/blocked pause uses clarifying when no prior target exists; an ordinary mid-round remedy preserves its legal interrupted phase. A terminal inference block permits inspection only. Question, clarification and round-limit pauses record prepare_round as their later continuation target. A collection pause awaiting answers records publishing_answers. Preserve a target through intermediate preflight/publication states; clear it only when entry to that exact target commits.


### Durable input when the controller has exited

`respond` opens run state through a read-only store connection for advisory schema/correlation checks, then atomically enqueues the request even when no controller is active. It never acquires the writer lease. The consuming owner revalidates correlation against its current revision inside the transaction; that decision is authoritative. It does not mutate SQLite or claim the request was applied.

Duplicate request IDs with identical payloads are idempotent. Conflicting duplicates are rejected. Questions and answers also bind the batch ID and base context hash.

`resume` acquires ownership using positive prior-owner settlement evidence, reconciles resources, and consumes the inbox before issuing new effects.

It rejects stale answers or candidate submissions instead of rebinding them to the current phase. Corrections need an explicit new request and context revision.

The active controller consumes the inbox before each effect, at phase barriers, and during candidate waits. It uses bounded polling with at most a 1,000 ms wait. Applying a request and its consumed-ID record is transactional; file acknowledgment follows the commit.

A candidate submitted to a live owner therefore needs no restart. If that owner exits during delivery, the request remains queued for a positively acquired successor. Enqueue alone never proves application.

The skill submits user answers to the durable inbox. Partial drafts keep the run paused. Finalized batches permit resume when the previous controller has exited. It never sends facts privately to a seat.

### Event validity

Each event carries an event ID, run ID, phase, round, seat, active attempt ID, and schema version where applicable.

Provider events also carry real Orca Task and Dispatch identities when the chosen transport provides them.

The adapter validates correlation against the launch registry. It does not trust identity claims contained only in model-authored JSON.

The adapter acknowledges duplicate delivery IDs after it processes them. It does not apply their effects again. Conflicting payloads under one identity stop reconciliation.

The runner retains late responses from a superseded attempt as evidence. They cannot change current acceptance.

The adapter first attempts strict JSON decoding. A bounded local normalization can remove one whole-message JSON fence and trailing commas outside strings.

It records the raw hash, exact operations, normalized hash, and strict decoder outcome. Duplicate keys, extra top-level values, truncation, or ambiguity remain invalid.

Normalization cannot invent a field, answer, decision, source, or assumption. No model is called to repeat a valid locally decoded payload.

An invalid result triggers settlement and a terminal inference block for that run, with reason `INVALID_WORKER_RESULT`. It is never a rejection, abstention, readiness result, or reason to select a substitute model.

Once invalid-output settlement completes, the active interval closes as a terminal outcome, rather than remaining an indefinitely chargeable remedy wait. Version one has no replacement inference for an invalid logical task. `resume`, a round extension, or a deadline extension cannot reuse its call slot or relaunch that task. The user may explicitly authorize a separate new run, retaining the failed run and its actual counters as provenance. This is a coordinator choice to keep the initial protocol small.

## Persistence and restart recovery

The proposed local store is SQLite. This is a coordinator choice for transactional event and effect records, not a library requirement imposed on the builder.

Each transaction records an accepted event, the new machine checkpoint, and any effect intent. The store references immutable report files by content hash.

One active writer owns a run. A revision check prevents a second coordinator from issuing effects from an old checkpoint.

An effect has a stable key containing the run, round, phase, seat, and attempt. The registry records intent before execution and receipts afterward.

There is no claim of general exactly-once execution. Orca replay support and positive reconciliation determine whether the runner can retry a particular launch.

XState restoration can restart invoked actors. Therefore, restoring a snapshot cannot directly start an unguarded provider invocation.

Every restarted adapter first consults the effect registry and actual Orca state. It reconnects only after it establishes the identity of existing work.

If launch outcome is unknown, the runner retains the original receipt and inspects the existing attempt. It does not issue a fresh launch on silence.

If the transport cannot resolve that uncertainty, the run stays blocked. A timeout is an observation, not proof that the worker exited.

The runner records the machine, schema, configuration, packet, prompt, and dependency versions. An incompatible checkpoint requires an explicit migration or remains read-only.

Default run records live under `.council/runs/<run_id>/` in the task workspace. This internal store is separate from the temporary handoff.

The first version has no automatic destructive retention cleanup. The store references source artifacts or retains minimal evidence within their authorized access scope.

## Limits and user intervention

Default limits are two clarification batches and three deliberation rounds, tracked by separate counters.

The coordinator reserves a batch or round atomically with its first launch intent. That admission is conservative and counts even if external start becomes uncertain.

Preflight failures before any launch intent consume neither counter. A pause after admission cannot create a free repeat of that wave.

All worker launches also reserve a call slot before execution. The total bound is `3 * maxClarificationBatches + 7 * maxRounds`.

The initial request is immutable. An append-only authorized extension ledger derives the effective batch, round, call, and work limits; increasing a limit preserves consumed counts and time. Increasing a counter limit or the work budget requires an explicit bounded extension record. Existing counts and evidence are preserved.

The worker-call bound covers clarification and deliberation. There are no permission retries or hidden extra rounds.

Operational defaults are 30 minutes per worker attempt and three hours of active work per run. The user can change them before launch.

The active-work budget spans controller invocations. Resume preserves the remaining budget and both admission counters.

Each active interval has a recorded epoch, start observation, and remaining allowance. A settled human-wait event closes the interval before process exit. It applies to `needs_user`, `needs_context`, or `blocked` when a user input or remedy is required and every external owned resource has settled. Unknown lifecycle remains active in `reconciling`. The current controller may only commit the pause/report and exit; it cannot issue new effects after closing the interval. A successor still requires positive prior-controller exit evidence.

Resume after that pause opens a new interval only when eligible automated work begins. Reading or enqueuing partial answer drafts keeps the interval closed. It does not reuse the expired wall-clock deadline of the closed interval.

Within a process epoch, accounting uses only monotonic elapsed time; minor wall-clock jitter does not change it. Across an active crash into a new process epoch, accounting uses saved wall observations and blocks on regression. After an active-process crash, elapsed downtime is conservatively charged from saved wall observations.

A cross-epoch wall clock behind the last recorded observation blocks new inference. Unknown clock or lifecycle state cannot increase the remaining allowance.

An intentional wait for human input pauses the run budget only after every owned worker and resource has verified settlement.

The runner records that pause and the remaining budget before it exits. Waiting until the next day consumes no further active-work budget.

On resume, the runner rechecks ownership and launch prerequisites. It records a new active interval using only the saved remaining budget.

An ordinary crash, connection loss, or unknown shutdown does not pause the budget. Running workers retain their original attempt deadlines.

Budget expiry permits only observation and supported shutdown until settlement. It returns available disagreement evidence and the actual operational outcome.

Three hours is a hard work budget, not a promise to complete all batches and rounds at their individual maximum durations.

Candidate synthesis and other automated work still consume active time. A missing result cannot become a synthetic wait for human input.

These are observed deadlines, not provider token or billing caps. An expired deadline stops new inference tasks and begins the supported stop protocol.

Each per-attempt watchdog is a recorded owned resource with an effect key, process identity, fixed attempt/deadline binding, and launch/exit receipts. It has stop-only authority for that one attempt, no model, and no coordination or new-launch authority. Such watchdogs are owned resources rather than visible model workstreams; they use no additional model slot but still require settlement.

Reconciliation reuses an existing watchdog by its resource key. It cannot create a second watchdog on replay. Settlement includes the watchdog and its children; provider exit alone does not establish their exit. Its survival after controller loss is an explicit deadline-enforcement mechanism, not a hidden coordinator.

The deadline remains active until owned resources settle. The runner must report any unknown or unverified shutdown state.

One material blocking question can require user input. Shared issue IDs preserve its identity without requiring all reviewers to discover it independently.

The unresolved report states the competing positions, questions, answers, supporting evidence, assumptions, attempted resolutions, and smallest useful next step.

User facts, priorities, and assumptions outside an open question batch use an append-only `ContextUpdate` against the current context hash. It applies in `preflight` or `prepare_round` at a settled boundary before launch intents, rather than through `publishing_answers`. While a question batch is open, it stays queued; if publication changes its base hash, the stale update is rejected for explicit resubmission. They publish to all seats before the next admitted round; an active deliberation update stays queued until settlement and consumes the interrupted deliberation round. A valid ContextUpdate becomes an accepted pending control before a phase advances. At a settled active deliberation barrier (including before EVALUATE_ROUND), it takes priority over old-context candidate/consensus advancement. The barrier commits valid objections/dispositions and staged questions, invalidates the consumed round, then goes to preflight. Preflight applies the update if no question batch is open, publishes a new context, and selects question collection, the next allowed round, or settled ROUND_LIMIT. An update at round three is retained before the unresolved report. It cannot create acceptance of the new context from old ballots.

Version 1 rejects `ContextUpdate` during `clarifying` with `CONTEXT_UPDATE_DURING_CLARIFICATION`. The rejection preserves the unapplied request for resubmission in `preflight` or `prepare_round`, against the current context hash. Resubmission requires positive settlement and no open question batch. The original clarification wave completes against its frozen input. The rejection changes no context, counter, reservation, or dispatch eligibility.

Updates that race after a run's authoritative completion are rejected as RUN_SETTLED; enqueue alone is not application. An open question batch keeps a ContextUpdate queued until that batch completes, with stale hashes rejected explicitly. They create no private worker message or acceptance. The user can supply evidence, stop, choose priorities, or authorize a bounded extension. User direction never creates reviewer acceptance.

A continuation preserves history and the frozen model roster. It rechecks current policy, routes, ownership, profile validity, and allowance.

## Simplified Technical English profile

All natural-language task packets, arguments, judge reports, and result summaries use the installed `simplified-technical-english` skill.

The initial profile is Issue 9-oriented. It does not claim full ASD-STE100 conformance, certification, or endorsement.

Descriptive sentences target the skill's 25-word limit. Procedural sentences target its 20-word limit. Each paragraph has one topic.

Writers use active voice when the actor is known. They avoid contractions and semicolons. They use one term for one concept.

The common glossary defines reviewer, judge, round, candidate, evidence, objection, and acceptance. All seats receive the same glossary revision.

Code, identifiers, commands, paths, URLs, citations, and exact quotations retain their original form. Machine-readable schemas are protected literals.

Language checks remain separate from technical evidence checks. A surface scanner can identify candidates for correction but cannot establish dictionary compliance.

An unresolved terminology issue cannot silently change technical meaning. A strict conformance request requires the governing standard and terminology sources.

## Skill and adapter contracts

The skill applies the handoff, orchestration, Orca CLI, model-policy, and Simplified Technical English requirements before launching work.

The runner supports start, inspect, resume, respond, and cancel operations. The builder will define command names and schemas in the implementation plan.

No command examples in this document are claims about existing Council commands.

The Orca adapter loads version-matched guides from the selected executable. It uses documented capabilities rather than fixed assumptions about a future CLI.

It uses supervised Run, Task, and Dispatch state when the transport supports the required controls. A custom terminal cannot invent those authorities.

Required access or execution controls that the route cannot express block that launch. There is no silent fallback to a native subagent tool.

AGY entries keep their planning and review scope. The adapter verifies source access, terminal sandbox, execution mode, hooks, configuration, and tool exposure separately.

The coordinator owns report and state writes. Model output cannot authorize a new command, permission change, extra provider, or source modification.

Worker completion requires inspected final output, diagnostics, actual actions, and lifecycle evidence. `SUCCESS`, exit zero, or an idle terminal alone is insufficient.

The adapter processes Orca messages before acknowledgment. Accepted settlement precedes release. Cleanup affects only task-owned resources.

## Required implementation verification

The builder must provide focused tests for these consequential controls:

- Three matching acceptances succeed. Two acceptances, abstention, and conditional acceptance do not.
- A changed candidate hash invalidates all earlier acceptance records.
- A judge report cannot create assent, remove objections, or trigger a fourth round.
- Two clarification waves consume no deliberation rounds and at most six calls. All later tasks bind the same published question-and-answer context.
- A single seat's blocking question is collected. Duplicate questions retain provenance. Partial, stale, contradictory, or dependency-incomplete answers start no worker.
- Deferred blocking follow-ups survive in the ledger at batch two. Deliberation-origin answers publish before the next counted round and cannot return to clarification.
- A live controller consumes a submitted candidate exactly once without restart. Watchdogs have reconciled ownership and positive settlement evidence.
- Invalid worker JSON ends inference for that run; resume/extensions never grant a replacement or reuse a call slot.
- No third clarification wave or extra deliberation round appears without an explicit extension. Default total worker admissions never exceed 27.
- New ballot objections persist into the next round and block consensus. A foreign seat cannot own or close them.
- Candidate synthesis cannot start while a required evidence effect is pending.
- A controller can exit at a settled question pause. A later durable response is consumed exactly once by a verified new owner.
- A next-day human reply preserves remaining budget. A crash with live or unknown workers continues charging time.
- Local format normalization makes no inference call and never changes protected payload meaning.
- Each final reviewer response addresses the exact judge report it received.
- Arrival order cannot privilege one reviewer at a completed phase barrier.
- Duplicate, forged, stale, malformed, and conflicting events cannot create consensus or duplicate effects.
- A crash before launch, after external launch, and before receipt commit cannot silently launch a duplicate worker.
- Replay of a recorded history under its pinned machine version gives the same control states and effect intents.
- A checkpoint cannot silently resume under an incompatible schema or machine version.
- An Astra caller conflict and a concurrent Astra worker conflict block unapproved launches.
- The default YAML preserves the selected models and efforts. Qualified same-family replacements preserve stable seats and objection ownership.
- Invalid, oversized, duplicated, or incomplete configuration fails before launch. A model-family mismatch cannot reduce the three-family review requirement.
- Editing or deleting the original YAML cannot change an existing run or its recovery. A corrupt saved configuration blocks instead of using current defaults.
- A configured model or effort change requires matching policy, catalog, and route evidence. Old-model qualification never qualifies its replacement.
- A roster without Astra avoids a false Astra caller conflict. A configured Astra judge still requires its own available slot.
- Unsupported effort, missing effective-setting evidence, exhausted allowance, and permission denial have distinct outcomes.
- Cancellation, timeouts, connection loss, and temporary-file loss preserve the correct unknown or blocked state.
- All owned resources have inspected settlement and cleanup evidence before operational completion.
- Language correction preserves technical facts, uncertainty, exact literals, and the recorded scope.

Synthetic tests establish control behavior. They do not qualify a live provider route or prove recommendation quality.

Before real use, qualify each exact model, effort, host, transport, and action class. Start with supplied-packet read-only fixtures.

Native edits, managed AGY modes, unattended approvals, and unexposed Ultra descendants are outside that qualification.

## Work left to the builder

The implementation plan must define schemas, module boundaries, package layout, CLI syntax, dependency pins, and installation steps.

It must map the adapter contract to the installed Orca capabilities. Any missing required capability remains a reported gate.

The builder must preserve the configured roles and defaults, two shared clarification batches, three deliberation rounds, unanimous acceptance, and fresh judge without override authority.

Implementation, live council qualification, global skill installation, Git initialization, and policy changes remain outside this design-writing task.

## Sources and local requirements

- Model policy: `/Users/aaat/.agents/policies/model-policy.md`.
- Orca CLI skill: `/Users/aaat/.agents/skills/orca-cli/SKILL.md`.
- Orchestration skill: `/Users/aaat/.agents/skills/orchestration/SKILL.md`.
- Handoff skill: `/Users/aaat/.agents/skills/handoff/SKILL.md`.
- Language skill: `/Users/aaat/.agents/skills/simplified-technical-english/SKILL.md`.
- XState guards: <https://stately.ai/docs/guards>.
- XState persistence and invocation restoration: <https://stately.ai/docs/persistence>.
- Official ASD-STE100 overview: <https://www.asd-ste100.org/about_STE.html>.
- Official ASD guidance for tools: <https://www.asd-ste100.org/STEsoftware.html>.

Current observations: Orca CLI `1.4.237`; AGY CLI `1.4.7`. A previous Argon assessment returned a report but required forced process cleanup.

That nonzero exit remains recorded. New assessment fixtures do not qualify the full Council transport, Ultra controls, or unattended shutdown.

## Design check status

The user approved the base design on 2026-10-23 and the configuration/shared-clarification revisions on 2026-10-24. This integrated document records the coordinator's additional implementation choices for user review.

Fresh Opus Low and Argon High opinions returned PROCEED_WITH_CHANGES. Their source-checked findings and the applied corrections are recorded in [the shared-clarification review](../reviews/2026-10-24-the-council-shared-clarification-review.md). Complete-packet and focused checks confirmed their end markers. No earlier READY verdict is transferred to this revision, and no post-correction whole-artifact READY verdict is claimed.

Static checks validate the four canonical diagrams, 17-state parity, document links/fences, and intended guard-case enumerations. The SVG/PNG maps are illustrations, not runtime or native Mermaid proof.

Implementation, dependency installation, live Council transport qualification, and deployment have not started. Existing base/configuration reviews remain historical evidence in the reviews directory.
