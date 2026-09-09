import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure } from "./values.js";

for (const operation of ['Object.hasOwn(p,key)', 'Object.prototype.hasOwnProperty.call(p,key)', 'Object.prototype.propertyIsEnumerable.call(p,key)']) {
  it.each([
    { name: "virtual enumerable descriptor", descriptor: '{value:1,enumerable:true,configurable:true}', target: '{}' },
    { name: "virtual hidden descriptor", descriptor: '{value:1,enumerable:false,configurable:true}', target: '{}' },
    { name: "absent descriptor", descriptor: 'undefined', target: '{x:1}' },
    { name: "protected descriptor cannot be hidden", descriptor: 'undefined', target: 'Object.freeze({x:1})' }
  ])(`${operation}: $name`, async ({ descriptor, target }) => {
    const source = `const events=[];const key={toString(){events.push("key");return "x"}};
      const p=wrap(${target},{getOwnPropertyDescriptor(t,k){events.push("descriptor:"+k);return ${descriptor}},has(){throw 31},get(){throw 32}});
      let result;try{result=${operation}}catch(e){result=e.name}return [result,events]`;
    const expected = Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
    const budget = new Budget(), parsed = parseModule(source);
    const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
    expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
      budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
    })).toMatchObject({ ok: true, returnValue: expected });
  });

  it(`${operation}: nested target and symbol identity`, async () => {
    const source = `const key=Symbol("x");const p=wrap(wrap({[key]:1},{}),{});return ${operation}`;
    const expected = Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
    const budget = new Budget(), parsed = parseModule(source);
    const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
    expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
      budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
    })).toMatchObject({ ok: true, returnValue: expected });
  });

  it(`${operation}: nullish receiver coercion order`, async () => {
    const source = `const p=null;const events=[];const key={toString(){events.push("key");return "x"}};
      try{${operation}}catch(e){return [e.name,events]}`;
    const budget = new Budget(), parsed = parseModule(source);
    expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
      budget, bindings: createBuiltinBindings({ budget })
    })).toMatchObject({ ok: true, returnValue: Function(source)() });
  });

  it(`${operation}: revocation during key conversion`, async () => {
    const budget = new Budget(), p = createGuestProxy({ x: 1 }, {});
    const revoke = createSandboxClosure({ guest: true, call: () => { revokeGuestProxy(p); return "x"; } });
    const source = `const key={toString(){return revoke()}};try{return ${operation}}catch(e){return e instanceof TypeError}`;
    const parsed = parseModule(source);
    expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
      budget, bindings: { ...createBuiltinBindings({ budget }), p, revoke }
    })).toMatchObject({ ok: true, returnValue: true });
  });
}
