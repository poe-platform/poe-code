import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure, type SandboxCallContext, type SandboxObject } from "./values.js";
import { ordinaryHasInstance } from "./instanceof.js";

it.each([
  'function C(){}const events=[];const p=wrap({},{getPrototypeOf(){events.push("proto");return C.prototype}});return [p instanceof C,events]',
  'function C(){}const p=wrap({},{getPrototypeOf(){return C.prototype}});return Object.create(p) instanceof C',
  'function C(){}const p=wrap(wrap(new C(),{}),{});return p instanceof C',
  'function C(){}const proto=wrap({},{getPrototypeOf(){throw 19}});C.prototype=proto;const p=wrap({},{getPrototypeOf(){return proto}});return p instanceof C',
  'function C(){}const p=wrap({},{getPrototypeOf(){throw 31}});try{return p instanceof C}catch(e){return e}',
  'function C(){}const p=wrap(Object.preventExtensions({}),{getPrototypeOf(){return C.prototype}});try{return p instanceof C}catch(e){return e.name}',
  'function C(){}const B=C.bind(null);const p=wrap({},{getPrototypeOf(){return C.prototype}});return p instanceof B'
])("Proxy instanceof traversal: %s", async source => {
  const expected = Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
  const budget = new Budget(), parsed = parseModule(source);
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  })).toMatchObject({ ok: true, returnValue: expected });
});

it("bounds virtual cycles during ordinary instanceof", async () => {
  const budget = new Budget({ maxSteps: 32 }), prototype = {};
  const constructor = createSandboxClosure({ guest: true, call: () => undefined });
  const proxy = createGuestProxy({}, { getPrototypeOf: createSandboxClosure({ guest: true, call: () => proxy }) });
  const context: SandboxCallContext = { stack: [], thisValue: undefined,
    getProperty: (value, key) => value === constructor && key === "prototype" ? prototype : (value as SandboxObject)[key] };
  await expect(ordinaryHasInstance(proxy, constructor, budget, context))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  expect([...budget.retainedValues()]).toEqual([]);
});

it("retains the expected prototype across failing chain traps", async () => {
  const budget = new Budget(), prototype = {}, marker = new Error("chain failure");
  const constructor = createSandboxClosure({ guest: true, call: () => undefined });
  const proxy = createGuestProxy({}, { getPrototypeOf: createSandboxClosure({ guest: true, call: () => {
    expect([...budget.retainedValues()]).toContain(prototype);
    expect([...budget.retainedValues()]).toContain(proxy);
    throw marker;
  } }) });
  const context: SandboxCallContext = { stack: [], thisValue: undefined,
    getProperty: (value, key) => value === constructor && key === "prototype" ? prototype : (value as SandboxObject)[key] };
  await expect(ordinaryHasInstance(proxy, constructor, budget, context)).rejects.toBe(marker);
  expect([...budget.retainedValues()]).toEqual([]);
});
