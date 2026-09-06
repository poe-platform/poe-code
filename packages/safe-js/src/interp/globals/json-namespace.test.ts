import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";

it.each(["parse","stringify","rawJSON","isRawJSON"])("makes JSON.%s non-enumerable",async name=>{
  const source=`const descriptor=Object.getOwnPropertyDescriptor(JSON,${JSON.stringify(name)});return [descriptor.enumerable,descriptor.writable,descriptor.configurable]`;
  expect((await run(source)).returnValue).toEqual([false,true,true]);
});

it("does not enumerate the standard JSON methods",async()=>{
  expect((await run("return Object.keys(JSON)")).returnValue).toEqual([]);
});

it("provides the standard JSON string tag descriptor",async()=>{
  expect((await run("return Object.getOwnPropertyDescriptor(JSON,Symbol.toStringTag)")).returnValue)
    .toEqual({value:"JSON",writable:false,enumerable:false,configurable:true});
});

it("uses the JSON tag in Object.prototype.toString",async()=>{
  expect((await run("return Object.prototype.toString.call(JSON)")).returnValue).toBe("[object JSON]");
});

it.each(["pending","completed"])("preserves JSON namespace descriptors in %s checkpoints",async mode=>{
  const source='const alias=JSON;Object.defineProperty(JSON,Symbol.toStringTag,{value:"CustomJSON",configurable:true});JSON.extra=7;await 0;return [alias===JSON,Object.keys(JSON),Object.prototype.toString.call(JSON),JSON.extra]';
  const pending=run(source);
  const completed=pending.catch(error=>error);
  try {
    if(mode==="completed")await completed;
    const snapshot=restore(JSON.parse(await dump(pending)),{source});
    const result=await completed;
    expect(result).toMatchObject({ok:true,returnValue:[true,["extra"],"[object CustomJSON]",7]});
    expect(await run(source,{snapshot})).toMatchObject({ok:true,returnValue:result.returnValue});
    expect(await run(source,{snapshot:result.snapshot})).toMatchObject({ok:true,returnValue:result.returnValue});
  } finally {await completed;}
});

it("keeps JSON namespace properties configurable and methods writable",async()=>{
  const source='JSON.parse=()=>7;const result=JSON.parse();delete JSON.stringify;delete JSON[Symbol.toStringTag];return [result,Object.keys(JSON),typeof JSON.stringify,Object.prototype.toString.call(JSON)]';
  expect((await run(source)).returnValue).toEqual([7,[],"undefined","[object Object]"]);
});
