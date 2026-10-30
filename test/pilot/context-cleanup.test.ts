import { it, expect } from "vitest";
import { createNativePilotDriver } from "../../dist/pilot/composition.js";
import { contextFixture } from "./context-fixture.js";
import type { ScopedMethod } from "../../src/pilot/rpc.js";
import { incidentRoster } from "./fixtures.js";
for (const failure of ["connected", "generic-missing", "permission-denied", "foreign-incarnation", "uncertain-close"]) {
  it(`does not promote ${failure} to cleanup or duplicate close`,async()=>{
    const h=await contextFixture();let closes=0;
    try{
      const rpc={callScoped:async(method:ScopedMethod,parameters:any)=>{
        if(method==="terminal.show"){
          const shown=await h.rpc.callScoped(method,parameters);
          if(shown.terminal.connected===false){if(failure==="connected")shown.terminal.connected=true;if(failure==="foreign-incarnation")shown.terminal.incarnationId="foreign";}
          return shown;
        }
        if(method==="terminal.inspectProcess"&&["generic-missing","permission-denied"].includes(failure))throw Object.assign(Error("no receipt"),{code:failure==="permission-denied"?"permission_denied":"host_status_unavailable"});
        if(method==="terminal.close"){closes++;const closed=await h.rpc.callScoped(method,parameters);if(failure==="uncertain-close")throw Object.assign(Error("lost close reply"),{code:"ETIMEDOUT"});return closed;}
        return h.rpc.callScoped(method,parameters);
      }};
      const driver=createNativePilotDriver({command:h.command,inspector:{inspect:async()=>({evidence:h.evidence,blockers:[]})},rpc:()=>rpc,orca:h.orca,record:e=>h.events.push(e)});
      const request={workspace:h.workspace,config:incidentRoster,policyPath:"/synthetic",candidate:"JSON",suppliedText:"manifest",maxProbeCalls:8,maxTopicCalls:10,workerTimeoutMs:5000,deadline:Date.now()+30000,proofs:[]};
      await driver.inspect(request);const run=await driver.begin(request);const a=await driver.launch(run,request,"gemini","normal-probe","fixture",failure);
      await driver.observe(a,Date.now()+5000);
      expect(await driver.release(a,Date.now()+500)).toBe(false);expect(driver.proof!(a)).toBeNull();
      expect(await driver.release(a,Date.now()+500)).toBe(false);
      expect(closes).toBe(failure==="uncertain-close"?1:0);
    }finally{await h.close();}
  },15000);
}
