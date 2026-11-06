"""Bootstrap-only, standard-library supervision. Product profiles are never executable.

The operation adapter is a private seam, not a plugin or command admission API.
Only the fixed bootstrap payloads and inert fixtures below may be spawned. Receipts
describe scoped ownership, never a census of arbitrary process descendants.
"""

import argparse
import base64
import copy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import select
import selectors
import signal
import subprocess
import sys
import time
import uuid


ROOT = Path(__file__).resolve().parents[2]
CONTRACT_PATH = Path(__file__).with_name("offline-contract.json")
FIXTURE_MODES = ("success", "exit7", "deadline", "cancel", "detached-parent", "missing-custody",
                 "controller-cancel-resistant", "controller-cancel-missing-custody")
OUTPUT_LIMIT = 1_048_576
EVIDENCE_PREFIX = "COUNCIL_BOOTSTRAP_EVIDENCE "
_RESERVE = 0.05  # Keep receipt emission inside, rather than after, settlement.


class PartialSpawnError(RuntimeError):
    """A successful Popen remains owned even when later attachment fails."""

    def __init__(self, cause, handle):
        super().__init__(str(cause))
        self.handle = handle
        self.cause = cause


def _bootstrap_specs():
    return [{"id": name, "profile": "bootstrap",
             "argv": ["{python}", "-I", "-S", "-B", "{testFile}", flag,
                      "--deadline-seconds", "30"],
             "executionSeconds": 30, "settlementSeconds": 30}
            for name, flag in (("pure", "--pure"), ("qualification", "--qualify"))]


def _may_escalate(spec):
    # This process retains the only handles for fixture descendants. TERM asks
    # it to settle them; killing it before custody is transferred is forbidden.
    # If it cannot settle inside the same 30 seconds, report incomplete custody.
    return not ((spec.get("profile") == "bootstrap" and spec.get("id") == "qualification")
                or (spec.get("profile") == "fixture" and spec.get("id") in (
                    "fixture-controller-cancel-resistant", "fixture-controller-cancel-missing-custody")))


def _validate_contract(contract):
    if (contract.get("schemaVersion") != 1 or contract.get("selection") != "bootstrap"
            or contract.get("productExecutionEnabled") is not False
            or contract.get("productAcceptanceEnabled") is not False
            or contract.get("bootstrap") != _bootstrap_specs()
            or contract.get("fixtureModes") != list(FIXTURE_MODES)
            or contract.get("fixtureExecutionSeconds") != 1
            or contract.get("fixtureSettlementSeconds") != 1
            or contract.get("outputLimitBytes") != OUTPUT_LIMIT
            or contract.get("resourceProtocol") != "bootstrap-owned-v1"):
        raise ValueError("unsupported contract; only the reviewed bootstrap class is admitted")


def command_plan(job: str, phase: str, contract: dict) -> list[dict]:
    _validate_contract(contract)
    if job not in ("checks", "diagnostics", "defaults"):
        raise ValueError("unknown job")
    if phase in ("selected", "bootstrap"):
        return copy.deepcopy(contract["bootstrap"])
    if phase == "candidate":
        # Data for future planning only. Neither supervise nor main admits these.
        return [dict(copy.deepcopy(contract["candidateProfiles"][name]), id=name,
                     profile="candidate", executionEnabled=False,
                     heldReasons=copy.deepcopy(contract["heldReasons"]))
                for name in contract["candidateSchedules"][job]]
    raise ValueError("unknown phase")


def command_environment(node: str, command_root: str, job_cache: str, *, offline: bool) -> dict[str, str]:
    for value in (node, command_root, job_cache):
        if not PurePosixPath(value).is_absolute() or ".." in PurePosixPath(value).parts:
            raise ValueError("environment paths must be absolute and normalized")
    root = PurePosixPath(command_root)
    # Construct from nothing; do not filter a copy of os.environ.
    return {
        "PATH": str(PurePosixPath(node).parent) + ":/usr/bin:/bin:/usr/sbin:/sbin",
        "HOME": str(root / "home"), "TMPDIR": str(root / "tmp"),
        "TMP": str(root / "tmp"), "TEMP": str(root / "tmp"),
        "SHELL": "/bin/sh", "LANG": "C", "LC_ALL": "C", "TZ": "UTC",
        "npm_config_cache": job_cache,
        "npm_config_userconfig": str(root / "user.npmrc"),
        "npm_config_globalconfig": str(root / "global.npmrc"),
        "npm_config_offline": "true" if offline else "false",
        "npm_config_update_notifier": "false", "npm_config_audit": "false",
        "npm_config_fund": "false",
    }


