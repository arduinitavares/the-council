import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { nativeHostFixture } from "./native-host-fixture.js";

// The same launcher/input/host scenario is replayed against the untouched
// selected-baseline archive by changing only this test's package location.
const launcher = resolve(process.env.COUNCIL_TEST_PACKAGE_ROOT ?? process.cwd(), "skills/the-council/scripts/run-council.mjs");
for (const malformed of ["duplicate-key", "invalid-utf8"] as const) {
  it(`rejects ${malformed} input before reserving a run or inspecting providers`, () => {
    const host = nativeHostFixture();
    try {
      const valid = JSON.stringify({ runId: "strict-input", candidate: "JSON", suppliedText: "immutable", maxProbeCalls: 8, maxTopicCalls: 10, workerTimeoutMs: 120000, deadline: Date.now()+600000 });
      const input = join(host.workspace, "request.json");
      const invalidUtf8 = Buffer.from(valid);
      invalidUtf8[valid.indexOf("JSON")] = 0xff;
      writeFileSync(input, malformed === "duplicate-key" ? valid.replace('{', '{"runId":"overwritten",') : invalidUtf8);
      const child = spawnSync(process.execPath, [launcher,"native","--workspace",host.workspace,"--input",input,"--policy",host.policy,"--orca",host.orca], { cwd: host.workspace, encoding: "utf8", env: { ...process.env, HOME: host.home, CODEX_HOME: join(host.home,".codex"), CURSOR_CONFIG_DIR: join(host.home,".cursor"), PATH: host.bin+delimiter+process.env.PATH }, timeout: 15000 });
      expect(child.status).toBe(2);
      expect(JSON.parse(child.stdout).status).toBe("invalid_request");
      expect(existsSync(join(host.workspace,".council/native"))).toBe(false);
      expect(existsSync(join(host.root,"unexpected-inference"))).toBe(false);
    } finally { host.close(); }
  }, 20000);
}
it("preserves the recorded outcome and emits one failure if cache ownership is lost during inspection", () => {
  const host = nativeHostFixture();
  try {
    const lock = join(host.workspace, ".council/native-qualifications/writer.lock");
    writeFileSync(host.rpc, readFileSync(host.rpc, "utf8").replace("let result;", `let result; if (method === 'settings.getAgentLaunch') require('node:fs').unlinkSync(${JSON.stringify(lock)});`));
    const input = join(host.workspace, "request.json");
    writeFileSync(input, JSON.stringify({ runId: "lost-lock", candidate: "JSON", suppliedText: "immutable", maxProbeCalls: 8, maxTopicCalls: 10, workerTimeoutMs: 120000, deadline: Date.now()+600000 }));
    const child = spawnSync(process.execPath, [launcher,"native","--workspace",host.workspace,"--input",input,"--policy",host.policy,"--orca",host.orca], { cwd: host.workspace, encoding: "utf8", env: { ...process.env, HOME: host.home, CODEX_HOME: join(host.home,".codex"), CURSOR_CONFIG_DIR: join(host.home,".cursor"), PATH: host.bin+delimiter+process.env.PATH }, timeout: 15000 });
    expect(child.status).toBe(4);
    const outcome = JSON.parse(child.stdout);
    expect(outcome).toMatchObject({ status: "failed", error: "QUALIFICATION_CACHE_LOCK_OWNERSHIP_CHANGED", calls: { probes: 0, topic: 0 } });
    expect(JSON.parse(readFileSync(outcome.record, "utf8"))).toMatchObject({ status: "failed", error: outcome.error, calls: outcome.calls });
    expect(existsSync(join(host.root, "unexpected-inference"))).toBe(false);
  } finally { host.close(); }
}, 20000);
it("runs shipped native --input through real journal/cache/discovery and preserves conditional policy admission", () => {
  const host = nativeHostFixture();
  try {
    const input = join(host.workspace, "request.json");
    writeFileSync(input, JSON.stringify({runId:"first-use",candidate:"Use JSON",suppliedText:"One small immutable manifest",maxProbeCalls:8,maxTopicCalls:10,workerTimeoutMs:120000,deadline:Date.now()+600000}));
    const run = () => spawnSync(process.execPath, [launcher,"native","--workspace",host.workspace,"--input",input,"--policy",host.policy,"--orca",host.orca], {cwd:host.workspace,encoding:"utf8",env:{...process.env,HOME:host.home,CODEX_HOME:join(host.home,".codex"),CURSOR_CONFIG_DIR:join(host.home,".cursor"),PATH:host.bin+delimiter+process.env.PATH},timeout:15000});
    const child = run();
    expect(child.stderr).toBe("");
    expect(child.status).toBe(3);
    const outcome = JSON.parse(child.stdout);
    expect(outcome.status).toBe("prerequisites_not_verified");
    expect(outcome.calls).toEqual({probes:0,topic:0});
    expect(outcome.evidence).not.toBeNull();
    expect(outcome.evidence.workspace).toBe(host.workspace);
    expect(outcome.evidence.routes.find((r:any)=>r.role==='xai').policyAdmission).toEqual({state:"conditional",routeCell:"Cursor, pending host/action qualification",qualifier:"pending host/action qualification",firstUseOnly:true});
    expect(outcome.blockers.filter((b:any)=>b.control==='policy')).toEqual([]);
    expect(outcome.evidence.routes.find((r:any)=>r.role==='openai').allowance.state).toBe('unknown');
    expect(outcome.evidence.routes.find((r:any)=>r.role==='xai').allowance.state).toBe('unknown');
    expect(outcome.blockers.filter((b:any)=>b.control==='allowance')).toEqual([]);
    expect(outcome.blockers.filter((b:any)=>b.control==='billing').map((b:any)=>b.role)).toEqual(['xai']);
    expect(outcome.blockers).toContainEqual(expect.objectContaining({role:"xai",control:"controls",reason:"CONTROLS_MISSING"}));
    const saved = JSON.parse(readFileSync(outcome.record,"utf8"));
    expect(saved.calls).toEqual({probes:0,topic:0});
    const events = readFileSync(join(host.workspace,".council/native/first-use/events.jsonl"),"utf8").trim().split("\n").map(line=>JSON.parse(line).event.event);
    expect(events).toEqual(["bounds-recorded-before-inference","outcome-recorded"]);
    expect(existsSync(join(host.workspace,".council/native-qualifications/writer.lock"))).toBe(false);
    expect(existsSync(join(host.root,"unexpected-inference"))).toBe(false);
    const restart = run();
    expect(restart.status).toBe(2);
    expect(JSON.parse(restart.stdout).reason).toContain("NATIVE_RUN_EXISTS_INSPECT_REQUIRED");
  } finally { host.close(); }
},20000);

