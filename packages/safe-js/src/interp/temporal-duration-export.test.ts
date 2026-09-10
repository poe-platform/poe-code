import { expect, it } from "vitest";
import { Temporal as TemporalBackend } from "temporal-polyfill/full/implementation";
import { deepCopyFromSandbox } from "./values.js";
import { createSandboxTemporalDuration } from "./temporal-duration.js";
import { setSandboxPrototype } from "./object-model.js";
import { run } from "../run.js";

const HostDuration=(globalThis as typeof globalThis & {Temporal?:typeof TemporalBackend}).Temporal?.Duration ?? TemporalBackend.Duration;

it.each([1,-1])("exports exact host-readable fields, aliases and frozen cycles with sign %s", sign => {
  const value=createSandboxTemporalDuration({seconds:sign*9007199254740991,nanoseconds:sign*999999999});
  Object.defineProperty(value,"self",{value});
  Object.freeze(value);
  const exported=deepCopyFromSandbox([value,value]) as Array<InstanceType<typeof HostDuration> & {self:unknown}>;
  expect(exported[0]).toBe(exported[1]);
  expect(exported[0]).toBeInstanceOf(HostDuration);
  expect(exported[0].seconds).toBe(sign*9007199254740991);
  expect(exported[0].nanoseconds).toBe(sign*999999999);
  expect(exported[0].self).toBe(exported[0]);
  expect(Object.isFrozen(exported[0])).toBe(true);
});

it("exports a public-run result with native methods", async () => {
  const result=await run("return Temporal.Duration.from('P1DT2H3M4.005006007S')");
  expect(result.ok).toBe(true);
  const exported=deepCopyFromSandbox(result.returnValue) as InstanceType<typeof HostDuration>;
  expect(exported.toJSON()).toBe("P1DT2H3M4.005006007S");
  expect(exported.negated().sign).toBe(-1);
});

it("preserves symbol descriptors and an explicit null prototype without losing host branding", () => {
  const value=createSandboxTemporalDuration({seconds:1});
  const key=Symbol("self");Object.defineProperty(value,key,{value});setSandboxPrototype(value,null);
  const exported=deepCopyFromSandbox([value,key]) as [object,symbol];
  expect(Object.getPrototypeOf(exported[0])).toBe(null);
  expect(Object.getOwnPropertyDescriptor(exported[0],exported[1])).toEqual({value:exported[0],writable:false,enumerable:false,configurable:false});
  const getter=Object.getOwnPropertyDescriptor(HostDuration.prototype,"seconds")!.get!;
  expect(getter.call(exported[0])).toBe(1);
});

it("keeps data properties named after temporal fields separate from private slots", async () => {
  const result=await run("const d=Temporal.Duration.from('PT1S');Object.defineProperty(d,'seconds',{value:7});return d");
  const exported=deepCopyFromSandbox(result.returnValue);
  expect(Object.getOwnPropertyDescriptor(exported,"seconds")).toEqual({value:7,writable:false,enumerable:false,configurable:false});
  expect(Object.getOwnPropertyDescriptor(HostDuration.prototype,"seconds")!.get!.call(exported)).toBe(1);
});

it.each([
  "const d=new Temporal.Duration();Object.defineProperty(d,'label',{get(){throw 'invoked'}});return d",
  "const d=new Temporal.Duration();Object.setPrototypeOf(d,{custom:true});return d",
  "const d=new Temporal.Duration();Temporal.Duration.prototype.custom=true;return d"
])("rejects non-data guest state: %s", async source => {
  const result=await run(source);
  expect(()=>deepCopyFromSandbox(result.returnValue)).toThrow(TypeError);
});
