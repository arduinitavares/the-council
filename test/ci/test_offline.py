"""Pure adapter tests; real fixtures are opt-in and intended for hosted VMs only."""

import argparse
import copy
import importlib.util
import json
import math
import os
from pathlib import Path
import select
import selectors
import signal
import sys
import time
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts/ci/offline.py"
CONTRACT_PATH = ROOT / "scripts/ci/offline-contract.json"
module_spec = importlib.util.spec_from_file_location("council_offline", MODULE_PATH)
offline = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(offline)
CONTRACT = json.loads(CONTRACT_PATH.read_text())


def context():
    return {
        "contract": copy.deepcopy(CONTRACT),
        "sourceCommit": "1" * 40,
        "sourceTree": "2" * 40,
        "contractHash": "3" * 64,
        "lockHash": "7ab6ebf13b6bdafd028fb309ff112a878ad9ec189e548ec167bf11493583d2bd",
        "invocation": "pure-invocation",
        "nonce": "pure-nonce",
        "assignmentHash": "4" * 64,
        "job": "checks",
        "phase": "qualification",
        "python": "/pinned/python3",
        "testFile": "/source/test/ci/test_offline.py",
        "cwd": "/source",
        "commandRoot": "/owned/run",
        "environment": {"HOME": "/owned/run/home"},
        "requiredResources": ["fixture-work"],
        "roots": [],
    }


def fixture_spec(mode="success"):
    return {
        "id": "fixture-" + mode,
        "profile": "fixture",
        "argv": ["/pinned/python3", "-I", "-S", "-B",
                 "/source/test/ci/test_offline.py", "--fixture", mode],
        "executionSeconds": 1,
        "settlementSeconds": 1,
    }


class FakeOps:
    """Only the external boundary is fake; supervision and receipt gates stay real."""

    def __init__(self, *, exit_at=0.1, code=0, eof_at=None, cancel_at=math.inf,
                 resource="closed", custody="owned", refusal=False):
        self.now = 0.0
        self.exit_at = exit_at
        self.code = code
        self.eof_at = exit_at if eof_at is None else eof_at
        self.cancel_at = cancel_at
        self.resource = resource
        self.custody = custody
        self.refusal = refusal
        self.calls = []
        self.receipts = []
        self.sent_output = False
        self.removed = False
        self.receipt_ok = True

    def monotonic(self):
        return self.now

    def timestamp(self):
        return "2026-11-06T00:00:00Z"

    def spawn(self, spec, ctx):
        self.calls.append(("spawn", spec["id"], copy.deepcopy(ctx["environment"])))
        return "command-handle"

    def poll(self, handle):
        return self.code if self.now >= self.exit_at else None

    def read_output(self, handle, limit):
        if not self.sent_output:
            self.sent_output = True
            return b"partial stdout\n", b"partial stderr\n", False
        return b"", b"", self.now >= self.eof_at

    def cancelled(self):
        return self.now >= self.cancel_at

    def wait(self, handle, seconds, phase):
        assert 0 < seconds <= 0.05 + 1e-9
        self.calls.append(("wait", phase, self.now, seconds))
        self.now += seconds

    def targets(self, handle, ctx):
        return ["fixture-work"]

    def identity(self, target, ctx):
        return {"ownership": self.custody, "state": "live" if
                self.now < self.exit_at or self.resource != "closed" else "closed"}

    def signal(self, target, signum, remaining):
        self.calls.append(("signal", target, signum, self.now, remaining))
        if self.refusal:
            raise PermissionError(1, "fixture signal refused")
        if self.custody != "owned":
            raise AssertionError("foreign identity received a signal")
        self.exit_at = min(self.exit_at, self.now + 0.05)
        self.eof_at = min(self.eof_at, self.now + 0.05)
        self.resource = "closed"
        if self.code is None:
            self.code = -signum

    def resource_state(self, handle, ctx, output):
        state = self.resource if self.now >= self.exit_at else "live"
        return {
            "nonce": ctx["nonce"], "assignmentHash": ctx["assignmentHash"],
            "invocation": ctx["invocation"], "complete": state == "closed",
            "sourceCommit": ctx["sourceCommit"], "sourceTree": ctx["sourceTree"], "job": ctx["job"],
            "resources": [{"id": "fixture-work", "state": state,
                           "ownership": self.custody}],
            "errors": [],
        }

    def cleanup_root(self, registration, ctx, remaining):
        self.calls.append(("remove-root", registration["path"], self.now, remaining))
        self.removed = True
        return {"absent": True, "path": registration["path"]}

    def emit_receipt(self, receipt, remaining):
        self.receipts.append(copy.deepcopy(receipt))
        return self.receipt_ok

    def close_output(self, handle, remaining):
        self.calls.append(("close-output", remaining))
        return True


def native_attachment_observation(fault, *, repeat_finish, refuse=None):
    """Run the real adapter/owner against injected kernel and exact-root effects."""
    import contextlib
    import fcntl
    import socket
    now, killed, removed = [0.0], [False], [False]
    events, receipts = [], []
    ctx = context()
    ctx["requiredResources"] = ["command", "work", "anchor"]
    registration = {"path": "/owned/run/native-partial", "nonce": ctx["nonce"],
                    "assignmentHash": ctx["assignmentHash"], "invocation": ctx["invocation"]}
    ctx["roots"] = [registration]
    root = Path(registration["path"])
    files = {"owner.json", "fixture.lock"}
    class Stream:
        def __init__(self, fd):
            self.fd, self.closed = fd, False
        def fileno(self):
            return self.fd
        def close(self):
            events.append(("stream-close", self.fd))
            if refuse == "close" and self.fd == 51:
                events.append(("refused-close", self.fd))
                raise PermissionError(13, "native stream close refused")
            self.closed = True
    class Process:
        pid, returncode = 61, None
        stdout, stderr = Stream(51), Stream(52)
    process = Process()
    class Selector:
        closed = False
        def register(self, stream, event, name):
            events.append(("register-stream", name))
            if fault == "attachment":
                raise ValueError("stream-attachment-failed")
        def select(self, timeout):
            events.append(("selector-observation", self.closed))
            if self.closed:
                raise ValueError("closed selector observation")
            return []  # No invented output or EOF.
        def close(self):
            events.append(("selector-close",))
            self.closed = True
    selector = Selector()
    base = FixtureController.__new__(FixtureController)
    offline.RealOps.__init__(base)
    base.ctx, base.root, base.mode = ctx, root, "detached-parent"
    base.independent, base.port = None, 31337
    base.listener = mock.Mock()
    base.listener.fileno.return_value = 80
    base.root_created, base.allocated_files = True, set(files)
    io = NativeGroupIO()
    io.clock = lambda: now[0]
    def setup(mode, context, end):
        io.base, io.ctx, io.mode = base, context, mode
        io.owner_pid, io.session = 51, 4000
    io.setup = setup  # Inject only allocation outcomes, not _start/read/close/cleanup.
    def waitpid(pid, flags):
        events.append(("waitpid", pid))
        return (pid, int(signal.SIGTERM)) if killed[0] else (0, 0)
    def kill(pid, signum):
        if pid != process.pid or signum != signal.SIGTERM:
            raise AssertionError("foreign or unexpected partial-child signal")
        events.append(("owned-signal", pid, int(signum)))
        killed[0] = True
    def wait(read, write, error, seconds):
        now[0] += seconds
        return [], [], []
    def factory():
        events.append(("selector-factory",))
        if fault == "factory":
            raise ValueError("selector-factory-failed")
        return selector
    original_read = offline.RealOps.read_output
    def read(handle, limit):
        events.append(("adapter-read", handle["selector"] is None))
        return original_read(handle, limit)
    base.read_output = read
    base.emit_receipt = lambda receipt, remaining: receipts.append(copy.deepcopy(receipt)) or True
    def unlink(path, *args, **kwargs):
        if path.parent != root or path.name not in files or not killed[0]:
            raise AssertionError("root removal without exact ownership and known child settlement")
        events.append(("unlink", str(path)))
        if refuse == "cleanup" and path.name == "fixture.lock":
            events.append(("refused-unlink", str(path)))
            raise PermissionError(13, "native unlink refused", str(path))
        files.remove(path.name)
    def rmdir(path):
        if path != root or files or not killed[0]:
            raise AssertionError("invalid exact-root removal")
        events.append(("rmdir", str(path)))
        removed[0] = True
    class Probe:
        def __enter__(self):
            return self
        def __exit__(self, *args):
            return False
        def bind(self, address):
            if not killed[0] or address != ("127.0.0.1", 31337):
                raise AssertionError("foreign/unsettled port probe")
            events.append(("port-closed", address))
    with contextlib.ExitStack() as stack:
        for patch in (
            mock.patch.object(offline.subprocess, "Popen", return_value=process),
            mock.patch.object(os, "pipe", return_value=(91, 92)),
            mock.patch.object(os, "close", side_effect=lambda fd: events.append(("fd-close", fd))),
            mock.patch.object(os, "set_blocking"),
            mock.patch.object(os, "waitpid", side_effect=waitpid),
            mock.patch.object(os, "kill", side_effect=kill),
            mock.patch.object(os, "open", return_value=33),
            mock.patch.object(select, "select", side_effect=wait),
            mock.patch.object(selectors, "DefaultSelector", side_effect=factory),
            mock.patch.object(fcntl, "flock"),
            mock.patch.object(socket, "socket", return_value=Probe()),
            mock.patch.object(Path, "is_symlink", return_value=False),
            mock.patch.object(Path, "resolve", autospec=True, side_effect=lambda path, *args, **kwargs: path),
            mock.patch.object(Path, "read_text", return_value=json.dumps(registration)),
            mock.patch.object(Path, "iterdir", side_effect=lambda: iter(root / name for name in sorted(files))),
            mock.patch.object(Path, "unlink", autospec=True, side_effect=unlink),
            mock.patch.object(Path, "rmdir", autospec=True, side_effect=rmdir),
            mock.patch.object(os.path, "lexists", side_effect=lambda path: not removed[0]),
        ):
            stack.enter_context(patch)
        owner = ParentExitController("detached-parent", ctx, 1, 2, io)
        receipt = offline.supervise(fixture_spec("detached-parent"), ctx, ops=owner)
        frozen = json.dumps(receipt, sort_keys=True)
        first = owner.finish(receipt, 2)
        second = owner.finish({}, 2) if repeat_finish else None
        return {"receipt": receipt, "first": first, "second": second, "events": events,
                "removed": removed[0], "streamsClosed": process.stdout.closed and process.stderr.closed,
                "unchanged": json.dumps(receipt, sort_keys=True) == frozen, "now": now[0],
                "registered": base.owned.get("command") is process, "rawStatus": io.status("command"),
                "receipts": receipts, "ownerRefusals": getattr(owner, "finalization_refusals", []),
                "ioRefusals": getattr(io, "finalization_refusals", [])}


def job_summary_observation(*, stderr=b"qualification partial stderr\n", refuse=False, stdout=None,
                            summary_refusal_at=None, summary_error=None):
    """Exercise main and supervise; replace only their external effects."""
    import contextlib
    class JobOps(FakeOps):
        def __init__(self):
            super().__init__()
            self.owned, self.bindings = {}, {}
            self.command, self.close_remaining = None, None
        def spawn(self, spec, ctx):
            self.command = spec["id"]
            self.ctx = ctx
            self.sent_output = False
            self.exit_at = self.now + 0.1 if self.command == "pure" else math.inf
            self.eof_at, self.code = self.exit_at, 0 if self.command == "pure" else None
            return super().spawn(spec, ctx)
        def targets(self, handle, ctx):
            return []
        def read_output(self, handle, limit):
            if not self.sent_output:
                self.sent_output = True
                return (stdout(self.ctx) if stdout is not None and self.command == "qualification" else b""), stderr if self.command == "qualification" else b"pure\n", False
            return b"", b"", self.now >= self.eof_at
        def resource_state(self, handle, ctx, output):
            closed = self.command == "pure" and self.now >= self.exit_at
            return dict({k: ctx[k] for k in ("nonce", "assignmentHash", "invocation", "sourceCommit", "sourceTree", "job")},
                        complete=closed, errors=[], resources=[{"id": ctx["requiredResources"][0],
                        "ownership": "owned", "state": "closed" if closed else "unknown"}])
        def close_output(self, handle, remaining):
            if self.command == "qualification":
                self.close_remaining = remaining
                self.now += 0.06
            return True
        def emit_receipt(self, receipt, remaining):
            if refuse:
                raise PermissionError(13, "injected receipt refusal")
            return super().emit_receipt(receipt, remaining)
    ops, summaries = JobOps(), []
    original_handlers = {signal.SIGTERM: object(), signal.SIGINT: object()}
    handlers = dict(original_handlers)
    ops.summary_outcomes = []
    ops.handler_events = []
    original_emit_outcome = offline._emit_outcome
    def observe_outcome(payload, *args, **kwargs):
        if "id" not in payload:
            ops.summary_outcomes.append(payload)
        return original_emit_outcome(payload, *args, **kwargs)
    def install_handler(signum, handler):
        previous = handlers[signum]
        handlers[signum] = handler
        ops.handler_events.append((signum, handler))
        return previous
    def write_summary(payload, remaining):
        summaries.append(copy.deepcopy(payload))
        if len(summaries) == summary_refusal_at:
            raise PermissionError(13, "injected job-summary refusal", "stdout")
        if len(summaries) == 1 and summary_error is not None:
            raise summary_error
        return True
    files = {"scripts/ci/offline.py": "a" * 64, "test/ci/test_offline.py": "b" * 64,
             "scripts/ci/offline-contract.json": "c" * 64, "package-lock.json": CONTRACT["lockSha256"]}
    env = {"RUNNER_TEMP": "/owned", "GITHUB_SHA": "1" * 40,
           "COUNCIL_BOOTSTRAP_COMMIT": "1" * 40, "COUNCIL_BOOTSTRAP_TREE": "2" * 40,
           "COUNCIL_BOOTSTRAP_JOB": "checks", "RUNNER_ENVIRONMENT": "github-hosted",
           "RUNNER_OS": "macOS", "RUNNER_ARCH": "ARM64", "GITHUB_REPOSITORY": "arduinitavares/the-council",
           "GITHUB_REPOSITORY_VISIBILITY": "public"}
    with contextlib.ExitStack() as stack:
        for patch in (
            mock.patch.object(os, "environ", env), mock.patch.object(offline, "require_hosted"),
            mock.patch.object(offline, "RealOps", return_value=ops),
            mock.patch.object(offline, "source_files", return_value=files),
            mock.patch.object(offline.uuid, "uuid4", return_value=mock.Mock(hex="d" * 32)),
            mock.patch.object(offline.platform, "python_version", return_value="injected-python"),
            mock.patch.object(offline.platform, "platform", return_value="injected-os"),
            mock.patch.object(offline.platform, "machine", return_value="arm64"),
            mock.patch.object(os, "cpu_count", return_value=3),
            mock.patch.object(Path, "read_text", return_value=json.dumps(CONTRACT)),
            mock.patch.object(Path, "resolve", autospec=True, side_effect=lambda item: item),
            mock.patch.object(Path, "exists", return_value=False), mock.patch.object(Path, "is_symlink", return_value=False),
            mock.patch.object(Path, "mkdir"), mock.patch.object(Path, "open", mock.mock_open()),
            mock.patch.object(signal, "signal", side_effect=install_handler),
            mock.patch.object(offline, "_emit_outcome", side_effect=observe_outcome),
            mock.patch.object(offline, "write_json", side_effect=write_summary),
        ):
            stack.enter_context(patch)
        code = offline.main(["job", "checks", "--source", "1" * 40, "--root", "/owned/job", "--node", "/pinned/node"])
    ops.handlers_restored = handlers == original_handlers
    return code, summaries, ops


def native_timing_observation(scenario):
    """Real native owner/send/writer; only kernel, filesystem and clocks are injected."""
    import contextlib
    import fcntl
    import io as string_io
    import socket
    from types import SimpleNamespace
    now, removed, killed = [0.0], [False], [False]
    effects, writes, emitted, processes, selectors_created = [], [], [], {}, []
    queues, files, pipe_roles = {}, set(), {}
    ctx = context()
    ctx["requiredResources"] = ["command", "work", "anchor"]
    ctx["roots"] = [dict(path="/owned/run/timing", nonce=ctx["nonce"],
                         assignmentHash=ctx["assignmentHash"], invocation=ctx["invocation"])]
    root = Path(ctx["roots"][0]["path"])
    codes = {"command": None, "anchor": None}
    snapshots, blocked_release = [], [False]
    control_refusal = PermissionError(13, "injected control refusal")
    receipt_refusal = PermissionError(13, "injected receipt refusal")

    def frame(event, role, at=None, **extra):
        message = dict({k: ctx.get(k) for k in GROUP_BINDING}, event=event,
                       pid={"command": 61, "anchor": 62, "work": 63}[role],
                       parentPid=61 if role == "work" else 51, group=61, session=4000, **extra)
        fd = 51 if role in ("command", "work") else 53
        queues.setdefault(fd, []).append((now[0] if at is None else at,
            (GROUP_PREFIX + json.dumps(message) + "\n").encode()))
        return message

    class Stream:
        def __init__(self, fd):
            self.fd, self.closed = fd, False
            queues[fd] = []
        def fileno(self):
            return self.fd
        def close(self):
            effects.append(("stream-close", self.fd))
            self.closed = True

    class Process:
        def __init__(self, role):
            self.pid, self.returncode = (61 if role == "command" else 62), None
            self.stdout = Stream(51 if role == "command" else 53)
            self.stderr = Stream(52 if role == "command" else 54)

    class Selector:
        def __init__(self):
            self.keys = {}
            selectors_created.append(self)
        def register(self, stream, event, name):
            if scenario == "partial-attachment":
                raise ValueError("injected stream attachment failure")
            self.keys[stream.fileno()] = SimpleNamespace(fileobj=stream, data=name)
        def select(self, timeout):
            if timeout != 0:
                raise AssertionError("native stream observation must remain nonblocking")
            return [(key, selectors.EVENT_READ) for fd, key in self.keys.items()
                    if (queues[fd] and queues[fd][0][0] <= now[0]) or killed[0]]
        def unregister(self, stream):
            self.keys.pop(stream.fileno())
        def close(self):
            effects.append(("selector-close",))

    def popen(argv, **kwargs):
        role = "command" if argv[-1] == "group-command" else "anchor"
        effects.append(("spawn", role, kwargs["process_group"]))
        process = processes[role] = Process(role)
        frame(role + "-ready", role)
        return process

    def pipe():
        read, write = (91, 92) if not pipe_roles else (101, 102)
        pipe_roles[write] = "command" if write == 92 else "anchor"
        effects.append(("pipe", read, write))
        return read, write

    def write(fd, data):
        role, message = pipe_roles[fd], json.loads(data)
        event = message["event"]
        writes.append((role, event, now[0], bytes(data)))
        effects.append(("write", role, event))
        if scenario == "control-refusal" and event == "RELEASE" and role == "anchor":
            raise control_refusal
        if event == "ARM":
            frame("armed", "anchor")
        elif event == "GO":
            at = {"blind": .975, "late": 1.001, "nonwritable": .950}.get(scenario, .150)
            frame("work-ready", "work", at=at)
            queues[52].append((at, b"fixture partial stderr work\n"))
            if scenario in ("duplicates", "conflicting"):
                for _ in range(40):
                    frame("work-ready", "work", at=at)
                if scenario == "conflicting":
                    frame("work-ready", "work", at=at, conflict=True)
        elif event == "RELEASE" and role == "anchor":
            frame("release-armed", "anchor")
        elif event == "RELEASE":
            frame("parent-exiting", "command", workPid=63)
            codes["command"] = 0
        elif event == "STOP":
            frame("term", "anchor")
            frame("kill", "anchor", at=round(now[0] + .1, 12))
        return len(data)

    def select_effect(read, write_fds, error, seconds):
        if read or error:
            raise AssertionError("unexpected readiness probe")
        if write_fds:
            fd = write_fds[0]
            effects.append(("select-write", pipe_roles[fd], now[0], seconds))
            work_seen = any(item[1] == "GO" for item in writes)
            if (scenario == "nonwritable" and not blocked_release[0] and fd == 102 and work_seen
                    and now[0] >= .95 and not any(item[1] == "RELEASE" for item in writes)):
                blocked_release[0] = True
                now[0] = 1.0
                return [], [], []
            return [], write_fds, []
        entry = now[0]
        now[0] = round(now[0] + seconds, 12)
        if scenario == "late" and entry == .95 and now[0] == 1:
            now[0] = 1.001
        effects.append(("blind-wait", entry, seconds, now[0]))
        if any(item[1] == "STOP" for item in writes):
            kills = [at for at, data in queues[53] if b'"event": "kill"' in data]
            if kills and now[0] >= kills[0]:
                killed[0] = True
                codes["anchor"] = -signal.SIGKILL
                codes["command"] = 0 if codes["command"] == 0 else -signal.SIGTERM
        return [], [], []

    def read(fd, limit):
        effects.append(("read", fd, now[0]))
        ready = []
        while queues[fd] and queues[fd][0][0] <= now[0]:
            ready.append(queues[fd].pop(0)[1])
        data = b"".join(ready)
        if len(data) > limit:
            raise AssertionError("test kernel exceeded read limit")
        return data

    def waitpid(pid, flags):
        role = "command" if pid == 61 else "anchor"
        code = codes[role]
        return (0, 0) if code is None else (pid, code << 8 if code >= 0 else -code)

    def kill(pid, signum):
        if pid != 61 or scenario != "partial-attachment" or signum != signal.SIGTERM:
            raise AssertionError("unexpected direct signal")
        effects.append(("direct-signal", pid, int(signum)))
        codes["command"], killed[0] = -signum, True

    class Socket:
        def __init__(self, *args, **kwargs):
            effects.append(("socket",))
            if scenario == "partial-setup":
                raise ValueError("injected socket setup failure")
        def bind(self, address):
            if address != ("127.0.0.1", 0) and not killed[0]:
                raise AssertionError("probe before physical settlement")
            effects.append(("bind", address))
        def listen(self, count):
            effects.append(("listen", count))
        def getsockname(self):
            if scenario == "snapshot":
                now[0] = .006
            return "127.0.0.1", 31337
        def fileno(self):
            return 80
        def close(self):
            effects.append(("socket-close",))
        def __enter__(self):
            return self
        def __exit__(self, *args):
            self.close()

    def open_file(path, *args, **kwargs):
        if path.parent != root or path.name not in ("owner.json", "fixture.lock"):
            raise AssertionError("unexpected file allocation")
        files.add(path.name)
        effects.append(("file", path.name))
        return string_io.StringIO()

    def unlink(path):
        if path.parent != root or path.name not in files:
            raise AssertionError("unexpected root cleanup")
        files.remove(path.name)
        effects.append(("unlink", path.name))

    def rmdir(path):
        if path != root or files:
            raise AssertionError("wrong/nonempty root removal")
        removed[0] = True
        effects.append(("rmdir",))

    def emit(payload, remaining, **kwargs):
        effects.append(("receipt",))
        emitted.append(copy.deepcopy(payload))
        if scenario == "receipt-refusal":
            raise receipt_refusal
        return True

    real_supervise, real_finish = offline.supervise, ParentExitController.finish
    def supervise(*args, **kwargs):
        receipt = real_supervise(*args, **kwargs)
        owner = kwargs["ops"]
        snapshots.append({"receipt": json.dumps(receipt, sort_keys=True),
                          "execution": None, "finishes": [], "owner": owner})
        return receipt
    def finish(owner, receipt, end):
        witness = getattr(owner.io, "timing_witness", None)
        before = None if witness is None else json.dumps(witness.result()["execution"], sort_keys=True)
        comparison = {"executionBefore": before,
                      "executionFrozenBefore": None if witness is None else witness.result()["executionFrozen"],
                      "receiptBefore": json.dumps(receipt, sort_keys=True)}
        answer = real_finish(owner, receipt, end)
        after = None if witness is None else json.dumps(witness.result()["execution"], sort_keys=True)
        comparison.update(executionAfter=after,
                          executionFrozenAfter=None if witness is None else witness.result()["executionFrozen"],
                          receiptAfter=json.dumps(receipt, sort_keys=True))
        if snapshots:
            snapshots[-1]["finishes"].append(comparison)
            if snapshots[-1]["execution"] is None:
                snapshots[-1]["execution"] = (before, after)
        return answer

    with contextlib.ExitStack() as stack:
        for patch in (
            mock.patch.object(time, "monotonic", side_effect=lambda: now[0]),
            mock.patch.object(offline.RealOps, "monotonic", staticmethod(lambda: now[0])),
            mock.patch.object(offline.subprocess, "Popen", side_effect=popen),
            mock.patch.object(os, "pipe", side_effect=pipe),
            mock.patch.object(os, "close", side_effect=lambda fd: effects.append(("fd-close", fd))),
            mock.patch.object(os, "set_blocking", side_effect=lambda fd, flag: effects.append(("blocking", fd, flag))),
            mock.patch.object(os, "read", side_effect=read),
            mock.patch.object(os, "write", side_effect=write),
            mock.patch.object(os, "waitpid", side_effect=waitpid),
            mock.patch.object(os, "kill", side_effect=kill),
            mock.patch.object(os, "getpid", return_value=51),
            mock.patch.object(os, "getsid", return_value=4000),
            mock.patch.object(os, "getpgid", side_effect=lambda pid: (_ for _ in ()).throw(ProcessLookupError()) if killed[0] else 61),
            mock.patch.object(os, "open", side_effect=lambda *a, **k: effects.append(("lock-open",)) or 33),
            mock.patch.object(select, "select", side_effect=select_effect),
            mock.patch.object(selectors, "DefaultSelector", side_effect=Selector),
            mock.patch.object(fcntl, "flock", side_effect=lambda *a: effects.append(("flock",))),
            mock.patch.object(socket, "socket", side_effect=Socket),
            mock.patch.object(Path, "mkdir", autospec=True, side_effect=lambda path, **k: effects.append(("mkdir", str(path)))),
            mock.patch.object(Path, "open", autospec=True, side_effect=open_file),
            mock.patch.object(Path, "is_symlink", return_value=False),
            mock.patch.object(Path, "resolve", autospec=True, side_effect=lambda path, *a, **k: path),
            mock.patch.object(Path, "read_text", return_value=json.dumps(ctx["roots"][0])),
            mock.patch.object(Path, "iterdir", side_effect=lambda: iter(root / name for name in sorted(files))),
            mock.patch.object(Path, "unlink", autospec=True, side_effect=unlink),
            mock.patch.object(Path, "rmdir", autospec=True, side_effect=rmdir),
            mock.patch.object(os.path, "lexists", side_effect=lambda path: not removed[0]),
            mock.patch.object(offline, "write_json", side_effect=emit),
            mock.patch.object(offline, "supervise", side_effect=supervise),
            mock.patch.object(ParentExitController, "finish", autospec=True, side_effect=finish),
        ):
            stack.enter_context(patch)
        io = NativeGroupIO()
        result = qualification_fixture("missing-custody", ctx, 1, 2, io=io)
        first_witness = copy.deepcopy(result.get("nativeTimingWitness"))
        receipt_before = snapshots[-1]["receipt"] if snapshots else json.dumps(result["receipt"], sort_keys=True)
        owner = snapshots[-1]["owner"] if snapshots else ctx.get("qualificationOwners", [None])[-1]
        second = owner.finish(result["receipt"], 2) if owner is not None else None
        current = getattr(io, "timing_witness", None)
        final_witness = current.result() if current is not None else None
        return {"result": result, "effects": effects, "writes": writes, "emitted": emitted,
                "firstWitness": first_witness, "finalWitness": final_witness, "secondFinish": second,
                "snapshots": snapshots, "receiptBefore": receipt_before,
                "receiptAfter": json.dumps(result["receipt"], sort_keys=True), "ctx": ctx,
                "now": now[0], "registered": "command" in getattr(io.base, "owned", {}),
                "controlRefusal": control_refusal, "receiptRefusal": receipt_refusal}


