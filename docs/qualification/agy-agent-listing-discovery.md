# AGY agent listing discovery

On 2026-11-01, the original four isolated AGY 1.4.12 metadata checks provided a global positive control. The completed workspace follow-up supplies the narrower diagnosis: the earlier cwd-only commands omitted explicit `--add-dir` workspace selection. Both follow-up commands with `--add-dir` listed `council-listing-control`; the repository marker alone remained empty. This conclusion applies to the recorded metadata cases. Complete issue 3 and production witness qualification remain open.

The recorded executable was `/Users/aaat/.local/bin/agy`, SHA-256 `34423fc9b0af3841e7646aa72a2d40ffeab8218b22d1cb99eac7355f9eba31e3`. Both fixture maps bind that hash. This correction reads existing files and hashes; it does not execute or freshly qualify the binary.

| Original case | Placement | Frontmatter | Exact stdout as JSON | Elapsed seconds |
| --- | --- | --- | --- | --- |
| workspace-minimal | workspace | minimal | `""` | 0.53 |
| global-minimal | global | minimal | `"council-listing-control\n"` | 0.533 |
| workspace-explicit | workspace | explicit | `""` | 0.508 |
| global-explicit | global | explicit | `"council-listing-control\n"` | 0.59 |

All four original receipts record exit 0, empty stderr, no signals, complete output collection, an absent command group, unchanged protected files and no model prompt. Their batch table records no remaining exposed owned PIDs. These are recorded observations; this preparation did not rerun those commands or independently inspect live historical processes.

Workspace definitions were placed at `<case cwd>/.agents/agents/council-listing-control/agent.md`. Global definitions were placed at `<case HOME>/.gemini/config/agents/council-listing-control/agent.md`, seeded after the supervisor's empty-HOME assertion. The four original inner argv values were all `[/Users/aaat/.local/bin/agy, agent]`.

The minimal control defined `name`, `description` and `tools: []`. Its file SHA-256 was `6fda4b0e1790c99b625845be8766133ddc0807b11a4956ec7c2accf6416d0787`. The explicit control added the following exact fields:

```yaml
mainAgent: true
subagent: false
commandExecutionPolicy: off
mcpServers: []
skills: []
plugins: []
```

Its file SHA-256 was `d20b8930cc74676c0cc0464535029c888485264f4539fbe9bb4c6ab43d017674`. All four definitions used the same inert body, SHA-256 `9737468584a00a86ac9ac21e05b308ff4b9b7db81b97716e586267166bac7c80`: “This is an inert listing fixture. Do not execute this agent or perform any actions.”

The source receipts and fixtures are in `.superpowers/sdd/2026-11-01-issue-3-inventory-witness/agent-listing-location/` under the hosting repository. `batch-result.json` has SHA-256 `0c7b467292edbbec85a2c56a6449f2e4eb6da24dc4f720a53eb872b4163fd6d1`; `fixture-map.json` has SHA-256 `7c7a7bad648645ad0481c5b1c7b77ec3d508b2e327de229220286ce4a68c57a8`. Preparation compared each case's `completion.json`, `stdout.txt` and `stderr.txt` with the batch result; they agree.

The four follow-up cases under the adjacent `workspace-agent-listing/` directory have completed. The immutable `fixture-map.json` describes preparation time, so its `executed: false` and empty-HOME fields are historical. Runtime results come from `batch-result.json`, each case's `started.json`, `completion.json`, `stdout.txt`, `stderr.txt` and `coordinator-check.json`. Help had empty HOME and cwd at preparation. The other cases used the exact explicit workspace seed and no global seed. The git and both cases included inert repository markers, without hooks or remotes.

In this table, `agy` means the exact executable above and `<case cwd>` means the mapped absolute cwd of that row. The actual successful form was `[/Users/aaat/.local/bin/agy, --add-dir, <absolute case cwd>, agent]`.

