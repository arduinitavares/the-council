# Council offline Linux support implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish whether the unchanged discovery test can execute offline on the pinned Linux image, without treating that result as #8 acceptance.

**Architecture:** Freeze the approved working bytes and an explicitly supplied Linux dependency bundle before source transfer. A separately reviewed container supervisor owns staging, execution, observations, and exact removal. Run one unchanged discovery file only after input and custody gates pass.

**Tech Stack:** Existing Node `22.23.3` Linux/arm64 image, Python standard library, current TypeScript `7.0.2`, Vitest `5.0.5`, Vite `8.3.5`, and lockfile version `3`. Add no project dependency.

**Spec:** [Existing #8 plan](2026-11-03-council-parallel-test-fixtures.md), especially Tasks 1–6; [approved synthetic proposal](../../../.superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue8-linux-synthetic-spike-proposal.md). The proposal permits only separate offline execution planning after a passing spike. This document does not approve source staging or test execution.

## Global Constraints

- Worktree: `/Users/aaat/.codex/worktrees/council-first-use/the-council`.
- Observed HEAD: `3f3c3cdf63130d4aa27037c8f0d42ed5fd36dd8b`. HEAD alone does not identify the uncommitted candidate.
- Preserve reviewed #5 production, fixture, supervisor, and plan bytes. Preserve all other existing files and data.
- Preserve package manifests, lockfile, `vitest.config.ts`, suite concurrency, ordinary reporters, test timeouts, hook timeouts, and production admission rules.
- Use only image `sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392`, platform `linux/arm64`, Node `22.23.3`.
- Use the recorded `/usr/local/bin/docker --context desktop-linux` route only after future authorization and current identity verification.
- Require `--pull=never`. Pulls, builds, image substitutions, platform emulation, and automatic downloads are outside this plan.
- Keep network disabled, private PID/network namespaces, UID/GID `65534:65534`, dropped capabilities, no-new-privileges, and a read-only image root.
- Admit no host checkout mount, inherited mount, volume, credential, provider installation, account access, host daemon socket inside the container, or published port.
- Do not inspect or assume a host npm cache or host `node_modules`. Use only individually supplied, reviewed offline inputs.
- Keep raw command status, watchdog status, fixture cleanup, container settlement, and exact removal as separate observations.
- A failure stops the affected sequence. No undeclared retry, changed timeout, skipped assertion, or silent repair is permitted.
- The coordinator owns plan review, staging authority, execution decisions, reassessment, and acceptance. This author launches no helpers or review seats.

## Review Focus

1. A Darwin dependency tree can appear complete while required Linux native bindings are absent. Task 1 establishes target reachability; Task 2 checks the required packages.
2. The synthetic spike's `noexec` scratch cannot run the matrix's generated executables. Task 2 requires separately approved executable scratch and a positive execution observation.
3. Archive paths, symlinks, or inherited environment can escape the declared staging boundary. Tasks 1 and 2 reject unsafe members and undeclared inputs.
4. A timeout can restore another row's HOME while its original body continues. Task 3 preserves the unchanged matrix; the existing #8 causal RED remains mandatory.
5. Forced teardown can conceal application leftovers. Tasks 2 and 3 record pre-teardown resource state and reject cleanup uncertainty independently of container absence.

## Evidence and interpretation

Let `S` denote `.superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue8-linux-spike-20261104`. These are historical evidence files, not executable instructions for this author.

| Source | SHA-256 |
| --- | --- |
| Existing #8 plan | `5e261f9483aebc7fc5b69195eaec545716440eabbabae0f987df91ef6e8d33b8` |
| Synthetic proposal | `fa4a6ef768095d698585afc592c1d0d13867530dee5e0bd4d9e8aeab3518556e` |
| `S/preflight.json` | `77bd8808f67ec954d20feb68ea4d4c75a95521d95a7b9e6c835e7e706ca80d77` |
| `S/run-spike.py` | `2f7300492c34b1b1151269cf66c8e5010c8714ae941d0714d1464c046db83cfa` |
| `S/fixture.cjs` | `68084c633855202cfe0a1394174f0bd9b965dc2fe6efe1fcc2f1bdc70f2d3ba3` |
| `S/summary.json` | `064e1eb5743250b709fad490e5e4d4dc15031cccc2af496b74761c77e827f0aa` |
| `S/coordinator-verification.json` | `84dad31d46c0334b01c09fe09334ada99e96223d936650ae762c3975ddeccecf` |

The recorded engine was `29.9.2`. Its context endpoint was `unix:///Users/aaat/.docker/run/docker.sock`. That endpoint belongs to host-side control. It must never enter the container.

The three synthetic cases used a **20-second execution deadline and 15-second settlement limit per case**. These limits belong to that completed qualification.

| Case | Observed result | Cleanup evidence |
| --- | --- | --- |
| `clean-success` | Exit `0`; 1.803 seconds; no watchdog | Live root/listener/timer, followed by root absence, listener closure, and elapsed timer before exit. |
| `application-failure` | Intentional exit `23`; 1.812 seconds; no watchdog | The same positive cleanup observations before failure exit. |
| `watchdog-orphan` | Exit `137`; watchdog at 20.005 seconds | Original parent absent after exit `0`; live detached child adopted by PID 1, with session equal to child PID. Forced teardown followed. Application cleanup remained intentionally incomplete. |

Each case positively reported Linux/arm64, Node `v22.23.3`, PID 1, UID/GID `65534`, loopback-only interfaces, zero effective capabilities, no-new-privileges, read-only root, and tmpfs scratch. The runner also inspected configuration and running/stopped states. It checked ownership before signaling or removal. It preserved logs and confirmed exit through `wait`. It removed only the exact stopped owned ID without forced removal. Both exact ID and exact name were absent afterwards. Independent verification found zero matching owned labels.

The original fixture itself was PID 1. Its normal `0` and intentional `23` statuses therefore also describe container exit. They do not qualify status reporting for a supervisor that starts a separate payload. Task 2 proposes new checks for that distinction. The original approval and its 20/15-second limits remain exactly as recorded.

**No Council test code executed on the spike.** No npm command, source transfer, dependency installation, or provider operation ran there. It qualifies the recorded synthetic custody route only. It proves neither Linux package readiness nor Darwin custody.

### Current source facts

`test/pilot/discovery.test.ts:211–255` still contains eleven version rows. Each row allocates a fixture, changes four environment keys, connects through real synthetic CLI commands, and uses real `LocalReadRpc`. Its `finally` calls `vi.unstubAllEnvs()` and removes its root. `src/pilot/discovery.ts:38–42` compares canonical policy paths before the first command. The retained trace establishes late continuation and environment overwrite; a Linux pass cannot invalidate that mechanism.

`test/pilot/native-host-fixture.ts:9–57` creates executable files under `tmpdir()`, with shebangs naming `process.execPath`. Its `.app` path is synthetic test data. `src/pilot/rpc.ts` resolves the exported-client fixture under that path. No real Orca installation is required. `src/orca/client.ts:139` starts detached children. Namespace custody remains necessary after runner exit.

The matrix's omitted provider argument selects `readProvider`. Its executable names resolve through the fixture's prefixed PATH. A clean container must contain no real provider executables or provider configuration. The test's synthetic inference sentinel remains mandatory.

`package.json` defines `test` as `vitest run`. The configuration sets only `test/**/*.test.ts` inclusion. The existing plan records default `forks`, parallel files, 5000 ms tests, and 10000 ms hooks. This plan changes none of them.

`src/pilot/discovery.ts:330` calls `producerCodeHash()`. That reader hashes file bytes beyond the import graph. `src/pilot/wrapper-contract.ts:13–18` selects every same-extension sibling, sorts their names, and appends three external files. For this source run, these are all 32 `src/pilot/*.ts` siblings, followed by `src/orca/client.ts`, `src/domain/hash.ts`, and `src/workers/strict-json.ts`. Hash-input coverage must preserve the exact filename set as well as the bytes.

An independent literal import walk from the selected test and Vitest configuration finds 33 local files. Twelve hash-reader siblings are additional: `cli.ts`, `composition.ts`, `cursor-trust.ts`, `host-relay.ts`, `host-wrapper.ts`, `journal.ts`, `preflight.ts`, `provider-cleanup.ts`, `provider-session.ts`, `qualification-cache.ts`, `verify-proof.ts`, and `workflow.ts`. Their hash-input role does not execute their imports. The two apparent unresolved `require` strings in `effort-contract.ts` are AST comparison data, not module loads.

A Python standard-library calculation reproduced the reader's ordering, byte hashes, exact `file.slice(directory.length+1)` labels, and `canonicalJson` serialization. Working source and the proposed manifest projection both yield `bf3543b8998c1fb79bbaa3577643beb8709d27f7cad234693f6c2741528d3d73`. No product function or staged container ran. Preserve the reader's unusual external labels (`lient.ts`, `/hash.ts`, `s/strict-json.ts`) as hash data. They are not transfer paths. Do not normalize them or change the reader.

The 33-file walk has no `better-sqlite3` import. The named imports in `src/store/run-store.ts:6` and `src/runtime/reconcile.ts:199` are outside that walk. This observation does not prove every runtime dependency. Task 1 must establish package reachability, including runner transformations and optional native selection, before declaring an artifact mandatory.

The lockfile catalogs `@rolldown/binding-linux-arm64-gnu@1.2.15`, `@typescript/typescript-linux-arm64@7.0.2`, and `lightningcss-linux-arm64-gnu@1.33.0`. It also pins `better-sqlite3@13.0.3`, with `node-addon-api`, and contains no `node-gyp` or `prebuild-install` entry. These records prove neither availability nor target reachability. SQLite and the standalone TypeScript compiler are deferred build/typecheck/whole-suite concerns unless target reachability evidence establishes otherwise. An optional transformation binding becomes mandatory only when the pinned runner's actual loading path requires it.

### Frozen input anchors

Task 1 must compare these observed bytes. A legitimate later change requires a new reviewed manifest, not an ignored mismatch.

| File | SHA-256 |
| --- | --- |
| `package.json` | `1b6f18369113f0891323f91515120a33ff93ac600c05c76e23db974d7058035f` |
| `package-lock.json` | `7ab6ebf13b6bdafd028fb309ff112a878ad9ec189e548ec167bf11493583d2bd` |
| `vitest.config.ts` | `124d98777a76b86256fd3f9592b443bd48143ad0b0dcd4cf014975451c8c7cb2` |
| `test/pilot/discovery.test.ts` | `60875bd57d4b05324251b2d1ed8983cc38932f282d28488664a659f2a733ca8e` |
| `test/pilot/native-host-fixture.ts` | `7526bb1c6065cdad0f8ba4c6ab18aecdd46b7aa6d791316f4c652ef88b115715` |
| `src/pilot/provider-controls.ts` | `a8b09191bca1e95a515e3f695e0ca7917851ca337682042e3ab47c5b0443a9e1` |
| `src/pilot/cursor-trust.ts` | `8f4ccf5dadd0bdc53f15e8d4c020d37456528c2e324d6933d11ef66fe65c35e6` |
| `test/pilot/cursor-trust-acquisition.source.mjs` | `5e0a59019a73461d14ecc37dd74dbea2fc316e3940d102a272bffe10e649f649` |
| `test/pilot/cursor-trust-witness.source.mjs` | `adf2a8b59ae614be832f2a58a16498ecc07cd9aed63e82793810502aedbbe066` |

## Scope and exact deliverables

The sole deliverable of this author assignment is this plan. No execution or canonical service state changes are included.

Let `D` denote the proposed new evidence directory `.superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue8-linux-offline-20261104`. Every path below is proposed future work. Existing spike files remain immutable.

| Future artifact | Responsibility |
| --- | --- |
| `D/inputs/source-manifest.json` | Exact import and runtime hash-input allowlist, per-file hashes/modes/roles, producer hash parity, working revision, protected #5 hashes, and approval reference. |
| `D/inputs/dependency-manifest.json` | Target reachability and separately deferred checks, explicit offline origins, package/lock integrity, required platform/ABI/libc, sizes, and tree hashes. |
| `D/inputs/staging-packet.json` | Exact transfer members, stream hash, effects, limits, owner, grants, and review disposition. |
| `D/run-linux-offline.py` | Host supervisor; exact context/image checks, deadlines, bounded output, lifecycle receipts, and owned removal. |
| `D/container-entry.cjs` | Node PID 1; validated input receiver, dependency checks, one declared payload, and namespace observations. |
| `D/dependency-probe.cjs` | Only the target-required package/native checks established by Task 1, without importing Council tests. |
| `D/staging-qualification/`, `D/dependency-check/`, `D/discovery-baseline/` | Separate immutable command, output, resource, settlement, and absence receipts. |
| `D/staging-qualification/<case>/generated-output.json`, `D/dependency-check/generated-output.json`, `D/discovery-baseline/generated-output.json` | Separate inventory of attributed runner output, including exact paths, observed hashes, creation/removal evidence, and retained entries. Never an exemption for changed input bytes. |

No product, test, package, lockfile, or runner configuration edit is proposed in this support check. No source-correction task is executable here.

## Task 1: establish exact offline inputs — discovery only

**Owner:** Coordinator or its bounded input investigator. **Prerequisite:** Coordinator acceptance of frozen plan bytes. **Readiness:** Concrete read-only discovery; no Docker, npm, staging, or test execution.

**Files:** Read the anchors above, named #8 import paths, and only dependency artifacts explicitly supplied by the coordinator. Future writes are limited to the three `D/inputs/*.json` records.

**Interfaces:** Consumes this plan and named local artifacts. Produces either a hash-bound staging packet or a precise missing-input receipt. No dependency artifact has been supplied or verified by this author.

- [ ] **Step 1: run the first bounded static check.** Run the following exact command from the worktree. Its internal deadline is 30 seconds. Preserve its complete stdout, stderr, and exit separately. Stop this task on mismatch or deadline.

```sh
python3 -I - <<'PY'
import hashlib, json, signal
from pathlib import Path
signal.alarm(30)
assert Path.cwd() == Path('/Users/aaat/.codex/worktrees/council-first-use/the-council')
expected = {
    'package.json': '1b6f18369113f0891323f91515120a33ff93ac600c05c76e23db974d7058035f',
    'package-lock.json': '7ab6ebf13b6bdafd028fb309ff112a878ad9ec189e548ec167bf11493583d2bd',
    'vitest.config.ts': '124d98777a76b86256fd3f9592b443bd48143ad0b0dcd4cf014975451c8c7cb2',
    'test/pilot/discovery.test.ts': '60875bd57d4b05324251b2d1ed8983cc38932f282d28488664a659f2a733ca8e',
    'test/pilot/native-host-fixture.ts': '7526bb1c6065cdad0f8ba4c6ab18aecdd46b7aa6d791316f4c652ef88b115715',
    'src/pilot/provider-controls.ts': 'a8b09191bca1e95a515e3f695e0ca7917851ca337682042e3ab47c5b0443a9e1',
    'src/pilot/cursor-trust.ts': '8f4ccf5dadd0bdc53f15e8d4c020d37456528c2e324d6933d11ef66fe65c35e6',
    'test/pilot/cursor-trust-acquisition.source.mjs': '5e0a59019a73461d14ecc37dd74dbea2fc316e3940d102a272bffe10e649f649',
    'test/pilot/cursor-trust-witness.source.mjs': 'adf2a8b59ae614be832f2a58a16498ecc07cd9aed63e82793810502aedbbe066',
}
for name, digest in expected.items():
    assert hashlib.sha256(Path(name).read_bytes()).hexdigest() == digest, name
lock = json.loads(Path('package-lock.json').read_bytes())
assert lock['lockfileVersion'] == 3
assert lock['packages']['node_modules/vitest']['version'] == '5.0.5'
print(json.dumps({'sourceLockCheck': 'passed', 'dependencies': 'not-established',
                  'linuxExecution': False, 'testExecution': False}))
PY
```

Expected: exit `0` and the exact four-field JSON observation. This establishes source/lock consistency only. It grants no runtime eligibility. An exception, truncated output, or absent exit is a failed or unknown check.

All nine anchors are check inputs. Checking a file does not authorize its transfer. The two #5 `.source.mjs` fixtures are check-only here because this target does not execute or read them. Stage only files established by the import, runtime-reader, and asset manifest.

- [ ] **Step 2: freeze imports and runtime read inputs.** Enumerate the selected test, configuration, fixture files, transitive imports, and runtime assets. Add every file selected by the exact `producerCodeHash()` reader above. Record each exact relative path, size, mode, role, and SHA-256. Verify the 35 hash inputs and source/manifest digest parity without importing product code. Preserve all twelve additional siblings, including uncommitted `cursor-trust.ts`. A hash-only file does not make its imports executable dependencies. Preserve the #5 anchors. Exclude `.git`, `.superpowers`, host instructions/policy, real rosters, credentials, provider state, caches, and host `node_modules`. Use the test's existing synthetic policy/roster data. A missing input or unexpected same-extension sibling holds staging until the manifest is corrected and reviewed.
- [ ] **Step 3: establish target dependency reachability.** Trace runtime versus type-only imports and the supplied Vitest/Vite package loading paths as data. Include platform/libc selectors, transformations, and optional native loading. Give each mandatory artifact a path from `npm test -- test/pilot/discovery.test.ts`. Separate target-required artifacts from deferred build/typecheck/whole-suite checks. Do not require SQLite, the standalone TypeScript compiler, or an optional transformation binding merely because it appears in the lockfile. Unknown reachability holds only the affected readiness claim. Match supplied required packages and SHA-512 integrity against the unchanged lockfile. Record archive hashes and the installed tree's per-file SHA-256. Verify Linux/arm64 GNU artifacts where required. Reject wrong-platform required artifacts, missing required bindings, and escaping symlinks. Unselected optional packages are not target failures.
- [ ] **Step 4: resolve only demonstrated native preparation requirements.** Inspect the supplied required packages' scripts and binary metadata. Record their Node ABI and native/runtime library requirements. If a target-required artifact needs rebuilding, require pinned offline Node `22.23.3` headers and the actual build tools, compiler, and libraries. Availability remains unknown until checked. Missing prerequisites block that preparation route. They do not independently block a target that does not use it. Record TypeScript's Linux native compiler availability for later build/typecheck planning. Keep SQLite/native build validation deferred unless reachability proves a target need. Do not install or execute packages in this discovery task. Do not add apt, npm, npx, registry, or prebuild downloads.
- [ ] **Step 5: submit the staging packet and stop.** Name the exact source/dependency bytes, owners, receiver, writes, maximum sizes, and proposed child commands. Declare expected generated-output paths separately from pinned inputs and fixture roots. Record missing artifacts as missing. Do not search caches or manufacture an install attempt to resolve absence.

**Completion check:** A reviewer can identify every byte to transfer and its owner, or can identify the exact missing offline prerequisite. Hashing installed files alone does not establish package provenance. The coordinator must accept the packet before Task 2 can become eligible.

## Task 2: qualify source staging and Linux dependencies — provisional

**Owner:** Coordinator-assigned harness executor. **Prerequisites:** Task 1 evidence, fresh plan review, exact staging/execution authority, and reviewed harness bytes. **Files:** Only the proposed harness, probe, input records, and `D` receipts.

**Interfaces:** Proposed invocations are `python3 D/run-linux-offline.py qualify <case>` and `python3 D/run-linux-offline.py dependency-check`. The four allowed qualification cases are listed below. Replace `D` with its defined path. The dependency check consumes only accepted manifests and supplied byte streams. Each mode emits a structured receipt and bounded raw logs. These interfaces do not exist yet and are not executable instructions today.

The synthetic approval excluded source transfer. Future authority must expressly cover copying the approved source and Linux dependency bytes into disposable container scratch. It must also cover executing those dependency binaries. A host checkout mount remains excluded.

- [ ] **Step 1: review the staging implementation.** Transfer manifest-listed bytes through stdin to the nonroot Node receiver. Permit regular files and explicitly listed relative internal dependency links only. Reject absolute paths, `..` traversal, devices, special files, link escapes, duplicate members, and undeclared trailing bytes. Verify every digest before declaring staging complete. Check the exact producer-reader filename set and static digest parity against the accepted source manifest. Recheck every pinned input before execution and after settlement. Inventory generated output separately under the contract below.
- [ ] **Step 2: obtain the exact scratch disposition.** The spike used `/tmp:rw,size=16m,mode=1777,noexec,nosuid,nodev`. Propose `/tmp:rw,size=512m,mode=1777,exec,nosuid,nodev` for this distinct route. Cap accepted expanded inputs at 384 MiB, leaving scratch capacity for the test. These are explicit size and execution changes. They require review and authorization before use. Do not inherit the spike's passing qualification for them.
- [ ] **Step 3: qualify the new supervised payload boundary.** Propose the four disposable cases below for separate review and authorization. Use one fresh container per case, sequentially. Include safe transfer, executable scratch, environment-boundary observations, setup rejection, and detached-child custody. Pin the synthetic fixtures and image-bundled npm/shell bytes before execution. No Council source or staged project dependency executes in these cases. Expected negative outcomes count as qualification passes only when every declared observation matches. Stop the set after any unexpected status, missing observation, output overflow, access refusal, deadline violation, cleanup discrepancy, or unknown removal. Do not start the next case or retry.
- [ ] **Step 4: perform one target dependency check after qualification acceptance.** Use a fresh owned container with the accepted inputs. Verify Node `22.23.3`, Linux/arm64, and the libc/ABI requirements established by Task 1. Check only its proven target-required packages and native bindings. Verify Vitest `5.0.5` resolves inside the staged tree. Do not run unconditional SQLite, standalone `tsc`, Rolldown, or Lightning CSS probes without their target reachability evidence. No Council test runs in this step. Use 30 seconds plus 30 seconds settlement.
- [ ] **Step 5: return evidence and reassess Task 3.** Record native/toolchain unavailability separately from application failure. No npm install is included. If the supplied material cannot support execution, return a blocked offline-input result.

### Proposed supervised-payload qualification cases

All four cases have separate **30-second execution and 30-second settlement limits**. Qualification is conditional on review and authorization. These limits do not revise the completed spike's 20/15-second scope. Each case retains raw payload status, supervisor/PID 1 status, container inspect/wait status, watchdog outcome, cleanup, and exact removal separately.

| Case | Proposed synthetic input and positive observations | Exact limits and expected status |
| --- | --- | --- |
| `payload-success` | Safe manifest transfer; owned executable shebang probe; synthetic `package.json` with `probe` script `./owned-probe`. Payload is image-bundled `npm run probe`, with no install. Observe npm input environment and npm/shell-generated child environment separately. Observe live root/listener/timer, then their cleanup. Use the 10-second natural receipt hold below. | 30 seconds execution + 30 seconds settlement. Payload exit `0`, no signal, closed; inspect PID 1 running during the hold, then verify natural exit `0`. No watchdog. |
| `payload-failure` | Same synthetic boundaries with distinct owned paths. The probe cleans its resources and intentionally exits `23`. Retain the supervised npm payload's actual exit before PID 1 finishes. Use the same 10-second natural receipt hold. The validator must classify a failed payload even when the container exits `0`. | 30 seconds execution + 30 seconds settlement. Payload exit `23`, no signal, closed; inspect PID 1 running during the hold, then verify natural exit `0`. No watchdog. |
| `setup-rejection` | With transfer root `/tmp/council-offline/project`, supply forbidden member `../escape`. Observe rejection before that write or any payload spawn. Preserve the rejected member and absence evidence for `/tmp/council-offline/escape`. | 30 seconds execution + 30 seconds settlement. `payloadStarted:false`, payload exit/signal `null`; proposed supervisor exit `64`, matched independently by container status. No watchdog. |
| `watchdog-orphan` | A supervised synthetic Node parent spawns a detached child and exits `0`. Observe the parent's closed status, its absence, the live child/session identity, and adoption by PID 1. PID 1 remains alive while custody is incomplete. Stop the exact owned container at the execution deadline. | 30 seconds execution + 30 seconds settlement. Retain payload exit `0`; watchdog true; container exit `137` after the recorded kill. A missing final supervisor receipt stays unknown. Fixture cleanup is intentionally incomplete, separately from verified teardown. |

Every row also requires namespace/configuration checks, raw bounded logs, positive stopped state, and exact ID/name absence after removal. A container exit code cannot fill a missing payload receipt. Payload `0` alone cannot settle a live orphan. Setup rejection must retain `not-started`, rather than inventing a payload exit. Before any real dependency or Council payload, the coordinator must accept the complete qualification set and its environment evidence.

For `payload-success` and `payload-failure`, staging ends at the single stdin EOF. Reject extra transfer bytes. Start bounded stdout capture before launching the payload. After payload closure, descendant settlement, and the bounded cleanup observations, PID 1 emits and flushes one stdout receipt. It then holds naturally for exactly 10 seconds before exiting `0`. The hold timer is an identified supervisor resource, separate from fixture timers. The host must obtain an exact-ID ownership-checked inspect result with `Running:true` after reading the receipt and during this hold. Its bounded log read and inspect can each take at most 4 seconds. Missing the running observation fails qualification. The hold remains inside the 30-second execution limit. A late receipt cannot extend that limit. No second stdin exchange, Docker exec, mount, socket, or unstated signal releases the hold.

### Container and payload environment boundaries

For each proposed container, use a fresh exact name and one task-owned label. Reject preexisting names. Verify the recorded context endpoint, engine identity, pinned image ID/platform/version, entrypoint, and absence of image volumes before creation. Inspect actual configuration before start. Use staged project cwd `/tmp/council-offline/project`.

The frozen `S/{clean-success,application-failure,watchdog-orphan}/inspect-created.json` receipts show image entries `PATH`, `NODE_VERSION=22.23.3`, and `YARN_VERSION=1.22.22` in `Config.Env`. The retained Docker environment reference also identifies engine-added HOME, HOSTNAME, PATH, and TERM when a TTY is allocated. `Config.Env` alone is not PID 1's effective environment. The clean-success receipt separately records `Config.Hostname=37f53b312520` and `Config.Tty=false`. It contains no observation of PID 1's actual environment.

Inspect the unchanged image ENV first. For each proposed container, explicitly set PID 1's `HOME=/tmp/council-offline/home`, `PATH=/usr/local/bin:/usr/bin:/bin`, and `LANG=C.UTF-8` in its scoped configuration. Inspect `Config.Env` separately from engine defaults. Require `Config.Tty=false`. Bind effective PID 1 `HOSTNAME` to that exact container's inspected `Config.Hostname`, not to a guessed ID prefix or a host value. Its expected environment consists of the declared HOME/PATH/LANG, reviewed NODE_VERSION/YARN_VERSION, and that engine HOSTNAME. TERM is not expected without a TTY. Verify the effective PID 1 environment and reject unexplained keys or values. These are future container-local checks, not image or global setting changes.

Construct the supervised payload's spawn environment from exactly `HOME=/tmp/council-offline/home`, `PATH=/usr/local/bin:/usr/bin:/bin`, and `LANG=C.UTF-8`. Verify the locale before execution. Verify the effective initial payload environment while its owned process is live. Do not copy engine HOSTNAME, image `NODE_VERSION`/`YARN_VERSION`, host variables, inherited `NODE_OPTIONS`, npm settings, provider variables, proxies, or host caller handles.

npm and its lifecycle shell can add variables and PATH entries to their children. Record those later boundaries separately from the three-key spawn map. The success/failure qualification cases must attribute those additions to the pinned image npm/shell and synthetic script. Require declared container-local paths and task-owned identities. An unavailable observation or unexplained addition blocks environment qualification. Preserve no credentials, no inherited mounts, network isolation, and read-only root throughout. Do not change image/global settings or broaden isolation to force environment parity.

The Node entry remains PID 1 and owns descendants. The host supervisor records actual argv/cwd, hashes, container ID/name/label, and PID/birth identities. Separate `payloadStarted`, payload exit/signal/closed, supervisor status, container inspect/wait status, watchdog, fixture cleanup, settlement, and absence in the receipt. Record raw Docker diagnostics independently. A missing payload or supervisor result stays unknown. Apply a 4-second maximum to each control call within the remaining phase deadline. Cap each stdout/stderr stream at 4 MiB. Excess output terminates the case as failed while preserving the bounded bytes and overflow fact. No automatic restart is permitted.

**Completion check:** All four supervised-payload cases, staging rejection, executable scratch, environment boundaries, required package checks, source/hash-input parity, and custody have positive observations. Deferred compiler/SQLite checks are not implied prerequisites. Container existence or dependency resolution alone is insufficient. Missing current CLI/control evidence holds the new route; no external documentation request is authorized in this author assignment.

## Task 3: run one unchanged discovery file — provisional

**Owner:** Coordinator-assigned validator. **Prerequisites:** Accepted Task 2 evidence, reviewed frozen input/harness hashes, and explicit Council test execution authority.

**Files:** Read the staged source and dependencies only. Write only container scratch and `D/discovery-baseline/` evidence. Do not change the matrix or add instrumentation to product/test files.

**Interfaces:** Proposed invocation: `python3 D/run-linux-offline.py discovery-baseline`. Its sole Council payload, from the staged project cwd, is:

```sh
npm test -- test/pilot/discovery.test.ts
```

- [ ] **Step 1: verify exact source and execution inputs.** Match import/hash-input manifests and producer digest parity before launch. Record available CPUs, effective default Vitest settings, ordinary reporter, locale, container defaults, and the separately constructed payload environment. Account for npm/shell child additions through the accepted boundary evidence. Use only target-required supplied dependencies. The harness starts no installation or build.
- [ ] **Step 2: execute the payload once.** Allow 120 seconds for the command and 30 seconds for settlement. Do not add a reporter, ordering flag, worker limit, timeout, pool, isolation, or CI override.
- [ ] **Step 3: preserve complete observations.** Require the final result for all 13 original cases, including all eleven matrix rows. Retain names and multiplicities. Preserve capability/readiness failures, version normalization, canonical policy checks, missing controls, billing observations, and the inference sentinel. Classify startup failure separately from executed assertions.
- [ ] **Step 4: apply the cleanup and output contracts below.** Require independent evidence for actual run-owned cleanup. Preserve missing required evidence as unknown even if the payload exits `0`.
- [ ] **Step 5: return the result and stop.** Reassess the existing #8 plan and each provisional branch. Do not proceed to a four-file run, source correction, full suite, or #5 experiment.

This is the **first proposed Council runtime check**. It tests Linux execution feasibility at a known existing boundary. It does not reproduce parallel-file pressure. It does not establish the controlled environment-overwrite RED or fix that mechanism.

### Cleanup and exact container settlement

Application cleanup precedes outer teardown. The existing finalizers at `test/pilot/discovery.test.ts:200,254` and `test/pilot/native-host-fixture.ts:56` define expected root removal. The adapter at `src/orca/client.ts:150–163` clears its timeout and grace timer when its finish callback runs. These source facts do not prove future execution. They also do not require an always-unknown result.

Record the exact input baseline and attributable test allocations while live. Preserve independent evidence of actual owned root removals, listener/lock state, exact descendant settlement, and raw output. Keep original command, source, and assertions unchanged. A candidate event observer requires disposable qualification of invocation attribution, capture completeness, and loss/overflow detection. A dropped event or unproved coverage cannot be repaired by a final empty directory. Polling alone can miss a short-lived root or child.

Bound post-payload observation to at most 3 seconds within the execution budget. Capture any available root, listener, lock, process, and generated-output snapshots. Continue the already qualified bounded event capture while execution remains active. Do not extend the deadline for incomplete observations. Preserve each missing required observation as unknown. Verified termination of an identified owning process establishes settlement of its remaining timers. It does not establish the earlier time at which a specific timer was cleared. Record that pre-exit timing separately when unobserved. Positive outer evidence can establish other cleanup without claiming that timing.

Start the 30-second settlement clock only at the applicable terminal condition below. Payload exit alone is not terminal while owned descendants remain unsettled.

| Case or mode | Execution-to-settlement transition |
| --- | --- |
| `payload-success`, `payload-failure` | Payload closed, descendants settled, bounded observations recorded, and the 10-second hold completes with natural PID 1 exit. A missed hold observation or execution deadline fails qualification. |
| `setup-rejection` | The rejection receipt records no payload spawn, followed by PID 1 exit `64`. There is no natural payload hold. |
| `watchdog-orphan` | Preserve parent/payload exit `0` while its owned detached child remains live. Keep the execution watchdog active until the 30-second deadline. Record watchdog firing, then enter settlement and stop the exact owned container. Never kill it on the parent's first exit. |
| Dependency check or unchanged discovery command | Payload closed, exact descendant settlement established, bounded observations recorded, and PID 1 finishes naturally. If a descendant remains, keep the original watchdog active until its execution deadline. Record a failed cleanup verdict independently. |

An earlier unexpected exit, output overflow, access refusal, or protocol failure ends execution as failed and starts bounded settlement. It never qualifies as natural success or the planned orphan watchdog. Preserve payload exit/signal/closed before liveness checks. Keep PID 1 and container status distinct. Docker `wait` confirms container/PID 1 exit, not a missing payload result. Compare exact ID/name/label/image before every signal or removal. If still running after the applicable terminal condition, stop only that owned container by the reviewed exact-ID kill route. Inspect stopped state, `Running:false`, and PID `0`. Preserve logs and `wait` status before removal. Remove only the exact stopped owned ID without forced removal. Verify absence independently by ID and name. Preserve any unknown/refusal and stop affected work. Never prune, remove by wildcard/label, or act on an unrelated container.

Container teardown establishes namespace resource removal. It does not convert retained roots, a live orphan, a cleanup exception, or missing observations into passing application cleanup. Preserve host input/evidence bundles after the run. Do not delete preexisting data.

### Generated output and pinned input integrity

The installed Vite `8.3.5` bundle at `node_modules/vite/dist/node/chunks/node.js:38243–38262` creates `.vite-temp` under the nearest `node_modules`. Its timestamped ESM config file is unlinked asynchronously. The directory can remain. The source also has a config-adjacent fallback when that directory cannot be used. Vitest `5.0.5` at `node_modules/vitest/dist/chunks/cli-api.De07GUeT.js:5968,6077–6084` writes `results.json` under its resolved `viteConfig.cacheDir` when the ordinary cache is enabled. These are source observations, not receipts of a Linux run.

Declare the exact permitted generated paths or source-derived filename rules in the reviewed packet. Retain each actual path and its creation/removal evidence in the separate `generated-output.json` inventory. Include the timestamped config, any retained `.vite-temp` directory, and the actual default results-cache path. Attribute output to this invocation and preserve observed file hashes. Keep fixture allocations and unexplained additions in separate classifications. A remaining generated cache file is not automatically a fixture leak. An unexplained entry is not automatically generated output.

Verify every manifest-pinned source and dependency file's bytes and metadata independently of this inventory. Reject alteration, removal, or replacement of a pinned input. Do not demand whole-tree byte equality when declared generated files are added. Do not ignore a whole directory or silently classify an input mutation as generated. Preserve ordinary cache/config behavior, the exact command, and all assertions. No cache disabling, runner override, or host checkout write is authorized. Missing required cleanup or output attribution remains unknown and holds the affected support result.

## Result decisions

| Result | Effect on the exact known #8 failure | Effect on later #5 persistence testing |
| --- | --- | --- |
| Missing source/hash-input integrity or a proven target-required dependency/binding/library | No Council execution evidence. Hold only the demonstrated target prerequisite. A missing deferred compiler, SQLite artifact, or unused optional binding does not itself block this command. The environment-overwrite diagnosis remains unchanged. | No qualification. Deferred native/compiler checks remain separate. |
| Unsafe staging, ineffective isolation, failed executable scratch, or unknown removal | Stop this route. Retain the failed custody receipt. | No qualification or portability claim. |
| Vitest/import/startup failure before test bodies | Linux packaging/runner incompatibility; no matrix assertion result. Plan only a cause-specific investigation. | No qualification. Preserve original #5 bytes. |
| All 13 cases pass, pinned inputs remain intact, and required cleanup/output evidence is verified | Unchanged isolated Linux baseline passes only with attributed owned root removals, listener/lock observations, exact descendant settlement, bounded output, and declared generated-output inventory. Record unobserved pre-exit timer timing separately from timers settled by verified owning-process termination. This does not resolve the parallel environment overwrite or relax the original #8 gate. | Shared custody evidence may inform a later plan. It does not qualify #5. |
| Matrix assertion, policy mismatch, timeout, or cleanup failure | Record exact row, phase, error, original/observer settlement, and limits. A policy mismatch supports the known mechanism only if the causal environment sequence is observed. | No inference about persistence behavior. |
| Container removal passes but fixture cleanup fails or is unknown | Outer custody can pass while support acceptance remains incomplete. Preserve both statuses. | Removal is reusable boundary evidence only; it cannot establish descriptor closure or successful persistence. |

### Separate provisional work

1. **Cause-specific #8 discovery:** Expand only from Task 3's actual failing phase. Preserve the existing controlled RED/GREEN schedule. A later correction retains original assertions and fresh paired Astra/cross-family review of identical frozen bytes. The coordinator owns dispositions and fix budgets.
2. **Offline preparation repair:** A missing artifact can justify a new exact local-material proposal. Network access, image changes, compilation, or installation require their own reviewed steps. No fallback is implicit here.
3. **#5 persistence portability:** The [reviewed witness plan](2026-11-04-council-cursor-trust-witness.md), SHA-256 `c907a5e6327deed2d39bc2b39d8183e290a091c7c30d3c0a71e099b20ae36b5f`, pins Node `22.23.4`, a Homebrew executable, one restricted source child, 12 seconds, 16,384 stdout bytes, and 4,096 stderr bytes. This image provides `22.23.3`. Its existing fixture therefore cannot qualify unchanged here. A later plan must resolve that explicit mismatch without silently changing this image or the #5 guard. It must independently qualify the source loader, Node permissions, real cache/journal/audit persistence, exact UID/stat semantics, warning bytes, descriptor closure, zero external/provider/marker access, restored state, and empty scratch. Grant no child, worker, addon, or WASI permission. Preserve the exact reviewed seams. No #5 smoke, RED, GREEN, supervisor edit, or source edit is included now.

## Existing Darwin and whole-suite acceptance stays open

The existing #8 plan remains authoritative for correction and acceptance. Linux evidence supplements it. The unprivileged Darwin observer gap remains unresolved. The historical 1,573 occurrences across 76 files and fourteen separately tracked #10 expectation cases retain their original meaning.

| Existing payload or gate | Unchanged budget and acceptance |
| --- | --- |
| `npm test` on unchanged current baseline | One attempt; 180 seconds plus 30 seconds settlement, after original custody gates. |
| `npm test -- test/pilot/discovery-matrix-fixture.test.ts -t "retains the next case environment"` | 120 seconds; meaningful causal RED before correction, then the same invariant for GREEN. |
| `npm run build`; `npm run typecheck` | Separate commands, each 120 seconds. Preserve generated-asset and source hashes. |
| `npm test -- test/pilot/discovery-matrix-fixture.test.ts test/pilot/discovery.test.ts test/pilot/input-entry.test.ts` | One 120-second scoped #8 check. |
| `npm test -- test/pilot/discovery-matrix-fixture.test.ts test/pilot/discovery.test.ts test/pilot/input-entry.test.ts test/orca/argv.test.ts test/pilot/native-command.test.ts test/pilot/rpc.test.ts` | One 120-second boundary check. No failed-file exclusion. |
| `npm test -- test/pilot/discovery.test.ts test/pilot/cache-composition.test.ts test/pilot/context-cleanup.test.ts test/pilot/host-relay.test.ts --reporter=json --outputFile .superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue8-validation/four-file-vitest.json` | One 120-second diagnostic; supporting evidence only. |
| Exactly `npm test`, sequentially on identical corrected bytes | Three consecutive complete attempts; 180 seconds each plus 30 seconds settlement each. Stop after failure. Preserve default environment, concurrency, timeouts, ordering, pool, isolation, and reporter. |
| Historical/final runtime identity collection | Existing `./node_modules/.bin/vitest list --no-staticParse --json <absolute-output-path>` route; 120 seconds each with the original collection-only TMPDIR custody. Reuse the captured baseline; no baseline recollection. |

Acceptance still requires original/current identity preservation and multiplicities, complete execution, final npm exit `0`, no unexplained skips/unhandled errors, accepted #10 integration, and positive resource settlement. It also requires reviewed RED/GREEN, frozen bytes, rollback evidence, and coordinator-owned independent review. Neither a Linux isolated pass nor forced container removal closes #8 or replaces Darwin evidence.

## Author self-review and language verification

1. **Spec coverage:** Tasks 1–3 cover import and non-import hash inputs, target dependency reachability, four separately authorized supervised-payload checks, environment boundaries, and one unchanged discovery run. Original synthetic approvals/results and the #8 acceptance section remain unchanged. The roadmap retains #5 and whole-suite outcomes without granting execution.
2. **Step scan:** The first proposed check contains all nine exact anchors. It was not executed as acceptance in this correction. Unknown package origins, manifests, staging permissions, and runtime controls remain gates. Natural holds and cleanup observations have finite bounds. No provisional harness name is presented as an existing executable.
3. **Type consistency:** `S` identifies immutable spike evidence. `D` identifies proposed future evidence. `qualify <case>`, `dependency-check`, and `discovery-baseline` are proposed modes. Receipts distinguish image/config, engine/PID 1, child spawn, and npm/shell environments. Status receipts distinguish payload, PID 1, container, watchdog, cleanup, settlement, and absence. Generated output remains separate from pinned inputs and fixture roots.
4. **Review Focus:** Task 1 checks artifact reachability and import/hash-input integrity. Task 2 owns four payload-status cases, staging rejection, executable scratch, and layered environment observations. Task 3 preserves matrix assertions and cleanup classification. The original causal RED owns the environment-overwrite invariant. Unobservable cleanup remains unknown.
5. **Proportion:** This plan defines one input-discovery task and two provisional runtime tasks. It supplies boundaries and decisive commands rather than runner implementations. No broad resurvey, replacement #8 correction design, or speculative #5 implementation is included.

Language mode is an Issue 9-oriented candidate. The official ASD-STE100 dictionary and governed project terminology were unavailable. Procedure and description references informed new prose. Paths, hashes, versions, commands, bounds, conditions, and authorization limits were compared with the named sources. Full STE conformance is unverified.

Planning sources loaded: full `/Users/aaat/.agents/policies/model-policy.md` (SHA-256 `6665d27fa8fae4e8b66835799ec75f58e9e7c63a666119e07b0485f1f16f81a0`); installed Superpowers `writing-plans` `7.0.1` (SHA-256 `a6c67c1900064347c2a329990dd3c555657c51c3ec53b259a08aa01a2c26139a`); maintained `adaptive-planning` instructions and `references/superpowers-planning.md`. The resolved writing source is `/Users/aaat/.codex/plugins/cache/openai-curated-remote/superpowers/7.0.1/skills/writing-plans/SKILL.md`. Documentation guidance was read. External lookup was excluded by this assignment. Current local source, lockfile, and recorded runner behavior bound the claims.

R2 provenance: corrections addressed A1, C1, C2, and C3 in `.superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue8-linux-plan-r2-author/findings.md` (SHA-256 `041ed9242c5e0eb59969d83913e31db1be5aafd3dce1c2a671d2e92d99a4e0ed`). Its starting draft was `183be92df548e5b96c48a487da2e9f77c847855ba3404f76a1ed77ff8ee24f82`. No verdict from the earlier invalid Argon attempt was used in that correction.

R3 provenance: this correction starts from `41089685d8027db440b40db975df8ad1058e0fc2abade2eab9d6e6c901acc10b`. It applies F1–F4 and coordinator additions in `.superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue8-linux-plan-r3-author/argon-dispositions.md` (SHA-256 `89980ce6e2e888e1765bc0f7c201b4ea4aa41b54945e2b20cb6eb77e8066b910`). Astra R1 and F1 address the same HOSTNAME issue. Named source, frozen environment receipts, and `issue8-config-reconcile-20261104/outer-cleanup-source-lead.md` were inspected without runtime execution. These dispositions do not accept the corrected plan or authorize execution, providers, or further workers. The coordinator retains the review and execution gates.

Status: ready for coordinator review; execution remains unauthorized. This author ran no proposed static acceptance check, Docker command, Council/test execution, npm command, package operation, source transfer, Git mutation, external request, helper, provider/account operation, or configuration change. Only this plan was corrected. Verification was limited to document structure, literals, and preservation checks.