class PureTests(unittest.TestCase):
    # Catches lost parent observations when an already available frame waits behind a blind wait.
    def test_native_timing_witness_records_predeadline_frame_delayed_by_blind_wait(self):
        observed = native_timing_observation("blind")
        result = observed["result"]
        self.assertIsInstance(result.get("nativeTimingWitness"), dict)
        witness = result["nativeTimingWitness"]
        failure = witness["execution"]["lastFailure"]
        self.assertEqual((failure["role"], failure["event"]), ("anchor", "RELEASE"))
        self.assertEqual((failure["entryUs"], failure["deadlineUs"]), (0, 0))
        self.assertTrue(failure["entryExpired"])
        self.assertEqual((failure["selectCount"], failure["writeAttempts"]), (0, 0))
        self.assertEqual(failure["exception"], "deadline")
        frames = [e for e in witness["execution"]["events"] if e["kind"] == "frame" and e["event"] == "work-ready"]
        self.assertEqual(frames[-1]["observedUs"], 0)
        self.assertIn(("blind-wait", .95, .05, 1.0), observed["effects"])
        self.assertFalse(result["matched"])
        self.assertFalse(result["receipt"]["timedOut"])
        self.assertIsNone(result["receipt"]["childExitCode"])
        self.assertTrue(any("private group control write deadline" in e["diagnostic"] for e in result["receipt"]["errors"]))
        self.assertFalse(any(w[1] == "RELEASE" and w[0] == "anchor" for w in observed["writes"]))
        self.assertIsNone(witness["childEmissionTime"])

    # Catches invented child emission time and accidental late-frame success after scheduling overshoot.
    def test_native_timing_witness_records_first_observation_after_deadline(self):
        observed = native_timing_observation("late")
        result = observed["result"]
        self.assertIsInstance(result.get("nativeTimingWitness"), dict)
        witness = result["nativeTimingWitness"]
        failure = witness["execution"]["lastFailure"]
        self.assertEqual(failure["entryUs"], 1000)
        self.assertTrue(failure["entryExpired"])
        self.assertEqual((failure["selectCount"], failure["writeAttempts"]), (0, 0))
        self.assertIsNone(witness["childEmissionTime"])
        self.assertFalse(result["matched"])
        self.assertFalse(result["receipt"]["timedOut"])
        self.assertFalse(any(w[1] == "RELEASE" and w[0] == "anchor" for w in observed["writes"]))

    # Catches conflation of expired entry with a single on-time select that uses the remaining allowance.
    def test_native_timing_witness_distinguishes_nonwritable_select_expiry(self):
        observed = native_timing_observation("nonwritable")
        result = observed["result"]
        self.assertIsInstance(result.get("nativeTimingWitness"), dict)
        failure = result["nativeTimingWitness"]["execution"]["lastFailure"]
        self.assertEqual((failure["entryUs"], failure["deadlineUs"]), (-50000, 0))
        self.assertFalse(failure["entryExpired"])
        self.assertEqual((failure["selectCount"], failure["writeAttempts"]), (1, 0))
        self.assertEqual((failure["selectEntryUs"], failure["selectReturnUs"], failure["writable"]), (-50000, 0, False))
        self.assertFalse(result["matched"])
        self.assertEqual(failure["exception"], "deadline")

    # Catches cleanup overwriting the original witness/receipt or replenishing inherited execution time.
    def test_native_timing_witness_preserves_ontime_negative_case_and_snapshot(self):
        observed = native_timing_observation("snapshot")
        result = observed["result"]
        self.assertIsInstance(result.get("nativeTimingWitness"), dict)
        self.assertTrue(result["matched"])
        self.assertEqual(result["receipt"]["status"], "incomplete")
        self.assertTrue(any("intentional missing work custody" in e["diagnostic"] for e in result["receipt"]["errors"]))
        self.assertEqual(result["nativeTimingWitness"]["execution"]["preSuperviseRemainingUs"], 994000)
        self.assertTrue(result["nativeTimingWitness"]["executionFrozen"])
        before, after = observed["snapshots"][0]["execution"]
        self.assertIsNotNone(before)
        self.assertEqual(before, after)
        self.assertEqual(json.dumps(observed["finalWitness"]["execution"], sort_keys=True), before)
        self.assertEqual(observed["receiptBefore"], observed["receiptAfter"])
        self.assertTrue(result["originalReceiptUnchanged"])
        self.assertTrue(observed["secondFinish"])
        waits = [e for e in observed["effects"] if e[0] == "blind-wait" and e[1] < .206]
        self.assertEqual(len(waits), 4)
        block = result["nativeTimingWitness"]["execution"]
        self.assertEqual((block["waitCount"], block["requestedWaitUs"], block["observedWaitUs"]), (4, 200000, 200000))
        # Catches an unfrozen first cleanup even when a later finish leaves execution unchanged.
        finishes = observed["snapshots"][0].get("finishes")
        self.assertIsInstance(finishes, list)
        self.assertEqual(len(finishes), 2)
        first, second = finishes
        self.assertTrue(first["executionFrozenBefore"])
        self.assertTrue(first["executionFrozenAfter"])
        self.assertTrue(second["executionFrozenBefore"])
        self.assertTrue(second["executionFrozenAfter"])
        self.assertEqual(first["executionBefore"], before)
        self.assertEqual(first["executionAfter"], after)
        self.assertEqual(first["executionBefore"].encode("utf-8"), first["executionAfter"].encode("utf-8"))
        self.assertEqual(first["executionAfter"].encode("utf-8"), second["executionBefore"].encode("utf-8"))
        self.assertEqual(second["executionBefore"].encode("utf-8"), second["executionAfter"].encode("utf-8"))
        self.assertEqual(json.dumps(observed["finalWitness"]["execution"], sort_keys=True), second["executionAfter"])
        supervisor_receipt = observed["snapshots"][0]["receipt"]
        self.assertEqual(observed["receiptBefore"], supervisor_receipt)
        self.assertEqual(observed["receiptAfter"], supervisor_receipt)
        for finish in finishes:
            self.assertEqual(finish["receiptBefore"], supervisor_receipt)
            self.assertEqual(finish["receiptAfter"], supervisor_receipt)

    # Catches unbounded identical observations, dropped failure summaries and cleanup evicting execution.
    def test_native_timing_witness_caps_both_phases_and_retains_failures(self):
        observed = native_timing_observation("duplicates")
        self.assertIsInstance(observed["result"].get("nativeTimingWitness"), dict)
        self.assertTrue(observed["result"]["matched"])
        collector = _NativeTimingWitness(1)
        for phase in ("execution", "owner-cleanup"):
            for i in range(100):
                collector.record(phase, {"kind": "frame", "event": "work-ready", "observed": .975,
                    "readId": i, "armed": True, "released": False, "stopSent": False})
            collector.record_failure(phase, {"kind": "send", "role": "anchor", "event": "RELEASE", "entry": 1,
                "deadline": 1, "entryExpired": True, "selectCount": 0, "writeAttempts": 0, "exception": "deadline"})
            collector.record_failure(phase, {"kind": "send", "role": "anchor", "event": "STOP", "entry": 1,
                "deadline": 1, "entryExpired": True, "selectCount": 0, "writeAttempts": 0, "exception": "deadline"})
            if phase == "execution":
                collector.freeze_execution()
                frozen = json.dumps(collector.result()["execution"], sort_keys=True)
        witness = collector.result()
        compact = lambda value: json.dumps(value, separators=(",", ":"), allow_nan=False).encode()
        self.assertLessEqual(len(compact(witness)), 4096)
        self.assertLessEqual(len(compact(witness["execution"])), 2816)
        self.assertLessEqual(len(compact(witness["ownerCleanup"])), 1024)
        self.assertEqual(json.dumps(witness["execution"], sort_keys=True), frozen)
        for key, maximum in (("execution", 23), ("ownerCleanup", 7)):
            block = witness[key]
            self.assertLessEqual(len(block["events"]), maximum)
            self.assertEqual(block["lastFailure"]["event"], "STOP")
            self.assertEqual(block["seenEvents"], 102)
            self.assertEqual(block["droppedEvents"], 101 - len(block["events"]))
        self.assertLessEqual(sum(len(witness[k]["events"]) + 1 for k in ("execution", "ownerCleanup")), 32)
        collector.record("execution", {"kind": "startup", "observed": 2, "exception": "other"})
        self.assertEqual(json.dumps(collector.result()["execution"], sort_keys=True), frozen)
        print("native timing cap example: " + compact(witness).decode())

    # Catches raw/unbounded diagnostic data, wrapping original exceptions and collector faults changing writes.
    def test_native_timing_witness_keeps_unknowns_and_does_not_mask_errors(self):
        observed = native_timing_observation("ontime")
        self.assertIsInstance(observed["result"].get("nativeTimingWitness"), dict)
        collector = _NativeTimingWitness(1)
        collector.record("execution", {"kind": "send", "role": "secret role", "event": "secret event",
            "entry": float("nan"), "deadline": 1000, "entryExpired": True, "frameBytes": 5000, "secret": "omit"})
        record = collector.result()["execution"]["events"][0]
        self.assertEqual((record["entryUs"], record["deadlineUs"], record["frameBytes"]), (None, None, None))
        self.assertEqual((record["role"], record["event"]), ("unknown", "unknown"))
        self.assertNotIn("secret", record)
        self.assertEqual(collector.result()["execution"]["unknownObservations"], 3)
        collector.execution["seenEvents"] = 2147483647
        collector.record("execution", {"kind": "startup", "observed": float("inf"), "exception": "other"})
        self.assertEqual(collector.result()["execution"]["seenEvents"], 2147483647)
        self.assertTrue(collector.result()["execution"]["countsSaturated"])
        original = PermissionError(13, "original exception identity")
        with mock.patch.object(time, "monotonic", return_value=.5), mock.patch.object(os, "set_blocking"), \
                mock.patch.object(select, "select", return_value=([], [92], [])), \
                mock.patch.object(os, "write", side_effect=original), \
                mock.patch.object(collector, "record", side_effect=ValueError("collector broke")):
            try:
                group_frame_write(92, {"event": "GO"}, 1, witness=collector, role="command", event="GO")
            except PermissionError as caught:
                self.assertIs(caught, original)
            else:
                self.fail("original operation exception was suppressed")
        witness = collector.result()
        self.assertFalse(witness["available"])
        self.assertEqual(witness["unavailableReason"], "collector-error")
        self.assertTrue(witness["execution"]["collectorFailed"])
        self.assertIsNone(witness["execution"]["lastFailure"]["writtenBytes"])
        # A negative sub-microsecond duration must stay unknown rather than round to zero.
        boundaries = _NativeTimingWitness(1)
        boundaries.record("execution", {"kind": "wait", "entry": 1, "return": 1,
            "requested": -.0000001, "observedDuration": 60.0000001})
        wait = boundaries.result()["execution"]["events"][0]
        self.assertIsNone(wait["requestedUs"])
        self.assertIsNone(wait["observedUs"])
        self.assertEqual(boundaries.result()["execution"]["unknownObservations"], 2)
        boundaries.record_failure("execution", {"kind": "send", "selectCount": 2147483648,
                                                "writeAttempts": 2147483648})
        failure = boundaries.result()["execution"]["lastFailure"]
        self.assertEqual((failure["selectCount"], failure["writeAttempts"]), (2147483647, 2147483647))
        self.assertTrue(boundaries.result()["execution"]["countsSaturated"])
        success = _NativeTimingWitness(1)
        payload = (json.dumps({"event": "GO"}, sort_keys=True) + "\n").encode()
        with mock.patch.object(time, "monotonic", return_value=.5), mock.patch.object(os, "set_blocking"), \
                mock.patch.object(select, "select", return_value=([], [92], [])), \
                mock.patch.object(os, "write", return_value=len(payload)) as writer, \
                mock.patch.object(success, "record", side_effect=ValueError("collector broke")):
            self.assertIsNone(group_frame_write(92, {"event": "GO"}, 1, witness=success, role="command", event="GO"))
            self.assertEqual(writer.call_args_list, [mock.call(92, payload)])
        self.assertFalse(success.result()["available"])
        # An unavailable extra clock sample cannot invent an unexpired entry or mask the write error.
        for bad_sample in (float("nan"), "unavailable clock"):
            sampled = _NativeTimingWitness(1)
            samples = [bad_sample]
            def clock():
                return samples.pop() if samples else .5
            with mock.patch.object(time, "monotonic", side_effect=clock), mock.patch.object(os, "set_blocking"), \
                    mock.patch.object(select, "select", return_value=([], [92], [])), \
                    mock.patch.object(os, "write", side_effect=original):
                caught = None
                try:
                    group_frame_write(92, {"event": "GO"}, 1, witness=sampled, role="command", event="GO")
                except Exception as exc:
                    caught = exc
                self.assertIs(caught, original)
            self.assertIsNone(sampled.result()["execution"]["lastFailure"]["entryExpired"])
        reader = NativeGroupIO()
        reader.base, reader.timing_witness = offline.RealOps(), _NativeTimingWitness(1)
        selector = mock.Mock()
        selector.select.side_effect = original
        reader.handles = [{"selector": selector}]
        try:
            reader.read(offline.OUTPUT_LIMIT)
        except PermissionError as caught:
            self.assertIs(caught, original)
        else:
            self.fail("read refusal was suppressed")
        self.assertIsInstance(reader.timing_witness.result()["execution"]["lastFailure"], dict)
        self.assertEqual(reader.timing_witness.result()["execution"]["lastFailure"]["kind"], "read")
        # Catches an attempted write with no byte count being reported as fully known.
        missing_count = _NativeTimingWitness(1)
        with mock.patch.object(time, "monotonic", return_value=.5), mock.patch.object(os, "set_blocking"), \
                mock.patch.object(select, "select", return_value=([], [92], [])), \
                mock.patch.object(os, "write", side_effect=original) as writer:
            try:
                group_frame_write(92, {"event": "GO"}, 1, witness=missing_count, role="command", event="GO")
            except PermissionError as caught:
                self.assertIs(caught, original)
            else:
                self.fail("missing write count masked the original refusal")
            self.assertEqual(writer.call_args_list, [mock.call(92, payload)])
        missing_block = missing_count.result()["execution"]
        self.assertIsNone(next(e for e in missing_block["events"] if e["kind"] == "write")["writtenBytes"])
        self.assertIsNone(missing_block["lastFailure"]["writtenBytes"])
        self.assertEqual(missing_block["lastFailure"]["writeAttempts"], 1)
        # One applicable field in the write event and one in the retained summary.
        self.assertEqual(missing_block["unknownObservations"], 2)
        self.assertFalse(missing_block["collectorFailed"])
        self.assertTrue(missing_count.result()["available"])
        inapplicable = _NativeTimingWitness(1)
        inapplicable.record_failure("execution", {"kind": "read", "exception": "permission"})
        self.assertIsNone(inapplicable.result()["execution"]["lastFailure"]["writtenBytes"])
        self.assertEqual(inapplicable.result()["execution"]["unknownObservations"], 0)
        inapplicable.record_failure("execution", {"kind": "send", "writeAttempts": 0,
            "entry": 1, "deadline": 1, "entryExpired": True, "exception": "deadline"})
        self.assertEqual(inapplicable.result()["execution"]["unknownObservations"], 0)
        inapplicable.record_failure("execution", {"kind": "send", "writeAttempts": 1, "exception": "permission"})
        self.assertEqual(inapplicable.result()["execution"]["unknownObservations"], 1)
        inapplicable.execution["unknownObservations"] = 2147483647
        inapplicable.record_failure("execution", {"kind": "send", "writeAttempts": 1, "exception": "permission"})
        self.assertEqual(inapplicable.result()["execution"]["unknownObservations"], 2147483647)
        self.assertTrue(inapplicable.result()["execution"]["countsSaturated"])

    # Catches diagnostic fields entering compared frames or changing control payloads/duplicate handling.
    def test_native_timing_witness_preserves_frame_equality_and_control_bytes(self):
        observed = native_timing_observation("duplicates")
        result = observed["result"]
        self.assertIsInstance(result.get("nativeTimingWitness"), dict)
        self.assertTrue(result["matched"])
        self.assertEqual(len([w for w in observed["writes"] if w[0:2] == ("anchor", "RELEASE")]), 1)
        for frame_value in result["frames"].values():
            self.assertNotIn("nativeTimingWitness", frame_value)
            self.assertNotIn("observedUs", frame_value)
        for role, event, at, payload in observed["writes"]:
            expected = {k: observed["ctx"].get(k) for k in GROUP_BINDING}
            expected["event"] = event
            if event == "ARM":
                expected["group"] = 61
            if event == "RELEASE" and role == "anchor":
                expected["settlementEnd"] = at + 1
            self.assertEqual(payload, (json.dumps(expected, sort_keys=True) + "\n").encode())
        conflict = native_timing_observation("conflicting")["result"]
        self.assertFalse(conflict["matched"])
        self.assertTrue(any("conflicting native group frame" in e["diagnostic"] for e in conflict["receipt"]["errors"]))
        self.assertNotIn("conflict", conflict["frames"]["work-ready"])
        self.assertIsInstance(conflict["nativeTimingWitness"]["execution"]["lastFailure"], dict)
        self.assertEqual(conflict["nativeTimingWitness"]["execution"]["lastFailure"]["kind"], "frame")
        self.assertEqual(conflict["nativeTimingWitness"]["execution"]["lastFailure"]["exception"], "value")

    # Catches retries/alternate IO after a refusal and witness emission outside the existing case route.
    def test_native_timing_witness_preserves_refusals_without_extra_io(self):
        observed = native_timing_observation("control-refusal")
        result = observed["result"]
        self.assertIsInstance(result.get("nativeTimingWitness"), dict)
        self.assertFalse(result["ownerClosed"])
        self.assertTrue(result["receipt"]["refusals"])
        self.assertEqual(len([w for w in observed["writes"] if w[0:2] == ("anchor", "RELEASE")]), 1)
        self.assertFalse(any(w[1] == "STOP" for w in observed["writes"]))
        failure = result["nativeTimingWitness"]["execution"]["lastFailure"]
        self.assertEqual((failure["exception"], failure["writeAttempts"], failure["writtenBytes"]), ("permission", 1, None))
        refused = native_timing_observation("receipt-refusal")
        self.assertFalse(refused["result"]["ownerClosed"])
        self.assertEqual(len(refused["emitted"]), 1)
        self.assertTrue(any(e["operation"] == "receipt" and e["errno"] == 13 for e in refused["result"]["receipt"]["refusals"]))
        self.assertTrue(all(set(p) == {"receipt"} for p in observed["emitted"] + refused["emitted"]))
        self.assertFalse(any("nativeTimingWitness" in p["receipt"] for p in observed["emitted"] + refused["emitted"]))
        self.assertFalse(any(e[0] == "direct-signal" for e in observed["effects"] + refused["effects"]))
        # The actual refused RELEASE has one unknown write field in each encoded projection.
        self.assertEqual(result["nativeTimingWitness"]["execution"]["unknownObservations"], 2)

    # Catches discarded partial Popen custody or absent timing evidence being mistaken for closure.
    def test_native_timing_witness_reports_partial_startup_unknown(self):
        observed = native_timing_observation("partial-attachment")
        result = observed["result"]
        self.assertIsInstance(result.get("nativeTimingWitness"), dict)
        self.assertTrue(observed["registered"])
        self.assertTrue(result["ownerClosed"])
        self.assertFalse(result["matched"])
        self.assertFalse(result["nativeTimingWitness"]["available"])
        self.assertEqual(result["nativeTimingWitness"]["unavailableReason"], "partial-startup")
        self.assertIsNone(result["nativeTimingWitness"]["childEmissionTime"])
        self.assertEqual(observed["receiptBefore"], observed["receiptAfter"])
        early = native_timing_observation("partial-setup")["result"]
        self.assertFalse(early["nativeTimingWitness"]["available"])
        self.assertEqual(early["nativeTimingWitness"]["unavailableReason"], "partial-startup")
        unsupported = run_parent_exit_case("missing-custody", dict(context(), requiredResources=["command", "work", "anchor"]),
                                           1, 2, io=FakeNativeGroupIO())["nativeTimingWitness"]
        self.assertFalse(unsupported["available"])
        self.assertEqual(unsupported["unavailableReason"], "unsupported-transport")
        with mock.patch.object(_NativeTimingWitness, "__init__", side_effect=ValueError("collector allocation failed")):
            no_collector = native_timing_observation("partial-attachment")["result"]
        self.assertFalse(no_collector["nativeTimingWitness"]["available"])
        self.assertEqual(no_collector["nativeTimingWitness"]["unavailableReason"], "collector-error")
        self.assertTrue(no_collector["ownerClosed"])
        self.assertFalse(no_collector["matched"])
        self.assertIsInstance(result["nativeTimingWitness"]["execution"]["lastFailure"], dict)
        self.assertEqual(result["nativeTimingWitness"]["execution"]["lastFailure"]["kind"], "startup")
        self.assertEqual(result["nativeTimingWitness"]["execution"]["lastFailure"]["exception"], "value")
        self.assertEqual(early["nativeTimingWitness"]["execution"]["lastFailure"]["kind"], "startup")

    def test_summary_proposal_and_final_refusals_stop_writes_and_restore_handlers(self):
        # Break: summary refusal escapes into the setup-error logger and retries stdout.
        for refusal_at in (1, 2):
            with self.subTest(refusal_at=refusal_at):
                code, attempts, ops = job_summary_observation(summary_refusal_at=refusal_at)
                self.assertEqual(code, 1)
                self.assertEqual(len(attempts), refusal_at,
                                 "summary refusal must not invoke a setup-error or alternate writer")
                self.assertEqual([row.get("sequence") for row in attempts], list(range(refusal_at)))
                self.assertTrue(all("commandDiagnostics" in row for row in attempts))
                self.assertFalse(any(row.get("operation") == "bootstrap-setup" for row in attempts))
                self.assertTrue(ops.handlers_restored)
                self.assertEqual(len(ops.handler_events), 4)
                self.assertEqual([row[0] for row in ops.handler_events],
                                 [signal.SIGTERM, signal.SIGINT, signal.SIGTERM, signal.SIGINT])
                outcome = ops.summary_outcomes[-1]
                self.assertEqual(outcome["status"], "incomplete")
                self.assertFalse(outcome["productAcceptance"])
                self.assertEqual(outcome["refusals"], [{"operation": "job-summary-write", "target": "stdout",
                    "diagnostic": "[Errno 13] injected job-summary refusal: 'stdout'", "errno": 13}])

    def test_nonpermission_summary_error_keeps_existing_setup_diagnostic_and_restores_handlers(self):
        code, attempts, ops = job_summary_observation(summary_error=OSError("injected summary transport failure"))
        self.assertEqual(code, 1)
        self.assertEqual(len(attempts), 2)
        self.assertIn("commandDiagnostics", attempts[0])
        self.assertEqual(attempts[1]["operation"], "bootstrap-setup")
        self.assertIn("injected summary transport failure", attempts[1]["diagnostic"])
        self.assertTrue(ops.handlers_restored)

    def test_stage_writer_late_completion_is_not_reported_as_written(self):
        now, writes = [0.0], []
        def late(payload, remaining):
            writes.append(remaining)
            now[0] = 1.01
            return True
        log = offline.QualificationLog(dict(context(), sourceBundleHash="8" * 64), clock=lambda: now[0], stage_writer=late)
        self.assertFalse(log.stage("case-entry", 1, case="success"), "stage completion after its horizon is not a successful diagnostic write")
        self.assertLessEqual(writes[0], 1)
        self.assertFalse(log.stage("case-return", 2, case="success"))
        self.assertEqual(len(writes), 1)

    def test_qualification_failure_stages_keep_case_through_aggregate_emission(self):
        binding = dict(context(), sourceBundleHash="8" * 64)
        stages = []
        class Case(FakeOps):
            def __init__(self, mode, ctx, end):
                super().__init__(code=7)
                self.mode, self.ctx = mode, ctx
                self.denied_operations, self.finish_actions, self.cleanup_errors = set(), [], []
                self.outlived_command = self.held_stream = False
            def resource_state(self, handle, ctx, output):
                report = super().resource_state(handle, ctx, output)
                report["resources"][0]["id"] = "command"
                return report
            def read_output(self, handle, limit):
                out, err, eof = super().read_output(handle, limit)
                return out, err.replace(b"partial stderr", b"fixture partial stderr command"), eof
            def finish(self, receipt, end):
                return True
        def write(payload, seconds, *, prefix=""):
            if prefix == "COUNCIL_BOOTSTRAP_STAGE ":
                stages.append(copy.deepcopy(payload))
            return True
        env = {"COUNCIL_BOOTSTRAP_ROOT": "/owned/run", "RUNNER_ENVIRONMENT": "github-hosted",
               "RUNNER_OS": "macOS", "RUNNER_ARCH": "ARM64", "GITHUB_REPOSITORY": "arduinitavares/the-council",
               "GITHUB_REPOSITORY_VISIBILITY": "public"}
        with mock.patch.object(os, "environ", env), mock.patch.object(offline, "require_hosted"), \
                mock.patch(__name__ + ".protocol_binding", return_value=binding), mock.patch(__name__ + ".FixtureController", Case), \
                mock.patch.object(offline, "write_json", side_effect=write), mock.patch.object(Path, "is_dir", return_value=True), \
                mock.patch.object(Path, "is_symlink", return_value=False), mock.patch.object(time, "monotonic", return_value=0), \
                mock.patch.object(signal, "getitimer", return_value=(0, 0)), mock.patch.object(signal, "setitimer"), \
                mock.patch.object(signal, "signal"):
            self.assertEqual(run_qualification(30), 1)
        self.assertEqual([row["stage"] for row in stages], ["qualifier-entry", "case-entry", "case-return",
            "owner-settlement-entry", "owner-settlement-return", "aggregate-emission-entry"])
        self.assertEqual(stages[-1]["case"], "success", "aggregate stage must not erase the last attempted case")
        for row in stages:
            self.assertLessEqual(len(("COUNCIL_BOOTSTRAP_STAGE " + json.dumps(row, separators=(",", ":")) + "\n").encode()), 1024)
            for key in ("nonce", "assignmentHash", "invocation", "sourceBundleHash", "sourceCommit", "sourceTree", "job"):
                self.assertEqual(row[key], binding[key])

    def test_command_projection_caps_large_numeric_facts_without_inventing_status(self):
        # Break: individually bounded numbers collectively exceed the command byte cap.
        receipt = {key: 10 ** 220 for key in ("job", "phase", "sourceCommit", "sourceTree", "contractHash", "lockHash",
            "invocation", "nonce", "assignmentHash", "wrapperExitCode", "timedOut", "cancelled", "receiptWritten",
            "executionDuration", "settlementDuration", "executionSeconds", "settlementSeconds", "startedAt", "endedAt")}
        receipt.update(id="qualification", status="incomplete", childExitCode=None, childSignal=None,
                       resources={"complete": None}, output={"stdout": "", "stderr": ""},
                       errors=[{"operation": "receipt", "diagnostic": "🧭" * 1000, "errno": 13}] * 40,
                       cleanupActions=[{"operation": "signal", "target": "x" * 1000, "signal": 15}] * 40)
        projection = offline.command_diagnostic(receipt)
        self.assertLessEqual(len(json.dumps(projection, separators=(",", ":")).encode()), 4096)
        self.assertEqual(projection["status"], "incomplete")
        self.assertIsNone(projection["childExitCode"])
        self.assertIsNone(projection["resources"]["complete"])
        self.assertTrue(projection["omittedFields"])
        self.assertGreater(projection["errors"]["omittedCount"], 0)
        self.assertTrue(projection["errors"]["truncated"])

    def test_job_summary_diagnostics_are_utf8_bounded_and_keep_omissions_explicit(self):
        _, summaries, _ = job_summary_observation(stderr=("é🧭" * 4000).encode())
        attempts = summaries[-1].get("commandDiagnostics", [])
        self.assertEqual(len(attempts), 2, "missing bounded command failure projections")
        for attempt in attempts:
            self.assertLessEqual(len(json.dumps(attempt, separators=(",", ":")).encode()), 4096)
            self.assertNotIn("stdoutBase64", attempt["output"])
            self.assertNotIn("stderrBase64", attempt["output"])
            self.assertTrue(attempt["output"]["rawOutputOmitted"])
        self.assertTrue(attempts[-1]["output"]["stderr"]["truncated"])
        self.assertGreater(attempts[-1]["output"]["stderr"]["omittedBytes"], 0)
        self.assertIsNone(attempts[-1]["childExitCode"])

    def test_parent_retains_only_complete_matching_qualification_stage(self):
        def output(ctx):
            binding = {k: ctx[k] for k in ("nonce", "assignmentHash", "invocation", "sourceBundleHash", "sourceCommit", "sourceTree", "job")}
            frame = dict(binding, schemaVersion=1, diagnosticOnly=True, stage="case-entry", case="success",
                         sequence=0, atMonotonic=1.0, remainingSeconds=29.0)
            def line(value):
                return ("COUNCIL_BOOTSTRAP_STAGE " + json.dumps(value, separators=(",", ":")) + "\n").encode()
            good = line(frame)
            bad = b"COUNCIL_BOOTSTRAP_STAGE {broken}\n"
            for key in binding:
                bad += line(dict(frame, **{key: "foreign"}))
            bad += line(dict(frame, extra="x" * 1100))
            bad += line(dict(frame, sequence=True))
            bad += line(dict(frame, stage="invented"))
            last = dict(frame, sequence=1, stage="case-return")
            return good + bad + line(last) + line(dict(frame, sequence=2))[:-1]
        _, summaries, _ = job_summary_observation(stdout=output)
        attempts = summaries[-1].get("commandDiagnostics", [])
        self.assertEqual(len(attempts), 2, "stage diagnostics missing from actual summary")
        stage = attempts[-1]["qualificationStage"]
        self.assertEqual(stage["last"]["stage"], "case-return")
        self.assertEqual(stage["last"]["sequence"], 1)
        self.assertGreaterEqual(stage["rejected"], 12)
        self.assertTrue(stage["incomplete"])
        self.assertEqual(stage["last"]["nonce"], attempts[-1]["nonce"])
        self.assertNotIn("resources", stage["last"])

    def test_actual_receipt_refusal_still_prevents_job_summary(self):
        code, summaries, _ = job_summary_observation(refuse=True)
        self.assertEqual(code, 1)
        self.assertEqual(summaries, [])

    def test_qualification_stage_refusal_stops_writes_but_continues_final_owner_cleanup(self):
        events, owners = [], []
        binding = dict(context(), sourceBundleHash="8" * 64)
        class Case(FakeOps):
            def __init__(self, mode, ctx, end):
                super().__init__()
                self.mode, self.ctx = mode, ctx
                self.denied_operations, self.finish_actions, self.cleanup_errors = set(), [], []
                self.outlived_command = self.held_stream = False
                owners.append(self)
            def resource_state(self, handle, ctx, output):
                result = super().resource_state(handle, ctx, output)
                result["resources"][0]["id"] = "command"
                return result
            def read_output(self, handle, limit):
                out, err, eof = super().read_output(handle, limit)
                return out, err.replace(b"partial stderr", b"fixture partial stderr command"), eof
            def finish(self, receipt, end):
                events.append("cleanup")
                return True
        def write(payload, remaining, *, prefix=""):
            if prefix == "COUNCIL_BOOTSTRAP_STAGE " and payload["stage"] == "case-return":
                events.append("refused")
                raise PermissionError(13, "stage refused")
            events.append("write")
            return True
        env = {"COUNCIL_BOOTSTRAP_ROOT": "/owned/run", "RUNNER_ENVIRONMENT": "github-hosted",
               "RUNNER_OS": "macOS", "RUNNER_ARCH": "ARM64", "GITHUB_REPOSITORY": "arduinitavares/the-council",
               "GITHUB_REPOSITORY_VISIBILITY": "public"}
        with mock.patch.object(os, "environ", env), mock.patch.object(offline, "require_hosted"), \
                mock.patch(__name__ + ".protocol_binding", return_value=binding), \
                mock.patch(__name__ + ".FixtureController", Case), mock.patch.object(offline, "write_json", side_effect=write), \
                mock.patch.object(Path, "is_dir", return_value=True), mock.patch.object(Path, "is_symlink", return_value=False), \
                mock.patch.object(time, "monotonic", return_value=0), mock.patch.object(signal, "getitimer", return_value=(0, 0)), \
                mock.patch.object(signal, "setitimer"), mock.patch.object(signal, "signal"):
            result = run_qualification(30)
        self.assertEqual(result, 1, "refused diagnostic producer cannot emit an aggregate success")
        self.assertEqual(len(owners), 1)
        self.assertIn("refused", events)
        self.assertEqual(events[events.index("refused") + 1:], ["cleanup"])


    def test_stage_writer_caps_frames_and_stops_shared_route_after_refusal(self):
        factory = getattr(offline, "QualificationLog", None)
        self.assertTrue(callable(factory), "qualification stages need a bounded refusal-retaining producer")
        binding = dict(context(), sourceBundleHash="8" * 64)
        now, writes, receipts = [0.0], [], []
        def writer(payload, remaining):
            writes.append((copy.deepcopy(payload), remaining))
            raise PermissionError(13, "stage refused")
        log = factory(binding, clock=lambda: now[0], stage_writer=writer)
        self.assertFalse(log.stage("case-entry", 1, case="success"))
        self.assertEqual(log.refusal["errno"], 13)
        self.assertEqual(log.refusal["operation"], "qualification-stage")
        self.assertFalse(log.stage("case-return", 1, case="success"))
        with self.assertRaises(PermissionError):
            log.receipt({}, 1, lambda *args: receipts.append(args))
        self.assertEqual(len(writes), 1)
        self.assertEqual(receipts, [])
        oversized = factory(dict(binding, nonce="🧭" * 400), clock=lambda: now[0], stage_writer=lambda *args: writes.append(args))
        self.assertFalse(oversized.stage("qualifier-entry", 1))
        self.assertEqual(len(writes), 1)
        bounded = factory(binding, clock=lambda: now[0], stage_writer=lambda payload, remaining: writes.append((payload, remaining)) or True)
        self.assertTrue(bounded.stage("qualifier-entry", 0.02))
        payload, allowance = writes[-1]
        self.assertLessEqual(allowance, 0.02)
        self.assertLessEqual(len(("COUNCIL_BOOTSTRAP_STAGE " + json.dumps(payload, separators=(",", ":")) + "\n").encode()), 1024)
        now[0] = 0.03
        self.assertFalse(bounded.stage("case-entry", 0.02, case="success"))
        self.assertEqual(len(writes), 2)

    def test_unwritten_qualification_receipt_retains_failure_in_job_summary(self):
        # Break: main drops the only returned failure when its receipt cannot be emitted.
        code, summaries, ops = job_summary_observation()
        self.assertEqual(code, 1)
        self.assertAlmostEqual(ops.close_remaining, 0.05)
        self.assertEqual([r["id"] for r in ops.receipts], ["pure", "pure"])
        summary = summaries[-1]
        self.assertEqual(summary["status"], "incomplete")
        self.assertFalse(summary["productAcceptance"])
        attempts = summary.get("commandDiagnostics", [])
        self.assertEqual([r.get("id") for r in attempts], ["pure", "qualification"],
                         "job summary must retain the unwritten qualification failure")
        failure = attempts[-1]
        self.assertFalse(failure["receiptWritten"])
        self.assertIsNone(failure["childExitCode"])
        self.assertIsNone(failure["childSignal"])
        self.assertTrue(failure["timedOut"])
        self.assertFalse(failure["resources"]["complete"])
        self.assertIn("receipt", [r["operation"] for r in failure["errors"]["items"]])
        self.assertIn("qualification partial stderr", failure["output"]["stderr"]["text"])
        self.assertEqual(failure["sourceCommit"], "1" * 40)
        self.assertEqual(failure["sourceTree"], "2" * 40)
        self.assertEqual(failure["job"], "checks")
        self.assertTrue(failure["nonce"])
        self.assertTrue(failure["assignmentHash"])
        self.assertTrue(failure["diagnosticOnly"])

    def test_native_cleanup_refusal_is_structured_and_never_retried_by_empty_receipt_finish(self):
        result = native_attachment_observation("factory", repeat_finish=True, refuse="cleanup")
        self.assertFalse(result["first"])
        self.assertFalse(result["second"])
        self.assertEqual(sum(event[0] == "refused-unlink" for event in result["events"]), 1)
        self.assertTrue(result["ownerRefusals"])
        refusal = result["ownerRefusals"][0]
        self.assertEqual(refusal["operation"], "root-cleanup")
        self.assertEqual(refusal["target"], "/owned/run/native-partial")
        self.assertIn("native unlink refused", refusal["diagnostic"])
        self.assertEqual(refusal["errno"], 13)
        self.assertTrue(refusal["refusingLayer"])
        self.assertTrue(result["ioRefusals"])
        self.assertEqual(result["receipt"]["status"], "incomplete")
        self.assertTrue(result["receipt"]["receiptWritten"])
        self.assertTrue(result["unchanged"])
        self.assertTrue(result["streamsClosed"])
        self.assertFalse(result["removed"])
        self.assertLess(result["now"], 2)

    def test_native_close_refusal_is_retained_while_permitted_exact_root_cleanup_completes(self):
        result = native_attachment_observation("factory", repeat_finish=True, refuse="close")
        self.assertFalse(result["first"])
        self.assertFalse(result["second"])
        self.assertEqual(sum(event[0] == "refused-close" for event in result["events"]), 1)
        self.assertTrue(result["ownerRefusals"])
        refusal = result["ownerRefusals"][0]
        self.assertEqual(refusal["operation"], "output-close")
        self.assertTrue(refusal["target"])
        self.assertIn("native stream close refused", refusal["diagnostic"])
        self.assertEqual(refusal["errno"], 13)
        self.assertTrue(refusal["refusingLayer"])
        self.assertTrue(result["ioRefusals"])
        self.assertTrue(result["removed"])
        self.assertFalse(result["streamsClosed"])
        self.assertEqual(result["receipt"]["status"], "incomplete")
        self.assertTrue(result["unchanged"])
        self.assertLess(result["now"], 2)

    def test_native_selector_factory_failure_settles_closes_and_removes_exact_partial_root(self):
        result = native_attachment_observation("factory", repeat_finish=True)
        self.assertTrue(result["registered"])
        self.assertEqual(result["receipt"]["status"], "incomplete")
        self.assertIn("selector-factory-failed", str(result["receipt"]["errors"]))
        self.assertTrue(result["receipt"]["receiptWritten"])
        self.assertTrue(result["first"])
        self.assertTrue(result["second"])
        self.assertEqual(result["rawStatus"], -signal.SIGTERM)
        self.assertTrue(result["streamsClosed"])
        self.assertTrue(result["removed"])
        self.assertTrue(result["unchanged"])
        self.assertFalse(any(event[0] == "adapter-read" and event[1] for event in result["events"]))
        self.assertEqual(sum(event[0] == "rmdir" for event in result["events"]), 1)
        self.assertLess(result["now"], 2)

    def test_native_stream_attachment_failure_with_usable_selector_can_settle_partial_root(self):
        result = native_attachment_observation("attachment", repeat_finish=False)
        self.assertTrue(result["registered"])
        self.assertEqual(result["receipt"]["status"], "incomplete")
        self.assertIn("stream-attachment-failed", str(result["receipt"]["errors"]))
        self.assertTrue(result["first"])
        self.assertTrue(result["streamsClosed"])
        self.assertTrue(result["removed"])
        self.assertTrue(result["unchanged"])
        self.assertEqual(result["rawStatus"], -signal.SIGTERM)

    def test_anchor_lost_wait_custody_still_blocks_positive_resource_settlement(self):
        class LostAnchor(FakeNativeGroupIO):
            def status(self, role):
                status = super().status(role)
                if role == "anchor" and status == -signal.SIGKILL:
                    return {"state": "lost", "diagnostic": "anchor wait custody lost"}
                return status
        ctx, io = context(), LostAnchor()
        ctx["requiredResources"] = ["command", "work", "anchor"]
        result = run_parent_exit_case("detached-parent", ctx, 1, 2, io=io)
        self.assertEqual(result["receipt"]["status"], "incomplete")
        self.assertFalse(result["receipt"]["resources"]["complete"])
        self.assertFalse(result["ownerClosed"])
        self.assertTrue(any(e["operation"] == "process-identity" for e in result["receipt"]["errors"]))
        self.assertEqual(io.group_signals, [signal.SIGTERM, signal.SIGKILL])
        self.assertFalse(io.direct_signals)
        self.assertLessEqual(io.now, 2)

    def test_anchor_final_status_and_frame_can_precede_eof_without_losing_custody(self):
        class DelayedEOF(FakeNativeGroupIO):
            def __init__(self):
                super().__init__()
                self.eof_at = None
                self.pending_observed = False
                self.cleanup_at = None
            def read(self, limit):
                out, err, eof = super().read(limit)
                if self.status("anchor") == -signal.SIGKILL:
                    if self.eof_at is None:
                        self.eof_at = self.now + 0.15
                    self.eof = eof = self.now >= self.eof_at
                    if not eof:
                        self.pending_observed = True
                return out, err, eof
            def cleanup(self, registration, ctx, remaining):
                self.cleanup_at = self.now
                return super().cleanup(registration, ctx, remaining)
        ctx, io = context(), DelayedEOF()
        ctx["requiredResources"] = ["command", "work", "anchor"]
        ctx["roots"] = [{"path": "/owned/run/delayed-eof", "nonce": ctx["nonce"],
                         "assignmentHash": ctx["assignmentHash"], "invocation": ctx["invocation"]}]
        result = run_parent_exit_case("detached-parent", ctx, 1, 2, io=io)
        self.assertTrue(io.pending_observed)
        self.assertEqual(result["receipt"]["status"], "passed")
        self.assertEqual(result["receipt"]["childExitCode"], 0)
        self.assertTrue(result["receipt"]["output"]["complete"])
        self.assertTrue(result["receipt"]["resources"]["complete"])
        self.assertEqual(result["receipt"]["errors"], [])
        self.assertTrue(result["ownerClosed"])
        self.assertGreaterEqual(io.cleanup_at, io.eof_at)
        self.assertEqual(io.group_signals, [signal.SIGTERM, signal.SIGKILL])
        self.assertFalse(io.direct_signals)
        self.assertIsNone(result["orphanWaitStatus"])
        self.assertLess(io.now, 2)

    def test_conflicting_controller_identity_remains_unsignalled_during_final_owner_cleanup(self):
        ctx, io = context(), FakeControllerProcessIO(fault="conflicting-ready")
        ctx["qualificationOwners"] = []
        ctx["requiredResources"] = ["custodial-controller"]
        result = run_controller_cancellation_case("controller-cancel-resistant", ctx, 1, 2, io=io)
        owner = ctx["qualificationOwners"][0]
        self.assertFalse(result["matched"])
        self.assertFalse(owner.finish(result["receipt"], 2))
        self.assertFalse(io.signals)

    def test_native_receipt_write_refusal_blocks_any_later_qualification_log_route(self):
        for mode in ("detached-parent", "controller-cancel-resistant"):
            with self.subTest(mode=mode):
                ctx = context()
                ctx["qualificationOwners"] = []
                io = FakeNativeGroupIO() if mode == "detached-parent" else FakeControllerProcessIO()
                calls = []
                def deny(*args):
                    calls.append("write")
                    raise PermissionError(1, "receipt writer refused")
                io.emit = deny
                ctx["requiredResources"] = ["command", "work", "anchor"] if mode == "detached-parent" else ["custodial-controller"]
                result = (run_parent_exit_case if mode == "detached-parent" else run_controller_cancellation_case)(mode, ctx, 1, 2, io=io)
                self.assertFalse(result["receipt"]["receiptWritten"])
                self.assertEqual(calls, ["write"])
                self.assertIn("receipt", getattr(ctx["qualificationOwners"][0], "denied_operations", set()))

    def test_qualification_dispatches_all_eight_cases_before_bound_completion(self):
        class NormalCase(FakeOps):
            def __init__(self, mode, ctx, end):
                super().__init__(code=7 if mode == "exit7" else None if mode in ("deadline", "cancel") else 0,
                                 exit_at=math.inf if mode in ("deadline", "cancel") else 0.1,
                                 cancel_at=0.05 if mode == "cancel" else math.inf)
                self.ctx, self.mode = ctx, mode
                self.denied_operations, self.finish_actions, self.cleanup_errors = set(), [], []
                self.outlived_command = self.held_stream = False
            def read_output(self, handle, limit):
                out, err, eof = super().read_output(handle, limit)
                return out, err.replace(b"partial stderr", b"fixture partial stderr command"), eof
            def resource_state(self, handle, ctx, output):
                result = super().resource_state(handle, ctx, output)
                result["resources"][0]["id"] = "command"
                return result
            def signal(self, target, signum, remaining):
                if self.mode == "deadline" and signum == signal.SIGTERM:
                    return
                super().signal(target, signum, remaining)
            def finish(self, receipt, end):
                return True
        binding, writes, cases = context(), [], []
        binding["sourceBundleHash"] = "8" * 64
        env = {"COUNCIL_BOOTSTRAP_ROOT": "/owned/run", "RUNNER_ENVIRONMENT": "github-hosted",
               "RUNNER_OS": "macOS", "RUNNER_ARCH": "ARM64", "GITHUB_REPOSITORY": "arduinitavares/the-council",
               "GITHUB_REPOSITORY_VISIBILITY": "public"}
        parent_runner, controller_runner = qualification_fixture, run_controller_cancellation_case
        def parent(mode, ctx, end, settle):
            cases.append(mode)
            return parent_runner(mode, ctx, end, settle, io=FakeNativeGroupIO())
        def controller(mode, ctx, end, settle):
            cases.append(mode)
            return controller_runner(mode, ctx, end, settle, io=FakeControllerProcessIO())
        with mock.patch.object(os, "environ", env), mock.patch.object(offline, "require_hosted"), \
                mock.patch(__name__ + ".protocol_binding", return_value=binding), \
                mock.patch(__name__ + ".FixtureController", NormalCase), \
                mock.patch(__name__ + ".qualification_fixture", side_effect=parent), \
                mock.patch(__name__ + ".run_controller_cancellation_case", side_effect=controller), \
                mock.patch.object(Path, "is_dir", return_value=True), mock.patch.object(Path, "is_symlink", return_value=False), \
                mock.patch.object(time, "monotonic", return_value=0), mock.patch.object(signal, "getitimer", return_value=(0, 0)), \
                mock.patch.object(signal, "setitimer"), mock.patch.object(signal, "signal"), \
                mock.patch(__name__ + ".emit_evidence", side_effect=lambda kind, complete, resource, **kw: writes.append((complete, kw)) or True):
            try:
                result = run_qualification(30)
            except Exception as exc:
                self.fail("complete qualification source dispatch still rejected: " + str(exc))
        self.assertEqual(result, 0, str(writes))
        self.assertEqual(cases, ["detached-parent", "missing-custody", "controller-cancel-resistant", "controller-cancel-missing-custody"])
        self.assertTrue(writes[-1][0])
        self.assertEqual(len(writes[-1][1]["details"]), 8)

    def test_armed_anchor_protocol_failure_still_settles_its_owned_group(self):
        class Killed(BaseException):
            pass
        now, signals = [0.0], []
        binding = context()
        def kill(group, signum):
            signals.append(signum)
            if signum == signal.SIGKILL:
                raise Killed()
        def wait(*args):
            now[0] += args[-1]
            return [], [], []
        env = {"COUNCIL_GROUP_CONTROL_FD": "91", "COUNCIL_GROUP_EXECUTION_END": "1",
               "COUNCIL_GROUP_SETTLEMENT_END": "2", "COUNCIL_GROUP_ID": "61"}
        with mock.patch.object(os, "environ", env), mock.patch.object(offline, "require_hosted"), \
                mock.patch(__name__ + ".protocol_binding", return_value=binding), \
                mock.patch(__name__ + ".group_frame_read", side_effect=[group_message(binding, "ARM", group=61), ValueError("late foreign control frame")]), \
                mock.patch.object(os, "getpgrp", return_value=61), mock.patch.object(os, "getpid", return_value=62), \
                mock.patch.object(os, "getppid", return_value=51), mock.patch.object(os, "getsid", return_value=4000), \
                mock.patch.object(os, "killpg", side_effect=kill), mock.patch.object(signal, "signal"), \
                mock.patch.object(time, "monotonic", side_effect=lambda: now[0]), mock.patch.object(select, "select", side_effect=wait):
            try:
                group_fixture_main("group-anchor", emit=lambda frame, end: True)
            except Killed:
                pass
            except Exception as exc:
                self.fail("armed anchor lost teardown on protocol failure: " + str(exc))
        self.assertEqual(signals, [signal.SIGTERM, signal.SIGKILL])
        self.assertLess(now[0], 2)

    def test_native_resource_closure_requires_absent_bound_work_identity(self):
        io = NativeGroupIO()
        io.base = mock.Mock()
        io.base._physical_resources_closed.return_value = True
        io.work_pid = 63
        with mock.patch.object(os, "getpgid", return_value=61):
            self.assertFalse(io.physical_closed(True))
        with mock.patch.object(os, "getpgid", return_value=999):
            self.assertFalse(io.physical_closed(True))
        with mock.patch.object(os, "getpgid", side_effect=ProcessLookupError()):
            self.assertTrue(io.physical_closed(True))
            self.assertFalse(io.physical_closed(False))

    def test_qualification_retains_native_owners_after_incomplete_cases(self):
        for mode in ("detached-parent", "controller-cancel-resistant"):
            with self.subTest(mode=mode):
                ctx = context()
                ctx["qualificationOwners"] = []
                if mode == "detached-parent":
                    ctx["requiredResources"] = ["command", "work", "anchor"]
                    run_parent_exit_case(mode, ctx, 1, 2, io=FakeNativeGroupIO(fault="partial-work"))
                else:
                    ctx["requiredResources"] = ["custodial-controller"]
                    run_controller_cancellation_case(mode, ctx, 1, 2, io=FakeControllerProcessIO(fault="missing-result"))
                self.assertEqual(len(ctx["qualificationOwners"]), 1)
                self.assertIs(ctx["qualificationOwners"][0].ctx, ctx)

    def test_custodial_process_adapter_retains_partial_popen_attachment(self):
        io = ControllerProcessIO()
        process = mock.Mock(pid=71)
        partial = {"process": process, "selector": None, "streams": {}, "eof": False}
        ctx = context()
        ctx["roots"] = [{"path": "/owned/run/controller", "nonce": ctx["nonce"],
                         "assignmentHash": ctx["assignmentHash"], "invocation": ctx["invocation"]}]
        with mock.patch.object(io.base, "spawn", side_effect=offline.PartialSpawnError(ValueError("selector-failed"), partial)):
            with self.assertRaises(offline.PartialSpawnError):
                io.spawn(fixture_spec(), ctx, 1, 2)
        self.assertIs(io.handle, partial)

    def test_native_group_post_spawn_failure_keeps_registered_child_for_bounded_cleanup(self):
        class FailingIO(FakeNativeGroupIO):
            def command(self, ctx, execution_end, settlement_end):
                self.codes["command"] = None
                raise offline.PartialSpawnError(ValueError("selector attachment failed"), "retained-handle")
        ctx, io = context(), FailingIO()
        ctx["requiredResources"] = ["command", "work", "anchor"]
        result = run_parent_exit_case("detached-parent", ctx, 1, 2, io=io)
        self.assertEqual(result["receipt"]["status"], "incomplete")
        self.assertIn("selector attachment failed", str(result["receipt"]["errors"]))
        self.assertIsInstance(io.status("command"), int)
        self.assertTrue(result["ownerClosed"])
        self.assertTrue(result["receipt"]["receiptWritten"])
        self.assertLess(io.now, 2)

    def test_native_group_keeps_partial_frames_separate_for_command_and_anchor_pipes(self):
        class SplitIO(FakeNativeGroupIO):
            def read(self, limit):
                if getattr(self, "tail", b""):
                    out, self.tail = self.tail, b""
                    self.channels = [("command", out)]
                    return out, b"", False
                out, err, eof = super().read(limit)
                if b'"work-ready"' in out:
                    half = len(out) // 2
                    self.tail, out = out[half:], out[:half]
                    anchor = (GROUP_PREFIX + json.dumps(group_message(self.ctx, "armed", pid=62,
                              parentPid=51, group=61, session=4000)) + "\n").encode()
                    self.channels = [("command", out), ("anchor", anchor)]
                    out += anchor
                else:
                    self.channels = [("shared", out)]
                return out, err, eof
        ctx = context()
        ctx["requiredResources"] = ["command", "work", "anchor"]
        result = run_parent_exit_case("detached-parent", ctx, 1, 2, io=SplitIO())
        self.assertEqual(result["receipt"]["status"], "passed")
        self.assertTrue(result["ownerClosed"])
        self.assertIsNone(result["orphanWaitStatus"])

    def test_anchor_output_loss_does_not_abandon_armed_group_or_retry_failed_writer(self):
        class Killed(BaseException):
            pass
        now, attempts, signals = [0.0], [], []
        binding = context()
        def emit(frame, end):
            attempts.append(frame["event"])
            if frame["event"] == "term":
                raise BrokenPipeError("owner output closed")
            return True
        def signal_group(group, signum):
            signals.append(signum)
            if signum == signal.SIGKILL:
                raise Killed()
        def wait(*args):
            now[0] += args[-1]
            return [], [], []
        env = {"COUNCIL_GROUP_CONTROL_FD": "91", "COUNCIL_GROUP_EXECUTION_END": "1",
               "COUNCIL_GROUP_SETTLEMENT_END": "2", "COUNCIL_GROUP_ID": "61"}
        with mock.patch.object(os, "environ", env), mock.patch.object(offline, "require_hosted"), \
                mock.patch(__name__ + ".protocol_binding", return_value=binding), \
                mock.patch(__name__ + ".group_frame_read", side_effect=[group_message(binding, "ARM", group=61), None]), \
                mock.patch.object(os, "getpgrp", return_value=61), mock.patch.object(os, "getpid", return_value=62), \
                mock.patch.object(os, "getppid", return_value=51), mock.patch.object(os, "getsid", return_value=4000), \
                mock.patch.object(os, "killpg", side_effect=signal_group), mock.patch.object(signal, "signal"), \
                mock.patch.object(time, "monotonic", side_effect=lambda: now[0]), mock.patch.object(select, "select", side_effect=wait):
            try:
                group_fixture_main("group-anchor", emit=emit)
            except Killed:
                pass
            except Exception as exc:
                self.fail("armed owner abandoned cleanup after output loss: " + str(exc))
        self.assertEqual(signals, [signal.SIGTERM, signal.SIGKILL])
        self.assertEqual(attempts, ["anchor-ready", "armed", "term"])

    def test_cancelled_native_controller_emits_bound_done_after_actual_handler(self):
        for mode in ("controller-cancel-resistant", "controller-cancel-missing-custody"):
            with self.subTest(mode=mode):
                io, writes, handlers = FakeNativeGroupIO(), [], {}
                base_wait = io.wait
                def wait(seconds):
                    if any(prefix == CONTROLLER_READY for prefix, _ in writes) and not io.group_signals:
                        handlers[signal.SIGTERM](signal.SIGTERM, None)
                    base_wait(seconds)
                io.wait = wait
                def install(signum, handler):
                    previous = handlers.get(signum, signal.SIG_DFL)
                    handlers[signum] = handler
                    return previous
                def write(payload, remaining, *, prefix=""):
                    writes.append((prefix, copy.deepcopy(payload)))
                    return True
                binding = context()
                binding["sourceBundleHash"] = "8" * 64
                env = {"COUNCIL_GROUP_EXECUTION_END": "1", "COUNCIL_GROUP_SETTLEMENT_END": "2",
                       "COUNCIL_BOOTSTRAP_ROOT": "/owned/run", "COUNCIL_GROUP_CASE_ROOT": "/owned/run/group",
                       "RUNNER_ENVIRONMENT": "github-hosted", "RUNNER_OS": "macOS", "RUNNER_ARCH": "ARM64",
                       "GITHUB_REPOSITORY": "arduinitavares/the-council", "GITHUB_REPOSITORY_VISIBILITY": "public"}
                for name in ("NONCE", "INVOCATION", "ASSIGNMENT", "COMMIT", "TREE", "JOB", "SOURCE"):
                    env["COUNCIL_BOOTSTRAP_" + name] = "nonsecret"
                with mock.patch.object(os, "environ", env), mock.patch.object(offline, "require_hosted"), \
                        mock.patch(__name__ + ".protocol_binding", return_value=binding), \
                        mock.patch(__name__ + ".NativeGroupIO", return_value=io), \
                        mock.patch.object(signal, "signal", side_effect=install), \
                        mock.patch.object(time, "monotonic", side_effect=lambda: io.now), \
                        mock.patch.object(offline, "write_json", side_effect=write):
                    result = controller_fixture_main(mode)
                self.assertEqual(result, 1)
                done = [row for prefix, row in writes if prefix == CONTROLLER_DONE][-1]
                self.assertEqual(done["controllerSignal"], signal.SIGTERM)
                self.assertTrue(done["descendantsClosed"])
                self.assertTrue(done["innerCancelled"])
                self.assertEqual(done["parentExitCode"], 0)
                self.assertIsNone(done["orphanWaitStatus"])
                self.assertEqual(io.group_signals, [signal.SIGTERM, signal.SIGKILL])

    def test_external_controller_cancellation_waits_for_live_resistant_or_missing_work(self):
        for mode in ("controller-cancel-resistant", "controller-cancel-missing-custody"):
            with self.subTest(mode=mode):
                ctx, io = context(), FakeControllerProcessIO()
                ctx["requiredResources"] = ["custodial-controller"]
                result = run_controller_cancellation_case(mode, ctx, 1, 2, io=io)
                self.assertTrue(result["matched"])
                self.assertEqual(result["receipt"]["status"], "cancelled")
                self.assertEqual(result["receipt"]["childExitCode"], 1)
                self.assertEqual(io.signals, [signal.SIGTERM])
                self.assertLess(io.events.index("work-ready"), io.events.index("signal-controller"))
                self.assertTrue(result["descendantsClosed"])
                self.assertIsNone(result["orphanWaitStatus"])

    def test_controller_boundary_partial_late_conflicting_and_refused_paths_never_pass(self):
        for fault in ("partial-start", "late-ready", "conflicting-ready", "refused-controller", "lost-controller", "missing-result"):
            with self.subTest(fault=fault):
                ctx, io = context(), FakeControllerProcessIO(fault=fault)
                ctx["requiredResources"] = ["custodial-controller"]
                result = run_controller_cancellation_case("controller-cancel-resistant", ctx, 1, 2, io=io)
                self.assertFalse(result["matched"])
                self.assertNotEqual(result["receipt"]["wrapperExitCode"], 0)
                self.assertTrue(result["receipt"]["receiptWritten"])
                self.assertLessEqual(io.now, 2)
                self.assertNotIn(signal.SIGKILL, io.signals)
                if fault == "refused-controller":
                    self.assertEqual(io.signals, [signal.SIGTERM])
                if fault == "conflicting-ready":
                    self.assertFalse(io.signals)

    def test_parent_exit_private_cli_and_qualifier_select_native_owner(self):
        for role in ("group-command", "group-anchor"):
            with self.subTest(role=role), mock.patch.object(sys, "stderr"), mock.patch.object(sys, "stdout"), mock.patch(__name__ + ".group_fixture_main", return_value=7):
                try:
                    result = cli(["--fixture", role])
                except SystemExit as exc:
                    self.fail("required private fixture role rejected: " + str(exc))
                self.assertEqual(result, 7)
        ctx = context()
        ctx["requiredResources"] = ["command", "work", "anchor"]
        result = qualification_fixture("detached-parent", ctx, 1, 2, io=FakeNativeGroupIO())
        self.assertTrue(result["matched"])
        self.assertIsNone(result["orphanWaitStatus"])
        self.assertTrue(result["outlivedCommand"])

    def test_parent_exit_setup_consumes_original_execution_and_settlement_bounds(self):
        ctx = context()
        ctx["requiredResources"] = ["command", "work", "anchor"]
        io = FakeNativeGroupIO(fault="missing-command")
        io.now = 0.8
        result = run_parent_exit_case("detached-parent", ctx, 1, 2, io=io)
        self.assertTrue(result["receipt"]["timedOut"])
        self.assertLessEqual(result["receipt"]["executionDuration"], 0.2 + 1e-9)
        self.assertLessEqual(io.now, 2)

    def test_anchor_owner_loss_before_arm_never_signals_and_after_arm_uses_own_group(self):
        class Killed(BaseException):
            pass
        import io as string_io
        for armed, refused in ((False, False), (True, False), (True, True)):
            now, signals = [0.0], []
            binding = context()
            frames = [group_message(binding, "ARM", group=61), None] if armed else [None]
            def send_group(group, signum):
                signals.append((group, signum))
                if refused:
                    raise PermissionError(1, "anchor group denied")
                if signum == signal.SIGKILL:
                    raise Killed()
            def advance(*args):
                now[0] += args[-1]
                return [], [], []
            env = {"COUNCIL_GROUP_CONTROL_FD": "91", "COUNCIL_GROUP_EXECUTION_END": "1",
                   "COUNCIL_GROUP_SETTLEMENT_END": "2", "COUNCIL_GROUP_ID": "61"}
            with self.subTest(armed=armed, refused=refused), mock.patch.object(os, "environ", env), \
                    mock.patch.object(offline, "require_hosted"), mock.patch(__name__ + ".protocol_binding", return_value=binding), \
                    mock.patch(__name__ + ".group_frame_read", side_effect=frames), \
                    mock.patch.object(os, "getpgrp", return_value=61), mock.patch.object(os, "getpid", return_value=62), \
                    mock.patch.object(os, "getppid", return_value=51), mock.patch.object(os, "getsid", return_value=4000), \
                    mock.patch.object(os, "killpg", side_effect=send_group), mock.patch.object(signal, "signal"), \
                    mock.patch.object(time, "monotonic", side_effect=lambda: now[0]), \
                    mock.patch.object(select, "select", side_effect=advance), mock.patch.object(sys, "stdout", string_io.StringIO()):
                try:
                    result = group_fixture_main("group-anchor", emit=lambda frame, end: True)
                except Killed:
                    result = -signal.SIGKILL
            self.assertEqual(signals, [] if not armed else [(61, signal.SIGTERM)] if refused else [(61, signal.SIGTERM), (61, signal.SIGKILL)])
            self.assertEqual(result, -signal.SIGKILL if armed and not refused else 1)
            self.assertLess(now[0], 2)

    def test_native_parent_exit_driver_keeps_custody_and_unknown_orphan_wait_status(self):
        ctx = context()
        ctx["requiredResources"] = ["command", "work", "anchor"]
        io = FakeNativeGroupIO()
        result = run_parent_exit_case("detached-parent", ctx, 1, 2, io=io)
        self.assertEqual(result["receipt"]["status"], "passed")
        self.assertEqual(result["receipt"]["childExitCode"], 0)
        self.assertIsNone(result["orphanWaitStatus"])
        self.assertTrue(result["outlivedCommand"])
        self.assertTrue(result["heldStreamAfterExit"])
        self.assertTrue(result["ownerClosed"])
        self.assertTrue(result["originalReceiptUnchanged"])
        self.assertLess(io.events.index("armed"), io.events.index("fork-work"))
        self.assertLess(io.events.index("registered-work"), io.events.index("parent-exit"))
        self.assertEqual(io.group_signals, [signal.SIGTERM, signal.SIGKILL])
        self.assertFalse(io.direct_signals)

    def test_native_missing_custody_negative_is_immutable_after_independent_cleanup(self):
        ctx = context()
        ctx["requiredResources"] = ["command", "work", "anchor"]
        io = FakeNativeGroupIO()
        result = run_parent_exit_case("missing-custody", ctx, 1, 2, io=io)
        self.assertEqual(result["receipt"]["status"], "incomplete")
        self.assertFalse(result["receipt"]["resources"]["complete"])
        self.assertTrue(result["ownerClosed"])
        self.assertTrue(result["originalReceiptUnchanged"])
        self.assertIsNone(result["orphanWaitStatus"])
        self.assertEqual(io.group_signals, [signal.SIGTERM, signal.SIGKILL])

    def test_native_parent_exit_partial_frames_conflicts_and_refusals_fail_closed(self):
        for fault in ("missing-command", "late-anchor", "conflicting-anchor", "refused-stop", "partial-work"):
            with self.subTest(fault=fault):
                ctx = context()
                ctx["requiredResources"] = ["command", "work", "anchor"]
                io = FakeNativeGroupIO(fault=fault)
                result = run_parent_exit_case("detached-parent", ctx, 1, 2, io=io)
                self.assertNotEqual(result["receipt"]["wrapperExitCode"], 0)
                self.assertTrue(result["receipt"]["receiptWritten"])
                if fault == "refused-stop":
                    self.assertFalse(result["ownerClosed"])
                    self.assertEqual(io.stop_attempts, 1)
                if fault in ("missing-command", "late-anchor", "conflicting-anchor"):
                    self.assertNotIn("fork-work", io.events)
                self.assertLessEqual(io.now, 2)

    def test_missing_readiness_deadline_settles_and_emits_incomplete_without_resampling_failure(self):
        ops = FakeOps(exit_at=math.inf, code=None)
        controller = FixtureController.__new__(FixtureController)
        controller.mode, controller.ctx = "cancel", {"executionEnd": 1.0}
        controller.cancel_requested = False
        controller.handshake, controller.partial_stderr = {}, False
        controller.monotonic = ops.monotonic
        failures = []
        def observe():
            try:
                return controller.cancelled()
            except ValueError as exc:
                failures.append(str(exc))
                raise
        ops.cancelled = observe
        try:
            result = offline.supervise(fixture_spec("cancel"), context(), ops=ops)
        except Exception as exc:
            self.fail("readiness failure escaped before final receipt: " + str(exc))
        self.assertEqual(result["status"], "incomplete")
        self.assertFalse(result["cancelled"])
        self.assertEqual(len(failures), 1)
        self.assertIn("readiness/partial-output deadline", str(result["errors"]))
        self.assertEqual(result["childExitCode"], -signal.SIGTERM)
        self.assertTrue(result["receiptWritten"])
        self.assertEqual(ops.receipts[-1]["status"], "incomplete")
        self.assertTrue(ops.receipts[-1]["final"])
        self.assertLess(ops.now, 1.95)

    def test_cancellation_observation_failure_at_finalization_is_retained_once(self):
        for boundary in ("resources", "root", "close", "write-1", "write-2"):
            with self.subTest(boundary=boundary):
                ops, ctx, broken, failures = FakeOps(), context(), [False], []
                if boundary == "root":
                    ctx["roots"] = [{"path": "/owned/run/finalizing", "nonce": ctx["nonce"],
                                     "assignmentHash": ctx["assignmentHash"], "invocation": ctx["invocation"]}]
                method = {"resources": "resource_state", "root": "cleanup_root", "close": "close_output"}.get(boundary, "emit_receipt")
                original, calls = getattr(ops, method), [0]
                def fail_during(*args):
                    calls[0] += 1
                    result = original(*args)
                    if not boundary.startswith("write-") or calls[0] == int(boundary[-1]):
                        broken[0] = True
                    return result
                def observe():
                    if broken[0]:
                        failures.append("cancel observation failed")
                        raise ValueError("cancel observation failed")
                    return False
                setattr(ops, method, fail_during)
                ops.cancelled = observe
                try:
                    result = offline.supervise(fixture_spec(), ctx, ops=ops)
                except Exception as exc:
                    self.fail("finalization callback escaped: " + str(exc))
                self.assertEqual(result["status"], "incomplete")
                self.assertFalse(result["cancelled"])
                self.assertEqual(len(failures), 1)
                self.assertIn("cancel observation failed", str(result["errors"]))
                self.assertTrue(result["receiptWritten"])
                self.assertEqual(ops.receipts[-1]["status"], "incomplete")
                self.assertTrue(ops.receipts[-1]["final"])

    def test_anchored_group_arms_before_work_and_records_actual_parent_exit(self):
        ops = FakeGroupOps()
        group = AnchoredGroup(context(), owner_pid=51, session=4000, ops=ops)
        self.assertTrue(group.parent(group_frame("command", 61, 51)))
        self.assertFalse(group.allow_work())
        self.assertTrue(group.anchor(group_frame("anchor", 62, 51)))
        self.assertFalse(group.allow_work())
        self.assertTrue(group.arm(group_frame("armed", 62, 51)))
        self.assertTrue(group.allow_work())
        self.assertTrue(group.work(group_frame("work", 63, 61)))
        self.assertTrue(group.parent_exit(0))
        self.assertTrue(group.signal(signal.SIGTERM))
        self.assertTrue(group.signal(signal.SIGKILL))
        self.assertFalse(group.signal(signal.SIGKILL))
        self.assertEqual(ops.signals, [(61, signal.SIGTERM), (61, signal.SIGKILL)])
        self.assertIsNone(group.orphan_wait_status)
        self.assertTrue(group.parent_exited)

    def test_anchored_group_loss_partial_setup_and_identity_conflict_are_fail_closed(self):
        for armed in (False, True):
            ops = FakeGroupOps()
            group = AnchoredGroup(context(), owner_pid=51, session=4000, ops=ops)
            self.assertTrue(group.parent(group_frame("command", 61, 51)))
            self.assertTrue(group.anchor(group_frame("anchor", 62, 51)))
            if armed:
                self.assertTrue(group.arm(group_frame("armed", 62, 51)))
            self.assertEqual(group.owner_loss(), "armed-cleanup" if armed else "unarmed-no-signal")
            self.assertEqual(len(ops.signals), 1 if armed else 0)
        ops = FakeGroupOps()
        group = AnchoredGroup(context(), owner_pid=51, session=4000, ops=ops)
        self.assertTrue(group.parent(group_frame("command", 61, 51)))
        self.assertFalse(group.work(group_frame("work", 63, 61)))
        self.assertFalse(group.anchor(group_frame("anchor", 62, 999)))
        self.assertFalse(group.signal(signal.SIGKILL))
        self.assertEqual(ops.signals, [])

    def test_anchored_group_reused_identity_or_refusal_never_gets_an_alternate_signal(self):
        for refusal in (False, True):
            ops = FakeGroupOps()
            group = AnchoredGroup(context(), owner_pid=51, session=4000, ops=ops)
            group.parent(group_frame("command", 61, 51))
            group.anchor(group_frame("anchor", 62, 51))
            group.arm(group_frame("armed", 62, 51))
            if refusal:
                ops.refusal = True
            else:
                ops.identity["pid"] = 999
            self.assertFalse(group.signal(signal.SIGTERM))
            self.assertFalse(group.signal(signal.SIGKILL))
            self.assertEqual(len(ops.signals), 1 if refusal else 0)

    def test_synthetic_cancellation_waits_for_bound_readiness_and_partial_output(self):
        owner = FixtureController.__new__(FixtureController)
        owner.mode, owner.ctx = "cancel", {"cancelAt": 0, "executionEnd": 1}
        owner.cancel_requested = False
        owner.handshake, owner.partial_stderr = {}, False
        owner.cancel_ready_at = None
        clock = [0.6]
        owner.monotonic = lambda: clock[0]
        self.assertFalse(owner.cancelled())
        owner.handshake["command"] = {}
        self.assertFalse(owner.cancelled())
        owner.partial_stderr = True
        self.assertFalse(owner.cancelled())
        clock[0] = 0.66
        self.assertTrue(owner.cancelled())

    def test_readiness_frames_wait_for_complete_bounded_lines(self):
        owner = FixtureController.__new__(FixtureController)
        owner.ctx = dict(context(), sourceBundleHash="5" * 64)
        owner.independent, owner.handshake = None, {}
        owner.owned = {"command": type("Child", (), {"pid": 6262})()}
        frame = "FIXTURE_READY " + json.dumps(dict(owner.ctx, contract=None, role="command", pid=6262))
        try:
            owner._ready(frame[:-20])
            accepted_partial = True
        except ValueError:
            accepted_partial = False
        self.assertTrue(accepted_partial)
        self.assertEqual(owner.handshake, {})
        owner._ready(frame + "\n")
        self.assertIn("command", owner.handshake)

    def test_checkout_commit_tree_and_each_job_are_required_and_bound(self):
        for job in ("checks", "diagnostics", "defaults"):
            env = {"COUNCIL_BOOTSTRAP_COMMIT": "1" * 40, "COUNCIL_BOOTSTRAP_TREE": "2" * 40,
                   "COUNCIL_BOOTSTRAP_JOB": job}
            self.assertEqual(offline.source_binding(env, commit="1" * 40, job=job),
                             {"sourceCommit": "1" * 40, "sourceTree": "2" * 40, "job": job})
            for key in tuple(env):
                bad = dict(env)
                del bad[key]
                with self.assertRaises(ValueError):
                    offline.source_binding(bad, commit="1" * 40, job=job)
            with self.assertRaises(ValueError):
                offline.source_binding(env, commit="9" * 40, job=job)
            with self.assertRaises(ValueError):
                offline.source_binding(env, commit="1" * 40, job="foreign")
            for key in ("sourceCommit", "sourceTree", "job"):
                ops, ctx = FakeOps(), context()
                ctx["job"] = job
                original = ops.resource_state
                def wrong(*args):
                    record = original(*args)
                    record[key] = "mismatched"
                    return record
                ops.resource_state = wrong
                result = offline.supervise(fixture_spec(), ctx, ops=ops)
                self.assertNotEqual(result["status"], "passed")

    def test_lost_wait_custody_is_prompt_incomplete_not_a_timeout(self):
        adapter = offline.RealOps()
        process = type("Child", (), {"pid": 4545, "returncode": None})()
        with mock.patch.object(os, "waitpid", side_effect=ChildProcessError("explicit-lost-wait")):
            observed = adapter.poll({"process": process})
        self.assertEqual(observed, {"state": "lost", "diagnostic": "explicit-lost-wait"})
        ops = FakeOps(exit_at=math.inf, code=None, custody="unbound")
        ops.poll = lambda handle: observed
        result = offline.supervise(fixture_spec(), context(), ops=ops)
        self.assertEqual(result["status"], "incomplete")
        self.assertFalse(result["timedOut"])
        self.assertIsNone(result["childExitCode"])
        self.assertEqual(result["executionDuration"], 0)
        self.assertTrue(any("explicit-lost-wait" in e["diagnostic"] for e in result["errors"]))
        self.assertEqual([c for c in ops.calls if c[0] == "signal"], [])

    def test_truncated_output_still_removes_exact_settled_root(self):
        ops, ctx = FakeOps(), context()
        ctx["roots"] = [{"path": "/owned/run/truncated", "nonce": ctx["nonce"],
                         "assignmentHash": ctx["assignmentHash"], "invocation": ctx["invocation"]}]
        ops.read_output = lambda *_: (b"x" * 1_048_577, b"", True)
        result = offline.supervise(fixture_spec(), ctx, ops=ops)
        self.assertTrue(ops.removed)
        self.assertTrue(result["output"]["truncated"])
        self.assertEqual(result["status"], "incomplete")
        self.assertLess(ops.now, 0.3)

    def test_custodial_qualification_owner_gets_its_original_settlement_budget(self):
        ctx = context()
        ctx["phase"] = "bootstrap"
        spec = offline._render(offline.command_plan("checks", "bootstrap", CONTRACT)[1], ctx)
        ops = FakeOps(exit_at=math.inf, code=None, cancel_at=0)
        def owner_shutdown(target, signum, remaining):
            ops.calls.append(("signal", target, signum, ops.now, remaining))
            if signum == signal.SIGTERM:
                ops.exit_at = ops.eof_at = ops.now + 0.8
                ops.code = 1
            else:
                ops.exit_at = ops.eof_at = ops.now
                ops.code = -signum
        ops.signal = owner_shutdown
        result = offline.supervise(spec, ctx, ops=ops)
        self.assertEqual([c[2] for c in ops.calls if c[0] == "signal"], [signal.SIGTERM])
        self.assertEqual(result["childExitCode"], 1)
        self.assertEqual(result["status"], "cancelled")
        self.assertGreaterEqual(ops.now, 0.8)
        self.assertLessEqual(ops.now, 30)

    def test_cancellation_during_each_finalization_boundary_is_persisted(self):
        for boundary in ("resources", "root", "close", "write-1", "write-2"):
            with self.subTest(boundary=boundary):
                ops, ctx = FakeOps(), context()
                if boundary == "root":
                    ctx["roots"] = [{"path": "/owned/run/finalizing", "nonce": ctx["nonce"],
                                     "assignmentHash": ctx["assignmentHash"], "invocation": ctx["invocation"]}]
                method = {"resources": "resource_state", "root": "cleanup_root", "close": "close_output"}.get(boundary, "emit_receipt")
                original = getattr(ops, method)
                calls = [0]
                def cancel_during(*args):
                    calls[0] += 1
                    result = original(*args)
                    if not boundary.startswith("write-") or calls[0] == int(boundary[-1]):
                        ops.cancel_at = ops.now
                    return result
                setattr(ops, method, cancel_during)
                result = offline.supervise(fixture_spec(), ctx, ops=ops)
                self.assertEqual(result["status"], "cancelled")
                self.assertEqual(result["childExitCode"], 0)
                self.assertNotEqual(result["wrapperExitCode"], 0)
                self.assertEqual(ops.receipts[-1]["status"], "cancelled")
                self.assertTrue(ops.receipts[-1].get("final"))
                if boundary.startswith("write-"):
                    self.assertGreater(len(ops.receipts), int(boundary[-1]))
                    self.assertIn("supersedes", ops.receipts[-1])

    def test_final_job_gate_rechecks_cancellation(self):
        ops = FakeOps()
        def finish(spec, ctx, *, ops):
            ops.cancel_at = ops.now
            return {"status": "passed", "wrapperExitCode": 0, "receiptWritten": True}
        result = offline._run_plan(offline.command_plan("checks", "bootstrap", CONTRACT), context(), ops, runner=finish)
        self.assertFalse(result["complete"])
        self.assertNotEqual(result["status"], "bootstrap-qualified")

    def test_exception_after_owned_spawn_still_settles_and_retains_cause(self):
        for fault in ("output", "resources"):
            with self.subTest(fault=fault):
                ops = FakeOps(exit_at=math.inf, code=None)
                def broken(*args):
                    raise RuntimeError("original-" + fault + "-failure")
                if fault == "output":
                    ops.read_output = broken
                else:
                    ops.resource_state = broken
                result = offline.supervise(fixture_spec(), context(), ops=ops)
                self.assertTrue(any(c[0] == "signal" for c in ops.calls))
                self.assertEqual(result["childExitCode"], -signal.SIGTERM)
                self.assertTrue(any("original-" + fault + "-failure" in e["diagnostic"] for e in result["errors"]))
                self.assertNotEqual(result["wrapperExitCode"], 0)
                self.assertLessEqual(ops.now, 1)

    def test_post_popen_setup_failure_retains_and_closes_partial_owner(self):
        class Stream:
            closed = False
            def close(self):
                self.closed = True
        process = type("Child", (), {"pid": 4242, "returncode": None,
                                     "stdout": Stream(), "stderr": Stream()})()
        ops = offline.RealOps()
        now, signals, persisted = [0.0], [], []
        ops.monotonic = lambda: now[0]
        ops.timestamp = lambda: "test-time"
        ops.poll = lambda handle: process.returncode
        ops.wait = lambda handle, seconds, phase: now.__setitem__(0, now[0] + seconds)
        ops.identity = lambda target, ctx: {"ownership": "owned", "state": "live" if process.returncode is None else "closed"}
        def terminate(target, signum, remaining):
            signals.append(target)
            process.returncode = -signum
        ops.signal = terminate
        ops.emit_receipt = lambda receipt, remaining: persisted.append(copy.deepcopy(receipt)) or True
        with mock.patch.object(offline, "require_hosted"), \
                mock.patch.object(offline.subprocess, "Popen", return_value=process), \
                mock.patch.object(selectors, "DefaultSelector", side_effect=RuntimeError("selector-broke")):
            result = offline.supervise(fixture_spec(), context(), ops=ops)
        self.assertIs(ops.owned.get("command"), process)
        self.assertEqual(signals, ["command"])
        self.assertTrue(process.stdout.closed and process.stderr.closed)
        self.assertEqual(result["childExitCode"], -signal.SIGTERM)
        self.assertTrue(any("selector-broke" in e["diagnostic"] for e in result["errors"]))
        self.assertNotEqual(result["wrapperExitCode"], 0)

    def test_partial_constructor_root_is_removed_without_empty_resource_admission(self):
        ctx = context()
        ctx["roots"] = [{"path": "/owned/run/partial", "nonce": ctx["nonce"],
                         "assignmentHash": ctx["assignmentHash"], "invocation": ctx["invocation"]}]
        allocated = set()
        owner = FixtureController.__new__(FixtureController)
        def mkdir(path, *args, **kwargs):
            allocated.add(str(path))
        def rmdir(path):
            allocated.remove(str(path))
        with mock.patch.object(Path, "mkdir", mkdir), \
                mock.patch.object(Path, "open", side_effect=RuntimeError("owner-file-broke")), \
                mock.patch.object(Path, "read_text", side_effect=FileNotFoundError("owner not created")), \
                mock.patch.object(Path, "exists", lambda path: str(path) in allocated), \
                mock.patch.object(Path, "is_symlink", lambda path: False), \
                mock.patch.object(Path, "resolve", lambda path: path), \
                mock.patch.object(Path, "iterdir", lambda path: iter([])), \
                mock.patch.object(Path, "rmdir", rmdir), \
                mock.patch.object(os.path, "lexists", lambda path: str(path) in allocated):
            with self.assertRaisesRegex(RuntimeError, "owner-file-broke"):
                owner.__init__("success", ctx, 1)
            admitted = owner._physical_resources_closed()
            closed = owner.finish({}, owner.monotonic() + 1)
        self.assertFalse(admitted)
        self.assertTrue(closed)
        self.assertEqual(allocated, set())

    # Break caught: success defaults to incomplete or discards the observed child status/output.
    def test_observed_zero_exit_with_complete_fixture_evidence_passes(self):
        ops = FakeOps()
        result = offline.supervise(fixture_spec(), context(), ops=ops)
        self.assertEqual(result["status"], "passed")
        self.assertEqual(result["childExitCode"], 0)
        self.assertTrue(result["output"]["complete"])
        self.assertIn("partial stdout", result["output"]["stdout"])
        self.assertIn("partial stderr", result["output"]["stderr"])
        self.assertTrue(result["resources"]["complete"])
        self.assertEqual(result["wrapperExitCode"], 0)
        self.assertTrue(result["receiptWritten"])
        self.assertEqual(len([c for c in ops.calls if c[0] == "close-output"]), 1)

    # Break caught: exit zero bypasses resource bindings, receipt persistence, or truncation.
    def test_zero_exit_requires_complete_resource_evidence(self):
        for state in ("retained", "unknown"):
            with self.subTest(state=state):
                result = offline.supervise(fixture_spec(), context(), ops=FakeOps(
                    resource=state, custody="unbound"))
                self.assertEqual(result["status"], "incomplete")
                self.assertNotEqual(result["wrapperExitCode"], 0)
        for mutation in ("nonce", "missing", "receipt", "truncation", "profile", "close", "late-write"):
            with self.subTest(mutation=mutation):
                ctx, ops, spec = context(), FakeOps(), fixture_spec()
                if mutation == "nonce":
                    original = ops.resource_state
                    def wrong_binding(*args):
                        evidence = original(*args)
                        evidence["nonce"] = "another-invocation"
                        return evidence
                    ops.resource_state = wrong_binding
                elif mutation == "missing":
                    ctx["requiredResources"].append("missing-root-owner")
                elif mutation == "receipt":
                    ops.receipt_ok = False
                elif mutation == "truncation":
                    ops.read_output = lambda *_: (b"x" * 1_048_577, b"", True)
                elif mutation == "profile":
                    spec["argv"] = ["npm", "test"]
                elif mutation == "close":
                    ops.close_output = lambda *_: False
                elif mutation == "late-write":
                    def late_write(receipt, remaining):
                        ops.now += remaining + 0.1
                        return True
                    ops.emit_receipt = late_write
                result = offline.supervise(spec, ctx, ops=ops)
                self.assertNotEqual(result["wrapperExitCode"], 0)
                self.assertNotEqual(result["status"], "passed")
                if mutation == "profile":
                    self.assertEqual(ops.calls, [])

    # Break caught: wrapper success or a synthetic timeout replaces the raw wait result.
    def test_preserves_nonzero_and_unknown_child_status(self):
        for code, expected, child_signal in ((7, "failed", None),
                                             (-15, "failed", 15),
                                             (None, "timed-out", None)):
            with self.subTest(code=code):
                ops = FakeOps(code=code, custody="unbound" if code is None else "owned")
                result = offline.supervise(fixture_spec(), context(), ops=ops)
                self.assertEqual(result["childExitCode"], code)
                self.assertEqual(result["childSignal"], child_signal)
                self.assertEqual(result["status"], expected)
                self.assertNotEqual(result["wrapperExitCode"], 0)
        # The OS adapter must not turn ECHILD (no observable wait status) into zero.
        adapter = offline.RealOps()
        process = type("Child", (), {"pid": 4242, "returncode": None})()
        with mock.patch.object(os, "waitpid", return_value=(4242, 7 << 8)):
            self.assertEqual(adapter.child_status(process), 7)
        unknown = type("Child", (), {"pid": 4343, "returncode": None})()
        adapter.register("unknown", unknown, context())
        signals = []
        with mock.patch.object(os, "waitpid", side_effect=ChildProcessError("no child status")), \
                mock.patch.object(os, "kill", side_effect=lambda *args: signals.append(args)):
            self.assertIsNone(adapter.child_status(unknown))
            self.assertEqual(adapter.identity("unknown", context())["state"], "unknown")
            with self.assertRaises(ValueError):
                adapter.signal("unknown", signal.SIGTERM, 1)
        self.assertEqual(signals, [])

    # Break caught: settlement resets execution or uses wall clock instead of elapsed time.
    def test_deadline_and_settlement_use_separate_monotonic_bounds(self):
        ops = FakeOps(exit_at=math.inf, code=None, custody="unbound", resource="unknown")
        result = offline.supervise(fixture_spec("deadline"), context(), ops=ops)
        self.assertEqual(result["status"], "timed-out")
        self.assertAlmostEqual(result["executionDuration"], 1, places=6)
        self.assertLessEqual(result["settlementDuration"], 1)
        self.assertLessEqual(ops.now, 2)
        for _, phase, started, duration in (c for c in ops.calls if c[0] == "wait"):
            self.assertLessEqual(started + duration, 1 if phase == "execution" else 2)
        # Resource observation after an already observed exit belongs to
        # settlement; it cannot delay the start of that separate clock.
        ops = FakeOps(exit_at=0, eof_at=0)
        ops.sent_output = True  # This timing case starts with both streams already at EOF.
        observe = ops.resource_state
        def slow_observation(*args):
            ops.now += 0.4
            return observe(*args)
        ops.resource_state = slow_observation
        result = offline.supervise(fixture_spec(), context(), ops=ops)
        self.assertEqual(result["status"], "passed")
        self.assertEqual(result["executionDuration"], 0)
        self.assertAlmostEqual(result["settlementDuration"], 0.4)

    # Break caught: communicate/read/wait blocks on a descendant-held stream after exit.
    def test_open_stream_does_not_extend_settlement(self):
        ops = FakeOps(eof_at=math.inf)
        result = offline.supervise(fixture_spec(), context(), ops=ops)
        self.assertEqual(result["childExitCode"], 0)
        self.assertEqual(result["status"], "incomplete")
        self.assertFalse(result["output"]["complete"])
        self.assertLessEqual(ops.now, 1.1)
        self.assertIn("partial stdout", result["output"]["stdout"])

    # Break caught: cancellation discards output/status or is accepted as successful cleanup.
    def test_cancellation_preserves_partial_output_and_fails(self):
        ops = FakeOps(exit_at=0.3, cancel_at=0.1)
        result = offline.supervise(fixture_spec("cancel"), context(), ops=ops)
        self.assertEqual(result["status"], "cancelled")
        self.assertTrue(result["cancelled"])
        self.assertEqual(result["childExitCode"], 0)
        self.assertIn("partial stdout", result["output"]["stdout"])
        self.assertNotEqual(result["wrapperExitCode"], 0)

    # Break caught: an unbound pid or reused generation is targeted by termination/escalation.
    def test_unbound_or_reused_identity_is_never_signalled(self):
        for ownership in ("unbound", "conflict"):
            with self.subTest(ownership=ownership):
                ops = FakeOps(exit_at=math.inf, code=None, custody=ownership)
                result = offline.supervise(fixture_spec("deadline"), context(), ops=ops)
                self.assertNotEqual(result["wrapperExitCode"], 0)
                self.assertEqual([c for c in ops.calls if c[0] == "signal"], [])
                self.assertTrue(any("identity" in e["operation"] for e in result["errors"]))

    # Break caught: EPERM is swallowed or retried as killpg/a different signal after refusal.
    def test_refusal_is_retained_without_an_alternate_signal_route(self):
        ops = FakeOps(exit_at=math.inf, code=None, refusal=True)
        result = offline.supervise(fixture_spec("deadline"), context(), ops=ops)
        signals = [c for c in ops.calls if c[0] == "signal"]
        self.assertEqual(len(signals), 1)
        self.assertEqual(signals[0][2], signal.SIGTERM)
        self.assertEqual(result["refusals"][0]["operation"], "signal")
        self.assertIn("fixture signal refused", result["refusals"][0]["diagnostic"])
        self.assertNotEqual(result["wrapperExitCode"], 0)

    # Break caught: a root is removed before reaping or without exact invocation custody.
    def test_crash_root_cleanup_requires_settlement_and_exact_ownership(self):
        for case in ("owned", "unsettled", "foreign", "outside", "verify-failed"):
            with self.subTest(case=case):
                ctx = context()
                ctx["roots"] = [{"path": "/owned/run/crash-one", "nonce": "pure-nonce",
                                 "invocation": "pure-invocation", "assignmentHash": "4" * 64}]
                ops = FakeOps()
                if case == "unsettled":
                    ops.resource, ops.custody = "unknown", "unbound"
                elif case == "foreign":
                    ctx["roots"][0]["nonce"] = "foreign"
                elif case == "outside":
                    ctx["roots"][0]["path"] = "/owned/other/crash-one"
                elif case == "verify-failed":
                    ops.cleanup_root = lambda *_: {"absent": False,
                                                  "path": "/owned/run/crash-one"}
                result = offline.supervise(fixture_spec(), ctx, ops=ops)
                removals = [c for c in ops.calls if c[0] == "remove-root"]
                if case == "owned":
                    self.assertEqual(result["status"], "passed")
                    self.assertEqual(len(removals), 1)
                    self.assertEqual(removals[0][1], "/owned/run/crash-one")
                    self.assertGreaterEqual(removals[0][2], 0.1)
                    self.assertTrue(result["cleanupActions"][0]["absent"])
                else:
                    self.assertEqual(removals, [])
                    self.assertNotEqual(result["status"], "passed")

    # Break caught: inherited provider/npm/concurrency settings contaminate the child.
    def test_private_environment_excludes_inherited_credentials_and_node_options(self):
        hostile = {"OPENAI_API_KEY": "do-not-inherit", "GITHUB_TOKEN": "private",
                   "NODE_OPTIONS": "--require hostile", "npm_config_jobs": "1",
                   "HOME": "/foreign", "PATH": "/foreign/bin", "VITEST_MAX_THREADS": "1"}
        with mock.patch.object(os, "environ", hostile):
            env = offline.command_environment("/pinned/bin/node", "/owned/run", "/owned/cache", offline=True)
        self.assertEqual(env["PATH"], "/pinned/bin:/usr/bin:/bin:/usr/sbin:/sbin")
        self.assertEqual(env["HOME"], "/owned/run/home")
        self.assertEqual(env["TMPDIR"], "/owned/run/tmp")
        self.assertEqual(env["npm_config_cache"], "/owned/cache")
        self.assertEqual(env["npm_config_offline"], "true")
        self.assertEqual(env["npm_config_userconfig"], "/owned/run/user.npmrc")
        self.assertEqual(env["npm_config_globalconfig"], "/owned/run/global.npmrc")
        self.assertEqual(env["SHELL"], "/bin/sh")
        for key in hostile:
            if key not in ("HOME", "PATH"):
                self.assertNotIn(key, env)
        online = offline.command_environment("/pinned/bin/node", "/owned/run2", "/owned/cache", offline=False)
        self.assertEqual(online["npm_config_offline"], "false")
        self.assertNotEqual(online["TMPDIR"], env["TMPDIR"])

    # Break caught: an incomplete first receipt permits repetition two or three.
    def test_three_defaults_stop_at_first_incomplete_result(self):
        plan = [p for p in offline.command_plan("defaults", "candidate", CONTRACT)
                if p["id"].startswith("defaults-")]
        self.assertEqual([p["argv"] for p in plan], [["npm", "test"]] * 3)
        for failed_status in ("failed", "incomplete", "timed-out", "cancelled"):
            with self.subTest(status=failed_status):
                started = []
                def run(spec, ctx, *, ops):
                    started.append(spec["id"])
                    return {"status": failed_status, "wrapperExitCode": 1, "receiptWritten": True}
                result = offline._run_plan(plan, context(), FakeOps(), runner=run)
                self.assertEqual(started, ["defaults-1"])
                self.assertFalse(result["complete"])

    # Break caught: a fresh product job omits its build or changes approved payload/budget.
    def test_each_product_job_has_its_own_build(self):
        expected = {"checks": ["setup", "typecheck", "build", "causal"],
                    "diagnostics": ["setup", "build", "c12"],
                    "defaults": ["setup", "build", "defaults-1", "defaults-2", "defaults-3"]}
        for job, ids in expected.items():
            with self.subTest(job=job):
                plan = offline.command_plan(job, "candidate", CONTRACT)
                self.assertEqual([p["id"] for p in plan], ids)
                self.assertTrue(all(p["executionEnabled"] is False for p in plan))
                setup = plan[0]
                self.assertLessEqual(setup["executionSeconds"] + setup["settlementSeconds"], 300)
                build = next(p for p in plan if p["id"] == "build")
                self.assertEqual((build["argv"], build["executionSeconds"], build["settlementSeconds"]),
                                 (["npm", "run", "build"], 120, 30))
                ops = FakeOps()
                rejected = offline.supervise(build, context(), ops=ops)
                self.assertNotEqual(rejected["wrapperExitCode"], 0)
                self.assertEqual(ops.calls, [])
        diagnostics_plan = offline.command_plan("diagnostics", "candidate", CONTRACT)
        self.assertEqual(len(diagnostics_plan), 3)
        diagnostics = diagnostics_plan[2]
        self.assertEqual(diagnostics["argv"], ["npm", "test", "--",
            "test/pilot/context-diagnostics.test.ts", "test/pilot/workflow-diagnostics.test.ts",
            "test/pilot/native-command.test.ts", "test/pilot/allowance.test.ts",
            "test/pilot/journal-diagnostics.test.ts", "test/pilot/provider-diagnostics.test.ts",
            "test/pilot/diagnostics.test.ts"])

    # Break caught: bootstrap/expected-RED is upgraded to final product acceptance.
    def test_bootstrap_and_expected_red_cannot_satisfy_acceptance(self):
        plan = offline.command_plan("checks", "bootstrap", CONTRACT)
        self.assertEqual([p["id"] for p in plan], ["pure", "qualification"])
        def passed(*args, **kwargs):
            return {"status": "passed", "wrapperExitCode": 0, "receiptWritten": True}
        result = offline._run_plan(plan, context(), FakeOps(), runner=passed)
        self.assertEqual(result["status"], "bootstrap-qualified")
        self.assertFalse(result["productAcceptance"])
        for status in ("expected-red", "bootstrap-qualified", "skipped"):
            def not_passed(*args, **kwargs):
                return {"status": status, "wrapperExitCode": 0, "receiptWritten": True}
            result = offline._run_plan(plan, context(), FakeOps(), runner=not_passed)
            self.assertFalse(result["complete"])
            self.assertFalse(result["productAcceptance"])
        changed = copy.deepcopy(CONTRACT)
        changed["selection"] = "candidate"
        with self.assertRaises(ValueError):
            offline.command_plan("checks", "selected", changed)


