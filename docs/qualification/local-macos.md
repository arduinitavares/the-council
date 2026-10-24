# Local macOS qualification

Status: **UNQUALIFIED_ROUTE — synthetic implementation only.**

Task 5 made no live provider call. Synthetic tests do not qualify a provider route.
The coordinator held the live gate throughout this task.

## Observed host and tools

Observation date: 2026-10-24.
Host: `Alexandres-Mac-Studio.local`.
Checkout: `/Users/aaat/.codex/worktrees/council-implementation/the-council`.
Branch: `dev/council-implementation`.
Orca workspace: `3a436214-d461-4d64-93d5-aabb2c96fe33::/Users/aaat/.codex/worktrees/council-implementation/the-council`.

The worker selected `/Applications/Orca.app/Contents/Resources/bin/orca` once from `ORCA_CLI_COMMAND`.
It loaded both guides from that executable.
The executable reports Orca `1.4.239`.
Installed read-only help reports Codex `0.164.0` and AGY `1.4.7`.
No settings, policy, permissions, or global tool installation changed.

The hosting workspace and process cwd are separate facts.
A candidate worker would use this hosting workspace and a private `council-worker-*` directory in the OS temporary directory.
The supplied packet grants no source filesystem access.
The implementation checks canonical paths, directory permissions, ownership, and the reservation marker.
It adds no source roots or persistent permissions.

`WorkerSpec.admissionReceipt` identifies the current immutable Task 4 `AdmissionEvidence` artifact.
The same reference must be the accepted `PREFLIGHT.attestation`.
The transport checks its bytes and binds the role, phase, assignment set, scope, access, and committed launch fence.

## Required selections

| Logical role | Orca route | Exact model | Exact effort | Live status |
| --- | --- | --- | --- | --- |
| OpenAI reviewer | Codex | `gpt-6-astra` | `ultra` | `UNQUALIFIED_ROUTE` |
| Gemini reviewer | Antigravity / AGY | `gemini-4-argon-high` | `high` | `UNQUALIFIED_ROUTE` |
| Claude reviewer | Antigravity / AGY | `claude-opus-5-5-high` | `high` | `UNQUALIFIED_ROUTE` |
| Judge | Codex | `gpt-6-astra` | `ultra` | `UNQUALIFIED_ROUTE` |

These are shipped defaults, not launch authority.
A configured replacement needs its own exact current policy, catalog, and qualification evidence.
The route adapter preserves an admitted model and effort without a second model-version allowlist.
Synthetic tests cover Sol Max, Sonnet High, and an explicitly attested future-looking identifier.

The coordinator's current caller observation identifies Sol Ultra and zero caller Astra slots.
That observation does not qualify a new Ultra child.
The coordinator reported exhausted Opus Medium review credit.
It did not establish allowance for the default Opus High selection.
No paid overflow or model substitution was attempted.

## Candidate command and missing controls

The documented ordinary entry has this argv shape:

```json
["orchestration", "worker-start", "--from", "<coordinator-handle>", "--worktree", "id:3a436214-d461-4d64-93d5-aabb2c96fe33::/Users/aaat/.codex/worktrees/council-implementation/the-council", "--spec", "<complete frozen supplied packet>", "--agent", "codex", "--model", "gpt-6-astra", "--effort", "ultra", "--json"]
```

The AGY entries replace the final selection with `--agent antigravity` and the exact configured model and effort.
This is an unexecuted command proposal.
It is not a qualified launch recipe.

Installed Orca `worker-start` exposes model, effort, task, replay-request, and existing-terminal controls.
It exposes no arbitrary per-entry executable or provider configuration flag.
Codex help exposes per-invocation `--config`, `--disable`, `--sandbox`, `--strict-config`, and `--ephemeral` controls.
Those controls alone do not prove effective isolation.
`--strict-config` checks configuration keys. It does not isolate tools.

A sanitized configuration inspection found enabled `hooks` and `multi_agent` features.
It also found configured MCP entries, apps, plugins, and a notification command.
The worker inspected names and Boolean feature values only.
It did not print credentials, environment values, command values, or tool arguments.
The normal Orca launch does not expose how this adapter could apply and verify all required per-invocation controls.

AGY help exposes `--model`, `--effort`, `--mode`, `--sandbox`, and print/output controls.
The historical `1.4.6` plan/slash-command observation is not proof for `1.4.7`.
The adapter rejects disabled slash expansion with plan mode.
It also requires evidence of the actual expanded `plan` command.
No such live evidence was obtained.

The following controls remain unqualified:

- Exact effective settings and complete hook, tool, and descendant controls.
- Source protection and the actual private cwd under supervised execution.
- A real Run/Task/Dispatch receipt correlated to the original client attempt key.
- Original-attempt replay or inspection after a lost launch response.
- Stop-only authority and process/group enumeration for that owned attempt.
- A watchdog that covers real and unknown-start attempts after controller loss.
- Positive worker, child, CLI/MCP, watchdog, and watchdog-child settlement.
- Full packet delivery for each exact route/model/effort and action class.

The real adapter therefore remains absent and fails closed.
`qualifyRoute` reports `UNQUALIFIED_ROUTE`.
`OrcaTransport` accepts only explicitly synthetic drivers.
A terminal-only assessment cannot supply missing supervised authority.

## Synthetic evidence and limits

The tests use no model and make no new provider inference.
Fixture Run/Task/Dispatch identities are labelled synthetic.
The adapter never creates missing real identities from local counters.

The tests cover exact argv, environment-key filtering, bounded stdout, nonzero exits, and child processes.
They also cover store fences, uncertain starts, conflicting receipts, packet delivery failure, and all four phases.
The tests distinguish the reducer's phase `inputHash` from rendered-packet hashes.

A detached Node watchdog survives its launching process and executes one fixed stop argv.
It uses a stable attempt/deadline resource key and exclusive registration.
Its elapsed monotonic clock prevents a backwards wall clock from extending the deadline.
The synthetic controller explicitly executes deadline effects through `armSyntheticDeadline`.
A bare launch is not proof that a watchdog was armed.
After positive worker and child exit, `markSyntheticWatchdogSettled` permits the watchdog to exit.
The adapter must inspect that exit before it accepts aggregate settlement.

`WATCHDOG_ARMED` completes only the matching deadline outbox entry.
The store verifies the immutable arming and launch proof before its transaction.
The event grants no inference, phase, vote, budget-pause, or resource-settlement authority.
Its deterministic event ID preserves same-event replay without changing the version-one checkpoint shape.
Settlement additionally requires the registered watchdog identity and positive resource receipts.

Synthetic fixtures admit at most `200000` packet bytes for their own test route.
This is not a live delivery bound.
The admitted live packet bound is **none**.
The global `8 MiB` input limit is not a provider-delivery guarantee.
The final worker-result limit is `1 MiB`.
Oversized output remains an explicit failure and cannot supply a repaired vote.

## Next decision

The coordinator owns review and acceptance of this fake-only deliverable.
A later live gate needs a specifically admitted route and all missing evidence above.
No exact effort, provider, permission boundary, or packet may be silently substituted.

Language profile: Issue 9-oriented description.
Dictionary and full ASD-STE100 conformance were not verified.
