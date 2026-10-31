# Gemini startup source repair verification

The scoped AGY source repairs pass 172 covering tests, all 1,056 full-suite tests, typecheck and build. Independent change review remains pending. Gemini operational qualification remains open: Council still requires existing enrollment metadata, complete hook/source audit evidence, and a verified effective empty-tools boundary before input.

Evidence was collected on local macOS on 2026-10-30 (2026-10-31 UTC), starting at `6b5378ef60fac4c302cd4422deb3258fd6a4ce2b`. Private paths, runtime identities, account data and configuration payloads are omitted. The machine-readable companion is [gemini-startup-receipt.json](gemini-startup-receipt.json).

## Observed acquisition before and after the repair

| Observation on installed AGY 1.4.12 | Baseline | Repaired build |
| --- | --- | --- |
| Successful recognizable stderr-only public help | Rejected | Acquired and fingerprinted |
| Recipe available | No | Yes |
| Bootstrap aggregate | Unsupported | Missing prerequisites |
| Public CLI capability contract | Version-only refusal | Every actual recipe flag required |
| Startup/source acquisition contract | 1.4.11 only | Separate inspected 1.4.11/1.4.12 gate; future versions blocked |
| Exact packet enrollment metadata | Missing | Missing |
| Startup hooks and plugins | Unknown | Unknown |
| Effective input controls | Unknown | Unknown |
| Provider spawned / input delivered / model calls by acquisition | No / no / 0 | No / no / 0 |

The coordinator repeated acquisition through the built inspector after the repair without a native audit-disposition reader. Its protected-file digests were unchanged. `HOOK_DYNAMIC_CLOSURE_UNAVAILABLE` remains unresolved. Enrollment is a Council prerequisite; the receipt does not establish an actual AGY trust refusal. No enrollment, trust, global permissions or hook settings were changed for this repair.

## Four diagnostic initialization probes

The coordinator retained four real AGY diagnostic probes: the intended packet definition, explicit packet-directory discovery, a one-read-tool definition contrast, and an init-schema check. Every probe withheld user input, reported the exact Argon model and `request-review`, advertised the same 60 tools, and exited 0 after stdin EOF. Each receipt records empty stderr, no remaining observed process, an absent process group and unchanged protected files. The packet probes exposed `council-packet`; the read-tool contrast exposed its separate probe agent. All init captures expose `model`, `agent`, `cwd`, `permission_mode` and `tools`.

Explicit `--add-dir` with the exact packet cwd made the packet agent discoverable in the coordinator's `agy agents` contrast. It did not remove the 60 advertised tools. Empty-tools and one-read-tool definitions therefore do not prove the required main-agent capability ceiling. No tool was exercised, so these captures establish neither effective tool denial nor permission bypass. Requested effort was explicitly `high`; backend effort is provider-managed and not exposed by init.

These were zero-input initialization diagnostics. They were not a Council question, discussion, successful qualification or native readiness run.

## Source changes and RED evidence

The wrapper now requires the exact selected AGY agent whenever its recipe binds one. It also awaits queued AGY parsing and rejects a known error immediately before call reservation and the single input mutation. Existing Codex behavior is retained; the new guard is scoped to AGY. Cursor and post-input rules are unchanged. The nonempty-tools rejection remains intact.

Acquisition accepts only successful recognizable AGY help, rejects mixed diagnostics, and checks `--model`, `--effort`, `--agent`, `--add-dir`, `--mode`, `--sandbox`, `--settings`, `--input-format`, `--output-format` and `--print-timeout`. Public syntax acquisition is independent of version strings. A separate startup/source-contract fact covers inspected 1.4.11 and 1.4.12; complete help does not admit an unreviewed future source contract. Version, executable, help and source fingerprints remain bound to the evidence.

The recipe adds only its existing exact packet cwd for discovery and keeps source-bound agent materializations and collision checks. Bootstrap agent evidence is named generated definition metadata; actual agent selection and empty advertised tools remain effective input checks.

