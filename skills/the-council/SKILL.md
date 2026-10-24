---
name: the-council
description: Use when the user explicitly invokes $the-council or explicitly requests a Council run, continuation, inspection, or cancellation.
---

# The Council

Coordinate three equal reviewers and a separate fresh evidence judge for one explicit decision. The caller writes the candidate; only recorded, bound reviewer ballots establish consensus. An ordinary unrelated question does not authorize a Council launch.

Read [communication.md](references/communication.md) before presenting questions or processing answers. Read the repository's [runbook](../../docs/runbook.md) for commands, input fields, qualification limits, recovery, and installation gates.

## Prepare the decision

Require a topic and scoped handoff. Use the installed [handoff skill](/Users/aaat/.agents/skills/handoff/SKILL.md), preserving its OS-temporary location and sensitive exclusions. The CLI takes a structured `handoff` object and writes its own temporary handoff; use the authoritative `runInputSchema` and `handoffInputSchema` in the repository. Reference existing artifacts rather than copying unrelated conversation.

Before any launch, read the execution-host [model policy](/Users/aaat/.agents/policies/model-policy.md), [Orca CLI skill](/Users/aaat/.agents/skills/orca-cli/SKILL.md), [orchestration skill](/Users/aaat/.agents/skills/orchestration/SKILL.md), and their version-matched guides. Use [Simplified Technical English](/Users/aaat/.agents/skills/simplified-technical-english/SKILL.md) for packets and reports; preserve exact identifiers, citations, uncertainty, and protected text.

Require current exact-route qualification, observed allowance, containment, permitted model/effort and descendant controls, available slots, and positive prior-resource settlement. The shipped default Astra Ultra roles are configuration, not approval or qualification. Current production transport is unqualified and fails closed. Do not replace a model, route, permission, or missing receipt to make progress. See the runbook's deployment decision.

## Operate through the CLI

Use `node <skill-real-path>/scripts/run-council.mjs` followed by the real CLI argv. It resolves the built CLI through the script's canonical path, including a symlink installation. A missing build requires explicit project preparation; the launcher installs nothing.

```sh
node skills/the-council/scripts/run-council.mjs start --workspace /absolute/task/workspace --input /temporary/request.json --json
node skills/the-council/scripts/run-council.mjs inspect --workspace /absolute/task/workspace --run decision-1 --json
```

Supply `--config` only to `start`. Saved runs use their frozen configuration and method profile.

| Observed request | Caller action |
| --- | --- |
| `action_required: 'candidate'` | Read the frozen candidate inputs and evidence, author a candidate with assumptions, tradeoffs, uncertainty and required unverified-evidence acknowledgments, then submit the bound `candidate` control. |
| `action_required: 'questions'` or CLI `pendingQuestion` | Present the common batch and maintain exact answer records as described in the communication reference. |
| Partial draft or unresolved input | Preserve the draft and pause. Let the controller select the continuation. |
| Unknown owner or resource lifecycle | Inspect read-only and obtain execution-host proof. |

Keep an active controller alive while submitting controls. `respond` means queued, not applied. Verify the subsequent disposition and inspected state. Resume a stopped controller only after positive owner/resource settlement. Do not invent reviewer votes, user answers, private interviews, or extra worker calls. Report decision and operational settlement separately; never infer success from exit zero alone.