_PURE_ACTIVE = False


def group_frame(role, pid, parent):
    return dict(context(), role=role, pid=pid, parentPid=parent, group=61, session=4000)


class FakeGroupOps:
    def __init__(self):
        self.identity = {"pid": 62, "group": 61, "session": 4000, "live": True}
        self.signals, self.refusal = [], False
    def anchor_identity(self):
        return dict(self.identity)
    def signal_group(self, group, signum):
        self.signals.append((group, signum))
        if self.refusal:
            raise PermissionError(1, "anchored-group-refused")


class AnchoredGroup:
    def __init__(self, binding, *, owner_pid, session, ops):
        self.binding, self.owner_pid, self.session, self.ops = binding, owner_pid, session, ops
        self.parent_pid = self.anchor_pid = self.work_pid = self.group = None
        self.armed = self.killed = self.refused = False
        self.errors = []
        self.orphan_wait_status, self.parent_exited = None, False

    def _bound(self, frame, role):
        keys = ("nonce", "assignmentHash", "invocation", "sourceCommit", "sourceTree", "job")
        return (isinstance(frame, dict) and frame.get("role") == role
                and all(frame.get(k) == self.binding[k] for k in keys)
                and ("sourceBundleHash" not in self.binding or frame.get("sourceBundleHash") == self.binding["sourceBundleHash"])
                and type(frame.get("pid")) is int and frame["pid"] > 1
                and frame.get("session") == self.session)

    def parent(self, frame):
        if (self.parent_pid is not None or not self._bound(frame, "command")
                or frame.get("parentPid") != self.owner_pid or frame.get("group") != frame["pid"]):
            return False
        self.parent_pid = self.group = frame["pid"]
        return True

    def anchor(self, frame):
        if (self.parent_pid is None or self.anchor_pid is not None or not self._bound(frame, "anchor")
                or frame.get("parentPid") != self.owner_pid or frame.get("group") != self.group
                or frame["pid"] == self.parent_pid):
            return False
        self.anchor_pid = frame["pid"]
        return True

    def _anchor_live(self):
        observed = self.ops.anchor_identity()
        return (observed.get("live") is True and observed.get("pid") == self.anchor_pid
                and observed.get("group") == self.group and observed.get("session") == self.session)

    def arm(self, frame):
        if (self.anchor_pid is None or self.armed or not self._bound(frame, "armed")
                or frame["pid"] != self.anchor_pid or frame.get("group") != self.group
                or not self._anchor_live()):
            return False
        self.armed = True
        return True

    def allow_work(self):
        return self.armed and not self.refused and not self.killed

    def work(self, frame):
        if (not self.allow_work() or self.parent_exited or not self._bound(frame, "work")
                or frame.get("parentPid") != self.parent_pid or frame.get("group") != self.group
                or frame["pid"] in (self.parent_pid, self.anchor_pid)):
            return False
        self.work_pid = frame["pid"]
        return True

    def parent_exit(self, status):
        if type(status) is not int or self.work_pid is None or not self.armed:
            return False
        self.parent_exited = True
        return True

    def signal(self, signum):
        if not self.allow_work() or signum not in (signal.SIGTERM, signal.SIGKILL):
            return False
        try:
            if not self._anchor_live():
                self.refused = True
                self.errors.append("lost/conflicting live anchor identity")
                return False
            self.ops.signal_group(self.group, signum)
            self.killed = signum == signal.SIGKILL
            return True
        except PermissionError as exc:
            self.refused = True
            self.errors.append("signal refusal: " + str(exc))
            return False

    def owner_loss(self):
        if not self.armed:
            return "unarmed-no-signal"
        self.signal(signal.SIGTERM)
        return "armed-cleanup"


