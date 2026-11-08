import { expect, it } from "vitest";
import { parseDynamicFunction } from "./parser.js";
import { run } from "../run.js";

it.each([
  'var log=[];for(var x=(log.push("init"),0) in (log.push("rhs"),{a:1})){log.push(x)}return log',
  'for(var x=3 in {}){}return x',
  'for(var x=3 in null){}return x',
  'for(var x=true ? "a" in {a:1} : false in {}){}return x',
  'for(var x=("a" in {a:1}) in {}){}return x',
  'var log=[];outer:for(var x=(log.push("init"),0) in {a:1,b:2}){log.push(x);continue outer}return log',
  'var obj={x:0};with(obj){for(var x=5 in {}){}}return [obj.x,x]'
])("executes a legacy for-in initializer: %s", async source => {
  const expected: unknown = Function(source)();
  expect(() => parseDynamicFunction("normal", "", source)).not.toThrow();
  expect(await run(`return Function(${JSON.stringify(source)})()`)).toMatchObject({ok: true, returnValue: expected});
});

it.each([
  '"use strict";for(var x=0 in {}){}',
  'for(let x=0 in {}){}', 'for(const x=0 in {}){}',
  'for(var x=0 of []){}', 'for(var {x}={} in {}){}',
  'for(var x=0,y=1 in {}){}', 'let x;for(var x=0 in {}){}'
])("rejects an invalid iteration initializer: %s", source => {
  expect(() => Function(source)).toThrow(SyntaxError);
  expect(() => parseDynamicFunction("normal", "", source)).toThrow();
});
