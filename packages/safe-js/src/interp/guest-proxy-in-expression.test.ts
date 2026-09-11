import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure } from "./values.js";

it.each([false, true])("calls guest-authored has traps through inherited=%s references", async inherited => {
  const budget = new Budget();
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  const parsed = parseModule(`const key=Symbol("x");const handler={calls:0,has(t,k){this.calls++;return k===key}};
    const proxy=wrap({},handler);const value=${inherited ? 'Object.create(proxy)' : 'proxy'};
    return [key in value,"missing" in value,handler.calls]`);
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  })).toMatchObject({ ok: true, returnValue: [true, false, 2] });
});

it("forwards in queries to the proxy target", async () => {
  const budget = new Budget(), proxy = createGuestProxy({ x: 1 }, {});
  const parsed = parseModule('return "x" in proxy');
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { proxy }
  })).toMatchObject({ ok: true, returnValue: true });
});

it("enforces frozen property invariants through in expressions", async () => {
  const budget = new Budget();
  const proxy = createGuestProxy(Object.freeze({ x: 1 }), { has: createSandboxClosure({ guest: true, call: () => false }) });
  const parsed = parseModule('try{return "x" in proxy}catch(e){return e.name}');
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), proxy }
  })).toMatchObject({ ok: true, returnValue: "TypeError" });
});

it("converts the key before validating a revoked proxy", async () => {
  const budget = new Budget(), proxy = createGuestProxy({}, {});
  revokeGuestProxy(proxy);
  const parsed = parseModule('let calls=0;const key={toString(){calls++;return "x"}};try{return key in proxy}catch(e){return [e.name,calls]}');
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), proxy }
  })).toMatchObject({ ok: true, returnValue: ["TypeError", 1] });
});