| Follow-up case | Inner command | Repository marker | Exact stdout as JSON | Exact stderr as JSON | Exit | Elapsed seconds |
| --- | --- | --- | --- | --- | --- | --- |
| help-agent | `agy help agent` | absent | `""` | `"Usage: agy agent [flags]\n\nList available agents\n\nFlags:\n  -h      Show help\n  --help  Show help\n"` | 0 | 0.143 |
| workspace-add-dir | `agy --add-dir <case cwd> agent` | absent | `"council-listing-control\n"` | `""` | 0 | 0.69 |
| workspace-git | `agy agent` | present | `""` | `""` | 0 | 0.523 |
| workspace-both | `agy --add-dir <case cwd> agent` | present | `"council-listing-control\n"` | `""` | 0 | 0.596 |

Help wrote 96 bytes to stderr and zero to stdout; its output identifies `agy agent [flags]` as the listing subcommand. Each successful listing wrote 24 stdout bytes. All four follow-up receipts record exit 0, no signals, complete output collection, an absent command group, unchanged protected files and no model prompt. Their batch records contain no remaining exposed owned PIDs and `inputHashesUnchanged: true`. These are historical settlement receipts, not a fresh process inspection by this author.

The narrow explanation is explicit workspace selection missing from the earlier isolated diagnostic, even though it supplied cwd. A repository marker alone did not correct it. The successful cases retained `settingsExists: false`; no fake settings or trust configuration was added. These receipts provide no basis to attribute the empty listings to login, trust or Orca, or to infer universal loader rules.

R1 is corrected here: preparation evidence survives in `workspace-agent-listing/fixture-map.json`, `source-diff.patch`, the runner sources and `review-input/coordinator-check.json`. The latter's `reportLimitation` records that the launcher's output-last-message replaced `sol-prepare/report.md` with the short final author response. The surviving short file cannot substantiate the lost detailed report or additional historical checks. This correction reconstructs only what the surviving primary files establish. The new detailed report is `evidence-finalization/report.md`; the supervisor stores the separate short response in `evidence-finalization/worker-response.md`.

The accepted supervisor source SHA-256 is `98bde9e4555a5c90f91934e88d75d568d06eb6ab4dfae5c8b8beaf94a3764383`. Its two existing argv literals, at lines 14 and 114, are the only changed source sites in the three cases with different argv; the repository-only case is byte-identical. The coordinator ruling in `review-input/coordinator-check.json` resolves the earlier three-occurrence wording against these two actual sites. The map is a separate command representation; no extra executable site was added.

Council already includes `"--add-dir", cwd` in the generated AGY argv at `src/pilot/provider-controls.ts:262`. That source fact does not establish runtime success, but it means the diagnostic omission does not prove a production launch defect. No production source change is warranted by this matrix, and none is made here.

This document remains a candidate for coordinator installation at `docs/qualification/agy-agent-listing-discovery.md`. The earlier Astra and Argon reviews cover the frozen preparation packet, not these corrected runtime conclusions. Fresh Astra Ultra and Argon high review of identical corrected bytes, coordinator disposition, settled author ownership and installation remain pending. Exact evidence and read/hash checks are in `evidence-finalization/verified-evidence.json` and the separate detailed report.

Tasks 5–7 of `docs/superpowers/plans/2026-11-01-issue-3-inventory-witness.md` remain provisional for production. Task 5 needs release/binary-bound evidence for each encountered path/boundary, selection/order/selected-agent translation, inheritance membership and defaults, enablement store/override/initializer state, native component contribution and normalization decision, or proof the condition cannot affect the input. Empty arrays do not establish `inheritCustomizations` or `inherit_user` defaults. Task 6 requires qualified rules plus justified static/bookkeeping source partition and live reconstruction at preparation, adoption and reuse, including current context, executable, selected-agent and settings bytes. Task 7 requires pre-spawn reconstruction, exact post-materialization files and parent custody, and evidence for actual assignment profile/PATH/bookkeeping participation. Consumed input changes require a matching new audit; unresolved participation blocks qualification or launch. Listing does not supply these prerequisites.

Metadata listing does not qualify agent execution, hooks, plugins, provider startup, permissions, authentication, production inventory integration or a complete loader graph. Council must not switch to global agents based on these receipts. The approved conditional production design remains in force.
