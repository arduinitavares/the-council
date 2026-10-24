# Independent review: The Council design, implementation plan and canonical diagrams

**Verdict: PROCEED_WITH_CHANGES**

I reviewed only the numbered source in the packet. I used no tools, read no other files and ran no tests. This review does not certify any live transport.

The design, plan and canonical diagram agree on the main points:

- The model defaults are unchanged.
- The `council.yaml` roster is frozen for each run.
- Clarification and deliberation use separate counters.
- The call limit is 27: 6 clarification calls plus 21 deliberation calls.
- No model is called to repair formatting.
- Evidence completes before candidate synthesis.
- New objections in final responses (ballots) block consensus.
- The judge has no vote and is fresh each round.
- Every phase settles before the next starts.
- The XState core is pure, and model judgment stays outside it.
- The human-wait budget pause, owner-based resume and current-policy rechecks are specified.

I found no blocking contradiction. Five medium findings need small corrections before implementation starts.

## Material findings

### F1: Dependent follow-ups in batch two have no defined outcome (Medium)

**Source:** design L269, L277, L293, L295; plan L200, L238; clarification diagram edges at JSON L783–L790.

**Problem:** A follow-up question that depends on a batch-two answer is deferred "to the next batch." No next batch exists after batch two. Deliberation then starts directly.

**Failing scenario:** In batch two, the Gemini seat asks a blocking question Q2. It also asks a blocking Q3 that depends on Q2's answer. The user answers Q2. Q3 is deferred, so it never reaches the ledger. The guard at L295 checks only questions in the ledger, so deliberation starts with a known blocking question unasked. Alternatively, an implementation may drop Q3 without a record.

**Correction:** State that a deferred blocking follow-up at the clarification limit is recorded in the ledger as unresolved. It then routes to `needs_user` with reason `CLARIFICATION_LIMIT`, or the user can approve a bounded extension. Add a test to Task 2 Step 5 and Task 4 Step 8.

### F2: Late answers during deliberation have an unclear publication path (Medium)

**Source:** design L305–L309; diagram transitions at JSON L258–L261, L292–L295; plan L201.

**Problem:** A missing-input question raised in round N is answered after a settled pause. On resume, the only answer-publication edge is `preflight → publishing_answers`, labelled "finalized queued answers for saved batch." The outgoing guards from `publishing_answers` refer only to clarification batches ("wave one", "final batch").

**Failing scenario:** The answers are published, and the guard sees "batch one had questions, follow-up allowance remains." It sends the run to `clarifying`. This is the free return to clarification that L309 forbids. An implementer could also take `preflight → prepare_round` without publishing a new context revision. Either way, the counter or equal-information rule breaks.

**Correction:** Give each answer batch an origin of `clarification` or `deliberation(round)`. Add a mutually exclusive guard: a batch with deliberation origin goes `publishing_answers → prepare_round` (round N+1) or to `settling` when no rounds remain. Never route it to `clarifying`. Update the label on the diagram edge.

### F3: A live controller has no defined way to consume the inbox (Medium)

**Source:** design L95, L488–L496; plan L337, L342, L348–L350.

**Problem:** Candidates and answers enter only through `respond`, which writes to the durable inbox. Only `resume` is specified to consume the inbox. While a candidate is requested, the controller is still running and owns the run. Candidate synthesis is active work, not a human wait (L582).

**Failing scenario:** The caller enqueues a candidate while `start` is still in `prepare_candidate`. Nothing tells the live controller to read the inbox. The run then either stalls until the budget expires, or the caller kills the controller and resumes. A kill is an unsettled exit, so time keeps charging and reconciliation is needed. There is also a race: if the controller is exiting, `resume` might see no positive settlement from the previous owner.

**Correction:** Specify that the active owner polls or watches its inbox at every phase barrier and during `prepare_candidate`, in bounded waits. The owner consumes requests in a transaction and acknowledges them. Add a test to Task 7: a candidate submitted to a live controller is applied exactly once, with no restart.

### F4: Per-worker watchdogs are owned processes the design does not list (Medium)

**Source:** plan L291 and L370 (a watchdog that "survives loss of the coordinator process"); design L67, L213, L460, L465.

