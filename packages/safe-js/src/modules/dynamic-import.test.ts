import { expect, it, vi } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";
import { Budget } from "../interp/budget.js";
import { createRealm } from "../realm.js";

it.each([
  ["return (await import('fixture')).value", 7],
  ["try{import((()=>{throw 7})())}catch(error){return error}", 7],
  ["return (await import('fixture',)).value", 7],
  ["return (await import('fixture',undefined)).value", 7],
  ["let pending;try{pending=import('fixture',null)}catch(error){return 'synchronous'}try{await pending}catch(error){return error.name}", "TypeError"],
  ["const events=[];const key={toString(){events.push('coerce');return 'fixture'}};await import(key,(events.push('options'),undefined));return events", ["options","coerce"]],
  ["const pending=import('fixture');return typeof pending.then", "function"],
  ["import * as fixed from 'fixture';return fixed===await import('fixture')", true],
  ["return (await import('fixture'))===(await import('fixture'))", true],
  ["return (await import({toString(){return 'fixture'}})).value", 7],
  ["let pending;try{pending=import({toString(){throw 7}})}catch(error){return 'synchronous'}try{await pending}catch(error){return error}", 7],
  ["let pending;try{pending=import('missing')}catch(error){return 'synchronous'}try{await pending}catch(error){return true}", true],
  ["const key=await Promise.resolve('fixture');return (await import(key)).value", 7],
  ["const namespace=await import('fixture');try{namespace.value=9}catch(error){return [error.name,namespace.value]}", ["TypeError",7]]
] as const)("imports registered modules dynamically: %s", async (source, expected) => {
  expect(await run(source,{modules:{fixture:{value:7}}})).toMatchObject({ok:true,returnValue:expected});
});

it("assimilates an exported then function through the import promise", async () => {
  const result = await run("return await import('fixture')", {
    modules:{fixture:{then:(resolve:(value:number)=>void)=>resolve(7)}}
  });
  expect(result).toMatchObject({ok:true,returnValue:7});
});

it("runs an exported then function after the importing statement", async () => {
  const events: string[]=[];
  const result=await run("const pending=import('fixture');mark('after');return await pending",{
    bindings:{mark:(event:string)=>{events.push(event);}},
    modules:{fixture:{then:(resolve:(value:number)=>void)=>{events.push("then");resolve(7);}}}
  });
  expect(result).toMatchObject({ok:true,returnValue:7});
  expect(events).toEqual(["after","then"]);
});

it.each([
  ["return (await import('fixture',{with:{}})).value", 7],
  ["return (await import('fixture',()=>{})).value", 7],
  ["try{await import('fixture',{with:null})}catch(error){return error.name}", "TypeError"],
  ["try{await import('fixture',{with:{type:'json'}})}catch(error){return error.name}", "TypeError"],
  ["const events=[];try{await import('fixture',{with:{get first(){events.push(1);return 1},get second(){events.push(2);return 'x'}}})}catch(error){return [error.name,events]}", ["TypeError",[1,2]]],
  ["return (await import('fixture',{with:{[Symbol()]:7}})).value", 7],
  ["let pending;try{pending=import('fixture',{get with(){throw 7}})}catch(error){return 'synchronous'}try{await pending}catch(error){return error}", 7],
  ["try{import('fixture',(()=>{throw 7})())}catch(error){return error}", 7]
] as const)("validates import options: %s", async (source, expected) => {
  expect(await run(source,{modules:{fixture:{value:7}}})).toMatchObject({ok:true,returnValue:expected});
});

it("replays dynamic namespace inputs without repeating host calls", async () => {
  const read=vi.fn(async (value:number)=>value+10);
  const source="const first=await import('fixture');const second=await import('fixture');first.data.count++;const value=await first.read(first.data.count);return [first===second,first.data.count,value]";
  const original=await run(source,{modules:{fixture:{data:{count:0},read}}});
  const expected={ok:true,returnValue:[true,1,11]};
  expect(original).toMatchObject(expected);
  let snapshot=restore(JSON.parse(await dump(original)),{source});
  const replacement=vi.fn(async ()=>99);
  for(let repeat=0;repeat<3;repeat++) {
    const resumed=await run(source,{snapshot,modules:{fixture:{read:replacement}}});
    expect(resumed).toMatchObject(expected);
    snapshot=restore(JSON.parse(await dump(resumed)),{source});
  }
  expect(read).toHaveBeenCalledOnce();
  expect(replacement).not.toHaveBeenCalled();
});

it("preserves static and dynamic namespace aliases during public replay", async () => {
  const source="import * as fixed from 'fixture';fixed.data.count++;const loaded=await import('fixture');return [fixed===loaded,loaded.data.count]";
  const original=await run(source,{modules:{fixture:{data:{count:0}}}});
  expect(original).toMatchObject({ok:true,returnValue:[true,1]});
  const snapshot=restore(JSON.parse(await dump(original)),{source});
  expect(await run(source,{snapshot,modules:{fixture:{data:{count:99}}}}))
    .toMatchObject({ok:true,returnValue:[true,1]});
});

