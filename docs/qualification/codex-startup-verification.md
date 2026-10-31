# OpenAI and judge startup follow-up

This follow-up repairs ranked blocker #2, the shared Codex startup and pre-input path. Both actual roles reached ready on functional commit `6b45c327ef32d6933f6243f6c8df4cdf551f23a8`: OpenAI `gpt-6.1-sol/max` and judge `gpt-6-astra/max`. No question input was sent. This does not complete issue #1 or qualify a full Council discussion.

## Cause and changes

The pending native audit was an intentional gate, not an Orca error. Council had several compatibility errors in its Codex adapter:

- It expected raw control fields in Codex's typed `config/read` projection. Those fields live in ordered raw layers. The checker now validates both views, skips disabled layers, preserves every inherited Deny and checks managed requirements separately.
- Interactive model and approval selectors do not provide the app-server's root configuration overrides. The kernel now pins model, provider, effort and approval with `-c`, then checks the selected thread and permission profile before input.
- It required executable-effect approval for inactive notifier, hook and cached plugin sources. In the exact owned kernel, `plugins=false` produces an empty plugin outcome, while `hooks=false` and `notify=[]` suppress those handlers. Source fingerprints and the authenticated platform startup audit remain required.
- It quoted MCP/plugin names in the left-hand dotted CLI path. Codex parses only the value as TOML and splits the key literally. This created a different quote-containing MCP entry without a transport. The fix aggregates names into one root TOML value per map, preserving original names and lower-layer transport settings. The fixture now follows the real CLI parser.
- It rejected the documented disabled remote-control startup notification and expected the wrong initial thread-notification shape. Only valid disabled status notifications and the exact initial thread snapshot are now accepted before input. Active, malformed, foreign, duplicate and post-input events remain stopped.

The new negative matrix also proved an existing Codex race: an error parsed after `prepared.ready` could still be followed by input while child closure lagged. A Codex-only check now awaits current parsing errors before reserving the input mutation. Both new handlers require zero reserved calls and no delivered input.

The production `includeLayers:true` request and instruction-path comparison were already correct; their new coverage is not a repair of missing production behavior. Codex 0.164 already rejects legacy profile selection, so Council's new raw-profile guard is conservative admission checking, not evidence of a live upstream overlay exploit.

Primary evidence is the installed Codex 0.164 schema and the official `rust-v0.164.0` source: [typed config and layers](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/app-server/src/config_manager_service.rs), [CLI key/value parsing](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/utils/cli/src/config_override.rs), [literal dotted paths](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/config/src/overrides.rs), [plugin suppression](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/core-plugins/src/manager.rs), and [response-before-notification ordering](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/app-server/src/request_processors/thread_processor.rs).

No dependency, Orca version guard, global permission, trust, remote-control setting, account or billing change is included. Gemini and Cursor production paths and broader post-input protocol handling remain outside this follow-up.

## Recorded verification

Implementation commits are `b77f53c`, `d6519ae`, `0def263`, `1d41511` and `6b45c32`. Meaningful RED preceded each production amendment. The final focused run passed 266 tests in eight files, followed sequentially by typecheck and build. The final full suite on frozen `6b45c32` passed **1,031 tests across 66 files**, exit 0, in 324.50 seconds. All **329 source/build files** matched the pre-run manifest afterwards.

An earlier full run at `d6519ae` returned 892 passed and one `WRAPPER_NATIVE_COMPLETION_UNVERIFIED` failure in the uncertain-close cleanup case. Its cause remains unproven. Intermediate full runs passed 938 tests at `0def263` and 941 at `1d41511`. Later passing runs do not explain that earlier failure; no separate cleanup/integration fix is included.

The real check ran the built public `runProviderSession` path in genuine Orca background terminals. It used exact, coordinator-inspected audit hashes, complete built-file and manifest pins, native Task/Dispatch provenance and the existing public audit adoption path. Only the known `codex-platform-runtime-reads-and-state` effect was approved; it granted no unknown effect or full provider qualification. A fresh role directory never received `input.json`. Cancellation was requested after an authentic `prepared.ready` receipt.

Failed attempts are retained:

1. At `0def263`, OpenAI exited 1 before initialization with `PROVIDER_STDERR_UNCLASSIFIED`; judge was not attempted. Raw stderr was not retained. A separate metadata-only config load with the same overrides exposed the malformed MCP transport entry. The corrected kernel then loaded with exit 0, empty stderr and unchanged config bytes for the host's 12 MCP and 24 plugin entries.
2. At `1d41511`, startup emitted protocol output with empty stderr but stopped before readiness. The initial private sanitizer reduced the error to `HARNESS_OPERATION_FAILED`.
3. A diagnostic-only repeat on the same production commit preserved fixed source error codes and schema-known method names without payloads. It recorded `PROVIDER_STREAM_EVENT_UNSUPPORTED` after initialize and `remoteControl/status/changed`.

All three attempts had zero calls and no delivered input. Their native tasks/processes settled, protected files stayed unchanged and their exact terminals were closed. The diagnostic repeat changed no production admission rule.

The fourth actual attempt on `6b45c32` reached ready for both roles. Each reported the requested model and `max` effort, provider `openai`, approval `never`, active profile `council_packet`, matching cwd, null managed requirements and valid typed/raw configuration. Both real traces included disabled remote-control status and `thread/started`. Readiness verifies the checked `thread/start` response; the probe does not separately persist whether the notification was validated before cancellation. Each had zero calls and no delivered input.

Both were deliberately cancelled before any question, returning `PROVIDER_INITIALIZATION_CANCELLED`. Both required **SIGKILL**; provider exit codes remain **null**, not zero. Groups, observed descendants, timers and native tasks settled, protected files were unchanged and exact terminal closure was verified. These receipts establish startup readiness and owned shutdown only. They do not establish graceful cancellation, normal inference, universal containment or provider/action qualification.

The [sanitized receipt](codex-startup-receipt.json) retains exact counts and outcomes. Private task artifacts retain complete native identities, source pins, test logs and review receipts. Public evidence contains no raw config layers, instructions, endpoints, remote identity values or native session IDs.

## Review and remaining boundaries

The first exact Opus 5.5 medium task review returned conditional spec PASS and Needs fixes. Its attempted `ls` was blocked by the existing command Deny; no command ran and no permissions changed. That attempt was not clean acceptance. Fresh exact-model reviews used explicit known packet paths, with no denied listing retried. Scoped re-reviews of rounds 1–4 marked the load-bearing findings addressed and reported no new Critical or Important breakage.

A read-only packet-source URL initially used the wrong folder. The correct tagged thread processor was independently fetched and confirms response-before-notification ordering; the final review receives that excerpt. This was a source-evidence packaging correction, not a provider error or access refusal.

Whole-change independent review is pending at this record's preparation. Its final verdict will be appended after the frozen change and runtime evidence are reviewed.

Retained limits include conservative rejection of unfamiliar managed fields, opaque provider overrides and some escaped control-character names; incomplete fixture emulation of structured feature merges; a transient partial prepared-file read that fails closed; installed SDK/dependency trust and normal check/use races under the frozen-artifact rule. The real no-input traces observed startup notifications before cancellation; normal input timing and broader post-input protocol compatibility remain unqualified. Existing production local `result.json` raw-stdout persistence is unchanged, as it existed on the earlier failed path too. The private harness stores sanitized metadata and hashes instead.

The PR remains a draft. Other issue #1 gates, including Gemini trust/startup, Cursor controls and included-only billing, generic active-hook closure and complete live qualification remain open.

## Rulings and costs

- Preserve the native audit gate and repair only demonstrated Codex mismatches. If wrong, reverse the scoped code/tests and repeat qualification; no global grant was added.
- Exclude inactive plugin caches only for the source-proven suppressed kernel. If that phase assumption changes, restore acquisition and reverify; active or unknown effects remain stopped.
- Treat the actual MCP quoting failure as startup scope, fixing encoding and fixtures rather than global config. If wrong, reverse the narrow change and repeat frozen checks and audit acquisition.
- Handle only valid disabled remote-control notifications before input. If wrong, reverse that handler and requalify; it changes no remote setting or permission.
- Bind the initial thread notification to the checked response before input. If wrong, reverse the startup handler and repeat qualification; no new effect authority is created.
- Keep identity values out of task evidence without redesigning existing production raw-report persistence. If wrong, local reports may retain identifiers/raw config and need a separate redaction fix; none is published here.
- Add the proved parsed-error check before Codex input reservation. If wrong, reverse the scoped guard/tests and reverify; a valid session may otherwise stop conservatively.