def source_binding(environment, *, commit=None, job=None):
    result = {key: environment.get(name) for key, name in (
        ("sourceCommit", "COUNCIL_BOOTSTRAP_COMMIT"),
        ("sourceTree", "COUNCIL_BOOTSTRAP_TREE"), ("job", "COUNCIL_BOOTSTRAP_JOB"))}
    if (not isinstance(result["sourceCommit"], str) or not re.fullmatch(r"[0-9a-f]{40}", result["sourceCommit"])
            or not isinstance(result["sourceTree"], str) or not re.fullmatch(r"[0-9a-f]{40}", result["sourceTree"])
            or result["job"] not in ("checks", "diagnostics", "defaults")
            or (commit is not None and result["sourceCommit"] != commit)
            or (job is not None and result["job"] != job)):
        raise ValueError("missing or mismatched checkout commit/tree/job binding")
    return result


def _render(spec, ctx):
    result = copy.deepcopy(spec)
    replacements = {"{python}": ctx["python"], "{testFile}": ctx["testFile"]}
    result["argv"] = [replacements.get(a, a) for a in result["argv"]]
    return result


def _admitted(spec, ctx):
    _validate_contract(ctx["contract"])
    if ctx["job"] not in ("checks", "diagnostics", "defaults"):
        return False
    if spec.get("profile") == "bootstrap" and ctx["phase"] == "bootstrap":
        return spec in [_render(s, ctx) for s in _bootstrap_specs()]
    if spec.get("profile") == "fixture" and ctx["phase"] == "qualification":
        for mode in FIXTURE_MODES:
            expected = {"id": "fixture-" + mode, "profile": "fixture",
                        "argv": [ctx["python"], "-I", "-S", "-B", ctx["testFile"], "--fixture", mode],
                        "executionSeconds": 1, "settlementSeconds": 1}
            if spec == expected:
                return True
    return False


def _resource_evidence(evidence, ctx):
    if not isinstance(evidence, dict):
        return False
    if any(evidence.get(key) != ctx[key] for key in ("nonce", "assignmentHash", "invocation", "sourceCommit", "sourceTree", "job")):
        return False
    resources = evidence.get("resources")
    if not isinstance(resources, list) or len(resources) > 64:
        return False
    if not all(isinstance(r, dict) and isinstance(r.get("id"), str) for r in resources):
        return False
    ids = [r["id"] for r in resources]
    required = ctx["requiredResources"]
    return (evidence.get("complete") is True and evidence.get("errors") == []
            and len(ids) == len(set(ids)) and set(ids) == set(required)
            and len(required) == len(set(required))
            and all(r.get("state") == "closed" and r.get("ownership") == "owned" for r in resources))


def _root_is_bound(registration, ctx):
    path = PurePosixPath(registration.get("path", ""))
    parent = PurePosixPath(ctx["commandRoot"])
    return (path.is_absolute() and path != parent and ".." not in path.parts
            and path.parent == parent
            and all(registration.get(k) == ctx[k] for k in ("nonce", "assignmentHash", "invocation")))


class _CancellationProbe:
    """A failed observer is never retried or mistaken for an actual signal."""

    def __init__(self, ops, payload):
        self.ops, self.payload, self.failed = ops, payload, False

    def sample(self):
        if not self.failed and not self.payload.get("cancelled", False):
            try:
                self.payload["cancelled"] = bool(self.ops.cancelled())
            except Exception as exc:
                self.failed = True
                self.payload["cancellationObservationFailed"] = True
                item = {"operation": "cancellation-observation", "target": None, "diagnostic": str(exc)}
                self.payload.setdefault("errors", []).append(item)
                if isinstance(exc, PermissionError):
                    item["errno"] = exc.errno
                    self.payload.setdefault("refusals", []).append(item)
        if self.failed:
            self.payload["status"] = "incomplete"
            self.payload["wrapperExitCode"] = 1
        if self.payload.get("cancelled", False):
            self.payload["status"] = "cancelled"
            self.payload["wrapperExitCode"] = 1
        return self.payload.get("cancelled", False)


