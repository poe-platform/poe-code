import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure, type SandboxCallContext, type SandboxObject } from "./values.js";
import { testGuestProxyIntegrity } from "./guest-proxy-integrity.js";

for (const method of ["isFrozen", "isSealed"]) {
  it.each([
    { name: "extensible short circuit", setup: 'const target={a:1};' },
    { name: "nonextensible configurable short circuit", setup: 'const target=Object.preventExtensions({a:1,b:2});' },
    { name: "sealed writable data", setup: 'const target=Object.seal({a:1,b:2});' },
    { name: "frozen data", setup: 'const target=Object.freeze({a:1,b:2});' },
    { name: "frozen accessor and symbol", setup: 'const target=Object.freeze({get a(){throw 17},[Symbol("s")]:2});' },
    { name: "empty nonextensible", setup: 'const target=Object.preventExtensions({});' }
  ])(`Object.${method}: $name`, async ({ setup }) => {
    const source = `${setup}const events=[];const p=wrap(target,{
      isExtensible(t){events.push("extensible");return Reflect.isExtensible(t)},
      ownKeys(t){events.push("keys");return Reflect.ownKeys(t)},
      getOwnPropertyDescriptor(t,k){events.push(typeof k==="symbol"?"symbol":k);return Reflect.getOwnPropertyDescriptor(t,k)},
      get(){throw 19}});return [Object.${method}(p),events]`;
    const expected = Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
    const budget = new Budget(), parsed = parseModule(source);
    const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
    expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
      budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
    })).toMatchObject({ ok: true, returnValue: expected });
  });
}

it.each(["sealed", "frozen"] as const)("%s rejects revoked proxies", async level => {
  const budget = new Budget(), proxy = createGuestProxy({}, {});
  revokeGuestProxy(proxy);
  await expect(testGuestProxyIntegrity(proxy, level, budget)).rejects.toThrow(TypeError);
  expect([...budget.retainedValues()]).toEqual([]);
});

it.each(["sealed", "frozen"] as const)("%s retains keys through descriptor failures", async level => {
  const budget = new Budget(), marker = new Error("descriptor failure");
  const proxy = createGuestProxy(Object.preventExtensions({ a: 1 }), {
    getOwnPropertyDescriptor: createSandboxClosure({ guest: true, call: () => {
      const roots = [...budget.retainedValues()];
      expect(roots).toContain(proxy);
      expect(roots).toContainEqual(["a"]);
      throw marker;
    } })
  });
  const context: SandboxCallContext = { stack: [], thisValue: undefined,
    getProperty: (value, key) => (value as SandboxObject)[key] };
  await expect(testGuestProxyIntegrity(proxy, level, budget, context)).rejects.toBe(marker);
  expect([...budget.retainedValues()]).toEqual([]);
});
