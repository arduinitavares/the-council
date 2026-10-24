# Shared clarification design and plan review

Scope: the 2026-10-24 design, eight-task implementation plan, and four diagrams. This is planning and assessment only. No Council application, dependencies, installation, or deployment was created.

## Sources and route

Baseline: `master` at `3c4510e153dc0cf2b8353c83eeadd8fff1533729`, with the existing task-owned documentation/inventory work preserved.

The user requested `claude-opus-5-5-low` with effort `low`, and `gemini-4-argon-high` with effort `high`. Each received a fresh independent supplied-text assessment through an owned Orca terminal. Each full review pair received identical source packets for its recorded revision. Follow-up packets also supplied common regression scenarios.

Execution host and actual cwd: local macOS, `/Users/aaat/projects/the-council`. Orca workspace: `a7a80763-17f4-4250-9180-7cf8ddfad5a6::/Users/aaat/projects/the-council`. Orca `1.4.237`, AGY `1.4.7`.

Mode and containment were recorded separately: ordinary `plan`, terminal sandbox enabled, exposed permission mode `request-review`, no new roots/grants/settings. Both exact models were in the current catalogue. Backend effort beyond explicit argv/tiered IDs remains provider-managed and unexposed. Allowance was not exposed by the catalogue; each review was bounded to 20 minutes. No helper, tool, write, permission, or billing action was authorized to the reviewers.

These are custom-terminal assessments with process ownership. They have no invented Orca Run/Task/Dispatch authority and do not qualify the full Council transport.

## Initial opinions

Both returned `PROCEED_WITH_CHANGES`.