def _emit_outcome(payload, ops, deadline, emit, *, cancellation=None):
    """Append-only proposals/final outcome, with explicit late-cancel revocation.

    Completion linearizes after the last successful write and sticky-cancel
    sample. A recorded success is conditional on zero wrapper exit and absence
    of a superseding outcome; a proposal alone never constitutes verification.
    A refusal raises immediately and never selects another log route.
    """
    probe = cancellation or _CancellationProbe(ops, payload)
    sample = probe.sample

    def append(sequence, final):
        sample()
        payload.update({"sequence": sequence, "final": final,
                        "acceptanceCondition": "zero wrapper exit; no superseding outcome"})
        if sequence:
            payload["supersedes"] = sequence - 1
        remaining = deadline - ops.monotonic()
        if remaining <= 0 or emit(copy.deepcopy(payload), remaining) is not True or ops.monotonic() >= deadline:
            return False
        return True

    if not append(0, False):
        return False
    if not append(1, True):
        return False
    previous = (payload.get("cancelled", False), probe.failed)
    sample()
    if (payload.get("cancelled", False), probe.failed) != previous:
        # Do not silently change an already emitted result: retain it and
        # append the truthful cancellation that explicitly supersedes it.
        if not append(2, True):
            return False
    payload["completionLinearizedAt"] = ops.monotonic()
    return True


