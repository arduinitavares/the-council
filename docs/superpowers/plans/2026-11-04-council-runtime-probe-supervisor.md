# Council issue 8 runtime probe supervisor implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supervise the single pinned #8 runtime-evidence probe with exact command custody, bounded fault handling and verifiable cleanup.

**Architecture:** Use the immutable R2 command packet and the approved R3 supervisor design. Separate the pure command and receipt checks, the guarded host transport, and the integration that consumes both. Keep the watchdog responsive during process startup and receipt persistence.

**Tech Stack:** Python 3.9-compatible standard library, POSIX process groups and selectors on the execution host.

**Spec:** [Approved R3 design](/Users/aaat/.codex/worktrees/council-first-use/the-council/.superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue8-runtime-probe-command-r3-design-20261104/supervisor-design-r3.md)

## Global constraints

- The user approved design SHA-256 `5c8932014136a0e9bf31b397d8e115dcc57f48e39de084f012d1e2585410b31f` after both independent reviews. That approval covers implementation and inert verification. Exact live container execution is a separate decision.
- Preserve checkout `3f3c3cdf63130d4aa27037c8f0d42ed5fd36dd8b`, its tracked changes, the #5 draft, the current Linux harness, the exact R2 argv, and payload. All implementation and test files go in the private task directory below. Record candidate hashes and review receipts there. The working files are private campaign artifacts and are outside the product commit.
- Bind [commands.json](/Users/aaat/.codex/worktrees/council-first-use/the-council/.superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue8-runtime-probe-command-r2-20261104/author-target/commands.json) to SHA-256 `a973f1484b3ec902e3c585169743b24d41d097ba27bd6eecc65a5776c10d2cce` and [runtime-probe.cjs](/Users/aaat/.codex/worktrees/council-first-use/the-council/.superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue8-runtime-probe-command-r2-20261104/author-target/runtime-probe.cjs) to SHA-256 `15058076c9d7f194f1d17fd94688d381cb32f9e9a66c2afa84b9c22b78f146cc`. Compare the decoded create argument byte for byte. Keep the packet's input ledger, host CLI executable identity, replacement environment, all flags, and the exact diagnostic templates. Treat the already-stopped template as unqualified until observed in the exact engine.
- Keep at most one create and one attached start. At most 17 Docker CLI helper launches, at most three concurrent CLI helpers, one broker and one writer. Cap each phase at 30 seconds and the whole attempt at 90 seconds. Each control has at most four seconds including its termination reserve. No retry of a possibly submitted mutation and no extension or reset on progress.
- Preserve the 4 MiB per-host-stream cap, 262,144-byte payload stdout cap, 65,536-byte payload record cap and 2,048-byte terminal reserve, 65,536 bytes per inner child stream, 98,304 aggregate raw child bytes and 12,288 raw bytes per chunk. Reserve 64 MiB for active stream/encoding buffers and 256 MiB for evidence storage before create. Count queued receipts against the latter budget.
- Verify scopes with tests using only inert command outcomes or exact local Python fixtures. The fixtures must not launch Docker, npm, Council, the probe payload, or a provider. Bind one owned scratch directory per test process, no external network, and positively verify subprocess, timer and scratch cleanup. No live application, provider, or container command runs in any task in this plan.

## Review focus

- Authenticated bind before mutation. Missing, malformed or wrong-digest input, wrong name/full ID/config/image, refusal and ambiguous receipts fail closed. Task 1.
- The gate never starts an unarmed command. Test blocked launch, partial pipe acquisition/registration, watchdog and writer stalls, and expired permits. Task 2.
- Reaped-leader and group identity are distinct. Verify an inherited pipe, stable group custody, post-permit broker loss, and exact local-only termination. Task 2.
- Engine and CLI state are distinct. Verify no repeated create, start, signal or remove, separate never-started/exit cases, and exact dual absence. Task 3.
- Complete evidence is distinct from safe disposal. Check both raw streams, bounds, record validity, exit and log agreement, and storage acknowledgement. Task 3.

