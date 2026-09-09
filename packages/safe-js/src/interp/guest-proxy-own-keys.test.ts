import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { sandboxOwnKeys } from "./guest-proxy-own-keys.js";
import { createSandboxClosure, type SandboxCallContext } from "./values.js";

it.each([
  { name: "virtual order", setup: "", result: '["b","2","a","1"]' },
  { name: "duplicate keys", setup: "", result: '["x","x"]' },
  { name: "numeric key rejected", setup: "", result: '[1]' },
  { name: "primitive result rejected", setup: "", result: '"x"' },
  { name: "array-like result", setup: "", result: '({0:"b",1:"a",length:2})' },
  { name: "hole rejected", setup: "", result: '({length:1})' },
  { name: "hidden configurable", setup: 'target.x=1;', result: '[]' },
  { name: "hidden nonconfigurable", setup: 'Object.defineProperty(target,"x",{value:1});', result: '[]' },
  { name: "hidden sealed", setup: 'target.x=1;Object.preventExtensions(target);', result: '[]' },
  { name: "extra sealed", setup: 'target.x=1;Object.preventExtensions(target);', result: '["x","y"]' },
  { name: "complete sealed", setup: 'target.x=1;Object.preventExtensions(target);', result: '["x"]' }
])("matches native Proxy ownKeys rules: $name", async ({ setup, result }) => {
  const source = `const target={};${setup}const calls=[];const handler={ownKeys(t){calls.push([t===target,this===handler]);return ${result}}};
    let outcome;try{outcome=Reflect.ownKeys(wrap(target,handler))}catch(e){outcome=e.name}return [outcome,calls]`;
  const expected = Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
  const budget = new Budget(), parsed = parseModule(source);
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  })).toMatchObject({ ok: true, returnValue: expected });
});

it("rejects revoked ownKeys operations", async () => {
  const budget = new Budget(), proxy = createGuestProxy({}, {});
  revokeGuestProxy(proxy);
  await expect(sandboxOwnKeys(proxy, budget)).rejects.toThrow(TypeError);
  expect([...budget.retainedValues()]).toEqual([]);
});

it("bounds nested ownKeys fallback", async () => {
  const budget = new Budget({ maxSteps: 8 });
  let target = {};
  for (let i = 0; i < 32; i += 1) target = createGuestProxy(target, {});
  const context: SandboxCallContext = { stack: [], thisValue: undefined, getProperty: () => undefined };
  await expect(sandboxOwnKeys(target, budget, context)).rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  expect([...budget.retainedValues()]).toEqual([]);
});

it("retains the array-like result during reads and releases it on failure", async () => {
  const budget = new Budget(), list = { length: 1 }, marker = new Error("read failure");
  const handler = { ownKeys: createSandboxClosure({ guest: true, call: () => list }) };
  const context: SandboxCallContext = { stack: [], thisValue: undefined, getProperty: (value, key) => {
    if (value === list) {
      expect([...budget.retainedValues()]).toContain(list);
      if (key === "0") throw marker;
    }
    return Reflect.get(value as object, key);
  } };
  await expect(sandboxOwnKeys(createGuestProxy({}, handler), budget, context)).rejects.toBe(marker);
  expect([...budget.retainedValues()]).toEqual([]);
});

it.each([
  { name: "nested fallback", source: 'return Reflect.ownKeys(wrap(wrap({b:1,2:2,a:3},{}),{}))' },
  { name: "symbol identity and order", source: 'const key=Symbol("x");const p=wrap({},{ownKeys(){return [key,"a"]}});const keys=Reflect.ownKeys(p);return [keys.length,keys[0]===key,keys[1]]' },
  { name: "duplicate symbol", source: 'const key=Symbol("x");try{return Reflect.ownKeys(wrap({},{ownKeys(){return [key,key]}}))}catch(e){return e.name}' },
  { name: "proxy array-like trap result", source: 'const events=[];const list=wrap({0:"a",1:"b",length:2},{get(t,k){events.push(k);return t[k]}});return [Reflect.ownKeys(wrap({},{ownKeys(){return list}})),events]' },
  { name: "read all entries before duplicate check", source: 'const events=[];const list={length:3,0:"x",1:"x",get 2(){events.push("last");throw 19}};try{Reflect.ownKeys(wrap({},{ownKeys(){return list}}))}catch(e){return [e,events]}' },
  { name: "target descriptor queries precede missing-key error", source: 'const events=[];const target=wrap(Object.freeze({x:1,y:2}),{getOwnPropertyDescriptor(t,k){events.push(k);return Reflect.getOwnPropertyDescriptor(t,k)}});try{Reflect.ownKeys(wrap(target,{ownKeys(){return []}}))}catch(e){return [e.name,events]}' }
])("matches native Proxy ownKeys details: $name", async ({ source }) => {
  const expected = Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
  const budget = new Budget(), parsed = parseModule(source);
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  })).toMatchObject({ ok: true, returnValue: expected });
});
