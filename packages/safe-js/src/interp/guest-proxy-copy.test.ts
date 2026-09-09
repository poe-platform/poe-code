import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure } from "./values.js";

for (const copy of [
  'const result={...source};',
  'const {...result}=source;',
  'let result;({...result}=source);',
  'function copy({...rest}){return rest}const result=copy(source);'
]) {
  it.each([
    { name: "ordered string and symbol copying", setup: `const events=[];const s=Symbol("s");const label=k=>k===s?"symbol":k;
      const source=wrap({}, {ownKeys(){events.push("keys");return ["b",s,"hidden","missing","a"]},
        getOwnPropertyDescriptor(t,k){events.push("desc:"+label(k));if(k==="missing")return;return {enumerable:k!=="hidden",configurable:true}},
        get(t,k){events.push("get:"+label(k));return label(k)}});`, result: 'return [result.b,result[s],result.a,events]' },
    { name: "nested forwarding", setup: 'const source=wrap(wrap({a:1},{}),{});', result: 'return result' },
    { name: "descriptors may hide configurable properties", setup: 'const source=wrap({a:1},{getOwnPropertyDescriptor(){return undefined}});', result: 'return result' },
    { name: "getter deletes a later key", setup: 'const target={a:1,b:2};const source=wrap(target,{get(t,k){if(k==="a")delete t.b;return t[k]}});', result: 'return result' },
    { name: "getter makes later key enumerable", setup: 'const target={a:1};Object.defineProperty(target,"b",{value:2,configurable:true});const source=wrap(target,{get(t,k){if(k==="a")Object.defineProperty(t,"b",{enumerable:true});return t[k]}});', result: 'return result' },
    { name: "proto key is copied as data", setup: 'const target=Object.create(null);target.__proto__=17;const source=wrap(target,{});', result: 'return [result.__proto__,Object.getPrototypeOf(result)===Object.prototype]' }
  ])(`${copy}: $name`, async ({ setup, result }) => {
    const source = setup + copy + result;
    const expected = Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
    const budget = new Budget(), parsed = parseModule(source);
    const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
    expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
      budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
    })).toMatchObject({ ok: true, returnValue: expected });
  });
}

it.each(['const {[s]:picked,a,...rest}=source;', 'let picked,a,rest;({[s]:picked,a,...rest}=source);'])("rest exclusions skip descriptors: %s", async copy => {
  const source = `const s=Symbol("s");const events=[];const label=k=>k===s?"symbol":k;
    const source=wrap({}, {ownKeys(){events.push("keys");return [s,"a","b"]},
      get(t,k){events.push("get:"+label(k));return label(k)},
      getOwnPropertyDescriptor(t,k){events.push("desc:"+label(k));return {enumerable:true,configurable:true}}});
    ${copy}return [picked,a,rest,events]`;
  const expected = Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
  const budget = new Budget(), parsed = parseModule(source);
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  })).toMatchObject({ ok: true, returnValue: expected });
});

it.each(['return {...proxy}', 'const {...rest}=proxy;return rest', 'let rest;({...rest}=proxy);return rest'])("revoked source rejects copying: %s", async copy => {
  const budget = new Budget(), proxy = createGuestProxy({}, {});
  revokeGuestProxy(proxy);
  const parsed = parseModule(`try{${copy}}catch(e){return e instanceof TypeError}`);
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), proxy }
  })).toMatchObject({ ok: true, returnValue: true });
});

it.each(['return {...source}', 'const {...rest}=source;return rest'])("later getter retains previous copied values: %s", async copy => {
  const budget = new Budget(), payload = { x: 7 };
  const proxy = createGuestProxy({}, {
    ownKeys: createSandboxClosure({ guest: true, call: () => ["a", "b"] }),
    getOwnPropertyDescriptor: createSandboxClosure({ guest: true,
      call: () => ({ configurable: true, enumerable: true }) }),
    get: createSandboxClosure({ guest: true, call: ([, key]) => {
      if (key === "a") return payload;
      const roots = [...budget.retainedValues()];
      expect(roots).toContain(proxy);
      expect(roots).toContainEqual(["a", "b"]);
      expect(roots.some(root => {
        if (typeof root !== "object" || root === null) return false;
        if (Object.getOwnPropertyDescriptor(root, "a")?.value === payload) return true;
        return Array.isArray(root) && root.some(entry => Array.isArray(entry) && entry[0] === "a" && entry[1] === payload);
      })).toBe(true);
      return 2;
    } })
  });
  const parsed = parseModule(copy);
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), source: proxy }
  })).toMatchObject({ ok: true, returnValue: { a: payload, b: 2 } });
});