## Files and common verification

Private implementation directory: `/Users/aaat/.codex/worktrees/council-first-use/the-council/.superpowers/sdd/2026-11-01-council-bounded-diagnostics/issue8-runtime-probe-supervisor-implementation-20261104/author-target`. The coordinator prepares it in the existing isolated Council worktree. The code owns four production modules: `probe_contract.py`, `probe_gate.py`, `probe_transport.py`, and `probe_supervisor.py`. Each task owns the test file listed below. Use the installed `/usr/bin/python3` and `PYTHONDONTWRITEBYTECODE=1`. The coordinator supervises every test run, records complete output and declared bounds, and verifies the exact scoped paths and positive settlement. Test names below identify regression cases, and each case asserts the named fail-closed result and the exact emitted calls or resource facts. A missing module can be setup RED. Use the unchanged existing harness function where it represents the same behavior and can be projected with inert inputs. For new behavior, retain a failing invariant in the initial candidate before adding the missing behavior. Never manufacture RED by altering the unchanged harness or weakening the GREEN assertions.

### Task 1: Bind commands and classify receipts without side effects

**Files:** Create `probe_contract.py` and `test_probe_contract.py`.

**Interfaces:** `load_packet(path: Path, payload: Path) -> ProbePacket` validates the fixed reviewed bytes and decodes structured argv. `resolve_argv(packet, command_id, candidate_id=None, verified_id=None) -> tuple` performs only the permitted final-token substitution. `classify_inspect(packet, command_id, receipt, expected_id=None) -> InspectResult` and `classify_control(packet, command_id, receipt, expected_id=None) -> ControlResult` classify bounded data without issuing commands. Use typed immutable results with explicit `refused`, `unknown`, `never_started`, `running`, `exited`, and absence states as applicable. Task 3 owns phase scheduling and verified-ID promotion.

- [ ] Write tests for wrong hashes, duplicate keys, second create/start entries, changed flags, incorrect substitutions, contradictory inspect fields, wrong full ID/config/image, exact already-stopped and absence diagnostics, and actual refusal precedence.
- [ ] Run `PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -m unittest -v test_probe_contract` in the implementation directory, within 15 seconds. Retain behavioral RED for a candidate-ID leak and a nonzero/refusal incorrectly treated as absence.
- [ ] Implement strict parse/validation and the command-specific predicates. Check all machine-readable packet fields and encode the reviewed textual configuration and result predicates as explicit code. No shell, subprocess, mutable provider state or live entrypoint.
- [ ] Run the unchanged tests and an independent exact-packet/embedded-source check. Verify zero child creation and all rejection cases. Freeze the three input hashes and task output hashes for fresh paired review before the next dependent task.

### Task 2: Implement independently timed gated launch and storage

**Files:** Create `probe_gate.py`, `probe_transport.py`, and `test_probe_transport.py`.

**Interfaces:** `Watchdog.prepare(command_id, argv, deadline) -> Attempt` registers before requesting setup. `Watchdog.pump(deadline)` drains all eligible channels without blocking and updates attempt state. `Watchdog.arm(attempt)` issues one gate permit after custody and pipe registration. `Watchdog.settle(attempt, deadline) -> Receipt` reports exit, reaping, stream and group evidence separately. `Watchdog.enqueue_receipt(receipt, deadline)` is byte-bounded and nonblocking. Task 3 consumes these interfaces with the exact packet routes. Internal fixture launch functions use one fixed inert executable supplied by the tests, never a public executable override.

