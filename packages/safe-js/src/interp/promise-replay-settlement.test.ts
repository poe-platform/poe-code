import { expect, it } from "vitest";
import { SandboxError } from "./budget.js";
import { PromiseReplay } from "./promise-replay.js";

it.each([false,true])("applies a settlement transform only at its recorded step (rejects: %s)", async rejects => {
  const replay=new PromiseReplay({version:1,steps:1,promises:1,settlements:[{id:1,step:1}]});
  let calls=0;
  const pending=replay.track(rejects?Promise.reject(7):Promise.resolve(7),value=>{calls++;return value+1;});
  const outcome=pending.then(value=>({rejects:false,value}),value=>({rejects:true,value}));
  await Promise.resolve();
  expect(calls).toBe(0);
  replay.beforeNode();
  expect(await outcome).toEqual({rejects,value:8});
  expect(calls).toBe(1);
});

it("rejects a replayed promise if its settlement transform fails", async () => {
  const replay=new PromiseReplay({version:1,steps:1,promises:1,settlements:[{id:1,step:1}]});
  const error=new TypeError("invalid shared mapping");
  const pending=replay.track(Promise.resolve(7),()=>{throw error;});
  const outcome=pending.catch(reason=>reason);
  replay.beforeNode();
  expect(await outcome).toBe(error);
});

it("does not transform a fatal replay rejection", async () => {
  const replay=new PromiseReplay({version:1,steps:1,promises:1,settlements:[{id:1,step:1}]});
  const error=new SandboxError({budget:"steps",current:2,limit:1});
  let calls=0;
  const pending=replay.track(Promise.reject(error),()=>{calls++;return 7;});
  await expect(pending).rejects.toBe(error);
  expect(calls).toBe(0);
});
