import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure, type SandboxValue } from "./values.js";
import { sandboxIsArray } from "./guest-proxy-array.js";

it.each(['[]', '{}', 'new Uint8Array(2)'])("Array.isArray follows nested Proxy targets: %s", async target => {
  const source = `const handler={get(){throw 1},getPrototypeOf(){throw 2}};
    return Array.isArray(wrap(wrap(${target},handler),handler))`;
  const expected = Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
  const budget = new Budget(), parsed = parseModule(source);
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  })).toMatchObject({ ok: true, returnValue: expected });
});

it("bounds deeply nested proxy identity checks without native recursion", () => {
  let value: SandboxValue = [];
  for (let i = 0; i < 100; i += 1) value = createGuestProxy(value, {});
  expect(() => sandboxIsArray(value, new Budget({ maxSteps: 16 })))
    .toThrow(expect.objectContaining({ code: "budgetExceeded", budget: "steps" }));
  expect(sandboxIsArray(value, new Budget())).toBe(true);
});

it.each([[], {}])("Array.isArray rejects a revoked target", async target => {
  const budget = new Budget(), inner = createGuestProxy(target, {});
  revokeGuestProxy(inner);
  const proxy = createGuestProxy(inner, {});
  const parsed = parseModule('try{Array.isArray(proxy);return false}catch(e){return e instanceof TypeError}');
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), proxy }
  })).toMatchObject({ ok: true, returnValue: true });
});
