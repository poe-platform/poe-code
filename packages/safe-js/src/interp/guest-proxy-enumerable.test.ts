import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxObject } from "./values.js";
import { createObjectArrayGlobals } from "./globals/object-array.js";

for (const method of ["keys", "values", "entries"]) {
  it.each([
    { name: "ordered string descriptors and conditional gets", body: `const events=[];const s=Symbol("s");
      const p=wrap({}, {ownKeys(){events.push("keys");return ["b",s,"hidden","missing","a"]},
        getOwnPropertyDescriptor(t,k){events.push("desc:"+k);if(k==="missing")return;return {value:99,enumerable:k!=="hidden",configurable:true}},
        get(t,k){events.push("get:"+k);return k+"!"}});
      return [Object.METHOD(p),events]` },
    { name: "checks enumerability at each descriptor query", body: `const target={a:1};Object.defineProperty(target,"b",{value:2,configurable:true});
      const p=wrap(target,{getOwnPropertyDescriptor(t,k){if(k==="a")Object.defineProperty(t,"b",{enumerable:true});return Reflect.getOwnPropertyDescriptor(t,k)}});
      return Object.METHOD(p)` },
    { name: "does not enumerate keys added after ownKeys", body: `const target={a:1};const p=wrap(target,{
      getOwnPropertyDescriptor(t,k){t.b=2;return Reflect.getOwnPropertyDescriptor(t,k)}});return Object.METHOD(p)` },
    { name: "nested fallback", body: 'return Object.METHOD(wrap(wrap({b:2,a:1},{}),{}))' },
    { name: "value read can remove a later property", body: `const target={a:1,b:2};const p=wrap(target,{
      get(t,k){if(k==="a")delete t.b;return t[k]}});return Object.METHOD(p)` },
    { name: "getter errors affect values but not keys", body: `const p=wrap({get a(){throw 31}},{});
      try{return Object.METHOD(p)}catch(e){return e}` },
    { name: "descriptor exceptions stop traversal", body: `const events=[];const p=wrap({}, {ownKeys(){return ["a","b"]},
      getOwnPropertyDescriptor(t,k){events.push(k);throw 21}});try{Object.METHOD(p)}catch(e){return [e,events]}` }
  ])(`Object.${method}: $name`, async ({ body }) => {
    const source = body.replaceAll("METHOD", method);
    const expected = Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
    const budget = new Budget(), parsed = parseModule(source);
    const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
    expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
      budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
    })).toMatchObject({ ok: true, returnValue: expected });
  });
}

it.each(["keys", "values", "entries"])("Object.%s rejects revoked proxies without leaking roots", async name => {
  const budget = new Budget(), proxy = createGuestProxy({}, {});
  revokeGuestProxy(proxy);
  const method = createObjectArrayGlobals({ budget }).Object.properties![name] as SandboxClosure;
  await expect(method.call([proxy])).rejects.toThrow(TypeError);
  expect([...budget.retainedValues()]).toEqual([]);
});

it.each(["keys", "values", "entries"])("Object.%s retains partial results across later traps", async name => {
  const budget = new Budget(), payload = { x: 7 }, marker = new Error("later trap");
  const proxy = createGuestProxy({}, {
    ownKeys: createSandboxClosure({ guest: true, call: () => ["a", "b"] }),
    get: createSandboxClosure({ guest: true, call: () => payload }),
    getOwnPropertyDescriptor: createSandboxClosure({ guest: true, call: ([, key]) => {
      if (key === "a") return { value: 0, enumerable: true, configurable: true };
      const roots = [...budget.retainedValues()];
      expect(roots).toContain(proxy);
      expect(roots).toContainEqual(["a", "b"]);
      expect(roots.some(root => Array.isArray(root) && root.length === 1 && (
        name === "keys" ? root[0] === "a" : name === "values" ? root[0] === payload
          : Array.isArray(root[0]) && root[0][0] === "a" && root[0][1] === payload
      ))).toBe(true);
      throw marker;
    } })
  });
  const context: SandboxCallContext = { stack: [], thisValue: undefined,
    getProperty: (value, key) => value === proxy ? payload : (value as SandboxObject)[key] };
  const method = createObjectArrayGlobals({ budget }).Object.properties![name] as SandboxClosure;
  await expect(method.call([proxy], context)).rejects.toBe(marker);
  expect([...budget.retainedValues()]).toEqual([]);
});
