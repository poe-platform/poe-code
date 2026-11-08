import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxObject } from "./values.js";
import { createObjectArrayGlobals } from "./globals/object-array.js";

it.each([
  { name: "ordered descriptor queries without value reads", source: `const events=[];
    const p=wrap({}, {ownKeys(){events.push("keys");return ["b","a"]},
      getOwnPropertyDescriptor(t,k){events.push(k);return {value:k,configurable:true}},get(){throw 17}});
    const d=Object.getOwnPropertyDescriptors(p);return [d,events]` },
  { name: "skips disappeared properties", source: `const target={a:1,b:2};const events=[];
    const p=wrap(target,{getOwnPropertyDescriptor(t,k){events.push(k);if(k==="a")delete t.b;return Reflect.getOwnPropertyDescriptor(t,k)}});
    return [Object.getOwnPropertyDescriptors(p),events]` },
  { name: "symbol descriptors preserve accessor identity", source: `const s=Symbol("s");function getter(){throw 19}
    const p=wrap({}, {ownKeys(){return [s]},getOwnPropertyDescriptor(){return {get:getter,configurable:true}}});
    const d=Object.getOwnPropertyDescriptors(p);return [Reflect.ownKeys(d)[0]===s,d[s].get===getter,d[s].set,d[s].enumerable]` },
  { name: "defines proto as an own data property", source: `const p=wrap({}, {ownKeys(){return ["__proto__"]},
    getOwnPropertyDescriptor(){return {value:23,configurable:true}}});const d=Object.getOwnPropertyDescriptors(p);
    return [Object.hasOwn(d,"__proto__"),d.__proto__.value,Object.getPrototypeOf(d)===Object.prototype]` },
  { name: "propagates descriptor failures in order", source: `const events=[];const p=wrap({}, {
    ownKeys(){return ["a","b","c"]},getOwnPropertyDescriptor(t,k){events.push(k);if(k==="b")throw 41;return {value:1,configurable:true}}});
    try{Object.getOwnPropertyDescriptors(p)}catch(e){return [e,events]}` },
  { name: "nested forwarding", source: 'return Object.getOwnPropertyDescriptors(wrap(wrap({a:1},{}),{}))' }
])("matches native Proxy descriptor enumeration: $name", async ({ source }) => {
  const expected = Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
  const budget = new Budget(), parsed = parseModule(source);
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  })).toMatchObject({ ok: true, returnValue: expected });
});

it("rejects enumeration of a revoked Proxy", async () => {
  const budget = new Budget(), proxy = createGuestProxy({}, {});
  revokeGuestProxy(proxy);
  const parsed = parseModule('try{Object.getOwnPropertyDescriptors(proxy);return false}catch(e){return e instanceof TypeError}');
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), proxy }
  })).toMatchObject({ ok: true, returnValue: true });
});

it("retains accumulated descriptors during later traps and releases on failure", async () => {
  const budget = new Budget(), payload = { value: 19 }, marker = new Error("later trap");
  const proxy = createGuestProxy({}, {
    ownKeys: createSandboxClosure({ guest: true, call: () => ["a", "b"] }),
    getOwnPropertyDescriptor: createSandboxClosure({ guest: true, call: ([, key]) => {
      if (key === "a") return { value: payload, configurable: true };
      const roots = [...budget.retainedValues()];
      expect(roots).toContain(proxy);
      expect(roots).toContainEqual(["a", "b"]);
      expect(roots.some(root => {
        if (typeof root !== "object" || root === null) return false;
        const descriptor = Object.getOwnPropertyDescriptor(root, "a")?.value;
        return descriptor?.value === payload;
      })).toBe(true);
      throw marker;
    } })
  });
  const context: SandboxCallContext = { stack: [], thisValue: undefined,
    getProperty: (value, key) => (value as SandboxObject)[key] };
  const method = createObjectArrayGlobals({ budget }).Object.properties!.getOwnPropertyDescriptors as SandboxClosure;
  await expect(method.call([proxy], context)).rejects.toBe(marker);
  expect([...budget.retainedValues()]).toEqual([]);
});
