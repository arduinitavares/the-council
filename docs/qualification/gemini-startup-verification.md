# Gemini startup source repair verification

The final AGY parser repair passes 52 acquisition tests, all 1,085 full-suite tests, typecheck and build. The initial reviews led to parser and provenance corrections. Scoped re-review of functional revision `c14a24c78c054d335202dcf77742d2eb72271fc8` by Argon high through Orca and native Astra at max effort approved those corrections with no new findings; the coordinator verified their claims against the actual diff, frozen evidence and executed parser counterexample. Gemini operational qualification remains open: Council still requires existing enrollment metadata, complete hook/source audit evidence, and a verified effective empty-tools boundary before input.

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

The coordinator retained four real AGY diagnostic probes: the intended packet definition, explicit packet-directory discovery, a one-read-tool definition contrast, and an init-schema check. Every probe withheld user input, reported the exact Argon model and `request-review`, advertised the same 60 tools, and exited 0 after stdin EOF. Each receipt records empty stderr, no remaining observed process, an absent process group and unchanged protected files. The packet probes exposed `council-packet`; the read-tool contrast exposed its separate probe agent. The first three receipts retain only a sanitized projection containing `model`, `agent`, `cwd`, `permission_mode` and `tools`; their raw init key names were not retained and remain unknown. Only the fourth probe retained raw key enumeration, in observed order: `model`, `cwd`, `agent`, `tools`, `permission_mode`. Its keys are not inferred for the earlier probes.

Explicit `--add-dir` with the exact packet cwd made the packet agent discoverable in the coordinator's `agy agents` contrast. It did not remove the 60 advertised tools. Empty-tools and one-read-tool definitions therefore do not prove the required main-agent capability ceiling. No tool was exercised, so these captures establish neither effective tool denial nor permission bypass. Requested effort was explicitly `high`; backend effort is provider-managed and not exposed by init.

These were zero-input initialization diagnostics. They were not a Council question, discussion, successful qualification or native readiness run.

## Source changes and RED evidence

The wrapper now requires the exact selected AGY agent whenever its recipe binds one. It also awaits queued AGY parsing and rejects a known error immediately before call reservation and the single input mutation. Existing Codex behavior is retained; the new guard is scoped to AGY. Cursor and post-input rules are unchanged. The nonempty-tools rejection remains intact.

Acquisition accepts successful AGY help that matches the supported grammar and checks `--model`, `--effort`, `--agent`, `--add-dir`, `--mode`, `--sandbox`, `--settings`, `--input-format`, `--output-format` and `--print-timeout`. Public syntax acquisition is independent of version strings. A separate startup/source-contract fact covers inspected 1.4.11 and 1.4.12; complete help does not admit an unreviewed future source contract. Version, executable, help and source fingerprints remain bound to the evidence.

The help grammar requires the exact `Usage of agy:` heading and consistent ASCII-space declaration indentation, pinned by the first option declaration, with single or double dashes. Uniform legacy indentation is supported. Later outdented declarations are rejected; deeper continuation prose after an option does not contribute flags. An optional `Available subcommands:` section must contain at least one indented subcommand entry. Nonzero help, output on both streams, and lines outside this grammar are rejected. Text that fits the description grammar is not classified semantically; this is not a universal diagnostic detector.

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

The first frozen manifest records 199 source, build and focused-test files (66 source, 129 build and four focused-test files); its SHA-256 is `5bab5ef246484acf2f6a80517f4387df53d60f19e628d6088c0c98fbd452eb6e`. The built wrapper producer hash is `2a54a48d830b6e29619d15381417ad0ca3216fa2cf6dd6e00be25bc8ced42620`. All 199 recorded files remained unchanged across those two original attempts; three subsequent fixture corrections were outside that initial subset.

The original final manifest covers **279 files** (195 source/build, 78 test, five configuration and one script; public documentation is excluded) with SHA-256 `d2cdc88670242d796c15268bb6fa082464f819b60b7ffdcf9160b12b9432d7e6`. Every recorded hash still matched after the successful full rerun; no source, build, test or configuration edit overlapped it.

## Final parser and provenance corrections

The final wave started at `3ad31cfaa8272a70f920988019e6895ebeb077f0`. It pins declaration indentation once, keeps consistent one/two/four-space legacy help, ignores option mentions in deeper prose when acquiring flags, and rejects a present empty subcommand section. The complete captured help and legitimate wrapped descriptions remain accepted. The receipt now distinguishes retained projections in probes 1–3 from the fourth probe's actual raw key enumeration.

The initial unchanged-source API RED logged 26 failures and 25 passes before production edits. The coordinator withdrew two width-only negative cases and clarified that uniform legacy indentation must remain valid. Corrected fixtures reproduced 24 API failures and 28 passes against the hash-verified baseline build; this supplements the original RED. Every focused development attempt and fixture/assertion correction is retained, including intermediate failures. The final acquisition run passed all 52 tests.

Typecheck and build passed. The final full `npm test -- --maxWorkers 2` ran once after source/build/test/config/script freeze and passed **1,085 tests across 66 files**, with zero failures, in **321.71 seconds** (322.04 seconds wall time). A separate Node rehash checked all 279 frozen files against the Python-generated manifest with zero drift. That manifest contains 66 source, 129 build, 78 test, five configuration and one script file; it excludes public documentation. Its SHA-256 is `915fd6d5fee43e564eb09d3db8ae352a210c63cd3f93a71a14c76a60d2a9e544`. No further source changes or test reruns followed this full run.

Both initial independent reviews are retained. Astra identified the declaration/description ambiguity and requested fixes; Argon approved with minor follow-ups. The coordinator independently reproduced Astra's counterexample instead of accepting Argon's initial approval. Both scoped re-reviews of `3ad31cf..c14a24c` found F1–F3 addressed, M1 accurately deferred, and no new Critical, Important or Minor finding. The coordinator accepted the bounded source repairs after checking the code, test/log hashes, all 279 frozen source/build/test/config/script files and the separately committed public documents. Argon used file-read tools and did not independently hash files or run tests; native Astra inspected the frozen hashes. Neither review supplies operational qualification. Operational ranking item #3 remains open until authentic Council startup satisfies every existing pre-input prerequisite, including enrollment, hook/source closure and actual main-agent tool containment. Software test success does not supply that runtime evidence.

The official [headless stream documentation](https://antigravity.google/docs/cli/headless/) describes the exposed selected-agent and tools fields. The [custom-agent discovery documentation](https://antigravity.google/docs/subagents?tab=cli) describes workspace and global agent locations. These references support the interface interpretation; the host-specific observations above are retained execution evidence.

The coordinator deferred the preexisting post-ready no-input/error wait finding (M1). A child ignoring SIGTERM can delay forced cleanup until the assignment deadline; when no parser error was recorded, missing input can be reported as ENOENT. The final queued-parser barrier prevents the reproduced input delivery. This parser-only wave leaves the session wait unchanged; the deferred follow-up needs no-input and ignored-SIGTERM coverage.