def pure_audit(event, args):
    if not _PURE_ACTIVE:
        return
    if event == "open":
        mode, flags = args[1], args[2]
        if (isinstance(mode, str) and any(c in mode for c in "wax+")) or (
                isinstance(flags, int) and flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC)):
            raise AssertionError("pure test attempted a filesystem write")
    if event.startswith(("subprocess.", "socket.")) or event in {
            "os.system", "os.fork", "os.posix_spawn", "os.kill", "os.killpg",
            "os.remove", "os.rmdir", "os.mkdir", "os.rename", "os.link", "os.symlink",
            "os.truncate", "os.chmod", "os.putenv", "os.unsetenv"}:
        raise AssertionError("pure test attempted " + event)


def run_pure(deadline):
    global _PURE_ACTIVE
    if not 0 < deadline <= 30:
        raise ValueError("pure deadline must be at most 30 seconds")
    guard_write = os.write
    def expired(signum, frame):
        guard_write(2, b"pure runner exceeded its deadline\n")
        os._exit(124)
    old_handler = signal.signal(signal.SIGALRM, expired)
    old_timer = signal.setitimer(signal.ITIMER_REAL, deadline)
    sys.addaudithook(pure_audit)
    def prohibited(*args, **kwargs):
        raise AssertionError("pure test attempted a real wait/sleep/signal")
    patches = [mock.patch.object(time, "sleep", prohibited),
               mock.patch.object(os, "waitpid", prohibited),
               mock.patch.object(os, "kill", prohibited),
               mock.patch.object(os, "killpg", prohibited),
               mock.patch.object(os, "write", prohibited),
               mock.patch.object(select, "select", prohibited),
               mock.patch.object(selectors.DefaultSelector, "select", prohibited)]
    if hasattr(os, "waitid"):
        patches.append(mock.patch.object(os, "waitid", prohibited))
    try:
        for patch in patches:
            patch.start()
        _PURE_ACTIVE = True
        result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(PureTests))
    finally:
        _PURE_ACTIVE = False
        for patch in reversed(patches):
            patch.stop()
        signal.setitimer(signal.ITIMER_REAL, *old_timer)
        signal.signal(signal.SIGALRM, old_handler)
    return 0 if result.wasSuccessful() else 1