- [ ] Write tests for each pre-permit phase, failure after each descriptor acquisition and selector registration, a launch stall while another helper drains, an evidence-writer stall, queue saturation, a disconnect after permit, leader exit with inherited open pipes, and access refusal. Assert no pre-permit subprocess effect and bounded positive cleanup or explicit unknown with no unsafe signal.
- [ ] Run `PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -m unittest -v test_probe_transport` within 45 seconds. Retain behavioral RED against an inert setup that loses process ownership when registration raises and an inert blocking writer that delays a fake-clock cutoff.
- [ ] Implement an outer watchdog with a launch broker and an evidence writer prepared before any Docker permit. Create the broker, writer, and bounded endpoints in the pre-arm startup and require positive ready/identity evidence. Use dedicated nonblocking channels. Only the broker stages helpers. The gate begins in the broker's owned group, reports its PID and birth identity, then enters its own process group after registration. Verify the group and both pipes before release. Keep group identity anchored while termination could still be required. Withhold reaping of an exited gate leader until the watchdog releases its identity, and never signal a group from a reused or unverified ID. The gate executes the exact approved argv only once after the permit. The watchdog does not spawn, block on a queue write, or touch disk after arming. It fences gates at the absolute cutoff and closes only acquired resources, unregistering only successful registrations. The writer acknowledges the exclusive receipt after complete persistence, and a missing acknowledgment can never establish success. Keep explicit unknown outcomes when local proof fails.
- [ ] Run the unchanged suite under the declared bound and verify positive cleanup with independently recorded group and exact path checks. Freeze code and retained RED/GREEN evidence for paired review. No Docker route becomes callable from this task.

### Task 3: Compose the exact phase transitions and final proof

**Files:** Create `probe_supervisor.py` and `test_probe_supervisor.py`.

**Interfaces:** `run_probe(packet, authority, transport) -> ProbeResult` drives exact packet commands. Only a separately approved and hash-bound live invocation can construct real execution authority. This task supplies the validation interface and inert tests. It does not publish a live launch command or consume live authority. A later coordinator wrapper must bind the final reviewed source, authority record, packet, image, and working directory before arming the live transport.

- [ ] Write tests for never-started cleanup skipping wait and logs, the exit-between-inspect-and-kill diagnostic, ambiguous create by exact-name recovery, post-permit start uncertainty, bad configuration blocking mutation, logs mismatching one stream, missing or duplicate records, invalid chunk offsets, raw or encoded overflow, incorrect exit or missing receipt persistence, and dual absence. Assert the exact ordered argv and mutation counts for each branch and its separate success, refusal, unknown or safe-disposal result.
- [ ] Run `PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -m unittest -v test_probe_supervisor` within 45 seconds. Record behavioral RED for a never-started branch that requests wait/logs and a partial receipt that incorrectly returns success.
- [ ] Implement the phase machine using the reviewed exact packet. Latch the sole create or start attempt before staging its helper, never repeat after uncertain effect, and apply a fresh ownership and config check before any mutation. Keep close, exit, both streams, persistence and final absence independent. Require strict JSONL and exact encoded chunk reconstruction before success. Preserve actual failure diagnostics and positive outer disposal separately. Make missing exact authority stop before process admission. No human approval or qualification is inferred from code, tests or plan state.
- [ ] Run all three test files once together with `PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -m unittest -v test_probe_contract test_probe_transport test_probe_supervisor` within 90 seconds. Inspect exact scope, positive settlement and input hashes. Freeze the final artifact for fresh paired review. Present exact Docker argv and the eventual bounded live wrapper to the user only after the implementation gate, before any container call.

## Coordinator handoff

Use one Sol Max writer per task through the existing qualified Orca workspace. Send a scoped brief and keep the private plan ledger. Use fresh Astra Ultra and Argon High on the same frozen artifact at each applicable review gate. Verify every review against the source and retained commands. Failures, missing approval and live qualification gaps remain visible. A passed inert supervisor can enable review of the first runtime-evidence probe. It does not authorize that probe, the four later synthetic cases, dependency qualification, or repeated default suite runs.

Self-review maps the design's input/custody, deadline/acquisition/persistence, and composition/result invariants to Tasks 1–3. Check the adjacent interfaces and keep independent gates intact. The platform-specific exact launcher primitive and effective process-group checks remain to be proved by the inert Task 2 tests. If those primitives cannot meet the approved timing or identity requirements, retain a named technical blocker and return to design scope before any live action.
