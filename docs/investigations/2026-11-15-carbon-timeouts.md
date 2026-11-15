# Carbon High timeout investigation

Investigated on PR #103, originally at `13e5c10d7840727cb9ef1077cf6e18105fa49d5b`. Related: #107. This report records an unresolved provider-progress gap; it does not establish a Carbon model defect.

## Observations

The clean question asked which single change would most improve the Council skill. It supplied neither an evidence packet nor a repository workspace. The earlier coordinator-added oversized policy packet was absent from these clean prompts. Provider startup can independently load configuration; prompt length alone does not measure that input.

| Invocation | Prompt | Deadline | Result |
| --- | --- | --- | --- |
| `run-1794716893108-053924`, round 1 | 2,381 characters | 120,000 ms | Interrupted after 120,274 ms |
| Controlled single-seat replay | Identical round-1 prompt | 240,000 ms | Interrupted after 240,273 ms |
| `run-1794718265266-df8acd`, round 1 | Identical round-1 prompt | 500,000 ms | Completed after 203,850 ms |
| Same run, round 2 | 5,741 characters; different context | 500,000 ms | Interrupted after 500,270 ms |

All four calls selected `gemini-4-carbon-high` through Antigravity. The round-1 prompt SHA-256 was `3cebaa62716dd6373f8679c33c909fa2a046f5df14934f2f567f81eb824b1d7e`. These observations establish variability; the round-2 call is not an identical-input comparison.

The controlled replay's provider log showed authentication, model selection, and a generation request approximately 16 seconds after launch. The returned envelope reported `interrupted` at the deadline. There was no recorded quota error or denied action. Trace coverage was unavailable, so an empty tool-call array cannot establish that no tools ran. No first-output timestamp or subsequent progress event was available in the recorded Council receipt.

The original diagnostic replay and both clean runs settled. Their recorded owned process IDs were confirmed absent after completion. In the 500-second run Carbon submitted an objection before timing out in round 2; that objection was preserved, and the final result was a Dissent Report. This is consistent with ADR 0003.

## Disposition

Increasing the limit allowed one initial response to finish but did not reliably solve the delay. The available evidence cannot distinguish model computation, upstream waiting, provider startup work after the request, or a provider/harness stall. No timeout, effort, permission, or model-selection change is justified by these records alone.

The next useful observation is a supported provider first-output/progress timestamp correlated with process launch, request start, and deadline. First establish which progress fields the installed CLI exposes; record unavailable fields explicitly. Any further live comparison should be bounded, preserve exact model and effort, and capture only sanitized lifecycle metadata and public responses. No private reasoning or unrelated provider configuration is needed.

The existing cancellation/subprocess tests verify deadline classification and process cleanup. They do not reproduce or explain the upstream wait. #107 remains open pending that progress evidence.

## Evidence provenance

The coordinator inspected the local JSON results and the controlled replay receipt. Source artifacts are local and are not published with this report:

- `.council/experiments/skill-question-only/result.json`
- `.council/experiments/skill-question-only/carbon-240-probe.json`
- `.council/experiments/skill-question-only/timeout-investigation.md`
- `.council/experiments/skill-question-500s/result.json`
- `.council/experiments/skill-question-500s/run-reference.json`

Their essential measurements and limitations are reproduced above so the report does not require access to private provider conversation stores.
