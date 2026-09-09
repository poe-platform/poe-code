import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure } from "./values.js";

it.each([
  'Object.defineProperty(target,"x",descriptor)',
  'Reflect.defineProperty(target,"x",descriptor)',
  'Object.defineProperties(target,{x:descriptor})',
  'target=Object.create(null,{x:descriptor})'
])("converts proxy descriptor inputs in order through %s", async operation => {
  const source = `const events=[];const fields={value:7,writable:true,enumerable:true,configurable:true};
    const descriptor=wrap(fields,{has(t,k){events.push("has:"+k);return k in t},
      get(t,k,r){events.push("get:"+k);return t[k]}});
    let target={};${operation};return [Object.getOwnPropertyDescriptor(target,"x"),events]`;
  const expected = Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
  const budget = new Budget(), parsed = parseModule(source);
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  })).toMatchObject({ ok: true, returnValue: expected });
});

it.each([
  { name: "inherited descriptor fields", source: 'const descriptor=Object.create(wrap({value:8},{has(t,k){return k in t}}));const target={};Object.defineProperty(target,"x",descriptor);return target.x' },
  { name: "hidden value field", source: 'const descriptor=wrap({value:9},{has(){return false}});const target={};Object.defineProperty(target,"x",descriptor);return target.x' },
  { name: "conflicting virtual fields", source: 'const descriptor=wrap({},{has(t,k){return k==="value"||k==="get"},get(){return undefined}});try{Object.defineProperty({},"x",descriptor);return false}catch(e){return e.name}' },
  { name: "has failure short circuit", source: 'const events=[];const descriptor=wrap({},{has(t,k){events.push(k);throw 19},get(){events.push("unexpected")}});try{Object.defineProperty({},"x",descriptor)}catch(e){return [e,events]}' },
  { name: "proxy descriptor trap result", source: 'const descriptor=wrap({value:10,configurable:true},{has(t,k){return k in t}});const p=wrap({},{getOwnPropertyDescriptor(){return descriptor}});return Object.getOwnPropertyDescriptor(p,"x")' },
  { name: "virtual accessor identity", source: 'const getter=()=>11;const descriptor=wrap({},{has(t,k){return k==="get"},get(){return getter}});const target={};Object.defineProperty(target,"x",descriptor);return [target.x,Object.getOwnPropertyDescriptor(target,"x").get===getter]' }
])("matches native proxy descriptor conversion: $name", async ({ source }) => {
  const expected = Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
  const budget = new Budget(), parsed = parseModule(source);
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  })).toMatchObject({ ok: true, returnValue: expected });
});
