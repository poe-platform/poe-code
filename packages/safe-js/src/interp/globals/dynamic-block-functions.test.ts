import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { measureSandboxData } from "../values.js";

it.each([
  "if(true){function f(){return 7}}return f()",
  "if(false){function f(){return 7}}return [typeof f,Object.hasOwn(globalThis,'f')]",
  "let before=typeof f;if(true){function f(){return 7}}return [before,f()]",
  "var f=1;if(false){function f(){return 7}}return f",
  "var f=1;if(true){function f(){return 7}}return f()",
  "let f=1;if(true){function f(){return 7}}return f",
  "{let f=1;{function f(){return 7}}}return typeof f",
  "{function f(){return 1}}{function f(){return 2}}return f()",
  "for(let i=0;i<2;i++){function f(){return i}}return f()",
  "{function f(){return 7}f=3}return typeof f",
  "'use strict';{function f(){return 7}}return typeof f",
  "{function* f(){yield 7}}return typeof f",
  "{async function f(){return 7}}return typeof f",
  "try{throw 1}catch(f){{function f(){return 7}}}return typeof f",
  "try{throw {f:1}}catch({f}){{function f(){return 7}}}return typeof f",
  "{function arguments(){return 7}}return typeof arguments",
  "switch(1){case 1:function f(){return 7}}return f()",
  "let f=1;switch(1){case 1:function f(){return 7}}return f",
  "function walk(n){if(n===0)return 0;{function f(){return n}}const child=walk(n-1);return child+f()}return walk(3)",
  "try{f}catch(error){return error.name}if(false){function f(){}}return typeof f"
])("matches native block-function binding behavior: %s", async body => {
  const source = `return Function(${JSON.stringify(body)})()`;
  const expected = runInNewContext(`(function(){${source}})()`);
  expect(await run(source)).toMatchObject({ok: true, returnValue: expected});
});

it.each(["f", "f=3", "{f}={f:3}"])("does not replace formal parameter %s", async parameter => {
  const source = `return Function(${JSON.stringify(parameter)},'{function f(){return 7}}return f')()`;
  expect(await run(source)).toMatchObject({ok: true, returnValue: runInNewContext(`(function(){${source}})()`)});
});

it.each(["", "a=1"])("preserves initial arguments before a legacy declaration with %s", async parameter => {
  const body = "const before=typeof arguments;{function arguments(){return 7}}return [before,typeof arguments]";
  const source = `return Function(${JSON.stringify(parameter)},${JSON.stringify(body)})()`;
  expect(await run(source)).toMatchObject({ok: true, returnValue: runInNewContext(`(function(){${source}})()`)});
});

it("accounts for data captured by a function escaping its block", async () => {
  const source = "return Function('payload','{function f(){return payload}}return f')('x'.repeat(size))";
  const small = await run(source, {bindings: {size: 1}});
  const large = await run(source, {bindings: {size: 4096}});
  expect(small.ok && large.ok).toBe(true);
  if (!small.ok || !large.ok) throw new Error("Block-function compilation failed.");
  expect(measureSandboxData([large.returnValue]) - measureSandboxData([small.returnValue])).toBeGreaterThanOrEqual(4095);
});
