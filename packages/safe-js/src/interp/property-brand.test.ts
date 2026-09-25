import { afterEach, expect, it, vi } from "vitest";
import { createIntrinsicArray, createIntrinsicObject, hasOwnPropertyBrand, hasPropertyBrand } from "./object-model.js";

afterEach(() => vi.restoreAllMocks());

it.each([false, true])("observes owned symbol additions and deletions without evaluating getters (array=%s)", array => {
  const value = array ? createIntrinsicArray() : createIntrinsicObject();
  const brand = Symbol("brand");
  let reads = 0;
  expect(hasPropertyBrand(value, brand)).toBe(false);
  expect(hasOwnPropertyBrand(value, brand)).toBe(false);
  Object.defineProperty(value, brand, {
    get() { reads++; throw new Error("Unexpected getter"); }, configurable: true
  });
  expect(hasPropertyBrand(value, brand)).toBe(true);
  expect(hasOwnPropertyBrand(value, brand)).toBe(true);
  expect(reads).toBe(0);
  Reflect.deleteProperty(value, brand);
  expect(hasPropertyBrand(value, brand)).toBe(false);
  expect(hasOwnPropertyBrand(value, brand)).toBe(false);
});

it("keeps inherited presence distinct from own presence after prototype changes", () => {
  const value = createIntrinsicObject();
  const brand = Symbol("brand");
  Object.setPrototypeOf(value, { [brand]: false });
  expect(hasPropertyBrand(value, brand)).toBe(true);
  expect(hasOwnPropertyBrand(value, brand)).toBe(false);
  Object.setPrototypeOf(value, null);
  expect(hasPropertyBrand(value, brand)).toBe(false);
});

it("preserves prototype proxy traps without exposing the owned backing", () => {
  const brand = Symbol("brand");
  const target = { [brand]: true };
  const observed: object[] = [];
  const prototype = new Proxy(target, { has(receiver, key) {
    observed.push(receiver);
    return Reflect.has(receiver, key);
  } });
  const value = createIntrinsicObject(Object.create(prototype));
  expect(hasPropertyBrand(value, brand)).toBe(true);
  expect(hasOwnPropertyBrand(value, brand)).toBe(false);
  expect(observed).toEqual([target]);
  delete (target as { [key: symbol]: unknown })[brand];
  expect(hasPropertyBrand(value, brand)).toBe(false);
  expect(observed).toEqual([target, target]);
});

it("preserves foreign proxy traps around owned tables", () => {
  const brand = Symbol("brand");
  const value = createIntrinsicObject({ [brand]: true });
  const observed: Array<[string, object]> = [];
  const wrapper = new Proxy(value, {
    has(target) { observed.push(["has", target]); return false; },
    getOwnPropertyDescriptor(target) { observed.push(["own", target]); return undefined; }
  });
  expect(hasPropertyBrand(wrapper, brand)).toBe(false);
  expect(hasOwnPropertyBrand(wrapper, brand)).toBe(false);
  expect(observed).toEqual([["has", value], ["own", value]]);
});

it("keeps revoked foreign receivers and prototypes observable", () => {
  const brand = Symbol("brand");
  const value = createIntrinsicObject();
  const wrapper = Proxy.revocable(value, {});
  wrapper.revoke();
  expect(() => hasPropertyBrand(wrapper.proxy, brand)).toThrow(TypeError);
  expect(() => hasOwnPropertyBrand(wrapper.proxy, brand)).toThrow(TypeError);
  const prototype = Proxy.revocable({}, {});
  Object.setPrototypeOf(value, prototype.proxy);
  prototype.revoke();
  expect(() => hasPropertyBrand(value, brand)).toThrow(TypeError);
  expect(hasOwnPropertyBrand(value, brand)).toBe(false);
});

it("passes the original receiver and Object this to replaced hasOwn hooks", () => {
  const brand = Symbol("brand");
  const value = createIntrinsicObject({ [brand]: false });
  const original = Object.hasOwn;
  const observed: unknown[] = [];
  const hook = vi.spyOn(Object, "hasOwn").mockImplementation(function (this: unknown, target, key) {
    if (key === brand) observed.push(this, target);
    return original(target, key);
  });
  const present = hasOwnPropertyBrand(value, brand);
  hook.mockRestore();
  expect(present).toBe(true);
  expect(observed).toEqual([Object, value]);
});

it("reads a hasOwn accessor once and observes mutations made during that read", () => {
  const brand = Symbol("brand");
  const value = createIntrinsicObject();
  const descriptor = Object.getOwnPropertyDescriptor(Object, "hasOwn")!;
  let reads = 0;
  Object.defineProperty(Object, "hasOwn", { configurable: true, get() {
    reads++;
    Object.defineProperty(value, brand, { value: false });
    return descriptor.value;
  } });
  let present: boolean;
  try { present = hasOwnPropertyBrand(value, brand); }
  finally { Object.defineProperty(Object, "hasOwn", descriptor); }
  expect(present).toBe(true);
  expect(reads).toBe(1);
});