def protocol_binding():
    names = {"nonce": "COUNCIL_BOOTSTRAP_NONCE", "assignmentHash": "COUNCIL_BOOTSTRAP_ASSIGNMENT",
             "invocation": "COUNCIL_BOOTSTRAP_INVOCATION", "sourceBundleHash": "COUNCIL_BOOTSTRAP_SOURCE"}
    result = {key: os.environ[name] for key, name in names.items()}
    result.update(offline.source_binding(os.environ))
    if any(not isinstance(value, str) or not value or len(value) > 256 for value in result.values()):
        raise ValueError("missing or malformed bootstrap binding")
    if result["sourceBundleHash"] != offline.bundle_hash(offline.source_files()):
        raise ValueError("bootstrap source changed")
    return result


def emit_evidence(kind, complete, resource_id, *, details=None, seconds=0.5, stage_frame=None, writer=None):
    if stage_frame is not None:
        return offline.write_json(stage_frame, seconds, prefix=offline.STAGE_PREFIX)
    report = dict(protocol_binding(), kind=kind, complete=complete,
                  resources=[{"id": resource_id, "ownership": "owned",
                              "state": "closed" if complete else "unknown"}],
                  errors=[] if complete else ["qualification or cleanup incomplete"],
                  details=details)
    return (offline.write_json if writer is None else writer)(report, seconds, prefix=offline.EVIDENCE_PREFIX)


def fixture_main(mode):
    """Inert, finite fixture. It never launches a provider, shell or product command."""
    import fcntl
    import select
    import socket
    offline.require_hosted()
    binding = protocol_binding()
    root = Path(os.environ["COUNCIL_BOOTSTRAP_FIXTURE_ROOT"])
    owner = json.loads((root / "owner.json").read_text())
    if any(owner.get(k) != binding[k] for k in ("nonce", "assignmentHash", "invocation")):
        raise ValueError("fixture root is not bound to this invocation")
    role = "work" if mode == "resistant" else "command"
    listener = None
    lock = None
    try:
        if mode not in ("detached-parent", "missing-custody"):
            listener = socket.socket(fileno=int(os.environ["COUNCIL_BOOTSTRAP_PORT_FD"]))
            lock = os.open(root / "fixture.lock", os.O_RDONLY | os.O_NOFOLLOW)
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if mode in ("deadline", "resistant"):
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
        # Resistance is installed before readiness, so the controller need not
        # race a just-started child's signal-handler initialization.
        # Each handshake is source-, assignment- and nonce-bound, never just a PID sample.
        print("fixture partial stderr " + role, file=sys.stderr, flush=True)
        print("FIXTURE_READY " + json.dumps(dict(binding, role=role, pid=os.getpid(),
                                                   parentPid=os.getppid())), flush=True)
        if mode in ("success", "detached-parent", "missing-custody"):
            return 0
        if mode == "exit7":
            return 7
        # A fixture is finite even if its controller fails. This is not credited
        # as supervisor cleanup: qualification checks actual signal/wait receipts.
        end = time.monotonic() + 12
        while time.monotonic() < end:
            select.select([], [], [], min(0.05, max(0, end - time.monotonic())))
        return 0
    finally:
        if lock is not None:
            os.close(lock)
        if listener is not None:
            listener.close()


