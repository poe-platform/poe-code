import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../run.js";

it.each([
  'try{return f();function f(){return 7}}finally{}',
  'try{throw 1}catch(e){return f();function f(){return e+6}}',
  'try{}finally{return f();function f(){return 7}}',
  'try{const first=f;function f(){return 7};return first===f}finally{}',
  'try{throw 1}catch(e){function f(){return 7};f=9;return f}',
  'try{throw 1}catch(e){return C;class C{}}',
  'try{throw 1}catch(e){return g().next().value;function* g(){yield 7}}'
])("hoists functions in exception blocks: %s", async body => {
  const wrapped = `try{${body}}catch(error){return error.name}`;
  const expected: unknown = runInNewContext(`(function(){'use strict';${wrapped}})()`);
  expect(await run(wrapped)).toMatchObject({ ok: true, returnValue: expected });
});