it.each([false,true])("does not require unused static exports for replay (unrelated dynamic import=%s)", async dynamic => {
  const source=`import {read} from 'fixture';const value=await read();${dynamic ? "await import('other');" : ""}return value`;
  const read=vi.fn(async ()=>7);
  const original=await run(source,{modules:{fixture:{read,unused:()=>99},other:{value:1}}});
  expect(original).toMatchObject({ok:true,returnValue:7});
  const snapshot=restore(JSON.parse(await dump(original)),{source});
  const replacement=vi.fn(async ()=>99);
  expect(await run(source,{snapshot,modules:{fixture:{read:replacement},other:{value:1}}}))
    .toMatchObject({ok:true,returnValue:7});
  expect(read).toHaveBeenCalledOnce();
  expect(replacement).not.toHaveBeenCalled();
});

it("preserves named-import aliases after mutation before dynamic loading", async () => {
  const source="import {data} from 'fixture';data.count++;const namespace=await import('fixture');return [data===namespace.data,data===namespace.alias,data.count]";
  const data={count:0};
  const original=await run(source,{modules:{fixture:{data,alias:data}}});
  const expected={ok:true,returnValue:[true,true,1]};
  expect(original).toMatchObject(expected);
  const snapshot=restore(JSON.parse(await dump(original)),{source});
  expect(await run(source,{snapshot})).toMatchObject(expected);
});

it.each([false,true])("replays captured data without a replacement registry (static=%s)", async staticImport => {
  const source=`${staticImport ? "import * as fixed from 'fixture';" : ""}return (await import('fixture')).value`;
  const original=await run(source,{modules:{fixture:{value:7}}});
  expect(original).toMatchObject({ok:true,returnValue:7});
  const snapshot=restore(JSON.parse(await dump(original)),{source});
  expect(await run(source,{snapshot})).toMatchObject({ok:true,returnValue:7});
});

it("replays promises exported by a dynamically loaded module", async () => {
  const source="return await (await import('fixture')).pending";
  const original=await run(source,{modules:{fixture:{pending:Promise.resolve(7)}}});
  expect(original).toMatchObject({ok:true,returnValue:7});
  const snapshot=restore(JSON.parse(await dump(original)),{source});
  expect(await run(source,{snapshot})).toMatchObject({ok:true,returnValue:7});
});

it("accounts for the preserved input after guest mutation removes its live data", async () => {
  const budget=new Budget();
  const size=10_000;
  const result=await run("const loaded=await import('fixture');loaded.data.text='';return usage()",{
    budget,bindings:{usage:()=>budget.currentDataSize},modules:{fixture:{data:{text:"x".repeat(size)}}}
  });
  expect(result.ok).toBe(true);
  expect(result.returnValue).toBeGreaterThanOrEqual(size);
});

it("recovers a bounded checkpoint without repeating a dynamic module host call", async () => {
  const read=vi.fn(async ()=>7);
  const source="const namespace=await import('fixture');const value=await namespace.read();let sum=0;for(let index=0;index<50;index++)sum+=index;return [namespace===await import('fixture'),value,sum]";
  const modules={fixture:{read}};
  const execution=run(source,{modules,budget:new Budget({maxSteps:100})});
  await expect(execution).rejects.toMatchObject({code:"budgetExceeded",budget:"steps"});
  const snapshot=restore(JSON.parse(await dump(execution,{onFailure:"checkpoint"})),{source});
  expect(await run(source,{modules,snapshot,budget:new Budget({maxSteps:5_000})}))
    .toMatchObject({ok:true,returnValue:[true,7,1225]});
  expect(read).toHaveBeenCalledOnce();
});

it("shares static and dynamic namespaces across persistent realm evaluations", async () => {
  const realm=createRealm({modules:{fixture:{data:{count:0}}}});
  try {
    expect(await realm.evaluate("const first=await import('fixture');first.data.count++;"))
      .toMatchObject({ok:true});
    expect(await realm.evaluate("import * as fixed from 'fixture';return [first===fixed,first===await import('fixture'),fixed.data.count]"))
      .toMatchObject({ok:true,returnValue:[true,true,1]});
  } finally { await realm.close(); }
});

it("does not traverse exports of an unused module", async () => {
  const read=vi.fn(()=>7);
  const unused={data:Object.defineProperty({},"value",{enumerable:true,get:read})};
  expect(await run("return (await import('fixture')).value",{modules:{fixture:{value:7},unused}}))
    .toMatchObject({ok:true,returnValue:7});
  expect(read).not.toHaveBeenCalled();
});

it("does not expose a native loader for unregistered module names", async () => {
  expect(await run("try{await import('node:fs')}catch(error){return error.message.includes('Unknown module')}"))
    .toMatchObject({ok:true,returnValue:true});
});

it("requires an execution-semantics marker for module replay inputs", async () => {
  const source="return (await import('fixture')).value";
  const original=await run(source,{modules:{fixture:{value:7}}});
  const snapshot=JSON.parse(await dump(original));
  expect(snapshot.initialInputs.namespaceRoots.fixture).toBeDefined();
  for(const key of ["executionSemantics","hostCalls","replay","promiseReplay"]) delete snapshot[key];
  expect(()=>restore(snapshot,{source})).toThrow("execution semantics");
});

it("honors cancellation while awaiting a dynamically imported host operation", async () => {
  const controller=new AbortController();
  let started!:()=>void;
  const ready=new Promise<void>(resolve=>{started=resolve;});
  const execution=run("try{await (await import('fixture')).wait()}catch(error){return error.message}",{
    signal:controller.signal,modules:{fixture:{wait:()=>{started();return new Promise(()=>undefined);}}}
  });
  await ready;
  controller.abort(new Error("cancel dynamic import"));
  expect(await execution).toMatchObject({ok:true,returnValue:"cancel dynamic import"});
});
