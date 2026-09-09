import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure } from "./values.js";

it.each([
  { name: "target lookup", source: 'const p=wrap({x:7},{});return Function("p","with(p){return x}")(p)' },
  { name: "virtual binding", source: 'const events=[];const p=wrap({},{has(t,k){events.push("has:"+k);return k==="x"},get(t,k){events.push(typeof k==="symbol"?"unscopables":"get:"+k);return k==="x"?8:undefined}});return [Function("p","with(p){return x}")(p),events]' },
  { name: "hidden binding fallback", source: 'const events=[];const p=wrap({x:7},{has(t,k){events.push(k);return false}});return [Function("p","const x=9;with(p){return x}")(p),events]' },
  { name: "unscopables", source: 'const events=[];const p=wrap({x:7,[Symbol.unscopables]:{x:true}},{has(t,k){events.push("has:"+k);return k in t},get(t,k){events.push(typeof k==="symbol"?"unscopables":"get:"+k);return t[k]}});return [Function("p","const x=10;with(p){return x}")(p),events]' },
  { name: "refused unqualified deletion", source: 'const p=wrap({x:7},{deleteProperty(){return false}});return Function("p","with(p){return delete x}")(p)' },
  { name: "forwarded unqualified deletion", source: 'const target={x:7};const p=wrap(target,{});return [Function("p","with(p){return delete x}")(p),"x" in target]' },
  { name: "virtual binding deletion", source: 'const events=[];const p=wrap({},{has(t,k){return k==="x"},deleteProperty(t,k){events.push(k);return true}});return [Function("p","with(p){return delete x}")(p),events]' }
])("matches native Proxy with-environment behavior: $name", async ({ source }) => {
  const expected = Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
  const budget = new Budget(), parsed = parseModule(source);
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  })).toMatchObject({ ok: true, returnValue: expected });
});
