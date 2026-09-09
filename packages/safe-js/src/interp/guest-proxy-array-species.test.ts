import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure } from "./values.js";

it.each([
  ...['map(x=>x*2)', 'filter(x=>true)', 'slice()', 'splice(0,1)', 'flat()', 'flatMap(x=>[x])', 'concat(9)']
    .map(method => `const events=[];const target=[1,,3];target[Symbol.isConcatSpreadable]=true;
      target.constructor={get [Symbol.species](){events.push("species");return function(n){events.push(n);return {initial:n}}}};
      const p=wrap(target,{get(t,k,r){if(k==="constructor")events.push("constructor");return Reflect.get(t,k,r)}});
      const result=p.${method};return [result.initial,result.length,Object.keys(result),result[0],result[1],result[2],events]`),
  'const target=[1];target.constructor=null;const p=wrap(target,{});try{p.map(x=>x)}catch(e){return e.name}',
  'const target=[1];target.constructor={[Symbol.species]:()=>{}};const p=wrap(target,{});try{p.map(x=>x)}catch(e){return e.name}',
  'const p=wrap([1],{get(t,k,r){if(k==="constructor")throw 37;return Reflect.get(t,k,r)}});try{p.slice()}catch(e){return e}',
  'const p=wrap([1],{get(t,k,r){if(k==="constructor")throw 37;return Reflect.get(t,k,r)}});try{p.map(null)}catch(e){return e.name}',
  'const target=[1];target.constructor={[Symbol.species]:null};const p=wrap(target,{});return p.map(x=>x)',
  'const p=wrap({0:1,length:1},{get(t,k,r){if(k==="constructor")throw 37;return Reflect.get(t,k,r)}});return Array.prototype.map.call(p,x=>x)',
  'const p=wrap([1,2],{get(t,k,r){if(k==="constructor")throw 37;return Reflect.get(t,k,r)}});return p.toReversed()',
  'class Items extends Array{}const p=wrap(wrap(new Items(1,2),{}),{});return p.map(x=>x) instanceof Items'
])("selects species through wrapped arrays: %s", async source => {
  const expected = new Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
  const budget = new Budget(), parsed = parseModule(source);
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  })).toMatchObject({ ok: true, returnValue: expected });
});
