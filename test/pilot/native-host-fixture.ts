import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { policyTable } from "./fixtures.js";

/** Synthetic Orca 1.4.244 exported-client/CLI shapes, never a live host receipt.
 * Current-host launch controls are deliberately missing. No fake provider can
 * launch inference, and no production test/assume-ready switch is involved. */
export function nativeHostFixture(version = "1.4.244", allowance = "unknown") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "council-native-input-")));
  const workspace = join(root, "project-B");
  const home = join(root, "host-home");
  const bin = join(root, "providers");
  const orca = join(root, "Orca.app/Contents/Resources/bin/orca");
  const rpc = join(root, "Orca.app/Contents/Resources/app.asar.unpacked/out/cli/runtime-client.js");
  for (const path of [workspace, bin, dirname(orca), dirname(rpc)]) mkdirSync(path, { recursive: true });
  const policy = join(home, ".agents/policies/model-policy.md");
  mkdirSync(dirname(policy), { recursive: true });
  writeFileSync(policy, policyTable);
  const command = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2), name = path.basename(process.argv[1]);
const emit = result => console.log(JSON.stringify({ok:true,result,_meta:{runtimeId:'synthetic-runtime'}}));
if (name !== 'orca') {
  if (args[0] === '--version') console.log(name==='codex'?'codex-cli 0.164.0':name==='agy'?'1.4.11':'2026.10.22-27dcf5f');
  else if (args[0] === 'models') console.log(name === 'agy' ? 'gemini-4-argon-high' : 'grok-4.7-xhigh');
  else if (name === 'agy' && args[1] === '/usage') console.log(JSON.stringify({command:{name:'usage',data:{groups:[{name:'Gemini Models',buckets:[{remaining_fraction:0.8}]}]}},num_turns:0,conversation_id:'',usage:{total_tokens:0}}));
  else process.exit(99);
} else if (args[0] === '--version') console.log(${JSON.stringify(version)});
else if (args[0] === 'skills') console.log('{}');
else if (args[0] === 'status') emit({runtime:{state:'ready',reachable:true,appVersion:${JSON.stringify(version)},runtimeId:'synthetic-runtime',capabilities:['settings.agent-launch.v1','agent-session.coherent-model-catalog.v1','orchestration.worker-stop-verdict.v1']}});
// Real 1.4.244 agent-context is unwrapped, unlike runtime RPC receipts.
else if (args[0] === 'agent-context') console.log(JSON.stringify({schemaVersion:1,commandCount:7,commands:['worktree show','orchestration worker-start','orchestration worker-show','orchestration worker-read','orchestration worker-stop','orchestration worker-release','orchestration request-show'].map(command=>({command}))}));
else if (args[0] === 'worktree') emit({worktree:{id:'synthetic-repo::'+process.cwd(),path:process.cwd(),hostId:'synthetic-host'}});
else { fs.appendFileSync(${JSON.stringify(join(root, "unexpected-inference"))}, JSON.stringify(args)); process.exit(98); }
`;
  writeFileSync(orca, command); chmodSync(orca, 0o700);
  for (const provider of ["codex", "agy", "cursor-agent"]) { const p = join(bin, provider); writeFileSync(p, command); chmodSync(p, 0o700); }
  writeFileSync(rpc, `exports.RuntimeClient = class RuntimeClient {
    async call(method, params) {
      let result;
      if (method === 'settings.getAgentLaunch') result = {settings:{agentPermission:{default:'full-access'},agentDefaultArgs:{}}};
      else if (method === 'accounts.list') {
        if (${JSON.stringify(allowance)} === 'denied') return {ok:false,error:{code:'permission_denied'},_meta:{runtimeId:'synthetic-runtime'}};
        result = {rateLimits:Object.fromEntries(['codex','cursor'].map(provider=>[provider,{provider,status:'ok',updatedAt:Date.now(),session:null,weekly:provider==='codex' && ${JSON.stringify(allowance)}!=='unknown' ? {usedPercent:${allowance === "exhausted" ? 100 : 60},windowMinutes:10080,resetsAt:Date.now()+3600000}:null,monthly:provider==='cursor' && ${JSON.stringify(allowance)}!=='unknown' ? {usedPercent:${allowance === "exhausted" ? 100 : 20},windowMinutes:10080,resetsAt:Date.now()+3600000}:null,planType:provider==='cursor'?'premium':undefined}]))};
        if (${JSON.stringify(allowance)} === 'missing') result = {rateLimits:{}};
      }
      else if (method === 'agentSession.createSupport') result = {agent:params.agent,supported:params.agent!=='cursor',reason:params.agent==='cursor'?'agent':undefined};
      else if (method === 'agentSession.modelCatalog') result = {models:params.agent === 'codex' ? [{id:'gpt-6.1-sol',efforts:[{value:'max'}]},{id:'gpt-6-astra',efforts:[{value:'max'}]}] : params.agent === 'antigravity' ? [{id:'gemini-4-argon-high',efforts:[{value:'high'}]}] : [{id:'grok-4.7-xhigh',efforts:[]}]};
      else throw Error('Unexpected registered read '+method);
      return {ok:true,result,_meta:{runtimeId:'synthetic-runtime'}};
    }
  };
`);
  return { root, workspace, home, orca, rpc, bin, policy, close: () => rmSync(root, { recursive: true, force: true }) };
}
