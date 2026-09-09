import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { getSandboxPropertyDescriptor, getSandboxPrototype, installArrayPrototype, releaseObjectPrototype } from "./object-model.js";
import { createSandboxClosure, deepCopyFromSandbox, isSandboxClosure, type SandboxArray } from "./values.js";
import { Budget } from "./budget.js";
import { encodeReplayData } from "../snapshot/replay-data.js";

it.each(["[]", "[3,5]", "[,,5]", "[...[3,5]]", "[[3],[5]]"])(
  "preserves the originating prototype of array literal %s", async expression => {
    expect(new Function(`return Object.getPrototypeOf(${expression})===Array.prototype`)()).toBe(true);
    const result = (await run(`return [${expression},Array.prototype]`)).returnValue;
    if (!Array.isArray(result) || !Array.isArray(result[0])) throw new Error("Expected array result");
    expect(getSandboxPrototype(result[0])).toBe(result[1]);
    if (Array.isArray(result[0][0])) expect(getSandboxPrototype(result[0][0])).toBe(result[1]);
    expect(() => deepCopyFromSandbox(result[0])).not.toThrow();
    expect(() => encodeReplayData(result[0])).not.toThrow();
  }
);

it("preserves later mutations to the originating array prototype", async () => {
  const result = (await run("const value=[3,5];return [value,Array.prototype,()=>{Array.prototype.marker=7}]")).returnValue;
  if (!Array.isArray(result) || !Array.isArray(result[0]) || !isSandboxClosure(result[2])) throw new Error("Expected SDK values");
  const other = (await run("return Array.prototype")).returnValue;
  await result[2].call([], { stack: [], thisValue: undefined });
  expect(getSandboxPrototype(result[0])).toBe(result[1]);
  expect(getSandboxPrototype(result[0])).not.toBe(other);
  expect(() => deepCopyFromSandbox(result[0])).toThrow();
  expect(() => encodeReplayData(result[0])).toThrow();
});

it("keeps explicit null prototypes on literals", async () => {
  const value = (await run("const value=[3,5];Object.setPrototypeOf(value,null);return value")).returnValue;
  if (!Array.isArray(value)) throw new Error("Expected array");
  expect(getSandboxPrototype(value)).toBe(null);
});

it("creates SDK array literals in their originating realm after cleanup", async () => {
  const result = (await run("return [()=>[3,5],Array.prototype]")).returnValue;
  if (!Array.isArray(result) || !isSandboxClosure(result[0])) throw new Error("Expected SDK factory");
  await run("Array.prototype.marker=99");
  const value = await result[0].call([], { stack: [], thisValue: undefined });
  if (!Array.isArray(value)) throw new Error("Expected array");
  expect(getSandboxPrototype(value)).toBe(result[1]);
  expect(() => deepCopyFromSandbox(value)).not.toThrow();
});

it("releases array accounting roots without losing a live realm's fallback", () => {
  const first = new Budget();
  const second = new Budget();
  const prototype: SandboxArray = [];
  const other: SandboxArray = [];
  const constructor = createSandboxClosure({ name: "Array", sandbox: true, call: () => [] });
  installArrayPrototype(first, prototype, constructor);
  installArrayPrototype(second, other, createSandboxClosure({ name: "Array", sandbox: true, call: () => [] }));
  prototype.push("mutation");
  expect([...first.retainedValues()]).toContain("mutation");
  releaseObjectPrototype(first);
  releaseObjectPrototype(second);
  expect([...first.retainedValues()]).toEqual([]);
  expect([...second.retainedValues()]).toEqual([]);
  expect(getSandboxPrototype([], first)).toBe(prototype);
  expect(getSandboxPrototype([], second)).toBe(other);
  expect(getSandboxPrototype([])).toBe(null);
});

it("uses a later guest iterator override on an exported array literal", async () => {
  const source = "return [Iterator.from,[3,5],()=>{Array.prototype[Symbol.iterator]=function*(){yield 7;yield 9}}]";
  // Use an isolated native realm so the oracle cannot change the test runner's arrays.
  const expected = runInNewContext(`const result=(function(){${source}})();result[2]();result[0](result[1]).next()`);
  const result = (await run(source)).returnValue;
  if (!Array.isArray(result) || !isSandboxClosure(result[0]) || !isSandboxClosure(result[2])) throw new Error("Expected SDK values");
  await result[2].call([], { stack: [], thisValue: undefined });
  const iterator = await result[0].call([result[1]], { stack: [], thisValue: undefined });
  const next = getSandboxPropertyDescriptor(iterator, "next")?.value;
  if (!isSandboxClosure(next)) throw new Error("Expected iterator next");
  expect(await next.call([], { stack: [], thisValue: iterator })).toEqual(expected);
});