class FixtureController(offline.RealOps):
    """Owns all handles and exact paths allocated by one disposable hosted case.

    Parent-exit modes are held until their actual anchored ownership protocol
    is integrated. Siblings are never accepted as parent-exit evidence.
    """

    def __init__(self, mode, ctx, outer_end):
        super().__init__()
        import socket
        self.mode, self.ctx, self.outer_end = mode, ctx, outer_end
        self.root = Path(ctx["roots"][0]["path"])
        self.listener = None
        self.port = None
        self.independent = None
        self.handles = []
        self.handshake = {}
        self.partial_stderr = False
        self.cancel_ready_at = None
        self.outlived_command = False
        self.held_stream = False
        self.cleanup_errors = []
        self.finish_actions = []
        self.denied_targets = set()
        self.denied_operations = set()
        self.pre_output = b""
        self.spare_fds = []
        self.root_created = False
        self.allocated_files = set()
        # Record the root before each subsequent fallible allocation.
        self.root.mkdir(mode=0o700)
        self.root_created = True
        with (self.root / "owner.json").open("x") as out:
            self.allocated_files.add("owner.json")
            json.dump(ctx["roots"][0], out)
        with (self.root / "fixture.lock").open("x"):
            self.allocated_files.add("fixture.lock")
            pass
        self.listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen(1)
        self.port = self.listener.getsockname()[1]

    def spawn(self, spec, ctx):
        import io
        import select
        import selectors
        import subprocess
        offline.require_hosted()
        if not offline._admitted(spec, ctx):
            raise ValueError("unadmitted fixture command")
        if signal.getsignal(signal.SIGCHLD) != signal.SIG_DFL:
            raise ValueError("fixture custody requires the default SIGCHLD disposition")
        ctx["executionEnd"] = self.monotonic() + spec["executionSeconds"]
        env = dict(ctx["environment"])
        env["COUNCIL_BOOTSTRAP_FIXTURE_ROOT"] = str(self.root)
        env["COUNCIL_BOOTSTRAP_PORT_FD"] = str(self.listener.fileno())
        detached = self.mode in ("detached-parent", "missing-custody")
        if detached:
            raise ValueError("parent-exit qualification held: anchored native ownership integration incomplete")
        process = subprocess.Popen(spec["argv"], cwd=ctx["cwd"], env=env,
                                   stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   start_new_session=True, close_fds=True, pass_fds=(self.listener.fileno(),))
        stdout = process.stdout
        self.register("command", process, ctx)
        handle = {"process": process, "selector": None,
                  "streams": {"stdout": stdout, "stderr": process.stderr}, "eof": False}
        self.handles.append(handle)
        try:
            handle["selector"] = selectors.DefaultSelector()
            for name, stream in handle["streams"].items():
                os.set_blocking(stream.fileno(), False)
                handle["selector"].register(stream, selectors.EVENT_READ, name)
            self.listener.close()
            return handle
        except Exception as exc:
            raise offline.PartialSpawnError(exc, handle) from exc

    def read_output(self, handle, limit):
        out, err, eof = super().read_output(handle, limit)
        if self.pre_output:
            out = self.pre_output + out
            self.pre_output = b""
        return out, err, eof

    def cancelled(self):
        if self.cancel_requested:
            return True
        if self.mode != "cancel":
            return False
        if "command" in self.handshake and self.partial_stderr:
            if self.cancel_ready_at is None:
                self.cancel_ready_at = self.monotonic()
            return self.monotonic() >= self.cancel_ready_at + 0.05
        if self.monotonic() >= self.ctx["executionEnd"] - 0.05:
            raise ValueError("command readiness/partial-output deadline; synthetic cancellation not armed")
        return False

    def _ready(self, text):
        for line in text.splitlines(keepends=True):
            if not line.endswith("\n"):
                continue
            if len(line) > 8192:
                raise ValueError("oversized fixture readiness frame")
            if not line.startswith("FIXTURE_READY "):
                continue
            report = json.loads(line[len("FIXTURE_READY "):])
            role = report.get("role")
            process = self.independent if role == "work" and self.independent is not None else self.owned.get(role)
            if (process is None or report.get("pid") != process.pid
                    or any(report.get(k) != self.ctx[k] for k in (
                        "nonce", "assignmentHash", "invocation", "sourceBundleHash", "sourceCommit", "sourceTree", "job"))):
                raise ValueError("fixture readiness identity mismatch")
            if role in self.handshake and self.handshake[role] != report:
                raise ValueError("conflicting fixture handshake")
            self.handshake[role] = report

    def _physical_resources_closed(self, *, allow_empty=False):
        import fcntl
        import socket
        processes = list(self.owned.values()) + ([self.independent] if self.independent is not None else [])
        if (not processes and not allow_empty) or any(self.child_status(p) is None for p in processes):
            return False
        if self.listener is not None:
            self.listener.close()
        if "fixture.lock" in self.allocated_files:
            lock = os.open(self.root / "fixture.lock", os.O_RDONLY | os.O_NOFOLLOW)
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                fcntl.flock(lock, fcntl.LOCK_UN)
            finally:
                os.close(lock)
        # An exact owned listener, not a connection to an arbitrary service.
        if self.port is not None:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
                probe.bind(("127.0.0.1", self.port))
        return True

    def targets(self, handle, ctx):
        targets = super().targets(handle, ctx)
        return targets + (["work"] if self.independent is not None else [])

    def resource_state(self, handle, ctx, output):
        self._ready(output["stdout"])
        self.partial_stderr = "fixture partial stderr command" in output["stderr"]
        command = self.owned["command"]
        work = self.independent or self.owned.get("work")
        if self.child_status(command) is not None and work is not None and self.child_status(work) is None:
            self.outlived_command = True
            self.held_stream = self.held_stream or not handle["eof"]
        resources = []
        for name in ctx["requiredResources"]:
            process = self.owned.get(name)
            resources.append({"id": name, "ownership": "owned" if process is not None else "unbound",
                              "state": "closed" if process is not None and self.child_status(process) is not None else "unknown"})
        ready_roles = {"command", "work"} if work is not None else {"command"}
        closed = (all(r["state"] == "closed" for r in resources)
                  and set(self.handshake) == ready_roles and self._physical_resources_closed())
        return {"nonce": ctx["nonce"], "assignmentHash": ctx["assignmentHash"],
                "sourceCommit": ctx["sourceCommit"], "sourceTree": ctx["sourceTree"], "job": ctx["job"],
                "invocation": ctx["invocation"], "complete": closed,
                "resources": resources, "errors": []}

    def cleanup_root(self, registration, ctx, remaining):
        partial = not self.owned and self.independent is None
        if (remaining <= 0 or not offline._root_is_bound(registration, ctx)
                or registration != ctx["roots"][0] or Path(registration["path"]) != self.root
                or not self.root_created
                or self.root.is_symlink() or self.root.resolve().parent != Path(ctx["commandRoot"]).resolve()
                or (not partial and json.loads((self.root / "owner.json").read_text()) != registration)
                or not self._physical_resources_closed(allow_empty=partial)):
            raise ValueError("root cleanup lacks exact custody or positive process/lock/port settlement")
        if {p.name for p in self.root.iterdir()} != self.allocated_files:
            raise ValueError("unexpected root content; retain for diagnosis")
        for name in self.allocated_files:
            path = self.root / name
            if path.is_symlink():
                raise ValueError("foreign symlink in owned root")
        for name in tuple(self.allocated_files):
            (self.root / name).unlink()
            self.allocated_files.remove(name)
        self.root.rmdir()
        return {"path": str(self.root), "absent": not os.path.lexists(self.root)}

    def finish(self, receipt, end):
        """Independent owner cleanup; never alters the supervisor's original receipt."""
        import select
        self.denied_targets.update(r.get("target") for r in receipt.get("refusals", []))
        self.denied_operations.update(r.get("operation") for r in receipt.get("refusals", []))
        forbidden = self.denied_targets
        owned = dict(self.owned)
        if self.independent is not None:
            owned["independent-work"] = self.independent
        for fd in self.spare_fds:
            os.close(fd)
        self.spare_fds.clear()
        if "close-output" in self.denied_operations:
            self.cleanup_errors.append("output close refusal retained")
        else:
            for handle in self.handles:
                self.close_output(handle, max(0, end - self.monotonic()))
        for name, process in owned.items():
            if self.child_status(process) is not None:
                continue
            if process in self.unknown_status:
                self.cleanup_errors.append("unknown wait custody retained: " + name)
                continue
            if name in forbidden or (name == "independent-work" and "work" in forbidden):
                self.cleanup_errors.append("refused target retained: " + name)
                continue
            try:
                # Every identity is a retained, unreaped child Popen owned here.
                for signum, allowance in ((signal.SIGTERM, 0.2), (signal.SIGKILL, 0.5)):
                    if self.child_status(process) is not None or self.monotonic() >= end:
                        break
                    if process in self.unknown_status:
                        self.cleanup_errors.append("unknown identity retained: " + name)
                        break
                    os.kill(process.pid, signum)
                    self.finish_actions.append({"target": name, "signal": int(signum)})
                    wait_end = min(end, self.monotonic() + allowance)
                    while self.child_status(process) is None and self.monotonic() < wait_end:
                        select.select([], [], [], min(0.01, max(0, wait_end - self.monotonic())))
                if self.child_status(process) is None:
                    self.cleanup_errors.append("unknown child settlement: " + name)
            except PermissionError as exc:
                self.denied_targets.add(name)
                self.cleanup_errors.append("signal refusal " + name + ": " + str(exc))
            except OSError as exc:
                self.cleanup_errors.append("cleanup error " + name + ": " + str(exc))
        if self.listener is not None:
            self.listener.close()
        if str(self.root) in forbidden:
            self.cleanup_errors.append("root cleanup refusal retained: " + str(self.root))
        if self.root.exists() and not self.cleanup_errors and self.monotonic() < end:
            try:
                self.cleanup_root(self.ctx["roots"][0], self.ctx, end - self.monotonic())
            except PermissionError as exc:
                self.denied_targets.add(str(self.root))
                self.cleanup_errors.append(str(exc))
            except (OSError, ValueError) as exc:
                self.cleanup_errors.append(str(exc))
        return (not self.cleanup_errors and not os.path.lexists(self.root)
                and all(self.child_status(p) is not None for p in owned.values()) and self.monotonic() < end)


GROUP_PREFIX = "FIXTURE_GROUP "
GROUP_BINDING = ("nonce", "assignmentHash", "invocation", "sourceBundleHash", "sourceCommit", "sourceTree", "job")


def group_message(binding, event, **fields):
    return dict({k: binding.get(k) for k in GROUP_BINDING}, event=event, **fields)


class _NativeTimingWitness:
    """Bounded parent observations, independent of control and receipt decisions."""
    _COUNT_MAX = 2_147_483_647
    _TIME_MAX = 60_000_000
    _KINDS = {"send", "select", "write", "read", "frame", "wait", "startup"}
    _ROLES = {"command", "anchor", "work", "unknown"}
    _EVENTS = {"ARM", "GO", "RELEASE", "STOP", "command-ready", "anchor-ready", "armed",
               "work-ready", "release-armed", "parent-exiting", "refused", "protocol-error",
               "term", "kill", "unknown"}
    _EXCEPTIONS = {"deadline", "permission", "would-block", "broken-pipe", "os-error", "value", "type", "other"}

    @staticmethod
    def _empty(execution=False):
        block = {"events": [], "lastFailure": None, "seenEvents": 0, "droppedEvents": 0,
                 "unknownObservations": 0, "countsSaturated": False, "collectorFailed": False,
                 "waitCount": 0, "requestedWaitUs": 0, "observedWaitUs": 0}
        if execution:
            block.update(fixtureExecutionUs=1000000, fixtureSettlementUs=1000000,
                         preSuperviseRemainingUs=None)
        return block

    def __init__(self, execution_end):
        self.execution_end = execution_end
        self.execution, self.owner_cleanup = self._empty(True), self._empty()
        self._result = {"schemaVersion": 1, "available": True, "unavailableReason": None,
                        "executionFrozen": False, "childEmissionTime": None,
                        "execution": self.execution, "ownerCleanup": self.owner_cleanup}

    @staticmethod
    def unavailable(reason):
        reason = reason if reason in ("partial-startup", "unsupported-transport", "collector-error") else "collector-error"
        return {"schemaVersion": 1, "available": False, "unavailableReason": reason,
                "executionFrozen": True, "childEmissionTime": None,
                "execution": _NativeTimingWitness._empty(True), "ownerCleanup": _NativeTimingWitness._empty()}

    @staticmethod
    def _size(value):
        return len(json.dumps(value, separators=(",", ":"), allow_nan=False).encode("utf-8"))

    def _block(self, phase):
        if phase == "execution":
            return None if self._result["executionFrozen"] else self.execution
        return self.owner_cleanup if phase == "owner-cleanup" else None

    def _increment(self, block, key, amount=1):
        value = block[key] + amount
        if value > self._COUNT_MAX:
            block["countsSaturated"] = True
        block[key] = min(self._COUNT_MAX, value)

    def _unknown(self, block):
        self._increment(block, "unknownObservations")
        return None

    def _number(self, block, value, *, time_value=False, duration=False, maximum=None, optional=False):
        if value is None and optional:
            return None
        try:
            if type(value) not in (int, float) or not math.isfinite(value):
                return self._unknown(block)
            if time_value:
                value = (value - self.execution_end) * 1_000_000
                low, high = -self._TIME_MAX, self._TIME_MAX
            elif duration:
                value = value * 1_000_000
                low, high = 0, self._TIME_MAX
            else:
                low, high = 0, maximum
                if type(value) is not int:
                    return self._unknown(block)
            if low <= value <= high:
                return round(value) if time_value or duration else value
        except (ValueError, TypeError, OverflowError):
            pass
        return self._unknown(block)

    @staticmethod
    def _enum(value, allowed):
        return value if value is None or (isinstance(value, str) and value in allowed) else "unknown"

    def _boolean(self, block, value, *, optional=False):
        if type(value) is bool or (optional and value is None):
            return value
        return self._unknown(block)

    def _trim(self, phase, block):
        limit, count = (2816, 23) if phase == "execution" else (1024, 7)
        # Reserve the whole failure allocation even before its first use.
        while True:
            projection = dict(block, lastFailure=None)
            if len(block["events"]) <= count and self._size(projection) + 512 <= limit:
                break
            if not block["events"]:
                raise ValueError("timing metadata exceeded its fixed allocation")
            block["events"].pop(0)
            self._increment(block, "droppedEvents")

    def _fail(self, phase):
        self._result["available"], self._result["unavailableReason"] = False, "collector-error"
        block = self._block(phase)
        if block is not None:
            block["collectorFailed"] = True
            self._unknown(block)
            self._trim(phase, block)

    def partial_startup(self):
        self._result["available"] = False
        if self._result["unavailableReason"] != "collector-error":
            self._result["unavailableReason"] = "partial-startup"

    def pre_supervise(self, observed):
        block = self._block("execution")
        if block is not None:
            remaining = None if observed is None else self.execution_end - observed
            block["preSuperviseRemainingUs"] = self._number(block, remaining, duration=True)
            self._trim("execution", block)

    def record(self, phase, observation):
        block = self._block(phase)
        if block is None:
            return
        try:
            self._increment(block, "seenEvents")
            kind = observation.get("kind")
            if kind not in self._KINDS:
                self._increment(block, "droppedEvents")
                self._unknown(block)
                self._trim(phase, block)
                return
            record = {"kind": kind}
            if kind in ("send", "select", "write"):
                record.update(role=self._enum(observation.get("role"), self._ROLES),
                              event=self._enum(observation.get("event"), self._EVENTS))
            time_fields = {"send": ("entry", "deadline"), "select": ("entry", "return", "deadline"),
                           "write": ("attempt",), "read": ("observed",), "frame": ("observed",),
                           "wait": ("entry", "return"), "startup": ("observed",)}[kind]
            for key in time_fields:
                record[key + "Us"] = self._number(block, observation.get(key), time_value=True)
            if kind == "send":
                record["entryExpired"] = self._boolean(block, observation.get("entryExpired"))
                record["frameBytes"] = self._number(block, observation.get("frameBytes"), maximum=4096)
            elif kind == "select":
                record["writable"] = self._boolean(block, observation.get("writable"))
            elif kind == "write":
                for key in ("attemptedBytes", "writtenBytes"):
                    record[key] = self._number(block, observation.get(key), maximum=4096)
            elif kind in ("read", "frame"):
                record["readId"] = self._number(block, observation.get("readId"), maximum=self._COUNT_MAX)
                if kind == "read":
                    for key in ("stdoutBytes", "stderrBytes"):
                        record[key] = self._number(block, observation.get(key), maximum=offline.OUTPUT_LIMIT)
                else:
                    record["event"] = self._enum(observation.get("event"), self._EVENTS)
                    for key in ("armed", "released", "stopSent"):
                        record[key] = self._boolean(block, observation.get(key))
            elif kind == "wait":
                self._increment(block, "waitCount")
                for source, target in (("requested", "requestedWaitUs"), ("observedDuration", "observedWaitUs")):
                    value = self._number(block, observation.get(source), duration=True)
                    record["requestedUs" if source == "requested" else "observedUs"] = value
                    previous = block[target]
                    if previous is None or value is None:
                        block[target] = None
                    elif previous + value > self._TIME_MAX:
                        block[target] = self._unknown(block)
                    else:
                        block[target] = previous + value
            if kind in ("write", "startup"):
                value = observation.get("exception")
                record["exception"] = value if value is None or value in self._EXCEPTIONS else "other"
            block["events"].append(record)
            self._trim(phase, block)
        except Exception:
            self._fail(phase)

    def record_failure(self, phase, summary):
        block = self._block(phase)
        if block is None:
            return
        try:
            self._increment(block, "seenEvents")
            if block["lastFailure"] is not None:
                self._increment(block, "droppedEvents")
            kind = summary.get("kind")
            record = {"phase": phase, "kind": kind if kind in self._KINDS else "startup",
                      "role": self._enum(summary.get("role"), self._ROLES),
                      "event": self._enum(summary.get("event"), self._EVENTS)}
            for source in ("entry", "deadline", "selectEntry", "selectReturn"):
                record[source + "Us"] = self._number(block, summary.get(source), time_value=True, optional=True)
            for key in ("entryExpired", "writable"):
                record[key] = self._boolean(block, summary.get(key), optional=True)
            for key in ("selectCount", "writeAttempts", "frameBytes", "attemptedBytes", "writtenBytes"):
                value = summary.get(key)
                if key in ("selectCount", "writeAttempts") and type(value) is int and value > self._COUNT_MAX:
                    value = self._COUNT_MAX
                    block["countsSaturated"] = True
                # Count applicable encoded unknowns, including this summary's copy.
                missing_write_count = (key == "writtenBytes"
                    and type(summary.get("writeAttempts")) is int and summary["writeAttempts"] > 0)
                record[key] = self._number(block, value, maximum=self._COUNT_MAX if key in ("selectCount", "writeAttempts") else 4096, optional=not missing_write_count)
            value = summary.get("exception")
            record["exception"] = value if value is None or value in self._EXCEPTIONS else "other"
            if self._size(record) > 512:
                raise ValueError("timing failure exceeded its fixed allocation")
            block["lastFailure"] = record
            self._trim(phase, block)
        except Exception:
            self._fail(phase)

    def freeze_execution(self):
        self._result["executionFrozen"] = True

    def result(self):
        return self._result


def _timing_call(witness, method, *args):
    if witness is None:
        return None
    try:
        return getattr(witness, method)(*args)
    except Exception:
        # Diagnostic failures never replace an operation's result or exception.
        try:
            witness._fail(args[0] if args and args[0] in ("execution", "owner-cleanup") else "execution")
        except Exception:
            pass
        return None


def _timing_now(witness):
    if witness is not None:
        try:
            observed = time.monotonic()
            if type(observed) in (int, float) and math.isfinite(observed):
                return observed
        except Exception:
            pass
    return None


def _timing_exception(exc):
    for exception, name in ((PermissionError, "permission"), (BlockingIOError, "would-block"),
                            (BrokenPipeError, "broken-pipe"), (TimeoutError, "deadline"),
                            (OSError, "os-error"), (ValueError, "value"), (TypeError, "type")):
        if isinstance(exc, exception):
            return name
    return "other"


def group_frame_write(fd, message, end, *, witness=None, phase="execution", role=None, event=None):
    entry = _timing_now(witness)
    summary = {"kind": "send", "role": role, "event": event, "entry": entry, "deadline": end,
               "entryExpired": None if entry is None else entry >= end,
               "selectCount": 0, "writeAttempts": 0, "frameBytes": None,
               "attemptedBytes": 0, "writtenBytes": 0}
    try:
        data = (json.dumps(message, sort_keys=True) + "\n").encode()
        summary["frameBytes"] = len(data)
        _timing_call(witness, "record", phase, dict(summary))
        if len(data) > 4096:
            raise ValueError("oversized private group control frame")
        os.set_blocking(fd, False)
        while time.monotonic() < end:
            summary["selectCount"] += 1
            summary["selectEntry"] = _timing_now(witness)
            summary["selectReturn"], summary["writable"] = None, None
            writable = select.select([], [fd], [], max(0, end - time.monotonic()))[1]
            summary["selectReturn"], summary["writable"] = _timing_now(witness), bool(writable)
            _timing_call(witness, "record", phase, {"kind": "select", "role": role, "event": event,
                "entry": summary["selectEntry"], "return": summary["selectReturn"], "deadline": end,
                "writable": bool(writable)})
            if writable:
                attempt = _timing_now(witness)
                summary["writeAttempts"] += 1
                summary["attemptedBytes"], summary["writtenBytes"] = len(data), None
                try:
                    count = os.write(fd, data)
                except Exception as exc:
                    _timing_call(witness, "record", phase, {"kind": "write", "role": role, "event": event,
                        "attempt": attempt, "attemptedBytes": len(data), "writtenBytes": None,
                        "exception": _timing_exception(exc)})
                    raise
                summary["writtenBytes"] = count
                _timing_call(witness, "record", phase, {"kind": "write", "role": role, "event": event,
                    "attempt": attempt, "attemptedBytes": len(data), "writtenBytes": count, "exception": None})
                if count != len(data):
                    raise OSError("partial group control frame; no alternate write")
                return
        raise TimeoutError("private group control write deadline")
    except Exception as exc:
        summary["exception"] = _timing_exception(exc)
        _timing_call(witness, "record_failure", phase, summary)
        raise


def group_frame_read(fd, binding, end):
    data = bytearray()
    os.set_blocking(fd, False)
    while time.monotonic() < end:
        if not select.select([fd], [], [], max(0, end - time.monotonic()))[0]:
            continue
        chunk = os.read(fd, 1)  # Do not consume a later frame owned by the next phase.
        if not chunk:
            return None
        data.extend(chunk)
        if len(data) > 4096:
            raise ValueError("oversized group control frame")
        if chunk == b"\n":
            result = json.loads(data)
            if any(result.get(k) != binding.get(k) for k in GROUP_BINDING):
                raise ValueError("foreign group control binding")
            return result
    return None


def group_fixture_main(role, *, emit=None):
    """Private same-session fixture only; never used for a real command launch."""
    import fcntl
    import socket
    offline.require_hosted()
    binding = protocol_binding()
    read_fd = int(os.environ["COUNCIL_GROUP_CONTROL_FD"])
    execution_end = float(os.environ["COUNCIL_GROUP_EXECUTION_END"])
    hard_end = float(os.environ["COUNCIL_GROUP_SETTLEMENT_END"])
    group = os.getpgrp()
    output_available = [True]
    def frame(event, **extra):
        if not output_available[0]:
            return False
        message = group_message(binding, event, pid=os.getpid(), parentPid=os.getppid(),
                                group=os.getpgrp(), session=os.getsid(0), **extra)
        try:
            if emit is not None:
                written = emit(message, hard_end)
            else:
                written = offline.write_json(message, max(0, min(0.05, hard_end - time.monotonic())), prefix=GROUP_PREFIX)
            output_available[0] = written is True
        except OSError:
            output_available[0] = False
        # Lost/refused output fails the evidence gate, but does not erase live
        # anchor custody. Never retry that writer or choose another log route.
        return output_available[0]
    if role == "group-anchor":
        expected_group = int(os.environ["COUNCIL_GROUP_ID"])
        if group != expected_group or group == os.getpid():
            raise ValueError("anchor was not placed in its bound command group")
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        frame("anchor-ready")
        first = group_frame_read(read_fd, binding, execution_end)
        # Before ARM, owner loss may exit only this anchor. No group signal.
        if first is None or first.get("event") != "ARM" or first.get("group") != group:
            return 1
        frame("armed")
        try:
            while time.monotonic() < hard_end - 0.15:
                message = group_frame_read(read_fd, binding, hard_end - 0.15)
                if message is None or message.get("event") == "STOP":
                    break
                if message.get("event") == "RELEASE":
                    hard_end = min(hard_end, float(message["settlementEnd"]))
                    frame("release-armed")
                else:
                    raise ValueError("unexpected armed anchor frame")
        except (OSError, ValueError, KeyError, TypeError) as exc:
            # The failed control observation is not retried. The already armed,
            # source-bound anchor still owns its own group's physical teardown.
            frame("protocol-error", diagnostic=str(exc))
        # The sole group-signal sender is itself still a live member. Never
        # hand a numeric group to the controller as a fallback signal route.
        try:
            if os.getpgrp() != expected_group:
                raise ValueError("anchor group identity changed")
            frame("term")
            os.killpg(os.getpgrp(), signal.SIGTERM)
            stop = min(hard_end - 0.02, time.monotonic() + 0.1)
            while time.monotonic() < stop:
                select.select([], [], [], max(0, stop - time.monotonic()))
            if time.monotonic() >= hard_end:
                return 1
            frame("kill")
            os.killpg(os.getpgrp(), signal.SIGKILL)
        except PermissionError as exc:
            frame("refused", diagnostic=str(exc), errno=exc.errno)
            return 1  # No alternate signal, even after owner loss.
        return 1
    if role != "group-command" or group != os.getpid():
        raise ValueError("private command is not its new group leader")
    frame("command-ready")
    go = group_frame_read(read_fd, binding, execution_end)
    if go is None or go.get("event") != "GO":
        return 1
    # Only this actual command parent creates work. An armed independent anchor
    # already retains the group. Work cannot retain the owner's control writers.
    pid = os.fork()
    if pid == 0:
        os.close(read_fd)
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        listener = socket.socket(fileno=int(os.environ["COUNCIL_BOOTSTRAP_PORT_FD"]))
        lock = None
        try:
            root = Path(os.environ["COUNCIL_BOOTSTRAP_FIXTURE_ROOT"])
            owner = json.loads((root / "owner.json").read_text())
            if any(owner.get(k) != binding[k] for k in ("nonce", "assignmentHash", "invocation")):
                raise ValueError("unbound group work root")
            lock = os.open(root / "fixture.lock", os.O_RDONLY | os.O_NOFOLLOW)
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            print("fixture partial stderr work", file=sys.stderr, flush=True)
            frame("work-ready")
            while time.monotonic() < hard_end:
                select.select([], [], [], min(0.02, max(0, hard_end - time.monotonic())))
        finally:
            if lock is not None:
                os.close(lock)
            listener.close()
        os._exit(1)  # Finite failure fallback, never a passing orphan wait result.
    os.close(int(os.environ["COUNCIL_BOOTSTRAP_PORT_FD"]))
    release = group_frame_read(read_fd, binding, execution_end)
    if release is None or release.get("event") != "RELEASE":
        return 1
    frame("parent-exiting", workPid=pid)
    return 0