it("does not spend a run identity when a cache writer already owns the scope", () => {
  const host = nativeHostFixture();
  try {
    const cache = join(host.workspace,".council/native-qualifications");
    mkdirSync(cache,{recursive:true}); writeFileSync(join(cache,"writer.lock"),"another-owner");
    const input = join(host.workspace,"request.json");
    writeFileSync(input,JSON.stringify({runId:"busy",candidate:"JSON",suppliedText:"immutable",maxProbeCalls:8,maxTopicCalls:10,workerTimeoutMs:120000,deadline:Date.now()+600000}));
    const run = () => spawnSync(process.execPath,[launcher,"native","--workspace",host.workspace,"--input",input,"--policy",host.policy,"--orca",host.orca],{cwd:host.workspace,encoding:"utf8",env:{...process.env,HOME:host.home,CODEX_HOME:join(host.home,".codex"),CURSOR_CONFIG_DIR:join(host.home,".cursor"),PATH:host.bin+delimiter+process.env.PATH},timeout:15000});
    const child = run();
    expect(child.status).toBe(3);
    expect(JSON.parse(child.stdout)).toMatchObject({status:"prerequisites_not_verified",reason:"QUALIFICATION_CACHE_BUSY_RECONCILE",calls:{probes:0,topic:0}});
    expect(existsSync(join(host.workspace,".council/native/busy"))).toBe(false);
    expect(readFileSync(join(cache,"writer.lock"),"utf8")).toBe("another-owner");
    rmSync(join(cache,"writer.lock")); // Test owns this synthetic fixture lock.
    expect(run().status).toBe(3);
    expect(existsSync(join(host.workspace,".council/native/busy/outcome.json"))).toBe(true);
  } finally { host.close(); }
},20000);
