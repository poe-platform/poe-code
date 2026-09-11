import { expect, it, vi } from "vitest";
import { Budget } from "./budget.js";
import { createMathGlobals } from "./globals/math.js";
import { deepCopyFromSandbox, isSandboxClosure, measureSandboxData } from "./values.js";
import { createIntrinsicObject, getSandboxDataProperty, getSandboxPrototype, registerIntrinsicObject, releaseObjectPrototype } from "./object-model.js";
import { createBuiltinBindings } from "./globals.js";
import { run } from "../run.js";
import { serialize, type RuntimeSnapshotValue } from "../snapshot/serialize.js";
import { restore } from "../snapshot/restore.js";

it("reuses unchanged Math descriptor captures and observes native writes", () => {
  const budget = new Budget();
  const { Math: math } = createMathGlobals({ budget });
  try {
    math.extra = "abc";
    const before = measureSandboxData(budget.retainedValues());
    const descriptors = vi.spyOn(Object, "getOwnPropertyDescriptor");
    try {
      expect(measureSandboxData(budget.retainedValues())).toBe(before);
      expect(descriptors.mock.calls.filter(([owner]) => owner === math)).toHaveLength(0);
    } finally { descriptors.mockRestore(); }
    math.extra = "abcdef";
    expect(measureSandboxData(budget.retainedValues())).toBe(before + 3);
    delete math.extra;
    expect(measureSandboxData(budget.retainedValues())).toBe(0);
  } finally { releaseObjectPrototype(budget); }
});

it("reuses unchanged typed-array prototype descriptor captures", () => {
  const budget = new Budget();
  const bindings = createBuiltinBindings({ budget });
  const prototype = getSandboxDataProperty(bindings.Float32Array, "prototype", budget);
  if (typeof prototype !== "object" || prototype === null) throw new Error("missing prototype");
  const shared = getSandboxPrototype(prototype, budget);
  try {
    const before = measureSandboxData(budget.retainedValues());
    const descriptors = vi.spyOn(Object, "getOwnPropertyDescriptor");
    try {
      expect(measureSandboxData(budget.retainedValues())).toBe(before);
      expect(descriptors.mock.calls.filter(([owner]) => owner === prototype || owner === shared)).toHaveLength(0);
    } finally { descriptors.mockRestore(); }
  } finally { releaseObjectPrototype(budget); }
});

it("copies internally tracked data but still rejects arbitrary host proxies", () => {
  expect(deepCopyFromSandbox(createIntrinsicObject({ value: "abc" }))).toEqual({ value: "abc" });
  expect(() => deepCopyFromSandbox(new Proxy({ value: "abc" }, {}))).toThrow("Unsupported proxy");
});

it("does not expose the backing table through the initial object", () => {
  const initial = { payload: "abc" };
  const object = createIntrinsicObject(initial);
  initial.payload = "changed";
  expect(object.payload).toBe("abc");
});

it("invalidates hidden symbols and flags without invoking native getters", () => {
  const budget = new Budget();
  const object = createIntrinsicObject({ original: "abc" });
  registerIntrinsicObject(budget, object);
  const getter = vi.fn(() => { throw new Error("must not run"); });
  const key = Symbol("key");
  try {
    expect([...budget.retainedValues()]).toEqual([]);
    Object.defineProperty(object, key, { value: "symbol", configurable: true });
    Object.defineProperty(object, "hidden", { get: getter, configurable: true });
    expect([...budget.retainedValues()]).toEqual(["hidden", undefined, key, "symbol"]);
    Object.defineProperty(object, "original", { enumerable: false });
    expect([...budget.retainedValues()]).toContain("abc");
    Object.freeze(object);
    expect([...budget.retainedValues()]).toContain("symbol");
    expect(Reflect.defineProperty(object, "new", { value: "blocked" })).toBe(false);
    expect([...budget.retainedValues()]).not.toContain("blocked");
    expect(getter).not.toHaveBeenCalled();
  } finally { releaseObjectPrototype(budget); }
});

it("preserves Math and typed-array prototype mutations through JSON snapshots", async () => {
  const source = "Math.extra={n:7};Object.defineProperty(Float32Array.prototype,'extra',{get(){return this[0]+Math.extra.n},configurable:true});const value=new Float32Array([2]);return ()=>[value.extra,Math.extra.n,Object.getPrototypeOf(value)===Float32Array.prototype]";
  const original = await run(source);
  expect(original.ok).toBe(true);
  if (!original.ok) throw original.error;
  const saved = serialize({ source, currentAstNodeId: 1,
    scopeChain: [{ id: "module", bindings: { read: original.returnValue as RuntimeSnapshotValue } }],
    callStack: [], pendingPromises: [], moduleBindings: {} });
  const binding = restore(JSON.parse(JSON.stringify(saved)), { source }).currentScope.lookup("read");
  if (!binding.found || !isSandboxClosure(binding.value)) throw new Error("missing reader");
  expect(await binding.value.call([])).toEqual([9, 7, true]);
});
