import { expect, it } from "vitest";
import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import { cloneSandboxValue, deepCopyFromSandbox, deepCopyToSandbox, measureSandboxData } from "./values.js";
import { createSandboxTemporalPlainDateTime, hostTemporalPlainDateTimeFields, temporalPlainDateTimeFields } from "./temporal-plain-date-time.js";
import { hasNullObjectPrototype, setSandboxPrototype } from "./object-model.js";

const fields={isoYear:2000,isoMonth:2,isoDay:29,hour:12,minute:34,second:56,millisecond:987,microsecond:654,nanosecond:321,calendar:"buddhist"};

it("clones date-time private slots, aliases and frozen cycles", () => {
  const value=createSandboxTemporalPlainDateTime(fields);
  Object.defineProperty(value,"self",{value});
  Object.freeze(value);
  const copy=cloneSandboxValue([value,value]);
  if(!Array.isArray(copy))throw new Error("Expected copied array");
  expect(copy[0]).not.toBe(value);
  expect(copy[0]).toBe(copy[1]);
  expect(temporalPlainDateTimeFields(copy[0])).toEqual(fields);
  expect(Object.getOwnPropertyDescriptor(copy[0],"self")?.value).toBe(copy[0]);
  expect(Object.isFrozen(copy[0])).toBe(true);
});

it("imports ISO slots from a non-ISO host calendar without reading public shadows", () => {
  const value=new Backend.PlainDateTime(2000,2,29,12,34,56,987,654,321,"buddhist");
  Object.defineProperty(value,"year",{value:7});
  const copy=deepCopyToSandbox(value);
  expect(temporalPlainDateTimeFields(copy)).toEqual(fields);
  expect(Object.getOwnPropertyDescriptor(copy,"year")?.value).toBe(7);
});

it("round-trips exported calendar and nanosecond slots", () => {
  const value=createSandboxTemporalPlainDateTime(fields);
  const host=deepCopyFromSandbox(value);
  expect(temporalPlainDateTimeFields(deepCopyToSandbox(host))).toEqual(fields);
});

it("charges private numeric fields and calendar text", () => {
  const value=createSandboxTemporalPlainDateTime(fields);
  expect(measureSandboxData([value])-measureSandboxData([Object.create(null)])).toBe(9*8+fields.calendar.length);
});

it("rejects Temporal structured clones rather than dropping private data", () => {
  expect(()=>cloneSandboxValue(createSandboxTemporalPlainDateTime(fields),{structuredClone:true}))
    .toThrow(expect.objectContaining({name:"DataCloneError"}));
});

it("round-trips explicitly null host prototypes with preserved private branding", () => {
  const value=createSandboxTemporalPlainDateTime(fields);
  setSandboxPrototype(value,null);
  const exported=deepCopyFromSandbox(value);
  expect(Object.getPrototypeOf(exported)).toBeNull();
  const imported=deepCopyToSandbox(exported);
  expect(temporalPlainDateTimeFields(imported)).toEqual(fields);
  expect(hasNullObjectPrototype(imported as object)).toBe(true);
});

it("does not invoke proxy or forged-host getters during brand recognition", () => {
  let reads=0;
  const forged=Object.create(Backend.PlainDateTime.prototype);
  Object.defineProperty(forged,"year",{get(){reads++;return 2000;}});
  expect(()=>hostTemporalPlainDateTimeFields(forged)).toThrow(TypeError);
  const proxy=new Proxy(new Backend.PlainDateTime(2000,1,1),{
    getPrototypeOf(){reads++;throw new Error("prototype trap");},
    get(){reads++;throw new Error("get trap");}
  });
  expect(hostTemporalPlainDateTimeFields(proxy)).toBeUndefined();
  expect(reads).toBe(0);
});

it.each(["import","export","clone"] as const)("rejects accessor properties without execution during %s", direction => {
  const value=direction==="import" ? new Backend.PlainDateTime(2000,1,1) : createSandboxTemporalPlainDateTime(fields);
  let reads=0;
  Object.defineProperty(value,"label",{get(){reads++;return 1;}});
  const copy=direction==="import" ? deepCopyToSandbox : direction==="export" ? deepCopyFromSandbox : cloneSandboxValue;
  expect(()=>copy(value as never)).toThrow(TypeError);
  expect(reads).toBe(0);
});