- [Opus Low report](2026-10-24-shared-clarification/opus-low-review.md).
- [Argon High report](2026-10-24-shared-clarification/argon-high-review.md).
- [Source hashes, exact settings, transcripts' event types, and lifecycle receipts](2026-10-24-shared-clarification/evidence.json).

The initial manifest's historical-status exclusion note was too broad: plan review status was omitted, but the spec's historical design-check status remained in the first packet. The follow-up packets omit both status sections. Neither reviewer received the author's conversation or the other reviewer's response during the initial assessment.

## Finding dispositions

| Finding | Source check and final decision |
| --- | --- |
| Opus F1 / Argon C-02: dependent questions can disappear or deadlock | Accepted. Preserve deferred originals and their blocking flags. Batch compilation receives the prior ledger and promotes eligible questions even when a seat returns readiness. At batch two, deferred blocking items remain unresolved. Tasks 1–2 and 4 contain explicit tests. |
| Opus F2 / Argon C-01: late answers can return to clarification | Accepted. Initial-review and ballot barriers freeze a round-origin question batch. Answer publication checks origin and remaining rounds; it cannot return deliberation to clarification. Tasks 2, 4, and 7 own the contracts and tests. |
| Argon C-02: answers after finalization have stale bindings | Accepted. A distinct `AnswerRevision` binds the current published context, appends known-question answers with predecessor references, and preserves history. It adds no inference wave. Old batch resubmissions remain invalid. Tasks 1, 4, and 7. |
| Opus F3 / Argon C-04: live candidate inbox can stall | Accepted. The current owner consumes the inbox before effects, at barriers, and while waiting for a candidate, with a maximum 1,000 ms poll. Consumption/checkpoint commits precede acknowledgment. Tests include live delivery and an owner-exit race. Task 7. |
| Argon C-04: settled remedy waits charge overnight time or lack a return edge | Accepted. Intentional waits in `needs_user`, `needs_context`, and user-remedy `blocked` pause only after external resource settlement. Saved-phase preflight return edges preserve valid results and unissued effects; they never repeat an issued inference. Unknown lifecycle keeps charging. Tasks 2 and 7. |
| Opus F4: watchdog ownership is incomplete | Accepted. Every stop-only watchdog has a stable resource key, identity, deadline binding, and launch/exit receipts. It and its children participate in reconciliation and settlement. It has no coordination or launch authority. Tasks 3, 5, and 7. |
| Opus F5: invalid-output recovery is ambiguous | Ambiguity accepted. The proposed replacement-inference feature is excluded from version one. Invalid output settles and terminally blocks inference for that run with `INVALID_WORKER_RESULT`; resume/extensions cannot reuse its slot. A separately authorized new run retains the failure as provenance. This keeps the base 27-call contract small. Tasks 1–2, 5, and 7. |
| Argon C-03: a ballot can open and close a new objection | Accepted. New objections start open; dispositions reference only the frozen input IDs. Any new ballot objection prevents consensus in that round. Initial review objections enter the shared ledger before candidate/judge input. Tasks 1–2 and 7. |
| Opus M1: AGY 1.4.6 warning is historical | Qualified. Label it as a version-specific observation; current-version qualification remains required. The present 1.4.7 sessions expose the requested plan command without the conflicting flag. |
| Opus M2: source-only answers and the second wave | Accepted clarification. A wave containing questions still leads to wave two after finalized source answers. Only a truly all-ready wave can skip the remaining allowance, with no earlier blocking issue. |
| Opus M3: accepting payload with an open objection | Consensus already fails. New objection schemas now require open status and forbid same-ballot closure. Structurally valid contradictory acceptance remains recorded evidence and cannot create assent. |
| Argon note 1: missing evidence requires a structural guard | Accepted. Candidate acknowledgment IDs cover material unverified/invalid evidence. Materiality is a recorded coordinator input; the pure guard checks IDs, while the judge evaluates arguments. An acknowledgment cannot waive denial. |
| Argon note 2: explanatory all-ready path lacks the blocking outcome | Accepted. Added the ready-to-limit edge for an earlier unresolved blocking item. The normative state guard checks the complete ledger. |

## Follow-up checks

The second independent checks also returned `PROCEED_WITH_CHANGES`. Both reported source truncation inside the fourth explanatory diagram, so those checks are not claimed as full-packet coverage.

- [Second Opus report](2026-10-24-shared-clarification/opus-low-check-review.md).
- [Second Argon report](2026-10-24-shared-clarification/argon-high-check-review.md).

Their accepted corrections add: a settled-pause reconciliation path; valid-exited-result recovery to the saved phase; a full-ledger consensus guard; retained objections/dispositions before question diversion; effective extension and issued-task ledgers; trusted clock receipts and pure reducer-owned budget accounting; explicit post-limit revision routes; and one answer per original question ID. All formal late question entries divert a round, including nonblocking/source-answerable ones. This is a documented coordinator choice.

The third packet preserves the full source bodies, compacts JSON whitespace, omits historical status and inapplicable policy commentary, and adds a unique marker at its end. Opus reproduced the marker and explicitly confirmed complete receipt, including the closing diagram JSON and README. Its remaining findings were:

| Finding | Correction |
| --- | --- |
| F1: ambiguous publication guard | Parenthesized the unresolved-item condition and made effective round exhaustion explicit. |
| F2: unspecified evaluation trigger | Chose explicit journaled `EVALUATE_ROUND`, with stable intent/event identity and a clock receipt. All 17 states remain stable checkpoints; `prepare_round` uses explicit `ADMIT_ROUND`. Updated the two-event test. This uses the reviewer's explicit-event alternative. |
| F3: source-only clarification path | Added the explanatory source-only barrier-to-publication edge. |
| F4: `respond` read path | Added Task 3's read-only `RunReader`. Pre-enqueue validation is advisory; transactional consumer validation is authoritative. |
| F5: watchdog slot counting | Clarified that model-free stop-only watchdogs are owned resources, rather than model workstreams. They still require settlement. |

The third Argon report also reproduced the marker and confirmed complete receipt. It returned PROCEED_WITH_CHANGES and prompted the following accepted corrections:

| Third Argon finding | Correction |
| --- | --- |
| F-01: active ContextUpdate has no complete route | Added settled-barrier diversion to preflight, priority over old-context advancement, and retention before a last-round unresolved report. |
| F-02: direct admission and extended clarification gaps | Every round admission checks the full ledger/effective limits. Clarification continuation uses the current wave and effective allowance, including authorized batch three. |
| F-03: recovery origin and fresh preflight | Captured reconciliation origin separately from pause target, preserved it on repeated restore, and required current admission before any new resumed launch. |
| F-04: pre-launch crash is indistinguishable | Added durable pending_execution/dispatched/receipt_recorded stages. Only pending is provably unsent under the qualified fence protocol. Dispatched-without-receipt remains uncertain. Reservations still count at intent. |
| F-05: raw wire and ledger schemas conflict | Split raw and bound records, namespaces and dependency references. Added LaunchReservation before actual transport authority exists. First deferred answers use null predecessor IDs; replacements identify the prior answer. |

The final focused pair reviewed these changed contracts and the complete canonical graphs. Both reproduced the closure marker, returned PROCEED_WITH_CHANGES, and exited normally with unchanged settings and no remaining owned processes.

- [Complete-packet Opus opinion](2026-10-24-shared-clarification/opus-low-final-review.md).
- [Complete-packet Argon opinion](2026-10-24-shared-clarification/argon-high-final-review.md).
- [Focused Opus opinion](2026-10-24-shared-clarification/opus-low-closure-review.md).
- [Focused Argon opinion](2026-10-24-shared-clarification/argon-high-closure-review.md).

Final focused finding dispositions:

| Finding | Applied correction and direct check |
| --- | --- |
| Both: all-ready wave can stall with an earlier blocker | All-ready unresolved blocking items settle even with unused extended allowance. Source-only waves explicitly use answer_batch; an empty all-ready publication preserves context hash/revision. The publication cases include this counterexample. |
| Opus: normal advancement competes with ContextUpdate | Every ordinary advancement/question-diversion guard excludes an accepted pending update. Eligible controls are consumed before EVALUATE_ROUND. Global failure/cancellation/lifecycle handlers remain distinct. |
| Argon: preflight publication/collection/limit overlap | Specified priority for publication, staged collection, open-batch wait, then legal continuation. Ordinary returns exclude earlier routes/open batches. Round exhaustion applies to a new round, not a legal saved phase inside admitted round three. |
| Argon: incomplete origin capture and early target clearing | Both restore and reducer entries capture origin, and self-reconciliation preserves it. Every pause records a target. Targets survive intermediate publication and clear only when entered. Initial preflight recovery needs ownership, rather than a nonexistent earlier pause target. |
| Opus: prepare-round conjunction can be misread | Parenthesized every full-ledger/limit prerequisite around the complete alternative set. |

No reviewer verdict was relabelled READY. These final bounded corrections were applied from the fresh independent findings and checked directly; no further whole-artifact model pass is claimed. The implementation plan remains subject to the user's review before execution. Live qualification remains separate.

## Verification and lifecycle

Direct design checks enumerate [288 publication cases](2026-10-24-shared-clarification/design-guard-cases.json) and [384 preflight continuation cases](2026-10-24-shared-clarification/preflight-guard-cases.json), each with one selected continuation. These enumerate intended specification predicates; they do not execute XState or prove the future implementation.

The canonical Mermaid v2 model validates and exports under compatibility profile `11.16.1`. Its 17 state IDs match the design table. Four readable SVG/PNG maps were visually inspected. Task checklists are sequential, Markdown fences/local links validate, and `git diff --check` passes.

These are static documentation checks. No runtime tests were run because no implementation exists. The illustrations are separate SVG layouts; they do not prove native Mermaid rendering or XState execution.

The disposable Argon settlement fixture returned its expected text, exit code `0`, unchanged settings, no remaining owned process, and a returned shell prompt. Its terminal was closed. Both initial reviews likewise had final provider `SUCCESS`, exit code `0`, unchanged settings, no remaining owned process, returned shell prompts, and confirmed terminal closure. Only `user_input` and `agent_response` step types were observed.

The first-review wrappers' `final_event_seen` flag remained false because process exit preceded the next scan. The final `result` records were inspected independently before acceptance. The follow-up wrapper also inspects the complete transcript after process exit. Raw receipts are retained; no exit was relabelled.

Full Council orchestration, exact default Ultra descendant controls, live evidence access, and installation remain qualification/deployment gates in Tasks 5 and 8. A successful supplied-text opinion is not that qualification.

The second Argon check returned its report with provider `SUCCESS`, but the CLI remained live beyond the 30-second final-result grace. The owned watchdog used SIGINT, SIGTERM, then SIGKILL. Its actual exit `-9`, observed CodeGraph support children, unchanged settings, empty remaining owned-process list, returned shell prompt, and confirmed terminal closure are retained. This was controlled cleanup, not a normal-completion transport qualification.

All nine assessment jobs (eight opinions/checks and one disposable fixture) have a retained result and positive process settlement. Every owned terminal was read at its returned shell prompt and closed. One Argon check required forced cleanup with exit -9; the other jobs exited 0. No model tool-call step was observed.
