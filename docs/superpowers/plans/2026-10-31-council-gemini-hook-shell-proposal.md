# Scoped Gemini hook environment proposal

This is a proposed design for independent review. It is not an approved implementation task.

**Goal:** Remove the known Orca hook's dynamic endpoint dependency without changing global hooks, permissions, settings, or Cursor.

**Evidence:** The installed AGY binary constructs command hooks with `sh -c`, resolved through PATH. It copies its process environment and adds a conversation ID. The exact known Orca script uses environment-selected endpoint sourcing and invokes Python before checking endpoint state. Parent environment filtering does not enforce the environment at that actual shell boundary.

**Proposed repair:** Generate a source-bound, launch-scoped `sh` adapter in the Council packet profile. Put only its task-owned directory before the original PATH for this AGY process. The adapter recognizes only the exact five reviewed Orca command descriptors and exact script bytes. For those commands, it runs the original command under an explicit empty environment plus a narrow fixed allowlist. For other commands, it delegates to absolute `/bin/sh` with the normal environment. It does not fabricate hook decisions, suppress the original script, modify Deny rules, or change global files. Unknown hook variants retain existing unavailable guards.

**Adapter bootstrap:** On this inspected macOS host, `/bin/sh` is Bash 3.2.57. A script interpreter line `#!/bin/sh -p` prevents ENV/BASH_ENV startup processing, inherited shell functions and SHELLOPTS before the adapter can clear the child environment. The local primary manual at `/usr/share/man/man1/bash.1` documents this behavior. Require equal real/effective user and group IDs. The option does not grant OS access or change IDs in that case. Reject unsupported platforms or shell contracts rather than adding a fallback. A direct native helper is an alternative only if this bootstrap cannot be qualified; do not invent a permission bypass.

**Known-command environment:** Use absolute `/usr/bin/env -i` and absolute `/bin/sh`. Use a dedicated empty task-owned hook cwd and HOME. Set a fixed system PATH, scoped TMPDIR, PYTHONNOUSERSITE=1, PYTHONDONTWRITEBYTECODE=1, and a fixed locale. No ORCA variable, ENV, BASH_ENV, PYTHONPATH or PYTHONHOME reaches the original command. Python's system runtime and possible Command Line Tools cache behavior need explicit effect classification and binding, not a claim of total inactivity. Do not claim an unverified Python flag disables startup. The known script therefore cannot source the endpoint, send HTTP, or write a spool record, independent of ORCA variables that AGY may add before its shell call. The original permission response remains unchanged.

**Required integrity:** Bind generated adapter content, executable mode and parent directory identity. Reject symlink/non-regular targets, unexpected bytes, writable or nonempty isolated helper roots, and source drift before provider start. Bind the environment/profile to recipeHash and the wrapper assignment. Keep all writes under .council/native-packets and task-owned tests. Do not inherit this contract for arbitrary shell commands, hook scripts or future provider layouts. Keep effective stream initialization and provider runtime qualification separate.

**Proposed file scope:** A new focused src/pilot/agy-hook-shell.ts module; src/pilot/provider-controls.ts for exact hook recognition and audited effect construction; src/pilot/provider-session.ts for profile materialization and launch PATH; src/pilot/wrapper-contract.ts for a strict optional AGY-only profile field. Add focused tests in test/pilot/agy-hook-shell.test.ts and extend the existing provider-controls/provider-session tests. Exact interfaces remain provisional until review and the disposable experiment pass. Do not change Cursor code or permissions.

## Task 53: Qualify the proposed shell boundary in a disposable fixture

**Owner:** Astra Ultra through the qualified native edit route. Independent review: fresh Argon high. This task becomes ready only after design review passes.

- [ ] Write the proposed adapter only in a task-owned disposable case. Do not edit production or global files.
- [ ] Run its exact known Orca command with hostile fake endpoint, pane, token, ENV/BASH_ENV, shell-function and Python startup variables. Use only inert task-owned sentinel files and fake values. Never use or read a real endpoint or credential.
- [ ] Verify the original hook's JSON response and stdin handling. Verify endpoint, network and spool paths cannot run in this profile. Inspect process settlement and unchanged global hashes.
- [ ] Check the non-Orca delegation path preserves normal behavior and existing permission hooks. Check script/mode/symlink/root drift refuses launch. Check the current AGY shell lookup selects the generated adapter using source-bound PATH.
- [ ] Report exact observations and unresolved effects. A sample corroborates the adapter's explicit environment enforcement; it does not replace the inspected constructor/adapter contract.

**Expected result:** The fixture proves that environment cleaning occurs at hook execution, before the original hook script. It preserves hook output and fails on invalid profile/source variants. Any unmet requirement stops promotion.

## Later roadmap

If the proposal and fixture pass, refine a concrete implementation task with exact interfaces and tests. Record a meaningful feature-acceptance RED on unchanged production; do not call it proof that the original guard violated the old contract. Implement with Astra Ultra, then run focused tests, typecheck, build and the controlled full suite. Review frozen code with fresh Argon high and verify findings. Prepare a fresh Gemini-only audit. The known dynamic-hook unavailable entry must disappear without weakening generic guards. Keep effect review/adoption and later runtime qualification separate. Keep the wider objective and final gate open until all required audits pass.

## Self-review and language note

The environment boundary is a proposed contract extension. Its host support, shell bootstrap, Python platform effects, materialization integrity and PATH selection require review and qualification before implementation. The experiment is separately verifiable and does not include production edits. All remaining outcomes are in the roadmap. This is an Issue 9-oriented candidate; the official dictionary and governed glossary are unavailable. Protected paths, flags and identifiers are exact.
