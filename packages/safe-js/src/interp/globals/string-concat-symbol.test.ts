import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { Budget } from "../budget.js";
import { callStringMethod } from "../methods/string.js";

it.each([
  ["only Symbol", "Symbol('x')"],
  ["Symbol after string", "'a',Symbol('x')"],
  ["Symbol before string", "Symbol('x'),'a'"],
  ["Symbol after guest conversion", "{toString(){events.push('first');return 'a'}},Symbol('x')"],
  ["stops before later conversion", "Symbol('x'),{toString(){events.push('unreached');return 'a'}}"],
  ["primitive conversion returns Symbol", "{[Symbol.toPrimitive](hint){events.push(hint);return Symbol()}}"],
  ["non-Symbol primitives", "null,undefined,true,1,2n"],
])("concat: %s", async (_name, args) => {
  const source = `const events=[];let result;try{result=''.concat(${args})}
    catch(e){result=typeof e==='object'?e.name:e}return [result,events];`;
  expect(await run(source)).toMatchObject({ ok: true,
    returnValue: runInNewContext(`(function(){"use strict";${source}})()`) });
});

it("rejects a primitive Symbol synchronously in direct concat calls", () => {
  expect(() => callStringMethod("", "concat", [Symbol("x")], new Budget())).toThrow(TypeError);
});
