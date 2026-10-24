# The Council design

Date: 2026-10-23

Status: Approved by the user on 2026-10-23 after a fresh independent builder check. Implementation planning is authorized. This document authorizes no implementation or installation.

Revision: On 2026-10-24, the user authorized `council.yaml` for reviewer and judge selection, with the current models as defaults.

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
- Three rounds are the default limit. Remaining disagreements return to the user.
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

Edits to `council.yaml` apply only to new runs. There is no hot reload or mid-run model replacement, including during format correction.

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

## One round

Each round has one candidate proposal and one fresh judge. A candidate has an immutable version and content hash.

1. Three fresh reviewer tasks examine the common round input. Round one requests independent solutions before reviewers see the other outputs.
2. The coordinator publishes all three outputs in a stable seat order. Later rounds include the preceding arguments and unresolved points.
3. The coordinator compiles one candidate from those outputs. It preserves alternatives, objections, assumptions, and amendment provenance.
4. The candidate and evidence bundle become immutable for this round. All initial reviewer tasks settle.
5. A fresh configured judge checks the frozen material. It returns evidence assessments and specific challenges. The judge then settles.
6. Three fresh reviewer tasks receive the identical candidate, evidence bundle, judge report, and objection record.
7. Each reviewer responds to the challenges and submits its own explicit acceptance or rejection of that exact candidate.
8. The runner validates all responses. It either records consensus, starts the next permitted round, or returns the unresolved points.

Fresh final-response tasks avoid relying on an unqualified session-resume route. They retain the same three logical reviewer seats.

This can require seven logical worker tasks per round: three initial reviews, one judge, and three final responses. Three rounds can require 21 tasks.

The calling agent's synthesis uses its current session. It is additional model work, but it does not create an eighth worker entry.

Each logical worker output permits at most one fresh format-correction attempt. Therefore, three rounds can require at most 42 worker attempts.

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

The adapter services those requests before candidate freeze. It uses only the preflight's allowed sources, exact commands, working directories, and declared effects.

For a source, it records the retrieved content hash and location. For a command, it records the execution receipt and output hash.

It checks those observations against the permitted request. Unknown outcomes and mismatches cannot receive `verified` status.

The first version does not rely on workers to execute checks. An evidence request cannot authorize a new host command or access grant.

A request outside the declared scope requires a user decision or remains unverified. Material missing evidence blocks candidate freeze unless the candidate states the uncertainty.

The judge explains how each cited source supports the claim. It checks contrary evidence and states source-access limits.

Source retrieval and checks use the authorized adapter. Untrusted text remains data. It cannot change model routing, scope, or permissions.

An objection states the disputed claim, supporting evidence or missing evidence, and a condition that would resolve it.

An objection remains open until its owner explicitly withdraws it, records a supported resolution, or rejects the candidate because it remains unresolved.

An objection cannot disappear because the coordinator summarizes it differently. All reviewers receive the complete current objection record.

The round input contains an immutable objection snapshot. A final reviewer response can append a disposition for that reviewer's own objection.

The runner collects all final responses before it applies their disposition events. It then evaluates the consensus guard against the resulting objection state.

Other seats cannot close that objection. All dispositions remain in the event history. A new objection prevents consensus for that candidate.

A closure can cite only the frozen evidence and candidate. A material new fact or candidate amendment requires the next round.

The judge's challenges are visible to all reviewers. Each reviewer must address them in its final response.

The judge does not own a veto. The reviewers can reject a judge argument with stated evidence and reasons.

The final report preserves that exchange. It must not describe a disputed fact as proven merely because all reviewers accept a recommendation.

If evidence cannot establish a fact, the candidate can state an explicit assumption and its consequences. All reviewers must accept that same assumption.

A new assumption introduced only in a final response changes the candidate. That response is not unconditional acceptance.

## Exact consensus rule

Consensus requires all of the following:

- Exactly one current, valid final response from each configured reviewer seat.
- Every response belongs to the same run, configuration hash, round, candidate hash, evidence bundle hash, and judge report hash.
- Every reviewer explicitly accepts the candidate and its stated tradeoffs, assumptions, and uncertainty.
- No reviewer retains an open objection to that candidate.
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

The adapter turns external observations into validated events. Deadlines enter as recorded timer events. Generated identifiers enter as recorded values.

A single coordinator owns event acceptance. It collects parallel reviewer responses behind a phase barrier. It publishes them in stable seat order.

This avoids giving the first response extra authority. Raw arrival order remains available for operational audit.

### Principal control states

