import { expect, it } from "vitest";
import { Budget } from "./budget.js";
import { createGuestProxy, revokeGuestProxy } from "./guest-proxy.js";
import { createObjectArrayGlobals } from "./globals/object-array.js";
import { createReflectGlobal } from "./globals/reflect.js";
import { accessorAdapter } from "./accessors.js";
import { createSandboxClosure, type SandboxCallContext, type SandboxClosure, type SandboxObject } from "./values.js";

const context: SandboxCallContext = { stack: [], thisValue: undefined,
  getProperty: (value, key) => (value as SandboxObject)[key] };

const cases: Array<{ name: string; current?: PropertyDescriptor; result?: SandboxObject; extensible?: boolean }> = [
  { name: "virtual configurable property", result: { value: 4, configurable: true } },
  { name: "missing property" },
  { name: "hidden configurable property", current: { value: 1, configurable: true } },
  { name: "hidden frozen property", current: { value: 1 } },
  { name: "hidden sealed property", current: { value: 1, configurable: true }, extensible: false },
  { name: "invented sealed property", result: { value: 4, configurable: true }, extensible: false },
  { name: "invented frozen property", result: { value: 4 } },
  { name: "falsely frozen configurable property", current: { value: 1, configurable: true }, result: { value: 1 } },
  { name: "falsely frozen writable property", current: { value: 1, writable: true }, result: { value: 1 } },
  { name: "matching frozen property", current: { value: 1 }, result: { value: 1 } },
  { name: "changed frozen value", current: { value: 1 }, result: { value: 2 } },
  { name: "same NaN", current: { value: NaN }, result: { value: NaN } },
  { name: "different signed zero", current: { value: -0 }, result: { value: 0 } },
  { name: "accessor completion", result: { get: undefined, configurable: true } },
  { name: "mixed descriptor", result: { value: 1, get: undefined, configurable: true } }
];

for (const api of ["Object", "Reflect"] as const) {
  it.each(cases)(`${api} matches native descriptor invariants: $name`, async ({ current, result, extensible }) => {
    const target = {};
    if (current !== undefined) Object.defineProperty(target, "x", current);
    if (extensible === false) Object.preventExtensions(target);
    let expected: PropertyDescriptor | undefined, failure = false;
    try { expected = Reflect.getOwnPropertyDescriptor(new Proxy(target, { getOwnPropertyDescriptor: () => result }), "x"); }
    catch (error) { expect(error).toBeInstanceOf(TypeError); failure = true; }
    const budget = new Budget();
    const handler = { getOwnPropertyDescriptor: createSandboxClosure({ guest: true, call: ([value, key], ctx) => {
      expect(value).toBe(target); expect(key).toBe("x"); expect(ctx?.thisValue).toBe(handler);
      return result;
    } }) };
    const methods = api === "Object" ? createObjectArrayGlobals({ budget }).Object.properties! : createReflectGlobal(budget);
    const pending = Promise.resolve().then(() => (methods.getOwnPropertyDescriptor as SandboxClosure).call([createGuestProxy(target, handler), "x"], context));
    if (failure) await expect(pending).rejects.toThrow(TypeError);
    else await expect(pending).resolves.toEqual(expected);
    expect(Object.getOwnPropertyDescriptor(target, "x")).toEqual(current === undefined ? undefined : Object.getOwnPropertyDescriptor(Object.defineProperty({}, "x", current), "x"));
  });

  it(`${api} forwards symbol descriptors through nested proxies`, async () => {
    const budget = new Budget(), key = Symbol("key"), target = { [key]: 7 };
    const methods = api === "Object" ? createObjectArrayGlobals({ budget }).Object.properties! : createReflectGlobal(budget);
    expect(await (methods.getOwnPropertyDescriptor as SandboxClosure).call([createGuestProxy(createGuestProxy(target, {}), {}), key], context))
      .toEqual(Object.getOwnPropertyDescriptor(target, key));
  });

  it(`${api} rejects revoked descriptor reads`, async () => {
    const budget = new Budget(), proxy = createGuestProxy({}, {});
    revokeGuestProxy(proxy);
    const methods = api === "Object" ? createObjectArrayGlobals({ budget }).Object.properties! : createReflectGlobal(budget);
    await expect(Promise.resolve().then(() => (methods.getOwnPropertyDescriptor as SandboxClosure).call([proxy, "x"], context))).rejects.toThrow(TypeError);
  });
}

it.each([null, 3, "bad", true])("rejects primitive trap result %s before inspecting the target", async result => {
  const budget = new Budget();
  const target = createGuestProxy({}, { getOwnPropertyDescriptor: createSandboxClosure({ guest: true, call: () => {
    throw new Error("target queried too early");
  } }) });
  const proxy = createGuestProxy(target, { getOwnPropertyDescriptor: createSandboxClosure({ guest: true, call: () => result }) });
  await expect((createReflectGlobal(budget).getOwnPropertyDescriptor as SandboxClosure).call([proxy, "x"], context)).rejects.toThrow(TypeError);
});

it("preserves frozen accessor identity without invoking it", async () => {
  const budget = new Budget(), target = {};
  const getter = createSandboxClosure({ guest: true, call: () => { throw new Error("getter executed"); } });
  Object.defineProperty(target, "x", { get: accessorAdapter(getter, "get") });
  const proxy = createGuestProxy(target, { getOwnPropertyDescriptor: createSandboxClosure({ guest: true, call: () => ({ get: getter }) }) });
  expect(await (createReflectGlobal(budget).getOwnPropertyDescriptor as SandboxClosure).call([proxy, "x"], context))
    .toEqual({ get: getter, set: undefined, configurable: false, enumerable: false });
});

it("reads target state after trap-side mutation", async () => {
  const budget = new Budget(), target = {};
  const proxy = createGuestProxy(target, { getOwnPropertyDescriptor: createSandboxClosure({ guest: true, call: () => {
    Object.defineProperty(target, "x", { value: 9 });
    return { value: 9 };
  } }) });
  expect(await (createReflectGlobal(budget).getOwnPropertyDescriptor as SandboxClosure).call([proxy, "x"], context))
    .toEqual({ value: 9, writable: false, configurable: false, enumerable: false });
});

it("bounds nested descriptor fallback traversal", async () => {
  const budget = new Budget({ maxSteps: 8 });
  let target: SandboxObject = {};
  for (let i = 0; i < 32; i += 1) target = createGuestProxy(target, {});
  await expect((createReflectGlobal(budget).getOwnPropertyDescriptor as SandboxClosure).call([target, "x"], context))
    .rejects.toMatchObject({ code: "budgetExceeded", budget: "steps" });
});
