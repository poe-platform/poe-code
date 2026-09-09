import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { sandboxSetProperty } from "./guest-proxy-set.js";
import { createSandboxClosure, type SandboxCallContext } from "./values.js";

it.each([
  { name: "truthy virtual write", setup: "", value: "2", result: '"yes"' },
  { name: "refusal", setup: "", value: "2", result: "false" },
  { name: "matching frozen", setup: 'Object.defineProperty(target,"x",{value:1});', value: "1", result: "true" },
  { name: "changed frozen", setup: 'Object.defineProperty(target,"x",{value:1});', value: "2", result: "true" },
  { name: "same NaN", setup: 'Object.defineProperty(target,"x",{value:NaN});', value: "NaN", result: "true" },
  { name: "signed zero", setup: 'Object.defineProperty(target,"x",{value:-0});', value: "0", result: "true" },
  { name: "setterless lie", setup: 'Object.defineProperty(target,"x",{get:undefined});', value: "2", result: "true" },
  { name: "configurable setterless", setup: 'Object.defineProperty(target,"x",{get:undefined,configurable:true});', value: "2", result: "true" },
  { name: "nonextensible virtual write", setup: 'Object.preventExtensions(target);', value: "2", result: "true" }
])("matches native Proxy set invariants: $name", async ({ setup, value, result }) => {
  const source = `const target={};${setup}const receiver={};const calls=[];
    const handler={set(t,k,v,r){calls.push([t===target,k,v,r===receiver,this===handler]);return ${result}}};
    const p=wrap(target,handler);let outcome;try{outcome=Reflect.set(p,"x",${value},receiver)}catch(e){outcome=e.name}
    return [outcome,calls,Object.getOwnPropertyDescriptor(target,"x"),Object.getOwnPropertyDescriptor(receiver,"x")]`;
  const expected = Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
  const budget = new Budget(), parsed = parseModule(source);
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  })).toMatchObject({ ok: true, returnValue: expected });
});

it("retains write operands across trap lookup and releases them after refusal", async () => {
  const budget = new Budget(), value = { payload: "value" }, receiver = { payload: "receiver" };
  const trap = createSandboxClosure({ guest: true, call: () => false });
  const context: SandboxCallContext = { stack: [], thisValue: undefined, getProperty: async () => {
    expect([...budget.retainedValues()]).toContain(value);
    expect([...budget.retainedValues()]).toContain(receiver);
    return trap;
  } };
  expect(await sandboxSetProperty(createGuestProxy({}, {}), "x", value, receiver, budget, context)).toBe(false);
  expect([...budget.retainedValues()]).toEqual([]);
});

it("rejects revoked writes without leaking retained operands", async () => {
  const budget = new Budget(), proxy = createGuestProxy({}, {});
  revokeGuestProxy(proxy);
  await expect(sandboxSetProperty(proxy, "x", {}, {}, budget)).rejects.toThrow(TypeError);
  expect([...budget.retainedValues()]).toEqual([]);
});

it("bounds recursive set fallback", async () => {
  const budget = new Budget({ maxSteps: 8 });
  let target = {};
  for (let i = 0; i < 32; i += 1) target = createGuestProxy(target, {});
  const context: SandboxCallContext = { stack: [], thisValue: undefined, getProperty: () => undefined };
  await expect(sandboxSetProperty(target, "x", 1, target, budget, context))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  expect([...budget.retainedValues()]).toEqual([]);
});

it.each([
  { name: "nested fallback", source: 'const target={x:1};const p=wrap(wrap(target,{}),{});return [Reflect.set(p,"x",7),target.x]' },
  { name: "inherited proxy setter", source: 'const calls=[];const p=wrap({},{set(t,k,v,r){calls.push([k,v,r===child]);return true}});const child=Object.create(p);return [Reflect.set(child,"x",8),calls,Object.hasOwn(child,"x")]' },
  { name: "proxy receiver descriptor dispatch", source: 'const events=[];const receiver=wrap({},{getOwnPropertyDescriptor(t,k){events.push("descriptor:"+k);return undefined},defineProperty(t,k,d){events.push([k,d]);return true}});return [Reflect.set({x:1},"x",9,receiver),events]' },
  { name: "receiver accessor rejection", source: 'const receiver=wrap({},{getOwnPropertyDescriptor(){return {get:undefined,configurable:true}},defineProperty(){throw Error("unexpected")}});return Reflect.set({x:1},"x",9,receiver)' },
  { name: "inherited accessor receiver", source: 'let seen;const target=Object.create({set x(v){seen=[this===p,v]}});const p=wrap(target,{});return [Reflect.set(p,"x",10),seen]' },
  { name: "explicit undefined receiver", source: 'let seen;const p=wrap({},{set(t,k,v,r){seen=r===undefined;return true}});return [Reflect.set(p,"x",1,undefined),seen]' },
  { name: "refusal skips invariants", source: 'const target=wrap({},{getOwnPropertyDescriptor(){throw Error("unexpected")}});return Reflect.set(wrap(target,{set(){return false}}),"x",1)' },
  { name: "typed array fallback", source: 'const target=new Uint8Array(1);return [Reflect.set(wrap(target,{}),"0",258),target[0]]' }
])("matches native Proxy set forwarding: $name", async ({ source }) => {
  const expected = Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
  const budget = new Budget(), parsed = parseModule(source);
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  })).toMatchObject({ ok: true, returnValue: expected });
});