Before production edits, both source digests matched the baseline:

| File | Baseline SHA-256 |
| --- | --- |
| `src/pilot/provider-controls.ts` | `e28033a162760ca43ad3899ceda8e1a2b2b0589340ccebafa52c6e3ff2728bf4` |
| `src/pilot/provider-session.ts` | `bf9a2a7ddca359c30a20dccb8f7ca9e5354601f8d7c9b151ea5a8966c95dfcf0` |

The unchanged-production RED command was:

```sh
npm test -- --maxWorkers 2 test/pilot/provider-controls.test.ts test/pilot/provider-session.test.ts
```

It exited 1 with **16 expected assertion failures and 131 passes**. Failures covered 1.4.12 stderr help, eight unchecked recipe flags, three malformed/mixed-help cases, missing packet discovery, absent/null agent and a parsed post-ready error. The two agent-identity fixtures actually completed with one delivered input call. The post-ready fixture also reserved and delivered one call after its child positively observed the wrapper's error-driven SIGTERM. Those delivered calls were offline fixture traffic, separate from the zero-input real AGY diagnostics. The captured 60-tool fixture already rejected input and remains a protective characterization.

The first narrow repair passed all 147 focused tests. A coordinator clarification then required a separate future-version source gate. Before adding that guard, an intermediate RED run reproduced one failure with 22 passes: version 9.9.9 with identical complete help incorrectly had verified bootstrap. After the guard, all 23 acquisition tests passed, including the complete captured 1.4.12 help/subcommand layout.

## Software verification and remaining acceptance

`npm run typecheck` and `npm run build` passed after the final source change. The first full `npm test -- --maxWorkers 2` run exited 1: **2 failures and 1,054 passes across 66 files**, in 322.61 seconds. The retained failures were:

- `test/pilot/fix5-regressions.test.ts > uses AGY four-field init with source-bound agent selection: normal`: its positive fixture omitted selected-agent identity and expected that omission to succeed.
- `test/pilot/control-audit.test.ts > prepares actual versioned hook sources, adopts only matching native owner disposition, and invalidates drift`: its positive fake help exposed only two of the ten recipe flags.

After that run settled, the coordinator authorized corrections to those directly affected fixtures. The context stand-in now exposes the selected agent when `--agent` is supplied; its wrong-agent branch remains. The audit fixture now uses the complete captured successful help. All audit ownership/drift assertions, missing/null-agent regressions and production gates remain intact. The four covering test files passed all **172 tests** in 76.74 seconds, and post-fixture typecheck passed. The separate full rerun exited 0 with **1,056 tests passed across 66 files**, in 322.43 seconds. The first failure log/result/manifest are preserved independently.

The first frozen manifest records 199 source, build and focused-test files; its SHA-256 is `5bab5ef246484acf2f6a80517f4387df53d60f19e628d6088c0c98fbd452eb6e`. The built wrapper producer hash is `2a54a48d830b6e29619d15381417ad0ca3216fa2cf6dd6e00be25bc8ced42620`. Production and build bytes were unchanged while that run executed and during the subsequent fixture corrections.

The final manifest covers **279 source, build, test and configuration files** with SHA-256 `d2cdc88670242d796c15268bb6fa082464f819b60b7ffdcf9160b12b9432d7e6`. Every recorded hash still matched after the successful full rerun; no source, build, test or configuration edit overlapped it.

Fresh independent Argon and native Astra change reviews and the coordinator's dispositions remain required. Operational ranking item #3 remains open until authentic Council startup satisfies every existing pre-input prerequisite, including enrollment, hook/source closure and actual main-agent tool containment. Software test success does not supply that runtime evidence.

The official [headless stream documentation](https://antigravity.google/docs/cli/headless/) describes the exposed selected-agent and tools fields. The [custom-agent discovery documentation](https://antigravity.google/docs/subagents?tab=cli) describes workspace and global agent locations. These references support the interface interpretation; the host-specific observations above are retained execution evidence.