def supervise(spec: dict, context: dict, *, ops: object) -> dict:
    ctx = context
    receipt = {key: ctx.get(key) for key in (
        "sourceCommit", "sourceTree", "sourceFiles", "sourceIdentity", "contractHash", "lockHash",
        "invocation", "nonce", "assignmentHash", "job", "phase")}
    receipt.update({"schemaVersion": 1, "id": spec.get("id"), "argv": spec.get("argv"),
                    "cwd": ctx.get("cwd"), "status": "incomplete", "wrapperExitCode": 1,
                    "childExitCode": None, "childSignal": None, "timedOut": False,
                    "cancelled": False, "receiptWritten": False, "errors": [], "refusals": [],
                    "cleanupActions": [], "resources": {"complete": False},
                    "output": {"stdout": "", "stderr": "", "complete": False, "truncated": False,
                               "locations": ["receipt:output.stdoutBase64", "receipt:output.stderrBase64"]},
                    "executionDuration": 0, "settlementDuration": 0})

    def error(operation, exc, *, target=None):
        item = {"operation": operation, "target": target, "diagnostic": str(exc)}
        if isinstance(exc, PermissionError):
            item["errno"] = exc.errno
            if item not in receipt["refusals"]:
                receipt["refusals"].append(item)
        if item not in receipt["errors"]:
            receipt["errors"].append(item)

    try:
        if not _admitted(spec, ctx):
            raise ValueError("unadmitted command profile; product execution is held")
    except (KeyError, TypeError, ValueError) as exc:
        error("admission", exc)
        # Rejection has no spawn, wait, signal, root cleanup or environment setup.
        receipt["receiptWritten"] = True
        try:
            receipt["receiptWritten"] = ops.emit_receipt(receipt, _RESERVE) is True
        except Exception as write_exc:
            error("receipt", write_exc)
            receipt["receiptWritten"] = False
        return receipt

    start = ops.monotonic()
    receipt["startedAt"] = ops.timestamp()
    execution_end = min(start + spec["executionSeconds"], ctx.get("qualificationExecutionEnd", float("inf")))
    settlement_cap = ctx.get("qualificationSettlementEnd", float("inf"))
    settlement_start = None
    child = None
    raw = None
    buffers = {"stdout": bytearray(), "stderr": bytearray()}
    eof = truncated = False
    term_sent, kill_sent, blocked = set(), set(), set()
    roots_done = False
    resources_ok = False
    cancellation = _CancellationProbe(ops, receipt)
    try:
        child = ops.spawn(spec, ctx)
        while True:
            now = ops.monotonic()
            cancellation.sample()
            if cancellation.failed:
                raise ValueError("cancellation observation unavailable; entering bounded settlement")
            raw = ops.poll(child)
            if isinstance(raw, dict) and raw.get("state") == "lost":
                error("wait-custody", ValueError(raw.get("diagnostic", "lost wait custody")))
                raw = None
                if settlement_start is None:
                    settlement_start = min(ops.monotonic(), execution_end)
                receipt["waitCustodyLost"] = True
            if raw is not None and (type(raw) is not int):
                raw = None
                raise ValueError("unknown/malformed child wait status")
            observed = ops.monotonic()
            if settlement_start is None and (raw is not None or receipt["cancelled"]):
                if observed >= execution_end:
                    receipt["timedOut"] = True
                    settlement_start = execution_end
                else:
                    settlement_start = observed
            out, err, eof = ops.read_output(child, OUTPUT_LIMIT)
            for name, data in (("stdout", out), ("stderr", err)):
                if not isinstance(data, bytes):
                    raise ValueError("output observation must contain bytes")
                capacity = OUTPUT_LIMIT - sum(map(len, buffers.values()))
                buffers[name].extend(data[:max(0, capacity)])
                truncated = truncated or len(data) > capacity
            output = {name: bytes(data).decode("utf-8", "replace") for name, data in buffers.items()}
            evidence = ops.resource_state(child, ctx, output)
            resources_ok = _resource_evidence(evidence, ctx)
            receipt["resources"] = {"complete": resources_ok, "evidence": evidence}
            cancellation.sample()
            if cancellation.failed:
                raise ValueError("cancellation observation unavailable; entering bounded settlement")
            now = ops.monotonic()  # Observation time consumes the current phase too.
            if settlement_start is None:
                if now >= execution_end:
                    receipt["timedOut"] = True
                    settlement_start = execution_end
                elif raw is not None or receipt["cancelled"]:
                    settlement_start = now
            if settlement_start is None:
                remaining = execution_end - now
                if remaining > 0:
                    ops.wait(child, min(0.05, remaining), "execution")
                continue

            settlement_end = min(settlement_cap, settlement_start + spec["settlementSeconds"])
            remaining = settlement_end - now
            if remaining <= _RESERVE + 1e-9:
                break
            if raw is not None and eof and resources_ok:
                roots_done = True
                seen_roots = set()
                for registration in ctx.get("roots", []):
                    if (not _root_is_bound(registration, ctx)
                            or registration["path"] in seen_roots):
                        error("root-identity", ValueError("unbound/conflicting exact root"))
                        roots_done = False
                        continue
                    seen_roots.add(registration["path"])
                    remaining = settlement_end - ops.monotonic()
                    if remaining <= _RESERVE + 1e-9:
                        roots_done = False
                        break
                    try:
                        action = ops.cleanup_root(registration, ctx, remaining - _RESERVE)
                        cancellation.sample()
                        receipt["cleanupActions"].append(action)
                        if action.get("path") != registration["path"] or action.get("absent") is not True:
                            raise ValueError("exact root absence was not verified")
                    except Exception as exc:
                        error("root-cleanup", exc, target=registration["path"])
                        roots_done = False
                break

            # The fixed fixtures own handles, not inferred process samples or raw pids.
            for target in ops.targets(child, ctx):
                if target in blocked:
                    continue
                try:
                    identity = ops.identity(target, ctx)
                    if identity.get("ownership") != "owned":
                        blocked.add(target)
                        error("process-identity", ValueError("unbound or conflicting identity"), target=target)
                        continue
                    if identity.get("state") == "closed":
                        continue
                    if identity.get("state") != "live":
                        blocked.add(target)
                        error("process-identity", ValueError(identity.get("diagnostic", "unknown process identity")), target=target)
                        continue
                    signum = None
                    if target not in term_sent:
                        signum = signal.SIGTERM
                        term_sent.add(target)
                    elif _may_escalate(spec) and target not in kill_sent and now - settlement_start >= min(0.25, spec["settlementSeconds"] / 2):
                        signum = signal.SIGKILL
                        kill_sent.add(target)
                    remaining = settlement_end - ops.monotonic()
                    if signum is not None and remaining > _RESERVE:
                        ops.signal(target, signum, remaining - _RESERVE)
                        receipt["cleanupActions"].append({"operation": "signal", "target": target,
                                                          "signal": int(signum)})
                except Exception as exc:
                    # No alternate target, killpg, signal or escalation after a refusal.
                    blocked.add(target)
                    error("signal", exc, target=target)
            remaining = settlement_end - ops.monotonic() - _RESERVE
            if remaining <= 1e-9:
                break
            ops.wait(child, min(0.05, remaining), "settlement")
    except Exception as exc:
        child = getattr(exc, "handle", child)
        error("observation-or-spawn", getattr(exc, "cause", exc))
        if settlement_start is None:
            settlement_start = min(ops.monotonic(), execution_end)
        # Observation failure does not erase independent retained custody. Do
        # not repeat the failed observation; settle only proven owned targets.
        settlement_end = min(settlement_cap, settlement_start + spec["settlementSeconds"])
        while ops.monotonic() < settlement_end - _RESERVE - 1e-9:
            live = False
            try:
                targets = ops.targets(child, ctx)
            except Exception as target_exc:
                error("settlement-targets", target_exc)
                break
            for target in targets:
                if target in blocked:
                    continue
                try:
                    identity = ops.identity(target, ctx)
                    if identity.get("ownership") != "owned" or identity.get("state") not in ("live", "closed"):
                        blocked.add(target)
                        error("process-identity", ValueError("unproven exception-path custody"), target=target)
                        continue
                    if identity["state"] == "closed":
                        continue
                    live = True
                    signum = None
                    if target not in term_sent:
                        signum = signal.SIGTERM
                        term_sent.add(target)
                    elif _may_escalate(spec) and target not in kill_sent and ops.monotonic() - settlement_start >= min(0.25, spec["settlementSeconds"] / 2):
                        signum = signal.SIGKILL
                        kill_sent.add(target)
                    remaining = settlement_end - ops.monotonic() - _RESERVE
                    if signum is not None and remaining > 0:
                        ops.signal(target, signum, remaining)
                        receipt["cleanupActions"].append({"operation": "signal", "target": target, "signal": int(signum)})
                except Exception as settle_exc:
                    blocked.add(target)
                    error("signal", settle_exc, target=target)
            if child is not None:
                try:
                    observed_raw = ops.poll(child)
                    if type(observed_raw) is int:
                        raw = observed_raw
                except Exception as poll_exc:
                    error("settlement-poll", poll_exc)
            if not live:
                break
            remaining = settlement_end - ops.monotonic() - _RESERVE
            if remaining <= 1e-9:
                break
            try:
                ops.wait(child, min(0.05, remaining), "settlement")
            except Exception as wait_exc:
                error("settlement-wait", wait_exc)
                break

    end = ops.monotonic()
    if settlement_start is None:
        settlement_start = min(end, execution_end)
    if child is not None:
        try:
            remaining = min(settlement_cap, settlement_start + spec["settlementSeconds"]) - ops.monotonic()
            if remaining <= 0 or ops.close_output(child, remaining) is not True:
                raise OSError("owned output handles were not closed within settlement")
        except Exception as exc:
            error("close-output", exc)
    end = ops.monotonic()
    cancellation.sample()
    receipt["endedAt"] = ops.timestamp()
    receipt["executionDuration"] = max(0, settlement_start - start)
    receipt["settlementDuration"] = max(0, end - settlement_start)
    receipt["executionSeconds"] = spec["executionSeconds"]
    receipt["settlementSeconds"] = spec["settlementSeconds"]
    receipt["childExitCode"] = raw
    receipt["childSignal"] = -raw if raw is not None and raw < 0 else None
    receipt["output"].update({name: bytes(data).decode("utf-8", "replace") for name, data in buffers.items()})
    receipt["output"].update({name + "Base64": base64.b64encode(data).decode("ascii") for name, data in buffers.items()})
    receipt["output"].update({"complete": eof is True and not truncated,
                              "truncated": truncated, "capturedBytes": sum(map(len, buffers.values()))})
    receipt["remainingResources"] = ([] if resources_ok else ["unverified fixture resources"])
    if not roots_done:
        receipt["remainingResources"] += [r.get("path") for r in ctx.get("roots", [])]
    if receipt["cancelled"]:
        receipt["status"] = "cancelled"
    elif cancellation.failed:
        receipt["status"] = "incomplete"
    elif receipt["timedOut"]:
        receipt["status"] = "timed-out"
    elif raw is not None and raw != 0:
        receipt["status"] = "failed"
    elif (raw == 0 and receipt["output"]["complete"] and resources_ok and roots_done
          and not receipt["errors"] and end < min(settlement_cap, settlement_start + spec["settlementSeconds"])):
        receipt["status"] = "passed"
    receipt["wrapperExitCode"] = 0 if receipt["status"] == "passed" else 1
    remaining = max(0, min(settlement_cap, settlement_start + spec["settlementSeconds"]) - ops.monotonic())
    receipt["receiptWritten"] = True
    try:
        if not _emit_outcome(receipt, ops, min(settlement_cap, settlement_start + spec["settlementSeconds"]), ops.emit_receipt,
                             cancellation=cancellation):
            raise OSError("final receipt was not completely written inside settlement")
    except Exception as exc:
        error("receipt", exc)
        receipt["receiptWritten"] = False
        receipt["wrapperExitCode"] = 1
        if receipt["status"] == "passed":
            receipt["status"] = "incomplete"
    return receipt


