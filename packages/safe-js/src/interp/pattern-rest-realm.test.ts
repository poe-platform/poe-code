import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";
import { deepCopyFromSandbox, isSandboxClosure } from "./values.js";

it.each([
  ["const {...rest}={}", "Object"],
  ["const {a,...rest}={a:1,b:7}", "Object"],
  ["let rest;({...rest}={a:7})", "Object"],
  ["const rest=(({a,...value})=>value)({a:1,b:7})", "Object"],
  ["const [...rest]=[]", "Array"],
  ["const [a,...rest]=[1,7,9]", "Array"],
  ["let rest;([...rest]=[7])", "Array"],
  ["const rest=(([a,...value])=>value)([1,7])", "Array"]
])("preserves the rest allocation realm: %s", async (declaration, constructor) => {
  const expression = `(()=>{${declaration};return rest})()`;
  const native = runInNewContext(`(()=>{const value=${expression};return [Object.getPrototypeOf(value)===${constructor}.prototype,value]})()`);
  expect(native[0]).toBe(true);
  const exported = (await run(`return [${expression},()=>${expression},${constructor}.prototype]`)).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!Array.isArray(exported) || !isSandboxClosure(exported[1]) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
  const context = { stack: [], thisValue: undefined };
  for (const value of [exported[0], await exported[1].call([], context)]) {
    expect(await getter.call([value], context)).toBe(exported[2]);
    expect(Object.getOwnPropertyDescriptors(deepCopyFromSandbox(value) as object))
      .toEqual(Object.getOwnPropertyDescriptors(native[1]));
  }
});

it.each([["const {...rest}={a:7}", "Object"], ["const [...rest]=[7]", "Array"]])(
  "preserves later prototype mutations on rest results: %s", async (declaration, constructor) => {
    const exported = (await run(`${declaration};return [rest,()=>{${constructor}.prototype.marker=7},value=>value.marker]`)).returnValue;
    if (!Array.isArray(exported) || !isSandboxClosure(exported[1]) || !isSandboxClosure(exported[2])) throw new Error("Expected SDK exports");
    const context = { stack: [], thisValue: undefined };
    await exported[1].call([], context);
    expect(await exported[2].call([exported[0]], context)).toBe(7);
    expect(() => deepCopyFromSandbox(exported[0])).toThrow();
  }
);
