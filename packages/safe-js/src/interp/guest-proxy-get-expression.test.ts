import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure } from "./values.js";

it.each([
  { name: "direct trap", source: 'const p=wrap({}, {get(t,k,r){return k==="x"&&r===p?7:0}});return p.x', expected: 7 },
  { name: "inherited trap", source: 'const p=wrap({}, {get(t,k,r){return k==="x"&&r===child?8:0}});const child=Object.create(p);return child.x', expected: 8 },
  { name: "symbol inheritance", source: 'const key=Symbol("x");const p=wrap({}, {get(t,k,r){return k===key&&r===child?9:0}});const child=Object.create(p);return child[key]', expected: 9 },
  { name: "inherited trap shadows intrinsic", source: 'const p=wrap({}, {get(){return 11}});const child=Object.create(p);return child.toString', expected: 11 },
  { name: "inherited getter receiver", source: 'const target={get x(){return this===p?12:0}};const p=wrap(target,{});return p.x', expected: 12 },
  { name: "proxy handler", source: 'const handler=wrap({}, {get(t,k){return k==="get"?function(){return 13}:undefined}});return wrap({},handler).x', expected: 13 },
  { name: "method call receiver", source: 'const p=wrap({}, {get(){return function(){return this===p}}});return p.method()', expected: true },
  { name: "frozen invariant", source: 'const p=wrap(Object.freeze({x:1}), {get(){return 2}});try{return p.x}catch(e){return e.name}', expected: "TypeError" },
  { name: "destructuring", source: 'const {x}=wrap({}, {get(){return 14}});return x', expected: 14 },
  { name: "super receiver", source: 'const p=wrap({}, {get(t,k,r){return r.value}});const child={value:15,read(){return super.x}};Object.setPrototypeOf(child,p);return child.read()', expected: 15 },
  { name: "array prototype", source: 'const p=wrap({}, {get(t,k,r){return r===child?16:0}});const child=[];Object.setPrototypeOf(child,p);return child.x', expected: 16 },
  { name: "own property shadows proxy", source: 'const p=wrap({}, {get(){throw Error("must not run")}});const child=Object.create(p);Object.defineProperty(child,"x",{value:17});return child.x', expected: 17 },
  { name: "private receiver brand", source: 'class C{#x=1;get x(){return this.#x}}const p=wrap(new C(),{});try{return p.x}catch(e){return e.name}', expected: "TypeError" }
])("reads through guest proxies: $name", async ({ source, expected }) => {
  const budget = new Budget();
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  const parsed = parseModule(source);
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  })).toMatchObject({ ok: true, returnValue: expected });
});
