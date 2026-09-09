import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  "with({x:7}){return x}",
  "const o=Object.create({x:7});with(o){return x}",
  "let x=1;const o={x:7,[Symbol.unscopables]:{x:true}};with(o){return x}",
  "const seen=[];const o={x:7,get [Symbol.unscopables](){seen.push('u');return {}}};with(o){const result=x;return [result,seen]}",
  "const o={x:7,get f(){return function(){return this.x}}};with(o){return f()}",
  "let lookups=0,reads=0;const o={get [Symbol.unscopables](){lookups++;return {}},get f(){reads++;return function(){return this===o}}};with(o){const result=f();return [result,lookups,reads]}",
  "const o={f:function(){return this===o}};with(o){return [(f)(),(0,f)(),(true?f:f)()]}",
  "let x=1;with({x:7}){(()=>{x=8})()}return x",
  "const o={x:1};with(o){x++}return o.x",
  "const o={x:1};with(o){[x]=[7]}return o.x",
  "const o={x:1};with(o){return [delete x,Object.hasOwn(o,'x')]}",
  "with(3){return valueOf()}",
  "with(null){return 1}",
  "const o={x:1};with(o){var x=7}return [o.x,typeof x]",
  "const outer=this;with({x:7}){return this===outer}",
  "'use strict';with({x:7}){return x}",
  "let x=1;const o={x:2,[Symbol.unscopables]:{x:true}};with(o){x=7}return [x,o.x]",
  "let x=1;const o={x:2,[Symbol.unscopables]:{x:true}};with(o){x++}return [x,o.x]",
  "let x=1;const o={x:2,[Symbol.unscopables]:{x:true}};with(o){[x]=[7]}return [x,o.x]",
  "let x=1;const o={x:2,[Symbol.unscopables]:{x:true}};with(o){return [delete x,o.x]}",
  "const o={x:2,[Symbol.unscopables]:{x:true}};with(o){return typeof x}",
  "let calls=0;const o={x:1,get [Symbol.unscopables](){calls++;return {}}};with(o){x=2}return calls",
  "let calls=0;const o={x:1,get [Symbol.unscopables](){calls++;return {}}};with(o){const result=typeof x;return [result,calls]}",
  "let calls=0;const o={x:1,get [Symbol.unscopables](){calls++;return {}}};with(o){const result=delete x;return [result,calls]}",
  "with({}){return typeof x;let x}",
  "with({x:1}){return delete x;let x}"
])("matches native with-environment semantics: %s", async body => {
  const source = `try{return Function(${JSON.stringify(body)})()}catch(error){return {error:error.name}}`;
  expect(await run(source)).toMatchObject({ok: true, returnValue: runInNewContext(`(function(){${source}})()`)});
});

// UpdateExpression retains its reference through ToNumeric and PutValue.
// https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-postfix-increment-operator-runtime-semantics-evaluation
// JavaScriptCore agrees; Node 22 re-resolves the binding on the write.
it.each([
  {body: "const o={x:1};with(o){x=(delete o.x,2)}return o.x", expected: 2},
  {body: "let calls=0;const o={x:1,get [Symbol.unscopables](){calls++;return {}}};with(o){x++}return [o.x,calls]", expected: [2, 1]},
  {body: "let x=9;const o={x:{valueOf(){delete o.x;return 1}}};with(o){x++}return [x,o.x]", expected: [9, 2]}
])("preserves the assignment or update reference: $body", async ({body, expected}) => {
  expect(await run(`return Function(${JSON.stringify(body)})()`)).toMatchObject({ok: true, returnValue: expected});
});

// ECMA-262 13.15.5.5 evaluates the assignment target before the iterator/default.
// https://tc39.es/ecma262/2026/multipage/ecmascript-language-expressions.html#sec-runtime-semantics-iteratordestructuringassignmentevaluation
it("retains a destructuring target before evaluating its default", async () => {
  const body = "let x=9;const o={x:1};with(o){[x=(delete o.x,2)]=[]}return [x,o.x]";
  expect(await run(`return Function(${JSON.stringify(body)})()`)).toMatchObject({ok: true, returnValue: [9, 2]});
});
