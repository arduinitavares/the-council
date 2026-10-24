# The Council configuration amendment review

Date: 2026-10-24
Verdict: **READY**. No material findings.

## Scope and disposition

The user authorized `council.yaml` for reviewer and judge selection, with the existing models as defaults.

A fresh independent Argon High reviewer checked the amended design, implementation plan, diagram notes, and complete amendment diff.

It checked exact defaults, independent judge configuration, stable family seats, adapter selection, configuration provenance, recovery, concurrency, and planned test coverage.

It found no material gap and made no additional suggestion. The coordinator accepted that conclusion after inspecting the sources and evidence.

The amendment changes documentation only. The future implementation will create the actual `council.yaml`, parser, and runtime integration.

## Selected contract

- Reviewer defaults remain Astra Ultra, Argon High, and Opus High. The judge default remains Astra Ultra.
- Reviewer identities are `openai`, `gemini`, and `claude`. Model changes preserve each seat and its objections.
- Default configuration lives at the real Council package root. `start --config FILE` can select another complete file.
- Each run saves the raw YAML and canonical configuration. Resume uses those saved artifacts and rechecks current launch constraints.
- Original-file changes affect new runs only. Missing or corrupt saved configuration blocks instead of selecting current defaults.
- Three-family review, equal assent, a fresh judge without a vote, phase settlement, and the three-round default remain enforced.

## Independent review evidence

- Execution host: local Mac. Hosting workspace and actual cwd: `/Users/aaat/projects/the-council`.
- Orca workspace: `a7a80763-17f4-4250-9180-7cf8ddfad5a6::/Users/aaat/projects/the-council`.
- Policy read and supplied: `/Users/aaat/.agents/policies/model-policy.md`.
- Model: `gemini-4-argon-high`. Requested effort: `high`. The provider exposed the exact High model.
- Provider CLI: Antigravity `1.4.7`. A supplied-text fixture requalified this assessment route after its version change.
- Mode: active system `plan` command. Terminal sandbox enabled. Exposed permission mode: `request-review`.
- The entry received supplied text only. Exposed native tools were available, but no native tool or helper call appeared.
- Provider-managed backend settings beyond those observations were not exposed.
- Review conversation: `88a4741b-d5d8-446e-8568-ca44daacd307`.
- Review terminal: `term_5bfc5766-372d-4e26-b1ca-4dac4283b8ef`.
- Fixture conversation: `eceff3a0-2ea5-47e9-bfbd-73070de16e6a`.
- Fixture terminal: `term_28cf51e9-0f61-4c5f-a2ec-29871150df3a`.
- Both provider results were `SUCCESS`; both provider exit codes were `0`. Their owned process groups were absent after settlement.
- Both terminals returned to their shells and were closed by the coordinator. Unrelated terminals were preserved.
- Both stderr files were empty. Provider settings bytes stayed unchanged. No workspace trust grant was added.
- This was terminal/process ownership for assessment. No supervised Run, Task, or Dispatch authority is claimed.
- Allowance was not exposed. The fixture and review had explicit two-minute and twenty-minute provider limits.

Temporary receipts and complete provider output remain in `/var/folders/fh/0bmky89j2d54xdptjs_1mrjm0000gn/T/the-council-yaml-review-3xxl9ctn/`.

## Reviewed sources

- `docs/superpowers/specs/2026-10-23-the-council-design.md`: `e318a6f6a039aacd96db90b56ef7602625e16bc42b27df7bdfd303c37c12d6c9`.
- `docs/superpowers/plans/2026-10-23-the-council-implementation-plan.md`: `4bc074ba289391df2312730e34a74853981daa83a369535564a1987d5ba72046`.
- `docs/superpowers/diagrams/README.md`: `72cbae069947ecf380735ac03bdb4d6b3fe999c7b04de135e9036a49c10fd3aa`.

Only status and review-evidence text changed after the review. The earlier source hashes remain in the temporary review manifest.

## Coordinator verification

The embedded YAML parsed successfully and matched all four exact default selections. Document fences, relative links, task count, and diff whitespace checks passed.

The plan retains eight tasks and adds explicit parser, replacement-model, immutable-configuration, restart, and packaging checks.

Package metadata and tagged primary source confirmed YAML `2.9.1` and its planned parsing controls. No dependency was installed.

This evidence establishes documentation readiness. It does not qualify live Council orchestration, Ultra controls, installation, or deployment.
