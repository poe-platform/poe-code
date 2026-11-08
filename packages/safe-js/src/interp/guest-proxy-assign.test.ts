import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxObject } from "./values.js";
import { createObjectArrayGlobals } from "./globals/object-array.js";

it.each([
  { name: "ordered keys descriptors gets and target sets", source: `const events=[];const s=Symbol("s");
    const label=k=>k===s?"symbol":k;const source=wrap({}, {ownKeys(){events.push("keys");return ["b",s,"hidden","missing","a"]},
      getOwnPropertyDescriptor(t,k){events.push("desc:"+label(k));if(k==="missing")return;return {value:0,enumerable:k!=="hidden",configurable:true}},
      get(t,k){events.push("get:"+label(k));return label(k)}});
    const out={};const target=wrap(out,{set(t,k,v){events.push("set:"+label(k));t[k]=v;return true}});
    return [Object.assign(target,source)===target,out.b,out[s],out.a,events]` },
  { name: "nested source forwarding", source: 'return Object.assign({},wrap(wrap({b:2,a:1},{}),{}))' },
  { name: "getter deletes later property", source: `const target={a:1,b:2};const source=wrap(target,{get(t,k){if(k==="a")delete t.b;return t[k]}});return Object.assign({},source)` },
  { name: "setter affects source before next descriptor", source: `const source={a:1};Object.defineProperty(source,"b",{value:2,configurable:true});
    const target={set a(v){Object.defineProperty(source,"b",{enumerable:true})}};Object.assign(target,wrap(source,{}));return target.b` },
  { name: "failing target set prevents later reads", source: `const events=[];const source=wrap({a:1,b:2},{get(t,k){events.push(k);return t[k]}});
    const target=wrap({}, {set(){return false}});try{Object.assign(target,source)}catch(e){return [e.name,events]}` },
  { name: "source key error preserves earlier source effects", source: `const out={};try{Object.assign(out,{a:1},wrap({}, {ownKeys(){throw 37}}),{b:2})}catch(e){return [e,out]}` },
  { name: "values preserve identity", source: `const value={x:1};const source=wrap({}, {ownKeys(){return ["a"]},getOwnPropertyDescriptor(){return {enumerable:true,configurable:true}},get(){return value}});
    return Object.assign({},source).a===value` }
])("Object.assign Proxy source: $name", async ({ source }) => {
  const expected = Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
  const budget = new Budget(), parsed = parseModule(source);
  const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
  expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
    budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
  })).toMatchObject({ ok: true, returnValue: expected });
});

it("rejects a revoked source in a direct internal call", async () => {
  const budget = new Budget(), source = createGuestProxy({}, {});
  revokeGuestProxy(source);
  const method = createObjectArrayGlobals({ budget }).Object.properties!.assign as SandboxClosure;
  await expect(method.call([{}, source])).rejects.toThrow(TypeError);
  expect([...budget.retainedValues()]).toEqual([]);
});

it("retains source keys and current value across target traps and releases on failure", async () => {
  const budget = new Budget(), payload = { x: 1 }, marker = new Error("set failure");
  const source = createGuestProxy({}, {
    ownKeys: createSandboxClosure({ guest: true, call: () => ["a", "b"] }),
    getOwnPropertyDescriptor: createSandboxClosure({ guest: true,
      call: () => ({ value: 0, configurable: true, enumerable: true }) })
  });
  const target = createGuestProxy({}, {
    set: createSandboxClosure({ guest: true, call: () => {
      const roots = [...budget.retainedValues()];
      expect(roots).toContain(source);
      expect(roots).toContain(target);
      expect(roots).toContain(payload);
      expect(roots).toContainEqual(["a", "b"]);
      throw marker;
    } })
  });
  const context: SandboxCallContext = { stack: [], thisValue: undefined,
    getProperty: (value, key) => value === source ? payload : (value as SandboxObject)[key] };
  const method = createObjectArrayGlobals({ budget }).Object.properties!.assign as SandboxClosure;
  await expect(method.call([target, source], context)).rejects.toBe(marker);
  expect([...budget.retainedValues()]).toEqual([]);
});
