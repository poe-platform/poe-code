import { expect, it } from "vitest";
import { parseDynamicFunction } from "./parser.js";
import { run } from "../run.js";

it.each([
  'label:function f(){return 3}return f()',
  'a:b:function f(){return 3}return f()',
  '{label:function f(){return 3}}return f()',
  'if(true){label:function f(){return 3}}return f()',
  'label:function f(){return 3}return f.toString()',
  'return f();label:function f(){return 3}'
])("executes a non-strict labeled function: %s", async source => {
  const expected: unknown = Function(source)();
  expect(() => parseDynamicFunction("normal", "", source)).not.toThrow();
  expect(await run(`return Function(${JSON.stringify(source)})()`)).toMatchObject({ok: true, returnValue: expected});
});

it.each([
  '"use strict";label:function f(){}',
  'label:function* f(){}',
  'label:async function f(){}',
  'if(true) label:function f(){}',
  'for(var i=0;i<1;i++) label:function f(){}',
  'while(false) label:function f(){}',
  'with({}) label:function f(){}'
])("rejects an invalid labeled function: %s", source => {
  expect(() => Function(source)).toThrow(SyntaxError);
  expect(() => parseDynamicFunction("normal", "", source)).toThrow();
});
