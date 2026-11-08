import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { restore } from "../../restore.js";
import { Budget, SandboxError } from "../budget.js";
import { createSandboxPromise, deepCopyFromSandbox, getPromiseProperties, reconcileCompiledValues } from "../values.js";

it("supports own properties on promises", async () => {
  const source='const value=Promise.resolve(1);value.label="answer";return [value.label,Object.getOwnPropertyNames(value),await value]';
  expect((await run(source)).returnValue).toEqual(["answer",["label"],1]);
});

it("supports promise descriptors, symbols, enumeration and deletion", async () => {
  const source=`const value=Promise.resolve(1);const key=Symbol("label");value[key]=42;
    Object.defineProperty(value,"label",{value:"answer",enumerable:true,configurable:true});
    const keys=[];for(const key in value)keys.push(key);
    const before=[Object.keys(value),keys,Object.getOwnPropertySymbols(value)[0]===key,value[key],Object.hasOwn(value,"label")];
    delete value.label;return [before,Object.hasOwn(value,"label"),await value]`;
  expect((await run(source)).returnValue).toEqual([[["label"],["label"],true,42,true],false,1]);
});

it("invokes promise own accessors with the promise receiver", async () => {
  const source=`const value=Promise.resolve(1);Object.defineProperty(value,"label",{get(){return this.answer},set(answer){this.answer=answer}});
    value.label=42;return [value.label,value.answer,await value]`;
  expect((await run(source)).returnValue).toEqual([42,42,1]);
});

it("freezes only promise own properties without preventing settlement", async () => {
  const source=`const value=Promise.resolve(1);value.label=42;Object.freeze(value);let rejected=false;
    try{value.label=3}catch(error){rejected=error instanceof TypeError}
    return [Object.isFrozen(value),Object.isExtensible(value),rejected,value.label,await value]`;
  expect((await run(source)).returnValue).toEqual([true,false,true,42,1]);
});

it("honors own promise methods without exposing internal fields", async () => {
  const source=`const value=Promise.resolve(1);value.describe=function(){return this.label};value.label=42;
    return [value.describe(),value.kind,value.promise,Object.getOwnPropertyNames(value)]`;
  expect((await run(source)).returnValue).toEqual([42,undefined,undefined,["describe","label"]]);
});

it.each(["pending","completed"])("preserves promise properties across %s checkpoints", async mode => {
  const source=`const value=Promise.resolve(1);value.label=42;await 0;return [value.label,await value]`;
  const pending=run(source);const completed=pending.catch(error=>error);
  try {
    if(mode==="completed")await completed;
    const snapshot=restore(JSON.parse(await dump(pending)),{source});
    expect(await completed).toMatchObject({ok:true,returnValue:[42,1]});
    expect(await run(source,{snapshot})).toMatchObject({ok:true,returnValue:[42,1]});
  } finally {await completed;}
});

it("reflects an absent own property on a promise", async () => {
  expect((await run('return Object.getOwnPropertyDescriptor(Promise.resolve(1),"label")')).returnValue).toBeUndefined();
});

it("includes promise properties in JSON", async () => {
  expect((await run('const value=Promise.resolve(1);value.label=42;return JSON.stringify(value)')).returnValue).toBe('{"label":42}');
});

it("spreads promise properties into object literals", async () => {
  expect((await run('const value=Promise.resolve(1);value.label=42;return {...value}')).returnValue).toEqual({label:42});
});

it("charges promise property graphs against data budgets", () => {
  const value=createSandboxPromise(Promise.resolve(1));
  getPromiseProperties(value).label="x".repeat(1000);
  expect(()=>reconcileCompiledValues(new Budget({dataSize:50}),[value])).toThrow(SandboxError);
});

it("uses promise own coercion hooks", async () => {
  expect((await run('const value=Promise.resolve(1);value.toString=()=>"answer";return String(value)')).returnValue).toBe("answer");
});

it("exports promise own data properties with aliases and cycles", async () => {
  const result=await run('const value=Promise.resolve(1);value.label=42;value.self=value;return {value,alias:value}');
  const exported=deepCopyFromSandbox(result.returnValue) as {value:Promise<number>&{label:number;self:unknown};alias:unknown};
  expect(exported.value.label).toBe(42);
  expect(exported.value.self).toBe(exported.value);
  expect(exported.alias).toBe(exported.value);
  expect(await exported.value).toBe(1);
});
