import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";
import { parseDynamicFunction } from "../../parse/parser.js";

it.each([
  "{function f(){return 1}function f(){return 2}}return f()",
  "{return f();function f(){return 1}function f(){return 2}}",
  "const seen=[];{seen.push(f());function f(){return 1}seen.push(f());function f(){return 2}seen.push(f())}return seen",
  "switch(1){case 1:function f(){return 1}break;case 2:function f(){return 2}}return f()",
  "switch(0){case 1:function f(){return 1}break;case 2:function f(){return 2}}return typeof f",
  "let f=7;{function f(){return 1}function f(){return 2}}return f",
  "{function f(){'use strict';return 1}function f(){return 2}}return f()",
  "return (function*(){ {function f(){return 1}function f(){return 2}}yield f()})().next().value"
])("matches repeated non-strict block functions: %s", body => {
  const source = `return Function(${JSON.stringify(body)})()`;
  return expect(run(source)).resolves.toMatchObject({
    ok: true, returnValue: runInNewContext(`(function(){${source}})()`)
  });
});

it.each([
  '"use strict";{function f(){}function f(){}}',
  "{function* f(){}function f(){}}",
  "{function f(){}function* f(){}}",
  "{async function f(){}function f(){}}",
  "{function f(){}async function f(){}}",
  "{let f;function f(){}}",
  "{var f;function f(){}}",
  "{function f(){}var f;}"
])("still rejects incompatible block declarations: %s", source => {
  expect(() => Function(source)).toThrow(SyntaxError);
  expect(() => parseDynamicFunction("normal", "", source)).toThrow();
});
