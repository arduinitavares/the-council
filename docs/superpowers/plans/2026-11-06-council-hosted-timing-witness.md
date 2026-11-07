# Hosted timing witness delivery implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to perform the checked steps in order. Steps use checkbox syntax.

**Goal:** Publish the accepted timing witness and collect one bounded hosted Mac qualification attempt.

**Architecture:** The coordinator performs deterministic delivery operations over already reviewed source. The existing isolated delivery checkout produces one normal commit and push. The unchanged workflow runs its three bootstrap jobs and preserves native evidence.

**Tech Stack:** Git, GitHub CLI, the existing GitHub Actions workflow, and the accepted Python CI harness.

**Spec:** /Users/aaat/.codex/worktrees/council-first-use/the-council/docs/superpowers/specs/2026-11-05-council-hosted-offline-validation-design.md

## Global constraints

- Use the existing owned delivery checkout at /Users/aaat/.codex/worktrees/council-hosted-bootstrap/the-council.
- Begin from a651f26cc096eb4dba7ba37799f55a1cfa49549f. Preserve the separate original worktrees, unpublished TypeScript commits, #5 files and diagnostic candidate.
- Copy only accepted test/ci/test_offline.py, SHA256 bce8ffa0f32fe320d9b0eaaaf7dce7ec6944d4aea008bdc72ac61df4092cece0, into tracked delivery source. The other three CI files stay at their accepted hashes.
- Preserve the three fresh macos-26 jobs and their 15/15/20 minute limits, the 30+30 second qualification bound and the 1+1 second fixture bound.
- Do not change the workflow, contract, providers, accounts, permissions, settings, billing or test predicates. Do not run Node, npm, Vitest or native fixtures on the host.
- Use one normal fast-forward push. Do not force, publish tags, rerun an old job or retry after an ambiguous effect.
- Source readiness does not establish native qualification, project-suite success, issue closure, merge readiness or the full goal.

## Review focus

- Source or remote drift must stop publication before overwriting unrelated work.
- Hooks, filters and access refusals must be inspected and preserved.
- A missing, skipped, incomplete or failed qualification must remain failed.
- CLI log previews must not substitute for the full REST log archive.
- Run ownership must bind the new commit and attempt 1, without affecting unrelated runs.

### Task 1: Publish and inspect one bounded attempt

**Files:** Modify only the delivery checkout's test/ci/test_offline.py. Create task evidence under /Users/aaat/.codex/worktrees/council-first-use/the-council/.superpowers/sdd/2026-11-06-council-native-timing-witness/hosted-delivery. Preserve the ignored, immutable delivery input bundle.

**Interfaces:** Consume accepted source artifact 4bd6f9a7d9430a53f986132f380778a00892fd4e89d3cff76c22a3c3aa097a15 and result bc8a52a0-fed7-4706-9649-791c8ed4fc6a. Produce the exact commit/tree, one owned workflow run, raw ZIP logs, parsed qualification evidence and an explicit capability verdict.

- [ ] Verify the supplied four-file input bundle, clean checkout/index, baseline commit, hook/filter/signing state, intended public remote, draft PR #2 and enabled Actions.
- [ ] Start the canonical execution step before changing tracked source. Copy the reviewed test/ci file and verify all four final CI hashes.
- [ ] Stage only test/ci/test_offline.py. Inspect the staged bytes and complete diff. Commit with git commit -m "test(ci): capture bounded native fixture timing" and verify the sole parent and sole changed path.
- [ ] Recheck the exact PR head and remote base. Run git push --porcelain --no-follow-tags origin HEAD:refs/heads/dev/issue-1-first-use-reviewed once. Record its actual receipt and discover the new source-bound Actions run.
- [ ] Observe the run under the existing limits. Download its full log ZIP through the GitHub REST API. Parse exact records and retain original receipts, owner cleanup, timing witnesses, runner facts and failures.
- [ ] Require all three bootstrap qualifications and unchanged predicates to pass before capability acceptance. Obtain fresh Astra Ultra and Argon high review of the actual source/run evidence, then verify their findings. A failed run instead requires a failed checkpoint and evidence-based reassessment.
- [ ] Record positive resource settlement and preserve the full goal. Continue the next authorized step without treating bootstrap qualification as completion of the eight issues.

## Self-review

The plan reuses the approved platform, commands, bounds and publication route. It introduces no source implementation or new authority. The guarded state/hash checks cover the review-focus conditions. The old failed attempts remain evidence; this is one newly sourced attempt after accepted instrumentation.
