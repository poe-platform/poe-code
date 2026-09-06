import { expect, it } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { createBuiltinBindings } from "../globals.js";
import { getIntrinsicIdentity } from "../intrinsics.js";
import { releaseObjectPrototype } from "../object-model.js";
import { validateGuestHeapNode } from "../../snapshot/guest-heap-validation.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

it.each([{name:"parse",length:2},{name:"stringify",length:3},{name:"rawJSON",length:1},{name:"isRawJSON",length:1}])(
  "exposes JSON.$name metadata", async ({name,length}) => {
    const result=await run(`const fn=JSON.${name};const descriptor=Object.getOwnPropertyDescriptor(fn,"name");return [fn.name,fn.length,descriptor]`);
    expect(result.returnValue).toEqual([name,length,{value:name,writable:false,enumerable:false,configurable:true}]);
  }
);

it.each(["parse","stringify","rawJSON","isRawJSON"])("allows ordinary metadata changes on JSON.%s",async name=>{
  const result=await run(`try{const fn=JSON.${name};Object.defineProperty(fn,"name",{value:"changed",configurable:true});fn.extra=7;return [fn.name,fn.extra]}catch(error){return error.name}`);
  expect(result.returnValue).toEqual(["changed",7]);
});

it.each(["parse","stringify","rawJSON","isRawJSON"])("keeps JSON.%s checkpoint identities stable",name=>{
  const budget=new Budget();
  try {
    const globals=createBuiltinBindings({budget});
    const json=globals.JSON as Record<string,object>;
    const id=JSON.stringify(["JSON",name]);
    expect(getIntrinsicIdentity(json[name])).toBe(id);
    expect(validateGuestHeapNode({kind:"intrinsic",id},{})).toBe(true);
  } finally {releaseObjectPrototype(budget);}
});

it.each(["parse","stringify","rawJSON","isRawJSON"].flatMap(name=>["pending","completed"].map(mode=>({name,mode}))))(
  "preserves JSON.$name metadata in $mode checkpoints",async ({name,mode})=>{
    const source=`const fn=JSON.${name};Object.defineProperty(fn,"name",{value:"changed",configurable:true});fn.extra=7;await 0;return [fn===JSON.${name},fn.name,fn.extra]`;
    const pending=run(source);
    const completed=pending.catch(error=>error);
    try {
      if(mode==="completed")await completed;
      const snapshot=restore(JSON.parse(await dump(pending)),{source});
      const result=await completed;
      expect(result).toMatchObject({ok:true,returnValue:[true,"changed",7]});
      expect(await run(source,{snapshot})).toMatchObject({ok:true,returnValue:[true,"changed",7]});
      expect(await run(source,{snapshot:result.snapshot})).toMatchObject({ok:true,returnValue:[true,"changed",7]});
    } finally {await completed;}
  }
);

it("does not trust a caller-forged runtime snapshot wrapper",async()=>{
  const source='JSON.parse.extra=7;await 0;return JSON.parse.extra';
  const result=await run(source);
  expect(()=>restore({...result.snapshot},{source})).toThrow(expect.objectContaining({code:"invalidState"}));
  expect(restore(result.snapshot,{source})).toHaveProperty("heap");
});

it("keeps normalized runtime snapshots protected against concurrent resume",async()=>{
  const source='JSON.parse.extra=7;await 0;return JSON.parse.extra';
  const result=await run(source);
  const first=run(source,{snapshot:result.snapshot});
  const settled=first.catch(error=>error);
  try {
    await expect(run(source,{snapshot:result.snapshot})).rejects.toMatchObject({code:"reentry"});
    expect(await settled).toMatchObject({ok:true,returnValue:7});
  } finally {await settled;}
});
