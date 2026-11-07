# The Council

A deliberation system where an arbitrary roster of AI seats—each combining a harness, model, and temperament ("soul")—debates a topic using verifiable proof until reaching unanimous consensus or a bounded dissent report.

## Language

**Council**:
A single deliberation run over a Topic Handoff by a configured roster of Seats and a Judge, governed by a configurable round limit and minimum active-seat quorum.
_Avoid_: Session, workflow, pipeline, committee

**Topic Handoff**:
The immutable problem statement, context, and constraints submitted to the Council at the start of a run.
_Avoid_: Prompt, ticket, brief, input payload

**Council Preset**:
A named, reusable roster of Seats, Souls, and a Judge tailored to a recurring deliberation domain (such as architecture, product comparison, or security auditing).
_Avoid_: Profile, mode, pack, template

**Seat**:
An individual voting participant in the Council, defined by a unique ID, a Harness, a Model, and a Soul. Multiple Seats may share the same underlying Model and Harness if they have distinct Souls.
_Avoid_: Worker, agent, reviewer, member, slot

**Excused Seat**:
A Seat removed from active participation mid-run after hitting a quota limit or unrecoverable fault, while preserving all completed turns of the remaining Seats and locking any unwithdrawn Objection that Seat already raised.
_Avoid_: Dropped worker, killed agent, ignored member

**Soul**:
The pre-configured persona, temperament, reasoning posture, or domain lens assigned to a Seat that shapes how it argues and evaluates proof.
_Avoid_: System prompt, role description, temperature, personality

**Harness**:
The execution environment through which Orca launches and communicates with a Seat or Judge (such as Codex, Antigravity, or Cursor).
_Avoid_: Provider, wrapper, host, CLI

**Clarification Batch**:
A pre-deliberation question-and-answer cycle in which active Seats surface missing facts or ambiguities in the Topic Handoff and receive shared answers simultaneously.
_Avoid_: Pre-round, discovery phase, intake

**Deliberation Round**:
One full cycle of debate in which active Seats submit arguments and Proof, the Judge audits each Proof and synthesizes a Candidate from admitted Proofs, and every active Seat votes to accept or raise an Objection.
_Avoid_: Iteration, turn, step, epoch

**Proof**:
A structured, verifiable evidence record—with an ID, scope condition, kind (`check`, `citation`, `benchmark`, or `derivation`), verifiable source, and falsifiable statement—attached to a Seat's claim or Objection and marked `admitted` or `rejected` by the Judge.
_Avoid_: Justification, opinion, rationale

**Candidate**:
The proposed resolution statement synthesized by the Judge for the current Deliberation Round, where every clause cites one or more Judge-admitted Proof IDs and may partition the answer by context (such as different winners per use case).
_Avoid_: Draft, summary, synthesis, ballot

**Judge**:
A dedicated, non-voting participant with its own Harness, Model, and Soul that evaluates the truth of each Seat's Proof (`admitted` or `rejected`), synthesizes the Candidate strictly from admitted Proofs, and cannot vote or erase any Seat's Objection.
_Avoid_: Referee, arbitrator, tie-breaker, moderator, coordinator

**Objection**:
A formal, Proof-backed rejection of the current Candidate by a specific Seat; only the Seat that raised an Objection may withdraw it, and if that Seat becomes an Excused Seat, its open Objection remains preserved in the final Verdict.
_Avoid_: Veto, dissent comment, negative vote, blocker

**Verdict**:
The final outcome of a Council: either Unanimous Consensus (every active Seat accepts the Candidate, at least the minimum quorum of active Seats remains, and no Excused Seat holds an unwithdrawn Objection) or a Dissent Report (the final Candidate alongside every remaining active or Excused-Seat Objection and its Proof).
_Avoid_: Result, output, decision, conclusion
