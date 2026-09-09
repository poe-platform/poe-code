import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure, type SandboxCallContext, type SandboxObject } from "./values.js";
import { setGuestProxyIntegrity } from "./guest-proxy-integrity.js";

for (const method of ["seal", "freeze"]) {
  it.each([
    { name: "ordered data accessor and symbol definitions", setup: 'const s=Symbol("s");const target={a:1,get b(){throw 29},[s]:2};', prevent: 'return Reflect.preventExtensions(t)', define: 'return Reflect.defineProperty(t,k,d)' },
    { name: "refused prevention stops traversal", setup: 'const s=Symbol("s");const target={a:1};', prevent: 'return false', define: 'return Reflect.defineProperty(t,k,d)' },
    { name: "lying prevention is rejected", setup: 'const s=Symbol("s");const target={a:1};', prevent: 'return true', define: 'return Reflect.defineProperty(t,k,d)' },
    { name: "refused definition preserves earlier changes", setup: 'const s=Symbol("s");const target={a:1,b:2,c:3};', prevent: 'return Reflect.preventExtensions(t)', define: 'return k!=="b"&&Reflect.defineProperty(t,k,d)' }
  ])(`Object.${method}: $name`, async ({ setup, prevent, define }) => {
    const source = `${setup}const events=[];const label=k=>k===s?"symbol":k;
      const p=wrap(target,{preventExtensions(t){events.push("prevent");${prevent}},ownKeys(t){events.push("keys");return Reflect.ownKeys(t)},
        getOwnPropertyDescriptor(t,k){events.push("desc:"+label(k));return Reflect.getOwnPropertyDescriptor(t,k)},
        defineProperty(t,k,d){events.push(["define:"+label(k),Object.keys(d),d.configurable,d.writable]);${define}}});
      let result;try{result=Object.${method}(p)===p}catch(e){result=e.name}
      return [result,events,Object.isExtensible(target),Reflect.ownKeys(target).map(k=>[label(k),Object.getOwnPropertyDescriptor(target,k).configurable,Object.getOwnPropertyDescriptor(target,k).writable])]`;
    const expected = Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
    const budget = new Budget(), parsed = parseModule(source);
    const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
    expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
      budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
    })).toMatchObject({ ok: true, returnValue: expected });
  });
}

it.each(["sealed", "frozen"] as const)("%s rejects revocation and releases roots", async level => {
  const budget = new Budget(), proxy = createGuestProxy({}, {});
  revokeGuestProxy(proxy);
  await expect(setGuestProxyIntegrity(proxy, level, budget)).rejects.toThrow(TypeError);
  expect([...budget.retainedValues()]).toEqual([]);
});

it.each(["sealed", "frozen"] as const)("%s retains keys during definitions and releases after failure", async level => {
  const budget = new Budget(), target = { a: 1 }, marker = new Error("definition failure");
  const proxy = createGuestProxy(target, {
    defineProperty: createSandboxClosure({ guest: true, call: () => {
      const roots = [...budget.retainedValues()];
      expect(roots).toContain(proxy);
      expect(roots).toContainEqual(["a"]);
      throw marker;
    } })
  });
  const context: SandboxCallContext = { stack: [], thisValue: undefined,
    getProperty: (value, key) => (value as SandboxObject)[key] };
  await expect(setGuestProxyIntegrity(proxy, level, budget, context)).rejects.toBe(marker);
  expect(Object.isExtensible(target)).toBe(false);
  expect(Object.getOwnPropertyDescriptor(target, "a")?.configurable).toBe(true);
  expect([...budget.retainedValues()]).toEqual([]);
});