| State | Exit condition or result |
| --- | --- |
| `preflight` | Policy, workspace, models, allowance, access, and ownership are qualified |
| `needs_context` | User or caller supplies a valid missing input |
| `prepare_round` | Immutable round input is available |
| `reviewing` | All three initial review tasks settle with valid results |
| `prepare_candidate` | Candidate and evidence bundle are frozen |
| `judging` | The fresh judge settles with a valid report |
| `confirming` | All three final-response tasks settle with valid results |
| `evaluate_round` | Pure guards choose consensus, another round, or unresolved |
| `reconciling` | Existing worker and effect state is positively established |
| `needs_user` | The unresolved report identifies the required user decision |
| `blocked` | An operational, permission, policy, or evidence-access gap prevents progress |
| `settling` | Every owned provider resource has an inspected cleanup outcome |
| `completed` | Consensus report is available and cleanup is settled |
| `cancelled` | Cancellation is recorded and owned resource settlement is established |

Operational state and decision outcome are separate fields. An unresolved decision can have fully settled resources.

A useful model result with unknown process state is not operationally complete.

### Event validity

Each event carries an event ID, run ID, phase, round, seat, active attempt ID, and schema version where applicable.

Provider events also carry real Orca Task and Dispatch identities when the chosen transport provides them.

The adapter validates correlation against the launch registry. It does not trust identity claims contained only in model-authored JSON.

The adapter acknowledges duplicate delivery IDs after it processes them. It does not apply their effects again. Conflicting payloads under one identity stop reconciliation.

The runner retains late responses from a superseded attempt as evidence. They cannot change current acceptance.

A malformed result permits at most one syntax-only correction under the same assignment. This rule permits no retry of a denied action.

The original attempt must settle first. The adapter then starts a fresh session for a format-correction sub-attempt under that logical assignment.

The effect registry links the correction to the original attempt and raw response hash. The adapter does not resume an unqualified provider session.

The correction receives the original response, output schema, and frozen identity bindings. It must preserve the original decision and all material literals.

The validator accepts a correction only when the original content and decision are unambiguous. A changed or guessed decision blocks the seat.

The correction counts toward the invocation's worker-attempt limit. It creates no new proposal or deliberation round.

Unresolved malformed output blocks that seat. It never becomes a negative vote or a substitute model.

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

The default maximum is three admitted rounds. A round becomes admitted when its first initial-review inference starts.

A pause after that point consumes the round. It cannot create a free repeat. A pause before any inference consumes no round.

The maximum applies to proposal deliberation. There are no permission retries or hidden extra rounds.

Coordinator-proposed operational defaults are 30 minutes per worker attempt and three hours per invocation. The user can change them before launch.

These are observed deadlines, not provider token or billing caps. An expired deadline stops new inference tasks and begins the supported stop protocol.

The deadline remains active until owned resources settle. The runner must report any unknown or unverified shutdown state.

If all three initial reviews identify the same missing-fact or user-priority ID, the runner can pause immediately after `reviewing`.

That transition goes to `needs_user` without a judge or final-response phase. The admitted round still counts.

After new user input, the next candidate uses a new round and a new input snapshot. The maximum stays unchanged unless the user authorizes an extension.

Different free-text descriptions do not satisfy this guard. The runner uses shared issue IDs and explicit missing-input reports.

The unresolved report states the competing positions, supporting evidence, disputed assumptions, attempted resolutions, and smallest useful next step.

The user can choose a direction, supply evidence, stop, or authorize another bounded attempt. The recorded result remains unresolved until new valid reviewer assent exists.

Additional rounds are never automatic. A continuation preserves history, records its new limit, and rechecks policy, routes, ownership, and allowance.

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

The builder must preserve the configured model roles and shipped defaults, unanimous acceptance rule, three-round default, and fresh judge without override authority.

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

Current preflight observations: Orca CLI `1.4.237`; AGY CLI `1.4.6`. Versions alone do not qualify a route.

## Design check status

The coordinator completed a structural self-check and a language surface scan. The scan does not establish ASD-STE100 conformance.

A fresh Argon High builder check completed through a supplied-text Antigravity assessment in an Orca-owned terminal.

The reviewer identified six planning questions. This revision records the coordinator's choices for all six. The review record is in `../reviews/2026-10-23-the-council-builder-check.md`.

The provider used the exact High model, made no tool calls, and exited with code `0`. Settings bytes stayed unchanged.

The initial commit `307fbd7` now supplies the repository's base branch. The original terminal trust prompt was a separate startup issue.

The supplied-text route qualifies assessment only. A fresh check of the substantive revision returned `nothing important left`.

That check used a new Argon High session and made no tool calls. The provider and terminal exited with code `0`.

The coordinator then updated only status and review-evidence text. The user approved the design on 2026-10-23 and requested the implementation plan and state diagrams.

The 2026-10-24 configuration amendment supersedes fixed-model wording. A fresh Argon High review returned **READY**, with no material findings.

See [the configuration amendment review](../reviews/2026-10-24-the-council-config-review.md). Only status and review-evidence text changed after that review.
