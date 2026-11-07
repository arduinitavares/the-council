# Council startup audit refresh

## Objective

Restore current startup-audit evidence for `openai`, `gemini`, and `judge`.
Keep each provider restriction active until its evidence passes the existing checks.

## Authorization

The user authorized execution of the reviewed plan on 31 October 2026.
This authorization covers the bounded audit refresh and its required verification.
Use only Astra Ultra and Argon high for code and execution reviews through Orca.
Change production code only after the plan's defect and RED gates pass.
Prepare and adopt audit snapshots only through the reviewed evidence gates.
Do not change global settings, trust, permissions, accounts, or billing.
Keep the existing checkout and its unrelated work.

## Current evidence

The baseline is `f0b89f9fa7d223acdffed4db932c45c96f3816f7` on `dev/issue-1-first-use-reviewed`.
Run `os-question-20261031T114756Z-9249052da7bf` used a genuine Orca terminal.
Its status was `prerequisites_not_verified`.
It recorded zero provider initializations and zero model calls.
The coordinator-context blocker was absent.

All four roles had a pending audit disposition.
No saved snapshot or disposition matched their current audit hashes.
Historical source hashes differ from current Codex configuration, AGY executable, and Cursor configuration hashes.
These changes explain why old evidence cannot be reused unchanged.
They do not establish that missing approvals are the only remaining audit defect.

`auditHash` covers source hashes, provider version, loader order, effects, unavailable inputs, and the recipe.
`acquiredAuditDisposition` reports a missing disposition before it can report unresolved audit inputs.
A valid disposition requires authenticated native coordinator provenance.
Every required effect must be covered.
The `unavailable` list must be empty before the audit can verify.
The saved run showed no other bootstrap blockers for the three selected roles.
Their effective runtime controls remained unknown before initialization.
This dated observation must be checked again before execution.
An AGY version change directly affects the Gemini route.
The judge uses Codex.

## Required outcome after execution authorization

1. Produce a current audit report for each of the three selected roles.
2. Show every changed source, effect, and unavailable input.
3. Separate stale approval evidence from demonstrated software defects.
4. Repair a software defect only after a reproducible counterexample exists.
5. Record justified dispositions through the existing native preparation and adoption path.
6. Verify the three startup-audit facts against the same current inputs.
7. Run one fresh roster preflight from an owned Orca terminal.
8. Report the remaining Cursor blockers separately.

The final preflight can still return exit `3` because Cursor remains outside this repair.
That result passes this scope only when the three repaired audit facts verify and no new blocker appears for them.
It does not prove full Council qualification or a successful judge comparison.

If a role has an unresolved environmental input, retain its blocked outcome.
Continue independent eligible role branches through a material plan revision.
Do not claim the full objective when fewer than three selected roles verify.
Do not change global configuration to force eligibility.

Bind the actual built producer to its source and build inputs.
Review proposed effect decisions before write-once adoption.
Adopt only a complete approved effect set for each role.
Keep native provenance and independent review route gates as explicit adoption dependencies.
Select the primary reviewer from the actual packet author's family.
Recheck current file bytes and metadata after that review.
Recheck them before adoption and before preflight.
Regenerate affected evidence after any external drift or source fix.
Retain the native provenance records required for later authenticated readback.
A closed owned terminal does not require removal of those durable records.
Keep the final acceptance gate unaccepted for a partial outcome.

## Model and review rules

The earlier `claude-opus-5-5-medium` plan reviews remain historical evidence.
Use only Astra Ultra and Argon high for execution reviews through Orca.
Use only `gpt-6-astra` and `gemini-4-argon-high` for code, tests, and implementation helpers.
Pin Astra to `ultra`.
Pin Argon to explicit `high`.
Verify exact host, transport, action, model, effort, and effective permissions before each code assignment.
Astra Ultra requires a qualified route.
An unavailable required route blocks that assignment.
Do not silently substitute another model or reduce effort.
Use a fresh cross-family reviewer for each source artifact.
Implementation-team helpers do not supply independent acceptance.

The coordinator must verify reviewer claims against source and recorded evidence.
Reproduce a claimed defect when a safe local counterexample is possible.
Record each finding as accepted, qualified, or rejected.
Retain rejected claims and their evidence.
Do not accept a verdict by model identity or vote count.

## Boundaries

Keep the current AGY `1.4.12` contract.
Do not restore legacy AGY behavior.
Do not copy old approval files to new hashes.
Do not fabricate native identity, audit effects, or approval provenance.
Keep inherited Deny rules and the existing refusal checks.
Exclude secrets and unrelated data from review packets and public records.
Preserve old run journals and audit evidence.

Cursor trust, read boundaries, helper loading, and included-only billing remain separate work.
Full provider qualification, full Council inference, second-project acceptance, and issue closure remain later outcomes.
This plan does not authorize those later outcomes.

## Canonical planning state

Use the configured `mcp__adaptivePlanning` service.
Retain its identity and private grants outside repository files and public views.
The new bounded plan covers the current `council-first-use` checkout.
The older campaign plan `af97b843-8f9b-476d-958c-da3d7a2773cc` covers another checkout.
Link to that campaign without changing its ownership or accepted history.
