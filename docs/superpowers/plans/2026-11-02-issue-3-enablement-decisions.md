# Issue 3 source-backed enablement decisions

This increment implements only the successfully converted plugin enablement formula accepted in the compiled-source investigation. The approved inventory design remains the authority. Root discovery, source acquisition and lifecycle admission are separate consumers.

Source contract: the reviewed `enablement-rule-review/claims.md` under the 2026-11-02 issue3 resume evidence directory, SHA256 `db916f51e34c5e7d0ba9b9300676725bf1f0ffdd0fd968807a19b9ecdd24b9e9`.

## Task 1: implement the bounded three-state decision

Create `src/pilot/agy-plugin-enablement.ts` and `test/pilot/agy-plugin-enablement.test.ts`. A fresh Sol Max implementer owns only these two files and its task evidence. No provider, plugin or hook executes. No configuration or permission changes are permitted.

Implement a pure internal calculation with explicit known true, known false and unknown inputs. Distinguish a known absent registry override from an unknown registry. A known nullable/missing Enabled pointer means no override; an unknown registry cannot become absence. Preserve these exact successful-conversion rules:

```text
setup = MCP_variables_present OR (sidecar_feature_enabled AND sidecar_setup_present)
base = manifest_disabled OR (NOT builtin AND setup)
disabled = kill_switch OR (registry_override_present ? NOT registry_enabled : base)
```

Unknown inputs must produce the common result of every applicable interpretation when it is invariant. Otherwise return unknown. Thus registry false disables even with an unknown kill-switch. A true kill-switch always disables. Registry true still needs a known false kill-switch to establish enabled. No manifest-only fallback resolves an unknown registry.

The result is an enablement calculation, never a completeness credential. The helper does not resolve source roots, evaluate the kill-switch, guess feature flags, read files, select plugins, emit active effects or admit a provider. Closed production acquisition must later supply guarded observations and bind the reviewed rules. Do not add a version allowlist, environment toggle, public qualification schema or synthetic production adapter.

Write tests before the implementation. Retain initial module-discovery errors honestly; they do not replace the retained meaningful issue3 unchanged-production RED. Exercise all known combinations and targeted unknown propagation, explicit false overrides, nil/absent overrides, builtin/setup behavior and independence from manifest-only guesses. An independent finite-completion oracle may verify every partial assignment; its full-boolean formula must remain visibly separate from the implementation approach. Keep test-only fixtures in tests.

Run focused tests, typecheck and build. Return exact commands, observed failures, changed paths and a self-review. Do not commit or push. The coordinator freezes the result for fresh Astra Ultra and Argon high reviews, verifies findings and integrates only after that gate. Complete issue3 and whole-suite acceptance remain open.

## Plan ruling

The reviewed successful-conversion formula is independent of the remaining registration/root bindings. Implementing this calculation does not promote provisional graph decisions. It reduces the later integration task while the source-only registration check runs.

Language check: provisional Issue 9-oriented candidate. Protected formulas and literals are exact. No full dictionary conformance is claimed.
