import { expect, it } from "vitest";
import { commandFromClient } from "../../src/pilot/native-command.js";
import { readFailure } from "../../src/pilot/allowance.js";

it("keeps structured nonzero native error codes without retaining account messages", async () => {
  const command = commandFromClient({run:async()=>({stdout:Buffer.from(JSON.stringify({ok:false,error:{code:"permission_denied",message:"private-account@example.test"},_meta:{runtimeId:"runtime"}})),stderr:Buffer.alloc(0),exitCode:1,signal:null,overflow:false,timedOut:false,pid:1,closed:true})},"runtime");
  try {await command(["orchestration","task-create"],"/synthetic",1000);throw Error("expected failure");}
  catch(error){expect((error as any).code).toBe("permission_denied");const diagnostic=readFailure("native boundary",error);expect(JSON.parse(diagnostic.detail).diagnostic).toEqual({class:"denial",code:"permission_denied"});expect(JSON.stringify(diagnostic)).not.toContain("private-account");}
});
it("rejects unexpected stderr on an otherwise successful native command", async () => {
  const command = commandFromClient({run:async()=>({stdout:Buffer.from(JSON.stringify({ok:true,result:{},_meta:{runtimeId:"runtime"}})),stderr:Buffer.from("unexpected diagnostic"),exitCode:0,signal:null,overflow:false,timedOut:false,pid:1,closed:true})},"runtime");
  await expect(command(["status","--json"],"/synthetic",1000)).rejects.toThrow("ORCA_CLI_DIAGNOSTICS_PRESENT");
});
