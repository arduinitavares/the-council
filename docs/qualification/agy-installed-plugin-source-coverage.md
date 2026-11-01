# AGY installed-plugin source coverage increment

This increment repairs the reproduced current-store acquisition omission. It does not complete issue #3, close parent #1, or qualify provider startup. The complete #3–#10 objective and the conditional complete-inventory design remain in force.

Acquisition now watches `~/.gemini/config/plugins` alongside the existing `~/.gemini/antigravity-cli/plugins` and workspace `.agents/plugins` roots. Each safely inspected root is fingerprinted as directory metadata or explicit absence. Discovered plugin directories are fingerprinted as metadata. Candidate `plugin.json`, `.antigravity-plugin/plugin.json`, `.gemini-plugin/plugin.json`, `.claude-plugin/plugin.json`, and `gemini-extension.json` files are read with the existing strict JSON reader and tracked as source bytes. Missing candidates are watched for appearance. Plugin-root `hooks.json` uses the existing hook reader and effect audit.

These candidate names establish neither manifest precedence nor activation. Candidate metadata, including `disabled:true`, does not resolve enablement; it leaves inventory unavailable. Hookless directories also remain unresolved. Observed root hooks contribute potential effects through the existing conservative extraction, without certifying that the loader activates them. No manifest declarations are followed and no packaging hooks are promoted into runtime sources.

All path components are checked before candidate-byte acquisition. Symlinks, dangling roots, invalid directory/file types, inventory failures, and unreadable hook or metadata sources keep startup nonverified and emit `AGY_PLUGIN_INVENTORY_UNAVAILABLE`. A dangling root is recorded as link metadata, not absence. The existing 100-entry directory and 1 MiB JSON bounds remain. The existing authenticated disposition path cannot discharge unavailable inventory.

Real acquisition tests use isolated fake HOME/workspace directories and an executable that accepts only `--help`, emitting the captured AGY 1.4.12 help fixture. They cover a current-store command hook with an independent workspace control, every metadata spelling, absence/appearance, observed directory membership changes, removal, byte drift, disabled metadata, unsafe paths, malformed/oversized inputs, and the enumeration boundary. The fake command is awaited before fixture cleanup; environment changes are restored. No real provider inference or AGY command is run.

Verification uses the following bounded commands, with build before tests that import `dist`:

```sh
npm test -- test/pilot/agy-installed-plugin-sources.test.ts
npm run typecheck
npm run build
npm test -- test/pilot/provider-controls.test.ts test/pilot/control-audit.test.ts test/pilot/agy-installed-plugin-sources.test.ts
```

The first three commands have 60-second outer bounds; the combined test command has a 90-second bound. Full command receipts and RED/GREEN output are retained in `.superpowers/sdd/2026-11-01-issue-3-source-coverage/author/`.

Remaining complete-inventory work includes an authoritative loader contract, enablement and declaration resolution, complete source ordering, and the inventory witness/revalidation lifecycle. Ordinary directory metadata detects observed changes; membership changes with restored metadata still require that witness. Sequential component checks do not establish atomic custody against concurrent replacement. Effective startup, containment, billing, repeated full-suite stability, separate-project acceptance, independent review, and operational acceptance remain separate campaign requirements. The package-wide suite is deliberately outside this task's approved verification; its known #8 failure has a separate pending design.
