# The Council builder check

Date: 2026-10-23
Status: Fresh revised-design check completed. No material planning questions remain. User design approval is pending.

## Evidence

- Route: supplied-text Antigravity assessment in an Orca-owned terminal on the local Mac.
- Model: `gemini-4-argon-high`. Requested effort: `high`. The exact High model was exposed by the provider.
- Planning mode: the provider reported the system `plan` command as active. Terminal sandbox was enabled.
- Scope: supplied document only. No native tools, project reads, commands, writes, or helpers were requested.
- Conversation: `f3039e5a-7035-4fcf-9e35-07b4e522aa6f`.
- Orca terminal: `term_7fff123d-36d3-4089-a239-be8f513f34cc`.
- This custom terminal has terminal/process ownership. It has no Task or Dispatch identity.
- Original document SHA-256: `e2f11a6209ac5f7f619f07783786dac8c6baec58d23f3d40ce6c82477ad9ffdc`.
- Source revision: `307fbd79a925d3cf9b45c64603088b71c1c3c319`.
- Final status: `SUCCESS`. Provider exit and terminal exit: `0`.
- Settings bytes stayed unchanged. The Council folder remained outside Antigravity's trust list.
- This qualifies supplied-text assessment only. It does not qualify native file tools, edits, Astra Ultra, or the complete Council runtime.

## Reviewer questions

1. **Candidate compilation in `prepare_candidate`**
   - **Question:** Who compiles the single `candidate` from the three reviewer outputs in `prepare_candidate`, and how does that actor resolve competing proposals?
   - **Why this changes the plan:** The design specifies up to seven inference tasks per round: three initial reviews, one `judge`, and three final responses. It also states that the XState runner is deterministic and that all reviewers must accept the same recommendation. If deterministic runner code compiles the `candidate`, the plan needs a mechanical rule when Round 1 reviewers propose incompatible solutions. If an LLM synthesizes the `candidate`, the plan needs a coordinator callback or an eighth inference task and model policy rules.

2. **Establishing `verified` status for `evidence` records**
   - **Question:** What mechanical check in the runner or Orca adapter establishes `verified` status for an `evidence` record?
   - **Why this changes the plan:** The design states that a model assertion alone cannot establish `verified` status. It also states that source retrieval and checks use the authorized adapter, while model output cannot authorize new commands. If workers run checks inside Orca sessions, the adapter must inspect and validate Orca execution logs or terminal receipts. If the runner executes pre-authorized checks on the host, the plan needs a host-side execution and hashing module.

3. **Ownership handoff and active `gpt-6-astra` caller conflicts**
   - **Question:** When an active `gpt-6-astra` caller invokes the skill without additional-concurrency authorization, how does the ownership handoff release the caller slot?
   - **Why this changes the plan:** The design limits `gpt-6-astra` to one active session by default and counts a waiting caller as active. If the caller exits after starting the runner, the plan needs a detached background runner mode. If the skill transfers control to a non-Astra agent through Orca, the plan needs an agent handoff workflow before `preflight`. If the runner stops at `blocked` until the user resumes elsewhere, the CLI only needs foreground execution.

4. **Withdrawing or resolving an `objection` during `confirming`**
   - **Question:** Can a reviewer withdraw or resolve its own open `objection` in its `confirming` response after `prepare_candidate` freezes the round input?
   - **Why this changes the plan:** The design freezes the `candidate` and `objection` record before `judging` and `confirming`. Consensus requires that no reviewer retains an open `objection` to that `candidate`. If a `confirming` response can close the owner's prior `objection`, `evaluate_round` must update `objection` state before the consensus guard runs. Otherwise, any round that enters `confirming` with an open `objection` cannot reach consensus without an extra round.

5. **Delivering the syntax-only correction retry for malformed worker output**
   - **Question:** Does the adapter send a syntax-only correction prompt to the same open Orca worker session, or does it launch a new worker task?
   - **Why this changes the plan:** The design permits one syntax-only correction under the same assignment and avoids unqualified session-resume routes. If the adapter reuses the live Orca session, it must validate output schemas before it settles the worker. If the adapter starts a new task after settlement, the effect registry needs a retry sub-attempt key and prompt format.

6. **Early pause on unanimous missing-fact reports and round counting**
   - **Question:** When all three reviewers report the same missing fact, does the runner pause immediately after `reviewing`, and does that pause consume one round?
   - **Why this changes the plan:** The design sets a default limit of three complete rounds and allows missing-input requests before round three. Pausing immediately after `reviewing` skips unnecessary `judging` and `confirming` tasks and requires a transition from `reviewing` to `needs_user`. Resuming without consuming a round changes the round counter logic in `prepare_round` and `evaluate_round`.

## Coordinator dispositions

These are explicit design choices for user approval. They do not change the confirmed model roles or acceptance rule.

| Question | Disposition |
| --- | --- |
| Candidate compilation | The current calling agent compiles the candidate. The runner yields a structured request and accepts a validated candidate submission. No eighth worker is launched. |
| Evidence verification | A coordinator-owned adapter performs allowed source retrieval and declared checks. `verified` means provenance and observed result, while claim support has a separate assessment. |
| Astra caller conflict | Version one blocks before launch. It offers non-Astra resumption or specific concurrency authorization. It performs no automatic ownership handoff. |
| Objection closure | An owner can append a closure in its final response. The runner applies all dispositions before the consensus guard. Frozen input snapshots remain immutable. |
| Format correction | One fresh correction sub-attempt can follow a settled original attempt. It retains the logical assignment and must preserve an unambiguous original decision. There is no unqualified session resume. |
| Early pause | A round counts when its first initial-review inference starts. A unanimous missing-input pause skips later phases but consumes that admitted round. New input uses a new round. |

The default three rounds permit at most 21 logical worker tasks and 42 worker attempts when every output needs its one permitted format correction.

The calling agent's synthesis is additional model work in its existing session. Qualification runs remain separate, explicit prerequisites.


## Fresh revised-design check

- Model: `gemini-4-argon-high`. Requested effort: `high`.
- Conversation: `c43422e7-62b7-4f8f-b4cc-5a1312b78602`.
- Orca terminal: `term_3d109b85-20f1-466b-aca4-c3ad65e2b40e`.
- Reviewed design SHA-256: `e8a403cdd1c42adbe83921660d2b1995fb389d6a4205bb6df48d928f9919be4c`.
- Final response: `nothing important left`.
- Final status: `SUCCESS`. Provider exit and terminal exit: `0`.
- Exposed steps: user input and agent response only. No tool or helper calls appeared.
- Planning mode was active. Terminal sandbox was enabled.
- Settings bytes stayed unchanged. The Council folder remained untrusted.
- The provider process exited. The coordinator closed the owned terminal after verification.

This result closes the builder's six planning questions. It does not approve implementation or qualify the full Council runtime.

After this check, the coordinator updated only the design's status and review-evidence paragraphs. The substantive design stayed unchanged.
