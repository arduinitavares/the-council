# Gemini direct startup enrollment follow-up

Council no longer requires exact global `trustedWorkspaces` enrollment metadata for the inspected AGY **1.4.12 direct `agy-stream` acquisition**. The inspector omits that inapplicable prerequisite; it does not report an absent entry as enrolled or trusted. Legacy 1.4.11 retains its enrollment gate, and unreviewed versions remain unsupported. Independent review of this source change is pending. Council operational qualification remains open.

This follow-up starts at `31bae7cec0f5691ad52495a829f1968285b10797` and supplements the historical [startup verification](gemini-startup-verification.md). Its machine-readable record is [gemini-enrollment-receipt.json](gemini-enrollment-receipt.json). Evidence was collected on local macOS on 2026-10-31 UTC. Private paths, runtime identities, account data and configuration payloads are omitted.

## Observed direct-response contrast

The coordinator observed a substantive OS answer, one turn, exit 0, empty stderr, unchanged protected inputs and no remaining observed process/group in both direct AGY trials. Exact packet enrollment was absent before and after each trial.

| Trial | Settings comparison | Actual recipe argv | Advertised tools | Tool calls |
| --- | --- | --- | --- | --- |
| First direct response | Original profile plus an extra `read_file(*)` Deny | Not an exact recipe match | 60 | 0 |
| Matched direct response | Preexisting generated profile, byte for byte | Exact acquired recipe | 60 | 0 |

Both requested `gemini-4-argon-high` with explicit effort `high`; backend effort is **provider-managed; not exposed**. Exact model, selected agent, packet cwd and `request-review` were observed. The second trial resolves the first trial's profile/argv comparison gap.

The original private diagnosis report falsely described both tool advertisements as empty. The coordinator checked the actual captures and corrected both claims: **60 advertised, 0 used**. A sanitized projection omitting tools is not evidence of an empty array. These direct responses test an enrollment assumption; they do not establish an effective empty-tools boundary, loaded-definition enforcement, native Orca AGY launch behavior, Council qualification, or behavior on other AGY versions.

## Scoped repair and verification

Only `src/pilot/provider-controls.ts` changes production behavior. Within its direct AGY branch, version 1.4.12 omits the enrollment metadata fact. Global settings are still read and fingerprinted; malformed or unavailable sources remain blocking. Inherited Deny rules, generated settings/agent integrity, required help flags, source-version guards, hook inventories and authenticated audit disposition remain intact. Session model/agent/cwd/permission/tool checks and parsed error/refusal handling are unchanged.

Before any production edit, real acquisition tests supplied readable settings with absent, empty and foreign-path enrollment. All other bootstrap sources were valid. All three cases failed because bootstrap was `missing` rather than `verified`; **58 protections/existing tests passed**. Settings bytes and change metadata, source digests, inherited Deny and unknown effective controls passed their assertions before the decisive failure. All **201 frozen entries** (66 source, 129 build and six configuration files) matched the baseline across RED.

| Check | Result |
| --- | --- |
| RED: `npm test -- --maxWorkers 2 test/pilot/provider-controls.test.ts` | Exit 1; 3 intended failures, 58 passes |
| GREEN: same acquisition command after the source repair | Exit 0; 61 passes |
| Existing provider-session, control-audit and fix5 regression files | Exit 0; 149 passes |
| `npm run typecheck` | Exit 0 |
| `npm run build` | Exit 0 |
| Sole full `npm test -- --maxWorkers 2` | Exit 0; 1,094 passes across 66 files |

The full run had a 900-second bound and completed in 320.369 seconds wall time (320.06 seconds reported by Vitest). No edits overlapped it. Its owned process group was absent after completion. A separate Node rehash checked the Python-generated manifest: **279/279 files matched**, zero drift. The manifest contains 66 source, 129 build, 78 test, five configuration and one script file; public documentation is excluded. No further source edits or test reruns followed the full run. Raw logs and positive process/hash receipts are retained privately.

| Frozen artifact | SHA-256 |
| --- | --- |
| Full manifest | `7666e206122764c557d1362e84b89ae7ec0d466fbd50f9e91e4d9ff35d393f56` |
| `src/pilot/provider-controls.ts` | `babd556d3a05439a4f5ce505ecda78805c1f72f6fa1bcb0faf844004eb2a8e0b` |
| `dist/pilot/provider-controls.js` | `20eb91af87053a49136e4949dc5a14d3daad8af30f9aa0da47b878df9e241c20` |
| `test/pilot/provider-controls.test.ts` | `28d7d4f67fd4edc39f4efc3ca367005bb6c4e9a707bcefb97e92b7bbd68fa676` |

## Actual Council rerun after the repair

A fresh native Council run of “What is the best operating system in the world?” at functional revision `ccbd111a259dcc531097a743e4ec547244a3274f` exited 3 after 14.661 seconds with `prerequisites_not_verified`, empty stderr and unchanged protected inputs. It initialized no reviewer and made zero probe/topic calls.

Gemini now reports `CONTROLS_UNKNOWN` with only `startup-hooks-and-plugins` awaiting `AUDIT_DISPOSITION_PENDING`; exact enrollment is absent and no longer a bootstrap blocker. Existing xAI `CONTROLS_MISSING` and `BILLING_MISSING` remain. The effective empty-tools check was not reached in this Council run. Its persisted outcome matches CLI stdout, the CLI process group and wrapper settled, and the owned terminal was closed with its exact incarnation. No full Council answer or judge comparison is claimed.

## Remaining acceptance

The coordinator accepted the corrected diagnosis after independent Argon review. Fresh independent review of the actual source change and the requested Astra review remain coordinator-owned and pending in this record. The post-fix Council result above confirms removal of the enrollment blocker while retaining the other gates. Hook/source closure and authenticated disposition, actual effective tool containment and the existing xAI controls/billing gates remain open. Software verification does not supply those runtime proofs.

Rollback is the scoped source commit plus rebuild. No persistent trust, permissions, settings or billing changes were made for this repair.