**Problem:** A detached watchdog is a second, long-lived owned process. The design bans hidden detached coordinators. Settlement must cover every owned resource, but the effect registry and settlement list do not include watchdogs.

**Failing scenario:** The controller crashes. The watchdog stops the worker at its deadline. On resume, reconciliation checks only the worker. The run reaches `completed` while an orphaned watchdog, or its unrecorded stop action, remains. Or two watchdogs exist after a replay. Either way, "every owned resource settled" is not actually true.

**Correction:** Record each watchdog as an owned resource. Give it an effect key, launch and settlement receipts, and limit it to stop-only authority over one attempt. Include it in reconciliation and settlement. State in the design that it is a deadline enforcer, not a coordinator. As an alternative, make Orca's own per-task deadline the enforcer when Orca offers one.

### F5: An invalid worker result has no defined path to recovery (Medium)

**Source:** design L299, L333, L516, L554; plan L22, L292.

**Problem:** One malformed output blocks the seat, and no retry exists. The text does not say whether the run ends as `blocked`, or whether a bounded extension can admit one replacement call for that same logical task. It also does not say how that call is counted against the 27-call limit.

**Failing scenario:** The Claude seat returns truncated JSON in round 2. The run reaches `blocked`. The user approves an extension. One implementation reuses the call reservation from the failed attempt. Another relaunches all three reviews and admits a free round. The counters can then disagree with the reported limit.

**Correction:** State that a correction after an invalid result needs a bounded extension record. That extension adds explicit call slots and reruns only the affected logical task, with a new attempt ID and the same frozen inputs. The extra call counts above the base 27, and the report shows it. The round counter stays the same. Add a test to Task 7 Step 8.

## Minor findings (non-blocking)

- **M1 (plan L289):** The plan cites a behavior of AGY `1.4.6`. The design's current observation is AGY `1.4.7` (design L696). Treat the `1.4.6` statement as unverified until the requalification step confirms it.
- **M2 (design L265, L291):** A wave answered entirely from sources still counts as a batch. Batch one could therefore end with no human answers. State whether batch two still runs automatically after a batch answered only from sources. The diagram suggests that it does.
- **M3 (plan L127):** The `Ballot` type permits `decision: 'accept'` together with open new objections. This contradiction is already blocked at the consensus guard (design L391). A schema-level rule would make it fail earlier and more visibly.

## Items checked with no defect

- **Counting:** The 27 calls, the separate counters, reservation at the first launch intent, and no free repeat after an uncertain start are consistent.
- **Answer handling:** Partial drafts launch nothing. Unknown and declined statuses are recorded. Only the common ledger exists, with no private answers.
- **Evidence before synthesis:** The candidate request cannot occur while any evidence request is pending (design L319; plan L201, L368).
- **Phase settlement:** The reviewer → judge → reviewer order prevents concurrent use of Astra under the default roster. A caller running Astra causes a block before launch, which is a documented remedy, not a defect.
- **Clock and owner safety:** Monotonic time is used within a process. A wall-clock regression blocks new inference. A crash continues charging time. An owner change needs positive evidence.
- **Determinism:** The core claims determinism only for replaying an event history, not for model output.
- **Current policy:** Resume rechecks it. Ultra and extra Astra slots need recorded approval with a bounded scope, which matches the host policy.
- **Model defaults:** They are preserved exactly in the YAML, the table, the plan and the diagrams.

## Remaining qualification limits (documented gates, not defects)

- No live route is qualified for Astra Ultra (reviewer or judge), Argon High, or Opus High through Orca with real Run/Task/Dispatch authority, settled lifecycle and descendant control.
- Ultra needs a separately verified route that controls descendants. If that is not available, the default roster stays blocked (`UNQUALIFIED_ROUTE`).
- The previous Argon assessment needed forced cleanup and exited nonzero. Unattended shutdown is not qualified.
- Any model replaced in the YAML needs its own qualification.
- Three hours of active work is not promised to cover all 27 calls.

## Unresolved design points

1. How deferred blocking follow-ups are handled at the clarification limit (F1).
2. How answers from deliberation are routed and published (F2).
3. How a live controller consumes the inbox (F3).
4. Whether watchdogs are owned resources (F4).
5. How a correction after an invalid result is counted (F5).