class NativeGroupIO:
    """Only OS effects for this fixed inert fixture; never accepts product argv."""
    _timing_supported = True

    def __init__(self):
        self.base = None
        self.controls, self.handles, self.fds = {}, [], set()
        self.refused = set()
        self.finalization_refusals, self.blocked_finalization = [], {}

    def _finalization_action(self, operation, target, action):
        key = (operation, target)
        if key in self.blocked_finalization:
            raise self.blocked_finalization[key]  # Retained refusal, no repeated OS action.
        try:
            return action()
        except PermissionError as exc:
            self.blocked_finalization[key] = exc
            self.finalization_refusals.append({"operation": operation, "target": target,
                "diagnostic": str(exc), "errno": exc.errno, "filename": exc.filename,
                "refusingLayer": "NativeGroupIO." + operation})
            raise

    def setup(self, mode, ctx, end):
        self.ctx, self.mode = ctx, mode
        self.base = FixtureController.__new__(FixtureController)
        FixtureController.__init__(self.base, mode, ctx, end)
        self.owner_pid, self.session = os.getpid(), os.getsid(0)

    def clock(self):
        return time.monotonic()

    def wait(self, seconds):
        witness = getattr(self, "timing_witness", None)
        phase = getattr(self, "timing_phase", "execution")
        entry = _timing_now(witness)
        try:
            select.select([], [], [], seconds)
        except Exception as exc:
            _timing_call(witness, "record_failure", phase,
                         {"kind": "wait", "exception": _timing_exception(exc)})
            raise
        finally:
            returned = _timing_now(witness)
            _timing_call(witness, "record", phase, {"kind": "wait", "entry": entry, "return": returned,
                         "requested": seconds, "observedDuration": None if entry is None or returned is None else returned - entry})

    def _pipe(self):
        read, write = os.pipe()
        self.fds.update((read, write))
        return read, write

    def _close_fd(self, fd):
        self._finalization_action("fd-close", str(fd), lambda: os.close(fd))
        self.fds.discard(fd)

    def _start(self, role, ctx, execution_end, settlement_end, group=0):
        import subprocess
        read, write = self._pipe()
        env = dict(ctx["environment"])
        env.update({"COUNCIL_GROUP_CONTROL_FD": str(read), "COUNCIL_GROUP_EXECUTION_END": str(execution_end),
                    "COUNCIL_GROUP_SETTLEMENT_END": str(settlement_end), "COUNCIL_GROUP_ID": str(group),
                    "COUNCIL_BOOTSTRAP_FIXTURE_ROOT": str(self.base.root)})
        pass_fds = (read,)
        if role == "command":
            port_fd = self.base.listener.fileno()
            env["COUNCIL_BOOTSTRAP_PORT_FD"] = str(port_fd)
            pass_fds += (port_fd,)
        # These private group fixtures deliberately share the controller session.
        # RealOps.spawn continues to use start_new_session=True for real commands.
        process = subprocess.Popen([ctx["python"], "-I", "-S", "-B", ctx["testFile"],
                                    "--fixture", "group-" + role], cwd=ctx["cwd"], env=env,
                                   stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   close_fds=True, pass_fds=pass_fds, process_group=group)
        self.base.register(role, process, ctx)  # Before any subsequent fallible allocation.
        self.controls[role] = write
        handle = {"process": process, "selector": None,
                  "streams": {"stdout": process.stdout, "stderr": process.stderr}, "eof": False}
        self.handles.append(handle)
        self._close_fd(read)
        try:
            handle["selector"] = selectors.DefaultSelector()
            for name, stream in handle["streams"].items():
                os.set_blocking(stream.fileno(), False)
                handle["selector"].register(stream, selectors.EVENT_READ, name)
            if role == "command":
                self.base.listener.close()
            return process.pid
        except Exception as exc:
            raise offline.PartialSpawnError(exc, handle) from exc

    def command(self, ctx, execution_end, settlement_end):
        try:
            return self._start("command", ctx, execution_end, settlement_end)
        except Exception as exc:
            self._startup_observation(exc)
            raise

    def anchor(self, ctx, execution_end, settlement_end, group):
        try:
            return self._start("anchor", ctx, execution_end, settlement_end, group)
        except Exception as exc:
            self._startup_observation(exc)
            raise

    def _startup_observation(self, exc):
        witness = getattr(self, "timing_witness", None)
        _timing_call(witness, "partial_startup")
        _timing_call(witness, "record", getattr(self, "timing_phase", "execution"),
                     {"kind": "startup", "observed": _timing_now(witness),
                      "exception": _timing_exception(getattr(exc, "cause", exc))})
        _timing_call(witness, "record_failure", getattr(self, "timing_phase", "execution"),
                     {"kind": "startup", "exception": _timing_exception(getattr(exc, "cause", exc))})

    def send(self, role, event, end, **fields):
        if role in self.refused:
            raise ValueError("refused control route remains closed")
        try:
            group_frame_write(self.controls[role], group_message(self.ctx, event, **fields), end,
                              witness=getattr(self, "timing_witness", None),
                              phase=getattr(self, "timing_phase", "execution"), role=role, event=event)
        except PermissionError:
            self.refused.add(role)
            raise

    def read(self, limit):
        out, err = bytearray(), bytearray()
        self.channels = []
        for index, handle in enumerate(self.handles):
            if handle["selector"] is None:
                # Attachment never established an observation route. Retain
                # unknown output/EOF and the original setup error; do not retry it.
                continue
            try:
                stdout, stderr, _ = self.base.read_output(handle, limit)
            except Exception as exc:
                _timing_call(getattr(self, "timing_witness", None), "record_failure",
                             getattr(self, "timing_phase", "execution"),
                             {"kind": "read", "exception": _timing_exception(exc)})
                raise
            self.channels.append((index, stdout))
            out.extend(stdout)
            err.extend(stderr)
        witness = getattr(self, "timing_witness", None)
        self.timing_read_id = min(2_147_483_647, getattr(self, "timing_read_id", 0) + 1)
        _timing_call(witness, "record", getattr(self, "timing_phase", "execution"),
                     {"kind": "read", "observed": _timing_now(witness), "readId": self.timing_read_id,
                      "stdoutBytes": len(out), "stderrBytes": len(err)})
        return bytes(out), bytes(err), bool(self.handles) and all(h["eof"] for h in self.handles)

    def status(self, role):
        process = self.base.owned.get(role)
        if process is None:
            return None
        code = self.base.child_status(process)
        if process in self.base.unknown_status:
            return {"state": "lost", "diagnostic": self.base.unknown_status[process]}
        return code

    def direct(self, role, signum, remaining):
        if role in self.refused:
            raise ValueError("refused direct target remains closed")
        try:
            self.base.signal(role, signum, remaining)
        except PermissionError:
            self.refused.add(role)
            raise

    def command_stream_open(self):
        return bool(self.handles) and not self.handles[0]["eof"]

    def physical_closed(self, eof):
        if not eof or getattr(self, "work_pid", None) is None:
            return False
        try:
            os.getpgid(self.work_pid)  # Observation only; never signal a numeric orphan/group.
        except ProcessLookupError:
            return self.base._physical_resources_closed(allow_empty=False)
        return False  # Still present, zombie or reused: unknown physical settlement.

    def cleanup(self, registration, ctx, remaining):
        if getattr(self, "root_removed", False):
            if os.path.lexists(registration["path"]):
                raise ValueError("removed exact root reappeared")
            return {"path": registration["path"], "absent": True}
        result = self._finalization_action("root-cleanup", registration["path"],
                    lambda: self.base.cleanup_root(registration, ctx, remaining))
        self.root_removed = result.get("absent") is True
        return result

    def abort_unarmed(self, remaining):
        for fd in tuple(self.controls.values()):
            if fd in self.fds:
                self._close_fd(fd)  # Before ARM, EOF asks only the anchor to exit.
        if self.status("command") is None and "command" in self.base.owned:
            self.direct("command", signal.SIGTERM, remaining)

    def partial_cleanup(self, ctx, remaining):
        if self.base is None or not getattr(self.base, "root_created", False):
            return True
        return self.cleanup(ctx["roots"][0], ctx, remaining).get("absent") is True

    def unarmed_children_closed(self):
        return all(type(self.status(role)) is int for role in self.base.owned)

    def close(self, remaining):
        refusal = None
        complete = True
        for handle in self.handles:
            try:
                complete = self._finalization_action("output-close", "output:" + str(handle["process"].pid),
                                lambda: self.base.close_output(handle, remaining)) is True and complete
            except PermissionError as exc:
                refusal = refusal or exc
        for fd in tuple(self.fds):
            try:
                self._close_fd(fd)
            except PermissionError as exc:
                refusal = refusal or exc
        if refusal is not None:
            raise refusal
        return complete

    def emit(self, receipt, remaining):
        return self.base.emit_receipt(receipt, remaining)


class ParentExitController:
    """One source-bound group with an independently retained signal-sending anchor."""
    def __init__(self, mode, ctx, execution_end, settlement_end, io):
        self.mode, self.ctx, self.io = mode, ctx, io
        self.execution_end, self.settlement_end = execution_end, settlement_end
        self.command_pid = self.anchor_pid = None
        self.frames, self.pending, self.errors = {}, b"", []
        self.pending_by_channel = {}
        self.armed = self.released = self.stop_sent = self.refused = False
        self.eof = self.outlived_command = self.held_stream = False
        self.cancel_requested = False
        self.denied_operations = set()
        self.finalization_refusals = []
        self.receipts, self.finish_actions = [], []
        self.io.setup(mode, ctx, settlement_end)

    def monotonic(self):
        return self.io.clock()

    def timestamp(self):
        return "monotonic:" + str(self.monotonic())

    def cancelled(self):
        return self.cancel_requested

    def spawn(self, spec, ctx):
        if not offline._admitted(spec, ctx):
            raise ValueError("unadmitted parent-exit fixture")
        self.command_pid = self.io.command(ctx, self.execution_end, self.settlement_end)
        return self

    def poll(self, handle):
        return self.io.status("command")

    def _frame_failure(self, event, exc):
        _timing_call(getattr(self.io, "timing_witness", None), "record_failure",
                     getattr(self.io, "timing_phase", "execution"),
                     {"kind": "frame", "event": event, "exception": _timing_exception(exc)})
        return exc

    def _accept(self, frame):
        event = frame.get("event")
        witness = getattr(self.io, "timing_witness", None)
        _timing_call(witness, "record", getattr(self.io, "timing_phase", "execution"),
                     {"kind": "frame", "event": event, "observed": _timing_now(witness),
                      "readId": getattr(self.io, "timing_read_id", None), "armed": self.armed,
                      "released": self.released, "stopSent": self.stop_sent})
        if any(frame.get(k) != self.ctx.get(k) for k in GROUP_BINDING):
            raise self._frame_failure(event, ValueError("foreign native group binding"))
        if frame.get("session") != self.io.session or frame.get("group") != self.command_pid:
            raise self._frame_failure(event, ValueError("native group/session conflict"))
        role = "work" if event == "work-ready" else "command" if event in ("command-ready", "parent-exiting") else "anchor"
        expected = self.command_pid if role == "command" else self.anchor_pid
        if role != "work" and (expected is None or frame.get("pid") != expected or frame.get("parentPid") != self.io.owner_pid):
            raise self._frame_failure(event, ValueError("retained native child identity mismatch"))
        if event in self.frames:
            if self.frames[event] != frame:
                raise self._frame_failure(event, ValueError("conflicting native group frame"))
            return
        if event == "command-ready":
            self.frames[event] = frame
            self.anchor_pid = self.io.anchor(self.ctx, self.execution_end, self.settlement_end, self.command_pid)
        elif event == "anchor-ready":
            self.io.send("anchor", "ARM", self.execution_end, group=self.command_pid)
        elif event == "armed":
            if "anchor-ready" not in self.frames:
                raise self._frame_failure(event, ValueError("unregistered anchor ARM"))
            self.armed = True
            self.io.send("command", "GO", self.execution_end)
        elif event == "work-ready":
            if (not self.armed or frame.get("parentPid") != self.command_pid
                    or type(frame.get("pid")) is not int or frame["pid"] in (self.command_pid, self.anchor_pid)):
                raise self._frame_failure(event, ValueError("work not created by the registered command parent"))
            self.frames[event] = frame  # Custody binding before permitting actual parent exit.
            self.io.work_pid = frame["pid"]
            self.io.send("anchor", "RELEASE", self.execution_end,
                         settlementEnd=min(self.settlement_end, self.monotonic() + 1))
        elif event == "release-armed":
            if "work-ready" not in self.frames:
                raise self._frame_failure(event, ValueError("release before work custody"))
            self.io.send("command", "RELEASE", self.execution_end)
            self.released = True
        elif event == "parent-exiting":
            if not self.released or frame.get("workPid") != self.frames["work-ready"]["pid"]:
                raise self._frame_failure(event, ValueError("parent-exit/work identity mismatch"))
        elif event == "refused":
            self.refused = True
            diagnostic = "anchor signal refused: " + frame.get("diagnostic", "unknown")
            self.errors.append(diagnostic)
            raise self._frame_failure(event, PermissionError(frame.get("errno", 1), diagnostic))
        elif event == "protocol-error":
            self.errors.append("anchor control observation failed: " + frame.get("diagnostic", "unknown"))
        elif event not in ("term", "kill"):
            raise self._frame_failure(event, ValueError("unexpected native group event"))
        self.frames[event] = frame

    def read_output(self, handle, limit):
        out, err, self.eof = self.io.read(limit)
        for channel, chunk in getattr(self.io, "channels", [("shared", out)]):
            pending = self.pending_by_channel.get(channel, b"") + chunk
            while b"\n" in pending:
                line, pending = pending.split(b"\n", 1)
                if len(line) > 8192:
                    raise ValueError("oversized native group output frame")
                if line.startswith(GROUP_PREFIX.encode()):
                    self._accept(json.loads(line[len(GROUP_PREFIX):]))
            if len(pending) > 8192:
                raise ValueError("unterminated native group frame")
            self.pending_by_channel[channel] = pending
        self.pending = b"".join(self.pending_by_channel.values())
        return out, err, self.eof

    def wait(self, handle, seconds, phase):
        self.io.wait(seconds)

    def targets(self, handle, ctx):
        if getattr(self, "hold_for_cancel", False) and not self.cancel_requested:
            return []
        return ["fixture-group"] if self.armed else [role for role, pid in (("command", self.command_pid), ("anchor", self.anchor_pid)) if pid is not None]

    def identity(self, target, ctx):
        if target != "fixture-group":
            status = self.io.status(target)
            return {"ownership": "owned", "state": "closed" if type(status) is int else "unknown" if isinstance(status, dict) else "live"}
        if self.mode == "missing-custody":
            return {"ownership": "unbound", "state": "unknown"}
        status = self.io.status("anchor")
        # This is signal custody only. A reaped anchor needs no further signal;
        # resource_state still independently waits for EOF and physical closure.
        return {"ownership": "owned", "state": "closed" if type(status) is int else "unknown" if status is not None else "live"}

    def signal(self, target, signum, remaining):
        if self.refused:
            raise ValueError("native refusal retained; no alternate route")
        try:
            if target == "fixture-group":
                if not self.armed or self.io.status("anchor") is not None:
                    raise ValueError("anchor no longer has live signal custody")
                if not self.stop_sent:
                    self.io.send("anchor", "STOP", min(self.settlement_end, self.monotonic() + remaining))
                    self.stop_sent = True
                    self.finish_actions.append({"operation": "anchor-stop-request"})
            elif not self.armed:
                self.io.direct(target, signum, remaining)
            else:
                raise ValueError("no external group signal route")
        except PermissionError:
            self.refused = True
            raise

    def _closed(self):
        return (self.command_pid is not None and type(self.io.status("command")) is int
                and self.anchor_pid is not None and self.io.status("anchor") == -signal.SIGKILL
                and "kill" in self.frames and self.io.physical_closed(self.eof))

    def resource_state(self, handle, ctx, output):
        if (self.released and self.io.status("command") == 0 and self.io.command_stream_open()):
            self.outlived_command = self.held_stream = True
        if (self.mode == "missing-custody" and self.io.status("command") == 0
                and "work-ready" in self.frames
                and (not getattr(self, "hold_for_cancel", False) or self.cancel_requested)):
            raise ValueError("intentional missing work custody; independent anchor remains its owner")
        closed = self._closed()
        required_frames = {"command-ready", "anchor-ready", "armed", "work-ready", "release-armed", "parent-exiting", "term", "kill"}
        complete = closed and required_frames.issubset(self.frames) and not self.errors and not self.pending
        resources = [{"id": name, "ownership": "unbound" if self.mode == "missing-custody" and name == "work" else "owned",
                      "state": "closed" if closed else "live"} for name in ctx["requiredResources"]]
        return dict({k: ctx[k] for k in ("nonce", "assignmentHash", "invocation", "sourceCommit", "sourceTree", "job")},
                    complete=complete, resources=resources, errors=list(self.errors), orphanWaitStatus=None,
                    anchorExitCode=self.io.status("anchor"), topology="actual command child survives command exit")

    def cleanup_root(self, registration, ctx, remaining):
        if not self._closed():
            raise ValueError("native root lacks positive scoped closure")
        return self.io.cleanup(registration, ctx, remaining)

    def close_output(self, handle, remaining):
        # Negative cases retain independent control custody; they cannot claim
        # complete output closure. Positive closure happens before receipt emission.
        return self.io.close(remaining) if self._closed() else False

    def emit_receipt(self, receipt, remaining):
        self.receipts.append(copy.deepcopy(receipt))
        try:
            return self.io.emit(receipt, remaining)
        except PermissionError:
            self.denied_operations.add("receipt")
            self.refused = True
            raise

    def _retain_finalization_refusal(self, operation, target, exc):
        records = getattr(self.io, "finalization_refusals", []) or [{
            "operation": operation, "target": target, "diagnostic": str(exc),
            "errno": exc.errno, "refusingLayer": "ParentExitController.finish"}]
        for record in records:
            if record not in self.finalization_refusals:
                self.finalization_refusals.append(copy.deepcopy(record))
                self.errors.append(record["diagnostic"])
            self.denied_operations.add(record["operation"])

    def _finish_artifacts(self, end, *, partial):
        root = self.ctx["roots"][0]["path"] if self.ctx.get("roots") else None
        operations = (("output-close", None), ("root-cleanup", root)) if partial else (("root-cleanup", root), ("output-close", None))
        complete = True
        for operation, target in operations:
            if operation == "root-cleanup" and target is None:
                continue
            blocked = any(r["operation"] in ("output-close", "fd-close") if operation == "output-close"
                          else r["operation"] == operation and r["target"] == target
                          for r in self.finalization_refusals)
            if blocked or self.monotonic() >= end:
                complete = False
                continue
            try:
                remaining = end - self.monotonic()
                if operation == "output-close":
                    settled = self.io.close(remaining) is True
                elif partial:
                    settled = self.io.partial_cleanup(self.ctx, remaining) is True
                else:
                    settled = self.io.cleanup(self.ctx["roots"][0], self.ctx, remaining).get("absent") is True
                complete = settled and complete
            except PermissionError as exc:
                self._retain_finalization_refusal(operation, target, exc)
                complete = False
            except Exception as exc:
                self.errors.append(str(exc))
                complete = False
        return complete and not self.finalization_refusals

    def finish(self, receipt, end):
        if receipt.get("refusals") or self.refused:
            self.refused = True
            return False
        try:
            if self.armed and not self._closed() and self.io.status("anchor") is None:
                self.signal("fixture-group", signal.SIGTERM, max(0, end - self.monotonic()))
            elif not self.armed:
                self.io.abort_unarmed(max(0, end - self.monotonic()))
            while self.monotonic() < end - 0.05:
                if not self.armed and self.io.unarmed_children_closed():
                    return self._finish_artifacts(end, partial=True)
                    # Partial cleanup does not change the original incomplete receipt.
                if not self._closed():
                    self.read_output(self, offline.OUTPUT_LIMIT)
                if self._closed():
                    return self._finish_artifacts(end, partial=False)
                self.io.wait(min(0.02, max(0, end - 0.05 - self.monotonic())))
        except PermissionError as exc:
            self._retain_finalization_refusal("owner-finalization", None, exc)
        except Exception as exc:
            self.errors.append(str(exc))
        return False


def run_parent_exit_case(mode, ctx, execution_end, settlement_end, *, io=None, controller_ready=None):
    ctx["qualificationExecutionEnd"] = execution_end
    ctx["qualificationSettlementEnd"] = settlement_end
    controller = ParentExitController.__new__(ParentExitController)
    if "qualificationOwners" in ctx:
        ctx["qualificationOwners"].append(controller)
    transport = io if io is not None else NativeGroupIO()
    witness = None
    unavailable = "unsupported-transport"
    if getattr(transport, "_timing_supported", False) is True:
        try:
            witness = _NativeTimingWitness(execution_end)
            transport.timing_witness, transport.timing_phase = witness, "execution"
        except Exception:
            unavailable = "collector-error"
    receipt = {"status": "incomplete", "wrapperExitCode": 1, "receiptWritten": False, "resources": {"complete": False}}
    try:
        controller.__init__(mode, ctx, execution_end, settlement_end, transport)
        if controller_ready is not None:
            controller_ready(controller)
        spec = {"id": "fixture-" + mode, "profile": "fixture",
                "argv": [ctx["python"], "-I", "-S", "-B", ctx["testFile"], "--fixture", mode],
                "executionSeconds": min(1, max(0, execution_end - transport.clock())), "settlementSeconds": 1}
        # Admission keeps the original fixed 1+1 limits; this invocation must
        # start before its predeclared end rather than granting a fresh budget.
        spec["executionSeconds"] = 1
        # Parent sample immediately before entry, not the supervisor's internal start.
        _timing_call(witness, "pre_supervise", _timing_now(witness))
        receipt = offline.supervise(spec, ctx, ops=controller)
        _timing_call(witness, "freeze_execution")
    except Exception as exc:
        _timing_call(witness, "partial_startup")
        _timing_call(witness, "record", "execution", {"kind": "startup", "observed": _timing_now(witness),
                     "exception": _timing_exception(exc)})
        _timing_call(witness, "record_failure", "execution", {"kind": "startup", "exception": _timing_exception(exc)})
        _timing_call(witness, "freeze_execution")
        controller.errors = getattr(controller, "errors", []) + [str(exc)]
    if witness is not None:
        transport.timing_phase = "owner-cleanup"
    frozen = json.dumps(receipt, sort_keys=True)
    owner_closed = controller.finish(receipt, settlement_end)
    return {"receipt": receipt, "ownerClosed": owner_closed,
            "originalReceiptUnchanged": json.dumps(receipt, sort_keys=True) == frozen,
            "orphanWaitStatus": None, "outlivedCommand": controller.outlived_command,
            "heldStreamAfterExit": controller.held_stream, "frames": controller.frames,
            "ownerCleanup": controller.finish_actions, "errors": controller.errors,
            "ownerRefusals": controller.finalization_refusals,
            "anchorExitCode": transport.status("anchor"),
            "nativeTimingWitness": (_timing_call(witness, "result")
                                    or _NativeTimingWitness.unavailable(unavailable))}


class FakeNativeGroupIO:
    """Kernel effects only; the real native controller and supervisor execute."""
    def __init__(self, *, fault=None):
        self.now, self.fault = 0.0, fault
        self.events, self.group_signals, self.direct_signals = [], [], []
        self.stop_attempts, self.queue = 0, []
        self.codes, self.owner_pid, self.session = {}, 51, 4000
        self.eof, self.stop_at, self.removed = False, math.inf, False

    def setup(self, mode, ctx, end):
        self.ctx = ctx

    def clock(self):
        return self.now

    def _frame(self, event, role, **extra):
        self.queue.append((GROUP_PREFIX + json.dumps(group_message(self.ctx, event,
            pid={"command": 61, "anchor": 62, "work": 63}[role], parentPid=61 if role == "work" else 51,
            group=61, session=4000, **extra)) + "\n").encode())

    def command(self, ctx, execution_end, settlement_end):
        self.codes["command"] = None
        if self.fault != "missing-command":
            self._frame("command-ready", "command")
        return 61

    def anchor(self, ctx, execution_end, settlement_end, group):
        self.codes["anchor"] = None
        if self.fault == "conflicting-anchor":
            self.queue.append((GROUP_PREFIX + json.dumps(group_message(ctx, "anchor-ready", pid=999,
                               parentPid=51, group=61, session=4000)) + "\n").encode())
        elif self.fault != "late-anchor":
            self._frame("anchor-ready", "anchor")
        return 62

    def send(self, role, event, end, **fields):
        if event == "ARM":
            self.events.append("armed")
            self._frame("armed", "anchor")
        elif event == "GO":
            self.events.append("fork-work")
            self._frame("work-ready", "work")
            if self.fault == "partial-work":
                self.queue[-1] = self.queue[-1][:-2]
        elif event == "RELEASE" and role == "anchor":
            self.events.append("registered-work")
            self._frame("release-armed", "anchor")
        elif event == "RELEASE":
            self.events.append("parent-exit")
            self._frame("parent-exiting", "command", workPid=63)
            self.codes["command"] = 0
        elif event == "STOP":
            self.stop_attempts += 1
            if self.fault == "refused-stop":
                raise PermissionError(1, "owned anchor control refused")
            self.group_signals.append(signal.SIGTERM)
            self._frame("term", "anchor")
            self.stop_at = self.now + 0.1

    def wait(self, seconds):
        self.now += seconds
        if self.now >= self.stop_at:
            self.stop_at = math.inf
            self.group_signals.append(signal.SIGKILL)
            self.codes["anchor"] = -signal.SIGKILL
            self._frame("kill", "anchor")
            self.eof = True

    def read(self, limit):
        data, self.queue = b"".join(self.queue), []
        return data, b"fixture partial stderr work\n", self.eof

    def status(self, role):
        return self.codes.get(role)

    def direct(self, role, signum, remaining):
        self.direct_signals.append((role, signum))
        self.codes[role] = -signum
        self.eof = all(type(code) is int for code in self.codes.values())

    def abort_unarmed(self, remaining):
        for role in tuple(self.codes):
            if self.codes[role] is None:
                self.direct(role, signal.SIGTERM, remaining)

    def partial_cleanup(self, ctx, remaining):
        self.removed = True
        return True

    def unarmed_children_closed(self):
        return all(type(code) is int for code in self.codes.values())

    def command_stream_open(self):
        return not self.eof

    def physical_closed(self, eof):
        return eof and all(type(code) is int for code in self.codes.values())

    def cleanup(self, registration, ctx, remaining):
        self.removed = True
        return {"path": registration["path"], "absent": True}

    def close(self, remaining):
        return True

    def emit(self, receipt, remaining):
        return True


