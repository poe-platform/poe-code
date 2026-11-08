import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  'let x=1;try{eval("var x=2")}catch(e){return [e.name,x]}',
  'var x=0;{let x=1;try{eval("var x=2")}catch(e){return [e.name,x]}}return ["accepted",x]',
  'const x=1;try{eval("var x")}catch(e){return e.name}',
  'let ran=false;{let x=1;try{eval("ran=true;var x")}catch(e){return [e.name,ran]}}',
  'try{throw 1}catch(e){eval("var e=2");return e}',
  'try{throw {e:1}}catch({e}){try{eval("var e=2")}catch(error){return [error.name,e]}}',
  'try{throw 1}catch(e){{let e=3;try{eval("var e=2")}catch(error){return [error.name,e]}}}',
  `let x=1;eval(${JSON.stringify('"use strict";var x=2')});return x`,
  'var x=1;eval("var x=2");return x',
  'var x=1;with({x:3}){eval("var x=2")}return x',
  'let x=1;{let y=2;try{eval("function x(){}")}catch(e){return [e.name,x,y]}}'
])("validates eval declarations before execution: %s", async body => {
  const program = `Function(${JSON.stringify(body)})()`;
  const expected: unknown = runInNewContext(program);
  expect(await run(`return ${program}`)).toMatchObject({ ok: true, returnValue: expected });
});
