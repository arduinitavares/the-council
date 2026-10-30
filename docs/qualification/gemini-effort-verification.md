# Gemini effort discovery follow-up

Scope: repair only Gemini's explicit model/effort catalog verification. This follow-up does not complete issue #1 or qualify a full Council discussion. Existing trust, startup/control, billing and transport work remains separate.

## Cause and fix

At baseline `1e99f2c37e11c74a4f92da4481012c52633c7a35`, Orca's catalog exposed `gemini-4-argon-high` but returned an empty per-model `efforts` list. Council's fallback looked for a literal `launchArgs: (value) => ['--effort', String(value)]` in the installed catalog's source. The installed catalog instead delegated that mapping to `agentChoiceCliApply`. Consequently, Council returned no supported efforts even though the catalog explicitly declared `low`, `medium`, and `high`.

The structural implementation at `facf9b86ef7f0774912e3d4d18a1d4160a669dd0`, with subset compatibility restored at `1a9c75e2fa60b08632f0cb068e33222bee2a3a76`, parses the source as data with pinned `acorn@8.19.0`. It checks the relevant catalog bindings, declared choices, worker preferences, helper invocation and forward argument mapping. It executes no private Orca module. It accepts harmless formatting and unrelated metadata changes while rejecting missing mappings, overrides, misleading declarations and unsupported shapes. There is no Orca version-number restriction.

The inspected installation reported Orca `1.4.245`. Source identities:

- `shared/agent-session-option-catalog-antigravity.js`: `b8fe63667baa98c528355a4a471a3fb2fd3624a48a556a4fb9b3971311c15f0e`.
- `shared/agent-choice-cli-apply.js`: `73d9644603b6c5268a80d6c0de336b0df1b5bf59e3678e7b64992ea971636a95`.

Those hashes identify observed evidence; they are not an installed-version allowlist. Unrecognized semantic mappings still remain unavailable rather than being inferred from a model suffix.

## Recorded checks

1. Before any production edit, the current helper-backed regression failed: expected `["low","medium","high"]`, received `[]`; the other 12 RPC tests passed. Command: `npm test -- test/pilot/rpc.test.ts`.
2. A second RED demonstrated that an initial complete-source template unnecessarily rejected unrelated metadata changes. The final structural parser supersedes that implementation.
3. `npm test -- test/pilot/rpc.test.ts test/pilot/discovery.test.ts`: 64 tests passed. Typecheck and build passed. Tests and builds ran sequentially.
4. Built `LocalReadRpc.effortSupport("antigravity")` returned `["low","medium","high"]` with both source identities. The real read-only host inspector marked Gemini's exact model/high catalog `verified`. Other routes' controls remained `unknown`; Cursor billing remained `missing`. This metadata-only inspector invocation outside a native coordinator also reported `NATIVE_COORDINATOR_CONTEXT_MISSING`; it did not run Council reviewers or a judge.

## Live Gemini check through Orca

An Orca-created background terminal in the requesting repository ran an externally owned AGY process, tracked by a genuine Orca Run/Task/Dispatch. Its explicit selection was:

```text
agy --model gemini-4-argon-high --effort high
```

The harness also supplied per-session settings, sandbox, a bounded timeout, text prompt input and structured JSON output. The observed initialization named `gemini-4-argon-high`; the final result was `SUCCESS`. Actual tool events contained only reads of the canonical model policy and an owned marker file. The returned marker matched the file and was not included in the prompt. The provider exited zero; its process group, wrapper and original terminal process were absent before identity-fenced terminal closure. Global provider settings and the canonical policy were unchanged.

`high` is verified as the explicit launch flag supported by the inspected Orca contract. AGY did not expose a separate backend effort receipt; no hidden internal effort is claimed.

Two harness limitations were preserved in the evidence: an initial malformed stream-input message failed before inference with zero tokens, and the successful text-input probe warned that `--mode plan` was ineffective alongside `--disable-slash-commands`. The successful probe retained explicit per-session Deny rules, sandbox and `request-review` initialization, and performed only the inspected reads. Both attempts were fully settled and closed. The later Opus review route omits the conflicting slash-disable flag.

## Acceptance record

- Independent `claude-opus-5-5-medium`, explicit `medium`, through Orca/AGY reviewed the frozen `1e99f2c..facf9b8` patch: **spec PASS, task quality Approved**, no Critical or Important findings. It reported six minor observations and four external verification limits.
- A first review attempt was not accepted: an installed-file read outside its packet was denied, and no verdict followed. That action remains stopped; no permissions changed and no new copy of the denied resource was supplied. The successful fresh review used only the previously supplied packet and canonical policy, performed only `read_file`, returned a substantive verdict with no denied actions or stderr, and settled fully before identity-fenced terminal closure.
- Coordinator compatibility checking and Opus minor finding 3 identified that requiring all three levels narrowed baseline behavior. The follow-up accepts any nonempty duplicate-free recognized subset. Twelve subset regressions failed before the amendment; **76 focused tests**, typecheck and build then passed.
- Full suite on `facf9b8`: **787 passed, 1 failed / 788**, 64 files, 329.59 seconds. The E4 test at `test/pilot/context-wrapper.test.ts:17` returned `WRAPPER_NATIVE_COMPLETION_UNVERIFIED` (5 probes, 0 topic calls, no unresolved attempts). Its cause remains unproven; earlier full runs failed this test with a different diagnostic. No integration-failure fix is part of this change.

Review limits retained: future unfamiliar module envelopes may remain unavailable; the static forward-mapping check does not audit every deferred function or imported dependency's runtime effects; an invalid unused helper can conservatively hide a legacy mapping; legacy `cli`, model-option overrides and optional effort `id` semantics retain baseline limitations. The tolerance test could use stronger mutation guards. These observations are supplied to the final review rather than silently treated as cleared. The helper's top-level `require` can execute when Orca loads it; Council discovery itself only parses source and does not execute that dependency.

A final review and post-compatibility full-suite result are pending. Broader issue #1 acceptance remains outside this follow-up.
