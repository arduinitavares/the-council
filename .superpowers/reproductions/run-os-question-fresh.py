#!/usr/bin/env python3
"""Prepare a fresh OS-question request; --run then invokes the Council CLI."""
import argparse
import datetime
import json
import os
from pathlib import Path
import shlex
import time
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--run", action="store_true", help="run the newly prepared request")
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
template = repo / ".superpowers/sdd/2026-10-31-gemini-enrollment/council-after/request.json"
request = json.loads(template.read_text())
stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
request["runId"] = f"os-question-{stamp}-{uuid.uuid4().hex[:12]}"
request["deadline"] = int(time.time() * 1000) + 15 * 60 * 1000
folder = repo / ".superpowers/reproductions" / request["runId"]
folder.mkdir(mode=0o700)
input_path = folder / "request.json"
fd = os.open(input_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as stream:
    json.dump(request, stream, indent=2)
    stream.write("\n")
command = [
    "/opt/homebrew/opt/node@22/bin/node",
    str(repo / "skills/the-council/scripts/run-council.mjs"), "native",
    "--workspace", str(repo),
    "--input", str(input_path),
    "--policy", "/Users/aaat/.agents/policies/model-policy.md",
    "--orca", "/usr/local/bin/orca",
    "--config", str(repo / "skills/the-council/references/first-use-roster.yaml"),
    "--json",
]
print(json.dumps({"request": str(input_path), "runId": request["runId"],
                  "deadline": request["deadline"], "command": shlex.join(command),
                  "executionRequested": args.run}), flush=True)
if args.run:
    os.chdir(repo)
    os.execv(command[0], command)
