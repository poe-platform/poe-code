import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../src/run.js";

// ECMA-262 edition 16, 20.4.1: Symbol is valid heritage, but its
// constructor invocation throws before description coercion.
it.each([
  { source: "class S extends Symbol{};return Object.getPrototypeOf(S)===Symbol", expected: true },
  { source: "class S extends Symbol{constructor(){return {ok:true}}};return new S().ok", expected: true },
  { source: "class S extends Symbol{};try{new S()}catch(e){return e.name}", expected: "TypeError" },
  { source: "const events=[];try{new Symbol({toString(){events.push('coerce');return 'x'}})}catch(e){events.push(e.name)}return events", expected: ["TypeError"] },
  { source: "const P=new Proxy(Symbol,{});class S extends P{};try{new S()}catch(e){return [Object.getPrototypeOf(S)===P,e.name]}", expected: [true, "TypeError"] },
  { source: "const B=Symbol.bind(null);const o=Reflect.construct(function(){},[],B);return Object.getPrototypeOf(o)===Object.prototype", expected: true }
])("qualifies Symbol constructor: $source", async ({ source, expected }) => {
  expect(runInNewContext(`(()=>{${source}})()`)).toEqual(expected);
  expect(await run(source)).toMatchObject({ ok: true, returnValue: expected });
});
