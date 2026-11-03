// Independent emergency custody. This process never supplies input or cancellation.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const [directory, assignmentHash, nonce, parentText] = process.argv.slice(2);
const parentPid = Number(parentText);
const reportFile = path.join(directory, "watchdog.json");
let owned, busy = false;
const timers = new Set();
const report = { assignmentHash, nonce, parentPid, pid: process.pid, fired: false, settled: false, custodyVerified: false };
function rows() {
  if (!owned) return [];
  return execFileSync("ps", ["-p", [owned.providerPid, owned.descendantPid].filter(Boolean).join(","), "-o", "pid=,ppid=,pgid=,lstart="],
    { timeout: 500, encoding: "utf8" }).trim().split("\n").filter(Boolean).map(line => {
      const row = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/);
      if (!row) throw Error("WATCHDOG_PROCESS_IDENTITY_UNVERIFIED");
      return [Number(row[1]), Number(row[2]), Number(row[3]), row[4]];
    });
}
function census() {
  try { return rows(); }
  catch (cause) { if (cause.status === 1 && !String(cause.stdout).trim()) return []; throw cause; }
}
function bind() {
  const receiptFile = path.join(directory, "initialization-started.json");
  const manifestFile = path.join(directory, "fixture-manifest.json");
  if (!fs.existsSync(receiptFile) || !fs.existsSync(manifestFile)) return false;
  const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  if (manifest.assignmentHash !== assignmentHash || manifest.nonce !== nonce || manifest.parentPid !== parentPid ||
      receipt.assignmentHash !== assignmentHash || receipt.pid !== manifest.providerPid || receipt.initializations !== 1 ||
      !Number.isSafeInteger(manifest.providerPid) || manifest.providerPid <= 1 || manifest.group !== manifest.providerPid ||
      (manifest.descendantPid !== null && (!Number.isSafeInteger(manifest.descendantPid) || manifest.descendantPid <= 1)))
    throw Error("WATCHDOG_OWNERSHIP_CONFLICT");
  owned = manifest;
  const live = census();
  const provider = live.find(row => row[0] === owned.providerPid);
  const descendant = live.find(row => row[0] === owned.descendantPid);
  if (provider && (provider[1] !== parentPid || provider[2] !== owned.group)) throw Error("WATCHDOG_PROVIDER_UNBOUND");
  if (descendant && (!provider || descendant[1] !== owned.providerPid || descendant[2] !== owned.group)) throw Error("WATCHDOG_DESCENDANT_UNBOUND");
  if ((owned.descendantPid !== null && provider && !descendant)) return false;
  report.custodyVerified = true;
  report.providerPid = owned.providerPid; report.descendantPid = owned.descendantPid; report.group = owned.group;
  report.providerBirth = provider?.[3] ?? null; report.descendantBirth = descendant?.[3] ?? null;
  return true;
}
function groupAbsent() {
  try { process.kill(-owned.group, 0); return false; }
  catch (cause) { if (cause.code === "ESRCH") return true; throw cause; }
}
function settled() { return census().length === 0 && groupAbsent(); }
function save() { fs.writeFileSync(reportFile, JSON.stringify(report)); }
function done(error) {
  if (error) report.error = String(error.message || error);
  for (const timer of timers) { clearTimeout(timer); clearInterval(timer); }
  save();
  if (process.connected) process.send({ type: "settled", report }, () => { if (process.connected) process.disconnect(); });
  process.exitCode = error ? 1 : 0;
}
async function finish(emergency, reason) {
  if (busy) return; busy = true;
  try {
    if (emergency) { report.fired = true; report.reason = reason; save(); }
    const until = performance.now()+1000;
    while (!report.custodyVerified && performance.now() < until) {
      if (bind()) break;
      await new Promise(resolve => { const timer = setTimeout(() => { timers.delete(timer); resolve(); }, 10); timers.add(timer); });
    }
    if (!report.custodyVerified) throw Error("WATCHDOG_CUSTODY_UNVERIFIED");
    if (emergency && !settled()) {
      const live = census();
      const provider = live.find(row => row[0] === owned.providerPid);
      const descendant = live.find(row => row[0] === owned.descendantPid);
      const parentLost = reason === "parent-loss" || reason === "parent-disconnect";
      if ((!provider && !descendant) ||
          (provider && ((!parentLost && provider[1] !== parentPid) || provider[2] !== owned.group || provider[3] !== report.providerBirth)) ||
          (descendant && (descendant[2] !== owned.group || descendant[3] !== report.descendantBirth || (provider && descendant[1] !== owned.providerPid))))
        throw Error("WATCHDOG_CURRENT_IDENTITY_CONFLICT");
      // Signal only the group whose provider and descendant relationship was verified.
      process.kill(-owned.group, "SIGKILL"); report.signal = "SIGKILL";
    }
    const stopUntil = performance.now()+1000;
    while (!settled() && performance.now() < stopUntil) await new Promise(resolve => {
      const timer = setTimeout(() => { timers.delete(timer); resolve(); }, 10); timers.add(timer);
    });
    report.settled = settled();
    if (!report.settled) throw Error("WATCHDOG_SETTLEMENT_UNVERIFIED");
    done();
  } catch (cause) { done(cause); }
}
timers.add(setTimeout(() => finish(true, "expiry"), 8000));
timers.add(setInterval(() => {
  if (busy) return;
  try {
    if (!report.custodyVerified) bind();
    process.kill(parentPid, 0);
  } catch (cause) {
    if (cause.code === "ESRCH") finish(true, "parent-loss"); else { busy = true; done(cause); }
  }
}, 10));
process.on("message", message => {
  if (message?.nonce !== nonce) { busy = true; done(Error("WATCHDOG_IPC_UNBOUND")); return; }
  if (message.type === "disarm") finish(false, "disarm");
  if (message.type === "cleanup") finish(true, "failure-cleanup");
});
process.on("disconnect", () => { if (!busy) finish(true, "parent-disconnect"); });
process.send({ type: "armed", nonce });