def _run_plan(plan, context, ops, *, runner=None):
    runner = supervise if runner is None else runner
    result = {"status": "incomplete", "complete": False, "productAcceptance": False, "receipts": []}
    for spec in plan:
        if ops.cancelled():
            return result
        receipt = runner(spec, context, ops=ops)
        result["receipts"].append(receipt)
        if (receipt.get("status") != "passed" or receipt.get("wrapperExitCode") != 0
                or receipt.get("receiptWritten") is not True):
            return result
        if ops.cancelled():
            return result
    if plan and all(s.get("profile") == "bootstrap" for s in plan):
        result["complete"] = True
        result["status"] = "bootstrap-qualified"
    return result


def require_hosted():
    # The workflow's runner-label guard remains Task 3's responsibility. No local
    # --qualify path exists merely because a CLI option or product env flag is set.
    expected = {"RUNNER_ENVIRONMENT": "github-hosted", "RUNNER_OS": "macOS",
                "RUNNER_ARCH": "ARM64", "GITHUB_REPOSITORY": "arduinitavares/the-council",
                "GITHUB_REPOSITORY_VISIBILITY": "public"}
    if platform.system() != "Darwin" or platform.machine() != "arm64" or any(
            os.environ.get(k) != v for k, v in expected.items()):
        raise ValueError("real bootstrap operations require the approved public hosted macOS/arm64 VM")


