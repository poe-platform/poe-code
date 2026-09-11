import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxObject } from "./values.js";
import { createObjectArrayGlobals } from "./globals/object-array.js";

for (const kind of ["Getter", "Setter"]) {
  it.each([
    { name: "virtual own accessor", setup: 'const p=wrap({}, {getOwnPropertyDescriptor(t,k){events.push("desc:"+k);return {get:accessor,set:accessor,configurable:true}},getPrototypeOf(){throw 19}});' },
    { name: "virtual inherited accessor", setup: 'const proto={};Object.defineProperty(proto,"x",{get:accessor,set:accessor});const p=wrap({}, {getOwnPropertyDescriptor(t,k){events.push("desc:"+k);return undefined},getPrototypeOf(){events.push("proto");return proto}});' },
    { name: "data descriptor shadows inherited accessor", setup: 'const proto={};Object.defineProperty(proto,"x",{get:accessor,set:accessor});const p=wrap(Object.create(proto), {getOwnPropertyDescriptor(t,k){events.push("desc:"+k);return {value:1,configurable:true}},getPrototypeOf(){throw 19}});' },
    { name: "ordinary child reaches proxy", setup: 'const proxy=wrap({}, {getOwnPropertyDescriptor(t,k){events.push("desc:"+k);return {get:accessor,set:accessor,configurable:true}}});const p=Object.create(proxy);' }
  ])(`lookup${kind}: $name`, async ({ setup }) => {
    const source = `const events=[];function accessor(){throw 31}${setup}
      const found=Object.prototype.__lookup${kind}__.call(p,"x");return [found===accessor,found===undefined,events]`;
    const expected = Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
    const budget = new Budget(), parsed = parseModule(source);
    const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
    expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
      budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
    })).toMatchObject({ ok: true, returnValue: expected });
  });
}

it.each(["__lookupGetter__", "__lookupSetter__"])("%s bounds cyclic prototype traversal", async name => {
  const budget = new Budget({ maxSteps: 32 });
  const proxy = createGuestProxy({}, { getPrototypeOf: createSandboxClosure({ guest: true, call: () => proxy }) });
  const context: SandboxCallContext = { stack: [], thisValue: proxy,
    getProperty: (value, key) => (value as SandboxObject)[key] };
  const prototype = createObjectArrayGlobals({ budget }).Object.properties!.prototype as SandboxObject;
  await expect((prototype[name] as SandboxClosure).call(["x"], context))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
  expect([...budget.retainedValues()]).toEqual([]);
});

it("retains a virtual prototype across later descriptor traps", async () => {
  const budget = new Budget(), marker = new Error("descriptor failure");
  const virtual = createGuestProxy({}, { getOwnPropertyDescriptor: createSandboxClosure({ guest: true, call: () => {
    expect([...budget.retainedValues()]).toContain(virtual);
    throw marker;
  } }) });
  const proxy = createGuestProxy({}, { getPrototypeOf: createSandboxClosure({ guest: true, call: () => virtual }) });
  const context: SandboxCallContext = { stack: [], thisValue: proxy,
    getProperty: (value, key) => (value as SandboxObject)[key] };
  const prototype = createObjectArrayGlobals({ budget }).Object.properties!.prototype as SandboxObject;
  await expect((prototype.__lookupGetter__ as SandboxClosure).call(["x"], context)).rejects.toBe(marker);
  expect([...budget.retainedValues()]).toEqual([]);
});
