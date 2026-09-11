import { expect, it, vi } from "vitest";
import { markDescriptorObject } from "./object-model.js";
import { createSandboxClosure, measureSandboxData, type SandboxValue } from "./values.js";

it("measures managed arrays without constructing descriptor dictionaries", () => {
  const value = ["abc", 7];
  markDescriptorObject(value);
  const dictionaries = vi.spyOn(Object, "getOwnPropertyDescriptors");
  try {
    expect(measureSandboxData([value])).toBe(10);
    expect(dictionaries.mock.calls.some(([owner]) => owner === value)).toBe(false);
  } finally { dictionaries.mockRestore(); }
});

it.each([
  {value:[], units:1},
  {value:[1,2], units:7},
  {value:["abc",7], units:10},
  {value:Array(3), units:4}
])("preserves exact managed-array accounting at $units units", ({value,units}) => {
  markDescriptorObject(value);
  expect(measureSandboxData([value])).toBe(units);
});

it("captures later descriptors before a retained callback changes the array", () => {
  const value: SandboxValue[] = [];
  value.push(createSandboxClosure({call:()=>undefined,retainedValues:()=>{
    value[1] = "changed!";
    value.push("added");
    return [];
  }}), "initial");
  markDescriptorObject(value);
  expect(measureSandboxData([value])).toBe(15);
  expect(value).toHaveLength(3);
});

it("does not invoke accessors and includes non-enumerable custom properties", () => {
  const value: unknown[] = [];
  let reads = 0;
  Object.defineProperty(value,"0",{get(){reads++;throw new Error("getter invoked");},configurable:true});
  Object.defineProperty(value,"word",{value:"abc"});
  markDescriptorObject(value);
  expect(measureSandboxData([value])).toBe(12);
  expect(reads).toBe(0);
});
