import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure } from "./values.js";

it.each([true, false])("honors delete trap refusal with strict=%s", async strict => {
  const body = `${strict ? '"use strict";' : ''}try{return delete p.x}catch(e){return e.name}`;
  const expected = Function("p", body)(new Proxy({}, { deleteProperty: () => false }));
  const budget = new Budget();
  const proxy = createGuestProxy({}, { deleteProperty: createSandboxClosure({ guest: true, call: () => false }) });
  const parsed = parseModule(`return Function("p",${JSON.stringify(body)})(proxy)`);
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), proxy }
  })).toMatchObject({ ok: true, returnValue: expected });
});

it("deletes symbol properties through nested proxy expressions", async () => {
  const budget = new Budget(), key = Symbol("x"), target = { [key]: 1 };
  const proxy = createGuestProxy(createGuestProxy(target, {}), {});
  const parsed = parseModule("return delete proxy[key]");
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { proxy, key }
  })).toMatchObject({ ok: true, returnValue: true });
  expect(Object.hasOwn(target, key)).toBe(false);
});

it("rejects deletion through a revoked proxy expression", async () => {
  const budget = new Budget(), proxy = createGuestProxy({}, {});
  revokeGuestProxy(proxy);
  const parsed = parseModule('try{return delete proxy.x}catch(e){return e.name}');
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), proxy }
  })).toMatchObject({ ok: true, returnValue: "TypeError" });
});

it("executes a guest-authored delete trap with its handler receiver", async () => {
  const budget = new Budget();
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  const parsed = parseModule(`const target={x:1};const handler={calls:0,deleteProperty(t,k){
    this.calls++;return delete t[k];}};const p=wrap(target,handler);
    return [delete p.x,handler.calls,"x" in target]`);
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  })).toMatchObject({ ok: true, returnValue: [true, 1, false] });
});
