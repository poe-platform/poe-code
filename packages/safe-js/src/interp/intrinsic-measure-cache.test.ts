import { expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { createSandboxClosure, measureSandboxData } from "./values.js";
import { materializeFunctionProperties, registerIntrinsicFunction } from "./object-model.js";

it("does not recapture unchanged intrinsic function descriptors during measurement", () => {
  const closure = createSandboxClosure({guest:true,sandbox:true,name:"example",call:()=>undefined});
  const properties = materializeFunctionProperties(closure);
  registerIntrinsicFunction(new Budget(), closure);
  properties.word = "abc";
  expect(measureSandboxData([closure])).toBe(9);
  const dictionaries = vi.spyOn(Object, "getOwnPropertyDescriptors");
  try {
    expect(measureSandboxData([closure])).toBe(9);
    expect(dictionaries.mock.calls.filter(([owner]) => owner === properties)).toHaveLength(0);
  } finally { dictionaries.mockRestore(); }
});

it("preserves the captured descriptor snapshot when retained callbacks mutate later fields", () => {
  const closure = createSandboxClosure({guest:true,sandbox:true,name:"example",call:()=>undefined});
  const properties = materializeFunctionProperties(closure);
  registerIntrinsicFunction(new Budget(), closure);
  properties.first = createSandboxClosure({call:()=>undefined,retainedValues:()=>{
    properties.later = "changed!";
    return [];
  }});
  properties.later = "initial";
  expect(measureSandboxData([closure])).toBe(21);
  expect(measureSandboxData([closure])).toBe(22);
});

it("does not invoke native accessors while capturing intrinsic descriptors", () => {
  const closure = createSandboxClosure({guest:true,sandbox:true,name:"example",call:()=>undefined});
  const properties = materializeFunctionProperties(closure);
  registerIntrinsicFunction(new Budget(), closure);
  let reads = 0;
  Object.defineProperty(properties,"word",{configurable:true,get(){reads++;throw new Error("getter invoked");}});
  expect(measureSandboxData([closure])).toBe(6);
  expect(measureSandboxData([closure])).toBe(6);
  Object.defineProperty(properties,"word",{value:"abc"});
  expect(measureSandboxData([closure])).toBe(9);
  expect(reads).toBe(0);
});

it("remeasures nested values and invalidates native writes, definitions and deletions", () => {
  const closure = createSandboxClosure({guest:true,sandbox:true,name:"example",call:()=>undefined});
  const properties = materializeFunctionProperties(closure);
  registerIntrinsicFunction(new Budget(), closure);
  const nested = {word:"abc"};
  properties.box = nested;
  expect(measureSandboxData([closure])).toBe(14);
  nested.word = "abcdef";
  expect(measureSandboxData([closure])).toBe(17);
  properties.box = "a";
  expect(measureSandboxData([closure])).toBe(6);
  Object.defineProperty(properties,"box",{value:"abcd",enumerable:false});
  expect(measureSandboxData([closure])).toBe(9);
  delete properties.box;
  expect(measureSandboxData([closure])).toBe(1);
});
