import { expect, it } from "vitest";
import { Temporal as Backend } from "temporal-polyfill/full/implementation";
import { cloneSandboxValue, deepCopyFromSandbox, deepCopyToSandbox, measureSandboxData } from "./values.js";
import { createSandboxTemporalPlainDate, temporalPlainDateFields } from "./temporal-plain-date.js";
import { hasNullObjectPrototype, setSandboxPrototype } from "./object-model.js";

const fields={isoYear:2000,isoMonth:2,isoDay:29,calendar:"buddhist"};

it("clones private date slots with aliases, symbols and frozen cycles", () => {
  const value=createSandboxTemporalPlainDate(fields);const key=Symbol("label");
  Object.defineProperty(value,"self",{value});Object.defineProperty(value,key,{value:7});Object.freeze(value);
  const copy=cloneSandboxValue([value,value]);
  if(!Array.isArray(copy))throw Error("Expected array");
  expect(copy[0]).not.toBe(value);expect(copy[0]).toBe(copy[1]);
  expect(temporalPlainDateFields(copy[0])).toEqual(fields);
  expect(Object.getOwnPropertyDescriptor(copy[0],"self")?.value).toBe(copy[0]);
  expect(Object.getOwnPropertyDescriptor(copy[0],key)?.value).toBe(7);
  expect(Object.isFrozen(copy[0])).toBe(true);
});

it("imports private ISO fields and preserves own calendar-derived shadows", () => {
  const value=new Backend.PlainDate(2000,2,29,"buddhist");Object.defineProperty(value,"year",{value:7});
  const copy=deepCopyToSandbox(value);
  expect(temporalPlainDateFields(copy)).toEqual(fields);
  expect(Object.getOwnPropertyDescriptor(copy,"year")?.value).toBe(7);
});

it("round-trips exported private dates and explicitly null prototypes", () => {
  for(const nullPrototype of [false,true]){
    const value=createSandboxTemporalPlainDate(fields);if(nullPrototype)setSandboxPrototype(value,null);
    const host=deepCopyFromSandbox(value);if(nullPrototype)expect(Object.getPrototypeOf(host)).toBeNull();
    const copy=deepCopyToSandbox(host);expect(temporalPlainDateFields(copy)).toEqual(fields);
    expect(hasNullObjectPrototype(copy as object)).toBe(nullPrototype);
  }
});

it("charges three private numeric fields and calendar text", () => {
  expect(measureSandboxData([createSandboxTemporalPlainDate(fields)])-measureSandboxData([Object.create(null)]))
    .toBe(3*8+fields.calendar.length);
});

it("rejects structuredClone rather than losing the private date", () => {
  expect(()=>cloneSandboxValue(createSandboxTemporalPlainDate(fields),{structuredClone:true}))
    .toThrow(expect.objectContaining({name:"DataCloneError"}));
});

it.each(["import","export","clone"] as const)("rejects own accessors without execution during %s", direction => {
  const value=direction==="import"?new Backend.PlainDate(2000,1,1):createSandboxTemporalPlainDate(fields);let reads=0;
  Object.defineProperty(value,"label",{get(){reads++;return 1;}});
  const copy=direction==="import"?deepCopyToSandbox:direction==="export"?deepCopyFromSandbox:cloneSandboxValue;
  expect(()=>copy(value as never)).toThrow(TypeError);expect(reads).toBe(0);
});
