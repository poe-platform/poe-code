import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure } from "./values.js";

it.each([
  { target: '{}', tag: '"Custom"' },
  { target: '[]', tag: 'undefined' },
  { target: '[]', tag: '17' },
  { target: '{}', tag: 'undefined' },
  { target: 'new Date(0)', tag: 'undefined' },
  { target: '[]', tag: '"Override"' }
])("Proxy object tag: $target / $tag", async ({ target, tag }) => {
  const source = `const events=[];const p=wrap(${target},{get(t,k,r){events.push([k===Symbol.toStringTag,r===p]);return ${tag}},
    getOwnPropertyDescriptor(){throw 19},getPrototypeOf(){throw 20}});return [Object.prototype.toString.call(p),events]`;
  const expected = Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
  const budget = new Budget(), parsed = parseModule(source);
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  })).toMatchObject({ ok: true, returnValue: expected });
});

it("revocation is checked before reading a custom tag", async () => {
  const budget = new Budget(), proxy = createGuestProxy({}, { get: createSandboxClosure({ guest: true, call: () => "Custom" }) });
  revokeGuestProxy(proxy);
  const parsed = parseModule('try{Object.prototype.toString.call(proxy);return false}catch(e){return e instanceof TypeError}');
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), proxy }
  })).toMatchObject({ ok: true, returnValue: true });
});
