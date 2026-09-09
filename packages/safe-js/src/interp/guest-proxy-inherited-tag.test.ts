import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure } from "./values.js";

for (const target of ['{}', '[]', 'new Date(0)', '(function(){})', 'new Map()', 'new Set()', 'new Uint8Array(2)']) {
  it.each(['"Custom"', 'undefined'])("inherited Proxy tag on %s", async tag => {
    const source = `const value=${target};const events=[];const proto=wrap({}, {get(t,k,r){events.push([k===Symbol.toStringTag,r===value]);return ${tag}},getOwnPropertyDescriptor(){throw 19}});
      Object.setPrototypeOf(value,proto);return [Object.prototype.toString.call(value),events]`;
    const expected = Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
    const budget = new Budget(), parsed = parseModule(source);
    const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
    expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
      budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
    })).toMatchObject({ ok: true, returnValue: expected });
  });
}

it.each([
  'const proto=wrap({},{get(){throw 31}});const value=Object.create(proto);value[Symbol.toStringTag]="Own";return Object.prototype.toString.call(value)',
  'const proto=wrap({},{get(){throw 31}});try{return Object.prototype.toString.call(Object.create(proto))}catch(e){return e}'
])("inherited tag shadowing and failure: %s", async source => {
  const expected = Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
  const budget = new Budget(), parsed = parseModule(source);
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  })).toMatchObject({ ok: true, returnValue: expected });
});
