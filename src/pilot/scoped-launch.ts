import { join } from "node:path";
import { z } from "zod";
import type { ModelSelection } from "./config.js";

export const scopedLaunchPlanSchema = z.strictObject({
  method: z.literal("agent.launch"),
  source: z.string(),
  operationIdSource: z.literal("journal-before-mutation"),
  promptSubmitted: z.literal(false),
  request: z.strictObject({
    agent: z.enum(["codex", "antigravity", "cursor"]),
    target: z.strictObject({kind:z.literal("existing"),worktree:z.string()}),
    surface: z.literal("terminal"), presentation:z.literal("background"),
    sessionOptions: z.strictObject({model:z.string(),effort:z.string().optional(),permissionMode:z.literal("own")}),
    // Registered AgentLaunchFields.agentArgs is a nullable string, not argv.
    agentArgs:z.string(),cwd:z.string(),
  }),
  custody:z.literal("task-created-external"),
  adoption:z.literal("worker-start --terminal"),
  settlement:z.literal("separate-task-owned-stop-close-and-native-reconciliation-required"),
  structuredSupport:z.strictObject({state:z.enum(["verified","unknown","unsupported","missing","denied","authentication_failed","exhausted","unavailable"]),source:z.string(),detail:z.string()}),
  supportedControls:z.array(z.string()),
  pendingControls:z.array(z.string()),
});
export type ScopedLaunchPlan = z.infer<typeof scopedLaunchPlanSchema>;

/** A concrete supported launch recipe, not an admission receipt. No mutation
 * API is exposed here. Current missing effective controls and the external
 * custody/relay contract keep this candidate out of qualification and topics. */
export function scopedLaunchPlan(workspace:string, selection:ModelSelection, support:any):ScopedLaunchPlan {
  const cwd=join(workspace,".council/native-packets");
  const agentArgs=selection.route === "codex"
    ? ["--sandbox","read-only","--ask-for-approval","never","-c","approvals_reviewer=user","--disable","hooks","--disable","multi_agent","--disable","shell_tool"]
    : selection.route === "antigravity" ? ["--mode","plan","--sandbox"]
    : ["--mode","ask","--sandbox","enabled","--workspace",cwd];
  return scopedLaunchPlanSchema.parse({
    method:"agent.launch",source:"Orca agent-launch-params and exported RuntimeClient; inspected scoped-route-analysis, 2026-10-29",
    operationIdSource:"journal-before-mutation",promptSubmitted:false,
    request:{agent:selection.route,target:{kind:"existing",worktree:`path:${workspace}`},surface:"terminal",presentation:"background",
      sessionOptions:{model:selection.model,...(selection.effortEncoding === "model" ? {} : {effort:selection.effort}),permissionMode:"own"},
      agentArgs:agentArgs.map(value => "'" + value.replaceAll("'", "'\\''") + "'").join(" "),cwd},
    custody:"task-created-external",adoption:"worker-start --terminal",
    settlement:"separate-task-owned-stop-close-and-native-reconciliation-required",
    structuredSupport:support?.observation ?? {state:support?.supported === true ? "verified" : support?.supported === false ? "unsupported" : "missing",
      source:"Orca agentSession.createSupport",detail:support?.supported === false ? "Structured route unsupported; this does not deny the terminal candidate." : "Structured support does not establish scoped terminal controls."},
    supportedControls:selection.route === "codex" ? ["read-only sandbox flags","per-entry hooks/multi_agent/shell_tool disable flags"]
      : selection.route === "antigravity" ? ["plan mode flag","sandbox flag"] : ["ask mode flag","sandbox flag","explicit workspace flag"],
    pendingControls:["effective-settings-and-inherited-tools-hooks","packet-read-roots-and-protected-targets","external-terminal-settlement-and-completion-relay",
      ...(selection.route === "antigravity" ? ["custom-agent-helper-exclusion-and-workspace-trust"] : []),
      ...(selection.route === "cursor" ? ["workspace-trust","helper-exclusion","included-premium-only-spending-source"] : [])],
  });
}
