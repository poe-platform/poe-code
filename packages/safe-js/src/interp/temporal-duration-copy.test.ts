import { expect, it } from "vitest";
import { cloneSandboxValue } from "./values.js";
import { createSandboxTemporalDuration, temporalDurationFields } from "./temporal-duration.js";
import { hasNullObjectPrototype, setSandboxPrototype } from "./object-model.js";
import { run } from "../run.js";

it("copies Duration slots, aliases, symbols and frozen cycles", () => {
  const value=createSandboxTemporalDuration({seconds:9007199254740991,nanoseconds:999999999});
  const key=Symbol("self");
  Object.defineProperty(value,key,{value});
  Object.freeze(value);
  setSandboxPrototype(value,null);
  const copy=cloneSandboxValue([value,value,key]);
  if(!Array.isArray(copy) || typeof copy[2]!=="symbol")throw new Error("Invalid graph");
  expect(copy[0]).not.toBe(value);
  expect(copy[0]).toBe(copy[1]);
  expect(temporalDurationFields(copy[0])).toEqual(temporalDurationFields(value));
  expect(Object.getOwnPropertyDescriptor(copy[0],copy[2])).toEqual({value:copy[0],writable:false,enumerable:false,configurable:false});
  expect(Object.isFrozen(copy[0])).toBe(true);
  expect(hasNullObjectPrototype(copy[0] as object)).toBe(true);
});

it("copies guest data descriptors without losing Duration slots", async () => {
  const result=await run("const d=new Temporal.Duration(1);Object.defineProperty(d,'label',{value:7});return d");
  const copy=cloneSandboxValue(result.returnValue);
  expect(temporalDurationFields(copy).years).toBe(1);
  expect(Object.getOwnPropertyDescriptor(copy,"label")).toEqual({value:7,writable:false,enumerable:false,configurable:false});
});

it.each(["new Temporal.Duration(1)","Object.setPrototypeOf(new Temporal.Duration(1),null)",
  "new (class extends Temporal.Duration {})(1)","[new Temporal.Duration(1)]","new Map([[new Temporal.Duration(1),1]])"
])("rejects structuredClone of %s", async expression => {
  expect(await run(`try{structuredClone(${expression});return 'accepted'}catch(e){return e.name}`))
    .toMatchObject({ok:true,returnValue:"DataCloneError"});
});

it("rejects structured serialization before reading getters or detaching transfers", async () => {
  expect(await run(`let reads=0;const d=new Temporal.Duration();Object.defineProperty(d,'label',{enumerable:true,get(){reads++;throw 'read'}});
    const buffer=new ArrayBuffer(4);let name;try{structuredClone({buffer,d},{transfer:[buffer]})}catch(e){name=e.name}
    return [name,reads,buffer.byteLength]`)).toMatchObject({ok:true,returnValue:["DataCloneError",0,4]});
});

it("rejects Duration in the SDK structured-clone mode", () => {
  expect(()=>cloneSandboxValue(createSandboxTemporalDuration(),{structuredClone:true}))
    .toThrow(expect.objectContaining({name:"DataCloneError"}));
});

it("rejects explicit data copies with guest accessors or custom prototypes", async () => {
  for(const source of [
    "const d=new Temporal.Duration();Object.defineProperty(d,'label',{get(){throw 'invoked'}});return d",
    "const d=new Temporal.Duration();Temporal.Duration.prototype.custom=true;return d"
  ]) {
    const result=await run(source);
    expect(()=>cloneSandboxValue(result.returnValue)).toThrow(TypeError);
  }
});
