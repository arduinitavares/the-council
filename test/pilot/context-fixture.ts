import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { codexKernel } from "../../src/pilot/codex-controls.js";
import { incidentRoster } from "./fixtures.js";
import { nativeCommand } from "../../src/pilot/native-command.js";
import { commandFromClient } from "../../src/pilot/native-command.js";
import { OrcaClient } from "../../src/orca/client.js";
import type { NativeEvidence } from "../../src/pilot/types.js";
import type { ScopedRpc } from "../../src/pilot/rpc.js";
const { codexFixtureConfiguration } = createRequire(import.meta.url)("./fixtures/context-provider.cjs");

/** Stateful native boundary stand-in: completion is accepted only from the
 * exact spawned wrapper's terminal context, and durable Task.result is real
 * fixture state rather than an unconditional completed object. */
export async function contextFixture(behavior = "normal", legacyExitAbi = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "council-context-")));
  const workspace = join(root, "project-B"); mkdirSync(workspace);
  const state = join(root, "native-state.json"); writeFileSync(state, JSON.stringify({tasks:[],dispatches:[],events:[]}));
  const orca = join(root, "orca");
  writeFileSync(orca, `#!${process.execPath}
const fs=require('node:fs');const argv=process.argv.slice(2);const file=${JSON.stringify(state)};
const read=()=>JSON.parse(fs.readFileSync(file,'utf8'));const val=flag=>argv[argv.indexOf(flag)+1];
const emit=result=>console.log(JSON.stringify({id:'synthetic',ok:true,result,_meta:{runtimeId:'synthetic-runtime'}}));
const fail=()=>{console.log(JSON.stringify({id:'synthetic',ok:false,error:{code:'permission_denied'},_meta:{runtimeId:'synthetic-runtime'}}));process.exit(1);};
if(argv[0]==='--version'){console.log('1.4.244');process.exit(0);}if(argv[0]==='skills'){console.log('{}');process.exit(0);}
const s=read();const save=()=>{fs.writeFileSync(file+'.pending',JSON.stringify(s));fs.renameSync(file+'.pending',file);};
const verb=argv[1];
const coordinatorIdentity={handle:'fixture-coordinator',worktreeId:'synthetic-repo::B',worktreePath:s.coordinatorWorkspace||${JSON.stringify(workspace)},ptyId:'synthetic-repo::B@@coordinator-pty',incarnationId:s.coordinatorIncarnation||'coordinator-incarnation',tabId:'fixture',leafId:'coordinator-pane'};
if(argv[0]==='terminal'&&verb==='show'){emit({terminal:coordinatorIdentity});process.exit(0);}
if(argv[0]==='worktree'&&verb==='show'){emit({worktree:{id:'synthetic-repo::B',path:${JSON.stringify(workspace)}}});process.exit(0);}
if(['run-create','task-create','dispatch'].includes(verb)&&process.env.ORCA_TERMINAL_HANDLE!=='fixture-coordinator')fail();
if(verb==='run-create'){s.runs=(s.runs||0)+1;const run={id:'synthetic-run-'+s.runs,coordinator_handle:process.env.ORCA_TERMINAL_HANDLE,consumer_generation:1,legacy:0};s.runRecords=[...(s.runRecords||[]),run];save();emit({run});process.exit(0);}if(verb==='run-show'){emit({run:(s.runRecords||[]).find(r=>r.id===val('--id'))});process.exit(0);}
if(verb==='task-create'){const task={id:'task-'+(s.tasks.length+1),run_id:val('--run'),parent_id:null,spec:val('--spec'),created_by_terminal_handle:'fixture-coordinator',created_by_pane_key:'fixture:coordinator-pane',created_by_process_incarnation:'synthetic-repo::B@@coordinator-pty:coordinator-incarnation',created_by_run_generation:s.runRecords.find(r=>r.id===val('--run')).consumer_generation,status:'ready',result:null};s.tasks.push(task);save();emit({task});}
else if(verb==='dispatch'){if(argv.includes('--inject'))fail();const task=s.tasks.find(t=>t.id===val('--task'));const handle=val('--to');const number=handle.split('-').pop();const dispatch={id:'dispatch-'+number,task_id:task.id,run_id:val('--run'),assignee_handle:handle,assignee_pane_key:handle==='fixture-coordinator'?'fixture:coordinator-pane':'tab:'+number,process_incarnation:handle==='fixture-coordinator'?'synthetic-repo::B@@coordinator-pty:coordinator-incarnation':'opaque-process-'+number,creator_handle:'fixture-coordinator',creator_pane_key:'fixture:coordinator-pane',creator_dispatch_id:null,retry_of_dispatch_id:null,termination_reason:null,depth:1,failure_count:0,consumer_generation:0,status:'dispatched'};task.status='dispatched';s.dispatches.push(dispatch);save();emit({dispatch,injected:false});}
else if(verb==='dispatch-show'){emit({dispatch:s.dispatches.find(d=>d.task_id===val('--task'))});}
else if(verb==='task-list'){emit({tasks:s.tasks.filter(t=>t.run_id===val('--run'))});}
else if(verb==='send'){const d=s.dispatches.find(d=>d.id===val('--dispatch-id'));if(!d||process.env.ORCA_TERMINAL_HANDLE!==d.assignee_handle||process.env.ORCA_PANE_KEY!==d.assignee_pane_key||d.task_id!==val('--task-id')||d.run_id!==val('--run')||d.status!=='dispatched')fail();const task=s.tasks.find(t=>t.id===d.task_id);const success=val('--outcome')==='succeeded';task.status=success?'completed':'failed';d.status=task.status;task.result=JSON.stringify({provenance:'worker_report',outcome:val('--outcome'),messageId:'message-'+d.id,reportedBy:process.env.ORCA_TERMINAL_HANDLE,completedBy:process.env.ORCA_TERMINAL_HANDLE,body:val('--body'),reportPath:val('--report-path'),completedAt:Date.now()});save();emit({lifecycle:{action:success?'completed':'failed',taskId:task.id,dispatchId:d.id}});}
else fail();
`); chmodSync(orca, 0o700);
  const command = commandFromClient(await OrcaClient.connect({ executable: orca, cwd: workspace, environment: { ...process.env, ORCA_TERMINAL_HANDLE: "fixture-coordinator", ORCA_PANE_KEY: "fixture:coordinator-pane" } }));
  const terminals = new Map<string, { child: ReturnType<typeof spawn>; identity: any; closed: boolean }>();
  const events: any[] = [];
  const rpc: ScopedRpc = { callScoped: async (method, parameters) => {
    events.push({ method, parameters });
    if (method === "terminal.create") {
      const number = terminals.size+1;
      const identity = { handle: `terminal-${number}`, worktreeId: "synthetic-repo::B", ptyId: `pty-${number}`, incarnationId: `incarnation-${number}`, tabId: "tab", leafId: String(number), paneKey: `tab:${number}` };
      const env: NodeJS.ProcessEnv = { ...process.env, ORCA_TERMINAL_HANDLE: identity.handle, ORCA_PANE_KEY: identity.paneKey };
      for (const key of parameters.envToDelete as string[]) delete env[key];
      const child = spawn("/bin/sh", ["-c", parameters.command as string], { cwd: parameters.cwd as string, env, stdio: ["ignore", "pipe", "pipe"] });
      let diagnostic = ""; child.stderr!.on("data", bytes => { diagnostic += bytes.toString(); });
      child.once("close", () => { if(diagnostic)events.push({diagnostic}); });
      terminals.set(identity.handle, { child, identity, closed: false });
      return { terminal: identity };
    }
    const entry = terminals.get(parameters.terminal as string)!;
    if (method === "terminal.show") return { terminal: { ...entry.identity, connected: entry.child.exitCode === null, writable: entry.child.exitCode === null, ...(entry.child.exitCode !== null ? { exitCause: { kind: "unknown", reason: "host_status_unavailable" } } : {}) } };
    if (parameters.expectedIncarnationId !== entry.identity.incarnationId) throw Error("terminal replaced");
    if (method === "terminal.inspectProcess" && entry.child.exitCode !== null && !legacyExitAbi) throw Object.assign(Error("terminal_gone"), { code: "terminal_gone" });
    if (method === "terminal.inspectProcess") return { process: { verdict: entry.child.exitCode === null ? "live" : "exited", hasChildProcesses: entry.child.exitCode === null, childProcessEvidence: entry.child.exitCode === null ? "children" : "no-children" } };
    if (method === "terminal.close") { if(entry.child.exitCode===null)throw Error("wrapper still live");entry.closed=true;return {close:{handle:entry.identity.handle,ptyKilled:true}}; }
    throw Error("Unexpected native boundary");
  } };
  const observation = { state: "verified" as const, source: "synthetic external boundary fixture", detail: "Credential-free software regression; not route qualification" };
  const evidence: NativeEvidence = { host: "synthetic-host", runtimeId: "synthetic-runtime", orcaVersion: "1.4.244", versions: { orca: "1.4.244", codex: "synthetic", antigravity: "synthetic", cursor: "synthetic" },
    roots: [workspace], workspace, workspaceId: "synthetic-repo::B", action: "supplied-packet-read-only", policyHash: "synthetic-policy", controlsHash: "synthetic-controls",
    routes: [...Object.entries(incidentRoster.reviewers), ["judge", incidentRoster.judge]].map(([role, selection]: any) => ({ role, selection, version: "synthetic", catalog: observation, controls: observation, bootstrap: observation, allowance: { ...observation, state: "unknown" }, billing: observation, optionalTelemetry: { ...observation, state: "unknown" },
      recipe: { protocol: selection.route === "codex" ? "codex-app-server" : selection.route === "cursor" ? "cursor-stream" : "agy-stream", executable: process.execPath,
        argv: [resolve("test/pilot/fixtures/context-provider.cjs"), selection.route === "codex" ? "codex-app-server" : selection.route === "cursor" ? "cursor-stream" : "agy-stream", selection.model, behavior, ...(selection.route === "codex" ? ["", ...codexKernel(behavior === "configured-startup" ? [codexFixtureConfiguration] : [],join(workspace,".council/native-packets"),selection.model,selection.effort).argv] : [])], cwd: join(workspace, ".council/native-packets"), version: "synthetic", selection, expectedPermission: "request-review", sources: [], facts: [{ name: "synthetic-enforcement-boundary", stage: "bootstrap", observation, enforcement: "Credential-free deterministic process fixture", observedAt: Date.now(), digest: "synthetic" }],
        ...(selection.route === "codex" ? { codexPolicy: {name:"council_packet",filesystem:{[join(workspace,".council/native-packets")]:"read"}, featureKeys:["hooks","apps","plugins","multi_agent","multi_agent_v2","shell_tool","view_image","request_permissions_tool","image_generation","code_mode","code_mode_only","code_mode_host","browser_use","computer_use","memories","external_agent_memory_import","standalone_web_search","shell_snapshot","shell_snapshot_v2","recommended_plugins","remote_plugin","skill_search"]} } : {}) } })) };
  return { root, workspace, orca, command, rpc, evidence, events, terminals, state,
    close: async () => { for(const entry of terminals.values())if(entry.child.exitCode===null){entry.child.kill("SIGKILL");await new Promise(resolve=>entry.child.once("close",resolve));} rmSync(root,{recursive:true,force:true}); } };
}
