import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure } from "./values.js";

it.each([
  'const keys=[];for(const k in "ab")keys.push(k);return keys',
  'const keys=[];for(const k in null)keys.push(k);for(const k in undefined)keys.push(k);return keys',
  'const p=wrap({a:1,b:2},{});function* g(){for(const k in p)yield k}const iterator=g();return [iterator.next(),iterator.next(),iterator.next()]',
  'const p=wrap({a:1,b:2},{});const keys=[];for(const k in p){if(k==="a")continue;keys.push(k)}return keys',
  'const p=wrap({a:1,b:2},{});const keys=[];for(const k in p)keys.push(k);return keys',
  'const parent={};Object.defineProperty(parent,"hidden",{value:1});const p=wrap({},{ownKeys(){return ["hidden"]},getPrototypeOf(){return parent}});const keys=[];for(const k in p)keys.push(k);return keys',
  'const events=[];const p=wrap({a:1,b:2},{ownKeys(t){events.push("keys");return Reflect.ownKeys(t)},getPrototypeOf(t){events.push("proto");return Reflect.getPrototypeOf(t)},getOwnPropertyDescriptor(t,k){events.push("desc:"+k);return Reflect.getOwnPropertyDescriptor(t,k)}});for(const k in p)events.push("body:"+k);return events',
  'const p=wrap({},{ownKeys(){return ["virtual",Symbol("skip")]},getOwnPropertyDescriptor(t,k){return {value:1,enumerable:true,configurable:true}}});const keys=[];for(const k in p)keys.push(k);return keys',
  'const parent={a:1,b:2};const p=wrap({a:3},{getPrototypeOf(){return parent}});const keys=[];for(const k in p)keys.push(k);return keys',
  'const parent={a:1,b:2};const target={};Object.defineProperty(target,"a",{value:3});const p=wrap(target,{getPrototypeOf(){return parent}});const keys=[];for(const k in p)keys.push(k);return keys',
  'const p=wrap({a:1,b:2},{});const child=Object.create(p);child.c=3;const keys=[];for(const k in child)keys.push(k);return keys',
  'const target={a:1,b:2};const p=wrap(target,{});const keys=[];for(const k in p){keys.push(k);delete target.b}return keys',
  'const p=wrap({a:1},{ownKeys(){throw 37}});try{for(const k in p){}return 0}catch(e){return e}',
  'const p=wrap({},{ownKeys(){return ["a","a"]}});try{for(const k in p){}return 0}catch(e){return e.name}',
  'const p=wrap(wrap({a:1},{}),{});const keys=[];for(const k in p)keys.push(k);return keys',
  'const events=[];const p=wrap({a:1,b:2},{getOwnPropertyDescriptor(t,k){events.push(k);return Reflect.getOwnPropertyDescriptor(t,k)}});for(const k in p){events.push("body:"+k);break}return events'
])("enumerates internal Proxies in for-in: %s", async source => {
  const expected = new Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
  const budget = new Budget(), parsed = parseModule(source);
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  })).toMatchObject({ ok: true, returnValue: expected });
});

it("rejects revoked proxies in for-in", async () => {
  const proxy = createGuestProxy({}, {});
  revokeGuestProxy(proxy);
  const parsed = parseModule('try{for(const k in proxy){}return "missed"}catch(e){return e.name}');
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    bindings: { proxy }
  })).toMatchObject({ ok: true, returnValue: "TypeError" });
});

it("bounds virtual prototype cycles in for-in", async () => {
  const budget = new Budget({ maxSteps: 100 });
  const proxy = createGuestProxy({}, { getPrototypeOf: createSandboxClosure({ guest: true, call: () => proxy }) });
  const parsed = parseModule('for(const k in proxy){}');
  await expect(interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { proxy }
  })).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  expect([...budget.retainedValues()]).not.toContain(proxy);
});

it("retains the enumeration receiver across body calls and releases it on break", async () => {
  const budget = new Budget();
  const proxy = createGuestProxy({ a: 1 }, {});
  const check = createSandboxClosure({ guest: true, call: () => {
    expect([...budget.retainedValues()]).toContain(proxy);
    return undefined;
  } });
  const parsed = parseModule('for(const k in proxy){check();break}return 1');
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { proxy, check }
  })).toMatchObject({ ok: true, returnValue: 1 });
  expect([...budget.retainedValues()]).not.toContain(proxy);
});
