# Issue #1 validation record

Selected baseline: `22782d25097dec67daa38203362b9ad4ba78e680`, branch `dev/issue-1-first-use`. The task-owned worktree began with only the coordinator's untracked spec/plan files. No other checkout's implementation or private helper files were copied.

## Baseline RED

Before any implementation edit, `npm test -- --maxWorkers 2 test/pilot/entry.test.ts` failed two behavioral assertions: shipped `native --help` and E2 `native --check-config` both returned `{"error":"USAGE","detail":"USAGE"}`. Fixture provenance is the public issue E2 roster, copied verbatim. Existing controller modules were unchanged for this run.

A second semantic probe extracted the exact selected commit with `git archive`, linked only the already-installed project dependencies, compiled that pristine source snapshot, then ran `node test/pilot/baseline-probe.mjs /temporary/baseline`. It failed both independent assertions: the baseline rejected the exact E2 roster with CONFIG_INVALID, and native qualification returned UNQUALIFIED_ROUTE. This second replay was performed after implementation began, against pristine selected-baseline bytes; it is supplementary baseline evidence, not a claim that all these assertions were run before implementation.

## Submitted offline evidence

`npm test -- --maxWorkers 2 test/pilot test/config` passes the submitted configuration/compatibility, shipped-entry/packaging, native command-adapter progression, bootstrap failure matrix, proof reuse/foreign/expired/version/control drift, disagreement, malformed bound result, unknown lifecycle, restart fencing, and official-client runtime binding checks. Latest focused checks pass39 tests /11 files; typecheck and build pass. The broad rerun passed629 tests /52 files in315.07 seconds; it started before the final small catalog-denial correction, which is independently covered by the exact final focused run. An isolated index snapshot passed fresh offline dependency installation (`npm ci --offline --ignore-scripts`), build, the shipped native entry and all39 focused tests. Install scripts were disabled for this pilot packaging smoke; this does not qualify a fresh native SQLite installation for the retained controller.

All positive workflow fixtures are synthetic. Runtime API settings/model-catalog shapes, worker-show ownership/requested/effective fields, and worker-read transcript/messages/blocks/sourceIdentity/provider shapes were inspected on Orca 1.4.244 on 2026-10-29. Synthetic successful launch/probe/release/results complete those shapes at the external command boundary. Verified-control positive fixtures describe conditional interface behavior; the current host did not expose those full controls. They are not real provider calls, native qualification or acceptance. Tests also inject the official-client read boundary; no credentials are required.

The pilot has three equal voters, a separate nonvoting judge, eight maximum qualification calls and exactly ten topic calls. Cursor `grok-4.7-xhigh` retains logical xhigh in the exact model identifier and receives no native effort override. Unconditional unanimity is required; disagreement remains unresolved.

## Real read-only observations and live gate

Inspected host: local macOS, already-running Orca 1.4.244; AGY 1.4.10; Codex 0.164.0; Cursor 2026.10.22-27dcf5f. Runtime/workspace metadata, settings.getAgentLaunch, and agentSession.modelCatalog were read without inference. The production API wrapper uses the official exported RuntimeClient from the canonical selected Orca installation, with version and runtime-ID checks; no pilot code reads or stores transport authentication. The exported client was positively exercised by a read-only settings request after replacing the prototype transport.

The native catalog exposes Codex and AGY account selections; Cursor's native catalog was unexposed, but its supported non-inference `cursor-agent models` lists the exact E2 selection. AGY's documented `/usage` command returned an empty conversation ID, zero turns and zero tokens. These reads do not establish scoped execution or billing-source binding.

Required missing facts remain:

- WorkerStartParams exposes model/effort but no per-entry mode, sandbox, roots, tool/helper/hook controls. `agentSession.options` requires an existing session. Saved full-access defaults are not technical proof of contained supplied-text execution.
- Cursor's included Premium debit-source binding is unverified; model catalog and authentication do not prove it.
- Required Codex/Cursor allowance observations and complete positive provider-tree lifecycle qualification are not established by the inspected prelaunch APIs.

No provider inference was launched by the implementer. The coordinator owns the separate-project run through the shipped entry. A9 is pending, and issue #1 remains open. Fresh independent review uses `claude-opus-5-5-medium` at `medium`; this implementer's self-review is not that review.

## Delivery limits

This is a reviewable partial implementation. The actual native inspector currently blocks before all dependent inference because scoped prelaunch controls are unresolved. A3–A7 positive progression is demonstrated only with synthetic verified-control fixtures, not a current qualified production route. The CLI automatically loads/writes its own strict qualification cache with scope matching, native archive revalidation and a serialized writer lock; an existing run ID still fences duplicate inference. It does not accept caller-authored proof files. Package allowlist, symlink/foreign-cwd invocation and an isolated fresh offline source/dependency installation are tested; standard native-addon setup and live A9/A10 acceptance remain coordinator gates. Do not describe this as an operationally completed repair.