class RealOps:
    """POSIX adapter for the two fixed bootstrap payloads and controller-owned fixtures."""

    def __init__(self):
        self.owned = {}
        self.bindings = {}
        self.wait_results = {}
        self.unknown_status = {}
        self.cancel_requested = False

    monotonic = staticmethod(time.monotonic)

    @staticmethod
    def timestamp():
        return datetime.now(timezone.utc).isoformat()

    def cancelled(self):
        return self.cancel_requested

    def child_status(self, process):
        # This single-threaded owner is the only reaper. Popen.poll() deliberately
        # substitutes zero for ECHILD on POSIX, so it cannot supply our raw-status
        # evidence. Never signal a child whose custody has become unobservable.
        if process in self.wait_results:
            return self.wait_results[process]
        if process in self.unknown_status:
            return None
        if process.returncode is not None:
            self.unknown_status[process] = "child was reaped outside the registered owner"
            return None
        try:
            pid, status = os.waitpid(process.pid, os.WNOHANG)
        except ChildProcessError as exc:
            self.unknown_status[process] = str(exc)
            return None
        except PermissionError as exc:
            self.unknown_status[process] = str(exc)
            raise
        if pid == 0:
            return None
        if pid != process.pid:
            self.unknown_status[process] = "conflicting child wait identity"
            return None
        code = os.waitstatus_to_exitcode(status)
        self.wait_results[process] = code
        process.returncode = code  # Prevent Popen's destructor from reaping again.
        return code

    def spawn(self, spec, ctx):
        require_hosted()
        if not _admitted(spec, ctx):
            raise ValueError("unadmitted real payload")
        if "command" in self.owned or signal.getsignal(signal.SIGCHLD) != signal.SIG_DFL:
            raise ValueError("command custody needs a fresh owner and the default SIGCHLD disposition")
        process = subprocess.Popen(spec["argv"], cwd=ctx["cwd"], env=ctx["environment"],
                                   stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, start_new_session=True, close_fds=True)
        self.register("command", process, ctx)
        handle = {"process": process, "selector": None,
                  "streams": {"stdout": process.stdout, "stderr": process.stderr}, "eof": False}
        try:
            handle["selector"] = selectors.DefaultSelector()
            for name, stream in handle["streams"].items():
                os.set_blocking(stream.fileno(), False)
                handle["selector"].register(stream, selectors.EVENT_READ, name)
        except Exception as exc:
            raise PartialSpawnError(exc, handle) from exc
        return handle

    def register(self, name, process, ctx):
        if name in self.owned:
            raise ValueError("conflicting process registration")
        self.owned[name] = process
        self.bindings[name] = (process.pid, ctx["invocation"], ctx["nonce"], ctx["assignmentHash"])

    def poll(self, handle):
        process = handle["process"]
        code = self.child_status(process)
        if process in self.unknown_status:
            return {"state": "lost", "diagnostic": self.unknown_status[process]}
        return code

    @staticmethod
    def read_output(handle, limit):
        chunks = {"stdout": b"", "stderr": b""}
        for key, _ in handle["selector"].select(0):
            try:
                data = os.read(key.fileobj.fileno(), min(32768, limit))
            except BlockingIOError:
                continue
            if data:
                chunks[key.data] = data
            else:
                handle["selector"].unregister(key.fileobj)
                key.fileobj.close()
                handle["streams"].pop(key.data)
        handle["eof"] = not handle["streams"]
        return chunks["stdout"], chunks["stderr"], handle["eof"]

    @staticmethod
    def wait(handle, seconds, phase):
        if handle is not None and handle["streams"] and handle["selector"] is not None:
            handle["selector"].select(seconds)
        else:
            select.select([], [], [], seconds)

    def targets(self, handle, ctx):
        return list(self.owned)

    def identity(self, target, ctx):
        process = self.owned.get(target)
        expected = None if process is None else (process.pid, ctx["invocation"], ctx["nonce"], ctx["assignmentHash"])
        if process is None or self.bindings.get(target) != expected:
            return {"ownership": "unbound", "state": "unknown"}
        code = self.child_status(process)
        if process in self.unknown_status:
            return {"ownership": "owned", "state": "unknown", "diagnostic": self.unknown_status[process]}
        return {"ownership": "owned", "state": "live" if code is None else "closed"}

    def signal(self, target, signum, remaining):
        process = self.owned[target]
        if self.bindings[target][0] != process.pid:
            raise ValueError("conflicting retained process identity")
        code = self.child_status(process)
        if process in self.unknown_status:
            raise ValueError("unobservable process identity; no signal permitted")
        # Between this nonblocking wait and kill there is no other reaper. A
        # child exiting in that interval retains its PID as an unreaped zombie.
        if remaining <= 0 or code is not None:
            return
        os.kill(process.pid, signum)

    @staticmethod
    def resource_state(handle, ctx, output):
        reports = [line[len(EVIDENCE_PREFIX):] for line in output["stdout"].splitlines()
                   if line.startswith(EVIDENCE_PREFIX)]
        if len(reports) != 1:
            return {"complete": False, "errors": ["missing or repeated final fixture manifest"]}
        try:
            report = json.loads(reports[0])
            if report.get("kind") != ctx["reportKind"] or report.get("sourceBundleHash") != ctx["sourceBundleHash"]:
                raise ValueError("manifest kind or source binding mismatch")
            return report
        except (ValueError, TypeError, AttributeError) as exc:
            return {"complete": False, "errors": [str(exc)]}

    @staticmethod
    def cleanup_root(registration, ctx, remaining):
        # Product crash roots have no custody bridge and are never accepted here.
        raise ValueError("only the hosted fixture owner can remove its registered bootstrap root")

    @staticmethod
    def emit_receipt(receipt, remaining):
        return write_json({"receipt": receipt}, remaining)

    @staticmethod
    def close_output(handle, remaining):
        if handle.get("outputClosed"):
            return remaining > 0
        for stream in list(handle["streams"].values()):
            stream.close()
        handle["streams"].clear()
        if handle["selector"] is not None:
            handle["selector"].close()
        handle["outputClosed"] = True
        return remaining > 0


