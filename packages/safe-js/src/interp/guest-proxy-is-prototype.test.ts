import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxObject } from "./values.js";
import { createObjectArrayGlobals } from "./globals/object-array.js";

it.each([
  { name: "virtual immediate prototype", source: 'const proto={};const events=[];const p=wrap({},{getPrototypeOf(){events.push("prototype");return proto}});return [proto.isPrototypeOf(p),events]' },
  { name: "ordinary child reaches Proxy boundary", source: 'const proto={};const p=wrap({},{getPrototypeOf(){return proto}});return proto.isPrototypeOf(Object.create(p))' },
  { name: "nested forwarding", source: 'const proto={};const p=wrap(wrap(Object.create(proto),{}),{});return proto.isPrototypeOf(p)' },
  { name: "identity stops before querying matched Proxy", source: 'const proto=wrap({},{getPrototypeOf(){throw 19}});const p=wrap({},{getPrototypeOf(){return proto}});return Object.prototype.isPrototypeOf.call(proto,p)' },
  { name: "trap error propagates", source: 'const p=wrap({},{getPrototypeOf(){throw 31}});try{({}).isPrototypeOf(p)}catch(e){return e}' },
  { name: "nonextensible invariant enforced", source: 'const p=wrap(Object.preventExtensions({}),{getPrototypeOf(){return {}}});try{({}).isPrototypeOf(p)}catch(e){return e.name}' },
  { name: "primitive argument skips null receiver check", source: 'return Object.prototype.isPrototypeOf.call(null,17)' }
])("Proxy isPrototypeOf: $name", async ({ source }) => {
  const expected = Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
  const budget = new Budget(), parsed = parseModule(source);
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  })).toMatchObject({ ok: true, returnValue: expected });
});

it("bounds cyclic virtual prototype chains", async () => {
  const budget = new Budget({ maxSteps: 32 });
  const proxy = createGuestProxy({}, {
    getPrototypeOf: createSandboxClosure({ guest: true, call: () => proxy })
  });
  const context: SandboxCallContext = { stack: [], thisValue: {},
    getProperty: (value, key) => (value as SandboxObject)[key] };
  const prototype = createObjectArrayGlobals({ budget }).Object.properties!.prototype as SandboxObject;
  await expect((prototype.isPrototypeOf as SandboxClosure).call([proxy], context))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  expect([...budget.retainedValues()]).toEqual([]);
});

it("retains receiver and chain node during traps and releases on failure", async () => {
  const budget = new Budget(), receiver = {}, marker = new Error("prototype failure");
  const proxy = createGuestProxy({}, {
    getPrototypeOf: createSandboxClosure({ guest: true, call: () => {
      expect([...budget.retainedValues()]).toContain(receiver);
      expect([...budget.retainedValues()]).toContain(proxy);
      throw marker;
    } })
  });
  const context: SandboxCallContext = { stack: [], thisValue: receiver,
    getProperty: (value, key) => (value as SandboxObject)[key] };
  const prototype = createObjectArrayGlobals({ budget }).Object.properties!.prototype as SandboxObject;
  await expect((prototype.isPrototypeOf as SandboxClosure).call([proxy], context)).rejects.toBe(marker);
  expect([...budget.retainedValues()]).toEqual([]);
});
