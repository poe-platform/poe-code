import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure } from "./values.js";

it.each([
  { name: "getter uses virtual prototype", source: 'const proto={};const p=wrap({},{getPrototypeOf(){return proto}});return api.get.call(p)===proto' },
  { name: "inherited getter uses proxy receiver", source: 'const proto={};const p=wrap({},{getPrototypeOf(){return proto}});return p.__proto__===proto' },
  { name: "setter calls trap with receiver and requested prototype", source: 'const proto={};const target={};const events=[];const handler={setPrototypeOf(t,p){events.push([t===target,p===proto,this===handler]);return true}};const p=wrap(target,handler);return [api.set.call(p,proto),events]' },
  { name: "setter refusal throws", source: 'const p=wrap({},{setPrototypeOf(){return false}});try{api.set.call(p,null)}catch(e){return e.name}' },
  { name: "nonextensible invariant", source: 'const p=wrap(Object.preventExtensions({}),{setPrototypeOf(){return true}});try{api.set.call(p,null)}catch(e){return e.name}' },
  { name: "invalid prototype skips trap", source: 'const p=wrap({},{setPrototypeOf(){throw 31}});return api.set.call(p,17)' },
  { name: "nested getter forwarding", source: 'const proto={};const p=wrap(wrap(Object.create(proto),{}),{});return api.get.call(p)===proto' }
])("legacy __proto__ Proxy behavior: $name", async ({ source: body }) => {
  const source = 'const api=Object.getOwnPropertyDescriptor(Object.prototype,"__proto__");' + body;
  const expected = Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
  const budget = new Budget(), parsed = parseModule(source);
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  })).toMatchObject({ ok: true, returnValue: expected });
});

it.each(['api.get.call(p)', 'api.set.call(p,null)'])("revoked proxy rejects %s", async operation => {
  const budget = new Budget(), p = createGuestProxy({}, {});
  revokeGuestProxy(p);
  const parsed = parseModule(`const api=Object.getOwnPropertyDescriptor(Object.prototype,"__proto__");try{${operation};return false}catch(e){return e instanceof TypeError}`);
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), p }
  })).toMatchObject({ ok: true, returnValue: true });
});

it("invalid prototype skips revocation checks", async () => {
  const budget = new Budget(), p = createGuestProxy({}, {});
  revokeGuestProxy(p);
  const parsed = parseModule('const api=Object.getOwnPropertyDescriptor(Object.prototype,"__proto__");return api.set.call(p,17)');
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), p }
  })).toMatchObject({ ok: true, returnValue: undefined });
});
