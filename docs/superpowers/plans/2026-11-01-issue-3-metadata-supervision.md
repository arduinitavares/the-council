# Issue 3 metadata supervision correction plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct verified R1/R2 in the four approved diagnostic runners before any AGY metadata execution.

**Architecture:** Preserve the exact inner argv and inert fixtures. Establish exception-safe, deadline-based ownership immediately after spawn. Termination continues until both the direct child and its owned group settle, or a bounded unresolved result is retained.

**Tech Stack:** Python 3 and isolated in-memory fake process/clock/file objects.

**Spec:** The approved proposal and metadata plan remain unchanged. Astra's initial review supplies R1/R2; the coordinator verified both from actual source. R3 requires including the existing exact execution-input manifest in the next review packet.

## Global Constraints

- No AGY/provider/plugin/hook invocation or real child fixture during this correction. The coordinator alone runs the four approved commands after independent readiness review.
- Preserve `/Users/aaat/.local/bin/agy agent`, five-variable isolated environment, existing fixtures and protected paths, at most four sequential cases and 15-second command deadline.
- Writes are limited to the four declared `runner.py` files, a shared Python helper if useful, and correction tests/evidence under `loader-metadata-proposal/supervision-fix/`. Do not change frozen review packets, actual agent fixtures, production source, settings, permissions or Git.
- Preserve original exceptions, exits/signals, and unknown settlement. No retry or next-case execution after refusal/uncertainty.
- No new approval is needed to repair these preparation defects within the already approved effects. An actual denial still stops its affected operation.

## Review Focus

- A write fails immediately after spawn: cleanup still supervises the owned group. Task 1 pins this with a fake path failure.
- Direct child completes but a group member survives: escalation continues. Task 1 pins communicate-return-before-group-absence.
- Delays consume the command budget: remaining wait uses the original monotonic deadline. Task 1 pins clock advancement.
- Cleanup also fails: the original failure and unresolved state remain explicit. Task 1 pins the bounded failure path.
- Normal completion remains simple: exact outputs and original exit are retained, without signals. Task 1 pins this control.

### Task 1: Correct and verify supervision

**Files:** The four case `runner.py` files under `.superpowers/sdd/2026-11-01-issue-3-inventory-witness/loader-metadata-proposal/`; optional shared helper in that directory; tests/evidence only under its `supervision-fix/` child.

**Interfaces:** Consume the existing CLI/fixture/environment and receipt fields. Preserve their meaning; add explicit diagnostic fields only if needed. Return changed paths/hashes, original behavioral RED, corrected GREEN and a concise self-review. Any proposed helper signature is the implementer's local choice and must be reported before downstream use.

- [ ] Write in-memory tests for the five review-focus cases and run them against unchanged runner behavior. Record meaningful R1/R2 RED without executing AGY or a real subprocess.
- [ ] Implement the smallest correction. Enter a cleanup guard immediately after successful spawn. Use the original monotonic deadline. Do not stop escalation solely because communicate returns; positively check the group as well. Bound signal/drain attempts and retain unknown/error outcomes.
- [ ] Run the same tests for GREEN and parse all four runners. Verify exact argv, environment, fixture bytes and protected files remain unchanged. Return original logs and final hashes. Do not commit or execute the diagnostic.
- [ ] The coordinator verifies actual changes and includes the exact runtime fixture/path/hash mapping in the new frozen packet. Fresh independent Astra Ultra and Argon high reviews must pass before acceptance or metadata execution.

Expected result: a narrow diagnostic preparation correction, with no production or loader-qualification claim.

## Author self-review

Each verified finding maps to a check and one corrective task. No product interface or loader rule is invented. This preserves approved action effects and only strengthens their promised supervision. The existing plan gate retains responsibility for final readiness and exact input-map review; code correction acceptance remains withheld until independent review.
