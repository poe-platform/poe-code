import { expect, it } from "vitest";
import { Temporal as TemporalBackend } from "temporal-polyfill/full/implementation";
import { deepCopyFromSandbox, deepCopyToSandbox } from "./values.js";
import { createSandboxTemporalDuration, hostTemporalDurationFields, temporalDurationFields } from "./temporal-duration.js";
import { hasNullObjectPrototype, setSandboxPrototype } from "./object-model.js";
import { run } from "../run.js";
import { dump } from "../dump.js";

const NativeDuration=(globalThis as typeof globalThis & {Temporal?:typeof TemporalBackend}).Temporal?.Duration;
const constructors=[TemporalBackend.Duration,...(NativeDuration===undefined?[]:[NativeDuration])];

it.each(constructors)("imports host Duration fields, frozen aliases and cycles (%#)", Constructor => {
  const value=new Constructor(0,0,0,0,0,0,9007199254740991,0,0,999999999);
  Object.defineProperty(value,"self",{value});Object.freeze(value);
  const copied=deepCopyToSandbox([value,value]);
  if(!Array.isArray(copied))throw new Error("Invalid graph");
  expect(copied[0]).toBe(copied[1]);
  expect(temporalDurationFields(copied[0])).toMatchObject({seconds:9007199254740991,nanoseconds:999999999});
  expect(Object.getOwnPropertyDescriptor(copied[0],"self")).toEqual({value:copied[0],writable:false,enumerable:false,configurable:false});
  expect(Object.isFrozen(copied[0])).toBe(true);
});

it("reimports its own null-prototype exports with their private fields intact", () => {
  const value=createSandboxTemporalDuration({seconds:1});setSandboxPrototype(value,null);
  const copy=deepCopyToSandbox(deepCopyFromSandbox(value));
  expect(temporalDurationFields(copy).seconds).toBe(1);
  expect(hasNullObjectPrototype(copy as object)).toBe(true);
});

it.each(constructors)("uses host private fields instead of shadowing data properties (%#)", Constructor => {
  const value=new Constructor(0,0,0,0,0,0,1);Object.defineProperty(value,"seconds",{value:7});
  const copy=deepCopyToSandbox(value);
  expect(temporalDurationFields(copy).seconds).toBe(1);
  expect(Object.getOwnPropertyDescriptor(copy,"seconds")).toEqual({value:7,writable:false,enumerable:false,configurable:false});
});

it.each(constructors)("rejects forged host brands without consulting getters (%#)", Constructor => {
  let reads=0;const forged=Object.create(Constructor.prototype);
  Object.defineProperty(forged,"seconds",{get(){reads++;return 1}});
  expect(()=>deepCopyToSandbox(forged)).toThrow(TypeError);
  expect(reads).toBe(0);
});

it("does not invoke proxy traps during host Duration recognition", () => {
  let reads=0;
  const proxy=new Proxy(new TemporalBackend.Duration(),{getPrototypeOf(){reads++;throw "prototype"},get(){reads++;throw "get"}});
  expect(hostTemporalDurationFields(proxy)).toBeUndefined();
  expect(reads).toBe(0);
});

it("rejects host accessor properties without reading them", () => {
  const value=new TemporalBackend.Duration();let reads=0;
  Object.defineProperty(value,"label",{get(){reads++;return 1}});
  expect(()=>deepCopyToSandbox(value)).toThrow(TypeError);
  expect(reads).toBe(0);
});

it.each(constructors)("imports bindings and replays a host result without repeating the call (%#)", async Constructor => {
  let calls=0;const load=()=>{calls++;return new Constructor(0,0,0,0,0,0,2)};
  const input=new Constructor(0,0,0,0,0,0,1);
  const source="const d=await load();return [input.seconds,d.seconds,d instanceof Temporal.Duration,input.add(d).toJSON()]";
  const first=await run(source,{bindings:{load,input}});
  expect(first).toMatchObject({ok:true,returnValue:[1,2,true,"PT3S"]});
  expect(await run(source,{snapshot:JSON.parse(await dump(first)),bindings:{load}}))
    .toMatchObject({ok:true,returnValue:first.returnValue});
  expect(calls).toBe(1);
});
