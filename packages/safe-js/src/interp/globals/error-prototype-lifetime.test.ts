import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { dump } from "../../dump.js";
import { isSandboxClosure } from "../values.js";
import { Budget } from "../budget.js";
import { createBuiltinBindings } from "../globals.js";
import { getSandboxDataProperty, getSandboxPrototype, releaseObjectPrototype } from "../object-model.js";
import { createSubsetErrorValue } from "../exceptions.js";

it.each(["Error", "EvalError", "RangeError", "ReferenceError", "SyntaxError", "TypeError", "URIError", "AggregateError"])(
  "preserves %s construction after realm cleanup", async name => {
    const args = name === "AggregateError" ? '[],"failure"' : '"failure"';
    const source = `return [()=>new ${name}(${args}),${name}.prototype,new ${name}(${args})]`;
    const native = runInNewContext(`(()=>{${source}})()`);
    const expected = native[0]();
    expect(Object.getPrototypeOf(expected)).toBe(native[1]);
    const exported = (await run(source)).returnValue;
    const getter = (await run("return Object.getPrototypeOf")).returnValue;
    if (!Array.isArray(exported) || !isSandboxClosure(exported[0]) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
    const context = {stack:[],thisValue:undefined};
    expect(await getter.call([exported[2]], context)).toBe(exported[1]);
    const later = await exported[0].call([], context);
    expect.soft(await getter.call([later], context)).toBe(exported[1]);
    expect.soft(Object.keys(later as object)).toEqual(Object.keys(expected));
    const descriptor = Object.getOwnPropertyDescriptor(later, "message");
    expect.soft(descriptor).toEqual(Object.getOwnPropertyDescriptor(expected, "message"));
  }
);

it("keeps a custom error newTarget prototype after cleanup", async () => {
  const source = `const prototype={custom:true};function Target(){}Target.prototype=prototype;
    return [()=>Reflect.construct(TypeError,["failure"],Target),prototype]`;
  const native = runInNewContext(`(()=>{${source}})()`);
  expect(Object.getPrototypeOf(native[0]())).toBe(native[1]);
  const exported = (await run(source)).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!Array.isArray(exported) || !isSandboxClosure(exported[0]) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
  const context = {stack:[],thisValue:undefined};
  const result = await exported[0].call([], context);
  expect(await getter.call([result], context)).toBe(exported[1]);
});

it("releases accounting roots without changing a live realm's Error fallback", () => {
  const budget = new Budget();
  const bindings = createBuiltinBindings({budget});
  const prototype = getSandboxDataProperty(bindings.TypeError, "prototype", budget);
  if (prototype === null || typeof prototype !== "object") throw new Error("Expected Error prototype");
  Object.defineProperty(prototype, "marker", {value:"retained-error-data",configurable:true});
  expect([...budget.retainedValues()]).toContain("retained-error-data");
  releaseObjectPrototype(budget);
  expect([...budget.retainedValues()]).toEqual([]);
  const error = createSubsetErrorValue("TypeError", "failure", [], budget);
  expect(getSandboxPrototype(error, budget)).toBe(prototype);
});

it("preserves explicit legacy Error mode across cleanup", async () => {
  const budget = new Budget();
  const bindings = createBuiltinBindings({budget,errorPrototypes:false});
  const before = await bindings.TypeError.call(["failure"]);
  releaseObjectPrototype(budget);
  const after = await bindings.TypeError.call(["failure"]);
  expect(Object.keys(after as object)).toEqual(Object.keys(before as object));
  expect(Object.getOwnPropertyDescriptor(after, "message")).toEqual(Object.getOwnPropertyDescriptor(before, "message"));
});

it("preserves an exported Error factory through public replay and later cleanup", async () => {
  const source = 'const factory=()=>new TypeError("failure");await 0;return [factory,TypeError.prototype]';
  const original = await run(source);
  expect(original.ok).toBe(true);
  const replayed = await run(source, {snapshot: JSON.parse(await dump(original))});
  expect(replayed.ok).toBe(true);
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!isSandboxClosure(getter)) throw new Error("Expected prototype getter");
  for (const result of [original, replayed]) {
    const exported = result.returnValue;
    if (!Array.isArray(exported) || !isSandboxClosure(exported[0])) throw new Error("Expected Error factory");
    const context = {stack:[],thisValue:undefined};
    const error = await exported[0].call([], context);
    expect(await getter.call([error], context)).toBe(exported[1]);
    expect(Object.keys(error as object)).toEqual([]);
  }
});

it("keeps SuppressedError descriptors and payload identity after cleanup", async () => {
  const source = 'const reason={},suppressed={};return [()=>new SuppressedError(reason,suppressed,"failure"),SuppressedError.prototype,reason,suppressed]';
  const exported = (await run(source)).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!Array.isArray(exported) || !isSandboxClosure(exported[0]) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
  const context = {stack:[],thisValue:undefined};
  const result = await exported[0].call([], context);
  expect(await getter.call([result], context)).toBe(exported[1]);
  for (const [key, value] of [["error", exported[2]], ["suppressed", exported[3]]] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(result, key);
    expect(descriptor?.value).toBe(value);
    expect(descriptor).toMatchObject({writable:true,configurable:true,enumerable:false});
  }
});
