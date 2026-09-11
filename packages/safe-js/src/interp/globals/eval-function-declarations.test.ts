import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  'eval("function f(){return 7}");return typeof f',
  'var f=1;eval("function f(){return 7}");return typeof f',
  'eval("function f(){return 7}");return f()',
  'eval("let x=7;function f(){return ++x}");return [f(),f(),typeof x]',
  'eval("function f(){return 1}function f(){return 2}");return f()',
  'eval("function* f(){yield 7}");return f().next().value',
  'eval("async function f(){return 7}");return typeof f',
  'return (function(f){eval("function f(){return 7}");return f()})(1)',
  'var f=1;with({f:2}){eval("function f(){return 7}")}return typeof f',
  `eval(${JSON.stringify('"use strict";function f(){return 7}')});return typeof f`,
  '"use strict";eval("function f(){return 7}");return typeof f',
  'var f=1;eval("{function f(){return 7}}");return typeof f',
  'let f=1;eval("{function f(){return 7}}");return f',
  'var f=1;eval("let f=2;{function f(){return 7}}");return f',
  'var f=1;eval("if(false){function f(){return 7}}");return f',
  'eval("if(false){function f(){return 7}}");return typeof f',
  'return (function(f){eval("{function f(){return 7}}");return f()})(1)',
  'var f=1;eval("{async function f(){return 7}}");return f',
  'var f=1;eval("{function* f(){yield 7}}");return f',
  'eval("{function f(){return 7}};f=9");return f'
])("instantiates eval function declarations: %s", async body => {
  const program = `Function(${JSON.stringify(body)})()`;
  const expected: unknown = runInNewContext(program);
  expect(await run(`return ${program}`)).toMatchObject({ ok: true, returnValue: expected });
});
