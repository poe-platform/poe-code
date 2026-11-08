import { expect, it } from "vitest";
import { parseDynamicFunction } from "./parser.js";
import { run } from "../run.js";

it.each([
  "const keys=[];for(const x in {},{a:1,b:2})keys.push(x);return keys",
  "var x;for(x in 0,{a:1}){}return x",
  "const keys=[];for(var x=1 in {},{a:1})keys.push(x);return keys",
  "const keys=[];for(let x in true?{}:{},{a:1})keys.push(x);return keys",
  "const seen=[];for(const x in seen.push(1),seen.push(2),{a:1})seen.push(x);return seen"
])("evaluates a full expression on the for-in right side: %s", async source => {
  const expected: unknown = Function(source)();
  expect(() => parseDynamicFunction("normal", "", source)).not.toThrow();
  expect(await run(`return Function(${JSON.stringify(source)})()`))
    .toMatchObject({ok: true, returnValue: expected});
});

it.each([
  "for(var x of [],[]){}",
  "for(const x of [],[]){}",
  "for(var x=1,y=2 in {}){}",
  "for(var x in {},){}"
])("rejects invalid loop comma placement: %s", source => {
  expect(() => Function(source)).toThrow(SyntaxError);
  expect(() => parseDynamicFunction("normal", "", source)).toThrow();
});

it("retains parenthesized sequence support in for-of", async () => {
  const source = "const values=[];for(const x of ([],[1,2]))values.push(x);return values";
  expect(await run(source)).toMatchObject({ok: true, returnValue: Function(source)()});
});
