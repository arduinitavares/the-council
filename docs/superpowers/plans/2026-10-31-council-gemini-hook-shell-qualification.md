# Gemini hook shell qualification implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Qualify the reviewed hook environment boundary in a disposable fixture before production changes.

**Architecture:** A generated sh adapter enters an empty environment before a Node verifier runs. The verifier validates the original hook and runs an exact source-bound copy. Matched or suspicious Orca commands never delegate unfiltered. Unrelated shell commands preserve the normal environment. The immutable profile and empty HOME/cwd are separate from writable temporary scratch.

**Tech Stack:** Node.js 22, macOS Bash 3.2.57, /usr/bin/env, the exact inspected AGY shell-dispatch contract.

**Spec:** docs/superpowers/plans/2026-10-31-council-gemini-hook-shell-proposal-v2.md. Independent review: .superpowers/sdd/2026-10-31-council-audit-refresh/gemini-hook-shell-plan-rereview/report.md.

## Global Constraints

Use only gpt-6-astra at ultra through Orca for code. Use fresh gemini-4-argon-high at high for independent acceptance. Read /Users/aaat/.agents/policies/model-policy.md. Do not change production, global files, Cursor, permissions, trust, billing, or instructions. Do not launch AGY, Council, another provider, or model helpers. Declared disposable local test subprocesses are permitted. Never read real endpoint or credential files. All fake data and mutations stay in the declared case. Preserve existing work. Stop the affected action on an unexpected access denial.

## Review Focus

- Orca recognition and integrity failure must not enter unfiltered delegation.
- Go can skip a non-executable adapter unless launch checks reject it first.
- Interpreter startup runs before ordinary script statements unless bootstrap controls prevent it.
- A profile copy must preserve the known script's behavior and reject original/copy drift.
- A source-bound PATH must select the adapter, and temporary effects need separate custody.

### Task 53: Qualify the scoped hook execution boundary

**Files:** Create only under `.superpowers/sdd/2026-10-31-council-audit-refresh/gemini-hook-shell-qualification/`: `build-profile.mjs`, `verify-hook.mjs` if separate, `check-profile.mjs`, task-owned fixture copies, generated profiles and scratch, `red.log`, `qualification-result.json`, and a source manifest. The supervising runner owns `launch.json`, events, lifecycle receipts and `report.md`.

**Interfaces:** Consume the reviewed proposal v2, exact sanitized five descriptors, installed hook bytes (SHA256 b55f5e6331033826216d58416c8e7e99dca18914a18acc17de4bd5f9d153c2f8), and accepted binary-dispatch evidence. Produce a frozen prototype plus explicit check results and remaining limitations. No production interface or source repair is part of this task.

- [ ] Read the spec, independent review and current source interfaces. Keep the reviewed four Important and two Minor safeguards exact.
- [ ] Create only inert fake endpoint and startup sentinel files. Use a fixture copy of the exact installed hook as the original target for mutation tests. Verify its bytes. Do not mutate the installed hook. A baseline run under ordinary /bin/sh with the fake endpoint must demonstrate the sentinel path; terminate in that fake source before any network path. Record this as a controlled environment-boundary demonstration, not proof of actual AGY injection or a regression against the old Council contract.
- [ ] Build the disposable adapter and verifier with native edits. Use /bin/sh -p only after equal real/effective UID/GID checks. Use builtins before env-i. Use a source-bound Node executable and builtin modules after env-i. Never fabricate the hook JSON. Execute the source-bound script copy through the equivalent reviewed command template.
- [ ] Materialize the adapter at mode 0o500. Recheck regular/non-symlink type, uid, exact modes, byte digests, execute access and directory custody even on EEXIST. Keep a mode-0o500 empty HOME/cwd. Keep per-invocation temporary scratch under a distinct owned mode-0o700 parent; do not put a mutable scratch child behind an immutable parent that cannot create new per-run entries. Bind those paths to the prototype profile. Fixed matched environment: PATH=/usr/bin:/bin, HOME/cwd at the empty root, scoped TMPDIR, PYTHONNOUSERSITE=1, PYTHONDONTWRITEBYTECODE=1, LANG=C, LC_ALL=C.
- [ ] Run the five actual command shapes with fake ORCA endpoint/pane/token and hostile fake ENV/BASH_ENV, inherited function and Python startup inputs. Verify the expected original JSON responses, consumed stdin, absent endpoint/startup sentinels and settled subprocesses. No real endpoint or network target is allowed.
- [ ] Test original-script drift, copied-script drift, verifier/adapter bytes, adapter mode 0o600, symlink/non-regular targets, invalid roots, nonempty HOME/cwd and unequal-ID guard input. Use only task-owned fixtures. Every Orca-related failure must refuse before unfiltered execution. Test unrelated-command delegation with a benign declared environment value.
- [ ] Verify source-bound PATH lookup selects the executable adapter. Use a stand-in lookup to corroborate the inspected AGY constructor; label it a stand-in. Do not claim a live AGY run. Inspect resolved system helper/runtime identities and temporary scratch effects. Do not claim total filesystem containment or infer universal xcrun behavior from a denied cache write. Report any unexpected user-writable startup source.
- [ ] Run the complete disposable check with the explicit Node.js 22 executable. Save source hashes, exact commands, exit codes and check results. Verify production and protected hashes remain unchanged. Return a concise report, exact run command, checks, limitations and source files for independent review. Do not commit or push.

**Expected result:** The actual adapter enforces its environment before the known hook script. Baseline sentinel reachability and cleaned-path exclusion are observed. Hook JSON is preserved. Integrity failures refuse launch. All declared local processes settle. Temporary effects and limits are explicit. A failed check stops promotion to production.

## Later roadmap

Freeze and independently review the actual prototype. Verify findings. If it passes, refine exact production interfaces and regression/feature-acceptance tests in a new ready task. Run meaningful RED on unchanged production before editing. Use Astra Ultra for implementation, then focused tests, typecheck, build and controlled full-suite checks. Obtain fresh Argon code review. Regenerate the producer and Gemini-only audit. Preserve OpenAI/judge hashes and native references, Cursor, and generic unknown-source guards. Review and adopt only complete eligible effects. Keep later runtime and full Council acceptance separate.

## Authoring and language check

This is a separately testable disposable qualification task. Its outputs, exact source identities, action limits and checks are explicit. Production interfaces remain provisional. The shell-dispatch evidence identifies the supported boundary; the prototype supplies enforcement and corroboration. This is an Issue 9-oriented language candidate. The official dictionary and governed glossary are unavailable. Technical literals are protected.