def write_json(payload, remaining, *, prefix=""):
    """Bounded nonblocking ordinary-log write. A partial JSON line is not a receipt."""
    if remaining <= 0:
        return False
    end = time.monotonic() + remaining
    data = (prefix + json.dumps(payload, separators=(",", ":"), allow_nan=False) + "\n").encode()
    fd = sys.stdout.fileno()
    old = os.get_blocking(fd)
    try:
        os.set_blocking(fd, False)
        offset = 0
        while offset < len(data):
            left = end - time.monotonic()
            if left <= 0:
                return False
            if not select.select([], [fd], [], left)[1]:
                return False
            try:
                offset += os.write(fd, data[offset:offset + 32768])
            except BlockingIOError:
                continue
        return time.monotonic() < end
    finally:
        os.set_blocking(fd, old)


def source_files():
    paths = ("scripts/ci/offline.py", "scripts/ci/offline-contract.json", "test/ci/test_offline.py", "package-lock.json")
    return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in paths}


def bundle_hash(files):
    return hashlib.sha256(json.dumps(files, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def main(argv: list[str], *, ops: object | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["job"])
    parser.add_argument("job", choices=["checks", "diagnostics", "defaults"])
    parser.add_argument("--source", required=True)
    parser.add_argument("--root", required=True)
    parser.add_argument("--node", required=True)
    args = parser.parse_args(argv)
    try:
        contract = json.loads(CONTRACT_PATH.read_text())
        _validate_contract(contract)
        if not re.fullmatch(r"[0-9a-f]{40}", args.source):
            raise ValueError("source must be an exact commit id")
        if ops is not None:
            # Pure callers must supply every external operation; there is no
            # partial adapter that silently falls back to real spawn/write.
            return ops.bootstrap_job(args, contract)
        require_hosted()
        metadata = source_binding(os.environ, commit=args.source, job=args.job)
        files = source_files()
        if files["package-lock.json"] != contract["lockSha256"]:
            raise ValueError("lock source binding differs from accepted discovery")
        if os.environ.get("GITHUB_SHA") != args.source:
            raise ValueError("source does not match the workflow event commit")
        root = Path(args.root)
        runner_temp = Path(os.environ["RUNNER_TEMP"]).resolve()
        if not root.is_absolute() or root.parent.resolve() != runner_temp or root.exists() or root.is_symlink():
            raise ValueError("root must be a fresh exact child of RUNNER_TEMP")
        root.mkdir(mode=0o700)
        invocation = uuid.uuid4().hex
        all_ok = True
        old_handlers = {}
        active = RealOps()
        for signum in (signal.SIGTERM, signal.SIGINT):
            old_handlers[signum] = signal.signal(signum, lambda *_: setattr(active, "cancel_requested", True))
        receipts = []
        try:
            for template in command_plan(args.job, "selected", contract):
                if active.cancelled():
                    all_ok = False
                    break
                command_root = root / template["id"]
                command_root.mkdir(mode=0o700)
                for directory in (command_root / "home", command_root / "tmp"):
                    directory.mkdir(mode=0o700)
                for config in (command_root / "user.npmrc", command_root / "global.npmrc"):
                    with config.open("x"):
                        pass
                cache = root / "npm-cache"
                cache.mkdir(mode=0o700, exist_ok=True)
                nonce = uuid.uuid4().hex
                assignment = bundle_hash({"files": files, "invocation": invocation,
                                          "metadata": metadata, "job": args.job, "command": template["id"], "nonce": nonce})
                ctx = {"contract": contract, **metadata,
                       "sourceIdentity": "event SHA matched; actual checkout tree supplied by reviewed workflow",
                       "sourceFiles": files, "sourceBundleHash": bundle_hash(files),
                       "contractHash": files["scripts/ci/offline-contract.json"],
                       "lockHash": files["package-lock.json"], "invocation": invocation,
                       "nonce": nonce, "assignmentHash": assignment, "job": args.job,
                       "phase": "bootstrap", "cwd": str(ROOT), "python": sys.executable,
                       "testFile": str(ROOT / "test/ci/test_offline.py"), "commandRoot": str(command_root),
                       "requiredResources": ["pure-guard" if template["id"] == "pure" else "owned-fixtures"],
                       "reportKind": template["id"], "roots": []}
                env = command_environment(args.node, str(command_root), str(cache), offline=True)
                # These are protocol/host facts, explicitly selected, never credentials.
                for name in ("RUNNER_ENVIRONMENT", "RUNNER_OS", "RUNNER_ARCH", "GITHUB_REPOSITORY", "GITHUB_REPOSITORY_VISIBILITY"):
                    env[name] = os.environ[name]
                env.update({"COUNCIL_BOOTSTRAP_NONCE": nonce, "COUNCIL_BOOTSTRAP_ASSIGNMENT": assignment,
                            "COUNCIL_BOOTSTRAP_INVOCATION": invocation,
                            "COUNCIL_BOOTSTRAP_ROOT": str(command_root),
                            "COUNCIL_BOOTSTRAP_COMMIT": metadata["sourceCommit"],
                            "COUNCIL_BOOTSTRAP_TREE": metadata["sourceTree"],
                            "COUNCIL_BOOTSTRAP_JOB": metadata["job"],
                            "COUNCIL_BOOTSTRAP_SOURCE": ctx["sourceBundleHash"]})
                ctx["environment"] = env
                active.owned.clear()
                active.bindings.clear()
                receipt = supervise(_render(template, ctx), ctx, ops=active)
                receipts.append(receipt)
                if (receipt["status"] != "passed" or not receipt["receiptWritten"]
                        or source_files() != files):
                    all_ok = False
                    break
            if any(r.get("operation") == "receipt" for receipt in receipts for r in receipt["refusals"]):
                return 1  # Do not retry an actually refused log-write operation.
            summary = {"status": "bootstrap-qualified" if all_ok and len(receipts) == 2 and not active.cancelled() else "incomplete",
                       "productAcceptance": False, "job": args.job, "sourceCommit": args.source,
                       "sourceTree": metadata["sourceTree"], "sourceFiles": files,
                       "runtime": {"python": platform.python_version(), "os": platform.platform(),
                                   "architecture": platform.machine(), "cpuCount": os.cpu_count()}}
            written = _emit_outcome(summary, active, active.monotonic() + 1, write_json)
            return 0 if written and summary["status"] == "bootstrap-qualified" and not active.cancelled() else 1
        finally:
            for signum, handler in old_handlers.items():
                signal.signal(signum, handler)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        # Bootstrap setup failure is explicit and never enables the candidate.
        if ops is None:
            write_json({"status": "incomplete", "productAcceptance": False,
                        "operation": "bootstrap-setup", "diagnostic": str(exc)}, 1)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
