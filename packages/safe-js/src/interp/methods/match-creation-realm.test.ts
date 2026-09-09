import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { deepCopyFromSandbox, isSandboxClosure } from "../values.js";

it.each([
  "/(?<letter>a)(b)?/d.exec('a')", "'a'.match(/(?<letter>a)(b)?/d)",
  "'aba'.match(/a/g)", "[...'a'.matchAll(/(?<letter>a)(b)?/dg)][0]",
  "/(?<letter>a)(b)?/d.exec('a').indices",
  "/(?<letter>a)(b)?/d.exec('a').indices[0]",
  "/(?<letter>a)(b)?/d.exec('a').indices.groups.letter",
  "(()=>{const r=/a/g;r.exec=RegExp.prototype.exec;return 'aba'.match(r)})()"
])("preserves match array creation realm: %s", async expression => {
  const source = `return [()=>${expression},Array.prototype,()=>{Array.prototype.marker=9}]`;
  const native = runInNewContext(`(()=>{${source}})()`);
  const expected = native[0]();
  expect(Object.getPrototypeOf(expected) === native[1]).toBe(true);
  const exported = (await run(source)).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  const reader = (await run("return value=>value.marker")).returnValue;
  if (!Array.isArray(exported) || !isSandboxClosure(exported[0]) || !isSandboxClosure(exported[2]) || !isSandboxClosure(getter) || !isSandboxClosure(reader)) throw new Error("Expected SDK exports");
  const context = { stack: [], thisValue: undefined };
  const result = await exported[0].call([], context);
  expect(await getter.call([result], context) === exported[1]).toBe(true);
  const copy = deepCopyFromSandbox(result) as object;
  expect(copy).toEqual(expected);
  expect(Object.getOwnPropertyDescriptors(copy)).toEqual(Object.getOwnPropertyDescriptors(expected));
  await exported[2].call([], context);
  expect(await reader.call([result], context)).toBe(9);
  expect(() => deepCopyFromSandbox(result)).toThrow();
});

it.each([
  "const r=/a/;r.exec=()=>result;return 'a'.match(r)",
  "return 'a'.match({[Symbol.match](){return result}})",
  "return 'a'.matchAll({[Symbol.matchAll](){return result}})"
])("preserves custom match result identity: %s", async body => {
  const source = `const result=Object.create(null);return [()=>{${body}},result]`;
  const native = runInNewContext(`(()=>{${source}})()`);
  expect(native[0]() === native[1]).toBe(true);
  const exported = (await run(source)).returnValue;
  const getter = (await run("return Object.getPrototypeOf")).returnValue;
  if (!Array.isArray(exported) || !isSandboxClosure(exported[0]) || !isSandboxClosure(getter)) throw new Error("Expected SDK exports");
  const context = { stack: [], thisValue: undefined };
  const result = await exported[0].call([], context);
  expect(result === exported[1]).toBe(true);
  expect(await getter.call([result], context)).toBe(null);
});

it("preserves named capture index aliases and null-prototype metadata", async () => {
  const source = "const m=/(?<letter>a)(b)?/d.exec('a');return [m.indices.groups.letter===m.indices[1],Object.getPrototypeOf(m.groups)===null,Object.getPrototypeOf(m.indices.groups)===null,m[2]===undefined,m.indices[2]===undefined]";
  const native = runInNewContext(`(()=>{${source}})()`);
  expect(deepCopyFromSandbox((await run(source)).returnValue)).toEqual(native);
});