CONTROLLER_READY = "FIXTURE_CONTROLLER_READY "
CONTROLLER_DONE = "FIXTURE_CONTROLLER_DONE "


class ControllerProcessIO:
    def __init__(self):
        self.base = offline.RealOps()
        self.handle = None

    def clock(self):
        return self.base.monotonic()

    def spawn(self, spec, ctx, execution_end, settlement_end):
        env = dict(ctx["environment"])
        env.update({"COUNCIL_BOOTSTRAP_ROOT": ctx["commandRoot"],
                    "COUNCIL_GROUP_CASE_ROOT": ctx["roots"][0]["path"],
                    "COUNCIL_GROUP_EXECUTION_END": str(execution_end),
                    "COUNCIL_GROUP_SETTLEMENT_END": str(settlement_end)})
        child_ctx = dict(ctx, environment=env)
        try:
            self.handle = self.base.spawn(spec, child_ctx)  # New session policy remains.
        except offline.PartialSpawnError as exc:
            self.handle = exc.handle
            raise
        return self.handle["process"].pid

    def read(self, limit):
        return self.base.read_output(self.handle, limit)

    def status(self):
        return self.base.poll(self.handle)

    def identity(self, ctx):
        return self.base.identity("command", ctx)

    def signal(self, signum, remaining):
        self.base.signal("command", signum, remaining)

    def wait(self, seconds):
        self.base.wait(self.handle, seconds, "settlement")

    def close(self, remaining):
        return self.base.close_output(self.handle, remaining)

    def emit(self, receipt, remaining):
        return self.base.emit_receipt(receipt, remaining)

    def root_absent(self, ctx):
        return not os.path.lexists(ctx["roots"][0]["path"])


class ControllerCancellationOwner:
    """External parent sends TERM to a retained custodial controller after READY."""
    def __init__(self, mode, ctx, execution_end, settlement_end, io):
        self.mode, self.ctx, self.io = mode, ctx, io
        self.execution_end, self.settlement_end = execution_end, settlement_end
        self.pid = None
        self.ready = self.done = None
        self.eof = self.refused = self.identity_conflict = False
        self.cancel_requested = self.term_sent = False
        self.denied_operations = set()
        self.receipts = []
        self.pending = b""

    def monotonic(self):
        return self.io.clock()

    def timestamp(self):
        return "monotonic:" + str(self.monotonic())

    def spawn(self, spec, ctx):
        self.pid = self.io.spawn(spec, ctx, self.execution_end, self.settlement_end)
        return self

    def poll(self, handle):
        return self.io.status()

    def read_output(self, handle, limit):
        out, err, self.eof = self.io.read(limit)
        self.pending += out
        while b"\n" in self.pending:
            line, self.pending = self.pending.split(b"\n", 1)
            for prefix, key in ((CONTROLLER_READY, "ready"), (CONTROLLER_DONE, "done")):
                if not line.startswith(prefix.encode()):
                    continue
                frame = json.loads(line[len(prefix):])
                if (frame.get("controllerPid") != self.pid or frame.get("mode") != self.mode
                        or any(frame.get(k) != self.ctx.get(k) for k in GROUP_BINDING)):
                    self.identity_conflict = True
                    raise ValueError("foreign/reused custodial-controller identity")
                if getattr(self, key) is not None and getattr(self, key) != frame:
                    self.identity_conflict = True
                    raise ValueError("conflicting controller lifecycle frame")
                if key == "ready" and (frame.get("parentExitCode") != 0 or frame.get("workLive") is not True
                                       or frame.get("anchorLive") is not True or frame.get("heldStream") is not True):
                    raise ValueError("controller cancel attempted without live descendant boundary")
                setattr(self, key, frame)
        if len(self.pending) > offline.OUTPUT_LIMIT:
            raise ValueError("oversized unterminated controller output")
        return out, err, self.eof

    def cancelled(self):
        return self.cancel_requested or self.ready is not None

    def wait(self, handle, seconds, phase):
        self.io.wait(seconds)

    def targets(self, handle, ctx):
        return [] if self.identity_conflict else ["custodial-controller"]

    def identity(self, target, ctx):
        return self.io.identity(ctx)

    def signal(self, target, signum, remaining):
        if self.refused:
            raise ValueError("controller signal refusal retained")
        if signum != signal.SIGTERM:
            raise ValueError("custodial controller must retain bounded teardown custody")
        try:
            self.term_sent = True
            self.io.signal(signum, remaining)
        except PermissionError:
            self.refused = True
            raise

    def resource_state(self, handle, ctx, output):
        complete = (self.done is not None and self.done.get("controllerSignal") == int(signal.SIGTERM)
                    and self.done.get("descendantsClosed") is True and self.done.get("orphanWaitStatus") is None
                    and self.done.get("anchorExitCode") == -signal.SIGKILL
                    and self.done.get("originalReceiptUnchanged") is True
                    and self.done.get("parentExitCode") == 0 and self.done.get("innerCancelled") is True
                    and self.done.get("innerReceiptWritten") is True and self.done.get("originalStatus") == "cancelled"
                    and self.eof and self.io.status() == 1 and self.io.root_absent(ctx))
        return dict({k: ctx[k] for k in ("nonce", "assignmentHash", "invocation", "sourceCommit", "sourceTree", "job")},
                    complete=complete, resources=[{"id": "custodial-controller", "ownership": "owned",
                                                   "state": "closed" if complete else "unknown"}], errors=[])

    def cleanup_root(self, registration, ctx, remaining):
        if registration != ctx["roots"][0] or not offline._root_is_bound(registration, ctx) or not self.io.root_absent(ctx):
            raise ValueError("custodial controller did not settle its exact root")
        return {"path": registration["path"], "absent": True}

    def close_output(self, handle, remaining):
        # An unsettled controller still owns descendants and may supply its final
        # physical-settlement record during the original outer settlement phase.
        return self.io.close(remaining) if self.eof and type(self.io.status()) is int else False

    def finish(self, receipt, end):
        if self.identity_conflict or self.refused or receipt.get("refusals"):
            self.refused = True
            return False
        while self.monotonic() < end - 0.05:
            status = self.io.status()
            if (type(status) is int and self.done is not None and self.done.get("descendantsClosed") is True
                    and self.eof and self.io.root_absent(self.ctx)):
                return self.io.close(end - self.monotonic()) is True
            if status is None and not self.term_sent:
                identity = self.io.identity(self.ctx)
                if identity.get("ownership") != "owned" or identity.get("state") != "live":
                    return False
                self.signal("custodial-controller", signal.SIGTERM, end - self.monotonic())
            if isinstance(status, dict):
                return False
            try:
                self.read_output(self, offline.OUTPUT_LIMIT)
            except (OSError, ValueError):
                return False
            self.io.wait(min(0.02, max(0, end - 0.05 - self.monotonic())))
        return False

    def emit_receipt(self, receipt, remaining):
        self.receipts.append(copy.deepcopy(receipt))
        try:
            return self.io.emit(receipt, remaining)
        except PermissionError:
            self.denied_operations.add("receipt")
            self.refused = True
            raise


def run_controller_cancellation_case(mode, ctx, execution_end, settlement_end, *, io=None):
    ctx["qualificationExecutionEnd"], ctx["qualificationSettlementEnd"] = execution_end, settlement_end
    transport = io if io is not None else ControllerProcessIO()
    owner = ControllerCancellationOwner(mode, ctx, execution_end, settlement_end, transport)
    if "qualificationOwners" in ctx:
        ctx["qualificationOwners"].append(owner)
    spec = {"id": "fixture-" + mode, "profile": "fixture",
            "argv": [ctx["python"], "-I", "-S", "-B", ctx["testFile"], "--fixture", mode],
            "executionSeconds": 1, "settlementSeconds": 1}
    receipt = offline.supervise(spec, ctx, ops=owner)
    closed = bool(owner.done and owner.done.get("descendantsClosed"))
    matched = (owner.ready is not None and receipt["status"] == "cancelled" and receipt["childExitCode"] == 1
               and receipt["receiptWritten"] and receipt["resources"]["complete"]
               and not receipt["errors"] and not owner.refused)
    return {"mode": mode, "matched": matched, "receipt": receipt, "descendantsClosed": closed,
            "orphanWaitStatus": None, "controllerOutcome": owner.done}


def controller_fixture_main(mode):
    """This is the controller process actually cancelled by its external owner."""
    offline.require_hosted()
    binding = protocol_binding()
    execution_end = float(os.environ["COUNCIL_GROUP_EXECUTION_END"])
    settlement_end = float(os.environ["COUNCIL_GROUP_SETTLEMENT_END"])
    command_root = os.environ["COUNCIL_BOOTSTRAP_ROOT"]
    case_root = os.environ["COUNCIL_GROUP_CASE_ROOT"]
    registration = {k: binding[k] for k in ("nonce", "assignmentHash", "invocation")}
    registration["path"] = case_root
    ctx = {"contract": CONTRACT, **binding, "sourceFiles": offline.source_files(),
           "sourceIdentity": "exact bootstrap source hashes", "contractHash": offline.source_files()["scripts/ci/offline-contract.json"],
           "lockHash": CONTRACT["lockSha256"], "phase": "qualification", "python": sys.executable,
           "testFile": str(Path(__file__).resolve()), "cwd": str(ROOT), "commandRoot": command_root,
           "roots": [registration], "requiredResources": ["command", "work", "anchor"]}
    env = offline.command_environment(sys.executable, command_root, str(Path(command_root) / "npm-cache"), offline=True)
    for name in ("RUNNER_ENVIRONMENT", "RUNNER_OS", "RUNNER_ARCH", "GITHUB_REPOSITORY", "GITHUB_REPOSITORY_VISIBILITY",
                 "COUNCIL_BOOTSTRAP_NONCE", "COUNCIL_BOOTSTRAP_INVOCATION", "COUNCIL_BOOTSTRAP_ASSIGNMENT",
                 "COUNCIL_BOOTSTRAP_COMMIT", "COUNCIL_BOOTSTRAP_TREE", "COUNCIL_BOOTSTRAP_JOB", "COUNCIL_BOOTSTRAP_SOURCE"):
        env[name] = os.environ[name]
    ctx["environment"] = env
    received, active, notified = [None], [None], [False]
    def cancel(signum, _):
        received[0] = signum
        if active[0] is not None:
            active[0].cancel_requested = True
    previous = {s: signal.signal(s, cancel) for s in (signal.SIGTERM, signal.SIGINT)}
    def retain(controller):
        active[0] = controller
        controller.hold_for_cancel = True
        controller.cancel_requested = received[0] is not None
        original = controller.resource_state
        def observe(handle, context, output):
            result = original(handle, context, output)
            if (not notified[0] and controller.outlived_command and controller.held_stream
                    and controller.io.status("anchor") is None and "work-ready" in controller.frames):
                notified[0] = True
                ready = group_message(binding, "controller-ready", mode=mode, controllerPid=os.getpid(),
                                      parentExitCode=0, workLive=True, anchorLive=True, heldStream=True)
                if not offline.write_json(ready, max(0, min(0.05, execution_end - time.monotonic())), prefix=CONTROLLER_READY):
                    raise OSError("controller boundary readiness was not written")
            return result
        controller.resource_state = observe
    try:
        inner_mode = "missing-custody" if mode.endswith("missing-custody") else "detached-parent"
        result = run_parent_exit_case(inner_mode, ctx, execution_end, settlement_end, controller_ready=retain)
        if result["receipt"].get("refusals"):
            return 1  # No repeat/alternate record after an actual signal or write refusal.
        done = group_message(binding, "controller-done", mode=mode, controllerPid=os.getpid(),
                             controllerSignal=received[0], descendantsClosed=result["ownerClosed"],
                             orphanWaitStatus=None, anchorExitCode=result["anchorExitCode"],
                             originalReceiptUnchanged=result["originalReceiptUnchanged"],
                             parentExitCode=result["receipt"].get("childExitCode"),
                             innerCancelled=result["receipt"].get("cancelled", False),
                             innerReceiptWritten=result["receipt"].get("receiptWritten", False),
                             originalStatus=result["receipt"]["status"], errors=result["errors"])
        if not offline.write_json(done, max(0, min(0.05, settlement_end - time.monotonic())), prefix=CONTROLLER_DONE):
            return 1
        return 1  # Cancellation is never relabelled as successful child execution.
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)


class FakeControllerProcessIO:
    def __init__(self, *, fault=None):
        self.fault, self.now = fault, 0.0
        self.signals, self.events = [], []
        self.code, self.sent, self.eof, self.done_at = None, False, False, math.inf
        self.queue = []

    def clock(self):
        return self.now

    def spawn(self, spec, ctx, execution_end, settlement_end):
        self.ctx, self.mode = ctx, spec["id"][8:]
        return 71

    def status(self):
        if self.fault == "lost-controller":
            return {"state": "lost", "diagnostic": "controller custody lost"}
        return self.code

    def read(self, limit):
        if self.now >= 0.1 and not self.sent and self.fault not in ("partial-start", "late-ready"):
            self.sent = True
            self.events.append("work-ready")
            self.queue.append((CONTROLLER_READY + json.dumps(group_message(self.ctx, "controller-ready",
                mode=self.mode, controllerPid=99 if self.fault == "conflicting-ready" else 71,
                parentExitCode=0, workLive=True, anchorLive=True, heldStream=True)) + "\n").encode())
        out, self.queue = b"".join(self.queue), []
        return out, b"partial controller stderr\n", self.eof

    def identity(self, ctx):
        return {"ownership": "owned", "state": "unknown" if self.fault == "lost-controller" else "live" if self.code is None else "closed"}

    def signal(self, signum, remaining):
        self.signals.append(signum)
        self.events.append("signal-controller")
        if self.fault == "refused-controller":
            raise PermissionError(1, "controller signal refused")
        self.done_at = self.now + 0.35  # Longer than the old generic escalation allowance.

    def wait(self, seconds):
        self.now += seconds
        if self.now >= self.done_at:
            self.code, self.eof, self.done_at = 1, True, math.inf
            if self.fault != "missing-result":
                self.queue.append((CONTROLLER_DONE + json.dumps(group_message(self.ctx, "controller-done",
                    mode=self.mode, controllerPid=71, controllerSignal=int(signal.SIGTERM), descendantsClosed=True,
                    orphanWaitStatus=None, anchorExitCode=-signal.SIGKILL, originalReceiptUnchanged=True,
                    parentExitCode=0, innerCancelled=True, innerReceiptWritten=True, originalStatus="cancelled")) + "\n").encode())

    def root_absent(self, ctx):
        return self.code == 1

    def close(self, remaining):
        return True

    def emit(self, receipt, remaining):
        return True


def qualification_fixture(mode, ctx, execution_end, settlement_end, *, io=None):
    result = run_parent_exit_case(mode, ctx, execution_end, settlement_end, io=io)
    receipt = result["receipt"]
    expected = "incomplete" if mode == "missing-custody" else "passed"
    result["mode"] = mode
    result["matched"] = (receipt["status"] == expected and receipt["receiptWritten"]
                         and receipt["childExitCode"] == 0 and result["ownerClosed"]
                         and result["originalReceiptUnchanged"] and result["outlivedCommand"]
                         and result["heldStreamAfterExit"] and result["orphanWaitStatus"] is None
                         and result["anchorExitCode"] == -signal.SIGKILL
                         and "fixture partial stderr work" in receipt["output"]["stderr"])
    return result


def run_qualification(deadline):
    """Author-only here; the coordinator must review before the first hosted run."""
    import uuid
    offline.require_hosted()
    offline._validate_contract(CONTRACT)
    if CONTRACT.get("qualificationReady") is not True:
        raise ValueError("qualification held: " + "; ".join(CONTRACT["qualificationHolds"]))
    if deadline != 30:
        raise ValueError("qualification execution allowance is exactly 30 seconds")
    outer_binding = protocol_binding()
    command_root = Path(os.environ["COUNCIL_BOOTSTRAP_ROOT"])
    if not command_root.is_absolute() or command_root.is_symlink() or not command_root.is_dir():
        raise ValueError("qualification needs its exact command-owned root")
    start = time.monotonic()
    execution_end, settlement_end = start + 30, start + 60
    log = offline.QualificationLog(outer_binding, stage_writer=lambda frame, seconds:
        emit_evidence("qualification-stage", False, "owned-fixtures", seconds=seconds, stage_frame=frame))
    last_case = None
    details, controllers = [], []
    ok = True
    cancelled = [False]
    handlers = {}
    old_timer = signal.getitimer(signal.ITIMER_REAL)
    active = [None]
    def cancel(*_):
        cancelled[0] = True
        if active[0] is not None:
            active[0].cancel_requested = True
    for signum in (signal.SIGALRM, signal.SIGTERM, signal.SIGINT):
        handlers[signum] = signal.signal(signum, cancel)
    signal.setitimer(signal.ITIMER_REAL, 30)
    try:
        log.stage("qualifier-entry", execution_end)
        for mode, expected in (("success", "passed"), ("exit7", "failed"),
                               ("deadline", "timed-out"), ("cancel", "cancelled"),
                               ("detached-parent", "passed"), ("missing-custody", "incomplete"),
                               ("controller-cancel-resistant", "cancelled"),
                               ("controller-cancel-missing-custody", "cancelled")):
            if log.refusal is not None or cancelled[0] or time.monotonic() + 3 >= execution_end:
                ok = False
                break
            last_case = mode
            log.stage("case-entry", execution_end, case=mode)
            if log.refusal is not None:
                ok = False
                break
            nonce = uuid.uuid4().hex
            invocation = outer_binding["invocation"] + "/" + mode
            case_root = command_root / ("fixture-" + nonce)
            assignment = offline.bundle_hash({"parent": outer_binding["assignmentHash"],
                                              "mode": mode, "nonce": nonce, "root": str(case_root)})
            ctx = {"contract": CONTRACT, **{key: outer_binding[key] for key in ("sourceCommit", "sourceTree", "job")},
                   "sourceFiles": offline.source_files(), "sourceIdentity": "exact bootstrap source hashes",
                   "contractHash": offline.source_files()["scripts/ci/offline-contract.json"],
                   "lockHash": CONTRACT["lockSha256"], "phase": "qualification",
                   "python": sys.executable, "testFile": str(Path(__file__).resolve()), "cwd": str(ROOT),
                   "commandRoot": str(command_root), "nonce": nonce, "invocation": invocation,
                   "assignmentHash": assignment, "sourceBundleHash": outer_binding["sourceBundleHash"],
                   "qualificationOwners": controllers,
                   "requiredResources": ["command", "work", "anchor"] if mode in ("detached-parent", "missing-custody") else ["command"]}
            ctx["roots"] = [{"path": str(case_root), "nonce": nonce,
                             "invocation": invocation, "assignmentHash": assignment}]
            env = offline.command_environment(sys.executable, str(command_root), str(command_root / "npm-cache"), offline=True)
            for name in ("RUNNER_ENVIRONMENT", "RUNNER_OS", "RUNNER_ARCH", "GITHUB_REPOSITORY", "GITHUB_REPOSITORY_VISIBILITY"):
                env[name] = os.environ[name]
            env.update({"COUNCIL_BOOTSTRAP_NONCE": nonce, "COUNCIL_BOOTSTRAP_INVOCATION": invocation,
                        "COUNCIL_BOOTSTRAP_ASSIGNMENT": assignment,
                        "COUNCIL_BOOTSTRAP_COMMIT": ctx["sourceCommit"],
                        "COUNCIL_BOOTSTRAP_TREE": ctx["sourceTree"], "COUNCIL_BOOTSTRAP_JOB": ctx["job"],
                        "COUNCIL_BOOTSTRAP_SOURCE": outer_binding["sourceBundleHash"]})
            ctx["environment"] = env
            ctx["qualificationLog"] = log
            if mode.startswith("controller-cancel-"):
                ctx["requiredResources"] = ["custodial-controller"]
                case_start = time.monotonic()
                result = run_controller_cancellation_case(mode, ctx, min(execution_end, case_start + 1),
                                                          min(settlement_end, case_start + 2))
                details.append(result)
                log.stage("case-return", execution_end, case=mode)
                if log.refusal is not None or not result["matched"]:
                    ok = False
                    break
                continue
            if mode in ("detached-parent", "missing-custody"):
                case_start = time.monotonic()
                result = qualification_fixture(mode, ctx, min(execution_end, case_start + 1),
                                               min(settlement_end, case_start + 2))
                details.append(result)
                log.stage("case-return", execution_end, case=mode)
                if log.refusal is not None or not result["matched"]:
                    ok = False
                    break
                continue
            controller = FixtureController.__new__(FixtureController)
            # Retain the owner even if setup fails after allocating its root.
            controllers.append(controller)
            controller.__init__(mode, ctx, execution_end)
            active[0] = controller
            spec = {"id": "fixture-" + mode, "profile": "fixture",
                    "argv": [sys.executable, "-I", "-S", "-B", str(Path(__file__).resolve()), "--fixture", mode],
                    "executionSeconds": 1, "settlementSeconds": 1}
            receipt = offline.supervise(spec, ctx, ops=controller)
            frozen = json.dumps(receipt, sort_keys=True)
            owner_closed = controller.finish(receipt, min(execution_end, time.monotonic() + 2))
            same_receipt = json.dumps(receipt, sort_keys=True) == frozen
            case_ok = (receipt["status"] == expected and receipt["receiptWritten"] and owner_closed and same_receipt)
            if mode == "exit7":
                case_ok = case_ok and receipt["childExitCode"] == 7
            if mode == "deadline":
                case_ok = case_ok and receipt["timedOut"] and receipt["childExitCode"] == -signal.SIGKILL
            if mode == "cancel":
                case_ok = case_ok and receipt["cancelled"] and receipt["childExitCode"] == -signal.SIGTERM
            if "fixture partial stderr" not in receipt["output"]["stderr"]:
                case_ok = False
            details.append({"mode": mode, "matched": bool(case_ok), "ownerClosed": owner_closed,
                            "originalReceiptUnchanged": same_receipt,
                            "outlivedCommand": controller.outlived_command,
                            "heldStreamAfterExit": controller.held_stream,
                            "topology": "single directly retained standard-library fixture child",
                            "ownerCleanup": controller.finish_actions, "errors": controller.cleanup_errors})
            log.stage("case-return", execution_end, case=mode)
            if log.refusal is not None or not case_ok:
                ok = False
                break
    except Exception as exc:
        ok = False
        details.append({"operation": "qualification", "diagnostic": str(exc)})
    finally:
        # Independent final settlement is bounded by the original outer end and
        # cannot turn an earlier failed/incomplete supervisor receipt into a pass.
        for controller in controllers:
            if hasattr(controller, "ctx"):
                case = getattr(controller, "mode", None)
                try:
                    log.stage("owner-settlement-entry", settlement_end - 0.5, case=case)
                    if not controller.finish({}, settlement_end - 0.5):
                        ok = False
                    log.stage("owner-settlement-return", settlement_end - 0.5, case=case)
                except Exception as exc:
                    ok = False
                    details.append({"operation": "owner-final-settlement", "diagnostic": str(exc)})
        signal.setitimer(signal.ITIMER_REAL, *old_timer)
        for signum, handler in handlers.items():
            signal.signal(signum, handler)
    complete = ok and not cancelled[0] and len(details) == 8 and time.monotonic() < execution_end
    if log.refusal is not None or any("receipt" in c.denied_operations for c in controllers if hasattr(c, "denied_operations")):
        return 1  # Preserve an actual write refusal; no alternate log route.
    log.stage("aggregate-emission-entry", settlement_end, case=last_case)
    if log.refusal is not None:
        return 1
    remaining = max(0, min(0.5, settlement_end - time.monotonic()))
    try:
        written = emit_evidence("qualification", complete, "owned-fixtures", details=details, seconds=remaining, writer=log.write)
    except PermissionError:
        return 1
    return 0 if complete and written else 1


def cli(argv):
    parser = argparse.ArgumentParser()
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--pure", action="store_true")
    modes.add_argument("--qualify", action="store_true")
    modes.add_argument("--fixture", choices=list(offline.FIXTURE_MODES) + ["resistant", "group-command", "group-anchor"])
    parser.add_argument("--deadline-seconds", type=float, default=30)
    args = parser.parse_args(argv)
    if args.fixture:
        if args.fixture in ("controller-cancel-resistant", "controller-cancel-missing-custody"):
            return controller_fixture_main(args.fixture)
        if args.fixture in ("group-command", "group-anchor"):
            return group_fixture_main(args.fixture)
        return fixture_main(args.fixture)
    if args.qualify:
        return run_qualification(args.deadline_seconds)
    result = run_pure(args.deadline_seconds)
    if "COUNCIL_BOOTSTRAP_NONCE" in os.environ:
        # Local pure invocations print only unittest output. The hosted parent
        # requires this bound final manifest in addition to the raw exit status.
        if not emit_evidence("pure", result == 0, "pure-guard"):
            return 1
    return result


if __name__ == "__main__":
    raise SystemExit(cli(sys.argv[1:]))
