import { Script } from "node:vm";
import { expect, it } from "vitest";
import { parseExecutableModule, parseModule } from "./parser.js";
import { run } from "../run.js";
import { AS_MISSING_ASYNC, fixASMissingAsync } from "../lint/rules/AS-missing-async.js";

it.each([
  "function f(){return await 1}",
  "const f=function(){return await 1}",
  "const f=()=>await 1",
  "const f=()=>{return await 1}",
  "const o={f(){return await 1}}",
  "class C{f(){return await 1}}",
  "async function outer(){function inner(){return await 1}}",
  "function f(){return `${await 1}`}"
])("rejects await in a non-async function: %s", source => {
  expect(() => new Script(source)).toThrow(SyntaxError);
  expect(() => parseExecutableModule(source)).toThrow();
});

it.each([
  "async function f(){return await 1}",
  "const f=async()=>await 1",
  "const o={async f(){return await 1}}",
  "class C{async f(){return await 1}}",
  "async function* f(){yield await 1}"
])("preserves await in async functions: %s", source => {
  expect(() => new Script(source)).not.toThrow();
  expect(() => parseExecutableModule(source)).not.toThrow();
});

it("retains diagnostic parsing and the missing-async autofix", async () => {
  const source = "const f=()=>await 1;return await f()";
  expect(() => parseModule(source)).not.toThrow();
  expect(AS_MISSING_ASYNC(source)).toHaveLength(1);
  await expect(run(source)).rejects.toMatchObject({ name: "ParseError" });
  const fixed = fixASMissingAsync(source);
  expect(() => parseExecutableModule(fixed)).not.toThrow();
  expect(await run(fixed)).toMatchObject({ ok: true, returnValue: 1 });
});
